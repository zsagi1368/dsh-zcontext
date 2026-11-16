// P6-D stats: read summaries/<key>.jsonl files, emit per-session curves and
// per-group aggregates. No fabrication: missing fields stay missing.
// Usage: node stats.mjs <key>...  (or --all)
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const HOME = 'C:/Users/ZS/AppData/Local/Temp/zctx-bench-home'
const SUM = join(HOME, 'summaries')
const args = process.argv.slice(2)
const keys = args.includes('--all')
  ? readdirSync(SUM).filter(f => f.endsWith('.jsonl')).map(f => f.replace(/\.jsonl$/, ''))
  : args

const pct = (arr, p) => {
  if (arr.length === 0) return null
  const s = [...arr].sort((a, b) => a - b)
  const idx = Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)
  return s[Math.max(0, idx)]
}

for (const key of keys) {
  const path = join(SUM, `${key}.jsonl`)
  if (!existsSync(path)) { console.log(`[${key}] MISSING`); continue }
  const rows = readFileSync(path, 'utf8').trim().split('\n').map(JSON.parse)
  const ok = rows.filter(r => r.exitCode === 0)
  const failed = rows.filter(r => r.exitCode !== 0)
  const billed = ok.map(r => r.billedInput)
  const hitRates = ok.map(r => (r.usage.cacheRead + r.usage.cacheWrite) > 0 || r.billedInput > 0
    ? (r.usage.cacheRead || 0) / Math.max(1, r.billedInput) : null).filter(v => v !== null)
  const foldTurns = ok.filter(r => (r.toolCounts.zctx_fold || 0) > 0)
  const totalFolds = ok.reduce((a, r) => a + (r.toolCounts.zctx_fold || 0), 0)
  const group = rows[0]?.group
  console.log(`=== ${key} (group ${group}) ===`)
  console.log(`turns ok/total: ${ok.length}/${rows.length}${failed.length ? ` FAILED at turns ${failed.map(f => f.turn).join(',')}` : ''}`)
  console.log(`per-turn billedInput: n=${billed.length} p50=${pct(billed, 50)} p95=${pct(billed, 95)} min=${Math.min(...billed)} max=${Math.max(...billed)}`)
  console.log(`cumulative billedInput: ${billed.reduce((a, b) => a + b, 0)}`)
  console.log(`cache hit rate (cacheRead/billed): mean=${hitRates.length ? (hitRates.reduce((a, b) => a + b, 0) / hitRates.length).toFixed(3) : 'n/a'} turn-wise=${hitRates.map(v => v.toFixed(2)).join(',') || 'n/a'}`)
  console.log(`cacheWrite seen anywhere: ${ok.some(r => r.usage.cacheWrite > 0)}`)
  console.log(`fold turns: ${foldTurns.length}/${ok.length} total fold calls: ${totalFolds}`)
  if (foldTurns.length) {
    for (const r of foldTurns) console.log(`  fold@turn${r.turn}: ${JSON.stringify(r.foldCalls).slice(0, 300)}`)
  }
  console.log(`curve (turn:billed, hit%): ${ok.map(r => `${r.turn}:${r.billedInput}${r.billedInput ? ':' + (((r.usage.cacheRead || 0) / r.billedInput) * 100).toFixed(0) + '%' : ''}`).join(' ')}`)
}
