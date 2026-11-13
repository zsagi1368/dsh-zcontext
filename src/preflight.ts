/**
 * preflight.ts — the S1 waterfall-level preflight listener (v0.2.0 V4, task
 * card products 1-3; RES-adapter-route §11b S1 + F3.3/F3.4/F6.1-F6.4/F8.3).
 *
 * WHAT THIS IS: a second `llm/stream` waterfall listener (registered
 * OUTERMOST — cordis composes listeners outermost-first,
 * vendor/cordis/src/events.ts:221-236 — so an enforce short-circuit
 * suppresses the entire downstream chain: no adapter dispatch, no wire
 * request, no observation cost). It estimates the request's context size
 * BEFORE the wire and judges it against the CCM trigger line.
 *
 * FALSE-POSITIVE COST DECLARATION (F6.4, card docstring requirement): a
 * preflight hit that the provider would have accepted triggers one
 * unnecessary compaction surface rewrite (the session view is folded).
 * That cost is why enforce is opt-in (config preflightMode, R2: default
 * 'observe', unreached by the default configuration — pinned by test) and
 * why the hit threshold carries a margin (preflightMarginRatio, default
 * 0.9): hit ⇔ estimate > triggerLine × margin, where
 * triggerLine = W − R_pess (budget.ts CCM §1.2). 估算器误差分布待真机标定后
 * 调整 — the observe-mode calibration ledger (product 3) is the dataset
 * that decides when enforce is safe to promote (no-go condition 4).
 *
 * ESTIMATOR (F3.4): the waterfall sees PRE-projection messages (file/image
 * projection happens inside adapterStream, llm/src/index.ts:1084-1106), so
 * the estimate re-projects through the same public face the V2 observe
 * listener uses (loadHostProjector: official exports when the host is
 * present, labeled local-fallback twins otherwise — the `projector` label
 * is honest per record). Text cost = chars/3 (CCM L0, budget.estimateTokens;
 * a known UNDERESTIMATE for dense CJK — budget.ts docstring). Images follow
 * the official gating: projected to placeholder text only for KNOWN
 * image-less models (same condition as observe.normalizeForHash); images
 * that stay on the wire cost adapter `imageRequestPricing`
 * (visualTokens + text, llm/src/types.ts:212-220) when injectable, else a
 * fixed conservative reserve per image (PER_IMAGE_FALLBACK_TOKENS, 待标定).
 *
 * RECURSION REDLINE (plan §2 R3): this module NEVER calls ctx.llm.stream.
 * The deps surface is narrow by construction — it has no llm runtime at
 * all, only three single-purpose host helpers (resolveModelInfo,
 * fileRequestText, imageRequestPricing) — so the self-call is structurally
 * unreachable, not just forbidden.
 *
 * READ-ONLY DISCIPLINE (same contract as the V2 listener): the frozen
 * request tree is read through non-mutating projections only (the zero-
 * mutation pin covers this listener in tests); nothing is written to host
 * or session state; the only side effect is the process-memory calibration
 * ledger through the injected store port.
 *
 * SHORT-CIRCUIT SHAPE (enforce hit; card: 形态严格对照官方协议): exactly one
 * terminal chunk `finish{kind:'error', failure:{code:'CONTEXT_WINDOW_EXCEEDED'}}`
 * per the official StreamChunk protocol (llm/src/types.ts:452-464 read
 * directly: "Adapters emit usage before the terminal finish and nothing
 * afterward" — no usage exists here, so none is emitted, and the finish is
 * both first and last). LlmFailure carries message + code only (official
 * shape types.ts:41-62; status/requestId honestly absent — we have none).
 * agent-loop converts the finish error into agent/request-error
 * (agent-loop/src/agent.ts:511-530) and compaction-basic's overflow handler
 * consumes the exact code (compaction-basic/src/index.ts:194→233) — the
 * official recovery chain owns everything after the short-circuit.
 *
 * @module preflight
 */

import { computeBudget, estimateTokens, CHARS_PER_TOKEN } from './budget.ts'
import { loadHostProjector } from './host-llm.ts'
import type {
  HostModelInfoLike,
  HostProjector,
  RequestMessageLike,
  ResolvePathLike,
  ToolSchemaLike,
} from './host-llm.ts'
import { matchesMainChain } from './observe.ts'
import { stableStringify } from './hash.ts'
import type {
  PreflightCalibrationRecord,
  PreflightImagePricing,
  PreflightMode,
} from './types.ts'

