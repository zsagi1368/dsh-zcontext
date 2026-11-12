# REVIEW-W5.md — W5 收尾波验收（文档+验证+发布准备）

FROM: reviewer-R2 (independent subagent, reviewer ≠ coder)
TO: 主线 (orchestrator) → synthesizer
MODE: verify (通过)
TASK_REF: CARD W5-docs-verify.md · 提交区间 d5c5ceb..e5a5b58
DATE: 2026-11-12
ARTIFACTS: tasks/ZCTX/scorecards/W5.json / 本文件

## 结论

**总分 100 ≥ 98 → 通过，交 synthesizer 收口**（merge/tag/台账 per §15）。[阻断] 0，[建议] 0；两条零处置要求的观察项见文末。

## 亲验矩阵（reviewer 全部亲跑，非转录）

| 验收项 | 命令 | 结果 |
|---|---|---|
| A4 激活面断言集 | `node scripts/verify-activation-surface.mjs` | **8 PASS, 0 FAIL, EXIT=0** |
| 产物探针 | `node scripts/probe-artifact.mjs` | 5 PASS 0 SKIP 0 FAIL（A8 子断言独立复跑亦 exit 0） |
| A6 真机冒烟 | `node scripts/smoke-real-loader.mjs` | **2 PASS, 0 SKIP, 0 FAIL, EXIT=0** |
| 三绿 | build / lint / test | ✔ / 零错 / **193/193, 0 skipped** |
| 产物一致性 | 重建后 `git status` | 干净（入库 lib 与重建字节一致） |

## 1) A4 断言集 8 组逐组核验

- **A1 Z3**：lib/index.js=118986B + lib/index.d.ts=43323B 在盘且 `git ls-tree` 含 lib 三件 — git 形安装永不构建的前提被机械钉住。
- **A2 安装门**：dsh.bundle.patch ./cordis.patch.yml + manifestVersion 1 + **无 prepare/preinstall/postinstall/install 生命周期脚本** + 无 dsh.client + peerDeps cordis>=4 + engines 下限 + main/types 钉 lib（7 子项）。
- **A3 Z7**：import lib → default===ZcontextPlugin、name==='dsh-zcontext'、Config['~standard'].validate 在、四工具名经 defineTool 面 [zctx_fold, zctx_unfold, zctx_recall, zctx_status]。
- **A4 patch**：逐行解析 `- insert:` → `- id: dsh-zcontext` → `name: dsh-zcontext`（insert@line5/id@line6）；与官方 `packages/bundle/base/cordis.patch.yml` 的 `- insert:` 行语法亲核一致（无内联 config，默认值在 static Config——与官方"patch 整行替换"语义相容）。
- **A5 markers**：lib 含 `zctx-fold`/`zctx-unfold`/`required` 特征串。
- **A6 S8**：**剥注释后** codeTextClean=true + 运行期构造四工具 offenders=0 双口径（Z17 修法落地，scripts/verify-activation-surface.mjs:160-181 可指认）。
- **A7 B2**：真实构建插件经能力探测 ctx 构造 → contexts=1, required=true, name=zctx-nudge。
- **A8**：probe-artifact.mjs 作为子断言复用（非重实现），exit 0。

## 2) A6 真件三连独立复跑

- **R1 真 loader**：`packages/boot/app-boot/lib/index.js`（在盘亲核，loadOverlayPatches/composeEntries 导出在）解析本仓 cordis.patch.yml → composed=[{id:dsh-zcontext,name:dsh-zcontext}] — 真 parser/composer，非模拟。
- **R2 真 CLI**：`apps/cli/lib/bin.js`（--dump-config 面在 bin 中出现 8 处亲核）`--profile web --patch <本仓> --dump-config`：组合树含我行且为**最后一层**（composedLayer=true lastLayer=true）；**负对照**（无 patch dump 不含 dsh-zcontext）=true——证明该行来自本仓 patch 而非宿主预存；行数 1237/1234（+3=插入层块）。
- **P5 真 session 投影钉**（probe-artifact 组 5）：真实官方 session foldProjection/unfoldProjection=true — W3-1 修复的投影契约持续被钉。
- 清理安全：一次性 DSH_HOME 为 mkdtempSync 建、删除前双前缀条件守护（自建自收不变式以代码固化）。
- 完整安装冒烟（真 `dsh plugin add` 入活跃 profile + 完整启动挂载）按方案门 plan §2 A6 行预授权登记为 post-merge 步骤（见 §5）。

## 3) 双语 README 逐节机械核对

- **锚点 12/12**：en/zh 显式锚点集合完全一致（clean-room/how-it-works/install/the-four-tools/the-zctx-command/relation-to-official-compaction/settings/behavior-notes/limitations/security/acknowledgments/development），TOC 链接一一对应零悬坠。
- **设置表 9/9**：双语 9 行字段/类型/默认值与 src/config.ts configDefaults **逐字段一致**（enabled=true, nudgeThresholds="25,50,75,90", keepRecentTokens=0, maxFoldFraction=0.6, minFoldableTokens=5000, protectionFloorTokens=5000, summaryFloorChars=50, summaryCeilingChars=20000, netShrinkTolerance=1.05）。
- **四工具名**双语在位且参数形态真实。
- **三件行为说明**实质正确并经官方源亲核：
  1. PTC 直呼受限 = UNKNOWN_TOOL — 官方亲核：`core/tools/src/index.ts:345-348`（"mode: 'ptc' 下无 parent 的模型直调在策略管线前被拒为 UNKNOWN_TOOL"）+ :504-522 ToolNotFoundError。README 措辞与官方机制精确相符。
  2. required:true — 存活语义 + 跨越计次诚实边界（并非永挂线缆）。
  3. unfold 单节点语义代价 — 原始轮次不以独立消息回到表面、日志永久保留、recall 可搜；"测试里有断言钉住它"属实（fold-engine.spec.ts B1 断言）。
