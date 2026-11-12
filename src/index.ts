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

import { createRequire } from 'node:module'

/** Frozen plugin configuration contract (plan §3; every field is primitive). */
export interface ZcontextConfig {
  /** Master switch; when false the plugin stays passive (official compaction remains the hard floor). */
  enabled: boolean
  /** Comma-separated context-occupancy percentages that trigger a nudge. */
  nudgeThresholds: string
  /** Verbatim recent-tail token budget; 0 = automatic. */
  keepRecentTokens: number
  /** Upper bound on the fraction of the context window a single fold may cover. */
  maxFoldFraction: number
  /** Minimum foldable span in tokens below which folding is refused. */
  minFoldableTokens: number
  /** Tokens kept outside any fold window (system head, protected tail). */
  protectionFloorTokens: number
  /** Shortest acceptable summary text length in characters. */
  summaryFloorChars: number
  /** Longest acceptable summary text length in characters. */
  summaryCeilingChars: number
  /** Multiplier gate: a fold must shrink the ledger by at least 1/netShrinkTolerance. */
  netShrinkTolerance: number
}

/** Primitive field kinds supported by the Config schema. */
type PrimitiveKind = 'boolean' | 'number' | 'string'

interface ConfigFieldSpec {
  readonly type: PrimitiveKind
  readonly default: boolean | number | string
}

/** Contractual defaults for every Config field (plan §3). */
export const configDefaults: Readonly<ZcontextConfig> = Object.freeze<ZcontextConfig>({
  enabled: true,
  nudgeThresholds: '25,50,75,90',
  keepRecentTokens: 0,
  maxFoldFraction: 0.6,
  minFoldableTokens: 5000,
  protectionFloorTokens: 5000,
  summaryFloorChars: 50,
  summaryCeilingChars: 20000,
  netShrinkTolerance: 1.05,
})

/**
 * Field-type table driving both the schemastery schema and the fail-soft
 * validator. `satisfies` pins it to the `ZcontextConfig` key set: adding or
 * removing a config field without updating this table fails to compile.
 */
const CONFIG_FIELD_SPECS = {
  enabled: { type: 'boolean', default: configDefaults.enabled },
  nudgeThresholds: { type: 'string', default: configDefaults.nudgeThresholds },
  keepRecentTokens: { type: 'number', default: configDefaults.keepRecentTokens },
  maxFoldFraction: { type: 'number', default: configDefaults.maxFoldFraction },
  minFoldableTokens: { type: 'number', default: configDefaults.minFoldableTokens },
  protectionFloorTokens: { type: 'number', default: configDefaults.protectionFloorTokens },
  summaryFloorChars: { type: 'number', default: configDefaults.summaryFloorChars },
  summaryCeilingChars: { type: 'number', default: configDefaults.summaryCeilingChars },
  netShrinkTolerance: { type: 'number', default: configDefaults.netShrinkTolerance },
} as const satisfies { readonly [K in keyof ZcontextConfig]: ConfigFieldSpec }

/** `~standard.validate` issue shape (StandardSchemaV1 subset). */
interface StandardValidateIssue {
  readonly message: string
}

/** `~standard.validate` result shape (StandardSchemaV1 subset). */
interface StandardValidateResult {
  readonly value?: unknown
  readonly issues?: readonly StandardValidateIssue[]
}

/** `~standard` props the cordis registry reads off a plugin Config. */
interface StandardSchemaProps {
  readonly version: 1
  readonly vendor: string
  validate(value: unknown): StandardValidateResult | Promise<StandardValidateResult>
}

/** Structural shape required of the plugin `Config` (StandardSchemaV1 subset). */
export interface ConfigSchemaLike {
  readonly '~standard': StandardSchemaProps
}

/** Minimal structural surface of a schemastery schema node used here. */
interface SchemasteryNode {
  default(value: unknown): SchemasteryNode
  readonly '~standard': StandardSchemaProps
}

