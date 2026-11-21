# ZCTX-UI B5b 终验报告（独立 verifier）

> 角色：verifier-b5b（独立复核，≠ 作者 coder，≠ 上游 reviewer-B5）；不生产新信息，仅独立复检。
> 工作树：`G:\000Github\zDSH\zDSH-plugins\dsh-zcontext\worktrees\ZCTX-UI`（分支 `feat/ZCTX-UI`，HEAD=`69f0443546835e27377b4145d827eecce51ca4ea`）。
> 复核日：2026-11-18；上游 B5 评审结论：100/100 PASS（reviewer-B5，author=coder，见 `scorecards/B5.json`）。
> 三值：**确认** = 独立来源/命令支持；**证伪** = 独立来源矛盾（附证据）；**无法验证** = 渠道穷尽仍不可得（真机只读纪律：仅读 profile 文件，未启动/未写 app）。
> 真机纪律：本轮未启动桌面 app、未写任何真机文件；端到端浏览器/face 真机项一律标 B6/无法验证，按 plan §6 定义不扣分。

---

## 一、逐项结论对照表

| 编号 | 原结论（task.json V1-V10） | 验证结论 | 证据来源（独立命令/实读） | 影响评估 |
|---|---|---|---|---|
| V1 | 快照 API 返回进程内存实时账本（非日志扫描） | **确认** | `npx vitest run tests/zctx-ui.spec.ts` → D1 九用例 PASS（注入账本逐字段 `toEqual` 现存取器、显式/缺省/不可见三臂、meter 失败→unknown、无样本→none、availableSessions、B5-3 真抛点降级）；实读 `src/ui/snapshot.ts`：薄封装 `computeBudget`(:156)/`foldableRanges`(:174)/`store.observabilitySnapshot`(:216)/`usageSnapshot`(:189)/`ledgerEntries`(:181)/`surfaceNodes`(:174)/`routedRequestTarget`(:145)/`runtime.tokenMeter.measure`(:129)，账本经 `runtime.storeFor` 取进程内存 store，无日志扫描、无算法重造。plugin.ts:420-437 注入 resolveWatchedSession/currentSession/windowCache/faceHealth/listSessions | 承重成立。真机"实时读数"属 V8-C-3/B6；代码/单测层确认 |
| V2 | UI 页含设置/查看/统计三块，桌面浏览器可用 | **确认（静态 DOM；浏览器渲染属 V8/B6）** | 实读 `src/ui/page.ts`：三块 `<h2>` 查看·实时账本(5s 轮询)(:103)、统计·累计折叠/回本/缓存(:107)、设置·配置 overlay(:111)；`setInterval(refresh,5000)`(:362)、同源 fetch `/zctx-ui/api/*`(:337/:349/:304)、face 灯(:167/:176)、会话 `<select id=session-pick>`(:96-97)。单一内联 HTML 常量，无 fs 读盘/路径拼接 | 三块 DOM 静态确认；真机浏览器渲染按任务定义归 V8，标 B6 无法验证、不扣分 |
| V3 | UI 数据不进 session（不烧 token） | **确认** | `grep -rnE "llm\.stream\|llm/stream\|req\.body\|internal/config\|requestBody\|registerListener\|on\('llm" src/ui src/client` → **NO MATCH**；`grep -rn "llm.stream\|llm/stream" src/ui` → **NO MATCH**。UI 数据经同源 HTTP fetch（page.ts:337/349），不调 llm.stream、不进对话；`src/ui/**` 为叶子，未被 fold-engine/autofold/observe/preflight 反向 import（DESIGN §9.1 契约，grep 佐证） | R1 数据边界成立 |
| V4 | bridge token/loopback 授权，非授权拒绝；token 运行时生成（源码/测试无凭据字面量） | **确认** | `npx vitest run tests/zctx-ui.spec.ts` D2 授权臂全 PASS（token/loopback/same-origin 三臂、写从严、non-loopback 无 token→403、method 不符→405）；`grep -rnE "['\"\`]zctx_[0-9a-z]+_[0-9a-f]{16,}['\"\`]" src tests scripts` → **NO MATCH**；实读 `auth.ts:41-42` `randomBytes(16).toString('hex')`、`:94/:105` token 头命中即 return（不回退 loopback）；独立加载真实 auth.ts 复现 7 臂全 PASS（wrong-token+loopback READ/WRITE 均 false、valid-token true、loopback-only READ true/WRITE false、remote 无 token false） | fail-closed 独立复现，错误 token 不回退已落地；无可用凭据字面量 |
| V5 | 桌面 face 激活探针可判活/死（BENCH-L2 前置） | **确认（单测层；真机 face 状态属 V8/B6）** | `npx vitest run tests/ui-face-probe.spec.ts` → **13/13 PASS**：三态 active/degraded/absent、built-but-refused→degraded、ctx.tools getter 抛错 fail-soft、no guard records 合法 inert、no memoize（Z25）、unknownFaceHealth bootstrap。实读 face-probe.ts 三重信号 :97-153、三态裁定 :155-163 | 探针判据成立；真机三重证据属 BENCH-L2/B6，不自动关闭 |
| V6 | fail-soft 降级可见 sink + UI 显示 face 健康度（Z28） | **确认** | 实读 `src/ui/face-probe.ts`：默认 sink=`process.stderr`（:63-69），`createTransitionSink` 去重（:194-201），全链路无 `ctx.logger.warn`（grep 唯一命中为注释 :17）；plugin.ts `faceSink=createTransitionSink()`(:345)、`faceHealth()` 注入 sink(:485-498)；`tests/ui-face-probe.spec.ts` sink 臂：degraded/absent 写一行、active 不写、去重 PASS；page.ts face 健康字段(:167/:176/:211) | Z28 可见 sink 落地，不依赖 logger.warn；去重避免 5s 轮询刷屏 |
| V7 | settings.section slot 摘要卡 inject 门失败不 PENDING（Z21） | **确认** | `npx vitest run tests/client-slot.spec.ts` → **13/13 PASS**：inject=['slots'] 最小集、slots 缺席→no-op 不 PENDING、inject 抛错吞掉、React 缺席→真 `<a href=/zctx-ui>` 链接（B5-1）、styles.insert+effect、无 priority、manifest dsh.client；`pnpm build` → **握手 4/4 PASS**（banner-single-arg-factory / banner-id-matches-package-name / footer-returns-exports / no-three-arg-factory） | Z1 单参工厂契约与 inject 降级门成立 |
| V8 | 研究 4 项未解决转验收 | **确认（正确留待真机；phase 已改 post-merge）** | 实读 `tasks/ZCTX-UI/closures/closure.json`：5 项（V8-A3-4 / V8-A4-5 / V8-A2-4 / V8-C-3 / BENCH-L2）全部 `disposition=open / status=open / phase=post-merge`；A4-5/A2-4 附 `_main_note`（B5-4 主线将 phase 由 block→post-merge，单测臂已 fixed、真机臂留 B6）；无单方面关闭、无 status=closed。真机臂在 closure 中明确"待 B6 实测" | 处理正确：未把未解决项默认为已解决；block 门无 OPEN，不阻 B5 |
| V9 | R1 红线不变（SUPPORTED 段 8e2d0b7e… 口径） | **确认** | `git show <ref>:patcher/zctx-patch.mjs \| node <切片+sha256>` 独立复算：HEAD / 69f0443 / 03ec933 / b1e5518 四 ref 一致 `chars=14889 bytes=14926 sha256=8e2d0b7effb1b9af0151b2e2aa8b408eb67b5d58c180e29df3c8730ac059b0f9`；V3 grep 佐证零请求体改写面 | R1 红线未变；与三 ref 及 README 锚点一致 |
| V10 | 全量测试绿 + tsc 0 + 工作树干净 | **确认（附一处非业务文件未提交说明）** | `pnpm test` → **34 files / 730 tests PASS**（EXIT=0）；`npx tsc --noEmit` → EXIT=0；`pnpm build` EXIT=0 握手 4/4。build 产生 4 个 lib chunk churn，独立核验：2 个纯 CRLF、2 个 sourcemap 仅 `sourcesContent` 内 `\r\n`↔`\n`（JSON 其余键全同），按 Z3 `git checkout -- lib/` 还原后 lib/ 与 HEAD 完全一致。最终 `git status --short` = 仅 `M tasks/ZCTX-UI/handoffs/review-B5.md`（任务交接文档，本轮开始前即存在、非本 verifier 改动、非业务代码/测试/配置） | 构建/类型/测试全绿、业务树净；唯一脏文件为任务文档，不影响交付物 |

