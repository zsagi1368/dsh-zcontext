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

// ---------------------------------------------------------------------------
// Identity (loader probe contract, Z7).
// ---------------------------------------------------------------------------

/** Plugin identity exported for loader probes. */
export const name = 'dsh-zcontext'

// ---------------------------------------------------------------------------
// Configuration (plan §3; frozen contract, W1).
// ---------------------------------------------------------------------------

export { configDefaults, configSchema } from './config.ts'
export type { ConfigSchemaLike, ZcontextConfig } from './config.ts'

// ---------------------------------------------------------------------------
// W2 pure cores.
// ---------------------------------------------------------------------------

export {
  billedInputTokens,
  buildObservabilitySnapshot,
  classifyFoldAttribution,
  cleanSampleRatio,
} from './attribution.ts'
export type {
  AttributionFoldEntry,
  ClassifyAttributionInput,
  SnapshotAggregationInput,
} from './attribution.ts'
export { computeBudget, computeBreakevenReport, estimateTokens } from './budget.ts'
export { materializeRange } from './materialize.ts'
export { recall } from './search.ts'
export { crossedThresholds, nudgeContextText, renderNudge } from './nudge.ts'
export { buildGuidanceSection } from './guidance.ts'
export { validateFold } from './validator.ts'

// ---------------------------------------------------------------------------
// W3 engine.
// ---------------------------------------------------------------------------

export { FoldStore } from './store.ts'
export type {
  FoldLedgerEntry,
  FoldLedgerStatus,
  StoreAnomaly,
  UsageSample,
  UsageSnapshot,
} from './store.ts'
export type {
  BreakevenTableRow,
  CapturedAttemptUsage,
  FoldUsageAttribution,
  LlmCallConfigAdapterDefaultsLike,
  LlmCallConfigLike,
  ObservabilitySnapshot,
  PrefixBreakRecord,
  PrefixBreakResetRef,
  RequestSnapshot,
  ResetEvent,
  ResetEventKind,
  ResetSummaryRow,
  RouteHeader,
  SnapshotProjector,
  ThreeStateCounts,
  UsageRecord,
  UsageRecordSemiKind,
  UsageRecordState,
  MeterAnchorLike,
} from './types.ts'
export {
  CCM_MIN_CONTEXT_WINDOW,
  ccmWindowGate,
  fold,
  foldableRanges,
  renderFoldReply,
  renderUnfoldReply,
  unfold,
} from './fold-engine.ts'
export type {
  CcmWindowGate,
  CommittedFold,
  EngineAnomaly,
  FoldSessionLike,
  FoldSubmission,
  FoldCommitResult,
  FoldSurfaceIntent,
} from './fold-engine.ts'

// ---------------------------------------------------------------------------
// W4 wiring.
// ---------------------------------------------------------------------------

export { ZcontextPlugin, NUDGE_CONTEXT_NAME, NUDGE_CONTEXT_ORDER, parseThresholds } from './plugin.ts'
export type { HostContextLike } from './plugin.ts'
export { buildZctxTools, parseFoldContent, resolveDefineTool, renderStatus } from './tools.ts'
export type {
  DefineToolFn,
  LoggerLike,
  LlmRuntimeLike,
  ParamSpec,
  TokenMeterLike,
  ZctxToolDefinition,
  ZctxToolRuntime,
  ZctxToolSpec,
} from './tools.ts'
export { buildZctxCommand } from './command.ts'
export type { ZctxCommandDefinition, ZctxCommandResult } from './command.ts'

// Default export = the plugin class (loader contract).
export { ZcontextPlugin as default } from './plugin.ts'
