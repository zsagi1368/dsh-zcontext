# REVIEW-P6F — P6-F 终波评审（v0.3.0 发布验证）＋ r1 返工复审

- FROM: reviewer-P6F（独立 subagent） TO: 主线（synthesizer/收口裁决）
- MODE: verify（终波评审 + 评分 + 发布判定；r1 返工复审）
- TASK_REF: tasks/ZCTX/cards/P6F-bench-release.md；main @ 5f1e5db（r1 返工四提交 66de631/c6f73cd/3088f95/5f1e5db，未推——§8 确认门动作留主线）；tag v0.3.0 → b16c4bb；基线 0f487cc
- 日期: 2026-11-16 · 评审人 ≠ 作者（coder-p6f / coder-p6f-r1）

## 0. 裁决速览（r1 返工复审后更新）

| 项 | 第 1 轮 | r1 返工复审 |
|---|---|---|
| 总分 | 92（<98 打回） | **99**（≥98 通过） |
| [阻断] | 1（P6F-F1） | **0**（P6F-F1 fixed/verified） |
| [建议] | 2（P6F-F2/F3） | **0**（两条 fixed/verified） |
| v0.3.0 发布判定 | FAIL（暂定） | **PASS** —— 交主线推送 + 最终交付 |

返工第 1 轮为纯台账/文档更正（diffstat a8298ad..5f1e5db 仅 BENCH-report.md / closure.json / progress.md / 评审件两份，业务代码零改动）。三条 finding 全部当波闭合（closure P6F-2/3/4，139 项 OPEN=0 机器数）。

## 1. 亲验记录（第 1 轮，业务与基准事实——继续有效）

1. `npx tsc --noEmit` → EXIT 0；`npm test` → **592/592 passed EXIT 0**（27 files）。
2. 五探针全 PASS：probe-artifact **6** / probe-host-imports **16** / probe-real-mount **5** / smoke-real-loader **3** / verify-activation-surface **11**（**A11 17 断言 PASS 行亲见**）。
3. 确定性重建亲证：重建 lib/index.js raw SHA-256 = `5796190163a36fa5…` 与 HEAD blob 逐字节全等；bench 装件 lib 同 sha（357,355 字节，CRLF=0）。
4. 折叠事件直读：session log seq **290** `data.source={kind:"zctx-fold",foldId:"f290",tokensBefore:5195,tokensAfter:619}`，time→`2026-11-16T22:04:40.795Z` 与 evidence committedAt 全等；seq **340** 同构（5739/638，`22:13:37.712Z`）。净省亲算 **4576（−88.1%）/ 5101（−88.9%）**。
5. 0 工具调用断言：两 log tool/call 全量 = RUN1 39 {glob 1,read 14,pwsh 23,write 1} / RUN2 27 {write 1,pwsh 21,read 5}——**0 zctx_***；20 条 title-llm-request、0 compaction 事件。
6. RUN2 遥测亲数：**32 条 `→ HIT (hit line 26421)`**（首 t4 est 26837；max 39763）→ **33 条 `autoFold run:`（32 no-qualified-span + 1 folds-committed，netSaved=5101）**；cum billedInput **1,208,348**（RUN1 **1,255,148**）；t18 102,328→t19 57,169；t14 72,578→t15 54,885。两臂 20/20 exit 0。
7. C 组对照独立重算（summaries/matrix-C.jsonl）：前 20 轮 sum **2,253,460**、t11-20 均值 **182,586**（−63.1% 自洽）；RUN2 均值 67,300 / RUN1 73,288 吻合。
8. `node reports/bench/harness/replay-f297.mjs` 亲跑 → 80 节点/12769 tokens → `[{startSeq:9,endSeq:202,foldedTokens:5471}]` → **MATCH: true** → post-fold `[]`。
9. 版本面：package.json（工作树=tagged tree）0.3.0、README badge 双语 0.3.0、CHANGELOG [0.3.0]；README 双语章节行号级镜像；patcher/README v0.2 全流程亲读。
10. tag：annotated → b16c4bb；`diff 393cd40..b16c4bb` 仅 merge-ledger；`diff v0.3.0..a8298ad` 仅 tasks 台账——发布态=终态电池状态。
11. 环境终验：desktop 四文件 SHA-256 与 baseline 全等；disarm 残留=0（bench+desktop）；del/p6f-prechange（13 件）+ p6f-bench-prechange 在盘（RESTORE.md+SHA256SUMS）。
12. R1-R8 复扫（本波 src 增量行）：requestBody/maxRetries/fetch/authorization/secret/删除/env 写 = **0**。
13. RSI：Z31 入 zDSH-LESSONS.md:189-193 + INDEX 捕获行；评审人独立命中同一盲区（顶层 e.source=0 → data.source=1），教训为真。

