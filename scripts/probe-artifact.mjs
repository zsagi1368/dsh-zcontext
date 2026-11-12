// probe-artifact.mjs — W4-S3 artifact probe, in-repo and reproducible
// (REVIEW-W3W4 W4-3). Runs against the BUILT lib/index.js (not src) with
// `node scripts/probe-artifact.mjs` from the repo root.
//
// Probe groups (each prints PASS/FAIL/SKIP; exit 1 on any FAIL):
//   P1  identity + export surface of lib/index.js
//   P2  mock-host face wiring: 4 tools / 1 section / 1 required context /
//       1 command / 3 session-feed listeners
//   P3  S8: none of the four tools declares isConcurrencySafe
//   P4  end-to-end through the lib's REGISTERED tool face on an
//       official-shape mock session: zctx_fold commits a BARE UserMessage
//       checkpoint, zctx_status renders the ledger
//   P5  W3-1/W3-2 artifact pin through the REAL official
//       @deepseek-ai/dsh-session (skips with an explicit reason when the
//       build is absent; override the path with ZCTX_OFFICIAL_SESSION):
//       the plugin's fold/unfold checkpoints project through the official
//       deriveEventMessage as usable UserMessages, and cross-checkpoint
//       absorption windows are rejected as not contiguous (probe B2 shape)

import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

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
// The BUILT artifact is the system under test.
// ---------------------------------------------------------------------------

const libUrl = new URL('../lib/index.js', import.meta.url)
let zctx
try {
  zctx = await import(libUrl.href)
} catch (error) {
  console.error(`FATAL: cannot load the built lib at ${libUrl.href}: ${error}`)
  process.exit(1)
}

// ---------------------------------------------------------------------------
// Official-shape mock session (same contract as tests/helpers/mock-session.ts):
// user/message is the BARE UserMessage; system/assistant/tool keep envelopes.
// ---------------------------------------------------------------------------

function createMockSession(id) {
  const log = []
  const nodes = []
  const listeners = []
  let replaceGeneration = 0
  let contentGeneration = 0
  const session = {
    id,
    get seq() {
      return log.length
    },
    get surface() {
      return { nodes: [...nodes], replaceGeneration, contentGeneration }
    },
    eventAt(seq) {
      return log[seq]
    },
    onAppend(listener) {
      listeners.push(listener)
      return () => {
        const i = listeners.indexOf(listener)
        if (i >= 0) listeners.splice(i, 1)
      }
    },
    append(type, data, opts = {}) {
      const seq = log.length
      const op = opts.surfaceOp
      const event = Object.freeze({
        seq,
        type,
        data: structuredClone(data),
        ...(op === undefined ? {} : { surfaceOp: op }),
        ...(opts.sourceEventSeqs === undefined ? {} : { sourceEventSeqs: [...opts.sourceEventSeqs] }),
      })
      log.push(event)
      if (op === undefined || op === 'append') {
        nodes.push(seq)
      } else {
        const startIdx = nodes.indexOf(op.startSeq)
        const endIdx = nodes.indexOf(op.endSeq)
        if (startIdx === -1 || endIdx === -1 || startIdx > endIdx) {
          log.pop()
          throw new Error(`surface replace: invalid span ${op.startSeq}..${op.endSeq}`)
        }
        nodes.splice(startIdx, endIdx - startIdx + 1, seq)
        replaceGeneration += 1
        contentGeneration += 1
      }
      for (const listener of [...listeners]) listener(event)
      return event
    },
  }
  return session
}

