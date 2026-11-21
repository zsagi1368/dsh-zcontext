# verify-B：论文研究档案与工程事实类声明独立复核报告

- FROM: verifier-B TO: 主线
- MODE: verify
- TASK_REF: dsh-zcontext 论文 docs/paper/index.html（HEAD ccb9c536a0d8173c14877e71dbb84e349a4c6ac9，2026-11-21 版）研究档案与工程事实声明复核
- 方法：全部换独立渠道复核——原始研究档案（pi REPORT.md / REPORT-OPT.md / RES-billion-context.md / ADVERSARIAL-ROUND1-3 / checkpoint.json）、坑册 ZDSH-LESSONS.md、官方源码 zDSH-main 实读行号、本仓 CHANGELOG/README/src/reports 实读。不转抄论文自引。
- 结论分级：✅确认 / ❌证伪 / ⚠️无法验证（附尝试渠道）。共核对 46 条断言：38 确认、4 证伪（含 1 条数学方向性错误）、4 无法验证/部分无法验证。

---

## 逐条对照表

### 项 1：§2.2 六条解剖 + 数量级算术 vs pi REPORT.md §三

| 编号 | 原结论 | 验证结论 | 证据来源 | 影响评估 |
|---|---|---|---|---|
| 1.1 | 注入面框架级：packages 50+ 包（memory/hooks/plugins/workflow/goal/plan/todo/subagent/spill/schedule/jobs/guard/context…） | ✅确认（包名清单逐字一致，仅省略括注 time-context/tmux-context/session-reference） | zDSH-docs/R&D/pi-context-research/REPORT.md:113（§三.1） | 无 |
| 1.2 | 系统提示词插件瀑布装配：sections(order)+动态 contexts+工具 schemas+variables+附加节，静态文本远超 pi 1–2KB | ✅确认 | REPORT.md:114（§三.2，addHarnessSourceSection 附加节） | 无 |
| 1.3 | 动态上下文快照追加式：ContextForm catalog「republished as it changes」、RuntimeContextProjection 渲染变化即追加 | ✅确认（引文逐字在档） | REPORT.md:115（§三.3） | 无 |
| 1.4 | 缓存失效隐形放大器：动态内容进前缀则 cache 全灭、每轮全价重处理、计数不变费用暴涨 | ✅确认 | REPORT.md:125（§三·数量级算术）+ §六表（×10） | 无 |
| 1.5 | 子代理扇出 ×N：派生自带装配提示词+工具集 | ✅确认 | REPORT.md:116（§三.4） | 无 |
| 1.6 | llm 传输层已建在 pi-ai 之上（adapter.ts 直调 streamSimple）+ 限幅非差异点；差距在放多少/放多频繁 | ✅确认；且 adapter.ts:402 行号在 zDSH-main 当前检出精确命中 | REPORT.md:117-118（§三.5/6）；zDSH-main packages/llm/llm-pi-ai/src/adapter.ts:402 `snapshot.models.streamSimple(model, context, {` | 无 |
| 1.7 | 数量级算术：pi C≈3–5 万 N≈几百；重 harness C≈8–15 万 N≈上千、轻松破亿 | ✅确认区间；⚠️论文把 pi 总量写成「总量百万级」，档案原文为「总量几百万~千万级」 | REPORT.md:123-124 | 低：方向一致，量级表述收窄，建议按档案原文恢复区间 |
| 1.8 | （背景）当前本地 zDSH-main 检出 package.json=0.2.1-alpha.2、HEAD=95469c8（archived 2026-11-18） | ✅确认 | zDSH-main/package.json:3；git log -1 | 供 5.x 锚点条目参照 |

### 项 2：§2.3 三处残缺

