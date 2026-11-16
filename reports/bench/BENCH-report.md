# P6-D 基准对照实验报告（BENCH-report）

- 任务卡：`tasks/ZCTX/cards/P6D-benchmark.md`（v0.3 波次——"省 token"从宣称变数字）
- 执行：tester（P6-D 执行者），2026-11-16
- 测量环境：隔离 benchmark HOME `C:/Users/ZS/AppData/Local/Temp/zctx-bench-home`（自建自收）
- 原 profile：`C:/Users/ZS/.dsh/profiles/desktop` 全程只读，零改动终验 PASS（见 §9）
- 诚实纪律：所有数字来自真实 CLI 运行的 json-stream 事件流，原始流存档于本目录 `raw/`，逐轮汇总存档于 `summaries/`；跑不出/不可用的项目如实标注。

---

## 1. 结论速览（TL;DR）

1. **测量管线打通**：zDSH-main 真 CLI（0.2.1-alpha.2）headless `--json` 模式逐轮 usage 采集成立；170 个被测轮次全部 exit 0（pilot 10 + A 50 + B 50 + C 50 + C2 10）。
2. **最重要 finding（命门）**：**在 headless 组合中，zctx 四工具根本不在模型的工具列表里**——模型证词（两次独立探针）+ 38 个可见工具全列零 zctx_* + 170 轮零 `zctx_fold` 调用。**模型"不采用 zctx_fold"不是模型行为问题，而是工具注册面在此组合未生效**：模型无工具可调。
3. **系统提示面同样未到达**：模型确认其系统提示中不含任何 zctx/折叠/压力相关内容（guidance/nudge 面未见 wire prompt）。
4. **因此"上下文问题解决没有"在 headless 环境的答案是：没有**。三组 50 轮计费输入随会话增长 12–18 倍（前 10 轮均值 → 后 10 轮均值：A 109k→1,289k、B 52k→645k、C 43k→786k token/轮），单轮峰值 332 万 token（A 组 turn 42）。
5. **A/B/C 三组在计费输入上不可区分**（处理变量未生效，见 §7 方差说明）——本报告不能声称 zcontext 有或没有节省效果；它只能声称：**在 headless 组合里它的折叠路径没有被执行过**。
6. **适用边界（必读）**：本测量仅覆盖 **headless 组合**。用户真实桌面（Electron/web 组合）中 zctx 面是否激活**未测**（超出本轮范围，见 §8）。桌面组合下该 finding 是否复现，是下一个必须回答的问题。

## 2. 环境与组合

| 项 | 值 |
|---|---|
| CLI | `zDSH-main/apps/cli/lib/bin.js`（dsh 0.2.1-alpha.2，headless bundle @deepseek-ai/dsh-headless 0.2.1-alpha.2） |
| 隔离 HOME | `C:/Users/ZS/AppData/Local/Temp/zctx-bench-home`（DSH_HOME 显式指定；DSH_AGENTS_HOME 同样隔离） |
| profile | `profiles/bench`（克隆自 desktop profile：node_modules 22593 文件 robocopy 零失败；patch yml 逐行保留） |
| 装件 | dsh-zcontext 0.2.1（克隆态）→ 覆盖为仓内 0.2.2（`lib/` 与仓内构建产物 SHA-256 全等：`12e909df…`；package.json 0.2.2） |
| 模型 | `workbuddy/hy4flash-free`（magpie 本地网关 127.0.0.1:3425，免费路由，全程固定） |
| 会话方式 | headless 一次一任务；多轮经 `--session-id` 链式续会话（sessionId 由 `session` 事件回报并落 state） |

### 卡面命令路径与偏差（如实记录）

