# P6-F 任务卡：基准重跑（autofold 开）+ 发布 v0.3（终波）

> 前置：P6-E 评审 99 放行已合并 main（autoFold 引擎在库）；5 条评审建议（REVIEW-P6D2E）本波落账。

## 任务

1. **5 条建议落账**（REVIEW-P6D2E R1-R5 逐条 disposition 进 closure + 代码/文档小修）：
   - R2 replay-f297.mjs 入库（评审已独立代偿验证，归档化）；
   - R3 external 供给 apiKeyEnv 缺失时补 warn；
   - R4 autofold.ts:883 texts 子串分类依赖→结构化字段替代或钉测固化；progress.md 措辞与载体（closure.json）对齐；
   - R5 归档 switch-group.mjs 加历史证据件头注；
   - R1 BENCH-L5 approval 记录回填（autoFold 交付后该 deferred 的处置=机制已解，如实登记）。
2. **基准重跑（autofold 开）**：bench HOME（C:/Users/ZS/AppData/Local/Temp/zctx-bench-home）装件 lib 同步最新→C2 场景（40k 窗口压力臂）autofold.enabled=true 跑 20 轮→**服务端自发折叠发生率/每次净省/累计 billedInput 曲线**（对照 P6-D 无 autofold 的 C 组数字）；免费路由固定；原 profile 零触碰；数字如实（含失败轮）。
3. **发布 v0.3**：package.json/CHANGELOG 0.3.0 段（P0 修复+审计修复+autoFold+patcher v0.2）/README 双语补 autoFold 与 patcher v0.2 段/patcher/README v0.2 化（补丁集/重打/回滚全流程）/版本面三方一致/lib 重建/tag v0.3.0。
4. **5 探针+全量电池回归**+干净树。

## 约束

红线 R1-R8；真机 patch 执行仍归用户命令；**开工首动作=查册**；长内容 Write/Edit；先 tsc 后 vitest（Z19）；§5 备份；小步提交；卡壳如实报告；遗留如实登记（v0.4 项除外须台账）。
