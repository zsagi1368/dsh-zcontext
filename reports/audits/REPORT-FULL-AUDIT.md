# REPORT-FULL-AUDIT — dsh-zcontext 全量审计总报告 + P3 修复清单冻结（全量审计令 G）

- 任务卡：tasks/ZCTX/cards/CARD-AUD-G-synthesis.md（TASK_ID: ZCTX-AUD-G）
- 执行人：synthesizer（裁决规则：客观数据 > 逻辑论证 > 主观断言；评审人 ≠ 作者链完整）
- 日期：2026-11-14 · 基线 commit：391990f（src/tests 工作区零改动，与 E 域重放基线一致）
- 唯一写入件：本文件。未改任何代码、未动其他仓内文件（纪律：只读审计，只写本报告）。
- 查册：开工首查 ~/.agents/rsi/INDEX.md，命中并转为执行检查项：A14/A25（报告一律 Write 工具，零 heredoc）、A43（路径形态）、W4（结论强度 ≤ 证据强度）、B13（0 命中不作「原文无」结论）、A56（承重主张回源复核——本报告 §1.4 抽查三件）。

---

## §1 任务回顾

对 dsh-zcontext 11 波累积后的整树（基线 391990f）执行全量审计收口：汇总编队七域（A/B/C/D1/D2/E/F）产出，裁决分歧，产出四真缺陷的完整证据链，并冻结 P3 修复清单（分层：必修 / 强化 / 盲区钉测 / 结构）。本报告是编队审计的最终交付物；P3 清单冻结后进入修复排期，逐条以「AUD-*.md 条目 ID + E 域复现状态」为处置证据。

### §1.1 输入清单（全部已交付，均实读）

| 域 | 产出 | 作者角色 | 位置 |
|---|---|---|---|
| A | 主线 codegraph 亲审三流结论（fold/unfold/preflight/adapter 管线） | 主线 | 未独立落盘；经 AUD-architecture.md:7 引用（「主线已亲审三条关键流，本报告为全树横切视角，与主线结论不重复」）——见 §8 透明项 T-1 |
| B | VERIFY-P：P1+P2 承重主张三值复核 12/12 + 2 修正 | verifier | G:\000Github\zDSH\zDSH-docs\R&D\zctx-20261112\VERIFY-P.md |
| C | AUD-architecture：全树架构审计，健康度 8.5/10，无缺陷级发现 | architect | reports/audits/AUD-architecture.md |
| D1 | AUD-state-machines：状态机域 12 条 = 2 真缺陷 + 5 边界强化 + 5 覆盖盲区 | reviewer | reports/audits/AUD-state-machines.md |
| D2 | AUD-host-faces：宿主集成面 15 编号 = 2 真缺陷 + 8 边界强化 + 4 覆盖盲区 + 1 正面存证（HF-14） | reviewer | reports/audits/AUD-host-faces.md |
| E | AUD-verification-replay：电池 8/8 全绿重放 + 四真缺陷复现确认（无一误诊） | tester | reports/audits/AUD-verification-replay.md |
| F | 主线 RSI 自审：Z19 缺口捕获（stale 产物假绿） | 主线 | tasks/ZCTX/progress.md V4 段 [19:55] 条目 |

### §1.2 执行流程（agent 链）

planner（审计令分解）→ 主线 codegraph 亲审（A）→ verifier（B 域 12/12）→ architect（C 域横切 8.5/10）→ reviewer ×2（D1 状态机 / D2 宿主面，与 C 域显式划界不重复计条）→ tester（E 域重放 + 复现裁决）→ 主线 RSI 自审（F 域 Z19）→ synthesizer（本报告：交叉验证 + 裁决 + 冻结）。全程只读（E 域复现脚本置于仓外 Temp，D1/D2/E 均声明仓内零文件修改）。

### §1.3 E 域重放结论（P3 清单「当前态」可信度基座）

- 全量电池 8/8 全绿且与各波自报逐项一致：build 992.98 kB / 7 files、vitest 429/429（22 文件）、tsc --noEmit 0 错、probe-artifact 6/6、verify-activation-surface 10/10、smoke-real-loader 3/3、probe-host-imports 16/16、probe-real-mount 5/5。
- 新鲜度守卫 PASS（Z19 口径三判据）：build start epoch 1794676875 > src 最后触改 epoch 1794670924（差 5951s）；`git status --porcelain src/ tests/` 空；vitest 在 build 之后运行。
- 一次 harness 自纠（SM-02 复现脚本 NaN 判型）如实记录，不构成误诊；缺陷行为自始至终稳定复现。

### §1.4 synthesizer 抽查复核（裁决依据，非新论点）

按对抗验证纪律（A56）对三条承重主张回源实读，全部对上：

1. `package.json` scripts.test = `"vitest run"`（本波 node 直读）——build 未前置，Z19 缺口在 package.json 层面仍未固化，P3-必修 Z19 条目成立。
2. `src/plugin.ts:224` `static inject: string[] = ['tools', 'systemPrompt', 'commands', 'llm', 'tokenMeter', 'sessions']`——六键含 `'sessions'`，与 D2/E 引用一致。
3. `tests/store.spec.ts:289`「treats duplicate delivery of one seq as a no-op」实读：事件仅显式投递一次（注释写 duplicate，实际是首次投递；mock-session 的 onAppend 监听未接线），`samples===1` 断言通过 ≠ 重复投递被守卫——D1/E 的「测试误标」判定成立。

---

## §2 编队七域结论汇总表

