/**
 * attribution.ts — the fold→usage attribution engine and the observability
 * aggregation (v0.2.0 V3, task card V3-attribution-status products 1-3;
 * RES-observe-route §Q4 + §Q7 + (b) closed-loop assembly).
 *
 * PURE CORE, zero host dependencies: every function here consumes plain
 * structural event records (SessionEventLike) and ledger views, so the store
 * can drive it from its single `applyEvent` transition and the tests can
 * drive it from bare arrays. Nothing in this module imports the host, cordis,
 * or the store.
 *
 * ATTRIBUTION RULE (§Q4.2, primary key = seq order + turn/step structure;
 * time is only the broken-chain fallback):
 *   1. The fold commit event F = the user/message carrying a `surfaceOp`
 *      replace with `source.kind === 'zctx-fold'` (fold-engine.ts:302-320).
 *   2. The attribution target = the FIRST assistant/message M of the same
 *      session with seq_M > seq_F — the request content is billed in M's
 *      usage (the first real request after the fold).
 *   3. Quality grades (§Q4.2 rule 3), judged over the window of retained
 *      events strictly between F and M:
 *        - strong: no assistant/attempt, no compaction/* event, no other
 *          surfaceOp replace, no request/header reason:'change';
 *        - retry: at least one llm/retry in the window (a retry does not
 *          change the request content — the fold semantics stand) → quality
 *          'retry' and the count becomes the retryCount pollution degree;
 *        - weak: compaction competition / another replace producer / route
 *          change / an assistant/attempt WITHOUT its llm/retry voucher —
 *          the sample stays in the total ledger (总账) but never enters the
 *          fold account (折叠账). An attempt without a retry event is an
 *          UNEXPLAINED disturbance of the request chain (aborted attempt,
 *          agent-loop agent.ts:491-511 settles attempts without always
 *          retrying), so the mechanical consequence of "strong requires no
 *          attempt" + "retry requires llm/retry" is the weak grade.
 *   4. Time-window fallback (§Q4.2 rule 4, config attributionTimeWindowMs):
 *      when the retained event chain is BROKEN (the store could not read
 *      every seq between F and M — a resync gap), window purity is
 *      unverifiable; the association degrades to
 *      `T_M − T_F ≤ attributionTimeWindowMs 且同 turn` and the ledger entry
 *      carries `timeWindow: true`. Honesty cap: a broken chain can never
 *      claim strong/retry, so a passing fallback grades 'weak' (总账 only).
 *      Same-turn evidence: no turn/start AND no turn/end event inside the
 *      window, plus the fold's open turn (when known) equaling M's
 *      `data.turn`. F is a bare UserMessage (no turn of its own — the fold
 *      engine commits the official bare-message shape, session/src/types.ts:309).
 *
 * 8-ITEM NOISE DISPOSITIONS (§Q4.3 table, each mechanically resolved):
 *   1. retry ring: only assistant/message events are attributed; failed
 *      attempts carry no usage (Q2.2) and their llm/retry count becomes the
 *      pollution degree (quality 'retry'). — classify: retryCount scan.
 *   2. parallel tools inside one step: one step emits exactly one
 *      assistant/message; tool/result events in the window are NOT noise. —
 *      classify: tool events never affect the grade.
 *   3. many steps per turn: only the FIRST step after the fold is the
 *      attribution target; later steps are 维持账 (maintenance ledger), not
 *      回本账 (repay ledger). — store wiring: candidates stop at the previous
 *      assistant/message; later messages attribute to nothing.
 *   4. fold tool runs in step k → the next request is step k+1: tool
 *      execution follows the assistant message, so the first post-fold
 *      assistant/message aligns naturally. — classify: no special case; the
 *      engine records M's own turn/step.
 *   5. official compaction racing in the same window: any compaction/*
 *      event between F and M → weak (归因键失效). — classify: compaction scan.
 *   6. runtime-context per-step re-projection of the user message: it
 *      refreshes the REQUEST assembly (agent.ts:411-415), not the session
 *      log — it affects prefix hits (Q5/Q6), never "who consumed this
 *      usage". — classify: no effect; ordinary appended user/messages in the
 *      window are not noise (only replaces are).
 *   7. interrupted prefix: an aborted assistant/message carries
 *      `interrupted: true` and may still carry usage (agent.ts:469-483) —
 *      it is attributed and flagged `interrupted` (the response was cut, but
 *      the input side is still real). — classify: interrupted flag pass-through.
 *   8. subagent sessions: subagents run their own loop + session; ledgers
 *      are per-store (per-session) by construction and the store ignores
 *      foreign-session events, so a parent's fold account never crosses into
 *      a child's. — store wiring (pinned by tests).
 *
 * BREAKEVEN AGGREGATION (§Q7.3 + (b)): the frozen computeBreakevenReport
 * (budget.ts:196, VERIFY-C #15 price-weighted formulas) is the repay engine;
 * its inputs upgrade to the three-state ledger —
 *   - folded S / summary σ: the fold record's structural estimates
 *     (chars/3 over the folded span / summary text) → measured:false always
 *     (no measured source exists for these two);
 *   - repay T: the FIRST attributed request's billed input
 *     (billedInput = inputTokens + cacheReadTokens + cacheWriteTokens,
 *     §Q7.2 rule 1口径) when that record is measured or semi-anchored;
 *     otherwise the estimated-path convention T = σ (the checkpoint's own
 *     re-write is the minimal honest re-pay; 待标定) with measured:false.
 * The repay EVENT per §Q7.3 = the first assistant/message after the fold
 * commit where the cumulative realized saving crosses the one-time cost —
 * realized in the price-weighted domain: the Nth assistant/message after the
 * fold with N ≥ max(1, ⌈breakevenTurns⌉) (Infinity ⇒ never). Rows carry
 * `repaid`/`repayEventSeq` so zctx_status can count 回本 M 个.
 *
 * The clean-sample ratio = strong / (strong + retry + weak) over the fold
 * attribution ledger; the RENDERER (tools.ts) compares it against
 * config.cleanSampleFloor and withholds repay conclusions below the floor
 * (诚实纪律, §Q7.3) — the aggregation reports the ratio, it does not judge.
 *
 * @module attribution
 */

