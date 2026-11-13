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

import { createRequire } from 'node:module'

import { computeBudget } from './budget.ts'
import { DEFAULT_RECALL_LIMIT, recall } from './search.ts'
import {
  FOLD_PARSE_EMPTY,
  REASON_NO_ACTIVE_FOLDS,
  RECALL_REPLY_EMPTY,
  RECALL_REPLY_HEADER,
  RECALL_REPLY_ROW,
  STATUS_ANOMALIES_EMPTY,
  STATUS_ANOMALIES_HEADER,
  STATUS_ANOMALY_ROW,
  STATUS_BUDGET_HEADER,
  STATUS_BUDGET_ROW,
  STATUS_CCM_BELOW_DOMAIN,
  STATUS_DEGRADED_ROW,
  STATUS_FIXED_WIRE_ROW,
  STATUS_FOLDS_EMPTY,
  STATUS_FOLDS_HEADER,
  STATUS_FOLD_ROW,
  STATUS_METER_UNAVAILABLE,
  STATUS_NO_SESSION,
  STATUS_OBS_BREAKEVEN_EMPTY,
  STATUS_OBS_BREAKEVEN_HEADER,
  STATUS_OBS_BREAKEVEN_ROW,
  STATUS_OBS_CONFIDENCE_INSUFFICIENT,
  STATUS_OBS_FLAG_INTERRUPTED,
  STATUS_OBS_FLAG_TIME_WINDOW,
  STATUS_OBS_HEADER,
  STATUS_OBS_RECENT_EMPTY,
  STATUS_OBS_RECENT_HEADER,
  STATUS_OBS_RECENT_ROW,
  STATUS_OBS_REPAID_MARK,
  STATUS_OBS_RESET_EMPTY,
  STATUS_OBS_RESET_HEADER,
  STATUS_OBS_RESET_ROW,
  STATUS_OBS_RETRY_PART,
  STATUS_OBS_SESSION_LINE,
  STATUS_OBS_SESSION_REPAID_WITHHELD,
  STATUS_OBS_THREE_STATE,
  STATUS_OBS_NO_SAMPLES,
  STATUS_PARTIAL_PREFIX,
  STATUS_RANGES_HEADER,
  STATUS_USAGE_ESTIMATED,
  STATUS_USAGE_MEASURED,
  STATUS_USAGE_NONE,
  STATUS_WINDOW_LINE,
  STATUS_WINDOW_UNKNOWN,
  NUDGE_PROTECTED_MARKER,
  NUDGE_PROTECTED_REASON_PREFIX,
  NUDGE_PROTECTED_REASON_SUFFIX,
  NUDGE_RANGE_ROW,
  fill,
} from './texts.ts'
import type {
  FoldUsageAttribution,
  RecallEntry,
  SessionLike,
  ToolRunContextLike,
  ValidatorConfig,
} from './types.ts'
import type { FoldStore } from './store.ts'
import {
  ccmWindowGate,
  fold,
  foldableRanges,
  renderFoldReply,
  renderUnfoldReply,
  unfold,
} from './fold-engine.ts'
import type { FoldSessionLike } from './fold-engine.ts'

// ---------------------------------------------------------------------------
// Structural authoring contract (defineTool author prop-map subset).
// ---------------------------------------------------------------------------

/** One parameter of the author prop-map (official ParamSpec subset). */
export interface ParamSpec {
  readonly type: 'string' | 'number' | 'boolean'
  readonly required?: boolean
  readonly description?: string
}

/** Structural defineTool options the four tools are authored with. */
export interface ZctxToolSpec {
  readonly name: string
  readonly description: string
  readonly parameters: Readonly<Record<string, ParamSpec>>
  /** All four tools return a model-facing string (official { type: 'string' }). */
  execute(args: Record<string, unknown>, exec: ToolRunContextLike): Promise<string> | string
}

/** Registry-ready definition (structural mirror of the official ToolDefinition subset). */
export interface ZctxToolDefinition {
  readonly name: string
  readonly description: string
  /** Compiled JSON-Schema subset (official ParameterJsonSchema shape). */
  readonly parameters: {
    readonly type: 'object'
    readonly properties: Readonly<Record<string, Record<string, unknown>>>
    readonly required?: readonly string[]
  }
  readonly output: {
    readonly schema: { readonly type: 'string' }
    readonly render: (args: unknown, value: string) => readonly { readonly type: 'text'; readonly text: string }[]
  }
  readonly execute: (args: unknown, exec: ToolRunContextLike) => Promise<string>
  // NOTE (S8): no `isConcurrencySafe` — omission keeps the official
  // exclusive barrier, the fold engine's mutual-exclusion precondition.
}

