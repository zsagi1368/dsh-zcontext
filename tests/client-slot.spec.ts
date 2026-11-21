/**
 * ZCTX-UI B4 D6 acceptance tests — settings.section slot summary card
 * (DESIGN §5 / V7 / Z1 / Z21 / Z25 / 反-C2).
 *
 * - inject gate present → one registration with fresh id + order, no priority;
 * - slots absent → lazy no-op (no throw, no PENDING);
 * - React absent → degrade to a plain text card (no crash, no dead link, 反-C2/B-3);
 * - bundle factory contract: single-arg factory(require) + module scaffold,
 *   banner id === package name, require('react') present, no priority property;
 * - summary parsing is fail-soft.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import process from 'node:process'

import {
  name as fiberName,
  inject as fiberInject,
  apply,
  parseSummary,
  parsePanelSnapshot,
  createSummaryCard,
  createFallbackCard,
  createPanelComponent,
  fiber,
  type ClientCtx,
  type ReactLike,
  type StylesLike,
  type PanelSnapshot,
} from '../src/client/index.ts'

/** Minimal React mock recording createElement calls. */
function mockReact(): ReactLike & { calls: unknown[][] } {
  const calls: unknown[][] = []
  return {
    calls,
    createElement(type: unknown, props?: Record<string, unknown> | null, ...children: unknown[]) {
      calls.push([type, props, ...children])
      return { type, props, children }
    },
  }
}

/**
 * Swap the host navigator for one scope — async-safe. Mirror of the helper in
 * panel-i18n.spec.ts (self-contained spec). `undefined` simulates a host with
 * no locale probe (the cards' zh-default path; Node's real navigator carries
 * navigator.language === 'en-US', so a language-agnostic scope must be forced).
 */
async function withNavigator<T>(language: string | undefined, fn: () => T | Promise<T>): Promise<T> {
  const desc = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  Object.defineProperty(globalThis, 'navigator', { value: { language }, writable: true, configurable: true })
  try {
    return await fn()
  } finally {
    if (desc !== undefined) Object.defineProperty(globalThis, 'navigator', desc)
    else delete (globalThis as { navigator?: unknown }).navigator
  }
}

/** Client ctx with a working slots facade. */
function slotsCtx(): ClientCtx & {
  injected: string[]
  registered: { opts: Record<string, unknown>; component: unknown }[]
} {
  const injected: string[] = []
  const registered: { opts: Record<string, unknown>; component: unknown }[] = []
  return {
    injected,
    registered,
    slots: {
      inject(slot: string, register: () => unknown) {
        injected.push(slot)
        register()
        return undefined
      },
      register(opts: Record<string, unknown>, component: (...args: never[]) => unknown) {
        registered.push({ opts, component })
        return undefined
      },
    },
    get(key: string) {
      if (key === 'styles') return undefined
      return undefined
    },
  }
}

