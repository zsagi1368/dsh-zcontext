/**
 * The zctx thin adapter — `ZctxAdapter extends LlmAdapter` (task card V5
 * product 1; RES-adapter-route §11b S2 形态二: 自定义 provider 名 + 寄生
 * pi-ai 传输栈，只扛映射与分类，不扛传输语义).
 *
 * CLASS CONSTRUCTION: the official `LlmAdapter` is an ABSTRACT CLASS
 * (types: index.ts:211-294) obtained through the fail-soft optional import
 * (adapter/host.ts). The import is async, so the concrete class is built by
 * {@link createZctxAdapterClass} over the loaded base — the wiring layer
 * (plugin.ts) awaits the faces first and SKIPS the whole adapter face when
 * the base is unreachable (card constraint: 宿主不可达→adapter 面整体不注册
 * +诚实日志，永不炸 boot，五面降级先例).
 *
 * MEMBER DECISIONS (card: "providerInfo/providerRetryPolicy 按 F2 表决策并注明"):
 *   - stream          — the ONLY required member (F2.1); everything below has
 *                       an official default we either keep or override.
 *   - providerInfo    — OVERRIDDEN: `displayName` must surface the configured
 *                       name (`zctx <family>`), not the raw route key —
 *                       "a label only the configuration surface reads would
 *                       leave every selector showing the raw key"
 *                       (llm-pi-ai/src/adapter.ts:276-281 rationale).
 *   - providerRetryPolicy — NOT overridden: returns undefined → the runtime
 *                       freezes the DEFAULT policy (F1.5/F5.5: EMPTY_RESPONSE/
 *                       RATE_LIMIT/SERVER/TIMEOUT/TRANSPORT, 5 attempts,
 *                       500ms exponential + 10s cap + jitter) — the agent
 *                       recovery layer owns visible attempts (R4 discipline;
 *                       llm-retry/src/index.ts:243).
 *   - imageRequestPricing — NOT overridden (undefined → caller-side estimate;
 *                       S2 is text-only, images never reach the wire).
 *   - listModels      — OVERRIDDEN: from settings providers[].models (card).
 *   - resolveModel    — OVERRIDDEN: contextWindow comes from the config and
 *                       was validated at construction (INVALID_MODEL_CONTEXT
 *                       semantics — F2.2 normalizeModelInfo re-validates at
 *                       runtime; a bad declaration can never reach it).
 *   - prepareCall     — OVERRIDDEN: the official snapshot-freeze semantics
 *                       (one resolution per call; adapter.ts:330-336) — the
 *                       model info the stream uses is the one resolved at
 *                       prepare time.
 *
 * ERROR TWO-PATHS (F5.2): transport/protocol failures THROW LlmError with
 * codes from the official taxonomy (the runtime normalizes a throw into the
 * terminal error/aborted finish, index.ts:1172-1180); provider in-band
 * failures arrive as pi-ai error events and become error finish CHUNKS
 * through the mapping face (the harness's other sanctioned path). R4: the
 * SDK retry budget is pinned to ZERO (one adapter call is one SDK attempt —
 * the agent recovery layer owns visible retries).
 *
 * R1: zero body rewriting — the adapter inspects (onPayload, v5s3) but never
 * replaces a payload. R3: the adapter never calls ctx.llm.stream — it drives
 * pi-ai directly, so the recursion surface does not exist structurally.
 *
 * @module adapter/zctx-adapter
 */

import { toPiContextTextOnly } from './context.ts'
import type { AdapterFaces, HostLlmFace, MappingFace, PiAiFace } from './host.ts'
import { classifyPiAiErrorTwins, type MappingDeps } from './map.ts'
import type { ResolvedZctxModel, ResolvedZctxProvider } from './providers.ts'
import { buildWireFaces, requestHeaders } from './wire.ts'
import type { WireSink } from './wire.ts'

/** Logger subset the adapter may use (honest degrade logging). */
export interface AdapterLoggerLike {
  warn?(message: string): unknown
  info?(message: string): unknown
}

/** The pi-ai Model object the adapter materializes per request (structural). */
interface PiModelLike {
  id: string
  name: string
  api: string
  provider: string
  baseUrl: string
  input: string[]
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number }
  reasoning: boolean
  contextWindow: number
  maxTokens: number
  thinkingLevelMap?: Record<string, string | null>
  compat?: Record<string, unknown>
}

