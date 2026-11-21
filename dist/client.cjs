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
	configNotLoaded: {
		zh: "（配置未加载）",
		en: "(config not loaded)"
	},
	readonlyNote: {
		zh: "设置修改请到完整面板（此处只读，避免越权写入）：",
		en: "Read-only here — edit on the full page: "
	},
	openFullPanel: {
		zh: "打开完整面板 →",
		en: "Open full panel →"
	},
	copyAddress: {
		zh: "复制完整面板地址",
		en: "Copy panel address"
	},
	copied: {
		zh: "✓ 地址已复制",
		en: "✓ Address copied"
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
	language: {
		zh: "语言",
		en: "Language"
	},
	langAuto: {
		zh: "跟随 DSH（默认中文）",
		en: "Follow DSH (default Chinese)"
	},
	langZh: {
		zh: "中文",
		en: "Chinese"
	},
	langEn: {
		zh: "英语",
		en: "English"
	}
};
/** Resolve the UI language from the settings value (auto/zh/en) + optional host hint. */
function resolveLang(pref, hostHint) {
	if (pref === "zh" || pref === "en") return pref;
	if (hostHint !== void 0 && hostHint !== "") {
		const h = hostHint.toLowerCase();
		if (h.startsWith("en")) return "en";
		if (h.startsWith("zh")) return "zh";
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
* SLOT EXPRESSION LIMIT (反-C2): the card holds only summary text + a link to
* `/zctx-ui`; complex settings/stats stay on the full page. If React/styles are
* unavailable, the card DEGRADES TO A PLAIN LINK (still useful, no crash).
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
	".zctx-summary a{color:var(--dsw-alias-link-color, #6aa9ff);text-decoration:none;}",
	".zctx-panel{display:flex;flex-direction:column;gap:6px;padding:14px 18px;overflow-y:auto;height:100%;box-sizing:border-box;background:var(--dsw-alias-bg-layer-1, transparent);}",
	".zctx-panel-title{margin:0 0 4px;font-size:var(--dsw-alias-font-size-lg, 16px);color:var(--dsw-alias-label-primary, inherit);}",
	".zctx-panel-face{display:flex;align-items:center;gap:6px;font-size:var(--dsw-alias-font-size-sm, 12px);}",
	".zctx-panel h3{margin:10px 0 2px;font-size:var(--dsw-alias-font-size-sm, 13px);color:var(--dsw-alias-label-secondary, #aaa);border-bottom:1px solid var(--dsw-alias-border-color, #444);padding-bottom:2px;}",
	".zctx-panel-row{font-size:var(--dsw-alias-font-size-sm, 12px);color:var(--dsw-alias-label-primary, inherit);}",
	".zctx-panel-note{font-size:var(--dsw-alias-font-size-sm, 12px);color:var(--dsw-alias-label-secondary, #aaa);}",
	".zctx-panel-err{font-size:var(--dsw-alias-font-size-sm, 12px);color:#f85149;background:rgba(248,81,73,.08);border-radius:4px;padding:4px 8px;}",
	".zctx-panel a{color:var(--dsw-alias-link-color, #6aa9ff);text-decoration:none;}",
	".zctx-panel-icon{display:inline-flex;align-items:center;justify-content:center;line-height:1;}",
	".zctx-panel-fields{display:flex;flex-direction:column;gap:4px;}",
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
			sessionId: typeof parsed.sessionId === "string" ? parsed.sessionId : void 0
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
/** Build the card component. `React` may be absent → caller degrades to a link. */
function createSummaryCard(React, initial, fetchText) {
	if (React === void 0) return void 0;
	const e = React.createElement.bind(React);
	const holder = { data: initial };
	refreshSummary(fetchText).then((data) => {
		if (data !== void 0) holder.data = data;
	});
	return function SummaryCard() {
		const data = holder.data;
		const stats = [`折叠 ${data?.foldCount ?? 0} 次`, data?.pressurePct !== void 0 ? `窗口 ${data.pressurePct.toFixed(1)}%` : "窗口 n/a"].join(" · ");
		return e("div", { className: "zctx-summary" }, e("h3", null, "zcontext 摘要 (BETA)"), e("div", { className: "zctx-stats" }, stats), e("a", {
			href: "/zctx-ui",
			target: "_blank",
			rel: "noopener noreferrer"
		}, "打开 zcontext 面板 →"));
	};
}
/**
* Build the no-React fallback component. It returns a REAL, assertable render
* product: an `<a href="/zctx-ui">` DOM anchor (when a document is available)
* AND a `LinkRender` descriptor with a non-empty label. Never a blank `null`
* card (B5-1: the "plain link" promise must be genuinely rendered).
*/
function createFallbackLink(doc) {
	return function FallbackLink() {
		const text = "打开 zcontext 面板 →";
		let node;
		if (doc !== void 0 && typeof doc.createElement === "function") try {
			const anchor = doc.createElement("a");
			anchor.setAttribute("href", "/zctx-ui");
			anchor.setAttribute("target", "_blank");
			anchor.setAttribute("rel", "noopener noreferrer");
			anchor.textContent = text;
			node = anchor;
		} catch {}
		return {
			tag: "a",
			href: "/zctx-ui",
			target: "_blank",
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
		return view;
	} catch {
		return {};
	}
}
/**
* Build the side-panel component (方案 A1: `sidebar.panellist` + `main`).
* Renders 查看 / 统计 / 设置 (read-only; writes point at the full `/zctx-ui`
* page — U-2 token gap, honest degrade). Polls the same-origin snapshot API
* every 5s. Returns undefined when React is unavailable (caller degrades).
*/
function createPanelComponent(React, fetchText) {
	if (React === void 0) return void 0;
	const e = React.createElement;
	return function ZctxPanel() {
		const nav = globalThis.navigator;
		const navLang = typeof nav?.language === "string" ? nav.language : void 0;
		const lang = resolveLang(void 0, navLang);
		const t$1 = t;
		const [data, setData] = React.useState?.({}) ?? [{}, () => void 0];
		const value = data;
		const [fetchError, setFetchError] = React.useState?.(void 0) ?? [void 0, () => void 0];
		const [configFields, setConfigFields] = React.useState?.({}) ?? [{}, () => void 0];
		const [ledger, setLedger] = React.useState?.({}) ?? [{}, () => void 0];
		const cfg = configFields;
		React.useEffect?.(() => {
			let alive = true;
			const load = () => {
				fetchText("/zctx-ui/api/snapshot").then((text) => {
					if (!alive) return;
					setData(parsePanelSnapshot(text));
					setFetchError(void 0);
				}).catch((err) => {
					if (!alive) return;
					setFetchError(err instanceof Error ? err.message : String(err));
				});
				fetchText("/zctx-ui/api/stats").then((text) => {
					if (!alive) return;
					const raw = JSON.parse(text);
					if (raw.stats !== void 0) setLedger(raw.stats);
				}).catch(() => {});
			};
			load();
			fetchText("/zctx-ui/api/config").then((text) => {
				if (!alive) return;
				const raw = JSON.parse(text);
				if (raw.fields !== void 0 && typeof raw.fields === "object") setConfigFields(raw.fields);
			}).catch(() => {});
			const timer = setInterval(load, 5e3);
			return () => {
				alive = false;
				clearInterval(timer);
			};
		}, []);
		const face = value.faceState ?? "unknown";
		const faceZh = FACE_STATE_ZH[face] ?? face;
		const faceColor = face === "active" ? "#3fb950" : face === "degraded" ? "#d29922" : "#f85149";
		const sessions = value.availableSessions ?? [];
		return e("div", { className: "zctx-panel" }, e("h2", { className: "zctx-panel-title" }, t$1("panelTitle", lang)), e("div", { className: "zctx-panel-face" }, e("span", {
			className: "zctx-dot",
			style: { color: faceColor }
		}, "●"), e("span", null, ` ${t$1("face", lang)}: ${faceZh}`)), fetchError !== void 0 ? e("div", { className: "zctx-panel-err" }, `${t$1("fetchError", lang)}: ${fetchError}${t$1("retryHint", lang)}`) : null, e("h3", null, t$1("view", lang)), sessions.length >= 1 ? e("div", { className: "zctx-panel-row" }, e("span", null, `${t$1("session", lang)}: `), sessions.length > 1 ? e("select", {
			className: "zctx-panel-select",
			value: value.sessionId ?? "",
			onChange: (ev) => {
				const target = ev;
				if (typeof target?.target?.value === "string") fetchText(`/zctx-ui/api/snapshot?session=${encodeURIComponent(target.target.value)}`).then((text) => {
					setData(parsePanelSnapshot(text));
				}).catch(() => {});
			}
		}, sessions.map((s) => e("option", {
			key: s,
			value: s
		}, s))) : e("span", null, value.sessionId ?? "n/a")) : null, e("div", { className: "zctx-panel-row" }, `${t$1("windowPressure", lang)}: ${value.pressurePct !== void 0 ? `${value.pressurePct.toFixed(1)}%` : "n/a"}`), e("div", { className: "zctx-panel-row" }, `${t$1("tokens", lang)}: ${value.totalTokens ?? "n/a"} / ${value.contextWindow ?? "n/a"}`), value.degradedCount !== void 0 ? e("div", { className: "zctx-panel-note" }, `${t$1("degradedRows", lang)}: ${value.degradedCount} 条`) : null, e("h3", null, t$1("stats", lang)), e("div", { className: "zctx-panel-row" }, `${t$1("foldCount", lang)}(累计): ${ledger.totalFolds ?? value.foldCount ?? 0}`), e("div", { className: "zctx-panel-row" }, `累计节省 tokens: ${ledger.totalTokensSaved ?? "n/a"}`), e("div", { className: "zctx-panel-row" }, `覆盖会话: ${ledger.sessionsCount ?? "n/a"}`), e("div", { className: "zctx-panel-row" }, `${t$1("foldableRanges", lang)}(当前): ${value.ranges ?? 0}`), e("div", { className: "zctx-panel-row" }, `${t$1("cacheSamples", lang)}(当前): ${value.cacheSamples ?? 0}${value.cacheMeasured === true ? ` ${t$1("measured", lang)}` : ` ${t$1("estimatedNone", lang)}`}`), e("h3", null, t$1("settings", lang)), e("div", { className: "zctx-panel-fields" }, Object.keys(cfg).length > 0 ? Object.entries(cfg).map(([k, v]) => e("label", {
			className: "zctx-field",
			key: k
		}, e("span", { className: "zctx-field-key" }, fieldLabel(k, lang)), e("input", {
			className: "zctx-field-input",
			type: typeof v === "boolean" ? "checkbox" : "text",
			...typeof v === "boolean" ? { checked: v } : { value: String(v) },
			"data-key": k
		}))) : t$1("configNotLoaded", lang)), e("button", {
			className: "zctx-save",
			onClick: () => {
				const patch = {};
				const docLike = typeof document !== "undefined" ? document : void 0;
				const root = docLike?.querySelector?.(".zctx-panel-fields") ?? null;
				if (root === null) return;
				const inputs = root.querySelectorAll("[data-key]");
				for (const el of inputs) {
					const key = el.getAttribute("data-key");
					if (key === null) continue;
					patch[key] = el.getAttribute("type") === "checkbox" ? el.checked === true : el.value;
				}
				fetch("/zctx-ui/api/config", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ fields: patch })
				}).then((r) => r.json()).then((j) => {
					const el2 = docLike?.querySelector?.(".zctx-save-result") ?? null;
					if (el2 === null) return;
					el2.textContent = j.ok === true ? t$1("saved", lang) : `${t$1("saveFailed", lang)}: ${j.error ?? ""}`;
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
* → lazy no-op (no PENDING, no throw). Falls back to a plain link component if
* React/styles unavailable.
*/
function apply(ctx, adapters = {}) {
	const React = resolveReact(adapters);
	const fetchText = adapters.fetchText ?? sameOriginFetchText;
	const styles = ctx.get?.("styles") ?? void 0;
	const doc = adapters.document ?? (typeof document !== "undefined" ? document : void 0);
	const register = () => {
		const finalComponent = createSummaryCard(React, void 0, fetchText) ?? createFallbackLink(doc);
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
exports.createFallbackLink = createFallbackLink;
exports.createPanelComponent = createPanelComponent;
exports.createPanelIcon = createPanelIcon;
exports.createSummaryCard = createSummaryCard;
exports.fiber = fiber;
exports.inject = inject;
exports.name = name;
exports.parsePanelSnapshot = parsePanelSnapshot;
exports.parseSummary = parseSummary;
return module.exports; } });