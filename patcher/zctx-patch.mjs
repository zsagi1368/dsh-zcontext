#!/usr/bin/env node
/**
 * zctx-patch — the external patcher for the official DSH desktop app.asar
 * (task card P4, v0.2.1; plan §3; RES-install-surface P2 mapping + VERIFY-P
 * 12/12 with the two corrections absorbed).
 *
 * WHAT IT DOES — one-line defensive forwarding stub inserted into the OFFICIAL
 * PiAiAdapter's profileOptions CONSTRUCTION site (the streamSimple options
 * object literal, right after the `...profileOptions(...)` spread and BEFORE
 * the official explicit `headers:`/`signal:` keys — so the stub can never
 * clobber the official header/timeout face):
 *
 *     ...(globalThis.__zctxPatch__?.wireOptions?.({ provider: options.provider, model: model.id, sessionId: options.sessionId }) ?? {}),
 *
 * Zero body rewriting (redline R1): the stub only ADDS options fields. The
 * plugin (when installed + enabled) arms `globalThis.__zctxPatch__.wireOptions`
 * at startup and returns {onPayload, fetch, headers} bound to its per-session
 * wire ledger; plugin absent/disabled → the stub evaluates to `{}` and the
 * official request is byte-identical to stock behavior.
 *
 * WHY THE CALL SITE (not the profileOptions return object): the identity the
 * plugin needs — provider/model/sessionId (card: "身份=provider/model+
 * options.sessionId 可达时") — is only fully in scope at the call site
 * (`options` / `model` locals; rc.3 adapter.ts:475-482, lib call site verified
 * live). The `...profileOptions(profile, reasoning, apiKey),` string is
 * file-unique in rc.3 lib/index.js (count=1, re-verified 2026-11-14 by
 * read-only extraction, SHA-256 e956da3d… matching P2 [F16]/VERIFY-P #8).
 *
 * GATES (every one refuses loudly, never "harden through"):
 *   1. app dir resolution (--app-dir | HKCU registry | documented default)
 *   2. app-not-running gate (process probe + the app's own wx lock file)
 *   3. version gate (asar root package.json version ∈ SUPPORTED)
 *   4. idempotence (stub marker already present → no-op success, no new
 *      backup; marker missing while the stub is live = crash window → the
 *      marker is backfilled from derivable facts, asar untouched)
 *   5. anchor hash gate (target lib/index.js SHA-256 must match the per-version
 *      anchor set — drift = official update = refuse + report, never patch blind;
 *      a MIXED face — some pristine + some patched-exact, unreachable by this
 *      patcher's ONE-write application — is refused with the per-file face too)
 *   6. anchor string uniqueness (count must be exactly 1)
 *   7. BACKUP FIRST (sibling `zctx-backup/<ts>/` OUTSIDE the install dir so
 *      the official updater/uninstaller cannot wipe it — RESTORE.md carries
 *      SHA-256s + restore commands; copy hash verified before any modification;
 *      §5 discipline on the user machine)
 *   8. surgical splice: header JSON + payload rebuilt byte-identically EXCEPT
 *      the one target file (all other packed bytes untouched, unpacked-file
 *      flags untouched — no full repack, no unpack-pattern risk)
 *   9. post-verify (fresh re-read: target == expected patched bytes; untouched
 *      witness files match their pristine integrity hashes)
 *  10. marker `<appDir>/.zctx-patch.json` (plugin status reads it: dual source)
 *
 * SUBCOMMANDS: patch / restore / status / auto / install-task /
 * uninstall-task / reanchor (restore = copy the backup asar back + remove
 * the marker; status = strictly read-only; auto = the hourly self-heal
 * state machine — fuse gate, repair only under --yes, full status re-check,
 * file log; install-task/uninstall-task = the Windows scheduled task around
 * `auto`; reanchor = build a candidate anchor set for a NEW official build
 * — read-only classification, anchors inherited only when provably alive,
 * data sets land in patcher/anchors/ under --accept).
 *
 * v0.2 (P6-B, plan ZCTX-v03-patch-plan + RES-port-feasibility P6-A spec): the
 * anchor set grows from ONE file/one stub to a MULTI-FILE base-context patch
 * set (γ all-inline selection — zero new asar entries, zero export-face
 * changes): the guard-observe wrapper cluster inlines into the llm-pi-ai
 * bundle, the GuardObserver + chain classifier into the agent-loop bundle,
 * the L3 pruning vocabulary into the pruner bundle, and the budget formula
 * into compaction-basic. Every patched bundle stays SELF-CONTAINED (the
 * classifier ships in both consumer bundles) so a hypothetical partial state
 * leaves each bundle individually consistent. The set applies in ONE asar
 * write (multi-target splice) — no partial multi-file state can persist.
 * guardObserve ignition (user ruling "完整功能生效"): the patched llm-pi-ai
 * Config defaults the observe switch to TRUE; the sole kill switch. Observe
 * only — the interception half does not exist in any tree and is not invented.
 *
 * REAL-MACHINE EXECUTION IS OUT OF THIS WAVE (W5-A6-INSTALL umbrella,
 * post-merge): this wave ships the tool + fixture-verified tests only.
 *
 * asar mechanics verified against @electron/asar 4.3.2 sources (lib/pickle.js,
 * lib/disk.js, lib/integrity.js): outer size pickle [u32 4][u32 headerSize],
 * header pickle [u32 payloadSize][u32 jsonLen][json][zero-pad→4],
 * payloadBase = 8 + headerSize, file integrity = SHA256 whole + 4 MiB blocks.
 *
 * @module zctx-patch
 */

import { spawnSync } from 'node:child_process'
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readSync,
  closeSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Patcher version (plan P6 wave table: patcher v0.2.0). */
export const PATCHER_VERSION = '0.2.0'

/**
 * Identity of the base-context patch set data shipped in this file (the P6-A
 * convergence: surgical hunks + γ-inline drop-ins; return-cap and the inert
 * cache-metrics face are registered v0.3 二期 by plan ruling). Bump when the
 * patch-set data changes so markers/status can tell applied sets apart.
 */
export const PATCH_SET_VERSION = 'zctx-v0.3-base-1'

/** The asar-relative path of the shell manifest (version gate source). */
const SHELL_PACKAGE_PATH = 'package.json'

/** The desktop app process name (app-running probe). */
const APP_EXE = 'DeepSeek Harness.exe'

/** Registry uninstall key of the per-user install (P2 [F1], VERIFY-P #7). */
const REGISTRY_KEY =
  'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\1bf39983-50d0-5fe0-9ef4-cece76f67c5e'

/** Documented default install root when the registry is unreadable. */
const DEFAULT_APP_DIR = 'H:\\AiAgent\\DeepSeekHarness'

/** The app's own project lock file (P2 [F30]-[F31]; presence = refuse). */
export function desktopLockPath(dshHome = join(homedir(), '.dsh')) {
  return join(dshHome, 'profiles', 'desktop', 'lock')
}

// ---------------------------------------------------------------------------
// The per-version anchor set (support matrix).
// ---------------------------------------------------------------------------

/**
 * Anchor set per supported shell version — the v0.2 MULTI-FILE base-context
 * patch set (P6-A convergence in plan ZCTX-v03-patch-plan; implementation
 * spec RES-port-feasibility.md §2/§3). γ all-inline selection: every Go-tree
 * module is inlined into an existing compiled bundle — ZERO new asar entries,
 * ZERO official export-face changes, ZERO package.json edits. All pristine
 * SHA-256 pins below were computed live from the real rc.3 asar (read-only
 * positional extraction, 2026-11-16); the llm-pi-ai hash also matches the P4
 * pin (double-attested across two independent extractions). The five compiled
 * bundles are un-minified tsc output (tab indent, `void 0`, double-quoted
 * strings — P2 [F20] shape); every anchor below was verified count=1 in its
 * bundle by the fixture tests and is re-asserted at patch time.
 *
 * An official update changes any pinned hash → the anchor-hash gate refuses →
 * this table gets the new entry first (card: "官方升级后锚漂移=预期路径，
 * patcher 更新锚集再支持").
 */

/**
 * The inlined guard-observation wrapper cluster for the llm-pi-ai bundle:
 * createGuardFetchWrapper + buildGuardSegments + the wire-form recognizers,
 * plus the stableStringify/verifyMonotonic cut of cache-guardian.ts (the only
 * cache-guardian faces the observation chain consumes — P6-A §2.13 trim
 * ruling). Source of record: Go e63ceff2d7 llm-pi-ai/src/guard-observe.ts;
 * the assertGuardObserveSupport probe is adapted for the inlined build
 * (really-parsed OLD pi-ai still fails loud; an UNPROBEABLE runtime proceeds
 * — the patcher's version + hash gates pin the shipped pair, and a fail-loud
 * on an unprobeable fs would brick every request under the default-on
 * ignition). Compiled style: tabs, double quotes, `void 0`.
 */
const ZCTX_REGION_LLM_PI_AI_GUARD = [
  '//#region lib/types/zctx-guard-observe.js',
  '/**',
  ' * zctx P6-B inline — wire-body guard observation wrapper cluster (γ all-inline:',
  ' * zero new asar entries, zero export-face change). Source of record: Go',
  ' * e63ceff2d7 llm-pi-ai/src/guard-observe.ts + the stableStringify/',
  ' * verifyMonotonic cut of llm-pi-ai/src/cache-guardian.ts. Observe-only',
  ' * (D1P2-whitelist-design §1.1): hash-then-passthrough capture of the exact',
  ' * wire bytes — this layer records, measures, and warns but decides nothing.',
  ' * The chain classifier + sink maintainer live in the patched agent-loop',
  ' * bundle (self-contained bundles; no cross-package contract added).',
  ' */',
  '/** Stable-key-order JSON serialization (cache-guardian.ts:160 cut, verbatim). */',
  'function stableStringify(value) {',
  '\tif (value === null || value === void 0) return "null";',
  '\tif (typeof value !== "object") return JSON.stringify(value);',
  '\tif (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;',
  '\tconst keys = Object.keys(value).sort();',
  '\tconst pairs = keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`);',
  '\treturn `{${pairs.join(",")}}`;',
  '}',
  '/** Frozen-segment + append-only chain check (cache-guardian.ts:451 cut, verbatim). */',
  'function verifyMonotonic(prev, next) {',
  '\tif (prev.systemHash !== next.systemHash) return { ok: false, reason: "system segment changed; system is frozen (reset event required)" };',
  '\tif (prev.toolsHash !== next.toolsHash) return { ok: false, reason: "tools segment changed; tools are frozen (reset event required)" };',
  '\tif (next.messageHashes.length < prev.messageHashes.length) {',
  '\t\treturn { ok: false, reason: `messages segment shrank from ${prev.messageHashes.length} to ${next.messageHashes.length} (not monotonic)` };',
  '\t}',
  '\tfor (let i = 0; i < prev.messageHashes.length; i++) {',
  '\t\tif (prev.messageHashes[i] !== next.messageHashes[i]) {',
  '\t\t\treturn { ok: false, reason: `message at index ${i} was rewritten in place (not monotonic; reset event required)` };',
  '\t\t}',
  '\t}',
  '\treturn { ok: true };',
  '}',
  'function guardSha256(text) {',
  '\treturn createHash("sha256").update(text, "utf8").digest("hex");',
  '}',
  'function isRecord(value) {',
  '\treturn typeof value === "object" && value !== null && !Array.isArray(value);',
  '}',
  '/** E-0 (D1P2 §3): deep-walk cache_control off the wire value — type-blind. */',
  'function stripCacheControl(value) {',
  '\tif (Array.isArray(value)) return value.map(stripCacheControl);',
  '\tif (value === null || typeof value !== "object") return value;',
  '\tconst out = {};',
  '\tfor (const [key, item] of Object.entries(value)) {',
  '\t\tif (key === "cache_control") continue;',
  '\t\tout[key] = stripCacheControl(item);',
  '\t}',
  '\treturn out;',
  '}',
  'const ANTHROPIC_EFFORTS = new Set(["low", "medium", "high", "xhigh", "max"]);',
  '/** Class-2 recognizer (D1P2 §4.2): empty-content system message carrying the managed effort. */',
  'function recognizeEffortSynth(message) {',
  '\tif (!isRecord(message) || message.role !== "system") return false;',
  '\tif (!Array.isArray(message.content) || message.content.length !== 0) return false;',
  '\tconst outputConfig = message.output_config;',
  '\tif (!isRecord(outputConfig)) return false;',
  '\tconst effort = outputConfig.effort;',
  '\treturn typeof effort === "string" && ANTHROPIC_EFFORTS.has(effort);',
  '}',
  'const DEFERRED_SYSTEM_BLOCK_TYPES = new Set(["text", "tool_removal", "tool_addition"]);',
  '/** Class-1 form recognizer (D1P2 §4.1): non-empty system message of deferred-update blocks. */',
  'function recognizeDeferredReorderSystem(message) {',
  '\tif (!isRecord(message) || message.role !== "system" || !Array.isArray(message.content)) return false;',
  '\tif (message.content.length === 0) return false;',
  '\treturn message.content.every((block) => isRecord(block) && typeof block.type === "string" && DEFERRED_SYSTEM_BLOCK_TYPES.has(block.type));',
  '}',
  'const ERROR_IMAGE_CAPTION_PREFIX = "Images from the error result of tool call ";',
  '/** Class-3 recognizer (D1P2 §4.3): error-result images split behind a caption. */',
  'function recognizeErrorImageSplit(message) {',
  '\tif (!isRecord(message) || message.role !== "user" || !Array.isArray(message.content)) return false;',
  '\tconst blocks = message.content;',
  '\tlet lastToolResult = -1;',
  '\tfor (let index = 0; index < blocks.length; index++) {',
  '\t\tconst block = blocks[index];',
  '\t\tif (isRecord(block) && block.type === "tool_result") lastToolResult = index;',
  '\t}',
  '\tif (lastToolResult === -1) return false;',
  '\tconst tail = blocks.slice(lastToolResult + 1);',
  '\tif (tail.length < 2) return false;',
  '\tconst caption = tail[0];',
  '\treturn isRecord(caption) && caption.type === "text" && typeof caption.text === "string" && caption.text.startsWith(ERROR_IMAGE_CAPTION_PREFIX) && tail.slice(1).every((block) => isRecord(block) && block.type === "image");',
  '}',
  '/** Wire-form label of one observed message (class-2, then class-1/class-3 by shape). */',
  'function recognizeMessageKind(message) {',
  '\tif (isRecord(message) && message.role === "system") {',
  '\t\tif (recognizeEffortSynth(message)) return "class2";',
  '\t\tif (recognizeDeferredReorderSystem(message)) return "class1";',
  '\t\treturn "normal";',
  '\t}',
  '\tif (recognizeErrorImageSplit(message)) return "class3";',
  '\treturn "normal";',
  '}',
  '/** Three-segment capture of one anthropic-messages wire body (D1P2 §2.2). */',
  'function buildGuardSegments(params) {',
  '\tconst system = stripCacheControl(params.system ?? null);',
  '\tconst tools = stripCacheControl(params.tools ?? null);',
  '\tconst messages = (Array.isArray(params.messages) ? params.messages : []).map(stripCacheControl);',
  '\treturn {',
  '\t\tsystemHash: guardSha256(stableStringify(system)),',
  '\t\ttoolsHash: guardSha256(stableStringify(tools)),',
  '\t\tmessagesHash: guardSha256(stableStringify(messages)),',
  '\t\tmessageHashes: messages.map((message) => guardSha256(stableStringify(message))),',
  '\t\tmessageKinds: messages.map(recognizeMessageKind)',
  '\t};',
  '}',
  '/** A messages.create-shaped body: the only shape this surface three-segments. */',
  'function isMessagesCreateBody(params) {',
  '\treturn isRecord(params) && typeof params.model === "string" && Array.isArray(params.messages);',
  '}',
  '/** A6 runtime half: minimum installed pi-ai the observation surface may run on. */',
  'const PI_AI_GUARD_OBSERVE_MIN_VERSION = "1.3.0";',
  'let guardSupportMemo = void 0;',
  '/**',
  ' * A6 (adapted for the inlined patch build): a REALLY parsed installed',
  ' * version below the minimum still fails loud (fork semantics preserved);',
  ' * an UNPROBEABLE runtime proceeds — the patcher gates pin the shipped pair.',
  ' * @throws LlmError INVALID_CONFIG when the installed pi-ai reads as older',
  ' * than PI_AI_GUARD_OBSERVE_MIN_VERSION.',
  ' */',
  'function assertGuardObserveSupport() {',
  '\tif (guardSupportMemo === void 0) guardSupportMemo = probePiAiGuardSupport();',
  '\tif (guardSupportMemo.ok) return;',
  '\tthrow new LlmError(`llm-pi-ai: guardObserve requires @earendil-works/pi-ai >= ${PI_AI_GUARD_OBSERVE_MIN_VERSION} (ProviderRequestOptions.fetch forwarding, D1P2 A6); installed version reads as ${guardSupportMemo.found ?? "unknown"} — refusing to enable the observation surface`, "INVALID_CONFIG");',
  '}',
  'function probePiAiGuardSupport() {',
  '\ttry {',
  '\t\tconst manifest = findPiAiManifest(dirname(fileURLToPath(import.meta.url)));',
  '\t\tconst found = typeof manifest?.version === "string" ? manifest.version : void 0;',
  '\t\tconst tuple = found?.match(/^(\\d+)\\.(\\d+)\\.(\\d+)/) ?? void 0;',
  '\t\tif (manifest === void 0 || tuple === void 0) return { ok: true, found, detail: "installed pi-ai version unprobeable in this runtime — proceeding (the patcher gates pin the shipped pair)" };',
  '\t\tconst minimum = PI_AI_GUARD_OBSERVE_MIN_VERSION.split(".").map(Number);',
  '\t\tconst installed = tuple.slice(1).map(Number);',
  '\t\tlet ordering = 0;',
  '\t\tfor (let index = 0; index < Math.max(installed.length, minimum.length) && ordering === 0; index++) {',
  '\t\t\tordering = (installed[index] ?? 0) - (minimum[index] ?? 0);',
  '\t\t}',
  '\t\treturn ordering >= 0 ? { ok: true, found } : { ok: false, found };',
  '\t} catch {',
  '\t\treturn { ok: true, detail: "pi-ai version probe failed — proceeding (the patcher gates pin the shipped pair)" };',
  '\t}',
  '}',
  'function findPiAiManifest(startDir) {',
  '\tlet dir = startDir;',
  '\tfor (let depth = 0; depth < 16; depth++) {',
  '\t\ttry {',
  '\t\t\tconst manifestPath = join(dir, "node_modules", "@earendil-works", "pi-ai", "package.json");',
  '\t\t\tif (existsSync(manifestPath)) return JSON.parse(readFileSync(manifestPath, "utf8"));',
  '\t\t} catch {',
  '\t\t\t// An unreadable candidate is not a version fact; keep walking.',
  '\t\t}',
  '\t\tconst parent = dirname(dir);',
  '\t\tif (parent === dir) return void 0;',
  '\t\tdir = parent;',
  '\t}',
  '\treturn void 0;',
  '}',
  'class NotMessagesCreateBodyError extends Error {',
  '\tconstructor() {',
  '\t\tsuper("wire body is not a messages.create request");',
  '\t\tthis.name = "NotMessagesCreateBodyError";',
  '\t}',
  '}',
  '/**',
  ' * Hash-then-passthrough fetch wrapper for one logical request (D1P2 §2.1/§6):',
  ' * per attempt the exact wire bytes are hashed (never rewritten) and the',
  ' * original call is released to globalThis.fetch. Capture ladder: non-string',
  ' * body → A7-2; hash failure → A7-3; parse failure → A7-1 (wholeHash kept);',
  ' * non-anthropic or non-messages.create → whole-package fallback; otherwise',
  ' * full three-segment capture.',
  ' */',
  'function createGuardFetchWrapper(args) {',
  '\tlet attemptSeq = 0;',
  '\treturn (input, init) => {',
  '\t\tconst attempt = ++attemptSeq;',
  '\t\tconst meta = {',
  '\t\t\tprovider: args.model.provider,',
  '\t\t\tapi: args.model.api,',
  '\t\t\tmodelId: args.model.id,',
  '\t\t\tbodyBytes: 0',
  '\t\t};',
  '\t\tconst release = () => globalThis.fetch(input, init);',
  '\t\tconst body = init?.body;',
  '\t\tif (typeof body !== "string") {',
  '\t\t\targs.sink({ schemaVersion: 1, attemptSeq: attempt, degraded: { reason: "non-string-body" }, meta });',
  '\t\t\treturn release();',
  '\t\t}',
  '\t\tmeta.bodyBytes = Buffer.byteLength(body, "utf8");',
  '\t\tlet wholeHash;',
  '\t\ttry {',
  '\t\t\twholeHash = guardSha256(body);',
  '\t\t} catch {',
  '\t\t\targs.sink({ schemaVersion: 1, attemptSeq: attempt, degraded: { reason: "hash-failed" }, meta });',
  '\t\t\treturn release();',
  '\t\t}',
  '\t\tif (args.model.api !== "anthropic-messages") {',
  '\t\t\targs.sink({ schemaVersion: 1, attemptSeq: attempt, wholeHash, meta });',
  '\t\t\treturn release();',
  '\t\t}',
  '\t\tlet params;',
  '\t\ttry {',
  '\t\t\tparams = JSON.parse(body);',
  '\t\t\tif (!isMessagesCreateBody(params)) throw new NotMessagesCreateBodyError();',
  '\t\t} catch (error) {',
  '\t\t\tconst parseFailed = error instanceof SyntaxError || error instanceof NotMessagesCreateBodyError;',
  '\t\t\targs.sink({',
  '\t\t\t\tschemaVersion: 1,',
  '\t\t\t\tattemptSeq: attempt,',
  '\t\t\t\t...parseFailed ? { wholeHash } : {},',
  '\t\t\t\tmeta,',
  '\t\t\t\tdegraded: { reason: parseFailed ? "parse-failed" : "hash-failed" }',
  '\t\t\t});',
  '\t\t\treturn release();',
  '\t\t}',
  '\t\tlet segments;',
  '\t\ttry {',
  '\t\t\tsegments = buildGuardSegments(params);',
  '\t\t} catch {',
  '\t\t\targs.sink({ schemaVersion: 1, attemptSeq: attempt, degraded: { reason: "hash-failed" }, meta });',
  '\t\t\treturn release();',
  '\t\t}',
  '\t\targs.sink({ schemaVersion: 1, attemptSeq: attempt, wholeHash, segments, meta });',
  '\t\treturn release();',
  '\t};',
  '}',
  '//#endregion',
].join('\n')

