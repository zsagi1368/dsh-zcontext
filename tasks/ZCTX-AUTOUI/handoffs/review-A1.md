# ZCTX-AUTOUI 对抗评审报告（review-A1）

```
FROM: reviewer-A1 (independent, 评审人≠作者)  TO: 主线
MODE: verify
TASK_REF: ZCTX-AUTOUI @ worktree HEAD=5d2f683, base=f8dfa6c
PAYLOAD: 本文件（六维评分 + 阻断/建议清单 + VERDICT）
ATTACHMENTS: 见各条目证据路径
```

复述理解（≤3 行）：本波给 preflightMode 增加 'auto' 档并设为默认（同 route 校准台账 ≥4/8 条 worst 误差 ≤15% → effective enforce，否则 observe，fail-soft），snapshot/面板新增运行形态行，水位策略仅呈报。评审范围 = git diff f8dfa6c..5d2f683。

## 0. 规模与真实性核验

- diff 总量 727 行（681+/46-，19 文件）；其中 188 行为构建产物（lib/index.js、lib/index.d.ts、lib/index.js.map、dist/client.cjs），人写源码+测试+task 卡 ≈539 行 < 600 行门槛，不触发拆小打回。
- **构建产物可信**：评审员在 worktree 重跑 `npm run build` 后 `git status --short` 与 `git diff` 输出为空 → 提交的 lib/dist 是可复现构建的真实产物，无手工改产物。
- 独立复跑门：`npx tsc --noEmit` exit 0；`npx vitest run` = **38 files / 802/802 passed**；`npm run build` 握手 **5/5 PASS**（banner-single-arg-factory / banner-id / footer / no-three-arg-factory / node-check-syntax）。与作者声称一致。

## 1. 逐条对抗结论（对照任务卡评审清单）

### 1.1 auto 逻辑正确性（重点对抗）

1. **口径一致性 ✓**：`autoEffectiveMode`（src/preflight.ts:512-534）的 billed = `usage.inputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0)`（:524），与 tools.ts:638 逐字一致；过滤链（projector!=='official' 跳过、short-circuited 跳过、usage?.inputTokens===undefined 跳过、billed≤0/非有限跳过）与 tools.ts preflightCalibrationStats 完全同构。误差取 `|estimate−billed|/billed`（:526）与 tools.ts:644-647 的 `Math.abs(errorPct)` 等价。
2. **无自反馈环 ✓**：enforce 短路的记录 outcome='short-circuited' 且无 usage（src/preflight.ts:487-491）；判据先查 `record.outcome === 'short-circuited'`（:521）后查 usage（:522-523），双保险排除；短路人不会出现在 errors 窗口 → promote 概率不被自己的短路推高。测试 arm（tests/preflight.spec.ts:503-523）用 8 条带 usage 的 short-circuited 记录构造，比真实情形更强（证明 outcome 过滤先于 usage）。
3. **fail-soft 完备 ✓**：读口缺失（`?.() ?? []`，:514）、throw（:531-532 catch→observe）、空台账、<4 条（:528）、NaN 误差（NaN≤15%===false→observe，:530 方向安全）全部降级 observe。`Math.max(...errors)` 上限 8 元素无展开溢出。台账 64 条有界（src/store.ts:175,870），最坏扫描 64 → 开销可忽略。
4. **阈值方向 ✓**：`worst <= 15 → enforce`（:528-530），>15% 观察；≤4 条观察；导出常量 8/4/15（src/preflight.ts:120-126）+ spec pin（tests/preflight.spec.ts:136-138, 549-554）。
5. **route 隔离 ✓**：`record.provider !== provider || record.model !== model` 双匹配（:519）；测试 arm（tests/preflight.spec.ts:525-537）4 条 other-provider/other-model 达标记录 → 本 route 仍 observe。台账本身 per-session（storeFor 注册表）→ promote 实际是 session×route 双隔离，比声称更保守，方向安全。
6. **判据数学 ✓**：4 条 billed 100k/110k/120k/130k、estimate=billed×1.04 → 误差恰 4.00%，worst 4%≤15% → enforce；bigTextMessage(170000)（510000 chars ÷3）对 window 200000/margin 0.9 是 hit 级（冷启动 arm 断言 hit=true 侧证，tests/preflight.spec.ts:449）。
7. **⑦ effectiveMode 写入 vs handleStream effective 判定 —— 两处不一致（见建议-1）**：
   - `judgeRequest`（src/preflight.ts:585）用 **raw** `provider, model`（''未替换，:552-553）算 effectiveMode 写入 record；
   - `handleStream`（:481-482）用 **替换后** 的 `judged.calibration.provider`（''→'(unknown)'，:586-587）重算 effective。
   - 确定性后果：provider/model 为空的请求，T1 查 '' 永远 0 命中（台账里存的都是 '(unknown)'）→ record.effectiveMode 恒 'observe'；T2 查 '(unknown)' 可命中并 promote。行为侧零偏差（hit=true 短路时 sink 覆盖 effectiveMode:'enforce'，:488，记录诚实；hit=false 时 enforce≡observe 行为），但 pass-through 记录的审计字段可能谎报。
   - 漂移窗口评估：T1→T2 之间无 await（judgeRequest 同步尾 → promise resolve → handleStream 微任务），台账更新源是网络流结算的宏任务，实际窗口为微任务级、需并发同 route 请求恰好在该窗口结算，后果仍限于审计字段（短路路径 sink 覆盖自纠）。**结论：不构成行为缺陷，但属审计字段自设目的的自伤，单次计算即可同时消除 key 不一致与漂移窗口 —— 建议当波修（见建议-1）。**

