# REVIEW-P6D2E — P6-D2 + P6-E 合并前评审（merged pre-merge review）

- FROM: reviewer-P6D2E（独立 subagent） TO: 主线（synthesizer/合并执行）
- MODE: verify（合并前评审 + 评分）
- TASK_REF: tasks/ZCTX/cards/P6D2-face-diagnosis.md + tasks/ZCTX/cards/P6E-autofold.md；分支 feat/ZCTX-P6E @ a2503af
- 日期: 2026-11-16 · 评审人 ≠ 作者（作者 coder-p6d2 / coder-p6e）

## 0. 裁决速览

| 块 | 范围（提交） | 总分 | [阻断] | [建议] | 结论 |
|---|---|---:|---:|---:|---|
| P6-D2 | e34b6a7 / afc826f / ecafe64 / 3083ced | **100** | 0 | 2（R1/R5） | 通过，放行中间合入 |
| P6-E | c7c75c3 / 36178af / ae779a4 / a2503af | **99** | 0 | 3（R2/R3/R4） | 通过，放行中间合入 |

两块均 ≥98 → **合并建议：放行**（main 进 `--no-ff` 合并按 merge-batch-protocol；评分文件与本 handoff 由主线入库）。[建议] 5 条（R1-R5）不阻塞中间合入，**阻塞最终验收**：每条须落 closure.json 取得唯一 disposition（fixed / user_approved_deferred / duplicate / not_applicable），存在 OPEN 即不得宣称最终验收完成。

## 1. 亲验记录（评审人自己跑的命令与输出）

1. `npm test`（= tsdown && vitest run）→ **Test Files 27 passed, Tests 589/589 passed, EXIT 0**；构建后 `git status --porcelain` = 0（确定性构建与入库 lib 全等，Z19 成立）。
2. `npx tsc --noEmit` → 0 错。
3. 五探针全 PASS：probe-artifact 6 / probe-host-imports 16 / probe-real-mount 5 / smoke-real-loader 3 / verify-activation-surface 11（A11 17 断言亲见 PASS 行）；两探针报告 timestamp-only diff 亲读后 `git checkout --` 还原，树归零。
4. switch-group.mjs 修复机械回归三态（评审人 node 直跑 live 版两正则）：
   - T1 旧 dump 形态（`name:` 行隔断 id 与 config）→ 新 enabledFalse 正则判 **true** ✓
   - T2 注释头 + 两份 zctx 块文件 → 全局移除后 `- id: dsh-zcontext` 计数 **0**，注释与其余行完好 ✓
   - T3 净文件（无 zctx 块）→ replace 后逐字节相同（no-op）✓
5. 组态核验：`grep -c zcontext /c/Users/ZS/.dsh/profiles/desktop/cordis.patch.yml` = **0**（桌面零触碰）；bench `cordis.patch.yml` grep `dsh-zcontext` = 0 行且 `contextWindow: 40000` = 0（disarm 终态）；备份件 del/20261116-122206-p6d2-diag-prechange/bench-cordis.patch.yml grep `- id: dsh-zcontext` = **2**（双份残留实存）。
6. lib/装件全等：仓内 lib/index.js 与 bench profile node_modules 内 lib/index.js SHA-256 同为 `f7c5f276c70432a5…`。
7. closure 机器数（node 遍历 closure.json）：**128 项，OPEN=0**——fixed/verified 120 · duplicate/closed 3 · duplicate/verified 1 · uad/closed 2 · uad/verified 1 · not_applicable/verified 1。P6E-4（duplicate/verified/post-merge）指向真实既有条目 W3-R2（validator check-a 可达域不变量，commit b6f359c 文档化路线）→ duplicate 合规。
8. **折叠实证独立重放（评审人自有脚本，非作者脚本）**：从 `reports/bench/raw/p6e-autofold-session-e98c4f6f.jsonl` 取 seq<297 事件 → FoldStore.attach+resync → 表面 80 节点 / 12769 tokens（与 BENCH §12.1 逐字一致）→ `selectFoldSpans(maxBatch 4, window 40000, minFoldableTokens 5000, maxFoldFraction 0.6)` → **唯一候选 [{startSeq:9,endSeq:202,foldedTokens:5471}]** 与运行时提交逐字一致；折后表面 91 节点 → 0 候选（覆盖边界复现）。
9. session log seq 297 直读：`source: {"kind":"zctx-fold","foldId":"f297","tokensBefore":5471,"tokensAfter":864}`；时间 1794864327102 ms = 2026-11-16T21:25:27.102Z 与 evidence json commitTime 全等；`tool/call` 全量扫描 = pwsh 20 / edit 14 / read 13 / write 1，**0 个 zctx_***；session log 有 20 条 session/title-llm-request 而 **0 条** compaction 摘要请求事件（purpose 调用不入 session log 的一手事件流证据）。
10. summary-p6e-autofold.jsonl tails：turns 11-20 每轮 2 条 `autoFold judge … → HIT (hit line 26421)`（turn 20 为 1 条 judge + 1 run），首条 estimate 28859 与 BENCH §12.1 表一致；turn 20 `compaction/end error "summarization truncated at the token cap"` 与 §12.2 fail-open 叙述一致。

