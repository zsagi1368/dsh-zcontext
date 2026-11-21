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
 * SLOT EXPRESSION (ZCTX-FULLPANEL): the card holds ONLY a summary — the full
 * function surface (查看 / 统计 / 设置) lives in the native side panel (the
 * left-menu `zcontext` entry), and the browser page route was REMOVED
 * (dsh-app:// origin is browser-unreachable), so no cross-surface links are
 * rendered anywhere. If React is unavailable, the card DEGRADES TO A PLAIN
 * TEXT CARD (still informative, no crash, no dead links).
 *
 * @module client/index
 */

import { t as uiT, resolveLang, FACE_STATE_ZH, fieldLabel, UI_LANG_OPTIONS, type UiDictKey, type UiLang } from '../ui/i18n.ts'

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
  /** Minimal DOM factory for the no-React fallback card (browser supplies `document`). */
  readonly document?: DocumentLike
}

/** Minimal DOM surface the no-React fallback card needs (duck-typed, no lib.dom import). */
export interface DocumentLike {
  createElement(tag: string): {
    setAttribute(name: string, value: string): void
    textContent: string
  }
  /** Structural DOM query surface for the panel's save/write form (no lib.dom import). */
  querySelector?<Sel extends string>(selector: Sel): {
    querySelectorAll(selectors: string): Array<{
      getAttribute(name: string): string | null
      setAttribute(name: string, value: string): void
      checked?: boolean
      value?: string
    }>
  } & {
    textContent?: string
  }
}

/**
 * The render product of the no-React fallback component — assertable in tests.
 * A TEXT card, never a link: the page it used to point at was removed
 * (B-3), and a dead `href` in the shipped bundle is exactly the regression
 * this interface exists to keep out.
 */
