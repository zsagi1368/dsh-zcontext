# ZCTX 方案对比（docs/specs/ZCTX/options.md · v1）

> 任务：独立插件 **dsh-zcontext**——把「模型驱动增量上下文折叠」装进官方 deepseek harness，不改底座。
> 研究输入：RES-plugin-api.md（Agent B，SHA-256 bec57072…，247 行）+ RES-billion-context.md（Agent A，增量落盘中）+ 主线亲验（pre-step 语义 / SurfaceOp replace 契约 / RuntimeContextProjection / ToolExecution.agent / region.ts 提交形态）+ 我方 CCM v2.3 预算数学（budget_table.py v3）+ ctx-cmp/ctx-opt 资产盘点。
> 事实纪律：每条关键主张标【事实·锚点】/【推断·置信度】/【未解决】。

## 0. 问题定义

官方 harness 的 compaction-basic 只做「窗口压力触发的全量摘要」，无主动折叠；缓存经济学无人记账。billion-context 证明：模型驱动增量折叠（模型自己写摘要、自己选区间）+ 缓存感知 nudge，可让会话长期运行而窗口占用保持低位。**用户目标 = 官方插件形态复刻该能力。**

## 1. 能力面结论（主线亲验 + Agent B 双源互证，全部【事实】）

| 官方 API | 语义 | 锚点（zDSH-main @ zdsh-latest / 073927c7f8） |
|---|---|---|
| `ctx.tools.register(ToolDefinition)` | 工具注册，仅 `run_code` 保留名 | packages/core/tools/src/index.ts:1069-1094 |
| `execute(args, exec)` | `exec.agent?.session` 可达 Session（tools/src/index.ts:340 + :960 实证消费）；`exec.deferContext(UserMessage)` 可附插件指令 | packages/core/tools/src/index.ts:327-353, 419-436 |
| `Session.append(type, data, {surfaceOp})` | `{op:'replace',startSeq,endSeq}` + sourceEventSeqs=官方唯一历史折叠通道；类型注释明示 "Used by compaction; any surface-replacing producer may use it" | packages/core/session/src/types.ts:449-464；packages/compaction/compaction-basic/src/region.ts:506-508 |
| `ctx.systemPrompt.section()/context()` | section=有序稳定段；context=动态运行时快照（变化才追加，不变时 no-op） | packages/core/system-prompt/src/index.ts:474-566；packages/core/agent-loop/src/runtime-context.ts:113-164 |
| `ctx.tokenMeter.measure(session)` | 官方权威计量（compaction-basic 同款） | packages/compaction/compaction-basic/src/index.ts:278 |
| `ctx.llm.resolveModelInfo(provider, model)` | 查 contextWindow/maxTokens | packages/compaction/compaction-basic/src/index.ts:304 |
| `session.surface.replaceGeneration/contentGeneration` | 表面替换代数（并发/重试判定原语） | packages/compaction/compaction-basic/src/index.ts:202, 212, 230 |
| `agent.runMaintenance(fn)` | idle 期维护窗口 | packages/compaction/compaction-basic/src/index.ts:390 |
| `commands.register` / static Config→settings 自动 UI | 命令面/设置面 | packages/interaction/commands/src/index.ts:285-290；packages/settings/settings/src/index.ts:20-28 |
| 安装门 | 必须声明 `dsh.bundle`；peerDeps 门；git 形态安装 + 连接预检；allowBuilds | packages/boot/plugin-manager/src/index.ts:585-587；apps/cli/src/plugin.ts:16-107 |

**天花板判定**（融合 Agent B 表 + 主线亲验）：注入 system prompt=可行；注册工具=可行；观察消息流=可行；**历史折叠=可行（surface replace 正式通道）**；请求级改写=不可行（LOOP 请求 frozen，agent/request 禁改）；compaction 拦截=不可行（只能共存/抢序）。

## 2. 三方案

