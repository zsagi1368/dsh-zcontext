# Changelog

All notable changes to `dsh-zcontext` are documented in this file.
Format follows [Keep a Changelog](https://keepachangelog.com); versioning follows SemVer.

## [Unreleased]

### Added — full-function native sidebar panel (ZCTX-UI / ZCTX-SIDEBAR / ZCTX-FULLPANEL)

- **Full-function native side panel** (`sidebar.panellist` + `main`, shared
  `dsh-zcontext.panel` key): the app's left menu shows a `zcontext` entry
  whose central panel carries the complete surface inside the app —
  查看 (live snapshot, 5s poll, multi-session switcher whose pick survives
  the poll), 统计 (SQLite cumulative ledger: total folds / cumulative tokens
  saved / sessions covered — a failed ledger read renders an honest "stats
  unavailable" row instead of mislabeling current-session numbers — plus the
  current session's foldable ranges and cache measured-vs-estimated), and
  设置 (WRITABLE in the panel: nine fields + four face switches, POST
  `{fields, faceSwitches}` through `configEditor.edit` into the profile
  overlay; number fields are submitted as numbers, a NaN value rejects the
  whole submit with a message). Clicking the menu entry never navigates the
  DSH window away.
- **UI language follows DSH** (user 2026-11-20): the panel reads the webview's
  `navigator.language` (inherits the DSH language setting) — explicit zh/en
  copy for every string via the dictionary; zh locales render 中文, ANY other
  detected locale renders English, and a missing probe defaults to 中文.
- **`GET /zctx-ui/api/stats`** — the panel's durable-ledger data channel,
  same authorization arms as the snapshot route (GET-only 405 / unauthorized
  403 / fault 500), fail-soft zeros when the ledger store is absent.
- **Face tri-state probe** with a visible fail-soft sink: distinguishes "no
  data" from "the desktop face is not active" (never fabricated zeros; fetch
  failures surface as an honest error row, B3-S7).
- **Desktop acceptance** (pending final sign-off): panel visibility/render,
  language following, stats readout, and a true in-panel settings write are
  verified on the real machine per the sidebar acceptance matrix (B4); the
  same-origin read path was already observed live in the dsh-app webview.

### Removed — browser page route (user decision 2026-11-21)

- The webServer-mounted HTML page (`GET /zctx-ui`, `src/ui/page.ts`) is gone:
  the desktop webview origin is the custom `dsh-app://` scheme, which no
  browser can open, so a browser-facing page was structurally unreachable and
  the copy-address flow was meaningless. The webServer now serves API routes
  ONLY (snapshot / config GET+POST / stats); the page's token injection and
  the `UI_TOKEN_PLACEHOLDER` surface are deleted, and neither the summary
  card nor the no-React fallback renders any link to the removed page.

## [0.3.0] - 2026-11-16

The autoFold release: server-initiated folding arrives as an explicit opt-in
face, together with the base-context patch-set wave (**P6-B** patcher v0.2 +
**P6-C** plugin companion — documented below under this version because the
0.2.2 section was never tagged; its content ships in 0.3.0), the headless
benchmark waves (**P6-D** baseline matrix + **P6-D2** face-diagnosis verdict +
**P6-F** replication arms), and the P6-D2E review recommendations (R1-R5).
Waves and authorities: plan `reports/plans/ZCTX-v03-patch-plan.md`,
implementation spec `RES-port-feasibility.md`, benchmark authority
`zDSH-docs/R&D/zctx-20261112/REPORT-GO-NO-GO.md` §10, measurements
`reports/bench/BENCH-report.md` (§11 verdict, §12 P6-E pilot, §13 P6-F
replication). Terminal battery: **592/592** vitest, `tsc --noEmit` zero
errors, five repo probes green; headless bench: two fresh 20-round autofold
arms each committed exactly one real server-initiated fold with
**0 model tool calls** (f290 5195→619 net −4576; f340 5739→638 net −5101).

### Added (v0.3.0)

- **autoFold engine** (`src/autofold.ts`, P6-E): the server-initiated folding
  chain — V4 trigger judgment REUSED from the preflight projection
  (`projectAndEstimateRequest`, same trigger line, same margin), conservative
  span selection inside the validator's own reachability domain (protected
  head/tail/user pins, tool-call pairing, pair-safe boundaries,
  `maxFoldFraction` cap, `minFoldableTokens` floor, oldest-first, batch cap),
  three summary supplies (`compaction` = the official one-shot
  `ctx.llm.stream({purpose:'compaction'})` channel, purpose-marked so all
  three listeners and the session log are blind to it — recursion structurally
  excluded; `external` = one bounded POST with Bearer-via-envName indirection;
  `digest` = deterministic CPU-only fallback), the degradation chain
  (transient retries → pair-safe halving → digest → dead-probe sticky with one
  canary per run), commit through the SAME `fold()` engine with fresh-surface
  re-verification, fail-open after the chain, and the anti-feedback-loop nudge
  baseline reset on committing runs. Budgets are data-ified config
  (`autofold.maxRounds` 16 / `autofold.maxBatch` 4 /
  `autofold.maxSummaryOutputTokens` 32768).