/**
 * The inlined host-side GuardObserver + wire-form chain classifier for the
 * agent-loop bundle. Source of record: Go e63ceff2d7 core/agent-loop/src/
 * guard-observe.ts + the classifier cut of llm-pi-ai/src/guard-observe.ts.
 * The classifier ships in BOTH consumer bundles (γ: no official export face
 * is added, and a hypothetical partial state leaves each bundle individually
 * consistent). SessionLogOffset rides the bundle's own dsh-session import.
 */
const ZCTX_REGION_AGENT_LOOP_GUARD = [
  '//#region lib/types/zctx-guard-observe.js',
  '/**',
  ' * zctx P6-B inline — host-side GuardObserver + wire-form chain classifier (γ',
  ' * all-inline). Source of record: Go e63ceff2d7 core/agent-loop/src/',
  ' * guard-observe.ts + the classifier cut of llm-pi-ai/src/guard-observe.ts.',
  ' * The classifier ships in BOTH consumer bundles (self-contained bundles —',
  ' * no official export face is added). SessionLogOffset rides the bundle\'s',
  ' * own dsh-session import. Observe-only: the observer appends the log-only',
  ' * cache/guard-observe event and decides nothing (D1P2 §1.1).',
  ' */',
  'const GUARD_PLACEHOLDER_HASH = "";',
  '/** Same-shape placeholder pair so the frozen-segment checks pass vacuously. */',
  'function shapedGuard(segment) {',
  '\treturn {',
  '\t\tsystemHash: GUARD_PLACEHOLDER_HASH,',
  '\t\ttoolsHash: GUARD_PLACEHOLDER_HASH,',
  '\t\tmessagesHash: segment.messagesHash,',
  '\t\tmessageHashes: segment.messageHashes',
  '\t};',
  '}',
  '/** Frozen-segment + append-only chain check (cache-guardian.ts:451 cut, verbatim). */',
  'function verifyMonotonic(prev, next) {',
  '\tif (prev.systemHash !== next.systemHash) return { ok: false, reason: "system segment changed; system is frozen (reset event required)" };',
  '\tif (prev.toolsHash !== next.toolsHash) return { ok: false, reason: "tools segment changed; tools are frozen (reset event required)" };',
  '\tif (next.messageHashes.length < prev.messageHashes.length) {',
  '\t\treturn { ok: false, reason: `messages segment shrank from ${prev.messageHashes.length} to ${next.messageHashes.length} (not monotonic)` };',
  '\t}',
  '\tfor (let i = 0; i < prev.messageHashes.length; i++) {',
  '\t\tif (prev.messageHashes[i] !== next.messageHashes[i]) {',
  '\t\t\treturn { ok: false, reason: `message at index ${i} was rewritten in place (not monotonic; reset event required)` };',
  '\t\t}',
  '\t}',
  '\treturn { ok: true };',
  '}',
  '/** Class-2 strip for comparison (D1P2 §4.2): drop effort-synth entries, kinds kept aligned. */',
  'function stripClass2(segments) {',
  '\tconst messageHashes = [];',
  '\tconst messageKinds = [];',
  '\tfor (let index = 0; index < segments.messageHashes.length; index++) {',
  '\t\tif (segments.messageKinds[index] === "class2") continue;',
  '\t\tmessageHashes.push(segments.messageHashes[index] ?? "");',
  '\t\tmessageKinds.push(segments.messageKinds[index] ?? "normal");',
  '\t}',
  '\treturn { messagesHash: segments.messagesHash, messageHashes, messageKinds };',
  '}',
  'function firstMismatch(prev, next) {',
  '\tconst shared = Math.min(prev.length, next.length);',
  '\tfor (let index = 0; index < shared; index++) {',
  '\t\tif (prev[index] !== next[index]) return index;',
  '\t}',
  '\treturn void 0;',
  '}',
  'function findSubsequence(haystack, needle, from) {',
  '\tif (needle.length === 0) return from;',
  '\touter: for (let start = from; start + needle.length <= haystack.length; start++) {',
  '\t\tfor (let offset = 0; offset < needle.length; offset++) {',
  '\t\t\tif (haystack[start + offset] !== needle[offset]) continue outer;',
  '\t\t}',
  '\t\treturn start;',
  '\t}',
  '\treturn void 0;',
  '}',
  '/**',
  ' * Class-1 deferred-reorder classifier (D1P2 §4.1): the migrating tail must',
  ' * be class-1-form system messages that reappear in order as a subsequence',
  ' * after the mismatch point with only new messages interleaved.',
  ' */',
  'function classifyDeferredReorder(prevHashes, prevKinds, nextHashes) {',
  '\tconst mismatch = firstMismatch(prevHashes, nextHashes);',
  '\tif (mismatch === void 0) return { verdict: "fail" };',
  '\tconst tail = prevHashes.slice(mismatch);',
  '\tif (tail.some((_, offset) => prevKinds[mismatch + offset] !== "class1")) return { verdict: "fail" };',
  '\tconst position = findSubsequence(nextHashes, tail, mismatch);',
  '\tif (position === void 0) return { verdict: "fail" };',
  '\tconst interposed = nextHashes.slice(mismatch, position);',
  '\tif (interposed.some((hash) => prevHashes.includes(hash))) return { verdict: "fail" };',
  '\tconst strippedPrev = prevHashes.slice(0, mismatch);',
  '\tconst shared = firstMismatch(strippedPrev, nextHashes);',
  '\tconst sharedPrefixCount = shared ?? Math.min(strippedPrev.length, nextHashes.length);',
  '\treturn { verdict: "ok", sharedPrefixCount };',
  '}',
  '/**',
  ' * Class-4 attempt signature (D1P2 §4.4): within one logical request, a',
  ' * rebuild attempt is legal exactly when system and messages are byte-equal',
  ' * to attempt 1 and only tools differ.',
  ' */',
  'function classifyAttemptEquality(first, attempt) {',
  '\tif (first === void 0) return "unclassified";',
  '\tconst sameSystem = first.systemHash === attempt.systemHash;',
  '\tconst sameMessages = first.messageHashes.length === attempt.messageHashes.length && first.messageHashes.every((hash, index) => hash === attempt.messageHashes[index]);',
  '\tconst toolsChanged = first.toolsHash !== attempt.toolsHash;',
  '\treturn sameSystem && sameMessages && toolsChanged ? "class4" : "unclassified";',
  '}',
  'function hasKind(segments, kind) {',
  '\treturn segments.messageKinds.includes(kind);',
  '}',
  'function gapFields(gap) {',
  '\treturn gap ? { chainGap: true } : {};',
  '}',
  '/**',
  ' * messages-segment classification dispatch (D1P2 §4.5, W-G glue): class-4',
  ' * first (no transitions inside a request), then the transition guard before',
  ' * any comparison, then the monotonic chain on class-2-stripped hashes with',
  ' * the class-1 fallback, else unclassified.',
  ' */',
  'function classifyGuardObserve(args) {',
  '\tconst { prev, first, capture, chain, currentSeq, gap } = args;',
  '\tconst segments = capture.segments;',
  '\tif (capture.attemptSeq > 1) {',
  '\t\tif (classifyAttemptEquality(first?.segments, segments) === "class4") {',
  '\t\t\treturn { classified: true, classId: "class4-strict-downgrade" };',
  '\t\t}',
  '\t\treturn { classified: false, monotonic: "unclassified" };',
  '\t}',
  '\tif (prev === void 0) {',
  '\t\tif (hasKind(segments, "class3")) return { classified: true, classId: "class3-error-images" };',
  '\t\treturn { classified: true };',
  '\t}',
  '\tconst byRoute = prev.meta.provider !== capture.meta.provider || prev.meta.api !== capture.meta.api || prev.meta.modelId !== capture.meta.modelId ? "route-change" : void 0;',
  '\tconst transition = byRoute ?? chain.transitionMarkBetween(prev.seq + 1, currentSeq);',
  '\tif (transition !== void 0) {',
  '\t\treturn { classified: true, monotonic: "ok-after-reset", transition: { kind: transition } };',
  '\t}',
  '\tconst prevCore = stripClass2(prev.segments);',
  '\tconst nextCore = stripClass2(segments);',
  '\tif (verifyMonotonic(shapedGuard(prevCore), shapedGuard(nextCore)).ok) {',
  '\t\tconst classId = hasKind(segments, "class2") ? "class2-effort-synth" : hasKind(segments, "class3") ? "class3-error-images" : void 0;',
  '\t\treturn {',
  '\t\t\tclassified: true,',
  '\t\t\t...classId === void 0 ? {} : { classId },',
  '\t\t\tmonotonic: "ok",',
  '\t\t\t...gapFields(gap),',
  '\t\t\tsharedPrefixCount: prevCore.messageHashes.length',
  '\t\t};',
  '\t}',
  '\tconst reorder = classifyDeferredReorder(prevCore.messageHashes, prevCore.messageKinds, nextCore.messageHashes);',
  '\tif (reorder.verdict === "ok") {',
  '\t\treturn {',
  '\t\t\tclassified: true,',
  '\t\t\tclassId: "class1-deferred-reorder",',
  '\t\t\tmonotonic: "ok-after-classification",',
  '\t\t\t...gapFields(gap),',
  '\t\t\tsharedPrefixCount: reorder.sharedPrefixCount',
  '\t\t};',
  '\t}',
  '\tconst mismatch = firstMismatch(prevCore.messageHashes, nextCore.messageHashes);',
  '\treturn {',
  '\t\tclassified: false,',
  '\t\tmonotonic: "unclassified",',
  '\t\t...gapFields(gap),',
  '\t\tsharedPrefixCount: mismatch ?? Math.min(prevCore.messageHashes.length, nextCore.messageHashes.length)',
  '\t};',
  '}',
  '/** Session-log events that mark a known-legal context rewrite (D1P2 §4.5 guard 2). */',
  'const TRANSITION_MARKS = {',
  '\t"compaction/start": "compaction",',
  '\t"compaction/end": "compaction",',
  '\t"cache/ledger": "reset-rewrite"',
  '};',
  '/** Classifies captures and appends cache/guard-observe events for one agent session. */',
  'class GuardObserver {',
  '\tbase = void 0;',
  '\tfirstAttempt = void 0;',
  '\tgap = false;',
  '\tchainView = {',
  '\t\ttransitionMarkBetween: (fromSeqInclusive, toSeqExclusive) => this.transitionMarkBetween(fromSeqInclusive, toSeqExclusive)',
  '\t};',
  '\tconstructor(session, warn) {',
  '\t\tthis.session = session;',
  '\t\tthis.warn = warn;',
  '\t}',
  '/**',
  ' * Sink for GenerateOptions.onGuardObserve: invoked synchronously by the',
  ' * adapter fetch wrapper once per attempt, in fetch order, so the appends',
  ' * land in the log in wire order.',
  ' */',
  '\tobserve(capture) {',
  '\t\tif (capture.segments === void 0) {',
  '\t\t\t// A7 degraded capture, or the whole-package fallback: log-only, no',
  '\t\t\t// chain participation, and the next segmented record reads the',
  '\t\t\t// crossing as a gap.',
  '\t\t\tthis.session.append("cache/guard-observe", {',
  '\t\t\t\tschemaVersion: 1,',
  '\t\t\t\tattemptSeq: capture.attemptSeq,',
  '\t\t\t\t...capture.wholeHash === void 0 ? {} : { wholeHash: capture.wholeHash },',
  '\t\t\t\tclassified: false,',
  '\t\t\t\t...capture.degraded === void 0 ? {} : { degraded: capture.degraded },',
  '\t\t\t\tmeta: capture.meta',
  '\t\t\t});',
  '\t\t\tthis.gap = true;',
  '\t\t\treturn;',
  '\t\t}',
  '\t\tconst currentSeq = this.session.seq;',
  '\t\tconst decision = classifyGuardObserve({',
  '\t\t\tprev: this.base,',
  '\t\t\tfirst: this.firstAttempt,',
  '\t\t\tcapture: { ...capture, segments: capture.segments },',
  '\t\t\tchain: this.chainView,',
  '\t\t\tcurrentSeq,',
  '\t\t\tgap: this.gap',
  '\t\t});',
  '\t\tconst event = { ...capture, ...decision };',
  '\t\tconst { seq } = this.session.append("cache/guard-observe", event);',
  '\t\tif (decision.monotonic === "unclassified") this.warnUnclassified(capture, decision);',
  '\t\tconst record = { seq, segments: capture.segments, meta: capture.meta };',
  '\t\tthis.base = record;',
  '\t\tthis.gap = false;',
  '\t\tif (capture.attemptSeq === 1) this.firstAttempt = record;',
  '\t}',
  '/** Transition-mark scan over the window (window-bounded read cost, D1P2 §4.5 R2-5). */',
  '\ttransitionMarkBetween(fromSeqInclusive, toSeqExclusive) {',
  '\t\tlet kind = void 0;',
  '\t\tconst events = this.session.snapshotEvents(SessionLogOffset(fromSeqInclusive), SessionLogOffset(toSeqExclusive));',
  '\t\tfor (const event of events) {',
  '\t\t\tconst mark = TRANSITION_MARKS[event.type];',
  '\t\t\tif (mark === void 0) continue;',
  '\t\t\tif (mark === "compaction") return "compaction";',
  '\t\t\tkind = mark;',
  '\t\t}',
  '\t\treturn kind;',
  '\t}',
  '/** D1P2 §8.2: an unclassified form is visible and searchable on the log face. */',
  '\twarnUnclassified(capture, decision) {',
  '\t\tconst mismatchAt = decision.sharedPrefixCount;',
  '\t\tconst kindsAt = mismatchAt === void 0 ? "" : `; kinds at the mismatch: prev=${this.base?.segments.messageKinds[mismatchAt] ?? "none"} next=${capture.segments?.messageKinds[mismatchAt] ?? "none"}`;',
  '\t\tthis.warn(`cache/guard-observe: unclassified wire form at attempt ${capture.attemptSeq} (first mismatch after ${mismatchAt ?? "unknown"} shared messages${kindsAt}); recorded in full, no action taken`);',
  '\t}',
  '}',
  '//#endregion',
].join('\n')

/** The inlined L3 tool-result pruning vocabulary for the pruner bundle (Go e63ceff2d7 core/tools/src/l3.ts). pruningMeta is omitted: the official build has no in-tree declaring tool (γ minimal cut; P6-A §2.9). */
const ZCTX_REGION_PRUNER_L3 = [
  '//#region lib/types/zctx-l3-pruning.js',
  '/**',
  ' * zctx P6-B inline — L3 tool-result pruning vocabulary cut (Go e63ceff2d7',
  ' * core/tools/src/l3.ts). pruningMeta is omitted: the official build has no',
  ' * in-tree declaring tool, so the prune declarations ride future tool',
  ' * patches; undeclared results keep the uniform threshold either way.',
  ' */',
  '/** Meta key under which tools attach the pruning declaration. */',
  'const PRUNING_META_KEY = "l3.pruning";',
  '/**',
  ' * Narrow an opaque tool-result meta payload to a pruning declaration.',
  ' * Absent or malformed metadata yields undefined (the generic fallback), so',
  ' * logs without the declaration never throw during replay.',
  ' */',
  'function pruningFromMeta(meta) {',
  '\tif (typeof meta !== "object" || meta === null || Array.isArray(meta)) return void 0;',
  '\tconst value = meta[PRUNING_META_KEY];',
  '\tif (typeof value !== "object" || value === null || Array.isArray(value)) return void 0;',
  '\tconst { prunable, bytes } = value;',
  '\tif (typeof prunable !== "boolean") return void 0;',
  '\tif (typeof bytes !== "number" || !Number.isSafeInteger(bytes) || bytes < 0) return void 0;',
  '\treturn { prunable, bytes };',
  '}',
  '//#endregion',
].join('\n')

