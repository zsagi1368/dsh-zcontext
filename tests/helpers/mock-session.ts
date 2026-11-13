/**
 * Official-aligned mock Session for W3/W4 tests (task card W3 §2, S5 mock
 * mode): the four official hard checks a replace producer must satisfy are
 * ENFORCED here the way the official SurfaceManager.validateNext enforces
 * them (session/src/surface.ts), so a plugin commit that would be rejected by
 * the real session fails the mock too:
 *
 *   1. sourceEventSeqs must be EXACTLY the shadowed surface set
 *      (official: "must include every shadowed surface node" — the mock
 *      asserts the stricter exact-equality the task card freezes);
 *   2. replace endpoints must exist as surface nodes (ordered membership);
 *   3. node 0 holding a system/message may only be rewritten by a
 *      system/message over exactly that node (assertSystemHeadRewrite);
 *   4. a tool/result replace may change only the content of exactly one
 *      current tool/result node (assertToolResultRewrite).
 *
 * Surface bookkeeping mirrors applySurfaceEvent: append pushes the seq;
 * replace splices and bumps both generation counters.
 *
 * The mock is NOT a re-implementation of the official session: real-mode
 * tests (S5) exercise the genuine @deepseek-ai/dsh-session — this mock only
 * guarantees the mock-mode tests cannot drift past the official guards.
 *
 * Payload shapes follow the official event contract exactly: user/message is
 * the BARE UserMessage (types.ts:309); system/assistant/tool keep their
 * {turn, step, message}-family envelopes (types.ts:330-375).
 */

import type { SessionEventLike, SurfaceOpLike } from '../../src/types.ts'

/** Minimal message payload accepted by the mock (JSON-serializable). */
export type MockMessage = {
  role: string
  content: unknown
  id?: string
  toolCallId?: string
  toolName?: string
  source?: Record<string, unknown>
}

export interface MockEvent extends SessionEventLike {
  readonly data: Record<string, unknown>
}

export type MockListener = (event: SessionEventLike) => void

/** Official-aligned replace metadata the mock enforces. */
export interface MockSurfaceOpts {
  readonly surfaceOp?: SurfaceOpLike
  readonly sourceEventSeqs?: readonly number[]
}

/**
 * Surface event types (official session/src/types.ts:439-444). Official
 * discipline: "Non-surface events (boundary markers, attempts, errors) never
 * carry surface metadata" (session/src/types.ts:486-490) — the mock mirrors
 * that by keeping non-surface appends (request/header, compaction/*,
 * session/end-seed, …) OUT of the surface node list.
 */
const SURFACE_EVENT_TYPES: ReadonlySet<string> = new Set([
  'system/message',
  'developer/message',
  'user/message',
  'assistant/message',
  'tool/result',
])

export class MockSession {
  readonly log: MockEvent[] = []
  readonly nodes: number[] = []
  replaceGeneration = 0
  contentGeneration = 0
  private readonly listeners: MockListener[] = []

  /** Next seq (the official seq = log.length contiguity contract). */
  get seq(): number {
    return this.log.length
  }

  /** Ordered surface view (official SessionSurface structural mirror). */
  get surface(): {
    readonly nodes: readonly number[]
    readonly replaceGeneration: number
    readonly contentGeneration: number
  } {
    return {
      nodes: [...this.nodes],
      replaceGeneration: this.replaceGeneration,
      contentGeneration: this.contentGeneration,
    }
  }

  /** Immutable event at one exact seq, or undefined (official eventAt). */
  eventAt(seq: number): SessionEventLike | undefined {
    return this.log[seq]
  }

  /** Subscribe to post-commit appends (the session/event feed stand-in). */
  onAppend(listener: MockListener): () => void {
    this.listeners.push(listener)
    return () => {
      const idx = this.listeners.indexOf(listener)
      if (idx >= 0) this.listeners.splice(idx, 1)
    }
  }

