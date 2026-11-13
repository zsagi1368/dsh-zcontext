/**
 * V5 adapter core tests (task card products 1/2, S2 wave): the PURE layers —
 * provider-spec resolution with the construction fail-loud violation list
 * (coordinator A-ruling: family = wire protocol name), the chunk-mapping
 * twins (7 chunk shapes, usage strictly before finish, three-count usage
 * semantics, the classify table incl. the undici special cases, the overflow
 * double classifier, STREAM_CLOSED), the replay consume twin (envelope
 * validation, foreign degradation, signature recombination), and the
 * text-only history conversion twin (system split, deferLoading tool filter,
 * tool-name recovery, image/file invariant failures).
 *
 * The official-path loader tests live in adapter-host.spec.ts (SKIPPED
 * convention when the host build is absent).
 */

import { describe, expect, it } from 'vitest'

import { toPiContextTextOnly } from '../src/adapter/context.ts'
import type { ZctxProviderConfig, ZctxProviderModelConfig } from '../src/adapter/providers.ts'
import {
  classifyPiAiErrorTwins,
  mapStopReasonTwins,
  mapUsageTwins,
  toPiReplayStateTwins,
  toStreamChunksTwins,
  type MappingDeps,
} from '../src/adapter/map.ts'
import {
  assertZctxProvidersResolvable,
  resolveZctxProviders,
  zctxDisplayNameOf,
  zctxRouteOf,
} from '../src/adapter/providers.ts'
import { toPiAssistantTwins } from '../src/adapter/replay.ts'

// ---------------------------------------------------------------------------
// Harness.
// ---------------------------------------------------------------------------

/** The official dsh-llm error-code literals (error.ts:25/:28/:42) for the fake deps. */
const DEPS: MappingDeps = {
  LlmError: class ZctxTestLlmError extends Error {
    readonly code: string
    constructor(message: string, code: string) {
      super(message)
      this.code = code
    }
  } as unknown as MappingDeps['LlmError'],
  CONTEXT_WINDOW_EXCEEDED_CODE: 'CONTEXT_WINDOW_EXCEEDED',
  EMPTY_RESPONSE_CODE: 'EMPTY_RESPONSE',
  QUOTA_EXCEEDED_CODE: 'QUOTA',
  isContextWindowExceededError: (message: string) => /context (?:window|length).{0,40}(?:exceed|too (?:long|large))|maximum context/i.test(message),
  isQuotaExceededError: (message: string) => /insufficient|quota/i.test(message),
}

/** A permissive overflow classifier: only the exact probe value counts. */
const overflowOn = (target: unknown) => (message: unknown, contextWindow?: number) =>
  message === target && contextWindow === 128

const SUPPORTED = ['openai-completions', 'openai-responses', 'anthropic-messages']

/** Loose config shape for building malformed fixtures the validator must reject. */
type ZctxProviderConfigLike = Omit<ZctxProviderConfig, 'family' | 'models'> & {
  family?: string
  models?: readonly ZctxProviderModelConfig[]
}

function provider(overrides: Record<string, unknown> = {}): ZctxProviderConfigLike {
  return {
    family: 'anthropic-messages',
    baseURL: 'https://gateway.example/v1',
    apiKeyEnv: 'ZCTX_TEST_KEY',
    models: [{ id: 'm1', contextWindow: 200000, maxTokens: 8192 }],
    ...overrides,
  } as ZctxProviderConfigLike
}

/** Wrap malformed fixtures into the section shape the resolver reads. */
function section(providers: ZctxProviderConfigLike[]): { providers?: readonly ZctxProviderConfig[] } {
  return { providers: providers as unknown as readonly ZctxProviderConfig[] }
}

async function collect(gen: AsyncGenerator<unknown>): Promise<unknown[]> {
  const out: unknown[] = []
  for await (const chunk of gen) out.push(chunk)
  return out
}

/** Wrap an event array into the AsyncIterable the mapping twins consume. */
async function* streamOf(events: readonly unknown[]): AsyncGenerator<unknown> {
  for (const event of events) yield event
}

