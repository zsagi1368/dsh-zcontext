/**
 * observe.ts — the llm/stream waterfall listener (v0.2.0 V2, task card
 * product 2; RES-observe-route a.2 item 2 + a.3).
 *
 * READ-ONLY DISCIPLINE (the hard contract this module lives under): the
 * listener never short-circuits (it always calls `next()` and yields its
 * stream through untouched — short-circuiting is the V4 preflight boundary),
 * never rewrites the request in place (the frozen object tree is hashed via
 * non-mutating projections only — the harness's own rewrite mode is
 * replace-the-reference, and this listener does not even do that), and
 * writes NOTHING to host or session state. Its only side effects are the
 * injected process-memory sinks (snapshot + captured-attempt ledgers owned
 * by the store), wrapped fail-soft so an observation fault can never break
 * a real request. Abort safety: the pass-through rethrows stream failures
 * and propagates consumer early-return into `next()`'s iterator.
 *
 * Main-chain four criteria (RES-observe-route §Q8.1, per attempt):
 *   1. isAgentLoopRequest — official WeakSet identity via the optional host
 *      import; the labeled structural heuristic when the host is absent;
 *   2. purpose absent — compaction/session-title one-shots excluded;
 *   3. sessionId matches the listener's watched session set (resolved
 *      through the injected session registry);
 *   4. not in the exemption window — the FIRST main-chain request after a
 *      reset-ledger entry is exempt (guardian seq-exemption semantics,
 *      cache-guardian.ts:500-505): its snapshot would only re-record the
 *      reset that the reset ledger already explains.
 *
 * Per attempt the listener builds a RequestSnapshot (per-message
 * stableStringify+sha256 over the normalized request, systemHash, toolsHash,
 * attemptSeq, purpose/isLoop) and hands it to the injected snapshot sink.
 * The ~20-line prefix-monotonic mechanical piece compares consecutive
 * snapshots (length shrink / per-position break point) and classifies the
 * break against the reset-ledger entries consumed since the previous
 * snapshot — `reset-explained` or `unknown-break`, always
 * `domain: 'harness'` (pi-ai wire rewrites are a registered blind spot,
 * §Q5.2).
 *
 * Optional `attemptCapture` face (config observe.attemptCapture, DEFAULT
 * false): wraps `next()` and watches usage/finish chunks, capturing FAILED
 * attempts' usage into the non-durable ledger (session logs keep no
 * per-attempt usage for retried-away attempts, §Q8.2 item 2). The wrapper
 * only observes; every chunk is yielded unchanged and aborts rethrow.
 *
 * @module observe
 */

import { stableHash } from './hash.ts'
import {
  loadHostProjector,
  type HostModelInfoLike,
  type HostProjector,
  type RequestMessageLike,
  type ResolvePathLike,
  type ToolSchemaLike,
} from './host-llm.ts'
import type {
  CapturedAttemptUsage,
  PrefixBreakRecord,
  PrefixBreakResetRef,
  RequestSnapshot,
  ResetEvent,
} from './types.ts'

/** Structural accessors the listener needs from the per-session store (injected by the plugin). */
export interface ObserveStoreAccess {
  /** The cache-reset ledger, oldest first (exemption-window input). */
  resetEvents(): readonly ResetEvent[]
  /** The most recent request snapshot, when any (prefix-comparison baseline). */
  lastRequestSnapshot(): RequestSnapshot | undefined
  /** Snapshot sink: append to the process-memory snapshot ledger (+ break record when detected). */
  absorbRequestSnapshot(snapshot: RequestSnapshot, breakRecord?: PrefixBreakRecord): void
  /** Non-durable captured-attempt-usage sink (attemptCapture face). */
  absorbCapturedAttemptUsage(record: CapturedAttemptUsage): void
}

