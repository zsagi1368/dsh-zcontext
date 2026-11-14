# REVIEW-P0 — v0.2.1 P0 评审交接（reviewer-P0 → 主线）

```
FROM: reviewer-P0 (independent subagent)
TO: 主线 (orchestrator)
MODE: verify
TASK_REF: ZCTX v0.2.1 P0（tasks/ZCTX/cards/P0-inject-fix.md · reports/plans/ZCTX-v021-plan.md §0/§1）
PAYLOAD: SCORE 98/100（≥98 通过）· 0 [阻断] · 4 [建议] P0-1..P0-4 · ARTIFACTS 见下 · CHECKPOINT ZCTX-P0 p0s4-terminal（复核一致）
ATTACHMENTS: tasks/ZCTX/scorecards/P0.json · 本文件 · 临时副本 C:/Users/ZS/AppData/Local/Temp/zctx-p0-review-removal-check（评审脚手架，见注）
```

## 结论

**通过（总分 98 ≥ 98）→ P0 块中间合入放行。0 条 [阻断]。4 条 [建议]（P0-1..P0-4），按 §0.1/§11 当波记账——阻塞最终验收，不阻塞中间合入；每条需唯一 disposition（fixed / user_approved_deferred / duplicate / not_applicable）。**

评分明细（§12.1，逐维证据见 scorecards/P0.json）：正确性 25 · 完整性 19 · 一致性 19 · 可验证性 15 · 安全回滚 10 · 可维护性 10。扣分仅两处：卡/计划两输入件未入库（完整性 −1，P0-4）、README 测试数+探针清单滞后（一致性 −1，P0-2）。

## 六键独立复核结论（重点攻击方向 1 — 全部实读命中，无拼凑）

| 键 | 提供方锚点（锚树 G:/000Github/zDSH/zDSH-main） | 复核 |
|---|---|---|
| tools | packages/core/tools/src/index.ts:850 `super(ctx, 'tools')` | 实读命中 |
| systemPrompt | packages/core/system-prompt/src/index.ts:442 `super(ctx, 'systemPrompt')` | 实读命中 |
| commands | packages/interaction/commands/src/index.ts:277 `super(ctx, 'commands')` | 实读命中 |
| llm | packages/llm/llm/src/index.ts:354 `super(ctx, 'llm')` | 实读命中 |
| tokenMeter | packages/llm/token-meter/src/index.ts:111 `super(ctx, 'tokenMeter')` | 实读命中 |
| sessions | packages/api/session-controller/src/client/sessions/service.ts:282 `rootCtx.reflect.provide('sessions', this, undefined)` | 实读命中 |

- 协调者标记的"反直觉 sessions 路径"为真：提供方确在 session-controller client（非 core/session，卡面原猜测路径不存在），grep `provide('sessions'` 唯一实锚行 282——实现以实读为准而非照抄卡面，恰是卡面「必须实读」的正确执行。
- 键=注册名机制源码级证实：vendor/cordis/src/service.ts:51 `self.ctx.reflect.provide(name, self, ...)`（super(ctx,name) 即注册）；惯例锚 compaction-basic/src/index.ts:114 `['llm','tokenMeter','sessions']` 亦实读命中。
- **发现（P0-1 [建议]）**：sessions 键在 src 全域零消费（grep 独立复核零命中）——按卡面执行无错、宿主必提供，但属无消费者耦合面，官方未来移除/改名时将静默 PENDING（恰是卡面最警惕的失效形态）。修法二选一：注释补声明理由 / P1 确认无消费计划后摘键。

## 五个攻击方向逐条结论