### 1.2 行为兼容

- 默认 observe→auto：无台账（新进程/新 session）→ observe = 与旧默认行为等价 ✓（冷启动 arm 钉）。有台账且达标 → 首次 enforce 短路 = 本次任务的诉求本体。R2 注释重写诚实（src/config.ts:83-95），enforce 仍受 margin 0.9 保护、one-shot 永不判（既有逻辑未动）。
- config schema：`preflightMode: { type: 'string', default: ... }`（src/config.ts:264）**无 enum 校验** —— fail-soft 验证器只查 string 类型（src/config.ts:336-355）；手改 profile 的非法值落盘后由 wirePreflightFace warn-once 兜底跑 observe（src/plugin.ts:761-768，消息已列 4 合法值）。UI 写入路径由 sanitizePatch 封闭值域（src/ui/config-write.ts:94-100，4 合法+5 非法测试 arm，tests/zctx-ui.spec.ts:615-643）✓。schema 无 enum 是既有模式（schemastery 门面未暴露 enum()），记建议-2。
- **面板设置表单未随默认值放宽 —— 阻断-1（P1 回归）**，见下。

### 1.3 patchFace 显示

- SnapshotDeps.patchFace 可选 + accessor 缺失 → patchFace undefined → 面板省略行（旧宿主兼容）✓（src/ui/snapshot.ts:60-66, tests/zctx-ui.spec.ts:497-501 第二断言）。
- throw → `{state:'unknown'}`（src/ui/snapshot.ts:60-66, 测试 :503-519）✓；readPatchMarker 自身亦不 throw（src/patch-bridge.ts:133-162 全路径 fail-soft）。
- v0.1 marker（无 patchSet）→ present 但 patchSet 缺省 → 面板渲染"补丁完全功能模式"无后缀（src/client/index.ts:497-501 三元链）✓。
- client parse 防御收窄 ✓（src/client/index.ts:349-359：null/非对象/数组拒绝、state 白名单、patchSet/version string 收窄）。
- plugin.ts 映射（src/plugin.ts:469-480）present 分支展开 patchSet/version，absent/unknown 收窄为 {state}；import 预先存在（无新增 import）✓。

### 1.4 测试真实性

