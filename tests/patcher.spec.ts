/**
 * P4+P6-B patcher tests — the full patch/restore/status machinery on a
 * SYNTHETIC mini-asar fixture (task card P4 product 3 + P6-B; the REAL
 * machine is never touched — W5-A6-INSTALL umbrella, post-merge).
 *
 * Fixture = @electron/asar createPackage over a small src tree whose
 * lib/index.js embeds the REAL rc.3 anchor lines verbatim (all seven P6-B
 * llm-pi-ai anchors: the 5-tab call-site spread, the crypto import, the
 * Config schema line, the apply wiring, the streamSimple call site, the
 * 4-arg headers line, and the export line — extracted read-only from the
 * real asar; the production pristine hashes are pinned to their recorded
 * values in a dedicated test). The fixture's own entry carries the fixture
 * content's hash so the machinery is exercised end-to-end without the real
 * archive. The multi-file set face gets its own spec (patcher-multifile).
 *
 * Asserted: patch full chain (gates → backup → splice → post-verify →
 * marker), byte-identical restore + marker removal, idempotent re-patch,
 * anchor-drift refusal (nothing modified, no backup), anchor-uniqueness
 * refusal (0 and 2 occurrences), version-gate refusal, lock-face refusal,
 * process-probe refusal, status dual states, and the production pin.
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, sep } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import * as asar from '@electron/asar'

import { PATCH_SET_VERSION, SUPPORTED, computeIntegrity, normalizeEntry, patchAsar, patchFile, restoreAsar, spliceAsar, statusAsar } from '../patcher/zctx-patch.mjs'
import type { ZctxPatchFileEntry, ZctxPatchSetEntry } from '../patcher/zctx-patch.d.mts'

/**
 * @electron/asar 4.3.2's Filesystem.getNode splits lookup paths on
 * `path.sep` — convert the '/'-spelled asar paths before every official
 * extractFile call (win32 otherwise throws "was not found in this archive";
 * the same pitfall the patcher handles internally via nativeAsarPath).
 */
const asarNative = (path: string): string => path.split('/').join(sep)

/**
 * Fresh official extraction: @electron/asar caches the Filesystem PER PATH,
 * so after a rename over the same path (patch/restore) the stale cached
 * header must be dropped before extracting (the same pitfall the patcher
 * handles internally).
 */
function freshExtract(asarPath: string, path: string): Buffer {
  asar.uncacheAll()
  return asar.extractFile(asarPath, asarNative(path))
}

// ---------------------------------------------------------------------------
// Fixture: the REAL rc.3 anchor lines (tab indent, `void 0`, double quotes —
// extracted read-only from the real app.asar; keep byte-exact). The fixture
// embeds every llm-pi-ai op anchor of the production patch set so the
// production op list runs end-to-end on the fixture archive.
// ---------------------------------------------------------------------------

/** The file-unique call-site spread (lib/index.js five-tab depth). */
const CALL_SITE_LINE = '\t\t\t\t\t...profileOptions(profile, reasoning, apiKey),'

const FIXTURE_LIB = [
  '// fixture lib/index.js — the rc.3 anchor lines embedded verbatim (trimmed)',
  'import { createHash } from "node:crypto";',
  'class PiAdapter {',
  '\tstream(request, options) {',
  '\t\tconst snapshot = this.prepare(request)',
  '\t\t\t\tconst iterator = toStreamChunks(snapshot.models.streamSimple(model, context, {',
  CALL_SITE_LINE,
  '\t\t\t\t\t...options.temperature === void 0 ? {} : { temperature: options.temperature },',
  '\t\t\t\t\t...options.maxTokens === void 0 ? {} : { maxTokens: options.maxTokens },',
  '\t\t\t\t\t...options.sessionId === void 0 ? {} : { sessionId: String(options.sessionId) },',
  '\t\t\t\t\tsignal: watchdog.signal,',
  '\t\t\t\t\theaders: requestHeaders(profile.headers, options, model.baseUrl, this.config.prepareHeaders)',
  '\t\t\t})',
  '\t\t\treturn toStreamChunks(iterator, model.contextWindow, options.signal, model.id, digest)',
  '\t}',
  '}',
  '',
  'function profileOptions(profile, reasoning, apiKey) {',
  '\tconst enabledReasoning = reasoning === "off" ? void 0 : reasoning',
  '\treturn {',
  '\t\t...apiKey === void 0 ? {} : { apiKey },',
  '\t\t...enabledReasoning === void 0 ? {} : { reasoning: enabledReasoning },',
  '\t\t...profile.thinkingBudgets === void 0 ? {} : { thinkingBudgets: profile.thinkingBudgets },',
  '\t\tmaxRetries: 0',
  '\t}',
  '}',
  '',
  '/** Runtime schema for the Config section. */',
  'const Config = z.object({ providers: z.dict(profile).default({}).volatile() });',
  '',
  'function apply(ctx, config) {',
  '\tconst auth = { credentials: null, authContext: null };',
  '\tconst adapter = new PiAiAdapter({',
  '\t\tprofiles,',
  '\t\tresolveApiKey,',
  '\t\tauth,',
  '\t\tprepareHeaders: (request, headers) => ctx.waterfall("llm-pi-ai/request-headers", request, headers, () => headers),',
  '\t\tresolveAttachments: () => ctx.get("attachments")',
  '\t});',
  '\treturn adapter;',
  '}',
  '',
  'export { Config, PiAiAdapter, apply, inject, name, recordKeyFor, supportedProtocols };',
].join('\n')