// ---------------------------------------------------------------------------
// Provider spec resolution (A-ruling).
// ---------------------------------------------------------------------------

describe('adapter providers: resolution + construction fail-loud (A-ruling)', () => {
  it('resolves a valid section with route zctx-<family>, displayName "zctx <family>", protocol === family', () => {
    const { providers, violations } = resolveZctxProviders(section([provider()]), SUPPORTED)
    expect(violations).toEqual([])
    expect(providers).toHaveLength(1)
    const p = providers[0] as unknown as { route: string; displayName: string; protocol: string; models: unknown[] }
    expect(p.route).toBe('zctx-anthropic-messages')
    expect(p.displayName).toBe('zctx anthropic-messages')
    expect(p.protocol).toBe('anthropic-messages') // A-ruling: zero mapping
    expect(p.models).toHaveLength(1)
    expect(zctxRouteOf('openai-completions')).toBe('zctx-openai-completions')
    expect(zctxDisplayNameOf('openai-completions')).toBe('zctx openai-completions')
  })

  it('an absent/empty section resolves to zero providers and zero violations (legal keep-alive)', () => {
    expect(resolveZctxProviders(undefined, SUPPORTED).violations).toEqual([])
    expect(resolveZctxProviders(section([]), SUPPORTED).providers).toEqual([])
    expect(assertZctxProvidersResolvable(undefined, SUPPORTED)).toEqual([])
  })

  it('an unknown family is a violation naming the supported union (zero invented mapping)', () => {
    const { violations } = resolveZctxProviders(section([provider({ family: 'z.ai' })]), SUPPORTED)
    expect(violations).toHaveLength(1)
    expect(violations[0]).toContain('family "z.ai" is not a supported wire protocol')
    expect(violations[0]).toContain('anthropic-messages')
  })

  it('duplicate families race for the same route key → violation (DUPLICATE_ADAPTER avoidance)', () => {
    const { violations } = resolveZctxProviders(
      section([provider(), provider({ baseURL: 'https://other.example/v1' })]),
      SUPPORTED,
    )
    expect(violations).toHaveLength(1)
    expect(violations[0]).toContain('duplicate family "anthropic-messages"')
  })

  it('a provider without models fails (配置缺失模型 fail-loud)', () => {
    const { violations } = resolveZctxProviders(section([provider({ models: [] })]), SUPPORTED)
    expect(violations).toHaveLength(1)
    expect(violations[0]).toContain('declares no models')
  })

  it('contextWindow must be a declared positive integer (INVALID_MODEL_CONTEXT semantics)', () => {
    const { violations } = resolveZctxProviders(
      section([provider({ models: [{ id: 'a' }, { id: 'b', contextWindow: 0 }, { id: 'c', contextWindow: 1.5 }] })]),
      SUPPORTED,
    )
    expect(violations).toHaveLength(3)
    expect(violations[0]).toContain('models[0] ("a"): contextWindow must be a declared positive integer')
    expect(violations[0]).toContain('INVALID_MODEL_CONTEXT')
    expect(violations[1]).toContain('"b"')
    expect(violations[2]).toContain('"c"')
  })

  it('duplicate model ids, bad maxTokens, and empty ids are violations', () => {
    const { violations } = resolveZctxProviders(
      section([provider({
        models: [
          { id: 'dup', contextWindow: 10, maxTokens: 8192 },
          { id: 'dup', contextWindow: 10, maxTokens: 8192 },
          { id: 'bad-max', contextWindow: 10, maxTokens: 0 },
          { id: '', contextWindow: 10 },
        ],
      })]),
      SUPPORTED,
    )
    expect(violations).toHaveLength(3)
    expect(violations[0]).toContain('duplicate model id "dup"')
    expect(violations[1]).toContain('maxTokens must be a positive integer')
    expect(violations[2]).toContain('id is required')
  })

  it('maxTokens is REQUIRED (R5 V5-2: a missing value is a construction violation, never an invented default)', () => {
    const { violations, providers } = resolveZctxProviders(
      section([provider({ models: [{ id: 'no-max', contextWindow: 10 }] })]),
      SUPPORTED,
    )
    expect(violations).toHaveLength(1)
    expect(violations[0]).toContain('maxTokens must be a positive integer declared in config')
    expect(violations[0]).toContain('never an invented default')
    // The violating model never reaches the resolved route (nothing to
    // silently default at stream time).
    expect(providers[0]?.models).toHaveLength(0)
    expect(() => assertZctxProvidersResolvable(
      section([provider({ models: [{ id: 'no-max', contextWindow: 10 }] })]),
      SUPPORTED,
    )).toThrowError(/maxTokens must be a positive integer declared in config/)
  })

  it('R6: ws:// and non-http(s) baseURLs are violations — WebSocket is declared unsupported, never silently accepted', () => {
    const { violations } = resolveZctxProviders(
      section([
        provider({ baseURL: 'wss://gateway.example/ws' }),
        provider({ family: 'openai-completions', baseURL: 'ftp://x' }),
        provider({ family: 'openai-responses', baseURL: 'not-a-url' }),
      ]),
      SUPPORTED,
    )
    expect(violations).toHaveLength(3)
    expect(violations[0]).toContain('R6')
    expect(violations[1]).toContain('R6')
    expect(violations[2]).toContain('not an absolute URL')
  })

  it('assertZctxProvidersResolvable throws ONE error carrying the COMPLETE violation list', () => {
    expect(() => assertZctxProvidersResolvable(
      section([provider({ family: 'nope' }), provider({ family: 'openai-completions', models: [] })]),
      SUPPORTED,
    )).toThrowError(/2 violation\(s\)[\s\S]*family "nope" is not a supported[\s\S]*declares no models/)
  })

  it('cache knobs (product 5, F4.6): retention passthrough; format only anthropic and ONLY on openai-completions', () => {
    const ok = resolveZctxProviders(
      section([provider({ family: 'openai-completions', cacheRetention: 'long', cacheControlFormat: 'anthropic' })]),
      SUPPORTED,
    )
    expect(ok.violations).toEqual([])
    expect(ok.providers[0]).toMatchObject({ cacheRetention: 'long', cacheControlFormat: 'anthropic' })

    // 'none' is a legal retention value (disables the markers downstream).
    const none = resolveZctxProviders(
      section([provider({ cacheRetention: 'none' })]),
      SUPPORTED,
    )
    expect(none.violations).toEqual([])
    expect(none.providers[0]?.cacheRetention).toBe('none')

    const bad = resolveZctxProviders(
      section([
        provider({ cacheRetention: 'infinite' }),
        provider({ family: 'openai-completions', cacheControlFormat: 'openai' }),
        provider({ family: 'openai-responses', cacheControlFormat: 'anthropic' }), // non-completions family → dead config
      ]),
      SUPPORTED,
    )
    expect(bad.violations).toHaveLength(3)
    expect(bad.violations[0]).toContain("'none' | 'short' | 'long'")
    expect(bad.violations[1]).toContain("is not 'anthropic'")
    expect(bad.violations[2]).toContain('only meaningful on the openai-completions family')
  })
})

