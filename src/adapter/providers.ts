/**
 * zctx provider-spec resolution — the PURE config→spec layer the adapter
 * consumes (task card V5 products 1/8; coordinator A-ruling recorded
 * 2026-11-13): `providers[].family` IS the wire protocol name, taken from
 * the official `supportedProtocols()` union ('openai-completions' |
 * 'openai-responses' | 'anthropic-messages') — ZERO invented mapping, the
 * route name is `zctx-<family>` (redline R5), the display name is
 * `zctx <family>` verbatim, and an unknown family is a CONSTRUCTION-TIME
 * violation (fail-loud with the complete violation list; the wiring layer
 * catches and skips the face with the list in the log — boot never breaks,
 * the五面降级 precedent, while the constructor contract stays fail-loud).
 *
 * Validation rules (card: "contextWindow 必须声明（正整数，INVALID_MODEL_CONTEXT
 * 语义）——配置缺失模型→构造期 fail-loud 列清单"):
 *   - family: non-empty, member of the supported union, no duplicates (two
 *     entries with the same family would race for the same route key).
 *   - models: at least one per provider; ids non-empty and unique.
 *   - contextWindow: REQUIRED positive integer (INVALID_MODEL_CONTEXT
 *     semantics — F2.2 normalizeModelInfo index.ts:783-788).
 *   - maxTokens: REQUIRED positive integer (official catalog.ts:934-936
 *     semantics — a missing value is a CONSTRUCTION violation, never an
 *     invented default; R5 V5-2 closure).
 *   - baseURL: absolute http(s) URL when present (redline R6 — HTTP(SSE)
 *     only; ws:// or other schemes are a violation, not a silent pass).
 *   - apiKeyEnv: non-empty string when present (a reference NAME — config
 *     carries the reference, never the secret, F4.3).
 *
 * @module adapter/providers
 */

/** One provider entry of the structured settings section (card product 8 + 5). */
export interface ZctxProviderConfig {
  /** The wire protocol family (A-ruling: member of the official protocol union). */
  readonly family: string
  /** Endpoint override (http/https; R6). */
  readonly baseURL?: string
  /** Environment variable NAME holding the API key (a reference, F4.3). */
  readonly apiKeyEnv?: string
  /** The declared models (at least one; card: 配置缺失模型 fail-loud). */
  readonly models: readonly ZctxProviderModelConfig[]
  /**
   * Prompt-cache retention knob (card product 5, F4.6): 'none' | 'short' |
   * 'long', passed through to pi-ai StreamOptions.cacheRetention (pi-ai's
   * resolveCacheRetention: explicit value > env > default 'short'). Absent =
   * pi-ai's own default applies.
   */
  readonly cacheRetention?: 'none' | 'short' | 'long'
  /**
   * Cache-control marker format for OpenAI-compatible endpoints (card
   * product 5, F4.6: only ONE legal value, 'anthropic' — the official GATE
   * catalog.ts:146-151 union). ONLY meaningful on the openai-completions
   * family; on any other family it is a construction violation (dead config
   * is dishonest config).
   */
  readonly cacheControlFormat?: 'anthropic'
}

/** One model entry of a provider (card product 8 fields). */
export interface ZctxProviderModelConfig {
  readonly id: string
  /** REQUIRED positive integer (INVALID_MODEL_CONTEXT semantics). */
  readonly contextWindow: number
  /**
   * REQUIRED positive integer (official catalog.ts:934-936 semantics — a
   * missing value is a construction violation, never an invented default).
   */
  readonly maxTokens: number
  /** Wire-spelling reasoning efforts: wireValue → pi-ai level; false = none. */
  readonly reasoningEfforts?: Readonly<Record<string, string>> | false
}

/** One resolved, validated provider spec the adapter registers. */
export interface ResolvedZctxProvider {
  /** The adapter route key: `zctx-<family>` (R5). */
  readonly route: string
  readonly family: string
  /** `zctx <family>` (card product 1). */
  readonly displayName: string
  /** The wire protocol (A-ruling: === family). */
  readonly protocol: string
  readonly baseURL?: string
  readonly apiKeyEnv?: string
  readonly models: readonly ResolvedZctxModel[]
  /** Cache retention passthrough (F4.6); absent = pi-ai default applies. */
  readonly cacheRetention?: 'none' | 'short' | 'long'
  /** Cache-control marker format (F4.6); present only on openai-completions. */
  readonly cacheControlFormat?: 'anthropic'
}