- **autoFold face wiring** (P6-E): `wireAutoFoldFace` registers the innermost
  third `llm/stream` waterfall listener behind `autofold.enabled` (default
  **false**, explicit opt-in in v0.3.0); loud gates (illegal summarizer /
  external with empty url/model → fail-skip with a warn, never a silent
  supply fallback; enforce precedence warn); `zctx_status` gains segment 8
  (armed/idle view, run counters, last-run outcome, dead-probe verdict).
- **Measured reality, honestly** (`reports/bench/BENCH-report.md` §11-§13):
  the model-adoption face is real — a free-flash route model with tools,
  guidance, and nudge on the wire made 0 spontaneous fold calls in 60
  pressure rounds; the server-initiated route does not depend on it. P6-E
  pilot f297 (5471→864, net −4607) replicated twice by P6-F (f290, f340),
  each arm one fold, −88% magnitude, trigger conservative (32 HITs, 32
  honest no-qualified-span no-ops, 1 commit in the instrumented arm). Known
  ceiling: one fold per monotonic epoch (the committed fold collapses the
  reachable span below the floor — checkpoint-aligned absorption windows are
  the v0.4 lever, declared in §12.3/§13, not a silent gap).
- **patcher v0.2 multi-file machinery** (`patcher/zctx-patch.mjs`, P6-B): the
  anchor set becomes the ordered five-file patch set (`zctx-v0.3-base-1`) —
  llm-pi-ai (P4 stub + config `guardObserve` default TRUE per the user
  ignition ruling + adapter guardSink + hash-then-passthrough fetch wrapper +
  the inlined observation cluster), agent-loop (GuardObserver + chain
  classifier, self-contained; ignition hunk at the agent constructor with
  explicit opt-out honored), session (`cache/guard-observe` persistence
  vocabulary), compaction-basic (L3 per-result budget) and
  compaction-tool-result-pruner (the `l3.pruning` declaration branch +
  `limitFor`). One asar write applies the whole set (multi-target splice) —
  no partial multi-file state can persist; per-file three-state gates
  (pristine / patched-exact by op-list reconstruction / drifted), the v0.2
  marker carries per-file `files[]` hashes, and `status` reports the
  per-file face + the `patchSet` aggregate (patched / unpatched / partial /
  drifted). All pristine hashes were computed live from the real rc.3 asar
  (read-only positional extraction; llm-pi-ai double-attests the P4 pin).
- **guard-observe bridge** (`src/guard-observe-bridge.ts`, P6-C): the plugin's
  log-only consumer of the patched chain's `cache/guard-observe` session
  events — per-session process-memory summaries (total / segmented /
  degraded / unclassified / providers / last record facts), fail-soft into
  the firehose, forgotten on session disposal; config switch
  `patch.guardObserveEvents` (default true; inert by construction when the
  patch is absent).
- **zctx_status patch-set face** (P6-C): segment 7 renders the patch-set
  identity and patched-file count from the v0.2 marker (v0.1 markers stay
  readable) plus the guard-observe record counters for the current session.
