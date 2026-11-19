# ZCTX-UI B5 对抗评审报告

> 角色：reviewer-B5（独立实测，≠作者）　作者：coder（B3 四提交 + B4 三提交）
> 工作树：`G:\000Github\zDSH\zDSH-plugins\dsh-zcontext\worktrees\ZCTX-UI`（分支 `feat/ZCTX-UI`，HEAD `9082b52`，基线 `03ec933`，之上 7 提交）
> diff：`git diff 03ec933..HEAD` = 28 文件 / +4873 / -37（已按 D1~D7 分块提交，非巨型单块，符合拆小要求）
> 日期：2026-11-18　模式：对抗评审 + 独立复现（真机不碰）

## 一、结论（门禁口径）

**PASS（98/100，压线放行，无 `[阻断]`）。** B5 中间门放行。
本轮发现的 6 条 `[建议]` 均为非核心降级/一致性/结构瑕疵，**不阻塞中间合入，但阻塞 B6 最终验收**——须在 B6 前逐条 `fixed/verified` 并落 closure。已知开放项（真机 V4/V5/V8/BENCH-L2/端到端浏览器）属 B6，本报告如实标注、不作 B5 阻断。

硬阻断（全局协议 §12.3）逐条核对：无伪造证据/评分/派发/测试；无安全底线违规（fail-closed 已独立复现）；正确性 25（≥23）；安全回滚 10（≥9）；724 测试全绿无 P0/P1 未关闭；closure 5 项保持 open 未被单方面关闭。**无硬阻断命中。**

## 二、必核清单逐项证据（三值结论：确认 / 证伪 / 无法验证）

### 1. R1 红线 —— 【确认】
- 请求体改写面：`grep -rnE "llm\.stream|llm/stream|req\.body|internal/config|requestBody|registerListener|on\('llm" src/ui src/client` → **零命中**（`NO MATCH`）。`src/ui/page.ts:302` 命中的 `res.body` 是前端 fetch 响应 JSON 变量，非请求体改写，非 R1 问题。
- SUPPORTED 段 sha256 独立复算（按 `G:\000Github\zDSH\zDSH-plugins\dsh-zcontext\worktrees\ZCTX-UI\patcher\README.md:355-368` 钉死口径：git 对象读取、自 `export const SUPPORTED = {` 至首个列 0 `// ----------` 分隔行、含前缀、含末行换行、不 trim）：
  ```
  git -C <WT> show <ref>:patcher/zctx-patch.mjs | node -e '<切片+sha256>'
  HEAD:     chars=14889 bytes=14926 sha256=8e2d0b7effb1b9af0151b2e2aa8b408eb67b5d58c180e29df3c8730ac059b0f9
  03ec933:  chars=14889 bytes=14926 sha256=8e2d0b7effb1b9af0151b2e2aa8b408eb67b5d58c180e29df3c8730ac059b0f9
  d951ebf:  chars=14889 bytes=14926 sha256=8e2d0b7effb1b9af0151b2e2aa8b408eb67b5d58c180e29df3c8730ac059b0f9
  ```
  三值（`8e2d0b7e…` / chars14889 / bytes14926）精确复现且 HEAD==基线==README 锚点。

### 2. 快照 API V1（DESIGN §2）—— 【确认】
- 逐函数核对 `src/ui/snapshot.ts`：`createSnapshotSource` 薄封装 `computeBudget`(:135) / `foldableRanges`(:145) / `store.observabilitySnapshot`(:187) / `store.usageSnapshot`(:160) / `store.ledgerEntries`(:152) / `store.surfaceNodes`(:145) / `routedRequestTarget`(:129) / `runtime.tokenMeter.measure`(:117)；session 解析由注入的 `resolveSession`/`currentSession`/`windowFor`/`faceHealth` 提供（plugin.ts:420-425 用 `resolveWatchedSession`/`currentSession`/`windowCache.get`/`faceHealth` 装配）。**无从零造结构**。
- session 三臂（snapshot.ts:87-99）：显式 id→`resolveSession`，不可见→`emptySnapshot('session <id> not watched')` 不回退；缺省→`currentSession()`；无 session→空快照。写 `sessionResolution`，不静默。
- 标注（snapshot.ts:112-122/161-165/190-198）：meter 失败→`unknown`、无样本 cache→`basis:'none'`、`netTokensSaved.basis` 取 `dominantBasis`（measured>semi>estimated）。与 `renderStatus` 口径一致（tests/zctx-ui.spec.ts:189-204 逐字段真断言：budget/ranges/folds 与现存取器 `toEqual`）。
- 证据命令：`Read src/ui/snapshot.ts` 全文 + `pnpm test` 中 D1 六用例 PASS。

