import { describe, expect, it } from 'vitest'

import { validateFold } from '../src/validator.ts'
import type {
  FoldMap,
  FoldRecord,
  SurfaceNode,
  ValidateFoldInput,
  ValidatorConfig,
} from '../src/types.ts'

/** Estimated tokens of an n-char summary (CCM L0 chars/3 ceiling). */
const est = (chars: number): number => Math.ceil(chars / 3)
const text = (chars: number): string => 'x'.repeat(chars)

/** Standard 12-node surface fixture (seqs 1..12, ordered). */
function baseSurface(): SurfaceNode[] {
  return [
    { seq: 1, type: 'system/message', role: 'system', estimatedTokens: 800, isUser: false, textLength: 2400 },
    { seq: 2, type: 'user/message', role: 'user', estimatedTokens: 3000, isUser: true, textLength: 9000 },
    {
      seq: 3, type: 'assistant/message', role: 'assistant', estimatedTokens: 500, isUser: false,
      textLength: 1500, toolCallIds: ['call-a'],
    },
    { seq: 4, type: 'tool/result', role: 'tool', estimatedTokens: 6000, isUser: false, textLength: 18000, answersCallId: 'call-a' },
    { seq: 5, type: 'user/message', role: 'user', estimatedTokens: 200, isUser: true, textLength: 600 },
    { seq: 6, type: 'assistant/message', role: 'assistant', estimatedTokens: 400, isUser: false, textLength: 1200, toolCallIds: [] },
    { seq: 7, type: 'user/message', role: 'user', estimatedTokens: 3000, isUser: true, textLength: 9000 },
    {
      seq: 8, type: 'assistant/message', role: 'assistant', estimatedTokens: 300, isUser: false,
      textLength: 900, toolCallIds: ['call-b'],
    },
    { seq: 9, type: 'tool/result', role: 'tool', estimatedTokens: 4000, isUser: false, textLength: 12000, answersCallId: 'call-b' },
    { seq: 10, type: 'assistant/message', role: 'assistant', estimatedTokens: 500, isUser: false, textLength: 1500, toolCallIds: [] },
    { seq: 11, type: 'user/message', role: 'user', estimatedTokens: 4000, isUser: true, textLength: 12000 },
    { seq: 12, type: 'assistant/message', role: 'assistant', estimatedTokens: 500, isUser: false, textLength: 1500, toolCallIds: [] },
  ]
}

const baseConfig: ValidatorConfig = {
  keepRecentMessages: 2,
  keepRecentTokens: 0,
  protectionFloorTokens: 0,
  minFoldableTokens: 5000,
  maxFoldFraction: 0.6,
  summaryFloorChars: 50,
  summaryCeilingChars: 20000,
  netShrinkTolerance: 1.05,
  contextWindow: 65536,
}

function baseInput(overrides: Partial<ValidateFoldInput> = {}): ValidateFoldInput {
  return {
    foldMap: new Map<string, FoldRecord>(),
    surfaceNodes: baseSurface(),
    range: { startSeq: 3, endSeq: 9 },
    summaries: [{ startSeq: 3, endSeq: 9, text: text(200) }],
    config: baseConfig,
    ...overrides,
  }
}

function record(partial: Partial<FoldRecord>): FoldRecord {
  return {
    foldId: 'f1',
    startSeq: 3,
    endSeq: 9,
    checkpointSeq: 5,
    summaryText: 'old summary',
    shadowedSeqs: [3, 4, 5],
    tokensBefore: 9000,
    tokensAfter: 400,
    ...partial,
  }
}

describe('validator: happy path + plan shape', () => {
  it('accepts a well-formed window with one summary and reports the reclaim plan', () => {
    const result = validateFold(baseInput())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // folded est = 500+6000+200+400+3000+300+4000 = 14400; summary est = ceil(200/3) = 67
    expect(result.plan.reclaimedTokens).toBe(14400 - 67)
    expect(result.plan.folds).toHaveLength(1)
    const entry = result.plan.folds[0]
    expect(entry.startSeq).toBe(3)
    expect(entry.endSeq).toBe(9)
    expect(entry.summaryTokens).toBe(67)
    expect(entry.reclaimedTokens).toBe(14400 - 67)
    expect(entry.absorbedFoldIds).toEqual([])
  })

  it('accepts multiple non-overlapping summaries as separate plan entries', () => {
    const result = validateFold(
      baseInput({
        summaries: [
          { startSeq: 3, endSeq: 4, text: text(150) },
          { startSeq: 5, endSeq: 9, text: text(150) },
        ],
      }),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.folds).toHaveLength(2)
    expect(result.plan.folds[0].reclaimedTokens).toBe(6500 - est(150))
    expect(result.plan.folds[1].reclaimedTokens).toBe(7900 - est(150))
    expect(result.plan.reclaimedTokens).toBe(14400 - 2 * est(150))
  })
})

