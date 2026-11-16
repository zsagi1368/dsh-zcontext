/**
 * guard-observe-bridge — the plugin's log-only consumer of the patched
 * base-context chain's `cache/guard-observe` session events (task card P6-C;
 * plan ZCTX-v03-patch-plan; RES-port-feasibility §0.4/§2.8). The patched
 * official bundles (patcher/zctx-patch.mjs v0.2, patch set zctx-v0.3-base-1)
 * append one log-only event per wire attempt (observe-only, D1P2 §1.1 — the
 * interception half does not exist in any tree). This bridge rides the
 * plugin's existing `session/event` firehose listener and maintains a
 * process-memory summary per session: counts, the classification mix, and
 * the last record's identity facts for zctx_status.
 *
 * LOG-ONLY DISCIPLINE: the consumer writes NOTHING to host or session state,
 * never throws into the firehose (fail-soft warn-once), and keeps per-session
 * state keyed by session id (forgotten on session/disposed, same discipline
 * as the observe listener). Events only EXIST when the patch is applied and
 * its `guardObserve` switch is on — an unpatched install produces zero calls,
 * so this module is inert there by construction (the `patch.guardObserveEvents`
 * config switch is the plugin-side opt-out).
 *
 * @module guard-observe-bridge
 */

/** Structural view of one `cache/guard-observe` event (loose — validated). */
export interface GuardObserveEventLike {
  readonly seq?: unknown
  readonly data?: unknown
}

/** The facts one record contributes to the summary (all validated loose). */
interface GuardRecordFacts {
  readonly segmented: boolean
  readonly degraded: boolean
  readonly unclassified: boolean
  readonly classId?: string
  readonly monotonic?: string
  readonly provider?: string
  readonly modelId?: string
}

/** Process-memory summary of one session's guard-observe records. */
export interface GuardObserveSummary {
  /** Total records observed (every wire attempt appended by the patched chain). */
  readonly total: number
  /** Records carrying a full three-segment capture. */
  readonly segmented: number
  /** A7 degraded captures / whole-package fallbacks (no chain participation). */
  readonly degraded: number
  /** Records the classifier could not label (D1P2 §8.2 — visible + searchable). */
  readonly unclassified: number
  /** The last record's session-log seq, when readable. */
  readonly lastSeq?: number
  /** The last record's classification label, when carried. */
  readonly lastClassId?: string
  /** The last record's monotonic verdict, when carried. */
  readonly lastMonotonic?: string
  /** Distinct wire providers seen (route facts only). */
  readonly providers: readonly string[]
}

/** What one per-session summary bucket accumulates. @internal */
interface GuardBucket {
  total: number
  segmented: number
  degraded: number
  unclassified: number
  lastSeq?: number
  lastClassId?: string
  lastMonotonic?: string
  providers: Set<string>
}

/** Extract the facts from one (loose) event data payload. @internal */
export function guardRecordFacts(data: unknown): GuardRecordFacts | undefined {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return undefined
  const record = data as Record<string, unknown>
  const segmented = typeof record.segments === 'object' && record.segments !== null
  const degraded = typeof record.degraded === 'object' && record.degraded !== null
  const meta = (typeof record.meta === 'object' && record.meta !== null ? record.meta : {}) as Record<string, unknown>
  return {
    segmented,
    degraded,
    unclassified: record.classified === false && typeof record.monotonic === 'string' && record.monotonic === 'unclassified',
    ...(typeof record.classId === 'string' ? { classId: record.classId } : {}),
    ...(typeof record.monotonic === 'string' ? { monotonic: record.monotonic } : {}),
    ...(typeof meta.provider === 'string' ? { provider: meta.provider } : {}),
    ...(typeof meta.modelId === 'string' ? { modelId: meta.modelId } : {}),
  }
}

/** The bridge: consume(sessionId, event) + per-session summary + forget. */
export interface GuardObserveBridge {
  /** Consume one session event (log-only, fail-soft; the firehose never sees a throw). */
  consume(sessionId: unknown, event: unknown): void
  /** The session's summary; undefined when no record was consumed. */
  summary(sessionId: string): GuardObserveSummary | undefined
  /** Drop one session's bucket (session/disposed — the observe-listener discipline). */
  forgetSession(sessionId: string): void
}

/** Build the bridge. All state is process memory; nothing is persisted. */
export function createGuardObserveBridge(logger?: { warn?(message: string): unknown }): GuardObserveBridge {
  const buckets = new Map<string, GuardBucket>()
  let warnedOnce = false
  const warnOnce = (message: string): void => {
    if (warnedOnce) return
    warnedOnce = true
    logger?.warn?.(message)
  }
  return {
    consume(sessionId, event) {
      try {
        if (typeof sessionId !== 'string' || sessionId.length === 0) return
        const typed = event as GuardObserveEventLike
        if (typed === null || typeof typed !== 'object') return
        const facts = guardRecordFacts(typed.data)
        if (facts === undefined) {
          // A malformed record feeds nothing — same degrade rule as the
          // session-feed's outer guard (P3 HF-05 discipline).
          warnOnce('dsh-zcontext: guard-observe bridge received a malformed record — feeding nothing')
          return
        }
        let bucket = buckets.get(sessionId)
        if (bucket === undefined) {
          bucket = { total: 0, segmented: 0, degraded: 0, unclassified: 0, providers: new Set<string>() }
          buckets.set(sessionId, bucket)
        }
        bucket.total += 1
        if (facts.segmented) bucket.segmented += 1
        if (facts.degraded) bucket.degraded += 1
        if (facts.unclassified) bucket.unclassified += 1
        if (typeof typed.seq === 'number' && Number.isSafeInteger(typed.seq)) bucket.lastSeq = typed.seq
        if (facts.classId !== undefined) bucket.lastClassId = facts.classId
        if (facts.monotonic !== undefined) bucket.lastMonotonic = facts.monotonic
        if (facts.provider !== undefined) bucket.providers.add(facts.provider)
      } catch (error) {
        warnOnce(`dsh-zcontext: guard-observe bridge consume failed (${error instanceof Error ? error.message : String(error)}) — record dropped`)
      }
    },
    summary(sessionId) {
      const bucket = buckets.get(sessionId)
      if (bucket === undefined) return undefined
      return {
        total: bucket.total,
        segmented: bucket.segmented,
        degraded: bucket.degraded,
        unclassified: bucket.unclassified,
        ...(bucket.lastSeq !== undefined ? { lastSeq: bucket.lastSeq } : {}),
        ...(bucket.lastClassId !== undefined ? { lastClassId: bucket.lastClassId } : {}),
        ...(bucket.lastMonotonic !== undefined ? { lastMonotonic: bucket.lastMonotonic } : {}),
        providers: [...bucket.providers],
      }
    },
    forgetSession(sessionId) {
      buckets.delete(sessionId)
    },
  }
}
