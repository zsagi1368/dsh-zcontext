# REVIEW-options-plan：ZCTX 方案门对抗评审（architect 反方 · CARD-D）

- 评审对象：`docs/specs/ZCTX/options.md`（v1，91 行）+ `reports/plans/ZCTX-plan.md`（v1，77 行）。
- 证据基准：zDSH-main @ zdsh-latest，实测 HEAD = `073792c7f8`（本机 `git log --oneline -1` 输出）。本文所有 file:line 为该树实测读数，非转抄。
- 结论汇总：**方案甲裁定成立**（surface-replace 官方通道论证经源码复核无推翻点），但存在 **2 条 [阻断]**（unfold 结构性不可达、nudge 通道被官方配置静默关死）与 **10 条 [建议]**。阻断均为 plan 修订可闭合项，不需推翻方案选型。

---

## 一、[阻断] 结论（实现前必须修订 plan/契约）

### B1. `zctx_unfold` 的「one-for-one 重物化」在官方 surface op 语义下结构性不可达——v1 unfold 语义必须重定义

- 官方语义：`SurfaceOp` 的 replace 是「**一个**新节点替换一段区间」——`packages/core/session/src/types.ts:449-462`（"replaces surface nodes from startSeq (inclusive) through endSeq (inclusive) **with this node**"）；落盘实现 `packages/core/session/src/surface.ts` `applySurfacePlan`：`state.nodes.splice(startIdx, endIdx-startIdx+1, plan.seq)`——单 seq 换整段（本树 surface.ts:637-646）。SurfacePlan 全集只有 `append / replace / project` 三种（surface.ts:271-274）：append 只落尾部；project 需要事件类型在 `SessionEventMap` 中声明 `@messageProjection`（surface.ts:527-531）——被 options Q2「零自定义事件类型」裁定排除。因此 **1 个 checkpoint 节点 → N 个原始节点** 的原位还原没有任何官方操作可表达（折叠 checkpoint 恒在 surface 内部位置，不可能用尾部 append 补齐）。
- 波及：options.md:36（zctx_unfold "one-for-one 重物化节点"）、options.md:90（"unfold = checkpoint 节点 →（replace 1:1）→ 重物化节点"）、plan.md:54 回滚列（"unfold 全量还原"）、plan.md:66 W3（mock 全路径需含 unfold）。
- 处置建议（选一并冻结进 plan §3 契约）：
  1. **推荐**：unfold = replace(checkpoint → **单个**多 text-block user message)，原始内容按 `session.eventAt(seq)` 逐 seq 取回、按序嵌入同一节点（tool/result 原文作为带来源标注的文本块）；在文档明示「wire 形态从 assistant/tool 消息对变为单条 user 消息」的语义代价；
  2. 或 unfold 整体降为 v2（v1 fold-only，回滚语义 = 吸收式重建）。
  - 不可选：任何「逐条原位恢复 N 个节点」的承诺。A3/A4 验收需改写为对单节点重物化的形态断言。

### B2. nudge 通道（systemPrompt.context()）会被官方配置静默关死——必须 `required: true` + 降级测试

- 官方语义：`systemPrompt.context()` 贡献在 runtime context 被抑制时被过滤：`packages/core/system-prompt/src/index.ts:627-628`——`contexts.filter(entry => !runtimeContextSuppressed || entry.required === true)`；抑制来自官方设置 `includeRuntimeContext=false`（index.ts:463 调 `suppressRuntimeContext()`）或任何插件调用 suppress（index.ts:526-531）。`PromptContext.required` 字段明文语义 "Keep this operational context when optional runtime context is disabled"（index.ts:79-92）。
- 波及：options.md:40（阈值 nudge 未声明 required）、plan.md:36（static Config 无此项）、plan.md:22 A3（无降级用例）。现状下用户一关官方 runtime context，zctx 的主动折叠触发器整体失效且无告警——违反 plan 自身"能力探测降级"纪律（plan.md:56）。
- 处置建议：nudge context 注册带 `required: true`；W2 增加一条单测（抑制态下 nudge 贡献仍在 assemble 输出中）；README 双语写明该行为。

---

## 二、[建议] 结论（按影响排序）

### S1. 「缓存安全」表述过强：nudge 快照是 durable 历史节点，每次跨越=从快照位置起前缀缓存重付

