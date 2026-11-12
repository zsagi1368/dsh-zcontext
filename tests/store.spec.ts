import { describe, expect, it } from 'vitest'

import { FoldStore } from '../src/store.ts'
import type { SessionEventLike } from '../src/types.ts'
import { MockSession, msg, seedConversation } from './helpers/mock-session.ts'

/** Build a session whose log holds a fold, an unfold, and an absorbing fold. */
function seedFoldLifecycle(): MockSession {
  const session = new MockSession()
  session.append('system/message', msg.system('sys'))
  session.append('user/message', msg.user('u1'))
  session.append('assistant/message', msg.assistant('a1'))
  // fold f1 over [1, 2] → checkpoint seq 3
  session.append('user/message', {
    message: {
      role: 'user',
      content: [{ type: 'text', text: 'summary of 1..2' }],
      source: { kind: 'zctx-fold', foldId: 'f1', tokensBefore: 100, tokensAfter: 10 },
    },
  }, { surfaceOp: { op: 'replace', startSeq: 1, endSeq: 2 }, sourceEventSeqs: [1, 2] })
  // unfold f1 → checkpoint seq 4 (replaces the checkpoint node 3)
  session.append('user/message', {
    message: {
      role: 'user',
      content: [{ type: 'text', text: 'materialized' }],
      source: { kind: 'zctx-unfold', foldId: 'f1' },
    },
  }, { surfaceOp: { op: 'replace', startSeq: 3, endSeq: 3 }, sourceEventSeqs: [3] })
  // re-fold over the re-materialized node → f2 checkpoint seq 5
  session.append('user/message', {
    message: {
      role: 'user',
      content: [{ type: 'text', text: 'second summary' }],
      source: { kind: 'zctx-fold', foldId: 'f2', tokensBefore: 90, tokensAfter: 12 },
    },
  }, { surfaceOp: { op: 'replace', startSeq: 4, endSeq: 4 }, sourceEventSeqs: [4] })
  return session
}

describe('FoldStore: attach scan rebuild', () => {
  it('rebuilds the fold ledger from a full log scan', () => {
    const store = new FoldStore()
    const session = seedFoldLifecycle()
    store.attach(session)
    const entries = store.ledgerEntries()
    expect(entries).toHaveLength(2) // f1 + f2
    const f1 = entries.find((e) => e.foldId === 'f1')
    expect(f1?.status).toBe('unfolded')
    expect(f1?.checkpointSeq).toBe(3)
    expect(f1?.startSeq).toBe(1)
    expect(f1?.endSeq).toBe(2)
    expect(f1?.shadowedSeqs).toEqual([1, 2])
    expect(f1?.tokensBefore).toBe(100)
    expect(f1?.tokensAfter).toBe(10)
    const f2 = entries.find((e) => e.foldId === 'f2')
    expect(f2?.status).toBe('active')
    expect(f2?.summaryText).toBe('second summary')
    // foldMap (validator view) exposes only ACTIVE folds.
    expect([...store.foldMap.keys()]).toEqual(['f2'])
  })

  it('marks an active fold dead when a foreign producer shadows its checkpoint', () => {
    const store = new FoldStore()
    const { session } = seedConversation()
    store.attach(session)
    // Fold [3, 5] (assistant/user/tool) → checkpoint 9; surface is [0,1,2,9,6,7,8].
    session.append('user/message', {
      message: {
        role: 'user',
        content: [{ type: 'text', text: 'x'.repeat(200) }],
        source: { kind: 'zctx-fold', foldId: 'fA' },
      },
    }, { surfaceOp: { op: 'replace', startSeq: 3, endSeq: 5 }, sourceEventSeqs: [3, 4, 5] })
    store.resync()
    expect(store.foldMap.get('fA')).toBeDefined()
    // Official compaction checkpoint shadows fA's checkpoint → dead. The
    // replace span must be contiguous on the LIVE surface [0,1,2,9,6,7,8]:
    // [1..8] shadows [1, 2, 9, 6, 7, 8].
    session.append('user/message', {
      message: {
        role: 'user',
        content: [{ type: 'text', text: 'compaction summary' }],
        source: { kind: 'compact-checkpoint', compactionId: 'c1' },
      },
    }, {
      surfaceOp: { op: 'replace', startSeq: 1, endSeq: 8 },
      sourceEventSeqs: [1, 2, 9, 6, 7, 8],
    })
    store.resync()
    const fA = store.ledgerEntries().find((e) => e.foldId === 'fA')
    expect(fA?.status).toBe('dead')
    expect(fA?.shadowedByKind).toBe('compact-checkpoint')
    expect(store.foldMap.has('fA')).toBe(false)
  })

  it('matches the incremental feed result to the full-scan rebuild', () => {
    const scanned = new FoldStore()
    const sessionA = seedFoldLifecycle()
    scanned.attach(sessionA)

    const fed = new FoldStore()
    const sessionB = new MockSession()
    fed.attach(sessionB)
    const off = sessionB.onAppend((event) => fed.onEvent(sessionB, event))
    // Replay the exact same event sequence through appends + the feed.
    sessionB.append('system/message', msg.system('sys'))
    sessionB.append('user/message', msg.user('u1'))
    sessionB.append('assistant/message', msg.assistant('a1'))
    sessionB.append('user/message', {
      message: {
        role: 'user',
        content: [{ type: 'text', text: 'summary of 1..2' }],
        source: { kind: 'zctx-fold', foldId: 'f1', tokensBefore: 100, tokensAfter: 10 },
      },
    }, { surfaceOp: { op: 'replace', startSeq: 1, endSeq: 2 }, sourceEventSeqs: [1, 2] })
    sessionB.append('user/message', {
      message: {
        role: 'user',
        content: [{ type: 'text', text: 'materialized' }],
        source: { kind: 'zctx-unfold', foldId: 'f1' },
      },
    }, { surfaceOp: { op: 'replace', startSeq: 3, endSeq: 3 }, sourceEventSeqs: [3] })
    sessionB.append('user/message', {
      message: {
        role: 'user',
        content: [{ type: 'text', text: 'second summary' }],
        source: { kind: 'zctx-fold', foldId: 'f2', tokensBefore: 90, tokensAfter: 12 },
      },
    }, { surfaceOp: { op: 'replace', startSeq: 4, endSeq: 4 }, sourceEventSeqs: [4] })
    off()

    expect(fed.ledgerEntries()).toEqual(scanned.ledgerEntries())
    expect([...fed.foldMap.entries()]).toEqual([...scanned.foldMap.entries()])
    expect(fed.surfaceNodes()).toEqual(scanned.surfaceNodes())
    expect(fed.usageSnapshot()).toEqual(scanned.usageSnapshot())
  })

  it('ignores events from a foreign session', () => {
    const store = new FoldStore()
    const { session } = seedConversation()
    store.attach(session)
    const foreign = seedConversation().session
    const foreignEvent: SessionEventLike = {
      seq: 99,
      type: 'user/message',
      data: msg.user('foreign'),
    }
    store.onEvent(foreign, foreignEvent)
    expect(store.syncedToSeq).toBe(session.seq)
    expect(store.retainedEvent(99)).toBeUndefined()
  })
})