/**
 * Conservative per-image token reserve used when the adapter's
 * imageRequestPricing is unavailable (card: 每图常数预留+标注). An
 * UNCALIBRATED placeholder chosen well above typical single-image visual
 * token costs so the estimate errs toward safety on image-heavy requests;
 * calibration pending (plan §3) — adjust from the calibration ledger, never
 * silently.
 */
export const PER_IMAGE_FALLBACK_TOKENS = 2048

/**
 * The official overflow failure code (llm/src/error.ts:25,
 * `CONTEXT_WINDOW_EXCEEDED_CODE`, read directly from source). Duplicated as
 * a literal because this module never imports the host statically (fail-soft
 * loading discipline, config.ts precedent); tests pin the value against the
 * official constant's documented spelling.
 */
export const PREFLIGHT_CONTEXT_WINDOW_EXCEEDED_CODE = 'CONTEXT_WINDOW_EXCEEDED'

/** Structural twin of the official LlmImageRequestPrice (llm/src/types.ts:200-208). */
export interface HostImagePriceLike {
  /** Provider visual tokens for the image occurrence. */
  readonly visualTokens: number
  /** Model-visible text sent for this occurrence (priced by the text estimator). */
  readonly text: string
}

/** Structural twin of the official LlmImageRequestPricing (llm/src/types.ts:212-220). */
export interface HostImagePricingLike {
  priceImages(images: readonly unknown[]): readonly HostImagePriceLike[]
}

/** The store receive port the preflight listener needs (implemented by FoldStore). */
export interface PreflightStoreAccess {
  /** Calibration sink: append one estimate-vs-reality record (bounded, oldest dropped). */
  absorbPreflightCalibration(record: PreflightCalibrationRecord): void
}

/**
 * Dependencies injected from the plugin. Narrow by construction (R3): no llm
 * runtime — only single-purpose helpers; each optional member degrades
 * honestly (documented per member).
 */
export interface PreflightDeps {
  /** The listener's mode; 'off' never reaches a constructed listener (plugin gate). */
  mode: Exclude<PreflightMode, 'off'>
  /** Hit margin (config preflightMarginRatio; validated in the constructor). */
  marginRatio: number
  /** Resolve one session id to its live session (criterion 3); undefined = not watched. */
  resolveSession(sessionId: string): unknown
  /** Per-session store accessors; undefined = unbound (no estimate, no record). */
  storeFor(session: unknown): PreflightStoreAccess | undefined
  /**
   * Official ModelInfo resolution (context window source, F6.2; image gating
   * modalities). Optional: without it the window is unknown → released
   * honestly (hit undefined, F6.4 degrade).
   */
  resolveModelInfo?(provider: string, model: string): Promise<HostModelInfoLike | undefined>
  /**
   * Official `ctx.llm.fileRequestText` (adapter-dispatch-identical handle
   * text, llm/src/index.ts:690-692). Optional: without it the projection's
   * default resolver yields the deterministic fallback handle text.
   */
  fileRequestText?(ref: unknown): string
  /**
   * Official `ctx.llm.imageRequestPricing` (llm/src/index.ts:680-682).
   * Optional: without it kept images carry the constant reserve.
   */
  imageRequestPricing?(provider: string, model: string): HostImagePricingLike | undefined
  /** Logger (warn-once on faults). */
  logger?: { warn?(message: string): void }
}

/** The waterfall listener signature (official 'llm/stream' event face). */
export type PreflightStreamListener = (
  options: unknown,
  next: () => AsyncIterable<unknown>,
) => AsyncIterable<unknown>

/** One judged request, built before the stream is touched. */
interface JudgedRequest {
  /** The raw options record (read-only; never mutated). */
  record: Record<string, unknown>
  /** Session id (criterion 3 match). */
  sessionId: string
  /** Injected store accessors. */
  store: PreflightStoreAccess
  /** The estimate + judgment (record fields before outcome/usage are known). */
  calibration: Omit<PreflightCalibrationRecord, 'outcome' | 'usage'>
}

/** The pure estimate result (test surface). */
export interface PreflightEstimate {
  /** Total estimated request input tokens (text chars/3 + image costs). */
  readonly tokens: number
  /** Which image-cost path priced the kept images. */
  readonly imagePricing: PreflightImagePricing
  /** Number of image occurrences seen (kept + projected-away). */
  readonly imageCount: number
}

