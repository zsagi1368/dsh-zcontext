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
    // Command + session feed + observe face (v0.2.0 V2: the sixth face).
    expect(ctx.registeredCommands).toHaveLength(1)
    expect((ctx.registeredCommands[0] as { name: string }).name).toBe('zctx')
    expect([...ctx.listeners.keys()].sort()).toEqual([
      'llm/stream',
      'session/created',
      'session/disposed',
      'session/event',
    ])
  })

  it('degrades face by face when host services are missing', () => {
    const ctx = mockCtx({ tools: undefined, systemPrompt: undefined, commands: undefined, on: undefined })
    new ZcontextPlugin(ctx)
    expect(ctx.registeredTools).toHaveLength(0)
    expect(ctx.registeredSections).toHaveLength(0)
    expect(ctx.registeredContexts).toHaveLength(0)
    expect(ctx.registeredCommands).toHaveLength(0)
    // Six faces: session feed, tools, guidance, nudge, command, observe
    // (the observe face probes ctx.on before the llm runtime, so the missing
    // bus is what it reports here).
    expect(ctx.logLines.filter((l) => l.level === 'warn')).toHaveLength(6)
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

  it('attributes the assembly to the AssembleContext session, not the globally latest one (W4-4)', async () => {
    const ctx = mockCtx()
    new ZcontextPlugin(ctx)
    const context = ctx.registeredContexts[0] as { text: (assembly?: unknown) => string }
    // A: a seeded, routed session (window 200000, foldable spans 2..6).
    const sessionA = routed(seedConversation().session)
    // B: an empty, routed session created LAST — the "globally latest" pick.
    const sessionB = routed(new MockSession())
    ctx.emit('session/created', sessionA)
    ctx.emit('session/created', sessionB)
    await flushAsync()
    // Without a reachable context the documented fallback applies (most
    // recently created session → B, the empty one): B's FIRST crossing
    // renders B's own empty span table.
    expect(context.text()).toContain('(no foldable spans reported)')
    // Official AssembleContext (assembleContextFor passes the Agent as both
    // agent and scope; Agent.session — agent-loop/src/agent.ts:127): the
    // assembly attributed to A must evaluate A's own spans, even though B is
    // the globally most recent session. A's first crossing renders A's spans.
    const forA = context.text({ agent: { session: sessionA }, scope: { session: sessionA } })
    expect(forA).toContain('[context pressure: 50.0% — gentle reminder]')
    expect(forA).toContain('seq 0..8')
    // The assembly attributed to B again: B's crossing was already paid
    // (跨越计次 cache model) → suppressed.
    expect(context.text({ agent: { session: sessionB } })).toBe('')
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

describe('plugin: observe face (llm/stream wiring, v0.2.0 V2 c5)', () => {
  /**
   * Attach an official-shaped session id (official Session carries
   * `id: SessionId`, core/session/src/index.ts:420; the agent loop fills
   * GenerateOptions.sessionId from it — agent-loop/src/agent.ts:718). The
   * mock has none of its own, so the wiring tests pin one on.
   */
  function withId(session: MockSession, id: string): MockSession {
    return Object.assign(session, { id }) as MockSession
  }

  /** A main-chain-shaped llm/stream request (the criterion-1 heuristic passes). */
  function loopRequest(sessionId: string): Record<string, unknown> {
    return {
      provider: 'deepseek',
      model: 'deepseek-chat',
      sessionId,
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
    }
  }

  /** Fire the REGISTERED llm/stream listener (the real registration artifact). */
  async function runRegistered(
    ctx: MockCtx,
    options: Record<string, unknown>,
    chunks: readonly unknown[],
  ): Promise<unknown[]> {
    const listener = ctx.listeners.get('llm/stream')![0] as
      (options: unknown, next: () => AsyncIterable<unknown>) => AsyncIterable<unknown>
    const inner = async function* () {
      for (const chunk of chunks) yield chunk
    }
    const consumed: unknown[] = []
    for await (const chunk of listener(options, () => inner())) consumed.push(chunk)
    return consumed
  }

  function storeOf(plugin: ZcontextPlugin, session: MockSession): FoldStore {
    const store = (plugin as unknown as { stores: WeakMap<object, FoldStore> }).stores.get(session)
    expect(store).toBeInstanceOf(FoldStore)
    return store!
  }

  const OK_CHUNKS = [
    { type: 'text-delta', index: 0, text: 'hi' },
    { type: 'usage', usage: { inputTokens: 10, outputTokens: 2 } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]

  it('registers the llm/stream listener and routes snapshots into the session store (attemptCapture default off)', async () => {
    const ctx = mockCtx()
    const plugin = new ZcontextPlugin(ctx)
    expect(ctx.listeners.get('llm/stream')).toHaveLength(1)
    // The observed session must be watched: created through the feed with an
    // id the request carries.
    const session = withId(seedConversation().session, 'sess-1')
    ctx.emit('session/created', session)
    const consumed = await runRegistered(ctx, loopRequest('sess-1'), OK_CHUNKS)
    // Read-only discipline at the wiring level: chunks pass through in order.
    expect(consumed).toEqual(OK_CHUNKS)
    // The snapshot landed in the per-session store's process-memory ledger
    // (lazy store creation through the plugin's single registry authority;
    // no session-log writes — CARD-F a.1).
    const snapshots = storeOf(plugin, session).requestSnapshots()
    expect(snapshots).toHaveLength(1)
    expect(snapshots[0].sessionId).toBe('sess-1')
    expect(snapshots[0].attemptSeq).toBe(1)
    // Honest projector labeling: without the host lib the fallback twin runs.
    expect(snapshots[0].projector).toBe('local-fallback')
    // attemptCapture default OFF: the usage chunk above was NOT captured.
    expect(storeOf(plugin, session).capturedAttemptUsage()).toHaveLength(0)
  })

  it('without the llm service the observe face is skipped with a warn (five-face precedent)', () => {
    const ctx = mockCtx({ llm: undefined })
    new ZcontextPlugin(ctx)
    expect(ctx.listeners.has('llm/stream')).toBe(false)
    expect(
      ctx.logLines.some(
        (l) => l.level === 'warn' && l.message.includes('llm service unavailable') && l.message.includes('observe face skipped'),
      ),
    ).toBe(true)
    // The other faces stay live — the probe is per-face.
    expect(ctx.registeredTools).toHaveLength(4)
    expect(ctx.listeners.has('session/event')).toBe(true)
  })

  it('observe.enabled=false registers nothing and logs the choice as info, not warn', () => {
    const ctx = mockCtx()
    new ZcontextPlugin(ctx, { 'observe.enabled': false })
    expect(ctx.listeners.has('llm/stream')).toBe(false)
    expect(
      ctx.logLines.some((l) => l.level === 'info' && l.message.includes('observe.enabled=false')),
    ).toBe(true)
    expect(ctx.logLines.some((l) => l.message.includes('observe face skipped'))).toBe(false)
    // Face-scoped switch: every other face stays registered.
    expect(ctx.registeredTools).toHaveLength(4)
    expect(ctx.registeredSections).toHaveLength(1)
    expect(ctx.registeredContexts).toHaveLength(1)
    expect(ctx.registeredCommands).toHaveLength(1)
    expect(ctx.listeners.has('session/event')).toBe(true)
  })

  it('observe.attemptCapture=true records failed-attempt usage into the non-durable ledger', async () => {
    const ctx = mockCtx()
    const plugin = new ZcontextPlugin(ctx, { 'observe.attemptCapture': true })
    const session = withId(seedConversation().session, 'sess-1')
    ctx.emit('session/created', session)
    const chunks = [
      { type: 'usage', usage: { inputTokens: 11, outputTokens: 3, cacheReadTokens: 90 } },
      { type: 'finish', reason: { kind: 'error', failure: { message: 'boom' } } },
    ]
    const consumed = await runRegistered(ctx, loopRequest('sess-1'), chunks)
    expect(consumed).toEqual(chunks)
    const captures = storeOf(plugin, session).capturedAttemptUsage()
    expect(captures).toHaveLength(1)
    expect(captures[0]).toMatchObject({
      sessionId: 'sess-1',
      attemptSeq: 1,
      outcome: 'error',
      nonDurable: true,
      usage: { inputTokens: 11, outputTokens: 3, cacheReadTokens: 90 },
    })
  })

  it('unwatched session ids pass through with no snapshot (criterion 3 at the wiring level)', async () => {
    const ctx = mockCtx()
    const plugin = new ZcontextPlugin(ctx)
    // No session/created: the id resolves to nothing watched.
    const consumed = await runRegistered(ctx, loopRequest('ghost-9'), OK_CHUNKS)
    expect(consumed).toEqual(OK_CHUNKS)
    // Once the id becomes watched (created through the feed), the SAME id's
    // first request snapshots as attemptSeq 1 — proof the unwatched firing
    // absorbed nothing into any ledger.
    const session = withId(new MockSession(), 'ghost-9')
    ctx.emit('session/created', session)
    await runRegistered(ctx, loopRequest('ghost-9'), OK_CHUNKS)
    const snapshots = storeOf(plugin, session).requestSnapshots()
    expect(snapshots).toHaveLength(1)
    expect(snapshots[0].attemptSeq).toBe(1)
  })

  it('session/disposed clears the observe listener state (a re-created id restarts its attempt seq)', async () => {
    const ctx = mockCtx()
    const plugin = new ZcontextPlugin(ctx)
    const session = withId(seedConversation().session, 'sess-1')
    ctx.emit('session/created', session)
    await runRegistered(ctx, loopRequest('sess-1'), OK_CHUNKS)
    expect(storeOf(plugin, session).requestSnapshots()[0].attemptSeq).toBe(1)
    ctx.emit('session/disposed', session)
    // Re-create the same id: the listener state was dropped with the session,
    // so the fresh state's attemptSeq restarts at 1 (a leak would continue at 2).
    ctx.emit('session/created', session)
    await runRegistered(ctx, loopRequest('sess-1'), OK_CHUNKS)
    const snapshots = storeOf(plugin, session).requestSnapshots()
    expect(snapshots).toHaveLength(2)
    expect(snapshots[1].attemptSeq).toBe(1)
  })
})
