/**
 * Wire-observation faces for the zctx adapter — the v0.2.0 V5 wire ledger
 * (task card product 4; RES-adapter-route F7.1/F7.2/F9.6, redline R1/R7).
 *
 * TWO observation points, both PASS-THROUGH:
 *
 *  1. `onPayload` (pi-ai ProviderRequestOptions, dist/types.d.ts:80 — 1.0.2
 *     anchor; the official dsh adapter does NOT forward it, F7.4, which is
 *     why the wire ledger needs this adapter at all): receives the serialized
 *     pre-send payload OBJECT; hashes it with stableStringify + sha256
 *     (deterministic, but NOT the wire bytes) and returns `undefined`
 *     CONSTANTLY — "return undefined to keep" (R1: 零 body 改写，onPayload
 *     只观测不 replace——返回 undefined 恒定).
 *  2. custom `fetch` (dist/types.d.ts:52/:69): receives the FINAL HTTP
 *     RequestInfo — init.body IS the wire byte string — hashes the bytes,
 *     records byteLength, and forwards to the REAL fetch untouched.
 *
 * ATTRIBUTION (F9.6/R7): `attributionHeaders()` MUST ride every provider
 * HTTP request. The official llm-pi-ai merges deployment headers so the
 * attribution names WIN collisions (adapter.ts:215-223 requestHeaders); this
 * module carries the same merge (deployment headers minus case-insensitive
 * attribution collisions, attribution last). The S2 config has no headers
 * field, so the merge runs over an empty deployment set today — the merge
 * logic is carried so a future headers knob plugs in without touching R7.
 *
 * Every record lands through the injected sink as a WireSnapshot
 * (domain: 'wire'); unattributable requests (no session id) are NOT
 * recorded — the wire domain covers session-bound zctx requests only
 * (plan §3: "wire 域（字节哈希，仅 zctx 路由会话覆盖）").
 *
 * @module adapter/wire
 */

import { sha256Hex, stableStringify } from '../hash.ts'
import type { WireSnapshot } from '../types.ts'
import type { HostLlmFace } from './host.ts'

/** Where one wire observation lands (the per-session store's wire ledger). */
export type WireSink = (snapshot: WireSnapshot) => void

/** The observation faces injected into one streamSimple call. */
export interface WireFaces {
  /** pi-ai onPayload — observe-only, ALWAYS returns undefined (R1). */
  readonly onPayload: (payload: unknown, model: unknown) => undefined
  /** Custom fetch — hashes init.body when present, forwards untouched. */
  readonly fetch: typeof globalThis.fetch
  /** Request headers carrying the attribution names (R7). */
  readonly headers: Record<string, string>
}

/** Identity context for one request's wire records. */
export interface WireRequestIdentity {
  readonly sessionId: string
  readonly provider: string
  readonly model: string
}

/**
 * Build the wire faces for ONE stream call. `sink` is absent → the faces
 * still observe (cheap) but record nothing — no, honest simplification:
 * with no sink there is no ledger, so a no-op sink is equivalent; the faces
 * are built ONLY when a sink exists (the adapter passes one always — the
 * wiring decides coverage).
 */
export function buildWireFaces(
  identity: WireRequestIdentity,
  sink: WireSink | undefined,
  host: HostLlmFace,
): WireFaces {
  const record = (kind: WireSnapshot['kind'], sha256: string, byteLength?: number): void => {
    if (sink === undefined) return
    sink({
      domain: 'wire',
      sessionId: identity.sessionId,
      provider: identity.provider,
      model: identity.model,
      kind,
      sha256,
      ...(byteLength !== undefined ? { byteLength } : {}),
      time: Date.now(),
    })
  }
  const onPayload = (payload: unknown, _model: unknown): undefined => {
    // R1: observe-only — the return value is undefined CONSTANTLY (pi-ai
    // replaces the whole params object with a non-undefined return).
    try {
      const serialized = stableStringify(payload)
      if (typeof serialized === 'string') {
        record('request-payload', sha256Hex(serialized))
      }
    } catch {
      // A payload that cannot be stably serialized is honestly unrecorded —
      // never a reason to touch the request.
    }
    return undefined
  }
  const fetch: typeof globalThis.fetch = async (input, init) => {
    try {
      const body = init?.body
      if (typeof body === 'string' && body.length > 0) {
        record('request-bytes', sha256Hex(body), new TextEncoder().encode(body).length)
      } else if (body instanceof Uint8Array && body.length > 0) {
        record('request-bytes', sha256HexBytes(body), body.byteLength)
      }
      // Other body shapes (Request objects, streams) are honestly unrecorded
      // — the SDK sends string/Uint8Array JSON bodies on this path.
    } catch {
      // Recording must never break the request.
    }
    return globalThis.fetch(input as never, init as never)
  }
  const headers = requestHeaders(undefined, host)
  return { onPayload, fetch, headers }
}

/** sha256 over raw bytes (hash.ts's sha256Hex is string-based). @internal */
function sha256HexBytes(bytes: Uint8Array): string {
  // The hash module hashes strings; byte bodies decode losslessly for
  // hashing (they are UTF-8 JSON on this path).
  return sha256Hex(new TextDecoder().decode(bytes))
}

/**
 * Merge deployment headers with the attribution headers, attribution names
 * WINNING case-insensitively (official llm-pi-ai adapter.ts:215-223 port).
 * R7: the attribution set MUST reach the wire; collisions are removed from
 * the deployment set rather than reordered after it.
 */
export function requestHeaders(
  deployment: Readonly<Record<string, string>> | undefined,
  host: HostLlmFace,
): Record<string, string> {
  const attribution = host.attributionHeaders()
  const reserved = new Set(Object.keys(attribution).map((name) => name.toLowerCase()))
  return {
    ...Object.fromEntries(
      Object.entries(deployment ?? {}).filter(([name]) => !reserved.has(name.toLowerCase())),
    ),
    ...attribution,
  }
}
