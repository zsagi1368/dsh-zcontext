# V5 任务卡：S2 薄 adapter（v0.2.0 波次 5/6 · 最大波）

> 前置：V3=99/V4=98 放行。规格：RES-adapter-route.md §Q1-Q9（尤其 F2 接口表/F5 责任清单/F7 wire 双点/F4.6 缓存旋钮/C5 谨慎证据）+ no-go 条件 + plan §2 红线 R1-R8 + U1 SKIP 降级路径（visibility-only）+ U2 GO（dsh-llm 导出在盘）。
> **增量纪律强化**：本波大（估 500-800 行），配额死亡风险真实存在——**每子块完成立即提交**（v5s0..v5s6），死亡可打捞。

## 顺手闭合（R4 三条）

- V3-1：store.ts:1275-1277 resetBetween 依赖 64-cap resetLog，逐出后"无 reset"不可证明→一行停走条件（超 cap 即判 unknown，不给无 reset 结论）；
- V4-1：tools.ts:509-531 校准统计剔除 fallback 行（或 basis 措辞改"含未校准样本"——择一，与"供数给 enforce 标定"的用途一致）；
- V4-2：preflight.spec 补 official-projector 路径执行钉（observe.spec 官方 describe 同款，SKIPPED 机制）。

## 产物

1. **adapter 骨架** `src/adapter/`（新目录）：
   - `ZctxAdapter extends LlmAdapter`（cordis/duck 形态——LlmAdapter 抽象类经 host-llm 可选导入获取；不可达→本面整体不注册+诚实日志，R8 版本对拍前置）
   - 仅 `stream()` 必须实现；providerInfo（displayName 'zctx <family>'）/providerRetryPolicy（undefined→官方默认）按 F2 表决策并注明
   - `resolveModel`：contextWindow 必须声明（正整数，INVALID_MODEL_CONTEXT 语义）——配置缺失模型→构造期 fail-loud 列清单
   - `listModels`：从 settings providers[].models 生成
2. **chunk 映射**：pi-ai streamSimple→官方 StreamChunk 7 形（F5.1：usage 先于 finish/tool arguments raw JSON/块 index 首见分配）；**优先 host 可选导入复用官方映射件**（@deepseek-ai/dsh-llm-pi-ai published exports ./src/*——toStreamChunks/mapUsage/classifyPiAiError；不可达→自研复刻约 200 行+诚实标注）；usage 三计数互斥语义保真（F5.6：deepseek 类折算已由 pi-ai 处理，mapUsage 直接映射，cacheRead/Write 仅非零携带）
3. **错误两路**：throw LlmError（官方错误码表 error.ts）或 finish error；溢出分类=官方导出 isContextWindowExceededError+pi-ai isContextOverflow 复用（F5.4）；**SDK maxRetries=0 硬钉（R4）**；EMPTY_RESPONSE 等默认可重试码照官方表
4. **wire 账本**（R7）：pi-ai onPayload+自定义 fetch 透传（profileOptions 补齐——官方 PiAiAdapter 不透传，F7.4）；fetch 收到最终 body 字节→sha256→store wire 域快照（domain:'wire'）；attributionHeaders() 必并入请求头（F9.6）
5. **缓存旋钮**：cacheRetention（none/short/long）+cacheControlFormat（仅 anthropic，compat 旋钮）从插件 settings 透传 pi-ai StreamOptions（F4.6）
6. **图片预算**：UNSUPPORTED_CONTENT（text-only 收图）/预算三旋钮透传（F5.7/F2.5）——最小实现+诚实边界
7. **最小目录**：registerConfigurableProviders（settingsNs=settings 段名；U1 SKIP→仅 visibility，页内配置不可用如实告知；配置权威=profile patch 手写 config——README 说明）；**不用 registerModelDiscovery**（S3）
8. **config 结构化段**（v0.2.0 计划 §3 授权放宽）：`providers[]`（family/baseURL/apiKeyEnv/models[].id/contextWindow/maxTokens/reasoningEfforts）——schemastery 嵌套（官方 llm-pi-ai 先例）；settings 段名命名空间化
9. **测试**：chunk 7 形逐形+usage 先于 finish+两路错误+maxRetries=0 断言+attributionHeaders 断言+cacheRetention 透传+resolveModel 校验（INVALID_MODEL_CONTEXT）+目录注册+DUPLICATE 冲突路径+配置缺失模型 fail-loud

## 验收

vitest 全绿（332 基线+新增）+tsc 零错+build 绿+三探针 exit 0+干净树；红线 R1-R8 逐条核对（本波 R4/R5/R6/R7 直接受考）；小步提交 feat(ZCTX): V5 <module>（v5s0..v5s6）；台账落盘。

## 约束

- R1 adapter 层零 body 改写（onPayload 只观测不 replace——返回 undefined 恒定）；R5 命名空间 zctx-；R6 仅 HTTP(SSE)（WS 声明不支持→UNSUPPORTED_OPTION 显式化）；R8 pi-ai 1.0.2 锚点（dist 实读，禁凭 1.3.0 记忆）。
- 宿主不可达→adapter 面整体不注册（fail-soft），永不炸 boot（五面降级先例）。
- 开工首动作=查册 ~/.agents/rsi/INDEX.md；长内容 Write/Edit 工具（Z18-Z19）；先 tsc 后 vitest（Z15）；§5 备份；卡壳如实报告；遗留为零。
