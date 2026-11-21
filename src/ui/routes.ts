/**
 * Native webServer UI routes (ZCTX-UI DESIGN §3) — D2.
 *
 * THREE exact paths (four method arms) via the host `webServer.register`.
 * The browser-facing HTML page route (`GET /zctx-ui`, inline page + token
 * injection) was REMOVED 2026-11-21: the desktop webview origin is the custom
 * `dsh-app://` scheme, which no browser can open — the native side panel
 * (src/client/index.ts) is the only UI face, and these API routes are its
 * data channel:
 *   GET  /zctx-ui/api/snapshot     → JSON ZctxSnapshot (?session= optional)
 *   GET  /zctx-ui/api/config       → JSON { fields, faceSwitches, writable }
 *   POST /zctx-ui/api/config       → overlay write via configEditor.edit
 *   GET  /zctx-ui/api/stats        → JSON durable-ledger aggregates
 *
 * HARD RULES: native req/res only (writeHead/end, async-iterable body, lowercase
 * headers — no Express helpers); disposer via ctx.effect; bridge token runtime
 * generated (zero literal, see auth.ts); writes through configEditor.edit only;
 * read-only except the config overlay (R1: never touches llm request bodies).
 *
 * @module ui/routes
 */

import {
  authorizeRequest,
  authorizeWrite,
  createTokenSource,
  sendJson,
  type WebReqLike,
  type WebResLike,
} from './auth.ts'
import { sanitizePatch, type ConfigWriteResult, type UiConfigKey } from './config-write.ts'
import type { LedgerStats } from '../storage/db.ts'
import type { ZctxSnapshot } from './types.ts'

/** Config view returned by GET /api/config. */
export interface ConfigView {
  readonly fields: Record<string, unknown>
  readonly faceSwitches: Record<string, unknown>
  readonly writable: boolean
}

/** Injected dependencies of the UI route bundle. */
export interface UiRouteDeps {
  readonly ctx: unknown
  readonly snapshotFor: (sessionId?: string) => ZctxSnapshot
  readonly getConfig: () => ConfigView
  readonly writeConfig: (patch: Partial<Record<UiConfigKey, unknown>>) => ConfigWriteResult
  /** Durable-ledger stats (SQLite via node:sqlite; ZCTX-POLISH W1). */
  readonly ledgerStats: () => LedgerStats
  /**
   * ZCTX-I18NFIX: the desktop shell's confirmed DSH language (BCP-47 tag from
   * locale-cache), or undefined when unavailable. Surfaced on every snapshot
   * as `locale` (null when absent) so the panel follows the REAL DSH language
   * instead of the webview's Electron-level navigator locale (en-US on a
   * zh-CN DSH — the real-device mismatch that rendered the panel English).
   */
  readonly desktopLocale?: () => string | undefined
  /** Capability probe seam — defaults to ctx.get('webServer'). Overridable in tests. */
  readonly webServer?: WebServerLike
}

interface WebServerLike {
  register(route: { kind: 'exact' | 'prefix'; path: string; handler: (req: unknown, res: unknown) => void | Promise<void> }): () => void
}

/** Read the full body off the native async-iterable request stream. */
async function readBody(req: unknown): Promise<string> {
  let body = ''
  try {
    for await (const chunk of req as AsyncIterable<unknown>) {
      if (typeof chunk === 'string') body += chunk
      else if (chunk && typeof (chunk as Buffer).toString === 'function') body += (chunk as Buffer).toString('utf8')
    }
  } catch {
    /* a malformed/closed stream simply yields whatever was read */
  }
  return body
}

/** Parse an optional `?session=` from a native req.url. */
function sessionFromUrl(url: string | undefined): string | undefined {
  if (url === undefined) return undefined
  try {
    const parsed = new URL(url, 'http://localhost')
    const value = parsed.searchParams.get('session')
    return value !== null && value.length > 0 ? value : undefined
  } catch {
    return undefined
  }
}

/**
 * Register all four UI routes. Returns a disposer that unregisters them; the
 * disposer is also hooked into `ctx.effect` when that seam exists (RA1d/FileHub
 * precedent). If no webServer is present (CLI headless), the whole UI surface
 * is skipped with a no-op disposer — never a throw, never PENDING.
 */
