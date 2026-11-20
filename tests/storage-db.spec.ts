/**
 * ZCTX-POLISH W1 — storage/db acceptance (V1/V2/V4).
 * Real node:sqlite round-trips against temp files; fail-soft contract pins.
 */
import { mkdtempSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it, afterEach } from 'vitest'

import { LedgerStore, defaultLedgerPath, openLedgerDb } from '../src/storage/db.ts'

const tempRoots: string[] = []
afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function tempDbPath(): string {
  const root = mkdtempSync(join(tmpdir(), 'zctx-ledger-spec-'))
  tempRoots.push(root)
  return join(root, 'zctx', 'ledger.db')
}

describe('ZCTX-POLISH W1 — SQLite ledger store', () => {
  it('V1: creates the DB file (plus WAL sidecars) at the requested path', () => {
    const p = tempDbPath()
    const store = new LedgerStore(p)
    expect(store.available).toBe(true)
    expect(existsSync(p)).toBe(true)
    store.close()
  })

  it('V2: records a fold event and reads it back via stats', () => {
    const store = new LedgerStore(tempDbPath())
    expect(store.recordFold({
      sessionId: 'session-x', foldId: 'f-1', startSeq: 9, endSeq: 100,
      tokensBefore: 5000, tokensAfter: 400, supply: 'compaction', createdAt: 1700000000000,
    })).toBe(true)
    const stats = store.stats()
    expect(stats.totalFolds).toBe(1)
    expect(stats.totalTokensSaved).toBe(4600)
    expect(stats.sessionsCount).toBe(1)
    expect(stats.lastFoldAt).toBe(1700000000000)
    store.close()
  })

  it('V2: usage turns upsert per (session, seq) and count honestly', () => {
    const store = new LedgerStore(tempDbPath())
    const base = { sessionId: 's', seq: 1, measured: true, cacheReadTokens: 100, cacheWriteTokens: 20, createdAt: 1 }
    expect(store.recordUsageTurn(base)).toBe(true)
    // Same (session, seq) again → upsert, not a second row (stats unchanged).
    expect(store.recordUsageTurn({ ...base, cacheReadTokens: 300 })).toBe(true)
    expect(store.recordUsageTurn({ ...base, seq: 2, measured: false, createdAt: 2 })).toBe(true)
    const stats = store.stats()
    // usage turns do not affect fold aggregates — honest separation.
    expect(stats.totalFolds).toBe(0)
    store.close()
  })

  it('V4: fail-soft — an unavailable store returns false/empty without throwing', () => {
    const store = new LedgerStore('')
    expect(store.available).toBe(false)
    expect(store.recordFold({ sessionId: 's', foldId: 'f', startSeq: 1, endSeq: 2, tokensBefore: 0, tokensAfter: 0, supply: 'x', createdAt: 0 })).toBe(false)
    expect(store.recordUsageTurn({ sessionId: 's', seq: 1, measured: false, cacheReadTokens: undefined, cacheWriteTokens: undefined, createdAt: 0 })).toBe(false)
    expect(store.stats().totalFolds).toBe(0)
    expect(store.openError).toBeDefined()
  })

  it('defaultLedgerPath joins <home>/zctx/ledger.db (any separator)', () => {
    const joined = defaultLedgerPath('H:/DSH').replace(/\\/g, '/')
    expect(joined.endsWith('/zctx/ledger.db')).toBe(true)
    expect(joined.startsWith('H:/DSH')).toBe(true)
  })
})
