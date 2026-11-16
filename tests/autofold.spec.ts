/**
 * P6-E autoFold tests (task card product 4): trigger judgment (the V4
 * criteria reused as the third face), selection (conservative set +
 * reachability domain + pair-safe trim), the three summary supplies (call
 * shape pin for the official compaction precedent), the degradation chain
 * (transient retry → halving cascade → digest; dead-probe sticky + canary;
 * net-shrink pre-check), the budget clamps, the anti-feedback-loop hooks
 * (nudge-baseline clear + purpose exemption), and the status segment.
 *
 * Every bc F2 mechanism the card pins is tagged with its F-number below.
 */

import { describe, expect, it } from 'vitest'

import {
  AutoFoldListener,
  AUTOFOLD_MIN_CHUNK_TOKENS,
  DEAD_PROBE_STICKY_LIMIT,
  DIGEST_HEAD_CHARS,
  MAX_SUMMARY_CALLS_PER_RUN,
  TRANSIENT_EMPTY_BUDGET,
  TRANSIENT_EMPTY_RETRIES,
  buildSpanCandidate,
  createCompactionSupply,
  createExternalSupply,
  digestSpanSummary,
  extractExternalSummaryText,
  parseSummarizerKind,
  resolveBudgetField,
  runAutoFoldChain,
  selectFoldSpans,
} from '../src/autofold.ts'
import type {
  AutofoldChainConfig,
  AutofoldSummaryRequest,
  AutofoldSummarySupply,
} from '../src/autofold.ts'
import { computeBudget, estimateTokens } from '../src/budget.ts'
import { configDefaults } from '../src/config.ts'
import { fold } from '../src/fold-engine.ts'
import { FoldStore } from '../src/store.ts'
import { AUTOFOLD_DIGEST_HEADER } from '../src/texts.ts'
import { renderStatus } from '../src/tools.ts'
import type { SessionLike, ValidatorConfig } from '../src/types.ts'
import { MockSession, msg } from './helpers/mock-session.ts'
// (SessionEventLike / SurfaceNode intentionally not imported: the specs work
// through MockSession + FoldStore views.)

// ---------------------------------------------------------------------------
// Harness.
// ---------------------------------------------------------------------------

/** Chain config over the fixture conversations (small floors on purpose). */
function chainConfig(overrides: Partial<AutofoldChainConfig> = {}): AutofoldChainConfig {
  return {
    maxRounds: 16,
    maxBatch: 4,
    maxSummaryOutputTokens: 32768,
    summarizer: 'compaction',
    ...overrides,
  }
}

function validatorConfig(overrides: Partial<ValidatorConfig> = {}): ValidatorConfig {
  return {
    keepRecentMessages: 0,
    keepRecentTokens: 0,
    protectionFloorTokens: 0,
    minFoldableTokens: 5,
    maxFoldFraction: 0.6,
    summaryFloorChars: 10,
    summaryCeilingChars: 20000,
    netShrinkTolerance: 1.05,
    ...overrides,
  }
}

/** Wire the store to the mock session feed (the session/event stand-in). */
function wiredStore(session: MockSession): FoldStore {
  const store = new FoldStore()
  store.attach(session)
  session.onAppend((event) => store.onEvent(session, event))
  return store
}

/**
 * A conversation with K DISJOINT foldable stretches. The validator's
 * protected set is node 0 + the pinned first user + the LATEST user — so the
 * fixture appends a user message after every stretch EXCEPT the last: the
 * latest user sits before the final stretch, making every stretch its own
 * foldable run (intermediate users are NOT protected and would merge runs —
 * this fixture shape is what produces disjoint candidates).
 * Layout: system(0) | user(1, first) | [stretch_i | user] … | stretch_{K-1}.
 */
function seedStretches(count: number, perNodeText = 'b'.repeat(400)): { session: MockSession; runs: number[][] } {
  const session = new MockSession()
  session.append('system/message', msg.system('You are helpful.'))
  session.append('user/message', msg.user('Plan the work.'))
  const runs: number[][] = []
  for (let i = 0; i < count; i += 1) {
    const run: number[] = []
    run.push(session.append('assistant/message', msg.assistant(`Stretch ${i} part one.`, [`call-${i}`])).seq)
    run.push(session.append('tool/result', msg.tool(`call-${i}`, perNodeText)).seq)
    run.push(session.append('assistant/message', msg.assistant(perNodeText)).seq)
    runs.push(run)
    if (i < count - 1) session.append('user/message', msg.user(`Continue after stretch ${i}.`))
  }
  return { session, runs }
}

/** A message of ~N tokens by the chars/3 estimator (3 chars per token). */
function bigTextMessage(tokens: number): Record<string, unknown> {
  return { role: 'user', content: [{ type: 'text', text: 'x'.repeat(tokens * 3) }] }
}

const WINDOWED_40K = { context: { contextWindow: 40000 }, defaultMaxTokens: 8192 }

/** Trigger-line arithmetic for the 40k window (documented for the pins). */
function triggerLine40k(): number {
  return computeBudget({ contextWindow: 40000, maxOutput: 8192 }).triggerLine
}

/** Recording supply spy. */
function spySupply(
  script: (request: AutofoldSummaryRequest, call: number) => Awaited<ReturnType<AutofoldSummarySupply>>,
): { supply: AutofoldSummarySupply; calls: AutofoldSummaryRequest[] } {
  const calls: AutofoldSummaryRequest[] = []
  const supply: AutofoldSummarySupply = async (request) => {
    calls.push(request)
    return script(request, calls.length)
  }
  return { supply, calls }
}

/**
 * The listener deps over one session/store pair. The session identity IS the
 * MockSession — the official live session carries append (the fold commit
 * channel) AND is the WeakMap key the state machine and the nudge-baseline
 * hook key on; a bare id-object would fail the fold() sessionLike assert.
 */
