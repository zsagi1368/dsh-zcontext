/**
 * The patch bridge — the plugin side of the external app.asar patch
 * (task card P4 product 2; plan §3; RES-install-surface P2 §7).
 *
 * The external patcher (patcher/zctx-patch.mjs) inserts ONE defensive
 * forwarding stub into the OFFICIAL PiAiAdapter's streamSimple options
 * construction (after the `...profileOptions(...)` spread, BEFORE the
 * official explicit `headers:`/`signal:` keys — so the stub can never clobber
 * the official header/timeout face):
 *
 *     ...(globalThis.__zctxPatch__?.wireOptions?.({ provider, model, sessionId }) ?? {}),
 *
 * This module arms the receiving side: {@link mountPatchBridge} installs
 * `globalThis.__zctxPatch__.wireOptions` at plugin startup. Per request the
 * official adapter calls it with the reachable identity (provider/model +
 * options.sessionId); the bridge returns `{onPayload, fetch, headers}` built
 * by the SAME `buildWireFaces` the plugin's own adapter uses (identical
 * observation semantics, R1 observe-only) bound to the per-session wire
 * ledger. Plugin absent/disabled → never armed; invalid identity or unwatched
 * session → the bridge returns `{}`; host face unreachable → the LEDGER still
 * serves with an empty attribution set (hash records without the attribution
 * headers — the official request proceeds byte-identical to stock in every
 * case, card: "插件缺席/未启用→桩返回 {} 零操作；补丁缺席=现有面不变").
 *
 * R7 (attribution must ride the wire): on the official route the plugin's
 * `headers` face is overridden by the adapter's own explicit
 * `headers: requestHeaders(...)` key (by construction — the stub sits before
 * it), so attribution is delivered through the FETCH WRAPPER instead: the
 * bridge composes the wire fetch with an additive init.headers merge
 * (attribution names win case-insensitive collisions, the same semantics as
 * the own-adapter `requestHeaders` port). Unknown header shapes pass through
 * untouched. The own-adapter path is UNCHANGED (zero consumer-face drift —
 * VERIFY-P P1 discipline).
 *
 * MOUNT SEMANTICS: last-wins per process — a re-constructed plugin instance
 * replaces any previous bridge (the newest instance is the live one); with
 * multiple simultaneous plugin instances only the latest serves the stub,
 * which is logged honestly. All bridge code is throw-contained: the stub
 * runs inside the OFFICIAL request path, so ANY internal failure degrades to
 * `{}` — never a broken user request.
 *
 * @module patch-bridge
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { buildWireFaces } from './adapter/wire.ts'
import type { HostLlmFace } from './adapter/host.ts'
import type { WireSnapshot } from './types.ts'
import type { SessionLike } from './types.ts'

/** globalThis key the patched stub calls into (must match the patcher stub). */
export const PATCH_BRIDGE_KEY = '__zctxPatch__'

/** The marker file the external patcher writes into the app dir. */
export const PATCH_MARKER_FILENAME = '.zctx-patch.json'

/** Logger subset the bridge uses (honest degrade logging). */
export interface BridgeLoggerLike {
  warn?(message: string): unknown
  info?(message: string): unknown
}

/** Identity the patched stub forwards (all fields optional/unknown — validated). */
export interface PatchProfileInfo {
  readonly provider?: unknown
  readonly model?: unknown
  readonly sessionId?: unknown
}

/** What the stub spreads into the official streamSimple options. */
export interface PatchWireOptionsResult {
  readonly onPayload?: unknown
  readonly fetch?: unknown
  readonly headers?: Record<string, string>
}

/** The per-session wire-ledger receive port the bridge binds to. */
export type PatchWireSink = (snapshot: WireSnapshot) => void

/** Everything the bridge needs — all injected, zero host imports. */
export interface PatchBridgeDeps {
  readonly logger?: BridgeLoggerLike
  /** Which session id maps to a LIVE watched session (the plugin's registry). */
  resolveWatchedSession(sessionId: string): SessionLike | undefined
  /** Where one wire snapshot lands (the per-session store's wire ledger). */
  readonly sink: PatchWireSink
  /** The host llm faces (attribution headers), loaded lazily; undefined = degrade. */
  hostFace(): HostLlmFace | undefined
}

