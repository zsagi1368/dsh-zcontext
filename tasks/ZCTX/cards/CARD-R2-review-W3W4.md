# CARD-R2：W3+W4 联审（reviewer 卡）

TASK_ID: ZCTX-R2 · 产出：tasks/ZCTX/scorecards/W3.json + W4.json + handoffs/REVIEW-W3W4.md（追加至 REVIEW-W1W2.md 亦可）

## 对象

W3+W4 coder 提交区间（git log feat(ZCTX): W3 / W4 为准）。契约基准=plan v2 §3 + options v2 §6 + W2 复审 100 分基线。

## 评审清单

1. **提交路径正确性（最重）**：fold-engine 的 checkpoint 提交形态对照官方 region.ts:506-508（user/message + surfaceOp replace + sourceEventSeqs 完备=全部被遮蔽节点）；source payload={kind:'zctx-fold'|'zctx-unfold', foldId, tokensBefore?, tokensAfter?}（S4 最小形态）；unfold=单节点多 text-block 重物化（B1）。
2. **真实 session 双模式**：真实模式确用绝对路径导入 zDSH-main packages/core/session/lib/index.js；SKIPPED 明示不静默；mock 模式对齐官方四条硬校验（sourceEventSeqs 完备性/surface 成员/node-0 禁覆盖/tool-result 护栏）。
3. **两层窗口拒绝**：budget F1 守卫（结构性退化线 W<6922）与 CCM §1.1 引擎层拒绝（W<32768 禁自动折叠）各就各位、互不替代。
4. **W4 接线**：4 工具 defineTool 全套+args 校验生效；zctx_fold content:string 宽容解析；nudge context required:true（官方过滤语义对照 system-prompt/src/index.ts:627-628）；能力探测降级全路径（缺 services 不炸 boot）；无 isConcurrencySafe；PTC 提示进指导段。
5. **产物级探针**：build 后 lib/index.js 含全部逻辑；tests 断言 apply/name/Config/工具注册面存在。
6. **对抗项**：并发面（exclusive barrier 前提）；checkpoint sourceEventSeqs 与实际遮蔽面一致性（官方会 throw——测试是否钉住）；usage 缺省降级打标；净缩门在引擎层的调用点。
7. **亲验三绿**+测试计数（W2 基线 111 → W3/W4 应显著增加）。

## 评分

§12.1 六维，逐维证据；<98 给 [阻断]/[建议]+精确修法（修法以测试断言为准绳文字——上轮教训）。两份 scorecard。发现伪造/造假直接 0 分上报。
