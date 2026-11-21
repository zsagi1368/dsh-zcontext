# verify-A-bench — 论文基准数字类声明独立复核报告

- FROM: verifier（独立复核） TO: 主线
- MODE: verify
- TASK_REF: dsh-zcontext 论文 docs/paper/index.html @ HEAD ccb9c53（全量基准数字声明 vs 权威对照源 reports/bench/BENCH-report.md + raw/ + 本机档案）
- 方法：换渠道独立复核——论文数字不用 BENCH 报告转抄，而是从 `summaries/*.jsonl`、`raw/*.jsonl`、`harness/summary-p6f-*.jsonl`、折叠证据 JSON 用 Python 独立重算；交叉引用与时间线另查 CHANGELOG、git tag、REVIEW-P6F/P6D2E、zDSH-docs 档案（pi/ctx-opt/ctx-imp/ctx-rel/zctx-20261112）。
- 日期：2026-11-21 · 只读复核（本报告为唯一写入产物）

## 逐条对照表

| 编号 | 论文声明（行号） | 验证结论 | 独立证据（档案行号/命令输出） | 影响评估 |
|---|---|---|---|---|
| V1 | §2.1/表 3 Phase 2 主表：A 累计 36,645,904、109,181→1,288,955、11.8×、98.2% 命中率（paper L63/L164）；B 15,509,064、51,927→644,860、12.4×（L165）；C 20,769,088、42,760→786,044、18.4×（L166）；峰值 3,322,963（A turn42）（L63） | ✅ CONFIRMED | 从 `summaries/matrix-{A,B,C,C2}.jsonl` 独立重算：A cum=36,645,904、first10 均值=109,181.3→109,181、last10 均值=1,288,954.5→1,288,955（四舍五入进位 1 token，非差异）、比值 11.806→11.8×、hitMean 98.2%、steps=371、folds=0、max=3,322,963@turn42；B=15,509,064/51,927/644,860/12.42×/98.5%/240/0；C=20,769,088/42,760/786,044/18.38×/98.3%/235/0。与 BENCH L82-84、L87 逐格一致 | 无。数字级证据链完整可复现 |
| V2 | §7.2：「20 轮压力臂 + 10 轮正常臂模型自发 fold = 0」「工具面/引导面/nudge 面全部实测到达 wire prompt」（L171）；「32 次 autoFold 判定 HIT→33 次链运行→32 次 no-qualified-span（诚实不硬折）+1 次 committed」（L171/L180）；零摘要调用（L142） | ✅ CONFIRMED | BENCH L181（§11.4「修好接线后模型依然 0 自发 fold（20 轮压力臂 + 10 轮正常臂）」）、L164-174（guidance 逐字引用、nudge 615 chars 实入 wire，`harness/stderr-diag3-c2b-turn9-nudge-fired.txt` 在盘）、L234（32 HIT→33 chain→32 no-qualified-span（0 摘要调用）+1 committed）；REVIEW-P6F.md L26（评审人独立亲数 32/33/32/1，RUN2 遥测）。摘要三供给退化链与零摘要调用见 L142 paper §5.4 与 BENCH L234 | 无 |
| V3a | §7.3 表 4 数字：f290=RUN1/turn14/[9..111]/27 seqs/5,195→619（−88.1%）/72,578→54,885（−24%）；f340=RUN2/turn18/[9..128]/34 seqs/5,739→638（−88.9%）/102,328→57,169（−44%）（L177-178） | ✅ CONFIRMED | `raw/p6f-autofold-fold-f290-evidence.json`（tokensBefore/After=5195/619，surfaceOp 9..111，sourceEventSeqs 展开后 27 个 seq）与 f340 证据件（5739/638，9..128，34 seqs）；`harness/summary-p6f-autofold.jsonl` turn14=72,578/turn15=54,885、`-dbg` turn18=102,328/turn19=57,169；百分比独立算术：4576/5195=−88.08%、5101/5739=−88.88%、17693/72578=−24.38%、45159/102328=−44.13%。REVIEW-P6F.md L24（评审人直读 seq290/340 亲算净省）。34 seqs 为 BENCH F3 更正后口径（REVIEW-P6F.md L59），论文采用更正值 ✓ | 无 |
| V3b | §7.3 L180：「两次折叠均由 compaction 供给生成模型摘要；评审独立重放 MATCH。」 | ❌ REFUTED（归因错误） | compaction 供给部分成立（证据件 summaryTextHead 非 digest、BENCH L231-232）。但档案中「评审独立重放 MATCH」唯一指向 **f297**（BENCH L196 §12.1：replay-f297.mjs 输出 MATCH:true；BENCH-L5 行 L119「f297 服务端折叠（评审独立重放 MATCH:true）+ P6-F 两臂 f290/f340 复证」；REVIEW-P6D2E.md L29 §1.8 评审人自有脚本重放 f297；REVIEW-P6F.md L28 亲跑 replay-f297.mjs）。全仓检索（reports/、tasks/）无 f290/f340 的重放脚本或 MATCH 记录；REVIEW-P6F 对两臂的核验方式是 session log 逐 seq 直读（其 §1.4），非重放。论文表 4 引 BENCH §13（L175 caption），§13 无任何重放声明 | 中。属证据归因错位而非数字造假；但它是论文在 §7.3 唯一的「评审背书」句，且依赖被遗漏的 f297（见 V5）才成立。须改写（见 ISSUES-1） |
| V4 | §1/§7 口径：「170 轮隔离基准」（L51/L58）；「50 轮 × 3 组」（L160）；「billedInput = input + cacheRead + cacheWrite」（L162）；「缓存命中率均值 98.2% 只降低单价不减计数」（L63-64）；「不做跨组声称」+步数 A=371/B=240/C=235（L168）；「40 轮自发折叠对照」（L58） | ✅ CONFIRMED（一处措辞保留意见） | 170=10 pilot+50×3+10 C2（BENCH L13 重算吻合）；50×3 见 BENCH L76/L82-84；billedInput 三值之和定义见 BENCH L51（types.ts:175-189 引注）；命中率口径见 BENCH L52/L93——98.2% 为 A 组均值（B 98.5/C 98.3），论文在「裸官方路径」语境引用，无跨组误标；步数 371/240/235 已独立重算吻合（BENCH L91）；「不做跨组声称」与 BENCH §5.2 同文。「40 轮自发折叠对照」数字正确（BENCH L238 两臂 2/40），但「对照」措辞松（该 40 轮是 autoFold 处理臂，真正的对照是 P6-D2 复测 0/20）；且不含 P6-E pilot 20 轮——见 ISSUES-2 | 低 |
| V5 | f297（P6-E pilot 折叠，5471→864 −84%，BENCH §12.1 L192/L196）论文是否遗漏/是否有「只折叠了两次」「首次折叠」类冲突表述 | ⚠️ UNVERIFIABLE→实为「确认遗漏、无直接冲突句」 | 全文检索：论文零处提及 f297/「三次」/「3/60」。无「只折叠了两次」「首次折叠」字面句。「两次折叠均由…」（L180）与 §6.3 标题「第一手净省数据」（L152，「第一手」=一手数据义）均无字面冲突。但档案明确记录机制路线共 **3/60 轮、三会话各 1 折**（BENCH L238）；论文 §1「40 轮自发折叠对照」+§7.3「两臂」+摘要「两臂折叠」合力让读者得出「共 2 折」的印象；且 V3b 的重放背书实际属于 f297——遗漏 f297 正是错位得以成立的原因 | 中。非造假（论文显式限定「两臂」并引 BENCH §13），但与「全部数据可溯源」的自我声明（L47/L220）相比存在选择性呈现。建议补记（ISSUES-2） |
| V6a | 时间线「2026-08 下旬：pi 深研→成本方程 v2.3+七条清单」（L211） | ✅ CONFIRMED | zDSH-docs/R&D/pi-context-research/REPORT.md L6「研究日期：2026-08-26」；CONTEXT-CACHE-MANAGEMENT.md L3「v2.3（2026-08-27）第三轮对抗收口版」 | 无 |
| V6b | 时间线「2026-11-04~08：ctx-opt（终评 99/100，65 条复核）→七裁定」（L212） | ⚠️ PARTIAL | 终评 99/100 ✅（ctx-opt-20261104/progress.md L37/L41、scorecards/report-opt-final.json）；七裁定 ✅（REPORT-OPT.md）；报告日期 2026-11-04（REPORT-OPT.md L3），方案波全部 27 条 progress 均为 11-04——窗口尾「08」无档案支撑（11-08 属 ctx-rel 收口波）。**「65 条复核」全档案不可考**：ctx-opt-20261104 内无任何「65」计数；本仓唯一「65 条」是 REVIEW-V6.md L42「closure 65 条」——zctx v0.2.0 收口台账（另一任务波），疑似串写（ISSUES-4） | 低-中。99/100 与七裁定成立；「65 条」与窗口尾需要改 |
| V6c | 时间线「2026-11-08~17：T0–T6 实施+遗留清零，CI 全门 40,915 测试；确认混血天花板」（L213） | ❌ REFUTED（窗口与档案冲突） | ctx-imp-20261104/progress.md 日期跨度=**2026-11-04~11-06**（T0/T1/T6 于 11-04 当日完成，17+8+36 条按日分布 11-04/05/06）；CI run 42361800930 全绿记录于 closures/closure-mainline-final.json `updatedAt: 2026-11-06`、`ciGreen{run:42361800930,conclusion:success}`（40915 数字吻合，run id 与论文 ref r3 L202 一致）。收口波 ctx-rel-20261108 跨 **11-08~11-11**（progress 11-08/09/11；close-ledger 尾=11-11；R2 复查 FAIL 76/100→两阻断修复；遗留 LOADER-COMP 一项 open/post-merge 移交新卡）。ctx-* 四目录检索无任何 11-12~17 日期。即：实施实为 11-04~06、CI 门 11-06、收口 11-08~11；论文窗口「11-08~17」起点晚 4 天、终点无档案支撑（ISSUES-5） | 中。仅影响时间线行 2-3 的日期窗口；不触及 40,915/七裁定/CI run id 等实质声明 |
| V6d | 时间线「2026-11-12~15：v0.1.0；发现 billion-context；v0.2.0 patcher+基准」（L214） | ✅ CONFIRMED（一处措辞保留） | CHANGELOG L470 [0.1.0]=2026-11-12、L326 [0.2.0]=2026-11-13；billion-context 档案波目录=zctx-20261112（发现时点吻合）。保留：BENCH 矩阵实测日为 2026-11-16（报告 L4、raw mtime 11-16），本行「+基准」只能读作基准准备；实测已在下一行「11-15~16」覆盖，无实质冲突 | 无 |
| V6e | 时间线「2026-11-15~16：Phase 2 矩阵→采用率 0/20→v0.3.0 autoFold 引擎」（L215） | ✅ CONFIRMED | BENCH 报告与 P6-D2/P6-E 补段均标 2026-11-16（L4/L138/L186）；raw mtime 11-16 12:12；f297 committedAt 2026-11-16T21:25Z；CHANGELOG L74 [0.3.0]=2026-11-16 | 无 |
| V6f | 时间线「2026-11-16~21：Phase 3 两臂→面板/语言波→论文发布」（L216） | ✅ CONFIRMED | f290 committedAt 2026-11-16T22:04:40Z、f340 22:13:37Z（本机 UTC−8 对应当地 11-16 14:04/14:13，与 BENCH §13 日期及 raw mtime 14:20 自洽）；面板/语言 tags：zctx-ui/zctx-sidebar-20261119a、zctx-i18nfix-20261121a、zctx-autoui-20261121a（git tag 实查）；CHANGELOG Unreleased autoui 2026-11-21；论文 meta 日期 2026-11-21（L47）、HEAD=ccb9c53 实查 | 无 |
| V7 | §5.1/ref r6：「billion-context 公开自述：27B 级小模型自发采用折叠比率为零」；侧车 --port 18787（L120/L205） | ✅ CONFIRMED（附一条反向佐证注记） | 研究档案对 bc 论文的引用带行锚：RES-bc-server-orchestration.md L15/L197「工具采用率小模型为零（27B, temp 0；restore 只在被指示时执行）｜paper/...md:267, :114」；RES-billion-context.md L363 引 bc 原文「controlled arms run on a single evaluation model (qwen3.8-27b) at temperature 0」。端口：bc-partial/README.md L166 自管端口区自 18787 起。注记：bc 配置文档另有「现场案例：qwen 27b 没有任何提示就调用 compress」（bc-partial/docs/configuration.zh-CN.md L1494/L1497、configuration.md L291）——与论文引用的受控臂结论并存于 bc 自述，论文未夸大，但建议知悉（该案例恰说明 bc 需要反方向门禁） | 无 |
| V8 | 强表述审计（「第一手/首次/唯一」类）与单位口径 | ✅ CONFIRMED（两条保留） | 「第一手净省数据」（L152）、「两条独立证据线」（L120/L189）：无「首次折叠/唯一」类与档案冲突的断言；「两条独立证据线」的 bc 侧有 V7 档案支撑。单位口径逐项核对无错位：峰值=单轮 billedInput token（BENCH L87 turn42）；−44%/−24%=折叠次轮 billedInput 环比（L234）；−88.1%/−88.9%=被折区间 tokensBefore→After（L231-232）；0/20=轮次；32/33/32/1=判定/链/无选区/提交次数。保留两条：「第一手净省数据」编在 v0.3.0 名下，而时间上更早的净省首例是同波 P6-E f297（并入 ISSUES-2）；摘要 L51「裸官方路径计费输入增长 11.8×–18.4×」把 A/C 两组比值压进「裸官方路径」一个标签（C 是全默认组），建议拆写 | 低 |
| V9 | 引用完整性：正文 `<a href="#r4">`（L107）挂在 ctx-opt 七裁定句上；ref r3（REPORT-OPT.md）正文零引用 | ❌ REFUTED（引用错挂） | 实查：正文仅 3 处引用——#r2×2（L67/L96，正确）、#r4×1（L107）。r4=BENCH 基准报告（L203），不含七裁定表；r3=ctx-opt REPORT-OPT.md（L202，「七裁定表 D1–D7」原文所在）从未被正文引用。七裁定句应引 [3]（ISSUES-3） | 低。修复成本一行，但违反论文「按引用溯源」的自我标准（L47） |

