/**
 * ZCTX-UI B4 D6 acceptance tests — settings.section slot summary card
 * (DESIGN §5 / V7 / Z1 / Z21 / Z25 / 反-C2).
 *
 * - inject gate present → one registration with fresh id + order, no priority;
 * - slots absent → lazy no-op (no throw, no PENDING);
 * - React absent → degrade to a plain-link component (no crash, 反-C2);
 * - bundle factory contract: single-arg factory(require) + module scaffold,
 *   banner id === package name, require('react') present, no priority property;
 * - summary parsing is fail-soft.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import {
  name as fiberName,
  inject as fiberInject,
  apply,
  parseSummary,
  createSummaryCard,
  fiber,
  type ClientCtx,
  type ReactLike,
  type StylesLike,
} from '../src/client/index.ts'

/** Minimal React mock recording createElement calls. */
function mockReact(): ReactLike & { calls: unknown[][] } {
  const calls: unknown[][] = []
  return {
    calls,
    createElement(type: unknown, props?: Record<string, unknown> | null, ...children: unknown[]) {
      calls.push([type, props, ...children])
      return { type, props, children }
    },
  }
}

/** Client ctx with a working slots facade. */
function slotsCtx(): ClientCtx & {
  injected: string[]
  registered: { opts: Record<string, unknown>; component: unknown }[]
} {
  const injected: string[] = []
  const registered: { opts: Record<string, unknown>; component: unknown }[] = []
  return {
    injected,
    registered,
    slots: {
      inject(slot: string, register: () => unknown) {
        injected.push(slot)
        register()
        return undefined
      },
      register(opts: Record<string, unknown>, component: (...args: never[]) => unknown) {
        registered.push({ opts, component })
        return undefined
      },
    },
    get(key: string) {
      if (key === 'styles') return undefined
      return undefined
    },
  }
}

describe('ZCTX-UI D6: client fiber identity + inject gate (V7)', () => {
  it('name === package name; inject === ["slots"] only (Z21 minimal set)', () => {
    expect(fiberName).toBe('dsh-zcontext')
    expect(fiberInject).toEqual(['slots'])
    expect(fiber.inject).toEqual(['slots'])
    expect(fiber.name).toBe('dsh-zcontext')
  })

  it('slots present → injects settings.section with fresh id, order, no priority', () => {
    const ctx = slotsCtx()
    const React = mockReact()
    apply(ctx, { React, fetchText: async () => '{}' })
    expect(ctx.injected).toEqual(['settings.section'])
    expect(ctx.registered).toHaveLength(1)
    const opts = ctx.registered[0].opts
    expect(opts).toMatchObject({ name: 'settings.section', id: 'dsh-zcontext-summary', order: 50, registrant: 'dsh-zcontext' })
    expect(Object.prototype.hasOwnProperty.call(opts, 'priority')).toBe(false)
  })

  it('slots absent → lazy no-op, no throw, no PENDING (Z21/A1-2)', () => {
    const bare: ClientCtx = { get: () => undefined }
    expect(() => apply(bare, { React: mockReact() })).not.toThrow()
  })

  it('inject throws (undeclared slot) → swallowed, no crash', () => {
    const ctx: ClientCtx = {
      get: () => undefined,
      slots: {
        inject() { throw new Error('slot not declared') },
        register: () => undefined,
      },
    }
    expect(() => apply(ctx, { React: mockReact() })).not.toThrow()
  })

  it('React absent → degrades to a REAL clickable /zctx-ui link (not a blank null card, 反-C2/B5-1)', () => {
    const ctx = slotsCtx()
    const doc = {
      createElement(tag: string) {
        const node = {
          tag,
          href: '',
          textContent: '',
          setAttribute(name: string, value: string) { if (name === 'href') node.href = value },
        }
        return node
      },
    }
    apply(ctx, { React: undefined, fetchText: async () => '{}', document: doc as never })
    expect(ctx.registered).toHaveLength(1)
    const component = ctx.registered[0].component as () => { tag: string; href: string; text: string; node?: unknown }
    expect(typeof component).toBe('function')
    // TRUE render assertion: invoke the component and inspect the product.
    const rendered = component()
    expect(rendered).not.toBeNull()
    expect(rendered.tag).toBe('a')
    expect(rendered.href).toBe('/zctx-ui')
    expect(rendered.text.length).toBeGreaterThan(0)
    // The real DOM anchor was created with the href + label.
    expect(rendered.node).toBeDefined()
    const anchor = rendered.node as { href: string; textContent: string }
    expect(anchor.href).toBe('/zctx-ui')
    expect(anchor.textContent.length).toBeGreaterThan(0)
  })
})