## 2. R1-R5 逐条闭合核验（第 1 轮，结论不变）

| ID | 落法 | 核验 |
|---|---|---|
| R1 | BENCH-L5 uad→fixed/verified（机制解药）；残余杠杆单列 BENCH-L7 not_applicable | 合规：改判后无 deferred → 无需批准；采用面事实维持 §11.3 原判如实（0/60 轮）；两口径分列 |
| R2 | replay-f297.mjs 入库+§12.1 指向 | 亲跑 MATCH:true |
| R3 | wire 时响亮 warn（面保持 armed）+2 钉 | diff+钉亲读 |
| R4a | REASON_NO_NET_SHRINK_SIGNATURE 模板派生+常量分类+3 重钉 | diff+钉亲读 |
| R4b | progress 措辞对齐 closure.json 载体 | 亲读 |
| R5 | 归档件头注 ARCHIVED PRE-FIX EVIDENCE + live 指针 | 头注亲读 |

## 3. 基准真实性与纪律核验（第 1 轮，结论不变）

四方证据互洽且评审人独立重建（§1.4-1.7）；32 HIT/1 commit 诚实呈现（32 no-qualified-span+单纪元天花板=BENCH-L6/P6E-4 duplicate→W3-R2 合规）；『不做处理效应归因』显式三重理由+计数/费用分开报+7 指标未闭环项如实保留——纪律通过。

## 4. 第 1 轮发现清单（原始记录，供追溯）

### [阻断] P6F-F1 — 声称的备份在盘上不存在（记录完整性）
- progress.md:166 + INDEX.md:19 声称 `del/20261116-p6f-rsi-prechange（2 件+SHA256SUMS+RESTORE.md）`，find 全树核实从未建成；先例 p6b/p6d/p6e 三波同名备份全在盘。缓解事实：两处改动纯追加、逆运算可推导，发布物不受影响。→ **r1 已闭合（见 §8.1）**

### [建议] P6F-F2 — BENCH §8 台账行未随改判更新
- BENCH-report.md:119 BENCH-L5 行仍 uad 且无 BENCH-L7 行，BENCH-L7 closure 指针『§8 row + §13』落空。→ **r1 已闭合（见 §8.2）**

### [建议] P6F-F3 — f340 seq 计数不符
- BENCH-report.md:231『32 seqs』实为 34（evidence JSON 与 session log 亲数一致）。→ **r1 已闭合（见 §8.3）**

## 5. 第 1 轮评分（存档）

| 维度 | 分 | 扣分依据 |
|---|---:|---|
| 正确性 | 25 | 全绿亲跑 |
| 完整性 | 20 | 卡面 1-4 全交付 |
| 一致性 | 17 | −2 F2 / −1 F3 |
| 可验证性 | 13 | −2 F1 声称不可复核 |
| 安全回滚 | 7 | −3 F1 备份缺失 |
| 可维护性 | 10 | — |
| **总分** | **92** | <98 → 打回 |

## 6. 第 1 轮发布判定与放行条件（存档）

v0.3.0 FAIL（暂定）；放行条件=F1（必须）+F2/F3（最终验收前必须）fixed/verified 并登记 closure 后重评。

## 7. r1 返工复审亲验记录（评审人自己跑的命令与输出）

