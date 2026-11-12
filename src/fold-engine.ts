/**
 * Fold engine — the commit orchestrator over the official surface replace
 * channel (task card W3 §2).
 *
 * `fold()` validates ONE fold window (W2 validator, foldMap from the store),
 * checks the durable compaction mutex, snapshots the surface generations,
 * then commits each summary block of the acceptance plan as its own
 * `user/message` checkpoint with `surfaceOp: replace` over its subrange
 * (disjoint subranges keep every shadowed set exactly the live surface set),
 * and verifies the generation counters afterwards — a mismatch is recorded
 * as an anomaly and reported, never thrown (fail-soft contract).
 *
 * `unfold()` re-materializes one active fold in the B1 single-node form
 * (plan §3): the checkpoint node is replaced by ONE user message whose
 * content is the ordered text-block list produced by `materializeRange`
 * (multi-block W2 artifact), with `source.kind: 'zctx-unfold'`.
 *
 * Read discipline (official synchronous-read decision): the engine reads
 * session state only through live, non-deprecated getters (`seq`,
 * `surface.*`) and delegates event-payload reads to the store's retained
 * copy, which is restored once at `attach` and maintained from the
 * `session/event` feed (`resync()` repairs bounded feed gaps).
 *
 * CCM §1.1 window gate (engine layer, distinct from the budget F1
 * degenerate-window guard): `ccmWindowGate` reports windows below the 32768
 * legal domain. The gate disables the AUTOMATIC folding face only — manual
 * tool folds stay validator-gated and usable — and `zctx_status` surfaces the
 * the degraded note.
 *
 * Zero host imports; append failures are caught and reported honestly.
 *
 * @module fold-engine
 */

import { estimateTokens } from './budget.ts'
import { materializeRange } from './materialize.ts'
import {
  FOLD_REPLY_ANOMALY_PREFIX,
  FOLD_REPLY_COMMIT_FAILED,
  FOLD_REPLY_OK,
  FOLD_REPLY_PARTIAL,
  FOLD_REPLY_REASON_ROW,
  FOLD_REPLY_REJECTED,
  REASON_CHECKPOINT_GONE,
  REASON_COMMIT_REJECTED,
  REASON_COMPACTION_ACTIVE,
  REASON_FOLD_NOT_ACTIVE,
  REASON_FOLD_NOT_FOUND,
  REASON_SESSION_SEQ_MISSING,
  REASON_SUBRANGE_TOOL_SPLIT,
  REASON_UNFOLD_REJECTED,
  REASON_UNREADABLE_SURFACE,
  UNFOLD_REPLY_OK,
  UNFOLD_REPLY_REJECTED,
  fill,
} from './texts.ts'
import { validateFold } from './validator.ts'
import type {
  FoldMap,
  FoldPlan,
  FoldPlanEntry,
  NudgeRange,
  SessionEventLike,
  SessionLike,
  SurfaceNode,
  ValidateFoldInput,
  ValidatorConfig,
} from './types.ts'
import { FoldStore } from './store.ts'

/** CCM §1.1 legal-domain floor: windows below this reject automatic folding. */
export const CCM_MIN_CONTEXT_WINDOW = 32768

/** Result of the engine-layer CCM window gate. */
export interface CcmWindowGate {
  /** True when the window is in the CCM legal domain (or cannot be judged). */
  readonly legal: boolean
  /** Degraded-mode note when the window is below the legal domain. */
  readonly note?: string
}

/**
 * Engine-layer CCM §1.1 gate. An unknown window cannot be judged (no claim);
 * a window below 32768 is out of the legal domain: the automatic folding face
 * is disabled while tools remain available. This is a POLICY layer above the
 * budget F1 structural degeneracy guard (W below the reserve structure); the
 * two layers are not interchangeable.
 */
export function ccmWindowGate(contextWindow: number | undefined): CcmWindowGate {
  if (contextWindow === undefined || !Number.isFinite(contextWindow)) return { legal: true }
  if (contextWindow >= CCM_MIN_CONTEXT_WINDOW) return { legal: true }
  return {
    legal: false,
    note: fill('context window {{window}} is below the CCM legal domain (W >= {{min}}): automatic folding is disabled, tools remain usable', {
      window: contextWindow,
      min: CCM_MIN_CONTEXT_WINDOW,
    }),
  }
}

