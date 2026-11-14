# AUD-host-faces.md — 全量审计令 D2：宿主集成面域（攻击者视角）

- TASK_ID: ZCTX-AUD-D2 · 日期 2026-11-14 · 审计人：reviewer（评审人 ≠ 作者）
- 对象：G:\000Github\zDSH\zDSH-plugins\dsh-zcontext —— src/plugin.ts / tools.ts / observe.ts / preflight.ts / command.ts / adapter/*（host/map/wire/replay/context/twins/providers/zctx-adapter 八模块）/ config.ts / host-llm.ts / index.ts / command.ts，store.ts 仅审宿主面接收端口边界
- 对照物：zDSH-main（fork 治理态，只读实读）+ RES-official-drift.md（rc.1→rc.3）+ RES-adapter-route.md（F 系锚点）
- 方法：逐文件实读 + 官方源码交叉验证（file:line 直证）+ grep 全仓核对；官方行为结论全部回溯到 zDSH-main 源文件行号
- 开工查册：INDEX.md 命中 Z20（file: URL 反解/fail-soft 加载器分解）/Z21（inject 键 PENDING）/Z16/Z18/Z19/A43/A14、A25，已转检查项；本报告全部经 Write 工具落盘（无 heredoc）
- 与 D1 互补声明：applyEvent 幂等/畸形 source 等状态机域问题（SM-01/SM-02 等 12 条）不在本报告重复；涉及 store 的部分只审「宿主面调用 store 的异常边界」一侧

---

## 0. 结论速览

宿主集成面整体纪律良好：五面降级的「缺席态」探针完备、R1-R8 在宿主面逐条成立、enforce 短路对官方计量面无影子（§4 实证）、rc.3 三项适配判定全部为「无需适配」（§6）。但发现 **1 条真缺陷（HF-01，图片被静默降级为占位文本，与声明的诚实拒绝边界相反）**、**1 条依赖面真缺陷（HF-02，未读 inject 键）**、7 条边界强化、4 条覆盖盲区。无 boot 必炸路径（唯一候选 HF-15 有宿主 containment 兜底，降级为边界强化）。

分级统计：真缺陷 2 · 边界强化 8 · 覆盖盲区 4（详 §7）。

---

## 1. 审计点一：fail-soft 边界完备性（五面降级 × 三态 + adapter 三面加载器）

### 1.1 五面「缺席态」——PASS

每面都有显式探针 + 诚实日志，七 warn 面有钉测（tests/plugin.spec.ts:212-229）：
- session feed：ctx.on 非函数 → warn skip（plugin.ts:284-287）
- tools：ctx.tools?.register 非函数 → warn skip（plugin.ts:313-316）
- guidance/nudge：systemPrompt.section/context 缺失 → warn skip（plugin.ts:326-329, 336-339）
- command：commands.register 缺失 → warn skip（plugin.ts:354-357）
- preflight：三重 gate（mode=off→info；ctx.on 缺→warn；ctx.llm 缺→warn）（plugin.ts:386-398）
- observe：三重 gate 同构（plugin.ts:573-584）
- adapter：四 gate 按序（providers 空→info / registerAdapter 缺→warn / 配置违规→完整清单 warn / 宿主 lib 不可达→info）（plugin.ts:453-492）

### 1.2 [真缺陷 HF-01] zctx 路由上的图片请求被官方投影静默降级为占位文本——「诚实拒绝」门不可达

- 证据链：
  1. zctx-adapter.ts:263 `modelInfoOf` 恒返回 `inputModalities: ['text']`；
  2. 官方 adapterStream（zDSH-main packages/llm/llm/src/index.ts:1092-1095）在 dispatch **之前**对「已知无图模型」执行 `projectImagesForTextModel`；
  3. 官方 projectImagesForTextModel（llm/src/content.ts:360-371 + replaceImagesForTextModel）是**纯占位文本替换**，不需要 attachment 服务、不抛错；
  4. 因此经官方派发路径（llm.stream 或 preparedCall.stream → streamWithRegistration → adapterStream → dispatch）到达 zctx-adapter.ts:362-370 `contentHasImage` 拒图门时，图片块已被替换成占位文本——**该门在官方路径上不可达**，只在直呼 adapter 对象的测试路径可达。
- 后果：用户在 zctx 路由发送图片 → 请求带 `[image]` 占位文本正常上线 → 模型看不见图、无任何失败信号 → **静默质量劣化**。直接违反模块自述契约：「any image block fails the request BEFORE conversion … the honest S2 surface is the refusal (UNSUPPORTED_CONTENT)」（zctx-adapter.ts:354-361）与 README/config.ts:104-117 的 text-only 边界叙述。
- 修复建议（择一，不实现）：(a) 接受占位路径，把 zctx-adapter.ts:354-361 的「UNSUPPORTED_CONTENT 拒图」文档降级为「防御镜像（官方投影已先行）」，并在 zctx_status/wire 台账暴露 imageCount 让劣化可观察；(b) 在目录/产品面声明 text-only 使上层 UI 禁图（U1 已证第三方 settingsNs 无页编辑能力，此路受限）；(c) 不推荐：在 toPiContextTextOnly 识别占位文本特征（不可靠）。
- 分级理由：行为与声明契约矛盾 + 用户可见静默劣化，属真缺陷；非崩溃、非数据损坏。

### 1.3 [边界强化 HF-15] 同步五面的 register 调用无「抛错态」兜底——与「never breaks boot」声明不符

- plugin.ts:319（tools.register 循环）、:330（systemPrompt.section）、:340-348（systemPrompt.context）、:358（commands.register）全部裸调，无 try/catch。官方 register 有多条 throw 路径：tools.register 校验 output 形状/`assertSupportedJsonSchema`/保留名即抛 TypeError（zDSH-main packages/core/tools/src/index.ts:1069-1093）；commands.register 同类效果模式（interaction/commands/src/index.ts:285-290）。
- 触发即插件构造函数抛出 → cordis 装载失败。宿主 boot 是否被炸取决于 registry containment（未深究），但至少违反 plugin.ts:10-12「a missing host service skips its face with a log line and **never breaks boot**」对「宿主抛错」这一态的覆盖；S3 schema 子集若未来漂移过官方 assertSupportedJsonSchema，故障形态是插件消失而非「该面诚实跳过」。
- 修复建议：每面 register 包 try→warn（与 adapter 面的 continuation-catch 同构），声明改为「缺席/抛错双态都降级」。

### 1.4 [边界强化 HF-13] buildPiAiFace 可 throw，而 loadAdapterFaces 契约声称「never a throw」

- host.ts:244 `throw new TypeError('pi-ai root module is missing isContextOverflow')`；loadAdapterFaces 的 memoized IIFE（host.ts:399-409）无 try/catch → 返回 rejected promise。plugin.ts:488 的 await 处于 try 内 → boot 安全，但：(a) host.ts:397 注释「this is never a throw」失真；(b) rejected promise 被 `cached` **永久 memoized**；(c) 故障走通用 catch 的「adapter face registration failed」warn 而非专用「不可达」info，与 Z20 教训「fail-soft 报不可达先分解再下结论」的日志口径不一致。
- 修复建议：buildPiAiFace 对 isContextOverflow 缺失返回 undefined（与 face 缺席同径），或在 IIFE 内 catch 转 undefined。

### 1.5 adapter 三面加载器「半装配态」判定——设计成立，两处残留

- host.ts:399-409：host lib 与 pi-ai 面 all-or-nothing（任一 undefined → 整面 skip）；mapping 面**永不缺席**（官方源双模块齐全才用 official，否则整面 twins——host.ts:329-337 完整性检查 + wholesale 降级，杜绝混合 mapping 面）。plugin.ts:510-548：registerAdapter 成功后仅 directory 块可能失败且自含 try/catch（:530-548「adapter registration stands」）——无「注册了一半」的中间态。判定：部分装配态**不存在**（结论与卡面关切相反，为正面结论）。
- 残留一 = HF-13 的 throw 路径（见上）；残留二 = [覆盖盲区 HF-11]（§5）preflightMode 与 [边界强化 HF-12] providers violation 路径仍 push 部分 spec（providers.ts:243-253）——assert 路径有 throw 兜底，但 `resolveZctxProviders` 是公开导出（index.ts:164-168），直接消费者可拿到带无效 apiKeyEnv 原值的 spec（providers.ts:249）。

---

## 2. 审计点二：listener 生命周期与 dispose 泄漏面

### 2.1 注册/注销对称性——PASS（cordis fiber effect 保证）

- 双 listener（preflight plugin.ts:422 / observe plugin.ts:601）与 session feed 三监听（plugin.ts:288-307）都经 `ctx.on` 注册；官方 Event.register 把监听器存为 **当前 fiber 的 effect**（vendor/cordis/src/events.ts:246-256「Store a listener record as an effect on the current fiber」）→ 插件卸载/HMR 时随 fiber 自动注销。插件无自定义 stop 需求，对称性由宿主保证。
- OUTERMOST 顺序钉测在位：preflight 先注册=outermost（vendor/cordis/src/events.ts:221-236「Listeners run outermost-first」+ register 默认 push）；tests/plugin.spec.ts:441-442, 475-482, 544-570 三处钉。

### 2.2 泄漏面盘点——基本干净，一处覆盖缺口

- stateBySession：forgetSession 经 session/disposed 接线（plugin.ts:296-298 → observe.ts:452-454）；键=string sessionId，disposed 处理器同按 string id 删除——对齐。
- modelInfoCache（observe.ts:263 / preflight.ts:354）：双缓存均有 64 cap + 最老驱逐（observe.ts:427-431 / preflight.ts:538-541）——有界。
- warned 标志（plugin.ts:249 / observe.ts:265-267 / preflight.ts:356-357）：实例级布尔，随实例消亡——无泄漏。
- stores/windowCache/lastPressure：WeakMap 随 session 对象消亡（plugin.ts:233-235）；liveSessions 强引用 Set 由 session/disposed 修剪（plugin.ts:292-299）。
- [覆盖盲区 HF-09]（§5）：liveSessions 只增于 session/created——启动期已存在/恢复的会话不在 watched 集，三自动面全盲（工具面不受影响）。
- [边界强化 HF-03] adapter 注册**不**随插件卸载注销——见 §4.4。

---

## 3. 审计点三：enforce 短路的宿主交互与 failure.code 消费端路径

### 3.1 [正面结论 HF-14，证据化] 短路请求在官方计量面**零影子**

- 短路形态：enforce 命中时 preflight（outermost）不调 next()，只 yield 一个 `finish{kind:'error',failure:{code:'CONTEXT_WINDOW_EXCEEDED'}}`（preflight.ts:394-401 + buildPreflightErrorFinish:581-600）——官方 sanctioned（cordis waterfall「a listener that does not call next() vetoes the rest of the chain」vendor/cordis/src/events.ts:227-229）。
- 逐面核验：
  - adapterStream 永不运行（llm/src/index.ts:1158-1168 waterfall 包裹 adapterStream）→ 无 wire 请求 → attribution 无请求可附 → 正确（短路请求无 wire 义务）。
  - usage chunk 不存在 → S6/usage 台账零写入；agent-loop 仅在 finish error 时派发 agent/request-error（agent-loop/src/agent.ts:454, 511-530）。
  - token-meter：measure(session) 是 surface 计量（token-meter/src/index.ts），短路请求不产消息 → 无计量面影响。
  - llm-retry：CONTEXT_WINDOW_EXCEEDED 不在默认 retryableCodes（zDSH-main llm/src/retry-policy.ts:19-25：EMPTY_RESPONSE/RATE_LIMIT/SERVER/TIMEOUT/TRANSPORT）→ 非重试码放行（llm-retry/src/index.ts:215）。
  - compaction-basic：`failure.code !== CONTEXT_WINDOW_EXCEEDED_CODE || signal.aborted → next()`（compaction-basic/src/index.ts:194，RES [B1] rc.3 零漂移）→ 命中即 compactIfNeeded+retry——官方恢复链接管。
  - rc.3 计量/压缩消费面：[S1] rc.2→rc.3 消费面 src 零变更（RES-official-drift.md §1/§12）→ 本结论在 rc.3 依然成立。

### 3.2 [边界强化 HF-06] enforce × 用户自定义 retryableCodes 的未声明交互

- rc.2 起 retryableCodes 用户可配置（retry-policy.ts:90 schema default + rc.2 notes L52/140）。若用户把 CONTEXT_WINDOW_EXCEEDED 加入 retryableCodes，llm-retry 会对短路 finish error 重试**同一仍超限请求** → 最多 maxRetries（默认 5）次「估算→短路」循环；与 compaction 恢复的接管顺序取决于 agent/request-error 监听器注册顺序（本仓不可控）。有界、无死循环，但浪费且未在文档声明。
- 附：短路消耗 compaction 的 maxOverflowRetries 预算一次（compaction-basic:194→200）——F6.4 已声明误报代价的组成部分，建议在 preflight.ts 模块文档与 README enforce 段补两句：①消耗一次 overflow-retry 预算；②与自定义 retryableCodes 的交互。

### 3.3 failure.code 消费端形态核验——PASS

- 短路 chunk 的 failure 为纯对象 {message, code}，与官方 LlmFailure 形状一致（llm/src/types.ts:41-62，status/requestId 可选）；消费端是**字符串相等判定**（compaction-basic:194），不经 LlmError 构造 → 不受 rc.3 收窄影响。code 拼写钉死：PREFLIGHT_CONTEXT_WINDOW_EXCEEDED_CODE（preflight.ts:97）+ 常量值 rc.3 不变（RES [L7]）。

### 3.4 [边界强化 HF-03] adapter 注册生命周期：插件卸载不注销路由

- 官方 registerAdapter 的 effect 挂在 **llm 服务自己的 fiber**（llm/src/index.ts:407-416 `this.ctx.effect(..., 'llm.registerAdapter()')`，this=LlmRuntime），非调用插件 fiber；ZcontextPlugin 无 stop/dispose。后果：插件卸载后旧 adapter 继续持有 `zctx-<family>` 路由（wireSink 指向死实例的 liveSessions——resolveWatchedSession 恒 miss → wire 台账静默停记，但流仍由**旧配置 adapter** 服务）；HMR/重载的新实例 registerAdapter 撞 DUPLICATE_ADAPTER → 整面 warn 跳过（plugin.ts:549-553），providers 配置变更在宿主重启前不生效。
- 修复建议：README 明示「adapter 面不支持热重载，改 providers 需重启」；中期可用 registration.replace（F1.4/F4.5 llm-pi-ai 先例）在配置变化时原子换路由。

---

## 4. 审计点四：工具面 fail-soft 完备性

### 4.1 [边界强化 HF-04] 「nothing throws across the host boundary」声明与实现不符

- tools.ts:24-26 与 command.ts:5-6 声明 execute 全 fail-soft，但：renderStatus 的 storeFor（tools.ts:573）、fold/unfold/recall execute 的 storeFor（tools.ts:911/929/963）、command 的 storeFor+fold/unfold（command.ts:73-74, 83-88）均无 try 包裹。storeFor→attach→scanUpTo 依赖宿主 session 形态：`session.eventAt?.(seq)` 抛错（store.ts:890）或 `session.surface?.nodes` 不可迭代（store.ts:674-686 `[...liveNodes]`）时 throw 跨边界。官方工具执行器会把 execute throw 转成失败工具结果（不炸宿主），但用户看到内部 TypeError 文案而非 texts.ts 诚实文案——fail-soft 的「用户可见错误文案 vs 静默」目标半失守。
- 另：四工具与 command 的 session 判空只查 `=== undefined`（tools.ts:907/927/961/998、command.ts:60-62）——`exec.agent.session = null` 时穿透到 storeFor(null) → attach(null) 在 scanUpTo `sessionSeq(null)`（store.ts:1372-1375 返 0，幸免）但后续 session.surface 读取抛 TypeError。判空建议 `== null`。
- /zctx command handler 无整体 try/catch：renderStatus/抛错 → 官方 command 执行器 containment 行为未核（诚实标注）——建议 handler 顶层 try→{kind:'error'}。

### 4.2 abort 信号语义——PASS（一处未接）

- 工具引擎路径为同步 fold/unfold，无 abort 窗口；zctx_status 的 resolveModelInfo 未传 exec.signal（tools.ts:586，官方签名支持 signal? llm/src/index.ts:281）——仅浪费一次解析，无正确性问题。S8 互斥：四工具均无 isConcurrencySafe（tools.ts:146-148 NOTE + 定义不含该键）→ 官方 exclusive barrier 生效（RES [T2] rc.3 语义未漂移）。

### 4.3 [低危边界注记] observe 零 usage 捕获与 twins 的 parity 分歧

- mapUsageTwins 对 undefined usage 返全零（map.ts:114-116）；官方 mapUsage 类型上假定 usage 必在、undefined 即 TypeError（zDSH-main llm-pi-ai/src/stream.ts:23-31）。pi-ai error 事件缺 usage 时：官方会抛（被 adapter catch 分类），twins 产出 {0,0,0} usage chunk（map.ts:334）→ observe captureWrap 记零样本 capture（observe.ts:497-514）。preflight 校准统计有 billed<=0 守卫（tools.ts:546-547）不受污染。属 twins 与官方的语义分歧（更宽容），建议在 map.ts docstring 登记该分歧（诚实标注纪律）。

---

## 5. 覆盖盲区

### 5.1 [覆盖盲区 HF-09] 启动前已存在的会话对三个自动面永久失明

- liveSessions 仅由 session/created 事件增长（plugin.ts:288-291），构造器无既有会话枚举。会话在插件装载前 announce（恢复工作区/引导期）→ resolveWatchedSession 恒 miss（plugin.ts:613-619）→ observe/preflight/wire 三面全盲；nudge 的 currentSession 回退同样为空（plugin.ts:713-718）。宿主 announce-once 守卫（core/session/src/index.ts:1265-1268「already announced」）表明每 Session 条目只发一次 created。工具面不受影响（exec.agent.session 直达）。
- 未验证项（如实标注）：宿主对恢复会话是否补发 session/created、补发时机是否晚于插件装载（core/session announce 与插件装载的 boot 时序未实测）。置信度：插件侧机制直证；宿主侧时序未证。
- 建议：探针实测 boot 时序；或对 session/event 做惰性 watching 兜底（收到未 watch 会话事件时按需纳入）。

### 5.2 [覆盖盲区 HF-10] /zctx status 不渲染 adapter 面健康

- adapterRegistration 公开字段（plugin.ts:248）供测试/状态用，但 renderStatus（tools.ts:570-869）无 adapter 段——用户无法从状态面看到路由注册结果/DUPLICATE 拒绝/配置违规跳过/mapping source。建议补一段（routes + mapping source + registration settled 状态）。

### 5.3 [覆盖盲区 HF-11] preflightMode 非法值静默按 observe 行为

- config.ts:172 schema 为裸 string（非 'off'|'observe'|'enforce' union；fail-soft shim 同 type:'string'，config.ts:263）→ 拼写错误（如 'enforcae'）通过校验；plugin.ts:386-390 gate 只判 'off'；PreflightListener 按 `mode === 'enforce'` 判定（preflight.ts:397）→ 其余一切值按 observe 跑，唯一线索是 status 面原样显示（tools.ts:834）。resolveMarginRatio 对非法 margin 有 warn-once（preflight.ts:338-345）——mode 无对称 warn。建议：非三合法值在 wirePreflightFace warn 一次。

### 5.4 [覆盖盲区 HF-12] providers 校验的两处锋利边

- violation 路径仍 push 部分 spec（providers.ts:243-253，含无效 apiKeyEnv 原值 :249）——assert 路径兜住，公开导出路径不设防（§1.5）。
- reasoningEfforts 值域零校验（providers.ts:193 直传；materializePiModel:189-192 据此造 thinkingLevelMap）——非 string 值/非 pi-ai 合法 level（'off'…'max'，zctx-adapter.ts:130 THINKING_LEVEL_ORDER）会流到请求期才暴露；schema 层 z.dict(z.string())（config.ts:297）只键值均为 string，且与 TS 类型 `| false`（providers.ts:69）存在形态分歧——`reasoningEfforts: false` 过不了 schemastery 门。建议：构造期校验值域并在 violation 清单中报告。

---

## 6. rc.3 适配项逐项判定（卡点⑥）

### 6.1 LlmError code 收窄 → **无需适配**（置信度：高，双源直证）

- rc.3 LlmError 构造器运行时仅校验 message/code 非空字符串，**无** LLM_FAILURE_CODES membership 校验（rc3-src packages/llm/llm/src/index.ts:107-129；fromFailure 注释自证「the built-in type constrains only codes raised here」:144-146）。
- zctx 全部 19 个码逐一在 rc.3 LLM_FAILURE_CODES 表内（rc3-src error.ts:16-65）：ABORTED/AUTH/CONTEXT_WINDOW_EXCEEDED/EMPTY_RESPONSE/INVALID_REQUEST/INVALID_REPLAY_STATE/MISSING_CREDENTIAL/NO_ADAPTER/PI_AI_ERROR/QUOTA/RATE_LIMIT/SERVER/STREAM_CLOSED/TIMEOUT/TRANSPORT/UNKNOWN_MODEL/UNSUPPORTED_CONTENT/UNSUPPORTED_OPTION/UNSUPPORTED_REASONING_EFFORT——全命中。
- 编译面：zctx 经结构性 `host.LlmError`（host.ts:51 自有类型）构造，不 import 官方 TS 类型 → 收窄不传导。
- 附注：STREAM_CLOSED 在 rc.3 成为 retryChoice（error.ts:61）但默认 retryableCodes 不含它（rc3-src retry-policy.ts:19-25 与 fork 逐字同表）→ 无动作。

### 6.2 assemble→PromptPresentation → **无需适配**（置信度：中高）

- zctx nudge provider 只读 assembly.agent?.session / scope?.session（plugin.ts:107-114, 736-743），不触 tools；RES [P1] 的 waterfall 类型变化是「tools 移出 waterfall」——text provider 的 AssembleContext 构造点（agent/src/dispatch.ts:174 assembleContextFor）不在 rc.3 消费面漂移清单（[S1] 消费面 src 零变更）。AssembleContextLike 全可选结构（plugin.ts:107-114）对形状漂移稳健。

### 6.3 imageRequestTarget 第 8 成员 → **无需适配（继承默认实现）**；与 HF-01 并立

- rc.3 LlmAdapter 8 成员化带默认实现（rc3-src index.ts:263-267「preserves normalized images」）；ZctxAdapter 不覆写 → 运行面继承默认；插件侧 ZctxAdapterFace 为独立结构接口（zctx-adapter.ts:100-107）+ duck-type 注册 → 无编译/运行破坏。
- 与 HF-01 的关系：默认实现「保留图片」+ 官方投影先行（inputModalities=['text']）→ 图片走占位路径——「无需适配」指接口面；行为面仍按 HF-01 处置。

### 6.4 其余 rc 项扫描（宿主面视角）——零命中

- [S8] slots/dispatch 移除：zctx 未监听（RES §12 U5 已检索未发现，本审计复核一致）。
- [S4/S5] append 批量/时序：zctx 不包装 Session.append（折叠走 surface-replace 通道）。
- [T4] 工具错误类细分（TOOL_ACTIVATION_FAILED）：zctx 工具只产字符串结果，不按错误类分支。
- [C4] LogLevel 数值互换：zctx 不用数值序（只调 logger.warn/info）。

---

## 7. R1-R8 宿主面最终核对表（卡点⑤）

| 红线 | 判定 | 证据（file:line） |
|---|---|---|
| R1 adapter 零 body 改写 | PASS | wire.ts:83-96 onPayload 恒返 undefined；wire.ts:97-111 fetch 只哈希后原样转发 `globalThis.fetch(input, init)`；zctx-adapter 全文无 payload 替换路径 |
| R2 enforce 默认关 | PASS | config.ts:146 默认 observe；plugin.ts:386-390 gate；钉测 tests/preflight.spec.ts:118、tests/plugin.spec.ts:547、tests/smoke.spec.ts:78 |
| R3 禁 ctx.llm.stream 自调 | PASS | PreflightDeps 结构性无 llm 运行时（preflight.ts:123-151 仅三 helper）；ZctxAdapterDeps 无 llm 成员（zctx-adapter.ts:110-124），adapter 直驱 pi-ai（:396/:437） |
| R4 SDK maxRetries=0 | PASS | zctx-adapter.ts:457 `maxRetries: 0`；providerRetryPolicy 返 undefined 走官方默认策略（:296-298） |
| R5 命名空间 zctx- | PASS | providers.ts:106-108 route=zctx-<family>；family=协议单源（host.ts:222-239 loadSupportedProtocols 动态 union）；V5-2 maxTokens 必填（providers.ts:180-187）；V5-3 空默认三处一致（config.ts:150/180 + smoke 钉） |
| R6 仅 HTTP(SSE) | PASS | providers.ts:200-208 ws/wss 显式 violation；非 http(s) violation；协议不可达运行时 UNSUPPORTED_OPTION（zctx-adapter.ts:397-402） |
| R7 attributionHeaders 上 wire | PASS | wire.ts:129-141 大小写不敏感归并 attribution 胜出；zctx-adapter.ts:453 headers 恒携带（无 wireFaces 时 requestHeaders(undefined, host) 兜底） |
| R8 pi-ai 1.0.2 锚点 | PASS（结构性） | adapter 不依赖行号锚点：PiAiFace typeof 探针（host.ts:241-262）+ loadApi 运行时解析（host.ts:248-260）；onPayload/fetch 为 pi-ai 公开选项（RES F7.1/F7.2）；ZCTX_PIAI/ZCTX_DSH_LLM override 支持重验（host.ts:191-196/264-294）；1.3.0 的 onPayload 429→442 行号漂移不触 options 透传形态。残留：isContextOverflow 缺失走 HF-13 throw 路径（非干净 skip） |

---

## 8. 发现汇总与分级

| ID | 级别 | 位置 | 一句话 |
|---|---|---|---|
| HF-01 | 真缺陷 | src/adapter/zctx-adapter.ts:263+362-370 | inputModalities 恒 ['text'] 使官方投影先吞图片，UNSUPPORTED_CONTENT 拒图门在官方路径不可达——图片静默降级为占位文本，违反声明的诚实拒绝边界 |
| HF-02 | 真缺陷 | src/plugin.ts:224 | inject 六键含未读键 'sessions'——零消费硬依赖，服务缺席即整插件静默 PENDING（Z21 症状），与 P0 read-verified 纪律不一致 |
| HF-03 | 边界强化 | src/plugin.ts:549-553 + llm/src/index.ts:407-416 | adapter 注册挂 llm fiber，插件卸载不注销；HMR 撞 DUPLICATE_ADAPTER 后旧 adapter 带死引用继续服务、配置变更需重启 |
| HF-04 | 边界强化 | src/tools.ts:573/907-1000、src/command.ts:51-97 | 工具/command 的 storeFor 无 try 包裹 + session 判空漏 null——「never throws」声明与实现不符，病态宿主形态下跨边界抛内部文案 |
| HF-05 | 边界强化 | src/plugin.ts:300-307 | session/event handler 裸读 event.type（store.onEvent 内有守卫但外层没有）；宿主 per-listener containment 兜底（core/session/src/index.ts:401-413），仅日志噪音风险 |
| HF-06 | 边界强化 | src/preflight.ts:394-401 | enforce 短路与用户自定义 retryableCodes 交互未声明；短路消耗一次 maxOverflowRetries 预算未写入 F6.4 代价清单 |
| HF-07 | 边界强化 | src/adapter/map.ts:114-116/334 | twins 对 undefined usage 返零 vs 官方 mapUsage throw——parity 分歧未在 docstring 登记；下游守卫在位故低危 |
| HF-08 | 边界强化 | src/adapter/zctx-adapter.ts:341-370 | options.messages 未验 Array.isArray 即 .some（try 外）→ 病态入参抛裸 TypeError 归 UNKNOWN 而非 INVALID_REQUEST |
| HF-09 | 覆盖盲区 | src/plugin.ts:288-291/613-619 | liveSessions 仅增于 session/created——启动前已存在/恢复会话对 observe/preflight/wire 三面永久失明（宿主补发时序未证） |
| HF-10 | 覆盖盲区 | src/tools.ts:570-869 | /zctx status 无 adapter 面健康段（注册结果/DUPLICATE/违规跳过/mapping source 不可见） |
| HF-11 | 覆盖盲区 | src/config.ts:172/309 + plugin.ts:386-390 | preflightMode 非法值静默按 observe 跑，无 warn-once（margin 有、mode 无，不对称） |
| HF-12 | 覆盖盲区 | src/adapter/providers.ts:193/243-253 | reasoningEfforts 值域零校验；violation 路径仍 push 部分 spec（公开导出路径不设防） |
| HF-13 | 边界强化 | src/adapter/host.ts:244/399-409 | buildPiAiFace throw vs「never a throw」契约失真；rejected promise 永久 memoized；错误日志走通用 catch 偏离 Z20 口径 |
| HF-14 | 边界强化（正面结论存证） | src/preflight.ts + 官方源 | enforce 短路官方计量面零影子（waterfall veto + 无 usage + 非重试码 + compaction 字符串相等判定）——核验通过，作为证据存档 |
| HF-15 | 边界强化 | src/plugin.ts:319/330/340-358/269 | 同步五面 register 裸调无抛错态兜底；官方 tools.register 多条 throw 路径（tools/src/index.ts:1069-1093），触发即插件装载失败，与「never breaks boot」声明不符 |

（HF-14 为核验通过的正面结论存证，不计数于缺陷；分级统计以 2/8/4 口径对外。）

## 9. 建议处置优先级

1. **P2（随下一波修）**：HF-01（行为/契约对齐 + 可观察性）、HF-02（移除或正当化 'sessions' inject）、HF-04（execute try 包裹 + null 判空）。
2. **P3（文档/钉测级）**：HF-03/06/13（README+docstring 声明对齐）、HF-11（mode warn-once）、HF-12（值域校验）、HF-15（per-face try）。
3. **探针验证项**：HF-09（boot 时序实测后定是否需要惰性 watching）；HF-10（status 增段随下波）。

## 10. 审计方法自述与置信度

- 插件侧结论全部来自实读 file:line；官方侧结论全部回溯 zDSH-main 源文件行号（llm/src/index.ts、content.ts、retry-policy.ts、tools/src/index.ts、core/session/src/index.ts、vendor/cordis/src/events.ts、agent-loop/src/agent.ts、llm-pi-ai/src/stream.ts）；rc.3 侧经 ref/official-rc3/rc3-src 实读（error.ts/index.ts/retry-policy.ts）与 RES-official-drift.md 交叉。
- 未解决（如实）：①宿主 boot 期恢复会话的 announce 时序（HF-09 宿主侧）；②cordis 插件构造抛错时的 registry containment 行为（HF-15 严重度上界）；③/命令 handler 抛错时的官方 command 执行器 containment（HF-04 附注）；④captureLog 零样本对 store usageSnapshot 口径的精确影响（HF-07 下游）——四项均不影响上述分级结论。
- 与 D1 边界：store.ts 状态机内部（applyEvent 幂等/畸形 source 等）归 AUD-state-machines.md；本报告仅在「宿主面调用 store 的异常边界」处引用其端口签名。

（完 · 供 verifier 复核承重主张：HF-01 证据链 1→4、HF-02 零读 grep、HF-14 官方计量面五点核验、§6.1 全码表命中、§7 R1-R8 全行。）
