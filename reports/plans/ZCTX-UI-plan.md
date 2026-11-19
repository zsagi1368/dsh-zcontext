# ZCTX-UI 计划

> 目标：给用户一个直观、实时、不耗 session token 的 UI（设置/查看/统计），并当波修复研究发现的 P0-P2 问题。方案依据 `docs/specs/ZCTX-UI/options.md` 选项 C；研究 `G:\000Github\zDSH\zDSH-docs\R&D\zctx-20261112\RES-UI-FEASIBILITY.md`（verifier 7/7 确认）。

## 1. 目标/非目标
- 目标：①（P0）账本快照 API（薄封装现存 liveSessions/observabilitySnapshot/currentSession）；②（P0）webServer.register 只读 UI 路由+同源页面（设置/查看/统计三块，bridge token 授权）；③（P1）桌面 face 激活探针（BENCH-L2 前置）+ fail-soft 降级可见 sink；④（阶段二）settings.section slot 摘要入口（inject 门能力探测降级）；⑤全量测试绿、真机桌面验收。
- 非目标：U1 页内编辑（宿主 layoutOf 硬阻断，插件不可修——用自带页面绕开）；nudge 措辞/模型采用面（BENCH-L7，v0.4）；CLI headless UI（无 webServer）；R1 红线不动（零请求体改写）。

## 2. 事实基础与方式声明
见 options.md。工作树 feat/ZCTX-UI；主树只由主线合并。研究 4 项未解决全部转验收项。

## 3. 方案
选项 C（两阶段组合）胜出；A 数据路径不实时、B 缺原生入口。

## 4. 接口/数据契约
- `snapshotApi`：按 sessionId 返回账本快照（window/budget/ranges/folds/attribution/cache measured|estimated/face health），只读，薄封装现有访问器。
- `GET /zctx-ui`（页面）+ `GET /zctx-ui/api/snapshot?session=<id>`（JSON，bridge token 或 loopback 授权）+ `GET /zctx-ui/api/config` / `POST /zctx-ui/api/config`（写 overlay，参照 AutoPilot authorizeAction）。
- UI 三块：查看=status 实时（轮询 5s）、统计=累计折叠/回本/缓存、设置=九字段+face 开关（可见性+自带表单写 overlay）。
- slot 阶段二：`settings.section` 注册摘要卡（展示折叠次数/窗口占比摘要 + 跳转 UI 页的链接）+ inject 能力探测（失败=静默降级不 PENDING）。

## 5. 任务卡 DAG
| 块 | 内容 | 依赖 |
|---|---|---|
| B1 | 研究+方案门+plan+task（本波） | 无 |
| B2 | architect 详细设计（文件级改动面+契约+探针方案） | B1 |
| B3 | coder：P0 快照 API+webServer UI 路由+页面（设置/查看/统计）+bridge 授权+测试 | B2 |
| B4 | coder：P1 桌面 face 激活探针+fail-soft 可见 sink+阶段二 slot 摘要（降级门）+测试 | B3 |
| B5 | reviewer 对抗评审（≥98，核 R1/inject 门/授权/坑册）→verifier 全量验证 | B4 |
| B6 | 合并主树+tag+台账→真机桌面验收（浏览器打开 UI 页逐块核对）→收口 | B5 |

## 6. 验收矩阵（可执行）
| # | 验收 | 命令/证据 |
|---|---|---|
| V1 | 快照 API 返回实时账本（进程内存，非日志扫描） | 单测注入账本+断言字段；真机 UI 页读数 |
| V2 | UI 页含设置/查看/统计三块，浏览器可用 | 真机浏览器截图/快照证据 |
| V3 | UI 数据不进 session（不烧 token） | 代码审：UI 走 HTTP 不调 llm.stream |
| V4 | bridge token/loopback 授权，非授权拒绝 | 单测越权臂 |
| V5 | 桌面 face 探针在 desktop composition 可判活/死 | 探针单测+真机 face 状态读数 |
| V6 | fail-soft 降级有可见 sink（Z28），UI 显示 face 健康 | 单测：降级触发→UI face 字段变红 |
| V7 | settings.section slot 摘要卡注册且 inject 门失败不 PENDING | 单测：服务缺席→降级 no-op |
| V8 | 研究 4 未解决转验收（primitive 可见性/session 绑定/非 loopback 只读/端到端真机） | 逐项实测记录 |
| V9 | R1 红线不变（SUPPORTED 段 8e2d0b7e…） | 段哈希复算 |
| V10 | 全量测试绿+tsc 0+工作树干净 | pnpm test / tsc --noEmit |

## 7. 风险与回滚
- 风险：①webServer 仅 web/desktop——桌面验收前用探针确认注入成功；②bridge 越权——token+loopback 双授权；③slot inject 悬挂（Z21）——能力探测降级；④client bundle 契约（Z1）——真机可加载性验证；⑤UI 夸大"解决所有 token"——README 如实写 autofold 仍消耗。
- 回滚：新面全为 additive（新文件+新路由+manifest 字段），revert 提交即卸载 UI；不改既有折叠逻辑与 R1 段。

## 8. 预算/升级
coder 1+architect 1+reviewer 1+verifier 1；≤4h；返工≤2 轮；升级条件=桌面 face 探针证伪（BENCH-L2 真死）→停手报主线裁决是否继续 UI。
