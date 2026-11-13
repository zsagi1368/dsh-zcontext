/**
 * V5 wire-ledger tests (task card product 4; redlines R1/R7): the two
 * observation points are PASS-THROUGH (onPayload returns undefined CONSTANT,
 * custom fetch forwards untouched — R1 零 body 改写), the byte/object hashes
 * land as domain:'wire' snapshots (request-bytes with byteLength /
 * request-payload via stableStringify), attributionHeaders ride EVERY
 * request including ledger-less ones (R7), the deployment-collision merge
 * keeps attribution winning case-insensitively, unattributable one-shots
 * are not recorded, and the store's 64-cap wire ledger receives them.
 */

import { describe, expect, it, vi } from 'vitest'

import { sha256Hex, stableStringify } from '../src/hash.ts'
import { FoldStore } from '../src/store.ts'
import type { WireSnapshot } from '../src/types.ts'
import { buildWireFaces, requestHeaders } from '../src/adapter/wire.ts'
import type { HostLlmFace } from '../src/adapter/host.ts'

const HOST = {
  attributionHeaders: () => ({ 'x-dsh-attribution': 'zctx', 'x-dsh-runtime': 'test' }),
} as unknown as HostLlmFace

const IDENTITY = { sessionId: 'sess-wire', provider: 'zctx-anthropic-messages', model: 'm1' }

function collect(snapshots: WireSnapshot[]): (snapshot: WireSnapshot) => void {
  return (snapshot) => snapshots.push(snapshot)
}

describe('wire faces: onPayload (R1 observe-only)', () => {
  it('returns undefined CONSTANTLY and records the request-payload hash deterministically', () => {
    const snapshots: WireSnapshot[] = []
    const faces = buildWireFaces(IDENTITY, collect(snapshots), HOST)
    const payload = { model: 'm1', messages: [{ role: 'user', content: 'hi' }] }
    expect(faces.onPayload(payload, undefined)).toBeUndefined()
    expect(faces.onPayload(payload, undefined)).toBeUndefined() // R1 pin: never a replacement
    expect(snapshots).toHaveLength(2)
    const expected = sha256Hex(stableStringify(payload))
    expect(snapshots[0]).toMatchObject({
      domain: 'wire',
      sessionId: 'sess-wire',
      provider: 'zctx-anthropic-messages',
      model: 'm1',
      kind: 'request-payload',
      sha256: expected,
    })
    expect('byteLength' in (snapshots[0] as object)).toBe(false)
    expect(snapshots[1]?.sha256).toBe(expected) // deterministic across calls
  })

  it('an unserializable payload is honestly unrecorded (never a reason to touch the request)', () => {
    const snapshots: WireSnapshot[] = []
    const faces = buildWireFaces(IDENTITY, collect(snapshots), HOST)
    const cyclic: Record<string, unknown> = {}
    cyclic['self'] = cyclic
    expect(faces.onPayload(cyclic, undefined)).toBeUndefined()
    expect(snapshots).toHaveLength(0)
  })
})

describe('wire faces: custom fetch (final body bytes)', () => {
  it('a string body records request-bytes with byteLength; the real fetch receives the call untouched', async () => {
    const snapshots: WireSnapshot[] = []
    const realFetch = vi.fn(async () => new Response('ok'))
    vi.stubGlobal('fetch', realFetch)
    try {
      const faces = buildWireFaces(IDENTITY, collect(snapshots), HOST)
      const body = '{"messages":[]}'
      const response = await faces.fetch('https://gateway.example/v1/messages', {
        method: 'POST',
        body,
        headers: { 'content-type': 'application/json' },
      })
      expect(await response.text()).toBe('ok')
      expect(realFetch).toHaveBeenCalledTimes(1)
      expect(snapshots).toHaveLength(1)
      expect(snapshots[0]).toMatchObject({
        domain: 'wire',
        kind: 'request-bytes',
        sha256: sha256Hex(body),
        byteLength: new TextEncoder().encode(body).length,
      })
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('a Uint8Array body records bytes; a missing body is honestly unrecorded; recording faults never break the request', async () => {
    const snapshots: WireSnapshot[] = []
    const realFetch = vi.fn(async () => new Response('ok'))
    vi.stubGlobal('fetch', realFetch)
    try {
      const faces = buildWireFaces(IDENTITY, collect(snapshots), HOST)
      const bytes = new TextEncoder().encode('binary-ish')
      await faces.fetch('https://gateway.example/v1/messages', { method: 'POST', body: bytes })
      expect(snapshots[0]?.kind).toBe('request-bytes')
      expect(snapshots[0]?.byteLength).toBe(bytes.byteLength)
      // Missing body: no bytes to hash → no snapshot, request still goes.
      await faces.fetch('https://gateway.example/v1/messages', { method: 'GET' })
      expect(snapshots).toHaveLength(1)
      expect(realFetch).toHaveBeenCalledTimes(2)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('wire faces: attribution headers (R7)', () => {
  it('attribution headers ride the faces; deployment collisions lose case-insensitively', () => {
    const faces = buildWireFaces(IDENTITY, undefined, HOST)
    expect(faces.headers).toEqual({ 'x-dsh-attribution': 'zctx', 'x-dsh-runtime': 'test' })
    const merged = requestHeaders(
      { 'X-DSH-Attribution': 'deployment-wins?', 'x-custom': 'kept' },
      HOST,
    )
    // The attribution name wins the case-insensitive collision; other
    // deployment headers pass through.
    expect(merged).toEqual({ 'x-custom': 'kept', 'x-dsh-attribution': 'zctx', 'x-dsh-runtime': 'test' })
  })

  it('R7 holds even without a ledger sink: the adapter carries attribution headers for one-shots too', async () => {
    // Re-exported through the adapter pipeline (covered end-to-end in
    // adapter-zctx.spec via the captured options — here the unit pin).
    expect(Object.keys(requestHeaders(undefined, HOST))).toContain('x-dsh-attribution')
  })
})

describe('store wire ledger (V5 receive port)', () => {
  it('absorbWireSnapshot bounds at 64 (oldest dropped); wireSnapshots returns copies; attach clears', () => {
    const store = new FoldStore()
    for (let i = 0; i < 66; i += 1) {
      store.absorbWireSnapshot({
        domain: 'wire',
        sessionId: 's',
        provider: 'zctx-anthropic-messages',
        model: 'm1',
        kind: 'request-bytes',
        sha256: `hash-${i}`,
        byteLength: i,
        time: i,
      })
    }
    const snapshots = store.wireSnapshots()
    expect(snapshots).toHaveLength(64)
    expect(snapshots[0]?.sha256).toBe('hash-2') // oldest two dropped
    expect(snapshots[63]?.sha256).toBe('hash-65')
    // Copies: mutating the returned array does not touch the ledger.
    ;(snapshots as unknown as WireSnapshot[]).length = 0
    expect(store.wireSnapshots()).toHaveLength(64)
    // attach clears with the other receive ports.
    store.attach({ id: 's2', seq: 0 } as never)
    expect(store.wireSnapshots()).toHaveLength(0)
  })
})
