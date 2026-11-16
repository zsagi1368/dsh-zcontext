# P5 任务卡：GitHub 社区标准与发现性补齐

> 用户令（2026-11-15）：全部弄好。
> 现状缺口（主线已盘点）：ISSUE_TEMPLATE×2 / PR 模板 / CONTRIBUTING / CODE_OF_CONDUCT / .github/workflows CI / README 双语互链+徽章 / package.json keywords+repository+homepage / GitHub topics / patcher README 中文一致性。

## 产物清单

1. `.github/ISSUE_TEMPLATE/bug_report.yml` + `feature_request.yml`（GitHub 官方 YAML 表单格式：name/description/labels/body；bug 表单字段：版本、DSH 版本、安装方式、复现步骤、期望/实际、`zctx_status` 输出片段、日志、环境；feature 表单：问题、建议方案、备选）
2. `.github/ISSUE_TEMPLATE/config.yml`（blank issues 允许 + 引导到 Discussions/文档）
3. `.github/PULL_REQUEST_TEMPLATE.md`（净室声明 checkbox、`npm test` 绿、lib 产物同批提交、CHANGELOG 更新、无 `isConcurrencySafe`、无 body 改写红线）
4. `CONTRIBUTING.md`（英文；净室纪律、Z 系坑册关键规则（先 tsc 后 vitest/build 先于 test/长内容用编辑器）、提交信息规范 `type(ZCTX): ...`、PR 流程、测试/探针命令、红线 R1-R8 摘要）
5. `CODE_OF_CONDUCT.md`（Contributor Covenant v2.1 标准文本；联系邮箱用仓库 owner 的 GitHub noreply 或占位需标注）
6. `.github/workflows/ci.yml`：`windows-latest`，Node 22.x，`pnpm install --frozen-lockfile` → `pnpm test`（含 build 链）→ `pnpm lint` → 五探针（`probe-artifact`/`verify-activation-surface` 必跑；依赖 zDSH-main 的三支探针在 CI 中 SKIPPED——用 env 缺失自然 SKIP，如实不造假）→ 上传探针输出 artifact
7. README 双语互链 + 徽章：两份 README 顶部加语言切换（`[English](README.md) | [中文](README.zh.md)`）与徽章（CI status 指向新 workflow、license MIT、version 0.2.1（静态 badge，不引外链依赖））
8. `package.json`：补 `keywords`（deepseek-harness, dsh-plugin, context-management, compaction, prompt-cache, token-budget）、`repository`、`homepage`、`bugs`
9. `patcher/README.md`：加英文首段摘要（`## Summary (English)` ≤8 行）+ 保留中文正文；或全文双语标题——选**加英文摘要段**（最小改动、信息可达）
10. GitHub 仓库：`topics` 设置（deepseek-harness, dsh-plugin, context-management, llm, prompt-cache, mozilla?no）+ `homepage` 若适用（无官网则留空）

## 验收

- 所有 YAML 可被解析（`node -e "YAML.parse"` 若有依赖，否则用 python yaml 或结构断言）
- CI workflow 用 `actionlint` 类检查不可得时→人工对照 GitHub 官方 schema 字段（runs-on/steps/uses 版本合法）
- `package.json` JSON 合法+字段齐全断言
- README 双语互链双向可达（grep 两向）
- 提交 `docs(ZCTX): P5 community standards`；推送；`gh api` 复核 topics 生效
- **不在本卡**：真跑 CI（需 push 后 GitHub 端执行）——push 后查 run 状态并如实报告

## 约束

开工首动作=查册；长内容 Write/Edit；§5 备份（触改 package.json/README 前备 del/）；不伪造 CI 通过（未跑则如实说 pending）。