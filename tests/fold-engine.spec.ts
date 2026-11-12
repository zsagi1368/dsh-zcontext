import { describe, expect, it } from 'vitest'

import {
  CCM_MIN_CONTEXT_WINDOW,
  ccmWindowGate,
  fold,
  foldableRanges,
  renderFoldReply,
  renderUnfoldReply,
  unfold,
} from '../src/fold-engine.ts'
import { computeBudget, estimateTokens } from '../src/budget.ts'
import { FoldStore } from '../src/store.ts'
import { REASON_NODE0, fill } from '../src/texts.ts'
import type { SessionEventLike, ValidatorConfig } from '../src/types.ts'
import { MockSession, msg, seedConversation } from './helpers/mock-session.ts'

/**
 * Real-mode session handle (S5): the genuine @deepseek-ai/dsh-session from
 * the zDSH-main build, imported by absolute file URL (its internal cordis /
 * dsh-llm dependencies resolve from the importing file's own location).
 * `undefined` marks the unavailable case — those tests then SKIP with the
 * explicit reason (no fail-open, no silent degradation).
 */
interface RealSessionModule {
  Session: {
    create(id: unknown): RealSessionLike
  }
  SessionId: (id: string) => unknown
  foldSurface: (
    events: readonly SessionEventLike[],
    projections?: readonly never[],
  ) => { readonly nodes: readonly number[]; readonly replacements: readonly unknown[] }
}

interface RealSessionLike {
  readonly seq: number
  readonly surface: {
    readonly nodes: readonly number[]
    readonly replaceGeneration: number
    readonly contentGeneration: number
  }
  eventAt(seq: number): SessionEventLike | undefined
  append(
    type: string,
    data: unknown,
    opts?: {
      surfaceOp?: 'append' | { op: 'replace'; startSeq: number; endSeq: number }
      sourceEventSeqs?: number[]
    },
  ): SessionEventLike
}

const REAL_SESSION_URL = 'file:///G:/000Github/zDSH/zDSH-main/packages/core/session/lib/index.js'

/** Load the real session module, or `undefined` when the build is absent. */
async function loadRealSession(): Promise<RealSessionModule | undefined> {
  try {
    return (await import(/* @vite-ignore */ REAL_SESSION_URL)) as RealSessionModule
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error)
    console.warn(
      `[zctx W3] real @deepseek-ai/dsh-session unavailable (SKIPPED real-mode tests): ${detail}`,
    )
    return undefined
  }
}

const realSessionPromise = loadRealSession()

/** Resolve the real module; null → skipped (skipIf below). */
async function realSession(): Promise<RealSessionModule | null> {
  return (await realSessionPromise) ?? null
}

