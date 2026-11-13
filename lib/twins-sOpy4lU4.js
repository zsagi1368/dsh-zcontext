import { a as toStreamChunksTwins, i as toPiReplayStateTwins, n as mapStopReasonTwins, o as toPiAssistantTwins, r as mapUsageTwins } from "./map-CtcwvEir.js";
// src/adapter/twins.ts
/**
* Assemble the twins face. `isContextOverflow` is the loaded pi-ai face's
* classifier (25+ provider patterns, pi-ai utils/overflow).
*/
function buildMappingTwins(deps, isContextOverflow) {
	return {
		source: "zctx-mapping",
		mapUsage: mapUsageTwins,
		mapStopReason: (message, contextWindow) => mapStopReasonTwins(message, deps, isContextOverflow, contextWindow),
		toStreamChunks: (events, contextWindow, callerSignal, requestedModel) => toStreamChunksTwins(events, deps, isContextOverflow, contextWindow, callerSignal, requestedModel),
		toPiReplayState: toPiReplayStateTwins,
		toPiAssistant: (message, onDegrade) => toPiAssistantTwins(message, deps, onDegrade)
	};
}
export { buildMappingTwins };

//# sourceMappingURL=twins-sOpy4lU4.js.map