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
// Template renderer — the single `{{x}}` renderer for every placeholder-
// bearing fragment in this file (validator reason templates and nudge
// fragments); model-facing rendering stays in the single text home.
// ---------------------------------------------------------------------------

/**
 * Fill a `{{key}}` template from the given variables: every `{{key}}` with a
 * matching entry in `vars` is replaced by its stringified value; unknown
 * placeholders are left verbatim.
 */
export function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) =>
    key in vars ? String(vars[key]) : match,
  )
}

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

/** Marker for a message event that carries no text blocks at all. */
export const MATERIALIZED_NO_TEXT_CONTENT = '(no text content)'

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
// Recall excerpt.
// ---------------------------------------------------------------------------

/** Ellipsis marking a cut excerpt boundary. */
export const RECALL_EXCERPT_ELLIPSIS = '…'

// ---------------------------------------------------------------------------
// Validator reason templates ({{x}} placeholders; reach the model through the
// zctx_fold tool result — kept here so all model-facing text has one home).
// ---------------------------------------------------------------------------

export const REASON_RANGE_NOT_ON_SURFACE =
  'fold window [{{start}}, {{end}}] is not anchored on the surface: endpoints must be existing surface nodes'

export const REASON_RANGE_INVERTED =
  'fold window [{{start}}, {{end}}] is inverted: startSeq must not exceed endSeq'

export const REASON_RANGE_DISCONTIGUOUS =
  'fold window [{{start}}, {{end}}] is not contiguous on the surface: after a fold the surface is no longer '
  + 'numerically ordered (the checkpoint seq sits ahead of later nodes), so a window that spans a checkpoint plus '
  + 'later nodes is unreachable — an absorption-style fold must boundary-align with the checkpoint (window '
  + '[checkpoint, checkpoint])'

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

// ---------------------------------------------------------------------------
// W3 engine reasons (compaction mutex, fold identity, unreadable surface).
// ---------------------------------------------------------------------------

export const REASON_COMPACTION_ACTIVE =
  'a compaction transaction is active on this session (unclosed compaction/start); folding must wait until the bracket closes'

export const REASON_UNREADABLE_SURFACE =
  'surface node seqs {{seqs}} are not readable from the log; folding refuses while any surface node is unreadable'

export const REASON_SESSION_SEQ_MISSING =
  'the session does not expose its next seq; a fold id cannot be minted safely'

export const REASON_COMMIT_REJECTED =
  'the session rejected the fold commit for [{{start}}, {{end}}]: {{detail}}'

export const REASON_SUBRANGE_TOOL_SPLIT =
  'summary subrange [{{start}}, {{end}}] would split a tool-call/result pair (call {{callId}} answered at seq {{otherSeq}}); each committed subrange must keep tool calls and their results together'

// ---------------------------------------------------------------------------
// W3/W4 fold/unfold tool replies and fold-engine annotations.
// ---------------------------------------------------------------------------

export const FOLD_REPLY_OK =
  'Folded seqs {{start}}–{{end}}, ~{{tokens}} tokens reclaimed ({{count}} checkpoint{{plural}}, {{absorbed}} earlier fold{{absorbedPlural}} absorbed)'

export const FOLD_REPLY_PARTIAL =
  'fold committed partially: {{committed}} of {{total}} checkpoints landed before rejection'

export const FOLD_REPLY_COMMIT_FAILED = 'the fold commit failed before any checkpoint landed'

export const FOLD_REPLY_REJECTED = 'fold rejected ({{count}} reason{{plural}}):'

export const FOLD_REPLY_REASON_ROW = '  - {{reason}}'

export const FOLD_REPLY_ANOMALY_PREFIX = 'fold committed with anomalies:'

export const UNFOLD_REPLY_OK =
  'Unfolded fold {{foldId}}: checkpoint seq {{seq}} replaced by one node re-materializing {{blocks}} block{{plural}} (seqs {{start}}–{{end}})'