/**
 * Structural surface intent passed to a writable session's append (mirror of
 * the official SurfaceIntent subset the plugin commits through; the official
 * sourceEventSeqs is a mutable SessionSeq[], kept mutable here so the real
 * generic Session stays structurally assignable).
 */
export interface FoldSurfaceIntent {
  readonly surfaceOp: 'append' | { readonly op: 'replace'; readonly startSeq: number; readonly endSeq: number }
  readonly sourceEventSeqs?: number[]
}

/**
 * Structural writable session consumed by the engine: the SessionLike read
 * contract plus the append channel. Method syntax keeps the official generic
 * `Session` class structurally assignable (method bivariance).
 */
export interface FoldSessionLike extends SessionLike {
  append(
    type: string,
    data: unknown,
    opts?: FoldSurfaceIntent,
  ): Pick<SessionEventLike, 'seq' | 'type' | 'data'>
}

/** One submitted fold request: the window plus its summary blocks. */
export interface FoldSubmission {
  /** The fold window (the hull of the submitted summary subranges). */
  readonly range: { readonly startSeq: number; readonly endSeq: number }
  /** Summary blocks submitted for the window (each covers a subrange). */
  readonly summaries: readonly {
    readonly startSeq: number
    readonly endSeq: number
    readonly text: string
  }[]
}

/** One committed checkpoint, echoed for tool replies and tests. */
export interface CommittedFold {
  readonly foldId: string
  readonly checkpointSeq: number
  readonly startSeq: number
  readonly endSeq: number
  readonly shadowedSeqs: readonly number[]
  readonly tokensBefore: number
  readonly tokensAfter: number
  /** Unfold commits only: number of re-materialized text blocks. */
  readonly blocks?: number
}

/** Engine anomaly kinds (recorded in the store's anomaly ledger). */
export interface EngineAnomaly {
  readonly kind: 'generation-mismatch' | 'node-missing' | 'append-rejected'
  readonly detail: string
  readonly seq?: number
}

/** Engine result: rejected with all reasons, or committed with honest anomalies. */
export type FoldCommitResult =
  | {
      readonly ok: false
      readonly reasons: readonly string[]
      readonly committed: readonly CommittedFold[]
      readonly anomalies: readonly EngineAnomaly[]
    }
  | {
      readonly ok: true
      readonly plan?: FoldPlan
      readonly committed: readonly CommittedFold[]
      readonly anomalies: readonly EngineAnomaly[]
    }

/** Generations snapshot of the live surface, when exposed. @internal */
interface GenerationSnapshot {
  readonly replaceGeneration?: number
  readonly contentGeneration?: number
}

/** Assert the structural shape the engine commits through. @internal */
function assertSessionWritable(sessionLike: FoldSessionLike): void {
  if (sessionLike === null || typeof sessionLike !== 'object') {
    throw new TypeError('fold-engine: sessionLike must be an object')
  }
  if (typeof sessionLike.append !== 'function') {
    throw new TypeError('fold-engine: sessionLike must expose append(type, data, opts)')
  }
  if (typeof sessionLike.seq !== 'number' || !Number.isFinite(sessionLike.seq)) {
    throw new TypeError('fold-engine: sessionLike must expose its next seq')
  }
}

/**
 * Read one generation snapshot off the live surface (optional members are
 * skipped honestly when the session exposes no counters).
 * @internal
 */
function snapshotGenerations(sessionLike: SessionLike): GenerationSnapshot {
  const surface = sessionLike.surface
  if (surface === undefined) return {}
  const replace = surface.replaceGeneration
  const content = surface.contentGeneration
  return {
    ...(typeof replace === 'number' ? { replaceGeneration: replace } : {}),
    ...(typeof content === 'number' ? { contentGeneration: content } : {}),
  }
}