- 依据：`systemPrompt.context()` 的渲染载体是 RuntimeContextProjection 产出的 **持久化 user/message 快照**（`packages/core/agent-loop/src/runtime-context.ts:119-165`：变更时 `createSystemMessage`/`createUserMessage` + `surfaceOp: replace(旧 seq)` 或 append），不是 billion-context 那种 ephemeral 尾部 user 消息（RES-billion-context.md §3.1）。官方缓存纪律明文："Any change may invalidate reuse from the first changed token"（`packages/core/system-prompt/README.md:154`）；工具 schema token 每请求重复（README.md:164）。
- 处置：options.md:40 / plan G2 的「缓存安全」改为「跨越计次缓存重付（每次跨越=一次从快照锚点起的前缀重建）」；预算表（W2 budget.ts）把 4 工具 schema + 指导段作为固定 wire 开销入账。

### S2. PTC 模式（tools.mode:'ptc'）下模型直呼 zctx_* 被拒——plan 未设任何验收/文档位

- 依据：`packages/core/tools/src/index.ts:341-345`（ToolExecutionInput.parent 注释："under `mode: 'ptc'`, only calls WITH a parent may execute a native tool name — a model-direct call (no parent) is denied as `UNKNOWN_TOOL` before the policy pipeline"）与 `collapses()`（index.ts:1350-1357，`!nested && mode==='ptc' && name!==RUN_CODE_NAME` 即拒）。SDK 子派发（run_code）保留全部可见工具（index.ts:673-683 Config 注释）。options.md:26 天花板表 b 行已写明此约束，但 plan 的 A1-A7 与 W4 无一覆盖。
- 处置：v1 范围声明「native 模式为一等路径；ptc 模式经 run_code 子派发可用、模型直呼拒收」；W2 指导段补一句 PTC 形态提示；W4 加一条针对 `collapses` 语义的只读单测（或显式声明 out-of-scope 并登记 leftover）。

### S3. 工具 schema 形态与参数校验责任：官方强制子集 + defineTool 才有自动 args 校验

- 依据：官方 schema 是**强制子集**（`packages/core/tools/src/json-schema.ts:1-8`：object properties/required/boolean additionalProperties、array items、恰好两支的 oneOf；顶层组合子 allOf/anyOf/not 不在子集）；`defineTool` 把 per-property parameters 编译成 "implicit open object root"（`packages/core/tools/src/schema.ts:505-506,577`），且**只有** defineTool 包装的 execute 才自动 validate+`ToolArgsError`（schema.ts:594-600）；裸 `register()` 不校验模型 args（index.ts:1071-1092 只查 output 声明/timeout/保留名）。
- 处置：4 工具用 `defineTool` + `content: string`（required）+ 插件自研宽容解析（对齐 billion-context parseCompressInput 形态）；禁止依赖注册表替你校验参数；schema 避开顶层组合子。options.md §2 甲.1 的多区间参数形态建议收敛为「单字符串承载全部区间」以贴合三家供应商 schema 宽容度（billion-context 已验证形态，RES §1.1）。

### S4. zctx-fold 元数据全放 message.source 偏离官方 checkpoint 形态——需要冻结 source payload schema + 类型增补文件

- 依据：官方 compaction checkpoint 的 source 只带 kind+关联 id（`packages/compaction/compaction/src/checkpoint.ts:19-31`：`COMPACT_CHECKPOINT_MARKER={kind:'compact-checkpoint'}` + compactionId），大块元数据走 log-only `compaction/summary` 事件（region.ts:483-502）；而 zctx 因「零自定义事件类型」只能把 foldId/区间/统计全塞进 `message.source`（options.md:85）。数据面开放成立：`MessageSourceMap` merge-extensible、"consumers fall through unknown kinds"（`packages/llm/llm/src/message.ts:110-116`）、Session.append 不校验 source 形状（`packages/core/session/src/index.ts:801-820`，仅 JSON 快照）、UI 容忍未知 producer（`packages/client/ui-chat/src/client/conversation-nodes/event-projection.ts:72`）。但 A2（tsc 零错）要求插件必须自带 `declare module '@deepseek-ai/dsh-llm'` 的 MessageSourceMap 增补或本地结构类型（`createUserMessage` 入参要求完整 `source`，message.ts:245-254）——plan 未列该文件。
- 处置：plan §3 增两条——(a) `source` payload schema 冻结（建议只放 kind/foldId/startSeq/endSeq/shadowedSeqs，统计放 content 尾部行，控制 source 体积）；(b) 新增 `src/types/message-source.d.ts` 增补文件为 W2 产物之一。
- 附注：options.md:77 对 appendPluginRecord 的描述是「带仓内源门……避开灰色地带」；官方 README 更硬——"Plugins outside this repository **must not** call it"（`packages/core/session/README.md:70`）。裁定不变，措辞可收紧。