## 独立复算命令输出摘要（可复现）

```
python（读 summaries/matrix-*.jsonl）:
A: n=50 ok=50 cum=36645904 first10avg=109181 last10avg=1288954(精确1288954.5) ratio=11.81 hitMean=98.2% steps=371 folds=0 max=3322963@turn42
B: cum=15509064 51927 644860 12.42 98.5% steps=240 folds=0
C: cum=20769088 42760 786044 18.38 98.3% steps=235 folds=0
C2: cum=509604（与 BENCH L85 一致）
python（读 harness/summary-p6f-*.jsonl）:
RUN1: n=20 cum=1255148 t14=72578 t15=54885
RUN2: n=20 cum=1208348 t18=102328 t19=57169
```
（以上与 paper 表 3/表 4、BENCH §5.1/§13.1 逐格相等；BENCH L224-225 累计两数亦吻合）

## ISSUES（VERDICT 附表）

1. **重放背书错挂两臂折叠**
   - 论文原文（index.html L180）：「两次折叠均由 compaction 供给生成模型摘要；评审独立重放 MATCH。」
   - 档案原文：BENCH-report.md L196「离线重放：折叠前精确表面（80 节点 12769 tokens）上 selectFoldSpans 返回唯一候选 [9..202] 5471 tokens——与运行时提交的 span/tokens 逐字一致｜归档脚本 harness/replay-f297.mjs…MATCH: true」；L119「f297 服务端折叠（评审独立重放 MATCH:true）+ P6-F 两臂 f290/f340 复证」；REVIEW-P6F.md L28（重放对象=f297）、L24（两臂核验=直读非重放）。
   - 建议改法：改为「两次折叠的净省由评审直读 session log 亲算复核（REVIEW-P6F §1.4）；同机制的首例折叠 f297（P6-E，5471→864，−84%）经评审独立重放 MATCH:true（BENCH §12.1）」；或为 f290/f340 补做归档重放后再保留原句。
