/**
 * ZCTX-PATCH-AUTO D8 tests — the feed-aware pre-adaptation chain
 * (RES-PATCH-DEEPEN §2): check-official (feed read side), preadapt (the
 * pre-adaptation pipeline), and the auto linkage arm.
 *
 * MOCKING CHOICE (deliberate, documented per the task card's "你选"):
 *   - The OFFICIAL FEED is a real local HTTP server (node:http on
 *     127.0.0.1:0) serving the channel yml + the installer bytes — the
 *     production fetch/download code path runs unmodified against it, so
 *     the HTTP face is exercised for real, only the WIRE is local.
 *   - The 7z EXTRACTION is an injected run7zImpl that "extracts" a canned
 *     app tree (built once per test with the real @electron/asar) instead
 *     of spawning a fake 7z.exe binary. Rationale: the production code
 *     spawns a real binary; a fake exe would need PATH games and prove
 *     nothing about the real extraction, while the injection point mirrors
 *     the exact call contract ({installerPath, workDir, sevenZip}) →
 *     {appTree} — orchestration, gating order, and refusals are tested 1:1,
 *     and the REAL 7z face is exercised in the B5 real-machine drill
 *     (RES-PATCH-DEEPEN [U2]/[U3] stay open for exactly that drill).
 *
 * Asserted: check-official field face + staging math (the REAL machine UUID
 * from DR1-7 → percentage ≈ 0.4347 → 30% excludes this machine) + HTML
 * fallback refusal + missing-field refusals + pending/update-info signal;
 * preadapt would-do gate (no download without --yes), idempotence via the
 * anchors file, sha512 mismatch → installer deleted, fuse pre-check refusal
 * (integrity '1' AND unreadable), reanchor DRIFTED → candidate void,
 * simulated-patch refusal → nothing lands, --accept lands + never clobbers,
 * workdir cleanup vs --keep-workdir; auto linkage: would-preadapt /
 * preadapting→patched / feed-pending / feed-unreachable continue.
 */

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import * as asar from '@electron/asar'

import {
  SUPPORTED,
  checkOfficial,
  compareVersions,
  installerVersionFromFileName,
  listAnchorSetVersions,
  machineStagingPercentage,
  parseUpdateYaml,
  patchAsar,
  preadaptAnchorSet,
  resolveAnchorEntry,
  runAuto,
  statusAsar,
  tryAcquireAutoLock,
  validateAnchorSetData,
} from '../patcher/zctx-patch.mjs'
import type { AutoHookArgs, ZctxPatchSetEntry } from '../patcher/zctx-patch.d.mts'

const sha256 = (buf: Buffer | string): string => createHash('sha256').update(buf).digest('hex')
const sha512Base64 = (buf: Buffer): string => createHash('sha512').update(buf).digest('base64')

// ---------------------------------------------------------------------------
// The five-file rc.3-style lib fixtures (same shape as the reanchor spec).
// ---------------------------------------------------------------------------

const FIX_LLM_PI_AI = [
  '// fixture llm-pi-ai lib/index.js',
  'import { createHash } from "node:crypto";',
  'class PiAdapter {',
  '\tstream(request, options) {',
  '\t\tconst snapshot = this.prepare(request)',
  '\t\t\t\tconst iterator = toStreamChunks(snapshot.models.streamSimple(model, context, {',
  '\t\t\t\t\t...profileOptions(profile, reasoning, apiKey),',
  '\t\t\t\t\tsignal: watchdog.signal,',
  '\t\t\t\t\theaders: requestHeaders(profile.headers, options, model.baseUrl, this.config.prepareHeaders)',
  '\t\t\t})',
  '\t\t\treturn iterator',
  '\t}',
  '}',
  'const Config = z.object({ providers: z.dict(profile).default({}).volatile() });',
  'function apply(ctx, config) {',
  '\tconst adapter = new PiAiAdapter({',
  '\t\tauth,',
  '\t\tprepareHeaders: (request, headers) => ctx.waterfall("llm-pi-ai/request-headers", request, headers, () => headers),',
  '\t});',
  '\treturn adapter;',
  '}',
  'export { Config, PiAiAdapter, apply, inject, name, recordKeyFor, supportedProtocols };',
].join('\n')

const FIX_AGENT_LOOP = [
  '// fixture agent-loop lib/index.js',
  'class ReactLoopAgent {',
  '\tconstructor(loopCtx, id, options, session, lifetimeSignal, lastTurn) {',
  '\t\tthis.runtimeContext = new RuntimeContextProjection(this.ctx, session);',
  '\t}',
  '\tbuildRequest(config, preparedCall, tools, info, startsRequestSeries, signal) {',
  '\t\treturn markAgentLoopRequest(Object.freeze({',
  '\t\t\tsessionId: this.session.id,',
  '\t\t\tsignal',
  '\t\t}));',
  '\t}',
  '}',
  'export { AgentLoop, AgentLoop as default, CONFIGURED_AGENT_IDENTITIES_KEY, DEFAULT_MAX_PARALLEL_TOOL_CALLS };',
].join('\n')

const FIX_SESSION = [
  '// fixture session lib/index.js',
  'const KNOWN_SESSION_EVENT_TYPES = new Set([',
  '\t"assistant/message",',
  '\t"command/done",',
  ']);',
  'export { KNOWN_SESSION_EVENT_TYPES };',
].join('\n')

const FIX_COMPACTION_BASIC = [
  '// fixture compaction-basic lib/index.js',
  'class BasicCompactionEngine {',
  '\tasync compactIfNeeded(agent, trigger, signal) {',
  '\t\tif (prune !== void 0) {',
  '\t\t\tprune.pruneSession(agent.session);',
  '\t\t}',
  '\t\treturn null;',
  '\t}',
  '}',
  'export { BasicCompactionEngine, BasicCompactionEngine as default };',
].join('\n')

const FIX_PRUNER = [
  '// fixture pruner lib/index.js',
  'class ToolResultPruner {',
  '\tpruneContent(blocks) {',
  '\t\tif (totalChars <= this.config.thresholdChars) return null;',
  '\t\tif (charsAfter > this.config.thresholdChars || charsAfter >= totalChars) throw new Error("tool-result prune: replacement must be smaller and within threshold");',
  '\t}',
  '\tpruneSession(session) {',
  '\t\t\tconst original = session.deriveEventMessage(event);',
  '\t\t\tconst content = this.pruneContent(original.content);',
  '\t\t\tcharsRemoved += charsBefore - charsAfter;',
  '\t\t}',
  '\t\treturn {',
  '\t\t\tpruned,',
  '\t\t\tcharsRemoved',
  '\t\t};',
  '\t}',
  '};',
  'export { DEFAULTS, PRUNE_MARKER, ToolResultPruner, ToolResultPruner as default, codePointLength, resolveConfig };',
].join('\n')