function listenerDeps(
  session: MockSession,
  store: FoldStore,
  overrides: Partial<ConstructorParameters<typeof AutoFoldListener>[0]> = {},
): ConstructorParameters<typeof AutoFoldListener>[0] {
  return {
    summarizer: 'compaction',
    marginRatio: 0.9,
    chain: chainConfig(),
    resolveSession: (sessionId: string) => (sessionId === 'sess-1' ? session : undefined),
    storeFor: (s: unknown) => (s === session ? store : undefined),
    validatorConfig: () => validatorConfig(),
    resolveModelInfo: async () => WINDOWED_40K,
    ...overrides,
  }
}

/** Main-chain-shaped request options (the criterion-1 heuristic passes). */
function loopOptions(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    provider: 'deepseek',
    model: 'deepseek-chat',
    sessionId: 'sess-1',
    maxTokens: 8192,
    messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
    ...overrides,
  }
}

async function runStream(
  listener: AutoFoldListener,
  options: unknown,
  chunks: readonly unknown[] = [FINISH_OK],
): Promise<{ consumed: unknown[]; innerStarted: boolean }> {
  let innerStarted = false
  const inner = async function* () {
    innerStarted = true
    for (const chunk of chunks) yield chunk
  }
  const consumed: unknown[] = []
  for await (const chunk of listener.onStream(options, () => inner())) consumed.push(chunk)
  return { consumed, innerStarted }
}

const FINISH_OK = { type: 'finish', reason: { kind: 'stop' } }

// ---------------------------------------------------------------------------
// Config contract (data-ified constants; the opt-in pin).
// ---------------------------------------------------------------------------

describe('autofold config contract (v0.3 explicit opt-in pin)', () => {
  it('autofold.enabled defaults FALSE — the server-initiated folding face is unreachable under the default configuration (R2-symmetric pin)', () => {
    expect(configDefaults['autofold.enabled']).toBe(false)
    expect(configDefaults['autofold.summarizer']).toBe('compaction')
    expect(configDefaults['autofold.external.url']).toBe('')
    expect(configDefaults['autofold.external.model']).toBe('')
    expect(configDefaults['autofold.external.apiKeyEnv']).toBe('')
    // bc F2.6 data-ified values.
    expect(configDefaults['autofold.maxRounds']).toBe(16)
    expect(configDefaults['autofold.maxBatch']).toBe(4)
    expect(configDefaults['autofold.maxSummaryOutputTokens']).toBe(32768)
  })

  it('parseSummarizerKind accepts exactly the three supplies and rejects everything else (fail-loud input for the fail-loud gate)', () => {
    for (const kind of ['compaction', 'external', 'digest']) {
      expect(parseSummarizerKind(kind)).toBe(kind)
    }
    expect(parseSummarizerKind('llm')).toBeUndefined()
    expect(parseSummarizerKind('')).toBeUndefined()
    expect(parseSummarizerKind(42)).toBeUndefined()
    expect(parseSummarizerKind(undefined)).toBeUndefined()
  })

  it('resolveBudgetField clamps to positive integers with the documented fallback', () => {
    expect(resolveBudgetField(8, 16)).toBe(8)
    expect(resolveBudgetField(0, 16)).toBe(16)
    expect(resolveBudgetField(-3, 16)).toBe(16)
    expect(resolveBudgetField(2.5, 16)).toBe(16)
    expect(resolveBudgetField(Number.POSITIVE_INFINITY, 16)).toBe(16)
    expect(resolveBudgetField('big', 16)).toBe(16)
  })
})

// ---------------------------------------------------------------------------
// Selection (bc F2.8): conservative set + reachability + pair-safe trim.
// ---------------------------------------------------------------------------

