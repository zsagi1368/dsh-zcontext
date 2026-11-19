# ZCTX-SIDEBAR B3 独立评审报告

- 评审对象：worktree `worktrees/ZCTX-SIDEBAR`（分支 `feat/ZCTX-SIDEBAR`，B1 基线 `17d2360`，HEAD `8543e0a53beb9a0f28780f5ade86dec920b85130`；3 提交 c67247f D1 / b811efc D2 / 8543e0a D3）
- 评审人：reviewer-b3（独立 subagent，作者=main，评审人≠作者）
- 日期：2026-11-19
- diff 规模：`git diff 17d2360..HEAD | wc -l` = **442 行 < 600**，符合拆分纪律，无需打回拆小。
- 结论：**打回（总分 76 < 98，且触发 §12.3 硬阻断：正确性 18 < 23 + 失实证据）**
- [阻断] 2 条（B3-B1 / B3-B2），[建议] 8 条（B3-S1…B3-S8）。全部 OPEN，无 disposition 可关闭项。

---

## 一、必核逐项（三值：PASS / FAIL / 无法验证）

### 1. 契约正确性（binding 不变量） — PASS
- panellist 与 main 共用同一字面量：`src/client/index.ts:115` `const PANEL_ID = 'dsh-zcontext.panel'`；panellist 注册 `id: PANEL_ID`（:365），main 注册 `key: PANEL_ID`（:356）。**同一常量两处引用，binding 成立**。
- panellist 条目三项齐备：`id`（:365）/`order`（:366，PANEL_ORDER=60，:116）/`label` thunk（:367 `() => 'zcontext'`）。
- main 为 keyed 形态（`{name:'main', key: PANEL_ID}`，:354-357），与 slot-catalog「main：Central panel selected by sidebar entry id」一致。
- 先例逐行对照：`zDSH-main/packages/client/ui-plugin-manager/src/client/index.ts:110-147`（main key=PANEL_ID + panellist id=PANEL_ID/order/label thunk），`ui-schedule/src/client/index.ts:168-184` 同形。实现形态与先例一致。
- ID 无冲突：`dsh-zcontext.panel` 不在 shipped occupants（conversation / plugin-manager / schedule）中。

### 2. capability gate（Z21/Z25） — PASS（实现）/ 测试覆盖缺口见 B3-S2
亲测三臂（node 直接 import 源文件、构造注入抛错/缺失的 ctx）：
```
main-missing   registered: ["settings.section","sidebar.panellist"]   （inject('main') 抛错被吞，panellist 仍注册）
panellist-missing registered: ["settings.section","main"]              （反向同理）
react-missing  registered: ["settings.section","sidebar.panellist"]    （main 不注册；card 降级链接）
```
- slots 服务缺失：:340 早退，不抛（既有测试 :287-290 亲跑绿）。
- main 缺失：:353-361 try/catch；panellist 缺失：:362-371 try/catch。两臂互不拖累，无 PENDING 语义（inject 只在声明期回调）。
- React 缺失：`createPanelComponent(undefined)` 返回 undefined（:256），main 不注册；`createSummaryCard` 返回 undefined → `createFallbackLink`（:175-179, :203-207）——与任务卡「helper 返回 undefined、card 仍降级为链接」一致。
- 但 React 缺失时 panellist **仍注册**（探针输出第三行），见 B3-S1。

### 3. 数据面 — FAIL（pressure 字段与真实 API 契约不符，见 B3-B2）
- 同源 fetch：`/zctx-ui/api/snapshot`，默认 `fetch(url).then(r => r.text())`（:202），**不带任何 token 头**；服务端读授权 `authorizeRequest` 接受同源或 loopback（`src/ui/auth.ts:92-99`）——同源读合法，不越权。PASS。
- 5s 轮询：`setInterval(load, 5000)`（:269）；卸载清理：effect 返回 `() => { alive=false; clearInterval(timer) }`（:270）。PASS（探针确认 cleanup 为 function）。
- fail-soft：`parsePanelSnapshot('not json')` → `{}` 不抛；`'{}'` → `{}`（测试 :312-315，亲跑绿）。PASS。
- **FAIL**：`parsePanelSnapshot` 读 `win.limitTokens ?? win.windowTokens`（:223），真实快照里**均不存在**；真实字段是 `window.contextWindow`（`src/ui/types.ts:40`）与 `window.pressurePct`（:44）。我用真实形状回放：
```
REAL-SHAPE => {"sessionId":"s1","sessionResolution":"latest-watched","faceState":"active","foldCount":1,"cacheSamples":7,"cacheMeasured":true,"ranges":1}
```
无 `pressurePct` → 面板「窗口占用」永远 `n/a`（:283），V3「查看」核心指标失效。且新测试夹具使用的是虚构 `limitTokens` 形状（tests/client-slot.spec.ts:297），属于假绿。详见 B3-B2。

### 4. U-2 诚实边界 — PASS（代码）/ 文档未同步见 B3-S6
- 设置区仅一条只读说明 + 跳转链接：`'设置修改请到完整面板（此处只读，避免越权写入）'`（:290）+ `<a href="/zctx-ui" target="_blank" rel="noopener noreferrer">`（:291）。
- 客户端源码/产物零写请求：`grep -n "POST" src/client/index.ts` 无命中；`grep -c "POST" dist/client.cjs` = 0。无直接 POST 写。
- 与 U-2 token 洞的处置一致（跳完整页由用户在真浏览器改）。
- 但 plan §4 承诺「设置（只读字段 + 链接）」，实际无任何只读字段渲染，见 B3-S5；README 未提新左菜单入口，见 B3-S6。

### 5. R1 红线 — PASS
- 从 git 对象取（避免 autocrlf）：`git show HEAD:patcher/zctx-patch.mjs`，切片自 `export const SUPPORTED = {` 起至支持对象闭合后紧邻的段分隔行前（含 `}\n\n`，不含分隔行）：
```
HEAD (8543e0a): chars 14889  bytes 14926  sha256 8e2d0b7effb1b9af0151b2e2aa8b408eb67b5d58c180e29df3c8730ac059b0f9
BASE (17d2360): chars 14889  bytes 14926  sha256 8e2d0b7effb1b9af0151b2e2aa8b408eb67b5d58c180e29df3c8730ac059b0f9
```
与 patcher/README.md 钉死锚点（14889 字符 / 14926 字节 / 8e2d0b7e…）逐值一致，两侧同值 → **R1 保持**。
- 全 diff 无请求体改写面：`git diff 17d2360..HEAD --name-only` 仅 `dist/client.cjs`、3 个 `lib/*.js.map`、`src/client/index.ts`、`tests/client-slot.spec.ts`、`tasks/.../progress.md`；`git diff … -- patcher/` 为空。
- 口径备注：patcher/README 的「第一个段分隔注释行」字面上会命中对象内部的文件分隔注释（offset 110，仅 110 字符）；以 README 自身钉死值反推，有效口径=对象闭合后的分隔行，按此复现 8e2d0b7e…，本项判 INTACT。该措辞歧义本身建议随 B4 文档顺带校正（不单独计条）。

### 6. Z35 握手/语法 — PASS
- `pnpm build` 亲跑：tsdown 构建成功；握手脚本 5 项全 PASS：
```
PASS  bundle.node-check-syntax — dist/client.cjs parses cleanly (node --check)
PASS  handshake.banner-single-arg-factory
PASS  handshake.banner-id-matches-package-name — "dsh-zcontext" -> "dsh-zcontext"
PASS  handshake.footer-two-braces-factory-and-load
PASS  handshake.no-three-arg-factory
client banner handshake: all checks PASS
```
- 独立 `node --check dist/client.cjs` → 通过。
- bundle 注册面 grep：`sidebar.panellist` 4 处（含注释）、`dsh-zcontext.panel` 1 处、`name: "main"` 1 处；`require("react")` 在（dist/client.cjs:36）。
- 构建可复现：build 后 `git status --porcelain` 为空、`git diff -- dist/ lib/` 为空 → 提交的 dist 与重建字节一致（sha256 83a2e3c081f1f3730d3747afd3f24d0792ee308b1110030737b9c4d946af5db1）。

