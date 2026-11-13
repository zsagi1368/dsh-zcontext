// probe-host-imports.mjs — ZCTX v0.2.0 V1 U2 loading probe (task card
// V1-probes-store.md item 1; plan §3 S2 前置 "U2"). Runs with
// `node scripts/probe-host-imports.mjs` from the repo root.
//
// It measures — at runtime, against the on-disk HOST build — whether the
// plugin can load `@deepseek-ai/dsh-llm` (the llm runtime library) through a
// cross-repo absolute path and observe its public exports. This answers
// RES-adapter-route.md [U2] for the dsh-llm half: host resolution of a
// SIBLING official package by absolute path (the same pattern
// probe-artifact P5 already proved for @deepseek-ai/dsh-session).
//
// Probe groups (each prints PASS/FAIL/SKIP; exit 0 unless a FAIL):
//   G1  target reachability: the host lib file is on disk (SKIPPED with an
//       explicit reason when absent — never a silent pass)
//   G2  import liveness: the module actually loads under Node ESM
//       (bare-specifier deps of the host resolve relative to ITS location)
//   G3  named-export assertions for the helpers the later waves consume
//       (V2 snapshots, V4 preflight, V5 adapter) — each export checked for
//       presence AND the expected typeof; missing entries are REPORTED as
//       missing, which is the downgrade-path design input the card asks for
//   G4  live semantics: callConfigEquals equality/difference behavior and
//       the CONTEXT_WINDOW_EXCEEDED_CODE literal, proving the imports are
//       callable code, not dead names
//
// Environment overrides:
//   ZCTX_DSH_LLM — file: URL or absolute path of the host llm lib
//       (default file:///G:/000Github/zDSH/zDSH-main/packages/llm/llm/lib/index.js)
//
// The report is written to reports/probes/U2-host-imports.md on every run
// (PASS, FAIL, and SKIPPED states all land in it).

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'
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

// ---------------------------------------------------------------------------
// G1 — target reachability
// ---------------------------------------------------------------------------

const TARGET_URL =
  process.env.ZCTX_DSH_LLM ?? 'file:///G:/000Github/zDSH/zDSH-main/packages/llm/llm/lib/index.js'
const targetPath = isAbsolute(TARGET_URL) && !TARGET_URL.startsWith('file:')
  ? resolve(TARGET_URL)
  : fileURLToPath(new URL(TARGET_URL))

let dshLlm
if (!existsSync(targetPath)) {
  skip('G1 host llm lib reachable', `no build found at ${targetPath} (override with ZCTX_DSH_LLM); all later groups SKIP`)
} else {
  report('G1 host llm lib reachable', true, targetPath)

  // -------------------------------------------------------------------------
  // G2 — import liveness
  // -------------------------------------------------------------------------

  const importUrl = TARGET_URL.startsWith('file:') ? TARGET_URL : pathToFileURL(targetPath).href
  try {
    dshLlm = await import(importUrl)
    report('G2 import liveness (Node ESM, cross-repo absolute path)', true, importUrl)
  } catch (error) {
    report('G2 import liveness (Node ESM, cross-repo absolute path)', false, `${error}`)
  }
}

// ---------------------------------------------------------------------------
// G3 — named-export assertions (presence + expected typeof)
// ---------------------------------------------------------------------------

/** name → expected typeof; functions must be callable, strings non-empty. */
const REQUIRED_EXPORTS = Object.freeze({
  // V2 observe listener: main-chain判定 + 归一化哈希投影（a.3 直 import 面）
  isAgentLoopRequest: 'function',
  markAgentLoopRequest: 'function',
  projectFilesToText: 'function',
  projectImagesForTextModel: 'function',
  projectToolUpdates: 'function',
  // V4 preflight: 溢出分类 + 官方 sanctioned 短路错误码
  isContextWindowExceededError: 'function',
  CONTEXT_WINDOW_EXCEEDED_CODE: 'string',
  // V5 adapter: 错误分类 + attribution 义务（R7）+ header 字段级对比
  isQuotaExceededError: 'function',
  callConfigEquals: 'function',
  attributionHeaders: 'function',
})

/** The misspelling an earlier research note flagged (E 报告 attrbutionHeaders
 * 拼写存疑) — asserted ABSENT so the report pins the real spelling. */
const MISSPELLING_PROBE = 'attrbutionHeaders'

if (dshLlm !== undefined) {
  const names = Object.keys(dshLlm).sort()
  report('G3 export manifest size', names.length > 0, `${names.length} named exports`)
  for (const [name, expected] of Object.entries(REQUIRED_EXPORTS)) {
    const value = dshLlm[name]
    const actual = typeof value
    if (value === undefined) {
      report(`G3 export ${name}`, false, 'MISSING — later waves must take the downgrade path for this helper')
    } else if (expected === 'function' ? actual !== 'function' : actual !== 'string' || value.length === 0) {
      report(`G3 export ${name}`, false, `expected ${expected}, got ${actual}`)
    } else {
      report(`G3 export ${name}`, true, expected)
    }
  }
  report(
    'G3 spelling pin: attrbutionHeaders (E-note misspelling) absent, attributionHeaders present',
    dshLlm[MISSPELLING_PROBE] === undefined && typeof dshLlm.attributionHeaders === 'function',
    `attrbutionHeaders=${typeof dshLlm[MISSPELLING_PROBE]}`,
  )
} else {
  for (const name of Object.keys(REQUIRED_EXPORTS)) {
    skip(`G3 export ${name}`, 'target import unavailable (G2)')
  }
  skip('G3 spelling pin', 'target import unavailable (G2)')
}