- **Env-gated diagnostics** (`src/debug.ts`, P6-D2): `ZCTX_DEBUG=1` writes
  plugin face decisions to stderr directly (default zero output) — the
  diagnostics that made the headless face-verdict mechanical.

### Fixed (v0.3.0)

- **P6D2E-R3**: a configured `autofold.external.apiKeyEnv` whose environment
  variable is missing/empty now warns LOUDLY at wire time (the face stays
  armed — missing credentials are a degradation-chain condition, not a skip);
  the remote 401 is no longer the only signal.
- **P6D2E-R4a**: the halving classifier no longer matches a copied texts
  substring — `REASON_NO_NET_SHRINK_SIGNATURE` is exported and derived from
  the template itself (a wording edit cannot silently downgrade halving to
  abort); pinned for containment + cross-template uniqueness.
- **P6D2E-R2/R4b/R5**: the f297 offline replay script is archived
  (`reports/bench/harness/replay-f297.mjs`, rerun reproduces the runtime
  selection verbatim); the archived pre-fix `switch-group.mjs` carries an
  explicit evidence header with the live fixed script's location; progress
  wording now points at the real ledger carrier.
- **BENCH-L1** (P6-D2 verdict): the headless "faces not effective" finding
  was the bench profile's own disabled-by-config residue + two harness
  verification defects — after the fix, tools/guidance/nudge are all
  verified on the wire (BENCH-report §11; the plugin itself needed no
  behavioral change beyond the diagnostics).

## [0.2.1] - 2026-11-14

Hardening release with no new features. Two waves: **P0** (the real-device
boot failure found in v0.2.1 verification) and **P3** (the full-repository
audit wave). The audit authority lives in-repo: `reports/audits/REPORT-FULL-AUDIT.md`
(the frozen fix list §5 + the disposition receipt §8) with its four domain
audits (`AUD-architecture.md`, `AUD-state-machines.md`, `AUD-host-faces.md`,
`AUD-verification-replay.md`). Terminal battery: 472/472 vitest (429 baseline
+ 43 new pins, incl. the P3-r1 review-round same-source pin),
`tsc --noEmit` zero errors, five repo probes green, and the
four audit E-replay scripts re-run post-fix (SM-01/SM-02/HF-02 exit 1 =
NO-REPRO; HF-01 exit 0 = option (a) intentionally keeps the mechanism — its
acceptance is the contract downgrade + `imageCount`, recorded in three
consistent places, never reported as a fake NO-REPRO).

### Fixed (v0.2.1)

- **P0 — real-device boot failure** (`cannot get property "tokenMeter"
  without inject`): the plugin read `ctx` services without declaring
  `static inject`, and the real cordis get-trap only resolves inject-declared
  keys across sibling plugin fibers — so the plugin never constructed on a
  real device while every plain-object mock passed. `static inject` now
  declares the consumed services (five keys after HF-02 below; a wrong key is
  a silent PENDING, so the declared set is read-verified against real `ctx`
  access), the mock host enforces the same get-trap semantics (mocks can no
  longer pass where the device fails), and `scripts/probe-real-mount.mjs`
  mounts the BUILT `lib/index.js` into a real vendored cordis container (G1
  reachability, G2 device-failure negative control, G3 real mount crossing
  every boot-time access point, G4 adapter face with a providers declaration).
- **SM-01 — fold-store `applyEvent` idempotency/monotonicity guards** (audit
  E-replay 5/5: fold revival, compaction-bracket reopen, count inflation,
  cascade replay, monotonicity break): duplicate deliveries (`seq <= lastSeq`
  with an already-seen seq) return early; an unseen lower seq records an
  anomaly instead of replaying; the legal first-delivery form
  (`seq == lastSeq`) is preserved. `store.spec.ts:289` was a mislabeled test
  that actually delivered once — rewritten as a true duplicate-delivery pin
  (listener wired, the same event object redelivered, three no-regression
  assertions); removal-check verified: dropping the guard turns exactly the
  7 dependent pins red.
