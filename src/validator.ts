/**
 * Fold validator — the conservative server-side gate for every zctx_fold
 * submission (options.md §2 方案甲 5; task card W2 §2 checks a–g).
 *
 * One call validates ONE fold window (the official surface replace span,
 * session/src/types.ts:449-464: "Both must exist as surface nodes in the
 * current surface") plus the summary blocks submitted for it. The tool layer
 * (W4) loops this function over the batch's windows and rejects the whole
 * batch when any window fails — atomicity at batch level lives there; this
 * module is atomic per window: ALL reasons are collected, nothing is
 * accepted partially, and the acceptance plan is produced only when every
 * check passed.
 *
 * Checks implemented:
 *   a. window exists, is contiguous on the surface, endpoints are surface
 *      nodes; node 0 (system head) may never enter the window (S5 precheck —
 *      the official assertSystemHeadRewrite throws, surface.ts:493-505);
 *   b. protected zones: recent tail (last keepRecentMessages messages and
 *      the last max(keepRecentTokens, protectionFloorTokens) estimated
 *      tokens), the last user message, and the permanently pinned first
 *      user message (official kernel recommend.ts Rules 1–3 + DESIGN §8.1);
 *   c. tool-pair closure: an assistant tool call and its tool result must be
 *      folded together or left together (official kernel #2886 closure);
 *      unknown pairing fails closed;
 *   d. nested absorption: a window containing an active fold's checkpoint is
 *      allowed when a submitted summary covers the checkpoint or the window
 *      boundary aligns with it;
 *   e. net-shrink gate: Σ(folded node estimates) × tolerance > Σ(summary
 *      estimates), tolerance default 1.05; summary length window enforced;
 *   f. window qualification: estimated window tokens ≥ minFoldableTokens and
 *      ≤ maxFoldFraction × contextWindow (when the window size is supplied);
 *   g. atomic rejection: any failure → { ok:false, reasons } with every
 *      reason collected.
 *
 * Session-log互斥 checks (active compaction, surface generation stability)
 * need the live session and belong to the W3 engine, not to this pure core.
 *
 * Zero host imports; pure function.
 *
 * @module validator
 */

import { estimateTokens } from './budget.ts'
import {
  REASON_ABSORBED_UNCOVERED,
  REASON_FIRST_USER,
  REASON_LAST_USER,
  REASON_NODE0,
  REASON_NO_NET_SHRINK,
  REASON_PROTECTED_TAIL,
  REASON_RANGE_DISCONTIGUOUS,
  REASON_RANGE_EMPTY,
  REASON_RANGE_INVERTED,
  REASON_RANGE_NOT_ON_SURFACE,
  REASON_SUMMARY_EMPTY,
  REASON_SUMMARY_OUT_OF_WINDOW,
  REASON_SUMMARY_OVERLAP,
  REASON_SUMMARY_TOO_LONG,
  REASON_SUMMARY_TOO_SHORT,
  REASON_TOOL_ORPHAN_RESULT,
  REASON_TOOL_SPLIT_RESULT,
  REASON_TOOL_UNKNOWN_PAIRING,
  REASON_TOOL_UNANSWERED_CALL,
  REASON_WINDOW_TOO_LARGE,
  REASON_WINDOW_TOO_SMALL,
  fill,
} from './texts.ts'
import type {
  FoldMap,
  FoldPlan,
  FoldPlanEntry,
  FoldValidationResult,
  SurfaceNode,
  ValidateFoldInput,
} from './types.ts'

/** Render a number without float dust (0.6×100 → "60"). @internal */
function fmtNum(value: number): string {
  const rounded = Math.round(value * 1000) / 1000
  return Number.isInteger(rounded) ? String(rounded) : String(rounded)
}

/** Structural sanity of one surface node. @internal */
function assertSurfaceNode(node: SurfaceNode, index: number): void {
  const at = `surfaceNodes[${index}]`
  if (node === null || typeof node !== 'object') throw new TypeError(`${at} must be an object`)
  if (!Number.isFinite(node.seq) || !Number.isInteger(node.seq) || node.seq < 0) {
    throw new TypeError(`${at}.seq must be a non-negative integer`)
  }
  if (!Number.isFinite(node.estimatedTokens) || node.estimatedTokens < 0) {
    throw new TypeError(`${at}.estimatedTokens must be a finite non-negative number`)
  }
}

