/**
 * ZCTX-UI B3 acceptance tests (task card D4; DESIGN §2/§3/§4).
 *
 * V1  snapshot API thin wrapper: inject a known ledger → field semantics match
 *     zctx_status, measured|estimated annotation, session 3-arm resolution,
 *     explicit-invisible id does not fall back.
 * V2/V3 four native WebRoutes (page/snapshot/config GET+POST), native req/res
 *     (writeHead/end), async-iterable body, config written via configEditor.edit,
 *     no llm stream in the UI surface.
 * V4 auth three arms (403 / token 200 / same-origin+loopback POST 200) + runtime
 *     token with zero credential literals in source.
 *
 * All credential-looking values in this file are RUNTIME-GENERATED via the
 * token source — no usable literal ever appears (UserPromptSubmit hook rule).
 */

import { describe, expect, it } from 'vitest'

import { FoldStore } from '../src/store.ts'
import { computeBudget } from '../src/budget.ts'
import { foldableRanges } from '../src/fold-engine.ts'
import { configDefaults } from '../src/config.ts'
import type { ZctxToolRuntime } from '../src/tools.ts'
import type { SessionLike, ValidatorConfig } from '../src/types.ts'
import {
  createSnapshotSource,
  registerUiRoutes,
  createTokenSource,
  authorizeRequest,
  authorizeWrite,
  unknownFaceHealth,
  UI_PAGE_HTML,
  type ConfigView,
  type ConfigWriteResult,
} from '../src/ui/index.ts'
import type { WebReqLike, WebResLike } from '../src/ui/auth.ts'
import { MockSession, msg } from './helpers/mock-session.ts'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** A routed MockSession carries id + requestHeader like the official Session. */
function routedSession(id: string): MockSession {
  const session = new MockSession()
  const target = session as unknown as {
    id: string
    requestHeader: () => { config: { provider: string; model: string } }
  }
  target.id = id
  target.requestHeader = () => ({ config: { provider: 'deepseek', model: 'test-model' } })
  return session
}

/** Seed a session with a real measured usage sample + foldable surface. */
function seedLedger(session: MockSession): FoldStore {
  session.append('system/message', msg.system('sys'))
  session.append('user/message', msg.user('u1'))
  session.append('assistant/message', msg.assistant('a1', [], {
    inputTokens: 500,
    outputTokens: 50,
    totalTokens: 550,
    cacheReadTokens: 300,
    cacheWriteTokens: 40,
  }))
  const store = new FoldStore()
  store.attach(session)
  return store
}

const validatorConfig: ValidatorConfig = {
  keepRecentMessages: 0,
  keepRecentTokens: 0,
  protectionFloorTokens: 5000,
  minFoldableTokens: 5000,
  maxFoldFraction: 0.6,
  summaryFloorChars: 50,
  summaryCeilingChars: 20000,
  netShrinkTolerance: 1.05,
  contextWindow: 200000,
}

function makeRuntime(storeFor: (s: SessionLike) => FoldStore): ZctxToolRuntime {
  return {
    cleanSampleFloor: configDefaults.cleanSampleFloor,
    preflightMode: 'observe',
    tokenMeter: { measure: () => ({ totalTokens: 550 }) } as ZctxToolRuntime['tokenMeter'],
    storeFor,
    validatorConfig: () => validatorConfig,
  }
}

/** Native-ish response recorder. */
interface RecordedRes extends WebResLike {
  status: number
  headers: Record<string, string>
  body: string
}
function mockRes(): RecordedRes {
  return {
    status: 0,
    headers: {},
    body: '',
    writeHead(status: number, headers?: Record<string, string>) {
      this.status = status
      if (headers) this.headers = headers
      return this
    },
    end(body?: string) {
      this.body = body ?? ''
      return this
    },
  }
}

/** Native request with controllable headers/socket and an async-iterable body. */
function mockReq(init: {
  method?: string
  url?: string
  headers?: Record<string, string>
  remoteAddress?: string
  body?: string
}): WebReqLike & AsyncIterable<unknown> {
  const req = {
    method: init.method ?? 'GET',
    url: init.url ?? '/zctx-ui',
    headers: init.headers ?? {},
    socket: { remoteAddress: init.remoteAddress ?? '127.0.0.1' },
    async *[Symbol.asyncIterator]() {
      if (init.body !== undefined) yield Buffer.from(init.body, 'utf8')
    },
  }
  return req as WebReqLike & AsyncIterable<unknown>
}

