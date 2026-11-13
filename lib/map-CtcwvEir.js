// src/adapter/replay.ts
function isRecord$1(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
/** Parse tool-call argument JSON; tolerate model malformations with {} (official replay.ts:44-54). */
function parseArguments(raw) {
	if (typeof raw !== "string") return {};
	try {
		const parsed = JSON.parse(raw);
		if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) return parsed;
	} catch {}
	return {};
}
/** Construct the zero usage value required by historical pi-ai messages (official replay.ts:57-66). */
function emptyPiUsage() {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			total: 0
		}
	};
}
function invalidReplay(deps, message) {
	throw new deps.LlmError(`invalid pi-ai replay state: ${message}`, "INVALID_REPLAY_STATE");
}
/** Validate the durable adapter-private envelope before it reaches pi-ai (official replay.ts:117-158). */
function readReplayState(value, deps) {
	if (!isRecord$1(value)) invalidReplay(deps, "expected a replay envelope");
	const envelope = value;
	const rawResponse = envelope["response"];
	if (!isRecord$1(rawResponse)) invalidReplay(deps, "expected a response object");
	const response = rawResponse;
	if (response["kind"] !== "pi-ai") invalidReplay(deps, "unknown state kind");
	if (response["version"] !== 2) invalidReplay(deps, `unsupported version ${String(response["version"])}`);
	for (const key of [
		"api",
		"provider",
		"model"
	]) if (typeof response[key] !== "string" || response[key].length === 0) invalidReplay(deps, `${key} must be a non-empty string`);
	if (![
		"stop",
		"length",
		"toolUse",
		"error",
		"aborted"
	].includes(String(response["stopReason"]))) invalidReplay(deps, "unknown stopReason");
	for (const key of [
		"responseModel",
		"responseId",
		"providerThinkingLevel"
	]) if (response[key] !== void 0 && typeof response[key] !== "string") invalidReplay(deps, `${key} must be a string`);
	const rawBlocks = Array.isArray(envelope["blocks"]) ? envelope["blocks"] : invalidReplay(deps, "blocks must be an array");
	const blocks = [];
	for (const [index, value] of rawBlocks.entries()) {
		if (!isRecord$1(value)) invalidReplay(deps, `block ${index} must be an object`);
		const block = value;
		if (![
			"text",
			"reasoning",
			"tool-call"
		].includes(String(block["type"]))) invalidReplay(deps, `block ${index} has an unknown type`);
		for (const signature of [
			"textSignature",
			"thinkingSignature",
			"thoughtSignature",
			"namespace"
		]) if (block[signature] !== void 0 && typeof block[signature] !== "string") invalidReplay(deps, `block ${index} ${signature} must be a string`);
		if (block["redacted"] !== void 0 && typeof block["redacted"] !== "boolean") invalidReplay(deps, `block ${index} redacted must be boolean`);
		blocks.push(block);
	}
	return {
		response: {
			api: response["api"],
			provider: response["provider"],
			model: response["model"],
			...response["responseModel"] !== void 0 ? { responseModel: response["responseModel"] } : {},
			...response["responseId"] !== void 0 ? { responseId: response["responseId"] } : {},
			...response["providerThinkingLevel"] !== void 0 ? { providerThinkingLevel: response["providerThinkingLevel"] } : {},
			stopReason: response["stopReason"]
		},
		blocks
	};
}
/** Convert provider-neutral blocks without trusting them as same-model replay (official replay.ts:160-196). */
function foreignAssistant(message, deps) {
	const content = [];
	for (const block of message.content) switch (block.type) {
		case "text":
			content.push({
				type: "text",
				text: block.text ?? ""
			});
			break;
		case "reasoning":
			content.push({
				type: "thinking",
				thinking: block.text ?? ""
			});
			break;
		case "tool-call":
			content.push({
				type: "toolCall",
				id: block.id,
				name: block.name,
				arguments: parseArguments(block.arguments)
			});
			break;
		case "image": throw new deps.LlmError("pi-ai chat history cannot represent structured assistant image output", "UNSUPPORTED_CONTENT");
	}
	return {
		role: "assistant",
		content,
		api: "dsh-foreign",
		provider: message.source.provider,
		model: message.source.model,
		usage: emptyPiUsage(),
		stopReason: content.some((piece) => piece["type"] === "toolCall") ? "toolUse" : "stop",
		timestamp: 0
	};
}
/** Recombine durable Harness content with validated pi-ai replay metadata (official replay.ts:198-237). */
function replayedAssistant(message, rawState, deps) {
	const state = readReplayState(rawState, deps);
	if (state.response.provider !== message.source.provider) throw new deps.LlmError("invalid pi-ai replay state: provider does not match assistant source", "INVALID_REPLAY_STATE");
	if (state.response.model !== message.source.model) throw new deps.LlmError("invalid pi-ai replay state: model does not match assistant source", "INVALID_REPLAY_STATE");
	if (state.blocks.length !== message.content.length) throw new deps.LlmError("invalid pi-ai replay state: block count does not match assistant content", "INVALID_REPLAY_STATE");
	return {
		role: "assistant",
		content: message.content.map((block, index) => {
			const replay = state.blocks[index];
			if (replay === void 0 || replay.type !== block.type) throw new deps.LlmError(`invalid pi-ai replay state: block ${index} does not match assistant content`, "INVALID_REPLAY_STATE");
			switch (block.type) {
				case "text": return {
					type: "text",
					text: block.text ?? "",
					...replay.type === "text" && replay.textSignature !== void 0 ? { textSignature: replay.textSignature } : {}
				};
				case "reasoning": return {
					type: "thinking",
					thinking: block.text ?? "",
					...replay.type === "reasoning" && replay.thinkingSignature !== void 0 ? { thinkingSignature: replay.thinkingSignature } : {},
					...replay.type === "reasoning" && replay.redacted !== void 0 ? { redacted: replay.redacted } : {}
				};
				case "tool-call": return {
					type: "toolCall",
					id: block.id,
					name: block.name,
					arguments: parseArguments(block.arguments),
					...replay.type === "tool-call" && replay.thoughtSignature !== void 0 ? { thoughtSignature: replay.thoughtSignature } : {},
					...replay.type === "tool-call" && replay.namespace !== void 0 ? { namespace: replay.namespace } : {}
				};
				default: throw new deps.LlmError(`invalid pi-ai replay state: block ${index} has an unsupported Harness type`, "INVALID_REPLAY_STATE");
			}
		}),
		api: state.response.api,
		provider: state.response.provider,
		model: state.response.model,
		...state.response.responseModel !== void 0 ? { responseModel: state.response.responseModel } : {},
		...state.response.responseId !== void 0 ? { responseId: state.response.responseId } : {},
		...state.response.providerThinkingLevel !== void 0 ? { providerThinkingLevel: state.response.providerThinkingLevel } : {},
		usage: emptyPiUsage(),
		stopReason: state.response.stopReason,
		timestamp: 0
	};
}
/**
* Convert one durable Harness assistant message into pi-ai history (official
* replay.ts:247-259). Durable content is the authoritative record; replay
* metadata only restores native fidelity (ids, signatures). A replay state
* this build cannot use — another adapter's kind, another version, a
* malformed value, or metadata that no longer matches the content — degrades
* the ONE message to provider-neutral history instead of failing the request.
*/
function toPiAssistantTwins(message, deps, onDegrade) {
	if (!isRecord$1(message) || !isRecord$1(message.source)) return message;
	const harness = message;
	if (!Array.isArray(harness.content)) return message;
	const source = harness.source;
	if (source.replayState === void 0) return foreignAssistant(harness, deps);
	try {
		return replayedAssistant(harness, source.replayState, deps);
	} catch (error) {
		if (!(error instanceof deps.LlmError && error.code === "INVALID_REPLAY_STATE")) throw error;
		onDegrade?.(error.message);
		return foreignAssistant(harness, deps);
	}
}
// src/adapter/map.ts
function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
/** Read one event's `type` safely (structural input). @internal */
function eventType(event) {
	return isRecord(event) && typeof event.type === "string" ? event.type : void 0;
}
/**
* Map pi-ai usage to the harness counts (official stream.ts:24-32). The
* reasoning tokens are already folded into `output` by pi-ai; the cache
* fields ride ONLY when non-zero (pi-ai reports zeros, not absence), keeping
* the harness TokenUsage three-count semantics intact (F5.6).
*/
function mapUsageTwins(usage) {
	if (!isRecord(usage)) return {
		inputTokens: 0,
		outputTokens: 0,
		totalTokens: 0
	};
	const input = typeof usage.input === "number" ? usage.input : 0;
	const output = typeof usage.output === "number" ? usage.output : 0;
	const total = typeof usage.totalTokens === "number" ? usage.totalTokens : input + output;
	const cacheRead = typeof usage.cacheRead === "number" ? usage.cacheRead : 0;
	const cacheWrite = typeof usage.cacheWrite === "number" ? usage.cacheWrite : 0;
	return {
		inputTokens: input,
		outputTokens: output,
		totalTokens: total,
		...cacheRead > 0 ? { cacheReadTokens: cacheRead } : {},
		...cacheWrite > 0 ? { cacheWriteTokens: cacheWrite } : {}
	};
}
/**
* Classify a flattened pi-ai error message (official stream.ts:42-68 port —
* module-private upstream, so this twin is the ONLY classifier for the
* adapter's catch path regardless of the mapping source). pi-ai flattens the
* caught error to `error.message` upstream (anthropic-messages.js), dropping
* the cause chain; the actionable undici detail (`terminated`, "Premature
* close") reaches us as terse words, hence the text matching.
*/
function classifyPiAiErrorTwins(message, deps) {
	if (/\b(?:401|403)\b/.test(message)) return "AUTH";
	if (deps.isQuotaExceededError(message)) return deps.QUOTA_EXCEEDED_CODE;
	if (/\b429\b|rate.?limit/i.test(message)) return "RATE_LIMIT";
	if (/\b413\b|failed to buffer the request body:\s*length limit exceeded|payload too large|request body too large/i.test(message)) return "INVALID_REQUEST";
	if (/\b400\b|invalid.?request/i.test(message)) return "INVALID_REQUEST";
	if (/\b5\d\d\b/.test(message)) return "SERVER";
	if (/\btime(?:d)?\s*out\b|timeout/i.test(message)) return "TIMEOUT";
	if (/stream ended (?:before|without)\b/i.test(message)) return "TRANSPORT";
	if (/\b(?:network|connection|socket|fetch)\b|\bECONN[A-Z]+\b/i.test(message) || /\b(?:other side closed|HTTP2 request did not get a response|WebSocket closed unexpectedly)\b/i.test(message) || /\bterminated\b|premature close/i.test(message)) return "TRANSPORT";
	return "PI_AI_ERROR";
}
/**
* Map a terminal pi-ai message to the harness finish reason (official
* stream.ts:80-128). Recognized overflow text, `stop` usage above
* `contextWindow`, and zero-output `length` usage that fills the window all
* map to CONTEXT_WINDOW_EXCEEDED; a `stop` with no content blocks maps to an
* EMPTY_RESPONSE error; terminal `pending`/`deferred` map to non-retryable
* PI_AI_ERROR failures (F5.3/F5.4).
*/
function mapStopReasonTwins(message, deps, isContextOverflow, contextWindow) {
	if (!isRecord(message)) return {
		kind: "error",
		failure: {
			message: "pi-ai terminal event carried no message",
			code: "PI_AI_ERROR"
		}
	};
	const piOverflow = isContextOverflow(message, contextWindow);
	const errorMessage = typeof message.errorMessage === "string" ? message.errorMessage : void 0;
	const harnessOverflow = message.stopReason === "error" && errorMessage !== void 0 && deps.isContextWindowExceededError(errorMessage);
	if (piOverflow || harnessOverflow) return {
		kind: "error",
		failure: {
			message: errorMessage ?? `pi-ai detected context overflow for model "${String(message.model)}"`,
			code: deps.CONTEXT_WINDOW_EXCEEDED_CODE
		}
	};
	const content = Array.isArray(message.content) ? message.content : [];
	switch (message.stopReason) {
		case "stop":
			if (content.length === 0) return {
				kind: "error",
				failure: {
					message: `model "${String(message.model)}" returned a completed response with no content`,
					code: deps.EMPTY_RESPONSE_CODE
				}
			};
			return { kind: "stop" };
		case "length": return { kind: "max-tokens" };
		case "toolUse": return { kind: "tool-calls" };
		case "pending": return {
			kind: "error",
			failure: {
				message: `pi-ai stream for model "${String(message.model)}" ended pending`,
				code: "PI_AI_ERROR"
			}
		};
		case "deferred": return {
			kind: "error",
			failure: {
				message: `pi-ai deferred response for model "${String(message.model)}" is not supported`,
				code: "PI_AI_ERROR"
			}
		};
		case "aborted": return {
			kind: "aborted",
			failure: {
				message: errorMessage ?? "pi-ai stream aborted",
				code: "ABORTED"
			}
		};
		case "error": {
			const text = errorMessage ?? "pi-ai stream error";
			return {
				kind: "error",
				failure: {
					message: text,
					code: classifyPiAiErrorTwins(text, deps)
				}
			};
		}
		default: return {
			kind: "error",
			failure: {
				message: `pi-ai stop reason "${String(message.stopReason)}" is not representable`,
				code: "PI_AI_ERROR"
			}
		};
	}
}
/**
* Translate the pi-ai event stream into harness StreamChunks (official
* stream.ts:142-234). pi-ai never throws mid-stream — failures arrive as
* `error` events and become error/aborted finish chunks (the harness's other
* sanctioned error path besides throwing). Ends with `usage` then `finish`;
* throws LlmError STREAM_CLOSED when the source ends without a terminal
* event. Caller cancellation turns an in-band terminal error into an aborted
* finish (official semantics).
*/
async function* toStreamChunksTwins(events, deps, isContextOverflow, contextWindow, callerSignal, requestedModel) {
	const toolIds = /* @__PURE__ */ new Map();
	for await (const raw of events) switch (eventType(raw)) {
		case "start": break;
		case "text_start":
			yield {
				type: "block-start",
				index: raw.contentIndex,
				blockType: "text"
			};
			break;
		case "text_delta":
			yield {
				type: "text-delta",
				index: raw.contentIndex,
				text: raw.delta
			};
			break;
		case "text_end":
			yield {
				type: "block-end",
				index: raw.contentIndex,
				block: {
					type: "text",
					text: raw.content
				}
			};
			break;
		case "thinking_start":
			yield {
				type: "block-start",
				index: raw.contentIndex,
				blockType: "reasoning"
			};
			break;
		case "thinking_delta":
			yield {
				type: "reasoning-delta",
				index: raw.contentIndex,
				text: raw.delta
			};
			break;
		case "thinking_end":
			yield {
				type: "block-end",
				index: raw.contentIndex,
				block: {
					type: "reasoning",
					text: raw.content
				}
			};
			break;
		case "toolcall_start": {
			const event = raw;
			const partial = event.partial?.content?.[event.contentIndex];
			const id = partial?.type === "toolCall" ? partial.id ?? "" : "";
			const name = partial?.type === "toolCall" ? partial.name ?? "" : "";
			toolIds.set(event.contentIndex, {
				id,
				name
			});
			yield {
				type: "block-start",
				index: event.contentIndex,
				blockType: "tool-call"
			};
			break;
		}
		case "toolcall_delta": {
			const event = raw;
			const known = toolIds.get(event.contentIndex);
			yield {
				type: "tool-call-delta",
				index: event.contentIndex,
				id: known?.id ?? "",
				...known?.name !== void 0 && known.name.length > 0 ? { name: known.name } : {},
				argumentsDelta: event.delta
			};
			break;
		}
		case "toolcall_end": {
			const event = raw;
			yield {
				type: "block-end",
				index: event.contentIndex,
				block: {
					type: "tool-call",
					id: event.toolCall.id,
					name: event.toolCall.name,
					arguments: JSON.stringify(event.toolCall.arguments)
				}
			};
			break;
		}
		case "done": {
			const message = raw.message;
			yield {
				type: "usage",
				usage: mapUsageTwins(message.usage)
			};
			yield {
				type: "finish",
				reason: mapStopReasonTwins(message, deps, isContextOverflow, contextWindow),
				replayState: toPiReplayStateTwins(message, requestedModel)
			};
			return;
		}
		case "error": {
			const error = raw.error;
			yield {
				type: "usage",
				usage: mapUsageTwins(error.usage)
			};
			yield {
				type: "finish",
				reason: mapStopReasonTwins(callerSignal?.aborted ? {
					...error,
					stopReason: "aborted"
				} : error, deps, isContextOverflow, contextWindow)
			};
			return;
		}
	}
	throw new deps.LlmError("pi-ai event stream ended without done/error", "STREAM_CLOSED");
}
/**
* Project a successful pi-ai response into the minimal durable replay state
* (official replay.ts:77-110). The per-block half is index-aligned with the
* streamed blocks, so BlockAssembler prunes an entry with its block.
*/
function toPiReplayStateTwins(message, requestedModel) {
	if (!isRecord(message)) return void 0;
	const content = Array.isArray(message.content) ? message.content : [];
	return {
		response: {
			kind: "pi-ai",
			version: 2,
			api: message.api,
			provider: message.provider,
			model: requestedModel ?? message.model,
			...typeof message.responseModel === "string" ? { responseModel: message.responseModel } : {},
			...typeof message.responseId === "string" ? { responseId: message.responseId } : {},
			...typeof message.providerThinkingLevel === "string" ? { providerThinkingLevel: message.providerThinkingLevel } : {},
			stopReason: message.stopReason
		},
		blocks: content.map((block) => {
			switch (block.type) {
				case "text": return {
					type: "text",
					...typeof block.textSignature === "string" ? { textSignature: block.textSignature } : {}
				};
				case "thinking": return {
					type: "reasoning",
					...typeof block.thinkingSignature === "string" ? { thinkingSignature: block.thinkingSignature } : {},
					...typeof block.redacted === "boolean" ? { redacted: block.redacted } : {}
				};
				case "toolCall": return {
					type: "tool-call",
					...typeof block.thoughtSignature === "string" ? { thoughtSignature: block.thoughtSignature } : {},
					...typeof block.namespace === "string" ? { namespace: block.namespace } : {}
				};
				default: return { type: "text" };
			}
		})
	};
}
export { toStreamChunksTwins as a, toPiReplayStateTwins as i, mapStopReasonTwins as n, toPiAssistantTwins as o, mapUsageTwins as r, classifyPiAiErrorTwins as t };

//# sourceMappingURL=map-CtcwvEir.js.map