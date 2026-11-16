/**
 * autoFold — the server-initiated folding face (v0.3, task card P6-E product
 * 1; RES-bc-server-orchestration §9.1 MUST 5 + §2 preflight chain F2.1-F2.21).
 *
 * WHY THIS EXISTS (P6-D2 first-hand data): with the guidance, tool, and nudge
 * faces all verifiably on the wire, the bench model still produced ZERO
 * spontaneous folds across 20 pressure-arm rounds (BENCH-report §11.3). The
 * model-driven route is empirically dead; this face is the antidote — when
 * the estimated request context crosses the V4 trigger line, the PLUGIN
 * folds by itself: deterministic span selection → summary supply → the W2
 * validator gates → the fold-engine surface replace. The model never has to
 * call zctx_fold.
 *
 * TRIGGER (bc F2.1-F2.5 插件等价): the V4 preflight judgment reused verbatim
 * (projectAndEstimateRequest → judgeEstimate with the same margin config) as
 * a THIRD face on the llm/stream waterfall, beyond observe/enforce, armed by
 * `autofold.enabled` (default false — v0.3 explicit opt-in). Registered
 * INNERMOST (after the preflight listener): a preflight 'enforce'
 * short-circuit happens first and suppresses this face — documented
 * precedence, the wired face warns when both are on. On a hit the chain runs
 * BEFORE `next()` and the request then passes through UNCONDITIONALLY
 * (fail-open, bc F1.20: the growth arm's payload would have fit anyway — a
 * failed fold never blocks the request; the surface replace shrinks the NEXT
 * assembled request).
 *
 * R3 VARIANT RULING (recorded in tasks/ZCTX/progress.md; checkpoint notes):
 * the 'compaction' supply calls ctx.llm.stream ONCE per summary with the
 * OFFICIAL purpose marker ('compaction', llm/src/types.ts:552 closed union).
 * This is the compaction-basic one-shot precedent (summarizer.ts read in
 * full; index.ts:239-257), NOT the R3 no-go shape (an adapter calling
 * ctx.llm.stream from inside its own dispatch): the listener runs BEFORE
 * adapter dispatch, the summary call is a sequential one-shot, and every
 * main-chain listener (preflight/observe/this face) exempts it through
 * matchesMainChain's purpose gate (observe.ts:246) — re-entrancy is
 * structurally excluded, and the call never enters the session log or the
 * token meter, so it cannot feed the pressure it serves (防反馈环, bc F2.20).
 *
 * SELECTION (bc F2.8): conservative set reused verbatim from the engine —
 * foldableRanges mirrors the validator's protected zones (node 0, pinned
 * first user, latest user, recent tail); candidates are additionally
 * pre-filtered to the validator's own reachability domain (positionally
 * consecutive + numerically monotonic — check a) and trimmed to
 * maxFoldFraction × window (the 0.6 CHUNK_FRACTION spirit, bc F2.6) at
 * pair-safe boundaries only (a boundary that would split a tool pair is
 * never chosen — prefix-max/suffix-min partner arithmetic, fail-closed).
 * Largest span first; up to `autofold.maxBatch` disjoint spans per run.
 *
 * SUPPLY (bc §9.1 MUST 5 三选一, config `autofold.summarizer`):
 *   - 'compaction' (default): one-shot ctx.llm.stream, purpose-marked, to
 *     the parent request's provider/model (bc F2.14 plugin equivalent).
 *   - 'external': independent summary service (bc externalSummary 同型) —
 *     own URL/model/credential env (`autofold.external.*`).
 *   - 'digest': CPU-only deterministic structural digest (bc EMERGENCY
 *     F2.15-F2.16 同型) — zero model calls.
 *
 * DEGRADATION CHAIN (bc F2.9-F2.14):
 *   transient empty answer / call fault → retry the SAME span, at most
 *     TRANSIENT_EMPTY_RETRIES times, global budget TRANSIENT_EMPTY_BUDGET
 *     per run (F2.10);
 *   persistent failure → halving cascade (#726 同型): split the span at the
 *     pair-safe boundary nearest the token midpoint and try each half; the
 *     floor is 2 × max(MIN_CHUNK_TOKENS, the validator's own
 *     minFoldableTokens) — a half below the validator's window floor can
 *     never pass check f, so splitting below it would only burn summary
 *     calls (F2.9);
 *   a NORMAL finish with zero text is not a blip (F2.11): it is never
 *     retried in place — it feeds the halving path and counts toward the
 *     dead-probe sticky verdict (three consecutive deterministic empties put
 *     the session's supply into digest-only mode until a canary probe — one
 *     per run — succeeds);
 *   the net-shrink gate (F2.12) is the validator's own 1.05 — the chain
 *     pre-checks it with the SAME estimator and units (budget.ts
 *     estimateTokens, chars/3) so a doomed summary never reaches fold(); a
 *     rejected summary feeds the halving path, never the commit;
 *   the CPU digest is the terminal fallback for any span the supply could
 *     not fold (and the ONLY path in 'digest' mode / dead-probe sticky).
 *
 * FRESH-SURFACE RE-VERIFICATION: spans are selected once per run, but every
 * commit re-verifies its span against the CURRENT surface (an earlier fold
 * of the same run changed it — protected tail / user pin may have moved).
 * A span that no longer verifies is aborted honestly, never force-folded.
 *
 * BUDGET (bc F2.6 data-ified): maxRounds (span attempts) / maxBatch
 * (selection width) / maxSummaryOutputTokens (32K output clamp) are config;
 * the summary-call budget per run stays the exported constant
 * MAX_SUMMARY_CALLS_PER_RUN (= bc MAX_SUMMARY_CALLS_PER_PREFLIGHT 16).
 *
 * ANTI FEEDBACK LOOP (bc F2.20 + compress.ts:927-929 同型): (a) the summary
 * calls carry the purpose marker and are exempt from every listener and from
 * the session log — they cannot inflate the pressure they answer; (b) after
 * a run that committed folds, the plugin clears the nudge baseline
 * (lastPressure) for the session through the onFoldCommitted hook, so the
 * threshold state machine re-bases on the post-fold reality instead of
 * carrying pre-fold debt.
 *
 * Zero host imports beyond the established fail-soft faces (preflight.ts
 * discipline): the module talks to the host only through the injected deps.
 *
 * @module autofold
 */