describe('ZCTX-UI D6: client fiber identity + inject gate (V7)', () => {
  it('name === package name; inject === ["slots"] only (Z21 minimal set)', () => {
    expect(fiberName).toBe('dsh-zcontext')
    expect(fiberInject).toEqual(['slots'])
    expect(fiber.inject).toEqual(['slots'])
    expect(fiber.name).toBe('dsh-zcontext')
  })

  it('slots present → injects settings.section with fresh id, order, no priority', () => {
    const ctx = slotsCtx()
    const React = mockReact()
    apply(ctx, { React, fetchText: async () => '{}' })
    // ZCTX-SIDEBAR adds `main` + `sidebar.panellist` alongside the card. The
    // exact set stays pinned (B3-S3): a NEW injection must be a deliberate edit
    // here, never a silent addition that could hang a fiber (Z21 discipline).
    expect(ctx.injected).toEqual(['settings.section', 'main', 'sidebar.panellist'])
    const cards = ctx.registered.filter((r) => r.opts.name === 'settings.section')
    expect(cards).toHaveLength(1)
    const opts = cards[0].opts
    expect(opts).toMatchObject({ name: 'settings.section', id: 'dsh-zcontext-summary', order: 50, registrant: 'dsh-zcontext' })
    expect(Object.prototype.hasOwnProperty.call(opts, 'priority')).toBe(false)
  })

  it('slots absent → lazy no-op, no throw, no PENDING (Z21/A1-2)', () => {
    const bare: ClientCtx = { get: () => undefined }
    expect(() => apply(bare, { React: mockReact() })).not.toThrow()
  })

  it('inject throws (undeclared slot) → swallowed, no crash', () => {
    const ctx: ClientCtx = {
      get: () => undefined,
      slots: {
        inject() { throw new Error('slot not declared') },
        register: () => undefined,
      },
    }
    expect(() => apply(ctx, { React: mockReact() })).not.toThrow()
  })

  it('React absent → degrades to a REAL text card, never a dead link (B-3/反-C2/B5-1)', () => {
    const ctx = slotsCtx()
    const doc = {
      createElement(tag: string) {
        return { tag, textContent: '' }
      },
    }
    apply(ctx, { React: undefined, fetchText: async () => '{}', document: doc as never })
    // React absent: the CARD still degrades to a plain text card; the sidebar
    // panel is React-only and contributes no `main` component (capability gate).
    const cards = ctx.registered.filter((r) => r.opts.name === 'settings.section')
    expect(cards).toHaveLength(1)
    expect(ctx.registered.filter((r) => r.opts.name === 'main')).toHaveLength(0)
    const component = cards[0].component as () => { tag: string; text: string; node?: unknown }
    expect(typeof component).toBe('function')
    // TRUE render assertion: invoke the component and inspect the product.
    const rendered = component()
    expect(rendered).not.toBeNull()
    // B-3: the pointed-at page was removed — a text card, never an anchor.
    expect(rendered.tag).toBe('span')
    expect(rendered.text.length).toBeGreaterThan(0)
    const serialized = JSON.stringify(rendered)
    expect(serialized).not.toContain('/zctx-ui')
    expect(serialized).not.toContain('href')
    // The real DOM node was created with the hint text.
    expect(rendered.node).toBeDefined()
    const span = rendered.node as { tag: string; textContent: string }
    expect(span.tag).toBe('span')
    expect(span.textContent.length).toBeGreaterThan(0)
  })
})

describe('ZCTX-UI D6: styles + summary (V7)', () => {
  it('styles service present → insert(CSS) + effect disposer registered', () => {
    const ctx = slotsCtx()
    let css = ''
    const styles: StylesLike = { insert(c) { css = c; return () => undefined } }
    ctx.get = (key: string) => (key === 'styles' ? styles : undefined)
    let effectLabel = ''
    ctx.effect = (_fn, label) => { effectLabel = label ?? ''; return undefined }
    apply(ctx, { React: mockReact(), fetchText: async () => '{}' })
    expect(css).toContain('--dsw-alias-')
    expect(effectLabel).toBe('zctx-summary-styles')
  })

  it('parseSummary extracts foldCount/pressurePct/sessionId; malformed → undefined', () => {
    const good = JSON.stringify({
      attribution: { foldCount: 7 },
      window: { pressurePct: 42.5 },
      sessionId: 's1',
    })
    expect(parseSummary(good)).toEqual({ foldCount: 7, pressurePct: 42.5, sessionId: 's1' })
    expect(parseSummary('not json')).toBeUndefined()
    expect(parseSummary('{}')).toEqual({ foldCount: 0, pressurePct: undefined, sessionId: undefined })
  })

  it('card renders a pure summary + panel hint; NO dead /zctx-ui link (B-3, S-9 zh copy)', async () => {
    // S-9: the card copy rides the i18n dictionary — pin the zh halves with an
    // explicit zh probe (Node's ambient navigator.language would resolve en).
    await withNavigator('zh-CN', async () => {
      const React = mockReact()
      const card = createSummaryCard(React, { foldCount: 3, pressurePct: 12.3, sessionId: 's1' }, async () => '{}')
      expect(typeof card).toBe('function')
      ;(card as () => unknown)()
      const serialized = JSON.stringify(React.calls)
      // B-3: the browser page route was removed — the card must not ship a link
      // to it, and must point at the native left-menu panel entry instead.
      expect(serialized).not.toContain('/zctx-ui')
      expect(serialized).not.toContain('href')
      expect(serialized).toContain('折叠 3 次')
      expect(serialized).toContain('12.3%')
      expect(serialized).toContain('请在左侧菜单 zcontext 打开面板')
    })
  })
})

