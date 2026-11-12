/**
 * Structural type contract for the dsh-zcontext pure cores (W2).
 *
 * Everything here is duck-typed: no host package is imported. The shapes
 * mirror the official DeepSeek Harness APIs at the anchors noted per type,
 * so W3/W4 can pass real host objects straight in.
 *
 * Official anchor baseline: zDSH-main @ zdsh-latest / HEAD 073792c7f8.
 *
 * @module types
 */

/** Official surface event types that produce surface nodes (session/src/types.ts:439-444). */
export type SurfaceEventType =
  | 'system/message'
  | 'developer/message'
  | 'user/message'
  | 'assistant/message'
  | 'tool/result'

/** Official surface replace operation (session/src/types.ts:449-464). */
export type SurfaceOpLike =
  | 'append'
  | { readonly op: 'replace'; readonly startSeq: number; readonly endSeq: number }

/** One event of the session log, structurally reduced for plugin use. */
export interface SessionEventLike {
  /** Log sequence number (equal to the event's index in the append-only log). */
  readonly seq: number
  /** Official event type string, e.g. 'user/message' or 'session/end-seed'. */
  readonly type: string
  /** Event payload (official: `{ turn, message }` for message events). */
  readonly data: unknown
  /** Surface placement — 'append' or a replace op (session/src/types.ts:449-464). */
  readonly surfaceOp?: SurfaceOpLike
  /**
   * Complete set of shadowed surface seqs for replace producers
   * (session/src/types.ts:466-477).
   */
  readonly sourceEventSeqs?: readonly number[]
}

/**
 * Minimal structural view of the surface state. `nodes` mirrors the official
 * ordered list of surface node seqs (session/src/surface.ts SurfaceFoldState);
 * the generation counters are the concurrency/retry probes consumed by
 * compaction-basic (compaction-basic/src/index.ts:202,212,230).
 */
export interface SessionSurfaceLike {
  /** Ordered seqs of the nodes currently on the surface. */
  readonly nodes?: readonly number[]
  /** Monotonic counter of content-level changes. */
  readonly contentGeneration?: number
  /** Monotonic counter of replace operations. */
  readonly replaceGeneration?: number
}

/**
 * Minimal structural Session (duck-typed; official session/src/index.ts).
 *
 * `eventAt` is exposed on the official class but marked deprecated for NEW
 * callers; the plugin consumes it only through the injected read accessor in
 * materialize.ts, so the W3 engine can back that accessor with the
 * non-deprecated snapshot read path instead.
 */
export interface SessionLike {
  /** Current log length (next seq to be assigned). */
  readonly seq?: number
  readonly surface?: SessionSurfaceLike
  /** Immutable event at one exact seq, or undefined (session/src/index.ts:711). */
  eventAt?(seq: number): SessionEventLike | undefined
}

/**
 * Minimal structural tool-execution context (official tools/src/index.ts:327-353:
 * `exec.agent?.session` reaches the Session; `exec.deferContext(UserMessage)`
 * attaches plugin guidance to the current turn).
 */
export interface ToolRunContextLike {
  /** Agent handle; `session` is the live Session when present. */
  readonly agent?: { readonly session?: SessionLike }
  /** Attach a plugin-supplied user message to the current turn. */
  readonly deferContext?: (message: unknown) => unknown
}

/**
 * Minimal structural host context handed to the plugin by the cordis
 * container (capability surface verified in options.md §1, official anchors
 * per row: tools register tools/src/index.ts:1069-1094; systemPrompt
 * system-prompt/src/index.ts:474-566; tokenMeter compaction-basic/src/index.ts:278;
 * llm model info compaction-basic/src/index.ts:304; commands
 * commands/src/index.ts:285-290). All members optional: every consumer
 * capability-probes and degrades (plan §4).
 */
export interface HostContextLike {
  readonly tools?: {
    register?(definition: unknown): unknown
  }
  readonly systemPrompt?: {
    section?(spec: unknown): unknown
    context?(spec: unknown): unknown
  }
  readonly tokenMeter?: unknown
  readonly llm?: unknown
  readonly commands?: {
    register?(command: unknown): unknown
  }
  readonly agent?: unknown
}

/**
 * One node currently on the surface, as consumed by the fold validator.
 * The six card-frozen fields are required; the pairing/annotation fields are
 * supplied by the W3 store scan and are mandatory inputs for nodes that take
 * part in a fold range (the validator fails closed on unknown pairing).
 */
export interface SurfaceNode {
  /** Surface (log) seq of the node. */
  readonly seq: number
  /** Official surface event type, e.g. 'user/message'. */
  readonly type: string
  /** Conversation role of the message carried by the node. */
  readonly role: 'user' | 'assistant' | 'tool' | 'system' | 'developer' | 'unknown'
  /** Estimated token cost of the node (engine-side estimate). */
  readonly estimatedTokens: number
  /** Convenience flag: role === 'user'. */
  readonly isUser: boolean
  /** Total text length of the node's message content, in characters. */
  readonly textLength: number
  /**
   * Assistant nodes: provider-issued ids of the tool calls embedded in the
   * message content ('tool-call' blocks). Empty array = no tool calls.
   */
  readonly toolCallIds?: readonly string[]
  /** Tool nodes: id of the assistant tool call this result answers. */
  readonly answersCallId?: string
  /** message.source?.kind when present — identifies fold checkpoints. */
  readonly sourceKind?: string
}