/** The pure judgment result (test surface). */
export interface PreflightJudgment {
  /** Context window used; undefined = unresolvable. */
  readonly window: number | undefined
  /** CCM trigger line for the window; present exactly when window is. */
  readonly triggerLine: number | undefined
  /** Hit verdict; undefined = window/budget unusable → released (F6.4). */
  readonly hit: boolean | undefined
}

/** Read a positive finite integer window off the resolved model info. */
function windowOf(modelInfo: HostModelInfoLike | undefined): number | undefined {
  const window = modelInfo?.context?.contextWindow
  return typeof window === 'number' && Number.isFinite(window) && window > 0 ? window : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object'
}

/** True when the message's typed content contains a block of the given type. */
function contentHasType(message: RequestMessageLike, type: string): boolean {
  const content = message.content
  if (!Array.isArray(content)) return false
  return content.some((block) => isRecord(block) && block.type === type)
}

/**
 * Walk one message's content: text/reasoning count their characters, kept
 * image blocks return for pricing, every other block (tool-call history,
 * residual file shapes, unknown future blocks) counts its structural JSON
 * — an honest chars-level reduction of whatever actually rides the wire.
 */
function walkMessage(message: RequestMessageLike): { chars: number; keptImages: unknown[] } {
  const content = message.content
  if (typeof content === 'string') return { chars: content.length, keptImages: [] }
  let chars = 0
  const keptImages: unknown[] = []
  if (Array.isArray(content)) {
    for (const block of content) {
      if (isRecord(block) && (block.type === 'text' || block.type === 'reasoning')
        && typeof block.text === 'string') {
        chars += block.text.length
        continue
      }
      if (isRecord(block) && block.type === 'image') {
        keptImages.push(block)
        continue
      }
      chars += stableStringify(block).length
    }
  } else {
    chars += stableStringify(content).length
  }
  return { chars, keptImages }
}

/**
 * Estimate the projected request's input tokens (the pure estimator; the
 * listener feeds it the projections). `projected.messages` must already carry
 * the file/image/tool-update projections; kept images are priced here.
 */
export function estimateProjectedRequest(input: {
  readonly messages: readonly RequestMessageLike[]
  readonly tools: readonly ToolSchemaLike[] | undefined
  readonly system: unknown
  readonly pricing: HostImagePricingLike | undefined
}): PreflightEstimate {
  let chars = 0
  let imageCount = 0
  let keptImages: unknown[] = []
  for (const message of input.messages) {
    const walked = walkMessage(message)
    chars += walked.chars
    imageCount += walked.keptImages.length
    keptImages = keptImages.concat(walked.keptImages)
  }
  if (typeof input.system === 'string') chars += input.system.length
  for (const tool of input.tools ?? []) chars += stableStringify(tool).length

  // Image cost, two honest paths (card: 计价/常数预留+标注).
  let imageTokens = 0
  let imagePricing: PreflightImagePricing = 'not-exercised'
  if (keptImages.length > 0) {
    const prices = safePriceImages(input.pricing, keptImages)
    if (prices !== undefined) {
      imagePricing = 'adapter'
      for (const price of prices) {
        const visual = typeof price?.visualTokens === 'number' && Number.isFinite(price.visualTokens)
          ? price.visualTokens
          : PER_IMAGE_FALLBACK_TOKENS
        imageTokens += visual + estimateTokens(typeof price?.text === 'string' ? price.text : '')
      }
    } else {
      imagePricing = 'constant-reserve'
      imageTokens += keptImages.length * PER_IMAGE_FALLBACK_TOKENS
    }
  }
  return {
    tokens: Math.ceil(chars / CHARS_PER_TOKEN) + imageTokens,
    imagePricing,
    imageCount,
  }
}

/** Price kept images fail-soft: adapter faults / shape mismatches → undefined. */
function safePriceImages(
  pricing: HostImagePricingLike | undefined,
  images: readonly unknown[],
): readonly HostImagePriceLike[] | undefined {
  if (pricing === undefined || typeof pricing.priceImages !== 'function') return undefined
  try {
    const prices = pricing.priceImages(images)
    return Array.isArray(prices) && prices.length === images.length ? prices : undefined
  } catch {
    return undefined
  }
}

