window.__ModuleLoader__.load({ id: "dsh-zcontext", factory: (require) => { var module = { exports: {} }; var exports = module.exports;

Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
// src/ui/i18n.ts
/** All UI copy, keyed by stable ids. Both languages are complete. */
const UI_DICT = {
	panelTitle: {
		zh: "zcontext 面板 (BETA)",
		en: "zcontext Panel (BETA)"
	},
	face: {
		zh: "状态",
		en: "face"
	},
	view: {
		zh: "查看",
		en: "View"
	},
	stats: {
		zh: "统计",
		en: "Stats"
	},
	settings: {
		zh: "设置",
		en: "Settings"
	},
	session: {
		zh: "会话",
		en: "Session"
	},
	windowPressure: {
		zh: "窗口占用",
		en: "Window pressure"
	},
	tokens: {
		zh: "tokens",
		en: "tokens"
	},
	foldCount: {
		zh: "折叠次数",
		en: "Fold count"
	},
	foldableRanges: {
		zh: "可折叠区间",
		en: "Foldable ranges"
	},
	cacheSamples: {
		zh: "缓存样本",
		en: "Cache samples"
	},
	measured: {
		zh: "(measured)",
		en: "(measured)"
	},
	estimatedNone: {
		zh: "(estimated/none)",
		en: "(estimated/none)"
	},
	degradedRows: {
		zh: "降级提示",
		en: "Degradation notes"
	},
	rowsSuffix: {
		zh: " 条",
		en: " rows"
	},
	configNotLoaded: {
		zh: "（配置未加载）",
		en: "(config not loaded)"
	},
	save: {
		zh: "保存设置",
		en: "Save settings"
	},
	saved: {
		zh: "✓ 已保存（新会话生效）",
		en: "✓ Saved (applies to new sessions)"
	},
	saveFailed: {
		zh: "✗ 保存失败",
		en: "✗ Save failed"
	},
	fetchError: {
		zh: "数据读取失败",
		en: "Snapshot read failed"
	},
	retryHint: {
		zh: "（保留上次快照，5s 后重试）",
		en: "(keeping last snapshot; retrying in 5s)"
	},
	cumulative: {
		zh: "(累计)",
		en: "(cumulative)"
	},
	totalsSaved: {
		zh: "累计节省 tokens: ",
		en: "Cumulative tokens saved: "
	},
	sessionsCovered: {
		zh: "覆盖会话: ",
		en: "Sessions covered: "
	},
	current: {
		zh: "(当前)",
		en: "(current)"
	},
	statsUnavailable: {
		zh: "统计暂不可用",
		en: "stats unavailable"
	},
	faceSwitches: {
		zh: "face 开关",
		en: "Face switches"
	},
	invalidNumber: {
		zh: "数值字段无效或为空（未提交）: ",
		en: "Invalid or empty number field(s) — nothing was saved: "
	},
	summaryTitle: {
		zh: "zcontext 摘要 (BETA)",
		en: "zcontext summary (BETA)"
	},
	summaryFolds: {
		zh: "折叠 {n} 次",
		en: "{n} folds"
	},
	summaryWindow: {
		zh: "窗口 {p}%",
		en: "Window {p}%"
	},
	summaryWindowNa: {
		zh: "窗口 n/a",
		en: "Window n/a"
	},
	panelLinkHint: {
		zh: "请在左侧菜单 zcontext 打开面板",
		en: "Open the panel from the zcontext entry in the left menu"
	},
	langOptFollow: {
		zh: "跟随 DSH",
		en: "Follow DSH"
	},
	langOptZh: {
		zh: "中文",
		en: "Chinese"
	},
	langOptEn: {
		zh: "English",
		en: "English"
	},
	langAutoNote: {
		zh: "（自动=桌面端确认语言；探测不到时默认中文）",
		en: "(auto = desktop-confirmed language; falls back to Chinese)"
	},
	runMode: {
		zh: "运行形态",
		en: "Run mode"
	},
	runModePatched: {
		zh: "补丁完全功能模式",
		en: "Full patch mode"
	},
	runModePlugin: {
		zh: "纯插件模式",
		en: "Pure plugin mode"
	},
	runModeUnknown: {
		zh: "形态未知",
		en: "Unknown"
	}
};
/**
* ZCTX-I18NFIX: the three uiLanguage selector options. Labels are SINGLE-SOURCED
* from UI_DICT (review-B1 建议-3 — the former literal duplicates drifted from
* the dict rows); the value list itself is structural, not copy.
*/
const UI_LANG_OPTIONS = [
	{
		value: "auto",
		key: "langOptFollow"
	},
	{
		value: "zh",
		key: "langOptZh"
	},
	{
		value: "en",
		key: "langOptEn"
	}
];
/**
* Resolve the UI language: explicit preference > host probe > default zh.
* A DETECTED non-zh locale maps to `en` (user 2026-11-20 "其他语言只显示英语";
* review-B3 B-4a — the previous fallthrough returned zh for e.g. ja-JP).
*/
function resolveLang(pref, hostHint) {
	if (pref === "zh" || pref === "en") return pref;
	if (hostHint !== void 0 && hostHint !== "") {
		if (hostHint.toLowerCase().startsWith("zh")) return "zh";
		return "en";
	}
	return "zh";
}
/** Config key → zh labels (九字段+face 开关全量；en shows the raw key). */
const FIELD_LABELS = {
	enabled: {
		zh: "插件总开关",
		en: "enabled"
	},
	nudgeThresholds: {
		zh: "提示阈值（%）",
		en: "nudge thresholds (%)"
	},
	keepRecentTokens: {
		zh: "保留最近 tokens",
		en: "keep recent tokens"
	},
	maxFoldFraction: {
		zh: "最大折叠占比",
		en: "max fold fraction"
	},
	minFoldableTokens: {
		zh: "最小可折叠 tokens",
		en: "min foldable tokens"
	},
	protectionFloorTokens: {
		zh: "保护下限 tokens",
		en: "protection floor tokens"
	},
	summaryFloorChars: {
		zh: "摘要下限字符",
		en: "summary floor chars"
	},
	summaryCeilingChars: {
		zh: "摘要上限字符",
		en: "summary ceiling chars"
	},
	netShrinkTolerance: {
		zh: "净缩容容差",
		en: "net shrink tolerance"
	},
	"observe.enabled": {
		zh: "观测面开关",
		en: "observe face"
	},
	"patch.guardObserveEvents": {
		zh: "补丁 guard 观测桥",
		en: "patch guard-observe bridge"
	},
	"autofold.enabled": {
		zh: "自动折叠开关",
		en: "autofold face"
	},
	preflightMode: {
		zh: "preflight 模式 (off|observe|enforce)",
		en: "preflight mode (off|observe|enforce)"
	},
	uiLanguage: {
		zh: "界面语言",
		en: "UI language"
	}
};
/** Face state → zh. */
const FACE_STATE_ZH = {
	active: "正常",
	degraded: "降级",
	absent: "未激活"
};
/** Config-key label in the active language. */
function fieldLabel(key, lang) {
	const row = FIELD_LABELS[key];
	return row === void 0 ? key : row[lang];
}
/** Translate one key (unknown key → the key itself, loud enough to notice). */
function t(key, lang) {
	const row = UI_DICT[key];
	return row === void 0 ? String(key) : row[lang];
}

// src/client/index.ts
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
/** Must equal the package name — the loader's boot-graph row id (handshake). */
const name = "dsh-zcontext";
/** Minimal certain inject set — `slots` is the only guaranteed web/desktop service. */
const inject = ["slots"];
function resolveReact(adapters) {
	if (adapters.React !== void 0) return adapters.React;
	try {
		if (typeof require === "function") return require("react");
	} catch {}
}
const SLOT_KEY = "settings.section";
const CARD_ID = "dsh-zcontext-summary";
/** The left-menu panel id — the SAME value binds `sidebar.panellist` and `main`. */
const PANEL_ID = "dsh-zcontext.panel";
const PANEL_ORDER = 60;
const CSS = [
	".zctx-summary{display:flex;flex-direction:column;gap:8px;padding:12px 14px;border:1px solid var(--dsw-alias-border-color, #444);border-radius:8px;background:var(--dsw-alias-bg-layer-1, transparent);}",
	".zctx-summary h3{margin:0;font-size:var(--dsw-alias-font-size-lg, 15px);color:var(--dsw-alias-label-primary, inherit);}",
	".zctx-summary .zctx-stats{display:flex;gap:16px;color:var(--dsw-alias-label-secondary, #aaa);font-size:var(--dsw-alias-font-size-sm, 12px);}",
	".zctx-summary-note{font-size:var(--dsw-alias-font-size-sm, 12px);color:var(--dsw-alias-label-secondary, #aaa);}",
	".zctx-panel{display:flex;flex-direction:column;gap:6px;padding:14px 18px;overflow-y:auto;height:100%;box-sizing:border-box;background:var(--dsw-alias-bg-layer-1, transparent);}",
	".zctx-panel-title{margin:0 0 4px;font-size:var(--dsw-alias-font-size-lg, 16px);color:var(--dsw-alias-label-primary, inherit);}",
	".zctx-panel-face{display:flex;align-items:center;gap:6px;font-size:var(--dsw-alias-font-size-sm, 12px);}",
	".zctx-panel h3{margin:10px 0 2px;font-size:var(--dsw-alias-font-size-sm, 13px);color:var(--dsw-alias-label-secondary, #aaa);border-bottom:1px solid var(--dsw-alias-border-color, #444);padding-bottom:2px;}",
	".zctx-panel-row{font-size:var(--dsw-alias-font-size-sm, 12px);color:var(--dsw-alias-label-primary, inherit);}",
	".zctx-panel-note{font-size:var(--dsw-alias-font-size-sm, 12px);color:var(--dsw-alias-label-secondary, #aaa);}",
	".zctx-panel-err{font-size:var(--dsw-alias-font-size-sm, 12px);color:#f85149;background:rgba(248,81,73,.08);border-radius:4px;padding:4px 8px;}",
	".zctx-panel-icon{display:inline-flex;align-items:center;justify-content:center;line-height:1;}",
	".zctx-panel-fields{display:flex;flex-direction:column;gap:4px;}",
	".zctx-panel-faces{display:flex;flex-direction:column;gap:4px;}",
	".zctx-panel-select{background:var(--dsw-alias-bg-layer-2, #222);color:var(--dsw-alias-label-primary, inherit);border:1px solid var(--dsw-alias-border-color, #444);border-radius:4px;padding:2px 6px;font-size:var(--dsw-alias-font-size-sm, 12px);}",
	".zctx-field{display:flex;align-items:center;gap:8px;font-size:var(--dsw-alias-font-size-sm, 12px);}",
	".zctx-field-key{min-width:180px;color:var(--dsw-alias-label-secondary, #aaa);}",
	".zctx-field-input{flex:1;background:var(--dsw-alias-bg-layer-2, #222);color:var(--dsw-alias-label-primary, inherit);border:1px solid var(--dsw-alias-border-color, #444);border-radius:4px;padding:2px 6px;}",
	".zctx-save{align-self:flex-start;background:var(--dsw-alias-bg-layer-2, #238636);color:#fff;border:0;border-radius:6px;padding:4px 12px;font-size:var(--dsw-alias-font-size-sm, 12px);cursor:pointer;}",
	".zctx-save-result{font-size:var(--dsw-alias-font-size-sm, 12px);color:var(--dsw-alias-label-secondary, #aaa);}"
].join("");
/** Parse the minimal summary out of a snapshot JSON text (fail-soft). */
function parseSummary(text) {
	try {
		const parsed = JSON.parse(text);
		const attribution = parsed.attribution;
		const window = parsed.window;
		return {
			foldCount: typeof attribution?.foldCount === "number" ? attribution.foldCount : 0,
			pressurePct: typeof window?.pressurePct === "number" ? window.pressurePct : void 0,
			sessionId: typeof parsed.sessionId === "string" ? parsed.sessionId : void 0,
			locale: typeof parsed.locale === "string" ? parsed.locale : null
		};
	} catch {
		return;
	}
}
/** Fetch + parse the summary from the same-origin bridge (no token needed: same-origin/loopback read arm). */
async function refreshSummary(fetchText) {
	try {
		return parseSummary(await fetchText("/zctx-ui/api/snapshot"));
	} catch {
		return;
	}
}
/**
* The production fetch face: it must REJECT on a non-2xx (`403` after a policy
* change, `500` on a fault). Resolving the error page as text would render
* "折叠 0 / 缓存 0" — fabricated zeros against the honest-degrade vocabulary
* (B3-S7). Callers then keep the last good snapshot.
*/
const sameOriginFetchText = (url) => fetch(url).then((r) => {
	if (!r.ok) throw new Error(`zctx panel: GET ${url} → HTTP ${r.status}`);
	return r.text();
});
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
function cardLang(localeHint) {
	if (typeof localeHint === "string" && localeHint !== "") return resolveLang(void 0, localeHint);
	const nav = globalThis.navigator;
	const navLang = typeof nav?.language === "string" ? nav.language : void 0;
	return resolveLang(void 0, navLang);
}
/**
* Build the card component. `React` may be absent → caller degrades to a text
* card. B-3: NO link — the browser page route was removed; the card is a pure
* summary plus a pointer to the native left-menu panel entry. S-9: ALL copy
* comes from the i18n dictionary (same language resolution as the panel).
*/
function createSummaryCard(React, initial, fetchText) {
	if (React === void 0) return void 0;
	const e = React.createElement.bind(React);
	const holder = { data: initial };
	refreshSummary(fetchText).then((data) => {
		if (data !== void 0) holder.data = data;
	});
	return function SummaryCard() {
		const data = holder.data;
		const lang = cardLang(data?.locale);
		const stats = [t("summaryFolds", lang).replace("{n}", String(data?.foldCount ?? 0)), data?.pressurePct !== void 0 ? t("summaryWindow", lang).replace("{p}", data.pressurePct.toFixed(1)) : t("summaryWindowNa", lang)].join(" · ");
		return e("div", { className: "zctx-summary" }, e("h3", null, t("summaryTitle", lang)), e("div", { className: "zctx-stats" }, stats), e("div", { className: "zctx-summary-note" }, t("panelLinkHint", lang)));
	};
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
function createFallbackCard(doc) {
	return function FallbackCard() {
		const text = t("panelLinkHint", cardLang(null));
		let node;
		if (doc !== void 0 && typeof doc.createElement === "function") try {
			const span = doc.createElement("span");
			span.textContent = text;
			node = span;
		} catch {}
		return {
			tag: "span",
			text,
			...node !== void 0 ? { node } : {}
		};
	};
}
/** Parse the /zctx-ui/api/snapshot JSON into the panel's view model. */
function parsePanelSnapshot(text) {
	try {
		const raw = JSON.parse(text);
		const face = raw.faceHealth ?? {};
		const win = raw.window ?? {};
		const pressure = typeof win.pressurePct === "number" ? win.pressurePct : void 0;
		const total = win.totalTokens ?? {};
		const t = typeof total.value === "number" ? total.value : void 0;
		const cw = typeof win.contextWindow === "number" ? win.contextWindow : void 0;
		const cache = raw.cache ?? {};
		const folds = Array.isArray(raw.folds) ? raw.folds.length : void 0;
		const ranges = Array.isArray(raw.ranges) ? raw.ranges.length : void 0;
		const degradedRows = Array.isArray(raw.degraded) ? raw.degraded.length : 0;
		const view = {};
		if (typeof raw.sessionId === "string") view.sessionId = raw.sessionId;
		if (typeof raw.sessionResolution === "string") view.sessionResolution = raw.sessionResolution;
		if (typeof face.state === "string") view.faceState = face.state;
		if (folds !== void 0) view.foldCount = folds;
		if (pressure !== void 0) view.pressurePct = pressure;
		if (t !== void 0) view.totalTokens = t;
		if (cw !== void 0) view.contextWindow = cw;
		if (typeof cache.samples === "number") view.cacheSamples = cache.samples;
		if (cache.measured === true) view.cacheMeasured = true;
		if (ranges !== void 0) view.ranges = ranges;
		if (degradedRows > 0) view.degradedCount = degradedRows;
		if (Array.isArray(raw.availableSessions)) view.availableSessions = raw.availableSessions.filter((x) => typeof x === "string");
		if (typeof raw.locale === "string") view.locale = raw.locale;
		if (raw.patchFace !== null && typeof raw.patchFace === "object" && !Array.isArray(raw.patchFace)) {
			const pf = raw.patchFace;
			if (pf.state === "present" || pf.state === "absent" || pf.state === "unknown") view.patchFace = {
				state: pf.state,
				...typeof pf.patchSet === "string" ? { patchSet: pf.patchSet } : {},
				...typeof pf.version === "string" ? { version: pf.version } : {}
			};
		}
		return view;
	} catch {
		return {};
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
function createPanelComponent(React, fetchText) {
	if (React === void 0) return void 0;
	const e = React.createElement;
	return function ZctxPanel() {
		const nav = globalThis.navigator;
		const navLang = typeof nav?.language === "string" ? nav.language : void 0;
		const t$1 = t;
		const [data, setData] = React.useState?.({}) ?? [{}, () => void 0];
		const value = data;
		const [fetchError, setFetchError] = React.useState?.(void 0) ?? [void 0, () => void 0];
		const [configFields, setConfigFields] = React.useState?.({}) ?? [{}, () => void 0];
		const [faceSwitches, setFaceSwitches] = React.useState?.({}) ?? [{}, () => void 0];
		const [ledger, setLedger] = React.useState?.({}) ?? [{}, () => void 0];
		const [ledgerOk, setLedgerOk] = React.useState?.(false) ?? [false, () => void 0];
		const [picked, setPicked] = React.useState?.(void 0) ?? [void 0, () => void 0];
		const cfg = configFields;
		const faces = faceSwitches;
		const prefRaw = typeof cfg.uiLanguage === "string" ? cfg.uiLanguage : void 0;
		const lang = resolveLang(prefRaw === "zh" || prefRaw === "en" ? prefRaw : void 0, typeof value.locale === "string" ? value.locale : navLang);
		React.useEffect?.(() => {
			let alive = true;
			const load = () => {
				fetchText(picked !== void 0 ? `/zctx-ui/api/snapshot?session=${encodeURIComponent(picked)}` : "/zctx-ui/api/snapshot").then((text) => {
					if (!alive) return;
					setData(parsePanelSnapshot(text));
					setFetchError(void 0);
				}).catch((err) => {
					if (!alive) return;
					setFetchError(err instanceof Error ? err.message : String(err));
				});
			};
			load();
			const timer = setInterval(load, 5e3);
			return () => {
				alive = false;
				clearInterval(timer);
			};
		}, [picked]);
		React.useEffect?.(() => {
			let alive = true;
			fetchText("/zctx-ui/api/config").then((text) => {
				if (!alive) return;
				const raw = JSON.parse(text);
				if (raw.fields !== void 0 && typeof raw.fields === "object") setConfigFields(raw.fields);
				if (raw.faceSwitches !== void 0 && typeof raw.faceSwitches === "object") setFaceSwitches(raw.faceSwitches);
			}).catch(() => {});
			fetchText("/zctx-ui/api/stats").then((text) => {
				if (!alive) return;
				const raw = JSON.parse(text);
				if (raw.stats !== void 0) {
					setLedger(raw.stats);
					setLedgerOk(true);
				}
			}).catch(() => {
				if (!alive) return;
				setLedgerOk(false);
			});
			return () => {
				alive = false;
			};
		}, []);
		const face = value.faceState ?? "unknown";
		const faceZh = FACE_STATE_ZH[face] ?? face;
		const faceColor = face === "active" ? "#3fb950" : face === "degraded" ? "#d29922" : "#f85149";
		const sessions = value.availableSessions ?? [];
		const inputFor = (k, v) => typeof v === "boolean" ? e("input", {
			className: "zctx-field-input",
			type: "checkbox",
			defaultChecked: v === true,
			"data-key": k,
			"data-type": "boolean"
		}) : e("input", {
			className: "zctx-field-input",
			type: "text",
			defaultValue: String(v),
			"data-key": k,
			"data-type": typeof v === "number" ? "number" : "text"
		});
		return e("div", { className: "zctx-panel" }, e("h2", { className: "zctx-panel-title" }, t$1("panelTitle", lang)), e("div", { className: "zctx-panel-face" }, e("span", {
			className: "zctx-dot",
			style: { color: faceColor }
		}, "●"), e("span", null, ` ${t$1("face", lang)}: ${faceZh}`)), value.patchFace !== void 0 ? e("div", { className: "zctx-panel-row" }, `${t$1("runMode", lang)}: ${value.patchFace.state === "present" ? `${t$1("runModePatched", lang)}${value.patchFace.patchSet !== void 0 ? ` (${value.patchFace.patchSet})` : ""}` : value.patchFace.state === "absent" ? t$1("runModePlugin", lang) : t$1("runModeUnknown", lang)}`) : null, fetchError !== void 0 ? e("div", { className: "zctx-panel-err" }, `${t$1("fetchError", lang)}: ${fetchError}${t$1("retryHint", lang)}`) : null, e("h3", null, t$1("view", lang)), sessions.length >= 1 ? e("div", { className: "zctx-panel-row" }, e("span", null, `${t$1("session", lang)}: `), sessions.length > 1 ? e("select", {
			className: "zctx-panel-select",
			value: picked ?? value.sessionId ?? "",
			onChange: (ev) => {
				const v = ev?.target?.value;
				if (typeof v === "string") setPicked(v);
			}
		}, sessions.map((s) => e("option", {
			key: s,
			value: s
		}, s))) : e("span", null, picked ?? value.sessionId ?? "n/a")) : null, e("div", { className: "zctx-panel-row" }, `${t$1("windowPressure", lang)}: ${value.pressurePct !== void 0 ? `${value.pressurePct.toFixed(1)}%` : "n/a"}`), e("div", { className: "zctx-panel-row" }, `${t$1("tokens", lang)}: ${value.totalTokens ?? "n/a"} / ${value.contextWindow ?? "n/a"}`), value.degradedCount !== void 0 ? e("div", { className: "zctx-panel-note" }, `${t$1("degradedRows", lang)}: ${value.degradedCount}${t$1("rowsSuffix", lang)}`) : null, e("h3", null, t$1("stats", lang)), ledgerOk ? [
			e("div", {
				className: "zctx-panel-row",
				key: "cum-folds"
			}, `${t$1("foldCount", lang)}${t$1("cumulative", lang)}: ${ledger.totalFolds ?? 0}`),
			e("div", {
				className: "zctx-panel-row",
				key: "cum-saved"
			}, `${t$1("totalsSaved", lang)}${ledger.totalTokensSaved ?? "n/a"}`),
			e("div", {
				className: "zctx-panel-row",
				key: "cum-sessions"
			}, `${t$1("sessionsCovered", lang)}${ledger.sessionsCount ?? "n/a"}`)
		] : e("div", { className: "zctx-panel-err" }, t$1("statsUnavailable", lang)), e("div", { className: "zctx-panel-row" }, `${t$1("foldableRanges", lang)}${t$1("current", lang)}: ${value.ranges ?? 0}`), e("div", { className: "zctx-panel-row" }, `${t$1("cacheSamples", lang)}${t$1("current", lang)}: ${value.cacheSamples ?? 0}${value.cacheMeasured === true ? ` ${t$1("measured", lang)}` : ` ${t$1("estimatedNone", lang)}`}`), e("h3", null, t$1("settings", lang)), e("div", { className: "zctx-panel-fields" }, e("label", {
			className: "zctx-field",
			key: "uiLanguage"
		}, e("span", { className: "zctx-field-key" }, fieldLabel("uiLanguage", lang)), e("select", {
			className: "zctx-panel-select",
			defaultValue: typeof cfg.uiLanguage === "string" ? cfg.uiLanguage : "auto",
			"data-key": "uiLanguage",
			"data-type": "uiLanguage"
		}, ...UI_LANG_OPTIONS.map((o) => e("option", {
			key: o.value,
			value: o.value
		}, t$1(o.key, lang)))), e("span", { className: "zctx-field-note" }, t$1("langAutoNote", lang))), Object.keys(cfg).length > 0 ? Object.entries(cfg).filter(([k]) => k !== "uiLanguage").map(([k, v]) => e("label", {
			className: "zctx-field",
			key: k
		}, e("span", { className: "zctx-field-key" }, fieldLabel(k, lang)), inputFor(k, v))) : t$1("configNotLoaded", lang)), e("h3", null, t$1("faceSwitches", lang)), e("div", { className: "zctx-panel-faces" }, Object.keys(faces).length > 0 ? Object.entries(faces).map(([k, v]) => {
			if (k === "preflightMode") return e("label", {
				className: "zctx-field",
				key: k
			}, e("span", { className: "zctx-field-key" }, fieldLabel(k, lang)), e("select", {
				className: "zctx-panel-select",
				defaultValue: typeof v === "string" ? v : void 0,
				"data-key": k,
				"data-type": "select"
			}, ...[
				"off",
				"observe",
				"enforce"
			].map((m) => e("option", {
				key: m,
				value: m
			}, m))));
			return e("label", {
				className: "zctx-field",
				key: k
			}, e("span", { className: "zctx-field-key" }, fieldLabel(k, lang)), inputFor(k, v));
		}) : t$1("configNotLoaded", lang)), e("button", {
			className: "zctx-save",
			onClick: () => {
				const docLike = typeof document !== "undefined" ? document : void 0;
				const resultEl = docLike?.querySelector?.(".zctx-save-result") ?? null;
				const show = (message) => {
					if (resultEl !== null) resultEl.textContent = message;
				};
				const fieldsRoot = docLike?.querySelector?.(".zctx-panel-fields") ?? null;
				const facesRoot = docLike?.querySelector?.(".zctx-panel-faces") ?? null;
				if (fieldsRoot === null || facesRoot === null) return;
				const fields = {};
				const faceSwitchesPatch = {};
				const badNumberKeys = [];
				const collect = (root, into) => {
					for (const el of root.querySelectorAll("[data-key]")) {
						const key = el.getAttribute("data-key");
						if (key === null) continue;
						const type = el.getAttribute("data-type");
						if (type === "boolean") {
							into[key] = el.checked === true;
							continue;
						}
						if (type === "number") {
							const raw = typeof el.value === "string" ? el.value.trim() : "";
							const n = raw === "" ? NaN : Number(raw);
							if (Number.isNaN(n)) {
								badNumberKeys.push(key);
								continue;
							}
							into[key] = n;
							continue;
						}
						into[key] = el.value;
					}
				};
				collect(fieldsRoot, fields);
				collect(facesRoot, faceSwitchesPatch);
				if (badNumberKeys.length > 0) {
					show(`${t$1("invalidNumber", lang)}${badNumberKeys.join(", ")}`);
					return;
				}
				fetch("/zctx-ui/api/config", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						fields,
						faceSwitches: faceSwitchesPatch
					})
				}).then((r) => r.json()).then((j) => {
					show(j.ok === true ? t$1("saved", lang) : `${t$1("saveFailed", lang)}: ${j.error ?? ""}`);
				}).catch(() => {});
			}
		}, t$1("save", lang)), e("span", { className: "zctx-save-result" }));
	};
}
/** A minimal left-menu icon component (panellist renders the icon, label is text). */
function createPanelIcon(React) {
	if (React === void 0) return () => null;
	const e = React.createElement;
	return function ZctxIcon() {
		return e("span", {
			className: "zctx-panel-icon",
			"aria-hidden": "true"
		}, "◎");
	};
}
/**
* Top-level fiber apply. Capability-probes every host surface; `slots` absent
* → lazy no-op (no PENDING, no throw). Falls back to a plain text card if
* React is unavailable (B-3: text, never a link — the page route is gone).
*/
function apply(ctx, adapters = {}) {
	const React = resolveReact(adapters);
	const fetchText = adapters.fetchText ?? sameOriginFetchText;
	const styles = ctx.get?.("styles") ?? void 0;
	const doc = adapters.document ?? (typeof document !== "undefined" ? document : void 0);
	const register = () => {
		const finalComponent = createSummaryCard(React, void 0, fetchText) ?? createFallbackCard(doc);
		return ctx.slots?.register?.({
			name: SLOT_KEY,
			id: CARD_ID,
			order: 50,
			registrant: name,
			label: "zcontext"
		}, finalComponent);
	};
	if (styles !== void 0 && typeof styles.insert === "function") try {
		ctx.effect?.(styles.insert(CSS), "zctx-summary-styles");
	} catch {}
	const slots = ctx.slots;
	if (slots === void 0 || typeof slots.inject !== "function") return;
	try {
		slots.inject(SLOT_KEY, register);
	} catch {}
	const panel = createPanelComponent(React, fetchText);
	if (panel === void 0) return;
	try {
		slots.inject("main", () => slots.register?.({
			name: "main",
			key: PANEL_ID
		}, panel));
	} catch {}
	try {
		slots.inject("sidebar.panellist", () => slots.register?.({
			name: "sidebar.panellist",
			id: PANEL_ID,
			order: PANEL_ORDER,
			label: () => "zcontext"
		}, createPanelIcon(React)));
	} catch {}
}
/** The fiber object the loader expects (object form with inject + apply). */
const fiber = {
	name,
	inject,
	apply
};

exports.apply = apply;
exports.createFallbackCard = createFallbackCard;
exports.createPanelComponent = createPanelComponent;
exports.createPanelIcon = createPanelIcon;
exports.createSummaryCard = createSummaryCard;
exports.fiber = fiber;
exports.inject = inject;
exports.name = name;
exports.parsePanelSnapshot = parsePanelSnapshot;
exports.parseSummary = parseSummary;
return module.exports; } });