# B3 对抗评审报告 — ZCTX-PATCH-AUTO 全分支实现

- 评审人：reviewer-B3（独立，非作者；作者=coder B2/B2b/B2c 三波 14 提交 d951ebf..HEAD=4cacac0）
- 日期：2026-11-18
- 对象：worktree `G:\000Github\zDSH\zDSH-plugins\dsh-zcontext\worktrees\ZCTX-PATCH-AUTO`，分支 feat/ZCTX-PATCH-AUTO
- 依据：tasks/ZCTX-PATCH-AUTO/task.json（V1-V14）、reports/plans/ZCTX-PATCH-AUTO-plan.md、docs/specs/ZCTX-PATCH-AUTO/options.md、zDSH-docs RES-PATCH-DEEPEN.md、patcher/README.md
- 方法：全量 diff 通读（1820 行 patcher diff + 4 新测试 spec 全读 + README/d.mts 对照）+ 独立复算/复跑 + grep 枚举 + CLI 实测

## 结论：打回（总分 96.5 < 98 放行门，无 [阻断] 项，5 条 [建议] 一轮可修齐）

---

## 必核清单逐项证据（1-13）

### 1. R1 红线 — PASS（独立重算）
- 方法：node 脚本从 d951ebf 与 HEAD 两版 `patcher/zctx-patch.mjs` 各自提取 `export const SUPPORTED = {` 至配对 `}` 的完整段，SHA-256 独立重算。
- 证据：base len=14887 / head len=14887；**base sha256 = head sha256 = `f51c2a76653aefaeabdb7e2fc407334588f3aecddd25c75309fc8501f1000a5b`（带前缀口径），identical: true**；纯数据体口径（不含 `export const SUPPORTED = ` 前缀）亦恒等 `3aa6ad7e457590b64f54aaa22ae30de96fc1f66f95e78e3072a8c0927aa53821`；行内 trim 口径恒等 `beec2dc0…`。三种口径字节级恒等，决定性事实成立。
- 口径说明：coder 声称的 `8e2d0b7e…` 在上述三种常见口径下均不可复现（其哈希口径未记录）——恒等本身已由我独立三口径证实，但该声称数字的可复现性欠缺（[建议] B-7）。
- 全 diff 无任何请求体改写面：diff 仅在 SUPPORTED 段后新增管线代码；fetch 仅两处（见第 3 项）；adapter/wire 补丁载荷未触碰。

### 2. fail-closed 全景 — PASS
- 未知版本拒绝：`resolveAnchorEntry` source='none' → patchAsar version gate refused（zctx-patch.mjs:2059-2066 一带；实测 reanchor spec 'before' 臂断言 `run reanchor against this build first`）。
- 损坏数据文件拒收且不回退在码 map：`loadAnchorSetData` 返回 `{ok:false,reason}` → `resolveAnchorEntry` source='error' → version gate refused 且 detail 含 "never falls back"（tests/patcher-reanchor.spec.ts:393-404 'corrupt data file makes patch refuse LOUDLY' + :406-417 schema-broken 臂）。statusAsar 同样报 rejected（spec :450-457）。
- reanchor 永不覆盖已存数据集：zctx-patch.mjs reanchorAnchorSet 步骤 2 `existing data set → refused — reanchor never overwrites`；`landAnchorSet` 同门（"landing never overwrites"）；双测试锁定（reanchor spec :313-323）。
- anchors 目录唯一写路径（全文件 grep）：写入点全枚举 = backup(1781-1849)/marker(1845-1849)/splice(2102-2103)/restore(2244-2262)/reanchor --out 检视副本(2640)/preadapt workdir(3066,3075,3086,3180-3300)/**landAnchorSet(3326-3329，mkdir+tmp+rename，唯一 anchors 目录写入点)**/auto.log append(3367-3368)。结论：`landAnchorSet` 确为 anchors 目录唯一写路径，claim 成立。
- preadapt 模拟 patch 不过绝不落盘：步骤 9 `!patched.ok → sim-patch-failed return`（先于步骤 11 landAnchorSet）；步骤 10 全量 status 复核不过 → sim-verify-failed；测试断言 `existsSync(anchorsDir) === false`（preadapt spec :580-599）。
- check-official 网络异常响亮 exit 1：'feed-unreachable' finish(...,1)；实测（server down 臂 + 本机 CLI smoke `check-official --app-dir <不存在>` → RC=1）。