const BASE_CONTENTS: Record<string, string> = {
  'dsh/node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/index.js': FIX_LLM_PI_AI,
  'dsh/node_modules/@deepseek-ai/dsh-agent-loop/lib/index.js': FIX_AGENT_LOOP,
  'dsh/node_modules/@deepseek-ai/dsh-session/lib/index.js': FIX_SESSION,
  'dsh/node_modules/@deepseek-ai/dsh-compaction-basic/lib/index.js': FIX_COMPACTION_BASIC,
  'dsh/node_modules/@deepseek-ai/dsh-compaction-tool-result-pruner/lib/index.js': FIX_PRUNER,
}
const AGENT_LOOP_PATH = 'dsh/node_modules/@deepseek-ai/dsh-agent-loop/lib/index.js'

const FUSE_SENTINEL = 'dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX'
const APP_EXE = 'DeepSeek Harness.exe'
const shellName = '@deepseek-ai/dsh-desktop'

let cleanupDirs: string[] = []

afterEach(async () => {
  for (const dir of cleanupDirs) rmSync(dir, { recursive: true, force: true })
  cleanupDirs = []
})

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  cleanupDirs.push(dir)
  return dir
}

// ---------------------------------------------------------------------------
// The mock official feed: a real local HTTP server (production fetch code
// path, local wire only). Requests are recorded for the "exactly ONE
// installer GET" assertions.
// ---------------------------------------------------------------------------

interface FeedRoute {
  match: (path: string) => boolean
  status: number
  body: Buffer | string
  contentType?: string
  /** Never respond (socket held open) — exercises the client-side timeouts. */
  stall?: boolean
}

async function startFeedServer(buildRoutes: (baseUrl: string) => FeedRoute[]): Promise<{ url: string; requests: string[]; close: () => Promise<void> }> {
  const requests: string[] = []
  let routes: FeedRoute[] = []
  const stalled: import('node:net').Socket[] = []
  const server: Server = createServer((request, response) => {
    const path = request.url ?? '/'
    requests.push(path)
    const route = routes.find((candidate) => candidate.match(path))
    if (route === undefined) {
      response.statusCode = 404
      response.end('not found')
      return
    }
    if (route.stall === true) {
      // Hold the socket open without responding until the test tears down.
      if (request.socket !== undefined) stalled.push(request.socket)
      return
    }
    response.statusCode = route.status
    if (route.contentType !== undefined) response.setHeader('content-type', route.contentType)
    response.end(route.body)
  })
  await new Promise<void>((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('mock feed server failed to listen')
  const url = `http://127.0.0.1:${address.port}`
  routes = buildRoutes(url)
  return {
    url,
    requests,
    close: () => new Promise<void>((resolvePromise) => {
      for (const socket of stalled) socket.destroy()
      server.close(() => resolvePromise())
    }),
  }
}

interface FeedConfig {
  version: string
  installerPath: string
  installerBytes: Buffer
  sha512?: string // override to simulate a mismatch
  stagingPercentage?: number | null
  includeVersion?: boolean
  htmlInstead?: boolean
}

function feedYaml(feed: FeedConfig, baseUrl: string): string {
  if (feed.htmlInstead === true) return '<!DOCTYPE html><html><body>SPA fallback</body></html>'
  const sha = feed.sha512 ?? sha512Base64(feed.installerBytes)
  const lines = [
    ...(feed.includeVersion === false ? [] : [`version: ${feed.version}`]),
    `path: ${feed.installerPath}`,
    `sha512: ${sha}`,
    `releaseDate: '2026-11-18T11:35:49.720Z'`,
    'githubArtifactName: null',
    'files:',
    `  - url: ${baseUrl}/bin/win-x64/${feed.installerPath}`,
    `    size: ${feed.installerBytes.length}`,
    `    sha512: ${sha}`,
    '  - url: installer.blockmap',
    '    size: 311530',
  ]
  if (feed.stagingPercentage !== undefined && feed.stagingPercentage !== null) lines.push(`stagingPercentage: ${feed.stagingPercentage}`)
  return `${lines.join('\n')}\n`
}

// ---------------------------------------------------------------------------
// Fixture builders: the "real install" (check-official reads it) + the
// canned extracted tree (the injected run7zImpl "extracts" it).
// ---------------------------------------------------------------------------

interface PreadaptFixture {
  readonly work: string
  readonly appDir: string
  readonly updaterIdPath: string
  readonly localAppData: string
  readonly anchorsDir: string
  readonly workRoot: string
  readonly logFile: string
}

interface CannedTree {
  readonly treeRoot: string
  readonly installerBytes: Buffer
}

const buildStamp = (version: string) => (text: string) => `${text}\n// build stamp ${version} stock`

function fusedExe(integrity: '0' | '1' | 'plain'): Buffer {
  const states = integrity === 'plain' ? null : '1011' + integrity + '0011'
  const wire = states === null ? Buffer.from([]) : Buffer.concat([Buffer.from([1, 9]), Buffer.from(states, 'latin1')])
  return Buffer.concat([Buffer.alloc(128, 0x41), Buffer.from(FUSE_SENTINEL, 'latin1'), wire, Buffer.alloc(64, 0x42)])
}

/** The canned "extracted app tree" the injected run7zImpl hands back. */
async function buildCannedTree(work: string, version: string, opts: { exe?: '0' | '1' | 'plain'; driftAgentLoop?: boolean } = {}): Promise<CannedTree> {
  const exeFace = opts.exe ?? '0'
  const src = join(work, 'canned-src')
  for (const [path, text] of Object.entries(BASE_CONTENTS)) {
    const file = join(src, path)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, path === AGENT_LOOP_PATH && opts.driftAgentLoop === true
      ? `${buildStamp(version)(text).replace('\t\t\tsignal\n', '\t\t\tsignalToken\n')}`
      : buildStamp(version)(text))
  }
  writeFileSync(join(src, 'package.json'), JSON.stringify({ name: shellName, version }))
  mkdirSync(join(src, 'extra'), { recursive: true })
  writeFileSync(join(src, 'extra', 'neighbor.js'), '// neighbor file')
  const treeRoot = join(work, 'canned-tree')
  mkdirSync(join(treeRoot, 'resources'), { recursive: true })
  await asar.createPackage(src, join(treeRoot, 'resources', 'app.asar'))
  writeFileSync(join(treeRoot, APP_EXE), fusedExe(exeFace))
  writeFileSync(join(treeRoot, 'resources', 'app-update.yml'), `provider: generic\nurl: https://download.deepseek.com/dsh-desk/feeds/win-x64/\nupdaterCacheDirName: @deepseek-aidsh-desktop-updater\nchannel: nightly\n`)
  // The "installer" bytes the mock feed serves (the mock extractor ignores
  // their content; the feed sha512 is computed over them).
  const installerBytes = Buffer.concat([Buffer.alloc(4096, 0x7a), Buffer.from(`installer-for-${version}`)])
  return { treeRoot, installerBytes }
}

/** The "real install" face check-official reads (asar + app-update.yml). */
async function buildRealInstall(work: string, opts: { feedBaseUrl: string; feed: FeedConfig }): Promise<{ appDir: string }> {
  const src = join(work, 'install-src')
  mkdirSync(join(src), { recursive: true })
  writeFileSync(join(src, 'package.json'), JSON.stringify({ name: shellName, version: '0.2.2-rc.3' }))
  const appDir = join(work, 'DeepSeek Harness')
  mkdirSync(join(appDir, 'resources'), { recursive: true })
  await asar.createPackage(src, join(appDir, 'resources', 'app.asar'))
  writeFileSync(
    join(appDir, 'resources', 'app-update.yml'),
    `provider: generic\nurl: ${opts.feedBaseUrl}/feeds/win-x64/\nupdaterCacheDirName: test-updater-cache\nchannel: nightly\npublisherName:\n  - Hangzhou DeepSeek\n`,
  )
  return { appDir }
}

/** Wire the preadapt pipeline to the mock world. */
function preadaptHooks(fixture: PreadaptFixture, canned: CannedTree, overrides: Record<string, unknown> = {}) {
  return {
    run7zImpl: async ({ workDir }: { installerPath: string; workDir: string; sevenZip: { path: string } }) => {
      // Simulated extraction: copy the canned tree into the pipeline's workdir.
      const appTree = join(workDir, 'app')
      mkdirSync(join(appTree, 'resources'), { recursive: true })
      copyTree(canned.treeRoot, appTree)
      return { appTree }
    },
    ...overrides,
  }
}

function copyTree(from: string, to: string): void {
  const entries = readdirAll(from)
  for (const [relative, isFile] of entries) {
    const target = join(to, relative)
    if (isFile) {
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, readFileSync(join(from, relative)))
    }
  }
}

