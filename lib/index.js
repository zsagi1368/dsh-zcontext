import { o as toPiAssistantTwins, t as classifyPiAiErrorTwins } from "./map-Dxcht3mD.js";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { homedir } from "node:os";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
// src/config.ts
/**
* Plugin configuration contract and schema (plan §3; every field primitive).
*
* Moved verbatim from the W1 index.ts skeleton in W4: the plugin class needs
* `configSchema` at class-definition time (`static Config`), so it must live
* in a module the plugin imports WITHOUT the index.ts cycle. The public
* surface is unchanged — index.ts re-exports everything it always did.
*
* Host-face types are structural (duck-typed): `@deepseek-ai/schemastery` is
* resolved lazily at load time and falls back to a minimal built-in validator
* (fail-soft) when it cannot be resolved, so this module always loads.
*
* @module config
*/
/**
* Recursively freeze a defaults object (P3 deep-freeze hardening): the
* shallow `Object.freeze` left the shared `providers: []` ARRAY instance
* mutable-by-proxy — every plugin constructed without a providers
* declaration referenced the SAME array (AUD-architecture §6 【注意-微】;
* all current consumers are read-only, so the risk was unreachable — this
* makes the immutability structural instead of conventional).
*/
function deepFreeze(value) {
	if (value !== null && typeof value === "object") {
		for (const item of Object.values(value)) deepFreeze(item);
		Object.freeze(value);
	}
	return value;
}
/** Contractual defaults for every Config field (plan §3). */
const configDefaults = deepFreeze({
	enabled: true,
	nudgeThresholds: "25,50,75,90",
	keepRecentTokens: 0,
	maxFoldFraction: .6,
	minFoldableTokens: 5e3,
	protectionFloorTokens: 5e3,
	summaryFloorChars: 50,
	summaryCeilingChars: 2e4,
	netShrinkTolerance: 1.05,
	attributionTimeWindowMs: 9e4,
	cleanSampleFloor: .6,
	"observe.enabled": true,
	"observe.attemptCapture": false,
	"patch.guardObserveEvents": true,
	"autofold.enabled": false,
	"autofold.summarizer": "compaction",
	"autofold.external.url": "",
	"autofold.external.model": "",
	"autofold.external.apiKeyEnv": "",
	"autofold.maxRounds": 16,
	"autofold.maxBatch": 4,
	"autofold.maxSummaryOutputTokens": 32768,
	preflightMode: "observe",
	preflightMarginRatio: .9,
	providers: []
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
	},
	attributionTimeWindowMs: {
		type: "number",
		default: configDefaults.attributionTimeWindowMs
	},
	cleanSampleFloor: {
		type: "number",
		default: configDefaults.cleanSampleFloor
	},
	"observe.enabled": {
		type: "boolean",
		default: configDefaults["observe.enabled"]
	},
	"observe.attemptCapture": {
		type: "boolean",
		default: configDefaults["observe.attemptCapture"]
	},
	"patch.guardObserveEvents": {
		type: "boolean",
		default: configDefaults["patch.guardObserveEvents"]
	},
	"autofold.enabled": {
		type: "boolean",
		default: configDefaults["autofold.enabled"]
	},
	"autofold.summarizer": {
		type: "string",
		default: configDefaults["autofold.summarizer"]
	},
	"autofold.external.url": {
		type: "string",
		default: configDefaults["autofold.external.url"]
	},
	"autofold.external.model": {
		type: "string",
		default: configDefaults["autofold.external.model"]
	},
	"autofold.external.apiKeyEnv": {
		type: "string",
		default: configDefaults["autofold.external.apiKeyEnv"]
	},
	"autofold.maxRounds": {
		type: "number",
		default: configDefaults["autofold.maxRounds"]
	},
	"autofold.maxBatch": {
		type: "number",
		default: configDefaults["autofold.maxBatch"]
	},
	"autofold.maxSummaryOutputTokens": {
		type: "number",
		default: configDefaults["autofold.maxSummaryOutputTokens"]
	},
	preflightMode: {
		type: "string",
		default: configDefaults.preflightMode
	},
	preflightMarginRatio: {
		type: "number",
		default: configDefaults.preflightMarginRatio
	},
	providers: {
		type: "providers",
		default: []
	}
};
const nodeRequire$2 = createRequire(import.meta.url);
/**
* Resolve the host's schemastery if present; `undefined` keeps module loading
* fail-soft (the fallback validator below takes over).
*/
function loadSchemastery() {
	try {
		return nodeRequire$2("@deepseek-ai/schemastery");
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
			if (!(spec.type === "boolean" ? typeof raw === "boolean" : spec.type === "number" ? typeof raw === "number" && Number.isFinite(raw) : spec.type === "providers" ? Array.isArray(raw) : typeof raw === "string")) return { issues: [{ message: `config.${key}: expected ${spec.type}` }] };
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
	for (const [key, spec] of Object.entries(CONFIG_FIELD_SPECS)) {
		let node;
		if (spec.type === "boolean") node = z.boolean();
		else if (spec.type === "number") node = z.number();
		else if (spec.type === "providers") {
			const modelNode = z.object({
				id: z.string(),
				contextWindow: z.number(),
				maxTokens: z.number(),
				reasoningEfforts: z.dict(z.string())
			});
			const providerNode = z.object({
				family: z.string(),
				baseURL: z.string(),
				apiKeyEnv: z.string(),
				models: z.array(modelNode),
				cacheRetention: z.string(),
				cacheControlFormat: z.string()
			});
			node = z.array(providerNode);
		} else node = z.string();
		const defaulted = node.default(spec.default);
		fields[key] = spec.type === "providers" && typeof defaulted.volatile === "function" ? defaulted.volatile() : defaulted;
	}
	return z.object(fields);
}
/** Plugin Config schema: schemastery-backed when available, fail-soft shim otherwise. */
const configSchema = (() => {
	const z = loadSchemastery();
	return z === void 0 ? createFailSoftConfigSchema() : buildConfigSchemaWith(z);
})();
// src/texts.ts
/**
* Single home of every model-facing text constant (task card W2 constraint:
* 文本常量统一 src/texts.ts). The guidance section is original writing
* (clean-room: mechanism semantics aligned with the billion-context research,
* zero copied prompt text — reviewer checks against this file).
*
* Byte-stability contract (S10): no timestamp, counter, date, or any other
* dynamic content may enter these strings. `guidance.spec.ts` and
* `nudge.spec.ts` enforce this with regex and identity assertions.
*
* @module texts
*/
/**
* Fill a `{{key}}` template from the given variables: every `{{key}}` with a
* matching entry in `vars` is replaced by its stringified value; unknown
* placeholders are left verbatim.
*/
function fill(template, vars) {
	return template.replace(/\{\{(\w+)\}\}/g, (match, key) => key in vars ? String(vars[key]) : match);
}
/** Stable section id used for the systemPrompt.section registration. */
const GUIDANCE_SECTION_ID = "zctx-guidance";
/** The full static guidance text, byte-stable by contract (S10). */
const GUIDANCE_SECTION_TEXT = `Older parts of this conversation can be folded to keep the working window
small. Folding replaces a span of earlier turns with one short summary block.
Folds are reversible and searchable: zctx_unfold restores the materialized
content of a fold, and zctx_recall searches inside everything already folded.

When to fold
- Fold proactively as the conversation grows; do not wait until the window is
  full. The trigger line and current pressure come from zctx_status.
- Good fold targets are finished, self-contained stretches of work: a closed
  subtask, a resolved investigation, or a long run of tool output whose
  conclusions are already established elsewhere.

What a summary must keep
- The user's goals, requirements, and constraints, with their meaning intact.
- Current task state: what is done, what is in progress, what happens next.
- Decisions made and why; exact facts still needed later (names, paths,
  identifiers, commands, versions).
- Open objectives. This is the single exception to the metadata rule below:
  an unfinished objective is a live instruction and must remain phrased as
  one, not converted into a historical note.

What a summary should drop
- Superseded drafts and retries; keep only the accepted outcome.
- Verbose tool transcripts and logs; keep conclusions, not raw output.
- Anything still present verbatim elsewhere on the live surface.

Summary discipline
- A summary is metadata about the past, not an instruction to the future —
  except for open objectives, which stay instructions.
- Summaries MUST preserve the user's language: write each summary in the
  language the folded conversation was written in.
- Batch discipline: submit ALL ranges and their summaries in ONE zctx_fold
  call; the batch is committed atomically or rejected as a whole.

Trust and mode notes
- zctx_status is the single trusted ledger for pressure, budget, and fold
  history; never reconstruct those numbers from memory.
- Tool mode: call zctx_* tools directly in the native tool loop; in a
  run_code (PTC) session, dispatch zctx_* through run_code instead of
  expecting direct registration.`;
/** Role prefixes for re-materialized blocks. */
const MATERIALIZED_ROLE_PREFIX_USER = "[user]";
const MATERIALIZED_ROLE_PREFIX_ASSISTANT = "[assistant]";
const MATERIALIZED_ROLE_PREFIX_SYSTEM = "[system]";
const MATERIALIZED_ROLE_PREFIX_DEVELOPER = "[developer]";
/** Prefix for a re-materialized tool-result block (toolName appended). */
const MATERIALIZED_TOOL_PREFIX = "[tool";
/** Source annotation appended to re-materialized tool-result blocks. */
const MATERIALIZED_TOOL_SOURCE_NOTE = "(tool result quoted verbatim from the session log)";
/**
* Marker for a block re-materialized from an active fold checkpoint
* (one layer only — the checkpoint's own message text, not its originals).
*/
const MATERIALIZED_FOLDED_BLOCK_PREFIX = "[folded block ";
/** Placeholder block for a seq that is no longer readable in the log. */
const MATERIALIZED_MISSING_EVENT_PREFIX = "[unavailable event at seq ";
/** Marker for a message event that carries no text blocks at all. */
const MATERIALIZED_NO_TEXT_CONTENT = "(no text content)";
/** Header opening for the gentle band. */
const NUDGE_GENTLE_HEADER = "[context pressure: {{pct}}% — gentle reminder]";
/** Header opening for the emergency band. */
const NUDGE_EMERGENCY_HEADER = "[context pressure: {{pct}}% — EMERGENCY]";
/** Pressure-vs-trigger framing line ({{triggerPct}} = trigger line percent). */
const NUDGE_TRIGGER_LINE = "Window occupancy is {{pct}}% of the context window; the fold trigger line sits at {{triggerPct}}%.";
/** Budget breakdown intro. */
const NUDGE_BREAKDOWN_HEADER = "Budget breakdown (share of the context window):";
/** Budget breakdown row for the protected recent tail. */
const NUDGE_BREAKDOWN_KEEP_RECENT = "  - recent-tail reserve: {{pct}}%";
/** Budget breakdown row for the output/tool pessimistic reserve. */
const NUDGE_BREAKDOWN_RESERVE = "  - output and tool reserve: {{pct}}%";
/** Budget breakdown row for the fixed wire overhead. */
const NUDGE_BREAKDOWN_FIXED = "  - fixed tool+guidance overhead: {{pct}}%";
/** Foldable-span table header. */
const NUDGE_RANGES_HEADER = "Foldable spans (estimated tokens):";
/** Table row prefix for an unprotected span. */
const NUDGE_RANGE_ROW = "  - seq {{start}}..{{end}} (~{{tokens}} tokens)";
/** Marker appended to rows that must never be folded. */
const NUDGE_PROTECTED_MARKER = " PROTECTED";
/** Row used when the caller supplies no spans at all. */
const NUDGE_RANGES_EMPTY = "  (no foldable spans reported)";
/** Batch discipline reminder. */
const NUDGE_BATCH_REMINDER = "Submit ALL ranges and their summaries in ONE zctx_fold call — atomic batch. Check zctx_status first; it is the trusted ledger.";
/** Gentle-band closing line. */
const NUDGE_GENTLE_CLOSING = "Pick one or more completed stretches above and fold them now to stay ahead of the trigger line.";
/** Emergency-band closing line. */
const NUDGE_EMERGENCY_CLOSING = "Fold the largest unprotected spans immediately; keep only summaries and the protected tail.";
const REASON_RANGE_NOT_ON_SURFACE = "fold window [{{start}}, {{end}}] is not anchored on the surface: endpoints must be existing surface nodes";
const REASON_RANGE_INVERTED = "fold window [{{start}}, {{end}}] is inverted: startSeq must not exceed endSeq";
const REASON_RANGE_DISCONTIGUOUS = "fold window [{{start}}, {{end}}] is not contiguous on the surface: after a fold the surface is no longer numerically ordered (the checkpoint seq sits ahead of later nodes), so a window that spans a checkpoint plus later nodes is unreachable — an absorption-style fold must boundary-align with the checkpoint (window [checkpoint, checkpoint])";
const REASON_RANGE_EMPTY = "fold window [{{start}}, {{end}}] contains no surface nodes";
const REASON_NODE0 = "fold window [{{start}}, {{end}}] would shadow surface node 0 (the system head); the harness rejects any replace of the system head, so the window must start below it";
const REASON_PROTECTED_TAIL = "fold window [{{start}}, {{end}}] reaches into the protected recent tail (kept from seq {{seq}}: last {{messages}} messages / {{tokens}} tokens)";
const REASON_LAST_USER = "fold window [{{start}}, {{end}}] would shadow the last user message (seq {{seq}}); the latest user turn must stay intact";
const REASON_FIRST_USER = "fold window [{{start}}, {{end}}] would shadow the first user message (seq {{seq}}); it is pinned permanently";
const REASON_TOOL_UNKNOWN_PAIRING = "node at seq {{seq}} is a {{role}} message with unknown tool pairing; a store scan must supply toolCallIds/answersCallId before folding";
const REASON_TOOL_ORPHAN_RESULT = "tool result at seq {{seq}} answers call {{callId}} but no assistant message carrying that call is on the surface";
const REASON_TOOL_SPLIT_RESULT = "tool result at seq {{seq}} answers call {{callId}} made by assistant at seq {{assistantSeq}}; tool calls and their results must be folded together";
const REASON_TOOL_UNANSWERED_CALL = "assistant at seq {{seq}} calls tool {{callId}} whose result at seq {{toolSeq}} is outside the fold window; tool calls and their results must be folded together";
const REASON_ABSORBED_UNCOVERED = "fold window [{{start}}, {{end}}] absorbs active fold {{foldId}} (checkpoint seq {{checkpoint}}) but no submitted summary covers that checkpoint, nor does it align with the window boundary";
const REASON_SUMMARY_OUT_OF_WINDOW = "summary range [{{start}}, {{end}}] must sit inside the fold window [{{wStart}}, {{wEnd}}]";
const REASON_SUMMARY_OVERLAP = "summary ranges [{{aStart}}, {{aEnd}}] and [{{bStart}}, {{bEnd}}] overlap";
const REASON_SUMMARY_EMPTY = "no summaries submitted; every fold needs at least one";
const REASON_SUMMARY_TOO_SHORT = "summary [{{start}}, {{end}}] is {{len}} chars; minimum is {{min}}";
const REASON_SUMMARY_TOO_LONG = "summary [{{start}}, {{end}}] is {{len}} chars; maximum is {{max}}";
const REASON_WINDOW_TOO_SMALL = "fold window [{{start}}, {{end}}] carries an estimated {{tokens}} tokens; the qualification line is {{min}}";
const REASON_WINDOW_TOO_LARGE = "fold window [{{start}}, {{end}}] carries an estimated {{tokens}} tokens; one fold may cover at most {{maxPct}}% of the context window";
const REASON_NO_NET_SHRINK = "fold window [{{start}}, {{end}}] would grow the window: {{folded}} folded tokens x {{tolerance}} tolerance must exceed {{summary}} summary tokens";
/**
* Machine signature for the rendered net-shrink rejection (P6D2E-R4a):
* derived from REASON_NO_NET_SHRINK itself (the longest placeholder-free
* fragment), so a wording edit automatically carries the classifier with it.
* Consumers must match on this constant — never on a copied literal, which a
* texts edit would silently strand (halving would degrade to abort without
* any test failing on the wording alone). Pinned in tests/autofold.spec.ts
* (containment in the rendered reason + cross-template uniqueness).
*/
const REASON_NO_NET_SHRINK_SIGNATURE = REASON_NO_NET_SHRINK.split(/\{\{[^}]*\}\}/).reduce((best, fragment) => fragment.length > best.length ? fragment : best, "");
const REASON_COMPACTION_ACTIVE = "a compaction transaction is active on this session (unclosed compaction/start); folding must wait until the bracket closes";
const REASON_UNREADABLE_SURFACE = "surface node seqs {{seqs}} are not readable from the log; folding refuses while any surface node is unreadable";
const REASON_SESSION_SEQ_MISSING = "the session does not expose its next seq; a fold id cannot be minted safely";
const REASON_COMMIT_REJECTED = "the session rejected the fold commit for [{{start}}, {{end}}]: {{detail}}";
const REASON_SUBRANGE_TOOL_SPLIT = "summary subrange [{{start}}, {{end}}] would split a tool-call/result pair (call {{callId}} answered at seq {{otherSeq}}); each committed subrange must keep tool calls and their results together";
const FOLD_REPLY_OK = "Folded seqs {{start}}–{{end}}, ~{{tokens}} tokens reclaimed ({{count}} checkpoint{{plural}}, {{absorbed}} earlier fold{{absorbedPlural}} absorbed)";
const FOLD_REPLY_PARTIAL = "fold committed partially: {{committed}} of {{total}} checkpoints landed before rejection";
const FOLD_REPLY_REJECTED = "fold rejected ({{count}} reason{{plural}}):";
const FOLD_REPLY_REASON_ROW = "  - {{reason}}";
const FOLD_REPLY_ANOMALY_PREFIX = "fold committed with anomalies:";
const UNFOLD_REPLY_OK = "Unfolded fold {{foldId}}: checkpoint seq {{seq}} replaced by one node re-materializing {{blocks}} block{{plural}} (seqs {{start}}–{{end}})";
const UNFOLD_REPLY_REJECTED = "unfold rejected ({{count}} reason{{plural}}):";
const REASON_FOLD_NOT_FOUND = "no active fold with id {{foldId}}";
const REASON_FOLD_NOT_ACTIVE = "fold {{foldId}} is not active (status: {{status}}); only active folds can be unfolded";
const REASON_CHECKPOINT_GONE = "fold {{foldId}} checkpoint (seq {{seq}}) is no longer on the surface";
const REASON_NO_ACTIVE_FOLDS = "no active folds to unfold";
const REASON_UNFOLD_REJECTED = "the session rejected the unfold commit for fold {{foldId}}: {{detail}}";
const STATUS_WINDOW_LINE = "window: ~{{tokens}} tokens ({{pct}}% of {{window}}); trigger line {{trigger}} ({{triggerPct}}%)";
const STATUS_WINDOW_UNKNOWN = "window: context window unknown (llm model info unavailable); budget table and pressure percent need it";
const STATUS_CCM_BELOW_DOMAIN = "context window {{window}} is below the CCM legal domain (W ≥ 32768): the automatic folding face is disabled; tools remain usable";
const STATUS_METER_UNAVAILABLE = "token meter unavailable: window estimate is a rough chars/3 figure, not a measurement";
const STATUS_ADAPTER_HEADER = "Adapter face (S2 zctx router):";
const STATUS_ADAPTER_LINE = "  state: {{state}} / routes: {{routes}} / mapping: {{mapping}} / registration {{settled}}";
const STATUS_BUDGET_HEADER = "Budget (CCM v2.3):";
const STATUS_BUDGET_ROW = "  - {{label}}: {{tokens}} tokens";
const STATUS_FIXED_WIRE_ROW = "  - fixed wire overhead (4 zctx tool schemas + guidance): {{tokens}} tokens";
const STATUS_RANGES_HEADER = "Foldable ranges (seq spans, estimated tokens):";
const STATUS_FOLDS_HEADER = "Folds ({{count}} active):";
const STATUS_FOLD_ROW = "  - {{foldId}}: seqs {{start}}–{{end}} → checkpoint {{seq}} (~{{before}} → ~{{after}} tokens)";
const STATUS_FOLDS_EMPTY = "  (no active folds)";
const STATUS_ANOMALIES_HEADER = "Anomalies ({{count}}):";
const STATUS_ANOMALY_ROW = "  - [{{kind}}] {{detail}}";
const STATUS_ANOMALIES_EMPTY = "  (no anomalies recorded)";
const STATUS_USAGE_MEASURED = "cache usage: measured from {{samples}} provider usage sample{{plural}} (latest: cache read {{read}} / cache write {{write}} tokens)";
const STATUS_USAGE_ESTIMATED = "cache usage: ESTIMATED — no provider usage data available ({{samples}} sample{{plural}} without usage); token figures are chars/3 estimates";
const STATUS_USAGE_NONE = "cache usage: no assistant requests observed yet";
const TOOL_EXECUTION_FAILED = "zctx tool execution failed: {{detail}} — the ledger state is unchanged (fail-soft); inspect via zctx_status";
const STATUS_NO_SESSION = "zctx: no live session is reachable from this call site";
const STATUS_PARTIAL_PREFIX = "status rendered in degraded mode:";
const STATUS_DEGRADED_ROW = "  - {{detail}}";
const STATUS_PATCH_HEADER = "Patch bridge (official-adapter wire stub):";
const STATUS_PATCH_MARKER = "  patch marker: {{state}}{{detail}}";
const STATUS_PATCH_SET = "  patch set: {{set}} ({{files}} of 5 target bundles recorded)";
const STATUS_PATCH_MOUNT = "  wireOptions: {{mount}}";
const STATUS_GUARD_OBSERVE = "  guard-observe records (log-only chain): total {{total}}, segmented {{segmented}}, degraded {{degraded}}, unclassified {{unclassified}}; providers: {{providers}}";
const STATUS_OBS_HEADER = "Observability (fold→usage attribution, three-state accounting):";
const STATUS_OBS_SNAPSHOT_FAILED = "  (observability snapshot failed: {{detail}} — fold account rendering withheld, other segments unaffected)";
const STATUS_OBS_SESSION_LINE = "session: {{folds}} folds committed / repaid {{repaid}} / recovery {{recoveryPct}}% (net removed ÷ folded of committed folds)";
const STATUS_OBS_SESSION_REPAID_WITHHELD = "withheld";
const STATUS_OBS_THREE_STATE = "three-state: measured {{measuredPct}}% / semi {{semiPct}}% / estimated {{estimatedPct}}% of {{total}} request{{plural}}";
const STATUS_OBS_NO_SAMPLES = "three-state: no assistant requests observed yet";
const STATUS_OBS_BREAKEVEN_HEADER = "Repay table (VERIFY-C #15 price-weighted model over fold-account samples):";
const STATUS_OBS_BREAKEVEN_ROW = "  - {{foldId}}: breakeven ≈ {{turns}} turns [{{quality}}]{{repaidMark}}";
const STATUS_OBS_REPAID_MARK = " — REPAY EVENT at assistant/message seq {{seq}}";
const STATUS_OBS_BREAKEVEN_EMPTY = "  (no fold-account sample yet: no strong/retry-attributed request after a fold)";
const STATUS_OBS_CONFIDENCE_INSUFFICIENT = "attribution confidence insufficient (归因可信度不足): clean-sample {{ratioPct}}% < floor {{floorPct}}% — repay conclusions withheld (honest degradation, §Q7.3)";
const STATUS_OBS_RECENT_HEADER = "Recent folds (attribution quality):";
const STATUS_OBS_RECENT_ROW = "  - {{foldId}} [{{status}}] checkpoint seq {{seq}}: quality {{quality}}{{retryPart}}{{flags}}";
const STATUS_OBS_RETRY_PART = ", retries {{count}}";
const STATUS_OBS_FLAG_TIME_WINDOW = ", time-window fallback";
const STATUS_OBS_FLAG_INTERRUPTED = ", interrupted prefix";
const STATUS_OBS_RECENT_EMPTY = "  (no folds committed yet)";
const STATUS_OBS_RESET_HEADER = "Reset ledger digest (kind × count):";
const STATUS_OBS_RESET_ROW = "  - {{kind}}: {{count}}";
const STATUS_OBS_RESET_EMPTY = "  (no cache resets recorded)";
const STATUS_PREFLIGHT_HEADER = "Preflight estimator (S1, mode {{mode}}):";
const STATUS_PREFLIGHT_STATS = "calibration: {{samples}} comparable request{{plural}}, mean error {{meanPct}}% / worst {{worstPct}}% (estimate − billed input)";
const STATUS_PREFLIGHT_SHORTCIRCUITS = "  - {{count}} enforce short-circuit{{plural}} (no wire request, no usage to compare)";
const STATUS_PREFLIGHT_BASIS = "  - estimate basis: {{basis}}";
const STATUS_PREFLIGHT_EMPTY = "  (no judged requests yet — calibration dataset builds in observe/enforce mode)";
const STATUS_PREFLIGHT_NOT_COMPARABLE = "  - no comparable samples yet (streams settled without a usable usage chunk)";
const RECALL_REPLY_HEADER = "Recall hits for \"{{query}}\" ({{count}} of {{total}}):";
const RECALL_REPLY_ROW = "  - [{{kind}}] fold {{foldId}} (seqs {{start}}–{{end}}, score {{score}}): {{excerpt}}";
const RECALL_REPLY_EMPTY = "No recall hits for \"{{query}}\".";
const FOLD_PARSE_EMPTY = "parsed 0 valid fold ranges from content; expected blocks like \"fold <startSeq>..<endSeq>\" followed by a summary line, or a JSON array of {startRef, endRef, summary}";
/**
* The directive appended AFTER the folded span's materialized text in the
* autoFold summary call (official compaction precedent shape: instruction as
* the final user message, summarizer.ts:32-67 mechanism — original wording).
* Delivered as ONE user message whose head is this instruction and whose body
* is the span text.
*/
const AUTOFOLD_SUMMARY_INSTRUCTION = `You are acting as the context-folding engine for this coding assistant. The text below is an older span of the current conversation, materialized verbatim. Condense it into one checkpoint that lets work continue with no loss of essential context.

Write terse engineering prose in the same language as the span. Preserve exactly: the user's goals and constraints, decisions and their reasons, still-needed facts (paths, commands, identifiers, errors, versions, function signatures), and any unfinished objective (an unfinished objective stays phrased as an instruction, not a historical note). Drop superseded drafts, retries, and raw tool output whose conclusions already appear in your summary. Do not mention this summarization request or that anything was folded. Output ONLY the checkpoint text: do not call any tool and do not add preambles.`;
/** Deterministic CPU digest header (bc EMERGENCY digest form A, mechanism only). */
const AUTOFOLD_DIGEST_HEADER = "[Automatically folded span — deterministic structural digest (no model summary was available). Original content is recoverable via zctx_unfold.]";
/** One digest row per materialized block (head fragment bounded by the constant). */
const AUTOFOLD_DIGEST_ROW = "  - seq {{seq}} {{role}} (~{{chars}} chars): {{head}}";
const AUTOFOLD_DIGEST_TAIL = "  - (further blocks omitted by the deterministic size bound; recover via zctx_unfold)";
const STATUS_AUTOFOLD_HEADER = "AutoFold face (server-initiated folding, {{summarizer}} supply):";
const STATUS_AUTOFOLD_LINE = "  runs: {{runs}} / fold commits: {{count}} / net saved: ~{{net}} tokens / rounds total: {{rounds}}";
const STATUS_AUTOFOLD_LAST = "  last run: {{outcome}} (estimate {{estimate}}{{window}}, folds {{folds}}, calls {{calls}}, transient retries {{transient}}, halvings {{halvings}}, digest fallbacks {{digest}})";
const STATUS_AUTOFOLD_STICKY = "  - dead-probe sticky: summary supply judged dead for this session ({{limit}} consecutive normal-finish empty answers); digest-only until a canary probe succeeds";
const STATUS_AUTOFOLD_EMPTY = "  (no autoFold runs yet — face armed but the trigger line has not been crossed)";
/**
* Estimate the token cost of a text with the CCM L0 chars/3 estimator. It is
* a conservative ceiling only within the estimator's calibrated ASCII-dense
* domain; it is NOT a universal wire bound — scripts denser than ASCII (e.g.
* CJK) cost more tokens per character than the 3-chars-per-token ratio
* assumes, so their true wire cost can exceed this estimate.
*/
function estimateTokens(text) {
	return Math.ceil(text.length / 3);
}
/**
* Estimate the fixed wire overhead of the given text sections (S1): the
* summed token estimate of every section.
*/
function estimateFixedWireOverhead(sections) {
	let total = 0;
	for (const section of sections) total += estimateTokens(section);
	return total;
}
/**
* Fixed wire overhead of the plugin itself: the static guidance section plus
* the four tool schema estimates (S1 accounting item).
*/
const FIXED_WIRE_OVERHEAD_TOKENS = estimateFixedWireOverhead([GUIDANCE_SECTION_TEXT]) + 2048;
/**
* Assert a finite non-negative integer token/window amount.
* @internal
*/
function assertAmount(value, name) {
	if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) throw new TypeError(`${name} must be a finite non-negative integer, got ${String(value)}`);
}
/**
* Compute the full budget report for one context window.
*
* @param input - `contextWindow` W (integer ≥ 1, and large enough to sustain
*   the CCM reserve structure: windows below the degeneracy line — W = 0 or
*   triggerLine < 0 — throw TypeError) and optional output cap C (finite
*   integer ≥ 0; defaults to the CCM default tier 32768).
*/
function computeBudget(input) {
	const { contextWindow: w } = input;
	assertAmount(w, "contextWindow");
	const c = input.maxOutput ?? 32768;
	assertAmount(c, "maxOutput");
	const maxTokens = Math.min(c, Math.floor(w * .1));
	const reserve = Math.ceil(maxTokens * 1.25) + 4096;
	const toolCap = Math.max(1024, Math.floor(.25 * (reserve - maxTokens)));
	const pessimisticReserve = maxTokens + 2 * toolCap + 4096;
	const triggerLine = w - pessimisticReserve;
	const keepRecent = Math.min(Math.max(Math.floor(w * .12), Math.min(2e4, Math.floor(w * .3))), Math.floor(.8 * triggerLine));
	const summaryInputCap = triggerLine - keepRecent;
	const summaryOutputCap = Math.min(c, maxTokens, Math.floor(.8 * reserve), Math.max(8192, Math.floor(w * .01)));
	const replyCap = Math.max(2048, Math.floor(.25 * (reserve - maxTokens)));
	const rMin = 1 - (maxTokens + 2 * toolCap) / w;
	if (triggerLine < 0 || keepRecent < 0 || !Number.isFinite(rMin)) throw new TypeError(`contextWindow ${w} cannot sustain the CCM reserve structure (triggerLine ${triggerLine}, keepRecent ${keepRecent}, rMin ${rMin})`);
	return {
		contextWindow: w,
		maxOutputCap: c,
		maxTokens,
		reserve,
		toolCap,
		pessimisticReserve,
		triggerLine,
		keepRecent,
		summaryInputCap,
		summaryOutputCap,
		replyCap,
		fixedWireOverhead: FIXED_WIRE_OVERHEAD_TOKENS,
		rMin
	};
}
/** Default breakeven price factors (VERIFY-C #15: w=1.0, r=0.1, q=4.0). */
const DEFAULT_BREAKEVEN_PRICE = Object.freeze({
	w: 1,
	r: .1,
	q: 4
});
/** Validate one measured/estimated token amount. @internal */
function assertBreakevenAmount(amount, name) {
	if (amount === null || typeof amount !== "object") throw new TypeError(`breakeven.${name} must be a {tokens, measured} object`);
	assertAmount(amount.tokens, `breakeven.${name}.tokens`);
	if (typeof amount.measured !== "boolean") throw new TypeError(`breakeven.${name}.measured must be a boolean`);
}
/**
* Cache-economics breakeven report for one fold (VERIFY-C #15, formula
* verified verbatim against billion-context kernel/src/cache-report.ts:266-276):
*
*   oneTimeCost    = (w − r)·T + q·σ − r·S
*   perTurnSaving  = (S − σ)·r
*   breakevenTurns = max(0, oneTimeCost) / perTurnSaving
*   netTokens      = S − σ
*
* When perTurnSaving ≤ 0 (a fold that saves nothing per turn) the report
* gives breakevenTurns = 0 if oneTimeCost ≤ 0 (profitable immediately) and
* Infinity otherwise (never pays off) — division by zero resolved explicitly.
*
* Inputs carry the S6 measured/estimated markers; the report echoes which
* inputs were estimated so zctx_status can label degraded (estimated) output.
*/
function computeBreakevenReport(input) {
	assertBreakevenAmount(input.folded, "folded");
	assertBreakevenAmount(input.summary, "summary");
	assertBreakevenAmount(input.repay, "repay");
	const price = {
		...DEFAULT_BREAKEVEN_PRICE,
		...input.price
	};
	for (const key of [
		"w",
		"r",
		"q"
	]) {
		const value = price[key];
		if (!Number.isFinite(value) || value < 0) throw new TypeError(`breakeven.price.${key} must be a finite non-negative number`);
	}
	const s = input.folded.tokens;
	const sigma = input.summary.tokens;
	const t = input.repay.tokens;
	const { w, r, q } = price;
	const oneTimeCost = (w - r) * t + q * sigma - r * s;
	const perTurnSaving = (s - sigma) * r;
	const netTokens = s - sigma;
	const breakevenTurns = perTurnSaving > 0 ? Math.max(0, oneTimeCost) / perTurnSaving : oneTimeCost <= 0 ? 0 : Number.POSITIVE_INFINITY;
	const estimatedInputs = [];
	if (!input.folded.measured) estimatedInputs.push("folded");
	if (!input.summary.measured) estimatedInputs.push("summary");
	if (!input.repay.measured) estimatedInputs.push("repay");
	return {
		oneTimeCost,
		perTurnSaving,
		breakevenTurns,
		netTokens,
		measured: estimatedInputs.length === 0,
		estimatedInputs
	};
}
// src/attribution.ts
/**
* attribution.ts — the fold→usage attribution engine and the observability
* aggregation (v0.2.0 V3, task card V3-attribution-status products 1-3;
* RES-observe-route §Q4 + §Q7 + (b) closed-loop assembly).
*
* PURE CORE, zero host dependencies: every function here consumes plain
* structural event records (SessionEventLike) and ledger views, so the store
* can drive it from its single `applyEvent` transition and the tests can
* drive it from bare arrays. Nothing in this module imports the host, cordis,
* or the store.
*
* ATTRIBUTION RULE (§Q4.2, primary key = seq order + turn/step structure;
* time is only the broken-chain fallback):
*   1. The fold commit event F = the user/message carrying a `surfaceOp`
*      replace with `source.kind === 'zctx-fold'` (fold-engine.ts:302-320).
*   2. The attribution target = the FIRST assistant/message M of the same
*      session with seq_M > seq_F — the request content is billed in M's
*      usage (the first real request after the fold).
*   3. Quality grades (§Q4.2 rule 3), judged over the window of retained
*      events strictly between F and M:
*        - strong: no assistant/attempt, no compaction/* event, no other
*          surfaceOp replace, no request/header reason:'change';
*        - retry: at least one llm/retry in the window (a retry does not
*          change the request content — the fold semantics stand) → quality
*          'retry' and the count becomes the retryCount pollution degree;
*        - weak: compaction competition / another replace producer / route
*          change / an assistant/attempt WITHOUT its llm/retry voucher —
*          the sample stays in the total ledger (总账) but never enters the
*          fold account (折叠账). An attempt without a retry event is an
*          UNEXPLAINED disturbance of the request chain (aborted attempt,
*          agent-loop agent.ts:491-511 settles attempts without always
*          retrying), so the mechanical consequence of "strong requires no
*          attempt" + "retry requires llm/retry" is the weak grade.
*   4. Time-window fallback (§Q4.2 rule 4, config attributionTimeWindowMs):
*      when the retained event chain is BROKEN (the store could not read
*      every seq between F and M — a resync gap), window purity is
*      unverifiable; the association degrades to
*      `T_M − T_F ≤ attributionTimeWindowMs 且同 turn` and the ledger entry
*      carries `timeWindow: true`. Honesty cap: a broken chain can never
*      claim strong/retry, so a passing fallback grades 'weak' (总账 only).
*      Same-turn evidence: no turn/start AND no turn/end event inside the
*      window, plus the fold's open turn (when known) equaling M's
*      `data.turn`. F is a bare UserMessage (no turn of its own — the fold
*      engine commits the official bare-message shape, session/src/types.ts:309).
*
* 8-ITEM NOISE DISPOSITIONS (§Q4.3 table, each mechanically resolved):
*   1. retry ring: only assistant/message events are attributed; failed
*      attempts carry no usage (Q2.2) and their llm/retry count becomes the
*      pollution degree (quality 'retry'). — classify: retryCount scan.
*   2. parallel tools inside one step: one step emits exactly one
*      assistant/message; tool/result events in the window are NOT noise. —
*      classify: tool events never affect the grade.
*   3. many steps per turn: only the FIRST step after the fold is the
*      attribution target; later steps are 维持账 (maintenance ledger), not
*      回本账 (repay ledger). — store wiring: candidates stop at the previous
*      assistant/message; later messages attribute to nothing.
*   4. fold tool runs in step k → the next request is step k+1: tool
*      execution follows the assistant message, so the first post-fold
*      assistant/message aligns naturally. — classify: no special case; the
*      engine records M's own turn/step.
*   5. official compaction racing in the same window: any compaction/*
*      event between F and M → weak (归因键失效). — classify: compaction scan.
*   6. runtime-context per-step re-projection of the user message: it
*      refreshes the REQUEST assembly (agent.ts:411-415), not the session
*      log — it affects prefix hits (Q5/Q6), never "who consumed this
*      usage". — classify: no effect; ordinary appended user/messages in the
*      window are not noise (only replaces are).
*   7. interrupted prefix: an aborted assistant/message carries
*      `interrupted: true` and may still carry usage (agent.ts:469-483) —
*      it is attributed and flagged `interrupted` (the response was cut, but
*      the input side is still real). — classify: interrupted flag pass-through.
*   8. subagent sessions: subagents run their own loop + session; ledgers
*      are per-store (per-session) by construction and the store ignores
*      foreign-session events, so a parent's fold account never crosses into
*      a child's. — store wiring (pinned by tests).
*
* BREAKEVEN AGGREGATION (§Q7.3 + (b)): the frozen computeBreakevenReport
* (budget.ts:196, VERIFY-C #15 price-weighted formulas) is the repay engine;
* its inputs upgrade to the three-state ledger —
*   - folded S / summary σ: the fold record's structural estimates
*     (chars/3 over the folded span / summary text) → measured:false always
*     (no measured source exists for these two);
*   - repay T: the FIRST attributed request's billed input
*     (billedInput = inputTokens + cacheReadTokens + cacheWriteTokens,
*     §Q7.2 rule 1口径) when that record is measured or semi-anchored;
*     otherwise the estimated-path convention T = σ (the checkpoint's own
*     re-write is the minimal honest re-pay; 待标定) with measured:false.
* The repay EVENT per §Q7.3 = the first assistant/message after the fold
* commit where the cumulative realized saving crosses the one-time cost —
* realized in the price-weighted domain: the Nth assistant/message after the
* fold with N ≥ max(1, ⌈breakevenTurns⌉) (Infinity ⇒ never). Rows carry
* `repaid`/`repayEventSeq` so zctx_status can count 回本 M 个.
*
* The clean-sample ratio = strong / (strong + retry + weak) over the fold
* attribution ledger; the RENDERER (tools.ts) compares it against
* config.cleanSampleFloor and withholds repay conclusions below the floor
* (诚实纪律, §Q7.3) — the aggregation reports the ratio, it does not judge.
*
* @module attribution
*/
function isRecord$4(value) {
	return value !== null && typeof value === "object";
}
function finiteNumber$1(value) {
	return typeof value === "number" && Number.isFinite(value) ? value : void 0;
}
/**
* Classify ONE fold→message association (§Q4.2 rules 2-4; the module JSDoc
* carries the 8-noise disposition table). Returns undefined when the
* association fails: the message lacks its official turn/step envelope, or
* the broken-chain fallback (time window + same turn) does not pass.
*/
function classifyFoldAttribution(input) {
	const turn = finiteNumber$1(input.messageTurn);
	const step = finiteNumber$1(input.messageStep);
	if (turn === void 0 || step === void 0) return;
	const windowEvents = input.windowEvents;
	const span = input.messageSeq - input.foldSeq;
	if (span <= 0) return void 0;
	let retryCount = 0;
	let attempt = false;
	let compaction = false;
	let otherReplace = false;
	let headerChange = false;
	let turnBoundary = false;
	for (const event of windowEvents) {
		switch (event.type) {
			case "llm/retry":
				retryCount += 1;
				break;
			case "assistant/attempt":
				attempt = true;
				break;
			case "turn/start":
			case "turn/end":
				turnBoundary = true;
				break;
			case "request/header":
				if (isRecord$4(event.data) && event.data.reason === "change") headerChange = true;
				break;
			default: if (event.type.startsWith("compaction/")) compaction = true;
		}
		const op = event.surfaceOp;
		if (op !== void 0 && op !== "append") otherReplace = true;
	}
	let chainComplete = windowEvents.length === span - 1;
	if (chainComplete) {
		for (const [index, event] of windowEvents.entries()) if (event.seq !== input.foldSeq + 1 + index) {
			chainComplete = false;
			break;
		}
	}
	if (!chainComplete) {
		const foldTime = finiteNumber$1(input.foldTime);
		const messageTime = finiteNumber$1(input.messageTime);
		const sameTurn = !turnBoundary && (input.foldTurn === void 0 || turn === void 0 || input.foldTurn === turn);
		if (!(foldTime !== void 0 && messageTime !== void 0 && messageTime >= foldTime && messageTime - foldTime <= input.timeWindowMs) || !sameTurn) return void 0;
		return {
			foldId: input.foldId,
			foldCommitSeq: input.foldSeq,
			messageSeq: input.messageSeq,
			turn,
			step,
			quality: "weak",
			retryCount,
			...input.messageInterrupted === true ? { interrupted: true } : {},
			timeWindow: true
		};
	}
	const quality = compaction || otherReplace || headerChange || attempt && retryCount === 0 ? "weak" : retryCount > 0 ? "retry" : "strong";
	return {
		foldId: input.foldId,
		foldCommitSeq: input.foldSeq,
		messageSeq: input.messageSeq,
		turn,
		step,
		quality,
		retryCount,
		...input.messageInterrupted === true ? { interrupted: true } : {}
	};
}
/** Billed input of one usage record (§Q7.2 rule 1: input + read + write). */
function billedInputTokens(record) {
	if (record.inputTokens === void 0) return void 0;
	return record.inputTokens + (record.cacheReadTokens ?? 0) + (record.cacheWriteTokens ?? 0);
}
/** First-seen-order digest of the reset ledger (kind × count). */
function digestResets(resetEvents) {
	const counts = /* @__PURE__ */ new Map();
	for (const reset of resetEvents) counts.set(reset.kind, (counts.get(reset.kind) ?? 0) + 1);
	return [...counts.entries()].map(([kind, count]) => ({
		kind,
		count
	}));
}
/**
* Clean-sample ratio (§Q7.3): strong / (strong + retry + weak) over the fold
* attribution ledger; 0 when no fold was ever attributed (no evidence = no
* confidence).
*/
function cleanSampleRatio(foldAttributions) {
	let strong = 0;
	let retry = 0;
	let weak = 0;
	for (const attribution of foldAttributions) if (attribution.quality === "strong") strong += 1;
	else if (attribution.quality === "retry") retry += 1;
	else weak += 1;
	const total = strong + retry + weak;
	return total === 0 ? 0 : strong / total;
}
/**
* The repay-event detection for one fold (§Q7.3, price-weighted domain): the
* fold has repaid when at least max(1, ⌈breakevenTurns⌉) assistant/messages
* ran after the fold commit; the repay event is exactly that message.
* breakevenTurns = Infinity (per-turn saving ≤ 0 with a positive one-time
* cost) never repays. Returns the repaid marker + the event seq, or
* `{ repaid: false }` / undefined-shaped absence via the optional fields.
*/
function detectRepay(breakevenTurns, checkpointSeq, assistantMessageSeqs) {
	if (!Number.isFinite(breakevenTurns)) return { repaid: false };
	const required = Math.max(1, Math.ceil(breakevenTurns));
	let count = 0;
	for (const seq of assistantMessageSeqs) {
		if (seq <= checkpointSeq) continue;
		count += 1;
		if (count === required) return {
			repaid: true,
			repayEventSeq: seq
		};
	}
	return { repaid: false };
}
/**
* Aggregate the observability snapshot (RES-observe-route a.1 row 6) from the
* store's ledger views. Pure: no store/host access. The fold account
* (breakevenTable) admits only folds whose attribution quality is
* strong/retry — weak associations stay in the total ledger (§Q4.2 rule 3).
*/
function buildObservabilitySnapshot(input) {
	const recordsBySeq = /* @__PURE__ */ new Map();
	for (const record of input.usageRecords) recordsBySeq.set(record.seq, record);
	const breakevenTable = [];
	for (const fold of input.foldEntries) {
		const attribution = input.foldAttributions.find((entry) => entry.foldId === fold.foldId);
		if (attribution === void 0 || attribution.quality === "weak") continue;
		const sample = recordsBySeq.get(attribution.messageSeq);
		const billed = sample === void 0 ? void 0 : billedInputTokens(sample);
		const repayMeasured = sample !== void 0 && billed !== void 0 && sample.state === "measured";
		const repayTokens = billed ?? fold.tokensAfter;
		const report = computeBreakevenReport({
			folded: {
				tokens: fold.tokensBefore,
				measured: false
			},
			summary: {
				tokens: fold.tokensAfter,
				measured: false
			},
			repay: {
				tokens: repayTokens,
				measured: repayMeasured
			}
		});
		const repay = detectRepay(report.breakevenTurns, fold.checkpointSeq, input.assistantMessageSeqs);
		breakevenTable.push({
			foldId: fold.foldId,
			breakevenTurns: report.breakevenTurns,
			quality: attribution.quality,
			repaid: repay.repaid,
			...repay.repaid ? { repayEventSeq: repay.repayEventSeq } : {}
		});
	}
	return {
		threeState: input.threeState,
		cleanSampleRatio: cleanSampleRatio(input.foldAttributions),
		breakevenTable,
		resetSummary: digestResets(input.resetEvents)
	};
}
// src/materialize.ts
/**
* Unfold re-materialization — the B1 single-node form (plan §3, options.md
* §6): the checkpoint node is replaced by ONE user message whose content is
* an ordered list of text blocks, one per original event of the folded span.
*
* `materializeRange` returns that block list. It never produces multiple
* surface nodes — the official replace semantics swap one node for another
* (surface.ts:637-646 splice), so the original N nodes do not come back; the
* wire-shape cost (assistant/tool pairs → one user message with text blocks)
* is accepted and documented there.
*
* Mechanics (task card W2 §3):
* - events are read per seq through the injected accessor (`eventAt`); the
*   official synchronous read is deprecated for new callers, so the W3
*   engine backs this accessor with its own snapshot read — the pure core
*   only consumes the injection;
* - each message event becomes one text block with a role prefix; tool
*   blocks carry the tool name and a verbatim-source annotation;
* - a seq holding an ACTIVE fold checkpoint expands one layer only: the
*   checkpoint's own message text under a `[folded block <foldId>]` marker
*   (never the checkpoint's original content — that stays recoverable via
*   its own record and keeps the output bounded);
* - log-only events (compaction/start, session/*, …) are skipped;
* - unreadable seqs render an explicit placeholder block (honest gap, no
*   silent data loss).
*
* Zero host imports; pure function of (accessor, foldMap, span).
*
* @module materialize
*/
/** Official message-producing event types (session/src/types.ts:439-444). */
const MESSAGE_EVENT_TYPES$1 = /* @__PURE__ */ new Set([
	"system/message",
	"developer/message",
	"user/message",
	"assistant/message",
	"tool/result"
]);
/**
* Role prefix per surface event type. Kept in lockstep with
* MESSAGE_EVENT_TYPES; the UNKNOWN fallback is defense-in-depth for a future
* event type added to the set without a prefix here.
*/
const ROLE_PREFIX_BY_TYPE = {
	"system/message": MATERIALIZED_ROLE_PREFIX_SYSTEM,
	"developer/message": MATERIALIZED_ROLE_PREFIX_DEVELOPER,
	"user/message": MATERIALIZED_ROLE_PREFIX_USER,
	"assistant/message": MATERIALIZED_ROLE_PREFIX_ASSISTANT,
	"tool/result": MATERIALIZED_TOOL_PREFIX
};
/**
* Materialize the ordered text blocks for the fold span [startSeq..endSeq]
* (inclusive on both ends) with one-layer expansion of active fold
* checkpoints.
*/
function materializeRange(accessor, foldMap, startSeq, endSeq) {
	if (accessor === null || typeof accessor !== "object" || typeof accessor.eventAt !== "function") throw new TypeError("materializeRange: accessor must expose eventAt(seq)");
	if (!(foldMap instanceof Map)) throw new TypeError("materializeRange: foldMap must be a Map");
	assertSeq(startSeq, "startSeq");
	assertSeq(endSeq, "endSeq");
	if (startSeq > endSeq) throw new TypeError(`materializeRange: inverted span [${startSeq}, ${endSeq}]`);
	const checkpointBySeq = /* @__PURE__ */ new Map();
	for (const record of foldMap.values()) checkpointBySeq.set(record.checkpointSeq, { foldId: record.foldId });
	const blocks = [];
	for (let seq = startSeq; seq <= endSeq; seq += 1) {
		const event = accessor.eventAt(seq);
		if (event === void 0) {
			blocks.push({
				type: "text",
				text: `${MATERIALIZED_MISSING_EVENT_PREFIX}${seq}]`
			});
			continue;
		}
		const checkpoint = event.type === "user/message" ? checkpointBySeq.get(seq) : void 0;
		if (checkpoint !== void 0) {
			const body = extractMessageText$1(event.data);
			const marker = `${MATERIALIZED_FOLDED_BLOCK_PREFIX}${checkpoint.foldId}]`;
			blocks.push({
				type: "text",
				text: body === "" ? marker : `${marker}\n${body}`
			});
			continue;
		}
		if (!MESSAGE_EVENT_TYPES$1.has(event.type)) continue;
		blocks.push(renderMessageBlock(event));
	}
	return blocks;
}
/** Assert one non-negative integer seq. @internal */
function assertSeq(value, name) {
	if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) throw new TypeError(`materializeRange: ${name} must be a non-negative integer, got ${String(value)}`);
}
/** Pull the message object out of an event's data payload. @internal */
function extractMessage$1(data) {
	if (data === null || typeof data !== "object") return void 0;
	const record = data;
	if (record.message !== null && typeof record.message === "object") return record.message;
	if (record.content !== void 0) return record;
}
/** Join the text blocks of a message payload (string content tolerated). @internal */
function extractMessageText$1(data) {
	const message = extractMessage$1(data);
	if (message === void 0) return "";
	const content = message.content;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	const parts = [];
	for (const block of content) if (block !== null && typeof block === "object") {
		const candidate = block;
		if (candidate.type === "text" && typeof candidate.text === "string") parts.push(candidate.text);
	}
	return parts.join("\n");
}
/** Best-effort tool identity for a tool/result event. @internal */
function extractToolIdentity(event) {
	const message = extractMessage$1(event.data);
	if (message === void 0) return {};
	const data = event.data;
	const dataName = data !== null && typeof data === "object" && typeof data.toolName === "string" ? data.toolName : void 0;
	const name = typeof message.toolName === "string" ? message.toolName : dataName;
	const source = message.source;
	const sourceCallId = source !== null && typeof source === "object" && typeof source.callId === "string" ? source.callId : void 0;
	return {
		name,
		callId: typeof message.toolCallId === "string" ? message.toolCallId : sourceCallId
	};
}
/** Render one message event as a role-prefixed text block. @internal */
function renderMessageBlock(event) {
	const body = extractMessageText$1(event.data);
	if (event.type === "tool/result") {
		const { name, callId } = extractToolIdentity(event);
		return {
			type: "text",
			text: [
				name !== void 0 ? `${MATERIALIZED_TOOL_PREFIX} ${name}]` : callId !== void 0 ? `${MATERIALIZED_TOOL_PREFIX} (call ${callId})]` : `${MATERIALIZED_TOOL_PREFIX}]`,
				body === "" ? MATERIALIZED_NO_TEXT_CONTENT : body,
				MATERIALIZED_TOOL_SOURCE_NOTE
			].join("\n")
		};
	}
	return {
		type: "text",
		text: `${ROLE_PREFIX_BY_TYPE[event.type] ?? "[unknown]"}\n${body === "" ? MATERIALIZED_NO_TEXT_CONTENT : body}`
	};
}
/** And-rank bonus lifting all-terms matches above partial matches. */
const AND_BONUS = 1e6;
/** Per-distinct-term weight. */
const TERM_WEIGHT = 1e3;
/**
* Recall the corpus entries matching the query keywords.
*
* @param query - whitespace-separated keywords (case-insensitive).
* @param corpus - summaries + folded original entries.
* @param limit - maximum hits returned (default 5).
*/
function recall(query, corpus, limit = 5) {
	if (typeof query !== "string") throw new TypeError("recall: query must be a string");
	if (!Array.isArray(corpus)) throw new TypeError("recall: corpus must be an array");
	if (!Number.isFinite(limit) || !Number.isInteger(limit) || limit < 0) throw new TypeError("recall: limit must be a non-negative integer");
	const terms = [...new Set(query.toLowerCase().split(/\s+/).filter((t) => t.length > 0))];
	if (terms.length === 0) return [];
	const hits = [];
	for (const entry of corpus) {
		if (entry === null || typeof entry !== "object" || typeof entry.text !== "string") throw new TypeError("recall: corpus entries must expose a text string");
		const lower = entry.text.toLowerCase();
		let distinct = 0;
		let occurrences = 0;
		let firstPos = -1;
		for (const term of terms) {
			const count = countOccurrences(lower, term);
			if (count === 0) continue;
			distinct += 1;
			occurrences += count;
			const pos = lower.indexOf(term);
			if (firstPos === -1 || pos < firstPos) firstPos = pos;
		}
		if (distinct === 0) continue;
		const score = (distinct === terms.length ? AND_BONUS : 0) + distinct * TERM_WEIGHT + occurrences;
		hits.push({
			foldId: entry.foldId,
			kind: entry.kind,
			text: entry.text,
			range: entry.range,
			score,
			excerpt: buildExcerpt(entry.text, firstPos)
		});
	}
	hits.sort((a, b) => {
		if (b.score !== a.score) return b.score - a.score;
		if (a.range.startSeq !== b.range.startSeq) return a.range.startSeq - b.range.startSeq;
		if (a.range.endSeq !== b.range.endSeq) return a.range.endSeq - b.range.endSeq;
		if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
		return a.foldId < b.foldId ? -1 : a.foldId > b.foldId ? 1 : 0;
	});
	return hits.slice(0, limit);
}
/** Occurrence count of `needle` in `haystack` (non-overlapping). @internal */
function countOccurrences(haystack, needle) {
	let count = 0;
	let pos = haystack.indexOf(needle);
	while (pos !== -1) {
		count += 1;
		pos = haystack.indexOf(needle, pos + needle.length);
	}
	return count;
}
/** ±120-char excerpt around `pos`, ellipsized where cut. @internal */
function buildExcerpt(text, pos) {
	const start = Math.max(0, pos - 120);
	const end = Math.min(text.length, pos + 120);
	const body = text.slice(start, end);
	return `${start > 0 ? "…" : ""}${body}${end < text.length ? "…" : ""}`;
}
// src/nudge.ts
/**
* Threshold-crossing nudge — the cache-aware pressure reminder (options.md
* §2 方案甲 3, plan §3 B2). The rendered text is a PURE function of its
* inputs: same inputs → same bytes, so the host context() registration only
* changes (and only costs a cache re-pay) when a threshold is actually
* crossed or the foldable-span table changes — the "跨越计次重付" model.
*
* Suppression (B2/plan §3.5): `nudgeContextText` returns '' when no threshold
* was crossed — official PromptContext contributes nothing on empty text, so
* the suppressed state is a no-op on the wire. W4 registers the context with
* `required: true` so the host cannot filter it out
* (system-prompt/src/index.ts:627-628 filters non-required contributions).
*
* Zero host imports; pure functions only.
*
* @module nudge
*/
/**
* Thresholds crossed on the way from `prev` to `cur` (strict rise: a
* threshold counts only when prev < threshold ≤ cur — sitting exactly on a
* threshold is not a crossing). Returned ascending, deduplicated; a falling
* pressure crosses nothing.
*/
function crossedThresholds(prev, cur, thresholds) {
	assertPct(prev, "prev");
	assertPct(cur, "cur");
	if (!Array.isArray(thresholds)) throw new TypeError("thresholds must be an array");
	const seen = /* @__PURE__ */ new Set();
	const crossed = [];
	for (const t of thresholds) {
		assertPct(t, "threshold");
		const key = t;
		if (seen.has(key)) continue;
		seen.add(key);
		if (prev < t && cur >= t) crossed.push(t);
	}
	return crossed.sort((a, b) => a - b);
}
/**
* Registration-ready context text: '' (suppressed) when nothing was crossed,
* otherwise the full nudge rendering. Voice escalates to 'emergency' when
* any crossed threshold is ≥ 90 or the current pressure itself is ≥ 90.
*/
function nudgeContextText(prev, cur, thresholds, budget, ranges) {
	const crossed = crossedThresholds(prev, cur, thresholds);
	if (crossed.length === 0) return "";
	return renderNudge(cur, budget, ranges, crossed.some((t) => t >= 90) || cur >= 90 ? "emergency" : "gentle");
}
/**
* Render the nudge text for one pressure reading. Deterministic: identical
* inputs produce byte-identical output (asserted by nudge.spec.ts).
*
* @param pressurePct - current window occupancy in percent (0..100+).
* @param budget - the budget report driving the breakdown percentages.
* @param ranges - foldable-span rows (PROTECTED rows render with their reason).
* @param voice - gentle | emergency band.
*/
function renderNudge(pressurePct, budget, ranges, voice) {
	assertPct(pressurePct, "pressurePct");
	if (budget === null || typeof budget !== "object") throw new TypeError("renderNudge: budget must be an object");
	if (!Array.isArray(ranges)) throw new TypeError("renderNudge: ranges must be an array");
	const pct = formatPct$1(pressurePct);
	const lines = [];
	lines.push(fill(voice === "emergency" ? NUDGE_EMERGENCY_HEADER : NUDGE_GENTLE_HEADER, { pct }));
	lines.push(fill(NUDGE_TRIGGER_LINE, {
		pct,
		triggerPct: formatPct$1(budget.triggerLine / budget.contextWindow * 100)
	}));
	lines.push(NUDGE_BREAKDOWN_HEADER);
	lines.push(fill(NUDGE_BREAKDOWN_KEEP_RECENT, { pct: formatPct$1(budget.keepRecent / budget.contextWindow * 100) }));
	lines.push(fill(NUDGE_BREAKDOWN_RESERVE, { pct: formatPct$1(budget.pessimisticReserve / budget.contextWindow * 100) }));
	lines.push(fill(NUDGE_BREAKDOWN_FIXED, { pct: formatPct$1(budget.fixedWireOverhead / budget.contextWindow * 100) }));
	lines.push(NUDGE_RANGES_HEADER);
	if (ranges.length === 0) lines.push(NUDGE_RANGES_EMPTY);
	else for (const range of ranges) {
		let row = fill(NUDGE_RANGE_ROW, {
			start: range.startSeq,
			end: range.endSeq,
			tokens: range.estimatedTokens
		});
		if (range.protected) {
			row += NUDGE_PROTECTED_MARKER;
			if (range.protectedReason !== void 0) row += ` (${range.protectedReason})`;
		}
		lines.push(row);
	}
	lines.push(NUDGE_BATCH_REMINDER);
	lines.push(voice === "emergency" ? NUDGE_EMERGENCY_CLOSING : NUDGE_GENTLE_CLOSING);
	return lines.join("\n");
}
/** Assert one finite percentage-like number. @internal */
function assertPct(value, name) {
	if (!Number.isFinite(value)) throw new TypeError(`${name} must be a finite number, got ${String(value)}`);
}
/** One-decimal percentage formatting (deterministic for finite inputs). @internal */
function formatPct$1(value) {
	return (Math.round(value * 10) / 10).toFixed(1);
}
/**
* Build the frozen guidance section spec (same bytes on every call — S10).
*/
function buildGuidanceSection() {
	return Object.freeze({
		name: GUIDANCE_SECTION_ID,
		order: 900,
		text: GUIDANCE_SECTION_TEXT,
		interpolate: false
	});
}
/**
* Title exported for W4's `/zctx` command help and settings copy — not part
* of the section registration itself.
*/
// src/validator.ts
/**
* Fold validator — the conservative server-side gate for every zctx_fold
* submission (options.md §2 方案甲 5; task card W2 §2 checks a–g).
*
* One call validates ONE fold window (the official surface replace span,
* session/src/types.ts:449-464: "Both must exist as surface nodes in the
* current surface") plus the summary blocks submitted for it. The tool layer
* (W4) loops this function over the batch's windows and rejects the whole
* batch when any window fails — atomicity at batch level lives there; this
* module is atomic per window: ALL reasons are collected, nothing is
* accepted partially, and the acceptance plan is produced only when every
* check passed.
*
* Checks implemented:
*   a. window exists, is contiguous on the surface, endpoints are surface
*      nodes; node 0 (system head) may never enter the window (S5 precheck —
*      the official assertSystemHeadRewrite throws, surface.ts:493-505).
*      REACHABLE-DOMAIN note (W3-2): the consecutive+monotonic guard is
*      load-bearing beyond unsorted-scan defense — after any fold the surface
*      is numerically non-monotonic (the checkpoint seq sits ahead of later
*      nodes), so a window spanning a checkpoint PLUS later nodes is always
*      rejected here; the reachable absorption domain is the boundary-aligned
*      single-checkpoint window [checkpoint, checkpoint] (pinned by
*      fold-engine.spec.ts "numeric shadowed filtering ≡ official positional
*      slicing");
*   b. protected zones: recent tail (last keepRecentMessages messages and
*      the last max(keepRecentTokens, protectionFloorTokens) estimated
*      tokens), the last user message, and the permanently pinned first
*      user message (official kernel recommend.ts Rules 1–3 + DESIGN §8.1);
*   c. tool-pair closure: an assistant tool call and its tool result must be
*      folded together or left together (official kernel #2886 closure);
*      unknown pairing fails closed;
*   d. nested absorption: a window containing an active fold's checkpoint is
*      allowed when a submitted summary covers the checkpoint or the window
*      boundary aligns with it. Reachable domain (W3-2): only when check a's
*      consecutive+monotonic guard passes — in practice the boundary-aligned
*      [checkpoint, checkpoint] window; a coverage-style window over a
*      checkpoint plus later nodes is rejected as not contiguous first;
*   e. net-shrink gate: Σ(folded node estimates) × tolerance > Σ(summary
*      estimates), tolerance default 1.05; summary length window enforced;
*   f. window qualification: estimated window tokens ≥ minFoldableTokens and
*      ≤ maxFoldFraction × contextWindow (when the window size is supplied);
*   g. atomic rejection: any failure → { ok:false, reasons } with every
*      reason collected.
*
* Session-log互斥 checks (active compaction, surface generation stability)
* need the live session and belong to the W3 engine, not to this pure core.
*
* Zero host imports; pure function.
*
* @module validator
*/
/** Render a number without float dust (0.6×100 → "60"). @internal */
function fmtNum(value) {
	return String(Math.round(value * 1e3) / 1e3);
}
/** Structural sanity of one surface node. @internal */
function assertSurfaceNode(node, index) {
	const at = `surfaceNodes[${index}]`;
	if (node === null || typeof node !== "object") throw new TypeError(`${at} must be an object`);
	if (!Number.isFinite(node.seq) || !Number.isInteger(node.seq) || node.seq < 0) throw new TypeError(`${at}.seq must be a non-negative integer`);
	if (!Number.isFinite(node.estimatedTokens) || node.estimatedTokens < 0) throw new TypeError(`${at}.estimatedTokens must be a finite non-negative number`);
}
/**
* Validate one fold window with its summaries (see module header for the
* check list). Throws TypeError on structurally malformed input; returns
* `{ ok:false, reasons }` (all reasons collected) on any semantic failure.
*/
function validateFold(input) {
	if (input === null || typeof input !== "object") throw new TypeError("validateFold: input must be an object");
	if (!Array.isArray(input.surfaceNodes)) throw new TypeError("validateFold: surfaceNodes must be an array");
	if (!(input.foldMap instanceof Map)) throw new TypeError("validateFold: foldMap must be a Map");
	if (!Array.isArray(input.summaries)) throw new TypeError("validateFold: summaries must be an array");
	if (input.config === null || typeof input.config !== "object") throw new TypeError("validateFold: config must be an object");
	const surfaceNodes = input.surfaceNodes;
	surfaceNodes.forEach(assertSurfaceNode);
	const { startSeq, endSeq } = input.range;
	if (!Number.isFinite(startSeq) || !Number.isFinite(endSeq)) throw new TypeError("validateFold: range endpoints must be finite numbers");
	const config = input.config;
	const reasons = [];
	const effectiveConfig = config.contextWindow !== void 0 && !Number.isFinite(config.contextWindow) ? {
		...config,
		contextWindow: void 0
	} : config;
	if (startSeq > endSeq) reasons.push(fill(REASON_RANGE_INVERTED, {
		start: startSeq,
		end: endSeq
	}));
	const startIndex = surfaceNodes.findIndex((n) => n.seq === startSeq);
	const endIndex = surfaceNodes.findIndex((n) => n.seq === endSeq);
	if (startIndex < 0 || endIndex < 0) reasons.push(fill(REASON_RANGE_NOT_ON_SURFACE, {
		start: startSeq,
		end: endSeq
	}));
	const inRange = surfaceNodes.filter((n) => n.seq >= startSeq && n.seq <= endSeq);
	if (inRange.length === 0) reasons.push(fill(REASON_RANGE_EMPTY, {
		start: startSeq,
		end: endSeq
	}));
	else if (startIndex >= 0 && endIndex >= 0) {
		const firstIdx = surfaceNodes.indexOf(inRange[0]);
		const consecutive = surfaceNodes.indexOf(inRange[inRange.length - 1]) - firstIdx + 1 === inRange.length;
		const monotonic = inRange.every((n, i) => i === 0 || n.seq > inRange[i - 1].seq);
		if (!consecutive || !monotonic) reasons.push(fill(REASON_RANGE_DISCONTIGUOUS, {
			start: startSeq,
			end: endSeq
		}));
	}
	if (surfaceNodes.length > 0 && surfaceNodes[0].seq >= startSeq && surfaceNodes[0].seq <= endSeq) reasons.push(fill(REASON_NODE0, {
		start: startSeq,
		end: endSeq
	}));
	const effectiveKeepTokens = Math.max(config.keepRecentTokens, config.protectionFloorTokens);
	if ((config.keepRecentMessages > 0 || effectiveKeepTokens > 0) && surfaceNodes.length > 0) {
		let protectedFromIdx = surfaceNodes.length;
		if (config.keepRecentMessages > 0) protectedFromIdx = Math.max(0, surfaceNodes.length - config.keepRecentMessages);
		if (effectiveKeepTokens > 0) {
			let acc = 0;
			let idx = surfaceNodes.length - 1;
			while (idx >= 0) {
				acc += surfaceNodes[idx].estimatedTokens;
				if (acc >= effectiveKeepTokens) break;
				idx -= 1;
			}
			if (idx < 0) idx = 0;
			protectedFromIdx = Math.min(protectedFromIdx, idx);
		}
		if (protectedFromIdx < surfaceNodes.length) {
			const protectedStart = surfaceNodes[protectedFromIdx];
			if (protectedStart.seq <= endSeq) reasons.push(fill(REASON_PROTECTED_TAIL, {
				start: startSeq,
				end: endSeq,
				seq: protectedStart.seq,
				messages: config.keepRecentMessages,
				tokens: effectiveKeepTokens
			}));
		}
	}
	const lastUserIdx = findLastIndex(surfaceNodes, (n) => n.role === "user");
	if (lastUserIdx >= 0) {
		const node = surfaceNodes[lastUserIdx];
		if (node.seq >= startSeq && node.seq <= endSeq) reasons.push(fill(REASON_LAST_USER, {
			start: startSeq,
			end: endSeq,
			seq: node.seq
		}));
	}
	const firstUserIdx = surfaceNodes.findIndex((n) => n.role === "user");
	if (firstUserIdx >= 0) {
		const node = surfaceNodes[firstUserIdx];
		if (node.seq >= startSeq && node.seq <= endSeq) reasons.push(fill(REASON_FIRST_USER, {
			start: startSeq,
			end: endSeq,
			seq: node.seq
		}));
	}
	const toolByCallId = /* @__PURE__ */ new Map();
	const assistantByCallId = /* @__PURE__ */ new Map();
	for (const node of surfaceNodes) {
		if (node.role === "tool" && node.answersCallId !== void 0) toolByCallId.set(node.answersCallId, node);
		if (node.role === "assistant" && node.toolCallIds !== void 0) for (const callId of node.toolCallIds) assistantByCallId.set(callId, node);
	}
	for (const node of inRange) {
		if (node.role === "tool") {
			if (node.answersCallId === void 0) {
				reasons.push(fill(REASON_TOOL_UNKNOWN_PAIRING, {
					seq: node.seq,
					role: "tool"
				}));
				continue;
			}
			const assistant = assistantByCallId.get(node.answersCallId);
			if (assistant === void 0) reasons.push(fill(REASON_TOOL_ORPHAN_RESULT, {
				seq: node.seq,
				callId: node.answersCallId
			}));
			else if (assistant.seq < startSeq || assistant.seq > endSeq) reasons.push(fill(REASON_TOOL_SPLIT_RESULT, {
				seq: node.seq,
				callId: node.answersCallId,
				assistantSeq: assistant.seq
			}));
		}
		if (node.role === "assistant") {
			if (node.toolCallIds === void 0) {
				reasons.push(fill(REASON_TOOL_UNKNOWN_PAIRING, {
					seq: node.seq,
					role: "assistant"
				}));
				continue;
			}
			for (const callId of node.toolCallIds) {
				const tool = toolByCallId.get(callId);
				if (tool !== void 0 && (tool.seq < startSeq || tool.seq > endSeq)) reasons.push(fill(REASON_TOOL_UNANSWERED_CALL, {
					seq: node.seq,
					callId,
					toolSeq: tool.seq
				}));
			}
		}
	}
	const absorbed = [];
	for (const [foldId, record] of input.foldMap) {
		const { checkpointSeq } = record;
		if (checkpointSeq < startSeq || checkpointSeq > endSeq) continue;
		const covered = input.summaries.some((s) => s.startSeq <= checkpointSeq && checkpointSeq <= s.endSeq);
		const aligned = checkpointSeq === startSeq || checkpointSeq === endSeq;
		if (!covered && !aligned) reasons.push(fill(REASON_ABSORBED_UNCOVERED, {
			start: startSeq,
			end: endSeq,
			foldId,
			checkpoint: checkpointSeq
		}));
		absorbed.push({
			foldId,
			checkpointSeq,
			covered,
			aligned
		});
	}
	if (input.summaries.length === 0) reasons.push(REASON_SUMMARY_EMPTY);
	for (const summary of input.summaries) {
		if (summary.startSeq < startSeq || summary.endSeq > endSeq || summary.startSeq > summary.endSeq) reasons.push(fill(REASON_SUMMARY_OUT_OF_WINDOW, {
			start: summary.startSeq,
			end: summary.endSeq,
			wStart: startSeq,
			wEnd: endSeq
		}));
		if (summary.text.length < config.summaryFloorChars) reasons.push(fill(REASON_SUMMARY_TOO_SHORT, {
			start: summary.startSeq,
			end: summary.endSeq,
			len: summary.text.length,
			min: config.summaryFloorChars
		}));
		if (summary.text.length > config.summaryCeilingChars) reasons.push(fill(REASON_SUMMARY_TOO_LONG, {
			start: summary.startSeq,
			end: summary.endSeq,
			len: summary.text.length,
			max: config.summaryCeilingChars
		}));
	}
	for (let i = 0; i < input.summaries.length; i += 1) for (let j = i + 1; j < input.summaries.length; j += 1) {
		const a = input.summaries[i];
		const b = input.summaries[j];
		if (a.startSeq <= b.endSeq && b.startSeq <= a.endSeq) reasons.push(fill(REASON_SUMMARY_OVERLAP, {
			aStart: a.startSeq,
			aEnd: a.endSeq,
			bStart: b.startSeq,
			bEnd: b.endSeq
		}));
	}
	const foldedTokens = inRange.reduce((sum, n) => sum + n.estimatedTokens, 0);
	if (inRange.length > 0 && foldedTokens < config.minFoldableTokens) reasons.push(fill(REASON_WINDOW_TOO_SMALL, {
		start: startSeq,
		end: endSeq,
		tokens: foldedTokens,
		min: config.minFoldableTokens
	}));
	if (effectiveConfig.contextWindow !== void 0 && inRange.length > 0 && foldedTokens > effectiveConfig.maxFoldFraction * effectiveConfig.contextWindow) reasons.push(fill(REASON_WINDOW_TOO_LARGE, {
		start: startSeq,
		end: endSeq,
		tokens: foldedTokens,
		maxPct: fmtNum(effectiveConfig.maxFoldFraction * 100)
	}));
	const summaryTokens = input.summaries.reduce((sum, s) => sum + estimateTokens(s.text), 0);
	if (inRange.length > 0 && foldedTokens * config.netShrinkTolerance <= summaryTokens) reasons.push(fill(REASON_NO_NET_SHRINK, {
		start: startSeq,
		end: endSeq,
		folded: foldedTokens,
		tolerance: fmtNum(config.netShrinkTolerance),
		summary: summaryTokens
	}));
	if (reasons.length > 0) return {
		ok: false,
		reasons
	};
	const folds = [];
	for (const summary of input.summaries) {
		const subTokens = inRange.filter((n) => n.seq >= summary.startSeq && n.seq <= summary.endSeq).reduce((sum, n) => sum + n.estimatedTokens, 0);
		const entryAbsorbed = absorbed.filter((a) => a.covered && a.checkpointSeq >= summary.startSeq && a.checkpointSeq <= summary.endSeq).map((a) => a.foldId);
		folds.push({
			startSeq: summary.startSeq,
			endSeq: summary.endSeq,
			summaryText: summary.text,
			summaryTokens: estimateTokens(summary.text),
			reclaimedTokens: subTokens - estimateTokens(summary.text),
			absorbedFoldIds: entryAbsorbed
		});
	}
	if (folds.length > 0) for (const a of absorbed) {
		if (a.covered) continue;
		if (a.checkpointSeq === startSeq) folds[0] = {
			...folds[0],
			absorbedFoldIds: [...folds[0].absorbedFoldIds, a.foldId]
		};
		else if (a.checkpointSeq === endSeq) {
			const last = folds[folds.length - 1];
			folds[folds.length - 1] = {
				...last,
				absorbedFoldIds: [...last.absorbedFoldIds, a.foldId]
			};
		}
	}
	return {
		ok: true,
		plan: {
			folds,
			reclaimedTokens: foldedTokens - summaryTokens
		}
	};
}
/** Array.prototype.findLastIndex (ES2023) — local for clarity. @internal */
function findLastIndex(items, predicate) {
	for (let i = items.length - 1; i >= 0; i -= 1) if (predicate(items[i])) return i;
	return -1;
}
// src/hash.ts
/**
* Deterministic hashing primitives for the V2 observe face (RES-observe-route
* a.3): key-sorted stable stringification + sha256, both pure and
* dependency-light (node:crypto only).
*
* stableStringify sorts object keys recursively so two structurally equal
* requests hash identically regardless of property insertion order (the
* hash-stability property the V2 tests pin). Arrays keep their order —
* message and block order is semantically load-bearing on the wire.
*
* @module hash
*/
/**
* Key-sorted deterministic JSON serialization. Objects recurse with sorted
* keys; arrays recurse in order; primitives pass through. Values that JSON
* cannot represent (functions, undefined array slots → null, symbols dropped
* by JSON) follow plain JSON.stringify semantics — request payloads are
* JSON-shaped data in practice, and the snapshot hash only needs a total
* deterministic order over what is actually present.
*/
function stableStringify(value) {
	return JSON.stringify(stableValue$1(value));
}
/** Key-sorted structural clone used by {@link stableStringify}. @internal */
function stableValue$1(value) {
	if (Array.isArray(value)) return value.map((entry) => stableValue$1(entry));
	if (value !== null && typeof value === "object") {
		const record = value;
		const out = {};
		for (const key of Object.keys(record).sort()) out[key] = stableValue$1(record[key]);
		return out;
	}
	return value;
}
/** Lowercase hex sha256 of a UTF-8 string. */
function sha256Hex(text) {
	return createHash("sha256").update(text, "utf8").digest("hex");
}
/** Convenience: stable-stringify then hash in one call. */
function stableHash(value) {
	return sha256Hex(stableStringify(value));
}
// src/host-llm.ts
/**
* Optional host projection face — a fail-soft lazy loader for the official
* request-projection helpers exported by `@deepseek-ai/dsh-llm`
* (RES-observe-route a.3: "直接 import，杜绝假阳性第一类，Q5.2").
*
* Two behaviors, both honest about which one ran:
*
*  - host present → the OFFICIAL projectFilesToText /
*    projectImagesForTextModel / projectToolUpdates / isAgentLoopRequest are
*    used with their exact semantics (`projector: 'official'`). The U2 probe
*    (scripts/probe-host-imports.mjs) pins that all four exports are live on
*    the host build.
*  - host absent (tests, mocks, stripped installs) → LOCAL MINIMAL fallback
*    twins take over and every snapshot they produce is labeled
*    `projector: 'local-fallback'` (the domain-field discipline the card
*    freezes). The fallback twins are deterministic structural reductions —
*    NOT the official wire forms — so the ledger never presents their hashes
*    as official-normalized ones.
*
* Loading is lazy and memoized per process: the dynamic import runs on first
* use and its result (success or fallback) is cached. `ZCTX_DSH_LLM` may
* point the loader at an explicit host build (file path or file: URL) — the
* same override convention scripts/probe-host-imports.mjs already uses —
* which is how the official-path probe tests exercise the real exports
* without installing the host into this repo.
*
* Zero static host imports: this module always loads (config.ts fail-soft
* precedent), and callers probe the returned projector's `projector` field
* instead of catching load errors.
*
* @module host-llm
*/
/**
* FALLBACK main-chain heuristic — the host WeakSet identity is unavailable,
* so a request "looks like" an agent-loop request when it carries a session
* id and a message list (GenerateOptions.sessionId is loop-only, llm/src/
* types.ts:546; one-shot requests are excluded by the listener's criterion 2
* purpose check). KNOWN LIMITATION, honestly labeled via
* `projector: 'local-fallback'`: a hand-built request that sets sessionId
* without the host mark would false-positive here, and the true WeakSet
* cannot be replicated from outside the host process.
*/
function fallbackIsAgentLoopRequest(options) {
	if (options === null || typeof options !== "object") return false;
	const record = options;
	return typeof record.sessionId === "string" && Array.isArray(record.messages);
}
/** Deterministic identity text for a file attachment ref (fallback twin). */
function fallbackFileHandleText(ref) {
	const record = ref !== null && typeof ref === "object" ? ref : {};
	const name = typeof record.name === "string" ? record.name : "unknown";
	const bytes = typeof record.bytes === "number" ? record.bytes : -1;
	const attachmentId = typeof record.attachmentId === "string" ? record.attachmentId : "unknown";
	return `[zctx-fallback file ${JSON.stringify(name)} (${bytes} bytes, ${attachmentId})]`;
}
/**
* Replace every file content block with deterministic fallback handle text,
* mirroring the official replaceFilesWithHandles walk (content.ts:160-176):
* string content passes through; array content is copied lazily; the original
* array reference returns when no file block exists (official contract).
*/
function replaceFilesWithFallbackHandles(blocks, resolvePath) {
	let next;
	for (const [index, block] of blocks.entries()) {
		if (block !== null && typeof block === "object" && block.type === "file") {
			const ref = block.attachment;
			const resolved = resolvePath(ref);
			const text = resolved === void 0 ? fallbackFileHandleText(ref) : `${fallbackFileHandleText(ref)} (resolved: ${resolved})`;
			next ??= blocks.slice(0, index);
			next.push({
				type: "text",
				text
			});
			continue;
		}
		next?.push(block);
	}
	return next === void 0 ? {
		blocks,
		changed: false
	} : {
		blocks: next,
		changed: true
	};
}
/** Fallback projectFilesToText twin (official shape: original reference when unchanged). */
function fallbackProjectFilesToText(messages, resolvePath) {
	if (!messages.some((message) => contentHasType$3(message, "file"))) return messages;
	return messages.map((message) => {
		const content = message.content;
		if (typeof content === "string") return message;
		if (!Array.isArray(content)) return message;
		const replaced = replaceFilesWithFallbackHandles(content, resolvePath);
		if (!replaced.changed) return message;
		return {
			...message,
			content: replaced.blocks
		};
	});
}
/** True when the message's typed content contains a block of the given type. */
function contentHasType$3(message, type) {
	const content = message.content;
	if (!Array.isArray(content)) return false;
	return content.some((block) => block !== null && typeof block === "object" && block.type === type);
}
/** Deterministic placeholder text for one image block (fallback twin). */
function fallbackImagePlaceholder(block) {
	const ref = block.attachment;
	const record = ref !== null && typeof ref === "object" ? ref : {};
	const identity = typeof record.attachmentId === "string" ? record.attachmentId : `sha256:${sha256Hex(stableStringify(block)).slice(0, 16)}`;
	const bytes = typeof record.bytes === "number" ? record.bytes : void 0;
	return `[zctx-fallback image ${identity}${bytes === void 0 ? "" : ` (${bytes} bytes)`}]`;
}
/**
* Fallback projectImagesForTextModel twin: replace every image block with a
* deterministic text placeholder (official shape: original reference when no
* image block exists). Identity comes from the attachment ref when present;
* raw-data blocks without a ref degrade to a content-digest identity.
*/
function fallbackProjectImagesForTextModel(messages) {
	if (!messages.some((message) => contentHasType$3(message, "image"))) return messages;
	return messages.map((message) => {
		const content = message.content;
		if (typeof content === "string" || !Array.isArray(content)) return message;
		let next;
		for (const [index, block] of content.entries()) {
			if (block !== null && typeof block === "object" && block.type === "image") {
				next ??= content.slice(0, index);
				next.push({
					type: "text",
					text: fallbackImagePlaceholder(block)
				});
				continue;
			}
			next?.push(block);
		}
		if (next === void 0) return message;
		return {
			...message,
			content: next
		};
	});
}
/**
* Fallback projectToolUpdates twin — the minimal honest reduction of the
* official semantics for `toolUpdate: undefined` routes (content.ts:430-438):
* strip developer messages (update blocks are unroutable without the host's
* capability knowledge) and strip deferLoading markers from the declared
* tools. With a toolUpdate capability the fallback passes messages through
* and keeps the declared tools (routing needs the host's history resolution).
*/
function fallbackProjectToolUpdates(messages, tools, toolUpdate) {
	if (toolUpdate !== void 0) return {
		messages,
		tools
	};
	const filtered = messages.filter((message) => message.role !== "developer");
	let immediateTools = tools;
	if (tools?.some((tool) => tool.deferLoading === true)) immediateTools = tools.map((tool) => {
		const { deferLoading: _loading, ...rest } = tool;
		return rest;
	});
	return {
		messages: filtered,
		tools: immediateTools
	};
}
/** The fallback projector (host absent) — every snapshot it touches is labeled. */
const FALLBACK_PROJECTOR = {
	projector: "local-fallback",
	isAgentLoopRequest: fallbackIsAgentLoopRequest,
	projectFilesToText: fallbackProjectFilesToText,
	projectImagesForTextModel: fallbackProjectImagesForTextModel,
	projectToolUpdates: fallbackProjectToolUpdates
};
/**
* Wrap the host module's exports into the structural face. A host build that
* is on disk but misses a specific export (version drift) degrades THAT
* function to the fallback twin while the rest stays official — the
* projector label then honestly downgrades to 'local-fallback' for the whole
* face (a mixed label would understate the divergence risk).
*/
function buildOfficialProjector(mod) {
	if (!(typeof mod.isAgentLoopRequest === "function" && typeof mod.projectFilesToText === "function" && typeof mod.projectImagesForTextModel === "function" && typeof mod.projectToolUpdates === "function")) return FALLBACK_PROJECTOR;
	return {
		projector: "official",
		isAgentLoopRequest: (options) => mod.isAgentLoopRequest(options),
		projectFilesToText: (messages, resolvePath) => mod.projectFilesToText(messages, resolvePath),
		projectImagesForTextModel: (messages) => mod.projectImagesForTextModel(messages),
		projectToolUpdates: (messages, tools, toolUpdate, history) => mod.projectToolUpdates(messages, tools, toolUpdate, history)
	};
}
const HOST_MODULE_SPECIFIER = "@deepseek-ai/dsh-llm";
let cached$1;
/**
* Resolve the host module specifier (or the ZCTX_DSH_LLM override) into an
* importable specifier. Absolute paths convert to file: URLs; the override
* accepts a file: URL or an absolute path (probe convention). @internal
*/
function resolveHostSpecifier() {
	const override = process.env.ZCTX_DSH_LLM;
	if (override === void 0 || override === "") return HOST_MODULE_SPECIFIER;
	if (override.startsWith("file:")) return override;
	if (isAbsolute(override)) return pathToFileURL(resolve(override)).href;
	return override;
}
/**
* Load the host projector once per process: the official face when
* `@deepseek-ai/dsh-llm` resolves (bare specifier inside the host tree, or
* the ZCTX_DSH_LLM override), the labeled fallback face otherwise. Never
* throws — a failed load IS the fallback decision.
*/
function loadHostProjector() {
	cached$1 ??= (async () => {
		try {
			return buildOfficialProjector(await import(resolveHostSpecifier()));
		} catch {
			return FALLBACK_PROJECTOR;
		}
	})();
	return cached$1;
}
// src/observe.ts
/**
* observe.ts — the llm/stream waterfall listener (v0.2.0 V2, task card
* product 2; RES-observe-route a.2 item 2 + a.3).
*
* READ-ONLY DISCIPLINE (the hard contract this module lives under): the
* listener never short-circuits (it always calls `next()` and yields its
* stream through untouched — short-circuiting is the V4 preflight boundary),
* never rewrites the request in place (the frozen object tree is hashed via
* non-mutating projections only — the harness's own rewrite mode is
* replace-the-reference, and this listener does not even do that), and
* writes NOTHING to host or session state. Its only side effects are the
* injected process-memory sinks (snapshot + captured-attempt ledgers owned
* by the store), wrapped fail-soft so an observation fault can never break
* a real request. Abort safety: the pass-through rethrows stream failures
* and propagates consumer early-return into `next()`'s iterator.
*
* Main-chain four criteria (RES-observe-route §Q8.1, per attempt):
*   1. isAgentLoopRequest — official WeakSet identity via the optional host
*      import; the labeled structural heuristic when the host is absent;
*   2. purpose absent — compaction/session-title one-shots excluded;
*   3. sessionId matches the listener's watched session set (resolved
*      through the injected session registry);
*   4. not in the exemption window — the FIRST main-chain request after a
*      reset-ledger entry is exempt (guardian seq-exemption semantics,
*      cache-guardian.ts:500-505): its snapshot would only re-record the
*      reset that the reset ledger already explains.
*
* Per attempt the listener builds a RequestSnapshot (per-message
* stableStringify+sha256 over the normalized request, systemHash, toolsHash,
* attemptSeq, purpose/isLoop) and hands it to the injected snapshot sink.
* The ~20-line prefix-monotonic mechanical piece compares consecutive
* snapshots (length shrink / per-position break point) and classifies the
* break against the reset-ledger entries consumed since the previous
* snapshot — `reset-explained` or `unknown-break`, always
* `domain: 'harness'` (pi-ai wire rewrites are a registered blind spot,
* §Q5.2).
*
* Optional `attemptCapture` face (config observe.attemptCapture, DEFAULT
* false): wraps `next()` and watches usage/finish chunks, capturing FAILED
* attempts' usage into the non-durable ledger (session logs keep no
* per-attempt usage for retried-away attempts, §Q8.2 item 2). The wrapper
* only observes; every chunk is yielded unchanged and aborts rethrow.
*
* @module observe
*/
/**
* Bounded cap for the per-route model-info cache (V2-C closure, R3 review:
* the cache was process-unbounded — negative results included — which broke
* the plugin's 64-ledger bounded-memory discipline for no benefit). Insertion
* order eviction drops the OLDEST route when the cap is hit; a live route is
* re-resolved on its next request (one extra injected resolver call after 64
* other routes passed through). 64 = the same cap value every plugin ledger
* uses.
*/
const MODEL_INFO_CACHE_CAP = 64;
/** Read a usage chunk's numeric fields honestly (absence stays absent). */
function extractUsageFields(usage) {
	const num = (value) => typeof value === "number" && Number.isFinite(value) ? value : void 0;
	const input = num(usage.inputTokens);
	const output = num(usage.outputTokens);
	const total = num(usage.totalTokens);
	const read = num(usage.cacheReadTokens);
	const write = num(usage.cacheWriteTokens);
	return {
		...input !== void 0 ? { inputTokens: input } : {},
		...output !== void 0 ? { outputTokens: output } : {},
		...total !== void 0 ? { totalTokens: total } : {},
		...read !== void 0 ? { cacheReadTokens: read } : {},
		...write !== void 0 ? { cacheWriteTokens: write } : {}
	};
}
function isRecord$3(value) {
	return value !== null && typeof value === "object";
}
/**
* The prefix-monotonic mechanical piece (~20 lines): compare a snapshot
* against its predecessor — length shrink and/or per-position break point.
* Growth with an intact common prefix is the normal conversation walk and
* records nothing. Returns undefined when there is no baseline or no break.
*
* DELIBERATE NARROWING (V2-B closure, R3 review; RES-observe-route a.3 as
* written): the break domain is the MESSAGE LIST ONLY — `systemHash` and
* `toolsHash` are collected on every snapshot but deliberately DO NOT
* participate in break detection. System-section and toolset changes are the
* reset ledger's territory (the `system-section-change` / `toolset-change` /
* `sampling-change` classes classify them through request/header diffs, and
* the exemption window excuses the first request after such a reset), and
* pi-ai-domain system folding is a registered object-level blind spot
* (§Q5.2) that a system/tools hash could never see either. Nothing here
* should grow a frozen-segment comparison without reopening that spec
* decision.
*/
function detectPrefixBreak(prev, next, explainedBy) {
	if (prev === void 0) return void 0;
	const before = prev.perMessageHashes;
	const after = next.perMessageHashes;
	const common = Math.min(before.length, after.length);
	let breakIndex;
	for (let i = 0; i < common; i += 1) if (before[i] !== after[i]) {
		breakIndex = i;
		break;
	}
	const mode = after.length < before.length ? "length-shrink" : breakIndex !== void 0 ? "content-change" : void 0;
	if (mode === void 0) return void 0;
	const resetExplained = explainedBy !== void 0 && explainedBy.length > 0;
	return {
		domain: "harness",
		sessionId: next.sessionId,
		attemptSeq: next.attemptSeq,
		prevAttemptSeq: prev.attemptSeq,
		...breakIndex !== void 0 ? { breakIndex } : {},
		mode,
		classification: resetExplained ? "reset-explained" : "unknown-break",
		...resetExplained ? { explainedBy } : {},
		time: next.time
	};
}
/**
* The main-chain criteria 1-3 (V2), factored out in V4 for the preflight
* listener to REUSE (task card: 复用 V2 observe listener 的主链四判据 — shared
* code, not a copy): official WeakSet identity (or the labeled heuristic),
* purpose exclusion, watched-session + store binding. Criterion 4 (the
* exemption window) is deliberately NOT part of this helper: it exists for
* SNAPSHOT semantics only (a post-reset request's snapshot would merely
* re-record the reset its ledger already explains) and stays a per-listener
* state machine in ObserveListener — the preflight listener must judge EVERY
* main-chain request, including the one right after a reset.
*/
function matchesMainChain(options, projector, registry) {
	if (!projector.isAgentLoopRequest(options)) return void 0;
	if (options.purpose !== void 0) return void 0;
	const sessionId = options.sessionId;
	if (typeof sessionId !== "string") return void 0;
	const session = registry.resolveSession(sessionId);
	const store = registry.storeFor(session);
	if (store === void 0) return void 0;
	return {
		sessionId,
		store
	};
}
/**
* The llm/stream observe listener. Construct once per plugin; register
* `onStream` (bound) on the host's llm/stream waterfall.
*/
var ObserveListener = class {
	deps;
	stateBySession = /* @__PURE__ */ new Map();
	modelInfoCache = /* @__PURE__ */ new Map();
	projector;
	warnedSinkFault = false;
	/** V2-A closure: the prepare-catch warns ONCE instead of swallowing silently. */
	warnedPrepareFault = false;
	constructor(deps) {
		this.deps = deps;
	}
	/**
	* Resolve (and memoize) the projector; the plugin may await this once at
	* wire time to log which face went live. Never throws.
	*/
	ensureProjector() {
		this.projector ??= loadHostProjector();
		return this.projector;
	}
	/**
	* The waterfall listener body. Bind/register via `onStream` (an instance
	* arrow property, immune to cordis's `this: LlmRuntime` invocation).
	*/
	onStream = (options, next) => this.handleStream(options, next);
	/** @internal */
	async *handleStream(options, next) {
		let plan;
		try {
			plan = await this.prepare(options);
		} catch (error) {
			if (!this.warnedPrepareFault) {
				this.warnedPrepareFault = true;
				this.deps.logger?.warn?.(`dsh-zcontext: observe prepare failed (${error instanceof Error ? error.message : String(error)}); request snapshots stay off until the fault clears`);
			}
			plan = void 0;
		}
		if (plan === void 0 || !this.deps.attemptCapture) {
			yield* next();
			return;
		}
		yield* this.captureWrap(plan, next);
	}
	/** Four criteria + snapshot build + break detection. @internal */
	async prepare(options) {
		if (!isRecord$3(options)) return void 0;
		const projector = await this.ensureProjector();
		const match = matchesMainChain(options, projector, this.deps);
		if (match === void 0) return void 0;
		const sessionId = match.sessionId;
		const store = match.store;
		const state = this.stateFor(sessionId);
		const resets = store.resetEvents();
		const consumedThrough = state.lastConsumedResetSeq;
		const pending = consumedThrough === void 0 ? resets : resets.filter((reset) => reset.seq > consumedThrough);
		if (pending.length > 0) {
			state.lastConsumedResetSeq = pending[pending.length - 1].seq;
			state.explainedBy = [...state.explainedBy ?? [], ...pending.map((reset) => ({
				kind: reset.kind,
				seq: reset.seq
			}))];
			return {
				record: options,
				sessionId,
				store,
				attemptSeq: 0
			};
		}
		state.attemptSeq += 1;
		const prev = store.lastRequestSnapshot();
		const provider = typeof options.provider === "string" ? options.provider : "(unknown)";
		const model = typeof options.model === "string" ? options.model : "(unknown)";
		const projection = await this.normalizeForHash(options, projector);
		const snapshot = {
			sessionId,
			attemptSeq: state.attemptSeq,
			provider,
			model,
			perMessageHashes: projection.messages.map((message) => stableHash(message)),
			...projection.system !== void 0 ? { systemHash: stableHash(projection.system) } : {},
			...projection.tools !== void 0 ? { toolsHash: stableHash(projection.tools) } : {},
			isLoop: true,
			projector: projector.projector,
			time: Date.now()
		};
		const breakRecord = detectPrefixBreak(prev, snapshot, state.explainedBy);
		state.explainedBy = void 0;
		this.sink(() => store.absorbRequestSnapshot(snapshot, breakRecord));
		return {
			record: options,
			sessionId,
			store,
			attemptSeq: snapshot.attemptSeq
		};
	}
	/**
	* The a.3 normalization pipeline over the official projection exports
	* (exact semantics when the host is present; the labeled fallback twins
	* otherwise). Mirrors the official request assembly shape:
	*   1. files → handle text, UNCONDITIONAL (official: the projection is
	*      unconditional in request assembly); the resolver returns undefined
	*      — the V2 listener has no execution-world file access, and the
	*      resulting handle text stays deterministic per attachment ref;
	*   2. images → placeholders ONLY when the routed model's modalities are
	*      known and lack image (official gating; unknown modalities skip);
	*   3. tool updates → official routing with the resolved capability
	*      (undefined = unsupported route).
	* All projections are non-mutating: they return originals or copies and
	* never write into the frozen request tree.
	*/
	async normalizeForHash(options, projector) {
		const messages = Array.isArray(options.messages) ? options.messages : [];
		const tools = Array.isArray(options.tools) ? options.tools : void 0;
		const resolvePath = () => void 0;
		let projected = projector.projectFilesToText(messages, resolvePath);
		const modelInfo = await this.resolveModelInfoCached(typeof options.provider === "string" ? options.provider : "", typeof options.model === "string" ? options.model : "");
		if (modelInfo?.inputModalities !== void 0 && !modelInfo.inputModalities.includes("image") && messages.some((message) => isRecord$3(message) && contentHasType$2(message, "image"))) projected = projector.projectImagesForTextModel(projected);
		const toolUpdate = modelInfo?.toolUpdate;
		const result = projector.projectToolUpdates(projected, tools, toolUpdate, options.toolHistory);
		return {
			messages: result.messages,
			tools: result.tools ?? tools,
			system: options.system
		};
	}
	/** Memoized per-route model info (negative results cached too; failures degrade to undefined). */
	resolveModelInfoCached(provider, model) {
		if (provider === "" || model === "") return Promise.resolve(void 0);
		const key = `${provider}\u0000${model}`;
		let entry = this.modelInfoCache.get(key);
		if (entry === void 0) {
			const resolver = this.deps.resolveModelInfo;
			entry = resolver === void 0 ? Promise.resolve(void 0) : resolver(provider, model).catch(() => void 0);
			if (this.modelInfoCache.size >= MODEL_INFO_CACHE_CAP) {
				const oldest = this.modelInfoCache.keys().next();
				if (!oldest.done) this.modelInfoCache.delete(oldest.value);
			}
			this.modelInfoCache.set(key, entry);
		}
		return entry;
	}
	/** Per-session state map entry. @internal */
	stateFor(sessionId) {
		let state = this.stateBySession.get(sessionId);
		if (state === void 0) {
			state = {
				lastConsumedResetSeq: void 0,
				explainedBy: void 0,
				attemptSeq: 0
			};
			this.stateBySession.set(sessionId, state);
		}
		return state;
	}
	/**
	* Drop one session's listener state (the plugin wires this to the
	* session/disposed feed): the state is process memory keyed by session ID
	* and must not outlive the session it belongs to. The session's own store
	* dies with the host reference; this map is the only cross-session holder.
	*/
	forgetSession(sessionId) {
		this.stateBySession.delete(sessionId);
	}
	/** Fail-soft sink invocation: a store fault warns once and never breaks the stream. @internal */
	sink(write) {
		try {
			write();
		} catch (error) {
			if (!this.warnedSinkFault) {
				this.warnedSinkFault = true;
				this.deps.logger?.warn?.(`dsh-zcontext: observe sink failed (${error instanceof Error ? error.message : String(error)}); observation stays off until restart`);
			}
		}
	}
	/**
	* attemptCapture wrapper: yields every chunk unchanged, watches usage and
	* finish chunks, and records FAILED attempts' usage (finish error/aborted
	* or a thrown stream) into the non-durable ledger. Abort safety: the
	* wrapper rethrows, and consumer early-return closes `next()`'s iterator
	* through the for-await contract.
	* @internal
	*/
	async *captureWrap(plan, next) {
		const inner = next();
		let lastUsage;
		let finishKind;
		let threw = false;
		try {
			for await (const chunk of inner) {
				if (isRecord$3(chunk)) {
					if (chunk.type === "usage" && isRecord$3(chunk.usage)) lastUsage = chunk.usage;
					if (chunk.type === "finish" && isRecord$3(chunk.reason) && typeof chunk.reason.kind === "string") finishKind = chunk.reason.kind;
				}
				yield chunk;
			}
		} catch (error) {
			threw = true;
			throw error;
		} finally {
			if ((threw || finishKind === "error" || finishKind === "aborted") && lastUsage !== void 0) {
				const outcome = threw ? isRecord$3(plan.record.signal) && plan.record.signal.aborted === true ? "aborted" : "error" : finishKind;
				const record = {
					sessionId: plan.sessionId,
					attemptSeq: plan.attemptSeq,
					provider: typeof plan.record.provider === "string" ? plan.record.provider : "(unknown)",
					model: typeof plan.record.model === "string" ? plan.record.model : "(unknown)",
					usage: extractUsageFields(lastUsage),
					outcome,
					nonDurable: true,
					time: Date.now()
				};
				this.sink(() => plan.store.absorbCapturedAttemptUsage(record));
			}
		}
	}
};
/** True when the message's typed content contains a block of the given type. */
function contentHasType$2(message, type) {
	const content = message.content;
	if (!Array.isArray(content)) return false;
	return content.some((block) => isRecord$3(block) && block.type === type);
}
// src/preflight.ts
/**
* preflight.ts — the S1 waterfall-level preflight listener (v0.2.0 V4, task
* card products 1-3; RES-adapter-route §11b S1 + F3.3/F3.4/F6.1-F6.4/F8.3).
*
* WHAT THIS IS: a second `llm/stream` waterfall listener (registered
* OUTERMOST — cordis composes listeners outermost-first,
* vendor/cordis/src/events.ts:221-236 — so an enforce short-circuit
* suppresses the entire downstream chain: no adapter dispatch, no wire
* request, no observation cost). It estimates the request's context size
* BEFORE the wire and judges it against the CCM trigger line.
*
* FALSE-POSITIVE COST DECLARATION (F6.4, card docstring requirement): a
* preflight hit that the provider would have accepted triggers one
* unnecessary compaction surface rewrite (the session view is folded).
* That cost is why enforce is opt-in (config preflightMode, R2: default
* 'observe', unreached by the default configuration — pinned by test) and
* why the hit threshold carries a margin (preflightMarginRatio, default
* 0.9): hit ⇔ estimate > triggerLine × margin, where
* triggerLine = W − R_pess (budget.ts CCM §1.2). 估算器误差分布待真机标定后
* 调整 — the observe-mode calibration ledger (product 3) is the dataset
* that decides when enforce is safe to promote (no-go condition 4).
*
* HOST-INTERACTION DECLARATIONS (P3 HF-06, facts not recommendations):
*   1. A short-circuit consumes ONE of the official compaction chain's
*      `maxOverflowRetries` overflow budgets (compaction-basic/src/index.ts:
*      194-200 — the vetoed request still counts as an overflow attempt), so
*      preflight false positives spend the recovery layer's budget too.
*   2. If the user adds CONTEXT_WINDOW_EXCEEDED to the official
*      `retryableCodes` (configurable since rc.2), llm-retry will retry the
*      SAME still-over-limit request after a short-circuit — up to
*      maxRetries estimate->short-circuit loops (bounded, no deadlock, but
*      wasteful). Keep that code OUT of retryableCodes on zctx sessions; the
*      compaction chain, not llm-retry, owns overflow recovery.
*
* ESTIMATOR (F3.4): the waterfall sees PRE-projection messages (file/image
* projection happens inside adapterStream, llm/src/index.ts:1084-1106), so
* the estimate re-projects through the same public face the V2 observe
* listener uses (loadHostProjector: official exports when the host is
* present, labeled local-fallback twins otherwise — the `projector` label
* is honest per record). Text cost = chars/3 (CCM L0, budget.estimateTokens;
* a known UNDERESTIMATE for dense CJK — budget.ts docstring). Images follow
* the official gating: projected to placeholder text only for KNOWN
* image-less models (same condition as observe.normalizeForHash); images
* that stay on the wire cost adapter `imageRequestPricing`
* (visualTokens + text, llm/src/types.ts:212-220) when injectable, else a
* fixed conservative reserve per image (PER_IMAGE_FALLBACK_TOKENS, 待标定).
*
* RECURSION REDLINE (plan §2 R3): this module NEVER calls ctx.llm.stream.
* The deps surface is narrow by construction — it has no llm runtime at
* all, only three single-purpose host helpers (resolveModelInfo,
* fileRequestText, imageRequestPricing) — so the self-call is structurally
* unreachable, not just forbidden.
*
* READ-ONLY DISCIPLINE (same contract as the V2 listener): the frozen
* request tree is read through non-mutating projections only (the zero-
* mutation pin covers this listener in tests); nothing is written to host
* or session state; the only side effect is the process-memory calibration
* ledger through the injected store port.
*
* SHORT-CIRCUIT SHAPE (enforce hit; card: 形态严格对照官方协议): exactly one
* terminal chunk `finish{kind:'error', failure:{code:'CONTEXT_WINDOW_EXCEEDED'}}`
* per the official StreamChunk protocol (llm/src/types.ts:452-464 read
* directly: "Adapters emit usage before the terminal finish and nothing
* afterward" — no usage exists here, so none is emitted, and the finish is
* both first and last). LlmFailure carries message + code only (official
* shape types.ts:41-62; status/requestId honestly absent — we have none).
* agent-loop converts the finish error into agent/request-error
* (agent-loop/src/agent.ts:511-530) and compaction-basic's overflow handler
* consumes the exact code (compaction-basic/src/index.ts:194→233) — the
* official recovery chain owns everything after the short-circuit.
*
* @module preflight
*/
/**
* Conservative per-image token reserve used when the adapter's
* imageRequestPricing is unavailable (card: 每图常数预留+标注). An
* UNCALIBRATED placeholder chosen well above typical single-image visual
* token costs so the estimate errs toward safety on image-heavy requests;
* calibration pending (plan §3) — adjust from the calibration ledger, never
* silently.
*/
const PER_IMAGE_FALLBACK_TOKENS = 2048;
/**
* The official overflow failure code (llm/src/error.ts:25,
* `CONTEXT_WINDOW_EXCEEDED_CODE`, read directly from source). Duplicated as
* a literal because this module never imports the host statically (fail-soft
* loading discipline, config.ts precedent); tests pin the value against the
* official constant's documented spelling.
*/
const PREFLIGHT_CONTEXT_WINDOW_EXCEEDED_CODE = "CONTEXT_WINDOW_EXCEEDED";
/** Read a positive finite integer window off the resolved model info. */
function windowOf(modelInfo) {
	const window = modelInfo?.context?.contextWindow;
	return typeof window === "number" && Number.isFinite(window) && window > 0 ? window : void 0;
}
function isRecord$2(value) {
	return value !== null && typeof value === "object";
}
/** True when the message's typed content contains a block of the given type. */
function contentHasType$1(message, type) {
	const content = message.content;
	if (!Array.isArray(content)) return false;
	return content.some((block) => isRecord$2(block) && block.type === type);
}
/**
* Walk one message's content: text/reasoning count their characters, kept
* image blocks return for pricing, every other block (tool-call history,
* residual file shapes, unknown future blocks) counts its structural JSON
* — an honest chars-level reduction of whatever actually rides the wire.
* Values JSON cannot represent (undefined content, function slots) count 0 —
* malformed shapes never break the estimator (the fail-soft release above is
* the second line of defense).
*/
function walkMessage(message) {
	const content = message.content;
	if (typeof content === "string") return {
		chars: content.length,
		keptImages: []
	};
	let chars = 0;
	const keptImages = [];
	if (Array.isArray(content)) for (const block of content) {
		if (isRecord$2(block) && (block.type === "text" || block.type === "reasoning") && typeof block.text === "string") {
			chars += block.text.length;
			continue;
		}
		if (isRecord$2(block) && block.type === "image") {
			keptImages.push(block);
			continue;
		}
		const raw = stableStringify(block);
		chars += typeof raw === "string" ? raw.length : 0;
	}
	else {
		const raw = stableStringify(content);
		chars += typeof raw === "string" ? raw.length : 0;
	}
	return {
		chars,
		keptImages
	};
}
/**
* Estimate the projected request's input tokens (the pure estimator; the
* listener feeds it the projections). `projected.messages` must already carry
* the file/image/tool-update projections; kept images are priced here.
*/
function estimateProjectedRequest(input) {
	let chars = 0;
	let imageCount = 0;
	let keptImages = [];
	for (const message of input.messages) {
		const walked = walkMessage(message);
		chars += walked.chars;
		imageCount += walked.keptImages.length;
		keptImages = keptImages.concat(walked.keptImages);
	}
	if (typeof input.system === "string") chars += input.system.length;
	for (const tool of input.tools ?? []) {
		const raw = stableStringify(tool);
		chars += typeof raw === "string" ? raw.length : 0;
	}
	let imageTokens = 0;
	let imagePricing = "not-exercised";
	if (keptImages.length > 0) {
		const prices = safePriceImages(input.pricing, keptImages);
		if (prices !== void 0) {
			imagePricing = "adapter";
			for (const price of prices) {
				const visual = typeof price?.visualTokens === "number" && Number.isFinite(price.visualTokens) ? price.visualTokens : PER_IMAGE_FALLBACK_TOKENS;
				imageTokens += visual + estimateTokens(typeof price?.text === "string" ? price.text : "");
			}
		} else {
			imagePricing = "constant-reserve";
			imageTokens += keptImages.length * PER_IMAGE_FALLBACK_TOKENS;
		}
	}
	return {
		tokens: Math.ceil(chars / 3) + imageTokens,
		imagePricing,
		imageCount
	};
}
/** Price kept images fail-soft: adapter faults / shape mismatches → undefined. */
function safePriceImages(pricing, images) {
	if (pricing === void 0 || typeof pricing.priceImages !== "function") return void 0;
	try {
		const prices = pricing.priceImages(images);
		return Array.isArray(prices) && prices.length === images.length ? prices : void 0;
	} catch {
		return;
	}
}
/**
* Judge one estimate against the CCM trigger line (card: 估算 >
* triggerLine × marginRatio → 命中). Fail-soft everywhere: an unresolvable
* window or a degenerate computeBudget window releases the request with
* hit undefined (F6.4 degrade-to-observe — the provider's own overflow
* error still reaches the same recovery chain).
*/
function judgeEstimate(input) {
	const window = windowOf(input.modelInfo);
	if (window === void 0) return {
		window: void 0,
		triggerLine: void 0,
		hit: void 0
	};
	const maxTokens = typeof input.optionsMaxTokens === "number" && input.optionsMaxTokens > 0 ? input.optionsMaxTokens : typeof input.modelInfo?.defaultMaxTokens === "number" && input.modelInfo.defaultMaxTokens > 0 ? input.modelInfo.defaultMaxTokens : void 0;
	try {
		const budget = computeBudget({
			contextWindow: window,
			...maxTokens !== void 0 ? { maxOutput: maxTokens } : {}
		});
		return {
			window,
			triggerLine: budget.triggerLine,
			hit: input.estimate > budget.triggerLine * input.marginRatio
		};
	} catch {
		return {
			window,
			triggerLine: void 0,
			hit: void 0
		};
	}
}
/** Clamp the configured margin into (0, 1]; anything else falls back to 0.9 (warn-once). */
function resolveMarginRatio(value, logger) {
	const DEFAULT = .9;
	if (typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 1) return value;
	logger?.warn?.(`dsh-zcontext: preflightMarginRatio ${String(value)} is outside (0, 1] — falling back to ${DEFAULT}`);
	return DEFAULT;
}
/**
* Project one request through the public projection face and estimate its
* input tokens (the shared estimate core). Extracted in P6-E so the autoFold
* face reuses the EXACT V4 estimate path (trigger 复用 V4 preflight 判据):
* identical projection, identical image gating, identical tool pricing — two
* copies of this walk would drift. Pure relative to its inputs; throws on
* grossly malformed options (callers degrade honestly).
*/
function projectAndEstimateRequest(input) {
	const messages = Array.isArray(input.options.messages) ? input.options.messages : [];
	const tools = Array.isArray(input.options.tools) ? input.options.tools : void 0;
	const resolvePath = typeof input.fileRequestText === "function" ? (ref) => input.fileRequestText?.(ref) : () => void 0;
	let projected = input.projector.projectFilesToText(messages, resolvePath);
	if (messages.some((message) => contentHasType$1(message, "image")) && input.modelInfo?.inputModalities !== void 0 && !input.modelInfo.inputModalities.includes("image")) projected = input.projector.projectImagesForTextModel(projected);
	const toolUpdate = input.modelInfo?.toolUpdate;
	const projectedTools = input.projector.projectToolUpdates(projected, tools, toolUpdate, input.options.toolHistory);
	return estimateProjectedRequest({
		messages: projectedTools.messages,
		tools: projectedTools.tools ?? tools,
		system: input.options.system,
		pricing: input.imagePricing
	});
}
/**
* The S1 preflight listener. Construct once per plugin when
* preflightMode !== 'off'; register `onStream` on the host's llm/stream
* waterfall BEFORE the observe listener (outermost — see module docstring).
*/
var PreflightListener = class PreflightListener {
	deps;
	modelInfoCache = /* @__PURE__ */ new Map();
	projector;
	warnedFault = false;
	warnedSinkFault = false;
	/** Same bounded-cap design as the V2 model-info cache (V2-C precedent). */
	static MODEL_INFO_CACHE_CAP = 64;
	constructor(deps) {
		this.deps = {
			...deps,
			marginRatio: resolveMarginRatio(deps.marginRatio, deps.logger)
		};
	}
	/** Memoized projector (same lazy face as the observe listener). */
	ensureProjector() {
		this.projector ??= loadHostProjector();
		return this.projector;
	}
	/** The waterfall listener body (instance arrow property — cordis `this` safety). */
	onStream = (options, next) => this.handleStream(options, next);
	/** @internal */
	async *handleStream(options, next) {
		let judged;
		try {
			judged = await this.judgeRequest(options);
		} catch (error) {
			if (!this.warnedFault) {
				this.warnedFault = true;
				this.deps.logger?.warn?.(`dsh-zcontext: preflight estimation failed (${error instanceof Error ? error.message : String(error)}); releasing requests unjudged until the fault clears`);
			}
			judged = void 0;
		}
		if (judged === void 0) {
			yield* next();
			return;
		}
		if (this.deps.mode === "enforce" && judged.calibration.hit === true) {
			this.sink(judged.store, {
				...judged.calibration,
				outcome: "short-circuited"
			});
			yield buildPreflightErrorFinish(judged.calibration);
			return;
		}
		yield* this.calibrateWrap(judged, next);
	}
	/**
	* Criteria 1-3 (shared matchesMainChain) + estimate + judgment. Every
	* main-chain request is judged — criterion 4's snapshot exemption window
	* does NOT apply here (a post-reset request must still be judged; see
	* matchesMainChain). Non-main-chain requests (one-shots: compaction
	* summarize, session-title) stream through untouched — enforce MUST NOT
	* short-circuit the compaction recovery's own calls.
	* @internal
	*/
	async judgeRequest(options) {
		if (!isRecord$2(options)) return void 0;
		const projector = await this.ensureProjector();
		const match = matchesMainChain(options, projector, this.deps);
		if (match === void 0) return void 0;
		const store = match.store;
		const provider = typeof options.provider === "string" ? options.provider : "";
		const model = typeof options.model === "string" ? options.model : "";
		const modelInfo = await this.resolveModelInfoCached(provider, model);
		const pricing = typeof this.deps.imageRequestPricing === "function" ? this.deps.imageRequestPricing(provider, model) : void 0;
		const estimate = projectAndEstimateRequest({
			options,
			projector,
			modelInfo,
			...typeof this.deps.fileRequestText === "function" ? { fileRequestText: (ref) => this.deps.fileRequestText?.(ref) } : {},
			...pricing !== void 0 ? { imagePricing: pricing } : {}
		});
		const judgment = judgeEstimate({
			estimate: estimate.tokens,
			modelInfo,
			optionsMaxTokens: options.maxTokens,
			marginRatio: this.deps.marginRatio
		});
		return {
			record: options,
			sessionId: match.sessionId,
			store,
			calibration: {
				sessionId: match.sessionId,
				mode: this.deps.mode,
				provider: provider === "" ? "(unknown)" : provider,
				model: model === "" ? "(unknown)" : model,
				estimate: estimate.tokens,
				...judgment.window !== void 0 ? { window: judgment.window } : {},
				...judgment.triggerLine !== void 0 ? { triggerLine: judgment.triggerLine } : {},
				marginRatio: this.deps.marginRatio,
				projector: projector.projector,
				imagePricing: estimate.imagePricing,
				imageCount: estimate.imageCount,
				hit: judgment.hit,
				time: Date.now()
			}
		};
	}
	/**
	* Pass-through wrapper: yields every chunk unchanged (zero-mutation pin
	* covers this path), watches the usage + finish chunks, and absorbs the
	* calibration record when the stream settles. Abort/throw safety: the
	* error rethrows; the record lands in the finally with an honest outcome.
	* @internal
	*/
	async *calibrateWrap(judged, next) {
		let usage;
		let finishKind;
		let threw;
		try {
			for await (const chunk of next()) {
				if (isRecord$2(chunk)) {
					if (chunk.type === "usage" && isRecord$2(chunk.usage)) usage = extractUsage(chunk.usage);
					if (chunk.type === "finish" && isRecord$2(chunk.reason) && typeof chunk.reason.kind === "string") finishKind = chunk.reason.kind;
				}
				yield chunk;
			}
		} catch (error) {
			threw = isRecord$2(judged.record.signal) && judged.record.signal.aborted === true ? "aborted" : "error";
			throw error;
		} finally {
			const outcome = threw !== void 0 ? threw : finishKind === "error" || finishKind === "aborted" ? finishKind : usage !== void 0 ? "completed" : "no-usage";
			this.sink(judged.store, {
				...judged.calibration,
				outcome,
				...usage !== void 0 ? { usage } : {}
			});
		}
	}
	/** Memoized per-route model info (bounded, negative results cached; V2-C design). */
	resolveModelInfoCached(provider, model) {
		if (provider === "" || model === "" || typeof this.deps.resolveModelInfo !== "function") return Promise.resolve(void 0);
		const key = `${provider}\u0000${model}`;
		let entry = this.modelInfoCache.get(key);
		if (entry === void 0) {
			entry = this.deps.resolveModelInfo(provider, model).catch(() => void 0);
			if (this.modelInfoCache.size >= PreflightListener.MODEL_INFO_CACHE_CAP) {
				const oldest = this.modelInfoCache.keys().next();
				if (!oldest.done) this.modelInfoCache.delete(oldest.value);
			}
			this.modelInfoCache.set(key, entry);
		}
		return entry;
	}
	/** Fail-soft sink: a store fault warns once and never breaks the stream. @internal */
	sink(store, record) {
		try {
			store.absorbPreflightCalibration(record);
		} catch (error) {
			if (!this.warnedSinkFault) {
				this.warnedSinkFault = true;
				this.deps.logger?.warn?.(`dsh-zcontext: preflight calibration sink failed (${error instanceof Error ? error.message : String(error)}); calibration stays off until restart`);
			}
		}
	}
};
/** Extract the usage fields honestly (absence stays absent). */
function extractUsage(usage) {
	const num = (value) => typeof value === "number" && Number.isFinite(value) ? value : void 0;
	return {
		...num(usage.inputTokens) !== void 0 ? { inputTokens: num(usage.inputTokens) } : {},
		...num(usage.outputTokens) !== void 0 ? { outputTokens: num(usage.outputTokens) } : {},
		...num(usage.totalTokens) !== void 0 ? { totalTokens: num(usage.totalTokens) } : {},
		...num(usage.cacheReadTokens) !== void 0 ? { cacheReadTokens: num(usage.cacheReadTokens) } : {},
		...num(usage.cacheWriteTokens) !== void 0 ? { cacheWriteTokens: num(usage.cacheWriteTokens) } : {}
	};
}
/**
* The synthesized terminal finish chunk for an enforce hit (official chunk
* protocol, llm/src/types.ts:452-464 + FinishReasonMap :156-163 + LlmFailure
* :41-62 — read directly, not from memory). No usage chunk precedes it (no
* usage exists), no chunk follows it.
*/
function buildPreflightErrorFinish(calibration) {
	const line = calibration.triggerLine !== void 0 ? `triggerLine ${calibration.triggerLine}` : "unresolvable trigger line";
	return {
		type: "finish",
		reason: {
			kind: "error",
			failure: {
				message: `dsh-zcontext preflight: estimated request context ~${calibration.estimate} tokens exceeds the calibrated hit line (${line} × margin ${calibration.marginRatio} = ${calibration.triggerLine !== void 0 ? Math.ceil(calibration.triggerLine * calibration.marginRatio) : "n/a"} of window ${calibration.window ?? "unknown"}); the official compaction overflow recovery owns the retry`,
				code: PREFLIGHT_CONTEXT_WINDOW_EXCEEDED_CODE
			}
		}
	};
}
// src/store.ts
/**
* FoldStore — the plugin's single durable-state maintainer (task card W3 §1).
*
* Zero independent storage: the session log is the only durable state
* (plan §2 方案甲 6). The store rebuilds its view of that log at `attach`
* (one scan = the resume-restore the official synchronous-read decision
* explicitly blesses: "Restore that state during resume, then maintain it
* incrementally from newly committed events" — .agents/notes/implemented/
* architecture/2026-09-09-deprecate-synchronous-session-event-reads.md),
* and afterwards consumes only the host-delivered `session/event` feed
* (injected callback — no cordis import here).
*
* The store retains the events it has seen, indexed by seq, so every later
* read (surface node payloads, unfold re-materialization, recall originals)
* is served from the store instead of re-reading session history. When the
* feed has gaps, `resync()` repairs the delta with bounded seq reads.
*
* Rebuilt views:
* - fold ledger: one entry per committed fold checkpoint, with status
*   'active' | 'unfolded' | 'absorbed' | 'dead'. `foldMap` (validator input)
*   exposes only ACTIVE folds; a checkpoint absorbed into a newer zctx fold
*   is 'absorbed', one shadowed by any other producer (official compaction
*   included) is 'dead', and one replaced by a zctx-unfold node is
*   'unfolded'.
* - usage ledger (S6): per assistant/message event, the optional provider
*   usage sample (cacheReadTokens/cacheWriteTokens). Missing usage marks the
*   snapshot estimated.
* - surfaceNodes(): the validator-facing SurfaceNode view of the CURRENT
*   surface, derived from the live `session.surface.nodes` (authoritative)
*   plus the retained events; a local fold replay substitutes only when the
*   session exposes no surface (structural mocks).
* - compaction mutex state: the durable `compaction/start` … `compaction/end`
*   bracket, tracked incrementally with the official session/end-seed
*   lifecycle boundary (compaction-basic/src/region.ts
*   inspectCompactionEntryState semantics).
* - observability ledgers (v0.2.0 route-two, V1; RES-observe-route a.1):
*   the request/header chain (RouteHeader), the cache-reset ledger
*   (ResetEvent — 7 of the 8 guardian whitelist classes mapped onto
*   session/event signals per §Q6; `oneShotExempt` belongs to the V2
*   llm/stream listener), and the usage records with full token fields
*   (UsageRecord). Rebuild and incremental maintenance share ONE
*   transition (`applyEvent`), so attach scans, live feeds, and `resync()`
*   gaps stay consistent by construction. V2 adds: `reason: 'series'`
*   headers are accounted as their own `series-restart` reset (V1 handoff
*   ruling ①), and the PROCESS-MEMORY receive ports the V2 observe listener
*   sinks into — request snapshots (RequestSnapshot), the harness-domain
*   prefix-break ledger (PrefixBreakRecord), and the non-durable
*   captured-attempt-usage ledger (CapturedAttemptUsage). Those three
*   ledgers are never written to the session log (CARD-F a.1 进程内不入账);
*   they are the zctx_status data plane the V3 aggregation consumes.
*
* V3 fills the fields V1 reserved (RES-observe-route §Q4/§Q7): the
* attribution engine (attribution.ts pure core) binds each assistant/message
* to its nearest preceding fold commit inside the shared `applyEvent`
* transition (attach scan, live feed, and resync behave identically by
* construction), and the semi paths grade usage-less requests —
* `meterAnchored` at event time through the INJECTED {@link MeterAnchorLike}
* (never a host import here) and `interpolated` retro-actively when the
* same-turn measured anchor arrives with no reset in between. Field absence
* is never reverse-inferred into cache support (§Q2.3). The fold-attribution
* ledger and the on-demand `observabilitySnapshot()` feed zctx_status's
* three-segment upgrade (§Q7.3: 三态占比 / 回本表 / 重置台账摘要).
*
* Zero host imports; the session is consumed through the structural
* SessionLike contract only. Header field comparison is a local twin of the
* official `callConfigEquals` (see the local function's doc below).
*
* @module store
*/
/** Message-producing event types (official session/src/types.ts:439-444). */
const MESSAGE_EVENT_TYPES = /* @__PURE__ */ new Set([
	"system/message",
	"developer/message",
	"user/message",
	"assistant/message",
	"tool/result"
]);
/** Role mapping for surface event types. */
const ROLE_BY_TYPE = {
	"system/message": "system",
	"developer/message": "developer",
	"user/message": "user",
	"assistant/message": "assistant",
	"tool/result": "tool"
};
/** Bounded cap for the usage ledger (oldest samples are dropped). */
const USAGE_LEDGER_CAP = 64;
/** Bounded cap for the anomaly ledger (oldest entries are dropped). */
const ANOMALY_LEDGER_CAP = 256;
/** Bounded cap for the in-process snapshot ledger (V2 receive port). */
const SNAPSHOT_LEDGER_CAP = 64;
/** Bounded cap for the in-process prefix-break ledger (V2 receive port). */
const BREAK_LEDGER_CAP = 64;
/** Bounded cap for the non-durable captured-attempt-usage ledger (V2 receive port). */
const CAPTURE_LEDGER_CAP = 64;
/** Bounded cap for the wire-domain ledger (V5 receive port, same 64-cap design). */
const WIRE_LEDGER_CAP = 64;
/** Bounded cap for the S1 preflight calibration ledger (V4 receive port, same 64-cap design). */
const PREFLIGHT_CALIBRATION_CAP = 64;
/**
* Bounded cap for the request/header chain (V1-B closure, R3 review: the
* chain was session-unbounded while every other ledger is capped). Same
* bounded design as the V2 64-cap ledgers; only the LAST header feeds the
* `change` comparison, and the chain digest reads the most recent 64 — older
* headers drop honestly at the cap. The observe listener's exemption window
* consumes resets by SEQ pointer (not index), so the resetLog cap below
* never mis-aligns it.
*/
const ROUTE_HEADER_LEDGER_CAP = 64;
/** Bounded cap for the cache-reset ledger (V1-B closure, same 64-cap design). */
const RESET_LEDGER_CAP = 64;
/**
* Consecutive-unreadable breaker for scanUpTo (P3 SM-03): a mock/corrupt
* host can claim an enormous `session.seq` while `eventAt` yields nothing —
* without a breaker the scan would loop toward that seq unbounded (the
* anomaly cap bounds LEDGER growth, not the LOOP). 16 consecutive unreadable
* slots abort the scan (fail-soft but bounded); the frontier stays where the
* run ended and the next feed event re-enters the scan from there.
*/
const SCAN_UNREADABLE_BREAKER = 16;
/** Narrow an unknown to a plain object record (V3 helpers' guard). */
function isRecord$1(value) {
	return value !== null && typeof value === "object";
}
/** The value as a finite number, else undefined (honest absence). */
function finiteNumber(value) {
	return typeof value === "number" && Number.isFinite(value) ? value : void 0;
}
/**
* Pull the message object out of an event's data payload. Structural twin of
* the extractor in materialize.ts (kept local so the W2 pure core stays
* untouched): tolerates the `{ turn, message }` envelope and bare
* message-shaped payloads.
*/
function extractMessage(data) {
	if (data === null || typeof data !== "object") return void 0;
	const record = data;
	if (record.message !== null && typeof record.message === "object") return record.message;
	if (record.content !== void 0) return record;
}
/** Join the text blocks of a message payload (string content tolerated). */
function extractMessageText(data) {
	const message = extractMessage(data);
	if (message === void 0) return "";
	const content = message.content;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	const parts = [];
	for (const block of content) if (block !== null && typeof block === "object") {
		const candidate = block;
		if (candidate.type === "text" && typeof candidate.text === "string") parts.push(candidate.text);
	}
	return parts.join("\n");
}
/** Provider-issued tool-call ids embedded in an assistant message. */
function extractToolCallIds(data) {
	const message = extractMessage(data);
	if (message === void 0 || !Array.isArray(message.content)) return [];
	const ids = [];
	for (const block of message.content) if (block !== null && typeof block === "object") {
		const candidate = block;
		if (candidate.type === "tool-call" && typeof candidate.id === "string") ids.push(candidate.id);
	}
	return ids;
}
/** Tool-result pairing: the assistant call id this result answers. */
function extractAnswersCallId(data) {
	const message = extractMessage(data);
	if (message === void 0) return void 0;
	if (typeof message.toolCallId === "string") return message.toolCallId;
	const source = message.source;
	if (source !== null && typeof source === "object") {
		const callId = source.callId;
		if (typeof callId === "string") return callId;
	}
}
/** message.source?.kind of a message event, when present. */
function extractSourceKind(data) {
	const message = extractMessage(data);
	if (message === void 0) return void 0;
	const source = message.source;
	if (source !== null && typeof source === "object") {
		const kind = source.kind;
		if (typeof kind === "string") return kind;
	}
}
/**
* Extract the frozen checkpoint payload of a zctx fold/unfold event.
*
* Amount fields (`tokensBefore`/`tokensAfter`) follow the extractUsageRecord
* twin (P3 SM-02, the store.ts Number.isFinite precedent): a value is
* accepted only when it is a FINITE NON-NEGATIVE number — ±Infinity/NaN and
* negatives are rejected (field dropped, reported in `droppedAmounts` so the
* caller records an anomaly; the ledger lands the `?? 0` default). A poisoned
* amount used to flow straight into the breakeven report, where budget
* assertAmount made every later zctx_status throw with no self-heal — the
* ledger's "honest ledger, no throwing" contract starts at ingestion.
*/
function extractCheckpointSource(data) {
	const kind = extractSourceKind(data);
	if (kind !== "zctx-fold" && kind !== "zctx-unfold") return void 0;
	const source = extractMessage(data)?.source;
	if (source === null || typeof source !== "object") return void 0;
	const record = source;
	const foldId = record.foldId;
	if (typeof foldId !== "string") return void 0;
	const validAmount = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0;
	const tokensBefore = validAmount(record.tokensBefore) ? record.tokensBefore : void 0;
	const tokensAfter = validAmount(record.tokensAfter) ? record.tokensAfter : void 0;
	const droppedAmounts = ["tokensBefore", "tokensAfter"].filter((field) => typeof record[field] === "number" && !validAmount(record[field]));
	return {
		kind,
		foldId,
		...tokensBefore !== void 0 ? { tokensBefore } : {},
		...tokensAfter !== void 0 ? { tokensAfter } : {},
		...droppedAmounts.length > 0 ? { droppedAmounts } : {}
	};
}
/**
* Extract one usage record from an assistant/message payload (S6 upgraded to
* the V1 route-two UsageRecord: full token fields + three-state grade). The
* official event data carries `usage?: TokenUsage` with inputTokens/
* outputTokens/totalTokens?/cacheReadTokens/cacheWriteTokens, DISJOINT
* accounting (input = un-cached only; llm/src/types.ts:166-189). Field
* absence is honest absence — a missing field is NOT rewritten to 0
* (RES-observe-route §Q2.3: 0 值与缺席同形，不得反推).
*/
function extractUsageRecord(data, seq) {
	if (data !== null && typeof data === "object") {
		const usage = data.usage;
		if (usage !== null && typeof usage === "object") {
			const record = usage;
			const read = record.cacheReadTokens;
			const write = record.cacheWriteTokens;
			const input = record.inputTokens;
			const output = record.outputTokens;
			const total = record.totalTokens;
			return {
				seq,
				measured: true,
				state: "measured",
				...typeof input === "number" && Number.isFinite(input) ? { inputTokens: input } : {},
				...typeof output === "number" && Number.isFinite(output) ? { outputTokens: output } : {},
				...typeof total === "number" && Number.isFinite(total) ? { totalTokens: total } : {},
				...typeof read === "number" && Number.isFinite(read) ? { cacheReadTokens: read } : {},
				...typeof write === "number" && Number.isFinite(write) ? { cacheWriteTokens: write } : {}
			};
		}
	}
	return {
		seq,
		measured: false,
		state: "estimated"
	};
}
/**
* Element-wise `stop` list equality (the tail of the official callConfigEquals,
* call-config.ts:75-77): undefined equals only undefined, otherwise length +
* every element.
*/
function stopEquals(a, b) {
	if (a === void 0 || b === void 0) return a === b;
	return a.length === b.length && a.every((s, i) => s === b[i]);
}
/**
* Local field-wise equality over LlmCallConfigLike — the same semantics as
* the official `callConfigEquals` (call-config.ts:67-77, a `@deepseek-ai/dsh-llm`
* public export): provider/model/reasoningEffort/temperature/maxTokens by
* identity, `stop` element-wise with length. Kept LOCAL because the store is
* duck-typed with zero host runtime imports (V1 constraint: 探针是脚本级，
* src 内宿主类型仍 duck-typing); scripts/probe-host-imports.mjs G4 pins the
* official export's live semantics so the twins stay aligned. If the host
* contract ever drifts, the probe's import face changes and the pin breaks.
*
* Known theoretical boundary (V1-A closure: pinned, not "fixed"): the official
* comparison uses raw `===`, where `NaN === NaN` is false (two configs
* carrying NaN in the same field compare NOT-equal); the local extraction
* (`extractCallConfig`) drops non-finite numerics at the door, so two such
* configs both compare as `(absent)` here — EQUAL where the official twin
* would say DIFFERENT. The case is unreachable on the official wire (the
* host rejects/normalizes non-finite controls before dispatch — a header
* snapshot never carries NaN), so the twin keeps the honest fail-soft
* extraction and store-observe.spec pins the divergence explicitly.
*/
function callConfigEquals(a, b) {
	return a.provider === b.provider && a.model === b.model && a.reasoningEffort === b.reasoningEffort && a.temperature === b.temperature && a.maxTokens === b.maxTokens && stopEquals(a.stop, b.stop);
}
/** Render one optional config scalar for evidence text ('' when absent). */
function configScalarText(value) {
	return value === void 0 ? "(absent)" : String(value);
}
/** Key-sorted structural clone for deterministic JSON comparison (the V1
* local twin of the stableStringify the V2 hash件 builds; compare-only). */
function stableValue(value) {
	if (Array.isArray(value)) return value.map((entry) => stableValue(entry));
	if (value !== null && typeof value === "object") {
		const record = value;
		const out = {};
		for (const key of Object.keys(record).sort()) out[key] = stableValue(record[key]);
		return out;
	}
	return value;
}
/** Deterministic structural comparison of two tool-schema arrays. */
function toolsEquals(a, b) {
	if (a === void 0 || b === void 0) return a === b;
	if (a.length !== b.length) return false;
	return JSON.stringify(stableValue(a)) === JSON.stringify(stableValue(b));
}
/** Extract the call config of a request/header payload (LlmCallConfig shape,
* call-config.ts:36-41). provider/model are required strings; everything
* else degrades to absent when malformed. */
function extractCallConfig(value) {
	if (value === null || typeof value !== "object") return void 0;
	const record = value;
	if (typeof record.provider !== "string" || typeof record.model !== "string") return void 0;
	return {
		provider: record.provider,
		model: record.model,
		...typeof record.reasoningEffort === "string" ? { reasoningEffort: record.reasoningEffort } : {},
		...typeof record.temperature === "number" && Number.isFinite(record.temperature) ? { temperature: record.temperature } : {},
		...typeof record.maxTokens === "number" && Number.isFinite(record.maxTokens) ? { maxTokens: record.maxTokens } : {},
		...Array.isArray(record.stop) && record.stop.every((s) => typeof s === "string") ? { stop: record.stop } : {}
	};
}
/** Extract the adapter-defaults marker object (call-config.ts:55-60). */
function extractAdapterDefaults(value) {
	if (value === null || typeof value !== "object") return void 0;
	const record = value;
	const reasoningEffort = record.reasoningEffort === true ? true : void 0;
	const maxTokens = record.maxTokens === true ? true : void 0;
	if (reasoningEffort === void 0 && maxTokens === void 0) return void 0;
	return {
		...reasoningEffort !== void 0 ? { reasoningEffort } : {},
		...maxTokens !== void 0 ? { maxTokens } : {}
	};
}
/**
* Extract one RouteHeader from a request/header payload (official
* session/src/types.ts:388-395 + EpochHeader :270-281). Returns undefined
* when the structural minimum (config with provider/model + a known reason)
* is not met — the caller records an anomaly instead of guessing.
*/
function extractRequestHeader(data, seq) {
	if (data === null || typeof data !== "object") return void 0;
	const record = data;
	const header = record.header;
	if (header === null || typeof header !== "object") return void 0;
	const headerRecord = header;
	const config = extractCallConfig(headerRecord.config);
	if (config === void 0) return void 0;
	const reason = record.reason;
	if (reason !== "initial" && reason !== "resume" && reason !== "change" && reason !== "series") return;
	const adapterDefaults = extractAdapterDefaults(headerRecord.adapterDefaults);
	const tools = Array.isArray(headerRecord.tools) ? headerRecord.tools : void 0;
	const startsSeries = record.startsSeries === true ? true : void 0;
	return {
		config,
		...adapterDefaults !== void 0 ? { adapterDefaults } : {},
		...tools !== void 0 ? { tools } : {},
		reason,
		...startsSeries !== void 0 ? { startsSeries } : {},
		seq
	};
}
/**
* Field-level comparison of a 'change' header against its predecessor — the
* V1 reset classification the card freezes (a.2 item 1: callConfigEquals
* 字段级对比 → modelChange/toolsetChange/采样变更类 ResetEvent). One entry per
* DIFFERING CATEGORY (routing / toolset / sampling), evidence names the
* changed fields. The tools comparison is structural (sorted-key JSON), the
* config comparison is the local callConfigEquals twin.
*/
function headerChangeResets(prev, next) {
	const resets = [];
	if (!callConfigEquals(prev.config, next.config)) {
		const routing = [];
		const sampling = [];
		const a = prev.config;
		const b = next.config;
		if (a.provider !== b.provider) routing.push(`provider ${a.provider}→${b.provider}`);
		if (a.model !== b.model) routing.push(`model ${a.model}→${b.model}`);
		if (a.reasoningEffort !== b.reasoningEffort) routing.push(`reasoningEffort ${configScalarText(a.reasoningEffort)}→${configScalarText(b.reasoningEffort)}`);
		if (a.temperature !== b.temperature) sampling.push(`temperature ${configScalarText(a.temperature)}→${configScalarText(b.temperature)}`);
		if (a.maxTokens !== b.maxTokens) sampling.push(`maxTokens ${configScalarText(a.maxTokens)}→${configScalarText(b.maxTokens)}`);
		if (!stopEquals(a.stop, b.stop)) sampling.push(`stop ${JSON.stringify(a.stop ?? null)}→${JSON.stringify(b.stop ?? null)}`);
		if (routing.length > 0) resets.push({
			kind: "model-change",
			evidence: `request/header change: ${routing.join("; ")}`
		});
		if (sampling.length > 0) resets.push({
			kind: "sampling-change",
			evidence: `request/header change: ${sampling.join("; ")}`
		});
	}
	if (!toolsEquals(prev.tools, next.tools)) {
		const prevCount = prev.tools === void 0 ? "none" : String(prev.tools.length);
		const nextCount = next.tools === void 0 ? "none" : String(next.tools.length);
		resets.push({
			kind: "toolset-change",
			evidence: `request/header change: tools schema diff (${prevCount}→${nextCount} schemas)`
		});
	}
	return resets;
}
var FoldStore = class {
	session;
	eventsBySeq = /* @__PURE__ */ new Map();
	ledger = /* @__PURE__ */ new Map();
	/** Bounded usage-record ledger (V1 UsageRecord; oldest dropped at cap). */
	usageLedger = [];
	/** Durable-ledger sink (optional; injected by the plugin's storeFor factory). */
	ledgerSink;
	sessionId;
	measuredSamples = 0;
	unmeasuredSamples = 0;
	/** Append-only request/header chain (oldest first). */
	routeHeaders = [];
	/** Append-only cache-reset ledger (oldest first). */
	resetLog = [];
	/** Bounded process-memory snapshot ledger (V2 receive port; never session-logged). */
	snapshotLog = [];
	/** Bounded process-memory prefix-break ledger (V2 receive port; never session-logged). */
	breakLog = [];
	/** Bounded non-durable captured-attempt-usage ledger (V2 receive port; never session-logged). */
	captureLog = [];
	/** Bounded wire-domain ledger (V5 receive port, same 64-cap design; never session-logged). */
	wireLog = [];
	/** Bounded S1 preflight calibration ledger (V4 receive port; never session-logged). */
	preflightLog = [];
	anomaliesLog = [];
	/** Fold-attribution ledger: foldId → its first-post-fold association (any quality). */
	foldAttributionLog = /* @__PURE__ */ new Map();
	/** Ascending seqs of every consumed event (window binary-search index). */
	eventSeqList = [];
	/** Ascending seqs of assistant/message events (repay-event detection input). */
	assistantMessageSeqs = [];
	/** Parallel arrays of turn/start markers (seqs + the turn they opened). */
	turnStartSeqs = [];
	turnStartTurns = [];
	/** Seq of the previous assistant/message (attribution candidate boundary). */
	lastAssistantMessageSeq = -1;
	/** Lifetime three-state counters (attach-scoped; cap-independent, §Q7.3). */
	threeState = {
		measured: 0,
		semi: 0,
		estimated: 0
	};
	/** Injected meter anchor for the `meterAnchored` semi path (§Q7.2 rule 2b). */
	meterAnchor;
	/** Config attributionTimeWindowMs (§Q4.2 rule 4 fallback; config-owned value). */
	attributionTimeWindowMs = configDefaults.attributionTimeWindowMs;
	compactionStartSeq;
	endSeedSeq;
	lastSeq = -1;
	/** The bound session, when attached. */
	get boundSession() {
		return this.session;
	}
	/** Highest seq the store has consumed (lastSeq + 1 == next expected). */
	get syncedToSeq() {
		return this.lastSeq + 1;
	}
	/**
	* Bind to one session and rebuild all state from a full scan (the blessed
	* resume restore). Resets every per-session view first.
	*/
	attach(session) {
		this.session = session;
		const sessionId = session?.id;
		this.sessionId = typeof sessionId === "string" ? sessionId : void 0;
		this.eventsBySeq.clear();
		this.ledger.clear();
		this.usageLedger.length = 0;
		this.measuredSamples = 0;
		this.unmeasuredSamples = 0;
		this.routeHeaders.length = 0;
		this.resetLog.length = 0;
		this.snapshotLog.length = 0;
		this.breakLog.length = 0;
		this.captureLog.length = 0;
		this.wireLog.length = 0;
		this.preflightLog.length = 0;
		this.anomaliesLog.length = 0;
		this.foldAttributionLog.clear();
		this.eventSeqList.length = 0;
		this.assistantMessageSeqs.length = 0;
		this.turnStartSeqs.length = 0;
		this.turnStartTurns.length = 0;
		this.lastAssistantMessageSeq = -1;
		this.threeState = {
			measured: 0,
			semi: 0,
			estimated: 0
		};
		this.compactionStartSeq = void 0;
		this.endSeedSeq = void 0;
		this.lastSeq = -1;
		this.scanUpTo(sessionSeq(session));
	}
	/**
	* Repair any feed gap: replay events from the store's frontier up to the
	* session's current end with bounded seq reads. No-op when in sync.
	*/
	resync() {
		if (this.session === void 0) return;
		const end = sessionSeq(this.session);
		if (end > this.syncedToSeq) this.scanUpTo(end);
	}
	/**
	* Consume one host-delivered event (the injected `session/event` callback).
	* Events from a foreign session are ignored; a gap triggers a bounded delta
	* repair first.
	*/
	onEvent(session, event) {
		if (this.session !== void 0 && session !== this.session) return;
		if (this.session === void 0) this.session = session;
		if (event === null || typeof event !== "object") return;
		const seq = event.seq;
		if (!Number.isFinite(seq) || !Number.isInteger(seq) || seq < 0) return;
		if (seq > this.syncedToSeq) {
			const end = sessionSeq(session);
			this.scanUpTo(Math.min(end, seq));
		}
		this.applyEvent(event);
	}
	/** Active folds keyed by foldId — the validator-facing FoldMap view. */
	get foldMap() {
		const map = /* @__PURE__ */ new Map();
		for (const [foldId, entry] of this.ledger) if (entry.status === "active") map.set(foldId, entry);
		return map;
	}
	/** Full ledger including non-active entries (status display / audit). */
	ledgerEntries() {
		return [...this.ledger.values()].sort((a, b) => a.checkpointSeq - b.checkpointSeq);
	}
	/** The retained immutable event at one seq, or undefined. */
	retainedEvent(seq) {
		return this.eventsBySeq.get(seq);
	}
	/** The joined text of the retained event at one seq ('' when unreadable). */
	eventText(seq) {
		const event = this.eventsBySeq.get(seq);
		return event === void 0 ? "" : extractMessageText(event.data);
	}
	/**
	* Ordered SurfaceNode view of the CURRENT surface. The live
	* `session.surface.nodes` is authoritative when present; otherwise the
	* surface is replayed locally from the retained log (structural mocks).
	*/
	surfaceNodes() {
		const session = this.session;
		if (session === void 0) return [];
		const liveNodes = session.surface?.nodes;
		const nodes = liveNodes !== void 0 ? [...liveNodes] : this.replaySurfaceNodes();
		const result = [];
		for (const seq of nodes) {
			const event = this.eventsBySeq.get(seq);
			result.push(this.toSurfaceNode(seq, event));
		}
		return result;
	}
	/** Surface node seqs whose event is not retained (fail-closed fold guard). */
	unreadableSurfaceSeqs() {
		const session = this.session;
		if (session === void 0) return [];
		const liveNodes = session.surface?.nodes;
		return (liveNodes !== void 0 ? [...liveNodes] : this.replaySurfaceNodes()).filter((seq) => !this.eventsBySeq.has(seq));
	}
	/** Aggregate usage state (S6). */
	usageSnapshot() {
		const latest = this.usageLedger[this.usageLedger.length - 1];
		return {
			samples: this.usageLedger.length,
			measuredSamples: this.measuredSamples,
			unmeasuredSamples: this.unmeasuredSamples,
			measured: this.measuredSamples > 0,
			...latest !== void 0 ? { latest } : {}
		};
	}
	/** The request/header chain, oldest first (V1 observability). */
	routeHeaderChain() {
		return [...this.routeHeaders];
	}
	/** The most recent cached header, when any (the compare base for 'change'). */
	lastRouteHeader() {
		return this.routeHeaders[this.routeHeaders.length - 1];
	}
	/** The cache-reset ledger, oldest first (V1 observability). */
	resetEvents() {
		return [...this.resetLog];
	}
	/** The in-process snapshot ledger, oldest first (bounded; oldest dropped). */
	requestSnapshots() {
		return [...this.snapshotLog];
	}
	/** The most recent request snapshot, when any (the listener's comparison baseline). */
	lastRequestSnapshot() {
		return this.snapshotLog[this.snapshotLog.length - 1];
	}
	/** The harness-domain prefix-break ledger, oldest first (bounded; oldest dropped). */
	prefixBreakEvents() {
		return [...this.breakLog];
	}
	/** The non-durable captured-attempt-usage ledger, oldest first (bounded; oldest dropped). */
	capturedAttemptUsage() {
		return [...this.captureLog];
	}
	/**
	* Snapshot sink: append one request snapshot to the process-memory ledger
	* and, when the listener detected a prefix break against the previous
	* snapshot, the classified break record next to it. The listener computes
	* the break (the hash件 lives in observe.ts); the store only receives.
	*/
	absorbRequestSnapshot(snapshot, breakRecord) {
		if (this.snapshotLog.length >= SNAPSHOT_LEDGER_CAP) this.snapshotLog.shift();
		this.snapshotLog.push(snapshot);
		if (breakRecord !== void 0) {
			if (this.breakLog.length >= BREAK_LEDGER_CAP) this.breakLog.shift();
			this.breakLog.push(breakRecord);
		}
	}
	/**
	* Non-durable capture sink: append one failed attempt's observed usage
	* (observe.attemptCapture face). The record dies with the process by
	* design; the ledger is only bounded memory.
	*/
	absorbCapturedAttemptUsage(record) {
		if (this.captureLog.length >= CAPTURE_LEDGER_CAP) this.captureLog.shift();
		this.captureLog.push(record);
	}
	/**
	* Wire-domain receive port (V5): append one byte/object-level hash of a
	* zctx-route request. Observation-only by construction — the producer
	* (adapter/wire.ts) never rewrites a payload (R1). Same 64-cap design as
	* the V2 ledgers; never session-logged.
	*/
	absorbWireSnapshot(snapshot) {
		if (this.wireLog.length >= WIRE_LEDGER_CAP) this.wireLog.shift();
		this.wireLog.push(snapshot);
	}
	/** The bounded wire-domain ledger, oldest first (V5 receive port view). */
	wireSnapshots() {
		return [...this.wireLog];
	}
	/** The bounded S1 preflight calibration ledger, oldest first (V4 receive port). */
	preflightCalibrations() {
		return [...this.preflightLog];
	}
	/**
	* S1 preflight calibration sink (V4): append one estimate-vs-reality
	* record (preflightMode observe/enforce). Process-memory only, never
	* session-logged; the estimator error statistics zctx_status renders are
	* computed on demand from this ledger (card product 3 — the dataset that
	* decides when enforce is safe to promote, no-go condition 4).
	*/
	absorbPreflightCalibration(record) {
		if (this.preflightLog.length >= PREFLIGHT_CALIBRATION_CAP) this.preflightLog.shift();
		this.preflightLog.push(record);
	}
	/** The bounded usage-record ledger, oldest first (V1 observability). */
	usageRecords() {
		return [...this.usageLedger];
	}
	/**
	* Inject the meter anchor for the `meterAnchored` semi path (§Q7.2 rule 2b:
	* THROUGH INJECTION — the store never imports the host). Called once at
	* store creation by the plugin; `undefined` keeps every usage-less request
	* honestly 'estimated'.
	*/
	setMeterAnchor(anchor) {
		this.meterAnchor = anchor;
	}
	/**
	* Set the attribution time-window fallback from config
	* (attributionTimeWindowMs; never hardcoded — plan §3 threshold discipline).
	*/
	setAttributionTimeWindowMs(ms) {
		if (typeof ms === "number" && Number.isFinite(ms) && ms >= 0) this.attributionTimeWindowMs = ms;
	}
	/** The fold-attribution ledger (foldId → association), commit order. */
	foldAttributions() {
		return [...this.foldAttributionLog.values()];
	}
	/**
	* The aggregated observability snapshot for zctx_status (a.1 row 6): pure
	* aggregation over the store's ledger views (attribution.ts
	* buildObservabilitySnapshot). On-demand — status is user-invoked.
	*/
	observabilitySnapshot() {
		return buildObservabilitySnapshot({
			usageRecords: this.usageLedger,
			threeState: this.threeState,
			foldEntries: [...this.ledger.values()].map((entry) => ({
				foldId: entry.foldId,
				checkpointSeq: entry.checkpointSeq,
				tokensBefore: entry.tokensBefore,
				tokensAfter: entry.tokensAfter
			})),
			foldAttributions: [...this.foldAttributionLog.values()],
			resetEvents: this.resetLog,
			assistantMessageSeqs: [...this.assistantMessageSeqs]
		});
	}
	/** True while a `compaction/start` bracket is durably open (mutex). */
	compactionActive() {
		if (this.compactionStartSeq === void 0) return false;
		return this.endSeedSeq === void 0 || this.endSeedSeq < this.compactionStartSeq;
	}
	/** Record one anomaly in the bounded ledger (honest, never throws). */
	recordAnomaly(kind, detail, seq) {
		if (this.anomaliesLog.length >= ANOMALY_LEDGER_CAP) this.anomaliesLog.shift();
		this.anomaliesLog.push(seq === void 0 ? {
			kind,
			detail
		} : {
			seq,
			kind,
			detail
		});
	}
	/** Inject the durable-ledger sink (ZCTX-POLISH W1; optional, fail-soft). */
	setLedgerSink(sink) {
		this.ledgerSink = sink;
	}
	/** The anomaly ledger, oldest first. */
	anomalies() {
		return [...this.anomaliesLog];
	}
	/** Replay retained events up to `end` (exclusive) through seq reads. @internal */
	scanUpTo(end) {
		let unreadableRun = 0;
		for (let seq = this.syncedToSeq; seq < end; seq += 1) {
			const event = this.session?.eventAt?.(seq);
			if (event === void 0) {
				this.recordAnomaly("unreadable-event", `seq ${seq} not readable during scan`, seq);
				this.lastSeq = seq;
				unreadableRun += 1;
				if (unreadableRun >= SCAN_UNREADABLE_BREAKER) {
					this.recordAnomaly("scan-breaker-tripped", `${SCAN_UNREADABLE_BREAKER} consecutive unreadable slots ending at seq ${seq}; scan aborted (a later feed event re-enters the scan from here)`, seq);
					return;
				}
				continue;
			}
			unreadableRun = 0;
			this.applyEvent(event);
		}
	}
	/**
	* Apply one event to every derived view (scan and incremental paths share
	* this single transition, so attach scans, live feeds, and resync gaps
	* stay consistent by construction).
	*
	* Idempotency / monotonicity guard (P3 SM-01, AUD-state-machines §1): the
	* official feed delivers each seq exactly once in order, but a broken host
	* (or a mock direct-injection) may re-deliver a seq or send one below the
	* frontier. Re-running a transition would resurrect unfolded folds, reopen
	* compaction brackets, double-count usage, and roll `lastSeq` back into a
	* cascading rescan — so both malformed shapes are dropped with an anomaly
	* record (honest ledger, never throwing):
	*
	*   - a seq already retained in `eventsBySeq` is a TRUE duplicate → drop;
	*   - a fresh seq BELOW the frontier (`seq < lastSeq`) is an out-of-order
	*     delivery → drop (a full re-attach remains available to the caller via
	*     `attach`, which is the blessed rebuild path).
	*
	* A seq equal to `lastSeq` but not retained can exist legitimately — the
	* unreadable-event slot advanced `lastSeq` without retaining (scanUpTo) —
	* and is applied on first delivery.
	* @internal
	*/
	applyEvent(event) {
		if (this.eventsBySeq.has(event.seq)) {
			this.recordAnomaly("duplicate-event", `event seq ${event.seq} delivered more than once; re-apply suppressed`, event.seq);
			return;
		}
		if (event.seq < this.lastSeq) {
			this.recordAnomaly("out-of-order-event", `event seq ${event.seq} arrived below the frontier ${this.lastSeq}; dropped`, event.seq);
			return;
		}
		this.eventsBySeq.set(event.seq, event);
		this.eventSeqList.push(event.seq);
		this.lastSeq = event.seq;
		if (event.type === "request/header") this.applyRequestHeader(event);
		else if (event.type === "compaction/start") {
			this.compactionStartSeq = event.seq;
			this.recordReset("compaction", event.seq, "compaction/start bracket opened", event.time);
		} else if (event.type === "compaction/end") this.compactionStartSeq = void 0;
		else if (event.type === "session/end-seed") {
			this.endSeedSeq = event.seq;
			this.recordReset("session-recovery", event.seq, "session/end-seed generation boundary", event.time);
		} else if (event.type === "turn/start") {
			const turn = isRecord$1(event.data) ? finiteNumber(event.data.turn) : void 0;
			if (turn !== void 0) {
				this.turnStartSeqs.push(event.seq);
				this.turnStartTurns.push(turn);
			}
		}
		if (event.type === "assistant/message") this.applyAssistantMessage(event);
		const op = event.surfaceOp;
		if (op === void 0 || op === "append") return;
		this.classifyReplaceReset(event, op);
		const checkpoint = extractCheckpointSource(event.data);
		if (checkpoint === void 0) {
			this.shadowActiveCheckpoints(event, "dead");
			return;
		}
		if (checkpoint.kind === "zctx-unfold") {
			const entry = this.ledger.get(checkpoint.foldId);
			if (entry !== void 0 && entry.status === "active") {
				this.ledger.set(checkpoint.foldId, {
					...entry,
					status: "unfolded"
				});
				for (const [innerId, inner] of this.ledger) {
					if (innerId === checkpoint.foldId) continue;
					if (inner.status !== "active") continue;
					if (inner.checkpointSeq >= entry.startSeq && inner.checkpointSeq <= entry.endSeq) this.ledger.set(innerId, {
						...inner,
						status: "absorbed",
						shadowedBySeq: event.seq,
						shadowedByKind: "zctx-unfold-span"
					});
				}
			} else if (entry === void 0) this.recordAnomaly("unknown-fold-unfold", `zctx-unfold at seq ${event.seq} names unknown foldId "${checkpoint.foldId}"`, event.seq);
			return;
		}
		this.shadowActiveCheckpoints(event, "absorbed");
		if (checkpoint.droppedAmounts !== void 0) for (const field of checkpoint.droppedAmounts) this.recordAnomaly("invalid-checkpoint-amount", `zctx checkpoint at seq ${event.seq}: ${field} rejected (must be a finite non-negative number; field dropped to 0)`, event.seq);
		this.ledger.set(checkpoint.foldId, {
			foldId: checkpoint.foldId,
			startSeq: op.startSeq,
			endSeq: op.endSeq,
			checkpointSeq: event.seq,
			summaryText: extractMessageText(event.data),
			shadowedSeqs: [...event.sourceEventSeqs ?? []],
			tokensBefore: checkpoint.tokensBefore ?? 0,
			tokensAfter: checkpoint.tokensAfter ?? 0,
			status: "active"
		});
		try {
			this.ledgerSink?.recordFold({
				sessionId: this.sessionId ?? "",
				foldId: checkpoint.foldId,
				startSeq: op.startSeq,
				endSeq: op.endSeq,
				tokensBefore: checkpoint.tokensBefore ?? 0,
				tokensAfter: checkpoint.tokensAfter ?? 0,
				supply: checkpoint.kind ?? "zctx-fold",
				createdAt: Date.now()
			});
		} catch {}
	}
	/**
	* Consume one request/header event: cache the RouteHeader, then classify
	* resets — `reason:'resume'` is the sessionRecovery half-class signal
	* (RES-observe-route §Q6: restart/fork-seed boundary); `reason:'change'`
	* field-compares against the previous header (a.2 item 1). @internal
	*/
	applyRequestHeader(event) {
		const header = extractRequestHeader(event.data, event.seq);
		if (header === void 0) {
			this.recordAnomaly("unreadable-header", `request/header at seq ${event.seq} failed structural parse`, event.seq);
			return;
		}
		if (header.reason === "resume") this.recordReset("session-recovery", event.seq, "request/header reason='resume' (process restart / fork-seed boundary)", event.time);
		else if (header.reason === "series") this.recordReset("series-restart", event.seq, "request/header reason='series' (producer self-admitted message-series discontinuity)", event.time);
		else if (header.reason === "change" && this.lastRouteHeader() !== void 0) for (const reset of headerChangeResets(this.lastRouteHeader(), header)) this.recordReset(reset.kind, event.seq, reset.evidence, event.time);
		if (this.routeHeaders.length >= ROUTE_HEADER_LEDGER_CAP) this.routeHeaders.shift();
		this.routeHeaders.push(header);
	}
	/**
	* Classify ONE replace event into the reset ledger (card: surfaceOp
	* replace → microPrune / unknown-replace / mergeRewrite / systemSectionChange).
	* Order: our own checkpoints first (merge-rewrite regardless of any open
	* compaction bracket), then replaces inside an open official compaction
	* bracket are skipped (the compaction start already recorded the reset —
	* card qualifier 非 compaction 括号内), then system/message rewrites, then
	* the single-tool-result pruner shape, then the unknown-replace catch-all
	* (surfaceOp carries no producer identity, RES-observe-route §Q6 unresolved ①).
	* @internal
	*/
	classifyReplaceReset(event, op) {
		const checkpoint = extractCheckpointSource(event.data);
		if (checkpoint !== void 0) {
			this.recordReset("merge-rewrite", event.seq, `own checkpoint replace (${checkpoint.kind} ${checkpoint.foldId}, span ${op.startSeq}..${op.endSeq})`, event.time);
			return;
		}
		if (this.compactionActive()) return;
		if (event.type === "system/message") {
			this.recordReset("system-section-change", event.seq, `system/message rewrite over span ${op.startSeq}..${op.endSeq}`, event.time);
			return;
		}
		const startEvent = this.eventsBySeq.get(op.startSeq);
		if (event.sourceEventSeqs !== void 0 && event.sourceEventSeqs.length === 1 && startEvent !== void 0 && startEvent.type === "tool/result") {
			this.recordReset("micro-prune", event.seq, `tool/result node ${op.startSeq} rewritten in place (pruner shape; producer unattributable)`, event.time);
			return;
		}
		this.recordReset("unknown-replace", event.seq, `foreign replace producer (${event.type}) over span ${op.startSeq}..${op.endSeq}`, event.time);
	}
	/**
	* Append one reset ledger entry (evidence text is caller-owned). V1-B
	* closure: bounded ledger (oldest dropped). The observe listener's
	* exemption window consumes resets by SEQ pointer, so the shift never
	* mis-aligns it (store-observe spec pins 66→64).
	* @internal
	*/
	recordReset(kind, seq, evidence, time) {
		if (this.resetLog.length >= RESET_LEDGER_CAP) this.resetLog.shift();
		this.resetLog.push({
			kind,
			seq,
			...time !== void 0 ? { time } : {},
			evidence
		});
	}
	/** Demote active folds whose checkpoint is shadowed by this replace. @internal */
	shadowActiveCheckpoints(event, status) {
		const shadowed = event.sourceEventSeqs;
		if (shadowed === void 0 || shadowed.length === 0) return;
		const shadowedSet = new Set(shadowed);
		for (const [foldId, entry] of this.ledger) {
			if (entry.status !== "active") continue;
			if (!shadowedSet.has(entry.checkpointSeq)) continue;
			this.ledger.set(foldId, {
				...entry,
				status,
				shadowedBySeq: event.seq,
				shadowedByKind: extractSourceKind(event.data) ?? event.type
			});
		}
	}
	/**
	* One assistant/message: build the usage record, grade the semi paths, fill
	* the fold attribution (nearest preceding fold commit), then maintain the
	* lifetime three-state counters and the interpolated retro-upgrade.
	* Runs inside the shared applyEvent transition — attach scan, live feed,
	* and resync rebuilds all attribute identically by construction.
	* @internal
	*/
	applyAssistantMessage(event) {
		let record = extractUsageRecord(event.data, event.seq);
		if (!record.measured && this.meterAnchor !== void 0) {
			const anchor = this.tryMeterAnchor(event.seq);
			if (anchor !== void 0) record = {
				...record,
				state: "semi",
				semiKind: "meterAnchored",
				inputTokens: anchor
			};
		}
		const attribution = this.attributeMessage(event);
		if (attribution !== void 0) record = {
			...record,
			attribution
		};
		if (this.usageLedger.length >= USAGE_LEDGER_CAP) this.usageLedger.shift();
		this.usageLedger.push(record);
		try {
			if (record.measured) this.ledgerSink?.recordUsageTurn({
				sessionId: this.sessionId ?? "",
				seq: record.seq,
				measured: true,
				cacheReadTokens: record.cacheReadTokens,
				cacheWriteTokens: record.cacheWriteTokens,
				createdAt: Date.now()
			});
		} catch {}
		this.assistantMessageSeqs.push(event.seq);
		if (record.measured) {
			this.measuredSamples += 1;
			this.threeState = {
				...this.threeState,
				measured: this.threeState.measured + 1
			};
			this.upgradeInterpolatedBefore(event, record);
		} else {
			this.unmeasuredSamples += 1;
			this.threeState = record.state === "semi" ? {
				...this.threeState,
				semi: this.threeState.semi + 1
			} : {
				...this.threeState,
				estimated: this.threeState.estimated + 1
			};
		}
	}
	/**
	* Attribute one assistant/message against every fold commit since the
	* previous assistant/message (§Q4.2: F's target = the FIRST M after F —
	* folds before the previous message were already given their first M; later
	* steps after this message are 维持账, noise ③). The nearest candidate's
	* association binds the record (batch folds: the last commit before M is
	* the clean window; earlier commits carry another replace in theirs and
	* grade weak on their own associations).
	* @internal
	*/
	attributeMessage(event) {
		const data = isRecord$1(event.data) ? event.data : void 0;
		const messageTurn = data === void 0 ? void 0 : finiteNumber(data.turn);
		const messageStep = data === void 0 ? void 0 : finiteNumber(data.step);
		const interrupted = data?.interrupted === true;
		const previousMessageSeq = this.lastAssistantMessageSeq;
		this.lastAssistantMessageSeq = event.seq;
		if (messageTurn === void 0 || messageStep === void 0) {
			this.recordAnomaly("attribution-skipped", `assistant/message at seq ${event.seq} lacks the official turn/step envelope`, event.seq);
			return;
		}
		const messageTime = finiteNumber(event.time);
		let nearest;
		for (const entry of this.ledger.values()) {
			if (entry.checkpointSeq <= previousMessageSeq || entry.checkpointSeq >= event.seq) continue;
			const foldEvent = this.eventsBySeq.get(entry.checkpointSeq);
			const attribution = classifyFoldAttribution({
				foldId: entry.foldId,
				foldSeq: entry.checkpointSeq,
				...foldEvent !== void 0 && finiteNumber(foldEvent.time) !== void 0 ? { foldTime: foldEvent.time } : {},
				...this.turnOpenAt(entry.checkpointSeq) !== void 0 ? { foldTurn: this.turnOpenAt(entry.checkpointSeq) } : {},
				messageSeq: event.seq,
				...messageTime !== void 0 ? { messageTime } : {},
				messageTurn,
				messageStep,
				...interrupted ? { messageInterrupted: true } : {},
				windowEvents: this.windowEventsBetween(entry.checkpointSeq, event.seq),
				timeWindowMs: this.attributionTimeWindowMs
			});
			if (attribution !== void 0) {
				this.foldAttributionLog.set(entry.foldId, attribution);
				nearest = attribution;
			}
		}
		return nearest;
	}
	/** Fail-soft meter-anchor probe: a meter fault degrades to estimated. @internal */
	tryMeterAnchor(seq) {
		try {
			const anchor = this.meterAnchor?.inputAnchor(seq);
			return typeof anchor === "number" && Number.isFinite(anchor) && anchor > 0 ? anchor : void 0;
		} catch (error) {
			this.recordAnomaly("meter-anchor-failed", `meter anchor probe for seq ${seq} threw (${error instanceof Error ? error.message : String(error)})`, seq);
			return;
		}
	}
	/**
	* The `interpolated` semi path (§Q7.2 rule 2a): a measured anchor arrived;
	* usage-less estimated records EARLIER in the same turn — with no reset
	* entry between them and the anchor (conservative superset of "no
	* route/system-section change") — carry the anchor's input-side fields over
	* (absent stays absent, §Q2.3). Walking backwards stops at the first
	* measured record (its own arrival already upgraded what it could), a turn
	* change, an unknown turn, or a reset entry.
	* @internal
	*/
	upgradeInterpolatedBefore(anchorEvent, anchor) {
		if (anchor.inputTokens === void 0 && anchor.cacheReadTokens === void 0 && anchor.cacheWriteTokens === void 0) return;
		const anchorTurn = this.messageTurnAt(anchorEvent.seq);
		if (anchorTurn === void 0) return;
		for (let i = this.usageLedger.length - 2; i >= 0; i -= 1) {
			const candidate = this.usageLedger[i];
			if (candidate.state === "measured") break;
			if (candidate.state !== "estimated") continue;
			const candidateTurn = this.messageTurnAt(candidate.seq);
			if (candidateTurn === void 0 || candidateTurn !== anchorTurn) break;
			if (this.resetBetween(candidate.seq, anchorEvent.seq)) break;
			this.usageLedger[i] = {
				...candidate,
				state: "semi",
				semiKind: "interpolated",
				...anchor.inputTokens !== void 0 ? { inputTokens: anchor.inputTokens } : {},
				...anchor.cacheReadTokens !== void 0 ? { cacheReadTokens: anchor.cacheReadTokens } : {},
				...anchor.cacheWriteTokens !== void 0 ? { cacheWriteTokens: anchor.cacheWriteTokens } : {}
			};
			this.threeState = {
				...this.threeState,
				estimated: this.threeState.estimated - 1,
				semi: this.threeState.semi + 1
			};
		}
	}
	/** First index in eventSeqList whose seq is strictly above `seq`. @internal */
	firstIndexAbove(seq) {
		let lo = 0;
		let hi = this.eventSeqList.length;
		while (lo < hi) {
			const mid = lo + hi >> 1;
			if (this.eventSeqList[mid] <= seq) lo = mid + 1;
			else hi = mid;
		}
		return lo;
	}
	/** Retained events strictly between `from` and `to`, ascending. @internal */
	windowEventsBetween(from, to) {
		const start = this.firstIndexAbove(from);
		const end = this.firstIndexAbove(to - 1);
		const out = [];
		for (let i = start; i < end; i += 1) {
			const event = this.eventsBySeq.get(this.eventSeqList[i]);
			if (event !== void 0) out.push(event);
		}
		return out;
	}
	/** The turn open at `seq` (nearest turn/start at-or-before), when logged. @internal */
	turnOpenAt(seq) {
		let lo = 0;
		let hi = this.turnStartSeqs.length;
		let best = -1;
		while (lo < hi) {
			const mid = lo + hi >> 1;
			if (this.turnStartSeqs[mid] <= seq) {
				best = mid;
				lo = mid + 1;
			} else hi = mid;
		}
		return best >= 0 ? this.turnStartTurns[best] : void 0;
	}
	/** The `data.turn` of the retained event at one seq, when well-formed. @internal */
	messageTurnAt(seq) {
		const event = this.eventsBySeq.get(seq);
		if (event === void 0 || !isRecord$1(event.data)) return void 0;
		return finiteNumber(event.data.turn);
	}
	/**
	* True when a reset-ledger entry sits strictly between the two seqs — or
	* when the ledger is at its cap (V3-1: `RESET_LEDGER_CAP` eviction via
	* shift-and-push makes "no reset" unprovable, because an evicted entry may
	* have sat between the seqs; the walk stops conservatively instead of
	* upgrading across a possibly-evicted reset). @internal
	*/
	resetBetween(from, to) {
		if (this.resetLog.length >= RESET_LEDGER_CAP) return true;
		return this.resetLog.some((reset) => reset.seq > from && reset.seq < to);
	}
	/** Local surface replay from the retained log (fallback when no live surface). @internal */
	replaySurfaceNodes() {
		const nodes = [];
		for (let seq = 0; seq <= this.lastSeq; seq += 1) {
			const event = this.eventsBySeq.get(seq);
			if (event === void 0 || !MESSAGE_EVENT_TYPES.has(event.type)) continue;
			const op = event.surfaceOp;
			if (op === "append" || op === void 0) {
				nodes.push(event.seq);
				continue;
			}
			const startIdx = nodes.indexOf(op.startSeq);
			const endIdx = nodes.indexOf(op.endSeq);
			if (startIdx === -1 || endIdx === -1 || startIdx > endIdx) continue;
			nodes.splice(startIdx, endIdx - startIdx + 1, event.seq);
		}
		return nodes;
	}
	/** Build one SurfaceNode from a retained event. @internal */
	toSurfaceNode(seq, event) {
		if (event === void 0) return {
			seq,
			type: "unknown",
			role: "unknown",
			estimatedTokens: 0,
			isUser: false,
			textLength: 0
		};
		const role = ROLE_BY_TYPE[event.type] ?? "unknown";
		const text = extractMessageText(event.data);
		const sourceKind = extractSourceKind(event.data);
		return {
			seq,
			type: event.type,
			role,
			estimatedTokens: estimateTokens(text),
			isUser: role === "user",
			textLength: text.length,
			...role === "assistant" ? { toolCallIds: extractToolCallIds(event.data) } : {},
			...role === "tool" ? { answersCallId: extractAnswersCallId(event.data) } : {},
			...sourceKind !== void 0 ? { sourceKind } : {}
		};
	}
};
/** Read the session's next seq through the structural contract. @internal */
function sessionSeq(session) {
	const seq = session.seq;
	return typeof seq === "number" && Number.isFinite(seq) && seq >= 0 ? seq : 0;
}
// src/fold-engine.ts
/**
* Fold engine — the commit orchestrator over the official surface replace
* channel (task card W3 §2).
*
* `fold()` validates ONE fold window (W2 validator, foldMap from the store),
* checks the durable compaction mutex, snapshots the surface generations,
* then commits each summary block of the acceptance plan as its own
* `user/message` checkpoint with `surfaceOp: replace` over its subrange
* (disjoint subranges keep every shadowed set exactly the live surface set),
* and verifies the generation counters afterwards — a mismatch is recorded
* as an anomaly and reported, never thrown (fail-soft contract). Checkpoint
* payloads are the official BARE UserMessage (`'user/message': UserMessage`,
* session/src/types.ts:309; `deriveEventMessage` returns the data verbatim,
* surface.ts:132-134; official producers commit bare messages —
* compaction region.ts:506-508, agent-loop agent.ts:435) — no envelope.
*
* `unfold()` re-materializes one active fold in the B1 single-node form
* (plan §3): the checkpoint node is replaced by ONE user message whose
* content is the ordered text-block list produced by `materializeRange`
* (multi-block W2 artifact), with `source.kind: 'zctx-unfold'`.
*
* Read discipline (official synchronous-read decision): the engine reads
* session state only through live, non-deprecated getters (`seq`,
* `surface.*`) and delegates event-payload reads to the store's retained
* copy, which is restored once at `attach` and maintained from the
* `session/event` feed (`resync()` repairs bounded feed gaps).
*
* CCM §1.1 window gate (engine layer, distinct from the budget F1
* degenerate-window guard): `ccmWindowGate` reports windows below the 32768
* legal domain. The gate disables the AUTOMATIC folding face only — manual
* tool folds stay validator-gated and usable — and `zctx_status` surfaces the
* the degraded note.
*
* Zero host imports; append failures are caught and reported honestly.
*
* @module fold-engine
*/
/** CCM §1.1 legal-domain floor: windows below this reject automatic folding. */
const CCM_MIN_CONTEXT_WINDOW = 32768;
/**
* Engine-layer CCM §1.1 gate. An unknown window cannot be judged (no claim);
* a window below 32768 is out of the legal domain: the automatic folding face
* is disabled while tools remain available. This is a POLICY layer above the
* budget F1 structural degeneracy guard (W below the reserve structure); the
* two layers are not interchangeable.
*/
function ccmWindowGate(contextWindow) {
	if (contextWindow === void 0 || !Number.isFinite(contextWindow)) return { legal: true };
	if (contextWindow >= 32768) return { legal: true };
	return {
		legal: false,
		note: fill("context window {{window}} is below the CCM legal domain (W >= {{min}}): automatic folding is disabled, tools remain usable", {
			window: contextWindow,
			min: CCM_MIN_CONTEXT_WINDOW
		})
	};
}
/** Assert the structural shape the engine commits through. @internal */
function assertSessionWritable(sessionLike) {
	if (sessionLike === null || typeof sessionLike !== "object") throw new TypeError("fold-engine: sessionLike must be an object");
	if (typeof sessionLike.append !== "function") throw new TypeError("fold-engine: sessionLike must expose append(type, data, opts)");
	if (typeof sessionLike.seq !== "number" || !Number.isFinite(sessionLike.seq)) throw new TypeError("fold-engine: sessionLike must expose its next seq");
}
/**
* Read one generation snapshot off the live surface (optional members are
* skipped honestly when the session exposes no counters).
* @internal
*/
function snapshotGenerations(sessionLike) {
	const surface = sessionLike.surface;
	if (surface === void 0) return {};
	const replace = surface.replaceGeneration;
	const content = surface.contentGeneration;
	return {
		...typeof replace === "number" ? { replaceGeneration: replace } : {},
		...typeof content === "number" ? { contentGeneration: content } : {}
	};
}
/**
* Commit one fold submission (see module header). Throws TypeError only on
* structurally malformed input (programmer error); every semantic failure —
* validation rejection, active compaction, session append rejection — comes
* back as a `{ ok: false, reasons }` result, and post-commit anomalies are
* reported, not thrown.
*/
function fold(sessionLike, store, submission, config) {
	assertSessionWritable(sessionLike);
	if (!(store instanceof FoldStore)) throw new TypeError("fold-engine: store must be a FoldStore");
	const anomalies = [];
	store.resync();
	const unreadable = store.unreadableSurfaceSeqs();
	if (unreadable.length > 0) return {
		ok: false,
		reasons: [fill(REASON_UNREADABLE_SURFACE, { seqs: unreadable.join(", ") })],
		committed: [],
		anomalies
	};
	const surfaceNodes = store.surfaceNodes();
	const foldMap = store.foldMap;
	const validation = validateFold({
		foldMap,
		surfaceNodes,
		range: submission.range,
		summaries: submission.summaries,
		config
	});
	if (!validation.ok) return {
		ok: false,
		reasons: [...validation.reasons],
		committed: [],
		anomalies
	};
	const plan = validation.plan;
	const subrangeReasons = subrangePairReasons(surfaceNodes, plan.folds);
	if (subrangeReasons.length > 0) return {
		ok: false,
		reasons: subrangeReasons,
		committed: [],
		anomalies
	};
	if (store.compactionActive()) return {
		ok: false,
		reasons: [REASON_COMPACTION_ACTIVE],
		committed: [],
		anomalies
	};
	const before = snapshotGenerations(sessionLike);
	const committed = [];
	let rejected;
	for (const entry of plan.folds) {
		const shadowed = surfaceNodes.filter((n) => n.seq >= entry.startSeq && n.seq <= entry.endSeq).map((n) => n.seq);
		const tokensBefore = shadowed.length > 0 ? surfaceNodes.filter((n) => n.seq >= entry.startSeq && n.seq <= entry.endSeq).reduce((sum, n) => sum + n.estimatedTokens, 0) : 0;
		const tokensAfter = estimateTokens(entry.summaryText);
		const nextSeq = sessionLike.seq;
		if (typeof nextSeq !== "number" || !Number.isFinite(nextSeq) || nextSeq < 0) {
			rejected = REASON_SESSION_SEQ_MISSING;
			break;
		}
		const foldId = `f${nextSeq}`;
		try {
			const event = sessionLike.append("user/message", {
				id: randomUUID(),
				role: "user",
				content: [{
					type: "text",
					text: entry.summaryText
				}],
				source: {
					kind: "zctx-fold",
					foldId,
					tokensBefore,
					tokensAfter
				}
			}, {
				surfaceOp: {
					op: "replace",
					startSeq: entry.startSeq,
					endSeq: entry.endSeq
				},
				sourceEventSeqs: shadowed
			});
			committed.push({
				foldId,
				checkpointSeq: event.seq,
				startSeq: entry.startSeq,
				endSeq: entry.endSeq,
				shadowedSeqs: shadowed,
				tokensBefore,
				tokensAfter
			});
		} catch (error) {
			const detail = error instanceof Error ? error.message : String(error);
			store.recordAnomaly("append-rejected", `fold ${foldId}: ${detail}`);
			anomalies.push({
				kind: "append-rejected",
				detail: `fold ${foldId}: ${detail}`
			});
			rejected = fill(REASON_COMMIT_REJECTED, {
				start: entry.startSeq,
				end: entry.endSeq,
				detail
			});
			break;
		}
	}
	if (committed.length === 0) return {
		ok: false,
		reasons: [rejected ?? "the fold commit failed before any checkpoint landed"],
		committed,
		anomalies
	};
	verifyPostCommit(sessionLike, store, committed, before, snapshotGenerations(sessionLike), anomalies);
	store.resync();
	if (rejected !== void 0) return {
		ok: false,
		reasons: [rejected, fill(FOLD_REPLY_PARTIAL, {
			committed: committed.length,
			total: plan.folds.length
		})],
		committed,
		anomalies
	};
	return {
		ok: true,
		plan,
		committed,
		anomalies
	};
}
/**
* Unfold one active fold (B1 single-node form): the checkpoint node is
* replaced by ONE user message carrying the re-materialized text blocks of
* the original span. Same fail-soft discipline as `fold`.
*/
function unfold(sessionLike, store, foldId) {
	assertSessionWritable(sessionLike);
	if (!(store instanceof FoldStore)) throw new TypeError("fold-engine: store must be a FoldStore");
	if (typeof foldId !== "string" || foldId.length === 0) throw new TypeError("fold-engine: foldId must be a non-empty string");
	const anomalies = [];
	store.resync();
	const unreadable = store.unreadableSurfaceSeqs();
	if (unreadable.length > 0) return {
		ok: false,
		reasons: [fill(REASON_UNREADABLE_SURFACE, { seqs: unreadable.join(", ") })],
		committed: [],
		anomalies
	};
	const entry = store.foldMap.get(foldId);
	if (entry === void 0) {
		const ledgerEntry = store.ledgerEntries().find((e) => e.foldId === foldId);
		if (ledgerEntry !== void 0) return {
			ok: false,
			reasons: [fill(REASON_FOLD_NOT_ACTIVE, {
				foldId,
				status: ledgerEntry.status
			})],
			committed: [],
			anomalies
		};
		return {
			ok: false,
			reasons: [fill(REASON_FOLD_NOT_FOUND, { foldId })],
			committed: [],
			anomalies
		};
	}
	if (!store.surfaceNodes().map((n) => n.seq).includes(entry.checkpointSeq)) return {
		ok: false,
		reasons: [fill(REASON_CHECKPOINT_GONE, {
			foldId,
			seq: entry.checkpointSeq
		})],
		committed: [],
		anomalies
	};
	if (store.compactionActive()) return {
		ok: false,
		reasons: [REASON_COMPACTION_ACTIVE],
		committed: [],
		anomalies
	};
	const before = snapshotGenerations(sessionLike);
	const blocks = materializeRange({ eventAt: (seq) => store.retainedEvent(seq) }, store.foldMap, entry.startSeq, entry.endSeq);
	const tokensBefore = estimateTokens(entry.summaryText);
	const tokensAfter = blocks.reduce((sum, block) => sum + estimateTokens(block.text), 0);
	try {
		const committed = [{
			foldId,
			checkpointSeq: sessionLike.append("user/message", {
				id: randomUUID(),
				role: "user",
				content: blocks,
				source: {
					kind: "zctx-unfold",
					foldId,
					tokensBefore,
					tokensAfter
				}
			}, {
				surfaceOp: {
					op: "replace",
					startSeq: entry.checkpointSeq,
					endSeq: entry.checkpointSeq
				},
				sourceEventSeqs: [entry.checkpointSeq]
			}).seq,
			startSeq: entry.checkpointSeq,
			endSeq: entry.checkpointSeq,
			shadowedSeqs: [entry.checkpointSeq],
			tokensBefore,
			tokensAfter,
			blocks: blocks.length
		}];
		verifyPostCommit(sessionLike, store, committed, before, snapshotGenerations(sessionLike), anomalies);
		store.resync();
		return {
			ok: true,
			committed,
			anomalies
		};
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		store.recordAnomaly("append-rejected", `unfold ${foldId}: ${detail}`);
		anomalies.push({
			kind: "append-rejected",
			detail: `unfold ${foldId}: ${detail}`
		});
		return {
			ok: false,
			reasons: [fill(REASON_UNFOLD_REJECTED, {
				foldId,
				detail
			})],
			committed: [],
			anomalies
		};
	}
}
/**
* Post-commit verification (fail-soft): replace/content generation deltas and
* checkpoint membership on the live surface. Mismatches are recorded in the
* store anomaly ledger and echoed in the result — never thrown.
* @internal
*/
function verifyPostCommit(sessionLike, store, committed, before, after, anomalies) {
	if (before.replaceGeneration !== void 0 && after.replaceGeneration !== void 0) {
		const delta = after.replaceGeneration - before.replaceGeneration;
		if (delta !== committed.length) {
			const detail = `surface replaceGeneration advanced by ${delta}, expected ${committed.length}`;
			store.recordAnomaly("generation-mismatch", detail);
			anomalies.push({
				kind: "generation-mismatch",
				detail
			});
		}
	}
	if (before.contentGeneration !== void 0 && after.contentGeneration !== void 0) {
		const delta = after.contentGeneration - before.contentGeneration;
		if (delta !== committed.length) {
			const detail = `surface contentGeneration advanced by ${delta}, expected ${committed.length}`;
			store.recordAnomaly("generation-mismatch", detail);
			anomalies.push({
				kind: "generation-mismatch",
				detail
			});
		}
	}
	const liveNodes = new Set(sessionLike.surface?.nodes ?? []);
	for (const commit of committed) if (!liveNodes.has(commit.checkpointSeq)) {
		const detail = `checkpoint seq ${commit.checkpointSeq} is not on the live surface after commit`;
		store.recordAnomaly("node-missing", detail, commit.checkpointSeq);
		anomalies.push({
			kind: "node-missing",
			detail,
			seq: commit.checkpointSeq
		});
	}
}
/**
* Tool-pair closure over each COMMIT UNIT (plan entry subrange): every tool
* call requested by an assistant node inside the subrange must be answered by
* a tool node inside the same subrange, and every answered tool node inside
* must have its requesting assistant inside. Unknown pairing inside a
* subrange fails closed (mirrors the validator's fail-closed rule at the
* commit-unit level).
* @internal
*/
function subrangePairReasons(surfaceNodes, folds) {
	const assistantByCallId = /* @__PURE__ */ new Map();
	const toolByCallId = /* @__PURE__ */ new Map();
	for (const node of surfaceNodes) {
		if (node.role === "assistant" && node.toolCallIds !== void 0) for (const callId of node.toolCallIds) assistantByCallId.set(callId, node);
		if (node.role === "tool" && node.answersCallId !== void 0) toolByCallId.set(node.answersCallId, node);
	}
	const reasons = [];
	for (const entry of folds) {
		const inRange = surfaceNodes.filter((n) => n.seq >= entry.startSeq && n.seq <= entry.endSeq);
		for (const node of inRange) {
			if (node.role === "assistant") {
				if (node.toolCallIds === void 0) {
					reasons.push(fill(REASON_SUBRANGE_TOOL_SPLIT, {
						start: entry.startSeq,
						end: entry.endSeq,
						callId: `at seq ${node.seq}`,
						otherSeq: node.seq
					}));
					continue;
				}
				for (const callId of node.toolCallIds) {
					const tool = toolByCallId.get(callId);
					if (tool !== void 0 && (tool.seq < entry.startSeq || tool.seq > entry.endSeq)) reasons.push(fill(REASON_SUBRANGE_TOOL_SPLIT, {
						start: entry.startSeq,
						end: entry.endSeq,
						callId,
						otherSeq: tool.seq
					}));
				}
			}
			if (node.role === "tool") {
				if (node.answersCallId === void 0) {
					reasons.push(fill(REASON_SUBRANGE_TOOL_SPLIT, {
						start: entry.startSeq,
						end: entry.endSeq,
						callId: `result at seq ${node.seq}`,
						otherSeq: node.seq
					}));
					continue;
				}
				const assistant = assistantByCallId.get(node.answersCallId);
				if (assistant !== void 0 && (assistant.seq < entry.startSeq || assistant.seq > entry.endSeq)) reasons.push(fill(REASON_SUBRANGE_TOOL_SPLIT, {
					start: entry.startSeq,
					end: entry.endSeq,
					callId: node.answersCallId,
					otherSeq: assistant.seq
				}));
			}
		}
	}
	return reasons;
}
/**
* Compute the foldable-span rows over the current surface: maximal runs of
* consecutive surface nodes, split at every protected node. Protected nodes
* mirror the validator's protected zones exactly — surface node 0, the pinned
* first user message, the latest user message, and the recent tail
* (last keepRecentMessages messages and the last
* max(keepRecentTokens, protectionFloorTokens) tokens).
*/
function foldableRanges(surfaceNodes, config) {
	if (surfaceNodes.length === 0) return [];
	const protectedReasons = /* @__PURE__ */ new Map();
	protectedReasons.set(surfaceNodes[0].seq, "surface node 0 is never foldable");
	const firstUser = surfaceNodes.find((n) => n.role === "user");
	if (firstUser !== void 0) protectedReasons.set(firstUser.seq, "first user message is pinned permanently");
	for (let i = surfaceNodes.length - 1; i >= 0; i -= 1) if (surfaceNodes[i].role === "user") {
		protectedReasons.set(surfaceNodes[i].seq, "the latest user turn must stay intact");
		break;
	}
	if (config.keepRecentMessages > 0) {
		const from = Math.max(0, surfaceNodes.length - config.keepRecentMessages);
		for (let i = from; i < surfaceNodes.length; i += 1) if (!protectedReasons.has(surfaceNodes[i].seq)) protectedReasons.set(surfaceNodes[i].seq, "protected recent tail");
	}
	const effectiveKeep = Math.max(config.keepRecentTokens, config.protectionFloorTokens);
	if (effectiveKeep > 0) {
		let acc = 0;
		let idx = surfaceNodes.length - 1;
		while (idx >= 0) {
			acc += surfaceNodes[idx].estimatedTokens;
			if (acc >= effectiveKeep) break;
			idx -= 1;
		}
		if (idx < 0) idx = 0;
		for (let i = idx; i < surfaceNodes.length; i += 1) if (!protectedReasons.has(surfaceNodes[i].seq)) protectedReasons.set(surfaceNodes[i].seq, "protected recent tail");
	}
	const ranges = [];
	const pushRun = (startIdx, endIdx) => {
		const nodes = surfaceNodes.slice(startIdx, endIdx + 1);
		const first = nodes[0];
		const last = nodes[nodes.length - 1];
		const tokens = nodes.reduce((sum, n) => sum + n.estimatedTokens, 0);
		const reason = protectedReasons.get(first.seq);
		if (reason !== void 0) ranges.push({
			startSeq: first.seq,
			endSeq: last.seq,
			estimatedTokens: tokens,
			protected: true,
			protectedReason: reason
		});
		else ranges.push({
			startSeq: first.seq,
			endSeq: last.seq,
			estimatedTokens: tokens,
			protected: false
		});
	};
	let runStart = 0;
	for (let i = 1; i < surfaceNodes.length; i += 1) if (protectedReasons.has(surfaceNodes[i - 1].seq) !== protectedReasons.has(surfaceNodes[i].seq)) {
		pushRun(runStart, i - 1);
		runStart = i;
	}
	pushRun(runStart, surfaceNodes.length - 1);
	return ranges;
}
/** Render the fold result as the zctx_fold tool reply (fail-soft wording). */
function renderFoldReply(result) {
	if (!result.ok) {
		const lines = [fill(FOLD_REPLY_REJECTED, {
			count: result.reasons.length,
			plural: result.reasons.length === 1 ? "" : "s"
		})];
		for (const reason of result.reasons) lines.push(fill(FOLD_REPLY_REASON_ROW, { reason }));
		return lines.join("\n");
	}
	const first = result.committed[0];
	const last = result.committed[result.committed.length - 1];
	const absorbed = result.plan?.folds.reduce((sum, f) => sum + f.absorbedFoldIds.length, 0) ?? 0;
	const lines = [];
	if (result.anomalies.length > 0) lines.push(FOLD_REPLY_ANOMALY_PREFIX);
	lines.push(fill(FOLD_REPLY_OK, {
		start: first.startSeq,
		end: last.endSeq,
		tokens: result.plan?.reclaimedTokens ?? 0,
		count: result.committed.length,
		plural: result.committed.length === 1 ? "" : "s",
		absorbed,
		absorbedPlural: absorbed === 1 ? "" : "s"
	}));
	for (const anomaly of result.anomalies) lines.push(fill(FOLD_REPLY_REASON_ROW, { reason: anomaly.detail }));
	return lines.join("\n");
}
/** Render the unfold result as the zctx_unfold tool reply (fail-soft wording). */
function renderUnfoldReply(foldId, result) {
	if (!result.ok) {
		const lines = [fill(UNFOLD_REPLY_REJECTED, {
			count: result.reasons.length,
			plural: result.reasons.length === 1 ? "" : "s"
		})];
		for (const reason of result.reasons) lines.push(fill(FOLD_REPLY_REASON_ROW, { reason }));
		return lines.join("\n");
	}
	const commit = result.committed[0];
	const blocks = commit.blocks ?? 0;
	return fill(UNFOLD_REPLY_OK, {
		foldId: foldId ?? commit.foldId,
		seq: commit.checkpointSeq,
		blocks,
		plural: blocks === 1 ? "" : "s",
		start: commit.startSeq,
		end: commit.endSeq
	});
}
// src/debug.ts
/**
* P6-D2 diagnostic sink (env-gated; task card ZCTX-P6D2).
*
* WHY THIS EXISTS (Z28): every face-degradation path logs through
* `ctx.logger?.warn`, and in the headless composition that logger has NO
* sink (no stderr wiring, no DSH_HOME/logs) — degradation became
* unobservable, so the bench could not tell "service absent → skip" from
* "register refused". This module writes DIRECTLY to `process.stderr`,
* bypassing the logger entirely.
*
* Gate discipline: output happens ONLY when `ZCTX_DEBUG` is exactly `'1'`.
* Default (unset or any other value) is ZERO output — production behavior
* is byte-identical to pre-instrumentation. This sink never throws (a
* diagnostic must not become the failure it diagnoses).
*/
/** `true` only when the operator explicitly asked for diagnostics. */
function zctxDebugEnabled() {
	return process.env.ZCTX_DEBUG === "1";
}
/** Env-gated stderr write: one line, prefixed `[zctx-debug]`, never throws. */
function zctxDebug(message) {
	if (process.env.ZCTX_DEBUG !== "1") return;
	try {
		process.stderr.write(`[zctx-debug] ${message}\n`);
	} catch {}
}
/** JSON stringify that survives circular/BigInt values (diagnostic-only). */
function zctxDebugJson(value) {
	if (process.env.ZCTX_DEBUG !== "1") return "";
	try {
		return JSON.stringify(value, (_key, item) => typeof item === "bigint" ? String(item) : item) ?? String(value);
	} catch {
		return "<unserializable>";
	}
}
/** bc F2.6 MIN_CHUNK_TOKENS=2000: halving floor component. */
const AUTOFOLD_MIN_CHUNK_TOKENS = 2e3;
/** Bounded wall-clock for one external summary call (ms). */
const EXTERNAL_SUMMARY_TIMEOUT_MS = 12e4;
/** The legal summarizer kinds (card product 2; RES-bc §9.1 MUST 5 三选一). */
const AUTOFOLD_SUMMARIZER_KINDS = [
	"compaction",
	"external",
	"digest"
];
/** Parse + validate the configured summarizer kind; undefined = illegal (fail-loud caller). */
function parseSummarizerKind(value) {
	if (typeof value !== "string") return void 0;
	return AUTOFOLD_SUMMARIZER_KINDS.includes(value) ? value : void 0;
}
/** Clamp one budget field: a positive finite integer wins, else the default. */
function resolveBudgetField(value, fallback) {
	if (typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value > 0) return value;
	return fallback;
}
/**
* Pair structure of a positional node list: the leftmost-partner bound per
* position (`lo`) plus the boundary-safety predicate (true when NO tool pair
* straddles that boundary — fail-closed on unknown pairing, mirroring the
* validator's rule). Computed from prefix-max of the rightmost-partner bound
* and suffix-min of the leftmost-partner bound. @internal
*/
function pairStructure(nodes) {
	const assistantByCallId = /* @__PURE__ */ new Map();
	const toolByCallId = /* @__PURE__ */ new Map();
	nodes.forEach((node, index) => {
		if (node.role === "assistant" && node.toolCallIds !== void 0) for (const callId of node.toolCallIds) assistantByCallId.set(callId, index);
		if (node.role === "tool" && node.answersCallId !== void 0) toolByCallId.set(node.answersCallId, index);
	});
	const hi = nodes.map((node, index) => {
		let bound = index;
		if (node.role === "assistant" && node.toolCallIds !== void 0) for (const callId of node.toolCallIds) {
			const toolIndex = toolByCallId.get(callId);
			if (toolIndex !== void 0) bound = Math.max(bound, toolIndex);
		}
		if (node.role === "tool" && node.answersCallId !== void 0) {
			const assistantIndex = assistantByCallId.get(node.answersCallId);
			if (assistantIndex !== void 0) bound = Math.max(bound, assistantIndex);
		}
		return bound;
	});
	const lo = nodes.map((node, index) => {
		let bound = index;
		if (node.role === "assistant" && node.toolCallIds !== void 0) for (const callId of node.toolCallIds) {
			const toolIndex = toolByCallId.get(callId);
			if (toolIndex !== void 0) bound = Math.min(bound, toolIndex);
		}
		if (node.role === "tool" && node.answersCallId !== void 0) {
			const assistantIndex = assistantByCallId.get(node.answersCallId);
			if (assistantIndex !== void 0) bound = Math.min(bound, assistantIndex);
		}
		return bound;
	});
	const prefHi = new Array(nodes.length);
	const sufLo = new Array(nodes.length);
	for (let i = 0; i < nodes.length; i += 1) prefHi[i] = i === 0 ? hi[0] : Math.max(prefHi[i - 1], hi[i]);
	for (let i = nodes.length - 1; i >= 0; i -= 1) sufLo[i] = i === nodes.length - 1 ? lo[i] : Math.min(sufLo[i + 1], lo[i]);
	return {
		lo,
		isSafeBoundary: (boundaryAfter) => {
			if (boundaryAfter < 0 || boundaryAfter >= nodes.length) return false;
			return prefHi[boundaryAfter] <= boundaryAfter && (boundaryAfter + 1 >= nodes.length || sufLo[boundaryAfter + 1] > boundaryAfter);
		}
	};
}
/**
* Build one span candidate for the seq hull [startSeq..endSeq] on the GIVEN
* surface view (pure; used by selection and by the chain's fresh-surface
* re-verification). Returns undefined when the hull is outside the
* validator's reachability domain (check a), cannot honor the pair-safety
* invariant at its boundaries, or falls below minFoldableTokens.
*/
function buildSpanCandidate(surfaceNodes, startSeq, endSeq, config, capTokens) {
	const nodes = surfaceNodes.map((node) => ({
		seq: node.seq,
		role: node.role,
		estimatedTokens: node.estimatedTokens,
		toolCallIds: node.toolCallIds,
		answersCallId: node.answersCallId
	}));
	const positionBySeq = /* @__PURE__ */ new Map();
	nodes.forEach((node, index) => positionBySeq.set(node.seq, index));
	const startIndex = positionBySeq.get(startSeq);
	const endIndex = positionBySeq.get(endSeq);
	if (startIndex === void 0 || endIndex === void 0 || endIndex < startIndex) return void 0;
	const span = nodes.slice(startIndex, endIndex + 1);
	const consecutive = endIndex - startIndex + 1 === span.length;
	const monotonic = span.every((node, i) => i === 0 || node.seq > span[i - 1].seq);
	if (!consecutive || !monotonic) return void 0;
	const structure = pairStructure(nodes);
	let end = -1;
	{
		let acc = 0;
		for (let i = startIndex; i <= endIndex; i += 1) {
			acc += nodes[i].estimatedTokens;
			if (capTokens !== void 0 && acc > capTokens) break;
			if (structure.isSafeBoundary(i)) end = i;
		}
	}
	let start = startIndex;
	while (start <= end) {
		let minLo = start;
		for (let i = start; i <= end; i += 1) minLo = Math.min(minLo, structure.lo[i]);
		if (minLo >= start) break;
		start += 1;
	}
	if (start > end) return void 0;
	let foldedTokens = 0;
	for (let i = start; i <= end; i += 1) foldedTokens += nodes[i].estimatedTokens;
	if (foldedTokens < config.minFoldableTokens) return void 0;
	return {
		startSeq: nodes[start].seq,
		endSeq: nodes[end].seq,
		foldedTokens
	};
}
/**
* Select the fold spans for one autoFold run (pure; test surface). Disjoint
* by construction (foldableRanges runs are disjoint), largest benefit first,
* capped at maxBatch.
*/
function selectFoldSpans(input) {
	if (input.surfaceNodes.length === 0) return [];
	const runs = foldableRanges(input.surfaceNodes, input.config).filter((r) => !r.protected);
	const capTokens = input.window !== void 0 && Number.isFinite(input.window) && input.window > 0 ? input.config.maxFoldFraction * input.window : void 0;
	const candidates = [];
	for (const run of runs) {
		const candidate = buildSpanCandidate(input.surfaceNodes, run.startSeq, run.endSeq, input.config, capTokens);
		if (candidate !== void 0) candidates.push(candidate);
	}
	candidates.sort((a, b) => b.foldedTokens - a.foldedTokens);
	return candidates.slice(0, Math.max(1, input.maxBatch));
}
/**
* The 'compaction' supply (official one-shot precedent; R3 variant ruling in
* the module docstring). One ctx.llm.stream call, purpose-marked, to the
* parent request's provider/model; output clamped to maxTokens.
*/
function createCompactionSupply(llm, maxOutputTokens) {
	return async (request) => {
		const prompt = `${AUTOFOLD_SUMMARY_INSTRUCTION}\n\n---\n\n${request.spanText}`;
		const options = {
			provider: request.provider,
			model: request.model,
			messages: [{
				role: "user",
				content: [{
					type: "text",
					text: prompt
				}]
			}],
			maxTokens: Math.max(1, Math.floor(maxOutputTokens)),
			purpose: "compaction",
			...request.sessionId !== void 0 ? { sessionId: request.sessionId } : {},
			...request.signal !== void 0 ? { signal: request.signal } : {}
		};
		let finishKind;
		let failureDetail;
		let deltaText = "";
		const blockTexts = [];
		try {
			for await (const chunk of llm.stream(options)) {
				if (chunk === null || typeof chunk !== "object") continue;
				const chunkRecord = chunk;
				if (chunkRecord.type === "text-delta" && typeof chunkRecord.text === "string") {
					deltaText += chunkRecord.text;
					continue;
				}
				if (chunkRecord.type === "block-end") {
					const block = chunkRecord.block;
					if (block !== null && typeof block === "object") {
						const candidate = block;
						if (candidate.type === "text" && typeof candidate.text === "string") blockTexts.push(candidate.text);
					}
					continue;
				}
				if (chunkRecord.type === "finish" && chunkRecord.reason !== null && typeof chunkRecord.reason === "object") {
					const reason = chunkRecord.reason;
					if (typeof reason.kind === "string") finishKind = reason.kind;
					const failure = reason.failure;
					if (failure !== null && typeof failure === "object") {
						const message = failure.message;
						if (typeof message === "string") failureDetail = message;
					}
				}
			}
		} catch (error) {
			return {
				kind: "fault",
				detail: error instanceof Error ? error.message : String(error)
			};
		}
		const text = deltaText.trim().length > 0 ? deltaText : blockTexts.join("\n");
		if (finishKind === "error" || finishKind === "aborted") return {
			kind: "fault",
			detail: failureDetail ?? `stream finished with kind '${finishKind}'`
		};
		if (finishKind === "max-tokens") return text.trim().length > 0 ? {
			kind: "fault",
			detail: "summary truncated at the output token cap"
		} : {
			kind: "empty",
			deterministic: false,
			detail: "truncated at the output token cap with no text"
		};
		if (text.trim().length === 0) return {
			kind: "empty",
			deterministic: finishKind === "stop",
			detail: finishKind === void 0 ? "stream settled without a finish chunk" : void 0
		};
		return {
			kind: "ok",
			text
		};
	};
}
/** Extract the summary text from an external response body (fail-soft, honest). */
function extractExternalSummaryText(raw) {
	const trimmed = raw.trim();
	if (trimmed.length === 0) return "";
	try {
		const parsed = JSON.parse(trimmed);
		if (parsed !== null && typeof parsed === "object") {
			const record = parsed;
			const choices = record.choices;
			if (Array.isArray(choices) && choices.length > 0 && choices[0] !== null && typeof choices[0] === "object") {
				const message = choices[0].message;
				if (message !== null && typeof message === "object") {
					const content = message.content;
					if (typeof content === "string") return content;
					if (Array.isArray(content)) {
						const parts = [];
						for (const block of content) if (block !== null && typeof block === "object") {
							const candidate = block;
							if (candidate.type === "text" && typeof candidate.text === "string") parts.push(candidate.text);
						}
						return parts.join("\n");
					}
				}
			}
			if (Array.isArray(record.content)) {
				const parts = [];
				for (const block of record.content) if (block !== null && typeof block === "object") {
					const candidate = block;
					if (candidate.type === "text" && typeof candidate.text === "string") parts.push(candidate.text);
				}
				return parts.join("\n");
			}
			if (typeof record.text === "string") return record.text;
		}
	} catch {}
	return trimmed;
}
/**
* The 'external' supply: one bounded HTTP POST to the configured endpoint
* (bc external-summary 同型; the caller picked this supply explicitly — an
* unavailable endpoint is a fault that feeds the degradation chain, never a
* silent re-route to another supply).
*/
function createExternalSupply(endpoint, fetchImpl) {
	return async (request) => {
		const impl = fetchImpl ?? globalThis.fetch;
		if (typeof impl !== "function") return {
			kind: "fault",
			detail: "fetch is not available in this runtime"
		};
		const prompt = `${AUTOFOLD_SUMMARY_INSTRUCTION}\n\n---\n\n${request.spanText}`;
		const credential = endpoint.apiKeyEnv !== void 0 && endpoint.apiKeyEnv.length > 0 ? process.env[endpoint.apiKeyEnv] : void 0;
		const headers = { "content-type": "application/json" };
		if (typeof credential === "string" && credential.length > 0) headers.authorization = `Bearer ${credential}`;
		const timeout = new AbortController();
		const timer = setTimeout(() => timeout.abort(), EXTERNAL_SUMMARY_TIMEOUT_MS);
		const signal = request.signal !== void 0 && typeof AbortSignal.any === "function" ? AbortSignal.any([timeout.signal, request.signal]) : timeout.signal;
		try {
			const response = await impl(endpoint.url, {
				method: "POST",
				headers,
				body: JSON.stringify({
					model: endpoint.model,
					max_tokens: Math.max(1, Math.floor(endpoint.maxTokens)),
					stream: false,
					messages: [{
						role: "user",
						content: prompt
					}]
				}),
				signal
			});
			if (!response.ok) return {
				kind: "fault",
				detail: `summary service responded HTTP ${response.status}`
			};
			const text = extractExternalSummaryText(await response.text());
			if (text.trim().length === 0) return {
				kind: "empty",
				deterministic: false,
				detail: "summary service returned no text"
			};
			return {
				kind: "ok",
				text
			};
		} catch (error) {
			return {
				kind: "fault",
				detail: error instanceof Error ? error.message : String(error)
			};
		} finally {
			clearTimeout(timer);
		}
	};
}
/** Collapse whitespace and take the head fragment (deterministic). @internal */
function digestHead(text, headChars) {
	const collapsed = text.replace(/\s+/g, " ").trim();
	return collapsed.length <= headChars ? collapsed : `${collapsed.slice(0, headChars)}…`;
}
/**
* Build the deterministic structural digest for a span (bc form A: keep the
* head fragments; the size bound strips rows before it ever breaks the
* summary ceiling — form B spirit, deterministically).
*/
function digestSpanSummary(blocks, maxChars, headChars = 120) {
	const rows = [];
	let total = 144;
	for (const block of blocks) {
		const row = fill(AUTOFOLD_DIGEST_ROW, {
			seq: block.seq,
			role: block.role,
			chars: block.chars,
			head: digestHead(block.text, headChars)
		});
		if (total + row.length + 1 > maxChars) break;
		rows.push(row);
		total += row.length + 1;
	}
	const lines = [AUTOFOLD_DIGEST_HEADER, ...rows];
	if (rows.length < blocks.length) lines.push(AUTOFOLD_DIGEST_TAIL);
	return lines.join("\n");
}
/** Materialize one span's text for the summary supplies (role-prefixed blocks). @internal */
function materializeSpanText(store, startSeq, endSeq) {
	return materializeRange({ eventAt: (seq) => store.retainedEvent(seq) }, store.foldMap, startSeq, endSeq).map((block) => block.text).join("\n\n");
}
/** Build the digest rows for one span from the store's surface view. @internal */
function digestBlocksForSpan(store, startSeq, endSeq) {
	const rows = [];
	for (const node of store.surfaceNodes()) {
		if (node.seq < startSeq || node.seq > endSeq) continue;
		rows.push({
			seq: node.seq,
			role: node.role,
			chars: node.textLength,
			text: store.eventText(node.seq)
		});
	}
	return rows;
}
/**
* Run one autoFold chain (the pure orchestrator; the listener calls it on a
* trigger hit). Budgets, the degradation chain, and the sticky state machine
* all live here; the commit goes through the SAME fold() the zctx_fold tool
* uses (validator + surface replace + generation verification — no second
* commit path).
*/
async function runAutoFoldChain(deps) {
	const faults = [];
	let rounds = 0;
	let summaryCalls = 0;
	let transientRetries = 0;
	let halvingSplits = 0;
	let digestFallbacks = 0;
	let foldsCommitted = 0;
	let netTokensSaved = 0;
	let supplyDead = deps.state.deadProbeSticky;
	let canaryUsed = false;
	let remaining = Math.max(0, deps.estimate - deps.hitLine);
	deps.store.resync();
	const capTokens = deps.window !== void 0 && Number.isFinite(deps.window) && deps.window > 0 ? deps.validatorConfig.maxFoldFraction * deps.window : void 0;
	const candidates = selectFoldSpans({
		surfaceNodes: deps.store.surfaceNodes(),
		config: deps.validatorConfig,
		maxBatch: deps.config.maxBatch,
		...deps.window !== void 0 ? { window: deps.window } : {}
	});
	const ceiling = Math.max(1, deps.validatorConfig.summaryCeilingChars);
	const splitFloorTokens = Math.max(AUTOFOLD_MIN_CHUNK_TOKENS, deps.validatorConfig.minFoldableTokens);
	/** One summary-call flow for a span (retries + sticky + canary). @internal */
	const attemptSupply = async (span) => {
		const supply = deps.supply;
		if (supply === void 0) return { kind: "skip-digest" };
		if (supplyDead && canaryUsed) return { kind: "skip-digest" };
		const spanText = materializeSpanText(deps.store, span.startSeq, span.endSeq);
		const isCanary = supplyDead && !canaryUsed;
		canaryUsed = true;
		for (let attempt = 0; attempt <= 2; attempt += 1) {
			if (summaryCalls >= 16) return {
				kind: "give-up",
				detail: "summary-call budget exhausted"
			};
			summaryCalls += 1;
			const outcome = await supply({
				spanText,
				provider: deps.provider,
				model: deps.model,
				...deps.sessionId !== void 0 ? { sessionId: deps.sessionId } : {},
				...deps.signal !== void 0 ? { signal: deps.signal } : {}
			});
			if (outcome.kind === "ok") {
				deps.state.deterministicEmpties = 0;
				if (isCanary) {
					supplyDead = false;
					deps.state.deadProbeSticky = false;
				}
				return {
					kind: "text",
					text: outcome.text
				};
			}
			if (outcome.kind === "empty" && outcome.deterministic) {
				deps.state.deterministicEmpties += 1;
				faults.push(`deterministic empty answer (${outcome.detail ?? "normal finish, no text"})`);
				if (deps.state.deterministicEmpties >= 3) {
					supplyDead = true;
					deps.state.deadProbeSticky = true;
					faults.push(`summary supply judged dead: 3 consecutive normal-finish empty answers`);
				}
				return {
					kind: "give-up",
					detail: "deterministic empty answer (halving path)"
				};
			}
			if (transientRetries < 4 && attempt < 2) {
				transientRetries += 1;
				faults.push(`${outcome.kind === "empty" ? "transient empty answer" : "summary call fault"}: ${outcome.detail ?? "no detail"} (retry ${transientRetries})`);
				continue;
			}
			return {
				kind: "give-up",
				detail: outcome.kind === "empty" ? `transient empty answer exhausted retries (${outcome.detail ?? "no detail"})` : `summary call fault (${outcome.detail ?? "no detail"})`
			};
		}
		return {
			kind: "give-up",
			detail: "retry loop exhausted"
		};
	};
	/** Validate + commit one span with the given summary text (the ONLY commit path). @internal */
	const commitSpan = (span, text) => {
		const fresh = buildSpanCandidate(deps.store.surfaceNodes(), span.startSeq, span.endSeq, deps.validatorConfig, capTokens);
		if (fresh === void 0) {
			const detail = `span ${span.startSeq}..${span.endSeq} is no longer selectable on the current surface`;
			faults.push(`fold rejected: ${detail}`);
			return {
				kind: "abort",
				detail
			};
		}
		const summaryTokens = estimateTokens(text);
		if (fresh.foldedTokens * deps.validatorConfig.netShrinkTolerance <= summaryTokens) {
			faults.push(`net-shrink pre-check rejected the summary for span ${fresh.startSeq}..${fresh.endSeq} (${Math.round(fresh.foldedTokens * deps.validatorConfig.netShrinkTolerance)} gate vs ${summaryTokens} summary tokens)`);
			return { kind: "halve" };
		}
		const result = fold(deps.session, deps.store, {
			range: {
				startSeq: fresh.startSeq,
				endSeq: fresh.endSeq
			},
			summaries: [{
				startSeq: fresh.startSeq,
				endSeq: fresh.endSeq,
				text
			}]
		}, deps.validatorConfig);
		if (result.ok) {
			const reclaimed = result.plan?.reclaimedTokens ?? 0;
			foldsCommitted += result.committed.length;
			netTokensSaved += result.committed.reduce((sum, commit) => sum + Math.max(0, commit.tokensBefore - commit.tokensAfter), 0);
			remaining -= reclaimed;
			return {
				kind: "committed",
				reclaimedTokens: reclaimed
			};
		}
		const reasons = result.reasons.join(" | ");
		faults.push(`fold rejected for span ${fresh.startSeq}..${fresh.endSeq}: ${reasons}`);
		return result.reasons.some((reason) => reason.includes(REASON_NO_NET_SHRINK_SIGNATURE)) ? { kind: "halve" } : {
			kind: "abort",
			detail: reasons
		};
	};
	/** The terminal CPU fallback for one span. @internal */
	const digestSpan = (span) => {
		digestFallbacks += 1;
		const text = digestSpanSummary(digestBlocksForSpan(deps.store, span.startSeq, span.endSeq), ceiling);
		const attempt = commitSpan(span, text);
		if (attempt.kind === "halve") return {
			kind: "abort",
			detail: `digest rejected by the net-shrink gate for span ${span.startSeq}..${span.endSeq}`
		};
		return attempt;
	};
	/** Split point: the pair-safe boundary nearest the token midpoint. @internal */
	const splitSpan = (span) => {
		if (span.foldedTokens < 2 * splitFloorTokens) return void 0;
		const nodes = deps.store.surfaceNodes().filter((n) => n.seq >= span.startSeq && n.seq <= span.endSeq).map((node) => ({
			seq: node.seq,
			role: node.role,
			estimatedTokens: node.estimatedTokens,
			toolCallIds: node.toolCallIds,
			answersCallId: node.answersCallId
		}));
		if (nodes.length < 2) return void 0;
		const { isSafeBoundary } = pairStructure(nodes);
		const total = nodes.reduce((sum, n) => sum + n.estimatedTokens, 0);
		let acc = 0;
		let bestIndex = -1;
		let bestDistance = Number.POSITIVE_INFINITY;
		for (let i = 0; i < nodes.length - 1; i += 1) {
			acc += nodes[i].estimatedTokens;
			if (!isSafeBoundary(i)) continue;
			const distance = Math.abs(acc - total / 2);
			if (distance < bestDistance) {
				bestDistance = distance;
				bestIndex = i;
			}
		}
		if (bestIndex < 0) return void 0;
		const leftNodes = nodes.slice(0, bestIndex + 1);
		const rightNodes = nodes.slice(bestIndex + 1);
		const leftTokens = leftNodes.reduce((sum, n) => sum + n.estimatedTokens, 0);
		const rightTokens = rightNodes.reduce((sum, n) => sum + n.estimatedTokens, 0);
		if (leftTokens < splitFloorTokens || rightTokens < splitFloorTokens) return void 0;
		return {
			left: {
				startSeq: leftNodes[0].seq,
				endSeq: leftNodes[leftNodes.length - 1].seq,
				foldedTokens: leftTokens
			},
			right: {
				startSeq: rightNodes[0].seq,
				endSeq: rightNodes[rightNodes.length - 1].seq,
				foldedTokens: rightTokens
			}
		};
	};
	/** One span's full flow: supply → validate/commit → halve → digest. @internal */
	const processSpan = async (span) => {
		const supplied = await attemptSupply(span);
		if (supplied.kind === "text") {
			const attempt = commitSpan(span, supplied.text);
			if (attempt.kind === "committed" || attempt.kind === "abort") return;
		} else if (supplied.kind === "skip-digest") {
			digestSpan(span);
			return;
		}
		const halves = splitSpan(span);
		if (halves !== void 0) {
			halvingSplits += 1;
			faults.push(`halving span ${span.startSeq}..${span.endSeq} → ${halves.left.startSeq}..${halves.left.endSeq} + ${halves.right.startSeq}..${halves.right.endSeq}`);
			pending.push(halves.left, halves.right);
			return;
		}
		digestSpan(span);
	};
	const pending = [...candidates];
	let stopped = "work-done";
	while (pending.length > 0) {
		if (rounds >= deps.config.maxRounds) {
			stopped = "budget-exhausted";
			break;
		}
		if (remaining <= 0) {
			stopped = "shortfall-closed";
			break;
		}
		const span = pending.shift();
		if (span === void 0) break;
		rounds += 1;
		await processSpan(span);
	}
	let outcome;
	if (candidates.length === 0) outcome = "no-qualified-span";
	else if (stopped === "budget-exhausted") outcome = "budget-exhausted";
	else if (foldsCommitted > 0) outcome = "folds-committed";
	else if (supplyDead) outcome = "supply-dead";
	else outcome = "no-committed-fold";
	const record = {
		time: Date.now(),
		estimate: deps.estimate,
		...deps.window !== void 0 ? { window: deps.window } : {},
		hitLine: deps.hitLine,
		rounds,
		summaryCalls,
		foldsCommitted,
		netTokensSaved,
		transientRetries,
		halvingSplits,
		digestFallbacks,
		deadProbeSticky: deps.state.deadProbeSticky,
		outcome,
		faults
	};
	deps.state.runs += 1;
	deps.state.roundsTotal += rounds;
	deps.state.foldsCommitted += foldsCommitted;
	deps.state.netTokensSaved += netTokensSaved;
	deps.state.lastRun = record;
	return record;
}
/**
* The autoFold waterfall listener. Construct once per plugin when
* autofold.enabled; register `onStream` AFTER the preflight listener
* (innermost — enforce precedence is documented in the module docstring).
*/
var AutoFoldListener = class AutoFoldListener {
	deps;
	stateBySession = /* @__PURE__ */ new WeakMap();
	running = /* @__PURE__ */ new WeakSet();
	modelInfoCache = /* @__PURE__ */ new Map();
	projector;
	warnedFault = false;
	static MODEL_INFO_CACHE_CAP = 64;
	constructor(deps) {
		this.deps = {
			...deps,
			marginRatio: resolveMarginRatio(deps.marginRatio, deps.logger)
		};
	}
	/** Memoized projector (same lazy face as the other two listeners). */
	ensureProjector() {
		this.projector ??= loadHostProjector();
		return this.projector;
	}
	onStream = (options, next) => this.handleStream(options, next);
	/** The per-session status view (facts only; status segment 8 renders it). */
	statusFor(session) {
		const state = this.stateBySession.get(session);
		if (state === void 0) return void 0;
		return { ...state };
	}
	/** @internal */
	stateFor(session) {
		let state = this.stateBySession.get(session);
		if (state === void 0) {
			state = {
				runs: 0,
				roundsTotal: 0,
				foldsCommitted: 0,
				netTokensSaved: 0,
				deterministicEmpties: 0,
				deadProbeSticky: false
			};
			this.stateBySession.set(session, state);
		}
		return state;
	}
	/** Memoized per-route model info (bounded, negative results cached; V2-C design). */
	resolveModelInfoCached(provider, model) {
		if (provider === "" || model === "" || typeof this.deps.resolveModelInfo !== "function") return Promise.resolve(void 0);
		const key = `${provider}\u0000${model}`;
		let entry = this.modelInfoCache.get(key);
		if (entry === void 0) {
			entry = this.deps.resolveModelInfo(provider, model).catch(() => void 0);
			if (this.modelInfoCache.size >= AutoFoldListener.MODEL_INFO_CACHE_CAP) {
				const oldest = this.modelInfoCache.keys().next();
				if (!oldest.done) this.modelInfoCache.delete(oldest.value);
			}
			this.modelInfoCache.set(key, entry);
		}
		return entry;
	}
	/** @internal */
	async *handleStream(options, next) {
		let plan;
		try {
			plan = await this.prepare(options);
		} catch (error) {
			if (!this.warnedFault) {
				this.warnedFault = true;
				this.deps.logger?.warn?.(`dsh-zcontext: autofold estimation failed (${error instanceof Error ? error.message : String(error)}); requests pass through unjudged until the fault clears`);
			}
			plan = void 0;
		}
		if (plan === void 0) {
			yield* next();
			return;
		}
		this.running.add(plan.session);
		let record;
		try {
			record = await runAutoFoldChain({
				session: plan.session,
				store: plan.store,
				validatorConfig: this.deps.validatorConfig(plan.session),
				config: this.deps.chain,
				...this.deps.supply !== void 0 ? { supply: this.deps.supply } : {},
				provider: plan.provider,
				model: plan.model,
				...plan.sessionId !== void 0 ? { sessionId: plan.sessionId } : {},
				estimate: plan.estimate,
				hitLine: plan.hitLine,
				...plan.window !== void 0 ? { window: plan.window } : {},
				state: plan.state,
				...plan.signal !== void 0 ? { signal: plan.signal } : {},
				logger: this.deps.logger
			});
		} catch (error) {
			this.deps.logger?.warn?.(`dsh-zcontext: autofold chain failed (${error instanceof Error ? error.message : String(error)}); the request proceeds unfolded`);
		} finally {
			this.running.delete(plan.session);
		}
		if (record !== void 0) zctxDebug(`autoFold run: outcome=${record.outcome} rounds=${record.rounds} calls=${record.summaryCalls} folds=${record.foldsCommitted} netSaved=${record.netTokensSaved} transient=${record.transientRetries} halvings=${record.halvingSplits} digest=${record.digestFallbacks} sticky=${record.deadProbeSticky}`);
		if (record !== void 0 && record.foldsCommitted > 0) this.deps.onFoldCommitted?.(plan.session);
		yield* next();
	}
	/**
	* The trigger judgment (V4 criteria reused verbatim; the third face beyond
	* observe/enforce). Returns undefined = pass-through (not main-chain,
	* unwatched, trigger not crossed); throws only on real faults. @internal
	*/
	async prepare(options) {
		if (options === null || typeof options !== "object") return void 0;
		const record = options;
		const projector = await this.ensureProjector();
		const match = matchesMainChain(record, projector, {
			resolveSession: (sessionId) => this.deps.resolveSession(sessionId),
			storeFor: (session) => this.deps.storeFor(session)
		});
		if (match === void 0) return void 0;
		const session = this.deps.resolveSession(match.sessionId);
		if (session === void 0) return void 0;
		if (this.running.has(session)) return void 0;
		const store = this.deps.storeFor(session);
		if (store === void 0) return void 0;
		const provider = typeof record.provider === "string" ? record.provider : "";
		const model = typeof record.model === "string" ? record.model : "";
		const modelInfo = await this.resolveModelInfoCached(provider, model);
		const pricing = typeof this.deps.imageRequestPricing === "function" ? this.deps.imageRequestPricing(provider, model) : void 0;
		const estimate = projectAndEstimateRequest({
			options: record,
			projector,
			modelInfo,
			...typeof this.deps.fileRequestText === "function" ? { fileRequestText: (ref) => this.deps.fileRequestText?.(ref) } : {},
			...pricing !== void 0 ? { imagePricing: pricing } : {}
		});
		const judgment = judgeEstimate({
			estimate: estimate.tokens,
			modelInfo,
			optionsMaxTokens: record.maxTokens,
			marginRatio: this.deps.marginRatio
		});
		if (judgment.hit !== true || judgment.triggerLine === void 0) {
			zctxDebug(`autoFold judge: estimate=${estimate.tokens} window=${judgment.window ?? "unknown"} triggerLine=${judgment.triggerLine ?? "unknown"} × margin=${this.deps.marginRatio} → hit=false (pass-through)`);
			return;
		}
		zctxDebug(`autoFold judge: estimate=${estimate.tokens} window=${judgment.window ?? "unknown"} triggerLine=${judgment.triggerLine} × margin=${this.deps.marginRatio} → HIT (hit line ${Math.ceil(judgment.triggerLine * this.deps.marginRatio)}) — chain starting`);
		const signal = record.signal;
		return {
			session,
			store,
			state: this.stateFor(session),
			provider,
			model,
			estimate: estimate.tokens,
			hitLine: Math.ceil(judgment.triggerLine * this.deps.marginRatio),
			window: judgment.window,
			sessionId: typeof record.sessionId === "string" ? record.sessionId : void 0,
			signal: signal instanceof AbortSignal ? signal : void 0
		};
	}
};
// src/adapter/providers.ts
/** The route key for one family (R5 namespace). */
function zctxRouteOf(family) {
	return `zctx-${family}`;
}
/** The display name for one family (card product 1, verbatim technical name). */
function zctxDisplayNameOf(family) {
	return `zctx ${family}`;
}
function isPositiveInt(value) {
	return typeof value === "number" && Number.isInteger(value) && value > 0;
}
/**
* The legal pi-ai thinking levels (P3 HF-12 construction gate). Kept LOCAL —
* providers.ts is the zero-import pure validation layer; the escalation ORDER
* twin lives in zctx-adapter.ts (THINKING_LEVEL_ORDER). The two lists must
* stay in sync: changing one without the other is a spec-level drift.
*/
const LEGAL_PI_AI_LEVELS = /* @__PURE__ */ new Set([
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max"
]);
/**
* Resolve and validate the whole providers section at once. Returns the
* resolved specs AND the complete violation list (构造期 fail-loud 列清单 —
* the caller throws with the FULL list, never one-at-a-time). Empty/absent
* section resolves to zero providers with zero violations (the adapter face
* then registers zero routes — legal per F1.4's keep-alive semantics).
*/
function resolveZctxProviders(section, supportedProtocols) {
	const violations = [];
	const providers = [];
	const seenFamilies = /* @__PURE__ */ new Set();
	(section?.providers ?? []).forEach((provider, index) => {
		const label = provider.family === void 0 || provider.family === "" ? `providers[${index}]` : `providers[${index}] (family "${provider.family}")`;
		const family = typeof provider.family === "string" ? provider.family.trim() : "";
		if (family === "") {
			violations.push(`${label}: family is required (the wire protocol name)`);
			return;
		}
		if (!supportedProtocols.includes(family)) {
			violations.push(`${label}: family "${family}" is not a supported wire protocol (supported: ${supportedProtocols.join(", ")})`);
			return;
		}
		if (seenFamilies.has(family)) {
			violations.push(`${label}: duplicate family "${family}" — each family maps to one route (${zctxRouteOf(family)})`);
			return;
		}
		seenFamilies.add(family);
		const models = [];
		const seenIds = /* @__PURE__ */ new Set();
		const providerModels = Array.isArray(provider.models) ? provider.models : [];
		if (providerModels.length === 0) violations.push(`${label}: declares no models — a route without models cannot serve requests`);
		providerModels.forEach((model, modelIndex) => {
			const modelLabel = `${label} models[${modelIndex}]`;
			const id = typeof model?.id === "string" ? model.id.trim() : "";
			if (id === "") {
				violations.push(`${modelLabel}: id is required`);
				return;
			}
			if (seenIds.has(id)) {
				violations.push(`${modelLabel}: duplicate model id "${id}"`);
				return;
			}
			seenIds.add(id);
			if (!isPositiveInt(model.contextWindow)) {
				violations.push(`${modelLabel} ("${id}"): contextWindow must be a declared positive integer (INVALID_MODEL_CONTEXT semantics; got ${JSON.stringify(model.contextWindow)})`);
				return;
			}
			if (!isPositiveInt(model.maxTokens)) {
				violations.push(`${modelLabel} ("${id}"): maxTokens must be a positive integer declared in config (official catalog.ts:934-936 — a missing value is a construction violation, never an invented default; got ${JSON.stringify(model.maxTokens)})`);
				return;
			}
			let reasoningEfforts;
			const rawEfforts = model.reasoningEfforts;
			if (rawEfforts === false) reasoningEfforts = false;
			else if (rawEfforts !== void 0 && rawEfforts !== null) {
				if (typeof rawEfforts !== "object" || Array.isArray(rawEfforts)) violations.push(`${modelLabel} ("${id}"): reasoningEfforts must be a mapping of wire value -> pi-ai level, or false`);
				else {
					const entries = Object.entries(rawEfforts);
					const illegal = entries.filter(([, level]) => !LEGAL_PI_AI_LEVELS.has(String(level)));
					if (illegal.length > 0) violations.push(`${modelLabel} ("${id}"): reasoningEfforts values must be legal pi-ai levels ([${[...LEGAL_PI_AI_LEVELS].join(", ")}]); illegal: ` + illegal.map(([wire, level]) => `"${String(wire)}"->"${String(level)}"`).join(", "));
					else reasoningEfforts = Object.fromEntries(entries.map(([wire, level]) => [wire, String(level)]));
				}
			}
			models.push({
				id,
				name: id,
				contextWindow: model.contextWindow,
				maxTokens: model.maxTokens,
				...reasoningEfforts !== void 0 ? { reasoningEfforts } : {}
			});
		});
		let baseURL;
		if (provider.baseURL !== void 0) {
			if (typeof provider.baseURL !== "string" || provider.baseURL === "") violations.push(`${label}: baseURL must be a non-empty string when present`);
			else if (provider.baseURL.startsWith("ws://") || provider.baseURL.startsWith("wss://")) violations.push(`${label}: baseURL "${provider.baseURL}" uses WebSocket transport, which zctx does not support (R6: HTTP(SSE) only)`);
			else try {
				const url = new URL(provider.baseURL);
				if (url.protocol !== "http:" && url.protocol !== "https:") violations.push(`${label}: baseURL "${provider.baseURL}" must be http(s) (R6)`);
				else baseURL = provider.baseURL;
			} catch {
				violations.push(`${label}: baseURL "${provider.baseURL}" is not an absolute URL`);
			}
		}
		let apiKeyEnv;
		if (provider.apiKeyEnv !== void 0) {
			if (typeof provider.apiKeyEnv === "string" && provider.apiKeyEnv !== "") apiKeyEnv = provider.apiKeyEnv;
			else violations.push(`${label}: apiKeyEnv must be a non-empty environment variable NAME when present`);
		}
		let cacheRetention;
		if (provider.cacheRetention !== void 0) {
			if (provider.cacheRetention === "none" || provider.cacheRetention === "short" || provider.cacheRetention === "long") cacheRetention = provider.cacheRetention;
			else violations.push(`${label}: cacheRetention "${String(provider.cacheRetention)}" is not one of 'none' | 'short' | 'long'`);
		}
		let cacheControlFormat;
		if (provider.cacheControlFormat !== void 0) {
			if (provider.cacheControlFormat !== "anthropic") violations.push(`${label}: cacheControlFormat "${String(provider.cacheControlFormat)}" is not 'anthropic' (the only legal value, official GATE union)`);
			else if (family !== "openai-completions") violations.push(`${label}: cacheControlFormat is only meaningful on the openai-completions family (family "${family}" would carry dead config)`);
			else cacheControlFormat = "anthropic";
		}
		providers.push({
			route: zctxRouteOf(family),
			family,
			displayName: zctxDisplayNameOf(family),
			protocol: family,
			...baseURL !== void 0 ? { baseURL } : {},
			...apiKeyEnv !== void 0 ? { apiKeyEnv } : {},
			models,
			...cacheRetention !== void 0 ? { cacheRetention } : {},
			...cacheControlFormat !== void 0 ? { cacheControlFormat } : {}
		});
	});
	return {
		providers,
		violations
	};
}
/**
* The construction-time fail-loud gate: throws with the COMPLETE violation
* list when any violation exists. The wiring layer catches this and skips
* the adapter face with the list in the log (fail-soft at boot, fail-loud
* at the adapter contract — both disciplines hold).
*/
function assertZctxProvidersResolvable(section, supportedProtocols) {
	const { providers, violations } = resolveZctxProviders(section, supportedProtocols);
	if (violations.length > 0) throw new Error(`dsh-zcontext: zctx adapter configuration is not serviceable (${violations.length} violation(s)):\n` + violations.map((violation) => `  - ${violation}`).join("\n"));
	return providers;
}
// src/adapter/context.ts
function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function flattenText(message) {
	return contentBlocks(message).filter((block) => block["type"] === "text").map((block) => typeof block["text"] === "string" ? block["text"] : "").join("");
}
/**
* The typed blocks of one message. A plain-string content normalizes to ONE
* text block (the harness allows string user content; the official walkers
* assume block arrays, this twin is defensive without dropping content).
* @internal
*/
function contentBlocks(message) {
	if (Array.isArray(message.content)) return message.content;
	if (typeof message.content === "string") return [{
		type: "text",
		text: message.content
	}];
	return [];
}
function contentHasType(message, type) {
	return contentBlocks(message).some((block) => block["type"] === type);
}
/** Reject misplaced tool-change blocks and unsupported image roles (official context.ts:50-65). */
function assertSupportedHistory(messages, deps) {
	for (const message of messages) {
		if (message.role !== "developer" && contentBlocks(message).some((block) => block["type"] === "tool-addition" || block["type"] === "tool-removal")) throw new deps.LlmError("Tool-change blocks require developer role", "UNSUPPORTED_CONTENT");
		if (message.role !== "user" && message.role !== "tool" && contentHasType(message, "image")) throw new deps.LlmError(`pi-ai cannot represent an image in an in-history ${message.role} message`, "UNSUPPORTED_CONTENT");
		if (message.role === "system" && message.content.some((block) => block["type"] !== "text")) throw new deps.LlmError("pi-ai cannot represent non-text system messages", "UNSUPPORTED_CONTENT");
	}
}
/** Recover the pi-ai toolResult message for one harness tool-role message (official context.ts:32-47). */
function toolResultOf(message, toolNames, content) {
	return {
		role: "toolResult",
		toolCallId: message.toolCallId,
		toolName: toolNames.get(message.toolCallId ?? "") ?? "unknown",
		content: [{
			type: "text",
			text: content || "(no output)"
		}],
		isError: message.isError === true,
		timestamp: 0
	};
}
/** Convert a projected declaration without its harness-owned activation marker (official context.ts:131-133). */
function piTool(tool) {
	return {
		name: tool["name"],
		description: tool["description"],
		parameters: tool["parameters"]
	};
}
function toolsOf(options) {
	return options.tools?.filter((tool) => tool["deferLoading"] !== true).map(piTool);
}
/** The request split into pi-ai's initial `systemPrompt` slot and the history (official context.ts:139-158). */
function splitSystemPrompt(options) {
	const text = [options.system];
	let end = 0;
	for (const message of options.messages) {
		if (message.role !== "system") break;
		text.push(flattenText(message));
		end++;
	}
	return {
		systemPrompt: text.filter(Boolean).join("\n\n") || void 0,
		messages: options.messages.slice(end)
	};
}
/** Assemble the request-level pi-ai context envelope (official context.ts:161-168). */
function piContext(systemPrompt, options, messages) {
	const tools = toolsOf(options);
	return {
		...systemPrompt !== void 0 ? { systemPrompt } : {},
		messages,
		...tools !== void 0 && tools.length > 0 ? { tools } : {}
	};
}
/** Keep one developer event in one system update (official context.ts:171-201). */
function appendDeveloper(message, options, messages, deps) {
	const content = [];
	const toolsAdded = [];
	const toolsRemoved = [];
	for (const block of message.content) switch (block["type"]) {
		case "text":
			if (typeof block["text"] === "string" && block["text"].length > 0) content.push({
				type: "text",
				text: block["text"]
			});
			break;
		case "tool-addition": {
			const toolName = typeof block["toolName"] === "string" ? block["toolName"] : "";
			const tool = options.tools?.find((tool) => tool["name"] === toolName);
			if (tool === void 0) throw new deps.LlmError(`pi-ai tool update references undeclared tool "${toolName}"`, "INVALID_REQUEST");
			toolsAdded.push(piTool(tool));
			break;
		}
		case "tool-removal":
			toolsRemoved.push({ name: block["toolName"] });
			break;
		default: throw new deps.LlmError(`pi-ai cannot represent developer content ${String(block["type"])}`, "UNSUPPORTED_CONTENT");
	}
	if (content.length === 0 && toolsAdded.length === 0 && toolsRemoved.length === 0) return;
	messages.push({
		role: "system",
		content,
		timestamp: 0,
		...toolsAdded.length === 0 ? {} : { toolsAdded },
		...toolsRemoved.length === 0 ? {} : { toolsRemoved }
	});
}
/** Append one assistant message through the replay consume twin (official context.ts:203-214). */
function appendAssistant(message, messages, toolNames, deps, onDegrade) {
	const assistant = toPiAssistantTwins(message, deps, onDegrade);
	const content = assistant?.content ?? [];
	for (const block of content) if (block.type === "toolCall" && typeof block.id === "string") toolNames.set(block.id, block.name ?? "unknown");
	messages.push(assistant);
}
/** Append shared system, developer, and assistant roles; true when consumed (official context.ts:217-238). */
function appendSharedHistory(message, options, messages, toolNames, deps, onDegrade) {
	if (message.role === "developer") {
		appendDeveloper(message, options, messages, deps);
		return true;
	}
	if (message.role === "system") {
		const content = flattenText(message);
		if (content.length > 0) messages.push({
			role: "system",
			content,
			timestamp: 0
		});
		return true;
	}
	if (message.role === "assistant") {
		appendAssistant(message, messages, toolNames, deps, onDegrade);
		return true;
	}
	return false;
}
/**
* Convert text-only harness history to a synchronous pi-ai Context (official
* context.ts:240-257). Tool result names are recovered from preceding
* assistant tool calls. Images in ANY history role throw UNSUPPORTED_CONTENT
* (the S2 adapter has no attachment service; the stream-level gate throws
* first — this is the defensive mirror).
*/
function toPiContextTextOnly(options, deps, onDegrade) {
	if (!isRecord(options)) throw new deps.LlmError("zctx adapter requires GenerateOptions-like input", "INVALID_REQUEST");
	const harness = options;
	if (!Array.isArray(harness.messages)) throw new deps.LlmError("zctx adapter requires GenerateOptions.messages", "INVALID_REQUEST");
	assertSupportedHistory(harness.messages, deps);
	const split = splitSystemPrompt(harness);
	const toolNames = /* @__PURE__ */ new Map();
	const messages = [];
	for (const message of split.messages) {
		if (contentHasType(message, "image")) throw new deps.LlmError("pi-ai image conversion requires the durable attachment service", "UNSUPPORTED_CONTENT");
		if (contentHasType(message, "file")) throw new deps.LlmError("zctx adapter received an unprojected file block", "INVALID_REQUEST");
		if (appendSharedHistory(message, harness, messages, toolNames, deps, onDegrade)) continue;
		if (message.role === "tool") {
			messages.push(toolResultOf(message, toolNames, flattenText(message)));
			continue;
		}
		messages.push({
			role: "user",
			content: flattenText(message),
			timestamp: 0
		});
	}
	return piContext(split.systemPrompt, harness, messages);
}
// src/adapter/wire.ts
/**
* Wire-observation faces for the zctx adapter — the v0.2.0 V5 wire ledger
* (task card product 4; RES-adapter-route F7.1/F7.2/F9.6, redline R1/R7).
*
* TWO observation points, both PASS-THROUGH:
*
*  1. `onPayload` (pi-ai ProviderRequestOptions, dist/types.d.ts:80 — 1.0.2
*     anchor; the official dsh adapter does NOT forward it, F7.4, which is
*     why the wire ledger needs this adapter at all): receives the serialized
*     pre-send payload OBJECT; hashes it with stableStringify + sha256
*     (deterministic, but NOT the wire bytes) and returns `undefined`
*     CONSTANTLY — "return undefined to keep" (R1: 零 body 改写，onPayload
*     只观测不 replace——返回 undefined 恒定).
*  2. custom `fetch` (dist/types.d.ts:52/:69): receives the FINAL HTTP
*     RequestInfo — init.body IS the wire byte string — hashes the bytes,
*     records byteLength, and forwards to the REAL fetch untouched.
*
* ATTRIBUTION (F9.6/R7): `attributionHeaders()` MUST ride every provider
* HTTP request. The official llm-pi-ai merges deployment headers so the
* attribution names WIN collisions (adapter.ts:215-223 requestHeaders); this
* module carries the same merge (deployment headers minus case-insensitive
* attribution collisions, attribution last). The S2 config has no headers
* field, so the merge runs over an empty deployment set today — the merge
* logic is carried so a future headers knob plugs in without touching R7.
*
* Every record lands through the injected sink as a WireSnapshot
* (domain: 'wire'); unattributable requests (no session id) are NOT
* recorded — the wire domain covers session-bound zctx requests only
* (plan §3: "wire 域（字节哈希，仅 zctx 路由会话覆盖）").
*
* @module adapter/wire
*/
/**
* Build the wire faces for ONE stream call. `sink` is absent → the faces
* still observe (cheap) but record nothing — no, honest simplification:
* with no sink there is no ledger, so a no-op sink is equivalent; the faces
* are built ONLY when a sink exists (the adapter passes one always — the
* wiring decides coverage).
*/
function buildWireFaces(identity, sink, host) {
	const record = (kind, sha256, byteLength) => {
		if (sink === void 0) return;
		sink({
			domain: "wire",
			sessionId: identity.sessionId,
			provider: identity.provider,
			model: identity.model,
			kind,
			sha256,
			...byteLength !== void 0 ? { byteLength } : {},
			...identity.imageCount !== void 0 ? { imageCount: identity.imageCount } : {},
			time: Date.now()
		});
	};
	const onPayload = (payload, _model) => {
		try {
			const serialized = stableStringify(payload);
			if (typeof serialized === "string") record("request-payload", sha256Hex(serialized));
		} catch {}
	};
	const fetch = async (input, init) => {
		try {
			const body = init?.body;
			if (typeof body === "string" && body.length > 0) record("request-bytes", sha256Hex(body), new TextEncoder().encode(body).length);
			else if (body instanceof Uint8Array && body.length > 0) record("request-bytes", sha256HexBytes(body), body.byteLength);
		} catch {}
		return globalThis.fetch(input, init);
	};
	return {
		onPayload,
		fetch,
		headers: requestHeaders(void 0, host)
	};
}
/** sha256 over raw bytes (hash.ts's sha256Hex is string-based). @internal */
function sha256HexBytes(bytes) {
	return sha256Hex(new TextDecoder().decode(bytes));
}
/**
* Merge deployment headers with the attribution headers, attribution names
* WINNING case-insensitively (official llm-pi-ai adapter.ts:215-223 port).
* R7: the attribution set MUST reach the wire; collisions are removed from
* the deployment set rather than reordered after it.
*/
function requestHeaders(deployment, host) {
	const attribution = host.attributionHeaders();
	const reserved = new Set(Object.keys(attribution).map((name) => name.toLowerCase()));
	return {
		...Object.fromEntries(Object.entries(deployment ?? {}).filter(([name]) => !reserved.has(name.toLowerCase()))),
		...attribution
	};
}
// src/adapter/zctx-adapter.ts
/**
* The zctx thin adapter — `ZctxAdapter extends LlmAdapter` (task card V5
* product 1; RES-adapter-route §11b S2 形态二: 自定义 provider 名 + 寄生
* pi-ai 传输栈，只扛映射与分类，不扛传输语义).
*
* CLASS CONSTRUCTION: the official `LlmAdapter` is an ABSTRACT CLASS
* (types: index.ts:211-294) obtained through the fail-soft optional import
* (adapter/host.ts). The import is async, so the concrete class is built by
* {@link createZctxAdapterClass} over the loaded base — the wiring layer
* (plugin.ts) awaits the faces first and SKIPS the whole adapter face when
* the base is unreachable (card constraint: 宿主不可达→adapter 面整体不注册
* +诚实日志，永不炸 boot，五面降级先例).
*
* MEMBER DECISIONS (card: "providerInfo/providerRetryPolicy 按 F2 表决策并注明"):
*   - stream          — the ONLY required member (F2.1); everything below has
*                       an official default we either keep or override.
*   - providerInfo    — OVERRIDDEN: `displayName` must surface the configured
*                       name (`zctx <family>`), not the raw route key —
*                       "a label only the configuration surface reads would
*                       leave every selector showing the raw key"
*                       (llm-pi-ai/src/adapter.ts:276-281 rationale).
*   - providerRetryPolicy — NOT overridden: returns undefined → the runtime
*                       freezes the DEFAULT policy (F1.5/F5.5: EMPTY_RESPONSE/
*                       RATE_LIMIT/SERVER/TIMEOUT/TRANSPORT, 5 attempts,
*                       500ms exponential + 10s cap + jitter) — the agent
*                       recovery layer owns visible attempts (R4 discipline;
*                       llm-retry/src/index.ts:243).
*   - imageRequestPricing — NOT overridden (undefined → caller-side estimate;
*                       S2 is text-only. P3 HF-01 honesty: on the OFFICIAL
*                       dispatch path images never reach this adapter at all —
*                       the runtime projects them to placeholder text before
*                       dispatch — so the UNSUPPORTED_CONTENT gate below is a
*                       DEFENSIVE MIRROR, reachable only on direct-adapter
*                       calls; wire records carry imageCount for observability).
*   - listModels      — OVERRIDDEN: from settings providers[].models (card).
*   - resolveModel    — OVERRIDDEN: contextWindow comes from the config and
*                       was validated at construction (INVALID_MODEL_CONTEXT
*                       semantics — F2.2 normalizeModelInfo re-validates at
*                       runtime; a bad declaration can never reach it).
*   - prepareCall     — OVERRIDDEN: the official snapshot-freeze semantics
*                       (one resolution per call; adapter.ts:330-336) — the
*                       model info the stream uses is the one resolved at
*                       prepare time.
*
* ERROR TWO-PATHS (F5.2): transport/protocol failures THROW LlmError with
* codes from the official taxonomy (the runtime normalizes a throw into the
* terminal error/aborted finish, index.ts:1172-1180); provider in-band
* failures arrive as pi-ai error events and become error finish CHUNKS
* through the mapping face (the harness's other sanctioned path). R4: the
* SDK retry budget is pinned to ZERO (one adapter call is one SDK attempt —
* the agent recovery layer owns visible retries).
*
* R1: zero body rewriting — the adapter inspects (onPayload, v5s3) but never
* replaces a payload. R3: the adapter never calls ctx.llm.stream — it drives
* pi-ai directly, so the recursion surface does not exist structurally.
*
* @module adapter/zctx-adapter
*/
/** The official escalation order for the OFFERED effort list (catalog.ts:69-86). */
const THINKING_LEVEL_ORDER = [
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max"
];
/**
* The offered efforts for one model: the DISTINCT pi-ai levels its config
* maps (values of the wire-spelling dict), in the official escalation order.
* A model with no efforts entry (or `false`) offers nothing — omitting
* `reasoning` entirely is the seam's way of saying the capability is
* unavailable (official adapter.ts:198-213 rationale).
*/
function reasoningInfoOf(efforts) {
	if (!efforts || typeof efforts !== "object") return {};
	const levels = [...new Set(Object.values(efforts))];
	if (levels.length === 0) return {};
	return { reasoning: { efforts: levels.sort((a, b) => {
		const ia = THINKING_LEVEL_ORDER.indexOf(a);
		const ib = THINKING_LEVEL_ORDER.indexOf(b);
		return (ia === -1 ? THINKING_LEVEL_ORDER.length : ia) - (ib === -1 ? THINKING_LEVEL_ORDER.length : ib);
	}).map((level) => ({
		id: level,
		name: `${level.charAt(0).toUpperCase()}${level.slice(1)}`
	})) } };
}
/** Validate a config-declared effort against the model's offered levels (official adapter.ts:168-180). */
function resolveReasoningLevel(route, modelId, efforts, requested, deps) {
	if (!(!efforts || typeof efforts !== "object" ? [] : [...new Set(Object.values(efforts))]).includes(requested)) throw new deps.LlmError(`zctx provider "${route}" model "${modelId}" does not support reasoning effort "${requested}"`, "UNSUPPORTED_REASONING_EFFORT");
	return requested;
}
/**
* Materialize the pi-ai Model descriptor for one config model (structural —
* pi-ai's BaseModel/Model require id/name/api/provider/baseUrl/input/cost +
* contextWindow/maxTokens/reasoning; cost zeros: self-hosted pricing is the
* deployment's business, not the adapter's claim). contextWindow/maxTokens
* are REQUIRED config declarations (construction-gated in providers.ts —
* missing values never reach this function). The wire-spelling efforts
* dict materializes as `thinkingLevelMap` (pi-ai types.d.ts ThinkingLevelMap:
* key = pi-ai level, value = wire spelling or null).
*/
function materializePiModel(spec, model) {
	const thinkingLevelMap = model.reasoningEfforts && typeof model.reasoningEfforts === "object" ? Object.fromEntries(Object.entries(model.reasoningEfforts).map(([wire, level]) => [level, wire])) : void 0;
	return {
		id: model.id,
		name: model.name,
		api: spec.protocol,
		provider: spec.route,
		baseUrl: spec.baseURL ?? "",
		input: ["text"],
		cost: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0
		},
		reasoning: thinkingLevelMap !== void 0,
		contextWindow: model.contextWindow,
		maxTokens: model.maxTokens,
		...thinkingLevelMap !== void 0 ? { thinkingLevelMap } : {},
		...spec.cacheControlFormat !== void 0 ? { compat: { cacheControlFormat: spec.cacheControlFormat } } : {}
	};
}
/**
* Build the concrete adapter class over the loaded LlmAdapter base. The
* runtime duck-types every member (F1.1 registerAdapter calls the members;
* `extends` pins the abstract contract the card requires).
*/
function createZctxAdapterClass(Base) {
	return class ZctxAdapter extends Base {
		deps;
		constructor(deps) {
			super();
			this.deps = deps;
		}
		/** The spec for one route, or the official not-owned failure (adapter.ts:254-261). */
		specOf(provider) {
			const spec = this.deps.providers.find((candidate) => candidate.route === provider);
			if (spec === void 0) throw new this.deps.host.LlmError(`zctx adapter does not own provider "${provider}" (registered routes: ${this.deps.providers.map((p) => p.route).join(", ") || "none"})`, "NO_ADAPTER");
			return spec;
		}
		/** The model descriptor for one route/model pair (UNKNOWN_MODEL when absent, adapter.ts:263-274). */
		modelOf(provider, model) {
			const spec = this.specOf(provider);
			const found = spec.models.find((candidate) => candidate.id === model);
			if (found === void 0) throw new this.deps.host.LlmError(`zctx provider "${provider}" has no configured model "${model}"`, "UNKNOWN_MODEL");
			return {
				spec,
				model: found
			};
		}
		/** The resolved model info (runtime re-validates per F2.2; construction already gated contextWindow). */
		modelInfoOf(provider, model) {
			const { spec, model: found } = this.modelOf(provider, model);
			return {
				provider,
				id: found.id,
				name: found.name,
				inputModalities: ["text"],
				context: { contextWindow: found.contextWindow },
				...found.maxTokens !== void 0 ? { defaultMaxTokens: found.maxTokens } : {},
				...reasoningInfoOf(found.reasoningEfforts)
			};
		}
		/** F4.3 credential chain: named env ref fails LOUD when missing (no ambient fallback). */
		resolveApiKey(spec) {
			if (spec.apiKeyEnv === void 0) return void 0;
			const value = process.env[spec.apiKeyEnv];
			if (value === void 0 || value === "") throw new this.deps.host.LlmError(`zctx provider "${spec.route}" names credential env "${spec.apiKeyEnv}" but it is not set — export it (configuration carries the reference, never the secret)`, "MISSING_CREDENTIAL");
			return value;
		}
		providerInfo(provider) {
			return {
				id: provider,
				name: this.specOf(provider).displayName
			};
		}
		/**
		* F2 decision (noted per card): NOT overridden — `undefined` lets the
		* runtime freeze the DEFAULT retry policy (F1.5/F5.5). The SDK budget is
		* pinned to zero separately (R4); the agent recovery layer owns retries.
		*/
		providerRetryPolicy(_provider) {}
		listModels(provider) {
			return Promise.resolve().then(() => {
				return this.specOf(provider).models.map((model) => ({
					provider,
					id: model.id,
					name: model.name,
					inputModalities: ["text"]
				}));
			});
		}
		resolveModel(provider, model, _signal) {
			return Promise.resolve().then(() => this.modelInfoOf(provider, model));
		}
		prepareCall(provider, model, _signal) {
			const info = this.modelInfoOf(provider, model);
			return Promise.resolve({
				model: info,
				stream: (options) => this.streamWithFrozenInfo(options, info)
			});
		}
		stream(options) {
			return this.streamWithFrozenInfo(options, void 0);
		}
		async *streamWithFrozenInfo(rawOptions, frozenInfo) {
			const { host, piAi, mapping } = this.deps;
			if (typeof rawOptions !== "object" || rawOptions === null) throw new host.LlmError("zctx adapter requires GenerateOptions-like input", "INVALID_REQUEST");
			const options = rawOptions;
			if (options.stop !== void 0) throw new host.LlmError("zctx adapter does not support GenerateOptions.stop", "UNSUPPORTED_OPTION");
			if (typeof options.provider !== "string" || typeof options.model !== "string") throw new host.LlmError("zctx adapter requires string provider and model", "INVALID_REQUEST");
			if (!Array.isArray(options.messages)) throw new host.LlmError(`zctx adapter requires an array of messages (got ${options.messages === void 0 ? "undefined" : typeof options.messages})`, "INVALID_REQUEST");
			const { spec, model } = this.modelOf(options.provider, options.model);
			const modelInfo = frozenInfo ?? this.modelInfoOf(options.provider, options.model);
			const apiKey = this.resolveApiKey(spec);
			const imageCount = options.messages.filter((message) => {
				if (typeof message !== "object" || message === null) return false;
				return host.contentHasImage(message.content);
			}).length;
			if (imageCount > 0) throw new host.LlmError(`zctx model "${model.id}" does not support image input (S2 adapter is text-only)`, "UNSUPPORTED_CONTENT");
			const reasoning = options.reasoningEffort === void 0 ? void 0 : resolveReasoningLevel(spec.route, model.id, model.reasoningEfforts, options.reasoningEffort, {
				LlmError: host.LlmError,
				CONTEXT_WINDOW_EXCEEDED_CODE: host.CONTEXT_WINDOW_EXCEEDED_CODE,
				EMPTY_RESPONSE_CODE: host.EMPTY_RESPONSE_CODE,
				QUOTA_EXCEEDED_CODE: host.QUOTA_EXCEEDED_CODE,
				isContextWindowExceededError: host.isContextWindowExceededError,
				isQuotaExceededError: host.isQuotaExceededError
			});
			const consumer = new AbortController();
			const upstream = options.signal === void 0 ? consumer.signal : AbortSignal.any([options.signal, consumer.signal]);
			try {
				const api = await piAi.loadApi(spec.protocol);
				if (api === void 0) throw new host.LlmError(`zctx provider "${spec.route}" names protocol "${spec.protocol}", which this build cannot serve`, "UNSUPPORTED_OPTION");
				const context = toPiContextTextOnly(rawOptions, {
					LlmError: host.LlmError,
					CONTEXT_WINDOW_EXCEEDED_CODE: host.CONTEXT_WINDOW_EXCEEDED_CODE,
					EMPTY_RESPONSE_CODE: host.EMPTY_RESPONSE_CODE,
					QUOTA_EXCEEDED_CODE: host.QUOTA_EXCEEDED_CODE,
					isContextWindowExceededError: host.isContextWindowExceededError,
					isQuotaExceededError: host.isQuotaExceededError
				}, (reason) => {
					this.deps.logger?.warn?.(`dsh-zcontext: assistant replay state degraded to provider-neutral (${reason})`);
				});
				const piModel = materializePiModel(spec, model);
				const window = modelInfo["context"] !== void 0 ? modelInfo["context"].contextWindow ?? model.contextWindow : model.contextWindow;
				const sessionId = typeof options.sessionId === "string" && options.sessionId.length > 0 ? options.sessionId : void 0;
				const wireFaces = sessionId === void 0 ? void 0 : buildWireFaces({
					sessionId,
					provider: spec.route,
					model: model.id,
					imageCount
				}, this.deps.wireSink, host);
				const events = api.streamSimple(piModel, context, {
					...apiKey === void 0 ? {} : { apiKey },
					...reasoning === void 0 ? {} : { reasoning },
					...spec.cacheRetention === void 0 ? {} : { cacheRetention: spec.cacheRetention },
					...options.maxTokens === void 0 ? {} : { maxTokens: options.maxTokens },
					...options.temperature === void 0 ? {} : { temperature: options.temperature },
					...sessionId === void 0 ? {} : { sessionId },
					...wireFaces === void 0 ? {} : { onPayload: wireFaces.onPayload },
					...wireFaces === void 0 ? {} : { fetch: wireFaces.fetch },
					headers: wireFaces?.headers ?? requestHeaders(void 0, host),
					signal: upstream,
					maxRetries: 0
				});
				yield* mapping.toStreamChunks(events, window, options.signal, model.id);
			} catch (error) {
				if (options.signal?.aborted) throw new host.LlmError("zctx request aborted by caller", "ABORTED", { cause: error });
				if (error instanceof host.LlmError) throw error;
				const message = error instanceof Error ? error.message : String(error);
				throw new host.LlmError(`zctx transport failure: ${message}`, classifyPiAiErrorTwins(message, {
					LlmError: host.LlmError,
					CONTEXT_WINDOW_EXCEEDED_CODE: host.CONTEXT_WINDOW_EXCEEDED_CODE,
					EMPTY_RESPONSE_CODE: host.EMPTY_RESPONSE_CODE,
					QUOTA_EXCEEDED_CODE: host.QUOTA_EXCEEDED_CODE,
					isContextWindowExceededError: host.isContextWindowExceededError,
					isQuotaExceededError: host.isQuotaExceededError
				}), { cause: error });
			} finally {
				consumer.abort("zctx stream consumer stopped");
			}
		}
	};
}
// src/adapter/host.ts
/**
* Optional host faces for the S2 adapter — fail-soft lazy loaders for the
* three host surfaces the zctx adapter rides (task card V5 product 1/2;
* RES-adapter-route F5.9 "借力清单", F7.4, U2 probe).
*
* Zero static host imports (the config.ts / host-llm.ts fail-soft precedent):
* every loader dynamic-imports and returns `undefined` when the surface is
* unreachable. The plugin wiring treats `undefined` as "adapter face is not
* registrable" and logs honestly — the adapter face NEVER breaks boot.
*
* Three surfaces, each with its own probe convention:
*
*  1. `@deepseek-ai/dsh-llm` (BUILT lib) — the LlmAdapter abstract base the
*     card requires (`ZctxAdapter extends LlmAdapter`), the official error
*     taxonomy (LlmError, the *_CODE constants, the two overflow/quota
*     classifiers) and attributionHeaders (F9.6). Override: `ZCTX_DSH_LLM`
*     (same convention as host-llm.ts; U2 probe: 16/16 live on disk).
*  2. `@earendil-works/pi-ai` (1.0.2 dist, R8 anchor) — the transport engine:
*     `isContextOverflow` (utils/overflow re-exported from the root) and the
*     per-protocol stream implementations (`./api/<protocol>` exporting
*     `stream`/`streamSimple` directly — probed live, so the adapter calls
*     the API module WITHOUT building a Models collection; coordinator note
*     recorded on this finding). Override: `ZCTX_PIAI`.
*  3. `@deepseek-ai/dsh-llm-pi-ai/src/{stream,replay}` (TS sources — the
*     package publishes `exports ./src/*`) — the official chunk-mapping
*     pieces (`toStreamChunks`/`mapUsage`/`mapStopReason`/`toPiReplayState`/
*     `toPiAssistant`). When reachable the adapter maps events through the
*     OFFICIAL implementation; when unreachable the self-replicated twins in
*     `map.ts`/`replay.ts` take over and every record they touch is labeled
*     `zctx-mapping` (honest provenance, same discipline as host-llm.ts).
*     `classifyPiAiError` is module-private upstream (src/stream.ts:42 has no
*     export) so the twin ALWAYS supplies it (the adapter's catch path uses
*     it directly regardless of the mapping source). Override:
*     `ZCTX_DSH_LLM_PIAI` (points at the llm-pi-ai package root directory).
*
* Loading is lazy and memoized per process; `resetAdapterFacesForTest`
* drops the memoization (two-path tests, same seam as host-llm.ts).
*
* @module adapter/host
*/
/** Resolve one override value into an importable specifier. @internal */
function overrideSpecifier(override) {
	if (override.startsWith("file:")) return override;
	if (isAbsolute(override)) return pathToFileURL(resolve(override)).href;
	return override;
}
/**
* Derive a member-file URL from a package-root override. The override may
* name the package root directory (…/llm-pi-ai), a file: URL of it, or an
* inner file (…/src/stream.ts, …/dist/index.js) — an inner file climbs back
* to the package root by dropping the known src/lib/dist segment.
* @internal
*/
function rootOverrideFileUrl(override, relative) {
	let raw = override;
	if (raw.startsWith("file:")) try {
		raw = fileURLToPath(new URL(raw));
	} catch {
		return;
	}
	if (!isAbsolute(raw)) return void 0;
	let root = resolve(raw);
	const tail = /[/\\](?:src|lib|dist)[/\\][^/\\]+$/;
	if (tail.test(root)) root = root.replace(tail, "");
	return pathToFileURL(resolve(root, relative)).href;
}
async function importOptional(specifier) {
	try {
		return await import(specifier);
	} catch {
		return;
	}
}
const HOST_LLM_SPECIFIER = "@deepseek-ai/dsh-llm";
/** Every member the adapter face needs from the host lib (all-or-nothing). */
function buildHostLlmFace(mod) {
	for (const member of [
		"LlmAdapter",
		"LlmError",
		"CONTEXT_WINDOW_EXCEEDED_CODE",
		"EMPTY_RESPONSE_CODE",
		"QUOTA_EXCEEDED_CODE",
		"IMAGE_OFFLOAD_REQUIRED_CODE",
		"isContextWindowExceededError",
		"isQuotaExceededError",
		"attributionHeaders",
		"contentHasImage"
	]) if (mod[member] === void 0) return void 0;
	if (typeof mod.LlmAdapter !== "function" || typeof mod.LlmError !== "function") return void 0;
	if (typeof mod.isContextWindowExceededError !== "function" || typeof mod.isQuotaExceededError !== "function") return;
	if (typeof mod.attributionHeaders !== "function" || typeof mod.contentHasImage !== "function") return;
	return mod;
}
async function loadHostLlmFace() {
	const override = process.env.ZCTX_DSH_LLM;
	const mod = await importOptional(override === void 0 || override === "" ? HOST_LLM_SPECIFIER : overrideSpecifier(override));
	return mod === void 0 ? void 0 : buildHostLlmFace(mod);
}
const PI_AI_SPECIFIER = "@earendil-works/pi-ai";
const LLM_PI_AI_SPECIFIER = "@deepseek-ai/dsh-llm-pi-ai";
/**
* The BUILTIN fallback protocol list (official llm-pi-ai PROTOCOLS table,
* llm-pi-ai/src/provider.ts:47-51). The AUTHORITATIVE gate is the official
* `supportedProtocols()` union loaded dynamically (coordinator A-ruling:
* "官方 union 单源对拍防漂移 — supportedProtocols() 动态取，宿主升级加协议
* 我们自动跟"); this constant is only the honest fallback when the
* llm-pi-ai lib cannot resolve.
*/
const KNOWN_PROTOCOLS = [
	"openai-completions",
	"openai-responses",
	"anthropic-messages"
];
/**
* The wire-protocol union the config `family` values are validated against.
* Source of truth: the official llm-pi-ai lib's `supportedProtocols()` (its
* package main exports it — probed live); when that package is unreachable,
* the {@link KNOWN_PROTOCOLS} fallback applies with `source: 'builtin'` so
* callers can label the provenance honestly.
*/
async function loadSupportedProtocols() {
	const override = process.env.ZCTX_DSH_LLM_PIAI;
	if (override === void 0 || override === "") {
		const mod = await importOptional(LLM_PI_AI_SPECIFIER);
		if (mod !== void 0 && typeof mod["supportedProtocols"] === "function") return {
			protocols: mod["supportedProtocols"](),
			source: "official"
		};
		return {
			protocols: KNOWN_PROTOCOLS,
			source: "builtin"
		};
	}
	const libUrl = rootOverrideFileUrl(override, "lib/index.js");
	if (libUrl !== void 0) {
		const mod = await importOptional(libUrl);
		if (mod !== void 0 && typeof mod["supportedProtocols"] === "function") return {
			protocols: mod["supportedProtocols"](),
			source: "official"
		};
	}
	return {
		protocols: KNOWN_PROTOCOLS,
		source: "builtin"
	};
}
function buildPiAiFace(mod, apiSpecifier) {
	const isContextOverflow = mod["isContextOverflow"];
	if (typeof isContextOverflow !== "function") return void 0;
	return {
		isContextOverflow,
		loadApi: async (protocol) => {
			const apiMod = await importOptional(apiSpecifier(protocol));
			if (apiMod === void 0) return void 0;
			const stream = apiMod["stream"];
			const streamSimple = apiMod["streamSimple"];
			if (typeof stream !== "function" || typeof streamSimple !== "function") return void 0;
			return {
				stream,
				streamSimple
			};
		}
	};
}
async function loadPiAiFace() {
	const override = process.env.ZCTX_PIAI;
	if (override === void 0 || override === "") {
		const mod = await importOptional(PI_AI_SPECIFIER);
		if (mod === void 0) return void 0;
		return buildPiAiFace(mod, (protocol) => `${PI_AI_SPECIFIER}/api/${protocol}`);
	}
	if (!override.startsWith("file:") && !isAbsolute(override)) {
		const mod = await importOptional(override);
		if (mod === void 0) return void 0;
		return buildPiAiFace(mod, (protocol) => `${override}/api/${protocol}`);
	}
	let rootSpecifier = overrideSpecifier(override);
	if (isDirectoryPath(rootSpecifier)) rootSpecifier = rootSpecifier.replace(/\/+$/, "") + "/dist/index.js";
	const mod = await importOptional(rootSpecifier);
	if (mod === void 0) return void 0;
	return buildPiAiFace(mod, (protocol) => {
		const url = rootOverrideFileUrl(override, `dist/api/${protocol}.js`);
		if (url === void 0) throw new TypeError(`ZCTX_PIAI override "${override}" cannot derive api path`);
		return url;
	});
}
/** True when the (already converted) specifier points at a directory on disk. @internal */
function isDirectoryPath(specifier) {
	try {
		const raw = specifier.startsWith("file:") ? fileURLToPath(new URL(specifier)) : specifier;
		if (!isAbsolute(raw)) return false;
		return statSync(raw).isDirectory();
	} catch {
		return false;
	}
}
/**
* Build the mapping face: the official stream/replay exports when BOTH source
* modules resolve completely; the labeled twins otherwise. A host build that
* ships only one of the two modules degrades WHOLESALE to the twins — a mixed
* mapping face would understate the divergence risk (host-llm.ts precedent).
*/
async function loadMappingFace(host, piAi) {
	const { buildMappingTwins } = await import("./twins-CQIDe2rX.js");
	const twins = buildMappingTwins({
		LlmError: host.LlmError,
		CONTEXT_WINDOW_EXCEEDED_CODE: host.CONTEXT_WINDOW_EXCEEDED_CODE,
		EMPTY_RESPONSE_CODE: host.EMPTY_RESPONSE_CODE,
		QUOTA_EXCEEDED_CODE: host.QUOTA_EXCEEDED_CODE,
		isContextWindowExceededError: host.isContextWindowExceededError,
		isQuotaExceededError: host.isQuotaExceededError
	}, piAi.isContextOverflow);
	const override = process.env.ZCTX_DSH_LLM_PIAI;
	const bareRoot = "@deepseek-ai/dsh-llm-pi-ai";
	let streamMod;
	let replayMod;
	if (override === void 0 || override === "") {
		const [stream, replay] = await Promise.all([importOptional(`${bareRoot}/src/stream.ts`), importOptional(`${bareRoot}/src/replay.ts`)]);
		streamMod = stream;
		replayMod = replay;
	} else {
		const streamUrl = rootOverrideFileUrl(override, "src/stream.ts");
		const replayUrl = rootOverrideFileUrl(override, "src/replay.ts");
		if (streamUrl !== void 0 && replayUrl !== void 0) {
			const [stream, replay] = await Promise.all([importOptional(streamUrl), importOptional(replayUrl)]);
			streamMod = stream;
			replayMod = replay;
		}
	}
	const complete = streamMod !== void 0 && replayMod !== void 0 && typeof streamMod.mapUsage === "function" && typeof streamMod.mapStopReason === "function" && typeof streamMod.toStreamChunks === "function" && typeof replayMod.toPiReplayState === "function" && typeof replayMod.toPiAssistant === "function";
	if (streamMod === void 0 || replayMod === void 0 || !complete) return twins;
	return {
		source: "official-pi-ai-mapping",
		mapUsage: streamMod.mapUsage,
		mapStopReason: streamMod.mapStopReason,
		toStreamChunks: streamMod.toStreamChunks,
		toPiReplayState: replayMod.toPiReplayState,
		toPiAssistant: replayMod.toPiAssistant
	};
}
let cached;
/**
* Load all three faces. SUCCESS is memoized per process (two callers share
* one loaded face set); an ABSENT result (host lib unreachable, pi-ai
* unreachable, or a pi-ai build missing isContextOverflow — all the same
* "face absent" honest path) is NOT memoized: the next call re-attempts the
* load. Rationale (P4): a memoized absence permanently locked later callers
* out — an eager face load from an earlier plugin mount (e.g. the P4 patch
* bridge probing before a later mount's env override was in place) would
* poison every subsequent adapter-face registration for the process life
* (probe-real-mount G4 regression, 2026-11-14). Never a throw, never a
* permanently-memoized rejection (P3 HF-13), now never a permanently-memoized
* absence either.
*/
function loadAdapterFaces() {
	if (cached === void 0) {
		const attempt = (async () => {
			const host = await loadHostLlmFace();
			if (host === void 0) return void 0;
			const piAi = await loadPiAiFace();
			if (piAi === void 0) return void 0;
			return {
				host,
				piAi,
				mapping: await loadMappingFace(host, piAi)
			};
		})();
		cached = attempt;
		attempt.catch(() => void 0).then((faces) => {
			if (faces === void 0 && cached === attempt) cached = void 0;
		});
	}
	return cached;
}
// src/tools.ts
/**
* The four zctx tools — zctx_fold / zctx_unfold / zctx_recall / zctx_status —
* all wrapped through the official `defineTool` authoring contract (task card
* W4 §1, plan §3 S3/S8).
*
* defineTool resolution is structural + fail-soft: the host's
* `@deepseek-ai/dsh-tools` is required lazily; when absent, a local shim
* compiles the same author prop-map into the enforced JSON-Schema subset
* (object/properties/required) and validates arguments before execute — the
* registry-ready definition shape is identical either way.
*
* Schema discipline (S3): the official enforced subset only — object
* properties / required / array items, NO top-level combinators.
* `zctx_fold` takes ONE `content: string` (required) carrying all ranges and
* summaries; the lenient parser below is an independent implementation
* aligned with the billion-context parseCompressInput semantics (JSON-array
* tolerance, startId/startRef spellings, top-level single range, honest
* zero-range diagnostics) — no prompt text is copied.
*
* Concurrency discipline (S8): NONE of the four tools declares
* `isConcurrencySafe` — omission is the official exclusive barrier, which is
* the mutual-exclusion precondition of the fold commit path.
*
* Every execute is fail-soft: an unreachable session, a parse failure, or a
* rejected fold comes back as the tool's STRING result (the model-visible
* wording lives in texts.ts); nothing throws across the host boundary.
*
* @module tools
*/
const nodeRequire$1 = createRequire(import.meta.url);
/**
* Resolve the host's official defineTool lazily; `undefined` when the host
* package is absent (the shim below takes over — fail-soft, never throws).
*/
function loadHostDefineTool() {
	try {
		const mod = nodeRequire$1("@deepseek-ai/dsh-tools");
		const resolved = typeof mod?.defineTool === "function" ? mod.defineTool : void 0;
		zctxDebug(`loadHostDefineTool: '@deepseek-ai/dsh-tools' import OK; defineTool ${resolved === void 0 ? "NOT a function — shim takes over" : "resolved (official authoring contract)"}`);
		return resolved;
	} catch (error) {
		zctxDebug(`loadHostDefineTool: '@deepseek-ai/dsh-tools' import FAILED (${error instanceof Error ? error.message : String(error)}) — shim defineTool takes over`);
		return;
	}
}
/**
* Fail-soft defineTool shim: compiles the author prop-map into the enforced
* JSON-Schema subset and validates arguments before execute (official
* ToolArgsError semantics: `invalid arguments: <violations>`). Arguments are
* passed through untyped.
*/
function createShimDefineTool() {
	return (spec) => {
		const required = [];
		const properties = {};
		for (const [name, param] of Object.entries(spec.parameters)) {
			const node = { type: param.type };
			if (param.description !== void 0) node.description = param.description;
			properties[name] = node;
			if (param.required === true) required.push(name);
		}
		const validate = (args) => {
			const violations = [];
			const source = args !== null && typeof args === "object" ? args : {};
			for (const name of required) if (source[name] === void 0) violations.push(`${name}: required`);
			for (const [name, param] of Object.entries(spec.parameters)) {
				const value = source[name];
				if (value === void 0) continue;
				if (!(param.type === "string" ? typeof value === "string" : param.type === "number" ? typeof value === "number" && Number.isFinite(value) : typeof value === "boolean")) violations.push(`${name}: expected ${param.type}`);
			}
			if (violations.length > 0) throw new Error(`invalid arguments: ${violations.join("; ")}`);
			return source;
		};
		return {
			name: spec.name,
			description: spec.description,
			parameters: {
				type: "object",
				properties,
				...required.length > 0 ? { required } : {}
			},
			output: spec.output,
			async execute(args, exec) {
				const parsed = validate(args);
				return spec.execute(parsed, exec);
			}
		};
	};
}
/** Resolve defineTool: the host implementation when present, shim otherwise. */
function resolveDefineTool() {
	return loadHostDefineTool() ?? createShimDefineTool();
}
/**
* Parse one seq reference: plain digits, `m00012` message refs, or a
* `seq 12` prefix (billion-context ref vocabulary, base 10).
*/
function parseSeqRef(raw) {
	if (typeof raw !== "string" && typeof raw !== "number") return void 0;
	const text = String(raw).trim().toLowerCase();
	const match = /^(?:seq[ ._-]*)?m?0*(\d{1,9})$/.exec(text);
	if (match === null) return void 0;
	const value = Number(match[1]);
	return Number.isSafeInteger(value) ? value : void 0;
}
/** Header line of one text block: `fold 12..18 [topic]`, `seq 12..18`, or `m00012–m00018`. */
const HEADER_LINE = /^\s*(?:(?:fold|zctx)\s+)?(?:seq[ ._-]*)?(?:m?0*(\d{1,9}))\s*(?:\.\.|\u2026|\u2013|\u2014|-->|--|—|–|-)\s*(?:m?0*(\d{1,9}))\s*(.*)$/i;
/** Parse the text-block form: header lines interleaved with markdown bodies. */
function parseTextBlocks(content) {
	const blocks = [];
	const lines = content.split("\n");
	let current;
	for (const line of lines) {
		const match = HEADER_LINE.exec(line);
		if (match !== null && match[1] !== void 0 && match[2] !== void 0) {
			if (current !== void 0) blocks.push({
				startSeq: current.startSeq,
				endSeq: current.endSeq,
				text: current.body.join("\n").trim()
			});
			current = {
				startSeq: Number(match[1]),
				endSeq: Number(match[2]),
				body: []
			};
			continue;
		}
		if (current !== void 0) current.body.push(line);
	}
	if (current !== void 0) blocks.push({
		startSeq: current.startSeq,
		endSeq: current.endSeq,
		text: current.body.join("\n").trim()
	});
	return blocks.filter((b) => b.text.length > 0);
}
/** One JSON range object (parseCompressInput's toRange twin). */
function jsonRangeToObject(entry) {
	if (entry === null || typeof entry !== "object") return void 0;
	const record = entry;
	const startRaw = record.startId !== void 0 ? record.startId : record.startRef;
	const endRaw = record.endId !== void 0 ? record.endId : record.endRef;
	const startSeq = parseSeqRef(startRaw);
	const endSeq = parseSeqRef(endRaw);
	const text = record.summary;
	if (startSeq === void 0 || endSeq === void 0 || typeof text !== "string") return void 0;
	return {
		startSeq,
		endSeq,
		text: text.trim()
	};
}
/**
* Lenient parse of the zctx_fold `content` argument. Accepts (in order):
* a JSON-encoded array of `{startId|startRef, endId|endRef, summary}`
* objects (gateways that stringify arrays), a single top-level range object,
* and the plain text-block form — each block a `fold <start>..<end> [topic]`
* header line followed by its markdown summary. Returns the window hull plus
* the per-block summaries, or a diagnostic reason (honest zero-range
* reporting, no silent guess).
*/
function parseFoldContent(content) {
	if (typeof content !== "string" || content.trim().length === 0) return {
		ok: false,
		reason: FOLD_PARSE_EMPTY
	};
	const blocks = [];
	try {
		const parsed = JSON.parse(content);
		if (Array.isArray(parsed)) for (const entry of parsed) {
			const block = jsonRangeToObject(entry);
			if (block !== void 0) blocks.push(block);
		}
		else if (parsed !== null && typeof parsed === "object") {
			const block = jsonRangeToObject(parsed);
			if (block !== void 0) blocks.push(block);
		} else if (typeof parsed === "string") blocks.push(...parseTextBlocks(parsed));
	} catch {}
	if (blocks.length === 0) blocks.push(...parseTextBlocks(content));
	if (blocks.length === 0) return {
		ok: false,
		reason: FOLD_PARSE_EMPTY
	};
	const valid = blocks.filter((b) => b.startSeq <= b.endSeq);
	if (valid.length === 0) return {
		ok: false,
		reason: FOLD_PARSE_EMPTY
	};
	return {
		ok: true,
		range: {
			startSeq: Math.min(...valid.map((b) => b.startSeq)),
			endSeq: Math.max(...valid.map((b) => b.endSeq))
		},
		summaries: valid.map((b) => ({
			startSeq: b.startSeq,
			endSeq: b.endSeq,
			text: b.text
		}))
	};
}
/**
* Read the routed provider/model off a session's request header (the official
* routedTarget shape; undefined before the first routed request).
*/
function routedRequestTarget(session) {
	let header;
	try {
		header = session.requestHeader?.();
	} catch {
		return;
	}
	const config = header?.config;
	if (config === void 0) return void 0;
	const provider = config.provider;
	const model = config.model;
	if (typeof provider !== "string" || provider.length === 0) return void 0;
	if (typeof model !== "string" || model.length === 0) return void 0;
	return {
		provider,
		model
	};
}
/**
* Estimate-vs-reality statistics (card product 3): each comparable record's
* error is `(estimate − billedInput) / billedInput`, where billedInput is the
* DISJOINT-accounting input side (input + cacheRead + cacheWrite, §Q2.1) —
* the estimate approximates the prompt, not the output. Pure function over
* the store's calibration ledger; the renderer calls it at status time.
*
* V4-1 closure: records labeled `local-fallback` are EXCLUDED from the math
* (counted in the basis line) — the stats feed the enforce-mode calibration
* decision, and a fallback-twin estimate measures a different projection, not
* the official wire surface.
*/
function preflightCalibrationStats(records) {
	let comparable = 0;
	let errorSum = 0;
	let worst = 0;
	let shortCircuits = 0;
	let fallbackRows = 0;
	for (const record of records) {
		if (record.projector === "local-fallback") {
			fallbackRows += 1;
			continue;
		}
		if (record.outcome === "short-circuited") {
			shortCircuits += 1;
			continue;
		}
		const usage = record.usage;
		if (usage?.inputTokens === void 0) continue;
		const billed = usage.inputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0);
		if (!Number.isFinite(billed) || billed <= 0) continue;
		const errorPct = (record.estimate - billed) / billed * 100;
		comparable += 1;
		errorSum += errorPct;
		worst = Math.max(worst, Math.abs(errorPct));
	}
	return {
		comparable,
		meanErrorPct: comparable > 0 ? errorSum / comparable : 0,
		worstErrorPct: worst,
		shortCircuits,
		basis: fallbackRows > 0 ? `official only (excluded ${fallbackRows} uncalibrated local-fallback row(s))` : "official"
	};
}
/**
* Render the full status report. Every host face is capability-probed and
* degraded rows are collected honestly (S6: cache accounting carries the
* measured/estimated split; CCM §1.1: windows below 32768 render the
* below-domain note with tools still usable).
*/
async function renderStatus(runtime, session) {
	const lines = [];
	const degraded = [];
	const store = runtime.storeFor(session);
	const routedSession = session;
	let contextWindow;
	let maxOutput;
	const routed = routedRequestTarget(routedSession);
	if (routed === void 0) degraded.push("no routed provider/model yet (request header pending)");
	else if (runtime.llm === void 0 || typeof runtime.llm.resolveModelInfo !== "function") degraded.push("llm service unavailable: context window unknown");
	else try {
		const info = await runtime.llm.resolveModelInfo(routed.provider, routed.model);
		const window = info?.context?.contextWindow;
		if (typeof window === "number" && Number.isFinite(window) && window > 0) contextWindow = window;
		else degraded.push(`model ${routed.provider}/${routed.model} declares no context capacity`);
		if (typeof info?.defaultMaxTokens === "number" && info.defaultMaxTokens > 0) maxOutput = info.defaultMaxTokens;
	} catch (error) {
		degraded.push(`llm model info failed: ${error instanceof Error ? error.message : String(error)}`);
	}
	const configuredMax = routedSession.requestHeader?.()?.config?.maxTokens;
	if (typeof configuredMax === "number" && configuredMax > 0) maxOutput = configuredMax;
	let totalTokens;
	if (runtime.tokenMeter === void 0 || typeof runtime.tokenMeter.measure !== "function") degraded.push(STATUS_METER_UNAVAILABLE);
	else try {
		totalTokens = runtime.tokenMeter.measure(session).totalTokens;
	} catch (error) {
		degraded.push(`token meter failed: ${error instanceof Error ? error.message : String(error)}`);
	}
	let budget;
	if (contextWindow !== void 0) {
		const gate = ccmWindowGate(contextWindow);
		if (!gate.legal && gate.note !== void 0) lines.push(fill(STATUS_CCM_BELOW_DOMAIN, { window: contextWindow }));
		try {
			budget = computeBudget({
				contextWindow,
				...maxOutput !== void 0 ? { maxOutput } : {}
			});
		} catch (error) {
			degraded.push(`budget computation failed: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
	if (contextWindow !== void 0 && totalTokens !== void 0 && budget !== void 0) {
		lines.push(fill(STATUS_WINDOW_LINE, {
			tokens: totalTokens,
			pct: formatPct(totalTokens / contextWindow * 100),
			window: contextWindow,
			trigger: budget.triggerLine,
			triggerPct: formatPct(budget.triggerLine / contextWindow * 100)
		}));
		lines.push(STATUS_BUDGET_HEADER);
		for (const [label, value] of [
			["max output cap", budget.maxOutputCap],
			["reserve", budget.reserve],
			["pessimistic reserve", budget.pessimisticReserve],
			["keep-recent", budget.keepRecent],
			["summary input cap", budget.summaryInputCap],
			["reply cap", budget.replyCap]
		]) lines.push(fill(STATUS_BUDGET_ROW, {
			label,
			tokens: value
		}));
		lines.push(fill(STATUS_FIXED_WIRE_ROW, { tokens: budget.fixedWireOverhead }));
	} else lines.push(STATUS_WINDOW_UNKNOWN);
	lines.push(STATUS_RANGES_HEADER);
	const ranges = foldableRanges(store.surfaceNodes(), runtime.validatorConfig(session));
	if (ranges.length === 0) lines.push("  (empty surface)");
	else for (const range of ranges) {
		let row = fill(NUDGE_RANGE_ROW, {
			start: range.startSeq,
			end: range.endSeq,
			tokens: range.estimatedTokens
		});
		if (range.protected) {
			row += NUDGE_PROTECTED_MARKER;
			if (range.protectedReason !== void 0) row += ` (${range.protectedReason})`;
		}
		lines.push(row);
	}
	const entries = store.ledgerEntries();
	const activeCount = [...store.foldMap.keys()].length;
	lines.push(fill(STATUS_FOLDS_HEADER, { count: activeCount }));
	if (entries.length === 0) lines.push(STATUS_FOLDS_EMPTY);
	else for (const entry of entries) lines.push(fill(STATUS_FOLD_ROW, {
		foldId: `${entry.foldId} [${entry.status}]`,
		start: entry.startSeq,
		end: entry.endSeq,
		seq: entry.checkpointSeq,
		before: entry.tokensBefore,
		after: entry.tokensAfter
	}));
	const anomalies = store.anomalies();
	if (anomalies.length === 0) lines.push(STATUS_ANOMALIES_EMPTY);
	else {
		lines.push(fill(STATUS_ANOMALIES_HEADER, { count: anomalies.length }));
		for (const anomaly of anomalies) lines.push(fill(STATUS_ANOMALY_ROW, {
			kind: anomaly.kind,
			detail: anomaly.detail
		}));
	}
	const usage = store.usageSnapshot();
	if (usage.samples === 0) lines.push(STATUS_USAGE_NONE);
	else if (usage.measured && usage.latest?.measured === true) lines.push(fill(STATUS_USAGE_MEASURED, {
		samples: usage.samples,
		plural: usage.samples === 1 ? "" : "s",
		read: usage.latest.cacheReadTokens ?? "n/a",
		write: usage.latest.cacheWriteTokens ?? "n/a"
	}));
	else lines.push(fill(STATUS_USAGE_ESTIMATED, {
		samples: usage.samples,
		plural: usage.samples === 1 ? "" : "s"
	}));
	try {
		const snapshot = store.observabilitySnapshot();
		const attributionByFold = /* @__PURE__ */ new Map();
		for (const attribution of store.foldAttributions()) attributionByFold.set(attribution.foldId, attribution);
		const emptyLedger = entries.length === 0;
		const confidenceOk = snapshot.cleanSampleRatio >= runtime.cleanSampleFloor;
		const repaidText = !emptyLedger && !confidenceOk ? STATUS_OBS_SESSION_REPAID_WITHHELD : String(snapshot.breakevenTable.filter((row) => row.repaid === true).length);
		const totalBefore = entries.reduce((sum, entry) => sum + entry.tokensBefore, 0);
		const totalNet = entries.reduce((sum, entry) => sum + (entry.tokensBefore - entry.tokensAfter), 0);
		lines.push(STATUS_OBS_HEADER);
		lines.push(fill(STATUS_OBS_SESSION_LINE, {
			folds: entries.length,
			repaid: repaidText,
			recoveryPct: totalBefore > 0 ? formatPct(totalNet / totalBefore * 100) : "n/a"
		}));
		const threeTotal = snapshot.threeState.measured + snapshot.threeState.semi + snapshot.threeState.estimated;
		if (threeTotal === 0) lines.push(STATUS_OBS_NO_SAMPLES);
		else lines.push(fill(STATUS_OBS_THREE_STATE, {
			measuredPct: formatPct(snapshot.threeState.measured / threeTotal * 100),
			semiPct: formatPct(snapshot.threeState.semi / threeTotal * 100),
			estimatedPct: formatPct(snapshot.threeState.estimated / threeTotal * 100),
			total: threeTotal,
			plural: threeTotal === 1 ? "" : "s"
		}));
		if (emptyLedger) {
			lines.push(STATUS_OBS_BREAKEVEN_HEADER);
			lines.push(STATUS_OBS_BREAKEVEN_EMPTY);
		} else if (!confidenceOk) lines.push(fill(STATUS_OBS_CONFIDENCE_INSUFFICIENT, {
			ratioPct: formatPct(snapshot.cleanSampleRatio * 100),
			floorPct: formatPct(runtime.cleanSampleFloor * 100)
		}));
		else {
			lines.push(STATUS_OBS_BREAKEVEN_HEADER);
			if (snapshot.breakevenTable.length === 0) lines.push(STATUS_OBS_BREAKEVEN_EMPTY);
			else for (const row of snapshot.breakevenTable) {
				const repaidMark = row.repaid === true ? fill(STATUS_OBS_REPAID_MARK, { seq: row.repayEventSeq ?? 0 }) : "";
				lines.push(fill(STATUS_OBS_BREAKEVEN_ROW, {
					foldId: row.foldId,
					turns: row.breakevenTurns === Number.POSITIVE_INFINITY ? "never" : formatPct(row.breakevenTurns),
					quality: row.quality,
					repaidMark
				}));
			}
		}
		lines.push(STATUS_OBS_RECENT_HEADER);
		if (entries.length === 0) lines.push(STATUS_OBS_RECENT_EMPTY);
		else for (const entry of entries.slice(-3).reverse()) {
			const attribution = attributionByFold.get(entry.foldId);
			const retryPart = attribution !== void 0 && attribution.retryCount > 0 ? fill(STATUS_OBS_RETRY_PART, { count: attribution.retryCount }) : "";
			const flags = (attribution?.timeWindow === true ? STATUS_OBS_FLAG_TIME_WINDOW : "") + (attribution?.interrupted === true ? STATUS_OBS_FLAG_INTERRUPTED : "");
			lines.push(fill(STATUS_OBS_RECENT_ROW, {
				foldId: entry.foldId,
				status: entry.status,
				seq: entry.checkpointSeq,
				quality: attribution?.quality ?? "unattributed",
				retryPart,
				flags
			}));
		}
		lines.push(STATUS_OBS_RESET_HEADER);
		if (snapshot.resetSummary.length === 0) lines.push(STATUS_OBS_RESET_EMPTY);
		else for (const row of snapshot.resetSummary) lines.push(fill(STATUS_OBS_RESET_ROW, {
			kind: row.kind,
			count: row.count
		}));
	} catch (error) {
		lines.push(fill(STATUS_OBS_SNAPSHOT_FAILED, { detail: error instanceof Error ? error.message : String(error) }));
	}
	lines.push(fill(STATUS_PREFLIGHT_HEADER, { mode: runtime.preflightMode ?? "unknown" }));
	const calibration = store.preflightCalibrations();
	if (calibration.length === 0) lines.push(STATUS_PREFLIGHT_EMPTY);
	else {
		const stats = preflightCalibrationStats(calibration);
		if (stats.comparable > 0) lines.push(fill(STATUS_PREFLIGHT_STATS, {
			samples: stats.comparable,
			plural: stats.comparable === 1 ? "" : "s",
			meanPct: formatPct(stats.meanErrorPct),
			worstPct: formatPct(stats.worstErrorPct)
		}));
		else if (stats.shortCircuits === 0) lines.push(STATUS_PREFLIGHT_NOT_COMPARABLE);
		if (stats.shortCircuits > 0) lines.push(fill(STATUS_PREFLIGHT_SHORTCIRCUITS, {
			count: stats.shortCircuits,
			plural: stats.shortCircuits === 1 ? "" : "s"
		}));
		lines.push(fill(STATUS_PREFLIGHT_BASIS, { basis: stats.basis }));
	}
	if (runtime.adapterHealth !== void 0) {
		const health = runtime.adapterHealth();
		lines.push(fill(STATUS_ADAPTER_HEADER, {}));
		lines.push(fill(STATUS_ADAPTER_LINE, {
			state: health.state,
			routes: health.routes.length > 0 ? health.routes.join(", ") : "(none)",
			mapping: health.mappingSource ?? "n/a",
			settled: health.settled ? "settled" : "in progress"
		}));
	}
	if (runtime.patchFace !== void 0) {
		const patch = runtime.patchFace();
		lines.push(fill(STATUS_PATCH_HEADER, {}));
		lines.push(fill(STATUS_PATCH_MARKER, {
			state: patch.marker.state,
			detail: patchMarkerDetail(patch.marker)
		}));
		const markerFiles = patch.marker.state === "present" ? patch.marker.files ?? [] : [];
		const patchSetLabel = (patch.marker.state === "present" ? patch.marker.patchSet : void 0) ?? (patch.marker.state === "present" ? "v0.1 stub (pre-set marker)" : patch.marker.state === "absent" ? "not applied (official bundles pristine)" : "unknown (marker unreadable)");
		lines.push(fill(STATUS_PATCH_SET, {
			set: patchSetLabel,
			files: markerFiles.length > 0 ? String(markerFiles.length) : patch.marker.state === "absent" ? "0" : "unknown"
		}));
		lines.push(fill(STATUS_PATCH_MOUNT, { mount: `${patch.mount} / host faces: ${patch.hostFaces}` }));
		const sessionId = session.id;
		if (typeof sessionId === "string" && patch.guardObserve !== void 0) {
			const summary = patch.guardObserve(sessionId);
			if (summary !== void 0) lines.push(fill(STATUS_GUARD_OBSERVE, {
				total: String(summary.total),
				segmented: String(summary.segmented),
				degraded: String(summary.degraded),
				unclassified: String(summary.unclassified),
				providers: summary.providers.length > 0 ? summary.providers.join(", ") : "(none)"
			}));
		}
	}
	if (runtime.autofoldFace !== void 0) {
		const view = runtime.autofoldFace(session);
		if (view !== void 0) {
			lines.push(fill(STATUS_AUTOFOLD_HEADER, { summarizer: view.summarizer }));
			if (view.runs > 0) {
				lines.push(fill(STATUS_AUTOFOLD_LINE, {
					runs: view.runs,
					count: view.foldsCommitted,
					net: view.netTokensSaved,
					rounds: view.roundsTotal
				}));
				const last = view.lastRun;
				if (last !== void 0) lines.push(fill(STATUS_AUTOFOLD_LAST, {
					outcome: last.outcome,
					estimate: last.estimate,
					window: last.window !== void 0 ? ` of window ${last.window}` : "",
					folds: last.foldsCommitted,
					calls: last.summaryCalls,
					transient: last.transientRetries,
					halvings: last.halvingSplits,
					digest: last.digestFallbacks
				}));
			} else lines.push(STATUS_AUTOFOLD_EMPTY);
			if (view.deadProbeSticky) lines.push(fill(STATUS_AUTOFOLD_STICKY, { limit: 3 }));
		}
	}
	if (degraded.length > 0) {
		lines.push(STATUS_PARTIAL_PREFIX);
		for (const item of degraded) lines.push(fill(STATUS_DEGRADED_ROW, { detail: item }));
	}
	return lines.join("\n");
}
/**
* Build the four registry-ready zctx tool definitions through the given
* defineTool implementation (host's official one, or the fail-soft shim).
*/
function buildZctxTools(defineTool, runtime) {
	const textOutput = {
		schema: { type: "string" },
		render: (_args, value) => [{
			type: "text",
			text: value
		}]
	};
	return [
		defineTool({
			name: "zctx_fold",
			description: "Fold finished stretches of the conversation: replace one or more seq ranges with short summaries you write. content = ONE plain string carrying ALL ranges — each block starts with a \"fold <startSeq>..<endSeq> [topic]\" header line followed by that block's markdown summary (a JSON array of {startRef, endRef, summary} objects is also accepted). Batch ALL ranges into ONE call — the batch commits atomically or is rejected as a whole with reasons. Get exact ranges and pressure from zctx_status first.",
			parameters: { content: {
				type: "string",
				required: true,
				description: "All fold blocks in one string: \"fold <startSeq>..<endSeq>\" header line + markdown summary per block, or a JSON array of {startRef, endRef, summary}."
			} },
			output: textOutput,
			async execute(args, exec) {
				const session = exec?.agent?.session;
				if (session == null) return STATUS_NO_SESSION;
				const parsed = parseFoldContent(args.content);
				if (!parsed.ok) return parsed.reason;
				try {
					return renderFoldReply(fold(session, runtime.storeFor(session), parsed, runtime.validatorConfig(session)));
				} catch (error) {
					return fill(TOOL_EXECUTION_FAILED, { detail: error instanceof Error ? error.message : String(error) });
				}
			}
		}),
		defineTool({
			name: "zctx_unfold",
			description: "Re-materialize one folded range back onto the surface in place of its checkpoint. Without arguments, the most recent active fold is unfolded. Use when the folded content is needed again in full.",
			parameters: { foldId: {
				type: "string",
				description: "Fold id to unfold (from zctx_status); omit to unfold the latest active fold."
			} },
			output: textOutput,
			async execute(args, exec) {
				const session = exec?.agent?.session;
				if (session == null) return STATUS_NO_SESSION;
				try {
					const store = runtime.storeFor(session);
					let foldId;
					if (typeof args.foldId === "string" && args.foldId.length > 0) {
						if (!store.foldMap.has(args.foldId)) return `no active fold matches foldId ${args.foldId}`;
						foldId = args.foldId;
					} else {
						foldId = resolveUnfoldTarget(store);
						if (foldId === void 0) return REASON_NO_ACTIVE_FOLDS;
					}
					const result = unfold(session, store, foldId);
					return renderUnfoldReply(foldId, result);
				} catch (error) {
					return fill(TOOL_EXECUTION_FAILED, { detail: error instanceof Error ? error.message : String(error) });
				}
			}
		}),
		defineTool({
			name: "zctx_recall",
			description: "Search inside everything already folded (summaries and folded-away originals). Returns ranked hits with context excerpts and the owning fold id, so folded history stays reachable without unfolding.",
			parameters: {
				query: {
					type: "string",
					required: true,
					description: "Whitespace-separated keywords (case-insensitive)."
				},
				limit: {
					type: "number",
					description: "Maximum hits (default 5)."
				}
			},
			output: textOutput,
			async execute(args, exec) {
				const session = exec?.agent?.session;
				if (session == null) return STATUS_NO_SESSION;
				if (typeof args.query !== "string") return "invalid arguments: query: expected string";
				const limit = typeof args.limit === "number" && Number.isFinite(args.limit) && args.limit >= 0 ? Math.floor(args.limit) : 5;
				try {
					const corpus = buildRecallCorpus(runtime.storeFor(session));
					const hits = recall(args.query, corpus, limit);
					if (hits.length === 0) return fill(RECALL_REPLY_EMPTY, { query: args.query });
					const lines = [fill(RECALL_REPLY_HEADER, {
						query: args.query,
						count: hits.length,
						total: corpus.length
					})];
					for (const hit of hits) lines.push(fill(RECALL_REPLY_ROW, {
						kind: hit.kind,
						foldId: hit.foldId,
						start: hit.range.startSeq,
						end: hit.range.endSeq,
						score: hit.score,
						excerpt: hit.excerpt
					}));
					return lines.join("\n");
				} catch (error) {
					return fill(TOOL_EXECUTION_FAILED, { detail: error instanceof Error ? error.message : String(error) });
				}
			}
		}),
		defineTool({
			name: "zctx_status",
			description: "The trusted ledger for context pressure and folding: window occupancy vs the fold trigger line, budget breakdown, foldable ranges (PROTECTED marks), active folds, anomalies, and cache usage (measured or estimated). Never reconstruct these numbers from memory.",
			parameters: {},
			output: textOutput,
			async execute(_args, exec) {
				const session = exec?.agent?.session;
				if (session == null) return STATUS_NO_SESSION;
				try {
					return await renderStatus(runtime, session);
				} catch (error) {
					return fill(TOOL_EXECUTION_FAILED, { detail: error instanceof Error ? error.message : String(error) });
				}
			}
		})
	];
}
/** Newest active fold id (checkpointSeq order). @internal */
function resolveUnfoldTarget(store) {
	let best;
	for (const [id, record] of store.foldMap) if (best === void 0 || record.checkpointSeq > best.checkpointSeq) best = {
		foldId: id,
		checkpointSeq: record.checkpointSeq
	};
	return best?.foldId;
}
/** Build the recall corpus: summaries + folded-away originals. @internal */
function buildRecallCorpus(store) {
	const corpus = [];
	for (const record of store.foldMap.values()) {
		corpus.push({
			foldId: record.foldId,
			kind: "summary",
			text: record.summaryText,
			range: {
				startSeq: record.startSeq,
				endSeq: record.endSeq
			}
		});
		for (let seq = record.startSeq; seq <= record.endSeq; seq += 1) {
			const text = store.eventText(seq);
			if (text.length === 0) continue;
			corpus.push({
				foldId: record.foldId,
				kind: "original",
				text,
				range: {
					startSeq: seq,
					endSeq: seq
				}
			});
		}
	}
	return corpus;
}
/** One-decimal percentage formatting (mirrors nudge formatting). @internal */
function formatPct(value) {
	return (Math.round(value * 10) / 10).toFixed(1);
}
/** The patch marker's parenthesized detail (facts only, no recommendations). @internal */
function patchMarkerDetail(marker) {
	if (marker.state === "present") {
		const patcher = marker.patcherVersion !== void 0 ? ` by patcher ${marker.patcherVersion}` : "";
		return ` (v${marker.version ?? "unknown"}${patcher}${marker.timestamp !== void 0 ? `, patched ${marker.timestamp}` : ""})`;
	}
	if (marker.state === "absent") return " (official adapter unpatched — pure-plugin face)";
	return ` (${marker.reason ?? "unreadable"})`;
}
// src/command.ts
/**
* The `/zctx` command (task card W4 §3): status (default) | fold | unfold
* subcommands, executed against the invoking agent's session through the
* same engine/runtime the tools use. The handler returns the structural
* CommandResult union ({kind:'success'|'error', text}) — every failure is a
* fail-soft error text, never a throw.
*
* Zero host imports; the runtime is injected structurally.
*
* @module command
*/
/** Build the /zctx command definition against the given runtime. */
function buildZctxCommand(runtime) {
	return {
		name: "zctx",
		description: "Context folding ledger: \"status\" (default) shows pressure, budget, ranges, folds, and cache usage; \"fold <content>\" commits fold blocks; \"unfold [foldId]\" re-materializes a fold.",
		handler: (invocation) => handleZctxCommand(runtime, invocation)
	};
}
/** Dispatch one /zctx invocation (fail-soft everywhere). @internal */
async function handleZctxCommand(runtime, invocation) {
	try {
		return await dispatchZctxCommand(runtime, invocation);
	} catch (error) {
		return {
			kind: "error",
			text: fill(TOOL_EXECUTION_FAILED, { detail: error instanceof Error ? error.message : String(error) })
		};
	}
}
/** The dispatch body (called inside the handler's containment). @internal */
async function dispatchZctxCommand(runtime, invocation) {
	const session = invocation.agent?.session;
	if (session == null) return {
		kind: "error",
		text: STATUS_NO_SESSION
	};
	const raw = invocation.rawInput.trim();
	if (raw === "" || raw === "status") return {
		kind: "success",
		text: await renderStatus(runtime, session)
	};
	if (raw === "fold" || raw.startsWith("fold ")) {
		const parsed = parseFoldContent(raw.slice(4).trim());
		if (!parsed.ok) return {
			kind: "error",
			text: parsed.reason
		};
		const result = fold(session, runtime.storeFor(session), parsed, runtime.validatorConfig(session));
		const text = renderFoldReply(result);
		return result.ok ? {
			kind: "success",
			text
		} : {
			kind: "error",
			text
		};
	}
	if (raw === "unfold" || raw.startsWith("unfold ")) {
		const rest = raw.slice(6).trim();
		const foldId = rest.length > 0 ? rest : void 0;
		const writable = session;
		const store = runtime.storeFor(session);
		const target = foldId ?? resolveLatestFold(store);
		if (target === void 0) return {
			kind: "error",
			text: REASON_NO_ACTIVE_FOLDS
		};
		const result = unfold(writable, store, target);
		const text = renderUnfoldReply(target, result);
		return result.ok ? {
			kind: "success",
			text
		} : {
			kind: "error",
			text
		};
	}
	return {
		kind: "error",
		text: "unknown /zctx subcommand; expected \"status\" (default), \"fold <content>\", or \"unfold [foldId]\""
	};
}
/** Newest active fold id (checkpointSeq order). @internal */
function resolveLatestFold(store) {
	let best;
	for (const [id, record] of store.foldMap) if (best === void 0 || record.checkpointSeq > best.checkpointSeq) best = {
		foldId: id,
		checkpointSeq: record.checkpointSeq
	};
	return best?.foldId;
}
// src/guard-observe-bridge.ts
/** Extract the facts from one (loose) event data payload. @internal */
function guardRecordFacts(data) {
	if (data === null || typeof data !== "object" || Array.isArray(data)) return void 0;
	const record = data;
	const segmented = typeof record.segments === "object" && record.segments !== null;
	const degraded = typeof record.degraded === "object" && record.degraded !== null;
	const meta = typeof record.meta === "object" && record.meta !== null ? record.meta : {};
	return {
		segmented,
		degraded,
		unclassified: record.classified === false && typeof record.monotonic === "string" && record.monotonic === "unclassified",
		...typeof record.classId === "string" ? { classId: record.classId } : {},
		...typeof record.monotonic === "string" ? { monotonic: record.monotonic } : {},
		...typeof meta.provider === "string" ? { provider: meta.provider } : {},
		...typeof meta.modelId === "string" ? { modelId: meta.modelId } : {}
	};
}
/** Build the bridge. All state is process memory; nothing is persisted. */
function createGuardObserveBridge(logger) {
	const buckets = /* @__PURE__ */ new Map();
	let warnedOnce = false;
	const warnOnce = (message) => {
		if (warnedOnce) return;
		warnedOnce = true;
		logger?.warn?.(message);
	};
	return {
		consume(sessionId, event) {
			try {
				if (typeof sessionId !== "string" || sessionId.length === 0) return;
				const typed = event;
				if (typed === null || typeof typed !== "object") return;
				const facts = guardRecordFacts(typed.data);
				if (facts === void 0) {
					warnOnce("dsh-zcontext: guard-observe bridge received a malformed record — feeding nothing");
					return;
				}
				let bucket = buckets.get(sessionId);
				if (bucket === void 0) {
					bucket = {
						total: 0,
						segmented: 0,
						degraded: 0,
						unclassified: 0,
						providers: /* @__PURE__ */ new Set()
					};
					buckets.set(sessionId, bucket);
				}
				bucket.total += 1;
				if (facts.segmented) bucket.segmented += 1;
				if (facts.degraded) bucket.degraded += 1;
				if (facts.unclassified) bucket.unclassified += 1;
				if (typeof typed.seq === "number" && Number.isSafeInteger(typed.seq)) bucket.lastSeq = typed.seq;
				if (facts.classId !== void 0) bucket.lastClassId = facts.classId;
				if (facts.monotonic !== void 0) bucket.lastMonotonic = facts.monotonic;
				if (facts.provider !== void 0) bucket.providers.add(facts.provider);
			} catch (error) {
				warnOnce(`dsh-zcontext: guard-observe bridge consume failed (${error instanceof Error ? error.message : String(error)}) — record dropped`);
			}
		},
		summary(sessionId) {
			const bucket = buckets.get(sessionId);
			if (bucket === void 0) return void 0;
			return {
				total: bucket.total,
				segmented: bucket.segmented,
				degraded: bucket.degraded,
				unclassified: bucket.unclassified,
				...bucket.lastSeq !== void 0 ? { lastSeq: bucket.lastSeq } : {},
				...bucket.lastClassId !== void 0 ? { lastClassId: bucket.lastClassId } : {},
				...bucket.lastMonotonic !== void 0 ? { lastMonotonic: bucket.lastMonotonic } : {},
				providers: [...bucket.providers]
			};
		},
		forgetSession(sessionId) {
			buckets.delete(sessionId);
		}
	};
}
// src/patch-bridge.ts
/**
* The patch bridge — the plugin side of the external app.asar patch
* (task card P4 product 2; plan §3; RES-install-surface P2 §7).
*
* The external patcher (patcher/zctx-patch.mjs) inserts ONE defensive
* forwarding stub into the OFFICIAL PiAiAdapter's streamSimple options
* construction (after the `...profileOptions(...)` spread, BEFORE the
* official explicit `headers:`/`signal:` keys — so the stub can never clobber
* the official header/timeout face):
*
*     ...(globalThis.__zctxPatch__?.wireOptions?.({ provider, model, sessionId }) ?? {}),
*
* This module arms the receiving side: {@link mountPatchBridge} installs
* `globalThis.__zctxPatch__.wireOptions` at plugin startup. Per request the
* official adapter calls it with the reachable identity (provider/model +
* options.sessionId); the bridge returns `{onPayload, fetch, headers}` built
* by the SAME `buildWireFaces` the plugin's own adapter uses (identical
* observation semantics, R1 observe-only) bound to the per-session wire
* ledger. Plugin absent/disabled → never armed; invalid identity or unwatched
* session → the bridge returns `{}`; host face unreachable → the LEDGER still
* serves with an empty attribution set (hash records without the attribution
* headers — the official request proceeds byte-identical to stock in every
* case, card: "插件缺席/未启用→桩返回 {} 零操作；补丁缺席=现有面不变").
*
* R7 (attribution must ride the wire): on the official route the plugin's
* `headers` face is overridden by the adapter's own explicit
* `headers: requestHeaders(...)` key (by construction — the stub sits before
* it), so attribution is delivered through the FETCH WRAPPER instead: the
* bridge composes the wire fetch with an additive init.headers merge
* (attribution names win case-insensitive collisions, the same semantics as
* the own-adapter `requestHeaders` port). Unknown header shapes pass through
* untouched. The own-adapter path is UNCHANGED (zero consumer-face drift —
* VERIFY-P P1 discipline).
*
* MOUNT SEMANTICS: last-wins per process — a re-constructed plugin instance
* replaces any previous bridge (the newest instance is the live one); with
* multiple simultaneous plugin instances only the latest serves the stub,
* which is logged honestly. All bridge code is throw-contained: the stub
* runs inside the OFFICIAL request path, so ANY internal failure degrades to
* `{}` — never a broken user request.
*
* @module patch-bridge
*/
/** globalThis key the patched stub calls into (must match the patcher stub). */
const PATCH_BRIDGE_KEY = "__zctxPatch__";
/** The marker file the external patcher writes into the app dir. */
const PATCH_MARKER_FILENAME = ".zctx-patch.json";
/**
* The app dir the marker lives in: the Electron main process exposes
* `process.resourcesPath` (<appDir>/resources); the marker sits next to the
* exe, one level up. Undefined outside Electron (tests pass the dir).
*/
function patchMarkerDir() {
	const resourcesPath = process.resourcesPath;
	if (typeof resourcesPath !== "string" || resourcesPath.length === 0) return void 0;
	return dirname(resourcesPath);
}
/**
* Read the patch marker — the FILESYSTEM half of the status dual source.
* ENOENT = absent (unpatched); unreadable/unparsable = unknown (honest);
* present = {version, timestamp} straight from the patcher's write.
*/
function readPatchMarker(appDir) {
	const dir = appDir ?? patchMarkerDir();
	if (dir === void 0) return {
		state: "unknown",
		path: PATCH_MARKER_FILENAME,
		reason: "app dir not reachable (no process.resourcesPath)"
	};
	const path = join(dir, PATCH_MARKER_FILENAME);
	if (!existsSync(path)) return {
		state: "absent",
		path
	};
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8"));
		return {
			state: "present",
			path,
			...typeof parsed.shellVersion === "string" ? { version: parsed.shellVersion } : {},
			...typeof parsed.target === "string" ? { target: parsed.target } : {},
			...typeof parsed.patchSet === "string" ? { patchSet: parsed.patchSet } : {},
			...typeof parsed.patcherVersion === "string" ? { patcherVersion: parsed.patcherVersion } : {},
			...Array.isArray(parsed.files) ? { files: parsed.files.map((file) => {
				const entry = typeof file === "object" && file !== null ? file : {};
				return {
					...typeof entry.target === "string" ? { target: entry.target } : {},
					...typeof entry.sha256After === "string" ? { sha256After: entry.sha256After } : {}
				};
			}) } : {},
			...typeof parsed.timestamp === "string" ? { timestamp: parsed.timestamp } : {}
		};
	} catch (error) {
		return {
			state: "unknown",
			path,
			reason: error instanceof Error ? error.message : String(error)
		};
	}
}
/** Attribution headers merged into init.headers additively. @internal */
function withAttributionHeaders(init, host) {
	if (init === void 0 || init === null || typeof init !== "object") return init;
	let attribution;
	try {
		attribution = host.attributionHeaders();
	} catch {
		return init;
	}
	if (attribution === void 0 || Object.keys(attribution).length === 0) return init;
	const existing = init.headers;
	if (existing instanceof Headers) {
		const merged = new Headers(existing);
		for (const [name, value] of Object.entries(attribution)) merged.set(name, value);
		return {
			...init,
			headers: merged
		};
	}
	if (Array.isArray(existing) || typeof existing === "string" || existing === void 0 || existing === null) {
		if (existing === void 0 || existing === null) return {
			...init,
			headers: { ...attribution }
		};
		return init;
	}
	if (typeof existing !== "object") return init;
	const reserved = new Set(Object.keys(attribution).map((name) => name.toLowerCase()));
	const kept = Object.fromEntries(Object.entries(existing).filter(([name]) => !reserved.has(name.toLowerCase())));
	return {
		...init,
		headers: {
			...kept,
			...attribution
		}
	};
}
/**
* The attribution-unavailable degrade host: a minimal structural HostLlmFace
* supplying an EMPTY attribution set. The wire ledger (hash records) works
* regardless; only the R7 attribution headers are absent — an honest,
* documented limitation on official-route requests when the dsh-llm face is
* unreachable (attribution remains MANDATORY on the plugin's own adapter
* path, which always rides the real host face).
* @internal
*/
const ATTRIBUTION_UNAVAILABLE_HOST = { attributionHeaders: () => ({}) };
/**
* Build and return the bridge object (does NOT mount it — the caller decides
* the globalThis slot; see {@link mountPatchBridge}).
*/
function createPatchBridge(deps) {
	let warnedOnce = false;
	const warnOnce = (message) => {
		if (warnedOnce) return;
		warnedOnce = true;
		deps.logger?.warn?.(message);
	};
	const wireOptions = (profileInfo) => {
		try {
			if (typeof profileInfo !== "object" || profileInfo === null) return {};
			const { provider, model, sessionId } = profileInfo;
			if (typeof sessionId !== "string" || sessionId.length === 0) return {};
			if (typeof provider !== "string" || provider.length === 0) return {};
			if (typeof model !== "string" || model.length === 0) return {};
			if (deps.resolveWatchedSession(sessionId) === void 0) return {};
			const host = deps.hostFace() ?? ATTRIBUTION_UNAVAILABLE_HOST;
			if (deps.hostFace() === void 0) warnOnce("dsh-zcontext: patch bridge serving without attribution headers (host llm face unreachable) — wire records carry hashes only");
			const faces = buildWireFaces({
				sessionId,
				provider,
				model
			}, deps.sink, host);
			const fetch = async (input, init) => {
				return faces.fetch(input, withAttributionHeaders(init, host));
			};
			return {
				onPayload: faces.onPayload,
				fetch,
				headers: faces.headers
			};
		} catch (error) {
			warnOnce(`dsh-zcontext: patch bridge wireOptions failed (${error instanceof Error ? error.message : String(error)}) — degraded to {} for this request`);
			return {};
		}
	};
	return { wireOptions };
}
/**
* Mount the bridge on globalThis (LAST-WINS: a re-constructed plugin is the
* live one and replaces any previous mount, honestly logged). Returns the
* mount state string the status segment renders.
*/
function mountPatchBridge(deps) {
	const holder = globalThis;
	const replacing = holder[PATCH_BRIDGE_KEY] !== void 0;
	const bridge = createPatchBridge(deps);
	holder[PATCH_BRIDGE_KEY] = bridge;
	return {
		bridge,
		mountState: replacing ? "armed (replaced a previous mount — latest plugin instance serves the stub)" : "armed"
	};
}
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS fold_events (
  session_id TEXT NOT NULL,
  fold_id TEXT NOT NULL,
  start_seq INTEGER NOT NULL,
  end_seq INTEGER NOT NULL,
  tokens_before INTEGER NOT NULL,
  tokens_after INTEGER NOT NULL,
  supply TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (session_id, fold_id)
);
CREATE TABLE IF NOT EXISTS usage_turns (
  session_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  measured INTEGER NOT NULL,
  cache_read_tokens INTEGER,
  cache_write_tokens INTEGER,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (session_id, seq)
);
CREATE INDEX IF NOT EXISTS idx_fold_created ON fold_events(created_at);
CREATE INDEX IF NOT EXISTS idx_usage_created ON usage_turns(created_at);
`;
const SQL_UPSERT_META = "INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value";
const SQL_UPSERT_FOLD = "INSERT OR REPLACE INTO fold_events(session_id,fold_id,start_seq,end_seq,tokens_before,tokens_after,supply,created_at) VALUES(?,?,?,?,?,?,?,?)";
const SQL_UPSERT_USAGE = "INSERT OR REPLACE INTO usage_turns(session_id,seq,measured,cache_read_tokens,cache_write_tokens,created_at) VALUES(?,?,?,?,?,?)";
const SQL_STATS = "SELECT COUNT(*) AS n, COALESCE(SUM(tokens_before - tokens_after),0) AS saved, COUNT(DISTINCT session_id) AS sessions, MAX(created_at) AS last FROM fold_events";
/** Open (or create) the ledger DB. Never throws — failures return a closed stub. */
function openLedgerDb(path) {
	if (typeof path !== "string" || path.trim() === "") return {
		ok: false,
		error: "empty db path"
	};
	try {
		mkdirSync(dirname(path), { recursive: true });
		const db = new DatabaseSync(path);
		db.exec("PRAGMA journal_mode = WAL;");
		db.exec(SCHEMA_SQL);
		db.prepare(SQL_UPSERT_META).run("schema_version", String(1));
		return {
			ok: true,
			db
		};
	} catch (error) {
		return {
			ok: false,
			error: error instanceof Error ? error.message : String(error)
		};
	}
}
/** All record/write helpers are fail-soft: they return false instead of throwing. */
var LedgerStore = class {
	db;
	openError;
	constructor(path) {
		const opened = openLedgerDb(path);
		if (opened.ok) this.db = opened.db;
		else this.openError = opened.error;
	}
	get available() {
		return this.db !== void 0;
	}
	recordFold(e) {
		if (this.db === void 0) return false;
		try {
			this.db.prepare(SQL_UPSERT_FOLD).run(e.sessionId, e.foldId, e.startSeq, e.endSeq, e.tokensBefore, e.tokensAfter, e.supply, e.createdAt);
			return true;
		} catch {
			return false;
		}
	}
	recordUsageTurn(t) {
		if (this.db === void 0) return false;
		try {
			this.db.prepare(SQL_UPSERT_USAGE).run(t.sessionId, t.seq, t.measured ? 1 : 0, t.cacheReadTokens ?? null, t.cacheWriteTokens ?? null, t.createdAt);
			return true;
		} catch {
			return false;
		}
	}
	/** Aggregate stats for the stats view — computed in SQLite, honest zeros on fault. */
	stats() {
		const empty = {
			totalFolds: 0,
			totalTokensSaved: 0,
			sessionsCount: 0,
			lastFoldAt: void 0,
			schemaVersion: 1
		};
		if (this.db === void 0) return empty;
		try {
			const foldRow = this.db.prepare(SQL_STATS).get();
			return {
				totalFolds: Number(foldRow.n),
				totalTokensSaved: Number(foldRow.saved),
				sessionsCount: Number(foldRow.sessions),
				lastFoldAt: foldRow.last === null ? void 0 : Number(foldRow.last),
				schemaVersion: 1
			};
		} catch {
			return empty;
		}
	}
	close() {
		try {
			this.db?.close();
		} catch {}
	}
};
/** Default DB path under the DSH home: `<home>/zctx/ledger.db`. */
function defaultLedgerPath(homeDir) {
	return join(homeDir, "zctx", "ledger.db");
}
// src/ui/auth.ts
/**
* Bridge authorization for the zctx UI routes (ZCTX-UI DESIGN §3.3) — D2.
*
* ZERO-CREDENTIAL LITERAL RULE: the bridge token is generated at runtime via
* `node:crypto` randomBytes. No usable credential literal appears in source,
* examples, or tests (UserPromptSubmit hook hard constraint). The token lives
* only in the `registerUiRoutes` closure — never logged, never written to
* disk, never embedded in a snapshot.
*
* Authorization arms (DESIGN §3.3, aligned with AutoPilot authorizeAction):
*   1. `x-zctx-token` header non-empty → constant identity compare with token.
*   2. no token header + `origin` present → same-origin (URL(origin).host == host).
*   3. no origin → loopback socket address.
*   4. otherwise → false.
* Write routes further require token OR (same-origin AND loopback).
*
* Native Node req/res only (no Express helpers): lowercase `req.headers`,
* first value wins on repeated headers.
*
* @module ui/auth
*/
/** Runtime token source — no literal, ever. */
function createTokenSource() {
	return { token: () => randomBytes(16).toString("hex") };
}
/** First value of a lowercase header (node http shape: repeats take the first). */
function firstHeader(req, name) {
	const value = req.headers[name];
	if (Array.isArray(value)) return value[0];
	return value;
}
/** Loopback socket check (DESIGN §3.3 arm 3). */
function isLoopback(req) {
	const address = req.socket?.remoteAddress;
	if (address === void 0) return false;
	return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}
/** Same-origin check: URL(origin).host == the request Host header. */
function isSameOrigin(req) {
	const origin = firstHeader(req, "origin");
	const host = firstHeader(req, "host");
	if (origin === void 0 || origin.length === 0 || host === void 0 || host.length === 0) return false;
	try {
		return new URL(origin).host === host;
	} catch {
		return false;
	}
}
/** Constant-time-ish token compare; length mismatch → false. */
function tokenMatches(provided, expected) {
	const a = Buffer.from(provided);
	const b = Buffer.from(expected);
	if (a.length !== b.length) return false;
	try {
		return timingSafeEqual(a, b);
	} catch {
		return false;
	}
}
/** Read authorization (DESIGN §3.3 arms 1-4). A PRESENT token header is
* authoritative: a wrong token fails closed (no fall-through to loopback) —
* aligned with AutoPilot authorizeAction's direct `return header === token`. */
function authorizeRequest(req, expectedToken) {
	const header = firstHeader(req, "x-zctx-token") ?? "";
	if (header.length > 0) return tokenMatches(header, expectedToken);
	const origin = firstHeader(req, "origin");
	if (origin !== void 0 && origin.length > 0) return isSameOrigin(req);
	return isLoopback(req);
}
/** Write authorization — stricter: token OR (same-origin AND loopback).
* Present-but-wrong token fails closed (same rule as read authorization). */
function authorizeWrite(req, expectedToken) {
	const header = firstHeader(req, "x-zctx-token") ?? "";
	if (header.length > 0) return tokenMatches(header, expectedToken);
	return isSameOrigin(req) && isLoopback(req);
}
/** Native JSON response (aligned with AutoPilot sendJson). */
function sendJson(res, status, payload) {
	res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
	res.end(JSON.stringify(payload));
}
const KEY_SET = /* @__PURE__ */ new Set([
	"enabled",
	"nudgeThresholds",
	"keepRecentTokens",
	"maxFoldFraction",
	"minFoldableTokens",
	"protectionFloorTokens",
	"summaryFloorChars",
	"summaryCeilingChars",
	"netShrinkTolerance",
	"observe.enabled",
	"patch.guardObserveEvents",
	"autofold.enabled",
	"preflightMode"
]);
/** Capability-probe the configEditor service off a host context. */
function resolveConfigEditor(ctx) {
	const c = ctx;
	let service;
	try {
		service = c?.get?.("configEditor") ?? c?.configEditor;
	} catch {
		service = void 0;
	}
	if (service === void 0 || service === null) return void 0;
	const candidate = service;
	if (typeof candidate.entries !== "function" || typeof candidate.edit !== "function") return void 0;
	return service;
}
/** Find the `dsh-zcontext` config entry. */
function findEntry(editor) {
	let entries;
	try {
		entries = editor.entries() ?? [];
	} catch {
		return;
	}
	return entries.find((entry) => entry?.options?.id === "dsh-zcontext" || entry?.id === "dsh-zcontext");
}
/** Validate + narrow an untrusted JSON patch to allow-listed keys only. */
function sanitizePatch(patch) {
	if (patch === null || typeof patch !== "object" || Array.isArray(patch)) return { ok: false };
	const source = patch;
	const keys = Object.keys(source);
	if (keys.length === 0) return { ok: false };
	const out = {};
	for (const key of keys) {
		if (!KEY_SET.has(key)) return { ok: false };
		out[key] = source[key];
	}
	return {
		ok: true,
		patch: out
	};
}
/**
* Write the overlay patch through configEditor.edit. Returns a structured
* result; never throws. Success means the host accepted the edit call.
*/
function writeOverlay(ctx, patch) {
	const editor = resolveConfigEditor(ctx);
	if (editor === void 0) return {
		ok: false,
		error: "unavailable"
	};
	const entry = findEntry(editor);
	if (entry === void 0) return {
		ok: false,
		error: "unavailable"
	};
	try {
		editor.edit(entry, (current, inherited) => ({
			...inherited ?? {},
			...current ?? {},
			...patch
		}));
		return { ok: true };
	} catch {
		return {
			ok: false,
			error: "unavailable"
		};
	}
}
// src/ui/routes.ts
/**
* Native webServer UI routes (ZCTX-UI DESIGN §3) — D2.
*
* FOUR routes via the host `webServer.register`:
*   GET  /zctx-ui                  → text/html (inline page, token injected)
*   GET  /zctx-ui/api/snapshot     → JSON ZctxSnapshot (?session= optional)
*   GET  /zctx-ui/api/config       → JSON { fields, faceSwitches, writable }
*   POST /zctx-ui/api/config       → overlay write via configEditor.edit
*
* HARD RULES: native req/res only (writeHead/end, async-iterable body, lowercase
* headers — no Express helpers); disposer via ctx.effect; bridge token runtime
* generated (zero literal, see auth.ts); writes through configEditor.edit only;
* read-only except the config overlay (R1: never touches llm request bodies).
*
* @module ui/routes
*/
/** The token placeholder in the page HTML (not a credential — replaced at register time). */
const TOKEN_PLACEHOLDER = "__ZCTX_BRIDGE_TOKEN__";
/** Read the full body off the native async-iterable request stream. */
async function readBody(req) {
	let body = "";
	try {
		for await (const chunk of req) if (typeof chunk === "string") body += chunk;
		else if (chunk && typeof chunk.toString === "function") body += chunk.toString("utf8");
	} catch {}
	return body;
}
/** Parse an optional `?session=` from a native req.url. */
function sessionFromUrl(url) {
	if (url === void 0) return void 0;
	try {
		const value = new URL(url, "http://localhost").searchParams.get("session");
		return value !== null && value.length > 0 ? value : void 0;
	} catch {
		return;
	}
}
/**
* Register all four UI routes. Returns a disposer that unregisters them; the
* disposer is also hooked into `ctx.effect` when that seam exists (RA1d/FileHub
* precedent). If no webServer is present (CLI headless), the whole UI surface
* is skipped with a no-op disposer — never a throw, never PENDING.
*/
function registerUiRoutes(deps) {
	const { ctx, pageHtml, snapshotFor, getConfig, writeConfig } = deps;
	const bridgeToken = `zctx_${Date.now().toString(36)}_${createTokenSource().token()}`;
	const page = pageHtml.split(TOKEN_PLACEHOLDER).join(bridgeToken);
	let webServer = deps.webServer;
	if (webServer === void 0) {
		const c = ctx;
		let candidate;
		try {
			candidate = c?.get?.("webServer") ?? c?.webServer;
		} catch {
			candidate = void 0;
		}
		if (candidate !== void 0 && typeof candidate.register === "function") webServer = candidate;
	}
	if (webServer === void 0) {
		const c = ctx;
		try {
			c?.logger?.info?.("dsh-zcontext: webServer unavailable — UI route surface skipped (CLI headless)");
		} catch {}
		return () => void 0;
	}
	const unregister = [];
	const pageHandler = (req, res) => {
		const r = req;
		const s = res;
		if (r.method !== "GET") {
			sendJson(s, 405, {
				ok: false,
				error: "method not allowed"
			});
			return;
		}
		if (!authorizeRequest(r, bridgeToken)) {
			sendJson(s, 403, {
				ok: false,
				error: "unauthorized"
			});
			return;
		}
		s.writeHead(200, { "content-type": "text/html; charset=utf-8" });
		s.end(page);
	};
	unregister.push(webServer.register({
		kind: "exact",
		path: "/zctx-ui",
		handler: pageHandler
	}));
	const snapshotHandler = (req, res) => {
		const r = req;
		const s = res;
		if (r.method !== "GET") {
			sendJson(s, 405, {
				ok: false,
				error: "method not allowed"
			});
			return;
		}
		if (!authorizeRequest(r, bridgeToken)) {
			sendJson(s, 403, {
				ok: false,
				error: "unauthorized"
			});
			return;
		}
		try {
			sendJson(s, 200, snapshotFor(sessionFromUrl(r.url)));
		} catch (error) {
			sendJson(s, 500, {
				ok: false,
				error: error instanceof Error ? error.message : String(error)
			});
		}
	};
	unregister.push(webServer.register({
		kind: "exact",
		path: "/zctx-ui/api/snapshot",
		handler: snapshotHandler
	}));
	const configHandler = async (req, res) => {
		const r = req;
		const s = res;
		if (r.method === "GET") {
			if (!authorizeRequest(r, bridgeToken)) {
				sendJson(s, 403, {
					ok: false,
					error: "unauthorized"
				});
				return;
			}
			sendJson(s, 200, getConfig());
			return;
		}
		if (r.method === "POST") {
			if (!authorizeWrite(r, bridgeToken)) {
				sendJson(s, 403, {
					ok: false,
					error: "unauthorized"
				});
				return;
			}
			const body = await readBody(req);
			let parsed;
			try {
				parsed = JSON.parse(body);
			} catch {
				sendJson(s, 400, {
					ok: false,
					error: "invalid JSON body"
				});
				return;
			}
			let patchSource = parsed;
			if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
				const obj = parsed;
				if (typeof obj.fields === "object" && obj.fields !== null) {
					const flat = { ...obj.fields };
					if (typeof obj.faceSwitches === "object" && obj.faceSwitches !== null) Object.assign(flat, obj.faceSwitches);
					patchSource = flat;
				}
			}
			const checked = sanitizePatch(patchSource);
			if (!checked.ok) {
				sendJson(s, 400, {
					ok: false,
					error: "invalid config patch (unknown or empty keys)"
				});
				return;
			}
			if (!writeConfig(checked.patch).ok) {
				sendJson(s, 503, {
					ok: false,
					error: "config editor unavailable"
				});
				return;
			}
			sendJson(s, 200, { ok: true });
			return;
		}
		sendJson(s, 405, {
			ok: false,
			error: "method not allowed"
		});
	};
	unregister.push(webServer.register({
		kind: "exact",
		path: "/zctx-ui/api/config",
		handler: configHandler
	}));
	const disposer = () => {
		for (const fn of unregister) try {
			fn();
		} catch {}
		unregister.length = 0;
	};
	const effectCtx = ctx;
	try {
		effectCtx?.effect?.(() => () => disposer(), "zctx-ui-routes");
	} catch {}
	return disposer;
}
// src/ui/page.ts
/**
* Inline UI page for the zcontext realtime panel (ZCTX-UI DESIGN §3.5) — D3.
*
* Delivered as a single inline HTML string compiled into lib/index.js: zero
* build, zero runtime fs read, zero path-traversal surface (DESIGN §3.5). The
* bridge token placeholder is replaced by `registerUiRoutes` at registration
* time, so the page is bound to the exact token of this process session.
*
* HARD RULES:
*   - Written with the Write tool (Z23/条目32/A14: NEVER heredoc for HTML/JS).
*   - The embedded JS uses string CONCATENATION, never `${...}` template syntax,
*     so it cannot collide with this TS template literal's interpolation.
*   - Data goes over same-origin HTTP only; the UI never enters the model
*     stream or the session wire (V3/R1: no billed tokens are burned).
*   - BETA honesty boundary: the UI solves "view/stats without opening a
*     session"; it does NOT eliminate all fold tokens (autofold still spends).
*
* @module ui/page
*/
/**
* The token placeholder (a plain marker, not a credential). registerUiRoutes
* replaces every occurrence with the runtime-generated bridge token.
*/
const UI_TOKEN_PLACEHOLDER = "__ZCTX_BRIDGE_TOKEN__";
/**
* Complete single-file page: inline CSS + inline JS, three blocks
* (查看 / 统计 / 设置), 5s polling, same-origin fetch with token header.
*/
const UI_PAGE_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>zcontext 面板 · BETA</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, "Segoe UI", system-ui, sans-serif;
         background: #10131a; color: #e6e9ef; font-size: 14px; line-height: 1.5; }
  header { padding: 14px 20px; border-bottom: 1px solid #262c3a; display: flex;
           align-items: baseline; gap: 12px; flex-wrap: wrap; }
  header h1 { margin: 0; font-size: 17px; font-weight: 650; }
  .beta { font-size: 11px; color: #f0b429; border: 1px solid #f0b429; border-radius: 4px;
          padding: 1px 6px; }
  .meta { margin-left: auto; color: #8b93a7; font-size: 12px; }
  .session-pick { color: #8b93a7; font-size: 12px; display: inline-flex; align-items: center; gap: 6px; }
  .session-pick select { background: #0f131c; color: #e6e9ef; border: 1px solid #333b4e;
    border-radius: 5px; padding: 3px 6px; font-family: inherit; font-size: 12px; max-width: 220px; }
  main { display: grid; grid-template-columns: repeat(auto-fit, minmax(360px, 1fr));
         gap: 16px; padding: 18px 20px; max-width: 1500px; }
  section { background: #171b25; border: 1px solid #262c3a; border-radius: 10px;
            padding: 16px; min-width: 0; }
  section h2 { margin: 0 0 12px; font-size: 14px; font-weight: 650; color: #cdd4e3;
               border-bottom: 1px solid #262c3a; padding-bottom: 8px; }
  .row { display: flex; justify-content: space-between; gap: 10px; padding: 3px 0; }
  .row .k { color: #8b93a7; }
  .row .v { font-variant-numeric: tabular-nums; text-align: right; }
  .badge { font-size: 10px; padding: 1px 5px; border-radius: 3px; margin-left: 4px; vertical-align: middle; }
  .measured { background: #1c4a2e; color: #7ee2a8; }
  .estimated { background: #4a3a1c; color: #e7c27a; }
  .unknown { background: #3a3f4d; color: #aeb6c7; }
  .none { background: #2a2f3b; color: #798195; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th, td { text-align: left; padding: 4px 6px; border-bottom: 1px solid #222838; }
  th { color: #8b93a7; font-weight: 500; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; }
  .scroll { max-height: 220px; overflow: auto; }
  .face { display: inline-flex; align-items: center; gap: 6px; font-weight: 600; }
  .dot { width: 9px; height: 9px; border-radius: 50%; display: inline-block; }
  .dot.active { background: #3ecf8e; }
  .dot.degraded { background: #f0b429; }
  .dot.absent { background: #e05561; }
  .degraded-line { color: #e7c27a; font-size: 12px; }
  label.f { display: block; margin: 8px 0; }
  label.f span { display: block; color: #8b93a7; margin-bottom: 3px; }
  input[type=text], input[type=number], select { width: 100%; background: #0f131c; color: #e6e9ef;
    border: 1px solid #333b4e; border-radius: 5px; padding: 6px 8px; font-family: inherit; }
  .chk { display: flex; align-items: center; gap: 8px; margin: 6px 0; }
  .chk input { width: auto; }
  button { background: #2f6fed; color: #fff; border: 0; border-radius: 6px;
           padding: 9px 16px; font-size: 14px; cursor: pointer; margin-top: 8px; }
  button:disabled { background: #394154; cursor: not-allowed; }
  .note { font-size: 12px; color: #8b93a7; margin-top: 10px; }
  .msg { font-size: 12px; margin-top: 8px; min-height: 16px; }
  .msg.ok { color: #7ee2a8; }
  .msg.err { color: #e05561; }
  .empty { color: #798195; font-style: italic; }
</style>
</head>
<body>
<header>
  <h1>zcontext 实时面板</h1>
  <span class="beta">BETA</span>
  <label class="session-pick" id="session-pick-wrap" style="display:none">会话
    <select id="session-pick" aria-label="切换会话"></select>
  </label>
  <span class="meta" id="meta">加载中…</span>
</header>
<main>
  <section>
    <h2>查看 · 实时账本（5s 轮询）</h2>
    <div id="view-body"><div class="empty">暂无活动会话</div></div>
  </section>
  <section>
    <h2>统计 · 累计折叠 / 回本 / 缓存</h2>
    <div id="stats-body"><div class="empty">暂无活动会话</div></div>
  </section>
  <section>
    <h2>设置 · 配置 overlay</h2>
    <form id="settings-form"></form>
    <div class="msg" id="settings-msg"></div>
    <div class="note">保存后下次加载生效，不热更新已挂载的 face。写入仅经宿主 configEditor 落到 profile overlay。</div>
  </section>
</main>
<script>
(function () {
  'use strict';
  window.__ZCTX_TOKEN__ = '__ZCTX_BRIDGE_TOKEN__';
  var TOKEN = window.__ZCTX_TOKEN__;
  var session = null; // locked to first observed session id, then reused
  var formBuilt = false;

  function authHeaders(extra) {
    var h = { 'x-zctx-token': TOKEN };
    if (extra) { for (var k in extra) { if (extra.hasOwnProperty(k)) h[k] = extra[k]; } }
    return h;
  }
  function api(path) {
    return fetch(path, { headers: authHeaders() }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  // Attribute-context alias (B5-6): same escaping, used where a value lands
  // inside a quoted HTML attribute. Text contexts also benefit (harmless).
  function escAttr(s) { return esc(s); }
  function badge(basis) {
    var b = basis || 'none';
    return '<span class="badge ' + b + '">' + b + '</span>';
  }
  function num(v) { return (typeof v === 'number' && isFinite(v)) ? v.toLocaleString() : 'n/a'; }
  function rows(pairs) {
    return pairs.map(function (p) {
      return '<div class="row"><span class="k">' + esc(p[0]) + '</span><span class="v">' + p[1] + '</span></div>';
    }).join('');
  }
  function table(headers, data) {
    if (!data.length) return '<div class="empty">(空)</div>';
    var h = '<table><thead><tr>' + headers.map(function (x) { return '<th>' + esc(x) + '</th>'; }).join('') + '</tr></thead><tbody>';
    return h + data.map(function (cells) {
      return '<tr>' + cells.map(function (c, i) {
        return '<td' + (i > 0 ? ' class="num"' : '') + '>' + c + '</td>';
      }).join('') + '</tr>';
    }).join('') + '</tbody></table>';
  }

  function renderView(s) {
    var w = s.window || {};
    var tt = w.totalTokens || {};
    var budget = s.budget || {};
    var face = s.faceHealth || {};
    var head = rows([
      ['会话', s.sessionId ? esc(s.sessionId) : '（无）'],
      ['解析路径', esc(s.sessionResolution || 'none')],
      ['上下文窗口', num(w.contextWindow) + badge('measured')],
      ['已用 tokens', num(tt.value) + badge(tt.basis)],
      ['压力', (typeof w.pressurePct === 'number' ? w.pressurePct.toFixed(1) + '%' : 'n/a')],
      ['路由', w.routed ? esc(w.routed.provider + '/' + w.routed.model) : 'n/a'],
      ['触发线', num(budget.triggerLine)],
      ['face 健康', '<span class="face"><span class="dot ' + esc(face.state || 'absent') + '"></span>' + esc(face.state || 'absent') + '</span>']
    ]);
    var cache = s.cache || {};
    var cl = rows([
      ['样本数', num(cache.samples)],
      ['cache 口径', badge(cache.basis)],
      ['缓存读取', cache.latest && cache.latest.cacheReadTokens !== undefined ? num(cache.latest.cacheReadTokens) + badge(cache.latest.measured ? 'measured' : 'estimated') : 'n/a'],
      ['缓存写入', cache.latest && cache.latest.cacheWriteTokens !== undefined ? num(cache.latest.cacheWriteTokens) : 'n/a']
    ]);
    var rangeRows = (s.ranges || []).map(function (r) {
      return [r.startSeq + '-' + r.endSeq, num(r.estimatedTokens), r.protected ? 'protected' : '可折叠'];
    });
    var foldRows = (s.folds || []).map(function (f) {
      return [esc(f.foldId), esc(f.status), f.startSeq + '-' + f.endSeq, num(f.tokensBefore - f.tokensAfter)];
    });
    var deg = (s.degraded || []).map(function (d) { return '<div class="degraded-line">- ' + esc(d) + '</div>'; }).join('');
    var faceDetail = (face.evidence || []).map(function (e) {
      return '<div class="degraded-line">' + (e.ok ? '[OK] ' : '[--] ') + esc(e.signal) + ': ' + esc(e.detail) + '</div>';
    }).join('');
    document.getElementById('view-body').innerHTML =
      head +
      '<h2 style="font-size:12px;margin:12px 0 4px;border:0;padding:0">窗口 / 预算 / 缓存</h2>' +
      // budget six lines appended below
      rows([
        ['max output cap', num(budget.maxOutputCap)],
        ['reserve', num(budget.reserve)],
        ['pessimistic reserve', num(budget.pessimisticReserve)],
        ['keep-recent', num(budget.keepRecent)],
        ['summary input cap', num(budget.summaryInputCap)],
        ['reply cap', num(budget.replyCap)]
      ]) + cl +
      '<h2 style="font-size:12px;margin:12px 0 4px;border:0;padding:0">可折叠区间</h2>' +
      '<div class="scroll">' + table(['区间 seq', '估算 tokens', '状态'], rangeRows) + '</div>' +
      '<h2 style="font-size:12px;margin:12px 0 4px;border:0;padding:0">折叠账本</h2>' +
      '<div class="scroll">' + table(['foldId', '状态', '覆盖', '净省'], foldRows) + '</div>' +
      (face.summary ? '<h2 style="font-size:12px;margin:12px 0 4px;border:0;padding:0">face 诊断</h2><div class="degraded-line">' + esc(face.summary) + '</div>' + faceDetail : '') +
      deg;
  }

  function renderStats(s) {
    var a = s.attribution || {};
    var ts = a.threeState || { measured: 0, semi: 0, estimated: 0 };
    var total = ts.measured + ts.semi + ts.estimated;
    var pct = function (n) { return total > 0 ? (n / total * 100).toFixed(1) + '%' : '0%'; };
    var repaid = (a.breakevenTable || []).filter(function (r) { return r.repaid === true; }).length;
    var head = rows([
      ['累计折叠', num(a.foldCount)],
      ['净省 tokens', num(a.netTokensSaved && a.netTokensSaved.value) + badge(a.netTokensSaved && a.netTokensSaved.basis)],
      ['回本次数', num(repaid) + ' / ' + num((a.breakevenTable || []).length)],
      ['纯净样本占比', (typeof a.cleanSampleRatio === 'number' ? (a.cleanSampleRatio * 100).toFixed(1) + '%' : 'n/a') + (a.clean ? ' [可信]' : ' [不足·结论保留]')],
      ['三态 measured', pct(ts.measured) + badge('measured')],
      ['三态 semi', pct(ts.semi)],
      ['三态 estimated', pct(ts.estimated) + badge('estimated')],
      ['cache 实测占比', badge(s.cache && s.cache.basis)]
    ]);
    var resetRows = (a.resetSummary || []).map(function (r) { return [esc(r.kind), num(r.count)]; });
    document.getElementById('stats-body').innerHTML =
      head +
      '<h2 style="font-size:12px;margin:12px 0 4px;border:0;padding:0">重置台账摘要</h2>' +
      table(['类型', '次数'], resetRows);
  }

  var FIELDS = [
    ['enabled', 'enabled (boolean)', 'boolean'],
    ['nudgeThresholds', 'nudgeThresholds', 'text'],
    ['keepRecentTokens', 'keepRecentTokens', 'number'],
    ['maxFoldFraction', 'maxFoldFraction', 'number'],
    ['minFoldableTokens', 'minFoldableTokens', 'number'],
    ['protectionFloorTokens', 'protectionFloorTokens', 'number'],
    ['summaryFloorChars', 'summaryFloorChars', 'number'],
    ['summaryCeilingChars', 'summaryCeilingChars', 'number'],
    ['netShrinkTolerance', 'netShrinkTolerance', 'number']
  ];
  var SWITCHES = [
    ['observe.enabled', 'observe.enabled'],
    ['patch.guardObserveEvents', 'patch.guardObserveEvents'],
    ['autofold.enabled', 'autofold.enabled']
  ];

  function buildForm(cfg) {
    if (formBuilt) return;
    var f = cfg.fields || {}, fs = cfg.faceSwitches || {};
    var html = '';
    FIELDS.forEach(function (spec) {
      var key = spec[0], label = spec[1], type = spec[2];
      var val = f[key];
      if (type === 'boolean') {
        html += '<label class="chk"><input type="checkbox" data-key="' + key + '" data-type="boolean"' + (val === true ? ' checked' : '') + '><span>' + esc(label) + '</span></label>';
      } else {
        html += '<label class="f"><span>' + esc(label) + '</span><input type="text" data-key="' + escAttr(key) + '" data-type="' + escAttr(type) + '" value="' + escAttr(val === undefined ? '' : val) + '"></label>';
      }
    });
    html += '<h2 style="font-size:12px;margin:14px 0 4px;border:0;padding:0">face 开关</h2>';
    SWITCHES.forEach(function (spec) {
      var key = spec[0], label = spec[1];
      var val = fs[key] !== undefined ? fs[key] : f[key];
      html += '<label class="chk"><input type="checkbox" data-key="' + key + '" data-type="boolean"' + (val === true ? ' checked' : '') + '><span>' + esc(label) + '</span></label>';
    });
    html += '<label class="f"><span>preflightMode (off|observe|enforce)</span><select data-key="preflightMode" data-type="select">' +
      ['off', 'observe', 'enforce'].map(function (m) {
        var cur = fs.preflightMode !== undefined ? fs.preflightMode : f.preflightMode;
        return '<option value="' + m + '"' + (cur === m ? ' selected' : '') + '>' + m + '</option>';
      }).join('') + '</select></label>';
    html += '<button type="submit" id="settings-save"' + (cfg.writable ? '' : ' disabled') + '>保存 overlay</button>';
    if (!cfg.writable) html += '<div class="note">当前 composition 无 configEditor，设置只读。</div>';
    document.getElementById('settings-form').innerHTML = html;
    formBuilt = true;
    document.getElementById('settings-form').addEventListener('submit', function (ev) {
      ev.preventDefault();
      saveSettings();
    });
  }

  function saveSettings() {
    var form = document.getElementById('settings-form');
    var patch = {};
    var inputs = form.querySelectorAll('[data-key]');
    for (var i = 0; i < inputs.length; i++) {
      var el = inputs[i];
      var key = el.getAttribute('data-key');
      var type = el.getAttribute('data-type');
      if (type === 'boolean') patch[key] = !!el.checked;
      else if (type === 'number') { var n = Number(el.value); patch[key] = isFinite(n) ? n : el.value; }
      else patch[key] = el.value;
    }
    var msg = document.getElementById('settings-msg');
    msg.className = 'msg';
    msg.textContent = '保存中…';
    fetch('/zctx-ui/api/config', {
      method: 'POST',
      headers: authHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify(patch)
    }).then(function (r) {
      return r.json().then(function (j) { return { ok: r.ok, body: j }; });
    }).then(function (res) {
      msg.className = 'msg ' + (res.ok ? 'ok' : 'err');
      msg.textContent = res.ok ? '已保存，下次加载生效。' : ('保存失败：' + (res.body && res.body.error || ('HTTP ' + (res.ok ? 200 : 500))));
    }).catch(function (e) {
      msg.className = 'msg err';
      msg.textContent = '保存失败：' + e.message;
    });
  }

  function renderSessionPicker(ids, current) {
    var wrap = document.getElementById('session-pick-wrap');
    var select = document.getElementById('session-pick');
    if (!wrap || !select) return;
    if (!ids || ids.length < 2) { wrap.style.display = 'none'; return; }
    wrap.style.display = '';
    var prev = select.value;
    var chosen = current || prev || ids[0];
    var html = ids.map(function (id) {
      return '<option value="' + escAttr(id) + '"' + (id === chosen ? ' selected' : '') + '>' + esc(id) + '</option>';
    }).join('');
    if (select.innerHTML !== html) {
      select.innerHTML = html;
      select.value = chosen;
    }
  }

  function refresh() {
    var url = '/zctx-ui/api/snapshot' + (session ? '?session=' + encodeURIComponent(session) : '');
    api(url).then(function (s) {
      if (!session && s.sessionId) session = s.sessionId;
      renderSessionPicker(s.availableSessions || [], session || s.sessionId);
      document.getElementById('meta').textContent =
        (s.sessionId ? esc(s.sessionId) : '无会话') + ' · ' + new Date(s.generatedAt).toLocaleTimeString();
      renderView(s);
      renderStats(s);
    }).catch(function (e) {
      document.getElementById('meta').textContent = '快照读取失败：' + e.message;
    });
    if (!formBuilt) {
      api('/zctx-ui/api/config').then(buildForm).catch(function () { /* settings stay empty on error */ });
    }
  }

  var pick = document.getElementById('session-pick');
  if (pick) {
    pick.addEventListener('change', function () {
      session = pick.value; // user switch: lock to the chosen session, re-poll now
      refresh();
    });
  }

  // 复制面板地址（webview 里 target=_blank 不可靠——地址复制后可粘到任意浏览器）
  var copyBtn = document.getElementById('copy-address');
  if (copyBtn) {
    copyBtn.addEventListener('click', function () {
      var url = location.origin + '/zctx-ui';
      var result = document.getElementById('copy-result');
      var show = function (t) { if (result) result.textContent = t; };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(function () { show('✓ 已复制: ' + url); }).catch(function () { show(url); });
      } else {
        show(url); // clipboard 面不可用时至少把地址摆出来
      }
    });
  }

  refresh();
  setInterval(refresh, 5000);
})();
<\/script>
</body>
</html>
`;
// src/ui/snapshot.ts
/**
* Realtime process-memory snapshot source (ZCTX-UI DESIGN §2) — D1.
*
* HARD RULE (DESIGN §0 / §2.1 / R1): this is a THIN WRAPPER over existing
* accessors. It does NOT re-implement budget / range / attribution math, never
* touches the model stream or registers any stream listener, and is strictly
* READ-ONLY. Every number carries honest provenance (measured / estimated /
* unknown) so the UI never presents an estimate as a fact.
*
* Reused accessors (all pre-existing, see DESIGN §2.1):
*   resolveWatchedSession / currentSession / storeFor / validatorConfig /
*   windowCache → injected as deps;  store.observabilitySnapshot /
*   usageSnapshot / ledgerEntries / surfaceNodes;  computeBudget /
*   foldableRanges / routedRequestTarget / tokenMeter.measure.
*
* @module ui/snapshot
*/
/** Dominant three-state grade → basis for netTokensSaved (measured > semi > estimated). */
function dominantBasis(threeState) {
	if (threeState.measured > 0 && threeState.measured >= threeState.semi && threeState.measured >= threeState.estimated) return "measured";
	if (threeState.semi > 0 && threeState.semi >= threeState.estimated) return "estimated";
	if (threeState.estimated > 0) return "estimated";
	return "none";
}
/** Build an honest empty snapshot (no session / invisible id / probe fault). */
function emptySnapshot(reason, faceHealth, generatedAt, availableSessions, resolution = "none") {
	return {
		version: 1,
		generatedAt,
		availableSessions: [...availableSessions],
		sessionId: void 0,
		sessionResolution: resolution,
		window: {
			contextWindow: void 0,
			totalTokens: void 0,
			pressurePct: void 0,
			routed: void 0
		},
		budget: void 0,
		ranges: [],
		folds: [],
		attribution: void 0,
		cache: {
			samples: 0,
			measured: false,
			basis: "none"
		},
		faceHealth,
		degraded: [reason]
	};
}
/**
* Create a snapshot source from injected dependencies. The dependency seam is
* what lets unit tests inject a known ledger (V1) without constructing a live
* host; production wires it from `ZcontextPlugin` (DESIGN §2.2).
*/
function createSnapshotSource(deps) {
	const snapshotFor = (sessionId) => {
		const generatedAt = Date.now();
		let availableSessions = [];
		try {
			availableSessions = deps.listSessions?.() ?? [];
		} catch {
			availableSessions = [];
		}
		let faceHealth;
		try {
			faceHealth = deps.faceHealth();
		} catch {
			faceHealth = {
				state: "absent",
				evidence: [],
				probedAt: generatedAt,
				summary: "face 健康读取失败"
			};
		}
		let session;
		let sessionResolution;
		if (sessionId !== void 0) {
			session = deps.resolveSession(sessionId);
			if (session === void 0) return emptySnapshot(`session ${sessionId} not watched`, faceHealth, generatedAt, availableSessions);
			sessionResolution = "explicit";
		} else {
			session = deps.currentSession();
			if (session === void 0) return emptySnapshot("no active session", faceHealth, generatedAt, availableSessions);
			sessionResolution = "latest-watched";
		}
		const degraded = [];
		const runtime = deps.runtime;
		let contextWindow;
		try {
			contextWindow = deps.windowFor(session);
		} catch (error) {
			degraded.push(`window cache read failed: ${error instanceof Error ? error.message : String(error)}`);
		}
		let totalTokens;
		if (runtime.tokenMeter === void 0 || typeof runtime.tokenMeter.measure !== "function") degraded.push("token meter unavailable");
		else try {
			totalTokens = {
				value: runtime.tokenMeter.measure(session).totalTokens,
				basis: "measured"
			};
		} catch (error) {
			degraded.push(`token meter failed: ${error instanceof Error ? error.message : String(error)}`);
			totalTokens = {
				value: 0,
				basis: "unknown"
			};
		}
		let pressurePct;
		if (contextWindow !== void 0 && contextWindow > 0 && totalTokens?.basis === "measured") pressurePct = totalTokens.value / contextWindow * 100;
		let routed;
		try {
			routed = routedRequestTarget(session);
		} catch (error) {
			const reason = `route target read failed: ${error instanceof Error ? error.message : String(error)}`;
			degraded.push(reason);
			return emptySnapshot(reason, faceHealth, generatedAt, availableSessions, "degraded");
		}
		let budget;
		if (contextWindow !== void 0) try {
			budget = computeBudget({ contextWindow });
		} catch (error) {
			degraded.push(`budget computation failed: ${error instanceof Error ? error.message : String(error)}`);
		}
		let store;
		try {
			store = runtime.storeFor(session);
		} catch (error) {
			const reason = `store resolution failed: ${error instanceof Error ? error.message : String(error)}`;
			degraded.push(reason);
			return emptySnapshot(reason, faceHealth, generatedAt, availableSessions, "degraded");
		}
		let ranges = [];
		try {
			ranges = foldableRanges(store.surfaceNodes(), runtime.validatorConfig(session));
		} catch (error) {
			degraded.push(`range computation failed: ${error instanceof Error ? error.message : String(error)}`);
		}
		let folds = [];
		try {
			folds = [...store.ledgerEntries()];
		} catch (error) {
			degraded.push(`ledger read failed: ${error instanceof Error ? error.message : String(error)}`);
		}
		let cache = {
			samples: 0,
			measured: false,
			basis: "none"
		};
		try {
			const usage = store.usageSnapshot();
			const basis = usage.samples === 0 ? "none" : usage.measured ? "measured" : "estimated";
			cache = {
				samples: usage.samples,
				measured: usage.measured,
				basis,
				...usage.latest !== void 0 ? { latest: {
					measured: usage.latest.measured,
					...usage.latest.cacheReadTokens !== void 0 ? { cacheReadTokens: usage.latest.cacheReadTokens } : {},
					...usage.latest.cacheWriteTokens !== void 0 ? { cacheWriteTokens: usage.latest.cacheWriteTokens } : {}
				} } : {}
			};
		} catch (error) {
			degraded.push(`usage snapshot failed: ${error instanceof Error ? error.message : String(error)}`);
		}
		let attribution;
		try {
			const obs = store.observabilitySnapshot();
			const foldCount = folds.length;
			const netValue = folds.reduce((sum, entry) => sum + (entry.tokensBefore - entry.tokensAfter), 0);
			attribution = {
				threeState: obs.threeState,
				cleanSampleRatio: obs.cleanSampleRatio,
				clean: obs.cleanSampleRatio >= runtime.cleanSampleFloor,
				breakevenTable: obs.breakevenTable,
				resetSummary: obs.resetSummary,
				foldCount,
				netTokensSaved: {
					value: netValue,
					basis: dominantBasis(obs.threeState)
				}
			};
		} catch (error) {
			degraded.push(`observability snapshot failed: ${error instanceof Error ? error.message : String(error)}`);
		}
		const resolvedSessionId = session.id;
		return {
			version: 1,
			generatedAt,
			availableSessions: [...availableSessions],
			sessionId: typeof resolvedSessionId === "string" ? resolvedSessionId : void 0,
			sessionResolution,
			window: {
				contextWindow,
				totalTokens,
				pressurePct,
				routed
			},
			budget,
			ranges,
			folds,
			attribution,
			cache,
			faceHealth,
			degraded
		};
	};
	return { snapshotFor };
}
// src/ui/face-probe.ts
/** Default visible sink — stderr, never throws (a diagnostic must not break boot). */
const defaultSink = (line) => {
	try {
		process.stderr.write(`${line}\n`);
	} catch {}
};
/** Safely read a possibly-throwing capability (cordis get-trap: ctx.tools may throw). */
function capability(read) {
	try {
		return read();
	} catch {
		return;
	}
}
/**
* Run the three-signal face probe on demand. Pure with respect to the probe
* result (fresh every call, no caching); the only side effect is an optional
* visible sink line when the state is not `active`.
*
* @param ctx   host context, capability-probed (may be a bare/mock object)
* @param state observable counters maintained by plugin.ts wire*Face
* @param sink  visible sink; defaults to stderr. Tests inject a recorder.
*/
function detectFaceActivation(ctx, state, sink) {
	const probedAt = Date.now();
	const evidence = [];
	let toolsCapable = false;
	let toolsOk = false;
	try {
		toolsCapable = typeof capability(() => ctx.tools?.register) === "function";
		if (!toolsCapable) evidence.push({
			signal: "tools.register",
			ok: false,
			detail: "ctx.tools.register capability absent"
		});
		else if (state.toolFaceRegistered > 0) {
			toolsOk = true;
			evidence.push({
				signal: "tools.register",
				ok: true,
				detail: `registered=${state.toolFaceRegistered}`
			});
		} else if (state.toolFaceBuilt > 0) evidence.push({
			signal: "tools.register",
			ok: false,
			detail: `tools built=${state.toolFaceBuilt} but registered=0 (registration refused)`
		});
		else evidence.push({
			signal: "tools.register",
			ok: false,
			detail: "no tools face built"
		});
	} catch (error) {
		evidence.push({
			signal: "tools.register",
			ok: false,
			detail: `probe fault: ${error instanceof Error ? error.message : String(error)}`
		});
	}
	let guidanceCapable = false;
	let guidanceOk = false;
	try {
		guidanceCapable = typeof capability(() => ctx.systemPrompt?.section) === "function";
		if (!guidanceCapable) evidence.push({
			signal: "system-prompt.guidance",
			ok: false,
			detail: "ctx.systemPrompt.section capability absent"
		});
		else if (state.guidanceRegistered) {
			guidanceOk = true;
			evidence.push({
				signal: "system-prompt.guidance",
				ok: true,
				detail: "guidance section injected"
			});
		} else evidence.push({
			signal: "system-prompt.guidance",
			ok: false,
			detail: "section capability on disk but guidance not injected"
		});
	} catch (error) {
		evidence.push({
			signal: "system-prompt.guidance",
			ok: false,
			detail: `probe fault: ${error instanceof Error ? error.message : String(error)}`
		});
	}
	let observeOk = false;
	try {
		observeOk = state.observeWired && state.guardBridgePresent;
		const trace = state.guardRecordsSeen > 0 ? `, guard records=${state.guardRecordsSeen}` : ", no guard records (legal inert)";
		evidence.push({
			signal: "guard-observe",
			ok: observeOk,
			detail: observeOk ? `observe wired + guard bridge present${trace}` : `observe wired=${state.observeWired}, guard bridge=${state.guardBridgePresent}`
		});
	} catch (error) {
		evidence.push({
			signal: "guard-observe",
			ok: false,
			detail: `probe fault: ${error instanceof Error ? error.message : String(error)}`
		});
	}
	let webServerOk = true;
	if (state.webServerPresent !== void 0) {
		webServerOk = state.webServerPresent;
		evidence.push({
			signal: "webServer",
			ok: webServerOk,
			detail: webServerOk ? "webServer service available — /zctx-ui routes can register" : "webServer service unavailable — /zctx-ui routes NOT registered (UI unreachable)"
		});
	}
	const anyCapability = toolsCapable || guidanceCapable;
	const anyFlag = toolsOk || guidanceOk || state.toolFaceBuilt > 0 || state.observeWired || state.guardBridgePresent;
	const active = webServerOk && toolsOk && guidanceOk && (state.observeWired || state.guardBridgePresent);
	const result = active ? "active" : !anyCapability && !anyFlag && webServerOk ? "absent" : "degraded";
	const view = {
		state: result,
		evidence,
		probedAt,
		summary: active ? "桌面 face 三重信号齐全（tools + guidance + observe/guard），webServer 在位，已激活" : result === "degraded" ? "face 部分信号缺席或被拒：" + evidence.filter((e) => !e.ok).map((e) => e.signal).join(", ") : "桌面 face 未激活（无 tools/guidance/observe 信号）"
	};
	if (result !== "active") try {
		(sink ?? defaultSink)(`[zctx-ui] face ${result}: ${view.summary}`);
	} catch {}
	return view;
}
/**
* A transition-deduping sink for production: emits a line only when the
* diagnostic text changes (first degraded/absent + state transitions), so a
* 5s UI poll does not spam stderr. This dedups SINK EMISSION only — the probe
* itself still recomputes on demand (Z25: no memoized absence).
*/
function createTransitionSink(write = defaultSink) {
	let lastLine = "";
	return (line) => {
		if (line === lastLine) return;
		lastLine = line;
		write(line);
	};
}
/** Honest bootstrap view for paths with no probe state yet (B3 compatibility). */
function unknownFaceHealth() {
	return {
		state: "absent",
		evidence: [],
		probedAt: Date.now(),
		summary: "face 探针尚未采集信号（bootstrap）"
	};
}
// src/ui/index.ts
/**
* UI aggregate surface (ZCTX-UI DESIGN §1.1) — D3.
*
* The plugin imports the UI face only from here. This module registers the
* four routes and exposes the config/snapshot views; the snapshot source itself
* is built by the plugin (so its public `snapshotFor` and the HTTP route share
* one source).
*
* Layer discipline (DESIGN §9): src/ui/** is a leaf — it is never imported by
* fold-engine / autofold / observe / preflight. It only reads the ledger via
* injected accessors. No request-body rewrite, no stream listener (R1).
*
* @module ui/index
*/
/** Attach the four UI routes to a host context. Returns the route disposer. */
function attachUi(ctx, accessors) {
	const getConfig = () => {
		const all = accessors.configValues();
		return {
			fields: {
				enabled: all.enabled,
				nudgeThresholds: all.nudgeThresholds,
				keepRecentTokens: all.keepRecentTokens,
				maxFoldFraction: all.maxFoldFraction,
				minFoldableTokens: all.minFoldableTokens,
				protectionFloorTokens: all.protectionFloorTokens,
				summaryFloorChars: all.summaryFloorChars,
				summaryCeilingChars: all.summaryCeilingChars,
				netShrinkTolerance: all.netShrinkTolerance
			},
			faceSwitches: {
				"observe.enabled": all["observe.enabled"],
				"patch.guardObserveEvents": all["patch.guardObserveEvents"],
				"autofold.enabled": all["autofold.enabled"],
				preflightMode: all.preflightMode
			},
			writable: resolveWritable(ctx)
		};
	};
	const writeConfig = (patch) => writeOverlay(ctx, patch);
	return registerUiRoutes({
		ctx,
		pageHtml: UI_PAGE_HTML,
		snapshotFor: accessors.snapshotFor,
		getConfig,
		writeConfig,
		...accessors.webServer !== void 0 ? { webServer: accessors.webServer } : {}
	});
}
/** Capability probe: can the host persist config overlay edits? */
function resolveWritable(ctx) {
	try {
		const c = ctx;
		const editor = c?.get?.("configEditor") ?? c?.configEditor;
		return editor !== void 0 && editor !== null;
	} catch {
		return false;
	}
}
// src/plugin.ts
/**
* dsh-zcontext plugin — the W4 wiring (task card W4 §2).
*
* `ZcontextPlugin` extends the cordis `Service` base through the PEER
* STRUCTURAL contract: the host's `@deepseek-ai/cordis` is required lazily
* at load time and, when absent, a local structural shim with the same
* `(ctx, name)` constructor surface takes over — the class always loads
* (fail-soft, plan §3: "cordis 只类型引用 + lazy require").
*
* Faces registered when `enabled` (default true), each behind a capability
* probe (AutoPilot probes mode): a missing host service skips its face with
* a log line and never breaks boot —
*
*   - `session/event` feed  → maintains per-session FoldStores + window cache
*   - `ctx.tools.register`  → the four zctx tools (defineTool-wrapped, S3/S8)
*   - `systemPrompt.section`→ the static byte-stable guidance (S10, no complete)
*   - `systemPrompt.context`→ the threshold nudge with **required: true** (B2:
*     survives the official suppressRuntimeContext filter that drops
*     non-required contributions, system-prompt/src/index.ts:627-628)
*   - `commands.register`   → the `/zctx` command
*   - `llm/stream` (outer)  → the S1 preflight listener (v0.2.0 V4,
*     RES-adapter-route §11b S1): estimates the request's context before the
*     wire; mode 'observe' (DEFAULT) only records the calibration ledger
*     (estimate vs the real usage that follows), mode 'enforce' (opt-in,
*     R2) short-circuits a hit with the official CONTEXT_WINDOW_EXCEEDED
*     finish so the compaction recovery chain takes over; mode 'off'
*     registers nothing.
*   - `llm/stream` (inner)  → the read-only cache-observe listener (v0.2.0
*     V2, RES-observe-route a.2/a.3): per-attempt request snapshots +
*     prefix-break classification land in the per-session store's
*     process-memory ledgers; attemptCapture is opt-in (`observe.attemptCapture`).
*     Strictly observational — never short-circuits (the preflight listener
*     above is the only short-circuiting face).
*   - `llm/stream` (inner)  → the P6-E autoFold listener (v0.3, RES-bc §9.1
*     MUST 5): the THIRD face beyond observe/enforce, armed by
*     `autofold.enabled` (default false — v0.3 explicit opt-in). On a V4
*     trigger hit the chain folds server-side (deterministic selection →
*     purpose-marked summary supply → validator gates → fold-engine surface
*     replace → transient-retry/halving/digest degradation), then passes the
*     request through unconditionally (fail-open, bc F1.20). Registered
*     INNERMOST: a preflight 'enforce' short-circuit suppresses it (warned
*     at wire time when both are on).
*   - `globalThis.__zctxPatch__` → the P4 patch-bridge face (v0.2.1, plan §3
*     补丁连接设计): the receiving side of the ONE-LINE forwarding stub the
*     external app.asar patcher inserts into the OFFICIAL PiAiAdapter — wire
*     faces for OFFICIAL-route requests ride the same per-session ledger;
*     without the patch the mount is inert (pure-plugin face unchanged).
*
* The nudge context provider is a PURE function of (pressure, budget,
* ranges): it contributes '' (nothing on the wire) unless a threshold was
* crossed since the last evaluation — the 跨越计次重付 cache model. It
* consumes the official AssembleContext (W4-4): when the assembly carries the
* agent's session the evaluation is attributed to that session (per-session
* pressure), falling back to the most recently created session otherwise.
* The context window is resolved asynchronously from the routed model info and
* cached per session; without it the provider contributes nothing honestly.
* Below the CCM legal domain (W < 32768) the whole automatic face stays off
* (engine-layer gate; tools remain usable).
*
* Zero independent storage: per-session FoldStores attach lazily on first
* use (the blessed resume-restore scan) and are maintained from the feed.
*
* @module plugin
*/
/** Service name the plugin registers under. */
const SERVICE_NAME = "dsh-zcontext";
/** Nudge context registration metadata (official PromptContext subset). */
const NUDGE_CONTEXT_NAME = "zctx-nudge";
/** Nudge context join order (after core layers, before the guidance section). */
const NUDGE_CONTEXT_ORDER = 800;
/**
* Fail-soft structural mirror of the cordis Service base: stores ctx/name
* without registering on a reflection service (used when the host package is
* not resolvable from this module).
*/
var StructuralServiceShim = class {
	ctx;
	name;
	constructor(ctx, name) {
		this.ctx = ctx;
		this.name = name;
	}
};
const nodeRequire = createRequire(import.meta.url);
/** Resolve the host's cordis Service lazily; undefined keeps loading fail-soft. */
function loadCordisService() {
	try {
		const mod = nodeRequire("@deepseek-ai/cordis");
		const resolved = typeof mod?.Service === "function" ? mod.Service : void 0;
		zctxDebug(`loadCordisService: '@deepseek-ai/cordis' import OK; Service is ${resolved === void 0 ? "NOT a function (undefined chosen)" : "a function (real Service base)"}`);
		return resolved;
	} catch (error) {
		zctxDebug(`loadCordisService: '@deepseek-ai/cordis' import FAILED (${error instanceof Error ? error.message : String(error)}) — falling back to the structural shim base (inject discipline inactive)`);
		return;
	}
}
/** The Service base this plugin extends: the host's real one when resolvable. */
const ServiceBase = loadCordisService() ?? StructuralServiceShim;
zctxDebug(`module loaded from ${import.meta.url}; ServiceBase = ${ServiceBase === StructuralServiceShim ? "StructuralServiceShim (shim)" : "real cordis Service"}`);
/** Parse "25,50,75,90" into ascending threshold numbers (invalid entries dropped). */
function parseThresholds(spec) {
	const seen = /* @__PURE__ */ new Set();
	for (const part of spec.split(",")) {
		const value = Number(part.trim());
		if (Number.isFinite(value) && value >= 0 && value <= 100) seen.add(value);
	}
	return [...seen].sort((a, b) => a - b);
}
/**
* The dsh-zcontext plugin (cordis class plugin, constructed with
* `(ctx, config)`; config validated through the static Config schema).
*/
var ZcontextPlugin = class extends ServiceBase {
	/**
	* Services this plugin requires (cordis inject discipline). Each key is
	* read-verified against the provider's registration name on the anchor tree
	* (v0.2.1 P0, tasks/ZCTX/cards/P0-inject-fix.md — a wrong key means the
	* plugin stays silently PENDING, which is worse than a loud throw):
	*
	*   - `tools`        core/tools/src/index.ts:850        `super(ctx, 'tools')`
	*   - `systemPrompt` core/system-prompt/src/index.ts:442 `super(ctx, 'systemPrompt')`
	*   - `commands`     interaction/commands/src/index.ts:277 `super(ctx, 'commands')`
	*   - `llm`          llm/llm/src/index.ts:354            `super(ctx, 'llm')`
	*   - `tokenMeter`   llm/token-meter/src/index.ts:111    `super(ctx, 'tokenMeter')`
	*   - `webServer`    host/webserver/src/index.ts (the web/desktop profile
	*                    provides it; ZCTX-UI P0 — without this declaration
	*                    `ctx.get('webServer')` returns undefined while that
	*                    provider is not ACTIVE, so the UI routes silently never
	*                    registered on the real desktop host: GET /zctx-ui → 404).
	*                    The dsh-headless profile does NOT mount dsh-zcontext at
	*                    all, so no headless PENDING regression; the route layer
	*                    still capability-probes `register` and degrades no-op.
	*
	* P3 HF-02 (AUD-host-faces §8): the v0.2.1 declaration also listed
	* `'sessions'` — a DECLARED-BUT-NEVER-READ key (grep across src: zero
	* `ctx.sessions` consumers; session access goes through the `session/*`
	* event feed and the tool/preflight/adapter faces' own session args). A
	* declared hard dependency with no consumer turns the official
	* session-controller service into a silent boot blocker (PENDING), which
	* contradicts the read-verified discipline above — the key was removed
	* (E-repro HF-02 3/3: five keys present, no sessions → the plugin stayed
	* PENDING until a sessions stub was added; after removal it mounts).
	*
	* The official convention is `BasicCompactionEngine.inject =
	* ['llm', 'tokenMeter', 'sessions']` (compaction-basic/src/index.ts:114) —
	* the official engine READS its sessions dependency, which is exactly the
	* difference: declare what you consume, consume what you declare.
	* Without this declaration the constructor's `ctx.tokenMeter`/`ctx.llm`
	* reads throw `cannot get property "X" without inject`
	* (vendor/cordis/src/reflect.ts:144) — the v0.2.0 real-device failure.
	* `ctx.logger` (own Context property, cordis context.ts:81) and `ctx.on`
	* (mixin accessor) need no declaration.
	*/
	static inject = [
		"tools",
		"systemPrompt",
		"commands",
		"llm",
		"tokenMeter",
		"webServer"
	];
	static Config = configSchema;
	/** Host context (structural duck-type; capability-probed per face). */
	ctx;
	/** Resolved plugin configuration (plan §3 contract). */
	config;
	stores = /* @__PURE__ */ new WeakMap();
	windowCache = /* @__PURE__ */ new WeakMap();
	lastPressure = /* @__PURE__ */ new WeakMap();
	liveSessions = /* @__PURE__ */ new Set();
	runtime;
	/** ZCTX-POLISH W1: durable SQLite ledger sink (fail-soft; may be closed). */
	ledgerSink;
	ledgerStore;
	/** The observe face's listener; undefined when the face is off (config or capability). */
	observe;
	/** The S1 preflight face's listener; undefined when preflightMode is 'off'. */
	preflight;
	/**
	* The P6-E autoFold face's listener; undefined when the face is gated off
	* (autofold.enabled=false or a loud config gate failed). Registered
	* INNERMOST (after the preflight listener — enforce precedence documented
	* in autofold.ts).
	*/
	autofold;
	/**
	* The S2 adapter face's registration continuation (undefined when the face
	* gated off synchronously). The constructor is synchronous (cordis), so
	* the async registration is a tracked continuation: failures log honestly
	* inside, never throw — and tests/status can await the settled state.
	*/
	adapterRegistration;
	/**
	* The adapter face's health view (P3 HF-10 status segment): the state the
	* registration continuation last reached + its routes + the mapping source.
	* Set synchronously by wireAdapterFace (every gate records), refined by the
	* async continuation. `adapterFaceSettled` flips true when the continuation
	* resolves (the status segment renders it as a fact).
	*/
	adapterFaceHealth = {
		state: "not wired",
		routes: []
	};
	adapterFaceSettled = true;
	warnedWindowFailure = false;
	/**
	* The P6-C guard-observe bridge: the log-only consumer of the patched
	* base-context chain's `cache/guard-observe` session events (process-memory
	* summaries per session, surfaced in zctx_status). Created in the
	* constructor with the ctx logger (zero cost when the patch is absent — no
	* event ever arrives) and fed from the session/event firehose under the
	* `patch.guardObserveEvents` switch.
	*/
	guardBridge;
	/**
	* The P4 patch-bridge face (external app.asar patch receiver): the mount
	* state string the status segment renders, the lazily-loaded host faces
	* (attribution headers for the wire faces), and whether that load settled.
	* No ctx service access — the mount needs no inject declaration.
	*/
	patchMountState = "idle (not armed)";
	patchHost;
	patchHostLoaded = false;
	/**
	* ZCTX-UI face-activation counters (DESIGN §4 / B4 seam): wire*Face records
	* successful registrations here so the face probe can render an honest view.
	* Only additions — the degrade/skip semantics of each face are unchanged.
	*/
	toolFaceRegistered = 0;
	toolFaceBuilt = 0;
	guidanceRegistered = false;
	/** Transition-deduping visible sink for face degradation (Z28: stderr, not ctx.logger). */
	faceSink = createTransitionSink();
	/** The UI snapshot source (thin delegate behind public `snapshotFor`). */
	snapshotSource;
	constructor(ctx, config = {}) {
		super(ctx, SERVICE_NAME);
		this.ctx = ctx;
		this.config = Object.freeze({
			...configDefaults,
			...config
		});
		{
			const opened = new LedgerStore(defaultLedgerPath(process.env.DSH_HOME !== void 0 && process.env.DSH_HOME !== "" ? process.env.DSH_HOME : join(homedir(), ".dsh")));
			if (opened.available) {
				this.ledgerStore = opened;
				this.ledgerSink = opened;
			} else zctxDebug(`ledger open failed — durable stats disabled (${opened.openError})`);
		}
		if (zctxDebugEnabled()) {
			const face = (value) => value === void 0 ? "undefined" : typeof value === "function" ? "function" : typeof value;
			zctxDebug(`constructor: ctx surface = { on: ${face(ctx.on)}, tools: ${face(ctx.tools)}, tools.register: ${face(ctx.tools?.register)}, systemPrompt: ${face(ctx.systemPrompt)}, systemPrompt.section: ${face(ctx.systemPrompt?.section)}, systemPrompt.context: ${face(ctx.systemPrompt?.context)}, commands: ${face(ctx.commands)}, commands.register: ${face(ctx.commands?.register)}, llm: ${face(ctx.llm)}, llm.registerAdapter: ${face(ctx.llm?.registerAdapter)}, tokenMeter: ${face(ctx.tokenMeter)}, logger: ${face(ctx.logger)}, reflect.provide: ${face(ctx.reflect?.provide)} }`);
			zctxDebug(`constructor: ctx own keys = ${zctxDebugJson(Object.getOwnPropertyNames(ctx))}; this instanceof shim = ${Object.getPrototypeOf(this).constructor === StructuralServiceShim}; config keys = ${zctxDebugJson(Object.keys(config))}`);
		}
		this.guardBridge = createGuardObserveBridge(ctx.logger);
		this.runtime = {
			logger: ctx.logger,
			tokenMeter: ctx.tokenMeter,
			llm: ctx.llm,
			cleanSampleFloor: this.config.cleanSampleFloor,
			preflightMode: this.config.preflightMode,
			storeFor: (session) => this.storeFor(session),
			validatorConfig: (session) => this.validatorConfig(session),
			adapterHealth: () => ({
				...this.adapterFaceHealth,
				settled: this.adapterFaceSettled
			}),
			patchFace: () => ({
				mount: this.patchMountState,
				marker: readPatchMarker(),
				hostFaces: this.patchHostLoaded ? this.patchHost === void 0 ? "unreachable" : "reachable" : "loading",
				guardObserve: (sessionId) => this.guardBridge.summary(sessionId)
			}),
			autofoldFace: (session) => {
				const listener = this.autofold;
				if (listener === void 0) return void 0;
				const summarizer = this.config["autofold.summarizer"];
				const state = listener.statusFor(session);
				if (state !== void 0) return {
					summarizer,
					runs: state.runs,
					roundsTotal: state.roundsTotal,
					foldsCommitted: state.foldsCommitted,
					netTokensSaved: state.netTokensSaved,
					deadProbeSticky: state.deadProbeSticky,
					...state.lastRun !== void 0 ? { lastRun: state.lastRun } : {}
				};
				return {
					summarizer,
					runs: 0,
					roundsTotal: 0,
					foldsCommitted: 0,
					netTokensSaved: 0,
					deadProbeSticky: false
				};
			}
		};
		this.snapshotSource = createSnapshotSource({
			runtime: this.runtime,
			resolveSession: (id) => this.resolveWatchedSession(id),
			currentSession: () => this.currentSession(),
			windowFor: (session) => this.windowCache.get(session),
			listSessions: () => {
				const ids = [];
				for (const session of this.liveSessions) {
					const id = session.id;
					if (typeof id === "string") ids.push(id);
				}
				return ids;
			},
			faceHealth: () => this.faceHealth()
		});
		if (!this.config.enabled) {
			this.patchMountState = "idle (plugin disabled by config)";
			zctxDebug("constructor: disabled by config — all faces stay unwired");
			ctx.logger?.info?.("dsh-zcontext: disabled by config — staying passive (official compaction remains the hard floor)");
			return;
		}
		zctxDebug("constructor: enabled — wiring all faces");
		this.wireSessionFeed();
		this.wireToolFace();
		this.wireGuidanceFace();
		this.wireNudgeFace();
		this.wireCommandFace();
		this.wireAdapterFace();
		this.wirePreflightFace();
		this.wireObserveFace();
		this.wireAutoFoldFace();
		this.wirePatchFace();
		zctxDebug("constructor: all wire*Face calls returned");
		try {
			attachUi(ctx, {
				snapshotFor: (sessionId) => this.snapshotFor(sessionId),
				configValues: () => this.config
			});
		} catch (error) {
			zctxDebug(`attachUi: failed (${error instanceof Error ? error.message : String(error)}) — UI surface skipped`);
		}
	}
	/** Read-only process-memory snapshot (thin delegate). Never touches the wire. */
	snapshotFor(sessionId) {
		return this.snapshotSource.snapshotFor(sessionId);
	}
	/**
	* Face-health view (D5): the three-signal tri-state probe over observable
	* wire*Face counters + host capabilities, with a transition-deduping visible
	* sink (stderr). Recomputed on every call — no memoized absence (Z25).
	*/
	faceHealth() {
		const sessionId = this.currentSession()?.id;
		const guardRecords = typeof sessionId === "string" ? this.guardBridge.summary(sessionId)?.total ?? 0 : 0;
		let webServerPresent = false;
		try {
			const c = this.ctx;
			const candidate = c?.get?.("webServer") ?? c?.webServer;
			webServerPresent = candidate !== void 0 && candidate !== null && typeof candidate.register === "function";
		} catch {
			webServerPresent = false;
		}
		return detectFaceActivation(this.ctx, {
			toolFaceRegistered: this.toolFaceRegistered,
			toolFaceBuilt: this.toolFaceBuilt,
			guidanceRegistered: this.guidanceRegistered,
			observeWired: this.observe !== void 0,
			guardBridgePresent: this.guardBridge !== void 0,
			guardRecordsSeen: guardRecords,
			webServerPresent
		}, this.faceSink);
	}
	/** session/event feed: maintain live stores + warm the window cache. @internal */
	wireSessionFeed() {
		const { ctx } = this;
		if (typeof ctx.on !== "function") {
			zctxDebug("wireSessionFeed: SKIP — ctx.on unavailable");
			ctx.logger?.warn?.("dsh-zcontext: ctx.on unavailable — session feed face skipped (stores attach lazily on first use)");
			return;
		}
		zctxDebug("wireSessionFeed: ctx.on available — registering session/created|disposed|event listeners");
		ctx.on("session/created", (session) => {
			this.liveSessions.add(session);
			this.warmWindow(session);
		});
		ctx.on("session/disposed", (session) => {
			this.liveSessions.delete(session);
			const id = session.id;
			if (typeof id === "string") {
				this.observe?.forgetSession(id);
				this.guardBridge.forgetSession(id);
			}
		});
		ctx.on("session/event", (session, event) => {
			if (event === null || typeof event !== "object") return;
			const s = session;
			const store = this.stores.get(s);
			if (store !== void 0) store.onEvent(s, event);
			if (event.type === "assistant/message") this.warmWindow(s);
			if (this.config["patch.guardObserveEvents"] && event.type === "cache/guard-observe") {
				const id = s.id;
				if (typeof id === "string") this.guardBridge.consume(id, event);
			}
		});
	}
	/** The four zctx tools (defineTool-wrapped; S8: no isConcurrencySafe). @internal */
	wireToolFace() {
		const { ctx } = this;
		if (typeof ctx.tools?.register !== "function") {
			zctxDebug(`wireToolFace: SKIP — ctx.tools.register unavailable (tools=${typeof ctx.tools}, register=${typeof ctx.tools?.register})`);
			ctx.logger?.warn?.("dsh-zcontext: tools service unavailable — tool face skipped");
			return;
		}
		const defineTool = resolveDefineTool();
		let built = 0;
		let registered = 0;
		for (const definition of buildZctxTools(defineTool, this.runtime)) {
			built += 1;
			this.toolFaceBuilt += 1;
			try {
				ctx.tools.register(definition);
				registered += 1;
				this.toolFaceRegistered += 1;
				zctxDebug(`wireToolFace: register OK — ${definition.name}`);
			} catch (error) {
				const name = definition.name;
				zctxDebug(`wireToolFace: register REFUSED "${String(name)}" — ${error instanceof Error ? error.message : String(error)}`);
				ctx.logger?.warn?.(`dsh-zcontext: tools.register refused "${String(name)}" (${error instanceof Error ? error.message : String(error)}) — tool face degraded, boot continues`);
			}
		}
		zctxDebug(`wireToolFace: done — built ${built}, registered ${registered}`);
	}
	/** The static byte-stable guidance section (S10: never sets complete). @internal */
	wireGuidanceFace() {
		const { ctx } = this;
		if (typeof ctx.systemPrompt?.section !== "function") {
			zctxDebug(`wireGuidanceFace: SKIP — systemPrompt.section unavailable (systemPrompt=${typeof ctx.systemPrompt}, section=${typeof ctx.systemPrompt?.section})`);
			ctx.logger?.warn?.("dsh-zcontext: systemPrompt.section unavailable — guidance face skipped");
			return;
		}
		try {
			ctx.systemPrompt.section(buildGuidanceSection());
			this.guidanceRegistered = true;
			zctxDebug("wireGuidanceFace: systemPrompt.section OK — guidance registered");
		} catch (error) {
			zctxDebug(`wireGuidanceFace: REFUSED — ${error instanceof Error ? error.message : String(error)}`);
			ctx.logger?.warn?.(`dsh-zcontext: systemPrompt.section refused the guidance face (${error instanceof Error ? error.message : String(error)}) — guidance skipped, boot continues`);
		}
	}
	/** The threshold nudge context with required: true (B2). @internal */
	wireNudgeFace() {
		const { ctx } = this;
		if (typeof ctx.systemPrompt?.context !== "function") {
			zctxDebug(`wireNudgeFace: SKIP — systemPrompt.context unavailable (context=${typeof ctx.systemPrompt?.context})`);
			ctx.logger?.warn?.("dsh-zcontext: systemPrompt.context unavailable — nudge face skipped");
			return;
		}
		try {
			ctx.systemPrompt.context({
				name: NUDGE_CONTEXT_NAME,
				order: 800,
				interpolate: false,
				required: true,
				text: (assembly) => this.nudgeProvider(assembly)
			});
			zctxDebug("wireNudgeFace: systemPrompt.context OK — nudge registered (required: true)");
		} catch (error) {
			zctxDebug(`wireNudgeFace: REFUSED — ${error instanceof Error ? error.message : String(error)}`);
			ctx.logger?.warn?.(`dsh-zcontext: systemPrompt.context refused the nudge face (${error instanceof Error ? error.message : String(error)}) — nudge skipped, boot continues`);
		}
	}
	/** The /zctx command. @internal */
	wireCommandFace() {
		const { ctx } = this;
		if (typeof ctx.commands?.register !== "function") {
			zctxDebug(`wireCommandFace: SKIP — commands.register unavailable (commands=${typeof ctx.commands}, register=${typeof ctx.commands?.register})`);
			ctx.logger?.warn?.("dsh-zcontext: commands service unavailable — command face skipped");
			return;
		}
		try {
			ctx.commands.register(buildZctxCommand(this.runtime));
			zctxDebug("wireCommandFace: commands.register OK — /zctx registered");
		} catch (error) {
			zctxDebug(`wireCommandFace: REFUSED — ${error instanceof Error ? error.message : String(error)}`);
			ctx.logger?.warn?.(`dsh-zcontext: commands.register refused the /zctx command (${error instanceof Error ? error.message : String(error)}) — command face skipped, boot continues`);
		}
	}
	/**
	* The S1 preflight face (v0.2.0 V4, task card products 1-2;
	* RES-adapter-route §11b S1): a SECOND llm/stream waterfall listener that
	* estimates the request's context before the wire and, in enforce mode
	* only, short-circuits a hit with the official CONTEXT_WINDOW_EXCEEDED
	* finish (the official compaction overflow recovery chain owns the retry).
	*
	* Registered BEFORE the observe listener so it composes OUTERMOST (cordis
	* waterfall = outermost-first, vendor/cordis/src/events.ts:221-236): an
	* enforce short-circuit must suppress the entire downstream chain — no
	* adapter dispatch, no wire request, no observation cost. In observe mode
	* it calls next() like any listener and the calibration ledger (product 3)
	* builds.
	*
	* REDLINE R2: enforce is unreachable under the default configuration —
	* preflightMode defaults to 'observe' and only an explicit user setting
	* turns it on (pinned by test). REDLINE R3: the listener's deps carry NO
	* llm runtime — the ctx.llm.stream self-call is structurally unreachable.
	*
	* Same capability-probe discipline as the other faces: 'off' logs info,
	* a missing capability logs warn, and neither ever breaks boot.
	* @internal
	*/
	wirePreflightFace() {
		const { ctx } = this;
		const mode = this.config.preflightMode;
		if (mode === "off") {
			ctx.logger?.info?.("dsh-zcontext: preflight face disabled by config (preflightMode=off)");
			return;
		}
		if (mode !== "observe" && mode !== "enforce") {
			zctxDebug(`wirePreflightFace: illegal preflightMode "${String(mode)}" — running as observe (warn-once)`);
			ctx.logger?.warn?.(`dsh-zcontext: preflightMode "${String(mode)}" is not one of 'off'|'observe'|'enforce' — running as observe (warn-once)`);
		}
		if (typeof ctx.on !== "function") {
			zctxDebug("wirePreflightFace: SKIP — ctx.on unavailable");
			ctx.logger?.warn?.("dsh-zcontext: ctx.on unavailable — preflight face skipped (no bus to register the llm/stream listener on)");
			return;
		}
		if (ctx.llm === void 0) {
			zctxDebug("wirePreflightFace: SKIP — ctx.llm undefined");
			ctx.logger?.warn?.("dsh-zcontext: llm service unavailable — preflight face skipped (estimation rides the llm/stream waterfall)");
			return;
		}
		zctxDebug(`wirePreflightFace: registering llm/stream listener (mode=${mode})`);
		const llm = ctx.llm;
		const fileText = typeof llm.fileRequestText === "function" ? llm.fileRequestText.bind(llm) : void 0;
		const imagePricing = typeof llm.imageRequestPricing === "function" ? llm.imageRequestPricing.bind(llm) : void 0;
		const listener = new PreflightListener({
			mode,
			marginRatio: this.config.preflightMarginRatio,
			resolveSession: (sessionId) => this.resolveWatchedSession(sessionId),
			storeFor: (session) => this.storeFor(session),
			resolveModelInfo: async (provider, model) => llm.resolveModelInfo(provider, model),
			fileRequestText: fileText,
			imageRequestPricing: imagePricing,
			logger: ctx.logger
		});
		this.preflight = listener;
		ctx.on("llm/stream", listener.onStream);
	}
	/**
	* The S2 adapter face (v0.2.0 V5, task card product 1; RES-adapter-route
	* §11b 形态二): builds the zctx adapters over the fail-soft-loaded host
	* faces and registers them with the llm runtime
	* (`ctx.llm.registerAdapter`, F1.1 all-or-nothing; DUPLICATE_ADAPTER on any
	* route collision → the OFFICIAL conflict precedent applies — keep the
	* old route + error log, llm-pi-ai:310-316 — boot unaffected).
	*
	* Face gates, each honest and none boot-breaking (五面降级先例), in gate
	* order:
	*   - no providers declared (absent/empty section) → info, zero routes
	*     (legal keep-alive, F1.4).
	*   - llm runtime without registerAdapter → warn, skipped.
	*   - config violations → the CONSTRUCTION fail-loud error (complete
	*     violation list, providers.ts) lands in a warn log, skipped — the
	*     adapter contract is fail-loud while boot stays fail-soft. This gate
	*     runs BEFORE the reachability gate (R5 V5-4): validation is pure, so
	*     a misconfigured section reports even when the host lib is absent.
	*   - host lib / pi-ai unreachable (faces undefined) → info, skipped —
	*     the card constraint "宿主不可达→adapter 面整体不注册（fail-soft）".
	*
	* The host faces load asynchronously, so the registration completes as a
	* fire-and-forget continuation after the synchronous constructor returns
	* (the warmWindow precedent); every failure inside logs and never throws.
	* @internal
	*/
	wireAdapterFace() {
		const { ctx } = this;
		const declared = this.config.providers ?? [];
		if (declared.length === 0) {
			zctxDebug("wireAdapterFace: SKIP — no providers declared (legal keep-alive)");
			ctx.logger?.info?.("dsh-zcontext: adapter face: no providers declared — zero routes registered (declare zctx providers under the \"providers\" settings section)");
			this.adapterFaceHealth = {
				state: "off (no providers declared)",
				routes: []
			};
			return;
		}
		if (ctx.llm === void 0 || typeof ctx.llm.registerAdapter !== "function") {
			zctxDebug(`wireAdapterFace: SKIP — llm runtime without registerAdapter (llm=${typeof ctx.llm})`);
			ctx.logger?.warn?.("dsh-zcontext: llm runtime without registerAdapter — adapter face skipped");
			this.adapterFaceHealth = {
				state: "skipped (llm runtime without registerAdapter)",
				routes: []
			};
			return;
		}
		const registerAdapter = ctx.llm.registerAdapter.bind(ctx.llm);
		const registerDirectory = typeof ctx.llm.registerConfigurableProviders === "function" ? ctx.llm.registerConfigurableProviders.bind(ctx.llm) : void 0;
		const logger = ctx.logger;
		const settingsNs = SERVICE_NAME;
		this.adapterRegistration = (async () => {
			this.adapterFaceSettled = false;
			try {
				const { protocols, source } = await loadSupportedProtocols();
				if (source === "builtin") logger?.info?.("dsh-zcontext: the official supportedProtocols() union is unreachable — validating families against the builtin protocol list");
				let resolved;
				try {
					resolved = assertZctxProvidersResolvable({ providers: declared }, protocols);
				} catch (error) {
					logger?.warn?.(error instanceof Error ? error.message : String(error));
					this.adapterFaceHealth = {
						state: "skipped (config violations)",
						routes: []
					};
					return;
				}
				const faces = await loadAdapterFaces();
				if (faces === void 0) {
					logger?.info?.("dsh-zcontext: adapter face skipped — @deepseek-ai/dsh-llm or @earendil-works/pi-ai is not reachable from this install (fail-soft; boot unaffected)");
					this.adapterFaceHealth = {
						state: "skipped (host lib unreachable)",
						routes: []
					};
					return;
				}
				const adapter = new (createZctxAdapterClass(faces.host.LlmAdapter))({
					host: faces.host,
					piAi: faces.piAi,
					mapping: faces.mapping,
					providers: resolved,
					logger,
					wireSink: (snapshot) => this.absorbWireSnapshot(snapshot)
				});
				const routes = resolved.map((provider) => provider.route);
				registerAdapter(routes, adapter);
				logger?.info?.(`dsh-zcontext: adapter face registered ${routes.join(", ")} (mapping: ${faces.mapping.source})`);
				this.adapterFaceHealth = {
					state: "registered",
					routes,
					mappingSource: faces.mapping.source
				};
				if (registerDirectory === void 0) {
					logger?.warn?.("dsh-zcontext: llm runtime without registerConfigurableProviders — directory face skipped (adapter registration stands)");
					return;
				}
				try {
					const entries = resolved.map((provider, index) => ({
						provider: provider.route,
						displayName: provider.displayName,
						settingsNs,
						settingsPath: ["providers", String(index)],
						declared: true
					}));
					registerDirectory(entries);
					logger?.info?.(`dsh-zcontext: directory face registered ${entries.length} configurable provider(s) (visibility-only — page editing unavailable per the U1 probe; config authority: profile overlay patch)`);
				} catch (error) {
					logger?.warn?.(`dsh-zcontext: directory registration refused (${error instanceof Error ? error.message : String(error)}); the adapter registration stands`);
				}
			} catch (error) {
				logger?.warn?.(`dsh-zcontext: adapter face registration failed (${error instanceof Error ? error.message : String(error)}); boot continues without it`);
				this.adapterFaceHealth = {
					state: "failed (registration threw)",
					routes: []
				};
			} finally {
				this.adapterFaceSettled = true;
			}
		})();
	}
	/**
	* The P4 patch-bridge face (external app.asar patch receiver, plan §3
	* 补丁连接设计): arms `globalThis.__zctxPatch__.wireOptions` so the ONE-LINE
	* forwarding stub the external patcher inserted into the OFFICIAL PiAiAdapter
	* (patcher/zctx-patch.mjs, inserted before the adapter's explicit
	* `headers:`/`signal:` keys) reaches the same wire ledger the plugin's own
	* adapter uses. Every face is OPTIONAL and none boot-breaking:
	*   - plugin disabled → not armed (the stub evaluates to {} — stock behavior),
	*   - host faces unreachable → wireOptions degrades to {} per request,
	*   - unwatched/unattributable requests → {} (session-bound wire coverage only).
	* The mount needs NO ctx service access (no inject entry; R3 untouched) and
	* the stub's placement guarantees it can never clobber the official
	* headers/signal face.
	* @internal
	*/
	wirePatchFace() {
		try {
			const { mountState } = mountPatchBridge({
				logger: this.ctx.logger,
				resolveWatchedSession: (sessionId) => this.resolveWatchedSession(sessionId),
				sink: (snapshot) => this.absorbWireSnapshot(snapshot),
				hostFace: () => this.patchHost
			});
			this.patchMountState = mountState;
		} catch (error) {
			this.patchMountState = `idle (mount failed: ${error instanceof Error ? error.message : String(error)})`;
			this.ctx.logger?.warn?.(`dsh-zcontext: patch bridge mount failed (${error instanceof Error ? error.message : String(error)}) — the patched stub stays zero-op`);
			return;
		}
		loadAdapterFaces().then((faces) => {
			this.patchHost = faces?.host;
			this.patchHostLoaded = true;
			if (faces === void 0) this.ctx.logger?.info?.("dsh-zcontext: patch bridge armed — host llm face unreachable, wire records carry hashes without attribution headers");
		}).catch((error) => {
			this.patchHost = void 0;
			this.patchHostLoaded = true;
			this.ctx.logger?.warn?.(`dsh-zcontext: patch bridge host-face load failed (${error instanceof Error ? error.message : String(error)}) — wire records carry hashes without attribution headers`);
		});
		this.ctx.logger?.info?.(`dsh-zcontext: patch bridge armed (globalThis.__zctxPatch__.wireOptions) — waits for the external app.asar patch; without the patch this mount is inert`);
	}
	/**
	* The llm/stream observe face (v0.2.0 V2): a strictly read-only waterfall
	* listener whose per-attempt request snapshots + prefix-break records land
	* in the per-session store's process-memory ledgers (the store's
	* absorbRequestSnapshot / absorbCapturedAttemptUsage receive ports).
	*
	* Same capability-probe discipline as the five faces above: a deliberate
	* config switch logs info, a missing capability logs warn, and neither
	* ever breaks boot. The face needs BOTH the event bus (the registration
	* surface — official hosts register via `ctx.on('llm/stream', …)`, see the
	* llm Events declaration at llm/src/index.ts:76-78) AND the llm runtime
	* (the waterfall owner: without it no `llm/stream` event ever fires).
	* @internal
	*/
	wireObserveFace() {
		const { ctx } = this;
		if (!this.config["observe.enabled"]) {
			zctxDebug("wireObserveFace: SKIP — disabled by config (observe.enabled=false)");
			ctx.logger?.info?.("dsh-zcontext: observe face disabled by config (observe.enabled=false)");
			return;
		}
		if (typeof ctx.on !== "function") {
			zctxDebug("wireObserveFace: SKIP — ctx.on unavailable");
			ctx.logger?.warn?.("dsh-zcontext: ctx.on unavailable — observe face skipped (no bus to register the llm/stream listener on)");
			return;
		}
		if (ctx.llm === void 0) {
			zctxDebug("wireObserveFace: SKIP — ctx.llm undefined");
			ctx.logger?.warn?.("dsh-zcontext: llm service unavailable — observe face skipped (cache observation rides the llm/stream waterfall)");
			return;
		}
		zctxDebug("wireObserveFace: registering llm/stream listener");
		const llm = ctx.llm;
		const listener = new ObserveListener({
			resolveSession: (sessionId) => this.resolveWatchedSession(sessionId),
			storeFor: (session) => this.storeFor(session),
			resolveModelInfo: async (provider, model) => llm.resolveModelInfo(provider, model),
			logger: ctx.logger,
			attemptCapture: this.config["observe.attemptCapture"]
		});
		this.observe = listener;
		ctx.on("llm/stream", listener.onStream);
	}
	/**
	* The observe listener's watched-session resolution (criterion 3): a
	* session ID maps to its live session object when the plugin saw the
	* session through the feed (official Session carries `id: SessionId`,
	* core/session/src/index.ts:420, and the agent loop fills
	* GenerateOptions.sessionId from it — agent-loop/src/agent.ts:718).
	* Unseen/disposed IDs resolve undefined → not watched.
	* @internal
	*/
	resolveWatchedSession(sessionId) {
		for (const session of this.liveSessions) {
			const id = session.id;
			if (typeof id === "string" && id === sessionId) return session;
		}
	}
	/**
	* The P6-E autoFold face (v0.3, task card product 1; RES-bc §9.1 MUST 5):
	* the third llm/stream waterfall listener — server-initiated folding on a
	* V4 trigger hit. Gates, each honest and none boot-breaking:
	*   - autofold.enabled=false (DEFAULT) → info, nothing registered (v0.3
	*     explicit opt-in, card: 校准后转默认).
	*   - ctx.on / llm runtime / llm.stream unavailable → warn, skipped (the
	*     compaction supply needs the official one-shot stream channel).
	*   - autofold.summarizer illegal → warn LOUD, skipped — never silently
	*     mapped to another supply (bc R9: invalid settings fail loudly).
	*   - summarizer='external' with an empty url/model → warn LOUD, skipped
	*     (same fail-loud discipline; the user asked for THAT supply).
	*   - preflightMode='enforce' → the preflight listener is OUTERMOST and
	*     short-circuits before this face runs; warn the precedence fact.
	*
	* 防反馈环 (bc F2.20 + compress.ts:927-929 同型): after a fold-committing
	* run the onFoldCommitted hook clears the nudge baseline (lastPressure)
	* for the session, re-basing the threshold state machine on the post-fold
	* reality. The summary calls themselves are purpose-marked and exempt from
	* every listener + the session log (autofold.ts R3 variant ruling).
	* @internal
	*/
	wireAutoFoldFace() {
		const { ctx } = this;
		if (!this.config["autofold.enabled"]) {
			zctxDebug("wireAutoFoldFace: SKIP — disabled by config (autofold.enabled=false)");
			ctx.logger?.info?.("dsh-zcontext: autofold face disabled by config (autofold.enabled=false; explicit opt-in only)");
			return;
		}
		const kind = parseSummarizerKind(this.config["autofold.summarizer"]);
		if (kind === void 0) {
			zctxDebug(`wireAutoFoldFace: illegal summarizer "${String(this.config["autofold.summarizer"])}" — face skipped (fail-loud)`);
			ctx.logger?.warn?.(`dsh-zcontext: autofold.summarizer "${String(this.config["autofold.summarizer"])}" is not one of 'compaction'|'external'|'digest' — autofold face skipped (fail-loud: no silent supply fallback)`);
			return;
		}
		const chainConfig = {
			maxRounds: resolveBudgetField(this.config["autofold.maxRounds"], configDefaults["autofold.maxRounds"]),
			maxBatch: resolveBudgetField(this.config["autofold.maxBatch"], configDefaults["autofold.maxBatch"]),
			maxSummaryOutputTokens: resolveBudgetField(this.config["autofold.maxSummaryOutputTokens"], configDefaults["autofold.maxSummaryOutputTokens"]),
			summarizer: kind
		};
		if (typeof ctx.on !== "function") {
			zctxDebug("wireAutoFoldFace: SKIP — ctx.on unavailable");
			ctx.logger?.warn?.("dsh-zcontext: ctx.on unavailable — autofold face skipped (no bus to register the llm/stream listener on)");
			return;
		}
		if (ctx.llm === void 0) {
			zctxDebug("wireAutoFoldFace: SKIP — ctx.llm undefined");
			ctx.logger?.warn?.("dsh-zcontext: llm service unavailable — autofold face skipped (the summary supply rides the llm runtime)");
			return;
		}
		const llm = ctx.llm;
		let supply;
		if (kind === "compaction") {
			if (typeof llm.stream !== "function") {
				zctxDebug("wireAutoFoldFace: SKIP — llm runtime without stream (compaction supply unconstructible)");
				ctx.logger?.warn?.("dsh-zcontext: llm runtime without ctx.llm.stream — autofold face skipped (the compaction summary supply needs the official one-shot stream channel)");
				return;
			}
			const stream = llm.stream.bind(llm);
			supply = createCompactionSupply({ stream: (options) => stream(options) }, chainConfig.maxSummaryOutputTokens);
		} else if (kind === "external") {
			const url = this.config["autofold.external.url"];
			const model = this.config["autofold.external.model"];
			if (url === "" || model === "") {
				zctxDebug("wireAutoFoldFace: SKIP — summarizer=external with empty url/model (fail-loud)");
				ctx.logger?.warn?.("dsh-zcontext: autofold.summarizer=external requires autofold.external.url and autofold.external.model — autofold face skipped (fail-loud: no silent supply fallback)");
				return;
			}
			const apiKeyEnv = this.config["autofold.external.apiKeyEnv"];
			if (apiKeyEnv.length > 0 && (process.env[apiKeyEnv] ?? "") === "") {
				zctxDebug(`wireAutoFoldFace: external apiKeyEnv "${apiKeyEnv}" configured but the environment variable is missing/empty — summary requests will go out WITHOUT credentials`);
				ctx.logger?.warn?.(`dsh-zcontext: autofold.external.apiKeyEnv "${apiKeyEnv}" is configured but the environment variable is missing/empty — external summary requests go out WITHOUT credentials (the remote 401 would be the only signal); the face stays enabled because missing credentials feed the degradation chain, they are not a supply misconfiguration`);
			}
			supply = createExternalSupply({
				url,
				model,
				apiKeyEnv,
				maxTokens: chainConfig.maxSummaryOutputTokens
			});
		}
		if (this.config.preflightMode === "enforce") {
			zctxDebug("wireAutoFoldFace: enforce precedence — the outermost preflight listener short-circuits before this face runs");
			ctx.logger?.warn?.("dsh-zcontext: preflightMode=enforce short-circuits hits BEFORE the autofold face (outermost listener) — autofold will not fire on enforce short-circuits; prefer preflightMode=observe with autofold.enabled");
		}
		zctxDebug(`wireAutoFoldFace: registering llm/stream listener (summarizer=${kind})`);
		const listener = new AutoFoldListener({
			summarizer: kind,
			marginRatio: this.config.preflightMarginRatio,
			chain: chainConfig,
			...supply !== void 0 ? { supply } : {},
			resolveSession: (sessionId) => this.resolveWatchedSession(sessionId),
			storeFor: (session) => this.storeFor(session),
			validatorConfig: (session) => this.validatorConfig(session),
			resolveModelInfo: async (provider, model) => llm.resolveModelInfo(provider, model),
			...typeof llm.fileRequestText === "function" ? { fileRequestText: (ref) => llm.fileRequestText?.(ref) } : {},
			...typeof llm.imageRequestPricing === "function" ? { imageRequestPricing: (provider, model) => llm.imageRequestPricing?.(provider, model) } : {},
			onFoldCommitted: (session) => {
				this.lastPressure.delete(session);
				zctxDebug("autoFold committed folds — nudge baseline cleared (bc compress.ts:927-929 同型)");
			},
			logger: ctx.logger
		});
		this.autofold = listener;
		ctx.on("llm/stream", listener.onStream);
		ctx.logger?.info?.(`dsh-zcontext: autofold face armed (summarizer=${kind}, maxRounds=${chainConfig.maxRounds}, maxBatch=${chainConfig.maxBatch}, output cap ${chainConfig.maxSummaryOutputTokens}) — the server folds on a V4 trigger hit without waiting for a model tool call`);
	}
	/**
	* The single wire-ledger receive port for BOTH wire producers (the S2
	* adapter's wireSink and the P4 patch bridge): session-bound records land
	* in the per-session store; unwatched sessions are dropped (the wire
	* domain covers session-bound requests only — the adapter/wire.ts rule).
	* @internal
	*/
	absorbWireSnapshot(snapshot) {
		const session = this.resolveWatchedSession(snapshot.sessionId);
		if (session === void 0) return;
		this.storeFor(session).absorbWireSnapshot(snapshot);
	}
	/** Per-session store registry: lazy create + attach (resume-restore scan). @internal */
	storeFor(session) {
		let store = this.stores.get(session);
		if (store === void 0) {
			store = new FoldStore();
			store.attach(session);
			store.setAttributionTimeWindowMs(this.config.attributionTimeWindowMs);
			store.setMeterAnchor(this.meterAnchorFor(session));
			store.setLedgerSink(this.ledgerSink);
			this.stores.set(session, store);
		}
		return store;
	}
	/**
	* The V3 meter-anchor interface over the official tokenMeter (§Q7.2 rule
	* 2b): for the request that produced the message at `seq`, the input-side
	* anchor is the summed route-priced tokens of the surface nodes positioned
	* BEFORE the message's own node (official TokenMeasurement.nodes,
	* token-meter/src/types.ts:31-56). Unavailable faces (no meter, no node
	* projection, node not on the current surface, non-positive sum, meter
	* fault) report undefined so the record stays honestly 'estimated'.
	* @internal
	*/
	meterAnchorFor(session) {
		const meter = this.runtime.tokenMeter;
		if (meter === void 0 || typeof meter.measure !== "function") return void 0;
		return { inputAnchor: (seq) => {
			try {
				const nodes = meter.measure(session).nodes;
				if (nodes === void 0) return void 0;
				const index = nodes.findIndex((node) => node.seq === seq);
				if (index <= 0) return void 0;
				let sum = 0;
				for (let i = 0; i < index; i += 1) sum += nodes[i]?.tokens ?? 0;
				return Number.isFinite(sum) && sum > 0 ? sum : void 0;
			} catch {
				return;
			}
		} };
	}
	/** Validator config for one session (context window from the cache when known). @internal */
	validatorConfig(session) {
		const window = this.windowCache.get(session);
		const config = this.config;
		const clampNonNegative = (value) => Number.isFinite(value) && value >= 0 ? value : 0;
		const maxFoldFraction = Number.isFinite(config.maxFoldFraction) && config.maxFoldFraction > 0 ? Math.min(config.maxFoldFraction, 1) : configDefaults.maxFoldFraction;
		const summaryFloorChars = clampNonNegative(config.summaryFloorChars);
		const summaryCeilingChars = clampNonNegative(config.summaryCeilingChars);
		const [floor, ceiling] = summaryFloorChars <= summaryCeilingChars ? [summaryFloorChars, summaryCeilingChars] : [summaryCeilingChars, summaryFloorChars];
		return {
			keepRecentMessages: 0,
			keepRecentTokens: clampNonNegative(config.keepRecentTokens),
			protectionFloorTokens: clampNonNegative(config.protectionFloorTokens),
			minFoldableTokens: clampNonNegative(config.minFoldableTokens),
			maxFoldFraction,
			summaryFloorChars: floor,
			summaryCeilingChars: ceiling,
			netShrinkTolerance: Number.isFinite(config.netShrinkTolerance) && config.netShrinkTolerance >= 1 ? config.netShrinkTolerance : 1,
			...window !== void 0 ? { contextWindow: window } : {}
		};
	}
	/**
	* Resolve and cache the routed model's context window (fire-and-forget;
	* failures degrade honestly — one warn per plugin, never per request).
	*/
	async warmWindow(session) {
		if (this.windowCache.has(session)) return;
		const llm = this.runtime.llm;
		if (llm === void 0 || typeof llm.resolveModelInfo !== "function") return;
		const routed = routedRequestTarget(session);
		if (routed === void 0) return;
		try {
			const window = (await llm.resolveModelInfo(routed.provider, routed.model))?.context?.contextWindow;
			if (typeof window === "number" && Number.isFinite(window) && window > 0) this.windowCache.set(session, window);
		} catch (error) {
			if (!this.warnedWindowFailure) {
				this.warnedWindowFailure = true;
				this.ctx.logger?.warn?.(`dsh-zcontext: model info resolution failed (${error instanceof Error ? error.message : String(error)}); nudge/status stay degraded until it succeeds`);
			}
		}
	}
	/** The most recently created live session. @internal */
	currentSession() {
		let last;
		for (const session of this.liveSessions) last = session;
		return last;
	}
	/**
	* The nudge context provider: '' unless a threshold was crossed since the
	* last evaluation (pure function of its inputs; suppressed = no-op on the
	* wire, B2). Below the CCM legal domain the automatic face stays off.
	*
	* Session attribution (W4-4): when the official AssembleContext carries a
	* session (`assembleContextFor` passes the Agent as both `agent` and
	* `scope`, and `Agent.session` is the session — agent-loop/src/agent.ts:127),
	* the evaluation is attributed to THAT session, so multi-session hosts get
	* per-session pressure instead of cross-assembly contamination. The
	* globally-most-recent-session fallback remains for hosts that invoke the
	* provider without a reachable context — a documented limitation there, not
	* a correctness claim.
	*/
	nudgeProvider(assembly) {
		try {
			const fromAgent = assembly?.agent?.session;
			const fromScope = assembly?.scope?.session;
			const session = (fromAgent !== null && typeof fromAgent === "object" ? fromAgent : fromScope !== null && typeof fromScope === "object" ? fromScope : void 0) ?? this.currentSession();
			if (session === void 0) {
				zctxDebug("nudgeProvider: no attributable session — contributing nothing");
				return "";
			}
			const window = this.windowCache.get(session);
			if (window === void 0 || window < 32768) {
				zctxDebug(`nudgeProvider: window=${window} (CCM_MIN=${CCM_MIN_CONTEXT_WINDOW}) — contributing nothing`);
				return "";
			}
			const meter = this.runtime.tokenMeter;
			if (meter === void 0) {
				zctxDebug("nudgeProvider: tokenMeter unavailable — contributing nothing");
				return "";
			}
			const pressurePct = meter.measure(session).totalTokens / window * 100;
			const prev = this.lastPressure.get(session) ?? 0;
			this.lastPressure.set(session, pressurePct);
			const configuredMax = (session.requestHeader?.())?.config?.maxTokens;
			const budget = computeBudget({
				contextWindow: window,
				...typeof configuredMax === "number" && configuredMax > 0 ? { maxOutput: configuredMax } : {}
			});
			const ranges = foldableRanges(this.storeFor(session).surfaceNodes(), this.validatorConfig(session));
			const contribution = nudgeContextText(prev, pressurePct, parseThresholds(this.config.nudgeThresholds), budget, ranges);
			zctxDebug(`nudgeProvider: window=${window} pressure=${pressurePct.toFixed(1)}% prev=${prev.toFixed(1)}% contribution=${contribution.length} chars`);
			return contribution;
		} catch (error) {
			zctxDebug(`nudgeProvider: evaluation threw — ${error instanceof Error ? error.message : String(error)}`);
			this.ctx.logger?.warn?.(`dsh-zcontext: nudge evaluation failed (${error instanceof Error ? error.message : String(error)}); contributing nothing this assembly`);
			return "";
		}
	}
};
// src/index.ts
/**
* dsh-zcontext — model-driven incremental context folding for the DeepSeek
* Harness (official surface replace channel).
*
* Public surface: the frozen identity exports (name / plugin class / Config
* schema), the W2 pure cores, the W3 engine, and the W4 wiring (tools /
* plugin / command). Host-face types are structural (duck-typed): neither
* `@deepseek-ai/cordis` nor `@deepseek-ai/schemastery` is imported
* statically — both resolve lazily with fail-soft fallbacks, so this module
* always loads.
*
* @module dsh-zcontext
*/
/** Plugin identity exported for loader probes. */
const name = "dsh-zcontext";
export { CCM_MIN_CONTEXT_WINDOW, FoldStore, KNOWN_PROTOCOLS, NUDGE_CONTEXT_NAME, NUDGE_CONTEXT_ORDER, PER_IMAGE_FALLBACK_TOKENS, PREFLIGHT_CONTEXT_WINDOW_EXCEEDED_CODE, PreflightListener, UI_PAGE_HTML, UI_TOKEN_PLACEHOLDER, ZcontextPlugin, ZcontextPlugin as default, assertZctxProvidersResolvable, attachUi, billedInputTokens, buildGuidanceSection, buildObservabilitySnapshot, buildPreflightErrorFinish, buildWireFaces, buildZctxCommand, buildZctxTools, ccmWindowGate, classifyFoldAttribution, cleanSampleRatio, computeBreakevenReport, computeBudget, configDefaults, configSchema, createSnapshotSource, createTokenSource, createTransitionSink, createZctxAdapterClass, crossedThresholds, detectFaceActivation, estimateProjectedRequest, estimateTokens, fold, foldableRanges, judgeEstimate, loadAdapterFaces, loadSupportedProtocols, materializeRange, name, nudgeContextText, parseFoldContent, parseThresholds, recall, registerUiRoutes, renderFoldReply, renderNudge, renderStatus, renderUnfoldReply, requestHeaders, resolveDefineTool, resolveMarginRatio, resolveZctxProviders, unfold, unknownFaceHealth, validateFold, zctxDisplayNameOf, zctxRouteOf };

//# sourceMappingURL=index.js.map