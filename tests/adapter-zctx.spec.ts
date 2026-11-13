/**
 * V5 adapter class tests (task card products 1/3, S2): ZctxAdapter over a
 * structural fake base — the F2 table members (providerInfo displayName /
 * providerRetryPolicy undefined decision / listModels / resolveModel with
 * the INVALID_MODEL_CONTEXT construction gate upstream), prepareCall
 * snapshot freeze, the stream pipeline over the REAL twins mapping with a
 * FAKE pi-ai api face (no network), the two error paths (throw LlmError
 * taxonomy incl. transport classification / in-band finish chunks), the R4
 * maxRetries=0 pin, and the S2 text-only image refusal.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { buildMappingTwins } from '../src/adapter/twins.ts'
import type { AdapterLoggerLike, ZctxAdapterDeps, ZctxAdapterFace } from '../src/adapter/zctx-adapter.ts'
import { createZctxAdapterClass } from '../src/adapter/zctx-adapter.ts'
import { resolveZctxProviders } from '../src/adapter/providers.ts'
import type { MappingDeps } from '../src/adapter/map.ts'

// The shared spec names a credential env (F4.3 chain); every pipeline test
// sets it up front — the MISSING_CREDENTIAL case deletes it explicitly.
beforeAll(() => {
  process.env.ZCTX_ADAPTER_TEST_KEY = 'test-key-value'
})
afterAll(() => {
  delete process.env.ZCTX_ADAPTER_TEST_KEY
})

// ---------------------------------------------------------------------------
// Harness: fake base + fake host face + fake pi-ai face + REAL twins.
// ---------------------------------------------------------------------------

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
  isContextWindowExceededError: () => false,
  isQuotaExceededError: () => false,
}

const HostLlmError = DEPS.LlmError

const HOST = {
  LlmAdapter: class {},
  LlmError: HostLlmError,
  CONTEXT_WINDOW_EXCEEDED_CODE: 'CONTEXT_WINDOW_EXCEEDED',
  EMPTY_RESPONSE_CODE: 'EMPTY_RESPONSE',
  QUOTA_EXCEEDED_CODE: 'QUOTA',
  IMAGE_OFFLOAD_REQUIRED_CODE: 'IMAGE_OFFLOAD_REQUIRED',
  isContextWindowExceededError: DEPS.isContextWindowExceededError,
  isQuotaExceededError: DEPS.isQuotaExceededError,
  attributionHeaders: () => ({ 'x-zctx-test': 'attribution' }),
  contentHasImage: (content: unknown) =>
    Array.isArray(content) && content.some((block) => (block as { type?: string }).type === 'image'),
}

const RESOLVED = resolveZctxProviders(
  {
    providers: [
      {
        family: 'anthropic-messages',
        baseURL: 'https://gateway.example/v1',
        apiKeyEnv: 'ZCTX_ADAPTER_TEST_KEY',
        models: [
          { id: 'm1', contextWindow: 200000, maxTokens: 8192, reasoningEfforts: { 'effort-1': 'low', 'effort-2': 'high' } },
          { id: 'm2', contextWindow: 100000 },
        ],
      },
    ],
  },
  ['openai-completions', 'openai-responses', 'anthropic-messages'],
).providers

const MODEL_M1 = { provider: 'zctx-anthropic-messages', id: 'm1' }

/** One pi-ai event stream for the fake api face. */
async function* eventStream(events: readonly unknown[]): AsyncGenerator<unknown> {
  for (const event of events) yield event
}

interface RecordedCall {
  readonly model: unknown
  readonly context: unknown
  readonly options: Record<string, unknown>
}

/** Build a fake pi-ai face capturing the streamSimple call. */
function fakePiAi(events: readonly unknown[], capture: RecordedCall[]): never | { isContextOverflow: () => boolean; loadApi: () => Promise<object> } {
  return {
    isContextOverflow: () => false,
    loadApi: async () => ({
      stream: () => undefined,
      streamSimple: (model: unknown, context: unknown, options: Record<string, unknown>) => {
        capture.push({ model, context, options })
        return eventStream(events)
      },
    }),
  }
}

