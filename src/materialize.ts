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

import {
  MATERIALIZED_ROLE_PREFIX_DEVELOPER,
  MATERIALIZED_FOLDED_BLOCK_PREFIX,
  MATERIALIZED_FOLDED_BLOCK_SUFFIX,
  MATERIALIZED_MISSING_EVENT_PREFIX,
  MATERIALIZED_MISSING_EVENT_SUFFIX,
  MATERIALIZED_NO_TEXT_CONTENT,
  MATERIALIZED_ROLE_PREFIX_ASSISTANT,
  MATERIALIZED_ROLE_PREFIX_SYSTEM,
  MATERIALIZED_ROLE_PREFIX_UNKNOWN,
  MATERIALIZED_ROLE_PREFIX_USER,
  MATERIALIZED_TOOL_HEADER_SUFFIX,
  MATERIALIZED_TOOL_PREFIX,
  MATERIALIZED_TOOL_SOURCE_NOTE,
} from './texts.ts'
import type { FoldMap, MaterializeAccessor, MaterializeBlock, SessionEventLike } from './types.ts'

/** Official message-producing event types (session/src/types.ts:439-444). */
const MESSAGE_EVENT_TYPES: ReadonlySet<string> = new Set([
  'system/message',
  'developer/message',
  'user/message',
  'assistant/message',
  'tool/result',
])

/**
 * Role prefix per surface event type. Kept in lockstep with
 * MESSAGE_EVENT_TYPES; the UNKNOWN fallback is defense-in-depth for a future
 * event type added to the set without a prefix here.
 */
const ROLE_PREFIX_BY_TYPE: Readonly<Record<string, string>> = {
  'system/message': MATERIALIZED_ROLE_PREFIX_SYSTEM,
  'developer/message': MATERIALIZED_ROLE_PREFIX_DEVELOPER,
  'user/message': MATERIALIZED_ROLE_PREFIX_USER,
  'assistant/message': MATERIALIZED_ROLE_PREFIX_ASSISTANT,
  'tool/result': MATERIALIZED_TOOL_PREFIX,
}

/**
 * Materialize the ordered text blocks for the fold span [startSeq..endSeq]
 * (inclusive on both ends) with one-layer expansion of active fold
 * checkpoints.
 */
export function materializeRange(
  accessor: MaterializeAccessor,
  foldMap: FoldMap,
  startSeq: number,
  endSeq: number,
): MaterializeBlock[] {
  if (accessor === null || typeof accessor !== 'object' || typeof accessor.eventAt !== 'function') {
    throw new TypeError('materializeRange: accessor must expose eventAt(seq)')
  }
  if (!(foldMap instanceof Map)) {
    throw new TypeError('materializeRange: foldMap must be a Map')
  }
  assertSeq(startSeq, 'startSeq')
  assertSeq(endSeq, 'endSeq')
  if (startSeq > endSeq) {
    throw new TypeError(`materializeRange: inverted span [${startSeq}, ${endSeq}]`)
  }

  // Index active checkpoints by their on-surface seq for O(1) lookup.
  const checkpointBySeq = new Map<number, { foldId: string }>()
  for (const record of foldMap.values()) {
    checkpointBySeq.set(record.checkpointSeq, { foldId: record.foldId })
  }

  const blocks: MaterializeBlock[] = []
  for (let seq = startSeq; seq <= endSeq; seq += 1) {
    const event = accessor.eventAt(seq)
    if (event === undefined) {
      blocks.push({
        type: 'text',
        text: `${MATERIALIZED_MISSING_EVENT_PREFIX}${seq}${MATERIALIZED_MISSING_EVENT_SUFFIX}`,
      })
      continue
    }

    // One-layer expansion: only ACTIVE checkpoints (foldMap) are marked; a
    // stale checkpoint source outside the ledger renders as a plain user
    // message below.
    const checkpoint =
      event.type === 'user/message' ? checkpointBySeq.get(seq) : undefined
    if (checkpoint !== undefined) {
      const body = extractMessageText(event.data)
      const marker = `${MATERIALIZED_FOLDED_BLOCK_PREFIX}${checkpoint.foldId}${MATERIALIZED_FOLDED_BLOCK_SUFFIX}`
      blocks.push({ type: 'text', text: body === '' ? marker : `${marker}\n${body}` })
      continue
    }

    if (!MESSAGE_EVENT_TYPES.has(event.type)) continue // log-only event
    blocks.push(renderMessageBlock(event))
  }
  return blocks
}

/** Assert one non-negative integer seq. @internal */
function assertSeq(value: number, name: string): void {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
    throw new TypeError(`materializeRange: ${name} must be a non-negative integer, got ${String(value)}`)
  }
}

/** Pull the message object out of an event's data payload. @internal */
function extractMessage(data: unknown): Record<string, unknown> | undefined {
  if (data === null || typeof data !== 'object') return undefined
  const record = data as Record<string, unknown>
  if (record.message !== null && typeof record.message === 'object') {
    return record.message as Record<string, unknown>
  }
  // Tolerate message-shaped payloads without the { turn, message } envelope.
  if (record.content !== undefined) return record
  return undefined
}

/** Join the text blocks of a message payload (string content tolerated). @internal */
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

/** Best-effort tool identity for a tool/result event. @internal */
function extractToolIdentity(event: SessionEventLike): { name?: string; callId?: string } {
  const message = extractMessage(event.data)
  if (message === undefined) return {}
  const data = event.data
  const dataName: string | undefined =
    data !== null && typeof data === 'object' && typeof (data as Record<string, unknown>).toolName === 'string'
      ? ((data as Record<string, unknown>).toolName as string)
      : undefined
  const name: string | undefined =
    typeof message.toolName === 'string' ? message.toolName : dataName
  const source = message.source
  const sourceCallId =
    source !== null && typeof source === 'object' && typeof (source as Record<string, unknown>).callId === 'string'
      ? ((source as Record<string, unknown>).callId as string)
      : undefined
  const callId: string | undefined =
    typeof message.toolCallId === 'string' ? message.toolCallId : sourceCallId
  return { name, callId }
}

/** Render one message event as a role-prefixed text block. @internal */
function renderMessageBlock(event: SessionEventLike): MaterializeBlock {
  const body = extractMessageText(event.data)

  if (event.type === 'tool/result') {
    const { name, callId } = extractToolIdentity(event)
    const header =
      name !== undefined
        ? `${MATERIALIZED_TOOL_PREFIX} ${name}${MATERIALIZED_TOOL_HEADER_SUFFIX}`
        : callId !== undefined
          ? `${MATERIALIZED_TOOL_PREFIX} (call ${callId})${MATERIALIZED_TOOL_HEADER_SUFFIX}`
          : `${MATERIALIZED_TOOL_PREFIX}${MATERIALIZED_TOOL_HEADER_SUFFIX}`
    const lines = [header, body === '' ? MATERIALIZED_NO_TEXT_CONTENT : body, MATERIALIZED_TOOL_SOURCE_NOTE]
    return { type: 'text', text: lines.join('\n') }
  }

  const prefix = ROLE_PREFIX_BY_TYPE[event.type] ?? MATERIALIZED_ROLE_PREFIX_UNKNOWN
  return {
    type: 'text',
    text: `${prefix}\n${body === '' ? MATERIALIZED_NO_TEXT_CONTENT : body}`,
  }
}
