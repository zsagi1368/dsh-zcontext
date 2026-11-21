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

---

# 复评 r1（2026-11-21 · 复评人=reviewer-r2 · 独立于 coder 与 r0 评审人）

- 对象：worktrees/ZCTX-FULLPANEL，HEAD=60255f4，返工 7 提交 284db97..60255f4（基线仍 f72f64f）。
- 方法：与 r0 同轮严格度——全部结论基于独立实测（亲跑 lint/build/test、git 对象哈希亲算、源码亲读、grep 复放、测试臂逐条对照实现）；真机项一律不碰（归 B4）。
- **结论：中间合入 PASS（0 阻断残留）；最终验收打回（3 条建议待处置：S-5 判 fixed / S-9 / S-10）。总分 92/100。**

## 复评必核 11 项逐项结论

1. **亲跑三件套 —— 全真**：`pnpm lint`（tsc --noEmit）exit 0；`pnpm build` → tsdown 双目标编译成功 + `assert-client-banner-handshake.mjs` 5/5 PASS（含 bundle.node-check-syntax 真解析）exit 0；`vitest run` → **37 files / 765 passed (765)**（= 750 基线 + 15 新臂，与声称精确一致），exit 0。
2. **R1 红线 —— 字节级不变**：按 patcher/README.md:349-365 口径自 **git 对象**读取切片（`export const SUPPORTED = {` 起 zctx-patch.mjs:716，至其后首个列 0 `// ----------` 行 :976 步、不含该行、含尾换行、不 trim）：HEAD=60255f4 与基线 f72f64f **同值** sha256=`8e2d0b7effb1b9af0151b2e2aa8b408eb67b5d58c180e29df3c8730ac059b0f9`、chars=14889、bytes=14926 —— 三数字精确复现。`git diff 284db97..60255f4 --stat` 无 patcher/ 文件。
3. **B-1（session 覆写）—— fixed/verified**：
   - 实现（亲读）：picked state（src/client/index.ts:355-356）；effect 内 load() 按 picked 组 URL（:364-366）；**deps [picked]**（:382）；onChange 仅 setPicked（:444-452），轮询路径无任何 setPicked 回写、无参 fetch 仅存在于 picked===undefined 分支。
   - 语义裁决（协调方问点）：**deps-[picked] 重臂语义正确，且优于 r0 建议的 holder 方案**——切换时 effect 清理旧 interval（alive=false + clearInterval :381）→ 立即按新会话取数 → 新 interval 闭包携带当前 picked；覆写路径在结构上不存在。holder 方案同样可行但不会产生"切换即取数"的即时刷新。
   - 测试真臂：tests/panel-i18n.spec.ts:220-299 用 hook 序号 + deps 相等的 stateful mock 驱动真实 hooks 时序；断言切换前**恰好 1 次**裸默认 fetch（:281）、切换后**每次**快照 fetch（立即 + 模拟 5s tick）均带 `?session=session-picked`（:289-291）、数据停留 picked（:292）。旧缺陷形态（无参轮询）必然令 :281/:291 失败——真臂，非假绿。
4. **B-2（face 开关 + number 类型）—— fixed/verified**：
   - 4 键渲染：GET 提供 ui/index.ts:66-71 四键；面板 Object.entries(faces) 渲染（client/index.ts:494-512），preflightMode→select off|observe|enforce（:500-506），布尔→checkbox（:420,:508-511）；测试 B-2a（panel-i18n.spec.ts:301-338）断言 4 个 data-key + 三个 option 值 + zh 标签。
   - POST shape：保存路径 collect 两 root（:528-553）→ body `JSON.stringify({ fields, faceSwitches })`（:558-561）；服务端 routes.ts:189-203 归一化合并两包 + sanitizePatch 全量拒未知键（config-write.ts:84-97）；测试 B-2b（:362-396）断言 body keys 恰为 [faceSwitches, fields] + number typeof。
   - number 转换：inputFor 按 GET 值 typeof 打 data-type（:418-427）；9 个核心字段全 primitive（config.ts:237-246 —— nudgeThresholds 为 string，无 object 字段，typeof 分派安全）；`Number()` + NaN→badNumberKeys→**整单拒绝**+消息（:541-557）；NaN 测试臂（:398-427）断言 0 次 POST + 消息含键名。
   - 非受控：defaultValue（:424）/defaultChecked（:420）/select defaultValue（:502），无 value prop，key 稳定 → 5s poll 的 setData 重渲染不重挂载，用户编辑存活（Z37 修法落实）。
