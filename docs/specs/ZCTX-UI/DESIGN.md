# ZCTX-UI 详细技术设计（B2 · architect）

> 任务：ZCTX-UI（设置/查看/统计实时面板）+ 发现的问题 P0-P2 修复
> 分支/工作树：`feat/ZCTX-UI` / `worktrees/ZCTX-UI`（基线 B1 charter `03ec933`，任务 base_sha `b1e5518`）
> 角色：architect，只做结构/契约设计，不写实现代码；真机不碰。
> 方案依据：`docs/specs/ZCTX-UI/options.md` 选项 C（两阶段：阶段一 webServer 只读账本桥 + 独立 UI 页；阶段二 settings.section slot 摘要卡）。
> 研究底稿：`G:\000Github\zDSH\zDSH-docs\R&D\zctx-20261112\RES-UI-FEASIBILITY.md`（220 行，verifier 7/7 确认）+ `VERIFY-UI.md`（7 条 CONFIRMED，4 附条件）。
>
> 本文件中所有 `file:line` 均为本次实读锚点；凡"推断/裁定"均显式标注，不冒充事实。token 处理纪律：**源码/示例/测试禁写可用凭据字面量**，bridge token 一律运行时生成。

---

## 0. 设计总纲与依赖方向（结构约束）

```
浏览器 UI 页 / client fiber
      │ 同源 fetch（GET snapshot / GET·POST config）
      ▼
[新增] src/ui/*  ──(注入依赖)──▶  zctx 账本（进程内存，只读）
      │                              │
      │ webServer.register            │ 薄封装既有访问器：
      ▼                              │  store.ts / tools.ts / plugin.ts
宿主 webServer（web/desktop profile） │  （不改既有折叠逻辑）
      │
      ▼
configEditor.edit → profile cordis.patch.yml 的 dsh-zcontext 行 config
```

**四条结构铁律**（交付 coder，详见 §9）：
1. `src/ui/**` 只读账本，禁止调用 `llm.stream` / 注册任何 `llm/stream` listener（R1 零请求体改写）。
2. 快照 API 必须薄封装既有访问器，**禁止从零造数据结构**。
3. 配置写入只走 `configEditor.edit`（宿主 API），禁止插件直接 fs 改 `cordis.patch.yml`。
4. 全程 additive：新文件 + 新路由 + manifest 字段；既有 face 接线、R1 段、config schema 不动。

---

## 1. 文件级改动面清单（精确路径）

> 图例：**[新]** 新建文件；**[改]** 修改既有文件；**[manifest]** 只碰 manifest/构建描述。
> 全部路径相对工作树根 `G:\000Github\zDSH\zDSH-plugins\dsh-zcontext\worktrees\ZCTX-UI`。

### 1.1 src/ 新增（阶段一核心，B3）

| 路径 | 类型 | 职责（精确） |
|---|---|---|
| `src/ui/types.ts` | [新] | `ZctxSnapshot` / `FaceHealthView` / `FaceEvidence` / `MarkedNumber` 等 UI 专有结构类型；只依赖 `src/types.ts`、`src/store.ts`、`src/tools.ts` 的既有类型，不反向依赖。 |
| `src/ui/snapshot.ts` | [新] | `createSnapshotSource(deps)` 工厂 + `snapshotFor(sessionId?)`（`§2`）；只读封装，依赖注入 seam，便于单测注入账本。 |
| `src/ui/auth.ts` | [新] | `createTokenSource()`（基于 `node:crypto` 的 `randomBytes(16).toString('hex')`，零字面量）、`authorizeRequest(req, token)`（token 头 / loopback / same-origin 三选一）、`sendJson(res,status,payload)`；不依赖任何新 npm 包。 |
| `src/ui/routes.ts` | [新] | `registerUiRoutes(ctx, deps)`：向宿主 `webServer.register` 挂 4 条路由（页面 + snapshot GET + config GET/POST），返回 disposer 供 `ctx.effect` 注销；handler 严格原生 req/res 形态（`§3`）。 |
| `src/ui/page.ts` | [新] | 内联 HTML 字符串常量 `UI_PAGE_HTML`（单文件交付完整页面，三块：查看/统计/设置，内联 CSS+JS，同源 fetch 5s 轮询）；**禁用 heredoc 生成，用 Write/Edit 工具直写**（Z23/条目32/A14）。 |
| `src/ui/config-write.ts` | [新] | `writeOverlay(ctx, patch)`：经 `configEditor.edit(entry, change)` 把九字段 + face 开关写入 profile overlay（`§3.4`）；能力探测降级。 |
| `src/ui/face-probe.ts` | [新] | `detectFaceActivation(ctx, state)` 三态探针 + 可见 sink（`§4`）；被 `snapshotFor` 消费为 `faceHealth`。 |
| `src/ui/index.ts` | [新] | 聚合出口：re-export 上述模块的公开函数与类型；`ZcontextPlugin` 只从此处 import UI 面。 |

### 1.2 src/ 修改（阶段一接线，B3）

| 路径 | 类型 | 改动点（精确） |
|---|---|---|
| `src/plugin.ts` | [改] | ① 构造期末尾（`wire*Face` 全部返回后，:424 之后）调用 `registerUiRoutes(ctx, { snapshotFor, configWrite, detectFaceActivation })`，路由 disposer 交 `ctx.effect`；② 新增 public 方法 `snapshotFor(sessionId?)`（委托 `createSnapshotSource`），复用 `resolveWatchedSession`(:905)/`currentSession`(:1178)/`storeFor`(:1065)/`validatorConfig`(:1113)/`windowCache`(:1114)；③ `wireToolFace`(:479) 与 `wireGuidanceFace`(:511) 记录成功计数到私有字段 `toolFaceRegistered` / `guidanceRegistered`，供 face 探针读取（**只加记数，不改降级语义**）；④ 新增 public 方法 `faceHealth()`（委托 `detectFaceActivation`）。不改 `runtime` 既有 hook、不改 R1 段、不改任何 face 的接线顺序。 |
| `src/tools.ts` | [改] | **原则：不改**。若 coder 选择把 `snapshotFor` 的 range/budget 计算逻辑复用为纯函数，可在 tools.ts 仅 `export` 既有内部 helper（如把 `foldableRanges` 的调用封装），但**不得改 renderStatus 行为**。首选：snapshot 模块直接调用已导出的 `computeBudget`/`foldableRanges`/`routedRequestTarget`（现成导出见 `src/index.ts:44/111/136`），tools.ts 保持零改动。 |
| `src/config.ts` | [改] | **不改**。`ZcontextConfig` 已含九字段 + face 开关开关项（`§3.4`），schema/volatile 不动（U1 已修复，VERIFY-UI 第 4 条 CONFIRMED）。 |
| `src/index.ts` | [改] | 追加 UI 面 re-export：`export { ... } from './ui/index.ts'` + `export type { ZctxSnapshot, FaceHealthView, ... }`；不改既有 182 行导出契约（Z7/身份锚点）。 |

