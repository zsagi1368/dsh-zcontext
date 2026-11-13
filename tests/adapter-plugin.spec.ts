/**
 * V5 adapter-face wiring tests (task card product 1 + acceptance "目录注册
 * + DUPLICATE 冲突路径 + 配置缺失模型 fail-loud"): the plugin's
 * wireAdapterFace against a REAL loaded host face (official-path SKIPPED
 * convention when the host build is absent) and a capturing fake llm
 * runtime — the registered routes, the honest degrade logs, the
 * construction fail-loud list reaching a warn, and the DUPLICATE_ADAPTER
 * conflict precedent (keep the old route + log; boot unaffected).
 */

import { existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'

import type { HostContextLike } from '../src/plugin.ts'
import { ZcontextPlugin } from '../src/plugin.ts'
import { resetAdapterFacesForTest } from '../src/adapter/host.ts'

const HOST_LLM = 'G:/000Github/zDSH/zDSH-main/packages/llm/llm/lib/index.js'
const HOST_PIAI_ROOT = 'G:/000Github/zDSH/zDSH-main/node_modules/.pnpm/@earendil-works+pi-ai@1.0.2_a3a2a33fdd5b7de7825ad7dc4af57d74/node_modules/@earendil-works/pi-ai'
const HOST_LLM_PIAI_ROOT = 'G:/000Github/zDSH/zDSH-main/packages/llm/llm-pi-ai'

function hostOnDisk(): boolean {
  try {
    return existsSync(HOST_LLM)
  } catch {
    return false
  }
}

function setHostEnv(): void {
  process.env.ZCTX_DSH_LLM = HOST_LLM
  process.env.ZCTX_PIAI = HOST_PIAI_ROOT
  process.env.ZCTX_DSH_LLM_PIAI = HOST_LLM_PIAI_ROOT
}

afterAll(() => {
  delete process.env.ZCTX_DSH_LLM
  delete process.env.ZCTX_PIAI
  delete process.env.ZCTX_DSH_LLM_PIAI
})

/** The loader memoizes per process — every case starts from a clean cache. */
function resetFaces(): void {
  resetAdapterFacesForTest()
}

interface LogLine {
  level: string
  message: string
}

interface MockCtx extends HostContextLike {
  readonly logLines: LogLine[]
  readonly registeredAdapters: { routes: readonly string[]; adapter: unknown }[]
  readonly on: (event: string, listener: (...args: never[]) => unknown) => unknown
}

function mockCtx(overrides: { llm?: HostContextLike['llm'] } = {}): MockCtx {
  const logLines: LogLine[] = []
  const registeredAdapters: { routes: readonly string[]; adapter: unknown }[] = []
  const ctx: MockCtx = {
    logLines,
    registeredAdapters,
    logger: {
      info: (m) => logLines.push({ level: 'info', message: m }),
      warn: (m) => logLines.push({ level: 'warn', message: m }),
    },
    tools: { register: () => undefined },
    systemPrompt: { section: () => undefined, context: () => undefined },
    commands: { register: () => undefined },
    reflect: { provide: () => undefined },
    llm: overrides.llm ?? {
      registerAdapter: (routes: readonly string[], adapter: unknown) => {
        registeredAdapters.push({ routes, adapter })
        return {}
      },
      resolveModelInfo: async () => ({ context: { contextWindow: 200000 } }),
    },
    on: () => undefined,
  }
  return ctx
}

const VALID_PROVIDERS = [
  {
    family: 'anthropic-messages',
    baseURL: 'https://gateway.example/v1',
    models: [{ id: 'claude-local', contextWindow: 200000, maxTokens: 8192 }],
  },
]

async function flushAsync(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('plugin: adapter face wiring (V5 S2)', () => {
  it('no providers declared → info keep-alive, nothing registered, no registration continuation', () => {
    const ctx = mockCtx()
    const plugin = new ZcontextPlugin(ctx as unknown as HostContextLike, {})
    expect(ctx.registeredAdapters).toHaveLength(0)
    expect(plugin.adapterRegistration).toBeUndefined()
    expect(ctx.logLines.some((line) => line.message.includes('no providers declared'))).toBe(true)
  })

  it('OFFICIAL PATH (SKIPPED when the host is absent): a valid declaration registers the zctx route with the real adapter class', async () => {
    if (!hostOnDisk()) return // honest skip: no host build on this machine
    resetFaces()
    setHostEnv()
    const ctx = mockCtx()
    const plugin = new ZcontextPlugin(ctx as unknown as HostContextLike, {
      providers: VALID_PROVIDERS,
    } as never)
    expect(plugin.adapterRegistration).toBeInstanceOf(Promise)
    await plugin.adapterRegistration
    expect(ctx.registeredAdapters).toHaveLength(1)
    const { routes, adapter } = ctx.registeredAdapters[0] as { routes: readonly string[]; adapter: Record<string, unknown> }
    expect(routes).toEqual(['zctx-anthropic-messages'])
    // The registered object IS the F2 face (duck contract, F1.1).
    expect(typeof adapter.providerInfo).toBe('function')
    expect(typeof adapter.stream).toBe('function')
    expect((adapter.providerInfo as (p: string) => { id: string; name: string })('zctx-anthropic-messages').name)
      .toBe('zctx anthropic-messages')
    // The mapping provenance lands in the info log (honest face label).
    expect(ctx.logLines.some((line) => line.message.includes('mapping: official-pi-ai-mapping'))
      || ctx.logLines.some((line) => line.message.includes('mapping: zctx-mapping'))).toBe(true)
  }, 20000)

  it('config violations reach a warn with the COMPLETE list; nothing registers', async () => {
    if (!hostOnDisk()) return // honest skip
    resetFaces()
    setHostEnv()
    const ctx = mockCtx()
    const plugin = new ZcontextPlugin(ctx as unknown as HostContextLike, {
      providers: [
        { family: 'not-a-protocol', models: [{ id: 'x', contextWindow: 1 }] },
        { family: 'openai-completions', models: [] },
      ],
    } as never)
    await plugin.adapterRegistration
    expect(ctx.registeredAdapters).toHaveLength(0)
    const warn = ctx.logLines.find((line) => line.level === 'warn' && line.message.includes('not serviceable'))
    expect(warn).toBeDefined()
    expect(warn?.message).toContain('family "not-a-protocol" is not a supported wire protocol')
    expect(warn?.message).toContain('declares no models')
  }, 20000)

  it('DUPLICATE_ADAPTER conflict: the runtime refusal keeps the old route + logs; boot unaffected (F9.3 precedent)', async () => {
    if (!hostOnDisk()) return // honest skip
    resetFaces()
    setHostEnv()
    const ctx = mockCtx({
      llm: {
        registerAdapter: () => {
          throw new Error('an adapter for provider "zctx-anthropic-messages" is already registered')
        },
        resolveModelInfo: async () => ({ context: { contextWindow: 200000 } }),
      } as never,
    })
    const plugin = new ZcontextPlugin(ctx as unknown as HostContextLike, {
      providers: VALID_PROVIDERS,
    } as never)
    await plugin.adapterRegistration
    expect(ctx.registeredAdapters).toHaveLength(0)
    const warn = ctx.logLines.find((line) => line.level === 'warn' && line.message.includes('registration failed'))
    expect(warn).toBeDefined()
    expect(warn?.message).toContain('already registered')
  }, 20000)

  it('unreachable host faces → honest info, no registration (宿主不可达 fail-soft)', async () => {
    if (!hostOnDisk()) return // honest skip: without the host the bare path IS this case; covered there
    resetFaces()
    // Simulate unreachability with a broken override while everything else is set.
    process.env.ZCTX_DSH_LLM = 'G:/000Github/zDSH/zDSH-main/packages/llm/llm/lib/MISSING.js'
    delete process.env.ZCTX_PIAI
    const ctx = mockCtx()
    const plugin = new ZcontextPlugin(ctx as unknown as HostContextLike, {
      providers: VALID_PROVIDERS,
    } as never)
    await plugin.adapterRegistration
    expect(ctx.registeredAdapters).toHaveLength(0)
    expect(ctx.logLines.some((line) => line.level === 'info' && line.message.includes('not reachable from this install'))).toBe(true)
  })

  it('directory face (product 7): visibility-only entries with settingsNs/settingsPath/declared', async () => {
    if (!hostOnDisk()) return // honest skip
    resetFaces()
    setHostEnv()
    const directories: unknown[][] = []
    const ctx = mockCtx({
      llm: {
        registerAdapter: (routes: readonly string[], adapter: unknown) => {
          ctx.registeredAdapters.push({ routes, adapter })
          return {}
        },
        registerConfigurableProviders: (entries: readonly unknown[]) => {
          directories.push([...entries])
          return {}
        },
        resolveModelInfo: async () => ({ context: { contextWindow: 200000 } }),
      } as never,
    })
    const plugin = new ZcontextPlugin(ctx as unknown as HostContextLike, {
      providers: VALID_PROVIDERS,
    } as never)
    await plugin.adapterRegistration
    expect(directories).toHaveLength(1)
    const entries = directories[0] as Record<string, unknown>[]
    expect(entries).toHaveLength(1)
    expect(entries[0]).toEqual({
      provider: 'zctx-anthropic-messages',
      displayName: 'zctx anthropic-messages',
      settingsNs: 'dsh-zcontext',
      settingsPath: ['providers', '0'],
      declared: true,
    })
    // The U1 SKIP honesty lands in the info log: visibility-only, page
    // editing unavailable, config authority = profile overlay patch.
    expect(ctx.logLines.some((line) => line.message.includes('visibility-only'))).toBe(true)
    expect(ctx.logLines.some((line) => line.message.includes('profile overlay patch'))).toBe(true)
  }, 20000)

  it('directory face missing → warn but the adapter registration STANDS; DUPLICATE_DIRECTORY refusal logs and keeps the adapter', async () => {
    if (!hostOnDisk()) return // honest skip
    resetFaces()
    setHostEnv()
    // No registerConfigurableProviders at all.
    const ctx = mockCtx()
    const plugin = new ZcontextPlugin(ctx as unknown as HostContextLike, {
      providers: VALID_PROVIDERS,
    } as never)
    await plugin.adapterRegistration
    expect(ctx.registeredAdapters).toHaveLength(1)
    expect(ctx.logLines.some((line) => line.level === 'warn' && line.message.includes('directory face skipped'))).toBe(true)

    // The runtime refuses the directory (all-or-nothing F1.6): log + adapter stands.
    const ctx2 = mockCtx({
      llm: {
        registerAdapter: (routes: readonly string[], adapter: unknown) => {
          ctx2.registeredAdapters.push({ routes, adapter })
          return {}
        },
        registerConfigurableProviders: () => {
          throw new Error('a configurable provider "zctx-anthropic-messages" is already registered')
        },
        resolveModelInfo: async () => ({ context: { contextWindow: 200000 } }),
      } as never,
    })
    const plugin2 = new ZcontextPlugin(ctx2 as unknown as HostContextLike, {
      providers: VALID_PROVIDERS,
    } as never)
    await plugin2.adapterRegistration
    expect(ctx2.registeredAdapters).toHaveLength(1)
    expect(ctx2.logLines.some((line) => line.level === 'warn' && line.message.includes('directory registration refused'))).toBe(true)
  }, 20000)
})
