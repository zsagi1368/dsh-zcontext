/**
 * Realtime process-memory snapshot source (ZCTX-UI DESIGN §2) — D1.
 *
 * HARD RULE (DESIGN §0 / §2.1 / R1): this is a THIN WRAPPER over existing
 * accessors. It does NOT re-implement budget / range / attribution math, does
 * NOT call `llm.stream`, registers NO `llm/stream` listener, and is strictly
 * READ-ONLY. Every number carries honest provenance (measured / estimated /
 * unknown) so the UI never presents an estimate as a fact.
 *
 * Reused accessors (all pre-existing, see DESIGN §2.1):
 *   resolveWatchedSession / currentSession / storeFor / validatorConfig /
 *   windowCache → injected as deps;  store.observabilitySnapshot /
 *   usageSnapshot / ledgerEntries / surfaceNodes;  computeBudget /
 *   foldableRanges / routedRequestTarget / tokenMeter.measure.
 *
 * @module ui/snapshot
 */

import { computeBudget } from '../budget.ts'
import { foldableRanges } from '../fold-engine.ts'
import { routedRequestTarget } from '../tools.ts'
import type { SessionLike } from '../types.ts'
import type { SnapshotDeps, ZctxSnapshot, MarkedNumber, Basis } from './types.ts'

/** Dominant three-state grade → basis for netTokensSaved (measured > semi > estimated). */
function dominantBasis(threeState: { measured: number; semi: number; estimated: number }): Basis {
  if (threeState.measured > 0 && threeState.measured >= threeState.semi && threeState.measured >= threeState.estimated) {
    return 'measured'
  }
  if (threeState.semi > 0 && threeState.semi >= threeState.estimated) return 'estimated'
  if (threeState.estimated > 0) return 'estimated'
  return 'none'
}

/** Build an honest empty snapshot (no session / explicit id not watched). */
function emptySnapshot(
  reason: string,
  faceHealth: ZctxSnapshot['faceHealth'],
  generatedAt: number,
): ZctxSnapshot {
  return {
    version: 1,
    generatedAt,
    sessionId: undefined,
    sessionResolution: 'none',
    window: { contextWindow: undefined, totalTokens: undefined, pressurePct: undefined, routed: undefined },
    budget: undefined,
    ranges: [],
    folds: [],
    attribution: undefined,
    cache: { samples: 0, measured: false, basis: 'none' },
    faceHealth,
    degraded: [reason],
  }
}

/**
 * Create a snapshot source from injected dependencies. The dependency seam is
 * what lets unit tests inject a known ledger (V1) without constructing a live
 * host; production wires it from `ZcontextPlugin` (DESIGN §2.2).
 */