export const UNFOLD_REPLY_REJECTED = 'unfold rejected ({{count}} reason{{plural}}):'

export const REASON_FOLD_NOT_FOUND = 'no active fold with id {{foldId}}'

export const REASON_FOLD_NOT_ACTIVE =
  'fold {{foldId}} is not active (status: {{status}}); only active folds can be unfolded'

export const REASON_CHECKPOINT_GONE =
  'fold {{foldId}} checkpoint (seq {{seq}}) is no longer on the surface'

export const REASON_NO_ACTIVE_FOLDS = 'no active folds to unfold'

export const REASON_UNFOLD_REJECTED =
  'the session rejected the unfold commit for fold {{foldId}}: {{detail}}'

// ---------------------------------------------------------------------------
// W4 status display lines (zctx_status + /zctx status).
// ---------------------------------------------------------------------------

export const STATUS_WINDOW_LINE =
  'window: ~{{tokens}} tokens ({{pct}}% of {{window}}); trigger line {{trigger}} ({{triggerPct}}%)'

export const STATUS_WINDOW_UNKNOWN =
  'window: context window unknown (llm model info unavailable); budget table and pressure percent need it'

export const STATUS_CCM_BELOW_DOMAIN =
  'context window {{window}} is below the CCM legal domain (W ≥ 32768): the automatic folding face is disabled; tools remain usable'

export const STATUS_METER_UNAVAILABLE =
  'token meter unavailable: window estimate is a rough chars/3 figure, not a measurement'

export const STATUS_BUDGET_HEADER = 'Budget (CCM v2.3):'

export const STATUS_BUDGET_ROW = '  - {{label}}: {{tokens}} tokens'

export const STATUS_FIXED_WIRE_ROW =
  '  - fixed wire overhead (4 zctx tool schemas + guidance): {{tokens}} tokens'

export const STATUS_RANGES_HEADER = 'Foldable ranges (seq spans, estimated tokens):'

export const STATUS_FOLDS_HEADER = 'Folds ({{count}} active):'

export const STATUS_FOLD_ROW =
  '  - {{foldId}}: seqs {{start}}–{{end}} → checkpoint {{seq}} (~{{before}} → ~{{after}} tokens)'

export const STATUS_FOLDS_EMPTY = '  (no active folds)'

export const STATUS_ANOMALIES_HEADER = 'Anomalies ({{count}}):'

export const STATUS_ANOMALY_ROW = '  - [{{kind}}] {{detail}}'

export const STATUS_ANOMALIES_EMPTY = '  (no anomalies recorded)'

export const STATUS_USAGE_MEASURED =
  'cache usage: measured from {{samples}} provider usage sample{{plural}} (latest: cache read {{read}} / cache write {{write}} tokens)'

export const STATUS_USAGE_ESTIMATED =
  'cache usage: ESTIMATED — no provider usage data available ({{samples}} sample{{plural}} without usage); token figures are chars/3 estimates'

export const STATUS_USAGE_NONE = 'cache usage: no assistant requests observed yet'

export const STATUS_NO_SESSION = 'zctx: no live session is reachable from this call site'

export const STATUS_PARTIAL_PREFIX = 'status rendered in degraded mode:'

export const STATUS_DEGRADED_ROW = '  - {{detail}}'

// ---------------------------------------------------------------------------
// V3 observability lines (zctx_status three-segment upgrade, RES-observe-route
// §Q7.3: 本会话摘要 / 最近折叠条目 / 重置台账摘要 + 回本表; the clean-sample
// floor gate withholds repay conclusions below the floor — 诚实纪律).
// ---------------------------------------------------------------------------

export const STATUS_OBS_HEADER = 'Observability (fold→usage attribution, three-state accounting):'

export const STATUS_OBS_SESSION_LINE =
  'session: {{folds}} folds committed / repaid {{repaid}} / recovery {{recoveryPct}}% (net removed ÷ folded of committed folds)'

