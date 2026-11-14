# AUD-verification-replay — 全量验证重放 + 四真缺陷复现确认（全量审计令 E）

- TASK_ID: ZCTX-AUD-E · card: tasks/ZCTX/cards/CARD-AUD-E-verify-replay.md · 执行人：tester（评审人 ≠ 作者）
- 日期：2026-11-14 · 基线：commit 391990f（`git status`：src/ tests/ 零改动；工作区差异仅为审计件本身——.gitignore +1 行 `.codegraph/` 与未跟踪 reports/tasks 件）
- 输入：reports/audits/AUD-state-machines.md（D1，SM-01/SM-02）+ reports/audits/AUD-host-faces.md（D2，HF-01/HF-02）
- 纪律：仓内只读（零文件修改）；全部复现脚本位于仓外 `C:\Users\ZS\AppData\Local\Temp\zctx-aud-e-repro\`（不随本报告归档时不可复跑——按卡面要求脚本不入库，结论以本报告记录的输出为准）
- 开工查册：~/.agents/rsi/INDEX.md + ZDSH-LESSONS.md 首查；命中并转为检查项：Z19（build 先于 vitest 的顺序 + 新鲜度口径）、Z20（file: URL 一律 fileURLToPath/pathToFileURL，Windows 盘符）、Z21（inject 键 PENDING 语义与显式 super(ctx,name) 桩形态）、Z22（行尾假动 awareness）、Z10（断言逐行锚定 awareness）。无新坑入册（RSI 收口见文末）。

---

## §1 全量电池重放（基线 391990f，Z19 顺序：build → vitest → tsc → 五探针）

| 步骤 | 命令 | 结果 | exit |
|---|---|---|---|
| build | `npm run build`（tsdown） | 7 files total 992.98 kB（index.js 273.87 + index.js.map 534.51 + map-CtcwvEir.js 18.48 + 其 map 43.07 + twins 0.94 + 其 map 2.39 + index.d.ts 119.71） | 0 |
| vitest | `npm test`（vitest run） | **429/429 passed，22 test files**，Duration 1.28s | 0 |
| tsc | `npx tsc --noEmit` | 零输出（0 错误） | 0 |
| probe-artifact | `node scripts/probe-artifact.mjs` | 6 PASS, 0 SKIP, 0 FAIL（P3 S8 四工具无 isConcurrencySafe / P4 端到端 fold+status / P5 真实 session 投影+W3-2 拒收钉 surface=[0,4,2] cp=3 / P6 adapter 出口面） | 0 |
| verify-activation-surface | `node scripts/verify-activation-surface.mjs` | 10 PASS, 0 FAIL（A7 nudge required:true / A8 子进程复跑 probe-artifact / A9 config 面 observe 默认+providers[] / A10 14 项 adapter-face/R4/R7 断言 maxRetries sites=1） | 0 |
| smoke-real-loader | `node scripts/smoke-real-loader.mjs` | 3 PASS, 0 SKIP, 0 FAIL（R1 cordis.patch.yml 真装载解析 / R2 CLI dump-config 合成+负控 lines=1237/1234 / R3 七行 provider 组合） | 0 |
| probe-host-imports | `node scripts/probe-host-imports.mjs` | 16 PASS, 0 SKIP, 0 FAIL（G3 attributionHeaders 拼写钉 / G4 callConfigEquals 活语义 + CONTEXT_WINDOW_EXCEEDED_CODE 字面量） | 0 |
| probe-real-mount | `node scripts/probe-real-mount.mjs` | 5 PASS, 0 SKIP, 0 FAIL（G2 device-failure 负控 / G3 真实挂载全访问点 tools=4 sections=1 contexts=1 commands=1 llm/stream=2 / G4 adapter 面 routes=zctx-anthropic-messages） | 0 |

### 与各波自报数字对账（逐项核对 tasks/ZCTX/progress.md:79 P0 终态电池自报）

| 数字 | 各波自报 | 本次重放 | 判定 |
|---|---|---|---|
| vitest 用例数 | 429/429（424 基线 + 5 负例） | 429/429（22 文件） | ✓ 一致 |
| build 产物 | 992.98 kB 7 files | 992.98 kB 7 files（分项尺寸逐项同量级） | ✓ 一致 |
| tsc | 0 错（P0 用 `--force`；本波按卡面用 `--noEmit`） | 0 错 | ✓ 一致 |
| probe-artifact | 6/6 | 6/6 | ✓ 一致 |
| verify-activation-surface | 10/10 | 10/10 | ✓ 一致 |
| smoke-real-loader | 3/3 | 3/3 | ✓ 一致 |
| probe-host-imports | 16/16 | 16/16 | ✓ 一致 |
| probe-real-mount | 5/5 | 5/5 | ✓ 一致 |

**电池结论：全绿，与全部波次自报数字一致，无漂移。** 附注（透明）：probe-host-imports 自身按既有行为把报告写至 reports/probes/U2-host-imports.md——属探针脚本自有的落盘行为（历史波次同样如此），非本次审计对仓内文件的编辑。

## §2 新鲜度守卫（Z19 口径）

- build 时间戳：build start epoch = 1794676875（2026-11-14 09:21 前后，lib/index.js mtime 09:21:17.16）。
- src 最近提交：b289f04「P0 评审件入库…」中 src 触改时间 epoch = 1794670924（2026-11-14 07:42:04 -0800）。
- 判据①：build start > src last commit（1794676875 > 1794670924，差 5951s）→ **产物晚于最后一次 src 变更**。
- 判据②：`git status --porcelain src/ tests/` 空 → 无未提交 src 漂移；`find src -newer <build-start-marker>` 零命中 → 构建后无源文件再动。
- 判据③：vitest 在 build 之后运行（Z19 顺序）→ 契约钉吃的是新鲜产物，无 stale 假绿。
- **新鲜度守卫：PASS**。本报告全部测试与复现证据均在新鲜产物上取得。

## §3 四真缺陷复现确认（每条：复现成功=确认 / 复现失败=误诊）

**总判定：四条全部复现成功，无一误诊。全部维持真缺陷分级，进入 P3 修复清单。**

### SM-01 applyEvent 无幂等守卫 → **复现成功，真缺陷确认**

- 脚本：`repro-sm01-duplicate.mjs`（仓外；导入仓内 lib/index.js 的 FoldStore，最小 session 桩仅含 `seq` getter + `eventAt`，事件形状对照 tests/store.spec.ts:18-36 fixture）。exit 0，**5/5 REPRO**：
  - A **fold 复活**：seq0 user → seq1 fold f1 → seq2 unfold f1（attach 后 status='unfolded'）→ 重投 seq1 → status 回到 'active'，foldMap 0→1（已 unfold 的 fold 复活进 active 视图，D1 §1 攻击序列 1 逐字成立）。
  - B **compaction 括号重开**：start0 → end1 → 重投 seq0 → `compactionActive()` false→true（互斥锁复活；此后引擎拒收 fold/unfold 的功能级 DoS 面成立）。
  - C **计数膨胀**：单条 assistant/message（带 usage）真投两次 → usageSnapshot().samples 1→2、measuredSamples 1→2、threeState.measured 双计。
  - D **lastSeq 回退级联**：两条 assistant 投递后重投 seq0（syncedToSeq 2→1）→ 新事件 seq2 到达触发 scanUpTo → seq1 被 eventAt 重读二次 applyEvent → **3 条真实事件最终计成 5 条 usage 记录**（腐败自我放大，D1 §1 攻击序列 4 成立）。
  - E **单调性破坏**：重投 seq0 直接把 syncedToSeq 2→1（lastSeq 无条件赋值，store.ts:908）。
- 顺带证实 D1 的「测试误标」：store.spec.ts:289「duplicate delivery as a no-op」里 `onEvent` 只被调用**一次**（attach 时 session 尚空，显式 onEvent 即唯一投递），samples===1 通过制造了已覆盖假象；场景 C 证明若真投第二次 samples 即 2。D1 误标论成立。
- 位置核对（实读）：store.ts:905-908（applyEvent 无条件 `eventsBySeq.set/push/lastSeq=`）、store.ts:630-642（onEvent 对 `seq<=syncedToSeq` 不拦直接 applyEvent）——与 D1 引用一致。

### SM-02 畸形 checkpoint source 打断 zctx_status → **复现成功，真缺陷确认**

- 脚本：`repro-sm02-infinity.mjs`（仓外；FoldStore + fold 事件 source.tokensBefore 投毒 + 首 post-fold M）。exit 0，**4/4 REPRO**：
  - 对照组：tokensBefore=100 同序列 → 快照正常产出 breakevenTable[0].quality='strong'（harness 健康）。
  - **tokensBefore=Infinity**：摄入放行（entry.tokensBefore 原样 =Infinity，store.ts:289-290 只验 typeof）→ `observabilitySnapshot()` throw `TypeError: breakeven.folded.tokens must be a finite non-negative integer, got Infinity`。
  - **NaN / -1**：同型 throw（got NaN / got -1）——SM-11 建议的三态全部命中。
  - 归因前提按 D1 声明成立：fold 需 strong/retry 归因才进 breakeven 表（fold 与 M 间零事件 → chainComplete → strong），投毒后**每次 status 调用都抛且不可自愈**（事件在会话日志中永久存续）。
- 渲染路径（实读静态链）：tools.ts:731 `const snapshot = store.observabilitySnapshot()` 无 try 包裹；tools.ts:998-1003 zctx_status execute 直接返回 renderStatus → **工具执行抛错**，违背 store.ts:146-147「honest ledger, no throwing」自述。
- 位置核对：store.ts:969-970 `tokensBefore: checkpoint.tokensBefore ?? 0`（`??` 不拦非 null 非有限值）；budget.ts:90-94 assertAmount 对 `!Number.isFinite` throw TypeError——与 D1 引用一致。对照组 strong 行同时证明：投毒不是「快照对一切 fold 都抛」，而是**恰好污染进 fold 账目**的精准打击面。

### HF-01 图片静默降级 → **复现成功，真缺陷确认**

- 脚本：`repro-hf01-image.mjs`（仓外；导入 zDSH-main 官方 llm **built lib**（lib/index.js：projectImagesForTextModel/contentHasImage/LlmError 均为官方实现）+ 仓内 createZctxAdapterClass，构造真实 adapter 实例做端到端差分）。exit 0，**7/7 REPRO**：
  - ① zctx adapter 面对外宣称 `inputModalities:["text"]`（`listModels` 动态实测，zctx-adapter.ts:263 恒值）。
  - ② 官方投影器对带图消息实测：contentHasImage true→false，blocks=["text","text"]；**占位文本逐字捕获**：`"[image omitted because this model accepts text only; attachment sha256:ed]"`（模型实际所见）。
  - ③a 未投影带图消息 → 真实 adapter 抛 `UNSUPPORTED_CONTENT`（拒图门本身有效——门只在直呼路径可达）。
  - ③b 官方投影后的同一消息 → **门不触发**，请求越过拒图门继续走（第一站 loadApi stub → UNSUPPORTED_OPTION，已过门）——官方派发路径（llm/src/index.ts:1088-1093 dispatch 前投影）上 UNSUPPORTED_CONTENT 不可达。
  - ④ 合成结论：用户图片被占位文本替代上线，无任何失败信号——与 zctx-adapter.ts:354-361 声明的「诚实拒绝（UNSUPPORTED_CONTENT）」契约相反，D2 静默劣化判定成立。
- 差分设计说明：③a/③b 同一 adapter、同一消息内容，唯一变量是「是否经过官方投影」——错误码 UNSUPPORTED_CONTENT vs 非 UNSUPPORTED_CONTENT 的差异即门的可达性差异，端到端且无需 mock host 面语义（host 面直接用官方 LlmError/contentHasImage）。

### HF-02 sessions 键声明未读、缺席即静默 PENDING → **复现成功，真缺陷确认**

- 脚本：`repro-hf02-sessions-pending.mjs`（仓外；zDSH-main vendored cordis 4.0.5-alpha.1 真实容器 + 官方 provider 拓扑桩，桩显式 `super(ctx,'<name>')`——Z21 防复发行在位）。exit 0，**3/3 REPRO**：
  - 步 1：五键（tools/systemPrompt/commands/llm/tokenMeter）在、**sessions 缺席** → 3s 窗口内 `root.reflect.get('dsh-zcontext', true)` 恒 undefined，session feed listeners=0——**整个插件未构造，静默 PENDING，无任何错误**（Z21 症状形态）。
  - 步 2：向**同一容器**补上 SessionsStub → 插件立即激活（tools=4, commands=1）——**唯一阻塞键被隔离为 'sessions'**，因果闭合。
  - 步 3：正对照——六键齐全的全新容器正常激活（与 probe-real-mount G3 口径一致，排除 harness 假阳）。
- grep 独立复核：`grep -rn "ctx\.sessions|\.sessions\b" src/` 零命中（本次会话独立执行，非转抄 D2）；plugin.ts:224 `static inject: string[] = [... 'sessions']` 实读确认 → **声明而零消费的硬依赖**，与 P0 read-verified 纪律（注释自述「a wrong key means the plugin stays silently PENDING」）不一致。D2 判定成立。

## §4 复现过程诚实记录（含一次 harness 自纠）

- 本次共 1 次 harness 缺陷自纠，**不构成误诊**：SM-02 首跑 NaN 行判 NO-REPRO，根因是复现脚本自身用 `ingested === poison` 判 NaN（NaN !== NaN 恒假）；输出明细 `throw=TypeError: ... got NaN` 当时即已显示缺陷行为发生。改为 `Number.isNaN` 判型后 4/4 全 REPRO（Z10/Z18 口径：NaN 等值断言必须判型）。缺陷行为自始至终稳定复现，脚本 bug 与被测实现无关。
- D1/D2 的其余引用行号抽查（store.ts:863-869 互斥、tools.ts:731、plugin.ts:224、zctx-adapter.ts:263、官方 index.ts:1088-1093、官方 content.ts:335-344 replaceImagesForTextModel 纯占位替换不抛错）本次实读全部对上——未发现引用失实。

## §5 结论与移交

1. **电池重放**：8/8 步全绿，与全部波次自报逐项一致（429 用例、992.98 kB 产物、五探针 6/10/3/16/5）——基线健康，P3 修复清单的「当前态」描述可信。
2. **四真缺陷**：SM-01 / SM-02 / HF-01 / HF-02 全部复现确认，**无一误诊**；按 tester 分级口径：SM-01=主流程状态机可被重复投递腐败（宿主 feed 违约/mock 直注可达）建议 P1~P2；SM-02=单事件永久打断 zctx_status（用户可见功能打断）P2；HF-01=用户可见静默质量劣化（非崩溃）P2；HF-02=部署面静默 PENDING 风险（官方宿主恒提供 sessions 故现实可达性低，但违反声明纪律）P2~P3。分级供 P3 清单登记时参照，最终分级权在主线。
3. **移交 P3 清单**：四条修复建议均按 D1/D2 原文执行即可（SM-01 幂等守卫+真重复投递钉测；SM-02 Number.isFinite 对齐 extractUsageRecord 孪生+fail-soft 兜底；HF-01 文档降级或可观察性补齐；HF-02 移除或正当化 'sessions'）。每条登记时标注「AUD-E 已复现确认 + 本报告节号」作为 disposition 证据。
4. **RSI 收口**：无新坑。查册命中条目（Z19/Z20/Z21/Z22/Z10）全部转化为执行检查项并实际生效（Z19 顺序执行、Z20 fileURLToPath 零踩坑、Z21 桩形态直接复用）；一次 harness NaN 判型自纠已被 Z10/Z18 既有条目覆盖，无需新条目。`no-new-lesson`（既有条目覆盖充分）。

## 附：证据索引

- 重放命令与输出：见 §1 表（全部命令在仓根执行，exit code 逐项记录）。
- 复现脚本（仓外，不入库）：`C:\Users\ZS\AppData\Local\Temp\zctx-aud-e-repro\repro-sm01-duplicate.mjs`、`repro-sm02-infinity.mjs`、`repro-hf01-image.mjs`、`repro-hf02-sessions-pending.mjs`（每个脚本 exit 0=复现成功；本波四脚本全部 exit 0）。
- 关键 file:line：src/store.ts:905-908/630-642/289-290/969-970/863-869；src/tools.ts:731/998-1003；src/plugin.ts:224；src/adapter/zctx-adapter.ts:263/354-370；src/budget.ts:90-94；zDSH-main/packages/llm/llm/src/index.ts:1088-1093、src/content.ts:335-344/353-371；tests/store.spec.ts:289-297（误标证据）、tests/helpers/mock-session.ts。
- 上游报告：reports/audits/AUD-state-machines.md（SM-01 §1、SM-02 §1）、reports/audits/AUD-host-faces.md（HF-01 §1.2、HF-02 §8 表）。
- 环境声明：Windows 10.0.26200 / Git Bash / node ≥22.13（package.json engines）；官方 lib 与 vendored cordis 均为 zDSH-main 在盘构建（Z20 目录→入口拼接纪律）。

（完 · 供 ops 发布门引用：电池全绿 + 新鲜度 PASS + 四缺陷复现确认。）
