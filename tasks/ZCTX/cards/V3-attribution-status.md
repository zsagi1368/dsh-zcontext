# V3 任务卡：归因引擎+回本聚合+status 升级（v0.2.0 波次 3/6）

> 前置：V1+V2 联审 ≥98。规格：RES-observe-route.md §Q4（归因链+8 项噪声）/§Q7（三态记账/回本判定/呈现）/(b) 闭环总装。
> V1 预留：UsageRecord 的 semi/attribution 字段本波填充。

## 产物

1. **归因引擎** `src/attribution.ts`（纯核心，零宿主依赖）：
   - 主键=seq 序+turn/step 结构；折叠提交事件 F（surfaceOp replace 的 user/message，source.kind='zctx-fold'）→ 同 session 第一个 assistant/message M（seq_M>seq_F）为归因目标（CARD-F §Q4.2 规则）
   - 质量三级：strong（F→M 间无 assistant/attempt、无 compaction/start、无其他 surfaceOp replace、无 request/header reason:'change'）/ retry（存在 llm/retry→计污染度 retryCount）/ weak（compaction/其他 replace/路由 change→只入总账不入折叠账）
   - 时间窗兜底：seq 断链（store resync gap）时 `T_M−T_F ≤ attributionTimeWindowMs 且同 turn`，台账标 timeWindow:true
   - 8 项噪声逐项处置（RES §Q4.3 表：重试环/多工具并行/多 step/工具执行时序/compaction 竞争/runtime-context 重投影/中断前缀 interrupted:true/子代理 session 分账）
2. **三态定级**：measured（usage 在场，billedInput=input+read+write 口径）/ semi（usage 缺席但 (a) 同 turn 后续有 measured 且无路由/系统节变化→interpolated 插值 或 (b) tokenMeter 可注入→meterAnchored）/ estimated（budget.ts 估算）
3. **回本聚合**：BreakevenReport 输入升级三态；回本事件=折叠账内首次「累计节省≥折叠执行成本」的 assistant/message；纯净占比=strong/(strong+retry+weak)，<cleanSampleFloor→status 显示"归因可信度不足"不给回本结论（诚实纪律）
4. **zctx_status 三段升级**：本会话摘要（N 折叠/回本 M/回收率/三态占比）/最近折叠条目（quality+retryCount）/重置台账摘要（V1 ResetEvent 分类计数）——ObservabilitySnapshot 装配
5. **测试**：归因规则全路径（strong/retry/weak 三级+8 噪声逐项+时间窗兜底+纯净占比降级）+三态边界（字段缺席=estimated 不得反推 Cache 支持）+status 呈现快照

## 验收

vitest 全绿+tsc 零错+build 绿+干净树；小步提交 feat(ZCTX): V3 <module>；台账落盘。

## 约束

红线 R1-R8；纯核心零宿主依赖（semi 的 meterAnchored 经注入接口）；净室；阈值字段用 config 值不硬编码。