/** The object mounted at `globalThis.__zctxPatch__`. */
export interface PatchBridge {
  /** The function the patched stub calls (defensive, never throws). */
  readonly wireOptions: (profileInfo: unknown) => PatchWireOptionsResult
}

/** Structural view of one marker file read (status dual-source, filesystem truth). */
export type PatchMarkerView =
  | {
    readonly state: 'present'
    readonly path: string
    readonly version?: string
    readonly target?: string
    /** The patch-set identity (v0.2 multi-file marker; undefined on v0.1 markers). */
    readonly patchSet?: string
    /** The patcher release that wrote the marker. */
    readonly patcherVersion?: string
    /** Per-file before/after identities from the v0.2 multi-file marker. */
    readonly files?: readonly { readonly target?: string; readonly sha256After?: string }[]
    readonly timestamp?: string
  }
  | { readonly state: 'absent'; readonly path: string }
  | { readonly state: 'unknown'; readonly path: string; readonly reason: string }

/**
 * The app dir the marker lives in: the Electron main process exposes
 * `process.resourcesPath` (<appDir>/resources); the marker sits next to the
 * exe, one level up. Undefined outside Electron (tests pass the dir).
 */
export function patchMarkerDir(): string | undefined {
  const resourcesPath = (process as { resourcesPath?: unknown }).resourcesPath
  if (typeof resourcesPath !== 'string' || resourcesPath.length === 0) return undefined
  return dirname(resourcesPath)
}

/**
 * Read the patch marker — the FILESYSTEM half of the status dual source.
 * ENOENT = absent (unpatched); unreadable/unparsable = unknown (honest);
 * present = {version, timestamp} straight from the patcher's write.
 */
export function readPatchMarker(appDir?: string): PatchMarkerView {
  const dir = appDir ?? patchMarkerDir()
  if (dir === undefined) {
    return { state: 'unknown', path: PATCH_MARKER_FILENAME, reason: 'app dir not reachable (no process.resourcesPath)' }
  }
  const path = join(dir, PATCH_MARKER_FILENAME)
  if (!existsSync(path)) return { state: 'absent', path }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
    return {
      state: 'present',
      path,
      ...(typeof parsed.shellVersion === 'string' ? { version: parsed.shellVersion } : {}),
      ...(typeof parsed.target === 'string' ? { target: parsed.target } : {}),
      ...(typeof parsed.patchSet === 'string' ? { patchSet: parsed.patchSet } : {}),
      ...(typeof parsed.patcherVersion === 'string' ? { patcherVersion: parsed.patcherVersion } : {}),
      ...(Array.isArray(parsed.files)
        ? {
          files: parsed.files.map((file: unknown) => {
            const entry = (typeof file === 'object' && file !== null ? file : {}) as Record<string, unknown>
            return {
              ...(typeof entry.target === 'string' ? { target: entry.target } : {}),
              ...(typeof entry.sha256After === 'string' ? { sha256After: entry.sha256After } : {}),
            }
          }),
        }
        : {}),
      ...(typeof parsed.timestamp === 'string' ? { timestamp: parsed.timestamp } : {}),
    }
  } catch (error) {
    return { state: 'unknown', path, reason: error instanceof Error ? error.message : String(error) }
  }
}

/** Is a patch bridge currently armed on globalThis? (status dual source, runtime half) */
export function isPatchBridgeMounted(): boolean {
  return (globalThis as Record<string, unknown>)[PATCH_BRIDGE_KEY] !== undefined
}

/** Attribution headers merged into init.headers additively. @internal */
function withAttributionHeaders(init: RequestInit | undefined, host: HostLlmFace): RequestInit | undefined {
  if (init === undefined || init === null || typeof init !== 'object') return init
  let attribution: Record<string, string>
  try {
    attribution = host.attributionHeaders()
  } catch {
    return init
  }
  if (attribution === undefined || Object.keys(attribution).length === 0) return init
  const existing = init.headers
  if (existing instanceof Headers) {
    const merged = new Headers(existing)
    for (const [name, value] of Object.entries(attribution)) merged.set(name, value)
    return { ...init, headers: merged }
  }
  if (Array.isArray(existing) || typeof existing === 'string' || existing === undefined || existing === null) {
    if (existing === undefined || existing === null) return { ...init, headers: { ...attribution } }
    // Array/string header shapes: honest passthrough — unknown contract, no
    // invention. The wire bytes still flow untouched (R1 holds).
    return init
  }
  if (typeof existing !== 'object') return init
  // Plain record: attribution names WIN case-insensitive collisions (the same
  // semantics as the own-adapter requestHeaders port, R7).
  const reserved = new Set(Object.keys(attribution).map((name) => name.toLowerCase()))
  const kept = Object.fromEntries(
    Object.entries(existing as Record<string, string>).filter(([name]) => !reserved.has(name.toLowerCase())),
  )
  return { ...init, headers: { ...kept, ...attribution } }
}

