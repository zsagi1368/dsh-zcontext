# ZCTX-UI 方案研究（方案门）

> 用户 2026-11-19 原话："RSI 把发现的问题都修一下。另外还是搞个 UI 吧，包括设置、查看、统计等等你能想到的都想一下，我觉得这样更直观一点，不然每次开个会话还浪费 token。也没有及时性。"
> 研究依据：`G:\000Github\zDSH\zDSH-docs\R&D\zctx-20261112\RES-UI-FEASIBILITY.md`（220 行，SHA 30e23738…，verifier 7/7 确认）+ `VERIFY-UI.md`。

## 事实基础（全部 verifier 独立复核）
- dsh.client=null（无 UI 半）；插件无 webServer.register 面；AutoPilot/filehub 先例真实（manifest dsh.client inject 4 键、bundle slots.register/inject 多 key）。
- slot key `settings.section`@2787 / `conversation.view`@1637 / `conversation.session.header.actions`@1393 存在；约束=inject 门+禁 priority+禁 import react（CLIENT_NOTES@68-72）。
- U1「namespace 不挂载」已修（config.ts:400-401 条件式 `defaulted.volatile()`，git c3fd691）——报告的"已修"正确；**剩余「页内编辑」是宿主 layoutOf 硬编码阻断，插件不可修**。
- 账本在进程内存，`renderStatus(runtime, session)` 强依赖 session；已有薄封装 `liveSessions`@283 / `observabilitySnapshot`@881 / `currentSession`@1177——快照 API 是薄封装非从零。
- 桌面 composition：webServer 仅 web/desktop profile；BENCH-L2 桌面 face 未真机验证（user_approved_deferred）→ 落桌面前须补激活探针。
- 4 项未解决（研究自标）：primitive 字段可见性、session 绑定、非 loopback 只读、端到端浏览器真机——全部转验收项，不得默认为已解决。

## 选项 A：纯 slot 面板（settings.section + conversation.view 内嵌 React）
- 做法：新增 dsh.client（platform:web，inject 确定存在的最小服务集）、client bundle（React.createElement+styles.insert 不 import react），注册面板到 settings.section 显示配置/统计到 conversation.view 显示状态；数据从 session 日志只读扫描（绕开进程内存桥）。
- 优点：原生 UI、零端口、原生设置入口。
- 缺点：①数据只能读 session 日志（滞后/不完整、非实时——违背用户"及时性"）；②U1 页内编辑阻断，设置只能 visibility-only + 引导去 cordis.patch.yml；③inject 门悬挂历史（Z21）高发——注入服务名错=静默 PENDING；④client bundle 契约（Z1 工厂契约）易错。
- 淘汰理由：不满足"实时"核心诉求；数据路径最弱。

## 选项 B：纯 webServer HTTP 页面（AutoPilot 式 bridge + 独立 UI 页）
- 做法：插件在宿主 webServer.register 挂 `/zctx-ui` 只读 handler（读进程内存账本快照 API）+ 静态 HTML/JS 页面（同源 fetch）；设置面板通过页面内表单写 overlay。
- 优点：①实时（handler 直读内存账本）；②不耗 session token（浏览器独立，不进对话）；③AutoPilot 有完整先例可抄；④绕开 U1（自己的页面自己的表单）。
- 缺点：①webServer 仅 web/desktop profile，CLI headless 无（本任务目标就是桌面端，可接受）；②非 loopback 只读未覆盖（研究 A2-4，作为验收项）；③桌面端 face 激活未验证（BENCH-L2，作为前置探针）；④需要 bridge token 授权（参照 AutoPilot authorizeAction，防本地越权）。
- 保留理由：直击用户三诉求（实时/不烧 token/直观），风险都有成熟先例与验收项覆盖。

## 选项 C（推荐）：两阶段组合——先实时数据桥，后原生 slot 面板
- 阶段一（本波核心）：webServer 只读账本桥 + 独立 UI 页（设置/查看/统计全部在页面内完成）——交付用户全部诉求。
- 阶段二（同波尾或 v0.4）：settings.section slot 做原生可见性入口（点击跳转到 UI 页面或展示摘要），inject 门做能力探测降级（Z21/Z25 教训）。
- 优点：实时性由阶段一保证（不被 slot 数据路径拖累）；阶段二失败=降级为纯阶段一，不伤害核心交付；设置可见性在阶段一用自带页面解决（绕开 U1）。
- 缺点/风险：工作量最大；两阶段都要过评审门；slot 阶段需真实验证 inject 门（未解决项转验收）。
- 为什么优于 A/B：A 数据路径不满足时效；B 缺原生设置入口（用户在设置页看不到插件状态）；C 全都要且可降级。

## 反方证据（verifier 已核锚点真实，均判定为边界声明不削弱 C）
1. `dsh.client.inject` 仅 informational 非服务注入——阶段二 inject 门必须能力探测降级。
2. Workbench 曾直挂 DOM 绕过 slot 表达力上限——阶段二若 slot 表达力不够，允许降级为链接而非内嵌。
3. UI 只解决"查看"不消灭所有 fold token（autofold 仍消耗）——如实写入 README，不夸大。

## 待修问题（用户"把发现的问题都修"）与本波关系
- P0 必修：无 dsh.client 字段、账本快照 API 缺位、设置可见性（用自带页面解决）。
- P1 应修：BENCH-L2 桌面 face 激活探针（前置）、fail-soft 降级无可见 sink（Z28，UI 显示 face 健康度）。
- P2/P3：primitive 可见性实测/session 绑定（验收项）、nudge 措辞（v0.4 不动）。

## 推荐
选 C。所有未解决项转验收矩阵，禁止默认为已解决；BENCH-L2 探针为 UI 落桌面前置门；R1 红线（零请求体改写）与 fail-closed 不弱化。