/**
 * Commit one fold submission (see module header). Throws TypeError only on
 * structurally malformed input (programmer error); every semantic failure —
 * validation rejection, active compaction, session append rejection — comes
 * back as a `{ ok: false, reasons }` result, and post-commit anomalies are
 * reported, not thrown.
 */
export function fold(
  sessionLike: FoldSessionLike,
  store: FoldStore,
  submission: FoldSubmission,
  config: ValidatorConfig,
): FoldCommitResult {
  assertSessionWritable(sessionLike)
  if (!(store instanceof FoldStore)) {
    throw new TypeError('fold-engine: store must be a FoldStore')
  }
  const anomalies: EngineAnomaly[] = []

  // ---- 0. state freshness + fail-closed unreadable guard -------------------
  store.resync()
  const unreadable = store.unreadableSurfaceSeqs()
  if (unreadable.length > 0) {
    const detail = fill(REASON_UNREADABLE_SURFACE, { seqs: unreadable.join(', ') })
    return { ok: false, reasons: [detail], committed: [], anomalies }
  }

  // ---- 1. validator (foldMap from the store, surfaceNodes from the view) ---
  const surfaceNodes = store.surfaceNodes()
  const foldMap: FoldMap = store.foldMap
  const validation = validateFold({
    foldMap,
    surfaceNodes,
    range: submission.range,
    summaries: submission.summaries,
    config,
  } satisfies ValidateFoldInput)
  if (!validation.ok) {
    return { ok: false, reasons: [...validation.reasons], committed: [], anomalies }
  }
  const plan = validation.plan

  // ---- 1b. subrange pair-closure guard (commit-unit level) -----------------
  // The validator enforces tool-pair closure over the WINDOW; the engine
  // commits PER SUBRANGE, so the same invariant must hold for every entry —
  // otherwise a commit would leave an assistant tool call on one side of a
  // replace and its result on the other. Checked before any commit (atomic).
  const subrangeReasons = subrangePairReasons(surfaceNodes, plan.folds)
  if (subrangeReasons.length > 0) {
    return { ok: false, reasons: subrangeReasons, committed: [], anomalies }
  }

  // ---- 2. durable compaction mutex -----------------------------------------
  if (store.compactionActive()) {
    return { ok: false, reasons: [REASON_COMPACTION_ACTIVE], committed: [], anomalies }
  }

  // ---- 3. stability snapshot ------------------------------------------------
  const before = snapshotGenerations(sessionLike)

  // ---- 4. per-entry checkpoint commits --------------------------------------
  const committed: CommittedFold[] = []
  let rejected: string | undefined
  for (const entry of plan.folds) {
    const shadowed = surfaceNodes
      .filter((n) => n.seq >= entry.startSeq && n.seq <= entry.endSeq)
      .map((n) => n.seq)
    const tokensBefore = shadowed.length > 0
      ? surfaceNodes
          .filter((n) => n.seq >= entry.startSeq && n.seq <= entry.endSeq)
          .reduce((sum, n) => sum + n.estimatedTokens, 0)
      : 0
    const tokensAfter = estimateTokens(entry.summaryText)
    const nextSeq = sessionLike.seq
    if (typeof nextSeq !== 'number' || !Number.isFinite(nextSeq) || nextSeq < 0) {
      rejected = REASON_SESSION_SEQ_MISSING
      break
    }
    const foldId = `f${nextSeq}`
    try {
      const event = sessionLike.append('user/message', {
        message: {
          role: 'user',
          content: [{ type: 'text', text: entry.summaryText }],
          source: {
            kind: 'zctx-fold',
            foldId,
            tokensBefore,
            tokensAfter,
          },
        },
      }, {
        surfaceOp: { op: 'replace', startSeq: entry.startSeq, endSeq: entry.endSeq },
        sourceEventSeqs: shadowed,
      })
      committed.push({
        foldId,
        checkpointSeq: event.seq,
        startSeq: entry.startSeq,
        endSeq: entry.endSeq,
        shadowedSeqs: shadowed,
        tokensBefore,
        tokensAfter,
      })
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : String(error)
      store.recordAnomaly('append-rejected', `fold ${foldId}: ${detail}`)
      anomalies.push({ kind: 'append-rejected', detail: `fold ${foldId}: ${detail}` })
      rejected = fill(REASON_COMMIT_REJECTED, {
        start: entry.startSeq,
        end: entry.endSeq,
        detail,
      })
      break
    }
  }

  if (committed.length === 0) {
    return {
      ok: false,
      reasons: [rejected ?? FOLD_REPLY_COMMIT_FAILED],
      committed,
      anomalies,
    }
  }

  // ---- 5. post-commit generation verification (fail-soft) -------------------
  const after = snapshotGenerations(sessionLike)
  verifyPostCommit(sessionLike, store, committed, before, after, anomalies)

  // Keep the store fresh even without a host feed: bounded delta replay of
  // the events this fold just committed (no-op when the feed already ran).
  store.resync()

  if (rejected !== undefined) {
    // Partial commit: some checkpoints landed durably before the rejection.
    return {
      ok: false,
      reasons: [
        rejected,
        fill(FOLD_REPLY_PARTIAL, { committed: committed.length, total: plan.folds.length }),
      ],
      committed,
      anomalies,
    }
  }
  return { ok: true, plan, committed, anomalies }
}

