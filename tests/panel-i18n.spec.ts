/**
 * ZCTX-FULLPANEL r1 — review-B3 S-8 test arms (each pins one review blocker):
 *
 *   - B-4a: resolveLang semantics — explicit preference > host probe
 *     (zh → zh, ANY other detected language → en) > default zh;
 *   - B-4b: en mode renders ZERO Chinese characters (the five former
 *     hardcoded zh literals are dictionary keys now);
 *   - B-1:  a picked session survives the 5s poll (no overwrite back to the
 *     default session);
 *   - B-2a: the four face switches render (3 checkboxes + preflightMode
 *     select);
 *   - B-2b: number fields POST as numbers (NaN rejects the WHOLE submit) and
 *     the wire shape is `{ fields, faceSwitches }`;
 *   - S-2:  the eight dead page-era dictionary keys are gone;
 *   - S-4:  a failed ledger read renders 统计暂不可用, never mislabeled
 *     current-session numbers.
 *
 * React mock notes: the panel calls useState 7× (hook order: data,
 * fetchError, configFields, faceSwitches, ledger, ledgerOk, picked) and
 * useEffect 2× (slot 7 = snapshot poll, deps [picked]; slot 8 = config+stats,
 * deps []). The mock identifies hooks BY CALL ORDER (real React semantics),
 * so renders re-invoke the component after resetSlots().
 */

import { describe, expect, it, vi } from 'vitest'
import { resolveLang, UI_DICT, FIELD_LABELS } from '../src/ui/i18n.ts'
import { createPanelComponent, type ReactLike } from '../src/client/index.ts'

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

/** Swap the host navigator (the panel's locale probe source) for one scope — async-safe. */
async function withNavigator<T>(language: string, fn: () => T | Promise<T>): Promise<T> {
  const desc = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  Object.defineProperty(globalThis, 'navigator', { value: { language }, writable: true, configurable: true })
  try {
    return await fn()
  } finally {
    if (desc !== undefined) Object.defineProperty(globalThis, 'navigator', desc)
    else delete (globalThis as { navigator?: unknown }).navigator
  }
}

/** Stateful React double: hooks identified by call order; effects honor deps. */
interface StatefulReactMock extends ReactLike {
  /** Every createElement call as [type, props, ...children]. */
  readonly calls: unknown[][]
  /** useState slot pairs in hook order (index = hook cursor). */
  readonly slots: unknown[][]
  /** Every value ever passed to any setState (ordered). */
  readonly stateLog: unknown[]
  /** Effect cleanups per effect slot — invoke all to unmount. */
  readonly effectCleanups: ReadonlyArray<(() => void) | undefined>
  /** Reset the hook cursor before each (re-)render — real React does this per render. */
  resetSlots(): void
}

function statefulReact(): StatefulReactMock {
  const calls: unknown[][] = []
  const slots: unknown[][] = []
  const stateLog: unknown[] = []
  const lastDeps: unknown[][] = []
  const cleanups: Array<(() => void) | undefined> = []
  let cursor = 0
  const depsEqual = (a: readonly unknown[], b: readonly unknown[]): boolean =>
    JSON.stringify(a) === JSON.stringify(b)
  return {
    calls,
    slots,
    stateLog,
    effectCleanups: cleanups,
    resetSlots() {
      cursor = 0
    },
    createElement(type: unknown, props?: Record<string, unknown> | null, ...children: unknown[]) {
      calls.push([type, props, ...children])
      return { type, props, children }
    },
    useState<T>(initial: T): [T, (next: T) => void] {
      const idx = cursor++
      if (slots[idx] === undefined) {
        const pair: [T, (next: T) => void] = [
          initial,
          (next: T) => {
            stateLog.push(next)
            pair[0] = next
          },
        ]
        slots[idx] = pair as unknown[]
      }
      return slots[idx] as unknown as [T, (next: T) => void]
    },
    useEffect(effect: () => (() => void) | void, deps?: readonly unknown[]) {
      const idx = cursor++
      const prev = lastDeps[idx]
      // Real React deps semantics: undefined deps = run every render; equal
      // deps = skip; changed deps = previous cleanup, then the new effect.
      if (prev !== undefined && deps !== undefined && depsEqual(prev, deps)) return
      const prevCleanup = cleanups[idx]
      if (typeof prevCleanup === 'function') prevCleanup()
      const returned = effect()
      cleanups[idx] = typeof returned === 'function' ? returned : undefined
      lastDeps[idx] = [...(deps ?? [])]
    },
  } as StatefulReactMock
}

