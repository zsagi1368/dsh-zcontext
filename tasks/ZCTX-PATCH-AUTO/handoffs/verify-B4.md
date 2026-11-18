# B4 独立验证报告 — ZCTX-PATCH-AUTO 终验

- 验证人：verifier-B4（独立，非作者；作者=coder B2/B2b/B2c + main）
- 日期：2026-11-18
- 对象：worktree `G:\000Github\zDSH\zDSH-plugins\dsh-zcontext\worktrees\ZCTX-PATCH-AUTO`，分支 feat/ZCTX-PATCH-AUTO，HEAD=8de1bff（验证全程未检出 HEAD 漂移）
- 依据：tasks/ZCTX-PATCH-AUTO/task.json（V1-V14）、reports/plans/ZCTX-PATCH-AUTO-plan.md、handoffs/review-B3.md、scorecards/B3.json、RES-PATCH-DEEPEN.md
- 方法：全部结论均由本验证人独立实测/复算/复跑产生，不采信任何文档自述；真机操作严格限于只读 status 与 auto 无 --yes 巡检（日志为 plan 允许写面）

## 结论：**PASS — 100/100，无证伪项，放行 B5**

---

## 逐项对照表

| # | 原结论/验收 | 验证结论 | 证据（独立重放） | 影响 |
|---|---|---|---|---|
| 1 | V5 全量验证绿零回归 | ✅ CONFIRMED | `pnpm exec tsc --noEmit` → exit 0；`pnpm test`（tsdown→vitest）→ exit 0，**Test Files 31 passed (31)，Tests 665 passed (665)**。跑后 `git status --short` 出现 lib/ 7 文件 churn（构建产物），`git checkout -- lib/` 还原后工作树干净（Z3 纪律） | 无 |
| 2 | V7 R1 红线（SUPPORTED 段恒等） | ✅ CONFIRMED | 按 patcher/README.md「R1 守卫口径」独立复算：`git show` 对象读取，自 `export const SUPPORTED = {` 行起至其后第一个 `// ----------` 分隔行（不含）止。**d951ebf 与 HEAD 均得 chars=14889 / utf8 bytes=14926 / sha256=`8e2d0b7effb1b9af0151b2e2aa8b408eb67b5d58c180e29df3c8730ac059b0f9`**，与钉死值精确一致（复算脚本见附注 A）。边界注记：切片须含末行换行（不含末行换行的变体得 14888/14925/`2612d7df…`，两种口径下 d951ebf 与 HEAD 仍互相恒等） | 无 |
| 3 | V9-V11 锚集架构（外置加载/校验器拒收/未知版本拒绝） | ✅ CONFIRMED | `pnpm exec vitest run tests/patcher-reanchor.spec.ts` → exit 0，**11/11 PASS**。臂覆盖：数据文件命中优先/损坏拒收不回退在码/坏 schema 逐因响亮/未知版本拒绝/reanchor 永不覆盖已存数据集/--out 仅检视副本/status availableAnchorSets 诚实（in-code + dataDir） | 无 |
| 4 | V3 auto 六态判定表 + V14 联动 | ✅ CONFIRMED | `vitest run tests/patcher-auto.spec.ts` → exit 0，**24/24 PASS**（app-running×2/fuse-on/fuse-missing×2/would-patch/patch-executed Z29+Z32/already-ok/drifted/mixed/refused/verify-failed + 日志契约 + 计划任务 action/install/uninstall 面）；联动臂（feed-pending/would-preadapt/preadapting/preadapted/preadapt-failed/feed-unreachable/feedFace OFF）在 preadapt spec 全绿（见 #5） | 无 |
| 5 | V12/V13 编排面（mock 级） | ✅ CONFIRMED（编排级） | `vitest run tests/patcher-preadapt.spec.ts` → exit 0，**26/26 PASS** 含 MONEY TEST（would-do→下载校验→提取→fuse 前置→reanchor→模拟 patch 5/5→--accept 落盘）、sha512 不匹配删残留、fuse 前置拒收、模拟 patch 拒收零落盘、恰 1 次 .exe GET、stall 超时两臂、mutex 两臂、未知选项 RC=2 | 无 |
| 6 | V12 真机面 / V13 真下载+真 7z | ⚠️ UNVERIFIABLE — 属 B5 | 本块无法验证（需真下载 ~300MB 与真 7z 提取）；plan §5 B5 行已定义承接。不扣分 | B5 验收 |
| 7 | V1 status 真机 fuse 字段 | ✅ CONFIRMED（只读实测） | `node patcher/zctx-patch.mjs status --app-dir H:/AiAgent/DeepSeekHarness` → exit 0；JSON 含 `fuse: {found:true, exePath:"H:\AiAgent\DeepSeekHarness\DeepSeek Harness.exe", exeSize:246341104, version:1, stateCount:9, states:"101100011", integrity:"0", sentinelOffset:199416024}`；shellVersion=0.2.2-rc.3，patched:false，5/5 pristine | 无 |
| 8 | V2 patch 拒绝面（单测覆盖） | ✅ CONFIRMED | tests/patcher-fuse.spec.ts `patchAsar fuse integrity gate` 组：integrity=ON 拒收且零改动/不可读拒收/坏 wire（version 2）拒收/'r' warn 放行/exe 缺席诚实 skip——均含于 665 绿 | 无 |
| 9 | V8 auto 真机巡检（无 --yes）+ 日志契约 | ✅ CONFIRMED（只读+日志允许面实测） | `node patcher/zctx-patch.mjs auto --app-dir H:/AiAgent/DeepSeekHarness`（无 --yes）→ **exit 0**，`state=would-patch detail=all-pristine + anchors hit (5/5) — would patch; pass --yes to execute`（未执行任何补丁）；`%LOCALAPPDATA%\zctx-patch\auto.log` 追加 3 行（14→17），行格式 `[ISO8601] [auto] state=X detail=…` 与 plan §4 契约逐字吻合；真 feed GET 面：nightly.yml 响应被严格解析器响亮拒收（feed-unreachable WARN）→ 本地判定自足继续。零副作用复核：真机无 `.zctx-patch.json`、无 patcher/anchors/ 目录、app.asar mtime 仍 Nov 12、工作树 clean | 无 |
| 10 | checkpoint 链 STEP-0001→0011 | ✅ CONFIRMED | node 复核脚本：checkpoint-history.jsonl 12 条，**逐条 prev_hash→hash 链接全对，且逐条内容哈希复算全对**（公式=sha256(JSON.stringify(entry 去掉 hash 字段))，entry 1 实测复现）；checkpoint.json step=11 与末条一致且内容哈希复现；progress.md STEP-0001..0011 无缺口（STEP-0009a 主线记账行为在案） | 无 |
| 11 | B3 评审证据链 | ✅ CONFIRMED | scorecards/B3.json：evaluator=reviewer-B3 ≠ author=coder，六维 25/20/20/15/10/10=**100**，hardBlockCheck 全 false，verdict PASS；review-B3.md 三段齐全（r1 96.5 打回 / r2 97.5 打回 / r3 终审 100 PASS），C-1..C-5 全 fixed、B-1..B-8 全 fixed | 无 |
| 12 | Mimosa 安全门分诊证据链 | ✅ CONFIRMED | scan-2026-11-18T18-29-18.521Z-1b34e1d440a9：coverage.json selectedFiles=73 / parsedFiles=73 / truncated=false（73 实扫，§15 深扫可用）；seal.json 3 个 artifact 哈希独立重算全 MATCH；findings 5 条逐条分诊与主线一致：①②mongo-sort sink 位于 tests/helpers/mock-session.ts:108（测试助手，src/lib 零 import，bundle grep mock-session=0，不在产物束）；③⑤"env→fetch ssrf"两处 sink（lib/index.js:5521/7170）均 pass-through——5521 为观测包装仅记录 body 哈希不改写，7170 为 attribution headers 增量合并（body 不触碰），URL 非 env 控制（feedUrl 出自 app-update.yml，下载 url 出自 feed yml；本块 diff 中 env 仅 LOCALAPPDATA/APPDATA 路径与 ZCTX_AUTO_* 测试注入）；④reasoningInfoOf 在 bundle 中为模型 reasoning-efforts 解析（lib/index.js:5623），bundle grep mongo=0，合并 diff grep mongo/reasoningInfoOf=0 → mongo 侧零命中成立 | 无 |
| 13 | R1 附加：全 diff 无请求体改写面 | ✅ CONFIRMED | `git diff d951ebf..HEAD -- patcher/zctx-patch.mjs` 内 fetch 相关仅 4 处：`fetchImpl = globalThis.fetch`（注入点）、check-official `fetchImpl(feedUrl, {headers:{'cache-control':'no-cache'}, signal})`、downloadToFile `fetch(url, {headers:{'cache-control':'no-cache'}, signal})`、SUPPORTED 数据段内透传字符串。两处真实 GET 均无 body、无 POST、headers 仅 cache-control。合并 diff 18 文件清单与 task.json artifacts 对齐，无 scope 外触碰 | 无 |

