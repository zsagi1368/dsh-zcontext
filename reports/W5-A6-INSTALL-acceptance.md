# W5-A6-INSTALL 真机验收报告（2026-11-15）

## 结论：**PASS（插件装载面）**，patcher 真机执行另项

| 验收项 | 方法 | 结果 |
|---|---|---|
| A6-1 真机 profile 现状诊断 | 只读检查 `~/.dsh/profiles/desktop` | ✅ 诊断出原异常完整现场 |
| A6-2 真 CLI 配置组合（0.2.1 装件） | 隔离 DSH_HOME + 真 `apps/cli/lib/bin.js --dump-config`（0.2.1-alpha.2） | ✅ exit 0；`id: dsh-zcontext` + `name: dsh-zcontext` 行在场 |
| A6-3 真 CLIU 启动装配（inject 验证） | 隔离 DSH_HOME + 真 CLI 启动到插件图装配 | ✅ **`without inject` 失败 0 条**；我方插件零 PENDING/零错误日志 |
| A6-4 装件身份 | 读 `node_modules/dsh-zcontext/package.json` | ✅ version 0.2.1 / main lib/index.js / dsh.bundle.patch 声明在位 |

## 原异常完整诊断（用户报告的 `cannot get property "tokenMeter" without inject`）

1. **用户桌面 profile 装的是 v0.2.0**（inject 未修复版本）——`~/.dsh/profiles/desktop/node_modules/dsh-zcontext/package.json` 实证 `version: 0.2.0`；
2. 该版本 `static inject = []`，而 `plugin.ts` 在 apply 时直接访问 `ctx.tokenMeter`/`ctx.llm` → cordis get 陷阱抛错（vendor/cordis/src/reflect.ts:144）；
3. profile 的 `cordis.patch.yml` 里**没有** zctx 行是**正常的**——官方 bundle patch 是运行时组合（`packages/boot/app-boot/src/profile.ts:8-20` 文档：bundles 的 patch 按顺序叠加到空 entry 列表，再叠用户层），不写回 profile 的用户 patch 文件。**不是 patch 丢失，而是旧版插件在 apply 首毫秒抛错**。
4. 修复路径：把 profile 依赖升到 **v0.2.1**（`github:zsagi1368/dsh-zcontext` 已指向 0.2.1 发布后 commit；需 pnpm 重新解析提交哈希）→ 重启 app。

## 待用户执行（唯一待办）

```powershell
cd $env:USERPROFILE\.dsh\profiles\desktop
pnpm update dsh-zcontext        # 或 pnpm remove + dsh plugin add 重新装
```
然后重启桌面 app。若 pnpm 因 git 依赖缓存仍解析到旧 commit：`pnpm store prune` 后重装（Z3/Z4 类坑：git pin 的产物与提交树）。

## patcher 真机执行（A6-5）

未执行——按计划归 post-merge（用户明示「外部覆盖打补丁」为授权动作，但本项独立于插件装载；建议先在插件 0.2.1 稳定运行后再评估是否需要补丁版，因为 0.2.1 的 wire 账本已覆盖纯插件面可达范围）。真机 patcher 命令：

```powershell
node patcher/zctx-patch.mjs status --app-dir "H:\AiAgent\DeepSeekHarness"
node patcher/zctx-patch.mjs patch  --app-dir "H:\AiAgent\DeepSeekHarness"   # app 必须已关闭
node patcher/zctx-patch.mjs restore --app-dir "H:\AiAgent\DeepSeekHarness"  # 随时可回滚
```

## 证据存档

- 驱动脚本（仓外）：`C:\Users\ZS\AppData\Local\Temp\zctx-a69-driver\{accept.mjs,boot.mjs}`
- 隔离 HOME：`C:\Users\ZS\AppData\Local\Temp\zctx-a69-home`、`zctx-a69-boot`（自建自收，可删）
- 真 CLI：`G:\000Github\zDSH\zDSH-main\apps\cli\lib\bin.js`（0.2.1-alpha.2）
- 复用探针家族：`scripts/{probe-real-mount,smoke-real-loader,probe-host-imports}.mjs`（5 PASS/3 PASS/16 PASS）