/** defineTool-compatible factory the tool builder consumes. */
export type DefineToolFn = (spec: {
  readonly name: string
  readonly description: string
  readonly parameters: Readonly<Record<string, ParamSpec>>
  readonly output: {
    readonly schema: { readonly type: 'string' }
    readonly render: (args: unknown, value: string) => readonly { readonly type: 'text'; readonly text: string }[]
  }
  readonly execute: (args: Record<string, unknown>, exec: ToolRunContextLike) => Promise<string>
}) => ZctxToolDefinition

const nodeRequire = createRequire(import.meta.url)

/** Structural surface of the host @deepseek-ai/dsh-tools module used here. */
interface DshToolsModule {
  defineTool?: DefineToolFn
}

/**
 * Resolve the host's official defineTool lazily; `undefined` when the host
 * package is absent (the shim below takes over — fail-soft, never throws).
 */
function loadHostDefineTool(): DefineToolFn | undefined {
  try {
    const mod = nodeRequire('@deepseek-ai/dsh-tools') as DshToolsModule
    return typeof mod?.defineTool === 'function' ? (mod.defineTool as DefineToolFn) : undefined
  } catch {
    return undefined
  }
}

/**
 * Fail-soft defineTool shim: compiles the author prop-map into the enforced
 * JSON-Schema subset and validates arguments before execute (official
 * ToolArgsError semantics: `invalid arguments: <violations>`). Arguments are
 * passed through untyped.
 */
function createShimDefineTool(): DefineToolFn {
  return (spec) => {
    const required: string[] = []
    const properties: Record<string, Record<string, unknown>> = {}
    for (const [name, param] of Object.entries(spec.parameters)) {
      const node: Record<string, unknown> = { type: param.type }
      if (param.description !== undefined) node.description = param.description
      properties[name] = node
      if (param.required === true) required.push(name)
    }
    const validate = (args: unknown): Record<string, unknown> => {
      const violations: string[] = []
      const source = (args !== null && typeof args === 'object' ? args : {}) as Record<string, unknown>
      for (const name of required) {
        if (source[name] === undefined) violations.push(`${name}: required`)
      }
      for (const [name, param] of Object.entries(spec.parameters)) {
        const value = source[name]
        if (value === undefined) continue
        const matches =
          param.type === 'string'
            ? typeof value === 'string'
            : param.type === 'number'
              ? typeof value === 'number' && Number.isFinite(value)
              : typeof value === 'boolean'
        if (!matches) violations.push(`${name}: expected ${param.type}`)
      }
      if (violations.length > 0) {
        throw new Error(`invalid arguments: ${violations.join('; ')}`)
      }
      return source
    }
    return {
      name: spec.name,
      description: spec.description,
      parameters: {
        type: 'object',
        properties,
        ...(required.length > 0 ? { required } : {}),
      },
      output: spec.output,
      async execute(args, exec) {
        const parsed = validate(args)
        return spec.execute(parsed, exec)
      },
    }
  }
}

/** Resolve defineTool: the host implementation when present, shim otherwise. */
export function resolveDefineTool(): DefineToolFn {
  return loadHostDefineTool() ?? createShimDefineTool()
}

// ---------------------------------------------------------------------------
// Lenient fold-content parser (parseCompressInput-aligned, self-implemented).
// ---------------------------------------------------------------------------

export type ParsedFoldContent =
  | { readonly ok: true; readonly range: { readonly startSeq: number; readonly endSeq: number }; readonly summaries: readonly { readonly startSeq: number; readonly endSeq: number; readonly text: string }[] }
  | { readonly ok: false; readonly reason: string }

/**
 * Parse one seq reference: plain digits, `m00012` message refs, or a
 * `seq 12` prefix (billion-context ref vocabulary, base 10).
 */
function parseSeqRef(raw: unknown): number | undefined {
  if (typeof raw !== 'string' && typeof raw !== 'number') return undefined
  const text = String(raw).trim().toLowerCase()
  const match = /^(?:seq[ ._-]*)?m?0*(\d{1,9})$/.exec(text)
  if (match === null) return undefined
  const value = Number(match[1])
  return Number.isSafeInteger(value) ? value : undefined
}