### 1.3 src/ 新增（阶段二 slot 摘要卡，B4）

| 路径 | 类型 | 职责 |
|---|---|---|
| `src/client/index.ts` | [新] | client fiber：`export const name='dsh-zcontext'` / `export const inject=['slots']`（最小确定集）/ `export function apply(ctx)`；`settings.section` 注册摘要卡 + 跳转 `/zctx-ui` 链接；全部用 `ctx.slots?.inject(key, () => ctx.slots.register(...))`；组件 `React.createElement` + `styles.insert`，React 经 factory 的 `require('react')` 取得。 |

### 1.4 tests/ 新增（B3/B4）

| 路径 | 类型 | 覆盖 |
|---|---|---|
| `tests/ui-snapshot.spec.ts` | [新] | V1/V8：注入账本断言 `window/budget/ranges/folds/attribution/cache/faceHealth` 字段与 measured|estimated 标注；sessionId 缺省走 latest-watched；无 session 返回空快照 + degraded。 |
| `tests/ui-auth.spec.ts` | [新] | V4：合法 token / loopback / same-origin 三臂通过；越权臂 403；源码/测试零 token 字面量（运行时生成断言）。 |
| `tests/ui-routes.spec.ts` | [新] | V2/V3：4 路由 method 检查（405）、handler 原生 req/res 形态（`writeHead`/`end` 被调用）、async-iterable body 读取、UI 通道不触发 `llm.stream`。 |
| `tests/ui-config-write.spec.ts` | [新] | V2/设置：mock `configEditor.edit`，断言九字段 + face 开关落到 `dsh-zcontext` 行 patch；无 configEditor 时降级（503/501），不抛。 |
| `tests/ui-face-probe.spec.ts` | [新] | V5/V6：三态（active/degraded/absent）证据；fail-soft 降级落可见 sink（stderr + snapshot.faceHealth），非仅 `ctx.logger.warn`。 |
| `tests/client-inject-gate.spec.ts` | [新] | V7：`slots` 缺席 → 惰性 no-op（不 PENDING）；`settings.section` key 存在且新 id 不复用 shipped id；bundle 头部 `factory(require)` 单参形态（Z1）；不传 `priority`。 |

### 1.5 根目录 / manifest / 构建 / 文档

| 路径 | 类型 | 改动点 |
|---|---|---|
| `package.json` | [manifest] | 加 `dsh.client`（`platform:'web'`, `inject:['@deepseek-ai/dsh-client-ui-slots']`，`§6`）；加 `exports['./client']='./dist/client.cjs'` 与 `'.'` 入口；`files` 含 `dist`；**不改** `dsh.bundle.patch`、`main`、`types`、devDependencies（不引新依赖）。 |
| `tsdown.config.ts` | [manifest] | 增加 client bundle 第二配置（独立于 `lib/index.js` 的主构建）：`format:'cjs'`、输出到 `dist/client.cjs`、banner/footer 采用 Z1 单参形态；主 entry 配置不变。 |
| `cordis.patch.yml` | [不碰] | 保持单行 `- insert: [{id: dsh-zcontext, name: dsh-zcontext}]`；UI 路由与 slot 都在运行时注册，patch 文件无需新增行。 |
| `README.md` / `README.zh.md` | [改] | 新增"UI 面板"章节：访问方式（`/zctx-ui`）、三块说明、bridge token 来源（运行时生成）、**诚实边界反-C3**：UI 只解决"查看/统计免开会话"，autofold 仍可能消耗 token；不夸大"消灭所有 token"。双语同步。 |
| `tasks/ZCTX-UI/*` | [改] | 按全局协议增量落盘（progress/checkpoint/scorecards/closures），非本设计文档职责。 |

> 净变更面：src 新增 9 + 改 2（plugin.ts/index.ts），tests 新增 6，manifest 改 2，README 双语改，cordis.patch.yml 不动。既有 `src/tools.ts`（除可选纯 export）、`src/config.ts`、`store.ts`、`fold-engine.ts`、`autofold.ts` 零改。

---

## 2. 快照 API 契约（V1）

### 2.1 复用现存取器（精确函数名 + 调用链，不新造）

verifier 第 5 条已确认："从零做快照 API"措辞夸大——内部已有可复用通路。本设计**只薄封装 + 暴露**：

