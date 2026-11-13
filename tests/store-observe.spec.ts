/**
 * V1 observability-ledger tests for FoldStore (task card V1-probes-store.md
 * item 4): attach-scan rebuild over a mixed event stream, resync gap repair
 * for the new ledgers, per-kind ResetEvent identification (7/8 guardian
 * classes + the a.2 extras), and the UsageRecord full-token upgrade.
 *
 * Header payloads mirror the official request/header shape
 * (session/src/types.ts:388-395 + EpochHeader :270-281); the store's header
 * field comparison is the documented local twin of the official
 * callConfigEquals (call-config.ts:67-77) whose live semantics the U2 probe
 * pins (scripts/probe-host-imports.mjs G4).
 */

import { describe, expect, it } from 'vitest'

import { FoldStore } from '../src/store.ts'
import type { SessionEventLike } from '../src/types.ts'
import { MockSession, msg, seedConversation } from './helpers/mock-session.ts'

/** A request/header payload (official shape). */
function headerPayload(
  config: Record<string, unknown>,
  reason: string,
  extra: { tools?: unknown[]; startsSeries?: true } = {},
): Record<string, unknown> {
  return {
    header: {
      config,
      ...(extra.tools !== undefined ? { tools: extra.tools } : {}),
    },
    reason,
    ...(extra.startsSeries === true ? { startsSeries: true } : {}),
  }
}

const CHAT_CONFIG = { provider: 'deepseek', model: 'deepseek-chat' }
const TOOL_SCHEMA_A = { name: 'zctx_fold', description: 'fold', parameters: {} }
const TOOL_SCHEMA_B = { name: 'zctx_unfold', description: 'unfold', parameters: {} }

describe('FoldStore observability: attach-scan rebuild over a mixed stream', () => {
  it('rebuilds header chain, reset ledger, and usage records from a full scan', () => {
    const session = new MockSession()
    session.append('system/message', msg.system('sys'))
    session.append('request/header', headerPayload(CHAT_CONFIG, 'initial'))
    session.append('user/message', msg.user('u1'))
    session.append(
      'assistant/message',
      msg.assistant('a1', [], {
        inputTokens: 100,
        outputTokens: 20,
        totalTokens: 580,
        cacheReadTokens: 400,
        cacheWriteTokens: 60,
      }),
    )
    session.append(
      'request/header',
      headerPayload({ provider: 'deepseek', model: 'deepseek-reasoner', temperature: 0.3 }, 'change'),
    )
    session.append('user/message', msg.user('u2'))
    session.append('assistant/message', msg.assistant('a2'))

    const store = new FoldStore()
    store.attach(session)

    // Header chain: both headers cached in order, reasons preserved.
    const chain = store.routeHeaderChain()
    expect(chain).toHaveLength(2)
    expect(chain[0]?.reason).toBe('initial')
    expect(chain[0]?.config).toEqual(CHAT_CONFIG)
    expect(chain[1]?.reason).toBe('change')
    expect(chain[1]?.config.model).toBe('deepseek-reasoner')
    expect(chain[1]?.config.temperature).toBe(0.3)
    expect(store.lastRouteHeader()?.seq).toBe(4)
    // Non-surface events stay off the surface view.
    expect(store.surfaceNodes().map((node) => node.seq)).toEqual([0, 2, 3, 5, 6])

    // Reset ledger: the header switch moved model AND temperature → one reset
    // per differing category.
    const resets = store.resetEvents()
    expect(resets.map((reset) => reset.kind)).toEqual(['model-change', 'sampling-change'])
    expect(resets[0]?.seq).toBe(4)
    expect(resets[0]?.evidence).toContain('model deepseek-chat→deepseek-reasoner')

    // Usage records: measured with full token fields, then estimated.
    const records = store.usageRecords()
    expect(records).toHaveLength(2)
    expect(records[0]).toMatchObject({
      seq: 3,
      measured: true,
      state: 'measured',
      inputTokens: 100,
      outputTokens: 20,
      totalTokens: 580,
      cacheReadTokens: 400,
      cacheWriteTokens: 60,
    })
    expect(records[0]?.attribution).toBeUndefined() // V3 fills attribution
    expect(records[1]).toMatchObject({ seq: 6, measured: false, state: 'estimated' })
    expect(records[1]?.inputTokens).toBeUndefined()

    // S6 snapshot stays compatible (UsageRecord is a UsageSample); the latest
    // sample here is the estimated one (a2 carried no usage).
    const snapshot = store.usageSnapshot()
    expect(snapshot.samples).toBe(2)
    expect(snapshot.measuredSamples).toBe(1)
    expect(snapshot.unmeasuredSamples).toBe(1)
    expect(snapshot.latest?.seq).toBe(6)
    expect(snapshot.latest?.measured).toBe(false)
    expect(snapshot.latest?.cacheReadTokens).toBeUndefined()
  })
})

