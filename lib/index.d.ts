/**
 * Plugin configuration contract and schema (plan §3; every field primitive).
 *
 * Moved verbatim from the W1 index.ts skeleton in W4: the plugin class needs
 * `configSchema` at class-definition time (`static Config`), so it must live
 * in a module the plugin imports WITHOUT the index.ts cycle. The public
 * surface is unchanged — index.ts re-exports everything it always did.
 *
 * Host-face types are structural (duck-typed): `@deepseek-ai/schemastery` is
 * resolved lazily at load time and falls back to a minimal built-in validator
 * (fail-soft) when it cannot be resolved, so this module always loads.
 *
 * @module config
 */
/** Frozen plugin configuration contract (plan §3; every field is primitive). */
interface ZcontextConfig {
  /** Master switch; when false the plugin stays passive (official compaction remains the hard floor). */
  enabled: boolean;
  /** Comma-separated context-occupancy percentages that trigger a nudge. */
  nudgeThresholds: string;
  /** Verbatim recent-tail token budget; 0 = automatic. */
  keepRecentTokens: number;
  /** Upper bound on the fraction of the context window a single fold may cover. */
  maxFoldFraction: number;
  /** Minimum foldable span in tokens below which folding is refused. */
  minFoldableTokens: number;
  /** Tokens kept outside any fold window (system head, protected tail). */
  protectionFloorTokens: number;
  /** Shortest acceptable summary text length in characters. */
  summaryFloorChars: number;
  /** Longest acceptable summary text length in characters. */
  summaryCeilingChars: number;
  /** Multiplier gate: a fold must shrink the ledger by at least 1/netShrinkTolerance. */
  netShrinkTolerance: number;
  /**
   * Attribution time-window fallback in ms (V1): when seq reads are
   * interrupted (store resync gap), fold→message association degrades to
   * `messageTime − foldCommitTime ≤ attributionTimeWindowMs` (RES-observe-route
   * §Q4.2 rule 4). Default 90000 — 待真机标定 (calibration pending, plan §3).
   */
  attributionTimeWindowMs: number;
  /**
   * Clean-sample floor in [0,1] (V1): below this ratio of cleanly attributed
   * samples zctx_status reports "attribution confidence insufficient" instead
   * of a breakeven conclusion (RES-observe-route §Q7.3 honest degradation).
   * Default 0.6 — 待真机标定 (calibration pending, plan §3).
   */
  cleanSampleFloor: number;
  /**
   * Observe face master switch (v0.2.0 V2, task card product 4): registers
   * the read-only `llm/stream` waterfall listener whose per-attempt request
   * snapshots + prefix-break records land in the per-session store's
   * process-memory ledgers (RES-observe-route a.2/a.3). Default true — the
   * face is observation-only and never short-circuits (V4 boundary).
   */
  'observe.enabled': boolean;
  /**
   * Per-attempt usage capture (v0.2.0 V2): when true the observe listener
   * wraps `next()` chunk-by-chunk to record FAILED attempts' usage into the
   * NON-DURABLE process-memory ledger (RES-observe-route §Q8.2; never
   * session-logged, CARD-F a.1 进程内不入账). Default false — opt-in.
   */
  'observe.attemptCapture': boolean;
}
/** Contractual defaults for every Config field (plan §3). */
declare const configDefaults: Readonly<ZcontextConfig>;
/** `~standard.validate` issue shape (StandardSchemaV1 subset). */
interface StandardValidateIssue {
  readonly message: string;
}
/** `~standard.validate` result shape (StandardSchemaV1 subset). */
interface StandardValidateResult {
  readonly value?: unknown;
  readonly issues?: readonly StandardValidateIssue[];
}
/** `~standard` props the cordis registry reads off a plugin Config. */
interface StandardSchemaProps {
  readonly version: 1;
  readonly vendor: string;
  validate(value: unknown): StandardValidateResult | Promise<StandardValidateResult>;
}
/** Structural shape required of the plugin `Config` (StandardSchemaV1 subset). */
interface ConfigSchemaLike {
  readonly '~standard': StandardSchemaProps;
}
/** Plugin Config schema: schemastery-backed when available, fail-soft shim otherwise. */
declare const configSchema: ConfigSchemaLike;
/** Official surface replace operation (session/src/types.ts:449-464). */
type SurfaceOpLike = 'append' | {
  readonly op: 'replace';
  readonly startSeq: number;
  readonly endSeq: number;
};
/**
 * One event of the session log, structurally reduced for plugin use.
 */
interface SessionEventLike {
  /** Log sequence number (equal to the event's index in the append-only log). */
  readonly seq: number;
  /** Official event type string, e.g. 'user/message' or 'session/end-seed'. */
  readonly type: string;
  /** Event payload (official: `{ turn, message }` for message events). */
  readonly data: unknown;
  /**
   * Unix epoch milliseconds of the event commit (official SessionEvent.time,
   * session/src/types.ts:499). Optional: the structural contract tolerates
   * events that carry no time (mock feeds), and consumers degrade.
   */
  readonly time?: number;
  /** Surface placement — 'append' or a replace op (session/src/types.ts:449-464). */
  readonly surfaceOp?: SurfaceOpLike;
  /**
   * Complete set of shadowed surface seqs for replace producers
   * (session/src/types.ts:466-477).
   */
  readonly sourceEventSeqs?: readonly number[];
}
/**
 * Minimal structural view of the surface state. `nodes` mirrors the official
 * ordered list of surface node seqs (session/src/surface.ts SurfaceFoldState);
 * the generation counters are the concurrency/retry probes consumed by
 * compaction-basic (compaction-basic/src/index.ts:202,212,230).
 */
interface SessionSurfaceLike {
  /** Ordered seqs of the nodes currently on the surface. */
  readonly nodes?: readonly number[];
  /** Monotonic counter of content-level changes. */
  readonly contentGeneration?: number;
  /** Monotonic counter of replace operations. */
  readonly replaceGeneration?: number;
}
/**
 * Minimal structural Session (duck-typed; official session/src/index.ts).
 *
 * `eventAt` is exposed on the official class but marked deprecated for NEW
 * callers; the plugin consumes it only through the injected read accessor in
 * materialize.ts, so the W3 engine can back that accessor with the
 * non-deprecated snapshot read path instead.
 */
interface SessionLike {
  /** Current log length (next seq to be assigned). */
  readonly seq?: number;
  readonly surface?: SessionSurfaceLike;
  /** Immutable event at one exact seq, or undefined (session/src/index.ts:711). */
  eventAt?(seq: number): SessionEventLike | undefined;
}
/**
 * Minimal structural tool-execution context (official tools/src/index.ts:327-353:
 * `exec.agent?.session` reaches the Session; `exec.deferContext(UserMessage)`
 * attaches plugin guidance to the current turn).
 */
interface ToolRunContextLike {
  /** Agent handle; `session` is the live Session when present. */
  readonly agent?: {
    readonly session?: SessionLike;
  };
  /** Attach a plugin-supplied user message to the current turn. */
  readonly deferContext?: (message: unknown) => unknown;
}
/**
 * One node currently on the surface, as consumed by the fold validator.
 * The six card-frozen fields are required; the pairing/annotation fields are
 * supplied by the W3 store scan and are mandatory inputs for nodes that take
 * part in a fold range (the validator fails closed on unknown pairing).
 */
interface SurfaceNode {
  /** Surface (log) seq of the node. */
  readonly seq: number;
  /** Official surface event type, e.g. 'user/message'. */
  readonly type: string;
  /** Conversation role of the message carried by the node. */
  readonly role: 'user' | 'assistant' | 'tool' | 'system' | 'developer' | 'unknown';
  /** Estimated token cost of the node (engine-side estimate). */
  readonly estimatedTokens: number;
  /**
   * Convenience flag: always derived as `role === 'user'` (fixed invariant —
   * a derived view of `role`, not an independent second source of truth; the
   * W3 store scan derives it from the role and must never set it on its own).
   */
  readonly isUser: boolean;
  /** Total text length of the node's message content, in characters. */
  readonly textLength: number;
  /**
   * Assistant nodes: provider-issued ids of the tool calls embedded in the
   * message content ('tool-call' blocks). Empty array = no tool calls.
   */
  readonly toolCallIds?: readonly string[];
  /** Tool nodes: id of the assistant tool call this result answers. */
  readonly answersCallId?: string;
  /** message.source?.kind when present — identifies fold checkpoints. */
  readonly sourceKind?: string;
}
/**
 * Ledger record of one committed fold, rebuilt from session log scans (W3).
 * Zero independent storage: the session log is the only durable state
 * (plan §2 方案甲 6).
 */
