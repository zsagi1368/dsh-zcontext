/**
 * Desktop face-activation probe contract (ZCTX-UI DESIGN §4).
 *
 * PHASE-ONE SCOPE (B3): this module defines the full tri-state vocabulary
 * (`FaceState` / `FaceEvidence` / `FaceProbeState` / `detectFaceActivation`)
 * and an honest minimal view derived from observable plugin state. The full
 * three-signal probe + visible sink (stderr fail-soft, never memoized) is
 * delivered in B4 — the seam and types are already stable so the snapshot API
 * and UI can consume `faceHealth` without churn.
 *
 * The probe is a machine-readable judgement of "is the zctx face alive in THIS
 * composition" (V5, BENCH-L2 prerequisite) — it is NOT a claim to solve
 * BENCH-L2, which stays `user_approved_deferred` until real-device tri-evidence.
 *
 * @module ui/face-probe
 */

/** Tri-state activation grade. */
export type FaceState = 'active' | 'degraded' | 'absent'

/** One probe signal's outcome. `detail` is human-readable and never leaks credentials. */
export interface FaceEvidence {
  readonly signal: 'tools.register' | 'system-prompt.guidance' | 'guard-observe' | 'observe'
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
}

/** The view consumed by the snapshot and rendered in the UI "view" block. */
export interface FaceHealthView {
  readonly state: FaceState
  readonly evidence: readonly FaceEvidence[]
  readonly probedAt: number
  readonly summary: string
}

/** Structural host surface used by the probe (capability-probed in B4). */
export interface HostContextLike {
  readonly tools?: { register?(definition: unknown): unknown }
  readonly systemPrompt?: { section?(spec: unknown): unknown; context?(spec: unknown): unknown }
}

/**
 * Honest phase-one face view. With a `FaceProbeState` supplied, derive the
 * tri-state from the observable counts; with no state (the common B3 path),
 * return an `absent`-with-unknown view that explicitly says the full probe
 * lands in B4 — never a fabricated "active".
 *
 * @param state optional observable counters (B4 wires the real probe body)
 * @param sink  optional visible sink; fail-soft degradation writes here (B4 uses stderr by default)
 */
export function detectFaceActivation(
  state?: FaceProbeState,
  sink?: (line: string) => void,
): FaceHealthView {
  const probedAt = Date.now()
  if (state === undefined) {
    return {
      state: 'absent',
      evidence: [],
      probedAt,
      summary: 'face 探针阶段二接入（B4）：当前仅有接口，未采集三重证据',
    }
  }
  const evidence: FaceEvidence[] = []
  const toolsOk = state.toolFaceRegistered > 0
  evidence.push({
    signal: 'tools.register',
    ok: toolsOk,
    detail: toolsOk
      ? `tools registered=${state.toolFaceRegistered}`
      : state.toolFaceBuilt > 0
        ? `tools built=${state.toolFaceBuilt} but registered=0 (registration refused)`
        : 'no tools face built',
  })
  evidence.push({
    signal: 'system-prompt.guidance',
    ok: state.guidanceRegistered,
    detail: state.guidanceRegistered ? 'guidance section registered' : 'guidance section absent',
  })
  const observeOk = state.observeWired && state.guardBridgePresent
  evidence.push({
    signal: 'guard-observe',
    ok: observeOk,
    detail: observeOk
      ? `observe wired, guard records=${state.guardRecordsSeen}`
      : 'observe / guard bridge not wired',
  })
  const active = toolsOk && state.guidanceRegistered && (state.observeWired || state.guardBridgePresent)
  const anyPresent = toolsOk || state.toolFaceBuilt > 0 || state.guidanceRegistered || state.observeWired || state.guardBridgePresent
  const result: FaceState = active ? 'active' : anyPresent ? 'degraded' : 'absent'
  const view: FaceHealthView = {
    state: result,
    evidence,
    probedAt,
    summary: result === 'active'
      ? 'face 三重信号齐全，桌面 face 已激活'
      : result === 'degraded'
        ? 'face 部分信号缺席或被拒，处于降级态'
        : '桌面 face 未激活（无 tools/guidance/observe 信号）',
  }
  if (result !== 'active') {
    const line = `[zctx-ui] face ${result}: ${view.summary}`
    try {
      (sink ?? ((text: string) => { process.stderr.write(`${text}\n`) }))(line)
    } catch {
      /* visible sink must never throw */
    }
  }
  return view
}

/** A phase-one "no state" view — an explicit, honest unknown, not a fake active. */
export function unknownFaceHealth(): FaceHealthView {
  return detectFaceActivation(undefined)
}
