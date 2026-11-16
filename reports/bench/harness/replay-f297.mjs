// Offline replay of the P6-E server-initiated fold commit f297 (P6D2E-R2:
// archived from the P6-D2E review wave; originally written by the independent
// reviewer as replay-select.mjs in the review temp dir, REVIEW-P6D2E §1.8 —
// the reviewer reproduced the runtime selection verbatim with this script,
// independent of the author's code path).
//
// Rebuilds the pre-fold surface from the archived session log and runs
// selectFoldSpans exactly as the runtime chain did:
//   expected pre-fold surface  = 80 nodes / 12769 estimated tokens
//   expected unique selection  = [{startSeq:9, endSeq:202, foldedTokens:5471}]
//   expected post-fold surface = 0 candidates (coverage boundary, W3-2)
//
// Run: node reports/bench/harness/replay-f297.mjs
import { readFileSync } from 'node:fs'
import { FoldStore } from '../../../src/store.ts'
import { selectFoldSpans } from '../../../src/autofold.ts'

const LOG = new URL('../raw/p6e-autofold-session-e98c4f6f.jsonl', import.meta.url)
const events = []
for (const line of readFileSync(LOG, 'utf-8').split(/\r?\n/)) {
  if (!line.trim()) continue
  events.push(JSON.parse(line))
}
const bySeq = new Map(events.map((e) => [e.seq, e]))
const FOLD_SEQ = 297
// Pre-fold view: events strictly below the fold commit seq.
const pre = new Map([...bySeq.entries()].filter(([seq]) => seq < FOLD_SEQ))
const session = { seq: FOLD_SEQ, eventAt: (seq) => pre.get(seq) }

const store = new FoldStore()
store.attach(session)
store.resync()

const nodes = store.surfaceNodes()
const totalTokens = nodes.reduce((s, n) => s + n.estimatedTokens, 0)
console.log('surface nodes:', nodes.length, 'total estimated tokens:', totalTokens)

const config = {
  keepRecentMessages: 0,
  keepRecentTokens: 0,
  protectionFloorTokens: 5000,
  minFoldableTokens: 5000,
  maxFoldFraction: 0.6,
  summaryFloorChars: 50,
  summaryCeilingChars: 20000,
  netShrinkTolerance: 1.05,
}
const spans = selectFoldSpans({ surfaceNodes: nodes, config, maxBatch: 4, window: 40000 })
console.log('selected spans:', JSON.stringify(spans))
console.log('EXPECT: [{startSeq:9,endSeq:202,foldedTokens:5471}]')
console.log(
  'MATCH:',
  spans.length === 1 && spans[0].startSeq === 9 && spans[0].endSeq === 202 && spans[0].foldedTokens === 5471,
)
// Post-fold sanity: the archived log's post-fold surface (events after 297)
const post = new Map([...bySeq.entries()])
const sessionPost = { seq: 493, eventAt: (seq) => post.get(seq) }
const storePost = new FoldStore()
storePost.attach(sessionPost)
storePost.resync()
const nodesPost = storePost.surfaceNodes()
const spansPost = selectFoldSpans({ surfaceNodes: nodesPost, config, maxBatch: 4, window: 40000 })
console.log('post-fold surface nodes:', nodesPost.length, 'spans:', JSON.stringify(spansPost), '(expect [] — coverage boundary)')
