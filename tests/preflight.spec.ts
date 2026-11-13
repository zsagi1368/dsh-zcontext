/**
 * V4 S1 preflight tests (task card product 4): the three preflightMode
 * behaviors one by one (off = plugin-level zero listener pin in
 * plugin.spec; observe = record-only, never short-circuits; enforce =
 * short-circuit with the OFFICIAL chunk-form pin), the estimator's two
 * honest paths (official re-projection vs labeled fallback; adapter image
 * pricing vs the constant reserve), the margin hit/no-hit boundary, the
 * calibration record lifecycle (usage comparison, no-usage, error/abort
 * outcomes), the zero-mutation pin reuse, and the R3 structural pin (the
 * deps surface has no stream to self-call).
 *
 * Chunk-form contract (card: 短路后恢复链契约 finish error 形态钉): the
 * synthesized short-circuit is checked against the OFFICIAL protocol as
 * read from source — llm/src/types.ts:452-464 (usage before the terminal
 * finish, nothing afterward), :156-163 (FinishReasonMap error =
 * {kind:'error', failure: LlmFailure}), :41-62 (LlmFailure fields), and
 * error.ts:25 (CONTEXT_WINDOW_EXCEEDED_CODE spelling).
 */

import { existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { afterAll, describe, expect, it, vi } from 'vitest'

import { computeBudget } from '../src/budget.ts'
import { configDefaults, configSchema } from '../src/config.ts'
import { resetHostProjectorCacheForTest } from '../src/host-llm.ts'
import { PreflightListener } from '../src/preflight.ts'
import type { PreflightDeps, PreflightStoreAccess } from '../src/preflight.ts'
import {
  estimateProjectedRequest,
  judgeEstimate,
  resolveMarginRatio,
  PER_IMAGE_FALLBACK_TOKENS,
  PREFLIGHT_CONTEXT_WINDOW_EXCEEDED_CODE,
} from '../src/preflight.ts'
import type { PreflightCalibrationRecord } from '../src/types.ts'
import { FoldStore } from '../src/store.ts'
import { preflightCalibrationStats, renderStatus } from '../src/tools.ts'

afterAll(() => {
  delete process.env.ZCTX_DSH_LLM
  resetHostProjectorCacheForTest()
})

// ---------------------------------------------------------------------------
// Harness (mirrors observe.spec's minimal waterfall contract).
// ---------------------------------------------------------------------------

class CalibrationSink implements PreflightStoreAccess {
  readonly records: PreflightCalibrationRecord[] = []
  absorbPreflightCalibration(record: PreflightCalibrationRecord): void {
    this.records.push(record)
  }
}

function makeDeps(
  store: PreflightStoreAccess,
  overrides: Partial<PreflightDeps> = {},
): PreflightDeps {
  return {
    mode: 'observe',
    marginRatio: 0.9,
    resolveSession: (sessionId: string): unknown => (sessionId === 'sess-1' ? SESSION : undefined),
    storeFor: (session: unknown): PreflightStoreAccess | undefined =>
      session === SESSION ? store : undefined,
    ...overrides,
  }
}

const SESSION = { id: 'sess-1' }

function loopOptions(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    provider: 'deepseek',
    model: 'deepseek-chat',
    sessionId: 'sess-1',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
    ...overrides,
  }
}

const FINISH_OK = { type: 'finish', reason: { kind: 'stop' } }
const USAGE = { type: 'usage', usage: { inputTokens: 100, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0 } }

async function runStream(
  listener: PreflightListener,
  options: unknown,
  chunks: readonly unknown[],
): Promise<{ consumed: unknown[]; innerStarted: boolean }> {
  let innerStarted = false
  const inner = async function* () {
    innerStarted = true
    for (const chunk of chunks) yield chunk
  }
  const consumed: unknown[] = []
  const out = listener.onStream(options, () => inner())
  for await (const chunk of out) consumed.push(chunk)
  return { consumed, innerStarted }
}

/**
 * Model info with a KNOWN context window (200000): the estimate against the
 * default text of loopOptions is tiny, so a HIT needs a deliberately huge
 * message; a no-hit needs nothing special.
 */
const WINDOWED_MODEL_INFO = { context: { contextWindow: 200000 }, defaultMaxTokens: 8192 }

/** A message of ~N tokens by the chars/3 estimator (3 chars per token). */
function bigTextMessage(tokens: number): Record<string, unknown> {
  return { role: 'user', content: [{ type: 'text', text: 'x'.repeat(tokens * 3) }] }
}

// ---------------------------------------------------------------------------
// Pure estimator.
// ---------------------------------------------------------------------------

