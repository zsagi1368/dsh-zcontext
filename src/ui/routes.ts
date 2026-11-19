/**
 * Native webServer UI routes (ZCTX-UI DESIGN §3) — D2.
 *
 * FOUR routes via the host `webServer.register`:
 *   GET  /zctx-ui                  → text/html (inline page, token injected)
 *   GET  /zctx-ui/api/snapshot     → JSON ZctxSnapshot (?session= optional)
 *   GET  /zctx-ui/api/config       → JSON { fields, faceSwitches, writable }
 *   POST /zctx-ui/api/config       → overlay write via configEditor.edit
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
  /** The inline page HTML (D3). A token placeholder is replaced at registration. */
  readonly pageHtml: string
  readonly snapshotFor: (sessionId?: string) => ZctxSnapshot
  readonly getConfig: () => ConfigView
  readonly writeConfig: (patch: Partial<Record<UiConfigKey, unknown>>) => ConfigWriteResult
  /** Capability probe seam — defaults to ctx.get('webServer'). Overridable in tests. */
  readonly webServer?: WebServerLike
}

interface WebServerLike {
  register(route: { kind: 'exact' | 'prefix'; path: string; handler: (req: unknown, res: unknown) => void | Promise<void> }): () => void
}

/** The token placeholder in the page HTML (not a credential — replaced at register time). */
const TOKEN_PLACEHOLDER = '__ZCTX_BRIDGE_TOKEN__'

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
  const { ctx, pageHtml, snapshotFor, getConfig, writeConfig } = deps
  // Runtime bridge token — randomBytes, zero literal (auth.ts).
  const bridgeToken = `zctx_${Date.now().toString(36)}_${createTokenSource().token()}`
  const page = pageHtml.split(TOKEN_PLACEHOLDER).join(bridgeToken)

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

  // GET /zctx-ui — inline page, token injected. Read authorization.
  const pageHandler = (req: unknown, res: unknown): void => {
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
    s.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    s.end(page)
  }
  unregister.push(webServer.register({ kind: 'exact', path: '/zctx-ui', handler: pageHandler }))

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
      sendJson(s, 200, snapshotFor(sessionFromUrl(r.url)))
    } catch (error: unknown) {
      sendJson(s, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
    }
  }
  unregister.push(webServer.register({ kind: 'exact', path: '/zctx-ui/api/snapshot', handler: snapshotHandler }))

  // GET /zctx-ui/api/config — current fields + face switches + writable.
  const configGetHandler = (req: unknown, res: unknown): void => {
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
    sendJson(s, 200, getConfig())
  }
  unregister.push(webServer.register({ kind: 'exact', path: '/zctx-ui/api/config', handler: configGetHandler }))

  // POST /zctx-ui/api/config — overlay write. STRICTER authorization.
  const configPostHandler = async (req: unknown, res: unknown): Promise<void> => {
    const r = req as WebReqLike
    const s = res as WebResLike
    if (r.method !== 'POST') {
      sendJson(s, 405, { ok: false, error: 'method not allowed' })
      return
    }
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
    const checked = sanitizePatch(parsed)
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
  }
  unregister.push(webServer.register({ kind: 'exact', path: '/zctx-ui/api/config', handler: configPostHandler }))

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