interface FoldRecord {
  /** Stable fold identifier (also carried by the checkpoint message source). */
  readonly foldId: string;
  /** Original span start seq (pre-fold surface coords). */
  readonly startSeq: number;
  /** Original span end seq (inclusive). */
  readonly endSeq: number;
  /** Seq of the checkpoint node that replaced the span on the surface. */
  readonly checkpointSeq: number;
  /** Summary text carried by the checkpoint message. */
  readonly summaryText: string;
  /** Surface node seqs shadowed by the checkpoint (= sourceEventSeqs). */
  readonly shadowedSeqs: readonly number[];
  /** Estimated window tokens before the fold. */
  readonly tokensBefore: number;
  /** Estimated window tokens after the fold. */
  readonly tokensAfter: number;
}
/** Active folds keyed by foldId. */
type FoldMap = ReadonlyMap<string, FoldRecord>;
/** Complete budget report for one context window (CCM v2.3 §1.2 formulas). */
interface Budget {
  /** Context window size W the budget was computed for. */
  readonly contextWindow: number;
  /** Output hard cap C applied (explicit or the default tier). */
  readonly maxOutputCap: number;
  /** maxTokens = min(C, floor(W×0.10)). */
  readonly maxTokens: number;
  /** reserve = ceil(maxTokens×1.25) + 4096. */
  readonly reserve: number;
  /** toolCap = max(1024, floor(0.25×(reserve−maxTokens))). */
  readonly toolCap: number;
  /** R_pess = maxTokens + BATCH_CAP(2)×toolCap + 4096. */
  readonly pessimisticReserve: number;
  /** triggerLine = W − R_pess (the single trigger oracle). */
  readonly triggerLine: number;
  /** keepRecent = min(max(⌊0.12W⌋, min(20000, ⌊0.30W⌋)), ⌊0.8×triggerLine⌋). */
  readonly keepRecent: number;
  /** summaryInputCap = triggerLine − keepRecent. */
  readonly summaryInputCap: number;
  /** summaryOutputCap = min(C, maxTokens, ⌊0.8×reserve⌋, max(8192, ⌊0.01W⌋)). */
  readonly summaryOutputCap: number;
  /** replyCap = max(2048, toolCap formula floor(0.25×(reserve−maxTokens))). */
  readonly replyCap: number;
  /** Fixed wire overhead: 4 tool schemas + guidance section (S1 accounting). */
  readonly fixedWireOverhead: number;
  /** rMin = 1 − (maxTokens + 2×toolCap)/W (theoretical steady-state hit floor). */
  readonly rMin: number;
}
/** One fold of a validated batch: one summary block over one subrange. */
interface FoldPlanEntry {
  /** Subrange start seq covered by this summary (inside the fold window). */
  readonly startSeq: number;
  /** Subrange end seq (inclusive). */
  readonly endSeq: number;
  /** Summary text for the subrange. */
  readonly summaryText: string;
  /** Estimated tokens of the summary text. */
  readonly summaryTokens: number;
  /** Estimated tokens reclaimed by this subrange (nodes − summary). */
  readonly reclaimedTokens: number;
  /** Active folds absorbed (checkpoint inside the window) by this entry. */
  readonly absorbedFoldIds: readonly string[];
}
/** Validator acceptance plan (atomic — produced only when every check passed). */
interface FoldPlan {
  /** One entry per summary block of the validated fold window. */
  readonly folds: readonly FoldPlanEntry[];
  /** Whole-window net reclaim: Σ(range node estimates) − Σ(summary estimates). */
  readonly reclaimedTokens: number;
}
/** Validator result: rejected with all reasons, or accepted with the plan. */
type FoldValidationResult = {
  readonly ok: false;
  readonly reasons: readonly string[];
} | {
  readonly ok: true;
  readonly plan: FoldPlan;
};
/** One summary block submitted with a fold window. */
interface FoldSummaryInput {
  /** Subrange start seq (must sit inside the fold window). */
  readonly startSeq: number;
  /** Subrange end seq (inclusive). */
  readonly endSeq: number;
  /** Summary text for the subrange. */
  readonly text: string;
}
/** Validator-facing configuration slice (resolved values; plan §3 statics). */
interface ValidatorConfig {
  /** Resolved recent-tail protection in messages (from budget.keepRecent policy). */
  readonly keepRecentMessages: number;
  /** Resolved recent-tail protection in tokens (0 = rule off). */
  readonly keepRecentTokens: number;
  /** Extra floor of tokens always kept outside folds (plan §3). */
  readonly protectionFloorTokens: number;
  /** Minimum foldable window in estimated tokens (qualification line). */
  readonly minFoldableTokens: number;
  /** Upper bound on the window fraction of one fold (requires contextWindow). */
  readonly maxFoldFraction: number;
  /** Shortest acceptable summary in characters. */
  readonly summaryFloorChars: number;
  /** Longest acceptable summary in characters. */
  readonly summaryCeilingChars: number;
  /** Net-shrink multiplier gate (default 1.05). */
  readonly netShrinkTolerance: number;
  /** Context window size; enables the maxFoldFraction check when present. */
  readonly contextWindow?: number;
}
/** Complete validator input (task card W2 §2). */
interface ValidateFoldInput {
  /** Currently active folds (rebuilt ledger). */
  readonly foldMap: FoldMap;
  /** Ordered surface nodes (as on the current surface). */
  readonly surfaceNodes: readonly SurfaceNode[];
  /** The single fold window to validate (official replace span). */
  readonly range: {
    readonly startSeq: number;
    readonly endSeq: number;
  };
  /** Summary blocks submitted for the window (each covers a subrange). */
  readonly summaries: readonly FoldSummaryInput[];
  readonly config: ValidatorConfig;
}
/** Materialized text block — official TextBlock shape (llm/src/types.ts:62-65). */
interface MaterializeBlock {
  readonly type: 'text';
  readonly text: string;
}
/** Read accessor over the session log used by materialize.ts. */
interface MaterializeAccessor {
  /** Immutable event at one exact seq, or undefined. */
  eventAt(seq: number): SessionEventLike | undefined;
}
/** One searchable corpus entry for recall. */
interface RecallEntry {
  /** Owning fold id. */
  readonly foldId: string;
  /** 'summary' = checkpoint summary text; 'original' = folded-away original. */
  readonly kind: 'summary' | 'original';
  /** Searchable text. */
  readonly text: string;
  /** Source span of the entry (summary: the original span; original: same). */
  readonly range: {
    readonly startSeq: number;
    readonly endSeq: number;
  };
}
/** One recall hit: corpus entry + score + context excerpt. */
interface RecallHit {
  readonly foldId: string;
  readonly kind: 'summary' | 'original';
  readonly text: string;
  readonly range: {
    readonly startSeq: number;
    readonly endSeq: number;
  };
  /** Hit score (higher = better; deterministic tie-breaking applies). */
  readonly score: number;
  /** ±120-char context around the first hit. */
  readonly excerpt: string;
}
/** One foldable-span row rendered by the nudge. */
interface NudgeRange {
  readonly startSeq: number;
  readonly endSeq: number;
  readonly estimatedTokens: number;
  /** True when the span must not be folded (protected tail / pinned user). */
  readonly protected: boolean;
  /** Why the span is protected (rendered after the PROTECTED marker). */
  readonly protectedReason?: string;
}
/** Nudge voice bands. */
type NudgeVoice = 'gentle' | 'emergency';
/**
 * Token amount with a measured/estimated marker (S6): measured = read from
 * assistant/message usage (cacheReadTokens/cacheWriteTokens); estimated =
 * chars/3 fallback, reported degraded by zctx_status.
 */
interface BreakevenAmount {
  readonly tokens: number;
  readonly measured: boolean;
}
/** Price factors of the breakeven model (VERIFY-C #15 defaults). */
interface BreakevenPrice {
  /** Cache write price factor (default 1.0). */
  readonly w: number;
  /** Cache read price factor (default 0.1). */
  readonly r: number;
  /** Fresh-token price factor (default 4.0). */
  readonly q: number;
}
/** Breakeven input: S (folded away), σ (summary), T (first-request repay). */
interface BreakevenInput {
  /** S — tokens removed from the window by the fold. */
  readonly folded: BreakevenAmount;
  /** σ — tokens of the summary block. */
  readonly summary: BreakevenAmount;
  /** T — cache re-pay tokens of the first request after the fold. */
  readonly repay: BreakevenAmount;
  /** Price factors; defaults w=1.0, r=0.1, q=4.0 (VERIFY-C #15). */
  readonly price?: Partial<BreakevenPrice>;
}
/** Breakeven report (VERIFY-C #15 formulas; units are price-weighted tokens). */
interface BreakevenReport {
  /** (w−r)·T + q·σ − r·S. */
  readonly oneTimeCost: number;
  /** (S−σ)·r — steady per-turn saving. */
  readonly perTurnSaving: number;
  /** Turns until the fold pays off (max(0, oneTimeCost)/perTurnSaving). */
  readonly breakevenTurns: number;
  /** S−σ — net window tokens removed. */
  readonly netTokens: number;
  /** True when every input was measured (not estimated). */
  readonly measured: boolean;
  /** Which inputs are estimated: subset of ['folded','summary','repay']. */
  readonly estimatedInputs: readonly ('folded' | 'summary' | 'repay')[];
}
/**
 * One provider usage sample taken from an assistant/message event (S6).
 * Moved here from store.ts in V1 so {@link UsageRecord} can extend it without
 * a types→store cycle; store.ts re-exports it, keeping the W3 public surface
 * (index.ts `export type { UsageSample } from './store.ts'`) unchanged.
 */
