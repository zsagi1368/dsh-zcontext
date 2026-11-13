/**
 * Self-replicated chunk-mapping twins — the port of the official
 * llm-pi-ai/src/stream.ts event→StreamChunk translation (labeled
 * `zctx-mapping`), used when the official TS sources do not resolve
 * (RES-adapter-route F5.9: "自研复刻约 200 行+诚实标注").
 *
 * PORT PROVENANCE (honest anchors, pi-ai 1.0.2 + official stream.ts):
 *   - mapUsage          — official src/stream.ts:24-32 (F5.6: pi-ai folds
 *                         reasoning into output; cache fields only when
 *                         non-zero; the three TokenUsage counts stay MUTUALLY
 *                         EXCLUSIVE — input is the un-cached input alone).
 *   - classifyPiAiError — official src/stream.ts:42-68 (module-private
 *                         upstream, so this twin is ALWAYS the supplier; the
 *                         regex table incl. the undici `terminated` /
 *                         "Premature close" special cases is ported as-is).
 *   - mapStopReason     — official src/stream.ts:80-128 (overflow double
 *                         classifier: pi-ai isContextOverflow + official
 *                         isContextWindowExceededError; EMPTY_RESPONSE for a
 *                         content-less stop; pending/deferred → PI_AI_ERROR).
 *   - toStreamChunks    — official src/stream.ts:142-234 (7 chunk shapes,
 *                         usage strictly BEFORE finish and nothing after,
 *                         tool arguments re-stringified at block-end, block
 *                         index = pi-ai contentIndex 1:1, STREAM_CLOSED when
 *                         the source ends without a terminal event).
 *
 * The twins consume STRUCTURAL values (no host/pi-ai static type imports) and
 * take the official dsh-llm classifiers/error through {@link MappingDeps} —
 * the same zero-static-dependency discipline as host-llm.ts.
 *
 * @module adapter/map
 */

/** The official dsh-llm members the twins need (injected, never imported). */
export interface MappingDeps {
  readonly LlmError: new (message: string, code: string, options?: { cause?: unknown }) => Error
  readonly CONTEXT_WINDOW_EXCEEDED_CODE: string
  readonly EMPTY_RESPONSE_CODE: string
  readonly QUOTA_EXCEEDED_CODE: string
  readonly isContextWindowExceededError: (message: string) => boolean
  readonly isQuotaExceededError: (message: string) => boolean
}

// ---------------------------------------------------------------------------
// Structural vocabulary (runtime shapes only; types are the hosts' business).
// ---------------------------------------------------------------------------

/** Structural pi-ai usage (dist/types.d.ts Usage). */
interface PiUsageLike {
  readonly input: number
  readonly output: number
  readonly cacheRead: number
  readonly cacheWrite: number
  readonly totalTokens: number
}

/** Structural pi-ai assistant content block (text/thinking/toolCall). */
interface PiContentBlockLike {
  readonly type: string
  readonly text?: string
  readonly thinking?: string
  readonly id?: string
  readonly name?: string
  readonly arguments?: unknown
}

/** Structural pi-ai assistant message (dist/types.d.ts AssistantMessage). */
interface PiAssistantMessageLike {
  readonly content: readonly PiContentBlockLike[]
  readonly model: string
  readonly provider?: string
  readonly api?: string
  readonly responseModel?: string
  readonly responseId?: string
  readonly providerThinkingLevel?: string
  readonly usage: PiUsageLike
  readonly stopReason: string
  readonly errorMessage?: string
}

/** Structural pi-ai assistant event (dist/types.d.ts AssistantMessageEvent). */
type PiEventLike =
  | { readonly type: 'start'; readonly partial: PiAssistantMessageLike }
  | { readonly type: 'text_start'; readonly contentIndex: number; readonly partial: PiAssistantMessageLike }
  | { readonly type: 'text_delta'; readonly contentIndex: number; readonly delta: string; readonly partial: PiAssistantMessageLike }
  | { readonly type: 'text_end'; readonly contentIndex: number; readonly content: string; readonly partial: PiAssistantMessageLike }
  | { readonly type: 'thinking_start'; readonly contentIndex: number; readonly partial: PiAssistantMessageLike }
  | { readonly type: 'thinking_delta'; readonly contentIndex: number; readonly delta: string; readonly partial: PiAssistantMessageLike }
  | { readonly type: 'thinking_end'; readonly contentIndex: number; readonly content: string; readonly partial: PiAssistantMessageLike }
  | { readonly type: 'toolcall_start'; readonly contentIndex: number; readonly partial: PiAssistantMessageLike }
  | { readonly type: 'toolcall_delta'; readonly contentIndex: number; readonly delta: string; readonly partial: PiAssistantMessageLike }
  | { readonly type: 'toolcall_end'; readonly contentIndex: number; readonly toolCall: { readonly id: string; readonly name: string; readonly arguments: unknown } }
  | { readonly type: 'done'; readonly message: PiAssistantMessageLike }
  | { readonly type: 'error'; readonly error: PiAssistantMessageLike }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Read one event's `type` safely (structural input). @internal */