- **卡面点名路由 `opencode-zen-free/deepseek-v4.1-flash-free` 配额耗尽**：首冒烟 429 `FreeUsageLimitError`（"OpenCode Zen Free: Free usage limit reached"，code QUOTA，exit 1）。按卡面"或类似 `-free` 后缀路由"条款改用 desktop profile 自己的默认 `workbuddy/hy4flash-free`（与克隆原默认一致，组合偏差最小），冒烟通过后固定全程。
- **bundles 形态**：desktop 的 `@deepseek-ai/dsh-web-app` 替换为 `@deepseek-ai/dsh-headless`（headless 无浏览器/HTTP 面；这是非交互测量的前提）。其余 21 行 bundles 与 desktop 逐行一致。
- **patch yml 裁剪**（三组恒定，防外部副作用）：移除 magpie-mcp-* 7 个 stdio MCP 行（每轮 spawn 外部进程，且该块内含明文 bearer token，顺带移出 bench 副本）与 web-search-deepseek 行；移除 7 个在 headless 组合中目标不存在的行（ui-*/locale/agent-preset-registry/better-sidebar，消除 not-found 警告）。保留：agent-default-model（钉 free 路由）、llm-pi-ai providers、permission（danger-full-access）、auto-continue、dsh-context。
- **fail-soft 跳过的 bundle（三组恒定、与处理变量无关）**：3 个 experimental bundle 在本安装不可解析；dsh-rewind-plugin、dsh-better-sidebar 与 CLI 0.2.1-alpha.2 peer 版本不兼容被跳过。每次 boot 的 stderr 存档 `harness/stderr-*.txt`。

### 分组实现（`harness/switch-group.mjs`，每组切换后 `--dump-config` 机器校验）

| 组 | zcontext bundles 行 | zcontext config | 声明窗口 | dump 校验 |
|---|---|---|---|---|
| A 裸官方 | 移除 | —（插件不挂载） | 960000 | row=false |
| B 装但关 | 保留 | `enabled: false` | 960000 | row=true, enabledFalse=true |
| C 全默认 | 保留 | 默认（enabled true） | 960000 | row=true, enabledFalse=false |
| C2 仪测臂 | 保留 | 默认 | **40000**（maxTokens 8192） | row=true, capped=true |

C2 是卡面五组之外的补充臂：桌面 profile 给 hy4flash-free 声明 contextWindow 960000，插件触发线=窗口−储备，960k 窗口下 50 轮玩具任务永远到不了触发线；C2 只改插件看到的声明窗口（同一模型），使折叠压力在会话内可达，用于区分"触发不到"与"触发了也不折叠"。

## 3. 测量口径

- **逐轮 usage**：`--json` 事件流 `status.step_end.usage`（`assistant/message` 提交的 TokenUsage；`packages/llm/llm/src/types.ts:175-189` 明文三值不相交：`inputTokens`=未缓存输入，`cacheReadTokens`/`cacheWriteTokens` 单列，**billed input = 三者之和**）。逐轮 billedInput = 该轮（一次 headless 调用）内全部 step_end usage 求和。
- **cache 命中率** = cacheRead / billedInput（本路由全程未报告 cacheWrite——`cacheWrite seen anywhere: false`，故命中率即 cacheRead 占比）。
- **折叠发生率** = `tool_call` 事件 `tool:"zctx_fold"` 计数（json-stream 原始事件，`raw/*.jsonl` 可复核）。
- **每轮 = 一次 headless 调用 = 一条固定 user prompt**；50 轮任务脚本见 `harness/prompts-matrix.json`（前 10 条与 pilot 相同：逐步构建 bench-todo CLI，含文件创建/编辑/运行/总结）。

## 4. Phase 1 pilot（C 组 10 轮，管线验证）

全部 10 轮 exit 0，sessionId 链式一致（`session-b544dd8d…6fcf9e8d`）：

| 轮 | billedInput | steps | 命中率 | fold |
|---|---|---|---|---|
| 1 | 30,852 | 3 | 65% | 0 |
| 2 | 46,908 | 4 | 96% | 0 |
| 3 | 66,877 | 5 | 96% | 0 |
| 4 | 61,740 | 4 | 96% | 0 |
| 5 | 86,611 | 5 | 98% | 0 |
| 6 | 36,184 | 2 | 98% | 0 |
| 7 | 102,963 | 5 | 96% | 0 |
| 8 | 118,305 | 5 | 98% | 0 |
| 9 | 49,397 | 2 | 98% | 0 |
| 10 | 51,139 | 2 | 98% | 0 |

- p50=51,139 / p95=118,305 / 累计 650,976；插件挂载无错（组合树含 `- id: dsh-zcontext`，boot stderr 无 zcontext 报错行）。
- **`zctx_fold` 10 轮 0 次调用**——pilot 阶段即已提出"不采用"疑点，随后用诊断探针定位（§6）。

## 5. Phase 2 矩阵（50 轮 × A/B/C + C2 10 轮）

### 5.1 主表