/** Minimal structural surface of the schemastery default export used here. */
interface SchemasteryStatic {
  boolean(): SchemasteryNode
  number(): SchemasteryNode
  string(): SchemasteryNode
  object(fields: Record<string, SchemasteryNode>): SchemasteryNode
}

const nodeRequire = createRequire(import.meta.url)

/**
 * Resolve the host's schemastery if present; `undefined` keeps module loading
 * fail-soft (the fallback validator below takes over).
 */
function loadSchemastery(): SchemasteryStatic | undefined {
  try {
    return nodeRequire('@deepseek-ai/schemastery') as SchemasteryStatic
  } catch {
    return undefined
  }
}

/** Vendor tag for the fail-soft validator (distinguishes it from real schemastery). */
const FAIL_SOFT_VENDOR = 'dsh-zcontext/fail-soft'

/** Build a minimal standard-schema validator applying plan §3 defaults. */
function createFailSoftConfigSchema(): ConfigSchemaLike {
  const validate = (input: unknown): StandardValidateResult => {
    const source = (input !== null && typeof input === 'object' ? input : {}) as Record<
      string,
      unknown
    >
    const output: Record<string, unknown> = {}
    for (const [key, spec] of Object.entries(CONFIG_FIELD_SPECS)) {
      const raw = source[key]
      if (raw === undefined || raw === null) {
        output[key] = spec.default
        continue
      }
      const matches =
        spec.type === 'boolean'
          ? typeof raw === 'boolean'
          : spec.type === 'number'
            ? typeof raw === 'number' && Number.isFinite(raw)
            : typeof raw === 'string'
      if (!matches) {
        return { issues: [{ message: `config.${key}: expected ${spec.type}` }] }
      }
      output[key] = raw
    }
    return { value: output }
  }
  return { '~standard': { version: 1, vendor: FAIL_SOFT_VENDOR, validate } }
}

/** Build the Config schema against the real schemastery when resolvable. */
function buildConfigSchemaWith(z: SchemasteryStatic): ConfigSchemaLike {
  const fields: Record<string, SchemasteryNode> = {}
  for (const [key, spec] of Object.entries(CONFIG_FIELD_SPECS)) {
    const node =
      spec.type === 'boolean' ? z.boolean() : spec.type === 'number' ? z.number() : z.string()
    fields[key] = node.default(spec.default)
  }
  return z.object(fields)
}

/** Plugin Config schema: schemastery-backed when available, fail-soft shim otherwise. */
export const configSchema: ConfigSchemaLike = (() => {
  const z = loadSchemastery()
  return z === undefined ? createFailSoftConfigSchema() : buildConfigSchemaWith(z)
})()

/** Plugin identity exported for loader probes. */
export const name = 'dsh-zcontext'

// ---------------------------------------------------------------------------
// W3 engine exports (store + fold orchestrator).
// ---------------------------------------------------------------------------

export { FoldStore } from './store.ts'
export type {
  FoldLedgerEntry,
  FoldLedgerStatus,
  StoreAnomaly,
  UsageSample,
  UsageSnapshot,
} from './store.ts'
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

/**
 * W1 minimal plugin class.
 *
 * - `inject` stays empty until W3/W4 wire session/tools services.
 * - `Config` is the frozen plan §3 schema (full primitive fields).
 * - The constructor only stores the host context and the incoming config
 *   with plan §3 defaults applied for absent fields (W3 adds the engine).
 */
export class ZcontextPlugin {
  static inject: string[] = []
  static Config = configSchema

  /** Host context (structural duck-type; typed concretely in W3/W4). */
  readonly ctx: object

  /** Resolved plugin configuration (plan §3 contract). */
  readonly config: Readonly<ZcontextConfig>

  constructor(ctx: object, config: Partial<ZcontextConfig> = {}) {
    this.ctx = ctx
    this.config = Object.freeze<ZcontextConfig>({ ...configDefaults, ...config })
  }
}

export default ZcontextPlugin
