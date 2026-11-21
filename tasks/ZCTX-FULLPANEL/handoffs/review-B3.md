# review-B3 — ZCTX-FULLPANEL 独立评审（B3）

- 评审人：reviewer-fp（独立 subagent，作者=main，评审人≠作者）
- 对象：worktrees/ZCTX-FULLPANEL，分支 feat/ZCTX-FULLPANEL，HEAD=284db97，diff 基线 f72f64f..284db97
- 方法：全部结论基于独立实测（亲跑命令 + 读源 + 读 diff + 对照 f72f64f 旧 page + RES 文档）；真机项一律不碰，归 B4。
- 结论：**打回（返工 r1）**，总分 **75/100**（<98）。5 条 [阻断] + 8 条 [建议]。
- Z36 特别核对：checkpoint 声称的 tsc=0 / 750/750 / 握手 5/5 **三项均独立复现为真**（见 §8）——本次无失实声明。

---

## 一、必核 9 项逐项结论（三值：达成 / 部分达成 / 未达成）

### 1. 架构执行（用户 2026-11-21 决策）—— **部分达成**
- page.ts 已删除：diff f72f64f..HEAD 中 `src/ui/page.ts | 384 -`（整文件删除），`ls src/ui/` 无 page.ts。✅
- routes 无 /zctx-ui page 路由：`src/ui/routes.ts` 仅注册 3 条 exact 路由（:136 snapshot、:156 stats、:217 config），无 text/html 面。✅
- webServer 只剩 API：`tests/ui-webserver-inject.spec.ts:127` 断言 `routes.size` 为 3 且路径恰为 snapshot/config/stats。✅
- grep 全仓残留：`grep -rn "UI_PAGE_HTML|pageHtml|UI_TOKEN_PLACEHOLDER" src tests scripts` → 零命中；`dist/client.cjs`/`lib/index.js` 编译产物 grep `UI_PAGE_HTML|__ZCTX_BRIDGE_TOKEN__|session-pick` → 0。`src/index.ts:187-190` 已移除两个导出。✅
- **残留（升级为阻断 B-3）**：client bundle 仍渲染指向已删页面的死链 `href='/zctx-ui'`（client/index.ts:214、232、241）；`src/ui/routes.ts:54` 死常量 TOKEN_PLACEHOLDER。旧编译产物可证其原用途：`git show f72f64f:lib/index.js` 含 `const page = pageHtml.split(TOKEN_PLACEHOLDER).join(bridgeToken)`，页面删除后此常量在源内零使用。

### 2. /api/stats —— **达成**
- routes.ts:139-156：GET-only（405 臂 :142-145）+ `authorizeRequest`（403 臂 :146-149）+ try/catch 500 臂，与 snapshot 处理器（routes.ts:119-135）逐臂同型。✅
- 类型：`routes.ts:27` `import type { LedgerStats } from '../storage/db.ts'`；db.ts:51-57 定义五字段（totalFolds/totalTokensSaved/sessionsCount/lastFoldAt/schemaVersion）。✅
- 接线：plugin.ts:493-497 `ledgerStats: () => this.ledgerStore?.stats() ?? {…0}`（fail-soft）→ ui/index.ts:82 → routes.ts:151 `{ ok: true, stats: ledgerStats() }`。✅
- 测试：zctx-ui.spec.ts 新增 `GET /zctx-ui/api/stats returns 200 … (V2)`（:458-468），断言 ok/schemaVersion/number。✅

### 3. panel 全功能 —— **部分达成**
- ① session 下拉多会话切换：控件存在（client/index.ts:386-403，option 来自 `availableSessions`，parse 层过滤非字符串 :301-303），但**切换后 ≤5s 被轮询覆写回默认会话**（阻断 B-1）。
- ② 统计 SQLite 累计：`/api/stats` 读取 + `ledger.totalFolds/totalTokensSaved/sessionsCount` 渲染（:413-415），当前 ranges/cache 并列（:416-418）。✅
- ③ 设置可写表单：可写表单 + `POST { fields }`（:433-459），fieldLabel 中文标签渲染（:425）；**但 faceSwitches 4 键整个丢失 + 数值字段以字符串提交**（阻断 B-2）。
- ④ face 中文：`FACE_STATE_ZH`（i18n.ts:81-85）active/degraded/absent→正常/降级/未激活，渲染于 :373-381。✅（`unknown` 态回退原文，属诚实降级，可接受）