5. **B-3（死链）—— fixed/verified**：grep `href`/`dsh-app`/`TOKEN_PLACEHOLDER` 于 src+dist/client.cjs+lib/index.js → 零死链（仅 `pathToFileURL(...).href` 无关宿主代码与防御性注释；TOKEN_PLACEHOLDER 全仓 0）；dist/client.cjs 无 anchor 创建；fallback 为**纯文本卡** `FallbackRender{tag:'span', text}`（client/index.ts:237-252，dist :327-329；apply :600 `component ?? createFallbackCard(doc)`）；client-slot.spec.ts:113-142/:169-182 改为文本卡真渲染断言（not.toContain('href')/not.toContain('/zctx-ui')）。
6. **B-4（i18n）—— fixed/verified（面板范围）**：
   - resolveLang 实现（i18n.ts:64-71）与**三处注释全部一致**（i18n.ts:4-13 模块头、:59-63 JSDoc、client/index.ts:331-332）：显式 pref > 探测（zh 系→zh，**其他已探测语言→en**）> 探测不到/空→默认 zh；测试 4 臂（panel-i18n.spec.ts:135-160）含 ja-JP/de-DE/fr/ko-KR→en、ZH-tw 大小写不敏感→zh。
   - 面板渲染面硬编码中文 grep = **0**：原 5 处已入字典 cumulative/totalsSaved/sessionsCovered/current/rowsSuffix（i18n.ts:37,45-48），en 模式 ZERO CJK 臂（:186-201）对序列化渲染做 `[\u4e00-\u9fff]` 负断言（真断言）。
   - **残留（新发现，[建议] S-9）**：摘要卡 + fallback 仍有 5 处硬编码中文（client/index.ts:220,221,224,226,239 —— 'zcontext 摘要 (BETA)'/'折叠 X 次'/'窗口 X%'/'请在左侧菜单…'×2；dist :318,329 同）。预存在文案 + 本次 B-3 新写的提示文案，在 r0 B-4b 清单（面板 :410-418）与 V6"面板全部文案"字面范围外，故不构成 r0 遗留未修，但与"语言跟随 DSH"产品级决策不一致 → 登记为建议。
7. **B-5（CHANGELOG）—— fixed/verified**：[Unreleased] 重写后逐句对照实现全真：5s poll（:380）/切换存活（B-1）/九字段+四开关 POST `{fields,faceSwitches}`（ui/index.ts:55-71）/number 提交+NaN 拒整单（:541-557）/语言跟随（resolveLang）/stats 授权三臂（routes.ts:141-157）/ledger 缺席 fail-soft 零（plugin.ts:496）/页面路由删除且卡与 fallback 均无链接。无任何"已删 page 作现状"的描述；"Desktop acceptance pending"口径诚实。
8. **S 项清单核对**：S-1 TOKEN_PLACEHOLDER grep 全仓 0 + routes.ts:4-13 头重钉（THREE exact paths / four method arms）✅；S-2 八死键 0（唯一命中为测试负断言）+ PanelSnapshot.ledgerStats 死字段已删 ✅；S-3 四处注释重钉亲读为真（client/index.ts:19-24、:313-323；i18n.ts:1-16；routes.ts:4-13）✅；S-4 ledgerOk 门（:465-474）失败→统计暂不可用、不再把当前会话值标"(累计)"，测试双臂（:430-489）✅；S-6 `.zctx-panel-select`/`.zctx-panel-faces`/`.zctx-summary-note` 三条 CSS 规则（:151,:154,:139）✅。
9. **S-7 checkpoint 链 —— 亲算全中**：`prev_hash` = SHA-256(step-2 checkpoint.json **blob 字节** @284db97) = `02dafeff97af6463ecd1ff7e48d2a22ae0b7fdd2d8890d3765c85be64be9b556` 精确；`hash` = canonical JSON（去 hash 字段）SHA-256 = `067509185ccf5fc9efa7198ec1abb110eac786bc1af5ba4f439c1385e2e6e8d1` 精确；9/9 artifacts 哈希与实际文件 MATCH，且本评审 `pnpm build` 重编译后产物**字节级一致**（git status 净）→ 构建可复现；ts 含毫秒非圆整。链自 step-3 起真实可验，step-2 前历史仍诚实标注 rebuild 点。
10. **panel-i18n.spec.ts 15 臂防假绿**：清点 = 4(B-4a)+3(字典卫生)+2(语言渲染)+1(B-1)+1(B-2a)+2(B-2b)+2(S-4) = **15**；抽 3 臂（B-1、B-2b wire/NaN、en-ZERO-CJK）逐条对照实现均为真臂。小注：en-ZERO-CJK 臂在空 config 下运行，未驱动 fieldLabel 的 en 半（字典卫生臂已覆盖双语完整性）——覆盖面小瑕疵，非假绿。
11. **Z37 坑册**：G:\000Github\zDSH\ZDSH-LESSONS.md:225-229 在册，四段齐备（现象/根因/修法/一句话），且把"轮询参数随用户选择→state 进 deps 重臂"与"表单=非受控"钉为防复发项——与本报告第 3 项语义裁决一致。✅

