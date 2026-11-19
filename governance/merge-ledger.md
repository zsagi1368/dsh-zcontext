# Merge Ledger — dsh-zcontext

## 2026-11-12 · v0.1.0 首发（战役 ZCTX-20261112）

- 云锚：origin/main = e5a5b58f32517ec1eccc2dfaed7849dcf9df2141；tag v0.1.0（附注 00e97bc）→ e5a5b58。
- 波次与评分门：W1 骨架 99 / W2 纯核心 100（95→返工 5 项）/ W3 引擎 99（77→返工含 [阻断 W3-1 信封形态]）/ W4 接线 100（86→返工 4 项）/ W5 文档+验证 100。全部独立评审人（reviewer≠作者），scorecards/ 在库可复核。
- 安全门：Mimosa deep 扫描 findingCount=0（scanId=scan-2026-11-12T21-36-32.301Z-5350e0a51f38，seal=sha256:fd5f0438…075）。
- 质量证据：193 测试全绿 0 skipped；真官方 dsh-session 投影钉 4 例真跑；真 dsh CLI v0.2.1-alpha.2 --dump-config --patch 组合含我行+负对照成立；verify-activation-surface 8/8；probe-artifact 5/5。
- 偏差登记：本仓为全新仓、单写者顺序波次直接在 main 开发（未用 worktree）——战役级裁定：全新仓单写者场景下 main 直做等效于 worktree 隔离，评审全在提交区间粒度进行；后续多人/并行场景恢复 worktree 纪律。
- post-merge 台账：W5-A6-INSTALL（真机完整安装冒烟）owner=主线/触发=用户桌面环境/复核日期=2026-11-19（closure.json）。

## 2026-11-13 · v0.2.0（观测账本+S1 preflight+S2 薄 adapter）

- 云锚：origin/main = 发布后含台账提交；tag v0.2.0（附注）。
- 波次与评分门：V1 探针+账本结构 99 / V2 observe listener 99 / V3 归因引擎 99 / V4 S1 preflight 98 / V5 S2 薄 adapter 98 / V6 文档+发布 99。全部独立评审（reviewer≠作者），两次配额死亡均增量落盘零丢失（V2 接棒打捞）。
- 安全门：Mimosa deep 13 findings 人工分诊 13/13 实证排除（scanId=scan-2026-11-13T20-17-58.443Z-641147474498，seal=sha256:9610379d…；分诊报告 reports/security/mimosa-v02-triage.md）。
- 质量证据：424 测试全绿；R1-R8 红线独立 grep 审计干净（两轮）；官方语义孪生对拍 zDSH-main@073792c7f8/pi-ai 1.0.2；探针电池 surface 10/artifact 6/smoke 3（真 loader CLI 实跑）/U2 16。
- 设计裁定入册：§3.1 family=协议名直取（A 案）；margin 裁决=product-1+F6.4 误报偏向（R4 确认）；U1 SKIP→S2 visibility-only 降级路径。
- RSI：Z18/Z19/Z20 入 ZDSH-LESSONS.md。
- post-merge 台账沿用：W5-A6-INSTALL 真机全装冒烟（复核日 2026-11-19）。

## 2026-11-14 · v0.2.1（真机异常修复+全量审计+patcher 双形态）

- 云锚：origin/main = 6ae64bdb…（含台账）；tag v0.2.1（附注 7dc6cef）。
- 波次：P0 真机 inject 修复（六键→五键，评审 98）→ 官方 rc.3 漂移侦察+安装面测绘（P1/P2，verifier 12/12 换源复核）→ **全量审计七域**（codegraph/架构 8.5-10/RSI 自审/状态机/宿主面/verifier/重放复现——4 真缺陷全复现确认）→ P3 审计修复（93→返工→99）→ P4 patcher 双形态（96→返工→100）。
- 安全门：Mimosa v0.2.1 波未单独扫（v0.2.0 全扫 13 findings 分诊 13/13 误报入库；P0-P4 变更经七域审计覆盖，真机 patcher 执行归 W5-A6-INSTALL）。
- 质量证据：507 测试全绿；R1-R8 两轮独立审计；真机 209MB asar 副本全链 patch→status→restore 零写入验证；rc.3 适配三项全部无需适配（P1 九组消费面+D2 互证）。
- 设计裁定入册：§3.1 family=协议名 A 案；margin 裁决（R4 确认）；U1 SKIP→visibility-only；sessions 键摘除（零消费硬依赖=静默 PENDING 实证）。
- RSI：Z21-Z26 入 ZDSH-LESSONS.md；RSI 自审逮 Z19 闭环缺口（test 不自动 build）已修（Z19 新链 tsdown&&vitest）。
- post-merge 台账：W5-A6-INSTALL 真机全装+patcher 真机执行（复核日 2026-11-19，验收点含自愈不变式/四态 status/字节级 restore）；P0 遗留 stash e78a247 处置权归用户。

