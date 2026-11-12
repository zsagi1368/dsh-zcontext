import { describe, expect, it } from 'vitest'

import { FoldStore } from '../src/store.ts'
import { computeBudget, estimateTokens } from '../src/budget.ts'
import {
  buildZctxTools,
  parseFoldContent,
  renderStatus,
  resolveDefineTool,
} from '../src/tools.ts'
import type { ZctxToolDefinition, ZctxToolRuntime } from '../src/tools.ts'
import { STATUS_NO_SESSION } from '../src/texts.ts'
import type { SessionLike, ValidatorConfig } from '../src/types.ts'
import { MockSession, msg, seedConversation } from './helpers/mock-session.ts'

/** Test runtime: per-session stores + a fixed validator config + mock faces. */
function testRuntime(overrides: Partial<ZctxToolRuntime> = {}): ZctxToolRuntime & {
  stores: Map<SessionLike, FoldStore>
} {
  const stores = new Map<SessionLike, FoldStore>()
  const config: ValidatorConfig = {
    keepRecentMessages: 0,
    keepRecentTokens: 0,
    protectionFloorTokens: 0,
    minFoldableTokens: 5,
    maxFoldFraction: 0.6,
    summaryFloorChars: 10,
    summaryCeilingChars: 20000,
    netShrinkTolerance: 1.05,
    contextWindow: 200000,
  }
  return {
    stores,
    storeFor(session: SessionLike): FoldStore {
      let store = stores.get(session)
      if (store === undefined) {
        store = new FoldStore()
        store.attach(session)
        stores.set(session, store)
      }
      return store
    },
    validatorConfig(): ValidatorConfig {
      return config
    },
    logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
    tokenMeter: { measure: () => ({ totalTokens: 100000 }) },
    llm: {
      resolveModelInfo: async () => ({ context: { contextWindow: 200000 }, defaultMaxTokens: 8192 }),
    },
    ...overrides,
  }
}

function execWith(session: MockSession | undefined): { agent?: { session?: MockSession } } {
  return session === undefined ? {} : { agent: { session } }
}

const FOLD_CONTENT = 'fold 3..5\nFiles listed: a.sql, b.ts, c.md; three files reported.'

describe('tools: parseFoldContent (parseCompressInput-aligned, self-implemented)', () => {
  it('parses the text-block form into the window hull + summaries', () => {
    const parsed = parseFoldContent('fold 3..5 topic\nFirst summary.\n\nfold 7..9\nSecond summary.')
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.range).toEqual({ startSeq: 3, endSeq: 9 })
    expect(parsed.summaries).toEqual([
      { startSeq: 3, endSeq: 5, text: 'First summary.' },
      { startSeq: 7, endSeq: 9, text: 'Second summary.' },
    ])
  })

  it('accepts m-ref spellings, dashes, and plain range headers', () => {
    const parsed = parseFoldContent('m00012–m00018\nRef summary.\n\n12-18\nDash summary.\n\nseq 20..22\nSeq summary.')
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.range).toEqual({ startSeq: 12, endSeq: 22 })
    expect(parsed.summaries).toHaveLength(3)
  })

  it('accepts the JSON array form and both startId/startRef spellings', () => {
    const parsed = parseFoldContent(
      JSON.stringify([
        { startRef: '3', endId: '5', summary: 'JSON summary one.' },
        { startId: 7, endRef: 'm00009', summary: 'JSON summary two.' },
      ]),
    )
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.summaries).toEqual([
      { startSeq: 3, endSeq: 5, text: 'JSON summary one.' },
      { startSeq: 7, endSeq: 9, text: 'JSON summary two.' },
    ])
  })

  it('accepts a single top-level JSON range object', () => {
    const parsed = parseFoldContent(JSON.stringify({ startId: '3', endId: '5', summary: 'Single range summary.' }))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.summaries).toEqual([{ startSeq: 3, endSeq: 5, text: 'Single range summary.' }])
  })

  it('accepts a JSON string wrapping the text-block form (gateway double-encoding)', () => {
    const parsed = parseFoldContent(JSON.stringify('fold 3..5\nWrapped summary text.'))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.summaries).toEqual([{ startSeq: 3, endSeq: 5, text: 'Wrapped summary text.' }])
  })

  it('reports honest zero-range diagnostics instead of guessing', () => {
    for (const bad of ['', '   ', 'no ranges here at all', JSON.stringify(42), 'fold abc..def\nsummary']) {
      const parsed = parseFoldContent(bad)
      expect(parsed.ok).toBe(false)
      if (parsed.ok) continue
      expect(parsed.reason).toContain('parsed 0 valid fold ranges')
    }
    const nonString = parseFoldContent(12345)
    expect(nonString.ok).toBe(false)
  })
})

