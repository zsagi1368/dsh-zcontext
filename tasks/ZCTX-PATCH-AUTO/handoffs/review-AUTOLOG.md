# 评审报告 — AUTOLOG-20261119（双写 EBUSY 根治 + autocrlf fixture 误报根治）

- 评审人：reviewer-autolog（独立 reviewer，≠ 作者 coder）
- 作者：coder
- 审查范围：`bf593d3..HEAD(0af0fc7)` 两提交（46e12a5、0af0fc7）
- 工作树：`G:\000Github\zDSH\zDSH-plugins\dsh-zcontext`（main，HEAD=0af0fc7）
- 时间：2026-11-19T01:50:01Z
- 真机面（task action 已由主线 XML 导入止血）不审、不碰。

## 结论

**PASS（100/100，≥98 放行）**。六项必核全部通过，无 `[阻断]`，无残留遗留。对抗性追加核查（CLI 入口默认路径、全仓调用点、d.mts 签名）亦通过。

---

## 必核项逐项结论（命令 + 证据）

### 1. `git diff bf593d3..HEAD` 全读 + R1 SUPPORTED 段字节不变式 — PASS

- `git diff --stat bf593d3..HEAD`：8 文件、93 insertions / 24 deletions，全部为预期面（`.gitattributes`、`patcher/README.md`、`patcher/zctx-patch.d.mts`、`patcher/zctx-patch.mjs`、`checkpoint-history.jsonl`、`checkpoint.json`、`progress.md`、`tests/patcher-auto.spec.ts`）。无对 `SUPPORTED` 数据体、锚串、`pristineSha256`、`presenceMarker` 或内部 sink 写入逻辑的改动。
- R1 独立复算（按 `patcher/README.md:349-365` 钉死口径：从 git 对象读，自 `export const SUPPORTED = {` 行起至其后第一个列 0 的 `// ----` 分隔行止，含前缀、不 trim）：
  - HEAD：sha256=`8e2d0b7effb1b9af0151b2e2aa8b408eb67b5d58c180e29df3c8730ac059b0f9`，bytes=14926，chars=14889。
  - 基线 bf593d3：sha256=`8e2d0b7e…`，bytes=14926，chars=14889（同值）。
  - 三项与 README 钉死值精确一致 → R1 不变式成立，无顺手改动。

### 2. `pnpm test` + `npx tsc --noEmit` + fixture 未改写 — PASS

- `pnpm test`：exit 0，**Test Files 31 passed (31)，Tests 673 passed (673)**，Duration 2.81s。与 progress STEP-0014/0015 自述的「31 files 673/673」一致。
- `npx tsc --noEmit`：exit 0（TSC_EXIT=0）。
- fixture 前后对比（`tasks/ZCTX-PATCH-AUTO/artifacts/nightly-rc5-real.yml`）：
  - 跑前：sha256=`bd30dc2d4000231d5f6cefd3a6cae4d12ced865e95bcdd9af7e052b76ce625d0`，CRLF=0 / LF=13 / 532 bytes。
  - 跑后：sha256=`bd30dc2d4000231d5f6cefd3a6cae4d12ced865e95bcdd9af7e052b76ce625d0`，CRLF=0 / LF=13 / 532 bytes。
  - 字节级未变、未被临时写 LF → `core.autocrlf=true` 环境下 `.gitattributes -text` 修复真实有效，哈希守卫误报根除得到实测证明。

### 3. buildTaskAction 默认路径臂 + README 一致性 — PASS

- node 实测（直接 import `patcher/zctx-patch.mjs`）：
  - `defaultAutoLogPath()` = `…\zctx-patch\auto.log`（内部 sink）
  - `defaultConsoleLogPath()` = `…\zctx-patch\auto.console.log`（shell 兜底）
  - distinct=true，same dir=true，basename 分别 `auto.log` / `auto.console.log`。
  - `buildTaskAction({nodePath,scriptPath})`（未注入 logPath）→ action 含 `>> "…\auto.console.log" 2>&1`、不含 `>> "…\auto.log" 2>&1`。
  - 显式注入 `logPath` 覆盖仍生效（injectable override=true）。
  - `installScheduledTask({nodePath,scriptPath,run})`（未注入 logFile，fake runner 4 响应）→ ok=true，action 目标为 `auto.console.log`，非 `auto.log`。
