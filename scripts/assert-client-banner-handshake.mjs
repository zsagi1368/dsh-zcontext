// ZCTX-UI Z1 guard: client bundle banner id <-> package.json name handshake,
// PLUS a REAL syntax check of dist/client.cjs.
//
// B6 P0: the previous footer assertion used a loose regex (\s*}*\s*\);) that
// accepted a bundle missing the arrow-function body's closing `}`. The shipped
// dist/client.cjs then failed `node --check` ("Unexpected token ')'"), the
// script never executed, __ModuleLoader__.load was never called, and the loader
// reported "loaded without registering dsh-zcontext". This guard now FAILS THE
// BUILD on any syntax error — the very crash it exists to prevent.
//
// The mainline web client loads dist/client.cjs as a classic script and requires
// the factory registered under the boot-graph row id, which IS the package name
// (zDSH-main manifest.ts: "Entry name == package name"). Registration is keyed
// by the banner id with a trailing "/client" stripped.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const distPath = path.join(ROOT, 'dist', 'client.cjs')
const dist = readFileSync(distPath, 'utf8')

function stripClientSuffix(spec) {
  return spec.endsWith('/client') ? spec.slice(0, -'/client'.length) : spec
}

let failed = 0
function assert(name, ok, detail) {
  if (!ok) failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

// 1. REAL syntax validation — the load-bearing guard. Any parse error fails.
let syntaxOk = true
let syntaxDetail = ''
try {
  execFileSync(process.execPath, ['--check', distPath], { stdio: 'pipe' })
} catch (error) {
  syntaxOk = false
  syntaxDetail = (error?.stderr ? Buffer.from(error.stderr).toString('utf8') : String(error)).split('\n').slice(0, 3).join(' | ')
}
assert('bundle.node-check-syntax', syntaxOk,
  syntaxOk ? 'dist/client.cjs parses cleanly (node --check)' : `SYNTAX ERROR: ${syntaxDetail}`)

// 2. Banner present + single-arg factory (Z1).
const banner = dist.match(/^window\.__ModuleLoader__\.load\(\{ id: "([^"]+)", factory: \(require\) => \{ var module = \{ exports: \{\} \}; var exports = module\.exports;/)
assert('handshake.banner-single-arg-factory', banner !== null,
  'dist/client.cjs must open with the single-arg factory(require) + module scaffold banner')

// 3. Registration key (banner id, /client stripped) === package name.
const bannerId = banner ? banner[1] : ''
const key = stripClientSuffix(bannerId)
assert('handshake.banner-id-matches-package-name', key === pkg.name,
  `banner id "${bannerId}" -> key "${key}" vs package name "${pkg.name}"`)

// 4. STRICT footer shape — THREE scopes must close, no loose quantifier:
//    `return module.exports;`   (js body)
//    `}`                        (factory arrow-function body)   ← the B6 P0 fix
//    `});`                      (load argument object + call)
const footerStrict = /\breturn module\.exports;\s*\}\s*\}\s*\);\s*$/.test(dist)
assert('handshake.footer-two-braces-factory-and-load', footerStrict,
  'bundle must close with `return module.exports; } });` (factory body + load object + call)')

// 5. No legacy three-arg factory form (Z1 boot crash).
assert('handshake.no-three-arg-factory', !/factory:\s*\(require,\s*module,\s*exports\)/.test(dist),
  'legacy factory(require, module, exports) form is forbidden (Z1 boot crash)')

if (failed > 0) {
  console.error(`client banner handshake: ${failed} check(s) FAILED`)
  process.exit(1)
}
console.log('client banner handshake: all checks PASS')