/**
 * Judge one estimate against the CCM trigger line (card: 估算 >
 * triggerLine × marginRatio → 命中). Fail-soft everywhere: an unresolvable
 * window or a degenerate computeBudget window releases the request with
 * hit undefined (F6.4 degrade-to-observe — the provider's own overflow
 * error still reaches the same recovery chain).
 */
export function judgeEstimate(input: {
  readonly estimate: number
  readonly modelInfo: HostModelInfoLike | undefined
  readonly optionsMaxTokens: unknown
  readonly marginRatio: number
}): PreflightJudgment {
  const window = windowOf(input.modelInfo)
  if (window === undefined) return { window: undefined, triggerLine: undefined, hit: undefined }
  const maxTokens = typeof input.optionsMaxTokens === 'number' && input.optionsMaxTokens > 0
    ? input.optionsMaxTokens
    : (typeof input.modelInfo?.defaultMaxTokens === 'number' && input.modelInfo.defaultMaxTokens > 0
      ? input.modelInfo.defaultMaxTokens
      : undefined)
  try {
    const budget = computeBudget({ contextWindow: window, ...(maxTokens !== undefined ? { maxOutput: maxTokens } : {}) })
    return { window, triggerLine: budget.triggerLine, hit: input.estimate > budget.triggerLine * input.marginRatio }
  } catch {
    // Degenerate window (cannot sustain its own reserve): release honestly.
    return { window, triggerLine: undefined, hit: undefined }
  }
}

/** Clamp the configured margin into (0, 1]; anything else falls back to 0.9 (warn-once). */
export function resolveMarginRatio(value: number | undefined, logger: PreflightDeps['logger']): number {
  const DEFAULT = 0.9
  if (typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 1) return value
  logger?.warn?.(
    `dsh-zcontext: preflightMarginRatio ${String(value)} is outside (0, 1] — falling back to ${DEFAULT}`,
  )
  return DEFAULT
}

/**
 * The S1 preflight listener. Construct once per plugin when
 * preflightMode !== 'off'; register `onStream` on the host's llm/stream
 * waterfall BEFORE the observe listener (outermost — see module docstring).
 */
export class PreflightListener {
  private readonly deps: PreflightDeps
  private readonly modelInfoCache = new Map<string, Promise<HostModelInfoLike | undefined>>()
  private projector: Promise<HostProjector> | undefined
  private warnedFault = false
  private warnedSinkFault = false

  /** Same bounded-cap design as the V2 model-info cache (V2-C precedent). */
  private static readonly MODEL_INFO_CACHE_CAP = 64

  constructor(deps: PreflightDeps) {
    this.deps = { ...deps, marginRatio: resolveMarginRatio(deps.marginRatio, deps.logger) }
  }

  /** Memoized projector (same lazy face as the observe listener). */
  ensureProjector(): Promise<HostProjector> {
    this.projector ??= loadHostProjector()
    return this.projector
  }

  /** The waterfall listener body (instance arrow property — cordis `this` safety). */
  readonly onStream: PreflightStreamListener = (options: unknown, next: () => AsyncIterable<unknown>) =>
    this.handleStream(options, next)

  /** @internal */
  private async *handleStream(options: unknown, next: () => AsyncIterable<unknown>): AsyncIterable<unknown> {
    let judged: JudgedRequest | undefined
    try {
      judged = await this.judgeRequest(options)
    } catch (error: unknown) {
      if (!this.warnedFault) {
        this.warnedFault = true
        this.deps.logger?.warn?.(
          `dsh-zcontext: preflight estimation failed (${error instanceof Error ? error.message : String(error)}); releasing requests unjudged until the fault clears`,
        )
      }
      judged = undefined // the request must never break because the estimator did
    }
    if (judged === undefined) {
      yield* next()
      return
    }
    // ENFORCE HIT: short-circuit. next() is never called — the adapter never
    // runs, no wire request, no usage. Exactly one terminal finish chunk
    // (official protocol: nothing after finish; no usage exists to emit).
    if (this.deps.mode === 'enforce' && judged.calibration.hit === true) {
      this.sink(judged.store, { ...judged.calibration, outcome: 'short-circuited' })
      yield buildPreflightErrorFinish(judged.calibration)
      return
    }
    // Pass-through with calibration: every chunk flows unchanged; the usage
    // chunk (officially emitted before the terminal finish) completes the
    // record when the stream settles.
    yield* this.calibrateWrap(judged, next)
  }