### S5. A3 的 mock 会话与官方 Session.append 的提交期校验之间存在失真带

- 依据：官方提交路径在 `Session.append → commit → surfaceManager.validateNext`（session/src/index.ts:801-880）内强制：seq 连续、sourceEventSeqs 与实际遮蔽面**完全一致**（surface.ts:605-608 `missing` 检查 + `replacementRange` 要求 startSeq/endSeq 必须是**当前 surface 节点**，surface.ts:519-537）、surface node 0 为 system/message 时禁止覆盖（`assertSystemHeadRewrite`，surface.ts 后段）、tool/result 重写护栏（surface.ts:565-585）。手写 mock 不会复现这些——mock 全绿 ≠ 真机可提交。
- 处置：W3 优先用真实 `@deepseek-ai/dsh-session`（Session/SurfaceManager/foldSurface 为纯内存实现，无需宿主 runtime）做提交路径测试；若仍用 mock，则 mock 的校验面必须对齐上述四条，并加一条「官方 foldSurface 重放 fixture」对拍。同时 zctx 验证器补「surface node 0 不可入折叠区间」预检（官方会 throw，预检给可读错误）。

### S6. 缓存对账的数据源未在 plan 中落位——数据存在但 plan 没接线

- 依据：`TokenUsage` 含 `cacheReadTokens/cacheWriteTokens`（`packages/llm/llm/src/types.ts:166-189`），随 `assistant/message` 会话事件下发（`packages/core/session/src/types.ts:347` `usage?: TokenUsage`），经 `session/event` firehose 全量可达（RES Q3）。但 plan W2/W3 未声明缓存账本以 usage 为源，且 usage 是可选字段（适配器可缺席）。
- 处置：plan §3 或 W2 补一句「cache 账本数据源=assistant/message.usage；缺 usage 时降级为估算并打标」；zctx_status 的 breakeven 输出区分实测/估算两态（对齐 RES §6.3 公式）。

### S7. options 锚点哈希错位：options 引用 `073927c7f8`，实测 HEAD 为 `073792c7f8`

- 依据：`git log --oneline -1` 实测输出 `073792c7f8 fix: fix preinstall origin display in PluginManagerSettingsTab`；options.md:4 与 options.md:13 均写 `073927c7f8`（数字转置）。本文所有官方 file:line 均按实测 HEAD 读取。
- 处置：修订 options.md 头部哈希；下游所有「锚点复核」引用统一改为实测哈希，rebase 后需重跑抽查。

### S8. 并行互斥的正确性依赖「不声明 isConcurrencySafe」——需要一条防退化断言

- 依据：未声明 `isConcurrencySafe` 的工具被归类 exclusive（形成 barrier，串行化）：`packages/core/tools/src/index.ts:1311`（`if (!tool?.isConcurrencySafe) return { kind: 'exclusive' }`）；defineTool 仅在用户显式提供时才挂该分类器（schema.ts:626）。options Q1 的「与并行工具调用互斥靠同区间重复折叠检测 + surface 稳定性断言」成立的前提是 zctx_fold 不被未来优化顺手加上 `isConcurrencySafe:true`。
- 处置：A4 探针或单测断言 4 工具均无 isConcurrencySafe（或 fold/unfold 显式 false）；作为结构约束写进 plan §3。

### S9. A6 的「无运行时则如实登记」需要台账化动词，不能只是一句话

- 依据：plan.md:27 A6 已写「如实登记为发布后步骤」，但未指定登记载体与字段。协议 §11 要求 `user_approved_deferred`/`post-merge` 条目带 owner/触发条件/复核日期/证据。
- 处置：plan A6 判据改为「安装输出 或 closure 台账 `post-merge` 条目（含 owner/触发条件/复核日期）」。

### S10. RSI 检查项遗漏三条