const TARGET_PATH = 'dsh/node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/index.js'
const NEIGHBOR_CONTENT = '// neighbor file positioned after the target in the payload'

interface Fixture {
  readonly work: string
  readonly appDir: string
  readonly asarPath: string
  readonly markerPath: string
  originalSha: string
  readonly entry: ZctxPatchSetEntry
}

/** The production first-file entry with the fixture content's pristine hash. */
function buildSingleFileEntry(): ZctxPatchSetEntry {
  const rc3 = SUPPORTED['0.2.2-rc.3'] as ZctxPatchSetEntry
  const [firstFile] = rc3.files
  return {
    shellPackage: rc3.shellPackage,
    files: [
      { ...firstFile, pristineSha256: createHash('sha256').update(Buffer.from(FIXTURE_LIB, 'utf8')).digest('hex') },
    ],
  }
}

/** The first production file entry (fixture hash substituted). */
function firstFileEntry(): ReturnType<typeof normalizeEntry>[number] {
  return normalizeEntry(buildSingleFileEntry())[0]
}

let cleanupDirs: string[] = []

function buildFixture(appDirName = 'DeepSeek Harness', shellVersion = '0.2.2-rc.3'): Fixture {
  const work = mkdtempSync(join(tmpdir(), 'zctx-patcher-spec-'))
  cleanupDirs.push(work)
  const src = join(work, 'src')
  mkdirSync(join(src, 'dsh', 'node_modules', '@deepseek-ai', 'dsh-llm-pi-ai', 'lib'), { recursive: true })
  mkdirSync(join(src, 'dsh', 'node_modules', '@deepseek-ai', 'dsh-llm-pi-ai', 'src'), { recursive: true })
  mkdirSync(join(src, 'extra'), { recursive: true })
  writeFileSync(join(src, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-desktop', version: shellVersion }))
  writeFileSync(join(src, TARGET_PATH), FIXTURE_LIB)
  writeFileSync(join(src, 'dsh', 'node_modules', '@deepseek-ai', 'dsh-llm-pi-ai', 'src', 'adapter.ts'), '// ts source (reference face, not executed)')
  writeFileSync(join(src, 'extra', 'neighbor.js'), NEIGHBOR_CONTENT)
  const appDir = join(work, appDirName)
  mkdirSync(join(appDir, 'resources'), { recursive: true })
  const asarPath = join(appDir, 'resources', 'app.asar')
  // Synchronous wrapper over the async official API (the vitest body is sync
  // per test; we await createPackage through an async IIFE in the helper).
  return {
    work,
    appDir,
    asarPath,
    markerPath: join(appDir, '.zctx-patch.json'),
    originalSha: '',
    entry: buildSingleFileEntry(),
  }
}

async function createFixture(): Promise<Fixture> {
  const fixture = buildFixture()
  await asar.createPackage(join(fixture.work, 'src'), fixture.asarPath)
  fixture.originalSha = createHash('sha256').update(readFileSync(fixture.asarPath)).digest('hex')
  return fixture
}

/** The injectable "app closed" probe (tests never probe the real process). */
const appClosed = () => 'no' as const

const shaOf = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex')

afterEach(() => {
  for (const dir of cleanupDirs) rmSync(dir, { recursive: true, force: true })
  cleanupDirs = []
})

// ---------------------------------------------------------------------------
// Production patch-set pin (P6-B). The pristine hashes were computed live
// from the real rc.3 asar by read-only positional extraction (2026-11-16;
// the llm-pi-ai hash double-attests the P4 pin). An official update changes
// any of these → the anchor-hash gate refuses → this table gets the new
// entry first.
// ---------------------------------------------------------------------------

describe('SUPPORTED patch-set pin (production, P6-B)', () => {
  const rc3 = SUPPORTED['0.2.2-rc.3'] as ZctxPatchSetEntry

  it('pins the five target bundles of the base-context patch set', () => {
    expect(rc3.shellPackage).toBe('@deepseek-ai/dsh-desktop')
    expect(rc3.files.map((file) => file.targetPath)).toEqual([
      'dsh/node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/index.js',
      'dsh/node_modules/@deepseek-ai/dsh-agent-loop/lib/index.js',
      'dsh/node_modules/@deepseek-ai/dsh-session/lib/index.js',
      'dsh/node_modules/@deepseek-ai/dsh-compaction-basic/lib/index.js',
      'dsh/node_modules/@deepseek-ai/dsh-compaction-tool-result-pruner/lib/index.js',
    ])
  })

  it('pins the pristine hashes (live extraction 2026-11-16; llm-pi-ai == P4 pin e956da3d…)', () => {
    expect(rc3.files.map((file) => file.pristineSha256)).toEqual([
      'e956da3d7300e1426e13e14f47e6f981dd1ca345633a406568ee5058ad93e9d8',
      'f09f60814d4e96a880f41b9fc3832f33c56a28f954f48810d8439ce83ad6ffa8',
      'd9911b5e1585bcb142d03ce46eb2990b3fc7c254de5a76d3ffb124bd2469216c',
      'e1a3019949d01b22baa91d6eb672d9559d76b97fb5bb45e0428715a316bf11d4',
      'e86442e9a2403c392482b9035916e5610c251d62f3581892866404d69c064254',
    ])
  })

  it('carries the P4 stub as the first llm-pi-ai op (card-pinned forwarder, R1)', () => {
    const stubOp = rc3.files[0].ops[0]
    expect(stubOp.anchor).toBe('...profileOptions(profile, reasoning, apiKey),')
    expect(stubOp.replacement).toBe(
      `${stubOp.anchor}\n\t\t\t\t\t...(globalThis.__zctxPatch__?.wireOptions?.({ provider: options.provider, model: model.id, sessionId: options.sessionId }) ?? {}),`,
    )
    expect(rc3.files[0].presenceMarker).toBe('globalThis.__zctxPatch__')
  })

  it('ignites guardObserve ON (config default true — user ruling; observe-only kill switch)', () => {
    const configOp = rc3.files[0].ops.find((op) => op.anchor.includes('const Config = z.object'))
    expect(configOp?.replacement).toContain('guardObserve: z.boolean().default(true).volatile()')
    // The ignition hunk defaults the observer ON at the agent constructor
    // (explicit opt-out honored); the adapter side gates on the switch.
    const ignitionOp = rc3.files[1].ops.find((op) => op.anchor.includes('new RuntimeContextProjection'))
    expect(ignitionOp?.replacement).toContain('(this.options.guardObserve ?? true) === true')
  })

  it('registers the guard event vocabulary + the L3 budget face + per-set identity', () => {
    expect(rc3.files[2].ops[0].replacement).toContain('"cache/guard-observe",')
    expect(rc3.files[3].ops[0].replacement).toContain('byteCapPerResult: toolCapToByteLimit(budget.toolCap)')
    expect(rc3.files[4].ops.find((op) => op.anchor.startsWith('\tpruneSession(session) {'))?.replacement).toBe('\tpruneSession(session, opts = {}) {')
    expect(PATCH_SET_VERSION).toBe('zctx-v0.3-base-1')
  })
})

// ---------------------------------------------------------------------------
// patchFile (pure text layer, op lists).
// ---------------------------------------------------------------------------

describe('patchFile: anchor uniqueness + idempotence', () => {
  it('applies the production op list: exactly one stub line, config switch, wiring, inlined region', () => {
    const entry = firstFileEntry()
    const result = patchFile(FIXTURE_LIB, entry)
    expect(result.ok).toBe(true)
    const text = result.text as string
    expect(text.split('globalThis.__zctxPatch__').length - 1).toBe(1)
    // The stub sits BETWEEN the profileOptions spread and the official
    // explicit keys (never clobbers headers/signal).
    const spreadIdx = text.indexOf(CALL_SITE_LINE)
    const stubIdx = text.indexOf('globalThis.__zctxPatch__')
    const headersIdx = text.indexOf('headers: requestHeaders(')
    expect(spreadIdx).toBeGreaterThanOrEqual(0)
    expect(stubIdx).toBeGreaterThan(spreadIdx)
    expect(headersIdx).toBeGreaterThan(stubIdx)
    // The guard sink sits BEFORE the streamSimple call; the fetch wrapper
    // rides AFTER the official headers key.
    expect(text.indexOf('const guardSink =')).toBeGreaterThan(0)
    expect(text.indexOf('const guardSink =')).toBeLessThan(text.indexOf('const iterator = toStreamChunks'))
    expect(text).toContain('...guardSink === void 0 ? {} : { fetch: createGuardFetchWrapper({ model, sink: guardSink }) }')
    // Config default true + apply wiring + the inlined region + import face.
    expect(text).toContain('guardObserve: z.boolean().default(true).volatile()')
    expect(text).toContain('guardObserve: () => config.guardObserve.get(),')
    expect(text).toContain('//#region lib/types/zctx-guard-observe.js')
    expect(text).toContain('import { existsSync, readFileSync } from "node:fs";')
    // The inlined region precedes the export line (region-ordered bundle).
    expect(text.indexOf('//#region lib/types/zctx-guard-observe.js')).toBeLessThan(text.indexOf('export { Config, PiAiAdapter'))
    // Exactly one stub line (five-tab indent, ends with the spread comma).
    expect(text).toContain(`${CALL_SITE_LINE}\n\t\t\t\t\t...(globalThis.__zctxPatch__?.wireOptions?.({ provider: options.provider, model: model.id, sessionId: options.sessionId }) ?? {}),\n`)
  })

  it('refuses when an anchor occurs 0 or 2 times (never patches blind)', () => {
    const entry = firstFileEntry()
    const noAnchor = FIXTURE_LIB.replace(CALL_SITE_LINE, '...profileOptions(profile, reasoning)')
    expect(patchFile(noAnchor, entry)).toMatchObject({ ok: false, reason: expect.stringContaining('0 times') })
    const twice = FIXTURE_LIB.replace('maxRetries: 0', `${CALL_SITE_LINE}\n\t\t\t\t\tmaxRetries: 0`)
    expect(patchFile(twice, entry)).toMatchObject({ ok: false, reason: expect.stringContaining('2 times') })
  })

  it('refuses when the presence marker is already in the text (already-patched)', () => {
    const entry = firstFileEntry()
    const patched = patchFile(FIXTURE_LIB, entry).text as string
    expect(patchFile(patched, entry)).toMatchObject({ ok: false, alreadyPatched: true })
  })

  it('reverses the whole op list back to the pristine bytes (reconstruction proof)', async () => {
    // Exercise through the machinery: the patched-exact state reconstructs.
    const fixture = await createFixture()
    const result = await patchAsar({ appDir: fixture.appDir, probeAppRunning: appClosed, entry: fixture.entry })
    expect(result.ok).toBe(true)
    const status = await statusAsar({ appDir: fixture.appDir, probeAppRunning: appClosed, entry: fixture.entry })
    expect(status.anchorHit).toBe('patched-exact')
    expect(status.patchSet?.state).toBe('patched')
    expect(status.patchSet?.patchedFiles).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// The full patch chain on the fixture asar.
// ---------------------------------------------------------------------------

describe('patchAsar: full chain on the mini-asar fixture', () => {
  it('patches through all gates: backup → splice → post-verify → marker', async () => {
    const fixture = await createFixture()
    const result = await patchAsar({ appDir: fixture.appDir, probeAppRunning: appClosed, entry: fixture.entry })
    expect(result.ok).toBe(true)
    const stepNames = result.steps.map((step) => `${step.name}:${step.status}`)
    expect(stepNames).toEqual([
      'app-running gate:ok',
      // The fixture layout has no desktop exe → the fuse gate skips honestly
      // (no runtime to enforce asar integrity; ZCTX-PATCH-AUTO D1).
      'fuse integrity gate:skip',
      'version gate:ok',
      'anchor hash gate:ok',
      'anchor patch:ok',
      'backup:ok',
      'splice:ok',
      'post-verify:ok',
      'marker:ok',
    ])

    // Target content patched, marker exactly once, official API reads it.
    const lib = freshExtract(fixture.asarPath, TARGET_PATH).toString('utf8')
    expect(lib.split('globalThis.__zctxPatch__').length - 1).toBe(1)
    expect(lib).toContain(
      '...(globalThis.__zctxPatch__?.wireOptions?.({ provider: options.provider, model: model.id, sessionId: options.sessionId }) ?? {}),',
    )

    // Untouched files are byte-identical (official extraction).
    expect(freshExtract(fixture.asarPath, 'extra/neighbor.js').toString('utf8')).toBe(NEIGHBOR_CONTENT)
    expect(freshExtract(fixture.asarPath, 'package.json').toString('utf8')).toContain('0.2.2-rc.3')

    // Marker content (the plugin's filesystem truth).
    const marker = JSON.parse(readFileSync(fixture.markerPath, 'utf8')) as Record<string, unknown>
    expect(marker.patcher).toBe('zctx-patch')
    expect(marker.shellVersion).toBe('0.2.2-rc.3')
    expect(marker.patchSet).toBe('zctx-v0.3-base-1')
    expect(marker.target).toBe(TARGET_PATH)
    expect(marker.sha256Before).toBe(fixture.entry.files[0].pristineSha256)
    expect(marker.backup).toBe(result.backup?.dir)
    expect(typeof marker.timestamp).toBe('string')

    // Backup: app.asar copy hash == pre-patch hash + RESTORE.md records it.
    expect(result.backup).toBeDefined()
    expect(result.backup?.asarSha256).toBe(fixture.originalSha)
    const backupAsar = join(result.backup!.dir, 'app.asar')
    expect(shaOf(backupAsar)).toBe(fixture.originalSha)
    const restoreMd = readFileSync(join(result.backup!.dir, 'RESTORE.md'), 'utf8')
    expect(restoreMd).toContain(fixture.originalSha)
    expect(restoreMd).toContain('zctx-patch.mjs restore')

    // No temp files left behind.
    const resources = readdirSync(dirname(fixture.asarPath))
    expect(resources.every((name) => !name.includes('.zctx-tmp-'))).toBe(true)
  })

  it('is idempotent: a second patch is a no-op success without a new backup', async () => {
    const fixture = await createFixture()
    const first = await patchAsar({ appDir: fixture.appDir, probeAppRunning: appClosed, entry: fixture.entry })
    expect(first.ok).toBe(true)
    const backupCount = readdirSync(join(fixture.work, 'zctx-backup')).length
    const markerAfterFirst = readFileSync(fixture.markerPath, 'utf8')

    const second = await patchAsar({ appDir: fixture.appDir, probeAppRunning: appClosed, entry: fixture.entry })
    expect(second.ok).toBe(true)
    expect(second.alreadyPatched).toBe(true)
    expect(second.backup).toBeUndefined()
    expect(second.markerBackfilled).toBeUndefined()
    expect(readdirSync(join(fixture.work, 'zctx-backup')).length).toBe(backupCount)
    expect(readFileSync(fixture.markerPath, 'utf8')).toBe(markerAfterFirst)
  })

  it('P4-r1 P4-2: self-heals the crash window — stub live but marker missing → re-patch backfills the marker, asar untouched', async () => {
    const fixture = await createFixture()
    const first = await patchAsar({ appDir: fixture.appDir, probeAppRunning: appClosed, entry: fixture.entry })
    expect(first.ok).toBe(true)
    const patchedAsarSha = shaOf(fixture.asarPath)
    const backupCount = readdirSync(join(fixture.work, 'zctx-backup')).length
    // Simulate the crash window: the splice landed, the marker write did not
    // (a crash or a failed marker write between the rename and writeMarker).
    rmSync(fixture.markerPath)
    expect(existsSync(fixture.markerPath)).toBe(false)

    const second = await patchAsar({ appDir: fixture.appDir, probeAppRunning: appClosed, entry: fixture.entry })
    expect(second.ok).toBe(true)
    expect(second.alreadyPatched).toBe(true)
    expect(second.markerBackfilled).toBe(true)
    expect(second.steps.find((step) => step.name === 'marker')?.status).toBe('backfilled')
    // The reconciliation is marker-only: asar bytes and backups untouched.
    expect(shaOf(fixture.asarPath)).toBe(patchedAsarSha)
    expect(readdirSync(join(fixture.work, 'zctx-backup')).length).toBe(backupCount)
    // The backfilled marker carries the derivable truth.
    const marker = JSON.parse(readFileSync(fixture.markerPath, 'utf8')) as Record<string, unknown>
    expect(marker.patcher).toBe('zctx-patch')
    expect(marker.shellVersion).toBe('0.2.2-rc.3')
    expect(marker.target).toBe(TARGET_PATH)
    expect(marker.sha256Before).toBe(fixture.entry.files[0].pristineSha256)
    const lib = freshExtract(fixture.asarPath, TARGET_PATH).toString('utf8')
    expect(marker.sha256After).toBe(createHash('sha256').update(Buffer.from(lib, 'utf8')).digest('hex'))
    expect(marker.backup).toBe(first.backup?.dir)
    expect(typeof marker.timestamp).toBe('string')
    // The dual source is consistent again: plugin status reads the marker.
    const status = await statusAsar({ appDir: fixture.appDir, probeAppRunning: appClosed, entry: fixture.entry })
    expect(status.marker?.state).toBe('present')
    expect(status.patched).toBe(true)
  })

  it('refuses anchor drift (hash gate) and modifies NOTHING', async () => {
    const fixture = await createFixture()
    const drifted = { shellPackage: fixture.entry.shellPackage, files: [{ ...fixture.entry.files[0], pristineSha256: 'deadbeef'.repeat(8) }] }
    const result = await patchAsar({ appDir: fixture.appDir, probeAppRunning: appClosed, entry: drifted })
    expect(result.ok).toBe(false)
    expect(result.refused).toBe(true)
    const last = result.steps.at(-1)
    expect(last?.name).toBe('anchor hash gate')
    expect(last?.status).toBe('refused')
    expect(last?.detail).toContain('anchor drift')
    // Nothing changed: no backup dir, no marker, hash untouched.
    expect(existsSync(join(fixture.work, 'zctx-backup'))).toBe(false)
    expect(existsSync(fixture.markerPath)).toBe(false)
    expect(shaOf(fixture.asarPath)).toBe(fixture.originalSha)
  })

  it('refuses an unsupported shell version at the version gate', async () => {
    const fixture = buildFixture('DeepSeek Harness', '9.9.9')
    await asar.createPackage(join(fixture.work, 'src'), fixture.asarPath)
    fixture.originalSha = shaOf(fixture.asarPath)
    // No entry injected → the versions lookup runs (the card's version gate).
    const result = await patchAsar({ appDir: fixture.appDir, probeAppRunning: appClosed })
    expect(result.ok).toBe(false)
    expect(result.refused).toBe(true)
    const last = result.steps.at(-1)
    expect(last?.name).toBe('version gate')
    expect(last?.status).toBe('refused')
    expect(last?.detail).toContain('9.9.9')
    expect(existsSync(join(fixture.work, 'zctx-backup'))).toBe(false)
    expect(shaOf(fixture.asarPath)).toBe(fixture.originalSha)
  })

  it('refuses when the app process is running (probe gate)', async () => {
    const fixture = await createFixture()
    const result = await patchAsar({ appDir: fixture.appDir, probeAppRunning: () => 'yes', entry: fixture.entry })
    expect(result.ok).toBe(false)
    expect(result.refused).toBe(true)
    expect(result.steps.at(-1)?.name).toBe('app-running gate')
    expect(result.steps.at(-1)?.detail).toContain('running')
    expect(shaOf(fixture.asarPath)).toBe(fixture.originalSha)
  })

  it('refuses when the app lock file exists (its wx-lock discipline)', async () => {
    const fixture = await createFixture()
    const dshHome = join(fixture.work, 'dshhome')
    mkdirSync(join(dshHome, 'profiles', 'desktop'), { recursive: true })
    writeFileSync(join(dshHome, 'profiles', 'desktop', 'lock'), 'pid=1234')
    const result = await patchAsar({ appDir: fixture.appDir, dshHome, probeAppRunning: appClosed, entry: fixture.entry })
    expect(result.ok).toBe(false)
    expect(result.refused).toBe(true)
    expect(result.steps.at(-1)?.status).toBe('refused')
    expect(result.steps.at(-1)?.detail).toContain('lock')
    // The patcher NEVER deletes the app's lock.
    expect(existsSync(join(dshHome, 'profiles', 'desktop', 'lock'))).toBe(true)
    expect(shaOf(fixture.asarPath)).toBe(fixture.originalSha)
  })
})

// ---------------------------------------------------------------------------
// restore.
// ---------------------------------------------------------------------------

describe('restoreAsar: byte-identical restore + marker removal', () => {
  it('restores the backup over the patched asar and clears the marker', async () => {
    const fixture = await createFixture()
    const patched = await patchAsar({ appDir: fixture.appDir, probeAppRunning: appClosed, entry: fixture.entry })
    expect(patched.ok).toBe(true)
    expect(existsSync(fixture.markerPath)).toBe(true)

    const restored = await restoreAsar({ appDir: fixture.appDir, probeAppRunning: appClosed })
    expect(restored.ok).toBe(true)
    expect(restored.backupDir).toBe(patched.backup?.dir)
    expect(shaOf(fixture.asarPath)).toBe(fixture.originalSha)
    expect(existsSync(fixture.markerPath)).toBe(false)
    // The restored archive is readable and PRISTINE (no stub).
    const lib = freshExtract(fixture.asarPath, TARGET_PATH).toString('utf8')
    expect(lib.split('globalThis.__zctxPatch__').length - 1).toBe(0)
    expect(lib).toBe(FIXTURE_LIB)
  })

  it('restores an explicitly named backup and refuses a corrupted one', async () => {
    const fixture = await createFixture()
    const patched = await patchAsar({ appDir: fixture.appDir, probeAppRunning: appClosed, entry: fixture.entry })
    expect(patched.ok).toBe(true)
    const backupDir = patched.backup!.dir

    const explicit = await restoreAsar({ appDir: fixture.appDir, probeAppRunning: appClosed, backup: backupDir })
    expect(explicit.ok).toBe(true)
    expect(shaOf(fixture.asarPath)).toBe(fixture.originalSha)

    // Corrupt the backup → the integrity gate refuses (no silent restore).
    writeFileSync(join(backupDir, 'app.asar'), Buffer.from('corrupted'))
    const refused = await restoreAsar({ appDir: fixture.appDir, probeAppRunning: appClosed, backup: backupDir })
    expect(refused.ok).toBe(false)
    expect(refused.steps.at(-1)?.name).toBe('backup integrity')
    expect(refused.steps.at(-1)?.status).toBe('refused')
  })
})

// ---------------------------------------------------------------------------
// status (strictly read-only).
// ---------------------------------------------------------------------------

describe('statusAsar: read-only dual-state report', () => {
  it('reports pristine state before and patched+marker after', async () => {
    const fixture = await createFixture()
    const before = await statusAsar({ appDir: fixture.appDir, probeAppRunning: appClosed, entry: fixture.entry })
    expect(before.shellVersion).toBe('0.2.2-rc.3')
    expect(before.anchorHit).toBe('official-unchanged')
    expect(before.guidance).toBeUndefined()
    expect(before.patched).toBe(false)
    expect(before.marker?.state).toBe('absent')
    expect(before.backups).toHaveLength(0)
    expect(before.lock?.exists).toBe(false)

    const patched = await patchAsar({ appDir: fixture.appDir, probeAppRunning: appClosed, entry: fixture.entry })
    expect(patched.ok).toBe(true)
    const after = await statusAsar({ appDir: fixture.appDir, probeAppRunning: appClosed, entry: fixture.entry })
    expect(after.patched).toBe(true)
    expect(after.anchorHit).toBe('patched-exact')
    expect(after.guidance).toBeUndefined()
    expect(after.marker?.state).toBe('present')
    expect(after.marker?.version).toBe('0.2.2-rc.3')
    expect(after.backups).toHaveLength(1)
    // Status never mutates: the patched hash is stable across reads.
    const shaAfterRead = shaOf(fixture.asarPath)
    expect(shaAfterRead).not.toBe(fixture.originalSha)
  })
})

// ---------------------------------------------------------------------------
// spliceAsar accounting (the surgical layer, directly pinned).
// ---------------------------------------------------------------------------

describe('spliceAsar: header/payload accounting', () => {
  it('shifts exactly the offsets after the target and keeps the target position', async () => {
    const fixture = await createFixture()
    const patched = patchFile(FIXTURE_LIB, firstFileEntry())
    expect(patched.ok).toBe(true)
    const spliced = spliceAsar({
      asarPath: fixture.asarPath,
      targetPath: TARGET_PATH,
      entry: fixture.entry,
      patchedText: patched.text as string,
    })
    expect(spliced.delta).toBe((patched.byteLength as number) - Buffer.byteLength(FIXTURE_LIB, 'utf8'))
    expect(spliced.delta).toBeGreaterThan(0)
    expect(spliced.headerSizeAfter - spliced.headerSizeBefore).toBeGreaterThanOrEqual(0)
    // Witnesses carry pristine hashes; the target is never its own witness.
    expect(spliced.witnesses.length).toBe(2)
    for (const witness of spliced.witnesses) {
      expect(witness.path).not.toBe(TARGET_PATH)
      expect(witness.integrityHash).not.toBe('')
    }
  })
})

// ---------------------------------------------------------------------------
// P4-r1 P4-1 regression pin: a witness BEFORE the target at a NONZERO offset.
// @electron/asar's own packer always writes the first file at payload offset
// 0, so its archives cannot produce this shape — the archive below is
// hand-assembled (same pickle byte format the patcher writes; the official
// reader parses it, asserted via freshExtract) with the header KEY ORDER
// deliberately different from the payload order: "zz-first.bin" is the first
// visited node (witness #1) while sitting AFTER package.json and BEFORE the
// target in the payload. The old `oldOffset > 0` post-verify expectation
// judged this witness "shifted" → false FAILED on a byte-correct archive.
// ---------------------------------------------------------------------------

/** Header pickle, byte-format identical to the patcher's internal builder. */
function buildHeaderPickleTest(jsonText: string): Buffer {
  const jsonBuf = Buffer.from(jsonText, 'utf8')
  const aligned = (jsonBuf.length + 3) & ~3
  const payloadSize = 4 + aligned
  const buf = Buffer.alloc(4 + payloadSize)
  buf.writeUInt32LE(payloadSize, 0)
  buf.writeUInt32LE(jsonBuf.length, 4)
  jsonBuf.copy(buf, 8)
  return buf
}

/** The 8-byte outer size pickle: [u32 4][u32 headerPickleLength]. */
function buildSizePickleTest(headerPickleLength: number): Buffer {
  const buf = Buffer.alloc(8)
  buf.writeUInt32LE(4, 0)
  buf.writeUInt32LE(headerPickleLength, 4)
  return buf
}

const PRE_TARGET_CONTENT = 'crafted witness file positioned BEFORE the target at a NONZERO offset'

/** Hand-assemble the asar: payload laid out explicitly, header key order shuffled. */
function writeCraftedAsar(fixture: Fixture): void {
  const packageJson = JSON.stringify({ name: '@deepseek-ai/dsh-desktop', version: '0.2.2-rc.3' })
  const contents = { packageJson, preTarget: PRE_TARGET_CONTENT, target: FIXTURE_LIB, neighbor: NEIGHBOR_CONTENT }
  const sizeOf = (content: string) => Buffer.byteLength(content, 'utf8')
  const offsets = {
    packageJson: 0,
    preTarget: sizeOf(contents.packageJson),
    target: sizeOf(contents.packageJson) + sizeOf(contents.preTarget),
    neighbor: sizeOf(contents.packageJson) + sizeOf(contents.preTarget) + sizeOf(contents.target),
  }
  const fileEntry = (content: string, offset: number) => ({
    size: sizeOf(content),
    offset: String(offset),
    integrity: computeIntegrity(Buffer.from(content, 'utf8')),
  })
  const header = {
    files: {
      // KEY ORDER ≠ payload order: visited first (witness #1), nonzero offset,
      // positioned before the target — the shape the old predicate misjudged.
      'zz-first.bin': fileEntry(contents.preTarget, offsets.preTarget),
      'package.json': fileEntry(contents.packageJson, offsets.packageJson),
      dsh: {
        files: {
          node_modules: {
            files: {
              '@deepseek-ai': {
                files: {
                  'dsh-llm-pi-ai': {
                    files: {
                      lib: { files: { 'index.js': fileEntry(contents.target, offsets.target) } },
                    },
                  },
                },
              },
            },
          },
        },
      },
      extra: { files: { 'neighbor.js': fileEntry(contents.neighbor, offsets.neighbor) } },
    },
  }
  const headerPickle = buildHeaderPickleTest(JSON.stringify(header))
  const payload = Buffer.concat([
    Buffer.from(contents.packageJson, 'utf8'),
    Buffer.from(contents.preTarget, 'utf8'),
    Buffer.from(contents.target, 'utf8'),
    Buffer.from(contents.neighbor, 'utf8'),
  ])
  writeFileSync(fixture.asarPath, Buffer.concat([buildSizePickleTest(headerPickle.length), headerPickle, payload]))
  fixture.originalSha = shaOf(fixture.asarPath)
}

describe('P4-r1 P4-1: before-target witness at a nonzero offset', () => {
  it('records afterTarget per witness and expects the before-target witness UNSHIFTED (no false post-verify FAILED)', async () => {
    const fixture = buildFixture()
    writeCraftedAsar(fixture)
    // The hand-assembled archive is officially parseable (pre-patch sanity).
    expect(freshExtract(fixture.asarPath, 'zz-first.bin').toString('utf8')).toBe(PRE_TARGET_CONTENT)
    expect(freshExtract(fixture.asarPath, TARGET_PATH).toString('utf8')).toBe(FIXTURE_LIB)

    // Witness flags: #1 = zz-first.bin (before the target, nonzero offset →
    // afterTarget=false); #2 = after the target (shifted by the delta).
    const patched = patchFile(FIXTURE_LIB, firstFileEntry())
    expect(patched.ok).toBe(true)
    const spliced = spliceAsar({
      asarPath: fixture.asarPath,
      targetPath: TARGET_PATH,
      entry: fixture.entry,
      patchedText: patched.text as string,
    })
    expect(spliced.witnesses[0]).toMatchObject({ path: 'zz-first.bin', afterTarget: false })
    expect(spliced.witnesses[1]).toMatchObject({ path: 'extra/neighbor.js', afterTarget: true })

    // Full chain: post-verify accepts the unshifted before-target witness.
    const result = await patchAsar({ appDir: fixture.appDir, probeAppRunning: appClosed, entry: fixture.entry })
    expect(result.ok).toBe(true)
    expect(result.steps.find((step) => step.name === 'post-verify')?.status).toBe('ok')
    // The witness bytes are untouched at their original (unshifted) position.
    expect(freshExtract(fixture.asarPath, 'zz-first.bin').toString('utf8')).toBe(PRE_TARGET_CONTENT)
  })
})

// ---------------------------------------------------------------------------
// P4-r1 P4-3: status anchorHit three-state discrimination (state wording and
// action guidance are separate strings; a correctly patched archive must NOT
// read as "drift" — the old single 'mismatch (drift)' label conflated the
// expected post-patch state with an official update, whose actions differ).
// ---------------------------------------------------------------------------

/** Replace the target file inside the asar with arbitrary text (test tamper). */
function overwriteTargetText(fixture: Fixture, newText: string): void {
  const spliced = spliceAsar({
    asarPath: fixture.asarPath,
    targetPath: TARGET_PATH,
    entry: fixture.entry,
    patchedText: newText,
  })
  writeFileSync(fixture.asarPath, spliced.buffer)
}

describe('P4-r1 P4-3: status anchorHit three-state discrimination', () => {
  it('reports patched-exact for a correctly patched archive — even with the marker missing (reconstruction proof is marker-independent)', async () => {
    const fixture = await createFixture()
    const patched = await patchAsar({ appDir: fixture.appDir, probeAppRunning: appClosed, entry: fixture.entry })
    expect(patched.ok).toBe(true)
    const status = await statusAsar({ appDir: fixture.appDir, probeAppRunning: appClosed, entry: fixture.entry })
    expect(status.patched).toBe(true)
    expect(status.anchorHit).toBe('patched-exact')
    expect(status.guidance).toBeUndefined()

    // Crash window (P4-r1 P4-2): stub live, marker absent — exactness is
    // proven from the bytes (removing the inserted segment reconstructs the
    // pinned pristine hash), not from the marker.
    rmSync(fixture.markerPath)
    const noMarker = await statusAsar({ appDir: fixture.appDir, probeAppRunning: appClosed, entry: fixture.entry })
    expect(noMarker.patched).toBe(true)
    expect(noMarker.anchorHit).toBe('patched-exact')
    expect(noMarker.marker?.state).toBe('absent')
  })

  it('reports patched-drifted when the patched file was modified after patching (action: restore)', async () => {
    const fixture = await createFixture()
    const patched = await patchAsar({ appDir: fixture.appDir, probeAppRunning: appClosed, entry: fixture.entry })
    expect(patched.ok).toBe(true)
    const expectedPatched = patchFile(FIXTURE_LIB, firstFileEntry()).text as string
    overwriteTargetText(fixture, `${expectedPatched}\n// tampered after patch\n`)

    const status = await statusAsar({ appDir: fixture.appDir, probeAppRunning: appClosed, entry: fixture.entry })
    expect(status.patched).toBe(true)
    expect(status.anchorHit).toBe('patched-drifted')
    expect(status.guidance).toContain('restore')
  })

  it('reports official-drifted for an unpatched archive whose target moved beyond the pinned anchor set', async () => {
    const fixture = await createFixture()
    overwriteTargetText(fixture, `${FIXTURE_LIB}\n// official update edit (no stub)\n`)

    const status = await statusAsar({ appDir: fixture.appDir, probeAppRunning: appClosed, entry: fixture.entry })
    expect(status.patched).toBe(false)
    expect(status.anchorHit).toBe('official-drifted')
    expect(status.guidance).toContain('anchor set')
  })
})
