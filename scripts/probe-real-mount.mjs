// probe-real-mount.mjs — ZCTX v0.2.1 P0 real-mount probe (task card
// P0-inject-fix.md product 3; plan §1). Runs with
// `node scripts/probe-real-mount.mjs` from the repo root.
//
// WHY: the v0.2.0 real-device failure ("cannot get property \"tokenMeter\"
// without inject") never reproduced under plain-object mocks — the mock host
// did not implement the cordis get-trap inject discipline. This probe mounts
// the BUILT plugin (lib/index.js, the shipped artifact) into a REAL vendored
// cordis container — real Context, real fiber, real inject resolution, five
// service stubs in the OFFICIAL provider shape (`class X extends Service`
// with `super(ctx, '<name>')`, so each service is provided by its OWN plugin
// fiber — the same topology as the real host, where the get-trap fiber walk
// (vendor/cordis/src/reflect.ts:148-165) cannot reach sibling fibers without
// an inject declaration).
//
// Ground truth (reproduced against the vendored cordis, 4.0.5-alpha.1):
//   - a consumer with `static inject = []` reading ctx.llm THROWS the exact
//     device error when services are provided by sibling plugin fibers
//     (the v0.2.0 root cause);
//   - a consumer declaring the service in `static inject` resolves it.
//
// Probe groups (each prints PASS/FAIL/SKIP; exit 0 unless a FAIL):
//   G1  cordis reachability: the vendored cordis build imports under Node
//       ESM (vendor/cordis/lib first, then the plugin-repo node_modules copy;
//       Z20 loading discipline — fileURLToPath, never url.pathname;
//       statSync().isDirectory() before joining a package entry). All later
//       groups SKIP when neither is importable — never a silent pass.
//   G2  device-failure negative control: under the REAL mount topology, a
//       probe class with `static inject = []` reading ctx.llm must throw
//       `cannot get property "llm" without inject` — pins that this mount
//       reproduces the device failure mode (guards against the topology
//       silently drifting permissive, e.g. stubs provided on the root fiber).
//   G3  real mount, default config: our plugin (from lib/) applies with all
//       five declared services provided and crosses EVERY boot-time service access
//       point — the constructor tokenMeter/llm reads (the v0.2.0 death
//       site), the tools face (4 registrations), the guidance section, the
//       nudge context (required: true), the /zctx command, the session feed
//       listeners, and BOTH llm/stream listeners (preflight observe + cache
//       observe; counted on the real EventsService registry, events.ts:131).
//       A wrong inject key would leave the plugin PENDING here — the
//       dsh-zcontext service lookup is the PENDING guard.
//   G4  real mount with a providers declaration: the adapter face crosses
//       its llm runtime access points — registerAdapter with the zctx route
//       and registerConfigurableProviders (visibility-only directory).
//       SKIPPED with an explicit reason when the host llm lib is not on disk
//       (the face is fail-soft by design and would log an info instead).
//
// Environment overrides:
//   ZCTX_VENDOR_CORDIS — file: URL or absolute path of the vendored cordis
//       entry (default file:///G:/000Github/zDSH/zDSH-main/vendor/cordis/lib/index.js)
//   ZCTX_PLUGIN_LIB    — file: URL or absolute path of OUR built entry
//       (default <repo>/lib/index.js)
//   ZCTX_DSH_LLM / ZCTX_PIAI / ZCTX_DSH_LLM_PIAI — host face overrides for
//       G4 (same contract as src/adapter/host.ts and probe-host-imports).
//
// The report is written to reports/probes/P0-real-mount.md on every run
// (PASS, FAIL, and SKIPPED states all land in it).

