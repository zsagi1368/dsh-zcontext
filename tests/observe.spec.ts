/**
 * V2 observe-listener tests (task card product 5): minimal waterfall harness,
 * the four main-chain criteria one by one, the ZERO-MUTATION pin (frozen
 * options deep-compared before/after), hash stability (same input → same
 * hash, key-order independent), the prefix-monotonic mechanical piece
 * (growth/shrink/break + reset-explained vs unknown-break classification),
 * and the optional attemptCapture face (default OFF; abort safety).
 *
 * The waterfall harness mirrors the official listener contract
 * (llm/llm/src/index.ts:78: `(options, next) => AsyncIterable`): the
 * listener MUST call next() and its returned stream is what the host
 * consumes. The harness asserts chunks pass through in order and the
 * inner iterator is properly closed on early return (abort discipline).
 */

import { existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

import { afterAll, describe, expect, it } from 'vitest'

import { detectPrefixBreak, ObserveListener } from '../src/observe.ts'
import type { ObserveStoreAccess } from '../src/observe.ts'
import { resetHostProjectorCacheForTest } from '../src/host-llm.ts'
import type {
  CapturedAttemptUsage,
  PrefixBreakRecord,
  RequestSnapshot,
  ResetEvent,
} from '../src/types.ts'

/** In-memory ObserveStoreAccess fake (the sink contract the store implements in c4). */
class FakeObserveStore implements ObserveStoreAccess {
  readonly resets: ResetEvent[] = []
  readonly snapshots: RequestSnapshot[] = []
  readonly breaks: PrefixBreakRecord[] = []
  readonly captures: CapturedAttemptUsage[] = []

  resetEvents(): readonly ResetEvent[] {
    return this.resets
  }

  lastRequestSnapshot(): RequestSnapshot | undefined {
    return this.snapshots[this.snapshots.length - 1]
  }

  absorbRequestSnapshot(snapshot: RequestSnapshot, breakRecord?: PrefixBreakRecord): void {
    this.snapshots.push(snapshot)
    if (breakRecord !== undefined) this.breaks.push(breakRecord)
  }

  absorbCapturedAttemptUsage(record: CapturedAttemptUsage): void {
    this.captures.push(record)
  }
}

/** Minimal waterfall harness: run one firing, collect the consumed chunks. */
async function runStream(
  listener: ObserveListener,
  options: unknown,
  chunks: readonly unknown[],
): Promise<{ consumed: unknown[]; innerClosed: boolean }> {
  let innerClosed = false
  const inner = async function* () {
    try {
      for (const chunk of chunks) yield chunk
    } finally {
      innerClosed = true
    }
  }
  const consumed: unknown[] = []
  const out = listener.onStream(options, () => inner())
  for await (const chunk of out) consumed.push(chunk)
  return { consumed, innerClosed }
}

/** Consume only the first chunk, then early-return (the abort/stop path). */
async function breakAfterFirst(listener: ObserveListener, options: unknown, chunks: readonly unknown[]): Promise<void> {
  const inner = async function* () {
    for (const chunk of chunks) yield chunk
  }
  const out = listener.onStream(options, () => inner())
  for await (const _chunk of out) break // eslint-disable-line @typescript-eslint/no-unused-vars
}

const SESSION = { id: 'sess-1' }

/** Deps over one fake store + one watched session. */
function makeDeps(store: FakeObserveStore, attemptCapture = false) {
  return {
    resolveSession: (sessionId: string): unknown => (sessionId === 'sess-1' ? SESSION : undefined),
    storeFor: (session: unknown): ObserveStoreAccess | undefined =>
      session === SESSION ? store : undefined,
    attemptCapture,
  }
}

/** A main-chain-shaped request options object (criterion-1 heuristic passes). */
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
const FINISH_ERROR = { type: 'finish', reason: { kind: 'error', failure: { message: 'boom' } } }
const USAGE = { type: 'usage', usage: { inputTokens: 11, outputTokens: 3, cacheReadTokens: 90 } }

afterAll(() => {
  delete process.env.ZCTX_DSH_LLM
  resetHostProjectorCacheForTest()
})

describe('observe listener: waterfall pass-through (minimal harness)', () => {
  it('passes chunks through untouched and closes the inner stream', async () => {
    const store = new FakeObserveStore()
    const listener = new ObserveListener(makeDeps(store))
    const chunks = [{ type: 'text-delta', index: 0, text: 'hi' }, FINISH_OK]
    const { consumed, innerClosed } = await runStream(listener, loopOptions(), chunks)
    expect(consumed).toEqual(chunks)
    expect(innerClosed).toBe(true)
  })
})

describe('observe listener: the four main-chain criteria, one by one', () => {
  it('criterion 1: non-loop requests stream through with no snapshot', async () => {
    const store = new FakeObserveStore()
    const listener = new ObserveListener(makeDeps(store))
    // A one-shot-shaped hand-built request: no sessionId → the loop identity
    // check (both official WeakSet and the fallback heuristic) rejects it.
    const options = { provider: 'deepseek', model: 'm', messages: [{ role: 'user' }] }
    const { consumed } = await runStream(listener, options, [FINISH_OK])
    expect(consumed).toHaveLength(1)
    expect(store.snapshots).toHaveLength(0)
  })

  it('criterion 2: purpose-stamped one-shots never snapshot', async () => {
    const store = new FakeObserveStore()
    const listener = new ObserveListener(makeDeps(store))
    for (const purpose of ['compaction', 'session-title']) {
      const { consumed } = await runStream(listener, loopOptions({ purpose }), [FINISH_OK])
      expect(consumed).toHaveLength(1)
    }
    expect(store.snapshots).toHaveLength(0)
  })

  it('criterion 3: foreign/unwatched session ids never snapshot', async () => {
    const store = new FakeObserveStore()
    const listener = new ObserveListener(makeDeps(store))
    const { consumed } = await runStream(listener, loopOptions({ sessionId: 'subagent-9' }), [FINISH_OK])
    expect(consumed).toHaveLength(1)
    expect(store.snapshots).toHaveLength(0)
  })

  it('criterion 3: watched but store-less sessions never snapshot', async () => {
    const listener = new ObserveListener({
      resolveSession: (sessionId) => ({ id: sessionId }),
      storeFor: () => undefined,
      attemptCapture: false,
    })
    const { consumed } = await runStream(listener, loopOptions(), [FINISH_OK])
    expect(consumed).toHaveLength(1)
  })

  it('criterion 4: the first main-chain request after a reset is exempt (no snapshot)', async () => {
    const store = new FakeObserveStore()
    store.resets.push({ kind: 'merge-rewrite', seq: 7, evidence: 'fold replace' })
    const listener = new ObserveListener(makeDeps(store))
    await runStream(listener, loopOptions(), [FINISH_OK]) // exempt
    expect(store.snapshots).toHaveLength(0)
    const second = loopOptions({ messages: [{ role: 'user', content: [{ type: 'text', text: 'two' }] }] })
    await runStream(listener, second, [FINISH_OK]) // no longer exempt
    expect(store.snapshots).toHaveLength(1)
    expect(store.snapshots[0]?.attemptSeq).toBe(1)
  })

  it('happy path: all four criteria pass → snapshot absorbed (fallback projector labeled)', async () => {
    delete process.env.ZCTX_DSH_LLM
    resetHostProjectorCacheForTest()
    const store = new FakeObserveStore()
    const listener = new ObserveListener(makeDeps(store))
    await runStream(listener, loopOptions(), [FINISH_OK])
    expect(store.snapshots).toHaveLength(1)
    const snapshot = store.snapshots[0] as RequestSnapshot
    expect(snapshot.sessionId).toBe('sess-1')
    expect(snapshot.attemptSeq).toBe(1)
    expect(snapshot.provider).toBe('deepseek')
    expect(snapshot.model).toBe('deepseek-chat')
    expect(snapshot.perMessageHashes).toHaveLength(1)
    expect(snapshot.isLoop).toBe(true)
    expect(snapshot.purpose).toBeUndefined()
    expect(snapshot.projector).toBe('local-fallback')
    expect(snapshot.systemHash).toBeUndefined()
  })
})

describe('observe listener: read-only discipline (zero-mutation pin)', () => {
  it('deep-frozen options stay byte-identical across a full firing', async () => {
    const store = new FakeObserveStore()
    const listener = new ObserveListener(makeDeps(store, true))
    const messages = [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }]
    const tools = [{ name: 't', description: 'd', parameters: {} }]
    const options = loopOptions({ messages, tools, system: 'sys prompt' })
    deepFreeze(options)
    const before = structuredClone(options)
    expect(Object.isFrozen(options)).toBe(true)

    const chunks = [USAGE, FINISH_ERROR]
    const { consumed } = await runStream(listener, options, chunks)
    expect(consumed).toEqual(chunks)

    // Deep comparison before/after: nothing inside the frozen tree changed.
    expect(options).toEqual(before)
    expect(Object.isFrozen(options)).toBe(true)
    expect(Object.isFrozen(options.messages)).toBe(true)
    // The request reference itself was not swapped: the caller's object is
    // still the one the listener received (mutation AND identity pin).
    expect(options.messages).toBe(messages)
    expect(options.tools).toBe(tools)
    // The failed attempt was captured while the request stayed untouched.
    expect(store.captures).toHaveLength(1)
    expect(store.snapshots).toHaveLength(1)
  })
})