| 编号 | 原结论 | 验证结论 | 证据来源 | 影响评估 |
|---|---|---|---|---|
| 2.1 | pruner 不读剪枝 meta：「缺口不是接线，是元数据没被消费」；fork 已实际调用官方 pruner | ✅确认 | REPORT-OPT.md:91（§2 背景：compaction-basic :302/:306/:339 调用已证，缺口=pruner 不读 L3 meta）；ctx-opt progress.md:37 第⑥⑦条独立复验 | 无 |
| 2.2 | types.ts:392 引文「tool-private meta presentation payload」 | ⚠️部分确认：引文逐字属实、meta?:JsonValue 字段属实；但引文在 docstring（REPORT-OPT 锚 ：372-373；当前本地树 :364-365），:392 是字段行——论文把引文挂在字段行号上；且本地 zDSH-main（alpha.2 内容）实为 meta:384/docstring:364-365，:392 仅与 REPORT-OPT 所核 alpha.3 期官方树一致 | REPORT-OPT.md:92 + progress.md:37 第⑩条；zDSH-main packages/core/session/src/types.ts:384/:364-365 实读 | 低：建议论文写「types.ts meta 字段（:392@alpha.3 期官方树）+ docstring :372-373 引文」，或注明锚点版本 |
| 2.3 | pruner 源码跨官方版本（alpha.2→alpha.3）blob 逐字节一致 | ✅确认（三 src blob 5f536bfc/3a2a376e/8cc6934b，+51/−2 全为 locale/package.json、src 零 hunk）。⚠️论文结论句「冲突风险极低」比档案登记的证据边界（「单窗证据不证永无冲突、显著冲突概率降为未证」）略强 | REPORT-OPT.md:111（§2.3.2 含边界声明） | 低：建议改为档案口径 |
| 2.4 | cache-metrics 只折 compaction/summary 不折 prune | ✅确认 | REPORT-OPT.md:104（:226-233 只折 compaction/summary；V1:R1-10 ✅） | 无 |
| 2.5 | 「语义作废≠物理剔除」是档案原意而非论文推断；论文保留了「若未剔除则堆积」的条件式与「发送视图是否真正剔除未定」的开放态 | ✅确认（档案原句：REPORT.md §三.3「旧快照靠 surface/replacement 机制语义上『作废』，但若不在发送视图里真正剔除，就是纯增量堆积」；§四.2 明列「验证 surface replacement 是否真的作用于 LLM 视图」为待验证项。论文 §2.2(3)/§2.3(c) 如实保留了条件式与未定态，未越界断言） | REPORT.md:115/:136 | 无 |

### 项 3：§3 五机制表、成本方程、方法论

| 编号 | 原结论 | 验证结论 | 证据来源 | 影响评估 |
|---|---|---|---|---|
| 3.1 | 五机制表：1–2KB 系统提示/零隐藏注入/2000 行 50KB 双上限/window−16k 才压/保留 ~20k/字节稳定前缀+摘要独立 session/无子代理 MCP 底噪 | ✅确认（七机制压缩为五行的归并忠实：thinking 不白烧与缓存一等公民两条被并入其他行，无内容失真） | REPORT.md §二.1-7（:37/:41/:46-52/:64-71/:79-89/:101-106） | 无 |
| 3.2 | 杠杆顺序 C→r→N 且不可反 | ✅确认 | CONTEXT-CACHE-MANAGEMENT.md §0「杠杆顺序：C 小 → r 高 → N 小」；REPORT.md:179「治理顺序：先压 C，再保前缀稳定，最后才是压缩策略调参」 | 无 |
| 3.3 | **成本方程 总费用≈ΣCᵢ×(1−r+r·κ)，其中 κ≈10（κ=前缀失效放大系数）** | ❌证伪（符号-数值配对颠倒）。档案原文：`总费用 ≈ Σᵢ Cᵢ × (1 − r + r·κ) + Σ wⱼ·η + M×C_comp×(1+分块+浓缩)`，且**κ≈0.1（Anthropic/DeepSeek 命中折价，OpenAI≈0.5）**；×10 是 1/κ（REPORT.md §六「命中价≈原价 10%」）。按论文的 κ≈10 代入：r=1（全命中）时公式给出 10×ΣC —— 经济方向颠倒。档案公式配 κ≈0.1 才自洽；「前缀一字节变化等效成本 ×10」这句单独看是对的（=1/κ），但不能与 (1−r+r·κ) 同式并用 | CONTEXT-CACHE-MANAGEMENT.md:12-15（v2.3 §0 成本方程+per-provider κ）；REPORT.md:170/:175-177（×10 表） | **中-高**：该方程是论文核心模型（摘要/§3.2/L2 三处出现）。修正成本一处符号，不动摇杠杆顺序与 ×10 放大结论 |
| 3.4 | 三轮对抗验证 BLOCKER 2→1→0 收敛 | ✅确认 | ADVERSARIAL-ROUND1.md:7（2 BLOCKER）；ROUND2.md:8（1 BLOCKER）；ROUND3.md:7（无 BLOCKER） | 无 |
| 3.5 | budget_table.py 公式唯一权威源（脚本化对拍） | ✅确认（CCM v2.3 头部「权威数值源：tools/budget_table.py（v2）…任何数值与脚本不一致即文档错误」）。注：该脚本权威域是 CCM 预算公式表，成本方程本体在 v2.3 §0——论文 §3.2 把两者并提，语义可读但不完全精确 | CONTEXT-CACHE-MANAGEMENT.md:7；tools/budget_table.py 在盘 | 低 |
| 3.6 | 七条可移植清单（①冻结前缀…⑦诚实计量四项口径+命中率） | ✅确认（七条逐条对上，⑦为「后来成为三态记账雏形」是论文自述非档案原文，可接受） | REPORT.md §四:135-141 | 无 |
| 3.7 | 摘要称 pi 为「实测最省的同类系统」，§3.1 称「pi 的 token 表现显著最优」 | ❌证伪（措辞超出档案）。档案选择 pi 的依据是**机制/设计层面的极简主义对照**（REPORT §一/§三、§六 Codex/Claude Code 对照均为源码-文档分析）；档案 §五明确把同基准实测列为「后续可选验证」未做。档案中无任何 pi vs 同类的实测 token 对照数据 | REPORT.md:147-148（§五「验证『几百万~千万』说法」「用同一基准任务分别在 pi 与 zDSH 上跑」=未做） | 中：建议改为「设计上最省的同类系统（机制推导）」或删「实测」；该措辞与论文「全部数据与结论可溯源」的元声明冲突 |