function makeAdapter(
  events: readonly unknown[],
  capture: RecordedCall[],
  overrides: Partial<ZctxAdapterDeps> = {},
): ZctxAdapterFace {
  const ZctxAdapter = createZctxAdapterClass(HOST.LlmAdapter as abstract new () => unknown)
  return new ZctxAdapter({
    host: HOST as unknown as ZctxAdapterDeps['host'],
    piAi: fakePiAi(events, capture) as unknown as ZctxAdapterDeps['piAi'],
    mapping: buildMappingTwins(DEPS, () => false),
    providers: RESOLVED,
    ...overrides,
  })
}

const MESSAGES = [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }]

const DONE_EVENT = {
  type: 'done',
  message: {
    content: [{ type: 'text', text: 'hi' }],
    model: 'm1',
    stopReason: 'stop',
    usage: { input: 3, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 5 },
  },
}

async function collect(gen: AsyncIterable<unknown>): Promise<unknown[]> {
  const out: unknown[] = []
  for await (const chunk of gen) out.push(chunk)
  return out
}

const noopLogger: AdapterLoggerLike = { warn: () => undefined, info: () => undefined }

// ---------------------------------------------------------------------------
// F2 table members.
// ---------------------------------------------------------------------------

describe('zctx adapter: F2 table members', () => {
  it('providerInfo carries the configured displayName "zctx <family>"; providerRetryPolicy stays undefined (F2 decision)', () => {
    const adapter = makeAdapter([DONE_EVENT], [])
    expect(adapter.providerInfo('zctx-anthropic-messages')).toEqual({
      id: 'zctx-anthropic-messages',
      name: 'zctx anthropic-messages',
    })
    expect(adapter.providerRetryPolicy('zctx-anthropic-messages')).toBeUndefined()
  })

  it('listModels comes from the settings providers[].models', async () => {
    const adapter = makeAdapter([DONE_EVENT], [])
    expect(await adapter.listModels('zctx-anthropic-messages')).toEqual([
      { provider: 'zctx-anthropic-messages', id: 'm1', name: 'm1', inputModalities: ['text'] },
      { provider: 'zctx-anthropic-messages', id: 'm2', name: 'm2', inputModalities: ['text'] },
    ])
  })

  it('resolveModel declares the config contextWindow (INVALID_MODEL_CONTEXT gated at construction) + reasoning efforts', async () => {
    const adapter = makeAdapter([DONE_EVENT], [])
    const info = (await adapter.resolveModel(MODEL_M1.provider, 'm1')) as {
      context?: { contextWindow?: number }
      defaultMaxTokens?: number
      reasoning?: { efforts: { id: string }[] }
    }
    expect(info.context).toEqual({ contextWindow: 200000 })
    expect(info.defaultMaxTokens).toBe(8192)
    // Efforts = the DISTINCT pi-ai levels of the wire dict, escalation order.
    expect(info.reasoning?.efforts.map((effort) => effort.id)).toEqual(['low', 'high'])
    // A model without efforts offers none (omitting reasoning = unavailable).
    const plain = (await adapter.resolveModel(MODEL_M1.provider, 'm2')) as { reasoning?: unknown }
    expect('reasoning' in plain).toBe(false)
  })

  it('an unowned provider throws NO_ADAPTER; an unconfigured model throws UNKNOWN_MODEL', async () => {
    const adapter = makeAdapter([DONE_EVENT], [])
    await expect(adapter.resolveModel('other-provider', 'm1')).rejects.toMatchObject({ code: 'NO_ADAPTER' })
    await expect(adapter.resolveModel(MODEL_M1.provider, 'ghost')).rejects.toMatchObject({ code: 'UNKNOWN_MODEL' })
    expect(() => adapter.providerInfo('other-provider')).toThrowError(/does not own provider/)
  })

  it('prepareCall freezes the model info for the whole call (official snapshot semantics)', async () => {
    const adapter = makeAdapter([DONE_EVENT], [])
    const prepared = (await adapter.prepareCall(MODEL_M1.provider, 'm1')) as {
      model: { id?: string }
      stream: (options: unknown) => AsyncIterable<unknown>
    }
    expect(prepared.model.id).toBe('m1')
    const chunks = await collect(prepared.stream({ provider: MODEL_M1.provider, model: 'm1', messages: MESSAGES }))
    expect(chunks[chunks.length - 1]).toMatchObject({ type: 'finish', reason: { kind: 'stop' } })
  })
})

