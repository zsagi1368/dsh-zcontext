/**
 * P4 patcher tests — the full patch/restore/status machinery on a SYNTHETIC
 * mini-asar fixture (task card P4 product 3; the REAL machine is never
 * touched — W5-A6-INSTALL umbrella, post-merge).
 *
 * Fixture = @electron/asar createPackage over a small src tree whose
 * lib/index.js embeds the REAL rc.3 anchor region verbatim (5-tab call-site
 * spread + definition block; extracted read-only from the real asar,
 * SHA-256 e956da3d… — the production anchor set is pinned to that hash in a
 * dedicated test). The fixture's own anchor entry carries the fixture
 * content's hash so the machinery is exercised end-to-end without the real
 * archive.
 *
 * Asserted: patch full chain (gates → backup → splice → post-verify →
 * marker), byte-identical restore + marker removal, idempotent re-patch,
 * anchor-drift refusal (nothing modified, no backup), anchor-uniqueness
 * refusal (0 and 2 occurrences), version-gate refusal, lock-face refusal,
 * process-probe refusal, status dual states, and the SUPPORTED matrix pin.
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, sep } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import * as asar from '@electron/asar'

import { SUPPORTED, patchAsar, patchText, restoreAsar, spliceAsar, statusAsar } from '../patcher/zctx-patch.mjs'
import type { ZctxPatchAnchorEntry } from '../patcher/zctx-patch.d.mts'

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
// Fixture: the REAL rc.3 anchor region (5-tab indent, `void 0` — extracted
// read-only from the real app.asar; keep byte-exact).
// ---------------------------------------------------------------------------

/** The file-unique call-site spread (lib/index.js five-tab depth). */
const CALL_SITE_LINE = '\t\t\t\t\t...profileOptions(profile, reasoning, apiKey),'

const FIXTURE_LIB = [
  '// fixture lib/index.js — the rc.3 anchor region embedded verbatim (trimmed)',
  'class PiAdapter {',
  '\tstream(request, options) {',
  '\t\tconst snapshot = this.prepare(request)',
  '\t\tconst events = snapshot.models.streamSimple(model, context, {',
  CALL_SITE_LINE,
  '\t\t\t\t\t...options.temperature === void 0 ? {} : { temperature: options.temperature },',
  '\t\t\t\t\t...options.maxTokens === void 0 ? {} : { maxTokens: options.maxTokens },',
  '\t\t\t\t\t...options.sessionId === void 0 ? {} : { sessionId: String(options.sessionId) },',
  '\t\t\t\t\tsignal: watchdog.signal,',
  '\t\t\t\t\theaders: requestHeaders(profile.headers, options, model.baseUrl, this.config.prepareHeaders)',
  '\t\t\t})',
  '\t\t\treturn toStreamChunks(events, model.contextWindow, options.signal, model.id, digest)',
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
].join('\n')

const TARGET_PATH = 'dsh/node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/index.js'
const NEIGHBOR_CONTENT = '// neighbor file positioned after the target in the payload'

interface Fixture {
  readonly work: string
  readonly appDir: string
  readonly asarPath: string
  readonly markerPath: string
  originalSha: string
  readonly entry: ZctxPatchAnchorEntry
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
    entry: { ...SUPPORTED['0.2.2-rc.3'], targetSha256: createHash('sha256').update(Buffer.from(FIXTURE_LIB, 'utf8')).digest('hex') },
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
// SUPPORTED matrix pin (the production anchor set is load-bearing).
// ---------------------------------------------------------------------------

describe('SUPPORTED anchor-set pin (production)', () => {
  it('pins rc.3 to the real pristine lib/index.js hash (P2 [F16] / VERIFY-P #8, re-verified live 2026-11-14)', () => {
    const entry = SUPPORTED['0.2.2-rc.3']
    expect(entry).toBeDefined()
    expect(entry.targetPath).toBe('dsh/node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/index.js')
    expect(entry.targetSha256).toBe('e956da3d7300e1426e13e14f47e6f981dd1ca345633a406568ee5058ad93e9d8')
    expect(entry.anchors.callSite).toBe('...profileOptions(profile, reasoning, apiKey),')
    expect(entry.anchors.definition).toBe('function profileOptions(profile, reasoning, apiKey) {')
    expect(entry.anchors.stubMarker).toBe('globalThis.__zctxPatch__')
    // The stub is the card-pinned one-line defensive forwarder (R1: options
    // fields only; identity = provider/model + options.sessionId).
    expect(entry.stub).toBe(
      '...(globalThis.__zctxPatch__?.wireOptions?.({ provider: options.provider, model: model.id, sessionId: options.sessionId }) ?? {}),',
    )
    expect(entry.stubIndent).toBe('\t\t\t\t\t')
  })
})

// ---------------------------------------------------------------------------
// patchText (pure text layer).
// ---------------------------------------------------------------------------

describe('patchText: anchor uniqueness + idempotence', () => {
  it('inserts exactly one stub line after the call-site spread', () => {
    const entry = SUPPORTED['0.2.2-rc.3']
    const result = patchText(FIXTURE_LIB, entry)
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
    // Five-tab indent, the line ends with the spread comma.
    expect(text).toContain(`${CALL_SITE_LINE}\n\t\t\t\t\t${entry.stub}\n`)
  })

  it('refuses when the anchor occurs 0 or 2 times (never patches blind)', () => {
    const entry = SUPPORTED['0.2.2-rc.3']
    const noAnchor = FIXTURE_LIB.replace(CALL_SITE_LINE, '...profileOptions(profile, reasoning)')
    expect(patchText(noAnchor, entry)).toMatchObject({ ok: false, reason: expect.stringContaining('0 times') })
    const twice = FIXTURE_LIB.replace('maxRetries: 0', `${CALL_SITE_LINE}\n\t\t\t\t\tmaxRetries: 0`)
    expect(patchText(twice, entry)).toMatchObject({ ok: false, reason: expect.stringContaining('2 times') })
  })

  it('reports already-patched when the stub marker is present', () => {
    const entry = SUPPORTED['0.2.2-rc.3']
    const patched = patchText(FIXTURE_LIB, entry).text as string
    expect(patchText(patched, entry)).toMatchObject({ ok: false, alreadyPatched: true })
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
    expect(marker.target).toBe(TARGET_PATH)
    expect(marker.sha256Before).toBe(fixture.entry.targetSha256)
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
    expect(readdirSync(join(fixture.work, 'zctx-backup')).length).toBe(backupCount)
    expect(readFileSync(fixture.markerPath, 'utf8')).toBe(markerAfterFirst)
  })

  it('refuses anchor drift (hash gate) and modifies NOTHING', async () => {
    const fixture = await createFixture()
    const drifted: ZctxPatchAnchorEntry = { ...fixture.entry, targetSha256: 'deadbeef'.repeat(8) }
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
    expect(before.anchorHit).toBe('match (pristine)')
    expect(before.patched).toBe(false)
    expect(before.marker?.state).toBe('absent')
    expect(before.backups).toHaveLength(0)
    expect(before.lock?.exists).toBe(false)

    const patched = await patchAsar({ appDir: fixture.appDir, probeAppRunning: appClosed, entry: fixture.entry })
    expect(patched.ok).toBe(true)
    const after = await statusAsar({ appDir: fixture.appDir, probeAppRunning: appClosed, entry: fixture.entry })
    expect(after.patched).toBe(true)
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
    const patched = patchText(FIXTURE_LIB, fixture.entry)
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
