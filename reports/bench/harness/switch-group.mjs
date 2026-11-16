// Switch the bench profile between group configurations:
//   A  = dsh-zcontext bundle row removed (bare official baseline)
//   B  = bundle kept + config enabled:false (installed-but-off)
//   C  = bundle kept + defaults (treatment)
//   C2 = C + declared model contextWindow capped to 40000 (instrumented arm;
//        same model, only the provider-declared window the plugin sees changes,
//        making the fold trigger line reachable inside a scripted session)
// Verifies each switch through `dsh --dump-config` (exit 0 + expected rows).
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const HOME = 'C:/Users/ZS/AppData/Local/Temp/zctx-bench-home'
const PROFILE = join(HOME, 'profiles', 'bench')
const PKG = join(PROFILE, 'package.json')
const PATCH = join(PROFILE, 'cordis.patch.yml')
const BIN = 'G:/000Github/zDSH/zDSH-main/apps/cli/lib/bin.js'

const group = process.argv[2]
if (!['A', 'B', 'C', 'C2'].includes(group)) throw new Error('group must be A|B|C|C2')

// ---- package.json bundles ----
const pkg = JSON.parse(readFileSync(PKG, 'utf8'))
const bundles = pkg.dsh.profile.bundles.filter(b => b !== 'dsh-zcontext')
if (group !== 'A') bundles.push('dsh-zcontext')
pkg.dsh.profile.bundles = bundles
writeFileSync(PKG, JSON.stringify(pkg, null, 2) + '\n')

// ---- patch yml zcontext config block ----
let yml = readFileSync(PATCH, 'utf8')
// remove any existing zcontext override block (id + following indented lines)
const blockRe = /- id: dsh-zcontext\n(  .*\n|\n)*/y
blockRe.lastIndex = 0
const m = blockRe.exec(yml)
if (m) yml = yml.slice(0, m.index) + yml.slice(m.index + m[0].length)
if (group === 'B') {
  // insert the enabled:false override right after the header comments (before the first row)
  const firstRow = yml.indexOf('- id: ')
  if (firstRow < 0) throw new Error('no rows in patch yml')
  const block = '- id: dsh-zcontext\n  config:\n    enabled: false\n'
  yml = yml.slice(0, firstRow) + block + yml.slice(firstRow)
}
// ---- C2 window cap on the magpie hy4flash-free model entry ----
if (group !== 'C2') {
  // restore the desktop-declared window if a previous C2 cap is present
  const lines0 = yml.split('\n')
  const idIdx0 = lines0.findIndex(l => l.trim() === '- id: workbuddy/hy4flash-free')
  if (idIdx0 >= 0) {
    for (let i = idIdx0 + 1; i < Math.min(lines0.length, idIdx0 + 10); i++) {
      if (/^\s+contextWindow: 40000$/.test(lines0[i])) lines0[i] = lines0[i].replace('40000', '960000')
      if (/^\s+maxTokens: 8192$/.test(lines0[i])) lines0[i] = lines0[i].replace('8192', '64000')
    }
    yml = lines0.join('\n')
  }
}
if (group === 'C2') {
  const lines = yml.split('\n')
  const idIdx = lines.findIndex(l => l.trim() === '- id: workbuddy/hy4flash-free')
  if (idIdx < 0) throw new Error('hy4flash-free model entry not found for C2 cap')
  let cappedW = false
  let cappedM = false
  for (let i = idIdx + 1; i < Math.min(lines.length, idIdx + 10); i++) {
    if (/^\s+contextWindow: 960000$/.test(lines[i])) { lines[i] = lines[i].replace('960000', '40000'); cappedW = true }
    if (/^\s+maxTokens: 64000$/.test(lines[i])) { lines[i] = lines[i].replace('64000', '8192'); cappedM = true }
  }
  if (!cappedW || !cappedM) throw new Error(`C2 cap incomplete: window=${cappedW} maxTokens=${cappedM}`)
  yml = lines.join('\n')
}
writeFileSync(PATCH, yml)

// ---- verify through dump-config ----
const out = execFileSync(process.execPath, [BIN, '--dump-config', '--profile', 'bench'], {
  env: { ...process.env, DSH_HOME: HOME, DSH_AGENTS_HOME: join(HOME, 'agents-home') },
  encoding: 'utf8', timeout: 120000,
})
const hasRow = /^- id: dsh-zcontext$/m.test(out)
const enabledFalse = /- id: dsh-zcontext\n  config:\n    enabled: false/.test(out)
const capped = out.includes('contextWindow: 40000')
const expect = {
  A: { hasRow: false },
  B: { hasRow: true, enabledFalse: true },
  C: { hasRow: true, enabledFalse: false },
  C2: { hasRow: true, enabledFalse: false, capped: true },
}[group]
const problems = []
if ((hasRow) !== expect.hasRow) problems.push(`zcontext row ${hasRow ? 'present' : 'absent'} (want ${expect.hasRow ? 'present' : 'absent'})`)
if ('enabledFalse' in expect && enabledFalse !== expect.enabledFalse) problems.push(`enabled:false ${enabledFalse}`)
if ('capped' in expect && capped !== expect.capped) problems.push(`window cap visible in dump: ${capped}`)
if (problems.length) { console.error('VERIFY FAILED:', problems.join('; ')); process.exit(1) }
console.log(`group=${group} verified: row=${hasRow} enabledFalse=${enabledFalse} capped=${capped} skippedBundles=${(out.match(/skipping profile bundle/g) || []).length}`)