// ---------------------------------------------------------------------------
// Stream pipeline + error two paths.
// ---------------------------------------------------------------------------

describe('zctx adapter: stream pipeline (twins mapping over a fake pi-ai face)', () => {
  it('a full turn flows through the REAL twins: block-start/delta/end → usage → finish (usage before finish)', async () => {
    const capture: RecordedCall[] = []
    const adapter = makeAdapter(
      [
        { type: 'text_start', contentIndex: 0, partial: {} },
        { type: 'text_delta', contentIndex: 0, delta: 'hi', partial: {} },
        { type: 'text_end', contentIndex: 0, content: 'hi', partial: {} },
        DONE_EVENT,
      ],
      capture,
    )
    const chunks = await collect(adapter.stream({ provider: MODEL_M1.provider, model: 'm1', messages: MESSAGES }))
    expect(chunks).toHaveLength(5)
    expect(chunks[0]).toEqual({ type: 'block-start', index: 0, blockType: 'text' })
    expect(chunks[chunks.length - 1]).toMatchObject({ type: 'finish', reason: { kind: 'stop' } })
    expect(chunks[chunks.length - 2]).toMatchObject({ type: 'usage', usage: { inputTokens: 3, outputTokens: 2 } })
    // The pi-ai Model was materialized from the config (api === family, A-ruling).
    const model = capture[0]?.model as { api?: string; provider?: string; contextWindow?: number; baseUrl?: string }
    expect(model.api).toBe('anthropic-messages')
    expect(model.provider).toBe('zctx-anthropic-messages')
    expect(model.contextWindow).toBe(200000)
    expect(model.baseUrl).toBe('https://gateway.example/v1')
    expect(capture[0]?.context).toMatchObject({ messages: [{ role: 'user', content: 'hello' }] })
  })

  it('R4 pin: the SDK options carry maxRetries=0 — one adapter call is one SDK attempt', async () => {
    const capture: RecordedCall[] = []
    const adapter = makeAdapter([DONE_EVENT], capture)
    await collect(adapter.stream({ provider: MODEL_M1.provider, model: 'm1', messages: MESSAGES }))
    expect(capture[0]?.options['maxRetries']).toBe(0)
  })

  it('apiKey rides the options from the named env; a missing named env fails MISSING_CREDENTIAL (no ambient fallback)', async () => {
    const capture: RecordedCall[] = []
    const adapter = makeAdapter([DONE_EVENT], capture)
    await collect(adapter.stream({ provider: MODEL_M1.provider, model: 'm1', messages: MESSAGES }))
    expect(capture[0]?.options['apiKey']).toBe('test-key-value')
    // Delete the env: the named reference fails LOUD (F4.3), never falls back.
    delete process.env.ZCTX_ADAPTER_TEST_KEY
    const adapter2 = makeAdapter([DONE_EVENT], [])
    await expect(
      collect(adapter2.stream({ provider: MODEL_M1.provider, model: 'm1', messages: MESSAGES })),
    ).rejects.toMatchObject({ code: 'MISSING_CREDENTIAL' })
    // Restore for the remaining cases (the beforeAll contract).
    process.env.ZCTX_ADAPTER_TEST_KEY = 'test-key-value'
  })

  it('path ONE (throw): a transport failure classifies through the twin table into the official taxonomy', async () => {
    const capture: RecordedCall[] = []
    const piAi = {
      isContextOverflow: () => false,
      loadApi: async () => ({
        stream: () => undefined,
        streamSimple: () => {
          throw new Error('fetch failed: terminated')
        },
      }),
    }
    const ZctxAdapter = createZctxAdapterClass(HOST.LlmAdapter as abstract new () => unknown)
    const adapter = new ZctxAdapter({
      host: HOST as unknown as ZctxAdapterDeps['host'],
      piAi: piAi as unknown as ZctxAdapterDeps['piAi'],
      mapping: buildMappingTwins(DEPS, () => false),
      providers: RESOLVED,
      logger: noopLogger,
    })
    await expect(
      collect(adapter.stream({ provider: MODEL_M1.provider, model: 'm1', messages: MESSAGES })),
    ).rejects.toMatchObject({ code: 'TRANSPORT' })
    void capture
  })

  it('path TWO (in-band): pi-ai error events become error finish chunks, not throws', async () => {
    const adapter = makeAdapter(
      [{
        type: 'error',
        error: {
          content: [],
          model: 'm1',
          stopReason: 'error',
          errorMessage: 'HTTP 500 upstream',
          usage: { input: 1, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 1 },
        },
      }],
      [],
    )
    const chunks = await collect(adapter.stream({ provider: MODEL_M1.provider, model: 'm1', messages: MESSAGES }))
    expect(chunks[chunks.length - 1]).toMatchObject({
      type: 'finish',
      reason: { kind: 'error', failure: { code: 'SERVER', message: 'HTTP 500 upstream' } },
    })
  })

  it('caller abort surfaces as ABORTED even when the transport throws', async () => {
    const controller = new AbortController()
    const piAi = {
      isContextOverflow: () => false,
      loadApi: async () => ({
        stream: () => undefined,
        streamSimple: () => {
          throw new Error('socket died')
        },
      }),
    }
    const ZctxAdapter = createZctxAdapterClass(HOST.LlmAdapter as abstract new () => unknown)
    const adapter = new ZctxAdapter({
      host: HOST as unknown as ZctxAdapterDeps['host'],
      piAi: piAi as unknown as ZctxAdapterDeps['piAi'],
      mapping: buildMappingTwins(DEPS, () => false),
      providers: RESOLVED,
      logger: noopLogger,
    })
    controller.abort()
    await expect(
      collect(adapter.stream({
        provider: MODEL_M1.provider,
        model: 'm1',
        messages: MESSAGES,
        signal: controller.signal,
      })),
    ).rejects.toMatchObject({ code: 'ABORTED' })
  })

  it('product 6: ANY image block fails UNSUPPORTED_CONTENT before conversion (S2 text-only, honest boundary)', async () => {
    const adapter = makeAdapter([DONE_EVENT], [])
    await expect(
      collect(adapter.stream({
        provider: MODEL_M1.provider,
        model: 'm1',
        messages: [{ role: 'user', content: [{ type: 'image', attachment: { attachmentId: 'a' } }] }],
      })),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_CONTENT' })
  })

  it('F5.8: GenerateOptions.stop is an explicit UNSUPPORTED_OPTION; an unreachable protocol too', async () => {
    const adapter = makeAdapter([DONE_EVENT], [])
    await expect(
      collect(adapter.stream({ provider: MODEL_M1.provider, model: 'm1', messages: MESSAGES, stop: 'never' })),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_OPTION' })
  })

  it('F2.3: an unsupported reasoning effort throws UNSUPPORTED_REASONING_EFFORT (runtime contract, adapter validates against the config levels)', async () => {
    const adapter = makeAdapter([DONE_EVENT], [])
    await expect(
      collect(adapter.stream({
        provider: MODEL_M1.provider,
        model: 'm1',
        messages: MESSAGES,
        reasoningEffort: 'max',
      })),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_REASONING_EFFORT' })
    // A supported level flows into the pi-ai options.
    const capture: RecordedCall[] = []
    const adapter2 = makeAdapter([DONE_EVENT], capture)
    await collect(adapter2.stream({
      provider: MODEL_M1.provider,
      model: 'm1',
      messages: MESSAGES,
      reasoningEffort: 'high',
    }))
    expect(capture[0]?.options['reasoning']).toBe('high')
  })
})
