/**
 * store-attribution.spec.ts — V3 attribution + three-state integration for
 * FoldStore (task card V3 products 1-3): the engine runs inside the shared
 * applyEvent transition, so attach scan, live feed, and resync rebuilds all
 * attribute identically by construction — the pure-engine paths live in
 * attribution.spec.ts, the status rendering in tools.spec.ts.
 *
 * Event payloads mirror the official shapes: the fold commit is the bare
 * UserMessage with a surfaceOp replace + zctx-fold source
 * (session/src/types.ts:309, fold-engine.ts commit shape); assistant/message
 * carries the {turn, step, message, usage?, interrupted?} envelope
 * (session/src/types.ts:341-349).
 */

import { describe, expect, it } from 'vitest'

import { FoldStore } from '../src/store.ts'
import type { SessionEventLike } from '../src/types.ts'
import { MockSession, msg } from './helpers/mock-session.ts'

/** A fold commit event F (official bare UserMessage + replace + zctx-fold). */
function appendFoldCommit(
  session: MockSession,
  foldId: string,
  startSeq: number,
  endSeq: number,
): number {
  return session.append('user/message', {
    id: `ck-${foldId}`,
    role: 'user',
    content: [{ type: 'text', text: `folded summary ${foldId}` }],
    source: { kind: 'zctx-fold', foldId, tokensBefore: 100, tokensAfter: 20 },
  }, {
    surfaceOp: { op: 'replace', startSeq, endSeq },
    sourceEventSeqs: range(startSeq, endSeq),
  }).seq
}

function range(startSeq: number, endSeq: number): number[] {
  const out: number[] = []
  for (let seq = startSeq; seq <= endSeq; seq += 1) out.push(seq)
  return out
}

/** Official assistant/message envelope payload. */
function assistantPayload(turn: number, step: number, usage?: Record<string, number>, interrupted?: true) {
  return {
    turn,
    step,
    message: { role: 'assistant', content: [{ type: 'text', text: 'reply' }], source: { kind: 'model' } },
    ...(usage !== undefined ? { usage } : {}),
    ...(interrupted === true ? { interrupted: true } : {}),
  }
}

/** Session with sys/u/a then a fold commit over seqs 1..2 (checkpoint seq 3).
 * The fold span EXCLUDES the system head: the official surface manager
 * (mirrored by the mock) only allows system/message to rewrite node 0. */
function buildAttributionSession(): MockSession {
  const session = new MockSession()
  session.append('system/message', msg.system('sys'))
  session.append('user/message', msg.user('u1'))
  session.append('assistant/message', msg.assistant('a1', [], { inputTokens: 10, outputTokens: 4 }))
  appendFoldCommit(session, 'f1', 1, 2)
  return session
}