### 3. UI 路由 V2/V3/V4（DESIGN §3）—— 【确认】
- 4 条 WebRoute（`src/ui/routes.ts:133/153/169/203`）：handler 自写 `writeHead/end`(:110-113 sendJson)、`readBody` 用 `for await`(:56-67)、小写 `req.headers`(:46-50)；**无 Express helper**。
- disposer 经 `ctx.effect` 注销（routes.ts:216-221 + plugin.ts:450-455，见[建议] B5-2 冗余）。
- bridge token = `zctx_${Date.now()}_${createTokenSource().token()}`，后者 `randomBytes(16).toString('hex')`（auth.ts:41-43），运行时生成；`grep -rnE "['\"\`]zctx_[0-9a-z]+_[0-9a-f]{16,}['\"\`]" src tests scripts` → **零可用凭据字面量**。页面注入占位符 `__ZCTX_BRIDGE_TOKEN__` 在注册时替换（routes.ts:91），仅内存闭包。
- 三臂授权（auth.ts:92-107）：token / same-origin / loopback；写从严 `token OR (same-origin AND loopback)`。
- **fail-closed 独立复现**（我从真实 `src/ui/auth.ts` 用 `node --experimental-strip-types` 加载并求值的实际输出）：
  ```
  wrong-token + loopback READ : false (expect false)
  wrong-token + loopback WRITE: false (expect false)
  valid-token            READ : true (expect true)
  valid-token            WRITE: true (expect true)
  loopback-only          READ : true (expect true)
  loopback-only          WRITE: false (expect false)
  ```
  B3 coder 自修的 "错误 token 不回退 loopback" bug 已正确落地（auth.ts:94/105 命中 token 头即 `return tokenMatches(...)`，不 fall-through）。
- config 写仅走 `configEditor.edit`（config-write.ts:97-112），13 键白名单（:16-30 + sanitizePatch :80-91 拒绝未知键），缺席返回 503（routes.ts:197-200）。
- 页面内联 HTML（page.ts），无 fs 读盘、无路径拼接 → 零路径穿越面。
- 证据：`Read src/ui/{auth,routes,config-write,page}.ts` + fail-closed 复现命令 + `git status`。

### 4. 不耗 session token（V3）—— 【确认】
- grep R1-a 零命中即证据：`src/ui/**` 与 `src/client/index.ts` 无 `llm.stream` / `llm/stream` listener；UI 数据经同源 HTTP fetch（page.ts:124-129/294-297），不进对话。依赖图：`src/ui` 是叶子，未被 fold-engine/autofold/observe/preflight 反向 import（§9.1 grep 零命中）。

### 5. face 探针 V5/V6（DESIGN §4）—— 【确认】
- 三臂三态（`src/ui/face-probe.ts`）：tools.register(:97-119) / system-prompt.guidance(:121-137) / guard-observe(:139-153)；三态裁定 :155-163。每信号 try/catch + `capability()` get-trap(:71-78)。
- **on-demand 不 memoize**：detectFaceActivation 每次重算（:89-186），注释与 tests/ui-face-probe.spec.ts:156-168 双臂证实。
- 降级写可见 sink 不依赖 `ctx.logger.warn`：默认 `process.stderr`（:63-69），生产用 `createTransitionSink` 去重（:194-201），5s 轮询不刷屏（tests:170-181 断言去重）。
- faceHealth 进 snapshot（snapshot.ts:69-79）、UI 显示红黄绿（page.ts:166/:69-71）。
- "不自动关闭 BENCH-L2" 诚实声明在代码注释（face-probe.ts:4-6）与 DESIGN §4.3、README、closure.json BENCH-L2 条目三处；BENCH-L2 保持 open。

