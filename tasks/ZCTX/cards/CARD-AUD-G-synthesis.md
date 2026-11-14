# CARD-AUD-G：总审计报告+P3 清单冻结（synthesizer 卡）

TASK_ID: ZCTX-AUD-G · 产出：reports/audits/REPORT-FULL-AUDIT.md（唯一写入件）

## 任务（prompt 已详述，本卡为档案基准）

汇总全量审计七域（A codegraph 亲审/C 架构 8.5-10/F RSI 自审/D1 状态机/D2 宿主面/B verifier 12-12+2 修正/E 重放+复现）成总审计报告+P3 修复清单冻结。

## 清单分层口径

- P3-必修：SM-01（applyEvent 幂等/单调守卫+store.spec.ts:289 误标测试修复）、SM-02（extractCheckpointSource 有限性校验+zctx_status 渲染防御）、HF-01（图片诚实拒图三选一，AUD-host-faces §1.2）、HF-02（inject 摘 sessions 键）、Z19（test script build&&test 固化）——全部 E 域复现确认。
- P3-强化：D1/D2 边界强化 13 条+C 域 TOP3（seq 守卫=SM-01 同修/导出卫生/providers 深冻结）。
- P3-盲区钉测：D1/D2 覆盖盲区 9 条（钉测建议已附）。
- P3-结构：texts.ts 单家园收敛（~15 处，两路径择一；可登记 v0.3）。
- 每条：ID/来源域/严重度/修法/验收断言/来源锚点（AUD-*.md 条目 ID+复现状态）。