### 7. 测试质量 — 部分 PASS，存在缺口
- `pnpm exec vitest run tests/client-slot.spec.ts` → **21/21 通过**（2026-11-19 23:27 亲跑）。
- 全量 `pnpm exec vitest run` → **35 文件 / 743 测试 全绿**。
- binding 断言：panellist 侧 `entry.opts.id` toBe 'dsh-zcontext.panel'（:262），main 侧 `panel.opts.key` toBe 同一字面量（:276）。两侧均对同一字面量断言，等价于 id===key 的强度，可接受（若要求严格交叉比较可一并改进）。
- 降级臂：`slots absent` 测试（:287-290）真实走 :340 早退，不是假绿；React 缺失臂真实断言「无 main + card 渲染出链接」（:127-140），是真断言。
- 缺口：main 缺失 / panellist 缺失两臂无自动测试（我以上述 node 探针人工验证实现正确）；`createPanelComponent` 的渲染、5s 轮询、卸载 clearInterval **零测试覆盖**。见 B3-S2。
- 假绿项：parsePanelSnapshot 的夹具形状（`limitTokens`）与真实 API 不一致（见 B3-B2），测试绿不代表线上字段可用。

### 8. 既有测试改动合理性 — 行为变化真实，但注入断言被弱化
- b811efc 改 `ctx.injected` `toEqual(['settings.section'])` → `toContain('settings.section')`（:85）：本次确实新增了 main / sidebar.panellist 两个 slot 注入，原断言必然失败，属于**行为真实变化**，不是为绿而改。
- 但 `toContain` 丢失了「注入集合精确」的守护力：未来若再注入 `locale` 等多余槽位，该测试仍绿。建议改 `toEqual(['settings.section','main','sidebar.panellist'])`（顺序确定）——见 B3-S3。
- `toHaveLength(1)` → 按 name 过滤（:86, :130-132）：React 缺失臂还新增了「main 注册数为 0」的负向断言，属**强化**；settings.section 臂过滤后仍断言 opts 全形（:87），可接受，但 :87 仍用 `registered[0]` 下标，依赖注册顺序（重排即误伤/误判），见 B3-S3。
- 结论：不属于「为让测试绿而弱化关键断言」，但精确性有回退。

### 9. inject 最小集 / 凭据 / 工作树 — PASS
- `export const inject = ['slots']`（:30），fiber 同值（:375）；测试 :74-77 断言 `toEqual(['slots'])`，未新增服务声明。
- 凭据零字面量：`git diff 17d2360..HEAD -- src tests` 对 bearer/api_key/secret/password/token 的 grep 仅命中注释词（"token gap"）与字段名，无可用凭据值。
- 工作树干净：`git status --porcelain` 输出 0 行（build/测试后复检）。

---

## 二、[阻断]（不修不能合入）

### B3-B1｜tsc 红 + progress 记录失实（V7 直接不达标）
- 位置：`src/client/index.ts:354, 363`；证据记录 `tasks/ZCTX-SIDEBAR/progress.md` STEP-0002。
- 问题：
  1. `pnpm lint`（即 `tsc --noEmit`，repo tsconfig strict=true）实际 **exit 2**：
     ```
     src/client/index.ts(354,38): error TS18048: 'ctx.slots' is possibly 'undefined'.
     src/client/index.ts(363,49): error TS18048: 'ctx.slots' is possibly 'undefined'.
     ```
     原因：:340 早退只保证进入后 `ctx.slots` 非空，但 TS 对闭包内再次访问 `ctx.slots`（:354/:363）不做窄化。
  2. 该错误在 D1 提交时即已存在（我对 `git show c67247f:src/client/index.ts` 单独 tsc，同报 TS18048 ×2，行号 353/362）——不是 D2 引入。
  3. `progress.md` STEP-0002 却记录「证据 tsc --noEmit=0」，与实测 exit 2 相矛盾，属**失实证据**（§9/§12.3 硬阻断项）。`pnpm test` = `tsdown && vitest run` 不含 tsc，因此 743 全绿掩盖了类型错。
- 修复建议：在 :340 之后提升局部变量（如 `const slots = ctx.slots` 并用 `slots` 后续调用），或改为显式非空参数；重跑 `pnpm lint` 至 exit 0；把 progress/checkpoint 的 tsc 证据改为真实重跑输出（如实修正记录，不得只改数字）。

### B3-B2｜parsePanelSnapshot 与真实快照契约不符 → 面板「窗口占用」永远 n/a；测试夹具同形假绿
- 位置：`src/client/index.ts:223`（`win.limitTokens ?? win.windowTokens`）、`:283`（渲染 `value.pressurePct`）、`tests/client-slot.spec.ts:297`（夹具 `window: { totalTokens, limitTokens }`）。
- 问题：真实 `ZctxSnapshot.window` 只有 `contextWindow` / `totalTokens` / `pressurePct` / `routed`（`src/ui/types.ts:38-45`，`src/ui/snapshot.ts:239` 实际产出同形），全仓不存在 `limitTokens`/`windowTokens`（`git grep` 仅 :223 与测试夹具）。结果：线上 `pressurePct` 恒 undefined，V3「查看」的窗口占用指标失效；而测试用虚构形状恰好喂出 25%，测试绿但与线上无关。
- 附带同源问题：`degraded` 真实类型是 `readonly string[]`（types.ts:74），客户端按 `raw.degraded === true`（:239）解析，恒 false，字段从未生效（当前未渲染，无用户可见影响，一并修正）。
- 修复建议：改为 `const p = win.pressurePct`（typeof number 直接用）或 `contextWindow` 与 `totalTokens.value` 现算；测试夹具换成真实快照形状（可复用 `createSnapshotSource` 产出的字段集），并补一臂断言「真实形状 → pressurePct 有值」「空快照 → 无 pressurePct」。

---

## 三、[建议]（不阻塞中间合入，阻塞最终验收；全部 OPEN）

### B3-S1｜React 缺失时 menu 条目仍注册，成为「死入口」（点击抛错）
- 位置：`src/client/index.ts:350-351, 362-371`；探针输出见必核 §2 第三行。
- 问题：React 缺失时 `panel === undefined`（main 不注册），但 `createPanelIcon(undefined)` 返回 `() => null`（:297-298）仍被注册进 `sidebar.panellist`。侧栏会渲染一个空图标行；点击它走 `SidebarRoot.tsx:68` → `ui-sidebar/src/client/index.ts:70-72` → `ui-layout/src/client/service.ts:72-74`，`layout.selectPanel` 对未注册 panel **抛 Error**（未捕获于点击处理器）。
- 理由：生产环境 `require('react')` 是平台 seed，概率低；但这是实现自己声明的降级面，行为应与「不注册 main」对称。
- 修复建议：panellist 注册同样以 `panel !== undefined` 为门（React 缺失时双不注册），或补测试明确接受「空图标行」并确保点击不抛（例如不注册）。
- disposition：OPEN

### B3-S2｜capability gate 两臂 + 面板渲染/轮询/清理 无自动测试
- 位置：`tests/client-slot.spec.ts`（A1 describe 仅 6 条）。
- 问题：任务卡点名的三臂（slots 缺失/main 缺失/panellist 缺失）只测了 1 臂；`createPanelComponent` 的初始 fetch、5s 定时、卸载 clearInterval、三区渲染均无测试（我用 node 探针人工验证了 cleanup 返回函数、首拉立即发生，但无固化）。
- 理由：V3 的刷新/清理是本次核心行为，纯靠真机 B4 兜底不符合「单测先于真机」的既有模式（Z34/Z35 教训）。
- 修复建议：注入 `fetchText` mock + `vi.useFakeTimers()` 断言：首拉 1 次、推进 5000ms 再拉、unmount 后推进不再拉；另用会抛错的 inject 构造 main/panellist 缺失两臂（形如我上面的探针）。
- disposition：OPEN

### B3-S3｜注入断言弱化为 toContain；settings.section 断言仍依赖注册下标
- 位置：`tests/client-slot.spec.ts:85, 87`。
- 问题：见必核 §8。`toContain` 无法拦截未来多余注入（Z21 的原始守护意图是「最小集合」）；`:87 ctx.registered[0].opts` 在注册顺序变化时会取错对象。
- 修复建议：`expect(ctx.injected).toEqual(['settings.section','main','sidebar.panellist'])`（或排序后比较）；`opts` 从过滤后的 `cards[0]` 取。
- disposition：OPEN

### B3-S4｜面板 CSS 缺失；图标多包一层 inline span（先例注释明确警告的坑）
- 位置：`src/client/index.ts:117-122`（CSS 仅 `.zctx-summary*`，无任何 `.zctx-panel*` 规则）；`:301`（`e('span', {className:'zctx-panel-icon'}, '◎')`）。
- 问题：
  1. 面板 10+ 个 class 全部无样式规则，V8 真机将呈现裸文本流（虽不阻断渲染）。
  2. 先例 `ui-schedule/src/client/TaskManagerIcon.tsx` 的文档注释明确：「an inline wrapper makes it the baseline of a line box inside the row's glyph slot, which lifts it above the label」——要求图标是行内 glyph 槽的直接子节点。本实现给 glyph 槽又套了一层 span，正是该注释警告的形态。