### 3. 两 GET 纪律 — PASS
- 全文件枚举真实外联（grep fetch/http，剔除注释与 SUPPORTED 载荷字符串）：仅 `fetchImpl(feedUrl)`（checkOfficial，行 2864）与 `fetch(url)`（downloadToFile，行 3083）。行 303/344/346/361/590/786 均为 R1 数据段内的透传包装字符串（未触碰）；行 2891/3035 为 URL 拼接/指引文本。
- preadapt 出站 = check-official 1 GET + 安装包 1 GET；测试硬断言 `feed.requests.filter(.endsWith('.exe')).toHaveLength(1)` 且 yml GET 恰 1（money test :512-517 + check-official :394-395）。
- latest.yml=SPA HTML 陷阱处理正确：channel 取自 app-update.yml（nightly→nightly.yml）；`parseUpdateYaml` 对 `text.startsWith('<')` 响亮拒收（feed-unparsable，detail 含 'HTML'）；专测锁定（preadapt spec :418-427）。HTML 从不被当探针。

### 4. sha512 权威链 — PASS
- 下载校验用 feed sha512（BASE64 wire 格式同态比较，`sha512FileBase64`，注释明言"与 electron-updater 同信任根"）；size 双校验（downloadToFile 内 size != feed size 即抛）。
- 不匹配 → `rmSync(installerPath)` 删残留 + 'download-verify-failed' exit 1；磁盘残留不存在断言（preadapt spec :533-545）。已存在文件 sha512 匹配则幂等跳过（;501-508）。
- blockmap 全仓零引用（grep 无命中）——差量语义未被误用，全量下载 + feed 哈希权威。既无 misuse 也无依赖。

### 5. fuse 门语义一致性 — PASS（claim 如实记载）
- patch：'1'/不可读拒收、'r' warn-through、exe 缺席 skip（patchAsar fuse gate，diff 345-376；fuse spec :258-310 五臂）。
- auto：fuse-on/fuse-missing exit 1；'r' → fuse-removed WARN 继续（runAuto 步骤 2；auto spec :274-297）。
- preadapt：严格 '0'，`fuse.integrity !== '0'` 即拒（含 'r'）；代码注释明言 "humans keep the warn-through path via patch/auto"（preadapt 步骤 7 注释）；README preadapt 步骤 6 同文（"'r' 一律拒收候选……人工路径的 warn-through 不受影响"）。coder claim "自动管线取最严门（有意更严），人工路径不受影响" 与代码、注释、README 三处一致，无行为矛盾。
- 已知不对称（patch exe-缺席=skip vs auto exe-缺席=fuse-missing exit 1）：auto 判定表与 README 均如实记载 auto 侧（"exe 缺席……fail-closed，人工"），方向为更严（fail-closed），可接受。

### 6. Z26/Z27 回归锁 — PASS（零改动定界）
- 全 diff hunk 头清单（14 个）：仅触及 SUPPORTED 之后的追加块、appRunningGate 之后的追加块、patchAsar 签名/fuse 门插入/version 门锚集解析、statusAsar 签名/锚集面/fuse 面、CLI parseArgs/main。`spliceAsarMulti`/`readHeaderPositioned`/`extractPositioned`/`loadAsar/uncacheAll`/备份/restore 的函数体零 hunk。
- 既有守卫全绿：patcher.spec/patcher-multifile.spec 既有断言仅追加 `fuse integrity gate:skip` 步（fixture 无 exe 的诚实 skip），其余步骤序列逐字未动。

### 7. Z29/Z32 — PASS
- auto：patch 后全量 status 复核不可绕过（步骤 6 无条件执行；verify-failed 臂有专测——fake patchFn 报 ok 不落盘 → verify-failed exit 1，auto spec :377-400）；备份在盘门 `patch.backup?.dir` 先于复核。
- preadapt：步骤 10 全量 status（patchSet N/N + marker）不可绕过（无条件）；不过即 sim-verify-failed。
- Z32 备份先在盘：createBackup（基线，未改）copyFileSync 后逐字节哈希核对，不符即 throw 拒动原件（行 1784-1788）；auto money test 断言 backup 根 + app.asar + RESTORE.md 在盘（auto spec :324-330）。
- 诚实备注：仓库无字面 `SHA256SUMS` 文件，哈希录于 RESTORE.md 代码块（基线既有形态，非本次改动引入）。V6 的"SHA256SUMS 在盘"按现实现应解释为 RESTORE.md 内哈希清单；B5 执行时请按此口径验收或补一个 SHA256SUMS 文件（[建议] B-8）。

