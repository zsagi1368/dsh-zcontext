# W3+W4 任务卡：引擎与接线

> 前置：W2 合入。W3=引擎两件，W4=接线三件（同卡分两波，各自小提交）。
> **方案门修订落卡**：W3 测试=真实 dsh-session 优先（S5）；source payload 最小形态（S4）；unfold 单节点（B1）；usage 账本（S6）；W4=defineTool 全套+content:string（S3）、nudge required:true（B2）、无 isConcurrencySafe（S8）。

## W3 产物

1. `src/store.ts` + `tests/store.spec.ts`
   - `FoldStore`: attach(session) 后扫描重建 foldMap（user/message 且 message.source.kind==='zctx-fold' → 活跃 fold 记录{foldId, checkpointSeq, startSeq/endSeq(自事件信封 surfaceOp), shadowedSeqs(自 sourceEventSeqs), tokensBefore/After(自 source)}；'zctx-unfold' → 标记 unfolded；任何 surface replace 遮蔽 checkpoint（sourceEventSeqs 含 checkpointSeq，包括官方 compaction 的 checkpoint）→ absorbed/dead）
   - **usage 账本（S6）**：监听 assistant/message 事件的 usage（cacheReadTokens/cacheWriteTokens 可选字段）→ 每会话 cache 样本；缺 usage→估算态打标
   - 订阅 session 事件增量维护（'session/event' 回调注入，不直接依赖 cordis）
   - 提供 surfaceNodes() 视图（seq/type/role/estimatedTokens/isUser/firstUser/lastUser/tool 配对表）
2. `src/fold-engine.ts` + `tests/fold-engine.spec.ts`
   - `fold(sessionLike, store, plan)`：校验（复用 W2 validator，foldMap 取自 store）→ compaction 互斥检查（扫描未闭合 compaction/start）→ surface 稳定性快照（contentGeneration）→ 逐 fold 提交 session.append('user/message', {turn?, message:{content:[{type:'text',text:summary}], source:{kind:'zctx-fold', foldId, tokensBefore, tokensAfter}}}, {surfaceOp:{op:'replace',startSeq,endSeq}, sourceEventSeqs:[...shadowedSeqs]}) → 提交后 replaceGeneration/contentGeneration 校验，不符→告警+台账记 anomaly（不抛，如实报告）
   - `unfold(sessionLike, store, foldId)`（**B1 单节点形态**）：validator 检查 checkpoint 仍在 surface → W2 materializeRange 取回**多 text-block 数组** → replace checkpoint 为单个 user/message（content=blocks 数组，source.kind='zctx-unfold' 引用 foldId）
   - **测试双模式（S5）**：优先真实 `@deepseek-ai/dsh-session`（zDSH-main node_modules 已构建；vitest alias 解析，缺则 SKIPPED+明示）；mock 模式必须对齐官方四条硬校验（sourceEventSeqs 与实际遮蔽面完全一致、surface 节点成员、node-0 禁覆盖、tool-result 护栏）+官方 foldSurface 重放 fixture 对拍
   - 全路径测试：成功折叠/净缩拒收/保护区拒收/配对断裂拒收/node-0 预检/嵌套吸收/unfold 单节点形态/再折/compaction 活跃拒收/稳定性失配告警/usage 缺省降级

## W4 产物

1. `src/tools.ts`：4 工具注册——**全部经 defineTool 包装**（裸 register 无 args 校验，S3）；schema 官方强制子集（禁顶层组合子）：
   - `zctx_fold`：args={content: string(required)}——单字符串承载全部区间+摘要（`mNNNNN` 或 seq 区间头行+markdown 摘要，billion-context 已验证形态）+**自研宽容解析器**（对齐 parseCompressInput 语义、实现自研）；execute 内 exec.agent?.session 不可达→fail-soft 报错文案；调用 engine；**回执=tool result 原生承载**（"Folded seqs a–b, ~N tokens reclaimed" 或拒收 reasons）
   - `zctx_unfold`：args={foldId?: string, latest?: boolean}；execute 同上（单节点重物化回执）
   - `zctx_recall`：args={query: string(required), limit?: number}；execute 组 corpus（store 摘要+eventAt 原文）→ W2 search
   - `zctx_status`：无参；execute=官方 tokenMeter.measure（能力探测：无 tokenMeter→诚实告警"estimates unavailable"）+budget 表+固定 wire 开销行+区间图（PROTECTED 标注）+台账+cache 对账（实测/估算两态，S6）
   - **四工具均不声明 isConcurrencySafe（S8——exclusive barrier 是互斥正确性前提）**
2. `src/plugin.ts`：
   - `export class ZcontextPlugin extends Service`（cordis peer 类型）static inject=[]、static Config=schemastery z.object（全 primitive，plan §3 字段；schemastery lazy require fail-soft：不可用→默认 config+logger.warn）
   - constructor：enabled=false→不注册任何面（纯 no-op+日志）；否则注册 tools+systemPrompt.section(guidance)+systemPrompt.context(**required: true**, nudge 阈值跨越投影)+commands.register('/zctx')+session 事件订阅建 store
   - **能力探测降级**（AutoPilot probes 模式）：ctx.tools/systemPrompt/commands/tokenMeter 任一缺失→跳过对应面+日志，不炸 boot
   - `export const name='dsh-zcontext'`；default export=类
3. `src/command.ts`：`/zctx`（status|fold|unfold 子命令，无参=status）
4. nudge 投影接线：refreshContext 由官方调用（我们只注册 context() 回调，**带 required:true**）；回调内取当前 pressure→crossedThresholds 判定→变化时返回渲染文本（稳定期返回上次文本=no-op）；**抑制态单测**（includeRuntimeContext=false 模拟 suppress 后 nudge 贡献仍在 assemble 输出，B2）

## 验收

- W3/W4 各一小提交；vitest 全绿；tsc 零错；build 绿
- 探针：node -e "import('./lib/index.js')" 后断言 default 类/name/Config 存在（Z7 同款命名导出探针）
- 验证 mock 会话全路径测试覆盖 plan §4 全部风险行

## 约束

- 宿主面全部结构类型；schemastery/cordis 只类型引用+lazy require
- 不 patch globalThis.fetch；不碰 agent/request；不改 compaction 行
- 任何 append 失败 fail-soft（工具回执报错文案），永不炸宿主 boot
