# REVIEW-P3 — P3 审计修复波对抗评审（f01b5cd..b676f83）

```
FROM: reviewer-P3 (independent subagent)
TO: 主线
MODE: verify
TASK_REF: P3 审计修复波评审（tasks/ZCTX/cards/P3-audit-fixes.md + REPORT-FULL-AUDIT.md 冻结清单）
PAYLOAD: SCORE 93/100（六维见 tasks/ZCTX/scorecards/P3.json）· [阻断] 0 · [建议] 6（P3-1..P3-6，全部阻塞最终验收、不阻塞中间合入）
ATTACHMENTS: tasks/ZCTX/scorecards/P3.json（SHA-256 见 progress 回录）· 本文件
CHECKPOINT: 评审为单步只读任务，无自有 checkpoint；评审过程证据全部在本文件与 scorecard 内联（命令输出级）
```

## 判定：打回（93 < 98）——代码修复本体全数核实为真，打回项全部为文档/台账卫生面

六维：正确性 25/25 · 完整性 17/20 · 一致性 18/20 · 可验证性 14/15 · 安全回滚 10/10 · 可维护性 9/10。

## 一、亲验证据（reviewer 本机实跑 2026-11-14，全部 exit code 记录）

| 项 | 命令 | 结果 |
|---|---|---|
| test（Z19 新链） | `npm test`（tsdown && vitest run） | 471/471（22 files），EXIT 0；tsdown Build complete 先于 vitest |
| lint | `npx tsc --noEmit` | 0 错，EXIT 0 |
| 五探针 | probe-artifact / verify-activation-surface / smoke-real-loader / probe-host-imports / probe-real-mount | 6/0/0 · 10/0 · 3/0/0 · 16/0/0 · 5/0/0，全 EXIT 0；两报告时间戳 diff 已按先例还原 |
| E 复现反向 | 四脚本亲跑 | SM-01 exit1（0 REPRO/5）、SM-02 exit1（毒化 3 态全 NO-REPRO，剩余 1 REPRO=对照组）、HF-01 exit0（7/7，方案 a 预期）、HF-02 exit1（步 1 NO-REPRO=修复生效，剩余 1 REPRO=正对照组）——与 §8 回执四条退出码逐项吻合 |
| closure 机器数 | node 遍历 closure.json | 98 items：fixed 93 / user_approved_deferred 2 / duplicate 3；status 词表 verified 68 + closed 29 + open 1 |
| 导出面 | lib/index.d.ts 解析 | 126 项（R15 声明不回归，机器数吻合） |
| 新鲜度 | npm test 重建 lib → git status lib/ | 零漂移（重建字节=入库字节） |
| 树 | git status | tracked 零 diff（还原探针时间戳后仅剩审计波既有 .gitignore +1 行）；untracked 7 件=审计件+P3 卡（见 P3-5） |

## 二、四必修逐条核验（全部 fixed 属实）

1. **SM-01（f01b5cd）**：双分支守卫（src/store.ts:932-945）对照 E 五腐败面逐一成立（A 复活/B 括号重开/C 膨胀在 `eventsBySeq.has` 分支拦；D 级联+E 单调在两分支联合关闭）；`seq==lastSeq` 未保留的合法首投形态（scanUpTo unreadable 槽，store.ts:928-930）有注释且不被误拦。store.spec.ts:289 真修复三件套实读确认（监听接线+真重投同一事件对象+samples/syncedToSeq/anomaly 三断言）。**摘除即红评审人亲证**：临时副本（G:\000Github\zDSH\zctx-p3-review-rm-tmp，junction，已清理）删双分支 → store.spec 恰 7 红（重写测试+5 钉+1 依赖守卫的 breaker-resume 钉），零陪跑。
2. **SM-02（614028a）**：Number.isFinite+非负 twin 对齐 + droppedAmounts→anomaly + renderStatus fail-soft（STATUS_OBS_SNAPSHOT_FAILED）。对照组 strong 行保留（亲跑确认），三毒化态全 NO-REPRO。
3. **HF-01（219f7ff，方案 a）**：三选一裁决成立——(b) 淘汰依据 U1 探针实证可回溯审计原文、(c) 淘汰依据=审计明示不可靠。契约降级三处落地（adapter 头注/门注/README.md）+ WireSnapshot.imageCount 钉。**诚实呈报合规**：HF-01 exit 0 被三处（checkpoint p3s0/closure P3-M3/§8 回执）一致登记为『方案 a 有意保持机制』，未谎报 NO-REPRO。残留：zh/CHANGELOG 未同步（见 P3-1/P3-2）。
4. **HF-02（c9ed41f）**：五键+摘键理由注释+『无 sessions 激活』双钉（plugin.spec）+probe-real-mount 五桩。G3 现为真 cordis 无 sessions 激活钉——『错误键=静默 PENDING』证明价值保留（重引入声明未读键 → G3 PENDING 红）。
5. **Z19（83e966e）**：`"test": "tsdown && vitest run"`——&& 失败即停语义确认；pretest 钩子淘汰理由成立（pnpm 默认不跑 pre/post）；评审人亲跑确认 build 先行 + lib 重建字节一致。

