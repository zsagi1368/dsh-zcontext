/**
 * P4 patch-bridge tests (task card P4 product 2/3): the receiving side of the
 * external app.asar patch — `globalThis.__zctxPatch__.wireOptions` armed at
 * plugin startup, the SAME wire faces as the plugin's own adapter
 * (onPayload observe-only R1, fetch hashing the final bytes, R7 attribution
 * riding via the fetch wrapper's additive init.headers merge because the
 * stub's headers face loses to the official explicit `headers:` key by
 * construction), the {}-degrade ladder (non-object identity / missing fields
 * / unwatched session / unreachable host / internal throw), last-wins
 * mounting, and the zctx_status dual-source segment (filesystem marker +
 * runtime mount).
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  PATCH_BRIDGE_KEY,
  createPatchBridge,
  isPatchBridgeMounted,
  mountPatchBridge,
  patchMarkerDir,
  readPatchMarker,
} from '../src/patch-bridge.ts'
import { renderStatus } from '../src/tools.ts'
import { ZcontextPlugin } from '../src/plugin.ts'
import type { HostContextLike } from '../src/plugin.ts'
import type { HostLlmFace } from '../src/adapter/host.ts'
import type { SessionLike, WireSnapshot } from '../src/types.ts'
import type { PatchBridgeDeps } from '../src/patch-bridge.ts'
import { disciplinedCtx, routeOverrides } from './helpers/mock-host.ts'
import { seedConversation } from './helpers/mock-session.ts'
import { FoldStore } from '../src/store.ts'

/** The attribution host stub (same shape as adapter-wire.spec's HOST). */
const HOST = {
  attributionHeaders: () => ({ 'x-dsh-attribution': 'zctx', 'x-dsh-runtime': 'test' }),
} as unknown as HostLlmFace

interface BridgeFixture {
  readonly snapshots: WireSnapshot[]
  readonly deps: PatchBridgeDeps
  readonly session: SessionLike
}

function bridgeDeps(overrides: Partial<PatchBridgeDeps> = {}): BridgeFixture {
  const snapshots: WireSnapshot[] = []
  const session = { id: 'sess-patch' } as unknown as SessionLike
  const deps: PatchBridgeDeps = {
    resolveWatchedSession: (sessionId) => (sessionId === 'sess-patch' ? session : undefined),
    sink: (snapshot) => snapshots.push(snapshot),
    hostFace: () => HOST,
    ...overrides,
  }
  return { snapshots, deps, session }
}

/** The identity the patched stub forwards (the patcher stub's object literal). */
const STUB_IDENTITY = { provider: 'deepseek', model: 'deepseek-chat', sessionId: 'sess-patch' }

/** Structural view of what wireOptions returns (the .mjs result fields are unknown). */
type BridgeFaces = {
  onPayload?: (payload: unknown, model: unknown) => undefined
  fetch?: typeof globalThis.fetch
  headers?: Record<string, string>
}
const facesOf = (result: unknown): BridgeFaces => result as BridgeFaces

/** The recording fetch mock (declared args → typed mock.calls). */
const recordFetch = (): ReturnType<typeof vi.fn> =>
  vi.fn(async (_input: Parameters<typeof fetch>[0], _init?: RequestInit) => new Response('ok'))

afterEach(() => {
  delete (globalThis as Record<string, unknown>)[PATCH_BRIDGE_KEY]
  vi.unstubAllGlobals()
})

// ---------------------------------------------------------------------------
// The {}-degrade ladder.
// ---------------------------------------------------------------------------

