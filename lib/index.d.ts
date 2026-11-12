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
/**
 * dsh-zcontext — model-driven incremental context folding for the DeepSeek
 * Harness (official surface replace channel).
 *
 * Public surface: the frozen identity exports (name / plugin class / Config
 * schema), the W2 pure cores, and the W3 engine (FoldStore + fold/unfold
 * orchestrator). W4 completes the wiring (tools / plugin / command).
 *
 * Host-face types are structural (duck-typed): neither `@deepseek-ai/cordis`
 * nor `@deepseek-ai/schemastery` is imported statically, so the package has
 * no hard runtime dependency on either. Schemastery is resolved lazily at
 * load time and falls back to a minimal built-in validator (fail-soft) when
 * it cannot be resolved, so this module always loads.
 *
 * @module dsh-zcontext
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
/** Plugin identity exported for loader probes. */
declare const name = "dsh-zcontext";
/**
 * W1 minimal plugin class.
 *
 * - `inject` stays empty until W3/W4 wire session/tools services.
 * - `Config` is the frozen plan §3 schema (full primitive fields).
 * - The constructor only stores the host context and the incoming config
 *   with plan §3 defaults applied for absent fields (W3 adds the engine).
 */
declare class ZcontextPlugin {
  static inject: string[];
  static Config: ConfigSchemaLike;
  /** Host context (structural duck-type; typed concretely in W3/W4). */
  readonly ctx: object;
  /** Resolved plugin configuration (plan §3 contract). */
  readonly config: Readonly<ZcontextConfig>;
  constructor(ctx: object, config?: Partial<ZcontextConfig>);
}
export { CCM_MIN_CONTEXT_WINDOW, type CcmWindowGate, type CommittedFold, ConfigSchemaLike, type EngineAnomaly, type FoldCommitResult, type FoldLedgerEntry, type FoldLedgerStatus, type FoldSessionLike, FoldStore, type FoldSubmission, type FoldSurfaceIntent, type StoreAnomaly, type UsageSample, type UsageSnapshot, ZcontextConfig, ZcontextPlugin, ZcontextPlugin as default, ccmWindowGate, configDefaults, configSchema, fold, foldableRanges, name, renderFoldReply, renderUnfoldReply, unfold };
//# sourceMappingURL=index.d.ts.map