| 域 | 结论 | 缺陷级发现 | 覆盖面 | 置信度 |
|---|---|---|---|---|
| A 主线亲审 | fold/unfold/preflight/adapter 三条主干流管线亲审通过；与 C 域横切视角互补不重复 | 0（主干正常路径） | 三条关键流行为 | 主线直读（未独立落盘，经 C 引用） |
| B verifier | 12/12 承重主张 ✅ CONFIRMED；go-no-go 三项（#3/#9/#11）全过；2 修正移交文档侧 | 0（结论层）；细节 2 处措辞/编码修正 | rc.2↔rc.3 漂移 + 桌面安装面 + pi-ai 补丁面 | 高（复核渠道与原报告不同源：tarball/raw/npm/Electron 源码/机器字节实读） |
| C architect | 健康度 8.5/10；跨波契约一致、依赖单向零环、447 导出 0 死代码、五方配置一致；无 [缺陷] 项；TOP3 建议 | 0 | src 28 文件 11,418 行全量 + 全树 import 图 + 447 导出符号全枚举 | 高（程序化提取 + 全词边界枚举，B13 纪律） |
| D1 reviewer | 12 条：SM-01/SM-02 真缺陷，SM-03/04/05/06/12 边界强化，SM-08/09/10/11/13 覆盖盲区；官方互斥孪生 8 形态推演全吻合 | 2 真缺陷 | store/attribution/fold-engine/validator/materialize 攻击序列视角 | 高（file:line 直证 + 官方语义对照） |
| D2 reviewer | 15 编号：HF-01/HF-02 真缺陷，HF-03..08/13/15 边界强化，HF-09..12 覆盖盲区，HF-14 正面存证（enforce 短路官方计量面零影子）；rc.3 三项适配判定全部「无需适配」；R1-R8 全 PASS | 2 真缺陷 | plugin/tools/observe/preflight/command/adapter 八模块 + config/host-llm 攻击者视角 | 高（官方源码 file:line 交叉验证；4 项未解决已如实标注） |
| E tester | 电池 8/8 全绿无漂移；四真缺陷 SM-01/SM-02/HF-01/HF-02 全部复现成功（5/5·4/4·7/7·3/3），无一误诊 | 4 复现确认（裁决：全部维持真缺陷分级） | 全量电池 + 新鲜度 + 四缺陷端到端复现 | 最高（客观数据，可复跑脚本 exit 0×4） |
| F 主线 RSI | Z19 缺口捕获并当波修复流程（build→test→tsc→probe 顺序固化）；查册命中条目全部转检查项执行 | 1 流程缺口（Z19） | 测试产物新鲜度纪律 | 高（当波两次连续绿复现实证） |

**总判定：主干流（正常路径）三方亲审 + 全量电池重放全绿，无主干缺陷；全部 4 条真缺陷集中在异常输入面与声明纪律面（重复投递 / 畸形数值 / 图片路由 / inject 键），且全部经 E 域端到端复现确认。基线健康，P3 清单可冻结。**

---

## §3 A+C+F 三视角交叉验证点

三视角 = 主线 codegraph 亲审（A，管线行为）× architect 横切（C，结构卫生）× 主线 RSI 自审（F，流程/工具链纪律）。交叉后确认的要点：

1. **applyEvent 单一迁移——三视角接力收敛为同一条真缺陷（SM-01）**：
   - C 域（结构视角）§4：attach/live/resync 三路汇入 applyEvent，「双制度一致 by construction」成立，但「feed 有序唯一假设无守卫」，定级【注意】（「真实宿主契约下不可达，属假设未钉」），列入 TOP3-2。
   - D1（行为视角）§1：给出完整腐败攻击序列（fold 复活 / compaction 括号重开 / 计数膨胀 / lastSeq 回退级联重放 / 乱序归因失真）+ 测试误标实锤，升级为真缺陷；并在处置节显式标注「与 C-TOP3 关系=行为扩展非重复，禁止 duplicate 误关」。
   - E（测试视角）§3：5/5 REPRO——A 序列逐字成立 + D 序列「3 条真实事件最终计成 5 条 usage 记录」（腐败自我放大）。
   - **裁决**：三视角不冲突——C 的「假设未钉」与 D1 的「可达腐败」是同一事实的两个粒度；以客观数据（E 5/5）为准，定级真缺陷，C-TOP3-2 并入 SM-01 同修（不重复计条）。
2. **主干流健康三方互证**：A 域亲审 fold/unfold/preflight/adapter 正常路径无缺陷；C 域全树横切无 [缺陷] 级发现（无依赖穿透/环/死代码/契约无声破坏/状态机不变量破坏）；E 域 429/429 + 五探针全绿。三方独立方法（管线直读 / 结构横切 / 全量重放）结论一致——主干流的正确性有充分证据。
3. **真缺陷的分布规律（交叉结论）**：四条真缺陷全部位于「防御纵深 / 异常注入 / 声明纪律」维度，无一条在主干正常路径上——SM-01 需宿主 feed 违约或 mock 直注，SM-02 需畸形 source 载荷投毒，HF-01 是「官方投影先行导致拒图门不可达」的契约矛盾，HF-02 是「声明而零消费的硬依赖」。这与 C 域「结构卫生良好」的判定自洽：结构卫生好 ≠ 异常输入面防御完备，两维独立。
4. **F 域 Z19 缺口已被 E 域按固化纪律闭环验证**：F 域当波捕获 Z19（smoke.spec 导入 lib/index.js，vitest 先于 lib 重建跑→config 钉吃 stale V3 产物假绿）并修复流程（build→test→tsc→probe 顺序）；E 域重放显式执行该顺序且新鲜度三判据 PASS。但 **package.json 层面未固化**（本报告 §1.4 抽查：scripts.test 仍为 `"vitest run"`）——流程纪律靠人执行的部分已闭环，靠脚本强制的部分仍缺口，故 Z19 入 P3-必修。
5. **B 域与 C/D1/D2 域零冲突**：B 域复核的 rc.3 消费面零漂移、LlmError 收窄不影响短路码、pi-ai 1.3.0 onPayload 存在——为 D2 §6「rc.3 三项适配判定全部无需适配」提供独立同源证据（不同渠道：tarball/raw/npm vs zDSH-main 实读），双向印证。

---

## §4 四真缺陷证据链（审计发现 → E 复现确认 → 修复建议）

