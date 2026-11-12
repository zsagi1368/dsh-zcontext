import { createRequire } from "node:module";
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
const REASON_RANGE_NOT_ON_SURFACE = "fold window [{{start}}, {{end}}] is not anchored on the surface: endpoints must be existing surface nodes";
const REASON_RANGE_INVERTED = "fold window [{{start}}, {{end}}] is inverted: startSeq must not exceed endSeq";
const REASON_RANGE_DISCONTIGUOUS = "fold window [{{start}}, {{end}}] is not contiguous on the surface";
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
const REASON_UNFOLD_REJECTED = "the session rejected the unfold commit for fold {{foldId}}: {{detail}}";
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
estimateFixedWireOverhead([GUIDANCE_SECTION_TEXT]) + 2048;
Object.freeze({
	w: 1,
	r: .1,
	q: 4
});
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
const MESSAGE_EVENT_TYPES$1 = /* @__PURE__ */ new Set([
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
function extractMessage$1(data) {
	if (data === null || typeof data !== "object") return void 0;
	const record = data;
	if (record.message !== null && typeof record.message === "object") return record.message;
	if (record.content !== void 0) return record;
}
/** Join the text blocks of a message payload (string content tolerated). */
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
/** Provider-issued tool-call ids embedded in an assistant message. */
function extractToolCallIds(data) {
	const message = extractMessage$1(data);
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
	const message = extractMessage$1(data);
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
	const message = extractMessage$1(data);
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
	const source = extractMessage$1(data)?.source;
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
			summaryText: extractMessageText$1(event.data),
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
			if (event === void 0 || !MESSAGE_EVENT_TYPES$1.has(event.type)) continue;
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
		const text = extractMessageText$1(event.data);
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
const MESSAGE_EVENT_TYPES = /* @__PURE__ */ new Set([
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
			const body = extractMessageText(event.data);
			const marker = `${MATERIALIZED_FOLDED_BLOCK_PREFIX}${checkpoint.foldId}]`;
			blocks.push({
				type: "text",
				text: body === "" ? marker : `${marker}\n${body}`
			});
			continue;
		}
		if (!MESSAGE_EVENT_TYPES.has(event.type)) continue;
		blocks.push(renderMessageBlock(event));
	}
	return blocks;
}
/** Assert one non-negative integer seq. @internal */
function assertSeq(value, name) {
	if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) throw new TypeError(`materializeRange: ${name} must be a non-negative integer, got ${String(value)}`);
}
/** Pull the message object out of an event's data payload. @internal */
function extractMessage(data) {
	if (data === null || typeof data !== "object") return void 0;
	const record = data;
	if (record.message !== null && typeof record.message === "object") return record.message;
	if (record.content !== void 0) return record;
}
/** Join the text blocks of a message payload (string content tolerated). @internal */
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
/** Best-effort tool identity for a tool/result event. @internal */
function extractToolIdentity(event) {
	const message = extractMessage(event.data);
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
	const body = extractMessageText(event.data);
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
*      the official assertSystemHeadRewrite throws, surface.ts:493-505);
*   b. protected zones: recent tail (last keepRecentMessages messages and
*      the last max(keepRecentTokens, protectionFloorTokens) estimated
*      tokens), the last user message, and the permanently pinned first
*      user message (official kernel recommend.ts Rules 1–3 + DESIGN §8.1);
*   c. tool-pair closure: an assistant tool call and its tool result must be
*      folded together or left together (official kernel #2886 closure);
*      unknown pairing fails closed;
*   d. nested absorption: a window containing an active fold's checkpoint is
*      allowed when a submitted summary covers the checkpoint or the window
*      boundary aligns with it;
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
* as an anomaly and reported, never thrown (fail-soft contract).
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
			const event = sessionLike.append("user/message", { message: {
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
			} }, {
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
			checkpointSeq: sessionLike.append("user/message", { message: {
				role: "user",
				content: blocks,
				source: {
					kind: "zctx-unfold",
					foldId,
					tokensBefore,
					tokensAfter
				}
			} }, {
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
// src/index.ts
/**
* dsh-zcontext — model-driven incremental context folding for the DeepSeek
* Harness (official surface replace channel).
*
* Public surface: the frozen identity exports (name / plugin class / Config
* schema), the W2 pure cores, and the W3 engine (FoldStore + fold/unfold
* orchestrator). W4 completes the wiring (tools / plugin / command).
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
export { CCM_MIN_CONTEXT_WINDOW, FoldStore, ZcontextPlugin, ZcontextPlugin as default, ccmWindowGate, configDefaults, configSchema, fold, foldableRanges, name, renderFoldReply, renderUnfoldReply, unfold };

//# sourceMappingURL=index.js.map