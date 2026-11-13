# Mimosa 深扫分诊报告（v0.2.0 · 2026-11-13）

- scanId: scan-2026-11-13T20-17-58.443Z-641147474498 · seal: sha256:9610379d289eaa240f76b6f66eb28bc9c59404c1f893493ce8c7d0a86f1e0f57 · depth=deep
- findings: 13（6 high / 7 medium）· **人工分诊结论：13/13 静态启发误报（false positive）**，逐类实证如下。per §15：深度扫描完成（selectedFiles>0），findings 已人工覆盖确认，非"扫描通过"宣称。

## 分诊明细

| # | 类别（数量×严重度） | scanner 主张 | 实证 | 结论 |
|---|---|---|---|---|
| 1 | mongo-sort-injection（7× medium） | 环境变量→stableValue$1()→sink | 全仓 grep `mongo` 零命中（lib+src+adapter）；stableValue=stableStringify 的键排序，被"对象键排序"模式误配为 mongo sort 对象注入 | 误报：仓库无任何 MongoDB 面 |
| 2 | command-injection（4× high） | parseSeqRef/jsonRangeToObject/parseFoldContent 经 1-2 跳到达 command-injection | 报告定位行（lib:5137/5150）的 `.exec(` 是 **RegExp.prototype.exec**（HEADER_LINE.exec/正则字面量匹配），非命令执行；全仓 grep `child_process|execSync|spawn` 零命中；插件从不构造/执行命令字符串 | 误报：正则匹配被误判为命令执行 sink |
| 3 | ssrf（1× high） | fetch 是 ssrf 入口 | wire.ts:110 globalThis.fetch 目标=用户 profile 配置的 baseURL（zctx provider 形态）——与官方 llm-pi-ai 自定义 provider 完全同信任边界（官方同样允许任意用户自配 endpoint 含本地 LLM）；URL 不来自模型/会话内容（模型输入进不了路由面） | by-design：与官方一致的用户自配上游形态，SECURITY.md 威胁模型已覆盖 |

## 人工覆盖替代结论（§15）

扫描自身 findings 13 条经上述三类实证全部排除；无 P0/P1 真实残留。安全面由 SECURITY.md 威胁模型+以下结构性事实兜底：零网络遥测（唯一出网=用户自配模型上游）、零命令执行、零数据库、会话数据本地、模型伪造防御（服务端验证+原生 tool result 回执）、exclusive 工具（无 isConcurrencySafe）。