describe('patch bridge wireOptions: the {}-degrade ladder', () => {
  it('degrades to {} for a non-object identity, missing fields, and an unwatched session', () => {
    const { deps } = bridgeDeps()
    const bridge = createPatchBridge(deps)
    expect(bridge.wireOptions(undefined)).toEqual({})
    expect(bridge.wireOptions('not-an-object')).toEqual({})
    expect(bridge.wireOptions({})).toEqual({})
    expect(bridge.wireOptions({ provider: 'deepseek', model: 'deepseek-chat' })).toEqual({})
    expect(bridge.wireOptions({ provider: 'deepseek', sessionId: 'sess-patch' })).toEqual({})
    expect(bridge.wireOptions({ model: 'deepseek-chat', sessionId: 'sess-patch' })).toEqual({})
    expect(bridge.wireOptions({ provider: 'deepseek', model: 'deepseek-chat', sessionId: '' })).toEqual({})
    expect(bridge.wireOptions({ provider: 'deepseek', model: 'deepseek-chat', sessionId: 'sess-unwatched' })).toEqual({})
  })

  it('serves the ledger with an EMPTY attribution set (warn-once) when the host face is unreachable', async () => {
    const logLines: string[] = []
    const { deps, snapshots } = bridgeDeps({ hostFace: () => undefined, logger: { warn: (m) => logLines.push(m) } })
    const realFetch = recordFetch()
    vi.stubGlobal('fetch', realFetch)
    const bridge = createPatchBridge(deps)
    // The ledger SERVES (hash records land); only attribution is absent.
    const faces = facesOf(bridge.wireOptions(STUB_IDENTITY))
    expect(faces.onPayload).toBeTypeOf('function')
    expect(faces.fetch).toBeTypeOf('function')
    expect(faces.headers).toEqual({})
    expect(faces.onPayload?.({ ping: 1 }, 'deepseek-chat')).toBeUndefined()
    expect(snapshots).toHaveLength(1)
    // The fetch wrapper passes init UNTOUCHED (empty attribution set → no
    // injection, R1 holds).
    await (faces.fetch as typeof fetch)('https://gateway.example/v1/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    const [, init] = realFetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(init.headers).toEqual({ 'content-type': 'application/json' })
    expect(logLines).toHaveLength(1) // warn-once, never per request
    expect(logLines[0]).toContain('without attribution headers')
  })

  it('degrades to {} (warn-once) when its internals throw — never breaks the official request', () => {
    const logLines: string[] = []
    const { deps } = bridgeDeps({
      // A hostile registry that throws instead of answering.
      resolveWatchedSession: () => {
        throw new Error('registry exploded')
      },
      logger: { warn: (m) => logLines.push(m) },
    })
    const bridge = createPatchBridge(deps)
    expect(bridge.wireOptions(STUB_IDENTITY)).toEqual({})
    expect(bridge.wireOptions(STUB_IDENTITY)).toEqual({})
    expect(logLines).toHaveLength(1)
    expect(logLines[0]).toContain('registry exploded')
  })
})

// ---------------------------------------------------------------------------
// The wire faces (R1/R7).
// ---------------------------------------------------------------------------

describe('patch bridge wireOptions: the wire faces (R1/R7)', () => {
  it('serves onPayload observe-only routed to the per-session ledger', () => {
    const { deps, snapshots } = bridgeDeps()
    const bridge = createPatchBridge(deps)
    const faces = facesOf(bridge.wireOptions(STUB_IDENTITY))
    expect(faces.onPayload).toBeTypeOf('function')
    const payload = { model: 'deepseek-chat', messages: [{ role: 'user', content: 'hi' }] }
    // R1: undefined CONSTANTLY — never a replacement.
    expect(faces.onPayload?.(payload, 'deepseek-chat')).toBeUndefined()
    expect(faces.onPayload?.(payload, 'deepseek-chat')).toBeUndefined()
    expect(snapshots).toHaveLength(2)
    expect(snapshots[0]).toMatchObject({
      domain: 'wire',
      sessionId: 'sess-patch',
      provider: 'deepseek',
      model: 'deepseek-chat',
      kind: 'request-payload',
    })
  })

  it('serves a fetch that hashes the final body bytes and forwards untouched', async () => {
    const { deps, snapshots } = bridgeDeps()
    const realFetch = recordFetch()
    vi.stubGlobal('fetch', realFetch)
    const bridge = createPatchBridge(deps)
    const faces = facesOf(bridge.wireOptions(STUB_IDENTITY))
    expect(faces.fetch).toBeTypeOf('function')
    const body = '{"messages":[]}'
    const response = await (faces.fetch as typeof fetch)('https://gateway.example/v1/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    })
    expect(await response.text()).toBe('ok')
    expect(realFetch).toHaveBeenCalledTimes(1)
    const [input, init] = realFetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(input).toBe('https://gateway.example/v1/chat')
    expect(init.body).toBe(body) // R1: forwarded untouched
    expect(snapshots).toHaveLength(1)
    expect(snapshots[0]).toMatchObject({
      domain: 'wire',
      kind: 'request-bytes',
      sessionId: 'sess-patch',
      provider: 'deepseek',
      model: 'deepseek-chat',
      byteLength: body.length,
    })
  })

  it('merges attribution headers into plain-object init (attribution wins collisions, R7)', async () => {
    const { deps } = bridgeDeps()
    const realFetch = recordFetch()
    vi.stubGlobal('fetch', realFetch)
    const bridge = createPatchBridge(deps)
    const faces = facesOf(bridge.wireOptions(STUB_IDENTITY))
    await (faces.fetch as typeof fetch)('https://gateway.example/v1/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dsh-attribution': 'deployment-set' },
      body: '{}',
    })
    const [, init] = realFetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(init.headers).toMatchObject({
      'content-type': 'application/json',
      'x-dsh-attribution': 'zctx', // attribution WINS the case-insensitive collision
      'x-dsh-runtime': 'test',
    })
  })

  it('merges attribution into a Headers instance and seeds undefined headers', async () => {
    const { deps } = bridgeDeps()
    const realFetch = recordFetch()
    vi.stubGlobal('fetch', realFetch)
    const bridge = createPatchBridge(deps)
    const faces = facesOf(bridge.wireOptions(STUB_IDENTITY))

    const headers = new Headers({ 'content-type': 'application/json' })
    await (faces.fetch as typeof fetch)('https://gateway.example/v1/chat', { method: 'POST', headers, body: '{}' })
    const [, headersInit] = realFetch.mock.calls[0] as unknown as [string, RequestInit]
    const merged = headersInit.headers as Headers
    expect(merged).toBeInstanceOf(Headers)
    expect(merged.get('content-type')).toBe('application/json')
    expect(merged.get('x-dsh-attribution')).toBe('zctx')
    expect(merged.get('x-dsh-runtime')).toBe('test')

    await (faces.fetch as typeof fetch)('https://gateway.example/v1/chat', { method: 'POST', body: '{}' })
    const [, plainInit] = realFetch.mock.calls[1] as unknown as [string, RequestInit]
    expect(plainInit.headers).toEqual({ 'x-dsh-attribution': 'zctx', 'x-dsh-runtime': 'test' })
  })

  it('passes unknown header shapes through untouched (honest, R1 holds)', async () => {
    const { deps } = bridgeDeps()
    const realFetch = recordFetch()
    vi.stubGlobal('fetch', realFetch)
    const bridge = createPatchBridge(deps)
    const faces = facesOf(bridge.wireOptions(STUB_IDENTITY))
    const arrayHeaders: [string, string][] = [['content-type', 'application/json']]
    await (faces.fetch as typeof fetch)('https://gateway.example/v1/chat', { method: 'POST', headers: arrayHeaders, body: '{}' })
    const [, init] = realFetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(init.headers).toBe(arrayHeaders) // identity — untouched
  })
})