describe('FoldStore V3: fold attribution filled through the shared transition', () => {
  it('strong attribution binds the first post-fold request (feed regime)', () => {
    const session = buildAttributionSession()
    const store = new FoldStore()
    store.attach(session)
    const off = session.onAppend((event) => store.onEvent(session, event))
    session.append('assistant/message', assistantPayload(1, 1, { inputTokens: 50, cacheReadTokens: 30 }))
    off()
    const records = store.usageRecords()
    expect(records).toHaveLength(2)
    expect(records[1]?.attribution).toEqual({
      foldId: 'f1',
      foldCommitSeq: 3,
      messageSeq: 4,
      turn: 1,
      step: 1,
      quality: 'strong',
      retryCount: 0,
    })
    expect(store.foldAttributions()).toHaveLength(1)
    expect(store.foldAttributions()[0]?.quality).toBe('strong')
  })

  it('full-scan rebuild produces the same attribution (dual regime)', () => {
    const session = buildAttributionSession()
    session.append('assistant/message', assistantPayload(1, 1, { inputTokens: 50, cacheReadTokens: 30 }))
    const store = new FoldStore()
    store.attach(session)
    expect(store.usageRecords()[1]?.attribution).toEqual(store.foldAttributions()[0])
    expect(store.usageRecords()[1]?.attribution?.quality).toBe('strong')
  })

  it('noise 3 multi-step: only the FIRST post-fold step is attributed; later steps stay maintenance-ledger', () => {
    const session = buildAttributionSession()
    const store = new FoldStore()
    store.attach(session)
    const off = session.onAppend((event) => store.onEvent(session, event))
    session.append('tool/result', msg.tool('c1', 'ok'))
    session.append('assistant/message', assistantPayload(1, 1))
    session.append('assistant/message', assistantPayload(1, 2))
    off()
    const records = store.usageRecords()
    expect(records[1]?.attribution?.foldId).toBe('f1')
    expect(records[2]?.attribution).toBeUndefined()
    expect(store.foldAttributions()).toHaveLength(1)
  })

  it('noise 1 retry ring: llm/retry in the window grades retry with the pollution count', () => {
    const session = buildAttributionSession()
    const store = new FoldStore()
    store.attach(session)
    const off = session.onAppend((event) => store.onEvent(session, event))
    session.append('assistant/attempt', { turn: 1, step: 1, stream: [] })
    session.append('llm/retry', { retryId: 'r1', turn: 1, step: 1, retry: 1 })
    session.append('assistant/message', assistantPayload(1, 1))
    off()
    expect(store.usageRecords()[1]?.attribution).toMatchObject({ quality: 'retry', retryCount: 1 })
  })

  it('noise 5 compaction race: a compaction bracket in the window grades weak (总账 only)', () => {
    const session = buildAttributionSession()
    const store = new FoldStore()
    store.attach(session)
    const off = session.onAppend((event) => store.onEvent(session, event))
    session.append('compaction/start', { turn: 1 })
    session.append('assistant/message', assistantPayload(1, 1))
    off()
    const attribution = store.usageRecords()[1]?.attribution
    expect(attribution?.quality).toBe('weak')
    expect(store.foldAttributions()[0]?.quality).toBe('weak')
    // Weak = total ledger only: no fold-account row.
    expect(store.observabilitySnapshot().breakevenTable).toHaveLength(0)
  })

  it('noise 7 interrupted prefix: attributed and flagged', () => {
    const session = buildAttributionSession()
    const store = new FoldStore()
    store.attach(session)
    const off = session.onAppend((event) => store.onEvent(session, event))
    session.append('assistant/message', assistantPayload(1, 1, undefined, true))
    off()
    expect(store.usageRecords()[1]?.attribution).toMatchObject({ quality: 'strong', interrupted: true })
  })

  it('noise 8 subagent sessions: a foreign session feed never enters this store (per-store 分账)', () => {
    const session = buildAttributionSession()
    const store = new FoldStore()
    store.attach(session)
    const foreign = new MockSession()
    foreign.append('user/message', msg.user('seed-1'))
    foreign.append('user/message', msg.user('seed-2'))
    foreign.append('user/message', {
      id: 'ck-x',
      role: 'user',
      content: [{ type: 'text', text: 'subagent fold' }],
      source: { kind: 'zctx-fold', foldId: 'f-foreign', tokensBefore: 9, tokensAfter: 1 },
    }, { surfaceOp: { op: 'replace', startSeq: 0, endSeq: 1 }, sourceEventSeqs: [0, 1] })
    const off = session.onAppend((event) => store.onEvent(session, event))
    // The foreign session's fold commit event arrives at the SAME store call
    // site — ignored (the store is single-session by contract).
    store.onEvent(foreign, foreign.eventAt(2) as SessionEventLike)
    session.append('assistant/message', assistantPayload(1, 1))
    off()
    expect(store.usageRecords()[1]?.attribution).toMatchObject({ foldId: 'f1', quality: 'strong' })
    expect(store.foldAttributions().map((a) => a.foldId)).toEqual(['f1'])
  })

  it('batch folds: nearest commit binds the record; the earlier commit grades weak on its own window', () => {
    const session = new MockSession()
    session.append('system/message', msg.system('sys'))
    session.append('user/message', msg.user('u1'))
    session.append('assistant/message', msg.assistant('a1'))
    appendFoldCommit(session, 'f1', 1, 2) // checkpoint node 3
    appendFoldCommit(session, 'f2', 3, 3) // replaces the previous checkpoint (node 3)
    const store = new FoldStore()
    store.attach(session)
    const off = session.onAppend((event) => store.onEvent(session, event))
    session.append('assistant/message', assistantPayload(1, 1))
    off()
    const byFold = new Map(store.foldAttributions().map((a) => [a.foldId, a]))
    expect(byFold.get('f1')?.quality).toBe('weak') // f2's replace sits in f1's window
    expect(byFold.get('f2')?.quality).toBe('strong')
    // The record carries the NEAREST commit's association.
    expect(store.usageRecords()[1]?.attribution?.foldId).toBe('f2')
  })

  it('time-window fallback: resync-gap chain break → weak + timeWindow marker (§Q4.2 rule 4)', () => {
    // Raw fake session: seqs 4-5 are UNREADABLE (the store resync-gap case).
    const log = new Map<number, SessionEventLike>()
    log.set(0, { seq: 0, type: 'turn/start', data: { turn: 7 } })
    log.set(1, { seq: 1, type: 'user/message', data: { id: 'u', role: 'user', content: [] } })
    log.set(2, { seq: 2, type: 'assistant/message', data: { turn: 7, step: 0, message: { role: 'assistant', content: [] } } })
    log.set(3, {
      seq: 3, type: 'user/message', time: 1000,
      data: { id: 'ck', role: 'user', content: [], source: { kind: 'zctx-fold', foldId: 'f9', tokensBefore: 10, tokensAfter: 2 } },
      surfaceOp: { op: 'replace', startSeq: 1, endSeq: 2 }, sourceEventSeqs: [1, 2],
    })
    log.set(6, {
      seq: 6, type: 'assistant/message', time: 30000,
      data: { turn: 7, step: 1, message: { role: 'assistant', content: [] } },
    })
    const fakeSession = { seq: 7, eventAt: (s: number) => log.get(s) }
    const store = new FoldStore()
    store.attach(fakeSession)
    expect(store.anomalies().filter((a) => a.kind === 'unreadable-event')).toHaveLength(2)
    expect(store.usageRecords()).toHaveLength(2)
    const attribution = store.usageRecords()[1]?.attribution
    expect(attribution).toMatchObject({
      foldId: 'f9',
      quality: 'weak',
      timeWindow: true,
      turn: 7,
      step: 1,
    })
  })

  it('malformed assistant/message (no turn/step envelope) → anomaly, no attribution', () => {
    const session = buildAttributionSession()
    const store = new FoldStore()
    store.attach(session)
    const off = session.onAppend((event) => store.onEvent(session, event))
    session.append('assistant/message', { message: { role: 'assistant', content: [] } })
    off()
    expect(store.usageRecords()[1]?.attribution).toBeUndefined()
    expect(store.anomalies().some((a) => a.kind === 'attribution-skipped')).toBe(true)
  })
})