### 方案甲：工具驱动折叠插件（推荐）

纯官方原生面；不改底座、零网络、零 sidecar、v1 零自定义 client bundle。

1. **四个工具**（zctx_ 前缀防撞，避 run_code）：
   - `zctx_fold`：一次调用可带多区间+摘要，原子提交（任一区间非法→整批拒收）；
   - `zctx_unfold`：按 foldId/最近折叠还原（one-for-one 重物化节点，原始内容取自 session 存储 eventAt）；
   - `zctx_recall`：关键词检索折叠摘要与折叠走原文（session 存储里 shadowed 事件永久留存）；
   - `zctx_status`：预算表（CCM v2.3 公式）+压力%+可折叠区间图（含保护区/危险标注）+折叠台账+缓存对账（breakeven 公式）。
2. **静态指导段**（systemPrompt.section，order 靠后、逐字节稳定）：折叠哲学、KEEP/DROP 清单、批次纪律、摘要=元数据非指令（Open objectives 例外）。
3. **阈值跨越 nudge**（systemPrompt.context()，默认 25/50/75/90% 触发线）：内容只在跨越时变化→缓存安全；含可压缩区间表（PROTECTED 标注）。
4. **预算引擎**：CCM v2.3 权威公式（触发线=W−R_pess，keepRecent，r_min）驱动 nudge 时机与 fold 目标。
5. **折叠验证器**（保守集）：保护区（最近 N 消息+最近 N token+最后 user 消息）、tool 配对闭合、第一条 user 消息钉死、净缩门（NET_SHRINK_TOLERANCE）、原子批拒收、活跃 compaction 互斥、DEAD 范围跟踪（外来源 surface replace 遮蔽即登记）。
6. **自描述台账**：折叠以 `zctx-fold` source kind 的 checkpoint 节点入 session 日志（含 foldId/区间/被遮蔽 seqs/统计），重启/分叉后由 session 扫描重建内存态——**零独立存储文件**。
7. **命令与设置**：`/zctx` 斜杠命令（status/fold/unfold）；static Config 自动生成设置页。
8. **与官方 compaction 关系**：前置主动折叠让 compaction-basic 尽量不触发；它始终是硬底。零拦截。

### 方案乙：甲 + 代理式深度集成（fetch 层路线）

= 甲的 guidance/status 面不变，折叠引擎改走 billion-context 同款：插件内嵌折叠内核 + patch `globalThis.fetch`（宿主唯一模型出口）把模型流量引到内置代理，在 wire body 上做折叠/标注/ephemeral nudge，并把官方 compaction-basic 关停（host-plane patch 行 auto:false + preset-plane internal/config 中间件标 disabled——billion-context 两平面都做了）。
- 增益（billion-context 实证）：wire 级控制（ephemeral nudge 不污染历史、preflight 硬兜底、宿主历史保持全量、UI 不变）。
- 代价（billion-context 自己的证据）：需要 patch globalThis.fetch（非官方 API，运行时 hack）；必须关停官方 compaction（两个平面的关停接线 + 降级告警 + 兜底拒收守卫）；会话/线缆/宿主三方失同步是常态（靠内核协调）；身份/亲和/存储/预检/紧急摘要/CCR 全栈自研（他们的 kernel 是独立仓库规模）。【事实·RES-billion-context.md Q4】
- **淘汰理由**：官方 surface-replace 通道被官方明文授权（types.ts:455-464）且有 compaction-basic 参考实现；fetch patch 路线 = 重建代理内核栈 + 关停官方能力 + 双真源同步负担，复杂度不抵增益。差异化优势反而成立：**dsh-zcontext 与官方 compaction 共存（compaction=硬底不关停）、会话/线缆/宿主三方一致、零 hack。**

### 方案丙：纯观察建议器（零写入面）