// ---------------------------------------------------------------------------
// Mounting.
// ---------------------------------------------------------------------------

describe('mountPatchBridge: last-wins globalThis arm', () => {
  it('arms globalThis.__zctxPatch__ and a second mount REPLACES it', () => {
    const { deps } = bridgeDeps()
    const first = mountPatchBridge(deps)
    expect(first.mountState).toBe('armed')
    expect(isPatchBridgeMounted()).toBe(true)
    expect((globalThis as Record<string, unknown>)[PATCH_BRIDGE_KEY]).toBe(first.bridge)

    const second = mountPatchBridge(deps)
    expect(second.mountState).toContain('replaced a previous mount')
    expect((globalThis as Record<string, unknown>)[PATCH_BRIDGE_KEY]).toBe(second.bridge)
    expect((globalThis as Record<string, unknown>)[PATCH_BRIDGE_KEY]).not.toBe(first.bridge)
  })
})

// ---------------------------------------------------------------------------
// Marker reading (the status filesystem source).
// ---------------------------------------------------------------------------

describe('readPatchMarker: the filesystem truth', () => {
  let dir: string | undefined
  afterEach(() => {
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
    dir = undefined
    delete (process as { resourcesPath?: string }).resourcesPath
  })

  it('reads present/absent/unknown states from the marker file', () => {
    dir = mkdtempSync(join(tmpdir(), 'zctx-marker-'))
    expect(readPatchMarker(dir)).toMatchObject({ state: 'absent', path: join(dir, '.zctx-patch.json') })
    writeFileSync(
      join(dir, '.zctx-patch.json'),
      JSON.stringify({ patcher: 'zctx-patch', shellVersion: '0.2.2-rc.3', timestamp: '2026-11-14T03:21:00.000Z', target: 'dsh/.../lib/index.js' }),
    )
    expect(readPatchMarker(dir)).toMatchObject({
      state: 'present',
      version: '0.2.2-rc.3',
      timestamp: '2026-11-14T03:21:00.000Z',
    })
    writeFileSync(join(dir, '.zctx-patch.json'), '{corrupted')
    expect(readPatchMarker(dir)).toMatchObject({ state: 'unknown' })
  })

  it('resolves the app dir from process.resourcesPath when no dir is passed', () => {
    expect(patchMarkerDir()).toBeUndefined() // vitest: no Electron resourcesPath
    expect(readPatchMarker()).toMatchObject({ state: 'unknown', reason: expect.stringContaining('app dir not reachable') })
    dir = mkdtempSync(join(tmpdir(), 'zctx-marker-'))
    ;(process as { resourcesPath?: string }).resourcesPath = join(dir, 'resources')
    expect(patchMarkerDir()).toBe(dir)
    expect(readPatchMarker()).toMatchObject({ state: 'absent', path: join(dir, '.zctx-patch.json') })
  })
})