| 复用对象 | 精确签名 / 位置 | 用于快照字段 |
|---|---|---|
| `ZcontextPlugin.resolveWatchedSession` | `private resolveWatchedSession(sessionId: string): SessionLike \| undefined`（`src/plugin.ts:905`） | sessionId → live session（显式绑定） |
| `ZcontextPlugin.currentSession` | `private currentSession(): SessionLike \| undefined`（`src/plugin.ts:1178`） | sessionId 缺省时的 latest-watched |
| `ZcontextPlugin.liveSessions` | `private readonly liveSessions = new Set<object>()`（`src/plugin.ts:283`） | watched 集合（判空） |
| `ZcontextPlugin.storeFor` | `private storeFor(session: SessionLike): FoldStore`（`src/plugin.ts:1065`） | 取该 session 的账本 store |
| `ZcontextPlugin.validatorConfig` | `private validatorConfig(session: SessionLike): ValidatorConfig`（`src/plugin.ts:1113`） | `foldableRanges` 的配置入参 |
| `windowCache`（WeakMap） | `private readonly windowCache`（`src/plugin.ts:281`，写入 `:1165`） | `window.contextWindow`（已缓存，5s 轮询不重新 resolve） |
| `FoldStore.observabilitySnapshot` | `observabilitySnapshot(): ObservabilitySnapshot`（`src/store.ts:881`） | `attribution`: threeState / cleanSampleRatio / breakevenTable / resetSummary |
| `FoldStore.usageSnapshot` | `usageSnapshot(): UsageSnapshot`（`src/store.ts:732`） | `cache`: samples / measured / latest（measured|estimated 标注源） |
| `FoldStore.ledgerEntries` | `ledgerEntries(): readonly FoldLedgerEntry[]`（`src/store.ts:688`） | `folds` + 累计 net saved |
| `FoldStore.surfaceNodes` | `surfaceNodes(): SurfaceNode[]`（`src/store.ts:708`） | `ranges` 的 surface 输入 |
| `FoldStore.foldAttributions` | `foldAttributions(): readonly FoldUsageAttribution[]`（`src/store.ts:872`） | `attribution` 的 retry/quality 细节（可选展开） |
| `FoldStore.anomalies` | `anomalies(): readonly StoreAnomaly[]`（`src/store.ts:912`） | `degraded` 诊断 |
| `computeBudget` | `computeBudget({contextWindow, maxOutput?})`（`src/budget.ts`，导出于 `src/index.ts:44`） | `budget`（triggerLine/maxOutputCap/reserve/…） |
| `foldableRanges` | `foldableRanges(nodes, validatorConfig)`（`tools.ts:121` import、`:745` 调用；经 `src/index.ts` 导出） | `ranges`（startSeq/endSeq/estimatedTokens/protected） |
| `routedRequestTarget` | `routedRequestTarget(session)`（`src/tools.ts:561`，导出于 `src/index.ts:136`） | 缺 window 时的 degraded 原因 |
| `tokenMeter.measure` | `runtime.tokenMeter.measure(session).totalTokens`（`src/tools.ts:698` 同款读法） | `window.totalTokens` |
| `adapterHealth` / `patchFace` / `autofoldFace` | `runtime` hooks（`src/plugin.ts:367/368/380`，类型 `src/tools.ts:498/511/546`） | `faceHealth` 的既有面状态 |

**调用链（快照生成，同步、只读）**：
```
snapshotFor(sessionId?)
  ├─ resolve: sessionId!==undefined ? resolveWatchedSession(sessionId) : currentSession()
  ├─ session===undefined → emptySnapshot(sessionResolution='none')  // 不抛，带 degraded
  ├─ store = storeFor(session)                         // plugin.ts:1065
  ├─ window.contextWindow = windowCache.get(session)  // plugin.ts:1114/1165，source='cache'
  ├─ window.totalTokens = tokenMeter?.measure(session).totalTokens  // try/catch → degraded, basis='unknown'
  ├─ budget = contextWindow!==undefined ? computeBudget({contextWindow, ...(maxOutput?)}) : undefined
  ├─ ranges = foldableRanges(store.surfaceNodes(), validatorConfig(session))
  ├─ folds  = store.ledgerEntries()
  ├─ attribution = observabilitySnapshot(); clean = cleanSampleRatio >= runtime.cleanSampleFloor
  ├─ cache = usageSnapshot()                           // measured|estimated 权威源
  └─ faceHealth = detectFaceActivation(ctx, state)     // §4
```
> **R1 铁律**：此链全程只读，不注册任何 `llm/stream` listener、不调用 `llm.stream`、不改 `internal/config`、不触碰请求体。`snapshotFor` 可在 GET handler 中安全调用。

### 2.2 `snapshotFor` TypeScript 签名与返回结构

```ts
// src/ui/types.ts —— 标注源：measured=实测 / estimated=估算 / unknown=不可得
export type Basis = 'measured' | 'estimated' | 'unknown' | 'none'
export interface MarkedNumber { readonly value: number; readonly basis: Basis }

export interface ZctxSnapshot {
  readonly version: 1
  readonly generatedAt: number                    // Date.now()
  readonly sessionId: string | undefined
  readonly sessionResolution: 'explicit' | 'latest-watched' | 'none'
  readonly window: {
    readonly contextWindow: number | undefined     // 来自 windowCache（已 resolveModelInfo 的实测值）
    readonly totalTokens: MarkedNumber | undefined // tokenMeter.measure → measured；失败 → unknown
    readonly pressurePct: number | undefined        // totalTokens/contextWindow*100
    readonly routed: { provider: string; model: string } | undefined
  }
  readonly budget: Readonly<Budget> | undefined     // src/types.ts:182 既有类型，不新造
  readonly ranges: readonly FoldableRange[]          // src/types.ts:325 既有（estimatedTokens 内建标注语义）
  readonly folds: readonly FoldLedgerEntry[]         // src/store.ts:123
  readonly attribution: {
    readonly threeState: ThreeStateCounts            // measured/semi/estimated 计数（src/types.ts:590）
    readonly cleanSampleRatio: number
    readonly clean: boolean                           // >= runtime.cleanSampleFloor
    readonly breakevenTable: readonly BreakevenTableRow[]
    readonly resetSummary: readonly ResetSummaryRow[]
    readonly foldCount: number
    readonly netTokensSaved: MarkedNumber             // Σ(before-after)，basis 继承 threeState 主导态
  } | undefined
  readonly cache: {
    readonly samples: number
    readonly measured: boolean                        // UsageSnapshot.measured
    readonly basis: 'measured' | 'estimated' | 'none'
    readonly latest?: {
      readonly cacheReadTokens?: number
      readonly cacheWriteTokens?: number
      readonly measured: boolean                      // UsageSample.measured（src/types.ts:409）
    }
  }
  readonly faceHealth: FaceHealthView                 // §4
  readonly degraded: readonly string[]                // 诚实降级行（复用 renderStatus 口径）
}

// src/ui/snapshot.ts
export interface SnapshotDeps {
  readonly runtime: ZctxToolRuntime                   // 复用 src/tools.ts:473（已含 storeFor/validatorConfig/tokenMeter/cleanSampleFloor/hooks）
  readonly resolveSession: (id: string) => SessionLike | undefined
  readonly currentSession: () => SessionLike | undefined
  readonly windowFor: (session: SessionLike) => number | undefined
  readonly faceHealth: () => FaceHealthView
}
export function createSnapshotSource(deps: SnapshotDeps): {
  snapshotFor(sessionId?: string): ZctxSnapshot
}

// src/plugin.ts（public 方法，thin delegate）
snapshotFor(sessionId?: string): ZctxSnapshot            // this.snapshotSource.snapshotFor(sessionId)
```