describe('FoldStore: usage ledger (S6)', () => {
  it('records measured samples from assistant/message usage', () => {
    const store = new FoldStore()
    const session = new MockSession()
    store.attach(session)
    session.append('user/message', msg.user('q1'))
    session.append('assistant/message', msg.assistant('a1', [], { inputTokens: 10, outputTokens: 5, cacheReadTokens: 400, cacheWriteTokens: 60 }))
    store.resync()
    session.append('assistant/message', msg.assistant('a2', [], { inputTokens: 12, outputTokens: 7, cacheReadTokens: 460 }))
    store.resync()
    const snapshot = store.usageSnapshot()
    expect(snapshot.measured).toBe(true)
    expect(snapshot.measuredSamples).toBe(2)
    expect(snapshot.samples).toBe(2)
    expect(snapshot.latest?.cacheReadTokens).toBe(460)
    expect(snapshot.latest?.cacheWriteTokens).toBeUndefined()
  })

  it('marks sessions without usage data as estimated', () => {
    const store = new FoldStore()
    const session = new MockSession()
    store.attach(session)
    session.append('assistant/message', msg.assistant('no usage here'))
    store.resync()
    const snapshot = store.usageSnapshot()
    expect(snapshot.measured).toBe(false)
    expect(snapshot.unmeasuredSamples).toBe(1)
    expect(snapshot.latest?.measured).toBe(false)
  })

  it('keeps the usage ledger bounded at 64 samples', () => {
    const store = new FoldStore()
    const session = new MockSession()
    store.attach(session)
    for (let i = 0; i < 70; i += 1) {
      session.append('assistant/message', msg.assistant(`a${i}`, [], { inputTokens: 1, outputTokens: 1, cacheReadTokens: i }))
    }
    store.resync()
    const snapshot = store.usageSnapshot()
    expect(snapshot.samples).toBe(64)
    expect(snapshot.measuredSamples).toBe(70)
    expect(snapshot.latest?.cacheReadTokens).toBe(69)
    expect(store.retainedEvent(0) !== undefined).toBe(true)
  })
})

