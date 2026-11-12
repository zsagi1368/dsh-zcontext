import { describe, expect, it } from 'vitest'

import { crossedThresholds, nudgeContextText, renderNudge } from '../src/nudge.ts'
import { computeBudget } from '../src/budget.ts'
import type { Budget, NudgeRange } from '../src/types.ts'

const budget: Budget = computeBudget({ contextWindow: 65536 })

const ranges: NudgeRange[] = [
  { startSeq: 3, endSeq: 9, estimatedTokens: 14400, protected: false },
  { startSeq: 11, endSeq: 20, estimatedTokens: 8000, protected: true, protectedReason: 'recent tail' },
]

describe('nudge: crossedThresholds', () => {
  it('reports a threshold crossed on a strict rise', () => {
    expect(crossedThresholds(10, 30, [25, 50, 75, 90])).toEqual([25])
    expect(crossedThresholds(24, 25, [25])).toEqual([25])
  })

  it('does not report a threshold already reached at prev', () => {
    expect(crossedThresholds(25, 30, [25])).toEqual([])
    expect(crossedThresholds(90, 90, [25, 50, 75, 90])).toEqual([])
  })

  it('reports every crossing of a large rise, ascending and deduplicated', () => {
    expect(crossedThresholds(10, 95, [90, 25, 75, 50, 25, 50])).toEqual([25, 50, 75, 90])
  })

  it('crosses nothing when pressure falls', () => {
    expect(crossedThresholds(95, 10, [25, 50, 75, 90])).toEqual([])
  })

  it('throws TypeError on non-finite inputs', () => {
    expect(() => crossedThresholds(Number.NaN, 10, [25])).toThrow(TypeError)
    expect(() => crossedThresholds(10, Number.POSITIVE_INFINITY, [25])).toThrow(TypeError)
    expect(() => crossedThresholds(10, 20, 'no' as unknown as number[])).toThrow(TypeError)
  })
})

describe('nudge: renderNudge (pure, deterministic)', () => {
  it('renders identical bytes for identical inputs', () => {
    const a = renderNudge(47.3, budget, ranges, 'gentle')
    const b = renderNudge(47.3, budget, ranges, 'gentle')
    expect(a).toBe(b)
  })

  it('carries pressure, trigger line, and the budget breakdown', () => {
    const text = renderNudge(47.3, budget, ranges, 'gentle')
    expect(text).toContain('[context pressure: 47.3% — gentle reminder]')
    // 64k budget: triggerLine 52021/65536 = 79.4%; keepRecent 19660/65536 = 30.0%;
    // pessimisticReserve 13515/65536 = 20.6%.
    expect(text).toContain('the fold trigger line sits at 79.4%')
    expect(text).toContain('recent-tail reserve: 30.0%')
    expect(text).toContain('output and tool reserve: 20.6%')
    expect(text).toContain('fixed tool+guidance overhead:')
    expect(text).toContain('Budget breakdown (share of the context window):')
  })

  it('renders the span table with PROTECTED marks and reasons', () => {
    const text = renderNudge(47.3, budget, ranges, 'gentle')
    expect(text).toContain('  - seq 3..9 (~14400 tokens)')
    expect(text).toContain('  - seq 11..20 (~8000 tokens) PROTECTED (recent tail)')
    expect(text).toContain('Foldable spans (estimated tokens):')
  })

  it('falls back to the empty-table row when no spans are supplied', () => {
    const text = renderNudge(47.3, budget, [], 'gentle')
    expect(text).toContain('  (no foldable spans reported)')
  })

  it('switches header and closing line with the voice band', () => {
    const gentle = renderNudge(47.3, budget, ranges, 'gentle')
    expect(gentle).toContain('gentle reminder')
    expect(gentle).toContain('stay ahead of the trigger line')
    const emergency = renderNudge(91.2, budget, ranges, 'emergency')
    expect(emergency).toContain('[context pressure: 91.2% — EMERGENCY]')
    expect(emergency).toContain('Fold the largest unprotected spans immediately')
    expect(emergency).not.toContain('gentle reminder')
  })

  it('always carries the atomic batch reminder and the ledger pointer', () => {
    for (const voice of ['gentle', 'emergency'] as const) {
      const text = renderNudge(60, budget, ranges, voice)
      expect(text).toContain('Submit ALL ranges and their summaries in ONE zctx_fold call')
      expect(text).toContain('zctx_status first')
    }
  })

  it('throws TypeError on malformed inputs', () => {
    expect(() => renderNudge(Number.NaN, budget, ranges, 'gentle')).toThrow(TypeError)
    expect(() => renderNudge(50, null as unknown as Budget, ranges, 'gentle')).toThrow(TypeError)
    expect(() => renderNudge(50, budget, 'no' as unknown as NudgeRange[], 'gentle')).toThrow(TypeError)
  })
})

describe('nudge: suppression (B2 — required:true context, empty = no-op)', () => {
  it('suppresses to empty text when no threshold is crossed', () => {
    expect(nudgeContextText(10, 20, [25, 50, 75, 90], budget, ranges)).toBe('')
    expect(nudgeContextText(47.3, 47.3, [25, 50, 75, 90], budget, ranges)).toBe('')
    expect(nudgeContextText(95, 10, [25, 50, 75, 90], budget, ranges)).toBe('')
  })

  it('renders gentle voice on sub-90 crossings', () => {
    const text = nudgeContextText(10, 51, [25, 50, 75, 90], budget, ranges)
    expect(text).toContain('gentle reminder')
    expect(text).not.toContain('EMERGENCY')
  })

  it('escalates to emergency voice at ≥90 crossings or pressure', () => {
    expect(nudgeContextText(80, 91, [25, 50, 75, 90], budget, ranges)).toContain('EMERGENCY')
    expect(nudgeContextText(10, 92, [25, 50], budget, ranges)).toContain('EMERGENCY')
  })

  it('changes its bytes only when the crossing set or the table changes', () => {
    const at50 = nudgeContextText(10, 51, [25, 50, 75, 90], budget, ranges)
    const at75 = nudgeContextText(51, 76, [25, 50, 75, 90], budget, ranges)
    expect(at50).not.toBe(at75) // crossing → new snapshot (cache re-pay, accounted)
    const again = nudgeContextText(51, 51.4, [25, 50, 75, 90], budget, ranges)
    expect(again).toBe('') // steady state → no-op
  })
})