import { estimateTokens } from './budget.ts'
import { fill } from './texts.ts'
import {
  AUTOFOLD_DIGEST_HEADER,
  AUTOFOLD_DIGEST_ROW,
  AUTOFOLD_DIGEST_TAIL,
  AUTOFOLD_SUMMARY_INSTRUCTION,
} from './texts.ts'
import { fold, foldableRanges } from './fold-engine.ts'
import type { FoldCommitResult, FoldSessionLike } from './fold-engine.ts'
import type { HostModelInfoLike, HostProjector } from './host-llm.ts'
import { loadHostProjector } from './host-llm.ts'
import { materializeRange } from './materialize.ts'
import { matchesMainChain } from './observe.ts'
import { judgeEstimate, projectAndEstimateRequest, resolveMarginRatio } from './preflight.ts'
import type { HostImagePricingLike } from './preflight.ts'
import type { FoldStore } from './store.ts'
import type { MaterializeBlock, SurfaceNode, ValidatorConfig } from './types.ts'

// ---------------------------------------------------------------------------
// Data-ified constants (bc F2.6-F2.11; the config-resident three are
// `autofold.maxRounds` / `autofold.maxBatch` / `autofold.maxSummaryOutputTokens`
// — these are the chain-resident ones).
// ---------------------------------------------------------------------------

/** bc F2.6 MAX_SUMMARY_CALLS_PER_PREFLIGHT=16: summary calls per triggered run. */
export const MAX_SUMMARY_CALLS_PER_RUN = 16

/** bc F2.6 MIN_CHUNK_TOKENS=2000: halving floor component. */
export const AUTOFOLD_MIN_CHUNK_TOKENS = 2000

/** bc F2.10 TRANSIENT_EMPTY_SUMMARY_RETRIES=2: same-span retries per failure. */
export const TRANSIENT_EMPTY_RETRIES = 2

/** bc F2.10 TRANSIENT_EMPTY_RETRY_BUDGET=4: transient retries per run (global). */
export const TRANSIENT_EMPTY_BUDGET = 4

/** bc F2.11 DETERMINISTIC_EMPTY_STICKY_LIMIT=3: consecutive empties → dead probe. */
export const DEAD_PROBE_STICKY_LIMIT = 3

/** bc F2.16 DIGEST_HEAD_CHARS=120: deterministic digest head fragment. */
export const DIGEST_HEAD_CHARS = 120

/** Bounded wall-clock for one external summary call (ms). */
export const EXTERNAL_SUMMARY_TIMEOUT_MS = 120_000

/** The legal summarizer kinds (card product 2; RES-bc §9.1 MUST 5 三选一). */
export const AUTOFOLD_SUMMARIZER_KINDS = ['compaction', 'external', 'digest'] as const

export type AutofoldSummarizerKind = (typeof AUTOFOLD_SUMMARIZER_KINDS)[number]

/** Parse + validate the configured summarizer kind; undefined = illegal (fail-loud caller). */
export function parseSummarizerKind(value: unknown): AutofoldSummarizerKind | undefined {
  if (typeof value !== 'string') return undefined
  return (AUTOFOLD_SUMMARIZER_KINDS as readonly string[]).includes(value)
    ? (value as AutofoldSummarizerKind)
    : undefined
}

/** Clamp one budget field: a positive finite integer wins, else the default. */
export function resolveBudgetField(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value > 0) {
    return value
  }
  return fallback
}

// ---------------------------------------------------------------------------
// Selection (bc F2.8): conservative set + reachability pre-filter + pair-safe
// trim, largest first.
// ---------------------------------------------------------------------------

/** One selected fold span (the hull the chain submits to the validator). */
export interface AutofoldSpanCandidate {
  readonly startSeq: number
  readonly endSeq: number
  readonly foldedTokens: number
}

/** Positional view of one surface node for the selection math. @internal */
interface PositionedNode {
  readonly seq: number
  readonly role: SurfaceNode['role']
  readonly estimatedTokens: number
  readonly toolCallIds: readonly string[] | undefined
  readonly answersCallId: string | undefined
}

/**
 * Pair structure of a positional node list: the leftmost-partner bound per
 * position (`lo`) plus the boundary-safety predicate (true when NO tool pair
 * straddles that boundary — fail-closed on unknown pairing, mirroring the
 * validator's rule). Computed from prefix-max of the rightmost-partner bound
 * and suffix-min of the leftmost-partner bound. @internal
 */
function pairStructure(nodes: readonly PositionedNode[]): {
  readonly lo: readonly number[]
  readonly isSafeBoundary: (boundaryAfter: number) => boolean
} {
  const assistantByCallId = new Map<string, number>()
  const toolByCallId = new Map<string, number>()
  nodes.forEach((node, index) => {
    if (node.role === 'assistant' && node.toolCallIds !== undefined) {
      for (const callId of node.toolCallIds) assistantByCallId.set(callId, index)
    }
    if (node.role === 'tool' && node.answersCallId !== undefined) {
      toolByCallId.set(node.answersCallId, index)
    }
  })
  const hi = nodes.map((node, index) => {
    let bound = index
    if (node.role === 'assistant' && node.toolCallIds !== undefined) {
      for (const callId of node.toolCallIds) {
        const toolIndex = toolByCallId.get(callId)
        if (toolIndex !== undefined) bound = Math.max(bound, toolIndex)
      }
    }
    if (node.role === 'tool' && node.answersCallId !== undefined) {
      const assistantIndex = assistantByCallId.get(node.answersCallId)
      if (assistantIndex !== undefined) bound = Math.max(bound, assistantIndex)
    }
    return bound
  })
  const lo = nodes.map((node, index) => {
    let bound = index
    if (node.role === 'assistant' && node.toolCallIds !== undefined) {
      for (const callId of node.toolCallIds) {
        const toolIndex = toolByCallId.get(callId)
        if (toolIndex !== undefined) bound = Math.min(bound, toolIndex)
      }
    }
    if (node.role === 'tool' && node.answersCallId !== undefined) {
      const assistantIndex = assistantByCallId.get(node.answersCallId)
      if (assistantIndex !== undefined) bound = Math.min(bound, assistantIndex)
    }
    return bound
  })
  // prefHi[i] = rightmost partner of any node at position ≤ i; sufLo[i] =
  // leftmost partner of any node at position ≥ i.
  const prefHi: number[] = new Array(nodes.length)
  const sufLo: number[] = new Array(nodes.length)
  for (let i = 0; i < nodes.length; i += 1) {
    prefHi[i] = i === 0 ? hi[0] : Math.max(prefHi[i - 1], hi[i])
  }
  for (let i = nodes.length - 1; i >= 0; i -= 1) {
    sufLo[i] = i === nodes.length - 1 ? lo[i] : Math.min(sufLo[i + 1], lo[i])
  }
  return {
    lo,
    isSafeBoundary: (boundaryAfter: number): boolean => {
      if (boundaryAfter < 0 || boundaryAfter >= nodes.length) return false
      return prefHi[boundaryAfter] <= boundaryAfter
        && (boundaryAfter + 1 >= nodes.length || sufLo[boundaryAfter + 1] > boundaryAfter)
    },
  }
}