describe('preflight config contract (R2 pin)', () => {
  it('preflightMode defaults to observe (enforce is unreachable under the default configuration) and margin defaults to 0.9', () => {
    expect(configDefaults.preflightMode).toBe('observe')
    expect(configDefaults.preflightMarginRatio).toBe(0.9)
    // The fail-soft validator resolves the defaults too (roundtrip through
    // the same contract the host reads).
    const resolved = configSchema['~standard'].validate({})
    if (resolved && !('then' in resolved) && resolved.value !== undefined) {
      const value = resolved.value as Record<string, unknown>
      expect(value.preflightMode).toBe('observe')
      expect(value.preflightMarginRatio).toBe(0.9)
    } else {
      expect.unreachable('the fail-soft validator resolves synchronously')
    }
    // The official spelling of the synthesized failure code (error.ts:25).
    expect(PREFLIGHT_CONTEXT_WINDOW_EXCEEDED_CODE).toBe('CONTEXT_WINDOW_EXCEEDED')
  })
})

describe('preflight estimator: pure estimate over projected messages', () => {
  it('counts text chars/3, tool schemas, and system honestly (fallback label comes from the caller)', () => {
    const messages = [
      { role: 'system', content: [{ type: 'text', text: 'a'.repeat(30) }] }, // 10 tokens
      { role: 'user', content: [{ type: 'text', text: 'b'.repeat(60) }] }, // 20 tokens
    ]
    const tools = [{ name: 't', description: 'd'.repeat(30), parameters: {} }] // JSON-wrapped, ≥ ceil(63/3) + structure
    const estimate = estimateProjectedRequest({ messages, tools, system: undefined, pricing: undefined })
    // Text-only subtotal: ceil(90/3) = 30; tools JSON adds structure chars → strictly larger.
    expect(estimate.tokens).toBeGreaterThanOrEqual(30)
    expect(estimate.tokens).toBeLessThan(60)
    expect(estimate.imagePricing).toBe('not-exercised')
    expect(estimate.imageCount).toBe(0)
  })

  it('tool-call history blocks count their raw JSON (arguments stay raw strings on the wire)', () => {
    const messages = [
      { role: 'assistant', content: [{ type: 'tool-call', id: 'c1', name: 'zctx_fold', arguments: '{"content":"' + 'y'.repeat(90) + '"}' }] },
    ]
    const estimate = estimateProjectedRequest({ messages, tools: undefined, system: undefined, pricing: undefined })
    // The raw JSON argument is 99 chars → ≥ 33 tokens plus block structure.
    expect(estimate.tokens).toBeGreaterThanOrEqual(33)
  })

  it('kept images price through the adapter pricing face (visualTokens + text)', () => {
    const image = { type: 'image', attachment: { attachmentId: 'a1' } }
    const messages = [
      { role: 'user', content: [{ type: 'text', text: 'hello' }, image, structuredClone(image) as unknown] },
    ]
    const pricing = {
      priceImages: vi.fn((images: readonly unknown[]) =>
        images.map(() => ({ visualTokens: 500, text: '[image a1]' })),
      ),
    }
    const estimate = estimateProjectedRequest({ messages, tools: undefined, system: undefined, pricing })
    expect(pricing.priceImages).toHaveBeenCalledTimes(1)
    expect(estimate.imageCount).toBe(2)
    expect(estimate.imagePricing).toBe('adapter')
    // 2 × (500 visual + ceil('[image a1]'=10 chars/3)=4 text) = 1008, plus
    // ceil('hello'=5 chars/3)=2 for the text block.
    expect(estimate.tokens).toBe(1008 + 2)
  })

  it('kept images without a pricing face carry the constant reserve (待标定) with the honest label', () => {
    const image = { type: 'image', attachment: { attachmentId: 'a2' } }
    const messages = [{ role: 'user', content: [image] }]
    const estimate = estimateProjectedRequest({ messages, tools: undefined, system: undefined, pricing: undefined })
    expect(estimate.imagePricing).toBe('constant-reserve')
    expect(estimate.imageCount).toBe(1)
    expect(estimate.tokens).toBe(PER_IMAGE_FALLBACK_TOKENS)
  })

  it('a misaligned or throwing pricing face degrades to the constant reserve (fail-soft)', () => {
    const image = { type: 'image', attachment: { attachmentId: 'a3' } }
    const messages = [{ role: 'user', content: [image] }]
    const bad = { priceImages: () => [] } // misaligned length
    const estimate = estimateProjectedRequest({ messages, tools: undefined, system: undefined, pricing: bad })
    expect(estimate.imagePricing).toBe('constant-reserve')
    const throwing = {
      priceImages: () => {
        throw new Error('no pricing for you')
      },
    }
    const estimate2 = estimateProjectedRequest({ messages, tools: undefined, system: undefined, pricing: throwing })
    expect(estimate2.imagePricing).toBe('constant-reserve')
  })

  it('judgeEstimate: hit iff estimate > triggerLine × margin; unknown window releases', () => {
    const window = 200000
    const budget = computeBudget({ contextWindow: window, maxOutput: 8192 })
    const line = Math.ceil(budget.triggerLine * 0.9)
    const under = judgeEstimate({ estimate: line, modelInfo: WINDOWED_MODEL_INFO, optionsMaxTokens: 8192, marginRatio: 0.9 })
    expect(under.hit).toBe(false) // estimate == threshold is NOT a hit (strictly greater)
    expect(under.window).toBe(200000)
    expect(under.triggerLine).toBe(budget.triggerLine)
    const over = judgeEstimate({ estimate: line + 1, modelInfo: WINDOWED_MODEL_INFO, optionsMaxTokens: 8192, marginRatio: 0.9 })
    expect(over.hit).toBe(true)
    // Unknown window → released honestly (F6.4 degrade-to-observe).
    const released = judgeEstimate({ estimate: Number.MAX_SAFE_INTEGER, modelInfo: undefined, optionsMaxTokens: undefined, marginRatio: 0.9 })
    expect(released.hit).toBeUndefined()
    expect(released.window).toBeUndefined()
  })

  it('judgeEstimate: a degenerate computeBudget window releases (hit undefined, window known)', () => {
    const released = judgeEstimate({
      estimate: 1,
      modelInfo: { context: { contextWindow: 2 } }, // cannot sustain the CCM reserve
      optionsMaxTokens: undefined,
      marginRatio: 0.9,
    })
    expect(released.window).toBe(2)
    expect(released.triggerLine).toBeUndefined()
    expect(released.hit).toBeUndefined()
  })

  it('resolveMarginRatio: valid values pass; anything outside (0,1] falls back to 0.9 with a warn', () => {
    const warns: string[] = []
    const logger = { warn: (m: string) => warns.push(m) }
    expect(resolveMarginRatio(0.9, logger)).toBe(0.9)
    expect(resolveMarginRatio(1, logger)).toBe(1)
    expect(resolveMarginRatio(0.5, logger)).toBe(0.5)
    expect(warns).toHaveLength(0)
    expect(resolveMarginRatio(0, logger)).toBe(0.9)
    expect(resolveMarginRatio(-1, logger)).toBe(0.9)
    expect(resolveMarginRatio(1.5, logger)).toBe(0.9)
    expect(resolveMarginRatio(Number.NaN, logger)).toBe(0.9)
    expect(resolveMarginRatio(undefined, logger)).toBe(0.9)
    expect(warns).toHaveLength(5)
    expect(warns[0]).toContain('preflightMarginRatio')
  })
})