/** Build the panel against the mock, failing loudly if React were absent. */
function buildPanel(mock: StatefulReactMock, fetchText: (url: string) => Promise<string>): () => unknown {
  const component = createPanelComponent(mock, fetchText)
  if (component === undefined) throw new Error('stateful React mock present — createPanelComponent must build')
  return component
}

/** Render helper: reset hook cursor, invoke the component. */
function renderPanel(mock: StatefulReactMock, component: () => unknown): void {
  mock.resetSlots()
  component()
}

/** Unmount helper: run every collected effect cleanup (no timer leaks). */
function unmount(mock: StatefulReactMock): void {
  for (const c of mock.effectCleanups) {
    if (typeof c === 'function') c()
  }
}

function lastProps(mock: StatefulReactMock, match: (props: Record<string, unknown>) => boolean): Record<string, unknown> | undefined {
  for (let i = mock.calls.length - 1; i >= 0; i -= 1) {
    const props = mock.calls[i][1] as Record<string, unknown> | undefined
    if (props !== undefined && props !== null && match(props)) return props
  }
  return undefined
}

describe('B-4a: resolveLang semantics (explicit pref > host probe > default zh)', () => {
  it('an explicit preference always wins over the probe', () => {
    expect(resolveLang('en', 'zh-CN')).toBe('en')
    expect(resolveLang('zh', 'en-US')).toBe('zh')
  })

  it('host probe zh → zh', () => {
    expect(resolveLang(undefined, 'zh-CN')).toBe('zh')
    expect(resolveLang(undefined, 'zh')).toBe('zh')
    expect(resolveLang(undefined, 'ZH-tw')).toBe('zh')
  })

  it('host probe ANY other detected language → en (user 2026-11-20; review B-4a)', () => {
    // The B-4a bug: ja-JP/de-DE fell through to zh. en-US stays en too.
    expect(resolveLang(undefined, 'ja-JP')).toBe('en')
    expect(resolveLang(undefined, 'de-DE')).toBe('en')
    expect(resolveLang(undefined, 'fr')).toBe('en')
    expect(resolveLang(undefined, 'ko-KR')).toBe('en')
    expect(resolveLang(undefined, 'en-US')).toBe('en')
  })

  it('probe missing/empty → default zh (探测不到默认中文)', () => {
    expect(resolveLang(undefined, undefined)).toBe('zh')
    expect(resolveLang(undefined, '')).toBe('zh')
  })
})

describe('B-4b + S-2: dictionary hygiene', () => {
  it('the eight dead page-era keys are gone (S-2)', () => {
    const keys = Object.keys(UI_DICT)
    for (const dead of ['copyAddress', 'copied', 'readonlyNote', 'openFullPanel', 'language', 'langAuto', 'langZh', 'langEn']) {
      expect(keys).not.toContain(dead)
    }
  })

  it('every dict row is bilingual (both halves non-empty — en mode can never fall back to zh copy)', () => {
    for (const [key, row] of Object.entries(UI_DICT)) {
      expect(row.zh.length, `zh half of ${key}`).toBeGreaterThan(0)
      expect(row.en.length, `en half of ${key}`).toBeGreaterThan(0)
    }
  })

  it('the four face-switch keys keep labels in BOTH languages (B-2a)', () => {
    for (const k of ['observe.enabled', 'patch.guardObserveEvents', 'autofold.enabled', 'preflightMode']) {
      expect(FIELD_LABELS[k]?.zh.length).toBeGreaterThan(0)
      expect(FIELD_LABELS[k]?.en.length).toBeGreaterThan(0)
    }
  })
})

