/**
 * UI aggregate surface (ZCTX-UI DESIGN §1.1; ZCTX-FULLPANEL revision).
 *
 * ZCTX-FULLPANEL: the browser-facing HTML page route is REMOVED — the desktop
 * webview origin is the custom `dsh-app://` scheme, which no browser can open
 * (user-verified). The UI now lives entirely in the native sidebar panel
 * (`sidebar.panellist` + `main`, src/client/index.ts). This module keeps ONLY
 * the API routes the panel consumes: snapshot / config (GET+POST) / stats.
 *
 * Layer discipline (DESIGN §9): src/ui/** is a leaf — it is never imported by
 * fold-engine / autofold / observe / preflight. It only reads the ledger via
 * injected accessors. No request-body rewrite, no stream listener (R1).
 *
 * @module ui/index
 */

import { registerUiRoutes, type ConfigView, type UiRouteDeps } from './routes.ts'
import { writeOverlay, type ConfigWriteResult } from './config-write.ts'
import type { ZctxSnapshot } from './types.ts'
import type { LedgerStats } from '../storage/db.ts'

export * from './types.ts'
export * from './auth.ts'
export * from './config-write.ts'
export * from './routes.ts'
export * from './snapshot.ts'
export * from './face-probe.ts'
export * from './i18n.ts'

/** Accessors the plugin injects (all pre-existing methods, DESIGN §2.1). */
export interface UiAccessors {
  /** The plugin's snapshot source (shared by the public method and the route). */
  readonly snapshotFor: (sessionId?: string) => ZctxSnapshot
  /** Current config values for the settings form (from plugin.config). */
  readonly configValues: () => Record<string, unknown>
  /**
   * Durable-ledger aggregates (SQLite via node:sqlite; ZCTX-POLISH W1).
   * S-5: the type is the REAL `LedgerStats` from ../storage/db.ts — the single
   * source of truth (routes.ts already imports it there; the former local
   * `LedgerStatsFromDb` mirror duplicated the shape for no reason).
   */
  readonly ledgerStats: () => LedgerStats
  /** ZCTX-I18NFIX: desktop shell language probe (undefined when unavailable). */
  readonly desktopLocale?: () => string | undefined
  /** Optional webServer override (tests); production resolves via ctx.get. */
  readonly webServer?: UiRouteDeps['webServer']
}

/** Attach the three API routes to a host context. Returns the route disposer. */
export function attachUi(ctx: unknown, accessors: UiAccessors): () => void {
  const getConfig = (): ConfigView => {
    const all = accessors.configValues()
    // Nine core fields in the `fields` bag; face switches surfaced separately.
    const fields: Record<string, unknown> = {
      enabled: all.enabled,
      nudgeThresholds: all.nudgeThresholds,
      keepRecentTokens: all.keepRecentTokens,
      maxFoldFraction: all.maxFoldFraction,
      minFoldableTokens: all.minFoldableTokens,
      protectionFloorTokens: all.protectionFloorTokens,
      summaryFloorChars: all.summaryFloorChars,
      summaryCeilingChars: all.summaryCeilingChars,
      netShrinkTolerance: all.netShrinkTolerance,
      // ZCTX-I18NFIX: absent in an untouched config — the panel treats missing
      // as 'auto' (follow the desktop shell language).
      uiLanguage: all.uiLanguage,
    }
    const faceSwitches: Record<string, unknown> = {
      'observe.enabled': all['observe.enabled'],
      'patch.guardObserveEvents': all['patch.guardObserveEvents'],
      'autofold.enabled': all['autofold.enabled'],
      preflightMode: all.preflightMode,
    }
    return { fields, faceSwitches, writable: resolveWritable(ctx) }
  }

  const writeConfig = (patch: Parameters<typeof writeOverlay>[1]): ConfigWriteResult => writeOverlay(ctx, patch)

  return registerUiRoutes({
    ctx,
    snapshotFor: accessors.snapshotFor,
    getConfig,
    writeConfig,
    ledgerStats: () => accessors.ledgerStats(),
    desktopLocale: accessors.desktopLocale ?? (() => undefined),
    ...(accessors.webServer !== undefined ? { webServer: accessors.webServer } : {}),
  })
}

/** Capability probe: can the host persist config overlay edits? */
function resolveWritable(ctx: unknown): boolean {
  try {
    const c = ctx as { get?(k: string): unknown; configEditor?: unknown }
    const editor = c?.get?.('configEditor') ?? c?.configEditor
    return editor !== undefined && editor !== null
  } catch {
    return false
  }
}
