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

import { createRequire } from 'node:module'

import type { ZctxProviderConfig } from './adapter/providers.ts'

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
  /**
   * Attribution time-window fallback in ms (V1): when seq reads are
   * interrupted (store resync gap), fold→message association degrades to
   * `messageTime − foldCommitTime ≤ attributionTimeWindowMs` (RES-observe-route
   * §Q4.2 rule 4). Default 90000 — 待真机标定 (calibration pending, plan §3).
   */
  attributionTimeWindowMs: number
  /**
   * Clean-sample floor in [0,1] (V1): below this ratio of cleanly attributed
   * samples zctx_status reports "attribution confidence insufficient" instead
   * of a breakeven conclusion (RES-observe-route §Q7.3 honest degradation).
   * Default 0.6 — 待真机标定 (calibration pending, plan §3).
   */
  cleanSampleFloor: number
  /**
   * Observe face master switch (v0.2.0 V2, task card product 4): registers
   * the read-only `llm/stream` waterfall listener whose per-attempt request
   * snapshots + prefix-break records land in the per-session store's
   * process-memory ledgers (RES-observe-route a.2/a.3). Default true — the
   * face is observation-only and never short-circuits (V4 boundary).
   */
  'observe.enabled': boolean
  /**
   * Per-attempt usage capture (v0.2.0 V2): when true the observe listener
   * wraps `next()` chunk-by-chunk to record FAILED attempts' usage into the
   * NON-DURABLE process-memory ledger (RES-observe-route §Q8.2; never
   * session-logged, CARD-F a.1 进程内不入账). Default false — opt-in.
   */
  'observe.attemptCapture': boolean
  /**
   * S1 preflight mode (v0.2.0 V4, task card product 1; RES-adapter-route
   * §11b S1 + F6.3/F8.3): the llm/stream waterfall listener that estimates
   * the request's context size BEFORE the wire and judges it against the
   * CCM trigger line.
   *
   * - 'off': the face is not registered at all (zero overhead).
   * - 'observe' (DEFAULT): estimates are recorded into the process-memory
   *   calibration ledger (estimate vs the real usage that follows =
   *   estimator error statistics, visible in zctx_status) and the request
   *   always proceeds — 只记台账，不短路.
   * - 'enforce': a hit short-circuits the stream with a synthesized
   *   `finish{kind:'error', failure:{code:'CONTEXT_WINDOW_EXCEEDED'}}`
   *   chunk (official sanctioned short-circuit, llm/src/index.ts:66-70) so
   *   the official compaction overflow recovery chain takes over
   *   (compaction-basic/src/index.ts:194→233).
   *
   * DEFAULT IS OBSERVE, NEVER ENFORCE (plan §2 redline R2): a preflight
   * false positive triggers one unnecessary compaction surface rewrite
   * (F6.4 误报代价), so enforce stays opt-in until the estimator's error
   * distribution has been calibrated on real machines (no-go condition 4).
   */
  preflightMode: 'off' | 'observe' | 'enforce'
  /**
   * Preflight hit margin (v0.2.0 V4): the estimated request context must
   * EXCEED `triggerLine × preflightMarginRatio` to count as a hit, where
   * triggerLine = W − R_pess (budget.ts CCM §1.2). Default 0.9 — the 10%
   * headroom keeps estimator noise from firing the hard line; 估算器误差分布
   * 待真机标定后调整 (calibration pending, plan §3).
   */
  preflightMarginRatio: number
  /**
   * The structured S2 adapter section (v0.2.0 V5, task card product 8; plan
   * §3 structured-settings relaxation, official llm-pi-ai schemastery
   * precedent config.ts:340-361): `providers[]` entries declare the routes
   * the zctx adapters register — family/baseURL/apiKeyEnv/models[].id/
   * contextWindow/maxTokens/reasoningEfforts (wire spelling).
   *
   * The `family` IS the wire protocol name, validated against the OFFICIAL
   * llm-pi-ai `supportedProtocols()` union taken DYNAMICALLY (coordinator
   * A-ruling 2026-11-13: zero invented mapping; route = `zctx-<family>`,
   * redline R5; unknown family = construction-time fail-loud violation).
   *
   * VOLATILE (U1): the Models page only mounts a settings namespace whose
   * Config carries a volatile field (settings describe volatileForm gate) —
   * this section is the volatile anchor that makes the directory rows
   * visible (visibility-only; page editing stays unavailable — U1 SKIP,
   * config authority = the profile overlay patch). Absent section = zero
   * providers = the adapter face registers nothing (legal keep-alive).
   */
  providers?: readonly ZctxProviderConfig[]
}