- 修复建议：补 `.zctx-panel` 区段 CSS（对齐 `--dsw-alias-*` 变量）；图标直接返回文本/单节点，不加 wrapper（或让图标组件用 `size` prop 渲染）。
- disposition：OPEN

### B3-S5｜「设置」区无只读字段，偏离 plan §4 接口契约
- 位置：`src/client/index.ts:289-291`。
- 问题：plan §4 写明「设置（只读字段 + '在完整面板中修改'链接）」；实现只有一个说明句 + 链接，没有任何设置字段（连只读展示都没有）。
- 理由：V4 验收文字是「设置区只读+跳完整页入口」，字面可判通过，但与已批准的接口契约不一致；风险是用户点开「设置」看到空区。
- 修复建议：渲染若干只读配置字段（nine core fields 的子集即可，数据可来自 `/zctx-ui/api/config` 的 GET），或经方案门修订 plan/README 明确「面板内不展示设置字段」。
- disposition：OPEN

### B3-S6｜README/CHANGELOG 未同步本次变更
- 位置：`README.md:245-267`（Realtime UI 一节）；`CHANGELOG.md`（无 Unreleased/0.4 条目）。
- 问题：README 只描述 `settings.section` 摘要卡；完全没有提「左菜单 zcontext 标签 + 主区面板」。`grep -c panellist README.md README.zh.md CHANGELOG.md` 均为 0。U-2 只读边界的说明也仅存在于代码注释。
- 理由：变更同步是验收清单第 7 项；发布波（B4/B5）前必须补齐，否则用户行为预期与文档不符。
- 修复建议：B4 合并时同批更新 README（Native entry 段：左菜单标签、三区、设置只读跳转、React 缺失降级）+ CHANGELOG 新条目（含 743 测试与握手证据）。若计划归 B4，请在 closure 明确 disposition 与 owner。
- disposition：OPEN

### B3-S7｜403/500 被静默渲染为 0（数据面失败无诚实提示）
- 位置：`src/client/index.ts:202`（`fetch(url).then(r => r.text())` 不查 `r.ok`）、`:253-267`（catch 静默）、`:281-288`（`?? 0`/`?? 'n/a'`）。
- 问题：远程 web（非 loopback、无 token、非 same-origin 头）读快照会 403，body 为 `{ok:false,error:'unauthorized'}`，`parsePanelSnapshot` 解析出空 view → 面板显示「折叠次数: 0 / 可折叠区间: 0 / 缓存样本: 0」，把「读失败」显示成「零数据」，与项目一贯的 honest-degrade 词汇（full page 的 degraded 行）不一致。
- 修复建议：`fetchText` 侧或组件侧检查非 2xx / `ok:false`，渲染「读取失败（403，需从 /zctx-ui 授权）」一类提示行；或复用 degraded 字段（按 B3-B2 修正类型后）展示原因。
- disposition：OPEN

### B3-S8｜checkpoint/progress 未随 D2/D3 落盘（§13「无 checkpoint 的步骤视为未发生」）
- 位置：`tasks/ZCTX-SIDEBAR/checkpoint.json`（step=1, block=B1, next="B2 coder"）；`tasks/ZCTX-SIDEBAR/progress.md`（仅 2 行，止于 "next=D2 测试+构建"）。
- 问题：D2（b811efc）、D3（8543e0a）两个交付步骤没有 checkpoint 与 progress 记录；D3 rebuild 与 743 测试证据无落盘回执。且 STEP-0002 的证据行本身失实（见 B3-B1）。
- 理由：§0.6/§2.2/§13 硬规则；中断恢复无法从当前 checkpoint 还原到 HEAD。
- 修复建议：补 D2/D3 两条 progress + checkpoint（含 dist sha256 83a2e3c0…、743/743、握手 5/5、R1 值），并修正 STEP-0002 的 tsc 记录为真实输出。
- disposition：OPEN

---

## 四、正面确认（评分证据基础，非豁免项）

- 绑定不变量、先例形态、slot 语义正确（见 §1）。
- 三臂能力门实现正确（slots 缺失/main 缺失/panellist 缺失均不抛；探针证据在案）。
- 同源只读数据面、5s 轮询、卸载清理、fail-soft 解析与 `'{}' → {}` 均正确（除 pressure 字段契约问题）。
- U-2：零写请求、零 token、设置只读+跳转，诚实边界成立。
- R1 双侧同值 8e2d0b7e…（14889/14926），patcher 零改动；全 diff 无请求体改写。
- 构建/语法/握手全绿且可复现（dist 与源码 commit 字节一致，树净）。
- 测试 21/21、全量 743/743；inject 最小集未变；凭据零字面量；工作树干净。

## 五、真机项（属 B4，不阻断 B3）

- V8：标签出现、点击开面板、数据实时、DSH 不被顶掉——本次未触碰真机，**无法验证**，随 B4 执行。
- 与 B3-S1（空图标死入口）、B3-S4（图标 baseline/无 CSS 的观感）相关现象会在真机暴露，建议 B4 验收时一并观察。

## 六、评分

| 维度 | 分值 | 得分 | 证据 |
|---|---:|---:|---|
| 正确性 | 25 | 18 | tsc exit 2（B3-B1）；pressurePct 恒 undefined（B3-B2，真实形状回放输出）；degraded 类型错配 |
| 完整性 | 20 | 15 | V1/V2/V5 完成；V3 窗口指标失效；V4 缺只读字段；测试少 2 臂 + 无轮询测试；文档未同步 |
| 一致性 | 20 | 15 | binding 与先例一致；parser/夹具与 src/ui/types.ts 契约不一致；README/CHANGELOG 不一致 |
| 可验证性 | 15 | 11 | build/握手/R1/测试命令均可复现（输出在案）；progress 的 tsc=0 记录失实；checkpoint 缺 D2/D3 |
| 安全回滚 | 10 | 9 | 零写/零 token/零 del 改动，回滚=revert；扣 1：死入口点击抛错属降级面未闭环 |
| 可维护性 | 10 | 8 | 结构清晰注释充分；面板 CSS 缺失、解析形状与新测试夹具各写一套、checkpoint 陈旧 |
| **总分** | **100** | **76** | < 98，打回；且正确性 18 < 23 触发 §12.3 硬阻断 |

## 七、结论

**打回。** [阻断] 2：B3-B1（tsc 红 + 失实证据）、B3-B2（快照契约不符 + 假绿夹具）。[建议] 8：B3-S1…S8，全部 OPEN，按 §11 记账，阻塞最终验收。修复后可走第 2 轮（本轮为第 1 轮返工额度内）。V8 真机项归 B4。
---

# ZCTX-SIDEBAR B3 复评报告（返工 r1 · 独立复核 · 2026-11-19）

- 评审对象：worktree `worktrees/ZCTX-SIDEBAR`，分支 `feat/ZCTX-SIDEBAR`，HEAD `5047c2c`（返工提交 `9daa1ca` + checkpoint 落盘 `5047c2c`）；返工 diff 范围 `8543e0a..5047c2c`，10 文件 / 479+ / 55-（含评审与落盘文件，业务面为 src/tests/dist/README）
- 评审人：reviewer-b3（复评，与上轮同一角色角度、独立重跑全部证据；作者=main，评审人≠作者）
- 日期：2026-11-19
- **结论：PASS（中间合入放行）· 总分 91/100。** [阻断] 0（B3-B1/B3-B2 均已修复并经本轮独立 verified）。残留 [建议] 6 项 OPEN（S2 / S4 / S5 / S7 部分 / S6 部分 + 新增 S9），按角色纪律**不阻塞中间合入、阻塞最终验收**。§12.3 硬阻断全部解除（正确性 24 ≥ 23、安全回滚 10 ≥ 9、无失实证据、744/744 通过、无 del 越权改动）。最终验收需 ≥98：残留逐项落到 fixed/verified 或 user_approved_deferred（须用户真实批准）后方可达标。

## 一、亲跑验证（全部命令本轮独立执行）

