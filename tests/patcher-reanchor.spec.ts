/**
 * ZCTX-PATCH-AUTO D7 tests — the fast-adaptation architecture: reanchor
 * (candidate anchor sets for a NEW official build) + the external anchor
 * set loader (patcher/anchors/<version>.json) + the validator.
 *
 * THE MONEY TEST (V10): a simulated next official build (five rc.3-style
 * libs, every file carrying an unrelated byte change so the OLD anchor set's
 * hashes no longer match, shell version bumped) goes end-to-end with ZERO
 * manual editing —
 *   patch refuses (unknown version) → reanchor classifies 5/5 ALIVE →
 *   --accept lands patcher/anchors/<version>.json → patch runs the FULL
 *   gated flow on the data anchor set → status reports patched 5/5 + marker
 *   with anchorSetSource 'data'.
 *
 * Also asserted (fail-closed, never weakened):
 *   - a DRIFTED target (an op anchor count≠1) kills the candidate and yields
 *     analysis materials (new/old SHA-256, expected-vs-actual, trace context);
 *   - a patched input (presence marker in the bytes) refuses outright;
 *   - an existing data file for the version refuses (never clobbered);
 *   - a missing/renamed target refuses (structural change = human);
 *   - the candidate schema is validated by the SAME validator the loader
 *     enforces; corrupt/invalid data files refuse WITHOUT falling back to
 *     the in-code map; unknown versions still refuse;
 *   - availableAnchorSets / anchorSetSource report both faces honestly;
 *   - the in-code rc.3 entry stays the default (data dir empty → in-code).
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, sep } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import * as asar from '@electron/asar'

import {
  SUPPORTED,
  listAnchorSetVersions,
  loadAnchorSetData,
  patchAsar,
  reanchorAnchorSet,
  resolveAnchorEntry,
  statusAsar,
  validateAnchorSetData,
} from '../patcher/zctx-patch.mjs'
import type { ZctxPatchSetEntry } from '../patcher/zctx-patch.d.mts'

const sha256 = (buf: Buffer | string): string => createHash('sha256').update(buf).digest('hex')
const appClosed = () => 'no' as const

// ---------------------------------------------------------------------------
// The five-file fixture (rc.3-style libs; mutation hooks build the "next
// official build" faces).
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
const SESSION_PATH = 'dsh/node_modules/@deepseek-ai/dsh-session/lib/index.js'

interface ReanchorFixture {
  readonly work: string
  readonly appDir: string
  readonly asarPath: string
  readonly anchorsDir: string
  readonly version: string
}

let cleanupDirs: string[] = []

afterEach(() => {
  for (const dir of cleanupDirs) rmSync(dir, { recursive: true, force: true })
  cleanupDirs = []
})

/**
 * Build the simulated build: version bumped, per-file mutations applied
 * BEFORE packaging (mutations: (text) => text; drop a file entirely with
 * (text) => undefined to simulate a structural change).
 */
