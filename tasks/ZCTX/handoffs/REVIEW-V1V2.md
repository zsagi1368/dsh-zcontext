# REVIEW-V1V2 — V1+V2 联审交接（reviewer-R3 · CARD-R3 · v0.2.0）

```
FROM: reviewer-R3 (independent subagent)
TO: 主线 (ZCTX v0.2.0 orchestrator)
MODE: normal (评审结论：两卡均通过放行)
TASK_REF: CARD-R3-review-V1V2.md（tasks/ZCTX/cards/CARD-R3-review-V1V2.md）
PAYLOAD: SCORE + 攻击方向结论 + [阻断]0/[建议]6 + 亲验证据（见下）
ATTACHMENTS:
  tasks/ZCTX/scorecards/V1.json  (总分 99)
  tasks/ZCTX/scorecards/V2.json  (总分 99)
```

## 1. 裁决

| 波 | 区间 | 总分 | 门(≥98) | [阻断] | [建议] | 结论 |
|---|---|---:|---|---:|---:|---|
| V1 | 8e82b1b..91ab316（含起点 types 提交本体 + U1/U2 探针提交） | **99** | PASS | **0** | 2 | 通过放行 |
| V2 | 7425822..5092987（含起点 types 提交本体） | **99** | PASS | **0** | 4 | 通过放行 |

[建议] 不阻塞中间合入，但阻塞最终验收：6 条全部 OPEN，须由主线按 §11 记入 closure 台账（fixed / user_approved_deferred 二选一收口）。

## 2. 亲验证据（reviewer 本机实跑，2026-11-13）

- `pnpm lint` → tsc --noEmit，EXIT=0
- `pnpm test` → vitest 14 files **252/252 passed**，EXIT=0（observe 21 / host-llm 7 / plugin 19 / store-observe 25 / 其余为 v1 基线）
- `pnpm build` → tsdown 538.68 kB，EXIT=0；`git status --porcelain lib/` 为空 = 入库 lib 与重建**字节一致**（可复现产物）
- `node scripts/probe-artifact.mjs` → 5 PASS 0 SKIP 0 FAIL，EXIT=0
- `node scripts/verify-activation-surface.mjs` → 8 PASS 0 FAIL，EXIT=0
- `node scripts/probe-host-imports.mjs` → **16 PASS 0 SKIP 0 FAIL**，EXIT=0（U2 报告机器重生成与入库版逐字一致仅时间戳差异，已还原入库态）

## 3. 九个攻击方向结论（每条：结论 + 证据锚点）

1. **callConfigEquals 孪生等价性 — 成立**。逐字段对照官方 `zDSH-main/packages/llm/llm/src/call-config.ts:67-77`：provider/model/reasoningEffort/temperature/maxTokens 恒等 + stop undefined 语义与逐元素+长度比较完全同构。`tools`/`adapterDefaults` 本就不是官方 `LlmCallConfig` 成员（call-config.ts:31-34）——tools 由 store 的 `toolsEquals`（sorted-key JSON，键序无关测试钉 store-observe.spec.ts:180-213）独立覆盖；adapterDefaults 按 §Q6 语义只缓存不参与变更分类，与官方「变更检测归 host」一致。G4 探针钉 4 例（same/model-diff/stop-diff/stop-len）+ 孪生侧行为由 store-observe 4 用例覆盖。残余差异仅非有限值路径（官方对原始 NaN 判不等、孪生预清洗后缺席判等）——JSON 事件域内不可达 → 建议 V1-A。
2. **V2 只读纪律 — 真钉住**。listener 无隐性写路径：hash.ts stableValue 为纯读重建（新建对象，不触原树）；官方投影函数实读证实非变异（content.ts projectFilesToText/projectToolUpdates 返回原引用或浅拷贝）；fallback 孪生逐函数核对非变异（host-llm.ts:126-238）；零变异钉在深冻结树上深比较 + 引用同一性断言（observe.spec:200-227，含 attemptCapture=true 失败路径）。残余：该钉跑在 fallback projector 下（官方路径靠源码核验背书）→ 建议 V2-D。
3. **前缀单调机械件 — 与 guardian verifyMonotonic messages 部分同构**（实读 `zDSH-wt/zDSH-go/packages/llm/llm-pi-ai/src/cache-guardian.ts:451-476`）：shrink 优先定 mode、逐位首异定 breakIndex，与 guardian 收缩/原地改写两分支一致。豁免窗同构声明成立：guardian seq 豁免窗（:489-509，`prev.seq < lastResetSeq` 保守边界）对应插件的请求粒度消费指针——reset 在两请求之间到达即豁免，无 guardian 的「同 seq 歧义态」。两处有据偏离：插件对 unknown-replace/series-restart 也豁免（guardian 要求台账全白名单成员）——插件 unknown-replace 仅在观测到真实 surfaceOp replace 时入账 = 真断裂证据，豁免有据；systemHash/toolsHash 采集但不参与 break 检测（规格 a.3 有意收窄，reset 台账+豁免窗承接）→ 建议 V2-B。
4. **观测台账有界性 — 跨会话泄漏面闭合**。64/64/64 cap 机器钉（store-observe.spec:574-577/:595-597，66→64）；attach 清空全部五账（:600-622）；watched 集清理 = liveSessions.delete + `observe?.forgetSession(id)`（plugin.ts:237-243）；attemptSeq 重起钉证明 dispose 后无残留（plugin.spec 第 6 例）。残余：V1 routeHeaders/resetLog 会话内无界 + 每读全拷贝（O(resets)/请求模式已进 V2 prepare）→ 建议 V1-B；modelInfoCache 进程级无界（受路由数约束）→ 建议 V2-C。
5. **双路径诚实标注 — 成立**。判定条件明确：`import` 拒绝即整面 fallback（host-llm.ts:322-333 永不 throw），缺任一导出整面降级防混合低估（:269-282）；宿主在盘但 bare specifier 不可解析时诚实走 fallback 标注而非误标 official；U2 探针钉官方路径在盘可用 + 双路径测试实跑官方 lib（WeakSet 拒绝未标记形似对象，observe.spec:429-453）；`projector:'local-fallback'` 标注与 U2/测试三方一致。
6. **store 单一 applyEvent — 真覆盖**。三路共享一个迁移：attach 扫描 :724 / resync :529-551 / onEvent 全部进 applyEvent :734；测试含双制度 feed==scan 全等钉（store-observe.spec:402-437）、resync gap 修复（:439-464）、V2 series 单迁移钉（:524-537）。
7. **R1-R8 红线 — 本两波零接触全保全**。无 adapter 面（R1/R4/R5/R6/R7 本波无面）；无 preflight/enforce 代码（R2）；listener 无 ctx.llm.stream 自调（R3，grep src/ 零命中：registerAdapter/llm.stream/.fetch 均无）；R8 pi-ai 耦合未引入（仅探针脚本级 dsh-llm 投影导出，U2 对拍 1.0.2 宿主构建）。
8. **探针质量 — 合格**。U2 G3 十导出 = 官方 index.ts:40-58 实际导出面中后波所需集合（error.ts:25/:108、attribution.ts:64、content.ts 投影三件、call-config.ts 三件），后波依赖无漏测；拼写钉排除 E 报告存疑项。U1 file:line 抽查可复现：ProviderEditor.tsx layoutOf（≈:142-146）与 submitDisabled unknown 门（≈:513-527）实读吻合；SKIP 裁定附 GO 条件与宿主侧上游请求项，诚实完整。
9. **亲验 — 三绿+三探针全绿**（§2 命令输出）。另有 governance 复核：closure.json 36 items 全 fixed/verified、0 OPEN（node 机数复核；唯一 user_approved_deferred=W5-A6-INSTALL 为 v0.1.0 基线遗留，非本波）；checkpoint lastStep 指向本评审波。

