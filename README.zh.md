# dsh-zcontext

[English](README.md) | [中文](README.zh.md)

[![CI](https://github.com/zsagi1368/dsh-zcontext/actions/workflows/ci.yml/badge.svg)](https://github.com/zsagi1368/dsh-zcontext/actions/workflows/ci.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![version: 0.3.0 beta](https://img.shields.io/badge/version-0.3.0-orange.svg)](CHANGELOG.md)
[![status: BETA 测试中](https://img.shields.io/badge/status-BETA_测试中-orange.svg)](#limitations)

> ⚠️ **测试版（BETA）——仍在测试中。** 本插件为测试发布：机制较新、估算阈值未经真机标定、真机验证仍在进行。可能有粗糙之处；官方 compaction 始终是硬底兜底。欢迎真实会话的反馈与 `zctx_status` 输出。

[DeepSeek Harness](https://github.com/deepseek-ai) 的模型驱动增量上下文折叠插件——把对话里已经收尾的段落折叠成模型自己撰写的短摘要，让超长会话的工作窗口始终保持在低位。全部折叠都走官方 surface replace 通道，不改底座、不改请求、不改线缆。

- **这是什么**——官方 DeepSeek Harness 的第三方插件包（`dsh-zcontext`）：四个工具（`zctx_fold` / `zctx_unfold` / `zctx_recall` / `zctx_status`）、一段静态指导、一条压力提醒（nudge）、一个 `/zctx` 命令、一本装上即记的观测账本、一道可开启的 preflight 预检门、一个接入自有供应商的 zctx 路由（opt-in），以及一个 opt-in 的**服务端自主折叠（autoFold）**面——不再等模型自己动手。全部经同一张设置页呈现（九个原始字段加下方 v0.2.0/v0.3.0 各段）。不强制 patch 宿主，不 fork；插件唯一面向线缆的面是显式声明的 S2 路由，且它绝不改写请求体。另有严格可选的外部补丁器（`patcher/`，由用户执行），仅服务于 guard-observe wire 域。
- **为什么做它**——官方自带的 compaction-basic 只做「窗口压力触发时的全量摘要」，没有模型驱动的增量折叠。[billion-context](https://github.com/ranxianglei/billion-context) 研究证明了这套机制的可行性（模型自己写摘要、自己选区间、缓存感知的 nudge，长会话窗口占用保持低位）。本插件把这套能力装进官方插件面——同样的机制，走宿主自己的正道。

  <a id="clean-room"></a>
- **净室声明**——本仓零复制 billion-context 或任何上游的代码与提示词原文。所有代码与所有模型可见文本均为原创撰写，指导段是我们的措辞。详见[致谢](#acknowledgments)。

## 目录

- [工作原理](#how-it-works)
- [安装](#install)
- [四个工具](#the-four-tools)
- [/zctx 命令](#the-zctx-command)
- [与官方 compaction 的关系](#relation-to-official-compaction)
- [观测账本（装上即开始记）](#observability-ledger)
- [Preflight 预检（S1）：上线缆之前先判窗口](#preflight-s1)
- [zctx 路由（S2）：接入自有供应商，且诚实](#zctx-router)
- [autoFold：服务端自主折叠（opt-in，v0.3.0）](#autofold)
- [可选的 base-context 补丁器（外部工具，用户执行，v0.2）](#the-optional-patcher)
- [设置项](#settings)
- [行为说明](#behavior-notes)
- [限制](#limitations)
- [安全](#security)
- [致谢](#acknowledgments)
- [开发](#development)

<a id="how-it-works"></a>
## 工作原理

折叠把会话表面上一段较早的对话替换成一个短摘要 checkpoint。整条链路只使用官方 surface replace 通道——就是 `compaction-basic` 用的那同一原语，其类型注释明文允许「任何替换表面的生产者」使用：

1. **指导段**——一段静态、逐字节稳定的 system prompt 段落，教会模型何时折叠、摘要必须保留什么丢弃什么、以及批次纪律。它从不设置 `complete: true`、不含任何动态内容，因此只进一次缓存前缀并长期驻留。
2. **Nudge**——占用率跨越窗口的 25/50/75/90%（可配置）时触发的运行时上下文。只在跨越发生时贡献文本；两次跨越之间对线缆零贡献（跨越计次的缓存重付，不是免费）。
3. **折叠**——模型调用 `zctx_fold` 提交区间与摘要。保守验证器把关：保护区（最近尾部）、第一条 user 消息永久钉死、system head 不碰、tool 调用与结果必须同窗折叠、净缩门、原子批次（任一区间非法则整批拒收）、与活跃 compaction 互斥。
4. **台账**——每次折叠提交一个 checkpoint 事件，其 `message.source` 带 `kind: 'zctx-fold'`（或 `'zctx-unfold'`）。**零独立存储**：折叠台账靠扫描会话日志重建，恢复会话、分叉会话都天然成立，原始事件永久留在日志里。
5. **Status**——`zctx_status` 是唯一可信台账：窗口占用对触发线、预算分解（CCM v2.3 公式）、可折叠区间图（PROTECTED 标注）、活跃折叠、异常记录、缓存用量（实测或估算，如实标注）。v0.2.0 起它按三段渲染观测账本（会话摘要、纯净样本门后的回本表、带归因质量的近期折叠 + 重置台账摘要）。

缓存经济学是记账出来的，不是口号：四个工具 schema 加指导段是固定线缆开销；每次折叠或 nudge 跨越都要从缓存锚点起重付一次前缀重建。`zctx_status` 展示实测（供应商上报的 cache read/write）与估算两种口径的分账。

<a id="install"></a>
## 安装

```sh
dsh plugin add github:zsagi1368/dsh-zcontext
```

环境要求：支持插件的 DeepSeek Harness，Node.js >= 22.13。构建产物随仓库发布（`lib/` 已入库），git 形态安装不触发任何构建步骤，也不会向 pnpm 请求构建审批（`allowBuilds`）。唯一 peer 依赖是 `@deepseek-ai/cordis`（optional，由宿主提供）。装好后设置页会出现本插件的专属段（static `Config` schema，字段见下），会话里可用 `/zctx`。观测账本装上即开始记录；折叠无需任何额外配置。

<a id="install-desktop"></a>
### 在 Windows 桌面版安装

官方 Electron 桌面应用持有保留的 `desktop` profile，插件事务由其内置 pnpm 执行（官方架构文档原文："Desktop's bundled CLI manages its initialized plugins"）。两条安装路径：

1. **应用内（推荐）**——打开桌面应用的插件管理界面（插件市场 / 设置 → 插件），选择*从 GitHub 添加*，填入 `zsagi1368/dsh-zcontext`。应用提示时重启。
2. **CLI 对桌面 profile**——从任何共享同一 Harness home 的 dsh CLI：

   ```sh
   dsh plugin --profile desktop add github:zsagi1368/dsh-zcontext
   ```

   然后重启桌面应用。

验证：设置页出现 **dsh-zcontext** 段（字段见[设置](#install)），会话里 `/zctx` 有应答。**桌面版诚实说明：**桌面组合下的 face 激活已完成探针设计但尚未真机验证（BENCH-L2 登记）——若桌面会话中工具或 status 段未出现，请带 `zctx_status` 输出提 issue；headless 组合已全量验证（见[开发](#development)）。

升级：在桌面 profile 内重复同款 add 或 `pnpm update dsh-zcontext` 后重启应用（桌面 profile 独立维护自己的 packages 与 lockfile，与任何 npm CLI 安装互不共享）。

<a id="the-four-tools"></a>
## 四个工具

四个工具全部经官方 `defineTool` 授权契约注册、使用官方强制 schema 子集、返回模型可见字符串。所有失败都是 fail-soft 的字符串结果——没有任何异常会越过宿主边界抛出。

### `zctx_fold`

一个必填字符串承载全部区间与摘要——每个块一行 `fold <startSeq>..<endSeq> [topic]` 头行，后接该块的 markdown 摘要。批次原子提交，或整体拒收并给理由：

```json
{
  "content": "fold 3..7 [file inventory]\nThe user asked for a file inventory; three files were listed (a.sql, b.ts, c.md) and a.sql identified as the largest. Inventory is complete.\nfold 12..15 [schema of a.sql]\nSchema of a.sql: two tables and one view; the view aggregates daily totals."
}
```

也接受 `{ startRef, endRef, summary }` 对象的 JSON 数组（网关把数组字符串化的形态），以及单个顶层区间对象。先从 `zctx_status` 拿精确区间和压力，再提交。

### `zctx_unfold`

把一个已折叠区间重新物化回表面、顶替它的 checkpoint。不带参数时展开最近一次活跃折叠：

```json
{ "foldId": "f0000007" }
```

### `zctx_recall`

在所有已折叠内容里检索——摘要与折叠走的原文都搜（原文永久留在会话日志里）。返回带摘录与所属 foldId 的排序命中，折叠走的历史不用展开也能到达：

```json
{ "query": "schema a.sql view", "limit": 5 }
```

### `zctx_status`

无参数。压力、预算、区间、折叠、异常、缓存用量的唯一可信台账——指导段明确要求模型不得凭记忆重建这些数字：

```json
{}
```

<a id="the-zctx-command"></a>
## /zctx 命令

同一台引擎，从聊天输入框驱动：

```text
/zctx                     status（默认）
/zctx status              压力、预算、区间、折叠、缓存用量
/zctx fold <content>      提交折叠块（与工具相同的 content 格式）
/zctx unfold [foldId]     重新物化（缺省展开最近活跃折叠）
```

<a id="relation-to-official-compaction"></a>
## 与官方 compaction 的关系

**共存，绝不拦截。** 本插件从不停用、阻塞或延后官方 `compaction-basic`。它是无条件的硬底：就算模型一次都不折叠（用不用工具是模型的选择），窗口压力到点时 compaction 仍会照上游原设计做全量摘要。官方 compaction 活跃期间，并发的折叠提交会被干净地拒收、稍后重试。设计上的分工是：更早、更小的主动折叠把窗口压低，让硬底尽量少触发。

<a id="observability-ledger"></a>
## 观测账本（装上即开始记）

账本在插件装上的那一刻就开始记录——不需要任何 opt-in（`observe.enabled: true` 默认开启；通过 `zctx_status` 查看）。一条严格只读的 `llm/stream` 监听器旁听每一次尝试，把以下内容记进进程内存：

- **带归一化前缀哈希的请求快照**——线缆实际所见内容的逐次尝试视图，每行标注投影器来源（宿主在位时用官方投影导出，缺席时用如实标注的本地兜底）。
- **重置事件台账**——模型变更、采样变更、工具集变更、system 段变更、compaction、会话恢复、series 重启、合并改写：每一件「上下文在我们脚下变了」的事件，都是一次缓存重付的解释。
- **三态用量记账**——`measured`（供应商上报）、`semi`（诚实升格：同轮锚点插值或仪表锚定）、`estimated`（绝不猜数；缺席的字段保持缺席）。
- **折叠→用量归因**——seq 序主键 + 时间窗兜底，strong/retry/weak 三级质量，八项成文噪声处置（折叠后多步、重试、中断、一次性调用等）。

`zctx_status` 按三段渲染整本账：会话摘要、回本表（纯净样本门后——纯净占比跌破 `cleanSampleFloor` 时，status 明说「归因可信度不足」而不是硬给数字）、带归因质量的近期折叠加重置台账摘要。

双域诚实：harness 域行覆盖每一个被监视会话；wire 域字节哈希只存在于 zctx 路由实际驱动的会话（见下）。

<a id="preflight-s1"></a>
## Preflight 预检（S1）：上线缆之前先判窗口

`preflightMode: 'off' | 'observe' | 'enforce'`——**默认 `'observe'`**。

- **observe（默认）**——第二条只读监听器在线缆之前估算每个请求的上下文（宿主在位时用官方投影导出，缺席时用如实标注的兜底孪生；保留的图片按 adapter 的 `imageRequestPricing` 定价或用声明的常数储备），并把「估算 vs 真实用量」记入校准台账，由 `zctx_status` 渲染误差统计。此模式下绝不短路。
- **enforce（显式 opt-in）**——命中（估算 > 触发线 × `preflightMarginRatio`）时以恰好一个终态 `finish{kind:'error', failure:{code:'CONTEXT_WINDOW_EXCEEDED'}}` chunk 短路本次流——官方认可的短路形态——省下这单注定失败的线缆请求；其后的全部救援由官方 compaction 溢出恢复链接管。一次性请求（compaction、会话标题）永不参与判罚，恢复链自己的调用不可能被自己短路。两条与宿主的交互事实（P3）：一次短路消耗 compaction 恢复链 `maxOverflowRetries` 预算中的一次（误报同样要花恢复预算）；若把 `CONTEXT_WINDOW_EXCEEDED` 加进官方 `retryableCodes`，llm-retry 会在每次短路后重发同一超限请求（有界，但浪费）——zctx 会话上请勿把该码放进 `retryableCodes`。
- **off**——该监听器不注册。

enforce 在三个迁移条件全部成立之前保持 opt-in：估算器误差分布经真机标定、误报代价（每次误判多付一次 compaction 表面改写）被有意识地接受、observe 期记录的命中与真实供应商溢出对得上账。在那之前，估算器阈值是声明的标定欠账（见[限制](#limitations)）。

<a id="zctx-router"></a>
## zctx 路由（S2）：接入自有供应商，且诚实

v0.2.0 唯一触碰线缆的地方——作为显式声明的例外，不是接管：一个薄 adapter，让 harness 经官方可配置供应商面驱动**你自己的** OpenAI/Anthropic 兼容端点。官方路由永不被替换，adapter **绝不改写请求体**（零改写红线有测试钉死）。

- **family 就是协议名。** 每个声明的供应商成为路由 `zctx-<family>`，其中 `family` 直接取官方 `supportedProtocols()` union 的线缆协议名（`openai-completions` | `openai-responses` | `anthropic-messages`，从宿主动态加载，带如实标注的内置兜底）。零发明映射；未知 family 在构造期被拒收并附完整违规清单。
- **配置形态。** 结构化 `providers[]` 设置段是配置权威，经 profile overlay patch 手写。Models 页会挂载本插件命名空间、显示每条路由的行、凭据徽标与错误字段——但第三方命名空间**没有页面编辑能力**（探针实测；诚实天花板）：页面仅可见。
- **无热重载。** adapter 的注册挂在宿主 llm 服务自己的 fiber 上（不是插件的），因此插件卸载**不会**注销该路由：HMR/重载后，新实例会撞上 `DUPLICATE_ADAPTER` 并打一行 warn，而旧实例的 adapter 仍以它（已过期的）providers 继续服务该路由——provider/配置的变更在宿主重启后才生效（P3 HF-03；`registration.replace` 原子换路由是中期路径，不是 v0.2.x 的行为）。
- **每个模型声明自己的容量。** `contextWindow` 与 `maxTokens` 是每个模型的必填正整数——缺值即构造期违规，绝不发明默认值（官方 catalog 语义）。
- **缓存旋钮。** `cacheRetention`（`'none' | 'short' | 'long'`）直通 pi-ai 自身的优先级（显式值 > 环境变量 > 默认 `'short'`；`'none'` 关闭缓存标记）；`cacheControlFormat: 'anthropic'` 物化 cache-control 标记——仅在 `openai-completions` 族有意义，其他族构造成拒收（死配置不诚实携带）。
- **红线全守。** `maxRetries: 0`（重试归 agent 恢复层独占）、归因头随每一次请求上行（含一次性调用）、仅 HTTP(SSE) 协议（无 WebSocket 传输）、纯文本——zctx 路由的线缆上不承载任何 image/file 内容。P3 诚实注记：官方运行时在派发 adapter **之前**就把图片投影为占位文本（adapter 声明 `inputModalities: ['text']`），因此经 zctx 路由的图片请求会正常完成——模型只看到占位文本，且没有任何失败信号。adapter 自己的 `UNSUPPORTED_CONTENT` 门是直呼 adapter 路径上的防御镜像；wire 账本的每一行都携带 `imageCount` 字段（官方路径上恒为 0），把到达 adapter 边界的内容钉进账本。
- **wire 账本覆盖。** 只有路由实际驱动的会话才有 wire 域字节哈希行；其余会话保持 harness 域，每行携带自己的 `domain` 标注（外加 `imageCount`——P3 HF-01 的可观测字段）。

<a id="autofold"></a>
## autoFold：服务端自主折叠（opt-in，v0.3.0）

模型驱动折叠有一个诚实的依赖：模型必须自己选择调用 `zctx_fold`。headless 基准实测：免费 flash 路由的模型在工具在线、指导在线、nudge 文本在线的条件下，20 轮压力会话中自发折叠调用仍是 **0 次**（`reports/bench/BENCH-report.md` §11.3——采用面）。v0.3.0 交付了不依赖该行为的机制路线：**插件在服务端自己折**，全程零模型工具调用。

`autofold.enabled`（默认 **false**，显式 opt-in）武装第三条 `llm/stream` waterfall 监听——最内层面，位于 preflight 与 observe 之后：

1. **触发**——V4 判据是**复用**不是重写：preflight 监听的投影与估算（`projectAndEstimateRequest`）喂给同一条触发线不等式、同一个 margin。命中启动折叠链；未命中则请求原样直通。
2. **选区**——来自 validator 自身可达域的保守区间集（node 0、首条 user、最新 user 受保护；tool 调用与其结果成组折叠；pair-safe 边界；`maxFoldFraction` 上限；`minFoldableTokens` 地板），最老优先、批宽封顶。过不了 validator 自身门的选区诚实跳过——绝不硬折。
3. **摘要供给**——三选一，配置指定，绝不静默换道：
   - `compaction`（默认）——官方一次性 `ctx.llm.stream({ purpose: 'compaction' })` 通道，与官方 summarizer 同形态（purpose 标记使其对三条监听全部不可见、永不重入折叠链，也不进会话日志）；
   - `external`——向自有端点发一次有界 POST（Bearer 经 `autofold.external.apiKeyEnv` 间接引用；配了环境变量名但变量缺失时 wire 时响亮 warn，面保持 armed——缺凭据是退化链条件，不是 skip 理由）；
   - `digest`——确定性的 CPU-only 兜底摘要（零模型调用）。
4. **退化链**——瞬时空回答有界重试；不可再分的失败在 pair-safe 中点对半折到地板；digest 是终端兜底；死供给 sticky 化、每 run 一次金丝雀探测；每次拒收都是一条日志 fault，任何情况下都不破坏请求（fail-open：链后原始流无条件继续）。
5. **提交**——走与模型侧完全相同的 `fold()` 引擎与同一套新鲜表面重验证；run 中途不再可达的区间诚实中止。提交折叠后 nudge 基线清零（防反馈环，与官方 compaction 处理器自己的 re-base 同型）。

实测现实（headless 基准，`workbuddy/hy4flash-free`，声明窗口 40000）：触发保守正确（前 10 轮不误发），随后提交了一次真实的服务端折叠——区间 [9..202]，估算 5471 → 864 tokens（−84%），全会话 **0 模型工具调用**（BENCH-report §12；评审独立重放归档于 `reports/bench/harness/replay-f297.mjs`）。已知覆盖边界：同一单调纪元内，一次已提交折叠会把可达区间压到折叠地板之下——每纪元多次折叠需要按 checkpoint 对齐的吸收窗（BENCH-report §12.3/§13，如实声明的边界，不是藏起来的缺口）。

<a id="the-optional-patcher"></a>
## 可选的 base-context 补丁器（外部工具，用户执行，v0.2）

`patcher/zctx-patch.mjs` 是**独立、严格可选**的官方桌面版补丁工具。它把五文件 base-context 补丁集（`zctx-v0.3-base-1`）以**一次原子 asar 写入**应用到官方安装，点亮 guard-observe wire 域（逐请求 hash-then-passthrough fetch 包装层 + adapter guard sink），让观测账本在插件自有 adapter 不驱动的官方路由上也能看到线缆。没有补丁，插件功能完整；补丁只拓宽可见域。**真机 patch/restore 执行权与责任在用户**——本仓从不对真实安装执行它。

- **触碰面**——官方 asar 内恰五个文件（`llm-pi-ai` 携带 P4 wire 桩 + guard 接线；`agent-loop` guard observer；`session` 持久化词汇；`compaction-basic` L3 预算；`compaction-tool-result-pruner` 裁剪声明）。零新增 asar 条目、零官方导出面变更、零请求体改写（红线 R1）。
- **门**——app 未运行、版本 ∈ 支持集、逐文件原始哈希锚（漂移 = 官方更新 = 拒收）、锚串唯一性、幂等重跑（已打 = no-op 成功）、整集一次原子写入（不存在部分多文件状态）、逐文件后校验、动原件前先备份到安装目录外的 sibling 目录。
- **重打**——补丁只存活到官方更新器替换安装目录为止；更新后 `status` 报告漂移，对新构建更新锚集后重打。**回滚**——`restore` 从哈希校验过的备份原子还原原始字节并清除 marker；`status` 严格只读，报告逐文件面与 `patchSet` 聚合（patched / unpatched / partial / drifted）。全流程见 `patcher/README.md`。
- **自愈（v0.3-auto）**——`auto` 是每小时状态机，把"官方更新静默杀死补丁"变成"自动愈合或响亮报警"：读取 Electron fuse wire（VERIFY-P #11 sentinel 扫描——完整性位 ON 或不可读即 fail-closed 拒绝），仅在有 `--yes` 且全 pristine+锚命中时重打（drifted/mixed 一律响亮拒绝绝不盲打），patch 后全量 status 复核，每行日志落到 `%LOCALAPPDATA%\zctx-patch\auto.log`；`install-task`/`uninstall-task` 管理其 Windows 计划任务（幂等、非 Windows 响亮拒绝）。判定表见 `patcher/README.md`。

<a id="settings"></a>
## 设置项

九个原始类型字段加 v0.2.0/v0.3.0 各段（observe 开关、preflight、S2 providers 声明、guard-observe 桥开关、autoFold 面）；static `Config` schema 自动生成设置页。

| 字段 | 类型 | 默认值 | 含义 |
|---|---|---|---|
| `enabled` | boolean | `true` | 总开关。`false` 时插件保持被动；官方 compaction 仍是硬底。 |
| `nudgeThresholds` | string | `"25,50,75,90"` | 触发 nudge 的占用率百分比，逗号分隔。 |
| `keepRecentTokens` | number | `0` | 原样保留的近端尾部 token 预算；`0` = 自动。 |
| `maxFoldFraction` | number | `0.6` | 单次折叠可覆盖窗口比例的上限。 |
| `minFoldableTokens` | number | `5000` | 低于该 token 数的区间拒绝折叠。 |
| `protectionFloorTokens` | number | `5000` | 任何折叠窗口都必须让出的 token 数（保护区）。 |
| `summaryFloorChars` | number | `50` | 摘要文本的最短字符数。 |
| `summaryCeilingChars` | number | `20000` | 摘要文本的最长字符数。 |
| `netShrinkTolerance` | number | `1.05` | 折叠必须至少把台账缩到 `1/netShrinkTolerance`。 |

v0.2.0 各段共用同一 schema：

| 字段 | 类型 | 默认值 | 含义 |
|---|---|---|---|
| `attributionTimeWindowMs` | number | `90000` | 归因时间窗兜底（未标定——见[限制](#limitations)）。 |
| `cleanSampleFloor` | number | `0.6` | 纯净占比低于该值时，`zctx_status` 报告「归因可信度不足」而不是渲染回本表。 |
| `observe.enabled` | boolean | `true` | 观测账本总开关（装上即开始记）。 |
| `observe.attemptCapture` | boolean | `false` | 同时记录失败尝试的用量（非持久，仅进程内存）。 |
| `preflightMode` | string | `"observe"` | `'off' \| 'observe' \| 'enforce'`——见 [Preflight 预检（S1）](#preflight-s1)。 |
| `preflightMarginRatio` | number | `0.9` | Preflight 命中裕度（未标定——见[限制](#limitations)）。 |
| `providers` | provider[] | `[]` | S2 路由声明（见 [zctx 路由](#zctx-router)）；零路由 = adapter 面保持合法 keep-alive。经 profile overlay patch 配置。 |
| `patch.guardObserveEvents` | boolean | `true` | 补丁链 `cache/guard-observe` 事件的只读消费者（无外部补丁时按构造即惰性）。 |
| `autofold.enabled` | boolean | `false` | 服务端自主折叠面（见 [autoFold](#autofold)）；v0.3.0 显式 opt-in。 |
| `autofold.summarizer` | string | `"compaction"` | 摘要供给：`'compaction' \| 'external' \| 'digest'`。非法值响亮 skip，绝不静默换道。 |
| `autofold.external.url` | string | `""` | external 供给端点（`summarizer: 'external'` 时必填；为空 = 响亮 skip）。 |
| `autofold.external.model` | string | `""` | external 供给模型 id（与 `external` 配套必填）。 |
| `autofold.external.apiKeyEnv` | string | `""` | 保存 external Bearer 凭据的环境变量名；已配置但变量缺失时 wire 时 warn。 |
| `autofold.maxRounds` | number | `16` | 每 run 折叠链的区间尝试预算。 |
| `autofold.maxBatch` | number | `4` | 折叠链每轮的选区批宽。 |
| `autofold.maxSummaryOutputTokens` | number | `32768` | 模型摘要调用的输出钳制上限。 |

与设置项无关的一条独立约束：上下文窗口低于 32768 token 时，整个自动面（nudge + 引擎门）保持关闭——这是估算公式的法定域。工具仍可用；status 会渲染明确的说明行。

<a id="behavior-notes"></a>
## 行为说明

三条有意为之的行为，不是 bug：

**PTC（run_code）会话里模型不能直呼这些工具。** 原生工具模式下，模型一等公民式地直接调用 `zctx_*`。PTC 会话里，官方 harness 不为第三方工具注册模型直调面（直呼会被以 `UNKNOWN_TOOL` 拒绝），此时工具经 `run_code` 子派发使用。指导段为模型写明了这一点。折叠行为本身没有任何变化——只是两种模式下调用形态不同。

**nudge 上下文以 `required: true` 注册。** 官方 system prompt 组装器在某些配置下会过滤掉非 required 的上下文贡献（例如运行时上下文被抑制时）。把压力 nudge 注册为 required 正是让它在这种过滤下存活——否则 nudge 恰恰会在压力最高的时候静默消失。这不等于 nudge 永远挂在线缆上：只有自上次评估以来跨越了阈值才贡献文本，否则贡献空串。

**unfold 以单节点形态重新物化。** 官方 replace 语义是 N 个表面节点换恰好一个节点。因此展开时，checkpoint 被替换为一条内联引用原文的单条多 text-block user message（原文按序从日志取回；tool 结果带来源标注引用）——原始的那些轮次**不会**以独立消息的形态回到表面。会话日志永久保留每个原始事件，`zctx_recall` 也能搜到它们，但展开后的线缆形态与折叠前的轮次结构不同。这是走官方通道的诚实代价，测试里有断言钉住它，而不是藏起来。

<a id="limitations"></a>
## 限制

- **工具采用率依赖模型。** 折叠发生在模型遵循指导与 nudge 的时候。指令遵循越弱，折叠越少——无论如何，官方 compaction-basic 始终是硬底。v0.3.0 的 `autofold.enabled` opt-in 以服务端自主折叠面移除了这一依赖（见 [autoFold](#autofold)）。
- **autoFold 的单纪元覆盖边界。** 同一单调纪元内（无 compaction/checkpoint 位移介入），一次已提交折叠会把可达区间压到 `minFoldableTokens` 地板之下——在按 checkpoint 对齐的吸收窗落地之前，每纪元一次折叠是如实的天花板（headless 实测；BENCH-report §12.3）。
- **没有线缆级兜底。** 折叠只走官方 surface replace 通道。没有请求改写、没有 fetch 代理、没有提示词级截断兜底；通道不可用时，本插件不会退化成 hack 方案。
- **跨 checkpoint 吸收要求边界对齐。** 折叠窗口吸收更早折叠的 checkpoint 时，窗口必须恰为 `[checkpoint, checkpoint]`；更宽的跨 checkpoint 窗口会被以明确理由拒收。
- **单会话范围。** `zctx_recall` 与台账都是每会话独立的；不做跨会话检索。
- **估算器阈值未标定。** `attributionTimeWindowMs=90000`、`cleanSampleFloor=0.6`、`preflightMarginRatio=0.9` 是设计默认值，待真机标定；chars/3 估算器对高密度 CJK 的低估风险是已知隐患。`zctx_status` 会渲染校准统计，作为日后调整的依据——在此之前，`preflightMode: 'enforce'` 仅作 opt-in 高级用法。
- **wire 域账本只覆盖 zctx 路由会话，且对象级哈希对 harness 边界之下全盲。** harness 域归一化前缀哈希只看得到 harness 事件——pi-ai 或传输栈在该边界之下做的一切（序列化、供应商特有封帧）对它们不可见；wire 域字节哈希看得到真实字节，但只存在于 S2 路由驱动的请求上。这是 v0.2.0 观测能力的诚实天花板，是声明出来的，不是糊过去的。

<a id="security"></a>
## 安全

- **零网络、零遥测。** 本插件不打开任何 socket、不上报任何指标；没有 analytics、没有崩溃上报、没有回连。
- **会话数据留在本地。** 全部折叠状态都在本地会话日志（harness 自己的存储）里。插件保有零个独立数据文件；内存台账靠扫描该日志重建。
- **模型伪造防御。** 模型无法「声称」一次没有发生的折叠：每次提交都经服务端验证（保护区、连续性、净缩门、摘要长度窗、原子批次），提交走 harness 自己的会话 append，模型看到的回执是原生 tool result——不是模型渲染的文本。
- **折叠提交互斥。** 四个工具都不声明 `isConcurrencySafe`；缺省即官方的独占屏障语义，这正是提交路径的互斥前提。
- **fail-soft 降级。** 每个宿主面都做能力探测；某个服务缺失时跳过该功能并打一行日志，而不是炸掉启动。

<a id="acknowledgments"></a>
## 致谢

本插件是对社区已验证机制的一次净室重实现：

- [**ranxianglei/billion-context**](https://github.com/ranxianglei/billion-context)（MIT）——机制灵感的来源：模型驱动的增量折叠、摘要即元数据的纪律、缓存感知 nudge、跨越计次重付。感谢它公开了可运行的设计与诚实的代价清单。**本仓未复制它的任何代码、提示词原文或压缩规则措辞**——这里的全部文本从零撰写，研究的只是机制语义。
- **我们自己的 CCM 研究**（上下文-缓存经济学：预算公式、盈亏平衡记账、32768 token 法定域）——预算引擎与 status 记账遵循该研究。

本仓全部实现、措辞、测试与文档均为原创工作（MIT，见 [LICENSE](LICENSE)）。

<a id="development"></a>
## 开发

```sh
pnpm install
pnpm build          # tsdown → lib/（产物入库，探针按字节锁定）
pnpm lint           # tsc --noEmit，预期零错
pnpm test           # tsdown && vitest run——构建链在测试之前（Z19：否则导入
                    # lib/index.js 的测试会静默钉住过期产物），含真实官方 session 钉
```

仓内验证探针：

```sh
node scripts/probe-artifact.mjs             # 对构建产物跑 6 组探针
node scripts/verify-activation-surface.mjs  # 激活面断言（10 组）
node scripts/probe-host-imports.mjs         # 宿主导出可达性（16 条；zDSH-main 缺席时 SKIP）
node scripts/smoke-real-loader.mjs          # 真机冒烟（3 条；zDSH-main 缺席时相应部分 SKIP）
node scripts/probe-real-mount.mjs           # 构建产物挂进真实 vendored cordis 容器（4 组 / 5 查，含真机故障负对照）
```