以下每条证据链闭环：D 域发现 → E 域端到端复现（exit 0）→ 修复建议（原文引自 D 域/E 域，synthesizer 未增删）。

### FA-1 SM-01 applyEvent 无幂等/单调守卫（复现 5/5）

- **发现**（AUD-state-machines.md §1，SM-01）：store.ts:905-908 applyEvent 开头无条件执行；store.ts:630-642 onEvent 对 `seq <= lastSeq` 的重复/乱序事件直接 applyEvent。五条攻击序列：fold 状态复活 / compaction 括号重开（功能级 DoS）/ 计数膨胀 / lastSeq 回退引发级联重放（腐败自我放大）/ 乱序投递归因失真。测试误标实锤：store.spec.ts:289-297「duplicate delivery as a no-op」实际只投递一次（mock-session.ts:99-103 onAppend 未接线），守卫不存在 + 覆盖为零。
- **复现**（AUD-verification-replay.md §3 SM-01，5/5 REPRO）：A fold 复活（status unfolded→active，foldMap 0→1）；B 括号重开（compactionActive false→true）；C 计数膨胀（真投两次 samples/measuredSamples 1→2）；D 级联（重投 seq0 后新事件触发 scanUpTo，3 条真实事件计成 5 条 usage 记录）；E 单调破坏（syncedToSeq 2→1）。E 域顺带独立证实误标论。
- **修复建议**（D1 §1 原文）：applyEvent 入口加幂等守卫——`seq <= lastSeq` 且 `eventsBySeq.has(seq)` → 直接 return（可记 anomaly）；`seq < lastSeq` 且未见 → anomaly + 丢弃或触发全量 attach 重扫。同步改写 store.spec.ts:289 为真重复投递断言。钉测：真重复投递 fold/unfold/compaction/start/assistant/message 各一，断言 ledger 状态、compactionActive、计数均不回退；乱序投递断言 lastSeq 单调不减。
- **分级**：E 域 tester 建议 P1~P2（主流程状态机可被重复投递腐败）；D1 定级真缺陷「不修不能最终验收」。主线已将本批冻结为 P3 修复清单（任务卡口径），tester 分级建议如实保留供排期参考（见 §5 分歧处理）。

### FA-2 SM-02 extractCheckpointSource 不验数值有限性（复现 4/4）

- **发现**（AUD-state-machines.md §1，SM-02）：五步位置链——store.ts:289-290 仅验 `typeof === 'number'`（±Infinity/NaN/负值全部放行，对照 extractUsageRecord store.ts:322-326 有 Number.isFinite，证明是遗漏非设计）→ store.ts:969-970 `?? 0` 不拦非 null 非有限值 → buildObservabilitySnapshot 原文传 computeBreakevenReport → budget.ts:90-94 assertAmount 对非有限值 throw TypeError → tools.ts:731 renderStatus 无 try/catch + tools.ts:998-1003 execute 直接返回 → **zctx_status 工具执行抛错且不可自愈**（投毒事件在会话日志中永久存续）。违背 store.ts:146-147「honest ledger, no throwing」自述。
- **复现**（AUD-verification-replay.md §3 SM-02，4/4 REPRO）：对照组 tokensBefore=100 同序列快照正常（breakevenTable[0].quality='strong'，证明是「恰好污染进 fold 账目」的精准打击面而非全量抛错）；tokensBefore=Infinity / NaN / -1 三态全部 throw TypeError（got Infinity / got NaN / got -1）。
- **修复建议**（D1 §1 原文）：extractCheckpointSource 改用 Number.isFinite + 非负判定（与 extractUsageRecord 孪生对齐）；非有限值 → 丢弃字段（落 0 或记 anomaly），并给 renderStatus/execute 包一层 fail-soft 兜底。钉测：投毒事件（-1/NaN/Infinity 各一）→ 断言摄入被拒（anomaly ledger 有痕）且 observabilitySnapshot 不抛。
- **分级**：P2（用户可见功能打断）。

### FA-3 HF-01 图片静默降级为占位文本，诚实拒图门不可达（复现 7/7）

- **发现**（AUD-host-faces.md §1.2，HF-01）：四步证据链——zctx-adapter.ts:263 `inputModalities` 恒 ['text'] → 官方 adapterStream 在 dispatch 之前对「已知无图模型」执行 projectImagesForTextModel（zDSH-main llm/src/index.ts:1092-1095）→ 官方投影是纯占位文本替换（content.ts:360-371，不抛错）→ contentHasImage 拒图门（zctx-adapter.ts:362-370）在官方派发路径上**不可达**（只在直呼 adapter 的测试路径可达）。后果：用户图片被 `[image]` 占位文本替代上线，无任何失败信号——静默质量劣化，直接违反 zctx-adapter.ts:354-361「any image block fails the request BEFORE conversion … the honest S2 surface is the refusal (UNSUPPORTED_CONTENT)」自述契约与 README/config.ts:104-117 的 text-only 边界叙述。
- **复现**（AUD-verification-replay.md §3 HF-01，7/7 REPRO）：① listModels 实测恒 ['text']；② 官方投影器对带图消息 contentHasImage true→false，占位文本逐字捕获 `"[image omitted because this model accepts text only; attachment sha256:ed]"`；③a 未投影带图消息 → 真实 adapter 抛 UNSUPPORTED_CONTENT（拒图门本身有效，仅直呼路径可达）；③b 官方投影后同一消息 → 门不触发，请求越过拒图门继续走；④ 差分结论：同一 adapter、同一消息、唯一变量是「是否经官方投影」，错误码差异即门的可达性差异。
- **修复建议**（D2 §1.2 原文三选一，不实现）：(a) 接受占位路径，把 zctx-adapter.ts:354-361 的「UNSUPPORTED_CONTENT 拒图」文档降级为「防御镜像（官方投影已先行）」，并在 zctx_status/wire 台账暴露 imageCount 让劣化可观察；(b) 在目录/产品面声明 text-only 使上层 UI 禁图（U1 已证第三方 settingsNs 无页编辑能力，此路受限）；(c) 不推荐：在 toPiContextTextOnly 识别占位文本特征（不可靠）。
- **分级**：P2（用户可见静默质量劣化，非崩溃非数据损坏）。与 rc.3 [L2] imageRequestTarget 默认实现「保留图片」并立（D2 §6.3：接口面无需适配，行为面按 HF-01 处置）。

