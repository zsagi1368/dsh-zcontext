// Second trim pass for the bench clone patch layer:
// 1. drop the trailing `- insert:` block (magpie MCP rows; contains an inline
//    bearer token that must not live in the bench copy),
// 2. drop top-level rows whose target ids do not exist in the headless
//    composition (ui-* / locale / agent-preset-registry / better-sidebar) to
//    silence not-found warnings.
import { readFileSync, writeFileSync } from 'node:fs'

const path = 'C:/Users/ZS/AppData/Local/Temp/zctx-bench-home/profiles/bench/cordis.patch.yml'
const src = readFileSync(path, 'utf8')
const lines = src.split('\n')
// 1. cut from the `- insert:` line to EOF
const insertIdx = lines.findIndex(l => l.trim() === '- insert:')
if (insertIdx < 0) throw new Error('insert block not found')
const head = lines.slice(0, insertIdx)
// 2. drop not-found rows (top-level `- id:` blocks)
const DROP_IDS = new Set(['ui-settings-account', 'ui-chat', 'ui-settings', 'agent-preset-registry', 'locale', 'ui-conversation', 'better-sidebar'])
const out = []
let skipping = false
const dropped = []
for (const line of head) {
  if (/^- id: /.test(line)) {
    const id = line.slice('- id: '.length).trim()
    skipping = DROP_IDS.has(id)
    if (skipping) dropped.push(id)
  }
  if (!skipping) out.push(line)
}
writeFileSync(path, out.join('\n'))
console.log('cut insert block at line', insertIdx + 1)
console.log('dropped rows:', JSON.stringify(dropped))
console.log('remaining top-level rows:')
for (const line of out) if (/^- id: /.test(line)) console.log(' ', line.trim())