describe('ZCTX-UI D6: styles + summary (V7)', () => {
  it('styles service present → insert(CSS) + effect disposer registered', () => {
    const ctx = slotsCtx()
    let css = ''
    const styles: StylesLike = { insert(c) { css = c; return () => undefined } }
    ctx.get = (key: string) => (key === 'styles' ? styles : undefined)
    let effectLabel = ''
    ctx.effect = (_fn, label) => { effectLabel = label ?? ''; return undefined }
    apply(ctx, { React: mockReact(), fetchText: async () => '{}' })
    expect(css).toContain('--dsw-alias-')
    expect(effectLabel).toBe('zctx-summary-styles')
  })

  it('parseSummary extracts foldCount/pressurePct/sessionId; malformed → undefined', () => {
    const good = JSON.stringify({
      attribution: { foldCount: 7 },
      window: { pressurePct: 42.5 },
      sessionId: 's1',
    })
    expect(parseSummary(good)).toEqual({ foldCount: 7, pressurePct: 42.5, sessionId: 's1' })
    expect(parseSummary('not json')).toBeUndefined()
    expect(parseSummary('{}')).toEqual({ foldCount: 0, pressurePct: undefined, sessionId: undefined })
  })

  it('card renders a link to /zctx-ui with summary text', () => {
    const React = mockReact()
    const card = createSummaryCard(React, { foldCount: 3, pressurePct: 12.3, sessionId: 's1' }, async () => '{}')
    expect(typeof card).toBe('function')
    ;(card as () => unknown)()
    const serialized = JSON.stringify(React.calls)
    expect(serialized).toContain('/zctx-ui')
    expect(serialized).toContain('折叠 3 次')
    expect(serialized).toContain('12.3%')
  })
})

describe('ZCTX-UI D6: bundle factory contract (Z1)', () => {
  const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'))
  const dist = readFileSync(fileURLToPath(new URL('../dist/client.cjs', import.meta.url)), 'utf8')

  it('bundle opens with single-arg factory(require) + self-built module scaffold', () => {
    expect(dist).toMatch(/^window\.__ModuleLoader__\.load\(\{ id: "[^"]+", factory: \(require\) => \{ var module = \{ exports: \{\} \}; var exports = module\.exports;/)
    expect(dist).toMatch(/\breturn module\.exports;\s*\}\s*\);\s*$/)
  })

  it('banner id (stripped /client) === package name (handshake)', () => {
    const id = dist.match(/^window\.__ModuleLoader__\.load\(\{ id: "([^"]+)"/)?.[1] ?? ''
    expect(id.endsWith('/client') ? id.slice(0, -'/client'.length) : id).toBe(pkg.name)
  })

  it('uses require("react") platform seed; NO legacy three-arg factory', () => {
    expect(dist).toContain('require("react")')
    expect(dist).not.toMatch(/factory:\s*\(require,\s*module,\s*exports\)/)
  })

  it('slot options include order but NO priority property anywhere in registration', () => {
    expect(dist).toContain('settings.section')
    expect(dist).toContain('dsh-zcontext-summary')
    expect(dist).toMatch(/order:\s*50/)
    expect(dist).not.toMatch(/priority\s*:/)
  })

  it('manifest dsh.client + exports["./client"] match DESIGN §6', () => {
    expect(pkg.dsh.client).toEqual({ platform: 'web', inject: ['@deepseek-ai/dsh-client-ui-slots'] })
    expect(pkg.exports['./client']).toBe('./dist/client.cjs')
    // bundle patch entry unchanged
    expect(pkg.dsh.bundle).toEqual({ patch: './cordis.patch.yml' })
  })
})
