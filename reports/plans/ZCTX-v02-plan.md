# ZCTX v0.2.0 计划（reports/plans/ZCTX-v02-plan.md · v1）

> 用户裁定（2026-11-12）：S1 + S2 + 路线二全部一起做。
> 规格来源：REPORT-CACHE-ROUTES.md（裁定）+ RES-observe-route.md（路线二实现规格 a-d）+ RES-adapter-route.md（S1/S2 形态与责任清单）+ VERIFY-G.md（12/12 确认）。

## 1. 目标 / 非目标

**目标**：
- G1 观测账本（路线二全量）：L5-A 插件版（llm/stream 只读旁听+对象级前缀哈希 harness 域）+ 重置台账（7/8 类）+ 实测回本三态记账（measured/semi/estimated）+ 归因引擎（8 项噪声处置）+ zctx_status 三段升级。
- G2 S1 preflight：llm/stream listener 内窗口粗估（公开 helper 补投影）+ `preflightMode: 'off'|'observe'|'enforce'`（**默认 observe**；enforce 为显式 opt-in——no-go 条件 4 的合规实现）+ 命中时合成 `finish{kind:'error',failure:{code:'CONTEXT_WINDOW_EXCEEDED'}}` 官方 sanctioned 短路。
- G3 S2 薄 adapter：自定义 provider（命名空间 `zctx-<family>`）+ 寄生 pi-ai 传输栈（onPayload/fetch 透传=wire 真账本）+ cacheRetention/cacheControlFormat 透传（缓存旋钮）+ 错误分类复用官方导出 + SDK maxRetries=0 + resolveModel 声明 contextWindow + 最小目录注册（registerConfigurableProviders，让 Models 页可见可配）。
- G4 全量测试+文档+验证脚本升级+发布 v0.2.0。

**非目标**：S3 其余面（registerModelDiscovery 端点探测/完整凭据链登录流/Models 页 UI 深度验证——留 v0.3）；adapter 层任何 body 改写（永久 no-go）；WS transport；透明接管官方路由。

## 2. no-go 红线（烤进每张卡）

R1 adapter 层零 body 改写（折叠归 surface 层）；R2 preflight enforce 默认关；R3 禁 adapter/listener 内 ctx.llm.stream 自调（递归）；R4 SDK maxRetries=0（agent 恢复层独占重试）；R5 provider 名命名空间化 `zctx-`；R6 仅 HTTP(SSE)（WS 边界外）；R7 attributionHeaders() 必须上 wire；R8 pi-ai 版本对拍前置（实装 1.0.2，锚漂移已实证 429→442）。

## 3. 关键设计冻结

- 配置：新增 structured settings 段（schemastery 嵌套——v1 全 primitive 约束放宽，官方 llm-pi-ai 先例）：`providers[]`（family/baseURL/apiKeyEnv/models[].id/contextWindow/maxTokens/reasoningEfforts）+ `preflightMode` + `observe.enabled` + 归因阈值（attributionTimeWindowMs=90000/cleanSampleFloor=0.6，待标定标注）。
  - **§3.1 追加裁定（V5 执行者请裁，2026-11-13）**：`family` 语义=**pi-ai wire 协议名直取**（官方 supportedProtocols union：'openai-completions'|'openai-responses'|'anthropic-messages'），路由名=zctx-<family>，协议零映射，未知 family 构造期 fail-loud；displayName='zctx <family>'。淘汰 B（发明规格外映射表，违 C5 谨慎证据）与 C（字段清单放宽无必要——A 语义即协议，字段名保持 plan 冻结的 family）。
- 双域账本：harness 域（对象哈希，全路由覆盖）+ wire 域（字节哈希，仅 zctx 路由会话覆盖）——台账 schema 带 `domain` 字段，诚实标注覆盖范围。
- 归因：seq 序+turn/step 主键+时间窗兜底；三态定级+质量三级（strong/retry/weak）；纯净占比 <floor 时 status 显示"归因可信度不足"（诚实纪律）。
- 短路形态：S1 命中=enforce 模式下 yield finish error chunk（官方 sanctioned，index.ts:66-70 文档）；observe 模式只记台账不短路。
- S2 依赖前置：pi-ai 1.0.2 dist 锚点对拍 + `@deepseek-ai/dsh-llm`/`@earendil-works/pi-ai` 装载探针（U2）+ registerConfigurableProviders 在第三方 settingsNs 的 Models 页 UI 实测（U1）——探针不过则 S2 降级为"仅代码+SKIPPED 登记"。

## 4. 验收标准

| # | 判据 |
|---|---|
| B1 | 路线二全量：store 扩展+observe listener+归一化哈希+归因引擎+zctx_status 三段（三态占比/回本表/重置台账摘要）——单测覆盖三态边界+8 项噪声逐项 |
| B2 | S1：preflightMode 三态行为单测；observe 不短路；enforce 短路 chunk 形态=官方 finish error 契约；估算含 fileRequestText/imageRequestPricing 补投影 |
| B3 | S2：adapter 单测（chunk 7 形+usage 先于 finish+两路错误+maxRetries=0+attribution headers）；wire 账本喂 store（domain='wire'）；缓存旋钮透传断言 |
| B4 | U2/U1 探针：dsh-llm import 可达性+目录注册 UI 可见性——实测报告（不过→降级登记） |
| B5 | 全量 vitest 绿+tsc 零错+build 绿+verify-activation-surface/probe-artifact 扩展升级全绿 |
| B6 | README 双语更新（新能力+preflightMode 说明+S2 使用前提）+CHANGELOG 0.2.0 |
| B7 | 发布 v0.2.0：Mimosa 深扫+推送+tag+ledger |

## 5. 波次（每块一提交，评分≥98 放行）

| 波 | 内容 | 估行 |
|---|---|---|
| V1 | U1/U2 前置探针 + store/types 扩展（UsageRecord/RouteHeader/ResetEvent+attach 重建） | +180-260 |
| V2 | observe.ts（listener 四判据+快照+可选补采）+ 归一化哈希件 | +180-280 |
| V3 | 归因引擎+回本聚合+zctx_status 三段升级 | +200-310 |
| V4 | S1 preflight（三态模式门+短路+补投影估算） | +80-140 |
| V5 | S2 薄 adapter（骨架/chunk 映射/错误分类/wire 账本/缓存旋钮/最小目录） | +500-800 |
| V6 | 文档+验证脚本升级+发布 | — |

评审节奏：V1+V2 联审 / V3+V4 联审 / V5 单审 / V6 终审。kill criteria：探针双败→S2 降级登记；adapter 语义对齐 2 轮未收敛→S2 冻结回 S1+登记。

## 6. RSI 检查项

Z15（先 tsc 后 vitest）/Z16（super TDZ 探测前置）/Z17（产物断言剥注释）/净室（不抄 bctx）/转义序列禁 heredoc/ugrep 假阴性换法复核/单写者波次纪律。