- 达标臂数学 4.00% ✓（见 1.1.6）；>15% 臂 1.3×→30% ✓；short-circuited 臂 8 条构造 ✓；route 隔离臂 4 条 ✓；默认钉 preflight.spec（'auto' + configSchema roundtrip）与 smoke.spec:85-89 同步 ✓；zctx-ui snapshot 4 臂（present / absent+无 accessor / throw）+ preflightMode 写入 4 合法 5 非法（400）✓；panel-i18n 3 臂（present/absent/无字段行省略）✓。i18n 4 键双语齐（src/ui/i18n.ts:77-81）✓。
- **但 tests/panel-i18n.spec.ts:335 把旧三值选项列表钉成期望值且仍然通过 —— 选项列表未随默认值放宽（阻断-1 的组成证据）**。

### 1.5 R1（补丁面与估算器核心零触碰）

- `git diff --stat f8dfa6c..5d2f683 -- patcher/ src/fold-engine.ts src/autofold.ts src/budget.ts` 输出为空（三文件确认存在，检查非空转）→ **R1 成立** ✓。auto 改动只落在 listener 判定层（preflight.ts），估算核心 projectAndEstimateRequest/estimateProjectedRequest 未动。

### 1.6 完整性（文档/呈报）

- **README 两处过时（阻断-2）**：README.md:155 `preflightMode: 'off'|'observe'|'enforce'` — default `'observe'`；README.md:229 配置表同行同错。三档叙述段（:152-162）无 auto 语义。
- **CHANGELOG 缺条目（阻断-2）**：[Unreleased]（CHANGELOG.md:7 起）无 ZCTX-AUTOUI 内容；本仓库先例（ZCTX-FULLPANEL B-5/S6、ZCTX-I18NFIX 建议-2 均把 CHANGELOG 同步当评审整改项）证明这是合入门的一部分。默认翻转是全体存量用户可见的行为变更。
- 水位策略（诉求③）：task.json options_considered C 如实记录（固定水位列 v0.4 候选不做）。评审员判断：**对话呈报足够满足用户问句**（问句非改码诉求），但 v0.4 候选需书面台账位置防呈报蒸发 —— 并入阻断-2 的 CHANGELOG/README 一并落（建议-3 单列理由）。

## 2. 阻断清单（不修不能合入）

### 阻断-1（P1 功能回归）面板 preflightMode 选择器缺 'auto'，默认态下设置表单被自伤
- 位置/证据链：
  1. src/config.ts:228 —— 默认 'auto'；
  2. src/ui/index.ts:72 —— GET /zctx-ui/api/config 的 faceSwitches 取**生效配置** `all.preflightMode`（含默认，未写 overlay 的用户也得到 'auto'）；
  3. src/client/index.ts:590,594 —— select defaultValue='auto' 但选项仅 `['off','observe','enforce']`；
  4. src/client/index.ts:625-641 —— 保存路径 collect 无条件读取**全部** [data-key] 元素（非脏检查）并整体 POST；
  5. 分支 A（HTML/React select.value 语义）：value 'auto' 无匹配 option → el.value='' → POST preflightMode:'' → src/ui/config-write.ts:97 拒绝 → routes.ts:216-219 400 → **默认态下面板任意设置保存整体失败**；
  6. 分支 B（渲染器保留 selectedIndex 0）：显示 'off' → 保存 POST 'off' → src/plugin.ts:751 早退 → **preflight 面被静默整体关闭**；
  7. tests/panel-i18n.spec.ts:335 —— 旧三值列表被钉为期望，锁死错误状态。
  同批：src/ui/i18n.ts:125 字段标签文案 `(off|observe|enforce)` 未含 auto（用户可见）。
- 影响：诉求①（auto 为默认）被面板自身的设置表单抵消——默认状态无法显示、无法从面板选回，且存在静默关面/全保存失败两条坏路径。
- 修复建议：client/index.ts:594 选项数组加 'auto'（建议排在首位以匹配新默认语义）；i18n.ts:125 标签改 `(off|observe|enforce|auto)`；更新 panel-i18n.spec.ts:335 pin 为四值并加一条回归臂：GET 视图 preflightMode='auto' 时 select 显示值 === 'auto' 且保存 POST === 'auto'（两分支都钉死）。