| 组 | 轮次 ok | 累计 billedInput | p50 | p95 | max | 前10轮均值 | 后10轮均值 | 增长倍数 | 命中率均值 | fold 调用 |
|---|---|---|---|---|---|---|---|---|---|---|
| A 裸官方 | 50/50 | 36,645,904 | 408,918 | 2,952,281 | 3,322,963 | 109,181 | 1,288,955 | 11.8× | 98.2% | **0** |
| B 装但关 | 50/50 | 15,509,064 | 173,114 | 1,151,251 | 1,412,096 | 51,927 | 644,860 | 12.4× | 98.5% | **0** |
| C 全默认 | 50/50 | 20,769,088 | 226,884 | 1,511,996 | 1,894,869 | 42,760 | 786,044 | 18.4× | 98.3% | **0** |
| C2 仪测（窗口 40000） | 10/10 | 509,604 | 47,235 | 84,743 | 84,743 | —（10 轮） | — | — | 96.4% | **0** |

逐轮曲线（turn:billedInput:命中率）全文见 `raw/*.jsonl` 与执行日志 `harness/extension-chain-run.log`。样本峰值：A turn40=3,270,723、turn42=3,322,963；C turn42=1,894,869。

### 5.2 读法（重要）

- **处理效应不可测**：三组 fold 全零（C 组插件面未激活，见 §6），A/B/C 的差异由**模型每轮步数方差**主导（总步数 A=371、B=240、C=235；单轮步数 2–23 波动），不由 zcontext 在场与否解释。任何"A 比 C 省/费 X%"的表述都是把行为方差读成处理效应——本报告不做此类声称。
- **C2 的答案**：即便把插件看到的声明窗口压到 40000（触发线≈30k，会话第 2 轮即越过），折叠依然是 0——不是因为"触发不到"，而是因为**工具不在模型列表里**（§6）。
- **cache 读便宜≠不计费**：命中率 98% 意味着绝大部分输入以 cache-read 计（本路由 cache-read 价格远低于 fresh input），但上下文体量本身仍在每轮全量重发并计费；billedInput（含 cacheRead）口径下增长曲线是真实的。若按"经济成本"口径（cache-read 折价），增长曲线的斜率会显著平缓——两种口径本报告都未混用，卡面口径（三值之和）为准。

## 6. 最重要 finding：zctx 面在 headless 组合中未生效（三重证据）

1. **工具列表探针**（fresh 会话，C2 配置）：要求"逐行列出你当前可用的全部工具名称"，模型列出 38 个工具（pwsh/write/edit/read/grep/glob/subagent/web_*/dshm_*/workflow/…），**无任何 zctx_***。模型原话（另一次探针）："我的可用工具列表中并没有名为 `zctx_status` 的工具"。
2. **系统提示探针**（fresh 会话，C2 配置）：模型核对系统提示后明确回答"系统提示中无相关内容"——zctx/zcontext/上下文折叠/压力/pressure 均未出现。即 guidance 面与（推断）nudge 面都未到达 wire prompt。
3. **行为证据**：170 个被测轮次（含 C2 超窗口状态）零 `zctx_fold` 调用、零任何 zctx 相关行为痕迹（raw 流中全部 "zctx" 命中均为临时目录路径名）。

**静态源码定位（未运行时定谳，登记遗留）**：`src/plugin.ts` 构造函数内即接线各 face；`wireToolFace()` 在 `ctx.tools?.register` 非函数时跳过、register 抛错时降级（P3 HF-15 多个拒绝路径），两种降级都走 `ctx.logger?.warn` —— 而本组合中该 warn 无 stderr 输出、无 DSH_HOME/logs 目录，**被吞**。因此无法从日志区分是"tools 服务缺席跳过"还是"register 拒绝四工具"。同批 mount 的其他插件工具（web_backend_status/workflow/dshm_* 等）在模型列表中可见，说明插件工具在该组合**可以**注册成功——zcontext 的失败是它自己的 face 降级路径。

**定谳所需**（超出本基准卡范围）：给插件 face 降级路径接一个可见 sink（或用 SDK 短脚本在该组合下直调 `ctx.tools.register` 复现拒绝原因）。已登记 §8。

## 7. 方差与统计边界