  /**
   * Criteria 1-3 (shared matchesMainChain) + estimate + judgment. Every
   * main-chain request is judged — criterion 4's snapshot exemption window
   * does NOT apply here (a post-reset request must still be judged; see
   * matchesMainChain). Non-main-chain requests (one-shots: compaction
   * summarize, session-title) stream through untouched — enforce MUST NOT
   * short-circuit the compaction recovery's own calls.
   * @internal
   */
  private async judgeRequest(options: unknown): Promise<JudgedRequest | undefined> {
    if (!isRecord(options)) return undefined
    const projector = await this.ensureProjector()
    const match = matchesMainChain(options, projector, this.deps)
    if (match === undefined) return undefined
    const store = match.store as PreflightStoreAccess

    const provider = typeof options.provider === 'string' ? options.provider : ''
    const model = typeof options.model === 'string' ? options.model : ''
    const modelInfo = await this.resolveModelInfoCached(provider, model)

    // Pre-projection messages (F3.4): re-project through the public face.
    const messages: readonly RequestMessageLike[] = Array.isArray(options.messages)
      ? (options.messages as RequestMessageLike[])
      : []
    const tools: readonly ToolSchemaLike[] | undefined = Array.isArray(options.tools)
      ? (options.tools as ToolSchemaLike[])
      : undefined
    const resolvePath: ResolvePathLike =
      typeof this.deps.fileRequestText === 'function'
        ? (ref: unknown) => this.deps.fileRequestText?.(ref)
        : () => undefined
    let projected = projector.projectFilesToText(messages, resolvePath)
    // Official image gating: project away only for KNOWN image-less models.
    const hasImages = messages.some((message) => contentHasType(message, 'image'))
    if (
      hasImages
      && modelInfo?.inputModalities !== undefined
      && !modelInfo.inputModalities.includes('image')
    ) {
      projected = projector.projectImagesForTextModel(projected)
    }
    const toolUpdate = modelInfo?.toolUpdate
    const projectedTools = projector.projectToolUpdates(projected, tools, toolUpdate, options.toolHistory)

    const pricing =
      typeof this.deps.imageRequestPricing === 'function'
        ? this.deps.imageRequestPricing(provider, model)
        : undefined
    const estimate = estimateProjectedRequest({
      messages: projectedTools.messages,
      tools: projectedTools.tools ?? tools,
      system: options.system,
      pricing,
    })
    const judgment = judgeEstimate({
      estimate: estimate.tokens,
      modelInfo,
      optionsMaxTokens: options.maxTokens,
      marginRatio: this.deps.marginRatio,
    })

    return {
      record: options,
      sessionId: match.sessionId,
      store,
      calibration: {
        sessionId: match.sessionId,
        mode: this.deps.mode,
        provider: provider === '' ? '(unknown)' : provider,
        model: model === '' ? '(unknown)' : model,
        estimate: estimate.tokens,
        ...(judgment.window !== undefined ? { window: judgment.window } : {}),
        ...(judgment.triggerLine !== undefined ? { triggerLine: judgment.triggerLine } : {}),
        marginRatio: this.deps.marginRatio,
        projector: projector.projector,
        imagePricing: estimate.imagePricing,
        imageCount: estimate.imageCount,
        hit: judgment.hit,
        time: Date.now(),
      },
    }
  }

  /**
   * Pass-through wrapper: yields every chunk unchanged (zero-mutation pin
   * covers this path), watches the usage + finish chunks, and absorbs the
   * calibration record when the stream settles. Abort/throw safety: the
   * error rethrows; the record lands in the finally with an honest outcome.
   * @internal
   */
  private async *calibrateWrap(
    judged: JudgedRequest,
    next: () => AsyncIterable<unknown>,
  ): AsyncIterable<unknown> {
    let usage: PreflightCalibrationRecord['usage'] | undefined
    let finishKind: string | undefined
    let threw: 'error' | 'aborted' | undefined
    try {
      for await (const chunk of next()) {
        if (isRecord(chunk)) {
          if (chunk.type === 'usage' && isRecord(chunk.usage)) usage = extractUsage(chunk.usage)
          if (chunk.type === 'finish' && isRecord(chunk.reason) && typeof chunk.reason.kind === 'string') {
            finishKind = chunk.reason.kind
          }
        }
        yield chunk
      }
    } catch (error: unknown) {
      threw = isRecord(judged.record.signal) && judged.record.signal.aborted === true ? 'aborted' : 'error'
      throw error // rethrow: never swallow stream failures or aborts
    } finally {
      const outcome =
        threw !== undefined
          ? threw
          : finishKind === 'error' || finishKind === 'aborted'
            ? (finishKind as 'error' | 'aborted')
            : usage !== undefined ? 'completed' : 'no-usage'
      this.sink(judged.store, { ...judged.calibration, outcome, ...(usage !== undefined ? { usage } : {}) })
    }
  }