| 项 | 命令 | 结果 |
|---|---|---|
| 类型检查 | `pnpm exec tsc --noEmit` | **exit 0**（上轮 2×TS18048 消除） |
| 定向测试 | `pnpm exec vitest run tests/client-slot.spec.ts` | **22/22 通过**（278ms；上轮 21 → 新增「API 缺字段诚实 n/a」臂） |
| 构建 | `pnpm build` | tsdown 成功；**握手 5/5 PASS**（node-check-syntax / banner-single-arg / banner-id / footer-two-braces / no-three-arg） |
| 全量测试 | `pnpm exec vitest run` | **35 文件 / 744/744 全绿**（4.54s） |
| R1 切片 | `git show <ref>:patcher/zctx-patch.mjs` 独立切片重算 | HEAD / 8543e0a / 17d2360 **三侧同值 sha256=8e2d0b7effb1b9af…（chars 14889 / bytes 14926）** → R1 INTACT |
| 工作树 | build 后 `git status --porcelain` | **0 行**；`dist/client.cjs` 重建 sha256 `60cfe618…` 与 HEAD 提交版本字节一致；lib 无 churn |
| checkpoint 链 | node 独立复算（json-nohash 算法） | step1/step3 `prev_hash` 衔接 OK（dd404c4b…→7835e13a…），两条目哈希双双复现 → **链 VALID** |

## 二、逐条裁定（上轮条目 → 本轮）

### B3-B1 — fixed（verified）
- 源码 `src/client/index.ts:369` `const slots = ctx.slots` 局部化，:370 门控；后续 :372/:384/:392 全用 `slots`。gate 前仅剩 :349 `ctx.slots?.register?.`（可选链，安全）。亲跑 tsc exit 0。
- STEP-0002 失实证据处置：历史行保留（append-only 日志纪律），STEP-0003 显式更正并固化 RSI 教训（「曾写tsc=0未看真输出=失实证据，已认并改」）；checkpoint step3 的 tsc 证据为本轮真实重跑值。判 honest correction，成立。

### B3-B2 — fixed（verified）
- `pressurePct` 直读（:241，服务器已算值 verbatim 使用 :256，不再现算）；`totalTokens.value`（:243）+ `contextWindow`（:244）新增 tokens 渲染行（:307-308）；`degraded` 按 `string[]` 计数（:249 → degradedCount :262 → 面板「降级提示: N 条」:309-311）；`limitTokens`/`windowTokens` 全仓清除（grep src/tests/dist 仅剩注释中「不存在该字段」的说明）。
- 夹具逐字段对照 `src/ui/types.ts:40-74`：`window{contextWindow, totalTokens{value,basis}, pressurePct, routed}` = ZctxSnapshot.window（MarkedNumber :24-27 含 value/basis）；`cache{samples,measured,basis}` = :61-64；`degraded: ['session-unresolved']` = :74 `readonly string[]`。**逐字段一致，无虚构字段。**
- 新增「API 缺字段诚实 n/a」臂为真断言（JSON.stringify 丢 undefined → `window:{}` → pressure/degradedCount 均不出现在 view）。

### B3-S1 — fixed（verified）
- :381-382 `panel === undefined → return` 位于 main / panellist 两注册之前。
- 探针（tsc 单文件转译至仓库外临时目录执行，规避 worktree 内 `require('react')` 命中真实依赖）：
  - **react-missing → injected `["settings.section"]`**：main 与 panellist 均不注册，无死图标入口；
  - react-present → `["settings.section","main","sidebar.panellist"]`，main.key = panellist.id = `dsh-zcontext.panel`（binding 保持）；
  - panellist-absent → main 仍注册；main-absent → panellist 仍注册（互不拖累）。

### B3-S3 — fixed（verified）
- 测试 :85 改回精确 `toEqual(['settings.section','main','sidebar.panellist'])`；:87-89 opts 改从过滤后 `cards[0]` 取（去除 registered[0] 下标依赖）。探针实测注入顺序与断言完全一致。

### B3-S7 — 部分修复（主体 verified，残留 OPEN）
- `sameOriginFetchText`（:154-158）真查 `!r.ok → throw`（含 status），生产默认面 :340 启用；panel load catch 保留上一份好快照（:289）。
- **决定性探针**：mock fetch 返回 `ok:false, status:403` 且响应体故意内含合法快照字段（`pressurePct:99`）→ 面板 `setData` 从未被调用、99 未被吸收（GUARD WORKS）。上轮「403/500 响应体被解析成数据」的问题实证消除。
- 残留（OPEN，并入下述条目）：a) 持续性首次读取失败时，统计区仍按初始 `{}` 渲染 `?? 0` 零值、无「读取失败」提示行（查看区 n/a 是诚实的）；b) 守卫本身零单测（测试全部走 `fetchText` 注入绕过该路径）→ 测试缺口归 S2 范围。

### B3-S6 — 部分修复（README verified，CHANGELOG 残留 OPEN）
- README.md / README.zh.md 各 +2 行「侧栏面板（左侧菜单）」节：id/key/5s 轮询/设置只读+链接/React 缺失双不注册——逐句与实现核对一致，双语对齐。
- 残留：CHANGELOG 无新条目（B5 发布波归口可接受，但需 closure 登记 owner/触发条件）。

### B3-S8 — fixed（verified，细节残留 → 新增 S9）
- checkpoint step3（block=B3-rework-r1）：evidence `tsc 0 errors / 握手 5/5 / 744/744 / 4 commits` 与本轮亲跑值一致；链复算 VALID。
- progress STEP-0003 补齐（含对 STEP-0002 的更正与 RSI 自纠记录）。

### S2 / S4 / S5 — 如实残留与裁定
- **S2 OPEN**：main/panellist 缺失两臂 + 首拉/5s 轮询/unmount 清理 + r.ok 守卫，均无自动化测试（本轮 grep 确认无 useFakeTimers/setInterval 类测试；本轮探针系人工验证，不等于固化）。
- **S4 OPEN**：面板 CSS 规则仍为 0（`.zctx-panel*` 无任何样式规则，新增 `.zctx-panel-note` 亦无）；图标仍包 inline span（:329）。本轮仅新增 degraded 提示行。
- **S5 OPEN（本轮裁定）**：设置区「说明+链接」形式**满足 V4 字面验收**（「设置区只读+跳完整页入口」）与 U-2 诚实边界目标，且双语 README 已如实记载该形态；但 `reports/plans/ZCTX-SIDEBAR-plan.md:18` 明文承诺「设置（只读字段 + 链接）」，该契约偏差未走方案门修订。裁定：**不阻塞中间合入；阻塞最终验收**——收口二选一：(a) 渲染只读配置字段子集（GET `/zctx-ui/api/config`），或 (b) 修订 plan §4 措辞并在 closure 留修订证据。评审人无权代授 `user_approved_deferred`，须用户真实批准。

## 三、新增条目（本轮复评发现）

### B3-S9｜落盘格式与证据完备性残留（新，[建议]）
- `tasks/ZCTX-SIDEBAR/progress.md`：STEP-0003 与 STEP-0002 **粘连同一物理行**（文件仅 2 行；STEP-0002 原行无结尾换行，追加未补 `\n`）——内容完整可读，但破坏「一条一行」约定，影响机器解析。
- `checkpoint-history.jsonl` 数字跳步 step1→step3（无 step2 条目；D2/D3 仅由 step3 的 commits 列表覆盖，链衔接本身有效）。
- checkpoint evidence 未含 dist sha256 与 R1 值（上轮 S8 修复建议点名的两项）。
- 修复建议：progress 粘行拆分（后续追加前补换行）；下一 checkpoint 补 dist sha256/R1 字段。
- disposition：OPEN

## 四、正面确认
- 两个阻断均真修且本轮独立复现（非仅声明）；五臂注册探针全部符合预期；契约逐字段对齐 `src/ui/types.ts:40-74`。
- R1 三侧同值 8e2d0b7e…（14889/14926），patcher 零触碰；返工 diff 无请求体改写面。
- 构建可复现：dist 重建字节一致（60cfe618…），build 后树净。
- checkpoint 哈希链独立复算 VALID；失实证据以 append-only 更正留痕并固化 RSI 教训。
- 双语 README 与实现逐句一致（含「React 缺失双不注册」承诺，探针证实）。
- inject 最小集未变、零凭据字面量、零 del 改动。

## 五、真机项（B4，无法验证）
- V8 真机：标签出现 / 点击开面板 / 数据实时 / DSH 不被顶掉——本轮未触碰真机，**无法验证**，归 B4。
- S4 的观感影响（裸文本流 / 图标 baseline）会在真机暴露，B4 验收一并观察。

## 六、评分（复评终评）

