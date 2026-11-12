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

import { estimateTokens } from './budget.ts'
import type {
  FoldMap,
  FoldRecord,
  SessionEventLike,
  SessionLike,
  SurfaceNode,
} from './types.ts'

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

/** One provider usage sample taken from an assistant/message event (S6). */
export interface UsageSample {
  /** Seq of the assistant/message event. */
  readonly seq: number
  /** True when the event carried a usable usage object. */
  readonly measured: boolean
  /** Optional provider cache-read tokens. */
  readonly cacheReadTokens?: number
  /** Optional provider cache-write tokens. */
  readonly cacheWriteTokens?: number
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
 * Extract one usage sample from an assistant/message payload (S6). The
 * official event data carries `usage?: TokenUsage` with optional
 * cacheReadTokens/cacheWriteTokens (llm/src/types.ts:166-189).
 */
function extractUsageSample(data: unknown, seq: number): UsageSample {
  if (data !== null && typeof data === 'object') {
    const usage = (data as Record<string, unknown>).usage
    if (usage !== null && typeof usage === 'object') {
      const record = usage as Record<string, unknown>
      const read = record.cacheReadTokens
      const write = record.cacheWriteTokens
      return {
        seq,
        measured: true,
        ...(typeof read === 'number' && Number.isFinite(read) ? { cacheReadTokens: read } : {}),
        ...(typeof write === 'number' && Number.isFinite(write) ? { cacheWriteTokens: write } : {}),
      }
    }
  }
  return { seq, measured: false }
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
  private readonly usageSamples: UsageSample[] = []
  private measuredSamples = 0
  private unmeasuredSamples = 0
  private readonly anomaliesLog: StoreAnomaly[] = []
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
    this.usageSamples.length = 0
    this.measuredSamples = 0
    this.unmeasuredSamples = 0
    this.anomaliesLog.length = 0
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
    const latest = this.usageSamples[this.usageSamples.length - 1]
    return {
      samples: this.usageSamples.length,
      measuredSamples: this.measuredSamples,
      unmeasuredSamples: this.unmeasuredSamples,
      measured: this.measuredSamples > 0,
      ...(latest !== undefined ? { latest } : {}),
    }
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
   * this single transition, so attach and live feeds stay consistent).
   * @internal
   */
  private applyEvent(event: SessionEventLike): void {
    this.eventsBySeq.set(event.seq, event)
    this.lastSeq = event.seq

    // -- usage ledger (assistant/message only) --------------------------------
    if (event.type === 'assistant/message') {
      const sample = extractUsageSample(event.data, event.seq)
      if (this.usageSamples.length >= USAGE_LEDGER_CAP) this.usageSamples.shift()
      this.usageSamples.push(sample)
      if (sample.measured) this.measuredSamples += 1
      else this.unmeasuredSamples += 1
    }

    // -- compaction mutex state (durable bracket markers) ---------------------
    if (event.type === 'compaction/start') this.compactionStartSeq = event.seq
    else if (event.type === 'compaction/end') this.compactionStartSeq = undefined
    else if (event.type === 'session/end-seed') this.endSeedSeq = event.seq

    // -- fold ledger ----------------------------------------------------------
    const op = event.surfaceOp
    if (op === undefined || op === 'append') return
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