// ---------------------------------------------------------------------------
// Usage mapping twin (F5.6 three-count semantics).
// ---------------------------------------------------------------------------

describe('adapter map twins: mapUsage (three-count mutual exclusivity)', () => {
  it('maps the three counts and carries cache fields ONLY when non-zero (pi-ai reports zeros)', () => {
    const plain = mapUsageTwins({ input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15 })
    expect(plain).toEqual({ inputTokens: 10, outputTokens: 5, totalTokens: 15 })
    expect('cacheReadTokens' in (plain as object)).toBe(false)
    expect('cacheWriteTokens' in (plain as object)).toBe(false)

    const cached = mapUsageTwins({ input: 10, output: 5, cacheRead: 100, cacheWrite: 20, totalTokens: 135 })
    expect(cached).toEqual({ inputTokens: 10, outputTokens: 5, totalTokens: 135, cacheReadTokens: 100, cacheWriteTokens: 20 })
  })

  it('degrades a malformed usage honestly to zeros (no invented counts)', () => {
    expect(mapUsageTwins(undefined)).toEqual({ inputTokens: 0, outputTokens: 0, totalTokens: 0 })
    expect(mapUsageTwins('junk')).toEqual({ inputTokens: 0, outputTokens: 0, totalTokens: 0 })
  })
})

