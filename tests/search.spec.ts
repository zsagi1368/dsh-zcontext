import { describe, expect, it } from 'vitest'

import { DEFAULT_RECALL_LIMIT, EXCERPT_CONTEXT_CHARS, recall } from '../src/search.ts'
import type { RecallEntry } from '../src/types.ts'

function entry(partial: Partial<RecallEntry> & { text: string }): RecallEntry {
  return {
    foldId: 'f1',
    kind: 'summary',
    range: { startSeq: 3, endSeq: 9 },
    ...partial,
  }
}

describe('search: recall scoring', () => {
  it('finds a single keyword case-insensitively and excerpts ±120 chars', () => {
    const corpus = [entry({ text: 'The DATABASE layer was migrated to postgres 16 without downtime.' })]
    const hits = recall('database', corpus)
    expect(hits).toHaveLength(1)
    expect(hits[0].foldId).toBe('f1')
    expect(hits[0].excerpt).toBe(corpus[0].text)
    expect(hits[0].score).toBeGreaterThan(0)
  })

  it('ranks all-terms (AND) matches above partial (OR) matches', () => {
    const corpus = [
      entry({ foldId: 'only-a', text: 'alpha mentioned in passing' }),
      entry({ foldId: 'both', text: 'alpha and beta decided' }),
      entry({ foldId: 'only-b', text: 'beta details recorded' }),
    ]
    const hits = recall('alpha beta', corpus)
    expect(hits).toHaveLength(3)
    expect(hits[0].foldId).toBe('both')
    // Both AND hits come before every OR hit; the ORs tie-break deterministically.
    expect(hits[1].foldId).toBe('only-a')
    expect(hits[2].foldId).toBe('only-b')
  })

  it('weights repeated occurrences and distinct terms into the score', () => {
    const corpus = [
      entry({ foldId: 'sparse', text: 'token once' }),
      entry({ foldId: 'dense', text: 'token token token budget' }),
    ]
    const hits = recall('token', corpus)
    expect(hits[0].foldId).toBe('dense')
    expect(hits[0].score).toBeGreaterThan(hits[1].score)
  })

  it('returns nothing when no term matches or the query is empty', () => {
    const corpus = [entry({ text: 'nothing relevant here' })]
    expect(recall('zzz', corpus)).toEqual([])
    expect(recall('', corpus)).toEqual([])
    expect(recall('   ', corpus)).toEqual([])
  })

  it('truncates to the requested limit (default 5)', () => {
    const corpus = Array.from({ length: 8 }, (_, i) =>
      entry({ foldId: `f${i}`, text: `report number ${i}` }),
    )
    expect(DEFAULT_RECALL_LIMIT).toBe(5)
    expect(recall('report', corpus)).toHaveLength(5)
    expect(recall('report', corpus, 3)).toHaveLength(3)
    expect(recall('report', corpus, 0)).toEqual([])
  })

  it('cuts long excerpts with ellipses at both boundaries', () => {
    const filler = 'a'.repeat(EXCERPT_CONTEXT_CHARS + 50)
    const corpus = [entry({ text: `${filler}needle${filler}` })]
    const hits = recall('needle', corpus)
    // ±120 chars around the hit POSITION: needle (6 chars) starts at 170, so
    // the excerpt carries 120 a's before it and 114 after it.
    const expected = `…${'a'.repeat(EXCERPT_CONTEXT_CHARS)}needle${'a'.repeat(EXCERPT_CONTEXT_CHARS - 6)}…`
    expect(hits[0].excerpt).toBe(expected)
  })

  it('is deterministic: identical inputs produce identical output', () => {
    const corpus = [
      entry({ foldId: 'x', kind: 'original', range: { startSeq: 5, endSeq: 9 }, text: 'kubernetes rollout' }),
      entry({ foldId: 'y', kind: 'summary', range: { startSeq: 5, endSeq: 9 }, text: 'kubernetes rollout' }),
      entry({ foldId: 'z', range: { startSeq: 2, endSeq: 4 }, text: 'kubernetes rollout' }),
    ]
    const a = recall('kubernetes', corpus)
    const b = recall('kubernetes', corpus)
    expect(a).toEqual(b)
    // Same score → lower startSeq first; full tie → kind asc ('original' < 'summary').
    expect(a[0].foldId).toBe('z')
    expect(a[1].foldId).toBe('x')
    expect(a[2].foldId).toBe('y')
  })

  it('throws TypeError on malformed input', () => {
    expect(() => recall(42 as unknown as string, [])).toThrow(TypeError)
    expect(() => recall('ok', 'nope' as unknown as RecallEntry[])).toThrow(TypeError)
    expect(() => recall('ok', [], 1.5)).toThrow(TypeError)
    expect(() => recall('ok', [], -1)).toThrow(TypeError)
    expect(() => recall('ok', [{ ...entry({ text: 'fine' }), text: undefined as unknown as string }])).toThrow(
      TypeError,
    )
  })
})
