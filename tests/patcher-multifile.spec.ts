/**
 * P6-B multi-file patch-set tests — the FULL five-file base-context set
 * (plan ZCTX-v03-patch-plan; RES-port-feasibility §2/§3) on a synthetic
 * mini-asar whose five bundles embed the REAL rc.3 op anchors verbatim. The
 * production pristine hashes are substituted per fixture file, so the
 * production SUPPORTED entry runs end-to-end without the real archive.
 *
 * Asserted here:
 *   - full chain on the 5-file set (8 gate steps, one asar write, marker
 *     with per-file files[] hashes, status patchSet aggregate);
 *   - every untouched file byte-identical (official extraction);
 *   - idempotent re-patch (no new backup, marker untouched);
 *   - the crash-window self-heal backfills the v0.2 marker shape;
 *   - a SINGLE drifted file refuses the whole set and modifies nothing;
 *   - a MIXED face (foreign partial writer splices one bundle back to
 *     pristine) refuses patch loudly with the per-file face and moves
 *     nothing (P6B-R1), and status aggregates every face honestly —
 *     patched / partial (pristine-mix AND drifted-mix) / unpatched /
 *     drifted, every arm reachable (P6B-R2);
 *   - restore returns every file to its pristine bytes;
 *   - spliceAsarMulti witness accounting (between-target shift);
 *   - the INLINED REGION TEXTS behave: the classifier/observer region and
 *     the wrapper region are imported from the patcher data via data: URL
 *     modules and exercised against mock sessions / wire bodies (behavioral,
 *     not just presence — the shipped bytes run).
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, sep } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import * as asar from '@electron/asar'

import { SUPPORTED, normalizeEntry, patchAsar, patchFile, restoreAsar, spliceAsarMulti, statusAsar } from '../patcher/zctx-patch.mjs'
import type { ZctxPatchFileEntry, ZctxPatchSetEntry } from '../patcher/zctx-patch.d.mts'

const asarNative = (path: string): string => path.split('/').join(sep)

function freshExtract(asarPath: string, path: string): Buffer {
  asar.uncacheAll()
  return asar.extractFile(asarPath, asarNative(path))
}

const sha256 = (text: string): string => createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex')
const appClosed = () => 'no' as const

// ---------------------------------------------------------------------------
// The five fixture bundles — each embeds the production op anchors verbatim
// (compiled style: tab indent, `void 0`, double-quoted strings).
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
  '\tconst auth = { credentials: null, authContext: null };',
  '\tconst adapter = new PiAiAdapter({',
  '\t\tprofiles,',
  '\t\tresolveApiKey,',
  '\t\tauth,',
  '\t\tprepareHeaders: (request, headers) => ctx.waterfall("llm-pi-ai/request-headers", request, headers, () => headers),',
  '\t});',
  '\treturn adapter;',
  '}',
  'export { Config, PiAiAdapter, apply, inject, name, recordKeyFor, supportedProtocols };',
].join('\n')

const FIX_AGENT_LOOP = [
  '// fixture agent-loop lib/index.js',
  'import { SessionLogOffset } from "@deepseek-ai/dsh-session";',
  'class ReactLoopAgent {',
  '\tconstructor(loopCtx, id, options, session, lifetimeSignal, lastTurn) {',
  '\t\tthis.loopCtx = loopCtx;',
  '\t\tthis.id = id;',
  '\t\tthis.options = options;',
  '\t\tthis.session = session;',
  '\t\tthis.runtimeContext = new RuntimeContextProjection(this.ctx, session);',
  '\t\tthis.systemPrompt = new SystemPromptProjection(session);',
  '\t}',
  '\tbuildRequest(config, preparedCall, tools, info, startsRequestSeries, signal) {',
  '\t\tconst boundaryMessages = session.deriveMessages();',
  '\t\treturn markAgentLoopRequest(Object.freeze({',
  '\t\t\t...header.config,',
  '\t\t\tmessages: boundaryMessages,',
  '\t\t\ttoolHistory: session.toolHistory(),',
  '\t\t\t...header.tools !== void 0 ? { tools: header.tools } : {},',
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
  '\t"agent-preset/selected",',
  '\t"assistant/attempt",',
  '\t"assistant/message",',
  '\t"command/done",',
  '\t"command/run",',
  '\t"compaction/end",',
  '\t"compaction/start"',
  ']);',
  'export { KNOWN_SESSION_EVENT_TYPES };',
].join('\n')

const FIX_COMPACTION_BASIC = [
  '// fixture compaction-basic lib/index.js',
  'class BasicCompactionEngine {',
  '\tasync compactIfNeeded(agent, trigger, signal) {',
  '\t\tconst header = agent.session.requestHeader();',
  '\t\tconst prune = this.ctx.get("toolResultPruner");',
  '\t\tconst info = await this.ctx.llm.resolveModelInfo(target.provider, target.model, signal);',
  '\t\tif (prune !== void 0) {',
  '\t\t\tprune.pruneSession(agent.session);',
  '\t\t\tmeasurement = meter.measure(agent.session, header);',
  '\t\t}',
  '\t\treturn null;',
  '\t}',
  '}',
  'export { BasicCompactionEngine, BasicCompactionEngine as default };',
].join('\n')

const FIX_PRUNER = [
  '// fixture pruner lib/index.js',
  'class ToolResultPruner {',
  '\tmeasureContent(blocks) {',
  '\t\treturn 0;',
  '\t}',
  '\tpruneContent(blocks) {',
  '\t\tconst totalChars = this.measureContent(blocks);',
  '\t\tif (totalChars <= this.config.thresholdChars) return null;',
  '\t\tconst removedStart = this.config.headChars;',
  '\t\tconst charsAfter = 0;',
  '\t\tif (charsAfter > this.config.thresholdChars || charsAfter >= totalChars) throw new Error("tool-result prune: replacement must be smaller and within threshold");',
  '\t\treturn pruned;',
  '\t}',
  '\tpruneSession(session) {',
  '\t\tconst candidates = [];',
  '\t\tfor (const { seq, event } of candidates) {',
  '\t\t\tconst original = session.deriveEventMessage(event);',
  '\t\t\tconst content = this.pruneContent(original.content);',
  '\t\t\tconst charsBefore = this.measureContent(original.content);',
  '\t\t\tconst charsAfter = this.measureContent(content);',
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

const FIXTURE_CONTENTS: Record<string, string> = {
  'dsh/node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/index.js': FIX_LLM_PI_AI,
  'dsh/node_modules/@deepseek-ai/dsh-agent-loop/lib/index.js': FIX_AGENT_LOOP,
  'dsh/node_modules/@deepseek-ai/dsh-session/lib/index.js': FIX_SESSION,
  'dsh/node_modules/@deepseek-ai/dsh-compaction-basic/lib/index.js': FIX_COMPACTION_BASIC,
  'dsh/node_modules/@deepseek-ai/dsh-compaction-tool-result-pruner/lib/index.js': FIX_PRUNER,
}

const EXTRA_CONTENTS: Record<string, string> = {
  'package.json': JSON.stringify({ name: '@deepseek-ai/dsh-desktop', version: '0.2.2-rc.3' }),
  'extra/neighbor.js': '// neighbor file positioned after the targets in the payload',
}

/** The production entry with per-file fixture pristine hashes substituted. */
function fixtureEntry(): ZctxPatchSetEntry {
  const rc3 = SUPPORTED['0.2.2-rc.3'] as ZctxPatchSetEntry
  return {
    shellPackage: rc3.shellPackage,
    files: rc3.files.map((file: ZctxPatchFileEntry) => ({
      ...file,
      pristineSha256: sha256(FIXTURE_CONTENTS[file.targetPath]),
    })),
  }
}