### 4. i18n 跟随 DSH —— **部分达成**
- 机制：client/index.ts:325-327 `navigator.language`（webview 继承宿主）→ `resolveLang(undefined, navLang)`；探测不到（undefined）→ 默认中文。✅（用户令）
- **偏差一（阻断 B-4a）**：`resolveLang`（i18n.ts:53-61）对**已探测到的**非 en/zh 宿主语言（如 `ja-JP`）返回 `'zh'`。三处一致的规格（协调方必核项"其他→en"；用户 2026-11-20 原话记录于 i18n.ts:5"其他语言只显示英语"；i18n.ts:6 头注释"en for everyone else"）都要求"其他→en、探测不到才 zh"。实现与自身头注释都矛盾。
- **偏差二（阻断 B-4b）**：面板 5 处硬编码中文绕过字典——`(累计)`(:413)、`累计节省 tokens: `(:414)、`覆盖会话: `(:415)、`(当前)`(:416、:418)、` 条`(:410)。en 模式下中英混排（如 "Fold count(累计): 3"），违反 V6"面板全部文案 i18n"。
- 字段键名→中文：zh 模式下 9 个 fields 键全部命中 FIELD_LABELS（i18n.ts:64-78 共 13 键），**无裸英文字段键名渲染** ✅（对照 getConfig 产出键集 ui/index.ts:55-71）。

### 5. R1 红线 —— **达成**
- 按 patcher/README.md:349-365 写死口径独立复算（git 对象读取，自 `export const SUPPORTED = {` 行起至首个**列 0** `// -----` 分隔行止，含前缀含尾换行，不 trim）：
  - HEAD 284db97：chars=14889 / bytes=14926 / sha256=`8e2d0b7effb1b9af0151b2e2aa8b408eb67b5d58c180e29df3c8730ac059b0f9`
  - 基线 f72f64f：同值。与钉死值**精确一致**。✅
  - 口径注： naive 的"首个含 `// ----------` 的行"会命中数据体内部缩进 6 的注释（line 720）切出 110 字节——必须限定列 0 分隔行；本评审已按 README 口径修正并复现钉死值。
- diff 无 patcher/ 文件（`git diff f72f64f..HEAD --stat` 全清单无 patcher 路径）→ 零请求体改写面触碰。✅

### 6. Z34/Z35 教训执行 —— **达成**
- Z35（守卫假绿）：亲跑 `node scripts/assert-client-banner-handshake.mjs` → 5/5 PASS，第一项即 `bundle.node-check-syntax — dist/client.cjs parses cleanly (node --check)`（真解析非字符串形状）。✅
- Z34（static inject 漏声明）：`tests/ui-webserver-inject.spec.ts:85-91` 断言 `ZcontextPlugin.inject` 含 `webServer` 且原五键仍在；client 侧 `inject: ['slots']` 未动（Z21/Z25 收敛）。✅
- 亲跑（Z36 独立复核）：`pnpm lint`（=tsc --noEmit）exit 0；`pnpm exec vitest run` → **36 文件 750/750 全绿**。✅

### 7. page.ts 删除的连锁清理 —— **部分达成**
- UI_PAGE_HTML/pageHtml/UI_TOKEN_PLACEHOLDER：src+tests+scripts 零残留 ✅（见 §1）。
- **但"页面残留"不止这三个符号**：死链（client/index.ts:214/232/241）、死常量 TOKEN_PLACEHOLDER（routes.ts:54）、8 个死字典键（copyAddress/copied/readonlyNote/openFullPanel/language/langAuto/langZh/langEn，grep 全 src 仅 i18n.ts 自身命中）、4 处过时注释（建议 B-3）、CHANGELOG 整段过时（阻断 B-5）。清理深度不足以支撑"砍干净"的结论。