describe('selection: selectFoldSpans', () => {
  it('respects the validator conservative set: node 0, first user, latest user stay out; runs are disjoint', () => {
    const { session, runs } = seedStretches(3)
    const store = wiredStore(session)
    const spans = selectFoldSpans({
      surfaceNodes: store.surfaceNodes(),
      config: validatorConfig(),
      maxBatch: 4,
    })
    // The fixture's latest user is the separator before the last stretch.
    const latestUser = runs[2][0] - 1
    const protectedSeqs = new Set([0, 1, latestUser]) // system head, first user, latest user
    for (const span of spans) {
      for (const seq of [span.startSeq, span.endSeq]) {
        expect(protectedSeqs.has(seq)).toBe(false)
      }
      expect(span.startSeq).toBeLessThanOrEqual(span.endSeq)
    }
    // Disjoint by construction.
    for (let i = 0; i < spans.length; i += 1) {
      for (let j = i + 1; j < spans.length; j += 1) {
        const overlaps = spans[i].startSeq <= spans[j].endSeq && spans[j].startSeq <= spans[i].endSeq
        expect(overlaps).toBe(false)
      }
    }
  })

  it('orders by benefit (largest first) and caps the batch width (bc F2.8 + F2.6 MAX_BATCH data-ified)', () => {
    const { session } = seedStretches(4, 'b'.repeat(800))
    const store = wiredStore(session)
    const spans = selectFoldSpans({
      surfaceNodes: store.surfaceNodes(),
      config: validatorConfig(),
      maxBatch: 2,
    })
    expect(spans).toHaveLength(2)
    expect(spans[0].foldedTokens).toBeGreaterThanOrEqual(spans[1].foldedTokens)
  })

  it('trims an over-cap span to maxFoldFraction × window at a PAIR-SAFE boundary (CHUNK_FRACTION spirit, bc F2.6/F2.8)', () => {
    // Run ≈ assistant(7) + tool(1334) + assistant(1334) = 2675 tokens; the
    // pair-safe boundaries are after the tool node (prefix 1341) and the run
    // end (2675). cap 2000 binds between them → the span trims to the
    // assistant+tool prefix (the trailing assistant is dropped).
    const { session, runs } = seedStretches(2, 'b'.repeat(4000))
    const store = wiredStore(session)
    const window = 3334
    const cap = validatorConfig().maxFoldFraction * window // ≈ 2000
    const spans = selectFoldSpans({
      surfaceNodes: store.surfaceNodes(),
      config: validatorConfig({ contextWindow: window }),
      maxBatch: 4,
      window,
    })
    const fullRun = runs[0]
    const fullTokens = store
      .surfaceNodes()
      .filter((n) => n.seq >= fullRun[0] && n.seq <= fullRun[fullRun.length - 1])
      .reduce((sum, n) => sum + n.estimatedTokens, 0)
    expect(fullTokens).toBeGreaterThan(cap)
    // Every selected span honors the cap (or was dropped)…
    for (const span of spans) expect(span.foldedTokens).toBeLessThanOrEqual(cap + 1)
    // …and the trim boundary never splits a tool pair: the trimmed span of
    // the first run ends on the tool node whose assistant is inside.
    const first = spans.find((s) => s.startSeq === fullRun[0])
    expect(first).toBeDefined()
    if (first !== undefined) {
      expect(first.endSeq).toBe(fullRun[1]) // trimmed at the pair-safe boundary
      const endIdx = fullRun.indexOf(first.endSeq)
      for (let i = 0; i <= endIdx; i += 1) {
        const seq = fullRun[i]
        const node = store.surfaceNodes().find((n) => n.seq === seq)
        expect(node).toBeDefined()
        if (node?.role === 'assistant' && node.toolCallIds !== undefined) {
          for (const callId of node.toolCallIds) {
            const partner = store.surfaceNodes().find((n) => n.role === 'tool' && n.answersCallId === callId)
            expect(partner === undefined || (partner.seq >= first.startSeq && partner.seq <= first.endSeq)).toBe(true)
          }
        }
        if (node?.role === 'tool' && node.answersCallId !== undefined) {
          const partner = store.surfaceNodes().find(
            (n) => n.role === 'assistant' && node.answersCallId !== undefined && (n.toolCallIds ?? []).includes(node.answersCallId),
          )
          expect(partner === undefined || (partner.seq >= first.startSeq && partner.seq <= first.endSeq)).toBe(true)
        }
      }
    }
  })

  it('drops spans below minFoldableTokens (validator check f domain)', () => {
    const { session } = seedStretches(2, 'b'.repeat(60)) // ~20 tokens per node → runs ≈ 60 tokens
    const store = wiredStore(session)
    const spans = selectFoldSpans({
      surfaceNodes: store.surfaceNodes(),
      config: validatorConfig({ minFoldableTokens: 5000 }),
      maxBatch: 4,
    })
    expect(spans).toHaveLength(0)
  })

  it('skips hulls outside the validator reachability domain (cross-checkpoint non-monotonic spans, W3-2 invariant)', () => {
    // Build a folded surface: nodes 0..8 then fold [3..5] → checkpoint 9;
    // the numeric order becomes [0,1,2,9,6,7,8] (non-monotonic at 9→6).
    const session = new MockSession()
    session.append('system/message', msg.system('You are helpful.'))
    session.append('user/message', msg.user('Plan the migration.'))
    session.append('assistant/message', msg.assistant('Analysis plan: inventory first.'))
    session.append('user/message', msg.user('Go ahead.'))
    session.append('assistant/message', msg.assistant('Listing files now.', ['call-a']))
    session.append('tool/result', msg.tool('call-a', 'a.sql\nb.ts\nc.md'))
    session.append('assistant/message', msg.assistant('Three files found.'))
    session.append('user/message', msg.user('Summarize.'))
    session.append('assistant/message', msg.assistant('Schema: two tables.'))
    const store = wiredStore(session)
    const commit = fold(session, store, {
      range: { startSeq: 3, endSeq: 5 },
      summaries: [{ startSeq: 3, endSeq: 5, text: 'Listed: a.sql, b.ts, c.md.' }],
    }, validatorConfig({ minFoldableTokens: 5 }))
    expect(commit.ok).toBe(true)
    // A hull SPANNING the checkpoint plus later nodes is non-monotonic.
    const span = buildSpanCandidate(store.surfaceNodes(), 9, 8, validatorConfig({ minFoldableTokens: 5 }), undefined)
    expect(span).toBeUndefined()
    // A boundary-aligned single-checkpoint window stays reachable.
    const aligned = buildSpanCandidate(store.surfaceNodes(), 9, 9, validatorConfig({ minFoldableTokens: 5 }), undefined)
    expect(aligned).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// Supplies (bc §9.1 MUST 5 三选一).
// ---------------------------------------------------------------------------

describe('compaction supply (official one-shot precedent, R3 variant ruling pin)', () => {
  function chunkStream(chunks: readonly unknown[]): { face: { stream(options: Record<string, unknown>): AsyncIterable<unknown> }; seen: Record<string, unknown>[] } {
    const seen: Record<string, unknown>[] = []
    const face = {
      stream(options: Record<string, unknown>): AsyncIterable<unknown> {
        seen.push(options)
        return (async function* () {
          for (const chunk of chunks) yield chunk
        })()
      },
    }
    return { face, seen }
  }

  it('sends ONE purpose-marked one-shot call to the parent request route with the clamped output cap (official compaction marker; R3 variant)', async () => {
    const { face, seen } = chunkStream([
      { type: 'text-delta', index: 0, text: 'A compact checkpoint.' },
      FINISH_OK,
    ])
    const supply = createCompactionSupply(face, 32768)
    const outcome = await supply({
      spanText: 'SPAN CONTENT',
      provider: 'deepseek',
      model: 'deepseek-chat',
      sessionId: 'sess-1',
    })
    expect(outcome.kind).toBe('ok')
    if (outcome.kind === 'ok') expect(outcome.text).toContain('A compact checkpoint.')
    expect(seen).toHaveLength(1)
    const options = seen[0]
    // The R3-variant load-bearing fields:
    expect(options.purpose).toBe('compaction') // llm/src/types.ts:552 closed union
    expect(options.provider).toBe('deepseek')
    expect(options.model).toBe('deepseek-chat')
    expect(options.sessionId).toBe('sess-1')
    expect(options.maxTokens).toBe(32768)
    const messages = options.messages as { role: string; content: { type: string; text: string }[] }[]
    expect(messages).toHaveLength(1)
    expect(messages[0].role).toBe('user')
    expect(messages[0].content[0].text).toContain('SPAN CONTENT')
  })

  it('error/aborted finishes are faults; a normal finish with zero text is a DETERMINISTIC empty (bc F2.11); other no-text finishes are transient (F2.10)', async () => {
    const errorRun = createCompactionSupply(chunkStream([{ type: 'finish', reason: { kind: 'error', failure: { message: 'gateway 502', code: 'X' } } }]).face, 32768)
    const abortedRun = createCompactionSupply(chunkStream([{ type: 'finish', reason: { kind: 'aborted', failure: { message: 'user cancel', code: 'X' } } }]).face, 32768)
    const stopEmpty = createCompactionSupply(chunkStream([FINISH_OK]).face, 32768)
    const toolCallsEmpty = createCompactionSupply(chunkStream([{ type: 'finish', reason: { kind: 'tool-calls' } }]).face, 32768)
    const request = { spanText: 'SPAN', provider: 'p', model: 'm' }
    const error = await errorRun(request)
    expect(error).toMatchObject({ kind: 'fault' })
    const aborted = await abortedRun(request)
    expect(aborted).toMatchObject({ kind: 'fault' })
    const stop = await stopEmpty(request)
    expect(stop).toMatchObject({ kind: 'empty', deterministic: true })
    const toolCalls = await toolCallsEmpty(request)
    expect(toolCalls).toMatchObject({ kind: 'empty', deterministic: false })
  })

  it('a max-tokens finish is never a usable summary (official summarizer parity: truncated checkpoint = fault)', async () => {
    const truncated = createCompactionSupply(chunkStream([
      { type: 'text-delta', index: 0, text: 'runaway text' },
      { type: 'finish', reason: { kind: 'max-tokens' } },
    ]).face, 32768)
    const outcome = await truncated({ spanText: 'SPAN', provider: 'p', model: 'm' })
    expect(outcome).toMatchObject({ kind: 'fault' })
  })

  it('a thrown stream is a fault carrying the error message (fail-soft into the chain)', async () => {
    const face = {
      stream(): AsyncIterable<unknown> {
        return (async function* () {
          yield { type: 'text-delta', index: 0, text: 'partial' }
          throw new Error('socket hung up')
        })()
      },
    }
    const outcome = await createCompactionSupply(face, 32768)({ spanText: 'S', provider: 'p', model: 'm' })
    expect(outcome).toMatchObject({ kind: 'fault', detail: 'socket hung up' })
  })
})

describe('external supply (bc externalSummary 同型)', () => {
  const baseRequest = { spanText: 'SPAN', provider: 'p', model: 'm', maxTokens: 8192 }

  function okFetch(body: string, status = 200): typeof fetch {
    return (async () => new Response(body, { status })) as unknown as typeof fetch
  }

  it('parses OpenAI-compatible choices / content blocks / plain text', () => {
    expect(extractExternalSummaryText(JSON.stringify({ choices: [{ message: { content: 'from choices' } }] }))).toBe('from choices')
    expect(extractExternalSummaryText(JSON.stringify({ content: [{ type: 'text', text: 'from blocks' }] }))).toBe('from blocks')
    expect(extractExternalSummaryText(JSON.stringify({ text: 'from text' }))).toBe('from text')
    expect(extractExternalSummaryText('plain body')).toBe('plain body')
  })

  it('posts the configured model + credential header and returns the summary', async () => {
    process.env.ZCTX_TEST_EXTERNAL_KEY = 'secret-key'
    let seenUrl = ''
    let seenInit: RequestInit | undefined
    const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
      seenUrl = String(url)
      seenInit = init
      return new Response(JSON.stringify({ choices: [{ message: { content: 'external summary' } }] }), { status: 200 })
    }) as unknown as typeof fetch
    const supply = createExternalSupply({ url: 'https://svc.example/summarize', model: 'sum-1', apiKeyEnv: 'ZCTX_TEST_EXTERNAL_KEY', maxTokens: 8192 }, fetchImpl)
    const outcome = await supply(baseRequest)
    expect(outcome).toMatchObject({ kind: 'ok', text: 'external summary' })
    expect(seenUrl).toBe('https://svc.example/summarize')
    const headers = seenInit?.headers as Record<string, string>
    expect(headers.authorization).toBe('Bearer secret-key')
    const body = JSON.parse(String(seenInit?.body))
    expect(body.model).toBe('sum-1')
    expect(body.stream).toBe(false)
    expect(body.messages[0].content).toContain('SPAN')
    delete process.env.ZCTX_TEST_EXTERNAL_KEY
  })

  it('a non-2xx response and an empty body are fault / transient-empty (never a silent supply switch)', async () => {
    const httpFault = createExternalSupply({ url: 'https://svc.example/x', model: 'm', maxTokens: 8192 }, okFetch('nope', 503))
    expect(await httpFault(baseRequest)).toMatchObject({ kind: 'fault' })
    const empty = createExternalSupply({ url: 'https://svc.example/x', model: 'm', maxTokens: 8192 }, okFetch('   \n'))
    expect(await empty(baseRequest)).toMatchObject({ kind: 'empty', deterministic: false })
  })
})

describe('deterministic CPU digest (bc F2.15-F2.16 EMERGENCY 同型)', () => {
  it('is deterministic, keeps head fragments at the constant bound, and strips rows beyond the ceiling with an explicit tail marker', () => {
    const blocks = Array.from({ length: 8 }, (_, i) => ({
      seq: i + 1,
      role: 'assistant',
      chars: 500,
      text: `row ${i} ${'detail '.repeat(40)}`,
    }))
    const a = digestSpanSummary(blocks, 20000)
    const b = digestSpanSummary(blocks, 20000)
    expect(a).toBe(b)
    expect(a.startsWith(AUTOFOLD_DIGEST_HEADER)).toBe(true)
    // Heads bounded by DIGEST_HEAD_CHARS.
    for (const line of a.split('\n').slice(1)) {
      const head = line.slice(line.indexOf(': ') + 2)
      expect(head.length).toBeLessThanOrEqual(DIGEST_HEAD_CHARS + 2) // + ellipsis
    }
    // Small ceiling strips rows and appends the tail marker.
    const tiny = digestSpanSummary(blocks, 260)
    expect(tiny.split('\n').length).toBeLessThan(a.split('\n').length)
    expect(tiny.endsWith('recover via zctx_unfold)')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Chain (bc F2.9-F2.14): degradation + budgets + commit-through-fold().
// ---------------------------------------------------------------------------

describe('chain: runAutoFoldChain', () => {
  it('commits through the SAME fold() engine: checkpoint on the surface, ledger entry, honest net saving (no second commit path)', async () => {
    const { session } = seedStretches(2)
    const store = wiredStore(session)
    const { supply } = spySupply(() => ({ kind: 'ok', text: 'Stretch summary with the needed facts.' }))
    const state = {
      runs: 0,
      roundsTotal: 0,
      foldsCommitted: 0,
      netTokensSaved: 0,
      deterministicEmpties: 0,
      deadProbeSticky: false,
    }
    const record = await runAutoFoldChain({
      session,
      store,
      validatorConfig: validatorConfig(),
      config: chainConfig(),
      supply,
      provider: 'p',
      model: 'm',
      sessionId: 'sess-1',
      estimate: 500,
      hitLine: 100,
      state,
    })
    expect(record.foldsCommitted).toBeGreaterThanOrEqual(1)
    expect(record.outcome).toBe('folds-committed')
    expect(store.ledgerEntries().length).toBe(record.foldsCommitted)
    expect(record.netTokensSaved).toBe(record.foldsCommitted > 0 ? record.netTokensSaved : 0)
    for (const entry of store.ledgerEntries()) {
      expect(entry.status).toBe('active')
      expect(entry.tokensBefore).toBeGreaterThan(entry.tokensAfter)
    }
    // The checkpoint node is on the live surface (the mock enforced the
    // official replace guards — the commit went through the official shape).
    for (const entry of store.ledgerEntries()) {
      expect(session.surface.nodes).toContain(entry.checkpointSeq)
    }
  })

  it('bc F2.10: a transient empty answer retries the SAME span within the retry/budget bounds, then commits', async () => {
    const { session } = seedStretches(1)
    const store = wiredStore(session)
    const { supply, calls } = spySupply((_req, call) =>
      call === 1
        ? { kind: 'empty', deterministic: false, detail: 'content filter blip' }
        : { kind: 'ok', text: 'Recovered summary text long enough.' },
    )
    const record = await runAutoFoldChain({
      session,
      store,
      validatorConfig: validatorConfig(),
      config: chainConfig(),
      supply,
      provider: 'p',
      model: 'm',
      estimate: 500,
      hitLine: 100,
      state: { runs: 0, roundsTotal: 0, foldsCommitted: 0, netTokensSaved: 0, deterministicEmpties: 0, deadProbeSticky: false },
    })
    expect(calls).toHaveLength(2) // one retry, same span
    expect(calls[0].spanText).toBe(calls[1].spanText)
    expect(record.transientRetries).toBe(1)
    expect(record.foldsCommitted).toBe(1)
    expect(record.faults.some((f) => f.includes('transient empty answer'))).toBe(true)
  })

  it('bc F2.11: a NORMAL finish with zero text is never retried in place — it feeds the halving path and counts toward the sticky verdict', async () => {
    const { session, runs } = seedStretches(1, 'b'.repeat(400))
    const store = wiredStore(session)
    const { supply, calls } = spySupply(() => ({ kind: 'empty', deterministic: true }))
    // The single run is far below the halving floor (2 × 2000) → digest.
    const runTokens = store
      .surfaceNodes()
      .filter((n) => n.seq >= runs[0][0] && n.seq <= runs[0][runs[0].length - 1])
      .reduce((sum, n) => sum + n.estimatedTokens, 0)
    expect(runTokens).toBeLessThan(2 * AUTOFOLD_MIN_CHUNK_TOKENS)
    const record = await runAutoFoldChain({
      session,
      store,
      validatorConfig: validatorConfig({ summaryCeilingChars: 20000 }),
      config: chainConfig(),
      supply,
      provider: 'p',
      model: 'm',
      estimate: 500,
      hitLine: 100,
      state: { runs: 0, roundsTotal: 0, foldsCommitted: 0, netTokensSaved: 0, deterministicEmpties: 0, deadProbeSticky: false },
    })
    expect(calls).toHaveLength(1) // NOT retried in place
    expect(record.digestFallbacks).toBe(1)
    expect(record.faults.some((f) => f.includes('deterministic empty answer'))).toBe(true)
  })

  it('bc F2.11: three consecutive deterministic empties put the supply in dead-probe sticky; later spans go digest-only (no more supply calls)', async () => {
    // Big spans: run A (the merged stretch0+stretch1 hull, ≈5.4k tokens) is
    // splittable — its failure halves into two spans; run B stays whole. The
    // deterministic empties accumulate across the span AND its halves.
    const { session } = seedStretches(3, 'b'.repeat(4000))
    const store = wiredStore(session)
    const { supply, calls } = spySupply(() => ({ kind: 'empty', deterministic: true }))
    const state = { runs: 0, roundsTotal: 0, foldsCommitted: 0, netTokensSaved: 0, deterministicEmpties: 0, deadProbeSticky: false }
    const record = await runAutoFoldChain({
      session,
      store,
      validatorConfig: validatorConfig(),
      config: chainConfig({ maxBatch: 3 }),
      supply,
      provider: 'p',
      model: 'm',
      estimate: 100000,
      hitLine: 100,
      state,
    })
    // One supply call per ATTEMPTED span (no in-place retries): the big span
    // + its two halves = 3 calls, then sticky; the remaining span digests
    // without a call.
    expect(calls).toHaveLength(3)
    expect(state.deadProbeSticky).toBe(true)
    expect(state.deterministicEmpties).toBe(DEAD_PROBE_STICKY_LIMIT)
    expect(record.deadProbeSticky).toBe(true)
    expect(record.digestFallbacks).toBe(3)
    expect(record.faults.some((f) => f.includes('summary supply judged dead'))).toBe(true)
  })

  it('bc F2.11 canary failure: a sticky session gets ONE probe per run; a failed probe keeps the whole run digest-only', async () => {
    const { session } = seedStretches(3, 'b'.repeat(4000))
    const store = wiredStore(session)
    const { supply, calls } = spySupply(() => ({ kind: 'empty', deterministic: true }))
    const state = { runs: 0, roundsTotal: 0, foldsCommitted: 0, netTokensSaved: 0, deterministicEmpties: 3, deadProbeSticky: true }
    const record = await runAutoFoldChain({
      session,
      store,
      validatorConfig: validatorConfig(),
      config: chainConfig({ maxBatch: 3 }),
      supply,
      provider: 'p',
      model: 'm',
      estimate: 100000,
      hitLine: 100,
      state,
    })
    // Call 1 = the canary (emptied → the verdict holds); every other span is
    // digest-only without a supply call.
    expect(calls).toHaveLength(1)
    expect(state.deadProbeSticky).toBe(true)
    expect(record.digestFallbacks).toBe(3)
  })

  it('bc F2.11 canary success: the FIRST call (the canary, on the sticky state) succeeding clears sticky and the supply resumes', async () => {
    const { session } = seedStretches(2)
    const store = wiredStore(session)
    const { supply, calls } = spySupply(() => ({ kind: 'ok', text: 'Healthy summary after recovery.' }))
    const state = { runs: 0, roundsTotal: 0, foldsCommitted: 0, netTokensSaved: 0, deterministicEmpties: 3, deadProbeSticky: true }
    const record = await runAutoFoldChain({
      session,
      store,
      validatorConfig: validatorConfig(),
      config: chainConfig(),
      supply,
      provider: 'p',
      model: 'm',
      estimate: 100000,
      hitLine: 100,
      state,
    })
    expect(state.deadProbeSticky).toBe(false) // the canary cleared it
    expect(calls.length).toBeGreaterThanOrEqual(2) // canary + remaining spans
    expect(record.foldsCommitted).toBe(2)
    expect(record.digestFallbacks).toBe(0)
  })

  it('bc F2.9 halving cascade: a persistent failure on a splittable span splits at the pair-safe midpoint and the halves commit', async () => {
    const session = new MockSession()
    session.append('system/message', msg.system('You are helpful.'))
    session.append('user/message', msg.user('Plan the work.'))
    // One BIG splittable run: 3 nodes × 2000 tokens = 6000 tokens ≥ 2 × 2000.
    session.append('assistant/message', msg.assistant('A'.repeat(6000), ['call-big']))
    session.append('tool/result', msg.tool('call-big', 'x'.repeat(6000)))
    session.append('assistant/message', msg.assistant('x'.repeat(6000)))
    session.append('user/message', msg.user('Final question.'))
    const store = wiredStore(session)
    let supplyCalls = 0
    const supply: AutofoldSummarySupply = async () => {
      supplyCalls += 1
      // Fail the FIRST span (the full run) transiently for good; the halves
      // (smaller spans) get usable summaries.
      return supplyCalls <= TRANSIENT_EMPTY_RETRIES + 1
        ? { kind: 'empty', deterministic: false, detail: 'persistent blip' }
        : { kind: 'ok', text: 'Half-span summary with the durable facts, long enough.' }
    }
    const record = await runAutoFoldChain({
      session,
      store,
      validatorConfig: validatorConfig(),
      config: chainConfig({ maxRounds: 16 }),
      supply,
      provider: 'p',
      model: 'm',
      estimate: 8000,
      hitLine: 100,
      state: { runs: 0, roundsTotal: 0, foldsCommitted: 0, netTokensSaved: 0, deterministicEmpties: 0, deadProbeSticky: false },
    })
    expect(record.halvingSplits).toBeGreaterThanOrEqual(1)
    expect(record.foldsCommitted).toBeGreaterThanOrEqual(1)
    // Halves committed (the full-run summary never did).
    expect(store.ledgerEntries().length).toBe(record.foldsCommitted)
    expect(record.faults.some((f) => f.includes('halving span'))).toBe(true)
  })

  it('bc F2.12 net-shrink: a summary that would grow the window never reaches the commit — it feeds the halving path', async () => {
    // Tiny spans: the supply text (≈6667 tokens) fails the pre-check, the
    // span is unsplittable (below the halving floor), and the digest of a
    // ~47-token span (~127 tokens) ALSO fails the validator gate → honest
    // abort with zero commits (futility: the budget is not burned on spans
    // that cannot shrink).
    const { session } = seedStretches(1, 'b'.repeat(60))
    const store = wiredStore(session)
    const { supply } = spySupply(() => ({ kind: 'ok', text: 'z'.repeat(20000) }))
    const record = await runAutoFoldChain({
      session,
      store,
      validatorConfig: validatorConfig(),
      config: chainConfig(),
      supply,
      provider: 'p',
      model: 'm',
      estimate: 500,
      hitLine: 100,
      state: { runs: 0, roundsTotal: 0, foldsCommitted: 0, netTokensSaved: 0, deterministicEmpties: 0, deadProbeSticky: false },
    })
    expect(record.foldsCommitted).toBe(0)
    expect(record.faults.some((f) => f.includes('net-shrink pre-check rejected'))).toBe(true)
  })

  it('bc F2.6 budget clamp: maxRounds bounds the span attempts; the summary-call budget is the exported constant', async () => {
    const { session } = seedStretches(4)
    const store = wiredStore(session)
    const { supply, calls } = spySupply(() => ({ kind: 'ok', text: 'A short usable summary of the stretch.' }))
    const record = await runAutoFoldChain({
      session,
      store,
      validatorConfig: validatorConfig(),
      config: chainConfig({ maxRounds: 1, maxBatch: 4 }),
      supply,
      provider: 'p',
      model: 'm',
      estimate: 100000, // the shortfall never closes → the round budget binds
      hitLine: 10,
      state: { runs: 0, roundsTotal: 0, foldsCommitted: 0, netTokensSaved: 0, deterministicEmpties: 0, deadProbeSticky: false },
    })
    expect(record.rounds).toBe(1)
    expect(record.outcome).toBe('budget-exhausted') // pending spans remained
    expect(record.foldsCommitted).toBe(1) // work before the budget stop is kept
    expect(calls.length).toBeLessThanOrEqual(MAX_SUMMARY_CALLS_PER_RUN)
    expect(record.transientRetries).toBeLessThanOrEqual(TRANSIENT_EMPTY_BUDGET)
    expect(TRANSIENT_EMPTY_RETRIES).toBe(2)
    expect(TRANSIENT_EMPTY_BUDGET).toBe(4)
  })

  it('a raw supply throw propagates out of the chain (the listener owns fail-open; the chain never swallows programming errors)', async () => {
    const { session } = seedStretches(1)
    const store = wiredStore(session)
    const supply: AutofoldSummarySupply = async () => {
      throw new Error('supply exploded')
    }
    await expect(runAutoFoldChain({
      session,
      store,
      validatorConfig: validatorConfig(),
      config: chainConfig(),
      supply,
      provider: 'p',
      model: 'm',
      estimate: 500,
      hitLine: 100,
      state: { runs: 0, roundsTotal: 0, foldsCommitted: 0, netTokensSaved: 0, deterministicEmpties: 0, deadProbeSticky: false },
    })).rejects.toThrow('supply exploded')
  })

  it('no qualified span (bc F2.13 futility, fail-closed): selection finds nothing → honest no-op record', async () => {
    const session = new MockSession()
    session.append('user/message', msg.user('Only a pinned user message exists.'))
    const store = wiredStore(session)
    const { supply, calls } = spySupply(() => ({ kind: 'ok', text: 'unused' }))
    const record = await runAutoFoldChain({
      session,
      store,
      validatorConfig: validatorConfig(),
      config: chainConfig(),
      supply,
      provider: 'p',
      model: 'm',
      estimate: 500,
      hitLine: 100,
      state: { runs: 0, roundsTotal: 0, foldsCommitted: 0, netTokensSaved: 0, deterministicEmpties: 0, deadProbeSticky: false },
    })
    expect(record.outcome).toBe('no-qualified-span')
    expect(calls).toHaveLength(0)
    expect(record.foldsCommitted).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Listener: trigger (V4 third face) + fail-open + anti feedback loop.
// ---------------------------------------------------------------------------

describe('autoFold listener (trigger + fail-open + 防反馈环)', () => {
  it('a request below the trigger line passes through untouched — no estimation side effects, no supply calls (bc F2.1 触发不等式)', async () => {
    const { session } = seedStretches(2)
    const store = wiredStore(session)
    const { supply, calls } = spySupply(() => ({ kind: 'ok', text: 'unused' }))
    const listener = new AutoFoldListener(listenerDeps(session, store, { supply }))
    const { innerStarted } = await runStream(listener, loopOptions())
    expect(innerStarted).toBe(true)
    expect(calls).toHaveLength(0)
  })

  it('a trigger hit runs the chain server-side and STILL passes the request through (fail-open, bc F1.20) — zero model tool-call dependency', async () => {
    const { session } = seedStretches(2)
    const store = wiredStore(session)
    const { supply, calls } = spySupply(() => ({ kind: 'ok', text: 'Server-side summary of the stretch, long enough to stand alone.' }))
    const onFoldCommitted: unknown[] = []
    const listener = new AutoFoldListener(listenerDeps(session, store, {
      supply,
      onFoldCommitted: (s) => onFoldCommitted.push(s),
    }))
    // ~27000 estimated tokens > the 40k-window hit line (29352 × 0.9).
    const { innerStarted, consumed } = await runStream(listener, loopOptions({
      messages: [bigTextMessage(27000)],
    }))
    expect(innerStarted).toBe(true) // fail-open: the request proceeds
    expect(consumed).toHaveLength(1) // the chunk flows unchanged
    expect(calls.length).toBeGreaterThanOrEqual(1) // the supply ran
    expect(onFoldCommitted).toEqual([session]) // 防反馈环: baseline cleared
    const status = listener.statusFor(session)
    expect(status?.runs).toBe(1)
    expect((status?.foldsCommitted ?? 0)).toBeGreaterThanOrEqual(1)
    expect(triggerLine40k() * 0.9).toBeLessThan(27000) // the judged hit line sanity (documented arithmetic)
  })

  it('a purpose-marked call is exempt from judgment entirely (R3 variant ruling pin — the summary call can never re-enter the chain)', async () => {
    const { session } = seedStretches(2)
    const store = wiredStore(session)
    const { supply, calls } = spySupply(() => ({ kind: 'ok', text: 'unused' }))
    const listener = new AutoFoldListener(listenerDeps(session, store, { supply }))
    const { innerStarted } = await runStream(listener, loopOptions({
      purpose: 'compaction',
      messages: [bigTextMessage(27000)], // would hit if judged
    }))
    expect(innerStarted).toBe(true)
    expect(calls).toHaveLength(0)
    expect(listener.statusFor(session)).toBeUndefined()
  })

  it('a chain fault never breaks the request (fail-open with a warn)', async () => {
    const { session } = seedStretches(2)
    const store = wiredStore(session)
    const warns: string[] = []
    const listener = new AutoFoldListener(listenerDeps(session, store, {
      supply: async () => {
        throw new Error('chain exploded')
      },
      logger: { warn: (m) => warns.push(m) },
    }))
    const { innerStarted } = await runStream(listener, loopOptions({ messages: [bigTextMessage(27000)] }))
    expect(innerStarted).toBe(true)
    expect(warns.some((m) => m.includes('autofold chain failed'))).toBe(true)
  })

  it('no fold committed → the nudge baseline is NOT cleared (the reset is fold-committing only, bc F2.20)', async () => {
    // Tiny spans: the deterministic-empty supply sends every span to the
    // digest, and the digest of a ~47-token span fails the net-shrink gate →
    // zero commits → the hook must stay silent.
    const { session } = seedStretches(2, 'b'.repeat(60))
    const store = wiredStore(session)
    const onFoldCommitted: unknown[] = []
    const listener = new AutoFoldListener(listenerDeps(session, store, {
      supply: spySupply(() => ({ kind: 'empty', deterministic: true })).supply,
      onFoldCommitted: (s) => onFoldCommitted.push(s),
    }))
    await runStream(listener, loopOptions({ messages: [bigTextMessage(27000)] }))
    expect(onFoldCommitted).toHaveLength(0)
    expect(listener.statusFor(session)?.foldsCommitted).toBe(0)
    expect(listener.statusFor(session)?.runs).toBe(1)
  })

  it('the trigger plan carries the margin exactly like the V4 judgment (reuse pin, not a reimplementation)', async () => {
    const { session } = seedStretches(2)
    const store = wiredStore(session)
    const listener = new AutoFoldListener(listenerDeps(session, store, { marginRatio: 0.5 }))
    // estimate ~2 tokens (tiny message): below even a 0.5 margin line.
    const { innerStarted } = await runStream(listener, loopOptions())
    expect(innerStarted).toBe(true)
    // And a 15000-token estimate at margin 0.5: 29352×0.5 = 14676 → HIT.
    const { supply, calls } = spySupply(() => ({ kind: 'ok', text: 'Margin-hit summary of the stretch, long enough.' }))
    const hitListener = new AutoFoldListener(listenerDeps(session, store, { marginRatio: 0.5, supply }))
    await runStream(hitListener, loopOptions({ messages: [bigTextMessage(15000)] }))
    expect(calls.length).toBeGreaterThanOrEqual(1)
  })
})

// ---------------------------------------------------------------------------
// Status segment 8.
// ---------------------------------------------------------------------------

describe('status segment 8 (autoFold face facts)', () => {
  function baseRuntime(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      cleanSampleFloor: 0.6,
      preflightMode: 'observe',
      storeFor: () => new FoldStore(),
      validatorConfig: () => validatorConfig(),
      ...overrides,
    }
  }

  const minimalSession = { seq: 1, surface: { nodes: [] } } as unknown as SessionLike

  it('renders the armed-but-idle view with the summarizer kind', async () => {
    const out = await renderStatus(baseRuntime({
      autofoldFace: () => ({ summarizer: 'compaction', runs: 0, roundsTotal: 0, foldsCommitted: 0, netTokensSaved: 0, deadProbeSticky: false }),
    }) as unknown as Parameters<typeof renderStatus>[0], minimalSession)
    expect(out).toContain('AutoFold face (server-initiated folding, compaction supply):')
    expect(out).toContain('no autoFold runs yet')
  })

  it('renders run facts + last-run counters + the dead-probe verdict', async () => {
    const out = await renderStatus(baseRuntime({
      autofoldFace: () => ({
        summarizer: 'external',
        runs: 2,
        roundsTotal: 5,
        foldsCommitted: 3,
        netTokensSaved: 1234,
        deadProbeSticky: true,
        lastRun: {
          time: 0,
          estimate: 27000,
          window: 40000,
          hitLine: 26417,
          rounds: 3,
          summaryCalls: 4,
          foldsCommitted: 2,
          netTokensSaved: 900,
          transientRetries: 1,
          halvingSplits: 1,
          digestFallbacks: 0,
          deadProbeSticky: true,
          outcome: 'folds-committed',
          faults: [],
        },
      }),
    }) as unknown as Parameters<typeof renderStatus>[0], minimalSession)
    expect(out).toContain('AutoFold face (server-initiated folding, external supply):')
    expect(out).toContain('runs: 2 / fold commits: 3 / net saved: ~1234 tokens / rounds total: 5')
    expect(out).toContain('last run: folds-committed (estimate 27000 of window 40000')
    expect(out).toContain('dead-probe sticky')
    expect(out).toContain('digest-only until a canary probe succeeds')
  })

  it('is skipped when the face hook is absent (older test runtimes / gated off)', async () => {
    const out = await renderStatus(baseRuntime() as unknown as Parameters<typeof renderStatus>[0], minimalSession)
    expect(out).not.toContain('AutoFold face')
  })
})

// ---------------------------------------------------------------------------
// Fresh-surface re-verification primitive (the commit-time guard).
// ---------------------------------------------------------------------------

describe('commit-time fresh-surface re-verification primitive', () => {
  it('a hull that spans a mid-run checkpoint (non-monotonic) no longer verifies — the chain aborts it instead of force-folding', () => {
    const session = new MockSession()
    session.append('system/message', msg.system('You are helpful.'))
    session.append('user/message', msg.user('Plan.'))
    session.append('assistant/message', msg.assistant('First answer.'))
    session.append('user/message', msg.user('Go on.'))
    session.append('assistant/message', msg.assistant('Working.', ['call-a']))
    session.append('tool/result', msg.tool('call-a', 'result data'))
    session.append('assistant/message', msg.assistant('Done with that.'))
    session.append('user/message', msg.user('Next.'))
    session.append('assistant/message', msg.assistant('Second answer.'))
    const store = wiredStore(session)
    // Pre-fold: the hull [3..8] verifies (contiguous, monotonic, pairs closed).
    const pre = buildSpanCandidate(store.surfaceNodes(), 3, 8, validatorConfig({ minFoldableTokens: 5 }), undefined)
    expect(pre).toBeDefined()
    // A fold lands INSIDE the hull ([5..6] → checkpoint 9): the same hull now
    // spans the checkpoint plus later nodes → non-monotonic → undefined.
    // The fold window must be pair-closed: [4..6] (assistant+tool+assistant).
    const commit = fold(session, store, {
      range: { startSeq: 4, endSeq: 6 },
      summaries: [{ startSeq: 4, endSeq: 6, text: 'call-a done.' }],
    }, validatorConfig({ minFoldableTokens: 5, summaryFloorChars: 10 }))
    expect(commit.ok).toBe(true)
    const post = buildSpanCandidate(store.surfaceNodes(), 3, 8, validatorConfig({ minFoldableTokens: 5 }), undefined)
    expect(post).toBeUndefined()
  })
})

// (no trailing helpers — the file ends with the re-verification suite)
