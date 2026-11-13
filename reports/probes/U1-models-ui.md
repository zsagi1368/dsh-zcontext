# U1 目录 UI 探针报告 — Models 页对第三方 settingsNs 条目的支持（只读源码调查）

- 探针：只读源码调查（零改动、零运行时 UI 实测）；任务卡 `tasks/ZCTX/cards/V1-probes-store.md` 第 2 项。
- 对象仓：`G:\000Github\zDSH\zDSH-main`（与 RES-observe-route.md 同 checkout，HEAD 073792c7f8）。
- 调查日：2026-11-12。所有 file:line 为本波实读锚点。
- 回答 RES-adapter-route.md **[U1]**：官方 Models 页对"第三方插件 settingsNs 的目录条目"的渲染/编辑/凭据写入支持是否齐备。

## 裁定：SKIP（按卡面问题口径）

**卡面问题**："S2 的最小目录注册是否能让用户在 Models 页看到并配置 zctx provider？"

- **看到（渲染）**：有条件 YES——目录条目会进入 Models 页的数据面，但渲染前提是本插件 Config 挂出 volatile 字段（现状没有，见 §3）。
- **配置（页内编辑 + 凭据写入）**：**NO——被硬编码阻断**。编辑器布局函数只认 `llm-deepseek`/`llm-pi-ai` 两个命名空间；第三方命名空间的编辑器 Apply 按钮被禁用（§4）。

按计划 §3 "探针不过则 S2 降级为'仅代码+SKIPPED 登记'"：S2 的"最小目录注册"若在 V5 落地，只能交付 **visibility-only**（行可见 + 凭据徽章只读），页内配置不可达；用户配置 zctx provider 走配置 overlay（官方编辑器自己也这么引导，见 §4 的 advancedHint 文案）。

## 1. 数据面：目录条目如何进入 Models 页（事实·高）

- 注册 API：`LlmRuntime.registerConfigurableProviders(entries)`（llm/llm/src/index.ts:494-537）——要求 provider/displayName/settingsNs 三者非空、settingsPath 段非空、全或无（DUPLICATE_DIRECTORY 拒绝撞名）；fiber 生命周期托管，`handle.replace()` 原子换组。
- 页面数据源：`llm/listProviders()`（活路由）与 `llm/listConfigurableProviders()`（目录，含 dormant）并行读取（ui-settings-models/src/client/store.ts:323-327），经 `joinProviderDirectory` 合并（store.ts:43-71）：目录条目在先，未声明的活路由补在后（settingsNs=''）。
- 结论：第三方注册的条目**必然出现在页面的 rows 数据里**（含 provider/displayName/settingsNs/settingsPath/declared/error）。

## 2. 渲染面：行与"添加"卡片的可见条件（事实·高）

- 行渲染只列 `configured` 行（ModelsSection.tsx:388-394）：`configured = namespace !== undefined && (settingsPath 为空 || getPath(namespace.value, settingsPath) 存在)`（store.ts:341-343）。**namespace 不在镜像里 → 行直接不渲染**。
- dormant 条目进"添加"目录卡：`addable` = namespace 已挂 且 未 configured（ModelsSection.tsx:371-376）；`configurable`（目录模式 offered）= namespace 已挂的行（:371）。
- 命名空间从哪来：`settings.describe()` 枚举每个 **ACTIVE** 且 `static Config` 带 `toJSON` 的插件条目，ns = 插件条目 id（settings/settings/src/index.ts:302-340, :425-429）。**但只有 `volatileForm(schema)` 非空的条目才产出 descriptor**（index.ts:307-309：`volatileForm` 全 schema 无 volatile 字段时返回 undefined，schema.ts:37-52）。
- volatile 判据：schemastery `Schema.prototype.volatile()`（schemastery lib/index.mjs:235-238，`meta.volatile=true`）；官方先例 llm-pi-ai 的 `providers: z.dict(profile).default({}).volatile()`（llm-pi-ai/src/config.ts:353）。
- **插件现状缺口（事实·高）**：dsh-zcontext 现行 Config 全部是普通 primitive 字段、无 volatile 标记（src/config.ts:49-76）→ `volatileForm` 返回 undefined → **`dsh-zcontext` 命名空间根本不会出现在设置镜像里** → 目录条目即使注册了也渲染不出来。
- 推断·高：V5 只要在 Config 增加一个 volatile 的 `providers` dict（llm-pi-ai 同形），namespace 即挂载，目录条目可见性成立。此为插件侧可控的修复。

## 3. 编辑面：第三方命名空间的编辑器被硬编码禁用（事实·高）