export interface FallbackRender {
  readonly tag: 'span'
  readonly text: string
  /** The real DOM node when a document is available; absent in bare Node. */
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
  /** ZCTX-I18NFIX (review-B1 建议-1a): the desktop shell locale from the snapshot. */
  readonly locale?: string | null
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
  '.zctx-summary-note{font-size:var(--dsw-alias-font-size-sm, 12px);color:var(--dsw-alias-label-secondary, #aaa);}',
  // ZCTX-SIDEBAR panel styles (B3-S4): the central panel previously rendered as
  // bare text — every class now has a rule using theme variables.
  '.zctx-panel{display:flex;flex-direction:column;gap:6px;padding:14px 18px;overflow-y:auto;height:100%;box-sizing:border-box;background:var(--dsw-alias-bg-layer-1, transparent);}',
  '.zctx-panel-title{margin:0 0 4px;font-size:var(--dsw-alias-font-size-lg, 16px);color:var(--dsw-alias-label-primary, inherit);}',
  '.zctx-panel-face{display:flex;align-items:center;gap:6px;font-size:var(--dsw-alias-font-size-sm, 12px);}',
  '.zctx-panel h3{margin:10px 0 2px;font-size:var(--dsw-alias-font-size-sm, 13px);color:var(--dsw-alias-label-secondary, #aaa);border-bottom:1px solid var(--dsw-alias-border-color, #444);padding-bottom:2px;}',
  '.zctx-panel-row{font-size:var(--dsw-alias-font-size-sm, 12px);color:var(--dsw-alias-label-primary, inherit);}',
  '.zctx-panel-note{font-size:var(--dsw-alias-font-size-sm, 12px);color:var(--dsw-alias-label-secondary, #aaa);}',
  '.zctx-panel-err{font-size:var(--dsw-alias-font-size-sm, 12px);color:#f85149;background:rgba(248,81,73,.08);border-radius:4px;padding:4px 8px;}',
  '.zctx-panel-icon{display:inline-flex;align-items:center;justify-content:center;line-height:1;}',
  '.zctx-panel-fields{display:flex;flex-direction:column;gap:4px;}',
  '.zctx-panel-faces{display:flex;flex-direction:column;gap:4px;}',
  // S-6: the session switcher + preflightMode select previously had no rule
  // (browser-native styling) — theme variables now cover them.
  '.zctx-panel-select{background:var(--dsw-alias-bg-layer-2, #222);color:var(--dsw-alias-label-primary, inherit);border:1px solid var(--dsw-alias-border-color, #444);border-radius:4px;padding:2px 6px;font-size:var(--dsw-alias-font-size-sm, 12px);}',
  '.zctx-field{display:flex;align-items:center;gap:8px;font-size:var(--dsw-alias-font-size-sm, 12px);}',
  '.zctx-field-key{min-width:180px;color:var(--dsw-alias-label-secondary, #aaa);}',
  '.zctx-field-input{flex:1;background:var(--dsw-alias-bg-layer-2, #222);color:var(--dsw-alias-label-primary, inherit);border:1px solid var(--dsw-alias-border-color, #444);border-radius:4px;padding:2px 6px;}',
  '.zctx-save{align-self:flex-start;background:var(--dsw-alias-bg-layer-2, #238636);color:#fff;border:0;border-radius:6px;padding:4px 12px;font-size:var(--dsw-alias-font-size-sm, 12px);cursor:pointer;}',
  '.zctx-save-result{font-size:var(--dsw-alias-font-size-sm, 12px);color:var(--dsw-alias-label-secondary, #aaa);}',
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
    const locale = typeof parsed.locale === 'string' ? parsed.locale : null
    return { foldCount, pressurePct, sessionId, locale }
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

/**
 * Card-scope language resolution — the SAME chain as the panel (S-9 +
 * ZCTX-I18NFIX): the snapshot's `locale` field (the desktop shell's CONFIRMED
 * language from locale-cache — the REAL DSH setting) anchors the card;
 * `navigator.language` is only the FALLBACK because it reflects the
 * Electron-level locale (en-US on the real device) rather than the DSH
 * setting (zh-CN). No snapshot yet (bare-Node tests, first render) → the zh
 * default. The summary card holds no React state and fetches once at creation;
 * a DSH language change reloads the webview, which rebuilds the card and thus
 * picks up the new locale.
 */
function cardLang(localeHint?: string | null): UiLang {
  if (typeof localeHint === 'string' && localeHint !== '') return resolveLang(undefined, localeHint)
  const nav = globalThis.navigator as { language?: string } | undefined
  const navLang = typeof nav?.language === 'string' ? nav.language : undefined
  return resolveLang(undefined, navLang)
}

/**
 * Build the card component. `React` may be absent → caller degrades to a text
 * card. B-3: NO link — the browser page route was removed; the card is a pure
 * summary plus a pointer to the native left-menu panel entry. S-9: ALL copy
 * comes from the i18n dictionary (same language resolution as the panel).
 */
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
    const lang = cardLang(data?.locale)
    const stats = [
      uiT('summaryFolds', lang).replace('{n}', String(data?.foldCount ?? 0)),
      data?.pressurePct !== undefined
        ? uiT('summaryWindow', lang).replace('{p}', data.pressurePct.toFixed(1))
        : uiT('summaryWindowNa', lang),
    ].join(' · ')
    return e('div', { className: 'zctx-summary' },
      e('h3', null, uiT('summaryTitle', lang)),
      e('div', { className: 'zctx-stats' }, stats),
      e('div', { className: 'zctx-summary-note' }, uiT('panelLinkHint', lang)),
    )
  }
}

/**
 * Build the no-React fallback component. It returns a REAL, assertable render
 * product: a text node (when a document is available) AND a `FallbackRender`
 * descriptor with a non-empty label. Never a blank `null` card (B5-1) and
 * never a link (B-3: the pointed-at page no longer exists). S-9: the copy
 * comes from the i18n dictionary. ZCTX-I18NFIX (review-B1 建议-1a): this
 * degrade face has NO data channel (it renders only when React is absent —
 * never on the real webview), so it cannot read the snapshot locale; it
 * falls back to navigator → default zh and says so honestly.
 */