**measured|estimated 标注规则（裁定）**：
- `cache`：直接透传 `UsageSnapshot.measured` 与 `UsageSample.measured`（权威源，S6 口径）。
- `attribution.threeState`：保留 `measured/semi/estimated` 三分计数；`netTokensSaved.basis` 取三态中占比最高者（measured > semi > estimated），并在 UI 明示"主导态"。
- `window.totalTokens`：`tokenMeter.measure` 成功=measured，失败=unknown；`contextWindow` 来自 host `resolveModelInfo` 的缓存=measured（若 windowCache 无值则字段 undefined，不给 estimated 假值）。
- `ranges[].estimatedTokens`：既有命名自带 estimated 语义，UI 标注为估算。

### 2.3 sessionId 缺省解析（裁定 A4-5，研究未解决项）

**裁定：显式 id 优先；缺省时取 `currentSession()`（最近创建的 live session），并把解析路径写入 `sessionResolution` 字段，绝不静默。**

- 理由：`currentSession()` 是插件现存的"全局最近 session fallback"（`nudgeProvider` 在 `src/plugin.ts:1208` 已用 `attributed ?? this.currentSession()`），复用它=零新逻辑且语义一致；UI 处在浏览器侧无天然 session 上下文，等价场景正是 nudge 的 fallback。
- 显式路径：UI 的 `?session=<id>` 参数 → `resolveWatchedSession(id)`；不可见/已 disposed 的 id → 返回 `sessionResolution:'none'` 的空快照 + degraded 行"session <id> not watched"，**不回退到 latest**（避免张冠李戴）。
- 无 session：`liveSessions` 为空 → 空快照，三块显示"暂无活动会话"，faceHealth 仍照常显示（face 状态与 session 无关）。
- UI 轮询策略：页面加载时先不带 session 取 latest-watched；检测到 `sessionId` 变化后带上 `?session=` 锁定；多会话切换由 UI 提供选择（数据来自快照的 sessionId 字段）。
- **V8 验收方法**：单测三臂——①显式 watched id 返回该 session 账本；②缺省返回 latest-watched；③无 session 返回空快照 + degraded；真机 UI 页核对 sessionId 显示与选择。

---

## 3. webServer UI 路由契约（V2/V3/V4）

### 3.1 宿主契约（WebRoute，严格原生，禁 Express 风格）

事实锚点：`RES-UI-FEASIBILITY.md` A2-1（S9 webserver/src/index.ts:43-52,302）；AutoPilot `src/index.ts:410-497`（verifier 3 CONFIRMED，实调用 :454/:491）。

```ts
type WebRoute = {
  kind: 'exact' | 'prefix'
  path: string                                     // 绝对 pathname，无尾斜杠
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
}
```
handler 拥有完整响应生命周期：
- 响应：`res.writeHead(status, { 'content-type': ... }); res.end(JSON.stringify(payload))`（对齐 AutoPilot `sendJson` :418-420）。
- 读 body：`for await (const chunk of req) { body += typeof chunk==='string' ? chunk : chunk.toString('utf8') }`（:430-439）；**禁 `req.text()` / `req.headers()`**。
- header：小写 `req.headers[name]`，重复值取首个（Node http 形态，AutoPilot `authorizeAction` :564-568）。
- method：`req.method`（GET/POST，否则 405）。
- 服务取法：`const webServer = ctx.get('webServer')`（宿主）/`getService('webServer')`（AutoPilot），capability-probe；无 webServer（CLI headless）→ 整面跳过，info 日志，不抛（A5-2）。
- disposer：`webServer.register(...)` 返回 `() => void`，统一经 `ctx.effect?.(() => () => unregister(), 'zctx-ui-<name>-route')` 注销（RA1d/FileHub aab73d7 先例）。

### 3.2 四条路由

| 路由 | method | 授权 | 响应 | 说明 |
|---|---|---|---|---|
| `/zctx-ui` | GET | same-origin | `text/html` + `UI_PAGE_HTML` | 页面入口；同源浏览器可达，无需 token |
| `/zctx-ui/api/snapshot` | GET | token OR same-origin/loopback | JSON `ZctxSnapshot` 或 `{ok:false,error}` | V1 数据；`?session=<id>` 可选 |
| `/zctx-ui/api/config` | GET | token OR same-origin/loopback | JSON `{ fields, faceSwitches, writable }` | 九字段当前值 + face 开关 + 是否可写 |
| `/zctx-ui/api/config` | POST | token OR (same-origin AND loopback) | JSON `{ok:true}` / 403 / 503 | 写 overlay；**写从严**（见 §3.3） |

> 非授权统一 403 形态：`res.writeHead(403, {'content-type':'application/json; charset=utf-8'}); res.end(JSON.stringify({ ok:false, error:'unauthorized' }))`。method 不符 405 同理（`error:'method not allowed'`）。

### 3.3 授权方案（V4，参照 AutoPilot bridge token + loopback）

**运行时 token 生成（源码/测试零字面量）**：`src/ui/auth.ts` 内
```ts
import { randomBytes } from 'node:crypto'
export function createTokenSource(): { token(): string } {
  return { token: () => randomBytes(16).toString('hex') }   // 无凭据字面量
}
// 构造期：const bridgeToken = `zctx_${Date.now().toString(36)}_${createTokenSource().token()}`
```
- token 存活于 `registerUiRoutes` 闭包，不写盘、不日志、不进快照；UI 通过 first-frame/页面内注入获得（同源页面由 handler 内联注入 `window.__ZCTX_TOKEN__`，仅本次会话有效）。
- `authorizeRequest(req, token)` 判定顺序（对齐 AutoPilot `authorizeAction` :560-574）：
  1. `x-zctx-token` 头非空 → 恒等比较 `=== bridgeToken`（恒定时间比较可选，非硬门）。
  2. 无 token 头 → `origin` 存在则 same-origin（`new URL(origin).host === req.headers.host`）。
  3. 无 origin → loopback 判定：`req.socket?.remoteAddress` ∈ `{127.0.0.1, ::1, ::ffff:127.0.0.1}`（同源本地 UI 放行）。
  4. 全不满足 → false。
- **写路由收紧**：POST `/config` 要求 token 命中，或（same-origin AND loopback）双条件；远程非 loopback 只读（直接对应未解决项 A2-4 的验收，见 §8）。
- V4 验收：单测「合法 token / loopback / same-origin」三臂通过 + 「伪造 token / 非 loopback 无 token POST」403；`grep` 断言源码/测试无 `zctx_[0-9a-z]+_` 之外的凭据字面量。

