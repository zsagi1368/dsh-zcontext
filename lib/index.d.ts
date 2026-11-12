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
/** One event of the session log, structurally reduced for plugin use. */
interface SessionEventLike {
  /** Log sequence number (equal to the event's index in the append-only log). */
  readonly seq: number;
  /** Official event type string, e.g. 'user/message' or 'session/end-seed'. */
  readonly type: string;
  /** Event payload (official: `{ turn, message }` for message events). */
  readonly data: unknown;
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
/** One provider usage sample taken from an assistant/message event (S6). */
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
  private readonly usageSamples;
  private measuredSamples;
  private unmeasuredSamples;
  private readonly anomaliesLog;
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
   * this single transition, so attach and live feeds stay consistent).
   * @internal
   */
  private applyEvent;
  /** Demote active folds whose checkpoint is shadowed by this replace. @internal */
  private shadowActiveCheckpoints;
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
  };
}
/** Structural llm runtime subset used by the status/window resolution. */
interface LlmRuntimeLike {
  resolveModelInfo(provider: string, model: string, signal?: AbortSignal): Promise<{
    context?: {
      contextWindow?: number;
    };
    defaultMaxTokens?: number;
  }>;
}
/** Everything the four tools (and the /zctx command) need from the host. */
interface ZctxToolRuntime {
  readonly logger?: LoggerLike;
  readonly tokenMeter?: TokenMeterLike;
  readonly llm?: LlmRuntimeLike;
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
  /** Per-session store registry: lazy create + attach (resume-restore scan). @internal */
  private storeFor;
  /** Validator config for one session (context window from the cache when known). @internal */
  private validatorConfig;
  /**
   * Resolve and cache the routed model's context window (fire-and-forget;
   * failures degrade honestly — one warn per plugin, never per request).
   */
  private warmWindow;
  /** The most recently created live session (single-session assumption, honest). @internal */
  private currentSession;
  /**
   * The nudge context provider: '' unless a threshold was crossed since the
   * last evaluation (pure function of its inputs; suppressed = no-op on the
   * wire, B2). Below the CCM legal domain the automatic face stays off.
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
export { CCM_MIN_CONTEXT_WINDOW, type CcmWindowGate, type CommittedFold, type ConfigSchemaLike, type DefineToolFn, type EngineAnomaly, type FoldCommitResult, type FoldLedgerEntry, type FoldLedgerStatus, type FoldSessionLike, FoldStore, type FoldSubmission, type FoldSurfaceIntent, type HostContextLike, type LlmRuntimeLike, type LoggerLike, NUDGE_CONTEXT_NAME, NUDGE_CONTEXT_ORDER, type ParamSpec, type StoreAnomaly, type TokenMeterLike, type UsageSample, type UsageSnapshot, type ZcontextConfig, ZcontextPlugin, ZcontextPlugin as default, type ZctxCommandDefinition, type ZctxCommandResult, type ZctxToolDefinition, type ZctxToolRuntime, type ZctxToolSpec, buildGuidanceSection, buildZctxCommand, buildZctxTools, ccmWindowGate, computeBreakevenReport, computeBudget, configDefaults, configSchema, crossedThresholds, estimateTokens, fold, foldableRanges, materializeRange, name, nudgeContextText, parseFoldContent, parseThresholds, recall, renderFoldReply, renderNudge, renderStatus, renderUnfoldReply, resolveDefineTool, unfold, validateFold };
//# sourceMappingURL=index.d.ts.map