### 项 4：§4 七裁定与实施

| 编号 | 原结论 | 验证结论 | 证据来源 | 影响评估 |
|---|---|---|---|---|
| 4.1 | D1 wire-body observe-only 窄版（判定/测量分离、fail-closed 出口径，放弃镜像 rebase 500–700 行路线） | ✅确认 | REPORT-OPT.md:21（裁定表）/:44（L5-B ~500-700 行）/:59（fail-closed 出口径） | 无 |
| 4.2 | D2 pruner 窄版 ~20–35 行产品门后；D3 两步统一 1.3.0；D4 整取机械合并+proactive 挂起转产品门；D5 吸收 harness-dev-context=补官方已做升级；D6 oneShotCount 恒 0 显式豁免（非缺陷、可接受维护负债）；D7 Go 树唯一权威+T0–T6 全串行 | ✅确认（六项摘要与裁定表逐条一致；省略的子项【A1 单行对齐/快照生成器】属摘要级省略不失真） | REPORT-OPT.md:22-27（裁定表） | 无 |
| 4.3 | 「65 条复核、一轮正反辩论、终评 99/100」 | ✅确认（V1 55 条+V1b 10 条=65；辩论 1 轮收敛；终评 99/100 独立 verifier，scorecards/report-opt-final.json） | REPORT-OPT.md:4/:8；ctx-opt checkpoint.json:10；progress.md:37/:41 | 无 |
| 4.4 | anthropic 已证 / bedrock openai 未证（fetch 可达性与 body 编码） | ✅确认 | REPORT-OPT.md:58（§1.3.5） | 无 |
| 4.5 | T0→T1（0.84.2 残留→1.0.2→1.3.0）→T2（5 文件零文本冲突、proactive hunk 挂起存分支）→T3（adapter.ts:402 注入点，anthropic fetch 层 body 字节级验证）→T4→T5→T6 | ✅确认 | REPORT-OPT.md §8 路线表（:255-265）；§4.2（5 文件零文本冲突已证） | 无 |
| 4.6 | 40,915 项测试 + CI run 42361800930 | ✅确认 | ctx-imp checkpoint.json:9「run 42361800930 success (Windows Quality Gate, 40915 tests, lint+docs all gates)」；close-ledger.md:6 | 无 |
| 4.7 | 教训一「研究期验证集跑绿就合入，CI 全门逐项爆雷」 | ✅确认机制（合并后 CI 修复轮 13+ 条 fixed，全部为 T2/T3/T5/R 线遗留逐项爆雷；「6 连发」的具体次数无法从台账精确点数——台账记「success ×6 连绿」修复链） | ctx-imp close-ledger.md CI 修复轮条目表 | 低：「6 连发」建议核对原始 CI 记录或改为「连串爆雷」 |

### 项 5：§5 billion-context