只做 status/guidance/nudge，不做任何 surface 写入；「折叠」=模型把摘要抄进自己的回复（无工具提交）。
- 增益：零写面=零会话完整性风险。
- 代价：折叠依赖模型自觉落笔，无原子性、无台账、无可逆性——能力对标失败（billion-context 的核心就是提交机制）。
- **淘汰理由**：不能兑现「billion-context 都有办法」的能力目标；surface replace 通道既有官方授权又有 compaction 参考实现，风险可控。

## 3. 裁定

**方案甲**。理由：能力对标 billion-context 核心机制（模型驱动、增量、可逆、缓存感知）且全部走官方一等面；工程面继承 PluginCenter 模板（package.json+tsdown 双面（v1 仅 host）+cordis name/inject/apply）；风险面=折叠提交的会话完整性，由保守验证器+官方通道+compaction 硬底三层兜底。乙/丙的合理增量（auto-fold 自动微剪枝、T2/T3 蒸馏、client UI 面板、auxiliary summarizer）登记为 v2 路线图，不属本战役范围（非遗留，是范围裁定）。

## 4. v1 范围裁定（非目标）

- 不做 client bundle/自定义 UI 面板（v2；v1 用 static Config 自动设置页）。
- 不做 T2/T3 层级蒸馏与 refold-in-place（v2）。
- 不做 auto-fold（无模型参与的自动剪枝/自动折叠——v2，产品门控）。
- 不做 auxiliary summarizer（服务端额外 LLM 摘要——v2 配置门控）。
- 不做跨会话检索（zctx_recall 仅限当前会话——v2）。
- 不做 wire 级 preflight 硬兜底（不可行，官方无通道；compaction-basic 的 overflow 恢复就是硬底）。

## 5. 开放问题（主线已全部亲手闭合）

- ~~Q1 锁面~~ → 已闭：折叠提交走 compaction 同款纪律（region.ts:180-276）——zctx 折叠用 `user/message` checkpoint 一次性提交（无摘要等待窗，提交即原子）；提交前扫 session 日志检测未闭合 `compaction/start`（compaction 活跃→拒收）并校验 `session.surface` 稳定性（contentGeneration/replaceGeneration 比对）；与并行工具调用互斥靠「同区间重复折叠检测 + surface 稳定性断言」。
- ~~Q2 自定义事件类型~~ → 已闭：**零自定义事件类型**。折叠元数据全走 checkpoint 节点的 `message.source`（自定义 kind `'zctx-fold'`/`'zctx-unfold'`，MessageSourceMap 数据面开放）；全部事件=已知类型 `user/message`，老版本 harness 读路径零风险。`appendPluginRecord` 路线（types.ts:523-544，ignorable 自动+plugin: 语法）确认存在但带仓内源门（verify-plugin-record-callers 只管宿主仓源码），v1 不用——避开灰色地带。
- ~~Q3 设置面~~ → 已闭：static Config 全 primitive 字段（boolean/number/string），schemastery 每字段自动生成 settings UI；配置落 profile cordis.patch.yml 插件行 config（settings/src/index.ts:347）。

## 6. 折叠提交的官方参考形态（region.ts 亲读结论）

```
session.append('user/message',
  { turn, message: createUserMessage({ content:[{type:'text', text:summary}],
      source:{ kind:'zctx-fold', foldId, startSeq, endSeq, shadowedSeqs, stats } }) },
  { surfaceOp:{ op:'replace', startSeq, endSeq },
    sourceEventSeqs:[...shadowedSeqs] })
```
- sourceEventSeqs 必须含全部被遮蔽 surface 节点（types.ts:455-464）；
- unfold = checkpoint 节点 →（replace 1:1）→ 重物化节点（原文经 session.eventAt 逐 seq 取回、嵌套折叠 checkpoint 展开一层）；
- 外来源 surface replace（含官方 compaction）遮蔽我方 checkpoint → 该 fold 转 absorbed/dead（session/event firehose 监听 + ledger 扫描重建时判定）。