describe('B-4b: panel language follows the DSH host locale', () => {
  it('en mode renders ZERO Chinese characters (the 5 former hardcoded zh literals included)', async () => {
    await withNavigator('en-US', async () => {
      const mock = statefulReact()
      const component = buildPanel(mock, async () => '{}')
      try {
        renderPanel(mock, component)
        const serialized = JSON.stringify(mock.calls)
        // CJK Unified Ideographs range — a single hit means zh copy leaked in.
        expect(serialized).not.toMatch(/[\u4e00-\u9fff]/)
        expect(serialized).toContain('zcontext Panel (BETA)')
        expect(serialized).toContain('stats unavailable')
      } finally {
        unmount(mock)
      }
    })
  })

  it('zh mode renders the zh copy (probe zh → Chinese, the primary audience)', async () => {
    await withNavigator('zh-CN', async () => {
      const mock = statefulReact()
      const component = buildPanel(mock, async () => '{}')
      try {
        renderPanel(mock, component)
        const serialized = JSON.stringify(mock.calls)
        expect(serialized).toContain('zcontext 面板 (BETA)')
        expect(serialized).toContain('统计暂不可用')
        expect(serialized).toContain('(当前)')
      } finally {
        unmount(mock)
      }
    })
  })
})

describe('B-1: a picked session survives the 5s poll', () => {
  it('switching sessions re-arms the poll onto the picked session — never overwrites back to the default', async () => {
    await withNavigator('zh-CN', async () => {
      const DEFAULT = JSON.stringify({
        sessionId: 'session-default',
        faceHealth: { state: 'active' },
        folds: [],
        ranges: [],
        degraded: [],
        availableSessions: ['session-default', 'session-picked'],
      })
      const PICKED = JSON.stringify({
        sessionId: 'session-picked',
        faceHealth: { state: 'active' },
        folds: [],
        ranges: [],
        degraded: [],
        availableSessions: ['session-default', 'session-picked'],
      })
      const urls: string[] = []
      const fetchText = async (url: string): Promise<string> => {
        urls.push(url)
        if (url.includes('/api/stats')) {
          return JSON.stringify({ ok: true, stats: { totalFolds: 4, totalTokensSaved: 900, sessionsCount: 2, lastFoldAt: undefined, schemaVersion: 1 } })
        }
        if (url.includes('/api/config')) {
          return JSON.stringify({ fields: { enabled: true }, faceSwitches: { 'observe.enabled': true } })
        }
        if (url.includes('session=session-picked')) return PICKED
        return DEFAULT
      }

      const mock = statefulReact()
      const component = buildPanel(mock, fetchText)
      let poll: (() => void) | undefined
      const origSetInterval = global.setInterval
      global.setInterval = ((fn: () => void) => {
        poll = fn
        return 0 as unknown as ReturnType<typeof setInterval>
      }) as typeof setInterval
      try {
        renderPanel(mock, component) // mount: default-session load + config + stats
        await tick()
        // Hook slot 0 = the snapshot data state.
        expect((mock.slots[0] as unknown[])[0]).toMatchObject({ sessionId: 'session-default' })

        renderPanel(mock, component) // re-render: the switcher exists now
        const onChange = lastProps(mock, (p) => p.className === 'zctx-panel-select' && typeof p.onChange === 'function')?.onChange as
          | ((ev: unknown) => void)
          | undefined
        expect(typeof onChange).toBe('function')

        onChange?.({ target: { value: 'session-picked' } })
        expect(mock.stateLog).toContain('session-picked')
        renderPanel(mock, component) // deps [picked] changed → snapshot effect re-runs
        await tick()

        const snapUrls = urls.filter((u) => u.includes('/api/snapshot'))
        const firstPicked = snapUrls.findIndex((u) => u.includes('session=session-picked'))
        expect(firstPicked).toBeGreaterThanOrEqual(1)
        // Pre-pick: exactly one bare default fetch (the mount load).
        expect(snapUrls.slice(0, firstPicked)).toEqual(['/zctx-ui/api/snapshot'])
        // Post-pick: EVERY snapshot fetch — immediate AND the 5s poll — rides
        // the picked session (the B-1 regression is a bare default fetch here).
        expect((mock.slots[0] as unknown[])[0]).toMatchObject({ sessionId: 'session-picked' })

        expect(typeof poll).toBe('function')
        poll?.() // simulate a 5s poll tick after the switch
        await tick()
        const after = urls.filter((u) => u.includes('/api/snapshot')).slice(firstPicked)
        expect(after.length).toBeGreaterThanOrEqual(2)
        for (const u of after) expect(u).toBe('/zctx-ui/api/snapshot?session=session-picked')
        expect((mock.slots[0] as unknown[])[0]).toMatchObject({ sessionId: 'session-picked' })
      } finally {
        global.setInterval = origSetInterval
        unmount(mock)
      }
    })
  })
})