### 8. Z36 纪律（checkpoint/progress 声称 vs 实测）—— **达成（本次无失实）**
| 声称（checkpoint.json:17-19 / progress.md:2） | 独立复测 | 判定 |
|---|---|---|
| tsc = 0 errors | `pnpm lint` → exit 0 | ✅ 真 |
| tests = 750/750（3 失败测试已重写） | 36 files / **750 passed (750)** | ✅ 真 |
| 握手 5/5 PASS | 5 行 PASS + `client banner handshake: all checks PASS`，exit 0 | ✅ 真 |
| 3 失败测试重写 | zctx-ui.spec.ts page 臂删除、3 路由断言、stats 新臂 | ✅ 真 |
- governance 注记瑕疵（不构成失实）：checkpoint.json:23 `prev_hash: "REBUILD-FROM-HISTORY (skip annotated…)"` 哈希链重启仅注记未重建（建议 S-7）；`:7` ts 为整 .000Z 圆整值。

### 9. 工作树净 —— **达成**
- `git status --porcelain` 空。分支 feat/ZCTX-FULLPANEL 确认。
- lib/index.js 大变更（-403/+36）为真实内容变更（page 编译产物移除），非 Z3 类 CRLF churn：`git diff` 抽样首行均为 pageHtml/TOKEN_PLACEHOLDER 逻辑删除。✅

---

## 二、[阻断] 清单（不修不能合入）

### B-1 面板 session 切换 ≤5 秒被轮询覆写回默认会话
- 位置：src/client/index.ts:343（`fetchText('/zctx-ui/api/snapshot')` 无 session 参数）+ :370（`setInterval(load, 5000)`）vs :393-400（onChange 用 `?session=` 取数但只写临时 data，无选中态）。
- 问题：用户在下拉选中会话 B → onChange 拉取 B 的快照 setData → 下一轮 5s 轮询 load() 无参拉取默认会话 → `value.sessionId` 回到默认 → 下拉与统计区全部跳回默认会话。多会话切换功能（任务卡 ③①、验收 V3 面）实际不可用。
- 修复建议：新增 `const [picked, setPicked] = useState<string|undefined>(undefined)`；`load()` 拉取时带上当前选中（`?session=`）；onChange 只 `setPicked(v)`（效应自动下一拍取数），并保留失败时 keep-last-good 语义。

### B-2 设置面功能收缩 + 数值类型回归（V4/"全部功能进面板"违约）
- 位置 A（face 开关丢失）：src/client/index.ts:363-369 只消费 `raw.fields`；GET /api/config 返回的 `faceSwitches`（ui/index.ts:66-71：observe.enabled / patch.guardObserveEvents / autofold.enabled / preflightMode）被整包丢弃，面板不渲染、不可写。旧 page 明确渲染：`git show f72f64f:src/ui/page.ts` L259-283（4 个 checkbox + preflightMode 下拉 off|observe|enforce）。用户决策是"**全部功能**进原生侧栏面板"，此为功能面净收缩；FIELD_LABELS 中 4 个 face 键（i18n.ts:74-77）全部成了死字典。
- 位置 B（类型回归）：src/client/index.ts:445 `patch[key] = type === 'checkbox' ? el.checked === true : el.value`——8 个 number 型字段（config.ts:241-248 CONFIG_FIELD_SPECS `{ type: 'number' }`：keepRecentTokens/maxFoldFraction/minFoldableTokens/protectionFloorTokens/summaryFloorChars/summaryCeilingChars/netShrinkTolerance 等）编辑后以字符串入 overlay，违反 config.ts:19"every field is primitive"冻结契约与字段类型表；旧 page 有显式转换：f72f64f page.ts saveSettings `else if (type === 'number') { var n = Number(el.value); patch[key] = isFinite(n) ? n : el.value; }`。本任务把旧页面的转换丢掉了。
- 修复建议：①渲染 faceSwitches（checkbox）+ preflightMode（select 或文本）；②按 GET 值的 typeof 决定转换（number 字段 `Number(el.value)`），恢复旧页面的类型安全提交。