### 3.4 UI 三块数据绑定与配置写入通道

**查看（5s 轮询 snapshot）**：`setInterval(() => fetch('/zctx-ui/api/snapshot' + (session? '?session='+encodeURIComponent(session):'')), 5000)`，渲染 window（tokens/window/pct/trigger）、budget 六行、ranges 表、folds 表、cache measured/estimated 徽标、faceHealth 灯。数据只走 HTTP，**不调 `llm.stream`**（V3 代码审锚点）。

**统计（累计字段）**：从同一快照的 `attribution` 渲染：threeState 三分占比、`cleanSampleRatio`/`clean`、`breakevenTable` 中 `repaid===true` 计数、`resetSummary`、`folds` 的 `netTokensSaved`（带 basis 标注）；faceHealth 中的 autofold `runs/foldsCommitted/netTokensSaved`（来自既有 `runtime.autofoldFace`）。

**设置（九字段 + face 开关，POST 写 overlay）**：
- 九字段（裁定，来自 `src/config.ts` `CONFIG_FIELD_SPECS` 前 9 个核心折叠/预算字段）：`enabled`、`nudgeThresholds`、`keepRecentTokens`、`maxFoldFraction`、`minFoldableTokens`、`protectionFloorTokens`、`summaryFloorChars`、`summaryCeilingChars`、`netShrinkTolerance`。
- face 开关（4 个 toggle）：`observe.enabled`、`patch.guardObserveEvents`、`autofold.enabled`、`preflightMode`（`off|observe|enforce`，下拉）。
- **配置写入通道精确 API**：宿主 `ctx.configEditor.edit(entry, change)`（`packages/boot/config-editor/src/index.ts:87-90`），其中 `entry = ctx.configEditor.entries().find(e => e.options.id === 'dsh-zcontext')`，`change = (current, inherited) => ({ ...current, ...patch })`；落地路径 = profile `cordis.patch.yml` 的 `dsh-zcontext` 行 config。这与 `RES-plugin-api.md:172` 与 `:215`（`SettingsForms.update(ns, patch)` → `configEditor.edit` → profile `cordis.patch.yml` 行 config）一致。
  - 从 webServer handler 取服务：`(ctx as { get?(k:string):unknown }).get?.('configEditor') ?? (ctx as {configEditor?:unknown}).configEditor`，capability-probe。
  - 缺席/无 entry → POST 返回 `503 {ok:false, error:'config editor unavailable'}`，**不抛、不伪造成功**。
  - 生效时机：`edit` 触发 Loader reconciliation，配置在重载后生效；UI 明示"保存后下次加载生效"，不承诺热更新既有 face。
  - 边界：仅写上述 13 个键；不改 `providers`（结构化段，留给 overlay 手工）、不改 R1 段、不写凭据。

### 3.5 静态页面交付形态裁定（内联 HTML vs 独立 bundle）

**裁定：内联 HTML 字符串常量（`src/ui/page.ts` 的 `UI_PAGE_HTML`），编译进 `lib/index.js`；不交付独立静态文件、不运行时 fs 读盘。**

理由（逐条对应约束）：
1. **git-form 安装零构建**（Z3：`lib/` 为 committed artifact，git 安装不跑 build）——内联字符串随 `lib/index.js` 一同入库，天然权威；独立 HTML 文件必须额外提交且在运行时按路径 fs 读，多一个"文件缺失/路径错"失败面。
2. **Z3 产物权威**：单一权威产物（`lib/index.js`），不存在"页面文件与代码版本不同步"。
3. **零路径穿越 / 零 404**：AutoPilot B9 曾因桥路由未注册导致 404 面板空白；内联页面把 HTML 与路由绑在同一 handler，注册即完整。
4. 代价与缓解：HTML/CSS/JS 写在 TS 模板字符串中——必须避免 `${}` 插值冲突（用字符串拼接或转义），且**用 Write/Edit 工具直写，禁 heredoc**（Z23/条目32/A14）。

> 阶段二 slot 摘要卡的 client bundle 是另一产物（`dist/client.cjs`，`§5/§6`），与阶段一 UI 页内联 HTML 不冲突：前者服务原生设置入口，后者服务实时数据页。

---

## 4. face 激活探针（V5，BENCH-L2 前置）

### 4.1 设计：`detectFaceActivation(ctx, state)`

```ts
// src/ui/face-probe.ts
export type FaceState = 'active' | 'degraded' | 'absent'
export interface FaceEvidence {
  readonly signal: 'tools.register' | 'system-prompt.guidance' | 'guard-observe' | 'observe'
  readonly ok: boolean
  readonly detail: string                            // 人读诊断，不泄露凭据
}
export interface FaceHealthView {
  readonly state: FaceState
  readonly evidence: readonly FaceEvidence[]
  readonly probedAt: number
  readonly summary: string
}
export interface FaceProbeState {                      // 由 plugin.ts 传入的可观测记数（新增私有字段）
  readonly toolFaceRegistered: number                  // wireToolFace 成功数（plugin.ts wireToolFace 记录）
  readonly toolFaceBuilt: number
  readonly guidanceRegistered: boolean                 // wireGuidanceFace 成功标志
  readonly observeWired: boolean                       // this.observe !== undefined（plugin.ts:286）
  readonly guardBridgePresent: boolean                 // this.guardBridge !== undefined（永远 true）
  readonly guardRecordsSeen: number                    // 当前 session guardBridge.summary()?.total ?? 0
}
export function detectFaceActivation(
  ctx: HostContextLike,
  state: FaceProbeState,
  sink?: (line: string) => void,                        // 可见 sink（默认 stderr 直写）
): FaceHealthView
```

**三重证据探测**（对齐 Z28 "工具清单 + 系统提示 + 行为痕迹"三重证据）：
1. `tools.register`：证据 = `state.toolFaceRegistered > 0`；`state.toolFaceBuilt > 0 && registered === 0` → degraded（注册被拒，P3 HF-15 路径）；`ctx.tools?.register` 本身缺席 → absent 信号。
2. `system-prompt.guidance`：证据 = `state.guidanceRegistered === true`；`ctx.systemPrompt?.section` 缺席 → absent 信号；在盘但未成功 → degraded。
3. `guard-observe` / `observe`：证据 = `state.observeWired`（observe listener 在盘）且 `guardBridgePresent`；`guardRecordsSeen > 0` 为行为痕迹加分项（无记录不等于 absent——patches 未装时事件从不存在，属合法 inert）。