/** Structural subset of GenerateOptions the stream consumes. */
interface GenerateOptionsLike {
  readonly provider: string
  readonly model: string
  readonly messages: readonly unknown[]
  readonly tools?: readonly Record<string, unknown>[]
  readonly system?: unknown
  readonly sessionId?: unknown
  readonly signal?: AbortSignal
  readonly maxTokens?: number
  readonly temperature?: number
  readonly reasoningEffort?: string
  readonly stop?: unknown
}

/** The structural face the adapter presents to the runtime (F2 table). */
export interface ZctxAdapterFace {
  providerInfo(provider: string): { id: string; name: string }
  providerRetryPolicy(provider: string): unknown
  listModels(provider: string): Promise<readonly unknown[]>
  resolveModel(provider: string, model: string, signal?: AbortSignal): Promise<unknown>
  prepareCall(provider: string, model: string, signal?: AbortSignal): Promise<unknown>
  stream(options: unknown): AsyncIterable<unknown>
}

/** Everything the adapter class needs — all optional-import faces, pre-loaded. */
export interface ZctxAdapterDeps {
  readonly host: HostLlmFace
  readonly piAi: PiAiFace
  readonly mapping: MappingFace
  /** The resolved, validated provider specs (providers.ts; frozen per boot). */
  readonly providers: readonly ResolvedZctxProvider[]
  readonly logger?: AdapterLoggerLike
  /**
   * The wire-domain ledger sink (V5 product 4; R7's observation side).
   * Receives one WireSnapshot per wire observation (fetch bytes / onPayload
   * object view). Absent → the wire faces still ride the request (the
   * attribution headers are R7-mandatory regardless) but nothing is recorded.
   */
  readonly wireSink?: WireSink
}

/** Wire-spelling reasoning efforts on one model (config vocabulary). */
type EffortsMap = Readonly<Record<string, string>> | false

/** The official escalation order for the OFFERED effort list (catalog.ts:69-86). */
const THINKING_LEVEL_ORDER = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const

/**
 * The offered efforts for one model: the DISTINCT pi-ai levels its config
 * maps (values of the wire-spelling dict), in the official escalation order.
 * A model with no efforts entry (or `false`) offers nothing — omitting
 * `reasoning` entirely is the seam's way of saying the capability is
 * unavailable (official adapter.ts:198-213 rationale).
 */
function reasoningInfoOf(
  efforts: EffortsMap | undefined,
): { reasoning: { efforts: { id: string; name: string }[] } } | Record<string, never> {
  if (!efforts || typeof efforts !== 'object') return {}
  const levels = [...new Set(Object.values(efforts))]
  if (levels.length === 0) return {}
  const ordered = levels.sort((a, b) => {
    const ia = THINKING_LEVEL_ORDER.indexOf(a as (typeof THINKING_LEVEL_ORDER)[number])
    const ib = THINKING_LEVEL_ORDER.indexOf(b as (typeof THINKING_LEVEL_ORDER)[number])
    return (ia === -1 ? THINKING_LEVEL_ORDER.length : ia) - (ib === -1 ? THINKING_LEVEL_ORDER.length : ib)
  })
  return {
    reasoning: {
      efforts: ordered.map((level) => ({ id: level, name: `${level.charAt(0).toUpperCase()}${level.slice(1)}` })),
    },
  }
}

/** Validate a config-declared effort against the model's offered levels (official adapter.ts:168-180). */
function resolveReasoningLevel(
  route: string,
  modelId: string,
  efforts: EffortsMap | undefined,
  requested: string,
  deps: MappingDeps,
): string {
  const offered = !efforts || typeof efforts !== 'object' ? [] : [...new Set(Object.values(efforts))]
  if (!offered.includes(requested)) {
    throw new deps.LlmError(
      `zctx provider "${route}" model "${modelId}" does not support reasoning effort "${requested}"`,
      'UNSUPPORTED_REASONING_EFFORT',
    )
  }
  return requested
}

