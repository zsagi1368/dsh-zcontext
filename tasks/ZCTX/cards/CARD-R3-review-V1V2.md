# CARD-R3：V1+V2 联审（reviewer 卡 · v0.2.0）

TASK_ID: ZCTX-R3 · 产出：tasks/ZCTX/scorecards/V1.json + V2.json + handoffs/REVIEW-V1V2.md

## 对象

- **V1**（8e82b1b..91ab316，含 U1/U2 探针）：五类观测契约（types）+store 观测账本（request/header 链+9 类 ResetEvent+callConfigEquals 本地孪生+UsageRecord 全字段+单一 applyEvent 迁移）+两阈值 config+探针报告（U1=SKIP：Models 页 layoutOf 硬阻断第三方 settingsNs 页内配置；U2=GO：dsh-llm 16 导出在盘）。
- **V2**（7425822..5092987，含一次配额死亡接力）：types 契约（RequestSnapshot/PrefixBreakRecord/CapturedAttemptUsage/series-restart）+host-llm fail-soft 双路径懒加载+observe listener（四判据/attempt 快照/前缀单调检测/可选 attemptCapture/零变异钉）+store 接收口+series 纳账+c5 接线（wireObserveFace+五面能力探测降级+observe.enabled/attemptCapture 开关）。

## 契约基准

reports/plans/ZCTX-v02-plan.md（§2 红线 R1-R8/§3 设计冻结）；规格底座 G:\000Github\zDSH\zDSH-docs\R&D\zctx-20261112\RES-observe-route.md（Q1/Q5/Q8/a.1-a.3）+ RES-adapter-route.md（U1/U2）；v1 已发布基线（v0.1.0 五波 99-100）。

## 重点攻击方向（每条要结论+证据）

1. **V1 本地 callConfigEquals 孪生的等价性**：与官方实现（packages/llm/llm/src/call-config.ts）逐字段对照——U2 G4 探针只钉了 same/model-diff/stop-diff 三例，字段覆盖有无遗漏（如 reasoningEffort/tools/adapterDefaults）。
2. **V2 只读纪律真实性**：frozen 零变异钉是否真钉住——listener 内有无隐性写路径（快照对象的构造是否可能触碰原对象；stableStringify 的实现是否纯读）。
3. **前缀单调机械件**：detectPrefixBreak 与 zDSH-Go guardian verifyMonotonic（G:\000Github\zDSH\zDSH-wt\zDSH-go cache-guardian.ts，只读对照）的同构性；ResetEvent 豁免窗语义（guardian seq 豁免窗同构声明）。
4. **观测台账有界性**：64/64/64 有界设计+forgetSession 修复——跨会话泄漏面是否闭合（watched 集清理/attemptSeq 重起钉）。
5. **双路径诚实标注**：host-llm 懒加载失败模式——宿主在盘时会不会误走 fallback（import 失败的判定条件）；projector:'local-fallback' 标注与 U2 探针的一致性。
6. **store 单一 applyEvent**：attach/feed/resync 三路一致性测试是否真覆盖（V1 自报"双制度 feed==scan 钉"）。
7. **R1-R8 红线逐条**：本两波应零短路/enforce/adapter 面——逐条核对。
8. **探针质量**：U2 探针的导出断言清单 vs 官方 index.ts 实际导出（多测/漏测）；U1 报告的 file:line 是否可复现。
9. **亲验**：pnpm build/lint/test 三绿+probe-artifact/verify-activation-surface/probe-host-imports 三脚本 exit 0。

## 评分与产出

§12.1 六维逐维证据（file:line+命令输出）；<98 给 [阻断]/[建议]+修法（以测试断言为准绳文字）；只写 scorecards/V1.json、V2.json 与 handoffs/REVIEW-V1V2.md 三个文件；评审人≠作者；发现造假直接 0 分上报。完成后报告两卡总分+[阻断] 数。