| 维度 | 分值 | 上轮 | 本轮 | 证据 |
|---|---:|---:|---:|---|
| 正确性 | 25 | 18 | 24 | tsc exit 0 亲跑；B3-B2 契约逐字段对齐 + 五臂探针；r.ok 决定性探针 PASS；扣 1：首读持续失败时统计区零值无失败提示行（S7 残留） |
| 完整性 | 20 | 15 | 17 | V1-V5 满足；degraded 提示行进面板；扣 3：S2 测试缺口（两臂+轮询+守卫零自动化）、CHANGELOG 缺、S5 只读字段缺 |
| 一致性 | 20 | 15 | 18 | 夹具/parser/渲染与 types.ts:40-74 一致；injected 精确集恢复；双语 README 一致；扣 2：plan §4「只读字段」偏差未走修订（S5）、progress 粘行 |
| 可验证性 | 15 | 11 | 13 | 全部命令独立复现（tsc/22/744/握手/R1 三侧切片/哈希链复算/dist 字节一致）；扣 2：checkpoint 证据缺 dist sha/R1、history 数字跳步 |
| 安全回滚 | 10 | 9 | 10 | 零写/零 token/R1 INTACT/死入口闭环/树净/revert 可回滚 |
| 可维护性 | 10 | 8 | 9 | 解析与夹具同源单一契约、注释充分、RSI 教训固化；扣 1：面板 CSS 仍缺（S4）+ progress 格式 |
| **总分** | **100** | **76** | **91** | 残留全部为 [建议] 级；§12.3 硬阻断全部解除 |

## 七、结论

**PASS（中间合入放行）。** [阻断] 0：B3-B1 / B3-B2 已修复并经本轮独立 verified。[建议] 残留 OPEN 6 项：S2（测试缺口，含 r.ok 守卫）、S4（面板 CSS + 图标 wrapper）、S5（设置只读字段或 plan 修订）、S6（CHANGELOG）、S7（首读失败无提示行）、S9（progress 粘行 + checkpoint 证据缺项）；S1/S3/S8 判 fixed（verified）。以上 OPEN 项**不阻塞中间合入，阻塞最终验收**：最终验收前逐项落到 fixed/verified 或 user_approved_deferred（须用户真实批准并登记 owner/触发条件/复核日期），不得静默降级为「后续建议」。V8 真机项归 B4。

---

# ZCTX-SIDEBAR B3 终审报告（返工 r2 · 复评第 2 轮 = 终审 · 2026-11-19）

- 评审对象：worktree `worktrees/ZCTX-SIDEBAR`，HEAD `11e94f7`（返工 r2=`fd6997c` + checkpoint step4 落盘=`11e94f7`）；评审范围 `5047c2c..11e94f7`（fd6997c：7 文件 383+/95-，含评审与落盘文件；业务面 src/tests/dist/CHANGELOG）
- 评审人：reviewer-b3-final（终审，独立于实现作者 main；全部证据本轮独立重跑，评审人 ≠ 作者）
- **结论：打回。总分 78/100（<98），触发 §12.3 硬阻断 1 项（失实验证记录 + 正确性 20 < 23）。**
- 程序状态：本块返工评审已达第 2 轮上限（r1 打回 → r1 复评 91 PASS 中间合入 → r2 终审打回）。按 §12.4 / §1.4，**第 3 轮 coder 返工不可再自动派发，升级主线裁决**（聚焦修复清单见 §六，工作量约十行以内）。
- V8 真机项：本轮未触碰真机，**无法验证**，归 B4（不阻断 B3）。

## 一、亲跑验证（全部命令本轮独立执行）

| 项 | 命令 | 结果 |
|---|---|---|
| 类型检查 | `npx tsc --noEmit` | **exit 2，2×TS2722**：`tests/client-slot.spec.ts(373,5)`、`(398,7)` — `Cannot invoke an object which is possibly 'undefined'`（`createPanelComponent` 返回 `(() => unknown) \| undefined`，两处 `component()` 未 narrowing）。**与返工声明「tsc --noEmit（0）」不符。** |
| 定向测试 | `npx vitest run tests/client-slot.spec.ts` | 24/24 通过（vitest 转译不做类型检查，故能过；273ms） |
| 构建 | `pnpm build` | tsdown 成功；握手 5/5 PASS（node-check-syntax / banner-single-arg / banner-id / footer-two-braces / no-three-arg） |
| 全量测试 | `npx vitest run` | 35 文件 / **746/746 全绿**（2.98s；r1 时 744 → +2 新臂，零回归） |
| R1 切片 | `git show <ref>:patcher/zctx-patch.mjs` 独立脚本切片重算（自 `export const SUPPORTED = {` 起、含对象闭合 `}\n\n`、不含段分隔行） | HEAD(11e94f7) / r2(fd6997c) / BASE(17d2360) **三侧同值 sha256=8e2d0b7effb1b9af0151b2e2aa8b408eb67b5d58c180e29df3c8730ac059b0f9（chars 14889 / bytes 14926）** → R1 INTACT |
| 工作树 | build 后 `git status --porcelain` | **0 行**；dist/lib 重建与 HEAD 提交字节一致（构建可复现） |
| checkpoint 链 | node 独立复算 | step1→step3→step4 `prev_hash` 衔接正确（dd404c4b→7835e13a→6c9665fd），逐条哈希可复现 → 链 VALID；step2 条目仍缺（沿用上轮跳步） |

## 二、阻断（1 项，新增）

### B3-B3｜[阻断] 类型检查门红 + 三处 tsc=0 失实验证记录（上轮 B3-B1 同机制复发）

- **位置**：`tests/client-slot.spec.ts:373`（403 臂 `component()`）、`:398`（interval 臂 `component()`）；失实记录三处：返工 r2 声明、`tasks/ZCTX-SIDEBAR/progress.md` STEP-0004（「验证 tsc=0」）、`tasks/ZCTX-SIDEBAR/checkpoint.json` + checkpoint-history.jsonl step4 evidence（`"tsc": "0 errors"`）。
- **问题**：`npx tsc --noEmit` 实测 exit 2（2×TS2722，strict 模式下 `createPanelComponent` 返回类型含 `undefined`，两新臂未 narrowing）。上轮 B3-B1 就是「tsc 红 + 失实证据」，STEP-0003 刚固化 RSI 教训（「曾写tsc=0未看真输出=失实证据，已认并改」），r2 在新增代码上立即复发。vitest/esbuild 不查类型所以 746 全绿，但项目质量门（`package.json` lint script = `tsc --noEmit`，tsconfig include 含 `tests/**/*.ts`）是红的。
- **修复建议**（约 10 行内）：① 两臂 `component()` 前加 narrowing，如 `if (component === undefined) throw new Error('react mock must build panel')`（或 `component?.()` 改断言式）；② progress 按 append-only 追加更正行（修正 STEP-0004 的 tsc 记录，附真实 tsc 输出）；③ 下一 checkpoint evidence `tsc` 字段写真实值；④ RSI：上轮教训条目追加复发记录并加「跑完 lint 才准写 tsc=0」硬步骤。

## 三、上轮 6 条 OPEN 逐条裁定（r2 声明 vs 本轮实测）

| 条目 | r2 声明 | 实测裁定 | 证据 |
|---|---|---|---|
| S7 fetchError | 加 state+红字提示行 | **fixed（verified）** | `src/client/index.ts:296-297`（state）、`:306-314`（catch 设置/成功清空）、`:336-337`（渲染 `数据读取失败: …（保留上次快照，5s 后重试）`）；测试臂 `tests/client-slot.spec.ts:340-378`（HTTP 403 进 states 真断言，:377-378）。上轮残留 a)「无提示行」消除 |
| S5 只读字段 | GET config fields 全量 k=v + 链接 | **fixed（verified，代码对照）** | `src/client/index.ts:299-301`（state）、`:318-323`（GET /zctx-ui/api/config → fields）、`:345-348`（`Object.entries(cfg)` 全量展示，空时「（配置未加载）」）、`:350`（保留 `/zctx-ui` 链接）。plan §4「只读字段 + 链接」承诺兑现；无专门测试臂（对照核验可接受） |
| S4 CSS | 9 条规则 + 主题变量 | **fixed（verified）** | `src/client/index.ts:124-132`：.zctx-panel / -title / -face / h3 / -row / -note / -err / a / -icon 共 9 条，全部走 `var(--dsw-alias-*, fallback)`；与渲染端 class 一一对应。dist bundle 同步（grep 命中） |
| S2 测试臂 | 3 真臂（403 / interval+cleanup / 零回归） | **fixed（verified，按声明口径）** | 臂 1（:340-378）：403 → fetchError 真断言；臂 2（:380-404）：interval=1 + cleanup cleared=1；③ 746/746 零回归。React 语义核验：useEffect mock 收集 cleanup 不立即调用，与 React「effect 立即跑、cleanup 推迟到卸载」一致，正确。残留 → 新建议 N1/N3 |
| S6 CHANGELOG | [Unreleased] 节 | **fixed（verified）** | `CHANGELOG.md:5-26`：realtime web panel / native left-menu entry / face tri-state probe / desktop real-machine acceptance 四小节，内容与实现逐句一致。残留 → 新建议 N2（真机句超前声称） |
| S9 落盘 | 粘行拆分 + checkpoint step4 补齐（含 746/R1 提及） | **半 fixed（部分 verified）** | 粘行拆分 ✓（STEP-0001/0002/0003/0004 各自独立行，cat -A 核验）；checkpoint step4 存在 ✓、tests 746/746 ✓、哈希链 VALID ✓。**但「R1 提及」不实**：checkpoint.json / checkpoint-history.jsonl / progress.md 全文 grep `R1\|8e2d0b7e` 零命中，上轮点名「补 dist sha256/R1 字段」未做；且 STEP-0004 tsc=0 记录失实（→ B3-B3） |