- **净室声明与致谢**：billion-context（MIT）机制灵感致谢 + "未复制任何代码/提示词原文/压缩规则措辞" + 我方 CCM 研究归属，双语在位；zh 为原创中文独立成文（非机翻镜像）。
- **Limitations** 已同步 W3-2 修订（跨 checkpoint 吸收边界对齐）+ 模型采用率依赖 + 无线缆级兜底（官方 compaction 硬底）+ 单会话范围。

## 4) SECURITY.md 与 CHANGELOG

- **SECURITY.md**：威胁模型（本地离线、三信任边界、资产表）+ 零网络/零遥测/数据本地承诺 + 模型伪造防御六层——逐条与实现对应（原生回执=tools.ts output.render；服务端验证=validator a-g；官方通道=Session.append；compaction 互斥=store.compactionActive；exclusive barrier=A6 组实证；宽容解析严格提交=parseFoldContent 拒收路径测试）。**零网络承诺经代码扫描佐证**：src/+lib/index.js 无 node:http/https/net/dns/tls/fetch/WebSocket 命中。
- **CHANGELOG 0.1.0**：Added 十项 + Behavior 三条 + Limitations 四条 + Security 一条，逐条与实现/closure 证据对应；"message.source kinds"措辞指消息的 source 成员，与裸 UserMessage 形态一致。

## 5) closure 台账 24 条机器计数核对

- node 计数：**24 条**（phase block=23 / post-merge=1；disposition fixed=23 / user_approved_deferred=1；status verified=23 / open=1）。id 枚举：W2-F1..F5, W3-S1/S2, W4-S1..S3, W3W4-RSI, W3-R1/R2, W4-R1..R4, W5-S1/S2/S3/S5, W5-A6-INSTALL, W5-RSI, W5-GOV — 与各波验收口径一致。
- **W5-A6-INSTALL 合规性**：disposition=user_approved_deferred / status=open / phase=post-merge / **owner=mainline / trigger=用户桌面环境可跑完整 harness+发布后一周 / reviewDate=2026-11-19**（今 11-12，窗口成立）/ evidence 引用方案门 plan §2 A6 行预授权（ZCTX-plan.md:27 原文含同款四要素）——字段齐全；post-merge 用于验证步骤而非实现块缺陷（§11 允许）；授权基础=方案门预授权。**合规**。
- 台账范围注记：自 W2 起建立（W1 验收由 R1 scorecard 覆盖，无 OPEN 项声明），非 W5 缺口。

## 6) RSI Z17 质量

高质量新坑：现象真实（A6 组首轮假红——tsdown 保留源注释致全文 includes 命中）、根因准确（"源文件有注释提到 X ≠ 产物代码声明了 X"；断言口径=文本面 vs 约束语义=代码面错位）、修法已实现（剥块/行注释再扫 + 运行期 offenders=0 双口径同组明细）、防复发两项具体可执行。`~/.agents/rsi/INDEX.md:140` W5 行与 reviewer 亲跑输出交叉一致（含开工查册命中 Z13/Z14/A14/A25 未复燃、del 备份 2 处）。

## 评分

| 维度 | 分 | 依据 |
|---|---:|---|
| 正确性 | 25 | 四件探针全绿亲跑；README 行为声明经官方源亲核；零网络扫描零命中；负对照设计正确 |
| 完整性 | 20 | 卡面 6 项产物全交付；LICENSE 在盘；Z17 收口；checkpoint 终态连贯 |
| 一致性 | 20 | 锚点 12/12、设置 9/9==configDefaults、四工具名、行为说明与实现零漂移、patch 语法与官方一致 |
| 可验证性 | 15 | 每个声明可复现；无 grep 全 node 直读；Z17 修法可指认；closure 机器核对 |
| 安全回滚 | 10 | del 备份 2 处在位；DSH_HOME 自建自收守护代码化；无凭证/网络面 |
| 可维护性 | 10 | 探针互为常驻回归资产；文档与代码演进同步（W3-2 已反映）；收口路径明确 |
| **总分** | **100** | ≥98 → 通过 |

## 观察项（零处置要求，非 [阻断]/[建议]）

1. closure 台账无 W1 波条目——台账自 W2 起，W1 由 R1 scorecard 覆盖，范围注记。
2. R2 负对照行数差 +3 恰为插入层块大小，明细自洽。

CHECKPOINT: W5.json + 本文件落盘；两处均属允许写入路径。剩余动作 = synthesizer 收口（merge/tag/台账）+ 2026-11-19 复核 W5-A6-INSTALL post-merge 条目。