**三态判定（裁定）**：
- `active`：tools 信号 OK **且** guidance 信号 OK **且**（observe 或 guard-observe 至少一个在盘）。
- `absent`：三类信号全部缺席（无 tools.register、无 systemPrompt.section、observe/guard 全无）→ "桌面 face 未激活"。
- `degraded`：部分满足（任一信号在盘但另一信号缺席/被拒）→ "face 部分降级"，UI 显示琥珀/红。
- **fail-soft**：探针自身每个信号 try/catch，任何异常都产出 evidence(`ok:false, detail`) 而非抛出；**绝不 memoize 缺席结果**（Z25：缺席必须可重试，probe 每次 on-demand 重算，不缓存）。

### 4.2 fail-soft 降级落可见 sink（V6 / Z28）

- 探针在首次进入 `degraded`/`absent`（或状态跃迁）时，写一行诊断到**组合无关的可见 sink**：默认 `process.stderr.write('[zctx-ui] face ...\n')`（headless/web/desktop 都有 stderr），可注入 `sink` 便于单测捕获；**不得仅依赖 `ctx.logger.warn`**（Z28：headless 无 sink 全静默）。
- 同时把 `FaceHealthView` 写入 `snapshotFor(...).faceHealth`，UI 三块的"查看"区显示健康灯 + `summary` 诊断，实现"UI 显示 face 健康度"（V6）。
- 单测断言：注入假 sink，触发降级 → sink 收到行 且 `snapshot.faceHealth.state==='degraded'` 且 `evidence` 含被拒信号详情。

### 4.3 范围声明（防夸大）

**该探针是"桌面 composition 里 zctx face 是否活"的机器可读判据（V5 真机验收读它），不是"解决 BENCH-L2"。** 真机浏览器实测（模型工具清单列 zctx_*、系统提示含 zctx 内容、行为痕迹）仍是验收项（V8 端到端真机）；探针只提供"UI 无数据 vs face 未激活"的可区分诊断，避免 Z28 静默失效。BENCH-L2 原始 disposition=`user_approved_deferred` 不因本探针自动关闭。

---

## 5. slot 阶段二（V7）设计

### 5.1 client bundle 工厂契约裁定（Z1）

**实读证据**：
- filehub `lib/client.js` 头：`window.__ModuleLoader__.load({ id: 'dsh-filehub', factory: (require) => { var module = { exports: {} }; var exports = module.exports; ... return module.exports; } });`（尾确认 `module.exports={apply:At,inject:Bt}`）。
- AutoPilot `dist/client.cjs` 头同形态；`src/client/index.ts:45/63` 导出 `apply` + `createConsoleFiber`。
- 全局坑 Z1（`ZDSH-LESSONS.md:6-13`）：旧式 `factory(require, module, exports)` 三参在新加载器下 `exports` 为 undefined → `Object.defineProperty(undefined)` 炸 boot。

**裁定：单参 `factory(require)`，bundle 内自建 `module/exports` 骨架，footer `return module.exports; });`。** 不用三参、不依赖加载器注入 `module`/`exports`。React 经 `factory` 的 `require('react')` 取得（filehub 同款加载器 shim；Z1 辨析：禁的是源码级 `import` 设计系统组件，不是 `require('react')` 本体）。

### 5.2 inject 服务集最小确定集（Z21/Z25/A1-2）

**裁定：client fiber 只声明 `export const inject = ['slots']`。**
- `slots` 是 shipped web/desktop 必挂服务（CLIENT_NOTES @69；A1-1 CONFIRMED），唯一确定存在。
- **不声明** `locale`、`configEditor`、`webServer`、`settingsScope` 等：`settingsScope` 在官方 0.1.7 被删，声明它就 PENDING（AutoPilot 0.1.7 事故，A1-2/反-C1）；其余以能力探测 `ctx.locale?.register(...)` / `ctx.slots?.inject(...)` 降级访问。
- **Z21**：若未来引入 Service 子类桩，必须显式 `constructor(ctx){ super(ctx,'<name>') }`，禁漏写（漏写→provide 键撞 `[object Object]`→静默 PENDING）。本设计阶段二不引入新 Service 子类，故设计上已规避，实施卡面仍需核。
- **Z25**：能力探测若做 memoize，只缓存成功、缺席重试；本设计探针 on-demand 不缓存，规避。

### 5.3 React 组件形态与降级

- 组件：`React.createElement`（经 `require('react')`）+ `styles.insert(css)` 注入样式，颜色用主题变量 `var(--dsw-alias-*)`，**禁 `import react` / 设计系统组件**（CLIENT_NOTES @71-72，A1-3）。
- 注册：`ctx.slots.inject('settings.section', () => ctx.slots.register({ name:'settings.section', id:'dsh-zcontext-summary', order: 50, registrant:'dsh-zcontext', label:... }, SummaryCard))`（slot key 实读 `slot-catalog.ts:2787`，list/root/replaceRisk=none；新 id 不复用 shipped；传 `order` **不传 `priority`**）。
- 卡片内容：折叠次数 / 窗口占比摘要（同源 fetch `/zctx-ui/api/snapshot`）+ 一个跳转 `<a href="/zctx-ui">打开 zcontext 面板</a>` 链接。
- **slot 表达力不够时的降级 = 链接（反方证据 2 / 反-C2）**：Workbench（治理件）曾直挂 DOM 绕过 slot，说明 slot 对深度交互有上限，纯插件不可依赖特权路径。故摘要卡只放"摘要文本 + 链接"，复杂设置/统计留在 `/zctx-ui` 页；`slots` 缺席或 inject 门失败 → 惰性 no-op（不 PENDING，不抛），卡片自激活留待 slot 声明恢复（AutoPilot `settings.plugin.item` 同款降级）。
- V7 验收：单测——`slots` 缺席 → no-op 不 PENDING；key/id/order 合规；bundle 头部单参形态；无 `priority`；真机设置页出现摘要卡或（降级时）确认不 PENDING。

---

## 6. manifest 改动（B-X1）

### 6.1 `dsh.client` 精确形态

