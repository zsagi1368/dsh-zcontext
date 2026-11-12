# AGENTS.md — dsh-zcontext 仓库纪律

> 本文件约束所有在本仓工作的 agent。全局规则见 `~/.zcode/AGENTS.md`，本文件只做仓库级细化。

## 仓库性质

- 本仓是官方 deepseek harness 的**第三方插件**（净室实现）：所有代码与文本自写，禁止复制上游源码、官方指导段原文（如 billion-context compression-rules）或其他插件的实现文本。
- 宿主接口一律**结构类型 duck-typing**：不静态 `import` 任何 `@deepseek-ai/*` 运行时包；schemastery 走 lazy require + fail-soft（不可解析→内置最小校验器兜底），宿主能力缺失时降级不得炸模块加载。
- Config schema 字段与默认值以 `reports/plans/ZCTX-plan.md` §3 为冻结契约，增删字段必须先改 plan 再动代码。

## 产物入库（Z3 防复发）

- `lib/` 构建产物**必须提交进仓**：git 形态安装不触发构建，pin 指向的树里必须有产物。
- **禁止** `prepare` / `preinstall` / `postinstall` / `install` 等 install 期生命周期脚本（pnpm allowBuilds 免审批）。`scripts.build` 仅供手工调用，不会在安装期触发。
- 安装类任务收尾必须核验 `lib/` 在盘（`git ls-tree -r HEAD lib` 或 `ls lib`）。

## 命令顺序

```
pnpm install -> pnpm build -> pnpm lint -> pnpm test
```

- `lint`（tsc --noEmit）与 `test`（vitest）依赖 `lib/index.d.ts` / `lib/index.js`（tests 从 `../lib/index.js` 导入做产物级探针），**build 必须先行**。
- pnpm 遇代理问题按坑册 Z4 两段法重试（`env -u http_proxy -u https_proxy -u all_proxy`）。

## 工程纪律

- **单写者**：`tasks/<TASK-ID>/` 同时只允许一个写者（`.lock` 租约 30 分钟）；每完成一个步骤先落盘（产物 + progress + checkpoint）再继续。
- **评分门**：每交付块由独立 reviewer 评分 ≥98 才放行；评审人 ≠ 作者；证据（命令输出/哈希）随块落盘。
- **转义序列禁 heredoc**：含转义序列或中文内容的文件一律用文件写入工具（Write/Edit）创建，不走 bash heredoc（坑册 A14/A25）。
- **小步提交**：每文件组一提交，格式 `feat(ZCTX): W<n> <block>`；产物变更与触发它的源码同提交。

## 范围冻结（当前波次 W1）

- 不实现折叠逻辑（W2-W4 的活）；不引入 react/client 面（禁 `dsh.client` 字段，坑册 Z1）。
- 工具名冻结为 `zctx_fold / zctx_unfold / zctx_recall / zctx_status`（W4 落地）。