describe('observe listener: hash stability', () => {
  it('same content in different key order → identical per-message hashes', async () => {
    const store = new FakeObserveStore()
    const listener = new ObserveListener(makeDeps(store))
    await runStream(listener, loopOptions({
      messages: [{ content: [{ text: 'hello', type: 'text' }], role: 'user' }],
    }), [FINISH_OK])
    await runStream(listener, loopOptions({
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
    }), [FINISH_OK])
    expect(store.snapshots).toHaveLength(2)
    expect(store.snapshots[0]?.perMessageHashes).toEqual(store.snapshots[1]?.perMessageHashes)
    // Different content → different hash.
    await runStream(listener, loopOptions({
      messages: [{ role: 'user', content: [{ type: 'text', text: 'different' }] }],
    }), [FINISH_OK])
    expect(store.snapshots[2]?.perMessageHashes[0]).not.toBe(store.snapshots[1]?.perMessageHashes[0])
  })

  it('systemHash/toolsHash are stable and present only when the fields exist', async () => {
    const store = new FakeObserveStore()
    const listener = new ObserveListener(makeDeps(store))
    await runStream(listener, loopOptions({ system: 'sys', tools: [{ name: 't', description: 'd', parameters: {} }] }), [FINISH_OK])
    await runStream(listener, loopOptions({ tools: [{ description: 'd', name: 't', parameters: {} }], system: 'sys' }), [FINISH_OK])
    expect(store.snapshots[0]?.systemHash).toBe(store.snapshots[1]?.systemHash)
    expect(store.snapshots[0]?.toolsHash).toBe(store.snapshots[1]?.toolsHash)
    expect(store.snapshots[0]?.systemHash).not.toBeUndefined()
    expect(store.snapshots[0]?.toolsHash).not.toBeUndefined()
  })
})

