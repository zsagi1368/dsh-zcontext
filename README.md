# dsh-zcontext

[English](README.md) | [中文](README.zh.md)

[![CI](https://github.com/zsagi1368/dsh-zcontext/actions/workflows/ci.yml/badge.svg)](https://github.com/zsagi1368/dsh-zcontext/actions/workflows/ci.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![version: 0.3.0 beta](https://img.shields.io/badge/version-0.3.0-orange.svg)](CHANGELOG.md)
[![status: BETA — still in testing](https://img.shields.io/badge/status-BETA_testing-orange.svg)](#limitations)

> ⚠️ **BETA — still in testing.** This plugin is a test release: the mechanism is new, the estimator thresholds are uncalibrated, and real-machine validation is ongoing. Expect rough edges; the official compaction remains the hard floor. Feedback and `zctx_status` output from real sessions are welcome.

Model-driven incremental context folding for the [DeepSeek Harness](https://github.com/deepseek-ai) — the model folds finished stretches of a conversation into short summaries it writes itself, keeping the working window small over very long sessions, through the official surface-replace channel only.

- **What it is** — a third-party plugin package (`dsh-zcontext`) for the official DeepSeek Harness: four tools (`zctx_fold` / `zctx_unfold` / `zctx_recall` / `zctx_status`), one static guidance section, one pressure nudge, one `/zctx` command, an always-on observability ledger, an opt-in-able preflight gate, an opt-in zctx router for your own providers, and an opt-in **server-initiated autoFold** face that folds without waiting for the model to act — all surfaced through one settings page (nine primitive fields plus the v0.2.0/v0.3.0 sections below). No required host patches, no forks; the only wire-facing plugin face is the declared S2 router, which never rewrites a request body. A separate, strictly optional external patcher (`patcher/`, user-run) exists for the guard-observe wire domain.
- **Why it exists** — the official harness ships compaction-basic, which summarizes the whole window under pressure; it has no model-driven incremental folding. The [billion-context](https://github.com/ranxianglei/billion-context) research demonstrated the mechanism (model writes summaries, model picks ranges, cache-aware nudges, sessions run long with low window occupancy). This plugin reimplements that capability through the official plugin surface — the same mechanism, the harness's own proper channel.

  <a id="clean-room"></a>
- **Clean-room** — zero code or prompt text was copied from billion-context or any upstream source. All code and all model-facing text in this repository are original writing; the guidance section is our own wording. See [Acknowledgments](#acknowledgments).

## Table of contents

- [How it works](#how-it-works)
- [Install](#install)
- [The four tools](#the-four-tools)
- [The /zctx command](#the-zctx-command)
- [Relation to official compaction](#relation-to-official-compaction)
- [Observability ledger (installed = recording)](#observability-ledger)
- [Preflight (S1): judge the window before the wire](#preflight-s1)
- [zctx router (S2): bring-your-own providers, honestly](#zctx-router)
- [autoFold: server-initiated folding (opt-in, v0.3.0)](#autofold)
- [The optional base-context patcher (external, user-run, v0.2)](#the-optional-patcher)
- [Settings](#settings)
- [Realtime UI panel (BETA)](#realtime-ui)
- [Behavior notes](#behavior-notes)
- [Limitations](#limitations)
- [Security](#security)
- [Acknowledgments](#acknowledgments)
- [Development](#development)

<a id="how-it-works"></a>
## How it works

Folding replaces a span of earlier turns on the session surface with one short summary checkpoint. Everything rides the official surface-replace channel — the same primitive `compaction-basic` uses, which its types explicitly reserve for "any surface-replacing producer":

1. **Guidance** — a static, byte-stable system-prompt section teaches the model when to fold, what a summary must keep and drop, and the batch discipline. It never sets `complete: true` and carries no dynamic content, so it lands in the cached prompt prefix once and stays put.
2. **Nudge** — a runtime context fires when occupancy crosses 25/50/75/90% of the window (configurable). It contributes text only on a threshold crossing; between crossings it adds nothing to the wire (crossing-counted cache re-payment, not free).
3. **Fold** — the model calls `zctx_fold` with ranges + summaries. A conservative validator enforces: protected recent tail, first user message pinned, system head untouched, tool calls folded together with their results, net-shrink gate, atomic batch (any invalid range rejects the whole batch), no overlap with an active compaction.
4. **Ledger** — each fold commits a checkpoint event whose `message.source` carries `kind: 'zctx-fold'` (or `'zctx-unfold'`). There is **zero independent storage**: the fold ledger is rebuilt by scanning the session log, so resume and fork just work, and the original events stay in the log forever.
5. **Status** — `zctx_status` is the trusted ledger: window occupancy vs the fold trigger line, budget breakdown (CCM v2.3 formulas), foldable ranges with PROTECTED marks, active folds, anomalies, and cache usage (measured or estimated, labeled honestly). In v0.2.0 it renders the observability ledger in three segments (session summary, repay table behind the clean-sample gate, recent folds with attribution quality + reset digest).

Cache economics are accounted, not hand-waved: the four tool schemas plus the guidance section are a fixed wire overhead; each fold or nudge crossing re-pays a prefix rebuild from the cache anchor. `zctx_status` shows the breakeven split between measured (provider-reported cache read/write) and estimated values.

<a id="install"></a>
## Install

```sh
dsh plugin add github:zsagi1368/dsh-zcontext
```

Requirements: the DeepSeek Harness with plugin support, Node.js >= 22.13. The built artifact ships in the repository (`lib/`), so a git-form install never runs a build step and never asks for pnpm build approvals (`allowBuilds`). The only peer dependency is `@deepseek-ai/cordis` (optional, resolved from the host). After installing, the plugin appears in the settings page under its own section (static `Config` schema, the fields below), and `/zctx` becomes available in sessions. The observability ledger starts recording immediately; folding needs nothing else.

<a id="install-desktop"></a>
### Install on the Windows desktop app

The official Electron desktop app owns the reserved `desktop` profile and runs plugin transactions through its bundled pnpm (official architecture docs: "Desktop's bundled CLI manages its initialized plugins"). Two routes:

1. **In-app (recommended)** — open the desktop app's plugin management UI (plugin market / settings → plugins), choose *add from GitHub*, and enter `zsagi1368/dsh-zcontext`. Restart the app when it asks.
2. **CLI against the desktop profile** — from any dsh CLI that shares the same Harness home:

   ```sh
   dsh plugin --profile desktop add github:zsagi1368/dsh-zcontext
   ```

   Then restart the desktop app.

Verify: the settings page shows the **dsh-zcontext** section (the fields under [Settings](#settings)), and `/zctx` answers in a session. **Desktop note (honest ceiling):** face activation on the desktop composition is probe-designed but not yet machine-verified (tracked as BENCH-L2) — if the tools or status section do not appear in a desktop session, please open an issue with your `zctx_status` output; the headless composition is fully verified (see [Development](#development)).

Upgrading: repeat the same add/`pnpm update dsh-zcontext` inside the desktop profile and restart the app (the desktop profile keeps its own packages and lockfile, separate from any npm CLI install).

<a id="the-four-tools"></a>
## The four tools

All four are registered through the official `defineTool` authoring contract, take the official enforced schema subset, and return model-facing strings. Every failure is a fail-soft string result — nothing throws across the host boundary.

### `zctx_fold`

One required string carries ALL ranges and summaries — one `fold <startSeq>..<endSeq> [topic]` header line per block, followed by that block's markdown summary. The batch commits atomically or is rejected as a whole with reasons:

```json
{
  "content": "fold 3..7 [file inventory]\nThe user asked for a file inventory; three files were listed (a.sql, b.ts, c.md) and a.sql identified as the largest. Inventory is complete.\nfold 12..15 [schema of a.sql]\nSchema of a.sql: two tables and one view; the view aggregates daily totals."
}
```

A JSON array of `{ startRef, endRef, summary }` objects is also accepted (gateways that stringify arrays), as is a single top-level range object. Get exact ranges and pressure from `zctx_status` first.

### `zctx_unfold`

Re-materializes one folded range back onto the surface in place of its checkpoint. Without arguments, the most recent active fold is unfolded:

```json
{ "foldId": "f0000007" }
```

### `zctx_recall`

Searches inside everything already folded — summaries and folded-away originals (the originals stay in the session log). Returns ranked hits with excerpts and the owning fold id, so folded history stays reachable without unfolding:

```json
{ "query": "schema a.sql view", "limit": 5 }
```

### `zctx_status`

No arguments. The single trusted ledger for pressure, budget, ranges, folds, anomalies, and cache usage — the model is instructed to never reconstruct these numbers from memory:

```json
{}
```

<a id="the-zctx-command"></a>
## The /zctx command

The same engine, driven from the chat input:

```text
/zctx                     status (default)
/zctx status              pressure, budget, ranges, folds, cache usage
/zctx fold <content>      commit fold blocks (same content format as the tool)
/zctx unfold [foldId]     re-materialize a fold (latest active when omitted)
```

<a id="relation-to-official-compaction"></a>
## Relation to official compaction

**Coexistence, never interception.** The official `compaction-basic` is never disabled, blocked, or delayed by this plugin. It remains the unconditional hard floor: if the model never folds (tool adoption is the model's choice), compaction still summarizes under pressure exactly as upstream designed. When an official compaction is actively running, a concurrent fold commit is rejected cleanly and retried later. Folding earlier and smaller is the intended division of labor — proactive folds keep the window small so the hard floor rarely has to fire.

<a id="observability-ledger"></a>
## Observability ledger (installed = recording)

The ledger starts recording the moment the plugin is installed — no opt-in needed (`observe.enabled: true` by default; see it through `zctx_status`). A strictly read-only `llm/stream` listener watches every attempt and keeps, in process memory:

- **Request snapshots with normalized prefix hashes** — per-attempt views of what the wire actually saw, each row labeled with its projector provenance (the official projection exports when the host is present, a labeled local fallback otherwise).
- **A reset-event ledger** — model change, sampling change, toolset change, system-section change, compaction, session recovery, series restart, merge rewrites: every "the context changed under us" event that explains a cache re-payment.
- **Three-state usage accounting** — `measured` (provider-reported), `semi` (honestly upgraded: interpolated from a same-turn anchor, or meter-anchored), `estimated` (never guessed; a field that was absent stays absent).
- **Fold→usage attribution** — seq-order primary key with a time-window fallback, strong/retry/weak grades, and eight documented noise dispositions (multi-step after folds, retries, interrupts, one-shots, and friends).

`zctx_status` renders the whole ledger in three segments: the session summary, the repay table (behind the clean-sample gate — when the pure-sample ratio falls below `cleanSampleFloor` the status says attribution confidence is insufficient instead of showing numbers), and recent folds with their attribution quality plus the reset digest.

Dual-domain honesty: harness-domain rows cover every watched session; wire-domain byte hashes exist only for sessions the zctx router drove (below).

<a id="preflight-s1"></a>
## Preflight (S1): judge the window before the wire

`preflightMode: 'off' | 'observe' | 'enforce'` — **default `'observe'`**.

- **observe (default)** — a second read-only listener estimates each request's context before the wire (the official projection exports when the host is present, labeled fallback twins otherwise; kept images priced via the adapter's `imageRequestPricing` or a declared constant reserve) and records estimate-vs-real-usage into a calibration ledger that `zctx_status` renders as error statistics. Nothing is ever short-circuited in this mode.
- **enforce (explicit opt-in)** — a hit (estimate > trigger line × `preflightMarginRatio`) short-circuits the stream with exactly one terminal `finish{kind:'error', failure:{code:'CONTEXT_WINDOW_EXCEEDED'}}` chunk — the official sanctioned short-circuit — saving the doomed wire request; the official compaction overflow recovery chain owns everything after. One-shot requests (compaction, session title) are never judged, so the recovery's own calls can never be short-circuited. Two host-interaction facts (P3): a short-circuit consumes ONE of the compaction chain's `maxOverflowRetries` budgets (a false positive spends recovery budget too), and if you add `CONTEXT_WINDOW_EXCEEDED` to the official `retryableCodes`, llm-retry will re-send the same over-limit request after each short-circuit (bounded, but wasteful) — keep that code out of `retryableCodes` on zctx sessions.
- **off** — the listener does not register.

enforce stays opt-in until three migration conditions hold: the estimator's error distribution is calibrated on real machines, the false-positive cost (one unnecessary compaction surface rewrite per wrong hit) is consciously accepted, and observed hits reconcile with real provider overflows. Until then the estimator thresholds are declared calibration debt (see [Limitations](#limitations)).

<a id="zctx-router"></a>
## zctx router (S2): bring-your-own providers, honestly

The one place v0.2.0 touches the wire — as a declared exception, not a takeover: a thin adapter that lets the harness drive **your own** OpenAI-/Anthropic-compatible endpoints through the official configurable-provider surface. The official routes are never replaced, and the adapter **never rewrites a request body** (the zero-mutation redline is pinned by tests).

- **family IS the protocol.** Each declared provider becomes the route `zctx-<family>`, where `family` is a wire protocol name from the official `supportedProtocols()` union (`openai-completions` | `openai-responses` | `anthropic-messages`, loaded dynamically from the host with a labeled builtin fallback). Zero invented protocol mapping; an unknown family is refused at construction with the complete violation list.
- **Configuration shape.** The structured `providers[]` settings section is the config authority, written by hand through a profile overlay patch. The Models page mounts the plugin's namespace and shows each route's row, credential badge, and error field — but page **editing is not available** for a third-party namespace (probe-tested; honest ceiling): the page is visibility-only.
- **No hot reload.** The adapter registration rides the host llm service's own fiber (not the plugin's), so the plugin unloading does NOT unregister the route: after an HMR/reload the new instance hits `DUPLICATE_ADAPTER` and logs a warn while the OLD instance's adapter keeps serving the route with its (now stale) providers — provider/config changes take effect after a host restart (P3 HF-03; a registration.replace swap is the mid-term path, not the v0.2.x behavior).
- **Every model declares its capacities.** `contextWindow` and `maxTokens` are REQUIRED positive integers per model — a missing value is a construction violation, never an invented default (official catalog semantics).
- **Cache knobs.** `cacheRetention` (`'none' | 'short' | 'long'`) passes through to pi-ai's own precedence (explicit value > env > default `'short'`; `'none'` disables cache markers); `cacheControlFormat: 'anthropic'` materializes cache-control markers — only on the `openai-completions` family, refused anywhere else as dead config.
- **Redlines honored.** `maxRetries: 0` (the agent recovery layer owns retries), attribution headers ride every request including one-shots, HTTP(SSE) protocols only (no WebSocket transport), text-only — zctx routes carry no image/file content on the wire. P3 honesty note: the official runtime projects images to placeholder text BEFORE the adapter is dispatched (the adapter declares `inputModalities: ['text']`), so a zctx-routed image request completes with the model seeing only placeholder text and no failure signal. The adapter's own `UNSUPPORTED_CONTENT` gate is a defensive mirror for direct-adapter calls, and every wire-ledger row carries an `imageCount` field (0 on the official path) pinning what reached the adapter boundary.
- **Wire ledger coverage.** Only sessions the router actually drives get wire-domain byte-hash rows; everything else stays harness-domain only, and every row carries its `domain` label (plus `imageCount`, the P3 HF-01 observability field).

<a id="autofold"></a>
## autoFold: server-initiated folding (opt-in, v0.3.0)

Model-driven folding has one honest dependency: the model must choose to call `zctx_fold`. Measured on the headless bench, a free-flash route model with tools on the wire, guidance on the wire, and nudge text on the wire still made **zero spontaneous fold calls in 20 pressure rounds** (`reports/bench/BENCH-report.md` §11.3 — the adoption face). v0.3.0 adds the mechanism route that removes the dependency: **the plugin folds server-side**, without any model tool call.

`autofold.enabled` (default **false**, explicit opt-in) arms a third `llm/stream` waterfall listener — the innermost face, after preflight and observe:

1. **Trigger** — the V4 judgment is REUSED, not reimplemented: the preflight listener's projection + estimate (`projectAndEstimateRequest`) feeds the same trigger-line inequality with the same margin. A hit starts the chain; no hit means the request passes through untouched.
2. **Selection** — a conservative span set from the validator's own reachability domain (node 0, first user, latest user protected; tool calls folded with their results; pair-safe boundaries; `maxFoldFraction` cap; `minFoldableTokens` floor), oldest-first, batch-capped. A selection that cannot pass the validator's own gates is skipped honestly — never force-folded.
3. **Summary supply** — one of three, config-picked, never silently re-routed:
   - `compaction` (default) — the official one-shot `ctx.llm.stream({ purpose: 'compaction' })` channel, same shape as the official summarizer (purpose-marked, so it is invisible to all three listeners and never re-enters the chain; it does not enter the session log);
   - `external` — one bounded POST to your own endpoint (Bearer via `autofold.external.apiKeyEnv` indirection; a configured-but-missing environment variable warns loudly at wire time, and the face stays armed because missing credentials feed the degradation chain);
   - `digest` — a deterministic CPU-only fallback summary (no model call).
4. **Degradation chain** — transient empty answers retry (bounded), unsplittable failures halve at pair-safe midpoints to the floor, digest is the terminal fallback, dead supplies go sticky with one canary per run; every rejection is a logged fault, and nothing ever breaks the request (fail-open: the original stream proceeds unconditionally after the chain).
5. **Commit** — the same `fold()` engine and the same fresh-surface re-verification the model-facing path uses; a fold that no longer verifies mid-run aborts honestly. After a committing run the nudge baseline resets (anti-feedback-loop, mirroring the official compaction handler's own re-basing).

Measured reality (headless bench, `workbuddy/hy4flash-free`, declared window 40000): the trigger fired conservatively (turns 1-10 no hit), then committed a real server-initiated fold — span [9..202], 5471 → 864 estimated tokens (−84%), **zero model tool calls** in the whole 20-round session (BENCH-report §12; independent reviewer replay archived at `reports/bench/harness/replay-f297.mjs`). Known coverage boundary: within one monotonic epoch a committed fold collapses the reachable span below the fold floor — multiple folds per epoch need checkpoint-aligned absorption windows (BENCH-report §12.3/§13, honest limit, not a silent gap).

<a id="the-optional-patcher"></a>
## The optional base-context patcher (external, user-run, v0.2)

`patcher/zctx-patch.mjs` is a **standalone, strictly optional** tool for the official desktop build. It applies the five-file base-context patch set (`zctx-v0.3-base-1`) — one atomic asar write — to light up the guard-observe wire domain (per-request hash-then-passthrough fetch wrapper + adapter guard sink) on official routes. The plugin is fully functional without it; the patch only widens what the observability ledger can see on routes the plugin's own adapter does not drive. **Real-machine patch/restore execution is the user's command and responsibility** — the repository never runs it against a live install.

- **What it touches** — exactly five files inside the official asar (`llm-pi-ai` carrying the P4 wire stub + guard wiring; `agent-loop` guard observer; `session` persistence vocabulary; `compaction-basic` L3 budget; `compaction-tool-result-pruner` pruning declaration). Zero new asar entries, zero official export-face changes, zero request-body rewriting (redline R1).
- **Gates** — app-not-running, version ∈ supported set, per-file pristine-hash anchors (drift = official update = refuse), anchor uniqueness, idempotent re-run (already patched → no-op success), one atomic write for the whole set (no partial multi-file state can persist), per-file post-verification, sibling backup outside the install dir before touching anything.
- **Re-patch** — the patch survives only until the official updater replaces the install directory; after an update, `status` reports drift and you re-patch against the new build's anchor set. **Rollback** — `restore` puts the original bytes back from the hash-verified backup and clears the marker; `status` is strictly read-only and reports the per-file face plus the `patchSet` aggregate (patched / unpatched / partial / drifted). Full flow: `patcher/README.md`.
- **Self-heal (v0.3-auto)** — `auto` is a scheduled state machine (daily by default via `install-task`; `--schedule HOURLY` for hourly) that turns "the official update silently killed the patch" into "auto-repair or loud alarm": it reads the Electron fuse wire (VERIFY-P #11 sentinel scan — refuse fail-closed when the integrity fuse is ON or unreadable), re-patches an all-pristine anchor-matching install only under `--yes` (never blind-patching a drifted/mixed face), re-verifies with a FULL status read, and logs every line to `%LOCALAPPDATA%\zctx-patch\auto.log`; `install-task`/`uninstall-task` manage the Windows scheduled task around it (idempotent, audible refusal off-Windows). Judgment table: `patcher/README.md`.

<a id="settings"></a>
## Settings

Nine primitive fields plus the v0.2.0/v0.3.0 sections (observe switches, preflight, the S2 providers declaration, the guard-observe bridge switch, and the autoFold face); the static `Config` schema generates the settings page automatically.

| Field | Type | Default | Meaning |
|---|---|---|---|
| `enabled` | boolean | `true` | Master switch. When `false` the plugin stays passive; official compaction remains the hard floor. |
| `nudgeThresholds` | string | `"25,50,75,90"` | Comma-separated occupancy percentages that trigger a nudge. |
| `keepRecentTokens` | number | `0` | Verbatim recent-tail token budget; `0` = automatic. |
| `maxFoldFraction` | number | `0.6` | Upper bound on the fraction of the window a single fold may cover. |
| `minFoldableTokens` | number | `5000` | Minimum foldable span in tokens below which folding is refused. |
| `protectionFloorTokens` | number | `5000` | Tokens kept outside any fold window (protected recent tail). |
| `summaryFloorChars` | number | `50` | Shortest acceptable summary text in characters. |
| `summaryCeilingChars` | number | `20000` | Longest acceptable summary text in characters. |
| `netShrinkTolerance` | number | `1.05` | A fold must shrink the ledger by at least `1/netShrinkTolerance`. |

The v0.2.0 sections ride the same schema:

| Field | Type | Default | Meaning |
|---|---|---|---|
| `attributionTimeWindowMs` | number | `90000` | Attribution time-window fallback (uncalibrated — see [Limitations](#limitations)). |
| `cleanSampleFloor` | number | `0.6` | Below this pure-sample ratio, `zctx_status` reports insufficient attribution confidence instead of a repay table. |
| `observe.enabled` | boolean | `true` | Master switch of the observability ledger (installed = recording). |
| `observe.attemptCapture` | boolean | `false` | Also record failed attempts' usage (non-durable, process memory only). |
| `preflightMode` | string | `"observe"` | `'off' \| 'observe' \| 'enforce'` — see [Preflight (S1)](#preflight-s1). |
| `preflightMarginRatio` | number | `0.9` | Preflight hit margin (uncalibrated — see [Limitations](#limitations)). |
| `providers` | provider[] | `[]` | S2 router declarations (see [zctx router](#zctx-router)); zero routes = the adapter face stays a legal keep-alive. Configured through a profile overlay patch. |
| `patch.guardObserveEvents` | boolean | `true` | The log-only consumer of the patched chain's `cache/guard-observe` events (inert by construction without the external patcher). |
| `autofold.enabled` | boolean | `false` | Server-initiated folding face (see [autoFold](#autofold)); explicit opt-in in v0.3.0. |
| `autofold.summarizer` | string | `"compaction"` | Summary supply: `'compaction' \| 'external' \| 'digest'`. An illegal value is a loud skip, never a silent fallback. |
| `autofold.external.url` | string | `""` | External supply endpoint (required when `summarizer: 'external'`; empty = loud skip). |
| `autofold.external.model` | string | `""` | External supply model id (required with `external`). |
| `autofold.external.apiKeyEnv` | string | `""` | Name of the environment variable holding the external Bearer credential; configured-but-missing warns at wire time. |
| `autofold.maxRounds` | number | `16` | Chain span-attempt budget per run. |
| `autofold.maxBatch` | number | `4` | Selection batch width per chain round. |
| `autofold.maxSummaryOutputTokens` | number | `32768` | Output cap for model-driven summary calls (clamped). |

Independent of these settings, the whole automatic face (nudge + engine gate) stays off below a context window of 32768 tokens — the estimation formulas' legal domain. Tools remain usable; status renders an explicit note.

<a id="realtime-ui"></a>
## Realtime UI panel (BETA)

A zero-token, realtime panel for **viewing / statistics / settings** without opening a chat session. In the web/desktop composition the plugin registers native read-only routes on the host webServer; open:

```
/zctx-ui
```

in the same browser (same origin as the DSH web app). It works only where a `webServer` exists (web/desktop profiles); CLI/headless has no UI and the plugin simply skips this surface.

**Three blocks**

- **查看 (View)** — polls `/zctx-ui/api/snapshot` every 5s and renders the live process-memory ledger: window tokens / capacity / pressure %, the six budget lines, foldable ranges, the fold ledger, the cache accounting badge (`measured` vs `estimated`), and a face-health light (green/amber/red). All reads come from the in-memory ledger via a thin read-only snapshot API — no log scanning, no model call.
- **统计 (Stats)** — cumulative folds, net tokens saved (with a `measured`/`estimated` basis tag), repay count from the breakeven table, three-state sample split, clean-sample ratio (with the confidence-gate verdict), and the reset-ledger digest.
- **设置 (Settings)** — a form for the nine core fields plus four face switches (`observe.enabled`, `patch.guardObserveEvents`, `autofold.enabled`, `preflightMode`). Saving writes the profile overlay **only through the host `configEditor.edit`** (never a direct file write); it takes effect on next load, not as a hot swap of already-mounted faces. When no `configEditor` is available the form is read-only.

**Authorization** — a bridge token is generated at runtime (`node:crypto` randomBytes) and injected into the page for this process session only; it is never written to disk or logs. Reads accept the token, a same-origin request, or a loopback socket. Writes are stricter: token, **or** same-origin **and** loopback. Non-authorized requests get `403`; a headless host with no webServer registers no routes at all.

**Face-health light** — a tri-state probe (tools registered / guidance injected / observe+guard on disk) with a visible fail-soft diagnostic to stderr when degraded or absent. It distinguishes "UI has no data" from "the desktop face is not active" (no silent failure). The probe is a machine-readable readiness signal, **not** proof that the face works end-to-end on your machine; real-device triple-evidence remains a manual acceptance item.

**Native entry** — a `settings.section` summary card ("zcontext 摘要") shows the fold count / window occupancy and links to `/zctx-ui`. The client fiber declares only `inject: ['slots']`; if that service is absent the card is a lazy no-op (never a hanging PENDING), and if React is unavailable it degrades to a plain link.

> **Honest boundary (BETA):** this panel solves *viewing and changing settings without opening a session and spending billed tokens*. It does **not** eliminate all fold tokens — model-driven folds still consume session tokens; only the server-side `autofold` face removes that dependency. The panel is a read-only view plus an overlay-settings writer; it never touches the model request body (R1 zero request-rewrite).

<a id="behavior-notes"></a>
## Behavior notes

Three behaviors that are deliberate, not bugs:

**PTC (run_code) sessions cannot call the tools directly.** In native tool mode, the model calls `zctx_*` tools first-class. In a PTC session, the official harness does not register direct model calls to third-party tools (they are rejected as `UNKNOWN_TOOL`), so there the tools are dispatched through `run_code` sub-dispatch. The guidance section carries this note for the model. Nothing about folding changes — only the calling convention differs by mode.

**The nudge context registers with `required: true`.** The official system-prompt assembler filters out non-required context contributions in some configurations (e.g. runtime context suppressed). Registering the pressure nudge as required is what makes it survive that filter — without it, the nudge could silently vanish exactly when pressure is high. This does not mean the nudge is always on the wire: it contributes text only when a threshold is crossed since its last evaluation, and contributes nothing otherwise.

**Unfold re-materializes as one node.** The official replace semantics swap N surface nodes for exactly one node. Unfolding therefore replaces the checkpoint with a single multi-block user message that quotes the original content inline (originals fetched from the log in order; tool results quoted with a source annotation) — the original turns do NOT return to the surface as separate messages. The session log keeps every original event permanently, and `zctx_recall` searches them, but the wire shape after an unfold differs from the pre-fold turn structure. This is the honest cost of riding the official channel, and it is asserted in tests rather than hidden.

<a id="limitations"></a>
## Limitations

- **Tool adoption depends on the model.** Folding happens when the model follows the guidance and nudges. Weaker instruction-following means fewer folds — and the official compaction-basic remains the hard floor either way. v0.3.0's `autofold.enabled` opt-in removes this dependency with the server-initiated face (see [autoFold](#autofold)).
- **autoFold's per-epoch coverage boundary.** Within one monotonic epoch (no intervening compaction/checkpoint shift), a committed fold collapses the reachable span below the `minFoldableTokens` floor — one fold per epoch is the honest ceiling until checkpoint-aligned absorption windows land (measured headless; BENCH-report §12.3).
- **No wire-level fallback.** Folding rides the official surface replace channel only. There is no request rewriting, no fetch proxy, no prompt-level truncation fallback; if the channel is unavailable, the plugin does not degrade to hacky alternatives.
- **Cross-checkpoint absorption is boundary-aligned.** A fold window may absorb an earlier fold's checkpoint only when the window is exactly `[checkpoint, checkpoint]`; wider spans across a checkpoint are rejected with an explicit reason.
- **Single-session scope.** `zctx_recall` and the ledger are per-session; no cross-session retrieval.
- **Estimator thresholds are uncalibrated.** `attributionTimeWindowMs=90000`, `cleanSampleFloor=0.6`, and `preflightMarginRatio=0.9` are designed defaults awaiting real-machine calibration; the chars/3 estimator's underestimate risk on dense CJK text is the known hazard. `zctx_status` renders the calibration statistics that will justify adjusting them — until then, `preflightMode: 'enforce'` is opt-in advanced usage only.
- **The wire-domain ledger sees only zctx-routed sessions, and object-level hashes are blind below the harness boundary.** Harness-domain normalized prefix hashes see harness events only — whatever pi-ai or the transport stack does below that boundary (serialization, provider-specific framing) is invisible to them; the wire-domain byte hashes see the real bytes but only where the S2 router drove the request. This is the honest ceiling of v0.2.0's observability, declared rather than papered over.

<a id="security"></a>
## Security

- **Zero network, zero telemetry.** The plugin opens no sockets and emits no metrics anywhere; there is no analytics, no crash reporting, no phone-home.
- **Session data stays local.** All folding state lives in the local session log (the harness's own storage). The plugin keeps zero independent data files; its in-memory ledger is rebuilt by scanning that log.
- **Model-forgery defense.** The model cannot "claim" a fold that didn't happen: every submission is validated server-side (protected zones, contiguity, net-shrink gate, summary length windows, atomic batch), the commit goes through the harness's own session append, and the receipt the model sees is the native tool result — not model-rendered text.
- **Exclusive fold commits.** None of the four tools declares `isConcurrencySafe`; omission is the official exclusive-barrier semantics, which is the mutual-exclusion precondition the commit path relies on.
- **Fail-soft degradation.** Every host face is capability-probed; a missing service skips its feature with a log line instead of breaking boot.

<a id="acknowledgments"></a>
## Acknowledgments

This plugin is a clean-room reimplementation of a mechanism the community proved out:

- [**ranxianglei/billion-context**](https://github.com/ranxianglei/billion-context) (MIT) — the mechanism inspiration: model-driven incremental folding, summaries-as-metadata discipline, cache-aware nudges, crossing-counted re-payment. This plugin thanks it for publishing the working design and its honest trade-offs. **No code, no prompt text, and no compression-rule wording was copied from it** — all text here is written from scratch; only the mechanism semantics were studied.
- **Our own CCM research** (context-cache economics: budget formulas, breakeven accounting, the 32768-token legal domain) — the budget engine and status accounting follow it.

All implementation, wording, tests, and documentation in this repository are original work (MIT, see [LICENSE](LICENSE)).

<a id="development"></a>
## Development

```sh
pnpm install
pnpm build          # tsdown → lib/ (committed artifact, byte-pinned in CI probes)
pnpm lint           # tsc --noEmit, zero errors expected
pnpm test           # tsdown && vitest run — the build is chained FIRST (Z19: tests
                    # that import lib/index.js would silently pin a stale artifact
                    # otherwise), incl. real official-session pins
```

Repository-internal verification probes:

```sh
node scripts/probe-artifact.mjs             # 6 probe groups against the built lib
node scripts/verify-activation-surface.mjs  # activation-surface assertions (10 groups)
node scripts/probe-host-imports.mjs         # host-export reachability (16 probes; skips when zDSH-main is absent)
node scripts/smoke-real-loader.mjs          # real-machine smoke (3 probes; skips parts when zDSH-main is absent)
node scripts/probe-real-mount.mjs           # real vendored-cordis mount of the built lib (4 groups / 5 checks, incl. the device-failure negative control)
```
