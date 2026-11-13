/**
 * Assembly of the self-replicated mapping twins into the {@link MappingFace}
 * (labeled `zctx-mapping`). The twins live as pure pieces in map.ts (event
 * mapping + replay emit) and replay.ts (history consume); this module wires
 * them together with the pi-ai overflow classifier that arrives at assembly
 * time — the twins alone cannot classify pi-ai's provider-specific overflow
 * wording (F5.4), and the official face only reaches the twins when the
 * official llm-pi-ai sources do not resolve (host.ts loadMappingFace).
 *
 * SCOPE BOUNDARY (honest): the request-HISTORY conversion is NOT part of
 * this face — it is always the text-only twin in context.ts (the official
 * context.ts pulls the dsh-attachment image machinery transitively, which
 * the S2 text-only scope rejects BEFORE conversion anyway; card product 6
 * "UNSUPPORTED_CONTENT（text-only 收图）/最小实现+诚实边界").
 *
 * @module adapter/twins
 */

import type { MappingFace } from './host.ts'
import { type MappingDeps, mapStopReasonTwins, mapUsageTwins, toPiReplayStateTwins, toStreamChunksTwins } from './map.ts'
import { toPiAssistantTwins } from './replay.ts'

/**
 * Assemble the twins face. `isContextOverflow` is the loaded pi-ai face's
 * classifier (25+ provider patterns, pi-ai utils/overflow).
 */
export function buildMappingTwins(
  deps: MappingDeps,
  isContextOverflow: (message: unknown, contextWindow?: number) => boolean,
): MappingFace {
  return {
    source: 'zctx-mapping',
    mapUsage: mapUsageTwins,
    mapStopReason: (message, contextWindow) => mapStopReasonTwins(message, deps, isContextOverflow, contextWindow),
    toStreamChunks: (events, contextWindow, callerSignal, requestedModel) =>
      toStreamChunksTwins(events, deps, isContextOverflow, contextWindow, callerSignal, requestedModel),
    toPiReplayState: toPiReplayStateTwins,
    toPiAssistant: (message, onDegrade) => toPiAssistantTwins(message, deps, onDegrade),
  }
}