describe('prefix-monotonic mechanical piece', () => {
  it('pure function: no baseline → no record; growth → no break; shrink/change → classified break', () => {
    const base: RequestSnapshot = {
      sessionId: 's',
      attemptSeq: 1,
      provider: 'p',
      model: 'm',
      perMessageHashes: ['a', 'b', 'c'],
      isLoop: true,
      projector: 'local-fallback',
      time: 1,
    }
    expect(detectPrefixBreak(undefined, base, undefined)).toBeUndefined()
    const grown: RequestSnapshot = { ...base, perMessageHashes: ['a', 'b', 'c', 'd'], attemptSeq: 2 }
    expect(detectPrefixBreak(base, grown, undefined)).toBeUndefined()
    const shrunk: RequestSnapshot = { ...base, perMessageHashes: ['a'], attemptSeq: 2 }
    const shrinkRecord = detectPrefixBreak(base, shrunk, undefined)
    expect(shrinkRecord).toMatchObject({
      domain: 'harness',
      mode: 'length-shrink',
      classification: 'unknown-break',
      attemptSeq: 2,
      prevAttemptSeq: 1,
    })
    expect(shrinkRecord?.breakIndex).toBeUndefined() // pure tail shrink
    const changed: RequestSnapshot = { ...base, perMessageHashes: ['a', 'X', 'c'], attemptSeq: 3 }
    const changeRecord = detectPrefixBreak(base, changed, [{ kind: 'model-change', seq: 9 }])
    expect(changeRecord).toMatchObject({
      mode: 'content-change',
      breakIndex: 1,
      classification: 'reset-explained',
      explainedBy: [{ kind: 'model-change', seq: 9 }],
    })
    // Identical prefix despite an intervening reset → no break (resets do not
    // invent breaks; only hash divergence does).
    const same: RequestSnapshot = { ...base, perMessageHashes: ['a', 'b', 'c'], attemptSeq: 4 }
    expect(detectPrefixBreak(base, same, [{ kind: 'sampling-change', seq: 10 }])).toBeUndefined()
  })

  it('listener: fold-shaped sequence produces a reset-explained length-shrink after the exempt window', async () => {
    const store = new FakeObserveStore()
    const listener = new ObserveListener(makeDeps(store))
    const msg = (text: string) => [{ role: 'user', content: [{ type: 'text', text }] }]
    // Baseline.
    await runStream(listener, loopOptions({ messages: [...msg('u1'), ...msg('u2'), ...msg('u3')] }), [FINISH_OK])
    expect(store.breaks).toHaveLength(0)
    // Fold commit lands in the session log → reset entry; the first post-fold
    // main-chain request is exempt; the second is snapshotted against the
    // pre-fold baseline → break explained by the reset.
    store.resets.push({ kind: 'merge-rewrite', seq: 12, evidence: 'fold checkpoint replace' })
    await runStream(listener, loopOptions({ messages: [...msg('u1'), ...msg('u2'), ...msg('u3')] }), [FINISH_OK]) // exempt
    expect(store.snapshots).toHaveLength(1)
    await runStream(listener, loopOptions({ messages: [...msg('u1'), { role: 'user', content: [{ type: 'text', text: 'checkpoint' }] }] }), [FINISH_OK])
    expect(store.snapshots).toHaveLength(2)
    expect(store.snapshots[1]?.attemptSeq).toBe(2)
    expect(store.breaks).toHaveLength(1)
    expect(store.breaks[0]).toMatchObject({
      domain: 'harness',
      mode: 'length-shrink',
      classification: 'reset-explained',
      attemptSeq: 2,
      prevAttemptSeq: 1,
      explainedBy: [{ kind: 'merge-rewrite', seq: 12 }],
    })
    expect(store.breaks[0]?.breakIndex).toBe(1) // position 1: folded-away u2 vs the checkpoint message
    // Post-fold steady walk: no new breaks.
    await runStream(listener, loopOptions({ messages: [...msg('u1'), { role: 'user', content: [{ type: 'text', text: 'checkpoint' }] }, ...msg('u4')] }), [FINISH_OK])
    expect(store.breaks).toHaveLength(1)
  })

  it('listener: object churn with no reset → unknown-break content-change', async () => {
    const store = new FakeObserveStore()
    const listener = new ObserveListener(makeDeps(store))
    const msg = (text: string) => [{ role: 'user', content: [{ type: 'text', text }] }]
    await runStream(listener, loopOptions({ messages: [...msg('u1')] }), [FINISH_OK])
    await runStream(listener, loopOptions({ messages: [...msg('u1-rewritten')] }), [FINISH_OK])
    expect(store.breaks).toHaveLength(1)
    expect(store.breaks[0]).toMatchObject({
      mode: 'content-change',
      breakIndex: 0,
      classification: 'unknown-break',
    })
    expect(store.breaks[0]?.explainedBy).toBeUndefined()
  })
})

