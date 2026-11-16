# REVIEW-P6F — P6-F 终波评审（v0.3.0 发布验证）

- FROM: reviewer-P6F（独立 subagent） TO: 主线（synthesizer/收口裁决）
- MODE: verify（终波评审 + 评分 + 发布判定）
- TASK_REF: tasks/ZCTX/cards/P6F-bench-release.md；main @ a8298ad，tag v0.3.0 → b16c4bb；基线 0f487cc（P6-D2/E 评审件入库）
- 日期: 2026-11-16 · 评审人 ≠ 作者（作者 coder-p6f）

## 0. 裁决速览

| 项 | 结果 |
|---|---|
| 总分 | **92**（<98 → 打回） |
| [阻断] | **1**（P6F-F1：声称的 RSI registry 备份 del/20261116-p6f-rsi-prechange 在盘上不存在——台账声称与盘面矛盾） |
| [建议] | **2**（P6F-F2：BENCH §8 台账行 BENCH-L5 未随改判更新且无 BENCH-L7 行；P6F-F3：§13.1 f340『32 seqs』应为 34） |
| v0.3.0 发布判定 | **FAIL（暂定）**——发布物本体（代码/基准数字/版本面/tag）全部独立复核成立；FAIL 仅由记录完整性阻断引起。修复=三步纯台账/文档更正（见 §5 修法），不动业务代码；更正后按 §12.4 重评放行 |

## 1. 亲验记录（评审人自己跑的命令与输出，非转录作者主张）

