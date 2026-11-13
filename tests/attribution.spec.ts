/**
 * attribution.spec.ts — the V3 attribution engine pure core (task card V3
 * product 5: 归因规则全路径 strong/retry/weak 三级 + 8 噪声逐项 + 时间窗兜底 +
 * 纯净占比降级 + 回本聚合). The engine is driven from bare event arrays (zero
 * store/host involvement); store-level wiring is pinned in
 * store-observe.spec.ts, status rendering in tools.spec.ts.
 *
 * Event-construction convention: fold commits are the official bare
 * UserMessage with a surfaceOp replace + zctx-fold source (fold-engine.ts
 * commit shape, session/src/types.ts:309); assistant/message events carry the
 * official {turn, step, message, usage?, interrupted?} envelope
 * (session/src/types.ts:341-349).
 */

import { describe, expect, it } from 'vitest'

import {
  billedInputTokens,
  buildObservabilitySnapshot,
  classifyFoldAttribution,
  cleanSampleRatio,
} from '../src/attribution.ts'
import type { ClassifyAttributionInput } from '../src/attribution.ts'
import type { FoldUsageAttribution, SessionEventLike } from '../src/types.ts'

const TIME_WINDOW_MS = 90000

/** Minimal event builder (seq/type/data + optional surface furniture). */
function ev(
  seq: number,
  type: string,
  data: unknown,
  extra: { time?: number; surfaceOp?: SessionEventLike['surfaceOp']; sourceEventSeqs?: number[] } = {},
): SessionEventLike {
  return {
    seq,
    type,
    data,
    ...(extra.time !== undefined ? { time: extra.time } : {}),
    ...(extra.surfaceOp !== undefined ? { surfaceOp: extra.surfaceOp } : {}),
    ...(extra.sourceEventSeqs !== undefined ? { sourceEventSeqs: extra.sourceEventSeqs } : {}),
  }
}

/** A fold commit event F (user/message, surfaceOp replace, zctx-fold source). */
function foldCommit(
  seq: number,
  foldId: string,
  extra: { time?: number; sourceEventSeqs?: number[] } = {},
): SessionEventLike {
  return ev(seq, 'user/message', {
    id: `u-${seq}`,
    role: 'user',
    content: [{ type: 'text', text: `summary ${foldId}` }],
    source: { kind: 'zctx-fold', foldId, tokensBefore: 10000, tokensAfter: 500 },
  }, {
    ...(extra.time !== undefined ? { time: extra.time } : {}),
    surfaceOp: { op: 'replace', startSeq: 0, endSeq: Math.max(0, seq - 1) },
    ...(extra.sourceEventSeqs !== undefined ? { sourceEventSeqs: extra.sourceEventSeqs } : {}),
  })
}

/** An assistant/message event M with the official envelope. */
function assistantMessage(
  seq: number,
  turn: number,
  step: number,
  extra: { time?: number; usage?: Record<string, number>; interrupted?: true } = {},
): SessionEventLike {
  return ev(seq, 'assistant/message', {
    turn,
    step,
    message: { role: 'assistant', content: [{ type: 'text', text: `reply ${seq}` }], source: { kind: 'model' } },
    ...(extra.usage !== undefined ? { usage: extra.usage } : {}),
    ...(extra.interrupted === true ? { interrupted: true } : {}),
  }, { ...(extra.time !== undefined ? { time: extra.time } : {}) })
}