## B5 承接清单（UNVERIFIABLE 项，非本块缺陷）

- V4 真机 schtasks install/uninstall 动作面（fixture 级序列已有 9 臂单测锁定）；
- V6 真机 patch 5/5 + SHA256SUMS/RESTORE.md 口径（B3 r1 B-8 已提示按现实现为 RESTORE.md 内哈希清单，B5 验收时定）；
- V12 真机 check-official 完整读数（pending/灰度百分比/本机灰度判定）；
- V13 真下载 ~300MB + 真 7z 双层提取。

**B5 参考（本验证的现场观察，非阻断）**：真机 V8 实测中真实 feed `https://download.deepseek.com/dsh-desk/feeds/win-x64/nightly.yml` 响应被严格 update-yaml 解析器响亮拒收（`feed-unreachable` WARN，auto 本地判定自足 exit 0）。B5 做 V12 真机读数时需核对该 feed 形态（或按 fail-closed 记账）；本块 mock 侧 parseYaml/HTML 陷阱面已有专测锁定。

## 硬阻断核对（§12.3）

- 伪造证据/评分/派发：未发现（所有上游声称均可独立复现，无未复现声称残留）；
- 安全底线违规：无（真机只读零副作用实测；写入面仅 %LOCALAPPDATA%\zctx-patch\auto.log 追加 3 行与任务核查文件）；
- 正确性 25 ≥ 23；安全回滚 10 ≥ 9；测试全绿（665/665）；无未记账 OPEN 遗留（B5 项为 plan 定义承接，非静默遗留）；无 del 越权改动（全程未触碰 del/）。

## 附注 A：R1 复算脚本（可重放）

```js
// node -e，在 worktree 根执行；切片=git show 对象文本 split("\n") 后
// lines.slice(start, end).join("\n") + "\n"（start=SUPPORTED 行，end=首个 "// ----------" 行）
// d951ebf 与 HEAD：chars=14889 bytes=14926 sha256=8e2d0b7e…059b0f9（与 README 钉死值一致）
```

## 交接

```
FROM: verifier-B4  TO: main
MODE: normal
TASK_REF: ZCTX-PATCH-AUTO B4 终验
PAYLOAD: SCORE 100/100（正确性25 完整性20 一致性20 可验证性15 安全回滚10 可维护性10）；验证 13 项：CONFIRMED 11 + UNVERIFIABLE(B5 承接) 2（#6 实为 V12/V13 真机面一项）；REFUTED 0；CHECKPOINT 本文件即 B4 产物
ATTACHMENTS: tasks/ZCTX-PATCH-AUTO/handoffs/verify-B4.md; tasks/ZCTX-PATCH-AUTO/scorecards/B4.json
```