- **SM-02 — checkpoint amount validation + status fail-soft** (E-replay 4/4:
  ±Infinity/NaN/negative flowed into the breakeven math and `zctx_status`
  threw irrecoverably on a poisoned log): `extractCheckpointSource` uses
  `Number.isFinite` + non-negative (twin-aligned with `extractUsageRecord`),
  poisoned amounts drop into `droppedAmounts` anomalies, and the status
  render wraps the observability segment in a fail-soft guard (the honest
  withheld line instead of a throw; a control-group strong row does not
  regress).
- **HF-01 — image-gate contract downgraded to a defensive mirror + wire
  `imageCount`** (E-replay 7/7; option (a) of the audit's three-way choice,
  ruling recorded in the P3 checkpoint): the official runtime projects images
  to placeholder text BEFORE the adapter is dispatched
  (`inputModalities: ['text']`), so the refusal gate is unreachable on the
  official path — a routed image request completes with the model seeing
  placeholder text and no failure signal. The gate stays as the honest
  backstop for direct-adapter calls (behavior unchanged, still pinned);
  `WireSnapshot.imageCount` (0 on the official path) makes the boundary
  observable; README/config narrative downgraded accordingly.
- **HF-02 — the declared-but-never-read `sessions` inject key removed** (E
  replay 3/3, causal closure: a wrong key leaves the plugin silently PENDING):
  `static inject` is five keys now; smoke/plugin pins updated;
  probe-real-mount G3 doubles as the real-cordis no-sessions-key activation
  pin.
- **Z19 — the build is chained into the test script** (`"test": "tsdown &&
  vitest run"`, `&&` fail-fast): tests that import `lib/index.js` can no
  longer pin a stale artifact — the build now runs FIRST by script, not by
  human discipline (a pretest hook was rejected: pnpm does not run pre/post
  scripts by default).

### Reinforced (v0.2.1 — audit §5.2, 16 items; 15 fixed + 1 co-fixed with SM-01)

- **R1/SM-03** — `scanUpTo` consecutive-unreadable breaker (bounded,
  fail-soft with an anomaly trail).
- **R2/SM-04** — resume/series cross-window strong attribution pinned with a
  decision note (spec-frozen semantics; pins, not behavior change).
- **R3/SM-05** — validator-config domain clamp at the single funnel
  (non-negative token fields, `0 < maxFoldFraction ≤ 1`, summary floor ≤
  ceiling (inverted values swapped), `netShrinkTolerance ≥ 1`).
- **R4/SM-06** — unfold-span defensive demotion + unknown-foldId anomaly
  (a weakened defense can no longer leave phantom active folds).
- **R5/SM-12** — non-finite `contextWindow` normalized at the validateFold
  entry (the engine gate skips honestly instead of judging NaN).
- **R6/HF-03** — no-hot-reload declaration (the adapter rides the host llm
  fiber; provider/config changes take effect after a host restart).
- **R7/HF-04** — four-tool/command fail-soft containment (`== null` session
  checks, `TOOL_EXECUTION_FAILED` wrapper text, /zctx top-level try).
- **R8/HF-05** — outer session/event handler guard (malformed payloads feed
  nothing and log no uncaught noise).
- **R9/HF-06** — preflight enforce host-interaction facts documented (one
  `maxOverflowRetries` budget per short-circuit; keep
  `CONTEXT_WINDOW_EXCEEDED` out of `retryableCodes` on zctx sessions).
- **R10/HF-07** — map-twins parity divergence documented (undefined usage:
  twins return zero vs the official throw — the more lenient path, guarded
  downstream).
- **R11/HF-08** — non-array `messages` classified `INVALID_REQUEST`, not
  `UNKNOWN`.
- **R12/HF-13** — `buildPiAiFace` degrades to undefined instead of throwing
  (a missing `isContextOverflow` is the face-absent path).
- **R13/HF-15** — per-face register containment (absence AND refusal both
  degrade to warn-and-skip; the plugin still loads).
