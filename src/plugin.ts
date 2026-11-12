/**
 * dsh-zcontext plugin — the W4 wiring (task card W4 §2).
 *
 * `ZcontextPlugin` extends the cordis `Service` base through the PEER
 * STRUCTURAL contract: the host's `@deepseek-ai/cordis` is required lazily
 * at load time and, when absent, a local structural shim with the same
 * `(ctx, name)` constructor surface takes over — the class always loads
 * (fail-soft, plan §3: "cordis 只类型引用 + lazy require").
 *
 * Faces registered when `enabled` (default true), each behind a capability
 * probe (AutoPilot probes mode): a missing host service skips its face with
 * a log line and never breaks boot —
 *
 *   - `session/event` feed  → maintains per-session FoldStores + window cache
 *   - `ctx.tools.register`  → the four zctx tools (defineTool-wrapped, S3/S8)
 *   - `systemPrompt.section`→ the static byte-stable guidance (S10, no complete)
 *   - `systemPrompt.context`→ the threshold nudge with **required: true** (B2:
 *     survives the official suppressRuntimeContext filter that drops
 *     non-required contributions, system-prompt/src/index.ts:627-628)
 *   - `commands.register`   → the `/zctx` command
 *
 * The nudge context provider is a PURE function of (pressure, budget,
 * ranges): it contributes '' (nothing on the wire) unless a threshold was
 * crossed since the last evaluation — the 跨越计次重付 cache model. The
 * context window is resolved asynchronously from the routed model info and
 * cached per session; without it the provider contributes nothing honestly.
 * Below the CCM legal domain (W < 32768) the whole automatic face stays off
 * (engine-layer gate; tools remain usable).
 *
 * Zero independent storage: per-session FoldStores attach lazily on first
 * use (the blessed resume-restore scan) and are maintained from the feed.
 *
 * @module plugin
 */

import { createRequire } from 'node:module'

import { computeBudget } from './budget.ts'
import { buildZctxCommand } from './command.ts'
import { configDefaults, configSchema } from './config.ts'
import type { ConfigSchemaLike, ZcontextConfig } from './config.ts'
import { CCM_MIN_CONTEXT_WINDOW, foldableRanges } from './fold-engine.ts'
import { buildGuidanceSection } from './guidance.ts'
import { nudgeContextText } from './nudge.ts'
import { FoldStore } from './store.ts'
import {
  buildZctxTools,
  resolveDefineTool,
  routedRequestTarget,
} from './tools.ts'
import type {
  LoggerLike,
  LlmRuntimeLike,
  TokenMeterLike,
  ZctxToolRuntime,
} from './tools.ts'
import type { SessionEventLike, SessionLike, ValidatorConfig } from './types.ts'

/** Service name the plugin registers under. */
const SERVICE_NAME = 'dsh-zcontext'

/** Nudge context registration metadata (official PromptContext subset). */
export const NUDGE_CONTEXT_NAME = 'zctx-nudge'

/** Nudge context join order (after core layers, before the guidance section). */
export const NUDGE_CONTEXT_ORDER = 800

// ---------------------------------------------------------------------------
// Structural host context + Service base (cordis peer, lazy require).
// ---------------------------------------------------------------------------

/**
 * Structural host context handed over by the cordis container. Every member
 * is optional: consumers capability-probe and degrade (plan §4).
 */
export interface HostContextLike {
  readonly logger?: LoggerLike
  readonly tools?: {
    register?(definition: unknown): unknown
  }
  readonly systemPrompt?: {
    section?(spec: unknown): unknown
    context?(spec: unknown): unknown
  }
  readonly commands?: {
    register?(definition: unknown): unknown
  }
  readonly tokenMeter?: TokenMeterLike
  readonly llm?: LlmRuntimeLike
  /** Cordis reflection (present on real contexts; probed by the Service base). */
  readonly reflect?: {
    provide?(name: string, value: unknown): unknown
  }
  /** Cordis event subscription; returns a disposer on real contexts. */
  on?(event: string, listener: (...args: never[]) => unknown): unknown
}

/** Instance surface the Service base guarantees. */
interface ServiceInstance {
  ctx: unknown
  name: string
}

/** Constructor surface of the cordis Service base (structural). */
type ServiceCtor = new (ctx: HostContextLike, name: string) => ServiceInstance

/**
 * Fail-soft structural mirror of the cordis Service base: stores ctx/name
 * without registering on a reflection service (used when the host package is
 * not resolvable from this module).
 */
class StructuralServiceShim implements ServiceInstance {
  readonly ctx: unknown
  readonly name: string
  constructor(ctx: HostContextLike, name: string) {
    this.ctx = ctx
    this.name = name
  }
}

const nodeRequire = createRequire(import.meta.url)