// ---------------------------------------------------------------------------
// Fixture assembly.
// ---------------------------------------------------------------------------

interface MultiFixture {
  readonly work: string
  readonly appDir: string
  readonly asarPath: string
  readonly markerPath: string
  originalSha: string
}

let cleanupDirs: string[] = []

afterEach(() => {
  for (const dir of cleanupDirs) rmSync(dir, { recursive: true, force: true })
  cleanupDirs = []
})

async function createMultiFixture(): Promise<MultiFixture> {
  const work = mkdtempSync(join(tmpdir(), 'zctx-multifile-spec-'))
  cleanupDirs.push(work)
  const src = join(work, 'src')
  for (const path of [...Object.keys(FIXTURE_CONTENTS), ...Object.keys(EXTRA_CONTENTS)]) {
    const file = join(src, path)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, FIXTURE_CONTENTS[path] ?? EXTRA_CONTENTS[path])
  }
  const appDir = join(work, 'DeepSeek Harness')
  mkdirSync(join(appDir, 'resources'), { recursive: true })
  const asarPath = join(appDir, 'resources', 'app.asar')
  await asar.createPackage(src, asarPath)
  return {
    work,
    appDir,
    asarPath,
    markerPath: join(appDir, '.zctx-patch.json'),
    originalSha: createHash('sha256').update(readFileSync(asarPath)).digest('hex'),
  }
}

/** Index of the session bundle in the patch-set order (the mixed-face guinea pig). */
const SESSION_INDEX = normalizeEntry(SUPPORTED['0.2.2-rc.3'] as ZctxPatchSetEntry).findIndex((file) => file.targetPath.includes('dsh-session'))

/**
 * Foreign partial writer: splice ONE file's text over its region in ONE asar
 * write — a face this patcher can never produce (it writes the whole set in
 * one operation), used to build mixed-face fixtures (P6B-R1/R2).
 */
function spliceFace(fixture: MultiFixture, fileIndex: number, text: string): void {
  const file = normalizeEntry(fixtureEntry())[fileIndex]
  const spliced = spliceAsarMulti({ asarPath: fixture.asarPath, targets: [{ targetPath: file.targetPath, patchedText: text }] })
  writeFileSync(fixture.asarPath, spliced.buffer)
  asar.uncacheAll()
}

// ---------------------------------------------------------------------------
// Full chain on the five-file set.
// ---------------------------------------------------------------------------