  /** Append one event with the official replace guards enforced. */
  append(type: string, data: unknown, opts: MockSurfaceOpts = {}): SessionEventLike {
    const seq = this.log.length
    const op = opts.surfaceOp
    if (op !== undefined && op !== 'append') {
      const startIdx = this.nodes.indexOf(op.startSeq)
      if (startIdx === -1) {
        throw new Error(`surface replace: start seq ${op.startSeq} not found in surface`)
      }
      const endIdx = this.nodes.indexOf(op.endSeq)
      if (endIdx === -1) {
        throw new Error(`surface replace: end seq ${op.endSeq} not found in surface`)
      }
      if (startIdx > endIdx) {
        throw new Error(`surface replace: start seq ${op.startSeq} is after end seq ${op.endSeq}`)
      }
      const shadowed = this.nodes.slice(startIdx, endIdx + 1)
      // Hard check 1: exact shadowed-set match.
      const provided = [...(opts.sourceEventSeqs ?? [])]
      const sortedProvided = [...provided].sort((a, b) => a - b)
      const sortedShadowed = [...shadowed].sort((a, b) => a - b)
      const sameSet =
        provided.length === shadowed.length &&
        sortedProvided.every((v, i) => v === sortedShadowed[i])
      if (!sameSet) {
        throw new Error(
          `surface replace: sourceEventSeqs must be exactly the shadowed surface nodes `
          + `[${shadowed.join(', ')}], got [${provided.join(', ')}]`,
        )
      }
      // Hard check 3: system head protection.
      const headEvent = this.log[this.nodes[0]]
      if (startIdx === 0 && headEvent?.type === 'system/message') {
        if (type !== 'system/message' || shadowed.length !== 1) {
          throw new Error(
            'surface replace: node 0 holds the system prompt and may be rewritten only by a system/message over exactly that node',
          )
        }
      }
      // Hard check 4: tool-result rewrite guard.
      if (type === 'tool/result') {
        if (shadowed.length !== 1) {
          throw new Error('tool/result surface replacement must rewrite exactly one current node')
        }
        const original = this.log[shadowed[0]]
        if (original?.type !== 'tool/result') {
          throw new Error('tool/result surface replacement must target a current tool/result')
        }
      }
      // Hard check 2 covers the two indexOf(-1) throws above.
    }

    const event: MockEvent = Object.freeze({
      seq,
      type,
      data: structuredClone(data) as Record<string, unknown>,
      ...(op === undefined ? {} : { surfaceOp: op }),
      ...(opts.sourceEventSeqs === undefined ? {} : { sourceEventSeqs: [...opts.sourceEventSeqs] }),
    })
    this.log.push(event)

    if (op === undefined || op === 'append') {
      // Only surface events land on the surface (official discipline,
      // session/src/types.ts:486-490; see SURFACE_EVENT_TYPES above).
      if (SURFACE_EVENT_TYPES.has(type)) this.nodes.push(seq)
    } else {
      const startIdx = this.nodes.indexOf(op.startSeq)
      const endIdx = this.nodes.indexOf(op.endSeq)
      this.nodes.splice(startIdx, endIdx - startIdx + 1, seq)
      this.replaceGeneration += 1
      this.contentGeneration += 1
    }

    for (const listener of [...this.listeners]) listener(event)
    return event
  }
}

/** Convenience message builders matching the official payload shapes. */
export const msg = {
  /** Official system/message envelope: {turn, step, message} (types.ts:330). */
  system(text: string): { turn: number; step: number; message: MockMessage } {
    return { turn: 0, step: 0, message: { role: 'system', content: [{ type: 'text', text }], source: { kind: 'system-prompt' } } }
  },
  /** Official user/message is the BARE UserMessage (types.ts:309, surface.ts:132-134). */
  user(text: string): MockMessage {
    return { role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' } }
  },
  assistant(text: string, toolCallIds: string[] = [], usage?: Record<string, number>): Record<string, unknown> {
    const content: unknown[] = [{ type: 'text', text }]
    for (const id of toolCallIds) {
      content.push({ type: 'tool-call', id, name: `tool-for-${id}`, arguments: '{}' })
    }
    const payload: Record<string, unknown> = {
      message: { role: 'assistant', content, source: { kind: 'model', provider: 'deepseek', model: 'test-model' } },
    }
    if (usage !== undefined) payload.usage = usage
    return payload
  },
  tool(callId: string, text: string): { message: MockMessage } {
    return {
      message: {
        role: 'tool',
        toolName: `tool-for-${callId}`,
        toolCallId: callId,
        content: [{ type: 'text', text }],
        source: { kind: 'tool', callId },
      },
    }
  },
}

/**
 * Seed a fresh MockSession with a realistic conversation:
 *   0 system | 1 user | 2 assistant(text) | 3 user | 4 assistant(+call-a) |
 *   5 tool(call-a) | 6 assistant(text) | 7 user | 8 assistant(text)
 * Returns { session, log } where log maps the labels above to seqs.
 */
export function seedConversation(): { session: MockSession; seqs: number[] } {
  const session = new MockSession()
  const seqs: number[] = []
  seqs.push(session.append('system/message', msg.system('You are helpful.')).seq)
  seqs.push(session.append('user/message', msg.user('Plan the migration.')).seq)
  seqs.push(session.append('assistant/message', msg.assistant('Analysis plan: inventory first.')).seq)
  seqs.push(session.append('user/message', msg.user('Go ahead, list the files.')).seq)
  seqs.push(session.append('assistant/message', msg.assistant('Listing files now.', ['call-a'])).seq)
  seqs.push(session.append('tool/result', msg.tool('call-a', 'a.sql\nb.ts\nc.md')).seq)
  seqs.push(session.append('assistant/message', msg.assistant('Three files found; a.sql is the largest.')).seq)
  seqs.push(session.append('user/message', msg.user('Summarize the schema of a.sql.')).seq)
  seqs.push(session.append('assistant/message', msg.assistant('Schema: two tables, one view.')).seq)
  return { session, seqs }
}