- 依据与处置（对 plan.md:40-48 §3.5 增补）：
  1. 指导段逐字节稳定性应升级为硬检查项：官方前缀稳定纪律见 `packages/core/system-prompt/README.md:154`（"Prefix-stable while … section text, and order render identically"）——加一条单测断言 section 文本不含时间戳/计数等动态内容、未设 `complete: true`（`complete` 会顶替全系统提示词，system-prompt/src/index.ts:59-78、656-659 多 complete 抛错）。
  2. W2 guidance.ts 自写文本含转义序列 → 按全局 RSI 红线「含转义序列的代码禁走 bash heredoc（用文件写入工具）」，写进 §3.5。
  3. PTC 模式与 required:true 两项来源本评审 B2/S2，转成 §3.5 检查项（避免下波重踩）。

---

## 三、对「两通道论证 / 共存声明 / 缓存主张」的专项攻击结果（均未推翻，留证据）

1. **两通道论证（surface replace vs fetch patch）成立**：`agent/request` 明文禁改消息（RES-plugin-api.md §Q3，`packages/core/agent/src/runtime-types.ts:322-337`）、LOOP 请求 deep-frozen（llm/src/index.ts:74-82）——请求级改写确无通道；surface replace 官方注释明文开放（types.ts:455-462 "any surface-replacing producer may use it"）且 compaction-basic 提交形态可逐行对照（region.ts:504-508：user/message + replace + sourceEventSeqs=[start,summary,...shadowed]）。方案乙淘汰理由维持。
2. **共存声明成立，互斥闭环有官方件背书**：compaction 提交前断言无未闭合 `compaction/start`（region.ts:184-186 + `assertCompactionInactive` region.ts:308-316），zctx 反向扫同一标记即可互斥；zctx 在 compaction 摘要窗内折叠会让 compaction 以 SurfaceChangedError 优雅失败重试（region.ts:206-216 stability 检查、index.ts:201-216 overflow 重试）——Q1 的「提交前扫未闭合 start」恰好同时保护两个方向。遮蔽链重建（absorbed/dead）所需数据在 `session/event` firehose + `SurfaceFoldReplacement`（surface.ts:594-604 返回 replacements）可得。
3. **缓存主张需改写但机制成立**：折叠一次重写=从锚点重付（与 billion-context 同代价模型）；nudge 跨越=快照节点 replace（S1）；折叠批次纪律（一次调用多区间）有 billion-context 实证（RES §2.4.2）。原「缓存安全」字样按 S1 修订后无残留漏洞。

## 四、plan 最小修订清单（不重写 plan）

| # | 修订点 | 位置 | 对应结论 |
|---|---|---|---|
| 1 | unfold 重定义为单节点重物化（或降 v2）；A3/A4 相应改写 | plan §3 / A3 / A4 / 风险表回滚列 | B1 |
| 2 | nudge context `required:true` + 抑制态单测 | plan §3 Config / A3 | B2 |
| 3 | 「缓存安全」→「跨越计次重付」；预算表加固定 wire 开销（4 schema+指导段） | plan G2 / W2 | S1 |
| 4 | PTC 行为声明 + 指导段一句 + 单测或显式 out-of-scope | plan §1 非目标 / W2 / W4 | S2 |
| 5 | 4 工具统一 defineTool + content:string + 自研宽容解析；禁依赖注册表校验 | plan §3 | S3 |
| 6 | source payload schema 冻结 + message-source 增补文件列为 W2 产物 | plan §3 / W2 | S4 |
| 7 | W3 提交路径测试改用真实 dsh-session（或 mock 对齐四条官方校验 + foldSurface fixture 对拍） | plan W3 / kill criteria | S5 |
| 8 | cache 账本数据源=assistant/message.usage，缺省降级打标 | plan §3 / W2 | S6 |
| 9 | options.md 头部哈希改 073792c7f8 | options.md:4,13 | S7 |
| 10 | 断言 4 工具无 isConcurrencySafe | plan §3 / A4 | S8 |
| 11 | A6 台账字段明确（owner/触发/复核日期） | plan §2 A6 | S9 |
| 12 | §3.5 增：指导段字节稳定+无 complete、转义序列禁 heredoc、PTC/required 两项 | plan §3.5 | S10 |

## 五、评分（自评，供 verifier 复核）

- 正确性 24/25（全部结论有 file:line 或实测输出；S1/S5 含推断成分已标注）；
- 完整性 19/20（覆盖卡面四类攻击面+RSI）；
- 一致性 20/20（与 options/plan/RES 三源互证，未引入新依赖主张）；
- 可验证性 15/15（每条附锚点，复现命令=git log + sed 对应行）；
- 安全回滚 10/10（只读评审，未改动任何被审文件）；
- 可维护性 10/10（修订清单可直接逐条落 plan）。
- 总分 98/100。
