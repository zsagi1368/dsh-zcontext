# Contributing to dsh-zcontext

Thanks for wanting to help. This document is deliberately strict in a few
places — the strictness exists because each rule below was paid for by a real
bug in this repository (the lessons are recorded in
[`ZDSH-LESSONS.md`](https://github.com/zsagi1368/zDSH/blob/main/ZDSH-LESSONS.md),
referenced here as `Z<n>`).

Read this page once before your first PR. It is short.

## 1. Clean room — the one rule that overrides convenience

This is a re-implementation of a published mechanism, not a port of any code.

- **Every line of code, every prompt, every model-facing string is original
  writing.** Nothing is copied from
  [billion-context](https://github.com/ranxianglei/billion-context), from the
  official DeepSeek Harness sources, or from any other plugin — not the code,
  not the guidance text, not the tool descriptions, not "just the phrasing".
- Reading upstream material for *understanding* is fine. Copying it is not.
  If you studied an upstream file and then wrote something structurally
  similar, say so in the PR body; reviewers will ask.
- The plugin's own README statements about clean-room originality are part of
  the contract. A PR that violates this rule is closed, not amended.

## 2. No-go list (red lines R1–R8)

These are design constraints frozen in `reports/plans/ZCTX-v02-plan.md` §2. A
PR that crosses one is out of scope by definition, regardless of how well it
is written.

| Rule | Constraint |
|---|---|
| **R1** | The adapter layer never rewrites a request body. It observes and annotates only. Folding happens on the session surface. |
| **R2** | `preflightMode` defaults to `observe`. `enforce` is explicit opt-in only. |
| **R3** | No self-call of `ctx.llm.stream` inside an adapter or a stream listener (infinite recursion). |
| **R4** | The SDK adapter runs with `maxRetries: 0`; retry logic belongs to the agent recovery layer, exclusively. |
| **R5** | Custom provider names are namespaced `zctx-<family>`. |
| **R6** | HTTP (SSE) transports only. WebSocket is outside the boundary. |
| **R7** | `attributionHeaders()` must reach the wire on every attributed request. |
| **R8** | pi-ai version pinning is a prerequisite: cross-check the version before upgrading the adapter face. |

One more, asserted by a probe rather than by prose: **S8 — none of the four
tools declares `isConcurrencySafe`.** Folding is an exclusive barrier; adding
that key breaks the guarantee silently. `scripts/verify-activation-surface.mjs`
will fail if you do.

## 3. Setup

Requirements: Node.js >= 22.13 and pnpm 11.

```sh
pnpm install
pnpm build          # tsdown → lib/  (committed artifact — see §5)
pnpm lint           # tsc --noEmit
pnpm test           # tsdown && vitest run
```

### Command order is not arbitrary

- **`tsc` before `vitest` (Z15).** Vitest runs on a transpiler that erases
  types; a broken import path or a type that failed to resolve can still run
  green under vitest while `tsc` reports it. When you add a test helper or a
  new directory of imports, type-check first — a green test run does not prove
  the types close.
- **`build` before `test` (Z19).** Several specs import the *built*
  `lib/index.js`, not `src/`. If the artifact is stale, those specs pin the old
  artifact and pass against code you did not touch. `npm test` chains `tsdown`
  first for exactly this reason; do not run `npx vitest run` alone and call it
  verification.

### Probes

```sh
node scripts/probe-artifact.mjs             # built-artifact probe groups
node scripts/verify-activation-surface.mjs  # activation-surface assertions
node scripts/probe-host-imports.mjs         # host export reachability
node scripts/smoke-real-loader.mjs          # real-loader smoke
node scripts/probe-real-mount.mjs           # real cordis mount
```

The last three need a checkout of the harness tree (`zDSH-main`). Without it
they print `SKIP` with a reason and exit 0. **A SKIP is not a pass** — in the
PR body, report it as a SKIP and say why.

## 4. Editing rules paid for in blood

- **Long content goes through an editor, never a heredoc (Z23, A14/A25).** When
  writing files with escape sequences, CJK text, or more than a couple of
  kilobytes, use a proper file-write tool. Shell heredocs silently truncate and
  silently reinterpret `\n`; both failure modes have produced broken source
  files in this repository's history.
- **Every source change ships with its rebuilt artifact (§5).**
- **Do not "clean up" line endings.** The repository is LF. A `git checkout`
  on a machine with `core.autocrlf=true` rewrites the working copy to CRLF, and
  sourcemaps embed the working-copy bytes — a no-op rebuild then shows a fake
  artifact diff (Z22). If an artifact diff cannot be traced to a source diff,
  check line endings before anything else.
- **A test that "just went green" after a build is suspect (Z19).** Confirm it
  was not green against a stale artifact.

## 5. The committed artifact

`lib/` is committed on purpose. Git-form installs (`dsh plugin add
github:...`) never run a build step, so the pinned tree must already contain
the built plugin (Z3). Consequently:

- Any PR touching `src/` must include the rebuilt `lib/` **in the same
  commit**.
- The artifact diff must be attributable to the source diff. If you cannot
  explain a byte difference, treat it as a bug.
- Never add `prepare`, `preinstall`, `postinstall`, or `install` scripts. The
  package must stay installable without build approvals (Z4).

## 6. Commit messages

```
<type>(ZCTX): <short imperative summary>
```

`type` is one of `feat`, `fix`, `docs`, `test`, `chore`, `refactor`, `perf`.
Keep the subject under ~72 characters, no trailing period. Examples from this
repository's history:

```
docs(ZCTX): P5 community standards
fix(ZCTX): P0 inject keys declared for real-host service access
```

One logical change per commit. Source and its rebuilt `lib/` in the same
commit; tests may ride in the same commit or an adjacent one, but never land
after the code they cover.

## 7. Pull request flow

1. Fork, branch from `main`, keep the branch focused on one change.
2. Run the full battery locally: `npm test`, `npm run lint`, then the probes
   you can run.
3. Fill in `.github/PULL_REQUEST_TEMPLATE.md` completely — including the
   verbatim command output. "All green" without output is not evidence.
4. Open the PR against `main`. CI runs on `windows-latest` with Node 22 and
   pnpm; a red CI run blocks merge.
5. Review is adversarial by design. Expect questions about evidence, not just
   about style. Reviewers here audit claims against command output.

### What reviewers check first

- Whether the artifact diff is attributable to the source diff (§5).
- Whether the new test actually fails without the change.
- Whether any red line in §2 was crossed — including the sub-clauses.
- Whether both READMEs were updated when behavior changed.

## 8. Reporting bugs and asking questions

- Bugs: use the bug-report form (it asks for `zctx_status` output and logs,
  which is usually the difference between a fix and a guess).
- Security: **not** a public issue — see [`SECURITY.md`](SECURITY.md).
- Questions and usage help: open an issue with the `question` label. GitHub
  Discussions is not enabled on this repository, so there is no Discussions
  link to point at.

## 9. License

By contributing you agree that your contribution is licensed under the MIT
License, the same terms as this repository (see [`LICENSE`](LICENSE)).