function mockWebServer(): {
  webServer: { register(route: { kind: string; path: string; handler: (req: unknown, res: unknown) => void | Promise<void> }): () => void }
  routes: Map<string, (req: unknown, res: unknown) => void | Promise<void>>
  unregistered: string[]
} {
  const routes = new Map<string, (req: unknown, res: unknown) => void | Promise<void>>()
  const unregistered: string[] = []
  const webServer = {
    register(route: { kind: string; path: string; handler: (req: unknown, res: unknown) => void | Promise<void> }) {
      // two registrations share the config path (GET + POST) — key by path+order
      const key = routes.has(route.path) ? `${route.path}#2` : route.path
      routes.set(key, route.handler)
      return () => { unregistered.push(key) }
    },
  }
  return { webServer, routes, unregistered }
}

async function call(
  handler: (req: unknown, res: unknown) => void | Promise<void>,
  req: WebReqLike & AsyncIterable<unknown>,
): Promise<RecordedRes> {
  const res = mockRes()
  await handler(req, res)
  return res
}

// ---------------------------------------------------------------------------
// D1 — snapshot API thin wrapper (V1)
// ---------------------------------------------------------------------------

describe('ZCTX-UI D1: snapshotFor thin wrapper (V1)', () => {
  it('injects a known ledger → fields match zctx_status vocabulary with measured annotation', () => {
    const session = routedSession('sess-A') as unknown as SessionLike
    const store = seedLedger(session as MockSession)
    const runtime = makeRuntime(() => store)
    const source = createSnapshotSource({
      runtime,
      resolveSession: (id) => (id === 'sess-A' ? session : undefined),
      currentSession: () => session,
      windowFor: () => 200000,
      faceHealth: () => unknownFaceHealth(),
    })
    const snap = source.snapshotFor()

    expect(snap.version).toBe(1)
    expect(snap.sessionResolution).toBe('latest-watched')
    expect(snap.sessionId).toBe('sess-A')
    // measured window + measured token meter
    expect(snap.window.contextWindow).toBe(200000)
    expect(snap.window.totalTokens).toEqual({ value: 550, basis: 'measured' })
    expect(snap.window.pressurePct).toBeCloseTo((550 / 200000) * 100)
    expect(snap.window.routed).toEqual({ provider: 'deepseek', model: 'test-model' })
    // budget/ranges reuse the existing pure cores (same numbers as zctx_status)
    const expectedBudget = computeBudget({ contextWindow: 200000 })
    expect(snap.budget).toEqual(expectedBudget)
    expect(snap.ranges).toEqual(foldableRanges(store.surfaceNodes(), validatorConfig))
    // folds from ledgerEntries
    expect(snap.folds).toEqual(store.ledgerEntries())
    // cache measured authority: real measured sample → basis measured
    expect(snap.cache.basis).toBe('measured')
    expect(snap.cache.measured).toBe(true)
    expect(snap.cache.samples).toBeGreaterThanOrEqual(1)
    // attribution from observabilitySnapshot; netTokensSaved basis follows threeState dominance
    expect(snap.attribution).toBeDefined()
    expect(snap.attribution?.foldCount).toBe(store.ledgerEntries().length)
    expect(snap.attribution?.threeState).toEqual(store.observabilitySnapshot().threeState)
    expect(['measured', 'estimated', 'none']).toContain(snap.attribution?.netTokensSaved.basis)
    expect(snap.degraded).toEqual([])
  })

  it('explicit watched id resolves via resolveSession → sessionResolution=explicit', () => {
    const session = routedSession('sess-A') as unknown as SessionLike
    const store = seedLedger(session as MockSession)
    const source = createSnapshotSource({
      runtime: makeRuntime(() => store),
      resolveSession: (id) => (id === 'sess-A' ? session : undefined),
      currentSession: () => session,
      windowFor: () => 200000,
      faceHealth: () => unknownFaceHealth(),
    })
    const snap = source.snapshotFor('sess-A')
    expect(snap.sessionResolution).toBe('explicit')
    expect(snap.sessionId).toBe('sess-A')
  })

  it('explicit INVISIBLE id returns empty snapshot + degraded, NEVER falls back to latest', () => {
    const session = routedSession('sess-A') as unknown as SessionLike
    const store = seedLedger(session as MockSession)
    const source = createSnapshotSource({
      runtime: makeRuntime(() => store),
      resolveSession: (id) => (id === 'sess-A' ? session : undefined),
      currentSession: () => session,
      windowFor: () => 200000,
      faceHealth: () => unknownFaceHealth(),
    })
    const snap = source.snapshotFor('ghost-id')
    expect(snap.sessionResolution).toBe('none')
    expect(snap.sessionId).toBeUndefined()
    expect(snap.degraded).toContain('session ghost-id not watched')
    expect(snap.folds).toEqual([])
    expect(snap.ranges).toEqual([])
    expect(snap.attribution).toBeUndefined()
    // face health is session-independent — still present
    expect(snap.faceHealth).toBeDefined()
  })

  it('no session → empty snapshot + degraded, face health still shown', () => {
    const store = new FoldStore()
    const source = createSnapshotSource({
      runtime: makeRuntime(() => store),
      resolveSession: () => undefined,
      currentSession: () => undefined,
      windowFor: () => undefined,
      faceHealth: () => unknownFaceHealth(),
    })
    const snap = source.snapshotFor()
    expect(snap.sessionResolution).toBe('none')
    expect(snap.degraded).toContain('no active session')
    expect(snap.faceHealth.state).toBe('absent')
  })

  it('token meter failure → totalTokens basis unknown (honest, no fake value)', () => {
    const session = routedSession('sess-A') as unknown as SessionLike
    const store = seedLedger(session as MockSession)
    const runtime = makeRuntime(() => store)
    const broken = { ...runtime, tokenMeter: { measure: () => { throw new Error('meter down') } } as ZctxToolRuntime['tokenMeter'] }
    const source = createSnapshotSource({
      runtime: broken,
      resolveSession: () => session,
      currentSession: () => session,
      windowFor: () => 200000,
      faceHealth: () => unknownFaceHealth(),
    })
    const snap = source.snapshotFor('sess-A')
    expect(snap.window.totalTokens?.basis).toBe('unknown')
    expect(snap.degraded.some((d) => d.includes('token meter failed'))).toBe(true)
  })

  it('no usage samples → cache basis none (not estimated fabrication)', () => {
    const session = routedSession('sess-empty') as unknown as SessionLike
    const store = new FoldStore()
    store.attach(session as MockSession)
    const source = createSnapshotSource({
      runtime: makeRuntime(() => store),
      resolveSession: () => session,
      currentSession: () => session,
      windowFor: () => undefined,
      faceHealth: () => unknownFaceHealth(),
    })
    const snap = source.snapshotFor('sess-empty')
    expect(snap.cache.basis).toBe('none')
    expect(snap.cache.samples).toBe(0)
  })

  it('B5-5: exposes availableSessions (thin list of watched ids)', () => {
    const session = routedSession('sess-A') as unknown as SessionLike
    const store = seedLedger(session as MockSession)
    const source = createSnapshotSource({
      runtime: makeRuntime(() => store),
      resolveSession: (id) => (id === 'sess-A' ? session : undefined),
      currentSession: () => session,
      windowFor: () => 200000,
      listSessions: () => ['sess-A', 'sess-B'],
      faceHealth: () => unknownFaceHealth(),
    })
    expect(source.snapshotFor().availableSessions).toEqual(['sess-A', 'sess-B'])
    expect(source.snapshotFor('ghost').availableSessions).toEqual(['sess-A', 'sess-B'])
  })

  it('B5-3: storeFor throwing → degraded empty snapshot, never throws', () => {
    const session = routedSession('sess-A') as unknown as SessionLike
    const runtime = makeRuntime(() => { throw new Error('store boom') })
    const source = createSnapshotSource({
      runtime,
      resolveSession: () => session,
      currentSession: () => session,
      windowFor: () => undefined,
      faceHealth: () => unknownFaceHealth(),
    })
    let snap: ReturnType<typeof source.snapshotFor> | undefined
    expect(() => { snap = source.snapshotFor('sess-A') }).not.toThrow()
    expect(snap?.sessionResolution).toBe('degraded')
    expect(snap?.degraded.some((d) => d.includes('store resolution failed'))).toBe(true)
    expect(snap?.folds).toEqual([])
  })

  it('B5-3: route target read throwing → degraded empty snapshot, never throws', () => {
    const session = routedSession('sess-A') as unknown as SessionLike
    const store = seedLedger(session as MockSession)
    // routedRequestTarget already try/catches session.requestHeader() itself;
    // to exercise snapshot.ts's OUTER guard we make header.config throw (this
    // read sits AFTER routedRequestTarget's internal try/catch).
    ;(session as unknown as { requestHeader: () => unknown }).requestHeader = () => {
      return new Proxy({}, { get() { throw new Error('header.config boom') } })
    }
    const source = createSnapshotSource({
      runtime: makeRuntime(() => store),
      resolveSession: () => session,
      currentSession: () => session,
      windowFor: () => undefined,
      faceHealth: () => unknownFaceHealth(),
    })
    let snap: ReturnType<typeof source.snapshotFor> | undefined
    expect(() => { snap = source.snapshotFor('sess-A') }).not.toThrow()
    expect(snap?.sessionResolution).toBe('degraded')
    expect(snap?.degraded.some((d) => d.includes('route target read failed'))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// D2 — auth three arms (V4)
// ---------------------------------------------------------------------------

describe('ZCTX-UI D2: bridge token authorization (V4)', () => {
  const token = `zctx_${Date.now().toString(36)}_${createTokenSource().token()}`

  it('token generated at runtime is non-empty and non-deterministic', () => {
    const a = createTokenSource().token()
    const b = createTokenSource().token()
    expect(a).toBeTruthy()
    expect(b).toBeTruthy()
    expect(a).not.toBe(b)
    expect(a).toMatch(/^[0-9a-f]{32}$/)
  })

  it('authorizeRequest: valid token header passes; wrong token fails', () => {
    const withToken = mockReq({ headers: { 'x-zctx-token': token } })
    expect(authorizeRequest(withToken, token)).toBe(true)
    const wrong = mockReq({ headers: { 'x-zctx-token': createTokenSource().token() } })
    expect(authorizeRequest(wrong, token)).toBe(false)
  })

  it('authorizeRequest: loopback (no origin, no token) passes', () => {
    const local = mockReq({ headers: {}, remoteAddress: '127.0.0.1' })
    expect(authorizeRequest(local, token)).toBe(true)
    const remote = mockReq({ headers: {}, remoteAddress: '8.8.8.8' })
    expect(authorizeRequest(remote, token)).toBe(false)
  })

  it('authorizeRequest: same-origin (origin host == host) passes; cross-origin fails', () => {
    const same = mockReq({ headers: { origin: 'http://localhost:5173', host: 'localhost:5173' }, remoteAddress: '8.8.8.8' })
    expect(authorizeRequest(same, token)).toBe(true)
    const cross = mockReq({ headers: { origin: 'http://evil.example', host: 'localhost:5173' }, remoteAddress: '8.8.8.8' })
    expect(authorizeRequest(cross, token)).toBe(false)
  })

  it('authorizeWrite: requires token OR (same-origin AND loopback); remote same-origin alone fails', () => {
    expect(authorizeWrite(mockReq({ headers: { 'x-zctx-token': token } }), token)).toBe(true)
    expect(authorizeWrite(mockReq({ headers: {}, remoteAddress: '127.0.0.1' }), token)).toBe(false) // loopback alone NOT enough for write
    expect(authorizeWrite(mockReq({
      headers: { origin: 'http://localhost:5173', host: 'localhost:5173' },
      remoteAddress: '127.0.0.1',
    }), token)).toBe(true)
    expect(authorizeWrite(mockReq({
      headers: { origin: 'http://evil.example', host: 'localhost:5173' },
      remoteAddress: '8.8.8.8',
    }), token)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// D2 — four native WebRoutes (V2/V3)
// ---------------------------------------------------------------------------

describe('ZCTX-UI D2: native WebRoutes (V2/V3)', () => {
  const session = routedSession('sess-A') as unknown as SessionLike
  const store = seedLedger(session as MockSession)
  const snapshotSource = createSnapshotSource({
    runtime: makeRuntime(() => store),
    resolveSession: (id) => (id === 'sess-A' ? session : undefined),
    currentSession: () => session,
    windowFor: () => 200000,
    faceHealth: () => unknownFaceHealth(),
  })
  const configView: ConfigView = { fields: { enabled: true }, faceSwitches: { preflightMode: 'observe' }, writable: true }
  let editCalls: { entry: unknown; patch: Record<string, unknown> }[] = []
  const editor = {
    entries: () => [{ options: { id: 'dsh-zcontext' } }],
    edit: (entry: unknown, change: (c: Record<string, unknown>, i: Record<string, unknown>) => Record<string, unknown>) => {
      const patch = change({ enabled: false }, {})
      editCalls.push({ entry, patch })
    },
  }
  const ctx = { get: (k: string) => (k === 'configEditor' ? editor : undefined), logger: { info: () => undefined } }

  function setup() {
    editCalls = []
    const { webServer, routes, unregistered } = mockWebServer()
    const disposer = registerUiRoutes({
      ctx,
      webServer,
      pageHtml: UI_PAGE_HTML,
      snapshotFor: (id) => snapshotSource.snapshotFor(id),
      getConfig: () => configView,
      writeConfig: (patch) => {
        const result = editor.edit(editor.entries()[0], () => ({ ...patch }))
        return result === undefined ? { ok: true } as ConfigWriteResult : result
      },
    })
    return { routes, unregistered, disposer }
  }

  it('registers all four native routes', () => {
    const { routes } = setup()
    expect([...routes.keys()].sort()).toEqual(
      ['/zctx-ui', '/zctx-ui/api/config', '/zctx-ui/api/config#2', '/zctx-ui/api/snapshot'].sort(),
    )
  })

  it('GET /zctx-ui returns 200 HTML with the injected runtime token (not the placeholder)', async () => {
    const { routes } = setup()
    const res = await call(routes.get('/zctx-ui')!, mockReq({ method: 'GET', headers: { origin: 'http://localhost', host: 'localhost' } }))
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('text/html')
    expect(res.body).toContain('<!DOCTYPE html>')
    expect(res.body).not.toContain('__ZCTX_BRIDGE_TOKEN__')
    expect(res.body).toMatch(/zctx_[0-9a-z]+_[0-9a-f]{32}/)
    // UI page contains all three blocks
    expect(res.body).toContain('查看')
    expect(res.body).toContain('统计')
    expect(res.body).toContain('设置')
    expect(res.body).toContain('BETA')
  })

  it('GET /zctx-ui/api/snapshot returns 200 JSON snapshot; ?session= resolves explicit', async () => {
    const { routes } = setup()
    const res = await call(
      routes.get('/zctx-ui/api/snapshot')!,
      mockReq({ method: 'GET', url: '/zctx-ui/api/snapshot?session=sess-A', headers: { origin: 'http://localhost', host: 'localhost' } }),
    )
    expect(res.status).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.version).toBe(1)
    expect(body.sessionResolution).toBe('explicit')
    expect(body.sessionId).toBe('sess-A')
  })

  it('GET /zctx-ui/api/config returns 200 JSON config view', async () => {
    const { routes } = setup()
    const res = await call(
      routes.get('/zctx-ui/api/config')!,
      mockReq({ method: 'GET', headers: { origin: 'http://localhost', host: 'localhost' } }),
    )
    expect(res.status).toBe(200)
    expect(JSON.parse(res.body)).toEqual(configView)
  })

  it('POST /zctx-ui/api/config reads async-iterable body and writes via configEditor.edit', async () => {
    const { routes } = setup()
    const patch = { enabled: false, maxFoldFraction: 0.5 }
    const res = await call(
      routes.get('/zctx-ui/api/config#2')!,
      mockReq({
        method: 'POST',
        headers: { origin: 'http://localhost', host: 'localhost' },
        remoteAddress: '127.0.0.1',
        body: JSON.stringify(patch),
      }),
    )
    expect(res.status).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ ok: true })
    expect(editCalls).toHaveLength(1)
    expect(editCalls[0].patch).toEqual(patch)
    expect(editCalls[0].entry).toMatchObject({ options: { id: 'dsh-zcontext' } })
  })

  it('POST rejects unknown keys (400) and never calls edit', async () => {
    const { routes } = setup()
    const res = await call(
      routes.get('/zctx-ui/api/config#2')!,
      mockReq({
        method: 'POST',
        headers: { origin: 'http://localhost', host: 'localhost' },
        remoteAddress: '127.0.0.1',
        body: JSON.stringify({ providers: [] }),
      }),
    )
    expect(res.status).toBe(400)
    expect(editCalls).toHaveLength(0)
  })

  it('no token + remote non-loopback → 403 on snapshot GET', async () => {
    const { routes } = setup()
    const res = await call(
      routes.get('/zctx-ui/api/snapshot')!,
      mockReq({ method: 'GET', remoteAddress: '8.8.8.8' }),
    )
    expect(res.status).toBe(403)
    expect(JSON.parse(res.body)).toEqual({ ok: false, error: 'unauthorized' })
  })

  it('POST remote non-loopback without token → 403 (write tightened)', async () => {
    const { routes } = setup()
    const res = await call(
      routes.get('/zctx-ui/api/config#2')!,
      mockReq({ method: 'POST', headers: { host: 'example.com' }, remoteAddress: '8.8.8.8', body: '{}' }),
    )
    expect(res.status).toBe(403)
    expect(editCalls).toHaveLength(0)
  })

  it('method mismatch → 405', async () => {
    const { routes } = setup()
    const res = await call(
      routes.get('/zctx-ui/api/snapshot')!,
      mockReq({ method: 'POST', headers: { origin: 'http://localhost', host: 'localhost' } }),
    )
    expect(res.status).toBe(405)
  })

  it('registers the disposer via ctx.effect exactly ONCE (B5-2 dedup)', () => {
    const effectLabels: string[] = []
    const { webServer } = mockWebServer()
    const effectCtx = {
      ...ctx,
      effect: (_fn: unknown, label?: string) => { effectLabels.push(label ?? ''); return undefined },
    }
    registerUiRoutes({
      ctx: effectCtx,
      webServer,
      pageHtml: UI_PAGE_HTML,
      snapshotFor: (id) => snapshotSource.snapshotFor(id),
      getConfig: () => configView,
      writeConfig: () => ({ ok: true }),
    })
    const uiRouteEffects = effectLabels.filter((label) => label === 'zctx-ui-routes')
    expect(uiRouteEffects).toHaveLength(1)
  })

  it('disposer unregisters all routes', () => {
    const { routes, unregistered, disposer } = setup()
    expect(routes.size).toBe(4)
    disposer()
    expect(unregistered).toHaveLength(4)
  })

  it('no webServer (CLI headless) → no-op disposer, no throw', () => {
    const disposer = registerUiRoutes({
      ctx: { get: () => undefined },
      pageHtml: UI_PAGE_HTML,
      snapshotFor: (id) => snapshotSource.snapshotFor(id),
      getConfig: () => configView,
      writeConfig: () => ({ ok: false, error: 'unavailable' }),
    })
    expect(() => disposer()).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// V4 credential-literal guard — source has no usable token literal
// ---------------------------------------------------------------------------

describe('ZCTX-UI V4: zero credential literals in source', () => {
  it('auth.ts generates tokens only via node:crypto randomBytes (no literal)', async () => {
    const { readFile } = await import('node:fs/promises')
    const { fileURLToPath } = await import('node:url')
    const src = await readFile(fileURLToPath(new URL('../src/ui/auth.ts', import.meta.url)), 'utf8')
    expect(src).toContain('randomBytes')
    // No hard-coded credential literal of the token shape (prefix + hex blob).
    expect(src).not.toMatch(/['"`]zctx_[0-9a-z]+_[0-9a-f]{16,}['"`]/)
  })
})

// ---------------------------------------------------------------------------
// B5 rework r1: multi-session switcher (B5-5) + attribute escaping (B5-6)
// ---------------------------------------------------------------------------

describe('ZCTX-UI B5-5/B5-6: page session switcher + escaping', () => {
  it('page has a REAL session <select> wired to availableSessions + change handler', () => {
    // A real control (not a fake): the select exists, is populated from the
    // snapshot.availableSessions field, and switching triggers a re-poll.
    expect(UI_PAGE_HTML).toContain('id="session-pick"')
    expect(UI_PAGE_HTML).toContain('s.availableSessions')
    expect(UI_PAGE_HTML).toContain("addEventListener('change'")
    expect(UI_PAGE_HTML).toContain("?session=' + encodeURIComponent(session)")
    // The snapshot API actually exposes the field (thin wrapper over liveSessions).
    expect(UI_PAGE_HTML).not.toContain('__TODO_SESSION_PICKER__')
  })

  it('esc() escapes both quote kinds (B5-6): no attribute-breaking raw quotes', () => {
    // The esc helper in the page must cover &<>"' — assert the replacement
    // chains are present in source (string-level; the JS runs in browser).
    expect(UI_PAGE_HTML).toContain("replace(/\"/g, '&quot;')")
    expect(UI_PAGE_HTML).toContain("replace(/'/g, '&#39;')")
    // Attribute contexts use escAttr (the aliased esc) for the form value.
    expect(UI_PAGE_HTML).toContain('escAttr(')
  })
})