- 单模型（workbuddy/hy4flash-free）、单任务脚本、每会话 N=50（C2=10）、每组 1 条会话：**无重复会话**，组间比较不具统计显著性，只呈现描述统计。
- 免费路由质量波动：无中途 429/断流（170/170 exit 0），但 opencode-zen-free 同类路由已观察到配额终点，workbuddy 路由不保证永久可用。
- 模型步数方差（2–23 步/轮）使"每轮 billedInput"分布右尾极长（p95 与 max 差 1 个数量级）；p50/p95 应理解为"该单会话的分布"，不是模型-任务普适常数。

## 8. 遗留登记（合法 disposition，非 backlog 收口）

| id | 内容 | disposition | 说明 |
|---|---|---|---|
| BENCH-L1 | headless 组合中 zctx faces 未生效的**运行时根因**（tools 注册路径二选一定谳 + guidance/nudge 面 wire 验证） | **fixed/verified（P6-D2，2026-11-16）** | 定谳=bench patch yml 双份 `enabled: false`（B 组切组残留）+ switch-group.mjs 双校验缺陷；两种静态怀疑（服务缺席/register 拒绝）均排除。修复判据实证：4/4 工具注册+模型证词+模型真实调用 zctx_status+guidance 逐字引用+nudge 615 chars 实入 wire（§11.2/§11.3）。 |
| BENCH-L2 | 桌面 Electron/web 组合中 zctx 面激活状态未测（用户真实使用环境） | user_approved_deferred | web 组合需 boot HTTP 面，超出 headless 基准卡范围。P6-D2 补充事实：desktop 原 profile 无 zcontext 覆盖块（默认启用），本定谳的根因（基准克隆层残留）不适用于 desktop；激活探针同法可覆盖。 |
| BENCH-L3 | 矩阵 D（preflight enforce）与 E（zctx 路由）组 | not_applicable（本轮） | 卡面明示"本轮可后置"。P6-D2 后 faces 已实证激活，D/E 的被测机制（S1/S2）在 headless 已有意义，可重估为后续基准卡。 |
| BENCH-L4 | cache-write 字段全程缺失（该路由 provider 不上报） | not_applicable | 命中率口径退化为 cacheRead/billed，已如实标注；换路由后可恢复三值口径。 |
| BENCH-L5 | **采用面**：修复接线后模型仍 0 自发 fold（20 轮压力臂，nudge 文本在场；§11.3） | user_approved_deferred（文本面/模型面，超出本卡接线范围） | owner: 插件域主线。触发条件：下一插件域波次开工；杠杆=nudge/guidance 措辞强度对照实验 + 更强模型对照。 |

## 9. 环境完整性证据

- **原 profile 零改动终验 PASS**：`package.json`/`cordis.patch.yml`/`cordis.yml`/`pnpm-workspace.yaml` 四文件 SHA-256 开工基线 vs 收工复验全 OK（`harness/original-profile-baseline.sha256`）。
- 克隆升级证据：0.2.1 装件哈希存档 `harness/zctx-0.2.1-preupgrade.sha256`；升级后 `lib/` 与仓内构建产物聚合哈希全等（`12e909dfcf73903b…`）。
- 隔离 HOME 自建自收：所有 boot 写入（profiles/bench 组合件、sessions、state、raw）都在 `zctx-bench-home` 内；`~/.agents` 经 DSH_AGENTS_HOME 重定向隔离。
- 诊断探针（probe1/2/3）与两次冒烟的 stderr 存档于 `harness/stderr-*.txt`；probe 的 json-stream stdout 未单独存档（当时仅取文本证据），会话日志在隔离 HOME `sessions/` 内可回查——已如实标注，不计入测量矩阵。
- 复跑入口：`node harness/run-bench.mjs --group C --session-key <key> --turns 50 --prompts prompts-matrix.json`（需 DSH_HOME 指向本 HOME）；统计：`node harness/stats.mjs --all`。

## 10. 直接回答用户原始诉求

> "多跑几轮 tokens 消耗太快"到底被解决了没有？

**在本次实测的 headless 环境里：没有。** 50 轮会话的每轮计费输入从 ~5-11 万 token 涨到 ~64-129 万 token（12-18 倍），没有任何折叠发生。且根因比"模型不主动折叠"更底层：**在该组合里模型根本没有 zctx 工具可调**（工具面/guidance 面/nudge 面均未到达 agent）。zcontext 0.2.2 的折叠引擎、preflight、观测面在纯插件层测试中是绿的（本战役此前 541/541 电池），但它们与真实 agent 会话之间的**接线面在 headless 组合上断裂**——这正是下一次要修的地方。桌面组合（用户真实环境）未测，不能外推。