2. **f297 整体缺位（选择性呈现风险）**
   - 论文原文：L58「40 轮自发折叠对照」；摘要 L51「autoFold 两臂折叠净省 −88.1%/−88.9%」；全文无 f297。
   - 档案原文：BENCH-report.md L192「foldId f297…tokensBefore 5471 → tokensAfter 864（净省 ~4607 tokens，−84%）」；L238「P6-E pilot 1/20；合计机制路线 3/60 轮、三会话各自恰好 1 次」。
   - 建议改法：§7.3（或表 4 加一行/脚注）补记 P6-E pilot f297 与「3/60、三会话各 1 次」总量口径；§1「40 轮自发折叠对照」改为「P6-F 两臂 40 轮（另有 P6-E pilot 20 轮，BENCH §12）」。此改动同时消解 ISSUES-1 的错位土壤，并使「全部数据可溯源」声明（L47/L220）完全成立。
3. **引用错挂：七裁定句引 [4]（BENCH 报告），应引 [3]（REPORT-OPT.md）**
   - 论文原文（L107）：「收敛为七项裁定<sup><a href="#r4">[4]</a></sup>」；ref r4=L203（zcontext 基准报告），ref r3=L202（ctx-opt REPORT-OPT.md，七裁定表所在）。
   - 档案原文：r3 自身即写明「REPORT-OPT.md（七裁定表 D1–D7…）」。
   - 建议改法：L107 的 href 改为 `#r3`。