import { computeBreakevenReport } from './budget.ts'
import type {
  BreakevenTableRow,
  FoldUsageAttribution,
  ObservabilitySnapshot,
  ResetEvent,
  ResetSummaryRow,
  SessionEventLike,
  ThreeStateCounts,
  UsageRecord,
} from './types.ts'

/** Structural fold-ledger view the aggregation consumes (store-shaped). */
export interface AttributionFoldEntry {
  readonly foldId: string
  readonly checkpointSeq: number
  readonly tokensBefore: number
  readonly tokensAfter: number
}

/** Input of {@link buildObservabilitySnapshot} (the store's ledger views). */
export interface SnapshotAggregationInput {
  /** The bounded usage-record ledger (oldest first, three-state graded). */
  readonly usageRecords: readonly UsageRecord[]
  /** Lifetime three-state counters (attach-scoped, cap-independent). */
  readonly threeState: ThreeStateCounts
  /** Fold-ledger entries (any status; attribution decides fold-account membership). */
  readonly foldEntries: readonly AttributionFoldEntry[]
  /** The fold-attribution ledger (foldId → association), any quality. */
  readonly foldAttributions: readonly FoldUsageAttribution[]
  /** The cache-reset ledger (digest input). */
  readonly resetEvents: readonly ResetEvent[]
  /** Assistant/message seqs ascending (repay-event detection input). */
  readonly assistantMessageSeqs: readonly number[]
}