export function createFallbackCard(doc?: DocumentLike): (() => FallbackRender) {
  return function FallbackCard(): FallbackRender {
    const text = uiT('panelLinkHint', cardLang(null))
    let node: unknown
    if (doc !== undefined && typeof doc.createElement === 'function') {
      try {
        const span = doc.createElement('span')
        span.textContent = text
        node = span
      } catch {
        /* DOM best-effort; descriptor still carries the text */
      }
    }
    return { tag: 'span', text, ...(node !== undefined ? { node } : {}) }
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
  /** ZCTX-FULLPANEL: all live sessions for the panel's session switcher. */
  readonly availableSessions?: readonly string[]
  /**
   * ZCTX-I18NFIX: the desktop shell's confirmed DSH language (BCP-47 tag the
   * host reads from locale-cache; null when unavailable). The REAL anchor of
   * "follow the DSH language" — navigator.language only falls back.
   */
  readonly locale?: string | null
  /**
   * ZCTX-AUTOUI: the patch/插件运行形态 (present = the app.asar patch set is
   * live; absent = pure plugin mode). undefined = host did not supply it —
   * the panel omits the run-mode row.
   */
  readonly patchFace?: { readonly state: string; readonly patchSet?: string; readonly version?: string }
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
    if (Array.isArray(raw.availableSessions)) {
      view.availableSessions = raw.availableSessions.filter((x) => typeof x === 'string')
    }
    if (typeof raw.locale === 'string') view.locale = raw.locale
    // ZCTX-AUTOUI: the run-mode row source (defensive shape narrow).
    if (raw.patchFace !== null && typeof raw.patchFace === 'object' && !Array.isArray(raw.patchFace)) {
      const pf = raw.patchFace as Record<string, unknown>
      if (pf.state === 'present' || pf.state === 'absent' || pf.state === 'unknown') {
        view.patchFace = {
          state: pf.state,
          ...(typeof pf.patchSet === 'string' ? { patchSet: pf.patchSet } : {}),
          ...(typeof pf.version === 'string' ? { version: pf.version } : {}),
        }
      }
    }
    return view as PanelSnapshot
  } catch {
    return {}
  }
}

/**
 * Build the side-panel component (ZCTX-FULLPANEL: the FULL-FUNCTION native
 * panel). Renders 查看 (live snapshot, 5s poll, multi-session switcher whose
 * pick survives the poll — B-1), 统计 (SQLite cumulative ledger + current
 * session numbers; a failed ledger read shows an honest "stats unavailable"
 * row instead of mislabeling current-session values — S-4), and 设置 (WRITABLE:
 * nine fields + four face switches, POST `{fields, faceSwitches}` — B-2;
 * number fields are converted with `Number()`, a NaN value rejects the whole
 * submit). Language follows the DSH host locale (B-4). Returns undefined when
 * React is unavailable (caller degrades).
 */
