# 评审报告 — SCHED-20261119（计划任务频率可配置，默认 DAILY）

- 评审人：reviewer-sched（独立 reviewer，≠ 作者 coder）
- 作者：coder
- 审查范围：`281abe2..HEAD(073225c)` 两提交（`cc2d22d` 实现、`073225c` checkpoint STEP-0016）
- 工作树：`G:\000Github\zDSH\zDSH-plugins\dsh-zcontext`（main，HEAD=073225c0617f133e48d547d35b52ca61bc3f61f7）
- 时间：2026-11-19（评审时实测）
- 真机面（主线负责用新代码重建计划任务）不审、不碰。

## 结论

**PASS（98/100，≥98 放行，仅允许中间合入）**。七项必核全部通过；无 `[阻断]`；1 条 `[建议]`（顶层 README 文档漂移，不阻塞中间合入，但阻塞最终验收）。对抗性追加核查（CLI `undefined` 透传默认臂、任意频率透传、schtasks 注入面、全仓 HOURLY 残留扫描、checkpoint 哈希链复算）均已亲跑亲算。

---

## 必核项逐项结论（命令 + 证据）

### 1. `git diff 281abe2..HEAD` 全读 + R1 SUPPORTED 段字节不变式 — PASS

- `git diff --stat 281abe2..HEAD`：7 文件、67 insertions / 18 deletions，全部为预期面：`patcher/README.md`、`patcher/zctx-patch.d.mts`、`patcher/zctx-patch.mjs`、`tests/patcher-auto.spec.ts`、`checkpoint-history.jsonl`、`checkpoint.json`、`progress.md`。无对 `SUPPORTED` 数据体、锚串、`pristineSha256`、`presenceMarker` 的改动，无顺手改动。
- R1 独立复算（按 `patcher/README.md:355-365` 钉死口径：从 **git 对象**读，自 `export const SUPPORTED = {` 行起至其后第一个列 0 的 `// ----` 分隔行止，含前缀、不 trim）：
  - HEAD：`start=716 / sep=976`，`chars=14889`、`bytes=14926`、`sha256=8e2d0b7effb1b9af0151b2e2aa8b408eb67b5d58c180e29df3c8730ac059b0f9`。
  - 基线 `281abe2`：同值（sha 同上 / bytes 14926 / chars 14889）。
  - 三项与 README 钉死值精确一致，且 HEAD==BASE → R1 不变式成立，无锚集漂移。

### 2. `pnpm test` + `npx tsc --noEmit` — PASS

- `pnpm test`：exit 0，**Test Files 31 passed (31)，Tests 675 passed (675)**，Duration 2.72s（transform 4.97s / import 6.31s）。与 progress STEP-0016 自述「31 files 675/675」一致（较 AUTOLOG 块 673 +2 臂）。
- `npx tsc --noEmit`：exit 0（TSC_EXIT=0），无类型错误。

### 3. 默认 DAILY 臂 + 显式 HOURLY 臂 — PASS

- 测试层（`tests/patcher-auto.spec.ts:530,543`）真实断言：
  - `install: default schedule is DAILY (no --schedule / no injection)`：注入 fake runner，断言 `/Create` 调用含 `DAILY`，且 `create` 步 detail 含 `/SC DAILY`。
  - `install: explicit schedule:HOURLY ...`：传 `schedule:'HOURLY'`，断言完整调用序列 `['/Query', '/TN', TASK_NAME, '/SC', 'HOURLY', '/TR', action, '/F']`，且 detail 含 `/SC HOURLY`。
  - 既有 `query→create→verify` 臂的 `calls` 断言亦由 HOURLY 改为 DAILY（`:520` 起）。
- 行为层（本评审人 node 实测，直接 import `patcher/zctx-patch.mjs`，注入 fake runner，platform='win32'，未触碰真机 schtasks）：
  - `schedule: undefined`（模拟 CLI 未传 `--schedule`）→ `/SC DAILY`，ok=true，detail 含 `/SC DAILY`（解构默认生效）。
  - 不传 schedule 键 → `/SC DAILY`。
  - `schedule:'HOURLY'` → `/SC HOURLY`，detail 含 `/SC HOURLY`。
  - 对抗追加：`schedule:'WEEKLY'` → `/SC WEEKLY`（可配置，非白名单硬编码）。

### 4. CLI 面 — PASS

- `VALUE_OPTIONS`（`zctx-patch.mjs:3921`）含 `--schedule`。
- usage 字符串两处（`:3960` 解析失败分支、`:3965` 非法命令分支）均含 `[--schedule DAILY|HOURLY]`；本评审人以 `node patcher/zctx-patch.mjs __bogus__` 实测 stderr 命中该片段。
- 透传：`:3972` `installScheduledTask({ scriptPath: args.script, logFile: args.log_file, schedule: args.schedule })`；未传时 `args.schedule === undefined` → 解构默认 DAILY（行为层实测已确认，见项 3）。