/** Dependencies injected from the plugin (no host imports inside this module). */
export interface ObserveDeps {
  /** Resolve one watched session id to its session object (criterion 3); undefined = not watched. */
  resolveSession(sessionId: string): unknown
  /** Per-session store accessors; undefined when the session has no bound store. */
  storeFor(session: unknown): ObserveStoreAccess | undefined
  /**
   * Model-info resolution for the projection gating (modalities / toolUpdate).
   * Optional: without it the listener degrades honestly — image projection
   * is skipped (official gating projects only for KNOWN image-less models)
   * and tool updates route as unsupported.
   */
  resolveModelInfo?(provider: string, model: string): Promise<HostModelInfoLike | undefined>
  /** Logger (optional; warn-once on sink faults). */
  logger?: { warn?(message: string): void; info?(message: string): void }
  /** attemptCapture face switch (config observe.attemptCapture; default false). */
  attemptCapture: boolean
}

/** Per-session listener state (process memory, keyed by session id). */
interface SessionObserveState {
  /**
   * Seq of the last reset-ledger entry consumed by an exempt request (V1-B
   * companion: the store's reset ledger is CAPPED (oldest dropped), so an
   * INDEX pointer would mis-align after a shift — the seq pointer stays
   * correct across cap eviction and attach rebuilds alike).
   */
  lastConsumedResetSeq: number | undefined
  /** Resets consumed since the previous snapshot — the next break's explanation. */
  explainedBy: PrefixBreakResetRef[] | undefined
  /** Gap-free attempt ordinal (only snapshotted requests increment). */
  attemptSeq: number
}

/** One stream plan: what the listener decided BEFORE touching the stream. */
interface StreamPlan {
  /** Raw options record (read-only; hashed fields are read again here). */
  record: Record<string, unknown>
  /** Session id (criterion 3 match). */
  sessionId: string
  /** Injected store accessors. */
  store: ObserveStoreAccess
  /** The snapshot's attempt ordinal (0 when the exempt window consumed the request). */
  attemptSeq: number
}

/** Async-iterator type of the waterfall `next()` (official StreamChunk stream). */
type NextStream = () => AsyncIterable<unknown>

/**
 * Bounded cap for the per-route model-info cache (V2-C closure, R3 review:
 * the cache was process-unbounded — negative results included — which broke
 * the plugin's 64-ledger bounded-memory discipline for no benefit). Insertion
 * order eviction drops the OLDEST route when the cap is hit; a live route is
 * re-resolved on its next request (one extra injected resolver call after 64
 * other routes passed through). 64 = the same cap value every plugin ledger
 * uses.
 */
const MODEL_INFO_CACHE_CAP = 64

/** The waterfall listener signature (official 'llm/stream' event face). */
export type ObserveStreamListener = (
  options: unknown,
  next: NextStream,
) => AsyncIterable<unknown>

