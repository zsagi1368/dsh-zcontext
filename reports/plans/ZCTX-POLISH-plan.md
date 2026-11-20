# ZCTX-POLISH 计划（三波：SQLite 持久层 / i18n / 美化+复制地址）

> 方案依据 `docs/specs/ZCTX-POLISH/options.md`（波次化组合）。用户令"慢慢一步一步来，掰开揉碎细致一点"→每波独立验收落盘。

## 1. 目标/非目标
- 目标：①折叠与用量数据本地 SQLite 持久化（跨会话累计统计）；②UI 全量 i18n（zh 默认/en，语言解析=设置覆盖>宿主探测>zh）；③完整页+侧栏面板视觉重构；④侧栏面板"复制完整面板地址"兜底（替代打不开的链接）。
- 非目标：bili 的 CAS/refs 账本全套（只取折叠事件与用量两类）；宿主 locale 面改造；R1 红线；CLI 形态 UI。

## 2. 事实基础
见 options.md（node:sqlite 官方先例/bili 形态/locale 未解决）。库路径解析顺序：宿主提供的会话目录能力 > `~/.dsh/zctx/ledger.db`。

## 3. 方案
波次化组合（三波）。每波完成后 tsc+build 握手+测试全绿+提交落盘。

## 4. 接口契约
- **存储**：`src/storage/db.ts` `openLedgerDb(path)` → `{ recordFold(e), recordUsageTurn(t), stats() }`；WAL；schema_version 表；fail-soft（DB 故障不影响折叠主链）。
- **i18n**：`src/ui/i18n.ts` `t(key, lang?)`；字典 zh/en；`resolveLang(pref)`。
- **统计查询**：`stats()` 返回 { totalFolds, totalTokensSaved, sessionsCount, lastFoldAt }。
- **复制地址**：panel 组件 `navigator.clipboard.writeText(location.origin + '/zctx-ui')` + execCommand 回退 + 提示。

## 5. DAG
| 波 | 内容 | 验收 |
|---|---|---|
| W1 | storage/db.ts + fold/usage 写入接线 + stats API + 测试 | DB 文件产生、重启可读、fail-soft |
| W2 | i18n.ts + 全 UI 文案字典化 + 语言设置项 | zh 默认、en 可切 |
| W3 | 页面美化 + panel 复制地址按钮 | 视觉重构+复制成功 |
| B3 | reviewer+verifier（≥98） | 全矩阵 |
| B4 | 合并推云+真机验收（统计跨重启保留+语言+复制） | 截图/读数 |

## 6. 验收矩阵
V1 DB 文件在盘且 WAL 开启；V2 折叠事件落库可查询；V3 重启后统计累计（真机）；V4 fail-soft（DB 坏不影响折叠）；V5 UI 默认中文；V6 en 切换完整；V7 视觉重构后三块齐；V8 复制地址按钮成功；V9 R1 段不变+747+ 零回归+lint 0；V10 真机截图。

## 7. 风险/回滚
DB 锁/损坏→fail-soft+重建；node:sqlite 实验性 API 变动→封装层隔离；回滚=revert 提交（DB 文件独立于代码可删）。

## 8. 预算/升级
≤3.5h；升级条件=node:sqlite 在宿主组合不可用→改 JSON-lines 落盘方案（备胎已想好）。