/** The F→M classification input from an event list (window = events between). */
function classifyInput(
  fold: SessionEventLike,
  message: SessionEventLike,
  windowEvents: SessionEventLike[],
  overrides: Partial<ClassifyAttributionInput> = {},
): ClassifyAttributionInput {
  const foldData = fold.data as { source?: { foldId?: string } }
  const messageData = message.data as { turn?: number; step?: number; interrupted?: true }
  return {
    foldId: foldData.source?.foldId ?? 'f?',
    foldSeq: fold.seq,
    ...(fold.time !== undefined ? { foldTime: fold.time } : {}),
    messageSeq: message.seq,
    ...(message.time !== undefined ? { messageTime: message.time } : {}),
    ...(messageData.turn !== undefined ? { messageTurn: messageData.turn } : {}),
    ...(messageData.step !== undefined ? { messageStep: messageData.step } : {}),
    ...(messageData.interrupted === true ? { messageInterrupted: true } : {}),
    windowEvents,
    timeWindowMs: TIME_WINDOW_MS,
    ...overrides,
  }
}

describe('attribution engine: quality grades over a complete window (§Q4.2 rule 3)', () => {
  const fold = foldCommit(5, 'f5', { time: 1000 })
  // message at seq 7 → the complete window for the single-event cases below
  // is exactly the one seq-6 event (span-2 chain); the three-event cases use
  // their own seq-9 message.
  const message = assistantMessage(7, 1, 2, { time: 4000 })

  it('strong: clean window (ordinary message appends only)', () => {
    const lateMessage = assistantMessage(9, 1, 2, { time: 4000 })
    const windowEvents = [
      ev(6, 'tool/result', { message: { role: 'tool', toolCallId: 'c1', content: [] } }),
      ev(7, 'user/message', { id: 'u7', role: 'user', content: [{ type: 'text', text: 'next' }] }),
      ev(8, 'developer/message', { turn: 1, step: 1, message: { role: 'developer', content: [] } }),
    ]
    const attribution = classifyFoldAttribution(classifyInput(fold, lateMessage, windowEvents))
    expect(attribution).toEqual({
      foldId: 'f5',
      foldCommitSeq: 5,
      messageSeq: 9,
      turn: 1,
      step: 2,
      quality: 'strong',
      retryCount: 0,
    })
  })

  it('retry: llm/retry in the window → quality retry with the pollution count', () => {
    const lateMessage = assistantMessage(9, 1, 2, { time: 4000 })
    const windowEvents = [
      ev(6, 'assistant/attempt', { turn: 1, step: 2, stream: [] }),
      ev(7, 'llm/retry', { retryId: 'r1', turn: 1, step: 2, retry: 1 }),
      ev(8, 'llm/retry', { retryId: 'r1', turn: 1, step: 2, retry: 2 }),
    ]
    const attribution = classifyFoldAttribution(classifyInput(fold, lateMessage, windowEvents))
    expect(attribution?.quality).toBe('retry')
    expect(attribution?.retryCount).toBe(2)
  })

  it('weak: an assistant/attempt WITHOUT its llm/retry voucher (unexplained chain disturbance)', () => {
    const windowEvents = [ev(6, 'assistant/attempt', { turn: 1, step: 2, stream: [] })]
    expect(classifyFoldAttribution(classifyInput(fold, message, windowEvents))?.quality).toBe('weak')
  })

  it('weak: compaction/* event in the window (§Q4.3 noise 5, official compaction race)', () => {
    const windowEvents = [ev(6, 'compaction/start', { turn: 1 })]
    expect(classifyFoldAttribution(classifyInput(fold, message, windowEvents))?.quality).toBe('weak')
    const withEnd = [
      ev(6, 'compaction/start', { turn: 1 }),
      ev(7, 'compaction/end', { turn: 1 }),
    ]
    expect(classifyFoldAttribution(classifyInput(fold, message, withEnd))?.quality).toBe('weak')
  })

  it('weak: another surfaceOp replace in the window (foreign producer or a sibling fold commit)', () => {
    const windowEvents = [
      ev(6, 'user/message', { id: 'u6', role: 'user', content: [], source: { kind: 'zctx-fold', foldId: 'f6' } }, {
        surfaceOp: { op: 'replace', startSeq: 0, endSeq: 4 },
        sourceEventSeqs: [0, 1, 2, 3, 4],
      }),
    ]
    expect(classifyFoldAttribution(classifyInput(fold, message, windowEvents))?.quality).toBe('weak')
  })

  it('weak: request/header reason change in the window; other reasons do not break purity', () => {
    const change = [ev(6, 'request/header', { reason: 'change', header: { config: { provider: 'p', model: 'm2' } } })]
    expect(classifyFoldAttribution(classifyInput(fold, message, change))?.quality).toBe('weak')
    const initial = [ev(6, 'request/header', { reason: 'initial', header: { config: { provider: 'p', model: 'm' } } })]
    expect(classifyFoldAttribution(classifyInput(fold, message, initial))?.quality).toBe('strong')
  })

  it('interrupted prefix: attributed and flagged (§Q4.3 noise 7 — input side still real)', () => {
    const interruptedMessage = assistantMessage(6, 1, 2, { time: 4000, interrupted: true })
    const attribution = classifyFoldAttribution(classifyInput(fold, interruptedMessage, []))
    expect(attribution?.quality).toBe('strong')
    expect(attribution?.interrupted).toBe(true)
  })
})

