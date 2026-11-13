# V6 任务卡：文档+发布（v0.2.0 波次 6/6 · 收尾）

> 前置：V5 评审 ≥98 放行。计划 §2 A/B 判据（B4-B7 对应 v0.1.0 plan 的 A5-A7 同款）。

## 产物

1. **README 双语更新**（en/zh 镜像三门约束）：
   - 新能力三块：①观测账本（三态回本记账/重置台账/前缀哈希——"装上即开始记，zctx_status 看"）②S1 preflight（preflightMode 三态；observe 默认；enforce 迁移三条件——真机标定前 opt-in）③S2 zctx 路由（family=协议名/providers 配置形态=profile patch 手写+Models 页 visibility-only 的诚实说明+缓存旋钮+wire 账本覆盖范围=仅 zctx 路由会话）
   - 限制更新：估算器阈值待真机标定（90s/60%/margin 0.9）；wire 账本仅覆盖 zctx 路由；对象级哈希盲于 pi-ai 域改写（诚实天花板）
2. **CHANGELOG 0.2.0 定稿**：V4 草稿基础上补 V5 全量（S2 面/config providers/volatile visibility-only）
3. **verify-activation-surface 扩展**：+preflightMode 默认 observe 特征断言+providers 结构化段存在+adapter 导出面+R4 maxRetries:0 特征+R7 attribution 特征（node 直读）
4. **probe-artifact 扩展**：V5 新公开导出断言（ZctxAdapter/adapter 面）
5. **真机冒烟扩展**（A6 同款）：smoke-real-loader 已 2 PASS——补一条 zctx provider 目录注册冒烟（loader 组合树含 adapter 行）——能力不及→SKIPPED 明示
6. **治理收尾**：closure 全量核对（56+新增全 closed）；checkpoint/progress 终态；RSI 捕获核对
7. **版本**：package.json 0.1.0→0.2.0+lib 重建+CHANGELOG 版本面

## 验收

三绿+全套探针 exit 0+干净树；双语逐节机械核对；提交 docs(ZCTX)/chore(ZCTX) 小步；完成后报告文件清单+三绿证据。

## 约束

红线 R1-R8；净室；en/zh 非机翻镜像；长内容 Write/Edit 工具；开工首动作=查册。

## 顺手闭合（R5 联审 4 条，先于文档动作）

- V5-1：store.ts:1297 cap-guard 补边界测试专钉（删行变红；连带闭合 V3-1）；
- V5-2：zctx-adapter.ts:201 缺省 maxTokens 静默发明 32768——**选 a 官方对齐 fail-loud**（catalog.ts:934-936 语义：配置缺失即构造期报错列清单，不发明默认值）；
- V5-3：config.ts:175 陈旧注释与 configDefaults.providers=[] 与 smoke 契约钉三方矛盾——统一为单一口径；
- V5-4：plugin.ts 违规清单前移到可达性门之前（校验不依赖宿主）。
- 处置后 closure 对应条目 fixed/verified；V1-A（非有限值理论差异）在终验收前一并处置或明确登记。