function eventType(event: unknown): string | undefined {
  return isRecord(event) && typeof event.type === 'string' ? event.type : undefined
}

// ---------------------------------------------------------------------------
// Twins (ported; provenance in the module docstring).
// ---------------------------------------------------------------------------

/**
 * Map pi-ai usage to the harness counts (official stream.ts:24-32). The
 * reasoning tokens are already folded into `output` by pi-ai; the cache
 * fields ride ONLY when non-zero (pi-ai reports zeros, not absence), keeping
 * the harness TokenUsage three-count semantics intact (F5.6).
 */
export function mapUsageTwins(usage: unknown): unknown {
  if (!isRecord(usage)) {
    return { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
  }
  const input = typeof usage.input === 'number' ? usage.input : 0
  const output = typeof usage.output === 'number' ? usage.output : 0
  const total = typeof usage.totalTokens === 'number' ? usage.totalTokens : input + output
  const cacheRead = typeof usage.cacheRead === 'number' ? usage.cacheRead : 0
  const cacheWrite = typeof usage.cacheWrite === 'number' ? usage.cacheWrite : 0
  return {
    inputTokens: input,
    outputTokens: output,
    totalTokens: total,
    ...(cacheRead > 0 ? { cacheReadTokens: cacheRead } : {}),
    ...(cacheWrite > 0 ? { cacheWriteTokens: cacheWrite } : {}),
  }
}

/**
 * Classify a flattened pi-ai error message (official stream.ts:42-68 port —
 * module-private upstream, so this twin is the ONLY classifier for the
 * adapter's catch path regardless of the mapping source). pi-ai flattens the
 * caught error to `error.message` upstream (anthropic-messages.js), dropping
 * the cause chain; the actionable undici detail (`terminated`, "Premature
 * close") reaches us as terse words, hence the text matching.
 */
export function classifyPiAiErrorTwins(message: string, deps: MappingDeps): string {
  if (/\b(?:401|403)\b/.test(message)) return 'AUTH'
  if (deps.isQuotaExceededError(message)) return deps.QUOTA_EXCEEDED_CODE
  if (/\b429\b|rate.?limit/i.test(message)) return 'RATE_LIMIT'
  // A rejected request body (gateway or provider size cap): resending the
  // same request cannot succeed, so it is invalid, not transient.
  if (/\b413\b|failed to buffer the request body:\s*length limit exceeded|payload too large|request body too large/i.test(message)) {
    return 'INVALID_REQUEST'
  }
  if (/\b400\b|invalid.?request/i.test(message)) return 'INVALID_REQUEST'
  if (/\b5\d\d\b/.test(message)) return 'SERVER'
  if (/\btime(?:d)?\s*out\b|timeout/i.test(message)) return 'TIMEOUT'
  // A stream truncated before the provider's terminal event: each pi-ai
  // provider throws its own wording when the wire closes mid-response
  // (`… stream ended before message_stop`, `… ended without a terminal
  // event`, `Stream ended without finish_reason`). The connection dropped
  // mid-response → transport truncation, not a model-level error.
  if (/stream ended (?:before|without)\b/i.test(message)) return 'TRANSPORT'
  if (
    /\b(?:network|connection|socket|fetch)\b|\bECONN[A-Z]+\b/i.test(message)
    || /\b(?:other side closed|HTTP2 request did not get a response|WebSocket closed unexpectedly)\b/i.test(message)
    // undici renders a mid-stream socket drop as a bare `terminated` (its
    // `cause` — the real SocketError — was flattened away upstream); Node's
    // stream layer says "Premature close".
    || /\bterminated\b|premature close/i.test(message)
  ) {
    return 'TRANSPORT'
  }
  return 'PI_AI_ERROR'
}

/**
 * Map a terminal pi-ai message to the harness finish reason (official
 * stream.ts:80-128). Recognized overflow text, `stop` usage above
 * `contextWindow`, and zero-output `length` usage that fills the window all
 * map to CONTEXT_WINDOW_EXCEEDED; a `stop` with no content blocks maps to an
 * EMPTY_RESPONSE error; terminal `pending`/`deferred` map to non-retryable
 * PI_AI_ERROR failures (F5.3/F5.4).
 */
export function mapStopReasonTwins(
  message: unknown,
  deps: MappingDeps,
  isContextOverflow: (message: unknown, contextWindow?: number) => boolean,
  contextWindow?: number,
): unknown {
  if (!isRecord(message)) {
    return { kind: 'error', failure: { message: 'pi-ai terminal event carried no message', code: 'PI_AI_ERROR' } }
  }
  const piOverflow = isContextOverflow(message, contextWindow)
  const errorMessage = typeof message.errorMessage === 'string' ? message.errorMessage : undefined
  const harnessOverflow = message.stopReason === 'error' && errorMessage !== undefined && deps.isContextWindowExceededError(errorMessage)
  if (piOverflow || harnessOverflow) {
    return {
      kind: 'error',
      failure: {
        message: errorMessage ?? `pi-ai detected context overflow for model "${String(message.model)}"`,
        code: deps.CONTEXT_WINDOW_EXCEEDED_CODE,
      },
    }
  }
  const content = Array.isArray(message.content) ? message.content : []
  switch (message.stopReason) {
    case 'stop':
      // A terminal stop that produced no content blocks is a degenerate
      // provider completion, not a successful (empty) assistant message.
      if (content.length === 0) {
        return {
          kind: 'error',
          failure: {
            message: `model "${String(message.model)}" returned a completed response with no content`,
            code: deps.EMPTY_RESPONSE_CODE,
          },
        }
      }
      return { kind: 'stop' }
    case 'length': return { kind: 'max-tokens' }
    case 'toolUse': return { kind: 'tool-calls' }
    case 'pending': return {
      kind: 'error',
      failure: { message: `pi-ai stream for model "${String(message.model)}" ended pending`, code: 'PI_AI_ERROR' },
    }
    case 'deferred': return {
      kind: 'error',
      failure: { message: `pi-ai deferred response for model "${String(message.model)}" is not supported`, code: 'PI_AI_ERROR' },
    }
    case 'aborted': return {
      kind: 'aborted',
      failure: { message: errorMessage ?? 'pi-ai stream aborted', code: 'ABORTED' },
    }
    case 'error': {
      const text = errorMessage ?? 'pi-ai stream error'
      return { kind: 'error', failure: { message: text, code: classifyPiAiErrorTwins(text, deps) } }
    }
    default: return {
      kind: 'error',
      failure: { message: `pi-ai stop reason "${String(message.stopReason)}" is not representable`, code: 'PI_AI_ERROR' },
    }
  }
}

/**
 * Translate the pi-ai event stream into harness StreamChunks (official
 * stream.ts:142-234). pi-ai never throws mid-stream — failures arrive as
 * `error` events and become error/aborted finish chunks (the harness's other
 * sanctioned error path besides throwing). Ends with `usage` then `finish`;
 * throws LlmError STREAM_CLOSED when the source ends without a terminal
 * event. Caller cancellation turns an in-band terminal error into an aborted
 * finish (official semantics).
 */
export async function* toStreamChunksTwins(
  events: AsyncIterable<unknown>,
  deps: MappingDeps,
  isContextOverflow: (message: unknown, contextWindow?: number) => boolean,
  contextWindow?: number,
  callerSignal?: AbortSignal,
  requestedModel?: string,
): AsyncGenerator<unknown> {
  // pi-ai contentIndex ↔ harness block index 1:1 (both count blocks from 0
  // in stream order); ids are tracked per index for tool calls.
  const toolIds = new Map<number, { id: string; name: string }>()
  for await (const raw of events) {
    switch (eventType(raw)) {
      case 'start':
        break
      case 'text_start':
        yield { type: 'block-start', index: (raw as { contentIndex: number }).contentIndex, blockType: 'text' }
        break
      case 'text_delta':
        yield { type: 'text-delta', index: (raw as { contentIndex: number }).contentIndex, text: (raw as { delta: string }).delta }
        break
      case 'text_end':
        yield { type: 'block-end', index: (raw as { contentIndex: number }).contentIndex, block: { type: 'text', text: (raw as { content: string }).content } }
        break
      case 'thinking_start':
        yield { type: 'block-start', index: (raw as { contentIndex: number }).contentIndex, blockType: 'reasoning' }
        break
      case 'thinking_delta':
        yield { type: 'reasoning-delta', index: (raw as { contentIndex: number }).contentIndex, text: (raw as { delta: string }).delta }
        break
      case 'thinking_end':
        yield { type: 'block-end', index: (raw as { contentIndex: number }).contentIndex, block: { type: 'reasoning', text: (raw as { content: string }).content } }
        break
      case 'toolcall_start': {
        // The id/name live on the partial's content at this index.
        const event = raw as { contentIndex: number; partial: PiAssistantMessageLike }
        const partial = event.partial?.content?.[event.contentIndex]
        const id = partial?.type === 'toolCall' ? (partial.id ?? '') : ''
        const name = partial?.type === 'toolCall' ? (partial.name ?? '') : ''
        toolIds.set(event.contentIndex, { id, name })
        yield { type: 'block-start', index: event.contentIndex, blockType: 'tool-call' }
        break
      }
      case 'toolcall_delta': {
        const event = raw as { contentIndex: number; delta: string }
        const known = toolIds.get(event.contentIndex)
        yield {
          type: 'tool-call-delta',
          index: event.contentIndex,
          id: known?.id ?? '',
          ...(known?.name !== undefined && known.name.length > 0 ? { name: known.name } : {}),
          argumentsDelta: event.delta,
        }
        break
      }
      case 'toolcall_end': {
        const event = raw as { contentIndex: number; toolCall: { id: string; name: string; arguments: unknown } }
        yield {
          type: 'block-end',
          index: event.contentIndex,
          block: {
            type: 'tool-call',
            id: event.toolCall.id,
            name: event.toolCall.name,
            // pi-ai hands back the PARSED arguments; the harness vocabulary
            // keeps the raw string (F5.1) — re-stringified here.
            arguments: JSON.stringify(event.toolCall.arguments),
          },
        }
        break
      }
      case 'done': {
        const message = (raw as { message: PiAssistantMessageLike }).message
        yield { type: 'usage', usage: mapUsageTwins(message.usage) }
        yield {
          type: 'finish',
          reason: mapStopReasonTwins(message, deps, isContextOverflow, contextWindow),
          replayState: toPiReplayStateTwins(message, requestedModel),
        }
        return
      }
      case 'error': {
        // In-stream error delivery (pi-ai's style) → usage (what the provider
        // reported before failing) then the error finish chunk.
        const error = (raw as { error: PiAssistantMessageLike }).error
        yield { type: 'usage', usage: mapUsageTwins(error.usage) }
        yield {
          type: 'finish',
          reason: mapStopReasonTwins(
            callerSignal?.aborted ? { ...error, stopReason: 'aborted' } : error,
            deps,
            isContextOverflow,
            contextWindow,
          ),
        }
        return
      }
      default:
        // Unknown event type: skip silently is NOT honest — but the official
        // implementation exhausts a CLOSED union. A structural unknown event
        // (version drift) yields nothing; the STREAM_CLOSED guard below
        // catches a stream that then never terminates.
        break
    }
  }
  throw new deps.LlmError('pi-ai event stream ended without done/error', 'STREAM_CLOSED')
}

// ---------------------------------------------------------------------------
// Replay envelope twin (official replay.ts:16-110 port; consume side lives in
// replay.ts — the twins here only EMIT so the adapter's own history replays
// through the shared consume twin).
// ---------------------------------------------------------------------------

/** Per-block half of the pi-ai replay envelope (official replay.ts:16-19). */
type PiAiReplayBlockTwins =
  | { type: 'text'; textSignature?: string }
  | { type: 'reasoning'; thinkingSignature?: string; redacted?: boolean }
  | { type: 'tool-call'; thoughtSignature?: string; namespace?: string }

/**
 * Project a successful pi-ai response into the minimal durable replay state
 * (official replay.ts:77-110). The per-block half is index-aligned with the
 * streamed blocks, so BlockAssembler prunes an entry with its block.
 */
export function toPiReplayStateTwins(message: unknown, requestedModel?: string): unknown {
  if (!isRecord(message)) return undefined
  const content = Array.isArray(message.content) ? message.content : []
  const response: Record<string, unknown> = {
    kind: 'pi-ai',
    version: 2,
    api: message.api,
    provider: message.provider,
    model: requestedModel ?? message.model,
    ...(typeof message.responseModel === 'string' ? { responseModel: message.responseModel } : {}),
    ...(typeof message.responseId === 'string' ? { responseId: message.responseId } : {}),
    ...(typeof message.providerThinkingLevel === 'string' ? { providerThinkingLevel: message.providerThinkingLevel } : {}),
    stopReason: message.stopReason,
  }
  return {
    response,
    blocks: content.map((block): PiAiReplayBlockTwins => {
      switch (block.type) {
        case 'text': return {
          type: 'text',
          ...typeof block.textSignature === 'string' ? { textSignature: block.textSignature } : {},
        }
        case 'thinking': return {
          type: 'reasoning',
          ...typeof block.thinkingSignature === 'string' ? { thinkingSignature: block.thinkingSignature } : {},
          ...typeof block.redacted === 'boolean' ? { redacted: block.redacted } : {},
        }
        case 'toolCall': return {
          type: 'tool-call',
          ...typeof block.thoughtSignature === 'string' ? { thoughtSignature: block.thoughtSignature } : {},
          ...typeof block.namespace === 'string' ? { namespace: block.namespace } : {},
        }
        default: return { type: 'text' } // unreachable for the closed pi-ai union; validated downstream
      }
    }),
  }
}

// ---------------------------------------------------------------------------
// The labeled twins face is assembled in twins.ts (this module stays a pure
// leaf: pieces only, no assembly, no cross-module wiring).
// ---------------------------------------------------------------------------
