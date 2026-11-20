window.__ModuleLoader__.load({ id: "dsh-zcontext", factory: (require) => { var module = { exports: {} }; var exports = module.exports;

Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
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
		const [data, setData] = React.useState?.({}) ?? [{}, () => void 0];
		const value = data;
		const [fetchError, setFetchError] = React.useState?.(void 0) ?? [void 0, () => void 0];
		const [configFields, setConfigFields] = React.useState?.({}) ?? [{}, () => void 0];
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
		const faceColor = face === "active" ? "#3fb950" : face === "degraded" ? "#d29922" : "#f85149";
		return e("div", { className: "zctx-panel" }, e("h2", { className: "zctx-panel-title" }, "zcontext 面板 (BETA)"), e("div", { className: "zctx-panel-face" }, e("span", {
			className: "zctx-dot",
			style: { color: faceColor }
		}, "●"), e("span", null, ` face: ${face}`)), fetchError !== void 0 ? e("div", { className: "zctx-panel-err" }, `数据读取失败: ${fetchError}（保留上次快照，5s 后重试）`) : null, e("h3", null, "查看"), e("div", { className: "zctx-panel-row" }, `会话: ${value.sessionId ?? "n/a"} (${value.sessionResolution ?? "n/a"})`), e("div", { className: "zctx-panel-row" }, `窗口占用: ${value.pressurePct !== void 0 ? `${value.pressurePct.toFixed(1)}%` : "n/a"}`), e("div", { className: "zctx-panel-row" }, `tokens: ${value.totalTokens ?? "n/a"} / ${value.contextWindow ?? "n/a"}`), value.degradedCount !== void 0 ? e("div", { className: "zctx-panel-note" }, `降级提示: ${value.degradedCount} 条`) : null, e("h3", null, "统计"), e("div", { className: "zctx-panel-row" }, `折叠次数: ${value.foldCount ?? 0}`), e("div", { className: "zctx-panel-row" }, `可折叠区间: ${value.ranges ?? 0}`), e("div", { className: "zctx-panel-row" }, `缓存样本: ${value.cacheSamples ?? 0}${value.cacheMeasured === true ? " (measured)" : " (estimated/none)"}`), e("h3", null, "设置"), e("div", { className: "zctx-panel-fields" }, Object.keys(cfg).length > 0 ? Object.entries(cfg).map(([k, v]) => e("label", {
			className: "zctx-field",
			key: k
		}, e("span", { className: "zctx-field-key" }, k), e("input", {
			className: "zctx-field-input",
			type: typeof v === "boolean" ? "checkbox" : "text",
			...typeof v === "boolean" ? { checked: v } : { value: String(v) },
			"data-key": k
		}))) : "（配置未加载）"), e("button", {
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
					el2.textContent = j.ok === true ? "✓ 已保存" : `✗ ${j.error ?? "保存失败"}`;
				}).catch(() => {});
			}
		}, "保存设置"), e("span", { className: "zctx-save-result" }), e("div", { className: "zctx-panel-note" }, "也可在完整面板修改："), e("a", {
			href: "/zctx-ui",
			target: "_blank",
			rel: "noopener noreferrer"
		}, "打开完整面板 →"), e("button", {
			className: "zctx-copy",
			onClick: () => {
				const browser = globalThis;
				const url = `${browser.location?.origin ?? ""}/zctx-ui`;
				const show = (text) => {
					const el = browser.document?.querySelector?.(".zctx-copy-result");
					if (el !== null && el !== void 0) el.textContent = text;
				};
				browser.navigator?.clipboard?.writeText(url).then(() => show("✓ 已复制: " + url)).catch(() => show(url));
			}
		}, "复制完整面板地址"), e("span", { className: "zctx-copy-result" }));
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