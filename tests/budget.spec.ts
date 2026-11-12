import { describe, expect, it } from 'vitest'

import {
  BATCH_CAP,
  CHARS_PER_TOKEN,
  DEFAULT_BREAKEVEN_PRICE,
  DEFAULT_MAX_OUTPUT_CAP,
  FIXED_WIRE_OVERHEAD_TOKENS,
  PER_TOOL_SCHEMA_ESTIMATE_TOKENS,
  ZCTX_TOOL_COUNT,
  computeBreakevenReport,
  computeBudget,
  estimateFixedWireOverhead,
  estimateTokens,
} from '../src/budget.ts'
import { GUIDANCE_SECTION_TEXT } from '../src/texts.ts'

/**
 * Budget lock table (task card W2 §1): every row is transcribed from the CCM
 * v2.3 §1.3 authoritative table (CONTEXT-CACHE-MANAGEMENT.md, produced by
 * tools/budget_table.py v3). Tolerances per card: ±2 on integer fields,
 * ±0.002 on rMin.
 *
 * Note on the 200k row: the authoritative row reproduces only with W=204800
 * (triggerLine 175616 = 204800 − 29184); no output cap can produce it from
 * W=200704, so the table's own geometry is used (card: "从权威表推").
 * The 1M rows carry explicit caps (C=65536 / C=131072); all other rows use
 * the CCM default cap 32768, which never binds below W≥327680.
 */
const LOCK_TABLE: ReadonlyArray<{
  readonly name: string
  readonly w: number
  readonly c?: number
  readonly maxTokens: number
  readonly reserve: number
  readonly toolCap: number
  readonly pessimisticReserve: number
  readonly triggerLine: number
  readonly keepRecent: number
  readonly summaryInputCap: number
  readonly summaryOutputCap: number
  readonly replyCap: number
  readonly rMin: number
}> = [
  // 16k — rejection domain of CCM §1.1; reference-only row (formula still computed).
  {
    name: '16k (reference, CCM rejection domain)',
    w: 16384,
    maxTokens: 1638,
    reserve: 6144,
    toolCap: 1126,
    pessimisticReserve: 7986,
    triggerLine: 8398,
    keepRecent: 4915,
    summaryInputCap: 3483,
    summaryOutputCap: 1638,
    replyCap: 2048,
    rMin: 0.763,
  },
  {
    name: '32k',
    w: 32768,
    maxTokens: 3276,
    reserve: 8191,
    toolCap: 1228,
    pessimisticReserve: 9828,
    triggerLine: 22940,
    keepRecent: 9830,
    summaryInputCap: 13110,
    summaryOutputCap: 3276,
    replyCap: 2048,
    rMin: 0.825,
  },
  {
    name: '64k',
    w: 65536,
    maxTokens: 6553,
    reserve: 12288,
    toolCap: 1433,
    pessimisticReserve: 13515,
    triggerLine: 52021,
    keepRecent: 19660,
    summaryInputCap: 32361,
    summaryOutputCap: 6553,
    replyCap: 2048,
    rMin: 0.856,
  },
  {
    name: '128k',
    w: 131072,
    maxTokens: 13107,
    reserve: 20480,
    toolCap: 1843,
    pessimisticReserve: 20889,
    triggerLine: 110183,
    keepRecent: 20000,
    summaryInputCap: 90183,
    summaryOutputCap: 8192,
    replyCap: 2048,
    rMin: 0.872,
  },
  {
    name: '200k',
    w: 204800,
    maxTokens: 20480,
    reserve: 29696,
    toolCap: 2304,
    pessimisticReserve: 29184,
    triggerLine: 175616,
    keepRecent: 24576,
    summaryInputCap: 151040,
    summaryOutputCap: 8192,
    replyCap: 2304,
    rMin: 0.878,
  },
  {
    name: '1M cap64k',
    w: 1048576,
    c: 65536,
    maxTokens: 65536,
    reserve: 86016,
    toolCap: 5120,
    pessimisticReserve: 79872,
    triggerLine: 968704,
    keepRecent: 125829,
    summaryInputCap: 842875,
    summaryOutputCap: 10485,
    replyCap: 5120,
    rMin: 0.928,
  },
  {
    name: '1M cap128k',
    w: 1048576,
    c: 131072,
    maxTokens: 104857,
    reserve: 135168,
    toolCap: 7577,
    pessimisticReserve: 124107,
    triggerLine: 924469,
    keepRecent: 125829,
    summaryInputCap: 798640,
    summaryOutputCap: 10485,
    replyCap: 7577,
    rMin: 0.886,
  },
]