```jsonc
"dsh": {
  "manifestVersion": 1,
  "bundle": { "patch": "./cordis.patch.yml" },   // 不变
  "client": {
    "platform": "web",
    "inject": ["@deepseek-ai/dsh-client-ui-slots"]  // 最小确定集（对应运行时 slots 服务）
  }
},
"exports": {
  ".": { "types": "./lib/index.d.ts", "default": "./lib/index.js" },
  "./client": "./dist/client.cjs",
  "./package.json": "./package.json"
}
```
- 形态对照：AutoPilot `package.json:96-104`（platform web + inject 四包）、filehub `package.json:116-125`（inject 五包）。本插件按需取最小集（只需 slots 的 owner bundle，fetch 用浏览器全局 `fetch`）。
- `inject` 包名为**构建期模块到达边**（让 client bundle factory 先在 Loader 注册），非服务注入（`RES-plugin-api.md:118`，package-manifest types.ts:84-85「informational, not Cordis service injection」）。

### 6.2 与 plugin.ts face 接线的关系 / 声明式 vs 运行时边界

- **声明式（manifest）**：`dsh.client` 只让 Node 半扫描到 client bundle 并注册其 factory；它**不**让宿主服务对 client fiber 可见，**不**替代 `webServer.register`，**不**注册任何 face。
- **运行时（client fiber）**：client 模块导出的 `export const inject = ['slots']` 才是浏览器 cordis fiber 的服务等待集合（`RES-plugin-api.md:118`；AutoPilot client:22）。二者是两套 fiber，互不取代。
- **运行时（host fiber）**：`plugin.ts` 构造期 `wire*Face` + 新增 `registerUiRoutes` 走宿主 `ctx`，与 `dsh.client` 无依赖关系。
- **阶段独立性**：阶段一 UI 页（webServer 路由）**不需要** `dsh.client` 即可工作；`dsh.client` 仅为阶段二 slot 摘要卡服务。若阶段二失败，删除 `dsh.client` + `src/client` + `exports['./client']` 即回退到纯阶段一，核心交付不受伤（选项 C 可降级性）。

---

## 7. 坑册检查项映射（开工查，V1-V10）

> 命中来源：`task.json:29` + 研究 C-2。分两类：**[设]**=设计阶段已规避（本设计已处理）；**[卡]**=实施时卡面必检（coder 每块自检 + reviewer 核对）。

| V | 内容 | 命中坑册 | 检查方法 | 分类 |
|---|---|---|---|---|
| V1 | 快照 API 实时账本 | A4-5（session 绑定）、Z28（面状态可见） | 复用 §2.1 访问器，不新造；`snapshotFor` 单测注入账本；实测三条 session 解析臂 | [设] 复用链已定 / [卡] 字段与标注 |
| V2 | UI 三块浏览器可用 | Z28（无 sink）、A72（Edit-Read 循环）、A14/条目32（heredoc） | 页面内联 HTML 用 Write 直写；三块渲染真机截图；连读两次无新信息即改 Write | [设] 内联交付 / [卡] 页面编写与真机 |
| V3 | UI 数据不进 session | R1（零请求体改写） | 代码审：ui/ 无 `llm.stream`、无 `llm/stream` listener；grep 断言 | [设] 只读链 / [卡] grep 零命中 |
| V4 | bridge token/loopback 授权 | Z28（零 sink 类比）、A4-5（非 loopback） | 三臂授权单测 + 越权 403；grep 零凭据字面量；写路由 loopback 收紧 | [设] 方案已定 / [卡] 单测与 grep |
| V5 | face 激活探针可判活/死 | Z28（三重证据）、Z25（memoize 缺席） | 三态探针单测；探针不缓存缺席；真机读 faceHealth | [设] tri-state 已定 / [卡] 探针单测 |
| V6 | fail-soft 可见 sink + face 健康 | Z28（核心命中） | 降级写 stderr + snapshot.faceHealth；单测假 sink 收到行；禁仅 ctx.logger.warn | [设] sink 已定 / [卡] 单测 |
| V7 | slot 摘要卡 inject 门失败不 PENDING | Z1（工厂单参）、Z21（构造器）、Z25（惰性门）、A1-2（inject 悬挂）、反-C2（slot 上限） | bundle 头部单参对照；inject=['slots']；slots 缺席 no-op；传 order 不传 priority；降级=链接 | [设] 契约已裁定 / [卡] 全部实施项 |
| V8 | 4 未解决转验收 | A4-5 / A2-4 / A3-4 / C-3（端到端） | 逐项实测记录（§8.1），不默认为已解决 | [卡] 逐条实测 |
| V9 | R1 红线不变 | R1（SUPPORTED 段 `8e2d0b7e…`） | 段哈希复算；无请求体改写 | [设] additive / [卡] 哈希复算 |
| V10 | 测试绿 + tsc 0 + 树净 | Z19（先 build 后 test）、Z15（先 tsc 后 vitest）、Z23+条目32（禁 heredoc/.mjs 用 Edit）、A68（绝对路径）、A72（Edit-Read→Write 全量重写） | 验证序 `build → tsc → vitest`；含 `../lib/` 导入则产物先建；全程 Write/Edit；路径绝对；工具循环即换 Write | [卡] 全部 |

**补充全局检查项**（跨 V）：
- **A68**：所有跨目录 cp/mv/路径用绝对路径，命令自带前置，不依赖跨调用 shell 变量。
- **A72**：同一文件连续 2 次 Read 无新信息 → 立即 Write 全量重写（本 DESIGN.md 即用 Write 落盘，规避）。
- **Z23/条目32/A14**：任何含 `\n`/转义/中文的代码内容（尤其 `page.ts` 内联 HTML、`.mjs` 构建脚本）一律 Write/Edit 工具直写，禁 bash/python heredoc。
- **Z17**（产物断言先剥注释）：若对 `lib/`/`dist/` 做"不含某串"断言，先剥注释再扫，运行期构造断言为权威口径。

---

## 8. 风险 / 回滚 / 未解决裁定

### 8.1 四项未解决 → 验收方法（V8，不默认为已解决）