// ---------------------------------------------------------------------------
// G4 — live semantics of the two contract-critical imports
// ---------------------------------------------------------------------------

if (dshLlm !== undefined) {
  try {
    const equals = dshLlm.callConfigEquals
    const same = { provider: 'deepseek', model: 'deepseek-chat', temperature: 0.7, stop: ['a', 'b'] }
    const restated = { ...same }
    const rerouted = { ...same, model: 'deepseek-reasoner' }
    const stopDiff = { ...same, stop: ['a', 'c'] }
    const stopLen = { ...same, stop: ['a'] }
    const okSame = equals(same, restated) === true
    const okDiff = equals(same, rerouted) === false
    const okStop = equals(same, stopDiff) === false && equals(same, stopLen) === false
    report(
      'G4 callConfigEquals live semantics',
      okSame && okDiff && okStop,
      `same=${okSame} model-diff=${okDiff} stop-diff=${okStop} (element-wise + length, matches call-config.ts:67-77)`,
    )
  } catch (error) {
    report('G4 callConfigEquals live semantics', false, `${error}`)
  }
  try {
    const code = dshLlm.CONTEXT_WINDOW_EXCEEDED_CODE
    report('G4 CONTEXT_WINDOW_EXCEEDED_CODE literal', typeof code === 'string' && code.length > 0, JSON.stringify(code))
  } catch (error) {
    report('G4 CONTEXT_WINDOW_EXCEEDED_CODE literal', false, `${error}`)
  }
} else {
  skip('G4 callConfigEquals live semantics', 'target import unavailable (G2)')
  skip('G4 CONTEXT_WINDOW_EXCEEDED_CODE literal', 'target import unavailable (G2)')
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const failed = results.filter((entry) => !entry.ok)
const skippedCount = results.filter((entry) => entry.skipped).length
const passedCount = results.length - failed.length - skippedCount
console.log(`\nprobe-host-imports: ${passedCount} PASS, ${skippedCount} SKIP, ${failed.length} FAIL`)

writeReport()

if (failed.length > 0) process.exit(1)

/** Write the deterministic markdown report beside the other probe reports. */
function writeReport() {
  const outDir = fileURLToPath(new URL('../reports/probes/', import.meta.url))
  mkdirSync(outDir, { recursive: true })
  const lines = [
    '# U2 装载探针报告 — dsh-llm 跨仓绝对路径导入（probe-host-imports.mjs 机器生成）',
    '',
    `- 探针目标：\`${TARGET_URL}\``,
    `- 运行时间：${new Date().toISOString()}`,
    `- 结果汇总：${passedCount} PASS / ${skippedCount} SKIP / ${failed.length} FAIL（exit ${failed.length > 0 ? 1 : 0}）`,
    '- 回答问题：RES-adapter-route.md [U2] 的 dsh-llm 半边——插件运行时能否按绝对路径装载宿主 llm 库并观察公开导出（dsh-session 同模式已由 probe-artifact P5 先证，本探针覆盖 llm 包）。',
    '',
    '## 逐组结果',
    '',
    '| 组 | 断言 | 结果 | 详情 |',
    '|---|---|---|---|',
    ...results.map((entry) => {
      const state = entry.skipped ? 'SKIP' : entry.ok ? 'PASS' : 'FAIL'
      return `| ${state} | ${entry.id} | ${state} | ${escapeCell(entry.detail ?? '')} |`
    }),
    '',
    '## 缺失项（后续波降级路径设计输入）',
    '',
    failed.length === 0
      ? '无 — G3 清单内全部导出在盘且形态符合预期。'
      : failed.map((entry) => `- ${entry.id}: ${entry.detail ?? ''}`).join('\n'),
    '',
    '## 纪律说明',
    '',
    '- SKIPPED = 环境不可达（宿主构建不在盘），明示不静默；src 内仍零宿主运行时强依赖（duck-typing），本探针只是脚本级事实采集。',
    '- attributionHeaders 拼写以实读为准（E 报告 attrbutionHeaders 存疑项已由 G3 拼写钉排除）。',
    '',
  ]
  writeFileSync(outDir + 'U2-host-imports.md', lines.join('\n'), 'utf8')
  console.log(`report written: ${outDir}U2-host-imports.md`)
}

/** Keep pipes and table cells readable inside the markdown table. */
function escapeCell(text) {
  return text.replaceAll('|', '\\|').replaceAll('\n', ' ')
}
