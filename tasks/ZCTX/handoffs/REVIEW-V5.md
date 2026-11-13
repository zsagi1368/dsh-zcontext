# REVIEW-V5 — V5 单审交接（reviewer-R5 · v0.2.0 · 2026-11-13）

```
FROM: reviewer-R5 (independent subagent)
TO: 主线 (ZCTX v0.2.0 orchestrator)
MODE: normal (评审结论：V5 通过放行中间合入)
TASK_REF: tasks/ZCTX/cards/V5-s2-adapter.md（S2 薄 adapter 最大波，v5s0..v5s6 七子块）
PAYLOAD: SCORE + 九攻击方向结论 + [阻断]0/[建议]4 + 亲验证据（见下）
ATTACHMENTS:
  tasks/ZCTX/scorecards/V5.json  (总分 98)
```

## 1. 裁决

| 波 | 有效区间（含起点提交本体） | 总分 | 门(≥98) | [阻断] | [建议] | 结论 |
|---|---|---:|---|---:|---:|---|
| V5 | 12543ae^..e243c70（v5s0 R4 顺手闭合 → v5s1 骨架 → v5s2 类+管线+config 段 → v5s3 wire 账本 → v5s4 缓存旋钮 → v5s5 最小目录 → v5s6 lib+探针 → governance terminal） | **98** | PASS | **0** | 4 | 通过放行 |

[建议] 不阻塞中间合入，但阻塞最终验收：4 条全部 OPEN，须由主线按 §11 记入 closure 台账（建议随 V6 当波 fixed，或 user_approved_deferred 二选一收口）。无 [阻断]。

规模注记：src+tests 约 4.5k 行（>600 行门槛），已按卡面增量纪律拆 v5s0..v5s6 七子块提交，审查按子块锚点分解执行——拆小要求由子块结构满足，不构成打回理由（与 V3/V4 行数口径判定同例：计划估算 500-800 未含诚实标注+fail-soft+双路径展开）。

## 2. 亲验证据（reviewer 本机实跑，2026-11-13）

- `pnpm build` → tsdown **984.97 kB**（7 files），EXIT=0；`git status --porcelain lib/` 为空 = 入库 lib 与重建**字节一致**
- `pnpm test` → vitest 22 files **419/419 passed**，EXIT=0（轨迹 333→388→407→415→417→419→419 与逐提交声称吻合；官方路径两例**实跑无 SKIP**：mapping source='official-pi-ai-mapping' + preflight projector='official'）
- `pnpm lint` → tsc --noEmit 零错，EXIT=0（build→test→tsc 顺序，Z19）
- 四探针：probe-artifact **5/5** + verify-activation-surface **8/8** + smoke-real-loader **2/2** + probe-host-imports **16/16** 全 EXIT=0；U2 报告重生成仅时间戳差异，已 `git checkout` 还原入库态（沿 REVIEW-V3V4 先例）
- closure 机器数：closure.json **56 items / 0 非闭合**（唯一 status=open = W5-A6-INSTALL，v0.1.0 基线遗留）；**V5-A..V5-I 九条全 fixed/verified**，disposition 词表零违规
- 红线 R1-R8 独立复跑（node 全量 src 扫描脚本，非单工具 grep）：全部干净（逐条见 scorecards/V5.json verification_trio_reviewer_run.redline_grep）

## 3. 九攻击方向结论（每条：结论 + 证据锚点）

