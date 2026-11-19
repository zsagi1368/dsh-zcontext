/**
 * Browser client fiber — the settings.section summary card (ZCTX-UI DESIGN §5).
 *
 * CONTRACT (verified vs AutoPilot/filehub real artifacts, Z1):
 *   - exported object with `name` (=== package name) + `inject` + `apply(ctx)`;
 *   - `inject` is the MINIMAL certain set: ['slots'] only (Z21/Z25/A1-2) —
 *     declaring `locale`/`configEditor`/`settingsScope` would hang this fiber
 *     PENDING on hosts that dropped those services (AutoPilot 0.1.7 incident);
 *   - markup via `React.createElement`, CSS via `styles.insert`, theme vars
 *     `var(--dsw-alias-*)`, NO source-level `import` of React/design-system;
 *   - register inside `ctx.slots.inject('settings.section', ...)` with a FRESH
 *     id (`dsh-zcontext-summary`, never a shipped id), `order`, NO `priority`.
 *
 * CAPABILITY DEGRADE (Z21/Z25): `slots` absent → lazy no-op (never PENDING,
 * never throws). The card self-activates if the slot appears later. The bundle
 * factory obtains React via `require('react')` (the loader shim, filehub
 * precedent) and styles via `ctx.get('styles')` — both capability-probed.
 *
 * SLOT EXPRESSION LIMIT (反-C2): the card holds only summary text + a link to
 * `/zctx-ui`; complex settings/stats stay on the full page. If React/styles are
 * unavailable, the card DEGRADES TO A PLAIN LINK (still useful, no crash).
 *
 * @module client/index
 */

/** Must equal the package name — the loader's boot-graph row id (handshake). */
export const name = 'dsh-zcontext'

/** Minimal certain inject set — `slots` is the only guaranteed web/desktop service. */
export const inject = ['slots']

/** Structural React element (duck-typed — no import). */
export type ReactElementLike = unknown

/** Minimal React factory surface the card needs. */
export interface ReactLike {
  createElement(type: unknown, props?: Record<string, unknown> | null, ...children: unknown[]): ReactElementLike
  /** Hook faces are capability-probed: a bare test double may omit them. */
  useState?<T>(initial: T): [T, (next: T) => void]
  useEffect?(effect: () => (() => void) | void, deps?: readonly unknown[]): void
}

/** Minimal styles service (provider signature: styles.insert(css): () => void). */
export interface StylesLike {
  insert(css: string): () => void
}

/** Structural client context (capability-probed, all optional). */
export interface ClientCtx {
  get?(key: string): unknown
  slots?: {
    inject?(slot: string, register: () => unknown): unknown
    register?(options: Record<string, unknown>, component: (...args: never[]) => unknown): unknown
  }
  effect?(fn: () => void | (() => void), label?: string): unknown
}

/** Adapters injected for tests; production uses the loader `require('react')`. */
export interface ClientAdapters {
  readonly React?: ReactLike
  readonly fetchText?: (url: string) => Promise<string>
  /** Minimal DOM factory for the no-React fallback link (browser supplies `document`). */
  readonly document?: DocumentLike
}

/** Minimal DOM surface the no-React fallback link needs (duck-typed, no lib.dom import). */
export interface DocumentLike {
  createElement(tag: string): {
    setAttribute(name: string, value: string): void
    textContent: string
  }
}

/** The render product of the no-React fallback component — assertable in tests. */
export interface LinkRender {
  readonly tag: 'a'
  readonly href: string
  /** New tab: opening the panel must never navigate away from the DSH window. */
  readonly target: '_blank'
  readonly text: string
  /** The real DOM anchor when a document is available; absent in bare Node. */
  readonly node?: unknown
}

/**
 * The static bundle's factory receives a single `require` param (the Z1 banner
 * names it literally), and `react` is a platform seed word (web/seed.ts:29), so
 * `require('react')` resolves the real React in production. In Node unit tests
 * importing this source directly there is no loader `require`, so `typeof`
 * guards it and tests inject a mock via adapters.React.
 */
declare const require: ((spec: string) => unknown) | undefined
declare const document: DocumentLike | undefined

function resolveReact(adapters: ClientAdapters): ReactLike | undefined {
  if (adapters.React !== undefined) return adapters.React
  try {
    if (typeof require === 'function') return require('react') as ReactLike
  } catch {
    /* no loader require in this runtime (unit test) */
  }
  return undefined
}

/** One row of the summary derived from the snapshot bridge. */
export interface SummaryData {
  readonly foldCount: number
  readonly pressurePct: number | undefined
  readonly sessionId: string | undefined
}