4. **「65 条复核」不可考（疑与另一任务波串写）**
   - 论文原文：L107「在 65 条复核材料、一轮正反辩论后收敛为七项裁定」、L212「（终评 99/100，65 条复核）」。
   - 档案原文：ctx-opt-20261104 全目录无「65」计数（REPORT-OPT.md 336/338 行、progress 27 条、artifacts R1/R2/R3/D1-pro/D1-con/V1/V1b、终评 22 组锚点抽查）；本仓唯一「65 条」=tasks/ZCTX/handoffs/REVIEW-V6.md L42「closure 65 条 — 机器数吻合」（zctx v0.2.0 收口台账）。
   - 建议改法：改为档案可考口径（如「三份研究产物 + 正反辩论（12 攻击点）+ V1/V1b 补核 + 终评 22 组锚点抽查」）或删去具体数字；保留 99/100（有 scorecard 支撑）。
5. **时间线第 2/3 行窗口与实施档案冲突**
   - 论文原文（L212-213）：「2026-11-04~08 …ctx-opt…」／「2026-11-08~17 T0–T6 实施+遗留清零，CI 全门 40,915 测试；确认混血天花板」。
   - 档案原文：ctx-opt-20261104/progress.md 27 条全部 2026-11-04（终评放行、MAINLINE 收口均 11-04）；ctx-imp-20261104/progress.md 跨 11-04~11-06（「[2026-11-04] 开工…Wave A 派发（A1=T0+T6，A2=T1）」、T0/T1/T6 于 11-04 完成）；closure-mainline-final.json updatedAt=2026-11-06（CI 42361800930 success, 40915）；ctx-rel-20261108 收口 11-08~11-11（close-ledger 尾=11-11；LOADER-COMP 一项 open/post-merge 移交新卡）。无任何档案日期落在 11-12~17。
   - 建议改法：第 2 行改「2026-11-04：ctx-opt 方案（终评 99/100）→七裁定」；第 3 行改「2026-11-04~06：T0–T6 实施（CI 全门 40,915，run 42361800930）｜2026-11-08~11：收口波，确认混血天花板」。若坚持现窗口，须先在档案中找到 11-17 依据（本次检索未发现）。