| 编号 | 原结论 | 验证结论 | 证据来源 | 影响评估 |
|---|---|---|---|---|
| 5.1 | 第三方上下文管理插件、DSH 生态在册 | ✅确认（npm billion-context，GitHub ranxianglei/billion-context，README 客户端列表含 deepseek-harness (dsh)） | zDSH-docs/R&D/zctx-20261112/ref/bc-partial/README.md:1-17；ref/bc-npm/meta.json | 无 |
| 5.2 | 侧车形态 + 「本地实测：node 进程 start --host 127.0.0.1 --port 18787」 | ⚠️无法验证实测事件；形态与端口语义确认：bc 文档明示 local sidecar、默认绑定 127.0.0.1、--host/--port CLI 旗标存在、18787=自管端口区基座（EADDRINUSE 18787→18788…）。本地档案（zctx-20261112 全目录、DESIGN-NOTES、REPORT-GO-NO-GO、BENCH-report、zctx 仓 tasks/docs）grep「18787/start --host」零实测记录 | bc configuration.md:467-474、technical-notes.md:36、instance.ts:99、README.md:164-168/:499-515 | 低-中：论文元声明称全部可溯源，此条无原始记录；建议补一条实测记录或降格为「bc 文档形态描述」 |
| 5.3 | 「固定水位：无论窗口大小，把上下文维持在 ~100k 常驻水位」 | ⚠️部分确认（概括性转述）：bc README 口号「small context windows (100K is enough)」+「month-long single sessions (billions of tokens)」；但其压缩机制官方描述为**增长间隔触发**（compress.nudgeGrowthTokens 平 50K、刻意不随窗口缩放，README:415-424 FAQ），非字面「固定水位 100k」。「keep ~100k」的概括在仓内已有先例（CHANGELOG [Unreleased] 水位注、review-A1 建议-3） | bc README.md:5/:415-424；RES-billion-context.md:273；dsh-zcontext CHANGELOG.md [Unreleased] 水位注 | 低：建议注明「bc 官方描述为窗口无关的增长间隔压缩，~100k 为概括」 |
| 5.4 | 「主张长期运行、永不遗忘」 | ⚠️部分确认：「长期运行」✅（month-long single sessions）；「永不遗忘」为论文转述——bc 文本层最接近的表述是「被压缩过的会话永不删除」（README.zh-CN:494 GC 条款）+ search/decompress 可回取，非口号原文 | bc README.md:5；README.zh-CN.md:494 | 低 |
| 5.5 | 「公开自述：27B 级小模型上模型自发采用折叠的比率为零」——「公开自述」层级是否恰当 | ✅确认且层级恰当：该断言是 billion-context 项目**自己的论文/技术注记自述**（其 §8.1 受控实验：qwen3.8-27b、自发工具采用率为零、模型只在被指示时才 restore/compress），我方档案如实转述并保留出处；论文用「公开自述」而未冒充独立验证，措辞恰当 | RES-billion-context.md:363（逐字引用 bc 原文 limitations + §8.1 结论） | 无 |

### 项 6：官方源码锚点抽查（zDSH-main 本地检出）

| 编号 | 原结论 | 验证结论 | 证据来源 | 影响评估 |
|---|---|---|---|---|
| 6.1 | compaction-basic maxOverflowRetries | ✅确认在场：index.ts:89/:102/:125（schema/config）+:200（`retries >= policy.maxOverflowRetries` 消费点，与「约 194-200」相容；REPORT-OPT 期为 ：223，树随版本漂移） | zDSH-main packages/compaction/compaction-basic/src/index.ts | 无（论文未给具体行号） |
| 6.2 | llm/src/error.ts:25 CONTEXT_WINDOW_EXCEEDED | ✅确认精确命中：:25 `export const CONTEXT_WINDOW_EXCEEDED_CODE = 'CONTEXT_WINDOW_EXCEEDED'` | zDSH-main packages/llm/llm/src/error.ts:25 | 无 |
| 6.3 | vendor/cordis/src/events.ts:221-236（listener 组合顺序） | ✅确认：:222-232 waterfall 组合 docstring（outermost-first、不调 next 即 veto）+:234 `waterfall(...args)`，全落 221-236 窗口 | zDSH-main vendor/cordis/src/events.ts:218-240 实读 | 无 |
| 6.4 | [r1] 版本标签「zDSH-main 0.2.2-rc.5」 | ⚠️无法验证：本地 zDSH-main package.json=0.2.1-alpha.2，全树/tag 无 0.2.2-rc.5（tag 尾为 v0.2.1-alpha.2-zDSH*）；rc.5 仅在 patcher fixture（nightly-rc5-real.yml）作为官方 desktop 产物版本出现。论文把锚点系于「zDSH-main 0.2.2-rc.5」但本地无该版本树可核；types.ts 行号（:392）只能对上 REPORT-OPT 所核的 alpha.3 期官方树 | zDSH-main package.json:3；git tag 列表；ZDSH-LESSONS.md:204（nightly-rc5-real.yml） | 低-中：建议 [r1] 改为「zDSH-main 本地检出（alpha.2 内容，锚点行随版本 ±8 漂移）+ REPORT-OPT alpha.3 期锚点」双口径 |
| 6.5 | system-prompt 瀑布装配 / runtime-context 快照追加 / message.ts ContextForm | ✅确认文件均在场（锚点未逐行复核核心逻辑，§2.2 内容已由项 1 档案+抽点覆盖） | zDSH-main packages/core/system-prompt/src/index.ts、core/agent-loop/src/runtime-context.ts、llm/llm/src/message.ts | 无 |

