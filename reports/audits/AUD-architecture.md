# AUD-architecture — dsh-zcontext 全树架构审计（CARD-AUD-C）

- 审计对象：G:\000Github\zDSH\zDSH-plugins\dsh-zcontext（11 波累积后整树，非逐波 diff）
- 审计人：architect（AUD-C 执行者）；日期：2026-11-14；基线 commit：391990f
- 方法：src 28 文件全量通读（11,418 行）+ 全树 import 图程序化提取 + 447 个导出符号全词边界枚举（临时脚本 C:\Users\ZS\AppData\Local\Temp\zctx-audit\orphan-check.cjs，只读）+ README/CHANGELOG/README.zh 三方对照 + tests 22 spec（442 用例）抽验
- 查册命中（~/.agents/rsi/INDEX.md）：A43（grep 路径形态）、B13（0 命中不作「原文无」结论——孤儿扫描因此改全量枚举，第一版 \b 转义被 bash 吃掉导致 447 全误报 0 已当场废弃）、Z17（lib 产物检查）、Z10（断言 fail-open 警惕）、W4（结论强度≤证据强度）
- 主线已亲审三条关键流（fold/unfold/preflight/adapter 管线），本报告为全树横切视角，与主线结论不重复

---

## 1. 跨波契约一致性 —【良好】

**结论**：W→V→P0 三段累积后，早期公开契约无一被无声破坏；README/CHANGELOG 声明与代码实态逐点相符。

抽查 6 处（超过卡面要求的 5 处）：

1. **v1 九字段默认值**：CHANGELOG 0.1.0「Nine-field settings page」所列九键默认值与 config.ts:131-151 `configDefaults` 逐键一致（enabled=true / nudgeThresholds="25,50,75,90" / keepRecentTokens=0 / maxFoldFraction=0.6 / minFoldableTokens=5000 / protectionFloorTokens=5000 / summaryFloorChars=50 / summaryCeilingChars=20000 / netShrinkTolerance=1.05）。
2. **checkpoint source 形态**：README.md:36 声明 `message.source` 携带 `kind: 'zctx-fold'|'zctx-unfold'`；实现 fold-engine.ts:312-317（fold）与 :458-463（unfold）提交的正是该 shape；store 侧 extractCheckpointSource（store.ts:278-297）按同形读取。P0 波未触碰该形态。
3. **工具 schema**：CHANGELOG 0.1.0「one required content: string」= tools.ts:896-902（zctx_fold 单参数 required）；S8 无 isConcurrencySafe（tools.ts:146-148 显式 NOTE）与 README.md:5/CHANGELOG 一致。
4. **index 导出面**：lib/index.d.ts 导出 126 项 = src/index.ts 126 项，双向零差（本审计程序化比对；scripts/probe-artifact.mjs:383-448 P6 与 scripts/verify-activation-surface.mjs:297+ A10 两组探针常态化钉同一事实）。W3 的 UsageSample 在 V1 搬家 types.ts 后经 store.ts:96-99 re-export 保持公开面不变。
5. **required:true**：CHANGELOG 0.1.0 nudge 声明 = plugin.ts:345 `required: true`（配 :344 interpolate:false）。
6. **providers 结构化段**：CHANGELOG 0.2.0「REQUIRED contextWindow+maxTokens」= providers.ts:173-187 双构造期门（缺任一即 violation，无发明默认值）= zctx-adapter.ts:203-206 逐字传递。

P0 inject 契约（v0.2.1）：plugin.ts:224 `static inject = ['tools','systemPrompt','commands','llm','tokenMeter','sessions']` 六键逐一经实读提供方声明钉名（plugin.ts:206-223 注释带官方 file:line），tests/helpers/mock-host.ts 纪律化 mock 使「未声明即 throw」可测（plugin.spec.ts:29、adapter-plugin.spec.ts:63）。

## 2. 模块依赖方向 —【良好】

**结论**：分层单向、零环；纯核心零宿主依赖成立；五个宿主面全部 fail-soft 可选导入。

依赖图（程序化提取全部 `from '...'` 边）：

