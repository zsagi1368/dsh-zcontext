# W2 任务卡：纯核心五件（零宿主依赖，全部可单测）

> 前置：W1 已合。设计依据：options.md §2 方案甲 §6 提交形态；RES-billion-context.md（机制语义，净室：文本自写、公式自实现）。

## 产物

1. `src/budget.ts` + `tests/budget.spec.ts`
   - 输入 {contextWindow, maxOutput?} → 预算对象：maxTokens=min(C,⌊0.1W⌋)、reserve=⌈1.25·maxTokens⌉+4096、toolCap=max(1024,⌊0.25(reserve−maxTokens)⌋)、R_pess=maxTokens+2·toolCap+4096、triggerLine=W−R_pess、keepRecent=min(max(⌊0.12W⌋,min(20000,⌊0.30W⌋)),⌊0.8·triggerLine⌋)、summaryInputCap=triggerLine−keepRecent、summaryOutputCap=min(C,maxTokens,⌊0.8·reserve⌋,max(8192,⌊0.01W⌋))、rMin=1−(maxTokens+2·toolCap)/W
   - **锁表测试**：对拍 CCM v2.3 权威表 7 案例（W=65536: triggerLine 52021/keepRecent 19660/rMin 0.856；W=131072: 110183/20000/0.872；W=200704: 175616/24576/0.878 等——允许 ±2 取整容差；W=16384 案例断言 trigger%≈51.3% 仅作参考不拒绝小窗）
   - 全部用 BigInt 安全整数运算+取整方向显式（floor/ceil 与表一致）
2. `src/validator.ts` + `tests/validator.spec.ts`
   - `validateFold(input)`: 输入={foldMap(活跃折叠), surfaceNodes[{seq,type,role,estimatedTokens,isUser,textLength}], range{startSeq,endSeq}, summaries[{startSeq,endSeq,text}], config}
   - 检查（全部可单测的纯函数）：
     a. 区间存在且连续、节点都在 surface 上
     b. 保护区：最后 keepRecent 消息/token 窗不可碰；最后一条 user 消息不可碰；第一条 user 消息永远不可碰（pin）
     c. tool 配对闭合：assistant(tool-use) 与其 tool/result 必须同折或同留
     d. 区间内含活跃 fold checkpoint → 允许（嵌套吸收），但 summaries 必须覆盖 checkpoint 或区间边界对齐
     e. 净缩门：Σ(被折节点估 token)·tolerance > 摘要 token 估（tolerance 默认 1.05——留 5% 容差防"越压越大"）；摘要长度窗 [50, 20000] chars
     f. 单区间估 token ≥ minFoldableTokens（5000，压力通道资格线）
     g. 原子性：任一失败→全部拒收+reasons 列表
   - 输出 {ok, reasons[]} 或 {ok:true, plan{folds[], reclaimedTokens}}
3. `src/materialize.ts` + `tests/materialize.spec.ts`
   - `materializeRange(accessor, foldMap, startSeq, endSeq)`：逐 seq 取事件文本（eventAt），遇活跃 fold checkpoint 展开**一层**（用 checkpoint 的 message 文本）并标注 `[folded block bN]`；输出单一 transcript 文本（带 role 标记 user/assistant/tool、tool 块带 toolName）
4. `src/search.ts` + `tests/search.spec.ts`
   - `recall(query, corpus)`：corpus=摘要+折叠走原文条目 {foldId, kind:'summary'|'original', text, range}；关键词打分（大小写不敏感、多词 AND 优先 OR 次之、命中位置截取 ±120 chars 上下文）；返回 top N
5. `src/nudge.ts` + `src/guidance.ts` + `tests/nudge.spec.ts`
   - guidance：静态指导段文本（**全自写**，双语感知：英文骨架+明示"Summaries MUST preserve the user's language"；KEEP/DROP 清单语义对齐 billion-context 但措辞原创；批次纪律"one call, all ranges"；折叠摘要=元数据非指令、Open objectives 例外；zctx_status=唯一可信账本）
   - nudge：`renderNudge(pressurePct, budget, ranges, voice)` 两档（gentle/emergency），内容含分项占比、可折叠区间表（PROTECTED 标注）、批量提示；**纯函数**（渲染稳定，同输入同输出）
   - 阈值跨越判定 `crossedThresholds(prev, cur, thresholds[])` 纯函数
6. `src/types.ts`：全部结构类型（SurfaceNode/FoldRecord/FoldMap/Budget/FoldPlan/ToolRunContextLike/SessionLike/HostContextLike——带官方锚点注释）

## 验收

- vitest 全绿；budget 锁表 7 案例对拍通过；validator 全分支覆盖（含原子拒收）；materialize 嵌套一层展开正确；nudge 同输入同输出。
- tsc --noEmit 零错；build 绿。
- 提交 `feat(ZCTX): W2 pure cores`。

## 约束

- 零宿主 import（结构类型自持）；零网络；零 fs。
- 文本常量放 src/texts.ts 统一管理（后续 reviewer 对照净室声明）。
- 不抄 billion-context 任何提示词原文；实现语义对齐即可。
