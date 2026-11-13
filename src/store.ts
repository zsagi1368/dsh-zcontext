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

import { buildObservabilitySnapshot, classifyFoldAttribution } from './attribution.ts'
import { estimateTokens } from './budget.ts'
import { configDefaults } from './config.ts'
import type {
  CapturedAttemptUsage,
  FoldMap,
  FoldRecord,
  FoldUsageAttribution,
  LlmCallConfigLike,
  MeterAnchorLike,
  ObservabilitySnapshot,
  PreflightCalibrationRecord,
  PrefixBreakRecord,
  RequestSnapshot,
  ResetEvent,
  ResetEventKind,
  RouteHeader,
  SessionEventLike,
  WireSnapshot,
  SessionLike,
  SurfaceNode,
  UsageRecord,
  UsageSample,
} from './types.ts'

// UsageSample moved to types.ts in V1 (UsageRecord extends it there without a
// types→store cycle); re-exported here so the W3 public surface
// (index.ts `export type { UsageSample } from './store.ts'`) is unchanged.
export type { UsageSample } from './types.ts'

/** Message-producing event types (official session/src/types.ts:439-444). */
const MESSAGE_EVENT_TYPES: ReadonlySet<string> = new Set([
  'system/message',
  'developer/message',
  'user/message',
  'assistant/message',
  'tool/result',
])

/** Role mapping for surface event types. */
const ROLE_BY_TYPE: Readonly<Record<string, SurfaceNode['role']>> = {
  'system/message': 'system',
  'developer/message': 'developer',
  'user/message': 'user',
  'assistant/message': 'assistant',
  'tool/result': 'tool',
}

/** Status of one fold ledger entry. */
export type FoldLedgerStatus = 'active' | 'unfolded' | 'absorbed' | 'dead'

/** One committed fold, as tracked by the store ledger. */
export interface FoldLedgerEntry extends FoldRecord {
  /** Lifecycle status derived from later log events. */
  readonly status: FoldLedgerStatus
  /** For absorbed/dead entries: seq of the replace event that shadowed the checkpoint. */
  readonly shadowedBySeq?: number
  /** For absorbed/dead entries: the producing source kind that shadowed the checkpoint. */
  readonly shadowedByKind?: string
}

/** Aggregate usage state of the session (S6; consumed by zctx_status). */
export interface UsageSnapshot {
  /** Samples kept in the bounded ledger. */
  readonly samples: number
  /** Total measured samples seen over the session lifetime. */
  readonly measuredSamples: number
  /** Total assistant/message events observed without a usable usage object. */
  readonly unmeasuredSamples: number
  /** True when at least one measured sample exists (latest-sample semantics drive status). */
  readonly measured: boolean
  /** The most recent sample, when any. */
  readonly latest?: UsageSample
}

/** One anomaly recorded by the engine or the store (honest ledger, no throwing). */
export interface StoreAnomaly {
  /** Related seq, when the anomaly maps to one event. */
  readonly seq?: number
  /** Stable anomaly kind, e.g. 'unreadable-event'. */
  readonly kind: string
  /** Human-readable detail. */
  readonly detail: string
}

/** Bounded cap for the usage ledger (oldest samples are dropped). */
const USAGE_LEDGER_CAP = 64

/** Bounded cap for the anomaly ledger (oldest entries are dropped). */
const ANOMALY_LEDGER_CAP = 256

/** Bounded cap for the in-process snapshot ledger (V2 receive port). */
const SNAPSHOT_LEDGER_CAP = 64

/** Bounded cap for the in-process prefix-break ledger (V2 receive port). */
const BREAK_LEDGER_CAP = 64

/** Bounded cap for the non-durable captured-attempt-usage ledger (V2 receive port). */
const CAPTURE_LEDGER_CAP = 64

/** Bounded cap for the wire-domain ledger (V5 receive port, same 64-cap design). */
const WIRE_LEDGER_CAP = 64

/** Bounded cap for the S1 preflight calibration ledger (V4 receive port, same 64-cap design). */
const PREFLIGHT_CALIBRATION_CAP = 64

/**
 * Bounded cap for the request/header chain (V1-B closure, R3 review: the
 * chain was session-unbounded while every other ledger is capped). Same
 * bounded design as the V2 64-cap ledgers; only the LAST header feeds the
 * `change` comparison, and the chain digest reads the most recent 64 — older
 * headers drop honestly at the cap. The observe listener's exemption window
 * consumes resets by SEQ pointer (not index), so the resetLog cap below
 * never mis-aligns it.
 */
const ROUTE_HEADER_LEDGER_CAP = 64

/** Bounded cap for the cache-reset ledger (V1-B closure, same 64-cap design). */
const RESET_LEDGER_CAP = 64

/** Narrow an unknown to a plain object record (V3 helpers' guard). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object'
}

/** The value as a finite number, else undefined (honest absence). */
function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/**
 * Pull the message object out of an event's data payload. Structural twin of
 * the extractor in materialize.ts (kept local so the W2 pure core stays
 * untouched): tolerates the `{ turn, message }` envelope and bare
 * message-shaped payloads.
 */
function extractMessage(data: unknown): Record<string, unknown> | undefined {
  if (data === null || typeof data !== 'object') return undefined
  const record = data as Record<string, unknown>
  if (record.message !== null && typeof record.message === 'object') {
    return record.message as Record<string, unknown>
  }
  if (record.content !== undefined) return record
  return undefined
}

/** Join the text blocks of a message payload (string content tolerated). */
function extractMessageText(data: unknown): string {
  const message = extractMessage(data)
  if (message === undefined) return ''
  const content = message.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const block of content) {
    if (block !== null && typeof block === 'object') {
      const candidate = block as Record<string, unknown>
      if (candidate.type === 'text' && typeof candidate.text === 'string') {
        parts.push(candidate.text)
      }
    }
  }
  return parts.join('\n')
}

/** Provider-issued tool-call ids embedded in an assistant message. */
function extractToolCallIds(data: unknown): string[] {
  const message = extractMessage(data)
  if (message === undefined || !Array.isArray(message.content)) return []
  const ids: string[] = []
  for (const block of message.content) {
    if (block !== null && typeof block === 'object') {
      const candidate = block as Record<string, unknown>
      if (candidate.type === 'tool-call' && typeof candidate.id === 'string') {
        ids.push(candidate.id)
      }
    }
  }
  return ids
}