/** Engine config over the fixture conversations (small windows on purpose). */
function engineConfig(contextWindow = 200000): ValidatorConfig {
  return {
    keepRecentMessages: 0,
    keepRecentTokens: 0,
    protectionFloorTokens: 0,
    minFoldableTokens: 5,
    maxFoldFraction: 0.6,
    summaryFloorChars: 10,
    summaryCeilingChars: 20000,
    netShrinkTolerance: 1.05,
    ...(contextWindow !== undefined ? { contextWindow } : {}),
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
 * The mid-conversation fold window of seedConversation: nodes 3..5 (user +
 * assistant + tool result). The summary stays under the net-shrink line of
 * the ~21 estimated folded tokens.
 */
function midWindowSubmission(
  text = 'Files listed: a.sql, b.ts, c.md; three files reported.',
): { range: { startSeq: number; endSeq: number }; summaries: { startSeq: number; endSeq: number; text: string }[] } {
  return {
    range: { startSeq: 3, endSeq: 5 },
    summaries: [{ startSeq: 3, endSeq: 5, text }],
  }
}

describe('fold-engine: successful fold (mock mode)', () => {
  it('commits one checkpoint per summary block with exact shadowed sets', () => {
    const { session } = seedConversation()
    const store = wiredStore(session)
    const preNodes = store.surfaceNodes().filter((n) => n.seq >= 3 && n.seq <= 5)
    const expectedBefore = preNodes.reduce((sum, n) => sum + n.estimatedTokens, 0)
    const summary = 'Files listed: a.sql, b.ts, c.md; three files reported.'

    const result = fold(session, store, midWindowSubmission(summary), engineConfig())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.committed).toHaveLength(1)
    const commit = result.committed[0]
    expect(commit.foldId).toBe('f9') // minted from the pre-append next seq
    expect(commit.checkpointSeq).toBe(9)
    expect(commit.shadowedSeqs).toEqual([3, 4, 5])
    expect(commit.tokensBefore).toBe(expectedBefore)
    expect(commit.tokensAfter).toBe(estimateTokens(summary))
    // Checkpoint node is on the surface; shadowed nodes are gone.
    expect(session.surface.nodes).toEqual([0, 1, 2, 9, 6, 7, 8])
    expect(session.surface.replaceGeneration).toBe(1)
    expect(session.surface.contentGeneration).toBe(1)
    // Checkpoint payload shape (S4 minimal form).
    const event = session.log[9]
    const source = (event.data as { message: { source: Record<string, unknown> } }).message.source
    expect(source).toEqual({
      kind: 'zctx-fold',
      foldId: 'f9',
      tokensBefore: expectedBefore,
      tokensAfter: commit.tokensAfter,
    })
    // The store (fed by the mock feed) sees the new active fold.
    expect([...store.foldMap.keys()]).toEqual(['f9'])
    expect(result.anomalies).toEqual([])
  })

  it('commits multiple pair-balanced checkpoints in one submission', () => {
    const { session } = seedConversation()
    const store = wiredStore(session)
    const result = fold(session, store, {
      range: { startSeq: 3, endSeq: 6 },
      summaries: [
        { startSeq: 3, endSeq: 5, text: 'Files listed: a.sql, b.ts, c.md; three files reported.' },
        { startSeq: 6, endSeq: 6, text: 'Assistant reported three files.' },
      ],
    }, engineConfig())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.committed).toHaveLength(2)
    // Disjoint subranges: generation advanced exactly twice.
    expect(session.surface.replaceGeneration).toBe(2)
    expect(session.surface.contentGeneration).toBe(2)
    // Checkpoints 9 and 10; the tool pair (4, 5) folded together in entry 1.
    expect(session.surface.nodes).toEqual([0, 1, 2, 9, 10, 7, 8])
  })

  it('rejects a submission whose subrange would split a tool pair', () => {
    const { session } = seedConversation()
    const store = wiredStore(session)
    // Subrange [3, 4] takes the assistant call but leaves its result (node 5).
    const result = fold(session, store, {
      range: { startSeq: 3, endSeq: 6 },
      summaries: [
        { startSeq: 3, endSeq: 4, text: 'User asked; assistant called the tool.' },
        { startSeq: 6, endSeq: 6, text: 'Assistant reported three files.' },
      ],
    }, engineConfig())
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reasons.some((r) => r.includes('would split a tool-call/result pair'))).toBe(true)
    expect(result.committed).toEqual([])
    expect(session.log).toHaveLength(9)
  })

  it('records sourceEventSeqs exactly as the live shadowed set per entry', () => {
    const { session } = seedConversation()
    const store = wiredStore(session)
    const result = fold(session, store, midWindowSubmission(), engineConfig())
    expect(result.ok).toBe(true)
    const event = session.log[result.committed[0].checkpointSeq]
    expect(event.sourceEventSeqs).toEqual([3, 4, 5])
    expect(event.surfaceOp).toEqual({ op: 'replace', startSeq: 3, endSeq: 5 })
  })
})