### 6. slot 摘要卡 V7（DESIGN §5/§6）—— 【确认，附[建议] B5-1】
- client bundle 单参 `factory(require)`（tsdown.config.ts:50-51 + dist/client.cjs 头尾实读），banner id `dsh-zcontext` = 包名。
- `inject = ['slots']` 最小集（client/index.ts:30）；能力探测降级：slots 缺席/inject 抛错→no-op 不 PENDING（:181-187）。
- `React.createElement` + `styles.insert`，无源码级 `import react`（grep 零命中）；order:50 不传 priority（:163-169，grep priority 仅注释）。
- 表达力限制按反-C2 用"摘要文本 + 链接"（client/index.ts:135-146）。
- `dsh.client` informational 边界声明在 DESIGN §6.2 与 src/client 注释。
- **build 亲跑握手 4/4 PASS**（见第 8 项）。
- 附[建议] B5-1：无 React 时降级渲染为 `null` 空白卡，非文档声称的"纯链接"。

### 7. manifest（B-X1）—— 【确认】
- `git -C <WT> diff 03ec933..HEAD -- package.json`：新增 `exports['.']`/`['./client']='./dist/client.cjs'`/`['./package.json']`；`dsh.client={platform:'web',inject:['@deepseek-ai/dsh-client-ui-slots']}`；`main`/`types`/devDeps 未动。
- `git diff -- cordis.patch.yml` → **空**（未改动）。
- tests/client-slot.spec.ts:174-179 断言 manifest 三处形态与 bundle.patch 未变。

### 8. 测试质量与构建 —— 【确认】
- `pnpm build`：EXIT=0，握手 4/4 PASS（banner-single-arg-factory / banner-id-matches-package-name / footer-returns-exports / no-three-arg-factory）。
- `npx tsc --noEmit`：EXIT=0。
- `pnpm test`：**Test Files 34 passed (34) / Tests 724 passed (724) / Duration 3.01s**，与任务卡一致。
- money 臂抽查非假绿：zctx-ui.spec.ts D1（注入账本逐字段 `toEqual` 现存取器）、D2 授权（:308-340 三臂+写收紧）、D1 不可见 id 不回退（:222-241）、face-probe 三态+cordis get-trap+去重+不 memoize、client-slot 工厂契约+inject 门降级——均为真断言。唯一例外见 B5-1（降级链接用例断言不足）。
- Z19 产物新鲜：build 后仅 4 个 lib chunk 变脏（2 个纯 CRLF + 2 个 sourcemap 1 行），按 Z3 `git checkout --` 还原后 `git status` 空 → 交付时树净、产物与源码基本同批。

### 9. 坑册合规（DESIGN §9）—— 【确认】
- §9.1 反向 import 零命中；§9.2 只读铁律零流改写；§9.3 复用现存取器（见第 2 项）；§9.4 仅 configEditor.edit；§9.5 disposer 经 ctx.effect；§9.6 零凭据字面量；§9.7 client 单参+inject 最小集+无 priority；§9.8 产物同批；§9.9 Write/Edit 直写（page.ts 内联 HTML 用 TS 模板字符串 + 字符串拼接避 `${}`，无 heredoc）；§9.10 closure 5 项全 open。
- Z23/条目32 禁 heredoc：源码为 Write 直写形态（审阅 page.ts/.mjs 无 shell heredoc 生成痕迹）；A68 绝对路径：DESIGN/task 文档路径均为绝对路径；A72 无 Edit-Read 循环迹象。
- closure.json（`tasks/ZCTX-UI/closures/closure.json`）：5 项（V8-A3-4/A4-5/A2-4/C-3 + BENCH-L2）全部 `disposition=open / status=open`，未被单方面关闭 —— 正确（附[建议] B5-4 phase 提示）。
- checkpoint.json step=9 与 checkpoint-history.jsonl 9 行末行 hash/prev_hash 一致、链有效；progress.md STEP-0001~0009 完整落盘（含 D4 返工 1 轮 auth bug）。

