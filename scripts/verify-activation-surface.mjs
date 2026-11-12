// verify-activation-surface.mjs — W5 / plan-A4 activation-surface assertion
// set (task card W5 §1, plan §2 A4/A5, RSI §3.5 Z1/Z3/Z7/Z9). Runs with
// `node scripts/verify-activation-surface.mjs` from the repo root; ALL GREEN
// exits 0, any failure exits 1 with details. No grep involved anywhere —
// every file is read and parsed by node directly (ugrep false-negative pit).
//
// Assertion groups:
//   A1 Z3          lib/index.js + lib/index.d.ts on disk AND present in
//                  `git ls-tree` (committed artifact, git-form installs).
//   A2 package.json  dsh.bundle.patch declared; NO prepare/preinstall/
//                  postinstall/install lifecycle scripts (allowBuilds-free);
//                  no dsh.client field (no client bundle face, Z1);
//                  peerDependencies carries @deepseek-ai/cordis; engines
//                  declares the node floor.
//   A3 Z7 probe    node import of lib/index.js: default === ZcontextPlugin,
//                  name === 'dsh-zcontext', static Config present, and the
//                  four tool names build through the defineTool surface.
//   A4 patch yml   line-by-line parse of cordis.patch.yml: the insert block
//                  carries `- id: dsh-zcontext` with `name: dsh-zcontext`.
//   A5 checkpoint  lib/index.js carries the 'zctx-fold' / 'zctx-unfold' /
//                  'required' marker strings (checkpoint + B2 shapes).
//   A6 S8          NO isConcurrencySafe anywhere in lib/index.js, and all
//                  four built tool definitions omit the property (exclusive
//                  barrier preserved).
//   A7 B2          the nudge context registration asserts required === true.
//   A8 probe       scripts/probe-artifact.mjs (reused as a sub-assertion, not
//                  re-implemented) exits 0.
//
// The mock host ctx in A7 mirrors tests/helpers/mock-session.ts + the
// capability-probed faces; it exercises the REAL built plugin constructor.