/**
 * Materialize the pi-ai Model descriptor for one config model (structural —
 * pi-ai's BaseModel/Model require id/name/api/provider/baseUrl/input/cost +
 * contextWindow/maxTokens/reasoning; cost zeros: self-hosted pricing is the
 * deployment's business, not the adapter's claim). The wire-spelling efforts
 * dict materializes as `thinkingLevelMap` (pi-ai types.d.ts ThinkingLevelMap:
 * key = pi-ai level, value = wire spelling or null).
 */
function materializePiModel(
  spec: ResolvedZctxProvider,
  model: ResolvedZctxModel,
): PiModelLike {
  const thinkingLevelMap: Record<string, string | null> | undefined =
    model.reasoningEfforts && typeof model.reasoningEfforts === 'object'
      ? Object.fromEntries(Object.entries(model.reasoningEfforts).map(([wire, level]) => [level, wire]))
      : undefined
  return {
    id: model.id,
    name: model.name,
    api: spec.protocol,
    provider: spec.route,
    baseUrl: spec.baseURL ?? '',
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    reasoning: thinkingLevelMap !== undefined,
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens ?? 32768,
    ...(thinkingLevelMap !== undefined ? { thinkingLevelMap } : {}),
  }
}

/**
 * Build the concrete adapter class over the loaded LlmAdapter base. The
 * runtime duck-types every member (F1.1 registerAdapter calls the members;
 * `extends` pins the abstract contract the card requires).
 */
