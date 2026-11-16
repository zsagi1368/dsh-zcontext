# zctx-patch — 官方桌面 app.asar 单点透传补丁（v0.1.0）

> v0.2.1 P4 波次产物（task card `tasks/ZCTX/cards/P4-patcher.md`；plan §3 补丁连接设计；
> 测绘依据 `zDSH-docs/R&D/zctx-20261112/RES-install-surface.md` + `VERIFY-P.md` 12/12）。
> 用户授权：外部覆盖官方安装文件打补丁（2026-11-14 明示）。

## Summary (English)

`zctx-patch` is an optional, standalone patcher for the official desktop build.
It splices exactly one defensive one-line forwarder into the official
`PiAiAdapter` call site so the adapter passes `onPayload`/`fetch` through
(the official whitelist drops them — the only wire-side gap on official
routes). Rules: it refuses to run while the app is running, refuses on any
version or anchor-hash mismatch, backs the target up before touching it, and
verifies with the official asar API afterwards. `restore` puts the original
bytes back; `status` is strictly read-only. When the plugin is absent or
disabled the stub evaluates to `{}` and the official request is byte-identical
to stock. The patched file survives only until the official updater replaces
the install directory — re-patch after upgrades. The Chinese sections below
are the authoritative detail (gates, anchor matrix, risks, dual-source status).

## 它做什么

官方 `PiAiAdapter` 的 profileOptions 白名单不透传 `onPayload`/`fetch`（RES-adapter-route
F7.4），这是 wire 账本在官方路由上的唯一缺口。本工具向官方 adapter 的 streamSimple
options 构造点插入**一行防御性转发桩**（只加 options 字段，零 body 改写，红线 R1）：

```js
...(globalThis.__zctxPatch__?.wireOptions?.({ provider: options.provider, model: model.id, sessionId: options.sessionId }) ?? {}),
```

- 插件在装且启用时：启动挂 `globalThis.__zctxPatch__.wireOptions`，桩按请求拿到
  provider/model/sessionId，返回与插件自有 adapter 相同语义的 wire 面绑定到每会话
  wire 账本（R1 只观测恒返 undefined；R7 attribution 经 fetch 包装层叠加进
  init.headers——桩位置在官方显式 `headers:` 键之前，插件的 headers 面被官方键覆盖，
  fetch 包装层是补丁模式下 attribution 的送达通道）。
- 插件缺席/未启用/会话不受管/宿主面不可达：桩求值为 `{}`，官方请求与原版逐字节一致
  （自动降级，零操作）。

**补丁与插件解耦**：补丁可独立重打/回滚；插件可独立升级。

## 为什么打在调用点而不是 profileOptions 返回对象

身份（provider/model/sessionId）只在调用点作用域齐全（rc.3 adapter.ts:475-482 的
`options`/`model` 局部变量）；profileOptions 函数体只有 profile/reasoning/apiKey。
桩插在 `...profileOptions(...)` 展开之后、官方显式 `headers:`/`signal:` 键之前——
桩永远不可能破坏官方 header/超时面。

## 子命令

```
node patcher/zctx-patch.mjs patch   [--app-dir <dir>] [--dsh-home <dir>]
node patcher/zctx-patch.mjs restore [--app-dir <dir>] [--backup <dir>] [--dsh-home <dir>]
node patcher/zctx-patch.mjs status  [--app-dir <dir>] [--dsh-home <dir>]
```

- app 目录定位：`--app-dir` 优先 → 注册表（HKCU Uninstall 键 InstallLocation）→
  文档化默认 `H:\AiAgent\DeepSeekHarness`。
- **patch**：版本门（asar 根 package.json ∈ 支持集）→ 幂等检查（已打=skip 不动盘）→
  锚哈希门（目标 lib/index.js SHA-256 必须命中支持集锚）→ 锚唯一性断言 →
  **先备份**（app 目录 sibling `zctx-backup/<时间戳>/`，含 RESTORE.md 与 SHA-256，
  备份校验通过才动原件）→ 外科拼接 → 后校验（官方 API 重读目标=期望字节、
  邻近见证文件与原始 integrity 哈希逐一相符、体积记账）→ 写 marker
  `<appDir>/.zctx-patch.json`。
