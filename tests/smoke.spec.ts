import { describe, expect, it } from 'vitest'

import ZcontextPlugin, { configDefaults, configSchema, name } from '../lib/index.js'
import { disciplinedCtx } from './helpers/mock-host.ts'

/**
 * W1 smoke probe (the Z7 artifact probe): import the BUILT lib/ output, not
 * the sources, so the committed artifact itself is what gets exercised (Z3:
 * git installs never run builds — the pinned tree must work as-is).
 *
 * W4 note: the plugin class extends the cordis Service base (structural
 * peer, resolved lazily). Construction therefore needs a minimal
 * cordis-compatible context (reflect.provide); the assertions on identity,
 * Config, defaults, and config storage are unchanged.
 *
 * v0.2.1 P0: the minimal context goes through the disciplined host
 * (tests/helpers/mock-host.ts) — an undeclared service access throws the
 * exact cordis device error. `logger: undefined` and `on: undefined` are
 * deliberate: real cordis always carries logger as an own property
 * (context.ts:81) and `on` as a mixin accessor, so EXPLICIT undefined own
 * properties keep the absence belt honest under `Reflect.has` instead of
 * tripping the get-trap throw branch.
 */

/** Minimal cordis-compatible host context (real Service base registers here). */
function minimalCtx(): {
  reflect: { provide: (name: string, value: unknown) => unknown }
  logger?: { info(message: string): void; warn(message: string): void }
} {
  return disciplinedCtx<{
    reflect: { provide: (name: string, value: unknown) => unknown }
    logger?: { info(message: string): void; warn(message: string): void }
  }>({
    target: { reflect: { provide: () => undefined }, logger: undefined, on: undefined },
    store: {},
    inject: ZcontextPlugin.inject,
  })
}

describe('dsh-zcontext skeleton smoke', () => {
  it('exposes the frozen identity exports', () => {
    expect(name).toBe('dsh-zcontext')
    expect(typeof ZcontextPlugin).toBe('function')
    expect(ZcontextPlugin.name).toBe('ZcontextPlugin')
  })

  it('declares the five service inject keys and a Config schema (loader entry shape)', () => {
    // v0.2.1 P0 (P0-inject-fix.md): each key is verified against the
    // provider's registration name on the anchor tree; see plugin.ts.
    // P3 HF-02: 'sessions' removed — declared-but-never-read (zero consumers)
    // turned the official session service into a silent boot blocker.
    expect(ZcontextPlugin.inject).toEqual([
      'tools',
      'systemPrompt',
      'commands',
      'llm',
      'tokenMeter',
    ])
    expect(ZcontextPlugin.Config).toBe(configSchema)
    expect(configSchema['~standard'].version).toBe(1)
    expect(typeof configSchema['~standard'].validate).toBe('function')
  })

  it('freezes the plan §3 config defaults', () => {
    expect(configDefaults).toEqual({
      enabled: true,
      nudgeThresholds: '25,50,75,90',
      keepRecentTokens: 0,
      maxFoldFraction: 0.6,
      minFoldableTokens: 5000,
      protectionFloorTokens: 5000,
      summaryFloorChars: 50,
      summaryCeilingChars: 20000,
      netShrinkTolerance: 1.05,
      attributionTimeWindowMs: 90000,
      cleanSampleFloor: 0.6,
      'observe.enabled': true,
      'observe.attemptCapture': false,
      // v0.2.0 V4 (S1 preflight; R2: enforce unreachable under the default
      // configuration — the pin makes every config-contract change conscious).
      preflightMode: 'observe',
      preflightMarginRatio: 0.9,
      // v0.2.2 P6-C (guard-observe event consumption, plan ZCTX-v03-patch-plan):
      // the log-only consumer is ON by default — inert when the app.asar patch
      // is absent (the event type is never appended then); observation-only,
      // zero interception.
      'patch.guardObserveEvents': true,
      // v0.2.0 V5 (S2 adapter): the volatile providers section defaults to an
      // EMPTY declaration list — zero routes, the adapter face stays a
      // keep-alive under the default configuration.
      providers: [],
    })
    expect(Object.isFrozen(configDefaults)).toBe(true)
    // P3 deep-freeze hardening (AUD-architecture §6): the shared providers
    // array instance is frozen too — every unconfigured plugin used to share
    // one mutable array.
    expect(Object.isFrozen(configDefaults.providers)).toBe(true)
    // And the immutability is structural: any mutation attempt is a no-op
    // (frozen arrays keep their methods but reject the writes).
    const providers = configDefaults.providers as unknown as string[]
    expect(providers.concat('injected').includes('injected')).toBe(true)
    expect(configDefaults.providers).toEqual([])
  })

  it('applies plan §3 defaults when validating an empty config object', async () => {
    const result = await configSchema['~standard'].validate({})
    expect(result.issues).toBeUndefined()
    expect(result.value).toEqual(configDefaults)
  })

  it('rejects primitive type mismatches', async () => {
    const badEnabled = await configSchema['~standard'].validate({ enabled: 'yes' })
    expect(badEnabled.issues?.length).toBeGreaterThan(0)
    const badTokens = await configSchema['~standard'].validate({
      keepRecentTokens: Number.POSITIVE_INFINITY,
    })
    expect(badTokens.issues?.length).toBeGreaterThan(0)
    const badThresholds = await configSchema['~standard'].validate({ nudgeThresholds: 42 })
    expect(badThresholds.issues?.length).toBeGreaterThan(0)
  })

  it('stores the constructor config with defaults applied for absent fields', () => {
    const plugin = new ZcontextPlugin(minimalCtx())
    expect(plugin.config).toEqual(configDefaults)
    expect(Object.isFrozen(plugin.config)).toBe(true)

    const overridden = new ZcontextPlugin(minimalCtx(), { enabled: false, maxFoldFraction: 0.5 })
    expect(overridden.config.enabled).toBe(false)
    expect(overridden.config.maxFoldFraction).toBe(0.5)
    expect(overridden.config.nudgeThresholds).toBe(configDefaults.nudgeThresholds)
    expect(typeof (overridden.ctx as { reflect?: { provide?: unknown } }).reflect?.provide).toBe('function')
  })
})
