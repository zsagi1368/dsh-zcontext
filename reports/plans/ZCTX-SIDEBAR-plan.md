# ZCTX-SIDEBAR 计划

> 方案依据 `docs/specs/ZCTX-SIDEBAR/options.md` A1；研究 RES-SIDEBAR-TAB.md（361 行）+VERIFY-SIDEBAR.md（7/7）。

## 1. 目标/非目标
- 目标：①client bundle 注册 `sidebar.panellist` entry（左菜单"zcontext"标签）+ `main.<panelId>` panel；②panel 内原生显示查看/统计（同源 fetch snapshot 5s 轮询）+ 设置只读展示 + 跳完整页入口；③保留原 settings.section 摘要卡（现在带 target=_blank，作为兜底）；④全量测试+真机验收（标签出现、点击渲染、数据刷新、不顶掉 DSH）。
- 非目标：面板内直接写设置（U-2 token 洞，降级跳完整页）；A2 右侧栏；改 webServer 鉴权；R1 红线。

## 2. 事实与方式
见 options.md。工作树 feat/ZCTX-SIDEBAR；主线合并。方向 U-1 按用户"左侧菜单栏"字面裁定 A1 并如实标注。

## 3. 方案
A1 胜出；A2 前置未验证且方向不符；B 不符诉求；C 正是要解决的问题。

## 4. 接口契约
- panellist entry：`{ id: 'dsh-zcontext.panel', order: <值>, label: () => 'zcontext' }`（照 ui-plugin-manager 先例）。
- main panel：`slots.register({ name: 'main', key: 'dsh-zcontext.panel' }, PanelComponent)`，component 用 React.createElement（loader require('react')），同源 fetch `/zctx-ui/api/snapshot`，5s 轮询。
- 面板三区：查看（window/folds/cache/ranges）、统计（累计）、设置（只读字段 + "在完整面板中修改"链接到 /zctx-ui）。
- inject 仍 `['slots']` 最小集；服务缺席→惰性 no-op 不 PENDING。

## 5. DAG
| 块 | 内容 | 依赖 |
|---|---|---|
| B1 | 研究+verifier+options/plan/task | 无 |
| B2 | coder：client bundle 加 panellist+main panel+同源数据+设置降级+测试 | B1 |
| B3 | reviewer（≥98，核 Z1/Z21/Z25/Z34/Z35/R1/inject）+ verifier 全量 | B2 |
| B4 | 合并推云+pin 轮转+重装+真机验收（标签/点击/数据/不顶 DSH） | B3 |
| B5 | 收口：RSI/记忆/台账 | B4 |

## 6. 验收矩阵
| # | 验收 | 证据 |
|---|---|---|
| V1 | panellist 注册 zcontext 标签（id/order/label） | 单测断言+真机菜单可见 |
| V2 | main.<key> panel 注册且点击渲染 | 单测+真机点击 |
| V3 | panel 同源 fetch snapshot 5s 刷新（查看/统计） | 单测 mock fetch+真机数据 |
| V4 | 设置区只读+跳完整页入口（U-2 降级诚实） | 单测+真机 |
| V5 | inject ['slots'] 最小+缺席降级不 PENDING | 单测 |
| V6 | R1 段 8e2d0b7e… 不变；握手真语法校验（Z35） | pnpm build 5/5 + node --check |
| V7 | 全量测试绿+tsc 0+工作树净 | pnpm test |
| V8 | 真机：点标签开面板、DSH 不被顶掉、数据实时 | app 重启后 UI/浏览器实测 |

## 7. 风险/回滚
- 真机 slot 表达力/inject 门失败→能力探测降级（不 PENDING）；方向不符→用户可反馈切 A2（报告在案）；写受限→跳完整页。回滚=revert 提交，既有 UI/补丁不动。
- 凭据：无新 token，沿用同源读授权。

## 8. 预算/升级
coder 1+reviewer 1+verifier 1；≤2.5h；返工≤2 轮。升级条件=真机 tab 不出现且非 inject 问题→停手报主线（可能需右侧栏方案）。