### 8. feedFace 测试隔离 — PASS
- 双默认成立：模块 `feedFace = false`（runAuto 参数默认）→ 单测全离线（'feedFace OFF (module default) → no feed lines' 臂有专测，checkOfficialFn 注入 throw 也不触发）；CLI `auto` 传 `feedFace: true`（main 内）→ 生产联动。
- auto 判定表新增臂（would-preadapt/preadapting/preadapted/preadapt-failed/feed-pending/feed-unreachable）位于步骤 2.5（fuse 面之后、版本面之前），只增日志不改后续臂的 exit 语义；feed 不可达 WARN 后本地判定照常（专测锁定 exit 0 + would-patch）。与原六态机无冲突。

### 9. 灰度判定诚实度 — PASS
- isStagingMatch 复刻：`readUInt32BE(12) / 0xffffffff`（DR1-5 源码口径）；JSDoc 与日志均标注 "confidence medium-high, [U1] reserved"（未读出内置 updater 版本）。
- 真机 UUID 0.434692 锁定于测试（toBeCloseTo(0.434692, 5)，REAL_MACHINE_UUID=98681471-…，与 DR1-7 一致）；30% 不含本机的方向断言独立成立。
- .updaterId 缺席/坏 UUID → `stagedIn unknown` + WARN 日志，不阻断（'staging-position' WARN 两臂）；stagedIn 未定义时 payload 如实带 undefined 而非猜 true/false（stagingPercentage 缺席 → true 为 electron-updater 无灰度门语义，正确）。

### 10. exit code 契约 — PASS（实测）
- 本机 CLI 直测（无管道）：无命令/bogus 命令 → RC=2（usage）；未知选项 → RC=1（uncaught 栈，响亮但糙——[建议] B-6）；check-official 缺目录 → RC=1；reanchor 缺 asar → RC=1；auto 缺目录 → RC=1。
- 代码面：auto 0=无事/已好/礼貌跳过、1=需人工（判定表逐态一致）；check-official/preadapt finish(exitCode 0/1)；与 plan §4 契约一致。
- usage 行已更新为 9 子命令 + 全部选项（实测输出含 --accept/--seven-zip/--keep-workdir）。

### 11. 测试质量 — PASS（本人亲跑复现）
- `npx tsc --noEmit` → exit 0（本机复跑）。
- `pnpm test`（= tsdown && vitest run）→ **31 文件 659/659 PASS，2.00s**（本机复跑，2026-11-18 10:11-10:12，Z19 stale 产物风险消除：build 先行）。
- money test 真锁链路：reanchor money test（unknown→refused→reanchor→**无 entry 注入** patch→status 5/5→anchorSetSource='data'，零人工编辑）；preadapt money test（would-preadapt 零下载→全管线→落盘文件 SHA-256 自洽→candidate.files[0].pristineSha256==stamp 复算→恰 1 次 .exe GET→幂等二次运行零新 GET→loader data 源解析）。均为计算值断言非字面量，无假绿面。
- Z17 注释干扰：patcher.spec/multifile.spec 新增两行为测试源码注释（解释 skip 步），非断言数据污染，无碍。
- 瑕疵：auto spec :355 有一行自等式断言（sha256(x)==sha256(x) "sanity no-op"）——零信息量（[建议] B-5）。

### 12. 文档-实现一致 — PASS（两处缺口见 B-2/B-3）
- patcher/README.md：SOP（快速适配 5 步/预适配 10 步/DR-6 桌面验收 7 步）、auto 判定表 12 态、两 GET 承诺、landAnchorSet 唯一写路径、fail-closed 不弱化声明、B5 主树注册边界——与代码逐条对得上。
- 主 README.md/README.zh.md 各补一句 auto/install-task 概括，内容不失真（判定表指针、fail-closed、--yes 语义、日志路径均准确）。
- RES-PATCH-DEEPEN DR 编号无歪曲：DR1-3/1-5/1-6/1-7/1-11/2-2/2-7/2-9/5-4/DR-6/U1 全部如实落地（对照研究文档 grep 原文）。