const SLOT_KEY = 'settings.section'
const CARD_ID = 'dsh-zcontext-summary'
/** The left-menu panel id — the SAME value binds `sidebar.panellist` and `main`. */
const PANEL_ID = 'dsh-zcontext.panel'
const PANEL_ORDER = 60
const CSS = [
  '.zctx-summary{display:flex;flex-direction:column;gap:8px;padding:12px 14px;border:1px solid var(--dsw-alias-border-color, #444);border-radius:8px;background:var(--dsw-alias-bg-layer-1, transparent);}',
  '.zctx-summary h3{margin:0;font-size:var(--dsw-alias-font-size-lg, 15px);color:var(--dsw-alias-label-primary, inherit);}',
  '.zctx-summary .zctx-stats{display:flex;gap:16px;color:var(--dsw-alias-label-secondary, #aaa);font-size:var(--dsw-alias-font-size-sm, 12px);}',
  '.zctx-summary a{color:var(--dsw-alias-link-color, #6aa9ff);text-decoration:none;}',
].join('')

/** Parse the minimal summary out of a snapshot JSON text (fail-soft). */
export function parseSummary(text: string): SummaryData | undefined {
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>
    const attribution = parsed.attribution as { foldCount?: unknown } | undefined
    const window = parsed.window as { pressurePct?: unknown } | undefined
    const foldCount = typeof attribution?.foldCount === 'number' ? attribution.foldCount : 0
    const pressurePct = typeof window?.pressurePct === 'number' ? window.pressurePct : undefined
    const sessionId = typeof parsed.sessionId === 'string' ? parsed.sessionId : undefined
    return { foldCount, pressurePct, sessionId }
  } catch {
    return undefined
  }
}

/** Fetch + parse the summary from the same-origin bridge (no token needed: same-origin/loopback read arm). */
async function refreshSummary(fetchText: (url: string) => Promise<string>): Promise<SummaryData | undefined> {
  try {
    return parseSummary(await fetchText('/zctx-ui/api/snapshot'))
  } catch {
    return undefined
  }
}

/**
 * The production fetch face: it must REJECT on a non-2xx (`403` after a policy
 * change, `500` on a fault). Resolving the error page as text would render
 * "折叠 0 / 缓存 0" — fabricated zeros against the honest-degrade vocabulary
 * (B3-S7). Callers then keep the last good snapshot.
 */
const sameOriginFetchText = (url: string): Promise<string> =>
  fetch(url).then((r) => {
    if (!r.ok) throw new Error(`zctx panel: GET ${url} → HTTP ${r.status}`)
    return r.text()
  })

/** Build the card component. `React` may be absent → caller degrades to a link. */
export function createSummaryCard(
  React: ReactLike | undefined,
  initial: SummaryData | undefined,
  fetchText: (url: string) => Promise<string>,
): ((...args: never[]) => unknown) | undefined {
  if (React === undefined) return undefined
  const e = React.createElement.bind(React)
  // A React function component with a lightweight useState-free refresh via a
  // mutable holder + effect. The host re-renders via its own slot ledger; the
  // card keeps the latest fetch in a holder the render reads.
  const holder: { data: SummaryData | undefined } = { data: initial }
  void refreshSummary(fetchText).then((data) => {
    if (data !== undefined) holder.data = data
  })
  return function SummaryCard(): unknown {
    const data = holder.data
    const stats = [
      `折叠 ${data?.foldCount ?? 0} 次`,
      data?.pressurePct !== undefined ? `窗口 ${data.pressurePct.toFixed(1)}%` : '窗口 n/a',
    ].join(' · ')
    return e('div', { className: 'zctx-summary' },
      e('h3', null, 'zcontext 摘要 (BETA)'),
      e('div', { className: 'zctx-stats' }, stats),
      e('a', { href: '/zctx-ui', target: '_blank', rel: 'noopener noreferrer' }, '打开 zcontext 面板 →'),
    )
  }
}

/**
 * Build the no-React fallback component. It returns a REAL, assertable render
 * product: an `<a href="/zctx-ui">` DOM anchor (when a document is available)
 * AND a `LinkRender` descriptor with a non-empty label. Never a blank `null`
 * card (B5-1: the "plain link" promise must be genuinely rendered).
 */
export function createFallbackLink(doc?: DocumentLike): (() => LinkRender) {
  return function FallbackLink(): LinkRender {
    const text = '打开 zcontext 面板 →'
    let node: unknown
    if (doc !== undefined && typeof doc.createElement === 'function') {
      try {
        const anchor = doc.createElement('a')
        anchor.setAttribute('href', '/zctx-ui')
        anchor.setAttribute('target', '_blank')
        anchor.setAttribute('rel', 'noopener noreferrer')
        anchor.textContent = text
        node = anchor
      } catch {
        /* DOM best-effort; descriptor still carries the link */
      }
    }
    return { tag: 'a', href: '/zctx-ui', target: '_blank', text, ...(node !== undefined ? { node } : {}) }
  }
}