interface UsageSample {
  /** Seq of the assistant/message event. */
  readonly seq: number;
  /** True when the event carried a usable usage object. */
  readonly measured: boolean;
  /** Optional provider cache-read tokens. */
  readonly cacheReadTokens?: number;
  /** Optional provider cache-write tokens. */
  readonly cacheWriteTokens?: number;
}
/**
 * Structural view of the call config carried by a logged request header
 * (official LlmCallConfig, llm/llm/src/call-config.ts:36-41 — provider/model
 * plus the LlmCallControls scalars of :27-32). `reasoningEffort` is
 * duck-typed as string (the official type is a branded string id).
 */
interface LlmCallConfigLike {
  readonly provider: string;
  readonly model: string;
  readonly reasoningEffort?: string;
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly stop?: readonly string[];
}
/**
 * Effective config fields supplied by exact-model adapter resolution
 * (official LlmCallConfigAdapterDefaults, call-config.ts:55-60).
 */
interface LlmCallConfigAdapterDefaultsLike {
  readonly reasoningEffort?: true;
  readonly maxTokens?: true;
}
/**
 * One logged request/header snapshot, cached by the store (RES-observe-route
 * a.1 row 3: config/adapterDefaults/tools/reason/startsSeries/seq). Official
 * payload shape: session/src/types.ts:388-395 (`EpochHeader` at :270-281,
 * `RequestHeaderReason` at :381-387).
 */