/**
 * The inlined budget-formula cut for the compaction-basic bundle: the three
 * model-slots budget.ts formulas verbatim + DEFAULT_OUTPUT_CAP + the L3 rule
 * toolCapToByteLimit (l3.ts). Only the toolCap row is materialized — the
 * patch's single consumer (P6-A §2.10 minimal-inline ruling).
 */
const ZCTX_REGION_COMPACTION_BUDGET = [
  '//#region lib/types/zctx-model-slots-budget.js',
  '/**',
  ' * zctx P6-B inline — budget-formula cut mirroring the fork model-slots',
  ' * budget.ts (computeMaxTokens/computeReserve/computeToolCap verbatim;',
  ' * DEFAULT_OUTPUT_CAP = 32768) + the L3 rule toolCapToByteLimit (l3.ts).',
  ' * Only the toolCap row is materialized — the patch\'s single consumer.',
  ' */',
  'const DEFAULT_OUTPUT_CAP = 32768;',
  '/** maxTokens = min(C, floor(W × 0.10)). */',
  'function computeMaxTokens(w, cap) {',
  '\treturn Math.min(cap, Math.floor(w * 0.10));',
  '}',
  '/** reserve = ceil(maxTokens × 1.25) + 4096. */',
  'function computeReserve(maxTokens) {',
  '\treturn Math.ceil(maxTokens * 1.25) + 4096;',
  '}',
  '/** toolCap = max(1024, floor(0.25 × (reserve - maxTokens))). */',
  'function computeToolCap(maxTokens, reserve) {',
  '\treturn Math.max(1024, Math.floor(0.25 * (reserve - maxTokens)));',
  '}',
  '/** The toolCap budget row the L3 per-result cap derives from. */',
  'function computeBudget(w, cap) {',
  '\tconst maxTokens = computeMaxTokens(w, cap);',
  '\tconst reserve = computeReserve(maxTokens);',
  '\treturn { maxTokens, reserve, toolCap: computeToolCap(maxTokens, reserve) };',
  '}',
  '/** L3 rule: byte cap = toolCap × 3.5 characters (UTF-8 bytes), at least 1. */',
  'function toolCapToByteLimit(toolCapTokens) {',
  '\treturn Math.max(1, Math.floor(toolCapTokens * 3.5));',
  '}',
  '//#endregion',
].join('\n')

export const SUPPORTED = {
  '0.2.2-rc.3': {
    shellPackage: '@deepseek-ai/dsh-desktop',
    files: [
      // ------------------------------------------------------------------
      // File 1/5 — llm-pi-ai/lib/index.js: the P4 forwarding stub + the
      // guard observation wiring (config switch default TRUE per user
      // ruling, adapter guardSink + hash-then-passthrough fetch wrapper,
      // plugin apply wiring) + the inlined wrapper cluster.
      // ------------------------------------------------------------------
      {
        targetPath: 'dsh/node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/index.js',
        // Pristine SHA-256: P2 [F16] + P4 VERIFY-P #8 anchor, re-verified
        // live from the real asar 2026-11-16 (double-attested).
        pristineSha256: 'e956da3d7300e1426e13e14f47e6f981dd1ca345633a406568ee5058ad93e9d8',
        presenceMarker: 'globalThis.__zctxPatch__',
        ops: [
          // P4 one-line defensive forwarding stub (R1: adds options fields
          // only; identity = provider/model + options.sessionId in scope at
          // the call site). Carried into the v0.2 set unchanged.
          {
            anchor: '...profileOptions(profile, reasoning, apiKey),',
            replacement:
              '...profileOptions(profile, reasoning, apiKey),\n\t\t\t\t\t...(globalThis.__zctxPatch__?.wireOptions?.({ provider: options.provider, model: model.id, sessionId: options.sessionId }) ?? {}),',
          },
          // Import face for the inlined cluster (createHash already imported).
          {
            anchor: 'import { createHash } from "node:crypto";',
            replacement:
              'import { createHash } from "node:crypto";\n'
              + 'import { existsSync, readFileSync } from "node:fs";\n'
              + 'import { dirname, join } from "node:path";\n'
              + 'import { fileURLToPath } from "node:url";',
          },
          // Config schema: the observation switch, DEFAULT TRUE (user ruling
          // "完整功能生效"; observe-only — the sole kill switch; Go source
          // default false was overridden by the plan's ignition ruling).
          {
            anchor: 'const Config = z.object({ providers: z.dict(profile).default({}).volatile() });',
            replacement:
              'const Config = z.object({ providers: z.dict(profile).default({}).volatile(), guardObserve: z.boolean().default(true).volatile() });',
          },
          // Plugin apply wiring: the adapter reads the switch per request (a
          // flip reaches the next request without touching the route set).
          {
            anchor:
              '\t\tauth,\n\t\tprepareHeaders: (request, headers) => ctx.waterfall("llm-pi-ai/request-headers", request, headers, () => headers),',
            replacement:
              '\t\tauth,\n'
              + '\t\tguardObserve: () => config.guardObserve.get(),\n'
              + '\t\tprepareHeaders: (request, headers) => ctx.waterfall("llm-pi-ai/request-headers", request, headers, () => headers),',
          },
          // Adapter guard sink (T3 L5-A A1): the surface installs only when
          // the switch is on AND the request carries a host sink; enabled
          // wrapping asserts the installed pi-ai forwards fetch (A6).
          {
            anchor:
              '\t\t\t\tconst iterator = toStreamChunks(snapshot.models.streamSimple(model, context, {',
            replacement:
              '\t\t\t\tconst guardSink = this.config.guardObserve?.() === true ? options.onGuardObserve : void 0;\n'
              + '\t\t\t\tif (guardSink !== void 0) assertGuardObserveSupport();\n'
              + '\t\t\t\tconst iterator = toStreamChunks(snapshot.models.streamSimple(model, context, {',
          },
          // Hash-then-passthrough per attempt: the wrapper never touches
          // init.body, it captures and releases the original bytes.
          {
            anchor:
              '\t\t\t\t\theaders: requestHeaders(profile.headers, options, model.baseUrl, this.config.prepareHeaders)',
            replacement:
              '\t\t\t\t\theaders: requestHeaders(profile.headers, options, model.baseUrl, this.config.prepareHeaders),\n'
              + '\t\t\t\t\t...guardSink === void 0 ? {} : { fetch: createGuardFetchWrapper({ model, sink: guardSink }) }',
          },
          // The inlined wrapper cluster (before the export line).
          {
            anchor: 'export { Config, PiAiAdapter, apply, inject, name, recordKeyFor, supportedProtocols };',
            replacement:
              `${ZCTX_REGION_LLM_PI_AI_GUARD}\nexport { Config, PiAiAdapter, apply, inject, name, recordKeyFor, supportedProtocols };`,
          },
        ],
      },
      // ------------------------------------------------------------------
      // File 2/5 — agent-loop/lib/index.js: the GuardObserver + chain
      // classifier (inlined, self-contained) + the ignition hunk (constructor)
      // + the request sink injection (buildRequest).
      // ------------------------------------------------------------------
      {
        targetPath: 'dsh/node_modules/@deepseek-ai/dsh-agent-loop/lib/index.js',
        // Pristine SHA-256 computed live from the real asar 2026-11-16.
        pristineSha256: 'f09f60814d4e96a880f41b9fc3832f33c56a28f954f48810d8439ce83ad6ffa8',
        presenceMarker: '//#region lib/types/zctx-guard-observe.js',
        ops: [
          // Ignition hunk (P6-A U4 ruling realized at the agent constructor —
          // the fork tree has no composition-root ignition either, F9, and
          // the official composition root is a dynamic plugin load, so the
          // constructor is the single-file ignition point): opt-in honored
          // (explicit false opts out), default ON. The llm-pi-ai config
          // switch stays the sole kill switch. Observe-only.
          {
            anchor: '\t\tthis.runtimeContext = new RuntimeContextProjection(this.ctx, session);',
            replacement:
              '\t\tthis.runtimeContext = new RuntimeContextProjection(this.ctx, session);\n'
              + '\t\tthis.guardObserver = (this.options.guardObserve ?? true) === true ? new GuardObserver(session, (message) => {\n'
              + '\t\t\tthis.loopCtx.logger?.warn(`agent "${this.id}": ${message}`);\n'
              + '\t\t}) : void 0;',
          },
          // Request sink injection (T3 L5-A): the session-bound chain carries
          // the observation sink when the observer exists; the adapter
          // installs its wrapper only when its own switch is also on.
          {
            anchor: '\t\t\tsessionId: this.session.id,\n\t\t\tsignal\n\t\t}));',
            replacement:
              '\t\t\tsessionId: this.session.id,\n'
              + '\t\t\t...this.guardObserver === void 0 ? {} : { onGuardObserve: (capture) => { this.guardObserver.observe(capture); } },\n'
              + '\t\t\tsignal\n\t\t}));',
          },
          // The inlined observer + classifier (before the export line).
          {
            anchor: 'export { AgentLoop, AgentLoop as default, CONFIGURED_AGENT_IDENTITIES_KEY, DEFAULT_MAX_PARALLEL_TOOL_CALLS };',
            replacement:
              `${ZCTX_REGION_AGENT_LOOP_GUARD}\nexport { AgentLoop, AgentLoop as default, CONFIGURED_AGENT_IDENTITIES_KEY, DEFAULT_MAX_PARALLEL_TOOL_CALLS };`,
          },
        ],
      },
      // ------------------------------------------------------------------
      // File 3/5 — session/lib/index.js: the cache/guard-observe event
      // vocabulary (KNOWN_SESSION_EVENT_TYPES — the persistence read path
      // refuses unknown types without the ignorable marker, so the appended
      // guard records must be first-class vocabulary).
      // ------------------------------------------------------------------
      {
        targetPath: 'dsh/node_modules/@deepseek-ai/dsh-session/lib/index.js',
        // Pristine SHA-256 computed live from the real asar 2026-11-16.
        pristineSha256: 'd9911b5e1585bcb142d03ce46eb2990b3fc7c254de5a76d3ffb124bd2469216c',
        presenceMarker: '"cache/guard-observe",',
        ops: [
          // Alphabetical insertion point (fork known-event-types.ts hunk,
          // Go diff +1: after 'assistant/message', before 'command/done').
          {
            anchor: '\t"assistant/message",\n\t"command/done",',
            replacement: '\t"assistant/message",\n\t"cache/guard-observe",\n\t"command/done",',
          },
        ],
      },
      // ------------------------------------------------------------------
      // File 4/5 — compaction-basic/lib/index.js: the L3 per-result budget
      // (computeBudget toolCap row → byteCapPerResult on the pressure path)
      // + the inlined budget formula cut.
      // ------------------------------------------------------------------
      {
        targetPath: 'dsh/node_modules/@deepseek-ai/dsh-compaction-basic/lib/index.js',
        // Pristine SHA-256 computed live from the real asar 2026-11-16.
        pristineSha256: 'e1a3019949d01b22baa91d6eb672d9559d76b97fb5bb45e0428715a316bf11d4',
        presenceMarker: '//#region lib/types/zctx-model-slots-budget.js',
        ops: [
          // The pressure-path budget (Go index.ts:356-362 hunk): declared
          // results honor the routed model's toolCap through
          // toolCapToByteLimit. Undeclared results keep the uniform threshold
          // (pruningFromMeta → undefined → limitFor falls back) — behavior
          // neutral until a declaring tool exists.
          {
            anchor: '\t\tif (prune !== void 0) {\n\t\t\tprune.pruneSession(agent.session);',
            replacement:
              '\t\tif (prune !== void 0) {\n'
              + '\t\t\tconst budget = computeBudget(info.context.contextWindow, header.config.maxTokens ?? info.defaultMaxTokens ?? DEFAULT_OUTPUT_CAP);\n'
              + '\t\t\tprune.pruneSession(agent.session, {\n'
              + '\t\t\t\tbyteCapPerResult: toolCapToByteLimit(budget.toolCap)\n'
              + '\t\t\t});',
          },
          // The inlined budget formula (before the export line).
          {
            anchor: 'export { BasicCompactionEngine, BasicCompactionEngine as default };',
            replacement: `${ZCTX_REGION_COMPACTION_BUDGET}\nexport { BasicCompactionEngine, BasicCompactionEngine as default };`,
          },
        ],
      },
      // ------------------------------------------------------------------
      // File 5/5 — compaction-tool-result-pruner/lib/index.js: the
      // pruneSession opts + l3.pruning declaration branch + per-call
      // limitFor + the inlined L3 vocabulary (γ: tools bundle untouched).
      // ------------------------------------------------------------------
      {
        targetPath: 'dsh/node_modules/@deepseek-ai/dsh-compaction-tool-result-pruner/lib/index.js',
        // Pristine SHA-256 computed live from the real asar 2026-11-16.
        pristineSha256: 'e86442e9a2403c392482b9035916e5610c251d62f3581892866404d69c064254',
        presenceMarker: '//#region lib/types/zctx-l3-pruning.js',
        ops: [
          // pruneContent gains the per-call limit (Go hunk 1).
          {
            anchor: '\tpruneContent(blocks) {',
            replacement: '\tpruneContent(blocks, limitChars = this.config.thresholdChars) {',
          },
          // Threshold comparisons ride limitChars (Go hunks 2-3).
          {
            anchor: '\t\tif (totalChars <= this.config.thresholdChars) return null;',
            replacement: '\t\tif (totalChars <= limitChars) return null;',
          },
          {
            anchor:
              '\t\tif (charsAfter > this.config.thresholdChars || charsAfter >= totalChars) throw new Error("tool-result prune: replacement must be smaller and within threshold");',
            replacement:
              '\t\tif (charsAfter > limitChars || charsAfter >= totalChars) throw new Error("tool-result prune: replacement must be smaller and within threshold");',
          },
          // pruneSession gains the per-pass budgets (Go hunk 4).
          {
            anchor: '\tpruneSession(session) {',
            replacement: '\tpruneSession(session, opts = {}) {',
          },
          // The declaration branch: a non-prunable result is never rewritten
          // (Go hunk 5).
          {
            anchor: '\t\t\tconst original = session.deriveEventMessage(event);',
            replacement:
              '\t\t\tconst declared = pruningFromMeta(event.data.meta);\n'
              + '\t\t\tif (declared !== void 0 && !declared.prunable) continue;\n'
              + '\t\t\tconst original = session.deriveEventMessage(event);',
          },
          // The effective limit for one candidate (Go hunk 6).
          {
            anchor: '\t\t\tconst content = this.pruneContent(original.content);',
            replacement: '\t\t\tconst content = this.pruneContent(original.content, this.limitFor(declared, opts));',
          },
          // limitFor (Go hunk 7), inserted before the class close.
          {
            anchor:
              '\t\t\tcharsRemoved += charsBefore - charsAfter;\n\t\t}\n\t\treturn {\n\t\t\tpruned,\n\t\t\tcharsRemoved\n\t\t};\n\t}\n};',
            replacement:
              '\t\t\tcharsRemoved += charsBefore - charsAfter;\n'
              + '\t\t}\n'
              + '\t\treturn {\n'
              + '\t\t\tpruned,\n'
              + '\t\t\tcharsRemoved\n'
              + '\t\t};\n'
              + '\t}\n'
              + '\t/**\n'
              + '\t * Resolve the effective code-point threshold for one candidate: a\n'
              + '\t * declared prunable result honors opts.byteCapPerResult; the uniform\n'
              + '\t * threshold applies whenever the declaration is absent or the cap\n'
              + '\t * cannot represent a valid replacement.\n'
              + '\t */\n'
              + '\tlimitFor(declared, opts) {\n'
              + '\t\tif (declared === void 0) return this.config.thresholdChars;\n'
              + '\t\tconst cap = opts.byteCapPerResult;\n'
              + '\t\tif (typeof cap !== "number" || !Number.isFinite(cap) || cap <= 0) return this.config.thresholdChars;\n'
              + '\t\tconst minRepresentable = this.config.headChars + codePointLength(PRUNE_MARKER) + this.config.tailChars;\n'
              + '\t\treturn cap >= minRepresentable ? cap : this.config.thresholdChars;\n'
              + '\t}\n'
              + '};',
          },
          // The inlined L3 vocabulary (before the export line).
          {
            anchor: 'export { DEFAULTS, PRUNE_MARKER, ToolResultPruner, ToolResultPruner as default, codePointLength, resolveConfig };',
            replacement:
              `${ZCTX_REGION_PRUNER_L3}\nexport { DEFAULTS, PRUNE_MARKER, ToolResultPruner, ToolResultPruner as default, codePointLength, resolveConfig };`,
          },
        ],
      },
    ],
  },
}

// ---------------------------------------------------------------------------
// External anchor sets (patcher/anchors/<version>.json) — the fast-adaptation
// data channel (ZCTX-PATCH-AUTO D5).
//
// The in-code SUPPORTED map above stays the VERIFIED DEFAULT and is never
// migrated out. For any NEW official build, `reanchor` (below) can write a
// data anchor set; the loader prefers the data file for a version match and
// falls back to the in-code map otherwise. Fail-closed is NOT weakened: an
// unknown version is still refused, a corrupt/invalid data file is refused
// (never silently falling back), and — the real safety boundary — a data
// set's pristineSha256 values are re-verified per file by the EXISTING
// anchor-hash gate before anything is touched, and every op anchor is
// re-asserted count==1 by patchFile on the real bytes. Wrong data refuses
// before the patcher's hand ever moves.
// ---------------------------------------------------------------------------

/** Top-level metadata fields every data anchor set carries. */
const ANCHOR_SET_DATA_META_FIELDS = ['anchorSetVersion', 'generatedAt', 'sourceReport']

/** The directory holding the data anchor sets (next to this script). */
export function defaultAnchorsDir() {
  return join(dirname(fileURLToPath(import.meta.url)), 'anchors')
}

/**
 * The five probe target paths of the patch set of record (built on rc.3) —
 * the fixed extraction surface reanchor probes and the validator pins data
 * files to (a data set that names other targets is not this patch set).
 */
export function knownTargetPaths(versions = SUPPORTED) {
  const probe = versions['0.2.2-rc.3'] ?? Object.values(versions)[0]
  return normalizeEntry(probe).map((file) => file.targetPath)
}

/**
 * List the data anchor set versions available under the anchors dir
 * (read-only; `<version>.json` basenames, sorted). Absent dir = [].
 */
export function listAnchorSetVersions(anchorsDir = defaultAnchorsDir()) {
  if (!existsSync(anchorsDir)) return []
  return readdirSync(anchorsDir)
    .filter((name) => name.endsWith('.json'))
    .filter((name) => {
      try {
        return statSync(join(anchorsDir, name)).isFile()
      } catch {
        return false
      }
    })
    .map((name) => name.slice(0, -'.json'.length))
    .sort()
}

/**
 * Validate one parsed data anchor set against the schema (isomorphic with
 * the in-code entry + the three metadata fields). EVERY violation is a
 * loud refusal — a half-valid set is worse than none (fail-closed):
 *   - metadata: anchorSetVersion / generatedAt / sourceReport non-empty strings;
 *   - shellPackage non-empty string;
 *   - files: array of EXACTLY the known five target paths, each once
 *     (五目标路径), each with a 64-hex pristineSha256 (哈希形态), a
 *     non-empty presenceMarker (锚串), and a non-empty op list whose
 *     anchors are non-empty unique strings with string replacements
 *     (锚串/计数期望 — the runtime count==1 assertion stays in patchFile,
 *     on the real bytes, where it belongs).
 */
