/**
 * UI aggregate surface (ZCTX-UI DESIGN §1.1) — D3.
 *
 * The plugin imports the UI face only from here. This module registers the
 * four routes and exposes the config/snapshot views; the snapshot source itself
 * is built by the plugin (so its public `snapshotFor` and the HTTP route share
 * one source).
 *
 * Layer discipline (DESIGN §9): src/ui/** is a leaf — it is never imported by
 * fold-engine / autofold / observe / preflight. It only reads the ledger via
 * injected accessors. No request-body rewrite, no stream listener (R1).
 *
 * @module ui/index
 */

import { registerUiRoutes, type ConfigView, type UiRouteDeps } from './routes.ts'
import { writeOverlay, type ConfigWriteResult } from './config-write.ts'
import { UI_PAGE_HTML } from './page.ts'
import type { ZctxSnapshot } from './types.ts'

export * from './types.ts'
export * from './auth.ts'
export * from './config-write.ts'
export * from './routes.ts'
export * from './snapshot.ts'
export * from './face-probe.ts'
export { UI_PAGE_HTML, UI_TOKEN_PLACEHOLDER } from './page.ts'

/** Accessors the plugin injects (all pre-existing methods, DESIGN §2.1). */
export interface UiAccessors {
  /** The plugin's snapshot source (shared by the public method and the route). */
  readonly snapshotFor: (sessionId?: string) => ZctxSnapshot
  /** Current config values for the settings form (from plugin.config). */
  readonly configValues: () => Record<string, unknown>
  /** Optional webServer override (tests); production resolves via ctx.get. */
  readonly webServer?: UiRouteDeps['webServer']
}

/** Attach the four UI routes to a host context. Returns the route disposer. */
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
    pageHtml: UI_PAGE_HTML,
    snapshotFor: accessors.snapshotFor,
    getConfig,
    writeConfig,
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