const INT_TOLERANCE = 2
const RMIN_TOLERANCE = 0.002

describe('budget: CCM v2.3 lock table (7 cases)', () => {
  for (const row of LOCK_TABLE) {
    it(`reproduces the authoritative row: ${row.name}`, () => {
      const b = computeBudget({ contextWindow: row.w, maxOutput: row.c })
      expect(Math.abs(b.maxTokens - row.maxTokens)).toBeLessThanOrEqual(INT_TOLERANCE)
      expect(Math.abs(b.reserve - row.reserve)).toBeLessThanOrEqual(INT_TOLERANCE)
      expect(Math.abs(b.toolCap - row.toolCap)).toBeLessThanOrEqual(INT_TOLERANCE)
      expect(Math.abs(b.pessimisticReserve - row.pessimisticReserve)).toBeLessThanOrEqual(
        INT_TOLERANCE,
      )
      expect(Math.abs(b.triggerLine - row.triggerLine)).toBeLessThanOrEqual(INT_TOLERANCE)
      expect(Math.abs(b.keepRecent - row.keepRecent)).toBeLessThanOrEqual(INT_TOLERANCE)
      expect(Math.abs(b.summaryInputCap - row.summaryInputCap)).toBeLessThanOrEqual(INT_TOLERANCE)
      expect(Math.abs(b.summaryOutputCap - row.summaryOutputCap)).toBeLessThanOrEqual(INT_TOLERANCE)
      expect(Math.abs(b.replyCap - row.replyCap)).toBeLessThanOrEqual(INT_TOLERANCE)
      expect(Math.abs(b.rMin - row.rMin)).toBeLessThanOrEqual(RMIN_TOLERANCE)
    })
  }

  it('pins the 64k rMin at full precision (1 − 9419/65536)', () => {
    expect(computeBudget({ contextWindow: 65536 }).rMin).toBeCloseTo(0.8562774658203125, 12)
  })

  it('computes the 16k rejection domain instead of refusing (trigger ≈ 51.3%, reference only)', () => {
    const b = computeBudget({ contextWindow: 16384 })
    const triggerPct = (b.triggerLine / b.contextWindow) * 100
    expect(triggerPct).toBeGreaterThanOrEqual(51.3 - 0.1)
    expect(triggerPct).toBeLessThanOrEqual(51.3 + 0.1)
  })

  it('defaults the output cap to the CCM default tier 32768', () => {
    expect(DEFAULT_MAX_OUTPUT_CAP).toBe(32768)
    const b = computeBudget({ contextWindow: 131072 })
    expect(b.maxOutputCap).toBe(32768)
  })

  it('rejects non-finite, negative, or fractional windows/caps', () => {
    expect(() => computeBudget({ contextWindow: Number.NaN })).toThrow(TypeError)
    expect(() => computeBudget({ contextWindow: 65536.5 })).toThrow(TypeError)
    expect(() => computeBudget({ contextWindow: -1 })).toThrow(TypeError)
    expect(() => computeBudget({ contextWindow: 65536, maxOutput: Number.POSITIVE_INFINITY })).toThrow(
      TypeError,
    )
  })

  it('rejects the zero window (rMin would divide by zero to -Infinity)', () => {
    expect(() => computeBudget({ contextWindow: 0 })).toThrow(TypeError)
  })

  it('rejects windows that cannot sustain their own pessimistic reserve (W=1)', () => {
    // W=1 with the default cap degenerates: maxTokens 0 → toolCap 1024 →
    // R_pess 6144 → triggerLine -6143 → keepRecent -4915 (reviewer-measured
    // pre-rework). The degenerate-window guard rejects it instead.
    expect(() => computeBudget({ contextWindow: 1 })).toThrow(TypeError)
  })

  it('keeps the 32k window computable with exact CCM values (just above the degeneracy line)', () => {
    const b = computeBudget({ contextWindow: 32768 })
    expect(b.triggerLine).toBe(22940)
    expect(b.keepRecent).toBe(9830)
    expect(b.summaryInputCap).toBe(13110)
    expect(Number.isFinite(b.rMin)).toBe(true)
    expect(b.rMin).toBeGreaterThan(0)
    expect(b.keepRecent).toBeGreaterThanOrEqual(0)
  })
})