### FA-4 HF-02 inject 六键含未读键 'sessions'（复现 3/3）

- **发现**（AUD-host-faces.md §8 表，HF-02）：plugin.ts:224 inject 六键含 `'sessions'`，全仓 grep `ctx\.sessions|\.sessions\b` 零消费——声明而零消费的硬依赖：服务缺席即整插件静默 PENDING（Z21 症状形态），与 P0 read-verified 纪律（注释自述「a wrong key means the plugin stays silently PENDING」）不一致。
- **复现**（AUD-verification-replay.md §3 HF-02，3/3 REPRO）：步 1 五键在、sessions 缺席 → 真 vendored cordis 容器内 3s 窗口 `root.reflect.get('dsh-zcontext', true)` 恒 undefined，session feed listeners=0（整个插件未构造，静默 PENDING，无任何错误）；步 2 向同一容器补 SessionsStub → 插件立即激活（tools=4, commands=1），唯一阻塞键被隔离为 'sessions'，因果闭合；步 3 六键齐全正对照正常激活（与 probe-real-mount G3 口径一致，排除 harness 假阳）。grep 零命中为 E 域独立执行（非转抄 D2）。
- **修复建议**（D2 §9 / E §5 原文）：移除或正当化 'sessions' inject 键（任务卡口径：摘键）。E 域已复核 src 内 ctx 服务访问全部在六键覆盖的真实访问面内（P0 收编排查：tools.ts/preflight.ts/zctx-adapter.ts 命中全为注释行），摘键无消费面损失。
- **分级**：P2~P3（官方宿主恒提供 sessions 故现实可达性低，但违反声明纪律）。

---

## §5 P3 修复清单冻结

### §5.0 冻结口径

- 本清单为冻结版：逐条含 ID / 来源域 / 严重度 / 修法 / 验收断言 / 来源锚点（AUD-*.md 条目 ID + E 域复现状态）。冻结后进入修复排期，处置仅允许 fixed / user_approved_deferred / duplicate / not_applicable（§11 口径）；SM-01 与 C-TOP3-2 的 duplicate 关系已显式标注（同修，不重复关闭）。
- 严重度标注保留 E 域 tester 分级建议；批次层级（P3）以任务卡口径为准，最终排期权在主线。
- 复现状态词汇：`E 复现 N/N` = 端到端复现确认；`静态推演` = D 域 file:line 直证 + 逻辑推演（E 未复现，多因当前契约下不可达）；`探针验证项` = 需先实测宿主时序再定修法。

### §5.1 P3-必修（5 条：4 真缺陷 + Z19）

| ID | 来源域 | 严重度 | 位置 | 修法 | 验收断言 | 来源锚点 + 复现状态 |
|---|---|---|---|---|---|---|
| P3-M1（SM-01） | D1（+C-TOP3-2 同修） | 高（tester 建议 P1~P2） | src/store.ts:905-908 / 630-642；tests/store.spec.ts:289-297 | applyEvent 入口幂等守卫：`seq <= lastSeq` 且 `eventsBySeq.has(seq)` → return（可记 anomaly）；`seq < lastSeq` 且未见 → anomaly + 丢弃或全量 attach 重扫；同步改写 store.spec.ts:289 为真重复投递断言 | 真重复投递 fold/unfold/compaction/start/assistant/message 各一：ledger 状态、compactionActive、计数均不回退；乱序投递断言 lastSeq 单调不减；store.spec.ts:289 误标测试改为真重复投递且删除守卫即红 | AUD-state-machines §1 SM-01；AUD-verification-replay §3 SM-01（**E 复现 5/5**）；AUD-architecture §4/TOP3-2（同修标注） |
| P3-M2（SM-02） | D1 | 中（P2） | src/store.ts:289-290 / 969-970；src/tools.ts:731 / 998-1003；src/budget.ts:90-94 | extractCheckpointSource 改用 Number.isFinite + 非负判定（与 extractUsageRecord 孪生对齐）；非有限值丢弃字段（落 0 或记 anomaly）；renderStatus/execute 包 fail-soft 兜底 | 投毒事件（-1/NaN/Infinity 各一）：摄入被拒（anomaly ledger 有痕）且 observabilitySnapshot 不抛；对照组（合法 tokensBefore）breakeven 行为不回归 | AUD-state-machines §1 SM-02；AUD-verification-replay §3 SM-02（**E 复现 4/4**，三态+对照组） |
| P3-M3（HF-01） | D2 | 中（P2） | src/adapter/zctx-adapter.ts:263 / 354-370 | 三选一：(a) 接受占位路径 + 文档降级为「防御镜像（官方投影已先行）」+ zctx_status/wire 台账暴露 imageCount；(b) 目录/产品面声明 text-only 禁图（U1 已证此路受限）；(c) 不推荐占位文本特征识别 | 方案 (a)：README/config 注释契约降级落地 + status/wire 可观察 imageCount 字段且测试钉；方案 (b)：目录声明 text-only 生效的证据 | AUD-host-faces §1.2 HF-01；AUD-verification-replay §3 HF-01（**E 复现 7/7**，占位文本逐字捕获+差分设计）；rc.3 关系见 AUD-host-faces §6.3 |
| P3-M4（HF-02） | D2 | 中（P2~P3） | src/plugin.ts:224 | inject 摘除 'sessions' 键（或正当化——如确需保留须给出消费点实读证据；grep 独立复核为零消费） | `static inject` 五键（摘 sessions）；grep `\.sessions\b` src/ 零命中维持；mock 宿主摘键后插件照常激活；摘除即红钉测（六键钉测同步改五键） | AUD-host-faces §8 HF-02 / §9（P2 建议）；AUD-verification-replay §3 HF-02（**E 复现 3/3**，因果闭合）；synthesizer 抽查 plugin.ts:224 一致 |
| P3-M5（Z19） | F（主线 RSI 自审） | 中（流程缺口） | package.json scripts.test（现状 `"vitest run"`，synthesizer 本波抽查实证） | test script 固化 `build && test`（tsdown 前置），使 build→test 顺序由脚本强制而非人执行；收尾探针顺序 build→test→tsc→probe 同步写入验收流程 | `npm test` 先重建产物再跑 vitest；对 smoke.spec 等 lib 导入测试构造一次 stale 场景（先改 src 不 build）断言不再假绿；E 域 §2 新鲜度三判据作为回归口径 | tasks/ZCTX/progress.md V4 [19:55]（Z19 captured）；AUD-verification-replay §1/§2（Z19 顺序执行 + 新鲜度 PASS 证明口径有效）；synthesizer 抽查 package.json |

