/**
 * Optional host faces for the S2 adapter — fail-soft lazy loaders for the
 * three host surfaces the zctx adapter rides (task card V5 product 1/2;
 * RES-adapter-route F5.9 "借力清单", F7.4, U2 probe).
 *
 * Zero static host imports (the config.ts / host-llm.ts fail-soft precedent):
 * every loader dynamic-imports and returns `undefined` when the surface is
 * unreachable. The plugin wiring treats `undefined` as "adapter face is not
 * registrable" and logs honestly — the adapter face NEVER breaks boot.
 *
 * Three surfaces, each with its own probe convention:
 *
 *  1. `@deepseek-ai/dsh-llm` (BUILT lib) — the LlmAdapter abstract base the
 *     card requires (`ZctxAdapter extends LlmAdapter`), the official error
 *     taxonomy (LlmError, the *_CODE constants, the two overflow/quota
 *     classifiers) and attributionHeaders (F9.6). Override: `ZCTX_DSH_LLM`
 *     (same convention as host-llm.ts; U2 probe: 16/16 live on disk).
 *  2. `@earendil-works/pi-ai` (1.0.2 dist, R8 anchor) — the transport engine:
 *     `isContextOverflow` (utils/overflow re-exported from the root) and the
 *     per-protocol stream implementations (`./api/<protocol>` exporting
 *     `stream`/`streamSimple` directly — probed live, so the adapter calls
 *     the API module WITHOUT building a Models collection; coordinator note
 *     recorded on this finding). Override: `ZCTX_PIAI`.
 *  3. `@deepseek-ai/dsh-llm-pi-ai/src/{stream,replay}` (TS sources — the
 *     package publishes `exports ./src/*`) — the official chunk-mapping
 *     pieces (`toStreamChunks`/`mapUsage`/`mapStopReason`/`toPiReplayState`/
 *     `toPiAssistant`). When reachable the adapter maps events through the
 *     OFFICIAL implementation; when unreachable the self-replicated twins in
 *     `map.ts`/`replay.ts` take over and every record they touch is labeled
 *     `zctx-mapping` (honest provenance, same discipline as host-llm.ts).
 *     `classifyPiAiError` is module-private upstream (src/stream.ts:42 has no
 *     export) so the twin ALWAYS supplies it (the adapter's catch path uses
 *     it directly regardless of the mapping source). Override:
 *     `ZCTX_DSH_LLM_PIAI` (points at the llm-pi-ai package root directory).
 *
 * Loading is lazy and memoized per process; `resetAdapterFacesForTest`
 * drops the memoization (two-path tests, same seam as host-llm.ts).
 *
 * @module adapter/host
 */

