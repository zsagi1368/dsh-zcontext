# REVIEW-V3V4 — V3+V4 联审交接（reviewer-R4 · v0.2.0 · 2026-11-13）

```
FROM: reviewer-R4 (independent subagent)
TO: 主线 (ZCTX v0.2.0 orchestrator)
MODE: normal (评审结论：两卡均通过放行中间合入)
TASK_REF: tasks/ZCTX/cards/V3-attribution-status.md + V4-s1-preflight.md（V3+V4 联审，节奏同 REVIEW-V1V2 先例）
PAYLOAD: SCORE + 十个攻击方向结论 + margin 裁决 + [阻断]0/[建议]3 + 亲验证据（见下）
ATTACHMENTS:
  tasks/ZCTX/scorecards/V3.json  (总分 99)
  tasks/ZCTX/scorecards/V4.json  (总分 98)
```

## 1. 裁决

| 波 | 有效区间（含起点提交本体） | 总分 | 门(≥98) | [阻断] | [建议] | 结论 |
|---|---|---:|---|---:|---:|---|
| V3 | 0405e30..62d6889（含 091b496 归因引擎本体；区间写法 091b496..62d6889 按任务简报，起点本体按 V1 先例计入） | **99** | PASS | **0** | 1 | 通过放行 |
| V4 | 62d6889..da0e02d（含 4b2b499 config/types 本体） | **98** | PASS | **0** | 2 | 通过放行 |

[建议] 不阻塞中间合入，但阻塞最终验收：3 条全部 OPEN，须由主线按 §11 记入 closure 台账（fixed / user_approved_deferred 二选一收口）。无 [阻断]。

## 2. 亲验证据（reviewer 本机实跑，2026-11-13）

- `pnpm lint` → tsc --noEmit，EXIT=0
- `pnpm test` → vitest 17 files **332/332 passed**，EXIT=0（attribution 27 / store-attribution 19 / preflight 27 / plugin 21 / observe 23 / tools 三段 3 新例 / smoke 6；轨迹 302+27+1+2=332 与提交声称吻合；V2-D 官方路径钉在本机实跑无 SKIP）
- `pnpm build` → tsdown **741.04 kB**，EXIT=0；`git status --porcelain lib/` 为空 = 入库 lib 与重建**字节一致**（可复现产物）
- `node scripts/probe-artifact.mjs` → 5 PASS 0 SKIP 0 FAIL，EXIT=0
- `node scripts/verify-activation-surface.mjs` → 8 PASS 0 FAIL，EXIT=0
- `node scripts/probe-host-imports.mjs` → **16 PASS 0 SKIP 0 FAIL**，EXIT=0（报告重生成仅时间戳差异，已 `git checkout` 还原入库态，与上轮 reviewer 同惯例）
- closure 机器数：closure.json **47 items / 0 非闭合**（唯一 status=open = W5-A6-INSTALL，user_approved_deferred/post-merge，v0.1.0 基线遗留非本波）
- 红线 grep（src/ 全量）：registerAdapter / maxRetries / attributionHeaders / onPayload / `.fetch(` / websocket / ws:// 零命中；`llm.stream` 仅事件名注释；pi-ai 零 import（R8）；R2 `'enforce'` 字面仅 config/types/preflight.ts:397 mode 门/文档，默认不可达三层测试钉

## 3. 攻击方向结论（每条：结论 + 证据锚点）