describe('observe listener: attemptCapture face', () => {
  it('default OFF: failed attempts leave no capture even with a usage chunk', async () => {
    const store = new FakeObserveStore()
    const listener = new ObserveListener(makeDeps(store, false))
    await runStream(listener, loopOptions(), [USAGE, FINISH_ERROR])
    expect(store.captures).toHaveLength(0)
    expect(store.snapshots).toHaveLength(1)
  })

  it('ON: failed attempt (finish error) captures the observed usage non-durably', async () => {
    const store = new FakeObserveStore()
    const listener = new ObserveListener(makeDeps(store, true))
    const { consumed } = await runStream(listener, loopOptions(), [USAGE, FINISH_ERROR])
    expect(consumed).toEqual([USAGE, FINISH_ERROR]) // pass-through unchanged
    expect(store.captures).toHaveLength(1)
    expect(store.captures[0]).toMatchObject({
      sessionId: 'sess-1',
      attemptSeq: 1,
      provider: 'deepseek',
      model: 'deepseek-chat',
      usage: { inputTokens: 11, outputTokens: 3, cacheReadTokens: 90 },
      outcome: 'error',
      nonDurable: true,
    })
  })

  it('ON: successful attempts are never captured', async () => {
    const store = new FakeObserveStore()
    const listener = new ObserveListener(makeDeps(store, true))
    await runStream(listener, loopOptions(), [USAGE, FINISH_OK])
    expect(store.captures).toHaveLength(0)
  })

  it('ON: a thrown stream records the capture with the signal-derived outcome and RETHROWS', async () => {
    const store = new FakeObserveStore()
    const listener = new ObserveListener(makeDeps(store, true))
    const inner = async function* () {
      yield USAGE
      throw new Error('stream blew up')
    }
    const out = listener.onStream(loopOptions({ signal: { aborted: true } }), () => inner())
    await expect(async () => {
      for await (const _chunk of out) { /* consumed until the throw */ }
    }).rejects.toThrow('stream blew up')
    expect(store.captures).toHaveLength(1)
    expect(store.captures[0]?.outcome).toBe('aborted') // signal.aborted observed
    expect(store.captures[0]?.usage.inputTokens).toBe(11)
  })

  it('ON: exempt-window requests capture with attemptSeq 0', async () => {
    const store = new FakeObserveStore()
    store.resets.push({ kind: 'compaction', seq: 3, evidence: 'official bracket' })
    const listener = new ObserveListener(makeDeps(store, true))
    await runStream(listener, loopOptions(), [USAGE, FINISH_ERROR]) // exempt + capture
    expect(store.snapshots).toHaveLength(0)
    expect(store.captures).toHaveLength(1)
    expect(store.captures[0]?.attemptSeq).toBe(0)
  })

  it('ON: consumer early-return closes the inner stream (abort discipline)', async () => {
    const store = new FakeObserveStore()
    const listener = new ObserveListener(makeDeps(store, true))
    await breakAfterFirst(listener, loopOptions(), [USAGE, FINISH_OK])
    // No throw, no capture (the attempt did not fail observably); the early
    // return propagated into the inner iterator through the pass-through.
    expect(store.captures).toHaveLength(0)
  })

  it('sink faults never break the stream (fail-soft, warn-once)', async () => {
    const warns: string[] = []
    const store = new FakeObserveStore()
    store.absorbRequestSnapshot = () => {
      throw new Error('sink exploded')
    }
    const listener = new ObserveListener({ ...makeDeps(store), logger: { warn: (m) => warns.push(m) } })
    const { consumed } = await runStream(listener, loopOptions(), [FINISH_OK])
    expect(consumed).toEqual([FINISH_OK])
    expect(warns).toHaveLength(1)
    expect(warns[0]).toContain('observe sink failed')
  })
})

