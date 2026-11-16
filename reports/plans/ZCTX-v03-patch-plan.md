# ZCTX v0.3 计划：底座级上下文补丁（用户裁定形态 · 2026-11-16）

> 用户裁定（2026-11-15/16）：把 Go 底座上下文能力做成**安装补丁**——直接改官方底座文件，装完进官方 dsh 完整功能生效；官方升级后重打补丁。**不做 fork rebase、不做常驻进程、不做代理**。机制已实证：patcher 在 rc.3 真机 209MB asar 全链 patch→status→restore 零写入验证、fuse 完整性 off 双证、lib 未压缩锚唯一。

## 补丁集规模实测（Go 树 8304aa8324→e63ceff2d7，主线 git numstat）

- **改动现有文件 13 个 ≈656/84 行**：compaction-basic(+78/−54)、pruner(+54/−11)、harness-dev-context(+189)、agent.ts(+41/−1)、runtime-context(+98/−8)、adapter(+19)、cache-guardian(+16/−2)、config(+10)、cache-metrics(+28/−8)、l3(+3)
- **新增模块 2 个 686 行**：llm-pi-ai/guard-observe.ts(553) + agent-loop/guard-observe.ts(133)
- **Go 独有整文件**（官方没有，drop-in）：cache-guardian(715)/cache-metrics(352)/l3(65)/return-cap(133)
- L4 proactive 在 Go 侧挂起（parked 分支）——v0.3 补丁**不含**，保持官方阈值行为（除非用户后续要求）
- L1 通用快照冻结**任何树都没实现**——登记 v0.4，不虚构

## 与 rc.3 的真实移植工作量（诚实项）

Go 补丁基于 fork 基线（pi-ai 1.0.2 + alpha.2 世代）；官方 rc.3 = pi-ai 1.3.0 + rc.2 漂移（session append 时序/LlmError 收窄/PromptPresentation/LlmAdapter 8 成员）。→ **移植≠rebase**：逐文件三方对齐（fork-base→Go 的 diff × official rc.3 现文件），产出锚定 rc.3 lib 的补丁 spec。P1 漂移报告已给 9 组消费面零漂移结论，移植面有地图。**这是一次性有界工作，不是长期负担**——正是用户"官方升级后继续升级补丁"的模型。

## 波次

| 波 | 内容 |
|---|---|
| P6-A | 移植可行性测绘：13 文件逐个三方 diff（fork-base→Go × official rc.3 现文件），产出逐文件补丁 spec（锚/hunk/新模块清单/依赖闭包/1.3.0 锚重推导），报告 RES-port-feasibility.md |
| P6-B | patcher v0.2：补丁集数据化（多文件+新模块内联）、rc.3 锚集、digest 门、幂等/备份/restore、真机只读验证 |
| P6-C | 插件伴随：guardObserve 事件消费+status 补丁态+config 翻转面；版本 0.2.2 |
| P6-D | **基准对照实验**（现在才有意义：补丁让 L5/L0 真在官方宿主跑起来）——5 组对照出数字 |
| P6-E | 发布：patcher v0.2.0 + plugin v0.2.2 + 文档（补丁集/重打流程/回滚） |

评审 ≥98 每波；红线 R1-R8 继承；**真机 patch 执行仍归用户命令**（工具交付+验证，不擅自改用户安装）。

## 明确不做

fork rebase/常驻进程/代理 fetch MITM/L1 通用冻结（未实现，v0.4 登记）/L4 proactive（挂起保持）。

## P6-A 测绘后追加裁定（2026-11-16）

- 补丁集收敛：surgical hunks ≈270 行（11 文件全实锚）+ drop-in 1466 行（guard-observe×2/cache-guardian/cache-metrics/l3）；return-cap 链闭包过大（≥7 文件）→ **v0.3 二期**；5 项卡面条目官方 rc.3 已原生等价（残余≈0）；pi-ai 1.3.0 对官方零补丁；model-slots fork 包 1065 行→12 行公式内联替代。
- asar 选型 γ=全内联（新增 asar 条目=0，规避头手术）。
- **guardObserve 点火裁定（用户"完整功能生效"授权）**：补丁把 config 默认翻为 true（观测链通电，observe-only 无拦截——拦截半边任何树均未实现，不虚构）。plugin 侧消费 guard-observe 事件。
- 工作量级 M（P6-A RES-port-feasibility.md 230 行，SHA-256 51576435…）。