- **纯核心零宿主**：texts→∅；types→∅；hash→node:crypto；budget→{types,texts}；validator→{budget,texts,types}；materialize→{texts,types}；search→{texts,types}；attribution→{budget,types}。八模块无一触宿主面。
- **引擎层**：fold-engine→{budget,materialize,texts,validator,types,store}；store→{attribution,budget,config,types}。store.ts:73 引 config.ts（值导入 configDefaults）是引擎层唯一触宿主配置模块的边——config.ts 自身 fail-soft（config.ts:220-237 懒 require schemastery，缺宿主返回 undefined），无加载风险；且运行期真正阈值经注入更新（plugin.ts:633 setAttributionTimeWindowMs、:634 setMeterAnchor），configDefaults 只是 attach 前初值（store.ts:568）。记【注意-软】于 §4/健康度，非违规。
- **宿主面五个 fail-soft 口**：config.ts（schemastery，:231-237）、plugin.ts（cordis Service，:172-179 + StructuralServiceShim :160-167）、tools.ts（dsh-tools defineTool，:173-180 + shim :188+）、host-llm.ts（dsh-llm projector，:322-333 双路径 + projector 标签 :70-89）、adapter/host.ts（dsh-llm/pi-ai/llm-pi-ai 三面，:149-155 importOptional 全量 try/catch→undefined）。无一静态 import 宿主包；「宿主不可达→面跳过+诚实日志、boot 不炸」在 plugin.ts 六个 wire* 方法逐一落实（如 :454-456 空 providers→info、:489-492 faces undefined→info）。
- **adapter→src 方向**：wire.ts:34-35 只向下引 ../hash.ts + ../types.ts（类型+纯函数）；config.ts:18 反向引 adapter/providers.ts 仅为 type-only（编译期擦除，运行时零边）。
- **环检测**：所有边终止于叶子 {texts,types,hash,map,providers}，无环。host.ts:335-337 对 twins.ts 用动态 import 保持图无环（twins→host 本就是 type-only，此写法额外推迟 twins 加载成本，双保险成立）。
- **反向依赖/穿透**：未发现任何 core→host、adapter→plugin、engine→tools 的边。

Z20 修复纪律在位：host.ts:134-136 fileURLToPath（带注释禁 url.pathname）、:297-305 statSync().isDirectory() 目录判形。

## 3. 死代码与孤儿导出 —【良好】

**结论**：447 个导出符号全量枚举，0 个死运行时代码；13 个零跨模块消费符号中 12 个为「文件内自用但标了 export」的类型（过度导出），唯一真孤儿是一个别名常量。

- **lib 产物一致性**：src/index.ts 126 导出 = lib/index.d.ts 126 导出（含类型全等，比对脚本归一化 `type ` 前缀后 src-only/lib-only 均为空集）。
- **唯一真孤儿**：guidance.ts:69 `GUIDANCE_TITLE = GUIDANCE_SECTION_TITLE` 别名导出，全仓（src+tests+scripts+docs）零消费、文件内亦零消费。【注意-微】建议删除或私有化。
- **12 个过度导出类型**（均在本文件内使用，属 export 关键字过宽而非死码）：GuidanceSectionSpec（guidance.ts:31/:56 自用）、ProjectedToolUpdatesLike、ObserveDeps、ObserveStreamListener、MainChainRegistry（observe.ts 自用）、AssembleContextLike（plugin.ts 自用）、ParsedFoldContent、RoutedSessionLike、PreflightStats（tools.ts 自用）、SurfaceEventType、SessionSurfaceLike、FoldSummaryInput（types.ts 自用）。【注意-微】可收敛为模块私有，纯卫生。
- **tests/helpers 无未用**：mock-host.ts 导出 disciplinedCtx（3 spec 消费）、routeOverrides（2 spec）；mock-session.ts 导出 MockSession/msg/seedConversation（6 spec）。全部有消费方。
- **config 字段 16/16 全消费**（plugin.ts 逐一接线）：enabled:265、nudgeThresholds:767、keepRecentTokens/protectionFloorTokens/minFoldableTokens/maxFoldFraction/summaryFloorChars/summaryCeilingChars/netShrinkTolerance:676-682（validatorConfig）、attributionTimeWindowMs:633、cleanSampleFloor:259、observe.enabled:573、observe.attemptCapture:598、preflightMode:386、preflightMarginRatio:408、providers:453。CONFIG_FIELD_SPECS 以 `satisfies`（config.ts:181）钉死键集——加/删字段不更新此表直接编译失败，结构性防孤儿配置成立。
- 无 TODO/FIXME/TBD/占位符（git grep 全量核）。