describe('fold-engine: rejections (mock mode)', () => {
  it('rejects a net-growing window with nothing committed', () => {
    const { session } = seedConversation()
    const store = wiredStore(session)
    const hugeSummary = 'x'.repeat(2000)
    const result = fold(session, store, {
      range: { startSeq: 3, endSeq: 5 },
      summaries: [{ startSeq: 3, endSeq: 5, text: hugeSummary }],
    }, engineConfig())
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reasons.some((r) => r.includes('would grow the window'))).toBe(true)
    expect(result.committed).toEqual([])
    expect(session.surface.replaceGeneration).toBe(0)
    expect(session.log).toHaveLength(9)
  })

  it('rejects a window reaching into the protected recent tail', () => {
    const { session } = seedConversation()
    const store = wiredStore(session)
    // 60-token recent tail reaches back into the window [3, 5].
    const result = fold(session, store, midWindowSubmission(), {
      ...engineConfig(),
      keepRecentTokens: 60,
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reasons.some((r) => r.includes('protected recent tail'))).toBe(true)
  })

  it('rejects a fold that would split an assistant tool-call/result pair', () => {
    const { session } = seedConversation()
    const store = wiredStore(session)
    // Window [3, 4]: the assistant tool call at node 4, but its result (node
    // 5) stays outside → REASON_TOOL_UNANSWERED_CALL (validator, window level).
    const result = fold(session, store, {
      range: { startSeq: 3, endSeq: 4 },
      summaries: [{ startSeq: 3, endSeq: 4, text: 'User asked; assistant called the tool.' }],
    }, engineConfig())
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reasons.some((r) => r.includes('whose result at seq 5 is outside'))).toBe(true)
  })

  it('pre-checks node 0 (system head) before any commit', () => {
    const { session } = seedConversation()
    const store = wiredStore(session)
    const result = fold(session, store, {
      range: { startSeq: 0, endSeq: 5 },
      summaries: [{ startSeq: 0, endSeq: 5, text: 'Everything summarized away.' }],
    }, engineConfig())
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reasons).toContain(fill(REASON_NODE0, { start: 0, end: 5 }))
    expect(session.log).toHaveLength(9)
  })

  it('rejects while a compaction bracket is open, then allows after it closes', () => {
    const { session } = seedConversation()
    const store = wiredStore(session)
    session.append('compaction/start', { compactionId: 'c1' })
    const blocked = fold(session, store, midWindowSubmission(), engineConfig())
    expect(blocked.ok).toBe(false)
    if (!blocked.ok) {
      expect(blocked.reasons[0]).toContain('compaction transaction is active')
    }
    expect(session.log).toHaveLength(10)
    session.append('compaction/end', { compactionId: 'c1', outcome: 'complete' })
    const allowed = fold(session, store, midWindowSubmission(), engineConfig())
    expect(allowed.ok).toBe(true)
  })

  it('reports a session append rejection as reasons + anomaly (fail-soft)', () => {
    const { session } = seedConversation()
    const store = wiredStore(session)
    // Hostile host: the surface moved between validation and commit (the
    // official SurfaceChangedError family surfaces as a throw).
    const originalAppend = session.append.bind(session)
    let calls = 0
    ;(session as unknown as { append: MockSession['append'] }).append = (
      type: string,
      data: unknown,
      opts?: Record<string, never>,
    ) => {
      calls += 1
      if (calls === 1) throw new Error('surface replace: start seq 3 not found in surface')
      return originalAppend(type, data, opts as never)
    }
    const result = fold(session, store, midWindowSubmission(), engineConfig())
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reasons[0]).toContain('the session rejected the fold commit')
    expect(result.committed).toEqual([])
    expect(result.anomalies[0].kind).toBe('append-rejected')
    expect(store.anomalies().some((a) => a.kind === 'append-rejected')).toBe(true)
  })
})

describe('fold-engine: nested absorption (mock mode)', () => {
  it('absorbs an active checkpoint covered by a submitted summary', () => {
    const { session } = seedConversation()
    const store = wiredStore(session)
    // First fold: [3, 5] → checkpoint 9 (surface [0,1,2,9,6,7,8]).
    expect(fold(session, store, midWindowSubmission(), engineConfig()).ok).toBe(true)
    // Second fold: the window is the checkpoint node itself [9, 9]; the
    // summary covers it, so the older fold is absorbed (validator rule d).
    const second = fold(session, store, {
      range: { startSeq: 9, endSeq: 9 },
      summaries: [{ startSeq: 9, endSeq: 9, text: 'The file listing turn, condensed again.' }],
    }, engineConfig())
    expect(second.ok).toBe(true)
    if (!second.ok) return
    // The plan documents the absorption.
    expect(second.plan?.folds[0].absorbedFoldIds).toEqual(['f9'])
    // The ledger demoted f9; only the new fold is active.
    const f9 = store.ledgerEntries().find((e) => e.foldId === 'f9')
    expect(f9?.status).toBe('absorbed')
    expect([...store.foldMap.keys()]).toEqual(['f10'])
  })
})