// ---------------------------------------------------------------------------
// classifyPiAiError twin (the ONLY classifier — module-private upstream).
// ---------------------------------------------------------------------------

describe('adapter map twins: classifyPiAiError (official stream.ts:42-68 table)', () => {
  it.each([
    ['status 401 from provider', 'AUTH'],
    ['Error: 403 Forbidden', 'AUTH'],
    ['deepseek: Insufficient Balance', 'QUOTA'],
    ['429 Too Many Requests / rate limit', 'RATE_LIMIT'],
    ['413 Payload Too Large', 'INVALID_REQUEST'],
    ['400 Bad Request', 'INVALID_REQUEST'],
    ['500 Server Error', 'SERVER'],
    ['request timed out after 10s', 'TIMEOUT'],
    ['anthropic: stream ended before message_stop', 'TRANSPORT'],
    ['fetch failed: terminated', 'TRANSPORT'],
    ['premature close', 'TRANSPORT'],
    ['ECONNRESET while reading', 'TRANSPORT'],
  ])('%s → %s', (message, code) => {
    expect(classifyPiAiErrorTwins(message, DEPS)).toBe(code)
  })

  it('an unrecognizable message stays honestly PI_AI_ERROR (no silent UNKNOWN guesses)', () => {
    expect(classifyPiAiErrorTwins('something entirely new', DEPS)).toBe('PI_AI_ERROR')
  })
})

// ---------------------------------------------------------------------------
// mapStopReason twin (overflow double classifier + EMPTY_RESPONSE).
// ---------------------------------------------------------------------------

describe('adapter map twins: mapStopReason (F5.4 overflow + F5.3 codes)', () => {
  it('pi-ai overflow detection wins (usage input above the window)', () => {
    const message = { content: [{ type: 'text', text: 'x' }], model: 'm', stopReason: 'stop', usage: { input: 500, output: 1 } }
    expect(mapStopReasonTwins(message, DEPS, overflowOn(message), 128)).toEqual({
      kind: 'error',
      failure: { message: 'pi-ai detected context overflow for model "m"', code: 'CONTEXT_WINDOW_EXCEEDED' },
    })
  })

  it('official overflow text classification wins (isContextWindowExceededError wording)', () => {
    const message = { content: [{ type: 'text', text: 'x' }], model: 'm', stopReason: 'error', errorMessage: 'prompt is too long: 300000 tokens > 200000 maximum context' }
    const result = mapStopReasonTwins(message, DEPS, () => false, undefined) as { reason: unknown }
    expect(result).toEqual({
      kind: 'error',
      failure: { message: 'prompt is too long: 300000 tokens > 200000 maximum context', code: 'CONTEXT_WINDOW_EXCEEDED' },
    })
    void result
  })

  it('stop with content → stop; content-less stop → EMPTY_RESPONSE (degenerate completion)', () => {
    const withContent = { content: [{ type: 'text', text: 'hi' }], model: 'm', stopReason: 'stop' }
    expect(mapStopReasonTwins(withContent, DEPS, () => false)).toEqual({ kind: 'stop' })
    const empty = { content: [], model: 'm', stopReason: 'stop' }
    expect(mapStopReasonTwins(empty, DEPS, () => false)).toEqual({
      kind: 'error',
      failure: { message: 'model "m" returned a completed response with no content', code: 'EMPTY_RESPONSE' },
    })
  })

  it.each([
    ['length', { kind: 'max-tokens' }],
    ['toolUse', { kind: 'tool-calls' }],
    ['aborted', { kind: 'aborted', failure: { message: 'pi-ai stream aborted', code: 'ABORTED' } }],
    ['pending', { kind: 'error', failure: { message: 'pi-ai stream for model "m" ended pending', code: 'PI_AI_ERROR' } }],
    ['deferred', { kind: 'error', failure: { message: 'pi-ai deferred response for model "m" is not supported', code: 'PI_AI_ERROR' } }],
  ])('%s maps to the official reason', (stopReason, expected) => {
    const message = { content: [{ type: 'text', text: 'x' }], model: 'm', stopReason, usage: {} }
    expect(mapStopReasonTwins(message, DEPS, () => false)).toEqual(expected)
  })

  it('error stopReason classifies through the twin table', () => {
    const message = { content: [], model: 'm', stopReason: 'error', errorMessage: 'HTTP 429' }
    expect(mapStopReasonTwins(message, DEPS, () => false)).toEqual({
      kind: 'error',
      failure: { message: 'HTTP 429', code: 'RATE_LIMIT' },
    })
  })
})