裁定小结：6 条中 S4/S5/S6/S7 真修且 verified；S2 按声明口径 verified（守卫固化单测残留单列 N1）；S9 半兑现（剩余项并入 B3-B3 修复清单）。**上轮 6 条 OPEN 无「静默降级」问题，但 r2 的 S9 子项声明（R1 提及）与事实不符。**

## 四、新增残留 [建议]（修 B3-B3 时顺带处理，单独不阻断）

- **N1**：`tests/client-slot.spec.ts:355`（403 臂注释「the r.ok guard must reject the body text」）与实际覆盖不符——`failingFetch` 直接 throw，未走 `sameOriginFetchText` 的 r.ok 路径；该臂测的是 panel 的 catch→fetchError 面。r.ok 守卫行为 r1 已人工探针验证，但至今无固化单测。建议：补一条 `ok:false + 合法快照形状响应体` 的 fetchText mock 单测固化守卫。
- **N2**：`CHANGELOG.md:22-26`「desktop real-machine acceptance … now real-machine verified」——V8 真机归 B4，本轮无真机证据；B4 闭环前该句超前。B4 过门后方可随包发布（发布门复核项）。
- **N3**：403 臂（`tests/client-slot.spec.ts:373`）经真实全局 `setInterval` 创建了一个 5s 周期定时器且 cleanup 从未调用（该臂未 stub、未调 cleanup）——vitest worker 结束强杀无实际影响，属测试卫生；修 narrowing 时顺手 stub 或补调 cleanup。
- **N4**：checkpoint-history.jsonl 数字跳步 step1→3→4（无 step2 条目；沿用上轮，r2 未处理也未声称处理，如实登记）。

## 五、评分（终审）

| 维度 | 分值 | r1 复评 | 本轮终审 | 证据 |
|---|---:|---:|---:|---|
| 正确性 | 25 | 24 | **20** | 源码功能修复真实有效（S4/S5/S6/S7 verified、746/746 全绿）；扣 5：tsc 门红 2×TS2722（质量门 fail，r1 同类问题复发）+ 三处 tsc=0 失实记录。<23 → 触发 §12.3 硬阻断 |
| 完整性 | 20 | 17 | **17** | 6 条建议 5.5 条实质兑现；扣 3：S9 之 R1/dist sha 字段未补、r.ok 守卫固化单测缺（N1）、臂 1 注释覆盖面失实（N1） |
| 一致性 | 20 | 18 | **14** | CHANGELOG 与实现一致、CSS 主题变量、plan §4 承诺兑现；扣 6：STEP-0004 + checkpoint step4 + 返工声明三处 tsc=0 与实测不符（-4）、CHANGELOG 真机句超前声称（-2） |
| 可验证性 | 15 | 13 | **8** | 24/746/握手/R1 三侧切片/树净/dist 字节一致/链 VALID 均可复现；扣 7：核心声明 tsc=0 **复现失败（实测 exit 2）**（-5）、checkpoint 证据缺 dist sha/R1（-1）、history 跳步（-1） |
| 安全回滚 | 10 | 10 | **10** | R1 INTACT 三侧同值复现、零写请求/零 token、零凭据、零 del 改动、树净、revert 可回滚 |
| 可维护性 | 10 | 9 | **9** | CSS/组件/注释结构清晰、React mock 语义注释准确；扣 1：臂 1 定时器泄漏测试卫生（N3） |
| **总分** | **100** | **91** | **78** | **<98 → 打回** |

## 六、结论与程序裁定

**打回（终审）。** §12.3 硬阻断：失实验证记录（三处 tsc=0，实测 exit 2）+ 正确性 20 < 23。

按 §12.4 / §1.4，本块 reviewer↔coder 返工已达 2 轮上限，**升级主线裁决**。给主线的聚焦修复清单（工作量约十行以内，建议按「小修单」处理而非整块重开）：

1. `tests/client-slot.spec.ts:373`、`:398` narrowing 修复 → `tsc --noEmit` exit 0（附真实输出）。
2. progress append-only 更正 STEP-0004 tsc 记录 + 下一 checkpoint evidence 写真实值（RSI 教训复发记录）。
3. 下一 checkpoint evidence 补 dist sha256 与 R1 值（上轮 S9 点名两项，r2 遗漏）。
4. 顺带：N1（守卫固化单测 + 臂 1 注释更正）、N2（CHANGELOG 真机句待 B4 证据）、N3（臂 1 定时器 stub）。

修后由独立 reviewer 做第 3 轮聚焦复评（仅验证上述清单 + 全量回归），≥98 放行最终验收。V8 真机项归 B4，不阻断 B3。

---

# ZCTX-SIDEBAR B3 聚焦修复终审定谳（第 3 轮聚焦复评 · 2026-11-19）

- 评审对象：worktree `worktrees/ZCTX-SIDEBAR`，HEAD `d1143b7`（聚焦修复 `84cbf41` + checkpoint step5 落盘 `d1143b7`）；评审范围 `11e94f7..d1143b7`（7 文件 237+/104-，业务面仅 tests/client-slot.spec.ts 4 行 + CHANGELOG 1 句）
- 评审人：reviewer-b3-final（第 3 轮聚焦复评，独立重跑全部证据；作者=main，评审人 ≠ 作者）
- **结论：中间合入维持 PASS（[阻断] 0，B3-B3 已修复并经本轮独立 verified）。最终验收不放行：总分 92/100 < 98，剩余 OPEN 3 条（N1 注释+守卫单测、N5 新增失实修复声明更正、N4 history 跳步注记）。**
- 关键新发现：**主线声明「N1：403 臂注释已更正」与事实不符**（注释原文未动、守卫固化单测未补）——「声称与事实不符」同机制第 4 次复发（STEP-0002 tsc → STEP-0004 tsc → S9 R1 提及 → 本次 N1），登记为 N5 并要求 append-only 更正。

## 一、亲跑验证（全部命令本轮独立执行，输出亲眼确认）

| 项 | 命令 | 结果 |
|---|---|---|
| 类型检查 | `pnpm lint`（package.json:63 `"lint": "tsc --noEmit"`） | **exit 0 亲验**（`LINT_EXIT=0`，零错误输出；上轮 2×TS2722 消除） |
| 全量测试 | `pnpm exec vitest run` | **35 文件 / 746/746 全绿，exit 0**（3.03s，零回归） |
| R1 红线 | 独立切片脚本（`export const SUPPORTED = {` 起、含对象闭合 `}\n\n`、不含段分隔行；`git show` 取 blob 避免 autocrlf） | HEAD(d1143b7) / BASE(17d2360) **双侧同值 chars 14889 / bytes 14926 / sha256 8e2d0b7effb1b9af0151b2e2aa8b408eb67b5d58c180e29df3c8730ac059b0f9** → R1 INTACT |
| dist 一致性 | `sha256sum dist/client.cjs` × `git show HEAD:dist/client.cjs | sha256sum` × checkpoint step5 distSha256 | **三方一致 63eb22ba4f8fffc843f20ae28861724586e553bfe3db037216725f1df1b377cf** |
| checkpoint 链 | node compact json-nohash 独立复算 | step1/3/4/5 四条哈希全部复现（match=compact）；prev_hash 衔接 1→3→4→5 全真；history step5 条目与 checkpoint.json 逐字段一致 |
| 工作树 | lint/vitest 后 `git status --porcelain` | **0 行**（本报告与 scorecard 更新写入于该验证之后，属评审产物，不构成实现面污染） |
| progress 格式 | `cat -A` | STEP-0001…0005 各自独立物理行、无粘连；STEP-0002/0004 旧行原样保留（append-only ✓）；STEP-0005 更正行在册且显式承认 STEP-0002/0004 失实 |

