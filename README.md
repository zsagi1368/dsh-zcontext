# dsh-zcontext

Model-driven incremental context folding for the [DeepSeek Harness](https://github.com/deepseek-ai) — the model folds finished stretches of a conversation into short summaries it writes itself, keeping the working window small over very long sessions, through the official surface-replace channel only.

- **What it is** — a third-party plugin package (`dsh-zcontext`) for the official DeepSeek Harness: four tools (`zctx_fold` / `zctx_unfold` / `zctx_recall` / `zctx_status`), one static guidance section, one pressure nudge, one `/zctx` command, an always-on observability ledger, an opt-in-able preflight gate, and an opt-in zctx router for your own providers — all surfaced through one settings page (nine primitive fields plus the v0.2.0 sections below). No host patches, no forks; the only wire-facing face is the declared S2 router, which never rewrites a request body.
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
- [Settings](#settings)
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
- **enforce (explicit opt-in)** — a hit (estimate > trigger line × `preflightMarginRatio`) short-circuits the stream with exactly one terminal `finish{kind:'error', failure:{code:'CONTEXT_WINDOW_EXCEEDED'}}` chunk — the official sanctioned short-circuit — saving the doomed wire request; the official compaction overflow recovery chain owns everything after. One-shot requests (compaction, session title) are never judged, so the recovery's own calls can never be short-circuited.
- **off** — the listener does not register.

enforce stays opt-in until three migration conditions hold: the estimator's error distribution is calibrated on real machines, the false-positive cost (one unnecessary compaction surface rewrite per wrong hit) is consciously accepted, and observed hits reconcile with real provider overflows. Until then the estimator thresholds are declared calibration debt (see [Limitations](#limitations)).

<a id="zctx-router"></a>
## zctx router (S2): bring-your-own providers, honestly

The one place v0.2.0 touches the wire — as a declared exception, not a takeover: a thin adapter that lets the harness drive **your own** OpenAI-/Anthropic-compatible endpoints through the official configurable-provider surface. The official routes are never replaced, and the adapter **never rewrites a request body** (the zero-mutation redline is pinned by tests).

- **family IS the protocol.** Each declared provider becomes the route `zctx-<family>`, where `family` is a wire protocol name from the official `supportedProtocols()` union (`openai-completions` | `openai-responses` | `anthropic-messages`, loaded dynamically from the host with a labeled builtin fallback). Zero invented protocol mapping; an unknown family is refused at construction with the complete violation list.
- **Configuration shape.** The structured `providers[]` settings section is the config authority, written by hand through a profile overlay patch. The Models page mounts the plugin's namespace and shows each route's row, credential badge, and error field — but page **editing is not available** for a third-party namespace (probe-tested; honest ceiling): the page is visibility-only.
- **Every model declares its capacities.** `contextWindow` and `maxTokens` are REQUIRED positive integers per model — a missing value is a construction violation, never an invented default (official catalog semantics).
- **Cache knobs.** `cacheRetention` (`'none' | 'short' | 'long'`) passes through to pi-ai's own precedence (explicit value > env > default `'short'`; `'none'` disables cache markers); `cacheControlFormat: 'anthropic'` materializes cache-control markers — only on the `openai-completions` family, refused anywhere else as dead config.
- **Redlines honored.** `maxRetries: 0` (the agent recovery layer owns retries), attribution headers ride every request including one-shots, HTTP(SSE) protocols only (no WebSocket transport), text-only — image/file content blocks are refused before the wire.
- **Wire ledger coverage.** Only sessions the router actually drives get wire-domain byte-hash rows; everything else stays harness-domain only, and every row carries its `domain` label.

<a id="settings"></a>
## Settings

Nine primitive fields plus the v0.2.0 sections (observe switches, preflight, and the S2 providers declaration); the static `Config` schema generates the settings page automatically.

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

Independent of these settings, the whole automatic face (nudge + engine gate) stays off below a context window of 32768 tokens — the estimation formulas' legal domain. Tools remain usable; status renders an explicit note.

<a id="behavior-notes"></a>
## Behavior notes

Three behaviors that are deliberate, not bugs:

**PTC (run_code) sessions cannot call the tools directly.** In native tool mode, the model calls `zctx_*` tools first-class. In a PTC session, the official harness does not register direct model calls to third-party tools (they are rejected as `UNKNOWN_TOOL`), so there the tools are dispatched through `run_code` sub-dispatch. The guidance section carries this note for the model. Nothing about folding changes — only the calling convention differs by mode.

**The nudge context registers with `required: true`.** The official system-prompt assembler filters out non-required context contributions in some configurations (e.g. runtime context suppressed). Registering the pressure nudge as required is what makes it survive that filter — without it, the nudge could silently vanish exactly when pressure is high. This does not mean the nudge is always on the wire: it contributes text only when a threshold is crossed since its last evaluation, and contributes nothing otherwise.

**Unfold re-materializes as one node.** The official replace semantics swap N surface nodes for exactly one node. Unfolding therefore replaces the checkpoint with a single multi-block user message that quotes the original content inline (originals fetched from the log in order; tool results quoted with a source annotation) — the original turns do NOT return to the surface as separate messages. The session log keeps every original event permanently, and `zctx_recall` searches them, but the wire shape after an unfold differs from the pre-fold turn structure. This is the honest cost of riding the official channel, and it is asserted in tests rather than hidden.

<a id="limitations"></a>
## Limitations

- **Tool adoption depends on the model.** Folding happens when the model follows the guidance and nudges. Weaker instruction-following means fewer folds — and the official compaction-basic remains the hard floor either way.
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
pnpm test           # vitest suite (424 tests), incl. real official-session pins
```

Repository-internal verification probes:

```sh
node scripts/probe-artifact.mjs             # 6 probe groups against the built lib
node scripts/verify-activation-surface.mjs  # activation-surface assertions (10 groups)
node scripts/probe-host-imports.mjs         # host-export reachability (16 probes; skips when zDSH-main is absent)
node scripts/smoke-real-loader.mjs          # real-machine smoke (3 probes; skips parts when zDSH-main is absent)
```