/** Tool-result pairing: the assistant call id this result answers. */
function extractAnswersCallId(data: unknown): string | undefined {
  const message = extractMessage(data)
  if (message === undefined) return undefined
  if (typeof message.toolCallId === 'string') return message.toolCallId
  const source = message.source
  if (source !== null && typeof source === 'object') {
    const callId = (source as Record<string, unknown>).callId
    if (typeof callId === 'string') return callId
  }
  return undefined
}

/** message.source?.kind of a message event, when present. */
function extractSourceKind(data: unknown): string | undefined {
  const message = extractMessage(data)
  if (message === undefined) return undefined
  const source = message.source
  if (source !== null && typeof source === 'object') {
    const kind = (source as Record<string, unknown>).kind
    if (typeof kind === 'string') return kind
  }
  return undefined
}

/** Extract the frozen checkpoint payload of a zctx fold/unfold event. */
function extractCheckpointSource(
  data: unknown,
): { kind: string; foldId: string; tokensBefore?: number; tokensAfter?: number } | undefined {
  const kind = extractSourceKind(data)
  if (kind !== 'zctx-fold' && kind !== 'zctx-unfold') return undefined
  const message = extractMessage(data)
  const source = message?.source
  if (source === null || typeof source !== 'object') return undefined
  const record = source as Record<string, unknown>
  const foldId = record.foldId
  if (typeof foldId !== 'string') return undefined
  const tokensBefore = typeof record.tokensBefore === 'number' ? record.tokensBefore : undefined
  const tokensAfter = typeof record.tokensAfter === 'number' ? record.tokensAfter : undefined
  return {
    kind,
    foldId,
    ...(tokensBefore !== undefined ? { tokensBefore } : {}),
    ...(tokensAfter !== undefined ? { tokensAfter } : {}),
  }
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
function extractUsageRecord(data: unknown, seq: number): UsageRecord {
  if (data !== null && typeof data === 'object') {
    const usage = (data as Record<string, unknown>).usage
    if (usage !== null && typeof usage === 'object') {
      const record = usage as Record<string, unknown>
      const read = record.cacheReadTokens
      const write = record.cacheWriteTokens
      const input = record.inputTokens
      const output = record.outputTokens
      const total = record.totalTokens
      return {
        seq,
        measured: true,
        state: 'measured',
        ...(typeof input === 'number' && Number.isFinite(input) ? { inputTokens: input } : {}),
        ...(typeof output === 'number' && Number.isFinite(output) ? { outputTokens: output } : {}),
        ...(typeof total === 'number' && Number.isFinite(total) ? { totalTokens: total } : {}),
        ...(typeof read === 'number' && Number.isFinite(read) ? { cacheReadTokens: read } : {}),
        ...(typeof write === 'number' && Number.isFinite(write) ? { cacheWriteTokens: write } : {}),
      }
    }
  }
  return { seq, measured: false, state: 'estimated' }
}

/**
 * Element-wise `stop` list equality (the tail of the official callConfigEquals,
 * call-config.ts:75-77): undefined equals only undefined, otherwise length +
 * every element.
 */
function stopEquals(a: readonly string[] | undefined, b: readonly string[] | undefined): boolean {
  if (a === undefined || b === undefined) return a === b
  return a.length === b.length && a.every((s, i) => s === b[i])
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
 */
function callConfigEquals(a: LlmCallConfigLike, b: LlmCallConfigLike): boolean {
  return (
    a.provider === b.provider
    && a.model === b.model
    && a.reasoningEffort === b.reasoningEffort
    && a.temperature === b.temperature
    && a.maxTokens === b.maxTokens
    && stopEquals(a.stop, b.stop)
  )
}

/** Render one optional config scalar for evidence text ('' when absent). */
function configScalarText(value: string | number | undefined): string {
  return value === undefined ? '(absent)' : String(value)
}

/** Key-sorted structural clone for deterministic JSON comparison (the V1
 * local twin of the stableStringify the V2 hash件 builds; compare-only). */
function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => stableValue(entry))
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(record).sort()) out[key] = stableValue(record[key])
    return out
  }
  return value
}

/** Deterministic structural comparison of two tool-schema arrays. */
function toolsEquals(a: readonly unknown[] | undefined, b: readonly unknown[] | undefined): boolean {
  if (a === undefined || b === undefined) return a === b
  if (a.length !== b.length) return false
  return JSON.stringify(stableValue(a)) === JSON.stringify(stableValue(b))
}

/** Extract the call config of a request/header payload (LlmCallConfig shape,
 * call-config.ts:36-41). provider/model are required strings; everything
 * else degrades to absent when malformed. */
function extractCallConfig(value: unknown): LlmCallConfigLike | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  if (typeof record.provider !== 'string' || typeof record.model !== 'string') return undefined
  return {
    provider: record.provider,
    model: record.model,
    ...(typeof record.reasoningEffort === 'string' ? { reasoningEffort: record.reasoningEffort } : {}),
    ...(typeof record.temperature === 'number' && Number.isFinite(record.temperature)
      ? { temperature: record.temperature }
      : {}),
    ...(typeof record.maxTokens === 'number' && Number.isFinite(record.maxTokens)
      ? { maxTokens: record.maxTokens }
      : {}),
    ...(Array.isArray(record.stop) && record.stop.every((s) => typeof s === 'string')
      ? { stop: record.stop as string[] }
      : {}),
  }
}

/** Extract the adapter-defaults marker object (call-config.ts:55-60). */
function extractAdapterDefaults(value: unknown): { reasoningEffort?: true; maxTokens?: true } | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  const reasoningEffort = record.reasoningEffort === true ? true : undefined
  const maxTokens = record.maxTokens === true ? true : undefined
  if (reasoningEffort === undefined && maxTokens === undefined) return undefined
  return {
    ...(reasoningEffort !== undefined ? { reasoningEffort } : {}),
    ...(maxTokens !== undefined ? { maxTokens } : {}),
  }
}

/**
 * Extract one RouteHeader from a request/header payload (official
 * session/src/types.ts:388-395 + EpochHeader :270-281). Returns undefined
 * when the structural minimum (config with provider/model + a known reason)
 * is not met — the caller records an anomaly instead of guessing.
 */