### B-3 已删页面的死链仍随 bundle 发布
- 位置：src/client/index.ts:214（summary card `<a href="/zctx-ui" target="_blank">打开 zcontext 面板 →</a>`）与 :225-243（no-React fallback anchor，href='/zctx-ui'）。
- 问题：/zctx-ui 无任何处理器（本任务删除），宿主 webview origin 为 `dsh-app://`，相对链解析为 `dsh-app://app/zctx-ui` → 点击即死链/空白 tab。用户砍页面的理由（dsh-app:// 浏览器不可达、无意义）完全适用于这条链；面板已是全功能，该链承诺的"完整面板页"已不存在。
- 修复建议：删除两处链接与 LinkRender 的 href 语义（fallback 卡改为纯摘要或指向面板说明文案），同步清理相关测试断言（client-slot.spec.ts:184 等处对 link 的断言需随改）与死字典键（见 S-2）。

### B-4 i18n 两处偏离用户决策（V6）
- 位置 A：src/ui/i18n.ts:53-61 `resolveLang`——已探测到的第三语言（非 en/zh 前缀，如 ja-JP/de-DE）落到 `return 'zh'`。规格三处一致："其他→en"（协调方必核项）、"其他语言只显示英语"（用户 2026-11-20，i18n.ts:5）、"en for everyone else"（i18n.ts:6）。修法：hostHint 存在且非 zh 前缀 → `'en'`；hostHint 缺失/空 → `'zh'`（保留"探测不到默认中文"）。
- 位置 B：src/client/index.ts:410、413、414、415、416、418 硬编码中文（` 条`/`(累计)`/`累计节省 tokens: `/`覆盖会话: `/`(当前)`) 绕过 UI_DICT。修法：补 5 个字典键（如 totalsSaved/sessionsCovered/cumulative/current/rowsSuffix）并改用 `t(...)`；en 模式验收一句英文混排都不该有。
- 附带：i18n.ts:3-10 头注释仍描述"settings override (uiLanguage) → host locale probe"旧策略，与现实现（navigator.language）矛盾，随本条一并改。

### B-5 CHANGELOG 未同步（文档门）
- 位置：CHANGELOG.md:7-24 `[Unreleased]` 段。
- 问题：仍把已删除的架构当现状描述——"Realtime web panel (`/zctx-ui`): a webServer-mounted **read-only page**"、"Settings inside the panel are **read-only with a link to the full page** (the in-panel write path is **deferred**)"。与 V1（页面已删）、V4（面板可写）直接矛盾，且"link to the full page"即 B-3 死链的文档化。§15.1 文档同批更新 + 审查清单第 7 项不满足。
- 修复建议：改写 Unreleased 段为：页面路由删除（dsh-app:// 结构性不可达，用户 2026-11-21 决策）、面板全功能（统计 SQLite 累计 + 可写设置 + 中文 i18n）、/api/stats 新增；"desktop acceptance pending"行同步改口径。

---

## 三、[建议] 清单（不阻塞中间合入，阻塞最终验收；每条须 disposition）

- **S-1** src/ui/routes.ts:53-54 TOKEN_PLACEHOLDER 死常量 + "replaced at register time"过时注释（页面删除后无注入面）。修法：删常量与注释。
- **S-2** 死字典键 8 个（i18n.ts: copyAddress/copied/readonlyNote/openFullPanel/language/langAuto/langZh/langEn）与死接口字段 PanelSnapshot.ledgerStats（client/index.ts:262-267，parsePanelSnapshot 从不填充，面板用独立 ledger state）。修法：随 B-3/B-4 一并删除或启用。
- **S-3** 过时注释三处：client/index.ts:311-315（createPanelComponent JSDoc 仍写 "read-only; writes point at the full /zctx-ui page — U-2 token gap"，与可写面板相反）、:19-21（模块头 "complex settings/stats stay on the full page"）、i18n.ts 头（并入 B-4）。修法：改写。
- **S-4** 统计诚实性：ledger 拉取静默失败（client/index.ts:360 `.catch(() => {})`）时 :413 `ledger.totalFolds ?? value.foldCount ?? 0` 把**当前会话** foldCount 标成"(累计)"——标签与数据不符（与 B3-S7 诚实降级词汇冲突）。修法：失败时显示 'n/a' 或注明当前会话口径。
- **S-5** 类型双轨：ui/index.ts:42-48 自建 LedgerStatsFromDb（注释称"avoids a store import"）而 routes.ts:27 直接 `import type { LedgerStats } from '../storage/db.ts'`——同一层两种策略并存，前者的存在意义被后者消解。修法：统一一种（建议直接用 db.ts 类型，删除重复定义）。
- **S-6** `.zctx-panel-select`（client/index.ts:391）在 CSS 数组（:131-152）中无规则，select 走浏览器原生样式。修法：补一条主题变量规则。
- **S-7** checkpoint 哈希链断点：tasks/ZCTX-FULLPANEL/checkpoint.json:23 prev_hash 为 "REBUILD-FROM-HISTORY (skip annotated…)"，链式校验自 step2 起无前驱可验。修法：在任务目录补一条链起点说明（或在下个 step 恢复真实 prev_hash），并同步 progress。
- **S-8** 新功能零测试：grep tests/ 对 resolveLang/UI_DICT/FIELD_LABELS/FACE_STATE_ZH 零命中；面板的 stats 渲染、session 切换、POST {fields} 形状均无用例。修 B-1~B-4 时应补对应单测（清单第 5 项），否则修复无法回归验证。