## 二、附加核查

| 编号 | 原断言 | 验证结论 | 证据来源 | 影响评估 |
|---|---|---|---|---|
| 附加-1 | B5 评审件 evaluator≠author、total=100 在册 | **确认** | 实读 `scorecards/B5.json`：`evaluator="reviewer-B5"`、`author="coder"`、`independent=true`、`total=100`、`threshold=98`、`verdict="PASS"`；`handoffs/review-B5.md` r1 终评 100/100，评审人≠作者 | 质量门独立性成立 |
| 附加-2 | checkpoint STEP-0001..0010 链 VALID | **确认** | Node 复算 `checkpoint-history.jsonl` 10 条：每条自哈希 SHA-256（canonical JSON 去 hash 字段）全 VALID；相邻 `prev_hash==上条 hash` 10/10 链节 VALID；`checkpoint.json` 为 step10 完整副本（`hash==history.last.hash`、`prev_hash==history.last.prev_hash`），`step=10`、`next=B6` | 增量落盘证据链完整有效 |
| 附加-3 | 桌面 webServer 面是否对第三方插件注入 | **无法验证（属 B6；webServer 落点风险）** | 只读 `C:/Users/ZS/.dsh/profiles/desktop/package.json`：①`dsh-zcontext` 钉在 `github:zsagi1368/dsh-zcontext#a4ae66297ccd…`（commit a4ae662），**与被验 HEAD 69f0443 不同**——即便合并，桌面 profile 仍指向旧 pin，除非更新 pin；②bundle 列表含 `@deepseek-ai/dsh-web-app`（webServer 的服务提供方），但**无任何文件证明桌面 composition 会把 webServer 路由注入给第三方插件**；③profile 内无 AutoPilot（grep → NOT FOUND），无 AutoPilot/webServer 消费者先例可循。仅读 profile，未启动/未写 app | 标无法验证/属 B6，不假装已解决。**落点风险**：pin 落后 + 注入先例缺失，B6 真机须先确认 webServer 对第三方路由注入，并更新 profile pin |

