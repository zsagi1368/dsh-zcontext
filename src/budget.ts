/**
 * Budget engine — CCM v2.3 §1.2 unified formulas over one context window,
 * locked against the §1.3 authoritative table (7 cases, ±2 integer / ±0.002
 * rMin tolerance) by tests/budget.spec.ts. Integer math uses explicit
 * floor/ceil exactly as the table was generated (tools/budget_table.py v3):
 *
 *   maxTokens   = min(C, floor(W×0.10))
 *   reserve     = ceil(maxTokens×1.25) + 4096
 *   toolCap     = max(1024, floor(0.25×(reserve−maxTokens)))
 *   R_pess      = maxTokens + BATCH_CAP(2)×toolCap + 4096
 *   triggerLine = W − R_pess
 *   keepRecent  = min(max(⌊0.12W⌋, min(20000, ⌊0.30W⌋)), ⌊0.8×triggerLine⌋)
 *   summaryIn   = triggerLine − keepRecent
 *   summaryOut  = min(C, maxTokens, ⌊0.8×reserve⌋, max(8192, ⌊0.01W⌋))
 *   replyCap    = max(2048, floor(0.25×(reserve−maxTokens)))
 *   rMin        = 1 − (maxTokens + 2×toolCap)/W
 *
 * Plus the S1 accounting item: the fixed wire overhead of the four zctx tool
 * schemas and the static guidance section, estimated with the CCM L0 chars/3
 * text estimator. The overhead is reported on the budget; it does NOT modify
 * the CCM trigger math (the lock table stays byte-comparable to CCM v2.3).
 *
 * Small windows are computed, never rejected here: the W<32768 rejection of
 * CCM §1.1 is an engine-layer policy (the 16k reference case in the lock
 * table pins the formula output instead). Degenerate windows, however, are
 * outside the formula domain and throw TypeError: a window that cannot
 * sustain its own pessimistic reserve drives triggerLine (and with it
 * keepRecent) negative, and W = 0 drives rMin to -Infinity (division by W).
 *
 * Zero host imports; pure functions only.
 *
 * @module budget
 */

import type { Budget, BreakevenAmount, BreakevenInput, BreakevenReport, BreakevenPrice } from './types.ts'
import { GUIDANCE_SECTION_TEXT } from './texts.ts'

/** Output hard cap applied when the caller does not supply one (CCM §1.1). */
export const DEFAULT_MAX_OUTPUT_CAP = 32768

/** BATCH_CAP of the pessimistic reserve (CCM §1.2 note 1). */
export const BATCH_CAP = 2

/** Text-to-token estimator ratio: 3 characters per token, ASCII-dense (CCM L0). */
export const CHARS_PER_TOKEN = 3

/**
 * Estimated token cost of ONE zctx tool schema on the wire (JSON of the
 * schema + tool name/description). Estimate, not measurement — the W4
 * definitions are the authority; kept conservative and reviewed at W4.
 */
export const PER_TOOL_SCHEMA_ESTIMATE_TOKENS = 512

/** Number of zctx tools registered (zctx_fold/unfold/recall/status). */
export const ZCTX_TOOL_COUNT = 4

/**
 * Estimate the token cost of a text with the CCM L0 chars/3 conservative
 * estimator (ceiling — never under-count on the wire).
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN)
}

/**
 * Estimate the fixed wire overhead of the given text sections (S1): the
 * summed token estimate of every section.
 */
export function estimateFixedWireOverhead(sections: readonly string[]): number {
  let total = 0
  for (const section of sections) total += estimateTokens(section)
  return total
}

/**
 * Fixed wire overhead of the plugin itself: the static guidance section plus
 * the four tool schema estimates (S1 accounting item).
 */
export const FIXED_WIRE_OVERHEAD_TOKENS: number =
  estimateFixedWireOverhead([GUIDANCE_SECTION_TEXT]) +
  ZCTX_TOOL_COUNT * PER_TOOL_SCHEMA_ESTIMATE_TOKENS

/**
 * Assert a finite non-negative integer token/window amount.
 * @internal
 */
function assertAmount(value: number, name: string): void {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
    throw new TypeError(`${name} must be a finite non-negative integer, got ${String(value)}`)
  }
}

/**
 * Compute the full budget report for one context window.
 *
 * @param input - `contextWindow` W (integer ≥ 1, and large enough to sustain
 *   the CCM reserve structure: windows below the degeneracy line — W = 0 or
 *   triggerLine < 0 — throw TypeError) and optional output cap C (finite
 *   integer ≥ 0; defaults to the CCM default tier 32768).
 */