- **R14** — seq guard, co-fixed with SM-01 (not independently closed).
- **R15** — export hygiene: the `GUIDANCE_TITLE` orphan alias deleted, 12
  file-local types narrowed; the lib export surface pinned at 126 items.
- **R16** — `configDefaults` deep-frozen (no shared mutable `providers`
  array instance).

### Blind-spot pins (v0.2.1 — audit §5.3, 9 items; pins/probes only)

- **T1** — true duplicate/out-of-order delivery (merged into SM-01's pins).
- **T2** — the eight compaction-bracket shapes, pinned shape by shape.
- **T3** — resume/series attribution-quality decision pins (merged into
  SM-04/R2).
- **T4** — non-finite tokensBefore/After ingestion rejection (merged into
  SM-02's pins).
- **T5** — unfold re-expansion of an absorbed inner checkpoint renders
  `[user]` + summary text, never the marker or the raw content.
- **T6** — boot-timing probe report (`reports/probes/P3-T6-boot-timing.md`):
  lazy watching is NOT needed — a restored session announces inside its first
  run's publish protocol, before any llm activity (evidence anchor corrected
  to `core/session/src/index.ts:596-620 fromRestore` in the P3-r1 review
  round); live install measurement stays with the W5-A6-INSTALL ledger item.
- **T7** — `zctx_status` adapter health segment (routes + mapping source +
  registration settled state).
- **T8** — an illegal `preflightMode` value warns once and falls back to
  observe.
- **T9** — reasoning-effort value-domain gate at construction + violation
  hygiene (an illegal level never echoes into the offered specs).


### P4 — external app.asar patch face (same release, 2026-11-14)

The external patcher for the official DSH desktop (plan §3 补丁连接设计):
one-line defensive forwarding stub inserted into the OFFICIAL PiAiAdapter
options construction (after the profileOptions spread, BEFORE the official
explicit headers/signal keys — the stub can never clobber them; zero body
rewrite, R1). The plugin arms the receiving side at startup
(`globalThis.__zctxPatch__.wireOptions`, patch-bridge.ts) so OFFICIAL-route
requests ride the same per-session wire ledger; patch absent = stock
request byte-identical (automatic degradation). Tool: `patcher/zctx-patch.mjs`
(`patch`/`restore`/`status`; version gate + anchor-hash gate against the
real rc.3 lib SHA-256 + anchor-uniqueness asserts + backup-first sibling
`zctx-backup/<ts>/` with RESTORE.md + surgical single-file asar splice +
official-API post-verify + marker file; idempotent; anchor drift refuses).
`zctx_status` gains the patch segment (marker + mount, dual source).
Real-machine execution is deferred under W5-A6-INSTALL (post-merge);
everything above is fixture-verified (`tests/patcher.spec.ts`,
`tests/patch-bridge.spec.ts`). Terminal battery: 502/502 vitest (472 + 30),
`tsc --noEmit` zero errors, five repo probes green
(verify-activation-surface 11/11 with the new A11 patcher-face group).

## [0.2.0] - 2026-11-13

### Added (v0.2.0)

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
  `cleanSampleFloor=0.6`, `observe.enabled=true`, `observe.attemptCapture=false`,
  and the structured `providers` section (below).

### S2 zctx router (V5, RES-adapter-route §11b S2 — the thin adapter face)

- **Custom providers under the official configurable-provider surface**: each
  declared provider becomes the route `zctx-<family>` where **`family` IS the
  wire protocol name** taken from the official `supportedProtocols()` union
  (`openai-completions` | `openai-responses` | `anthropic-messages`, loaded
  dynamically from the host lib with a labeled builtin fallback) — zero
  invented protocol mapping; an unknown family is a construction-time
  violation carrying the complete violation list.
- **Parasitic pi-ai transport stack** (1.0.2, R8 anchor): stream chunks map
  through the official llm-pi-ai implementations when their sources resolve,
  through labeled self-replicated twins otherwise (provenance recorded on
  every surface); two-path error delivery (thrown harness errors classified
  through the official taxonomy incl. undici special cases; in-band stream
  errors become `finish{kind:'error'}` chunks); `usage` strictly before
  `finish`; R4 honored (`maxRetries: 0` — the agent recovery layer owns
  retries); R7 honored (attribution headers ride EVERY request, one-shots
  included, attribution wins case-insensitively); R1 honored (the adapter
  never rewrites a request body — zero body mutation on the wire).
- **Wire-domain ledger**: zctx-routed sessions additionally record byte-level
  request hashes (`domain: 'wire'`) through two pass-through observation
  points (an `onPayload` view that returns `undefined` constantly, and a
  hashing wrapper around `fetch` that touches nothing). The dual-domain
  ledger is honest about coverage: harness-domain rows cover every session;
  wire-domain rows exist only where the zctx router actually drove the wire.
- **Cache knobs**: `cacheRetention` (`'none' | 'short' | 'long'`) passes
  through to pi-ai's StreamOptions (pi-ai owns the precedence: explicit >
  env > default `'short'`; `'none'` disables cache markers); `cacheControlFormat`
  (`'anthropic'`, the only legal value per the official GATE union) materializes
  into the model compat — ONLY meaningful on the `openai-completions` family;
  anywhere else it is refused at construction (dead config is dishonest config).