export function createSnapshotSource(deps: SnapshotDeps): {
  snapshotFor(sessionId?: string): ZctxSnapshot
} {
  const snapshotFor = (sessionId?: string): ZctxSnapshot => {
    const generatedAt = Date.now()

    // face health is session-independent — always computed, even with no session.
    let faceHealth: ZctxSnapshot['faceHealth']
    try {
      faceHealth = deps.faceHealth()
    } catch {
      faceHealth = {
        state: 'absent',
        evidence: [],
        probedAt: generatedAt,
        summary: 'face 健康读取失败',
      }
    }

    // -- session resolution (DESIGN §2.3) -------------------------------------
    // Explicit id: resolve via resolveWatchedSession; a non-visible/disposed id
    // yields an empty snapshot and NEVER falls back to latest (no mis-binding).
    // No id: currentSession() (latest-watched), the existing nudge fallback.
    let session: SessionLike | undefined
    let sessionResolution: ZctxSnapshot['sessionResolution']
    if (sessionId !== undefined) {
      session = deps.resolveSession(sessionId)
      if (session === undefined) {
        return emptySnapshot(`session ${sessionId} not watched`, faceHealth, generatedAt)
      }
      sessionResolution = 'explicit'
    } else {
      session = deps.currentSession()
      if (session === undefined) {
        return emptySnapshot('no active session', faceHealth, generatedAt)
      }
      sessionResolution = 'latest-watched'
    }

    const degraded: string[] = []
    const runtime = deps.runtime

    // -- window (measured source = windowCache / tokenMeter) ------------------
    let contextWindow: number | undefined
    try {
      contextWindow = deps.windowFor(session)
    } catch (error: unknown) {
      degraded.push(`window cache read failed: ${error instanceof Error ? error.message : String(error)}`)
    }

    let totalTokens: MarkedNumber | undefined
    if (runtime.tokenMeter === undefined || typeof runtime.tokenMeter.measure !== 'function') {
      degraded.push('token meter unavailable')
    } else {
      try {
        totalTokens = { value: runtime.tokenMeter.measure(session).totalTokens, basis: 'measured' }
      } catch (error: unknown) {
        degraded.push(`token meter failed: ${error instanceof Error ? error.message : String(error)}`)
        totalTokens = { value: 0, basis: 'unknown' }
      }
    }

    let pressurePct: number | undefined
    if (contextWindow !== undefined && contextWindow > 0 && totalTokens?.basis === 'measured') {
      pressurePct = (totalTokens.value / contextWindow) * 100
    }

    const routed = routedRequestTarget(session)

    // -- budget: reuse computeBudget, never reimplement ----------------------
    let budget: ZctxSnapshot['budget']
    if (contextWindow !== undefined) {
      try {
        budget = computeBudget({ contextWindow })
      } catch (error: unknown) {
        degraded.push(`budget computation failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    // -- store-backed views (all read-only accessors) -------------------------
    const store = runtime.storeFor(session)
    let ranges: ZctxSnapshot['ranges'] = []
    try {
      ranges = foldableRanges(store.surfaceNodes(), runtime.validatorConfig(session))
    } catch (error: unknown) {
      degraded.push(`range computation failed: ${error instanceof Error ? error.message : String(error)}`)
    }

    let folds: ZctxSnapshot['folds'] = []
    try {
      folds = [...store.ledgerEntries()]
    } catch (error: unknown) {
      degraded.push(`ledger read failed: ${error instanceof Error ? error.message : String(error)}`)
    }

    // -- cache accounting (S6 measured/estimated authority) ------------------
    let cache: ZctxSnapshot['cache'] = { samples: 0, measured: false, basis: 'none' }
    try {
      const usage = store.usageSnapshot()
      const basis: ZctxSnapshot['cache']['basis'] = usage.samples === 0
        ? 'none'
        : usage.measured
          ? 'measured'
          : 'estimated'
      cache = {
        samples: usage.samples,
        measured: usage.measured,
        basis,
        ...(usage.latest !== undefined
          ? {
              latest: {
                measured: usage.latest.measured,
                ...(usage.latest.cacheReadTokens !== undefined ? { cacheReadTokens: usage.latest.cacheReadTokens } : {}),
                ...(usage.latest.cacheWriteTokens !== undefined ? { cacheWriteTokens: usage.latest.cacheWriteTokens } : {}),
              },
            }
          : {}),
      }
    } catch (error: unknown) {
      degraded.push(`usage snapshot failed: ${error instanceof Error ? error.message : String(error)}`)
    }

    // -- attribution (reuse observabilitySnapshot) ---------------------------
    let attribution: ZctxSnapshot['attribution']
    try {
      const obs = store.observabilitySnapshot()
      const foldCount = folds.length
      const netValue = folds.reduce((sum, entry) => sum + (entry.tokensBefore - entry.tokensAfter), 0)
      attribution = {
        threeState: obs.threeState,
        cleanSampleRatio: obs.cleanSampleRatio,
        clean: obs.cleanSampleRatio >= runtime.cleanSampleFloor,
        breakevenTable: obs.breakevenTable,
        resetSummary: obs.resetSummary,
        foldCount,
        netTokensSaved: { value: netValue, basis: dominantBasis(obs.threeState) },
      }
    } catch (error: unknown) {
      degraded.push(`observability snapshot failed: ${error instanceof Error ? error.message : String(error)}`)
    }

    const resolvedSessionId = (session as { id?: unknown }).id
    return {
      version: 1,
      generatedAt,
      sessionId: typeof resolvedSessionId === 'string' ? resolvedSessionId : undefined,
      sessionResolution,
      window: { contextWindow, totalTokens, pressurePct, routed },
      budget,
      ranges,
      folds,
      attribution,
      cache,
      faceHealth,
      degraded,
    }
  }

  return { snapshotFor }
}