describe('validator: a. window existence, contiguity, node-0 precheck (S5)', () => {
  it('rejects windows whose endpoints are not surface nodes', () => {
    const result = validateFold(baseInput({ range: { startSeq: 3, endSeq: 99 } }))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reasons.some((r) => r.includes('[3, 99]') && r.includes('surface'))).toBe(true)
  })

  it('rejects inverted windows', () => {
    const result = validateFold(baseInput({ range: { startSeq: 9, endSeq: 3 } }))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reasons.some((r) => r.includes('inverted'))).toBe(true)
  })

  it('rejects windows shadowing no surface node', () => {
    const result = validateFold(baseInput({ range: { startSeq: 20, endSeq: 25 } }))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reasons.some((r) => r.includes('no surface nodes'))).toBe(true)
  })

  it('rejects a non-contiguous in-range set (defensive against unsorted engine scans)', () => {
    const unsorted = baseSurface()
    // Move seq 9 to sit between seq 3 and seq 4 in the array: the seq∈[3..9]
    // set (7 nodes) no longer occupies consecutive positions — a foreign
    // node (seq 4) sits inside the span of the shadowed set.
    const nine = unsorted.splice(8, 1)[0]
    unsorted.splice(3, 0, nine)
    const result = validateFold(baseInput({ surfaceNodes: unsorted }))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reasons.some((r) => r.includes('contiguous'))).toBe(true)
  })

  it('never lets surface node 0 (system head) into the window (S5 precheck)', () => {
    const result = validateFold(baseInput({ range: { startSeq: 1, endSeq: 9 } }))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reasons.some((r) => r.includes('node 0'))).toBe(true)
  })
})

describe('validator: b. protected zones', () => {
  it('rejects windows reaching into the keepRecentMessages tail', () => {
    const result = validateFold(
      baseInput({ config: { ...baseConfig, keepRecentMessages: 4 } }),
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reasons.some((r) => r.includes('protected recent tail'))).toBe(true)
  })

  it('rejects windows reaching into the keepRecentTokens window', () => {
    // 500+4000+500+4000 = 9000 ≥ 5500 first reached at seq 9.
    const result = validateFold(
      baseInput({ config: { ...baseConfig, keepRecentTokens: 5500 } }),
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reasons.some((r) => r.includes('protected recent tail'))).toBe(true)
  })

  it('allows windows ending just below the token-protected window', () => {
    // 500+4000+500 = 5000 ≥ 5000 first reached at seq 10; end 9 stays clear.
    const result = validateFold(
      baseInput({ config: { ...baseConfig, keepRecentTokens: 5000 } }),
    )
    expect(result.ok).toBe(true)
  })

  it('applies protectionFloorTokens as an additional tail floor', () => {
    const result = validateFold(
      baseInput({
        config: { ...baseConfig, keepRecentTokens: 0, protectionFloorTokens: 9000 },
      }),
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reasons.some((r) => r.includes('protected recent tail'))).toBe(true)
  })

  it('protects the whole surface when it fits entirely under protectionFloorTokens', () => {
    // Σ(baseSurface().estimatedTokens) = 23200 < 30000 → the backward token
    // walk runs past node 0 (idx < 0) and the floor branch clamps protection
    // to the whole surface: window [3..9] is rejected as protected tail, and
    // nothing else (exactly one reason).
    const result = validateFold(
      baseInput({
        config: {
          ...baseConfig,
          keepRecentMessages: 0,
          keepRecentTokens: 0,
          protectionFloorTokens: 30000,
        },
      }),
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reasons).toHaveLength(1)
    expect(result.reasons[0]).toContain('protected recent tail')
    expect(result.reasons[0]).toContain('last 0 messages / 30000 tokens')
  })

  it('protects the last user message even inside the foldable band', () => {
    const surface = baseSurface()
    // Drop the trailing assistant so seq 11 (last user) sits in the protected
    // band only by the explicit last-user rule: keepRecentMessages 1 → seq 12.
    const result = validateFold(
      baseInput({
        surfaceNodes: surface,
        range: { startSeq: 3, endSeq: 11 },
        config: { ...baseConfig, keepRecentMessages: 1, keepRecentTokens: 0, protectionFloorTokens: 0 },
        summaries: [{ startSeq: 3, endSeq: 11, text: text(200) }],
      }),
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reasons.some((r) => r.includes('last user message'))).toBe(true)
  })

  it('pins the first user message permanently', () => {
    const result = validateFold(baseInput({ range: { startSeq: 2, endSeq: 9 } }))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reasons.some((r) => r.includes('first user message'))).toBe(true)
  })
})