// ---------------------------------------------------------------------------
// Plugin integration: the mount at construction + the status dual source.
// ---------------------------------------------------------------------------

interface MockCtx extends HostContextLike {
  readonly registeredCommands: unknown[]
  readonly logLines: { level: string; message: string }[]
  emit(event: string, ...args: unknown[]): void
}

function mockCtx(): MockCtx {
  const logLines: { level: string; message: string }[] = []
  const registeredCommands: unknown[] = []
  const listeners = new Map<string, ((...args: never[]) => unknown)[]>()
  const target: Record<string, unknown> = {
    logLines,
    registeredCommands,
    listeners,
    logger: {
      info: (m: string) => logLines.push({ level: 'info', message: m }),
      warn: (m: string) => logLines.push({ level: 'warn', message: m }),
    },
    reflect: { provide: () => undefined },
    emit(event: string, ...args: unknown[]): void {
      for (const listener of listeners.get(event) ?? []) (listener as (...a: unknown[]) => unknown)(...args)
    },
    on(event: string, listener: (...args: never[]) => unknown) {
      const list = listeners.get(event) ?? []
      list.push(listener)
      listeners.set(event, list)
      return () => undefined
    },
  }
  const store: Record<string, unknown> = {
    commands: { register: (c: unknown) => registeredCommands.push(c) },
    tokenMeter: { measure: () => ({ totalTokens: 100000 }) },
    llm: { resolveModelInfo: async () => ({ context: { contextWindow: 200000 } }) },
  }
  routeOverrides({} as Record<string, unknown>, store, target, ZcontextPlugin.inject)
  return disciplinedCtx<MockCtx>({ target, store, inject: ZcontextPlugin.inject })
}