export function createPanelComponent(
  React: ReactLike | undefined,
  fetchText: (url: string) => Promise<string>,
): (() => unknown) | undefined {
  if (React === undefined) return undefined
  const e = React.createElement
  return function ZctxPanel(): unknown {
    const nav = globalThis.navigator as { language?: string } | undefined
    const navLang = typeof nav?.language === 'string' ? nav.language : undefined
    const t = uiT
    const [data, setData] = React.useState?.<PanelSnapshot>({}) ?? [{} as PanelSnapshot, () => undefined]
    const value = data as PanelSnapshot
    // B3-S7: a failed read is SHOWN, never silently rendered as fabricated zeros.
    const [fetchError, setFetchError] = React.useState?.<string | undefined>(undefined)
      ?? [undefined as string | undefined, () => undefined]
    const [configFields, setConfigFields] = React.useState?.<Record<string, unknown>>({})
      ?? [{} as Record<string, unknown>, () => undefined]
    const [faceSwitches, setFaceSwitches] = React.useState?.<Record<string, unknown>>({})
      ?? [{} as Record<string, unknown>, () => undefined]
    // ZCTX-FULLPANEL: durable-ledger aggregates (SQLite 统计跨会话累计) + the
    // honest-availability flag (S-4).
    const [ledger, setLedger] = React.useState?.<{ totalFolds?: number; totalTokensSaved?: number; sessionsCount?: number }>({})
      ?? [{} as { totalFolds?: number; totalTokensSaved?: number; sessionsCount?: number }, () => undefined]
    const [ledgerOk, setLedgerOk] = React.useState?.<boolean>(false)
      ?? [false as boolean, () => undefined]
    // B-1: the user's picked session. The snapshot effect re-runs on every
    // change (deps [picked]) — the 5s poll then reuses the SAME session
    // parameter instead of overwriting the selection back to the host default.
    const [picked, setPicked] = React.useState?.<string | undefined>(undefined)
      ?? [undefined as string | undefined, () => undefined]
    const cfg = configFields as Record<string, unknown>
    const faces = faceSwitches as Record<string, unknown>
    // ZCTX-I18NFIX language chain: explicit uiLanguage ('zh'/'en' — 'auto' or
    // absent means follow the probes) > the snapshot's locale field (the
    // desktop shell's CONFIRMED language from locale-cache — the REAL DSH
    // setting) > navigator.language (Electron-level, often en-US even on a
    // zh DSH) > default zh. Recomputed every render: both inputs arrive
    // asynchronously (config fetch + 5s poll).
    const prefRaw = typeof cfg.uiLanguage === 'string' ? cfg.uiLanguage : undefined
    const pref = prefRaw === 'zh' || prefRaw === 'en' ? prefRaw : undefined
    const lang = resolveLang(pref, typeof value.locale === 'string' ? value.locale : navLang)
    React.useEffect?.(() => {
      let alive = true
      const load = (): void => {
        // B-1: the poll rides the user's picked session (deps [picked] re-arms
        // the interval after a switch); a failed read keeps the last snapshot.
        const url = picked !== undefined
          ? `/zctx-ui/api/snapshot?session=${encodeURIComponent(picked)}`
          : '/zctx-ui/api/snapshot'
        void fetchText(url)
          .then((text) => {
            if (!alive) return
            ;(setData as (v: PanelSnapshot) => void)(parsePanelSnapshot(text))
            ;(setFetchError as (v: string | undefined) => void)(undefined)
          })
          .catch((err: unknown) => {
            if (!alive) return
            // keep last good snapshot; surface the failure honestly (B3-S7)
            ;(setFetchError as (v: string | undefined) => void)(err instanceof Error ? err.message : String(err))
          })
      }
      load()
      const timer = setInterval(load, 5000)
      return () => { alive = false; clearInterval(timer) }
    }, [picked])
    React.useEffect?.(() => {
      // Config + ledger stats are fetched once per mount (not per poll tick,
      // and not re-fetched on a session switch — neither depends on session).
      let alive = true
      void fetchText('/zctx-ui/api/config')
        .then((text) => {
          if (!alive) return
          const raw = JSON.parse(text) as { fields?: Record<string, unknown>; faceSwitches?: Record<string, unknown> }
          if (raw.fields !== undefined && typeof raw.fields === 'object') (setConfigFields as (v: Record<string, unknown>) => void)(raw.fields)
          if (raw.faceSwitches !== undefined && typeof raw.faceSwitches === 'object') (setFaceSwitches as (v: Record<string, unknown>) => void)(raw.faceSwitches)
        })
        .catch(() => { /* settings stay empty on error; remount retries */ })
      void fetchText('/zctx-ui/api/stats')
        .then((text) => {
          if (!alive) return
          const raw = JSON.parse(text) as { stats?: { totalFolds?: number; totalTokensSaved?: number; sessionsCount?: number } }
          if (raw.stats !== undefined) {
            ;(setLedger as (v: { totalFolds?: number; totalTokensSaved?: number; sessionsCount?: number }) => void)(raw.stats)
            ;(setLedgerOk as (v: boolean) => void)(true)
          }
        })
        .catch(() => {
          if (!alive) return
          // S-4: a failed ledger read is SHOWN — the cumulative area renders
          // "stats unavailable" instead of mislabeling current-session values.
          ;(setLedgerOk as (v: boolean) => void)(false)
        })
      return () => { alive = false }
    }, [])
    const face = value.faceState ?? 'unknown'
    const faceZh = FACE_STATE_ZH[face] ?? face
    const faceColor = face === 'active' ? '#3fb950' : face === 'degraded' ? '#d29922' : '#f85149'
    const sessions = value.availableSessions ?? []
    // B-2: the input's data-type comes from the GET value's typeof — the save
    // path converts numbers with Number() and booleans with checked (B-2b).
    const inputFor = (k: string, v: unknown): unknown =>
      typeof v === 'boolean'
        ? e('input', { className: 'zctx-field-input', type: 'checkbox', defaultChecked: v === true, 'data-key': k, 'data-type': 'boolean' })
        : e('input', {
            className: 'zctx-field-input',
            type: 'text',
            defaultValue: String(v),
            'data-key': k,
            'data-type': typeof v === 'number' ? 'number' : 'text',
          })
    return e('div', { className: 'zctx-panel' },
      e('h2', { className: 'zctx-panel-title' }, t('panelTitle', lang)),
      e('div', { className: 'zctx-panel-face' },
        e('span', { className: 'zctx-dot', style: { color: faceColor } }, '●'),
        e('span', null, ` ${t('face', lang)}: ${faceZh}`)),
      // ZCTX-AUTOUI: the run-mode row (user: "不然我想用补丁完全功能模式不知道
      // 启动没有"). present = the patched app.asar is live; absent = pure
      // plugin mode; unknown/absent accessor = row hidden honestly.
      value.patchFace !== undefined
        ? e('div', { className: 'zctx-panel-row' },
            `${t('runMode', lang)}: ${
              value.patchFace.state === 'present'
                ? `${t('runModePatched', lang)}${value.patchFace.patchSet !== undefined ? ` (${value.patchFace.patchSet})` : ''}`
                : value.patchFace.state === 'absent'
                  ? t('runModePlugin', lang)
                  : t('runModeUnknown', lang)
            }`)
        : null,
      fetchError !== undefined
        ? e('div', { className: 'zctx-panel-err' }, `${t('fetchError', lang)}: ${fetchError}${t('retryHint', lang)}`)
        : null,
      e('h3', null, t('view', lang)),
      sessions.length >= 1
        ? e('div', { className: 'zctx-panel-row' },
            e('span', null, `${t('session', lang)}: `),
            sessions.length > 1
              ? e('select', {
                  className: 'zctx-panel-select',
                  value: picked ?? value.sessionId ?? '',
                  onChange: (ev: unknown) => {
                    const target = ev as { target?: { value?: string } }
                    const v = target?.target?.value
                    // B-1: only the selection state changes here — the
                    // snapshot effect's [picked] deps re-run and refetch with
                    // the picked session; a failed refetch keeps the last
                    // good snapshot (fetchError row).
                    if (typeof v === 'string') (setPicked as (v: string | undefined) => void)(v)
                  },
                },
                sessions.map((s) => e('option', { key: s, value: s }, s)))
              : e('span', null, picked ?? value.sessionId ?? 'n/a'))
        : null,
      e('div', { className: 'zctx-panel-row' },
        `${t('windowPressure', lang)}: ${value.pressurePct !== undefined ? `${value.pressurePct.toFixed(1)}%` : 'n/a'}`),
      e('div', { className: 'zctx-panel-row' },
        `${t('tokens', lang)}: ${value.totalTokens ?? 'n/a'} / ${value.contextWindow ?? 'n/a'}`),
      value.degradedCount !== undefined
        ? e('div', { className: 'zctx-panel-note' }, `${t('degradedRows', lang)}: ${value.degradedCount}${t('rowsSuffix', lang)}`)
        : null,
      e('h3', null, t('stats', lang)),
      ledgerOk
        ? [
            e('div', { className: 'zctx-panel-row', key: 'cum-folds' },
              `${t('foldCount', lang)}${t('cumulative', lang)}: ${ledger.totalFolds ?? 0}`),
            e('div', { className: 'zctx-panel-row', key: 'cum-saved' },
              `${t('totalsSaved', lang)}${ledger.totalTokensSaved ?? 'n/a'}`),
            e('div', { className: 'zctx-panel-row', key: 'cum-sessions' },
              `${t('sessionsCovered', lang)}${ledger.sessionsCount ?? 'n/a'}`),
          ]
        : e('div', { className: 'zctx-panel-err' }, t('statsUnavailable', lang)),
      e('div', { className: 'zctx-panel-row' },
        `${t('foldableRanges', lang)}${t('current', lang)}: ${value.ranges ?? 0}`),
      e('div', { className: 'zctx-panel-row' },
        `${t('cacheSamples', lang)}${t('current', lang)}: ${value.cacheSamples ?? 0}${value.cacheMeasured === true ? ` ${t('measured', lang)}` : ` ${t('estimatedNone', lang)}`}`),
      e('h3', null, t('settings', lang)),
      // ZCTX-FULLPANEL: settings are WRITABLE in the panel (same-origin +
      // loopback write authorization verified on the desktop). Uncontrolled
      // inputs (defaultValue/defaultChecked) — user edits survive the 5s
      // re-render, and the DOM is the save-path source of truth.
      // ZCTX-I18NFIX: the language selector is ALWAYS rendered (the GET view
      // omits uiLanguage when unset) with 'auto' as the untouched default; the
      // fields loop skips the key so it is never collected twice.
      e('div', { className: 'zctx-panel-fields' },
        e('label', { className: 'zctx-field', key: 'uiLanguage' },
          e('span', { className: 'zctx-field-key' }, fieldLabel('uiLanguage', lang)),
          e('select', {
            className: 'zctx-panel-select',
            defaultValue: typeof cfg.uiLanguage === 'string' ? cfg.uiLanguage : 'auto',
            'data-key': 'uiLanguage',
            'data-type': 'uiLanguage',
          },
          // Review-B1 建议-3: labels single-sourced from UI_DICT via the key.
          ...UI_LANG_OPTIONS.map((o) => e('option', { key: o.value, value: o.value }, t(o.key, lang)))),
          e('span', { className: 'zctx-field-note' }, t('langAutoNote', lang))),
        Object.keys(cfg).length > 0
          ? Object.entries(cfg)
              .filter(([k]) => k !== 'uiLanguage')
              .map(([k, v]) => e('label', { className: 'zctx-field', key: k },
                e('span', { className: 'zctx-field-key' }, fieldLabel(k, lang)),
                inputFor(k, v)))
          : t('configNotLoaded', lang)),
      e('h3', null, t('faceSwitches', lang)),
      // B-2a: the four face switches (observe.enabled / patch.guardObserveEvents
      // / autofold.enabled / preflightMode) render AND post — the wire shape
      // mirrors the GET view: `{ fields, faceSwitches }`.
      e('div', { className: 'zctx-panel-faces' },
        Object.keys(faces).length > 0
          ? Object.entries(faces).map(([k, v]) => {
              if (k === 'preflightMode') {
                // ZCTX-AUTOUI (review-A1 阻断-1): 'auto' MUST be an option —
                // it is the NEW DEFAULT, and a select without a matching
                // option would submit '' (whole-save 400) or silently resolve
                // to 'off' (preflight face silently disabled).
                return e('label', { className: 'zctx-field', key: k },
                  e('span', { className: 'zctx-field-key' }, fieldLabel(k, lang)),
                  e('select', {
                    className: 'zctx-panel-select',
                    defaultValue: typeof v === 'string' ? v : undefined,
                    'data-key': k,
                    'data-type': 'select',
                  },
                  ...['off', 'observe', 'enforce', 'auto'].map((m) => e('option', { key: m, value: m }, t(`preflightOpt${m.charAt(0).toUpperCase()}${m.slice(1)}` as UiDictKey, lang)))))
              }
              return e('label', { className: 'zctx-field', key: k },
                e('span', { className: 'zctx-field-key' }, fieldLabel(k, lang)),
                inputFor(k, v))
            })
          : t('configNotLoaded', lang)),
      e('button', {
        className: 'zctx-save',
        onClick: () => {
          const docLike = (typeof document !== 'undefined' ? document : undefined) as DocumentLike | undefined
          const resultEl = docLike?.querySelector?.('.zctx-save-result') ?? null
          const show = (message: string): void => {
            if (resultEl !== null) resultEl.textContent = message
          }
          const fieldsRoot = docLike?.querySelector?.('.zctx-panel-fields') ?? null
          const facesRoot = docLike?.querySelector?.('.zctx-panel-faces') ?? null
          if (fieldsRoot === null || facesRoot === null) return
          type PanelRoot = NonNullable<ReturnType<NonNullable<DocumentLike['querySelector']>>>
          const fields: Record<string, unknown> = {}
          const faceSwitchesPatch: Record<string, unknown> = {}
          const badNumberKeys: string[] = []
          const collect = (root: PanelRoot, into: Record<string, unknown>): void => {
            for (const el of root.querySelectorAll('[data-key]')) {
              const key = el.getAttribute('data-key')
              if (key === null) continue
              const type = el.getAttribute('data-type')
              if (type === 'boolean') {
                into[key] = el.checked === true
                continue
              }
              if (type === 'number') {
                // B-2b + S-10: numbers go over the wire AS NUMBERS (frozen
                // contract: every config field is primitive). An EMPTY value is
                // rejected too — Number('') === 0 would silently submit 0
                // (protection-floor semantics!); a NaN value is rejected as
                // before. Either way the WHOLE submit is rejected with the key
                // names shown — no partial write.
                const raw = typeof el.value === 'string' ? el.value.trim() : ''
                const n = raw === '' ? Number.NaN : Number(raw)
                if (Number.isNaN(n)) {
                  badNumberKeys.push(key)
                  continue
                }
                into[key] = n
                continue
              }
              into[key] = el.value
            }
          }
          collect(fieldsRoot, fields)
          collect(facesRoot, faceSwitchesPatch)
          if (badNumberKeys.length > 0) {
            show(`${t('invalidNumber', lang)}${badNumberKeys.join(', ')}`)
            return
          }
          void fetch('/zctx-ui/api/config', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ fields, faceSwitches: faceSwitchesPatch }),
          })
            .then((r) => r.json() as Promise<{ ok?: boolean; error?: string }>)
            .then((j) => {
              show(j.ok === true ? t('saved', lang) : `${t('saveFailed', lang)}: ${j.error ?? ''}`)
            })
            .catch(() => { /* next poll refreshes; never throw from a click */ })
        },
      }, t('save', lang)),
      e('span', { className: 'zctx-save-result' }),
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
 * → lazy no-op (no PENDING, no throw). Falls back to a plain text card if
 * React is unavailable (B-3: text, never a link — the page route is gone).
 */
export function apply(ctx: ClientCtx, adapters: ClientAdapters = {}): void {
  const React = resolveReact(adapters)
  const fetchText = adapters.fetchText ?? sameOriginFetchText
  const styles = (ctx.get?.('styles') ?? undefined) as StylesLike | undefined
  const doc: DocumentLike | undefined = adapters.document ?? (typeof document !== 'undefined' ? document : undefined)

  const register = (): unknown => {
    const component = createSummaryCard(React, undefined, fetchText)
    // Expression-limit degrade (反-C2, B5-1): no React → a REAL text card
    // component (never a blank null card, never a dead link). The render
    // product asserts tag/text.
    const finalComponent = component ?? createFallbackCard(doc)
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