> **P6-D2 定谳后更正（2026-11-16，见 §11）**：§10 的"接线面断裂"判断需要修正——接线面从未断裂，是本基准 profile 的 patch 层把插件**显式禁用**了（`enabled: false`，B 组开关残留）。修复禁用后，工具面/guidance 面/nudge 面全部实测到达 agent 且机制工作正常；"零折叠"在新数据下的答案变为：**接线已通，模型（hy4flash-free）不自发采用**（20 轮压力臂 0 次自发 fold，nudge 文本在场）。§10 其余数字与口径不变。

## 11. P6-D2 定谳与复测（2026-11-16 补段 · BENCH-L1 关闭）

任务卡：`tasks/ZCTX/cards/P6D2-face-diagnosis.md`。方法：插件加 env 门控诊断（`ZCTX_DEBUG=1` → `src/debug.ts` stderr 直写，绕过 ctx.logger 无 sink 问题，默认零输出），重建 lib 覆盖装件（SHA-256 全等核验），headless 最小任务读诊断定谳；修复后跑修复判据探针 + 10 轮复测（C 与 C2 各一轮）。

### 11.1 运行时定谳（一手 stderr 证据）

诊断输出（`harness/stderr-diag1-disabled.txt`）逐行给出：

1. **插件挂载正常**：真 cordis Service 基类（装件拓扑下 `@deepseek-ai/cordis` 可达——装件 peer 链与 P0 探针受控环境无差异）。
2. **ctx 表面全绿**：`on`/`tools.register`/`systemPrompt.section`/`systemPrompt.context`/`commands.register`/`llm.registerAdapter`/`tokenMeter` 全部在位——§6 静态定位的两种怀疑（"tools 服务缺席跳过"/"register 拒绝被吞"）**均未发生**。
3. **决定性一行**：`constructor: disabled by config — all faces stay unwired`——插件被配置显式禁用，全部 face 未接线。

根因（机械证实）：bench profile `cordis.patch.yml` 头部存在**两份** `- id: dsh-zcontext / config: enabled: false` 块——B 组切组脚本的开关残留。两个 harness 缺陷叠加使它漏网：

- **移除正则永不生效**：`switch-group.mjs` 用 sticky 正则从位置 0 匹配 zcontext 块，而文件以注释行开头 → 移除永远静默 no-op（node 实测 `NO MATCH`），B 组插入的块在切回 C/C2 时残留（B 被切换两次 → 两份块）。
- **dump 校验对真实形态失明**：dump-config 实际渲染 `- id:` / `  name:` / `  config:` / `    enabled: false`（`harness/dumpconfig-before-fix.txt` 751-756 行），而校验正则要求 `- id:` 后紧跟 `  config:` → `enabledFalse` 恒 false → C/C2 假绿（日志两行 `group=C verified`）；B 组期望 true 永不通过 → 全日志无 B 验证行（佐证 B 校验曾失败后被绕过）。

**影响面更正**：A/B/C 三组不可区分（§5.2）的真实原因是 C 组实为"装但关"（与 B 同态）；C2 的"触发线可达但零折叠"同样是 disabled 态产物。desktop 原 profile 无 zcontext 覆盖块（grep 零命中）——用户真实环境不受此残留影响。

### 11.2 修复与 wire 实证（修复判据全达）

修复：移除两份 `enabled: false` 块（§5 先备份）；修复 live switch-group.mjs 两正则（全局多行移除 + dump 形态容忍），机械回归三态（旧 dump 判 true/B 态移除成功/净文件 no-op）。修复后（`stderr-diag2-enabled.txt`）：

- **4/4 工具注册成功**（官方 `defineTool` 路径：`'@deepseek-ai/dsh-tools' import OK; defineTool resolved`）。
- **工具可见**（fresh 会话模型证词，`toolprobe-p6d2-stdout.txt`）："The zctx_ tools are: 1. zctx_fold 2. zctx_recall 3. zctx_status 4. zctx_unfold. That's 4 tools."
- **工具可调用**（`callprobe-p6d2-stdout.txt`）：模型按指示真实调用 `zctx_status`（tool_call → tool_result completed，输出 "window: ~10731 tokens (26.8% of 40000)"）。
- **guidance 面到达系统提示**（`sysprompt-probe-p6d2-stdout.txt`）：模型逐字引用首句 "Older parts of this conversation can be folded to keep the working window small."——BENCH-L1 的"guidance/nudge 面 wire 验证"半边就此关闭。