/**
 * Ledger record of one committed fold, rebuilt from session log scans (W3).
 * Zero independent storage: the session log is the only durable state
 * (plan §2 方案甲 6).
 */
export interface FoldRecord {
  /** Stable fold identifier (also carried by the checkpoint message source). */
  readonly foldId: string
  /** Original span start seq (pre-fold surface coords). */
  readonly startSeq: number
  /** Original span end seq (inclusive). */
  readonly endSeq: number
  /** Seq of the checkpoint node that replaced the span on the surface. */
  readonly checkpointSeq: number
  /** Summary text carried by the checkpoint message. */
  readonly summaryText: string
  /** Surface node seqs shadowed by the checkpoint (= sourceEventSeqs). */
  readonly shadowedSeqs: readonly number[]
  /** Estimated window tokens before the fold. */
  readonly tokensBefore: number
  /** Estimated window tokens after the fold. */
  readonly tokensAfter: number
}

/** Active folds keyed by foldId. */
export type FoldMap = ReadonlyMap<string, FoldRecord>

/** Complete budget report for one context window (CCM v2.3 §1.2 formulas). */
export interface Budget {
  /** Context window size W the budget was computed for. */
  readonly contextWindow: number
  /** Output hard cap C applied (explicit or the default tier). */
  readonly maxOutputCap: number
  /** maxTokens = min(C, floor(W×0.10)). */
  readonly maxTokens: number
  /** reserve = ceil(maxTokens×1.25) + 4096. */
  readonly reserve: number
  /** toolCap = max(1024, floor(0.25×(reserve−maxTokens))). */
  readonly toolCap: number
  /** R_pess = maxTokens + BATCH_CAP(2)×toolCap + 4096. */
  readonly pessimisticReserve: number
  /** triggerLine = W − R_pess (the single trigger oracle). */
  readonly triggerLine: number
  /** keepRecent = min(max(⌊0.12W⌋, min(20000, ⌊0.30W⌋)), ⌊0.8×triggerLine⌋). */
  readonly keepRecent: number
  /** summaryInputCap = triggerLine − keepRecent. */
  readonly summaryInputCap: number
  /** summaryOutputCap = min(C, maxTokens, ⌊0.8×reserve⌋, max(8192, ⌊0.01W⌋)). */
  readonly summaryOutputCap: number
  /** replyCap = max(2048, toolCap formula floor(0.25×(reserve−maxTokens))). */
  readonly replyCap: number
  /** Fixed wire overhead: 4 tool schemas + guidance section (S1 accounting). */
  readonly fixedWireOverhead: number
  /** rMin = 1 − (maxTokens + 2×toolCap)/W (theoretical steady-state hit floor). */
  readonly rMin: number
}

/** One fold of a validated batch: one summary block over one subrange. */
export interface FoldPlanEntry {
  /** Subrange start seq covered by this summary (inside the fold window). */
  readonly startSeq: number
  /** Subrange end seq (inclusive). */
  readonly endSeq: number
  /** Summary text for the subrange. */
  readonly summaryText: string
  /** Estimated tokens of the summary text. */
  readonly summaryTokens: number
  /** Estimated tokens reclaimed by this subrange (nodes − summary). */
  readonly reclaimedTokens: number
  /** Active folds absorbed (checkpoint inside the window) by this entry. */
  readonly absorbedFoldIds: readonly string[]
}

/** Validator acceptance plan (atomic — produced only when every check passed). */
export interface FoldPlan {
  /** One entry per summary block of the validated fold window. */
  readonly folds: readonly FoldPlanEntry[]
  /** Whole-window net reclaim: Σ(range node estimates) − Σ(summary estimates). */
  readonly reclaimedTokens: number
}

/** Validator result: rejected with all reasons, or accepted with the plan. */
export type FoldValidationResult =
  | { readonly ok: false; readonly reasons: readonly string[] }
  | { readonly ok: true; readonly plan: FoldPlan }

/** One summary block submitted with a fold window. */
export interface FoldSummaryInput {
  /** Subrange start seq (must sit inside the fold window). */
  readonly startSeq: number
  /** Subrange end seq (inclusive). */
  readonly endSeq: number
  /** Summary text for the subrange. */
  readonly text: string
}

/** Validator-facing configuration slice (resolved values; plan §3 statics). */
export interface ValidatorConfig {
  /** Resolved recent-tail protection in messages (from budget.keepRecent policy). */
  readonly keepRecentMessages: number
  /** Resolved recent-tail protection in tokens (0 = rule off). */
  readonly keepRecentTokens: number
  /** Extra floor of tokens always kept outside folds (plan §3). */
  readonly protectionFloorTokens: number
  /** Minimum foldable window in estimated tokens (qualification line). */
  readonly minFoldableTokens: number
  /** Upper bound on the window fraction of one fold (requires contextWindow). */
  readonly maxFoldFraction: number
  /** Shortest acceptable summary in characters. */
  readonly summaryFloorChars: number
  /** Longest acceptable summary in characters. */
  readonly summaryCeilingChars: number
  /** Net-shrink multiplier gate (default 1.05). */
  readonly netShrinkTolerance: number
  /** Context window size; enables the maxFoldFraction check when present. */
  readonly contextWindow?: number
}