function commandOf(ctx: MockCtx): {
  handler: (invocation: { agent?: { session?: SessionLike }; rawInput: string }) => Promise<{ kind: string; text?: string }>
} {
  return ctx.registeredCommands[0] as {
    handler: (invocation: { agent?: { session?: SessionLike }; rawInput: string }) => Promise<{ kind: string; text?: string }>
  }
}

let markerDir: string | undefined

describe('ZcontextPlugin: the patch-bridge face', () => {
  afterEach(() => {
    if (markerDir !== undefined) rmSync(markerDir, { recursive: true, force: true })
    markerDir = undefined
    delete (process as { resourcesPath?: string }).resourcesPath
  })

  it('arms globalThis at construction (last-wins over other mounts) and logs it', () => {
    // A previous mount (e.g. from an older instance) is replaced honestly.
    ;(globalThis as Record<string, unknown>)[PATCH_BRIDGE_KEY] = { wireOptions: () => ({}) }
    const ctx = mockCtx()
    const plugin = new ZcontextPlugin(ctx)
    const mounted = (globalThis as Record<string, unknown>)[PATCH_BRIDGE_KEY]
    expect(mounted).toBeDefined()
    expect(isPatchBridgeMounted()).toBe(true)
    // The armed bridge answers the stub contract (degrades {} here: the
    // session is not watched by THIS instance's registry).
    const wireOptions = (mounted as { wireOptions: (info: unknown) => unknown }).wireOptions
    expect(wireOptions({ provider: 'deepseek', model: 'm', sessionId: 'nope' })).toEqual({})
    expect(ctx.logLines.some((line) => line.level === 'info' && line.message.includes('patch bridge armed'))).toBe(true)
    void plugin
  })

  it('does NOT arm when disabled (the patched stub stays zero-op)', () => {
    const ctx = mockCtx()
    new ZcontextPlugin(ctx, { enabled: false })
    expect((globalThis as Record<string, unknown>)[PATCH_BRIDGE_KEY]).toBeUndefined()
    expect(ctx.logLines.some((line) => line.message.includes('disabled by config'))).toBe(true)
  })

  it('zctx_status renders the patch segment from BOTH sources (marker + mount)', async () => {
    // No process.resourcesPath in vitest → the filesystem half is honestly
    // 'unknown (app dir not reachable)', the runtime half 'armed'.
    const ctx = mockCtx()
    new ZcontextPlugin(ctx)
    const session = seedConversation().session
    const result = await commandOf(ctx).handler({ agent: { session }, rawInput: 'status' })
    expect(result.kind).toBe('success')
    expect(result.text).toContain('Patch bridge (official-adapter wire stub):')
    expect(result.text).toContain('patch marker: unknown (app dir not reachable')
    expect(result.text).toContain('wireOptions: armed')

    // The filesystem half flips to absent/present once the app dir resolves.
    markerDir = mkdtempSync(join(tmpdir(), 'zctx-plugin-status-'))
    ;(process as { resourcesPath?: string }).resourcesPath = join(markerDir, 'resources')
    const absent = await commandOf(ctx).handler({ agent: { session }, rawInput: 'status' })
    expect(absent.text).toContain('patch marker: absent (official adapter unpatched — pure-plugin face)')
    writeFileSync(
      join(markerDir, '.zctx-patch.json'),
      JSON.stringify({ shellVersion: '0.2.2-rc.3', timestamp: '2026-11-14T03:21:00.000Z' }),
    )
    const present = await commandOf(ctx).handler({ agent: { session }, rawInput: 'status' })
    expect(present.text).toContain('patch marker: present (v0.2.2-rc.3, patched 2026-11-14T03:21:00.000Z)')
  })

  it('the armed bridge resolves a LIVE watched session (faces served, attribution degraded)', async () => {
    const ctx = mockCtx()
    new ZcontextPlugin(ctx)
    const { session } = seedConversation()
    // The mock session has no id; give it one (official Session carries
    // `id: SessionId`) and feed it through the feed (the registry the bridge
    // resolves against).
    const sessionId = 'sess-bridge-live'
    ;(session as unknown as { id?: string }).id = sessionId
    ctx.emit('session/created', session)
    const mounted = (globalThis as Record<string, unknown>)[PATCH_BRIDGE_KEY] as {
      wireOptions: (info: unknown) => unknown
    }
    // Wait for the host-face loader to settle (vitest env: unreachable).
    await new Promise((resolve) => setTimeout(resolve, 20))
    // The 'without attribution headers' warn can only fire AFTER the identity
    // validation AND the watched-session resolution passed — so the warn IS
    // the proof that the bridge resolved the LIVE session (and the ledger
    // faces are served regardless of the host face).
    const faces = mounted.wireOptions({ provider: 'zctx-anthropic-messages', model: 'm1', sessionId }) as {
      onPayload?: unknown
      fetch?: unknown
      headers?: unknown
    }
    expect(faces.onPayload).toBeTypeOf('function')
    expect(faces.fetch).toBeTypeOf('function')
    expect(faces.headers).toEqual({})
    expect(ctx.logLines.some((line) => line.message.includes('without attribution headers'))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// renderStatus: the patch segment (minimal runtime, isolated from the plugin).
// ---------------------------------------------------------------------------

describe('renderStatus: the patch segment (minimal runtime)', () => {
  function minimalRuntime(markerReadDir: string): Parameters<typeof renderStatus>[0] {
    const store = new FoldStore()
    const session = { seq: 0, surface: { nodes: [] }, eventAt: () => undefined } as never
    store.attach(session as SessionLike)
    return {
      cleanSampleFloor: 0.6,
      preflightMode: 'observe' as const,
      storeFor: () => store,
      validatorConfig: () => ({
        keepRecentMessages: 0,
        keepRecentTokens: 0,
        protectionFloorTokens: 0,
        minFoldableTokens: 5,
        maxFoldFraction: 0.6,
        summaryFloorChars: 10,
        summaryCeilingChars: 20000,
        netShrinkTolerance: 1.05,
      }),
      patchFace: () => ({
        mount: 'armed',
        marker: readPatchMarker(markerReadDir),
        hostFaces: 'unreachable',
      }),
    } as Parameters<typeof renderStatus>[0]
  }

  it('renders header + marker line + mount line as facts (dual source)', async () => {
    markerDir = mkdtempSync(join(tmpdir(), 'zctx-render-'))
    try {
      const session = { seq: 0, surface: { nodes: [] }, eventAt: () => undefined } as never
      const status = await renderStatus(minimalRuntime(markerDir), session)
      expect(status).toContain('Patch bridge (official-adapter wire stub):')
      expect(status).toContain('patch marker: absent (official adapter unpatched — pure-plugin face)')
      expect(status).toContain('wireOptions: armed / host faces: unreachable')

      // Present marker → version + timestamp render (filesystem truth).
      writeFileSync(
        join(markerDir, '.zctx-patch.json'),
        JSON.stringify({ shellVersion: '0.2.2-rc.3', timestamp: '2026-11-14T03:21:00.000Z' }),
      )
      const patched = await renderStatus(minimalRuntime(markerDir), session)
      expect(patched).toContain('patch marker: present (v0.2.2-rc.3, patched 2026-11-14T03:21:00.000Z)')

      // Unreadable marker → the honest unknown shape.
      writeFileSync(join(markerDir, '.zctx-patch.json'), '{nope')
      const unknown = await renderStatus(minimalRuntime(markerDir), session)
      expect(unknown).toContain('patch marker: unknown (')

      // Older runtime without the hook → the segment is skipped.
      const legacy = { ...minimalRuntime(markerDir), patchFace: undefined } as Parameters<typeof renderStatus>[0]
      const withoutSegment = await renderStatus(legacy, session)
      expect(withoutSegment).not.toContain('Patch bridge (official-adapter wire stub):')
    } finally {
      rmSync(markerDir, { recursive: true, force: true })
      markerDir = undefined
    }
  })
})