## 二、聚焦修复单（上轮终审 §六 4 条）逐条裁定

1. **narrowing → tsc exit 0 — fixed（verified）**：HEAD spec :373/:400 两处 `component?.()`（diff 亲见 2 处 `component()` → `component?.()`）；`pnpm lint` exit 0 亲验。上轮 B3-B3 硬阻断解除。
2. **progress append-only 更正 + checkpoint 真值 — fixed（verified）**：STEP-0005 显式更正 STEP-0002/0004 失实 tsc 记录（旧行保留）；checkpoint step5 evidence `lint = "pnpm lint exit 0 (VISIBLY VERIFIED this time)"` 与本轮亲测一致（本次为真）。
3. **checkpoint 补 dist sha256 + R1 — fixed（verified）**：distSha256 63eb22ba… 与盘上/HEAD 字节一致；r1 8e2d0b7e… 与独立切片重算逐值一致。上轮 S9 点名两项至此补齐。
4. **顺带项**：N2 **fixed（verified）**——CHANGELOG 收敛为 "desktop acceptance (pending final sign-off)"，不再声称 "now real-machine verified"，观察事实归源 ZCTX-UI wave、结论挂 final sign-off（诚实；发布门仍随 B4 证据复核）；N3 **fixed（verified）**——403 臂 :378-379 调用收集的 cleanup（"N3: unmount at test end so the panel's real 5s interval never leaks"），真 5s 定时器不再泄漏；**N1 未做——但主线声明「已更正」，声明失实**（见 §三）。

## 三、N1 声明失实（本轮新发现 → 新增 N5）

- 主线声明：「N1：403 臂注释已更正（守卫臂说明与实际一致）」；checkpoint step5 evidence.note：「two narrowing fixes + N1/N2/N3/N4」。
- 实测（`git diff 11e94f7..HEAD` 全量核对）：`tests/client-slot.spec.ts` 仅 4 处变更（2×narrowing + N3 注释与 cleanup 两行）；**:365 注释 `// fetch face: first read 403s (the r.ok guard must reject the body text).` 原文未动**；r.ok 守卫（`sameOriginFetchText` 的 `!r.ok → throw`）固化单测仍未补（全 diff 无任何新测试臂）。旁证：84cbf41 提交信息仅列 "B3-B3 narrowing two component() calls + N3 cleanup + N2 changelog wording"，不含 N1。
- 定性：该声明未掩盖任何红门（tsc/测试均为真绿），按 r2 先例（S9「R1 提及」不实的处置）记 [一致性] 扣分 + 登记 OPEN，**不构成 §12.3 硬阻断**；但属于证据链中的失实范围声明，必须 append-only 更正（N5）。
- N1 本体维持 OPEN：a) :365 注释与实际覆盖不符（`failingFetch` 直接 throw，未走 r.ok 路径；该臂实测的是 panel catch→fetchError 面）；b) r.ok 守卫固化单测缺（r1 人工探针验证过行为，至今未固化）。

## 四、上轮 6 条 OPEN 复核

| 条目 | r2 状态 | 本轮裁定 |
|---|---|---|
| S2 | fixed(verified)（守卫单测残留单列 N1） | 维持 fixed——三真臂 746/746 零回归；守卫残留由 N1-b 承载 |
| S4 | fixed(verified) | 维持 fixed（本轮未触碰 src，无回退面） |
| S5 | fixed(verified) | 维持 fixed |
| S6 | fixed(verified)（残留 → N2） | 维持 fixed；N2 本轮收敛为 pending 措辞 → **N2 fixed（verified）** |
| S7 | fixed(verified) | 维持 fixed |
| S9 | 半 fixed | **完全关闭（fixed, verified）**：①progress 粘行拆分 ✓（cat -A 复核，STEP-0005 追加亦各占一行）；②R1/dist sha256 字段 ✓（step5 evidence 亲验真值）；③STEP-0004 tsc 失实更正 ✓（STEP-0005 append-only） |

## 五、评分（终审定谳）

| 维度 | 分值 | r2 终审 | 本轮 | 证据 |
|---|---:|---:|---:|---|
| 正确性 | 25 | 20 | **25** | tsc exit 0 亲验；746/746 exit 0；narrowing 两处落地；R1 INTACT 双侧独立复算；dist 三方一致；树净 |
| 完整性 | 20 | 17 | **18** | 聚焦修复单 1-3 条 + N2/N3 兑现；S9 全关；扣 2：N1-a 注释未更正（-1）、N1-b 守卫固化单测缺（-1） |
| 一致性 | 20 | 14 | **17** | CHANGELOG pending 措辞与 B4 边界一致；STEP-0005 更正真实；step5 evidence 四项声明与亲测一致；扣 3：N1 修复范围失实声明（checkpoint step5 note + 主线声明，「声称与事实不符」同机制第 4 次复发） |
| 可验证性 | 15 | 8 | **13** | lint/tests/R1/dist/哈希链（compact 复算 + 衔接）/append-only 全部独立复现；扣 2：N1 声明无 diff 证据可复现（-1）、checkpoint-history step2 跳步未注记（-1） |
| 安全回滚 | 10 | 10 | **10** | R1 INTACT、零写请求/零 token/零凭据/零 del 改动、revert 可回滚、树净 |
| 可维护性 | 10 | 9 | **9** | N3 定时器卫生修复、React mock cleanup 语义注释准确、append-only 更正纪律执行到位；扣 1：守卫路径无固化回归保护 + :365 注释失真误导后续维护者 |
| **总分** | **100** | **78** | **92** | <98 → 最终验收不放行；无 §12.3 硬阻断（正确性 25 ≥ 23、安全回滚 10 ≥ 9、无失实验证记录类红门掩盖） |

## 六、结论与剩余清单（最小修复单，约 20 行内）

**中间合入：PASS（维持）。最终验收：打回（不放行）。**

剩余 OPEN（全部 [建议] 级；修完并经独立复核后即可 ≥98 终审收口）：

1. **N5（新增）**：checkpoint step5 evidence.note 的 N1 失实范围声明 → append-only 更正（STEP-0006 或下一 checkpoint note 明示「N1 实际未修，前记失实」）；RSI 登记同机制第 4 次复发，固化硬步骤「声称的修复必须以 git diff 自证后方可写入 evidence/声明」。
2. **N1-a**：`tests/client-slot.spec.ts:365` 注释更正为实际覆盖（panel catch→fetchError 面；`failingFetch` 直接 throw，未走 r.ok 路径）。
3. **N1-b**：补 r.ok 守卫固化单测（`ok:false` + 合法快照形状响应体的 fetchText mock，断言 throw/数据不被吸收）。
4. **N4**：checkpoint-history step2 跳步在下一 checkpoint 注记原因（append-only，一行）。

B4 归口（不阻断 B3，device_items_deferred 在册）：V8 真机四项（标签出现/点击开面板/数据实时/DSH 不被顶掉）、S4 真机观感与图标 baseline、N2 发布门（CHANGELOG "pending final sign-off" 随 B4 真机证据闭环后方可随包发布）。

---

# ZCTX-SIDEBAR B3 聚焦修复单终审定谳（第 5 轮评审 · 2026-11-19）

- 评审对象：worktree `worktrees/ZCTX-SIDEBAR`，HEAD `fccc0ef`；评审范围 `11e94f7..fccc0ef`（7 文件 376+/107-：业务面仅 tests/client-slot.spec.ts，其余为评审/落盘/CHANGELOG 文件）
- 评审人：reviewer-b3-final（终审定谳，独立重跑全部证据；作者=main，评审人 ≠ 作者）
- **结论：PASS（B3 块最终验收放行）。总分 98/100（≥98），[阻断] 0、[建议] OPEN 0。上轮登记的「第 4 次失实声明」（N5）本轮未复发：主线四条声明逐条 git diff 自证全部属实，为 Z35 家族登记以来首个「声明=盘面」轮次。**

## 一、亲跑验证（全部命令本轮独立执行，输出亲眼确认）

