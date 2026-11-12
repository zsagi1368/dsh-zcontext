import { describe, expect, it } from 'vitest'

import { FoldStore } from '../src/store.ts'
import { NUDGE_CONTEXT_NAME, NUDGE_CONTEXT_ORDER, ZcontextPlugin } from '../src/plugin.ts'
import type { HostContextLike } from '../src/plugin.ts'
import type { SessionEventLike, SessionLike } from '../src/types.ts'
import { MockSession, msg, seedConversation } from './helpers/mock-session.ts'

/** Recorded mock faces for the host context. */
interface MockCtx extends HostContextLike {
  readonly registeredTools: unknown[]
  readonly registeredSections: unknown[]
  readonly registeredContexts: unknown[]
  readonly registeredCommands: unknown[]
  readonly listeners: Map<string, ((...args: never[]) => unknown)[]>
  readonly logLines: { level: string; message: string }[]
  emit(event: string, ...args: unknown[]): void
}

function mockCtx(overrides: Partial<HostContextLike> = {}): MockCtx {
  const registeredTools: unknown[] = []
  const registeredSections: unknown[] = []
  const registeredContexts: unknown[] = []
  const registeredCommands: unknown[] = []
  const listeners = new Map<string, ((...args: never[]) => unknown)[]>()
  const logLines: { level: string; message: string }[] = []
  const ctx: MockCtx = {
    registeredTools,
    registeredSections,
    registeredContexts,
    registeredCommands,
    listeners,
    logLines,
    logger: {
      info: (m) => logLines.push({ level: 'info', message: m }),
      warn: (m) => logLines.push({ level: 'warn', message: m }),
      error: (m) => logLines.push({ level: 'error', message: m }),
    },
    tools: { register: (d) => registeredTools.push(d) },
    systemPrompt: {
      section: (s) => registeredSections.push(s),
      context: (c) => registeredContexts.push(c),
    },
    commands: { register: (c) => registeredCommands.push(c) },
    tokenMeter: { measure: () => ({ totalTokens: 100000 }) },
    llm: { resolveModelInfo: async () => ({ context: { contextWindow: 200000 }, defaultMaxTokens: 8192 }) },
    reflect: { provide: () => undefined },
    on(event: string, listener: (...args: never[]) => unknown) {
      const list = listeners.get(event) ?? []
      list.push(listener)
      listeners.set(event, list)
      return () => undefined
    },
    emit(event: string, ...args: unknown[]): void {
      for (const listener of listeners.get(event) ?? []) (listener as (...a: unknown[]) => unknown)(...args)
    },
  }
  return Object.assign(ctx, overrides)
}

const FOLD_CONTENT = 'fold 3..5\nFiles listed: a.sql, b.ts, c.md; three files reported.'