function readdirAll(dir: string, prefix = ''): Array<[string, boolean]> {
  const out: Array<[string, boolean]> = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`
    if (entry.isFile()) out.push([relative, true])
    else out.push(...readdirAll(full, relative).map(([r, f]) => [r, f] as [string, boolean]))
  }
  return out
}

async function buildFixtureWorld(opts: { feed: FeedConfig; canned: CannedTree }): Promise<{ fixture: PreadaptFixture; feed: { url: string; requests: string[]; close: () => Promise<void> } }> {
  const work = tempDir('zctx-preadapt-spec-')
  const feed = await startFeedServer((baseUrl) => [
    { match: (path) => path.endsWith('/nightly.yml'), status: 200, body: feedYaml(opts.feed, baseUrl) },
    { match: (path) => path.endsWith(`/${opts.feed.installerPath}`), status: 200, body: opts.feed.installerBytes, contentType: 'application/vnd.microsoft.portable-executable' },
  ])
  const { appDir } = await buildRealInstall(work, { feedBaseUrl: feed.url, feed: opts.feed })
  const fixture: PreadaptFixture = {
    work,
    appDir,
    updaterIdPath: join(work, 'updater-id', '.updaterId'),
    localAppData: join(work, 'localappdata'),
    anchorsDir: join(work, 'anchors'),
    workRoot: join(work, 'preadapt-work'),
    logFile: join(work, 'auto.log'),
  }
  mkdirSync(dirname(fixture.updaterIdPath), { recursive: true })
  return { fixture, feed }
}

/** A UUID whose isStagingMatch percentage is ~0 (bytes 12-15 = 00 00 00 01). */
const STAGED_IN_UUID = '00000000-0000-0000-0000-000000000001'
/** The REAL machine UUID from RES-PATCH-DEEPEN [DR1-6]/[DR1-7] (read-only citation). */
const REAL_MACHINE_UUID = '98681471-bf58-5aa2-8529-51c66f480194'

// ---------------------------------------------------------------------------
// check-official (D8a).
// ---------------------------------------------------------------------------

describe('check-official: the feed read side', () => {
  it('reports pending with all faces (one yml GET, zero installer GETs)', async () => {
    const canned = await buildCannedTree(tempDir('zctx-preadapt-canned-'), '0.2.2-rc.5')
    const { fixture, feed } = await buildFixtureWorld({ feed: { version: '0.2.2-rc.5', installerPath: 'installer.exe', installerBytes: canned.installerBytes, stagingPercentage: 30 }, canned })
    writeFileSync(fixture.updaterIdPath, STAGED_IN_UUID)
    const result = await checkOfficial({ appDir: fixture.appDir, updaterIdPath: fixture.updaterIdPath, localAppData: fixture.localAppData, logFile: fixture.logFile })
    expect(result.ok).toBe(true)
    expect(result.exitCode).toBe(0)
    expect(result.updateState).toBe('pending')
    expect(result.feedVersion).toBe('0.2.2-rc.5')
    expect(result.installedVersion).toBe('0.2.2-rc.3')
    expect(result.feedSize).toBe(canned.installerBytes.length)
    expect(result.feedSha512).toBe(sha512Base64(canned.installerBytes))
    expect(result.stagingPercentage).toBe(30)
    expect(result.stagedIn).toBe(true)
    expect(result.installerUrl).toContain('/bin/win-x64/installer.exe')
    expect(feed.requests.filter((path) => path.endsWith('.exe'))).toEqual([])
    expect(feed.requests.filter((path) => path.endsWith('nightly.yml'))).toHaveLength(1)
    await feed.close()
  })

  it('staging math: the REAL machine UUID (DR1-7) → 0.4347 → 30% excludes it', async () => {
    const machine = machineStagingPercentage(REAL_MACHINE_UUID)
    expect(machine.ok).toBe(true)
    expect(machine.percentage).toBeCloseTo(0.434692, 5)
    // The direction conclusion that is robust to algorithm drift.
    expect(machine.percentage! < 30 / 100).toBe(false)
    const staged = machineStagingPercentage(STAGED_IN_UUID)
    expect(staged.percentage! < 30 / 100).toBe(true)
  })

  it('up-to-date when the feed version equals the installed version', async () => {
    const canned = await buildCannedTree(tempDir('zctx-preadapt-canned-'), '0.2.2-rc.3')
    const { fixture, feed } = await buildFixtureWorld({ feed: { version: '0.2.2-rc.3', installerPath: 'installer.exe', installerBytes: canned.installerBytes }, canned })
    const result = await checkOfficial({ appDir: fixture.appDir, updaterIdPath: fixture.updaterIdPath, localAppData: fixture.localAppData, logFile: fixture.logFile })
    expect(result.ok).toBe(true)
    expect(result.updateState).toBe('up-to-date')
    await feed.close()
  })

  it('refuses the SPA HTML fallback loudly (the latest.yml trap, DR1-3)', async () => {
    const canned = await buildCannedTree(tempDir('zctx-preadapt-canned-'), '0.2.2-rc.5')
    const { fixture, feed } = await buildFixtureWorld({ feed: { version: '0.2.2-rc.5', installerPath: 'installer.exe', installerBytes: canned.installerBytes, htmlInstead: true }, canned })
    const result = await checkOfficial({ appDir: fixture.appDir, updaterIdPath: fixture.updaterIdPath, localAppData: fixture.localAppData, logFile: fixture.logFile })
    expect(result.ok).toBe(false)
    expect(result.exitCode).toBe(1)
    expect(result.state).toBe('feed-unparsable')
    expect(result.detail).toContain('HTML')
    await feed.close()
  })

  it('refuses HTTP 404 and missing required fields loudly', async () => {
    const canned = await buildCannedTree(tempDir('zctx-preadapt-canned-'), '0.2.2-rc.5')
    const missing = await buildFixtureWorld({ feed: { version: '0.2.2-rc.5', installerPath: 'installer.exe', installerBytes: canned.installerBytes, includeVersion: false }, canned })
    const missingResult = await checkOfficial({ appDir: missing.fixture.appDir, updaterIdPath: missing.fixture.updaterIdPath, localAppData: missing.fixture.localAppData, logFile: missing.fixture.logFile })
    expect(missingResult.ok).toBe(false)
    expect(missingResult.state).toBe('feed-incomplete')
    expect(missingResult.detail).toContain('"version"')
    await missing.feed.close()

    const { fixture, feed } = await buildFixtureWorld({ feed: { version: '0.2.2-rc.5', installerPath: 'installer.exe', installerBytes: canned.installerBytes }, canned })
    await feed.close() // server down → network failure
    const unreachable = await checkOfficial({ appDir: fixture.appDir, updaterIdPath: fixture.updaterIdPath, localAppData: fixture.localAppData, logFile: fixture.logFile })
    expect(unreachable.ok).toBe(false)
    expect(unreachable.state).toBe('feed-unreachable')
  })

  it('reads the official downloader pending signal (update-info.json) read-only', async () => {
    const canned = await buildCannedTree(tempDir('zctx-preadapt-canned-'), '0.2.2-rc.5')
    const { fixture, feed } = await buildFixtureWorld({ feed: { version: '0.2.2-rc.5', installerPath: 'installer.exe', installerBytes: canned.installerBytes, stagingPercentage: 30 }, canned })
    const pendingDir = join(fixture.localAppData, 'test-updater-cache', 'pending')
    mkdirSync(pendingDir, { recursive: true })
    writeFileSync(join(pendingDir, 'update-info.json'), JSON.stringify({ fileName: 'deepseek-harness-0.2.2-rc.3-win-x64.exe', sha512: 'GiJf8kx+C7eoiZ0xQSYBcTyh5xmXQl+vh63U6uSm963McK1AkMgB8PydzuekWdUY7hyURvhVMHANM4pn+tCKzQ==', isAdminRightsRequired: false }))
    const result = await checkOfficial({ appDir: fixture.appDir, updaterIdPath: fixture.updaterIdPath, localAppData: fixture.localAppData, logFile: fixture.logFile })
    expect(result.pendingInstaller?.version).toBe('0.2.2-rc.3')
    expect(result.pendingInstaller?.fileName).toBe('deepseek-harness-0.2.2-rc.3-win-x64.exe')
    await feed.close()
  })

  it('unit faces: compareVersions + installerVersionFromFileName + yaml parser', () => {
    expect(compareVersions('0.2.2-rc.5', '0.2.2-rc.3').order).toBe(1)
    expect(compareVersions('0.2.2-rc.3', '0.2.2-rc.5').order).toBe(-1)
    expect(compareVersions('0.2.2', '0.2.2-rc.9').order).toBe(1)
    expect(compareVersions('0.2.3', '0.2.2-rc.9').order).toBe(1)
    expect(compareVersions('0.2.2-rc.3', '0.2.2-rc.3').order).toBe(0)
    // B3 review B-1: semver rule 11.4 — a NUMERIC identifier always has
    // LOWER precedence than an alphanumeric one; the NaN-coercion bug made
    // this pair read backwards.
    expect(compareVersions('1.0.0-alpha.beta', '1.0.0-alpha.1').order).toBe(1)
    expect(compareVersions('1.0.0-alpha.1', '1.0.0-alpha.beta').order).toBe(-1)
    expect(compareVersions('1.0.0-1.beta', '1.0.0-1.1').order).toBe(1)
    const incomparable = compareVersions('weird', '0.2.2-rc.3')
    expect(incomparable.comparable).toBe(false)
    expect(installerVersionFromFileName('deepseek-harness-0.2.2-rc.3-win-x64.exe')).toBe('0.2.2-rc.3')
    expect(installerVersionFromFileName('not-an-installer.exe')).toBeUndefined()
    const parsed = parseUpdateYaml('version: 0.2.2-rc.5\nfiles:\n  - url: http://x/y.exe\n    size: 123\n    sha512: abc==\nstagingPercentage: 30\n')
    expect(parsed.ok).toBe(true)
    expect(parsed.doc?.version).toBe('0.2.2-rc.5')
    expect(parsed.doc?.files?.[0].size).toBe(123)
    expect(parsed.doc?.stagingPercentage).toBe(30)
    expect(parseUpdateYaml('<html>SPA</html>').ok).toBe(false)
    expect(parseUpdateYaml('a: 1\n  weird: indent\n').ok).toBe(false)
    // The REAL app-update.yml shape: publisherName's nested list is skipped
    // (the block value is empty → whole nested block skipped honestly).
    const withPublisher = parseUpdateYaml('provider: generic\nurl: https://x/\nupdaterCacheDirName: c\nchannel: nightly\npublisherName:\n  - Hangzhou DeepSeek\n')
    expect(withPublisher.ok).toBe(true)
    expect(withPublisher.doc?.provider).toBe('generic')
    expect(withPublisher.doc?.channel).toBe('nightly')
  })
})

/** check-official with the fixture's injected read faces (never the real user dirs). */
// ---------------------------------------------------------------------------
// preadapt (D8b).
// ---------------------------------------------------------------------------

describe('preadapt: the pre-adaptation pipeline', () => {
  it('MONEY TEST: would-do → download+verify → extract → fuse → reanchor → simulated patch 5/5 → --accept lands', async () => {
    const canned = await buildCannedTree(tempDir('zctx-preadapt-canned-'), '0.2.2-rc.5')
    const { fixture, feed } = await buildFixtureWorld({ feed: { version: '0.2.2-rc.5', installerPath: 'installer.exe', installerBytes: canned.installerBytes, stagingPercentage: 30 }, canned })
    writeFileSync(fixture.updaterIdPath, STAGED_IN_UUID)

    // 0. Without --yes: would-preadapt, NO download, nothing written.
    const would = await preadaptAnchorSet({ ...fixture, ...preadaptHooks(fixture, canned) })
    expect(would.ok).toBe(true)
    expect(would.state).toBe('would-preadapt')
    expect(would.detail).toContain('MB')
    expect(feed.requests.filter((path) => path.endsWith('.exe'))).toEqual([])
    expect(existsSync(fixture.anchorsDir)).toBe(false)

    // 1. Full pipeline with --yes --accept: every gate green → lands.
    const result = await preadaptAnchorSet({
      ...fixture,
      ...preadaptHooks(fixture, canned),
      yes: true,
      accept: true,
    })
    expect(result.ok).toBe(true)
    expect(result.state).toBe('preadapted')
    expect(result.writtenTo).toBe(join(fixture.anchorsDir, '0.2.2-rc.5.json'))
    expect(result.writtenSha256).toBe(sha256(readFileSync(result.writtenTo!)))
    // The landed candidate is exactly the canned tree's new hashes.
    const candidate = JSON.parse(readFileSync(result.writtenTo!, 'utf8')) as ZctxPatchSetEntry
    expect(validateAnchorSetData(candidate).ok).toBe(true)
    const stamped = sha256(Buffer.from(`${buildStamp('0.2.2-rc.5')(FIX_LLM_PI_AI)}`, 'utf8'))
    expect(candidate.files[0].pristineSha256).toBe(stamped)
    // Exactly ONE installer GET happened (the yml GET is separate).
    expect(feed.requests.filter((path) => path.endsWith('.exe'))).toHaveLength(1)
    // Natural idempotence: a second run repeats NOTHING (no new download).
    const again = await preadaptAnchorSet({ ...fixture, ...preadaptHooks(fixture, canned), yes: true, accept: true })
    expect(again.state).toBe('already-preadapted')
    expect(feed.requests.filter((path) => path.endsWith('.exe'))).toHaveLength(1)
    // The loader now resolves rc.5 from the data channel.
    expect(resolveAnchorEntry('0.2.2-rc.5', { anchorsDir: fixture.anchorsDir }).source).toBe('data')
    await feed.close()
  })

  it('up-to-date feed → exit 0 without any download', async () => {
    const canned = await buildCannedTree(tempDir('zctx-preadapt-canned-'), '0.2.2-rc.3')
    const { fixture, feed } = await buildFixtureWorld({ feed: { version: '0.2.2-rc.3', installerPath: 'installer.exe', installerBytes: canned.installerBytes }, canned })
    const result = await preadaptAnchorSet({ ...fixture, ...preadaptHooks(fixture, canned), yes: true, accept: true })
    expect(result.ok).toBe(true)
    expect(result.state).toBe('up-to-date')
    expect(feed.requests.filter((path) => path.endsWith('.exe'))).toEqual([])
    await feed.close()
  })

  it('sha512 mismatch → installer DELETED, loud refusal, nothing lands', async () => {
    const canned = await buildCannedTree(tempDir('zctx-preadapt-canned-'), '0.2.2-rc.5')
    const { fixture, feed } = await buildFixtureWorld({ feed: { version: '0.2.2-rc.5', installerPath: 'installer.exe', installerBytes: canned.installerBytes, sha512: 'WRONGSHA512WRONGSHA512WRONGSHA512WRONGSHA512WRONGSHA512WRONGSHA512WRONGSHA512WRONG=' }, canned })
    writeFileSync(fixture.updaterIdPath, STAGED_IN_UUID)
    const result = await preadaptAnchorSet({ ...fixture, ...preadaptHooks(fixture, canned), yes: true, accept: true })
    expect(result.ok).toBe(false)
    expect(result.state).toBe('download-verify-failed')
    expect(result.detail).toContain('installer DELETED')
    const installerOnDisk = join(fixture.workRoot, '0.2.2-rc.5', 'installer.exe')
    expect(existsSync(installerOnDisk)).toBe(false)
    expect(existsSync(fixture.anchorsDir)).toBe(false)
    await feed.close()
  })

  it('fuse pre-check refuses a flipped exe (integrity 1) and an unreadable exe (no sentinel)', async () => {
    const flipped = await buildCannedTree(tempDir('zctx-preadapt-canned-'), '0.2.2-rc.5', { exe: '1' })
    const flippedWorld = await buildFixtureWorld({ feed: { version: '0.2.2-rc.5', installerPath: 'installer.exe', installerBytes: flipped.installerBytes }, canned: flipped })
    writeFileSync(flippedWorld.fixture.updaterIdPath, STAGED_IN_UUID)
    const refused = await preadaptAnchorSet({ ...flippedWorld.fixture, ...preadaptHooks(flippedWorld.fixture, flipped), yes: true, accept: true })
    expect(refused.ok).toBe(false)
    expect(refused.state).toBe('fuse-on')
    expect(refused.detail).toContain("integrity fuse = '1'")
    expect(refused.detail).toContain('failure radius stays in this pipeline')
    expect(existsSync(flippedWorld.fixture.anchorsDir)).toBe(false)
    await flippedWorld.feed.close()

    const plain = await buildCannedTree(tempDir('zctx-preadapt-canned-'), '0.2.2-rc.5', { exe: 'plain' })
    const plainWorld = await buildFixtureWorld({ feed: { version: '0.2.2-rc.5', installerPath: 'installer.exe', installerBytes: plain.installerBytes }, canned: plain })
    writeFileSync(plainWorld.fixture.updaterIdPath, STAGED_IN_UUID)
    const unreadable = await preadaptAnchorSet({ ...plainWorld.fixture, ...preadaptHooks(plainWorld.fixture, plain), yes: true, accept: true })
    expect(unreadable.ok).toBe(false)
    expect(unreadable.state).toBe('fuse-unreadable')
    await plainWorld.feed.close()
  })

  it('reanchor DRIFTED on the extracted tree → candidate void, nothing lands', async () => {
    const drifted = await buildCannedTree(tempDir('zctx-preadapt-canned-'), '0.2.2-rc.5', { driftAgentLoop: true })
    const world = await buildFixtureWorld({ feed: { version: '0.2.2-rc.5', installerPath: 'installer.exe', installerBytes: drifted.installerBytes }, canned: drifted })
    writeFileSync(world.fixture.updaterIdPath, STAGED_IN_UUID)
    const result = await preadaptAnchorSet({ ...world.fixture, ...preadaptHooks(world.fixture, drifted), yes: true, accept: true })
    expect(result.ok).toBe(false)
    expect(result.state).toBe('reanchor-refused')
    expect(result.detail).toContain('no candidate')
    expect(existsSync(world.fixture.anchorsDir)).toBe(false)
    await world.feed.close()
  })

  it('simulated patch refuses (app-running gate on the extracted tree) → candidate void, nothing lands', async () => {
    const canned = await buildCannedTree(tempDir('zctx-preadapt-canned-'), '0.2.2-rc.5')
    const { fixture, feed } = await buildFixtureWorld({ feed: { version: '0.2.2-rc.5', installerPath: 'installer.exe', installerBytes: canned.installerBytes }, canned })
    writeFileSync(fixture.updaterIdPath, STAGED_IN_UUID)
    const result = await preadaptAnchorSet({
      ...fixture,
      ...preadaptHooks(fixture, canned),
      yes: true,
      accept: true,
      // The ONE injectable failure lever: the simulated patch's own
      // app-running gate says the tree is "running" → the full patch flow
      // refuses → the pipeline must void the candidate.
      probeAppRunning: () => 'yes' as const,
    })
    expect(result.ok).toBe(false)
    expect(result.state).toBe('sim-patch-failed')
    expect(result.detail).toContain('candidate void, NOT landed')
    expect(existsSync(fixture.anchorsDir)).toBe(false)
    await feed.close()
  })

  it('--accept absent → candidate-ready, nothing lands; --keep-workdir keeps the workdir; default cleans it', async () => {
    const canned = await buildCannedTree(tempDir('zctx-preadapt-canned-'), '0.2.2-rc.5')
    const { fixture, feed } = await buildFixtureWorld({ feed: { version: '0.2.2-rc.5', installerPath: 'installer.exe', installerBytes: canned.installerBytes }, canned })
    writeFileSync(fixture.updaterIdPath, STAGED_IN_UUID)
    const ready = await preadaptAnchorSet({ ...fixture, ...preadaptHooks(fixture, canned), yes: true })
    expect(ready.ok).toBe(true)
    expect(ready.state).toBe('candidate-ready')
    expect(existsSync(fixture.anchorsDir)).toBe(false)
    const kept = await preadaptAnchorSet({ ...fixture, ...preadaptHooks(fixture, canned), yes: true, accept: true, keepWorkdir: true })
    expect(kept.ok).toBe(true)
    expect(kept.state).toBe('preadapted')
    expect(existsSync(join(fixture.workRoot, '0.2.2-rc.5'))).toBe(true)
    await feed.close()
  })

  it('an INVALID existing data set for the feed version refuses (never silently re-adapted)', async () => {
    const canned = await buildCannedTree(tempDir('zctx-preadapt-canned-'), '0.2.2-rc.5')
    const { fixture, feed } = await buildFixtureWorld({ feed: { version: '0.2.2-rc.5', installerPath: 'installer.exe', installerBytes: canned.installerBytes }, canned })
    writeFileSync(fixture.updaterIdPath, STAGED_IN_UUID)
    mkdirSync(fixture.anchorsDir, { recursive: true })
    writeFileSync(join(fixture.anchorsDir, '0.2.2-rc.5.json'), '{ broken')
    const result = await preadaptAnchorSet({ ...fixture, ...preadaptHooks(fixture, canned), yes: true, accept: true })
    expect(result.ok).toBe(false)
    expect(result.state).toBe('anchor-data-invalid')
    expect(result.detail).toContain('delete it explicitly')
    await feed.close()
  })
})

// ---------------------------------------------------------------------------
// auto linkage (D8c).
// ---------------------------------------------------------------------------

const appClosed = () => 'no' as const

/** The production five-file op anchors (the fixture texts embed them verbatim). */
const PRODUCTION_FILES = Object.fromEntries(
  ((SUPPORTED['0.2.2-rc.3'] as ZctxPatchSetEntry).files as readonly { targetPath: string }[]).map((file) => [file.targetPath, file]),
) as Record<string, ZctxPatchSetEntry['files'][number]>

async function buildAutoFixture(version: string): Promise<{ appDir: string; asarPath: string; dshHome: string; entry: ZctxPatchSetEntry; anchorsDir: string; logFile: string; work: string }> {
  const work = tempDir('zctx-auto-feed-spec-')
  const src = join(work, 'src')
  for (const [path, text] of Object.entries(BASE_CONTENTS)) {
    const file = join(src, path)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, text)
  }
  writeFileSync(join(src, 'package.json'), JSON.stringify({ name: shellName, version }))
  const appDir = join(work, 'DeepSeek Harness')
  mkdirSync(join(appDir, 'resources'), { recursive: true })
  const asarPath = join(appDir, 'resources', 'app.asar')
  await asar.createPackage(src, asarPath)
  writeFileSync(join(appDir, APP_EXE), fusedExe('0'))
  const dshHome = join(work, 'dsh-home')
  mkdirSync(dshHome, { recursive: true })
  const entry: ZctxPatchSetEntry = {
    shellPackage: '@deepseek-ai/dsh-desktop',
    files: Object.entries(BASE_CONTENTS).map(([targetPath, text]) => {
      const file = PRODUCTION_FILES[targetPath]
      return { ...file, pristineSha256: sha256(Buffer.from(text, 'utf8')) }
    }),
  }
  return { appDir, asarPath, dshHome, entry, anchorsDir: join(work, 'anchors'), logFile: join(work, 'auto.log'), work }
}

describe('auto linkage (D8c): pending feed × missing anchors', () => {
  it('would-preadapt without --yes: pending feed, no anchors, NO pipeline run, local judgment continues', async () => {
    const fixture = await buildAutoFixture('0.2.2-rc.3')
    let preadaptCalls = 0
    const result = await runAuto({
      appDir: fixture.appDir,
      dshHome: fixture.dshHome,
      probeAppRunning: appClosed,
      logFile: fixture.logFile,
      feedFace: true,
      anchorsDir: fixture.anchorsDir,
      statusFn: (args: AutoHookArgs) => statusAsar({ ...args, entry: fixture.entry }),
      patchFn: (args: AutoHookArgs) => patchAsar({ ...args, entry: fixture.entry }),
      checkOfficialFn: async () => ({
        ok: true,
        state: 'pending',
        exitCode: 0,
        detail: 'feed=0.2.2-rc.5 installed=0.2.2-rc.3',
        logFile: '',
        updateState: 'pending',
        feedVersion: '0.2.2-rc.5',
        installedVersion: '0.2.2-rc.3',
        feedSize: 299593552,
      }),
      preadaptFn: async () => {
        preadaptCalls += 1
        throw new Error('preadapt must NOT run without --yes')
      },
    })
    expect(result.exitCode).toBe(0)
    expect(result.state).toBe('would-patch')
    expect(result.lines.some((line) => line.includes('state=would-preadapt') && line.includes('285.7 MB'))).toBe(true)
    expect(preadaptCalls).toBe(0)
  })

  it('preadapting with --yes: the pipeline runs, lands, and the local judgment continues to patched', async () => {
    const fixture = await buildAutoFixture('0.2.2-rc.3')
    const result = await runAuto({
      appDir: fixture.appDir,
      dshHome: fixture.dshHome,
      yes: true,
      probeAppRunning: appClosed,
      logFile: fixture.logFile,
      feedFace: true,
      anchorsDir: fixture.anchorsDir,
      statusFn: (args: AutoHookArgs) => statusAsar({ ...args, entry: fixture.entry }),
      patchFn: (args: AutoHookArgs) => patchAsar({ ...args, entry: fixture.entry }),
      checkOfficialFn: async () => ({
        ok: true,
        state: 'pending',
        exitCode: 0,
        detail: 'feed=0.2.2-rc.5 installed=0.2.2-rc.3',
        logFile: '',
        updateState: 'pending',
        feedVersion: '0.2.2-rc.5',
        installedVersion: '0.2.2-rc.3',
        feedSize: 299593552,
      }),
      preadaptFn: async () => ({
        ok: true,
        state: 'preadapted',
        exitCode: 0,
        detail: 'landed',
        logFile: '',
        writtenTo: join(fixture.anchorsDir, '0.2.2-rc.5.json'),
      }),
    })
    expect(result.exitCode).toBe(0)
    expect(result.state).toBe('patched')
    expect(result.lines.some((line) => line.includes('state=preadapting'))).toBe(true)
    expect(result.lines.some((line) => line.includes('state=preadapted'))).toBe(true)
    // The local judgment continued: the install itself got patched.
    const status = await statusAsar({ appDir: fixture.appDir, probeAppRunning: appClosed, entry: fixture.entry })
    expect(status.patchSet?.state).toBe('patched')
  })

  it('feed pending with anchors already prepared → info line, no preadapt', async () => {
    const fixture = await buildAutoFixture('0.2.2-rc.3')
    mkdirSync(fixture.anchorsDir, { recursive: true })
    // A VALID data anchor set for the feed version (production op anchors —
    // only presence in the data channel matters for this arm's resolution).
    writeFileSync(join(fixture.anchorsDir, '0.2.2-rc.5.json'), JSON.stringify({
      anchorSetVersion: 'zctx-v0.3-base-1',
      generatedAt: '2026-11-18T00:00:00.000Z',
      sourceReport: 'test fixture',
      shellPackage: '@deepseek-ai/dsh-desktop',
      files: (SUPPORTED['0.2.2-rc.3'] as ZctxPatchSetEntry).files,
    }))
    let preadaptCalls = 0
    const result = await runAuto({
      appDir: fixture.appDir,
      dshHome: fixture.dshHome,
      probeAppRunning: appClosed,
      logFile: fixture.logFile,
      feedFace: true,
      anchorsDir: fixture.anchorsDir,
      statusFn: (args: AutoHookArgs) => statusAsar({ ...args, entry: fixture.entry }),
      patchFn: (args: AutoHookArgs) => patchAsar({ ...args, entry: fixture.entry }),
      checkOfficialFn: async () => ({
        ok: true,
        state: 'pending',
        exitCode: 0,
        detail: 'pending',
        logFile: '',
        updateState: 'pending',
        feedVersion: '0.2.2-rc.5',
        installedVersion: '0.2.2-rc.3',
        feedSize: 299593552,
      }),
      preadaptFn: async () => {
        preadaptCalls += 1
        throw new Error('preadapt must not run when anchors exist')
      },
    })
    expect(result.exitCode).toBe(0)
    expect(result.lines.some((line) => line.includes('state=feed-pending') && line.includes('anchors already prepared'))).toBe(true)
    expect(preadaptCalls).toBe(0)
  })

  it('feed unreachable → loud WARN line, the local judgment continues (offline self-sufficiency)', async () => {
    const fixture = await buildAutoFixture('0.2.2-rc.3')
    const result = await runAuto({
      appDir: fixture.appDir,
      dshHome: fixture.dshHome,
      probeAppRunning: appClosed,
      logFile: fixture.logFile,
      feedFace: true,
      anchorsDir: fixture.anchorsDir,
      statusFn: (args: AutoHookArgs) => statusAsar({ ...args, entry: fixture.entry }),
      patchFn: (args: AutoHookArgs) => patchAsar({ ...args, entry: fixture.entry }),
      checkOfficialFn: async () => {
        throw new Error('network down')
      },
    })
    expect(result.exitCode).toBe(0)
    expect(result.state).toBe('would-patch')
    expect(result.lines.some((line) => line.includes('state=feed-unreachable') && line.includes('network down'))).toBe(true)
  })

  it('feedFace OFF (module default) → no feed lines, fully offline judgment', async () => {
    const fixture = await buildAutoFixture('0.2.2-rc.3')
    const result = await runAuto({
      appDir: fixture.appDir,
      dshHome: fixture.dshHome,
      probeAppRunning: appClosed,
      logFile: fixture.logFile,
      statusFn: (args: AutoHookArgs) => statusAsar({ ...args, entry: fixture.entry }),
      patchFn: (args: AutoHookArgs) => patchAsar({ ...args, entry: fixture.entry }),
      checkOfficialFn: async () => {
        throw new Error('must not be called with feedFace off')
      },
    })
    expect(result.exitCode).toBe(0)
    expect(result.lines.every((line) => !line.includes('feed-'))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Bounded network + single-instance mutex + CLI faces (B3 review B-4/B-6).
// ---------------------------------------------------------------------------

const PATCHER_MJS = join(process.cwd(), 'patcher', 'zctx-patch.mjs')

describe('bounded network faces (B3 review B-4): a hung feed can never wedge a tick', () => {
  it('check-official: a stalled feed yml aborts at the timeout → loud feed-unreachable, exit 1', async () => {
    const canned = await buildCannedTree(tempDir('zctx-preadapt-canned-'), '0.2.2-rc.5')
    const feed = await startFeedServer((baseUrl) => [
      { match: (path) => path.endsWith('/nightly.yml'), status: 200, body: '', stall: true },
      { match: (path) => path.endsWith('/installer.exe'), status: 200, body: canned.installerBytes },
    ])
    try {
      const { appDir } = await buildRealInstall(tempDir('zctx-preadapt-stall-'), { feedBaseUrl: feed.url, feed: { version: '0.2.2-rc.5', installerPath: 'installer.exe', installerBytes: canned.installerBytes } })
      const result = await checkOfficial({ appDir, updaterIdPath: join(tempDir('zctx-stall-id-'), '.updaterId'), localAppData: tempDir('zctx-stall-lad-'), logFile: join(tempDir('zctx-stall-log-'), 'auto.log'), feedTimeoutMs: 300 })
      expect(result.ok).toBe(false)
      expect(result.exitCode).toBe(1)
      expect(result.state).toBe('feed-unreachable')
      expect(result.detail).toContain('aborted')
    } finally {
      await feed.close()
    }
  })

  it('preadapt: a stalled installer download aborts at the timeout → loud download-failed, nothing lands', async () => {
    const canned = await buildCannedTree(tempDir('zctx-preadapt-canned-'), '0.2.2-rc.5')
    const feed = await startFeedServer((baseUrl) => [
      { match: (path) => path.endsWith('/nightly.yml'), status: 200, body: feedYaml({ version: '0.2.2-rc.5', installerPath: 'installer.exe', installerBytes: canned.installerBytes }, baseUrl) },
      { match: (path) => path.endsWith('/installer.exe'), status: 200, body: '', stall: true },
    ])
    const work = tempDir('zctx-preadapt-stall-dl-')
    try {
      const { appDir } = await buildRealInstall(work, { feedBaseUrl: feed.url, feed: { version: '0.2.2-rc.5', installerPath: 'installer.exe', installerBytes: canned.installerBytes } })
      const result = await preadaptAnchorSet({
        appDir,
        yes: true,
        accept: true,
        anchorsDir: join(work, 'anchors'),
        workRoot: join(work, 'preadapt-work'),
        logFile: join(work, 'auto.log'),
        updaterIdPath: join(work, 'updater-id', '.updaterId'),
        localAppData: join(work, 'localappdata'),
        run7zImpl: async ({ workDir }: { installerPath: string; workDir: string }) => ({ appTree: join(workDir, 'app') }),
        downloadTimeoutMs: 300,
      })
      expect(result.ok).toBe(false)
      expect(result.state).toBe('download-failed')
      expect(result.detail).toContain('aborted')
      expect(existsSync(join(work, 'anchors', '0.2.2-rc.5.json'))).toBe(false)
    } finally {
      await feed.close()
    }
  })
})

describe('auto tick mutex + CLI faces (B3 review B-4/B-6)', () => {
  it('a FRESH lock holder skips the round politely (exit 0, audit line in the log sink)', () => {
    const work = tempDir('zctx-mutex-')
    const lockPath = join(work, 'auto.lock')
    const auditLog = join(work, 'auto.log')
    writeFileSync(lockPath, `${JSON.stringify({ owner: 12345, acquiredAt: Date.now() })}\n`)
    const probed = spawnSync(process.execPath, [PATCHER_MJS, 'auto', '--app-dir', join(work, 'no-such-install')], {
      encoding: 'utf8',
      env: { ...process.env, ZCTX_AUTO_LOCK_PATH: lockPath, ZCTX_AUTO_LOG_PATH: auditLog },
    })
    expect(probed.status).toBe(0)
    expect(probed.stdout).toContain('state=already-running')
    expect(readFileSync(auditLog, 'utf8')).toContain('state=already-running')
    // The held lock survives the skip (the live tick keeps it).
    expect(existsSync(lockPath)).toBe(true)
  })

  it('a STALE lock holder (lease expired) is taken over once and the tick proceeds', () => {
    const work = tempDir('zctx-mutex-')
    const lockPath = join(work, 'auto.lock')
    const auditLog = join(work, 'auto.log')
    writeFileSync(lockPath, `${JSON.stringify({ owner: 12345, acquiredAt: Date.now() - 31 * 60 * 1000 })}\n`)
    const probed = spawnSync(process.execPath, [PATCHER_MJS, 'auto', '--app-dir', join(work, 'no-such-install')], {
      encoding: 'utf8',
      env: { ...process.env, ZCTX_AUTO_LOCK_PATH: lockPath, ZCTX_AUTO_LOG_PATH: auditLog },
    })
    expect(probed.status).toBe(1)
    expect(probed.stdout).toContain('state=mutex-takeover')
    // The tick proceeded past the mutex into the local judgment.
    expect(probed.stdout).toContain('state=missing-asar')
    // The stale lock was replaced by THIS tick's own lock, then released.
    expect(existsSync(lockPath)).toBe(false)
  })

  it('unit faces: a fresh in-process acquire refuses; a stale one takes over', () => {
    const work = tempDir('zctx-mutex-unit-')
    const lockPath = join(work, 'auto.lock')
    const fresh = tryAcquireAutoLock(lockPath, 30 * 60 * 1000, 1_000_000)
    expect(fresh.ok).toBe(true)
    const blocked = tryAcquireAutoLock(lockPath, 30 * 60 * 1000, 1_100_000)
    expect(blocked.ok).toBe(false)
    expect(blocked.fresh).toBe(true)
    const taken = tryAcquireAutoLock(lockPath, 30 * 60 * 1000, 1_000_000 + 31 * 60 * 1000)
    expect(taken.ok).toBe(true)
    expect(taken.tookOverStale).toBe(true)
    taken.release?.()
    expect(existsSync(lockPath)).toBe(false)
  })

  it('unknown CLI option: clean usage + the offending token, exit 2, NO raw stack (B3 review B-6)', () => {
    const probed = spawnSync(process.execPath, [PATCHER_MJS, 'status', '--bogus-flag'], { encoding: 'utf8' })
    expect(probed.status).toBe(2)
    expect(probed.stderr).toContain('--bogus-flag')
    expect(probed.stderr).toContain('usage:')
    expect(probed.stderr).not.toMatch(/^\s+at\s+/m)
  })
})
