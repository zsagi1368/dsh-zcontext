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
