/**
 * P6-C guard-observe bridge tests — the plugin's log-only consumption of the
 * patched base-context chain's `cache/guard-observe` session events (plan
 * ZCTX-v03-patch-plan; the events themselves are produced by the patched
 * official bundles, patcher v0.2 patch set zctx-v0.3-base-1).
 *
 * Asserted: the bridge's fact extraction + per-session summaries (valid
 * records, malformed degrade, unknown session, forget on dispose), the
 * firehose wiring under the `patch.guardObserveEvents` switch (consumed when
 * on, skipped when off), the v0.2 marker face read (patchSet + files, legacy
 * marker compat), and the zctx_status patch-set + guard-counter lines
 * rendered from the minimal runtime.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { createGuardObserveBridge, guardRecordFacts } from '../src/guard-observe-bridge.ts'
import type { GuardObserveSummary } from '../src/guard-observe-bridge.ts'
import { readPatchMarker } from '../src/patch-bridge.ts'
import { renderStatus } from '../src/tools.ts'
import type { LoggerLike } from '../src/tools.ts'
import { FoldStore } from '../src/store.ts'
import type { SessionLike } from '../src/types.ts'

/** One real-shape guard record (the patched GuardObserver's append payload). */
function guardRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    attemptSeq: 1,
    wholeHash: 'w-1',
    segments: { systemHash: 's', toolsHash: 't', messagesHash: 'm', messageHashes: ['a', 'b'], messageKinds: ['normal', 'normal'] },
    classified: true,
    monotonic: 'ok',
    sharedPrefixCount: 2,
    meta: { provider: 'deepseek', api: 'anthropic-messages', modelId: 'm1', bodyBytes: 4210 },
    ...overrides,
  }
}

describe('guardRecordFacts: the loose fact extraction', () => {
  it('extracts segmented/degraded/unclassified/classId/provider facts', () => {
    const facts = guardRecordFacts(guardRecord())
    expect(facts).toMatchObject({ segmented: true, degraded: false, unclassified: false, monotonic: 'ok', provider: 'deepseek', modelId: 'm1' })
    const degraded = guardRecordFacts(guardRecord({ segments: undefined, degraded: { reason: 'parse-failed' }, classified: false }))
    expect(degraded).toMatchObject({ segmented: false, degraded: true, unclassified: false })
    const unclassified = guardRecordFacts(guardRecord({ classified: false, monotonic: 'unclassified' }))
    expect(unclassified).toMatchObject({ unclassified: true })
  })

  it('feeds nothing for non-object payloads (host contract violation degrade)', () => {
    expect(guardRecordFacts(null)).toBeUndefined()
    expect(guardRecordFacts('nope')).toBeUndefined()
    expect(guardRecordFacts([1, 2])).toBeUndefined()
  })
})

describe('guard-observe bridge: consume/summary/forget', () => {
  it('accumulates per-session counters and the last record facts', () => {
    const bridge = createGuardObserveBridge()
    bridge.consume('sess-1', { seq: 4, data: guardRecord() })
    bridge.consume('sess-1', { seq: 5, data: guardRecord({ attemptSeq: 2, segments: undefined, degraded: { reason: 'non-string-body' }, classified: false }) })
    bridge.consume('sess-1', { seq: 6, data: guardRecord({ classified: false, monotonic: 'unclassified', sharedPrefixCount: 1 }) })
    const summary = bridge.summary('sess-1') as GuardObserveSummary
    expect(summary.total).toBe(3)
    // Records 1 and 3 carry segments; record 2 is the degraded capture.
    expect(summary.segmented).toBe(2)
    expect(summary.degraded).toBe(1)
    expect(summary.unclassified).toBe(1)
    expect(summary.lastSeq).toBe(6)
    expect(summary.lastMonotonic).toBe('unclassified')
    expect(summary.providers).toEqual(['deepseek'])
  })

  it('tracks distinct providers and the last classId', () => {
    const bridge = createGuardObserveBridge()
    bridge.consume('s', { seq: 1, data: guardRecord() })
    bridge.consume('s', { seq: 2, data: guardRecord({ classId: 'class2-effort-synth', meta: { provider: 'other', api: 'a', modelId: 'm2', bodyBytes: 1 } }) })
    const summary = bridge.summary('s') as GuardObserveSummary
    expect([...summary.providers].sort()).toEqual(['deepseek', 'other'])
    expect(summary.lastClassId).toBe('class2-effort-synth')
  })

  it('degrades malformed records (warn once, nothing accumulated)', () => {
    const warns: string[] = []
    const logger: LoggerLike = { warn: (message: string) => warns.push(message) }
    const bridge = createGuardObserveBridge(logger)
    bridge.consume('s', { seq: 1, data: 'not-a-record' })
    bridge.consume('s', { seq: 2, data: null })
    expect(bridge.summary('s')).toBeUndefined()
    expect(warns).toHaveLength(1)
    expect(warns[0]).toContain('malformed record')
  })

  it('ignores non-string session ids and never throws into the firehose', () => {
    const bridge = createGuardObserveBridge()
    expect(() => {
      bridge.consume(undefined, { seq: 1, data: guardRecord() })
      bridge.consume('', null)
      bridge.consume('s', undefined)
      bridge.consume('s', 42)
    }).not.toThrow()
    expect(bridge.summary('s')).toBeUndefined()
  })

  it('forgetSession drops the bucket (session/disposed discipline)', () => {
    const bridge = createGuardObserveBridge()
    bridge.consume('s', { seq: 1, data: guardRecord() })
    expect(bridge.summary('s')).toBeDefined()
    bridge.forgetSession('s')
    expect(bridge.summary('s')).toBeUndefined()
  })
})

