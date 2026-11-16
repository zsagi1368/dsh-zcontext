// P6-D benchmark runner: drives the zDSH headless CLI through a fixed prompt
// script, chaining one session across invocations via --session-id.
//
// Per invocation (== one user turn):
//   stdout  = newline-delimited JSON event stream (--json)
//   events  = session / status(turn_start|step_start|step_end|turn_end) /
//             thinking / text / tool_call / tool_result / final / error
//   step_end.usage = {inputTokens, outputTokens, cacheReadTokens?,
//                     cacheWriteTokens?, reasoningTokens?} (disjoint counts;
//                     billed input = input + cacheRead + cacheWrite)
//
// Outputs (under bench home):
//   raw/<key>.jsonl              — full event stream, one file per session
//   summaries/<key>.jsonl        — one summary line per turn (append)
//   state/<key>.json             — chained sessionId + next turn index
import { spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const HOME = 'C:/Users/ZS/AppData/Local/Temp/zctx-bench-home'
const BIN = 'G:/000Github/zDSH/zDSH-main/apps/cli/lib/bin.js'
function arg(name, fallback) {
  const i = process.argv.indexOf(name)
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback
}

const group = arg('--group', 'C')
const turns = Number(arg('--turns', '10'))
const timeoutMs = Number(arg('--timeout-ms', '300000'))
const key = arg('--session-key', group) // identifies one chained session
const scratch = arg('--scratch', join(HOME, 'scratch', group.toLowerCase()))
const PROMPTS_FILE = join(HOME, 'harness', arg('--prompts', 'prompts-pilot.json'))
const prompts = JSON.parse(readFileSync(PROMPTS_FILE, 'utf8')).prompts
if (turns > prompts.length) throw new Error(`only ${prompts.length} scripted prompts available`)

const rawPath = join(HOME, 'raw', `${key}.jsonl`)
const sumPath = join(HOME, 'summaries', `${key}.jsonl`)
const statePath = join(HOME, 'state', `${key}.json`)
for (const p of [rawPath, sumPath, statePath]) mkdirSync(join(p, '..'), { recursive: true })

const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : { sessionId: undefined, nextTurn: 0 }
mkdirSync(scratch, { recursive: true })

const env = { ...process.env, DSH_HOME: HOME, DSH_AGENTS_HOME: join(HOME, 'agents-home') }

for (let t = state.nextTurn; t < turns; t++) {
  const prompt = prompts[t]
  const args = ['--profile', 'bench', '--json']
  if (state.sessionId) args.push('--session-id', state.sessionId)
  args.push(prompt)
  const t0 = Date.now()
  const res = spawnSync(process.execPath, [BIN, ...args], {
    cwd: scratch, env, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 256 * 1024 * 1024,
  })
  const durationMs = Date.now() - t0
  const stdout = String(res.stdout || '')
  appendFileSync(rawPath, stdout)

  const events = []
  let sessionId
  let errorText
  let turnEndReason
  for (const line of stdout.split('\n')) {
    if (!line.trim()) continue
    let ev
    try { ev = JSON.parse(line) } catch { continue }
    events.push(ev)
    if (ev.type === 'session') sessionId = ev.sessionId
    if (ev.type === 'error') errorText = ev.message
    if (ev.type === 'status' && ev.phase === 'turn_end') turnEndReason = ev.reason
  }

  // per-turn usage: sum over step_end events
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 }
  let steps = 0
  let stepsWithUsage = 0
  const toolCounts = {}
  const foldCalls = []
  for (const ev of events) {
    if (ev.type === 'status' && ev.phase === 'step_end') {
      steps++
      if (ev.usage) {
        stepsWithUsage++
        usage.input += ev.usage.inputTokens || 0
        usage.output += ev.usage.outputTokens || 0
        usage.cacheRead += ev.usage.cacheReadTokens || 0
        usage.cacheWrite += ev.usage.cacheWriteTokens || 0
        usage.reasoning += ev.usage.reasoningTokens || 0
      }
    }
    if (ev.type === 'tool_call') {
      toolCounts[ev.tool] = (toolCounts[ev.tool] || 0) + 1
      if (ev.tool === 'zctx_fold') foldCalls.push(ev.input)
    }
  }
  const billedInput = usage.input + usage.cacheRead + usage.cacheWrite
  const summary = {
    group, sessionKey: key, turn: t + 1, sessionId, exitCode: res.status, signal: res.signal,
    durationMs, steps, stepsWithUsage, usage, billedInput,
    toolCounts, foldCalls, turnEndReason, error: errorText || undefined,
    timedOut: res.error?.code === 'ETIMEDOUT' || res.signal === 'SIGTERM',
    stderrTail: String(res.stderr || '').split('\n').filter(Boolean).slice(-6),
    promptPreview: prompt.slice(0, 60),
  }
  appendFileSync(sumPath, JSON.stringify(summary) + '\n')
  state.nextTurn = t + 1
  if (sessionId) state.sessionId = sessionId
  writeFileSync(statePath, JSON.stringify(state, null, 1))
  console.log(`[${key}] turn ${t + 1}/${turns} exit=${res.status} steps=${steps}/${stepsWithUsage}usage billedIn=${billedInput} fold=${toolCounts.zctx_fold || 0} ${durationMs}ms`)
  // Stop the chain on hard failure: a broken session cannot be resumed honestly.
  if (res.status !== 0) {
    console.log(`[${key}] turn ${t + 1} FAILED (exit ${res.status}) — chain aborted at turn ${t + 1}`)
    break
  }
}
console.log(`[${key}] done: nextTurn=${state.nextTurn}`)