// ---------------------------------------------------------------------------
// toStreamChunks twin (7 shapes; usage strictly before finish).
// ---------------------------------------------------------------------------

describe('adapter map twins: toStreamChunks (7-shape protocol)', () => {
  const noOverflow = () => false

  it('maps a full text turn: block-start → text-delta → block-end → usage → finish (nothing after)', async () => {
    const events: unknown[] = [
      { type: 'start', partial: {} },
      { type: 'text_start', contentIndex: 0, partial: {} },
      { type: 'text_delta', contentIndex: 0, delta: 'he', partial: {} },
      { type: 'text_delta', contentIndex: 0, delta: 'llo', partial: {} },
      { type: 'text_end', contentIndex: 0, content: 'hello', partial: {} },
      { type: 'done', message: { content: [{ type: 'text', text: 'hello' }], model: 'm', stopReason: 'stop', usage: { input: 3, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 5 } } },
    ]
    const chunks = await collect(toStreamChunksTwins(streamOf(events), DEPS, noOverflow, 128))
    expect(chunks).toEqual([
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text: 'he' },
      { type: 'text-delta', index: 0, text: 'llo' },
      { type: 'block-end', index: 0, block: { type: 'text', text: 'hello' } },
      { type: 'usage', usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 } },
      { type: 'finish', reason: { kind: 'stop' }, replayState: expect.anything() },
    ])
    // The protocol order pin: usage immediately precedes finish; nothing follows.
    const types = chunks.map((chunk) => (chunk as { type: string }).type)
    expect(types.indexOf('usage')).toBe(types.length - 2)
    expect(types[types.length - 1]).toBe('finish')
  })

  it('maps reasoning and tool-call blocks; tool arguments re-stringified at block-end (F5.1 raw JSON)', async () => {
    // The partial carries content up to the current index (pi-ai shape):
    // the toolCall partial sits at contentIndex 1.
    const toolPartial = { content: [{ type: 'text', text: '...' }, { type: 'toolCall', id: 'call-1', name: 'zctx_fold' }] }
    const events: unknown[] = [
      { type: 'thinking_start', contentIndex: 0, partial: {} },
      { type: 'thinking_delta', contentIndex: 0, delta: 'hmm', partial: {} },
      { type: 'thinking_end', contentIndex: 0, content: 'hmm', partial: {} },
      { type: 'toolcall_start', contentIndex: 1, partial: toolPartial },
      { type: 'toolcall_delta', contentIndex: 1, delta: '{"a":', partial: toolPartial },
      { type: 'toolcall_delta', contentIndex: 1, delta: '1}', partial: toolPartial },
      { type: 'toolcall_end', contentIndex: 1, toolCall: { id: 'call-1', name: 'zctx_fold', arguments: { a: 1 } } },
      { type: 'done', message: { content: [], model: 'm', stopReason: 'toolUse', usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2 } } },
    ]
    const chunks = await collect(toStreamChunksTwins(streamOf(events), DEPS, noOverflow, 128))
    expect(chunks[0]).toEqual({ type: 'block-start', index: 0, blockType: 'reasoning' })
    expect(chunks[1]).toEqual({ type: 'reasoning-delta', index: 0, text: 'hmm' })
    expect(chunks[2]).toEqual({ type: 'block-end', index: 0, block: { type: 'reasoning', text: 'hmm' } })
    expect(chunks[3]).toEqual({ type: 'block-start', index: 1, blockType: 'tool-call' })
    expect(chunks[4]).toEqual({ type: 'tool-call-delta', index: 1, id: 'call-1', name: 'zctx_fold', argumentsDelta: '{"a":' })
    expect(chunks[5]).toEqual({ type: 'tool-call-delta', index: 1, id: 'call-1', name: 'zctx_fold', argumentsDelta: '1}' })
    expect(chunks[6]).toEqual({
      type: 'block-end',
      index: 1,
      block: { type: 'tool-call', id: 'call-1', name: 'zctx_fold', arguments: '{"a":1}' }, // raw JSON string
    })
    expect(chunks[7]).toEqual({ type: 'usage', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } })
    expect((chunks[8] as { reason: unknown }).reason).toEqual({ kind: 'tool-calls' })
  })

  it('an in-stream error event becomes usage + error finish (pi-ai never throws mid-stream); caller abort upgrades to aborted', async () => {
    const errorEvent = { type: 'error', error: { content: [], model: 'm', stopReason: 'error', errorMessage: 'HTTP 500', usage: { input: 7, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 7 } } }
    const chunks = await collect(toStreamChunksTwins(streamOf([errorEvent]), DEPS, noOverflow, 128))
    expect(chunks).toEqual([
      { type: 'usage', usage: { inputTokens: 7, outputTokens: 0, totalTokens: 7 } },
      { type: 'finish', reason: { kind: 'error', failure: { message: 'HTTP 500', code: 'SERVER' } } },
    ])
    const aborted = await collect(toStreamChunksTwins(streamOf([{ ...errorEvent }]), DEPS, noOverflow, 128, AbortSignal.abort('x')))
    expect((aborted[1] as { reason: { kind: string; failure: { code: string } } }).reason).toEqual({
      kind: 'aborted',
      failure: { message: 'HTTP 500', code: 'ABORTED' },
    })
  })

  it('a source ending without a terminal event throws LlmError STREAM_CLOSED', async () => {
    const gen = toStreamChunksTwins(streamOf([{ type: 'start', partial: {} }]), DEPS, noOverflow, 128)
    await expect(collect(gen)).rejects.toMatchObject({ code: 'STREAM_CLOSED' })
  })

  it('the overflow classifier rides the terminal mapping (contextWindow passed through)', async () => {
    const message = { content: [{ type: 'text', text: 'x' }], model: 'm', stopReason: 'stop', usage: { input: 1, output: 1 } }
    const events = [{ type: 'done', message }]
    const chunks = await collect(toStreamChunksTwins(streamOf(events), DEPS, overflowOn(message), 128))
    expect((chunks[1] as { reason: { kind: string; failure: { code: string } } }).reason.kind).toBe('error')
    expect((chunks[1] as { reason: { failure: { code: string } } }).reason.failure.code).toBe('CONTEXT_WINDOW_EXCEEDED')
  })
})