### 项 7：§6 各版本 vs 坑册与 CHANGELOG

| 编号 | 原结论 | 验证结论 | 证据来源 | 影响评估 |
|---|---|---|---|---|
| 7.1 | v0.1.0 W3-1：checkpoint mock 全绿≠真机对 | ✅确认（W3-1=checkpoint 载荷信封形态偏离官方裸 UserMessage 契约，189 mock 全绿但官方 lib 探针实证真实宿主上投影畸形；W3+W4 初评 77/86→返工→复审 99/100）。⚠️措辞歧义：「裸 UserMessage checkpoint 在 mock 下通过」字面可读反——通过 mock 的是信封形态，裸 UserMessage 是修复目标形态 | tasks/ZCTX/handoffs/REVIEW-W3W4.md:28-56/:45；progress 同源 | 低：建议改为「checkpoint 未按官方裸 UserMessage 契约提交，mock 全绿而真实宿主投影畸形」 |
| 7.2 | v0.2.0 Z27 多目标 splice offset 平移 | ✅确认（Z27=asar 多目标 splice 目标 offset 须随前序 delta 平移，2026-11-16 P6-B patcher 实证） | ZDSH-LESSONS.md:165-169 | 无 |
| 7.3 | 「Z28（基准残留 enabled:false 定谳）+三重证据（38 工具无 zctx/系统提示无 zctx/行为零调用）」 | ⚠️部分证伪（引用错位）：三重证据与 38 工具全列确属 Z28 **现象面**（P6-D，170 轮零 zctx_fold、模型证词 38 工具全列零 zctx_*）；但「enabled:false 残留定谳」在坑册中是 **Z29**（组态切换状态泄漏+dump 假绿，B 组残留两份 enabled:false 块、20+ 天后 ZCTX_DEBUG 定谳），Z28 本体是「fail-soft logger 无 sink」教训。论文 L4 亦把定谳记在 Z28 名下 | ZDSH-LESSONS.md:171-175（Z28）/:177-181（Z29）；BENCH-report.md §6/§11.1；close-ledger BENCH-L1 | 低：事实内容全部属实，仅坑册编号归属错位；建议「Z28 现象+Z29 定谳」或「Z28/Z29 家族」 |
| 7.4 | v0.3.0 Z33 `>-` 块标量杀严格解析器（真机 smoke 逮住）+补丁自愈计划任务 | ✅确认（Z33 原文逐条吻合；自愈=README:203「Self-heal (v0.3-auto)」计划任务 install-task/uninstall-task、官方升级后 auto-repair）。⚠️论文「auth 探测」疑为「anchor/锚点探测」笔误——README 原文探测面是 Electron fuse wire 完整性哨兵+anchor 匹配，无 auth 探测 | ZDSH-LESSONS.md:201-205；README.md:202-203 | 低：「auth」改「锚点（anchor）/fuse 哨兵」 |
| 7.5 | 后续波 Z34（inject 漏 webServer→404）/Z35（bundle 少 `}` 握手假绿）/Z37（受控表单只读）/Z38（三联探针：宿主进程+监听端口+API 200） | ✅确认（四条与坑册逐条吻合，日期 11-19/11-19/11-21/11-21 均在 11-16~21 波内） | ZDSH-LESSONS.md:207-236 | 无 |
| 7.6 | 803 项测试 | ✅确认（ZCTX-AUTOUI progress.md:1「803/803 tsc0 handshake5/5」；本地静态 it() 计数 774+it.each 扩展+目录外用例与之相容） | tasks/ZCTX-AUTOUI/progress.md:1 | 无 |
| 7.7 | §6.2 版本标签「v0.2.0（补丁面与基准对照）」辖 patcher v0.2 多文件+guard-observe 桥+Phase 2 基准 | ⚠️部分证伪（版本归属失真）：CHANGELOG v0.2.0（11-13）=观测账本+S1 preflight+S2 路由；patcher v1（P4）在 v0.2.1（11-14）；**patcher v0.2 多文件+guard-observe 桥+Phase 2 基准全在 v0.3.0 节（P6-B/C/D，11-16 发布）** | CHANGELOG.md:74-90/:177/:326 | 低：叙事波次与发布版本号错位，建议按「P4/P6-B/C/D 波（内容随 v0.3.0 发布）」表述 |
| 7.8 | SQLite 账本 node:sqlite、WAL、~/.dsh/zctx/ledger.db、官方 session-query 同款驱动 | ✅确认 | src/storage/db.ts:4/:22/:98/:173-175 | 无 |