/**
 * Unfold one active fold (B1 single-node form): the checkpoint node is
 * replaced by ONE user message carrying the re-materialized text blocks of
 * the original span. Same fail-soft discipline as `fold`.
 */
export function unfold(
  sessionLike: FoldSessionLike,
  store: FoldStore,
  foldId: string,
): FoldCommitResult {
  assertSessionWritable(sessionLike)
  if (!(store instanceof FoldStore)) {
    throw new TypeError('fold-engine: store must be a FoldStore')
  }
  if (typeof foldId !== 'string' || foldId.length === 0) {
    throw new TypeError('fold-engine: foldId must be a non-empty string')
  }
  const anomalies: EngineAnomaly[] = []

  store.resync()
  const unreadable = store.unreadableSurfaceSeqs()
  if (unreadable.length > 0) {
    const detail = fill(REASON_UNREADABLE_SURFACE, { seqs: unreadable.join(', ') })
    return { ok: false, reasons: [detail], committed: [], anomalies }
  }

  const entry = store.foldMap.get(foldId)
  if (entry === undefined) {
    const ledgerEntry = store.ledgerEntries().find((e) => e.foldId === foldId)
    if (ledgerEntry !== undefined) {
      return {
        ok: false,
        reasons: [fill(REASON_FOLD_NOT_ACTIVE, { foldId, status: ledgerEntry.status })],
        committed: [],
        anomalies,
      }
    }
    return {
      ok: false,
      reasons: [fill(REASON_FOLD_NOT_FOUND, { foldId })],
      committed: [],
      anomalies,
    }
  }

  // The checkpoint must still be a live surface node.
  const liveNodes = store.surfaceNodes().map((n) => n.seq)
  if (!liveNodes.includes(entry.checkpointSeq)) {
    return {
      ok: false,
      reasons: [fill(REASON_CHECKPOINT_GONE, { foldId, seq: entry.checkpointSeq })],
      committed: [],
      anomalies,
    }
  }

  // Same durable-lock discipline as fold: a mid-bracket unfold would be
  // shadowed by the pending compaction commit anyway.
  if (store.compactionActive()) {
    return { ok: false, reasons: [REASON_COMPACTION_ACTIVE], committed: [], anomalies }
  }

  const before = snapshotGenerations(sessionLike)

  // Re-materialize the original span from the store's retained events; the
  // active foldMap gives one-layer expansion of nested checkpoints.
  const blocks = materializeRange(
    { eventAt: (seq) => store.retainedEvent(seq) },
    store.foldMap,
    entry.startSeq,
    entry.endSeq,
  )
  const tokensBefore = estimateTokens(entry.summaryText)
  const tokensAfter = blocks.reduce((sum, block) => sum + estimateTokens(block.text), 0)

  try {
    const event = sessionLike.append('user/message', {
      message: {
        role: 'user',
        content: blocks,
        source: {
          kind: 'zctx-unfold',
          foldId,
          tokensBefore,
          tokensAfter,
        },
      },
    }, {
      surfaceOp: { op: 'replace', startSeq: entry.checkpointSeq, endSeq: entry.checkpointSeq },
      sourceEventSeqs: [entry.checkpointSeq],
    })
    const committed: CommittedFold[] = [
      {
        foldId,
        checkpointSeq: event.seq,
        startSeq: entry.checkpointSeq,
        endSeq: entry.checkpointSeq,
        shadowedSeqs: [entry.checkpointSeq],
        tokensBefore,
        tokensAfter,
        blocks: blocks.length,
      },
    ]
    const after = snapshotGenerations(sessionLike)
    verifyPostCommit(sessionLike, store, committed, before, after, anomalies)
    // Keep the store fresh even without a host feed (bounded delta replay).
    store.resync()
    return { ok: true, committed, anomalies }
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error)
    store.recordAnomaly('append-rejected', `unfold ${foldId}: ${detail}`)
    anomalies.push({ kind: 'append-rejected', detail: `unfold ${foldId}: ${detail}` })
    return {
      ok: false,
      reasons: [fill(REASON_UNFOLD_REJECTED, { foldId, detail })],
      committed: [],
      anomalies,
    }
  }
}