- README（`patcher/README.md:150-160`）与代码一致：log 默认 `auto.console.log`，与内部 sink `auto.log` 分离，`--log-file` 可覆盖。`patcher/zctx-patch.d.mts` 签名 `logPath?: string`、`defaultConsoleLogPath(): string` 同步到位。
- 对抗性追问「新用户 install 默认是否真分离」：CLI 入口 `installScheduledTask({ scriptPath: args.script, logFile: args.log_file })`（`zctx-patch.mjs:3967`），未传 `--log-file` 时 `args.log_file === undefined` → 触发解构默认 `defaultConsoleLogPath()`，默认分离成立。未真跑 install-task（避免触碰真机 schtasks，超出范围），以静态追值 + 单测臂双重确认。

### 4. `git check-attr text` + `.gitattributes` 单规则 — PASS

- `git check-attr text -- tasks/ZCTX-PATCH-AUTO/artifacts/nightly-rc5-real.yml` → `text: unset`。
- `git check-attr -a` → 仅 `text: unset`，无其他属性残留。
- `.gitattributes` 仅 1 行：`tasks/ZCTX-PATCH-AUTO/artifacts/nightly-rc5-real.yml -text`。无其他规则、无顺手改动。

### 5. 工作树跑后干净（Z3 还原） — PASS

- 测试+tsc 后 `git status --porcelain=v1` 出现 ` M lib/index.js`。
- 诊断：`git diff --numstat lib/index.js` 空，`git diff` 仅 autocrlf warning；工作树 sha 与 HEAD blob sha 均为 `5796190163a36fa59d4b1c65cf47797ec82e2a1d6dc6356d7dc8fdd3d9f2599b`，LF 归一化后语义相等 → 纯 autocrlf 行尾 churn，无实质改动。
- 按任务卡 Z3 授权执行 `git checkout -- lib/`，再 `git status --porcelain=v1` 无输出 → 工作树干净。全程未触碰 `del/`、业务代码、真机面。

### 6. checkpoint STEP-0014/0015 链接 VALID — PASS

- `checkpoint-history.jsonl` 哈希链：
  - step14.prev_hash(`054454d0…`) == step12.hash(`054454d0…`) → True
  - step15.prev_hash(`ecc0da2d…`) == step14.hash(`ecc0da2d…`) → True
- `checkpoint.json`：step=15 一致；hash=`d5551d3e…` == step15.hash；prev_hash=`ecc0da2d…` == step15.prev_hash。
- 附注（不影响本次 PASS）：history 中存在 step=4 重复（历史既有，本次 diff 只追加 14/15，未触及）；按事实纪律记录，非本次引入。

---

## 对抗性追加核查（非必核，主动追问）

- 全仓调用点扫描：`buildTaskAction` / `installScheduledTask` / `defaultConsoleLogPath` / `defaultAutoLogPath` 共 4 处生产调用，均一致（内部 sink 保持 `defaultAutoLogPath`，shell action 走 `defaultConsoleLogPath`）。无遗漏调用点仍写死 `auto.log` 作为 shell 重定向目标。
- `--log-file` CLI 选项仍保留（VALUE_OPTIONS），显式注入语义未破坏；原有幂等/卸载/非 win32 拒绝臂测试未改，673 全绿覆盖。

---

## 发现清单

- `[阻断]`：无。
- `[建议]`：无（必核与对抗核查均通过，无需降级或记账项）。
- 残留遗留：无。真机 task action 面由主线 XML 导入处理，明确不在本审查范围，未审未碰。

## 评分

六维 100 分制，evaluator=reviewer-autolog，author=coder → **100/100 PASS**（详见 `scorecards/AUTOLOG.json`）。
