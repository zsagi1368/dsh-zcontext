/**
 * ZCTX-UI B4 D5 acceptance tests — face tri-state probe + fail-soft sink
 * (DESIGN §4 / V5 / V6 / Z28).
 *
 * V5: three signals (tools.register / guidance / observe-guard) → active /
 *     degraded / absent with human-readable evidence, no credential leakage.
 * V6: on degraded/absent a line reaches a VISIBLE sink (default stderr; test
 *     injects a recorder) — never only ctx.logger.warn. Snapshot.faceHealth
 *     carries the view. Absence is recomputed on every call (Z25: no memoize).
 */

import { describe, expect, it } from 'vitest'

import {
  detectFaceActivation,
  createTransitionSink,
  unknownFaceHealth,
  type FaceProbeState,
  type FaceHealthView,
  type HostContextLike,
} from '../src/ui/index.ts'

/** Host context with all capabilities present. */
const capableCtx: HostContextLike = {
  tools: { register: () => undefined },
  systemPrompt: { section: () => undefined, context: () => undefined },
}

/** Empty host context (no capabilities). */
const bareCtx: HostContextLike = {}

/** Fully-active observable state. */
const activeState: FaceProbeState = {
  toolFaceRegistered: 4,
  toolFaceBuilt: 4,
  guidanceRegistered: true,
  observeWired: true,
  guardBridgePresent: true,
  guardRecordsSeen: 3,
}

describe('ZCTX-UI D5: face tri-state probe (V5)', () => {
  it('all three signals on disk → active with 3 OK evidence rows', () => {
    const view = detectFaceActivation(capableCtx, activeState, () => undefined)
    expect(view.state).toBe('active')
    expect(view.evidence).toHaveLength(3)
    expect(view.evidence.every((e) => e.ok)).toBe(true)
    expect(view.evidence.map((e) => e.signal)).toEqual(
      expect.arrayContaining(['tools.register', 'system-prompt.guidance', 'guard-observe']),
    )
    expect(view.probedAt).toBeGreaterThan(0)
    expect(view.summary).toContain('激活')
  })

  it('tools registered but guidance absent → degraded with rejected-signal detail', () => {
    const view = detectFaceActivation(capableCtx, {
      ...activeState,
      guidanceRegistered: false,
    }, () => undefined)
    expect(view.state).toBe('degraded')
    const guidance = view.evidence.find((e) => e.signal === 'system-prompt.guidance')
    expect(guidance?.ok).toBe(false)
    expect(guidance?.detail).toContain('not injected')
  })

  it('built but registration refused → degraded with "registration refused" detail (P3 HF-15)', () => {
    const view = detectFaceActivation(capableCtx, {
      ...activeState,
      toolFaceRegistered: 0,
      toolFaceBuilt: 4,
    }, () => undefined)
    expect(view.state).toBe('degraded')
    const tools = view.evidence.find((e) => e.signal === 'tools.register')
    expect(tools?.detail).toContain('registration refused')
  })

  it('no capabilities + no flags → absent with "未激活" summary', () => {
    const view = detectFaceActivation(bareCtx, {
      toolFaceRegistered: 0,
      toolFaceBuilt: 0,
      guidanceRegistered: false,
      observeWired: false,
      guardBridgePresent: false,
      guardRecordsSeen: 0,
    }, () => undefined)
    expect(view.state).toBe('absent')
    expect(view.summary).toContain('未激活')
  })

  it('capability on disk but no registration → degraded (not absent)', () => {
    const view = detectFaceActivation(capableCtx, {
      toolFaceRegistered: 0,
      toolFaceBuilt: 0,
      guidanceRegistered: false,
      observeWired: false,
      guardBridgePresent: false,
      guardRecordsSeen: 0,
    }, () => undefined)
    // capabilities exist → partial presence → degraded, never a false "alive"
    expect(view.state).toBe('degraded')
  })

  it('ctx.tools getter throws (cordis get-trap) → fail-soft evidence, no throw', () => {
    const trapCtx = {} as HostContextLike
    Object.defineProperty(trapCtx, 'tools', {
      get() { throw new Error('cannot get property "tools" without inject') },
    })
    let view: FaceHealthView | undefined
    expect(() => {
      view = detectFaceActivation(trapCtx, activeState, () => undefined)
    }).not.toThrow()
    expect(view).toBeDefined()
    expect(view!.state).toBe('degraded')
    expect(view!.evidence.find((e) => e.signal === 'tools.register')?.detail).toContain('capability absent')
  })

  it('no guard records → legal-inert note, still active when observe+guard present', () => {
    const view = detectFaceActivation(capableCtx, {
      ...activeState,
      guardRecordsSeen: 0,
    }, () => undefined)
    expect(view.state).toBe('active')
    expect(view.evidence.find((e) => e.signal === 'guard-observe')?.detail).toContain('legal inert')
  })
})

describe('ZCTX-UI D5: fail-soft visible sink (V6 / Z28)', () => {
  it('degraded state writes one diagnostic line to the injected visible sink', () => {
    const lines: string[] = []
    const view = detectFaceActivation(capableCtx, {
      ...activeState,
      guidanceRegistered: false,
    }, (line) => { lines.push(line) })
    expect(view.state).toBe('degraded')
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('[zctx-ui] face degraded')
    expect(lines[0]).toContain('system-prompt.guidance')
  })

  it('absent state writes a visible line too', () => {
    const lines: string[] = []
    detectFaceActivation(bareCtx, {
      toolFaceRegistered: 0, toolFaceBuilt: 0, guidanceRegistered: false,
      observeWired: false, guardBridgePresent: false, guardRecordsSeen: 0,
    }, (line) => { lines.push(line) })
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('[zctx-ui] face absent')
  })

  it('active state writes NOTHING to the sink (no false alarm)', () => {
    let calls = 0
    detectFaceActivation(capableCtx, activeState, () => { calls += 1 })
    expect(calls).toBe(0)
  })

  it('no memoization: absent then present re-probes to active on next call (Z25)', () => {
    const lines: string[] = []
    const sink = (line: string) => { lines.push(line) }
    const absent: FaceProbeState = {
      toolFaceRegistered: 0, toolFaceBuilt: 0, guidanceRegistered: false,
      observeWired: false, guardBridgePresent: false, guardRecordsSeen: 0,
    }
    const first = detectFaceActivation(bareCtx, absent, sink)
    const second = detectFaceActivation(capableCtx, activeState, sink)
    expect(first.state).toBe('absent')
    expect(second.state).toBe('active')
    expect(lines).toHaveLength(1) // only the first (absent) wrote a line
  })

  it('createTransitionSink dedups repeated identical lines but passes transitions', () => {
    const lines: string[] = []
    const sink = createTransitionSink((line) => { lines.push(line) })
    sink('[zctx-ui] face degraded: X')
    sink('[zctx-ui] face degraded: X')
    sink('[zctx-ui] face absent: Y')
    sink('[zctx-ui] face absent: Y')
    expect(lines).toEqual([
      '[zctx-ui] face degraded: X',
      '[zctx-ui] face absent: Y',
    ])
  })

  it('unknownFaceHealth is an honest bootstrap view (not a fake active)', () => {
    const view = unknownFaceHealth()
    expect(view.state).toBe('absent')
    expect(view.evidence).toEqual([])
    expect(view.summary).toContain('尚未采集')
  })
})
