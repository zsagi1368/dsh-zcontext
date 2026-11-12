/**
 * dsh-zcontext — model-driven incremental context folding for the DeepSeek
 * Harness (official surface replace channel).
 *
 * W1 minimal skeleton: identity exports, the plugin class with static
 * `inject` / `Config`, and a constructor that stores the resolved config.
 * No folding logic lives here yet (W2-W4 waves).
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
export { ConfigSchemaLike, ZcontextConfig, ZcontextPlugin, ZcontextPlugin as default, configDefaults, configSchema, name };
//# sourceMappingURL=index.d.ts.map