## 4. 状态机跨波不变量 —【良好】

**结论**：applyEvent 单一迁移经 V1(9 类 ResetEvent)→V2(三接收口)→V3(attribution)→V5(wire 口) 四次扩展后，早期不变量全部保持；有界内存纪律统一 64-cap；一个契约信任点缺防御守卫。

- **单一迁移**：attach 扫描（store.ts:887-897）、live feed（:630-642）、resync 修复（:619-623）三路全部汇入 applyEvent（:905-973）——「双制度一致 by construction」成立，且被测试钉死：store-observe.spec:419（增量=全扫）、:541（单迁移 pin）、store-attribution.spec:91（归因双制度）。
- **attach 全清**：store.ts:589-611 清 21 项状态（9 个台账+索引+计数器+互斥量），无遗漏；测试 store-observe.spec:617。store 无 detach API——生命周期=WeakMap 挂 store（plugin.ts:233/:624-638）+ session/disposed→observe.forSessionFactory（plugin.ts:292-299），re-attach 即重扫，语义等价 detach/attach 循环。
- **有界 64×N**：9 个台账全部有 cap（store.ts:157-189；usage/snapshot/break/capture/wire/preflight/routeHeader/reset=64，anomaly=256），逐出=shift-and-push；cap 测试钉 64/66 边界（store-observe.spec:591-592、:600-614；store-attribution.spec:356/:369）。observe/preflight 的 model-info 缓存同为 64-cap（observe.ts:134/:427-431、preflight.ts:360/:538-542）。唯二无界：eventsBySeq/eventSeqList（store.ts:526/:551）——这是「零独立存储、保留事件即记忆」的声明设计（store.ts:13-16 docstring），非泄漏。
- **cap×插值交叉（V3-1）**：resetBetween 在 at-cap 时保守返回 true（store.ts:1314-1317「evicted 后『无 reset』不可证」），归因插值停止升级；边界双向钉测：store-attribution.spec:323（at-cap 停走，删守卫即红）、:340（cap-1 正常升级）。
- **timeWindow 兜底**：classifyFoldAttribution 注入 timeWindowMs（store.ts:1191）+ seq 主键失效降 weak+flag（store-attribution.spec:194）。
- **豁免窗跨 cap**：observe 消费 reset 用 SEQ 指针而非索引（observe.ts:332-345 + SessionObserveState.lastConsumedResetSeq :103），store.ts:180-184 注释明确「shift 不使指针错位」，spec 66→64 场景钉测。
- **【注意】feed 有序唯一假设无守卫**：onEvent（store.ts:630-642）对 seq ≤ lastSeq 的重复/乱序事件不做防御——applyEvent 会重复 push eventSeqList（破坏 ：1260-1269 二分查找的严格递增前提）并使 lastSeq 回退、assistant/message 重复计账。官方 feed 契约保证有序唯一，该假设当前无任何断言/测试钉住。修法（一行守卫+一条钉测）：applyEvent 入口 `if (event.seq <= this.lastSeq) { this.recordAnomaly('stale-event', …); return }`（或在 onEvent 同位置），并以 spec 注入重复事件断言「eventSeqList 无重复、三态计数不涨」。注意级而非缺陷：真实宿主契约下不可达，属「假设未钉」。

## 5. 命名与结构 —【注意】

**结论**：adapter/ 八模块边界清晰、职责单一；texts.ts 单家园原则存在系统性残余（~15 处模型可见文案散落），是该原则自设立以来积累的最大结构债。

