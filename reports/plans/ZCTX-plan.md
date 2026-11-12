# ZCTX 计划（reports/plans/ZCTX-plan.md · v2 · 方案门修订版）

> 任务：独立插件 dsh-zcontext——官方 deepseek harness 的「模型驱动增量上下文折叠」插件。
> 方案依据：docs/specs/ZCTX/options.md v2（方案甲裁定成立；REVIEW-options-plan.md 2 阻断+10 建议全处置，修订映射见 §7）。
> 官方锚点基准：zDSH-main @ zdsh-latest / HEAD 073792c7f8。

## 1. 目标 / 非目标

**目标**：
- G1 官方 harness 可直接安装的独立插件（`dsh plugin add github:zsagi1368/dsh-zcontext` 之类 git 形态），零底座改动。
- G2 模型驱动增量折叠：4 工具（fold/unfold/recall/status）+ 静态指导段 + 阈值 nudge，长会话窗口占用保持低位；缓存口径=**跨越计次重付**（每次折叠/nudge 跨越=一次从锚点起的前缀重建，与 billion-context 同代价模型），budget 表把 4 工具 schema+指导段作为固定 wire 开销入账。
- G3 折叠=官方 surface replace 通道（官方明文授权），会话/线缆/宿主三方一致。
- G4 与官方 compaction-basic 共存（不关停、不拦截；它始终是硬底）。
- G5 全量单测+类型零错+产物入库（Z3）+装载探针（Z7 同款）+激活面验证脚本（Z9 同款）。

**非目标**（范围裁定，非遗留）：client bundle/自定义 UI（v2）、T2/T3 蒸馏/refold（v2）、auto-fold（v2·产品门控）、auxiliary summarizer（v2）、跨会话检索（v2）、fetch 层路线（永久非目标：官方无通道+重建代理栈）、**PTC 模式模型直呼**（v1 声明：native 模式为一等路径；ptc 模式经 run_code 子派发可用、模型直呼 zctx_* 被官方拒为 UNKNOWN_TOOL——tools/src/index.ts:1350-1357，指导段写一句 PTC 形态提示，W4 只读单测或显式 out-of-scope 登记）。

## 2. 验收标准（可执行）

| # | 判据 | 验证方式 |
|---|---|---|
| A1 | `pnpm build` 产出 lib/index.js+d.ts 且产物入库 | build 输出+git ls-tree 计数>0 |
| A2 | `tsc --noEmit` 零错（含 message-source 增补文件类型闭合） | 命令输出 |
| A3 | vitest 全绿：预算表锁表（7 案例对拍+固定 wire 开销行）+折叠引擎提交路径（**真实 @deepseek-ai/dsh-session 优先，缺则 mock 对齐官方四条硬校验+foldSurface fixture 对拍**）+unfold 单节点重物化形态断言+nudge 抑制态单测+guidance 字节稳定单测 | vitest run 输出 |
| A4 | scripts/verify-activation-surface.mjs 全绿：Z3 产物在盘+Z7 命名导出探针+checkpoint 形态断言+**4 工具无 isConcurrencySafe 断言** | 脚本 exit 0 |
| A5 | 安装门自查：dsh.bundle 声明✓、peerDeps 门✓、无 build 脚本（免 allowBuilds） | 脚本断言 |
| A6 | 真机冒烟：隔离环境安装+装载探针；无运行时→closure 台账 `post-merge` 条目（owner=主线、触发条件=用户桌面环境可用、复核日期=发布后一周、证据=本计划行） | 安装输出或台账条目 |
| A7 | 双语 README+CHANGELOG+LICENSE+SECURITY+AGENTS.md | 文件存在+en/zh 镜像三门约束+PTC/required 行为说明 |

## 3. 接口契约（冻结进实现）

- 包名 `dsh-zcontext` v0.1.0；`dsh.bundle.patch=./cordis.patch.yml`；`manifestVersion: 1`。
- cordis.patch.yml：`- insert: [{id: dsh-zcontext, name: dsh-zcontext}]`。
- 4 工具名：`zctx_fold / zctx_unfold / zctx_recall / zctx_status`。
- **工具形态（S3/B2 修订）**：全部经 `defineTool` 包装（裸 register 无 args 校验）；schema 用官方强制子集（object properties/required/additionalProperties、array items、恰好两支 oneOf；禁顶层 allOf/anyOf/not）；`zctx_fold` 参数收敛为 `content: string`（required）单字符串承载全部区间+摘要（billion-context 已验证形态）+插件自研宽容解析（对齐 parseCompressInput 语义、自研实现）；**不声明 isConcurrencySafe**（保持 exclusive barrier——S8 防退化约束）。
- **checkpoint 形态（S4 修订）**：事件=`user/message` + surfaceOp replace + sourceEventSeqs=[...shadowed]；`message.source` payload 冻结为 `{kind:'zctx-fold'|'zctx-unfold', foldId, tokensBefore?, tokensAfter?}`（区间与被遮蔽 seqs 由事件信封 surfaceOp/sourceEventSeqs 承载，官方 compaction/src/checkpoint.ts:19-31 同位最小形态）；新增 `src/types/message-source.d.ts`（`declare module '@deepseek-ai/dsh-llm'` MessageSourceMap 增补）列为 W2 产物。
- **unfold 语义（B1 修订）**：checkpoint →（replace 单节点）→ 单个多 text-block user message（原文经 eventAt 逐 seq 取回按序嵌入，tool/result 作带来源标注文本块）；原始 N 节点不回 surface（官方 replace=单节点换整段）；wire 形态语义代价文档化；A3/A4 对此做形态断言。
- **nudge 注册（B2 修订）**：systemPrompt.context() 必须 `required: true`（官方 includeRuntimeContext=false/suppress 时过滤非 required 贡献，system-prompt/src/index.ts:627-628）+ 抑制态单测。
- **验证器预检（S5 修订）**：补「surface node 0（system head）不可入折叠区间」预检（官方 assertSystemHeadRewrite 会 throw——预检给可读错误）。
- **cache 账本（S6 修订）**：数据源=assistant/message 事件的 usage（cacheReadTokens/cacheWriteTokens，llm/src/types.ts:166-189）；缺 usage 降级为估算并打标；zctx_status 的 breakeven 输出区分实测/估算两态（w=1.0/r=0.1/q=4.0，VERIFY-C #15）。
- static Config（全 primitive）：`enabled`(true)、`nudgeThresholds`("25,50,75,90")、`keepRecentTokens`(0=自动)、`maxFoldFraction`(0.6)、`minFoldableTokens`(5000)、`protectionFloorTokens`(5000)、`summaryFloorChars`(50)、`summaryCeilingChars`(20000)、`netShrinkTolerance`(1.05)。
- peerDependencies：`@deepseek-ai/cordis >=4`（optional）；devDeps 仅 typescript/tsdown/vitest/@types/node；无 build/prepare 脚本（产物入库，Z3）。
- 宿主接口=结构类型 duck-typing（PluginCenter 同款）；schemastery lazy require + fail-soft。
- **指导段纪律（S10 修订）**：section 文本逐字节稳定（无时间戳/计数器）、**不设 complete:true**（会顶替全系统提示词，system-prompt/src/index.ts:59-78）+ 字节稳定单测。

