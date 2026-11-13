/**
 * Durable pi-ai replay metadata consume-side twin — the port of the official
 * llm-pi-ai/src/replay.ts reconstruction path (labeled `zctx-mapping`), used
 * when the official TS sources do not resolve (RES-adapter-route F5.9).
 *
 * PORT PROVENANCE (honest anchors):
 *   - readReplayState   — official src/replay.ts:112-158 (versioned envelope
 *                         validation; kind 'pi-ai' + version 2; mismatch →
 *                         LlmError INVALID_REPLAY_STATE).
 *   - foreignAssistant  — official src/replay.ts:160-196 (provider-neutral
 *                         conversion with api 'dsh-foreign'; "absent replay
 *                         state is foreign even if source names the same
 *                         provider/model as this request").
 *   - replayedAssistant — official src/replay.ts:198-237 (durable content +
 *                         validated signatures recombined; block-count and
 *                         per-index type agreement enforced).
 *   - toPiAssistant     — official src/replay.ts:247-259 (absent/unusable
 *                         replay state degrades ONE message to neutral
 *                         history instead of failing the request).
 *
 * The emit twin (toPiReplayStateTwins) lives in map.ts; both halves share the
 * SAME envelope schema (kind 'pi-ai' version 2), so a history written by the
 * OFFICIAL llm-pi-ai adapter replays through this twin too, and vice versa.
 *
 * @module adapter/replay
 */

import type { MappingDeps } from './map.ts'

/** Structural harness assistant content block (text/reasoning/tool-call). */
interface HarnessAssistantBlockLike {
  readonly type: string
  readonly text?: string
  readonly id?: string
  readonly name?: string
  readonly arguments?: string
}

/** Structural harness assistant message with its adapter-private source. */
interface HarnessAssistantMessageLike {
  readonly content: readonly HarnessAssistantBlockLike[]
  readonly source: {
    readonly provider: string
    readonly model: string
    readonly replayState?: unknown
  }
}

/** Per-block half of the pi-ai replay envelope (official replay.ts:16-19). */
type PiAiReplayBlock =
  | { type: 'text'; textSignature?: string }
  | { type: 'reasoning'; thinkingSignature?: string; redacted?: boolean }
  | { type: 'tool-call'; thoughtSignature?: string; namespace?: string }

/** The validated halves of one pi-ai replay envelope (official replay.ts:38-41). */
interface PiAiReplayState {
  readonly response: {
    readonly api: string
    readonly provider: string
    readonly model: string
    readonly responseModel?: string
    readonly responseId?: string
    readonly providerThinkingLevel?: string
    readonly stopReason: string
  }
  readonly blocks: readonly PiAiReplayBlock[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Parse tool-call argument JSON; tolerate model malformations with {} (official replay.ts:44-54). */
function parseArguments(raw: unknown): unknown {
  if (typeof raw !== 'string') return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) return parsed
  } catch {
    // fall through
  }
  return {}
}

/** Construct the zero usage value required by historical pi-ai messages (official replay.ts:57-66). */
function emptyPiUsage(): unknown {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  }
}

function invalidReplay(deps: MappingDeps, message: string): never {
  throw new deps.LlmError(`invalid pi-ai replay state: ${message}`, 'INVALID_REPLAY_STATE')
}