/**
 * Post-commit verification (fail-soft): replace/content generation deltas and
 * checkpoint membership on the live surface. Mismatches are recorded in the
 * store anomaly ledger and echoed in the result — never thrown.
 * @internal
 */
function verifyPostCommit(
  sessionLike: SessionLike,
  store: FoldStore,
  committed: readonly CommittedFold[],
  before: GenerationSnapshot,
  after: GenerationSnapshot,
  anomalies: EngineAnomaly[],
): void {
  if (before.replaceGeneration !== undefined && after.replaceGeneration !== undefined) {
    const delta = after.replaceGeneration - before.replaceGeneration
    if (delta !== committed.length) {
      const detail = `surface replaceGeneration advanced by ${delta}, expected ${committed.length}`
      store.recordAnomaly('generation-mismatch', detail)
      anomalies.push({ kind: 'generation-mismatch', detail })
    }
  }
  if (before.contentGeneration !== undefined && after.contentGeneration !== undefined) {
    const delta = after.contentGeneration - before.contentGeneration
    if (delta !== committed.length) {
      const detail = `surface contentGeneration advanced by ${delta}, expected ${committed.length}`
      store.recordAnomaly('generation-mismatch', detail)
      anomalies.push({ kind: 'generation-mismatch', detail })
    }
  }
  const liveNodes = new Set(sessionLike.surface?.nodes ?? [])
  for (const commit of committed) {
    if (!liveNodes.has(commit.checkpointSeq)) {
      const detail = `checkpoint seq ${commit.checkpointSeq} is not on the live surface after commit`
      store.recordAnomaly('node-missing', detail, commit.checkpointSeq)
      anomalies.push({ kind: 'node-missing', detail, seq: commit.checkpointSeq })
    }
  }
}

/**
 * Tool-pair closure over each COMMIT UNIT (plan entry subrange): every tool
 * call requested by an assistant node inside the subrange must be answered by
 * a tool node inside the same subrange, and every answered tool node inside
 * must have its requesting assistant inside. Unknown pairing inside a
 * subrange fails closed (mirrors the validator's fail-closed rule at the
 * commit-unit level).
 * @internal
 */
