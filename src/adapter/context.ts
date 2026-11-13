/**
 * Harness request-history → pi-ai Context conversion twin — the port of the
 * official llm-pi-ai/src/context.ts TEXT-ONLY path (labeled `zctx-mapping`).
 *
 * SCOPE BOUNDARY (honest, card product 6): the S2 adapter is TEXT-ONLY — any
 * image block in the request throws UNSUPPORTED_CONTENT BEFORE conversion
 * (the adapter has no durable attachment service to resolve image bytes
 * through, so the official image path would be dead code here). This twin
 * therefore ports the text-only conversion only and keeps the official
 * defensive throws for images that slip past the adapter's gating.
 * The official context.ts module is NOT imported (its module top pulls
 * `@deepseek-ai/dsh-attachment` transitively — a dependency the text-only
 * scope does not need and the deployed host may not resolve for us).
 *
 * PORT PROVENANCE (honest anchors):
 *   - flattenText          — official src/context.ts:23-28
 *   - assertSupportedHistory — official src/context.ts:50-65
 *   - toolResultOf         — official src/context.ts:32-47
 *   - piTool / toolsOf     — official src/context.ts:131-137 (deferLoading
 *                            tools stay out of the wire declaration)
 *   - splitSystemPrompt    — official src/context.ts:148-158
 *   - piContext            — official src/context.ts:161-168
 *   - appendDeveloper      — official src/context.ts:171-201
 *   - appendAssistant      — official src/context.ts:203-214 (via the
 *                            replay consume twin)
 *   - textOnlyContext      — official src/context.ts:240-257
 *
 * The adapter receives POST-projection messages (F6.2: file→handle text and
 * tool projection already ran upstream), so no file handling exists here —
 * a file block reaching this twin is an invariant violation and fails loud.
 *
 * @module adapter/context
 */

import type { MappingDeps } from './map.ts'
import { toPiAssistantTwins } from './replay.ts'

/** Structural harness request message. */
interface RequestMessageLike {
  readonly role: string
  readonly content: readonly Record<string, unknown>[]
  /** Tool-role messages carry the call id and error flag (official Message). */
  readonly toolCallId?: string
  readonly isError?: boolean
}