describe('B-2a: the four face switches render', () => {
  it('renders 3 boolean checkboxes + the preflightMode select with exactly off|observe|enforce', async () => {
    await withNavigator('zh-CN', async () => {
      const mock = statefulReact()
      const component = buildPanel(mock, async () => '{}')
      try {
        renderPanel(mock, component)
        // Seed the config state slots (hook order: 2 = configFields, 3 =
        // faceSwitches) the way GET /api/config populates them, then re-render.
        ;(mock.slots[2] as unknown[])[0] = { enabled: true }
        ;(mock.slots[3] as unknown[])[0] = {
          'observe.enabled': true,
          'patch.guardObserveEvents': false,
          'autofold.enabled': true,
          preflightMode: 'observe',
        }
        renderPanel(mock, component)

        const serialized = JSON.stringify(mock.calls)
        expect(serialized).toContain('face 开关')
        for (const key of ['observe.enabled', 'patch.guardObserveEvents', 'autofold.enabled']) {
          expect(serialized).toContain(`"data-key":"${key}"`)
        }
        expect(serialized).toContain('"data-key":"preflightMode"')
        expect(serialized).toContain('"data-type":"select"')
        // zh labels render for every face key (B-2a + B-4b: no bare key names).
        expect(serialized).toContain('观测面开关')
        expect(serialized).toContain('自动折叠开关')

        const sel = mock.calls.find((c) => (c[1] as Record<string, unknown>)?.['data-key'] === 'preflightMode')
        expect(sel).toBeDefined()
        const options = (sel as unknown[]).slice(2) as Array<{ props: { value: string } }>
        expect(options.map((o) => o.props.value)).toEqual(['off', 'observe', 'enforce'])
      } finally {
        unmount(mock)
      }
    })
  })
})

describe('B-2b: the save path — number conversion + wire shape', () => {
  interface FakeInput {
    getAttribute(name: string): string | null
    value: string
    checked: boolean
  }
  const fieldEl = (key: string, type: string, value: string, checked = false): FakeInput => ({
    getAttribute: (n: string) => (n === 'data-key' ? key : n === 'data-type' ? type : null),
    value,
    checked,
  })

  function mountPanelWithSave(): { mock: StatefulReactMock; onClick: () => void } {
    const mock = statefulReact()
    const component = buildPanel(mock, async () => '{}')
    renderPanel(mock, component)
    const onClick = lastProps(mock, (p) => p.className === 'zctx-save' && typeof p.onClick === 'function')?.onClick as () => void
    expect(typeof onClick).toBe('function')
    return { mock, onClick }
  }

  it('number fields POST as numbers, booleans as checked, body shape {fields, faceSwitches}', async () => {
    await withNavigator('zh-CN', async () => {
      const { onClick } = mountPanelWithSave()
      const resultEl = { textContent: '' }
      const doc = {
        querySelector(sel: string) {
          if (sel === '.zctx-panel-fields') return { querySelectorAll: () => [fieldEl('keepRecentTokens', 'number', '123'), fieldEl('enabled', 'boolean', '', true)] }
          if (sel === '.zctx-panel-faces') return { querySelectorAll: () => [fieldEl('observe.enabled', 'boolean', ''), fieldEl('preflightMode', 'select', 'enforce')] }
          if (sel === '.zctx-save-result') return resultEl
          return null
        },
      }
      const posts: Array<{ url: string; body: string }> = []
      vi.stubGlobal('document', doc)
      vi.stubGlobal('fetch', async (url: string, init?: { body?: string }) => {
        posts.push({ url, body: init?.body ?? '' })
        return { json: async () => ({ ok: true }) }
      })
      try {
        onClick()
        await tick()
        expect(posts).toHaveLength(1)
        expect(posts[0].url).toBe('/zctx-ui/api/config')
        const body = JSON.parse(posts[0].body) as { fields: Record<string, unknown>; faceSwitches: Record<string, unknown> }
        // The wire shape mirrors the GET view (backend normalize merges both bags).
        expect(Object.keys(body).sort()).toEqual(['faceSwitches', 'fields'])
        expect(body.fields).toEqual({ enabled: true, keepRecentTokens: 123 })
        expect(typeof body.fields.keepRecentTokens).toBe('number')
        expect(body.faceSwitches).toEqual({ 'observe.enabled': false, preflightMode: 'enforce' })
        expect(resultEl.textContent).toContain('已保存')
      } finally {
        vi.unstubAllGlobals()
      }
    })
  })

  it('a NaN number field rejects the WHOLE submit with a message — no POST, no partial write', async () => {
    await withNavigator('zh-CN', async () => {
      const { onClick } = mountPanelWithSave()
      const resultEl = { textContent: '' }
      const doc = {
        querySelector(sel: string) {
          if (sel === '.zctx-panel-fields') return { querySelectorAll: () => [fieldEl('keepRecentTokens', 'number', 'abc'), fieldEl('enabled', 'boolean', '', true)] }
          if (sel === '.zctx-panel-faces') return { querySelectorAll: () => [fieldEl('observe.enabled', 'boolean', '')] }
          if (sel === '.zctx-save-result') return resultEl
          return null
        },
      }
      const posts: string[] = []
      vi.stubGlobal('document', doc)
      vi.stubGlobal('fetch', async (url: string) => {
        posts.push(url)
        return { json: async () => ({ ok: true }) }
      })
      try {
        onClick()
        await tick()
        expect(posts).toHaveLength(0)
        // The failing key is named in the message (language-independent pin).
        expect(resultEl.textContent).toContain('keepRecentTokens')
        expect(resultEl.textContent.length).toBeGreaterThan(0)
      } finally {
        vi.unstubAllGlobals()
      }
    })
  })
})

