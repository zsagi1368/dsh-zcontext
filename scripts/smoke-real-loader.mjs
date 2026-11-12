// smoke-real-loader.mjs — W5 / plan-A6 real-machine smoke probe (lightweight,
// no network, no install). Runs against REAL host components when they are
// available and reports SKIP (with a reason) when they are not; exit 1 only on
// a real FAIL. Run with `node scripts/smoke-real-loader.mjs` from the repo root.
//
// Probes:
//   R1  REAL app-boot loader lib (packages/boot/app-boot): loadOverlayPatches
//       parses THIS repo's cordis.patch.yml, and composeEntries composes it
//       into the effective mount entry list — the exact parser/composer the
//       boot include uses.
//   R2  REAL dsh CLI (apps/cli/lib/bin.js): `--dump-config --patch <ours>`
//       composes the shipped profile tree plus our patch overlay through the
//       real boot path; the composed tree must contain our
//       `{ id: dsh-zcontext, name: dsh-zcontext }` row as its own layer, and
//       the same dump WITHOUT our overlay must not contain it (negative
//       control: the row comes from OUR patch, nothing preexisting).
//
// Full-install smoke (real `dsh plugin add` into a live profile + mounted
// harness runtime) is deliberately out of scope here — it needs the published
// registry bundles and an LLM runtime; plan A6 registers it as a post-merge
// step. Every probe below is read-only outside a throwaway DSH_HOME created
// in the OS temp dir and removed afterwards (self-created, prefix-checked).
//
// Env overrides:
//   ZCTX_DSH_MAIN   zDSH-main checkout root   (default G:/000Github/zDSH/zDSH-main)
//   ZCTX_DSH_CLI    built CLI bin.js path     (default <main>/apps/cli/lib/bin.js)

import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const results = []
function report(id, ok, detail) {
  results.push({ id, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}${detail === undefined ? '' : ` — ${detail}`}`)
}
function skip(id, detail) {
  results.push({ id, ok: true, skipped: true })
  console.log(`SKIP  ${id} — ${detail}`)
}

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const patchPath = join(repoRoot, 'cordis.patch.yml')
const dshMain = process.env.ZCTX_DSH_MAIN ?? 'G:/000Github/zDSH/zDSH-main'

// ---------------------------------------------------------------------------
// R1 — REAL loader lib: parse + compose OUR cordis.patch.yml.
// ---------------------------------------------------------------------------

const loaderLib = join(dshMain, 'packages/boot/app-boot/lib/index.js')
if (!existsSync(loaderLib)) {
  skip('R1 real loader parse + compose', `app-boot build not found at ${loaderLib} (set ZCTX_DSH_MAIN)`)
} else {
  let ok = false
  let detail = ''
  try {
    const loader = await import(pathToFileURL(loaderLib).href)
    const patches = loader.loadOverlayPatches('zctx-smoke', patchPath)
    const row = patches.flatMap((p) => p.insert ?? []).find((r) => r?.id === 'dsh-zcontext')
    const parsedOk = row !== undefined && row.name === 'dsh-zcontext'
    const entries = loader.composeEntries([patches], () => undefined)
    const composedOk =
      entries.length === 1 && entries[0].id === 'dsh-zcontext' && entries[0].name === 'dsh-zcontext'
    ok = parsedOk && composedOk
    detail = `parsed=${JSON.stringify(patches)} composed=${JSON.stringify(entries)}`
  } catch (error) {
    detail = `threw: ${error instanceof Error ? error.message : String(error)}`
  }
  report('R1 real loader parse + compose of cordis.patch.yml', ok, detail)
}

// ---------------------------------------------------------------------------
// R2 — REAL CLI dump-config with/without our patch overlay.
// ---------------------------------------------------------------------------

const cliBin = process.env.ZCTX_DSH_CLI ?? join(dshMain, 'apps/cli/lib/bin.js')
if (!existsSync(cliBin)) {
  skip('R2 real CLI dump-config composition (+ negative control)', `built CLI not found at ${cliBin} (set ZCTX_DSH_CLI)`)
} else {
  // Throwaway DSH_HOME: created by this run inside the OS temp dir, removed
  // after the probes. Removal is guarded: only a mkdtemp result carrying the
  // zctx-smoke prefix inside the OS temp root is ever unlinked.
  const home = mkdtempSync(join(tmpdir(), 'zctx-smoke-home-'))
  try {
    const run = (extraArgs) =>
      spawnSync(process.execPath, [cliBin, '--profile', 'web', ...extraArgs, '--dump-config'], {
        encoding: 'utf8',
        env: { ...process.env, DSH_HOME: home },
        timeout: 120_000,
      })
    const withOurs = run(['--patch', patchPath])
    const withoutOurs = run([])
    const cliUsable = withOurs.status === 0 && withoutOurs.status === 0
    if (!cliUsable) {
      report(
        'R2 real CLI dump-config composition (+ negative control)',
        false,
        `with ours exit=${withOurs.status} without exit=${withoutOurs.status}; stderr: ${(withOurs.stderr ?? '').split('\n').slice(0, 4).join(' | ')}`,
      )
    } else {
      const oursText = withOurs.stdout ?? ''
      const marker = '# == '
      const layerIdx = oursText.indexOf(`${marker}${patchPath}`)
      const tail = layerIdx >= 0 ? oursText.slice(layerIdx) : ''
      const rowOk =
        layerIdx >= 0
        && /- id: dsh-zcontext\n  name: dsh-zcontext/.test(tail)
      // The layer must be composed LAST (our overlay applies after the shipped profile).
      const lastLayer = layerIdx >= 0 && oursText.slice(layerIdx + 1).includes(`${marker}`) === false
      const controlOk = !(withoutOurs.stdout ?? '').includes('dsh-zcontext')
      report(
        'R2 real CLI dump-config composition (+ negative control)',
        rowOk && lastLayer && controlOk,
        `composedLayer=${rowOk} lastLayer=${lastLayer} negativeControl=${controlOk}`
          + ` lines=${oursText.split('\n').length}/${(withoutOurs.stdout ?? '').split('\n').length}`,
      )
    }
  } finally {
    if (home.startsWith(tmpdir()) && home.includes('zctx-smoke-home-')) {
      rmSync(home, { recursive: true, force: true })
    }
  }
}

// ---------------------------------------------------------------------------

const failed = results.filter((r) => !r.ok)
const skipped = results.filter((r) => r.skipped === true)
console.log(`\nsmoke-real-loader: ${results.length - failed.length - skipped.length} PASS, ${skipped.length} SKIP, ${failed.length} FAIL`)
process.exit(failed.length > 0 ? 1 : 0)