// ---------------------------------------------------------------------------
// Replay twins (emit + consume).
// ---------------------------------------------------------------------------

describe('adapter replay twins: envelope emit + consume (self-consistent)', () => {
  const message = {
    content: [
      { type: 'text', text: 'answer', textSignature: 'sig-1' },
      { type: 'thinking', thinking: 'thought', thinkingSignature: 'sig-2' },
    ],
    api: 'anthropic-messages',
    provider: 'zctx-anthropic-messages',
    model: 'requested-m',
    responseModel: 'provider-m',
    responseId: 'resp-9',
    usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2 },
    stopReason: 'stop',
  }

  it('emits the versioned envelope (kind pi-ai, version 2, index-aligned blocks)', () => {
    const envelope = toPiReplayStateTwins(message, 'requested-m') as {
      response: Record<string, unknown>
      blocks: { type: string; textSignature?: string; thinkingSignature?: string }[]
    }
    expect(envelope.response).toMatchObject({
      kind: 'pi-ai', version: 2, api: 'anthropic-messages', provider: 'zctx-anthropic-messages', model: 'requested-m', responseModel: 'provider-m', responseId: 'resp-9', stopReason: 'stop',
    })
    expect(envelope.blocks).toEqual([
      { type: 'text', textSignature: 'sig-1' },
      { type: 'reasoning', thinkingSignature: 'sig-2' },
    ])
  })

  it('the consume twin restores native fidelity from OUR OWN envelope (roundtrip)', () => {
    const envelope = toPiReplayStateTwins(message)
    const harnessMessage = {
      content: [
        { type: 'text', text: 'answer' },
        { type: 'reasoning', text: 'thought' },
      ],
      source: { provider: 'zctx-anthropic-messages', model: 'requested-m', replayState: envelope },
    }
    const restored = toPiAssistantTwins(harnessMessage, DEPS) as {
      api: string
      content: { type: string; textSignature?: string; thinkingSignature?: string }[]
      stopReason: string
    }
    expect(restored.api).toBe('anthropic-messages') // NOT dsh-foreign
    expect(restored.stopReason).toBe('stop')
    expect(restored.content).toEqual([
      { type: 'text', text: 'answer', textSignature: 'sig-1' },
      { type: 'thinking', thinking: 'thought', thinkingSignature: 'sig-2' },
    ])
  })

  it('an absent replay state degrades to provider-neutral (api dsh-foreign) without throwing', () => {
    const neutral = toPiAssistantTwins({
      content: [
        { type: 'text', text: 'a' },
        { type: 'tool-call', id: 't1', name: 'tool', arguments: '{"k":1}' },
      ],
      source: { provider: 'p', model: 'm' },
    }, DEPS) as { api: string; content: { type: string; arguments?: unknown }[]; stopReason: string }
    expect(neutral.api).toBe('dsh-foreign')
    expect(neutral.content[1]).toEqual({ type: 'toolCall', id: 't1', name: 'tool', arguments: { k: 1 } })
    expect(neutral.stopReason).toBe('toolUse')
  })

  it('a malformed envelope degrades ONE message and reports the reason (never fails the request)', () => {
    const degraded: string[] = []
    const result = toPiAssistantTwins({
      content: [{ type: 'text', text: 'a' }],
      source: { provider: 'p', model: 'm', replayState: { kind: 'other' } },
    }, DEPS, (reason: string) => degraded.push(reason)) as { api: string }
    expect(result.api).toBe('dsh-foreign')
    expect(degraded).toHaveLength(1)
    expect(degraded[0]).toContain('invalid pi-ai replay state')
  })

  it('a version-2 envelope from ANOTHER adapter (official llm-pi-ai shape) replays through the same schema', () => {
    // Same envelope schema (kind 'pi-ai' version 2) — cross-adapter replay of
    // pi-ai-family history works by construction (module docstring contract).
    const officialEnvelope = {
      response: { kind: 'pi-ai', version: 2, api: 'openai-completions', provider: 'zctx-openai-completions', model: 'm', stopReason: 'stop' },
      blocks: [{ type: 'text' }],
    }
    const restored = toPiAssistantTwins({
      content: [{ type: 'text', text: 'legacy' }],
      source: { provider: 'zctx-openai-completions', model: 'm', replayState: officialEnvelope },
    }, DEPS) as { api: string; content: { type: string; text: string }[] }
    expect(restored.api).toBe('openai-completions')
    expect(restored.content).toEqual([{ type: 'text', text: 'legacy' }])
  })
})