/** One parsed range block (parseCompressInput's ParsedRange twin). */
interface ParsedRangeBlock {
  readonly startSeq: number
  readonly endSeq: number
  readonly text: string
}

/** Header line of one text block: `fold 12..18 [topic]`, `seq 12..18`, or `m00012–m00018`. */
const HEADER_LINE =
  /^\s*(?:(?:fold|zctx)\s+)?(?:seq[ ._-]*)?(?:m?0*(\d{1,9}))\s*(?:\.\.|\u2026|\u2013|\u2014|-->|--|—|–|-)\s*(?:m?0*(\d{1,9}))\s*(.*)$/i

/** Parse the text-block form: header lines interleaved with markdown bodies. */
function parseTextBlocks(content: string): ParsedRangeBlock[] {
  const blocks: ParsedRangeBlock[] = []
  const lines = content.split('\n')
  let current: { startSeq: number; endSeq: number; body: string[] } | undefined
  for (const line of lines) {
    const match = HEADER_LINE.exec(line)
    if (match !== null && match[1] !== undefined && match[2] !== undefined) {
      if (current !== undefined) {
        blocks.push({ startSeq: current.startSeq, endSeq: current.endSeq, text: current.body.join('\n').trim() })
      }
      current = { startSeq: Number(match[1]), endSeq: Number(match[2]), body: [] }
      continue
    }
    if (current !== undefined) current.body.push(line)
  }
  if (current !== undefined) {
    blocks.push({ startSeq: current.startSeq, endSeq: current.endSeq, text: current.body.join('\n').trim() })
  }
  return blocks.filter((b) => b.text.length > 0)
}