/** A parsed snapshot for the side panel (defensive: every field optional). */
export interface PanelSnapshot {
  readonly sessionId?: string
  readonly sessionResolution?: string
  readonly faceState?: string
  readonly foldCount?: number
  /** Real API field (`window.pressurePct`), already computed server-side. */
  readonly pressurePct?: number
  readonly totalTokens?: number
  readonly contextWindow?: number
  readonly cacheSamples?: number
  readonly cacheMeasured?: boolean
  readonly ranges?: number
  /** Count of honest-degradation rows (`degraded: string[]` in the API). */
  readonly degradedCount?: number
}

/** Parse the /zctx-ui/api/snapshot JSON into the panel's view model. */
export function parsePanelSnapshot(text: string): PanelSnapshot {
  try {
    const raw = JSON.parse(text) as Record<string, unknown>
    const face = (raw.faceHealth ?? {}) as Record<string, unknown>
    const win = (raw.window ?? {}) as Record<string, unknown>
    // Real contract (src/ui/types.ts:40-44): window carries contextWindow,
    // totalTokens{value}, and an already-computed pressurePct. There is no
    // `limitTokens` field — reading one fabricates a number the API never sends.
    const pressure = typeof win.pressurePct === 'number' ? win.pressurePct : undefined
    const total = (win.totalTokens ?? {}) as Record<string, unknown>
    const t = typeof total.value === 'number' ? total.value : undefined
    const cw = typeof win.contextWindow === 'number' ? win.contextWindow : undefined
    const cache = (raw.cache ?? {}) as Record<string, unknown>
    const folds = Array.isArray(raw.folds) ? raw.folds.length : undefined
    const ranges = Array.isArray(raw.ranges) ? raw.ranges.length : undefined
    // `degraded` is a string[] of honest-degradation rows (types.ts:74).
    const degradedRows = Array.isArray(raw.degraded) ? raw.degraded.length : 0
    // Only defined fields land in the view model (an empty snapshot stays `{}`).
    const view: Record<string, unknown> = {}
    if (typeof raw.sessionId === 'string') view.sessionId = raw.sessionId
    if (typeof raw.sessionResolution === 'string') view.sessionResolution = raw.sessionResolution
    if (typeof face.state === 'string') view.faceState = face.state
    if (folds !== undefined) view.foldCount = folds
    if (pressure !== undefined) view.pressurePct = pressure
    if (t !== undefined) view.totalTokens = t
    if (cw !== undefined) view.contextWindow = cw
    if (typeof cache.samples === 'number') view.cacheSamples = cache.samples
    if (cache.measured === true) view.cacheMeasured = true
    if (ranges !== undefined) view.ranges = ranges
    if (degradedRows > 0) view.degradedCount = degradedRows
    return view as PanelSnapshot
  } catch {
    return {}
  }
}

/**
 * Build the side-panel component (方案 A1: `sidebar.panellist` + `main`).
 * Renders 查看 / 统计 / 设置 (read-only; writes point at the full `/zctx-ui`
 * page — U-2 token gap, honest degrade). Polls the same-origin snapshot API
 * every 5s. Returns undefined when React is unavailable (caller degrades).
 */