import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const results = []
function report(id, ok, detail) {
  results.push({ id, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}${detail === undefined ? '' : ` — ${detail}`}`)
}

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const read = (rel) => readFileSync(join(repoRoot, rel), 'utf8')

// ---------------------------------------------------------------------------
// A1 — Z3: artifact on disk + committed in git.
// ---------------------------------------------------------------------------

{
  let ok = false
  let detail
  try {
    const js = readFileSync(join(repoRoot, 'lib/index.js'))
    const dts = readFileSync(join(repoRoot, 'lib/index.d.ts'))
    const ls = spawnSync('git', ['ls-tree', '-r', 'HEAD', '--', 'lib'], {
      cwd: repoRoot,
      encoding: 'utf8',
    })
    const committed = (ls.stdout ?? '').split('\n').filter(Boolean).map((line) => line.replace(/^\S+\s+\S+\s+\S+\t/, ''))
    const jsIn = committed.includes('lib/index.js')
    const dtsIn = committed.includes('lib/index.d.ts')
    ok = js.length > 0 && dts.length > 0 && jsIn && dtsIn
    detail = `lib/index.js=${js.length}B lib/index.d.ts=${dts.length}B committed=[${committed.join(', ')}]`
  } catch (error) {
    detail = `threw: ${error instanceof Error ? error.message : String(error)}`
  }
  report('A1 Z3 artifact on disk + git ls-tree', ok, detail)
}

// ---------------------------------------------------------------------------
// A2 — package.json contract (A5 install-gate self-check included).
// ---------------------------------------------------------------------------

{
  const pkg = JSON.parse(read('package.json'))
  const lifecycle = ['prepare', 'preinstall', 'postinstall', 'install']
  const presentLifecycle = lifecycle.filter((name) => pkg.scripts?.[name] !== undefined)
  const checks = {
    'dsh.bundle.patch declared': pkg.dsh?.bundle?.patch === './cordis.patch.yml',
    'manifestVersion 1': pkg.dsh?.manifestVersion === 1,
    'no install-time lifecycle scripts': presentLifecycle.length === 0,
    'no dsh.client field': pkg.dsh?.client === undefined && !('client' in (pkg.dsh ?? {})),
    'peerDeps cordis >=4': pkg.peerDependencies?.['@deepseek-ai/cordis'] === '>=4',
    'engines node floor': typeof pkg.engines?.node === 'string' && /^\^?>=?\s*\d/.test(pkg.engines.node),
    'main + types pinned to lib': pkg.main === 'lib/index.js' && pkg.types === 'lib/index.d.ts',
  }
  const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name)
  report('A2 package.json install-gate contract', failed.length === 0, failed.length === 0 ? Object.keys(checks).join('; ') : `failed: ${failed.join('; ')}`)
}

// ---------------------------------------------------------------------------
// A3 — Z7 probe: import the built lib and check the identity surface.
// ---------------------------------------------------------------------------

let zctx
{
  let ok = false
  let detail
  try {
    zctx = await import(pathToFileURL(join(repoRoot, 'lib/index.js')).href)
    const fourTools = ['zctx_fold', 'zctx_unfold', 'zctx_recall', 'zctx_status']
    // Build the four tools through the artifact's own defineTool surface
    // (shim resolves because the host @deepseek-ai/dsh-tools is not a
    // devDependency here — either way the names must come out identical).
    const runtime = {
      storeFor: () => new zctx.FoldStore(),
      validatorConfig: () => ({}),
    }
    const tools = zctx.buildZctxTools(zctx.resolveDefineTool(), runtime)
    const names = tools.map((t) => t.name)
    const identityOk =
      zctx.name === 'dsh-zcontext'
      && zctx.default === zctx.ZcontextPlugin
      && typeof zctx.ZcontextPlugin === 'function'
      && zctx.ZcontextPlugin.Config !== undefined
      && zctx.ZcontextPlugin.Config?.['~standard']?.validate !== undefined
    ok = identityOk && fourTools.every((n) => names.includes(n))
    detail = `identity=${identityOk} tools=[${names.join(',')}]`
  } catch (error) {
    detail = `threw: ${error instanceof Error ? error.message : String(error)}`
  }
  report('A3 Z7 identity + Config + four tool names from lib', ok, detail)
}

// ---------------------------------------------------------------------------
// A4 — cordis.patch.yml line-by-line parse (no yml library, no grep).
// ---------------------------------------------------------------------------

{
  const lines = read('cordis.patch.yml').split(/\r?\n/)
  const insertIdx = lines.findIndex((line) => /^- insert:\s*$/.test(line))
  const after = insertIdx >= 0 ? lines.slice(insertIdx + 1) : []
  const idIdx = after.findIndex((line) => /^\s*-\s+id:\s*['"]?dsh-zcontext['"]?\s*$/.test(line))
  const nameLine = idIdx >= 0 ? after.slice(idIdx + 1).find((line) => /^\s+name:\s*['"]?dsh-zcontext['"]?\s*$/.test(line)) : undefined
  const ok = insertIdx >= 0 && idIdx >= 0 && nameLine !== undefined
  report(
    'A4 patch yml insert row (id + name = dsh-zcontext)',
    ok,
    ok ? `insert@line${insertIdx + 1} id@line${insertIdx + idIdx + 2}` : `insertIdx=${insertIdx} idIdx=${idIdx}`,
  )
}

// ---------------------------------------------------------------------------
// A5 — checkpoint marker strings inside the built artifact.
// ---------------------------------------------------------------------------

{
  const libText = read('lib/index.js')
  const markers = ['zctx-fold', 'zctx-unfold', 'required']
  const missing = markers.filter((m) => !libText.includes(m))
  report('A5 checkpoint markers in lib/index.js', missing.length === 0, missing.length === 0 ? `all of [${markers.join(', ')}] present` : `missing: [${missing.join(', ')}]`)
}

// ---------------------------------------------------------------------------
// A6 — S8: no isConcurrencySafe (raw text + built definitions).
// ---------------------------------------------------------------------------

{
  // The S8 assertion scopes to CODE: the bundle intentionally preserves the
  // rationale COMMENTS (tools.ts/plugin.ts document why the key is omitted),
  // so comments are stripped before the declaration scan — the runtime check
  // below pins the same invariant on the built definitions themselves.
  const libText = read('lib/index.js').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const rawOk = !libText.includes('isConcurrencySafe')
  let builtOk = false
  let detail = ''
  try {
    const runtime = {
      storeFor: () => new zctx.FoldStore(),
      validatorConfig: () => ({}),
    }
    const tools = zctx.buildZctxTools(zctx.resolveDefineTool(), runtime)
    const offenders = tools.filter((t) => t.isConcurrencySafe !== undefined)
    builtOk = tools.length === 4 && offenders.length === 0
    detail = `codeTextClean=${rawOk} tools=${tools.length} offenders=${offenders.length}`
  } catch (error) {
    detail = `codeTextClean=${rawOk} threw: ${error instanceof Error ? error.message : String(error)}`
  }
  report('A6 S8 no isConcurrencySafe declaration (code + runtime)', rawOk && builtOk, detail)
}

// ---------------------------------------------------------------------------
// A7 — B2: the nudge context registers with required: true.
// ---------------------------------------------------------------------------

{
  const registered = { tools: [], sections: [], contexts: [], commands: [] }
  const ctx = {
    logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
    tools: { register: (d) => registered.tools.push(d) },
    systemPrompt: {
      section: (s) => registered.sections.push(s),
      context: (c) => registered.contexts.push(c),
    },
    commands: { register: (c) => registered.commands.push(c) },
    tokenMeter: { measure: () => ({ totalTokens: 100000 }) },
    llm: { resolveModelInfo: async () => ({ context: { contextWindow: 200000 }, defaultMaxTokens: 8192 }) },
    reflect: { provide: () => undefined },
    on: () => undefined,
    emit: () => undefined,
    route: (session) => session,
  }
  let ok = false
  let detail = ''
  try {
    new zctx.ZcontextPlugin(ctx, {
      minFoldableTokens: 5,
      summaryFloorChars: 10,
      protectionFloorTokens: 0,
      keepRecentTokens: 0,
    })
    const context = registered.contexts[0] ?? {}
    ok =
      registered.contexts.length === 1
      && context.required === true
      && context.name === 'zctx-nudge'
      && typeof context.text === 'function'
    detail = `contexts=${registered.contexts.length} required=${String(context.required)} name=${String(context.name)}`
  } catch (error) {
    detail = `threw: ${error instanceof Error ? error.message : String(error)}`
  }
  report('A7 B2 nudge context required:true', ok, detail)
}

// ---------------------------------------------------------------------------
// A8 — reuse probe-artifact.mjs as a sub-assertion (no re-implementation).
// ---------------------------------------------------------------------------

{
  const probe = spawnSync(process.execPath, [join(repoRoot, 'scripts/probe-artifact.mjs')], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 120_000,
  })
  const summary = (probe.stdout ?? '').trim().split('\n').filter(Boolean).pop() ?? ''
  report('A8 probe-artifact.mjs subprocess', probe.status === 0, `exit=${probe.status}; ${summary}`)
}

// ---------------------------------------------------------------------------

const failed = results.filter((r) => !r.ok)
console.log(`\nverify-activation-surface: ${results.length - failed.length} PASS, ${failed.length} FAIL`)
process.exit(failed.length > 0 ? 1 : 0)