### 11.3 复测：采用率第一手数据（20 轮压力臂）

| 运行 | 窗口 | 轮次 ok | nudge 贡献 | 自发 zctx 调用 | 自发 fold |
|---|---|---|---|---|---|
| C 复测（session `p6d2-retest-C`） | 960000 | 10/10 | 无（压力未达 25% 触发线，预期） | 0 | **0** |
| C2 复测（session `p6d2-retest-C2`） | 40000 | 10/10 | 未插桩（不可回放） | 0 | **0** |
| C2b 插桩复测（session `p6d2-retest-C2b`） | 40000 | 10/10 | **有**：25%/50% 跨越点各 615 chars 实入 wire（`stderr-diag3-c2b-turn9-nudge-fired.txt`） | 0 | **0** |

C2b 插桩逐 assembly 记录（`raw-stderr/`）：窗口解析成功（40000）、压力真实爬升（26.0% → 52.6%）、`nudgeContextText` 在 25% 与 50% 跨越点各产出 615 字符且 `required: true` 面注入系统提示。**即：工具在 wire、guidance 在 wire、nudge 文本在 wire、压力真实越过两条阈值线——模型（hy4flash-free）在 20 轮压力会话中仍 0 次自发调用 zctx_fold（亦无任何 zctx_* 自发调用）。**

口径注记：headless 一次一任务 = 每轮新进程，`lastPressure` 为进程内存 → 每轮首个 assembly 以 prev=0 重评，已越线状态每轮重发一次 nudge（跨进程语义的已知形态，非本轮缺陷）。明确未定谳的残余：nudge 文本**内容**是否对该模型可理解/可操作（615 字符文本的措辞有效性）未测——那是文本面/模型面问题，超出本卡（接线面）范围。

### 11.4 最终答案（headless 组合）

1. **接线面：已解决**。P6-D 发现的"面未生效"根因是基准环境配置禁用 + harness 双校验缺陷，不是插件降级路径或宿主 face 缺失；修复后五面全部实证到达 agent 且机制工作（注册/可见/可调用/guidance 引用/nudge 出文本）。
2. **采用面：未解决（如实报告）**。修好接线后模型依然 0 自发 fold（20 轮压力臂 + 10 轮正常臂）。"上下文问题解决没有"在 headless 的当前答案 = **接线通了、模型不接**——自发折叠依赖模型在 nudge 在场时主动调用 `zctx_fold`，该 free-flash 路由模型没有这个行为。下一步杠杆在文本面（nudge/guidance 措辞→指令强度）与模型面（更强模型对照），不是插件接线面。
3. 原 §5.1 主表 A/B/C 数字保持有效（作为"该 disabled 态"下的测量记录）；其组间不可区分性由 §11.1 解释。

## 12. P6-E pilot：autoFold 服务端自主折叠（2026-11-16 · BENCH-L5 的机制解药）

> 任务卡 tasks/ZCTX/cards/P6E-autofold.md。前置事实：§11.3 实证 nudge 在场 20 轮 0 自发 fold（采用面）→ 本波把「等模型自觉」换成「服务端自己折」。装件 lib 升级到 P6-E 构建（SHA-256 仓内/装件全等 cca6d84a…），组态经 `arm-autofold.mjs` arm（zctx config 块 `enabled:true` + `"autofold.enabled": true` + summarizer=compaction + 模型声明窗压到 40000，C2 同型仪测臂；dump-config 结构化校验通过）。

### 12.1 结果：服务端自发折叠真实发生（0 模型工具调用依赖）

