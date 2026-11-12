# ZCTX 计划（reports/plans/ZCTX-plan.md · v1）

> 任务：独立插件 dsh-zcontext——官方 deepseek harness 的「模型驱动增量上下文折叠」插件。
> 方案依据：docs/specs/ZCTX/options.md（方案甲裁定+开放问题全闭）。
> 上游研究：RES-plugin-api.md（SHA-256 bec57072…）/ RES-billion-context.md（SHA-256 8679466b…，411 行）。

## 1. 目标 / 非目标

**目标**：
- G1 官方 harness 可直接安装的独立插件（`dsh plugin add github:zsagi1368/dsh-zcontext` 之类 git 形态），零底座改动。
- G2 模型驱动增量折叠：4 工具（fold/unfold/recall/status）+ 静态指导段 + 阈值 nudge，长会话窗口占用保持低位。
- G3 折叠=官方 surface replace 通道（官方明文授权），会话/线缆/宿主三方一致。
- G4 与官方 compaction-basic 共存（不关停、不拦截；它始终是硬底）。
- G5 全量单测+类型零错+产物入库（Z3）+装载探针（Z7 同款）+激活面验证脚本（Z9 同款）。

**非目标**（范围裁定，非遗留）：client bundle/自定义 UI（v2）、T2/T3 蒸馏/refold（v2）、auto-fold（v2·产品门控）、auxiliary summarizer（v2）、跨会话检索（v2）、fetch 层路线（永久非目标：官方无通道+重建代理栈）。

## 2. 验收标准（可执行）

| # | 判据 | 验证方式 |
|---|---|---|
| A1 | `pnpm build` 产出 lib/index.js+d.ts 且产物入库 | build 输出+git ls-tree 计数>0 |
| A2 | `tsc --noEmit` 零错 | 命令输出 |
| A3 | vitest 全绿：预算表锁表测试（对拍 CCM v2.3 权威值）+折叠引擎 mock 会话全路径+扫描重建+检索+nudge | vitest run 输出 |
| A4 | scripts/verify-activation-surface.mjs 全绿：Z3 产物在盘+Z7 命名导出探针（apply/name/inject）+fold checkpoint 事件形态断言 | 脚本 exit 0 |
| A5 | 安装门自查：dsh.bundle 声明✓、peerDeps 门✓、无 build 脚本（免 allowBuilds） | 脚本断言 |
| A6 | 真机冒烟：隔离 profile 安装+装载探针；无运行时则如实登记为发布后步骤 | 安装输出或登记 |
| A7 | 双语 README+CHANGELOG+LICENSE+AGENTS.md | 文件存在+en/zh 镜像三门约束 |

## 3. 接口契约（冻结进实现）

- 包名 `dsh-zcontext` v0.1.0；`dsh.bundle.patch=./cordis.patch.yml`；`manifestVersion: 1`。
- cordis.patch.yml：`insert: [{id: dsh-zcontext, name: dsh-zcontext}]`。
- 4 工具名：`zctx_fold / zctx_unfold / zctx_recall / zctx_status`（避 run_code、zctx_ 前缀防撞）。
- checkpoint source kind：`zctx-fold` / `zctx-unfold`（message.source 数据面）；全部会话写入=已知类型 `user/message`。
- static Config（全 primitive）：`enabled`、`nudgeThresholds`（CSV 字符串 "25,50,75,90"）、`keepRecentTokens`（0=自动）、`maxFoldFraction`（0.6）、`minFoldableTokens`（5000）、`protectionFloorTokens`（5000）、`summaryFloorChars`（50）、`netShrinkTolerance`（1.05）。
- peerDependencies：`@deepseek-ai/cordis >=4`（optional）；devDeps 仅 typescript/tsdown/vitest/@types/node；无 build/prepare 脚本（产物入库，Z3）。
- 宿主接口=结构类型 duck-typing（PluginCenter 同款），锚点注释指向官方 file:line；schemastery lazy require + fail-soft（不可用时 config=默认值+日志告警）。

## 3.5 RSI 开工检查项（坑册命中转硬检查项）

- Z3：产物必须入库（pin 装完 lib/dist 必在盘）→ A1+A4 断言。
- Z1：无 client bundle 面 → 结构性免疫；verify 脚本断言 package.json 无 dsh.client（v1 范围）。
- Z7：宿主接口 duck-typing+schemastery lazy require fail-soft → 结构性免疫命名导出炸 boot；A4 探针实测。
- Z9：激活面批量验证脚本（A4）。
- 净室：指导段文本全部自写（不抄 billion-context compression-rules 原文；机制借鉴+自研措辞）。
- ugrep 假阴性：验证结论换独立方法复核（A4 脚本用 node 直读，不走 grep）。
- 子代理静默死亡：每卡落盘纪律+主线代位预案。

## 4. 风险与回滚

| 风险 | 缓解 | 回滚 |
|---|---|---|
| 折叠提交破坏会话完整性 | 官方 replace 通道+保守验证器（保护区/配对闭合/净缩门/原子拒收）+compaction 硬底 | unfold 全量还原+折叠=append-only 可逆 |
| 与官方 compaction 冲突 | 互斥检查（未闭合 compaction/start→拒收）；compaction 遮蔽我方 checkpoint→absorbed 判定 | compaction 是官方功能，双方都 append-only |
| 宿主 API 漂移 | duck-typing+能力探测降级（AutoPilot probes 模式） | 配置 enabled=false 或卸载插件 |
| 模型伪造折叠（billion-context #717 同款风险） | 服务端验证摘要（净缩门/长度窗/区间合法性）；fold 调用频控 | 频控拒收+台账审计 |
| 模型不折叠（不自觉） | nudge+指导段+status 工具；官方 compaction 硬底兜底 | 无损（官方行为不变） |

## 5. 任务波次（每块一提交，评分≥98 放行）

| 波 | 内容 | 产物 | 预算 |
|---|---| tasks/…/artifacts | |
| W1 | 仓库骨架：package.json/cordis.patch.yml/tsdown/tsconfig/vitest/AGENTS.md/LICENSE + A5 自查断言 | 提交+build 绿 | 15 分 |
| W2 | 纯核心五件：budget.ts（锁表测试）/validator.ts/materialize.ts/search.ts/nudge.ts+guidance.ts（全文自写） | 提交+vitest 绿 | 40 分 |
| W3 | 引擎两件：surface-scan/store.ts（扫描重建+事件订阅）+fold-engine.ts（提交编排） | 提交+vitest 绿 | 30 分 |
| W4 | 接线三件：tools.ts（4 工具）/plugin.ts（apply 接线+能力探测）/command.ts+/zctx | 提交+探针绿 | 25 分 |
| W5 | 文档+验证：README 双语+CHANGELOG+verify-activation-surface.mjs+真机冒烟 | 提交+脚本 exit 0 | 20 分 |

每波独立 reviewer 评分 ≥98 放行；<98 打回（≤2 轮）；预算不足缩范围不砍质量门。

## 6. kill criteria

- W2 锁表对拍失败 2 轮 → 公式层回 CCM v2.3 权威表重推。
- W3 mock 会话全路径测试无法闭合 → 折叠提交形态回 options.md §6 重验（官方 region.ts 对照）。
- W4 探针持续失败 → 停线，升级主线裁决（不低分放行）。