### 项 8：§5.2/§5.4/§6 机制表述

| 编号 | 原结论 | 验证结论 | 证据来源 | 影响评估 |
|---|---|---|---|---|
| 8.1 | required:true 注册因官方组装器过滤非必需贡献 | ✅确认 | zDSH-main core/system-prompt/src/index.ts:582/:587（filter `required === true`、suppressed 时非 required continue）；CHANGELOG v0.1.0 nudge 条目 | 无 |
| 8.2 | margin 0.9；auto 档默认；阈值 8/4/15（同 route 最近 8 条可比 ≥4 且 worst ≤15%）；冷启动/故障退 observe；enforce=单终结 CONTEXT_WINDOW_EXCEEDED chunk；误报消耗一次 maxOverflowRetries | ✅确认（常量逐字命中：PREFLIGHT_AUTO_SAMPLE_WINDOW=8/SAMPLE_MIN=4/ERROR_LIMIT_PCT=15/DEFAULT margin 0.9；「unpromoted auto behaves EXACTLY like observe」「auto-enforce cannot feed itself」） | src/preflight.ts:17-18/:112-128/:379-381/:507-537；CHANGELOG v0.2.0 R9/HF-06 | 无 |
| 8.3 | no-qualified-span 诚实退出（零摘要调用）；32 HIT/33 chain/32 no-op/1 committed | ✅确认 | BENCH-report.md §13.1/:175（CHANGELOG v0.3.0「32 HITs, 32 honest no-qualified-span no-ops, 1 commit」） | 无 |
| 8.4 | 防反馈环=摘要调用 purpose 豁免+nudge 基线清零 | ✅确认 | CHANGELOG v0.3.0（purpose-marked，三监听器与 session log 对摘要调用全盲；anti-feedback-loop nudge baseline reset）；BENCH-report §12.1 防反馈环行 | 无 |
| 8.5 | 表 3 计费矩阵全部数字（36,645,904/109,181/1,288,955/11.8×；15,509,064/12.4×；20,769,088/18.4×；98.2%；峰值 3,322,963；步数 371/240/235；不做跨组声称） | ✅确认（逐字对上 BENCH §5.1/§5.2） | reports/bench/BENCH-report.md §5.1/§5.2 | 无 |
| 8.6 | 表 4 f290/f340 全部数字（[9..111] 27 seqs 5195→619 −88.1% 次轮 72,578→54,885 −24%；[9..128] 34 seqs 5739→638 −88.9% 102,328→57,169 −44%；compaction 供给；评审重放） | ✅确认（BENCH §13.1 逐字对上；重放锚：f297 replay MATCH:true 在档，f290/f340 以 evidence JSON+session log 一手事件为据——论文「评审独立重放 MATCH」对 f290/f340 未在 BENCH §13 找到逐字重放记录，重放脚本先例仅 f297。计为低风险措辞偏宽） | BENCH-report.md §13.1/:190-199 | 低：f290/f340 的「重放」措辞建议改为「评审独立取证/复证」（f297 才有 MATCH 重放） |

### 项 9：时间线与日期