export function createZctxAdapterClass(Base: abstract new () => unknown): new (deps: ZctxAdapterDeps) => ZctxAdapterFace {
  return class ZctxAdapter extends (Base as abstract new () => Record<string, unknown>) {
    private readonly deps: ZctxAdapterDeps

    constructor(deps: ZctxAdapterDeps) {
      super()
      this.deps = deps
    }

    // -- spec lookups ---------------------------------------------------------

    /** The spec for one route, or the official not-owned failure (adapter.ts:254-261). */
    private specOf(provider: string): ResolvedZctxProvider {
      const spec = this.deps.providers.find((candidate) => candidate.route === provider)
      if (spec === undefined) {
        throw new this.deps.host.LlmError(
          `zctx adapter does not own provider "${provider}" (registered routes: ${this.deps.providers.map((p) => p.route).join(', ') || 'none'})`,
          'NO_ADAPTER',
        )
      }
      return spec
    }

    /** The model descriptor for one route/model pair (UNKNOWN_MODEL when absent, adapter.ts:263-274). */
    private modelOf(provider: string, model: string): { spec: ResolvedZctxProvider; model: ResolvedZctxModel } {
      const spec = this.specOf(provider)
      const found = spec.models.find((candidate) => candidate.id === model)
      if (found === undefined) {
        throw new this.deps.host.LlmError(
          `zctx provider "${provider}" has no configured model "${model}"`,
          'UNKNOWN_MODEL',
        )
      }
      return { spec, model: found }
    }

    /** The resolved model info (runtime re-validates per F2.2; construction already gated contextWindow). */
    private modelInfoOf(provider: string, model: string): Record<string, unknown> {
      const { spec, model: found } = this.modelOf(provider, model)
      return {
        provider,
        id: found.id,
        name: found.name,
        inputModalities: ['text'],
        context: { contextWindow: found.contextWindow },
        ...(found.maxTokens !== undefined ? { defaultMaxTokens: found.maxTokens } : {}),
        ...reasoningInfoOf(found.reasoningEfforts),
      }
    }

    /** F4.3 credential chain: named env ref fails LOUD when missing (no ambient fallback). */
    private resolveApiKey(spec: ResolvedZctxProvider): string | undefined {
      if (spec.apiKeyEnv === undefined) return undefined
      const value = process.env[spec.apiKeyEnv]
      if (value === undefined || value === '') {
        throw new this.deps.host.LlmError(
          `zctx provider "${spec.route}" names credential env "${spec.apiKeyEnv}" but it is not set`
            + ` — export it (configuration carries the reference, never the secret)`,
          'MISSING_CREDENTIAL',
        )
      }
      return value
    }

    // -- F2 table members -----------------------------------------------------

    providerInfo(provider: string): { id: string; name: string } {
      const spec = this.specOf(provider)
      return { id: provider, name: spec.displayName }
    }

    /**
     * F2 decision (noted per card): NOT overridden — `undefined` lets the
     * runtime freeze the DEFAULT retry policy (F1.5/F5.5). The SDK budget is
     * pinned to zero separately (R4); the agent recovery layer owns retries.
     */
    providerRetryPolicy(_provider: string): undefined {
      return undefined
    }

    listModels(provider: string): Promise<readonly unknown[]> {
      return Promise.resolve().then(() => {
        const spec = this.specOf(provider)
        return spec.models.map((model) => ({
          provider,
          id: model.id,
          name: model.name,
          inputModalities: ['text'],
        }))
      })
    }

    resolveModel(provider: string, model: string, _signal?: AbortSignal): Promise<unknown> {
      return Promise.resolve().then(() => this.modelInfoOf(provider, model))
    }

    prepareCall(provider: string, model: string, _signal?: AbortSignal): Promise<unknown> {
      // Snapshot freeze (official adapter.ts:330-336): one resolution per
      // call; the stream keeps THIS info for the whole request.
      const info = this.modelInfoOf(provider, model)
      return Promise.resolve({
        model: info,
        stream: (options: unknown) => this.streamWithFrozenInfo(options, info as Record<string, unknown>),
      })
    }

    stream(options: unknown): AsyncIterable<unknown> {
      return this.streamWithFrozenInfo(options, undefined)
    }

    // -- the stream pipeline --------------------------------------------------

    private async *streamWithFrozenInfo(
      rawOptions: unknown,
      frozenInfo: Record<string, unknown> | undefined,
    ): AsyncGenerator<unknown> {
      const { host, piAi, mapping } = this.deps
      if (typeof rawOptions !== 'object' || rawOptions === null) {
        throw new host.LlmError('zctx adapter requires GenerateOptions-like input', 'INVALID_REQUEST')
      }
      const options = rawOptions as unknown as GenerateOptionsLike
      if (options.stop !== undefined) {
        throw new host.LlmError('zctx adapter does not support GenerateOptions.stop', 'UNSUPPORTED_OPTION')
      }
      if (typeof options.provider !== 'string' || typeof options.model !== 'string') {
        throw new host.LlmError('zctx adapter requires string provider and model', 'INVALID_REQUEST')
      }
      // One capture per stream call (official adapter.ts:349-355 semantics):
      // the spec, the model, and the credential freeze before the first await.
      const { spec, model } = this.modelOf(options.provider, options.model)
      const modelInfo = frozenInfo ?? this.modelInfoOf(options.provider, options.model)
      const apiKey = this.resolveApiKey(spec)

      // Product 6 (S2 text-only, honest boundary): any image block fails the
      // request BEFORE conversion — no attachment service exists to resolve
      // image bytes through.
      if (options.messages.some((message) => {
        if (typeof message !== 'object' || message === null) return false
        return host.contentHasImage((message as { content?: unknown }).content)
      })) {
        throw new host.LlmError(
          `zctx model "${model.id}" does not support image input (S2 adapter is text-only)`,
          'UNSUPPORTED_CONTENT',
        )
      }

      // Reasoning effort: validate against the config-declared levels.
      const reasoning =
        options.reasoningEffort === undefined
          ? undefined
          : resolveReasoningLevel(spec.route, model.id, model.reasoningEfforts, options.reasoningEffort, {
            LlmError: host.LlmError,
            CONTEXT_WINDOW_EXCEEDED_CODE: host.CONTEXT_WINDOW_EXCEEDED_CODE,
            EMPTY_RESPONSE_CODE: host.EMPTY_RESPONSE_CODE,
            QUOTA_EXCEEDED_CODE: host.QUOTA_EXCEEDED_CODE,
            isContextWindowExceededError: host.isContextWindowExceededError,
            isQuotaExceededError: host.isQuotaExceededError,
          })

      // Caller cancellation + consumer teardown (official adapter.ts:372-375
      // consumer pattern; the dsh-timeout idle watchdog is the official
      // plugin's hardening and is NOT carried — the pi-ai transport owns
      // stream termination for S2).
      const consumer = new AbortController()
      const upstream =
        options.signal === undefined
          ? consumer.signal
          : AbortSignal.any([options.signal, consumer.signal])

      try {
        const api = await piAi.loadApi(spec.protocol)
        if (api === undefined) {
          throw new host.LlmError(
            `zctx provider "${spec.route}" names protocol "${spec.protocol}", which this build cannot serve`,
            'UNSUPPORTED_OPTION',
          )
        }
        const historyDeps: MappingDeps = {
          LlmError: host.LlmError,
          CONTEXT_WINDOW_EXCEEDED_CODE: host.CONTEXT_WINDOW_EXCEEDED_CODE,
          EMPTY_RESPONSE_CODE: host.EMPTY_RESPONSE_CODE,
          QUOTA_EXCEEDED_CODE: host.QUOTA_EXCEEDED_CODE,
          isContextWindowExceededError: host.isContextWindowExceededError,
          isQuotaExceededError: host.isQuotaExceededError,
        }
        // History conversion (v5s1 twin; honest boundary — always the
        // text-only conversion, images rejected above).
        const context = toPiContextTextOnly(rawOptions, historyDeps, (reason: string) => {
          this.deps.logger?.warn?.(
            `dsh-zcontext: assistant replay state degraded to provider-neutral (${reason})`,
          )
        })

        const piModel = materializePiModel(spec, model)
        const window = modelInfo['context'] !== undefined
          ? ((modelInfo['context'] as { contextWindow?: number }).contextWindow ?? model.contextWindow)
          : model.contextWindow
        // Wire-observation faces (V5 product 4): onPayload observe-only (R1),
        // custom fetch hashing the final body bytes, attribution headers
        // riding the request (R7). Session-bound requests only — one-shots
        // have no session ledger to land in.
        const sessionId = typeof options.sessionId === 'string' && options.sessionId.length > 0
          ? options.sessionId
          : undefined
        const wireFaces = sessionId === undefined
          ? undefined
          : buildWireFaces(
            { sessionId, provider: spec.route, model: model.id },
            this.deps.wireSink,
            host,
          )
        const events = api.streamSimple(piModel, context, {
          ...(apiKey === undefined ? {} : { apiKey }),
          ...(reasoning === undefined ? {} : { reasoning }),
          ...(options.maxTokens === undefined ? {} : { maxTokens: options.maxTokens }),
          ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
          ...(sessionId === undefined ? {} : { sessionId }),
          ...(wireFaces === undefined ? {} : { onPayload: wireFaces.onPayload }),
          ...(wireFaces === undefined ? {} : { fetch: wireFaces.fetch }),
          // R7: attributionHeaders MUST reach the wire even when the ledger
          // sink is absent — the headers are a request obligation, the
          // snapshots are a coverage decision.
          headers: wireFaces?.headers ?? requestHeaders(undefined, host),
          signal: upstream,
          // R4: the agent recovery layer owns visible attempts; one adapter
          // call is ONE SDK attempt (official adapter.ts:140-141).
          maxRetries: 0,
        }) as AsyncIterable<unknown>
        yield* mapping.toStreamChunks(events, window, options.signal, model.id)
      } catch (error: unknown) {
        // Two-path error delivery, path ONE (throw): classify non-LlmError
        // transport failures through the twin table so the runtime's
        // adapterFailureChunk lands in the official taxonomy instead of
        // UNKNOWN (F5.2/F5.3; the caller-abort case stays aborted).
        if (options.signal?.aborted) {
          throw new host.LlmError('zctx request aborted by caller', 'ABORTED', { cause: error })
        }
        if (error instanceof host.LlmError) throw error
        const message = error instanceof Error ? error.message : String(error)
        throw new host.LlmError(
          `zctx transport failure: ${message}`,
          classifyPiAiErrorTwins(message, {
            LlmError: host.LlmError,
            CONTEXT_WINDOW_EXCEEDED_CODE: host.CONTEXT_WINDOW_EXCEEDED_CODE,
            EMPTY_RESPONSE_CODE: host.EMPTY_RESPONSE_CODE,
            QUOTA_EXCEEDED_CODE: host.QUOTA_EXCEEDED_CODE,
            isContextWindowExceededError: host.isContextWindowExceededError,
            isQuotaExceededError: host.isQuotaExceededError,
          }),
          { cause: error },
        )
      } finally {
        consumer.abort('zctx stream consumer stopped')
      }
    }
  }
}