/** Primitive field kinds supported by the Config schema (plus the S2 providers section). */
type PrimitiveKind = 'boolean' | 'number' | 'string' | 'providers'

interface ConfigFieldSpec {
  readonly type: PrimitiveKind
  readonly default: boolean | number | string | readonly ZctxProviderConfig[]
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
  attributionTimeWindowMs: 90000,
  cleanSampleFloor: 0.6,
  'observe.enabled': true,
  'observe.attemptCapture': false,
  preflightMode: 'observe',
  preflightMarginRatio: 0.9,
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
  attributionTimeWindowMs: { type: 'number', default: configDefaults.attributionTimeWindowMs },
  cleanSampleFloor: { type: 'number', default: configDefaults.cleanSampleFloor },
  'observe.enabled': { type: 'boolean', default: configDefaults['observe.enabled'] },
  'observe.attemptCapture': { type: 'boolean', default: configDefaults['observe.attemptCapture'] },
  preflightMode: { type: 'string', default: configDefaults.preflightMode },
  preflightMarginRatio: { type: 'number', default: configDefaults.preflightMarginRatio },
  // The S2 structured section: schema default = an empty declaration list
  // (zero routes = legal keep-alive). configDefaults omits it (optional).
  providers: { type: 'providers', default: [] as readonly ZctxProviderConfig[] },
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

/** Minimal structural surface of a schemastery schema node used here. */
interface SchemasteryNode {
  default(value: unknown): SchemasteryNode
  /** Marks the field volatile — REQUIRED for the Models page to mount the namespace at all (U1). */
  volatile?(): SchemasteryNode
  readonly '~standard': StandardSchemaProps
}

/** Minimal structural surface of the schemastery default export used here. */
interface SchemasteryStatic {
  boolean(): SchemasteryNode
  number(): SchemasteryNode
  string(): SchemasteryNode
  object(fields: Record<string, SchemasteryNode>): SchemasteryNode
  array(node: SchemasteryNode): SchemasteryNode
  dict(node: SchemasteryNode): SchemasteryNode
  natural(): SchemasteryNode
}

const nodeRequire = createRequire(import.meta.url)

/** Structural shape required of the plugin `Config` (StandardSchemaV1 subset). */
export interface ConfigSchemaLike {
  readonly '~standard': StandardSchemaProps
}

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
            : spec.type === 'providers'
              ? Array.isArray(raw)
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
    let node: SchemasteryNode
    if (spec.type === 'boolean') {
      node = z.boolean()
    } else if (spec.type === 'number') {
      node = z.number()
    } else if (spec.type === 'providers') {
      // The structured S2 section (card product 8): schemastery nested object
      // array, official llm-pi-ai precedent (config.ts:340-361 z.dict(profile)
      // — ours is the card's array spelling). VOLATILE is load-bearing (U1):
      // without a volatile field the whole settings namespace never mounts
      // and the Models-page directory rows stay invisible.
      // Deep validation (contextWindow positive int, family in the official
      // union, R6 baseURL) runs at adapter construction (providers.ts
      // fail-loud) — the schema pins the SHAPE, the constructor pins the
      // semantics.
      const modelNode = z.object({
        id: z.string(),
        contextWindow: z.number(),
        maxTokens: z.number(),
        reasoningEfforts: z.dict(z.string()),
      })
      const providerNode = z.object({
        family: z.string(),
        baseURL: z.string(),
        apiKeyEnv: z.string(),
        models: z.array(modelNode),
        cacheRetention: z.string(),
        cacheControlFormat: z.string(),
      })
      node = z.array(providerNode)
    } else {
      node = z.string()
    }
    const defaulted = node.default(spec.default)
    fields[key] = spec.type === 'providers' && typeof defaulted.volatile === 'function'
      ? defaulted.volatile()
      : defaulted
  }
  return z.object(fields)
}

/** Plugin Config schema: schemastery-backed when available, fail-soft shim otherwise. */
export const configSchema: ConfigSchemaLike = (() => {
  const z = loadSchemastery()
  return z === undefined ? createFailSoftConfigSchema() : buildConfigSchemaWith(z)
})()
