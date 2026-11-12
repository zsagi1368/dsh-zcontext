# dsh-zcontext

[DeepSeek Harness](https://github.com/deepseek-ai) 的模型驱动增量上下文折叠插件——把对话里已经收尾的段落折叠成模型自己撰写的短摘要，让超长会话的工作窗口始终保持在低位。全部折叠都走官方 surface replace 通道，不改底座、不改请求、不改线缆。

- **这是什么**——官方 DeepSeek Harness 的第三方插件包（`dsh-zcontext`）：四个工具（`zctx_fold` / `zctx_unfold` / `zctx_recall` / `zctx_status`）、一段静态指导、一条压力提醒（nudge）、一个 `/zctx` 命令、一张九字段设置页。不 patch 宿主，不 fork，不在请求层做任何手脚。
- **为什么做它**——官方自带的 compaction-basic 只做「窗口压力触发时的全量摘要」，没有模型驱动的增量折叠。[billion-context](https://github.com/ranxianglei/billion-context) 研究证明了这套机制的可行性（模型自己写摘要、自己选区间、缓存感知的 nudge，长会话窗口占用保持低位）。本插件把这套能力装进官方插件面——同样的机制，走宿主自己的正道。

  <a id="clean-room"></a>
- **净室声明**——本仓零复制 billion-context 或任何上游的代码与提示词原文。所有代码与所有模型可见文本均为原创撰写，指导段是我们的措辞。详见[致谢](#acknowledgments)。

## 目录

- [工作原理](#how-it-works)
- [安装](#install)
- [四个工具](#the-four-tools)
- [/zctx 命令](#the-zctx-command)
- [与官方 compaction 的关系](#relation-to-official-compaction)
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
5. **Status**——`zctx_status` 是唯一可信台账：窗口占用对触发线、预算分解（CCM v2.3 公式）、可折叠区间图（PROTECTED 标注）、活跃折叠、异常记录、缓存用量（实测或估算，如实标注）。

缓存经济学是记账出来的，不是口号：四个工具 schema 加指导段是固定线缆开销；每次折叠或 nudge 跨越都要从缓存锚点起重付一次前缀重建。`zctx_status` 展示实测（供应商上报的 cache read/write）与估算两种口径的分账。

<a id="install"></a>
## 安装

```sh
dsh plugin add github:zsagi1368/dsh-zcontext
```

环境要求：支持插件的 DeepSeek Harness，Node.js >= 22.13。构建产物随仓库发布（`lib/` 已入库），git 形态安装不触发任何构建步骤，也不会向 pnpm 请求构建审批（`allowBuilds`）。唯一 peer 依赖是 `@deepseek-ai/cordis`（optional，由宿主提供）。装好后设置页会出现本插件的专属段（static `Config` schema，九字段见下），会话里可用 `/zctx`。

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

<a id="settings"></a>
## 设置项

九个原始类型字段；static `Config` schema 自动生成设置页。

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
pnpm test           # vitest 全套（193 例），含真实官方 session 钉
```

仓内验证探针：

```sh
node scripts/probe-artifact.mjs             # 对构建产物跑 5 组探针
node scripts/verify-activation-surface.mjs  # A4 激活面断言（8 组）
node scripts/smoke-real-loader.mjs          # A6 真机冒烟（zDSH-main 缺席时相应部分 SKIP）
```
