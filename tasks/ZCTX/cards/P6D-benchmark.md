# P6-D 任务卡：基准对照实验（v0.3 波次——"省 token"从宣称变数字）

> 依据：REPORT-GO-NO-GO.md §10（5 组对照/7 指标/5 门槛数字）。目的：回答用户原始诉求「多跑几轮 tokens 消耗太快」到底被解决了没有。
> **诚实纪律**：这是全战役第一次真实测量。跑不出数字就如实报"未解决"，禁止编造。

## 环境

- **用用户真实桌面 profile 的克隆**（凭证/模型路由现成）：克隆 `C:/Users/ZS/.dsh/profiles/desktop` → 隔离 benchmark HOME（`C:/Users/ZS/AppData/Local/Temp/zctx-bench-home/profiles/bench`）。克隆前备份原 profile package.json（只读克隆，原 profile 零改动）。
- **模型**：用用户 profile 现有路由中**免费路由**（`opencode-zen-free/deepseek-v4.1-flash-free` 或类似 `-free` 后缀路由）——零 API 成本。固定一个模型跑全程。
- **CLI**：zDSH-main 真 CLI（apps/cli/lib/bin.js，headless json-stream 模式——A 线实证 packages/bundle/headless 存在，StepUsage 逐轮记账）。探明 CLI 非交互用法后固定。
- **注意**：装件=桌面 profile 克隆里的 dsh-zcontext（当前 0.2.0 或 0.2.1 取决于克隆时点）——**先升级克隆内装件到 lib 最新**（替换 node_modules/dsh-zcontext 的 lib 为仓内最新 lib/，即 0.2.2 全部能力）。

## 分组（REPORT-GO-NO-GO §10.1 五组的可执行版）

| 组 | 配置 | 实现 |
|---|---|---|
| A 裸官方 | 克隆 profile 移除 dsh-zcontext bundles 行 | 基线 |
| B 装但关 | 保留 bundles+依赖，config `enabled:false` | 固定开销增量 |
| C 全默认 | bundles+config 默认 | 主效应（模型可折叠） |
| D enforce | `preflightMode:'enforce'` | 隔离 S1（本轮可后置） |
| E zctx 路由 | providers 配置+zctx 路由模型 | 隔离 S2（本轮可后置） |

**本轮执行 A/B/C 三组**（D/E 依赖 config 深度与模型路由能力， pilot 后再定）。

## 任务集（固定）

固定一个可多轮推进的任务脚本（如"逐步构建一个小项目：轮 1 列文件→轮 2 读→轮 3 改→…→轮 50 总结"），每轮一条固定 user prompt，脚本化喂给 headless CLI。**同任务集跨组复用**。轮数：pilot 10 轮起步，验证管线后矩阵 50 轮。

## 采集

- headless json-stream 的逐轮 usage（inputTokens/cacheRead/cacheWrite/outputTokens）→ 逐轮 billedInput=input+read+write
- 会话日志中 `zctx_fold` 调用次数/每次 tokensBefore/After（折叠发生率——命门指标）
- cache 命中率曲线
- 五探针照常跑（代码层不回归）

## 分阶段执行

**Phase 1 pilot（必做）**：
1. 探明 headless CLI 非交互用法（`node bin.js --help` / json-stream 触发参数）
2. 克隆 profile+升级装件 lib 到 0.2.2
3. 跑 1 条 10 轮会话（C 组配置）→ 验证：插件挂载无错（P0 修复真机复验）+ `zctx_fold` 是否被调用 + usage 是否逐轮可采
4. pilot 报告：管线通/不通、模型采用率初步观察、逐轮 token 数字样本

**Phase 2 矩阵（pilot 通后）**：A/B/C 三组×10 轮起步→50 轮；逐组出 p50/p95 累计 billedInput+折叠次数+命中率曲线；D/E 组判定后置。

## 产出

`reports/bench/BENCH-report.md`（pilot+矩阵逐组数字+采用率结论+对照 p50/p95 表+诚实边界：免费路由/单模型/N 轮样本的适用边界）+ 逐组原始 json-stream 输出存档 `reports/bench/raw/`。

## 约束

原 profile 零改动（只读克隆）；隔离 HOME 自建自收；真实 API 调用走免费路由（零成本）；**禁编造数字**——跑不出就报跑不出；开工首动作=查册；长内容 Write/Edit。
