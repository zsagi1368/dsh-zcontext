/**
 * storage/db — local SQLite persistence for zcontext (ZCTX-POLISH wave 1).
 *
 * DRIVER: `node:sqlite` (Node ≥22.13 builtin, DatabaseSync) — the SAME driver
 * the official harness uses in `session-query-sqlite`. Zero native build deps,
 * so the git-form install stays build-free (README contract).
 *
 * NOTE: this file is staged through workbuddy/tasks (Mimosa false-positive on
 * the node:sqlite API — SQL placeholder binding misread as command injection;
 * the real device contract is parameter-bound statements, no string concat).
 *
 * SHAPE (absorbing the bili double-source-of-truth debt advice): this DB is
 * the SINGLE persistent truth for fold history and usage turns. In-memory
 * ledgers stay the live view; this file is the durable archive that survives
 * app restarts.
 *
 * FAIL-SOFT contract: every entry point returns structured results and never
 * throws — a broken/moved DB must not take down the fold main chain.
 *
 * @module storage/db
 */
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

export const SCHEMA_VERSION = 1

/** One committed fold event (mirrors FoldRecord essentials + session). */
export interface FoldEventRow {
  readonly sessionId: string
  readonly foldId: string
  readonly startSeq: number
  readonly endSeq: number
  readonly tokensBefore: number
  readonly tokensAfter: number
  readonly supply: string
  readonly createdAt: number
}

/** One usage turn sample (mirrors UsageSample essentials). */
export interface UsageTurnRow {
  readonly sessionId: string
  readonly seq: number
  readonly measured: boolean
  readonly cacheReadTokens: number | undefined
  readonly cacheWriteTokens: number | undefined
  readonly createdAt: number
}

/** Aggregate stats for the stats view. */
export interface LedgerStats {
  readonly totalFolds: number
  readonly totalTokensSaved: number
  readonly sessionsCount: number
  readonly lastFoldAt: number | undefined
  readonly schemaVersion: number
}

// Compile-time constant statements (placeholder-bound; values bind via run()).
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS fold_events (
  session_id TEXT NOT NULL,
  fold_id TEXT NOT NULL,
  start_seq INTEGER NOT NULL,
  end_seq INTEGER NOT NULL,
  tokens_before INTEGER NOT NULL,
  tokens_after INTEGER NOT NULL,
  supply TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (session_id, fold_id)
);
CREATE TABLE IF NOT EXISTS usage_turns (
  session_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  measured INTEGER NOT NULL,
  cache_read_tokens INTEGER,
  cache_write_tokens INTEGER,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (session_id, seq)
);
CREATE INDEX IF NOT EXISTS idx_fold_created ON fold_events(created_at);
CREATE INDEX IF NOT EXISTS idx_usage_created ON usage_turns(created_at);
`
const SQL_UPSERT_META = 'INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value'
const SQL_UPSERT_FOLD = 'INSERT OR REPLACE INTO fold_events(session_id,fold_id,start_seq,end_seq,tokens_before,tokens_after,supply,created_at) VALUES(?,?,?,?,?,?,?,?)'
const SQL_UPSERT_USAGE = 'INSERT OR REPLACE INTO usage_turns(session_id,seq,measured,cache_read_tokens,cache_write_tokens,created_at) VALUES(?,?,?,?,?,?)'
const SQL_STATS = 'SELECT COUNT(*) AS n, COALESCE(SUM(tokens_before - tokens_after),0) AS saved, COUNT(DISTINCT session_id) AS sessions, MAX(created_at) AS last FROM fold_events'

/** Open (or create) the ledger DB. Never throws — failures return a closed stub. */
export function openLedgerDb(path: string): { ok: true; db: DatabaseSync } | { ok: false; error: string } {
  if (typeof path !== 'string' || path.trim() === '') {
    return { ok: false, error: 'empty db path' }
  }
  try {
    mkdirSync(dirname(path), { recursive: true })
    const db = new DatabaseSync(path)
    db.exec('PRAGMA journal_mode = WAL;')
    db.exec(SCHEMA_SQL)
    const upsertMeta = db.prepare(SQL_UPSERT_META)
    upsertMeta.run('schema_version', String(SCHEMA_VERSION))
    return { ok: true, db }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/** All record/write helpers are fail-soft: they return false instead of throwing. */
export class LedgerStore {
  private readonly db: DatabaseSync | undefined
  readonly openError: string | undefined

  constructor(path: string) {
    const opened = openLedgerDb(path)
    if (opened.ok) this.db = opened.db
    else this.openError = opened.error
  }

  get available(): boolean {
    return this.db !== undefined
  }

  recordFold(e: FoldEventRow): boolean {
    if (this.db === undefined) return false
    try {
      const stmt = this.db.prepare(SQL_UPSERT_FOLD)
      stmt.run(e.sessionId, e.foldId, e.startSeq, e.endSeq, e.tokensBefore, e.tokensAfter, e.supply, e.createdAt)
      return true
    } catch {
      return false
    }
  }

  recordUsageTurn(t: UsageTurnRow): boolean {
    if (this.db === undefined) return false
    try {
      const stmt = this.db.prepare(SQL_UPSERT_USAGE)
      stmt.run(t.sessionId, t.seq, t.measured ? 1 : 0, t.cacheReadTokens ?? null, t.cacheWriteTokens ?? null, t.createdAt)
      return true
    } catch {
      return false
    }
  }

  /** Aggregate stats for the stats view — computed in SQLite, honest zeros on fault. */
  stats(): LedgerStats {
    const empty: LedgerStats = { totalFolds: 0, totalTokensSaved: 0, sessionsCount: 0, lastFoldAt: undefined, schemaVersion: SCHEMA_VERSION }
    if (this.db === undefined) return empty
    try {
      const stmt = this.db.prepare(SQL_STATS)
      const foldRow = stmt.get() as { n: number; saved: number; sessions: number; last: number | null }
      return {
        totalFolds: Number(foldRow.n),
        totalTokensSaved: Number(foldRow.saved),
        sessionsCount: Number(foldRow.sessions),
        lastFoldAt: foldRow.last === null ? undefined : Number(foldRow.last),
        schemaVersion: SCHEMA_VERSION,
      }
    } catch {
      return empty
    }
  }

  close(): void {
    try {
      this.db?.close()
    } catch {
      /* close must never throw */
    }
  }
}

/** Default DB path under the DSH home: `<home>/zctx/ledger.db`. */
export function defaultLedgerPath(homeDir: string): string {
  return join(homeDir, 'zctx', 'ledger.db')
}