function subrangePairReasons(
  surfaceNodes: readonly SurfaceNode[],
  folds: readonly FoldPlanEntry[],
): string[] {
  const assistantByCallId = new Map<string, SurfaceNode>()
  const toolByCallId = new Map<string, SurfaceNode>()
  for (const node of surfaceNodes) {
    if (node.role === 'assistant' && node.toolCallIds !== undefined) {
      for (const callId of node.toolCallIds) assistantByCallId.set(callId, node)
    }
    if (node.role === 'tool' && node.answersCallId !== undefined) {
      toolByCallId.set(node.answersCallId, node)
    }
  }
  const reasons: string[] = []
  for (const entry of folds) {
    const inRange = surfaceNodes.filter((n) => n.seq >= entry.startSeq && n.seq <= entry.endSeq)
    for (const node of inRange) {
      if (node.role === 'assistant') {
        if (node.toolCallIds === undefined) {
          reasons.push(
            fill(REASON_SUBRANGE_TOOL_SPLIT, {
              start: entry.startSeq,
              end: entry.endSeq,
              callId: `at seq ${node.seq}`,
              otherSeq: node.seq,
            }),
          )
          continue
        }
        for (const callId of node.toolCallIds) {
          const tool = toolByCallId.get(callId)
          if (tool !== undefined && (tool.seq < entry.startSeq || tool.seq > entry.endSeq)) {
            reasons.push(
              fill(REASON_SUBRANGE_TOOL_SPLIT, {
                start: entry.startSeq,
                end: entry.endSeq,
                callId,
                otherSeq: tool.seq,
              }),
            )
          }
        }
      }
      if (node.role === 'tool') {
        if (node.answersCallId === undefined) {
          reasons.push(
            fill(REASON_SUBRANGE_TOOL_SPLIT, {
              start: entry.startSeq,
              end: entry.endSeq,
              callId: `result at seq ${node.seq}`,
              otherSeq: node.seq,
            }),
          )
          continue
        }
        const assistant = assistantByCallId.get(node.answersCallId)
        if (assistant !== undefined && (assistant.seq < entry.startSeq || assistant.seq > entry.endSeq)) {
          reasons.push(
            fill(REASON_SUBRANGE_TOOL_SPLIT, {
              start: entry.startSeq,
              end: entry.endSeq,
              callId: node.answersCallId,
              otherSeq: assistant.seq,
            }),
          )
        }
      }
    }
  }
  return reasons
}

// ---------------------------------------------------------------------------
// Foldable-range view (status range map + nudge span table).
// ---------------------------------------------------------------------------

/**
 * Compute the foldable-span rows over the current surface: maximal runs of
 * consecutive surface nodes, split at every protected node. Protected nodes
 * mirror the validator's protected zones exactly — surface node 0, the pinned
 * first user message, the latest user message, and the recent tail
 * (last keepRecentMessages messages and the last
 * max(keepRecentTokens, protectionFloorTokens) tokens).
 */
export function foldableRanges(
  surfaceNodes: readonly SurfaceNode[],
  config: ValidatorConfig,
): NudgeRange[] {
  if (surfaceNodes.length === 0) return []

  const protectedReasons = new Map<number, string>()
  // Node 0 (validator REASON_NODE0 is unconditional).
  protectedReasons.set(surfaceNodes[0].seq, 'surface node 0 is never foldable')
  // Pinned first user + latest user.
  const firstUser = surfaceNodes.find((n) => n.role === 'user')
  if (firstUser !== undefined) {
    protectedReasons.set(firstUser.seq, 'first user message is pinned permanently')
  }
  for (let i = surfaceNodes.length - 1; i >= 0; i -= 1) {
    if (surfaceNodes[i].role === 'user') {
      protectedReasons.set(surfaceNodes[i].seq, 'the latest user turn must stay intact')
      break
    }
  }
  // Recent tail by messages.
  if (config.keepRecentMessages > 0) {
    const from = Math.max(0, surfaceNodes.length - config.keepRecentMessages)
    for (let i = from; i < surfaceNodes.length; i += 1) {
      if (!protectedReasons.has(surfaceNodes[i].seq)) {
        protectedReasons.set(surfaceNodes[i].seq, 'protected recent tail')
      }
    }
  }
  // Recent tail by tokens (mirror the validator's accumulation, incl. the
  // whole-surface-under-floor branch).
  const effectiveKeep = Math.max(config.keepRecentTokens, config.protectionFloorTokens)
  if (effectiveKeep > 0) {
    let acc = 0
    let idx = surfaceNodes.length - 1
    while (idx >= 0) {
      acc += surfaceNodes[idx].estimatedTokens
      if (acc >= effectiveKeep) break
      idx -= 1
    }
    if (idx < 0) idx = 0 // whole surface fits under the floor → all protected
    for (let i = idx; i < surfaceNodes.length; i += 1) {
      if (!protectedReasons.has(surfaceNodes[i].seq)) {
        protectedReasons.set(surfaceNodes[i].seq, 'protected recent tail')
      }
    }
  }

  // Group consecutive indices into runs sharing the same protection flag.
  const ranges: NudgeRange[] = []
  const pushRun = (startIdx: number, endIdx: number): void => {
    const nodes = surfaceNodes.slice(startIdx, endIdx + 1)
    const first = nodes[0]
    const last = nodes[nodes.length - 1]
    const tokens = nodes.reduce((sum, n) => sum + n.estimatedTokens, 0)
    const reason = protectedReasons.get(first.seq)
    if (reason !== undefined) {
      ranges.push({
        startSeq: first.seq,
        endSeq: last.seq,
        estimatedTokens: tokens,
        protected: true,
        protectedReason: reason,
      })
    } else {
      ranges.push({
        startSeq: first.seq,
        endSeq: last.seq,
        estimatedTokens: tokens,
        protected: false,
      })
    }
  }
  let runStart = 0
  for (let i = 1; i < surfaceNodes.length; i += 1) {
    const prevProtected = protectedReasons.has(surfaceNodes[i - 1].seq)
    const curProtected = protectedReasons.has(surfaceNodes[i].seq)
    if (prevProtected !== curProtected) {
      pushRun(runStart, i - 1)
      runStart = i
    }
  }
  pushRun(runStart, surfaceNodes.length - 1)
  return ranges
}