- **adapter/ 边界【良好】**：host.ts（fail-soft 三面装载+memoize+test-only reset :412-414）、providers.ts（纯校验层，零 import）、map.ts/replay.ts/context.ts（纯 twins，port provenance 逐函数锚官方 file:line）、twins.ts（组装器，40 行）、wire.ts（观测面，R1 恒返 undefined :83-96）、zctx-adapter.ts（组合根）。八模块每个都有 module docstring 声明来源与边界（如 context.ts:1-34「official context.ts 拉附件机不 import」的豁免理由）；相互依赖仅向下（map/replay 为叶，twins→{map,replay}，zctx-adapter→全部）。
- **texts.ts 单家园残余【注意】**：texts.ts:1-5 自述「Single home of every model-facing text constant」，但以下模型/agent 可见文案在 texts.ts 之外：
  - 工具 schema 描述（随 defineTool 进模型上下文）：tools.ts:890-895、:900、:919-921、:923、:948-950、:955、:957、:992-994；
  - 运行期模型可见回复：tools.ts:934（`no active fold matches foldId …`）、:964（`invalid arguments: query: …`）；
  - 命令面文案：command.ts:42-45（/zctx description）、:95（unknown subcommand 回复）;
  - 引擎状态 note（经 zctx_status 出模型）：fold-engine.ts:100（ccmWindowGate note 模板内联）、:640-677（foldableRanges 四条 protectedReason 字符串——随 NUDGE_RANGE_ROW 出现在 nudge 文本中）；
  - adapter/preflight 错误文案（LlmFailure.message 可能被 agent loop 上呈）：adapter/map.ts:186/:209/:219/:223/:235、preflight.ts:592-595。
  - 定性：W4 工具描述从一开始就内联（非后期破坏），V4/V5 新增文案未走单家园——属跨波累积的原则漂移，无行为缺陷。修法二选一并加门禁：(a) 全部迁入 texts.ts 常量（工具描述做成 TOOLS_* 常量表，tools.spec 钉 schema 与常量同源）；(b) 修订 texts.ts 头部把原则范围收窄为「会话文本（guidance/nudge/reply/materialize）」，把 schema 描述/错误诊断明示豁免。两案均须测试断言为准绳，禁止只改注释。
- **命名一致性**：zctx_ 四工具、zctx-<family> 路由（R5，providers.ts:106-108）、zctx <family> 显示名（:111-113）、'zctx-fold'/'zctx-unfold' source kind、ZCTX_* 环境变量覆盖约定（host-llm.ts:309-313 与 adapter/host.ts:117-147 同构）——跨波命名零漂移。

## 6. 配置面三方一致 —【良好】

**结论**：16 键 × {configDefaults, CONFIG_FIELD_SPECS, README 表, CHANGELOG, README.zh 镜像} 五方一致；schema 形状钉 + 构造期语义门分工明确。

- **三方核对**（卡面要求三方，实核五方）：configDefaults（config.ts:131-151）≡ CONFIG_FIELD_SPECS defaults（:158-181 全部引用 configDefaults，`satisfies` 键集钉 :181）≡ README.md:148-172 表（16 行含 enabled:151，逐行 type/default 与代码一致）≡ CHANGELOG（0.1.0 九字段 + 0.2.0 新增七项含 providers）≡ README.zh.md（:152/:168 抽验镜像同键同值）。
- **providers 默认值单一声明**：R5 V5-3 落实——configDefaults.providers=[]（:150）、schema .default([])（:180-181 经 spec.default）、smoke 钉（43142c7 提交记录）、README.md:172 `[]`——四处同值且 providers.ts/注释声明「optional 仅指用户输入」。
- **volatile 锚**：U1 判定的 volatileForm 门在 schema 构建中落实（config.ts:312-314 仅对 providers 字段挂 .volatile()），注释指认其 load-bearing 地位（:286-289）。
- **防御纵深**：schema 只钉形状（:290-293 注释「schema pins the SHAPE, constructor pins the semantics」），语义门在 providers.ts 构造期 fail-loud 列完整清单（:264-276），wiring 层 catch 后诚实日志+跳面（plugin.ts:480-487）；preflightMarginRatio 越界在 listener 构造器钳回 (0,1]+warn-once（preflight.ts:338-345）。
- **【注意-微】共享可变数组**：configDefaults 为浅冻结（config.ts:131），providers 默认 [] 数组实例被所有未配置 providers 的 plugin 实例共享（plugin.ts:254 spread 后仍引用同一数组）。当前全部消费方只读（resolveZctxProviders :126-256 无写），风险不可达；建议深冻结或读时 spread 加固。

## 7. 跨波回归抽查 —【良好】

**结论**：卡面四项 W 波保证全部在位，另加两项自查项亦在位。

