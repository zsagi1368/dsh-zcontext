/**
 * Bridge authorization for the zctx UI routes (ZCTX-UI DESIGN §3.3) — D2.
 *
 * ZERO-CREDENTIAL LITERAL RULE: the bridge token is generated at runtime via
 * `node:crypto` randomBytes. No usable credential literal appears in source,
 * examples, or tests (UserPromptSubmit hook hard constraint). The token lives
 * only in the `registerUiRoutes` closure — never logged, never written to
 * disk, never embedded in a snapshot.
 *
 * Authorization arms (DESIGN §3.3, aligned with AutoPilot authorizeAction):
 *   1. `x-zctx-token` header non-empty → constant identity compare with token.
 *   2. no token header + `origin` present → same-origin (URL(origin).host == host).
 *   3. no origin → loopback socket address.
 *   4. otherwise → false.
 * Write routes further require token OR (same-origin AND loopback).
 *
 * Native Node req/res only (no Express helpers): lowercase `req.headers`,
 * first value wins on repeated headers.
 *
 * @module ui/auth
 */

import { randomBytes } from 'node:crypto'
import { timingSafeEqual } from 'node:crypto'

/** Minimal native Node request shape the handlers rely on. */
export interface WebReqLike {
  readonly method?: string
  readonly url?: string
  readonly headers: Record<string, string | string[] | undefined>
  readonly socket?: { readonly remoteAddress?: string }
}

/** Minimal native Node response shape the handlers rely on. */
export interface WebResLike {
  writeHead(status: number, headers?: Record<string, string>): unknown
  end(body?: string): unknown
}

/** Runtime token source — no literal, ever. */
export function createTokenSource(): { token(): string } {
  return { token: () => randomBytes(16).toString('hex') }
}

/** First value of a lowercase header (node http shape: repeats take the first). */
export function firstHeader(req: WebReqLike, name: string): string | undefined {
  const value = req.headers[name]
  if (Array.isArray(value)) return value[0]
  return value
}

/** Loopback socket check (DESIGN §3.3 arm 3). */
export function isLoopback(req: WebReqLike): boolean {
  const address = req.socket?.remoteAddress
  if (address === undefined) return false
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

/** Same-origin check: URL(origin).host == the request Host header. */
export function isSameOrigin(req: WebReqLike): boolean {
  const origin = firstHeader(req, 'origin')
  const host = firstHeader(req, 'host')
  if (origin === undefined || origin.length === 0 || host === undefined || host.length === 0) return false
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

/** Constant-time-ish token compare; length mismatch → false. */
function tokenMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  try {
    return timingSafeEqual(a, b)
  } catch {
    return false
  }
}

/** Does the request carry a matching token header? */
export function hasValidToken(req: WebReqLike, expectedToken: string): boolean {
  const header = firstHeader(req, 'x-zctx-token') ?? ''
  return header.length > 0 && tokenMatches(header, expectedToken)
}

/** Read authorization (DESIGN §3.3 arms 1-4). */
export function authorizeRequest(req: WebReqLike, expectedToken: string): boolean {
  if (hasValidToken(req, expectedToken)) return true
  // No token header: origin present → same-origin; absent → loopback.
  const origin = firstHeader(req, 'origin')
  if (origin !== undefined && origin.length > 0) return isSameOrigin(req)
  return isLoopback(req)
}

/** Write authorization — stricter: token OR (same-origin AND loopback). */
export function authorizeWrite(req: WebReqLike, expectedToken: string): boolean {
  if (hasValidToken(req, expectedToken)) return true
  return isSameOrigin(req) && isLoopback(req)
}

/** Native JSON response (aligned with AutoPilot sendJson). */
export function sendJson(res: WebResLike, status: number, payload: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(payload))
}