## S-5 处置裁决（协调方问点）

**判 fixed（当波，owner=main），不维持 OPEN 记账。** 理由：(a) `LedgerStatsFromDb` 自注释 "avoids a store import"（ui/index.ts:41）已被 routes.ts:32 直接 `import type { LedgerStats } from '../storage/db.ts'` **事实证伪**——同一形状两处定义、其中一处的存在理由已不成立，属维护性地雷；(b) 修复约 6 行、纯类型层零行为风险（删 ui/index.ts:42-48 + 该处 import + :36 改用 LedgerStats），build+765 测试可即时回归；(c) §11 不允许 OPEN 挂账进入完成态，`user_approved_deferred` 需用户真实批准（目前没有）；(d) r1 卡范围未含 S-5 属 planner 范围决策，coder 不越权是正确纪律——但收口前主线必须处置（micro-fix 提交）。不阻塞中间合入；**阻塞最终验收**。

## 新发现（[建议]，非 r0 遗留）

- **S-9** src/client/index.ts:220,221,224,226,239（dist :318,329）——摘要卡与 fallback 卡 5 处硬编码中文绕过 UI_DICT，en/ja 模式下摘要卡仍渲染中文。预存在 + 本波 B-3 新写提示文案；V6 字面范围（面板）外，故 [建议] 级。修法：入字典（summaryTitle/summaryStats/panelHint 等）并在卡片用 resolveLang。
- **S-10** client/index.ts:541-547 —— `Number('')` === 0：清空数字字段后保存会**静默提交 0**（NaN 检查不拦空串；对照 protectionFloorTokens 等保护阈值字段，0 语义敏感）。旧行为更差（字符串直传），属可接受边缘；建议 `el.value.trim()===''` 与 NaN 同拒。

## 复评评分（六维 · 评分人=reviewer-r2 · 作者=coder/main · 每维附证据）

| 维度 | 得分 | 证据摘要 |
|---|---:|---|
| 正确性 | 24/25 | r0 三缺陷全修复且测试真臂（本报告 3/4/6 项亲证）；扣 1 = S-10 空串→0 静默提交 + picked 会话被移出列表后 select 孤值显示（数据仍正确、可恢复，非数据损坏）。 |
| 完整性 | 18/20 | 5 阻断 + S-1/S-2/S-3/S-4/S-6/S-7/S-8 当波 fixed/verified；S-5 OPEN（范围外、owner=main、判 fixed）；S-9 摘要卡 i18n 缺口（预存在非回归）。 |
| 一致性 | 18/20 | CHANGELOG 逐句=实现；resolveLang 三处注释一致；路由头=三路四臂；POST shape 与 GET 视图互镜像；checkpoint 链自洽。残留：S-5 类型双轨（注释被 routes.ts:32 证伪）。 |
| 可验证性 | 14/15 | 全部声称独立复现为真：lint 0 / 765/765 / 握手 5/5 / R1 三数字 / 链哈希两枚 / 产物哈希 9/9 + 构建字节级可复现 / grep 全零。扣 1 = en-CJK 臂未驱动 fieldLabel en 半（字典卫生臂部分补偿）。 |
| 安全回滚 | 10/10 | 零凭证字面量；diff 无 auth.ts、无 patcher/（授权面与 R1 零触碰，R1 哈希亲算同值）；worktree 净；产物可复现。 |
| 可维护性 | 8/10 | 死常量/死键/死字段/过时注释清零、注释真实化、CSS 补齐、Z37 固化且把测试策略（hooks 时序驱动）写入坑册；残留 S-5 双轨 + 摘要卡文案未集中字典。 |
| **合计** | **92/100** | 零阻断（§12.3 无触发）；≥98 缺口全部来自 3 条建议（S-5/S-9/S-10），修复后可达 ≥98（机械修，无设计工作）。 |

## 复评结论