1. **checkpoint 裸 UserMessage 形态仍在**：fold-engine.ts:308-321（fold）/ :454-467（unfold）——data 即 `{id, role:'user', content, source}` 无信封；注释逐点锚官方（session/src/types.ts:309、region.ts:506-508、agent.ts:435、surface.ts:132-134）。
2. **净缩门仍调**：validator.ts:394-408（`foldedTokens × netShrinkTolerance ≤ summaryTokens` → REASON_NO_NET_SHRINK），语义与 README.md:160「at least 1/netShrinkTolerance」等价；tolerance 来自 config（plugin.ts:682）非硬编码。
3. **attributionHeaders 仍全请求**：zctx-adapter.ts:450-453——headers 无条件携带（`wireFaces?.headers ?? requestHeaders(undefined, host)`），一次性请求（无 sessionId）虽不建 wire faces（:430-436）但 headers 仍走 R7 路径；wire.ts:129-141 attribution 名大小写不敏感胜出合并。R7 注释「headers 是请求义务、快照是覆盖决策」（:451-452）与实现一致。
4. **required:true 仍在**：plugin.ts:345。
5. （自查）**子区间工具对闭合仍在**：fold-engine.ts:255-263 提交前 subrangePairReasons 硬门（W3-2 红线），validator 窗口级闭合（validator.ts:227-277）双层。
6. （自查）**compaction 互斥门仍在**：fold :266-268、unfold :434-436 双入口。

---

## 全树架构健康度总评

**8.5 / 10。**

加分项：分层严格单向（纯核心八模块零宿主依赖实证）、五个宿主面全 fail-soft 且标签诚实（official/local-fallback/zctx-mapping/builtin 四类 provenance 全部落在记录上）、状态机单迁移+九台账全有界+边界测试双向钉测、公开面 126=lib 126 零漂移、447 导出符号 0 死运行时代码、五方配置一致。跨 11 波累积仍保持这种结构卫生，说明各波的「结构约束清单」被真实执行。

扣分项（各 −0.5 上下）：texts.ts 单家园 ~15 处残余（-0.5，最大结构债但无行为缺陷）；store feed 有序唯一假设无防御守卫（-0.4，契约信任点未钉）；store→config 引擎触宿主配置模块的软耦合 + configDefaults.providers 浅冻结共享（-0.3）；GUIDANCE_TITLE 孤儿 + 12 处过度导出（-0.2）；wire.ts:59-63 自我修正式注释（「no, honest simplification」）与 host.ts:335-337 无环理由的表述精度（-0.1）。

无缺陷级发现（无 [缺陷] 项）：本次全树审计未发现任何依赖穿透、环、死运行时代码、契约无声破坏或状态机不变量破坏。

## TOP3 建议（按影响排序）

1. **texts.ts 单家园收敛（结构债主项）**：把 §5 所列 ~15 处模型可见文案迁入 texts.ts 或明示豁免并修订 texts.ts:1-5 原则声明；无论选哪案，加一条门禁断言（tools.spec 钉「工具 schema description 与 texts 常量同源」或「texts.ts 头部声明与扫描脚本口径一致」），使漂移可被机器拦截。触发条件：下次新增任何工具/schema/错误文案时必做；owner：主线 coder 波；复核日期：下一波收口。
2. **store.applyEvent 入口加 seq 单调守卫**：一行防御（seq ≤ lastSeq → recordAnomaly('stale-event') + return）+ 一条 spec 钉「重复/乱序 feed 事件不重复计账、eventSeqList 不破坏递增」，把「官方 feed 有序唯一」从口头假设变为钉死契约。与 §4 的【注意】对应；顺手可做，成本极低。
3. **导出面与冻结面卫生**：删 guidance.ts:69 GUIDANCE_TITLE 孤儿别名；12 个文件内自用类型收窄 export；configDefaults.providers 深冻结（Object.freeze 递归）消除共享可变数组。三件均为 10 分钟级卫生改动，可合并为一个「structure hygiene」小提交。

---

- 审计证据完整性说明：本报告所有 file:line 均来自基线 391990f 的工作区实读；孤儿导出结论来自全量枚举（447 符号 × src/tests/scripts/docs/yml 全词匹配），非单次 grep 零命中（B13 纪律）；lib 导出面比对脚本与 orphan-check.cjs 留存于 C:\Users\ZS\AppData\Local\Temp\zctx-audit\（仓外，未写入被审计仓）。
- 本审计只读：除本文件外未向被审计仓写入任何内容。