describe('FoldStore: surfaceNodes view', () => {
  it('derives roles, pairing, and estimates from the retained events', () => {
    const store = new FoldStore()
    const { session } = seedConversation()
    store.attach(session)
    const nodes = store.surfaceNodes()
    expect(nodes.map((n) => n.seq)).toEqual(session.surface.nodes)
    expect(nodes[0].role).toBe('system')
    expect(nodes[1].role).toBe('user')
    expect(nodes[1].isUser).toBe(true)
    expect(nodes[2].role).toBe('assistant')
    expect(nodes[4].toolCallIds).toEqual(['call-a'])
    expect(nodes[5].role).toBe('tool')
    expect(nodes[5].answersCallId).toBe('call-a')
    expect(nodes[1].estimatedTokens).toBe(Math.ceil('Plan the migration.'.length / 3))
    expect(nodes[1].textLength).toBe('Plan the migration.'.length)
  })

  it('falls back to a local replay when the session exposes no surface', () => {
    const store = new FoldStore()
    const session = seedFoldLifecycle()
    // Simulate a session without a surface view: hide the getter.
    Object.defineProperty(session, 'surface', { value: undefined })
    store.attach(session)
    const nodes = store.surfaceNodes()
    expect(nodes.map((n) => n.seq)).toEqual([0, 5]) // checkpoint 5 replaced [1, 4]
  })

  it('fails closed on unreadable surface nodes', () => {
    const store = new FoldStore()
    const { session } = seedConversation()
    store.attach(session)
    // Simulate a retention gap: drop seq 4 from the retained log.
    ;(store as unknown as { eventsBySeq: Map<number, unknown> }).eventsBySeq.delete(4)
    expect(store.unreadableSurfaceSeqs()).toEqual([4])
    const nodes = store.surfaceNodes()
    const broken = nodes.find((n) => n.seq === 4)
    expect(broken?.role).toBe('unknown')
    expect(broken?.estimatedTokens).toBe(0)
    expect(broken?.isUser).toBe(false)
  })
})

describe('FoldStore: compaction mutex state', () => {
  it('tracks the durable compaction bracket incrementally', () => {
    const store = new FoldStore()
    const session = new MockSession()
    store.attach(session)
    expect(store.compactionActive()).toBe(false)
    session.append('compaction/start', { compactionId: 'c1' })
    store.resync()
    expect(store.compactionActive()).toBe(true)
    session.append('compaction/end', { compactionId: 'c1', outcome: 'complete' })
    store.resync()
    expect(store.compactionActive()).toBe(false)
  })

  it('matches the official end-seed lifecycle boundary semantics', () => {
    const store = new FoldStore()
    const session = new MockSession()
    // Seed the log FIRST, then attach: an unmatched start before the end-seed
    // belongs to an ended lifecycle (official assertCompactionInactive).
    session.append('compaction/start', { compactionId: 'c0' })
    session.append('session/end-seed', { inherited: true })
    store.attach(session)
    expect(store.compactionActive()).toBe(false)
    // A start AFTER the seed is live.
    session.append('compaction/start', { compactionId: 'c1' })
    store.resync()
    expect(store.compactionActive()).toBe(true)
  })
})

describe('FoldStore: resync and duplicate delivery', () => {
  it('repairs feed gaps via bounded delta reads', () => {
    const store = new FoldStore()
    const { session } = seedConversation()
    store.attach(session)
    expect(store.syncedToSeq).toBe(9)
    // Append three more events WITHOUT feeding the store.
    session.append('user/message', msg.user('later question'))
    session.append('assistant/message', msg.assistant('later answer'))
    session.append('user/message', msg.user('follow-up'))
    expect(store.syncedToSeq).toBe(9)
    store.resync()
    expect(store.syncedToSeq).toBe(12)
    expect(store.retainedEvent(11) !== undefined).toBe(true)
  })

  it('treats duplicate delivery of one seq as a no-op', () => {
    const store = new FoldStore()
    const session = new MockSession()
    store.attach(session)
    const event = session.append('assistant/message', msg.assistant('once', [], { inputTokens: 1, outputTokens: 1, cacheReadTokens: 10 }))
    store.onEvent(session, event) // duplicate
    const snapshot = store.usageSnapshot()
    expect(snapshot.samples).toBe(1)
    expect(snapshot.measuredSamples).toBe(1)
  })
})

describe('FoldStore: anomaly ledger', () => {
  it('records and bounds anomalies honestly', () => {
    const store = new FoldStore()
    for (let i = 0; i < 300; i += 1) store.recordAnomaly('probe', `anomaly ${i}`, i)
    const anomalies = store.anomalies()
    expect(anomalies).toHaveLength(256)
    expect(anomalies[0].detail).toBe('anomaly 44') // oldest dropped
    expect(anomalies[255].detail).toBe('anomaly 299')
  })

  it('records scan-time unreadable seqs as anomalies', () => {
    const store = new FoldStore()
    const session = new MockSession()
    session.append('user/message', msg.user('u1'))
    // Hide the event from eventAt to simulate an unreadable seq.
    const original = session.eventAt.bind(session)
    Object.defineProperty(session, 'eventAt', {
      value: (seq: number) => (seq === 0 ? undefined : original(seq)),
    })
    store.attach(session)
    expect(store.anomalies().some((a) => a.kind === 'unreadable-event' && a.seq === 0)).toBe(true)
    expect(store.syncedToSeq).toBe(1)
  })
})