describe('attribution engine: the 8-item noise table (§Q4.3, each disposition mechanically exercised)', () => {
  it('noise 1 retry ring: the attempt does not weaken when the retry voucher is present', () => {
    const fold = foldCommit(3, 'f3')
    const windowEvents = [
      ev(4, 'assistant/attempt', { turn: 0, step: 1, stream: [] }),
      ev(5, 'llm/retry', { retryId: 'r', turn: 0, step: 1, retry: 1 }),
    ]
    const message = assistantMessage(6, 0, 1)
    const attribution = classifyFoldAttribution(classifyInput(fold, message, windowEvents))
    expect(attribution?.quality).toBe('retry')
    expect(attribution?.retryCount).toBe(1)
  })

  it('noise 2 parallel tools: tool/result events in the window are not noise', () => {
    const fold = foldCommit(3, 'f3')
    const windowEvents = [
      ev(4, 'tool/result', { message: { role: 'tool', toolCallId: 'a', content: [] } }),
      ev(5, 'tool/result', { message: { role: 'tool', toolCallId: 'b', content: [] } }),
    ]
    const message = assistantMessage(6, 0, 1)
    expect(classifyFoldAttribution(classifyInput(fold, message, windowEvents))?.quality).toBe('strong')
  })

  it('noise 4 fold tool in step k → the next request is step k+1: M turn/step recorded verbatim', () => {
    const fold = foldCommit(3, 'f3')
    const windowEvents = [
      ev(4, 'tool/result', { message: { role: 'tool', toolCallId: 'a', content: [] } }),
      ev(5, 'tool/result', { message: { role: 'tool', toolCallId: 'b', content: [] } }),
    ]
    const message = assistantMessage(6, 4, 2)
    const attribution = classifyFoldAttribution(classifyInput(fold, message, windowEvents))
    expect(attribution).toMatchObject({ turn: 4, step: 2, quality: 'strong' })
  })

  it('noise 6 runtime-context reprojection: ordinary user/message appends never affect the grade', () => {
    const fold = foldCommit(3, 'f3')
    const windowEvents = [
      ev(4, 'user/message', { id: 'u', role: 'user', content: [{ type: 'text', text: 'runtime refresh' }] }),
    ]
    const message = assistantMessage(5, 1, 1)
    expect(classifyFoldAttribution(classifyInput(fold, message, windowEvents))?.quality).toBe('strong')
  })
})