| 未解决（研究自标） | 验收方法（可执行） |
|---|---|
| **primitive 字段可见性**（A3-4） | 真机打开设置/Models 页，记录 `ZcontextConfig` 26 primitive 中哪些渲染；与 `CONFIG_FIELD_SPECS` 对齐。裁定：primitive 不进自动 configForms 属预期（权威=overlay），本波以**自带设置页**覆盖九字段+face 开关，不依赖 Models 页编辑。记录实测清单，不写"已解决"。 |
| **session 绑定**（A4-5） | §2.3 三臂单测 + 真机 UI 页显示 sessionId 且可切换；显式不可见 id 返回空快照不误绑。 |
| **非 loopback 只读**（A2-4） | 测试用非 loopback 绑定：GET snapshot/config 允许只读；POST config 无 token 且非 loopback → 403；记录远程持久写是否受限（S14 README:106「远程 get no durable settings」）——本设计以"写仅 loopback/token"收紧，实测确认。 |
| **端到端真机**（C-3） | 桌面 composition 浏览器打开 `/zctx-ui`：三块渲染 + 5s 轮询更新 + faceHealth 灯；三重证据取其一（模型列工具清单 / 系统提示含 zctx / 行为痕迹）；截图入证。与 BENCH-L2 探针（§4）交叉核验。 |

### 8.2 R1 红线与 additive 回滚

- **R1（零请求体改写）**：SUPPORTED 段哈希 `8e2d0b7e…` 必须复算不变（V9）。新增面只读账本、只写 overlay 配置，**永不注册 `llm/stream` 改写 listener、永不碰 `internal/config` 请求面、永不写凭据**。reviewer 对抗项：确认 `src/ui/**` 无改写面。
- **additive revert**：所有新增为独立文件（`src/ui/**`、`src/client/**`、6 个 spec）+ 新路由（disposer 可注销）+ manifest 字段 + 2 处 export 追加；**不改既有折叠逻辑、face 顺序、config schema、cordis.patch.yml**。回滚 = revert 提交即卸载 UI；阶段二再独立回退（`dsh.client` + client + exports）。
- **fail-closed 不弱化**：授权失败一律 403；configEditor 缺席 503；session 不可见空快照；face 降级可见——任何新增面不得让既有 fail-closed 行为变松。
- **失败模式清单**：①webServer 缺席（CLI headless）→ UI 面跳过，不影响插件主体；②页面产物/内联字符串语法错 → tsc/build 拦截（Z15/Z19）；③client bundle 契约错 → Z1 头部对照 + 真机 boot 验证；④slot inject 悬挂 → 能力探测降级 no-op；⑤token 泄露 → 仅内存闭包、不日志，泄漏即轮换（重启重生成）。

### 8.3 升级条件

桌面 face 探针若证明 face 真死（V5 absent 且真机三重证据全无）→ 停手报主线裁决是否继续 UI（plan §8）；不得用 UI 假数据掩盖 face 未激活（Z28）。同理，若 R1 段哈希变化或授权越权无法收紧 → 升级主线，不放行。

---

## 9. 结构约束清单（交付 coder，reviewer 据此判结构）

1. **层边界**：`src/ui/**` 只能依赖 `src/types.ts`/`src/store.ts`/`src/tools.ts`/`src/plugin.ts` 的既有导出与注入的 `ZctxToolRuntime`；**禁止** `src/ui` 反向被 `src/fold-engine|autofold|observe|preflight` import（UI 是叶子）。
2. **只读铁律**：`snapshotFor` 及其调用链禁止 `llm.stream`、禁止注册 `llm/stream` listener、禁止任何请求体改写（R1）。
3. **数据获取**：快照字段必须由 §2.1 列明的现存取器产出；禁止在 `src/ui` 内重新实现 budget/range/attribution 算法（复用 `computeBudget`/`foldableRanges`/`observabilitySnapshot`）。
4. **配置写入**：只走 `ctx.configEditor.edit(entry, change)`；禁止插件 fs 直写 `cordis.patch.yml`；只写 §3.4 的 13 个键。
5. **路由生命周期**：所有 `webServer.register` 的 disposer 必须经 `ctx.effect` 注销；handler 原生 req/res，禁 Express helper。
6. **凭据**：bridge token 运行时生成（内存闭包），源码/示例/测试零可用字面量；不日志、不进快照、不写盘。
7. **模块边界**：`src/client/**` 是独立 client fiber，只声明 `inject=['slots']`；不 import 宿主 Node 模块、不 import 设计系统组件、不传 `priority`。
8. **manifest/产物**：`dsh.client` 仅 informational，不替代运行时 inject；client bundle 单参 `factory(require)` 形态（Z1）；lib/index.js 与 dist/client.cjs 同批重建提交（Z19，产物新鲜度）。
9. **文件生成纪律**：含转义/中文的代码（内联 HTML、.mjs 脚本）用 Write/Edit 工具；绝对路径；Edit-Read 循环即换 Write（A68/A72/Z23/条目32/A14）。
10. **零遗留**：本波所有 `[建议]` 与 `[阻断]` 同权处理（§全局协议 §0.1/§11）；4 未解决项进 closures 作验收，不得改名为 backlog。

---

## 完成回执（architect → main）

```
FROM: architect  TO: main
MODE: normal
TASK_REF: ZCTX-UI B2 详细技术设计
PAYLOAD:
  ARTIFACT: G:\000Github\zDSH\zDSH-plugins\dsh-zcontext\worktrees\ZCTX-UI\docs\specs\ZCTX-UI\DESIGN.md
  裁定1(快照API): 薄封装既有访问器 resolveWatchedSession/currentSession/storeFor/validatorConfig/
                  observabilitySnapshot/usageSnapshot/ledgerEntries/computeBudget/foldableRanges；
                  sessionId 缺省取 currentSession()，路径写 sessionResolution，不静默、不新造数据结构。
  裁定2(路由+授权): 4 路由原生 WebRoute handler；bridge token 运行时 randomBytes 生成(零字面量)+
                  loopback/same-origin，非授权 403，写路由 reloopback 收紧；页面内联 HTML 字符串(零构建/Z3)。
  裁定3(slot降级): client bundle 单参 factory(require)(Z1)；inject 仅 ['slots'](Z21/Z25)；
                  React.createElement+styles.insert；表达力不够降级为链接(反-C2)，门失败 no-op 不 PENDING。
  Coder 最易踩的坑: 把快照 API "从零造"而漏用现存取器——尤其 window 误当 estimated、session 缺省误回退、
                  guard-observe/faceHealth 不接既有 hook，导致 Z28 静默/字段与 zctx_status 口径不一致；
                  其次是 page.ts 内联 HTML 用 heredoc 生成触发 Z23/条目32。
ATTACHMENTS: DESIGN.md（本文件）；依据 RES-UI-FEASIBILITY.md/VERIFY-UI.md/options.md/plan.md/task.json
```