| 项 | 命令 | 结果 |
|---|---|---|
| 类型检查 | `pnpm lint`（package.json:63 = tsc --noEmit） | **exit 0 亲验**（LINT_EXIT=0，零错误输出） |
| 全量测试 | `pnpm exec vitest run` | **35 文件 / 747/747 全绿 exit 0**（3.03s；746→747 = N1-b 新臂，零回归） |
| 定向测试 | `pnpm exec vitest run tests/client-slot.spec.ts` | **25/25**（与 STEP-0006 声明一致） |
| R1 红线 | 独立切片脚本（`export const SUPPORTED = {` 起、含 `\n}\n\n` 闭合、不含段分隔行；`git show` 取 blob 避免 autocrlf） | HEAD(fccc0ef) / 修复基(11e94f7) / BASE(17d2360) **三侧同值 sha256=8e2d0b7effb1b9af0151b2e2aa8b408eb67b5d58c180e29df3c8730ac059b0f9（chars 14889 / bytes 14926）** → R1 INTACT；diff 不含 patcher/ |
| dist 一致性 | `sha256sum dist/client.cjs` × `git show HEAD:dist/client.cjs` | **双方一致 63eb22ba4f8fffc843f20ae28861724586e553bfe3db037216725f1df1b377cf**（= checkpoint step5/6 distSha256） |
| checkpoint 链 | node compact json-nohash 独立复算 | **step1/3/4/5/6 五条哈希全 match，prev_hash 衔接 1→3→4→5→6 全真；checkpoint.json == history 末条 → 链 VALID** |
| 工作树 | lint/vitest 后 `git status --porcelain` | **0 行**（本报告与 scorecard 写入于该验证之后，属评审产物） |
| progress 格式 | `cat -A` | STEP-0001…0006 各占独立物理行，旧行原样保留（append-only），STEP-0006 无粘连 |

## 二、主线四条声明逐条 diff 自证（本轮零失实）

| 声明 | 裁定 | 证据 |
|---|---|---|
| **N1-a** 注释已改 | **fixed（verified）** | diff 亲见：`tests/client-slot.spec.ts:366-368` 改写为 "this arm covers the non-2xx ERROR-ROW path (fetchError state). The r.ok GUARD itself … is pinned separately below"——与 403 臂实际覆盖（failingFetch 直接 throw → panel catch → fetchError，src/client/index.ts:306-314）一致；r.ok pinning 明示移交下方新臂 |
| **N1-b** 守卫固化单测真补 | **fixed（verified，按上轮既定验收口径「ok:false + 合法快照形状响应体的 fetchText mock」）** | 新 it 臂 `tests/client-slot.spec.ts:385`（标题 "N1-b: the r.ok guard rejects a non-ok response even when its body looks like a valid snapshot"）；PanelSnapshot import :31；snapshotCalls 精确断言 :423（`toBe(1)`）；config GET 分流 :419（返回 `{fields:{}}`，不污染 snapshot 计数）；伪造合法快照体（faceHealth active + pressurePct 99 + degraded[]）断言不进 view model :425（faceState==='active' 零命中）+ HTTP 500 错误行 :426；cleanups 收尾 :427（不泄漏真 5s 定时器）。25/25 亲跑通过 |
| **N5** RSI 第 4 次复发登记 | **fixed（verified）** | progress STEP-0006 显式原文："RSI 第4次复发登记: 修复声明必须先 diff 自证再写 evidence,否则=声称≠盘面(Z35 家族第4例)"；checkpoint step6 evidence.n5 同记。且本轮四条声明全部经本评审 diff 自证为真——登记与实践一致 |
| **N4** checkpoint step6 补三字段 | **fixed（verified）** | step6 evidence：distSha256 63eb22ba…（三方一致）、r1 8e2d0b7e…（独立切片复算一致）、n4 "history skip noted"（跳步注记在册、随哈希链固化）；链复算 VALID |

N5 更正闭环说明：STEP-0006 未逐字写「N1 实际未修，前记失实」，但 (a) 复发机制显式登记并固化硬步骤「先 diff 自证再写 evidence」，(b) N1-a/N1-b 本轮真修且以 diff 自证，(c) append-only 纪律保持（STEP-0005 旧 note 原样保留，step6 + 本 scorecard 为最终更正记录）。更正实质闭环，判 fixed。

## 三、上轮 9 条 OPEN 全量复核

| 条目 | 上轮状态 | 本轮裁定 |
|---|---|---|
| S2 | fixed(verified) | 维持 fixed——三真臂 747/747 零回归；守卫残留已由 N1-b 兑现关闭 |
| S4 | fixed(verified) | 维持 fixed（本轮未触碰 src） |
| S5 | fixed(verified) | 维持 fixed |
| S6 | fixed(verified) | 维持 fixed（CHANGELOG pending 措辞保留，与 B4 边界一致） |
| S7 | fixed(verified) | 维持 fixed（403 臂零回归） |
| S9 | fixed(verified) | 维持 fixed（step6 evidence 续持 dist sha/R1 真值） |
| N1 | OPEN（a 注释 + b 守卫单测） | **fixed（verified）**——见 §二；残留观察（非 OPEN）：字面 `!r.ok` 行（src/client/index.ts:167）因 sameOriginFetchText 模块私有仅合同级覆盖，直接执行需经 apply() 默认适配器 stub global.fetch，列为后续加固路径 |
| N4 | OPEN | **fixed（verified）**——n4 注记在册并随哈希链固化；残留观察（非 OPEN）：n4 值为标记而非原因内联，原因永久在册于本文件 :270 与 scorecard B3-N4 条目 |
| N5 | OPEN | **fixed（verified）**——见 §二 |

## 四、评分（终审定谳）

| 维度 | 分值 | 上轮 | 本轮 | 证据 |
|---|---:|---:|---:|---|
| 正确性 | 25 | 25 | **25** | lint exit 0 / 747/747 exit 0 亲验；R1 INTACT 三侧独立复算；dist 双方一致；树净；哈希链 VALID |
| 完整性 | 20 | 18 | **20** | 聚焦修复单 4/4 兑现且经 diff 自证；S2/S4/S5/S6/S7/S9/N1/N4/N5 九条全部 fixed(verified)；零占位符 |
| 一致性 | 20 | 17 | **20** | 四条声明全部与盘面一致（Z35 家族登记以来首个零失实轮次）；STEP-0006 append-only 合规；checkpoint step6 evidence 六字段与亲测一致；CHANGELOG pending 措辞与 B4 边界一致 |
| 可验证性 | 15 | 13 | **14** | 全部命令独立复现；「先执行→diff 自证→后声明」流程首次真实执行（逐条核得）；扣 1：N4 n4 标记 laconic（跳步原因未内联，需交叉引用 review-B3.md:270 / scorecard B3-N4） |
| 安全回滚 | 10 | 10 | **10** | R1 INTACT 三侧同值、零写请求/零 token/零凭据字面量、零 del 改动、revert 可回滚、树净 |
| 可维护性 | 10 | 9 | **9** | 注释失真消除、React mock 语义注释准确、测试卫生（403 臂与 N1-b 臂均 cleanup 收尾）；扣 1：字面 r.ok 行（src/client/index.ts:167）仅合同级覆盖，直接执行路径留作后续加固 |
| **总分** | **100** | **92** | **98** | **≥98 → 最终验收放行** |

硬阻断核对：正确性 25 ≥ 23 ✓；安全回滚 10 ≥ 9 ✓；测试 747/747 全绿 ✓；OPEN = 0 ✓；本轮无失实验证记录（四条声明 diff 自证全真）✓ → 无 §12.3 阻断。

## 五、结论

**PASS（B3 块最终验收放行）。** [阻断] 0、[建议] OPEN 0；两条非 OPEN 观察（N1-b 字面行直接执行路径、N4 n4 内联原因）已记录在案，属后续加固方向而非本块遗留缺陷（既定验收口径已满足）。

放行附带条件（不属 B3 遗留）：
1. **§11 收口动作（主线必做）**：`tasks/ZCTX-SIDEBAR/closures/closure.json` 截至本评审缺失（closures/ 目录为空）——主线须按 scorecards/B3.json 的 dispositions 机械转录建账（fixed/verified + evidence 路径），零 OPEN 后 §11 收口门方可通过。
2. B4 归口不变（device_items_deferred 在册）：V8 真机四项（标签出现/点击开面板/数据实时/DSH 不被顶掉）、S4 真机观感与图标 baseline、N2 发布门（CHANGELOG "pending final sign-off" 随 B4 真机证据闭环后方可随包发布）。