1. **六键正确性**：见上表，全部独立复核成立。
2. **mock 纪律保真**：mock-host.ts 特殊属性清单与 reflect.ts:86-91 逐项一致（RESERVED_WORDS=['prototype','then'] 实读）；∈inject→store 解析 / 缺失=belt undefined（真实宿主 PENDING，fiber.ts:613-627，mock 头注 DOCUMENTED DEVIATION 明示）/ 其余抛 :144 同款错误串——**该语义是 cordis 真有的，非自创**（reflect.ts:136-166 实读）。inject 活读自锁 = 防复发本体成立。
3. **probe-real-mount 拓扑忠实度**：六桩各自插件 fiber 提供=官方 provider 形态；sessions 真机在 rootCtx 直供（宽容态）而探针按兄弟 fiber 供给=**更严不假绿**；G2 负对照把"拓扑漂移宽容化"钉成红——保真度被探针自身机器守护。G3 覆盖 plugin.ts 全部启动期访问点（构造死点 :256-258 / session feed ×3 / tools×4 / section / nudge required / command / llm/stream×2 经真 EventsService._hooks，events.ts:131 实读确认）；G4 覆盖 adapter 面。脚注：事件期回调体探针不执行（同 ctx 代理解析语义+单测已覆盖+PENDING 守卫兜底），不影响结论有效性。
4. **fiber walk 只走祖先链的地面真相**：源码级证实（reflect.ts:153-166 祖先链 walk；provide→notify→_checkImpl 仅把 inject 声明键拷入消费 fiber 的 _store，reflect.ts:286-303 + fiber.ts:596-608；任一缺失 epoch=INACTIVE=PENDING，fiber.ts:613-627）。真宿主含义：六键齐备 → 六 impl 拷入我方 fiber store → 解析在 0 层成立；缺任一键 → 兄弟提供的不可达 → 设备同款错误。锚树无 'internal/get' 宿主拦截器 → vendor 语义=设备语义。
5. **摘除即红**：亲验复现 **恰 30 failed / 399 passed**（临时副本法，仓内零改动）——adapter-plugin 8 + plugin.spec 22，全部失败于构造点 src/plugin.ts:257 设备同款错误，**零陪跑**。脚注：smoke.spec 在 src-only 摘除下仍绿（其测 BUILT lib，副本未重建）；src+lib 全量重建只会红更多——机制声称稳健。

## 亲验电池（reviewer 本机实跑 2026-11-14）

- build：tsdown 992.98 kB / 7 files EXIT=0；`git status --porcelain lib/` 空 = 重建与入库字节一致
- test：vitest 22 files **429/429**（424 基线 + 5 纪律钉）
- lint：tsc --noEmit 零错 EXIT=0（build→test→tsc，Z19）
- 五探针全 EXIT=0：artifact 6/10/surface 10/smoke 3/host-imports 16/**real-mount 5**（G1×2+G2 负对照+G3 全触达+G4 adapter）
- closure 机器数：**69 items = 68 fixed + 1 user_approved_deferred**（W5-A6-INSTALL，post-merge，by design）；词表零违规；P0-A..D 全 fixed/verified 且 evidence 指向具体机制
- 树：两探针报告时间戳 diff 已按先例 git checkout 还原；仅剩 P0-4 两未跟踪输入件
- RSI：Z21/Z22 当天入册实读确认（ZDSH-LESSONS.md:129/:135 + INDEX.md:19/:106）

## [建议] 清单（全部 OPEN，阻塞最终验收不阻塞中间合入）

- **P0-1** src/plugin.ts:224 — sessions 键零消费：注释补声明理由或 P1 后摘键（见上）
- **P0-2** README.md:223,229-232 / README.zh.md 同位 — 424→429、探针清单补 probe-real-mount：随 P3 发布波 version+CHANGELOG+README 同批更新（§15）
- **P0-3** tasks/ZCTX/closures/closure.json — V6-1 已修（d8d2f5a，README en/zh:231 实锚）但台账无条目：补一条 fixed/verified（evidence=d8d2f5a+README:231+本评审复核），机器数 69→70
- **P0-4** reports/plans/ZCTX-v021-plan.md + tasks/ZCTX/cards/P0-inject-fix.md — 随下一 governance 增量提交入库（V6 先例卡随 governance 入库）

## 评审纪律声明

- 评审人 ≠ P0 coder；无自评。全程零业务代码/测试/配置/del 改动：摘除即红用系统临时目录副本 + node_modules junction（原仓 git status 复核干净）；两探针报告时间戳 diff 已还原。
- **遗留注记（交主线处置）**：临时副本目录 `C:/Users/ZS/AppData/Local/Temp/zctx-p0-review-removal-check`（内容=仓库只读拷贝+单行补丁，原件全在 git，零还原价值）。按 §5 删除需备份+独立复核，本 subagent 无法自行满足双人复核条件，故留存不删——主线可在收口时按 §5.1 精神（自建验证脚手架、系统临时目录）处置或留待用户清理。
- fraud_check：未发现造假——所有关键声称均本波亲验复跑或逐行实读（含 4.0.5-alpha.1 版本号、context.ts:81、events.ts:131 等次级锚点）。