## 2026-11-15 · W5-A6-INSTALL 真机验收（closure open→0）

- 云锚：origin/main = fb679df…（含验收报告+closure 闭合）。
- 诊断（用户真机 `cannot get property "tokenMeter" without inject`）：profile 装的是 v0.2.0（inject 未声明版）；profile cordis.patch.yml 无 zctx 行属正常（bundle patch 运行时组合，不写回用户层——profile.ts:8-20 文档实证）。
- 验收（真 CLI 0.2.1-alpha.2 + 隔离 DSH_HOME）：dump-config exit 0 含 `id/name: dsh-zcontext`；启动装配 inject 失败 0 条、插件零 PENDING；装件身份 0.2.1 齐全。
- 报告：reports/W5-A6-INSTALL-acceptance.md；closure 全量 open=0。
- 用户侧待办：`pnpm update dsh-zcontext` + 重启 app（git 依赖缓存缓解=pnpm store prune 后重装）。
- patcher 真机执行：代码+209MB asar 副本全链验证已过，实际打补丁待用户确认（建议 0.2.1 纯插件稳定运行后再评估）。

## 2026-11-16 · v0.3.0（autoFold 服务端自主折叠 + patcher v0.2 五文件集发布）

- 云锚：main = 393cd40（merge --no-ff feat/ZCTX-P6F：cf15a13 R1-R5 → b58c2ad 基准复证 → c85526d 发布面）；tag v0.3.0。
- 波次构成：P6-B/C（patcher v0.2 五文件集 + guard-observe 桥，评审 96→返工→100）→ P6-D/D2（headless 基准 + face 定谳修复，BENCH-L1 closed）→ P6-E（autoFold 引擎+接线，评审 99）→ P6-D2E 合并前评审（100/99，建议 R1-R5）→ **P6-F 终波（本条）**：R1-R5 全落账 fixed/verified（R1=BENCH-L5 改判机制已解、R2=replay-f297.mjs 入库复跑 MATCH:true、R3=external apiKeyEnv wire warn+2 钉、R4a=模板派生签名+3 重钉、R4b=措辞、R5=归档件头注）+ 基准复证 + 发布。
- 质量证据：电池 592/592（589+R 钉 3）+ tsc 0 + 五探针 6/11/16/3/5 全绿；closure 136 项 OPEN=0；版本面三方一致（package.json=README 双语 badge=CHANGELOG 0.3.0；lib 无版本内嵌）；lib 确定性重建（build 后树净）。
- 基准复证（BENCH §13）：两臂 20 轮真 CLI headless 各提交 1 次服务端折叠（f290 turn14 5195→619 净省 4576；f340 turn18 5739→638 净省 5101），0 模型 zctx_* 调用，触发面 32 HIT/32 no-qualified-span+1 commit；与 P6-E f297（净省 4607）三会话同型——单纪元一次折叠为诚实天花板（BENCH-L6/P6E-4）。disarm 残留=0；原 desktop profile 零触碰。
- RSI：查册执行 Z15/Z19/Z20/Z23/Z28/Z29/Z30/A43；Z30 取证法实证（多帧 zstd 切分读 data.source——stdout 流与 message.* 形态均不含 fold 事件）。
- 备份面：del/20261116-p6f-prechange（13 件仓内文件）+ del/20261116-p6f-bench-prechange（装件 lib 7 件+patch yml）。
- post-merge 台账沿用：BENCH-L2（桌面 web 组合激活态未测）、BENCH-L3（D/E 组重估）、BENCH-L7（nudge 措辞/模型面研究杠杆，v0.4 候选）、P6E-4（吸收窗资格）。

## patcher-auto-20261118a（2026-11-18 · ZCTX-PATCH-AUTO · B5 合并）

