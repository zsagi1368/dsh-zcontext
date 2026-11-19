# ZCTX-SIDEBAR 方案研究（方案门）

> 用户 2026-11-19："设置里点打开面板打不开……能不能做成直接在左侧菜单栏显示 zcontext 标签，点击后在侧栏打开页面看、设置等操作？"
> 根因：webview 里 `<a target=_blank>` 不可靠。更本质解法=原生侧栏 tab。研究：`RES-SIDEBAR-TAB.md`（361 行 SHA 749a368e）+ `VERIFY-SIDEBAR.md`（7/7 确认）。

## 方向裁定（U-1，主线代用户决策）
用户 standing order="全程自主不参与"。语义裁定：用户说"**左侧菜单栏**显示标签、点击后在侧栏打开面板"→`sidebar.panellist`（左菜单标签）+`main.<key>`（主内容区 panel），即方案 A1。A2（右侧栏 tabs.register）用户未提"右"，不采纳。基于字面，报告标注为依据。

## 事实基础（verifier 7/7）
- `sidebar.right.pane.tab`=keyed body 槽（只有 key），不产生可点击标签；`sidebar.panellist`(slot-catalog.ts:3206-3256, id/order/label)+`main`(1816-1853, key=panel id, reserved conversation)=左标签→主区面板机制；plugin-manager/ui-schedule 有逐行先例。
- 侧栏 panel 同源 `fetch('/zctx-ui/api/snapshot')` 读走 same-origin/loopback 授权无需 token（auth.ts:92-99 已确认在跑）；**写操作洞 U-2**：authorizeWrite 要 token 或(同源且 loopback)，token 仅注入 inline HTML，slot panel 无获取路径。

## 选项 A1（推荐）：sidebar.panellist + main.<key> 原生左菜单 panel
- 做法：client bundle 注册 panellist entry（id=zctx-panel, label=zcontext, order）+ main panel（key 同 id）渲染 React 组件；组件同源 fetch snapshot 做查看/统计（5s 轮询复用）；设置写操作降级——面板内提供设置只读展示+"打开完整面板改"入口（跳 `/zctx-ui` 由用户在真浏览器改，避开 U-2）。
- 优点：最贴用户字面、shipped 先例可抄、inject 最小、只读数据已跑通、不依赖 webview target=_blank。
- 缺点/风险：panel 落主内容区非右侧栏（方向已裁定）；写操作在面板内不可直接改（降级）；无现成实现需新建；真机需验 tab 出现+点击渲染（Z34/Z35 教训）。

## 选项 A2：右侧栏 tabs.register（sidebarRightTabs 服务）
- 优点：真·右侧栏。
- 缺点：依赖 sidebarRightTabs/sidebarRight 服务第三方可达性未验证（U-3）；用户未要求"右"；风险高。
- 淘汰理由：方向不符字面+前置未验证。

## 选项 B：conversation.view 内嵌（bili Context tab 形态）
- 优点：先例成熟。
- 缺点：嵌在会话区不是菜单栏，与用户"左侧菜单栏标签"不符。
- 淘汰理由：不符诉求。

## 选项 C：保留链接改善
- 淘汰：webview target=_blank 已被真机证明打不开，正是本次要解决的。

## 推荐
A1。查看/统计在面板内原生显示；设置写降级为跳转完整页（诚实边界）。U-2 写 token 通道留 v0.4。卡面必落 Z1（单参 factory）/Z21+Z25（inject ['slots'] 最小+能力探测降级）/Z34+Z35（真机 tab 出现+点击渲染+curl+握手真语法校验）。