## 3.5 RSI 开工检查项（坑册+评审命中转硬检查项）

- Z3：产物必须入库 → A1+A4 断言。
- Z1：无 client bundle 面 → 结构性免疫；verify 脚本断言无 dsh.client 字段。
- Z7：宿主接口 duck-typing+schemastery lazy require fail-soft → 结构性免疫；A4 探针实测。
- Z9：激活面批量验证脚本（A4）。
- 净室：指导段文本全部自写（不抄 billion-context compression-rules 原文）；**含转义序列的代码禁走 bash heredoc（用文件写入工具）**。
- ugrep 假阴性：验证结论换独立方法复核（A4 脚本用 node 直读，不走 grep）。
- 子代理静默死亡：每卡落盘纪律+主线代位预案。
- **（S10）指导段字节稳定+无 complete:true 单测**。
- **（B2/S10）nudge required:true + 抑制态单测**。
- **（S2/S10）PTC 形态提示进指导段**。

## 4. 风险与回滚

| 风险 | 缓解 | 回滚 |
|---|---|---|
| 折叠提交破坏会话完整性 | 官方 replace 通道+保守验证器（保护区/配对闭合/净缩门/原子拒收/node-0 预检）+compaction 硬底 | unfold=单节点重物化（checkpoint 内容全量取回）；折叠=append-only 可逆；原始节点永存存储日志 |
| 与官方 compaction 冲突 | 互斥检查（未闭合 compaction/start→拒收）；zctx 折叠窗口内 compaction 以 SurfaceChangedError 优雅失败重试（region.ts:206-216 官方已处理） | compaction 是官方功能，双方都 append-only |
| nudge 被官方配置关死 | required:true+抑制态单测 | enabled=false 或卸载插件 |
| 宿主 API 漂移 | duck-typing+能力探测降级（AutoPilot probes 模式） | 配置 enabled=false 或卸载插件 |
| 模型伪造折叠（billion-context #717） | 服务端验证（净缩门/长度窗/区间合法性）；回执=原生 tool result | 频控拒收+台账审计 |
| 模型不折叠（工具采用率） | nudge+指导段+status 工具；官方 compaction 硬底兜底 | 无损（官方行为不变） |

## 5. 任务波次（每块一提交，评分≥98 放行）

| 波 | 内容 | 预算 |
|---|---|---|
| W1 | 仓库骨架（package.json/patch/tsdown/config/AGENTS/LICENSE/CHANGELOG） | 15 分 |
| W2 | 纯核心五件+message-source.d.ts（budget 锁表/validator 含 node-0 预检/materialize 单节点形态/search/nudge+guidance 字节稳定） | 40 分 |
| W3 | 引擎两件（store 扫描重建+usage 账本 / fold-engine 提交编排；真实 dsh-session 双模式测试） | 30 分 |
| W4 | 接线三件（tools defineTool 全套/plugin required:true+能力探测/command /zctx） | 25 分 |
| W5 | 文档+验证脚本（A4 断言含 isConcurrencySafe）+真机冒烟 | 20 分 |

每波独立 reviewer 评分 ≥98 放行；<98 打回（≤2 轮）；预算不足缩范围不砍质量门。

## 6. kill criteria

- W2 锁表对拍失败 2 轮 → 公式层回 CCM v2.3 权威表重推。
- W3 真实 session 测试不可解析（node_modules 缺构建）→ mock 对齐官方四条硬校验+foldSurface fixture 对拍；仍不闭 → 升级主线裁决。
- W4 探针持续失败 → 停线，升级主线裁决（不低分放行）。

## 7. 方案门修订映射（REVIEW-options-plan.md → 本 plan）

B1→§3 unfold/§2 A3/A4/§4 回滚列；B2→§3 nudge/§3.5/§2 A3；S1→G2/W2；S2→§1 非目标/§3.5；S3→§3 工具形态；S4→§3 checkpoint/§5 W2；S5→§2 A3/§6 kill；S6→§3 cache 账本；S7→options.md 哈希；S8→§3/A4；S9→§2 A6；S10→§3.5 三条。