### §5.2 P3-强化（16 条：13 条边界强化 + seq 守卫同修条 + 导出卫生 + providers 深冻结）

| ID | 来源域 | 严重度 | 位置 | 修法 | 验收断言 | 来源锚点 + 复现状态 |
|---|---|---|---|---|---|---|
| P3-R1（SM-03） | D1 | 低 | src/store.ts:887-897 / 1372-1375 | scanUpTo 加连续 K（如 16）条 unreadable-event 熔断 + anomaly（fail-soft 但有界），或单次扫描跨度上限 | mock session.seq=1e12 场景：扫描有界终止且 anomaly 有痕，不挂死 | AUD-state-machines §5 SM-03；静态推演（mock/异常宿主可达） |
| P3-R2（SM-04） | D1 | 低 | src/attribution.ts:218-219 / 273 | resume/series 穿越窗口的 strong 归因用钉测固化决策（注明理由）；若补 weak 因子属规格变更，须走 §10 规则变更控制 | series 穿越窗口 → strong 断言 + 决策注释（或规则变更后的新行为钉测） | AUD-state-machines §3 SM-04；静态推演（符合 V3 冻结规格，语义未决） |
| P3-R3（SM-05） | D1 | 低 | src/config.ts:256-266 / 282；src/validator.ts:179-209 等 | config 层 clamp（keepRecentMessages ≥ 0、0 < maxFoldFraction ≤ 1、summaryFloor ≤ summaryCeiling、netShrinkTolerance ≥ 1）或 validator 入口对非法配置 TypeError（programmer-error 契约） | 极值配置（-5 / -1 / floor>ceiling / tolerance≤0）各自落守卫路径并有钉测（当前为静默关闭/保守拒绝的推演行为） | AUD-state-machines §5 SM-05；静态推演（保守方向，无正确性损坏） |
| P3-R4（SM-06） | D1 | 低 | src/store.ts:952-957；src/fold-engine.ts:464-467 | store 端 zctx-unfold 分支防御性展开：`[entry.startSeq..entry.endSeq]` 内仍 active 的 checkpoint 一并降级；未知 foldId unfold 记 anomaly | mock 直注「active checkpoint 事件位于 unfold span 内」畸形序列：不产生幻影 active | AUD-state-machines §2 SM-06；静态推演（当前两道防御下不可达，防御弱化即永久幻影） |
| P3-R5（SM-12） | D1 | 低 | src/validator.ts:378-391；src/plugin.ts:699 | ValidatorConfig 入口（或 plugin 组装处）`Number.isFinite(contextWindow)` 否则置 undefined（门跳过 + ccmGate 不声明的既有诚实路径保留） | contextWindow=NaN：check f 静默跳过行为钉测固化或转守卫后钉测拒绝路径 | AUD-state-machines §5 SM-12；静态推演（NaN 过 `!== undefined` 门） |
| P3-R6（HF-03） | D2 | 低 | src/plugin.ts:549-553（官方 llm/src/index.ts:407-416） | README 明示「adapter 面不支持热重载，改 providers 需重启」；中期可用 registration.replace 在配置变化时原子换路由（F1.4/F4.5 llm-pi-ai 先例） | README 声明落地；HMR/卸载行为有文档可依 | AUD-host-faces §3.4 HF-03；官方源直证（未复现） |
| P3-R7（HF-04） | D2 | 低 | src/tools.ts:573 / 907-1000；src/command.ts:51-97 | 四工具与 command 的 storeFor/execute 包 try→诚实文案；session 判空改 `== null`；/zctx handler 顶层 try→{kind:'error'} | 病态宿主形态（session.eventAt 抛错 / session=null）下用户见 texts.ts 诚实文案而非内部 TypeError | AUD-host-faces §4.1 HF-04 / §9（P2 建议）；静态推演 |
| P3-R8（HF-05） | D2 | 低 | src/plugin.ts:300-307 | session/event handler 外层对 event.type 裸读加防御（store.onEvent 内已有守卫，外层补齐） | 畸形 event 形态不产生未捕获异常日志噪音 | AUD-host-faces §8 HF-05；宿主 per-listener containment 兜底（core/session/src/index.ts:401-413） |
| P3-R9（HF-06） | D2 | 低 | src/preflight.ts:394-401 + README | preflight.ts 模块文档与 README enforce 段补两句：①短路消耗一次 maxOverflowRetries 预算；②与用户自定义 retryableCodes 的交互（将 CONTEXT_WINDOW_EXCEEDED 加入 retryable 的后果） | 文档两句话落地；行为不变（有界、无死循环已被 D2 推演确认） | AUD-host-faces §3.2 HF-06；交互推演（有界未复现） |
| P3-R10（HF-07） | D2 | 低 | src/adapter/map.ts:114-116 / 334 | map.ts docstring 登记 twins 与官方 mapUsage 的 parity 分歧（undefined usage：twins 返零 vs 官方 throw——更宽容），诚实标注纪律 | docstring 分歧登记在位；下游守卫（tools.ts:546-547 billed<=0）继续钉测覆盖 | AUD-host-faces §4.3 HF-07；低危（下游守卫在位） |
| P3-R11（HF-08） | D2 | 低 | src/adapter/zctx-adapter.ts:341-370 | options.messages 先验 Array.isArray（try 外）→ 病态入参归 INVALID_REQUEST 而非 UNKNOWN | 非 Array messages 入参：错误分类落 INVALID_REQUEST，有钉测 | AUD-host-faces §8 HF-08；静态推演 |
| P3-R12（HF-13） | D2 | 低 | src/adapter/host.ts:244 / 397-409 | buildPiAiFace 对 isContextOverflow 缺失返回 undefined（与 face 缺席同径），或在 IIFE 内 catch 转 undefined；修正 host.ts:397「never a throw」注释 | isContextOverflow 缺失场景走「不可达」info 路径（Z20 日志口径）而非通用 warn；rejected promise 不再永久 memoized | AUD-host-faces §1.4 HF-13；静态推演（boot 安全由 plugin.ts:488 try 保障） |
| P3-R13（HF-15） | D2 | 低 | src/plugin.ts:319 / 330 / 340-358 / 269 | 每面 register 包 try→warn（与 adapter 面 continuation-catch 同构）；声明改为「缺席/抛错双态都降级」 | 官方 tools.register throw 路径（output 形状/assertSupportedJsonSchema/保留名）触发时插件照常装载、该面诚实跳过 | AUD-host-faces §1.3 HF-15；宿主 containment 未深究（严重度上界未证，D2 已如实标注） |
| P3-R14（seq 守卫） | C（TOP3-2） | —（同修） | src/store.ts（同 P3-M1） | **与 P3-M1（SM-01）同修，不独立验收、不独立关闭**——C 域结构性结论已被 D1 行为扩展与 E 复现覆盖 | 随 P3-M1 验收 | AUD-architecture §4/TOP3-2；AUD-state-machines 处置节（显式防 duplicate 误关） |
| P3-R15（导出卫生） | C（TOP3-3） | 低 | src/guidance.ts:69；12 个过度导出类型（清单见 AUD-architecture §3） | 删/私有化 GUIDANCE_TITLE 孤儿别名；12 个文件内自用类型收窄 export；合并为单个 structure-hygiene 小提交 | 全仓枚举复扫：真孤儿=0；过度导出清单清零；lib 导出面 126 项不回归 | AUD-architecture §3 / TOP3-3；全量枚举实证（447 符号） |
| P3-R16（providers 深冻结） | C（TOP3-3） | 低 | src/config.ts:131 / :150（providers=[] 共享实例） | configDefaults 深冻结（Object.freeze 递归）或读时 spread 加固，消除共享可变数组 | 深冻结核验（Object.isFrozen 递归）+ 现有全部只读消费方测试不回归 | AUD-architecture §6 / TOP3-3；当前消费方全只读（resolveZctxProviders 无写，风险不可达） |

