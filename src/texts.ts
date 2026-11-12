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

// ---------------------------------------------------------------------------
// Static guidance section (systemPrompt.section; English skeleton, original
// wording; explicit bilingual-preservation rule; PTC mode note per S2).
// ---------------------------------------------------------------------------

/** Stable section id used for the systemPrompt.section registration. */
export const GUIDANCE_SECTION_ID = 'zctx-guidance'

/** Stable section title. */
export const GUIDANCE_SECTION_TITLE = 'Context folding protocol (zctx)'

/** The full static guidance text, byte-stable by contract (S10). */
export const GUIDANCE_SECTION_TEXT = `Older parts of this conversation can be folded to keep the working window
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
  expecting direct registration.`

// ---------------------------------------------------------------------------
// Materialize markers (unfold re-materialization; B1 single-node form).
// ---------------------------------------------------------------------------

/** Role prefixes for re-materialized blocks. */
export const MATERIALIZED_ROLE_PREFIX_USER = '[user]'
export const MATERIALIZED_ROLE_PREFIX_ASSISTANT = '[assistant]'
export const MATERIALIZED_ROLE_PREFIX_SYSTEM = '[system]'
export const MATERIALIZED_ROLE_PREFIX_DEVELOPER = '[developer]'
export const MATERIALIZED_ROLE_PREFIX_UNKNOWN = '[unknown]'

/** Prefix for a re-materialized tool-result block (toolName appended). */
export const MATERIALIZED_TOOL_PREFIX = '[tool'

/** Suffix closing the tool block header. */
export const MATERIALIZED_TOOL_HEADER_SUFFIX = ']'

/** Source annotation appended to re-materialized tool-result blocks. */
export const MATERIALIZED_TOOL_SOURCE_NOTE =
  '(tool result quoted verbatim from the session log)'

/**
 * Marker for a block re-materialized from an active fold checkpoint
 * (one layer only — the checkpoint's own message text, not its originals).
 */
export const MATERIALIZED_FOLDED_BLOCK_PREFIX = '[folded block '

/** Closer of the folded-block marker line. */
export const MATERIALIZED_FOLDED_BLOCK_SUFFIX = ']'

/** Placeholder block for a seq that is no longer readable in the log. */
export const MATERIALIZED_MISSING_EVENT_PREFIX = '[unavailable event at seq '

export const MATERIALIZED_MISSING_EVENT_SUFFIX = ']'

// ---------------------------------------------------------------------------
// Nudge fragments (systemPrompt.context; rendered output must stay a pure
// function of its inputs — all fixed wording lives here).
// ---------------------------------------------------------------------------

/** Header opening for the gentle band. */
export const NUDGE_GENTLE_HEADER = '[context pressure: {{pct}}% — gentle reminder]'

/** Header opening for the emergency band. */
export const NUDGE_EMERGENCY_HEADER = '[context pressure: {{pct}}% — EMERGENCY]'

/** Pressure-vs-trigger framing line ({{triggerPct}} = trigger line percent). */
export const NUDGE_TRIGGER_LINE =
  'Window occupancy is {{pct}}% of the context window; the fold trigger line sits at {{triggerPct}}%.'

/** Budget breakdown intro. */
export const NUDGE_BREAKDOWN_HEADER = 'Budget breakdown (share of the context window):'

/** Budget breakdown row for the protected recent tail. */
export const NUDGE_BREAKDOWN_KEEP_RECENT = '  - recent-tail reserve: {{pct}}%'

/** Budget breakdown row for the output/tool pessimistic reserve. */
export const NUDGE_BREAKDOWN_RESERVE = '  - output and tool reserve: {{pct}}%'

/** Budget breakdown row for the fixed wire overhead. */
export const NUDGE_BREAKDOWN_FIXED = '  - fixed tool+guidance overhead: {{pct}}%'

/** Foldable-span table header. */
export const NUDGE_RANGES_HEADER = 'Foldable spans (estimated tokens):'

/** Table row prefix for an unprotected span. */
export const NUDGE_RANGE_ROW = '  - seq {{start}}..{{end}} (~{{tokens}} tokens)'

/** Marker appended to rows that must never be folded. */
export const NUDGE_PROTECTED_MARKER = ' PROTECTED'

/** Rendered after the PROTECTED marker when a reason is known. */
export const NUDGE_PROTECTED_REASON_PREFIX = ' ('

export const NUDGE_PROTECTED_REASON_SUFFIX = ')'