### 10. 工作树干净 —— 【确认】
- 评审开始 `git status --short` = 空；build 后 4 个 lib chunk 变脏（Z3 churn），`git checkout -- lib/...` 还原后 `git status --short` = 空 → 交付态干净。

## 三、[阻断] 清单

**无。** 无"不修不能合入"的问题。

## 四、[建议] 清单（阻塞 B6 最终验收，不阻塞 B5 中间合入）

- **B5-1（降级行为与文档/测试不一致，建议优先修）**
  - 位置：`G:\000Github\zDSH\zDSH-plugins\dsh-zcontext\worktrees\ZCTX-UI\src\client\index.ts:162`；`tests\client-slot.spec.ts:104-109`；`README.md:265` / `README.zh.md`（原生入口段）。
  - 问题：`finalComponent = component ?? ((..._args) => null)` —— React 缺席时降级组件渲染为 `null`（空白卡），并非文档与测试注释声称的"降级为纯链接"。独立实测 `apply()` 无 React → `component()` 返回 `null`、`JSON.stringify` 不含 `/zctx-ui`。测试用名为"degrades to non-null link component"，但断言仅 `typeof === 'function'`，未验证渲染出链接 → 假绿成分。
  - 理由：DESIGN §5.3 / 反-C2 / 双语 README 均明确承诺"React 不可用降级为链接"；空白卡使用户在 settings.section 看不到任何入口。虽生产 loader 通常提供 React seed（该场景罕见）、且阶段一 UI 页不受影响（DESIGN §6.2 阶段独立），但属明确承诺未兑现 + 测试断言不足。
  - 建议修复：无 React 时返回一个用纯 DOM/`React.createElement` 之外方式渲染的 `<a href="/zctx-ui">` 链接组件（或直接 `ctx.slots.register` 一个静态 link 描述），并把测试断言改为渲染输出包含 `/zctx-ui`。
  - disposition：`open`（待 coder `fixed/verified`，B6 前）。

- **B5-2（disposer 重复注册）**
  - 位置：`src\ui\routes.ts:216-221` 与 `src\plugin.ts:450-455`。
  - 问题：两处均对同一 `disposeUi` 用 `ctx.effect(() => () => disposer(), 'zctx-ui-routes')` 注册；`attachUi` 内部（经 registerUiRoutes）已注册一次，plugin 又注册一次。
  - 理由：disposer 幂等（`unregister.length=0`）不会出错，但双重注册冗余、易误导维护者，且 label 相同。
  - 建议：只保留一处（推荐 routes.ts 内部，plugin 直接用返回值即可）。
  - disposition：`open`（可选修复，B6 前评估）。

- **B5-3（快照个别取数未包 try/catch）**
  - 位置：`src\ui\snapshot.ts:129`（`routedRequestTarget(session)`）、`:142`（`runtime.storeFor(session)`）。
  - 问题：这两个调用未包 try/catch，异常会使 `snapshotFor` 抛出；虽有 routes.ts:147-151 的 500 兜底不崩溃，但 degraded 行不会记录该故障，与"诚实降级"口径略偏。
  - 理由：其余取数（window/tokenMeter/budget/ranges/folds/cache/attribution）均有 try/catch + degraded，此二者不一致。
  - 建议：统一包 try/catch 并 push degraded 行，或在注释说明为何可安全直调。
  - disposition：`open`（可选修复）。