// ---------------------------------------------------------------------------
// Three modes.
// ---------------------------------------------------------------------------

describe('preflight listener: observe mode (default; record-only, never short-circuits)', () => {
  it('a hit-level estimate STILL streams through untouched, and the calibration record lands with hit true', async () => {
    const sink = new CalibrationSink()
    const listener = new PreflightListener(makeDeps(sink, {
      resolveModelInfo: async () => WINDOWED_MODEL_INFO,
    }))
    const chunks = [USAGE, FINISH_OK]
    // 170000 estimated tokens: over the calibrated line
    // triggerLine(184640) × 0.9 = 166176 (window 200000, maxOutput 8192).
    const { consumed } = await runStream(listener, loopOptions({ messages: [bigTextMessage(170000)] }), chunks)
    expect(consumed).toEqual(chunks)
    expect(sink.records).toHaveLength(1)
    const record = sink.records[0] as PreflightCalibrationRecord
    expect(record.mode).toBe('observe')
    expect(record.hit).toBe(true)
    expect(record.window).toBe(200000)
    expect(record.projector).toBe('local-fallback') // no host lib in this process — labeled
    // The usage chunk completed the comparison (product 3: estimate vs real).
    expect(record.outcome).toBe('completed')
    expect(record.usage).toEqual({ inputTokens: 100, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0 })
    expect(record.estimate).toBeGreaterThanOrEqual(170000)
  })

  it('non-hit requests stream through and record hit false with the margin echoed', async () => {
    const sink = new CalibrationSink()
    const listener = new PreflightListener(makeDeps(sink, {
      resolveModelInfo: async () => WINDOWED_MODEL_INFO,
      marginRatio: 0.9,
    }))
    const { consumed } = await runStream(listener, loopOptions(), [FINISH_OK])
    expect(consumed).toEqual([FINISH_OK])
    expect(sink.records[0]?.hit).toBe(false)
    expect(sink.records[0]?.marginRatio).toBe(0.9)
    expect(sink.records[0]?.estimate).toBeGreaterThan(0)
    expect(sink.records[0]?.triggerLine).toBe(computeBudget({ contextWindow: 200000, maxOutput: 8192 }).triggerLine)
  })

  it('an unresolvable window releases with hit undefined and still records (honest calibration)', async () => {
    const sink = new CalibrationSink()
    const listener = new PreflightListener(makeDeps(sink)) // no resolveModelInfo → unknown window
    const { consumed } = await runStream(listener, loopOptions({ messages: [bigTextMessage(500000)] }), [FINISH_OK])
    expect(consumed).toEqual([FINISH_OK]) // released
    expect(sink.records[0]?.hit).toBeUndefined()
    expect(sink.records[0]?.window).toBeUndefined()
    expect(sink.records[0]?.triggerLine).toBeUndefined()
  })
})