describe('budget: fixed wire overhead (S1)', () => {
  it('estimates tokens with the CCM L0 chars/3 ceiling estimator', () => {
    expect(CHARS_PER_TOKEN).toBe(3)
    expect(estimateTokens('')).toBe(0)
    expect(estimateTokens('abc')).toBe(1)
    expect(estimateTokens('abcd')).toBe(2)
    expect(estimateTokens('a'.repeat(301))).toBe(101)
  })

  it('sums section estimates', () => {
    expect(estimateFixedWireOverhead(['abc', 'abc'])).toBe(2)
    expect(estimateFixedWireOverhead([])).toBe(0)
  })

  it('accounts the guidance section plus four tool schema estimates', () => {
    const guidance = estimateTokens(GUIDANCE_SECTION_TEXT)
    expect(FIXED_WIRE_OVERHEAD_TOKENS).toBe(guidance + ZCTX_TOOL_COUNT * PER_TOOL_SCHEMA_ESTIMATE_TOKENS)
    expect(ZCTX_TOOL_COUNT).toBe(4)
    expect(FIXED_WIRE_OVERHEAD_TOKENS).toBeGreaterThan(guidance)
  })

  it('is a stable module constant (same value on every budget computation)', () => {
    const a = computeBudget({ contextWindow: 65536 }).fixedWireOverhead
    const b = computeBudget({ contextWindow: 1048576, maxOutput: 65536 }).fixedWireOverhead
    expect(a).toBe(FIXED_WIRE_OVERHEAD_TOKENS)
    expect(b).toBe(FIXED_WIRE_OVERHEAD_TOKENS)
  })

  it('does not modify the CCM trigger math (triggerLine stays W − R_pess)', () => {
    const b = computeBudget({ contextWindow: 131072 })
    expect(b.triggerLine).toBe(131072 - (b.maxTokens + BATCH_CAP * b.toolCap + 4096))
  })
})