// ---------------------------------------------------------------------------
// Text-only history conversion twin.
// ---------------------------------------------------------------------------

describe('adapter context twin: text-only history conversion', () => {
  it('splits the leading system prompt, filters deferLoading tools, recovers tool names', () => {
    const options = {
      system: 'be brief',
      tools: [
        { name: 'kept', description: 'd', parameters: { type: 'object' } },
        { name: 'deferred', description: 'd', parameters: {}, deferLoading: true },
      ],
      messages: [
        { role: 'system', content: [{ type: 'text', text: 'extra system' }] },
        { role: 'user', content: [{ type: 'text', text: 'q' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'working' }] },
        { role: 'assistant', source: { provider: 'p', model: 'm' }, content: [{ type: 'tool-call', id: 'call-9', name: 'kept', arguments: '{}' }] },
        { role: 'tool', toolCallId: 'call-9', content: [{ type: 'text', text: 'result' }] },
        { role: 'user', content: [{ type: 'text', text: 'thanks' }] },
      ],
    }
    const context = toPiContextTextOnly(options, DEPS) as {
      systemPrompt?: string
      messages: Record<string, unknown>[]
      tools?: { name: string }[]
    }
    expect(context.systemPrompt).toBe('be brief\n\nextra system')
    expect(context.tools).toEqual([{ name: 'kept', description: 'd', parameters: { type: 'object' } }]) // deferLoading filtered
    // After the system split, the history is [user, assistant, assistant(tool-call), tool, user].
    const toolResult = context.messages[3] as { role: string; toolCallId: string; toolName: string; content: { text: string }[] }
    expect(toolResult.role).toBe('toolResult')
    expect(toolResult.toolName).toBe('kept') // recovered from the preceding assistant tool call
    expect(toolResult.content[0]?.text).toBe('result')
  })

  it('developer tool-addition blocks resolve against the declared tools; undeclared → INVALID_REQUEST', () => {
    const ok = toPiContextTextOnly({
      tools: [{ name: 't1', description: 'd', parameters: {} }],
      messages: [
        { role: 'developer', content: [{ type: 'tool-addition', toolName: 't1' }] },
        { role: 'user', content: 'go' },
      ],
    }, DEPS) as { messages: { role: string; toolsAdded?: { name: string }[] }[] }
    expect(ok.messages[0]).toMatchObject({ role: 'system', toolsAdded: [{ name: 't1' }] })

    expect(() => toPiContextTextOnly({
      tools: [],
      messages: [
        { role: 'developer', content: [{ type: 'tool-addition', toolName: 'ghost' }] },
        { role: 'user', content: 'go' },
      ],
    }, DEPS)).toThrowError(/undeclared tool "ghost"/)
  })

  it('images in any history role throw UNSUPPORTED_CONTENT (text-only boundary, product 6)', () => {
    expect(() => toPiContextTextOnly({
      messages: [{ role: 'user', content: [{ type: 'image', attachment: { attachmentId: 'a' } }] }],
    }, DEPS)).toThrowError(/image conversion requires the durable attachment service/)
    expect(() => toPiContextTextOnly({
      messages: [{ role: 'system', content: [{ type: 'opaque-block' }] }],
    }, DEPS)).toThrowError(/non-text system messages/)
  })

  it('an unprojected file block is an invariant violation (F6.2 post-projection contract)', () => {
    expect(() => toPiContextTextOnly({
      messages: [{ role: 'user', content: [{ type: 'file', attachment: {} }] }],
    }, DEPS)).toThrowError(/unprojected file block/)
  })

  it('non-record options and missing messages fail loud (INVALID_REQUEST)', () => {
    expect(() => toPiContextTextOnly('junk', DEPS)).toThrowError(/INVALID_REQUEST|requires GenerateOptions/)
    expect(() => toPiContextTextOnly({ provider: 'p' }, DEPS)).toThrowError(/requires GenerateOptions\.messages/)
  })
})