| 编号 | 原结论 | 验证结论 | 证据来源 | 影响评估 |
|---|---|---|---|---|
| 9.1 | 2026-08 下旬：一+二（pi 深研、方程 v2.3、七条清单） | ✅确认（REPORT 研究日期 2026-08-26；CCM v2.3=2026-08-27；档案文件 08-26~29） | REPORT.md:6；CONTEXT-CACHE-MANAGEMENT.md:2 | 无 |
| 9.2 | 「2026-11-04~08 ctx-opt 最优方案（终评 99/100）→七裁定」 | ⚠️部分证伪：ctx-opt 研究+终评实际完成于 **11-04 单日**（REPORT-OPT 日期 2026-11-04；progress 终评条目 2026-11-04）；11-05~07 是实施波不是 ctx-opt | REPORT-OPT.md:3；ctx-opt progress.md:37/:41 | 中：与 9.3 合并修正 |
| 9.3 | 「2026-11-08~17 T0–T6 实施+遗留清零，CI 全门 40,915；确认混血天花板」 | ❌证伪（日期错位）：T0–T6 实施=**ctx-imp 2026-11-04~07**（progress 全部条目 11-04/05/06；tag v0.2.1-alpha.2-zDSH-**CTXIMP20261107a**；Mimosa scan 2026-11-07T01:11）；11-08~11=ctx-rel 发布核验波（progress 日期 11-08/09/11）；11-12~17 无 ctx 侧实施记录（11-12 起已是 zctx-20261112 新战役）。「确认混血天花板」出自 GO-NO-GO（11-12+），属阶段四开篇 | ctx-imp progress.md 日期分布；checkpoint.json tag 字段；close-ledger.md:9；ctx-rel-20261108/progress.md 日期分布 | **中**：论文自称「按真实时间线组织」，行 2/3 两行起止均错位；建议改为「11-04 ctx-opt 方案与终评；11-04~07 T0–T6 实施+CI 全门 40,915；11-08~11 发布核验；11-12+ GO-NO-GO 确认混血天花板」 |
| 9.4 | 「11-12~15 v0.1.0；发现 billion-context；v0.2.0 patcher+基准」 | ⚠️部分确认：v0.1.0=11-12 ✅；发现 billion-context=11-12 ✅（RES-billion-context 日期 2026-11-12）；patcher v1=11-14（v0.2.1）；patcher v0.2 多文件+基准=11-16（v0.3.0 辖）——版本标签见 7.7 | CHANGELOG.md 版本日期；RES-billion-context.md:2 | 低（随 7.7 修正） |
| 9.5 | 「11-15~16 Phase 2 矩阵→0/20→v0.3.0」「11-16~21 两臂→面板/语言→论文发布」 | ✅确认（P6-D/D2/E/F 均执行于 2026-11-16；v0.3.0=11-16；UI/SIDEBAR/FULLPANEL 11-19~21、AUTOUI 11-21、论文落款 2026-11-21） | BENCH-report.md 各节日期；CHANGELOG.md:74；ZDSH-LESSONS Z34-Z40 日期 | 无 |
| 9.6 | 仓库公开地址 github.com/zsagi1368/dsh-zcontext | ✅确认 | git remote -v = https://github.com/zsagi1368/dsh-zcontext.git | 无 |

---

## 独立复核中确认无误的关键链（抽样重放）

- 成本方程档案原文与 κ 取值：CONTEXT-CACHE-MANAGEMENT.md:12-15（本报告 3.3 的证伪依据即来自对该文件 :15 的直接实读）。
- BLOCKER 计数：三个 ADVERSARIAL 文件结论概览行直接点数。
- 40,915/CI run：ctx-imp checkpoint.json:9（非论文自引文件）。
- 8/4/15 与 0.9：src/preflight.ts 导出常量行号 :118-126/:379-381。
- adapter.ts:402：zDSH-main 实读命中。
- f290/f340 数字：BENCH-report §13.1 表格逐格比对。
- 803/803：ZCTX-AUTOUI/progress.md:1。
- 65 条/99 分/1 轮辩论：REPORT-OPT 头部 + checkpoint.json + scorecards/report-opt-final.json 在盘。

## 影响评估（总）

- **不动摇整体结论**：六条解剖、三处残缺、五机制、七裁定、40,915 测试、11.8×/−88%/0/20 等全部实证数字经独立渠道逐字核实为真；billion-context 27B 自述的「公开自述」层级使用恰当。
- **需修正的 4 条**：①κ 符号-数值配对（数学方向，出现在摘要/§3.2/§2.2(4)/L2 四处）；②时间线行 2/3 日期错位；③「实测最省」措辞超出档案证据；④Z28/Z29 编号归属（低危）。其余为引用精度/内部交叉引用类小疵，不影响任何结论。

