# P6-D2 任务卡：face 未生效运行时根因定谳+修复（BENCH-L1）

TASK_ID: ZCTX-P6D2 · 前置事实：P6-D 基准 170 轮零折叠；激活探针（C:\Users\ZS\AppData\Local\Temp\zctx-a69-driver\probe-activation.mjs）实证 dsh-zcontext **不在** 8 条 PENDING 名单（=apply 已跑或静默跳过），但模型 38 工具零 zctx_*；Z28 实证 fail-soft warn 进 ctx.logger 在 headless 无 sink=静默。

## 任务

1. **定谳**：给插件加 env 门控诊断（`ZCTX_DEBUG=1` → 各 face 注册结果经 process.stderr 直写，绕过 ctx.logger sink 问题——仅诊断用，默认零输出）；在 bench HOME（C:/Users/ZS/AppData/Local/Temp/zctx-bench-home，已存在）跑 headless 最小任务 → 读诊断输出确定：apply 是否跑/五键服务是否全 resolve/工具注册是成功还是走了哪条降级路径（resolveDefineTool 失败？register throw 被 HF-15 吞？probe 误判？）。
2. **修复**：按定谳根因修（如 defineTool 解析失败→补宿主 face 或本地孪生；如某服务缺失→对应面降级改设计）。修复后 headless 最小任务模型**必须能看到并调用 zctx 工具**（模型证词或 tool list 断言）。
3. **复测**：bench HOME 重跑 10 轮 C 组会话 → `zctx_fold` 真实发生/未发生如实报告（采用率第一手数据）；BENCH-report 增补段。
4. **回归**：全量电池（build→test→tsc→五探针）不回归。

## 约束

诊断插桩 env 门控默认零输出（不污染生产）；bench HOME 是临时环境可改（原 profile 仍零触碰）；红线 R1-R8；开工首动作=查册；§5 备份；卡壳如实报告——**本卡是"上下文问题解决没有"的最后一块拼图，诚实高于进度**。