describe('S-4: ledger stats honesty', () => {
  const SNAPSHOT = JSON.stringify({
    sessionId: 's1',
    faceHealth: { state: 'active' },
    folds: [{}, {}, {}],
    ranges: [{ seq: 1 }],
    degraded: [],
  })

  it('a failed ledger read renders 统计暂不可用 — never the current-session count mislabeled as cumulative', async () => {
    await withNavigator('zh-CN', async () => {
      const mock = statefulReact()
      const component = buildPanel(mock, async (url) => {
        if (url.includes('/api/stats')) throw new Error('ledger boom')
        if (url.includes('/api/config')) return JSON.stringify({ fields: {}, faceSwitches: {} })
        return SNAPSHOT
      })
      try {
        renderPanel(mock, component)
        await tick() // the config/stats reads settle
        renderPanel(mock, component) // re-render with the landed state
        const serialized = JSON.stringify(mock.calls)
        expect(serialized).toContain('统计暂不可用')
        // The mislabel regression: "折叠次数(累计): 3" (3 = THIS session's folds).
        expect(serialized).not.toContain('(累计): 3')
        expect(serialized).not.toContain('累计节省')
        // Current-session rows still render, clearly labeled (当前).
        expect(serialized).toContain('(当前)')
      } finally {
        unmount(mock)
      }
    })
  })

  it('a successful ledger read renders the SQLite cumulative rows', async () => {
    await withNavigator('zh-CN', async () => {
      const mock = statefulReact()
      const component = buildPanel(mock, async (url) => {
        if (url.includes('/api/stats')) {
          return JSON.stringify({ ok: true, stats: { totalFolds: 12, totalTokensSaved: 3400, sessionsCount: 5, lastFoldAt: 1, schemaVersion: 1 } })
        }
        if (url.includes('/api/config')) return JSON.stringify({ fields: {}, faceSwitches: {} })
        return SNAPSHOT
      })
      try {
        renderPanel(mock, component)
        await tick() // the config/stats reads settle
        const before = mock.calls.length
        renderPanel(mock, component) // re-render with the landed state
        const serialized = JSON.stringify(mock.calls.slice(before))
        expect(serialized).toContain('折叠次数(累计): 12')
        expect(serialized).toContain('累计节省 tokens: 3400')
        expect(serialized).toContain('覆盖会话: 5')
        expect(serialized).not.toContain('统计暂不可用')
      } finally {
        unmount(mock)
      }
    })
  })
})
