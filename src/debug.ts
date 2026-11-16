/**
 * P6-D2 diagnostic sink (env-gated; task card ZCTX-P6D2).
 *
 * WHY THIS EXISTS (Z28): every face-degradation path logs through
 * `ctx.logger?.warn`, and in the headless composition that logger has NO
 * sink (no stderr wiring, no DSH_HOME/logs) — degradation became
 * unobservable, so the bench could not tell "service absent → skip" from
 * "register refused". This module writes DIRECTLY to `process.stderr`,
 * bypassing the logger entirely.
 *
 * Gate discipline: output happens ONLY when `ZCTX_DEBUG` is exactly `'1'`.
 * Default (unset or any other value) is ZERO output — production behavior
 * is byte-identical to pre-instrumentation. This sink never throws (a
 * diagnostic must not become the failure it diagnoses).
 */

/** `true` only when the operator explicitly asked for diagnostics. */
export function zctxDebugEnabled(): boolean {
  return process.env.ZCTX_DEBUG === '1'
}

/** Env-gated stderr write: one line, prefixed `[zctx-debug]`, never throws. */
export function zctxDebug(message: string): void {
  if (process.env.ZCTX_DEBUG !== '1') return
  try {
    process.stderr.write(`[zctx-debug] ${message}\n`)
  } catch {
    /* diagnostic sink must never throw */
  }
}

/** JSON stringify that survives circular/BigInt values (diagnostic-only). */
export function zctxDebugJson(value: unknown): string {
  if (process.env.ZCTX_DEBUG !== '1') return ''
  try {
    return JSON.stringify(value, (_key, item: unknown) =>
      typeof item === 'bigint' ? String(item) : item,
    ) ?? String(value)
  } catch {
    return '<unserializable>'
  }
}