describe('fold-engine: unfold single-node form (B1, mock mode)', () => {
  it('replaces the checkpoint with one multi-block user message', () => {
    const { session } = seedConversation()
    const store = wiredStore(session)
    const folded = fold(session, store, midWindowSubmission(), engineConfig())
    expect(folded.ok).toBe(true)
    const checkpointSeq = folded.committed[0].checkpointSeq
    const unfolded = unfold(session, store, 'f9')
    expect(unfolded.ok).toBe(true)
    if (!unfolded.ok) return
    const commit = unfolded.committed[0]
    expect(commit.checkpointSeq).toBe(checkpointSeq + 1)
    expect(commit.shadowedSeqs).toEqual([checkpointSeq])
    expect(commit.blocks).toBe(3)
    // B1: exactly ONE surface node replaces the checkpoint.
    expect(session.surface.nodes).toEqual([0, 1, 2, commit.checkpointSeq, 6, 7, 8])
    expect(session.surface.replaceGeneration).toBe(2)
    const event = session.log[commit.checkpointSeq]
    const data = event.data as {
      message: { content: { type: string; text: string }[]; source: Record<string, unknown> }
    }
    expect(data.message.source).toEqual({
      kind: 'zctx-unfold',
      foldId: 'f9',
      tokensBefore: expect.any(Number),
      tokensAfter: expect.any(Number),
    })
    // The re-materialized blocks cover the original span in order.
    expect(data.message.content.every((b) => b.type === 'text')).toBe(true)
    expect(data.message.content.map((b) => b.text).join('\n')).toContain('list the files')
    expect(data.message.content.map((b) => b.text).join('\n')).toContain(
      '(tool result quoted verbatim from the session log)',
    )
    // The ledger marks the fold unfolded; foldMap is empty.
    const f9 = store.ledgerEntries().find((e) => e.foldId === 'f9')
    expect(f9?.status).toBe('unfolded')
    expect(store.foldMap.size).toBe(0)
  })

  it('rejects unknown and inactive fold ids honestly', () => {
    const { session } = seedConversation()
    const store = wiredStore(session)
    const unknown = unfold(session, store, 'f-missing')
    expect(unknown.ok).toBe(false)
    if (!unknown.ok) expect(unknown.reasons[0]).toContain('no active fold with id f-missing')

    expect(fold(session, store, midWindowSubmission(), engineConfig()).ok).toBe(true)
    expect(unfold(session, store, 'f9').ok).toBe(true)
    // Second unfold of the same id: not active anymore.
    const again = unfold(session, store, 'f9')
    expect(again.ok).toBe(false)
    if (!again.ok) expect(again.reasons[0]).toContain('is not active (status: unfolded)')
  })

  it('re-folds the re-materialized node after an unfold', () => {
    const { session } = seedConversation()
    const store = wiredStore(session)
    expect(fold(session, store, midWindowSubmission(), engineConfig()).ok).toBe(true)
    const firstUnfold = unfold(session, store, 'f9')
    expect(firstUnfold.ok).toBe(true)
    const unfoldSeq = firstUnfold.committed[0].checkpointSeq
    const refold = fold(session, store, {
      range: { startSeq: unfoldSeq, endSeq: unfoldSeq },
      summaries: [
        { startSeq: unfoldSeq, endSeq: unfoldSeq, text: 'The listing turn: user asked, tool answered, assistant reported.' },
      ],
    }, engineConfig())
    expect(refold.ok).toBe(true)
    if (!refold.ok) return
    expect(session.surface.nodes).toEqual([0, 1, 2, refold.committed[0].checkpointSeq, 6, 7, 8])
    expect(store.ledgerEntries().find((e) => e.foldId === 'f9')?.status).toBe('unfolded')
  })

  it('refuses to unfold while a compaction bracket is open', () => {
    const { session } = seedConversation()
    const store = wiredStore(session)
    expect(fold(session, store, midWindowSubmission(), engineConfig()).ok).toBe(true)
    session.append('compaction/start', { compactionId: 'c1' })
    const blocked = unfold(session, store, 'f9')
    expect(blocked.ok).toBe(false)
    if (!blocked.ok) expect(blocked.reasons[0]).toContain('compaction transaction is active')
  })
})

