/**
 * Optional host projection face — a fail-soft lazy loader for the official
 * request-projection helpers exported by `@deepseek-ai/dsh-llm`
 * (RES-observe-route a.3: "直接 import，杜绝假阳性第一类，Q5.2").
 *
 * Two behaviors, both honest about which one ran:
 *
 *  - host present → the OFFICIAL projectFilesToText /
 *    projectImagesForTextModel / projectToolUpdates / isAgentLoopRequest are
 *    used with their exact semantics (`projector: 'official'`). The U2 probe
 *    (scripts/probe-host-imports.mjs) pins that all four exports are live on
 *    the host build.
 *  - host absent (tests, mocks, stripped installs) → LOCAL MINIMAL fallback
 *    twins take over and every snapshot they produce is labeled
 *    `projector: 'local-fallback'` (the domain-field discipline the card
 *    freezes). The fallback twins are deterministic structural reductions —
 *    NOT the official wire forms — so the ledger never presents their hashes
 *    as official-normalized ones.
 *
 * Loading is lazy and memoized per process: the dynamic import runs on first
 * use and its result (success or fallback) is cached. `ZCTX_DSH_LLM` may
 * point the loader at an explicit host build (file path or file: URL) — the
 * same override convention scripts/probe-host-imports.mjs already uses —
 * which is how the official-path probe tests exercise the real exports
 * without installing the host into this repo.
 *
 * Zero static host imports: this module always loads (config.ts fail-soft
 * precedent), and callers probe the returned projector's `projector` field
 * instead of catching load errors.
 *
 * @module host-llm
 */

