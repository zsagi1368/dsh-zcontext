# dsh-zcontext

Model-driven incremental context folding for the [DeepSeek Harness](https://github.com/deepseek-ai) — the model folds finished stretches of a conversation into short summaries it writes itself, keeping the working window small over very long sessions, through the official surface-replace channel only.

- **What it is** — a third-party plugin package (`dsh-zcontext`) for the official DeepSeek Harness: four tools (`zctx_fold` / `zctx_unfold` / `zctx_recall` / `zctx_status`), one static guidance section, one pressure nudge, one `/zctx` command, and a nine-field settings page. No host patches, no forks, no wire rewriting.
- **Why it exists** — the official harness ships compaction-basic, which summarizes the whole window under pressure; it has no model-driven incremental folding. The [billion-context](https://github.com/ranxianglei/billion-context) research demonstrated the mechanism (model writes summaries, model picks ranges, cache-aware nudges, sessions run long with low window occupancy). This plugin reimplements that capability through the official plugin surface — the same mechanism, the harness's own proper channel.

  <a id="clean-room"></a>
- **Clean-room** — zero code or prompt text was copied from billion-context or any upstream source. All code and all model-facing text in this repository are original writing; the guidance section is our own wording. See [Acknowledgments](#acknowledgments).

## Table of contents

- [How it works](#how-it-works)
- [Install](#install)
- [The four tools](#the-four-tools)
- [The /zctx command](#the-zctx-command)
- [Relation to official compaction](#relation-to-official-compaction)
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
5. **Status** — `zctx_status` is the trusted ledger: window occupancy vs the fold trigger line, budget breakdown (CCM v2.3 formulas), foldable ranges with PROTECTED marks, active folds, anomalies, and cache usage (measured or estimated, labeled honestly).

Cache economics are accounted, not hand-waved: the four tool schemas plus the guidance section are a fixed wire overhead; each fold or nudge crossing re-pays a prefix rebuild from the cache anchor. `zctx_status` shows the breakeven split between measured (provider-reported cache read/write) and estimated values.

<a id="install"></a>
## Install

```sh
dsh plugin add github:zsagi1368/dsh-zcontext
```

Requirements: the DeepSeek Harness with plugin support, Node.js >= 22.13. The built artifact ships in the repository (`lib/`), so a git-form install never runs a build step and never asks for pnpm build approvals (`allowBuilds`). The only peer dependency is `@deepseek-ai/cordis` (optional, resolved from the host). After installing, the plugin appears in the settings page under its own section (static `Config` schema, nine fields below), and `/zctx` becomes available in sessions.

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

<a id="settings"></a>
## Settings

Nine primitive fields; the static `Config` schema generates the settings page automatically.

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
pnpm test           # vitest suite (193 tests), incl. real official-session pins
```

Repository-internal verification probes:

```sh
node scripts/probe-artifact.mjs             # 5 probe groups against the built lib
node scripts/verify-activation-surface.mjs  # A4 activation-surface assertions (8 groups)
node scripts/smoke-real-loader.mjs          # A6 real-machine smoke (skips parts when zDSH-main is absent)
```