export function validateAnchorSetData(data, knownPaths = knownTargetPaths()) {
  const bad = (reason) => ({ ok: false, reason })
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return bad('anchor set data must be a JSON object')
  for (const field of ANCHOR_SET_DATA_META_FIELDS) {
    const value = data[field]
    if (typeof value !== 'string' || value === '') return bad(`metadata field "${field}" must be a non-empty string (got ${JSON.stringify(value ?? null)})`)
  }
  if (typeof data.shellPackage !== 'string' || data.shellPackage === '') return bad('"shellPackage" must be a non-empty string')
  if (!Array.isArray(data.files)) return bad('"files" must be an array')
  if (data.files.length !== knownPaths.length) return bad(`"files" must list exactly ${knownPaths.length} targets (got ${data.files.length})`)
  const seenTargets = new Set()
  for (let index = 0; index < data.files.length; index++) {
    const file = data.files[index]
    const where = `files[${index}]`
    if (typeof file !== 'object' || file === null || Array.isArray(file)) return bad(`${where} must be an object`)
    if (typeof file.targetPath !== 'string' || file.targetPath === '') return bad(`${where}.targetPath must be a non-empty string`)
    if (!knownPaths.includes(file.targetPath)) return bad(`${where}.targetPath "${file.targetPath}" is not one of the known probe targets {${knownPaths.join(', ')}}`)
    if (seenTargets.has(file.targetPath)) return bad(`${where}.targetPath "${file.targetPath}" is listed more than once`)
    seenTargets.add(file.targetPath)
    if (typeof file.pristineSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(file.pristineSha256)) return bad(`${where}.pristineSha256 must be 64 lowercase hex chars (got ${JSON.stringify(file.pristineSha256 ?? null)})`)
    if (typeof file.presenceMarker !== 'string' || file.presenceMarker === '') return bad(`${where}.presenceMarker must be a non-empty string`)
    if (!Array.isArray(file.ops) || file.ops.length === 0) return bad(`${where}.ops must be a non-empty array`)
    const seenAnchors = new Set()
    for (let opIndex = 0; opIndex < file.ops.length; opIndex++) {
      const op = file.ops[opIndex]
      const at = `${where}.ops[${opIndex}]`
      if (typeof op !== 'object' || op === null || Array.isArray(op)) return bad(`${at} must be an object`)
      if (typeof op.anchor !== 'string' || op.anchor === '') return bad(`${at}.anchor must be a non-empty string`)
      if (typeof op.replacement !== 'string') return bad(`${at}.replacement must be a string`)
      if (seenAnchors.has(op.anchor)) return bad(`${at}.anchor duplicates an earlier anchor in this file (count expectations would collide)`)
      seenAnchors.add(op.anchor)
    }
    if (seenAnchors.has(file.presenceMarker)) return bad(`${where}.presenceMarker collides with an op anchor`)
  }
  return { ok: true, entry: { shellPackage: data.shellPackage, files: data.files } }
}

/**
 * Load `patcher/anchors/<version>.json` if it exists. Returns:
 *   { absent: true }                                   — no data file (clean fallthrough)
 *   { ok: true, entry, path, meta }                    — validated data set
 *   { ok: false, reason, path }                        — file EXISTS but is unreadable/invalid:
 *                                                        the caller refuses LOUDLY and never
 *                                                        falls back to the in-code map.
 */
export function loadAnchorSetData(version, anchorsDir = defaultAnchorsDir(), knownPaths = knownTargetPaths()) {
  const path = join(anchorsDir, `${version}.json`)
  if (!existsSync(path)) return { absent: true }
  let parsed
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    return { ok: false, path, reason: `data anchor set parse failed: ${error instanceof Error ? error.message : String(error)}` }
  }
  const check = validateAnchorSetData(parsed, knownPaths)
  if (!check.ok) return { ok: false, path, reason: `data anchor set rejected: ${check.reason}` }
  return { ok: true, entry: check.entry, path, meta: { anchorSetVersion: parsed.anchorSetVersion, generatedAt: parsed.generatedAt, sourceReport: parsed.sourceReport } }
}

/**
 * Resolve the anchor-set entry for one shell version — data file first, then
 * the in-code map. Returns { entry, source: 'data'|'in-code'|'none'|'error',
 * ... }: source 'error' means a data file exists but failed validation —
 * `reason` is loud and the caller must refuse (fail-closed, no fallback).
 */
export function resolveAnchorEntry(shellVersion, { versions = SUPPORTED, anchorsDir = defaultAnchorsDir(), knownPaths = undefined } = {}) {
  const paths = knownPaths ?? knownTargetPaths(versions)
  const data = loadAnchorSetData(shellVersion, anchorsDir, paths)
  if (data.absent) {
    const inCode = typeof shellVersion === 'string' ? versions[shellVersion] : undefined
    return inCode !== undefined
      ? { entry: inCode, source: 'in-code' }
      : { entry: undefined, source: 'none', reason: `no anchor set for ${String(shellVersion)} (no data file, not in the in-code map)` }
  }
  if (!data.ok) return { entry: undefined, source: 'error', reason: data.reason, path: data.path }
  return { entry: data.entry, source: 'data', path: data.path, meta: data.meta }
}

// ---------------------------------------------------------------------------
// Small helpers.
// ---------------------------------------------------------------------------

/** sha256 hex of a Buffer. */
function sha256Hex(buf) {
  return createHash('sha256').update(buf).digest('hex')
}

/** Occurrence count of a literal needle. */
function countOccurrences(haystack, needle) {
  return needle === '' ? 0 : haystack.split(needle).length - 1
}

/**
 * @electron/asar 4.3.2's Filesystem.getNode splits lookup paths on
 * `path.sep` (filesystem-native) while asar paths are spelled with '/' —
 * convert before every official extractFile call (verified live: the
 * forward-slash spelling throws "was not found in this archive" on win32).
 */
function nativeAsarPath(asarPath_) {
  return asarPath_.split('/').join(sep)
}

/**
 * File integrity record per @electron/asar 4.3.2 lib/integrity.js
 * (getFileIntegrityFromBuffer): SHA256 whole-file + 4 MiB blocks; empty input
 * still yields one (empty) block.
 */
export function computeIntegrity(buf) {
  const BLOCK_SIZE = 4 * 1024 * 1024
  const hash = createHash('sha256').update(buf).digest('hex')
  const blocks = []
  for (let offset = 0; offset < buf.length; offset += BLOCK_SIZE) {
    const end = Math.min(offset + BLOCK_SIZE, buf.length)
    blocks.push(createHash('sha256').update(buf.subarray(offset, end)).digest('hex'))
  }
  if (buf.length === 0) blocks.push(createHash('sha256').update(buf).digest('hex'))
  return { algorithm: 'SHA256', hash, blockSize: BLOCK_SIZE, blocks }
}

/** @electron/asar loader with honest guidance when the devDep is absent. */
let asarModulePromise
async function loadAsar() {
  asarModulePromise ??= import('@electron/asar').catch((error) => {
    throw new Error(
      `@electron/asar is not resolvable from this location — run inside the dsh-zcontext repo `
        + `after \`pnpm install\` (devDependency), or \`npm i @electron/asar\` first (${error?.message ?? error})`,
    )
  })
  return asarModulePromise
}

/**
 * The header pickle buffer, mirroring @electron/asar lib/pickle.js exactly:
 * payload = [u32 jsonLen][json utf8 bytes][zero-pad to 4]; the buffer carries
 * a 4-byte size field in front of the payload. (Real rc.3 round-trip check:
 * jsonLen 5,669,961 → headerSize 5,669,972 = 4 + 4 + align4 — matches the
 * live asar read.)
 */
function buildHeaderPickle(jsonText) {
  const jsonBuf = Buffer.from(jsonText, 'utf8')
  const aligned = (jsonBuf.length + 3) & ~3
  const payloadSize = 4 + aligned
  const buf = Buffer.alloc(4 + payloadSize)
  buf.writeUInt32LE(payloadSize, 0)
  buf.writeUInt32LE(jsonBuf.length, 4)
  jsonBuf.copy(buf, 8)
  return buf
}

/** The 8-byte outer size pickle: [u32 4][u32 headerPickleLength]. */
function buildSizePickle(headerPickleLength) {
  const buf = Buffer.alloc(8)
  buf.writeUInt32LE(4, 0)
  buf.writeUInt32LE(headerPickleLength, 4)
  return buf
}

/** Walk the header tree to one node; undefined when absent/a directory. */
function headerNodeAt(header, asarPath_) {
  let node = header
  for (const part of asarPath_.split('/')) {
    if (node?.files === undefined) return undefined
    node = node.files[part]
    if (node === undefined) return undefined
  }
  return node.files !== undefined ? undefined : node
}

/** Recursively visit every packed file node with its asar-relative path. */
function visitPackedNodes(node, visit, prefix = '') {
  if (node.files !== undefined) {
    for (const [name, child] of Object.entries(node.files)) {
      visitPackedNodes(child, visit, prefix === '' ? name : `${prefix}/${name}`)
    }
    return
  }
  if (node.offset !== undefined) visit(node, prefix)
}

// ---------------------------------------------------------------------------
// The pure text patch (anchor uniqueness + idempotence + post-assert).
// ---------------------------------------------------------------------------

/**
 * Apply the one-line stub to the target text. Refuses unless the call-site
 * anchor occurs EXACTLY once and the stub marker is absent (already-patched
 * → { ok:false, alreadyPatched:true }); post-asserts exactly one marker.
 */
export function patchText(text, entry) {
  const callCount = countOccurrences(text, entry.anchors.callSite)
  if (callCount !== 1) {
    return { ok: false, reason: `call-site anchor occurs ${callCount} times (must be exactly 1) — refusing` }
  }
  if (countOccurrences(text, entry.anchors.stubMarker) !== 0) {
    return { ok: false, alreadyPatched: true, reason: 'patch stub already present (idempotent no-op)' }
  }
  if (countOccurrences(text, entry.anchors.definition) !== 1) {
    return { ok: false, reason: 'definition anchor (shape fingerprint) not unique — file shape unexpected, refusing' }
  }
  const patched = text.replace(
    entry.anchors.callSite,
    `${entry.anchors.callSite}\n${entry.stubIndent}${entry.stub}`,
  )
  const markerCount = countOccurrences(patched, entry.anchors.stubMarker)
  if (markerCount !== 1) {
    return { ok: false, reason: `post-patch marker count ${markerCount} (must be exactly 1) — refusing` }
  }
  return { ok: true, text: patched, byteLength: Buffer.byteLength(patched, 'utf8') }
}

// ---------------------------------------------------------------------------
// v0.2 multi-file patch-set layer (γ all-inline).
// ---------------------------------------------------------------------------

/**
 * Normalize an anchor-set entry into the v0.2 multi-file shape. A legacy
 * single-target entry (P4 v0.1 shape: targetPath/targetSha256/anchors/stub/
 * stubIndent) becomes a one-file entry whose single op is the stub insert —
 * so v0.1 entries (and the v0.1 fixture tests) keep flowing through the
 * v0.2 machinery unchanged.
 */
export function normalizeEntry(entry) {
  if (Array.isArray(entry?.files)) return entry.files
  return [
    {
      targetPath: entry.targetPath,
      pristineSha256: entry.targetSha256,
      presenceMarker: entry.anchors.stubMarker,
      ...(entry.anchors.definition !== undefined ? { fingerprint: entry.anchors.definition } : {}),
      ops: [
        {
          anchor: entry.anchors.callSite,
          replacement: `${entry.anchors.callSite}\n${entry.stubIndent}${entry.stub}`,
        },
      ],
    },
  ]
}

/**
 * Apply an ordered op list to one file's text. Every op is {anchor,
 * replacement}: the anchor must occur EXACTLY once and is replaced wholesale
 * (insert-after/insert-before are expressed as replacements that embed the
 * anchor). Any anchor count ≠ 1 refuses — never patch blind. This runs only
 * on files the gate chain proved PRISTINE, so per-op idempotence is not
 * needed here (the file-level reconstruction gate owns that).
 */
export function patchFile(text, fileEntry) {
  if (countOccurrences(text, fileEntry.presenceMarker) > 0) {
    return { ok: false, alreadyPatched: true, reason: 'presence marker already in the text — refusing to double-apply' }
  }
  let patched = text
  for (let index = 0; index < fileEntry.ops.length; index++) {
    const op = fileEntry.ops[index]
    const count = countOccurrences(patched, op.anchor)
    if (count !== 1) {
      return {
        ok: false,
        reason: `op ${index} anchor occurs ${count} times (must be exactly 1) — refusing`,
      }
    }
    // Function-form replacement: no `$`-pattern substitution semantics.
    patched = patched.replace(op.anchor, () => op.replacement)
  }
  if (countOccurrences(patched, fileEntry.presenceMarker) === 0) {
    return { ok: false, reason: 'post-patch presence marker absent — patch text incomplete, refusing' }
  }
  return { ok: true, text: patched, byteLength: Buffer.byteLength(patched, 'utf8') }
}

/**
 * Reconstruct the pristine text from a patched text by reversing every op in
 * REVERSE order (replace op.replacement → op.anchor, each exactly once).
 * Returns undefined when any reversal is unprovable — the caller then reports
 * drifted (P4-r1 P4-3 reconstruction proof, generalized to op lists).
 */
export function reconstructPristineText(text, fileEntry) {
  let current = text
  for (let index = fileEntry.ops.length - 1; index >= 0; index--) {
    const op = fileEntry.ops[index]
    if (countOccurrences(current, op.replacement) !== 1) return undefined
    current = current.replace(op.replacement, () => op.anchor)
  }
  return current
}

/**
 * Three-state discrimination of ONE target file (the gate's unit):
 *   'pristine'     — bytes match the pinned pristine hash
 *   'patched-exact' — reversing every op reconstructs the pinned pristine
 *                     hash (marker-independent exactness proof)
 *   'drifted'      — anything else (official update or foreign modification)
 */
export function fileStateOf(text, fileEntry) {
  const sha = sha256Hex(Buffer.from(text, 'utf8'))
  if (sha === fileEntry.pristineSha256) return { state: 'pristine', sha256: sha }
  const reconstructed = reconstructPristineText(text, fileEntry)
  if (reconstructed !== undefined && sha256Hex(Buffer.from(reconstructed, 'utf8')) === fileEntry.pristineSha256) {
    return { state: 'patched-exact', sha256: sha }
  }
  return { state: 'drifted', sha256: sha }
}

// ---------------------------------------------------------------------------
// Positional asar reads (cache-free; the splice must never see stale caches).
// ---------------------------------------------------------------------------

/** Read the header (JSON + size) via positioned reads. @internal */
function readHeaderPositioned(asarPath) {
  const fd = openSync(asarPath, 'r')
  try {
    const sizeBuf = Buffer.alloc(8)
    if (readSync(fd, sizeBuf, 0, 8, 0) !== 8) throw new Error(`unable to read the asar header size: ${asarPath}`)
    const headerSize = sizeBuf.readUInt32LE(4)
    if (8 + headerSize > statSync(asarPath).size) {
      throw new Error(`asar header size ${headerSize} exceeds archive size — corrupted archive`)
    }
    const headerPickle = Buffer.alloc(headerSize)
    readSync(fd, headerPickle, 0, headerSize, 8)
    const jsonLen = headerPickle.readUInt32LE(4)
    const jsonText = headerPickle.toString('utf8', 8, 8 + jsonLen)
    return { header: JSON.parse(jsonText), headerSize }
  } finally {
    closeSync(fd)
  }
}

/** Positional single-file extraction through the local header reader. @internal */
function extractPositioned(asarPath, asarPath_) {
  const { header, headerSize } = readHeaderPositioned(asarPath)
  const node = headerNodeAt(header, asarPath_)
  if (node === undefined) throw new Error(`not found in asar: ${asarPath_}`)
  if (node.files !== undefined) throw new Error(`is a directory in asar: ${asarPath_}`)
  if (node.unpacked === true || node.offset === undefined) {
    throw new Error(`file is unpacked outside this asar: ${asarPath_}`)
  }
  const fd = openSync(asarPath, 'r')
  try {
    const buf = Buffer.alloc(node.size)
    const start = 8 + headerSize + Number(node.offset)
    if (readSync(fd, buf, 0, node.size, start) !== node.size) {
      throw new Error(`short read for ${asarPath_} (${node.size} B at ${start})`)
    }
    return buf
  } finally {
    closeSync(fd)
  }
}

// ---------------------------------------------------------------------------
// The surgical asar splice.
// ---------------------------------------------------------------------------

/**
 * Splice ONE patched target file into the archive (v0.1 shape kept for the
 * v0.1 fixture tests): a thin single-target wrapper over
 * {@link spliceAsarMulti}.
 */
export function spliceAsar({ asarPath, targetPath, entry, patchedText }) {
  const result = spliceAsarMulti({ asarPath, targets: [{ targetPath, patchedText }] })
  return {
    buffer: result.buffer,
    before: result.targets[0].before,
    after: result.targets[0].after,
    delta: result.targets[0].delta,
    headerSizeBefore: result.headerSizeBefore,
    headerSizeAfter: result.headerSizeAfter,
    payloadSizeBefore: result.payloadSizeBefore,
    witnesses: result.witnesses,
  }
}

/**
 * Splice SEVERAL patched target files into the archive in ONE operation (the
 * v0.2 multi-file patch set applies as a single asar write — no partial
 * multi-file state can persist past a crash): header JSON mutated in place
 * (each target gets new size + integrity; every non-target offset shifts by
 * the SUM of the deltas of the target regions positioned before it), payload
 * rebuilt around the sorted target regions — every other packed byte
 * IDENTICAL, unpacked-file flags untouched. Returns the complete new archive
 * buffer plus per-target accounting + pristine witnesses for the post-verify.
 */