describe('FoldStore V3: three-state grading (§Q7.2; 字段缺席=estimated 不得反推)', () => {
  it('interpolated: same-turn measured anchor carries the input side over (absent stays absent)', () => {
    const session = new MockSession()
    session.append('assistant/message', assistantPayload(2, 0))
    session.append('assistant/message', assistantPayload(2, 1, { inputTokens: 50, cacheReadTokens: 30 }))
    const store = new FoldStore()
    store.attach(session)
    const records = store.usageRecords()
    expect(records[0]).toMatchObject({ state: 'semi', semiKind: 'interpolated', inputTokens: 50, cacheReadTokens: 30 })
    expect(records[0]?.cacheWriteTokens).toBeUndefined() // anchor lacked it → absent, NOT 0
    expect(records[0]?.outputTokens).toBeUndefined() // output is never interpolated
    expect(records[1]?.state).toBe('measured')
    expect(store.observabilitySnapshot().threeState).toEqual({ measured: 1, semi: 1, estimated: 0 })
  })

  it('interpolated stops at a turn change (different-turn estimated records stay estimated)', () => {
    const session = new MockSession()
    session.append('assistant/message', assistantPayload(2, 0))
    session.append('assistant/message', assistantPayload(3, 0, { inputTokens: 99 }))
    const store = new FoldStore()
    store.attach(session)
    expect(store.usageRecords()[0]?.state).toBe('estimated')
    expect(store.usageRecords()[0]?.semiKind).toBeUndefined()
    expect(store.observabilitySnapshot().threeState).toEqual({ measured: 1, semi: 0, estimated: 1 })
  })

  it('interpolated stops at a reset entry between the candidate and the anchor (conservative superset)', () => {
    const session = new MockSession()
    session.append('request/header', { header: { config: { provider: 'p', model: 'm1' } }, reason: 'initial' })
    session.append('assistant/message', assistantPayload(2, 0))
    session.append('request/header', { header: { config: { provider: 'p', model: 'm2' } }, reason: 'change' })
    session.append('assistant/message', assistantPayload(2, 1, { inputTokens: 99 }))
    const store = new FoldStore()
    store.attach(session)
    expect(store.resetEvents().map((r) => r.kind)).toContain('model-change')
    expect(store.usageRecords()[0]?.state).toBe('estimated')
    expect(store.observabilitySnapshot().threeState).toEqual({ measured: 1, semi: 0, estimated: 1 })
  })

  it('meterAnchored: injected anchor grades the input side at event time; cache fields stay ABSENT', () => {
    const session = new MockSession()
    session.append('assistant/message', assistantPayload(1, 0))
    const store = new FoldStore()
    store.setMeterAnchor({ inputAnchor: (seq) => (seq === 0 ? 1234 : undefined) })
    store.attach(session)
    const record = store.usageRecords()[0]
    expect(record).toMatchObject({ state: 'semi', semiKind: 'meterAnchored', inputTokens: 1234 })
    expect(record?.cacheReadTokens).toBeUndefined()
    expect(record?.cacheWriteTokens).toBeUndefined()
    expect(store.observabilitySnapshot().threeState).toEqual({ measured: 0, semi: 1, estimated: 0 })
  })

  it('no injected anchor → usage-less requests stay honestly estimated (estimated 不得反推 Cache 支持)', () => {
    const session = new MockSession()
    session.append('assistant/message', assistantPayload(1, 0))
    const store = new FoldStore()
    store.attach(session)
    const record = store.usageRecords()[0]
    expect(record?.state).toBe('estimated')
    expect(record?.semiKind).toBeUndefined()
    expect(record?.cacheReadTokens).toBeUndefined()
    expect(record?.cacheWriteTokens).toBeUndefined()
    expect(record?.inputTokens).toBeUndefined()
  })

  it('meter-anchor fault degrades to estimated with an anomaly (fail-soft probe)', () => {
    const session = new MockSession()
    session.append('assistant/message', assistantPayload(1, 0))
    const store = new FoldStore()
    store.setMeterAnchor({
      inputAnchor: () => {
        throw new Error('meter exploded')
      },
    })
    store.attach(session)
    expect(store.usageRecords()[0]?.state).toBe('estimated')
    expect(store.anomalies().some((a) => a.kind === 'meter-anchor-failed')).toBe(true)
  })
})

