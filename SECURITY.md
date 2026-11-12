# Security Policy — dsh-zcontext

## Threat model

dsh-zcontext is a local, offline plugin for the DeepSeek Harness. It touches exactly one kind of state — the harness's own session log — and its trust boundaries are the model (untrusted input author), the session log (the harness's storage), and the host services it capability-probes.

| Asset | Where it lives | Exposure |
|---|---|---|
| Session content | harness session log (local disk, harness-managed) | never leaves the machine via this plugin; never transmitted |
| Fold ledger (foldId, ranges, summaries) | derived in-memory from the session log; persisted only as the checkpoint events the harness stores | no independent files; no external store |
| Config values | host settings/profile (host-managed) | nine primitive fields; no secrets, no credentials |
| Model-authored summaries | checkpoint `message.source` payloads | treated as untrusted input; validated before commit |

## Guarantees

- **Zero network.** The plugin opens no sockets, resolves no remote resources, and performs no DNS. `zctx_*` tools, the guidance section, the nudge, and `/zctx` all operate purely on local session state.
- **Zero telemetry.** No analytics, no metrics, no crash reporting, no version phone-home. There is nothing to opt out of because nothing is emitted.
- **Session data stays local.** All folding state is reconstructed by scanning the local session log. The plugin writes nothing outside the harness's own session storage (via the official `Session.append` channel) and keeps zero independent data files.

## Model-forgery defense

The model is treated as an untrusted author of fold submissions (a class of attack demonstrated against comparable folding mechanisms). Defense is server-side, in the commit path:

1. **No model-rendered truth.** The receipt a model sees for a fold is the NATIVE tool result produced by the harness from the actual commit — never model-supplied text echoed back as fact.
2. **Validation before commit.** Every submission passes the conservative validator before anything is written: protected recent tail, pinned first user message, untouched system head, tool-call/result pairing closure, contiguity on the surface, summary length windows, net-shrink gate, atomic batch (one invalid range rejects the whole batch).
3. **Official channel only.** Commits go through the harness's own `Session.append` with the surface-replace op — the same integrity machinery compaction-basic relies on. No direct log writes.
4. **Compaction mutex.** A fold commit is rejected while an official compaction is unclosed; surface generation snapshots detect concurrent mutation and record anomalies instead of committing blind.
5. **Exclusive barrier.** None of the four tools declares `isConcurrencySafe`; omission is the official exclusive-barrier semantics, which is the mutual-exclusion precondition of the commit path.
6. **Lenient parsing, strict committing.** `zctx_fold`'s argument parser is tolerant of gateway shapes (JSON arrays, stringified blocks), but tolerance ends at parsing — everything reachable the validator must accept, and the reject reasons are honest.

## Degradation posture

Every host face is capability-probed. A missing or broken host service skips its feature with a log line; the plugin never throws across the host boundary and never falls back to an unofficial mechanism (no fetch patching, no request rewriting, no wire-level hacks).

## Reporting

This is an offline third-party plugin with no server component — there is no embargo-grade surface to report through a private channel. Open a GitHub issue on `zsagi1368/dsh-zcontext` with reproduction steps for anything you find; locally verifiable reports (session fixtures without private content) are the fastest path to a fix.