/** Flush fire-and-forget warmups (microtasks + a macrotask tick). */
async function flushAsync(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

/**
 * Route the session (request header) so the window-cache warmup can resolve
 * the model info — the real flow reaches this state at the first routed
 * assistant/message event, which re-triggers the warmup from the feed.
 */
function routed(session: MockSession): MockSession {
  const target = session as unknown as {
    requestHeader: () => { config: { provider: string; model: string } }
  }
  target.requestHeader = () => ({ config: { provider: 'deepseek', model: 'test-model' } })
  return session
}

/** Small-window config for fold-capable plugin instances. */
const FOLD_CONFIG = {
  minFoldableTokens: 5,
  summaryFloorChars: 10,
  protectionFloorTokens: 0,
  keepRecentTokens: 0,
}

describe('plugin: face wiring', () => {
  it('enabled=false registers nothing and logs passivity', () => {
    const ctx = mockCtx()
    new ZcontextPlugin(ctx, { enabled: false })
    expect(ctx.registeredTools).toHaveLength(0)
    expect(ctx.registeredSections).toHaveLength(0)
    expect(ctx.registeredContexts).toHaveLength(0)
    expect(ctx.registeredCommands).toHaveLength(0)
    expect(ctx.listeners.size).toBe(0)
    expect(ctx.logLines.some((l) => l.level === 'info' && l.message.includes('disabled by config'))).toBe(true)
  })

  it('registers the four tools, guidance section, nudge context, command, and session feed', () => {
    const ctx = mockCtx()
    new ZcontextPlugin(ctx)
    // Tools: exactly the four zctx names, defineTool-shaped, NO isConcurrencySafe.
    expect(ctx.registeredTools).toHaveLength(4)
    const names = ctx.registeredTools.map((t) => (t as { name: string }).name)
    expect(names).toEqual(['zctx_fold', 'zctx_unfold', 'zctx_recall', 'zctx_status'])
    for (const tool of ctx.registeredTools as unknown as Record<string, unknown>[]) {
      expect(tool.isConcurrencySafe).toBeUndefined()
      expect(tool.output).toBeDefined()
    }
    // Guidance section (S10: byte-stable spec, never complete).
    expect(ctx.registeredSections).toHaveLength(1)
    const section = ctx.registeredSections[0] as Record<string, unknown>
    expect(section.name).toBe('zctx-guidance')
    expect(section.order).toBe(900)
    expect(section.interpolate).toBe(false)
    expect('complete' in section).toBe(false)
    expect(typeof section.text).toBe('string')
    // Nudge context (B2: required true).
    expect(ctx.registeredContexts).toHaveLength(1)
    const context = ctx.registeredContexts[0] as Record<string, unknown>
    expect(context.name).toBe(NUDGE_CONTEXT_NAME)
    expect(context.order).toBe(NUDGE_CONTEXT_ORDER)
    expect(context.required).toBe(true)
    expect(context.interpolate).toBe(false)
    expect(typeof context.text).toBe('function')
    // Command + session feed.
    expect(ctx.registeredCommands).toHaveLength(1)
    expect((ctx.registeredCommands[0] as { name: string }).name).toBe('zctx')
    expect([...ctx.listeners.keys()].sort()).toEqual(['session/created', 'session/disposed', 'session/event'])
  })

  it('degrades face by face when host services are missing', () => {
    const ctx = mockCtx({ tools: undefined, systemPrompt: undefined, commands: undefined, on: undefined })
    new ZcontextPlugin(ctx)
    expect(ctx.registeredTools).toHaveLength(0)
    expect(ctx.registeredSections).toHaveLength(0)
    expect(ctx.registeredContexts).toHaveLength(0)
    expect(ctx.registeredCommands).toHaveLength(0)
    // Five faces: session feed, tools, guidance, nudge, command.
    expect(ctx.logLines.filter((l) => l.level === 'warn')).toHaveLength(5)
    expect(ctx.logLines.every((l) => l.message.includes('skipped'))).toBe(true)
  })
})

describe('plugin: nudge context (B2 required + threshold crossing)', () => {
  it('keeps required:true under the official suppression filter and contributes only on crossings', async () => {
    const ctx = mockCtx()
    new ZcontextPlugin(ctx)
    const context = ctx.registeredContexts[0] as {
      name: string
      required?: boolean
      text: () => string
    }
    // Direct registration assertion (W4-2: no local reference-implementation
    // loop). The official suppression filter keeps a contribution exactly when
    // `required === true` (system-prompt/src/index.ts:667 and :682 —
    // `.filter(entry => entry.required === true)` / `requiredContexts`), so
    // this flag is the one property that must hold; executing the real filter
    // belongs to the real-host integration wave.
    expect(context.required).toBe(true)

    // Warm the window cache through session/created + mock llm.
    const session = routed(seedConversation().session)
    ctx.emit('session/created', session)
    await flushAsync()
    // First evaluation: pressure jumps to 50% → 25 and 50 both cross.
    const first = context.text()
    expect(first).toContain('[context pressure: 50.0% — gentle reminder]')
    expect(first).toContain('Foldable spans')
    // Second evaluation: no new crossing → '' (no-op on the wire).
    expect(context.text()).toBe('')
  })

  it('contributes nothing without a live session, window, or meter', () => {
    const ctx = mockCtx({ tokenMeter: undefined })
    new ZcontextPlugin(ctx)
    const context = ctx.registeredContexts[0] as { text: () => string }
    expect(context.text()).toBe('')
    const noMeterCtx = mockCtx()
    new ZcontextPlugin(noMeterCtx)
    const noMeterContext = noMeterCtx.registeredContexts[0] as { text: () => string }
    // Live session but no meter → still nothing (honest).
    expect(noMeterContext.text()).toBe('')
  })

  it('stays silent below the CCM legal domain even with a known window', async () => {
    const ctx = mockCtx({
      llm: { resolveModelInfo: async () => ({ context: { contextWindow: 16384 } }) },
    })
    new ZcontextPlugin(ctx)
    const context = ctx.registeredContexts[0] as { text: () => string }
    ctx.emit('session/created', routed(seedConversation().session))
    await flushAsync()
    expect(context.text()).toBe('')
  })
})

describe('plugin: session feed maintains stores', () => {
  it('builds the per-session store from the feed and keeps folds fresh', async () => {
    const ctx = mockCtx()
    const plugin = new ZcontextPlugin(ctx, FOLD_CONFIG)
    const { session } = seedConversation()
    ctx.emit('session/created', session)
    await flushAsync()
    // Events appended BEFORE attach are covered by the first-use scan; live
    // appends flow through the feed.
    const command = ctx.registeredCommands[0] as {
      handler: (invocation: { agent?: { session?: SessionLike }; rawInput: string }) => Promise<{ kind: string; text?: string }>
    }
    const foldResult = await command.handler({ agent: { session }, rawInput: `fold ${FOLD_CONTENT.slice('fold '.length)}` })
    expect(foldResult.kind).toBe('success')
    // A live append after the fold flows through the feed into the store.
    session.append('user/message', msg.user('new turn after fold'))
    ctx.emit('session/event', session, session.log[session.log.length - 1] as SessionEventLike)
    const status = await command.handler({ agent: { session }, rawInput: 'status' })
    expect(status.kind).toBe('success')
    expect(status.text).toContain('Folds (1 active)')
    expect(status.text).toContain('f9 [active]')
    // The store is keyed per session (one FoldStore per live session).
    const store = (plugin as unknown as { stores: WeakMap<SessionLike, FoldStore> }).stores.get(session)
    expect(store).toBeInstanceOf(FoldStore)
    expect([...store!.foldMap.keys()]).toEqual(['f9'])
  })
})

describe('plugin: /zctx command dispatch', () => {
  function commandOf(ctx: MockCtx): {
    name: string
    handler: (invocation: { agent?: { session?: SessionLike }; rawInput: string }) => Promise<{ kind: string; text?: string }>
  } {
    const def = ctx.registeredCommands[0] as {
      name: string
      handler: (invocation: { agent?: { session?: SessionLike }; rawInput: string }) => Promise<{ kind: string; text?: string }>
    }
    return def
  }

  it('defaults to status and renders the ledger', async () => {
    const ctx = mockCtx()
    new ZcontextPlugin(ctx)
    const command = commandOf(ctx)
    const session = seedConversation().session
    const result = await command.handler({ agent: { session }, rawInput: '' })
    expect(result.kind).toBe('success')
    expect(result.text).toContain('window:')
  })

  it('commits folds and unfolds through the command', async () => {
    const ctx = mockCtx()
    new ZcontextPlugin(ctx, FOLD_CONFIG)
    const command = commandOf(ctx)
    const session = seedConversation().session
    const foldResult = await command.handler({ agent: { session }, rawInput: `fold ${FOLD_CONTENT.slice('fold '.length)}` })
    expect(foldResult.kind).toBe('success')
    expect(foldResult.text).toContain('Folded seqs 3–5')
    const unfoldResult = await command.handler({ agent: { session }, rawInput: 'unfold' })
    expect(unfoldResult.kind).toBe('success')
    expect(unfoldResult.text).toContain('Unfolded fold f9')
  })

  it('answers unknown subcommands and fold parse failures with error texts', async () => {
    const ctx = mockCtx()
    new ZcontextPlugin(ctx)
    const command = commandOf(ctx)
    const session = seedConversation().session
    const unknown = await command.handler({ agent: { session }, rawInput: 'wat' })
    expect(unknown).toMatchObject({ kind: 'error' })
    expect(unknown.text).toContain('unknown /zctx subcommand')
    const badFold = await command.handler({ agent: { session }, rawInput: 'fold nothing usable here' })
    expect(badFold).toMatchObject({ kind: 'error' })
    expect(badFold.text).toContain('parsed 0 valid fold ranges')
  })

  it('errors honestly without a session', async () => {
    const ctx = mockCtx()
    new ZcontextPlugin(ctx)
    const command = commandOf(ctx)
    const result = await command.handler({ rawInput: '' })
    expect(result).toMatchObject({ kind: 'error', text: 'zctx: no live session is reachable from this call site' })
  })
})

describe('plugin: tools reach the session through exec.agent', () => {
  it('zctx_status through the registered tool renders the routed window', async () => {
    const ctx = mockCtx()
    new ZcontextPlugin(ctx)
    const statusTool = ctx.registeredTools.find(
      (t) => (t as { name: string }).name === 'zctx_status',
    ) as { execute: (args: unknown, exec: unknown) => Promise<string> }
    const session = seedConversation().session
    const routed = session as unknown as {
      requestHeader: () => { config: { provider: string; model: string } }
    }
    routed.requestHeader = () => ({ config: { provider: 'deepseek', model: 'test-model' } })
    const reply = await statusTool.execute({}, { agent: { session } })
    expect(reply).toContain('window: ~100000 tokens (50.0% of 200000)')
    expect(reply).toContain('trigger line ')
  })
})