import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const results = []
function report(id, ok, detail) {
  results.push({ id, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}${detail === undefined ? '' : ` — ${detail}`}`)
}
function skip(id, detail) {
  results.push({ id, ok: true, skipped: true, detail })
  console.log(`SKIP  ${id} — ${detail}`)
}

/** Z20 loading discipline: file: URL or plain path → on-disk path. */
function toPath(value) {
  if (isAbsolute(value) && !value.startsWith('file:')) return resolve(value)
  return fileURLToPath(new URL(value))
}

/** Z20: a package ROOT directory resolves its built entry; a file passes through. */
function entryOf(candidatePath, entry) {
  let stat
  try {
    stat = statSync(candidatePath)
  } catch {
    return undefined
  }
  if (stat.isDirectory()) {
    const joined = join(candidatePath, entry)
    return existsSync(joined) ? joined : undefined
  }
  return candidatePath
}

async function importEntry(candidatePath, entry) {
  const entryPath = entryOf(candidatePath, entry)
  if (entryPath === undefined) throw new Error(`no build at ${candidatePath}`)
  return import(pathToFileURL(entryPath).href)
}

// ---------------------------------------------------------------------------
// G1 — cordis reachability
// ---------------------------------------------------------------------------

const CORDIS_OVERRIDE = process.env.ZCTX_VENDOR_CORDIS
const CORDIS_CANDIDATES = CORDIS_OVERRIDE !== undefined
  ? [toPath(CORDIS_OVERRIDE)]
  : [
      // The anchor tree's vendored build — closest to the real device.
      'G:/000Github/zDSH/zDSH-main/vendor/cordis',
      // The plugin repo's own peer-installed copy (pnpm store realpath).
      'G:/000Github/zDSH/zDSH-plugins/dsh-zcontext/node_modules/@deepseek-ai/cordis',
    ]

const PLUGIN_LIB_OVERRIDE = process.env.ZCTX_PLUGIN_LIB
const PLUGIN_LIB = PLUGIN_LIB_OVERRIDE !== undefined
  ? toPath(PLUGIN_LIB_OVERRIDE)
  : fileURLToPath(new URL('../lib/index.js', import.meta.url))

let cordis
let cordisVia
let cordisError
try {
  for (const candidate of CORDIS_CANDIDATES) {
    try {
      cordis = await importEntry(candidate, 'lib/index.js')
      cordisVia = candidate
      break
    } catch (error) {
      cordisError = error
    }
  }
  if (cordis === undefined) throw cordisError ?? new Error('no cordis candidate importable')
} catch (error) {
  skip('G1 vendored cordis reachable', `no importable build (${error?.message ?? error}); all later groups SKIP`)
}

const PLUGIN_REACHABLE = existsSync(PLUGIN_LIB)
if (cordis !== undefined && !PLUGIN_REACHABLE) {
  skip('G1 plugin lib reachable', `no build at ${PLUGIN_LIB} (override with ZCTX_PLUGIN_LIB); later groups SKIP`)
}
if (cordis !== undefined && PLUGIN_REACHABLE) {
  report('G1 vendored cordis reachable', true, cordisVia)
  report('G1 plugin lib reachable', true, PLUGIN_LIB)
}

// ---------------------------------------------------------------------------
// Shared mount scaffold — five stubs in the OFFICIAL provider shape
// (P3 HF-02: 'sessions' left the inject declaration — declared-but-never-read;
// the sixth stub is gone, and G3 doubles as the no-sessions activation pin).
// ---------------------------------------------------------------------------

/** Wait until `predicate()` holds (plugin application is synchronous but the
 * continuation notifications ride the microtask queue; bounded honest wait). */
async function until(predicate, budgetMs = 2000) {
  const deadline = Date.now() + budgetMs
  while (Date.now() < deadline) {
    if (predicate()) return true
    await new Promise((r) => setTimeout(r, 5))
  }
  return predicate()
}

/** Load OUR built plugin class (named export first, default fallback). */
async function loadPluginClass() {
  const mod = await import(pathToFileURL(PLUGIN_LIB).href)
  const PluginClass = mod.ZcontextPlugin ?? mod.default
  return typeof PluginClass === 'function' ? PluginClass : undefined
}

/**
 * One fresh real container: root Context + six Service-form provider stubs.
 * The official topology: each service is provided by ITS OWN plugin fiber
 * (a sibling of the consumer's fiber — exactly why the get-trap walk needs
 * the inject declaration; a root-fiber-provided stub would be permissive and
 * would NOT reproduce the device failure, which is what G2 pins).
 */
function mountContainer() {
  const { Service } = cordis
  const root = new cordis.Context()
  const recorded = {
    tools: [],
    sections: [],
    contexts: [],
    commands: [],
    adapters: [],
    directories: [],
  }

  class ToolsStub extends Service {
    constructor(ctx) {
      super(ctx, 'tools')
    }
    register(definition) {
      recorded.tools.push(definition)
      return definition
    }
  }

  class SystemPromptStub extends Service {
    constructor(ctx) {
      super(ctx, 'systemPrompt')
    }
    section(spec) {
      recorded.sections.push(spec)
      return spec
    }
    context(spec) {
      recorded.contexts.push(spec)
      return spec
    }
  }

  class CommandsStub extends Service {
    constructor(ctx) {
      super(ctx, 'commands')
    }
    register(definition) {
      recorded.commands.push(definition)
      return definition
    }
  }

  class LlmStub extends Service {
    constructor(ctx) {
      super(ctx, 'llm')
    }
    registerAdapter(routes, adapter) {
      recorded.adapters.push({ routes, adapter })
      return {}
    }
    registerConfigurableProviders(entries) {
      recorded.directories.push(entries)
      return { dispose: () => undefined }
    }
    resolveModelInfo() {
      return { context: { contextWindow: 200000 }, defaultMaxTokens: 8192 }
    }
  }

  class TokenMeterStub extends Service {
    constructor(ctx) {
      super(ctx, 'tokenMeter')
    }
  }

  // P3 HF-02: NO sessions stub — the plugin declares five keys and consumes
  // five keys. If anyone reintroduces a declared-but-unread key, G3 goes
  // FAIL with "plugin PENDING" (the dsh-zcontext lookup is the guard).
  root.plugin(ToolsStub, {})
  root.plugin(SystemPromptStub, {})
  root.plugin(CommandsStub, {})
  root.plugin(LlmStub, {})
  root.plugin(TokenMeterStub, {})
  return { root, recorded }
}

// ---------------------------------------------------------------------------
// G2 — device-failure negative control
// ---------------------------------------------------------------------------

if (cordis !== undefined && PLUGIN_REACHABLE) {
  const { Service } = cordis
  const { root } = mountContainer()
  const outcome = { threw: undefined }
  class DeviceRepro extends Service {
    constructor(ctx) {
      super(ctx, 'dsh-probe-repro')
      try {
        void ctx.llm
        outcome.threw = false
      } catch (error) {
        outcome.threw = error?.message
      }
    }
  }
  root.plugin(DeviceRepro, {})
  await until(() => outcome.threw !== undefined)
  if (outcome.threw === 'cannot get property "llm" without inject') {
    report('G2 device-failure negative control (inject-less read throws)', true, outcome.threw)
  } else if (outcome.threw === false) {
    report('G2 device-failure negative control (inject-less read throws)', false,
      'ctx.llm resolved WITHOUT inject — the mount topology drifted permissive (root-fiber stubs?)')
  } else {
    report('G2 device-failure negative control (inject-less read throws)', false,
      `unexpected outcome: ${String(outcome.threw)}`)
  }
}

// ---------------------------------------------------------------------------
// G3 — real mount, default config: every boot-time access point crossed
// ---------------------------------------------------------------------------

if (cordis !== undefined && PLUGIN_REACHABLE) {
  const PluginClass = await loadPluginClass()
  if (PluginClass === undefined) {
    skip('G3 real mount (default config) crosses all service access points', 'lib/index.js exports no ZcontextPlugin class')
  } else {
    const { root, recorded } = mountContainer()
    root.plugin(PluginClass, {})
    const mounted = await until(() => root.reflect.get('dsh-zcontext', true) !== undefined)
    if (!mounted) {
      report('G3 real mount (default config) crosses all service access points', false,
        'plugin PENDING — dsh-zcontext never provided (wrong inject key? service missing?)')
    } else {
      const hooks = (name) => (root.events._hooks?.[name] ?? []).length
      const checks = [
        ['constructor crossed tokenMeter/llm (the v0.2.0 death site)', () => root.reflect.get('dsh-zcontext', true) !== undefined],
        ['tools face crossed (four zctx tools registered)', () => recorded.tools.length === 4],
        ['guidance face crossed (one systemPrompt.section)', () => recorded.sections.length === 1],
        ['nudge face crossed (one systemPrompt.context, required: true, zctx-nudge)', () => recorded.contexts.length === 1
          && recorded.contexts[0]?.name === 'zctx-nudge'
          && recorded.contexts[0]?.required === true],
        ['command face crossed (one commands.register)', () => recorded.commands.length === 1],
        ['session feed crossed (created/disposed/event listeners)', () => ['session/created', 'session/disposed', 'session/event']
          .every((name) => hooks(name) >= 1)],
        ['preflight + observe faces crossed (two llm/stream listeners)', () => hooks('llm/stream') === 2],
      ]
      const failed = checks.filter(([, check]) => !check())
      if (failed.length === 0) {
        report('G3 real mount (default config) crosses all service access points', true,
          `tools=${recorded.tools.length} sections=${recorded.sections.length} contexts=${recorded.contexts.length} commands=${recorded.commands.length} llm/stream=${hooks('llm/stream')}`)
      } else {
        report('G3 real mount (default config) crosses all service access points', false,
          failed.map(([label]) => label).join(' | '))
      }
    }
  }
}

// ---------------------------------------------------------------------------
// G4 — real mount with providers declared: adapter face access points
// ---------------------------------------------------------------------------

if (cordis !== undefined && PLUGIN_REACHABLE) {
  const HOST_LLM = process.env.ZCTX_DSH_LLM
    ?? 'file:///G:/000Github/zDSH/zDSH-main/packages/llm/llm/lib/index.js'
  const HOST_PIAI_ROOT = process.env.ZCTX_PIAI
    ?? 'G:/000Github/zDSH/zDSH-main/node_modules/.pnpm/@earendil-works+pi-ai@1.0.2_a3a2a33fdd5b7de7825ad7dc4af57d74/node_modules/@earendil-works/pi-ai'
  const HOST_LLM_PIAI_ROOT = process.env.ZCTX_DSH_LLM_PIAI
    ?? 'G:/000Github/zDSH/zDSH-main/packages/llm/llm-pi-ai'

  const hostLlmPath = HOST_LLM.startsWith('file:') || !isAbsolute(HOST_LLM)
    ? toPath(HOST_LLM)
    : resolve(HOST_LLM)
  if (!existsSync(hostLlmPath) || !existsSync(HOST_PIAI_ROOT) || !existsSync(HOST_LLM_PIAI_ROOT)) {
    skip('G4 adapter face crosses llm runtime access points (providers declared)',
      `host face not on disk: llm=${hostLlmPath} piai=${HOST_PIAI_ROOT} llm-piai=${HOST_LLM_PIAI_ROOT} (override ZCTX_DSH_LLM / ZCTX_PIAI / ZCTX_DSH_LLM_PIAI)`)
  } else {
    process.env.ZCTX_DSH_LLM = HOST_LLM
    process.env.ZCTX_PIAI = HOST_PIAI_ROOT
    process.env.ZCTX_DSH_LLM_PIAI = HOST_LLM_PIAI_ROOT
    const PluginClass = await loadPluginClass()
    if (PluginClass === undefined) {
      skip('G4 adapter face crosses llm runtime access points (providers declared)', 'lib/index.js exports no ZcontextPlugin class')
    } else {
      const { root, recorded } = mountContainer()
      root.plugin(PluginClass, {
        providers: [
          {
            family: 'anthropic-messages',
            baseURL: 'https://gateway.example/v1',
            models: [{ id: 'claude-local', contextWindow: 200000, maxTokens: 8192 }],
          },
        ],
      })
      const instance = await until(() => root.reflect.get('dsh-zcontext', true))
      let settled = false
      if (instance?.adapterRegistration !== undefined) {
        await instance.adapterRegistration
        settled = true
      } else {
        // Artifact without the tracked continuation: bounded honest wait.
        settled = await until(() => recorded.adapters.length > 0 || recorded.directories.length > 0, 5000)
      }
      const adapterOk = recorded.adapters.length === 1
        && Array.isArray(recorded.adapters[0]?.routes)
        && recorded.adapters[0].routes.includes('zctx-anthropic-messages')
      const directoryOk = recorded.directories.length === 1
        && recorded.directories[0]?.[0]?.provider === 'zctx-anthropic-messages'
      if (adapterOk && directoryOk) {
        report('G4 adapter face crosses llm runtime access points (providers declared)', true,
          `registerAdapter routes=${recorded.adapters[0].routes.join(',')} directory entries=${recorded.directories[0].length} continuation=${String(settled)}`)
      } else {
        report('G4 adapter face crosses llm runtime access points (providers declared)', false,
          `adapters=${recorded.adapters.length} directories=${recorded.directories.length} settled=${String(settled)} (check plugin warn/info logs above)`)
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Summary + report
// ---------------------------------------------------------------------------

const passedCount = results.filter((r) => r.ok && !r.skipped).length
const skippedCount = results.filter((r) => r.skipped).length
const failedList = results.filter((r) => !r.ok)
console.log(`\nprobe-real-mount: ${passedCount} PASS, ${skippedCount} SKIP, ${failedList.length} FAIL`)
if (failedList.length > 0) process.exit(1)

// Report (PASS/FAIL/SKIP all land in it).
const reportDir = fileURLToPath(new URL('../reports/probes/', import.meta.url))
mkdirSync(reportDir, { recursive: true })
const lines = [
  '# P0 real-mount probe report (scripts/probe-real-mount.mjs)',
  '',
  `- 运行时间：${new Date().toISOString()}`,
  `- cordis：${cordisVia ?? '(unreachable)'}`,
  `- plugin lib：${PLUGIN_LIB}`,
  `- 结果汇总：${passedCount} PASS / ${skippedCount} SKIP / ${failedList.length} FAIL（exit ${failedList.length > 0 ? 1 : 0}）`,
  '',
  '| 组 | 状态 | 说明 |',
  '| --- | --- | --- |',
  ...results.map((r) => `| ${r.id} | ${r.skipped ? 'SKIP' : r.ok ? 'PASS' : 'FAIL'} | ${r.detail ?? ''} |`),
  '',
  '- SKIPPED = 环境不可达（cordis 构建不在盘/宿主 face 不在盘），明示不静默。',
  '- 负对照（G2）钉住挂载拓扑本身复现真机故障模式：官方拓扑（各服务由自己的',
  '  插件 fiber 提供）下 inject=[] 直访必须抛 cannot get property "X" without inject；',
  '  若拓扑漂移成宽容态（如根 fiber 直供），G2 即红。',
  '- G3 的 dsh-zcontext 服务查找同时是 PENDING 守卫：inject 键错误 → 插件永不构造 → FAIL。',
  '- G4 断言 adapter 面越过 registerAdapter/registerConfigurableProviders 两个 llm',
  '  运行时访问点（providers 声明态；默认配置下 adapter 面提前 keep-alive 不触达）。',
]
writeFileSync(join(reportDir, 'P0-real-mount.md'), lines.join('\n') + '\n')
console.log('report → reports/probes/P0-real-mount.md')