export function registerUiRoutes(deps: UiRouteDeps): () => void {
  const { ctx, snapshotFor, getConfig, writeConfig, ledgerStats } = deps
  const desktopLocale = deps.desktopLocale ?? (() => undefined)
  // Runtime bridge token — randomBytes, zero literal (auth.ts).
  const bridgeToken = `zctx_${Date.now().toString(36)}_${createTokenSource().token()}`

  let webServer = deps.webServer
  if (webServer === undefined) {
    const c = ctx as { get?(key: string): unknown; webServer?: unknown } | undefined
    let candidate: unknown
    try {
      candidate = c?.get?.('webServer') ?? c?.webServer
    } catch {
      candidate = undefined
    }
    if (candidate !== undefined && typeof (candidate as WebServerLike).register === 'function') {
      webServer = candidate as WebServerLike
    }
  }
  if (webServer === undefined) {
    const c = ctx as { logger?: { info?(message: string): void } } | undefined
    try {
      c?.logger?.info?.('dsh-zcontext: webServer unavailable — UI route surface skipped (CLI headless)')
    } catch {
      /* capability probe must never throw */
    }
    return () => undefined
  }

  const unregister: (() => void)[] = []

  // GET /zctx-ui/api/snapshot — JSON snapshot. Read authorization.
  const snapshotHandler = (req: unknown, res: unknown): void => {
    const r = req as WebReqLike
    const s = res as WebResLike
    if (r.method !== 'GET') {
      sendJson(s, 405, { ok: false, error: 'method not allowed' })
      return
    }
    if (!authorizeRequest(r, bridgeToken)) {
      sendJson(s, 403, { ok: false, error: 'unauthorized' })
      return
    }
    try {
      // ZCTX-I18NFIX: surface the desktop shell language on every snapshot so
      // the panel's language chain anchors on the REAL DSH setting. Absent →
      // null (the client then falls back to navigator → default zh).
      sendJson(s, 200, { ...snapshotFor(sessionFromUrl(r.url)), locale: desktopLocale() ?? null })
    } catch (error: unknown) {
      sendJson(s, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
    }
  }
  unregister.push(webServer.register({ kind: 'exact', path: '/zctx-ui/api/snapshot', handler: snapshotHandler }))

  // GET /zctx-ui/api/stats — durable-ledger aggregates (SQLite; ZCTX-POLISH W1).
  const statsHandler = (req: unknown, res: unknown): void => {
    const r = req as WebReqLike
    const s = res as WebResLike
    if (r.method !== 'GET') {
      sendJson(s, 405, { ok: false, error: 'method not allowed' })
      return
    }
    if (!authorizeRequest(r, bridgeToken)) {
      sendJson(s, 403, { ok: false, error: 'unauthorized' })
      return
    }
    try {
      sendJson(s, 200, { ok: true, stats: ledgerStats() })
    } catch (error) {
      sendJson(s, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
    }
  }
  unregister.push(webServer.register({ kind: 'exact', path: '/zctx-ui/api/stats', handler: statsHandler }))

  // /zctx-ui/api/config — ONE registration dispatching GET (read) and POST
  // (overlay write). The host's exact matcher keeps only the FIRST handler per
  // path, so two same-path registrations silently lose the POST arm (real
  // device 405 — the method split must live inside the handler, not in
  // registration).
  const configHandler = async (req: unknown, res: unknown): Promise<void> => {
    const r = req as WebReqLike
    const s = res as WebResLike
    if (r.method === 'GET') {
      if (!authorizeRequest(r, bridgeToken)) {
        sendJson(s, 403, { ok: false, error: 'unauthorized' })
        return
      }
      sendJson(s, 200, getConfig())
      return
    }
    if (r.method === 'POST') {
      if (!authorizeWrite(r, bridgeToken)) {
        sendJson(s, 403, { ok: false, error: 'unauthorized' })
        return
      }
      const body = await readBody(req)
      let parsed: unknown
      try {
        parsed = JSON.parse(body)
      } catch {
        sendJson(s, 400, { ok: false, error: 'invalid JSON body' })
        return
      }
      // Normalize the two wire shapes clients actually send: the native side
      // panel posts `{ fields: {...}, faceSwitches: {...} }` (mirroring the
      // GET view), while a flat `{ key: value }` is equally accepted.
      // Unknown keys are still rejected wholesale (fail-closed unchanged).
      let patchSource: unknown = parsed
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const obj = parsed as Record<string, unknown>
        if (typeof obj.fields === 'object' && obj.fields !== null) {
          const flat: Record<string, unknown> = { ...(obj.fields as Record<string, unknown>) }
          if (typeof obj.faceSwitches === 'object' && obj.faceSwitches !== null) {
            Object.assign(flat, obj.faceSwitches as Record<string, unknown>)
          }
          patchSource = flat
        }
      }
      const checked = sanitizePatch(patchSource)
      if (!checked.ok) {
        sendJson(s, 400, { ok: false, error: 'invalid config patch (unknown or empty keys)' })
        return
      }
      const result = writeConfig(checked.patch)
      if (!result.ok) {
        sendJson(s, 503, { ok: false, error: 'config editor unavailable' })
        return
      }
      sendJson(s, 200, { ok: true })
      return
    }
    sendJson(s, 405, { ok: false, error: 'method not allowed' })
  }
  unregister.push(webServer.register({ kind: 'exact', path: '/zctx-ui/api/config', handler: configHandler }))

  const disposer = (): void => {
    for (const fn of unregister) {
      try {
        fn()
      } catch {
        /* disposer must never throw */
      }
    }
    unregister.length = 0
  }
  // RA1d/FileHub: collect the route disposer through the fiber effect seam.
  const effectCtx = ctx as { effect?(cleanupFactory: () => () => void, label?: string): unknown } | undefined
  try {
    effectCtx?.effect?.(() => () => disposer(), 'zctx-ui-routes')
  } catch {
    /* capability probe must never throw */
  }
  return disposer
}