function extractRequestHeader(data: unknown, seq: number): RouteHeader | undefined {
  if (data === null || typeof data !== 'object') return undefined
  const record = data as Record<string, unknown>
  const header = record.header
  if (header === null || typeof header !== 'object') return undefined
  const headerRecord = header as Record<string, unknown>
  const config = extractCallConfig(headerRecord.config)
  if (config === undefined) return undefined
  const reason = record.reason
  if (reason !== 'initial' && reason !== 'resume' && reason !== 'change' && reason !== 'series') {
    return undefined
  }
  const adapterDefaults = extractAdapterDefaults(headerRecord.adapterDefaults)
  const tools = Array.isArray(headerRecord.tools) ? headerRecord.tools : undefined
  const startsSeries = record.startsSeries === true ? true : undefined
  return {
    config,
    ...(adapterDefaults !== undefined ? { adapterDefaults } : {}),
    ...(tools !== undefined ? { tools } : {}),
    reason,
    ...(startsSeries !== undefined ? { startsSeries } : {}),
    seq,
  }
}

/**
 * Field-level comparison of a 'change' header against its predecessor — the
 * V1 reset classification the card freezes (a.2 item 1: callConfigEquals
 * 字段级对比 → modelChange/toolsetChange/采样变更类 ResetEvent). One entry per
 * DIFFERING CATEGORY (routing / toolset / sampling), evidence names the
 * changed fields. The tools comparison is structural (sorted-key JSON), the
 * config comparison is the local callConfigEquals twin.
 */
function headerChangeResets(
  prev: RouteHeader,
  next: RouteHeader,
): readonly { kind: ResetEventKind; evidence: string }[] {
  const resets: { kind: ResetEventKind; evidence: string }[] = []
  if (!callConfigEquals(prev.config, next.config)) {
    const routing: string[] = []
    const sampling: string[] = []
    const a = prev.config
    const b = next.config
    if (a.provider !== b.provider) routing.push(`provider ${a.provider}→${b.provider}`)
    if (a.model !== b.model) routing.push(`model ${a.model}→${b.model}`)
    if (a.reasoningEffort !== b.reasoningEffort) {
      routing.push(`reasoningEffort ${configScalarText(a.reasoningEffort)}→${configScalarText(b.reasoningEffort)}`)
    }
    if (a.temperature !== b.temperature) {
      sampling.push(`temperature ${configScalarText(a.temperature)}→${configScalarText(b.temperature)}`)
    }
    if (a.maxTokens !== b.maxTokens) {
      sampling.push(`maxTokens ${configScalarText(a.maxTokens)}→${configScalarText(b.maxTokens)}`)
    }
    if (!stopEquals(a.stop, b.stop)) {
      sampling.push(`stop ${JSON.stringify(a.stop ?? null)}→${JSON.stringify(b.stop ?? null)}`)
    }
    if (routing.length > 0) {
      resets.push({ kind: 'model-change', evidence: `request/header change: ${routing.join('; ')}` })
    }
    if (sampling.length > 0) {
      resets.push({ kind: 'sampling-change', evidence: `request/header change: ${sampling.join('; ')}` })
    }
  }
  if (!toolsEquals(prev.tools, next.tools)) {
    const prevCount = prev.tools === undefined ? 'none' : String(prev.tools.length)
    const nextCount = next.tools === undefined ? 'none' : String(next.tools.length)
    resets.push({
      kind: 'toolset-change',
      evidence: `request/header change: tools schema diff (${prevCount}→${nextCount} schemas)`,
    })
  }
  return resets
}

/**
 * Session-log-derived state for ONE session: fold ledger, usage ledger,
 * retained events, surface view, and compaction mutex state.
 *
 * Lifecycle: `attach(session)` scans once and binds; afterwards the host feed
 * delivers events via `onEvent(session, event)`; `resync()` repairs feed gaps.
 * Events of a different session are ignored (the store is single-session).
 */
export class FoldStore {
  private session: SessionLike | undefined
  private readonly eventsBySeq = new Map<number, SessionEventLike>()
  private readonly ledger = new Map<string, FoldLedgerEntry>()
  /** Bounded usage-record ledger (V1 UsageRecord; oldest dropped at cap). */
  private readonly usageLedger: UsageRecord[] = []
  private measuredSamples = 0
  private unmeasuredSamples = 0
  /** Append-only request/header chain (oldest first). */
  private readonly routeHeaders: RouteHeader[] = []
  /** Append-only cache-reset ledger (oldest first). */
  private readonly resetLog: ResetEvent[] = []
  /** Bounded process-memory snapshot ledger (V2 receive port; never session-logged). */
  private readonly snapshotLog: RequestSnapshot[] = []
  /** Bounded process-memory prefix-break ledger (V2 receive port; never session-logged). */
  private readonly breakLog: PrefixBreakRecord[] = []
  /** Bounded non-durable captured-attempt-usage ledger (V2 receive port; never session-logged). */
  private readonly captureLog: CapturedAttemptUsage[] = []
  /** Bounded wire-domain ledger (V5 receive port, same 64-cap design; never session-logged). */
  private readonly wireLog: WireSnapshot[] = []
  /** Bounded S1 preflight calibration ledger (V4 receive port; never session-logged). */
  private readonly preflightLog: PreflightCalibrationRecord[] = []
  private readonly anomaliesLog: StoreAnomaly[] = []
  // -- V3 attribution engine state (§Q4.2; incremental inside applyEvent) ---
  /** Fold-attribution ledger: foldId → its first-post-fold association (any quality). */
  private readonly foldAttributionLog = new Map<string, FoldUsageAttribution>()
  /** Ascending seqs of every consumed event (window binary-search index). */
  private readonly eventSeqList: number[] = []
  /** Ascending seqs of assistant/message events (repay-event detection input). */
  private readonly assistantMessageSeqs: number[] = []
  /** Parallel arrays of turn/start markers (seqs + the turn they opened). */
  private readonly turnStartSeqs: number[] = []
  private readonly turnStartTurns: number[] = []
  /** Seq of the previous assistant/message (attribution candidate boundary). */
  private lastAssistantMessageSeq = -1
  /** Lifetime three-state counters (attach-scoped; cap-independent, §Q7.3). */
  private threeState: { measured: number; semi: number; estimated: number } = {
    measured: 0,
    semi: 0,
    estimated: 0,
  }
  /** Injected meter anchor for the `meterAnchored` semi path (§Q7.2 rule 2b). */
  private meterAnchor: MeterAnchorLike | undefined
  /** Config attributionTimeWindowMs (§Q4.2 rule 4 fallback; config-owned value). */
  private attributionTimeWindowMs: number = configDefaults.attributionTimeWindowMs
  private compactionStartSeq: number | undefined
  private endSeedSeq: number | undefined
  private lastSeq = -1