### 阻断-2 文档未随默认翻转同步（README ×2 + CHANGELOG 缺条目）
- 位置：README.md:155、README.md:229（仍写三档联合 + default 'observe'）；CHANGELOG.md [Unreleased]（:7 起）无本任务条目。
- 理由：默认 observe→auto 是存量用户可见行为变更（有台账且达标后首次出现 enforce 短路）；本仓库多次评审整改把 CHANGELOG/README 同步当合入门。文档与行为不符会直接误导三档用户的选择——这正是本任务要解决的问题的反面。
- 修复建议：README Preflight (S1) 段改四档 + default 'auto'，补 auto 语义（同 route 最近 8 条可比 ≥4 且 worst ≤15% → enforce，否则 observe；冷启动/异常 fail-soft；enforce 仍受 margin 0.9 保护）与运行形态行说明；CHANGELOG [Unreleased] 增条目覆盖：默认翻转及其对存量用户的影响、auto promote 判据、面板运行形态行、③固定水位策略列为 v0.4 候选（书面呈报留痕，见建议-3）。

## 3. 建议清单（不阻塞中间合入，阻塞最终验收）

### 建议-1 effectiveMode 双次计算且两处 route key 不同（审计诚实性）
- 位置：src/preflight.ts:585（judgeRequest，raw '' 键）vs :481-482（handleStream，替换后 '(unknown)' 键）。
- 理由：见 1.1.7。确定性情形（空 provider/model）下 pass-through 记录的 effectiveMode 可与实际 effective 漂移；并发下存在微任务级漂移窗口；行为侧零偏差（sink 覆盖自纠 + hit=false 时 enforce≡observe），故不阻断中间合入；但该字段的存在目的就是审计诚实，且单次计算即可同时消除 key 不一致、漂移窗口与重复扫描。
- disposition 要求：fixed（judgeRequest 用与台账一致的替换后 route key 计算一次，挂到 JudgedRequest，handleStream 复用并写入 record）或 user_approved_deferred（附 owner/触发条件/复核日期）。

### 建议-2 configSchema 无 enum 校验（既有模式，warn-once 兜底）
- 位置：src/config.ts:264（type:'string' 无值域）+ src/config.ts:336-355（fail-soft 仅类型校验）。
- 理由：UI 路径已被 sanitizePatch 封闭（新测试覆盖）；带外手改 profile 的非法值落 warn-once→observe（src/plugin.ts:761-768），fail-soft 方向安全。属既有模式而非本波引入；schemastery 门面（src/config.ts:303-310）未暴露 enum()，加枚举需扩门面。可当波修或记账。

### 建议-3 水位策略 v0.4 候选的书面留痕
- 位置：tasks/ZCTX-AUTOUI/task.json options_considered C（已有）；缺长期可见位置。
- 理由：诉求③为问句、仅呈报不改码——对话呈报足够，不动代码正确；但"固定水位（billion-context 式 100k）vs 触发线驱动"的 v0.4 候选应随阻断-2 的 CHANGELOG 条目或 README Limitations 落一处书面指针，防止口头呈报随会话蒸发。

## 4. 六维评分（每维附证据）

