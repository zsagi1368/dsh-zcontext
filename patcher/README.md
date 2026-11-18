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
node patcher/zctx-patch.mjs patch         [--app-dir <dir>] [--dsh-home <dir>]
node patcher/zctx-patch.mjs restore       [--app-dir <dir>] [--backup <dir>] [--dsh-home <dir>]
node patcher/zctx-patch.mjs status        [--app-dir <dir>] [--dsh-home <dir>]
node patcher/zctx-patch.mjs auto          [--app-dir <dir>] [--dsh-home <dir>] [--yes] [--log-file <path>]
node patcher/zctx-patch.mjs install-task  [--script <path>] [--log-file <path>]
node patcher/zctx-patch.mjs uninstall-task
node patcher/zctx-patch.mjs reanchor      --app-dir <新构建目录> [--out <path>] [--accept]
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
marker（含逐文件哈希与集合版本）/ 备份清单 / 锁面 / 进程 / **fuse 面**
（`<appDir>\DeepSeek Harness.exe` 的 fuse wire，见下节）。

### auto（每小时自愈状态机，v0.3-auto）

`auto` 是把"官方更新后补丁静默死亡"变成"自动愈合或响亮报警"的状态机。
每轮 tick：先 `status` 全量只读读取（版本/逐文件/marker/锁/进程/fuse 一次读全），
再按判定表动作；**exit 0 = 已好/无事可做/礼貌跳过，exit 1 = 需要人工**：

| 状态 | exit | 行为 |
|---|---|---|
| `app-running` | 0 | 进程探到运行中 **或** app 自身 lock 在 → 下个 tick 重试 |
| `fuse-on` | 1 | `EnableEmbeddedAsarIntegrityValidation='1'` → 打了也加载不了 → CRITICAL 日志，人工 |
| `fuse-missing` | 1 | exe 缺席/sentinel 扫不到/格式异常 → fail-closed，人工 |
| `fuse-removed` | WARN | `'r'`（removed=不强制）→ 告警后继续 |
| `refused` | 1 | 版本门（shell 版本不在支持集）或 patch 流程自身门拒绝 → 响亮，人工 |
| `drifted` | 1 | 官方更新/外来修改 → 逐文件差异响亮日志，**永不盲打** |
| `mixed` | 1 | 半套 face（外来部分写入者）→ 拒绝并报告，人工 |
| `would-patch` | 0 | 全 pristine+锚命中（或 patched 但 marker 缺失）且**无 `--yes`** → 只记录不动盘 |
| `patching`/`patch-step` | (日志) | 有 `--yes`：经**未改动的全门 patch 流程**执行一轮修复（每 tick 至多一次） |
| `patched` | 0 | patch 成功 **且** Z29 全量 status 复核通过（patched 5/5 + marker）**且** Z32 备份在盘 |
| `already-ok` | 0 | patched N/N + marker 在 → 无事可做 |
| `verify-failed` | 1 | 复核不过/备份不在盘 → 给出 restore 命令，人工 |

设计不变式：`--yes` 只是"用户显式批准每 tick 一次修复"，**patcher 的每道门
（app-running/fuse/版本/锚/混合面/备份校验）照常运行照常拒绝**；auto 永不绕门、
永不盲打（`:1776` 哲学：自修复需显式眼睛，`--yes` 即载体）。备份沿用既有流程
——先在盘 + 哈希校验通过才动原件（Z32），patch 后**全量 status 复核**而非单点校验（Z29）。

日志契约（Z28：headless 无 logger，文件 sink 是唯一可靠面）：每行
`[ISO8601] [auto] state=<X> detail=<...>`，同时写 console 与
`%LOCALAPPDATA%\zctx-patch\auto.log`（append，目录自动创建）；sink 写入失败
**不阻断判定**但 console 响亮 + 结果体带 `sinkError`。无 `--yes` 的巡检 tick 照常留痕。

### install-task / uninstall-task（Windows 计划任务）

```
schtasks /Create /TN ZCTX-Patch-Auto /SC HOURLY /TR "<action>" /F
```

- action = `cmd /c ""<node>" "<script>" auto --yes >> "<log>" 2>&1"`：三个路径全部
  双引号，**整体再包一层外引号**——cmd.exe `/C` 规则 2（cmd /?）会剥掉行首行尾引号，
  外层引号正是为被剥而存在，内层命令因此完整存活（含空格路径——安装目录
  "DeepSeek Harness" 本身带空格）。node 路径 = `process.execPath` 绝对路径；
  脚本路径默认本文件 `import.meta.url` 经 `fileURLToPath` 解析（可用 `--script` 覆盖）；
  log 默认 `%LOCALAPPDATA%\zctx-patch\auto.log`。
- **install 幂等**：`/Query` 探到已存在 → 先 `/Delete /F` 再建 → 建后再 `/Query`
  证明可见；每条 schtasks 命令与结果全部进 steps（CLI 全程打印）。
- **uninstall**：删除后再 `/Query` **证明不可见**；任务缺席 = 幂等成功。
- 非 win32 平台：install/uninstall 一律响亮拒绝（不创建任何东西）。
- **真机注册（B5）在主树执行**：计划任务必须指向主树稳定路径
  （`G:\000Github\zDSH\zDSH-plugins\dsh-zcontext\patcher\zctx-patch.mjs`）——
  worktree 路径不是长期位置；注册命令在 B5 以 `--script` 显式传主树路径，
  仓库自身从不对真机 schtasks 执行任何操作。