  /** The bound session, when attached. */
  get boundSession(): SessionLike | undefined {
    return this.session
  }

  /** Highest seq the store has consumed (lastSeq + 1 == next expected). */
  get syncedToSeq(): number {
    return this.lastSeq + 1
  }

  /**
   * Bind to one session and rebuild all state from a full scan (the blessed
   * resume restore). Resets every per-session view first.
   */
  attach(session: SessionLike): void {
    this.session = session
    this.eventsBySeq.clear()
    this.ledger.clear()
    this.usageLedger.length = 0
    this.measuredSamples = 0
    this.unmeasuredSamples = 0
    this.routeHeaders.length = 0
    this.resetLog.length = 0
    this.snapshotLog.length = 0
    this.breakLog.length = 0
    this.captureLog.length = 0
    this.wireLog.length = 0
    this.preflightLog.length = 0
    this.anomaliesLog.length = 0
    this.foldAttributionLog.clear()
    this.eventSeqList.length = 0
    this.assistantMessageSeqs.length = 0
    this.turnStartSeqs.length = 0
    this.turnStartTurns.length = 0
    this.lastAssistantMessageSeq = -1
    this.threeState = { measured: 0, semi: 0, estimated: 0 }
    this.compactionStartSeq = undefined
    this.endSeedSeq = undefined
    this.lastSeq = -1
    this.scanUpTo(sessionSeq(session))
  }

  /**
   * Repair any feed gap: replay events from the store's frontier up to the
   * session's current end with bounded seq reads. No-op when in sync.
   */
  resync(): void {
    if (this.session === undefined) return
    const end = sessionSeq(this.session)
    if (end > this.syncedToSeq) this.scanUpTo(end)
  }

  /**
   * Consume one host-delivered event (the injected `session/event` callback).
   * Events from a foreign session are ignored; a gap triggers a bounded delta
   * repair first.
   */
  onEvent(session: SessionLike, event: SessionEventLike): void {
    if (this.session !== undefined && session !== this.session) return
    if (this.session === undefined) this.session = session
    if (event === null || typeof event !== 'object') return
    const seq = event.seq
    if (!Number.isFinite(seq) || !Number.isInteger(seq) || seq < 0) return
    if (seq > this.syncedToSeq) {
      // Feed gap: repair the delta (bounded to the missing span) first.
      const end = sessionSeq(session)
      this.scanUpTo(Math.min(end, seq))
    }
    this.applyEvent(event)
  }

  /** Active folds keyed by foldId — the validator-facing FoldMap view. */
  get foldMap(): FoldMap {
    const map = new Map<string, FoldRecord>()
    for (const [foldId, entry] of this.ledger) {
      if (entry.status === 'active') map.set(foldId, entry)
    }
    return map
  }

  /** Full ledger including non-active entries (status display / audit). */
  ledgerEntries(): readonly FoldLedgerEntry[] {
    return [...this.ledger.values()].sort((a, b) => a.checkpointSeq - b.checkpointSeq)
  }

  /** The retained immutable event at one seq, or undefined. */
  retainedEvent(seq: number): SessionEventLike | undefined {
    return this.eventsBySeq.get(seq)
  }

  /** The joined text of the retained event at one seq ('' when unreadable). */
  eventText(seq: number): string {
    const event = this.eventsBySeq.get(seq)
    return event === undefined ? '' : extractMessageText(event.data)
  }

  /**
   * Ordered SurfaceNode view of the CURRENT surface. The live
   * `session.surface.nodes` is authoritative when present; otherwise the
   * surface is replayed locally from the retained log (structural mocks).
   */
  surfaceNodes(): SurfaceNode[] {
    const session = this.session
    if (session === undefined) return []
    const liveNodes = session.surface?.nodes
    const nodes =
      liveNodes !== undefined ? [...liveNodes] : this.replaySurfaceNodes()
    const result: SurfaceNode[] = []
    for (const seq of nodes) {
      const event = this.eventsBySeq.get(seq)
      result.push(this.toSurfaceNode(seq, event))
    }
    return result
  }

  /** Surface node seqs whose event is not retained (fail-closed fold guard). */
  unreadableSurfaceSeqs(): number[] {
    const session = this.session
    if (session === undefined) return []
    const liveNodes = session.surface?.nodes
    const nodes = liveNodes !== undefined ? [...liveNodes] : this.replaySurfaceNodes()
    return nodes.filter((seq) => !this.eventsBySeq.has(seq))
  }

  /** Aggregate usage state (S6). */
  usageSnapshot(): UsageSnapshot {
    const latest = this.usageLedger[this.usageLedger.length - 1]
    return {
      samples: this.usageLedger.length,
      measuredSamples: this.measuredSamples,
      unmeasuredSamples: this.unmeasuredSamples,
      measured: this.measuredSamples > 0,
      ...(latest !== undefined ? { latest } : {}),
    }
  }

  // -------------------------------------------------------------------------
  // observability ledgers (v0.2.0 V1; RES-observe-route a.1)
  // -------------------------------------------------------------------------

  /** The request/header chain, oldest first (V1 observability). */
  routeHeaderChain(): readonly RouteHeader[] {
    return [...this.routeHeaders]
  }

  /** The most recent cached header, when any (the compare base for 'change'). */
  lastRouteHeader(): RouteHeader | undefined {
    return this.routeHeaders[this.routeHeaders.length - 1]
  }

  /** The cache-reset ledger, oldest first (V1 observability). */
  resetEvents(): readonly ResetEvent[] {
    return [...this.resetLog]
  }

  // -- V2 process-memory receive ports (observe listener sinks; never
  //    session-logged — CARD-F a.1 进程内不入账; zctx_status data plane the
  //    V3 aggregation consumes). -------------------------------------------

