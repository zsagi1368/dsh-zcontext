# zctx-patch — 官方桌面 app.asar 五文件 base-context 补丁集（patcher v0.2）

> v0.2.2（P6-B）波次产物，随插件 v0.3.0 发布；前身 = v0.2.1 P4 波次的单文件透传桩
> （task card `tasks/ZCTX/cards/P4-patcher.md`）→ P6-B 扩展为五文件补丁集
> （plan `reports/plans/ZCTX-v03-patch-plan.md`；
> 测绘依据 `zDSH-docs/R&D/zctx-20261112/RES-install-surface.md` + `VERIFY-P.md` 12/12）。
> 用户授权：外部覆盖官方安装文件打补丁（2026-11-14 明示）。
> **真机 patch/restore 的执行权与责任在用户命令**——本仓不对真实安装执行。

## Summary (English)

`zctx-patch` is an optional, standalone patcher for the official desktop build.
Patch-set version `zctx-v0.3-base-1` splices **five files** inside the official
asar with ONE atomic asar write (multi-target splice — no partial multi-file
state can persist, zero new asar entries, zero official export-face changes,
zero request-body rewriting). The set lights up the guard-observe wire domain
(per-request hash-then-passthrough fetch wrapper + adapter guard sink + the
inlined observation cluster) on official routes, carrying the P4 forwarding
stub unchanged. Gates: app-not-running, version ∈ supported set, per-file
pristine-hash anchors (drift = official update = refuse loudly), anchor-string
uniqueness, idempotent re-run (already patched → no-op success), and a sibling
backup outside the install dir BEFORE touching anything. `restore` puts every
file back to its pristine bytes from the hash-verified backup and clears the
marker; `status` is strictly read-only and reports the per-file three-state
face (pristine / patched-exact / drifted) plus the `patchSet` aggregate
(patched / unpatched / partial / drifted). The patch survives only until the
official updater replaces the install directory — re-patch after updates.

## 它做什么

官方 `PiAiAdapter` 的 profileOptions 白名单不透传 `onPayload`/`fetch`（RES-adapter-route
F7.4）——这是 wire 账本在官方路由上的唯一缺口。v0.2 的答案从单文件桩升级为**五文件
base-context 补丁集**（γ all-inline：零新增 asar 条目、零官方导出面变更）：

| # | 目标（asar 内路径） | 补丁内容 | 原始 SHA-256（锚） |
|---|---|---|---|
| 1/5 | `dsh/node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/index.js` | P4 转发桩（原样携带）+ config `guardObserve` 默认 TRUE（用户裁决）+ adapter guardSink + hash-then-passthrough fetch 包装层 + 内联观测簇 | `e956da3d7300e1426e13e14f47e6f981dd1ca345633a406568ee5058ad93e9d8` |
| 2/5 | `dsh/node_modules/@deepseek-ai/dsh-agent-loop/lib/index.js` | GuardObserver + 链分类器（自包含）；ignition hunk 在 agent 构造器，显式 opt-out 被尊重 | `f09f60814d4e96a880f41b9fc3832f33c56a28f954f48810d8439ce83ad6ffa8` |
| 3/5 | `dsh/node_modules/@deepseek-ai/dsh-session/lib/index.js` | `cache/guard-observe` 持久化词汇 | `d9911b5e1585bcb142d03ce46eb2990b3fc7c254de5a76d3ffb124bd2469216c` |
| 4/5 | `dsh/node_modules/@deepseek-ai/dsh-compaction-basic/lib/index.js` | L3 逐结果预算 | `e1a3019949d01b22baa91d6eb672d9559d76b97fb5bb45e0428715a316bf11d4` |
| 5/5 | `dsh/node_modules/@deepseek-ai/dsh-compaction-tool-result-pruner/lib/index.js` | `l3.pruning` 声明分支 + `limitFor` | `e86442e9a2403c392482b9035916e5610c251d62f3581892866404d69c064254` |

全部原始哈希在 2026-11-16 从真机 rc.3 asar **只读位置抽取**实测（llm-pi-ai 双重印证
P4 钉）。红线 R1 全程成立：补丁只加观测面与透传字段，零请求体改写；插件缺席/未启用
时一切求值为空操作，官方请求与原版逐字节一致。

**补丁与插件解耦**：补丁可独立重打/回滚；插件可独立升级。

## 为什么 1/5 打在调用点而不是 profileOptions 返回对象

身份（provider/model/sessionId）只在调用点作用域齐全（rc.3 adapter.ts:475-482 的
`options`/`model` 局部变量）；profileOptions 函数体只有 profile/reasoning/apiKey。
桩插在 `...profileOptions(...)` 展开之后、官方显式 `headers:`/`signal:` 键之前——
桩永远不可能破坏官方 header/超时面。

## 子命令（全流程）

```
node patcher/zctx-patch.mjs patch   [--app-dir <dir>] [--dsh-home <dir>]
node patcher/zctx-patch.mjs restore [--app-dir <dir>] [--backup <dir>] [--dsh-home <dir>]
node patcher/zctx-patch.mjs status  [--app-dir <dir>] [--dsh-home <dir>]
```

- app 目录定位：`--app-dir` 优先 → 注册表（HKCU Uninstall 键 InstallLocation）→
  文档化默认 `H:\AiAgent\DeepSeekHarness`。