describe('FoldStore observability: per-kind ResetEvent identification', () => {
  it('model-change: routing scalars differ (provider/model/reasoningEffort)', () => {
    const session = new MockSession()
    session.append('request/header', headerPayload(CHAT_CONFIG, 'initial'))
    session.append(
      'request/header',
      headerPayload(
        { provider: 'openrouter', model: 'deepseek-chat', reasoningEffort: 'high' },
        'change',
      ),
    )
    const store = new FoldStore()
    store.attach(session)
    const resets = store.resetEvents()
    expect(resets.map((r) => r.kind)).toEqual(['model-change'])
    expect(resets[0]?.evidence).toContain('provider deepseek→openrouter')
    expect(resets[0]?.evidence).toContain('reasoningEffort (absent)→high')
  })

  it('sampling-change: temperature/maxTokens/stop differ with routing held', () => {
    const session = new MockSession()
    session.append(
      'request/header',
      headerPayload({ ...CHAT_CONFIG, temperature: 0.7, maxTokens: 4096, stop: ['END'] }, 'initial'),
    )
    session.append(
      'request/header',
      headerPayload(
        { ...CHAT_CONFIG, temperature: 1.0, maxTokens: 8192, stop: ['STOP'] },
        'change',
      ),
    )
    const store = new FoldStore()
    store.attach(session)
    const resets = store.resetEvents()
    expect(resets.map((r) => r.kind)).toEqual(['sampling-change'])
    expect(resets[0]?.evidence).toContain('temperature 0.7→1')
    expect(resets[0]?.evidence).toContain('maxTokens 4096→8192')
    expect(resets[0]?.evidence).toContain('["END"]→["STOP"]')
  })

  it('stop lists compare element-wise and by length (callConfigEquals tail)', () => {
    const session = new MockSession()
    session.append('request/header', headerPayload({ ...CHAT_CONFIG, stop: ['a', 'b'] }, 'initial'))
    session.append('request/header', headerPayload({ ...CHAT_CONFIG, stop: ['a', 'c'] }, 'change'))
    const store = new FoldStore()
    store.attach(session)
    expect(store.resetEvents().map((r) => r.kind)).toEqual(['sampling-change'])

    const session2 = new MockSession()
    session2.append('request/header', headerPayload({ ...CHAT_CONFIG, stop: ['a'] }, 'initial'))
    session2.append('request/header', headerPayload({ ...CHAT_CONFIG, stop: ['a', 'b'] }, 'change'))
    const store2 = new FoldStore()
    store2.attach(session2)
    expect(store2.resetEvents().map((r) => r.kind)).toEqual(['sampling-change'])

    const session3 = new MockSession()
    session3.append('request/header', headerPayload({ ...CHAT_CONFIG, stop: ['a', 'b'] }, 'initial'))
    session3.append('request/header', headerPayload({ ...CHAT_CONFIG, stop: ['a', 'b'] }, 'change'))
    const store3 = new FoldStore()
    store3.attach(session3)
    // Identical restated config: header cached, but nothing breaks.
    expect(store3.resetEvents()).toHaveLength(0)
    expect(store3.routeHeaderChain()).toHaveLength(2)
  })

  it('toolset-change: tools arrays differ structurally (sorted-key compare)', () => {
    const session = new MockSession()
    session.append('request/header', headerPayload(CHAT_CONFIG, 'initial', { tools: [TOOL_SCHEMA_A] }))
    session.append(
      'request/header',
      // Same tool set, DIFFERENT key order in the schema object → equal.
      headerPayload(CHAT_CONFIG, 'change', {
        tools: [{ parameters: {}, description: 'fold', name: 'zctx_fold' }],
      }),
    )
    const store = new FoldStore()
    store.attach(session)
    expect(store.resetEvents()).toHaveLength(0)

    const session2 = new MockSession()
    session2.append('request/header', headerPayload(CHAT_CONFIG, 'initial', { tools: [TOOL_SCHEMA_A] }))
    session2.append(
      'request/header',
      headerPayload(CHAT_CONFIG, 'change', { tools: [TOOL_SCHEMA_A, TOOL_SCHEMA_B] }),
    )
    const store2 = new FoldStore()
    store2.attach(session2)
    const resets = store2.resetEvents()
    expect(resets.map((r) => r.kind)).toEqual(['toolset-change'])
    expect(resets[0]?.evidence).toContain('tools schema diff (1→2 schemas)')

    const session3 = new MockSession()
    session3.append('request/header', headerPayload(CHAT_CONFIG, 'initial', { tools: [TOOL_SCHEMA_A] }))
    session3.append('request/header', headerPayload(CHAT_CONFIG, 'change'))
    const store3 = new FoldStore()
    store3.attach(session3)
    expect(store3.resetEvents().map((r) => r.kind)).toEqual(['toolset-change'])
    expect(store3.resetEvents()[0]?.evidence).toContain('(1→none schemas)')
  })

  it('a change header differing in two categories emits one reset per category', () => {
    const session = new MockSession()
    session.append('request/header', headerPayload(CHAT_CONFIG, 'initial', { tools: [TOOL_SCHEMA_A] }))
    session.append(
      'request/header',
      headerPayload(
        { provider: 'deepseek', model: 'deepseek-reasoner', temperature: 0.2 },
        'change',
        { tools: [TOOL_SCHEMA_A, TOOL_SCHEMA_B] },
      ),
    )
    const store = new FoldStore()
    store.attach(session)
    expect(store.resetEvents().map((r) => r.kind)).toEqual([
      'model-change',
      'sampling-change',
      'toolset-change',
    ])
  })

  it('compaction: the bracket start records the reset; inner replaces add none', () => {
    const { session } = seedConversation()
    const store = new FoldStore()
    store.attach(session)
    expect(store.resetEvents()).toHaveLength(0)
    session.append('compaction/start', { compactionId: 'c1' })
    // Official compaction's own replace INSIDE the bracket (compact-checkpoint
    // producer over surface [1..5]): already covered by the bracket reset.
    session.append('user/message', {
      message: {
        role: 'user',
        content: [{ type: 'text', text: 'official compaction summary' }],
        source: { kind: 'compact-checkpoint', compactionId: 'c1' },
      },
    }, {
      surfaceOp: { op: 'replace', startSeq: 1, endSeq: 5 },
      sourceEventSeqs: [1, 2, 3, 4, 5],
    })
    session.append('compaction/end', { compactionId: 'c1', outcome: 'complete' })
    store.resync()
    expect(store.resetEvents().map((r) => r.kind)).toEqual(['compaction'])
    expect(store.resetEvents()[0]?.seq).toBe(9)
    expect(store.resetEvents()[0]?.evidence).toBe('compaction/start bracket opened')

    // After the bracket closes, a foreign replace is visible again. The
    // post-compaction surface is [0, 10, 6, 7, 8] (nodes 1..5 collapsed into
    // checkpoint 10), so the foreign span targets [10..6].
    session.append('user/message', {
      message: {
        role: 'user',
        content: [{ type: 'text', text: 'some other plugin rewrote the window' }],
        source: { kind: 'other-plugin-checkpoint' },
      },
    }, {
      surfaceOp: { op: 'replace', startSeq: 10, endSeq: 6 },
      sourceEventSeqs: [10, 6],
    })
    store.resync()
    expect(store.resetEvents().map((r) => r.kind)).toEqual(['compaction', 'unknown-replace'])
  })

  it('merge-rewrite: own fold and unfold checkpoints, inside any bracket state', () => {
    const session = new MockSession()
    session.append('user/message', msg.user('u1'))
    session.append('assistant/message', msg.assistant('a1'))
    session.append('user/message', msg.user('u2'))
    session.append('user/message', {
      message: {
        role: 'user',
        content: [{ type: 'text', text: 'summary of 1..2' }],
        source: { kind: 'zctx-fold', foldId: 'f1', tokensBefore: 100, tokensAfter: 10 },
      },
    }, { surfaceOp: { op: 'replace', startSeq: 1, endSeq: 2 }, sourceEventSeqs: [1, 2] })
    session.append('user/message', {
      message: {
        role: 'user',
        content: [{ type: 'text', text: 'materialized' }],
        source: { kind: 'zctx-unfold', foldId: 'f1' },
      },
    }, { surfaceOp: { op: 'replace', startSeq: 3, endSeq: 3 }, sourceEventSeqs: [3] })
    const store = new FoldStore()
    store.attach(session)
    const resets = store.resetEvents()
    expect(resets.map((r) => r.kind)).toEqual(['merge-rewrite', 'merge-rewrite'])
    expect(resets[0]?.evidence).toContain('zctx-fold f1')
    expect(resets[0]?.evidence).toContain('span 1..2')
    expect(resets[1]?.evidence).toContain('zctx-unfold f1')
    // The fold ledger still works alongside (both views see every replace).
    expect(store.ledgerEntries().map((entry) => entry.status)).toEqual(['unfolded'])
  })

  it('micro-prune: a single tool/result node rewritten in place', () => {
    const { session } = seedConversation() // tool/result node at seq 5
    const store = new FoldStore()
    store.attach(session)
    session.append('tool/result', msg.tool('call-a', 'pruned: a.sql'), {
      surfaceOp: { op: 'replace', startSeq: 5, endSeq: 5 },
      sourceEventSeqs: [5],
    })
    store.resync()
    const resets = store.resetEvents()
    expect(resets.map((r) => r.kind)).toEqual(['micro-prune'])
    expect(resets[0]?.seq).toBe(9)
    expect(resets[0]?.evidence).toContain('tool/result node 5 rewritten in place')
  })

  it('multi-node spans over tool results are NOT micro-prune (unknown-replace)', () => {
    const { session } = seedConversation()
    const store = new FoldStore()
    store.attach(session)
    session.append('user/message', {
      message: {
        role: 'user',
        content: [{ type: 'text', text: 'foreign multi-node rewrite' }],
        source: { kind: 'alien-checkpoint' },
      },
    }, {
      surfaceOp: { op: 'replace', startSeq: 4, endSeq: 5 },
      sourceEventSeqs: [4, 5],
    })
    store.resync()
    expect(store.resetEvents().map((r) => r.kind)).toEqual(['unknown-replace'])
  })

  it('system-section-change: a system/message node rewrite on the surface', () => {
    const { session } = seedConversation() // node 0 holds the system prompt
    const store = new FoldStore()
    store.attach(session)
    session.append('system/message', { turn: 1, step: 0, message: { role: 'system', content: [{ type: 'text', text: 'rewritten instructions' }], source: { kind: 'system-prompt' } } }, {
      surfaceOp: { op: 'replace', startSeq: 0, endSeq: 0 },
      sourceEventSeqs: [0],
    })
    store.resync()
    const resets = store.resetEvents()
    expect(resets.map((r) => r.kind)).toEqual(['system-section-change'])
    expect(resets[0]?.evidence).toContain('system/message rewrite over span 0..0')
  })

  it('session-recovery: session/end-seed generation boundary', () => {
    const session = new MockSession()
    session.append('user/message', msg.user('seeded history'))
    session.append('session/end-seed', { inherited: true })
    const store = new FoldStore()
    store.attach(session)
    const resets = store.resetEvents()
    expect(resets.map((r) => r.kind)).toEqual(['session-recovery'])
    expect(resets[0]?.evidence).toBe('session/end-seed generation boundary')
  })

  it('session-recovery: a resume header marks the restart/fork-seed boundary', () => {
    const session = new MockSession()
    session.append('request/header', headerPayload(CHAT_CONFIG, 'initial'))
    session.append('request/header', headerPayload(CHAT_CONFIG, 'resume'))
    const store = new FoldStore()
    store.attach(session)
    const resets = store.resetEvents()
    expect(resets.map((r) => r.kind)).toEqual(['session-recovery'])
    expect(resets[0]?.evidence).toContain("reason='resume'")
    // Both headers are still on the chain.
    expect(store.routeHeaderChain()).toHaveLength(2)
  })

  it('initial and series headers record no reset', () => {
    const session = new MockSession()
    session.append('request/header', headerPayload(CHAT_CONFIG, 'initial'))
    session.append('request/header', headerPayload(CHAT_CONFIG, 'series', { startsSeries: true }))
    const store = new FoldStore()
    store.attach(session)
    expect(store.resetEvents()).toHaveLength(0)
    expect(store.routeHeaderChain()).toHaveLength(2)
  })

  it('an unparseable header records an anomaly and stays off the chain (fail-soft)', () => {
    const session = new MockSession()
    session.append('request/header', { header: { config: { model: 'no-provider' } }, reason: 'initial' })
    const store = new FoldStore()
    store.attach(session)
    expect(store.routeHeaderChain()).toHaveLength(0)
    expect(store.anomalies().some((a) => a.kind === 'unreadable-header' && a.seq === 0)).toBe(true)
    expect(store.resetEvents()).toHaveLength(0)
  })
})

