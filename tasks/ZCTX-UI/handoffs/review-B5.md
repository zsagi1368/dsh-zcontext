# ZCTX-UI B5 对抗评审报告

> 角色：reviewer-B5（独立实测，≠作者）　作者：coder（B3 四提交 + B4 三提交；r1 返工 d88a315）
> 工作树：`G:\000Github\zDSH\zDSH-plugins\dsh-zcontext\worktrees\ZCTX-UI`（分支 `feat/ZCTX-UI`，基线 `03ec933`）
> - r0 评审：HEAD `9082b52`，diff 28 文件 / +4873 / -37
> - r1 复评：HEAD `d88a315`（返工 B5-1/2/3/5/6）+ `a9f2f0d`（B5-4 主线修正）
> 日期：2026-11-18　模式：对抗评审 + 独立复现（真机不碰）

---

# 第一部分：r0 初评（HEAD 9082b52，98/100）

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
  - 位置：`src\client\index.ts:162`；`tests\client-slot.spec.ts:104-109`；`README.md:265` / `README.zh.md`。
  - 问题：`finalComponent = component ?? ((..._args) => null)` —— React 缺席时降级组件渲染为 `null`（空白卡），非文档声称的"纯链接"；测试仅断言 `typeof === 'function'` → 假绿成分。
  - disposition（r0）：`open`。

- **B5-2（disposer 重复注册）**：`src\ui\routes.ts:216-221` 与 `src\plugin.ts:450-455` 双重 `ctx.effect('zctx-ui-routes')`。disposition（r0）：`open`。
- **B5-3（快照个别取数未包 try/catch）**：`src\ui\snapshot.ts:129/142` 的 `routedRequestTarget`/`storeFor` 未包 try/catch。disposition（r0）：`open`。
- **B5-4（closure phase 与合并门张力）**：V8-A4-5/A2-4 `phase=block` 且 open。disposition（r0）：`open`（交主线）。
- **B5-5（UI 无多会话切换控件）**：`src\ui\page.ts:116/311-312` 锁定首个 session 无切换。disposition（r0）：`open`。
- **B5-6（HTML 属性转义不覆盖引号）**：`src\ui\page.ts:130-132` `esc` 仅转义 `&<>`。disposition（r0）：`open`。

## 五、r0 评分

| 维度 | 分值 | r0 得分 |
|---|---:|---:|
| 正确性 | 25 | 25 |
| 完整性 | 20 | 19 |
| 一致性 | 20 | 19 |
| 可验证性 | 15 | 15 |
| 安全回滚 | 10 | 10 |
| 可维护性 | 10 | 10 |
| **总分** | **100** | **98** |

---

# 第二部分：r1 复评终评（HEAD d88a315，100/100）

> 复评对象：`a9f2f0d`（B5-4 主线修正）+ `d88a315`（B5-1/2/3/5/6 返工）。任务：逐项独立复核 5 条 coder 返工 + 1 条主线修正，亲跑构建/测试，更新评分与报告。真机不碰。

## 七、复评结论

**PASS（100/100，无 `[阻断]`）。** r0 的 6 条 `[建议]` 全部 `fixed/verified`，无一遗留 `open`。B5 质量门以满分关闭。真机开放项（V4/V5/V8/BENCH-L2/端到端浏览器、closure 5 项 open）属 B6，不作 B5 阻断。

硬阻断（§12.3）复评：无伪造证据/测试；无安全底线违规；正确性 25≥23；安全回滚 10≥9；730 测试全绿；closure 5 项 open 且全 `phase=post-merge`（B5-4 已消除 block 门 OPEN），不作 B5 阻断。**无硬阻断命中。**

## 八、逐项独立复核（三值结论）