import { isAbsolute, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { sha256Hex, stableStringify } from './hash.ts'
import type { SnapshotProjector } from './types.ts'

/** Structural subset of the official ModelInfo the projection gating needs (llm/src/types.ts:320-345, :420). */
export interface HostModelInfoLike {
  /** Input modalities when known (official gating: images project away only for image-less models). */
  readonly inputModalities?: readonly string[]
  /** Tool-update routing capability ('in-history' | 'addition-only'); undefined = unsupported route. */
  readonly toolUpdate?: 'in-history' | 'addition-only'
  readonly context?: { readonly contextWindow?: number }
  readonly defaultMaxTokens?: number
}

/** One request message, structurally reduced (official Message | RequestUserInput). */
export type RequestMessageLike = Record<string, unknown>

/** One tool schema (official ToolSchema: name/description/parameters/deferLoading?). */
export type ToolSchemaLike = Record<string, unknown>

/** Structural twin of the official ProjectedToolUpdates (content.ts:424 return shape). */
export interface ProjectedToolUpdatesLike {
  readonly messages: readonly RequestMessageLike[]
  readonly tools: readonly ToolSchemaLike[] | undefined
}

/** Resolver callback mirroring the official projectFilesToText resolvePath parameter. */
export type ResolvePathLike = (ref: unknown) => string | undefined

/**
 * The projection face the V2 observe listener consumes. `projector` names
 * the implementation behind every method call so the ledger can label each
 * snapshot's normalization provenance.
 */
export interface HostProjector {
  readonly projector: SnapshotProjector
  /**
   * Official WeakSet identity check (call-config.ts:94-96) when the host is
   * present; the documented structural heuristic otherwise (see
   * {@link fallbackIsAgentLoopRequest}).
   */
  isAgentLoopRequest(options: unknown): boolean
  projectFilesToText(
    messages: readonly RequestMessageLike[],
    resolvePath: ResolvePathLike,
  ): readonly RequestMessageLike[]
  projectImagesForTextModel(messages: readonly RequestMessageLike[]): readonly RequestMessageLike[]
  projectToolUpdates(
    messages: readonly RequestMessageLike[],
    tools: readonly ToolSchemaLike[] | undefined,
    toolUpdate: 'in-history' | 'addition-only' | undefined,
    history?: unknown,
  ): ProjectedToolUpdatesLike
}

// ---------------------------------------------------------------------------
// Local fallback twins (host absent).
// ---------------------------------------------------------------------------

/**
 * FALLBACK main-chain heuristic — the host WeakSet identity is unavailable,
 * so a request "looks like" an agent-loop request when it carries a session
 * id and a message list (GenerateOptions.sessionId is loop-only, llm/src/
 * types.ts:546; one-shot requests are excluded by the listener's criterion 2
 * purpose check). KNOWN LIMITATION, honestly labeled via
 * `projector: 'local-fallback'`: a hand-built request that sets sessionId
 * without the host mark would false-positive here, and the true WeakSet
 * cannot be replicated from outside the host process.
 */
function fallbackIsAgentLoopRequest(options: unknown): boolean {
  if (options === null || typeof options !== 'object') return false
  const record = options as Record<string, unknown>
  return typeof record.sessionId === 'string' && Array.isArray(record.messages)
}

/** Deterministic identity text for a file attachment ref (fallback twin). */
function fallbackFileHandleText(ref: unknown): string {
  const record = ref !== null && typeof ref === 'object' ? (ref as Record<string, unknown>) : {}
  const name = typeof record.name === 'string' ? record.name : 'unknown'
  const bytes = typeof record.bytes === 'number' ? record.bytes : -1
  const attachmentId = typeof record.attachmentId === 'string' ? record.attachmentId : 'unknown'
  return `[zctx-fallback file ${JSON.stringify(name)} (${bytes} bytes, ${attachmentId})]`
}

/**
 * Replace every file content block with deterministic fallback handle text,
 * mirroring the official replaceFilesWithHandles walk (content.ts:160-176):
 * string content passes through; array content is copied lazily; the original
 * array reference returns when no file block exists (official contract).
 */
function replaceFilesWithFallbackHandles(
  blocks: readonly unknown[],
  resolvePath: ResolvePathLike,
): { blocks: readonly unknown[]; changed: boolean } {
  let next: unknown[] | undefined
  for (const [index, block] of blocks.entries()) {
    if (block !== null && typeof block === 'object' && (block as Record<string, unknown>).type === 'file') {
      const record = block as Record<string, unknown>
      const ref = record.attachment
      const resolved = resolvePath(ref)
      const text =
        resolved === undefined
          ? fallbackFileHandleText(ref)
          : `${fallbackFileHandleText(ref)} (resolved: ${resolved})`
      next ??= blocks.slice(0, index)
      next.push({ type: 'text', text })
      continue
    }
    next?.push(block)
  }
  return next === undefined
    ? { blocks, changed: false }
    : { blocks: next, changed: true }
}

/** Fallback projectFilesToText twin (official shape: original reference when unchanged). */
function fallbackProjectFilesToText(
  messages: readonly RequestMessageLike[],
  resolvePath: ResolvePathLike,
): readonly RequestMessageLike[] {
  if (!messages.some((message) => contentHasType(message, 'file'))) return messages
  return messages.map((message) => {
    const content = message.content
    if (typeof content === 'string') return message
    if (!Array.isArray(content)) return message
    const replaced = replaceFilesWithFallbackHandles(content, resolvePath)
    if (!replaced.changed) return message
    return { ...message, content: replaced.blocks }
  })
}

/** True when the message's typed content contains a block of the given type. */
function contentHasType(message: RequestMessageLike, type: string): boolean {
  const content = message.content
  if (!Array.isArray(content)) return false
  return content.some(
    (block) => block !== null && typeof block === 'object' && (block as Record<string, unknown>).type === type,
  )
}

/** Deterministic placeholder text for one image block (fallback twin). */
function fallbackImagePlaceholder(block: Record<string, unknown>): string {
  const ref = block.attachment
  const record = ref !== null && typeof ref === 'object' ? (ref as Record<string, unknown>) : {}
  const identity =
    typeof record.attachmentId === 'string'
      ? record.attachmentId
      : `sha256:${sha256Hex(stableStringify(block)).slice(0, 16)}`
  const bytes = typeof record.bytes === 'number' ? record.bytes : undefined
  return `[zctx-fallback image ${identity}${bytes === undefined ? '' : ` (${bytes} bytes)`}]`
}

/**
 * Fallback projectImagesForTextModel twin: replace every image block with a
 * deterministic text placeholder (official shape: original reference when no
 * image block exists). Identity comes from the attachment ref when present;
 * raw-data blocks without a ref degrade to a content-digest identity.
 */
function fallbackProjectImagesForTextModel(
  messages: readonly RequestMessageLike[],
): readonly RequestMessageLike[] {
  if (!messages.some((message) => contentHasType(message, 'image'))) return messages
  return messages.map((message) => {
    const content = message.content
    if (typeof content === 'string' || !Array.isArray(content)) return message
    let next: unknown[] | undefined
    for (const [index, block] of content.entries()) {
      if (block !== null && typeof block === 'object' && (block as Record<string, unknown>).type === 'image') {
        next ??= content.slice(0, index)
        next.push({ type: 'text', text: fallbackImagePlaceholder(block as Record<string, unknown>) })
        continue
      }
      next?.push(block)
    }
    if (next === undefined) return message
    return { ...message, content: next }
  })
}

/**
 * Fallback projectToolUpdates twin — the minimal honest reduction of the
 * official semantics for `toolUpdate: undefined` routes (content.ts:430-438):
 * strip developer messages (update blocks are unroutable without the host's
 * capability knowledge) and strip deferLoading markers from the declared
 * tools. With a toolUpdate capability the fallback passes messages through
 * and keeps the declared tools (routing needs the host's history resolution).
 */
function fallbackProjectToolUpdates(
  messages: readonly RequestMessageLike[],
  tools: readonly ToolSchemaLike[] | undefined,
  toolUpdate: 'in-history' | 'addition-only' | undefined,
): ProjectedToolUpdatesLike {
  if (toolUpdate !== undefined) return { messages, tools }
  const filtered = messages.filter((message) => message.role !== 'developer')
  let immediateTools = tools
  if (tools?.some((tool) => (tool as Record<string, unknown>).deferLoading === true)) {
    immediateTools = tools.map((tool) => {
      const { deferLoading: _loading, ...rest } = tool as Record<string, unknown> & { deferLoading?: true }
      return rest as ToolSchemaLike
    })
  }
  return { messages: filtered, tools: immediateTools }
}

/** The fallback projector (host absent) — every snapshot it touches is labeled. */
const FALLBACK_PROJECTOR: HostProjector = {
  projector: 'local-fallback',
  isAgentLoopRequest: fallbackIsAgentLoopRequest,
  projectFilesToText: fallbackProjectFilesToText,
  projectImagesForTextModel: fallbackProjectImagesForTextModel,
  projectToolUpdates: fallbackProjectToolUpdates,
}

// ---------------------------------------------------------------------------
// Official projector adapter (host present).
// ---------------------------------------------------------------------------

/** Minimal structural surface of the @deepseek-ai/dsh-llm exports we consume. */
interface DshLlmModule {
  isAgentLoopRequest?: (options: unknown) => boolean
  projectFilesToText?: (
    messages: readonly RequestMessageLike[],
    resolvePath: ResolvePathLike,
  ) => readonly RequestMessageLike[]
  projectImagesForTextModel?: (messages: readonly RequestMessageLike[]) => readonly RequestMessageLike[]
  projectToolUpdates?: (
    messages: readonly RequestMessageLike[],
    tools: readonly ToolSchemaLike[] | undefined,
    toolUpdate: 'in-history' | 'addition-only' | undefined,
    history?: unknown,
  ) => ProjectedToolUpdatesLike
}

/**
 * Wrap the host module's exports into the structural face. A host build that
 * is on disk but misses a specific export (version drift) degrades THAT
 * function to the fallback twin while the rest stays official — the
 * projector label then honestly downgrades to 'local-fallback' for the whole
 * face (a mixed label would understate the divergence risk).
 */
function buildOfficialProjector(mod: DshLlmModule): HostProjector {
  const complete =
    typeof mod.isAgentLoopRequest === 'function'
    && typeof mod.projectFilesToText === 'function'
    && typeof mod.projectImagesForTextModel === 'function'
    && typeof mod.projectToolUpdates === 'function'
  if (!complete) return FALLBACK_PROJECTOR
  return {
    projector: 'official',
    isAgentLoopRequest: (options) => (mod.isAgentLoopRequest as (o: unknown) => boolean)(options),
    projectFilesToText: (messages, resolvePath) =>
      (mod.projectFilesToText as NonNullable<DshLlmModule['projectFilesToText']>)(messages, resolvePath),
    projectImagesForTextModel: (messages) =>
      (mod.projectImagesForTextModel as NonNullable<DshLlmModule['projectImagesForTextModel']>)(messages),
    projectToolUpdates: (messages, tools, toolUpdate, history) =>
      (mod.projectToolUpdates as NonNullable<DshLlmModule['projectToolUpdates']>)(messages, tools, toolUpdate, history),
  }
}

// ---------------------------------------------------------------------------
// Lazy loader (memoized).
// ---------------------------------------------------------------------------

const HOST_MODULE_SPECIFIER = '@deepseek-ai/dsh-llm'

let cached: Promise<HostProjector> | undefined

/**
 * Resolve the host module specifier (or the ZCTX_DSH_LLM override) into an
 * importable specifier. Absolute paths convert to file: URLs; the override
 * accepts a file: URL or an absolute path (probe convention). @internal
 */
function resolveHostSpecifier(): string {
  const override = process.env.ZCTX_DSH_LLM
  if (override === undefined || override === '') return HOST_MODULE_SPECIFIER
  if (override.startsWith('file:')) return override
  if (isAbsolute(override)) return pathToFileURL(resolve(override)).href
  return override
}

/**
 * Load the host projector once per process: the official face when
 * `@deepseek-ai/dsh-llm` resolves (bare specifier inside the host tree, or
 * the ZCTX_DSH_LLM override), the labeled fallback face otherwise. Never
 * throws — a failed load IS the fallback decision.
 */
export function loadHostProjector(): Promise<HostProjector> {
  cached ??= (async () => {
    try {
      const mod = (await import(resolveHostSpecifier())) as DshLlmModule
      const projector = buildOfficialProjector(mod)
      return projector
    } catch {
      return FALLBACK_PROJECTOR
    }
  })()
  return cached
}

/**
 * Drop the memoized loader result (TEST-ONLY seam: the two-path probe tests
 * need one loader call per path, and process-global memoization would fuse
 * them). Not part of the plugin's public surface.
 */
export function resetHostProjectorCacheForTest(): void {
  cached = undefined
}
