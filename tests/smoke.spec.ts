import { describe, expect, it } from 'vitest'

import ZcontextPlugin, { configDefaults, configSchema, name } from '../lib/index.js'

/**
 * W1 smoke probe (the Z7 artifact probe): import the BUILT lib/ output, not
 * the sources, so the committed artifact itself is what gets exercised (Z3:
 * git installs never run builds — the pinned tree must work as-is).
 *
 * W4 note: the plugin class extends the cordis Service base (structural
 * peer, resolved lazily). Construction therefore needs a minimal
 * cordis-compatible context (reflect.provide); the assertions on identity,
 * Config, defaults, and config storage are unchanged.
 */

/** Minimal cordis-compatible host context (real Service base registers here). */
function minimalCtx(): {
  reflect: { provide: (name: string, value: unknown) => unknown }
  logger?: { info(message: string): void; warn(message: string): void }
} {
  return { reflect: { provide: () => undefined } }
}

describe('dsh-zcontext skeleton smoke', () => {
  it('exposes the frozen identity exports', () => {
    expect(name).toBe('dsh-zcontext')
    expect(typeof ZcontextPlugin).toBe('function')
    expect(ZcontextPlugin.name).toBe('ZcontextPlugin')
  })

  it('declares an empty inject list and a Config schema (loader entry shape)', () => {
    expect(ZcontextPlugin.inject).toEqual([])
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
    })
    expect(Object.isFrozen(configDefaults)).toBe(true)
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