### B5-1 真降级链接 —— 【确认 fixed】
- 源码（`src\client\index.ts`）：新增 `DocumentLike`/`LinkRender` 类型 + `createFallbackLink(doc)`（:166-190），无 React 时 `finalComponent = component ?? createFallbackLink(doc)`（:205），返回 `{tag:'a', href:'/zctx-ui', text, node?}`，doc 存在时创建真实 `<a>` DOM anchor。
- 测试（`tests\client-slot.spec.ts:104-131`）：由 `typeof` 断言升级为**真渲染断言**——调用 `component()` 检查 `tag/href/text/length` 与真实 DOM `anchor.href/textContent`。
- **reviewer 独立复现**（`node --experimental-strip-types` 加载真实 `src/client/index.ts`，注入假 document，无 React 调 apply）：
  ```
  [B5-1] rendered: {"tag":"a","href":"/zctx-ui","text":"打开 zcontext 面板 →"}
  [B5-1] real DOM anchor: {"href":"/zctx-ui","text":"打开 zcontext 面板 →"}
  [B5-1] bare-node fallback: {"tag":"a","href":"/zctx-ui","text":"打开 zcontext 面板 →","hasNode":false}
  ```
  非 null 假绿已消除；README/README.zh/DESIGN §5.3「降级为链接」承诺与实现一致。

### B5-2 disposer 唯一注册 —— 【确认 fixed】
- 源码：`src\plugin.ts:456-469` 删除二次 `ctx.effect(...'zctx-ui-routes')`，仅保留注释；`src\ui\routes.ts:218` 为唯一实际调用。
- 测试（`tests\zctx-ui.spec.ts:547-565`）：用 effect label 记录器断言 `zctx-ui-routes` 恰好 1 次。
- **reviewer 独立复现**（加载真实 `registerUiRoutes` 计数 effect label）：`zctx-ui-routes effect registrations: 1`。
- grep：`src` 全仓仅 `routes.ts:218` 一处 `.effect('zctx-ui-routes')`（plugin.ts 仅注释命中）。

### B5-3 storeFor/route try-catch→degraded 真抛点 —— 【确认 fixed】
- 源码（`src\ui\snapshot.ts:138-177`）：`routedRequestTarget(session)` 与 `runtime.storeFor(session)` 均包 try/catch，异常 push degraded 并 `return emptySnapshot(reason, faceHealth, generatedAt, availableSessions, 'degraded')`；`ZctxSnapshot.sessionResolution` 增 `'degraded'` 值（types.ts）。
- 源码审：`routedRequestTarget`（tools.ts:561-577）内部 try/catch 仅包 `session.requestHeader?.()` 调用，其后 `.config` 读取在 try 外——测试用 Proxy 使 `.config` getter 抛错，确实落到 snapshot.ts 外层 guard（真抛点臂，非假绿）。
- **reviewer 独立复现**：
  ```
  [B5-3] storeFor throw -> degraded ["store resolution failed: store boom"]
  [B5-3] route throw -> degraded ["route target read failed: header.config boom"]
  ```
  两者均不向调用方抛出，degraded 行如实记录。

### B5-5 availableSessions + 真实 select 切换 —— 【确认 fixed】
- 源码：`src\ui\types.ts` 增 `availableSessions: readonly string[]` + `SnapshotDeps.listSessions?`；`src\plugin.ts:429-437` `listSessions` 薄封装遍历 `liveSessions` 取 id（非新造）；`src\ui\snapshot.ts:71-77/233` 产出字段（try/catch 保护）；`src\ui\page.ts` 增 `<select id="session-pick">`（:96-98）、`renderSessionPicker(ids,current)`（:319-333）从 `s.availableSessions` 填充、change handler 锁 session 并 refresh（:353-359）。
- 测试：`tests\zctx-ui.spec.ts` B5-5 臂断言 `availableSessions` 字段 + 页面控件/绑定/change 存在；`tests\client-slot.spec.ts` 未受影响。
- 判定：真实控件 + 真实字段绑定；真机交互仍属 B6，但控件实现与数据流完整。