export function createPanelComponent(
  React: ReactLike | undefined,
  fetchText: (url: string) => Promise<string>,
): (() => unknown) | undefined {
  if (React === undefined) return undefined
  const e = React.createElement
  return function ZctxPanel(): unknown {
    const [data, setData] = React.useState?.<PanelSnapshot>({}) ?? [{} as PanelSnapshot, () => undefined]
    const value = data as PanelSnapshot
    React.useEffect?.(() => {
      let alive = true
      const load = (): void => {
        void fetchText('/zctx-ui/api/snapshot')
          .then((text) => { if (alive) (setData as (v: PanelSnapshot) => void)(parsePanelSnapshot(text)) })
          .catch(() => { /* keep last good snapshot; the next tick retries */ })
      }
      load()
      const timer = setInterval(load, 5000)
      return () => { alive = false; clearInterval(timer) }
    }, [])
    const face = value.faceState ?? 'unknown'
    const faceColor = face === 'active' ? '#3fb950' : face === 'degraded' ? '#d29922' : '#f85149'
    return e('div', { className: 'zctx-panel' },
      e('h2', { className: 'zctx-panel-title' }, 'zcontext 面板 (BETA)'),
      e('div', { className: 'zctx-panel-face' },
        e('span', { className: 'zctx-dot', style: { color: faceColor } }, '●'),
        e('span', null, ` face: ${face}`)),
      e('h3', null, '查看'),
      e('div', { className: 'zctx-panel-row' },
        `会话: ${value.sessionId ?? 'n/a'} (${value.sessionResolution ?? 'n/a'})`),
      e('div', { className: 'zctx-panel-row' },
        `窗口占用: ${value.pressurePct !== undefined ? `${value.pressurePct.toFixed(1)}%` : 'n/a'}`),
      e('div', { className: 'zctx-panel-row' },
        `tokens: ${value.totalTokens ?? 'n/a'} / ${value.contextWindow ?? 'n/a'}`),
      value.degradedCount !== undefined
        ? e('div', { className: 'zctx-panel-note' }, `降级提示: ${value.degradedCount} 条`)
        : null,
      e('h3', null, '统计'),
      e('div', { className: 'zctx-panel-row' }, `折叠次数: ${value.foldCount ?? 0}`),
      e('div', { className: 'zctx-panel-row' }, `可折叠区间: ${value.ranges ?? 0}`),
      e('div', { className: 'zctx-panel-row' },
        `缓存样本: ${value.cacheSamples ?? 0}${value.cacheMeasured === true ? ' (measured)' : ' (estimated/none)'}`),
      e('h3', null, '设置'),
      e('div', { className: 'zctx-panel-note' }, '设置修改请到完整面板（此处只读，避免越权写入）：'),
      e('a', { href: '/zctx-ui', target: '_blank', rel: 'noopener noreferrer' }, '打开完整面板 →'),
    )
  }
}

/** A minimal left-menu icon component (panellist renders the icon, label is text). */
export function createPanelIcon(React: ReactLike | undefined): (() => unknown) {
  if (React === undefined) return () => null
  const e = React.createElement
  return function ZctxIcon(): unknown {
    return e('span', { className: 'zctx-panel-icon', 'aria-hidden': 'true' }, '◎')
  }
}

/**
 * Top-level fiber apply. Capability-probes every host surface; `slots` absent
 * → lazy no-op (no PENDING, no throw). Falls back to a plain link component if
 * React/styles unavailable.
 */
export function apply(ctx: ClientCtx, adapters: ClientAdapters = {}): void {
  const React = resolveReact(adapters)
  const fetchText = adapters.fetchText ?? sameOriginFetchText
  const styles = (ctx.get?.('styles') ?? undefined) as StylesLike | undefined
  const doc: DocumentLike | undefined = adapters.document ?? (typeof document !== 'undefined' ? document : undefined)

  const register = (): unknown => {
    const component = createSummaryCard(React, undefined, fetchText)
    // Expression-limit degrade (反-C2, B5-1): no React → a REAL clickable link
    // component (never a blank null card). The render product asserts href/text.
    const finalComponent = component ?? createFallbackLink(doc)
    return ctx.slots?.register?.({
      name: SLOT_KEY,
      id: CARD_ID,
      order: 50,
      registrant: name,
      label: 'zcontext',
    }, finalComponent)
  }

  // styles capability-probe (never throws); card CSS is additive + disposable.
  if (styles !== undefined && typeof styles.insert === 'function') {
    try {
      ctx.effect?.(styles.insert(CSS), 'zctx-summary-styles')
    } catch {
      /* style injection is best-effort */
    }
  }

  // inject gate: slots absent → lazy no-op, no throw, no PENDING.
  // Narrow to a non-optional local so every later use is type-safe (B3-B1).
  const slots = ctx.slots
  if (slots === undefined || typeof slots.inject !== 'function') return
  try {
    slots.inject(SLOT_KEY, register)
  } catch {
    /* undeclared slot → lazy no-op; self-activates if declared later */
  }

  // 方案 A1: a native left-menu entry + its central panel (the same PANEL_ID
  // binds both). Both registrations hang off the panel component, so a host
  // without React gets neither (B3-S1: no dead icon entry that would throw on
  // click). Each is independently capability-gated (Z21/Z25 — never PENDING).
  const panel = createPanelComponent(React, fetchText)
  if (panel === undefined) return
  try {
    slots.inject('main', () => slots.register?.({
      name: 'main',
      key: PANEL_ID,
    }, panel))
  } catch {
    /* main absent → lazy no-op */
  }
  try {
    slots.inject('sidebar.panellist', () => slots.register?.({
      name: 'sidebar.panellist',
      id: PANEL_ID,
      order: PANEL_ORDER,
      label: () => 'zcontext',
    }, createPanelIcon(React)))
  } catch {
    /* panellist absent → lazy no-op */
  }
}

/** The fiber object the loader expects (object form with inject + apply). */
export const fiber = { name, inject, apply }