describe('attribution engine: time-window fallback (§Q4.2 rule 4, config attributionTimeWindowMs)', () => {
  it('broken chain + within window + same turn → weak association with the timeWindow marker', () => {
    const fold = foldCommit(5, 'f5', { time: 1000 })
    // Window MUST cover seqs 6..8; passing only seq 7 breaks the chain.
    const windowEvents = [ev(7, 'user/message', { id: 'u7', role: 'user', content: [] })]
    const message = assistantMessage(9, 3, 1, { time: 30000 })
    const attribution = classifyFoldAttribution(classifyInput(fold, message, windowEvents, { foldTurn: 3 }))
    expect(attribution).toMatchObject({
      quality: 'weak',
      retryCount: 0,
      timeWindow: true,
      turn: 3,
    })
  })

  it('broken chain + time beyond the config window → no association', () => {
    const fold = foldCommit(5, 'f5', { time: 1000 })
    const windowEvents = [ev(7, 'user/message', { id: 'u7', role: 'user', content: [] })]
    const message = assistantMessage(9, 3, 1, { time: 90001 + 1000 })
    expect(classifyFoldAttribution(classifyInput(fold, message, windowEvents, { foldTurn: 3 }))).toBeUndefined()
  })

  it('broken chain + a turn boundary inside the (partial) window → no association', () => {
    const fold = foldCommit(5, 'f5', { time: 1000 })
    const windowEvents = [
      ev(7, 'turn/start', { turn: 8 }),
    ]
    const message = assistantMessage(9, 8, 1, { time: 30000 })
    expect(classifyFoldAttribution(classifyInput(fold, message, windowEvents, { foldTurn: 3 }))).toBeUndefined()
  })

  it('broken chain + fold turn known and different from the message turn → no association', () => {
    const fold = foldCommit(5, 'f5', { time: 1000 })
    const windowEvents = [ev(7, 'user/message', { id: 'u7', role: 'user', content: [] })]
    const message = assistantMessage(9, 9, 1, { time: 30000 })
    expect(classifyFoldAttribution(classifyInput(fold, message, windowEvents, { foldTurn: 3 }))).toBeUndefined()
  })

  it('broken chain + missing event times → no association (honest absence)', () => {
    const fold = foldCommit(5, 'f5')
    const windowEvents = [ev(7, 'user/message', { id: 'u7', role: 'user', content: [] })]
    const message = assistantMessage(9, 3, 1)
    expect(classifyFoldAttribution(classifyInput(fold, message, windowEvents, { foldTurn: 3 }))).toBeUndefined()
  })

  it('complete chain never consults the clock (seq primary key discipline)', () => {
    const fold = foldCommit(5, 'f5', { time: 1000 })
    const windowEvents = [
      ev(6, 'tool/result', { message: { role: 'tool', toolCallId: 'c', content: [] } }),
      ev(7, 'tool/result', { message: { role: 'tool', toolCallId: 'c', content: [] } }),
      ev(8, 'tool/result', { message: { role: 'tool', toolCallId: 'c', content: [] } }),
    ]
    const message = assistantMessage(9, 1, 2, { time: 1000000 }) // far beyond 90s
    expect(classifyFoldAttribution(classifyInput(fold, message, windowEvents))?.quality).toBe('strong')
  })

  it('malformed message envelope (no turn/step) → no association', () => {
    const fold = foldCommit(5, 'f5')
    const message = ev(9, 'assistant/message', { message: { role: 'assistant', content: [] } })
    expect(classifyFoldAttribution(classifyInput(fold, message, []))).toBeUndefined()
  })

  it('batch folds: the earlier commit carries the later one in its window → weak; the last commit → strong', () => {
    const f1 = foldCommit(4, 'f1')
    const f2 = foldCommit(5, 'f2')
    const message = assistantMessage(7, 2, 1)
    const filler = ev(6, 'tool/result', { message: { role: 'tool', toolCallId: 'c', content: [] } })
    // f1's complete window (seqs 5-6) contains f2's replace → weak.
    expect(classifyFoldAttribution(classifyInput(f1, message, [f2, filler]))?.quality).toBe('weak')
    // f2's complete window (seq 6) is clean → strong.
    expect(classifyFoldAttribution(classifyInput(f2, message, [filler]))?.quality).toBe('strong')
  })
})

