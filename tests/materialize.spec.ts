import { describe, expect, it } from 'vitest'

import { materializeRange } from '../src/materialize.ts'
import type { FoldMap, FoldRecord, MaterializeAccessor, SessionEventLike } from '../src/types.ts'

/**
 * Fixture log spanning seqs 0..8 with every event class the materializer
 * must distinguish: message events of all roles, a tool result with its tool
 * name, log-only events, an active fold checkpoint, and a readable gap.
 */
function fixtureLog(): Map<number, SessionEventLike> {
  const log = new Map<number, SessionEventLike>()
  const ev = (seq: number, type: string, data: unknown, extra: Partial<SessionEventLike> = {}): void => {
    log.set(seq, { seq, type, data, ...extra })
  }
  ev(0, 'system/message', { message: { role: 'system', content: [{ type: 'text', text: 'You are helpful.' }] } })
  ev(1, 'user/message', { turn: 1, message: { role: 'user', content: [{ type: 'text', text: 'Plan the migration.' }] } })
  ev(2, 'assistant/message', {
    message: {
      role: 'assistant',
      content: [
        { type: 'text', text: 'Starting the analysis.' },
        { type: 'tool-call', id: 'call-x', name: 'run_shell' },
        { type: 'text', text: 'One command needed.' },
      ],
    },
  })
  ev(3, 'tool/result', {
    message: {
      role: 'tool',
      toolName: 'run_shell',
      toolCallId: 'call-x',
      content: [{ type: 'text', text: 'exit 0, 12 files moved' }],
    },
  })
  ev(4, 'compaction/start', { requestedBy: 'test' })
  ev(5, 'user/message', {
    message: {
      role: 'user',
      content: [
        { type: 'text', text: 'See the attached diagram.' },
        { type: 'image', source: 'inline' },
      ],
    },
  })
  // seq 6 = active fold checkpoint (fold f1)
  ev(6, 'user/message', {
    message: { role: 'user', content: [{ type: 'text', text: 'Old summary: migration planned.' }] },
  })
  // seq 7 intentionally missing (unreadable gap)
  ev(8, 'session/end-seed', { inherited: true })
  return log
}

function fixtureAccessor(log: Map<number, SessionEventLike>): MaterializeAccessor {
  return { eventAt: (seq: number) => log.get(seq) }
}

function fixtureFoldMap(): FoldMap {
  const record: FoldRecord = {
    foldId: 'f1',
    startSeq: 0,
    endSeq: 5,
    checkpointSeq: 6,
    summaryText: 'Old summary: migration planned.',
    shadowedSeqs: [0, 1, 2, 3, 5],
    tokensBefore: 12000,
    tokensAfter: 300,
  }
  return new Map([['f1', record]])
}