1. `npx tsc --noEmit` → EXIT 0。
2. `npm test`（= tsdown && vitest run）→ **Test Files 27 passed, Tests 592/592 passed, EXIT 0**。
3. 五探针全 PASS（亲跑）：probe-artifact **6** / probe-host-imports **16** / probe-real-mount **5** / smoke-real-loader **3** / verify-activation-surface **11**（**A11 17 断言 PASS 行亲见**）；两探针报告 timestamp-only diff 亲读后 `git checkout --` 还原，树归零。
4. 确定性重建亲证：重建 lib/index.js raw SHA-256 = `5796190163a36fa5…` 与 HEAD blob 逐字节全等（M lib/index.js 为 autocrlf CRLF 假动，git diff 空，作者已按 Z22 记载同型现象）；bench 装件 lib 同 sha（`profiles/bench/node_modules/dsh-zcontext/lib/index.js` 357,355 字节，CRLF=0）。
5. 折叠事件直读（node JSON 亲读）：session log seq **290** `data.source={kind:"zctx-fold",foldId:"f290",tokensBefore:5195,tokensAfter:619}`，time=1794866680795→`2026-11-16T22:04:40.795Z` 与 evidence committedAt 全等；seq **340** 同构（5739/638，`22:13:37.712Z` 全等）。净省亲算：**4576（−88.1%）/ 5101（−88.9%）**。
6. 0 工具调用断言：两 log `event type==="tool/call"` 全量扫描 = RUN1 39 个 {glob 1, read 14, pwsh 23, write 1}、RUN2 27 个 {write 1, pwsh 21, read 5}——**0 个 zctx_***；`zctx_` 字符串命中仅 system/guidance/request-header（schema 文本）。20 条 session/title-llm-request、0 条 compaction 请求事件。
7. RUN2 遥测亲数（summary-p6f-autofold-dbg.jsonl stderrTail）：**32 条 `→ HIT (hit line 26421)`**（首次 turn 4，estimate 26837；max estimate 39763）→ **33 条 `autoFold run:`（32 no-qualified-span + 1 folds-committed，netSaved=5101）**；逐轮 billedInput 累加 = **1,208,348**；t18 102,328 → t19 57,169。RUN1（无 ZCTX_DEBUG）：累加 **1,255,148**；t14 72,578 → t15 54,885。两臂 20/20 exit 0。
8. C 组对照独立重算（summaries/matrix-C.jsonl）：前 20 轮 sum = **2,253,460**、turns 11-20 均值 = **182,586**（−63.1% 算术自洽）；RUN2 turns 11-20 均值 67,300 / RUN1 73,288 亲算吻合。
9. `node reports/bench/harness/replay-f297.mjs`（评审人亲跑）→ 80 节点/12769 tokens → 唯一候选 `[{startSeq:9,endSeq:202,foldedTokens:5471}]` → **MATCH: true** → post-fold `[]`（plain node 可运行，R2 归档件有效）。
10. closure 机器数（node 遍历 closure.json）：**136 项，OPEN=0**——fixed/verified 128 · duplicate/closed 3 · uad/closed 1 · uad/verified 1 · not_applicable/verified 2 · duplicate/verified 1；128→135→136 与提交信息互洽。
11. 版本面：package.json 工作树与 tagged tree 同为 0.3.0；README.md/README.zh.md badge 0.3.0；CHANGELOG [0.3.0] - 2026-11-16；README 双语全部章节标题行号一一对应（37/50/59/100/112/117/131/142/155/173/182…），autoFold 与 patcher v0.2 两段逐段内容等价。
12. tag：`git cat-file -p v0.3.0` = annotated → b16c4bb，附注与发布事实相符；`diff 393cd40..b16c4bb` 仅 merge-ledger +10 行、`diff v0.3.0..a8298ad` 仅 tasks 台账 3 件——发布态=终态电池状态；`git fetch` 后 origin/main = a8298ad = HEAD。
13. 环境终验：desktop 四文件 SHA-256 与 `original-profile-baseline.sha256` 逐条全等（cac830d0/724cc8c4/c300dcf2/4e34a10c 亲算）；bench patch yml `dsh-zcontext|contextWindow: 40000` = 0；desktop patch yml `zcontext` = 0；del/20261116-p6f-prechange（13 件）+ del/20261116-p6f-bench-prechange 在盘（RESTORE.md + SHA256SUMS.pre 齐全）。
14. R1-R8 复扫（本波新增 src 行全量）：requestBody 0 / maxRetries 0 / fetch( 0 / authorization 0 / secret|password 0 / unlink|rm -rf 0 / process.env 写 0——红线全数不触。
15. RSI：Z31 已入 zDSH-LESSONS.md:189-193（防复发检查项三条）+ ~/.agents/rsi/INDEX.md:19 捕获行；评审人独立命中同一盲区（首扫顶层 e.source 得 0，改 data.source 后得 1）——Z31 教训为真。

## 2. R1-R5 逐条闭合核验（对照 REVIEW-P6D2E 原文修法）

| ID | 原建议修法 | 实际落法 | 核验 |
|---|---|---|---|
| R1 | 补批准或改判 | BENCH-L5 uad→**fixed/verified**：机制路线交付使依赖消失（P6-E 引擎+f297 独立重放在案+本波 f290/f340 复证）；残余杠杆单列 BENCH-L7 not_applicable（非插件缺陷、非 v0.3 验收判据） | **合规**：改判后无 deferred → 无需批准；采用面事实未被抹掉（§13.2『模型自发采用面维持 §11.3 原判（两臂仍 0 自发 zctx_* 调用）』+CHANGELOG『0 spontaneous fold calls in 60 pressure rounds』=3 会话×20 轮如实）；GO-NO-GO §10.3 门槛 2 可观测变量由『模型是否调用』扩为『折叠是否真实提交』且两口径分列 |
| R2 | replay-f297.mjs 入库并在 §12.1 指向 | 已入库（含评审人出处头注），§12.1 证据栏改指归档件 | 亲跑 MATCH:true（§1.9） |
| R3 | wire 时 warn（不 fail-skip） | plugin.ts：apiKeyEnv 已配但 env 缺失→zctxDebug+logger.warn，面保持 armed（缺凭据=退化链条件）+2 钉（missing warn / present 零 warn 控制臂） | diff+钉亲读；592 含 3 新钉 |
| R4a | 结构化 reason code 或导出常量+防回归钉 | texts.ts 导出 REASON_NO_NET_SHRINK_SIGNATURE（模板运行时派生最长无占位片段，措辞改动自动跟随）+ autofold.ts:884 改用常量 + 3 重钉（containment+非空+跨模板唯一） | diff+钉亲读；钉内含非空与唯一性断言 |
| R4b | 措辞对齐载体 | progress.md:160 改『closure.json 台账 P6E-4 登记』 | 亲读 |
| R5 | 头注+live 指针 | switch-group.mjs 头注 ARCHIVED PRE-FIX EVIDENCE COPY（两缺陷描述+live 件位置） | 头注亲读 20 行 |

## 3. 基准真实性与纪律核验（攻击方向 2）

- **两臂折叠证据四方互洽**：evidence JSON ↔ session log（seq/哈希形态/时间戳）↔ summary 遥测（32 HIT/33 run/32+1，netSaved=5101）↔ 计费曲线（t18→t19 −44%、t14→t15 −24%）——评审人全部独立重建（§1.5-1.8）。
- **32 HIT/1 commit 诚实呈现**：BENCH §13.1/§13.3 + CHANGELOG 如实写『32 次诚实 no-qualified-span（0 摘要调用，不硬折）+ 单纪元天花板=BENCH-L6/P6E-4』；P6E-4 duplicate→W3-R2（fixed/verified）指向真实既有条目——duplicate 合规。
- **不做处理效应归因**：§13.2 显式三重理由（C 组 disabled 态、单会话无重复、步数方差主导）+『如实呈现曲线，不做归因』；GO-NO-GO §10 计数/费用分开报成立；7 指标未闭环项（hitRate 未重算、breakevenTurns、κη 无单价表）如实保留——纪律核验通过。
- 唯一数字瑕疵：f340 source seqs 表值 32 ≠ 实数 34（[建议 P6F-F3]）。

## 4. 发现清单

### [阻断] P6F-F1 — 声称的备份在盘上不存在（记录完整性）

- **位置**：tasks/ZCTX/progress.md:166 + C:/Users/ZS/.agents/rsi/INDEX.md:19（声称件）vs del/（盘面）。
- **问题**：两处声称 `del/20261116-p6f-rsi-prechange（2 件+SHA256SUMS+RESTORE.md）`，但 find 遍历 /g/000Github/zDSH 全树与 ~/.agents/rsi 均无此目录；先例对照=p6b/p6d/p6e 三波同名 rsi-prechange 全部在盘。被改文件 ZDSH-LESSONS.md 在非 git 根（rev-parse exit 128）、INDEX.md 在仓外系统目录——预改状态不经备份即无权威副本。§5 备份先行被违反或声称与执行不符（§9/§12.3 诚实类硬阻断）。
- **缓解事实**（不改变定级，但限定影响面）：两处改动均为纯追加（Z31 块=ZDSH-LESSONS.md:189-193；INDEX 行 19），逆运算可推导，实际回滚风险低；发布物（插件代码/基准证据/版本面）不受影响，且其备份两件在盘已亲验。
- **修法**（纯台账/文档，不动业务代码）：(1) progress.md:166 与 INDEX.md:19 改为如实陈述（备份未建/未在盘+原因）；(2) closure.json 登记 P6F-2（type=process-deviation，evidence=本评审 find 输出，disposition=fixed，以记录更正+逆运算可回滚性写明关闭）；(3) 为两文件补现态基线快照，并把『改前备份目录先 mkdir 后写台账』固化为检查项。
- **disposition**：OPEN → 主线 fixed 后重评。

### [建议] P6F-F2 — BENCH §8 台账行未随改判更新

- **位置**：reports/bench/BENCH-report.md:119。
- **问题**：BENCH-L5 行仍 user_approved_deferred，与 closure fixed/verified 矛盾；§8 表是活登记表（BENCH-L1 行先例）；BENCH-L7 closure evidence 自述指针『§8 row + §13』中 §8 row 不存在。
- **修法**：BENCH-L5 行改 fixed/verified（机制解药；采用面维持 §11.3 原判）+ 新增 BENCH-L7 行（not_applicable，v0.4 候选）。
- **disposition**：OPEN → 主线 fixed。

### [建议] P6F-F3 — f340 seq 计数不符

- **位置**：reports/bench/BENCH-report.md:231。
- **问题**：『[9..128]（32 seqs）』实为 34（evidence JSON 与 session log 亲数一致；f290 行 27 亲数吻合）。
- **修法**：32→34 一处更正。
- **disposition**：OPEN → 主线 fixed。

## 5. 评分（§12.1 六维，证据路径见 scorecards/P6F.json score_evidence）

| 维度 | 分 | 扣分依据 |
|---|---:|---|
| 正确性 | 25 | 电池 592/592+tsc 0+五探针 6/16/5/3/11 亲跑全绿；R3/R4a 修复逻辑亲读成立 |
| 完整性 | 20 | 卡面产物 1-4 全交付；R1-R5 六条 disposition 全落；GO-NO-GO §10 纪律逐条对上 |
| 一致性 | 17 | −2：BENCH §8 行与 closure 矛盾（F2）；−1：f340 seq 计数（F3） |
| 可验证性 | 13 | −2：备份声称不可复核（F1）；其余全部独立重建成立（折叠/遥测/计费/tag/装件全等） |
| 安全回滚 | 7 | −3：三件声称备份缺一（F1）；在盘两件+桌面零触碰+disarm 零残留+装件全等亲验通过 |
| 可维护性 | 10 | 结构化签名+双语镜像+归档件头注模式+台账终态三件齐全 |
| **总分** | **92** | <98 → **打回**（同一块返工 ≤2 轮；修法均为台账/文档更正，无业务代码） |

## 6. 发布判定与放行条件

- **v0.3.0 判定：FAIL（暂定）**。发布物本体全绿（592/592+tsc 0+五探针+tag 三方一致+基准数字独立复证），FAIL 仅由 P6F-F1 记录完整性阻断引起。
- **放行条件**：F1（必须）+ F2/F3（最终验收前必须，§0.1 建议与阻断同权处理）全部 fixed/verified 并登记 closure 后，由主线重评（预计为纯文档/台账 diff 的快速复评）；重评通过即 PASS。
- 过程注记：评审亲验造成的树变动均已还原核验（探针报告 timestamp-only + lib CRLF 假动）；业务代码零改动；本文件与 scorecards/P6F.json 未提交——入库归主线（沿用 0f487cc 先例）。

## 7. 交接块

```
FROM: reviewer-P6F  TO: 主线
MODE: verify
TASK_REF: P6-F 终波评审（v0.3.0 发布验证）
PAYLOAD: SCORE 92/100（六维证据见 scorecard）· [阻断]1 [建议]2 · 发布判定 FAIL(暂定，台账更正后可 PASS)
ARTIFACTS: tasks/ZCTX/scorecards/P6F.json + tasks/ZCTX/handoffs/REVIEW-P6F.md（SHA-256 由主线入库时回录）
CHECKPOINT: 评审波次不推进任务 checkpoint（P6-F checkpoint terminal 不变）；本文件即评审落盘收据
```