/** Resolve the host's cordis Service lazily; undefined keeps loading fail-soft. */
function loadCordisService(): ServiceCtor | undefined {
  try {
    const mod = nodeRequire('@deepseek-ai/cordis') as { Service?: unknown }
    return typeof mod?.Service === 'function' ? (mod.Service as ServiceCtor) : undefined
  } catch {
    return undefined
  }
}

/** The Service base this plugin extends: the host's real one when resolvable. */
const ServiceBase: ServiceCtor = loadCordisService() ?? StructuralServiceShim

/** Parse "25,50,75,90" into ascending threshold numbers (invalid entries dropped). */
export function parseThresholds(spec: string): number[] {
  const seen = new Set<number>()
  for (const part of spec.split(',')) {
    const value = Number(part.trim())
    if (Number.isFinite(value) && value >= 0 && value <= 100) seen.add(value)
  }
  return [...seen].sort((a, b) => a - b)
}

// ---------------------------------------------------------------------------
// The plugin class.
// ---------------------------------------------------------------------------

/**
 * The dsh-zcontext plugin (cordis class plugin, constructed with
 * `(ctx, config)`; config validated through the static Config schema).
 */
export class ZcontextPlugin extends ServiceBase {
  static inject: string[] = []
  static Config: ConfigSchemaLike = configSchema

  /** Host context (structural duck-type; capability-probed per face). */
  readonly ctx: HostContextLike

  /** Resolved plugin configuration (plan §3 contract). */
  readonly config: Readonly<ZcontextConfig>

  private readonly stores = new WeakMap<object, FoldStore>()
  private readonly windowCache = new WeakMap<object, number>()
  private readonly lastPressure = new WeakMap<object, number>()
  private readonly liveSessions = new Set<object>()
  private readonly runtime: ZctxToolRuntime
  private warnedWindowFailure = false

  constructor(ctx: HostContextLike, config: Partial<ZcontextConfig> = {}) {
    super(ctx, SERVICE_NAME)
    this.ctx = ctx
    this.config = Object.freeze<ZcontextConfig>({ ...configDefaults, ...config })
    this.runtime = {
      logger: ctx.logger,
      tokenMeter: ctx.tokenMeter,
      llm: ctx.llm,
      storeFor: (session) => this.storeFor(session),
      validatorConfig: (session) => this.validatorConfig(session),
    }

    if (!this.config.enabled) {
      ctx.logger?.info?.('dsh-zcontext: disabled by config — staying passive (official compaction remains the hard floor)')
      return
    }
    this.wireSessionFeed()
    this.wireToolFace()
    this.wireGuidanceFace()
    this.wireNudgeFace()
    this.wireCommandFace()
  }

  // -- face wiring -----------------------------------------------------------

  /** session/event feed: maintain live stores + warm the window cache. @internal */
  private wireSessionFeed(): void {
    const { ctx } = this
    if (typeof ctx.on !== 'function') {
      ctx.logger?.warn?.('dsh-zcontext: ctx.on unavailable — session feed face skipped (stores attach lazily on first use)')
      return
    }
    ctx.on('session/created', (session: unknown) => {
      this.liveSessions.add(session as object)
      void this.warmWindow(session as SessionLike)
    })
    ctx.on('session/disposed', (session: unknown) => {
      this.liveSessions.delete(session as object)
    })
    ctx.on('session/event', (session: unknown, event: unknown) => {
      const s = session as SessionLike
      const store = this.stores.get(s)
      if (store !== undefined) store.onEvent(s, event as SessionEventLike)
      if ((event as SessionEventLike).type === 'assistant/message') {
        void this.warmWindow(s)
      }
    })
  }

  /** The four zctx tools (defineTool-wrapped; S8: no isConcurrencySafe). @internal */
  private wireToolFace(): void {
    const { ctx } = this
    if (typeof ctx.tools?.register !== 'function') {
      ctx.logger?.warn?.('dsh-zcontext: tools service unavailable — tool face skipped')
      return
    }
    const defineTool = resolveDefineTool()
    for (const definition of buildZctxTools(defineTool, this.runtime)) {
      ctx.tools.register(definition)
    }
  }

  /** The static byte-stable guidance section (S10: never sets complete). @internal */
  private wireGuidanceFace(): void {
    const { ctx } = this
    if (typeof ctx.systemPrompt?.section !== 'function') {
      ctx.logger?.warn?.('dsh-zcontext: systemPrompt.section unavailable — guidance face skipped')
      return
    }
    ctx.systemPrompt.section(buildGuidanceSection())
  }

