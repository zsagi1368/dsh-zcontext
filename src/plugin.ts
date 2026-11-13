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
 *   - `llm/stream` (outer)  → the S1 preflight listener (v0.2.0 V4,
 *     RES-adapter-route §11b S1): estimates the request's context before the
 *     wire; mode 'observe' (DEFAULT) only records the calibration ledger
 *     (estimate vs the real usage that follows), mode 'enforce' (opt-in,
 *     R2) short-circuits a hit with the official CONTEXT_WINDOW_EXCEEDED
 *     finish so the compaction recovery chain takes over; mode 'off'
 *     registers nothing.
 *   - `llm/stream` (inner)  → the read-only cache-observe listener (v0.2.0
 *     V2, RES-observe-route a.2/a.3): per-attempt request snapshots +
 *     prefix-break classification land in the per-session store's
 *     process-memory ledgers; attemptCapture is opt-in (`observe.attemptCapture`).
 *     Strictly observational — never short-circuits (the preflight listener
 *     above is the only short-circuiting face).
 *
 * The nudge context provider is a PURE function of (pressure, budget,
 * ranges): it contributes '' (nothing on the wire) unless a threshold was
 * crossed since the last evaluation — the 跨越计次重付 cache model. It
 * consumes the official AssembleContext (W4-4): when the assembly carries the
 * agent's session the evaluation is attributed to that session (per-session
 * pressure), falling back to the most recently created session otherwise.
 * The context window is resolved asynchronously from the routed model info and
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

import {
  assertZctxProvidersResolvable,
} from './adapter/providers.ts'
import type { ResolvedZctxProvider } from './adapter/providers.ts'
import { createZctxAdapterClass } from './adapter/zctx-adapter.ts'
import { loadAdapterFaces, loadSupportedProtocols } from './adapter/host.ts'
import { computeBudget } from './budget.ts'
import { buildZctxCommand } from './command.ts'
import { configDefaults, configSchema } from './config.ts'
import type { ConfigSchemaLike, ZcontextConfig } from './config.ts'
import { CCM_MIN_CONTEXT_WINDOW, foldableRanges } from './fold-engine.ts'
import { buildGuidanceSection } from './guidance.ts'
import { nudgeContextText } from './nudge.ts'
import { ObserveListener } from './observe.ts'
import type { ObserveStoreAccess } from './observe.ts'
import { PreflightListener } from './preflight.ts'
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
import type {
  MeterAnchorLike,
  SessionEventLike,
  SessionLike,
  ValidatorConfig,
} from './types.ts'

/** Service name the plugin registers under. */
const SERVICE_NAME = 'dsh-zcontext'

/** Nudge context registration metadata (official PromptContext subset). */
export const NUDGE_CONTEXT_NAME = 'zctx-nudge'

/** Nudge context join order (after core layers, before the guidance section). */
export const NUDGE_CONTEXT_ORDER = 800

/**
 * Structural subset of the official `AssembleContext` the PromptContext.text
 * provider receives (system-prompt/src/index.ts:42-50 and :85 —
 * `text: string | ((context: AssembleContext) => string)`). The official
 * host builds it through `assembleContextFor` (agent/src/dispatch.ts:174)
 * as `{ agent, scope: agent, signal }`, and the Agent exposes its Session
 * (agent-loop/src/agent.ts:127) — so the nudge provider can attribute the
 * assembly to ITS session when the context is reachable.
 */
