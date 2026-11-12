# ADR-0001：折叠提交走官方 surface-replace 通道（含单节点重物化 unfold）

- 状态：accepted · 日期：2026-11-12 · 关联：docs/specs/ZCTX/options.md（方案甲裁定）、reports/reviews/REVIEW-options-plan.md（B1/B2 修订已并入）

## 背景

官方 harness 的 compaction-basic 只做窗口压力触发的全量摘要；billion-context 证明模型驱动增量折叠可行，但其形态依赖 patch `globalThis.fetch`（非官方 API）并须关停官方 compaction 两平面。官方明文开放第三条路：`Session.append(..., { surfaceOp:{op:'replace',startSeq,endSeq}, sourceEventSeqs })`——"Used by compaction; any surface-replacing producer may use it"（zDSH-main @ 073792c7f8 树，packages/core/session/src/types.ts:455-462；参考提交形态 packages/compaction/compaction-basic/src/region.ts:504-508）。请求级改写无通道（LOOP 请求 deep-frozen，packages/llm/llm/src/index.ts:74-82；agent/request 禁改，packages/core/agent/src/runtime-types.ts:322-337）。

## 决策

1. dsh-zcontext 的折叠唯一提交通道 = `session.append('user/message', checkpoint, { surfaceOp:{op:'replace',startSeq,endSeq}, sourceEventSeqs:[...被遮蔽面节点] })`，checkpoint `message.source = { kind:'zctx-fold', foldId, startSeq, endSeq, shadowedSeqs }`（MessageSourceMap merge-extensible，packages/llm/llm/src/message.ts:110-116；零自定义事件类型：仓外插件禁用 appendPluginRecord，packages/core/session/README.md:70）。
2. **unfold = 单节点重物化**：`replace(checkpoint → 一个多 text-block user message)`，原文经 `session.eventAt(seq)` 按 seq 序嵌入同一节点（REVIEW B1：SurfaceOp replace 只能「一节点换一段」，surface.ts applySurfacePlan splice 单 seq 换整段；append 只落尾部；projection 需仓内事件类型——1→N 原位还原结构性不可达，v1 不承诺逐条还原）。
3. nudge 走 `systemPrompt.context({ required:true })`（required 语义 packages/core/system-prompt/src/index.ts:79-92；抑制过滤 index.ts:627-628）；指导段走 `systemPrompt.section` 静态文本、不设 `complete`。
4. 与官方 compaction-basic 共存不关停：提交前扫未闭合 `compaction/start` 拒收（对齐 region.ts:184-186,308-316），surface 稳定性按 replaceGeneration 断言；zctx 工具不声明 isConcurrencySafe（registry 默认 exclusive，packages/core/tools/src/index.ts:1311）。

## 理由

- 官方一等面 + 参考实现双背书；会话/线缆/宿主三方一致由构造保证（wire 历史派生自 surface）。fetch patch 路线=重建代理内核栈+关停官方能力（REVIEW 三.1 维持淘汰）。
- 前缀缓存代价诚实化：每次折叠/每次 nudge 跨越=从改动锚点起重付一次（packages/core/system-prompt/README.md:154）；固定开销（4 工具 schema+指导段）入预算账。

## 后果

- 折叠为 append-only、可吸收（官方 compaction 遮蔽 zctx checkpoint → absorbed/dead，经 session/event firehose + SurfaceFoldReplacement 重建台账）。
- unfold 后 wire 形态变为单条 user 消息（tool 调用对不再逐条复原）——文档需向用户明示。
- 依赖官方 surface/session API 形态；漂移时按 plan 能力探测降级（enabled=false 或卸载）。

## 回滚

- 会话级：unfold（决策 2 单节点重物化）按 foldId 还原最近折叠；外来源遮蔽的 fold 标记 absorbed，不再还原。
- 插件级：配置 `enabled=false` 或卸载插件；已提交 fold 节点是普通 `user/message`，官方读路径零依赖（未知 source kind 落穿，message.ts:112-115），卸载不损会话。
- 方案级（放弃通道）：本 ADR 作废，改走 v2 路线图（auto-fold/T2T3/auxiliary summarizer），不回头做 fetch patch。