/**
 * Build one span candidate for the seq hull [startSeq..endSeq] on the GIVEN
 * surface view (pure; used by selection and by the chain's fresh-surface
 * re-verification). Returns undefined when the hull is outside the
 * validator's reachability domain (check a), cannot honor the pair-safety
 * invariant at its boundaries, or falls below minFoldableTokens.
 */
export function buildSpanCandidate(
  surfaceNodes: readonly SurfaceNode[],
  startSeq: number,
  endSeq: number,
  config: ValidatorConfig,
  capTokens: number | undefined,
): AutofoldSpanCandidate | undefined {
  const nodes: PositionedNode[] = surfaceNodes.map((node) => ({
    seq: node.seq,
    role: node.role,
    estimatedTokens: node.estimatedTokens,
    toolCallIds: node.toolCallIds,
    answersCallId: node.answersCallId,
  }))
  const positionBySeq = new Map<number, number>()
  nodes.forEach((node, index) => positionBySeq.set(node.seq, index))
  const startIndex = positionBySeq.get(startSeq)
  const endIndex = positionBySeq.get(endSeq)
  if (startIndex === undefined || endIndex === undefined || endIndex < startIndex) return undefined
  const span = nodes.slice(startIndex, endIndex + 1)
  // Validator check-a pre-filter (reachability domain): the span must occupy
  // consecutive positions AND be numerically monotonic — the engine's numeric
  // shadowed filter coincides with the official positional slice exactly then
  // (W3-2 invariant); anything else is rejected by the validator anyway.
  const consecutive = endIndex - startIndex + 1 === span.length
  const monotonic = span.every((node, i) => i === 0 || node.seq > span[i - 1].seq)
  if (!consecutive || !monotonic) return undefined

  const structure = pairStructure(nodes)

  // Trim the young tail: the LAST pair-safe boundary whose kept token mass
  // fits the cap (bc F2.8 最老优先 — keep the oldest prefix; the tail side is
  // where the protected zones are). When the run's own end boundary splits a
  // pair, the scan-back finds the nearest safe one.
  let end = -1
  {
    let acc = 0
    for (let i = startIndex; i <= endIndex; i += 1) {
      acc += nodes[i].estimatedTokens
      if (capTokens !== undefined && acc > capTokens) break
      if (structure.isSafeBoundary(i)) end = i
    }
  }
  // Advance the old start past pair-unsafe left boundaries: the span's left
  // boundary sits before `start` and is safe iff no node from `start` on has
  // a partner before `start`.
  let start = startIndex
  while (start <= end) {
    let minLo = start
    for (let i = start; i <= end; i += 1) minLo = Math.min(minLo, structure.lo[i])
    if (minLo >= start) break
    start += 1
  }
  if (start > end) return undefined
  let foldedTokens = 0
  for (let i = start; i <= end; i += 1) foldedTokens += nodes[i].estimatedTokens
  if (foldedTokens < config.minFoldableTokens) return undefined
  return {
    startSeq: nodes[start].seq,
    endSeq: nodes[end].seq,
    foldedTokens,
  }
}

/**
 * Select the fold spans for one autoFold run (pure; test surface). Disjoint
 * by construction (foldableRanges runs are disjoint), largest benefit first,
 * capped at maxBatch.
 */
export function selectFoldSpans(input: {
  readonly surfaceNodes: readonly SurfaceNode[]
  readonly config: ValidatorConfig
  readonly maxBatch: number
  readonly window?: number
}): AutofoldSpanCandidate[] {
  if (input.surfaceNodes.length === 0) return []
  const runs = foldableRanges(input.surfaceNodes, input.config).filter((r) => !r.protected)
  const capTokens =
    input.window !== undefined && Number.isFinite(input.window) && input.window > 0
      ? input.config.maxFoldFraction * input.window
      : undefined
  const candidates: AutofoldSpanCandidate[] = []
  for (const run of runs) {
    const candidate = buildSpanCandidate(
      input.surfaceNodes,
      run.startSeq,
      run.endSeq,
      input.config,
      capTokens,
    )
    if (candidate !== undefined) candidates.push(candidate)
  }
  candidates.sort((a, b) => b.foldedTokens - a.foldedTokens)
  return candidates.slice(0, Math.max(1, input.maxBatch))
}

// ---------------------------------------------------------------------------
// Summary supplies (bc §9.1 MUST 5 三选一).
// ---------------------------------------------------------------------------

/** One summary request the chain hands to the active supply. */
export interface AutofoldSummaryRequest {
  readonly spanText: string
  readonly provider: string
  readonly model: string
  readonly sessionId?: string
  readonly signal?: AbortSignal
}

/** The outcome vocabulary of one supply attempt. */
export type AutofoldSupplyOutcome =
  | { readonly kind: 'ok'; readonly text: string }
  /** Empty answer; `deterministic` = a NORMAL finish produced no text (bc F2.11). */
  | { readonly kind: 'empty'; readonly deterministic: boolean; readonly detail?: string }
  | { readonly kind: 'fault'; readonly detail?: string }

/** A summary supply: one attempt, no retry policy inside (the chain owns it). */
export type AutofoldSummarySupply = (request: AutofoldSummaryRequest) => Promise<AutofoldSupplyOutcome>

/** Structural face of the official ctx.llm.stream (llm/src/index.ts stream). */
export interface LlmStreamFace {
  stream(options: Record<string, unknown>): AsyncIterable<unknown>
}

/**
 * The 'compaction' supply (official one-shot precedent; R3 variant ruling in
 * the module docstring). One ctx.llm.stream call, purpose-marked, to the
 * parent request's provider/model; output clamped to maxTokens.
 */
