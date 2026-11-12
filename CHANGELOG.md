# Changelog

All notable changes to `dsh-zcontext` are documented in this file.
Format follows [Keep a Changelog](https://keepachangelog.com); versioning follows SemVer.

## [0.1.0] - 2026-11-12

### Added

- Minimal buildable plugin skeleton (W1): `package.json` with the `dsh.bundle.patch`
  manifest (`manifestVersion: 1`), `cordis.patch.yml` Loader row
  (`- insert: [{ id: dsh-zcontext, name: dsh-zcontext }]`), tsdown ESM+dts+sourcemap
  build into the committed `lib/` artifact, and a vitest smoke probe importing the
  built output.
- `ZcontextPlugin` class skeleton: static `inject: []`, static `Config` schema with
  the frozen plan §3 primitive fields and defaults
  (`enabled=true`, `nudgeThresholds="25,50,75,90"`, `keepRecentTokens=0`,
  `maxFoldFraction=0.6`, `minFoldableTokens=5000`, `protectionFloorTokens=5000`,
  `summaryFloorChars=50`, `summaryCeilingChars=20000`, `netShrinkTolerance=1.05`),
  schemastery resolved lazily with a fail-soft built-in validator fallback, and a
  constructor that stores the host context plus the config with defaults applied.

### Limitations

- **PTC direct invocation is restricted**: in `ptc` mode the official harness
  rejects direct model calls to `zctx_*` tools as UNKNOWN_TOOL; use the `run_code`
  sub-dispatch form there. Native tool mode is the first-class path in v1.
- **No wire-level fallback**: folding rides the official surface replace channel
  only; when that channel is unavailable the plugin does not degrade to wire-level
  session rewriting.
- **Tool adoption depends on the model**: folding happens when the model follows
  the guidance section and nudges; the official compaction-basic remains the
  unconditional hard floor and is never disabled by this plugin.
