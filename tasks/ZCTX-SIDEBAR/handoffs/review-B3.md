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