1. **margin 裁决 — 成立（reviewer 确认，V4-E 闭环）**。product-1（hit ⇔ estimate > triggerLine × marginRatio）胜出的四点理由：(a) 卡面 product-1 是 marginRatio 的语义定义处（config 契约），product-2 判定行与之矛盾必择一，config.ts:89-97 与 CHANGELOG:28 契约面已按 product-1 自洽；(b) F6.4 误报代价=一次无谓 compaction surface 重写 → 偏向更高阈值，θ1−θ2=+0.1×R_pess（W=128k 实算：product-1 于 98510 触发 vs product-2 于 96656，product-1 误报更少）；(c) margin=1 时两读法都退化为官方 triggerLine（content > W−R_pess），product-1 的 margin 语义与 budget.ts CCM 触发语义一致，product-2 把 R_pess 双重计入；(d) 实现（preflight.ts:330 严格 >）/测试（==阈值不命中、+1 命中）/JSDoc（含 待标定 声明）三方一致，clamp (0,1] 防 margin>1 越过官方触发线。与 budget.ts 语义一致性由 (c) 直接成立。
2. **enforce chunk 形态 — 官方协议实读核对通过**。zDSH-main llm/src/types.ts:446-464 原文在档（"Adapters emit usage before the terminal finish and nothing afterward"）+ :41-62 LlmFailure（message/code 必填，status/providerRetryAfterMs/requestId/offloadImages 可选——插件只发 message+code 合法，缺席诚实）+ :156-163 FinishReasonMap['error']={kind:'error', failure} 吻合 + error.ts:25 码拼写（U2 探针 G4 实测）。短路=恰一终态 chunk、next() 未启动（innerStarted=false 钉 preflight.spec:299-332）、无 usage 可发故不发——三断言真钉。
3. **OUTERMOST 注册序 — 成立且双路验证**。vendor/cordis/src/events.ts:221-236 实读："Listeners run outermost-first; a listener that does not call next() vetoes the rest of the chain, including the built-in behavior"——先注册者 outermost；plugin.ts:240-241 wirePreflightFace 先于 wireObserveFace；官方 sanctioned（llm/src/index.ts:66-78 "call next() … or yield your own chunks to short-circuit"）。plugin.spec harness 已改 cordis 忠实全链组合（listeners.reverse() 包装序），enforce 全链例证明内层 observe 被抑制（0 快照）+ 恰一终态 chunk——忠实度合格。
4. **归因引擎规则保真 — 逐项对照通过**。§Q4.2 规则 1-4 与 strong 四条件逐行吻合（attribution.ts:187-285）；attempt-无-voucher→weak 是规格三态不完备区（attempt 在场禁 strong + 无 llm/retry 禁 retry 的机械推论）的唯一自洽补全，JSDoc 带锚（agent.ts:491-511）；时间窗兜底诚实封顶 weak + timeWindow:true，五负例 + 「完整链永不读时钟」专钉；8 项噪声逐项实现+逐项测试（1/2/4/6 引擎级，1/3/5/7/8 store 级，5 双级）；surfaceOp 官方词表实读仅 replace（core/session/src/types.ts:464/:513），噪声 2 无误分类风险。
5. **三态定级边界 — 成立**。interpolated 三保守闸（turn 变/未知 turn/reset-between）+ absent stays absent + output 永不插值（store-attribution.spec:237-273）；meterAnchored 仅 input 侧经注入面、fail-soft→estimated+anomaly（store.ts:1169-1181）；「字段缺席=estimated 不得反推」双专钉（无注入面 :288-299 + 无锚字段 :282-284）；estimated 记录零字段（extractUsageRecord）→ 聚合 estimated 路径 T=σ 约定如实生效。
6. **纯核心纪律 — 成立**。attribution.ts import 仅 budget.ts+types.ts（零宿主）；store 的 meterAnchored 经 MeterAnchorLike 注入（plugin.ts:483-502 实现，官方 TokenSurfaceNode{seq,tokens} 实读吻合）；preflight deps 面窄（键面枚举钉）。
7. **行数口径 — 判定成立（不打回）**。preflight.ts 600 行 = 375 代码 + 189 注释 + 36 空行；卡面 80-140 为计划期估算，未含 fail-soft 双路径/错误路径/诚实标注纪律的实际展开（observe.ts 527 行同量级先例）；coder「逻辑约 250 行」与 375 的差量 = 接口/type 面 ~60 行 + 表面样板，可信。过程注记（非缺陷）：计划 §5 波次估算工具今后应按「每交付面含诚实标注与 fail-soft」校准。
8. **V2-A 闭合核验 — 与 R3 建议原文意图一致**。R3 原文：「prepare catch 分支加 sink() 同款 warn-once（不改 fail-soft 行为，只可见化）」；实现=每 listener warn 一次、plan=undefined、pass-through 不变（observe.ts:293-307），测试钉 warn 恰 1 次 + 流不破。CLOSED 正确。
9. **性能** — 无明显低效：归因 O(folds×window)（folds 稀少）、二分索引（firstIndexAbove/turnOpenAt）、模型信息 promise 缓存 64-cap、投影与 observe 同量级；S1 精度局限（投影前 messages、拿不到 wire 字节）为规格明示（§11b S1）。
10. **文档/契约同步** — CHANGELOG 0.2.0 草稿含 S1 preflight + observe→enforce 迁移三条件（no-go 条件 4 纪律逐字满足）；index.ts 公开面齐；smoke 契约钉 +preflightMode/preflightMarginRatio（Z19 修正后对新鲜 lib 双绿）；Z18/Z19 坑册落 zDSH-LESSONS.md + INDEX.md:144 捕获行。