/**
 * Validate one fold window with its summaries (see module header for the
 * check list). Throws TypeError on structurally malformed input; returns
 * `{ ok:false, reasons }` (all reasons collected) on any semantic failure.
 */
export function validateFold(input: ValidateFoldInput): FoldValidationResult {
  if (input === null || typeof input !== 'object') {
    throw new TypeError('validateFold: input must be an object')
  }
  if (!Array.isArray(input.surfaceNodes)) {
    throw new TypeError('validateFold: surfaceNodes must be an array')
  }
  if (!(input.foldMap instanceof Map)) {
    throw new TypeError('validateFold: foldMap must be a Map')
  }
  if (!Array.isArray(input.summaries)) {
    throw new TypeError('validateFold: summaries must be an array')
  }
  if (input.config === null || typeof input.config !== 'object') {
    throw new TypeError('validateFold: config must be an object')
  }

  const surfaceNodes = input.surfaceNodes
  surfaceNodes.forEach(assertSurfaceNode)

  const { startSeq, endSeq } = input.range
  if (!Number.isFinite(startSeq) || !Number.isFinite(endSeq)) {
    throw new TypeError('validateFold: range endpoints must be finite numbers')
  }

  const config = input.config
  const reasons: string[] = []

  // ---- a. window existence / contiguity / node-0 precheck -----------------
  if (startSeq > endSeq) {
    reasons.push(fill(REASON_RANGE_INVERTED, { start: startSeq, end: endSeq }))
  }
  const startIndex = surfaceNodes.findIndex((n) => n.seq === startSeq)
  const endIndex = surfaceNodes.findIndex((n) => n.seq === endSeq)
  if (startIndex < 0 || endIndex < 0) {
    reasons.push(fill(REASON_RANGE_NOT_ON_SURFACE, { start: startSeq, end: endSeq }))
  }
  // The window shadows every surface node whose seq falls inside the span
  // (numeric span semantics of the official replace op). Contiguity is then
  // verified on positions: the shadowed set must be consecutive in the
  // ordered surface array — a defensive guard against unsorted engine scans.
  const inRange = surfaceNodes.filter((n) => n.seq >= startSeq && n.seq <= endSeq)
  if (inRange.length === 0) {
    reasons.push(fill(REASON_RANGE_EMPTY, { start: startSeq, end: endSeq }))
  } else if (startIndex >= 0 && endIndex >= 0) {
    const firstIdx = surfaceNodes.indexOf(inRange[0])
    const lastIdx = surfaceNodes.indexOf(inRange[inRange.length - 1])
    const consecutive = lastIdx - firstIdx + 1 === inRange.length
    const monotonic = inRange.every((n, i) => i === 0 || n.seq > inRange[i - 1].seq)
    if (!consecutive || !monotonic) {
      reasons.push(fill(REASON_RANGE_DISCONTIGUOUS, { start: startSeq, end: endSeq }))
    }
  }
  if (
    surfaceNodes.length > 0 &&
    surfaceNodes[0].seq >= startSeq &&
    surfaceNodes[0].seq <= endSeq
  ) {
    reasons.push(fill(REASON_NODE0, { start: startSeq, end: endSeq }))
  }

  // ---- b. protected zones -------------------------------------------------
  const effectiveKeepTokens = Math.max(config.keepRecentTokens, config.protectionFloorTokens)
  if ((config.keepRecentMessages > 0 || effectiveKeepTokens > 0) && surfaceNodes.length > 0) {
    let protectedFromIdx = surfaceNodes.length
    if (config.keepRecentMessages > 0) {
      protectedFromIdx = Math.max(0, surfaceNodes.length - config.keepRecentMessages)
    }
    if (effectiveKeepTokens > 0) {
      let acc = 0
      let idx = surfaceNodes.length - 1
      while (idx >= 0) {
        acc += surfaceNodes[idx].estimatedTokens
        if (acc >= effectiveKeepTokens) break
        idx -= 1
      }
      if (idx < 0) idx = 0 // whole surface fits under the floor → everything protected
      protectedFromIdx = Math.min(protectedFromIdx, idx)
    }
    if (protectedFromIdx < surfaceNodes.length) {
      const protectedStart = surfaceNodes[protectedFromIdx]
      if (protectedStart.seq <= endSeq) {
        reasons.push(
          fill(REASON_PROTECTED_TAIL, {
            start: startSeq,
            end: endSeq,
            seq: protectedStart.seq,
            messages: config.keepRecentMessages,
            tokens: effectiveKeepTokens,
          }),
        )
      }
    }
  }

  const lastUserIdx = findLastIndex(surfaceNodes, (n) => n.role === 'user')
  if (lastUserIdx >= 0) {
    const node = surfaceNodes[lastUserIdx]
    if (node.seq >= startSeq && node.seq <= endSeq) {
      reasons.push(fill(REASON_LAST_USER, { start: startSeq, end: endSeq, seq: node.seq }))
    }
  }
  const firstUserIdx = surfaceNodes.findIndex((n) => n.role === 'user')
  if (firstUserIdx >= 0) {
    const node = surfaceNodes[firstUserIdx]
    if (node.seq >= startSeq && node.seq <= endSeq) {
      reasons.push(fill(REASON_FIRST_USER, { start: startSeq, end: endSeq, seq: node.seq }))
    }
  }

  // ---- c. tool-pair closure (fail closed on unknown pairing) ---------------
  const toolByCallId = new Map<string, SurfaceNode>()
  const assistantByCallId = new Map<string, SurfaceNode>()
  for (const node of surfaceNodes) {
    if (node.role === 'tool' && node.answersCallId !== undefined) {
      toolByCallId.set(node.answersCallId, node)
    }
    if (node.role === 'assistant' && node.toolCallIds !== undefined) {
      for (const callId of node.toolCallIds) assistantByCallId.set(callId, node)
    }
  }
  for (const node of inRange) {
    if (node.role === 'tool') {
      if (node.answersCallId === undefined) {
        reasons.push(fill(REASON_TOOL_UNKNOWN_PAIRING, { seq: node.seq, role: 'tool' }))
        continue
      }
      const assistant = assistantByCallId.get(node.answersCallId)
      if (assistant === undefined) {
        reasons.push(
          fill(REASON_TOOL_ORPHAN_RESULT, { seq: node.seq, callId: node.answersCallId }),
        )
      } else if (assistant.seq < startSeq || assistant.seq > endSeq) {
        reasons.push(
          fill(REASON_TOOL_SPLIT_RESULT, {
            seq: node.seq,
            callId: node.answersCallId,
            assistantSeq: assistant.seq,
          }),
        )
      }
    }
    if (node.role === 'assistant') {
      if (node.toolCallIds === undefined) {
        reasons.push(fill(REASON_TOOL_UNKNOWN_PAIRING, { seq: node.seq, role: 'assistant' }))
        continue
      }
      for (const callId of node.toolCallIds) {
        const tool = toolByCallId.get(callId)
        if (tool !== undefined && (tool.seq < startSeq || tool.seq > endSeq)) {
          reasons.push(
            fill(REASON_TOOL_UNANSWERED_CALL, {
              seq: node.seq,
              callId,
              toolSeq: tool.seq,
            }),
          )
        }
      }
    }
  }

  // ---- d. nested absorption of active fold checkpoints ---------------------
  const absorbed: { foldId: string; checkpointSeq: number; covered: boolean; aligned: boolean }[] =
    []
  for (const [foldId, record] of input.foldMap) {
    const { checkpointSeq } = record
    if (checkpointSeq < startSeq || checkpointSeq > endSeq) continue
    const covered = input.summaries.some(
      (s) => s.startSeq <= checkpointSeq && checkpointSeq <= s.endSeq,
    )
    const aligned = checkpointSeq === startSeq || checkpointSeq === endSeq
    if (!covered && !aligned) {
      reasons.push(
        fill(REASON_ABSORBED_UNCOVERED, {
          start: startSeq,
          end: endSeq,
          foldId,
          checkpoint: checkpointSeq,
        }),
      )
    }
    absorbed.push({ foldId, checkpointSeq, covered, aligned })
  }

  // ---- e. summaries: presence, containment, overlap, length window --------
  if (input.summaries.length === 0) {
    reasons.push(REASON_SUMMARY_EMPTY)
  }
  for (const summary of input.summaries) {
    if (
      summary.startSeq < startSeq ||
      summary.endSeq > endSeq ||
      summary.startSeq > summary.endSeq
    ) {
      reasons.push(
        fill(REASON_SUMMARY_OUT_OF_WINDOW, {
          start: summary.startSeq,
          end: summary.endSeq,
          wStart: startSeq,
          wEnd: endSeq,
        }),
      )
    }
    if (summary.text.length < config.summaryFloorChars) {
      reasons.push(
        fill(REASON_SUMMARY_TOO_SHORT, {
          start: summary.startSeq,
          end: summary.endSeq,
          len: summary.text.length,
          min: config.summaryFloorChars,
        }),
      )
    }
    if (summary.text.length > config.summaryCeilingChars) {
      reasons.push(
        fill(REASON_SUMMARY_TOO_LONG, {
          start: summary.startSeq,
          end: summary.endSeq,
          len: summary.text.length,
          max: config.summaryCeilingChars,
        }),
      )
    }
  }
  for (let i = 0; i < input.summaries.length; i += 1) {
    for (let j = i + 1; j < input.summaries.length; j += 1) {
      const a = input.summaries[i]
      const b = input.summaries[j]
      if (a.startSeq <= b.endSeq && b.startSeq <= a.endSeq) {
        reasons.push(
          fill(REASON_SUMMARY_OVERLAP, {
            aStart: a.startSeq,
            aEnd: a.endSeq,
            bStart: b.startSeq,
            bEnd: b.endSeq,
          }),
        )
      }
    }
  }

  // ---- f. size gates -------------------------------------------------------
  const foldedTokens = inRange.reduce((sum, n) => sum + n.estimatedTokens, 0)
  if (inRange.length > 0 && foldedTokens < config.minFoldableTokens) {
    reasons.push(
      fill(REASON_WINDOW_TOO_SMALL, {
        start: startSeq,
        end: endSeq,
        tokens: foldedTokens,
        min: config.minFoldableTokens,
      }),
    )
  }
  if (
    config.contextWindow !== undefined &&
    inRange.length > 0 &&
    foldedTokens > config.maxFoldFraction * config.contextWindow
  ) {
    reasons.push(
      fill(REASON_WINDOW_TOO_LARGE, {
        start: startSeq,
        end: endSeq,
        tokens: foldedTokens,
        maxPct: fmtNum(config.maxFoldFraction * 100),
      }),
    )
  }

  // ---- e (net-shrink gate) -------------------------------------------------
  const summaryTokens = input.summaries.reduce((sum, s) => sum + estimateTokens(s.text), 0)
  if (
    inRange.length > 0 &&
    foldedTokens * config.netShrinkTolerance <= summaryTokens
  ) {
    reasons.push(
      fill(REASON_NO_NET_SHRINK, {
        start: startSeq,
        end: endSeq,
        folded: foldedTokens,
        tolerance: fmtNum(config.netShrinkTolerance),
        summary: summaryTokens,
      }),
    )
  }

  // ---- g. atomic rejection -------------------------------------------------
  if (reasons.length > 0) return { ok: false, reasons }

  // ---- acceptance plan -----------------------------------------------------
  const folds: FoldPlanEntry[] = []
  for (const summary of input.summaries) {
    const subTokens = inRange
      .filter((n) => n.seq >= summary.startSeq && n.seq <= summary.endSeq)
      .reduce((sum, n) => sum + n.estimatedTokens, 0)
    const entryAbsorbed = absorbed
      .filter((a) => a.covered && a.checkpointSeq >= summary.startSeq && a.checkpointSeq <= summary.endSeq)
      .map((a) => a.foldId)
    folds.push({
      startSeq: summary.startSeq,
      endSeq: summary.endSeq,
      summaryText: summary.text,
      summaryTokens: estimateTokens(summary.text),
      reclaimedTokens: subTokens - estimateTokens(summary.text),
      absorbedFoldIds: entryAbsorbed,
    })
  }
  // Boundary-aligned absorption (not covered by a summary subrange) attaches
  // to the window edge: start-aligned → first entry, end-aligned → last entry.
  if (folds.length > 0) {
    for (const a of absorbed) {
      if (a.covered) continue
      if (a.checkpointSeq === startSeq) {
        folds[0] = { ...folds[0], absorbedFoldIds: [...folds[0].absorbedFoldIds, a.foldId] }
      } else if (a.checkpointSeq === endSeq) {
        const last = folds[folds.length - 1]
        folds[folds.length - 1] = { ...last, absorbedFoldIds: [...last.absorbedFoldIds, a.foldId] }
      }
    }
  }

  const plan: FoldPlan = {
    folds,
    reclaimedTokens: foldedTokens - summaryTokens,
  }
  return { ok: true, plan }
}

/** Array.prototype.findLastIndex (ES2023) — local for clarity. @internal */
function findLastIndex<T>(items: readonly T[], predicate: (item: T) => boolean): number {
  for (let i = items.length - 1; i >= 0; i -= 1) {
    if (predicate(items[i])) return i
  }
  return -1
}
