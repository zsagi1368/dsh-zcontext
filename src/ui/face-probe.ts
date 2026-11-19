/**
 * Desktop face-activation probe (ZCTX-UI DESIGN §4) — D5.
 *
 * A machine-readable judgement of "is the zctx face alive in THIS composition"
 * (V5, BENCH-L2 prerequisite). It is NOT a claim to solve BENCH-L2, which stays
 * `user_approved_deferred` until real-device tri-evidence (§4.3).
 *
 * THREE OBSERVABLE SIGNALS (Z28 tri-evidence):
 *   1. tools.register — did the tool face actually register?
 *   2. system-prompt.guidance — was the guidance section injected?
 *   3. guard-observe / observe — is the observe listener + guard bridge on disk?
 *
 * FAIL-SOFT + VISIBLE SINK (Z28): every signal is try/catch-wrapped; any fault
 * yields evidence(ok:false, detail) rather than a throw. On degraded/absent the
 * probe writes ONE diagnostic line to a composition-independent visible sink —
 * default `process.stderr` (headless/web/desktop all have it), injectable in
 * tests. It never relies on `ctx.logger.warn` alone (headless has no sink).
 *
 * NO MEMOIZATION (Z25): the probe recomputes on every call; absence is never
 * cached, so a face that appears later is detected on the next on-demand probe.
 *
 * @module ui/face-probe
 */

/** Tri-state activation grade. */
export type FaceState = 'active' | 'degraded' | 'absent'

/** One probe signal's outcome. `detail` is human-readable and never leaks credentials. */
export interface FaceEvidence {
  readonly signal: 'tools.register' | 'system-prompt.guidance' | 'guard-observe' | 'observe' | 'webServer'
  readonly ok: boolean
  readonly detail: string
}

/** Observable counters the plugin hands the probe (DESIGN §4.1). */
export interface FaceProbeState {
  readonly toolFaceRegistered: number
  readonly toolFaceBuilt: number
  readonly guidanceRegistered: boolean
  readonly observeWired: boolean
  readonly guardBridgePresent: boolean
  readonly guardRecordsSeen: number
  /**
   * Whether the host webServer service is available (ZCTX-UI P0). When false,
   * the four /zctx-ui routes cannot register and the UI is unreachable — the
   * probe surfaces this so "UI empty" vs "face dead" stays distinguishable.
   * Optional so legacy/probe-unit callers keep the 3-signal semantics.
   */
  readonly webServerPresent?: boolean
}

/** The view consumed by the snapshot and rendered in the UI "view" block. */
export interface FaceHealthView {
  readonly state: FaceState
  readonly evidence: readonly FaceEvidence[]
  readonly probedAt: number
  readonly summary: string
}

/** Structural host surface the probe capability-checks (duck-typed). */
export interface HostContextLike {
  readonly tools?: { register?(definition: unknown): unknown }
  readonly systemPrompt?: { section?(spec: unknown): unknown; context?(spec: unknown): unknown }
}

/** Sink signature (injectable in tests, stderr by default). */
export type FaceSink = (line: string) => void

/** Default visible sink — stderr, never throws (a diagnostic must not break boot). */
const defaultSink: FaceSink = (line: string): void => {
  try {
    process.stderr.write(`${line}\n`)
  } catch {
    /* diagnostic sink must never throw */
  }
}

/** Safely read a possibly-throwing capability (cordis get-trap: ctx.tools may throw). */
function capability<T>(read: () => T | undefined): T | undefined {
  try {
    return read()
  } catch {
    return undefined
  }
}

/**
 * Run the three-signal face probe on demand. Pure with respect to the probe
 * result (fresh every call, no caching); the only side effect is an optional
 * visible sink line when the state is not `active`.
 *
 * @param ctx   host context, capability-probed (may be a bare/mock object)
 * @param state observable counters maintained by plugin.ts wire*Face
 * @param sink  visible sink; defaults to stderr. Tests inject a recorder.
 */