describe('FoldStore V3: V1-B bounded routeHeaders/resetLog (R3 mechanical closure)', () => {
  it('routeHeaders cap at 64 (oldest dropped)', () => {
    const session = new MockSession()
    for (let i = 0; i < 66; i += 1) {
      session.append('request/header', { header: { config: { provider: 'p', model: `m${i}` } }, reason: 'initial' })
    }
    const store = new FoldStore()
    store.attach(session)
    const chain = store.routeHeaderChain()
    expect(chain).toHaveLength(64)
    expect(chain[0]?.config.model).toBe('m2') // the first two dropped
    expect(chain[63]?.config.model).toBe('m65')
  })

  it('resetLog cap at 64 (oldest dropped)', () => {
    const session = new MockSession()
    for (let i = 0; i < 66; i += 1) session.append('compaction/start', { turn: i })
    const store = new FoldStore()
    store.attach(session)
    const resets = store.resetEvents()
    expect(resets).toHaveLength(64)
    expect(resets[0]?.seq).toBe(2) // the first two dropped
    expect(resets[63]?.seq).toBe(65)
  })
})

describe('FoldStore V3: observabilitySnapshot assembly (a.1 row 6)', () => {
  it('digests resets, counts three states, and computes the clean-sample ratio', () => {
    const session = new MockSession()
    session.append('request/header', { header: { config: { provider: 'p', model: 'm1' } }, reason: 'initial' })
    session.append('compaction/start', { turn: 0 })
    session.append('assistant/message', assistantPayload(0, 0, { inputTokens: 10 }))
    const store = new FoldStore()
    store.attach(session)
    const snapshot = store.observabilitySnapshot()
    expect(snapshot.threeState).toEqual({ measured: 1, semi: 0, estimated: 0 })
    expect(snapshot.cleanSampleRatio).toBe(0) // no attributed folds yet
    expect(snapshot.breakevenTable).toEqual([])
    expect(snapshot.resetSummary).toEqual([{ kind: 'compaction', count: 1 }])
  })
})