describe('fold-engine: post-commit verification (fail-soft)', () => {
  it('records a generation-mismatch anomaly without throwing', () => {
    const { session } = seedConversation()
    const store = wiredStore(session)
    // Hostile host: bump the replace generation twice per replace (a phantom
    // concurrent producer sharing the commit window).
    const hostile = session as unknown as { replaceGenerationSnapshot: number }
    hostile.replaceGenerationSnapshot = 0
    Object.defineProperty(session, 'replaceGeneration', {
      get: () => hostile.replaceGenerationSnapshot,
      set: (value: number) => {
        hostile.replaceGenerationSnapshot = value
      },
      configurable: true,
    })
    const originalAppend = session.append.bind(session)
    ;(session as unknown as { append: MockSession['append'] }).append = (
      type: string,
      data: unknown,
      opts?: Record<string, never>,
    ) => {
      const event = originalAppend(type, data, opts as never)
      hostile.replaceGenerationSnapshot += 1 // one extra phantom replace
      return event
    }
    const result = fold(session, store, midWindowSubmission(), engineConfig())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.anomalies).toHaveLength(1)
    expect(result.anomalies[0].kind).toBe('generation-mismatch')
    expect(result.anomalies[0].detail).toContain('advanced by 2, expected 1')
    expect(store.anomalies().some((a) => a.kind === 'generation-mismatch')).toBe(true)
    // The commit itself landed.
    expect(session.log).toHaveLength(10)
  })

  it('reports a missing checkpoint node honestly', () => {
    const { session } = seedConversation()
    const store = wiredStore(session)
    // Hostile host: the live surface view never contains the checkpoint.
    Object.defineProperty(session, 'surface', {
      get: () => ({
        nodes: [0, 1, 2, 3, 4, 5, 6, 7, 8],
        replaceGeneration: session.replaceGeneration,
        contentGeneration: session.contentGeneration,
      }),
      configurable: true,
    })
    const result = fold(session, store, midWindowSubmission(), engineConfig())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.anomalies.some((a) => a.kind === 'node-missing')).toBe(true)
  })
})

describe('fold-engine: CCM window gate and range view', () => {
  it('gates automatic folding below the CCM legal domain (engine layer)', () => {
    const below = ccmWindowGate(16384)
    expect(below.legal).toBe(false)
    expect(below.note).toContain('below the CCM legal domain')
    expect(ccmWindowGate(CCM_MIN_CONTEXT_WINDOW).legal).toBe(true)
    expect(ccmWindowGate(200000).legal).toBe(true)
    // Unknown window: no claim (honest), tools stay validator-gated.
    expect(ccmWindowGate(undefined).legal).toBe(true)
  })

  it('computes the foldable range map with PROTECTED runs', () => {
    const { session } = seedConversation()
    const store = wiredStore(session)
    const ranges = foldableRanges(store.surfaceNodes(), engineConfig())
    // Surface [0..8]: node 0 (head) protected; node 1 (first user) protected;
    // node 7 (latest user) protected → adjacent protected nodes merge, so the
    // runs are [0..1] prot, [2..6] open, [7] prot, [8] open.
    expect(ranges).toHaveLength(4)
    expect(ranges[0]).toMatchObject({ startSeq: 0, endSeq: 1, protected: true })
    expect(ranges[1]).toMatchObject({ startSeq: 2, endSeq: 6, protected: false })
    expect(ranges[2]).toMatchObject({ startSeq: 7, endSeq: 7, protected: true })
    expect(ranges[3]).toMatchObject({ startSeq: 8, endSeq: 8, protected: false })
    expect(ranges[1].estimatedTokens).toBeGreaterThan(0)
  })

  it('marks the whole surface protected when it fits under the floor', () => {
    const { session } = seedConversation()
    const store = wiredStore(session)
    const ranges = foldableRanges(store.surfaceNodes(), {
      ...engineConfig(),
      protectionFloorTokens: 1_000_000,
    })
    expect(ranges).toHaveLength(1)
    expect(ranges[0].protected).toBe(true)
  })
})