- **Minimal directory registration** (`registerConfigurableProviders`): the
  Models page mounts the `dsh-zcontext` namespace and shows each route's row
  + credential badge + error field. Honest ceiling (U1 probe): page EDITING is
  not available for a third-party settings namespace — the configuration
  authority is the handwritten profile overlay patch; the page is
  visibility-only.
- **Text-only**: no image/file content rides the wire on a zctx route — the
  official runtime projects image blocks to placeholder text BEFORE the
  adapter is dispatched (`inputModalities: ['text']`). The adapter's own
  `UNSUPPORTED_CONTENT` gate is a defensive mirror for direct-adapter calls
  (the three image-budget knobs are deliberately NOT accepted — dead knobs
  are dishonest config; `IMAGE_OFFLOAD_REQUIRED` is unreachable by
  construction). Narrative amended in 0.2.1: the original "refused before
  conversion" wording described a gate the official path never reaches (P3
  HF-01); every wire-ledger row carries `imageCount` pinning what reached the
  adapter boundary.
- **Config shape**: the structured `providers[]` settings section (schemastery
  nested objects, volatile — the load-bearing anchor that makes the Models
  page mount the namespace at all). Defaults to an empty declaration list
  (zero routes = the adapter face stays a legal keep-alive). Each model
  declares `id`, `contextWindow` (REQUIRED positive integer,
  INVALID_MODEL_CONTEXT semantics) and `maxTokens` (REQUIRED positive integer,
  official catalog.ts:934-936 semantics — a missing value is a construction
  violation, never an invented default). Declared routes never mutate the
  official ones: a route collision with an existing adapter keeps the old
  route and logs (official DUPLICATE precedent).

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

### Honest ceilings and calibration debt (v0.2.0, declared not hidden)

- **Estimator thresholds are UNCALIBRATED**: `attributionTimeWindowMs=90000`,
  `cleanSampleFloor=0.6`, and `preflightMarginRatio=0.9` are designed-in
  defaults awaiting real-machine calibration (`zctx_status` renders the
  calibration statistics that will justify adjusting them). The chars/3
  estimator's underestimate risk on dense CJK is the known hazard.
- **The wire-domain ledger covers ONLY zctx-routed sessions**: harness-domain
  rows exist for every session the plugin watches; wire-domain byte hashes
  exist only where the S2 router actually drove the request. Coverage is
  labeled per row (`domain`), never inferred.
- **Object-level prefix hashes are blind to the pi-ai domain**: the
  harness-domain normalized hashes see harness events only — whatever pi-ai
  or the transport stack does below the harness boundary (serialization,
  provider-specific framing) is invisible to them. The wire-domain byte
  hashes see the real bytes, but only for zctx-routed sessions (previous
  bullet). This is the honest ceiling of v0.2.0's observability, not a
  defect to be silently papered over.

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
