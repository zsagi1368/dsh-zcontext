/**
 * Disciplined mock host — the cordis get-trap semantics enforced as a mock
 * (v0.2.1 P0 anti-recurrence mechanism, tasks/ZCTX/cards/P0-inject-fix.md
 * product 2; plan §1 "纪律升级（防复发本体）").
 *
 * WHY: the v0.2.0 real-device failure (`cannot get property "tokenMeter"
 * without inject`) happened because every earlier mock let the plugin read
 * service properties freely — the "mock all green ≠ real device" trap. This
 * helper mirrors the vendored cordis ReflectService.get handler
 * (zDSH-main vendor/cordis/src/reflect.ts:136-165) so an undeclared service
 * access fails here exactly like it fails there:
 *
 *   1. special properties (symbols, `prototype`/`then`, numeric strings,
 *      `_`-prefixed) resolve directly          — reflect.ts:86-91,137
 *   2. own/prototype properties of the target resolve directly
 *                                              — reflect.ts:138-140
 *   3. inject-declared service names resolve from the provided-service store
 *      (the fiber.store mirror; a real host pre-populates it through
 *      fiber._checkImpl and keeps the plugin PENDING when a declared service
 *      is missing, fiber.ts:597-621)           — reflect.ts:148-165
 *   4. everything else throws the exact cordis error
 *      `cannot get property "<prop>" without inject`
 *                                              — reflect.ts:142,144
 *
 * STRUCTURAL MIRROR of the real host shape:
 *   - service stubs live in `store`, NEVER on the target (on the real host a
 *     provided service sits in a fiber store, not on the context object —
 *     that is precisely why undeclared access throws);
 *   - `logger` is an own Context property (vendor/cordis/src/context.ts:81)
 *     and `on` a mixin accessor (reflect.ts:56-67) — both are non-service
 *     surface and belong on the mock target; the mock models accessors as
 *     plain own properties (a structural simplification: the plugin probes
 *     them with `typeof`, which cannot tell the two apart);
 *   - `inject` is read LIVE from the plugin class by the callers — the mock
 *     never duplicates the list, so any new `ctx.<service>` access added to
 *     plugin.ts without extending `static inject` fails EVERY test that
 *     constructs the plugin (the discipline is self-enforcing).
 *
 * DOCUMENTED DEVIATION (belt domain, plan §1 boundary): a declared-but-absent
 * service resolves `undefined` here, while a real cordis host keeps the
 * plugin PENDING (never constructed) in that state. The belt tests that
 * override a service to undefined pin the face-gate degradation paths, which
 * stay defensive-only on real hosts.
 */

import type { HostContextLike } from '../../src/plugin.ts'

/** Mirror of reflect.ts:89 — `parseInt(prop).toString() === prop`. */
function isNumericString(prop: string): boolean {
  return Number.parseInt(prop, 10).toString() === prop
}

export interface DisciplinedCtxOptions {
  /** Own (non-service) properties: logger, on, reflect, recording fields. */
  readonly target: Record<string, unknown>
  /** Host-provided service stubs keyed by service name (fiber.store mirror). */
  readonly store: Record<string, unknown>
  /** The plugin's static inject list (read live from the class). */
  readonly inject: readonly string[]
}

/** Build a mock host context that enforces the cordis inject discipline. */
export function disciplinedCtx<T = HostContextLike>({
  target,
  store,
  inject,
}: DisciplinedCtxOptions): T {
  const injectSet = new Set(inject)
  return new Proxy(target, {
    get(t, prop, receiver) {
      // reflect.ts:137 — symbols, reserved words, numeric strings, `_`-prefix.
      if (
        typeof prop === 'symbol'
        || prop === 'prototype'
        || prop === 'then'
        || isNumericString(prop)
        || prop.startsWith('_')
      ) {
        return Reflect.get(t, prop, receiver)
      }
      // reflect.ts:138-140 — own/prototype properties resolve directly.
      if (Reflect.has(t, prop)) {
        return Reflect.get(t, prop, receiver)
      }
      // reflect.ts:148-165 — the fiber.store mirror: only inject-declared
      // service names resolve, and only when the host provides them.
      if (injectSet.has(prop)) {
        const impl = store[prop]
        if (impl !== undefined) return impl
        // Declared but not provided: a real host keeps the plugin PENDING
        // (fiber.ts:614-621); the mock constructs anyway (belt) and resolves
        // undefined like a store-walk miss. Documented deviation, see above.
        return undefined
      }
      // reflect.ts:142,144 — the exact device error.
      throw new Error(`cannot get property "${prop}" without inject`)
    },
    has(t, prop) {
      return Reflect.has(t, prop)
    },
  }) as T
}

/**
 * Route mock overrides into the disciplined host shape: inject-declared
 * service names go to the store (the fiber resolution path), everything else
 * (logger, on, recording fields, emit) onto the target. Passing a service
 * override whose value is `undefined` models "the host does not provide it".
 */
export function routeOverrides(
  overrides: Record<string, unknown>,
  store: Record<string, unknown>,
  target: Record<string, unknown>,
  inject: readonly string[],
): void {
  for (const [key, value] of Object.entries(overrides)) {
    if (inject.includes(key)) store[key] = value
    else target[key] = value
  }
}