### §5.3 P3-盲区钉测（9 条：只补钉测/探针，不实现行为变更）

| ID | 来源域 | 盲区 | 钉测建议（D1/D2 原文） | 来源锚点 |
|---|---|---|---|---|
| P3-T1（SM-08） | D1 | 真重复/乱序投递（SM-01 序列） | 与 P3-M1 的钉测合并执行（真重复投递五类事件 + 乱序单调性） | AUD-state-machines §6 表 SM-08；store.spec.ts:289 误标 |
| P3-T2（SM-09） | D1 | compaction 括号异常 8 形态 | 按 AUD-state-machines §4 表 8 形态逐形态断言 compactionActive()（2/3/5/7/8 现无钉测） | AUD-state-machines §4 表 / §6 SM-09 |
| P3-T3（SM-10） | D1 | resume/series 头穿越归因窗口质量分级 | F → (resume header) → M 完整链断言 strong；F → (series header 无 replace) → M 同断言 + 决策注释 | AUD-state-machines §3 SM-10 / §6 |
| P3-T4（SM-11） | D1 | 非有限 tokensBefore/After 摄入 | 与 P3-M2 的钉测合并执行（-1/NaN/Infinity 三态摄入拒绝） | AUD-state-machines §5 SM-11 / §6（grep 全 tests 零命中） |
| P3-T5（SM-13） | D1 | unfold 重展开 absorbed 内层 checkpoint 的渲染语义 | 外层 fold 吸收内层 → unfold 外层 → 断言内层渲染为 `[user]\n<summary>` 而非 marker 或原始内容 | AUD-state-machines §2 SM-13；materialize.spec.ts:122-139 只测 active 展开 |
| P3-T6（HF-09） | D2 | 启动前已存在/恢复会话对 observe/preflight/wire 三面失明 | **探针验证项**：实测宿主 boot 时序（恢复会话 announce 是否补发 session/created、时机是否晚于插件装载）后定是否需要惰性 watching 兜底 | AUD-host-faces §5.1 HF-09（宿主侧时序未证，如实标注） |
| P3-T7（HF-10） | D2 | /zctx status 无 adapter 面健康段 | renderStatus 增 adapter 段（routes + mapping source + registration settled 状态），随下一波 | AUD-host-faces §5.2 HF-10 / §9（探针验证项） |
| P3-T8（HF-11） | D2 | preflightMode 非法值静默按 observe | 非三合法值（off/observe/enforce）在 wirePreflightFace warn-once（与 margin 的 warn-once 对称） | AUD-host-faces §5.3 HF-11 |
| P3-T9（HF-12） | D2 | reasoningEfforts 值域零校验 + violation 路径仍 push 部分 spec | 构造期校验值域（非 pi-ai 合法 level 进 violation 清单）并在 violation 路径不 push 无效 apiKeyEnv 原值的 spec | AUD-host-faces §5.4 HF-12 / §1.5 残留二 |

