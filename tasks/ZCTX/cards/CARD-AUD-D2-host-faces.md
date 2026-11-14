# CARD-AUD-D2：宿主面域深度审计（reviewer · 全量审计令 D2）

TASK_ID: ZCTX-AUD-D2 · 产出：reports/audits/AUD-host-faces.md（≥100 行，边写边落盘，报 SHA-256）

## 背景

D1（状态机域）已交：真缺陷 SM-01（applyEvent 无幂等守卫）/SM-02（畸形 source 打断 status）等 12 条进 P3。你负责**宿主集成面域**——与 D1 互补。

对象：G:\000Github\zDSH\zDSH-plugins\dsh-zcontext 的 src/plugin.ts（apply 装配/六键 inject/五面降级）+ src/tools.ts（4 工具+status 渲染）+ src/observe.ts + src/preflight.ts（双 listener）+ src/command.ts + src/adapter/*（八模块）。

## 审计重点（宿主集成攻击者视角）

1. **fail-soft 边界完备性**：五面降级（tools/systemPrompt/commands/llm-stream/adapter）每一面的"宿主缺席/半缺席/抛错"三态——有没有一面在异常路径上炸 boot（对照 P0 六键与能力探测顺序）；adapter 三面加载器（dsh-llm/pi-ai/mapping）任一面成功任一面失败的部分装配态。
2. **listener 生命周期**：observe+preflight 双 listener 的注册/注销对称性；dispose 路径（session/disposed/插件卸载）泄漏面（stateBySession/modelInfoCache/warned 标志）。
3. **enforce 短路的宿主交互**：OUTERMOST 短路对官方链路（llm-retry/compaction overflow/token-meter 计量）的副作用——被短路的请求在官方计量面会不会留影子；finish error chunk 的 failure.code 在 rc.3 官方消费端（llm-retry retryableCodes？compaction 判定？）的路径核验（对照 RES-official-drift.md 的 LlmError code 收窄结论）。
4. **工具面**：zctx_fold/unfold/recall/status 的 exec.agent 缺席/abort 信号/并行 exclusive barrier 语义——工具回执的 fail-soft 完备性（用户可见错误文案 vs 静默）。
5. **R1-R8 在宿主面的最终核对**（逐条 grep+实读，出核对表）。
6. **rc.3 适配项预核**（RES-official-drift.md 的适配清单中宿主面相关项）：LlmError code 收窄对 V4 短路的影响/assemble→PromptPresentation 对 context() 注册的影响/imageRequestTarget 第 8 成员对 ZctxAdapter 的影响——逐项判定（无需适配/需适配/破坏）。

## 产出

按 6 项分节+[真缺陷/边界强化/覆盖盲区]分级+file:line 证据；不实现修复。≥100 行。

## 约束

只读；只写 AUD-host-faces.md；评审人≠作者；开工首动作=查册。
