# V4 任务卡：S1 preflight（v0.2.0 波次 4/6）

> 前置：V3 合入。规格：RES-adapter-route.md §0.5/F3.3/F3.4/F6.1-F6.4/F8.3 + 切片 S1 定义（§11b）+ no-go 条件 4/5。
> 红线 R2：**enforce 默认关**；observe 为默认模式。

## 产物

1. **config**：`preflightMode: 'off'|'observe'|'enforce'`（默认 'observe'）+ `preflightMarginRatio`（默认 0.9——估算命中阈值=triggerLine×margin，留误报余量，JSDoc 注明"估算器误差分布待真机标定后调整"）
2. **preflight.ts**（listener 内估算器，复用 V2 observe listener 的主链四判据）：
   - 输入=GenerateOptions（投影前：messages 仍带 FileBlock/ImageBlock）→ 归一化估算：宿主投影导出可用→projectFilesToText/projectImagesForTextModel 后 chars/3 粗估；不可用→本地粗估+诚实标注 projector:'local-fallback'
   - 图片侧：imageRequestPricing 可用→计价；不可用→每图常数预留+标注
   - 判定：估算 context+reserve（budget.ts R_pess）> W×marginRatio→命中
   - **observe 模式**：只记台账（估算值/判定/后续真实 usage 对照→校准数据集）不短路
   - **enforce 模式**：命中→短路合成 `finish{kind:'error', failure:{code:'CONTEXT_WINDOW_EXCEEDED'}}`（形态严格对照官方 chunk 协议 types.ts:452-464+LlmFailure：usage 先于 finish 禁发/finish 后不得再发）→官方 compaction overflow 恢复链接管（compaction-basic:194→retry:233）
   - **禁**：ctx.llm.stream 自调（R3）；禁改 options（只读纪律同 V2）；WS transport 不可达不适用（本层在 waterfall，无 transport 差异——但 onPayload/fetch 相关逻辑禁混入本波）
3. **校准台账**：observe 模式的估算 vs 实测对照记录（进程内存态，zctx_status 可见估算器误差统计——为未来 enforce 标定供数）
4. **测试**：三模式行为逐条（off=零开销/observe=只记/enforce=短路且 chunk 形态断言）；估算器两路径（宿主/fallback）+图片计价两路径；margin 行为（命中/不命中边界）；短路后恢复链契约（finish error 形态钉）；零变异钉复用；误报代价声明（docstring）

## 验收

vitest 全绿+tsc 零错+build 绿+干净树；enforce 在默认配置下不可达（默认 observe 有测试钉）；小步提交 feat(ZCTX): V4 <module>。

## 约束

红线 R1-R8 全适用（尤其 R2/R3）；observe→enforce 的迁移条件写进 CHANGELOG 草稿（真机标定前 enforce 是 opt-in 高级用法）；净室。