6. **章内交叉引用指向不存在的 §8.x（改版残留）**
   - 论文原文：L63「（§8.1 表 2）」、L120「（§8.2）」、L126「（§8.4 的全部数据依赖此原则）」、L150「得到 §8.2 的 0/20」、L153「（§8.3）」。
   - 档案/现文：HEAD ccb9c53 的评估章为 §7（表 3=L162、采用率=§7.2、两臂=§7.3）；§8 为经验教训且无小节；现文「表 2」是 §5.3 分层架构表（L131）。§8.x 为上一版论文（29b673c）的残留编号。
   - 建议改法：五处分别改 §7.1 表 3／§7.2／§7.2-7.3／§7.2／§7.3。
7. **（措辞级，非数字）两处可选收紧**
   - L51「裸官方路径计费输入增长 11.8×–18.4×」：18.4× 属 C 全默认组，建议写「裸官方/全默认组计费输入增长 11.8×–18.4×」以与 L168 的「不做跨组声称」纪律自洽。
   - L58「40 轮自发折叠对照」的「对照」改为「两臂实测」（对照义让给 P6-D2 复测 0/20）。

## 未发现问题的核对清单（明确通过项）

- 表 3 全部 15 格数字、峰值 turn42、步数 371/240/235、命中 98.2/98.5/98.3、三组 fold=0——独立重算逐格相等。
- 表 4 全部数字与百分比、27/34 seqs（34 为 F3 更正后值，论文取更正值）、RUN1/RUN2 累计 1,255,148/1,208,348。
- 170=10+50×3+10；billedInput 定义；cacheWrite 全程 0 未被论文掩饰（BENCH-L4 如实在档）。
- 0/20、wire 三面实证（工具 4/4、guidance 逐字、nudge 615 chars）、32/33/32/1 遥测（评审独立亲数）。
- 40,915（run 42361800930）、99/100 终评、七裁定 D1–D7、tag zctx-autoui-20261121a、803 测试（commit ca502ef 消息「803 tests」）。
- 时间线 pi（2026-08-26/27）、v0.1.0（11-12）、v0.2.0（11-13）、v0.3.0（11-16）、面板/语言（11-19/21 tags）、论文发布（11-21 @ ccb9c53）。
- billion-context 27B 自述（bc 论文 paper/...md:267/:114 经 RES-bc-server-orchestration.md:197 与 RES-billion-context.md:363 转引在档）与 18787 端口（bc README.md:166）。

