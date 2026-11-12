# W3+W4 任务卡：引擎与接线

> 前置：W2 合入。W3=引擎两件，W4=接线三件（同卡分两波，各自小提交）。

## W3 产物

1. `src/store.ts` + `tests/store.spec.ts`
   - `FoldStore`: attach(session) 后扫描重建 foldMap（遍历 session 事件/事件访问器：user/message 且 message.source.kind==='zctx-fold' → 活跃 fold 记录{foldId,startSeq,endSeq,checkpointSeq,shadowedSeqs,stats}；'zctx-unfold' → 标记 unfold；任何 surface replace 遮蔽 checkpoint（sourceEventSeqs 含 checkpointSeq，包括官方 compaction 的 checkpoint）→ absorbed/dead）
   - 订阅 session 事件增量维护（'session/event' 回调注入，不直接依赖 cordis）
   - 提供 surfaceNodes() 视图（seq/type/role/estimatedTokens/isUser/firstUser/lastUser/tool 配对表）
2. `src/fold-engine.ts` + `tests/fold-engine.spec.ts`
   - `fold(sessionLike, store, plan)`：校验（复用 W2 validator，foldMap 取自 store）→ compaction 互斥检查（扫描未闭合 compaction/start）→ surface 稳定性快照（contentGeneration）→ 逐 fold 提交 session.append('user/message', {turn?, message:{content:[{type:'text',text}], source:{kind:'zctx-fold', foldId, startSeq, endSeq, shadowedSeqs, stats}}}, {surfaceOp:{op:'replace',startSeq,endSeq}, sourceEventSeqs:[...shadowedSeqs]}) → 提交后 replaceGeneration/contentGeneration 校验，不符→告警+台账记 anomaly（不抛，如实报告）
   - `unfold(sessionLike, store, foldId)`：validator 检查 checkpoint 仍在 surface → materializeRange 取回文本 → 1:1 replace checkpoint 节点（source.kind='zctx-unfold' 引用 foldId+原 shadowedSeqs）
   - mock session：内存实现 surface.nodes 维护（append replace 语义：删区间+插新节点）、eventAt、事件广播——**用官方 validateNext 同款语义的最小实现**
   - 全路径测试：成功折叠/净缩拒收/保护区拒收/配对断裂拒收/嵌套吸收/unfold 再折/compaction 活跃拒收/并发稳定性失配告警

## W4 产物

1. `src/tools.ts`：4 工具注册（defineTool 形态对齐官方 ToolDefinition：name/description/parameters/output.schema+render/execute）：
   - `zctx_fold`：args={summaries:[{startSeq,endSeq,text}]}（开放对象无顶层 required 组合子）；execute 内 exec.agent?.session 不可达→fail-soft 报错文案；调用 engine；**回执=tool result 原生承载**（result 文本含 "Folded seqs a–b, ~N tokens reclaimed" 或拒收 reasons——杜绝模型伪造标记的文本通道）
   - `zctx_unfold`：args={foldId?|latest?}；execute 同上
   - `zctx_recall`：args={query, limit?}；execute 组 corpus（store 摘要+eventAt 原文）→ W2 search
   - `zctx_status`：无参；execute=官方 tokenMeter.measure（能力探测：无 tokenMeter→诚实告警"estimates unavailable"）+budget 表+区间图（PROTECTED 标注）+台账+budget 时报 rMin/触发线
2. `src/plugin.ts`：
   - `export class ZcontextPlugin extends Service`（cordis peer 类型）static inject=[]、static Config=schemastery z.object（全 primitive，plan §3 字段；schemastery lazy require fail-soft：不可用→默认 config+logger.warn）
   - constructor：enabled=false→不注册任何面（纯 no-op+日志）；否则注册 tools+systemPrompt.section(guidance)+systemPrompt.context(nudge 阈值跨越投影)+commands.register('/zctx')+session 事件订阅建 store
   - **能力探测降级**（AutoPilot probes 模式）：ctx.tools/systemPrompt/commands/tokenMeter 任一缺失→跳过对应面+日志，不炸 boot
   - `export const name='dsh-zcontext'`；default export=类
3. `src/command.ts`：`/zctx`（status|fold|unfold 子命令，无参=status）
4. nudge 投影接线：refreshContext 由官方调用（我们只注册 context() 回调）；回调内取当前 pressure→crossedThresholds 判定→变化时返回渲染文本（稳定期返回上次文本=no-op）

## 验收

- W3/W4 各一小提交；vitest 全绿；tsc 零错；build 绿
- 探针：node -e "import('./lib/index.js')" 后断言 default 类/name/Config 存在（Z7 同款命名导出探针）
- 验证 mock 会话全路径测试覆盖 plan §4 全部风险行

## 约束

- 宿主面全部结构类型；schemastery/cordis 只类型引用+lazy require
- 不 patch globalThis.fetch；不碰 agent/request；不改 compaction 行
- 任何 append 失败 fail-soft（工具回执报错文案），永不炸宿主 boot