1. **官方语义对齐保真 — 属实（抽验 3 处关键语义全对上）**。map/replay/context 孪生与官方 llm-pi-ai src 逐处对照：(a) **usage 三计数互斥**——mapUsageTwins 与官方 stream.ts:24-32 逐行一致（cacheRead/Write 仅非零携带、reasoning 已由 pi-ai 折入 output、total 直取）；(b) **7 形 chunk**——toStreamChunksTwins 与官方 stream.ts:142-234 逐形一致（usage 先于 finish、finish 后无 chunk、tool arguments 在 block-end 重 stringify 保持 raw JSON、contentIndex 1:1、STREAM_CLOSED 兜底）；(c) **classify 复刻表**——与官方 stream.ts:42-68 正则逐条一致（401/403→AUTH、413/4xx、5\d\d、timeout、stream ended、undici `terminated`/`Premature close` 特判、兜底 PI_AI_ERROR）；mapStopReason 双分类器（piOverflow 先 + harnessOverflow）与 EMPTY_RESPONSE/pending/deferred/aborted 分支全同；replay 信封 emit/consume 同 schema 且官方 llm-pi-ai 信封可经 zctx twin 回放（跨 adapter 互操作专测 adapter-providers.spec:492）；context text-only 路径忠实（splitSystemPrompt/piContext/appendDeveloper/toolResultOf 全同，file 块 fail-loud 为 F6.2 不变量的显式化增强）。twin 仅增防御分支（结构输入超集），无语义偏离。
2. **R1 红线最严核 — 通过**。onPayload：类型签名 `()=>undefined`（wire.ts:44）+ 实现体 return undefined 恒定（:83-96）+ 双调用钉测试（adapter-wire.spec:31-49，第二次调用断言 undefined）+ grep 全 src 零 replace 站点——grep+实读双验一致。fetch：只哈希不改写，real fetch 原样收到调用（测试钉 realFetch 恰一次、响应透传）；无 body/fetch 的请求照发（:88-105）。
3. **R4/R5/R6/R7 — 全过**。R4：maxRetries 全 src **唯一站点** zctx-adapter.ts:452 `maxRetries: 0` + streamSimple 捕获钉测试（options.maxRetries===0）+ 位置与官方 profileOptions 同型（adapter.ts:140-141）。R5：路由仅经 zctxRouteOf(`zctx-<family>`)，displayName 'zctx <family>' 逐字（A 案）。R6：transport 零传递 + ws://wss:// 构造期违规拒绝 + **pi-ai 1.0.2 dist 三协议 api 模块 transport/websocket 零消费**（reviewer 独立 node 扫描复核，防 ugrep 假阴性）——双重保障。R7：attributionHeaders 必并入请求头含 one-shot（`wireFaces?.headers ?? requestHeaders(undefined, host)`，one-shot 无 onPayload/fetch 仅 headers 有专测 adapter-zctx.spec:376-382）；attribution-wins 大小写不敏感合并与官方 adapter.ts:215-223 逐行一致。
4. **fail-soft 三面加载器 — 通过**。all-or-nothing（缺任一面→整体 undefined，host.spec:61-68）+ 坏 override 降级（:53-60）+ memoize/resetForTest 缝；Z20 fileURLToPath 修复在位（host.ts:132-139，注释锚 + ~/.agents/rsi/INDEX.md 2026-11-13 条目含诚实自纠）；三面任一失败→adapter 整体不注册永不炸 boot（plugin.spec:170-184 宿主不可达 info 钉 + 异步 continuation 最外层兜底 catch）。
5. **A 案实现 — 通过**。family=supportedProtocols() 动态取（host.ts:222-239，override 感知）+ KNOWN_PROTOCOLS 与官方 union 相等专钉（adapter-host.spec:71-73）+ 未知 family 构造期违规清单含 supported 全集；config 结构化段前移 v5s2（随消费面落地）+v5s5 只补目录——无契约影响，合理。
6. **volatile 承重件 — GO 条件满足**。config.ts providers 段 .volatile()（SchemasteryNode volatile 存在性守卫，fail-soft）；对照 U1 报告 §4 GO 条件 1（llm-pi-ai config.ts:353 同形）与官方 settings index.ts:307-309 volatileForm 门实读——volatile 字段确使 settingsNs='dsh-zcontext' 挂载；visibility-only 诚实日志 + 配置权威=profile overlay patch。注：settingsPath 用位置下标（U1 建议 dict+route 键，但 plan §3 冻结 providers[] 数组，数组态下标即正确绑定，注释已声明静态绑定理由）。
7. **缓存旋钮 — 与 F4.6 一致**。cacheRetention 直通（verbatim 进 StreamOptions，pi-ai resolveCacheRetention 自持 显式>env>'short' 优先级）；cacheControlFormat 仅 'anthropic'（官方 GATE 单值）且仅 openai-completions——他族构造期拒收（死配置不诚实携带）；compat 物化进 pi-ai Model（adapter-zctx.spec:385-417 双向钉：有旋钮两键在、无旋钮两键无）。
8. **wire 账本完整性 — 通过**。WireSnapshot domain:'wire' → store.absorbWireSnapshot 64-cap（66→64 oldest-dropped 钉）+ attach 清账 + 返回拷贝；request-bytes 携 byteLength（string/Uint8Array 两形钉）；request-payload stableStringify+sha256 确定性钉；one-shot 仅携 R7 headers；sink 经 resolveWatchedSession→storeFor 仅落被监视会话（诚实覆盖域=会话绑定 zctx 请求，plan §3 逐字）。
9. **亲验 — 全绿**。build→test→tsc 顺序 + 四探针 + closure 56 条 0 OPEN 机器数 + R1-R8 grep 独立复跑（详见 §2）；额外第二证据源：pi-ai 1.0.2 dist 独立 node 扫描（buildBaseOptions 证实 fetch/onPayload/headers/maxRetries/cacheRetention/sessionId 透传面全部落地真实请求选项；同时证实 `options?.maxTokens ?? model.maxTokens` 与 anthropic-messages.js:880 → **[建议] V5-2 的 maxTokens 缺省可达 wire**）。