describe('fold-engine: tool-reply renderers', () => {
  it('renders the acceptance reply with reclaimed tokens', () => {
    const { session } = seedConversation()
    const store = wiredStore(session)
    const result = fold(session, store, midWindowSubmission(), engineConfig())
    const reply = renderFoldReply(result)
    expect(reply).toMatch(
      /^Folded seqs 3–5, ~\d+ tokens reclaimed \(1 checkpoint, 0 earlier folds absorbed\)$/,
    )
  })

  it('renders the rejection with every reason line', () => {
    const { session } = seedConversation()
    const store = wiredStore(session)
    const result = fold(session, store, {
      range: { startSeq: 0, endSeq: 5 },
      summaries: [{ startSeq: 0, endSeq: 5, text: 'Everything summarized away.' }],
    }, engineConfig())
    const reply = renderFoldReply(result)
    expect(reply).toContain('fold rejected')
    expect(reply).toContain('system head')
  })

  it('renders the unfold reply with the block count', () => {
    const { session } = seedConversation()
    const store = wiredStore(session)
    expect(fold(session, store, midWindowSubmission(), engineConfig()).ok).toBe(true)
    const result = unfold(session, store, 'f9')
    const reply = renderUnfoldReply('f9', result)
    expect(reply).toContain('Unfolded fold f9')
    expect(reply).toMatch(/one node re-materializing 3 blocks/)
  })
})