## 三、强化 16 条抽查（5/16 语义全对 + 3 组摘除即红亲证）

R1（breaker=16 有界 fail-soft）/R3（validatorConfig 单漏斗 clamp，grep 唯一构造点核实）/R4（unfold-span 防御降级+unknown-foldId anomaly）/R13（四面 register try→warn，缺席+抛错双态降级；剥离 try → 恰 1 红）/R16（deepFreeze）——逐条对照 AUD 原文成立。非抽样项抽读：R7（== null+TOOL_EXECUTION_FAILED+command containment）、R15（GUIDANCE_TITLE 反复活钉+126 导出面亲数）、R12（钉测在 npm test 输出亲见绿）。

## 四、P3c 钉测 9 条

T2 八形态逐形态对照审计 §4 表全命中；T5 三向断言（[user]+summary/非 marker/非原文）强于审计建议；T7 健康段每 gate 落 state+settled；T8 warn+observe 回退（off 先行分支不受影响）；T9 值域门 7 levels 与 THINKING_LEVEL_ORDER 逐项同步核实+apiKeyEnv 卫生。**T6**：探针报告四锚点评审人回源——三条命中（core/session:1262-1276/:1118、agent-loop:664-671 announce 先于 run 逐行实读）；证据 3 锚点失实（service.ts:599-640 实读无 restore 措辞，真锚=core/session/src/index.ts:596-620 fromRestore）——实质结论（惰性 watching 不需要）经独立回源确认成立，报告需一行更正（P3-3）。

## 五、[阻断] 清单

**无。** 代码修复、测试、退出码、台账全部核实为真，无伪造痕迹。

## 六、[建议] 清单（不阻塞中间合入，阻塞最终验收；每条须唯一 disposition）

- **P3-1** README.zh.md:142 + zh dev 段 —— zh 镜像滞后：旧拒图契约未降级、测试数仍 424、无 Z19 链说明。修：按 en 侧同步。
- **P3-2** CHANGELOG.md:90-92 + 无 0.2.1 段 + package.json version 0.2.0 + 双语探针清单缺 probe-real-mount —— P0-2 已登记的跨波承诺（version+CHANGELOG+README 同批）只兑现 en dev 段一行；CHANGELOG 旧契约叙述与新代码矛盾。修：一个文档收口提交；若 release 另行走 §15，则按 §11 转 user_approved_deferred 并登记触发条件。
- **P3-3** reports/probes/P3-T6-boot-timing.md 证据 3 —— 锚点失实（service.ts:599-640 → 实为 core/session/src/index.ts:596-620）。修：一行更正，结论不变。
- **P3-4** closure.json status 词表分裂 —— 同为 fixed，存量 verified 68 条 vs P3 批 closed 29 条；§11 『fixed 必须 verified』字段表达不统一，机器校验口径含混。修：统一为 verified 或显式登记词表升级并确认工具兼容。
- **P3-5** reports/audits/ 六报告 + P3 卡等 7 件 untracked —— 冻结清单权威件在 git 外，closure 追溯链不可从 git 复原（P0-4 同类，terminal 波收口责任）。修：git add + chore(ZCTX) governance 提交。
- **P3-6** texts.ts:378 文案内嵌内部票据标记『(P3 SM-02 fail-soft)』+ LEGAL_PI_AI_LEVELS/THINKING_LEVEL_ORDER 双列表仅注释约束无同源钉测。修：删标记+补同源钉测。

## 七、诚实度专项结论（攻击方向 7）

四必修反向验证的呈报**合规且诚实**：SM 系/HF-02 三条 exit=1（NO-REPRO）与亲跑一致；HF-01 exit=0 被如实登记为『方案 (a) 机制有意保持，验收=契约降级+imageCount』而非谎报 NO-REPRO——三处登记口径一致（checkpoint p3s0 notes / closure P3-M3 evidence / §8 回执）。剩余 REPRO 行均为对照组/正对照组，按复现脚本原语义正确保留。未发现任何伪造证据/评分/派发/测试的痕迹。

## 八、评审纪律自述

- 评审人 ≠ 作者（reviewer-P3 独立 subagent，未参与 P3 实现）。
- 仓内零改动：摘除即红在临时副本执行后已删除；探针报告时间戳已还原；终态 git status 与开工一致。
- 波次 diff 总量超 600 行纪律的处理：19 提交本身即为拆小（最大单提交 ac3c3ef 约 433 行且含 lib 产物/探针报告），按提交粒度逐块评审，不再打回拆分。
- 评分全部附证据路径/行号/命令输出；无证据维度记 0 的条款未触发（六维均有直接证据）。

（完 · 交主线：打回清单六条当波收口后可复评；代码块本身已达可合并质量，文档收口不涉及行为。）