describe('budget: breakeven report (VERIFY-C #15 formula)', () => {
  it('freezes the VERIFY-C #15 default price factors', () => {
    expect(DEFAULT_BREAKEVEN_PRICE).toEqual({ w: 1.0, r: 0.1, q: 4.0 })
  })

  it('reproduces the kernel formula oneTimeCost = (w−r)·T + q·σ − r·S', () => {
    // Hand-computed example, defaults: (1.0−0.1)·8000 + 4.0·500 − 0.1·10000
    //   = 7200 + 2000 − 1000 = 8200; saving = 9500·0.1 = 950.
    const report = computeBreakevenReport({
      folded: { tokens: 10000, measured: true },
      summary: { tokens: 500, measured: true },
      repay: { tokens: 8000, measured: true },
    })
    expect(report.oneTimeCost).toBeCloseTo(8200, 9)
    expect(report.perTurnSaving).toBeCloseTo(950, 9)
    expect(report.breakevenTurns).toBeCloseTo(8200 / 950, 9)
    expect(report.netTokens).toBe(9500)
    expect(report.measured).toBe(true)
    expect(report.estimatedInputs).toEqual([])
  })

  it('honors custom price factors (w=1.25 write-premium route)', () => {
    const report = computeBreakevenReport({
      folded: { tokens: 20000, measured: true },
      summary: { tokens: 1000, measured: true },
      repay: { tokens: 12000, measured: true },
      price: { w: 1.25, r: 0.1, q: 4.0 },
    })
    // (1.25−0.1)·12000 + 4·1000 − 0.1·20000 = 13800 + 4000 − 2000 = 15800
    expect(report.oneTimeCost).toBeCloseTo(15800, 9)
    expect(report.perTurnSaving).toBeCloseTo(1900, 9)
  })

  it('labels estimated inputs (S6 measured/estimated two-state)', () => {
    const report = computeBreakevenReport({
      folded: { tokens: 10000, measured: false },
      summary: { tokens: 500, measured: true },
      repay: { tokens: 8000, measured: false },
    })
    expect(report.measured).toBe(false)
    expect(report.estimatedInputs).toEqual(['folded', 'repay'])
  })

  it('returns Infinity when a fold saves nothing per turn and still costs something', () => {
    const report = computeBreakevenReport({
      folded: { tokens: 5000, measured: true },
      summary: { tokens: 5000, measured: true },
      repay: { tokens: 4000, measured: true },
    })
    expect(report.netTokens).toBe(0)
    expect(report.perTurnSaving).toBe(0)
    expect(report.oneTimeCost).toBeGreaterThan(0)
    expect(report.breakevenTurns).toBe(Number.POSITIVE_INFINITY)
  })

  it('returns 0 turns when the fold is profitable immediately (no repay, no summary)', () => {
    const report = computeBreakevenReport({
      folded: { tokens: 10000, measured: true },
      summary: { tokens: 0, measured: true },
      repay: { tokens: 0, measured: true },
    })
    expect(report.oneTimeCost).toBeCloseTo(-1000, 9)
    expect(report.breakevenTurns).toBe(0)
  })

  it('never returns a negative breakeven when oneTimeCost is negative but saving is positive', () => {
    const report = computeBreakevenReport({
      folded: { tokens: 100000, measured: true },
      summary: { tokens: 100, measured: true },
      repay: { tokens: 100, measured: true },
    })
    expect(report.breakevenTurns).toBeGreaterThanOrEqual(0)
  })

  it('rejects invalid amounts and prices', () => {
    expect(() =>
      computeBreakevenReport({
        folded: { tokens: -1, measured: true },
        summary: { tokens: 0, measured: true },
        repay: { tokens: 0, measured: true },
      }),
    ).toThrow(TypeError)
    expect(() =>
      computeBreakevenReport({
        folded: { tokens: 10.5, measured: true },
        summary: { tokens: 0, measured: true },
        repay: { tokens: 0, measured: true },
      }),
    ).toThrow(TypeError)
    expect(() =>
      computeBreakevenReport({
        folded: { tokens: 10, measured: 'yes' as unknown as boolean },
        summary: { tokens: 0, measured: true },
        repay: { tokens: 0, measured: true },
      }),
    ).toThrow(TypeError)
    expect(() =>
      computeBreakevenReport({
        folded: { tokens: 10, measured: true },
        summary: { tokens: 0, measured: true },
        repay: { tokens: 0, measured: true },
        price: { r: -0.5 },
      }),
    ).toThrow(TypeError)
    expect(() =>
      computeBreakevenReport({
        folded: { tokens: 10, measured: true },
        summary: { tokens: 0, measured: true },
        repay: { tokens: 0, measured: true },
        price: { q: Number.NaN },
      }),
    ).toThrow(TypeError)
  })
})