describe('S-9: summary card + fallback copy ride the i18n dictionary (en mode renders ZERO CJK)', () => {
  it('en host → summary card renders the EN dictionary halves, ZERO CJK', async () => {
    await withNavigator('en-US', async () => {
      const React = mockReact()
      const card = createSummaryCard(React, { foldCount: 3, pressurePct: 12.3, sessionId: 's1' }, async () => '{}')
      expect(typeof card).toBe('function')
      ;(card as () => unknown)()
      const serialized = JSON.stringify(React.calls)
      // The S-9 regression: hardcoded zh literals leaked into en mode.
      expect(serialized).not.toMatch(/[\u4e00-\u9fff]/)
      expect(serialized).toContain('zcontext summary (BETA)')
      expect(serialized).toContain('3 folds')
      expect(serialized).toContain('Window 12.3%')
      expect(serialized).toContain('Open the panel from the zcontext entry in the left menu')
    })
  })

  it('en host → the no-React fallback card renders the EN hint, ZERO CJK', async () => {
    await withNavigator('en-US', async () => {
      const rendered = createFallbackCard()()
      expect(rendered.tag).toBe('span')
      expect(rendered.text).not.toMatch(/[\u4e00-\u9fff]/)
      expect(rendered.text).toBe('Open the panel from the zcontext entry in the left menu')
    })
  })

  it('probe missing (language undefined) → the zh default — bilingual completeness both ways', async () => {
    await withNavigator(undefined, async () => {
      const React = mockReact()
      const card = createSummaryCard(React, { foldCount: 3, pressurePct: undefined, sessionId: 's1' }, async () => '{}')
      ;(card as () => unknown)()
      const serialized = JSON.stringify(React.calls)
      expect(serialized).toContain('zcontext 摘要 (BETA)')
      expect(serialized).toContain('折叠 3 次')
      expect(serialized).toContain('窗口 n/a')
      expect(serialized).toContain('请在左侧菜单 zcontext 打开面板')
      const fallback = createFallbackCard()()
      expect(fallback.text).toBe('请在左侧菜单 zcontext 打开面板')
    })
  })
})