export function computeBudget(input: {
  contextWindow: number
  maxOutput?: number
}): Budget {
  const { contextWindow: w } = input
  assertAmount(w, 'contextWindow')
  const c = input.maxOutput ?? DEFAULT_MAX_OUTPUT_CAP
  assertAmount(c, 'maxOutput')

  const maxTokens = Math.min(c, Math.floor(w * 0.10))
  const reserve = Math.ceil(maxTokens * 1.25) + 4096
  const toolCap = Math.max(1024, Math.floor(0.25 * (reserve - maxTokens)))
  const pessimisticReserve = maxTokens + BATCH_CAP * toolCap + 4096
  const triggerLine = w - pessimisticReserve
  const keepRecent = Math.min(
    Math.max(Math.floor(w * 0.12), Math.min(20000, Math.floor(w * 0.30))),
    Math.floor(0.8 * triggerLine),
  )
  const summaryInputCap = triggerLine - keepRecent
  const summaryOutputCap = Math.min(
    c,
    maxTokens,
    Math.floor(0.8 * reserve),
    Math.max(8192, Math.floor(w * 0.01)),
  )
  const replyCap = Math.max(2048, Math.floor(0.25 * (reserve - maxTokens)))
  const rMin = 1 - (maxTokens + BATCH_CAP * toolCap) / w

  // Degenerate-window guard (W2 rework F1): a window smaller than its own
  // pessimistic reserve drives triggerLine (and with it keepRecent) negative,
  // and W = 0 drives rMin to -Infinity — both outside the meaningful domain
  // of the CCM §1.2 formulas. The engine-layer W<32768 rejection (CCM §1.1)
  // sits far above this line; every authoritative lock-table row (16k and
  // up) passes it.
  if (triggerLine < 0 || keepRecent < 0 || !Number.isFinite(rMin)) {
    throw new TypeError(
      `contextWindow ${w} cannot sustain the CCM reserve structure ` +
        `(triggerLine ${triggerLine}, keepRecent ${keepRecent}, rMin ${rMin})`,
    )
  }

  return {
    contextWindow: w,
    maxOutputCap: c,
    maxTokens,
    reserve,
    toolCap,
    pessimisticReserve,
    triggerLine,
    keepRecent,
    summaryInputCap,
    summaryOutputCap,
    replyCap,
    fixedWireOverhead: FIXED_WIRE_OVERHEAD_TOKENS,
    rMin,
  }
}

/** Default breakeven price factors (VERIFY-C #15: w=1.0, r=0.1, q=4.0). */
export const DEFAULT_BREAKEVEN_PRICE: Readonly<BreakevenPrice> = Object.freeze({
  w: 1.0,
  r: 0.1,
  q: 4.0,
})

/** Validate one measured/estimated token amount. @internal */
function assertBreakevenAmount(amount: BreakevenAmount, name: string): void {
  if (amount === null || typeof amount !== 'object') {
    throw new TypeError(`breakeven.${name} must be a {tokens, measured} object`)
  }
  assertAmount(amount.tokens, `breakeven.${name}.tokens`)
  if (typeof amount.measured !== 'boolean') {
    throw new TypeError(`breakeven.${name}.measured must be a boolean`)
  }
}

/**
 * Cache-economics breakeven report for one fold (VERIFY-C #15, formula
 * verified verbatim against billion-context kernel/src/cache-report.ts:266-276):
 *
 *   oneTimeCost    = (w − r)·T + q·σ − r·S
 *   perTurnSaving  = (S − σ)·r
 *   breakevenTurns = max(0, oneTimeCost) / perTurnSaving
 *   netTokens      = S − σ
 *
 * When perTurnSaving ≤ 0 (a fold that saves nothing per turn) the report
 * gives breakevenTurns = 0 if oneTimeCost ≤ 0 (profitable immediately) and
 * Infinity otherwise (never pays off) — division by zero resolved explicitly.
 *
 * Inputs carry the S6 measured/estimated markers; the report echoes which
 * inputs were estimated so zctx_status can label degraded (estimated) output.
 */
export function computeBreakevenReport(input: BreakevenInput): BreakevenReport {
  assertBreakevenAmount(input.folded, 'folded')
  assertBreakevenAmount(input.summary, 'summary')
  assertBreakevenAmount(input.repay, 'repay')

  const price = { ...DEFAULT_BREAKEVEN_PRICE, ...input.price }
  for (const key of ['w', 'r', 'q'] as const) {
    const value = price[key]
    if (!Number.isFinite(value) || value < 0) {
      throw new TypeError(`breakeven.price.${key} must be a finite non-negative number`)
    }
  }

  const s = input.folded.tokens
  const sigma = input.summary.tokens
  const t = input.repay.tokens
  const { w, r, q } = price

  const oneTimeCost = (w - r) * t + q * sigma - r * s
  const perTurnSaving = (s - sigma) * r
  const netTokens = s - sigma
  const breakevenTurns =
    perTurnSaving > 0 ? Math.max(0, oneTimeCost) / perTurnSaving : oneTimeCost <= 0 ? 0 : Number.POSITIVE_INFINITY

  const estimatedInputs: ('folded' | 'summary' | 'repay')[] = []
  if (!input.folded.measured) estimatedInputs.push('folded')
  if (!input.summary.measured) estimatedInputs.push('summary')
  if (!input.repay.measured) estimatedInputs.push('repay')

  return {
    oneTimeCost,
    perTurnSaving,
    breakevenTurns,
    netTokens,
    measured: estimatedInputs.length === 0,
    estimatedInputs,
  }
}