const bareUser = (text) => ({ role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' } })
const asstEnvelope = (text) => ({
  message: { role: 'assistant', content: [{ type: 'text', text }], source: { kind: 'model', provider: 'deepseek', model: 'test-model' } },
})

/** Seed: 0 user | 1 assistant | 2 user | 3 assistant(+call-a) | 4 tool | 5 assistant | 6 user | 7 assistant. */
function seedConversation() {
  const session = createMockSession('probe-artifact')
  session.append('user/message', bareUser('Plan the migration.'), { surfaceOp: 'append' })
  session.append('assistant/message', asstEnvelope('Analysis plan: inventory first.'), { surfaceOp: 'append' })
  session.append('user/message', bareUser('Go ahead, list the files.'), { surfaceOp: 'append' })
  session.append('assistant/message', {
    message: {
      role: 'assistant',
      content: [
        { type: 'text', text: 'Listing files now.' },
        { type: 'tool-call', id: 'call-a', name: 'ls', arguments: '{}' },
      ],
      source: { kind: 'model', provider: 'deepseek', model: 'test-model' },
    },
  }, { surfaceOp: 'append' })
  session.append('tool/result', {
    turn: 0,
    step: 0,
    message: { role: 'tool', toolName: 'ls', toolCallId: 'call-a', content: [{ type: 'text', text: 'a.sql\nb.ts\nc.md' }], source: { kind: 'tool', callId: 'call-a' } },
  }, { surfaceOp: 'append' })
  session.append('assistant/message', asstEnvelope('Three files found; a.sql is the largest.'), { surfaceOp: 'append' })
  session.append('user/message', bareUser('Summarize the schema of a.sql.'), { surfaceOp: 'append' })
  session.append('assistant/message', asstEnvelope('Schema: two tables, one view.'), { surfaceOp: 'append' })
  return session
}

/** Mock host context (capability-probed faces; reflect.provide for cordis). */
function createMockCtx() {
  const registered = { tools: [], sections: [], contexts: [], commands: [] }
  const createdSessions = []
  const listeners = new Map()
  const ctx = {
    registered,
    createdSessions,
    logger: {
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    },
    tools: { register: (d) => registered.tools.push(d) },
    systemPrompt: {
      section: (s) => registered.sections.push(s),
      context: (c) => registered.contexts.push(c),
    },
    commands: { register: (c) => registered.commands.push(c) },
    tokenMeter: { measure: () => ({ totalTokens: 100000 }) },
    llm: {
      resolveModelInfo: async () => ({ context: { contextWindow: 200000 }, defaultMaxTokens: 8192 }),
    },
    reflect: { provide: () => undefined },
    on(event, listener) {
      const list = listeners.get(event) ?? []
      list.push(listener)
      listeners.set(event, list)
      return () => undefined
    },
    emit(event, ...args) {
      if (event === 'session/created') createdSessions.push(args[0])
      for (const listener of listeners.get(event) ?? []) listener(...args)
    },
    route(session) {
      session.requestHeader = () => ({ config: { provider: 'deepseek', model: 'test-model' } })
      return session
    },
  }
  return ctx
}

const FOLDABLE_CONFIG = {
  minFoldableTokens: 5,
  summaryFloorChars: 10,
  protectionFloorTokens: 0,
  keepRecentTokens: 0,
}

// ---------------------------------------------------------------------------
// P1 — identity + export surface.
// ---------------------------------------------------------------------------

{
  const expectedValues = [
    'name', 'configDefaults', 'configSchema', 'computeBudget', 'computeBreakevenReport',
    'estimateTokens', 'materializeRange', 'recall', 'crossedThresholds', 'nudgeContextText',
    'renderNudge', 'buildGuidanceSection', 'validateFold', 'FoldStore', 'CCM_MIN_CONTEXT_WINDOW',
    'ccmWindowGate', 'fold', 'foldableRanges', 'renderFoldReply', 'renderUnfoldReply',
    'unfold', 'ZcontextPlugin', 'NUDGE_CONTEXT_NAME', 'NUDGE_CONTEXT_ORDER', 'parseThresholds',
    'buildZctxTools', 'parseFoldContent', 'resolveDefineTool', 'renderStatus', 'buildZctxCommand',
  ]
  const missing = expectedValues.filter((k) => zctx[k] === undefined)
  const identityOk = zctx.name === 'dsh-zcontext' && zctx.default === zctx.ZcontextPlugin
  report(
    'P1 identity + exports',
    missing.length === 0 && identityOk,
    missing.length === 0
      ? `${expectedValues.length} value exports present, name/default identity ok`
      : `missing: ${missing.join(', ')}${identityOk ? '' : '; identity mismatch'}`,
  )
}

// ---------------------------------------------------------------------------
// P2 — mock-host face wiring (4/1/1/1/3).
// ---------------------------------------------------------------------------

{
  const ctx = createMockCtx()
  let wiringOk = false
  let detail
  try {
    new zctx.ZcontextPlugin(ctx, FOLDABLE_CONFIG)
    const r = ctx.registered
    const context = r.contexts[0] ?? {}
    wiringOk =
      r.tools.length === 4 &&
      r.sections.length === 1 &&
      r.contexts.length === 1 &&
      r.commands.length === 1 &&
      context.required === true &&
      ctx.createdSessions.length === 0
    // Feed listeners: count by wiring a probe listener per event name first.
    detail =
      `tools=[${r.tools.map((t) => t.name).join(',')}] sections=${r.sections.length} `
      + `contexts=${r.contexts.length}(required=${context.required === true}) `
      + `commands=${r.commands.length}`
  } catch (error) {
    detail = `plugin construction threw: ${error instanceof Error ? error.message : String(error)}`
  }
  // Listener count via a dedicated wiring whose `on` is observable.
  const ctx2 = createMockCtx()
  let feedListeners = 0
  const originalOn = ctx2.on.bind(ctx2)
  ctx2.on = (event, listener) => {
    if (event.startsWith('session/')) feedListeners += 1
    return originalOn(event, listener)
  }
  try {
    new zctx.ZcontextPlugin(ctx2, FOLDABLE_CONFIG)
  } catch {
    // P2's main verdict already covers construction failures.
  }
  report(
    'P2 face wiring',
    wiringOk === true && feedListeners === 3,
    `${detail ?? ''} feedListeners=${feedListeners}`,
  )
}

// ---------------------------------------------------------------------------
// P3 — S8: no isConcurrencySafe.
// ---------------------------------------------------------------------------

{
  const ctx = createMockCtx()
  try {
    new zctx.ZcontextPlugin(ctx, FOLDABLE_CONFIG)
  } catch {
    // fall through to the assertion on whatever got registered
  }
  const tools = ctx.registered.tools
  const offenders = tools.filter((t) => t.isConcurrencySafe !== undefined)
  report(
    'P3 S8 no isConcurrencySafe',
    tools.length === 4 && offenders.length === 0,
    tools.length === 4
      ? 'all four tools omit isConcurrencySafe'
      : `expected 4 tools, got ${tools.length}`,
  )
}

// ---------------------------------------------------------------------------
// P4 — end-to-end fold + status through the lib's registered tool face.
// ---------------------------------------------------------------------------

{
  const ctx = createMockCtx()
  let ok = false
  let detail = ''
  try {
    new zctx.ZcontextPlugin(ctx, FOLDABLE_CONFIG)
    const session = ctx.route(seedConversation())
    ctx.emit('session/created', session)
    const foldTool = ctx.registered.tools.find((t) => t.name === 'zctx_fold')
    const statusTool = ctx.registered.tools.find((t) => t.name === 'zctx_status')
    if (foldTool === undefined || statusTool === undefined) {
      throw new Error('tool face unavailable')
    }
    const reply = await foldTool.execute(
      { content: 'fold 3..5\nFiles listed: a.sql, b.ts, c.md; three files reported.' },
      { agent: { session } },
    )
    const foldOk =
      /^Folded seqs 3–5, ~\d+ tokens reclaimed \(1 checkpoint, 0 earlier folds absorbed\)$/.test(reply)
    const cpSeq = Math.max(...session.surface.nodes)
    const cpData = session.eventAt(cpSeq)?.data
    const bareOk =
      cpData !== undefined && cpData.role === 'user' && Array.isArray(cpData.content)
      && cpData.source?.kind === 'zctx-fold'
    const status = await statusTool.execute({}, { agent: { session } })
    const statusOk = status.includes('Folds (1 active)') && status.includes('window:')
    ok = foldOk && bareOk && statusOk
    detail = `fold=${foldOk} checkpointBareUserMessage=${bareOk} status=${statusOk}`
  } catch (error) {
    detail = `threw: ${error instanceof Error ? error.message : String(error)}`
  }
  report('P4 end-to-end fold + status through lib tools', ok, detail)
}

// ---------------------------------------------------------------------------
// P5 — W3-1/W3-2 pin through the REAL official session (skip when absent).
// ---------------------------------------------------------------------------

const OFFICIAL_SESSION_URL =
  process.env.ZCTX_OFFICIAL_SESSION ?? 'file:///G:/000Github/zDSH/zDSH-main/packages/core/session/lib/index.js'
const officialPath = fileURLToPath(new URL(OFFICIAL_SESSION_URL))
if (!existsSync(officialPath)) {
  skip('P5 real-session W3-1 projection + W3-2 rejection pin', `official session build not found at ${officialPath}`)
} else {
  let ok = false
  let detail = ''
  try {
    const { Session, SessionId } = await import(OFFICIAL_SESSION_URL)
    const session = Session.create(SessionId('zctx-probe-artifact'))
    const mkUser = (t) => ({ role: 'user', content: [{ type: 'text', text: t }], source: { kind: 'user' } })
    const mkAsst = (t) => ({ message: { role: 'assistant', content: [{ type: 'text', text: t }], source: { kind: 'model', provider: 'deepseek', model: 'test-model' } } })
    session.append('user/message', mkUser('u0 seed question text'), { surfaceOp: 'append' })
    session.append('assistant/message', mkAsst('a1 long enough answer text for folding and reasonably verbose to be foldable'), { surfaceOp: 'append' })
    session.append('user/message', mkUser('u2 next question text'), { surfaceOp: 'append' })
    const store = new zctx.FoldStore()
    store.attach(session)
    const config = {
      ...FOLDABLE_CONFIG,
      maxFoldFraction: 0.6,
      summaryCeilingChars: 20000,
      netShrinkTolerance: 1.05,
      contextWindow: 200000,
    }
    const r = zctx.fold(session, store, {
      range: { startSeq: 1, endSeq: 1 },
      summaries: [{ startSeq: 1, endSeq: 1, text: 'Seed turn condensed into one short note.' }],
    }, config)
    if (!r.ok) throw new Error(`fold rejected: ${r.reasons.join(' | ')}`)
    const cp = r.committed[0].checkpointSeq
    const m = session.deriveEventMessage(session.eventAt(cp))
    const projOk = m.role === 'user' && Array.isArray(m.content)
    const unfold = zctx.unfold(session, store, r.committed[0].foldId)
    if (!unfold.ok) throw new Error(`unfold rejected: ${unfold.reasons.join(' | ')}`)
    const m2 = session.deriveEventMessage(session.eventAt(unfold.committed[0].checkpointSeq))
    const projUnfoldOk = m2.role === 'user' && Array.isArray(m2.content)
    // W3-2: cross-checkpoint window rejected as not contiguous (probe B2 S1
    // shape) — post-unfold the surface holds re-materialized nodes; a window
    // spanning from node 0 through everything trips protected zones too, but
    // the contiguity reason must be among them.
    const surface = store.surfaceNodes().map((n) => n.seq)
    const last = surface[surface.length - 1]
    const cross = zctx.fold(session, store, {
      range: { startSeq: surface[0], endSeq: last },
      summaries: [{ startSeq: surface[0], endSeq: last, text: 'Cross-checkpoint coverage summary text here.' }],
    }, config)
    const crossOk = cross.ok === false && cross.reasons.some((x) => x.includes('not contiguous on the surface'))
    ok = projOk && projUnfoldOk && crossOk
    detail = `foldProjection=${projOk} unfoldProjection=${projUnfoldOk} crossCheckpointRejected=${crossOk} surface=[${surface.join(',')}] cp=${cp}`
  } catch (error) {
    detail = `threw: ${error instanceof Error ? error.message : String(error)}`
  }
  report('P5 real-session W3-1 projection + W3-2 rejection pin', ok, detail)
}

// ---------------------------------------------------------------------------

const failed = results.filter((r) => !r.ok)
const skipped = results.filter((r) => r.skipped === true)
console.log(`\nprobe-artifact: ${results.length - failed.length - skipped.length} PASS, ${skipped.length} SKIP, ${failed.length} FAIL`)
process.exit(failed.length > 0 ? 1 : 0)
