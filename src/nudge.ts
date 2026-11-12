/**
 * Threshold-crossing nudge — the cache-aware pressure reminder (options.md
 * §2 方案甲 3, plan §3 B2). The rendered text is a PURE function of its
 * inputs: same inputs → same bytes, so the host context() registration only
 * changes (and only costs a cache re-pay) when a threshold is actually
 * crossed or the foldable-span table changes — the "跨越计次重付" model.
 *
 * Suppression (B2/plan §3.5): `nudgeContextText` returns '' when no threshold
 * was crossed — official PromptContext contributes nothing on empty text, so
 * the suppressed state is a no-op on the wire. W4 registers the context with
 * `required: true` so the host cannot filter it out
 * (system-prompt/src/index.ts:627-628 filters non-required contributions).
 *
 * Zero host imports; pure functions only.
 *
 * @module nudge
 */

import {
  NUDGE_BREAKDOWN_FIXED,
  NUDGE_BREAKDOWN_HEADER,
  NUDGE_BREAKDOWN_KEEP_RECENT,
  NUDGE_BREAKDOWN_RESERVE,
  NUDGE_BATCH_REMINDER,
  NUDGE_EMERGENCY_CLOSING,
  NUDGE_EMERGENCY_HEADER,
  NUDGE_GENTLE_CLOSING,
  NUDGE_GENTLE_HEADER,
  NUDGE_PROTECTED_MARKER,
  NUDGE_PROTECTED_REASON_PREFIX,
  NUDGE_PROTECTED_REASON_SUFFIX,
  NUDGE_RANGE_ROW,
  NUDGE_RANGES_EMPTY,
  NUDGE_RANGES_HEADER,
  NUDGE_TRIGGER_LINE,
  fill,
} from './texts.ts'
import type { Budget, NudgeRange, NudgeVoice } from './types.ts'

/**
 * Thresholds crossed on the way from `prev` to `cur` (strict rise: a
 * threshold counts only when prev < threshold ≤ cur — sitting exactly on a
 * threshold is not a crossing). Returned ascending, deduplicated; a falling
 * pressure crosses nothing.
 */
export function crossedThresholds(
  prev: number,
  cur: number,
  thresholds: readonly number[],
): number[] {
  assertPct(prev, 'prev')
  assertPct(cur, 'cur')
  if (!Array.isArray(thresholds)) throw new TypeError('thresholds must be an array')
  const seen = new Set<number>()
  const crossed: number[] = []
  for (const t of thresholds) {
    assertPct(t, 'threshold')
    const key = t
    if (seen.has(key)) continue
    seen.add(key)
    if (prev < t && cur >= t) crossed.push(t)
  }
  return crossed.sort((a, b) => a - b)
}

/**
 * Registration-ready context text: '' (suppressed) when nothing was crossed,
 * otherwise the full nudge rendering. Voice escalates to 'emergency' when
 * any crossed threshold is ≥ 90 or the current pressure itself is ≥ 90.
 */
export function nudgeContextText(
  prev: number,
  cur: number,
  thresholds: readonly number[],
  budget: Budget,
  ranges: readonly NudgeRange[],
): string {
  const crossed = crossedThresholds(prev, cur, thresholds)
  if (crossed.length === 0) return ''
  const voice: NudgeVoice = crossed.some((t) => t >= 90) || cur >= 90 ? 'emergency' : 'gentle'
  return renderNudge(cur, budget, ranges, voice)
}

/**
 * Render the nudge text for one pressure reading. Deterministic: identical
 * inputs produce byte-identical output (asserted by nudge.spec.ts).
 *
 * @param pressurePct - current window occupancy in percent (0..100+).
 * @param budget - the budget report driving the breakdown percentages.
 * @param ranges - foldable-span rows (PROTECTED rows render with their reason).
 * @param voice - gentle | emergency band.
 */
export function renderNudge(
  pressurePct: number,
  budget: Budget,
  ranges: readonly NudgeRange[],
  voice: NudgeVoice,
): string {
  assertPct(pressurePct, 'pressurePct')
  if (budget === null || typeof budget !== 'object') {
    throw new TypeError('renderNudge: budget must be an object')
  }
  if (!Array.isArray(ranges)) throw new TypeError('renderNudge: ranges must be an array')

  const pct = formatPct(pressurePct)
  const lines: string[] = []

  lines.push(
    fill(voice === 'emergency' ? NUDGE_EMERGENCY_HEADER : NUDGE_GENTLE_HEADER, { pct }),
  )
  lines.push(
    fill(NUDGE_TRIGGER_LINE, {
      pct,
      triggerPct: formatPct((budget.triggerLine / budget.contextWindow) * 100),
    }),
  )

  lines.push(NUDGE_BREAKDOWN_HEADER)
  lines.push(
    fill(NUDGE_BREAKDOWN_KEEP_RECENT, {
      pct: formatPct((budget.keepRecent / budget.contextWindow) * 100),
    }),
  )
  lines.push(
    fill(NUDGE_BREAKDOWN_RESERVE, {
      pct: formatPct((budget.pessimisticReserve / budget.contextWindow) * 100),
    }),
  )
  lines.push(
    fill(NUDGE_BREAKDOWN_FIXED, {
      pct: formatPct((budget.fixedWireOverhead / budget.contextWindow) * 100),
    }),
  )

  lines.push(NUDGE_RANGES_HEADER)
  if (ranges.length === 0) {
    lines.push(NUDGE_RANGES_EMPTY)
  } else {
    for (const range of ranges) {
      let row = fill(NUDGE_RANGE_ROW, {
        start: range.startSeq,
        end: range.endSeq,
        tokens: range.estimatedTokens,
      })
      if (range.protected) {
        row += NUDGE_PROTECTED_MARKER
        if (range.protectedReason !== undefined) {
          row += `${NUDGE_PROTECTED_REASON_PREFIX}${range.protectedReason}${NUDGE_PROTECTED_REASON_SUFFIX}`
        }
      }
      lines.push(row)
    }
  }

  lines.push(NUDGE_BATCH_REMINDER)
  lines.push(voice === 'emergency' ? NUDGE_EMERGENCY_CLOSING : NUDGE_GENTLE_CLOSING)

  return lines.join('\n')
}

/** Assert one finite percentage-like number. @internal */
function assertPct(value: number, name: string): void {
  if (!Number.isFinite(value)) {
    throw new TypeError(`${name} must be a finite number, got ${String(value)}`)
  }
}

/** One-decimal percentage formatting (deterministic for finite inputs). @internal */
function formatPct(value: number): string {
  return (Math.round(value * 10) / 10).toFixed(1)
}
