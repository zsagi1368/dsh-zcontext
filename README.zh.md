# dsh-zcontext

[DeepSeek Harness](https://github.com/deepseek-ai) 的模型驱动增量上下文折叠插件——把对话里已经收尾的段落折叠成模型自己撰写的短摘要，让超长会话的工作窗口始终保持在低位。全部折叠都走官方 surface replace 通道，不改底座、不改请求、不改线缆。

- **这是什么**——官方 DeepSeek Harness 的第三方插件包（`dsh-zcontext`）：四个工具（`zctx_fold` / `zctx_unfold` / `zctx_recall` / `zctx_status`）、一段静态指导、一条压力提醒（nudge）、一个 `/zctx` 命令、一本装上即记的观测账本、一道可开启的 preflight 预检门、一个接入自有供应商的 zctx 路由（opt-in）——全部经同一张设置页呈现（九个原始字段加下方 v0.2.0 各段）。不 patch 宿主，不 fork；唯一面向线缆的面是显式声明的 S2 路由，且它绝不改写请求体。
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
- **enforce（显式 opt-in）**——命中（估算 > 触发线 × `preflightMarginRatio`）时以恰好一个终态 `finish{kind:'error', failure:{code:'CONTEXT_WINDOW_EXCEEDED'}}` chunk 短路本次流——官方认可的短路形态——省下这单注定失败的线缆请求；其后的全部救援由官方 compaction 溢出恢复链接管。一次性请求（compaction、会话标题）永不参与判罚，恢复链自己的调用不可能被自己短路。
- **off**——该监听器不注册。

enforce 在三个迁移条件全部成立之前保持 opt-in：估算器误差分布经真机标定、误报代价（每次误判多付一次 compaction 表面改写）被有意识地接受、observe 期记录的命中与真实供应商溢出对得上账。在那之前，估算器阈值是声明的标定欠账（见[限制](#limitations)）。

<a id="zctx-router"></a>
## zctx 路由（S2）：接入自有供应商，且诚实

v0.2.0 唯一触碰线缆的地方——作为显式声明的例外，不是接管：一个薄 adapter，让 harness 经官方可配置供应商面驱动**你自己的** OpenAI/Anthropic 兼容端点。官方路由永不被替换，adapter **绝不改写请求体**（零改写红线有测试钉死）。

- **family 就是协议名。** 每个声明的供应商成为路由 `zctx-<family>`，其中 `family` 直接取官方 `supportedProtocols()` union 的线缆协议名（`openai-completions` | `openai-responses` | `anthropic-messages`，从宿主动态加载，带如实标注的内置兜底）。零发明映射；未知 family 在构造期被拒收并附完整违规清单。
- **配置形态。** 结构化 `providers[]` 设置段是配置权威，经 profile overlay patch 手写。Models 页会挂载本插件命名空间、显示每条路由的行、凭据徽标与错误字段——但第三方命名空间**没有页面编辑能力**（探针实测；诚实天花板）：页面仅可见。
- **每个模型声明自己的容量。** `contextWindow` 与 `maxTokens` 是每个模型的必填正整数——缺值即构造期违规，绝不发明默认值（官方 catalog 语义）。
- **缓存旋钮。** `cacheRetention`（`'none' | 'short' | 'long'`）直通 pi-ai 自身的优先级（显式值 > 环境变量 > 默认 `'short'`；`'none'` 关闭缓存标记）；`cacheControlFormat: 'anthropic'` 物化 cache-control 标记——仅在 `openai-completions` 族有意义，其他族构造成拒收（死配置不诚实携带）。
- **红线全守。** `maxRetries: 0`（重试归 agent 恢复层独占）、归因头随每一次请求上行（含一次性调用）、仅 HTTP(SSE) 协议（无 WebSocket 传输）、纯文本——image/file 内容块在线缆之前被拒收。
- **wire 账本覆盖。** 只有路由实际驱动的会话才有 wire 域字节哈希行；其余会话保持 harness 域，每行携带自己的 `domain` 标注。

<a id="settings"></a>
## 设置项

九个原始类型字段加 v0.2.0 各段（observe 开关、preflight、S2 providers 声明）；static `Config` schema 自动生成设置页。

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

与设置项无关的一条独立约束：上下文窗口低于 32768 token 时，整个自动面（nudge + 引擎门）保持关闭——这是估算公式的法定域。工具仍可用；status 会渲染明确的说明行。

<a id="behavior-notes"></a>
## 行为说明

三条有意为之的行为，不是 bug：

**PTC（run_code）会话里模型不能直呼这些工具。** 原生工具模式下，模型一等公民式地直接调用 `zctx_*`。PTC 会话里，官方 harness 不为第三方工具注册模型直调面（直呼会被以 `UNKNOWN_TOOL` 拒绝），此时工具经 `run_code` 子派发使用。指导段为模型写明了这一点。折叠行为本身没有任何变化——只是两种模式下调用形态不同。

**nudge 上下文以 `required: true` 注册。** 官方 system prompt 组装器在某些配置下会过滤掉非 required 的上下文贡献（例如运行时上下文被抑制时）。把压力 nudge 注册为 required 正是让它在这种过滤下存活——否则 nudge 恰恰会在压力最高的时候静默消失。这不等于 nudge 永远挂在线缆上：只有自上次评估以来跨越了阈值才贡献文本，否则贡献空串。

**unfold 以单节点形态重新物化。** 官方 replace 语义是 N 个表面节点换恰好一个节点。因此展开时，checkpoint 被替换为一条内联引用原文的单条多 text-block user message（原文按序从日志取回；tool 结果带来源标注引用）——原始的那些轮次**不会**以独立消息的形态回到表面。会话日志永久保留每个原始事件，`zctx_recall` 也能搜到它们，但展开后的线缆形态与折叠前的轮次结构不同。这是走官方通道的诚实代价，测试里有断言钉住它，而不是藏起来。

<a id="limitations"></a>
## 限制

- **工具采用率依赖模型。** 折叠发生在模型遵循指导与 nudge 的时候。指令遵循越弱，折叠越少——无论如何，官方 compaction-basic 始终是硬底。
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
pnpm test           # vitest 全套（424 例），含真实官方 session 钉
```

仓内验证探针：

```sh
node scripts/probe-artifact.mjs             # 对构建产物跑 6 组探针
node scripts/verify-activation-surface.mjs  # 激活面断言（10 组）
node scripts/probe-host-imports.mjs         # 宿主导出可达性（16 条；zDSH-main 缺席时 SKIP）
node scripts/smoke-real-loader.mjs          # 真机冒烟（3 条；zDSH-main 缺席时相应部分 SKIP）
```