describe('validator: c. tool-pair closure', () => {
  it('rejects an assistant whose tool result stays outside the window', () => {
    // Window [3..8]: assistant 8 (call-b) inside, its result at seq 9 outside.
    const result = validateFold(baseInput({ range: { startSeq: 3, endSeq: 8 } }))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reasons.some((r) => r.includes('call-b') && r.includes('outside the fold window'))).toBe(true)
  })

  it('rejects a tool result whose assistant call stays outside the window', () => {
    // Window [9..9]: tool 9 answers call-b made by assistant 8 (outside).
    const result = validateFold(baseInput({ range: { startSeq: 9, endSeq: 9 } }))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reasons.some((r) => r.includes('must be folded together'))).toBe(true)
  })

  it('rejects orphan tool results whose call is not on the surface', () => {
    const surface = [
      ...baseSurface(),
      {
        seq: 20, type: 'tool/result', role: 'tool', estimatedTokens: 4000, isUser: false,
        textLength: 12000, answersCallId: 'call-ghost',
      } satisfies SurfaceNode,
    ]
    const result = validateFold(
      baseInput({
        surfaceNodes: surface,
        range: { startSeq: 20, endSeq: 20 },
        summaries: [{ startSeq: 20, endSeq: 20, text: text(200) }],
        config: { ...baseConfig, keepRecentMessages: 1, minFoldableTokens: 100 },
      }),
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reasons.some((r) => r.includes('call-ghost') && r.includes('no assistant message'))).toBe(true)
  })

  it('fails closed on unknown tool pairing inside the window', () => {
    const surface = baseSurface().map((n) =>
      n.seq === 9 ? ({ ...n, answersCallId: undefined }) : n,
    )
    const result = validateFold(baseInput({ surfaceNodes: surface as SurfaceNode[] }))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reasons.some((r) => r.includes('unknown tool pairing'))).toBe(true)
  })

  it('fails closed on an assistant node without toolCallIds inside the window', () => {
    const surface = baseSurface().map((n) =>
      n.seq === 3 ? ({ ...n, toolCallIds: undefined }) : n,
    )
    const result = validateFold(baseInput({ surfaceNodes: surface as SurfaceNode[] }))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reasons.some((r) => r.includes('unknown tool pairing'))).toBe(true)
  })
})

describe('validator: d. nested absorption of active folds', () => {
  it('allows absorbing a checkpoint covered by the submitted summary', () => {
    const foldMap: FoldMap = new Map([['f1', record({ checkpointSeq: 5 })]])
    const result = validateFold(baseInput({ foldMap }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.folds[0].absorbedFoldIds).toEqual(['f1'])
  })

  it('allows a checkpoint aligned with the window boundary (end)', () => {
    const foldMap: FoldMap = new Map([['f1', record({ checkpointSeq: 9 })]])
    const result = validateFold(
      baseInput({
        foldMap,
        summaries: [{ startSeq: 3, endSeq: 8, text: text(200) }],
      }),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.folds[result.plan.folds.length - 1].absorbedFoldIds).toEqual(['f1'])
  })

  it('rejects an absorbed checkpoint covered by neither summary nor boundary', () => {
    const foldMap: FoldMap = new Map([['f1', record({ checkpointSeq: 6 })]])
    const result = validateFold(
      baseInput({
        foldMap,
        summaries: [
          { startSeq: 3, endSeq: 5, text: text(150) },
          { startSeq: 7, endSeq: 9, text: text(150) },
        ],
      }),
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reasons.some((r) => r.includes('f1') && r.includes('checkpoint seq 6'))).toBe(true)
  })
})

describe('validator: e. summaries + net-shrink gate', () => {
  it('rejects an empty summary list', () => {
    const result = validateFold(baseInput({ summaries: [] }))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reasons.some((r) => r.includes('no summaries submitted'))).toBe(true)
  })

  it('rejects summaries outside the fold window', () => {
    const result = validateFold(
      baseInput({ summaries: [{ startSeq: 2, endSeq: 9, text: text(200) }] }),
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reasons.some((r) => r.includes('must sit inside the fold window'))).toBe(true)
  })

  it('rejects inverted summary ranges under the containment rule', () => {
    const result = validateFold(
      baseInput({ summaries: [{ startSeq: 9, endSeq: 3, text: text(200) }] }),
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reasons.some((r) => r.includes('must sit inside the fold window'))).toBe(true)
  })

  it('rejects overlapping summary ranges', () => {
    const result = validateFold(
      baseInput({
        summaries: [
          { startSeq: 3, endSeq: 6, text: text(150) },
          { startSeq: 6, endSeq: 9, text: text(150) },
        ],
      }),
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reasons.some((r) => r.includes('overlap'))).toBe(true)
  })

  it('enforces the summary length window (floor and ceiling)', () => {
    const short = validateFold(baseInput({ summaries: [{ startSeq: 3, endSeq: 9, text: text(10) }] }))
    expect(short.ok).toBe(false)
    if (!short.ok) expect(short.reasons.some((r) => r.includes('minimum is 50'))).toBe(true)

    const long = validateFold(
      baseInput({ summaries: [{ startSeq: 3, endSeq: 9, text: text(20001) }] }),
    )
    expect(long.ok).toBe(false)
    if (!long.ok) expect(long.reasons.some((r) => r.includes('maximum is 20000'))).toBe(true)
  })

  it('rejects windows whose summary would grow the ledger (tolerance boundary inclusive)', () => {
    // folded 600 × 1.05 = 630; summary est 630 (text 1890 chars) → 630 ≤ 630 → reject.
    const result = validateFold(
      baseInput({
        range: { startSeq: 5, endSeq: 6 },
        summaries: [{ startSeq: 5, endSeq: 6, text: text(1890) }],
        config: { ...baseConfig, minFoldableTokens: 100 },
      }),
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reasons.some((r) => r.includes('grow the window'))).toBe(true)
  })
})