/** One JSON range object (parseCompressInput's toRange twin). */
function jsonRangeToObject(entry: unknown): ParsedRangeBlock | undefined {
  if (entry === null || typeof entry !== 'object') return undefined
  const record = entry as Record<string, unknown>
  const startRaw = record.startId !== undefined ? record.startId : record.startRef
  const endRaw = record.endId !== undefined ? record.endId : record.endRef
  const startSeq = parseSeqRef(startRaw)
  const endSeq = parseSeqRef(endRaw)
  const text = record.summary
  if (startSeq === undefined || endSeq === undefined || typeof text !== 'string') return undefined
  return { startSeq, endSeq, text: text.trim() }
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
export function parseFoldContent(content: unknown): ParsedFoldContent {
  if (typeof content !== 'string' || content.trim().length === 0) {
    return { ok: false, reason: FOLD_PARSE_EMPTY }
  }

  const blocks: ParsedRangeBlock[] = []
  // JSON tolerance (parseCompressInput: string → JSON.parse).
  try {
    const parsed: unknown = JSON.parse(content)
    if (Array.isArray(parsed)) {
      for (const entry of parsed) {
        const block = jsonRangeToObject(entry)
        if (block !== undefined) blocks.push(block)
      }
    } else if (parsed !== null && typeof parsed === 'object') {
      const block = jsonRangeToObject(parsed)
      if (block !== undefined) blocks.push(block)
    } else if (typeof parsed === 'string') {
      // A JSON string wrapping the text-block form (gateway double-encoding).
      blocks.push(...parseTextBlocks(parsed))
    }
  } catch {
    // Not JSON — the plain text-block form below.
  }

  if (blocks.length === 0) blocks.push(...parseTextBlocks(content))
  if (blocks.length === 0) return { ok: false, reason: FOLD_PARSE_EMPTY }

  // Reject inverted blocks; keep the valid ones (honest diagnostics).
  const valid = blocks.filter((b) => b.startSeq <= b.endSeq)
  if (valid.length === 0) return { ok: false, reason: FOLD_PARSE_EMPTY }

  const startSeq = Math.min(...valid.map((b) => b.startSeq))
  const endSeq = Math.max(...valid.map((b) => b.endSeq))
  return {
    ok: true,
    range: { startSeq, endSeq },
    summaries: valid.map((b) => ({ startSeq: b.startSeq, endSeq: b.endSeq, text: b.text })),
  }
}

// ---------------------------------------------------------------------------
// Tool runtime contract (the plugin provides the structural host handles).
// ---------------------------------------------------------------------------

/** Structural logger subset used by the tools/plugin. */
export interface LoggerLike {
  info?(message: string): void
  warn?(message: string): void
  error?(message: string): void
}

/** Structural tokenMeter subset used by the status/nudge faces. */
export interface TokenMeterLike {
  measure(session: SessionLike): {
    readonly totalTokens: number
    /**
     * Official TokenMeasurement surface nodes pass-through (additive, V3;
     * token-meter/src/types.ts:31-56): the route-priced per-node projection
     * the meter-anchor interface sums for the `meterAnchored` semi path.
     * Undefined when the host meter predates the node projection — the
     * anchor then honestly reports unavailability.
     */
    readonly nodes?: readonly { readonly seq: number; readonly tokens: number }[]
  }
}

/** Structural llm runtime subset used by the status/window resolution. */
export interface LlmRuntimeLike {
  resolveModelInfo(provider: string, model: string, signal?: AbortSignal): Promise<{
    context?: { contextWindow?: number }
    defaultMaxTokens?: number
    /**
     * Official ModelInfo pass-through (llm/src/index.ts:180) consumed by the
     * observe listener's projection gating (v0.2.0 V2); undefined = unknown
     * modalities → image projection honestly skipped.
     */
    inputModalities?: readonly string[]
    /** Official ModelInfo pass-through (llm/src/index.ts:184); undefined = unsupported route. */
    toolUpdate?: 'in-history' | 'addition-only'
  }>
}

/**
 * Structural session extended with the routed-request header the status face
 * reads for the provider/model route (non-deprecated official getter).
 */
export type RoutedSessionLike = SessionLike & {
  requestHeader?(): {
    readonly config?: {
      readonly provider?: string
      readonly model?: string
      readonly maxTokens?: number
    }
  } | undefined
}

/** Everything the four tools (and the /zctx command) need from the host. */
export interface ZctxToolRuntime {
  readonly logger?: LoggerLike
  readonly tokenMeter?: TokenMeterLike
  readonly llm?: LlmRuntimeLike
  /**
   * Config cleanSampleFloor (V3 status gate, §Q7.3 诚实纪律): the renderer
   * withholds repay conclusions when the clean-sample ratio falls below it.
   * Config-owned value — never hardcoded here.
   */
  readonly cleanSampleFloor: number
  /** Per-session store registry (lazy create + attach, feed-maintained). */
  storeFor(session: SessionLike): FoldStore
  /** Validator config resolved for this session (window from cache when known). */
  validatorConfig(session: SessionLike): ValidatorConfig
}

/**
 * Read the routed provider/model off a session's request header (the official
 * routedTarget shape; undefined before the first routed request).
 */
export function routedRequestTarget(
  session: RoutedSessionLike,
): { provider: string; model: string } | undefined {
  let header
  try {
    header = session.requestHeader?.()
  } catch {
    return undefined
  }
  const config = header?.config
  if (config === undefined) return undefined
  const provider = config.provider
  const model = config.model
  if (typeof provider !== 'string' || provider.length === 0) return undefined
  if (typeof model !== 'string' || model.length === 0) return undefined
  return { provider, model }
}

// ---------------------------------------------------------------------------
// Status rendering (shared by zctx_status and the /zctx command).
// ---------------------------------------------------------------------------

/** Recent-fold rows shown in the observability segment (compact by design). */
const RECENT_FOLD_ROWS = 3

/**
 * Render the full status report. Every host face is capability-probed and
 * degraded rows are collected honestly (S6: cache accounting carries the
 * measured/estimated split; CCM §1.1: windows below 32768 render the
 * below-domain note with tools still usable).
 */
export async function renderStatus(runtime: ZctxToolRuntime, session: SessionLike): Promise<string> {
  const lines: string[] = []
  const degraded: string[] = []
  const store = runtime.storeFor(session)
  const routedSession = session as RoutedSessionLike

  // ---- window + budget ------------------------------------------------------
  let contextWindow: number | undefined
  let maxOutput: number | undefined
  const routed = routedRequestTarget(routedSession)
  if (routed === undefined) {
    degraded.push('no routed provider/model yet (request header pending)')
  } else if (runtime.llm === undefined || typeof runtime.llm.resolveModelInfo !== 'function') {
    degraded.push('llm service unavailable: context window unknown')
  } else {
    try {
      const info = await runtime.llm.resolveModelInfo(routed.provider, routed.model)
      const window = info?.context?.contextWindow
      if (typeof window === 'number' && Number.isFinite(window) && window > 0) {
        contextWindow = window
      } else {
        degraded.push(`model ${routed.provider}/${routed.model} declares no context capacity`)
      }
      if (typeof info?.defaultMaxTokens === 'number' && info.defaultMaxTokens > 0) {
        maxOutput = info.defaultMaxTokens
      }
    } catch (error: unknown) {
      degraded.push(`llm model info failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  const configuredMax = routedSession.requestHeader?.()?.config?.maxTokens
  if (typeof configuredMax === 'number' && configuredMax > 0) maxOutput = configuredMax

  let totalTokens: number | undefined
  if (runtime.tokenMeter === undefined || typeof runtime.tokenMeter.measure !== 'function') {
    degraded.push(STATUS_METER_UNAVAILABLE)
  } else {
    try {
      totalTokens = runtime.tokenMeter.measure(session).totalTokens
    } catch (error: unknown) {
      degraded.push(`token meter failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  let budget: ReturnType<typeof computeBudget> | undefined
  if (contextWindow !== undefined) {
    const gate = ccmWindowGate(contextWindow)
    if (!gate.legal && gate.note !== undefined) {
      lines.push(fill(STATUS_CCM_BELOW_DOMAIN, { window: contextWindow }))
    }
    try {
      budget = computeBudget({ contextWindow, ...(maxOutput !== undefined ? { maxOutput } : {}) })
    } catch (error: unknown) {
      degraded.push(`budget computation failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  if (contextWindow !== undefined && totalTokens !== undefined && budget !== undefined) {
    lines.push(
      fill(STATUS_WINDOW_LINE, {
        tokens: totalTokens,
        pct: formatPct((totalTokens / contextWindow) * 100),
        window: contextWindow,
        trigger: budget.triggerLine,
        triggerPct: formatPct((budget.triggerLine / contextWindow) * 100),
      }),
    )
    lines.push(STATUS_BUDGET_HEADER)
    for (const [label, value] of [
      ['max output cap', budget.maxOutputCap],
      ['reserve', budget.reserve],
      ['pessimistic reserve', budget.pessimisticReserve],
      ['keep-recent', budget.keepRecent],
      ['summary input cap', budget.summaryInputCap],
      ['reply cap', budget.replyCap],
    ] as const) {
      lines.push(fill(STATUS_BUDGET_ROW, { label, tokens: value }))
    }
    lines.push(fill(STATUS_FIXED_WIRE_ROW, { tokens: budget.fixedWireOverhead }))
  } else {
    lines.push(STATUS_WINDOW_UNKNOWN)
  }

  // ---- foldable range map ----------------------------------------------------
  lines.push(STATUS_RANGES_HEADER)
  const ranges = foldableRanges(store.surfaceNodes(), runtime.validatorConfig(session))
  if (ranges.length === 0) {
    lines.push('  (empty surface)')
  } else {
    for (const range of ranges) {
      let row = fill(NUDGE_RANGE_ROW, {
        start: range.startSeq,
        end: range.endSeq,
        tokens: range.estimatedTokens,
      })
      if (range.protected) {
        row += NUDGE_PROTECTED_MARKER
        if (range.protectedReason !== undefined) {
          row += `${NUDGE_PROTECTED_REASON_PREFIX}${range.protectedReason}${NUDGE_PROTECTED_REASON_SUFFIX}`
        }
      }
      lines.push(row)
    }
  }

  // ---- fold ledger + anomalies ------------------------------------------------
  const entries = store.ledgerEntries()
  const activeCount = [...store.foldMap.keys()].length
  lines.push(fill(STATUS_FOLDS_HEADER, { count: activeCount }))
  if (entries.length === 0) {
    lines.push(STATUS_FOLDS_EMPTY)
  } else {
    for (const entry of entries) {
      lines.push(
        fill(STATUS_FOLD_ROW, {
          foldId: `${entry.foldId} [${entry.status}]`,
          start: entry.startSeq,
          end: entry.endSeq,
          seq: entry.checkpointSeq,
          before: entry.tokensBefore,
          after: entry.tokensAfter,
        }),
      )
    }
  }
  const anomalies = store.anomalies()
  if (anomalies.length === 0) {
    lines.push(STATUS_ANOMALIES_EMPTY)
  } else {
    lines.push(fill(STATUS_ANOMALIES_HEADER, { count: anomalies.length }))
    for (const anomaly of anomalies) {
      lines.push(fill(STATUS_ANOMALY_ROW, { kind: anomaly.kind, detail: anomaly.detail }))
    }
  }

  // ---- cache accounting (S6 measured/estimated split) -------------------------
  const usage = store.usageSnapshot()
  if (usage.samples === 0) {
    lines.push(STATUS_USAGE_NONE)
  } else if (usage.measured && usage.latest?.measured === true) {
    lines.push(
      fill(STATUS_USAGE_MEASURED, {
        samples: usage.samples,
        plural: usage.samples === 1 ? '' : 's',
        read: usage.latest.cacheReadTokens ?? 'n/a',
        write: usage.latest.cacheWriteTokens ?? 'n/a',
      }),
    )
  } else {
    lines.push(
      fill(STATUS_USAGE_ESTIMATED, { samples: usage.samples, plural: usage.samples === 1 ? '' : 's' }),
    )
  }

  // ---- observability (V3 three-segment upgrade; RES-observe-route §Q7.3) ------
  // Segment 1 (session summary): folds / repaid / recovery / three-state pct.
  // Segment 2 (repay conclusions): the breakeven table, OR the honest
  // degradation note when the clean-sample ratio sits below the config floor —
  // "归因可信度不足" withholds the repay conclusions, never a low-confidence
  // claim. Segment 3 (recent folds with attribution quality) + segment 4
  // (reset ledger digest) are facts, not conclusions, and always render.
  const snapshot = store.observabilitySnapshot()
  const attributionByFold = new Map<string, FoldUsageAttribution>()
  for (const attribution of store.foldAttributions()) attributionByFold.set(attribution.foldId, attribution)
  // An empty fold ledger has no evidence to judge — the honest shape is the
  // empty note, not a confidence verdict about folds that never existed.
  const emptyLedger = entries.length === 0
  const confidenceOk = snapshot.cleanSampleRatio >= runtime.cleanSampleFloor
  const repaidText = !emptyLedger && !confidenceOk
    ? STATUS_OBS_SESSION_REPAID_WITHHELD
    : String(snapshot.breakevenTable.filter((row) => row.repaid === true).length)
  const totalBefore = entries.reduce((sum, entry) => sum + entry.tokensBefore, 0)
  const totalNet = entries.reduce((sum, entry) => sum + (entry.tokensBefore - entry.tokensAfter), 0)
  lines.push(STATUS_OBS_HEADER)
  lines.push(
    fill(STATUS_OBS_SESSION_LINE, {
      folds: entries.length,
      repaid: repaidText,
      recoveryPct: totalBefore > 0 ? formatPct((totalNet / totalBefore) * 100) : 'n/a',
    }),
  )
  const threeTotal = snapshot.threeState.measured + snapshot.threeState.semi + snapshot.threeState.estimated
  if (threeTotal === 0) {
    lines.push(STATUS_OBS_NO_SAMPLES)
  } else {
    lines.push(
      fill(STATUS_OBS_THREE_STATE, {
        measuredPct: formatPct((snapshot.threeState.measured / threeTotal) * 100),
        semiPct: formatPct((snapshot.threeState.semi / threeTotal) * 100),
        estimatedPct: formatPct((snapshot.threeState.estimated / threeTotal) * 100),
        total: threeTotal,
        plural: threeTotal === 1 ? '' : 's',
      }),
    )
  }
  // Segment 2: repay conclusions behind the confidence gate.
  if (emptyLedger) {
    lines.push(STATUS_OBS_BREAKEVEN_HEADER)
    lines.push(STATUS_OBS_BREAKEVEN_EMPTY)
  } else if (!confidenceOk) {
    lines.push(
      fill(STATUS_OBS_CONFIDENCE_INSUFFICIENT, {
        ratioPct: formatPct(snapshot.cleanSampleRatio * 100),
        floorPct: formatPct(runtime.cleanSampleFloor * 100),
      }),
    )
  } else {
    lines.push(STATUS_OBS_BREAKEVEN_HEADER)
    if (snapshot.breakevenTable.length === 0) {
      lines.push(STATUS_OBS_BREAKEVEN_EMPTY)
    } else {
      for (const row of snapshot.breakevenTable) {
        const repaidMark =
          row.repaid === true ? fill(STATUS_OBS_REPAID_MARK, { seq: row.repayEventSeq ?? 0 }) : ''
        lines.push(
          fill(STATUS_OBS_BREAKEVEN_ROW, {
            foldId: row.foldId,
            turns: row.breakevenTurns === Number.POSITIVE_INFINITY ? 'never' : formatPct(row.breakevenTurns),
            quality: row.quality,
            repaidMark,
          }),
        )
      }
    }
  }
  // Segment 3: recent folds with attribution quality (+ noise markers).
  lines.push(STATUS_OBS_RECENT_HEADER)
  if (entries.length === 0) {
    lines.push(STATUS_OBS_RECENT_EMPTY)
  } else {
    for (const entry of entries.slice(-RECENT_FOLD_ROWS).reverse()) {
      const attribution = attributionByFold.get(entry.foldId)
      const retryPart =
        attribution !== undefined && attribution.retryCount > 0
          ? fill(STATUS_OBS_RETRY_PART, { count: attribution.retryCount })
          : ''
      const flags =
        (attribution?.timeWindow === true ? STATUS_OBS_FLAG_TIME_WINDOW : '')
        + (attribution?.interrupted === true ? STATUS_OBS_FLAG_INTERRUPTED : '')
      lines.push(
        fill(STATUS_OBS_RECENT_ROW, {
          foldId: entry.foldId,
          status: entry.status,
          seq: entry.checkpointSeq,
          quality: attribution?.quality ?? 'unattributed',
          retryPart,
          flags,
        }),
      )
    }
  }
  // Segment 4: reset ledger digest (V1 ResetEvent classification counts).
  lines.push(STATUS_OBS_RESET_HEADER)
  if (snapshot.resetSummary.length === 0) {
    lines.push(STATUS_OBS_RESET_EMPTY)
  } else {
    for (const row of snapshot.resetSummary) {
      lines.push(fill(STATUS_OBS_RESET_ROW, { kind: row.kind, count: row.count }))
    }
  }

  // ---- degraded rows first-class ----------------------------------------------
  if (degraded.length > 0) {
    lines.push(STATUS_PARTIAL_PREFIX)
    for (const item of degraded) lines.push(fill(STATUS_DEGRADED_ROW, { detail: item }))
  }
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Tool builder.
// ---------------------------------------------------------------------------

/**
 * Build the four registry-ready zctx tool definitions through the given
 * defineTool implementation (host's official one, or the fail-soft shim).
 */
export function buildZctxTools(
  defineTool: DefineToolFn,
  runtime: ZctxToolRuntime,
): ZctxToolDefinition[] {
  const textOutput = {
    schema: { type: 'string' } as const,
    render: (_args: unknown, value: string) => [{ type: 'text' as const, text: value }],
  }

  const foldTool = defineTool({
    name: 'zctx_fold',
    description:
      'Fold finished stretches of the conversation: replace one or more seq ranges with short summaries you write. '
      + 'content = ONE plain string carrying ALL ranges — each block starts with a "fold <startSeq>..<endSeq> [topic]" '
      + 'header line followed by that block\'s markdown summary (a JSON array of {startRef, endRef, summary} objects is '
      + 'also accepted). Batch ALL ranges into ONE call — the batch commits atomically or is rejected as a whole with reasons. '
      + 'Get exact ranges and pressure from zctx_status first.',
    parameters: {
      content: {
        type: 'string',
        required: true,
        description: 'All fold blocks in one string: "fold <startSeq>..<endSeq>" header line + markdown summary per block, or a JSON array of {startRef, endRef, summary}.',
      },
    },
    output: textOutput,
    async execute(args, exec) {
      // The engine commits through the writable-session contract; the official
      // Session satisfies it (asserted again at the engine boundary).
      const session = exec?.agent?.session as FoldSessionLike | undefined
      if (session === undefined) return STATUS_NO_SESSION
      const parsed = parseFoldContent(args.content)
      if (!parsed.ok) return parsed.reason
      const store = runtime.storeFor(session)
      const result = fold(session, store, parsed, runtime.validatorConfig(session))
      return renderFoldReply(result)
    },
  })

  const unfoldTool = defineTool({
    name: 'zctx_unfold',
    description:
      'Re-materialize one folded range back onto the surface in place of its checkpoint. Without arguments, '
      + 'the most recent active fold is unfolded. Use when the folded content is needed again in full.',
    parameters: {
      foldId: { type: 'string', description: 'Fold id to unfold (from zctx_status); omit to unfold the latest active fold.' },
    },
    output: textOutput,
    async execute(args, exec) {
      const session = exec?.agent?.session as FoldSessionLike | undefined
      if (session === undefined) return STATUS_NO_SESSION
      const store = runtime.storeFor(session)
      // Explicit id → honest per-id answer even when the ledger is empty.
      let foldId: string | undefined
      if (typeof args.foldId === 'string' && args.foldId.length > 0) {
        if (!store.foldMap.has(args.foldId)) {
          return `no active fold matches foldId ${args.foldId}`
        }
        foldId = args.foldId
      } else {
        foldId = resolveUnfoldTarget(store)
        if (foldId === undefined) return REASON_NO_ACTIVE_FOLDS
      }
      const result = unfold(session, store, foldId)
      return renderUnfoldReply(foldId, result)
    },
  })

  const recallTool = defineTool({
    name: 'zctx_recall',
    description:
      'Search inside everything already folded (summaries and folded-away originals). Returns ranked hits with '
      + 'context excerpts and the owning fold id, so folded history stays reachable without unfolding.',
    parameters: {
      query: {
        type: 'string',
        required: true,
        description: 'Whitespace-separated keywords (case-insensitive).',
      },
      limit: { type: 'number', description: 'Maximum hits (default 5).' },
    },
    output: textOutput,
    async execute(args, exec) {
      const session = exec?.agent?.session
      if (session === undefined) return STATUS_NO_SESSION
      const store = runtime.storeFor(session)
      if (typeof args.query !== 'string') return 'invalid arguments: query: expected string'
      const limit = typeof args.limit === 'number' && Number.isFinite(args.limit) && args.limit >= 0
        ? Math.floor(args.limit)
        : DEFAULT_RECALL_LIMIT
      const corpus = buildRecallCorpus(store)
      const hits = recall(args.query, corpus, limit)
      if (hits.length === 0) return fill(RECALL_REPLY_EMPTY, { query: args.query })
      const lines = [
        fill(RECALL_REPLY_HEADER, { query: args.query, count: hits.length, total: corpus.length }),
      ]
      for (const hit of hits) {
        lines.push(
          fill(RECALL_REPLY_ROW, {
            kind: hit.kind,
            foldId: hit.foldId,
            start: hit.range.startSeq,
            end: hit.range.endSeq,
            score: hit.score,
            excerpt: hit.excerpt,
          }),
        )
      }
      return lines.join('\n')
    },
  })

  const statusTool = defineTool({
    name: 'zctx_status',
    description:
      'The trusted ledger for context pressure and folding: window occupancy vs the fold trigger line, budget '      + 'breakdown, foldable ranges (PROTECTED marks), active folds, anomalies, and cache usage (measured or estimated). '
      + 'Never reconstruct these numbers from memory.',
    parameters: {},
    output: textOutput,
    async execute(_args, exec) {
      const session = exec?.agent?.session
      if (session === undefined) return STATUS_NO_SESSION
      return renderStatus(runtime, session)
    },
  })

  return [foldTool, unfoldTool, recallTool, statusTool]
}

/** Newest active fold id (checkpointSeq order). @internal */
function resolveUnfoldTarget(store: FoldStore): string | undefined {
  let best: { foldId: string; checkpointSeq: number } | undefined
  for (const [id, record] of store.foldMap) {
    if (best === undefined || record.checkpointSeq > best.checkpointSeq) {
      best = { foldId: id, checkpointSeq: record.checkpointSeq }
    }
  }
  return best?.foldId
}

/** Build the recall corpus: summaries + folded-away originals. @internal */
function buildRecallCorpus(store: FoldStore): RecallEntry[] {
  const corpus: RecallEntry[] = []
  for (const record of store.foldMap.values()) {
    corpus.push({
      foldId: record.foldId,
      kind: 'summary',
      text: record.summaryText,
      range: { startSeq: record.startSeq, endSeq: record.endSeq },
    })
    for (let seq = record.startSeq; seq <= record.endSeq; seq += 1) {
      const text = store.eventText(seq)
      if (text.length === 0) continue
      corpus.push({
        foldId: record.foldId,
        kind: 'original',
        text,
        range: { startSeq: seq, endSeq: seq },
      })
    }
  }
  return corpus
}

/** One-decimal percentage formatting (mirrors nudge formatting). @internal */
function formatPct(value: number): string {
  return (Math.round(value * 10) / 10).toFixed(1)
}