/** Read a usage chunk's numeric fields honestly (absence stays absent). */
function extractUsageFields(usage: Record<string, unknown>): CapturedAttemptUsage['usage'] {
  const num = (value: unknown): number | undefined =>
    typeof value === 'number' && Number.isFinite(value) ? value : undefined
  const input = num(usage.inputTokens)
  const output = num(usage.outputTokens)
  const total = num(usage.totalTokens)
  const read = num(usage.cacheReadTokens)
  const write = num(usage.cacheWriteTokens)
  return {
    ...(input !== undefined ? { inputTokens: input } : {}),
    ...(output !== undefined ? { outputTokens: output } : {}),
    ...(total !== undefined ? { totalTokens: total } : {}),
    ...(read !== undefined ? { cacheReadTokens: read } : {}),
    ...(write !== undefined ? { cacheWriteTokens: write } : {}),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object'
}

/**
 * The prefix-monotonic mechanical piece (~20 lines): compare a snapshot
 * against its predecessor — length shrink and/or per-position break point.
 * Growth with an intact common prefix is the normal conversation walk and
 * records nothing. Returns undefined when there is no baseline or no break.
 *
 * DELIBERATE NARROWING (V2-B closure, R3 review; RES-observe-route a.3 as
 * written): the break domain is the MESSAGE LIST ONLY — `systemHash` and
 * `toolsHash` are collected on every snapshot but deliberately DO NOT
 * participate in break detection. System-section and toolset changes are the
 * reset ledger's territory (the `system-section-change` / `toolset-change` /
 * `sampling-change` classes classify them through request/header diffs, and
 * the exemption window excuses the first request after such a reset), and
 * pi-ai-domain system folding is a registered object-level blind spot
 * (§Q5.2) that a system/tools hash could never see either. Nothing here
 * should grow a frozen-segment comparison without reopening that spec
 * decision.
 */
export function detectPrefixBreak(
  prev: RequestSnapshot | undefined,
  next: RequestSnapshot,
  explainedBy: readonly PrefixBreakResetRef[] | undefined,
): PrefixBreakRecord | undefined {
  if (prev === undefined) return undefined
  const before = prev.perMessageHashes
  const after = next.perMessageHashes
  const common = Math.min(before.length, after.length)
  let breakIndex: number | undefined
  for (let i = 0; i < common; i += 1) {
    if (before[i] !== after[i]) {
      breakIndex = i
      break
    }
  }
  const mode =
    after.length < before.length ? 'length-shrink' : breakIndex !== undefined ? 'content-change' : undefined
  if (mode === undefined) return undefined
  const resetExplained = explainedBy !== undefined && explainedBy.length > 0
  return {
    domain: 'harness',
    sessionId: next.sessionId,
    attemptSeq: next.attemptSeq,
    prevAttemptSeq: prev.attemptSeq,
    ...(breakIndex !== undefined ? { breakIndex } : {}),
    mode,
    classification: resetExplained ? 'reset-explained' : 'unknown-break',
    ...(resetExplained ? { explainedBy } : {}),
    time: next.time,
  }
}

/**
 * The llm/stream observe listener. Construct once per plugin; register
 * `onStream` (bound) on the host's llm/stream waterfall.
 */
export class ObserveListener {
  private readonly deps: ObserveDeps
  private readonly stateBySession = new Map<string, SessionObserveState>()
  private readonly modelInfoCache = new Map<string, Promise<HostModelInfoLike | undefined>>()
  private projector: Promise<HostProjector> | undefined
  private warnedSinkFault = false

  constructor(deps: ObserveDeps) {
    this.deps = deps
  }

  /**
   * Resolve (and memoize) the projector; the plugin may await this once at
   * wire time to log which face went live. Never throws.
   */
  ensureProjector(): Promise<HostProjector> {
    this.projector ??= loadHostProjector()
    return this.projector
  }

  /**
   * The waterfall listener body. Bind/register via `onStream` (an instance
   * arrow property, immune to cordis's `this: LlmRuntime` invocation).
   */
  readonly onStream: ObserveStreamListener = (options: unknown, next: NextStream) =>
    this.handleStream(options, next)

  /** @internal */
  private async *handleStream(options: unknown, next: NextStream): AsyncIterable<unknown> {
    let plan: StreamPlan | undefined
    try {
      plan = await this.prepare(options)
    } catch {
      plan = undefined // observation must never break a real request
    }
    if (plan === undefined || !this.deps.attemptCapture) {
      // Plain read-only pass-through (+ snapshot already absorbed in prepare).
      yield* next()
      return
    }
    // attemptCapture face: observe chunks while passing them through.
    yield* this.captureWrap(plan, next)
  }

  /** Four criteria + snapshot build + break detection. @internal */
  private async prepare(options: unknown): Promise<StreamPlan | undefined> {
    if (!isRecord(options)) return undefined
    const projector = await this.ensureProjector()
    // Criterion 1: agent-loop identity (official WeakSet / labeled heuristic).
    if (!projector.isAgentLoopRequest(options)) return undefined
    // Criterion 2: one-shot exclusion (purpose-present requests never snapshot).
    if (options.purpose !== undefined) return undefined
    // Criterion 3: the request's session must be watched and store-bound.
    const sessionId = options.sessionId
    if (typeof sessionId !== 'string') return undefined
    const session = this.deps.resolveSession(sessionId)
    const store = this.deps.storeFor(session)
    if (store === undefined) return undefined
    const state = this.stateFor(sessionId)

    // Criterion 4: exemption window — the first main-chain request after a
    // reset is exempt; the consumed reset entries become the NEXT snapshot's
    // break explanation (the skipped request leaves the pre-reset baseline).
    // Consumption is a SEQ pointer (V1-B companion): the store's reset ledger
    // is capped with oldest-drop, so an index pointer would mis-align.
    const resets = store.resetEvents()
    const consumedThrough = state.lastConsumedResetSeq
    const pending =
      consumedThrough === undefined ? resets : resets.filter((reset) => reset.seq > consumedThrough)
    if (pending.length > 0) {
      state.lastConsumedResetSeq = pending[pending.length - 1].seq
      state.explainedBy = [
        ...(state.explainedBy ?? []),
        ...pending.map((reset) => ({ kind: reset.kind, seq: reset.seq })),
      ]
      return { record: options, sessionId, store, attemptSeq: 0 }
    }

    // Snapshot: attempt ordinal, normalized hashes, break vs the baseline.
    state.attemptSeq += 1
    const prev = store.lastRequestSnapshot()
    const provider = typeof options.provider === 'string' ? options.provider : '(unknown)'
    const model = typeof options.model === 'string' ? options.model : '(unknown)'
    const projection = await this.normalizeForHash(options, projector)
    const snapshot: RequestSnapshot = {
      sessionId,
      attemptSeq: state.attemptSeq,
      provider,
      model,
      perMessageHashes: projection.messages.map((message) => stableHash(message)),
      ...(projection.system !== undefined ? { systemHash: stableHash(projection.system) } : {}),
      ...(projection.tools !== undefined ? { toolsHash: stableHash(projection.tools) } : {}),
      isLoop: true,
      projector: projector.projector,
      time: Date.now(),
    }
    const breakRecord = detectPrefixBreak(prev, snapshot, state.explainedBy)
    state.explainedBy = undefined // consumed either way: only the next exempt refills it
    this.sink(() => store.absorbRequestSnapshot(snapshot, breakRecord))
    return { record: options, sessionId, store, attemptSeq: snapshot.attemptSeq }
  }

  /**
   * The a.3 normalization pipeline over the official projection exports
   * (exact semantics when the host is present; the labeled fallback twins
   * otherwise). Mirrors the official request assembly shape:
   *   1. files → handle text, UNCONDITIONAL (official: the projection is
   *      unconditional in request assembly); the resolver returns undefined
   *      — the V2 listener has no execution-world file access, and the
   *      resulting handle text stays deterministic per attachment ref;
   *   2. images → placeholders ONLY when the routed model's modalities are
   *      known and lack image (official gating; unknown modalities skip);
   *   3. tool updates → official routing with the resolved capability
   *      (undefined = unsupported route).
   * All projections are non-mutating: they return originals or copies and
   * never write into the frozen request tree.
   */
  private async normalizeForHash(
    options: Record<string, unknown>,
    projector: HostProjector,
  ): Promise<{ messages: readonly RequestMessageLike[]; tools: readonly ToolSchemaLike[] | undefined; system: unknown }> {
    const messages: readonly RequestMessageLike[] = Array.isArray(options.messages)
      ? (options.messages as RequestMessageLike[])
      : []
    const tools: readonly ToolSchemaLike[] | undefined = Array.isArray(options.tools)
      ? (options.tools as ToolSchemaLike[])
      : undefined
    const resolvePath: ResolvePathLike = () => undefined
    let projected = projector.projectFilesToText(messages, resolvePath)
    const modelInfo = await this.resolveModelInfoCached(
      typeof options.provider === 'string' ? options.provider : '',
      typeof options.model === 'string' ? options.model : '',
    )
    if (
      modelInfo?.inputModalities !== undefined
      && !modelInfo.inputModalities.includes('image')
      && messages.some((message) => isRecord(message) && contentHasType(message, 'image'))
    ) {
      projected = projector.projectImagesForTextModel(projected)
    }
    const toolUpdate = modelInfo?.toolUpdate
    const result = projector.projectToolUpdates(projected, tools, toolUpdate, options.toolHistory)
    return { messages: result.messages, tools: result.tools ?? tools, system: options.system }
  }

  /** Memoized per-route model info (negative results cached too; failures degrade to undefined). */
  private resolveModelInfoCached(provider: string, model: string): Promise<HostModelInfoLike | undefined> {
    if (provider === '' || model === '') return Promise.resolve(undefined)
    const key = `${provider}\u0000${model}`
    let entry = this.modelInfoCache.get(key)
    if (entry === undefined) {
      const resolver = this.deps.resolveModelInfo
      entry =
        resolver === undefined
          ? Promise.resolve(undefined)
          : resolver(provider, model).catch(() => undefined)
      // V2-C closure: bounded cache — drop the OLDEST route (insertion order)
      // when the cap is hit; the evicted route re-resolves on next use.
      if (this.modelInfoCache.size >= MODEL_INFO_CACHE_CAP) {
        const oldest = this.modelInfoCache.keys().next()
        if (!oldest.done) this.modelInfoCache.delete(oldest.value)
      }
      this.modelInfoCache.set(key, entry)
    }
    return entry
  }

  /** Per-session state map entry. @internal */
  private stateFor(sessionId: string): SessionObserveState {
    let state = this.stateBySession.get(sessionId)
    if (state === undefined) {
      state = { lastConsumedResetSeq: undefined, explainedBy: undefined, attemptSeq: 0 }
      this.stateBySession.set(sessionId, state)
    }
    return state
  }

  /**
   * Drop one session's listener state (the plugin wires this to the
   * session/disposed feed): the state is process memory keyed by session ID
   * and must not outlive the session it belongs to. The session's own store
   * dies with the host reference; this map is the only cross-session holder.
   */
  forgetSession(sessionId: string): void {
    this.stateBySession.delete(sessionId)
  }

  /** Fail-soft sink invocation: a store fault warns once and never breaks the stream. @internal */
  private sink(write: () => void): void {
    try {
      write()
    } catch (error: unknown) {
      if (!this.warnedSinkFault) {
        this.warnedSinkFault = true
        this.deps.logger?.warn?.(
          `dsh-zcontext: observe sink failed (${error instanceof Error ? error.message : String(error)}); observation stays off until restart`,
        )
      }
    }
  }

  /**
   * attemptCapture wrapper: yields every chunk unchanged, watches usage and
   * finish chunks, and records FAILED attempts' usage (finish error/aborted
   * or a thrown stream) into the non-durable ledger. Abort safety: the
   * wrapper rethrows, and consumer early-return closes `next()`'s iterator
   * through the for-await contract.
   * @internal
   */
  private async *captureWrap(plan: StreamPlan, next: NextStream): AsyncIterable<unknown> {
    const inner = next()
    let lastUsage: Record<string, unknown> | undefined
    let finishKind: string | undefined
    let threw = false
    try {
      for await (const chunk of inner) {
        if (isRecord(chunk)) {
          if (chunk.type === 'usage' && isRecord(chunk.usage)) lastUsage = chunk.usage
          if (chunk.type === 'finish' && isRecord(chunk.reason) && typeof chunk.reason.kind === 'string') {
            finishKind = chunk.reason.kind
          }
        }
        yield chunk
      }
    } catch (error: unknown) {
      threw = true
      throw error // rethrow: the listener never swallows stream failures or aborts
    } finally {
      const failed = threw || finishKind === 'error' || finishKind === 'aborted'
      if (failed && lastUsage !== undefined) {
        const outcome: 'error' | 'aborted' = threw
          ? isRecord(plan.record.signal) && plan.record.signal.aborted === true
            ? 'aborted'
            : 'error'
          : (finishKind as 'error' | 'aborted')
        const record: CapturedAttemptUsage = {
          sessionId: plan.sessionId,
          attemptSeq: plan.attemptSeq,
          provider: typeof plan.record.provider === 'string' ? plan.record.provider : '(unknown)',
          model: typeof plan.record.model === 'string' ? plan.record.model : '(unknown)',
          usage: extractUsageFields(lastUsage),
          outcome,
          nonDurable: true,
          time: Date.now(),
        }
        this.sink(() => plan.store.absorbCapturedAttemptUsage(record))
      }
    }
  }
}

/** True when the message's typed content contains a block of the given type. */
function contentHasType(message: RequestMessageLike, type: string): boolean {
  const content = message.content
  if (!Array.isArray(content)) return false
  return content.some(
    (block) => isRecord(block) && block.type === type,
  )
}