## 快速适配官方升级 SOP（v0.3-reanchor）

官方 rc.4+ 发布后，适配不再是"改代码"——机械部分全部自动化，人工只剩"看一眼报告"：

1. **发现**：auto 巡检 tick 对新构建报 `drifted`（逐文件响亮日志，exit 1）——或手动
   `status` 看逐文件面（`status` 同时报告 `anchorSetSource` 与 `availableAnchorSets`
   ——在码版本 + `patcher/anchors/` 数据目录清单）。
2. **分类**：对新构建目录跑 `reanchor --app-dir <新构建目录>`。工具**只读**抽取五个
   目标文件，逐 op 断言既有锚串在新字节中 count==1：
   - 全部 ALIVE（锚串原样存活）→ 产出**候选锚集**（锚串逐字继承，仅把
     `pristineSha256` 更新为新文件哈希），候选 JSON 默认打印；`--out <path>` 另存
     一份检视副本；**不带 `--accept` 不写 `patcher/anchors/`**。
   - 任一锚 DRIFTED（count≠1）→ **候选不产出**（禁猜锚），报告逐目标材料：
     新旧文件 SHA-256、每锚期望 vs 实测计数、锚迹上下文行（锚本身 → 首行 →
     60 字符前缀，±5 行；`locatedBy:'none'` = 锚彻底消失，如实报告）→ 人工据此
     手改探针锚后重跑。
   - 输入是已打补丁的字节（presenceMarker 在场）→ 响亮拒收（reanchor 只认
     pristine 面——先 restore 或用未打补丁的构建）。
   - 目标文件缺席/改名（结构性变化）→ 拒收（超出锚集适配范围，需人工）。
3. **过目**：人工检视候选 JSON（锚行 diff、唯一性计数已在报告中）。
4. **落盘**：`reanchor --app-dir <新构建目录> --accept` → 校验通过后原子写入
   `patcher/anchors/<version>.json`，stdout 打印该文件 SHA-256。已存在同版本数据
   文件 = 拒收（reanchor 永不覆盖——删除旧文件是人的决定）。
5. **重打**：`patch`/`auto` 的加载器按版本精确匹配自动选中数据锚集（在码 rc.3
   锚集保留为已验证默认，不迁出），下一轮 auto tick 自动重打——无需改代码。

**数据锚集安全边界（fail-closed 不弱化）**：数据文件只是数据——打补丁前，既有
哈希门对新文件逐目标复算 `pristineSha256`，`patchFile` 对每条锚在真实字节上断言
count==1；错数据在动手前必被拒。加载器逐字段校验（元数据三字段/五目标路径各一次/
64-hex 哈希形态/锚串与 op 结构/锚唯一性），**存在但损坏的数据文件响亮拒收且绝不
回退在码 map**；未知版本照旧拒绝。锚始终用精确串（count=1 实证），不用正则锚。
端到端零人工编辑链路由 `tests/patcher-reanchor.spec.ts` 的 money test 锁定。

## 风险与限制（如实）

- **补丁存活期 = 官方更新覆盖**：electron-updater 全量替换安装目录（nightly 实测
  ≈1-2 天一构建，P2 [F29]）。更新后 marker 随目录消失、逐文件哈希漂移 → status 显示
  drifted/缺席；需要时对新官方构建重打（先更新锚集与支持集）。
- **fuse 完整性关闭是运行时事实不是承诺**：`EnableEmbeddedAsarIntegrityValidation`
  在 rc.3 的 exe 中为 off（'0'，Electron v44.7.0 源码 schema "0 == off"，
  VERIFY-P #11 三源交叉）；官方可在任何更新中翻转此位——届时补丁面整体失效。
  **读取法（权威口径）**：`readFuseWire` 在 exe 内**扫描** sentinel
  `dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX`（rc.3 位于 offset 199,416,024——offset 随官方构建
  漂移，**禁固定 offset**），其后解析 `[version 1B][wireLen 1B][9 个 ASCII 状态字节
  '0'/'1'/'r']`，index4 即完整性位；任何格式异常（版本≠01/长度溢出/长度≠9/非法字符/
  sentinel 缺席）= `found:false` + 原因，**fail-closed**。status 汇报该面；patch 在
  `'1'` 或不可读时拒收、`'r'`（removed）警告放行；auto 判定表据此分派。
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
  `tests/patch-bridge.spec.ts`；fuse wire 读取/patch 门/status 面在
  `tests/patcher-fuse.spec.ts`（合成 exe，sentinel 随机偏移）；auto 判定表逐态与
  计划任务形态在 `tests/patcher-auto.spec.ts`（仅进程探针 mock，patch/status 真跑；
  schtasks 仅 fixture 级形态断言）；快速适配架构（reanchor 分类/候选/accept + 数据
  锚集加载器/校验器 + reanchor→patch→status 零人工编辑 money test）在
  `tests/patcher-reanchor.spec.ts`。
- **真机 patch/restore/计划任务注册不由本仓执行**（W5-A6-INSTALL 伞下 post-merge；
  执行权在用户；B5 真机 OPS 在合并后主树执行，计划任务用 `--script` 指主树路径）。
- 运行时依赖 `@electron/asar`（仓内 devDependency；独立运行请
  `npm i @electron/asar`）。
