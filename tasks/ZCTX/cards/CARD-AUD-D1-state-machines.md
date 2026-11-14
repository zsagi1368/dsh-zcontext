# CARD-AUD-D1：状态机域深度审计（reviewer · 全量审计令 D1）

TASK_ID: ZCTX-AUD-D1 · 产出：reports/audits/AUD-state-machines.md（边写边落盘，报 SHA-256）

## 背景

全量审计令（用户 2026-11-14）。C 域架构审计已过（健康度 8.5/10，其 TOP3：texts 收敛/seq 单调守卫/导出卫生——你负责从**行为正确性**角度深审状态机域，与 C 域的结构视角互补）。

对象：G:\000Github\zDSH\zDSH-plugins\dsh-zcontext 的**持久状态机域**——src/store.ts（唯一真源 applyEvent 迁移+9 类 ResetEvent+9 台账 64-cap+attach/feed/resync 三路）+ src/attribution.ts（归因引擎 strong/retry/weak+三态定级）+ src/fold-engine.ts（fold/unfold 提交+互斥+代数校验）+ src/validator.ts（保守验证器）+ src/materialize.ts（单节点重物化）。

## 审计重点（行为正确性，攻击者视角）

1. **applyEvent 不变量穷举**：事件序列注入异常形态（重复 seq/乱序 seq/未知 type/畸形 data/surfaceOp 与 sourceEventSeqs 不一致）——store 是否 fail-soft 不腐败（对照 mock-host 纪律）；C 域已指出"feed 有序唯一假设无防御"——你从攻击序列角度扩展。
2. **折叠- unfolds-再折叠-嵌套吸收 状态转移穷举**：foldMap 状态机（active→absorbed/dead/unfolded）的非法转移可达性（如 absorbed 后 unfold/未知 checkpoint 嵌套/跨 compaction 窗口折叠）。
3. **归因引擎边界**：多折叠并发归因（两 fold 同窗竞争 M 的归属）/interrupted 样本/semi 插值与 reset-between 交互/timeWindow 兜底与 seq 主键冲突时的优先级。
4. **与官方 compaction 的交互状态机**：compaction/start…end 括号内我们的 fold/unfold 全部拒收——括号异常形态（无 end/双 start/跨代）下我们的互斥检查是否会漏判。
5. **数值边界**：64-cap 逐出+attributionTimeWindowMs 极值（0/负数/NaN config）+tokensBefore/After 溢出。
6. **既有测试覆盖盲区**：以上你构造的攻击序列中，哪些既有 spec 没覆盖（列出+给钉测建议，不实现）。

## 产出

按 6 项分节+[真缺陷/边界强化/覆盖盲区]分级+证据 file:line；不实现修复（报告给 P3 清单）。≥100 行。

## 约束

只读；只写 AUD-state-machines.md；评审人≠作者视角（你未参与实现）；开工首动作=查册。
