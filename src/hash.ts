/**
 * Deterministic hashing primitives for the V2 observe face (RES-observe-route
 * a.3): key-sorted stable stringification + sha256, both pure and
 * dependency-light (node:crypto only).
 *
 * stableStringify sorts object keys recursively so two structurally equal
 * requests hash identically regardless of property insertion order (the
 * hash-stability property the V2 tests pin). Arrays keep their order —
 * message and block order is semantically load-bearing on the wire.
 *
 * @module hash
 */

import { createHash } from 'node:crypto'

/**
 * Key-sorted deterministic JSON serialization. Objects recurse with sorted
 * keys; arrays recurse in order; primitives pass through. Values that JSON
 * cannot represent (functions, undefined array slots → null, symbols dropped
 * by JSON) follow plain JSON.stringify semantics — request payloads are
 * JSON-shaped data in practice, and the snapshot hash only needs a total
 * deterministic order over what is actually present.
 */
export function stableStringify(value: unknown): string {
  return JSON.stringify(stableValue(value))
}

/** Key-sorted structural clone used by {@link stableStringify}. @internal */
function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => stableValue(entry))
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(record).sort()) out[key] = stableValue(record[key])
    return out
  }
  return value
}

/** Lowercase hex sha256 of a UTF-8 string. */
export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/** Convenience: stable-stringify then hash in one call. */
export function stableHash(value: unknown): string {
  return sha256Hex(stableStringify(value))
}