## 三、证伪项

**无。** V1-V10 及附加-1/2 均取得独立证据支持；附加-3 按真机只读纪律诚实标为无法验证（属 B6），非证伪。

## 四、影响评估汇总

- 全部 10 项验收在**代码审/单测/构建/哈希复算**层独立复现通过；上游 B5 的 100/100 结论成立，无承重错误。
- 真机相关（V2 浏览器渲染、V5 face 真机、V8 四项端到端、webServer 注入落点）按 plan §6 属 B6，本轮无法验证且不扣分。
- **需主线在 B6 关注的风险**：桌面 profile 将 dsh-zcontext 钉在 a4ae662（落后于被验 69f0443），且无第三方插件 webServer 注入先例——合并后须更新 pin 并真机确认 `/zctx-ui` 路由在桌面 composition 实际可达。

## 五、诚实声明

- 真机未碰：仅只读读取 profile `package.json`，未启动桌面 app、未写任何真机文件。
- 无法验证项：桌面 webServer 面对第三方插件注入（附加-3）；端到端浏览器三块渲染/5s 轮询/face 灯、face 三重证据、非 loopback 真机只读、primitive 字段真机可见性、真机会话切换——均属 B6。
- 未编造任何命令输出、来源或结论；所有数值/哈希均来自本轮实跑或实算。

---

## 完成回执（verifier-b5b → main）

```
FROM: verifier-b5b  TO: main
MODE: verify
TASK_REF: ZCTX-UI B5b 终验（HEAD 69f0443，复核上游 B5 100/100）
结论: V1-V10 全项确认（代码/单测/构建/哈希层）；附加-1/2 确认；附加-3 无法验证/属B6
证伪项: 无。
评分: 100/100（六维满分，evaluator=verifier-b5b，author=coder+main；真机臂按 plan 不扣分）
风险: 桌面 profile pin=a4ae662 落后于 HEAD 69f0443；无第三方 webServer 注入先例 → B6 须真机确认路由可达并更新 pin
CHECKPOINT: STEP-0010（链 VALID，10 条自哈希+prev 链接全通过）
ATTACHMENTS: handoffs/verify-B5b.md；scorecards/B5b.json
```