async function createReanchorFixture(
  version: string,
  mutations: Partial<Record<string, (text: string) => string | undefined>> = {},
): Promise<ReanchorFixture> {
  const work = mkdtempSync(join(tmpdir(), 'zctx-reanchor-spec-'))
  cleanupDirs.push(work)
  const src = join(work, 'src')
  for (const [path, text] of Object.entries(BASE_CONTENTS)) {
    const mutated = mutations[path]?.(text) ?? text
    if (mutated === undefined) continue // file absent from the build (structural change)
    const file = join(src, path)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, mutated)
  }
  writeFileSync(join(src, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-desktop', version }))
  mkdirSync(join(src, 'extra'), { recursive: true })
  writeFileSync(join(src, 'extra', 'neighbor.js'), '// neighbor file')
  const appDir = join(work, 'DeepSeek Harness')
  mkdirSync(join(appDir, 'resources'), { recursive: true })
  const asarPath = join(appDir, 'resources', 'app.asar')
  await asar.createPackage(src, asarPath)
  const anchorsDir = join(work, 'anchors')
  return { work, appDir, asarPath, anchorsDir, version }
}

/** The unrelated byte change: every file gains a build stamp (hashes move, anchors stay alive). */
const buildStamp = (version: string) => (text: string) => `${text}\n// build stamp ${version} stock`
const ALL_ALIVE_MUTATIONS = (version: string): Partial<Record<string, (text: string) => string>> => ({
  [AGENT_LOOP_PATH]: buildStamp(version),
  [SESSION_PATH]: buildStamp(version),
  'dsh/node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/index.js': buildStamp(version),
  'dsh/node_modules/@deepseek-ai/dsh-compaction-basic/lib/index.js': buildStamp(version),
  'dsh/node_modules/@deepseek-ai/dsh-compaction-tool-result-pruner/lib/index.js': buildStamp(version),
})

const findStep = (steps: readonly { name: string; status: string }[], name: string) => {
  const step = steps.find((candidate) => candidate.name === name)
  expect(step, `step "${name}" must exist`).toBeDefined()
  return step as { name: string; status: string; detail?: string }
}

// ---------------------------------------------------------------------------
// THE MONEY TEST (V10): reanchor → candidate on disk → patch → status 5/5,
// zero manual editing.
// ---------------------------------------------------------------------------

describe('reanchor: the money test (reanchor → patch → verify, zero manual edits)', () => {
  it('end-to-end on a simulated next official build', async () => {
    const fixture = await createReanchorFixture('0.2.3-rc.1', ALL_ALIVE_MUTATIONS('0.2.3-rc.1'))

    // 0. Before reanchor, the NEW build is patchable by nothing: unknown
    //    version, no data set — refused with the reanchor pointer.
    const before = await patchAsar({ appDir: fixture.appDir, probeAppRunning: appClosed, anchorsDir: fixture.anchorsDir })
    expect(before.ok).toBe(false)
    expect(before.refused).toBe(true)
    expect(findStep(before.steps, 'version gate').detail).toContain('run reanchor against this build first')

    // 1. reanchor: read-only classification → 5/5 ALIVE → --accept lands the
    //    data set under the anchors dir, SHA-256 printed.
    const re = reanchorAnchorSet({ appDir: fixture.appDir, anchorsDir: fixture.anchorsDir, accept: true })
    expect(re.ok).toBe(true)
    expect(re.accepted).toBe(true)
    expect(re.newVersion).toBe('0.2.3-rc.1')
    expect(findStep(re.steps, 'anchor classification').status).toBe('ok')
    expect(re.classification?.every((row) => row.class === 'ALIVE')).toBe(true)
    const dataPath = join(fixture.anchorsDir, '0.2.3-rc.1.json')
    expect(re.writtenTo).toBe(dataPath)
    expect(existsSync(dataPath)).toBe(true)
    expect(re.writtenSha256).toBe(sha256(readFileSync(dataPath)))
    // The candidate's pristine hashes ARE the new build's bytes.
    const candidate = JSON.parse(readFileSync(dataPath, 'utf8')) as ZctxPatchSetEntry
    expect(candidate.files).toHaveLength(5)
    for (const row of re.classification ?? []) {
      const file = candidate.files.find((entry) => entry.targetPath === row.target)
      expect(file?.pristineSha256).toBe(row.newSha256)
    }

    // 2. patch: the FULL gated flow now runs on the data anchor set (no
    //    entry injection, no manual editing).
    const patched = await patchAsar({ appDir: fixture.appDir, probeAppRunning: appClosed, anchorsDir: fixture.anchorsDir })
    expect(patched.ok).toBe(true)
    expect(findStep(patched.steps, 'version gate').detail).toContain('anchor set: data')
    expect(findStep(patched.steps, 'anchor hash gate').status).toBe('ok')
    expect(findStep(patched.steps, 'marker').status).toBe('ok')

    // 3. status: patched 5/5 + marker, resolved from the data set.
    const status = await statusAsar({ appDir: fixture.appDir, probeAppRunning: appClosed, anchorsDir: fixture.anchorsDir })
    expect(status.anchorSetSource).toBe('data')
    expect(status.patchSet?.state).toBe('patched')
    expect(status.patchSet?.patchedFiles).toBe(5)
    expect(status.patchSet?.totalFiles).toBe(5)
    expect(status.marker?.state).toBe('present')
    // availableAnchorSets lists VERSION KEYS (same contract as inCode).
    expect(status.availableAnchorSets?.dataDir).toContain('0.2.3-rc.1')
  })
})

// ---------------------------------------------------------------------------
// Classification faces (fail-closed).
// ---------------------------------------------------------------------------

describe('reanchor: classification and refusals', () => {
  it('DRIFTED target kills the candidate and yields analysis materials (trace context included)', async () => {
    const fixture = await createReanchorFixture('0.2.3-rc.1', {
      ...ALL_ALIVE_MUTATIONS('0.2.3-rc.1'),
      // Partial drift: the anchor's SECOND line changes, so the anchor is
      // dead (count 0) but its first line still traces.
      [AGENT_LOOP_PATH]: (text) => `${buildStamp('0.2.3-rc.1')(text).replace('\t\t\tsignal\n', '\t\t\tsignalToken\n')}`,
    })
    const re = reanchorAnchorSet({ appDir: fixture.appDir, anchorsDir: fixture.anchorsDir, accept: true })
    expect(re.ok).toBe(false)
    expect(re.refused).toBe(true)
    expect(findStep(re.steps, 'anchor classification').status).toBe('refused')
    expect(findStep(re.steps, 'anchor classification').detail).toContain('candidate set NOT produced')
    const drifted = re.driftedMaterials ?? []
    expect(drifted).toHaveLength(1)
    expect(drifted[0].target).toBe(AGENT_LOOP_PATH)
    const deadOp = drifted[0].ops.find((op) => op.actual !== op.expected)
    expect(deadOp?.expected).toBe(1)
    expect(deadOp?.actual).toBe(0)
    expect(deadOp?.locatedBy).toBe('first-line')
    expect(typeof deadOp?.line).toBe('number')
    expect(deadOp?.context).toContain('sessionId: this.session.id')
    expect(re.recovery).toContain('BY HAND')
    // Nothing landed in the anchors dir.
    expect(listAnchorSetVersions(fixture.anchorsDir)).toEqual([])
    expect(existsSync(fixture.anchorsDir)).toBe(false)
  })

  it('patched input (presence marker in the bytes) refuses outright', async () => {
    const fixture = await createReanchorFixture('0.2.3-rc.1', {
      ...ALL_ALIVE_MUTATIONS('0.2.3-rc.1'),
      [SESSION_PATH]: (text) => `${buildStamp('0.2.3-rc.1')(text)}\nconst marker = "cache/guard-observe", // patched face`,
    })
    const re = reanchorAnchorSet({ appDir: fixture.appDir, anchorsDir: fixture.anchorsDir, accept: true })
    expect(re.ok).toBe(false)
    expect(re.refused).toBe(true)
    const step = findStep(re.steps, 'patched input')
    expect(step.status).toBe('refused')
    expect(step.detail).toContain('ALREADY PATCHED')
    expect(existsSync(fixture.anchorsDir)).toBe(false)
  })

  it('an existing data set for the version refuses — reanchor never clobbers', async () => {
    const fixture = await createReanchorFixture('0.2.3-rc.1', ALL_ALIVE_MUTATIONS('0.2.3-rc.1'))
    mkdirSync(fixture.anchorsDir, { recursive: true })
    const dataPath = join(fixture.anchorsDir, '0.2.3-rc.1.json')
    writeFileSync(dataPath, '{"existing": true}')
    const re = reanchorAnchorSet({ appDir: fixture.appDir, anchorsDir: fixture.anchorsDir, accept: true })
    expect(re.ok).toBe(false)
    expect(re.refused).toBe(true)
    expect(findStep(re.steps, 'existing data set').detail).toContain('never overwrites')
    expect(readFileSync(dataPath, 'utf8')).toBe('{"existing": true}')
  })

  it('a structurally missing target refuses (target read face)', async () => {
    const fixture = await createReanchorFixture('0.2.3-rc.1', ALL_ALIVE_MUTATIONS('0.2.3-rc.1'), )
    // Rebuild WITHOUT the agent-loop file entirely (structural change).
    const work = fixture.work
    rmSync(fixture.asarPath, { force: true })
    const src = join(work, 'src')
    rmSync(join(src, AGENT_LOOP_PATH), { force: true })
    await asar.createPackage(src, fixture.asarPath)
    const re = reanchorAnchorSet({ appDir: fixture.appDir, anchorsDir: fixture.anchorsDir, accept: true })
    expect(re.ok).toBe(false)
    expect(re.refused).toBe(true)
    expect(findStep(re.steps, 'target read').status).toBe('refused')
    expect(findStep(re.steps, 'target read').detail).toContain('structural change')
  })

  it('without --accept the candidate is produced but patcher/anchors/ is NOT written; --out is an inspection copy', async () => {
    const fixture = await createReanchorFixture('0.2.3-rc.1', ALL_ALIVE_MUTATIONS('0.2.3-rc.1'))
    const outPath = join(fixture.work, 'candidate.json')
    const re = reanchorAnchorSet({ appDir: fixture.appDir, anchorsDir: fixture.anchorsDir, out: outPath })
    expect(re.ok).toBe(true)
    expect(re.accepted).toBe(false)
    expect(findStep(re.steps, 'accept gate').status).toBe('skip')
    expect(existsSync(fixture.anchorsDir)).toBe(false)
    expect(existsSync(outPath)).toBe(true)
    // The printed candidate JSON is exactly the schema the validator accepts.
    const check = validateAnchorSetData(JSON.parse(re.candidateJson ?? '{}'))
    expect(check.ok).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// The loader + validator (D5 faces).
// ---------------------------------------------------------------------------

describe('anchor set loader and validator', () => {
  it('resolveAnchorEntry: data file wins on version match; corrupt data refuses WITHOUT in-code fallback; unknown refuses', async () => {
    const fixture = await createReanchorFixture('0.2.3-rc.1', ALL_ALIVE_MUTATIONS('0.2.3-rc.1'))
    const re = reanchorAnchorSet({ appDir: fixture.appDir, anchorsDir: fixture.anchorsDir, accept: true })
    expect(re.ok).toBe(true)

    // Data file wins for the new version.
    const resolved = resolveAnchorEntry('0.2.3-rc.1', { anchorsDir: fixture.anchorsDir })
    expect(resolved.source).toBe('data')
    expect((resolved.entry as ZctxPatchSetEntry).files).toHaveLength(5)
    expect(resolved.meta?.anchorSetVersion).toBe('zctx-v0.3-base-1')

    // rc.3 keeps resolving from the in-code map (data dir has no rc.3 file —
    // the verified default is never migrated out).
    const inCode = resolveAnchorEntry('0.2.2-rc.3', { anchorsDir: fixture.anchorsDir })
    expect(inCode.source).toBe('in-code')
    expect((inCode.entry as ZctxPatchSetEntry).files[0].pristineSha256).toBe(
      (SUPPORTED['0.2.2-rc.3'] as ZctxPatchSetEntry).files[0].pristineSha256,
    )

    // Corrupt the data file: load refuses and does NOT fall back.
    writeFileSync(join(fixture.anchorsDir, '0.2.3-rc.1.json'), '{ broken json')
    const corrupt = loadAnchorSetData('0.2.3-rc.1', fixture.anchorsDir)
    expect(corrupt.ok).toBe(false)
    expect(corrupt.reason).toContain('parse failed')
    const corruptResolved = resolveAnchorEntry('0.2.3-rc.1', { anchorsDir: fixture.anchorsDir })
    expect(corruptResolved.source).toBe('error')

    // Unknown version: no data file, not in the map → none.
    const unknown = resolveAnchorEntry('9.9.9', { anchorsDir: fixture.anchorsDir })
    expect(unknown.source).toBe('none')
    expect(unknown.entry).toBeUndefined()
  })

  it('a corrupt data file makes patch refuse LOUDLY (no silent in-code fallback)', async () => {
    const fixture = await createReanchorFixture('0.2.3-rc.1', ALL_ALIVE_MUTATIONS('0.2.3-rc.1'))
    mkdirSync(fixture.anchorsDir, { recursive: true })
    writeFileSync(join(fixture.anchorsDir, '0.2.3-rc.1.json'), '{ broken json')
    const result = await patchAsar({ appDir: fixture.appDir, probeAppRunning: appClosed, anchorsDir: fixture.anchorsDir })
    expect(result.ok).toBe(false)
    expect(result.refused).toBe(true)
    const gate = findStep(result.steps, 'version gate')
    expect(gate.status).toBe('refused')
    expect(gate.detail).toContain('REJECTED')
    expect(gate.detail).toContain('never falls back')
  })

  it('an INVALID (parseable but schema-broken) data file also refuses via patch', async () => {
    const fixture = await createReanchorFixture('0.2.3-rc.1', ALL_ALIVE_MUTATIONS('0.2.3-rc.1'))
    mkdirSync(fixture.anchorsDir, { recursive: true })
    writeFileSync(
      join(fixture.anchorsDir, '0.2.3-rc.1.json'),
      JSON.stringify({ anchorSetVersion: 'x', generatedAt: 'y', sourceReport: 'z', shellPackage: 'p', files: [{ targetPath: 'not/a/known/path', pristineSha256: 'nothex', presenceMarker: 'm', ops: [] }] }),
    )
    const result = await patchAsar({ appDir: fixture.appDir, probeAppRunning: appClosed, anchorsDir: fixture.anchorsDir })
    expect(result.ok).toBe(false)
    expect(findStep(result.steps, 'version gate').detail).toContain('REJECTED')
    expect(findStep(result.steps, 'version gate').detail).toContain('exactly 5 targets')
  })

  it('validateAnchorSetData: every schema violation has a distinct loud reason', () => {
    const good = {
      anchorSetVersion: 'zctx-v0.3-base-1',
      generatedAt: '2026-11-18T00:00:00.000Z',
      sourceReport: 'test',
      shellPackage: '@deepseek-ai/dsh-desktop',
      files: Object.entries(BASE_CONTENTS).map(([targetPath, text]) => ({
        targetPath,
        pristineSha256: sha256(text),
        presenceMarker: 'marker',
        ops: [{ anchor: 'a', replacement: 'a-b' }],
      })),
    }
    expect(validateAnchorSetData(good).ok).toBe(true)
    const broken: Array<[string, unknown, string]> = [
      ['missing metadata', { ...good, generatedAt: undefined }, 'generatedAt'],
      ['bad hash shape', { ...good, files: good.files.map((file, index) => (index === 0 ? { ...file, pristineSha256: 'nothex' } : file)) }, '64 lowercase hex'],
      ['unknown target', { ...good, files: good.files.map((file, index) => (index === 0 ? { ...file, targetPath: 'elsewhere.js' } : file)) }, 'known probe targets'],
      ['duplicate target', { ...good, files: good.files.map((file, index) => (index === 4 ? good.files[0] : file)) }, 'more than once'],
      ['wrong file count', { ...good, files: good.files.slice(0, 3) }, 'exactly 5 targets'],
      ['empty ops', { ...good, files: good.files.map((file, index) => (index === 0 ? { ...file, ops: [] } : file)) }, 'non-empty array'],
      ['duplicate anchor', { ...good, files: good.files.map((file, index) => (index === 0 ? { ...file, ops: [{ anchor: 'a', replacement: 'x' }, { anchor: 'a', replacement: 'y' }] } : file)) }, 'duplicates'],
      ['marker collides with anchor', { ...good, files: good.files.map((file, index) => (index === 0 ? { ...file, presenceMarker: 'a' } : file)) }, 'collides'],
    ]
    for (const [label, data, needle] of broken) {
      const check = validateAnchorSetData(data)
      expect(check.ok, label).toBe(false)
      expect(check.reason ?? '', label).toContain(needle)
    }
  })

  it('status reports availableAnchorSets honestly (in-code + data dir) and the unknown-version face', async () => {
    const fixture = await createReanchorFixture('0.2.3-rc.1')
    const status = await statusAsar({ appDir: fixture.appDir, probeAppRunning: appClosed, anchorsDir: fixture.anchorsDir })
    expect(status.anchorSetSource).toBe('none')
    expect(status.anchorHit).toBe('unknown')
    expect(status.availableAnchorSets?.inCode).toContain('0.2.2-rc.3')
    expect(status.availableAnchorSets?.dataDir).toEqual([])
    expect(status.note).toContain('no anchor entry')

    // An rc.3-keyed fixture resolves through the IN-CODE map path (versions
    // injected with the fixture's own hashes — the production entry pins the
    // real rc.3 bytes, which a fixture cannot reproduce) even with an
    // (empty) data dir.
    const rc3 = await createReanchorFixture('0.2.2-rc.3')
    const rc3Entry: ZctxPatchSetEntry = {
      shellPackage: (SUPPORTED['0.2.2-rc.3'] as ZctxPatchSetEntry).shellPackage,
      files: (SUPPORTED['0.2.2-rc.3'] as ZctxPatchSetEntry).files.map((file) => ({
        ...file,
        pristineSha256: sha256(BASE_CONTENTS[file.targetPath]),
      })),
    }
    const rc3Status = await statusAsar({
      appDir: rc3.appDir,
      probeAppRunning: appClosed,
      anchorsDir: rc3.anchorsDir,
      versions: { '0.2.2-rc.3': rc3Entry },
    })
    expect(rc3Status.anchorSetSource).toBe('in-code')
    expect(rc3Status.patchSet?.state).toBe('unpatched')
    expect(rc3Status.availableAnchorSets?.inCode).toEqual(['0.2.2-rc.3'])
  })
})