### patch（打补丁 / 官方更新后重打）

1. **app 运行中拒收**（tasklist 探到 `DeepSeek Harness.exe` 或 `~/.dsh/profiles/desktop/lock`
   存在）→ 拒收；补丁器永不删除 app 的锁文件。
2. **版本门**：asar 根 package.json ∈ 支持集（现 `0.2.2-rc.3`），否则拒收。
3. **逐文件面核**：五文件逐一判定 pristine / patched-exact（按 op 清单重建逐字节复算）/
   drifted——**全部 pristine 才继续；任一 drifted 拒收整个集合且不动盘**；混合面
   （部分 pristine + 部分 patched-exact）响亮拒收并附逐文件面。
4. **锚哈希门**：目标文件 SHA-256 必须命中支持集锚——官方更新 = 锚漂移 = 拒收 +
   报告（绝不盲打；更新锚集后再支持新版本）。
5. **锚串唯一性断言**：每个锚串在目标文件中出现次数必须恰为 1。
6. **先备份**：app 目录 sibling `zctx-backup/<时间戳>/`（安装目录**外**，官方更新/
   卸载不会顺手清掉），含 RESTORE.md 与全量 SHA-256；**备份哈希校验通过才动原件**。
7. **一次原子写入**：多目标 splice——header JSON 与 payload 除五个目标文件外逐字节
   不变（unpacked 原生件标记不动；无整包重打包、无 unpack-pattern 风险）；
   **不存在部分多文件状态**——要么整集在场，要么整集不在。
8. **后校验**：官方 asar API 重读每个目标 = 期望补丁字节；邻近见证文件原始 integrity
   哈希逐一相符；体积记账。
9. **写 marker** `<appDir>/.zctx-patch.json`：v0.2 marker 携带**逐文件 `files[]` 哈希**
   与 patchSet 版本（`zctx-v0.3-base-1`），status 据此区分已应用集合。
10. **幂等**：已打补丁重跑 = skip（exit 0，无新备份）；marker 缺失但补丁在场 = 崩溃窗
    口，从可推导事实回填 marker（asar 不动）。

### restore（回滚）

从备份（默认最新，或 `--backup` 指定）哈希校验后**原子还原全部五个文件到原始字节** +
清除 marker（marker 备份在案时一并还原后删除现场）。官方更新后不要 restore——直接对
新构建重打（restore 只保证回到打补丁前的那个安装状态）。

### status（严格只读）

版本 / 逐文件三态面 / `patchSet` 聚合（`patched | unpatched | partial | drifted`）/
marker（含逐文件哈希与集合版本）/ 备份清单 / 锁面 / 进程。

## 风险与限制（如实）

- **补丁存活期 = 官方更新覆盖**：electron-updater 全量替换安装目录（nightly 实测
  ≈1-2 天一构建，P2 [F29]）。更新后 marker 随目录消失、逐文件哈希漂移 → status 显示
  drifted/缺席；需要时对新官方构建重打（先更新锚集与支持集）。
- **fuse 完整性关闭是运行时事实不是承诺**：`EnableEmbeddedAsarIntegrityValidation`
  在 rc.3 的 exe 中为 off（'0'，Electron v44.7.0 源码 schema "0 == off"，
  VERIFY-P #11 三源交叉）；官方可在任何更新中翻转此位——届时补丁面整体失效。
- **只在 app 关闭时执行**：运行中打补丁会被门拒收。
- **只改上述五个 lib 文件**：执行体是各自 `package.json.main` 指向的 lib（P2 [F14]）；
  引用面与底座行为不改（红线 R1-R8 继承）。
- asar 手术为多目标 splice：除五个目标文件外逐字节不变；后校验含官方 API 可读性、
  见证文件原始 integrity 与体积记账。
- 备份目录在安装目录**外**（sibling），官方更新/卸载不会顺手清掉它；但它不在
  git 管理下——请按 RESTORE.md 的哈希核对留存。

## 与插件的状态面（双源）

`zctx_status` 的 patch 段渲染两个独立事实源：

- **filesystem**：marker 文件（`<appDir>/.zctx-patch.json`，patcher 写入；
  插件经 `process.resourcesPath` 推 app 目录读取）→ present/absent/unknown。
- **runtime**：`globalThis.__zctxPatch__` 是否已由本插件挂载 → armed/idle。

两源齐备 = 补丁 wire 域点亮；只有 marker = 插件未挂载（旧版/禁用）；只有 mount =
补丁未打（纯插件面，一切照旧）。补丁链的 `cache/guard-observe` 会话事件由插件的
只读桥消费（`patch.guardObserveEvents`，默认 true；无补丁时按构造即惰性）。

## 自测与真机边界

- 全部机制在合成 mini-asar fixture 上测试（`tests/patcher.spec.ts` 单文件 +
  `tests/patcher-multifile.spec.ts` 五文件集：单文件 drifted 拒收整集且不动盘、
  三态判定、patchSet 四态聚合全臂可达、restore 逐文件回到原始字节）；插件桥接在
  `tests/patch-bridge.spec.ts`。
- **真机 patch/restore 不由本仓执行**（W5-A6-INSTALL 伞下 post-merge；执行权在用户）。
- 运行时依赖 `@electron/asar`（仓内 devDependency；独立运行请
  `npm i @electron/asar`）。
