# ZCTX-POLISH 方案研究（方案门）

> 用户 2026-11-20："像 billion-context 那样做完善一点，数据保存本地 sqlite，页面好看点，语言跟随 DSH，默认中文，其他语言只显示英语。【需要的话仍可去完整页面（浏览器）看更详细的统计】这个点击打不开……显示个地址供复制吧。慢慢一步一步来，掰开揉碎细致一点。"

## 事实基础（全部一手实证，2026-11-20）
- **Node 24 内置 `node:sqlite`**：`require('node:sqlite')` → DatabaseSync/StatementSync/backup 可用（本机实测）——**零原生编译依赖**，git-form 安装直接可用。
- **官方先例**：`packages/session-query/session-query-sqlite` 全仓用 `node:sqlite` DatabaseSync（tests/sqlite.spec.ts:5 等）——官方在插件/包级就用它。
- **bili 形态**（RES-billion-context.md §5.3）：WAL 单库+单写路径+行级 inactive 标记（折叠=标 inactive 绝不物理删除）；"双真源痛点是已知债——DSH 版建议单真源"（研究档 :400 建议）。
- **locale 面未解决**：真机 profile 无 `@deepseek-ai/dsh-client-locale` 目录可查（探测未解决项），宿主语言读取无一手 API——i18n 用"内建双语字典+默认中文+设置手动覆盖"策略绕开。
- **用户报"打开完整面板点击打不开"**：webview 拦 target=_blank（已知）；复制地址是可靠兜底。

## 选项对比

### 波次化组合方案（推荐，即用户"一步一步"的意图）
- **波1 SQLite 持久层**：`src/storage/`（node:sqlite DatabaseSync；WAL；库文件 `<home>/zctx/ledger.db`，home 从现有 configEditor/宿主能力解析，缺席→profile 目录）；schema v1：`fold_events`（session_id/from_seq/to_seq/tokens_before/tokens_after/supply/created_at）+ `usage_turns`（session_id/turn/billed_input/cache_read/cache_write/created_at）+ `meta(key,value)`；**单真源**（研究档 :400 建议吸收）；写入点=既有 fold commit 路径与 observe listener（additive，不改折叠语义）；查询 API 供统计页累计视图。
- **波2 i18n**：`src/ui/i18n.ts` zh/en 全量字典；默认 zh；语言解析顺序=设置项 `uiLanguage`(auto|zh|en) > 宿主 locale 能力探测（缺席→zh）；所有 UI 文案走字典。
- **波3 美化+复制地址**：完整页与侧栏面板统一视觉（主题变量+布局分区）；侧栏面板加"复制完整面板地址"按钮（navigator.clipboard + 回退 execCommand；成功提示）。

### 备选：better-sqlite3 依赖（淘汰）
- 淘汰理由：原生编译依赖破坏 git-form 零构建安装（README 明确卖点）；node:sqlite 是官方同款且零依赖。

### 备选：一次性大改（淘汰）
- 淘汰理由：用户明示"慢慢一步一步来"；波次化每步可验收可回滚。

## 推荐
波次化组合。每波独立验收；SQLite 用 node:sqlite（官方同款零依赖）；单真源；i18n 不赌宿主 locale 面（未解决如实标注）。
