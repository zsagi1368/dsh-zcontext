# P6-E 任务卡：autoFold 服务端自主折叠引擎（v0.3 波次——「自己实现」的本体）

> 依据：B 线 RES-bc-server-orchestration.md §9.1 MUST 7（缺第 5 件「不依赖主模型自觉的摘要供给」即仍是模型驱动）+ §2 preflight 全链规格 + P6-D2 一手数据（nudge 在场 30 轮 0 自发 fold——模型驱动路线实证不成立）。
> 目标：插件形态的 autoFold 等价物——压力跨越时**服务端自己发起折叠**（独立摘要供给+确定性验证+surface replace 提交），不再等待模型调 zctx_fold。

## 机制设计（B 线规格 → 插件形态）

1. **触发**（复用 V4 preflight 判据+CCM 公式）：pressure 跨越触发线（observe/enforce 之外的第三条路：**autofold.enabled** config，默认 false——v0.3 显式 opt-in，校准后转默认）；
2. **选区**：确定性（validator 既有保守集：保护区/配对闭合/node-0/首 user 钉死/净缩门），最高收益优先（最大 span），CHUNK_FRACTION=0.6 精神；
3. **摘要供给三选一**（config `autofold.summarizer`）：
   - `compaction`（默认，最低成本）：借官方 compaction 一次性 LLM 调用形态（compaction-basic:239-257 官方先例：ctx.llm.stream 前缀复用+fresh session 语义）——**注意红线 R3 变体**：插件内调 ctx.llm.stream 是官方 compaction 先例（purpose='compaction' 标记），非 adapter 内自调，且我们有自己的 provider 面（非 compaction-basic 的继承位置）——**实现前先实读官方 summarizer 全文确认可安全复用的精确形态**；
   - `external`：独立摘要服务（externalSummary 同型，自配 URL/model/凭据）；
   - `digest`：CPU-only 确定性结构 digest（零模型，bc EMERGENCY 同型）。
4. **执行**：摘要产出→W2 validator 全套门→fold-engine surface replace 提交（复用既有引擎）→净缩门不过→halving 级联（bc #726 同型）→CPU digest 兜底；
5. **防反馈环**：autoFold 完成后 nudge 基线清零（bc compress.ts:927-929 同型）；autoFold 自己的摘要调用标记 purpose 豁免（不入压力计算）；
6. **预算**：MAX_ROUNDS=16/每轮 MAX_BATCH=4/输出上限 32K 钳（bc F2.6-F2.7 同型，常量数据化）。

## 产物

1. `src/autofold.ts`：触发→选区→摘要供给→验证→提交→退化链 全链；
2. config：`autofold.enabled`(false)/`autofold.summarizer`('compaction'|'external'|'digest')/`autofold.external`（external 的 URL/model/凭据段）/预算常量；
3. status 集成：autoFold 段（触发/轮次/摘要供给态/净省）；
4. 测试：触发判定/三供给/退化链（空答案→半分级联→digest）/防反馈环/预算钳——bc F2 全规格逐条钉。

## 验收

全量电池+新钉全绿；**pilot 复测**：bench HOME 10 轮 C2 场景（40k 窗口压力臂）autofold.enabled=true → **服务端自发折叠真实发生**（0 模型工具调用依赖）→ 采用率问题被机制解决的第一手证据。

## 约束

红线 R1-R8（R3 注意：compaction 供给路径=ctx.llm.stream purpose 标记，官方先例，非 adapter 自调）；净室（bc 机制规格对标，实现全自研）；**P6-D2 的 4 提交未经评审——本波完成后合并评审**；开工首动作=查册；§5 备份；长内容 Write/Edit；卡壳如实报告。