- 主仓 main=90d8a9f（--no-ff 合并 feat/ZCTX-PATCH-AUTO 17 提交，d951ebf..6556789）+ tag patcher-auto-20261118a；+5825 行/22 文件（patcher/zctx-patch.mjs +1916）。
- 交付：补丁版自愈三件套（fuse 探测器 VERIFY-P#11 口径 / auto 状态机+tick mutex+双超时 / install-task/uninstall-task hourly 计划任务）+ 快速适配架构（锚集数据外置 patcher/anchors/<version>.json + reanchor 再适配工具 + check-official feed 读侧 + preadapt 预适配管线：下载→sha512→7z 双层提取→fuse 前置→reanchor→模拟 patch 5/5→--accept）+ auto feed 联动（pending→preadapt→落地即自动重打）。
- 质量证据：671/671 测试+tsc 0；B3 评审三轮 96.5→97.5→100 PASS（evaluator≠author）；B4 verifier 100 PASS（V1-V14 逐项，真机 status/auto 只读实测）；R1 红线三波字节不变式（SUPPORTED 段 8e2d0b7e… 口径钉死）；Mimosa 深扫终态 scanId=scan-2026-11-18T19-03-51.979Z-8cf71c6fd981 seal=befb1949… coverage 73/73 truncated=false，5 findings 全分诊误报（mock-session 不在产物束/mongo 全仓零命中/env 只喂模块解析与调试门），依赖风险 0。
- 真机预检：check-official 实测 pending rc.5（feed 2026-11-18T11:35Z，staging 30%，本机 0.4347% 不含，[U1] 保留）；发现并热修 P1（严格解析器拒收真实 feed 的 >- 块标量 → D8e 6556789，fixture=真实 nightly.yml 钉 SHA bd30dc2d…）。
- 开放项移交：B5 真机面（真 300MB 下载 [U2]/真 7z [U3]/V4/V6/V8 主树复测）；插件 pin a4ae662 无需轮转（本波零插件 src 变更）。

### B5 真机留守补记（2026-11-18，同 tag patcher-auto-20261118a）

- 真机 patch 落地：H:\AiAgent\DeepSeekHarness 0.2.2-rc.3 → patched 5/5+marker（全门绿：fuse OFF/app-closed/锚哈希 5/5/witnesses 2/2），备份=H:\AiAgent\zctx-backup\20261118-110448\{RESTORE.md, app.asar}，还原命令在 RESTORE.md。
- 计划任务：ZCTX-Patch-Auto（hourly）注册→可见→卸载→不可见→重装留守，全链留痕（V4 双向证明）。
- rc.5 预适配演练（真链路）：check-official（feed rc.5/staging 30%/本机 0.4347% 不含）→ preadapt --yes（真 300MB 下载+sha512 校验+真 7z 双层提取+fuse 前置检查+reanchor 5/5 ALIVE+模拟全量 patch+status 5/5）→ --accept 落盘 patcher/anchors/0.2.2-rc.5.json（SHA 7df48246d9a43b40…）[U2][U3] 关闭。
- auto 终态：feed-pending "anchors already prepared (data); the update will auto-repatch when it lands" + already-ok（patched 5/5）——官方更新落地后保护零断档。
- 锚集数据文件入库：patcher/anchors/0.2.2-rc.5.json 随本提交入库（防仓库外丢失）。

## AUTOLOG-20261119（2026-11-19 · 用户 "重试并继续" · 推云 main=e544cc3）

- 触发：桌面端 rc.5 自动重打成功（01:05 tick，全门绿+备份+marker）后用户要求继续；发现 auto.log 51 次 EBUSY。
- 修复 1（46e12a5）：defaultConsoleLogPath()=auto.console.log，buildTaskAction/installScheduledTask 默认分离 shell 兜底日志与内部 sink，根治双写争用；新用户 install 默认不双写。
- 修复 2（0af0fc7）：.gitattributes 给 nightly-rc5-real.yml 加 `-text`，根除 core.autocrlf × 哈希守卫（bd30dc2d…）误报，干净 checkout 态 673 测试真绿。
- 质量：B3 快审 100/100 PASS（reviewer-autolog，R1 段 8e2d0b7e… 不变、fixture 跑前后 sha 恒等、checkpoint STEP-0014/0015 链 VALID）；推云 e544cc3。
- 真机运维止血（不在代码审查面）：XML 导入重建 ZCTX-Patch-Auto，shell 重定向改 auto.console.log；**真机补丁态 rc.5 patched 5/5 + marker 在，无需用户操作**。
- 新坑 A73（候选，待 RSI 收口）：subprocess 双写同一 Windows 文件（shell 重定向 + 进程内 sink）→ EBUSY；判据=时间戳区分生产 tick 与测试进程日志（zctx-mutex-* 临时路径=测试写入，非生产故障）。
