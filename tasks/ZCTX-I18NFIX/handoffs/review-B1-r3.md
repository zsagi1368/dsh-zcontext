# review-B1-r3 — ZCTX-I18NFIX 两条 nano 清零快核（只读）

- 评审人: reviewer-B1（独立 subagent，≠作者）
- 对象: HEAD=bf7dbde（r3），增量对照 a6f8900（r2）
- 评审日: 2026-11-21
- 性质: 只读快核（机械改动逐条对位 + 门独立复现）

## 逐条对位（全部对上）

1. **[建议-R2-1] cardLang 注释子句** — client/index.ts:205-210 尾子句已改为 "fetches once at creation; a DSH language change reloads the webview, which rebuilds the card and thus picks up the new locale"，与 r2 建议修法一致且机制如实。旧 "next poll" 子句在 src 与 dist 双清零（残余的 1 处 "next poll" 在 client/index.ts:629 save 错误处理注释，指面板真实存在的 5s 轮询，无关卡片）。
2. **[建议-R2-2] UI_DICT.uiLanguage 死条目** — i18n.ts:68-72 行已删，留指路注释（"field label lives in FIELD_LABELS.uiLanguage — config-key labels are its domain"）；FIELD_LABELS.uiLanguage 完好（i18n.ts:121）；grep `t('uiLanguage')` 全仓 0 命中；dist/client.cjs "界面语言" 恰 1 处（FIELD_LABELS 唯一源）。
3. **[流程-1] desktop-locale.ts** — LOCALE_SHAPE doc 注释与声明重聚（:20-22）；模块头注释改写为如实描述 IO 半 readDesktopLocaleFile 在本模块、plugin 只收窄 env，Mimosa Z40 备注保留。

## 门复现（评审人独立执行）

- `npx tsc --noEmit` → exit 0
- `npx vitest run` → 38 文件 788/788
- dist/client.cjs 同步：注释文本已更新、死行已移除；`git diff 72d6ea1...HEAD --name-only | grep -c patcher` = 0（R1 完好）
- closure.json 11 条全 fixed/verified；抽查 R3-R2-1/R3-R2-2/R3-流程1 证据与 HEAD 实况一致；step-2 checkpoint+progress 已在 86c21ec 落盘

## 附注（不计分）

新注释 "a DSH language change reloads the webview" 为对宿主应用行为的陈述，本仓无直接单测可证——采信主线真机侧陈述（与 Electron locale 切换需重载 renderer 的通行机制一致，且无反证）；真机部署相位自然覆盖验证。

## 评分更新

r2 的两处 -1 清零：一致性 19→20，可维护性 9→10。
总分 = 正确性 25 + 完整性 20 + 一致性 20 + 可验证性 15 + 安全回滚 10 + 可维护性 10 = **100**。
无 OPEN 项；验收项 1（真机 locale=zh-CN 捕获）按约定属部署相位动作，随合并部署补证。

**VERDICT: RELEASE-OK**（≥98，零 OPEN；放行合并→部署→真机补证→closure-check -Phase all）

## HANDOFF

```
FROM: reviewer-B1  TO: main
MODE: normal
TASK_REF: ZCTX-I18NFIX review-B1-r3
PAYLOAD: VERDICT RELEASE-OK / 总分 100 / OPEN 0 / 三条对位确认 + 门独立复现（tsc0/788/bundle 同步/patcher 0）
ARTIFACTS: tasks/ZCTX-I18NFIX/handoffs/review-B1-r3.md
SCORE: 六维全满（评审人 reviewer-B1，≠作者）
CHECKPOINT: step-2（86c21ec 已落盘；部署+真机补证后按 §15 收口）
```