/** Input of {@link classifyFoldAttribution} — one F→M association attempt. */
export interface ClassifyAttributionInput {
  /** The fold's id (FoldRecord.foldId). */
  readonly foldId: string
  /** Seq of the fold commit (surfaceOp replace) event. */
  readonly foldSeq: number
  /** Commit time of the fold event, when the event carried one. */
  readonly foldTime?: number
  /**
   * The turn open at the fold commit (nearest turn/start at-or-before the
   * fold seq), when the log carries turn markers. Undefined when unknown —
   * the same-turn check then relies on window boundary events only.
   */
  readonly foldTurn?: number
  /** Seq of the candidate attribution target (assistant/message). */
  readonly messageSeq: number
  /** Commit time of the message event, when the event carried one. */
  readonly messageTime?: number
  /** The message's `data.turn` (official assistant/message envelope). */
  readonly messageTurn?: number
  /** The message's `data.step` (official assistant/message envelope). */
  readonly messageStep?: number
  /** The message's `data.interrupted === true` (§Q4.3 noise 7). */
  readonly messageInterrupted?: boolean
  /**
   * Retained events STRICTLY between foldSeq and messageSeq, ascending. The
   * engine derives chain completeness itself: the seqs must exactly cover
   * [foldSeq + 1, messageSeq − 1] — any missing seq is a resync gap and
   * triggers the time-window fallback.
   */
  readonly windowEvents: readonly SessionEventLike[]
  /** Config attributionTimeWindowMs (the fallback window; never hardcoded). */
  readonly timeWindowMs: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object'
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/**
 * Classify ONE fold→message association (§Q4.2 rules 2-4; the module JSDoc
 * carries the 8-noise disposition table). Returns undefined when the
 * association fails: the message lacks its official turn/step envelope, or
 * the broken-chain fallback (time window + same turn) does not pass.
 */
export function classifyFoldAttribution(input: ClassifyAttributionInput): FoldUsageAttribution | undefined {
  const turn = finiteNumber(input.messageTurn)
  const step = finiteNumber(input.messageStep)
  if (turn === undefined || step === undefined) {
    // Malformed assistant/message envelope (official events always carry
    // turn/step, session/src/types.ts:341-342) — attribute nothing, honestly.
    return undefined
  }
  const windowEvents = input.windowEvents
  const span = input.messageSeq - input.foldSeq
  if (span <= 0) return undefined // not "after" the fold — caller contract breach

  // -- noise scan (§Q4.3) ---------------------------------------------------
  let retryCount = 0
  let attempt = false
  let compaction = false
  let otherReplace = false
  let headerChange = false
  let turnBoundary = false
  for (const event of windowEvents) {
    switch (event.type) {
      case 'llm/retry':
        retryCount += 1
        break
      case 'assistant/attempt':
        attempt = true
        break
      case 'turn/start':
      case 'turn/end':
        turnBoundary = true
        break
      case 'request/header':
        if (isRecord(event.data) && event.data.reason === 'change') headerChange = true
        break
      default:
        if (event.type.startsWith('compaction/')) compaction = true
        break
    }
    const op = event.surfaceOp
    if (op !== undefined && op !== 'append') otherReplace = true
  }

  // -- chain completeness (the time-window fallback trigger) ----------------
  // Retained seqs must exactly cover (foldSeq, messageSeq); any hole is a
  // store resync gap and window purity becomes unverifiable (§Q4.2 rule 4).
  let chainComplete = windowEvents.length === span - 1
  if (chainComplete) {
    for (const [index, event] of windowEvents.entries()) {
      if (event.seq !== input.foldSeq + 1 + index) {
        chainComplete = false
        break
      }
    }
  }

  if (!chainComplete) {
    // Fallback: T_M − T_F ≤ attributionTimeWindowMs 且同 turn. Missing times
    // fail honestly (no clock evidence → no association).
    const foldTime = finiteNumber(input.foldTime)
    const messageTime = finiteNumber(input.messageTime)
    const sameTurn =
      !turnBoundary
      && (input.foldTurn === undefined || turn === undefined || input.foldTurn === turn)
    const withinWindow =
      foldTime !== undefined
      && messageTime !== undefined
      && messageTime >= foldTime
      && messageTime - foldTime <= input.timeWindowMs
    if (!withinWindow || !sameTurn) return undefined
    // Honesty cap: a broken chain can never claim strong/retry — the passing
    // fallback grades 'weak' (总账 only, never the fold account).
    return {
      foldId: input.foldId,
      foldCommitSeq: input.foldSeq,
      messageSeq: input.messageSeq,
      turn,
      step,
      quality: 'weak',
      retryCount,
      ...(input.messageInterrupted === true ? { interrupted: true as const } : {}),
      timeWindow: true,
    }
  }

  // -- quality grade over a complete window (§Q4.2 rule 3) ------------------
  const unexplainedAttempt = attempt && retryCount === 0
  const weak = compaction || otherReplace || headerChange || unexplainedAttempt
  const quality: FoldUsageAttribution['quality'] = weak ? 'weak' : retryCount > 0 ? 'retry' : 'strong'
  return {
    foldId: input.foldId,
    foldCommitSeq: input.foldSeq,
    messageSeq: input.messageSeq,
    turn,
    step,
    quality,
    retryCount,
    ...(input.messageInterrupted === true ? { interrupted: true as const } : {}),
  }
}

/** Billed input of one usage record (§Q7.2 rule 1: input + read + write). */
export function billedInputTokens(record: UsageRecord): number | undefined {
  if (record.inputTokens === undefined) return undefined
  return record.inputTokens + (record.cacheReadTokens ?? 0) + (record.cacheWriteTokens ?? 0)
}

/** First-seen-order digest of the reset ledger (kind × count). */
function digestResets(resetEvents: readonly ResetEvent[]): ResetSummaryRow[] {
  const counts = new Map<ResetEvent['kind'], number>()
  for (const reset of resetEvents) {
    counts.set(reset.kind, (counts.get(reset.kind) ?? 0) + 1)
  }
  return [...counts.entries()].map(([kind, count]) => ({ kind, count }))
}

/**
 * Clean-sample ratio (§Q7.3): strong / (strong + retry + weak) over the fold
 * attribution ledger; 0 when no fold was ever attributed (no evidence = no
 * confidence).
 */
export function cleanSampleRatio(foldAttributions: readonly FoldUsageAttribution[]): number {
  let strong = 0
  let retry = 0
  let weak = 0
  for (const attribution of foldAttributions) {
    if (attribution.quality === 'strong') strong += 1
    else if (attribution.quality === 'retry') retry += 1
    else weak += 1
  }
  const total = strong + retry + weak
  return total === 0 ? 0 : strong / total
}

/**
 * The repay-event detection for one fold (§Q7.3, price-weighted domain): the
 * fold has repaid when at least max(1, ⌈breakevenTurns⌉) assistant/messages
 * ran after the fold commit; the repay event is exactly that message.
 * breakevenTurns = Infinity (per-turn saving ≤ 0 with a positive one-time
 * cost) never repays. Returns the repaid marker + the event seq, or
 * `{ repaid: false }` / undefined-shaped absence via the optional fields.
 */
function detectRepay(
  breakevenTurns: number,
  checkpointSeq: number,
  assistantMessageSeqs: readonly number[],
): { repaid: true; repayEventSeq: number } | { repaid: false } {
  if (!Number.isFinite(breakevenTurns)) return { repaid: false }
  const required = Math.max(1, Math.ceil(breakevenTurns))
  let count = 0
  for (const seq of assistantMessageSeqs) {
    if (seq <= checkpointSeq) continue
    count += 1
    if (count === required) return { repaid: true, repayEventSeq: seq }
  }
  return { repaid: false }
}

/**
 * Aggregate the observability snapshot (RES-observe-route a.1 row 6) from the
 * store's ledger views. Pure: no store/host access. The fold account
 * (breakevenTable) admits only folds whose attribution quality is
 * strong/retry — weak associations stay in the total ledger (§Q4.2 rule 3).
 */
export function buildObservabilitySnapshot(input: SnapshotAggregationInput): ObservabilitySnapshot {
  const recordsBySeq = new Map<number, UsageRecord>()
  for (const record of input.usageRecords) recordsBySeq.set(record.seq, record)

  const breakevenTable: BreakevenTableRow[] = []
  for (const fold of input.foldEntries) {
    const attribution = input.foldAttributions.find((entry) => entry.foldId === fold.foldId)
    // Fold-account membership: quality strong/retry only (weak = 总账 only).
    if (attribution === undefined || attribution.quality === 'weak') continue

    // T upgrade: the first attributed request's billed input when measured or
    // semi-anchored; the estimated-path convention falls back to σ (minimal
    // honest re-pay, 待标定) with measured:false.
    const sample = recordsBySeq.get(attribution.messageSeq)
    const billed = sample === undefined ? undefined : billedInputTokens(sample)
    const repayMeasured = sample !== undefined && billed !== undefined && sample.state === 'measured'
    const repayTokens = billed ?? fold.tokensAfter

    const report = computeBreakevenReport({
      folded: { tokens: fold.tokensBefore, measured: false },
      summary: { tokens: fold.tokensAfter, measured: false },
      repay: { tokens: repayTokens, measured: repayMeasured },
    })
    const repay = detectRepay(report.breakevenTurns, fold.checkpointSeq, input.assistantMessageSeqs)
    breakevenTable.push({
      foldId: fold.foldId,
      breakevenTurns: report.breakevenTurns,
      quality: attribution.quality,
      repaid: repay.repaid,
      ...(repay.repaid ? { repayEventSeq: repay.repayEventSeq } : {}),
    })
  }

  return {
    threeState: input.threeState,
    cleanSampleRatio: cleanSampleRatio(input.foldAttributions),
    breakevenTable,
    resetSummary: digestResets(input.resetEvents),
  }
}