## 4. [建议] 清单（0 条 [阻断]；3 条 OPEN 待主线 §11 记账，阻塞最终验收）

| id | 位置 | 问题 | 修法（以测试断言为准绳） |
|---|---|---|---|
| V3-1 | src/store.ts:1275-1277 resetBetween（调用点 :1209） | interpolated 的保守闸依赖 64-cap resetLog：候选 usage 记录仍被保留但其间 reset 条目已被逐出（需单 turn 内 ≥64 次 reset 的病态组合）时，「无 reset entry between them」失去证明力，插值可能跨越一次未在册 reset；后果仅为一条诚实标注 semi 的插值记录 | 停走条件加一条：候选 seq 早于保留 resetLog 最老条目 seq（且非空）即 break；补一例 store-attribution 边界测试；或按 §11 记 user_approved_deferred（附病态触达论证） |
| V4-1 | src/tools.ts:509-531 preflightCalibrationStats（basis :529） | local-fallback 投影行计入 comparable/mean/worst，basis 行却声明 "fallback rows are not calibrated"——呈现数字与声明口径不一致；该台账是 enforce 升格决策（no-go 条件 4）供数源，混合口径污染官方估算器误差分布判读（行为被 spec:611-624 显式钉为故意，属措辞/口径问题非行为缺陷） | (a) fallback 行不计入 comparable（拆 official-only 口径 + fallback 单独计数）或 (b) basis 措辞改混合声明并同步 spec 注释——任一，以测试断言为准绳 |
| V4-2 | tests/preflight.spec.ts 全文 | 卡面「估算器两路径（宿主/fallback）」的宿主(official projector)路径无 preflight 执行钉：27 例全在 local-fallback 下跑；observe.spec 有同构官方 describe 先例（宿主在盘 + SKIPPED 约定），preflight 特有差量（注入 resolver 的官方路径估算/图片门/projector='official' 标注）未实跑 | 照 observe.spec 官方 describe 形态补一例 ZCTX_DSH_LLM 官方路径钉：record.projector==='official' + 官方 handle 文本估算差异 + 零变异（宿主缺席 SKIPPED 同款） |

## 5. 造假检查

未发现造假：官方/cordis/guardian 锚点逐个实读核对（chunk 协议注释、LlmFailure、FinishReasonMap、waterfall 组合序、TokenSurfaceNode、GenerateOptions.system string 类型、session 信封 turn/step 必填、surfaceOp replace-only）；测试断言与实现语义逐条对上（8 噪声逐项、五负例、双制度、caps 66→64、短路形态、R3 键面）；提交声称数字（302→332、741.04 kB、探针 5/8/16、closure 47 条）与实跑一致；enforce 全链例数学复核（triggerLine 8398 / hit line 7558 / estimate 66667）成立；评分无自评（reviewer-R4 ≠ coder-v3/v4）。评审过程仅还原了探针重生成的 U2 报告至入库态（git checkout，时间戳差异），未修改任何业务代码/测试/配置/del。

## 6. 移交事项

1. 主线：把 §4 三条 [建议] 记入 tasks/ZCTX/closures/closure.json（建议随 V5/V6 波当波 fixed，或按 §11 记 user_approved_deferred，disposition 二选一）；V4-E（margin 契约歧义）已由本评审确认成立，可视为 CLOSED-by-review。
2. V5-V6 波次注意：V4-2 的官方路径钉与 observe.spec 官方 describe 共享宿主在盘约定，V5（S2 adapter）联审时一并核对 ZCTX_DSH_LLM 探针面。
3. 收口节奏照旧：V5 单审 / V6 终审；V6 终验时核对 3 条 [建议] 的 disposition 全部非 OPEN。