export const STATUS_OBS_SESSION_REPAID_WITHHELD = 'withheld'

export const STATUS_OBS_THREE_STATE =
  'three-state: measured {{measuredPct}}% / semi {{semiPct}}% / estimated {{estimatedPct}}% of {{total}} request{{plural}}'

export const STATUS_OBS_NO_SAMPLES = 'three-state: no assistant requests observed yet'

export const STATUS_OBS_BREAKEVEN_HEADER =
  'Repay table (VERIFY-C #15 price-weighted model over fold-account samples):'

export const STATUS_OBS_BREAKEVEN_ROW =
  '  - {{foldId}}: breakeven ≈ {{turns}} turns [{{quality}}]{{repaidMark}}'

export const STATUS_OBS_REPAID_MARK = ' — REPAY EVENT at assistant/message seq {{seq}}'

export const STATUS_OBS_BREAKEVEN_EMPTY =
  '  (no fold-account sample yet: no strong/retry-attributed request after a fold)'

export const STATUS_OBS_CONFIDENCE_INSUFFICIENT =
  'attribution confidence insufficient (归因可信度不足): clean-sample {{ratioPct}}% < floor {{floorPct}}% — repay conclusions withheld (honest degradation, §Q7.3)'

export const STATUS_OBS_RECENT_HEADER = 'Recent folds (attribution quality):'

export const STATUS_OBS_RECENT_ROW =
  '  - {{foldId}} [{{status}}] checkpoint seq {{seq}}: quality {{quality}}{{retryPart}}{{flags}}'

export const STATUS_OBS_RETRY_PART = ', retries {{count}}'

export const STATUS_OBS_FLAG_TIME_WINDOW = ', time-window fallback'

export const STATUS_OBS_FLAG_INTERRUPTED = ', interrupted prefix'

export const STATUS_OBS_RECENT_EMPTY = '  (no folds committed yet)'

export const STATUS_OBS_RESET_HEADER = 'Reset ledger digest (kind × count):'

export const STATUS_OBS_RESET_ROW = '  - {{kind}}: {{count}}'

export const STATUS_OBS_RESET_EMPTY = '  (no cache resets recorded)'

// ---------------------------------------------------------------------------
// V4 preflight estimator lines (zctx_status; card product 3 — the estimator
// error statistics over the S1 calibration ledger decide when enforce is
// safe to promote, no-go condition 4; thresholds 待真机标定).
// ---------------------------------------------------------------------------

export const STATUS_PREFLIGHT_HEADER = 'Preflight estimator (S1, mode {{mode}}):'

export const STATUS_PREFLIGHT_STATS =
  'calibration: {{samples}} comparable request{{plural}}, mean error {{meanPct}}% / worst {{worstPct}}% (estimate − billed input)'

export const STATUS_PREFLIGHT_SHORTCIRCUITS =
  '  - {{count}} enforce short-circuit{{plural}} (no wire request, no usage to compare)'

export const STATUS_PREFLIGHT_BASIS = '  - estimate basis: {{basis}}'

export const STATUS_PREFLIGHT_EMPTY =
  '  (no judged requests yet — calibration dataset builds in observe/enforce mode)'

export const STATUS_PREFLIGHT_NOT_COMPARABLE =
  '  - no comparable samples yet (streams settled without a usable usage chunk)'

export const RECALL_REPLY_HEADER = 'Recall hits for "{{query}}" ({{count}} of {{total}}):'

export const RECALL_REPLY_ROW =
  '  - [{{kind}}] fold {{foldId}} (seqs {{start}}–{{end}}, score {{score}}): {{excerpt}}'

export const RECALL_REPLY_EMPTY = 'No recall hits for "{{query}}".'

export const FOLD_PARSE_EMPTY =
  'parsed 0 valid fold ranges from content; expected blocks like "fold <startSeq>..<endSeq>" followed by a summary line, or a JSON array of {startRef, endRef, summary}'