describe('materialize: single-node multi-block form (B1)', () => {
  it('produces one text block per message event, in seq order', () => {
    const blocks = materializeRange(fixtureAccessor(fixtureLog()), fixtureFoldMap(), 0, 8)
    // seqs 0,1,2,3,5,6,7 → 7 blocks (4 and 8 are log-only; 7 is a gap block)
    expect(blocks).toHaveLength(7)
    expect(blocks.every((b) => b.type === 'text')).toBe(true)
    expect(blocks[0].text).toBe('[system]\nYou are helpful.')
    expect(blocks[1].text).toBe('[user]\nPlan the migration.')
    expect(blocks[2].text).toBe('[assistant]\nStarting the analysis.\nOne command needed.')
    expect(blocks[3].text).toBe('[tool run_shell]\nexit 0, 12 files moved\n(tool result quoted verbatim from the session log)')
    expect(blocks[4].text).toBe('[user]\nSee the attached diagram.')
    expect(blocks[5].text).toBe('[folded block f1]\nOld summary: migration planned.')
    expect(blocks[6].text).toBe('[unavailable event at seq 7]')
  })

  it('renders tool blocks without a known name via the call id and skips unrecognized event types', () => {
    const log = fixtureLog()
    const noName = log.get(3)
    if (noName !== undefined) {
      const message = (noName.data as { message: Record<string, unknown> }).message
      delete message.toolName
    }
    log.set(9, { seq: 9, type: 'weird/event', data: { message: { content: [{ type: 'text', text: '?' }] } } })
    const blocks = materializeRange(fixtureAccessor(log), new Map(), 3, 9)
    // seqs 3 (tool), 5 (user), 6 (user, no ledger), 7 (gap); 4/8 log-only and
    // 9 unrecognized → skipped.
    expect(blocks).toHaveLength(4)
    expect(blocks[0].text.startsWith('[tool (call call-x)]')).toBe(true)
    expect(blocks[2].text).toBe('[user]\nOld summary: migration planned.')
    expect(blocks[3].text).toBe('[unavailable event at seq 7]')
  })

  it('marks messages without any text content instead of dropping them silently', () => {
    const log = new Map<number, SessionEventLike>([
      [4, { seq: 4, type: 'user/message', data: { message: { role: 'user', content: [{ type: 'image', source: 'inline' }] } } }],
    ])
    const blocks = materializeRange(fixtureAccessor(log), new Map(), 4, 4)
    expect(blocks).toEqual([{ type: 'text', text: '[user]\n(no text content)' }])
  })

  it('tolerates string content payloads directly on the event data', () => {
    const log = new Map<number, SessionEventLike>([
      [2, { seq: 2, type: 'assistant/message', data: { content: 'plain string body' } }],
    ])
    const blocks = materializeRange(fixtureAccessor(log), new Map(), 2, 2)
    expect(blocks).toEqual([{ type: 'text', text: '[assistant]\nplain string body' }])
  })
})

describe('materialize: one-layer nested checkpoint expansion', () => {
  it('expands an active checkpoint to its own text only (never the original span)', () => {
    const blocks = materializeRange(fixtureAccessor(fixtureLog()), fixtureFoldMap(), 0, 6)
    const folded = blocks[5]
    expect(folded.text.startsWith('[folded block f1]')).toBe(true)
    expect(folded.text).toContain('Old summary: migration planned.')
    // One layer: the checkpoint's ORIGINAL content (seqs 0..5 originals) is
    // not re-materialized inside this block.
    expect(folded.text).not.toContain('Plan the migration.')
    expect(folded.text).not.toContain('Starting the analysis.')
  })

  it('treats a stale checkpoint source outside the ledger as a plain user message', () => {
    const blocks = materializeRange(fixtureAccessor(fixtureLog()), new Map(), 6, 6)
    expect(blocks).toEqual([{ type: 'text', text: '[user]\nOld summary: migration planned.' }])
  })

  it('expands two nested checkpoints each to their own marker', () => {
    const log = fixtureLog()
    const foldMap: FoldMap = new Map([
      ['f1', { ...({ checkpointSeq: 6, foldId: 'f1' } as FoldRecord) }],
      ['f2', { ...({ checkpointSeq: 1, foldId: 'f2' } as FoldRecord) }],
    ])
    const blocks = materializeRange(fixtureAccessor(log), foldMap, 0, 8)
    expect(blocks[1].text.startsWith('[folded block f2]')).toBe(true)
    expect(blocks[5].text.startsWith('[folded block f1]')).toBe(true)
  })
})

describe('materialize: span and input validation', () => {
  it('returns an empty list for a span holding only log-only events', () => {
    // seq 4 is 'compaction/start' — a log-only event produces no block.
    expect(materializeRange(fixtureAccessor(fixtureLog()), new Map(), 4, 4)).toEqual([])
  })

  it('throws TypeError on inverted spans, bad seqs, and malformed inputs', () => {
    expect(() => materializeRange(fixtureAccessor(fixtureLog()), new Map(), 5, 4)).toThrow(TypeError)
    expect(() => materializeRange(fixtureAccessor(fixtureLog()), new Map(), -1, 4)).toThrow(TypeError)
    expect(() => materializeRange(fixtureAccessor(fixtureLog()), new Map(), 1.5, 4)).toThrow(TypeError)
    expect(() => materializeRange({ eventAt: 'no' as unknown as () => undefined }, new Map(), 0, 4)).toThrow(TypeError)
    expect(() =>
      materializeRange(fixtureAccessor(fixtureLog()), {} as unknown as FoldMap, 0, 4),
    ).toThrow(TypeError)
  })
})