describe('patchAsar: the five-file base-context set (P6-B)', () => {
  it('patches ALL five bundles in one asar write: gates → backup → splice → post-verify → marker', async () => {
    const fixture = await createMultiFixture()
    const result = await patchAsar({ appDir: fixture.appDir, probeAppRunning: appClosed, entry: fixtureEntry() })
    expect(result.ok).toBe(true)
    const stepNames = result.steps.map((step) => `${step.name}:${step.status}`)
    expect(stepNames).toEqual([
      'app-running gate:ok',
      'version gate:ok',
      'anchor hash gate:ok',
      'anchor patch:ok',
      'backup:ok',
      'splice:ok',
      'post-verify:ok',
      'marker:ok',
    ])
    expect(result.files).toHaveLength(5)
    expect(result.files?.every((file) => file.delta > 0)).toBe(true)

    // Every target carries its patched face; every untouched file byte-identical.
    for (const [path, content] of Object.entries(FIXTURE_CONTENTS)) {
      const patched = freshExtract(fixture.asarPath, path).toString('utf8')
      const fileEntry = normalizeEntry(fixtureEntry())[Object.keys(FIXTURE_CONTENTS).indexOf(path)]
      const expected = patchFile(content, fileEntry).text as string
      expect(patched).toBe(expected)
    }
    expect(freshExtract(fixture.asarPath, 'extra/neighbor.js').toString('utf8')).toBe(EXTRA_CONTENTS['extra/neighbor.js'])
    expect(freshExtract(fixture.asarPath, 'package.json').toString('utf8')).toContain('0.2.2-rc.3')

    // Spot-check the wired faces across bundles.
    const llm = freshExtract(fixture.asarPath, Object.keys(FIXTURE_CONTENTS)[0]).toString('utf8')
    expect(llm).toContain('guardObserve: z.boolean().default(true).volatile()')
    expect(llm).toContain('...guardSink === void 0 ? {} : { fetch: createGuardFetchWrapper({ model, sink: guardSink }) }')
    const agentLoop = freshExtract(fixture.asarPath, Object.keys(FIXTURE_CONTENTS)[1]).toString('utf8')
    expect(agentLoop).toContain('(this.options.guardObserve ?? true) === true')
    expect(agentLoop).toContain('onGuardObserve: (capture) => { this.guardObserver.observe(capture); }')
    const session = freshExtract(fixture.asarPath, Object.keys(FIXTURE_CONTENTS)[2]).toString('utf8')
    expect(session).toContain('"cache/guard-observe",')
    const compaction = freshExtract(fixture.asarPath, Object.keys(FIXTURE_CONTENTS)[3]).toString('utf8')
    expect(compaction).toContain('byteCapPerResult: toolCapToByteLimit(budget.toolCap)')
    const pruner = freshExtract(fixture.asarPath, Object.keys(FIXTURE_CONTENTS)[4]).toString('utf8')
    expect(pruner).toContain('limitFor(declared, opts)')

    // Marker: the v0.2 set shape (per-file before/after hashes).
    const marker = JSON.parse(readFileSync(fixture.markerPath, 'utf8')) as Record<string, unknown>
    expect(marker.patchSet).toBe('zctx-v0.3-base-1')
    expect(marker.target).toBe(Object.keys(FIXTURE_CONTENTS)[0])
    const files = marker.files as { target: string; sha256Before: string; sha256After: string }[]
    expect(files).toHaveLength(5)
    expect(files.map((file) => file.target)).toEqual(Object.keys(FIXTURE_CONTENTS))
    for (const file of files) expect(file.sha256Before).toBe(sha256(FIXTURE_CONTENTS[file.target]))

    // Status: the patch-set aggregate reports patched across all five.
    const status = await statusAsar({ appDir: fixture.appDir, probeAppRunning: appClosed, entry: fixtureEntry() })
    expect(status.patched).toBe(true)
    expect(status.patchSet).toMatchObject({ state: 'patched', totalFiles: 5, patchedFiles: 5, driftedFiles: 0 })
    expect(status.files).toHaveLength(5)
    expect(status.files?.every((file) => file.anchorHit === 'patched-exact')).toBe(true)
  })

  it('is idempotent: a second patch is a no-op success without a new backup', async () => {
    const fixture = await createMultiFixture()
    const first = await patchAsar({ appDir: fixture.appDir, probeAppRunning: appClosed, entry: fixtureEntry() })
    expect(first.ok).toBe(true)
    const backupCount = readdirSync(join(fixture.work, 'zctx-backup')).length
    const markerAfterFirst = readFileSync(fixture.markerPath, 'utf8')

    const second = await patchAsar({ appDir: fixture.appDir, probeAppRunning: appClosed, entry: fixtureEntry() })
    expect(second.ok).toBe(true)
    expect(second.alreadyPatched).toBe(true)
    expect(second.backup).toBeUndefined()
    expect(readdirSync(join(fixture.work, 'zctx-backup')).length).toBe(backupCount)
    expect(readFileSync(fixture.markerPath, 'utf8')).toBe(markerAfterFirst)
  })

  it('P4-2 carried to the set shape: marker missing → backfill with per-file files[] (asar untouched)', async () => {
    const fixture = await createMultiFixture()
    const first = await patchAsar({ appDir: fixture.appDir, probeAppRunning: appClosed, entry: fixtureEntry() })
    expect(first.ok).toBe(true)
    const patchedAsarSha = createHash('sha256').update(readFileSync(fixture.asarPath)).digest('hex')
    const backupCount = readdirSync(join(fixture.work, 'zctx-backup')).length
    rmSync(fixture.markerPath)

    const second = await patchAsar({ appDir: fixture.appDir, probeAppRunning: appClosed, entry: fixtureEntry() })
    expect(second.ok).toBe(true)
    expect(second.alreadyPatched).toBe(true)
    expect(second.markerBackfilled).toBe(true)
    expect(second.steps.find((step) => step.name === 'marker')?.status).toBe('backfilled')
    expect(createHash('sha256').update(readFileSync(fixture.asarPath)).digest('hex')).toBe(patchedAsarSha)
    expect(readdirSync(join(fixture.work, 'zctx-backup')).length).toBe(backupCount)
    const marker = JSON.parse(readFileSync(fixture.markerPath, 'utf8')) as Record<string, unknown>
    const files = marker.files as { target: string; sha256After: string }[]
    expect(files).toHaveLength(5)
    for (const file of files) {
      const patched = freshExtract(fixture.asarPath, file.target).toString('utf8')
      expect(file.sha256After).toBe(createHash('sha256').update(Buffer.from(patched, 'utf8')).digest('hex'))
    }
  })

  it('refuses when ONE file drifted (official update moved one bundle) and modifies NOTHING', async () => {
    const fixture = await createMultiFixture()
    // Tamper the session bundle in the source tree, repack, then patch.
    const driftedContent = `${FIX_SESSION}\n// official update edit\n`
    const srcSession = join(fixture.work, 'src', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-session', 'lib', 'index.js')
    writeFileSync(srcSession, driftedContent)
    await asar.createPackage(join(fixture.work, 'src'), fixture.asarPath)
    const beforeSha = createHash('sha256').update(readFileSync(fixture.asarPath)).digest('hex')

    const result = await patchAsar({ appDir: fixture.appDir, probeAppRunning: appClosed, entry: fixtureEntry() })
    expect(result.ok).toBe(false)
    expect(result.refused).toBe(true)
    const last = result.steps.at(-1)
    expect(last?.name).toBe('anchor hash gate')
    expect(last?.status).toBe('refused')
    expect(last?.detail).toContain('anchor drift')
    expect(last?.detail).toContain('dsh-session')
    expect(existsBackup(fixture.work)).toBe(false)
    expect(existsSync(fixture.markerPath)).toBe(false)
    expect(createHash('sha256').update(readFileSync(fixture.asarPath)).digest('hex')).toBe(beforeSha)
    // The per-file face names the drifted row.
    const files = result.files as { target: string; state: string }[] | undefined
    expect(files?.find((file) => file.target.includes('dsh-session'))?.state).toBe('drifted')
    expect(files?.filter((file) => file.state === 'pristine')).toHaveLength(4)
  })

  it('restores every bundle to its pristine bytes and clears the marker', async () => {
    const fixture = await createMultiFixture()
    const patched = await patchAsar({ appDir: fixture.appDir, probeAppRunning: appClosed, entry: fixtureEntry() })
    expect(patched.ok).toBe(true)

    const restored = await restoreAsar({ appDir: fixture.appDir, probeAppRunning: appClosed })
    expect(restored.ok).toBe(true)
    expect(existsSync(fixture.markerPath)).toBe(false)
    expect(createHash('sha256').update(readFileSync(fixture.asarPath)).digest('hex')).toBe(fixture.originalSha)
    for (const [path, content] of Object.entries(FIXTURE_CONTENTS)) {
      expect(freshExtract(fixture.asarPath, path).toString('utf8')).toBe(content)
    }
  })
})

// ---------------------------------------------------------------------------
// P6B-R1/R2 mixed-face pins: a foreign partial writer splices ONE bundle back
// to pristine (or drifts it) AFTER a full patch — a face this patcher can
// never produce. patch must refuse it loudly (R1); status must aggregate it
// honestly with every aggregate arm reachable (R2).
// ---------------------------------------------------------------------------

describe('mixed faces: patch refuses (P6B-R1), status aggregates honestly (P6B-R2)', () => {
  it('P6B-R1: a MIXED face (foreign revert of one patched bundle) refuses loudly — per-file face, asar bytes unchanged, no new backup', async () => {
    const fixture = await createMultiFixture()
    const patched = await patchAsar({ appDir: fixture.appDir, probeAppRunning: appClosed, entry: fixtureEntry() })
    expect(patched.ok).toBe(true)
    const backupCount = readdirSync(join(fixture.work, 'zctx-backup')).length
    const markerBefore = readFileSync(fixture.markerPath, 'utf8')
    // Foreign partial writer: splice the session bundle's PRISTINE text back
    // over its patched region. (The splice itself moves bytes — the refusal
    // assertion anchors on the POST-splice state: the refused patch run must
    // move nothing.)
    spliceFace(fixture, SESSION_INDEX, FIXTURE_CONTENTS['dsh/node_modules/@deepseek-ai/dsh-session/lib/index.js'])
    const mixedAsarSha = createHash('sha256').update(readFileSync(fixture.asarPath)).digest('hex')

    const second = await patchAsar({ appDir: fixture.appDir, probeAppRunning: appClosed, entry: fixtureEntry() })
    expect(second.ok).toBe(false)
    expect(second.refused).toBe(true)
    const gate = second.steps.find((candidate) => candidate.name === 'mixed-face gate')
    expect(gate?.status).toBe('refused')
    expect(gate?.detail).toContain('1 pristine + 4 patched-exact')
    expect(gate?.detail).toContain('dsh-session')
    expect(second.recovery).toContain('restore --app-dir')
    // The per-file face names which rows are in and which are not.
    const files = second.files as { target: string; state: string }[] | undefined
    expect(files?.find((file) => file.target.includes('dsh-session'))?.state).toBe('pristine')
    expect(files?.filter((file) => file.state === 'patched-exact')).toHaveLength(4)
    // Nothing moved: asar bytes, backup count, marker.
    expect(createHash('sha256').update(readFileSync(fixture.asarPath)).digest('hex')).toBe(mixedAsarSha)
    expect(readdirSync(join(fixture.work, 'zctx-backup')).length).toBe(backupCount)
    expect(readFileSync(fixture.markerPath, 'utf8')).toBe(markerBefore)
  })

  it('P6B-R2: a mixed pristine+patched-exact face aggregates to partial (counts honest, patched stays presence-true)', async () => {
    const fixture = await createMultiFixture()
    const patched = await patchAsar({ appDir: fixture.appDir, probeAppRunning: appClosed, entry: fixtureEntry() })
    expect(patched.ok).toBe(true)
    spliceFace(fixture, SESSION_INDEX, FIXTURE_CONTENTS['dsh/node_modules/@deepseek-ai/dsh-session/lib/index.js'])

    const status = await statusAsar({ appDir: fixture.appDir, probeAppRunning: appClosed, entry: fixtureEntry() })
    expect(status.patched).toBe(true)
    expect(status.patchSet).toMatchObject({ state: 'partial', totalFiles: 5, patchedFiles: 4, pristineFiles: 1, driftedFiles: 0 })
    expect(status.files?.find((file) => file.target.includes('dsh-session'))?.anchorHit).toBe('official-unchanged')
    expect(status.files?.filter((file) => file.anchorHit === 'patched-exact')).toHaveLength(4)
  })

  it('P6B-R2: a mixed patched+drifted face aggregates to partial (drift rows never mask patch presence)', async () => {
    const fixture = await createMultiFixture()
    const patched = await patchAsar({ appDir: fixture.appDir, probeAppRunning: appClosed, entry: fixtureEntry() })
    expect(patched.ok).toBe(true)
    // Foreign drift on the session bundle: the patched text plus one appended
    // line — the presence marker survives (patched-drifted) while the op-list
    // reconstruction hash breaks (state drifted).
    const entry = fixtureEntry()
    const session = normalizeEntry(entry)[SESSION_INDEX]
    const driftedPatchedText = `${freshExtract(fixture.asarPath, session.targetPath).toString('utf8')}\n// foreign edit\n`
    spliceFace(fixture, SESSION_INDEX, driftedPatchedText)

    const status = await statusAsar({ appDir: fixture.appDir, probeAppRunning: appClosed, entry: fixtureEntry() })
    expect(status.patched).toBe(true)
    expect(status.patchSet).toMatchObject({ state: 'partial', totalFiles: 5, patchedFiles: 4, pristineFiles: 0, driftedFiles: 1 })
    const sessionRow = status.files?.find((file) => file.target.includes('dsh-session'))
    expect(sessionRow?.state).toBe('drifted')
    expect(sessionRow?.anchorHit).toBe('patched-drifted')
    expect(sessionRow?.guidance).toContain('restore from a backup')
  })

  it('P6B-R2: drifted priority — all-pristine is unpatched; any drift with NO patch presence is drifted', async () => {
    const fixture = await createMultiFixture()
    const pristine = await statusAsar({ appDir: fixture.appDir, probeAppRunning: appClosed, entry: fixtureEntry() })
    expect(pristine.patched).toBe(false)
    expect(pristine.patchSet).toMatchObject({ state: 'unpatched', totalFiles: 5, patchedFiles: 0, pristineFiles: 5, driftedFiles: 0 })

    // Official drift on one bundle (no patch presence anywhere): drifted.
    spliceFace(fixture, SESSION_INDEX, `${FIX_SESSION}\n// official update edit\n`)
    const status = await statusAsar({ appDir: fixture.appDir, probeAppRunning: appClosed, entry: fixtureEntry() })
    expect(status.patched).toBe(false)
    expect(status.patchSet).toMatchObject({ state: 'drifted', totalFiles: 5, patchedFiles: 0, pristineFiles: 4, driftedFiles: 1 })
    expect(status.files?.find((file) => file.target.includes('dsh-session'))?.anchorHit).toBe('official-drifted')
  })
})

function existsBackup(work: string): boolean {
  try {
    return readdirSync(join(work, 'zctx-backup')).length > 0
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// spliceAsarMulti witness accounting: a file positioned BETWEEN two targets
// shifts by the FIRST target's delta only (the summed-delta rule).
// ---------------------------------------------------------------------------

describe('spliceAsarMulti: between-target witness shift', () => {
  it('records the summed-delta shift per witness; the archive stays officially parseable', async () => {
    const fixture = await createMultiFixture()
    const entry = fixtureEntry()
    const files = normalizeEntry(entry)
    // Patch only the compaction-basic (index 3) and the pruner (index 4) —
    // every OTHER file is a witness of the shift semantics.
    const targets = [files[3], files[4]].map((file) => {
      const content = FIXTURE_CONTENTS[file.targetPath]
      return { targetPath: file.targetPath, patchedText: patchFile(content, file).text as string }
    })
    const spliced = spliceAsarMulti({ asarPath: fixture.asarPath, targets })
    expect(spliced.targets).toHaveLength(2)
    expect(spliced.witnesses.length).toBeGreaterThanOrEqual(1)
    expect(spliced.witnesses.every((witness) => witness.shift >= 0)).toBe(true)
    expect(spliced.witnesses.every((witness) => !targets.some((target) => target.targetPath === witness.path))).toBe(true)
    // The spliced buffer lands on disk; the archive stays officially
    // parseable and the spliced targets read back their patched text.
    writeFileSync(fixture.asarPath, spliced.buffer)
    asar.uncacheAll()
    for (const target of targets) {
      expect(freshExtract(fixture.asarPath, target.targetPath).toString('utf8')).toBe(target.patchedText)
    }
  })
})

// ---------------------------------------------------------------------------
// The INLINED REGION TEXTS run: the shipped bytes are imported as modules and
// exercised behaviorally (mock session / real wire-shaped bodies). Prelude
// bindings substitute the host bundle's own imports (createHash/LlmError in
// the wrapper region; SessionLogOffset in the observer region — its real
// shape is dsh-session's concern, the observer only forwards it).
// ---------------------------------------------------------------------------

/** The inlined region text of one file: the region op's replacement minus the embedded export anchor. */
function regionText(fileIndex: number, anchorPrefix: string): string {
  const rc3 = SUPPORTED['0.2.2-rc.3'] as ZctxPatchSetEntry
  const op = rc3.files[fileIndex].ops.find((candidate) => candidate.anchor.startsWith(anchorPrefix)) as { anchor: string; replacement: string }
  return op.replacement.slice(0, op.replacement.length - op.anchor.length - 1)
}

const REGION_A = regionText(0, 'export { Config')
const REGION_B = regionText(1, 'export { AgentLoop')

async function importRegion(source: string): Promise<Record<string, unknown>> {
  const url = `data:text/javascript;charset=utf-8,${encodeURIComponent(source)}`
  return await import(url)
}

interface MockSession {
  readonly seq: number
  readonly events: { type: string; data?: Record<string, unknown>; seq: number }[]
  readonly appended: { type: string; data: Record<string, unknown>; seq: number }[]
  append(type: string, data: Record<string, unknown>): { seq: number }
  snapshotEvents(from: unknown, to: unknown): { type: string; seq: number }[]
}

/**
 * Session mock with the real dsh-session seq semantics: events occupy
 * 0-based slots, `seq` is the NEXT slot (the append assigns it), and
 * snapshotEvents(from, to) reads [from, to).
 */
function makeMockSession(logEvents: string[] = []): MockSession {
  const events: { type: string; data?: Record<string, unknown>; seq: number }[] = logEvents.map((type) => ({ type, seq: 0 }))
  events.forEach((event, index) => {
    event.seq = index
  })
  let nextSeq = events.length
  const appended: { type: string; data: Record<string, unknown>; seq: number }[] = []
  return {
    get seq() {
      return nextSeq
    },
    events,
    appended,
    append(type, data) {
      const recordSeq = nextSeq
      nextSeq += 1
      events.push({ type, data, seq: recordSeq })
      appended.push({ type, data, seq: recordSeq })
      return { seq: recordSeq }
    },
    snapshotEvents(from, to) {
      const fromSeq = (from as { seq: number }).seq
      const toSeq = (to as { seq: number }).seq
      return events.filter((event) => event.seq >= fromSeq && event.seq < toSeq)
    },
  }
}

describe('inlined region B (agent-loop): GuardObserver + classifier behave', () => {
  async function load(): Promise<{ GuardObserver: new (session: MockSession, warn: (message: string) => void) => { observe(capture: Record<string, unknown>): void }; SessionLogOffset: unknown }> {
    const module = await importRegion([
      'const SessionLogOffset = (n) => ({ seq: n });',
      REGION_B,
      'export { GuardObserver };',
    ].join('\n'))
    return module as unknown as { GuardObserver: new (session: MockSession, warn: (message: string) => void) => { observe(capture: Record<string, unknown>): void }; SessionLogOffset: unknown }
  }

  const capture = (messageHashes: string[], meta = { provider: 'p', api: 'anthropic-messages', modelId: 'm', bodyBytes: 10 }) => ({
    schemaVersion: 1,
    attemptSeq: 1,
    wholeHash: `whole-${messageHashes.join('')}`,
    segments: { systemHash: 's', toolsHash: 't', messagesHash: `m-${messageHashes.join('')}`, messageHashes, messageKinds: messageHashes.map(() => 'normal') },
    meta,
  })

  it('RECORD_ONLY first record, then a monotonic append with the shared prefix measured', async () => {
    const { GuardObserver } = await load()
    const session = makeMockSession()
    const warns: string[] = []
    const observer = new GuardObserver(session, (message) => warns.push(message))
    observer.observe(capture(['a', 'b']))
    expect(session.appended).toHaveLength(1)
    expect(session.appended[0].type).toBe('cache/guard-observe')
    expect(session.appended[0].data.classified).toBe(true)
    expect(session.appended[0].data.monotonic).toBeUndefined()

    observer.observe(capture(['a', 'b', 'c']))
    expect(session.appended[0].data.monotonic).toBeUndefined()
    expect(session.appended[1].data.monotonic).toBe('ok')
    expect(session.appended[1].data.sharedPrefixCount).toBe(2)
    expect(warns).toHaveLength(0)
  })

  it('class2 strip keeps the chain monotonic and labels the record', async () => {
    const { GuardObserver } = await load()
    const session = makeMockSession()
    const observer = new GuardObserver(session, () => {})
    const withClass2 = capture(['a', 's2', 'b'])
    ;(withClass2.segments as { messageKinds: string[] }).messageKinds = ['normal', 'class2', 'normal']
    observer.observe(withClass2)
    // RECORD_ONLY: no chain compare, so no classId yet (class3 is the only
    // label the first record carries).
    expect(session.appended[0].data.classId).toBeUndefined()
    const keepsClass2 = capture(['a', 's2', 'b', 'c'])
    ;(keepsClass2.segments as { messageKinds: string[] }).messageKinds = ['normal', 'class2', 'normal', 'normal']
    observer.observe(keepsClass2)
    expect(session.appended[1].data.monotonic).toBe('ok')
    // The class2-labeled record carries the class2 label once the chain holds.
    expect(session.appended[1].data.classId).toBe('class2-effort-synth')
  })

  it('route change and compaction marks read as legal transitions (no chain compare)', async () => {
    const { GuardObserver } = await load()
    const session = makeMockSession()
    const observer = new GuardObserver(session, () => {})
    observer.observe(capture(['a']))
    observer.observe(capture(['x'], { provider: 'other', api: 'anthropic-messages', modelId: 'm2', bodyBytes: 10 }))
    expect(session.appended[1].data.transition).toEqual({ kind: 'route-change' })
    expect(session.appended[1].data.monotonic).toBe('ok-after-reset')

    // A compaction mark interleaved BETWEEN the two guard records bounds the
    // scan window (prev.seq, current] — mock seqs are 0-based slots. The
    // guard records are filtered out of the mock's mixed append list.
    const session2 = makeMockSession()
    const observer2 = new GuardObserver(session2, () => {})
    observer2.observe(capture(['a']))
    session2.append('compaction/start', {})
    observer2.observe(capture(['x']))
    const guardRecords2 = session2.appended.filter((record) => record.type === 'cache/guard-observe')
    expect(guardRecords2[1].data.transition).toEqual({ kind: 'compaction' })
    // Both compaction kinds fold to one coarse kind.
    const session3 = makeMockSession()
    const observer3 = new GuardObserver(session3, () => {})
    observer3.observe(capture(['a']))
    session3.append('compaction/end', {})
    session3.append('cache/ledger', {})
    observer3.observe(capture(['x']))
    const guardRecords3 = session3.appended.filter((record) => record.type === 'cache/guard-observe')
    expect(guardRecords3[1].data.transition).toEqual({ kind: 'compaction' })
  })

  it('unclassified rewrites warn once with the mismatch position and no action', async () => {
    const { GuardObserver } = await load()
    const session = makeMockSession()
    const warns: string[] = []
    const observer = new GuardObserver(session, (message) => warns.push(message))
    observer.observe(capture(['a', 'b']))
    observer.observe(capture(['a', 'REWRITTEN', 'c']))
    expect(session.appended[1].data.classified).toBe(false)
    expect(session.appended[1].data.monotonic).toBe('unclassified')
    expect(session.appended[1].data.sharedPrefixCount).toBe(1)
    expect(warns).toHaveLength(1)
    expect(warns[0]).toContain('unclassified wire form at attempt 1')
  })

  it('degraded captures log-only, set the gap, and the next segmented record carries chainGap', async () => {
    const { GuardObserver } = await load()
    const session = makeMockSession()
    const observer = new GuardObserver(session, () => {})
    observer.observe(capture(['a']))
    observer.observe({ schemaVersion: 1, attemptSeq: 2, degraded: { reason: 'parse-failed' }, meta: { provider: 'p', api: 'anthropic-messages', modelId: 'm', bodyBytes: 5 } })
    expect(session.appended[1].data.classified).toBe(false)
    expect(session.appended[1].data.degraded).toEqual({ reason: 'parse-failed' })
    expect(session.appended[1].data.wholeHash).toBeUndefined()
    observer.observe(capture(['a', 'b']))
    expect(session.appended[2].data.chainGap).toBe(true)
  })
})

describe('inlined region A (llm-pi-ai): wrapper capture ladder behaves', () => {
  interface RegionA {
    buildGuardSegments(params: Record<string, unknown>): { systemHash: string; toolsHash: string; messagesHash: string; messageHashes: string[]; messageKinds: string[] }
    recognizeMessageKind(message: unknown): string
    stripCacheControl(value: unknown): unknown
    createGuardFetchWrapper(args: { model: { provider: string; api: string; id: string }; sink: (capture: Record<string, unknown>) => void }): (input: unknown, init?: { body?: unknown }) => Promise<unknown>
    assertGuardObserveSupport(): void
  }
  async function load(): Promise<RegionA> {
    const module = await importRegion([
      'import { createHash } from "node:crypto";',
      'class LlmError extends Error { constructor(message, code) { super(message); this.code = code; } }',
      REGION_A,
      'export { buildGuardSegments, recognizeMessageKind, stripCacheControl, createGuardFetchWrapper, assertGuardObserveSupport };',
    ].join('\n'))
    return module as unknown as RegionA
  }

  it('E-0: cache_control is stripped before hashing — two bodies differing only there hash equal', async () => {
    const region = await load()
    const withCacheControl = {
      model: 'm',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hello', cache_control: { type: 'ephemeral' } }] }],
      system: [{ type: 'text', text: 'sys', cache_control: { type: 'ephemeral' } }],
      tools: [],
    }
    const without = JSON.parse(JSON.stringify(withCacheControl)) as typeof withCacheControl
    const strip = (blocks: { content: { cache_control?: unknown }[] }[]) => blocks
    void strip
    const a = region.buildGuardSegments(JSON.parse(JSON.stringify(withCacheControl)))
    const plain = JSON.parse(JSON.stringify(without))
    delete (plain.messages[0].content[0] as { cache_control?: unknown }).cache_control
    delete ((plain.system as { cache_control?: unknown }[])[0]).cache_control
    const b = region.buildGuardSegments(plain)
    expect(a.messagesHash).toBe(b.messagesHash)
    expect(a.systemHash).toBe(b.systemHash)
    expect(region.stripCacheControl({ a: 1, cache_control: { x: 1 }, nested: { cache_control: 2 } })).toEqual({ a: 1, nested: {} })
  })

  it('message kinds: class2 effort synth, class1 deferred reorder, class3 error images, else normal', async () => {
    const region = await load()
    expect(region.recognizeMessageKind({ role: 'system', content: [], output_config: { effort: 'high' } })).toBe('class2')
    expect(region.recognizeMessageKind({ role: 'system', content: [{ type: 'text' }, { type: 'tool_removal' }] })).toBe('class1')
    expect(region.recognizeMessageKind({
      role: 'user',
      content: [
        { type: 'tool_result' },
        { type: 'text', text: 'Images from the error result of tool call x' },
        { type: 'image' },
        { type: 'image' },
      ],
    })).toBe('class3')
    expect(region.recognizeMessageKind({ role: 'user', content: [{ type: 'text', text: 'plain' }] })).toBe('normal')
  })

  it('capture ladder: full segments → non-string A7-2 → parse-failed A7-1 → non-anthropic fallback; body never rewritten', async () => {
    const region = await load()
    const model = { provider: 'p', api: 'anthropic-messages', id: 'm' }
    const releases: { body: unknown }[] = []
    const realFetch = globalThis.fetch
    const fakeFetch = (async (input: unknown, init: unknown) => {
      releases.push({ body: (init as { body?: unknown } | undefined)?.body })
      return 'released'
    }) as unknown as typeof globalThis.fetch
    globalThis.fetch = fakeFetch
    try {
      const sinks: Record<string, unknown>[] = []
      const wrapper = region.createGuardFetchWrapper({ model, sink: (capture) => sinks.push(capture) })
      const full = JSON.stringify({ model: 'm', messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }], tools: [] })
      await wrapper('url', { body: full })
      await wrapper('url', { body: 12345 })
      await wrapper('url', { body: 'not json' })
      await wrapper('url', { body: JSON.stringify({ model: 'm' }), extra: 1 } as { body?: unknown })
      expect(sinks).toHaveLength(4)
      expect(sinks[0].segments).toBeDefined()
      expect(sinks[0].attemptSeq).toBe(1)
      expect(sinks[1]).toMatchObject({ attemptSeq: 2, degraded: { reason: 'non-string-body' } })
      expect(sinks[1].wholeHash).toBeUndefined()
      expect(sinks[2]).toMatchObject({ attemptSeq: 3, degraded: { reason: 'parse-failed' } })
      expect(typeof sinks[2].wholeHash).toBe('string')
      expect(sinks[3].segments).toBeUndefined()
      expect(typeof sinks[3].wholeHash).toBe('string')
      // R1 hash-then-passthrough: the released init.body is byte-identical.
      expect(releases[0].body).toBe(full)
      expect(releases).toHaveLength(4)
    } finally {
      globalThis.fetch = realFetch
    }
  })

  it('A6 adaptation: an unprobeable runtime (data: URL module) proceeds without throwing', async () => {
    const region = await load()
    expect(() => region.assertGuardObserveSupport()).not.toThrow()
  })
})