export function detectFaceActivation(
  ctx: HostContextLike,
  state: FaceProbeState,
  sink?: FaceSink,
): FaceHealthView {
  const probedAt = Date.now()
  const evidence: FaceEvidence[] = []

  // Signal 1 — tools.register (capability + recorded registration).
  let toolsCapable = false
  let toolsOk = false
  try {
    const register = capability(() => ctx.tools?.register)
    toolsCapable = typeof register === 'function'
    if (!toolsCapable) {
      evidence.push({ signal: 'tools.register', ok: false, detail: 'ctx.tools.register capability absent' })
    } else if (state.toolFaceRegistered > 0) {
      toolsOk = true
      evidence.push({ signal: 'tools.register', ok: true, detail: `registered=${state.toolFaceRegistered}` })
    } else if (state.toolFaceBuilt > 0) {
      evidence.push({
        signal: 'tools.register',
        ok: false,
        detail: `tools built=${state.toolFaceBuilt} but registered=0 (registration refused)`,
      })
    } else {
      evidence.push({ signal: 'tools.register', ok: false, detail: 'no tools face built' })
    }
  } catch (error: unknown) {
    evidence.push({ signal: 'tools.register', ok: false, detail: `probe fault: ${error instanceof Error ? error.message : String(error)}` })
  }

  // Signal 2 — system-prompt.guidance (capability + recorded injection).
  let guidanceCapable = false
  let guidanceOk = false
  try {
    const section = capability(() => ctx.systemPrompt?.section)
    guidanceCapable = typeof section === 'function'
    if (!guidanceCapable) {
      evidence.push({ signal: 'system-prompt.guidance', ok: false, detail: 'ctx.systemPrompt.section capability absent' })
    } else if (state.guidanceRegistered) {
      guidanceOk = true
      evidence.push({ signal: 'system-prompt.guidance', ok: true, detail: 'guidance section injected' })
    } else {
      evidence.push({ signal: 'system-prompt.guidance', ok: false, detail: 'section capability on disk but guidance not injected' })
    }
  } catch (error: unknown) {
    evidence.push({ signal: 'system-prompt.guidance', ok: false, detail: `probe fault: ${error instanceof Error ? error.message : String(error)}` })
  }

  // Signal 3 — observe / guard-observe on disk (+ behavior-trace bonus).
  let observeOk = false
  try {
    observeOk = state.observeWired && state.guardBridgePresent
    const trace = state.guardRecordsSeen > 0 ? `, guard records=${state.guardRecordsSeen}` : ', no guard records (legal inert)'
    evidence.push({
      signal: 'guard-observe',
      ok: observeOk,
      detail: observeOk
        ? `observe wired + guard bridge present${trace}`
        : `observe wired=${state.observeWired}, guard bridge=${state.guardBridgePresent}`,
    })
  } catch (error: unknown) {
    evidence.push({ signal: 'guard-observe', ok: false, detail: `probe fault: ${error instanceof Error ? error.message : String(error)}` })
  }

  // Signal 4 — webServer (ZCTX-UI P0): the host HTTP surface the UI routes need.
  // Only asserted when the caller supplies the flag (legacy 3-signal callers
  // are unaffected). A missing webServer is a DEGRADE, never 'active'.
  let webServerOk = true
  if (state.webServerPresent !== undefined) {
    webServerOk = state.webServerPresent
    evidence.push({
      signal: 'webServer',
      ok: webServerOk,
      detail: webServerOk
        ? 'webServer service available — /zctx-ui routes can register'
        : 'webServer service unavailable — /zctx-ui routes NOT registered (UI unreachable)',
    })
  }

  // Tri-state ruling (DESIGN §4.1). webServer absent forces a degrade: the UI
  // cannot be served, so reporting 'active' would be a false-green.
  const anyCapability = toolsCapable || guidanceCapable
  const anyFlag = toolsOk || guidanceOk || state.toolFaceBuilt > 0 || state.observeWired || state.guardBridgePresent
  const active = webServerOk && toolsOk && guidanceOk && (state.observeWired || state.guardBridgePresent)
  const result: FaceState = active
    ? 'active'
    : (!anyCapability && !anyFlag && webServerOk)
      ? 'absent'
      : 'degraded'

  const view: FaceHealthView = {
    state: result,
    evidence,
    probedAt,
    summary: active
      ? '桌面 face 三重信号齐全（tools + guidance + observe/guard），webServer 在位，已激活'
      : result === 'degraded'
        ? 'face 部分信号缺席或被拒：' + evidence.filter((e) => !e.ok).map((e) => e.signal).join(', ')
        : '桌面 face 未激活（无 tools/guidance/observe 信号）',
  }

  // Visible sink (Z28): any non-active state writes one diagnostic line. Never
  // memoized — recomputed each call; the caller may wrap the sink to dedup.
  if (result !== 'active') {
    try {
      (sink ?? defaultSink)(`[zctx-ui] face ${result}: ${view.summary}`)
    } catch {
      /* visible sink must never throw */
    }
  }
  return view
}

/**
 * A transition-deduping sink for production: emits a line only when the
 * diagnostic text changes (first degraded/absent + state transitions), so a
 * 5s UI poll does not spam stderr. This dedups SINK EMISSION only — the probe
 * itself still recomputes on demand (Z25: no memoized absence).
 */
export function createTransitionSink(write: FaceSink = defaultSink): FaceSink {
  let lastLine = ''
  return (line: string): void => {
    if (line === lastLine) return
    lastLine = line
    write(line)
  }
}

/** Honest bootstrap view for paths with no probe state yet (B3 compatibility). */
export function unknownFaceHealth(): FaceHealthView {
  return {
    state: 'absent',
    evidence: [],
    probedAt: Date.now(),
    summary: 'face 探针尚未采集信号（bootstrap）',
  }
}
