# Changelog

All notable changes to `dsh-zcontext` are documented in this file.
Format follows [Keep a Changelog](https://keepachangelog.com); versioning follows SemVer.

## [Unreleased] — 0.2.0 draft (V4 wave in progress; V5/V6 pending)

### Added (v0.2.0 so far)

- **Observability ledger** (V1-V3, RES-observe-route): read-only `llm/stream`
  waterfall listener — per-attempt request snapshots (normalized hashes,
  labeled `official`/`local-fallback` projector provenance), harness-domain
  prefix-break classification against the reset ledger, reset-event ledger
  (7/8 guardian classes + series-restart), three-state usage accounting
  (measured/semi/estimated), fold→usage attribution engine (seq-order primary
  key + time-window fallback, strong/retry/weak grades, 8-item noise
  disposition), and the `zctx_status` three-segment upgrade (session summary,
  repay table behind the clean-sample gate, recent folds with attribution
  quality, reset digest). Opt-in faces: `observe.attemptCapture` (failed
  attempts' usage, non-durable).
- **S1 preflight** (V4, RES-adapter-route §11b S1 + F6.1-F6.4/F8.3): a second
  `llm/stream` listener (registered OUTERMOST) that estimates the request's
  context before the wire — chars/3 over the re-projected messages (the
  official projection exports when the host is present, labeled fallback
  twins otherwise), adapter `imageRequestPricing` for kept images or a
  constant reserve (`PER_IMAGE_FALLBACK_TOKENS`, 待标定) with honest labels —
  and judges it against the CCM trigger line:
  **hit ⇔ estimate > triggerLine × preflightMarginRatio**.
  - `preflightMode: 'off' | 'observe' | 'enforce'` — **default 'observe'**:
    estimates are recorded into a process-memory calibration ledger (estimate
    vs the real usage that follows) and `zctx_status` renders the estimator
    error statistics that decide when enforce is safe to promote.
  - `preflightMode: 'enforce'` (explicit opt-in): a hit short-circuits the
    stream with exactly one terminal
    `finish{kind:'error', failure:{code:'CONTEXT_WINDOW_EXCEEDED'}}` chunk
    (official sanctioned short-circuit; the official compaction overflow
    recovery chain owns everything after — compactIfNeeded + retry), saving
    the doomed wire request.
  - One-shot requests (`purpose: 'compaction' | 'session-title'`) are never
    judged, so the compaction recovery's own calls can never be short-circuited.
  - Redlines honored: R2 (enforce unreachable under the default
    configuration — pinned by test), R3 (the listener's dependency surface
    carries no llm runtime — the `ctx.llm.stream` self-call is structurally
    unreachable), zero request mutation (frozen-tree pin reused across both
    modes).
  - V2-A closure: a fault in the observe listener's prepare phase now warns
    once (per listener) instead of being swallowed silently.
- New settings: `preflightMode='observe'`, `preflightMarginRatio=0.9`
  (估算器误差分布待真机标定后调整), `attributionTimeWindowMs=90000`,
  `cleanSampleFloor=0.6`, `observe.enabled=true`, `observe.attemptCapture=false`.

### observe → enforce migration conditions (no-go condition 4 discipline)

`preflightMode: 'enforce'` is an opt-in advanced usage until ALL of the
following hold (真机标定前 enforce 是 opt-in 高级用法):

1. **Estimator error distribution calibrated on real machines**: the
   `zctx_status` preflight segment shows a comparable-sample count and
   mean/worst error over the calibration ledger — promote only after a
   representative sample (route/model/ContentForm coverage) shows the
   estimate is not systematically UNDER the true wire cost in the hot band
   (a chars/3 underestimate on dense CJK is the known risk).
2. **False-positive cost accepted**: every preflight hit that the provider
   would have accepted triggers one unnecessary compaction surface rewrite
   (F6.4) — the margin (`preflightMarginRatio`, default 0.9) exists to bias
   against that; lowering it is a deliberate, documented trade.
3. **Observed short-circuits reconcile**: in observe mode, records with
   `hit: true` should correlate with real provider overflow errors over the
   same window band; a hit-rate far above the true overflow rate is the
   false-positive signature — keep observe running until they reconcile.

## [0.1.0] - 2026-11-12

First release: model-driven incremental context folding for the official DeepSeek Harness, riding the official surface-replace channel (coexists with `compaction-basic`, which remains the hard floor).

### Added

- **Four `zctx_` tools**, all registered through the official `defineTool`
  authoring contract and the official enforced schema subset:
  - `zctx_fold` — one required `content: string` carries ALL ranges and
    summaries (`fold <startSeq>..<endSeq> [topic]` header lines + markdown
    blocks; a JSON array of `{startRef, endRef, summary}` is also accepted via
    the lenient, parseCompressInput-aligned parser). Batch commits atomically
    through the official surface-replace channel or is rejected as a whole
    with reasons.
  - `zctx_unfold` — re-materializes one folded range in place of its
    checkpoint (single multi-block user message; defaults to the latest
    active fold without arguments).
  - `zctx_recall` — keyword search across summaries AND folded-away originals
    (ranked hits with excerpts and owning fold id).
  - `zctx_status` — the trusted ledger: window occupancy vs the fold trigger
    line, budget breakdown (CCM v2.3 formulas), foldable ranges with
    PROTECTED marks, active folds, anomalies, and cache usage with an honest
    measured/estimated split.
  - Concurrency discipline (S8): none of the four tools declares
    `isConcurrencySafe` — the official exclusive barrier is the fold commit
    path's mutual-exclusion precondition.
- **Static guidance section** (`zctx-guidance`): byte-stable original text
  (no timestamps, no counters) teaching when to fold, what summaries must
  keep/drop, summary-as-metadata discipline (open objectives stay
  instructions), bilingual-preservation rule, and the PTC calling note.
  Never sets `complete: true` (an effective complete section would replace
  the whole system prompt), so it lands once in the cached prompt prefix.
- **Threshold nudge** (`zctx-nudge` runtime context): fires when occupancy
  crosses the configured thresholds (default 25/50/75/90%); contributes text
  only on a threshold crossing (crossing-counted cache re-payment), nothing
  otherwise. Registered with **`required: true`** so it survives the official
  runtime-context suppression filter; the provider consumes the official
  `AssembleContext` and attributes pressure per-session (most-recent-session
  fallback documented).
- **`/zctx` command**: `status` (default) | `fold <content>` |
  `unfold [foldId]`, driven through the same engine/runtime as the tools,
  fail-soft error texts everywhere.
- **Nine-field settings page** (static `Config` schema, schemastery resolved
  lazily with a fail-soft built-in validator fallback):
  `enabled=true`, `nudgeThresholds="25,50,75,90"`, `keepRecentTokens=0`
  (0 = automatic), `maxFoldFraction=0.6`, `minFoldableTokens=5000`,
  `protectionFloorTokens=5000`, `summaryFloorChars=50`,
  `summaryCeilingChars=20000`, `netShrinkTolerance=1.05`.
- **Conservative fold validator**: protected recent tail, pinned first user
  message, untouched system head (readable pre-check), tool-call/result
  pairing closure, surface contiguity (cross-checkpoint absorption only when
  boundary-aligned `[checkpoint, checkpoint]`), summary windows and overlap
  checks, net-shrink gate, atomic batch rejection, active-compaction mutex
  with surface-generation snapshots (generation mismatch records an anomaly
  instead of committing blind).
- **Zero independent storage**: fold checkpoints are official `user/message`
  events with `message.source` kinds `zctx-fold`/`zctx-unfold` (same minimal
  shape as the official compaction checkpoint); the ledger is rebuilt by
  scanning the session log, so resume and fork work with no sidecar files.
- **Cache accounting**: usage ledger fed from assistant/message usage
  (cacheReadTokens/cacheWriteTokens), degrading to labeled estimates when
  absent; `zctx_status` renders the measured/estimated split (w=1.0, r=0.1,
  q=4.0 breakeven model) and the fixed wire overhead of the tool schemas +
  guidance section.
- **Install surface**: `dsh.bundle.patch=./cordis.patch.yml`
  (`manifestVersion: 1`, insert row `{ id: dsh-zcontext, name: dsh-zcontext }`),
  built artifact committed in `lib/` (git-form installs never build),
  no install-time lifecycle scripts, no `dsh.client` field, optional peer
  dependency `@deepseek-ai/cordis >= 4`, `engines.node >= 22.13`.
- **Verification probes** (runnable from the repo root):
  `scripts/probe-artifact.mjs` (5 groups against the built lib, including
  real official-session projection pins),
  `scripts/verify-activation-surface.mjs` (8 assertion groups: committed
  artifact, install-gate contract, identity/tool-name probe, patch yml,
  checkpoint markers, S8, B2, artifact probe subprocess),
  `scripts/smoke-real-loader.mjs` (real-machine smoke through the real
  loader lib and the real CLI dump-config path, skipping with reasons when
  the host checkout is absent).

### Behavior (deliberate, documented)

- **PTC direct invocation is restricted**: in `ptc` mode the official harness
  rejects direct model calls to `zctx_*` tools as UNKNOWN_TOOL; use the
  `run_code` sub-dispatch form there. Native tool mode is the first-class
  path in v1.
- **The nudge registers `required: true`**: the official system-prompt
  assembler filters non-required context contributions in some
  configurations; required registration keeps the pressure nudge alive
  there. This does not put the nudge permanently on the wire — it
  contributes only on threshold crossings.
- **Unfold re-materializes as one node**: official replace semantics swap N
  surface nodes for exactly one node, so unfold replaces the checkpoint with
  a single multi-block user message quoting the originals inline (tool
  results with source annotations); original turns do not return to the
  surface as separate messages (the session log keeps them permanently and
  `zctx_recall` searches them).

### Limitations

- **No wire-level fallback**: folding rides the official surface replace
  channel only; when that channel is unavailable the plugin does not degrade
  to wire-level session rewriting, fetch patching, or request rewriting.
- **Tool adoption depends on the model**: folding happens when the model
  follows the guidance section and nudges; the official compaction-basic
  remains the unconditional hard floor and is never disabled by this plugin.
- **Automatic face gated below 32768-token windows** (the CCM estimation
  formulas' legal domain): nudge and engine folding gate stay off; tools
  remain usable with an explicit status note.
- **Single-session scope**: `zctx_recall` and the fold ledger are
  per-session; no cross-session retrieval.

### Security

- Zero network, zero telemetry, zero independent data files — all state in
  the harness's local session log (see `SECURITY.md` for the threat model
  and the model-forgery defense).