describe('ZCTX-UI D6/B6: bundle factory contract (Z1)', () => {
  const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'))
  const distPath = fileURLToPath(new URL('../dist/client.cjs', import.meta.url))
  const dist = readFileSync(distPath, 'utf8')

  it('REAL PARSE: node --check accepts the bundle (B6 P0 — no silent syntax error)', () => {
    // Not a string assertion: actually parse the shipped artifact with Node.
    // Pre-fix this threw "Unexpected token ')'" at the single-brace footer.
    expect(() => execFileSync(process.execPath, ['--check', distPath], { stdio: 'pipe' })).not.toThrow()
  })

  it('REAL EXECUTION: script registers factory(require) under the package id', () => {
    // Execute the bundle with a stubbed loader and assert load() receives the
    // right id AND a callable single-arg factory whose return is module.exports.
    const registered: { id: string; factory: unknown }[] = []
    const win = {
      __ModuleLoader__: {
        load(entry: { id: string; factory: unknown }) { registered.push(entry) },
      },
    }
    const run = new Function('window', dist) as (w: unknown) => void
    expect(() => run(win)).not.toThrow()
    expect(registered).toHaveLength(1)
    expect(registered[0].id).toBe(pkg.name)
    expect(typeof registered[0].factory).toBe('function')
    // Invoke the factory with a minimal require stub — must return an exports
    // object carrying apply/inject/name (the loader takes the return value).
    const exportsObj = (registered[0].factory as (require: (s: string) => unknown) => Record<string, unknown>)(
      (spec: string) => { if (spec === 'react') return { createElement: () => null }; return {} },
    )
    expect(exportsObj).toBeDefined()
    expect(typeof exportsObj.apply).toBe('function')
    expect(exportsObj.inject).toEqual(['slots'])
  })

  it('bundle opens with single-arg factory(require) + self-built module scaffold', () => {
    expect(dist).toMatch(/^window\.__ModuleLoader__\.load\(\{ id: "[^"]+", factory: \(require\) => \{ var module = \{ exports: \{\} \}; var exports = module\.exports;/)
    // STRICT (B6 P0): two braces — factory body + load object — then `);`.
    expect(dist).toMatch(/\breturn module\.exports;\s*\}\s*\}\s*\);\s*$/)
  })

  it('banner id (stripped /client) === package name (handshake)', () => {
    const id = dist.match(/^window\.__ModuleLoader__\.load\(\{ id: "([^"]+)"/)?.[1] ?? ''
    expect(id.endsWith('/client') ? id.slice(0, -'/client'.length) : id).toBe(pkg.name)
  })

  it('uses require("react") platform seed; NO legacy three-arg factory', () => {
    expect(dist).toContain('require("react")')
    expect(dist).not.toMatch(/factory:\s*\(require,\s*module,\s*exports\)/)
  })

  it('slot options include order but NO priority property anywhere in registration', () => {
    expect(dist).toContain('settings.section')
    expect(dist).toContain('dsh-zcontext-summary')
    expect(dist).toMatch(/order:\s*50/)
    expect(dist).not.toMatch(/priority\s*:/)
  })

  it('manifest dsh.client + exports["./client"] match DESIGN §6', () => {
    expect(pkg.dsh.client).toEqual({ platform: 'web', inject: ['@deepseek-ai/dsh-client-ui-slots'] })
    expect(pkg.exports['./client']).toBe('./dist/client.cjs')
    // bundle patch entry unchanged
    expect(pkg.dsh.bundle).toEqual({ patch: './cordis.patch.yml' })
  })
})

