# Pull request

## What this changes

<!-- One paragraph: the problem, the approach, and what a reviewer should
     look at first. Link the issue it closes, if any. -->

Closes #

## Type

- [ ] Bug fix
- [ ] New capability (tool, setting, output)
- [ ] Documentation only
- [ ] Tooling / CI / repository hygiene
- [ ] Patcher (`patcher/`)

## Checklist

Every box must hold at the moment of submission, not "after review".

### Clean room

- [ ] **Clean-room:** every line of code, every model-facing string, and every
      prompt in this PR is written from scratch for this repository. Nothing is
      copied from billion-context, the official harness sources, or another
      plugin — not even "just the wording".

### Tests

- [ ] `npm test` is green locally (it chains `tsdown && vitest run`, so the
      artifact is rebuilt before the tests that import `lib/` — see `AGENTS.md`
      and the RSI lesson Z19).
- [ ] `npm run lint` (`tsc --noEmit`) reports zero errors.
- [ ] The repository probes still pass: `node scripts/probe-artifact.mjs` and
      `node scripts/verify-activation-surface.mjs` (the three host-dependent
      probes may legitimately SKIP on a machine without the `zDSH-main` tree —
      a SKIP is reported as a SKIP, never as a pass).
- [ ] New behavior has a test that fails without this PR. "Removed the guard
      and the test went red" is the evidence we want in the PR body.

### Committed artifact

- [ ] **`lib/` is rebuilt and committed in the same PR.** `lib/` is a committed
      artifact because git-form installs never run a build (RSI lesson Z3).
      After `npm test`, `git status lib/` must be clean.
- [ ] If this PR changes `src/`, the `lib/` diff is attributable to that source
      change — no unexplained byte diffs. (A pure-whitespace or line-ending
      diff in a rebuilt artifact is a bug in the PR, not in the reviewer.)

### Documentation

- [ ] `CHANGELOG.md` has an entry under the unreleased or current version
      section describing the change in user-visible terms.
- [ ] README (English and Chinese) is updated when behavior, settings, or
      output changes — both files, same PR.
- [ ] `package.json` version is bumped only as part of a release PR, never in a
      feature PR.

### Red lines (these are non-negotiable; a PR that crosses one is closed)

- [ ] **No request-body rewrite.** The adapter layer observes and annotates; it
      never edits the payload sent on the wire (red line R1). Folding happens on
      the session surface, not inside an HTTP request.
- [ ] **No `isConcurrencySafe`.** None of the four tools declares
      `isConcurrencySafe` — folding is an exclusive barrier (red line S8). There
      is a probe assertion for this; do not add the key "to be safe".
- [ ] **No install-time lifecycle scripts.** No `prepare`, `preinstall`,
      `postinstall`, or `install` script in `package.json` — installs must stay
      build-approval free (RSI lesson Z3/Z4).
- [ ] **No new runtime dependency on `@deepseek-ai/*`.** Host surfaces are
      duck-typed and loaded fail-soft; a static import of a harness package
      breaks every install where the host is absent (AGENTS.md).
- [ ] **No secrets, tokens, or personal paths** in code, tests, fixtures, or
      logs.

## Verification output

<!-- Paste the tail of `npm test`, `npm run lint`, and the probe summaries.
     Verbatim output, please — a hand-written "all green" is not evidence. -->

```text
$ npm test
...

$ npm run lint
...

$ node scripts/probe-artifact.mjs
...

$ node scripts/verify-activation-surface.mjs
...
```

## Notes for the reviewer

<!-- Anything a reviewer would otherwise have to guess: tradeoffs taken,
     alternatives rejected, follow-ups intentionally left out of scope. -->