### §5.4 P3-结构（1 条：texts.ts 单家园收敛，可登记 v0.3）

| ID | 来源域 | 严重度 | 修法（两路径择一） | 验收断言 | 来源锚点 |
|---|---|---|---|---|---|
| P3-S1（texts.ts 收敛） | C（TOP3-1） | 低（最大结构债，无行为缺陷） | 案 (a)：~15 处模型可见文案全部迁入 texts.ts（工具 schema 做成 TOOLS_* 常量表，tools.spec 钉 schema 与常量同源）；案 (b)：修订 texts.ts:1-5 头部，把原则范围收窄为「会话文本（guidance/nudge/reply/materialize）」，schema 描述/错误诊断明示豁免。两案均须测试断言为准绳，禁止只改注释。任务卡授权可登记 v0.3 | 所选路径的门禁断言在位（同源钉测或声明与扫描口径一致），漂移可被机器拦截；触发条件=下次新增任何工具/schema/错误文案时必做 | AUD-architecture §5（~15 处逐点清单）/ TOP3-1；跨波累积原则漂移定性（W4 工具描述自始内联，非后期破坏） |

### §5.5 B 域移交修正项（文档侧 2 条，不入本仓代码清单）

VERIFY-P 总判定移交的 2 条修正，属 zDSH-docs 侧 R&D 文档的 P3 吸收项（非本插件代码缺陷，不在 §5.1-§5.4 冻结口径内，但按零遗留纪律显式登记）：

1. **[F34]/[F35] 引文重写**：fuse wire 实为 9 个状态字节（P2 记 7 个）；P2 四态编码表（REMOVED='0'/DISABLED='1'…）被 Electron v44.7.0 源码 REFUTED——实际 schema「0 == off, 1 == on, r == removed」。go-no-go 结论不变（完整性校验关闭），仅引文须按 9 字节重写。锚点：VERIFY-P #11 + 附带修正。
2. **[S1] 措辞收窄**：rc.2→rc.3「仅 package.json/pnpm-lock 变更」按整树 diff 收窄为「消费面零漂移 + host/UI 侧少量非契约 src 改动」（458 DIFF 中 379 为版本 bump，79 非包文件含 bundles.ts 注册行、api-catalog、client UI 等）。锚点：VERIFY-P #1 + 总判定。

---

## §6 分歧处理

编队七域之间未发现未收敛的实质性分歧；三处口径差异已按证据裁决并在清单中显式标注：

1. **SM-01 定级分歧（C【注意】 vs D1【真缺陷】 vs E 建议 P1~P2 vs 任务卡 P3 批次）**：裁决依据=客观数据权重最高——E 域 5/5 端到端复现（fold 复活/括号重开/计数膨胀/级联重放/单调破坏全部实证）压过 C 域「契约信任下不可达」的逻辑论证。定级真缺陷成立；批次归 P3 是任务卡的冻结口径（排期权在主线），tester 的 P1~P2 建议在 P3-M1 条目内如实保留，不隐藏。
2. **SM-01 与 C-TOP3-2 的条目关系**：非重复——C 为结构性发现（假设未钉），D1 为行为扩展（腐败序列+测试误标）。D1 处置节已要求 P3 登记时显式标注防 duplicate 误关；本清单以 P3-R14（同修条）落实。
3. **D1/D2 计数口径差异**：D1 报 12 条（2+5+5），D2 报 15 编号（2+8+4+HF-14 正面存证不计数，对外口径 2/8/4）。两域统计口径一致（HF-14 是核验通过的正面结论存证），无冲突；清单合并后总账见 §7。

**无分歧项**：B 域 12/12 全 CONFIRMED 与 C/D1/D2/E 无冲突；E 域四复现无一误诊；A/F 域结论与 C 域互补（§3 交叉验证点 2/4）。

---

## §7 遗留风险与未解决项

### §7.1 清单总账

- P3-必修：5 条（P3-M1..M5；四真缺陷全部 E 复现确认 + Z19 流程缺口）
- P3-强化：16 条（P3-R1..R16；其中 P3-R14 与 P3-M1 同修不独立验收）
- P3-盲区钉测：9 条（P3-T1..T9；其中 2 条与必修钉测合并、1 条探针验证项、1 条 status 增段）
- P3-结构：1 条（P3-S1；任务卡授权可登记 v0.3）
- B 域文档侧移交：2 条（§5.5；owner=zDSH-docs 侧，非本仓代码）
- **合计登记 31 条（独立验收 30 条）+ 文档侧 2 条。**

### §7.2 未解决项（上游如实标注，synthesizer 汇总，均不阻塞冻结）

| # | 内容 | 来源 | 处置路径 |
|---|---|---|---|
| U-1 | A 域（主线 codegraph 亲审三流）原始产出未独立落盘，结论经 AUD-architecture.md:7 引用 | 本报告 §1.1 | 透明登记（T-1）；主线如需独立存档可补落盘，不阻塞 |
| U-2 | 宿主 boot 期恢复会话的 announce 时序（HF-09 宿主侧） | AUD-host-faces §10 ① | P3-T6 探针实测后定惰性 watching 是否必要 |
| U-3 | cordis 插件构造抛错时的 registry containment 行为（HF-15 严重度上界） | AUD-host-faces §10 ② | P3-R13 修复后无论 containment 行为如何均安全 |
| U-4 | /命令 handler 抛错时的官方 command 执行器 containment | AUD-host-faces §10 ③ | P3-R7 handler 顶层 try 落地后失效该前提 |
| U-5 | captureLog 零样本对 store usageSnapshot 口径的精确影响（HF-07 下游） | AUD-host-faces §10 ④ | P3-R10 docstring 登记分歧即可，D2 判定不影响分级 |
| U-6 | 「更新后重打补丁」成本推断（updater nightly 节奏实测约 2 天一构建，存活期 1-2 天仍是推断） | VERIFY-P #12 | 文档侧 P3 补丁方案把「更新后重打」列为已知成本 |
| U-7 | P0 波遗留 user_approved_deferred：W5-A6-INSTALL（真实 pnpm 安装入活跃 profile + 完整 harness 启动挂载，post-merge，复核日期 2026-11-19） | progress.md V5 段 / closure.json | 维持原记账，owner=主线，到期复核 |