export function spliceAsarMulti({ asarPath, targets }) {
  const { header, headerSize } = readHeaderPositioned(asarPath)
  const resolved = targets.map(({ targetPath, patchedText }) => {
    const node = headerNodeAt(header, targetPath)
    if (node === undefined) {
      throw new Error(`target file not present in the asar header: ${targetPath}`)
    }
    if (node.unpacked === true || node.offset === undefined) {
      throw new Error(`target file is unpacked (not stored inside this asar) — unsupported: ${targetPath}`)
    }
    return {
      targetPath,
      node,
      start: Number(node.offset),
      oldSize: node.size,
      newBuf: Buffer.from(patchedText, 'utf8'),
    }
  })
  // Overlapping targets are a spec error, not a splice case.
  const starts = resolved.map((target) => target.start).sort((a, b) => a - b)
  for (let index = 1; index < starts.length; index++) {
    if (starts[index] === starts[index - 1]) throw new Error('duplicate target offset in the patch set — refusing')
  }

  // Pristine witnesses BEFORE the header mutation: the first packed file in
  // header order and the first packed file positioned after ALL targets —
  // their bytes must be untouched (pristine integrity hash) after the splice.
  // No target is ever its own witness.
  //
  // Layout premise made explicit (P4-r1 P4-1): a file's header offset shifts
  // by the summed deltas of the target regions BEFORE it; `afterTarget` is
  // recorded from the collection-time offset, so the post-verify expectation
  // never depends on the archive layout.
  const targetStarts = new Set(resolved.map((target) => target.start))
  const lastTargetEnd = Math.max(...resolved.map((target) => target.start + target.oldSize))
  const shiftFor = (offset) =>
    resolved.reduce((sum, target) => (offset > target.start ? sum + (target.newBuf.length - target.oldSize) : sum), 0)
  const witnesses = []
  visitPackedNodes(header, (node, path) => {
    if (witnesses.length >= 2 || node.integrity === undefined) return
    const offset = Number(node.offset)
    if (targetStarts.has(offset)) return
    if (witnesses.length === 0 || offset >= lastTargetEnd) {
      witnesses.push({
        path,
        oldOffset: offset,
        afterTarget: shiftFor(offset) !== 0,
        shift: shiftFor(offset),
        size: node.size,
        integrityHash: node.integrity.hash,
      })
    }
  })

  // Header mutation: reset each target's size + integrity; shift EVERY other
  // packed file's offset by the summed deltas of the targets positioned
  // before it. Targets shift too: a target sitting after a GROWN earlier
  // target region moves back in the payload (its own delta is excluded —
  // shiftFor sums only starts strictly below the file's offset).
  visitPackedNodes(header, (node) => {
    const offset = Number(node.offset)
    const target = resolved.find((candidate) => candidate.start === offset)
    if (target !== undefined) {
      target.before = { size: target.oldSize, sha256: sha256Hex(wholeFor(asarPath, payloadBaseOf(headerSize), target.start, target.oldSize)) }
      target.after = { size: target.newBuf.length, sha256: sha256Hex(target.newBuf) }
      node.size = target.newBuf.length
      node.integrity = computeIntegrity(target.newBuf)
    }
    if (shiftFor(offset) !== 0) {
      node.offset = String(offset + shiftFor(offset))
    }
  })

  // Payload splice around the sorted target regions (one whole-file read).
  const whole = readFileSync(asarPath)
  const payloadBase = 8 + headerSize
  const sorted = [...resolved].sort((a, b) => a.start - b.start)
  const pieces = []
  let cursor = 0
  for (const target of sorted) {
    pieces.push(whole.subarray(payloadBase + cursor, payloadBase + target.start))
    pieces.push(target.newBuf)
    cursor = target.start + target.oldSize
  }
  pieces.push(whole.subarray(payloadBase + cursor))

  const headerPickle = buildHeaderPickle(JSON.stringify(header))
  const buffer = Buffer.concat([buildSizePickle(headerPickle.length), headerPickle, Buffer.concat(pieces)])
  return {
    buffer,
    targets: resolved.map(({ targetPath, before, after, newBuf, oldSize }) => ({
      targetPath,
      before,
      after,
      delta: newBuf.length - oldSize,
    })),
    delta: resolved.reduce((sum, target) => sum + (target.newBuf.length - target.oldSize), 0),
    headerSizeBefore: headerSize,
    headerSizeAfter: headerPickle.length,
    payloadSizeBefore: whole.length - payloadBase,
    witnesses,
  }
}

/** @internal payload base offset of an archive with the given header size. */
function payloadBaseOf(headerSize) {
  return 8 + headerSize
}

/** @internal positional read of one file region (used for target before-hashes). */
function wholeFor(asarPath, payloadBase, start, size) {
  const fd = openSync(asarPath, 'r')
  try {
    const buf = Buffer.alloc(size)
    if (readSync(fd, buf, 0, size, payloadBase + start) !== size) {
      throw new Error(`short read for the target region (${size} B at ${payloadBase + start})`)
    }
    return buf
  } finally {
    closeSync(fd)
  }
}

// ---------------------------------------------------------------------------
// App-dir resolution + running-app gate.
// ---------------------------------------------------------------------------

/** Resolve the app dir: --app-dir wins, then the registry, then the default. */
export function resolveAppDir(explicit) {
  if (explicit !== undefined && explicit !== '') {
    return { appDir: resolve(explicit), source: 'argument' }
  }
  if (process.platform === 'win32') {
    const probed = spawnSync('reg', ['query', REGISTRY_KEY, '/v', 'InstallLocation'], { encoding: 'utf8' })
    if (probed.status === 0 && typeof probed.stdout === 'string') {
      const match = /InstallLocation\s+REG_SZ\s+(.+)/.exec(probed.stdout)
      const dir = match?.[1]?.trim()
      if (dir !== undefined && dir !== '' && existsSync(join(dir, 'resources', 'app.asar'))) {
        return { appDir: dir, source: 'registry' }
      }
    }
  }
  if (existsSync(join(DEFAULT_APP_DIR, 'resources', 'app.asar'))) {
    return { appDir: DEFAULT_APP_DIR, source: 'default' }
  }
  return { appDir: undefined, source: 'none' }
}

/**
 * Is the desktop app running? Default probe = tasklist on win32 (best-effort
 * — an unavailable probe reports 'unknown'; the lock file stays the honest
 * hard signal). Injectable for tests.
 */