## CHECKPOINT

- ARTIFACTS: tasks/paper-verify/handoffs/verify-B-archives.md（本文件）
- 证据基线：论文 docs/paper/index.html@ccb9c53；REPORT.md 180 行；REPORT-OPT.md 338 行；ZDSH-LESSONS.md 248 行；CHANGELOG.md 470+ 行；zDSH-main@95469c8；BENCH-report.md 4 节实测数据。
- 无状态文件写面；对象仓除本 handoff 外零写入。

VERDICT: ISSUES
- [I-1·必须修] 论文摘要/§3.2/§2.2(4)/L2「ΣCᵢ×(1−r+r·κ)，κ≈10（前缀失效放大系数）」｜档案原文「总费用≈ΣCᵢ×(1−r+r·κ)+Σwⱼ·η+…，per-provider κ：Anthropic/DeepSeek≈0.1、OpenAI≈0.5」（CONTEXT-CACHE-MANAGEMENT.md:12-15；×10=1/κ，REPORT.md §六）｜建议改法：保留公式形状，κ 写「≈0.1（命中折价；前缀失效放大=1/κ≈10）」，或公式改写 (1−r+r/κ) 配 κ≈10；三处正文同步。
- [I-2·必须修] 附录时间线行 2「2026-11-04~08 ctx-opt 最优方案」与行 3「2026-11-08~17 T0–T6 实施+遗留清零」｜档案：ctx-opt 终评完成于 11-04 单日；T0–T6 实施=ctx-imp 11-04~07（tag CTXIMP20261107a、Mimosa scan 11-07）；11-08~11=ctx-rel 发布核验；11-12+ 才确认混血天花板｜建议改法：行 2 改「11-04 ctx-opt 终评 99/100→七裁定」；行 3 改「11-04~07 T0–T6 实施+CI 全门 40,915；11-08~11 发布核验；11-12+ GO-NO-GO 确认混血天花板」。
- [I-3·必须修] 摘要「pi 框架（实测最省的同类系统）」、§3.1「pi 的 token 表现显著最优」｜档案：pi 的选择依据为机制/设计层对照分析，§五明确把跨系统实测列为「后续可选验证」未做（REPORT.md:147-148）｜建议改法：改「机制设计上最省的同类对照系统」或删「实测」。
- [I-4·建议修] §6.2/L4「Z28 家族/Z28」承载 enabled:false 定谳｜档案：定谳在 Z29（ZDSH-LESSONS.md:177-181），Z28 是 fail-soft logger sink 教训（:171-175）｜建议改法：「Z28 现象+Z29 定谳」。
- [I-5·建议修] [r1]「zDSH-main 0.2.2-rc.5」+「types.ts:392『tool-private meta presentation payload』」｜档案/实读：本地树 alpha.2 内容 meta=:384、docstring=:364-365；:392/:372-373 是 REPORT-OPT 所核 alpha.3 期锚；引文属 docstring 非 :392 字段行｜建议改法：注明锚点版本（alpha.3 期官方树），引文与字段行分开标注。
- [I-6·建议修] §2.1「（§8.1 表 2）」、§6.2「§8.2」、§6.3「§8.3」三处内部交叉引用悬空（对应内容在 §7.1 表 3/§7.2/§7.3）｜建议改法：改为 §7.x 实际节号。
- [I-7·建议修] §6.3「auth 探测」｜档案：README.md:203 探测面为 Electron fuse 完整性哨兵+anchor 匹配，无 auth 探测｜建议改法：「锚点/熔丝探测」。
- [I-8·建议修] §6.2 版本标签「v0.2.0（补丁面与基准对照）」｜CHANGELOG：patcher v0.2 多文件+guard-observe+Phase 2 基准随 v0.3.0 发布（P6-B/C/D，11-16）；v0.2.0（11-13）=观测账本/S1/S2｜建议改法：按波次（P4/P6-B/C/D）或「v0.2.x~v0.3.0」表述。
- [I-9·可选] §3.2「pi…总量百万级」应为档案「几百万~千万级」；§2.3(a)「冲突风险极低」应为档案边界「单窗证据把显著冲突概率降为未证」；§7.3「评审独立重放 MATCH」对 f290/f340 应为「独立取证/复证」（MATCH 重放先例仅 f297）；§5.1「本地实测 node 进程 start --host…18787」建议补实测记录或降格为文档形态描述。