  /** Memoized per-route model info (bounded, negative results cached; V2-C design). */
  private resolveModelInfoCached(provider: string, model: string): Promise<HostModelInfoLike | undefined> {
    if (provider === '' || model === '' || typeof this.deps.resolveModelInfo !== 'function') {
      return Promise.resolve(undefined)
    }
    const key = `${provider}\u0000${model}`
    let entry = this.modelInfoCache.get(key)
    if (entry === undefined) {
      entry = this.deps.resolveModelInfo(provider, model).catch(() => undefined)
      if (this.modelInfoCache.size >= PreflightListener.MODEL_INFO_CACHE_CAP) {
        const oldest = this.modelInfoCache.keys().next()
        if (!oldest.done) this.modelInfoCache.delete(oldest.value)
      }
      this.modelInfoCache.set(key, entry)
    }
    return entry
  }

  /** Fail-soft sink: a store fault warns once and never breaks the stream. @internal */
  private sink(store: PreflightStoreAccess, record: PreflightCalibrationRecord): void {
    try {
      store.absorbPreflightCalibration(record)
    } catch (error: unknown) {
      if (!this.warnedSinkFault) {
        this.warnedSinkFault = true
        this.deps.logger?.warn?.(
          `dsh-zcontext: preflight calibration sink failed (${error instanceof Error ? error.message : String(error)}); calibration stays off until restart`,
        )
      }
    }
  }
}

/** Extract the usage fields honestly (absence stays absent). */
function extractUsage(usage: Record<string, unknown>): PreflightCalibrationRecord['usage'] {
  const num = (value: unknown): number | undefined =>
    typeof value === 'number' && Number.isFinite(value) ? value : undefined
  return {
    ...(num(usage.inputTokens) !== undefined ? { inputTokens: num(usage.inputTokens) } : {}),
    ...(num(usage.outputTokens) !== undefined ? { outputTokens: num(usage.outputTokens) } : {}),
    ...(num(usage.totalTokens) !== undefined ? { totalTokens: num(usage.totalTokens) } : {}),
    ...(num(usage.cacheReadTokens) !== undefined ? { cacheReadTokens: num(usage.cacheReadTokens) } : {}),
    ...(num(usage.cacheWriteTokens) !== undefined ? { cacheWriteTokens: num(usage.cacheWriteTokens) } : {}),
  }
}

/**
 * The synthesized terminal finish chunk for an enforce hit (official chunk
 * protocol, llm/src/types.ts:452-464 + FinishReasonMap :156-163 + LlmFailure
 * :41-62 — read directly, not from memory). No usage chunk precedes it (no
 * usage exists), no chunk follows it.
 */
export function buildPreflightErrorFinish(calibration: Omit<PreflightCalibrationRecord, 'outcome' | 'usage'>): unknown {
  const line =
    calibration.triggerLine !== undefined
      ? `triggerLine ${calibration.triggerLine}`
      : 'unresolvable trigger line'
  return {
    type: 'finish',
    reason: {
      kind: 'error',
      failure: {
        message:
          `dsh-zcontext preflight: estimated request context ~${calibration.estimate} tokens exceeds `
          + `the calibrated hit line (${line} × margin ${calibration.marginRatio} = `
          + `${calibration.triggerLine !== undefined ? Math.ceil(calibration.triggerLine * calibration.marginRatio) : 'n/a'} `
          + `of window ${calibration.window ?? 'unknown'}); the official compaction overflow recovery owns the retry`,
        code: PREFLIGHT_CONTEXT_WINDOW_EXCEEDED_CODE,
      },
    },
  }
}
