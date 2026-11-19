/**
 * UI-only view types for the zcontext realtime panel (ZCTX-UI DESIGN §2.2).
 *
 * Discipline (DESIGN §9): this module is a leaf — it only *references* types
 * from the established surface (src/types.ts, src/store.ts, src/tools.ts) and
 * never re-implements a ledger algorithm. All measurement vocabulary here is
 * honest: a number carries its `Basis` so the UI can render measured vs.
 * estimated vs. unknown instead of presenting an estimate as a fact.
 *
 * @module ui/types
 */

import type { Budget, NudgeRange, ThreeStateCounts, BreakevenTableRow, ResetSummaryRow, SessionLike } from '../types.ts'
import type { FoldLedgerEntry } from '../store.ts'
import type { ZctxToolRuntime } from '../tools.ts'
import type { FaceHealthView } from './face-probe.ts'

export type { FaceState, FaceEvidence, FaceHealthView, FaceProbeState } from './face-probe.ts'

/** Provenance of a displayed number: measured=instrumented / estimated=model / unknown=unavailable / none=no data. */
export type Basis = 'measured' | 'estimated' | 'unknown' | 'none'

/** A number tagged with how it was obtained. */
export interface MarkedNumber {
  readonly value: number
  readonly basis: Basis
}

/** The immutable process-memory snapshot returned by `snapshotFor`. */
export interface ZctxSnapshot {
  readonly version: 1
  readonly generatedAt: number
  /** Currently watched session ids (thin wrapper over liveSessions), for the UI switcher. */
  readonly availableSessions: readonly string[]
  readonly sessionId: string | undefined
  /** How the session was resolved — explicit / latest-watched / none / degraded (never silent). */
  readonly sessionResolution: 'explicit' | 'latest-watched' | 'none' | 'degraded'
  readonly window: {
    /** From the already-resolved model-info window cache; measured source, never fabricated. */
    readonly contextWindow: number | undefined
    /** tokenMeter.measure → measured; failure → unknown. */
    readonly totalTokens: MarkedNumber | undefined
    /** totalTokens / contextWindow * 100 when both are known. */
    readonly pressurePct: number | undefined
    readonly routed: { provider: string; model: string } | undefined
  }
  readonly budget: Readonly<Budget> | undefined
  /** Foldable ranges — estimatedTokens has built-in estimated semantics. */
  readonly ranges: readonly NudgeRange[]
  readonly folds: readonly FoldLedgerEntry[]
  readonly attribution: {
    readonly threeState: ThreeStateCounts
    readonly cleanSampleRatio: number
    readonly clean: boolean
    readonly breakevenTable: readonly BreakevenTableRow[]
    readonly resetSummary: readonly ResetSummaryRow[]
    readonly foldCount: number
    /** Σ(before - after); basis follows the dominant three-state grade. */
    readonly netTokensSaved: MarkedNumber
  } | undefined
  readonly cache: {
    readonly samples: number
    readonly measured: boolean
    readonly basis: 'measured' | 'estimated' | 'none'
    readonly latest?: {
      readonly cacheReadTokens?: number
      readonly cacheWriteTokens?: number
      readonly measured: boolean
    }
  }
  /** Face health — session independent; full tri-state probe + visible sink lands in B4. */
  readonly faceHealth: FaceHealthView
  /** Honest degradation rows (same vocabulary as zctx_status). */
  readonly degraded: readonly string[]
}

/** Injected dependencies of the snapshot source (DESIGN §2.2, dependency seam). */
export interface SnapshotDeps {
  /** The existing runtime carrying storeFor / validatorConfig / tokenMeter / cleanSampleFloor. */
  readonly runtime: ZctxToolRuntime
  /** Explicit id → live session (resolveWatchedSession); never falls back on miss. */
  readonly resolveSession: (id: string) => SessionLike | undefined
  /** Default session (currentSession) when no id was supplied. */
  readonly currentSession: () => SessionLike | undefined
  /** All watched session ids (thin wrapper over liveSessions), for the UI switcher. Optional for backward-compatible test deps. */
  readonly listSessions?: () => readonly string[]
  /** Cached context window for a session (windowCache); measured source. */
  readonly windowFor: (session: SessionLike) => number | undefined
  /** Face-health view (session independent); B4 replaces the body with the tri-state probe. */
  readonly faceHealth: () => FaceHealthView
}