- **中间合入：PASS**——5 阻断全部 fixed/verified（证据见上），无阻断残留，无失实声明（coder checkpoint 全部声称独立复现为真）。
- **最终验收：打回**——3 条建议未处置（S-5 判 fixed 待主线 micro-fix；S-9/S-10 新登记）。返工 r2（最后一轮）建议范围：S-5（~6 行类型统一）+ S-9（5 字符串入字典）+ S-10（空串拒提交，与 NaN 同路径）+ 对应测试臂；完成后复评应 ≥98。
- B4 真机验收照计划执行（面板渲染/语言跟随/统计读数/设置真写）——本评审未触碰真机。
- 无法验证项：无新增（r0 的宿主 configEditor string→number 行为问题已因 number 前置转换而消解，不再依赖该假设）。
- 亮点如实记录：checkpoint 哈希链真实恢复且产物哈希 9/9 全中 + 本评审重编译字节级复现；B-1 修复采用了比评审建议更优的 deps 重臂方案且测试真臂驱动 hooks 时序（Z37 的正面落地）；15 新臂无一假绿。

---

# 终审 r2（2026-11-21 · 终审=reviewer-r2 终审轮 · 独立实测 · HEAD=405a4f7 · r2 6 提交 60255f4..405a4f7）

- 方法：与 r0/r1 同轮严格度——主线 4 组声明逐条 diff 自证 + 全部证据亲跑/亲算；真机项不碰（归 B4）。
- **定谳：打回（仅终验门）——总分 98/100；§12.3 零触发、分数门已达标；残留仅 2 条机械治理项（零代码变更），一次治理提交 + closure 记账后无需重评即可放行。中间合入 PASS 不变。**

## 终审必核 8 项逐项结论（全部亲证）

1. **diff 全读（60255f4..405a4f7）**：13 文件 392+/124-。三条修复真在 diff——2515873（S-5 类型统一）、9e25a8f（S-9 卡片 i18n）、05307bb（S-10 空串拒）+ d64ef9d（产物刷新）+ 827af3f/405a4f7（治理落盘）。**无 patcher/、无 auth.ts、无越权改动**（diff --stat 亲读）。
2. **亲跑三件套——全真且精确**：`pnpm lint` exit 0；`pnpm build` 成功 + `assert-client-banner-handshake.mjs` **5/5 PASS** exit 0；`vitest run` → **37 files / 769 passed (769)** exit 0（=765+4 新臂，与声称精确一致）；重建后 `git status --porcelain` 空 → 产物字节级可复现。
3. **R1 红线——字节级不变**：按 patcher/README.md:349-365 口径自 git 对象读取切片（`export const SUPPORTED = {` 起、至其后首个**列 0** `// ----------` 行止、不 trim），HEAD=405a4f7 = 60255f4 = 基线 f72f64f 同值：sha256=`8e2d0b7effb1b9af0151b2e2aa8b408eb67b5d58c180e29df3c8730ac059b0f9`、chars=14889、bytes=14926——三数字精确复现。
4. **S-9——fixed/verified（真臂）**：`cardLang()`（src/client/index.ts:203-211）模块私有、委托共享 `resolveLang`（与 panel 同语义）；摘要卡与 fallback 渲染全走 `uiT(key, lang)`（:230-240、:249-251）；en navigator mock 真臂 **4/4 绿**（en 卡 ZERO-CJK+EN 文案 / en fallback / probe-missing zh 默认 / zh-CN 显式包裹臂）；dist/client.cjs:351-352、:364 渲染 `t(dict, lang)` 驱动，无硬编码字面量残留；Node v24 `globalThis.navigator.language==='en-US'` 环境发现实测成立，显式包裹处理正确。
5. **S-10——fixed/verified（真臂）**：number 值 trim 后空串映射 NaN 同拒（client/index.ts:553-562），整单拒绝+键名提示；invalidNumber 措辞双语义（zh「无效或为空」/en「Invalid or empty」）；空串拒提交臂复跑绿（**posts.length===0** + protectionFloorTokens/summaryCeilingChars 在消息 + 「未提交」）。
6. **S-5——fixed/verified**：grep LedgerStatsFromDb 于 src/tests/scripts 仅剩解释注释 1 处（ui/index.ts:40；lib/index.d.ts:2465 同）；ui/index.ts:20 `import type { LedgerStats } from '../storage/db.ts'`（单一真源，routes.ts:32 先例）；`git diff 60255f4..405a4f7 -- lib/index.js` = **0 行**（纯类型层证实）；lib/index.d.ts:2458-2465 已重掷真类型。
7. **checkpoint STEP-0004 链——亲算全中**：`prev_hash` = SHA-256(step-3 checkpoint.json blob 字节 @60255f4) = `5ceaa51289713978d579525126b6d1b3581cc27ca20b6136455ae5bab9d7db78` MATCH；`hash` = insertion-order compact JSON（去 hash 字段）= `ee704d82843a761aa5ae4fbf23b76b398c9bbd6d62cfef622e1184333cc5cd8d` MATCH；同 recipe 复算 step-3 = `067509185ccf5fc9efa7198ec1abb110eac786bc1af5ba4f439c1385e2e6e8d1` MATCH（recipe 自证成立）；**8/8 artifacts** 哈希与实际文件 MATCH。
8. **Z37 坑册**：G:\000Github\zDSH\ZDSH-LESSONS.md:225-229 在册，现象/根因/修法/一句话四段齐备，防复发项与本轮非受控+deps 重臂实现一致。