export function createCompactionSupply(llm: LlmStreamFace, maxOutputTokens: number): AutofoldSummarySupply {
  return async (request: AutofoldSummaryRequest): Promise<AutofoldSupplyOutcome> => {
    const prompt = `${AUTOFOLD_SUMMARY_INSTRUCTION}\n\n---\n\n${request.spanText}`
    const options: Record<string, unknown> = {
      provider: request.provider,
      model: request.model,
      messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
      maxTokens: Math.max(1, Math.floor(maxOutputTokens)),
      // Official one-shot marker (llm/src/types.ts:552 closed union): exempts
      // this call from every main-chain listener and keeps it out of the
      // session log — the anti-feedback-loop guarantee (module docstring).
      purpose: 'compaction',
      ...(request.sessionId !== undefined ? { sessionId: request.sessionId } : {}),
      ...(request.signal !== undefined ? { signal: request.signal } : {}),
    }
    let finishKind: string | undefined
    let failureDetail: string | undefined
    let deltaText = ''
    const blockTexts: string[] = []
    try {
      for await (const chunk of llm.stream(options)) {
        if (chunk === null || typeof chunk !== 'object') continue
        const chunkRecord = chunk as Record<string, unknown>
        if (chunkRecord.type === 'text-delta' && typeof chunkRecord.text === 'string') {
          deltaText += chunkRecord.text
          continue
        }
        if (chunkRecord.type === 'block-end') {
          const block = chunkRecord.block
          if (block !== null && typeof block === 'object') {
            const candidate = block as Record<string, unknown>
            if (candidate.type === 'text' && typeof candidate.text === 'string') blockTexts.push(candidate.text)
          }
          continue
        }
        if (chunkRecord.type === 'finish' && chunkRecord.reason !== null && typeof chunkRecord.reason === 'object') {
          const reason = chunkRecord.reason as Record<string, unknown>
          if (typeof reason.kind === 'string') finishKind = reason.kind
          const failure = reason.failure
          if (failure !== null && typeof failure === 'object') {
            const message = (failure as Record<string, unknown>).message
            if (typeof message === 'string') failureDetail = message
          }
        }
      }
    } catch (error: unknown) {
      return { kind: 'fault', detail: error instanceof Error ? error.message : String(error) }
    }
    const text = deltaText.trim().length > 0 ? deltaText : blockTexts.join('\n')
    if (finishKind === 'error' || finishKind === 'aborted') {
      return { kind: 'fault', detail: failureDetail ?? `stream finished with kind '${finishKind}'` }
    }
    if (finishKind === 'max-tokens') {
      // Official summarizer parity (summarizer.ts finishError): a cap-cut
      // checkpoint is incomplete — a fault, not a usable summary (the runaway
      // text could not pass the ceiling anyway).
      return text.trim().length > 0
        ? { kind: 'fault', detail: 'summary truncated at the output token cap' }
        : { kind: 'empty', deterministic: false, detail: 'truncated at the output token cap with no text' }
    }
    if (text.trim().length === 0) {
      return {
        kind: 'empty',
        deterministic: finishKind === 'stop',
        detail: finishKind === undefined ? 'stream settled without a finish chunk' : undefined,
      }
    }
    return { kind: 'ok', text }
  }
}

/** The 'external' supply endpoint (card product 2; bc externalSummary 同型). */
export interface AutofoldExternalEndpoint {
  readonly url: string
  readonly model: string
  /** Env var name holding the bearer credential; '' / unset = unauthenticated. */
  readonly apiKeyEnv?: string
  readonly maxTokens: number
}

/** Extract the summary text from an external response body (fail-soft, honest). */
export function extractExternalSummaryText(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed.length === 0) return ''
  try {
    const parsed: unknown = JSON.parse(trimmed)
    if (parsed !== null && typeof parsed === 'object') {
      const record = parsed as Record<string, unknown>
      // OpenAI-compatible: choices[0].message.content (string) or content blocks.
      const choices = record.choices
      if (Array.isArray(choices) && choices.length > 0 && choices[0] !== null && typeof choices[0] === 'object') {
        const message = (choices[0] as Record<string, unknown>).message
        if (message !== null && typeof message === 'object') {
          const content = (message as Record<string, unknown>).content
          if (typeof content === 'string') return content
          if (Array.isArray(content)) {
            const parts: string[] = []
            for (const block of content) {
              if (block !== null && typeof block === 'object') {
                const candidate = block as Record<string, unknown>
                if (candidate.type === 'text' && typeof candidate.text === 'string') parts.push(candidate.text)
              }
            }
            return parts.join('\n')
          }
        }
      }
      // LLM-response block shape: { content: [{ type: 'text', text }] }.
      if (Array.isArray(record.content)) {
        const parts: string[] = []
        for (const block of record.content) {
          if (block !== null && typeof block === 'object') {
            const candidate = block as Record<string, unknown>
            if (candidate.type === 'text' && typeof candidate.text === 'string') parts.push(candidate.text)
          }
        }
        return parts.join('\n')
      }
      // Plain { text } payloads.
      if (typeof record.text === 'string') return record.text
    }
  } catch {
    // Not JSON — the raw body is the honest reading (many services return plain text).
  }
  return trimmed
}

/**
 * The 'external' supply: one bounded HTTP POST to the configured endpoint
 * (bc external-summary 同型; the caller picked this supply explicitly — an
 * unavailable endpoint is a fault that feeds the degradation chain, never a
 * silent re-route to another supply).
 */
export function createExternalSupply(
  endpoint: AutofoldExternalEndpoint,
  fetchImpl?: typeof fetch,
): AutofoldSummarySupply {
  return async (request: AutofoldSummaryRequest): Promise<AutofoldSupplyOutcome> => {
    const impl = fetchImpl ?? globalThis.fetch
    if (typeof impl !== 'function') {
      return { kind: 'fault', detail: 'fetch is not available in this runtime' }
    }
    const prompt = `${AUTOFOLD_SUMMARY_INSTRUCTION}\n\n---\n\n${request.spanText}`
    const credential =
      endpoint.apiKeyEnv !== undefined && endpoint.apiKeyEnv.length > 0
        ? process.env[endpoint.apiKeyEnv]
        : undefined
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (typeof credential === 'string' && credential.length > 0) headers.authorization = `Bearer ${credential}`
    const timeout = new AbortController()
    const timer = setTimeout(() => timeout.abort(), EXTERNAL_SUMMARY_TIMEOUT_MS)
    const signal =
      request.signal !== undefined && typeof AbortSignal.any === 'function'
        ? AbortSignal.any([timeout.signal, request.signal])
        : timeout.signal
    try {
      const response = await impl(endpoint.url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: endpoint.model,
          max_tokens: Math.max(1, Math.floor(endpoint.maxTokens)),
          stream: false,
          messages: [{ role: 'user', content: prompt }],
        }),
        signal,
      })
      if (!response.ok) {
        return { kind: 'fault', detail: `summary service responded HTTP ${response.status}` }
      }
      const raw = await response.text()
      const text = extractExternalSummaryText(raw)
      if (text.trim().length === 0) {
        return { kind: 'empty', deterministic: false, detail: 'summary service returned no text' }
      }
      return { kind: 'ok', text }
    } catch (error: unknown) {
      return { kind: 'fault', detail: error instanceof Error ? error.message : String(error) }
    } finally {
      clearTimeout(timer)
    }
  }
}

// ---------------------------------------------------------------------------
// Deterministic CPU digest (bc F2.15-F2.16 EMERGENCY 同型; zero model calls).
// ---------------------------------------------------------------------------

/** One structural row of the digest (built by the chain from the store). */
export interface AutofoldDigestBlock {
  readonly seq: number
  readonly role: string
  readonly chars: number
  readonly text: string
}

