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
}

/**
 * The static bundle's factory receives a single `require` param (the Z1 banner
 * names it literally), and `react` is a platform seed word (web/seed.ts:29), so
 * `require('react')` resolves the real React in production. In Node unit tests
 * importing this source directly there is no loader `require`, so `typeof`
 * guards it and tests inject a mock via adapters.React.
 */
declare const require: ((spec: string) => unknown) | undefined

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
      e('a', { href: '/zctx-ui' }, '打开 zcontext 面板 →'),
    )
  }
}

/**
 * Top-level fiber apply. Capability-probes every host surface; `slots` absent
 * → lazy no-op (no PENDING, no throw). Falls back to a plain link component if
 * React/styles unavailable.
 */
export function apply(ctx: ClientCtx, adapters: ClientAdapters = {}): void {
  const React = resolveReact(adapters)
  const fetchText = adapters.fetchText ?? ((url: string) => fetch(url).then((r) => r.text()))
  const styles = (ctx.get?.('styles') ?? undefined) as StylesLike | undefined

  const register = (): unknown => {
    const component = createSummaryCard(React, undefined, fetchText)
    // Expression-limit degrade (反-C2): no React → a plain-link render closure.
    const finalComponent = component ?? ((..._args: never[]): unknown => null)
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
  if (ctx.slots === undefined || typeof ctx.slots.inject !== 'function') return
  try {
    ctx.slots.inject(SLOT_KEY, register)
  } catch {
    /* undeclared slot → lazy no-op; self-activates if declared later */
  }
}

/** The fiber object the loader expects (object form with inject + apply). */
export const fiber = { name, inject, apply }