/**
 * The attribution-unavailable degrade host: a minimal structural HostLlmFace
 * supplying an EMPTY attribution set. The wire ledger (hash records) works
 * regardless; only the R7 attribution headers are absent — an honest,
 * documented limitation on official-route requests when the dsh-llm face is
 * unreachable (attribution remains MANDATORY on the plugin's own adapter
 * path, which always rides the real host face).
 * @internal
 */
const ATTRIBUTION_UNAVAILABLE_HOST: HostLlmFace = { attributionHeaders: () => ({}) } as unknown as HostLlmFace

/**
 * Build and return the bridge object (does NOT mount it — the caller decides
 * the globalThis slot; see {@link mountPatchBridge}).
 */
export function createPatchBridge(deps: PatchBridgeDeps): PatchBridge {
  let warnedOnce = false
  const warnOnce = (message: string): void => {
    if (warnedOnce) return
    warnedOnce = true
    deps.logger?.warn?.(message)
  }
  const wireOptions = (profileInfo: unknown): PatchWireOptionsResult => {
    // The stub runs inside the OFFICIAL request path — ANY failure here must
    // degrade to `{}` (the stock request), never break the user's stream.
    try {
      if (typeof profileInfo !== 'object' || profileInfo === null) return {}
      const { provider, model, sessionId } = profileInfo as PatchProfileInfo
      if (typeof sessionId !== 'string' || sessionId.length === 0) return {}
      if (typeof provider !== 'string' || provider.length === 0) return {}
      if (typeof model !== 'string' || model.length === 0) return {}
      // Session-bound zctx coverage only (the wire-domain rule the plugin's
      // own adapter runs under): unwatched sessions stay unrecorded.
      const session = deps.resolveWatchedSession(sessionId)
      if (session === undefined) return {}
      // The wire LEDGER serves whenever identity + session resolve; the host
      // face only carries the attribution headers. Absent face → empty
      // attribution set (hash records without attribution — honest degrade;
      // the own-adapter path always rides the real face, R7 intact there).
      const host = deps.hostFace() ?? ATTRIBUTION_UNAVAILABLE_HOST
      if (deps.hostFace() === undefined) {
        warnOnce('dsh-zcontext: patch bridge serving without attribution headers (host llm face unreachable) — wire records carry hashes only')
      }
      const faces = buildWireFaces({ sessionId, provider, model }, deps.sink, host)
      const fetch: typeof globalThis.fetch = async (input, init) => {
        // R7 on the official route: attribution rides via the fetch wrapper
        // (the stub's headers face loses to the adapter's explicit headers
        // key by construction). Forward the call UNTOUCHED otherwise (R1).
        return faces.fetch(input, withAttributionHeaders(init, host))
      }
      return { onPayload: faces.onPayload, fetch, headers: faces.headers }
    } catch (error) {
      warnOnce(`dsh-zcontext: patch bridge wireOptions failed (${error instanceof Error ? error.message : String(error)}) — degraded to {} for this request`)
      return {}
    }
  }
  return { wireOptions }
}

/**
 * Mount the bridge on globalThis (LAST-WINS: a re-constructed plugin is the
 * live one and replaces any previous mount, honestly logged). Returns the
 * mount state string the status segment renders.
 */
export function mountPatchBridge(deps: PatchBridgeDeps): { bridge: PatchBridge; mountState: string } {
  const holder = globalThis as Record<string, unknown>
  const replacing = holder[PATCH_BRIDGE_KEY] !== undefined
  const bridge = createPatchBridge(deps)
  holder[PATCH_BRIDGE_KEY] = bridge
  return {
    bridge,
    mountState: replacing
      ? 'armed (replaced a previous mount — latest plugin instance serves the stub)'
      : 'armed',
  }
}