/** Validate the durable adapter-private envelope before it reaches pi-ai (official replay.ts:117-158). */
function readReplayState(value: unknown, deps: MappingDeps): PiAiReplayState {
  if (!isRecord(value)) invalidReplay(deps, 'expected a replay envelope')
  const envelope = value as Record<string, unknown>
  const rawResponse = envelope['response']
  if (!isRecord(rawResponse)) invalidReplay(deps, 'expected a response object')
  const response = rawResponse as Record<string, unknown>
  if (response['kind'] !== 'pi-ai') invalidReplay(deps, 'unknown state kind')
  if (response['version'] !== 2) invalidReplay(deps, `unsupported version ${String(response['version'])}`)
  for (const key of ['api', 'provider', 'model'] as const) {
    if (typeof response[key] !== 'string' || (response[key] as string).length === 0) {
      invalidReplay(deps, `${key} must be a non-empty string`)
    }
  }
  if (!['stop', 'length', 'toolUse', 'error', 'aborted'].includes(String(response['stopReason']))) {
    invalidReplay(deps, 'unknown stopReason')
  }
  for (const key of ['responseModel', 'responseId', 'providerThinkingLevel'] as const) {
    if (response[key] !== undefined && typeof response[key] !== 'string') {
      invalidReplay(deps, `${key} must be a string`)
    }
  }
  const rawBlocks: readonly unknown[] = Array.isArray(envelope['blocks'])
    ? envelope['blocks']
    : invalidReplay(deps, 'blocks must be an array')
  const blocks: PiAiReplayBlock[] = []
  for (const [index, value] of rawBlocks.entries()) {
    if (!isRecord(value)) invalidReplay(deps, `block ${index} must be an object`)
    const block = value as Record<string, unknown>
    if (!['text', 'reasoning', 'tool-call'].includes(String(block['type']))) {
      invalidReplay(deps, `block ${index} has an unknown type`)
    }
    for (const signature of ['textSignature', 'thinkingSignature', 'thoughtSignature', 'namespace'] as const) {
      if (block[signature] !== undefined && typeof block[signature] !== 'string') {
        invalidReplay(deps, `block ${index} ${signature} must be a string`)
      }
    }
    if (block['redacted'] !== undefined && typeof block['redacted'] !== 'boolean') {
      invalidReplay(deps, `block ${index} redacted must be boolean`)
    }
    blocks.push(block as unknown as PiAiReplayBlock)
  }
  return {
    response: {
      api: response['api'] as string,
      provider: response['provider'] as string,
      model: response['model'] as string,
      ...(response['responseModel'] !== undefined ? { responseModel: response['responseModel'] as string } : {}),
      ...(response['responseId'] !== undefined ? { responseId: response['responseId'] as string } : {}),
      ...(response['providerThinkingLevel'] !== undefined
        ? { providerThinkingLevel: response['providerThinkingLevel'] as string }
        : {}),
      stopReason: response['stopReason'] as string,
    },
    blocks,
  }
}

/** Convert provider-neutral blocks without trusting them as same-model replay (official replay.ts:160-196). */
function foreignAssistant(message: HarnessAssistantMessageLike, deps: MappingDeps): unknown {
  const content: Record<string, unknown>[] = []
  for (const block of message.content) {
    switch (block.type) {
      case 'text': content.push({ type: 'text', text: block.text ?? '' }); break
      case 'reasoning': content.push({ type: 'thinking', thinking: block.text ?? '' }); break
      case 'tool-call': content.push({
        type: 'toolCall',
        id: block.id,
        name: block.name,
        arguments: parseArguments(block.arguments),
      }); break
      case 'image':
        // pi-ai chat history cannot represent structured assistant image
        // output (official replay.ts:182-183; UNSUPPORTED_CONTENT is the
        // official literal — the code has no *_CODE export upstream).
        throw new deps.LlmError(
          'pi-ai chat history cannot represent structured assistant image output',
          'UNSUPPORTED_CONTENT',
        )
      default:
        // plugin-added block types are not representable in pi-ai.
        break
    }
  }
  return {
    role: 'assistant',
    content,
    // Deliberately never equals a catalog API: absent replay state is foreign
    // even if source names the same provider/model as this request.
    api: 'dsh-foreign',
    provider: message.source.provider,
    model: message.source.model,
    usage: emptyPiUsage(),
    stopReason: content.some((piece) => piece['type'] === 'toolCall') ? 'toolUse' : 'stop',
    timestamp: 0,
  }
}

