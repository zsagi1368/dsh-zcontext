/**
 * Recall — keyword search over the fold corpus (summaries + folded-away
 * originals; the session log keeps shadowed events forever, options.md §2
 * 方案甲 1). Scoring per task card W2 §4: case-insensitive, multi-word AND
 * ranks above single-term (OR) matches, excerpt = ±120 chars around the
 * earliest hit, deterministic ordering, top-N return.
 *
 * Zero host imports; pure function of (query, corpus, limit).
 *
 * @module search
 */

import { RECALL_EXCERPT_ELLIPSIS } from './texts.ts'
import type { RecallEntry, RecallHit } from './types.ts'

/** Context radius of the excerpt around the earliest hit. */
export const EXCERPT_CONTEXT_CHARS = 120

/** Default number of returned hits. */
export const DEFAULT_RECALL_LIMIT = 5

/** And-rank bonus lifting all-terms matches above partial matches. */
const AND_BONUS = 1_000_000

/** Per-distinct-term weight. */
const TERM_WEIGHT = 1_000

/**
 * Recall the corpus entries matching the query keywords.
 *
 * @param query - whitespace-separated keywords (case-insensitive).
 * @param corpus - summaries + folded original entries.
 * @param limit - maximum hits returned (default 5).
 */
export function recall(
  query: string,
  corpus: readonly RecallEntry[],
  limit: number = DEFAULT_RECALL_LIMIT,
): RecallHit[] {
  if (typeof query !== 'string') throw new TypeError('recall: query must be a string')
  if (!Array.isArray(corpus)) throw new TypeError('recall: corpus must be an array')
  if (!Number.isFinite(limit) || !Number.isInteger(limit) || limit < 0) {
    throw new TypeError('recall: limit must be a non-negative integer')
  }

  const terms = [...new Set(query.toLowerCase().split(/\s+/).filter((t) => t.length > 0))]
  if (terms.length === 0) return []

  const hits: RecallHit[] = []
  for (const entry of corpus) {
    if (entry === null || typeof entry !== 'object' || typeof entry.text !== 'string') {
      throw new TypeError('recall: corpus entries must expose a text string')
    }
    const lower = entry.text.toLowerCase()
    let distinct = 0
    let occurrences = 0
    let firstPos = -1
    for (const term of terms) {
      const count = countOccurrences(lower, term)
      if (count === 0) continue
      distinct += 1
      occurrences += count
      const pos = lower.indexOf(term)
      if (firstPos === -1 || pos < firstPos) firstPos = pos
    }
    if (distinct === 0) continue
    const isAnd = distinct === terms.length
    const score = (isAnd ? AND_BONUS : 0) + distinct * TERM_WEIGHT + occurrences
    hits.push({
      foldId: entry.foldId,
      kind: entry.kind,
      text: entry.text,
      range: entry.range,
      score,
      excerpt: buildExcerpt(entry.text, firstPos),
    })
  }

  // Deterministic ordering: score desc, then range/kind/fold identity.
  hits.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    if (a.range.startSeq !== b.range.startSeq) return a.range.startSeq - b.range.startSeq
    if (a.range.endSeq !== b.range.endSeq) return a.range.endSeq - b.range.endSeq
    if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1
    return a.foldId < b.foldId ? -1 : a.foldId > b.foldId ? 1 : 0
  })
  return hits.slice(0, limit)
}

/** Occurrence count of `needle` in `haystack` (non-overlapping). @internal */
function countOccurrences(haystack: string, needle: string): number {
  let count = 0
  let pos = haystack.indexOf(needle)
  while (pos !== -1) {
    count += 1
    pos = haystack.indexOf(needle, pos + needle.length)
  }
  return count
}

/** ±120-char excerpt around `pos`, ellipsized where cut. @internal */
function buildExcerpt(text: string, pos: number): string {
  const start = Math.max(0, pos - EXCERPT_CONTEXT_CHARS)
  const end = Math.min(text.length, pos + EXCERPT_CONTEXT_CHARS)
  const body = text.slice(start, end)
  const head = start > 0 ? RECALL_EXCERPT_ELLIPSIS : ''
  const tail = end < text.length ? RECALL_EXCERPT_ELLIPSIS : ''
  return `${head}${body}${tail}`
}