## 4. [建议] 清单（0 条 [阻断]；4 条 OPEN 待主线 §11 记账，阻塞最终验收）

| id | 位置 | 问题 | 修法（以测试断言为准绳） |
|---|---|---|---|
| V5-1 | src/store.ts:1297 resetBetween cap-guard（store-attribution.spec 无专钉） | V3-1 停走条件（满 64 ⇒ unknown）无回归测试：删掉该行无任何测试变红——正确性承重的保守闸处于无钉态；closure V5-F 如实只声称代码修复（非虚报），但 V3 建议原文『补一例边界测试』分支未走亦未按 §11 显式记账 | 补一例边界用例：锚点后灌 64+ reset 再喂同 turn estimated 候选，断言停留 estimated 不升格 interpolated；或按 §11 记 user_approved_deferred（附病态触达论证） |
| V5-2 | src/adapter/zctx-adapter.ts:201（`maxTokens: model.maxTokens ?? 32768`） | 缺省 maxTokens 静默发明 32768 且经 pi-ai buildBaseOptions（`options?.maxTokens ?? model.maxTokens`）+ anthropic-messages.js:880 到达 wire max_tokens；官方 catalog.ts:934-936 对手写模型缺 maxTokens 是构造期 invalid（fail-loud）；harness 面 modelInfo 无 defaultMaxTokens 是诚实的，但 wire 面携带未声明值且 32768 无处文档化；有 clamp 防溢出，非安全缺陷，属官方对齐缺口（C5） | 二选一：(a) 官方对齐——providers.ts 加 maxTokens 必填校验（一行+一测）；(b) 保留缺省但文档化（JSDoc+README）+ 物化缺省值专测，使 32768 成为受钉契约 |
| V5-3 | src/config.ts:175 | 注释 'configDefaults omits it (optional)' 与 :150 configDefaults.providers=[] 及 smoke 契约钉三方矛盾（v5s6 对齐默认值时未同步注释） | 一行注释修正为三方一致描述 |
| V5-4 | src/plugin.ts wireAdapterFace（违规检查在可达性门之后） | 宿主不可达+配置违例并存时用户只见 'not reachable' info，看不到完整违规清单——校验不依赖宿主（协议表有 builtin 兜底），可先行；诚实诊断纪律下违例不应被可达性门屏蔽 | resolveZctxProviders（非抛）前移到 loadAdapterFaces 之前，违例先 warn 全清单；补一测：宿主缺席+坏配置 ⇒ 日志含违规清单 |

## 5. 造假检查

未发现造假：官方 stream.ts/replay.ts/context.ts/adapter.ts/catalog.ts 与 pi-ai 1.0.2 dist 逐处实读对照（含 grep 0 命中的 re-export 星号澄清、ugrep 假阴性换法复核）；测试声称数字（333/388/407/415/417/419、984.97 kB、探针 5/8/2/16、closure 56 条）与实跑一致；R4 单站点/R1 undefined 恒定/R7 one-shot headers 机器钉独立复跑吻合；官方路径两例本机实跑无 SKIP；closure V5-F 未夸大。评分无自评（reviewer-R5 ≠ V5 coder）。评审过程仅还原探针重生成的 U2 报告时间戳（git checkout，沿上轮先例），未修改任何业务代码/测试/配置/del。

## 6. 移交事项

1. 主线：把 §4 四条 [建议] 记入 tasks/ZCTX/closures/closure.json（V6 当波 fixed 或 §11 user_approved_deferred，disposition 二选一）；V6 终验时核对 4 条 disposition 全部非 OPEN。
2. V6 注意：REVIEW-V3V4 的 V3-1/V4-1/V4-2 三条与本波 V5-1（同一主题 cap-guard 测试）一并核对——V5-1 fixed 时 V3-1 即可一并 closed（同一行代码的测试钉）。
3. 收口节奏：V6 终审（文档+发布）按计划执行；工作树当前有一个未跟踪的 V6 卡片文件（tasks/ZCTX/cards/V6-docs-release.md，下一波入料，非 V5 遗留）。