1. **返工范围亲核**：`git diff --stat a8298ad..5f1e5db` = 仅 5 件（BENCH-report.md +5/-2、closure.json +30、progress.md +3/-1、REVIEW-P6F.md/P6F.json 入库）——**业务代码零改动**。
2. **F1 两处更正亲读**：
   - progress.md [P6-F RSI] 行（66de631 diff）：原声称句如实替换——『**更正（REVIEW-P6F §4 P6F-F1 [阻断]）：原声称 del/20261116-p6f-rsi-prechange（2 件+SHA256SUMS+RESTORE.md）未建成、盘上不存在**（台账声称与执行不符；reviewer find 全树核实在案）』+ 快照/Z32/P6F-2 全部如实记载；
   - INDEX.md 发布波行（现 :20）：**原声称原文保留 + inline 追加【更正 REVIEW-P6F P6F-F1 [阻断]：…未建成、盘上不存在…已补现态快照…closure P6F-2 fixed；检查项固化=Z32】**——未伪造、未静默删除；INDEX :19 = r1 捕获行（新→旧序）。
3. **补录快照时序真实性（未伪造的独立证实）**：del/20261116-p6f-rsi-snapshot/ 四件（RESTORE.md、SHA256SUMS、ZDSH-LESSONS.post-z31.md 48,595B、RSI-INDEX.post-z31.md 85,926B）：
   - SHA256SUMS 两哈希（`3f5e3543…6c15` / `50c9eb95…2e47`）与快照文件实测**全等**；
   - ZDSH-LESSONS.post-z31.md：含 Z31、**无 Z32**，且为当前 ZDSH-LESSONS.md 的**严格前缀**（current = snapshot + Z32 追加）——取材先于 r1 改动；
   - RSI-INDEX.post-z31.md：**含原失实声称（p6f-rsi-prechange）**、无 r1 捕获行——同上；
   - RESTORE.md 写明**补录性质声明**（非改前备份，原备份缺失如实登记 closure P6F-2）+ **两层回滚路径**（①复制回快照态 ②pre-Z31 纯追加逆运算，附先例指针 del/20261116-p6e-rsi-prechange 在盘）。
4. **Z32 固化 + 践行**：ZDSH-LESSONS.md:195 Z32（备份台账声称≠备份在盘——先 mkdir+SHA256SUMS 后写台账，收口前在盘复核；防复发检查项含『声称≠在盘即[阻断]，不得以逆运算可推导豁免定级』）；且本波已践行：**del/20261116-p6f-r1-prechange（5 件+SHA256SUMS+RESTORE.md）开工首步在盘建立**，目录 mtime 14:43 先于首笔返工提交 14:45:29；其中 ZDSH-LESSONS.pre-r1.md / RSI-INDEX.pre-r1.md 与快照件同哈希（同一 post-Z31 态，无两个互相矛盾的"pre"态）；progress/BENCH/closure 三件 pre-r1 哈希各就各位。
5. **F2 亲读**（c6f73cd diff）：BENCH §8 BENCH-L5 行改 **fixed/verified（P6-F 改判…机制路线交付使依赖消失…采用面事实不被抹掉：维持 §11.3 原判）** + 新增 **BENCH-L7 行（not_applicable，v0.4 候选…closure.json BENCH-L7 同源）**——与 closure 条目语义对齐，『§8 row + §13』指针两处都可解析。
6. **F3 亲读**（3088f95 diff）：f340 行 32→**34** 并注明『sourceEventSeqs 亲数』口径（[9..128] 含空洞非区间长 120）；f290 行 27 不改；raw/ 证据件零改动（diffstat 亲核）；评审人第 1 轮已对 evidence JSON 与 session log 独立亲数 34。
7. **closure 机器数**：node 遍历 = **139 项，OPEN=0**（fixed/verified 131 · duplicate/closed 3 · uad/closed 1 · uad/verified 1 · not_applicable/verified 2 · duplicate/verified 1）；P6F-2（process-deviation，fixed/verified，phase block）/ P6F-3 / P6F-4 evidence 逐条与盘面对得上（快照哈希值与实测全等、r1-prechange 在盘）；137→138→139 计数链与提交信息互洽。
8. **电池重跑（本轮）**：`npx tsc --noEmit` EXIT 0；`npm test` = **Test Files 27 / Tests 592/592 passed EXIT 0**；五探针全绿 **6/16/5/3/11**（A11 含内）；两探针报告 timestamp-only diff 还原后 `git status --porcelain` = **0**（树净亲验）。
9. **评审件完整性**：5f1e5db 入库的 REVIEW-P6F.md / scorecards/P6F.json git blob SHA-256 = `64540f7c…` / `2c336157…`，与第 1 轮评审写盘时计算值**逐字节一致**——评审件未被返工方篡改。
10. **R1-R8**：返工 diff 无 src 变更——红线天然不触；第 1 轮 src 扫描继续有效。