export function probeAppRunningDefault() {
  if (process.platform !== 'win32') return 'unknown'
  try {
    const probed = spawnSync('tasklist', ['/FI', `IMAGENAME eq ${APP_EXE}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8' })
    return `${probed.stdout ?? ''}`.includes(APP_EXE) ? 'yes' : 'no'
  } catch {
    return 'unknown'
  }
}

/**
 * The app-running gate for patch/restore: refuses when the process probe says
 * yes OR the app's own lock file exists (its wx-lock discipline, P2 [F30]).
 * A stale lock is the app's business — the patcher never deletes it; the user
 * closes the app (or removes the stale lock) themselves.
 */
export function appRunningGate({ dshHome, probeAppRunning = probeAppRunningDefault }) {
  const running = probeAppRunning()
  if (running === 'yes') {
    return {
      ok: false,
      reason: `${APP_EXE} is running — close the app, then re-run (the patch applies only to a closed install)`,
    }
  }
  const lockPath = desktopLockPath(dshHome)
  if (existsSync(lockPath)) {
    return {
      ok: false,
      reason: `the app's project lock exists (${lockPath}) — close the app (or remove a stale lock yourself), then re-run`,
    }
  }
  return { ok: true, detail: `app running: ${running}; lock file: absent` }
}

// ---------------------------------------------------------------------------
// Electron fuse wire (VERIFY-P #11 — the authoritative read, three-source
// cross-attested: the rc.3 exe bytes themselves, Electron v44.7.0's
// fuses.json5 schema, and @electron/fuses 2.1.3's constants).
// ---------------------------------------------------------------------------

/**
 * The Electron fuse-wire sentinel embedded in every fused exe. Its OFFSET
 * DRIFTS BETWEEN OFFICIAL BUILDS (rc.3: sentinel at 199,416,024 of
 * 246,341,104 B) — it MUST be scanned for, never assumed at a fixed offset
 * (a fixed offset would silently misread a newer exe).
 */
export const FUSE_SENTINEL = 'dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX'

/**
 * The version-1 fuse schema: 9 per-fuse state bytes, each ASCII '0' (off) /
 * '1' (on) / 'r' (removed). The 7-byte four-state encoding once claimed for
 * rc.3 (DISABLED='1'/ENABLED='2'/INHERIT='3') is REFUTED by the Electron
 * source — never reintroduce it (VERIFY-P #11).
 */
export const FUSE_V1_STATE_COUNT = 9

/**
 * FuseV1Options index of EnableEmbeddedAsarIntegrityValidation (0 RunAsNode,
 * 1 EnableCookieEncryption, 2 EnableNodeOptionsEnvironmentVariable,
 * 3 EnableNodeCliInspectArguments, 4 EnableEmbeddedAsarIntegrityValidation,
 * 5 OnlyLoadAppFromAsar, 6 LoadBrowserProcessSpecificV8Snapshot,
 * 7 GrantFileProtocolExtraPrivileges, 8 EnableWasmTrapHandlers).
 */
export const FUSE_INTEGRITY_INDEX = 4

/** Legal per-fuse state bytes: ASCII '0' (48) / '1' (49) / 'r' (114). */
const FUSE_STATE_BYTES = new Set([48, 49, 114])

/**
 * The desktop exe that carries the fuse wire (note the SPACE in the name).
 */
export function desktopExePath(appDir) {
  return join(appDir, APP_EXE)
}

/**
 * Read the Electron fuse wire from an exe (VERIFY-P #11): scan for the
 * sentinel, then parse [version 1B][wireLen 1B][wireLen ASCII state bytes].
 * The rc.3 reference read: `01 09 31 30 31 31 30 30 30 31 31` → version 1,
 * 9 states `101100011`, integrity (index 4) = '0' = off.
 *
 * Returns `{ found:true, version, stateCount, states, integrity, rawHex,
 * sentinelOffset, exePath, exeSize }` — or `{ found:false, reason }` for
 * EVERY anomaly (exe missing/unreadable, sentinel absent, wrong version,
 * wire-length overflow, length ≠ 9, illegal state byte). The caller refuses
 * fail-closed on !found — an unreadable integrity face is never guessed
 * through.
 */
export function readFuseWire(exePath) {
  if (!existsSync(exePath)) {
    return { found: false, exePath, reason: `exe not found at ${exePath}` }
  }
  let buf
  try {
    buf = readFileSync(exePath)
  } catch (error) {
    return { found: false, exePath, reason: `exe unreadable at ${exePath}: ${error instanceof Error ? error.message : String(error)}` }
  }
  const sentinel = Buffer.from(FUSE_SENTINEL, 'utf8')
  let searchFrom = 0
  let hits = 0
  let lastReason = `sentinel ${FUSE_SENTINEL} not found in the exe`
  for (;;) {
    const at = buf.indexOf(sentinel, searchFrom)
    if (at === -1) break
    hits += 1
    searchFrom = at + sentinel.length
    const wireAt = at + sentinel.length
    if (wireAt + 2 > buf.length) {
      lastReason = `sentinel hit ${hits} at ${at}: no room for the [version][length] header`
      continue
    }
    const version = buf[wireAt]
    const wireLen = buf[wireAt + 1]
    if (version !== 1) {
      lastReason = `sentinel hit ${hits} at ${at}: fuse wire version 0x${version.toString(16).padStart(2, '0')} — this reader implements version 1 only`
      continue
    }
    if (wireAt + 2 + wireLen > buf.length) {
      lastReason = `sentinel hit ${hits} at ${at}: wire length ${wireLen} overruns the exe — corrupt or foreign wire`
      continue
    }
    if (wireLen !== FUSE_V1_STATE_COUNT) {
      lastReason = `sentinel hit ${hits} at ${at}: wire length ${wireLen} != ${FUSE_V1_STATE_COUNT} (FuseV1Options v1 schema; the 7-byte reading is REFUTED)`
      continue
    }
    const states = buf.subarray(wireAt + 2, wireAt + 2 + wireLen)
    const illegalAt = [...states].findIndex((byte) => !FUSE_STATE_BYTES.has(byte))
    if (illegalAt !== -1) {
      lastReason = `sentinel hit ${hits} at ${at}: illegal state byte 0x${states[illegalAt].toString(16).padStart(2, '0')} at fuse index ${illegalAt} (legal: '0' off / '1' on / 'r' removed)`
      continue
    }
    return {
      found: true,
      exePath,
      exeSize: buf.length,
      version,
      stateCount: wireLen,
      states: Array.from(states, (byte) => String.fromCharCode(byte)).join(''),
      integrity: String.fromCharCode(states[FUSE_INTEGRITY_INDEX]),
      rawHex: buf.subarray(wireAt, wireAt + 2 + wireLen).toString('hex'),
      sentinelOffset: at,
    }
  }
  return {
    found: false,
    exePath,
    exeSize: buf.length,
    reason: lastReason,
    ...(hits > 0 ? { sentinelHits: hits } : {}),
  }
}

/**
 * Never-throw fuse read for the read-only surfaces (status/auto): any
 * surprise degrades to `{found:false, reason}` — loud, never silent; the
 * consumer refuses on !found.
 */
export function safeReadFuseWire(exePath) {
  try {
    return readFuseWire(exePath)
  } catch (error) {
    return { found: false, exePath, reason: `fuse probe threw: ${error instanceof Error ? error.message : String(error)}` }
  }
}

// ---------------------------------------------------------------------------
// Backup (§5 discipline on the user machine).
// ---------------------------------------------------------------------------

/**
 * Backup root = SIBLING of the app dir (OUTSIDE the install dir: the official
 * updater/uninstaller replaces the install dir wholesale, so a backup inside
 * it would be destroyed by exactly the event that kills the patch — P2
 * [F23]/[F29]).
 */
export function backupRootFor(appDir) {
  return join(dirname(appDir), 'zctx-backup')
}

function timestampId() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

function nextBackupDir(root) {
  const base = timestampId()
  let dir = join(root, base)
  let n = 2
  while (existsSync(dir)) {
    dir = join(root, `${base}-${n}`)
    n += 1
  }
  return dir
}

/**
 * Backup the current asar (+ marker when present) into a fresh sibling backup
 * dir; the copy is hash-verified against the source BEFORE the caller touches
 * anything. RESTORE.md carries the hashes + the restore commands.
 */
function createBackup({ appDir, asarPath, markerPath }) {
  const dir = nextBackupDir(backupRootFor(appDir))
  mkdirSync(dir, { recursive: true })
  const backupAsar = join(dir, 'app.asar')
  copyFileSync(asarPath, backupAsar)
  const sourceSha = sha256Hex(readFileSync(asarPath))
  const copiedSha = sha256Hex(readFileSync(backupAsar))
  if (sourceSha !== copiedSha) {
    throw new Error(`backup verification FAILED (${copiedSha} != ${sourceSha}) — refusing to modify the original`)
  }
  let markerBackupPath
  if (existsSync(markerPath)) {
    markerBackupPath = join(dir, 'marker.zctx-patch.json')
    copyFileSync(markerPath, markerBackupPath)
  }
  const entries = [
    `${sourceSha} *${asarPath}`,
    ...(markerBackupPath !== undefined ? [`${sha256Hex(readFileSync(markerPath))} *${markerPath}`] : []),
  ]
  writeFileSync(
    join(dir, 'RESTORE.md'),
    [
      '# RESTORE — zctx-backup (pre-patch snapshot)',
      '',
      `- Created: ${new Date().toISOString()} by zctx-patch ${PATCHER_VERSION}`,
      `- App dir: ${appDir}`,
      `- Backed up: ${asarPath} (SHA-256 below)${markerBackupPath !== undefined ? ' + the existing patch marker' : ''}`,
      '- Restore with the patcher (preferred):',
      `    node patcher/zctx-patch.mjs restore --app-dir "${appDir}" --backup "${dir}"`,
      '- Restore manually (from this directory):',
      `    copy /Y "${backupAsar}" "${asarPath}"`,
      `    (remove the marker when present: del "${markerPath}")`,
      '- Verify after restore: the installed asar SHA-256 must equal the first hash below.',
      '',
      '```',
      ...entries,
      '```',
      '',
    ].join('\n'),
  )
  return { dir, asarSha256: sourceSha, markerBackedUp: markerBackupPath !== undefined }
}

// ---------------------------------------------------------------------------
// patch / restore / status.
// ---------------------------------------------------------------------------

/** Paths of one install. @internal */
function installPaths(appDir) {
  return {
    asarPath: join(appDir, 'resources', 'app.asar'),
    markerPath: join(appDir, '.zctx-patch.json'),
  }
}

/**
 * Marker write (temp + rename, atomic on the same volume). Returns the
 * outcome instead of throwing: a failed marker write must surface as a
 * FAILED step + ok:false — never an uncaught throw past the splice, and
 * never ok:true without the marker in place (the plugin's zctx_status reads
 * this file as the filesystem truth; P4-r1 P4-2).
 * @internal
 */
function writeMarker(markerPath, payload) {
  const tmp = `${markerPath}.tmp-${process.pid}`
  try {
    writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`)
    renameSync(tmp, markerPath)
    return { ok: true }
  } catch (error) {
    rmSync(tmp, { force: true })
    return { ok: false, reason: `marker write failed: ${error instanceof Error ? error.message : String(error)}` }
  }
}

/**
 * PATCH — full gate chain + backup + splice + post-verify + marker.
 * Nothing is touched before every gate passes and the backup verifies.
 *
 * @param options.appDir          resolved app dir (required)
 * @param options.dshHome         the app's dsh home for the lock gate
 *                                (default ~/.dsh)
 * @param options.probeAppRunning injectable process probe (tests)
 * @param options.entry           injectable anchor-set entry (fixture tests);
 *                                default = versions[shellVersion]
 * @param options.versions        injectable anchor-set map (default SUPPORTED)
 */
export async function patchAsar(options) {
  const {
    appDir,
    dshHome = undefined,
    probeAppRunning = probeAppRunningDefault,
    entry = undefined,
    versions = SUPPORTED,
    anchorsDir = defaultAnchorsDir(),
  } = options
  const { asarPath, markerPath } = installPaths(appDir)
  const report = { appDir, asarPath, steps: [] }
  const step = (name, status, detail) => {
    report.steps.push({ name, status, ...(detail !== undefined ? { detail } : {}) })
    return status
  }

  if (!existsSync(asarPath)) {
    throw new Error(`app.asar not found at ${asarPath} — wrong app dir?`)
  }

  // Gate: app not running.
  const gate = appRunningGate({ dshHome, probeAppRunning })
  step('app-running gate', gate.ok ? 'ok' : 'refused', gate.reason ?? gate.detail)
  if (!gate.ok) return { ok: false, refused: true, ...report }

  // Gate: Electron fuse integrity (VERIFY-P #11). A patched asar cannot load
  // under EnableEmbeddedAsarIntegrityValidation=ON, and an UNREADABLE fuse
  // face (sentinel gone, format anomaly) means the runtime face could not be
  // verified — both refuse fail-closed. 'r' (fuse removed) is warn-through:
  // removed = not enforced. A layout WITHOUT the desktop exe (fixtures /
  // non-standard installs) skips the gate honestly — there is no runtime to
  // enforce asar integrity there, and the version + anchor gates still pin
  // the archive.
  const exePath = desktopExePath(appDir)
  const fuse = existsSync(exePath) ? safeReadFuseWire(exePath) : undefined
  if (fuse === undefined) {
    step('fuse integrity gate', 'skip', `desktop exe not found at ${exePath} — no runtime to enforce asar integrity (fixture/non-standard layout); continuing`)
  } else if (!fuse.found) {
    step('fuse integrity gate', 'refused', `fuse wire unreadable (${fuse.reason}) — fail-closed: the runtime integrity face could not be verified`)
    return { ok: false, refused: true, ...report, fuse }
  } else if (fuse.integrity === '1') {
    step('fuse integrity gate', 'refused', `EnableEmbeddedAsarIntegrityValidation=ON (wire ${fuse.rawHex}) — the runtime would reject any modified asar byte; refusing`)
    return { ok: false, refused: true, ...report, fuse }
  } else {
    step(
      'fuse integrity gate',
      fuse.integrity === 'r' ? 'warn' : 'ok',
      fuse.integrity === 'r'
        ? `integrity fuse removed ('r', wire ${fuse.rawHex}) — removed = not enforced; continuing`
        : `EnableEmbeddedAsarIntegrityValidation=OFF (wire ${fuse.rawHex})`,
    )
    report.fuse = fuse
  }

  const asar = await loadAsar()
  // Their module caches Filesystems per archive path — after any in-place
  // mutation of the SAME path the cache would serve a stale header. All
  // pre-state reads below go through the cache-free positional readers; the
  // official extract API is used for the post-verify (after uncacheAll) to
  // prove the patched archive is readable by the official toolchain.
  asar.uncacheAll()

  // Gate: version (asar root package.json). The anchor set resolves from the
  // data dir first (patcher/anchors/<version>.json — D5), then the in-code
  // map; an unknown version still refuses, and a data file that EXISTS but
  // fails validation refuses WITHOUT falling back to the in-code map
  // (fail-closed: a corrupt data set is never papered over).
  let shellVersion
  let supportedEntry
  let anchorSource
  let anchorReason
  try {
    const shell = JSON.parse(extractPositioned(asarPath, SHELL_PACKAGE_PATH).toString('utf8'))
    shellVersion = typeof shell?.version === 'string' ? shell.version : undefined
    if (entry !== undefined) {
      supportedEntry = entry
      anchorSource = 'argument'
    } else {
      const resolved = resolveAnchorEntry(shellVersion, { versions, anchorsDir })
      supportedEntry = resolved.entry
      anchorSource = resolved.source
      anchorReason = resolved.reason
    }
  } catch (error) {
    step('version gate', 'refused', `root package.json unreadable: ${error instanceof Error ? error.message : String(error)}`)
    return { ok: false, refused: true, ...report }
  }
  if (shellVersion === undefined || supportedEntry === undefined) {
    const detail = anchorSource === 'error'
      ? `data anchor set for ${shellVersion} REJECTED — ${anchorReason} (a corrupt data set never falls back to the in-code map)`
      : `shell version ${shellVersion ?? 'unreadable'} is not in the supported set {${Object.keys(versions).join(', ')}}${anchorSource === 'none' ? ' and has no data anchor set — run reanchor against this build first' : ''}`
    step('version gate', 'refused', detail)
    return { ok: false, refused: true, ...report, shellVersion }
  }
  step('version gate', 'ok', `${shellVersion} (anchor set: ${anchorSource})`)

  // Pre-state per file (cache-free positional reads): pristine, patched-exact,
  // or drifted. The whole set must be uniformly pristine (→ patch) or
  // uniformly patched-exact (→ idempotent no-op); anything else refuses —
  // drifted (official update or foreign edit) at the hash gate, and a MIXED
  // face (some pristine + some patched-exact) at the mixed-face gate below.
  // A mixed face cannot arise from THIS patcher (the set applies in ONE asar
  // write), so it means a foreign partial writer has been here — it is
  // reported with the per-file face instead of being guessed through.
  const files = normalizeEntry(supportedEntry)
  const fileTexts = []
  for (const file of files) {
    let text
    try {
      text = extractPositioned(asarPath, file.targetPath).toString('utf8')
    } catch (error) {
      step('target read', 'refused', `${file.targetPath}: ${error instanceof Error ? error.message : String(error)}`)
      return { ok: false, refused: true, ...report, shellVersion }
    }
    const state = fileStateOf(text, file)
    fileTexts.push({ file, text, ...state })
  }
  const drifted = fileTexts.filter((entry) => entry.state === 'drifted')
  if (drifted.length > 0) {
    const detail = drifted
      .map((entry) => `${entry.file.targetPath}: SHA-256 ${entry.sha256} is neither the pinned pristine hash nor a reconstructable patched state (anchor drift)`)
      .join(' | ')
    step('anchor hash gate', 'refused', `${detail} — official update or foreign modification; update the patcher anchor set first`)
    return {
      ok: false,
      refused: true,
      ...report,
      shellVersion,
      targetSha256: drifted[0].sha256,
      files: fileTexts.map(({ file, state, sha256 }) => ({ target: file.targetPath, state, sha256 })),
    }
  }
  const pristineFiles = fileTexts.filter((entry) => entry.state === 'pristine')
  if (pristineFiles.length > 0 && pristineFiles.length < fileTexts.length) {
    // MIXED face (some pristine + some patched-exact — the drifted rows are
    // already refused above): this patcher applies the whole set in ONE asar
    // write, so it can never leave this state — a foreign partial writer has
    // been here. Refuse loudly with the per-file face (which rows are in,
    // which are not) and the two exits (restore → re-patch, or manual
    // reconciliation); never guess through a half-applied set (P6B-R1).
    const patchedCount = fileTexts.length - pristineFiles.length
    const face = fileTexts.map((entry) => `${entry.file.targetPath}: ${entry.state}`).join(' | ')
    step('mixed-face gate', 'refused', `half-applied patch set (${pristineFiles.length} pristine + ${patchedCount} patched-exact) — this patcher writes the whole set in ONE asar operation, so a foreign partial writer has touched the archive: ${face}`)
    return {
      ok: false,
      refused: true,
      ...report,
      shellVersion,
      recovery: `restore the whole set from the latest backup (node patcher/zctx-patch.mjs restore --app-dir "${appDir}") and re-patch, or reconcile the half-applied set manually — this patcher never applies over a mixed face`,
      files: fileTexts.map(({ file, state, sha256 }) => ({ target: file.targetPath, state, sha256 })),
    }
  }
  if (pristineFiles.length < fileTexts.length) {
    // All patched-exact (the only remaining case after the drifted and
    // mixed-face refusals): idempotence branch.
    step('idempotence', 'skip', `patch set ${PATCH_SET_VERSION} already applied (${fileTexts.length}/${fileTexts.length} files patched-exact) — the asar stays untouched`)
    if (existsSync(markerPath)) {
      return { ok: true, alreadyPatched: true, ...report, shellVersion }
    }
    // Crash-window self-heal (P4-r1 P4-2, v0.2 set shape): the patched files
    // are live but the marker is missing. The re-run is the only write path
    // that can reconcile, so backfill the marker from derivable facts; the
    // asar stays untouched. Derivation: each file's pristine content was its
    // pinned hash (the patcher writes only past the anchor-hash gate) and the
    // after-hash is the patched file as it stands now.
    const backfill = writeMarker(markerPath, {
      patcher: 'zctx-patch',
      patcherVersion: PATCHER_VERSION,
      patchSet: PATCH_SET_VERSION,
      shellVersion,
      target: fileTexts[0].file.targetPath,
      sha256Before: fileTexts[0].file.pristineSha256,
      sha256After: fileTexts[0].sha256,
      files: fileTexts.map((entry) => ({
        target: entry.file.targetPath,
        sha256Before: entry.file.pristineSha256,
        sha256After: entry.sha256,
      })),
      // The crashed run's own backup dir is not recoverable from the archive;
      // the latest sibling backup is the best-known pointer (restore defaults
      // to the latest dir when --backup is omitted anyway).
      backup: latestBackupDir(backupRootFor(appDir)) ?? null,
      timestamp: new Date().toISOString(),
    })
    step(
      'marker',
      backfill.ok ? 'backfilled' : 'FAILED',
      backfill.ok
        ? `${markerPath} was missing (crash window between the splice rename and the marker write) — backfilled; the asar stays untouched`
        : backfill.reason,
    )
    if (!backfill.ok) {
      report.recovery = `the patch IS live but the marker could not be written (${markerPath}) — fix the marker path and re-run patch (idempotent, backfills the marker), or restore with: node patcher/zctx-patch.mjs restore --app-dir "${appDir}"`
      return { ok: false, ...report, shellVersion }
    }
    return { ok: true, alreadyPatched: true, markerBackfilled: true, ...report, shellVersion }
  }

  // Gate: anchor hash — every file matched its pinned pristine hash.
  step('anchor hash gate', 'ok', `${fileTexts.length}/${fileTexts.length} files match the pinned pristine hashes`)

  // Pure text patches (op-list application; anchor uniqueness asserts inside).
  const patchedFiles = []
  let addedBytes = 0
  for (const entry of fileTexts) {
    const patched = patchFile(entry.text, entry.file)
    if (!patched.ok) {
      step('anchor patch', 'refused', `${entry.file.targetPath}: ${patched.reason}`)
      return { ok: false, refused: true, ...report, shellVersion }
    }
    addedBytes += patched.byteLength - Buffer.byteLength(entry.text, 'utf8')
    patchedFiles.push({ targetPath: entry.file.targetPath, patchedText: patched.text, before: entry.sha256, after: sha256Hex(Buffer.from(patched.text, 'utf8')) })
  }
  step('anchor patch', 'ok', `${patchedFiles.length} files patched, +${addedBytes} B total`)

  // Backup FIRST (§5): copy + hash-verify before any modification.
  let backup
  try {
    backup = createBackup({ appDir, asarPath, markerPath })
  } catch (error) {
    step('backup', 'refused', error instanceof Error ? error.message : String(error))
    return { ok: false, refused: true, ...report, shellVersion }
  }
  step('backup', 'ok', `${backup.dir} (sha ${backup.asarSha256}${backup.markerBackedUp ? ', marker included' : ''})`)
  report.backup = backup

  // Multi-target surgical splice + atomic write (temp in the same dir →
  // rename): ONE operation for the whole set.
  let spliced
  try {
    spliced = spliceAsarMulti({ asarPath, targets: patchedFiles })
  } catch (error) {
    step('splice', 'refused', error instanceof Error ? error.message : String(error))
    return { ok: false, ...report, shellVersion }
  }
  const tmpAsar = `${asarPath}.zctx-tmp-${process.pid}`
  writeFileSync(tmpAsar, spliced.buffer)
  renameSync(tmpAsar, asarPath)
  step('splice', 'ok', `${spliced.targets.length} targets, payload delta ${spliced.delta} B total, header ${spliced.headerSizeBefore} → ${spliced.headerSizeAfter} B`)

  // Post-verify on the WRITTEN archive: the official extract API (cache
  // dropped first) proves the patched archive is readable by the official
  // toolchain; cache-free positional reads check the untouched witnesses and
  // the size accounting.
  asar.uncacheAll()
  const verify = verifySplicedArchive(asar, asarPath, patchedFiles, spliced)
  step('post-verify', verify.ok ? 'ok' : 'FAILED', verify.detail)
  if (!verify.ok) {
    // The backup exists; surface the restore command honestly. The tool does
    // NOT auto-restore (auto-repairs on the user machine need explicit eyes).
    report.recovery = `restore with: node patcher/zctx-patch.mjs restore --app-dir "${appDir}" --backup "${backup.dir}"`
    return { ok: false, ...report, shellVersion, verify }
  }

  // Marker (the plugin's status dual-source filesystem truth), v0.2 set
  // shape: per-file before/after hashes under `files`, the first file also
  // mirrored to the v0.1 top-level fields for reader compatibility. A failure
  // here leaves the patch live with no marker — the crash window the
  // idempotence branch self-heals on the next patch run — so it surfaces as
  // ok:false + recovery, never ok:true without the marker (P4-r1 P4-2).
  const markerWrite = writeMarker(markerPath, {
    patcher: 'zctx-patch',
    patcherVersion: PATCHER_VERSION,
    patchSet: PATCH_SET_VERSION,
    shellVersion,
    target: spliced.targets[0].targetPath,
    sha256Before: spliced.targets[0].before.sha256,
    sha256After: spliced.targets[0].after.sha256,
    files: spliced.targets.map((target) => ({
      target: target.targetPath,
      sha256Before: target.before.sha256,
      sha256After: target.after.sha256,
    })),
    backup: backup.dir,
    timestamp: new Date().toISOString(),
  })
  step('marker', markerWrite.ok ? 'ok' : 'FAILED', markerWrite.ok ? markerPath : markerWrite.reason)
  if (!markerWrite.ok) {
    report.recovery = `the patch IS applied but the marker write failed (${markerPath}) — re-run patch (idempotent, backfills the marker), or restore with: node patcher/zctx-patch.mjs restore --app-dir "${appDir}" --backup "${backup.dir}"`
    return { ok: false, ...report, shellVersion, before: spliced.targets[0].before, after: spliced.targets[0].after, files: spliced.targets }
  }

  return { ok: true, ...report, shellVersion, before: spliced.targets[0].before, after: spliced.targets[0].after, files: spliced.targets }
}

/**
 * Post-verify the spliced archive on disk (multi-target). @internal
 */
function verifySplicedArchive(asar, asarPath, patchedFiles, spliced) {
  // 1. Every target's content == its expected patched text, read through the
  // OFFICIAL extract API (a header the official toolchain cannot parse would
  // fail right here); each file's presence marker occurs at least once.
  for (const target of patchedFiles) {
    const actualTarget = asar.extractFile(asarPath, nativeAsarPath(target.targetPath)).toString('utf8')
    if (actualTarget !== target.patchedText) {
      return { ok: false, detail: `patched target content mismatch after write: ${target.targetPath}` }
    }
  }
  // 2. Witnesses: bytes at the shifted positions match the pristine hashes.
  // The expected offset uses the collection-time `shift` (the same summed
  // delta rule as the header mutation; `afterTarget` remains the readable
  // boolean for the v0.1 single-target shape where shift == delta or 0 —
  // P4-r1 P4-1: never a layout assumption).
  for (const witness of spliced.witnesses) {
    const newOffset = witness.oldOffset + witness.shift
    const { header, headerSize } = readHeaderPositioned(asarPath)
    const node = headerNodeAt(header, witness.path)
    if (node === undefined || Number(node.offset) !== newOffset) {
      return { ok: false, detail: `witness ${witness.path}: header offset ${String(node?.offset)} != expected ${String(newOffset)}` }
    }
    const fd = openSync(asarPath, 'r')
    try {
      const buf = Buffer.alloc(witness.size)
      readSync(fd, buf, 0, witness.size, 8 + headerSize + newOffset)
      if (sha256Hex(buf) !== witness.integrityHash) {
        return { ok: false, detail: `untouched file ${witness.path} no longer matches its pristine integrity hash` }
      }
    } finally {
      closeSync(fd)
    }
  }
  // 3. Size accounting: archive = 8 + headerSizeAfter + (payloadBefore + delta).
  const archiveSize = statSync(asarPath).size
  const expected = 8 + spliced.headerSizeAfter + spliced.payloadSizeBefore + spliced.delta
  if (archiveSize !== expected) {
    return { ok: false, detail: `archive size ${archiveSize} != accounted ${expected}` }
  }
  return {
    ok: true,
    detail: `${spliced.targets.length} targets patched (+${spliced.delta} B total), witnesses ${spliced.witnesses.length}/${spliced.witnesses.length} byte-identical, archive ${archiveSize} B`,
  }
}

/**
 * RESTORE — copy a backup asar back (hash-verified against the backup's
 * recorded hash), remove the marker. --backup picks a specific backup dir;
 * otherwise the LATEST backup under the sibling root wins.
 */
export async function restoreAsar(options) {
  const { appDir, dshHome = undefined, probeAppRunning = probeAppRunningDefault, backup = undefined } = options
  const { asarPath, markerPath } = installPaths(appDir)
  const report = { appDir, asarPath, steps: [] }
  const step = (name, status, detail) => {
    report.steps.push({ name, status, ...(detail !== undefined ? { detail } : {}) })
    return status
  }

  if (!existsSync(asarPath)) {
    throw new Error(`app.asar not found at ${asarPath} — wrong app dir?`)
  }

  const gate = appRunningGate({ dshHome, probeAppRunning })
  step('app-running gate', gate.ok ? 'ok' : 'refused', gate.reason ?? gate.detail)
  if (!gate.ok) return { ok: false, refused: true, ...report }

  // Backup selection.
  const root = backupRootFor(appDir)
  const dir = backup !== undefined ? resolve(backup) : latestBackupDir(root)
  if (dir === undefined || !existsSync(join(dir, 'app.asar'))) {
    step('backup selection', 'refused', `no backup asar found${backup !== undefined ? ` at ${dir}` : ` under ${root}`}`)
    return { ok: false, refused: true, ...report }
  }
  step('backup selection', 'ok', dir)

  // Backup integrity: the recorded RESTORE.md hash (first hash line) must
  // match the backup bytes — a corrupted backup must not silently restore.
  const backupAsar = join(dir, 'app.asar')
  const recorded = readRestoreHash(dir)
  const actualSha = sha256Hex(readFileSync(backupAsar))
  if (recorded !== undefined && recorded !== actualSha) {
    step('backup integrity', 'refused', `backup asar SHA-256 ${actualSha} != recorded ${recorded} — backup corrupted, not restoring from it`)
    return { ok: false, refused: true, ...report }
  }
  step('backup integrity', 'ok', actualSha)

  // Atomic restore + verification (Z24: restore replaces the current state,
  // then diff-verifies by hash).
  const tmpAsar = `${asarPath}.zctx-tmp-${process.pid}`
  copyFileSync(backupAsar, tmpAsar)
  const tmpSha = sha256Hex(readFileSync(tmpAsar))
  if (tmpSha !== actualSha) {
    rmSync(tmpAsar, { force: true })
    step('restore write', 'FAILED', 'temp copy hash mismatch — aborted before touching the installed asar')
    return { ok: false, ...report }
  }
  renameSync(tmpAsar, asarPath)
  const installedSha = sha256Hex(readFileSync(asarPath))
  if (installedSha !== actualSha) {
    step('restore verify', 'FAILED', `installed asar ${installedSha} != backup ${actualSha}`)
    report.recovery = `re-run restore from ${dir}`
    return { ok: false, ...report }
  }
  step('restore verify', 'ok', `installed asar == backup (${installedSha})`)

  // Marker removal (the patch is gone; the marker must not claim presence).
  if (existsSync(markerPath)) {
    rmSync(markerPath, { force: true })
    step('marker removal', 'ok', markerPath)
  } else {
    step('marker removal', 'skip', 'marker already absent')
  }
  return { ok: true, ...report, backupDir: dir }
}

/** The newest backup dir (lexicographic ts order) under the backup root. @internal */
function latestBackupDir(root) {
  if (!existsSync(root)) return undefined
  const dirs = readdirSync(root).filter((name) => existsSync(join(root, name, 'app.asar'))).sort()
  return dirs.length === 0 ? undefined : join(root, dirs[dirs.length - 1])
}

/** First recorded hash in a backup's RESTORE.md. @internal */
function readRestoreHash(dir) {
  try {
    const text = readFileSync(join(dir, 'RESTORE.md'), 'utf8')
    return /^[0-9a-f]{64} \*/m.exec(text)?.[0]?.slice(0, 64)
  } catch {
    return undefined
  }
}

/**
 * STATUS — strictly read-only. No gates, no writes; reports version, the
 * three-state anchor discrimination (state wording + separate action
 * guidance), patch presence (stub count), marker, backups, and the lock face.
 *
 * anchorHit states (P4-r1 P4-3; mapping from the old two labels):
 *   'official-unchanged' — stub absent, hash == pinned pristine
 *                          (was 'match (pristine)')
 *   'official-drifted'   — stub absent, hash != pinned pristine: official
 *                          update moved the file (was 'mismatch (drift)' —
 *                          correct semantics there, renamed for coherence)
 *   'patched-exact'      — stub present, file byte-identical to
 *                          patchText(pristine).text (the old label here was
 *                          'mismatch (drift)' — the P4-3 bug: the EXPECTED
 *                          post-patch state read as an error)
 *   'patched-drifted'    — stub present but the file no longer matches the
 *                          expected patched content (patched, then modified)
 */
export async function statusAsar(options) {
  const {
    appDir,
    dshHome = undefined,
    probeAppRunning = probeAppRunningDefault,
    versions = SUPPORTED,
    entry = undefined,
    anchorsDir = defaultAnchorsDir(),
  } = options
  const { asarPath, markerPath } = installPaths(appDir)
  const report = { appDir, asarPath, asarExists: existsSync(asarPath) }
  if (!report.asarExists) {
    return { ...report, note: 'app.asar not found — nothing to report' }
  }
  try {
    report.shellVersion = JSON.parse(extractPositioned(asarPath, SHELL_PACKAGE_PATH).toString('utf8'))?.version
  } catch (error) {
    report.shellVersion = `unreadable (${error instanceof Error ? error.message : String(error)})`
  }
  // The anchor set face (D5): which source resolved this version's entry,
  // plus the machine-readable inventory of available anchor sets (in-code
  // map versions + the data dir's <version>.json files).
  const resolved = entry !== undefined
    ? { entry, source: 'argument' }
    : resolveAnchorEntry(report.shellVersion, { versions, anchorsDir })
  report.anchorSetSource = resolved.source
  report.availableAnchorSets = {
    dir: anchorsDir,
    inCode: Object.keys(versions),
    dataDir: listAnchorSetVersions(anchorsDir),
  }
  const supportedEntry = resolved.entry
  if (supportedEntry === undefined) {
    report.anchorHit = 'unknown'
    report.patched = 'unknown'
    report.note = resolved.source === 'error'
      ? `data anchor set rejected — ${resolved.reason}`
      : `shell version ${String(report.shellVersion)} has no anchor entry — presence checks need the matching anchor set`
  } else {
    const files = normalizeEntry(supportedEntry)
    report.files = []
    try {
      for (const file of files) {
        const target = extractPositioned(asarPath, file.targetPath)
        const text = target.toString('utf8')
        const sha = sha256Hex(target)
        const state = fileStateOf(text, file)
        // State wording (P4-r1 P4-3 carried to the multi-file face): the
        // label names the STATE only; action guidance lives in `guidance`.
        const anchorHit = state.state === 'pristine'
          ? 'official-unchanged'
          : state.state === 'patched-exact'
            ? 'patched-exact'
            : countOccurrences(text, file.presenceMarker) > 0
              ? 'patched-drifted'
              : 'official-drifted'
        report.files.push({
          target: file.targetPath,
          sha256: sha,
          state: state.state,
          anchorHit,
          ...(anchorHit === 'patched-drifted'
            ? { guidance: 'the patched target no longer matches the expected patched content — restore from a backup, then re-patch' }
            : {}),
          ...(anchorHit === 'official-drifted'
            ? { guidance: 'official update changed the target beyond the pinned anchor set — refresh the patcher anchor set first, then patch' }
            : {}),
        })
      }
      // Top-level fields mirror the FIRST file (the v0.1 single-target face;
      // the v0.2 aggregate lives in `patchSet`/`files`).
      report.targetSha256 = report.files[0].sha256
      report.anchorHit = report.files[0].anchorHit
      if (report.anchorHit === 'patched-drifted' || report.anchorHit === 'official-drifted') {
        report.guidance = report.files[0].guidance
      }
      // Presence semantics (carried from v0.1): `patched` says the patch face
      // is present in the bytes — exact OR drifted-with-marker — not that
      // every file is patched; the aggregate precision lives in
      // `patchSet.state`.
      report.patched = report.files.some((file) => file.anchorHit === 'patched-exact' || file.anchorHit === 'patched-drifted')
      // The patch-set aggregate (P6-B status segment; P6B-R2 re-ordering so
      // every arm is reachable). Priority, explicitly: ALL files patched-exact
      // → 'patched'; any patched face mixed with non-patched rows (pristine
      // or drifted — the official-update re-patch signal) → 'partial'; ALL
      // files official-unchanged → 'unpatched'; anything else is a face with
      // NO patch presence at all → 'drifted' (drift never masks patch
      // presence, and patch presence never masks drift rows — the per-file
      // face and `driftedFiles` carry that detail).
      const allPatchedExact = report.files.every((file) => file.anchorHit === 'patched-exact')
      report.patchSet = {
        version: PATCH_SET_VERSION,
        totalFiles: report.files.length,
        patchedFiles: report.files.filter((file) => file.anchorHit === 'patched-exact').length,
        pristineFiles: report.files.filter((file) => file.anchorHit === 'official-unchanged').length,
        driftedFiles: report.files.filter((file) => file.anchorHit === 'patched-drifted' || file.anchorHit === 'official-drifted').length,
        state: allPatchedExact
          ? 'patched'
          : report.patched
            ? 'partial'
            : report.files.every((file) => file.anchorHit === 'official-unchanged')
              ? 'unpatched'
              : 'drifted',
      }
    } catch (error) {
      report.anchorHit = 'unknown'
      report.patched = 'unknown'
      report.note = `target read failed: ${error instanceof Error ? error.message : String(error)}`
    }
  }
  report.marker = readMarkerFile(markerPath)
  const root = backupRootFor(appDir)
  report.backups = existsSync(root)
    ? readdirSync(root)
      .filter((name) => existsSync(join(root, name, 'app.asar')))
      .sort()
      .map((name) => ({ dir: join(root, name) }))
    : []
  const lockPath = desktopLockPath(dshHome)
  report.lock = { path: lockPath, exists: existsSync(lockPath) }
  report.appRunning = probeAppRunning()
  // The Electron fuse face (VERIFY-P #11): strictly read-only, never throws;
  // a missing/unreadable exe reports found:false + reason (fail-closed
  // consumers refuse on it; the face itself is reported honestly either way).
  report.fuse = safeReadFuseWire(desktopExePath(appDir))
  return report
}

/** Read the patch marker (the plugin reads the same file the same way). @internal */
function readMarkerFile(markerPath) {
  if (!existsSync(markerPath)) return { state: 'absent', path: markerPath }
  try {
    const parsed = JSON.parse(readFileSync(markerPath, 'utf8'))
    return {
      state: 'present',
      path: markerPath,
      version: typeof parsed.shellVersion === 'string' ? parsed.shellVersion : undefined,
      target: typeof parsed.target === 'string' ? parsed.target : undefined,
      patchSet: typeof parsed.patchSet === 'string' ? parsed.patchSet : undefined,
      patcherVersion: typeof parsed.patcherVersion === 'string' ? parsed.patcherVersion : undefined,
      files: Array.isArray(parsed.files)
        ? parsed.files.map((file) => ({
          target: typeof file?.target === 'string' ? file.target : undefined,
          sha256After: typeof file?.sha256After === 'string' ? file.sha256After : undefined,
        }))
        : undefined,
      timestamp: typeof parsed.timestamp === 'string' ? parsed.timestamp : undefined,
    }
  } catch (error) {
    return { state: 'unknown', path: markerPath, reason: error instanceof Error ? error.message : String(error) }
  }
}

// ---------------------------------------------------------------------------
// reanchor — fast adaptation to a NEW official build (D6).
//
// Reads a build's five target files (READ-ONLY, through the same cache-free
// positional extraction the gates use), classifies every op anchor of the
// patch set of record against the new bytes, and — only when every anchor is
// ALIVE (count==1 exactly as the patcher requires) — emits a candidate data
// anchor set with the anchors inherited VERBATIM and pristineSha256 updated
// to the new build's bytes. Nothing is guessed: a DRIFTED anchor (count≠1)
// kills the candidate and produces analysis materials instead; a patched
// input (presence marker in the bytes) refuses outright; --accept is the
// only path into patcher/anchors/, gated by the same validator the loader
// enforces. The runtime safety boundary stays intact regardless: the hash
// gate re-verifies every pristineSha256 and patchFile re-asserts count==1
// on the real bytes before anything is written.
// ---------------------------------------------------------------------------

/**
 * Human-analysis material for one dead anchor: locate a trace of it in the
 * new bytes (the anchor itself → its first line → a 60-char prefix) and
 * extract the surrounding lines. A locator never rewrites anything — it is
 * a reading aid, and 'none' is an honest answer when the anchor is fully
 * gone.
 */
function anchorTraceMaterial(text, anchor) {
  const lines = text.split('\n')
  const probes = [
    { by: 'anchor', needle: anchor },
    { by: 'first-line', needle: anchor.split('\n')[0].trim() },
    { by: 'prefix-60', needle: anchor.slice(0, 60) },
  ]
  for (const probe of probes) {
    if (probe.needle === '') continue
    const at = text.indexOf(probe.needle)
    if (at !== -1) {
      const lineNo = text.slice(0, at).split('\n').length
      return {
        locatedBy: probe.by,
        line: lineNo,
        context: lines.slice(Math.max(0, lineNo - 1 - 5), lineNo - 1 + 5 + 1).join('\n'),
      }
    }
  }
  return { locatedBy: 'none', note: 'no trace of the anchor (nor its first line, nor its 60-char prefix) — the anchor is fully gone from the new build' }
}

/**
 * REANCHOR — build a candidate data anchor set for a NEW official build.
 * Read-only against the install; the only writes are the candidate JSON
 * (--out) and, under --accept, `patcher/anchors/<version>.json` (atomic
 * tmp+rename, never over an existing file).
 *
 * @param options.appDir    the NEW build's app dir (read-only)
 * @param options.anchorsDir where --accept writes (default patcher/anchors/)
 * @param options.out      also write the candidate JSON here (inspection copy)
 * @param options.accept   write patcher/anchors/<version>.json (default false)
 * @param options.versions injectable anchor-set map (default SUPPORTED)
 */
export function reanchorAnchorSet(options) {
  const {
    appDir,
    anchorsDir = defaultAnchorsDir(),
    out = undefined,
    accept = false,
    versions = SUPPORTED,
  } = options
  const report = { appDir, steps: [] }
  const step = (name, status, detail) => {
    report.steps.push({ name, status, ...(detail !== undefined ? { detail } : {}) })
    return status
  }
  const asarPath = join(appDir, 'resources', 'app.asar')
  if (!existsSync(asarPath)) {
    step('asar', 'refused', `app.asar not found at ${asarPath} — wrong app dir?`)
    return { ok: false, refused: true, ...report }
  }

  // 1. The new build's version → the data file's identity.
  let newVersion
  try {
    newVersion = JSON.parse(extractPositioned(asarPath, SHELL_PACKAGE_PATH).toString('utf8'))?.version
  } catch (error) {
    step('version read', 'refused', `root package.json unreadable: ${error instanceof Error ? error.message : String(error)}`)
    return { ok: false, refused: true, ...report }
  }
  if (typeof newVersion !== 'string' || newVersion === '') {
    step('version read', 'refused', 'root package.json has no usable version string')
    return { ok: false, refused: true, ...report }
  }
  step('version read', 'ok', newVersion)

  // 2. Never clobber: an existing data set for this version is a verified
  //    asset — deleting it is a human decision, not a tool side effect.
  const dataPath = join(anchorsDir, `${newVersion}.json`)
  if (existsSync(dataPath)) {
    step('existing data set', 'refused', `${dataPath} already exists — delete it explicitly first if it is really stale; reanchor never overwrites`)
    return { ok: false, refused: true, ...report, newVersion }
  }

  // 3. The patch set of record provides the probe surface: the five target
  //    paths, each op's anchor (expected count 1) and presence marker.
  const probeEntry = versions['0.2.2-rc.3'] ?? Object.values(versions)[0]
  if (probeEntry === undefined) {
    step('probe surface', 'refused', 'the anchor-set map has no entry to reanchor from')
    return { ok: false, refused: true, ...report, newVersion }
  }
  const probeFiles = normalizeEntry(probeEntry)
  step('probe surface', 'ok', `${probeFiles.length} targets from the patch set of record (${PATCH_SET_VERSION})`)

  // 4. Read-only extraction + classification, target by target.
  const classifications = []
  for (const file of probeFiles) {
    let text
    try {
      text = extractPositioned(asarPath, file.targetPath).toString('utf8')
    } catch (error) {
      step('target read', 'refused', `${file.targetPath}: ${error instanceof Error ? error.message : String(error)} — structural change (target moved/renamed/unpacked); reanchor cannot proceed, needs a human`)
      return { ok: false, refused: true, ...report, newVersion }
    }
    const newSha = sha256Hex(Buffer.from(text, 'utf8'))
    const markerCount = countOccurrences(text, file.presenceMarker)
    if (markerCount > 0) {
      step('patched input', 'refused', `${file.targetPath}: presence marker occurs ${markerCount} time(s) — this build is ALREADY PATCHED; reanchor classifies the PRISTINE face only (restore first or use an unpatched build)`)
      return { ok: false, refused: true, ...report, newVersion }
    }
    const opFaces = file.ops.map((op) => ({ anchor: op.anchor, expected: 1, actual: countOccurrences(text, op.anchor) }))
    classifications.push({ file, text, newSha, opFaces, alive: opFaces.every((op) => op.actual === op.expected) })
  }

  // 5. Report the classification; a single DRIFTED target kills the
  //    candidate (never guessing anchors) and yields analysis materials.
  const drifted = classifications.filter((candidate) => !candidate.alive)
  report.classification = classifications.map((candidate) => ({
    target: candidate.file.targetPath,
    oldPristineSha256: candidate.file.pristineSha256,
    newSha256: candidate.newSha,
    class: candidate.alive ? 'ALIVE' : 'DRIFTED',
    ops: candidate.opFaces,
  }))
  if (drifted.length > 0) {
    step('anchor classification', 'refused', `${drifted.length}/${classifications.length} target(s) DRIFTED — candidate set NOT produced (never guessing anchors)`)
    report.driftedMaterials = drifted.map((candidate) => ({
      target: candidate.file.targetPath,
      newSha256: candidate.newSha,
      oldPristineSha256: candidate.file.pristineSha256,
      ops: candidate.opFaces.map((op) => ({
        ...op,
        ...(op.actual === 0 ? anchorTraceMaterial(candidate.text, op.anchor) : {}),
      })),
    }))
    report.recovery = 'adapt the dead anchors BY HAND against the new build (materials above: new/old SHA-256, expected-vs-actual counts, trace context), then re-run reanchor on the adapted probe entry'
    return { ok: false, refused: true, ...report, newVersion }
  }
  step('anchor classification', 'ok', `5/5 targets ALIVE — anchors inherited verbatim, pristineSha256 updated to the new build's bytes`)

  // 6. The candidate data anchor set (same shape as the in-code entry + the
  //    metadata fields), validated by the SAME validator the loader uses.
  const candidate = {
    anchorSetVersion: PATCH_SET_VERSION,
    generatedAt: new Date().toISOString(),
    sourceReport: `reanchor: anchors of ${PATCH_SET_VERSION} (built on 0.2.2-rc.3) re-validated against build ${newVersion} at ${appDir}; 5/5 anchors ALIVE (count==1), pristineSha256 updated to the new bytes; read-only extraction`,
    shellPackage: probeEntry.shellPackage,
    files: classifications.map((entry) => ({
      targetPath: entry.file.targetPath,
      pristineSha256: entry.newSha,
      presenceMarker: entry.file.presenceMarker,
      ops: entry.file.ops,
    })),
  }
  const check = validateAnchorSetData(candidate, probeFiles.map((file) => file.targetPath))
  if (!check.ok) {
    step('candidate validation', 'FAILED', check.reason)
    return { ok: false, ...report, newVersion }
  }
  step('candidate validation', 'ok', 'schema + metadata + targets + hashes valid (the same validator the loader enforces)')
  const candidateJson = `${JSON.stringify(candidate, null, 2)}\n`
  report.candidate = candidate

  // 7. Outputs: --out is an inspection copy anywhere; --accept is the ONLY
  //    path into patcher/anchors/ (atomic tmp+rename; existence was refused
  //    above, so this never overwrites).
  if (out !== undefined) {
    writeFileSync(out, candidateJson)
    step('candidate written', 'ok', out)
  }
  if (!accept) {
    step('accept gate', 'skip', '--accept not given — patcher/anchors/ NOT written; inspect the candidate, then re-run with --accept')
    return { ok: true, accepted: false, newVersion, candidateJson, steps: report.steps, classification: report.classification }
  }
  mkdirSync(anchorsDir, { recursive: true })
  const tmpPath = `${dataPath}.tmp-${process.pid}`
  writeFileSync(tmpPath, candidateJson)
  renameSync(tmpPath, dataPath)
  const writtenSha = sha256Hex(readFileSync(dataPath))
  step('anchor set written', 'ok', `${dataPath} (sha256 ${writtenSha})`)
  return { ok: true, accepted: true, newVersion, candidateJson, writtenTo: dataPath, writtenSha256: writtenSha, steps: report.steps, classification: report.classification }
}

// ---------------------------------------------------------------------------
// auto — the hourly self-heal state machine (plan ZCTX-PATCH-AUTO §4).
// ---------------------------------------------------------------------------

/**
 * The default auto log file: `%LOCALAPPDATA%\zctx-patch\auto.log` (Z28: on a
 * headless scheduled run the FILE sink is the only reliable audit face).
 */
export function defaultAutoLogPath() {
  const base = process.env.LOCALAPPDATA !== undefined && process.env.LOCALAPPDATA !== ''
    ? process.env.LOCALAPPDATA
    : join(homedir(), 'AppData', 'Local')
  return join(base, 'zctx-patch', 'auto.log')
}

/** One contract line: `[ISO8601] [auto] state=<X> detail=<...>`. */
export function autoLogLine(state, detail) {
  return `[${new Date().toISOString()}] [auto] state=${state} detail=${detail}`
}

/**
 * The auto log sink: every line goes to the console AND the file (append;
 * the directory is created as needed). A file-sink failure NEVER blocks the
 * judgment (the console face stays authoritative for interactive runs) but
 * is surfaced loudly on the console AND rides the result (`sinkError`) — on
 * a headless run a silent sink loss would break the only audit trail (Z28).
 */
export function makeAutoSink(logFile) {
  const lines = []
  let sinkError
  const write = (line) => {
    console.log(line)
    lines.push(line)
    try {
      mkdirSync(dirname(logFile), { recursive: true })
      appendFileSync(logFile, `${line}\n`, 'utf8')
    } catch (error) {
      if (sinkError === undefined) {
        sinkError = `auto log file sink failed (${logFile}): ${error instanceof Error ? error.message : String(error)} — judgments continue on console; fix the path (headless runs need this file)`
      }
      console.error(`[auto] ${sinkError}`)
    }
  }
  return { lines, write, error: () => sinkError }
}

/**
 * ONE tick of the auto state machine (plan §4 contract; exit codes:
 * 0 = nothing to do / already healthy / polite skip, 1 = needs a human).
 * Read-then-judge-then-act, never act-then-see:
 *
 *   state         → exit  behavior
 *   missing-asar  → 1     install gone/moved; human
 *   app-running   → 0     probe=yes or the app's lock exists; retry next tick
 *   fuse-on       → 1     integrity fuse ON — patching is impossible; human
 *   fuse-missing  → 1     exe/sentinel/format unreadable — fail-closed; human
 *   fuse-removed  → WARN  integrity='r' = not enforced; continue
 *   refused       → 1     version/anchor gate refusal (unsupported shell or
 *                         the patch flow refused at one of its own gates)
 *   drifted       → 1     per-file loud face; NEVER blind-patching
 *   mixed         → 1     half-applied face (foreign partial writer); human
 *   would-patch   → 0     repairable face seen but no --yes (inspection tick)
 *   already-ok    → 0     patched N/N + marker present
 *   patching/     → (log) one repair action per tick via the UNCHANGED gated
 *   patch-step            patchAsar flow (its backup is hash-verified on
 *                         disk BEFORE any modification — Z32)
 *   patched       → 0     patched under --yes AND the FULL status re-check
 *                         passes (patched N/N + marker — Z29, never a
 *                         single-point check)
 *   verify-failed → 1     post-patch re-check or backup-on-disk failed; human
 *
 * `--yes` is the user's standing approval for exactly ONE repair action per
 * tick; every gate of the underlying patch flow still runs and still refuses.
 *
 * @param options.statusFn statusAsar (or a wrapper adding an entry/versions)
 * @param options.patchFn  patchAsar  (or a wrapper adding an entry/versions)
 * @param options.logFile  the file sink path (default {@link defaultAutoLogPath})
 */
export async function runAuto(options) {
  const {
    appDir,
    dshHome = undefined,
    yes = false,
    probeAppRunning = probeAppRunningDefault,
    statusFn = statusAsar,
    patchFn = patchAsar,
    logFile = defaultAutoLogPath(),
  } = options
  const sink = makeAutoSink(logFile)
  const log = (state, detail) => sink.write(autoLogLine(state, detail))
  const finish = (state, detail, exitCode) => {
    log(state, detail)
    return {
      ok: exitCode === 0,
      state,
      exitCode,
      detail,
      lines: sink.lines,
      logFile,
      ...(sink.error() !== undefined ? { sinkError: sink.error() } : {}),
    }
  }
  const face = (status) => (status.files ?? []).map((file) => `${file.target}: ${file.state}/${file.anchorHit}`).join(' | ')

  try {
    // 1. The full read-only status: one authoritative read (version, files,
    //    marker, lock, process, fuse).
    const status = await statusFn({ appDir, dshHome, probeAppRunning })
    if (!status.asarExists) {
      return finish('missing-asar', `app.asar not found at ${status.asarPath} — install moved or removed; needs a human`, 1)
    }
    if (status.appRunning === 'yes' || status.lock?.exists === true) {
      return finish('app-running', `app-running, retry next tick (probe=${status.appRunning} lock=${status.lock?.exists === true ? 'present' : 'absent'})`, 0)
    }

    // 2. The fuse face (VERIFY-P #11 index 4 = EnableEmbeddedAsarIntegrityValidation).
    const fuse = status.fuse
    if (fuse === undefined || !fuse.found) {
      return finish('fuse-missing', `fuse wire unreadable (${fuse?.reason ?? 'no fuse face reported'}) — the runtime integrity face could not be verified; fail-closed, needs a human`, 1)
    }
    if (fuse.integrity === '1') {
      return finish('fuse-on', `EnableEmbeddedAsarIntegrityValidation=ON (wire ${fuse.rawHex}) — the runtime rejects any modified asar byte; needs a human`, 1)
    }
    if (fuse.integrity === 'r') {
      log('fuse-removed', `integrity fuse removed ('r', wire ${fuse.rawHex}) — removed = not enforced; continuing`)
    }

    // 3. The version/anchor face (any gate refusal is loud, exit 1).
    if (status.anchorHit === 'unknown' || status.patchSet === undefined) {
      return finish('refused', `shell version ${String(status.shellVersion)} is not in the supported anchor set — the version gate refuses; update the patcher anchor set first, needs a human`, 1)
    }
    const patchSet = status.patchSet
    if (patchSet.state === 'drifted') {
      return finish('drifted', `official update or foreign edit — per-file face: ${face(status)}; NEVER blind-patching, needs a human`, 1)
    }
    if (patchSet.state === 'partial') {
      return finish('mixed', `half-applied patch set — per-file face: ${face(status)}; restore then re-patch, needs a human`, 1)
    }
    if (patchSet.state === 'patched' && status.marker?.state === 'present') {
      return finish('already-ok', `patched ${patchSet.patchedFiles}/${patchSet.totalFiles} + marker present — nothing to do`, 0)
    }

    // 4. Nothing to execute without --yes (the inspection tick still logged).
    if (!yes) {
      return finish('would-patch', patchSet.state === 'patched'
        ? `patched ${patchSet.patchedFiles}/${patchSet.totalFiles} but the marker is missing (crash window) — an idempotent patch run would backfill it; pass --yes to execute`
        : `all-pristine + anchors hit (${patchSet.pristineFiles}/${patchSet.totalFiles}) — would patch; pass --yes to execute`, 0)
    }

    // 5. One repair action per tick, through the UNCHANGED gated patch flow
    //    (its backup is on disk + hash-verified before it touches anything).
    log('patching', `executing the gated patch flow (yes=true, patchSet=${patchSet.state}, marker=${String(status.marker?.state)})`)
    const patch = await patchFn({ appDir, dshHome, probeAppRunning })
    for (const { name, status: stepStatus, detail } of patch.steps) {
      log('patch-step', `${name}: ${stepStatus}${detail !== undefined ? ` — ${detail}` : ''}`)
    }
    if (!patch.ok) {
      return finish('refused', `patch refused/failed at its own gates — recovery: ${patch.recovery ?? 'see the patch-step lines above'}`, 1)
    }

    // 6. Z29: never trust a single point — FULL status re-read; the aggregate
    //    must be patched N/N with the marker present, and the Z32 backup must
    //    be on disk.
    if (patch.backup?.dir !== undefined && !existsSync(patch.backup.dir)) {
      return finish('verify-failed', `backup dir ${patch.backup.dir} is not on disk after the patch — Z32 violated; restore and investigate, needs a human`, 1)
    }
    const recheck = await statusFn({ appDir, dshHome, probeAppRunning })
    const after = recheck.patchSet
    const verified = after?.state === 'patched' && after.patchedFiles === after.totalFiles && recheck.marker?.state === 'present'
    if (!verified) {
      return finish('verify-failed', `post-patch FULL status re-check FAILED (patchSet=${String(after?.state)} ${String(after?.patchedFiles)}/${String(after?.totalFiles)} marker=${String(recheck.marker?.state)}) — restore with: node patcher/zctx-patch.mjs restore --app-dir "${appDir}"; needs a human`, 1)
    }
    return finish('patched', `patch applied and FULL status re-verified: ${after.patchedFiles}/${after.totalFiles} patched-exact + marker present; backup ${patch.backup?.dir ?? 'n/a'}`, 0)
  } catch (error) {
    return finish('error', `auto tick threw: ${error instanceof Error ? error.message : String(error)} — fail-closed, needs a human`, 1)
  }
}

// ---------------------------------------------------------------------------
// install-task / uninstall-task — the Windows hourly scheduled task.
// ---------------------------------------------------------------------------

/** The scheduled-task name (plan §4 contract; the real machine registers it in B5). */
export const TASK_NAME = 'ZCTX-Patch-Auto'

/**
 * The absolute path of THIS script — the scheduled task must run the
 * MAIN-TREE copy (a worktree path is not a long-lived location). Z20:
 * fileURLToPath, never raw URL pathname surgery.
 */
export function thisScriptPath() {
  return fileURLToPath(import.meta.url)
}

/**
 * The scheduled-task action string:
 *
 *   cmd /c ""<node>" "<script>" auto --yes >> "<log>" 2>&1"
 *
 * EVERY path is double-quoted (the install dir "DeepSeek Harness", the user
 * profile, and repo paths routinely contain spaces), and the WHOLE command
 * carries one extra OUTER quote pair. Why: cmd.exe's /C rule 2 (cmd /?) —
 * when the command after /C starts with a quote and does not meet the
 * two-quote preservation conditions (ours has many quotes plus `& < >`), cmd
 * strips the FIRST and LAST quote of the line. With the outer pair present,
 * that stripping consumes the wrapper pair and the inner command survives
 * fully quoted: `"node" "script" auto --yes >> "log" 2>&1`. Without it, the
 * first and last PATH quotes would be eaten and a spaced path breaks the
 * action. The `>>`/`2>&1` redirect rides cmd, landing stdout+stderr in the
 * same file sink the patcher writes (Z28: belt-and-suspenders — a crash
 * before the sink starts still leaves the console face in the file).
 */
export function buildTaskAction({ nodePath = process.execPath, scriptPath, logPath }) {
  return `cmd /c ""${nodePath}" "${scriptPath}" auto --yes >> "${logPath}" 2>&1"`
}

/** The default schtasks runner (no shell — node quotes each arg per CRT rules). */
function runSchtasksDefault(args) {
  return spawnSync('schtasks', args, { encoding: 'utf8' })
}

function taskStep(steps, name, status, detail) {
  steps.push({ name, status, ...(detail !== undefined ? { detail } : {}) })
  return status
}

/**
 * INSTALL the hourly self-heal task (idempotent): an existing task is
 * /Delete /F'd first, then created, then re-queried as the visibility proof.
 * Every schtasks invocation and its outcome is recorded in `steps` (and
 * printed by the CLI) — registration leaves a full audit trail.
 *
 * @param options.nodePath  the node executable (default process.execPath)
 * @param options.scriptPath the patcher script (default {@link thisScriptPath};
 *                            the real machine passes the MAIN-TREE path)
 * @param options.logFile   the auto log sink (default {@link defaultAutoLogPath})
 * @param options.taskName  default {@link TASK_NAME}
 * @param options.platform  injectable for tests (default process.platform)
 * @param options.run       injectable schtasks runner (tests)
 */
export function installScheduledTask(options = {}) {
  const {
    nodePath = process.execPath,
    scriptPath = thisScriptPath(),
    logFile = defaultAutoLogPath(),
    taskName = TASK_NAME,
    platform = process.platform,
    run = runSchtasksDefault,
  } = options
  const steps = []
  if (platform !== 'win32') {
    taskStep(steps, 'platform gate', 'refused', `schtasks is Windows-only; this host is ${platform} — the task was NOT created`)
    return { ok: false, refused: true, taskName, steps }
  }
  const tr = buildTaskAction({ nodePath, scriptPath, logPath: logFile })
  taskStep(steps, 'action build', 'ok', tr)
  // Idempotence: an existing task is deleted FIRST (explicit delete-then-
  // create), so a stale action (e.g. from a moved repo) never survives.
  const existing = run(['/Query', '/TN', taskName])
  if (existing.status === 0) {
    const removed = run(['/Delete', '/TN', taskName, '/F'])
    taskStep(steps, 'delete existing', removed.status === 0 ? 'ok' : 'FAILED', `schtasks /Delete /TN ${taskName} /F → exit ${removed.status}${removed.status !== 0 ? ` (${String(removed.stderr ?? '').trim()})` : ''}`)
    if (removed.status !== 0) {
      return { ok: false, taskName, steps, recovery: `delete the stale task manually (schtasks /Delete /TN ${taskName} /F) and re-run install-task` }
    }
  } else {
    taskStep(steps, 'delete existing', 'skip', `schtasks /Query /TN ${taskName} → exit ${existing.status} (not present)`)
  }
  const created = run(['/Create', '/TN', taskName, '/SC', 'HOURLY', '/TR', tr, '/F'])
  taskStep(steps, 'create', created.status === 0 ? 'ok' : 'FAILED', `schtasks /Create /TN ${taskName} /SC HOURLY /TR <action> /F → exit ${created.status}${created.status !== 0 ? ` (${[created.stderr, created.stdout].map((text) => String(text ?? '').trim()).filter(Boolean).join(' ')})` : ''}`)
  if (created.status !== 0) {
    return { ok: false, taskName, steps, recovery: 'inspect the printed schtasks output — a common cause is a path with a quote; re-run with --script/--log-file' }
  }
  const verify = run(['/Query', '/TN', taskName])
  taskStep(steps, 'verify visible', verify.status === 0 ? 'ok' : 'FAILED', `schtasks /Query /TN ${taskName} → exit ${verify.status}`)
  if (verify.status !== 0) {
    return { ok: false, taskName, steps, recovery: `the task was created but does not query back — check schtasks manually (/Query /TN ${taskName})` }
  }
  return { ok: true, taskName, action: tr, steps }
}

/**
 * UNINSTALL the task: delete + PROOF of invisibility (the follow-up /Query
 * must fail). Idempotent — an absent task is a no-op success.
 */
export function uninstallScheduledTask(options = {}) {
  const { taskName = TASK_NAME, platform = process.platform, run = runSchtasksDefault } = options
  const steps = []
  if (platform !== 'win32') {
    taskStep(steps, 'platform gate', 'refused', `schtasks is Windows-only; this host is ${platform} — nothing to uninstall here`)
    return { ok: false, refused: true, taskName, steps }
  }
  const existing = run(['/Query', '/TN', taskName])
  taskStep(steps, 'query', existing.status === 0 ? 'ok' : 'skip', `schtasks /Query /TN ${taskName} → exit ${existing.status}${existing.status === 0 ? ' (task present)' : ' (already absent)'}`)
  if (existing.status !== 0) {
    return { ok: true, taskName, steps }
  }
  const removed = run(['/Delete', '/TN', taskName, '/F'])
  taskStep(steps, 'delete', removed.status === 0 ? 'ok' : 'FAILED', `schtasks /Delete /TN ${taskName} /F → exit ${removed.status}`)
  if (removed.status !== 0) {
    return { ok: false, taskName, steps, recovery: `delete manually: schtasks /Delete /TN ${taskName} /F` }
  }
  const verify = run(['/Query', '/TN', taskName])
  taskStep(steps, 'verify invisible', verify.status !== 0 ? 'ok' : 'FAILED', `schtasks /Query /TN ${taskName} → exit ${verify.status} (non-zero = gone)`)
  if (verify.status === 0) {
    return { ok: false, taskName, steps, recovery: `the task still queries after delete — inspect schtasks manually (/Query /TN ${taskName})` }
  }
  return { ok: true, taskName, steps }
}

// ---------------------------------------------------------------------------
// CLI.
// ---------------------------------------------------------------------------

const VALUE_OPTIONS = new Set(['--app-dir', '--dsh-home', '--backup', '--script', '--log-file', '--out'])
const FLAG_OPTIONS = new Set(['--yes', '--accept'])

function parseArgs(argv) {
  const args = { _: [] }
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (VALUE_OPTIONS.has(token)) {
      const value = argv[i + 1]
      if (value === undefined) throw new Error(`${token} requires a value`)
      args[token.slice(2).replaceAll('-', '_')] = value
      i += 1
    } else if (FLAG_OPTIONS.has(token)) {
      args[token.slice(2).replaceAll('-', '_')] = true
    } else if (token.startsWith('--')) {
      throw new Error(`unknown option ${token}`)
    } else {
      args._.push(token)
    }
  }
  return args
}

function printSteps(prefix, steps) {
  for (const { name, status, detail } of steps) {
    console.log(`${prefix} ${name}: ${status}${detail !== undefined ? ` — ${detail}` : ''}`)
  }
}

const COMMANDS = ['patch', 'restore', 'status', 'auto', 'install-task', 'uninstall-task', 'reanchor']

async function main(argv) {
  const args = parseArgs(argv)
  const command = args._[0]
  if (!COMMANDS.includes(command)) {
    console.error('usage: node patcher/zctx-patch.mjs <patch|restore|status|auto|install-task|uninstall-task|reanchor> [--app-dir <dir>] [--dsh-home <dir>] [--backup <dir>] [--yes] [--script <path>] [--log-file <path>] [--out <path>] [--accept]')
    return 2
  }
  // Scheduled-task registration does not need the app dir: it registers THIS
  // script (or --script) against the resolved node + log paths.
  if (command === 'install-task' || command === 'uninstall-task') {
    const result = command === 'install-task'
      ? installScheduledTask({ scriptPath: args.script, logFile: args.log_file })
      : uninstallScheduledTask({})
    printSteps('[task]', result.steps)
    if (!result.ok) {
      console.error(`[refuse] ${command} did not complete${result.recovery !== undefined ? ` — recovery: ${result.recovery}` : ''}`)
      return 1
    }
    return 0
  }
  const resolved = resolveAppDir(args.app_dir)
  if (resolved.appDir === undefined) {
    console.error(`[refuse] could not resolve the app dir (no --app-dir, registry unreadable, default ${DEFAULT_APP_DIR} absent)`)
    return 1
  }
  console.log(`[app] ${resolved.appDir} (source: ${resolved.source})`)
  const dshHome = args.dsh_home ?? join(homedir(), '.dsh')
  try {
    if (command === 'reanchor') {
      const result = reanchorAnchorSet({ appDir: resolved.appDir, out: args.out, accept: args.accept === true })
      printSteps('[reanchor]', result.steps)
      if (result.ok) {
        // The candidate is printed by default (inspection before accept).
        console.log(result.candidateJson)
        if (result.accepted) {
          console.log(`[done] anchor set data written: ${result.writtenTo} (sha256 ${result.writtenSha256})`)
        } else {
          console.log('[note] candidate produced — inspect it, then re-run with --accept to write patcher/anchors/<version>.json')
        }
        return 0
      }
      if (result.driftedMaterials !== undefined) {
        console.error(JSON.stringify({ driftedMaterials: result.driftedMaterials, classification: result.classification }, null, 2))
      }
      console.error(`[refuse] reanchor produced no candidate${result.recovery !== undefined ? ` — recovery: ${result.recovery}` : ''}`)
      return 1
    }
    if (command === 'patch') {
      const result = await patchAsar({ appDir: resolved.appDir, dshHome })
      printSteps('[gate]', result.steps)
      if (result.ok && result.alreadyPatched) {
        console.log('[skip] already patched — nothing to do (idempotent)')
        return 0
      }
      if (result.ok) {
        console.log(`[done] patched: target ${result.after?.size} B (sha ${result.after?.sha256}); marker written; backup at ${result.backup?.dir}`)
        console.log('[note] restart the desktop app to load the patched adapter; the patch survives until the next official update (re-run the patch after updates)')
        return 0
      }
      console.error(`[refuse] patch not applied${result.recovery !== undefined ? ` — recovery: ${result.recovery}` : ''}`)
      return 1
    }
    if (command === 'restore') {
      const result = await restoreAsar({ appDir: resolved.appDir, dshHome, backup: args.backup })
      printSteps('[gate]', result.steps)
      if (result.ok) {
        console.log(`[done] restored from ${result.backupDir}; marker cleared`)
        return 0
      }
      console.error(`[refuse] restore not applied${result.recovery !== undefined ? ` — recovery: ${result.recovery}` : ''}`)
      return 1
    }
    if (command === 'auto') {
      const result = await runAuto({ appDir: resolved.appDir, dshHome, yes: args.yes === true, logFile: args.log_file })
      if (result.sinkError !== undefined) console.error(`[warn] ${result.sinkError}`)
      return result.exitCode
    }
    console.log(JSON.stringify(await statusAsar({ appDir: resolved.appDir, dshHome }), null, 2))
    return 0
  } catch (error) {
    console.error(`[error] ${error instanceof Error ? error.message : String(error)}`)
    return 1
  }
}

/** CLI entry guard (imported by tests → no side effects). */
if (process.argv[1] !== undefined && basename(process.argv[1]) === 'zctx-patch.mjs') {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code
  })
}