  /** The in-process snapshot ledger, oldest first (bounded; oldest dropped). */
  requestSnapshots(): readonly RequestSnapshot[] {
    return [...this.snapshotLog]
  }

  /** The most recent request snapshot, when any (the listener's comparison baseline). */
  lastRequestSnapshot(): RequestSnapshot | undefined {
    return this.snapshotLog[this.snapshotLog.length - 1]
  }

  /** The harness-domain prefix-break ledger, oldest first (bounded; oldest dropped). */
  prefixBreakEvents(): readonly PrefixBreakRecord[] {
    return [...this.breakLog]
  }

  /** The non-durable captured-attempt-usage ledger, oldest first (bounded; oldest dropped). */
  capturedAttemptUsage(): readonly CapturedAttemptUsage[] {
    return [...this.captureLog]
  }

  /**
   * Snapshot sink: append one request snapshot to the process-memory ledger
   * and, when the listener detected a prefix break against the previous
   * snapshot, the classified break record next to it. The listener computes
   * the break (the hash件 lives in observe.ts); the store only receives.
   */
  absorbRequestSnapshot(snapshot: RequestSnapshot, breakRecord?: PrefixBreakRecord): void {
    if (this.snapshotLog.length >= SNAPSHOT_LEDGER_CAP) this.snapshotLog.shift()
    this.snapshotLog.push(snapshot)
    if (breakRecord !== undefined) {
      if (this.breakLog.length >= BREAK_LEDGER_CAP) this.breakLog.shift()
      this.breakLog.push(breakRecord)
    }
  }

  /**
   * Non-durable capture sink: append one failed attempt's observed usage
   * (observe.attemptCapture face). The record dies with the process by
   * design; the ledger is only bounded memory.
   */
  absorbCapturedAttemptUsage(record: CapturedAttemptUsage): void {
    if (this.captureLog.length >= CAPTURE_LEDGER_CAP) this.captureLog.shift()
    this.captureLog.push(record)
  }

  /**
   * Wire-domain receive port (V5): append one byte/object-level hash of a
   * zctx-route request. Observation-only by construction — the producer
   * (adapter/wire.ts) never rewrites a payload (R1). Same 64-cap design as
   * the V2 ledgers; never session-logged.
   */
  absorbWireSnapshot(snapshot: WireSnapshot): void {
    if (this.wireLog.length >= WIRE_LEDGER_CAP) this.wireLog.shift()
    this.wireLog.push(snapshot)
  }

  /** The bounded wire-domain ledger, oldest first (V5 receive port view). */
  wireSnapshots(): readonly WireSnapshot[] {
    return [...this.wireLog]
  }

  /** The bounded S1 preflight calibration ledger, oldest first (V4 receive port). */
  preflightCalibrations(): readonly PreflightCalibrationRecord[] {
    return [...this.preflightLog]
  }

  /**
   * S1 preflight calibration sink (V4): append one estimate-vs-reality
   * record (preflightMode observe/enforce). Process-memory only, never
   * session-logged; the estimator error statistics zctx_status renders are
   * computed on demand from this ledger (card product 3 — the dataset that
   * decides when enforce is safe to promote, no-go condition 4).
   */
  absorbPreflightCalibration(record: PreflightCalibrationRecord): void {
    if (this.preflightLog.length >= PREFLIGHT_CALIBRATION_CAP) this.preflightLog.shift()
    this.preflightLog.push(record)
  }

  /** The bounded usage-record ledger, oldest first (V1 observability). */
  usageRecords(): readonly UsageRecord[] {
    return [...this.usageLedger]
  }

  // -- V3 attribution engine (RES-observe-route §Q4/§Q7; card products 1-3) --

  /**
   * Inject the meter anchor for the `meterAnchored` semi path (§Q7.2 rule 2b:
   * THROUGH INJECTION — the store never imports the host). Called once at
   * store creation by the plugin; `undefined` keeps every usage-less request
   * honestly 'estimated'.
   */
  setMeterAnchor(anchor: MeterAnchorLike | undefined): void {
    this.meterAnchor = anchor
  }

  /**
   * Set the attribution time-window fallback from config
   * (attributionTimeWindowMs; never hardcoded — plan §3 threshold discipline).
   */
  setAttributionTimeWindowMs(ms: number): void {
    if (typeof ms === 'number' && Number.isFinite(ms) && ms >= 0) {
      this.attributionTimeWindowMs = ms
    }
  }

  /** The fold-attribution ledger (foldId → association), commit order. */
  foldAttributions(): readonly FoldUsageAttribution[] {
    return [...this.foldAttributionLog.values()]
  }

  /**
   * The aggregated observability snapshot for zctx_status (a.1 row 6): pure
   * aggregation over the store's ledger views (attribution.ts
   * buildObservabilitySnapshot). On-demand — status is user-invoked.
   */
  observabilitySnapshot(): ObservabilitySnapshot {
    return buildObservabilitySnapshot({
      usageRecords: this.usageLedger,
      threeState: this.threeState,
      foldEntries: [...this.ledger.values()].map((entry) => ({
        foldId: entry.foldId,
        checkpointSeq: entry.checkpointSeq,
        tokensBefore: entry.tokensBefore,
        tokensAfter: entry.tokensAfter,
      })),
      foldAttributions: [...this.foldAttributionLog.values()],
      resetEvents: this.resetLog,
      assistantMessageSeqs: [...this.assistantMessageSeqs],
    })
  }

  /** True while a `compaction/start` bracket is durably open (mutex). */
  compactionActive(): boolean {
    if (this.compactionStartSeq === undefined) return false
    // A later constructor-seed boundary proves the owner belongs to an ended
    // lifecycle (official inspectCompactionEntryState semantics).
    return this.endSeedSeq === undefined || this.endSeedSeq < this.compactionStartSeq
  }

  /** Record one anomaly in the bounded ledger (honest, never throws). */
  recordAnomaly(kind: string, detail: string, seq?: number): void {
    if (this.anomaliesLog.length >= ANOMALY_LEDGER_CAP) this.anomaliesLog.shift()
    this.anomaliesLog.push(seq === undefined ? { kind, detail } : { seq, kind, detail })
  }

