// ZCTX-UI Z1 guard: client bundle banner id <-> package.json name handshake.
//
// The mainline web client loads dist/client.cjs as a classic script and requires
// the factory registered under the boot-graph row id, which IS the package name
// (zDSH-main manifest.ts: "Entry name == package name"). Registration is keyed
// by the banner id with a trailing "/client" stripped. A mismatch means the
// client never finds our factory and the slot card never mounts — a runtime
// surprise we convert into a BUILD failure here (AutoPilot TC-B3-33E precedent).
//
// Also asserts the single-arg factory contract (Z1): `factory: (require) =>`
// with the self-built module scaffold, and the absence of the legacy three-arg
// form. Pure static check; no browser/network.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const dist = readFileSync(path.join(ROOT, 'dist', 'client.cjs'), 'utf8')

function stripClientSuffix(spec) {
  return spec.endsWith('/client') ? spec.slice(0, -'/client'.length) : spec
}

let failed = 0
function assert(name, ok, detail) {
  if (!ok) failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

// 1. Banner present + single-arg factory (Z1).
const banner = dist.match(/^window\.__ModuleLoader__\.load\(\{ id: "([^"]+)", factory: \(require\) => \{ var module = \{ exports: \{\} \}; var exports = module\.exports;/)
assert('handshake.banner-single-arg-factory', banner !== null,
  'dist/client.cjs must open with the single-arg factory(require) + module scaffold banner')

// 2. Registration key (banner id, /client stripped) === package name.
const bannerId = banner ? banner[1] : ''
const key = stripClientSuffix(bannerId)
assert('handshake.banner-id-matches-package-name', key === pkg.name,
  `banner id "${bannerId}" -> key "${key}" vs package name "${pkg.name}"`)

// 3. Footer returns module.exports; no three-arg factory form.
assert('handshake.footer-returns-exports', /\breturn module\.exports;\s*\}\s*\);\s*$/.test(dist),
  'bundle must close with `return module.exports; });` (single-arg factory footer)')
assert('handshake.no-three-arg-factory', !/factory:\s*\(require,\s*module,\s*exports\)/.test(dist),
  'legacy factory(require, module, exports) form is forbidden (Z1 boot crash)')

if (failed > 0) {
  console.error(`client banner handshake: ${failed} check(s) FAILED`)
  process.exit(1)
}
console.log('client banner handshake: all checks PASS')