describe('FoldStore observability: incremental feed, gap repair, and event time', () => {
  it('matches the incremental feed result to the full-scan rebuild (dual regime)', () => {
    const buildLog = (session: MockSession): void => {
      session.append('system/message', msg.system('sys'))
      session.append('request/header', headerPayload(CHAT_CONFIG, 'initial'))
      session.append('user/message', msg.user('u1'))
      session.append('assistant/message', msg.assistant('a1', [], { inputTokens: 10, outputTokens: 4, cacheReadTokens: 200 }))
      session.append('request/header', headerPayload({ ...CHAT_CONFIG, temperature: 0.9 }, 'change'))
      session.append('user/message', {
        message: {
          role: 'user',
          content: [{ type: 'text', text: 'summary of 1..2' }],
          source: { kind: 'zctx-fold', foldId: 'f1', tokensBefore: 50, tokensAfter: 8 },
        },
      }, { surfaceOp: { op: 'replace', startSeq: 2, endSeq: 3 }, sourceEventSeqs: [2, 3] })
      session.append('session/end-seed', { inherited: true })
    }

    const scanned = new FoldStore()
    const sessionA = new MockSession()
    buildLog(sessionA)
    scanned.attach(sessionA)

    const fed = new FoldStore()
    const sessionB = new MockSession()
    fed.attach(sessionB)
    const off = sessionB.onAppend((event) => fed.onEvent(sessionB, event))
    buildLog(sessionB)
    off()

    expect(fed.routeHeaderChain()).toEqual(scanned.routeHeaderChain())
    expect(fed.resetEvents()).toEqual(scanned.resetEvents())
    expect(fed.usageRecords()).toEqual(scanned.usageRecords())
    expect(fed.usageSnapshot()).toEqual(scanned.usageSnapshot())
    expect(fed.ledgerEntries()).toEqual(scanned.ledgerEntries())
    expect(fed.resetEvents().map((r) => r.kind)).toEqual(['sampling-change', 'merge-rewrite', 'session-recovery'])
  })

  it('repairs the new ledgers across a feed gap via resync', () => {
    const store = new FoldStore()
    const session = new MockSession()
    store.attach(session)
    const off = session.onAppend((event) => store.onEvent(session, event))
    session.append('request/header', headerPayload(CHAT_CONFIG, 'initial'))
    off() // listener detached → the next events are a feed gap
    session.append('user/message', msg.user('u1'))
    session.append(
      'assistant/message',
      msg.assistant('a1', [], { inputTokens: 7, outputTokens: 3, cacheWriteTokens: 15 }),
    )
    session.append(
      'request/header',
      headerPayload({ provider: 'deepseek', model: 'deepseek-reasoner' }, 'change'),
    )
    expect(store.routeHeaderChain()).toHaveLength(1) // gap not yet repaired
    expect(store.usageRecords()).toHaveLength(0)
    store.resync()
    expect(store.routeHeaderChain()).toHaveLength(2)
    expect(store.lastRouteHeader()?.config.model).toBe('deepseek-reasoner')
    expect(store.resetEvents().map((r) => r.kind)).toEqual(['model-change'])
    expect(store.usageRecords()).toMatchObject([
      { seq: 2, state: 'measured', inputTokens: 7, cacheWriteTokens: 15 },
    ])
  })

  it('propagates the official event time into ResetEvent.time', () => {
    const store = new FoldStore()
    const session = new MockSession()
    store.attach(session)
    const timed: SessionEventLike = {
      seq: store.syncedToSeq,
      type: 'session/end-seed',
      data: { inherited: true },
      time: 1731400000000,
    }
    store.onEvent(session, timed)
    expect(store.resetEvents()).toEqual([
      { kind: 'session-recovery', seq: 0, time: 1731400000000, evidence: 'session/end-seed generation boundary' },
    ])
    // A timeless reset event (mock feeds carry no time) leaves the field
    // ABSENT, not zero.
    const timeless: SessionEventLike = {
      seq: store.syncedToSeq,
      type: 'session/end-seed',
      data: { inherited: true },
    }
    store.onEvent(session, timeless)
    const second = store.resetEvents()[1]
    expect(second?.time).toBeUndefined()
    expect('time' in (second as unknown as Record<string, unknown>)).toBe(false)
  })
})