| 维度 | 得分 | 证据 |
|---|---:|---|
| 正确性 | **20/25** | auto 判据与 tools.ts:638 同口径、fail-soft 完备、无自反馈、route 隔离、测试数学全对（src/preflight.ts:512-534,487-491；tests/preflight.spec.ts:425-554）；tsc 0 + 802/802 + 握手 5/5（评审员复跑）+ 重建零 diff。**扣分：阻断-1 面板设置表单在默认态下自伤（两条坏路径），属本波引入的功能回归（正确性硬阻断线 23 以下）**；建议-1 审计字段键不一致（小扣）。 |
| 完整性 | **14/20** | 诉求①②实现+测试齐（6 auto 臂/4 snapshot 臂/3 面板臂/值域 9 臂），task 卡五要素齐（tasks/ZCTX-AUTOUI/task.json）。**扣分：阻断-1（目标①的 UI 面未覆盖）、阻断-2（README×2+CHANGELOG 缺）、建议-3 书面留痕缺。** |
| 一致性 | **16/20** | warn-once 对称、导出常量+pin 纪律、deps seam、防御收窄均沿用既有模式（src/plugin.ts:761-768；src/preflight.ts:120-126；src/ui/types.ts:73-83,102-112）。**扣分：同一枚举在本波内放宽了 5 处却漏了 2 处（client/index.ts:594、ui/i18n.ts:125），且旧值被 spec:335 钉死——正是 pin 纪律要防的漂移。** |
| 可验证性 | **15/15** | 每项声称均可复现：评审员独立复跑 tsc/vitest/build；`npm run build` 后 `git status`/`git diff` 为空证明构建产物忠实；阈值常量导出+pin；测试数学可手工重放（1.04→4%、1.3→30%）。 |
| 安全回滚 | **10/10** | 零删除/零覆盖/零凭证；全部新字段可选+undefined 兼容旧宿主；readPatchMarker 只读且内部 fail-soft（src/patch-bridge.ts:133-162）；台账进程内存有界 64；git 历史单提交可回退。 |
| 可维护性 | **8/10** | 判据集中单函数、常量外导、测试种子因子化（seedCalibration）。扣分：effectiveMode 两处计算两种键（建议-1，维护陷阱）；sanitizePatch 手写四值联合未与类型/常量单源（小）。 |
| **总分** | **83/100** | <98 → 打回。硬阻断：正确性 20<23 + P1 回归未关闭 + 存在 OPEN 阻断项。 |

## 5. 返工范围界定

- 阻断-1 + 阻断-2 修复后按同门复验（tsc + 全量测试 + 握手 + 新增回归臂）。返工仅涉及 src/client/index.ts、src/ui/i18n.ts、README.md、CHANGELOG.md、tests/panel-i18n.spec.ts（及可选 preflight.ts 建议-1 / config.ts 建议-2）；preflight.ts 核心判定、snapshot/patchFace 链、测试主体数学均已对抗通过，无需重做。
- 本评审不计 patcher/ 与估算器核心改动（R1 零 diff 已证）。

R1-VERDICT: REWORK（83<98；差距=阻断-1 面板选择器缺 auto+pin 锁死、阻断-2 README/CHANGELOG 未同步；附建议-1/2/3 记账要求）

## 6. R2 复评（b26066d + b6875c0，评审员独立复核 2026-11-21）

### 6.1 r1 清单逐项核销

| r1 条目 | r2 状态 | 证据（评审员独立验证） |
|---|---|---|
| 阻断-1 核心（选择器缺 auto/保存自伤） | **FIXED ✓** | src/client/index.ts:598 四值选项（UI_DICT 驱动，src/ui/i18n.ts:83-87 双语）；回归臂 tests/panel-i18n.spec.ts:341-373 走真实 onClick 保存路径 + DOM stub，断言 POST faceSwitches.preflightMode==='auto'（两条坏路径 ''/off 被钉死）；三值 pin 改四值（:305-336，含 '自动 (auto·默认)' 文本断言）。dist/client.cjs 含 'auto·默认'（grep=1）。 |
| 阻断-1 批内子项（字段标签 i18n.ts:125→131） | **未修 ✗** | src/ui/i18n.ts:131 仍为 `'preflight 模式 (off|observe|enforce)'`——面板设置表单该字段标签（fieldLabel→FIELD_LABELS，src/client/index.ts:586 渲染）继续向用户谎报值域，紧邻一个含"自动 (auto·默认)"的四值 select。r1 阻断-1 明确列为同批修复项。无测试钉旧文案 → 单行修复零测试影响。 |
| 阻断-2（README×2 + CHANGELOG） | **FIXED ✓** | README.md:155 四值+default 'auto'；:157-159 auto 机制段（8/4/15 导出 pin 点名+earned-promotion）；:163 配置表行改四值+"auto"；:162 R2 红线机制化说明；:162 末尾水位策略 v0.4 候选书面指针。CHANGELOG.md [Unreleased] 新增 ZCTX-AUTOUI 节（:8-28：auto 语义/运行形态行/水位声明）。内容与实现逐项核对无漂移。 |
| 建议-1（effectiveMode 双算+键不一致） | **FIXED ✓** | src/preflight.ts:203-210 JudgedRequest.effective；:585-591 judgeRequest 单次计算且用台账一致的替换后键（routeProvider/routeModel）；:486-489 handleStream 复用 judged.effective；:493 短路 sink 不再二次覆盖（calibration 已带正确值）。固定 enforce 路径行为保持（effectiveMode 仍缺省，:588 条件展开）。漂移窗口与重复扫描一并消除。 |
| 建议-2（configSchema 无 enum） | **not_applicable ✓** | closure.json 记录 disposition=not_applicable + 证据（既有模式/warn-once 兜底/UI 路径 sanitizePatch 封闭）。disposition 合法。 |
| 建议-3（水位书面留痕） | **FIXED ✓** | README.md:162 + CHANGELOG 水位 note 双落。 |
| R1（patcher/估算器零 diff） | **保持 ✓** | `git diff f8dfa6c..HEAD --name-only` 无 patcher/、fold-engine/autofold/budget。 |

