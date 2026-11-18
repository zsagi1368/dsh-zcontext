# ZCTX-PATCH-AUTO 计划

> 把 zctx 补丁版搞好：自愈三件套（fuse 探测 / auto 状态机 / 计划任务）+ 真机留守。方案依据：`docs/specs/ZCTX-PATCH-AUTO/options.md`（选项 A）。

## 1. 目标与非目标

- **目标**：①`status` 报告 fuse 完整性位；②`patch` 在 integrity=on 或 fuse 格式异常时 fail-closed 拒绝；③`auto` 子命令按判定表自愈（unpatched+锚吻合→重打；drifted→响亮失败永不盲打；app running→礼貌跳过）；④`install-task`/`uninstall-task` 注册/注销 hourly 计划任务（绝对路径+文件日志）；⑤真机：打补丁留守+计划任务注册+RESTORE.md 补录；⑥全部测试绿零回归。
- **非目标**：return-cap（二期，固定开销治理）；多纪元折叠（BENCH-L6 v0.4）；锚集对新官方版本的预适配（版本未出，无法预适配）；插件 pin 轮转（a4ae662→HEAD 仅 docs 差异，无功能增量）。

## 2. 事实基础

见 options.md 事实表。**工作方式声明**：写任务按 §14 走 feat/ZCTX-PATCH-AUTO + worktrees/ZCTX-PATCH-AUTO（已建）；真机 OPS 块（B4）在合并回主树后于主树执行（计划任务指向主树稳定路径）。

## 3. 方案与淘汰理由

选项 A 胜出；B 治标不治本；C 无证据路线不做。详见 options.md。

## 4. 接口契约

- `readFuseWire(exePath)` → `{ found:boolean, version?:number, states?:string[], integrity?:'0'|'1'|'r', rawHex?:string }`；sentinel 扫描禁固定 offset；异常=found:false。
- `auto` exit code 契约：0=无事可做/已好/礼貌跳过；1=需要人工（drifted/fuse on/mixed/拒绝）。
- 计划任务：名 `ZCTX-Patch-Auto`；action=cmd /c "…node.exe" <主树脚本绝对路径> auto --yes >> %LOCALAPPDATA%\zctx-patch\auto.log 2>&1；install 幂等（已存在先删再建，留痕）。
- 日志行格式：`[ISO8601] [auto] state=<X> detail=…`（Z28：文件 sink 是唯一可靠面）。

## 5. 任务卡与依赖（DAG）

| 块 | 内容 | 依赖 |
|---|---|---|
| B1 | 计划+options+任务卡（本文件）+coder 派发 | 无 |
| B2 | coder：fuse 探测器 + auto 状态机 + install/uninstall-task + 测试 + README（工作树内，小步提交）——已完成（6 提交，628 测试绿） | B1 |
| B2b | coder（用户 11-18 扩令"彻底开发好+快速适配架构"）：**D5 锚集数据外置**（patcher/anchors/<version>.json + 加载器 + status 展示可用锚集，未知版本仍拒绝）；**D6 `reanchor` 子命令**（对新官方构建自动提取 5 目标文件→锚存活分类（ALIVE/DRIFTED/patched 拒收）→产出候选锚集 JSON→`--accept` 落盘）；**D7 测试+README**（模拟漂移 fixture：reanchor→patch→verify 端到端零人工编辑；快速适配 SOP 节） | B2 |
| B3 | reviewer 对抗评审（≥98 门；核对 Z26/Z27 回归锁、Z29 全量复核、R1 红线不变式、锚集数据外置不弱化 fail-closed：哈希门+计数门仍全数生效） | B2b |
| B4 | tester+verifier：全量测试（tsc 先行）+ asar 副本全链回归 + 评分 | B3 |
| B5 | 合并回主树（--no-ff+台账）→ 真机 OPS：备份→patch→status 5/5→插件桥确认→RESTORE.md 补录→install-task→schtasks /Query 佐证 | B4 ≥98 |

**快速适配架构说明（用户扩令核心）**：官方 rc.4+ 发布后的适配工作流=①auto 巡检发现 drifted（响亮日志）→②对新构建跑 `reanchor`（自动提取+分类+产出候选锚集）→③人工过目候选（锚行 diff+唯一性计数已在报告中）→④`--accept` 落盘 anchors/<version>.json→⑤下一个 auto tick 自动重打。机械部分全部自动化，人工只剩"看一眼报告"。锚仍用精确串（count=1 实证），不用正则锚（Z29 教训：正则锚在想象形态上）；数据文件安全性由既有 pristine 哈希门兜底（错锚在打补丁前即被哈希门拒绝，fail-closed 不弱化）。

## 6. 验收矩阵（可执行）

| # | 验收 | 检查方法 |
|---|---|---|
| V1 | status 输出 fuse 字段且真机 rc.3 = integrity '0'（off） | 真机跑 status 看 JSON |
| V2 | integrity='1' 时 patch 拒绝 | 单测：合成 exe 缓冲（sentinel 随机偏移+states 全组合） |
| V3 | auto 六态机逐态符合判定表 | 单测（mock 门） |
| V4 | install-task 后 schtasks /Query 可见；uninstall 后不可见 | 真机命令佐证 |
| V5 | 全量测试绿（tsc→build→vitest 顺序）零回归 | 仓库 test 链输出 |
| V6 | 真机 patch 后 status=patched 5/5；备份目录 SHA256SUMS 在盘（Z32：先在盘后写台账） | status 输出+备份目录实读 |
| V7 | R1 红线不回归（补丁只加观测面透传字段，零请求体改写） | 既有守卫测试全绿+diff 审 |
| V8 | auto.log 落盘且行格式符合契约 | 触发一轮 auto 看日志 |

## 7. 风险与回滚

- 风险：①auto 误打（防线=锚哈希门+全量 status 复核+--yes 显式批准）；②计划任务路径失效（仓库移动→任务失效，日志会报错；修复=重跑 install-task）；③真机 patch 期间 app 启动竞态（app-running 门先行，窗口秒级）；④fuse 解析对非 rc.3 exe 误判（防线=sentinel 找不到即拒绝，不猜 offset）。
- 回滚：`zctx-patch.mjs restore`（备份目录在安装目录外 sibling，RESTORE.md 哈希核对）；`uninstall-task` 注销计划任务；合并可 revert。

## 8. 预算与升级条件

- 预算：coder 1 名 + reviewer/tester/verifier 各 1 名；≤3 小时；返工 ≤2 轮。
- 升级：fuse 读取与 VERIFY-P #11 定谳冲突→停手上报；真机 patch 触发任何官方行为异常→立即 restore+上报；reviewer 发现 R1 红线潜在破坏→阻断合并。