describe('validator: f. size gates', () => {
  it('rejects windows under the minFoldableTokens qualification line', () => {
    const result = validateFold(baseInput({ range: { startSeq: 5, endSeq: 6 } }))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reasons.some((r) => r.includes('qualification line is 5000'))).toBe(true)
  })

  it('rejects windows above maxFoldFraction × contextWindow', () => {
    const surface = [
      ...baseSurface(),
      {
        seq: 15, type: 'assistant/message', role: 'assistant', estimatedTokens: 50000,
        isUser: false, textLength: 150000, toolCallIds: [],
      } satisfies SurfaceNode,
    ]
    const result = validateFold(
      baseInput({
        surfaceNodes: surface,
        range: { startSeq: 15, endSeq: 15 },
        summaries: [{ startSeq: 15, endSeq: 15, text: text(200) }],
        config: { ...baseConfig, keepRecentMessages: 0, keepRecentTokens: 0, protectionFloorTokens: 0, minFoldableTokens: 100 },
      }),
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reasons.some((r) => r.includes('60% of the context window'))).toBe(true)
  })

  it('skips the maxFoldFraction check when no contextWindow is supplied', () => {
    const surface = [
      ...baseSurface(),
      {
        seq: 15, type: 'assistant/message', role: 'assistant', estimatedTokens: 50000,
        isUser: false, textLength: 150000, toolCallIds: [],
      } satisfies SurfaceNode,
    ]
    const { contextWindow: _cw, ...configWithoutWindow } = baseConfig
    const result = validateFold(
      baseInput({
        surfaceNodes: surface,
        range: { startSeq: 15, endSeq: 15 },
        summaries: [{ startSeq: 15, endSeq: 15, text: text(200) }],
        config: { ...configWithoutWindow, keepRecentMessages: 0, keepRecentTokens: 0, protectionFloorTokens: 0, minFoldableTokens: 100 },
      }),
    )
    expect(result.ok).toBe(true)
  })
})

describe('validator: g. atomicity + structural input', () => {
  it('collects ALL reasons in one rejection (never partial acceptance)', () => {
    const result = validateFold(
      baseInput({
        range: { startSeq: 1, endSeq: 9 },
        summaries: [{ startSeq: 2, endSeq: 9, text: text(10) }],
        config: { ...baseConfig, keepRecentTokens: 9000 },
      }),
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    // node-0 + first-user pin + protected tail + short summary at minimum.
    expect(result.reasons.length).toBeGreaterThanOrEqual(4)
    expect(result.reasons.some((r) => r.includes('node 0'))).toBe(true)
    expect(result.reasons.some((r) => r.includes('first user message'))).toBe(true)
    expect(result.reasons.some((r) => r.includes('protected recent tail'))).toBe(true)
    expect(result.reasons.some((r) => r.includes('minimum is 50'))).toBe(true)
  })

  it('throws TypeError on structurally malformed input', () => {
    expect(() => validateFold(baseInput({ surfaceNodes: 'nope' as unknown as SurfaceNode[] }))).toThrow(TypeError)
    expect(() => validateFold(baseInput({ foldMap: {} as unknown as FoldMap }))).toThrow(TypeError)
    expect(() => validateFold(baseInput({ summaries: undefined as unknown as ValidateFoldInput['summaries'] }))).toThrow(TypeError)
    expect(() =>
      validateFold(
        baseInput({
          surfaceNodes: [{ ...baseSurface()[0], seq: 1.5 }],
        }),
      ),
    ).toThrow(TypeError)
  })
})