import { isAbsolute, resolve } from 'node:path'
import { statSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** Structural surface of the @deepseek-ai/dsh-llm exports the adapter consumes. */
export interface HostLlmFace {
  /** The official LlmAdapter abstract base class (`extends` target). */
  readonly LlmAdapter: abstract new () => unknown
  /** The official harness error (two-path error delivery, F5.2). */
  readonly LlmError: new (message: string, code: string, options?: { cause?: unknown }) => Error
  readonly CONTEXT_WINDOW_EXCEEDED_CODE: string
  readonly EMPTY_RESPONSE_CODE: string
  readonly QUOTA_EXCEEDED_CODE: string
  readonly IMAGE_OFFLOAD_REQUIRED_CODE: string
  /** Official overflow text classifier (error.ts:64-100, four regex groups). */
  readonly isContextWindowExceededError: (message: string) => boolean
  /** Official quota text classifier (used by the error twin). */
  readonly isQuotaExceededError: (message: string) => boolean
  /** Harness attribution headers — MUST ride every wire request (F9.6). */
  readonly attributionHeaders: () => Record<string, string>
  /** Official image-block detector (image gating, F5.7). */
  readonly contentHasImage: (content: unknown) => boolean
}

/** One pi-ai protocol API module's stream face (anthropic-messages.js:376/:712 shape). */
export interface PiAiApiStreams {
  readonly stream: (model: unknown, context: unknown, options?: unknown) => unknown
  readonly streamSimple: (model: unknown, context: unknown, options?: unknown) => unknown
}

/** Structural surface of @earendil-works/pi-ai the adapter consumes. */
export interface PiAiFace {
  /** pi-ai's own overflow classifier (25+ provider patterns, F5.4). */
  readonly isContextOverflow: (message: unknown, contextWindow?: number) => boolean
  /**
   * Load one wire protocol's stream implementation. Undefined = this build
   * cannot serve the protocol (honest release at resolve time).
   */
  loadApi(protocol: string): Promise<PiAiApiStreams | undefined>
}

/** Where the chunk mapping ran — recorded on every adapter surface honestly. */
export type MappingSource = 'official-pi-ai-mapping' | 'zctx-mapping'

/**
 * The chunk/history mapping face. The official llm-pi-ai implementations when
 * their TS sources resolve, the self-replicated twins otherwise (`source`
 * names which one — the domain-field discipline the V2 ledger froze).
 */
export interface MappingFace {
  readonly source: MappingSource
  mapUsage(usage: unknown): unknown
  mapStopReason(message: unknown, contextWindow?: number): unknown
  toStreamChunks(
    events: AsyncIterable<unknown>,
    contextWindow?: number,
    callerSignal?: AbortSignal,
    requestedModel?: string,
  ): AsyncGenerator<unknown>
  toPiReplayState(message: unknown, requestedModel?: string): unknown
  toPiAssistant(message: unknown, onDegrade?: (reason: string) => void): unknown
}

/** All three faces the adapter face needs; `undefined` = not registrable. */
export interface AdapterFaces {
  readonly host: HostLlmFace
  readonly piAi: PiAiFace
  readonly mapping: MappingFace
}

// ---------------------------------------------------------------------------
// Specifier resolution (override convention shared with host-llm.ts).
// ---------------------------------------------------------------------------

/** Resolve one override value into an importable specifier. @internal */
function overrideSpecifier(override: string): string {
  if (override.startsWith('file:')) return override
  if (isAbsolute(override)) return pathToFileURL(resolve(override)).href
  return override
}

/**
 * Derive a member-file URL from a package-root override. The override may
 * name the package root directory (…/llm-pi-ai), a file: URL of it, or an
 * inner file (…/src/stream.ts, …/dist/index.js) — an inner file climbs back
 * to the package root by dropping the known src/lib/dist segment.
 * @internal
 */
function rootOverrideFileUrl(override: string, relative: string): string | undefined {
  let raw = override
  if (raw.startsWith('file:')) {
    try {
      // fileURLToPath (NOT url.pathname): pathname keeps a '/G:/…' leading
      // slash on Windows, which resolves against the WRONG drive.
      raw = fileURLToPath(new URL(raw))
    } catch {
      return undefined
    }
  }
  if (!isAbsolute(raw)) return undefined
  const abs = resolve(raw)
  let root = abs
  const tail = /[/\\](?:src|lib|dist)[/\\][^/\\]+$/
  if (tail.test(root)) root = root.replace(tail, '')
  return pathToFileURL(resolve(root, relative)).href
}

async function importOptional(specifier: string): Promise<Record<string, unknown> | undefined> {
  try {
    return (await import(specifier)) as Record<string, unknown>
  } catch {
    return undefined
  }
}

// ---------------------------------------------------------------------------
// Face 1: @deepseek-ai/dsh-llm (built lib).
// ---------------------------------------------------------------------------

const HOST_LLM_SPECIFIER = '@deepseek-ai/dsh-llm'

/** Every member the adapter face needs from the host lib (all-or-nothing). */
function buildHostLlmFace(mod: Record<string, unknown>): HostLlmFace | undefined {
  const members: readonly (keyof HostLlmFace)[] = [
    'LlmAdapter',
    'LlmError',
    'CONTEXT_WINDOW_EXCEEDED_CODE',
    'EMPTY_RESPONSE_CODE',
    'QUOTA_EXCEEDED_CODE',
    'IMAGE_OFFLOAD_REQUIRED_CODE',
    'isContextWindowExceededError',
    'isQuotaExceededError',
    'attributionHeaders',
    'contentHasImage',
  ]
  for (const member of members) {
    if (mod[member] === undefined) return undefined
  }
  if (typeof mod.LlmAdapter !== 'function' || typeof mod.LlmError !== 'function') return undefined
  if (typeof mod.isContextWindowExceededError !== 'function' || typeof mod.isQuotaExceededError !== 'function') {
    return undefined
  }
  if (typeof mod.attributionHeaders !== 'function' || typeof mod.contentHasImage !== 'function') {
    return undefined
  }
  return mod as unknown as HostLlmFace
}

async function loadHostLlmFace(): Promise<HostLlmFace | undefined> {
  const override = process.env.ZCTX_DSH_LLM
  const mod = await importOptional(
    override === undefined || override === '' ? HOST_LLM_SPECIFIER : overrideSpecifier(override),
  )
  return mod === undefined ? undefined : buildHostLlmFace(mod)
}

// ---------------------------------------------------------------------------
// Face 2: @earendil-works/pi-ai (dist; root + per-protocol api subpaths).
// ---------------------------------------------------------------------------

const PI_AI_SPECIFIER = '@earendil-works/pi-ai'
const LLM_PI_AI_SPECIFIER = '@deepseek-ai/dsh-llm-pi-ai'

/**
 * The BUILTIN fallback protocol list (official llm-pi-ai PROTOCOLS table,
 * llm-pi-ai/src/provider.ts:47-51). The AUTHORITATIVE gate is the official
 * `supportedProtocols()` union loaded dynamically (coordinator A-ruling:
 * "官方 union 单源对拍防漂移 — supportedProtocols() 动态取，宿主升级加协议
 * 我们自动跟"); this constant is only the honest fallback when the
 * llm-pi-ai lib cannot resolve.
 */
export const KNOWN_PROTOCOLS = ['openai-completions', 'openai-responses', 'anthropic-messages'] as const

/**
 * The wire-protocol union the config `family` values are validated against.
 * Source of truth: the official llm-pi-ai lib's `supportedProtocols()` (its
 * package main exports it — probed live); when that package is unreachable,
 * the {@link KNOWN_PROTOCOLS} fallback applies with `source: 'builtin'` so
 * callers can label the provenance honestly.
 */
export async function loadSupportedProtocols(): Promise<{ protocols: readonly string[]; source: 'official' | 'builtin' }> {
  const override = process.env.ZCTX_DSH_LLM_PIAI
  if (override === undefined || override === '') {
    const mod = await importOptional(LLM_PI_AI_SPECIFIER)
    if (mod !== undefined && typeof mod['supportedProtocols'] === 'function') {
      return { protocols: (mod['supportedProtocols'] as () => readonly string[])(), source: 'official' }
    }
    return { protocols: KNOWN_PROTOCOLS, source: 'builtin' }
  }
  const libUrl = rootOverrideFileUrl(override, 'lib/index.js')
  if (libUrl !== undefined) {
    const mod = await importOptional(libUrl)
    if (mod !== undefined && typeof mod['supportedProtocols'] === 'function') {
      return { protocols: (mod['supportedProtocols'] as () => readonly string[])(), source: 'official' }
    }
  }
  return { protocols: KNOWN_PROTOCOLS, source: 'builtin' }
}

function buildPiAiFace(mod: Record<string, unknown>, apiSpecifier: (protocol: string) => string): PiAiFace {
  const isContextOverflow = mod['isContextOverflow']
  if (typeof isContextOverflow !== 'function') {
    throw new TypeError('pi-ai root module is missing isContextOverflow')
  }
  return {
    isContextOverflow: isContextOverflow as PiAiFace['isContextOverflow'],
    loadApi: async (protocol: string) => {
      // Reachability IS the gate: the config family gate already restricts
      // declarations to the OFFICIAL supportedProtocols union (dynamic, see
      // loadSupportedProtocols), so a loadable api module is exactly the
      // honest serve condition (R6: HTTP(SSE) protocols only exist here —
      // WS transport is not part of the official hand-declared union).
      const apiMod = await importOptional(apiSpecifier(protocol))
      if (apiMod === undefined) return undefined
      const stream = apiMod['stream']
      const streamSimple = apiMod['streamSimple']
      if (typeof stream !== 'function' || typeof streamSimple !== 'function') return undefined
      return { stream, streamSimple } as PiAiApiStreams
    },
  }
}

async function loadPiAiFace(): Promise<PiAiFace | undefined> {
  const override = process.env.ZCTX_PIAI
  if (override === undefined || override === '') {
    const mod = await importOptional(PI_AI_SPECIFIER)
    if (mod === undefined) return undefined
    // Bare specifier resolved → the api subpaths resolve the same way.
    return buildPiAiFace(mod, (protocol) => `${PI_AI_SPECIFIER}/api/${protocol}`)
  }
  if (!override.startsWith('file:') && !isAbsolute(override)) {
    // A bare non-absolute override (package name or subpath): root + subpaths
    // resolve against the same base.
    const mod = await importOptional(override)
    if (mod === undefined) return undefined
    return buildPiAiFace(mod, (protocol) => `${override}/api/${protocol}`)
  }
  // File override: a FILE imports directly; a DIRECTORY (package root, the
  // probe convention) resolves to its dist/index.js entry (ESM forbids
  // directory imports). Root + derived api file URLs from there.
  let rootSpecifier = overrideSpecifier(override)
  if (isDirectoryPath(rootSpecifier)) {
    rootSpecifier = rootSpecifier.replace(/\/+$/, '') + '/dist/index.js'
  }
  const mod = await importOptional(rootSpecifier)
  if (mod === undefined) return undefined
  const face = buildPiAiFace(mod, (protocol) => {
    const url = rootOverrideFileUrl(override, `dist/api/${protocol}.js`)
    if (url === undefined) throw new TypeError(`ZCTX_PIAI override "${override}" cannot derive api path`)
    return url
  })
  return face
}

/** True when the (already converted) specifier points at a directory on disk. @internal */
function isDirectoryPath(specifier: string): boolean {
  try {
    const raw = specifier.startsWith('file:') ? fileURLToPath(new URL(specifier)) : specifier
    if (!isAbsolute(raw)) return false
    return statSync(raw).isDirectory()
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Face 3: the chunk mapping (official llm-pi-ai sources, twins as fallback).
// ---------------------------------------------------------------------------

/** The mapping surface of one llm-pi-ai source module pair (stream + replay). */
interface OfficialStreamModule {
  mapUsage?: (usage: unknown) => unknown
  mapStopReason?: (message: unknown, contextWindow?: number) => unknown
  toStreamChunks?: (
    events: AsyncIterable<unknown>,
    contextWindow?: number,
    callerSignal?: AbortSignal,
    requestedModel?: string,
  ) => AsyncGenerator<unknown>
}

interface OfficialReplayModule {
  toPiReplayState?: (message: unknown, requestedModel?: string) => unknown
  toPiAssistant?: (message: unknown, onDegrade?: (reason: string) => void) => unknown
}

/**
 * Build the mapping face: the official stream/replay exports when BOTH source
 * modules resolve completely; the labeled twins otherwise. A host build that
 * ships only one of the two modules degrades WHOLESALE to the twins — a mixed
 * mapping face would understate the divergence risk (host-llm.ts precedent).
 */
async function loadMappingFace(host: HostLlmFace, piAi: PiAiFace): Promise<MappingFace> {
  // Imported lazily to keep the module graph acyclic (map.ts imports nothing
  // from this module).
  const { buildMappingTwins } = await import('./twins.ts')
  const twins = buildMappingTwins(
    {
      LlmError: host.LlmError,
      CONTEXT_WINDOW_EXCEEDED_CODE: host.CONTEXT_WINDOW_EXCEEDED_CODE,
      EMPTY_RESPONSE_CODE: host.EMPTY_RESPONSE_CODE,
      QUOTA_EXCEEDED_CODE: host.QUOTA_EXCEEDED_CODE,
      isContextWindowExceededError: host.isContextWindowExceededError,
      isQuotaExceededError: host.isQuotaExceededError,
    },
    piAi.isContextOverflow,
  )
  const override = process.env.ZCTX_DSH_LLM_PIAI
  const bareRoot = '@deepseek-ai/dsh-llm-pi-ai'
  let streamMod: OfficialStreamModule | undefined
  let replayMod: OfficialReplayModule | undefined
  if (override === undefined || override === '') {
    const [stream, replay] = await Promise.all([
      importOptional(`${bareRoot}/src/stream.ts`),
      importOptional(`${bareRoot}/src/replay.ts`),
    ])
    streamMod = stream as OfficialStreamModule | undefined
    replayMod = replay as OfficialReplayModule | undefined
  } else {
    const streamUrl = rootOverrideFileUrl(override, 'src/stream.ts')
    const replayUrl = rootOverrideFileUrl(override, 'src/replay.ts')
    if (streamUrl !== undefined && replayUrl !== undefined) {
      const [stream, replay] = await Promise.all([importOptional(streamUrl), importOptional(replayUrl)])
      streamMod = stream as OfficialStreamModule | undefined
      replayMod = replay as OfficialReplayModule | undefined
    }
  }
  const complete =
    streamMod !== undefined
    && replayMod !== undefined
    && typeof streamMod.mapUsage === 'function'
    && typeof streamMod.mapStopReason === 'function'
    && typeof streamMod.toStreamChunks === 'function'
    && typeof replayMod.toPiReplayState === 'function'
    && typeof replayMod.toPiAssistant === 'function'
  if (streamMod === undefined || replayMod === undefined || !complete) return twins
  return {
    source: 'official-pi-ai-mapping',
    mapUsage: streamMod.mapUsage as MappingFace['mapUsage'],
    mapStopReason: streamMod.mapStopReason as MappingFace['mapStopReason'],
    toStreamChunks: streamMod.toStreamChunks as MappingFace['toStreamChunks'],
    toPiReplayState: replayMod.toPiReplayState as MappingFace['toPiReplayState'],
    toPiAssistant: replayMod.toPiAssistant as MappingFace['toPiAssistant'],
  }
}

// ---------------------------------------------------------------------------
// Memoized entry point.
// ---------------------------------------------------------------------------

let cached: Promise<AdapterFaces | undefined> | undefined

/**
 * Load all three faces once per process. `undefined` = the adapter face is
 * NOT registrable (host lib or pi-ai unreachable) — the wiring logs honestly
 * and skips the face; this is never a throw.
 */
export function loadAdapterFaces(): Promise<AdapterFaces | undefined> {
  cached ??= (async () => {
    const host = await loadHostLlmFace()
    if (host === undefined) return undefined
    const piAi = await loadPiAiFace()
    if (piAi === undefined) return undefined
    const mapping = await loadMappingFace(host, piAi)
    return { host, piAi, mapping }
  })()
  return cached
}

/** Drop the memoized faces (TEST-ONLY seam; not part of the public surface). */
export function resetAdapterFacesForTest(): void {
  cached = undefined
}
