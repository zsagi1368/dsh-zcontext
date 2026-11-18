# ZCTX-PATCH-AUTO 方案研究

> 任务：把 zctx 补丁版搞好——消除"官方更新后补丁静默死亡"的结构性弱点，真机留守。用户指令（2026-11-18 逐字）："RSI 把补丁版搞好"。

## 事实基础（2026-11-18 实测）

| 事实 | 来源/置信度 |
|---|---|
| 真机桌面 app=`H:\AiAgent\DeepSeekHarness`，版本 0.2.2-rc.3，**未运行**；注册表 InstallLocation 在册 | 注册表 Uninstall 键实读；高 |
| asar 209,021,953B（mtime 11-12 23:30），5 目标文件全 pristine（与锚集逐一吻合），state=unpatched | `zctx-patch.mjs status` 只读实测；高 |
| patcher 现状：2181 行，版本门/锚哈希门/app-running 门 fail-closed 齐备；**无 auto/watch/schedule 机制**（:1776 注释明示"auto-repair 需显式眼睛"）；**无 fuse 探测** | 代码实读 grep；高 |
| 补丁存活期=官方更新覆盖（electron-updater 全量替换安装目录，nightly ≈1-2 天一构建）→ marker 消失→drifted | patcher/README.md 风险节（P2 [F29] nightly 实测）；高 |
| fuse 读取权威法：exe 内 sentinel `dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX` 扫描（offset 随构建漂移，禁固定 offset）→ [version 0x01][length 0x09][9 状态字节 ASCII '0'/'1'/'r']；FuseV1Options index4=EnableEmbeddedAsarIntegrityValidation；'0'=off（Electron v44.7.0 源码 schema 明文）；P2 的 7 字节四态编码已被 REFUTED | VERIFY-P #11 三源交叉定谳；高 |
| 桌面 profile（C:\Users\ZS\.dsh\profiles\desktop）已装 dsh-zcontext pin=a4ae6629；补丁后插件只读桥 patch.guardObserveEvents（默认 true、惰性）即活 | profile package.json 实读；高 |
| 坑册命中（开工查，转卡面检查项）：Z26（asar extractFile path.sep+rename 缓存陈旧头）/Z27（多目标 splice offset 平移）/Z32（备份先在盘+SHA256SUMS 后写台账）/Z29（禁"正则移除+dump 校验"双失明，auto 重打必须全量 status 复核）/Z19+Z15（先 build+tsc 再信测试）/Z17（产物含注释，断言先剥）/Z23（含转义代码禁 heredoc）/Z28（headless 无 logger sink，auto 日志必须落文件）/Z20（file: URL pathname 反解）/A68（跨目录操作绝对路径+禁 cd 相对链）/坑册32（.mjs 代码用 Edit/Write 工具，Mimosa 拦 Bash） | ZDSH-LESSONS.md + GLOBAL-LESSONS.md 实读；高 |
| app.asar.unpacked 外置 require 通道替代 asar 手术：**未证实可行性**（RES-install-surface [F130]） | 研究档；高（对"不可行"的陈述为"未证实"） |

## 选项 A（推荐）：自愈三件套 + 真机留守

- 做法：
  1. **fuse 探测器**（新增 `readFuseWire`）：sentinel 扫描→[version][length][states] 解析→报告 index4 完整性位（'0'/'1'/'r'/not-found）；`status` 增 fuse 字段（含原始字节十六进制）；`patch` 在 integrity='1' 时拒绝（fail-closed），sentinel 找不到/格式异常时拒绝并报告。
  2. **`auto` 子命令**（状态机）：app 运行中→日志+exit 0（下轮重试）；fuse=on→CRITICAL 日志+exit 1；当前构建与已知锚集版本吻合且 unpatched→（`--yes` 显式批准下）打补丁→**全量 status 复核**（Z29 禁单点校验）→exit 0；已 patched 且 5/5 干净→exit 0；drifted（版本/哈希未知）→逐文件差异响亮日志+exit 1（**永不盲打**）；mixed 态→拒绝+报告（:1776 哲学：自修复需显式眼睛，`--yes` 即用户显式授权载体）。
  3. **`install-task`/`uninstall-task`**：Windows 计划任务（schtasks，任务名 ZCTX-Patch-Auto，hourly），动作用安装时解析的绝对 node 路径+仓库主树脚本路径，输出重定向到 `%LOCALAPPDATA%\zctx-patch\auto.log`（Z28：headless 必须有文件 sink）；`status` 面向 auto 的机器可读摘要。
  4. **真机留守**（OPS 块，编码合并后）：备份→patch→status 5/5 复核→插件桥在位确认→RESTORE.md 补录→install-task 注册。
  5. 测试：fuse 解析单元（合成 exe 缓冲、sentinel 随机偏移、全状态组合、坏格式拒绝）；auto 状态机按判定表逐态测试；现有 patcher 三 spec 零回归；tsc+build 先行（Z19/Z15）。
- 优点：直击两大结构弱点（存活期/fuse 盲区）；fail-closed 哲学不变（`--yes`=显式批准）；真机当天受益。
- 缺点/风险：计划任务=系统状态新增（一次性、可 uninstall-task 注销，注册前后留痕）；auto 的"自动重打"依赖锚集对新官方版本仍命中（版本漂移→响亮失败，等人工适配锚——这是 fail-closed 的正确行为，不是缺陷）。

## 选项 B：只文档化手动流程（更新后手动重跑 patch）

- 优点：零新代码。
- 缺点：不解决存活期痛点（用户无感知漂移、忘了重打=补丁白打）；与用户"搞好"指令不符。
- 淘汰理由：治标不治本。

## 选项 C：弃 asar 手术，改走 resources/app.asar.unpacked 外置加载通道

- 优点：免疫官方更新覆盖（unpacked 目录不被 updater 全量替换？——**未证实**）。
- 缺点：RES-install-surface [F130] 明确标"未证实可行性"；loader 是否走 unpacked 优先加载无证据；研究成本高且可能整条路死。
- 淘汰理由：无证据路线不做（§7 事实纪律）；fail-closed 的 auto 已把更新覆盖的代价降到"自动重打"。

## 推荐方案

- 选择：A。
- 为什么优于备选：B 不解决痛点；C 无证据且研究成本高。A 在既有 fail-closed 架构上做增量（不破坏任何既有门），把"更新后补丁死亡"从静默变成自动愈合或响亮报警，并当天完成真机留守。
- 反方证据/限制：auto 无法治愈"官方结构性变化"（fuse 翻转/锚漂移）——那是响亮失败+人工适配的领域，属于正确边界；计划任务常驻是用户显式授权（`--yes`+install-task 均为用户指令"搞好"的直接执行）。
- 未解决问题：官方下一次构建的确切时间与内容（无法预知——auto 逐轮应对）；fuse 若被官方翻转的替代路线（研究面，非本任务）。