- 编辑器布局选择（ProviderEditor.tsx:142-146）：
  ```ts
  function layoutOf(ns: string): EditorLayout {
    if (ns === 'llm-deepseek') return 'deepseek'
    if (ns === 'llm-pi-ai') return 'pi-ai'
    return 'unknown'
  }
  ```
- `unknown` 布局的行为（ProviderEditor.tsx:513-515, :527）：
  - 只渲染一条提示：`advancedHint` = "Other fields live in cordis.patch.yml; edit that section directly."（locales.ts:75；中文 :220 "其余字段在 cordis.patch.yml 中，请直接编辑对应段。"）
  - **`submitDisabled={disabled || layout === 'unknown' || …}` → Apply 永远禁用** → `applyOnce`（profile 写入 + 凭据存储，:255-292）不可达。
- 凭据读取仍工作：页面按 `deriveKeyRef(provider)`（store.ts:118-120，`zctx-openai` → `ZCTX_OPENAI_API_KEY`）批量 describe 凭据（store.ts:363-373），徽章/missing-dot 只读展示成立；但凭据**写入**（`credentials/set`，operations.ts:89-91）只从被禁用的 Apply 路径可达。
- 手动声明（custom）加卡是 llm-pi-ai 命名空间专属：`customOffered = piAi !== undefined`（ModelsSection.tsx:381-383，取 `namespaces.get('llm-pi-ai')`）——zctx 自定义路由不可能借该卡录入。

## 4. 结论与 S2 设计输入

| 能力 | 第三方 settingsNs 现状 | 依据 |
|---|---|---|
| 目录条目进入页面数据 | YES | registerConfigurableProviders + joinProviderDirectory |
| 目录行/添加卡渲染 | 有条件：插件 Config 须含 volatile 字段（V5 可补） | volatileForm 门（settings index.ts:307-309） |
| 页内编辑 profile（保存路由/模型表） | NO（unknown 布局 → Apply 禁用） | ProviderEditor.tsx:142-146, :527 |
| 页内凭据写入 | NO（同上，storeCredential 不可达） | ProviderEditor.tsx:255-292 被 :527 门死 |
| 凭据只读徽章 | YES（deriveKeyRef 派生引用 describe） | store.ts:118-120, :363-373 |

**SKIP 裁定（对卡面问题）**：最小目录注册**不能**让用户在 Models 页完成"看到并配置"的闭环——配置半边被官方 UI 硬编码阻断（非插件可达面）。

**GO 条件（供 planner 升级裁定）**：
1. 插件侧（V5 可做，交付 visibility-only）：Config 增加 `providers` dict 并 `.volatile()`（llm-pi-ai config.ts:353 同形）+ settingsNs=条目 id、settingsPath=`['providers', route]`；行可见 + 凭据徽章 + error 展示；配置本体走 cordis.patch.yml overlay（官方 unknown 布局的引导文案即此路径）。
2. 宿主侧（插件不可控，需 upstream 请求）：`layoutOf` 识别第三方命名空间（或开放布局注册面）。在此之前页内编辑维持 SKIP。

**未解决（如实登记）**：
- ① 本报告为静态源码实读，未在真实浏览器会话实测（无运行时 UI 环境）；机制链每一环均有 file:line 锚点，置信度高，但"端到端渲染效果"未实测——与 [U1] 原始未解决项的"apps/web 实现面未查"相比已前进一步（UI 实现面已逐行查），运行时实测仍缺。
- ② 宿主若在后续版本扩展 layoutOf，GO 条件自动重开——登记为宿主版本锚点检查项（升级波复核）。

## 5. 来源索引

| 锚点 | 文件 |
|---|---|
| 注册/目录 API | zDSH-main/packages/llm/llm/src/index.ts:494-537, :554-557 |
| 页面 store/凭据派生 | zDSH-main/packages/client/ui-settings-models/src/client/store.ts:43-71, :118-120, :323-343, :363-373 |
| 行渲染/添加卡门 | zDSH-main/packages/client/ui-settings-models/src/client/ModelsSection.tsx:371-394, :513-515 引 ProviderEditor |
| 编辑器布局硬编码 | zDSH-main/packages/client/ui-settings-models/src/client/ProviderEditor.tsx:142-146, :513-515, :527; locales.ts:75 |
| 命名空间挂载/volatile 门 | zDSH-main/packages/settings/settings/src/index.ts:302-340, :425-429; schema.ts:37-52 |
| volatile API/先例 | schemastery lib/index.mjs:235-238; llm-pi-ai/src/config.ts:353; llm-pi-ai/src/index.ts:151, :240-250 |