/** Structural GenerateOptions subset the conversion consumes. */
interface GenerateOptionsLike {
  readonly messages: readonly RequestMessageLike[]
  readonly system?: unknown
  readonly tools?: readonly Record<string, unknown>[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function flattenText(message: RequestMessageLike): string {
  return contentBlocks(message)
    .filter((block) => block['type'] === 'text')
    .map((block) => (typeof block['text'] === 'string' ? block['text'] : ''))
    .join('')
}

/**
 * The typed blocks of one message. A plain-string content normalizes to ONE
 * text block (the harness allows string user content; the official walkers
 * assume block arrays, this twin is defensive without dropping content).
 * @internal
 */
function contentBlocks(message: RequestMessageLike): readonly Record<string, unknown>[] {
  if (Array.isArray(message.content)) return message.content
  if (typeof message.content === 'string') return [{ type: 'text', text: message.content }]
  return []
}

function contentHasType(message: RequestMessageLike, type: string): boolean {
  return contentBlocks(message).some((block) => block['type'] === type)
}

/** Reject misplaced tool-change blocks and unsupported image roles (official context.ts:50-65). */
function assertSupportedHistory(messages: readonly RequestMessageLike[], deps: MappingDeps): void {
  for (const message of messages) {
    if (
      message.role !== 'developer'
      && contentBlocks(message).some((block) => block['type'] === 'tool-addition' || block['type'] === 'tool-removal')
    ) {
      throw new deps.LlmError('Tool-change blocks require developer role', 'UNSUPPORTED_CONTENT')
    }
    if (message.role !== 'user' && message.role !== 'tool' && contentHasType(message, 'image')) {
      throw new deps.LlmError(
        `pi-ai cannot represent an image in an in-history ${message.role} message`,
        'UNSUPPORTED_CONTENT',
      )
    }
    if (message.role === 'system' && message.content.some((block) => block['type'] !== 'text')) {
      throw new deps.LlmError('pi-ai cannot represent non-text system messages', 'UNSUPPORTED_CONTENT')
    }
  }
}

/** Recover the pi-ai toolResult message for one harness tool-role message (official context.ts:32-47). */
function toolResultOf(
  message: RequestMessageLike,
  toolNames: Map<string, string>,
  content: string,
): unknown {
  return {
    role: 'toolResult',
    toolCallId: message.toolCallId,
    toolName: toolNames.get(message.toolCallId ?? '') ?? 'unknown',
    content: [{ type: 'text', text: content || '(no output)' }],
    isError: message.isError === true,
    timestamp: 0,
  }
}

/** Convert a projected declaration without its harness-owned activation marker (official context.ts:131-133). */
function piTool(tool: Record<string, unknown>): unknown {
  return { name: tool['name'], description: tool['description'], parameters: tool['parameters'] }
}

function toolsOf(options: GenerateOptionsLike): unknown[] | undefined {
  return options.tools?.filter((tool) => tool['deferLoading'] !== true).map(piTool)
}

/** The request split into pi-ai's initial `systemPrompt` slot and the history (official context.ts:139-158). */
function splitSystemPrompt(options: GenerateOptionsLike): { systemPrompt: string | undefined; messages: readonly RequestMessageLike[] } {
  const text = [options.system]
  let end = 0
  for (const message of options.messages) {
    if (message.role !== 'system') break
    text.push(flattenText(message))
    end++
  }
  const systemPrompt = text.filter(Boolean).join('\n\n')
  return { systemPrompt: systemPrompt || undefined, messages: options.messages.slice(end) }
}

/** Assemble the request-level pi-ai context envelope (official context.ts:161-168). */
function piContext(systemPrompt: string | undefined, options: GenerateOptionsLike, messages: unknown[]): unknown {
  const tools = toolsOf(options)
  return {
    ...(systemPrompt !== undefined ? { systemPrompt } : {}),
    messages,
    ...(tools !== undefined && tools.length > 0 ? { tools } : {}),
  }
}

/** Keep one developer event in one system update (official context.ts:171-201). */
function appendDeveloper(
  message: RequestMessageLike,
  options: GenerateOptionsLike,
  messages: unknown[],
  deps: MappingDeps,
): void {
  const content: Record<string, unknown>[] = []
  const toolsAdded: unknown[] = []
  const toolsRemoved: unknown[] = []
  for (const block of message.content) {
    switch (block['type']) {
      case 'text':
        if (typeof block['text'] === 'string' && block['text'].length > 0) content.push({ type: 'text', text: block['text'] })
        break
      case 'tool-addition': {
        const toolName = typeof block['toolName'] === 'string' ? block['toolName'] : ''
        const tool = options.tools?.find((tool) => tool['name'] === toolName)
        if (tool === undefined) {
          throw new deps.LlmError(`pi-ai tool update references undeclared tool "${toolName}"`, 'INVALID_REQUEST')
        }
        toolsAdded.push(piTool(tool))
        break
      }
      case 'tool-removal':
        toolsRemoved.push({ name: block['toolName'] })
        break
      default:
        throw new deps.LlmError(`pi-ai cannot represent developer content ${String(block['type'])}`, 'UNSUPPORTED_CONTENT')
    }
  }
  if (content.length === 0 && toolsAdded.length === 0 && toolsRemoved.length === 0) return
  messages.push({
    role: 'system',
    content,
    timestamp: 0,
    ...(toolsAdded.length === 0 ? {} : { toolsAdded }),
    ...(toolsRemoved.length === 0 ? {} : { toolsRemoved }),
  })
}

/** Append one assistant message through the replay consume twin (official context.ts:203-214). */
function appendAssistant(
  message: unknown,
  messages: unknown[],
  toolNames: Map<string, string>,
  deps: MappingDeps,
  onDegrade?: (reason: string) => void,
): void {
  const assistant = toPiAssistantTwins(message, deps, onDegrade)
  const content = (assistant as { content?: { type: string; id?: string; name?: string }[] })?.content ?? []
  for (const block of content) {
    if (block.type === 'toolCall' && typeof block.id === 'string') toolNames.set(block.id, block.name ?? 'unknown')
  }
  messages.push(assistant)
}

/** Append shared system, developer, and assistant roles; true when consumed (official context.ts:217-238). */
function appendSharedHistory(
  message: RequestMessageLike,
  options: GenerateOptionsLike,
  messages: unknown[],
  toolNames: Map<string, string>,
  deps: MappingDeps,
  onDegrade?: (reason: string) => void,
): boolean {
  if (message.role === 'developer') {
    appendDeveloper(message, options, messages, deps)
    return true
  }
  if (message.role === 'system') {
    const content = flattenText(message)
    if (content.length > 0) messages.push({ role: 'system', content, timestamp: 0 })
    return true
  }
  if (message.role === 'assistant') {
    appendAssistant(message, messages, toolNames, deps, onDegrade)
    return true
  }
  return false
}

/**
 * Convert text-only harness history to a synchronous pi-ai Context (official
 * context.ts:240-257). Tool result names are recovered from preceding
 * assistant tool calls. Images in ANY history role throw UNSUPPORTED_CONTENT
 * (the S2 adapter has no attachment service; the stream-level gate throws
 * first — this is the defensive mirror).
 */
export function toPiContextTextOnly(
  options: unknown,
  deps: MappingDeps,
  onDegrade?: (reason: string) => void,
): unknown {
  if (!isRecord(options)) {
    throw new deps.LlmError('zctx adapter requires GenerateOptions-like input', 'INVALID_REQUEST')
  }
  const harness = options as unknown as GenerateOptionsLike
  if (!Array.isArray(harness.messages)) {
    throw new deps.LlmError('zctx adapter requires GenerateOptions.messages', 'INVALID_REQUEST')
  }
  assertSupportedHistory(harness.messages, deps)
  const split = splitSystemPrompt(harness)
  const toolNames = new Map<string, string>()
  const messages: unknown[] = []
  for (const message of split.messages) {
    if (contentHasType(message, 'image')) {
      throw new deps.LlmError('pi-ai image conversion requires the durable attachment service', 'UNSUPPORTED_CONTENT')
    }
    if (contentHasType(message, 'file')) {
      // The adapter receives POST-projection messages (F6.2): a file block
      // here means the upstream projection invariant broke — fail loud.
      throw new deps.LlmError('zctx adapter received an unprojected file block', 'INVALID_REQUEST')
    }
    if (appendSharedHistory(message, harness, messages, toolNames, deps, onDegrade)) continue
    if (message.role === 'tool') {
      messages.push(toolResultOf(message, toolNames, flattenText(message)))
      continue
    }
    messages.push({ role: 'user', content: flattenText(message), timestamp: 0 })
  }
  return piContext(split.systemPrompt, harness, messages)
}