## 2. R3 变体裁定（攻击方向 2，裁定：成立）

1. **官方 purpose 闭联集**：`zDSH-main/packages/llm/llm/src/types.ts:552` `purpose?: 'compaction' | 'session-title'`——插件只传官方值（autofold.ts:407）。
2. **官方先例全文**：`compaction-basic/src/summarizer.ts:120-181`——`ctx.llm.stream(options)` 一次性直呼、`purpose:'compaction'`（:160）、`sessionId` 传递（:159）、finish 分类 fail-closed（finishError:197-211：error/aborted→LlmError、max-tokens→truncated error）。插件 createCompactionSupply 的 finish 处理与官方一一对应（autofold.ts:445-455，含官方 max-tokens 摘要截断=不可用摘要有钉 autofold.spec:418）。
3. **三监听透明性**：matchesMainChain `if (options.purpose !== undefined) return undefined`（observe.ts:246），preflight（preflight.ts:482）/observe（observe.ts:323）/autofold（autofold.ts:1214）三监听共用——摘要调用对三面全部不可见，递归结构性排除；另有 WeakSet 再入守卫（autofold.ts:1221）。
4. **与 R3 no-go 的形态区别**：R3 no-go = adapter 在自身 dispatch 内再调 ctx.llm.stream（同 provider 无限递归）；本波 = waterfall listener 在 `next()` 之前顺序单发摘要调用，不处于 adapter dispatch 栈内。cordis waterfall 语义（llm/src/index.ts:76-78 `@mode waterfall`）注册序=外→内，enforce 优先级声明（外层短路先于本面）成立。
5. **实证背书**：f297 真实提交 + 20 轮运行无递归失控（每轮恰好 2 次 judge + 至多 1 次链），billedInput 数字正常。

## 3. 攻击方向逐条结果

| # | 攻击方向 | 结果 | 关键证据 |
|---|---|---|---|
| 1 | P6-D2 根因/修复/桌面只读 | 全部证实 | §1.4-1.5（备份双块=2、dump 753-756 行、diag1:10 决定性行、桌面 grep=0）；模型证词/callprobe/sysprompt 为原始 stdout 事件流且内部数字自洽（10731/40000=26.8%） |
| 2 | R3 变体 | **成立** | §2 全套官方源锚点 |
| 3 | 触发与选区算术 | 正确且保守向 | judgeEstimate 复用（preflight.ts:327-348 window undefined→pass-through→hit 必有窗→cap 必定义）；pairStructure 双向边界检查（autofold.ts:252-256）+ fail-closed（:320）；选区每步对着 validator 既有门预演，bc projectUnit 差异=宁可 no-qualified-span 不硬折（turns 11-13/15-19 实证） |
| 4 | 三供给 | 与 F2.15-F2.17/externalSummary 对应成立 | compaction=官方形态；external URL 仅来自 config（操作者信任边界，模型不可控）、Bearer 走 env 名间接、120s 超时、JSON.stringify body 无注入面；digest 确定性有钉、拒收→诚实 abort（autofold.ts:888-900） |
| 5 | 退化链 F2.9-F2.14 | 逐条成立 | 重试≤2/全局4、deterministic-empty 不原地重试+sticky 3+canary 每 run 一次、halving pair-safe 中点+地板、净缩 1.05 预检同单位（estimateTokens chars/3）+validator 自门双保险、预算 16/4/32K——37 钉逐条 F 编号 |
| 6 | 防反馈环 | 结构性成立+实证 | purpose 豁免三监听（§2.3）；摘要调用不入 session log（一手事件流，§1.9）；onFoldCommitted→lastPressure.delete（plugin.ts:1024-1027）；fold 后 billedInput 205893→50701（turn 14→15）与 estimate 回落互洽 |
| 7 | 折叠实证真实性 | **四方证据互洽，评审人独立复跑成立** | §1.8-1.9；「净省 4607 tokens / −84%」= 5471→864 算术自洽 |
| 8 | 亲验 | 全绿 | §1.1-1.6（589/589 + tsc 0 + 五探针 6/16/5/3/11 + 树净 + 装件全等 + closure 128 OPEN=0） |