  /** The anomaly ledger, oldest first. */
  anomalies(): readonly StoreAnomaly[] {
    return [...this.anomaliesLog]
  }

  // -------------------------------------------------------------------------
  // internals
  // -------------------------------------------------------------------------

  /** Replay retained events up to `end` (exclusive) through seq reads. @internal */
  private scanUpTo(end: number): void {
    for (let seq = this.syncedToSeq; seq < end; seq += 1) {
      const event = this.session?.eventAt?.(seq)
      if (event === undefined) {
        this.recordAnomaly('unreadable-event', `seq ${seq} not readable during scan`, seq)
        this.lastSeq = seq
        continue
      }
      this.applyEvent(event)
    }
  }

  /**
   * Apply one event to every derived view (scan and incremental paths share
   * this single transition, so attach scans, live feeds, and resync gaps
   * stay consistent by construction).
   * @internal
   */
  private applyEvent(event: SessionEventLike): void {
    this.eventsBySeq.set(event.seq, event)
    this.eventSeqList.push(event.seq)
    this.lastSeq = event.seq

    // -- request/header chain + header-driven resets (a.2 item 1) -------------
    if (event.type === 'request/header') {
      this.applyRequestHeader(event)
    }
    // -- compaction mutex state + bracket reset (a.2 item 1) ------------------
    else if (event.type === 'compaction/start') {
      this.compactionStartSeq = event.seq
      this.recordReset('compaction', event.seq, 'compaction/start bracket opened', event.time)
    } else if (event.type === 'compaction/end') {
      this.compactionStartSeq = undefined
    } else if (event.type === 'session/end-seed') {
      this.endSeedSeq = event.seq
      this.recordReset('session-recovery', event.seq, 'session/end-seed generation boundary', event.time)
    }
    // -- turn markers (V3 attribution same-turn evidence, §Q4.2 rule 4) -------
    else if (event.type === 'turn/start') {
      const turn = isRecord(event.data) ? finiteNumber(event.data.turn) : undefined
      if (turn !== undefined) {
        this.turnStartSeqs.push(event.seq)
        this.turnStartTurns.push(turn)
      }
    }

    // -- usage ledger + attribution (assistant/message only) -------------------
    if (event.type === 'assistant/message') {
      this.applyAssistantMessage(event)
    }

    // -- fold ledger ----------------------------------------------------------
    const op = event.surfaceOp
    if (op === undefined || op === 'append') return
    // Replace-driven reset classification (a.2 item 1: mergeRewrite /
    // microPrune / unknown-replace / systemSectionChange). Runs before the
    // fold-ledger transition so both views see every replace.
    this.classifyReplaceReset(event, op)
    const checkpoint = extractCheckpointSource(event.data)
    if (checkpoint === undefined) {
      // A foreign replace producer (official compaction, …): any active fold
      // checkpoint it shadows is dead.
      this.shadowActiveCheckpoints(event, 'dead')
      return
    }
    if (checkpoint.kind === 'zctx-unfold') {
      const entry = this.ledger.get(checkpoint.foldId)
      if (entry !== undefined && entry.status === 'active') {
        this.ledger.set(checkpoint.foldId, { ...entry, status: 'unfolded' })
      }
      return
    }
    // kind === 'zctx-fold': a new checkpoint. Older active checkpoints it
    // shadows become 'absorbed' (recoverable inside the new fold's summary).
    this.shadowActiveCheckpoints(event, 'absorbed')
    this.ledger.set(checkpoint.foldId, {
      foldId: checkpoint.foldId,
      startSeq: op.startSeq,
      endSeq: op.endSeq,
      checkpointSeq: event.seq,
      summaryText: extractMessageText(event.data),
      shadowedSeqs: [...(event.sourceEventSeqs ?? [])],
      tokensBefore: checkpoint.tokensBefore ?? 0,
      tokensAfter: checkpoint.tokensAfter ?? 0,
      status: 'active',
    })
  }