额外核验：closure.json **15/15 fixed/verified**（S-5 收口 evidence 含 commit+臂级证据）；zh 字面量出字典后 src 仅剩注释引用（client/index.ts:189）；r2 diff 凭证模式 grep 仅命中类型名与治理文本，无泄露。

## 终审残留（2 条，均机械治理项，零代码变更）

- **RES-1 [建议]** CHANGELOG.md:20-21 —— "number fields are submitted as numbers, a NaN value rejects the whole submit with a message" 未随 S-10 扩展为「NaN **或空值**拒绝」。句子仍真但不完整：同一波次刚改的用户可见行为应同步（B-5 逐句精确标准的延续）。修法：单句改写。
- **RES-2 [建议]** tasks/ZCTX-FULLPANEL/checkpoint-history.jsonl —— 现仅 1 行（step-3 快照），**STEP-0004 快照未追加**（§2.2 落盘顺序含「原子写 checkpoint → 追加 checkpoint-history → 追加 progress」；r2 提交只写前两者；r1 曾正确执行）。checkpoint.json 本体链完好（第 7 项亲算），断点续跑能力不受损，但 append-log 轨迹在第 4 步断链。修法：append-only 追加 405a4f7 的 checkpoint.json 快照行（状态文件豁免 del 备份，§13）。

两条无法以 `fixed` 以外的合法 disposition 关闭（`not_applicable` 不成立——均实际适用；`user_approved_deferred` 无用户批准），故 §11 零遗留门未过 → 最终验收打回；分数门（98≥98）已达标，不触发 §12.4 返工轮计数（无代码缺陷）。

## 终审评分（六维 · 评分人=reviewer-r2 · 作者=coder/main · 每维证据见 scorecards/B3.json round3_final）

| 维度 | 得分 | 证据摘要 |
|---|---:|---|
| 正确性 | 25/25 | 三修真臂+产物字典驱动（第 4/5/6 项）；无新缺陷；r2 复评 correctness−1 的 select 孤值项判 not_applicable（纯外观、数据恒正确可恢复、非 r2 范围）。 |
| 完整性 | 20/20 | r2 卡范围逐项交付亲证；closure 15/15。 |
| 一致性 | 19/20 | −1 = RES-1（CHANGELOG 措辞未随 S-10 扩展）。其余一致面全真（链 recipe 复算 step-3 MATCH、i18n 5 新键双语成对、cardLang 与 panel 同源）。 |
| 可验证性 | 14/15 | −1 = RES-2（history 追加缺失）。其余全部精确复现（lint/build/握手/769/R1 三数字/链三哈希/8×8 artifacts/重建净树）。 |
| 安全回滚 | 10/10 | 无 auth/patcher 触碰、R1 同值、零凭证、worktree 净、产物可复现。 |
| 可维护性 | 10/10 | 单一真源恢复、文案集中字典、统一拒绝路径、注释真实化、Z37 在册。 |
| **合计** | **98/100** | §12.3 零触发。 |

## 放行条件（终验门微修单——一次治理提交）

1. CHANGELOG.md:20-21 句改写覆盖空值拒绝（RES-1 → fixed）。
2. checkpoint-history.jsonl append-only 追加 STEP-0004 快照行（RES-2 → fixed）。
3. closure.json 增 RES-1/RES-2 两条目（fixed + verified + 证据）。
4. 复核 = 终审人重读两文件 + closure 两条；若 checkpoint.json 因此推进 step-5，仅需链 recipe 复算，无需重跑全量。

## 诚实记录

- 本评审第一遍 R1 切片复算用裸子串 `indexOf('// ----------')` 命中段内缩进注释得到 110 字节——正确口径为**列 0** 分隔行（README:349-365 实测锚点段 + 复评段第 2 项「列 0 分隔行不含」），修正后三数字精确复现。登记为评审自身流程笔记，不涉仓库代码。
- 除 RES-1/RES-2 外，主线 r2 全部声明独立复现为真，无失实声明。
- B4 真机验收照计划执行（面板渲染/语言跟随/统计读数/设置真写）——本评审未触碰真机。