describe('fold-engine: usage degradation hooks (S6)', () => {
  it('keeps the store usage snapshot honest across a fold lifecycle', () => {
    const { session } = seedConversation()
    const store = wiredStore(session)
    expect(store.usageSnapshot().measured).toBe(false)
    session.append('assistant/message', msg.assistant('with usage', [], { inputTokens: 100, outputTokens: 10, cacheReadTokens: 900, cacheWriteTokens: 100 }))
    expect(store.usageSnapshot().measured).toBe(true)
    expect(fold(session, store, midWindowSubmission(), engineConfig()).ok).toBe(true)
    expect(store.usageSnapshot().latest?.cacheReadTokens).toBe(900)
  })

  it('layers the CCM gate above the budget structural guard (not a substitute)', () => {
    // The 16384 window computes a full budget (the F1 structural guard does
    // not fire: triggerLine stays positive) while the engine-layer CCM gate
    // rejects it — the two layers are distinct by design.
    const budget = computeBudget({ contextWindow: 16384 })
    expect(budget.triggerLine).toBeGreaterThan(0)
    expect(ccmWindowGate(16384).legal).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// S5 real mode: the genuine @deepseek-ai/dsh-session. Skips with an explicit
// reason when the zDSH-main build is unavailable (no fail-open, no fail-closed
// silence).
// ---------------------------------------------------------------------------

describe('fold-engine: real @deepseek-ai/dsh-session (S5)', async () => {
  const mod = await realSession()

  it.skipIf(mod === null)('commits a fold through the official surface replace channel', async () => {
    const { Session, SessionId } = mod!
    const session = Session.create(SessionId('zctx-w3-real-fold'))
    const store = new FoldStore()
    store.attach(session)
    session.append('system/message', { message: { id: 's0', role: 'system', content: [{ type: 'text', text: 'You are helpful.' }], source: { kind: 'system-prompt' } } }, { surfaceOp: 'append' })
    session.append('user/message', { message: { id: 'u1', role: 'user', content: [{ type: 'text', text: 'List the files.' }], source: { kind: 'user' } } }, { surfaceOp: 'append' })
    session.append('assistant/message', {
      message: {
        id: 'a1',
        role: 'assistant',
        content: [{ type: 'text', text: 'Listing now.' }, { type: 'tool-call', id: 'call-x', name: 'ls', arguments: '{}' }],
        source: { kind: 'model', provider: 'deepseek', model: 'test-model' },
      },
      usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 800, cacheWriteTokens: 100 },
    }, { surfaceOp: 'append' })
    session.append('tool/result', { message: { id: 't1', role: 'tool', toolName: 'ls', toolCallId: 'call-x', content: [{ type: 'text', text: 'a.sql\nb.ts' }], source: { kind: 'tool', callId: 'call-x' } } }, { surfaceOp: 'append' })
    session.append('assistant/message', {
      message: { id: 'a2', role: 'assistant', content: [{ type: 'text', text: 'Two files found.' }], source: { kind: 'model', provider: 'deepseek', model: 'test-model' } },
    }, { surfaceOp: 'append' })
    session.append('user/message', { message: { id: 'u2', role: 'user', content: [{ type: 'text', text: 'Now summarize the schema.' }], source: { kind: 'user' } } }, { surfaceOp: 'append' })
    store.resync()
    expect(store.surfaceNodes().map((n) => n.seq)).toEqual([0, 1, 2, 3, 4, 5])
    expect(store.usageSnapshot().measured).toBe(true)

    const result = fold(session, store, {
      range: { startSeq: 2, endSeq: 3 },
      summaries: [{ startSeq: 2, endSeq: 3, text: 'ls: a.sql, b.ts.' }],
    }, engineConfig())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // Official surface semantics: checkpoint replaces the span; generations advanced.
    expect(session.surface.nodes).toEqual([0, 1, result.committed[0].checkpointSeq, 4, 5])
    expect(session.surface.replaceGeneration).toBe(1)
    expect(session.surface.contentGeneration).toBe(1)
    expect([...store.foldMap.keys()]).toEqual([result.committed[0].foldId])
    // The official session froze the exact source payload.
    const event = session.eventAt(result.committed[0].checkpointSeq)
    const source = (event!.data as { message: { source: Record<string, unknown> } }).message.source
    expect(source.kind).toBe('zctx-fold')
    expect(source.foldId).toBe(result.committed[0].foldId)
  })

  it.skipIf(mod === null)('unfolds in the single-node form through the official channel', async () => {
    const { Session, SessionId } = mod!
    const session = Session.create(SessionId('zctx-w3-real-unfold'))
    const store = new FoldStore()
    store.attach(session)
    // Surface: 0 user, 1 assistant, 2 user, 3 assistant, 4 user, 5 assistant.
    session.append('user/message', { message: { id: 'u1', role: 'user', content: [{ type: 'text', text: 'Plan the migration for me.' }], source: { kind: 'user' } } }, { surfaceOp: 'append' })
    session.append('assistant/message', {
      message: { id: 'a1', role: 'assistant', content: [{ type: 'text', text: 'Here is the plan: inventory, migrate, verify.' }], source: { kind: 'model', provider: 'deepseek', model: 'test-model' } },
    }, { surfaceOp: 'append' })
    session.append('user/message', { message: { id: 'u2', role: 'user', content: [{ type: 'text', text: 'Go ahead.' }], source: { kind: 'user' } } }, { surfaceOp: 'append' })
    session.append('assistant/message', {
      message: { id: 'a2', role: 'assistant', content: [{ type: 'text', text: 'Working on it now.' }], source: { kind: 'model', provider: 'deepseek', model: 'test-model' } },
    }, { surfaceOp: 'append' })
    session.append('user/message', { message: { id: 'u3', role: 'user', content: [{ type: 'text', text: 'How far along are we?' }], source: { kind: 'user' } } }, { surfaceOp: 'append' })
    session.append('assistant/message', {
      message: { id: 'a3', role: 'assistant', content: [{ type: 'text', text: 'Inventory finished.' }], source: { kind: 'model', provider: 'deepseek', model: 'test-model' } },
    }, { surfaceOp: 'append' })
    store.resync()
    // Window [1, 3] avoids node 0 (validator unconditional guard), the first
    // user (node 0) and the latest user (node 4).
    const folded = fold(session, store, {
      range: { startSeq: 1, endSeq: 3 },
      summaries: [{ startSeq: 1, endSeq: 3, text: 'Plan turn: user approved, assistant proceeding.' }],
    }, engineConfig())
    expect(folded.ok).toBe(true)
    if (!folded.ok) return
    const checkpointSeq = folded.committed[0].checkpointSeq
    expect(session.surface.nodes).toEqual([0, checkpointSeq, 4, 5])
    const unfolded = unfold(session, store, folded.committed[0].foldId)
    expect(unfolded.ok).toBe(true)
    if (!unfolded.ok) return
    expect(session.surface.nodes).toEqual([0, unfolded.committed[0].checkpointSeq, 4, 5])
    const event = session.eventAt(unfolded.committed[0].checkpointSeq)!
    const data = event.data as { message: { content: { type: string; text: string }[]; source: Record<string, unknown> } }
    expect(data.message.source.kind).toBe('zctx-unfold')
    // Three original events (assistant, user, assistant) → three text blocks.
    expect(data.message.content.length).toBe(3)
    expect(data.message.content.every((b) => b.type === 'text')).toBe(true)
  })

  it.skipIf(mod === null)('enforces the compaction mutex against the official markers', async () => {
    const { Session, SessionId } = mod!
    const session = Session.create(SessionId('zctx-w3-real-mutex'))
    const store = new FoldStore()
    store.attach(session)
    session.append('user/message', { message: { id: 'u1', role: 'user', content: [{ type: 'text', text: 'Question one for the mutex probe.' }], source: { kind: 'user' } } }, { surfaceOp: 'append' })
    session.append('assistant/message', {
      message: { id: 'a1', role: 'assistant', content: [{ type: 'text', text: 'Answer one, reasonably long enough to fold later.' }], source: { kind: 'model', provider: 'deepseek', model: 'test-model' } },
    }, { surfaceOp: 'append' })
    session.append('user/message', { message: { id: 'u2', role: 'user', content: [{ type: 'text', text: 'Question two for the mutex probe.' }], source: { kind: 'user' } } }, { surfaceOp: 'append' })
    session.append('assistant/message', {
      message: { id: 'a2', role: 'assistant', content: [{ type: 'text', text: 'Answer two for the mutex probe.' }], source: { kind: 'model', provider: 'deepseek', model: 'test-model' } },
    }, { surfaceOp: 'append' })
    session.append('user/message', { message: { id: 'u3', role: 'user', content: [{ type: 'text', text: 'Question three wraps the probe up.' }], source: { kind: 'user' } } }, { surfaceOp: 'append' })
    store.resync()
    session.append('compaction/start', { compactionId: 'c1' })
    store.resync()
    expect(store.compactionActive()).toBe(true)
    const blocked = fold(session, store, {
      range: { startSeq: 1, endSeq: 3 },
      summaries: [{ startSeq: 1, endSeq: 3, text: 'Mutex probe turns condensed.' }],
    }, engineConfig())
    expect(blocked.ok).toBe(false)
    if (!blocked.ok) expect(blocked.reasons[0]).toContain('compaction transaction is active')
    session.append('compaction/end', { compactionId: 'c1', outcome: 'complete' })
    store.resync()
    const allowed = fold(session, store, {
      range: { startSeq: 1, endSeq: 3 },
      summaries: [{ startSeq: 1, endSeq: 3, text: 'Mutex probe turns condensed.' }],
    }, engineConfig())
    expect(allowed.ok).toBe(true)
  })

  it.skipIf(mod === null)('agrees with the official foldSurface replay on the same log (fixture 对拍)', async () => {
    const { Session, SessionId, foldSurface } = mod!
    const session = Session.create(SessionId('zctx-w3-real-foldsurface'))
    const store = new FoldStore()
    store.attach(session)
    session.append('system/message', { message: { id: 's0', role: 'system', content: [{ type: 'text', text: 'You are helpful.' }], source: { kind: 'system-prompt' } } }, { surfaceOp: 'append' })
    session.append('user/message', { message: { id: 'u1', role: 'user', content: [{ type: 'text', text: 'Question one for the replay probe.' }], source: { kind: 'user' } } }, { surfaceOp: 'append' })
    session.append('assistant/message', {
      message: { id: 'a1', role: 'assistant', content: [{ type: 'text', text: 'Answer one for the replay probe with a reasonably long explanation of the schema.' }], source: { kind: 'model', provider: 'deepseek', model: 'test-model' } },
    }, { surfaceOp: 'append' })
    session.append('user/message', { message: { id: 'u2', role: 'user', content: [{ type: 'text', text: 'Question two for the replay probe.' }], source: { kind: 'user' } } }, { surfaceOp: 'append' })
    store.resync()
    const folded = fold(session, store, {
      range: { startSeq: 2, endSeq: 2 },
      summaries: [{ startSeq: 2, endSeq: 2, text: 'The replay turn answer, folded.' }],
    }, engineConfig())
    expect(folded.ok).toBe(true)
    if (!folded.ok) return

    // Replay the COMPLETE log through the official foldSurface and compare.
    const events: SessionEventLike[] = []
    for (let seq = 0; seq < session.seq; seq += 1) events.push(session.eventAt(seq)!)
    const replay = foldSurface(events)
    expect(replay.nodes).toEqual([...session.surface.nodes])
    expect(store.surfaceNodes().map((n) => n.seq)).toEqual([...replay.nodes])
    // Exactly one replacement, matching our commit.
    expect(replay.replacements).toHaveLength(1)
    const replacement = replay.replacements[0] as { seq: number; shadowedSeqs: number[] }
    expect(replacement.seq).toBe(folded.committed[0].checkpointSeq)
    expect(replacement.shadowedSeqs).toEqual([2])
  })
})