---

## 四、评分（六维，评分人=reviewer-fp，作者=main；每维附证据）

| 维度 | 得分 | 证据摘要 |
|---|---:|---|
| 正确性 | 18/25 | 三处实证缺陷：B-1（client/index.ts:343/370 vs 393-400 亲读）、B-2b（:445 vs f72f64f page.ts saveSettings Number 转换；config.ts:241-248）、B-4a（i18n.ts:53-61 vs 三处规格）。正确路径部分（route 臂、stats 接线、R1）全对。 |
| 完整性 | 13/20 | faceSwitches 丢失（B-2a）、i18n 文案 5 处缺口（B-4b）、死链未清（B-3）、CHANGELOG 未同步（B-5）；750/750 覆盖到位但新功能零测试（S-8）。 |
| 一致性 | 14/20 | route 授权臂与 snapshot 同型（routes.ts:119-155 对读）；R1 三数字精确复现；冲突点：CHANGELOG 与实现矛盾、resolveLang 与自身头注释矛盾、LedgerStats 双轨（S-5）。 |
| 可验证性 | 14/15 | 全部关键声称可独立复现且为真（tsc 0 / 750/750 / 握手 5/5 / R1 哈希三数字 / grep 零残留）；扣 1 分：checkpoint 哈希链重启无前驱（S-7）、ts 圆整。 |
| 安全回滚 | 10/10 | 零凭证字面量（auth.ts:41-43 runtime token，测试 V4 断言仍在）；写臂授权未弱化（auth.ts:103-107）；R1 段字节级不变；worktree 净。 |
| 可维护性 | 6/10 | 死常量/死键/死字段（S-1/S-2）、过时注释 4 处（S-3）、类型双轨（S-5）；其余结构（单一 config 注册分派 GET/POST、i18n 字典集中）良好。 |
| **合计** | **75/100** | <98 → 打回（返工 r1，≤2 轮）。正确性 18<23 触发 §12.3 硬阻断。 |

---

## 五、结论

**打回 + 清单**（5 阻断 / 8 建议，总分 75）。

- 打回范围：全部 [阻断] 必须当波 fixed/verified；[建议] 同样当波处理（fixed/verified 或 user_approved_deferred 记账）——按 §0.1 与 [阻断] 同权。
- 真机项（面板渲染/语言跟随/统计读数/设置真写）归 B4，本次不阻断也不验证（未触碰真机）。
- 无法验证项：宿主 configEditor 对字符串写入 number 字段的实际行为（真机行为，无法在本机判定）——B-2b 按冻结契约与旧页行为判阻断，不依赖该未验证假设。
- 亮点如实记录：Z36 三项声称全部独立复现为真（4 次失实教训未复发）；R1 红线字节级完好；架构决策执行主体（删页、API 化、面板化）方向正确且测试同步重写。

（评审证据命令与输出均已在上文内联；复核人可按 §1-§8 的路径/行号逐条重放。）