### 6.2 独立复跑门（评审员执行，非转述）

- `npx tsc --noEmit` exit 0。
- `npx vitest run`：**38 files / 803 passed (803)** —— 与声称一致（802→803 = +1 回归臂；B-2a 为改写非新增，计数自洽）。
- `npm run build`：握手 5/5 PASS；构建后 `git status --short`/`git diff` 为空 → 提交产物忠实。
- lib/index.d.ts r2 零变更**正确**：JudgedRequest 为未导出内部接口（src/preflight.ts:194，grep export=0）。
- Z36 诚实性：当前 b26066d 提交信息写 803/803 与实测一致；amend 前信息已不可考，progress.md:1 记录了更正事实 —— 接受为已更正并留痕。

### 6.3 过程发现（新）

- **closure.json 对 A1-阻断1 的 verified 声明过度覆盖**：ledger 证据行（"selector 4 values + preflightOpt* labels + GET-auto→POST-auto regression arm"）未包含批内标签子项，而该子项未执行 —— 台账把部分完成记成了整体 fixed/verified。§12 纪律：证据必须支撑声明；抽查即发现。修标签后同步补证据行即可（无需新条目）。
- 新引入代码未发现其它缺陷：`t(... as UiDictKey)` 安全（4 键齐；t() 对未知键回落 key 字符串，src/ui/i18n.ts）；回归臂的 fieldEl stub 结构与真实 DOM 契约（data-key/data-type/value/checked）一致。

### 6.4 R2 六维评分

| 维度 | 得分 | 证据/扣分依据 |
|---|---:|---|
| 正确性 | **24/25** | auto 单次计算无漂移（src/preflight.ts:203-210,585-591,486-493）；回归臂钉死保存路径；tsc 0+803/803+握手（独立复跑）。扣 1：i18n.ts:131 用户可见文案对值域陈述错误（阻断-1 批内残留）。 |
| 完整性 | **19/20** | r1 全部差距清单执行（README/CHANGELOG/选择器/回归臂/台账）；扣 1：阻断-1 批内标签子项未完成（完整性残留）。 |
| 一致性 | **19/20** | 枚举放宽在本波 7 处中 6 处一致（types/config/tools/config-write/plugin/client 选项/i18n 选项标签）；扣 1：字段标签是第 7 处仍未放宽。 |
| 可验证性 | **13/15** | 全门独立复现+重建零 diff+台账 8 条带 disposition；扣 2：closure.json A1-阻断1 verified 声明证据未覆盖批内全部子项（过度声明，§12 抽查发现）。 |
| 安全回滚 | **10/10** | 同 r1（零删除/零覆盖/可选字段/fail-soft/单提交可回退），r2 未引入新风险面。 |
| 可维护性 | **10/10** | effectiveMode 单次计算消除双算陷阱；标签走 UI_DICT 单源；台账/进度/checkpoint 增量落盘齐全。 |
| **总分** | **95/100** | <98 → REWORK。唯一差距 = 阻断-1 批内标签子项（一行字符串）+ 台账证据行补全。 |

### 6.5 R2 返工范围（收窄到单行）