### §7.3 冻结声明

- 本报告为审计收口件：修复实现不在本轮范围（任务卡：不改任何代码）。P3 清单冻结后由主线派发修复波，逐条按「验收断言」列验收，按 §11 记账（fixed 必须 verified）。
- 修复波完成后必须复跑 E 域全量电池（build→test→tsc→五探针）+ 新鲜度守卫，并以四复现脚本口径做摘除即红验证（守卫删除即红）。
- RSI 收口：本波无新机制坑（查册命中条目全部转为执行检查项：Write 工具纪律、路径形态、结论强度≤证据强度、回源抽查各一条实际生效）；`no-new-lesson` 候选，最终由主线在收口时确认并入册。

（完 · REPORT-FULL-AUDIT · synthesizer 收口 · 全部结论可回溯至七域产出文件与本报告 §1.4 抽查记录。）

---

## §8 P3 修复波处置回执（2026-11-14，coder 执行 · 本节为 P3 波追加，冻结正文 §1-§7 未动）

全量电池（终态）：build 1.01 MB / 7 files · vitest 471/471（22 文件，429 基线 + 42 新钉）· tsc --noEmit 0 错 · 五探针全绿（surface 10/10、artifact 6/6、host-imports 16/16、smoke-real-loader 3/3、real-mount 5/5）。四必修 E 复现脚本反向验证：SM-01/SM-02/HF-02 exit 1（NO-REPRO），HF-01 exit 0（方案 (a) 有意保持机制，验收=契约降级+imageCount，见 checkpoint p3s0 notes）。

### §5.1 P3-必修（5/5 fixed/verified）

| ID | 处置 | 证据 |
|---|---|---|
| P3-M1（SM-01）+P3-R14（seq 守卫同修） | fixed/verified | f01b5cd：applyEvent 幂等/单调双分支守卫 + store.spec.ts:289 真修复（监听+真重复投递+守卫钉）+ 6 钉测；摘除即红 6 红；E-repro NO-REPRO |
| P3-M2（SM-02） | fixed/verified | 614028a：extractCheckpointSource 有限性+非负（twin 对齐）+droppedAmounts anomaly + renderStatus 观测段 fail-soft；5+1 钉测；摘除即红 4 红；E-repro NO-REPRO |
| P3-M3（HF-01） | fixed/verified（方案 a） | 219f7ff：拒图门契约降级为防御镜像（adapter 头注+门注+README）+ WireSnapshot.imageCount + 钉测；裁决理由 checkpoint p3s0；E-repro 机制性 REPRO=方案 a 预期，如实记录 |
| P3-M4（HF-02） | fixed/verified | c9ed41f：inject 六键→五键（sessions 摘除）+ smoke/plugin.spec 钉 + probe-real-mount 五桩（G3=真 cordis 无 sessions 激活钉，5/5）；E-repro NO-REPRO |
| P3-M5（Z19） | fixed/verified | 83e966e：scripts.test = "tsdown && vitest run"（显式链裁决 checkpoint p3s0）；stale 场景验证 build 先行 |

### §5.2 P3-强化（16/16 closed：15 fixed/verified + 1 同修）

R1/SM-03=9f940b5（熔断+2 钉）· R2/SM-04=937dad8（决策钉×2）· R3/SM-05=1d6a804（clamp+钉）· R4/SM-06=23e15ff（防御降级+2 钉）· R5/SM-12=c78133f（归一+钉）· R6/HF-03+R9/HF-06+R10/HF-07=1021e3d（文档三件）· R7/HF-04=0c621c1（containment+5 钉）· R8/HF-05=bc567f3（外层守卫+钉）· R11/HF-08=92cf972（Array.isArray+钉）· R12/HF-13=555aa2d（undefined 路径+钉）· R13/HF-15=cf22369（register try→warn+钉）· R15+R16=0effbb6（孤儿删+12 类型收窄（lib 126 面精确核对）+深冻结+2 钉）· R14=随 M1。每条摘除即红或 n/a 理由见各 commit 与 progress.md。

### §5.3 P3-盲区钉测（9/9 closed）

T1=随 M1（store.spec 六钉）· T2=ac3c3ef（8 形态逐形态钉）· T3=随 SM-04（937dad8）· T4=随 SM-02（614028a）· T5=ac3c3ef（unfold 内层渲染语义钉）· T6=ac3c3ef（探针报告 reports/probes/P3-T6-boot-timing.md：源码级时序证伪惰性 watching 必要性；live 实测随 W5-A6-INSTALL）· T7=ac3c3ef（status adapter 健康段+3 钉）· T8=ac3c3ef（mode warn-once+钉）· T9=ac3c3ef（efforts 值域门+apiKeyEnv 卫生+4 钉）。

### §5.4 P3-结构（1 条：user_approved_deferred → v0.3 登记）

P3-S1（texts.ts 单家园收敛）：任务卡授权登记 v0.3（"texts 收敛登记 v0.3 不做"）；触发条件=下次新增任何工具/schema/错误文案时必做。台账登记见 closure.json。

### §7.2 未解决项处置更新

U-2：P3-T6 探针给出源码级裁决（惰性 watching 不需要）；live 宿主实测维持 W5-A6-INSTALL 记账。U-3/U-4：R13/R7 落地后失效前提。U-5：R10 docstring 登记分歧（D2 判定维持）。U-1：透明登记维持（主线存档件）。