describe('readPatchMarker: the v0.2 patch-set face', () => {
  let dir: string | undefined
  afterEach(() => {
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
    dir = undefined
  })

  it('surfaces patchSet, patcherVersion, and the per-file list from a v0.2 marker', () => {
    dir = mkdtempSync(join(tmpdir(), 'zctx-guard-marker-'))
    writeFileSync(
      join(dir, '.zctx-patch.json'),
      JSON.stringify({
        patcher: 'zctx-patch',
        patcherVersion: '0.2.0',
        patchSet: 'zctx-v0.3-base-1',
        shellVersion: '0.2.2-rc.3',
        target: 'dsh/node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/index.js',
        files: [
          { target: 'dsh/node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/index.js', sha256Before: 'a', sha256After: 'b' },
          { target: 'dsh/node_modules/@deepseek-ai/dsh-session/lib/index.js', sha256Before: 'c', sha256After: 'd' },
        ],
        timestamp: '2026-11-16T09:00:00.000Z',
      }),
    )
    const view = readPatchMarker(dir)
    expect(view.state).toBe('present')
    if (view.state !== 'present') return
    expect(view.patchSet).toBe('zctx-v0.3-base-1')
    expect(view.patcherVersion).toBe('0.2.0')
    expect(view.files).toHaveLength(2)
    expect(view.files?.[0]).toEqual({ target: 'dsh/node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/index.js', sha256After: 'b' })
  })

  it('keeps legacy v0.1 markers readable (patchSet/files undefined)', () => {
    dir = mkdtempSync(join(tmpdir(), 'zctx-guard-marker-'))
    writeFileSync(join(dir, '.zctx-patch.json'), JSON.stringify({ patcher: 'zctx-patch', shellVersion: '0.2.2-rc.3', timestamp: '2026-11-14T03:21:00.000Z', target: 'x' }))
    const view = readPatchMarker(dir)
    expect(view.state).toBe('present')
    if (view.state !== 'present') return
    expect(view.patchSet).toBeUndefined()
    expect(view.files).toBeUndefined()
    expect(view.version).toBe('0.2.2-rc.3')
  })
})

// ---------------------------------------------------------------------------
// Plugin firehose wiring + the status segment (the same mock ctx discipline
// as the patch-bridge spec).
// ---------------------------------------------------------------------------

import { ZcontextPlugin } from '../src/plugin.ts'
import type { HostContextLike } from '../src/plugin.ts'
import { disciplinedCtx, routeOverrides } from './helpers/mock-host.ts'

interface MockCtx extends HostContextLike {
  readonly logLines: { level: string; message: string }[]
  emit(event: string, ...args: unknown[]): void
}

