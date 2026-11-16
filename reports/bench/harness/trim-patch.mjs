// Trim MCP + web-search rows from the bench clone's patch layer.
// Rationale (recorded in BENCH-report): headless benchmark runs must not spawn
// external MCP processes or call external search APIs on every turn; the
// treatment variable is dsh-zcontext only. All other rows stay byte-identical
// to the desktop clone.
import { readFileSync, writeFileSync } from 'node:fs'

const path = 'C:/Users/ZS/AppData/Local/Temp/zctx-bench-home/profiles/bench/cordis.patch.yml'
const src = readFileSync(path, 'utf8')
const lines = src.split('\n')
const DROP_PREFIXES = ['- id: magpie-mcp-', '- id: web-search-deepseek']
const out = []
let skipping = false
let dropped = []
for (const line of lines) {
  const isTopLevel = /^- id: /.test(line)
  if (isTopLevel) {
    skipping = DROP_PREFIXES.some(p => line.startsWith(p))
    if (skipping) dropped.push(line.trim())
  }
  if (!skipping) out.push(line)
}
// Collapse runs of >1 blank line left by removals.
const collapsed = []
let blanks = 0
for (const line of out) {
  if (line.trim() === '') { blanks++; if (blanks > 1) continue } else blanks = 0
  collapsed.push(line)
}
writeFileSync(path, collapsed.join('\n'))
console.log('dropped rows:', JSON.stringify(dropped))
console.log('lines:', lines.length, '->', collapsed.length)