### 13. 范围锁 — PASS
- diff 新增行中无 `H:\`/`AiAgent`/真机路径硬编码（grep 证据：仅在基线既有 `DEFAULT_APP_DIR = 'H:\AiAgent\DeepSeekHarness'`（行 137，基线已有、README 文档化默认）出现）。
- 代码写动作面：%LOCALAPPDATA%\zctx-patch\（auto.log/preadapt workroot）+ patcher/anchors\（--accept 数据通道，设计内）+ patch/restore 真机面（用户显式调用路径，B5 执行）。计划任务注册本身不对真机 schtasks 执行（测试仅 fixture 级）。

---

## 评审发现

### [阻断]（无）

未发现不修不能合入的缺陷。R1 恒等、fail-closed 全景、范围锁、回归锁均实测成立；无伪造证据迹象（coder 证据均可复现，唯一例外为哈希口径未见 B-7）。

### [建议]（不阻塞中间合入；阻塞最终验收，须逐条 disposition）

- **B-1 compareVersions 混合 token 边界（正确性·低概率路径）**：patcher/zctx-patch.mjs prerelease 逐 token 比较用 JS 关系运算符，数字与字母 token 同位相比较时被 NaN 强转吞掉方向。实测证据：`compareVersions('1.0.0-alpha.beta','1.0.0-alpha.1')` → `{order:-1, comparable:true}`，而 semver 规则数字标识符恒低于字母数字标识符（应为 +1）。危害：同位数字/字母混合的假想 feed 版本会判错 pending 方向且 `comparable:true` 未如实标注（违背"绝不静默已最新"的精神）。现实 feed 形态 `0.2.2-rc.N` 纯数字 token 不受影响（rc.1 vs rc.10 实测正确）。修法：token 比较前按"数字 < 字母数字"的 semver 规则分流，或类型不齐时返回 comparable:false。** disposition: OPEN → 本轮修（一行级）。**
- **B-2 patcher/README.md patch SOP 步清单缺 fuse 门步**：### patch 节 1-10 步枚举未含代码实际插入的 fuse integrity gate（位于 app-running 门与版本门之间）；fuse 行为虽在"风险与限制"节有记载，但 SOP 清单与真实门链不一致。修法：清单插入 fuse 步（含 '1'/不可读拒收、'r' 警告放行、exe 缺席诚实 skip 三态）。disposition: OPEN → 本轮修（文档）。
- **B-3 README preadapt 节缺"app 需关闭"前提**：模拟全量 patch 走 patchAsar 全门，其中 app-running 门用默认 `~/.dsh/profiles/desktop/lock`（desktopLockPath(undefined) 默认）——真机 app 运行中（锁在）时直接 CLI preadapt 会在 sim-patch-failed 处拒收。fail-closed 方向无害但出乎文档承诺（"真机安装全程只读"易被读作"随时可跑"）。auto 联动路径天然免疫（auto 先查 app-running）。修法：preadapt 节补一句"真机 app 须关闭（或锁不在），否则模拟 patch 在 app-running 门拒收"。disposition: OPEN → 本轮修（文档）。
- **B-4 无 fetch 超时 / auto tick 无单实例互斥**：check-official 与 downloadToFile 的 fetch 均无 AbortSignal 超时；无人值守 hourly 任务下一次网络挂起会使该 tick 长挂（若 Task Scheduler 多实例策略允许并行则可能堆积 node 进程；schtasks 默认策略未实测，如实存疑）。修法：下载/feed 请求加超时（如 AbortSignal.timeout(5-10min)）+ auto tick 入口加锁文件互斥。disposition: OPEN → 本轮修或按 B5 演练结论记账（user_approved_deferred 须用户批准）。
- **B-5 auto spec 自等式断言**：tests/patcher-auto.spec.ts:355 `expect(sha256(...)).toBe(sha256(...))` 恒真无信息量（drifted 臂 asar 已被 spliceFace 改动，原意大概是断言 auto 未再写盘——可用 splice 后哈希快照对比）。disposition: OPEN → 本轮修（一行）。
- **B-6 未知选项报错形态**：`--bogus-opt` 走 parseArgs throw → uncaught 栈（RC=1 正确但输出为栈而非干净 usage）。修法：main 顶层 catch parseArgs 错误打 usage。disposition: OPEN → 可并入 B-1 一轮修（低优先）。
- **B-7 coder 声称的 SUPPORTED 段哈希 8e2d0b7e… 不可复现**：我的三口径（带前缀 f51c2a76…/纯数据体 3aa6ad7e…/行 trim beec2dc0…）均非该值，其口径未记录。字节恒等事实本身已独立证实，但"声称哈希"作为证据不可复核。修法：补记口径（或直接采信本报告 f51c2a76 口径）。disposition: OPEN → 记录口径即可（不改代码）。
- **B-8 B2/B2b/B2c 波次评分卡缺失（治理面）**：tasks/ZCTX-PATCH-AUTO/scorecards/ 为空，三波 coder 交付未见逐波 scorecard 落盘（§12.2）；且 scripts/score-gate.ps1 在本仓/worktree 未找到（机器校验不可用）。主线须补齐或在台账如实记账。另 progress.md STEP-0009 有笔误"本机0.43%<30%"（应为 43.47%≥30% 不含；文档本体 DR1-7 无误）。disposition: OPEN → 主线处理（非代码阻断）。

### 已知开放项（按指令不作为阻断，属 B5）
- [U1] 灰度算法置信（代码/README 已如实标注）；[U2] 真实 ~300MB 下载；[U3] 真 7z 提取；真机 V1/V4/V6/V8/V12/V13 实证。本评审均无法在本环境验证，如实标注"无法验证，属 B5"。

---

## 评分（六维，evidence 附路径/行号/命令输出；评审人 ≠ 作者）

| 维度 | 分 | 扣分依据 |
|---|---:|---|
| 正确性 | 24.5/25 | B-1 compareVersions 混合 token 方向错误（实测复现）；其余全绿：tsc exit 0、659/659、R1 三口径恒等、exit code 实测、fail-closed 全景实测 |
| 完整性 | 19/20 | landAnchorSet 为 mjs 51 个导出中唯一缺失于 zctx-patch.d.mts 的导出（node 导出面 diff 实测）；V12/V13 真机面属 B5 设计内 |
| 一致性 | 19/20 | B-2 patch SOP 步清单缺 fuse 门步；B-3 preadapt 缺 app 关闭前提；DR 编号/plan 契约/exit 语义/log 格式均一致 |
| 可验证性 | 14.5/15 | 全部关键证据本机复现；唯 B-7 声称哈希口径不可复现（-0.5） |
| 安全回滚 | 10/10 | fail-closed 全景、备份先验证后动手（基线未改）、anchors 唯一写路径、范围锁干净、workdir 自建自收有界 |
| 可维护性 | 9.5/10 | 结构/命名/注释上乘；B-5 自等式断言、B-6 报错形态、auto 'refused' detail 未携带数据锚集拒绝原因（status.note 在而未透传） |
| **总分** | **96.5/100** | < 98 放行门 → 打回（返工第 1 轮；B-1/B-2/B-3/B-5/B-7 修齐后预期 ≥98） |

硬阻断核对（§12.3）：无伪造证据/评分/派发；无安全底线违规；正确性 ≥23；安全回滚 ≥9；测试全绿无 P0/P1；无 OPEN 遗留未记账（本报告 8 条均已登记）；无 del 越权。→ 无硬阻断，仅分数门未过。

## 交接

```
FROM: reviewer-B3  TO: main
MODE: fix
TASK_REF: ZCTX-PATCH-AUTO B3 gate
PAYLOAD: SCORE 96.5/100（正确性24.5 完整性19 一致性19 可验证性14.5 安全回滚10 可维护性9.5）；[阻断] 0；[建议] 8（B-1..B-8，OPEN）；CHECKPOINT 本文件即 B3 产物
ATTACHMENTS: tasks/ZCTX-PATCH-AUTO/handoffs/review-B3.md; tasks/ZCTX-PATCH-AUTO/scorecards/B3.json
```

---

# r2 复评（B3 返工第 1 轮后 · 2026-11-18）

- 对象：f6e993a（B-1/B-4/B-5/B-6 code+tests）+ 295c5ae（B-2/B-3/B-7 README + STEP-0010）+ e0959ae（B-8 主线记账）
- 方法：六项修复逐一独立复核 + 亲跑 tsc/pnpm test + CLI 实测 + B-7 口径独立复现

## 六项修复复核（全部独立验证）

- **B-1 compareVersions — FIXED（实测通过）**：semver 11.4 分流实现正确（数字标识符恒低于字母数字；同类走关系比较）。本评审独立六例全对：`alpha.beta` vs `alpha.1` → +1；反向 → -1；`1.beta` vs `1.1` → +1；`beta` vs `rc.1` → -1（纯字母字典序正确）；`rc.1` vs `rc.10` → -1；feed 回归 `rc.5` > `rc.3` → +1。新增 3 条测试臂锁定（tests/patcher-preadapt.spec.ts:477-481）。
- **B-2 README patch SOP — FIXED**：fuse 完整性门插入为第 2 步（三态如实：'1'/不可读拒收、'r' 警告放行、无 exe 诚实 skip），步号 1-11 重排一致；版本门同步补数据锚集来源。
- **B-3 README preadapt 前提 — FIXED**：新增"前提：真机 app 处于关闭态"段，且论证准确（模拟 patch 探针不看真机进程，但候选的最终消费者 patch/auto 要求真机关闭；auto 联动臂天然满足——app-running 臂先于 feed 面）。
- **B-4 超时+互斥 — FIXED，600s 偏差裁定成立**：check-official `AbortSignal.timeout(feedTimeoutMs=20s)`、downloadToFile `AbortSignal.timeout(600s)`、CLI auto 单实例互斥（O_EXCL `wx` + 30min lease + fresh 持有者礼貌跳过 exit 0 审计留痕 + stale 接管一次 + 非 EEXIST 错误响亮 exit 1 + finally release）。**偏差裁定：成立**——本评审 r1 建议原文即 5-10min，600s=10min 在建议区间内；300MB@120s 需持续 ~2.5MB/s（20 Mbit/s）确会误杀慢链路，600s 下限 ~0.5MB/s（4 Mbit/s）更稳妥，慢链路超时即响亮 download-failed 且幂等重跑。真实 stall-server 测试两臂（socket 挂起 → feed-unreachable / download-failed，均 'aborted' 字样）+ 子进程 mutex 两臂（fresh skip exit 0 且锁存活；stale 接管后走完本地判定且锁释放）+ 单元三态锁定。**注**：注释算术有一处口误（见 C-3）。
- **B-5 自等式断言 — FIXED**：替换为真不变量（splice 后哈希快照 pinned 对比：auto 拒绝后不得再改档）。
- **B-6 未知选项 — FIXED（实测通过）**：main 顶层 catch parseArgs → `[refuse] unknown option --bogus-opt` + usage + **RC=2**、无栈；子进程测试断言 stderr 含 offending token + usage 且不匹配栈帧。
- **B-7 段哈希口径 — CLOSED（独立复现）**：README R1 守卫口径段写死命令级口径（git show 对象读取 → 自 `export const SUPPORTED = {` 行起至首个 `// ----------` 分隔行止，不 trim 不改行尾）。本评审独立实现同口径切片：**d951ebf 与 HEAD 同值 `8e2d0b7effb1b9af0151b2e2aa8b408eb67b5d58c180e29df3c8730ac059b0f9`，精确复现**。一处标注瑕疵见 C-2。
- **B-8（主线）**：STEP-0009a 三项记账（笔误更正/评分表合并裁定/score-gate.ps1 缺位人工校验）——认可；progress.md 追加式更正保留原文，台账纪律正确。

亲跑：`npx tsc --noEmit` exit 0；`pnpm test` → **31 文件 665/665 PASS（2.79s，+6 测试=2 stall + 3 mutex/CLI + 1 CLI face）**。R1 锚哈希返工后复钉：d951ebf 与 HEAD 仍同值 8e2d0b7e…（返工零触碰数据段）。

## r2 评审发现

### [阻断]（无）

### 残留 [建议]（全部行级；第 2 轮返工清单）

- **C-1 landAnchorSet 仍缺于 zctx-patch.d.mts**（53 个导出中唯一缺失，node 导出面 diff 实测）。说明：此发现 r1 已记（完整性扣分项）但 r1 报告漏编号——**编号疏漏在评审人**，coder 按 B-1..B-7 清单工作无法看到它。补一行为声明即可。disposition: OPEN → 第 2 轮修。
- **C-2 README R1 口径段长度标注误标单位**："两侧长度 14889 B"——14889 是**字符数**（code units），UTF-8 字节数实测 14926。哈希本体无损（已独立复现），仅单位更正。disposition: OPEN → 第 2 轮修。
- **C-3 downloadToFile 注释算术口误**："600 s sustains ~4 MB/s"——300MB/600s ≈ 0.5 MB/s（= 4 **Mbit**/s），Mbit 与 MB 混写；120s 那句（~20 Mb/s）是对的。超时值本身安全，仅注释数字更正。disposition: OPEN → 第 2 轮修。
- **C-4 README auto 节未记 mutex/超时新面**：already-running（fresh 持有者礼貌跳过）与 mutex-takeover（stale 接管）是 CLI auto 的用户可观测行为 + fetch 双超时，代码注释与 d.mts 已记，README auto 节/判定表未提。补两句。disposition: OPEN → 第 2 轮修。
- **C-5 auto 'refused' detail 仍不透传 status.note**（zctx-patch.mjs:3531）：数据锚集损坏时 auto 日志只有"不在支持集"，校验器原因只在 status 面可见——同为 r1 记分项漏编号（评审人疏漏）。一行插值即修。disposition: OPEN → 第 2 轮修（可与 C-1 同 commit）。

## r2 评分（六维；评审人 ≠ 作者；全部证据本机复现）

| 维度 | 分 | 依据 |
|---|---:|---|
| 正确性 | 25/25 | B-1 六例实测全对；665/665 绿；tsc 0；mutex 三态+超时 stall 两臂实测；B-5 真不变量；B-6 RC=2 实测；无新缺陷 |
| 完整性 | 19/20 | C-1 landAnchorSet d.mts 缺口仍在（唯一实缺口）；C-4 见一致性 |
| 一致性 | 19/20 | B-2/B-3 修复到位；C-2 数字单位误标 + C-4 README 漏记新面 |
| 可验证性 | 15/15 | B-7 定谳：口径命令化且独立复现精确同值；R1 返工后复钉同值 |
| 安全回滚 | 10/10 | mutex/超时强化无人值守安全面；lease 30min 合理（tick 由超时+提取时长约束，远小于 lease）；O_EXCL+stale 接管竞态安全（败者礼貌跳过） |
| 可维护性 | 9.5/10 | C-3 注释算术 + C-5 观测面透传缺口；其余结构不变上乘 |
| **总分** | **97.5/100** | < 98 → 打回（第 2 轮=最后一轮；C-1..C-5 全为行级修复，修齐后预期 ≥98；若第 2 轮后仍 <98 按 §12.4 升级主线裁决） |

硬阻断核对（§12.3）：全过（无伪造、无底线违规、正确性 25≥23、安全回滚 10≥9、测试全绿、遗留全部登记、无 del 越权）。

## 交接（r2）

```
FROM: reviewer-B3  TO: main
MODE: fix
TASK_REF: ZCTX-PATCH-AUTO B3 gate round 2
PAYLOAD: SCORE 97.5/100（正确性25 完整性19 一致性19 可验证性15 安全回滚10 可维护性9.5）；[阻断] 0；残留 C-1..C-5（OPEN，全行级）；六项修复全部独立验证 FIXED；B-4 600s 偏差裁定成立
ATTACHMENTS: tasks/ZCTX-PATCH-AUTO/handoffs/review-B3.md（r2 段）; tasks/ZCTX-PATCH-AUTO/scorecards/B3.json（r2 终评）

---

# r3 终审（B3 返工第 2 轮后 · 2026-11-18）

- 对象：9ac2b99（C-1..C-5 行级修复）+ 464ec5d（STEP-0011 checkpoint）
- 方法：五项修复逐一独立复核 + 亲跑 tsc/pnpm test + R1 三数字独立复测

## C-1..C-5 独立复核（全部 FIXED）

- **C-1 — FIXED**：`landAnchorSet` 声明补入 zctx-patch.d.mts（JSDoc 完整，签名/返回面与 mjs 实现逐一吻合）。导出面复测：**53/53，missing=[]，缺口归零**。
- **C-2 — FIXED**：README 更正为"两侧切片均为 14926 字节 UTF-8；14889 为字符数，勿混"。本评审独立复测：**chars=14889 / utf8 bytes=14926**，与更正后文字逐一吻合。
- **C-3 — FIXED**：注释改为"600 s sustains ~0.5 MB/s (= 4 Mbit/s)"且 120s 句同步更正为"~2.5 MB/s sustained"——两个数字均正确（300MB/600s=0.5MB/s；300MB/120s=2.5MB/s）。
- **C-4 — FIXED**：README auto 节新增"两个新增运行面"块——网络有界（20s/600s + 超时响亮面名）、mutex（auto.lock、O_EXCL+30min 租约、already-running 礼貌跳过 exit 0 + 审计行、mutex-takeover 一次性接管、非 EEXIST fatal、finally release、env 覆盖）——与代码逐条对得上，无失真。
- **C-5 — FIXED**：runAuto 'refused' detail 现拼接 `(status: ${status.note})`（note 在场时）——数据锚集损坏的校验器原因进入 auto 日志；既有 'refused' 臂（9.9.9）仍绿。

亲跑：`npx tsc --noEmit` exit 0；`pnpm test` → **31 文件 665/665 PASS（2.85s）**。R1 切片返工后终钉：**chars 14889 / bytes 14926 / sha256 8e2d0b7e…（d951ebf 与 HEAD 同值）**。

## 终审发现

### [阻断]（无）　### 残留 [建议]（无——C-1..C-5 全部 closed/fixed）

观察一项（零扣分、零动作，disposition=not_applicable）：statusAsar 对 source='error' 的 note 存在措辞叠词（"data anchor set rejected — data anchor set rejected: …"，前者为 statusAsar 拼装、后者为 loadAnchorSetData reason 自带前缀）——纯文案冗余，无行为面，r1/r2 同路径已在读未达动作阈值，不立新项。

### 已知开放项（不变，随 B4/B5 走，不属 B3）
- [U1] 灰度算法置信（代码/README 已如实标注）；[U2] 真实 ~300MB 下载（B5）；[U3] 真 7z 提取（B5）；真机 V1/V4/V6/V8/V12/V13 实证（B5）。

## r3 终评（六维；评审人 ≠ 作者；全部证据本机复现）

| 维度 | 分 | 依据 |
|---|---:|---|
| 正确性 | 25/25 | 665/665 绿、tsc 0、C-5 透传实测、B-1 六例、mutex/超时五臂、exit code 实测（r2 基础上零回归） |
| 完整性 | 20/20 | C-1 关闭：53/53 导出面对齐，唯一缺口归零 |
| 一致性 | 20/20 | C-2/C-4 关闭：README 三数字与新两面均与实测/代码一致；DR 编号、plan 契约全程无歪曲 |
| 可验证性 | 15/15 | R1 三数字独立复测吻合；全程证据（r1/r2/r3）可复现，无未复现声称 |
| 安全回滚 | 10/10 | fail-closed 全景 + mutex/超时 + 范围锁 + 备份先验证，全程零回归 |
| 可维护性 | 10/10 | C-3/C-5 关闭；结构/命名/注释/注入点上乘，无遗留 nit |
| **总分** | **100/100** | ≥ 98 放行门 → **PASS，放行 B4（tester+verifier）→ B5（真机 OPS）** |

硬阻断核对（§12.3）：全过（无伪造、无底线违规、正确性 25、安全回滚 10、测试全绿、遗留全部 disposition（C-1..C-5=fixed；观察项=not_applicable）、无 del 越权）。

## 交接（r3 终审）

```
FROM: reviewer-B3  TO: main
MODE: normal
TASK_REF: ZCTX-PATCH-AUTO B3 gate final
PAYLOAD: SCORE 100/100（正确性25 完整性20 一致性20 可验证性15 安全回滚10 可维护性10）；[阻断] 0；[建议] 0 OPEN（C-1..C-5=fixed，观察1=not_applicable）；verdict=PASS 放行 B4→B5
ATTACHMENTS: tasks/ZCTX-PATCH-AUTO/handoffs/review-B3.md（r1+r2+r3 全段）; tasks/ZCTX-PATCH-AUTO/scorecards/B3.json（r3 终评）