describe('attribution aggregation: billedInput / clean ratio / observability snapshot', () => {
  it('billedInput = input + read + write (§Q7.2 rule 1口径); absent input → undefined', () => {
    expect(billedInputTokens({ seq: 1, measured: true, state: 'measured', inputTokens: 10, cacheReadTokens: 900, cacheWriteTokens: 100 })).toBe(1010)
    expect(billedInputTokens({ seq: 2, measured: true, state: 'measured', inputTokens: 10 })).toBe(10)
    expect(billedInputTokens({ seq: 3, measured: false, state: 'estimated' })).toBeUndefined()
  })

  it('cleanSampleRatio = strong / (strong + retry + weak); 0 with no evidence', () => {
    const strong: FoldUsageAttribution = { foldId: 'a', foldCommitSeq: 1, messageSeq: 2, turn: 0, step: 0, quality: 'strong', retryCount: 0 }
    const retry: FoldUsageAttribution = { ...strong, foldId: 'b', quality: 'retry', retryCount: 1 }
    const weak: FoldUsageAttribution = { ...strong, foldId: 'c', quality: 'weak', timeWindow: true }
    expect(cleanSampleRatio([strong, retry, weak, strong])).toBeCloseTo(0.5, 9)
    expect(cleanSampleRatio([])).toBe(0)
  })

  it('fold account: strong/retry rows only; weak associations never enter', () => {
    const strong: FoldUsageAttribution = { foldId: 'f-strong', foldCommitSeq: 10, messageSeq: 12, turn: 0, step: 0, quality: 'strong', retryCount: 0 }
    const weak: FoldUsageAttribution = { foldId: 'f-weak', foldCommitSeq: 20, messageSeq: 22, turn: 1, step: 0, quality: 'weak', retryCount: 0, timeWindow: true }
    const snapshot = buildObservabilitySnapshot({
      usageRecords: [{ seq: 12, measured: true, state: 'measured', inputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0 }],
      threeState: { measured: 1, semi: 0, estimated: 0 },
      foldEntries: [
        { foldId: 'f-strong', checkpointSeq: 10, tokensBefore: 10000, tokensAfter: 500 },
        { foldId: 'f-weak', checkpointSeq: 20, tokensBefore: 8000, tokensAfter: 400 },
      ],
      foldAttributions: [strong, weak],
      resetEvents: [],
      assistantMessageSeqs: [12, 22],
    })
    expect(snapshot.breakevenTable).toHaveLength(1)
    expect(snapshot.breakevenTable[0]).toMatchObject({ foldId: 'f-strong', quality: 'strong' })
    // T = billedInput 100 → oneTimeCost = (1−0.1)·100 + 4·500 − 0.1·10000 = 90+2000−1000 = 1090
    // perTurnSaving = 9500·0.1 = 950 → turns = 1090/950.
    expect(snapshot.breakevenTable[0]?.breakevenTurns).toBeCloseTo(1090 / 950, 9)
    expect(snapshot.cleanSampleRatio).toBe(0.5)
  })

  it('estimated repay path: no measured sample → T = σ (tokensAfter), row still computed', () => {
    const strong = { foldId: 'f1', foldCommitSeq: 10, messageSeq: 12, turn: 0, step: 0, quality: 'strong' as const, retryCount: 0 }
    const snapshot = buildObservabilitySnapshot({
      usageRecords: [{ seq: 12, measured: false, state: 'estimated' }],
      threeState: { measured: 0, semi: 0, estimated: 1 },
      foldEntries: [{ foldId: 'f1', checkpointSeq: 10, tokensBefore: 10000, tokensAfter: 500 }],
      foldAttributions: [strong],
      resetEvents: [],
      assistantMessageSeqs: [12],
    })
    // T = σ = 500: oneTime = 0.9·500 + 2000 − 1000 = 1450; saving 950 → 1450/950.
    expect(snapshot.breakevenTable[0]?.breakevenTurns).toBeCloseTo(1450 / 950, 9)
  })

  it('repay event: the max(1,⌈turns⌉)-th post-fold assistant/message; Infinity never repays', () => {
    const strong = { foldId: 'f1', foldCommitSeq: 5, messageSeq: 7, turn: 0, step: 0, quality: 'strong' as const, retryCount: 0 }
    const snapshot = buildObservabilitySnapshot({
      usageRecords: [{ seq: 7, measured: true, state: 'measured', inputTokens: 100 }],
      threeState: { measured: 1, semi: 0, estimated: 0 },
      foldEntries: [{ foldId: 'f1', checkpointSeq: 5, tokensBefore: 10000, tokensAfter: 500 }],
      foldAttributions: [strong],
      resetEvents: [],
      assistantMessageSeqs: [7, 8, 9, 10],
    })
    // turns = 1090/950 ≈ 1.147 → required = 2 → repay event = seq 8.
    expect(snapshot.breakevenTable[0]?.repaid).toBe(true)
    expect(snapshot.breakevenTable[0]?.repayEventSeq).toBe(8)
  })

  it('repay event withheld while the post-fold message count is short', () => {
    const strong = { foldId: 'f1', foldCommitSeq: 5, messageSeq: 7, turn: 0, step: 0, quality: 'strong' as const, retryCount: 0 }
    const snapshot = buildObservabilitySnapshot({
      usageRecords: [{ seq: 7, measured: true, state: 'measured', inputTokens: 100 }],
      threeState: { measured: 1, semi: 0, estimated: 0 },
      foldEntries: [{ foldId: 'f1', checkpointSeq: 5, tokensBefore: 10000, tokensAfter: 500 }],
      foldAttributions: [strong],
      resetEvents: [],
      assistantMessageSeqs: [7],
    })
    expect(snapshot.breakevenTable[0]?.repaid).toBe(false)
    expect(snapshot.breakevenTable[0]?.repayEventSeq).toBeUndefined()
  })

  it('never-repaying fold (saves nothing per turn) reports repaid false', () => {
    const strong = { foldId: 'f1', foldCommitSeq: 5, messageSeq: 7, turn: 0, step: 0, quality: 'strong' as const, retryCount: 0 }
    const snapshot = buildObservabilitySnapshot({
      usageRecords: [{ seq: 7, measured: true, state: 'measured', inputTokens: 4000 }],
      threeState: { measured: 1, semi: 0, estimated: 0 },
      foldEntries: [{ foldId: 'f1', checkpointSeq: 5, tokensBefore: 5000, tokensAfter: 5000 }],
      foldAttributions: [strong],
      resetEvents: [],
      assistantMessageSeqs: [7, 8, 9, 10, 11, 12],
    })
    // perTurnSaving = 0 with positive oneTimeCost → breakevenTurns = Infinity.
    expect(snapshot.breakevenTable[0]?.breakevenTurns).toBe(Number.POSITIVE_INFINITY)
    expect(snapshot.breakevenTable[0]?.repaid).toBe(false)
  })

  it('reset digest: kind × count in first-seen order', () => {
    const snapshot = buildObservabilitySnapshot({
      usageRecords: [],
      threeState: { measured: 0, semi: 0, estimated: 0 },
      foldEntries: [],
      foldAttributions: [],
      resetEvents: [
        { kind: 'compaction', seq: 1, evidence: 'a' },
        { kind: 'model-change', seq: 2, evidence: 'b' },
        { kind: 'compaction', seq: 3, evidence: 'c' },
        { kind: 'series-restart', seq: 4, evidence: 'd' },
        { kind: 'model-change', seq: 5, evidence: 'e' },
      ],
      assistantMessageSeqs: [],
    })
    expect(snapshot.resetSummary).toEqual([
      { kind: 'compaction', count: 2 },
      { kind: 'model-change', count: 2 },
      { kind: 'series-restart', count: 1 },
    ])
    expect(snapshot.threeState).toEqual({ measured: 0, semi: 0, estimated: 0 })
  })
})