function mockCtx(): MockCtx {
  const logLines: { level: string; message: string }[] = []
  const registeredCommands: unknown[] = []
  const listeners = new Map<string, ((...args: never[]) => unknown)[]>()
  const target: Record<string, unknown> = {
    logLines,
    registeredCommands,
    listeners,
    logger: {
      info: (m: string) => logLines.push({ level: 'info', message: m }),
      warn: (m: string) => logLines.push({ level: 'warn', message: m }),
    },
    reflect: { provide: () => undefined },
    emit(event: string, ...args: unknown[]): void {
      for (const listener of listeners.get(event) ?? []) (listener as (...a: unknown[]) => unknown)(...args)
    },
    on(event: string, listener: (...args: never[]) => unknown) {
      const list = listeners.get(event) ?? []
      list.push(listener)
      listeners.set(event, list)
      return () => undefined
    },
  }
  const store: Record<string, unknown> = {
    commands: { register: (c: unknown) => registeredCommands.push(c) },
    tokenMeter: { measure: () => ({ totalTokens: 100000 }) },
    llm: { resolveModelInfo: async () => ({ context: { contextWindow: 200000 } }) },
  }
  routeOverrides({} as Record<string, unknown>, store, target, ZcontextPlugin.inject)
  return disciplinedCtx<MockCtx>({ target, store, inject: ZcontextPlugin.inject })
}

/** Minimal session for the status render (no event history needed here). */
function statusSession(sessionId?: string): SessionLike {
  const session = { seq: 0, surface: { nodes: [] }, eventAt: () => undefined } as unknown as { id?: string } & SessionLike
  if (sessionId !== undefined) session.id = sessionId
  return session
}

describe('ZcontextPlugin: the guard-observe firehose face (P6-C)', () => {
  afterEach(() => {
    delete (process as { resourcesPath?: string }).resourcesPath
  })

  it('consumes cache/guard-observe events into the bridge and the status face serves them', async () => {
    const ctx = mockCtx()
    new ZcontextPlugin(ctx)
    const session = statusSession('sess-guard-live')
    ctx.emit('session/created', session)
    ctx.emit('session/event', session, { type: 'cache/guard-observe', seq: 7, data: guardRecord() })
    ctx.emit('session/event', session, { type: 'cache/guard-observe', seq: 8, data: guardRecord({ attemptSeq: 2, segments: undefined, degraded: { reason: 'hash-failed' }, classified: false }) })
    // zctx_status reads the patchFace's guardObserve lookup for THIS session.
    const command = (ctx as unknown as { registeredCommands?: { handler: (invocation: unknown) => Promise<{ kind: string; text?: string }> }[] }).registeredCommands?.[0]
    if (command === undefined) throw new Error('command face missing in the mock ctx')
    const result = await command.handler({ agent: { session }, rawInput: 'status' })
    expect(result.kind).toBe('success')
    expect(result.text).toContain('guard-observe records (log-only chain): total 2, segmented 1, degraded 1, unclassified 0')
    expect(result.text).toContain('providers: deepseek')
  })

  it('skips consumption when patch.guardObserveEvents is false', async () => {
    const ctx = mockCtx()
    new ZcontextPlugin(ctx, { 'patch.guardObserveEvents': false })
    const session = statusSession('sess-guard-off')
    ctx.emit('session/created', session)
    ctx.emit('session/event', session, { type: 'cache/guard-observe', seq: 1, data: guardRecord() })
    const command = (ctx as unknown as { registeredCommands?: { handler: (invocation: unknown) => Promise<{ kind: string; text?: string }> }[] }).registeredCommands?.[0]
    if (command === undefined) throw new Error('command face missing in the mock ctx')
    const result = await command.handler({ agent: { session }, rawInput: 'status' })
    expect(result.kind).toBe('success')
    expect(result.text).not.toContain('guard-observe records')
  })

  it('forgets the session bucket on session/disposed — a re-created session starts fresh', async () => {
    const ctx = mockCtx()
    new ZcontextPlugin(ctx)
    const session = statusSession('sess-guard-gone')
    ctx.emit('session/created', session)
    ctx.emit('session/event', session, { type: 'cache/guard-observe', seq: 1, data: guardRecord() })
    ctx.emit('session/disposed', session)
    // The session object is re-created (same id, new lifetime) — the disposed
    // bucket must not leak into it: the first record of the new lifetime
    // reads total 1, not 2.
    const session2 = statusSession('sess-guard-gone')
    ctx.emit('session/created', session2)
    ctx.emit('session/event', session2, { type: 'cache/guard-observe', seq: 1, data: guardRecord() })
    const command = (ctx as unknown as { registeredCommands?: { handler: (invocation: unknown) => Promise<{ kind: string; text?: string }> }[] }).registeredCommands?.[0]
    if (command === undefined) throw new Error('command face missing in the mock ctx')
    const result = await command.handler({ agent: { session: session2 }, rawInput: 'status' })
    expect(result.text).toContain('guard-observe records (log-only chain): total 1,')
  })
})