// ---------------------------------------------------------------------------
// Tool-reply renderers (the model-facing wording lives in texts.ts).
// ---------------------------------------------------------------------------

/** Render the fold result as the zctx_fold tool reply (fail-soft wording). */
export function renderFoldReply(result: FoldCommitResult): string {
  if (!result.ok) {
    const lines = [
      fill(FOLD_REPLY_REJECTED, {
        count: result.reasons.length,
        plural: result.reasons.length === 1 ? '' : 's',
      }),
    ]
    for (const reason of result.reasons) lines.push(fill(FOLD_REPLY_REASON_ROW, { reason }))
    return lines.join('\n')
  }
  const first = result.committed[0]
  const last = result.committed[result.committed.length - 1]
  const absorbed = result.plan?.folds.reduce((sum, f) => sum + f.absorbedFoldIds.length, 0) ?? 0
  const lines: string[] = []
  if (result.anomalies.length > 0) lines.push(FOLD_REPLY_ANOMALY_PREFIX)
  lines.push(
    fill(FOLD_REPLY_OK, {
      start: first.startSeq,
      end: last.endSeq,
      tokens: result.plan?.reclaimedTokens ?? 0,
      count: result.committed.length,
      plural: result.committed.length === 1 ? '' : 's',
      absorbed,
      absorbedPlural: absorbed === 1 ? '' : 's',
    }),
  )
  for (const anomaly of result.anomalies) {
    lines.push(fill(FOLD_REPLY_REASON_ROW, { reason: anomaly.detail }))
  }
  return lines.join('\n')
}

/** Render the unfold result as the zctx_unfold tool reply (fail-soft wording). */
export function renderUnfoldReply(foldId: string | undefined, result: FoldCommitResult): string {
  if (!result.ok) {
    const lines = [
      fill(UNFOLD_REPLY_REJECTED, {
        count: result.reasons.length,
        plural: result.reasons.length === 1 ? '' : 's',
      }),
    ]
    for (const reason of result.reasons) lines.push(fill(FOLD_REPLY_REASON_ROW, { reason }))
    return lines.join('\n')
  }
  const commit = result.committed[0]
  const blocks = commit.blocks ?? 0
  return fill(UNFOLD_REPLY_OK, {
    foldId: foldId ?? commit.foldId,
    seq: commit.checkpointSeq,
    blocks,
    plural: blocks === 1 ? '' : 's',
    start: commit.startSeq,
    end: commit.endSeq,
  })
}
