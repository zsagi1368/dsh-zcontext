# Merge Ledger — dsh-zcontext

## 2026-11-12 · v0.1.0 首发（战役 ZCTX-20261112）

- 云锚：origin/main = e5a5b58f32517ec1eccc2dfaed7849dcf9df2141；tag v0.1.0（附注 00e97bc）→ e5a5b58。
- 波次与评分门：W1 骨架 99 / W2 纯核心 100（95→返工 5 项）/ W3 引擎 99（77→返工含 [阻断 W3-1 信封形态]）/ W4 接线 100（86→返工 4 项）/ W5 文档+验证 100。全部独立评审人（reviewer≠作者），scorecards/ 在库可复核。
- 安全门：Mimosa deep 扫描 findingCount=0（scanId=scan-2026-11-12T21-36-32.301Z-5350e0a51f38，seal=sha256:fd5f0438…075）。
- 质量证据：193 测试全绿 0 skipped；真官方 dsh-session 投影钉 4 例真跑；真 dsh CLI v0.2.1-alpha.2 --dump-config --patch 组合含我行+负对照成立；verify-activation-surface 8/8；probe-artifact 5/5。
- 偏差登记：本仓为全新仓、单写者顺序波次直接在 main 开发（未用 worktree）——战役级裁定：全新仓单写者场景下 main 直做等效于 worktree 隔离，评审全在提交区间粒度进行；后续多人/并行场景恢复 worktree 纪律。
- post-merge 台账：W5-A6-INSTALL（真机完整安装冒烟）owner=主线/触发=用户桌面环境/复核日期=2026-11-19（closure.json）。