interface RouteHeader {
  /** The header's call config (provider/model/effort/sampling scalars). */
  readonly config: LlmCallConfigLike;
  /** Effective config fields materialized from the exact adapter. */
  readonly adapterDefaults?: LlmCallConfigAdapterDefaultsLike;
  /** Assembled tool schemas; absent for a tool-less request. */
  readonly tools?: readonly unknown[];
  /** Why the snapshot was appended (official request/header reason). */
  readonly reason: 'initial' | 'resume' | 'change' | 'series';
  /** This request begins a distinct model-message series, independently of reason. */
  readonly startsSeries?: true;
  /** Log seq of the producing request/header event. */
  readonly seq: number;
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
type ResetEventKind =
/** Provider/model/reasoningEffort changed (request/header reason 'change'). */
'model-change' |
/** temperature/maxTokens/stop changed (request/header reason 'change'). */
'sampling-change' |
/** Tool schemas changed (request/header tools diff vs the previous header). */
'toolset-change' |
/** Official compaction bracket opened (compaction/start … compaction/end). */
'compaction' |
/** Our own fold/unfold checkpoint replaced a surface span. */
'merge-rewrite' |
/** A foreign single tool/result node was rewritten in place (pruner shape). */
'micro-prune' |
/** Any other foreign replace producer (unattributable, Q6 unresolved ①). */
'unknown-replace' |
/** A system/message node was rewritten on the surface (normalization). */
'system-section-change' |
/** Session generation boundary (session/end-seed; sessionRecovery half-class). */
'session-recovery' |
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
'series-restart';
/** One cache-reset ledger entry (RES-observe-route a.1 row 4: kind/seq/time/evidence). */
interface ResetEvent {
  /** The identified reset class. */
  readonly kind: ResetEventKind;
  /** Log seq of the event that produced the reset. */
  readonly seq: number;
  /** Unix epoch ms of the producing event, when the event carried a time. */
  readonly time?: number;
  /** Human-readable evidence (which fields differed / which nodes were replaced). */
  readonly evidence: string;
}
/**
 * Attribution of one usage sample to one committed fold (RES-observe-route
 * a.1 row 2, §Q4.2 rules). Produced by the V3 attribution engine; the V1
 * store freezes the shape only.
 */
interface FoldUsageAttribution {
  /** FoldRecord.foldId of the attributed fold. */
  readonly foldId: string;
  /** Seq of the fold's checkpoint (surfaceOp replace) event. */
  readonly foldCommitSeq: number;
  /** Seq of the attributed assistant/message event. */
  readonly messageSeq: number;
  /** Turn of the attributed message. */
  readonly turn: number;
  /** Step of the attributed message. */
  readonly step: number;
  /** Association strength (§Q4.2: strong = clean; retry = retried; weak = degraded to estimate). */
  readonly quality: 'strong' | 'retry' | 'weak';
  /** llm/retry events counted between fold commit and the attributed message. */
  readonly retryCount: number;
  /** The attributed assistant/message was an interrupted prefix (§Q4.3 noise 7). */
  readonly interrupted?: true;
  /**
   * §Q4.2 rule 4 time-window fallback marker (V3): the seq chain between the
   * fold commit and the attributed message was BROKEN (store resync gap —
   * retained events do not cover the whole span), so the association degraded
   * to `T_M − T_F ≤ attributionTimeWindowMs 且同 turn`. Such associations are
   * honesty-capped at quality 'weak' (purity is unverifiable on a broken
   * chain) and therefore never enter the fold account (总账 only).
   */
  readonly timeWindow?: true;
}
/** Three-state accounting grade of a usage record (§Q7.2). */
type UsageRecordState = 'measured' | 'semi' | 'estimated';
/**
 * Which semi path graded a usage record (V3; RES-observe-route §Q7.2 rule 2).
 * `interpolated` = usage absent but a same-turn later measured sample exists
 * with no route/system-section reset in between → input-side fields carried
 * over from that anchor sample. `meterAnchored` = usage absent but the
 * official tokenMeter (injected through {@link MeterAnchorLike}) projected
 * the request's input side → inputTokens carries that anchor; cache fields
 * stay ABSENT (the meter cannot know provider cache state — 缺席不反推).
 */
type UsageRecordSemiKind = 'interpolated' | 'meterAnchored';
/**
 * One request's three-state usage ledger entry (RES-observe-route a.1 row 1:
 * UsageSample + inputTokens/outputTokens/totalTokens/state/attribution).
 * `state: 'semi'` is filled by the V3 paths ({@link UsageRecordSemiKind});
 * the V1 store emits only 'measured' (usage object present) and 'estimated'
 * (absent — absence is never reverse-inferred into cache support, §Q2.3).
 * `attribution` is filled by the V3 attribution engine.
 */
interface UsageRecord extends UsageSample {
  /** Un-cached input tokens (official TokenUsage disjoint accounting, llm/src/types.ts:167-173). */
  readonly inputTokens?: number;
  /** Output tokens. */
  readonly outputTokens?: number;
  /** Total tokens, when the provider reported one. */
  readonly totalTokens?: number;
  /** The three-state grade of this record. */
  readonly state: UsageRecordState;
  /** Which semi path graded this record; present exactly when state is 'semi'. */
  readonly semiKind?: UsageRecordSemiKind;
  /** Fold attribution, when the V3 engine bound this sample to a fold. */
  readonly attribution?: FoldUsageAttribution;
}
/** Three-state sample counts (§Q7.2 grades). */
interface ThreeStateCounts {
  readonly measured: number;
  readonly semi: number;
  readonly estimated: number;
}
/** One fold's row of the repay table (§Q7.3 回本表). */
interface BreakevenTableRow {
  /** The attributed fold. */
  readonly foldId: string;
  /** Turns until the fold pays off (breakeven model output). */
  readonly breakevenTurns: number;
  /** Attribution quality of the row's best sample. */
  readonly quality: 'strong' | 'retry' | 'weak';
  /**
   * V3 repay-event detection (§Q7.3, price-weighted domain): true when the
   * session has run at least max(1, ⌈breakevenTurns⌉) assistant/messages after
   * the fold commit — the first such message is the repay event. Absent from
   * a row means the detection input was unavailable (treated as not repaid).
   */
  readonly repaid?: boolean;
  /** Seq of the repay-event assistant/message; present exactly when repaid is true. */
  readonly repayEventSeq?: number;
}
/** The reset-ledger digest row: one kind with its entry count. */
interface ResetSummaryRow {
  readonly kind: ResetEventKind;
  readonly count: number;
}
/**
 * Aggregated observability view consumed by zctx_status (RES-observe-route
 * a.1 row 6: threeState 计数 / 纯净样本占比 / 回本表 / 重置台账摘要).
 * Built by the V3 aggregation; the V1 store freezes the shape only.
 */
interface ObservabilitySnapshot {
  /** Sample counts per three-state grade. */
  readonly threeState: ThreeStateCounts;
  /** Clean-sample ratio in [0,1] (§Q4.3 noise剔除后纯净占比; honest-degradation threshold input). */
  readonly cleanSampleRatio: number;
  /** One row per attributed fold (repay table). */
  readonly breakevenTable: readonly BreakevenTableRow[];
  /** Reset ledger digest, one row per observed kind (order: first-seen). */
  readonly resetSummary: readonly ResetSummaryRow[];
}
/**
 * Which request-projection implementation produced a snapshot's hashes.
 * Domain-field discipline: the two variants do NOT normalize identically
 * (the local fallback cannot replicate the official file/image/tool-update
 * projections exactly), so every snapshot names its own projector and the
 * ledger never mixes them silently.
 */
type SnapshotProjector = 'official' | 'local-fallback';
/**
 * One llm/stream request snapshot (RES-observe-route a.1 row 5:
 * perMessageHashes/systemHash/toolsHash/attemptSeq/purpose/isLoop, plus the
 * honest-domain fields the card requires). Built by the V2 observe listener
 * for every MAIN-CHAIN request (four criteria, Q8.1) and handed to the store
 * through the injected snapshot sink.
 */
interface RequestSnapshot {
  /** Session id the request was bound to (matched against the watched set, criterion 3). */
  readonly sessionId: string;
  /** Per-session monotonic ordinal, gap-free (only snapshotted requests increment). */
  readonly attemptSeq: number;
  /** Request route (audit face; route changes are reset-ledger territory, not breaks). */
  readonly provider: string;
  readonly model: string;
  /** Per-message stable hashes (stableStringify key-sorted + sha256) of the normalized message list. */
  readonly perMessageHashes: readonly string[];
  /** Stable hash of `options.system` when present (one-shot requests only; undefined on the loop chain). */
  readonly systemHash?: string;
  /** Stable hash of `options.tools` when present. */
  readonly toolsHash?: string;
  /** Official one-shot purpose marker; always undefined on snapshotted (main-chain) requests. */
  readonly purpose?: 'compaction' | 'session-title';
  /** Criterion-1 verdict (true for every snapshotted request; recorded for audit). */
  readonly isLoop: boolean;
  /** Which projection implementation normalized the hashes. */
  readonly projector: SnapshotProjector;
  /** Unix epoch ms of the snapshot. */
  readonly time: number;
}
/** Reference to one reset-ledger entry that explains a prefix break. */
interface PrefixBreakResetRef {
  readonly kind: ResetEventKind;
  readonly seq: number;
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
interface PrefixBreakRecord {
  /** Always 'harness' — object-level hashes cover the harness domain only. */
  readonly domain: 'harness';
  /** Session id the snapshots belong to. */
  readonly sessionId: string;
  /** attemptSeq of the snapshot that broke the prefix. */
  readonly attemptSeq: number;
  /** attemptSeq of the previous snapshot (undefined when the store had no baseline). */
  readonly prevAttemptSeq?: number;
  /** First differing message index inside the common prefix; undefined = pure tail shrink. */
  readonly breakIndex?: number;
  /** How the break manifested. */
  readonly mode: 'length-shrink' | 'content-change';
  /**
   * Break classification (card: 关联 ResetEvent 分类或 unknown-break):
   * 'reset-explained' when the listener consumed reset-ledger entries between
   * the two snapshots, 'unknown-break' otherwise (runtime-context refresh and
   * other unlogged object churn, §Q4.3 noise 6).
   */
  readonly classification: 'reset-explained' | 'unknown-break';
  /** The explaining reset entries (present exactly when classification is 'reset-explained'). */
  readonly explainedBy?: readonly PrefixBreakResetRef[];
  /** Unix epoch ms of the newer snapshot. */
  readonly time: number;
}
/**
 * One FAILED attempt's usage captured by the optional `observe.attemptCapture`
 * face (RES-observe-route §Q8.2 item 2: session logs keep no per-attempt
 * usage for retried-away attempts — the llm/stream listener wrapping `next()`
 * is the only capture position, and the record dies with the process).
 */
interface CapturedAttemptUsage {
  /** Session id the request was bound to. */
  readonly sessionId: string;
  /** The snapshot's attemptSeq (0 when the exempt window consumed the request without a snapshot). */
  readonly attemptSeq: number;
  /** Request route. */
  readonly provider: string;
  readonly model: string;
  /** The usage chunk observed before the terminal error/abort. */
  readonly usage: {
    readonly inputTokens?: number;
    readonly outputTokens?: number;
    readonly totalTokens?: number;
    readonly cacheReadTokens?: number;
    readonly cacheWriteTokens?: number;
  };
  /** How the stream terminated (official FinishReason kinds, llm/src/types.ts:156-163). */
  readonly outcome: 'error' | 'aborted';
  /** Always true — this record never reaches the session log and is lost on exit. */
  readonly nonDurable: true;
  /** Unix epoch ms of the capture. */
  readonly time: number;
}
/**
 * Injected meter-anchor interface for the V3 `meterAnchored` semi path
 * (RES-observe-route §Q7.2 rule 2b: usage absent but the official tokenMeter
 * is injectable → its surface projection anchors the request's input side;
 * the card freezes that this path goes through INJECTION, never a host
 * import inside the pure core). Implemented by the plugin over the official
 * TokenMeasurement surface nodes (token-meter/src/types.ts:31-56).
 */
interface MeterAnchorLike {
  /**
   * Input-side token anchor for the request that produced the message at
   * `seq`: the summed token price of the surface nodes positioned before the
   * message's own node, per the meter's route-priced projection. Undefined
   * when the meter cannot see the message's node (surface moved on, meter
   * unavailable) — the record then stays honestly 'estimated'.
   */
  inputAnchor(seq: number): number | undefined;
}
/** Structural fold-ledger view the aggregation consumes (store-shaped). */
interface AttributionFoldEntry {
  readonly foldId: string;
  readonly checkpointSeq: number;
  readonly tokensBefore: number;
  readonly tokensAfter: number;
}
/** Input of {@link buildObservabilitySnapshot} (the store's ledger views). */
interface SnapshotAggregationInput {
  /** The bounded usage-record ledger (oldest first, three-state graded). */
  readonly usageRecords: readonly UsageRecord[];
  /** Lifetime three-state counters (attach-scoped, cap-independent). */
  readonly threeState: ThreeStateCounts;
  /** Fold-ledger entries (any status; attribution decides fold-account membership). */
  readonly foldEntries: readonly AttributionFoldEntry[];
  /** The fold-attribution ledger (foldId → association), any quality. */
  readonly foldAttributions: readonly FoldUsageAttribution[];
  /** The cache-reset ledger (digest input). */
  readonly resetEvents: readonly ResetEvent[];
  /** Assistant/message seqs ascending (repay-event detection input). */
  readonly assistantMessageSeqs: readonly number[];
}
/** Input of {@link classifyFoldAttribution} — one F→M association attempt. */
interface ClassifyAttributionInput {
  /** The fold's id (FoldRecord.foldId). */
  readonly foldId: string;
  /** Seq of the fold commit (surfaceOp replace) event. */
  readonly foldSeq: number;
  /** Commit time of the fold event, when the event carried one. */
  readonly foldTime?: number;
  /**
   * The turn open at the fold commit (nearest turn/start at-or-before the
   * fold seq), when the log carries turn markers. Undefined when unknown —
   * the same-turn check then relies on window boundary events only.
   */
  readonly foldTurn?: number;
  /** Seq of the candidate attribution target (assistant/message). */
  readonly messageSeq: number;
  /** Commit time of the message event, when the event carried one. */
  readonly messageTime?: number;
  /** The message's `data.turn` (official assistant/message envelope). */
  readonly messageTurn?: number;
  /** The message's `data.step` (official assistant/message envelope). */
  readonly messageStep?: number;
  /** The message's `data.interrupted === true` (§Q4.3 noise 7). */
  readonly messageInterrupted?: boolean;
  /**
   * Retained events STRICTLY between foldSeq and messageSeq, ascending. The
   * engine derives chain completeness itself: the seqs must exactly cover
   * [foldSeq + 1, messageSeq − 1] — any missing seq is a resync gap and
   * triggers the time-window fallback.
   */
  readonly windowEvents: readonly SessionEventLike[];
  /** Config attributionTimeWindowMs (the fallback window; never hardcoded). */
  readonly timeWindowMs: number;
}
/**
 * Classify ONE fold→message association (§Q4.2 rules 2-4; the module JSDoc
 * carries the 8-noise disposition table). Returns undefined when the
 * association fails: the message lacks its official turn/step envelope, or
 * the broken-chain fallback (time window + same turn) does not pass.
 */
declare function classifyFoldAttribution(input: ClassifyAttributionInput): FoldUsageAttribution | undefined;
/** Billed input of one usage record (§Q7.2 rule 1: input + read + write). */
declare function billedInputTokens(record: UsageRecord): number | undefined;
/**
 * Clean-sample ratio (§Q7.3): strong / (strong + retry + weak) over the fold
 * attribution ledger; 0 when no fold was ever attributed (no evidence = no
 * confidence).
 */
declare function cleanSampleRatio(foldAttributions: readonly FoldUsageAttribution[]): number;
/**
 * Aggregate the observability snapshot (RES-observe-route a.1 row 6) from the
 * store's ledger views. Pure: no store/host access. The fold account
 * (breakevenTable) admits only folds whose attribution quality is
 * strong/retry — weak associations stay in the total ledger (§Q4.2 rule 3).
 */
declare function buildObservabilitySnapshot(input: SnapshotAggregationInput): ObservabilitySnapshot;
/**
 * Estimate the token cost of a text with the CCM L0 chars/3 estimator. It is
 * a conservative ceiling only within the estimator's calibrated ASCII-dense
 * domain; it is NOT a universal wire bound — scripts denser than ASCII (e.g.
 * CJK) cost more tokens per character than the 3-chars-per-token ratio
 * assumes, so their true wire cost can exceed this estimate.
 */
declare function estimateTokens(text: string): number;
/**
 * Compute the full budget report for one context window.
 *
 * @param input - `contextWindow` W (integer ≥ 1, and large enough to sustain
 *   the CCM reserve structure: windows below the degeneracy line — W = 0 or
 *   triggerLine < 0 — throw TypeError) and optional output cap C (finite
 *   integer ≥ 0; defaults to the CCM default tier 32768).
 */
declare function computeBudget(input: {
  contextWindow: number;
  maxOutput?: number;
}): Budget;
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
declare function computeBreakevenReport(input: BreakevenInput): BreakevenReport;
/**
 * Materialize the ordered text blocks for the fold span [startSeq..endSeq]
 * (inclusive on both ends) with one-layer expansion of active fold
 * checkpoints.
 */
declare function materializeRange(accessor: MaterializeAccessor, foldMap: FoldMap, startSeq: number, endSeq: number): MaterializeBlock[];
/**
 * Recall the corpus entries matching the query keywords.
 *
 * @param query - whitespace-separated keywords (case-insensitive).
 * @param corpus - summaries + folded original entries.
 * @param limit - maximum hits returned (default 5).
 */
declare function recall(query: string, corpus: readonly RecallEntry[], limit?: number): RecallHit[];
/**
 * Thresholds crossed on the way from `prev` to `cur` (strict rise: a
 * threshold counts only when prev < threshold ≤ cur — sitting exactly on a
 * threshold is not a crossing). Returned ascending, deduplicated; a falling
 * pressure crosses nothing.
 */
declare function crossedThresholds(prev: number, cur: number, thresholds: readonly number[]): number[];
/**
 * Registration-ready context text: '' (suppressed) when nothing was crossed,
 * otherwise the full nudge rendering. Voice escalates to 'emergency' when
 * any crossed threshold is ≥ 90 or the current pressure itself is ≥ 90.
 */
declare function nudgeContextText(prev: number, cur: number, thresholds: readonly number[], budget: Budget, ranges: readonly NudgeRange[]): string;
/**
 * Render the nudge text for one pressure reading. Deterministic: identical
 * inputs produce byte-identical output (asserted by nudge.spec.ts).
 *
 * @param pressurePct - current window occupancy in percent (0..100+).
 * @param budget - the budget report driving the breakdown percentages.
 * @param ranges - foldable-span rows (PROTECTED rows render with their reason).
 * @param voice - gentle | emergency band.
 */
declare function renderNudge(pressurePct: number, budget: Budget, ranges: readonly NudgeRange[], voice: NudgeVoice): string;
/**
 * Static guidance section registration data (options.md §2 方案甲 2, plan §3
 * S10). The text itself lives in texts.ts (single home of model-facing text;
 * original writing — clean-room, zero copied prompt text).
 *
 * Hard constraints (S10):
 * - byte-stable: no timestamps, counters, or any dynamic content;
 * - the section spec NEVER sets `complete: true` — an effective complete
 *   section replaces the whole assembled system prompt
 *   (official system-prompt/src/index.ts:59-78, 649-653);
 * - the section is static text, so it lands in the cached prompt prefix once
 *   and stays put (the cache-accounted fixed wire overhead, S1).
 *
 * Zero host imports; pure data.
 *
 * @module guidance
 */
/**
 * Structural mirror of the official PromptSection registration input
 * (system-prompt/src/index.ts:474-481 area). `complete` is deliberately
 * ABSENT: the type forbids carrying it, and `buildGuidanceSection` never
 * emits the key — `guidance.spec.ts` asserts both (S10).
 */
interface GuidanceSectionSpec {
  /** Unique section name (duplicate registration throws in the host). */
  readonly name: string;
  /** Ascending concatenation order (official PromptSection.order). */
  readonly order: number;
  /** Static byte-stable guidance text (S10). */
  readonly text: string;
  /**
   * Literal text preservation: the guidance contains no `{{variable}}`
   * references, so interpolation stays off — a stray brace pair can never
   * corrupt the rendered prompt.
   */
  readonly interpolate: false;
}
/**
 * Build the frozen guidance section spec (same bytes on every call — S10).
 */
declare function buildGuidanceSection(): GuidanceSectionSpec;
/**
 * Validate one fold window with its summaries (see module header for the
 * check list). Throws TypeError on structurally malformed input; returns
 * `{ ok:false, reasons }` (all reasons collected) on any semantic failure.
 */
declare function validateFold(input: ValidateFoldInput): FoldValidationResult;
/** Status of one fold ledger entry. */
type FoldLedgerStatus = 'active' | 'unfolded' | 'absorbed' | 'dead';
/** One committed fold, as tracked by the store ledger. */
interface FoldLedgerEntry extends FoldRecord {
  /** Lifecycle status derived from later log events. */
  readonly status: FoldLedgerStatus;
  /** For absorbed/dead entries: seq of the replace event that shadowed the checkpoint. */
  readonly shadowedBySeq?: number;
  /** For absorbed/dead entries: the producing source kind that shadowed the checkpoint. */
  readonly shadowedByKind?: string;
}
/** Aggregate usage state of the session (S6; consumed by zctx_status). */
interface UsageSnapshot {
  /** Samples kept in the bounded ledger. */
  readonly samples: number;
  /** Total measured samples seen over the session lifetime. */
  readonly measuredSamples: number;
  /** Total assistant/message events observed without a usable usage object. */
  readonly unmeasuredSamples: number;
  /** True when at least one measured sample exists (latest-sample semantics drive status). */
  readonly measured: boolean;
  /** The most recent sample, when any. */
  readonly latest?: UsageSample;
}
/** One anomaly recorded by the engine or the store (honest ledger, no throwing). */
interface StoreAnomaly {
  /** Related seq, when the anomaly maps to one event. */
  readonly seq?: number;
  /** Stable anomaly kind, e.g. 'unreadable-event'. */
  readonly kind: string;
  /** Human-readable detail. */
  readonly detail: string;
}
/**
 * Session-log-derived state for ONE session: fold ledger, usage ledger,
 * retained events, surface view, and compaction mutex state.
 *
 * Lifecycle: `attach(session)` scans once and binds; afterwards the host feed
 * delivers events via `onEvent(session, event)`; `resync()` repairs feed gaps.
 * Events of a different session are ignored (the store is single-session).
 */
declare class FoldStore {
  private session;
  private readonly eventsBySeq;
  private readonly ledger;
  /** Bounded usage-record ledger (V1 UsageRecord; oldest dropped at cap). */
  private readonly usageLedger;
  private measuredSamples;
  private unmeasuredSamples;
  /** Append-only request/header chain (oldest first). */
  private readonly routeHeaders;
  /** Append-only cache-reset ledger (oldest first). */
  private readonly resetLog;
  /** Bounded process-memory snapshot ledger (V2 receive port; never session-logged). */
  private readonly snapshotLog;
  /** Bounded process-memory prefix-break ledger (V2 receive port; never session-logged). */
  private readonly breakLog;
  /** Bounded non-durable captured-attempt-usage ledger (V2 receive port; never session-logged). */
  private readonly captureLog;
  private readonly anomaliesLog;
  /** Fold-attribution ledger: foldId → its first-post-fold association (any quality). */
  private readonly foldAttributionLog;
  /** Ascending seqs of every consumed event (window binary-search index). */
  private readonly eventSeqList;
  /** Ascending seqs of assistant/message events (repay-event detection input). */
  private readonly assistantMessageSeqs;
  /** Parallel arrays of turn/start markers (seqs + the turn they opened). */
  private readonly turnStartSeqs;
  private readonly turnStartTurns;
  /** Seq of the previous assistant/message (attribution candidate boundary). */
  private lastAssistantMessageSeq;
  /** Lifetime three-state counters (attach-scoped; cap-independent, §Q7.3). */
  private threeState;
  /** Injected meter anchor for the `meterAnchored` semi path (§Q7.2 rule 2b). */
  private meterAnchor;
  /** Config attributionTimeWindowMs (§Q4.2 rule 4 fallback; config-owned value). */
  private attributionTimeWindowMs;
  private compactionStartSeq;
  private endSeedSeq;
  private lastSeq;
  /** The bound session, when attached. */
  get boundSession(): SessionLike | undefined;
  /** Highest seq the store has consumed (lastSeq + 1 == next expected). */
  get syncedToSeq(): number;
  /**
   * Bind to one session and rebuild all state from a full scan (the blessed
   * resume restore). Resets every per-session view first.
   */
  attach(session: SessionLike): void;
  /**
   * Repair any feed gap: replay events from the store's frontier up to the
   * session's current end with bounded seq reads. No-op when in sync.
   */
  resync(): void;
  /**
   * Consume one host-delivered event (the injected `session/event` callback).
   * Events from a foreign session are ignored; a gap triggers a bounded delta
   * repair first.
   */
  onEvent(session: SessionLike, event: SessionEventLike): void;
  /** Active folds keyed by foldId — the validator-facing FoldMap view. */
  get foldMap(): FoldMap;
  /** Full ledger including non-active entries (status display / audit). */
  ledgerEntries(): readonly FoldLedgerEntry[];
  /** The retained immutable event at one seq, or undefined. */
  retainedEvent(seq: number): SessionEventLike | undefined;
  /** The joined text of the retained event at one seq ('' when unreadable). */
  eventText(seq: number): string;
  /**
   * Ordered SurfaceNode view of the CURRENT surface. The live
   * `session.surface.nodes` is authoritative when present; otherwise the
   * surface is replayed locally from the retained log (structural mocks).
   */
  surfaceNodes(): SurfaceNode[];
  /** Surface node seqs whose event is not retained (fail-closed fold guard). */
  unreadableSurfaceSeqs(): number[];
  /** Aggregate usage state (S6). */
  usageSnapshot(): UsageSnapshot;
  /** The request/header chain, oldest first (V1 observability). */
  routeHeaderChain(): readonly RouteHeader[];
  /** The most recent cached header, when any (the compare base for 'change'). */
  lastRouteHeader(): RouteHeader | undefined;
  /** The cache-reset ledger, oldest first (V1 observability). */
  resetEvents(): readonly ResetEvent[];
  /** The in-process snapshot ledger, oldest first (bounded; oldest dropped). */
  requestSnapshots(): readonly RequestSnapshot[];
  /** The most recent request snapshot, when any (the listener's comparison baseline). */
  lastRequestSnapshot(): RequestSnapshot | undefined;
  /** The harness-domain prefix-break ledger, oldest first (bounded; oldest dropped). */
  prefixBreakEvents(): readonly PrefixBreakRecord[];
  /** The non-durable captured-attempt-usage ledger, oldest first (bounded; oldest dropped). */
  capturedAttemptUsage(): readonly CapturedAttemptUsage[];
  /**
   * Snapshot sink: append one request snapshot to the process-memory ledger
   * and, when the listener detected a prefix break against the previous
   * snapshot, the classified break record next to it. The listener computes
   * the break (the hash件 lives in observe.ts); the store only receives.
   */
  absorbRequestSnapshot(snapshot: RequestSnapshot, breakRecord?: PrefixBreakRecord): void;
  /**
   * Non-durable capture sink: append one failed attempt's observed usage
   * (observe.attemptCapture face). The record dies with the process by
   * design; the ledger is only bounded memory.
   */
  absorbCapturedAttemptUsage(record: CapturedAttemptUsage): void;
  /** The bounded usage-record ledger, oldest first (V1 observability). */
  usageRecords(): readonly UsageRecord[];
  /**
   * Inject the meter anchor for the `meterAnchored` semi path (§Q7.2 rule 2b:
   * THROUGH INJECTION — the store never imports the host). Called once at
   * store creation by the plugin; `undefined` keeps every usage-less request
   * honestly 'estimated'.
   */
  setMeterAnchor(anchor: MeterAnchorLike | undefined): void;
  /**
   * Set the attribution time-window fallback from config
   * (attributionTimeWindowMs; never hardcoded — plan §3 threshold discipline).
   */
  setAttributionTimeWindowMs(ms: number): void;
  /** The fold-attribution ledger (foldId → association), commit order. */
  foldAttributions(): readonly FoldUsageAttribution[];
  /**
   * The aggregated observability snapshot for zctx_status (a.1 row 6): pure
   * aggregation over the store's ledger views (attribution.ts
   * buildObservabilitySnapshot). On-demand — status is user-invoked.
   */
  observabilitySnapshot(): ObservabilitySnapshot;
  /** True while a `compaction/start` bracket is durably open (mutex). */
  compactionActive(): boolean;
  /** Record one anomaly in the bounded ledger (honest, never throws). */
  recordAnomaly(kind: string, detail: string, seq?: number): void;
  /** The anomaly ledger, oldest first. */
  anomalies(): readonly StoreAnomaly[];
  /** Replay retained events up to `end` (exclusive) through seq reads. @internal */
  private scanUpTo;
  /**
   * Apply one event to every derived view (scan and incremental paths share
   * this single transition, so attach scans, live feeds, and resync gaps
   * stay consistent by construction).
   * @internal
   */
  private applyEvent;
  /**
   * Consume one request/header event: cache the RouteHeader, then classify
   * resets — `reason:'resume'` is the sessionRecovery half-class signal
   * (RES-observe-route §Q6: restart/fork-seed boundary); `reason:'change'`
   * field-compares against the previous header (a.2 item 1). @internal
   */
  private applyRequestHeader;
  /**
   * Classify ONE replace event into the reset ledger (card: surfaceOp
   * replace → microPrune / unknown-replace / mergeRewrite / systemSectionChange).
   * Order: our own checkpoints first (merge-rewrite regardless of any open
   * compaction bracket), then replaces inside an open official compaction
   * bracket are skipped (the compaction start already recorded the reset —
   * card qualifier 非 compaction 括号内), then system/message rewrites, then
   * the single-tool-result pruner shape, then the unknown-replace catch-all
   * (surfaceOp carries no producer identity, RES-observe-route §Q6 unresolved ①).
   * @internal
   */
  private classifyReplaceReset;
  /**
   * Append one reset ledger entry (evidence text is caller-owned). V1-B
   * closure: bounded ledger (oldest dropped). The observe listener's
   * exemption window consumes resets by SEQ pointer, so the shift never
   * mis-aligns it (store-observe spec pins 66→64).
   * @internal
   */
  private recordReset;
  /** Demote active folds whose checkpoint is shadowed by this replace. @internal */
  private shadowActiveCheckpoints;
  /**
   * One assistant/message: build the usage record, grade the semi paths, fill
   * the fold attribution (nearest preceding fold commit), then maintain the
   * lifetime three-state counters and the interpolated retro-upgrade.
   * Runs inside the shared applyEvent transition — attach scan, live feed,
   * and resync rebuilds all attribute identically by construction.
   * @internal
   */
  private applyAssistantMessage;
  /**
   * Attribute one assistant/message against every fold commit since the
   * previous assistant/message (§Q4.2: F's target = the FIRST M after F —
   * folds before the previous message were already given their first M; later
   * steps after this message are 维持账, noise ③). The nearest candidate's
   * association binds the record (batch folds: the last commit before M is
   * the clean window; earlier commits carry another replace in theirs and
   * grade weak on their own associations).
   * @internal
   */
  private attributeMessage;
  /** Fail-soft meter-anchor probe: a meter fault degrades to estimated. @internal */
  private tryMeterAnchor;
  /**
   * The `interpolated` semi path (§Q7.2 rule 2a): a measured anchor arrived;
   * usage-less estimated records EARLIER in the same turn — with no reset
   * entry between them and the anchor (conservative superset of "no
   * route/system-section change") — carry the anchor's input-side fields over
   * (absent stays absent, §Q2.3). Walking backwards stops at the first
   * measured record (its own arrival already upgraded what it could), a turn
   * change, an unknown turn, or a reset entry.
   * @internal
   */
  private upgradeInterpolatedBefore;
  /** First index in eventSeqList whose seq is strictly above `seq`. @internal */
  private firstIndexAbove;
  /** Retained events strictly between `from` and `to`, ascending. @internal */
  private windowEventsBetween;
  /** The turn open at `seq` (nearest turn/start at-or-before), when logged. @internal */
  private turnOpenAt;
  /** The `data.turn` of the retained event at one seq, when well-formed. @internal */
  private messageTurnAt;
  /** True when a reset-ledger entry sits strictly between the two seqs. @internal */
  private resetBetween;
  /** Local surface replay from the retained log (fallback when no live surface). @internal */
  private replaySurfaceNodes;
  /** Build one SurfaceNode from a retained event. @internal */
  private toSurfaceNode;
}
/** CCM §1.1 legal-domain floor: windows below this reject automatic folding. */
declare const CCM_MIN_CONTEXT_WINDOW = 32768;
/** Result of the engine-layer CCM window gate. */
interface CcmWindowGate {
  /** True when the window is in the CCM legal domain (or cannot be judged). */
  readonly legal: boolean;
  /** Degraded-mode note when the window is below the legal domain. */
  readonly note?: string;
}
/**
 * Engine-layer CCM §1.1 gate. An unknown window cannot be judged (no claim);
 * a window below 32768 is out of the legal domain: the automatic folding face
 * is disabled while tools remain available. This is a POLICY layer above the
 * budget F1 structural degeneracy guard (W below the reserve structure); the
 * two layers are not interchangeable.
 */
declare function ccmWindowGate(contextWindow: number | undefined): CcmWindowGate;
/**
 * Structural surface intent passed to a writable session's append (mirror of
 * the official SurfaceIntent subset the plugin commits through; the official
 * sourceEventSeqs is a mutable SessionSeq[], kept mutable here so the real
 * generic Session stays structurally assignable).
 */
interface FoldSurfaceIntent {
  readonly surfaceOp: 'append' | {
    readonly op: 'replace';
    readonly startSeq: number;
    readonly endSeq: number;
  };
  readonly sourceEventSeqs?: number[];
}
/**
 * Structural writable session consumed by the engine: the SessionLike read
 * contract plus the append channel. Method syntax keeps the official generic
 * `Session` class structurally assignable (method bivariance).
 */
interface FoldSessionLike extends SessionLike {
  append(type: string, data: unknown, opts?: FoldSurfaceIntent): Pick<SessionEventLike, 'seq' | 'type' | 'data'>;
}
/** One submitted fold request: the window plus its summary blocks. */
interface FoldSubmission {
  /** The fold window (the hull of the submitted summary subranges). */
  readonly range: {
    readonly startSeq: number;
    readonly endSeq: number;
  };
  /** Summary blocks submitted for the window (each covers a subrange). */
  readonly summaries: readonly {
    readonly startSeq: number;
    readonly endSeq: number;
    readonly text: string;
  }[];
}
/** One committed checkpoint, echoed for tool replies and tests. */
interface CommittedFold {
  readonly foldId: string;
  readonly checkpointSeq: number;
  readonly startSeq: number;
  readonly endSeq: number;
  readonly shadowedSeqs: readonly number[];
  readonly tokensBefore: number;
  readonly tokensAfter: number;
  /** Unfold commits only: number of re-materialized text blocks. */
  readonly blocks?: number;
}
/** Engine anomaly kinds (recorded in the store's anomaly ledger). */
interface EngineAnomaly {
  readonly kind: 'generation-mismatch' | 'node-missing' | 'append-rejected';
  readonly detail: string;
  readonly seq?: number;
}
/** Engine result: rejected with all reasons, or committed with honest anomalies. */
type FoldCommitResult = {
  readonly ok: false;
  readonly reasons: readonly string[];
  readonly committed: readonly CommittedFold[];
  readonly anomalies: readonly EngineAnomaly[];
} | {
  readonly ok: true;
  readonly plan?: FoldPlan;
  readonly committed: readonly CommittedFold[];
  readonly anomalies: readonly EngineAnomaly[];
};
/**
 * Commit one fold submission (see module header). Throws TypeError only on
 * structurally malformed input (programmer error); every semantic failure —
 * validation rejection, active compaction, session append rejection — comes
 * back as a `{ ok: false, reasons }` result, and post-commit anomalies are
 * reported, not thrown.
 */
declare function fold(sessionLike: FoldSessionLike, store: FoldStore, submission: FoldSubmission, config: ValidatorConfig): FoldCommitResult;
/**
 * Unfold one active fold (B1 single-node form): the checkpoint node is
 * replaced by ONE user message carrying the re-materialized text blocks of
 * the original span. Same fail-soft discipline as `fold`.
 */
declare function unfold(sessionLike: FoldSessionLike, store: FoldStore, foldId: string): FoldCommitResult;
/**
 * Compute the foldable-span rows over the current surface: maximal runs of
 * consecutive surface nodes, split at every protected node. Protected nodes
 * mirror the validator's protected zones exactly — surface node 0, the pinned
 * first user message, the latest user message, and the recent tail
 * (last keepRecentMessages messages and the last
 * max(keepRecentTokens, protectionFloorTokens) tokens).
 */
declare function foldableRanges(surfaceNodes: readonly SurfaceNode[], config: ValidatorConfig): NudgeRange[];
/** Render the fold result as the zctx_fold tool reply (fail-soft wording). */
declare function renderFoldReply(result: FoldCommitResult): string;
/** Render the unfold result as the zctx_unfold tool reply (fail-soft wording). */
declare function renderUnfoldReply(foldId: string | undefined, result: FoldCommitResult): string;
/** One parameter of the author prop-map (official ParamSpec subset). */
interface ParamSpec {
  readonly type: 'string' | 'number' | 'boolean';
  readonly required?: boolean;
  readonly description?: string;
}
/** Structural defineTool options the four tools are authored with. */
interface ZctxToolSpec {
  readonly name: string;
  readonly description: string;
  readonly parameters: Readonly<Record<string, ParamSpec>>;
  /** All four tools return a model-facing string (official { type: 'string' }). */
  execute(args: Record<string, unknown>, exec: ToolRunContextLike): Promise<string> | string;
}
/** Registry-ready definition (structural mirror of the official ToolDefinition subset). */
interface ZctxToolDefinition {
  readonly name: string;
  readonly description: string;
  /** Compiled JSON-Schema subset (official ParameterJsonSchema shape). */
  readonly parameters: {
    readonly type: 'object';
    readonly properties: Readonly<Record<string, Record<string, unknown>>>;
    readonly required?: readonly string[];
  };
  readonly output: {
    readonly schema: {
      readonly type: 'string';
    };
    readonly render: (args: unknown, value: string) => readonly {
      readonly type: 'text';
      readonly text: string;
    }[];
  };
  readonly execute: (args: unknown, exec: ToolRunContextLike) => Promise<string>;
}
/** defineTool-compatible factory the tool builder consumes. */
type DefineToolFn = (spec: {
  readonly name: string;
  readonly description: string;
  readonly parameters: Readonly<Record<string, ParamSpec>>;
  readonly output: {
    readonly schema: {
      readonly type: 'string';
    };
    readonly render: (args: unknown, value: string) => readonly {
      readonly type: 'text';
      readonly text: string;
    }[];
  };
  readonly execute: (args: Record<string, unknown>, exec: ToolRunContextLike) => Promise<string>;
}) => ZctxToolDefinition;
/** Resolve defineTool: the host implementation when present, shim otherwise. */
declare function resolveDefineTool(): DefineToolFn;
type ParsedFoldContent = {
  readonly ok: true;
  readonly range: {
    readonly startSeq: number;
    readonly endSeq: number;
  };
  readonly summaries: readonly {
    readonly startSeq: number;
    readonly endSeq: number;
    readonly text: string;
  }[];
} | {
  readonly ok: false;
  readonly reason: string;
};
/**
 * Lenient parse of the zctx_fold `content` argument. Accepts (in order):
 * a JSON-encoded array of `{startId|startRef, endId|endRef, summary}`
 * objects (gateways that stringify arrays), a single top-level range object,
 * and the plain text-block form — each block a `fold <start>..<end> [topic]`
 * header line followed by its markdown summary. Returns the window hull plus
 * the per-block summaries, or a diagnostic reason (honest zero-range
 * reporting, no silent guess).
 */
declare function parseFoldContent(content: unknown): ParsedFoldContent;
/** Structural logger subset used by the tools/plugin. */
interface LoggerLike {
  info?(message: string): void;
  warn?(message: string): void;
  error?(message: string): void;
}
/** Structural tokenMeter subset used by the status/nudge faces. */
interface TokenMeterLike {
  measure(session: SessionLike): {
    readonly totalTokens: number;
    /**
     * Official TokenMeasurement surface nodes pass-through (additive, V3;
     * token-meter/src/types.ts:31-56): the route-priced per-node projection
     * the meter-anchor interface sums for the `meterAnchored` semi path.
     * Undefined when the host meter predates the node projection — the
     * anchor then honestly reports unavailability.
     */
    readonly nodes?: readonly {
      readonly seq: number;
      readonly tokens: number;
    }[];
  };
}
/** Structural llm runtime subset used by the status/window resolution. */
interface LlmRuntimeLike {
  resolveModelInfo(provider: string, model: string, signal?: AbortSignal): Promise<{
    context?: {
      contextWindow?: number;
    };
    defaultMaxTokens?: number;
    /**
     * Official ModelInfo pass-through (llm/src/index.ts:180) consumed by the
     * observe listener's projection gating (v0.2.0 V2); undefined = unknown
     * modalities → image projection honestly skipped.
     */
    inputModalities?: readonly string[];
    /** Official ModelInfo pass-through (llm/src/index.ts:184); undefined = unsupported route. */
    toolUpdate?: 'in-history' | 'addition-only';
  }>;
}
/** Everything the four tools (and the /zctx command) need from the host. */
interface ZctxToolRuntime {
  readonly logger?: LoggerLike;
  readonly tokenMeter?: TokenMeterLike;
  readonly llm?: LlmRuntimeLike;
  /**
   * Config cleanSampleFloor (V3 status gate, §Q7.3 诚实纪律): the renderer
   * withholds repay conclusions when the clean-sample ratio falls below it.
   * Config-owned value — never hardcoded here.
   */
  readonly cleanSampleFloor: number;
  /** Per-session store registry (lazy create + attach, feed-maintained). */
  storeFor(session: SessionLike): FoldStore;
  /** Validator config resolved for this session (window from cache when known). */
  validatorConfig(session: SessionLike): ValidatorConfig;
}
/**
 * Render the full status report. Every host face is capability-probed and
 * degraded rows are collected honestly (S6: cache accounting carries the
 * measured/estimated split; CCM §1.1: windows below 32768 render the
 * below-domain note with tools still usable).
 */
declare function renderStatus(runtime: ZctxToolRuntime, session: SessionLike): Promise<string>;
/**
 * Build the four registry-ready zctx tool definitions through the given
 * defineTool implementation (host's official one, or the fail-soft shim).
 */
declare function buildZctxTools(defineTool: DefineToolFn, runtime: ZctxToolRuntime): ZctxToolDefinition[];
/** Nudge context registration metadata (official PromptContext subset). */
declare const NUDGE_CONTEXT_NAME = "zctx-nudge";
/** Nudge context join order (after core layers, before the guidance section). */
declare const NUDGE_CONTEXT_ORDER = 800;
/**
 * Structural host context handed over by the cordis container. Every member
 * is optional: consumers capability-probe and degrade (plan §4).
 */
interface HostContextLike {
  readonly logger?: LoggerLike;
  readonly tools?: {
    register?(definition: unknown): unknown;
  };
  readonly systemPrompt?: {
    section?(spec: unknown): unknown;
    context?(spec: unknown): unknown;
  };
  readonly commands?: {
    register?(definition: unknown): unknown;
  };
  readonly tokenMeter?: TokenMeterLike;
  readonly llm?: LlmRuntimeLike;
  /** Cordis reflection (present on real contexts; probed by the Service base). */
  readonly reflect?: {
    provide?(name: string, value: unknown): unknown;
  };
  /** Cordis event subscription; returns a disposer on real contexts. */
  on?(event: string, listener: (...args: never[]) => unknown): unknown;
}
/** Instance surface the Service base guarantees. */
interface ServiceInstance {
  ctx: unknown;
  name: string;
}
/** Constructor surface of the cordis Service base (structural). */
type ServiceCtor = new (ctx: HostContextLike, name: string) => ServiceInstance;
/** The Service base this plugin extends: the host's real one when resolvable. */
declare const ServiceBase: ServiceCtor;
/** Parse "25,50,75,90" into ascending threshold numbers (invalid entries dropped). */
declare function parseThresholds(spec: string): number[];
/**
 * The dsh-zcontext plugin (cordis class plugin, constructed with
 * `(ctx, config)`; config validated through the static Config schema).
 */
declare class ZcontextPlugin extends ServiceBase {
  static inject: string[];
  static Config: ConfigSchemaLike;
  /** Host context (structural duck-type; capability-probed per face). */
  readonly ctx: HostContextLike;
  /** Resolved plugin configuration (plan §3 contract). */
  readonly config: Readonly<ZcontextConfig>;
  private readonly stores;
  private readonly windowCache;
  private readonly lastPressure;
  private readonly liveSessions;
  private readonly runtime;
  /** The observe face's listener; undefined when the face is off (config or capability). */
  private observe;
  private warnedWindowFailure;
  constructor(ctx: HostContextLike, config?: Partial<ZcontextConfig>);
  /** session/event feed: maintain live stores + warm the window cache. @internal */
  private wireSessionFeed;
  /** The four zctx tools (defineTool-wrapped; S8: no isConcurrencySafe). @internal */
  private wireToolFace;
  /** The static byte-stable guidance section (S10: never sets complete). @internal */
  private wireGuidanceFace;
  /** The threshold nudge context with required: true (B2). @internal */
  private wireNudgeFace;
  /** The /zctx command. @internal */
  private wireCommandFace;
  /**
   * The llm/stream observe face (v0.2.0 V2): a strictly read-only waterfall
   * listener whose per-attempt request snapshots + prefix-break records land
   * in the per-session store's process-memory ledgers (the store's
   * absorbRequestSnapshot / absorbCapturedAttemptUsage receive ports).
   *
   * Same capability-probe discipline as the five faces above: a deliberate
   * config switch logs info, a missing capability logs warn, and neither
   * ever breaks boot. The face needs BOTH the event bus (the registration
   * surface — official hosts register via `ctx.on('llm/stream', …)`, see the
   * llm Events declaration at llm/src/index.ts:76-78) AND the llm runtime
   * (the waterfall owner: without it no `llm/stream` event ever fires).
   * @internal
   */
  private wireObserveFace;
  /**
   * The observe listener's watched-session resolution (criterion 3): a
   * session ID maps to its live session object when the plugin saw the
   * session through the feed (official Session carries `id: SessionId`,
   * core/session/src/index.ts:420, and the agent loop fills
   * GenerateOptions.sessionId from it — agent-loop/src/agent.ts:718).
   * Unseen/disposed IDs resolve undefined → not watched.
   * @internal
   */
  private resolveWatchedSession;
  /** Per-session store registry: lazy create + attach (resume-restore scan). @internal */
  private storeFor;
  /**
   * The V3 meter-anchor interface over the official tokenMeter (§Q7.2 rule
   * 2b): for the request that produced the message at `seq`, the input-side
   * anchor is the summed route-priced tokens of the surface nodes positioned
   * BEFORE the message's own node (official TokenMeasurement.nodes,
   * token-meter/src/types.ts:31-56). Unavailable faces (no meter, no node
   * projection, node not on the current surface, non-positive sum, meter
   * fault) report undefined so the record stays honestly 'estimated'.
   * @internal
   */
  private meterAnchorFor;
  /** Validator config for one session (context window from the cache when known). @internal */
  private validatorConfig;
  /**
   * Resolve and cache the routed model's context window (fire-and-forget;
   * failures degrade honestly — one warn per plugin, never per request).
   */
  private warmWindow;
  /** The most recently created live session. @internal */
  private currentSession;
  /**
   * The nudge context provider: '' unless a threshold was crossed since the
   * last evaluation (pure function of its inputs; suppressed = no-op on the
   * wire, B2). Below the CCM legal domain the automatic face stays off.
   *
   * Session attribution (W4-4): when the official AssembleContext carries a
   * session (`assembleContextFor` passes the Agent as both `agent` and
   * `scope`, and `Agent.session` is the session — agent-loop/src/agent.ts:127),
   * the evaluation is attributed to THAT session, so multi-session hosts get
   * per-session pressure instead of cross-assembly contamination. The
   * globally-most-recent-session fallback remains for hosts that invoke the
   * provider without a reachable context — a documented limitation there, not
   * a correctness claim.
   */
  private nudgeProvider;
}
/** Structural CommandResult subset (commands/src/types.ts:34-41). */
type ZctxCommandResult = {
  readonly kind: 'success';
  readonly text?: string;
  readonly sourceEventSeq?: number;
} | {
  readonly kind: 'error';
  readonly text: string;
};
/** Structural CommandDefinition subset (commands/src/index.ts:61-78). */
interface ZctxCommandDefinition {
  readonly name: string;
  readonly description: string;
  readonly handler: (invocation: {
    readonly agent?: {
      readonly session?: SessionLike;
    };
    readonly rawInput: string;
    readonly signal?: AbortSignal;
  }) => ZctxCommandResult | Promise<ZctxCommandResult>;
}
/** Build the /zctx command definition against the given runtime. */
declare function buildZctxCommand(runtime: ZctxToolRuntime): ZctxCommandDefinition;
/**
 * dsh-zcontext — model-driven incremental context folding for the DeepSeek
 * Harness (official surface replace channel).
 *
 * Public surface: the frozen identity exports (name / plugin class / Config
 * schema), the W2 pure cores, the W3 engine, and the W4 wiring (tools /
 * plugin / command). Host-face types are structural (duck-typed): neither
 * `@deepseek-ai/cordis` nor `@deepseek-ai/schemastery` is imported
 * statically — both resolve lazily with fail-soft fallbacks, so this module
 * always loads.
 *
 * @module dsh-zcontext
 */
/** Plugin identity exported for loader probes. */
declare const name = "dsh-zcontext";
export { type AttributionFoldEntry, type BreakevenTableRow, CCM_MIN_CONTEXT_WINDOW, type CapturedAttemptUsage, type CcmWindowGate, type ClassifyAttributionInput, type CommittedFold, type ConfigSchemaLike, type DefineToolFn, type EngineAnomaly, type FoldCommitResult, type FoldLedgerEntry, type FoldLedgerStatus, type FoldSessionLike, FoldStore, type FoldSubmission, type FoldSurfaceIntent, type FoldUsageAttribution, type HostContextLike, type LlmCallConfigAdapterDefaultsLike, type LlmCallConfigLike, type LlmRuntimeLike, type LoggerLike, type MeterAnchorLike, NUDGE_CONTEXT_NAME, NUDGE_CONTEXT_ORDER, type ObservabilitySnapshot, type ParamSpec, type PrefixBreakRecord, type PrefixBreakResetRef, type RequestSnapshot, type ResetEvent, type ResetEventKind, type ResetSummaryRow, type RouteHeader, type SnapshotAggregationInput, type SnapshotProjector, type StoreAnomaly, type ThreeStateCounts, type TokenMeterLike, type UsageRecord, type UsageRecordSemiKind, type UsageRecordState, type UsageSample, type UsageSnapshot, type ZcontextConfig, ZcontextPlugin, ZcontextPlugin as default, type ZctxCommandDefinition, type ZctxCommandResult, type ZctxToolDefinition, type ZctxToolRuntime, type ZctxToolSpec, billedInputTokens, buildGuidanceSection, buildObservabilitySnapshot, buildZctxCommand, buildZctxTools, ccmWindowGate, classifyFoldAttribution, cleanSampleRatio, computeBreakevenReport, computeBudget, configDefaults, configSchema, crossedThresholds, estimateTokens, fold, foldableRanges, materializeRange, name, nudgeContextText, parseFoldContent, parseThresholds, recall, renderFoldReply, renderNudge, renderStatus, renderUnfoldReply, resolveDefineTool, unfold, validateFold };
//# sourceMappingURL=index.d.ts.map