1. src/ui/i18n.ts:131 —— zh/en 标签改为含 auto（建议 `preflight 模式 (off|observe|enforce|auto)` / `preflight mode (off|observe|enforce|auto)`；如愿意可加"默认 auto"字样，非必须）。
2. tasks/ZCTX-AUTOUI/closures/closure.json —— A1-阻断1 证据行补标签子项，或（若本轮仍未修）把标签拆为独立条目记 OPEN——禁止维持过度声明。
3. 复验门：tsc + 全量测试 + 握手（无新增测试要求；旧文案无测试钉，零测试影响）。

R2-VERDICT: REWORK（95<98；唯一差距=阻断-1 批内标签子项 src/ui/i18n.ts:131 未修 + closure.json 该条目证据过度声明；其余全部对抗通过）

## 7. R3 快核（4116796，评审员独立复核 2026-11-21）

### 7.1 差距清单核销

| r2 残留 | r3 状态 | 证据（评审员独立验证） |
|---|---|---|
| i18n.ts:131 标签未含 auto | **FIXED ✓** | src/ui/i18n.ts:131 → `'preflight 模式 (off|observe|enforce|auto)'` / `'preflight mode (off|observe|enforce|auto)'`（zh+en 双语，单行对位）；dist/client.cjs 含四值串 ×2（grep=2，与双语两处一致）。 |
| closure.json A1-阻断1 证据过度声明 | **FIXED ✓** | 证据行补 "FIELD_LABELS.preflightMode label extended to off|observe|enforce|auto (review-A1-r2 residual, dist bundle carries the four-value string ×2)"——声明与证据现已对齐。 |
| R1（patcher/估算器零 diff） | **保持 ✓** | r3 diffstat 仅 i18n.ts/closure.json/review-A1.md/dist/client.cjs，无 patcher/、fold-engine/autofold/budget。 |
| 报告完整性 | **确认 ✓** | r3 提交对 review-A1.md 为纯追加（r1 VERDICT 行改名为 R1-VERDICT 存档 + r2 段落逐字入册），两条 REWORK 判词原样保留，无篡改。 |

### 7.2 独立复跑门（评审员执行）

- `npx tsc --noEmit` exit 0；`npx vitest run`：38 files / **803 passed (803)**；`npm run build` 握手 **5/5 PASS**；构建后 `git status --short`/`git diff` 为空 → 提交产物忠实。

### 7.3 R3 终局评分

| 维度 | 得分 | 说明 |
|---|---:|---|
| 正确性 | **25/25** | r2 的唯一 -1（标签值域谎报）已清零；单行机械改动无新路径。 |
| 完整性 | **20/20** | r1 阻断×2 + 建议×3 全部 fixed/verified；r2 残留清零。 |
| 一致性 | **20/20** | 枚举放宽在本波全部 7 处一致（types/config/tools/config-write/plugin/选择器/标签+文案）。 |
| 可验证性 | **15/15** | 全门三轮独立复现；台账 8 条 disposition 合法（fixed×7 / not_applicable×1）且证据与声明逐条对齐；Z36 诚实更正留痕。 |
| 安全回滚 | **10/10** | 三轮零删除/零覆盖/零凭证；可选字段+fail-soft；单链提交可回退。 |
| 可维护性 | **10/10** | 单次 effectiveMode 计算、字典单源、台账完整。 |
| **总分** | **100/100** | 硬阻断清单逐项过：无伪造（Z36 已 amend+留痕）；正确性 25≥23；安全回滚 10≥9；测试 803/803 全过；无 OPEN 遗留；del 零改动。 |

合并前提醒（非评审差距，主线既有计划已含）：真机验收补 snapshot.patchFace=present+patchSet 捕获与运行形态行渲染（acceptance 第 4/5 条）；合并走 --no-ff+tag+台账；auto 新默认首次真机 enforce 需 ≥4 条同 route 可比记录后才发生，冷启动行为=observe（与旧默认等价）。

R3-VERDICT: RELEASE-OK（100/100；r1 三项差距与 r2 单行残留全部 fixed/verified，无 OPEN；放行合并+真机验收）