describe('tools: defineTool resolution (shim, fail-soft)', () => {
  it('falls back to the structural shim when the host tools package is absent', () => {
    const defineTool = resolveDefineTool()
    expect(typeof defineTool).toBe('function')
  })

  it('compiles the author prop-map into the enforced JSON-Schema subset', () => {
    const [foldTool] = buildZctxTools(resolveDefineTool(), testRuntime())
    expect(foldTool.parameters).toEqual({
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: 'All fold blocks in one string: "fold <startSeq>..<endSeq>" header line + markdown summary per block, or a JSON array of {startRef, endRef, summary}.',
        },
      },
      required: ['content'],
    })
  })

  it('validates arguments before execute (official ToolArgsError semantics)', async () => {
    const defineTool = resolveDefineTool()
    const [foldTool] = buildZctxTools(defineTool, testRuntime())
    await expect(foldTool.execute({}, {})).rejects.toThrow(/invalid arguments: .*required/)
    await expect(foldTool.execute({ content: 42 }, {})).rejects.toThrow(/invalid arguments: .*expected string/)
  })
})

describe('tools: the four zctx tools (shim-defined)', () => {
  it('exposes exactly four tools without isConcurrencySafe (S8)', () => {
    const tools = buildZctxTools(resolveDefineTool(), testRuntime())
    expect(tools.map((t) => t.name)).toEqual(['zctx_fold', 'zctx_unfold', 'zctx_recall', 'zctx_status'])
    for (const tool of tools as unknown as Record<string, unknown>[]) {
      expect(tool.isConcurrencySafe).toBeUndefined()
    }
  })

  it('renders tool results as text blocks through output.render', async () => {
    const [foldTool] = buildZctxTools(resolveDefineTool(), testRuntime())
    const reply = await foldTool.execute({ content: FOLD_CONTENT }, execWith(seedConversation().session))
    expect(foldTool.output.render({}, reply)).toEqual([{ type: 'text', text: reply }])
  })

  it('zctx_fold commits through the engine and reports the reclaimed tokens', async () => {
    const { session } = seedConversation()
    const runtime = testRuntime()
    const [foldTool] = buildZctxTools(resolveDefineTool(), runtime)
    const reply = await foldTool.execute({ content: FOLD_CONTENT }, execWith(session))
    expect(reply).toMatch(/^Folded seqs 3–5, ~\d+ tokens reclaimed \(1 checkpoint, 0 earlier folds absorbed\)$/)
    expect(session.surface.nodes).toEqual([0, 1, 2, 9, 6, 7, 8])
    // The runtime store tracked the new fold.
    const store = runtime.stores.get(session)!
    expect([...store.foldMap.keys()]).toEqual(['f9'])
  })

  it('zctx_fold answers fail-soft when the session is unreachable', async () => {
    const [foldTool] = buildZctxTools(resolveDefineTool(), testRuntime())
    const reply = await foldTool.execute({ content: FOLD_CONTENT }, {})
    expect(reply).toBe(STATUS_NO_SESSION)
  })

  it('zctx_unfold defaults to the latest active fold and re-materializes one node', async () => {
    const { session } = seedConversation()
    const runtime = testRuntime()
    const tools = buildZctxTools(resolveDefineTool(), runtime)
    const foldTool = tools[0]
    const unfoldTool = tools[1]
    await foldTool.execute({ content: FOLD_CONTENT }, execWith(session))
    const reply = await unfoldTool.execute({}, execWith(session))
    expect(reply).toContain('Unfolded fold f9')
    expect(session.surface.nodes).toEqual([0, 1, 2, 10, 6, 7, 8])
  })

  it('zctx_unfold rejects unknown ids and reports the empty ledger honestly', async () => {
    const { session } = seedConversation()
    const tools = buildZctxTools(resolveDefineTool(), testRuntime())
    const unfoldTool = tools[1]
    const empty = await unfoldTool.execute({}, execWith(session))
    expect(empty).toBe('no active folds to unfold')
    const unknown = await unfoldTool.execute({ foldId: 'f-missing' }, execWith(session))
    expect(unknown).toContain('no active fold matches foldId f-missing')
    await tools[0].execute({ content: FOLD_CONTENT }, execWith(session))
    const afterFold = await unfoldTool.execute({ foldId: 'f-missing' }, execWith(session))
    expect(afterFold).toContain('no active fold matches foldId f-missing')
  })

  it('zctx_recall searches summaries AND folded-away originals', async () => {
    const { session } = seedConversation()
    const tools = buildZctxTools(resolveDefineTool(), testRuntime())
    await tools[0].execute({ content: FOLD_CONTENT }, execWith(session))
    const reply = await tools[2].execute({ query: 'a.sql' }, execWith(session))
    expect(reply).toContain('Recall hits for "a.sql"')
    // Both the summary and the original tool result text are reachable.
    expect(reply).toContain('[summary]')
    expect(reply).toContain('[original]')
  })

  it('zctx_recall answers the empty corpus and no-hit queries honestly', async () => {
    const { session } = seedConversation()
    const tools = buildZctxTools(resolveDefineTool(), testRuntime())
    const empty = await tools[2].execute({ query: 'anything' }, execWith(session))
    expect(empty).toBe('No recall hits for "anything".')
    await tools[0].execute({ content: FOLD_CONTENT }, execWith(session))
    const miss = await tools[2].execute({ query: 'zzz-no-match-zzz' }, execWith(session))
    expect(miss).toBe('No recall hits for "zzz-no-match-zzz".')
  })

  it('zctx_status renders the degraded window note and honest meter warning', async () => {
    const { session } = seedConversation()
    const runtime = testRuntime({ tokenMeter: undefined, llm: undefined })
    const status = await renderStatus(runtime, session)
    expect(status).toContain('context window unknown (llm model info unavailable)')
    expect(status).toContain('token meter unavailable')
    expect(status).toContain('Foldable ranges')
    expect(status).toContain('Folds (0 active)')
    expect(status).toContain('cache usage: ESTIMATED')
    expect(status).toContain('status rendered in degraded mode:')
  })

  it('zctx_status renders the full window line, budget table, PROTECTED map, and cache state', async () => {
    const { session } = seedConversation()
    const runtime = testRuntime()
    // Route + usage sample so the measured branch renders.
    const routed = session as unknown as {
      requestHeader: () => { config: { provider: string; model: string; maxTokens: number } }
    }
    routed.requestHeader = () => ({ config: { provider: 'deepseek', model: 'test-model', maxTokens: 8192 } })
    session.append('assistant/message', msg.assistant('with usage', [], { inputTokens: 10, outputTokens: 5, cacheReadTokens: 900, cacheWriteTokens: 100 }))
    runtime.stores.get(session)?.resync()
    const status = await renderStatus(runtime, session)
    const budget = computeBudget({ contextWindow: 200000, maxOutput: 8192 })
    expect(status).toContain('window: ~100000 tokens (50.0% of 200000)')
    expect(status).toContain(`trigger line ${budget.triggerLine} (`)
    expect(status).toContain('Budget (CCM v2.3):')
    expect(status).toContain('fixed wire overhead (4 zctx tool schemas + guidance)')
    expect(status).toContain('PROTECTED')
    expect(status).toContain('Folds (0 active)')
    // 4 unmeasured seed samples + 1 measured sample; the latest drives the branch.
    expect(status).toContain('cache usage: measured from 5 provider usage samples (latest: cache read 900 / cache write 100 tokens)')
    expect(status).not.toContain('status rendered in degraded mode')
  })

  it('zctx_status flags windows below the CCM legal domain (engine gate, tools usable)', async () => {
    const { session } = seedConversation()
    const runtime = testRuntime({
      llm: { resolveModelInfo: async () => ({ context: { contextWindow: 16384 } }) },
    })
    // Route the session so the model info path resolves.
    const routed = session as unknown as {
      requestHeader: () => { config: { provider: string; model: string } }
    }
    routed.requestHeader = () => ({ config: { provider: 'deepseek', model: 'test-model' } })
    const status = await renderStatus(runtime, session)
    expect(status).toContain('below the CCM legal domain (W ≥ 32768)')
    // Manual folding stays usable: the fold tool still commits.
    const [foldTool] = buildZctxTools(resolveDefineTool(), runtime)
    const reply = await foldTool.execute({ content: FOLD_CONTENT }, execWith(session))
    expect(reply).toMatch(/^Folded seqs 3–5, ~\d+ tokens reclaimed/)
    expect(session.surface.replaceGeneration).toBe(1)
  })
})

describe('tools: status token figures are estimates, not measurements', () => {
  it('keeps estimateTokens as the estimator behind fold accounting', () => {
    expect(estimateTokens('abc')).toBe(1)
    expect(estimateTokens('abcd')).toBe(2)
  })
})