describe('preflight listener: enforce mode (opt-in; short-circuit on hit only)', () => {
  it('HIT: yields EXACTLY ONE terminal finish error chunk per the official protocol; next() never starts', async () => {
    const sink = new CalibrationSink()
    const listener = new PreflightListener(makeDeps(sink, {
      mode: 'enforce',
      resolveModelInfo: async () => WINDOWED_MODEL_INFO,
    }))
    const { consumed, innerStarted } = await runStream(
      listener,
      loopOptions({ messages: [bigTextMessage(170000)] }), // over the calibrated line
      [USAGE, FINISH_OK], // would have been the wire stream — must never run
    )
    // Chunk protocol (llm/src/types.ts:452-464): exactly one chunk, and it is
    // the terminal finish — no usage precedes it (none exists to report),
    // nothing follows it.
    expect(consumed).toHaveLength(1)
    expect(innerStarted).toBe(false) // the adapter never ran: no wire request
    const finish = consumed[0] as { type: string; reason: { kind: string; failure: Record<string, unknown> } }
    expect(finish.type).toBe('finish')
    expect(finish.reason.kind).toBe('error')
    // LlmFailure shape (types.ts:41-62): message + code; status/requestId
    // honestly absent — the preflight has none.
    expect(finish.reason.failure.code).toBe(PREFLIGHT_CONTEXT_WINDOW_EXCEEDED_CODE)
    expect(finish.reason.failure.code).toBe('CONTEXT_WINDOW_EXCEEDED')
    expect(typeof finish.reason.failure.message).toBe('string')
    expect((finish.reason.failure.message as string).length).toBeGreaterThan(0)
    expect('status' in finish.reason.failure).toBe(false)
    expect('requestId' in finish.reason.failure).toBe(false)
    // The record lands immediately with the short-circuit outcome and no usage.
    expect(sink.records).toHaveLength(1)
    expect(sink.records[0]?.outcome).toBe('short-circuited')
    expect(sink.records[0]?.hit).toBe(true)
    expect(sink.records[0]?.mode).toBe('enforce')
    expect(sink.records[0]?.usage).toBeUndefined()
  })

  it('NO-HIT: streams through with calibration (enforce judges every request)', async () => {
    const sink = new CalibrationSink()
    const listener = new PreflightListener(makeDeps(sink, {
      mode: 'enforce',
      resolveModelInfo: async () => WINDOWED_MODEL_INFO,
    }))
    const chunks = [USAGE, FINISH_OK]
    const { consumed, innerStarted } = await runStream(listener, loopOptions(), chunks)
    expect(consumed).toEqual(chunks)
    expect(innerStarted).toBe(true)
    expect(sink.records[0]?.hit).toBe(false)
    expect(sink.records[0]?.outcome).toBe('completed')
  })

  it('purpose-stamped one-shots NEVER short-circuit (the compaction recovery chain calls itself through ctx.llm.stream — a hit here would deadlock recovery)', async () => {
    const sink = new CalibrationSink()
    const listener = new PreflightListener(makeDeps(sink, {
      mode: 'enforce',
      resolveModelInfo: async () => WINDOWED_MODEL_INFO,
    }))
    for (const purpose of ['compaction', 'session-title']) {
      const { consumed, innerStarted } = await runStream(
        listener,
        loopOptions({ purpose, messages: [bigTextMessage(170000)] }),
        [FINISH_OK],
      )
      expect(consumed).toEqual([FINISH_OK])
      expect(innerStarted).toBe(true)
    }
    expect(sink.records).toHaveLength(0) // not main-chain: no estimate, no record
  })

  it('a fault in the estimator releases the request (warn-once) — the stream never breaks', async () => {
    const sink = new CalibrationSink()
    const warns: string[] = []
    const listener = new PreflightListener(makeDeps(sink, {
      mode: 'enforce',
      resolveModelInfo: async () => WINDOWED_MODEL_INFO,
      storeFor: () => {
        throw new Error('store exploded')
      },
      logger: { warn: (m: string) => warns.push(m) },
    }))
    const { consumed, innerStarted } = await runStream(listener, loopOptions(), [FINISH_OK])
    expect(consumed).toEqual([FINISH_OK])
    expect(innerStarted).toBe(true)
    expect(sink.records).toHaveLength(0)
    expect(warns).toHaveLength(1) // warn-once, not per request
    expect(warns[0]).toContain('preflight estimation failed')
    await runStream(listener, loopOptions(), [FINISH_OK])
    expect(warns).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// Calibration lifecycle + projection honesty.
// ---------------------------------------------------------------------------

describe('preflight calibration lifecycle', () => {
  it('streams without a usage chunk record outcome no-usage; error/abort outcomes rethrow honestly', async () => {
    const sink = new CalibrationSink()
    const listener = new PreflightListener(makeDeps(sink, { resolveModelInfo: async () => WINDOWED_MODEL_INFO }))
    await runStream(listener, loopOptions(), [FINISH_OK])
    expect(sink.records[0]?.outcome).toBe('no-usage')
    expect(sink.records[0]?.usage).toBeUndefined()

    const errorSink = new CalibrationSink()
    const errorListener = new PreflightListener(makeDeps(errorSink, { resolveModelInfo: async () => WINDOWED_MODEL_INFO }))
    const throwing = async function* () {
      yield USAGE
      throw new Error('wire blew up')
    }
    const out = errorListener.onStream(loopOptions({ signal: { aborted: true } }), () => throwing())
    await expect(async () => {
      for await (const _chunk of out) { /* consumed until the throw */ }
    }).rejects.toThrow('wire blew up')
    expect(errorSink.records[0]?.outcome).toBe('aborted') // signal-derived
    expect(errorSink.records[0]?.usage?.inputTokens).toBe(100)
  })

  it('files project through the injected official fileRequestText when available (two-path honesty)', async () => {
    const sink = new CalibrationSink()
    const fileBlock = { type: 'file', attachment: { name: 'doc.txt', bytes: 3000, attachmentId: 'f1' } }
    const withoutHelper = new PreflightListener(makeDeps(sink, { resolveModelInfo: async () => WINDOWED_MODEL_INFO }))
    await runStream(withoutHelper, loopOptions({ messages: [{ role: 'user', content: [fileBlock] }] }), [FINISH_OK])
    const fallbackEstimate = sink.records[0]?.estimate ?? 0

    const sink2 = new CalibrationSink()
    let resolverRefs = 0
    const withHelper = new PreflightListener(makeDeps(sink2, {
      resolveModelInfo: async () => WINDOWED_MODEL_INFO,
      fileRequestText: (ref: unknown) => {
        resolverRefs += 1
        return `resolved:${JSON.stringify(ref)}`
      },
    }))
    await runStream(withHelper, loopOptions({ messages: [{ role: 'user', content: [fileBlock] }] }), [FINISH_OK])
    expect(resolverRefs).toBe(1)
    const officialEstimate = sink2.records[0]?.estimate ?? 0
    // The resolved handle text is longer than the fallback's short placeholder
    // for a 3000-byte file → the official-path estimate is strictly larger.
    expect(officialEstimate).toBeGreaterThan(fallbackEstimate)
    // Both records carry the projector label of the face that ran (same
    // loadHostProjector face as the V2 listener; no host lib here).
    expect(sink2.records[0]?.projector).toBe('local-fallback')
  })

  it('image-less KNOWN models project images away (placeholder text cost, pricing not exercised)', async () => {
    const sink = new CalibrationSink()
    const image = { type: 'image', attachment: { attachmentId: 'a9' } }
    const listener = new PreflightListener(makeDeps(sink, {
      resolveModelInfo: async () => ({ ...WINDOWED_MODEL_INFO, inputModalities: ['text'] }),
      imageRequestPricing: () => ({ priceImages: () => [{ visualTokens: 9999, text: '[x]' }] }),
    }))
    await runStream(listener, loopOptions({ messages: [{ role: 'user', content: [image] }] }), [FINISH_OK])
    const record = sink.records[0] as PreflightCalibrationRecord
    expect(record.imagePricing).toBe('not-exercised') // projected away → no pricing decision
    expect(record.imageCount).toBe(0) // kept-count: nothing stayed on the wire
    // The placeholder text is short → far below the constant reserve.
    expect(record.estimate).toBeLessThan(PER_IMAGE_FALLBACK_TOKENS)
  })

  it('image-capable KNOWN models keep images and price them through the injected face', async () => {
    const sink = new CalibrationSink()
    const image = { type: 'image', attachment: { attachmentId: 'a9' } }
    const listener = new PreflightListener(makeDeps(sink, {
      resolveModelInfo: async () => ({ ...WINDOWED_MODEL_INFO, inputModalities: ['text', 'image'] }),
      imageRequestPricing: () => ({ priceImages: () => [{ visualTokens: 700, text: '[img]' }] }),
    }))
    await runStream(listener, loopOptions({ messages: [{ role: 'user', content: [image] }] }), [FINISH_OK])
    const record = sink.records[0] as PreflightCalibrationRecord
    expect(record.imagePricing).toBe('adapter')
    expect(record.estimate).toBe(700 + 2) // visualTokens + ceil('[img]'/3 = 2)
  })

  it('model-info resolution is memoized per route and bounded (V2-C design)', async () => {
    const sink = new CalibrationSink()
    const resolveModelInfo = vi.fn(async () => WINDOWED_MODEL_INFO)
    const listener = new PreflightListener(makeDeps(sink, { resolveModelInfo }))
    await runStream(listener, loopOptions(), [FINISH_OK])
    await runStream(listener, loopOptions(), [FINISH_OK])
    expect(resolveModelInfo).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// Discipline pins.
// ---------------------------------------------------------------------------

describe('preflight discipline pins', () => {
  it('zero-mutation pin (reuse): frozen options stay byte-identical across observe and enforce firings', async () => {
    const textBlock = { type: 'text', text: 'hello' }
    const tools = [{ name: 't', description: 'd', parameters: {} }]
    const fileBlock = { type: 'file', attachment: { name: 'f.txt', bytes: 12, attachmentId: 'fx' } }
    const options = loopOptions({
      messages: [{ role: 'user', content: [textBlock, fileBlock] }],
      tools,
      system: 'sys',
    })
    const freezeDeep = (value: unknown): void => {
      if (value !== null && typeof value === 'object') {
        for (const child of Object.values(value as Record<string, unknown>)) freezeDeep(child)
        Object.freeze(value)
      }
    }
    freezeDeep(options)
    const before = structuredClone(options)

    const observeSink = new CalibrationSink()
    const observe = new PreflightListener(makeDeps(observeSink, { resolveModelInfo: async () => WINDOWED_MODEL_INFO }))
    await runStream(observe, options, [USAGE, FINISH_OK])
    expect(observeSink.records).toHaveLength(1)

    const enforceSink = new CalibrationSink()
    const enforce = new PreflightListener(makeDeps(enforceSink, {
      mode: 'enforce',
      resolveModelInfo: async () => WINDOWED_MODEL_INFO,
    }))
    await runStream(enforce, options, [USAGE, FINISH_OK])

    expect(options).toEqual(before)
    expect(Object.isFrozen(options)).toBe(true)
    expect(Object.isFrozen(options.messages)).toBe(true)
    expect((options.messages as unknown[])[0]).not.toBe(fileBlock)
    expect(((options.messages as unknown[])[0] as { content: unknown[] }).content[1]).toBe(fileBlock) // identity, not a copy
  })

  it('R3 structural pin: the deps surface carries no llm runtime (ctx.llm.stream is unreachable), and only the narrow helpers are invoked', async () => {
    const sink = new CalibrationSink()
    const resolveModelInfo = vi.fn(async () => WINDOWED_MODEL_INFO)
    const fileRequestText = vi.fn(() => 'handle')
    const imageRequestPricing = vi.fn(() => undefined)
    const deps = makeDeps(sink, { resolveModelInfo, fileRequestText, imageRequestPricing })
    // The deps object ITSELF is the pin: no member reaches a stream or the llm
    // runtime — the R3 self-call is structurally unreachable, not just banned.
    const keys = Object.keys(deps)
    expect(keys.some((key) => key.toLowerCase().includes('stream') || key.toLowerCase().includes('llm'))).toBe(false)
    expect(keys.sort()).toEqual([
      'fileRequestText',
      'imageRequestPricing',
      'marginRatio',
      'mode',
      'resolveModelInfo',
      'resolveSession',
      'storeFor',
    ])
    const listener = new PreflightListener(deps)
    await runStream(listener, loopOptions(), [FINISH_OK])
    expect(resolveModelInfo).toHaveBeenCalledTimes(1)
    expect(fileRequestText).not.toHaveBeenCalled() // no file blocks → resolver untouched
    expect(imageRequestPricing).toHaveBeenCalledTimes(1) // probed per request (absent pricing → constant reserve path)
  })

  it('main-chain criteria reuse: the listener matches exactly where the V2 observe listener snapshots (criterion 1-3 parity)', async () => {
    const sink = new CalibrationSink()
    const listener = new PreflightListener(makeDeps(sink))
    // Criterion 1: non-loop requests pass unjudged.
    await runStream(listener, { provider: 'p', model: 'm', messages: [{ role: 'user' }] }, [FINISH_OK])
    // Criterion 2: purpose-stamped one-shots pass unjudged.
    await runStream(listener, loopOptions({ purpose: 'compaction' }), [FINISH_OK])
    // Criterion 3: unwatched sessions pass unjudged.
    await runStream(listener, loopOptions({ sessionId: 'ghost' }), [FINISH_OK])
    expect(sink.records).toHaveLength(0)
    // The main-chain request is judged (post-reset requests too — no
    // exemption window in the preflight: every main-chain request is judged).
    await runStream(listener, loopOptions(), [FINISH_OK])
    expect(sink.records).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// Store port + status statistics.
// ---------------------------------------------------------------------------

describe('store calibration port + estimator error statistics (zctx_status segment 5)', () => {
  it('the store absorbs the records bounded at 64 (oldest dropped) and returns copies', () => {
    const store = new FoldStore()
    for (let i = 0; i < 66; i += 1) {
      store.absorbPreflightCalibration({
        sessionId: 's',
        mode: 'observe',
        provider: 'p',
        model: 'm',
        estimate: i,
        marginRatio: 0.9,
        projector: 'official',
        imagePricing: 'not-exercised',
        imageCount: 0,
        hit: false,
        outcome: 'no-usage',
        time: i,
      })
    }
    const records = store.preflightCalibrations()
    expect(records).toHaveLength(64)
    expect(records[0]?.estimate).toBe(2) // oldest two dropped
    expect(records[63]?.estimate).toBe(65)
  })

  it('preflightCalibrationStats: comparable samples against the DISJOINT billed input; short-circuits counted; basis honest', () => {
    const mk = (overrides: Partial<PreflightCalibrationRecord>): PreflightCalibrationRecord => ({
      sessionId: 's',
      mode: 'observe',
      provider: 'p',
      model: 'm',
      estimate: 110,
      marginRatio: 0.9,
      projector: 'official',
      imagePricing: 'not-exercised',
      imageCount: 0,
      hit: false,
      outcome: 'completed',
      usage: { inputTokens: 100, outputTokens: 5, cacheReadTokens: 20, cacheWriteTokens: 0 },
      time: 1,
      ...overrides,
    })
    // estimate 110 vs billed 120 → error −8.33%; estimate 121 vs 110 → +10%.
    // V4-1 closure: the local-fallback row is EXCLUDED from the math (its
    // estimate measures a non-official projection, not the wire surface) and
    // counted in the basis line instead of being mixed into the distribution.
    const stats = preflightCalibrationStats([
      mk({}),
      mk({ estimate: 121, usage: { inputTokens: 110, outputTokens: 1 } }),
      mk({ outcome: 'no-usage', usage: undefined }), // settled without a usable usage chunk
      mk({ outcome: 'short-circuited', hit: true }), // counted, not comparable
      mk({ projector: 'local-fallback' }), // excluded as uncalibrated; basis marker
    ])
    expect(stats.comparable).toBe(2)
    expect(stats.shortCircuits).toBe(1)
    expect(stats.meanErrorPct).toBeCloseTo((-100 / 12 + 10) / 2, 5)
    expect(stats.worstErrorPct).toBeCloseTo(10, 5) // |+10| > |−8.33|
    expect(stats.basis).toContain('local-fallback')
    expect(stats.basis).toContain('excluded 1')
  })

  it('zctx_status renders the preflight segment: mode, stats, and honest empty shapes', async () => {
    // A minimal store-bound session (the segment only reads the store).
    const minimalSession = { seq: 0, surface: { nodes: [] }, eventAt: () => undefined }
    const store = new FoldStore()
    store.attach(minimalSession as Parameters<typeof renderStatus>[1])
    const runtime = {
      cleanSampleFloor: 0.6,
      preflightMode: 'observe' as const,
      storeFor: () => store,
      validatorConfig: () => ({
        keepRecentMessages: 0,
        keepRecentTokens: 0,
        protectionFloorTokens: 0,
        minFoldableTokens: 5,
        maxFoldFraction: 0.6,
        summaryFloorChars: 10,
        summaryCeilingChars: 20000,
        netShrinkTolerance: 1.05,
      }),
    }
    const empty = await renderStatus(runtime, minimalSession as Parameters<typeof renderStatus>[1])
    expect(empty).toContain('Preflight estimator (S1, mode observe):')
    expect(empty).toContain('no judged requests yet')

    // estimate 120 vs billed 100 → +20%.
    store.absorbPreflightCalibration({
      sessionId: 's',
      mode: 'observe',
      provider: 'p',
      model: 'm',
      estimate: 120,
      marginRatio: 0.9,
      projector: 'official',
      imagePricing: 'not-exercised',
      imageCount: 0,
      hit: false,
      outcome: 'completed',
      usage: { inputTokens: 100, outputTokens: 5 },
      time: 1,
    })
    const populated = await renderStatus(runtime, minimalSession as Parameters<typeof renderStatus>[1])
    expect(populated).toContain('calibration: 1 comparable request, mean error 20.0% / worst 20.0%')
    expect(populated).toContain('estimate basis: official')

    const enforce = await renderStatus({ ...runtime, preflightMode: 'enforce' }, minimalSession as Parameters<typeof renderStatus>[1])
    expect(enforce).toContain('mode enforce')
  })
})

// ---------------------------------------------------------------------------
// Official projector path (V4-2 closure — R4: the official-projector estimate
// path previously had no execution pin; this describe re-runs the listener
// through the OFFICIAL projection exports with the observe.spec official-path
// convention: host build on disk, honest skip when absent).
// ---------------------------------------------------------------------------

describe('preflight listener: official projector path (host build on disk)', () => {
  it('calibration record carries projector=official and an estimate over the OFFICIAL file projection', async () => {
    const hostLib = 'G:/000Github/zDSH/zDSH-main/packages/llm/llm/lib/index.js'
    if (!existsSyncAny(hostLib)) {
      delete process.env.ZCTX_DSH_LLM
      resetHostProjectorCacheForTest()
      return // honest skip: no host build on this machine (probe convention)
    }
    process.env.ZCTX_DSH_LLM = pathToFileURLAny(hostLib)
    resetHostProjectorCacheForTest()
    const host = (await import(pathToFileURLAny(hostLib))) as {
      markAgentLoopRequest: <T>(request: T) => T
    }
    const sink = new CalibrationSink()
    const listener = new PreflightListener(makeDeps(sink, {
      resolveModelInfo: async () => WINDOWED_MODEL_INFO,
    }))
    // A file block: the official projection and the fallback twin render
    // DIFFERENT deterministic handle text for it, so the estimates diverge.
    const fileOptions = host.markAgentLoopRequest(loopOptions({
      messages: [{ role: 'user', content: [{ type: 'file', attachment: { attachmentId: 'att-1', name: 'a.sql', bytes: 64 } }] }],
    }) as never)
    const { consumed } = await runStream(listener, fileOptions, [FINISH_OK])
    expect(consumed).toEqual([FINISH_OK])
    expect(sink.records).toHaveLength(1)
    const officialRecord = sink.records[0] as PreflightCalibrationRecord
    expect(officialRecord.projector).toBe('official')
    expect(officialRecord.estimate).toBeGreaterThan(0)

    // Same request through the labeled fallback twins (env cleared): the
    // estimate must differ — both paths honest, never silently fused.
    delete process.env.ZCTX_DSH_LLM
    resetHostProjectorCacheForTest()
    const fallbackSink = new CalibrationSink()
    const fallbackListener = new PreflightListener(makeDeps(fallbackSink, {
      resolveModelInfo: async () => WINDOWED_MODEL_INFO,
    }))
    await runStream(fallbackListener, loopOptions({
      messages: [{ role: 'user', content: [{ type: 'file', attachment: { attachmentId: 'att-1', name: 'a.sql', bytes: 64 } }] }],
    }), [FINISH_OK])
    expect(fallbackSink.records[0]?.projector).toBe('local-fallback')
    expect(fallbackSink.records[0]?.estimate).not.toBe(officialRecord.estimate)
  }, 20000)
})

/** Local fs/url helpers (spec-local; mirrors the observe.spec convention). */
function existsSyncAny(pathname: string): boolean {
  try {
    return existsSync(pathname)
  } catch {
    return false
  }
}
function pathToFileURLAny(pathname: string): string {
  return pathToFileURL(pathname).href
}