  /** The threshold nudge context with required: true (B2). @internal */
  private wireNudgeFace(): void {
    const { ctx } = this
    if (typeof ctx.systemPrompt?.context !== 'function') {
      ctx.logger?.warn?.('dsh-zcontext: systemPrompt.context unavailable — nudge face skipped')
      return
    }
    ctx.systemPrompt.context({
      name: NUDGE_CONTEXT_NAME,
      order: NUDGE_CONTEXT_ORDER,
      interpolate: false,
      required: true,
      text: () => this.nudgeProvider(),
    })
  }

  /** The /zctx command. @internal */
  private wireCommandFace(): void {
    const { ctx } = this
    if (typeof ctx.commands?.register !== 'function') {
      ctx.logger?.warn?.('dsh-zcontext: commands service unavailable — command face skipped')
      return
    }
    ctx.commands.register(buildZctxCommand(this.runtime))
  }

  // -- runtime internals -----------------------------------------------------

  /** Per-session store registry: lazy create + attach (resume-restore scan). @internal */
  private storeFor(session: SessionLike): FoldStore {
    let store = this.stores.get(session as object)
    if (store === undefined) {
      store = new FoldStore()
      store.attach(session)
      this.stores.set(session as object, store)
    }
    return store
  }

  /** Validator config for one session (context window from the cache when known). @internal */
  private validatorConfig(session: SessionLike): ValidatorConfig {
    const window = this.windowCache.get(session as object)
    return {
      keepRecentMessages: 0,
      keepRecentTokens: this.config.keepRecentTokens,
      protectionFloorTokens: this.config.protectionFloorTokens,
      minFoldableTokens: this.config.minFoldableTokens,
      maxFoldFraction: this.config.maxFoldFraction,
      summaryFloorChars: this.config.summaryFloorChars,
      summaryCeilingChars: this.config.summaryCeilingChars,
      netShrinkTolerance: this.config.netShrinkTolerance,
      ...(window !== undefined ? { contextWindow: window } : {}),
    }
  }

  /**
   * Resolve and cache the routed model's context window (fire-and-forget;
   * failures degrade honestly — one warn per plugin, never per request).
   */
  private async warmWindow(session: SessionLike): Promise<void> {
    if (this.windowCache.has(session as object)) return
    const llm = this.runtime.llm
    if (llm === undefined || typeof llm.resolveModelInfo !== 'function') return
    const routed = routedRequestTarget(session)
    if (routed === undefined) return
    try {
      const info = await llm.resolveModelInfo(routed.provider, routed.model)
      const window = info?.context?.contextWindow
      if (typeof window === 'number' && Number.isFinite(window) && window > 0) {
        this.windowCache.set(session as object, window)
      }
    } catch (error: unknown) {
      if (!this.warnedWindowFailure) {
        this.warnedWindowFailure = true
        this.ctx.logger?.warn?.(
          `dsh-zcontext: model info resolution failed (${error instanceof Error ? error.message : String(error)}); nudge/status stay degraded until it succeeds`,
        )
      }
    }
  }

  /** The most recently created live session (single-session assumption, honest). @internal */
  private currentSession(): SessionLike | undefined {
    let last: object | undefined
    for (const session of this.liveSessions) last = session
    return last as SessionLike | undefined
  }

  /**
   * The nudge context provider: '' unless a threshold was crossed since the
   * last evaluation (pure function of its inputs; suppressed = no-op on the
   * wire, B2). Below the CCM legal domain the automatic face stays off.
   */
  private nudgeProvider(): string {
    try {
      const session = this.currentSession()
      if (session === undefined) return ''
      const window = this.windowCache.get(session as object)
      // Unknown window: cannot judge pressure honestly → no contribution.
      // Below the CCM domain: the automatic folding face is disabled.
      if (window === undefined || window < CCM_MIN_CONTEXT_WINDOW) return ''
      const meter = this.runtime.tokenMeter
      if (meter === undefined) return ''
      const measurement = meter.measure(session)
      const pressurePct = (measurement.totalTokens / window) * 100
      const prev = this.lastPressure.get(session as object) ?? 0
      this.lastPressure.set(session as object, pressurePct)

      const header = (session as { requestHeader?(): { config?: { maxTokens?: number } } }).requestHeader?.()
      const configuredMax = header?.config?.maxTokens
      const budget = computeBudget({
        contextWindow: window,
        ...(typeof configuredMax === 'number' && configuredMax > 0 ? { maxOutput: configuredMax } : {}),
      })
      const ranges = foldableRanges(
        this.storeFor(session).surfaceNodes(),
        this.validatorConfig(session),
      )
      return nudgeContextText(prev, pressurePct, parseThresholds(this.config.nudgeThresholds), budget, ranges)
    } catch (error: unknown) {
      this.ctx.logger?.warn?.(
        `dsh-zcontext: nudge evaluation failed (${error instanceof Error ? error.message : String(error)}); contributing nothing this assembly`,
      )
      return ''
    }
  }
}