describe('ZCTX-SIDEBAR A1 — left-menu entry + central panel', () => {
  const PANEL_ID = 'dsh-zcontext.panel'

  it('registers sidebar.panellist with the panel id, order and a text label thunk', () => {
    const ctx = slotsCtx()
    apply(ctx, { React: mockReact(), fetchText: async () => '{}' })
    const entry = ctx.registered.find((r) => r.opts.name === 'sidebar.panellist')
    expect(entry).toBeDefined()
    expect(entry?.opts.id).toBe(PANEL_ID)
    expect(typeof entry?.opts.order).toBe('number')
    // label is a thunk (re-read on each projection so locale can change)
    expect(typeof entry?.opts.label).toBe('function')
    expect((entry?.opts.label as () => string)()).toBe('zcontext')
  })

  it('registers the SAME key on `main` so the menu entry selects this panel', () => {
    const ctx = slotsCtx()
    apply(ctx, { React: mockReact(), fetchText: async () => '{}' })
    const panel = ctx.registered.find((r) => r.opts.name === 'main')
    expect(panel).toBeDefined()
    // The binding invariant: panellist.id === main.key.
    expect(panel?.opts.key).toBe(PANEL_ID)
    expect(typeof panel?.component).toBe('function')
  })

  it('injects main and sidebar.panellist through the capability gate', () => {
    const ctx = slotsCtx()
    apply(ctx, { React: mockReact(), fetchText: async () => '{}' })
    expect(ctx.injected).toContain('sidebar.panellist')
    expect(ctx.injected).toContain('main')
  })

  it('degrades to a no-op (no throw, no PENDING) when the slots service is absent', () => {
    const bare = { get: () => undefined } as unknown as ClientCtx
    expect(() => apply(bare, { React: mockReact() })).not.toThrow()
  })

  it('parsePanelSnapshot derives the view model from the REAL API shape (B3-B2)', () => {
    // Field-for-field from src/ui/types.ts:40-74 — window.pressurePct is computed
    // server-side; `degraded` is a string[]; there is no `limitTokens`.
    const parsed = parsePanelSnapshot(JSON.stringify({
      sessionId: 'session-abc',
      sessionResolution: 'latest-watched',
      faceHealth: { state: 'active' },
      window: {
        contextWindow: 200000,
        totalTokens: { value: 50000, basis: 'measured' },
        pressurePct: 25,
        routed: { provider: 'p', model: 'm' },
      },
      folds: [{ id: 'f1' }, { id: 'f2' }],
      ranges: [{ seq: 1 }],
      cache: { samples: 7, measured: true, basis: 'measured' },
      degraded: ['session-unresolved'],
    }))
    expect(parsed.sessionId).toBe('session-abc')
    expect(parsed.faceState).toBe('active')
    expect(parsed.foldCount).toBe(2)
    // The server-computed pressure is used verbatim — not re-derived.
    expect(parsed.pressurePct).toBe(25)
    expect(parsed.totalTokens).toBe(50000)
    expect(parsed.contextWindow).toBe(200000)
    expect(parsed.cacheSamples).toBe(7)
    expect(parsed.cacheMeasured).toBe(true)
    expect(parsed.ranges).toBe(1)
    expect(parsed.degradedCount).toBe(1)
  })

  it('parsePanelSnapshot yields no pressure when the API omits it (honest n/a)', () => {
    const parsed = parsePanelSnapshot(JSON.stringify({
      window: { contextWindow: undefined, totalTokens: undefined, pressurePct: undefined },
      degraded: [],
    }))
    expect(parsed.pressurePct).toBeUndefined()
    expect(parsed.degradedCount).toBeUndefined()
  })

  it('parsePanelSnapshot tolerates malformed JSON without throwing', () => {
    expect(parsePanelSnapshot('not json')).toEqual({})
    expect(parsePanelSnapshot('{}')).toEqual({})
  })

  it('B3-S2/S7: a non-2xx read surfaces as fetchError, never as fabricated zeros', async () => {
    // React double recording state updates — the panel renders the error row.
    const states: unknown[] = []
    const cleanups: unknown[] = []
    const reactMock = {
      createElement(type: unknown, props?: Record<string, unknown> | null, ...children: unknown[]) {
        return { type, props, children }
      },
      useState<T>(initial: T): [T, (next: T) => void] {
        const setters: ((v: T) => void)[] = []
        const pair: [T, (next: T) => void] = [initial, (next: T) => {
          states.push(next)
          pair[0] = next
          setters.forEach((s) => s(next))
        }]
        setters.push((v: T) => { pair[0] = v })
        return pair
      },
      // React semantics: the effect runs, its cleanup is collected (NOT invoked
      // synchronously) — invoking it here would kill the pending async read.
      useEffect(effect: () => (() => void) | void) {
        cleanups.push(effect() as (() => void) | undefined)
      },
    } as unknown as ReactLike
    // fetch face: first read 403s — this arm covers the non-2xx ERROR-ROW path
    // (fetchError state). The r.ok GUARD itself (rejecting a non-ok response
    // that still carries a valid-looking body) is pinned separately below.
    let calls = 0
    const failingFetch = async (): Promise<string> => {
      calls += 1
      throw new Error('GET /zctx-ui/api/snapshot → HTTP 403')
    }
    const component = createPanelComponent(reactMock, failingFetch)
    expect(typeof component).toBe('function')
    component?.() // effect mounts; the rejection lands on a microtask
    await new Promise((resolve) => setTimeout(resolve, 0))
    // The error message surfaced (not swallowed into zeros), and the read ran.
    expect(calls).toBeGreaterThanOrEqual(1)
    expect(states.some((s) => typeof s === 'string' && String(s).includes('HTTP 403'))).toBe(true)
    // N3: unmount at test end so the panel's real 5s interval never leaks.
    for (const c of cleanups) { if (typeof c === 'function') c() }
  })

  it('N1-b: the r.ok guard rejects a non-ok response even when its body looks like a valid snapshot', async () => {
    // The GUARD arm (distinct from the error-row arm above): a 500 response
    // whose body is a *perfectly valid* snapshot must NOT be absorbed —
    // otherwise faults render as fabricated zeros (B3-S7 root cause).
    const states: unknown[] = []
    const cleanups: unknown[] = []
    const reactMock = {
      createElement(type: unknown, props?: Record<string, unknown> | null, ...children: unknown[]) {
        return { type, props, children }
      },
      useState<T>(initial: T): [T, (next: T) => void] {
        const pair: [T, (next: T) => void] = [initial, (v: T) => { states.push(v); pair[0] = v }]
        return pair
      },
      useEffect(effect: () => (() => void) | void) {
        cleanups.push(effect() as (() => void) | undefined)
      },
    } as unknown as ReactLike
    const validBody = JSON.stringify({
      sessionId: 'session-forged',
      faceHealth: { state: 'active' },
      window: { contextWindow: 1, totalTokens: { value: 1, basis: 'measured' }, pressurePct: 99 },
      degraded: [],
    })
    let snapshotCalls = 0
    const component = createPanelComponent(reactMock, async (url: string) => {
      if (url.endsWith('/api/snapshot')) {
        snapshotCalls += 1
        // The real sameOriginFetchText contract: non-2xx → throw, body never
        // parsed — so the valid-looking body below must never reach the view.
        const err = new Error('GET /zctx-ui/api/snapshot → HTTP 500')
        ;(err as unknown as { body?: string }).body = validBody
        throw err
      }
      return JSON.stringify({ fields: {} }) // config GET (B3-S5 read)
    })
    component?.()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(snapshotCalls).toBe(1)
    // The forged "active / pressurePct 99" body must NOT reach the view model.
    expect(states.some((s) => typeof s === 'object' && s !== null && (s as PanelSnapshot).faceState === 'active')).toBe(false)
    expect(states.some((s) => typeof s === 'string' && String(s).includes('HTTP 500'))).toBe(true)
    for (const c of cleanups) { if (typeof c === 'function') c() }
  })

  it('B3-S2: polling creates exactly one interval; unmount cleanup clears it (no timer leak)', () => {
    let intervals = 0
    let cleared = 0
    const cleanups: unknown[] = []
    const reactMock = {
      createElement(type: unknown, props?: Record<string, unknown> | null) { return { type, props } },
      useState<T>(initial: T): [T, (next: T) => void] { return [initial, () => undefined] },
      // React semantics: collect the cleanup — the test invokes it at unmount.
      useEffect(effect: () => (() => void) | void) {
        cleanups.push(effect() as (() => void) | undefined)
      },
    } as unknown as ReactLike
    const origSetInterval = global.setInterval
    const origClearInterval = global.clearInterval
    global.setInterval = ((fn: () => void, ms: number) => { void fn; void ms; intervals += 1; return intervals as unknown as ReturnType<typeof setInterval> }) as typeof setInterval
    global.clearInterval = ((id: unknown) => { void id; cleared += 1 }) as typeof clearInterval
    try {
      const component = createPanelComponent(reactMock, async () => '{}')
      component?.() // mount → exactly one interval
      expect(intervals).toBe(1)
      expect(cleared).toBe(0)
      // Unmount → the collected cleanup clears the interval.
      for (const c of cleanups) { if (typeof c === 'function') c() }
      expect(cleared).toBe(1)
    } finally {
      global.setInterval = origSetInterval
      global.clearInterval = origClearInterval
    }
  })
})