/** Recombine durable Harness content with validated pi-ai replay metadata (official replay.ts:198-237). */
function replayedAssistant(message: HarnessAssistantMessageLike, rawState: unknown, deps: MappingDeps): unknown {
  const state = readReplayState(rawState, deps)
  if (state.response.provider !== message.source.provider) {
    throw new deps.LlmError('invalid pi-ai replay state: provider does not match assistant source', 'INVALID_REPLAY_STATE')
  }
  if (state.response.model !== message.source.model) {
    throw new deps.LlmError('invalid pi-ai replay state: model does not match assistant source', 'INVALID_REPLAY_STATE')
  }
  if (state.blocks.length !== message.content.length) {
    throw new deps.LlmError('invalid pi-ai replay state: block count does not match assistant content', 'INVALID_REPLAY_STATE')
  }
  const content = message.content.map((block, index) => {
    const replay = state.blocks[index]
    if (replay === undefined || replay.type !== block.type) {
      throw new deps.LlmError(`invalid pi-ai replay state: block ${index} does not match assistant content`, 'INVALID_REPLAY_STATE')
    }
    switch (block.type) {
      case 'text': return {
        type: 'text',
        text: block.text ?? '',
        ...(replay.type === 'text' && replay.textSignature !== undefined ? { textSignature: replay.textSignature } : {}),
      }
      case 'reasoning': return {
        type: 'thinking',
        thinking: block.text ?? '',
        ...(replay.type === 'reasoning' && replay.thinkingSignature !== undefined ? { thinkingSignature: replay.thinkingSignature } : {}),
        ...(replay.type === 'reasoning' && replay.redacted !== undefined ? { redacted: replay.redacted } : {}),
      }
      case 'tool-call': return {
        type: 'toolCall',
        id: block.id,
        name: block.name,
        arguments: parseArguments(block.arguments),
        ...(replay.type === 'tool-call' && replay.thoughtSignature !== undefined ? { thoughtSignature: replay.thoughtSignature } : {}),
        ...(replay.type === 'tool-call' && replay.namespace !== undefined ? { namespace: replay.namespace } : {}),
      }
      default:
        // readReplayState rejects unknown replay tags, so an equal
        // plugin-added Harness tag cannot reach this switch (official
        // replay.ts:220-221 note).
        throw new deps.LlmError(`invalid pi-ai replay state: block ${index} has an unsupported Harness type`, 'INVALID_REPLAY_STATE')
    }
  })
  return {
    role: 'assistant',
    content,
    api: state.response.api,
    provider: state.response.provider,
    model: state.response.model,
    ...(state.response.responseModel !== undefined ? { responseModel: state.response.responseModel } : {}),
    ...(state.response.responseId !== undefined ? { responseId: state.response.responseId } : {}),
    ...(state.response.providerThinkingLevel !== undefined
      ? { providerThinkingLevel: state.response.providerThinkingLevel }
      : {}),
    usage: emptyPiUsage(),
    stopReason: state.response.stopReason,
    timestamp: 0,
  }
}

/**
 * Convert one durable Harness assistant message into pi-ai history (official
 * replay.ts:247-259). Durable content is the authoritative record; replay
 * metadata only restores native fidelity (ids, signatures). A replay state
 * this build cannot use — another adapter's kind, another version, a
 * malformed value, or metadata that no longer matches the content — degrades
 * the ONE message to provider-neutral history instead of failing the request.
 */
export function toPiAssistantTwins(
  message: unknown,
  deps: MappingDeps,
  onDegrade?: (reason: string) => void,
): unknown {
  if (!isRecord(message) || !isRecord(message.source)) return message
  const harness = message as unknown as HarnessAssistantMessageLike
  if (!Array.isArray(harness.content)) return message
  const source = harness.source
  if (source.replayState === undefined) return foreignAssistant(harness, deps)
  try {
    return replayedAssistant(harness, source.replayState, deps)
  } catch (error: unknown) {
    // replayedAssistant throws only INVALID_REPLAY_STATE LlmErrors; the
    // guard keeps a future non-replay failure loud instead of silently
    // degrading it (official replay.ts:253-255).
    const isInvalidReplay =
      error instanceof deps.LlmError
      && (error as unknown as { code?: string }).code === 'INVALID_REPLAY_STATE'
    if (!isInvalidReplay) throw error
    onDegrade?.(error.message)
    return foreignAssistant(harness, deps)
  }
}
