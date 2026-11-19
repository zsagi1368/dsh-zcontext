/**
 * ZCTX-UI B6 P0 regression locks — webServer inject declaration (真机 404 fix).
 *
 * Real-device root cause: the desktop host provides `webServer` through the
 * web/desktop profile, but the plugin declared no `webServer` in `static inject`,
 * so `ctx.get('webServer')` stayed undefined while that provider was not
 * ACTIVE (cordis strict get) → registerUiRoutes silently skipped all four
 * routes → GET /zctx-ui returned 404. These tests lock the fix:
 *   1. static inject declares webServer (the Z21 anti-PENDING discipline);
 *   2. face probe surfaces a webServer signal and degrades visibly when absent;
 *   3. attachUi registers all four routes when webServer is present, and
 *      degrades to a no-op (no throw) when absent.
 */

import { describe, expect, it } from 'vitest'

import { ZcontextPlugin } from '../src/plugin.ts'
import {
  attachUi,
  detectFaceActivation,
  UI_PAGE_HTML,
  type ConfigView,
  type FaceHealthView,
} from '../src/ui/index.ts'

type Handler = (req: unknown, res: unknown) => void | Promise<void>

function mockCtx(webServer: unknown): {
  ctx: Record<string, unknown>
  routes: Map<string, Handler>
  unregistered: string[]
  effectLabels: string[]
  infoLines: string[]
} {
  const routes = new Map<string, Handler>()
  const unregistered: string[] = []
  const effectLabels: string[] = []
  const infoLines: string[] = []
  const web = (webServer === undefined || webServer === null)
    ? undefined
    : webServer as { register(def: { kind: string; path: string; handler: Handler }): () => void }
  const ctx: Record<string, unknown> = {
    get(key: string) {
      if (key === 'webServer') return web
      if (key === 'configEditor') return undefined
      return undefined
    },
    logger: { info: (m: string) => infoLines.push(m) },
    effect: (_fn: unknown, label?: string) => { effectLabels.push(label ?? ''); return undefined },
  }
  // Only provide a webServer service when one was supplied (headless simulate).
  if (web !== undefined) {
    ;(web as { register: unknown }).register = (def: { kind: string; path: string; handler: Handler }) => {
      const key = routes.has(def.path) ? `${def.path}#2` : def.path
      routes.set(key, def.handler)
      return () => { unregistered.push(key) }
    }
  }
  return { ctx, routes, unregistered, effectLabels, infoLines }
}

const configView: ConfigView = { fields: { enabled: true }, faceSwitches: { preflightMode: 'observe' }, writable: false }
const snapshotStub = () => ({
  version: 1 as const,
  generatedAt: 0,
  availableSessions: [],
  sessionId: undefined,
  sessionResolution: 'none' as const,
  window: { contextWindow: undefined, totalTokens: undefined, pressurePct: undefined, routed: undefined },
  budget: undefined,
  ranges: [],
  folds: [],
  attribution: undefined,
  cache: { samples: 0, measured: false, basis: 'none' as const },
  faceHealth: { state: 'absent' as const, evidence: [], probedAt: 0, summary: '' },
  degraded: [],
})

const activeProbeState = {
  toolFaceRegistered: 4,
  toolFaceBuilt: 4,
  guidanceRegistered: true,
  observeWired: true,
  guardBridgePresent: true,
  guardRecordsSeen: 1,
}

describe('ZCTX-UI B6 P0: webServer inject declaration', () => {
  it('static inject declares webServer (the real-device 404 root cause)', () => {
    expect(ZcontextPlugin.inject).toContain('webServer')
    // all five prior keys still present — additive fix, no regression
    for (const key of ['tools', 'systemPrompt', 'commands', 'llm', 'tokenMeter']) {
      expect(ZcontextPlugin.inject).toContain(key)
    }
  })

  it('webServer absent → face probe reports degraded with a visible sink line', () => {
    const lines: string[] = []
    const view = detectFaceActivation(
      { tools: { register: () => undefined }, systemPrompt: { section: () => undefined } },
      { ...activeProbeState, webServerPresent: false },
      (line) => { lines.push(line) },
    )
    expect(view.state).toBe('degraded')
    const ws = view.evidence.find((e) => e.signal === 'webServer')
    expect(ws?.ok).toBe(false)
    expect(ws?.detail).toContain('NOT registered')
    expect(lines.some((line) => line.includes('webServer'))).toBe(true)
  })

  it('webServer present + other signals active → face probe active', () => {
    const view = detectFaceActivation(
      { tools: { register: () => undefined }, systemPrompt: { section: () => undefined } },
      { ...activeProbeState, webServerPresent: true },
      () => undefined,
    )
    expect(view.state).toBe('active')
    expect(view.evidence.find((e) => e.signal === 'webServer')?.ok).toBe(true)
  })
})

describe('ZCTX-UI B6 P0: attachUi route registration vs webServer availability', () => {
  it('webServer present → attachUi registers all four /zctx-ui routes', () => {
    const { ctx, routes } = mockCtx({})
    attachUi(ctx, {
      snapshotFor: snapshotStub,
      configValues: () => ({}),
    })
    expect(routes.size).toBe(4)
    for (const path of ['/zctx-ui', '/zctx-ui/api/snapshot', '/zctx-ui/api/config', '/zctx-ui/api/config#2']) {
      expect(routes.has(path)).toBe(true)
    }
  })

  it('webServer absent → attachUi degrades gracefully (no-op, no throw)', () => {
    const { ctx, routes, infoLines } = mockCtx(undefined)
    expect(() => attachUi(ctx, {
      snapshotFor: snapshotStub,
      configValues: () => ({}),
    })).not.toThrow()
    expect(routes.size).toBe(0)
    expect(infoLines.some((line) => line.includes('webServer unavailable'))).toBe(true)
  })
})