export interface AssembleContextLike {
  /** The agent the assembly is for (official scope === agent). */
  readonly agent?: { readonly session?: unknown }
  /** Scope key of the assembly (officially the same Agent object). */
  readonly scope?: { readonly session?: unknown }
  /** Turn control signal (present but unused by this provider). */
  readonly signal?: unknown
}

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
  /** The observe face's listener; undefined when the face is off (config or capability). */
  private observe: ObserveListener | undefined
  /** The S1 preflight face's listener; undefined when preflightMode is 'off'. */
  private preflight: PreflightListener | undefined
  /**
   * The S2 adapter face's registration continuation (undefined when the face
   * gated off synchronously). The constructor is synchronous (cordis), so
   * the async registration is a tracked continuation: failures log honestly
   * inside, never throw — and tests/status can await the settled state.
   */
  adapterRegistration: Promise<void> | undefined
  private warnedWindowFailure = false

  constructor(ctx: HostContextLike, config: Partial<ZcontextConfig> = {}) {
    super(ctx, SERVICE_NAME)
    this.ctx = ctx
    this.config = Object.freeze<ZcontextConfig>({ ...configDefaults, ...config })
    this.runtime = {
      logger: ctx.logger,
      tokenMeter: ctx.tokenMeter,
      llm: ctx.llm,
      cleanSampleFloor: this.config.cleanSampleFloor,
      preflightMode: this.config.preflightMode,
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
    this.wireAdapterFace()
    this.wirePreflightFace()
    this.wireObserveFace()
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
      // The observe listener keeps per-session state keyed by session ID
      // (process memory); a disposed session's entry must not leak past the
      // session's lifetime (its store dies with the WeakMap key anyway).
      const id = (session as { id?: unknown }).id
      if (typeof id === 'string') this.observe?.forgetSession(id)
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
      // Official PromptContext.text contract: the provider receives the
      // assembly's AssembleContext (system-prompt/src/index.ts:85).
      text: (assembly: AssembleContextLike) => this.nudgeProvider(assembly),
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

  /**
   * The S1 preflight face (v0.2.0 V4, task card products 1-2;
   * RES-adapter-route §11b S1): a SECOND llm/stream waterfall listener that
   * estimates the request's context before the wire and, in enforce mode
   * only, short-circuits a hit with the official CONTEXT_WINDOW_EXCEEDED
   * finish (the official compaction overflow recovery chain owns the retry).
   *
   * Registered BEFORE the observe listener so it composes OUTERMOST (cordis
   * waterfall = outermost-first, vendor/cordis/src/events.ts:221-236): an
   * enforce short-circuit must suppress the entire downstream chain — no
   * adapter dispatch, no wire request, no observation cost. In observe mode
   * it calls next() like any listener and the calibration ledger (product 3)
   * builds.
   *
   * REDLINE R2: enforce is unreachable under the default configuration —
   * preflightMode defaults to 'observe' and only an explicit user setting
   * turns it on (pinned by test). REDLINE R3: the listener's deps carry NO
   * llm runtime — the ctx.llm.stream self-call is structurally unreachable.
   *
   * Same capability-probe discipline as the other faces: 'off' logs info,
   * a missing capability logs warn, and neither ever breaks boot.
   * @internal
   */
  private wirePreflightFace(): void {
    const { ctx } = this
    const mode = this.config.preflightMode
    if (mode === 'off') {
      ctx.logger?.info?.('dsh-zcontext: preflight face disabled by config (preflightMode=off)')
      return
    }
    if (typeof ctx.on !== 'function') {
      ctx.logger?.warn?.('dsh-zcontext: ctx.on unavailable — preflight face skipped (no bus to register the llm/stream listener on)')
      return
    }
    if (ctx.llm === undefined) {
      ctx.logger?.warn?.('dsh-zcontext: llm service unavailable — preflight face skipped (estimation rides the llm/stream waterfall)')
      return
    }
    const llm = ctx.llm
    // Capture the optional helper members once (capability-probed, `this`
    // bound to the runtime) so the deps surface carries exactly the narrow
    // functions and nothing else (R3).
    const fileText = typeof llm.fileRequestText === 'function' ? llm.fileRequestText.bind(llm) : undefined
    const imagePricing =
      typeof llm.imageRequestPricing === 'function' ? llm.imageRequestPricing.bind(llm) : undefined
    const listener = new PreflightListener({
      mode,
      marginRatio: this.config.preflightMarginRatio,
      resolveSession: (sessionId) => this.resolveWatchedSession(sessionId),
      storeFor: (session) => this.storeFor(session as SessionLike),
      // Official ModelInfo (context window source F6.2 + image gating
      // modalities); failures degrade inside the listener (bounded cache).
      resolveModelInfo: async (provider, model) => llm.resolveModelInfo(provider, model),
      // Adapter-dispatch-identical file handle text (F3.4) when the host
      // exposes it; absent → the projection's default resolver.
      fileRequestText: fileText,
      // Per-route image pricing (card: 计价 path); absent → constant reserve.
      imageRequestPricing: imagePricing,
      logger: ctx.logger,
    })
    this.preflight = listener
    ctx.on('llm/stream', listener.onStream)
  }

  /**
   * The S2 adapter face (v0.2.0 V5, task card product 1; RES-adapter-route
   * §11b 形态二): builds the zctx adapters over the fail-soft-loaded host
   * faces and registers them with the llm runtime
   * (`ctx.llm.registerAdapter`, F1.1 all-or-nothing; DUPLICATE_ADAPTER on any
   * route collision → the OFFICIAL conflict precedent applies — keep the
   * old route + error log, llm-pi-ai:310-316 — boot unaffected).
   *
   * Face gates, each honest and none boot-breaking (五面降级先例):
   *   - no providers declared (absent/empty section) → info, zero routes
   *     (legal keep-alive, F1.4).
   *   - llm runtime without registerAdapter → warn, skipped.
   *   - host lib / pi-ai unreachable (faces undefined) → info, skipped —
   *     the card constraint "宿主不可达→adapter 面整体不注册（fail-soft）".
   *   - config violations → the CONSTRUCTION fail-loud error (complete
   *     violation list, providers.ts) lands in a warn log, skipped — the
   *     adapter contract is fail-loud while boot stays fail-soft.
   *
   * The host faces load asynchronously, so the registration completes as a
   * fire-and-forget continuation after the synchronous constructor returns
   * (the warmWindow precedent); every failure inside logs and never throws.
   * @internal
   */
  private wireAdapterFace(): void {
    const { ctx } = this
    const declared = this.config.providers ?? []
    if (declared.length === 0) {
      ctx.logger?.info?.('dsh-zcontext: adapter face: no providers declared — zero routes registered (declare zctx providers under the "providers" settings section)')
      return
    }
    if (ctx.llm === undefined || typeof ctx.llm.registerAdapter !== 'function') {
      ctx.logger?.warn?.('dsh-zcontext: llm runtime without registerAdapter — adapter face skipped')
      return
    }
    const registerAdapter = ctx.llm.registerAdapter.bind(ctx.llm)
    const logger = ctx.logger
    this.adapterRegistration = (async () => {
      try {
        const faces = await loadAdapterFaces()
        if (faces === undefined) {
          logger?.info?.('dsh-zcontext: adapter face skipped — @deepseek-ai/dsh-llm or @earendil-works/pi-ai is not reachable from this install (fail-soft; boot unaffected)')
          return
        }
        const { protocols, source } = await loadSupportedProtocols()
        if (source === 'builtin') {
          logger?.info?.('dsh-zcontext: the official supportedProtocols() union is unreachable — validating families against the builtin protocol list')
        }
        let resolved: readonly ResolvedZctxProvider[]
        try {
          resolved = assertZctxProvidersResolvable({ providers: declared }, protocols)
        } catch (error: unknown) {
          // Fail-loud at the adapter contract: the COMPLETE violation list
          // reaches the log; boot continues without the face.
          logger?.warn?.(error instanceof Error ? error.message : String(error))
          return
        }
        const ZctxAdapter = createZctxAdapterClass(faces.host.LlmAdapter)
        const adapter = new ZctxAdapter({
          host: faces.host,
          piAi: faces.piAi,
          mapping: faces.mapping,
          providers: resolved,
          logger,
        })
        const routes = resolved.map((provider) => provider.route)
        const registration = registerAdapter(routes, adapter)
        logger?.info?.(
          `dsh-zcontext: adapter face registered ${routes.join(', ')} (mapping: ${faces.mapping.source})`,
        )
        void registration
      } catch (error: unknown) {
        logger?.warn?.(
          `dsh-zcontext: adapter face registration failed (${error instanceof Error ? error.message : String(error)}); boot continues without it`,
        )
      }
    })()
  }

  /**
   * The llm/stream observe face (v0.2.0 V2): a strictly read-only waterfall
   * listener whose per-attempt request snapshots + prefix-break records land
   * in the per-session store's process-memory ledgers (the store's
   * absorbRequestSnapshot / absorbCapturedAttemptUsage receive ports).
   *
   * Same capability-probe discipline as the five faces above: a deliberate
   * config switch logs info, a missing capability logs warn, and neither
   * ever breaks boot. The face needs BOTH the event bus (the registration
   * surface — official hosts register via `ctx.on('llm/stream', …)`, see the
   * llm Events declaration at llm/src/index.ts:76-78) AND the llm runtime
   * (the waterfall owner: without it no `llm/stream` event ever fires).
   * @internal
   */
  private wireObserveFace(): void {
    const { ctx } = this
    if (!this.config['observe.enabled']) {
      ctx.logger?.info?.('dsh-zcontext: observe face disabled by config (observe.enabled=false)')
      return
    }
    if (typeof ctx.on !== 'function') {
      ctx.logger?.warn?.('dsh-zcontext: ctx.on unavailable — observe face skipped (no bus to register the llm/stream listener on)')
      return
    }
    if (ctx.llm === undefined) {
      ctx.logger?.warn?.('dsh-zcontext: llm service unavailable — observe face skipped (cache observation rides the llm/stream waterfall)')
      return
    }
    const llm = ctx.llm
    const listener = new ObserveListener({
      resolveSession: (sessionId) => this.resolveWatchedSession(sessionId),
      // The per-session store registry is the single store authority: a
      // watched session's store is created lazily (the attach scan rebuilds
      // the header chain + reset ledger from history), so the snapshot and
      // exemption-window semantics hold from the FIRST observed request.
      storeFor: (session): ObserveStoreAccess | undefined => this.storeFor(session as SessionLike),
      // Official ModelInfo (modalities / toolUpdate capability) passes
      // through for the projection gating; failures degrade inside the
      // listener (cached undefined, warn-once sink discipline).
      resolveModelInfo: async (provider, model) => llm.resolveModelInfo(provider, model),
      logger: ctx.logger,
      attemptCapture: this.config['observe.attemptCapture'],
    })
    this.observe = listener
    ctx.on('llm/stream', listener.onStream)
  }

  /**
   * The observe listener's watched-session resolution (criterion 3): a
   * session ID maps to its live session object when the plugin saw the
   * session through the feed (official Session carries `id: SessionId`,
   * core/session/src/index.ts:420, and the agent loop fills
   * GenerateOptions.sessionId from it — agent-loop/src/agent.ts:718).
   * Unseen/disposed IDs resolve undefined → not watched.
   * @internal
   */
  private resolveWatchedSession(sessionId: string): SessionLike | undefined {
    for (const session of this.liveSessions) {
      const id = (session as { id?: unknown }).id
      if (typeof id === 'string' && id === sessionId) return session as SessionLike
    }
    return undefined
  }

  // -- runtime internals -----------------------------------------------------

  /** Per-session store registry: lazy create + attach (resume-restore scan). @internal */
  private storeFor(session: SessionLike): FoldStore {
    let store = this.stores.get(session as object)
    if (store === undefined) {
      store = new FoldStore()
      store.attach(session)
      // V3 config-owned thresholds + injected faces (never hardcoded):
      // the attribution time-window fallback (§Q4.2 rule 4) and the
      // meter-anchor interface for the `meterAnchored` semi path (§Q7.2
      // rule 2b — through INJECTION, the store stays host-import-free).
      store.setAttributionTimeWindowMs(this.config.attributionTimeWindowMs)
      store.setMeterAnchor(this.meterAnchorFor(session))
      this.stores.set(session as object, store)
    }
    return store
  }

  /**
   * The V3 meter-anchor interface over the official tokenMeter (§Q7.2 rule
   * 2b): for the request that produced the message at `seq`, the input-side
   * anchor is the summed route-priced tokens of the surface nodes positioned
   * BEFORE the message's own node (official TokenMeasurement.nodes,
   * token-meter/src/types.ts:31-56). Unavailable faces (no meter, no node
   * projection, node not on the current surface, non-positive sum, meter
   * fault) report undefined so the record stays honestly 'estimated'.
   * @internal
   */
  private meterAnchorFor(session: SessionLike): MeterAnchorLike | undefined {
    const meter = this.runtime.tokenMeter
    if (meter === undefined || typeof meter.measure !== 'function') return undefined
    return {
      inputAnchor: (seq: number): number | undefined => {
        try {
          const measurement = meter.measure(session)
          const nodes = measurement.nodes
          if (nodes === undefined) return undefined
          const index = nodes.findIndex((node) => node.seq === seq)
          if (index <= 0) return undefined // not on the surface, or nothing before it
          let sum = 0
          for (let i = 0; i < index; i += 1) sum += nodes[i]?.tokens ?? 0
          return Number.isFinite(sum) && sum > 0 ? sum : undefined
        } catch {
          return undefined
        }
      },
    }
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

  /** The most recently created live session. @internal */
  private currentSession(): SessionLike | undefined {
    let last: object | undefined
    for (const session of this.liveSessions) last = session
    return last as SessionLike | undefined
  }

  /**
   * The nudge context provider: '' unless a threshold was crossed since the
   * last evaluation (pure function of its inputs; suppressed = no-op on the
   * wire, B2). Below the CCM legal domain the automatic face stays off.
   *
   * Session attribution (W4-4): when the official AssembleContext carries a
   * session (`assembleContextFor` passes the Agent as both `agent` and
   * `scope`, and `Agent.session` is the session — agent-loop/src/agent.ts:127),
   * the evaluation is attributed to THAT session, so multi-session hosts get
   * per-session pressure instead of cross-assembly contamination. The
   * globally-most-recent-session fallback remains for hosts that invoke the
   * provider without a reachable context — a documented limitation there, not
   * a correctness claim.
   */
  private nudgeProvider(assembly?: AssembleContextLike): string {
    try {
      const fromAgent = assembly?.agent?.session
      const fromScope = assembly?.scope?.session
      const attributed =
        fromAgent !== null && typeof fromAgent === 'object'
          ? (fromAgent as SessionLike)
          : fromScope !== null && typeof fromScope === 'object'
            ? (fromScope as SessionLike)
            : undefined
      const session = attributed ?? this.currentSession()
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
