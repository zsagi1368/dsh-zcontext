# CARD-AUD-C：全树架构审计（architect · 全量审计令 C 域）

TASK_ID: ZCTX-AUD-C · 产出：reports/audits/AUD-architecture.md（边写边落盘，报 SHA-256）

## 背景

用户令：RSI+codegraph 全量审计（11 波：v0.1.0 五波+v0.2.0 六波+P0）。主线已用 codegraph 亲审三条关键流（fold/unfold 提交、preflight 短路、adapter 管线——结论：与各波声称一致）。你负责**全树架构层**审计（区别于逐波 diff 评审——这是整树横切）。

对象仓：G:\000Github\zDSH\zDSH-plugins\dsh-zcontext（只读；src 20 文件约 5.5k 行+tests 22 spec+scripts）。

## 审计清单

1. **跨波契约一致性**：W 波（fold 主链）→V 波（观测/adapter）→P0（inject）累积后，早期公开契约（checkpoint source 形态/工具 schema/config 键名/index 导出面）有没有被后期波无声破坏（抽 5 处对照 CHANGELOG 与 README 声明）。
2. **模块依赖方向**：src 内 import 图（可参考 codegraph 索引 .codegraph/）——纯核心（budget/validator/materialize/search/attribution/texts/hash）是否保持零宿主依赖；宿主面（plugin/tools/observe/preflight/adapter/*）是否都走 fail-soft 可选导入；有无反向依赖/环。
3. **死代码与孤儿导出**：index.ts 公开面 vs 实际消费（含 lib 产物一致性）；tests/helpers 是否有未用；config 字段是否全部被消费（CONFIG_FIELD_SPECS 钉覆盖）。
4. **状态机一致性**：store 的 applyEvent 单一迁移在 V1(9 类 ResetEvent)→V2(快照接收口)→V3(attribution)→V5(wire 接收口) 四次扩展后的不变量（有界 64×N/attach 清空/resync 三路一致）——跨波扩展有没有破坏早期不变量（抽 detach/attach 循环+cap 逐出+timeWindow 兜底交叉场景）。
5. **命名与结构**：src/adapter/ 八模块与 src/ 顶层的边界清晰度；texts.ts 单家园原则残余违规（模型可见文本散落）。
6. **配置面全景**：全 config 键（v1 九字段+V1 两阈值+V2 observe 两键+V4 preflight 两键+V5 providers 结构化段）——默认值/satisfies 钉/README 文档三方一致性。
7. **跨波回归抽查**：V/P 波改动有没有破坏 W 波保证（抽查：checkpoint 裸 UserMessage 形态仍在/净缩门仍调/attributionHeaders 仍全请求/required:true 仍在）。

## 产出格式

按 7 项分节；每项=结论+证据（file:line）+[良好/注意/缺陷] 分级；缺陷给修法（测试断言为准绳）。末尾：全树架构健康度总评（1-10）+TOP3 建议。

## 约束

只读；只写 AUD-architecture.md；≥120 行；codegraph 索引已建（.codegraph/ 可用——用 mcp__codegraph__codegraph_explore projectPath=仓根辅助追踪）。开工首动作=查册。