- **restore**：从备份（默认最新，或 `--backup` 指定）哈希校验后原子还原 + 清除 marker。
- **status**：严格只读。版本/锚命中/补丁在场（桩计数）/marker/备份清单/锁面/进程。

## 门与拒收（全部大声拒绝，绝不硬来）

1. app 运行中（tasklist 探到 `DeepSeek Harness.exe` 或 `~/.dsh/profiles/desktop/lock`
   存在）→ 拒收。补丁器**永不删除** app 的锁文件；陈旧锁由用户自行处置。
2. 版本不在支持集 → 拒收。
3. 目标文件哈希与锚集不符（官方更新=锚漂移，预期路径）→ 拒收；更新锚集后再支持。
4. 锚串在目标文件中出现 ≠1 次 → 拒收。
5. 已打补丁 → 幂等 skip（exit 0，无新备份）。

## 支持集（锚矩阵）

| 桌面版本 | 目标（asar 内路径） | 原始 SHA-256 |
|---|---|---|
| `0.2.2-rc.3` | `dsh/node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/index.js` | `e956da3d7300e1426e13e14f47e6f981dd1ca345633a406568ee5058ad93e9d8` |

锚串（rc.3 lib/index.js 实读形态，2026-11-14 真机只读抽取复验 count=1）：
调用点 `...profileOptions(profile, reasoning, apiKey),`、定义行
`function profileOptions(profile, reasoning, apiKey) {`。

## 风险与限制（如实）

- **补丁存活期 = 官方更新覆盖**：electron-updater 全量替换安装目录（nightly 实测
  ≈1-2 天一构建，P2 [F29]）。更新后 marker 随目录消失、lib 哈希漂移 → patcher
  状态面显示缺席/漂移；需要时对新的官方构建重打（先更新锚集）。
- **fuse 完整性关闭是运行时事实不是承诺**：`EnableEmbeddedAsarIntegrityValidation`
  在 rc.3 的 exe 中为 off（'0'，Electron v44.7.0 源码 schema "0 == off"，
  VERIFY-P #11 三源交叉）；官方可在任何更新中翻转此位——届时补丁面整体失效。
- **只在 app 关闭时执行**：运行中打补丁会被门拒收。
- **只改 lib/index.js**：执行体是 `package.json.main` 指向的 lib（P2 [F14]）；
  `src/adapter.ts`（引用面）不动、不改任何底座行为（红线 R1-R8 继承）。
- **夜间更新器可能随时覆盖**：restore 只保证回到打补丁前的那个安装状态；官方
  更新后请直接重打而非 restore。
- asar 手术为单文件拼接：头 JSON 与 payload 除目标文件外逐字节不变（unpacked
  原生件标记不动）；后校验含官方 API 可读性、见证文件原始 integrity 与体积记账。
- 备份目录在安装目录**外**（sibling），官方更新/卸载不会顺手清掉它；但它不在
  git 管理下——请按 RESTORE.md 的哈希核对留存。

## 与插件的状态面（双源）

`zctx_status` 的 patch 段渲染两个独立事实源：

- **filesystem**：marker 文件（`<appDir>/.zctx-patch.json`，patcher 写入；
  插件经 `process.resourcesPath` 推 app 目录读取）→ present/absent/unknown。
- **runtime**：`globalThis.__zctxPatch__` 是否已由本插件挂载 → armed/idle。

两源齐备 = 补丁 wire 域点亮；只有 marker = 插件未挂载（旧版/禁用）；只有 mount =
补丁未打（纯插件面，一切照旧）。

## 自测与真机边界

- 全部机制在合成 mini-asar fixture 上测试（`tests/patcher.spec.ts`）+ 插件桥接在
  `tests/patch-bridge.spec.ts`。
- **真机 patch/restore 不在本波执行**（W5-A6-INSTALL 伞下 post-merge）。
- 运行时依赖 `@electron/asar`（仓内 devDependency；独立运行请
  `npm i @electron/asar`）。
