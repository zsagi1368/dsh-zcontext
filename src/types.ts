/**
 * Structural type contract for the dsh-zcontext pure cores (W2) and the
 * observability ledgers (v0.2.0 route-two, V1).
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

/**
 * One event of the session log, structurally reduced for plugin use.
 */
export interface SessionEventLike {
  /** Log sequence number (equal to the event's index in the append-only log). */
  readonly seq: number
  /** Official event type string, e.g. 'user/message' or 'session/end-seed'. */
  readonly type: string
  /** Event payload (official: `{ turn, message }` for message events). */
  readonly data: unknown
  /**
   * Unix epoch milliseconds of the event commit (official SessionEvent.time,
   * session/src/types.ts:499). Optional: the structural contract tolerates
   * events that carry no time (mock feeds), and consumers degrade.
   */
  readonly time?: number
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
  /**
   * Convenience flag: always derived as `role === 'user'` (fixed invariant —
   * a derived view of `role`, not an independent second source of truth; the
   * W3 store scan derives it from the role and must never set it on its own).
   */
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

// ---------------------------------------------------------------------------
// Observability ledgers (v0.2.0 route-two; RES-observe-route.md §(a) table
// a.1 — the field set below is FROZEN per that table; V3 (attribution engine)
// and V2 (llm/stream listener) consume the parts the V1 store does not fill).
// ---------------------------------------------------------------------------

/**
 * One provider usage sample taken from an assistant/message event (S6).
 * Moved here from store.ts in V1 so {@link UsageRecord} can extend it without
 * a types→store cycle; store.ts re-exports it, keeping the W3 public surface
 * (index.ts `export type { UsageSample } from './store.ts'`) unchanged.
 */
export interface UsageSample {
  /** Seq of the assistant/message event. */
  readonly seq: number
  /** True when the event carried a usable usage object. */
  readonly measured: boolean
  /** Optional provider cache-read tokens. */
  readonly cacheReadTokens?: number
  /** Optional provider cache-write tokens. */
  readonly cacheWriteTokens?: number
}

/**
 * Structural view of the call config carried by a logged request header
 * (official LlmCallConfig, llm/llm/src/call-config.ts:36-41 — provider/model
 * plus the LlmCallControls scalars of :27-32). `reasoningEffort` is
 * duck-typed as string (the official type is a branded string id).
 */
export interface LlmCallConfigLike {
  readonly provider: string
  readonly model: string
  readonly reasoningEffort?: string
  readonly temperature?: number
  readonly maxTokens?: number
  readonly stop?: readonly string[]
}

/**
 * Effective config fields supplied by exact-model adapter resolution
 * (official LlmCallConfigAdapterDefaults, call-config.ts:55-60).
 */
export interface LlmCallConfigAdapterDefaultsLike {
  readonly reasoningEffort?: true
  readonly maxTokens?: true
}

/**
 * One logged request/header snapshot, cached by the store (RES-observe-route
 * a.1 row 3: config/adapterDefaults/tools/reason/startsSeries/seq). Official
 * payload shape: session/src/types.ts:388-395 (`EpochHeader` at :270-281,
 * `RequestHeaderReason` at :381-387).
 */
export interface RouteHeader {
  /** The header's call config (provider/model/effort/sampling scalars). */
  readonly config: LlmCallConfigLike
  /** Effective config fields materialized from the exact adapter. */
  readonly adapterDefaults?: LlmCallConfigAdapterDefaultsLike
  /** Assembled tool schemas; absent for a tool-less request. */
  readonly tools?: readonly unknown[]
  /** Why the snapshot was appended (official request/header reason). */
  readonly reason: 'initial' | 'resume' | 'change' | 'series'
  /** This request begins a distinct model-message series, independently of reason. */
  readonly startsSeries?: true
  /** Log seq of the producing request/header event. */
  readonly seq: number
}

/**
 * Cache-reset ledger classes the session/event face can identify (V1 store).
 * Mapping of the zDSH-Go guardian 8-class whitelist
 * (cache-guardian.ts:520-531) onto plugin-visible signals per
 * RES-observe-route.md §Q6: 7 of 8 classes are identifiable here, the
 * `sessionRecovery` restart form is half-visible (end-seed + resume header
 * only), and `oneShotExempt` belongs to the llm/stream listener (V2), not to
 * this ledger. `sampling-change` covers the call-config scalars that
 * `callConfigEquals` compares but the guardian whitelist folds elsewhere —
 * they break the wire prefix all the same (call-config.ts:1-6 rationale).
 */
export type ResetEventKind =
  /** Provider/model/reasoningEffort changed (request/header reason 'change'). */
  | 'model-change'
  /** temperature/maxTokens/stop changed (request/header reason 'change'). */
  | 'sampling-change'
  /** Tool schemas changed (request/header tools diff vs the previous header). */
  | 'toolset-change'
  /** Official compaction bracket opened (compaction/start … compaction/end). */
  | 'compaction'
  /** Our own fold/unfold checkpoint replaced a surface span. */
  | 'merge-rewrite'
  /** A foreign single tool/result node was rewritten in place (pruner shape). */
  | 'micro-prune'
  /** Any other foreign replace producer (unattributable, Q6 unresolved ①). */
  | 'unknown-replace'
  /** A system/message node was rewritten on the surface (normalization). */
  | 'system-section-change'
  /** Session generation boundary (session/end-seed; sessionRecovery half-class). */
  | 'session-recovery'
  /**
   * A request/header with reason 'series' — the producer SELF-ADMITTED that
   * the message-series prefix is no longer continuous (official semantics,
   * session/src/types.ts:265-273: "an unchanged header began an explicitly
   * distinct message series or followed a surface replacement"). V1 handoff
   * ruling ①: this observable signal is accounted as a reset in its own right
   * (RES-observe-route §Q6 "归入可见"). It may coincide with a replace-driven
   * entry (e.g. merge-rewrite) — the ledger records per-SIGNAL, not per
   * physical reset, so both entries stand and V3's digest counts kinds.
   */
  | 'series-restart'

/** One cache-reset ledger entry (RES-observe-route a.1 row 4: kind/seq/time/evidence). */
export interface ResetEvent {
  /** The identified reset class. */
  readonly kind: ResetEventKind
  /** Log seq of the event that produced the reset. */
  readonly seq: number
  /** Unix epoch ms of the producing event, when the event carried a time. */
  readonly time?: number
  /** Human-readable evidence (which fields differed / which nodes were replaced). */
  readonly evidence: string
}

/**
 * Attribution of one usage sample to one committed fold (RES-observe-route
 * a.1 row 2, §Q4.2 rules). Produced by the V3 attribution engine; the V1
 * store freezes the shape only.
 */
export interface FoldUsageAttribution {
  /** FoldRecord.foldId of the attributed fold. */
  readonly foldId: string
  /** Seq of the fold's checkpoint (surfaceOp replace) event. */
  readonly foldCommitSeq: number
  /** Seq of the attributed assistant/message event. */
  readonly messageSeq: number
  /** Turn of the attributed message. */
  readonly turn: number
  /** Step of the attributed message. */
  readonly step: number
  /** Association strength (§Q4.2: strong = clean; retry = retried; weak = degraded to estimate). */
  readonly quality: 'strong' | 'retry' | 'weak'
  /** llm/retry events counted between fold commit and the attributed message. */
  readonly retryCount: number
  /** The attributed assistant/message was an interrupted prefix (§Q4.3 noise 7). */
  readonly interrupted?: true
  /**
   * §Q4.2 rule 4 time-window fallback marker (V3): the seq chain between the
   * fold commit and the attributed message was BROKEN (store resync gap —
   * retained events do not cover the whole span), so the association degraded
   * to `T_M − T_F ≤ attributionTimeWindowMs 且同 turn`. Such associations are
   * honesty-capped at quality 'weak' (purity is unverifiable on a broken
   * chain) and therefore never enter the fold account (总账 only).
   */
  readonly timeWindow?: true
}

/** Three-state accounting grade of a usage record (§Q7.2). */
export type UsageRecordState = 'measured' | 'semi' | 'estimated'

/**
 * Which semi path graded a usage record (V3; RES-observe-route §Q7.2 rule 2).
 * `interpolated` = usage absent but a same-turn later measured sample exists
 * with no route/system-section reset in between → input-side fields carried
 * over from that anchor sample. `meterAnchored` = usage absent but the
 * official tokenMeter (injected through {@link MeterAnchorLike}) projected
 * the request's input side → inputTokens carries that anchor; cache fields
 * stay ABSENT (the meter cannot know provider cache state — 缺席不反推).
 */
export type UsageRecordSemiKind = 'interpolated' | 'meterAnchored'

/**
 * One request's three-state usage ledger entry (RES-observe-route a.1 row 1:
 * UsageSample + inputTokens/outputTokens/totalTokens/state/attribution).
 * `state: 'semi'` is filled by the V3 paths ({@link UsageRecordSemiKind});
 * the V1 store emits only 'measured' (usage object present) and 'estimated'
 * (absent — absence is never reverse-inferred into cache support, §Q2.3).
 * `attribution` is filled by the V3 attribution engine.
 */
export interface UsageRecord extends UsageSample {
  /** Un-cached input tokens (official TokenUsage disjoint accounting, llm/src/types.ts:167-173). */
  readonly inputTokens?: number
  /** Output tokens. */
  readonly outputTokens?: number
  /** Total tokens, when the provider reported one. */
  readonly totalTokens?: number
  /** The three-state grade of this record. */
  readonly state: UsageRecordState
  /** Which semi path graded this record; present exactly when state is 'semi'. */
  readonly semiKind?: UsageRecordSemiKind
  /** Fold attribution, when the V3 engine bound this sample to a fold. */
  readonly attribution?: FoldUsageAttribution
}

/** Three-state sample counts (§Q7.2 grades). */
export interface ThreeStateCounts {
  readonly measured: number
  readonly semi: number
  readonly estimated: number
}

/** One fold's row of the repay table (§Q7.3 回本表). */
export interface BreakevenTableRow {
  /** The attributed fold. */
  readonly foldId: string
  /** Turns until the fold pays off (breakeven model output). */
  readonly breakevenTurns: number
  /** Attribution quality of the row's best sample. */
  readonly quality: 'strong' | 'retry' | 'weak'
  /**
   * V3 repay-event detection (§Q7.3, price-weighted domain): true when the
   * session has run at least max(1, ⌈breakevenTurns⌉) assistant/messages after
   * the fold commit — the first such message is the repay event. Absent from
   * a row means the detection input was unavailable (treated as not repaid).
   */
  readonly repaid?: boolean
  /** Seq of the repay-event assistant/message; present exactly when repaid is true. */
  readonly repayEventSeq?: number
}

/** The reset-ledger digest row: one kind with its entry count. */
export interface ResetSummaryRow {
  readonly kind: ResetEventKind
  readonly count: number
}

/**
 * Aggregated observability view consumed by zctx_status (RES-observe-route
 * a.1 row 6: threeState 计数 / 纯净样本占比 / 回本表 / 重置台账摘要).
 * Built by the V3 aggregation; the V1 store freezes the shape only.
 */
export interface ObservabilitySnapshot {
  /** Sample counts per three-state grade. */
  readonly threeState: ThreeStateCounts
  /** Clean-sample ratio in [0,1] (§Q4.3 noise剔除后纯净占比; honest-degradation threshold input). */
  readonly cleanSampleRatio: number
  /** One row per attributed fold (repay table). */
  readonly breakevenTable: readonly BreakevenTableRow[]
  /** Reset ledger digest, one row per observed kind (order: first-seen). */
  readonly resetSummary: readonly ResetSummaryRow[]
}

// ---------------------------------------------------------------------------
// llm/stream observe face (v0.2.0 V2; RES-observe-route a.1 row 5 + a.3).
// ALL shapes here are PROCESS-MEMORY ledgers: the session log stays the only
// durable state and none of these records is ever written to it (CARD-F a.1
// 进程内不入账). The store keeps the receive ports; the V2 listener builds.
// ---------------------------------------------------------------------------

/**
 * Which request-projection implementation produced a snapshot's hashes.
 * Domain-field discipline: the two variants do NOT normalize identically
 * (the local fallback cannot replicate the official file/image/tool-update
 * projections exactly), so every snapshot names its own projector and the
 * ledger never mixes them silently.
 */
export type SnapshotProjector = 'official' | 'local-fallback'

/**
 * One llm/stream request snapshot (RES-observe-route a.1 row 5:
 * perMessageHashes/systemHash/toolsHash/attemptSeq/purpose/isLoop, plus the
 * honest-domain fields the card requires). Built by the V2 observe listener
 * for every MAIN-CHAIN request (four criteria, Q8.1) and handed to the store
 * through the injected snapshot sink.
 */
export interface RequestSnapshot {
  /** Session id the request was bound to (matched against the watched set, criterion 3). */
  readonly sessionId: string
  /** Per-session monotonic ordinal, gap-free (only snapshotted requests increment). */
  readonly attemptSeq: number
  /** Request route (audit face; route changes are reset-ledger territory, not breaks). */
  readonly provider: string
  readonly model: string
  /** Per-message stable hashes (stableStringify key-sorted + sha256) of the normalized message list. */
  readonly perMessageHashes: readonly string[]
  /** Stable hash of `options.system` when present (one-shot requests only; undefined on the loop chain). */
  readonly systemHash?: string
  /** Stable hash of `options.tools` when present. */
  readonly toolsHash?: string
  /** Official one-shot purpose marker; always undefined on snapshotted (main-chain) requests. */
  readonly purpose?: 'compaction' | 'session-title'
  /** Criterion-1 verdict (true for every snapshotted request; recorded for audit). */
  readonly isLoop: boolean
  /** Which projection implementation normalized the hashes. */
  readonly projector: SnapshotProjector
  /** Unix epoch ms of the snapshot. */
  readonly time: number
}

/** Reference to one reset-ledger entry that explains a prefix break. */
export interface PrefixBreakResetRef {
  readonly kind: ResetEventKind
  readonly seq: number
}

/**
 * One harness-domain prefix break (V2 mechanical piece): the object-level
 * message prefix SHRANK or CHANGED between consecutive snapshots. Registered
 * blind spot (honest domain boundary, RES-observe-route §Q5.2): pi-ai wire
 * rewrites (bit reordering, system folding, effort synthesis, breakpoint
 * shifts) are invisible at the object level — `domain: 'harness'` pins that.
 *
 * Deliberate narrowing (V2-B closure, R3 review; spec a.3 as written): break
 * detection compares the MESSAGE-LIST hashes only — the snapshot's
 * `systemHash`/`toolsHash` are collected for audit but do NOT participate;
 * system-section and toolset changes are the reset ledger's territory
 * (`system-section-change` / `toolset-change` / `sampling-change` classes +
 * the exemption window), so V3 aggregation must not read this record as a
 * statement about the system or tools segments.
 */
export interface PrefixBreakRecord {
  /** Always 'harness' — object-level hashes cover the harness domain only. */
  readonly domain: 'harness'
  /** Session id the snapshots belong to. */
  readonly sessionId: string
  /** attemptSeq of the snapshot that broke the prefix. */
  readonly attemptSeq: number
  /** attemptSeq of the previous snapshot (undefined when the store had no baseline). */
  readonly prevAttemptSeq?: number
  /** First differing message index inside the common prefix; undefined = pure tail shrink. */
  readonly breakIndex?: number
  /** How the break manifested. */
  readonly mode: 'length-shrink' | 'content-change'
  /**
   * Break classification (card: 关联 ResetEvent 分类或 unknown-break):
   * 'reset-explained' when the listener consumed reset-ledger entries between
   * the two snapshots, 'unknown-break' otherwise (runtime-context refresh and
   * other unlogged object churn, §Q4.3 noise 6).
   */
  readonly classification: 'reset-explained' | 'unknown-break'
  /** The explaining reset entries (present exactly when classification is 'reset-explained'). */
  readonly explainedBy?: readonly PrefixBreakResetRef[]
  /** Unix epoch ms of the newer snapshot. */
  readonly time: number
}

/**
 * One FAILED attempt's usage captured by the optional `observe.attemptCapture`
 * face (RES-observe-route §Q8.2 item 2: session logs keep no per-attempt
 * usage for retried-away attempts — the llm/stream listener wrapping `next()`
 * is the only capture position, and the record dies with the process).
 */
export interface CapturedAttemptUsage {
  /** Session id the request was bound to. */
  readonly sessionId: string
  /** The snapshot's attemptSeq (0 when the exempt window consumed the request without a snapshot). */
  readonly attemptSeq: number
  /** Request route. */
  readonly provider: string
  readonly model: string
  /** The usage chunk observed before the terminal error/abort. */
  readonly usage: {
    readonly inputTokens?: number
    readonly outputTokens?: number
    readonly totalTokens?: number
    readonly cacheReadTokens?: number
    readonly cacheWriteTokens?: number
  }
  /** How the stream terminated (official FinishReason kinds, llm/src/types.ts:156-163). */
  readonly outcome: 'error' | 'aborted'
  /** Always true — this record never reaches the session log and is lost on exit. */
  readonly nonDurable: true
  /** Unix epoch ms of the capture. */
  readonly time: number
}

/**
 * Injected meter-anchor interface for the V3 `meterAnchored` semi path
 * (RES-observe-route §Q7.2 rule 2b: usage absent but the official tokenMeter
 * is injectable → its surface projection anchors the request's input side;
 * the card freezes that this path goes through INJECTION, never a host
 * import inside the pure core). Implemented by the plugin over the official
 * TokenMeasurement surface nodes (token-meter/src/types.ts:31-56).
 */
export interface MeterAnchorLike {
  /**
   * Input-side token anchor for the request that produced the message at
   * `seq`: the summed token price of the surface nodes positioned before the
   * message's own node, per the meter's route-priced projection. Undefined
   * when the meter cannot see the message's node (surface moved on, meter
   * unavailable) — the record then stays honestly 'estimated'.
   */
  inputAnchor(seq: number): number | undefined
}

// ---------------------------------------------------------------------------
// S1 preflight face (v0.2.0 V4; RES-adapter-route §11b S1 + F3.3/F3.4/F6.1-F6.4/
// F8.3). Process-memory calibration ledger like the V2 faces above: never
// session-logged, bounded, dies with the process.
// ---------------------------------------------------------------------------

/** Preflight mode tri-state (config preflightMode; R2: default 'observe'). */
export type PreflightMode = 'off' | 'observe' | 'enforce'

/**
 * Which image-cost path priced the kept image blocks of one estimate.
 * 'adapter' = the injected official `imageRequestPricing` answered
 * (visualTokens + text per occurrence, llm/src/types.ts:212-220);
 * 'constant-reserve' = the pricing face was unavailable and each image
 * carried a fixed conservative reserve instead (待标定; honest domain label);
 * 'not-exercised' = no image occurrence stayed on the wire (none present, or
 * all projected away by the official image-less gating) so no pricing
 * decision was involved.
 */
export type PreflightImagePricing = 'adapter' | 'constant-reserve' | 'not-exercised'

/** How one preflight-judged attempt settled (calibration record outcome). */
export type PreflightOutcome =
  /** The stream completed and a usage chunk was observed (comparable). */
  | 'completed'
  /** enforce hit → the synthesized error finish replaced the stream (no usage exists). */
  | 'short-circuited'
  /** The stream ran but no usage chunk appeared (not comparable). */
  | 'no-usage'
  /** The stream threw before a terminal finish (not comparable). */
  | 'error'
  /** The stream was aborted before a terminal finish (not comparable). */
  | 'aborted'

/**
 * One preflight estimate-vs-reality calibration record (card product 3: the
 * estimate / judgment / subsequent-real-usage comparison = the calibration
 * dataset that decides when enforce is safe to promote — no-go condition 4).
 * Absorbed ONCE per judged attempt, at stream settle (or immediately on an
 * enforce short-circuit, where no stream ever ran).
 */
export interface PreflightCalibrationRecord {
  /** Session id the judged request belonged to. */
  readonly sessionId: string
  /** The mode the listener ran under ('observe' | 'enforce'; 'off' never records). */
  readonly mode: Exclude<PreflightMode, 'off'>
  /** Request route. */
  readonly provider: string
  readonly model: string
  /** The chars/3 estimate of the projected request input, in tokens. */
  readonly estimate: number
  /** The context window the judgment used; undefined = unresolvable (released). */
  readonly window?: number
  /** The CCM trigger line (W − R_pess) for the window; present exactly when window is. */
  readonly triggerLine?: number
  /** The margin ratio applied (config preflightMarginRatio, echoed for audit). */
  readonly marginRatio: number
  /** Which projection implementation produced the estimate ('official'/'local-fallback'). */
  readonly projector: SnapshotProjector
  /** Which image-cost path priced the kept images. */
  readonly imagePricing: PreflightImagePricing
  /**
   * Number of image occurrences KEPT on the wire (the pricing path's input;
   * projected-away images are already part of the text estimate through their
   * placeholder text).
   */
  readonly imageCount: number
  /**
   * The judgment: true = over the calibrated line (enforce would short-circuit),
   * false = under it, undefined = window unresolvable → released honestly
   * (F6.4 degrade-to-observe).
   */
  readonly hit: boolean | undefined
  /** How the attempt settled. */
  readonly outcome: PreflightOutcome
  /**
   * The usage chunk observed before the terminal finish, when one appeared
   * (input side is the estimate's comparison target through the DISJOINT
   * accounting: billed input = input + cacheRead + cacheWrite, §Q2.1).
   */
  readonly usage?: {
    readonly inputTokens?: number
    readonly outputTokens?: number
    readonly totalTokens?: number
    readonly cacheReadTokens?: number
    readonly cacheWriteTokens?: number
  }
  /** Unix epoch ms of the estimate (stream start), not of the settle. */
  readonly time: number
}