/** One resolved, validated model descriptor. */
export interface ResolvedZctxModel {
  readonly id: string
  readonly name: string
  readonly contextWindow: number
  /** REQUIRED (validated positive integer; V5-2 no-invented-defaults). */
  readonly maxTokens: number
  readonly reasoningEfforts?: Readonly<Record<string, string>> | false
}

/** The structured settings section shape (v5s5 wires the schemastery schema). */
export interface ZctxProvidersSection {
  readonly providers?: readonly ZctxProviderConfig[]
}

/** The route key for one family (R5 namespace). */
export function zctxRouteOf(family: string): string {
  return `zctx-${family}`
}

/** The display name for one family (card product 1, verbatim technical name). */
export function zctxDisplayNameOf(family: string): string {
  return `zctx ${family}`
}

function isPositiveInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

/**
 * Resolve and validate the whole providers section at once. Returns the
 * resolved specs AND the complete violation list (构造期 fail-loud 列清单 —
 * the caller throws with the FULL list, never one-at-a-time). Empty/absent
 * section resolves to zero providers with zero violations (the adapter face
 * then registers zero routes — legal per F1.4's keep-alive semantics).
 */
export function resolveZctxProviders(
  section: ZctxProvidersSection | undefined,
  supportedProtocols: readonly string[],
): { providers: ResolvedZctxProvider[]; violations: string[] } {
  const violations: string[] = []
  const providers: ResolvedZctxProvider[] = []
  const seenFamilies = new Set<string>()
  const sectionProviders = section?.providers ?? []
  sectionProviders.forEach((provider, index) => {
    const label = provider.family === undefined || provider.family === ''
      ? `providers[${index}]`
      : `providers[${index}] (family "${provider.family}")`
    const family = typeof provider.family === 'string' ? provider.family.trim() : ''
    if (family === '') {
      violations.push(`${label}: family is required (the wire protocol name)`)
      return
    }
    if (!(supportedProtocols as readonly string[]).includes(family)) {
      violations.push(
        `${label}: family "${family}" is not a supported wire protocol`
        + ` (supported: ${supportedProtocols.join(', ')})`,
      )
      return
    }
    if (seenFamilies.has(family)) {
      violations.push(`${label}: duplicate family "${family}" — each family maps to one route (${zctxRouteOf(family)})`)
      return
    }
    seenFamilies.add(family)
    const models: ResolvedZctxModel[] = []
    const seenIds = new Set<string>()
    const providerModels = Array.isArray(provider.models) ? provider.models : []
    if (providerModels.length === 0) {
      violations.push(`${label}: declares no models — a route without models cannot serve requests`)
    }
    providerModels.forEach((model, modelIndex) => {
      const modelLabel = `${label} models[${modelIndex}]`
      const id = typeof model?.id === 'string' ? model.id.trim() : ''
      if (id === '') {
        violations.push(`${modelLabel}: id is required`)
        return
      }
      if (seenIds.has(id)) {
        violations.push(`${modelLabel}: duplicate model id "${id}"`)
        return
      }
      seenIds.add(id)
      if (!isPositiveInt(model.contextWindow)) {
        violations.push(
          `${modelLabel} ("${id}"): contextWindow must be a declared positive integer`
          + ` (INVALID_MODEL_CONTEXT semantics; got ${JSON.stringify(model.contextWindow)})`,
        )
        return
      }
      if (!isPositiveInt(model.maxTokens)) {
        violations.push(
          `${modelLabel} ("${id}"): maxTokens must be a positive integer declared in config`
          + ` (official catalog.ts:934-936 — a missing value is a construction violation,`
          + ` never an invented default; got ${JSON.stringify(model.maxTokens)})`,
        )
        return
      }
      models.push({
        id,
        name: id,
        contextWindow: model.contextWindow,
        maxTokens: model.maxTokens,
        ...(model.reasoningEfforts !== undefined ? { reasoningEfforts: model.reasoningEfforts } : {}),
      })
    })
    let baseURL: string | undefined
    if (provider.baseURL !== undefined) {
      if (typeof provider.baseURL !== 'string' || provider.baseURL === '') {
        violations.push(`${label}: baseURL must be a non-empty string when present`)
      } else if (provider.baseURL.startsWith('ws://') || provider.baseURL.startsWith('wss://')) {
        // Redline R6: HTTP(SSE) only — WebSocket transport is OUT of scope,
        // declared unsupported, never silently accepted.
        violations.push(`${label}: baseURL "${provider.baseURL}" uses WebSocket transport, which zctx does not support (R6: HTTP(SSE) only)`)
      } else {
        try {
          const url = new URL(provider.baseURL)
          if (url.protocol !== 'http:' && url.protocol !== 'https:') {
            violations.push(`${label}: baseURL "${provider.baseURL}" must be http(s) (R6)`)
          } else {
            baseURL = provider.baseURL
          }
        } catch {
          violations.push(`${label}: baseURL "${provider.baseURL}" is not an absolute URL`)
        }
      }
    }
    if (provider.apiKeyEnv !== undefined && (typeof provider.apiKeyEnv !== 'string' || provider.apiKeyEnv === '')) {
      violations.push(`${label}: apiKeyEnv must be a non-empty environment variable NAME when present`)
    }
    // Cache knobs (card product 5, F4.6): cacheRetention joins the pi-ai
    // StreamOptions passthrough; cacheControlFormat has exactly ONE legal
    // value (official GATE union) and is ONLY meaningful on the
    // openai-completions family — anywhere else it would be dead config,
    // which the construction gate refuses instead of carrying silently.
    let cacheRetention: 'none' | 'short' | 'long' | undefined
    if (provider.cacheRetention !== undefined) {
      if (provider.cacheRetention === 'none' || provider.cacheRetention === 'short' || provider.cacheRetention === 'long') {
        cacheRetention = provider.cacheRetention
      } else {
        violations.push(`${label}: cacheRetention "${String(provider.cacheRetention)}" is not one of 'none' | 'short' | 'long'`)
      }
    }
    let cacheControlFormat: 'anthropic' | undefined
    if (provider.cacheControlFormat !== undefined) {
      if (provider.cacheControlFormat !== 'anthropic') {
        violations.push(`${label}: cacheControlFormat "${String(provider.cacheControlFormat)}" is not 'anthropic' (the only legal value, official GATE union)`)
      } else if (family !== 'openai-completions') {
        violations.push(`${label}: cacheControlFormat is only meaningful on the openai-completions family (family "${family}" would carry dead config)`)
      } else {
        cacheControlFormat = 'anthropic'
      }
    }
    providers.push({
      route: zctxRouteOf(family),
      family,
      displayName: zctxDisplayNameOf(family),
      protocol: family,
      ...(baseURL !== undefined ? { baseURL } : {}),
      ...(provider.apiKeyEnv !== undefined ? { apiKeyEnv: provider.apiKeyEnv } : {}),
      models,
      ...(cacheRetention !== undefined ? { cacheRetention } : {}),
      ...(cacheControlFormat !== undefined ? { cacheControlFormat } : {}),
    })
  })
  return { providers, violations }
}

/**
 * The construction-time fail-loud gate: throws with the COMPLETE violation
 * list when any violation exists. The wiring layer catches this and skips
 * the adapter face with the list in the log (fail-soft at boot, fail-loud
 * at the adapter contract — both disciplines hold).
 */
export function assertZctxProvidersResolvable(
  section: ZctxProvidersSection | undefined,
  supportedProtocols: readonly string[],
): ResolvedZctxProvider[] {
  const { providers, violations } = resolveZctxProviders(section, supportedProtocols)
  if (violations.length > 0) {
    throw new Error(
      `dsh-zcontext: zctx adapter configuration is not serviceable (${violations.length} violation(s)):\n`
      + violations.map((violation) => `  - ${violation}`).join('\n'),
    )
  }
  return providers
}
