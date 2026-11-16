// P6-E pilot arming: configure the bench profile for the autofold pressure
// arm (C2-style instrumented window + autofold.enabled=true).
//
// Z29 discipline (P6-D2 root cause): NO sticky regexes and NO naive dump
// verification — every mutation is an exact-line operation inside a bounded
// window, and the verification parses the dump-config output STRUCTURALLY
// (the dump renders `- id:` / `  name:` / `  config:` / `    key: value`, so
// a checker must scan the id's BLOCK, not match adjacent lines).
//
// Usage: node arm-autofold.mjs <arm|disarm>
//   arm    — insert the zctx config block + cap the model window to 40000
//   disarm — remove the zctx config block + restore the declared window
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const HOME = 'C:/Users/ZS/AppData/Local/Temp/zctx-bench-home'
const PROFILE = join(HOME, 'profiles', 'bench')
const PATCH = join(PROFILE, 'cordis.patch.yml')
const BIN = 'G:/000Github/zDSH/zDSH-main/apps/cli/lib/bin.js'

const mode = process.argv[2]
if (mode !== 'arm' && mode !== 'disarm') throw new Error('mode must be arm|disarm')

const MODEL_ID = '- id: workbuddy/hy4flash-free'
const DESKTOP_WINDOW = 'contextWindow: 960000'
const DESKTOP_MAX = 'maxTokens: 64000'
const ARMED_WINDOW = 'contextWindow: 40000'
const ARMED_MAX = 'maxTokens: 8192'
const BLOCK = [
  '- id: dsh-zcontext',
  '  config:',
  '    enabled: true',
  '    "autofold.enabled": true',
  '    "autofold.summarizer": compaction',
  '    "autofold.maxRounds": 16',
  '    "autofold.maxBatch": 4',
  '    "autofold.maxSummaryOutputTokens": 32768',
  '',
].join('\n')

/** Remove any existing zctx config block (id line + following indented/blank lines). */
function removeBlock(yml) {
  const lines = yml.split('\n')
  const idx = lines.findIndex((l) => l.trim() === '- id: dsh-zcontext')
  if (idx === -1) return yml
  let end = idx + 1
  while (end < lines.length && (lines[end].startsWith('  ') || lines[end] === '')) end += 1
  lines.splice(idx, end - idx)
  return lines.join('\n')
}

/** Cap/restore the model window inside the hy4flash-free entry (bounded scan, idempotent). */
function setWindow(yml, armed) {
  const lines = yml.split('\n')
  const idx = lines.findIndex((l) => l.trim() === MODEL_ID)
  if (idx === -1) throw new Error(`${MODEL_ID} not found`)
  let cappedW = false
  let cappedM = false
  for (let i = idx + 1; i < Math.min(lines.length, idx + 12); i += 1) {
    const t = lines[i].trim()
    if (armed) {
      if (t === DESKTOP_WINDOW) { lines[i] = lines[i].replace('960000', '40000'); cappedW = true }
      else if (t === ARMED_WINDOW) cappedW = true // already armed (idempotent re-run)
      if (t === DESKTOP_MAX) { lines[i] = lines[i].replace('64000', '8192'); cappedM = true }
      else if (t === ARMED_MAX) cappedM = true
    } else {
      if (t === ARMED_WINDOW) { lines[i] = lines[i].replace('40000', '960000'); cappedW = true }
      else if (t === DESKTOP_WINDOW) cappedW = true
      if (t === ARMED_MAX) { lines[i] = lines[i].replace('8192', '64000'); cappedM = true }
      else if (t === DESKTOP_MAX) cappedM = true
    }
  }
  if (!cappedW || !cappedM) throw new Error(`window cap swap incomplete: window=${cappedW} maxTokens=${cappedM}`)
  return lines.join('\n')
}

let yml = readFileSync(PATCH, 'utf8')
yml = removeBlock(yml) // idempotent re-arm
if (mode === 'arm') {
  const firstRow = yml.indexOf('- id: ')
  if (firstRow < 0) throw new Error('no rows in the patch layer')
  yml = yml.slice(0, firstRow) + BLOCK + yml.slice(firstRow)
  yml = setWindow(yml, true)
} else {
  yml = setWindow(yml, false)
}
writeFileSync(PATCH, yml)

// ---- verify through dump-config with STRUCTURAL block parsing (Z29) ----
const out = execFileSync(process.execPath, [BIN, '--dump-config', '--profile', 'bench'], {
  env: { ...process.env, DSH_HOME: HOME, DSH_AGENTS_HOME: join(HOME, 'agents-home') },
  encoding: 'utf8',
  timeout: 120000,
})
const dumpLines = out.split('\n')
function dumpBlock(id) {
  const idx = dumpLines.findIndex((l) => l.trim() === `- id: ${id}`)
  if (idx === -1) return []
  const block = []
  for (let i = idx + 1; i < dumpLines.length; i += 1) {
    if (dumpLines[i].startsWith('- id: ')) break
    block.push(dumpLines[i])
  }
  return block
}
function blockHas(block, needle) {
  return block.some((l) => l.includes(needle))
}
// The CONFIG-OVERRIDE row (what arm inserts) is the zctx row whose block
// carries a config: section with our keys — the plain BUNDLE row (always
// present when the bundle is installed) renders only `name:` + dependency
// lines (Z29 lesson: distinguish row KINDS, not mere presence).
function overrideRowPresent() {
  for (let i = 0; i < dumpLines.length; i += 1) {
    if (dumpLines[i].trim() !== '- id: dsh-zcontext') continue
    const block = []
    for (let j = i + 1; j < dumpLines.length; j += 1) {
      if (dumpLines[j].startsWith('- id: ')) break
      block.push(dumpLines[j])
    }
    if (blockHas(block, 'config:') && blockHas(block, 'autofold.enabled')) return true
  }
  return false
}

const zctx = dumpBlock('dsh-zcontext')
const overridePresent = overrideRowPresent()
const problems = []
if (mode === 'arm') {
  if (!overridePresent) problems.push('dsh-zcontext config-override row absent from the dump')
  if (!blockHas(zctx, 'enabled: true')) problems.push('enabled:true absent in the zctx dump block')
  if (!blockHas(zctx, 'autofold.enabled: true')) problems.push('autofold.enabled:true absent in the zctx dump block')
  if (!blockHas(zctx, 'autofold.summarizer: compaction')) problems.push('autofold.summarizer absent in the zctx dump block')
  // The window cap lives in the llm-pi-ai provider block, NOT the zctx block —
  // check the dump globally (the zctx-block scope is only for the zctx keys).
  if (!dumpLines.some((l) => l.includes('contextWindow: 40000'))) problems.push('model window cap (40000) absent from the dump')
  if (!dumpLines.some((l) => l.includes('maxTokens: 8192'))) problems.push('model maxTokens cap (8192) absent from the dump')
} else {
  if (overridePresent) problems.push('dsh-zcontext config-override row still present after disarm')
  if (dumpLines.some((l) => l.includes('contextWindow: 40000'))) problems.push('window cap still present after disarm')
}
if (problems.length) {
  console.error('VERIFY FAILED:', problems.join('; '))
  process.exit(1)
}
console.log(`mode=${mode} verified: override row=${overridePresent}, autofold armed=${mode === 'arm'}, window cap visible=${dumpLines.some((l) => l.includes('contextWindow: 40000'))}`)