## 8. r1 返工复审发现闭合判定

### 8.1 P6F-F1（[阻断]）→ **fixed / verified**
两处声称如实更正（引用保留+inline 更正，非伪造非静默）；补录快照时序真实性经严格前缀关系独立证实、SHA256SUMS 自洽、两层回滚路径文档化且先例件在盘；Z32 固化并当波践行（r1-prechange 先 mkdir 后改件，mtime 证序）；closure P6F-2 登记。残余（如实保留于评分）：pre-Z31 原始字节无在盘存档，回滚依赖已证实的逆运算重构——安全回滚维 9/10，不构成阻断。

### 8.2 P6F-F2（[建议]）→ **fixed / verified**
BENCH §8 两行与 closure 逐字对齐；指针落空问题消除。closure P6F-3。

### 8.3 P6F-F3（[建议]）→ **fixed / verified**
f340=34 与证据件一致、口径注明；f290=27 复核不变。closure P6F-4。

## 9. r1 返工复审评分（§12.1）

| 维度 | 分 | 依据 |
|---|---:|---|
| 正确性 | 25 | 业务代码零改动+本轮重跑 tsc 0 / 592/592 / 五探针全绿 |
| 完整性 | 20 | 卡面 1-4 + 评审三条当波收口（139 项 OPEN=0） |
| 一致性 | 20 | §8 两行与 closure 对齐；f340=34 与证据一致；计数链互洽 |
| 可验证性 | 15 | 全部声称在盘可复核（快照前缀证明+哈希链+r1-prechange 逐件复核） |
| 安全回滚 | 9 | −1：pre-Z31 原始字节无在盘存档（逆运算重构已证实，历史残差如实保留） |
| 可维护性 | 10 | 台账纠错标准动作（保留原文+inline 更正+closure+教训固化+践行）可复用 |
| **总分** | **99** | ≥98 → **通过** |

## 10. 最终发布判定

**v0.3.0 发布判定：PASS。**

- 发布物本体（代码/基准证据/版本面/tag/电池）自第 1 轮起全部独立复核成立；三条 finding 全部 fixed/verified（closure 139 OPEN=0）。
- 剩余动作归主线（§8 确认门）：推送 r1 返工四提交（66de631/c6f73cd/3088f95/5f1e5db）+ 本轮更新的两份评审件入库 + 最终交付；推送后 remote 终验。
- 诚实注记：返工四提交未推（如实，§8 确认门动作留主线）；评审件本轮更新由评审人写入，主线入库时回录新 SHA-256。

## 11. 交接块

```
FROM: reviewer-P6F  TO: 主线
MODE: verify（r1 返工复审）
TASK_REF: P6-F 终波评审 + r1 返工复审（v0.3.0 发布验证）
PAYLOAD: SCORE 99/100（六维证据见 scorecards/P6F.json rework_r1 + score_evidence）· [阻断]0 [建议]0 · v0.3.0 发布判定 PASS · 交主线推送+最终交付
ARTIFACTS: tasks/ZCTX/scorecards/P6F.json + tasks/ZCTX/handoffs/REVIEW-P6F.md（r1 更新版；SHA-256 由主线入库时回录）
CHECKPOINT: 复审波次不推进任务 checkpoint（P6-F terminal 不变）；本轮更新即复审落盘收据
```