### B5-6 esc 补引号 + escAttr —— 【确认 fixed】
- 源码（`src\ui\page.ts:136-142`）：`esc()` 增 `.replace(/"/g,'&quot;').replace(/'/g,'&#39;')`；`escAttr()` 别名；表单 `value`/`data-key`/`data-type` 属性上下文与 session option 改用 escAttr（:265/:325）。
- 测试（`tests\zctx-ui.spec.ts:619-628`）：断言两条 replace 链字符串与 `escAttr(` 存在。
- 判定：属性上下文的引号转义到位（字符串级断言 + 源码实读一致；JS 在浏览器执行，属静态断言合理范围）。

### B5-4 主线 closure phase 修正 —— 【确认 fixed】
- `git diff 9082b52..a9f2f0d -- tasks/ZCTX-UI/closures/closure.json`：V8-A4-5、V8-A2-4 `phase: block→post-merge` 并各附 `_main_note` 更正说明。
- 当前 5 项 closure 全 `status=open / phase=post-merge` → §11 `closure-check -Phase block` 无 OPEN，张力消除；reviewer 未单方面改 closure（主线执行，合规）。

## 九、复评构建/测试/R1/工作树（亲跑）

| 项 | 命令 | 结果 |
|---|---|---|
| 构建握手 | `pnpm build` | EXIT=0，**握手 4/4 PASS** |
| 类型检查 | `npx tsc --noEmit` | EXIT=0 |
| 全量测试 | `pnpm test` | **34 files / 730 tests PASS**（r0 724 → +6），Duration 2.85s |
| R1 红线 | `git show HEAD:patcher/zctx-patch.mjs \| node <切片+sha256>` | chars=14889 bytes=14926 **sha256=8e2d0b7e…059b0f9**（未变） |
| 零凭据字面量 | `grep zctx_[0-9a-z]+_[0-9a-f]{16,} src/tests/scripts` | 零命中 PASS |
| 零请求体改写面 | `grep llm.stream/req.body/internal/config src/ui src/client` | 零命中 PASS |
| 工作树 | `git status --short`（build 后按 Z3 `checkout --` 还原 4 lib chunk） | 业务文件干净，仅剩评审产物 `?? handoffs/ ?? scorecards/`（预期） |

## 十、复评 [阻断] / [建议]

- **[阻断]：无。**
- **[建议]：无（r0 六条全部 fixed/verified）。**

## 十一、复评评分（终评）

| 维度 | 分值 | 终评得分 | 证据要点 |
|---|---:|---:|---|
| 正确性 | 25 | 25 | B5-1/3 独立复现真渲染/真抛点；R1 三值未变；730 绿；tsc 0 |
| 完整性 | 20 | 20 | r0 六建议全闭；B5-1 链接兑现、B5-5 切换控件落地 |
| 一致性 | 20 | 20 | B5-1 实现/文档/测试一致；B5-2 单一注册；manifest/patch 未变 |
| 可验证性 | 15 | 15 | 每项附命令+输出；B5-3 真抛点臂源码审+Proxy 验证 |
| 安全回滚 | 10 | 10 | 零凭据/零改写面；closure 全 post-merge/open，block 门无 OPEN |
| 可维护性 | 10 | 10 | B5-2/3/5/6 均正向改进；叶子边界保持 |
| **总分** | **100** | **100** | evaluator=reviewer-B5，author=coder，评审人≠作者 |

## 十二、诚实声明

- 真机未碰：端到端浏览器三块渲染/5s 轮询/face 灯、三重证据、非 loopback 真机只读、设置页 primitive 可见性、真机会话切换、真机 React 降级——均属 B6，未验证。
- closure 5 项保持 open 待 B6 定谳；BENCH-L2 原始 `user_approved_deferred` 不因探针自动关闭。
- 无法验证项：无（复评所有项均取得证据；真机项明确标注属 B6）。
- 终评 100/100：r0 六条 `[建议]` 全部 `fixed/verified`，无 `[阻断]`、无 OPEN 建议项；真机开放项属 B6 不作阻断。
