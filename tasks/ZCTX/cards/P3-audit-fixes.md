# P3 任务卡：审计修复波（v0.2.1 波次——REPORT-FULL-AUDIT.md 冻结清单执行）

> 清单权威：reports/audits/REPORT-FULL-AUDIT.md（222 行，SHA-256 50a9d0ea…）——P3-必修 5/P3-强化 16/P3-盲区钉测 9/P3-结构 1（texts 收敛登记 v0.3 不做）。
> 全部修复建议以 AUD-state-machines.md/AUD-host-faces.md 原文为准；四必修已 E 域复现确认（AUD-verification-replay.md）。

## 波内分块（各自提交）

- **P3a 必修 5**：SM-01（applyEvent 幂等/单调守卫——注意含 store.spec.ts:289 误标测试的真修复：注册监听+真重复投递钉）/SM-02（extractCheckpointSource 有限性校验 Number.isFinite 对齐 extractUsageRecord:322-326 先例+zctx_status 渲染防御 try/catch+诚实降级文案）/HF-01（拒图三选一按 AUD-host-faces §1.2，择项后注明裁决理由）/HF-02（inject 摘 sessions 键+probe-real-mount 相应调整——G3 断言六键改五键+保留正确性证明价值）/Z19（package.json scripts.test 改 build&&vitest 链或加 pretest，二选一注明）。
- **P3b 强化 16**：D1 5 条（SM-03 scanUpTo 熔断/SM-04 resume-series 归因钉测固化/SM-05 validator 配置极值守卫/SM-06 unfold 嵌套防御性断言/SM-12 NaN contextWindow 拒收）+D2 8 条（HF-04 工具 never-throws 对齐/HF-06 retryableCodes 交互/HF-09 boot 时序探针验证后定惰性 watching/HF-15 register throw 路径 fail-soft 等——逐条按 AUD-host-faces 原文）+C 域 TOP3（seq 守卫=SM-01 同修/导出卫生：GUIDANCE_TITLE 孤儿删除+12 类型收窄/providers 深冻结）。
- **P3c 盲区钉测 9**：SM-08/09/10/11/13+HF-09..12（钉测建议已附 AUD 报告；HF-09 为探针验证项）。

## 验收

- 修复后全量电池：build→vitest（429+新增钉测）→tsc→五探针全绿；**四必修的 E 复现脚本反向验证**（修复后复现脚本应 NO-REPRO——把仓外复现脚本转正为仓内回归测试或至少跑一遍证实修复）；
- REPORT-FULL-AUDIT.md 清单逐条打勾（P3-结构项登记 v0.3）；closure 台账同步；
- 小步提交 fix(ZCTX): P3 <id>（SM-01/HF-01 等逐条）；台账落盘；卡壳如实报告；遗留为零（v0.3 登记项除外，须台账 user_approved_deferred 或 roadmap 登记）。

## 约束

红线 R1-R8；开工首动作=查册；先 tsc 后 vitest（Z15）；长内容 Write/Edit（Z18）；§5 备份；HF-01 择项与 Z19 择项需在 checkpoint notes 记录裁决理由。