## 4. [建议] 清单（0 条 [阻断]；6 条 OPEN 待主线 §11 记账，阻塞最终验收）

| id | 位置 | 问题 | 修法（以测试断言为准绳） |
|---|---|---|---|
| V1-A | src/store.ts extractCallConfig vs call-config.ts:71-73 | 孪生在预清洗后 config 上比较（非有限值→缺席），官方比较原始值（NaN≠NaN 判不等）；G4 未钉非有限值路径 | 探针 G4 增补非有限值语义钉一例（或孪生处注释声明 JSON 事件域边界），使孪生-官方对拍矩阵显式完整 |
| V1-B | src/store.ts routeHeaders/resetLog + routeHeaderChain()/resetEvents() | 会话生命周期内无界增长（usage 64/anomaly 256 有界，此二者无）；V2 observe prepare() 每请求 resetEvents() 全拷贝成 O(resets)/请求 | V3 聚合接入时为 resetLog 加 cap 或改消费指针增量接口；至少 store 文档注明会话生命周期界 |
| V2-A | src/observe.ts:221-225（prepare catch） | prepare() 故障静默吞掉无日志——系统性快照失败（如循环引用 stableStringify 抛错）会让观测面无声失效，与 sink warn-once 诚实标准不一致 | prepare catch 分支加 sink() 同款 warn-once（不改 fail-soft 行为，只可见化） |
| V2-B | src/observe.ts detectPrefixBreak vs cache-guardian.ts:451-462 | 快照采集 systemHash/toolsHash 但 break 检测不比较（guardian 冻结段语义）；规格 a.3 有意收窄但 PrefixBreakRecord 文档未声明该缺口，V3 聚合易误读 | PrefixBreakRecord/detectPrefixBreak 文档补一行「system/tools 维度不在 break 检测域，由 reset 台账承接」；或 V3 增补冻结段比较 |
| V2-C | src/observe.ts:194 modelInfoCache | 进程级模型信息缓存无界（负结果亦缓存，无清空路径）；实际受路由数约束风险低，但与 64/64/64 有界纪律不对称 | 加简单 cap（如 256 条 LRU 语义）或文档声明界由路由集合约束 |
| V2-D | tests/observe.spec.ts:200-227 | 深冻结零变异钉仅 fallback projector 下运行；official 路径只读性靠源码核验背书，无机器钉 | 宿主在盘环境下将零变异钉以 ZCTX_DSH_LLM 覆盖再跑一遍（测试级增强） |

## 5. 造假检查

未发现造假：探针报告与亲跑输出一致（U2 重生成逐字一致）；测试断言与实现语义逐条对得上；提交信息声称的数字（193→211→218→239→246→252 测试数轨迹、tsdown 538.68 kB）与实跑吻合；guardian/官方锚点实读吻合；评分无自评（reviewer-R3 ≠ coder）。

## 6. 移交事项

1. 主线：把 §4 六条 [建议] 记入 tasks/ZCTX/closures/closure.json（phase=post-merge 或随 V3-V6 波当波 fixed，disposition 按 §11）；本评审不修改任何业务代码/测试/配置/del（亲验 build 重生成的 lib 与探针报告均已核验字节一致并还原入库态）。
2. V3-V6 波次：V1-B（resetLog 消费指针）与 V2-B（冻结段文档/比较）建议在 V3 聚合设计时一并处理；V2-A/V2-C/V2-D 可并入任一后续波的小修。
3. 收口节奏照旧：V3+V4 联审 / V5 单审 / V6 终审。