## 4. [阻断] 清单

无。两块均无阻断项。

## 5. [建议] 清单（不阻塞中间合入；阻塞最终验收）

| ID | 位置 | 问题 | 建议修法 | 建议 disposition |
|---|---|---|---|---|
| P6D2E-R1 | closure.json BENCH-L5 + BENCH §11.3/§11.4 | disposition=user_approved_deferred 但条目自述 approval pending（§11.1 uad 须用户真实批准） | 下一插件域波卡开工时向用户显式请求 defer 批准并回填批准记录（消息 ID/原话）到 evidence；`-Phase all` 前必须补批准或改判 | 待主线落账（fixed=补批准 / uad=真实批准） |
| P6D2E-R2 | BENCH §12.1 证据栏 + reports/bench/harness/ | 离线重放脚本与输出未归档（结论只在 progress.md 文字）；本评审已独立复现代偿 | 重放脚本落 reports/bench/harness/replay-f297.mjs 并在 §12.1 指向；或以本 handoff §1.8 复现记录为准补记 | fixed（脚本入库）优先；否则 uad 须批准 |
| P6D2E-R3 | autofold.ts:529-544 + plugin.ts external 门 | apiKeyEnv 已配但环境变量缺失 → 静默无凭据请求（仅靠远端 401 显形），与响亮纪律不完全对齐 | wire 时 warn（不 fail-skip，缺凭据走退化链合法） | fixed 或 not_applicable（须论证） |
| P6D2E-R4a | autofold.ts:883 + texts.ts:253 | 净缩拒收分类依赖渲染模板子串 'tolerance must exceed'——texts 措辞变更会静默把 halving 降级为 abort | 结构化 reason code 或导出可匹配常量 + 防回归钉 | fixed |
| P6D2E-R4b | progress.md:160 | 『leftover-ledger 登记』措辞与载体不符（仓内无 leftover-ledger.md，实际=closure.json P6E-4） | 改措辞或收口建 ledger 文件 | fixed（一行措辞） |
| P6D2E-R5 | reports/bench/harness/switch-group.mjs（归档件） | 归档的是修复前缺陷版本且文件头无标注，单读易误认现行工具 | 头部加 pre-fix 证据件标注 + live 修复件位置指针 | fixed 或 not_applicable（P6D2-H1 已文字说明） |

## 6. 过程记事（如实，不静默）

1. **diff 体量纪律**：P6-D2 业务代码约 135 行（其余为证据归档/台账）；P6-E 业务代码约 1448 行 + 测试钉 1105 行，超 600 行纪律线。处理=按卡面既定的两块拆分（各自成卡、各自评分），autofold.ts 为单引擎模块不可再拆，且协调者简报明确合并评审指令——偏差如实记录于此，未静默。
2. **提交计数出入**：协调者简报称「6 提交未评」但列出 8 笔哈希（P6-D2 四笔 + P6-E 四笔）——本评审按 8 笔全数评审。
3. 落盘：本文件 + scorecards/P6D2.json（100）+ scorecards/P6E.json（99）由评审人写入（落盘纪律允许的审查路径）；业务代码/测试/配置零改动（全程 git status 归零核验）；**三个评审文件未提交**——入库提交归主线（沿用 b52ad26 式 chore 评审件入库先例）。
4. ARTIFACTS：tasks/ZCTX/scorecards/P6D2.json、tasks/ZCTX/scorecards/P6E.json、tasks/ZCTX/handoffs/REVIEW-P6D2E.md（SHA-256 由主线入库时回录）；评审复现脚本（临时区，未入库）：C:\Users\ZS\AppData\Local\Temp\zctx-p6d2e-review\replay-select.mjs。
5. CHECKPOINT：评审波次本身不推进任务 checkpoint（P6-E checkpoint 已 terminal，next=本评审）；本文件即评审波次的落盘收据。