/** Collapse whitespace and take the head fragment (deterministic). @internal */
function digestHead(text: string, headChars: number): string {
  const collapsed = text.replace(/\s+/g, ' ').trim()
  return collapsed.length <= headChars ? collapsed : `${collapsed.slice(0, headChars)}…`
}

/**
 * Build the deterministic structural digest for a span (bc form A: keep the
 * head fragments; the size bound strips rows before it ever breaks the
 * summary ceiling — form B spirit, deterministically).
 */
export function digestSpanSummary(
  blocks: readonly AutofoldDigestBlock[],
  maxChars: number,
  headChars: number = DIGEST_HEAD_CHARS,
): string {
  const rows: string[] = []
  let total = AUTOFOLD_DIGEST_HEADER.length
  for (const block of blocks) {
    const row = fill(AUTOFOLD_DIGEST_ROW, {
      seq: block.seq,
      role: block.role,
      chars: block.chars,
      head: digestHead(block.text, headChars),
    })
    if (total + row.length + 1 > maxChars) break
    rows.push(row)
    total += row.length + 1
  }
  const lines = [AUTOFOLD_DIGEST_HEADER, ...rows]
  if (rows.length < blocks.length) lines.push(AUTOFOLD_DIGEST_TAIL)
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// The chain: trigger service → selection → supply → degradation → commit.
// ---------------------------------------------------------------------------

/** Resolved numeric chain configuration (the plugin funnels config here). */
export interface AutofoldChainConfig {
  readonly maxRounds: number
  readonly maxBatch: number
  readonly maxSummaryOutputTokens: number
  /** The summarizer actually armed by config. */
  readonly summarizer: AutofoldSummarizerKind
}

/** Per-session autoFold state (process memory; feeds the status segment). */
export interface AutofoldSessionState {
  runs: number
  roundsTotal: number
  foldsCommitted: number
  netTokensSaved: number
  /** Consecutive normal-finish empty answers (bc F2.11 sticky counter). */
  deterministicEmpties: number
  deadProbeSticky: boolean
  lastRun?: AutofoldRunRecord
}

/** One run's record (facts only; the status segment renders these). */
export interface AutofoldRunRecord {
  readonly time: number
  readonly estimate: number
  readonly window?: number
  readonly hitLine?: number
  readonly rounds: number
  readonly summaryCalls: number
  readonly foldsCommitted: number
  readonly netTokensSaved: number
  readonly transientRetries: number
  readonly halvingSplits: number
  readonly digestFallbacks: number
  readonly deadProbeSticky: boolean
  readonly outcome:
    | 'folds-committed'
    | 'no-qualified-span'
    | 'budget-exhausted'
    | 'supply-dead'
    | 'no-committed-fold'
  readonly faults: readonly string[]
}

/** Everything the chain needs from the plugin (injection; no host imports). */
export interface AutofoldChainDeps {
  readonly session: FoldSessionLike
  readonly store: FoldStore
  readonly validatorConfig: ValidatorConfig
  readonly config: AutofoldChainConfig
  /** The armed LLM supply; undefined = digest-only ('digest' config). */
  readonly supply?: AutofoldSummarySupply
  readonly provider: string
  readonly model: string
  readonly sessionId?: string
  readonly estimate: number
  /** The judged hit line (triggerLine × margin) the estimate crossed. */
  readonly hitLine: number
  readonly window?: number
  /** Per-session sticky state (owned by the listener; mutated in place). */
  readonly state: AutofoldSessionState
  readonly signal?: AbortSignal
  readonly logger?: { warn?(message: string): void; info?(message: string): void }
}

/** Materialize one span's text for the summary supplies (role-prefixed blocks). @internal */
function materializeSpanText(store: FoldStore, startSeq: number, endSeq: number): string {
  const blocks: readonly MaterializeBlock[] = materializeRange(
    { eventAt: (seq) => store.retainedEvent(seq) },
    store.foldMap,
    startSeq,
    endSeq,
  )
  return blocks.map((block) => block.text).join('\n\n')
}

/** Build the digest rows for one span from the store's surface view. @internal */
function digestBlocksForSpan(store: FoldStore, startSeq: number, endSeq: number): AutofoldDigestBlock[] {
  const rows: AutofoldDigestBlock[] = []
  for (const node of store.surfaceNodes()) {
    if (node.seq < startSeq || node.seq > endSeq) continue
    rows.push({
      seq: node.seq,
      role: node.role,
      chars: node.textLength,
      text: store.eventText(node.seq),
    })
  }
  return rows
}

/** Outcome of one span's full attempt chain. @internal */
type SpanAttempt =
  | { readonly kind: 'committed'; readonly reclaimedTokens: number }
  | { readonly kind: 'halve' }
  | { readonly kind: 'abort'; readonly detail: string }

/**
 * Run one autoFold chain (the pure orchestrator; the listener calls it on a
 * trigger hit). Budgets, the degradation chain, and the sticky state machine
 * all live here; the commit goes through the SAME fold() the zctx_fold tool
 * uses (validator + surface replace + generation verification — no second
 * commit path).
 */
export async function runAutoFoldChain(deps: AutofoldChainDeps): Promise<AutofoldRunRecord> {
  const faults: string[] = []
  let rounds = 0
  let summaryCalls = 0
  let transientRetries = 0
  let halvingSplits = 0
  let digestFallbacks = 0
  let foldsCommitted = 0
  let netTokensSaved = 0
  let supplyDead = deps.state.deadProbeSticky
  let canaryUsed = false
  // bc F2.3: the decision shortfall the folds must reclaim — the estimate's
  // distance above the judged hit line. The chain stops when it is closed or
  // the budgets are gone.
  let remaining = Math.max(0, deps.estimate - deps.hitLine)

  deps.store.resync()
  const capTokens =
    deps.window !== undefined && Number.isFinite(deps.window) && deps.window > 0
      ? deps.validatorConfig.maxFoldFraction * deps.window
      : undefined
  const candidates = selectFoldSpans({
    surfaceNodes: deps.store.surfaceNodes(),
    config: deps.validatorConfig,
    maxBatch: deps.config.maxBatch,
    ...(deps.window !== undefined ? { window: deps.window } : {}),
  })

  const ceiling = Math.max(1, deps.validatorConfig.summaryCeilingChars)
  const splitFloorTokens = Math.max(AUTOFOLD_MIN_CHUNK_TOKENS, deps.validatorConfig.minFoldableTokens)

  /** One summary-call flow for a span (retries + sticky + canary). @internal */
  const attemptSupply = async (
    span: AutofoldSpanCandidate,
  ): Promise<{ kind: 'text'; text: string } | { kind: 'skip-digest' } | { kind: 'give-up'; detail: string }> => {
    const supply = deps.supply
    if (supply === undefined) return { kind: 'skip-digest' }
    if (supplyDead && canaryUsed) return { kind: 'skip-digest' }
    const spanText = materializeSpanText(deps.store, span.startSeq, span.endSeq)
    // bc F2.11 canary: one supply attempt per run tests a sticky verdict.
    const isCanary = supplyDead && !canaryUsed
    canaryUsed = true
    for (let attempt = 0; attempt <= TRANSIENT_EMPTY_RETRIES; attempt += 1) {
      if (summaryCalls >= MAX_SUMMARY_CALLS_PER_RUN) {
        return { kind: 'give-up', detail: 'summary-call budget exhausted' }
      }
      summaryCalls += 1
      const outcome = await supply({
        spanText,
        provider: deps.provider,
        model: deps.model,
        ...(deps.sessionId !== undefined ? { sessionId: deps.sessionId } : {}),
        ...(deps.signal !== undefined ? { signal: deps.signal } : {}),
      })
      if (outcome.kind === 'ok') {
        deps.state.deterministicEmpties = 0
        if (isCanary) {
          supplyDead = false
          deps.state.deadProbeSticky = false
        }
        return { kind: 'text', text: outcome.text }
      }
      if (outcome.kind === 'empty' && outcome.deterministic) {
        // bc F2.11: a NORMAL finish with zero text is not a blip — it is
        // never retried in place; it counts toward the sticky verdict and
        // the span goes to the halving path (a smaller span may summarize).
        deps.state.deterministicEmpties += 1
        faults.push(`deterministic empty answer (${outcome.detail ?? 'normal finish, no text'})`)
        if (deps.state.deterministicEmpties >= DEAD_PROBE_STICKY_LIMIT) {
          supplyDead = true
          deps.state.deadProbeSticky = true
          faults.push(
            `summary supply judged dead: ${DEAD_PROBE_STICKY_LIMIT} consecutive normal-finish empty answers`,
          )
        }
        return { kind: 'give-up', detail: 'deterministic empty answer (halving path)' }
      }
      // Transient empty or fault: bc F2.10 same-span retry, global budget.
      if (transientRetries < TRANSIENT_EMPTY_BUDGET && attempt < TRANSIENT_EMPTY_RETRIES) {
        transientRetries += 1
        faults.push(
          `${outcome.kind === 'empty' ? 'transient empty answer' : 'summary call fault'}: ${outcome.detail ?? 'no detail'} (retry ${transientRetries})`,
        )
        continue
      }
      return {
        kind: 'give-up',
        detail:
          outcome.kind === 'empty'
            ? `transient empty answer exhausted retries (${outcome.detail ?? 'no detail'})`
            : `summary call fault (${outcome.detail ?? 'no detail'})`,
      }
    }
    return { kind: 'give-up', detail: 'retry loop exhausted' }
  }

  /** Validate + commit one span with the given summary text (the ONLY commit path). @internal */
  const commitSpan = (span: AutofoldSpanCandidate, text: string): SpanAttempt => {
    // Fresh-surface re-verification: earlier folds of this run changed the
    // surface (protected tail / user pin may have moved). A span that no
    // longer verifies is aborted honestly, never force-folded.
    const fresh = buildSpanCandidate(
      deps.store.surfaceNodes(),
      span.startSeq,
      span.endSeq,
      deps.validatorConfig,
      capTokens,
    )
    if (fresh === undefined) {
      const detail = `span ${span.startSeq}..${span.endSeq} is no longer selectable on the current surface`
      faults.push(`fold rejected: ${detail}`)
      return { kind: 'abort', detail }
    }
    // Net-shrink pre-check (bc F2.12) with the SAME estimator and units the
    // validator uses (budget.ts estimateTokens, chars/3): a doomed summary
    // never reaches fold() — the validator still enforces the gate itself
    // (defense in depth).
    const summaryTokens = estimateTokens(text)
    if (fresh.foldedTokens * deps.validatorConfig.netShrinkTolerance <= summaryTokens) {
      faults.push(
        `net-shrink pre-check rejected the summary for span ${fresh.startSeq}..${fresh.endSeq} ` +
          `(${Math.round(fresh.foldedTokens * deps.validatorConfig.netShrinkTolerance)} gate vs ${summaryTokens} summary tokens)`,
      )
      return { kind: 'halve' }
    }
    const result: FoldCommitResult = fold(
      deps.session,
      deps.store,
      {
        range: { startSeq: fresh.startSeq, endSeq: fresh.endSeq },
        summaries: [{ startSeq: fresh.startSeq, endSeq: fresh.endSeq, text }],
      },
      deps.validatorConfig,
    )
    if (result.ok) {
      const reclaimed = result.plan?.reclaimedTokens ?? 0
      foldsCommitted += result.committed.length
      netTokensSaved += result.committed.reduce(
        (sum, commit) => sum + Math.max(0, commit.tokensBefore - commit.tokensAfter),
        0,
      )
      remaining -= reclaimed
      return { kind: 'committed', reclaimedTokens: reclaimed }
    }
    const reasons = result.reasons.join(' | ')
    faults.push(`fold rejected for span ${fresh.startSeq}..${fresh.endSeq}: ${reasons}`)
    // The validator's own net-shrink gate also feeds the halving path (bc
    // F2.12); every structural rejection is a selection error — abort the
    // span honestly (halving cannot fix protected-zone or pair violations).
    const netShrink = result.reasons.some((reason) => reason.includes('tolerance must exceed'))
    return netShrink ? { kind: 'halve' } : { kind: 'abort', detail: reasons }
  }

  /** The terminal CPU fallback for one span. @internal */
  const digestSpan = (span: AutofoldSpanCandidate): SpanAttempt => {
    digestFallbacks += 1
    const text = digestSpanSummary(digestBlocksForSpan(deps.store, span.startSeq, span.endSeq), ceiling)
    const attempt = commitSpan(span, text)
    // The digest is deterministic — halving cannot rescue a rejected digest
    // row-for-row (both sides shrink proportionally), so a rejected digest is
    // an honest abort for this span (bc F2.13 futility: the budget is not
    // burned on a span that cannot shrink).
    if (attempt.kind === 'halve') {
      return { kind: 'abort', detail: `digest rejected by the net-shrink gate for span ${span.startSeq}..${span.endSeq}` }
    }
    return attempt
  }

  /** Split point: the pair-safe boundary nearest the token midpoint. @internal */
  const splitSpan = (
    span: AutofoldSpanCandidate,
  ): { left: AutofoldSpanCandidate; right: AutofoldSpanCandidate } | undefined => {
    if (span.foldedTokens < 2 * splitFloorTokens) return undefined
    const nodes: PositionedNode[] = deps.store
      .surfaceNodes()
      .filter((n) => n.seq >= span.startSeq && n.seq <= span.endSeq)
      .map((node) => ({
        seq: node.seq,
        role: node.role,
        estimatedTokens: node.estimatedTokens,
        toolCallIds: node.toolCallIds,
        answersCallId: node.answersCallId,
      }))
    if (nodes.length < 2) return undefined
    const { isSafeBoundary } = pairStructure(nodes)
    const total = nodes.reduce((sum, n) => sum + n.estimatedTokens, 0)
    let acc = 0
    let bestIndex = -1
    let bestDistance = Number.POSITIVE_INFINITY
    for (let i = 0; i < nodes.length - 1; i += 1) {
      acc += nodes[i].estimatedTokens
      if (!isSafeBoundary(i)) continue
      const distance = Math.abs(acc - total / 2)
      if (distance < bestDistance) {
        bestDistance = distance
        bestIndex = i
      }
    }
    if (bestIndex < 0) return undefined
    const leftNodes = nodes.slice(0, bestIndex + 1)
    const rightNodes = nodes.slice(bestIndex + 1)
    const leftTokens = leftNodes.reduce((sum, n) => sum + n.estimatedTokens, 0)
    const rightTokens = rightNodes.reduce((sum, n) => sum + n.estimatedTokens, 0)
    if (leftTokens < splitFloorTokens || rightTokens < splitFloorTokens) return undefined
    return {
      left: {
        startSeq: leftNodes[0].seq,
        endSeq: leftNodes[leftNodes.length - 1].seq,
        foldedTokens: leftTokens,
      },
      right: {
        startSeq: rightNodes[0].seq,
        endSeq: rightNodes[rightNodes.length - 1].seq,
        foldedTokens: rightTokens,
      },
    }
  }

  /** One span's full flow: supply → validate/commit → halve → digest. @internal */
  const processSpan = async (span: AutofoldSpanCandidate): Promise<void> => {
    const supplied = await attemptSupply(span)
    if (supplied.kind === 'text') {
      const attempt = commitSpan(span, supplied.text)
      if (attempt.kind === 'committed' || attempt.kind === 'abort') return
      // net-shrink rejection → the halving path below (bc F2.12)
    } else if (supplied.kind === 'skip-digest') {
      digestSpan(span)
      return
    } // 'give-up' (or a net-shrink commit rejection) → halve-or-digest below
    const halves = splitSpan(span)
    if (halves !== undefined) {
      halvingSplits += 1
      faults.push(
        `halving span ${span.startSeq}..${span.endSeq} → ${halves.left.startSeq}..${halves.left.endSeq} + ${halves.right.startSeq}..${halves.right.endSeq}`,
      )
      // Oldest half first (bc F2.8 最老优先). Budget checks run at dequeue.
      pending.push(halves.left, halves.right)
      return
    }
    digestSpan(span)
  }

  const pending: AutofoldSpanCandidate[] = [...candidates]
  // The loop's stop reason: why the chain stopped working (the outcome
  // classification reads it — a round-budget stop is 'budget-exhausted' even
  // when some folds committed; the record carries both facts).
  let stopped: 'work-done' | 'budget-exhausted' | 'shortfall-closed' = 'work-done'
  while (pending.length > 0) {
    if (rounds >= deps.config.maxRounds) {
      stopped = 'budget-exhausted'
      break
    }
    if (remaining <= 0) {
      stopped = 'shortfall-closed'
      break
    }
    const span = pending.shift()
    if (span === undefined) break
    rounds += 1
    await processSpan(span)
  }
  let outcome: AutofoldRunRecord['outcome']
  if (candidates.length === 0) {
    outcome = 'no-qualified-span'
  } else if (stopped === 'budget-exhausted') {
    outcome = 'budget-exhausted'
  } else if (foldsCommitted > 0) {
    outcome = 'folds-committed'
  } else if (supplyDead) {
    outcome = 'supply-dead'
  } else {
    outcome = 'no-committed-fold'
  }

  const record: AutofoldRunRecord = {
    time: Date.now(),
    estimate: deps.estimate,
    ...(deps.window !== undefined ? { window: deps.window } : {}),
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
    faults,
  }
  deps.state.runs += 1
  deps.state.roundsTotal += rounds
  deps.state.foldsCommitted += foldsCommitted
  deps.state.netTokensSaved += netTokensSaved
  deps.state.lastRun = record
  return record
}

// ---------------------------------------------------------------------------
// The waterfall listener (the third llm/stream face).
// ---------------------------------------------------------------------------

/** The deps the plugin hands the listener (narrow by construction). */
export interface AutoFoldListenerDeps {
  readonly summarizer: AutofoldSummarizerKind
  readonly marginRatio: number
  readonly chain: AutofoldChainConfig
  /** The armed supply; undefined = digest-only. */
  readonly supply?: AutofoldSummarySupply
  resolveSession(sessionId: string): unknown
  storeFor(session: unknown): FoldStore | undefined
  validatorConfig(session: unknown): ValidatorConfig
  resolveModelInfo?(provider: string, model: string): Promise<HostModelInfoLike | undefined>
  fileRequestText?(ref: unknown): string | undefined
  imageRequestPricing?(provider: string, model: string): HostImagePricingLike | undefined
  /** Nudge-baseline reset hook (防反馈环; called after fold-committing runs). */
  onFoldCommitted?(session: unknown): void
  logger?: { warn?(message: string): void; info?(message: string): void }
}

/** The waterfall listener signature (official 'llm/stream' event face). */
export type AutoFoldStreamListener = (
  options: unknown,
  next: () => AsyncIterable<unknown>,
) => AsyncIterable<unknown>

/** The trigger plan built before the stream is touched. @internal */
interface TriggerPlan {
  readonly session: unknown
  readonly store: FoldStore
  readonly state: AutofoldSessionState
  readonly provider: string
  readonly model: string
  readonly estimate: number
  readonly hitLine: number
  readonly window: number | undefined
  readonly signal: AbortSignal | undefined
  readonly sessionId: string | undefined
}

/**
 * The autoFold waterfall listener. Construct once per plugin when
 * autofold.enabled; register `onStream` AFTER the preflight listener
 * (innermost — enforce precedence is documented in the module docstring).
 */
export class AutoFoldListener {
  private readonly deps: AutoFoldListenerDeps
  private readonly stateBySession = new WeakMap<object, AutofoldSessionState>()
  private readonly running = new WeakSet<object>()
  private readonly modelInfoCache = new Map<string, Promise<HostModelInfoLike | undefined>>()
  private projector: Promise<HostProjector> | undefined
  private warnedFault = false

  private static readonly MODEL_INFO_CACHE_CAP = 64

  constructor(deps: AutoFoldListenerDeps) {
    this.deps = { ...deps, marginRatio: resolveMarginRatio(deps.marginRatio, deps.logger) }
  }

  /** Memoized projector (same lazy face as the other two listeners). */
  ensureProjector(): Promise<HostProjector> {
    this.projector ??= loadHostProjector()
    return this.projector
  }

  readonly onStream: AutoFoldStreamListener = (options: unknown, next: () => AsyncIterable<unknown>) =>
    this.handleStream(options, next)

  /** The per-session status view (facts only; status segment 8 renders it). */
  statusFor(session: unknown): AutofoldSessionState | undefined {
    const state = this.stateBySession.get(session as object)
    if (state === undefined) return undefined
    return { ...state }
  }

  /** @internal */
  private stateFor(session: unknown): AutofoldSessionState {
    let state = this.stateBySession.get(session as object)
    if (state === undefined) {
      state = {
        runs: 0,
        roundsTotal: 0,
        foldsCommitted: 0,
        netTokensSaved: 0,
        deterministicEmpties: 0,
        deadProbeSticky: false,
      }
      this.stateBySession.set(session as object, state)
    }
    return state
  }

  /** Memoized per-route model info (bounded, negative results cached; V2-C design). */
  private resolveModelInfoCached(provider: string, model: string): Promise<HostModelInfoLike | undefined> {
    if (provider === '' || model === '' || typeof this.deps.resolveModelInfo !== 'function') {
      return Promise.resolve(undefined)
    }
    const key = `${provider}\u0000${model}`
    let entry = this.modelInfoCache.get(key)
    if (entry === undefined) {
      entry = this.deps.resolveModelInfo(provider, model).catch(() => undefined)
      if (this.modelInfoCache.size >= AutoFoldListener.MODEL_INFO_CACHE_CAP) {
        const oldest = this.modelInfoCache.keys().next()
        if (!oldest.done) this.modelInfoCache.delete(oldest.value)
      }
      this.modelInfoCache.set(key, entry)
    }
    return entry
  }

  /** @internal */
  private async *handleStream(options: unknown, next: () => AsyncIterable<unknown>): AsyncIterable<unknown> {
    let plan: TriggerPlan | undefined
    try {
      plan = await this.prepare(options)
    } catch (error: unknown) {
      // A prepare fault is rare and operator-visible: warn ONCE per listener
      // (never per request — the request must still go through untouched).
      if (!this.warnedFault) {
        this.warnedFault = true
        this.deps.logger?.warn?.(
          `dsh-zcontext: autofold estimation failed (${error instanceof Error ? error.message : String(error)}); requests pass through unjudged until the fault clears`,
        )
      }
      plan = undefined
    }
    if (plan === undefined) {
      yield* next()
      return
    }
    // The chain runs BEFORE the request dispatches; the request passes
    // through unconditionally afterwards (bc F1.20 fail-open). A committed
    // fold shrinks the NEXT assembled request — the plugin surface-replace
    // channel owns nothing about the in-flight body (adapter F8.2 no-go).
    this.running.add(plan.session as object)
    let record: AutofoldRunRecord | undefined
    try {
      record = await runAutoFoldChain({
        session: plan.session as FoldSessionLike,
        store: plan.store,
        validatorConfig: this.deps.validatorConfig(plan.session),
        config: this.deps.chain,
        ...(this.deps.supply !== undefined ? { supply: this.deps.supply } : {}),
        provider: plan.provider,
        model: plan.model,
        ...(plan.sessionId !== undefined ? { sessionId: plan.sessionId } : {}),
        estimate: plan.estimate,
        hitLine: plan.hitLine,
        ...(plan.window !== undefined ? { window: plan.window } : {}),
        state: plan.state,
        ...(plan.signal !== undefined ? { signal: plan.signal } : {}),
        logger: this.deps.logger,
      })
    } catch (error: unknown) {
      this.deps.logger?.warn?.(
        `dsh-zcontext: autofold chain failed (${error instanceof Error ? error.message : String(error)}); the request proceeds unfolded`,
      )
    } finally {
      this.running.delete(plan.session as object)
    }
    // 防反馈环 (bc F2.20): clear the nudge baseline after a fold-committing
    // run so the threshold state machine re-bases on post-fold reality.
    if (record !== undefined && record.foldsCommitted > 0) this.deps.onFoldCommitted?.(plan.session)
    yield* next()
  }

  /**
   * The trigger judgment (V4 criteria reused verbatim; the third face beyond
   * observe/enforce). Returns undefined = pass-through (not main-chain,
   * unwatched, trigger not crossed); throws only on real faults. @internal
   */
  private async prepare(options: unknown): Promise<TriggerPlan | undefined> {
    if (options === null || typeof options !== 'object') return undefined
    const record = options as Record<string, unknown>
    const projector = await this.ensureProjector()
    const match = matchesMainChain(record, projector, {
      resolveSession: (sessionId) => this.deps.resolveSession(sessionId),
      storeFor: (session) => this.deps.storeFor(session),
    })
    if (match === undefined) return undefined
    const session = this.deps.resolveSession(match.sessionId)
    if (session === undefined) return undefined
    if (this.running.has(session as object)) return undefined // re-entrancy guard
    const store = this.deps.storeFor(session)
    if (store === undefined) return undefined

    const provider = typeof record.provider === 'string' ? record.provider : ''
    const model = typeof record.model === 'string' ? record.model : ''
    const modelInfo = await this.resolveModelInfoCached(provider, model)
    const pricing =
      typeof this.deps.imageRequestPricing === 'function'
        ? this.deps.imageRequestPricing(provider, model)
        : undefined
    const estimate = projectAndEstimateRequest({
      options: record,
      projector,
      modelInfo,
      ...(typeof this.deps.fileRequestText === 'function'
        ? { fileRequestText: (ref: unknown) => this.deps.fileRequestText?.(ref) }
        : {}),
      ...(pricing !== undefined ? { imagePricing: pricing } : {}),
    })
    const judgment = judgeEstimate({
      estimate: estimate.tokens,
      modelInfo,
      optionsMaxTokens: record.maxTokens,
      marginRatio: this.deps.marginRatio,
    })
    if (judgment.hit !== true || judgment.triggerLine === undefined) return undefined
    const signal = record.signal
    return {
      session,
      store,
      state: this.stateFor(session),
      provider,
      model,
      estimate: estimate.tokens,
      hitLine: Math.ceil(judgment.triggerLine * this.deps.marginRatio),
      window: judgment.window,
      sessionId: typeof record.sessionId === 'string' ? record.sessionId : undefined,
      signal: signal instanceof AbortSignal ? signal : undefined,
    }
  }
}