/** Row used when the caller supplies no spans at all. */
export const NUDGE_RANGES_EMPTY = '  (no foldable spans reported)'

/** Batch discipline reminder. */
export const NUDGE_BATCH_REMINDER =
  'Submit ALL ranges and their summaries in ONE zctx_fold call — atomic batch. Check zctx_status first; it is the trusted ledger.'

/** Gentle-band closing line. */
export const NUDGE_GENTLE_CLOSING =
  'Pick one or more completed stretches above and fold them now to stay ahead of the trigger line.'

/** Emergency-band closing line. */
export const NUDGE_EMERGENCY_CLOSING =
  'Fold the largest unprotected spans immediately; keep only summaries and the protected tail.'

// ---------------------------------------------------------------------------
// Validator reason templates ({{x}} placeholders; reach the model through the
// zctx_fold tool result — kept here so all model-facing text has one home).
// ---------------------------------------------------------------------------

export const REASON_RANGE_NOT_ON_SURFACE =
  'fold window [{{start}}, {{end}}] is not anchored on the surface: endpoints must be existing surface nodes'

export const REASON_RANGE_INVERTED =
  'fold window [{{start}}, {{end}}] is inverted: startSeq must not exceed endSeq'

export const REASON_RANGE_DISCONTIGUOUS =
  'fold window [{{start}}, {{end}}] is not contiguous on the surface'

export const REASON_RANGE_EMPTY =
  'fold window [{{start}}, {{end}}] contains no surface nodes'

export const REASON_NODE0 =
  'fold window [{{start}}, {{end}}] would shadow surface node 0 (the system head); the harness rejects any replace of the system head, so the window must start below it'

export const REASON_PROTECTED_TAIL =
  'fold window [{{start}}, {{end}}] reaches into the protected recent tail (kept from seq {{seq}}: last {{messages}} messages / {{tokens}} tokens)'

export const REASON_LAST_USER =
  'fold window [{{start}}, {{end}}] would shadow the last user message (seq {{seq}}); the latest user turn must stay intact'

export const REASON_FIRST_USER =
  'fold window [{{start}}, {{end}}] would shadow the first user message (seq {{seq}}); it is pinned permanently'

export const REASON_TOOL_UNKNOWN_PAIRING =
  'node at seq {{seq}} is a {{role}} message with unknown tool pairing; a store scan must supply toolCallIds/answersCallId before folding'

export const REASON_TOOL_ORPHAN_RESULT =
  'tool result at seq {{seq}} answers call {{callId}} but no assistant message carrying that call is on the surface'

export const REASON_TOOL_SPLIT_RESULT =
  'tool result at seq {{seq}} answers call {{callId}} made by assistant at seq {{assistantSeq}}; tool calls and their results must be folded together'

export const REASON_TOOL_UNANSWERED_CALL =
  'assistant at seq {{seq}} calls tool {{callId}} whose result at seq {{toolSeq}} is outside the fold window; tool calls and their results must be folded together'

export const REASON_ABSORBED_UNCOVERED =
  'fold window [{{start}}, {{end}}] absorbs active fold {{foldId}} (checkpoint seq {{checkpoint}}) but no submitted summary covers that checkpoint, nor does it align with the window boundary'

export const REASON_SUMMARY_OUT_OF_WINDOW =
  'summary range [{{start}}, {{end}}] must sit inside the fold window [{{wStart}}, {{wEnd}}]'

export const REASON_SUMMARY_OVERLAP =
  'summary ranges [{{aStart}}, {{aEnd}}] and [{{bStart}}, {{bEnd}}] overlap'

export const REASON_SUMMARY_EMPTY = 'no summaries submitted; every fold needs at least one'

export const REASON_SUMMARY_TOO_SHORT =
  'summary [{{start}}, {{end}}] is {{len}} chars; minimum is {{min}}'

export const REASON_SUMMARY_TOO_LONG =
  'summary [{{start}}, {{end}}] is {{len}} chars; maximum is {{max}}'

export const REASON_WINDOW_TOO_SMALL =
  'fold window [{{start}}, {{end}}] carries an estimated {{tokens}} tokens; the qualification line is {{min}}'

export const REASON_WINDOW_TOO_LARGE =
  'fold window [{{start}}, {{end}}] carries an estimated {{tokens}} tokens; one fold may cover at most {{maxPct}}% of the context window'

export const REASON_NO_NET_SHRINK =
  'fold window [{{start}}, {{end}}] would grow the window: {{folded}} folded tokens x {{tolerance}} tolerance must exceed {{summary}} summary tokens'