## CHECKPOINT

- ARTIFACTS: tasks/paper-verify/handoffs/verify-A-bench.md（本文件，唯一写入物）
- SCORE: 不适用（verify 产出为三值结论表；六维评分由主线按需组织）
- 汇总：V1✅ V2✅ V3a✅ V3b❌ V4✅ V5⚠️ V6a✅ V6b⚠️ V6c❌ V6d✅ V6e✅ V6f✅ V7✅ V8✅ V9❌ —— 核心基准数字全部成立；3 处需修（重放归因、f297 缺位配套表述、时间线第 2/3 行）+2 处引用/口径小修。

VERDICT: ISSUES
1. 论文原文 L180「两次折叠…评审独立重放 MATCH」／档案原文 BENCH L196+L119+REVIEW-P6F L28（重放对象=f297，非 f290/f340）／建议改法：改为「评审直读复核两臂（REVIEW-P6F §1.4）+ 同机制首例 f297 重放 MATCH（BENCH §12.1）」，或补做 f290/f340 归档重放。
2. 论文原文 L58/L51（40 轮、两臂，全文无 f297）／档案原文 BENCH L192（f297 5471→864 −84%）+L238（机制路线 3/60）／建议改法：补记 f297 与 3/60 口径，§1 改「P6-F 两臂 40 轮（另有 P6-E pilot 20 轮）」。
3. 论文原文 L107 引 [4]／档案原文 ref r3=L202（REPORT-OPT.md 七裁定表）／建议改法：href 改 #r3。
4. 论文原文 L107/L212「65 条复核」／档案原文：ctx-opt 档案无 65 计数；REVIEW-V6.md L42「closure 65 条」属 zctx v0.2.0 波／建议改法：换档案可考口径或删数字。
5. 论文原文 L212-213（11-04~08 方案／11-08~17 实施+遗留清零）／档案原文 ctx-imp progress 11-04~06、closure updatedAt 11-06（CI 40915）、ctx-rel 11-08~11／建议改法：改行 2-3 日期窗口为档案值。
6. 论文原文 L63/L120/L126/L150/L153（§8.1/§8.2/§8.4/§8.3）／档案原文：ccb9c53 无 §8.x 小节，评估章=§7／建议改法：五处改 §7.x。
7. （可选措辞）L51「裸官方路径…11.8×–18.4×」与 L58「40 轮…对照」／建议改法：拆组标签、改「两臂实测」。
