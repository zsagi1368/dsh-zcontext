/**
 * MessageSourceMap augmentation for the dsh-zcontext producer kinds (S4).
 *
 * The official `MessageSourceMap` (llm/src/message.ts:110-115) is a
 * merge-extensible sum type: "each producer declares its own `kind` in its
 * own module; … user messages carry any producer's kind, and consumers fall
 * through unknown kinds."
 *
 * Payload contract is frozen by plan §3 (S4) — the minimal checkpoint form,
 * same shape as the official compaction checkpoint source
 * (compaction/src/checkpoint.ts:19-31: kind + id only):
 *
 *   { kind: 'zctx-fold' | 'zctx-unfold', foldId, tokensBefore?, tokensAfter? }
 *
 * The fold span and the shadowed surface seqs are NOT part of the payload —
 * they are carried by the event envelope's surfaceOp / sourceEventSeqs.
 *
 * This file is intentionally a global script (no top-level import/export):
 * while `@deepseek-ai/dsh-llm` is absent it is an ambient module
 * declaration, and once the host package is resolvable the same declaration
 * merges as a module augmentation. The structural twin of this payload lives
 * in src/types.ts (`ZcontextCheckpointSource`) — keep the two in sync.
 */

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'zctx-fold': {
      kind: 'zctx-fold'
      foldId: string
      tokensBefore?: number
      tokensAfter?: number
    }
    'zctx-unfold': {
      kind: 'zctx-unfold'
      foldId: string
      tokensBefore?: number
      tokensAfter?: number
    }
  }
}