describe('observe listener: official projector path (host build on disk)', () => {
  it('snapshots carry projector=official and official WeakSet identity applies', async () => {
    const hostLib = 'G:/000Github/zDSH/zDSH-main/packages/llm/llm/lib/index.js'
    if (!existsSyncAny(hostLib)) {
      delete process.env.ZCTX_DSH_LLM
      resetHostProjectorCacheForTest()
      return // honest skip: no host build on this machine (probe convention)
    }
    process.env.ZCTX_DSH_LLM = pathToFileURLAny(hostLib)
    resetHostProjectorCacheForTest()
    const store = new FakeObserveStore()
    const listener = new ObserveListener(makeDeps(store))
    // Fallback heuristic would accept this shape; the official WeakSet does
    // not (unmarked) → no snapshot at all.
    await runStream(listener, loopOptions(), [FINISH_OK])
    expect(store.snapshots).toHaveLength(0)
    // Marked through the host's own export → snapshot with the official label.
    const host = (await import(pathToFileURLAny(hostLib))) as {
      markAgentLoopRequest: <T>(request: T) => T
    }
    const marked = host.markAgentLoopRequest(loopOptions() as never)
    await runStream(listener, marked, [FINISH_OK])
    expect(store.snapshots).toHaveLength(1)
    expect(store.snapshots[0]?.projector).toBe('official')
  }, 20000)

  // V2-D closure (R3 review): the zero-mutation pin previously ran only on
  // the fallback projector path — this pin re-runs the SAME byte-identity +
  // reference-identity discipline through the OFFICIAL projection exports
  // (host build on disk, honest skip when absent — same probe convention).
  it('deep-frozen options stay byte-identical across a firing on the OFFICIAL projector path', async () => {
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
    const store = new FakeObserveStore()
    const listener = new ObserveListener(makeDeps(store, true))
    // Exercise every projection face: text + file + image blocks, a
    // deferLoading tool, and a system prompt (one-shot field stays unused on
    // the loop chain but is hashed when present).
    const messages = [
      { role: 'user', content: [{ type: 'text', text: 'hello' }] },
      { role: 'user', content: [{ type: 'file', attachment: { attachmentId: 'att-1', name: 'a.sql', bytes: 10 } }] },
      { role: 'user', content: [{ type: 'image', attachment: { attachmentId: 'att-2', name: 'pic.png', bytes: 20 } }] },
    ]
    const tools = [{ name: 't', description: 'd', parameters: {}, deferLoading: true }]
    const options = deepFreeze(loopOptions({ messages, tools, system: 'sys prompt' }))
    const before = structuredClone(options)
    expect(Object.isFrozen(options)).toBe(true)
    const marked = host.markAgentLoopRequest(options as never)
    const chunks = [USAGE, FINISH_ERROR]
    const { consumed } = await runStream(listener, marked, chunks)
    expect(consumed).toEqual(chunks)
    // The snapshot came from the OFFICIAL projector…
    expect(store.snapshots).toHaveLength(1)
    expect(store.snapshots[0]?.projector).toBe('official')
    // …while the frozen request tree stayed byte-identical and the caller's
    // references were never swapped (mutation AND identity pin).
    expect(options).toEqual(before)
    expect(Object.isFrozen(options.messages)).toBe(true)
    expect(options.messages).toBe(messages)
    expect(options.tools).toBe(tools)
    // The failed attempt was captured while the request stayed untouched.
    expect(store.captures).toHaveLength(1)
  }, 20000)
})

/** Local fs/url helpers (spec-local; keeps the vitest import surface minimal). */
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

/** Deep-freeze helper mirroring the harness's request freeze (util/values semantics). */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const inner of Object.values(value as Record<string, unknown>)) deepFreeze(inner)
  }
  return value
}
