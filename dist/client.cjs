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
const CSS = [
	".zctx-summary{display:flex;flex-direction:column;gap:8px;padding:12px 14px;border:1px solid var(--dsw-alias-border-color, #444);border-radius:8px;background:var(--dsw-alias-bg-layer-1, transparent);}",
	".zctx-summary h3{margin:0;font-size:var(--dsw-alias-font-size-lg, 15px);color:var(--dsw-alias-label-primary, inherit);}",
	".zctx-summary .zctx-stats{display:flex;gap:16px;color:var(--dsw-alias-label-secondary, #aaa);font-size:var(--dsw-alias-font-size-sm, 12px);}",
	".zctx-summary a{color:var(--dsw-alias-link-color, #6aa9ff);text-decoration:none;}"
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
/**
* Top-level fiber apply. Capability-probes every host surface; `slots` absent
* → lazy no-op (no PENDING, no throw). Falls back to a plain link component if
* React/styles unavailable.
*/
function apply(ctx, adapters = {}) {
	const React = resolveReact(adapters);
	const fetchText = adapters.fetchText ?? ((url) => fetch(url).then((r) => r.text()));
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
	if (ctx.slots === void 0 || typeof ctx.slots.inject !== "function") return;
	try {
		ctx.slots.inject(SLOT_KEY, register);
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
exports.createSummaryCard = createSummaryCard;
exports.fiber = fiber;
exports.inject = inject;
exports.name = name;
exports.parseSummary = parseSummary;
return module.exports; } });