- **B5-4（closure phase 与合并门的张力，交主线）**
  - 位置：`tasks\ZCTX-UI\closures\closure.json`（V8-A4-5 / V8-A2-4 条目 `phase=block` 且 `status=open`）。
  - 问题：全局协议 §11 的 `closure-check -Phase block` 遇 OPEN 会卡合并门；这两条的单测臂已过、真机臂属 B6。
  - 理由：任务卡/评审指令明确"真机属 B6、不作 B5 阻断"，但 phase 标记与 §11 block 门语义冲突。
  - 建议：B6 合并门跑 `closure-check -Phase block` 前，由主线对这两条定谳（`fixed/verified` 单测臂）或经 §11 调整 phase；reviewer 不单方面改 closure。
  - disposition：`open`（主线 B6 处理）。

- **B5-5（UI 无多会话切换控件）**
  - 位置：`src\ui\page.ts:116/311-312`（`session` 锁定首个后仅带 `?session=` 轮询）。
  - 问题：DESIGN §2.3 声明"多会话切换由 UI 提供选择"，页面锁定首个 sessionId 后无下拉/切换控件。
  - 理由：多会话场景下用户无法在 UI 内切换查看，需刷新或手改 URL。
  - 建议：增加会话选择控件（数据源为快照 sessionId / 服务器暴露 watched 列表；若宿主无列表 API 则在 README 注明限制）。
  - disposition：`open`（B6 真机评估是否必须）。

- **B5-6（HTML 属性转义不覆盖引号）**
  - 位置：`src\ui\page.ts:130-132`（`esc` 仅转义 `&<>`）；用于 `value="' + esc(val) + '"`（:255）等属性上下文。
  - 问题：`val` 含 `"` 时可破坏属性结构（触发 HTML 注入的微观面）。
  - 理由：数据源多为本地可信 overlay/账本，且是自有同源页面，风险低；但 `esc` 用于属性时应含 `"`/`'`。
  - 建议：`escAttr` 增加引号转义，属性上下文改用它；或说明可信来源边界。
  - disposition：`open`（安全快筛低优先，可 user_approved_deferred）。

## 五、评分（详见 `tasks/ZCTX-UI/scorecards/B5.json`）

| 维度 | 分值 | 得分 | 证据要点 |
|---|---:|---:|---|
| 正确性 | 25 | 25 | R1 三值复算、fail-closed 复现、session 三臂、薄封装逐字段真断言、34/724 绿、tsc 0 |
| 完整性 | 20 | 19 | V1-V7 全覆盖、V8 转验收诚实；B5-1 降级"纯链接"未真正实现扣 1 |
| 一致性 | 20 | 19 | manifest/导出/双语/契约一致；B5-1 文档与实现不一致扣 1 |
| 可验证性 | 15 | 15 | 每条结论有命令+输出，哈希可核，测试可复现 |
| 安全回滚 | 10 | 10 | fail-closed、零凭据字面量、13 键白名单、403、additive revert、closure 正确 open |
| 可维护性 | 10 | 10 | leaf 边界、命名清晰、结构一致；B5-2/B5-3 已在建议中记录，不再重复扣分 |
| **总分** | **100** | **98** | evaluator=reviewer-B5，author=coder，评审人≠作者 |

## 六、诚实声明与开放项（属 B6，非 B5 阻断）

- 真机未碰：端到端浏览器 `/zctx-ui` 三块渲染 + 5s 轮询 + face 灯、face 三重证据、非 loopback 真机只读语义、设置页 26 primitive 可见性、React 不可用真机降级——均未真机实测，属 B6 verifier。
- closure 5 项保持 open 待主线 B6 定谳；BENCH-L2 原始 `user_approved_deferred` 不因探针自动关闭。
- 无法验证项：无（本轮所有必核项均取得证据；真机项明确标注"属 B6/未验"而非"确认"）。
- 评分 98 为压线放行：6 条 `[建议]` 必须在 B6 最终验收前逐条 closed，否则阻塞最终交付（与 `[建议]` 阻塞最终验收、不阻塞中间合入的纪律一致）。
