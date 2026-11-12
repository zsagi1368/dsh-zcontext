/**
 * The `/zctx` command (task card W4 §3): status (default) | fold | unfold
 * subcommands, executed against the invoking agent's session through the
 * same engine/runtime the tools use. The handler returns the structural
 * CommandResult union ({kind:'success'|'error', text}) — every failure is a
 * fail-soft error text, never a throw.
 *
 * Zero host imports; the runtime is injected structurally.
 *
 * @module command
 */

import { renderFoldReply, renderUnfoldReply, fold, unfold } from './fold-engine.ts'
import type { FoldSessionLike } from './fold-engine.ts'
import { parseFoldContent, renderStatus } from './tools.ts'
import type { ZctxToolRuntime } from './tools.ts'
import { REASON_NO_ACTIVE_FOLDS, STATUS_NO_SESSION } from './texts.ts'
import type { FoldStore } from './store.ts'
import type { SessionLike, ToolRunContextLike } from './types.ts'

/** Structural CommandResult subset (commands/src/types.ts:34-41). */
export type ZctxCommandResult =
  | { readonly kind: 'success'; readonly text?: string; readonly sourceEventSeq?: number }
  | { readonly kind: 'error'; readonly text: string }

/** Structural CommandDefinition subset (commands/src/index.ts:61-78). */
export interface ZctxCommandDefinition {
  readonly name: string
  readonly description: string
  readonly handler: (
    invocation: {
      readonly agent?: { readonly session?: SessionLike }
      readonly rawInput: string
      readonly signal?: AbortSignal
    },
  ) => ZctxCommandResult | Promise<ZctxCommandResult>
}

/** Build the /zctx command definition against the given runtime. */
export function buildZctxCommand(runtime: ZctxToolRuntime): ZctxCommandDefinition {
  return {
    name: 'zctx',
    description:
      'Context folding ledger: "status" (default) shows pressure, budget, ranges, folds, and cache usage; '
      + '"fold <content>" commits fold blocks; "unfold [foldId]" re-materializes a fold.',
    handler: (invocation) => handleZctxCommand(runtime, invocation),
  }
}

/** Dispatch one /zctx invocation (fail-soft everywhere). @internal */
async function handleZctxCommand(
  runtime: ZctxToolRuntime,
  invocation: {
    readonly agent?: ToolRunContextLike['agent']
    readonly rawInput: string
    readonly signal?: AbortSignal
  },
): Promise<ZctxCommandResult> {
  const session = invocation.agent?.session
  if (session === undefined) {
    return { kind: 'error', text: STATUS_NO_SESSION }
  }
  const raw = invocation.rawInput.trim()
  if (raw === '' || raw === 'status') {
    return { kind: 'success', text: await renderStatus(runtime, session) }
  }

  if (raw === 'fold' || raw.startsWith('fold ')) {
    const content = raw.slice('fold'.length).trim()
    const parsed = parseFoldContent(content)
    if (!parsed.ok) return { kind: 'error', text: parsed.reason }
    const writable = session as FoldSessionLike
    const store = runtime.storeFor(session)
    const result = fold(writable, store, parsed, runtime.validatorConfig(session))
    const text = renderFoldReply(result)
    return result.ok ? { kind: 'success', text } : { kind: 'error', text }
  }

  if (raw === 'unfold' || raw.startsWith('unfold ')) {
    const rest = raw.slice('unfold'.length).trim()
    const foldId = rest.length > 0 ? rest : undefined
    const writable = session as FoldSessionLike
    const store = runtime.storeFor(session)
    const target = foldId ?? resolveLatestFold(store)
    if (target === undefined) {
      return { kind: 'error', text: REASON_NO_ACTIVE_FOLDS }
    }
    const result = unfold(writable, store, target)
    const text = renderUnfoldReply(target, result)
    return result.ok ? { kind: 'success', text } : { kind: 'error', text }
  }

  return {
    kind: 'error',
    text: 'unknown /zctx subcommand; expected "status" (default), "fold <content>", or "unfold [foldId]"',
  }
}

/** Newest active fold id (checkpointSeq order). @internal */
function resolveLatestFold(store: FoldStore): string | undefined {
  let best: { foldId: string; checkpointSeq: number } | undefined
  for (const [id, record] of store.foldMap) {
    if (best === undefined || record.checkpointSeq > best.checkpointSeq) {
      best = { foldId: id, checkpointSeq: record.checkpointSeq }
    }
  }
  return best?.foldId
}
