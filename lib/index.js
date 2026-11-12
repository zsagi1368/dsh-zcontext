import { createRequire } from "node:module";
// src/index.ts
/**
* dsh-zcontext — model-driven incremental context folding for the DeepSeek
* Harness (official surface replace channel).
*
* W1 minimal skeleton: identity exports, the plugin class with static
* `inject` / `Config`, and a constructor that stores the resolved config.
* No folding logic lives here yet (W2-W4 waves).
*
* Host-face types are structural (duck-typed): neither `@deepseek-ai/cordis`
* nor `@deepseek-ai/schemastery` is imported statically, so the package has
* no hard runtime dependency on either. Schemastery is resolved lazily at
* load time and falls back to a minimal built-in validator (fail-soft) when
* it cannot be resolved, so this module always loads.
*
* @module dsh-zcontext
*/
/** Contractual defaults for every Config field (plan §3). */
const configDefaults = Object.freeze({
	enabled: true,
	nudgeThresholds: "25,50,75,90",
	keepRecentTokens: 0,
	maxFoldFraction: .6,
	minFoldableTokens: 5e3,
	protectionFloorTokens: 5e3,
	summaryFloorChars: 50,
	summaryCeilingChars: 2e4,
	netShrinkTolerance: 1.05
});
/**
* Field-type table driving both the schemastery schema and the fail-soft
* validator. `satisfies` pins it to the `ZcontextConfig` key set: adding or
* removing a config field without updating this table fails to compile.
*/
const CONFIG_FIELD_SPECS = {
	enabled: {
		type: "boolean",
		default: configDefaults.enabled
	},
	nudgeThresholds: {
		type: "string",
		default: configDefaults.nudgeThresholds
	},
	keepRecentTokens: {
		type: "number",
		default: configDefaults.keepRecentTokens
	},
	maxFoldFraction: {
		type: "number",
		default: configDefaults.maxFoldFraction
	},
	minFoldableTokens: {
		type: "number",
		default: configDefaults.minFoldableTokens
	},
	protectionFloorTokens: {
		type: "number",
		default: configDefaults.protectionFloorTokens
	},
	summaryFloorChars: {
		type: "number",
		default: configDefaults.summaryFloorChars
	},
	summaryCeilingChars: {
		type: "number",
		default: configDefaults.summaryCeilingChars
	},
	netShrinkTolerance: {
		type: "number",
		default: configDefaults.netShrinkTolerance
	}
};
const nodeRequire = createRequire(import.meta.url);
/**
* Resolve the host's schemastery if present; `undefined` keeps module loading
* fail-soft (the fallback validator below takes over).
*/
function loadSchemastery() {
	try {
		return nodeRequire("@deepseek-ai/schemastery");
	} catch {
		return;
	}
}
/** Vendor tag for the fail-soft validator (distinguishes it from real schemastery). */
const FAIL_SOFT_VENDOR = "dsh-zcontext/fail-soft";
/** Build a minimal standard-schema validator applying plan §3 defaults. */
function createFailSoftConfigSchema() {
	const validate = (input) => {
		const source = input !== null && typeof input === "object" ? input : {};
		const output = {};
		for (const [key, spec] of Object.entries(CONFIG_FIELD_SPECS)) {
			const raw = source[key];
			if (raw === void 0 || raw === null) {
				output[key] = spec.default;
				continue;
			}
			if (!(spec.type === "boolean" ? typeof raw === "boolean" : spec.type === "number" ? typeof raw === "number" && Number.isFinite(raw) : typeof raw === "string")) return { issues: [{ message: `config.${key}: expected ${spec.type}` }] };
			output[key] = raw;
		}
		return { value: output };
	};
	return { "~standard": {
		version: 1,
		vendor: FAIL_SOFT_VENDOR,
		validate
	} };
}
/** Build the Config schema against the real schemastery when resolvable. */
function buildConfigSchemaWith(z) {
	const fields = {};
	for (const [key, spec] of Object.entries(CONFIG_FIELD_SPECS)) fields[key] = (spec.type === "boolean" ? z.boolean() : spec.type === "number" ? z.number() : z.string()).default(spec.default);
	return z.object(fields);
}
/** Plugin Config schema: schemastery-backed when available, fail-soft shim otherwise. */
const configSchema = (() => {
	const z = loadSchemastery();
	return z === void 0 ? createFailSoftConfigSchema() : buildConfigSchemaWith(z);
})();
/** Plugin identity exported for loader probes. */
const name = "dsh-zcontext";
/**
* W1 minimal plugin class.
*
* - `inject` stays empty until W3/W4 wire session/tools services.
* - `Config` is the frozen plan §3 schema (full primitive fields).
* - The constructor only stores the host context and the incoming config
*   with plan §3 defaults applied for absent fields (W3 adds the engine).
*/
var ZcontextPlugin = class {
	static inject = [];
	static Config = configSchema;
	/** Host context (structural duck-type; typed concretely in W3/W4). */
	ctx;
	/** Resolved plugin configuration (plan §3 contract). */
	config;
	constructor(ctx, config = {}) {
		this.ctx = ctx;
		this.config = Object.freeze({
			...configDefaults,
			...config
		});
	}
};
export { ZcontextPlugin, ZcontextPlugin as default, configDefaults, configSchema, name };

//# sourceMappingURL=index.js.map