| 项 | 值 | 证据 |
|---|---|---|
| 服务端自发 fold | **1 次真实提交**：foldId `f297`，checkpoint seq 297，surface replace [9..202]（50 surface 节点被吸收），tokensBefore **5471** → tokensAfter **864**（净省 ~4607 tokens，−84%） | `raw/p6e-autofold-fold-f297-evidence.json`；session log seq 297 `user/message` + `source.kind:'zctx-fold'`（`raw/p6e-autofold-session-e98c4f6f.jsonl`） |
| 模型工具调用依赖 | **0**——全会话（20 轮）无任何 `zctx_*` tool/call 事件 | 同上 session log `tool/call` 全量扫描 |
| 摘要供给 | **compaction 供给**（官方 purpose:'compaction' 一次性 ctx.llm.stream，父请求路由 magpie/hy4flash-free）：摘要文本非 digest 形态（无 deterministic-digest 头），经 validator 长度窗 [50,20000] + 净缩门 1.05（5744 > 864 ✓） | seq 297 摘要文本头 + 机制代码路径 |
| 触发判据 | V4 判据第三态复用：turn 11 起 HIT（estimate 28859 > hit line 26421 = triggerLine 29356 × margin 0.9），此后每轮 HIT（estimates 28859→48002） | `summary-p6e-autofold.jsonl` stderrTail `[zctx-debug] autoFold judge: … → HIT`（turns 11-20 全部） |
| 提交链路因果复现 | 离线重放：折叠前精确表面（80 节点 12769 tokens）上 selectFoldSpans 返回**唯一候选 [9..202] 5471 tokens——与运行时提交的 span/tokens 逐字一致** | 本波 offline 复现脚本输出（progress.md P6-E 段） |
| 防反馈环 | 摘要调用 purpose 豁免（不在任何监听判定/不入 session log）；fold 提交后 nudge 基线清零 hook 在位 | autofold.ts + plugin.ts onFoldCommitted（单测 37 钉） |

### 12.2 时间线（session e98c4f6f，20 轮 = 10 轮 pilot 脚本 + 10 轮 matrix 续臂）

| 轮次 | 压力/估算 | autoFold 行为 | 说明 |
|---|---|---|---|
| 1-10（pilot 脚本） | meter 25.4%→52.0%；估算未过 hit line | 未触发（正确） | 10 轮脚本压力不足——**trigger 不误发**（保守侧正确性的第一手证据） |
| 11-13（matrix 续臂） | 估算 28859-36356，HIT | 链启动，`no-qualified-span`（0 calls） | 可选中段 < minFoldableTokens 5000（保护地板+系统头吃掉大半）——诚实不硬折 |
| **14** | 估算 29912/30395，HIT | **f297 提交**（[9..202]，5471→864） | 可选中段跨过 minFoldable 门槛 → 选区→供给→验证→提交全链走通；轮内后续请求判后折表面 no-qualified-span |
| 15-19 | 估算 30.8K-47.5K，HIT | `no-qualified-span` | **折后可达域塌缩**（W3-2 不变量：跨 checkpoint 数字非单调 hull 不可达；[checkpoint,checkpoint] 吸收窗 864 tokens < 5000 门槛）——如实呈现的覆盖边界 |
| 20 | 估算 48002 ≫ 40000 | 插件 fail-open pass-through（bc F1.20 同型） | **官方 compaction 链接管溢出且其摘要截断失败**（compaction/end error "summarization truncated at the token cap"）→ 该轮 exit 1。插件行为正确（fail-open），官方链自身失败与本插件无关 |

### 12.3 诚实边界与残留

1. **nudge 采用面结论不变**：本波 20 轮中 nudge 文本仍在场（turn 3 起每轮 614-709 chars，含 turn 13 的 75.9% emergency 文本），模型 0 自发 zctx_* 调用——§11.3 的 BENCH-L5（文本面/模型面）维持原判；本波证明的是**机制路线（第三态）不依赖该行为**。
2. **折后覆盖边界（新发现，BENCH-L6 候选）**：单次 fold 后，surface 的数字非单调性使后续 hull 全部落在 validator check-a 可达域之外——插件每个「单调纪元」只能折一次；多次折叠需要按 checkpoint 边界对齐的吸收窗（≥ minFoldableTokens 才可用）。这是 W3-2 既有不变量的运行时显形，不是本波缺陷；下一杠杆=吸收窗资格（[checkpoint,checkpoint] ≥ 门槛时的再折）与 bc #726 式的跨 checkpoint 区间选择。
3. **官方 compaction 摘要截断**（turn 20）：宿主自链在同场景失败（其摘要调用在 token cap 截断）——插件折既成功过、宿主链失败，两链质量对比的第一手数据点。
4. 组态残留=零（disarm 幂等循环 2×2 验证：patch yml 0 zctx 行 + 0 窗口 cap；装件 lib 保持 P6-E 构建与仓内全等）。臂内每轮 exit=0（除 turn 20 官方链失败），billedInput 逐轮在 summaries 存档。
