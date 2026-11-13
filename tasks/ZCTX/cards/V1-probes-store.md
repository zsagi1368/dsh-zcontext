# V1 任务卡：前置探针 + 观测账本数据结构（v0.2.0 波次 1/6）

> 计划：reports/plans/ZCTX-v02-plan.md（§2 红线 R1-R8 烤进本卡）。
> 规格来源：RES-observe-route.md（a.1/a.2 表）+ RES-adapter-route.md（U1/U2）。

## 产物

1. **U2 装载探针** `scripts/probe-host-imports.mjs`：
   - 实测跨仓绝对路径导入 `G:/000Github/zDSH/zDSH-main/packages/llm/llm/lib/index.js`：断言公开导出在盘（isContextWindowExceededError/projectFilesToText/projectImagesForTextModel/projectToolUpdates/CONTEXT_WINDOW_EXCEEDED_CODE/attrbutionHeaders/attributionHeaders——注意 E 报告里 attributionHeaders 拼写以实读为准）
   - 报告导出清单与缺失项（缺失项→后续波降级路径设计输入）
   - SKIPPED 机制同 probe-artifact（环境不可达→明示 SKIP 不静默）
2. **U1 目录 UI 探针**（只读源码调查→探针报告 `reports/probes/U1-models-ui.md`）：
   - 读 packages/client/ui-settings-models 源码：Models 页的 provider 列表来源（listProviders? listConfigurableProviders? 二者如何合并、第三方 settingsNs 条目是否可渲染/编辑/凭据写入）
   - 结论=GO/SKIP：S2 的最小目录注册是否能让用户在 Models 页看到并配置 zctx provider
3. **types.ts 扩展**：UsageRecord（extends UsageSample，+inputTokens/outputTokens/totalTokens/state/attribution?）、FoldUsageAttribution、RouteHeader、ResetEvent、ObservabilitySnapshot——按 RES-observe-route a.1 表字段冻结
4. **store.ts 扩展**：attach 扫描重建扩展（request/header→RouteHeader 链、compaction/*→ResetEvent、surfaceOp replace→microPrune/unknown-replace/mergeRewrite 分类、system/message 重写→systemSectionChange、session/end-seed→代际、assistant/message→UsageRecord）+ resync 增量维护 + 提取全字段 usage（input/read/write/total）
   - **单测**：attach 重建用例（混合事件流→账本断言）+ resync 增量 + 每类 ResetEvent 识别（7/8 类逐类用例）
5. **config 增量**：归因阈值两字段（attributionTimeWindowMs=90000/cleanSampleFloor=0.6，JSDoc 标注"待真机标定"）——进 static Config（primitive 不变）

## 验收

- 探针脚本 exit 0（或 SKIPPED 明示）；U1 报告落盘含 GO/SKIP 裁定
- store 扩展单测全绿；tsc 零错；build 绿
- 提交 feat(ZCTX): V1 <module>（小步）

## 约束

- 红线 R1-R8 全适用；Z15（先 tsc 后 vitest）；净室
- 零宿主运行时强依赖（探针是脚本级，src 内宿主类型仍 duck-typing）