  /**
   * Consume one request/header event: cache the RouteHeader, then classify
   * resets — `reason:'resume'` is the sessionRecovery half-class signal
   * (RES-observe-route §Q6: restart/fork-seed boundary); `reason:'change'`
   * field-compares against the previous header (a.2 item 1). @internal
   */
  private applyRequestHeader(event: SessionEventLike): void {
    const header = extractRequestHeader(event.data, event.seq)
    if (header === undefined) {
      this.recordAnomaly('unreadable-header', `request/header at seq ${event.seq} failed structural parse`, event.seq)
      return
    }
    if (header.reason === 'resume') {
      this.recordReset(
        'session-recovery',
        event.seq,
        "request/header reason='resume' (process restart / fork-seed boundary)",
        event.time,
      )
    } else if (header.reason === 'series') {
      // V1 handoff ruling ①: an unchanged header that began an explicitly
      // distinct message series, or followed a surface replacement
      // (session/src/types.ts:265-273) — the producer's self-admitted prefix
      // discontinuity, accounted as its own reset kind. May coincide with a
      // replace-driven entry (per-signal ledger, not per-physical-reset).
      this.recordReset(
        'series-restart',
        event.seq,
        "request/header reason='series' (producer self-admitted message-series discontinuity)",
        event.time,
      )
    } else if (header.reason === 'change' && this.lastRouteHeader() !== undefined) {
      for (const reset of headerChangeResets(this.lastRouteHeader() as RouteHeader, header)) {
        this.recordReset(reset.kind, event.seq, reset.evidence, event.time)
      }
    }
    // V1-B closure: bounded chain (oldest dropped; the `change` comparison
    // reads only the last header, so the cap never affects classification).
    if (this.routeHeaders.length >= ROUTE_HEADER_LEDGER_CAP) this.routeHeaders.shift()
    this.routeHeaders.push(header)
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
  private classifyReplaceReset(event: SessionEventLike, op: { startSeq: number; endSeq: number }): void {
    const checkpoint = extractCheckpointSource(event.data)
    if (checkpoint !== undefined) {
      this.recordReset(
        'merge-rewrite',
        event.seq,
        `own checkpoint replace (${checkpoint.kind} ${checkpoint.foldId}, span ${op.startSeq}..${op.endSeq})`,
        event.time,
      )
      return
    }
    if (this.compactionActive()) return
    if (event.type === 'system/message') {
      this.recordReset(
        'system-section-change',
        event.seq,
        `system/message rewrite over span ${op.startSeq}..${op.endSeq}`,
        event.time,
      )
      return
    }
    const startEvent = this.eventsBySeq.get(op.startSeq)
    if (
      event.sourceEventSeqs !== undefined
      && event.sourceEventSeqs.length === 1
      && startEvent !== undefined
      && startEvent.type === 'tool/result'
    ) {
      this.recordReset(
        'micro-prune',
        event.seq,
        `tool/result node ${op.startSeq} rewritten in place (pruner shape; producer unattributable)`,
        event.time,
      )
      return
    }
    this.recordReset(
      'unknown-replace',
      event.seq,
      `foreign replace producer (${event.type}) over span ${op.startSeq}..${op.endSeq}`,
      event.time,
    )
  }

  /**
   * Append one reset ledger entry (evidence text is caller-owned). V1-B
   * closure: bounded ledger (oldest dropped). The observe listener's
   * exemption window consumes resets by SEQ pointer, so the shift never
   * mis-aligns it (store-observe spec pins 66→64).
   * @internal
   */
  private recordReset(kind: ResetEventKind, seq: number, evidence: string, time?: number): void {
    if (this.resetLog.length >= RESET_LEDGER_CAP) this.resetLog.shift()
    this.resetLog.push({ kind, seq, ...(time !== undefined ? { time } : {}), evidence })
  }

  /** Demote active folds whose checkpoint is shadowed by this replace. @internal */
  private shadowActiveCheckpoints(event: SessionEventLike, status: 'absorbed' | 'dead'): void {
    const shadowed = event.sourceEventSeqs
    if (shadowed === undefined || shadowed.length === 0) return
    const shadowedSet = new Set(shadowed)
    for (const [foldId, entry] of this.ledger) {
      if (entry.status !== 'active') continue
      if (!shadowedSet.has(entry.checkpointSeq)) continue
      this.ledger.set(foldId, {
        ...entry,
        status,
        shadowedBySeq: event.seq,
        shadowedByKind: extractSourceKind(event.data) ?? event.type,
      })
    }
  }

  // -- V3 attribution engine internals (§Q4.2 incremental transition) --------

  /**
   * One assistant/message: build the usage record, grade the semi paths, fill
   * the fold attribution (nearest preceding fold commit), then maintain the
   * lifetime three-state counters and the interpolated retro-upgrade.
   * Runs inside the shared applyEvent transition — attach scan, live feed,
   * and resync rebuilds all attribute identically by construction.
   * @internal
   */
  private applyAssistantMessage(event: SessionEventLike): void {
    let record = extractUsageRecord(event.data, event.seq)
    // -- meterAnchored semi path (§Q7.2 rule 2b, injected interface) ---------
    if (!record.measured && this.meterAnchor !== undefined) {
      const anchor = this.tryMeterAnchor(event.seq)
      if (anchor !== undefined) {
        record = { ...record, state: 'semi', semiKind: 'meterAnchored', inputTokens: anchor }
      }
    }
    // -- attribution fill (§Q4.2; nearest fold commit binds the record) ------
    const attribution = this.attributeMessage(event)
    if (attribution !== undefined) {
      record = { ...record, attribution }
    }
    if (this.usageLedger.length >= USAGE_LEDGER_CAP) this.usageLedger.shift()
    this.usageLedger.push(record)
    this.assistantMessageSeqs.push(event.seq)
    // -- lifetime three-state counters (§Q7.3; the V1 measured/unmeasured
    //    split keeps its original semantics: semi has no usable usage object
    //    and therefore counts as unmeasured there too) ------------------------
    if (record.measured) {
      this.measuredSamples += 1
      this.threeState = { ...this.threeState, measured: this.threeState.measured + 1 }
      this.upgradeInterpolatedBefore(event, record)
    } else {
      this.unmeasuredSamples += 1
      this.threeState = record.state === 'semi'
        ? { ...this.threeState, semi: this.threeState.semi + 1 }
        : { ...this.threeState, estimated: this.threeState.estimated + 1 }
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
  private attributeMessage(event: SessionEventLike): FoldUsageAttribution | undefined {
    const data = isRecord(event.data) ? event.data : undefined
    const messageTurn = data === undefined ? undefined : finiteNumber(data.turn)
    const messageStep = data === undefined ? undefined : finiteNumber(data.step)
    const interrupted = data?.interrupted === true
    const previousMessageSeq = this.lastAssistantMessageSeq
    this.lastAssistantMessageSeq = event.seq
    if (messageTurn === undefined || messageStep === undefined) {
      // Official assistant/message events always carry turn/step
      // (session/src/types.ts:341-342); absence is malformed input — attribute
      // nothing, record honestly.
      this.recordAnomaly(
        'attribution-skipped',
        `assistant/message at seq ${event.seq} lacks the official turn/step envelope`,
        event.seq,
      )
      return undefined
    }
    const messageTime = finiteNumber(event.time)
    let nearest: FoldUsageAttribution | undefined
    for (const entry of this.ledger.values()) {
      if (entry.checkpointSeq <= previousMessageSeq || entry.checkpointSeq >= event.seq) continue
      const foldEvent = this.eventsBySeq.get(entry.checkpointSeq)
      const attribution = classifyFoldAttribution({
        foldId: entry.foldId,
        foldSeq: entry.checkpointSeq,
        ...(foldEvent !== undefined && finiteNumber(foldEvent.time) !== undefined
          ? { foldTime: foldEvent.time }
          : {}),
        ...(this.turnOpenAt(entry.checkpointSeq) !== undefined
          ? { foldTurn: this.turnOpenAt(entry.checkpointSeq) }
          : {}),
        messageSeq: event.seq,
        ...(messageTime !== undefined ? { messageTime } : {}),
        messageTurn,
        messageStep,
        ...(interrupted ? { messageInterrupted: true } : {}),
        windowEvents: this.windowEventsBetween(entry.checkpointSeq, event.seq),
        timeWindowMs: this.attributionTimeWindowMs,
      })
      if (attribution !== undefined) {
        this.foldAttributionLog.set(entry.foldId, attribution)
        nearest = attribution
      }
    }
    return nearest
  }

  /** Fail-soft meter-anchor probe: a meter fault degrades to estimated. @internal */
  private tryMeterAnchor(seq: number): number | undefined {
    try {
      const anchor = this.meterAnchor?.inputAnchor(seq)
      return typeof anchor === 'number' && Number.isFinite(anchor) && anchor > 0 ? anchor : undefined
    } catch (error: unknown) {
      this.recordAnomaly(
        'meter-anchor-failed',
        `meter anchor probe for seq ${seq} threw (${error instanceof Error ? error.message : String(error)})`,
        seq,
      )
      return undefined
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
  private upgradeInterpolatedBefore(anchorEvent: SessionEventLike, anchor: UsageRecord): void {
    if (
      anchor.inputTokens === undefined
      && anchor.cacheReadTokens === undefined
      && anchor.cacheWriteTokens === undefined
    ) {
      return // no input-side evidence to carry over
    }
    const anchorTurn = this.messageTurnAt(anchorEvent.seq)
    if (anchorTurn === undefined) return
    for (let i = this.usageLedger.length - 2; i >= 0; i -= 1) {
      const candidate = this.usageLedger[i]
      if (candidate.state === 'measured') break
      if (candidate.state !== 'estimated') continue // semi records are not blockers
      const candidateTurn = this.messageTurnAt(candidate.seq)
      if (candidateTurn === undefined || candidateTurn !== anchorTurn) break
      if (this.resetBetween(candidate.seq, anchorEvent.seq)) break
      this.usageLedger[i] = {
        ...candidate,
        state: 'semi',
        semiKind: 'interpolated',
        ...(anchor.inputTokens !== undefined ? { inputTokens: anchor.inputTokens } : {}),
        ...(anchor.cacheReadTokens !== undefined ? { cacheReadTokens: anchor.cacheReadTokens } : {}),
        ...(anchor.cacheWriteTokens !== undefined ? { cacheWriteTokens: anchor.cacheWriteTokens } : {}),
      }
      this.threeState = {
        ...this.threeState,
        estimated: this.threeState.estimated - 1,
        semi: this.threeState.semi + 1,
      }
    }
  }

  /** First index in eventSeqList whose seq is strictly above `seq`. @internal */
  private firstIndexAbove(seq: number): number {
    let lo = 0
    let hi = this.eventSeqList.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (this.eventSeqList[mid] <= seq) lo = mid + 1
      else hi = mid
    }
    return lo
  }

  /** Retained events strictly between `from` and `to`, ascending. @internal */
  private windowEventsBetween(from: number, to: number): SessionEventLike[] {
    const start = this.firstIndexAbove(from)
    const end = this.firstIndexAbove(to - 1)
    const out: SessionEventLike[] = []
    for (let i = start; i < end; i += 1) {
      const event = this.eventsBySeq.get(this.eventSeqList[i])
      if (event !== undefined) out.push(event)
    }
    return out
  }

  /** The turn open at `seq` (nearest turn/start at-or-before), when logged. @internal */
  private turnOpenAt(seq: number): number | undefined {
    let lo = 0
    let hi = this.turnStartSeqs.length
    let best = -1
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (this.turnStartSeqs[mid] <= seq) {
        best = mid
        lo = mid + 1
      } else {
        hi = mid
      }
    }
    return best >= 0 ? this.turnStartTurns[best] : undefined
  }

  /** The `data.turn` of the retained event at one seq, when well-formed. @internal */
  private messageTurnAt(seq: number): number | undefined {
    const event = this.eventsBySeq.get(seq)
    if (event === undefined || !isRecord(event.data)) return undefined
    return finiteNumber(event.data.turn)
  }

  /**
   * True when a reset-ledger entry sits strictly between the two seqs — or
   * when the ledger is at its cap (V3-1: `RESET_LEDGER_CAP` eviction via
   * shift-and-push makes "no reset" unprovable, because an evicted entry may
   * have sat between the seqs; the walk stops conservatively instead of
   * upgrading across a possibly-evicted reset). @internal
   */
  private resetBetween(from: number, to: number): boolean {
    if (this.resetLog.length >= RESET_LEDGER_CAP) return true
    return this.resetLog.some((reset) => reset.seq > from && reset.seq < to)
  }

  /** Local surface replay from the retained log (fallback when no live surface). @internal */
  private replaySurfaceNodes(): number[] {
    const nodes: number[] = []
    for (let seq = 0; seq <= this.lastSeq; seq += 1) {
      const event = this.eventsBySeq.get(seq)
      if (event === undefined || !MESSAGE_EVENT_TYPES.has(event.type)) continue
      const op = event.surfaceOp
      if (op === 'append' || op === undefined) {
        nodes.push(event.seq)
        continue
      }
      const startIdx = nodes.indexOf(op.startSeq)
      const endIdx = nodes.indexOf(op.endSeq)
      if (startIdx === -1 || endIdx === -1 || startIdx > endIdx) continue
      nodes.splice(startIdx, endIdx - startIdx + 1, event.seq)
    }
    return nodes
  }

  /** Build one SurfaceNode from a retained event. @internal */
  private toSurfaceNode(seq: number, event: SessionEventLike | undefined): SurfaceNode {
    if (event === undefined) {
      // Unreadable node: fail-closed shape — unknown role, no pairing info,
      // zero tokens (the engine refuses folds while any node is unreadable).
      return {
        seq,
        type: 'unknown',
        role: 'unknown',
        estimatedTokens: 0,
        isUser: false,
        textLength: 0,
      }
    }
    const role = ROLE_BY_TYPE[event.type] ?? 'unknown'
    const text = extractMessageText(event.data)
    const sourceKind = extractSourceKind(event.data)
    return {
      seq,
      type: event.type,
      role,
      estimatedTokens: estimateTokens(text),
      isUser: role === 'user',
      textLength: text.length,
      ...(role === 'assistant'
        ? { toolCallIds: extractToolCallIds(event.data) }
        : {}),
      ...(role === 'tool' ? { answersCallId: extractAnswersCallId(event.data) } : {}),
      ...(sourceKind !== undefined ? { sourceKind } : {}),
    }
  }
}

/** Read the session's next seq through the structural contract. @internal */
function sessionSeq(session: SessionLike): number {
  const seq = session.seq
  return typeof seq === 'number' && Number.isFinite(seq) && seq >= 0 ? seq : 0
}