### 5. README / d.mts 与代码一致 — PASS

- `patcher/README.md:63` usage 增 `[--schedule DAILY|HOURLY]`；`:144-152` install-task 节：`/SC HOURLY` 改为 `/SC DAILY`，并说明「频率默认每天一次（DAILY）」「传 `--schedule HOURLY` 可恢复每小时」「`/SC` 接受 DAILY/HOURLY 等频率值」「不传即 DAILY、detail 随 `/SC` 同步」——与实现一致。
- `patcher/zctx-patch.d.mts:388-389` 新增 `schedule?: string` 及文档注释（default 'DAILY'）。
- 顶层 `README.md:201` / `README.zh.md:201` 仍称 auto 为「hourly / 每小时」状态机 —— 见下方 `[建议]`（非本次 diff 文件，非功能缺陷）。

### 6. 工作树跑后干净（Z3 还原） — PASS

- 测试+tsc 后 `git status --porcelain` 出现 ` M lib/index.js`。
- 诊断：`git hash-object lib/index.js` = `376fba66d9118a3c83e111491bf288826c58f1a2`，与 `git rev-parse HEAD:lib/index.js` 完全相同；工作树与 HEAD blob 字节数均 357355、CR=0，剥 CRLF 后相等 → 纯 `core.autocrlf=true` 行尾 churn，无语义改动。
- 按 Z3 执行 `git checkout -- lib/`，再查 `git status --porcelain` 无输出 → 工作树干净。全程未触碰 `del/`、业务代码、真机面。

### 7. checkpoint STEP-0016 链 VALID — PASS

- 反向工程出哈希口径（无现成校验脚本）：`hash = sha256(json.dumps(record_without_hash, ensure_ascii=False, separators=(',',':'), 保留原始键序))`，对 step1 (`prev_hash=""`) 验证成立。
- 复算 `checkpoint-history.jsonl` 全部 16 条：每条 hash 重算一致、`prev_hash` 与前一条 hash 逐环链接一致，**全链 VALID**（含历史既有 step=4 重复条目，其 prev 链接亦正确）。
- `checkpoint.json`（step16）与 history 末条 STEP-0016 逐字段（schema/task/step/block/status/ts/artifacts/next/prev_hash/hash）完全一致；重算 hash=`7b547991495967d8ad8723a616b97d9478339bae1eee96355a849365af13d1de` 与记录一致。

---

## 对抗性追加核查（均通过）

- **注入面**：`runSchtasksDefault`（`:3756`）用 `spawnSync('schtasks', args, {encoding:'utf8'})`，`schedule` 作为 argv 数组的独立元素传入，无 shell → 无命令注入风险（快筛通过）。
- **全仓 HOURLY 残留**：`git grep` 确认生产调用点无写死 HOURLY；仅剩描述性注释（`:55/:3469` auto 设计描述符、`:2977/:3858` 超时/互斥的设计假设断言），逻辑本身 cadence-agnostic，不影响正确性。
- **测试计数闭环**：673（AUTOLOG）→ 675（本块）恰为 +2 新臂，无夹带。

---

## 发现清单

### [阻断]
无。

### [建议]（不阻塞中间合入，阻塞最终验收）

- **S-1 — 顶层文档/注释「hourly」漂移**
  - 位置：`README.md:201`、`README.zh.md:201`（"auto is an hourly state machine" / "auto 是每小时状态机"）；次级：`patcher/zctx-patch.mjs:55, :3469, :3858, :2977` 的 "hourly" 描述性注释。
  - 问题：默认频率已由 HOURLY 改为 DAILY，顶层 README 仍称自愈「每小时」，用户/maintainer 会误以为默认每小时运行。
  - 理由：非功能缺陷（`/SC` 频率由 `patcher/README.md` 权威记载且已正确同步），不影响代码正确性；但属文档一致性漂移，与「README 与代码一致」的验收精神相关。
  - 修复建议：将两处顶层 README 的 "hourly/每小时" 改为「可配置频率，默认每天一次（DAILY）；可用 `--schedule HOURLY` 改回每小时」；代码注释按需要同步。或由用户显式批准 `user_approved_deferred`（标注为「auto 设计描述符，非计划任务频率」）。
  - disposition：`open`（已提出，待主线在 closure 台账中 `fixed` 或 `user_approved_deferred`；在此之前最终验收未完成，但中间合入放行）。

---

## 残留

- 功能残留：无。七项必核 + 对抗追加全通过。
- 非功能残留：S-1（见上，[建议] 级，需最终验收前处置）。
- 真机计划任务重建：主线负责，本评审未审未碰（not_applicable，非缺口）。