describe('renderStatus: the patch-set + guard lines (minimal runtime, P6-B/P6-C)', () => {
  let dir: string | undefined
  function minimalRuntime(
    markerReadDir: string,
    guardObserve?: (sessionId: string) => { total: number; segmented: number; degraded: number; unclassified: number; providers: readonly string[] } | undefined,
  ): Parameters<typeof renderStatus>[0] {
    const store = new FoldStore()
    const session = { seq: 0, surface: { nodes: [] }, eventAt: () => undefined } as never
    store.attach(session as SessionLike)
    return {
      cleanSampleFloor: 0.6,
      preflightMode: 'observe' as const,
      storeFor: () => store,
      validatorConfig: () => ({
        keepRecentMessages: 0,
        keepRecentTokens: 0,
        protectionFloorTokens: 0,
        minFoldableTokens: 5,
        maxFoldFraction: 0.6,
        summaryFloorChars: 10,
        summaryCeilingChars: 20000,
        netShrinkTolerance: 1.05,
      }),
      patchFace: () => ({
        mount: 'armed',
        marker: readPatchMarker(markerReadDir),
        hostFaces: 'unreachable',
        ...(guardObserve !== undefined ? { guardObserve } : {}),
      }),
    } as Parameters<typeof renderStatus>[0]
  }

  it('renders the patch-set line for absent / v0.1 / v0.2 markers', async () => {
    dir = mkdtempSync(join(tmpdir(), 'zctx-guard-status-'))
    try {
      const session = statusSession()
      const absent = await renderStatus(minimalRuntime(dir), session)
      expect(absent).toContain('patch set: not applied (official bundles pristine) (0 of 5 target bundles recorded)')

      writeFileSync(join(dir, '.zctx-patch.json'), JSON.stringify({ shellVersion: '0.2.2-rc.3', timestamp: '2026-11-14T03:21:00.000Z' }))
      const legacy = await renderStatus(minimalRuntime(dir), session)
      expect(legacy).toContain('patch set: v0.1 stub (pre-set marker) (unknown of 5 target bundles recorded)')

      writeFileSync(
        join(dir, '.zctx-patch.json'),
        JSON.stringify({
          patchSet: 'zctx-v0.3-base-1',
          patcherVersion: '0.2.0',
          shellVersion: '0.2.2-rc.3',
          files: [{ target: 'a' }, { target: 'b' }, { target: 'c' }, { target: 'd' }, { target: 'e' }],
          timestamp: '2026-11-16T09:00:00.000Z',
        }),
      )
      const v02 = await renderStatus(minimalRuntime(dir), session)
      expect(v02).toContain('patch set: zctx-v0.3-base-1 (5 of 5 target bundles recorded)')
      expect(v02).toContain('patch marker: present (v0.2.2-rc.3 by patcher 0.2.0, patched 2026-11-16T09:00:00.000Z)')
    } finally {
      rmSync(dir, { recursive: true, force: true })
      dir = undefined
    }
  })

  it('renders the guard-observe counter line when the session has records', async () => {
    dir = mkdtempSync(join(tmpdir(), 'zctx-guard-status-'))
    try {
      const session = statusSession('sess-render')
      const withRecords = await renderStatus(
        minimalRuntime(dir, (sessionId) =>
          sessionId === 'sess-render' ? { total: 12, segmented: 10, degraded: 2, unclassified: 1, providers: ['deepseek'] } : undefined,
        ),
        session,
      )
      expect(withRecords).toContain('guard-observe records (log-only chain): total 12, segmented 10, degraded 2, unclassified 1; providers: deepseek')

      // No records for this session → the line is honestly skipped.
      const noRecords = await renderStatus(minimalRuntime(dir, () => undefined), statusSession('other'))
      expect(noRecords).not.toContain('guard-observe records')

      // No id on the session → skipped too.
      const noId = await renderStatus(minimalRuntime(dir, () => ({ total: 1, segmented: 1, degraded: 0, unclassified: 0, providers: [] })), statusSession())
      expect(noId).not.toContain('guard-observe records')
    } finally {
      rmSync(dir, { recursive: true, force: true })
      dir = undefined
    }
  })
})
