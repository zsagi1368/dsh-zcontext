import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
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
const STATUS_NO_SESSION = "zctx: no live session is reachable from this call site";
const STATUS_PARTIAL_PREFIX = "status rendered in degraded mode:";
const STATUS_DEGRADED_ROW = "  - {{detail}}";
const RECALL_REPLY_HEADER = "Recall hits for \"{{query}}\" ({{count}} of {{total}}):";
const RECALL_REPLY_ROW = "  - [{{kind}}] fold {{foldId}} (seqs {{start}}–{{end}}, score {{score}}): {{excerpt}}";
const RECALL_REPLY_EMPTY = "No recall hits for \"{{query}}\".";
const FOLD_PARSE_EMPTY = "parsed 0 valid fold ranges from content; expected blocks like \"fold <startSeq>..<endSeq>\" followed by a summary line, or a JSON array of {startRef, endRef, summary}";
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
	if (config.contextWindow !== void 0 && inRange.length > 0 && foldedTokens > config.maxFoldFraction * config.contextWindow) reasons.push(fill(REASON_WINDOW_TOO_LARGE, {
		start: startSeq,
		end: endSeq,
		tokens: foldedTokens,
		maxPct: fmtNum(config.maxFoldFraction * 100)
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
*
* Zero host imports; the session is consumed through the structural
* SessionLike contract only.
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
/** Extract the frozen checkpoint payload of a zctx fold/unfold event. */
function extractCheckpointSource(data) {
	const kind = extractSourceKind(data);
	if (kind !== "zctx-fold" && kind !== "zctx-unfold") return void 0;
	const source = extractMessage(data)?.source;
	if (source === null || typeof source !== "object") return void 0;
	const record = source;
	const foldId = record.foldId;
	if (typeof foldId !== "string") return void 0;
	const tokensBefore = typeof record.tokensBefore === "number" ? record.tokensBefore : void 0;
	const tokensAfter = typeof record.tokensAfter === "number" ? record.tokensAfter : void 0;
	return {
		kind,
		foldId,
		...tokensBefore !== void 0 ? { tokensBefore } : {},
		...tokensAfter !== void 0 ? { tokensAfter } : {}
	};
}
/**
* Extract one usage sample from an assistant/message payload (S6). The
* official event data carries `usage?: TokenUsage` with optional
* cacheReadTokens/cacheWriteTokens (llm/src/types.ts:166-189).
*/
function extractUsageSample(data, seq) {
	if (data !== null && typeof data === "object") {
		const usage = data.usage;
		if (usage !== null && typeof usage === "object") {
			const record = usage;
			const read = record.cacheReadTokens;
			const write = record.cacheWriteTokens;
			return {
				seq,
				measured: true,
				...typeof read === "number" && Number.isFinite(read) ? { cacheReadTokens: read } : {},
				...typeof write === "number" && Number.isFinite(write) ? { cacheWriteTokens: write } : {}
			};
		}
	}
	return {
		seq,
		measured: false
	};
}
/**
* Session-log-derived state for ONE session: fold ledger, usage ledger,
* retained events, surface view, and compaction mutex state.
*
* Lifecycle: `attach(session)` scans once and binds; afterwards the host feed
* delivers events via `onEvent(session, event)`; `resync()` repairs feed gaps.
* Events of a different session are ignored (the store is single-session).
*/
var FoldStore = class {
	session;
	eventsBySeq = /* @__PURE__ */ new Map();
	ledger = /* @__PURE__ */ new Map();
	usageSamples = [];
	measuredSamples = 0;
	unmeasuredSamples = 0;
	anomaliesLog = [];
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
		this.eventsBySeq.clear();
		this.ledger.clear();
		this.usageSamples.length = 0;
		this.measuredSamples = 0;
		this.unmeasuredSamples = 0;
		this.anomaliesLog.length = 0;
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
		const latest = this.usageSamples[this.usageSamples.length - 1];
		return {
			samples: this.usageSamples.length,
			measuredSamples: this.measuredSamples,
			unmeasuredSamples: this.unmeasuredSamples,
			measured: this.measuredSamples > 0,
			...latest !== void 0 ? { latest } : {}
		};
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
	/** The anomaly ledger, oldest first. */
	anomalies() {
		return [...this.anomaliesLog];
	}
	/** Replay retained events up to `end` (exclusive) through seq reads. @internal */
	scanUpTo(end) {
		for (let seq = this.syncedToSeq; seq < end; seq += 1) {
			const event = this.session?.eventAt?.(seq);
			if (event === void 0) {
				this.recordAnomaly("unreadable-event", `seq ${seq} not readable during scan`, seq);
				this.lastSeq = seq;
				continue;
			}
			this.applyEvent(event);
		}
	}
	/**
	* Apply one event to every derived view (scan and incremental paths share
	* this single transition, so attach and live feeds stay consistent).
	* @internal
	*/
	applyEvent(event) {
		this.eventsBySeq.set(event.seq, event);
		this.lastSeq = event.seq;
		if (event.type === "assistant/message") {
			const sample = extractUsageSample(event.data, event.seq);
			if (this.usageSamples.length >= USAGE_LEDGER_CAP) this.usageSamples.shift();
			this.usageSamples.push(sample);
			if (sample.measured) this.measuredSamples += 1;
			else this.unmeasuredSamples += 1;
		}
		if (event.type === "compaction/start") this.compactionStartSeq = event.seq;
		else if (event.type === "compaction/end") this.compactionStartSeq = void 0;
		else if (event.type === "session/end-seed") this.endSeedSeq = event.seq;
		const op = event.surfaceOp;
		if (op === void 0 || op === "append") return;
		const checkpoint = extractCheckpointSource(event.data);
		if (checkpoint === void 0) {
			this.shadowActiveCheckpoints(event, "dead");
			return;
		}
		if (checkpoint.kind === "zctx-unfold") {
			const entry = this.ledger.get(checkpoint.foldId);
			if (entry !== void 0 && entry.status === "active") this.ledger.set(checkpoint.foldId, {
				...entry,
				status: "unfolded"
			});
			return;
		}
		this.shadowActiveCheckpoints(event, "absorbed");
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
		return typeof mod?.defineTool === "function" ? mod.defineTool : void 0;
	} catch {
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
				if (session === void 0) return STATUS_NO_SESSION;
				const parsed = parseFoldContent(args.content);
				if (!parsed.ok) return parsed.reason;
				return renderFoldReply(fold(session, runtime.storeFor(session), parsed, runtime.validatorConfig(session)));
			}
		}),
		defineTool({
			name: "zctx_unfold",
			description: "Re-materialize one folded range back onto the surface in place of its checkpoint. Without arguments, the most recent active fold is unfolded. Use when the folded content is needed again in full.",
			parameters: {
				foldId: {
					type: "string",
					description: "Fold id to unfold (from zctx_status); omit to unfold the latest active fold."
				},
				latest: {
					type: "boolean",
					description: "Unfold the most recent active fold."
				}
			},
			output: textOutput,
			async execute(args, exec) {
				const session = exec?.agent?.session;
				if (session === void 0) return STATUS_NO_SESSION;
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
				if (session === void 0) return STATUS_NO_SESSION;
				const store = runtime.storeFor(session);
				if (typeof args.query !== "string") return "invalid arguments: query: expected string";
				const limit = typeof args.limit === "number" && Number.isFinite(args.limit) && args.limit >= 0 ? Math.floor(args.limit) : 5;
				const corpus = buildRecallCorpus(store);
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
			}
		}),
		defineTool({
			name: "zctx_status",
			description: "The trusted ledger for context pressure and folding: window occupancy vs the fold trigger line, budget breakdown, foldable ranges (PROTECTED marks), active folds, anomalies, and cache usage (measured or estimated). Never reconstruct these numbers from memory.",
			parameters: {},
			output: textOutput,
			async execute(_args, exec) {
				const session = exec?.agent?.session;
				if (session === void 0) return STATUS_NO_SESSION;
				return renderStatus(runtime, session);
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
	const session = invocation.agent?.session;
	if (session === void 0) return {
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
*
* The nudge context provider is a PURE function of (pressure, budget,
* ranges): it contributes '' (nothing on the wire) unless a threshold was
* crossed since the last evaluation — the 跨越计次重付 cache model. The
* context window is resolved asynchronously from the routed model info and
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
		return typeof mod?.Service === "function" ? mod.Service : void 0;
	} catch {
		return;
	}
}
/** The Service base this plugin extends: the host's real one when resolvable. */
const ServiceBase = loadCordisService() ?? StructuralServiceShim;
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
	static inject = [];
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
	warnedWindowFailure = false;
	constructor(ctx, config = {}) {
		super(ctx, SERVICE_NAME);
		this.ctx = ctx;
		this.config = Object.freeze({
			...configDefaults,
			...config
		});
		this.runtime = {
			logger: ctx.logger,
			tokenMeter: ctx.tokenMeter,
			llm: ctx.llm,
			storeFor: (session) => this.storeFor(session),
			validatorConfig: (session) => this.validatorConfig(session)
		};
		if (!this.config.enabled) {
			ctx.logger?.info?.("dsh-zcontext: disabled by config — staying passive (official compaction remains the hard floor)");
			return;
		}
		this.wireSessionFeed();
		this.wireToolFace();
		this.wireGuidanceFace();
		this.wireNudgeFace();
		this.wireCommandFace();
	}
	/** session/event feed: maintain live stores + warm the window cache. @internal */
	wireSessionFeed() {
		const { ctx } = this;
		if (typeof ctx.on !== "function") {
			ctx.logger?.warn?.("dsh-zcontext: ctx.on unavailable — session feed face skipped (stores attach lazily on first use)");
			return;
		}
		ctx.on("session/created", (session) => {
			this.liveSessions.add(session);
			this.warmWindow(session);
		});
		ctx.on("session/disposed", (session) => {
			this.liveSessions.delete(session);
		});
		ctx.on("session/event", (session, event) => {
			const s = session;
			const store = this.stores.get(s);
			if (store !== void 0) store.onEvent(s, event);
			if (event.type === "assistant/message") this.warmWindow(s);
		});
	}
	/** The four zctx tools (defineTool-wrapped; S8: no isConcurrencySafe). @internal */
	wireToolFace() {
		const { ctx } = this;
		if (typeof ctx.tools?.register !== "function") {
			ctx.logger?.warn?.("dsh-zcontext: tools service unavailable — tool face skipped");
			return;
		}
		const defineTool = resolveDefineTool();
		for (const definition of buildZctxTools(defineTool, this.runtime)) ctx.tools.register(definition);
	}
	/** The static byte-stable guidance section (S10: never sets complete). @internal */
	wireGuidanceFace() {
		const { ctx } = this;
		if (typeof ctx.systemPrompt?.section !== "function") {
			ctx.logger?.warn?.("dsh-zcontext: systemPrompt.section unavailable — guidance face skipped");
			return;
		}
		ctx.systemPrompt.section(buildGuidanceSection());
	}
	/** The threshold nudge context with required: true (B2). @internal */
	wireNudgeFace() {
		const { ctx } = this;
		if (typeof ctx.systemPrompt?.context !== "function") {
			ctx.logger?.warn?.("dsh-zcontext: systemPrompt.context unavailable — nudge face skipped");
			return;
		}
		ctx.systemPrompt.context({
			name: NUDGE_CONTEXT_NAME,
			order: 800,
			interpolate: false,
			required: true,
			text: () => this.nudgeProvider()
		});
	}
	/** The /zctx command. @internal */
	wireCommandFace() {
		const { ctx } = this;
		if (typeof ctx.commands?.register !== "function") {
			ctx.logger?.warn?.("dsh-zcontext: commands service unavailable — command face skipped");
			return;
		}
		ctx.commands.register(buildZctxCommand(this.runtime));
	}
	/** Per-session store registry: lazy create + attach (resume-restore scan). @internal */
	storeFor(session) {
		let store = this.stores.get(session);
		if (store === void 0) {
			store = new FoldStore();
			store.attach(session);
			this.stores.set(session, store);
		}
		return store;
	}
	/** Validator config for one session (context window from the cache when known). @internal */
	validatorConfig(session) {
		const window = this.windowCache.get(session);
		return {
			keepRecentMessages: 0,
			keepRecentTokens: this.config.keepRecentTokens,
			protectionFloorTokens: this.config.protectionFloorTokens,
			minFoldableTokens: this.config.minFoldableTokens,
			maxFoldFraction: this.config.maxFoldFraction,
			summaryFloorChars: this.config.summaryFloorChars,
			summaryCeilingChars: this.config.summaryCeilingChars,
			netShrinkTolerance: this.config.netShrinkTolerance,
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
	/** The most recently created live session (single-session assumption, honest). @internal */
	currentSession() {
		let last;
		for (const session of this.liveSessions) last = session;
		return last;
	}
	/**
	* The nudge context provider: '' unless a threshold was crossed since the
	* last evaluation (pure function of its inputs; suppressed = no-op on the
	* wire, B2). Below the CCM legal domain the automatic face stays off.
	*/
	nudgeProvider() {
		try {
			const session = this.currentSession();
			if (session === void 0) return "";
			const window = this.windowCache.get(session);
			if (window === void 0 || window < 32768) return "";
			const meter = this.runtime.tokenMeter;
			if (meter === void 0) return "";
			const pressurePct = meter.measure(session).totalTokens / window * 100;
			const prev = this.lastPressure.get(session) ?? 0;
			this.lastPressure.set(session, pressurePct);
			const configuredMax = (session.requestHeader?.())?.config?.maxTokens;
			const budget = computeBudget({
				contextWindow: window,
				...typeof configuredMax === "number" && configuredMax > 0 ? { maxOutput: configuredMax } : {}
			});
			const ranges = foldableRanges(this.storeFor(session).surfaceNodes(), this.validatorConfig(session));
			return nudgeContextText(prev, pressurePct, parseThresholds(this.config.nudgeThresholds), budget, ranges);
		} catch (error) {
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
export { CCM_MIN_CONTEXT_WINDOW, FoldStore, NUDGE_CONTEXT_NAME, NUDGE_CONTEXT_ORDER, ZcontextPlugin, ZcontextPlugin as default, buildGuidanceSection, buildZctxCommand, buildZctxTools, ccmWindowGate, computeBreakevenReport, computeBudget, configDefaults, configSchema, crossedThresholds, estimateTokens, fold, foldableRanges, materializeRange, name, nudgeContextText, parseFoldContent, parseThresholds, recall, renderFoldReply, renderNudge, renderStatus, renderUnfoldReply, resolveDefineTool, unfold, validateFold };

//# sourceMappingURL=index.js.map