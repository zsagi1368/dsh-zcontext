# U2 装载探针报告 — dsh-llm 跨仓绝对路径导入（probe-host-imports.mjs 机器生成）

- 探针目标：`file:///G:/000Github/zDSH/zDSH-main/packages/llm/llm/lib/index.js`
- 运行时间：2026-11-13T19:37:08.837Z
- 结果汇总：16 PASS / 0 SKIP / 0 FAIL（exit 0）
- 回答问题：RES-adapter-route.md [U2] 的 dsh-llm 半边——插件运行时能否按绝对路径装载宿主 llm 库并观察公开导出（dsh-session 同模式已由 probe-artifact P5 先证，本探针覆盖 llm 包）。

## 逐组结果

| 组 | 断言 | 结果 | 详情 |
|---|---|---|---|
| PASS | G1 host llm lib reachable | PASS |  |
| PASS | G2 import liveness (Node ESM, cross-repo absolute path) | PASS |  |
| PASS | G3 export manifest size | PASS |  |
| PASS | G3 export isAgentLoopRequest | PASS |  |
| PASS | G3 export markAgentLoopRequest | PASS |  |
| PASS | G3 export projectFilesToText | PASS |  |
| PASS | G3 export projectImagesForTextModel | PASS |  |
| PASS | G3 export projectToolUpdates | PASS |  |
| PASS | G3 export isContextWindowExceededError | PASS |  |
| PASS | G3 export CONTEXT_WINDOW_EXCEEDED_CODE | PASS |  |
| PASS | G3 export isQuotaExceededError | PASS |  |
| PASS | G3 export callConfigEquals | PASS |  |
| PASS | G3 export attributionHeaders | PASS |  |
| PASS | G3 spelling pin: attrbutionHeaders (E-note misspelling) absent, attributionHeaders present | PASS |  |
| PASS | G4 callConfigEquals live semantics | PASS |  |
| PASS | G4 CONTEXT_WINDOW_EXCEEDED_CODE literal | PASS |  |

## 缺失项（后续波降级路径设计输入）

无 — G3 清单内全部导出在盘且形态符合预期。

## 纪律说明

- SKIPPED = 环境不可达（宿主构建不在盘），明示不静默；src 内仍零宿主运行时强依赖（duck-typing），本探针只是脚本级事实采集。
- attributionHeaders 拼写以实读为准（E 报告 attrbutionHeaders 存疑项已由 G3 拼写钉排除）。