/** Complete validator input (task card W2 §2). */
export interface ValidateFoldInput {
  /** Currently active folds (rebuilt ledger). */
  readonly foldMap: FoldMap
  /** Ordered surface nodes (as on the current surface). */
  readonly surfaceNodes: readonly SurfaceNode[]
  /** The single fold window to validate (official replace span). */
  readonly range: { readonly startSeq: number; readonly endSeq: number }
  /** Summary blocks submitted for the window (each covers a subrange). */
  readonly summaries: readonly FoldSummaryInput[]
  readonly config: ValidatorConfig
}

/** Materialized text block — official TextBlock shape (llm/src/types.ts:62-65). */
export interface MaterializeBlock {
  readonly type: 'text'
  readonly text: string
}

/** Read accessor over the session log used by materialize.ts. */
export interface MaterializeAccessor {
  /** Immutable event at one exact seq, or undefined. */
  eventAt(seq: number): SessionEventLike | undefined
}

/** One searchable corpus entry for recall. */
export interface RecallEntry {
  /** Owning fold id. */
  readonly foldId: string
  /** 'summary' = checkpoint summary text; 'original' = folded-away original. */
  readonly kind: 'summary' | 'original'
  /** Searchable text. */
  readonly text: string
  /** Source span of the entry (summary: the original span; original: same). */
  readonly range: { readonly startSeq: number; readonly endSeq: number }
}

/** One recall hit: corpus entry + score + context excerpt. */
export interface RecallHit {
  readonly foldId: string
  readonly kind: 'summary' | 'original'
  readonly text: string
  readonly range: { readonly startSeq: number; readonly endSeq: number }
  /** Hit score (higher = better; deterministic tie-breaking applies). */
  readonly score: number
  /** ±120-char context around the first hit. */
  readonly excerpt: string
}

/** One foldable-span row rendered by the nudge. */
export interface NudgeRange {
  readonly startSeq: number
  readonly endSeq: number
  readonly estimatedTokens: number
  /** True when the span must not be folded (protected tail / pinned user). */
  readonly protected: boolean
  /** Why the span is protected (rendered after the PROTECTED marker). */
  readonly protectedReason?: string
}

/** Nudge voice bands. */
export type NudgeVoice = 'gentle' | 'emergency'

/**
 * Frozen source payload of a zctx fold/unfold checkpoint message
 * (plan §3 S4: minimal form, official compaction checkpoint 同位形态
 * compaction/src/checkpoint.ts:19-31 — kind + id only). The structural twin
 * of the MessageSourceMap augmentation in src/types/message-source.d.ts;
 * keep the two in sync.
 */
export type ZcontextCheckpointSource = {
  kind: 'zctx-fold' | 'zctx-unfold'
  foldId: string
  tokensBefore?: number
  tokensAfter?: number
}

/**
 * Token amount with a measured/estimated marker (S6): measured = read from
 * assistant/message usage (cacheReadTokens/cacheWriteTokens); estimated =
 * chars/3 fallback, reported degraded by zctx_status.
 */
export interface BreakevenAmount {
  readonly tokens: number
  readonly measured: boolean
}

/** Price factors of the breakeven model (VERIFY-C #15 defaults). */
export interface BreakevenPrice {
  /** Cache write price factor (default 1.0). */
  readonly w: number
  /** Cache read price factor (default 0.1). */
  readonly r: number
  /** Fresh-token price factor (default 4.0). */
  readonly q: number
}

/** Breakeven input: S (folded away), σ (summary), T (first-request repay). */
export interface BreakevenInput {
  /** S — tokens removed from the window by the fold. */
  readonly folded: BreakevenAmount
  /** σ — tokens of the summary block. */
  readonly summary: BreakevenAmount
  /** T — cache re-pay tokens of the first request after the fold. */
  readonly repay: BreakevenAmount
  /** Price factors; defaults w=1.0, r=0.1, q=4.0 (VERIFY-C #15). */
  readonly price?: Partial<BreakevenPrice>
}

/** Breakeven report (VERIFY-C #15 formulas; units are price-weighted tokens). */
export interface BreakevenReport {
  /** (w−r)·T + q·σ − r·S. */
  readonly oneTimeCost: number
  /** (S−σ)·r — steady per-turn saving. */
  readonly perTurnSaving: number
  /** Turns until the fold pays off (max(0, oneTimeCost)/perTurnSaving). */
  readonly breakevenTurns: number
  /** S−σ — net window tokens removed. */
  readonly netTokens: number
  /** True when every input was measured (not estimated). */
  readonly measured: boolean
  /** Which inputs are estimated: subset of ['folded','summary','repay']. */
  readonly estimatedInputs: readonly ('folded' | 'summary' | 'repay')[]
}
