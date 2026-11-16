# REVIEW-P6B — P6-B 底座补丁集波对抗评审（第 1 轮）

```
FROM: reviewer-P6B (independent subagent)
TO: 主线 (orchestrator)
MODE: verify → 打回（返工第 1 轮）
TASK_REF: ZCTX P6-B/P6-C — patcher v0.2 五文件补丁集 + 插件伴随 v0.2.2
PAYLOAD: 见下
ATTACHMENTS: tasks/ZCTX/scorecards/P6B.json（本评审评分件，含全部证据）
```

## 复述理解（≤3 行）

评审 9d0aa2b..bb00dc3（5 提交）：patcher v0.2 多文件机制 + 五文件补丁集数据（γ 全内联 + 点火 hunk）+ 多文件测试（Z27 修复）+ 插件 v0.2.2（guard-observe-bridge + status 段 7）+ 终态台账。对照 spec = RES-port-feasibility.md（P6-A 测绘）+ ZCTX-v03-patch-plan §P6-A 裁定 + P4/P3 机制基线。

## 结论

**打回（96 < 98），返工第 1 轮。[阻断] 0；[建议] 2；卫生记事 2（1 处理 1 登记）。**

核心判断：**机制与补丁集数据本体为真且质量高**——评审人对真机做了全套独立复验（21 锚 count=1、五哈希钉、onGuardObserve 运行时全链存活追链、真机零写入、541/541、五探针、closure 120 机器数），打回点全部集中在**非均匀面的聚合/分支决策逻辑**两处小缺陷 + 缺失的边界钉测，修复面极小（两处分支逻辑 + 2 钉测 + 1 词表行）。

## [建议]（不阻塞中间合入，阻塞最终验收；每条须唯一 disposition）

### P6B-R1 · patchAsar 混合面被幂等分支吞掉

- **位置**：`patcher/zctx-patch.mjs:1654-1657`
- **问题**：drifted 过滤后，`pristineFiles.length < total` 即进幂等分支，报 `already applied (N/N files patched-exact)` 且 `ok:true`——混合面（部分 pristine + 部分 patched-exact）下消息数字失实，且与同函数 docstring「anything else refuses」矛盾（refuse 未实现）。可达性：补丁器自身单次原子 rename 写不出该面（崩溃窗两态论证经评审独立复核成立）；v0.1→v0.2 迁移落在 drift 拒收（v0.1 档缺 ops 2-7 替换串 → 重构 undefined → drifted，不经此分支）；仅外来部分写入器可造出混合面——但补丁器的哲学是「refuse loudly, never harden through」，声称的拒收必须真的存在。
- **修复**：`0 < pristineCount < total` → 显式拒收 + per-file face 如实报告 + 补钉测（patch 后手工还原一个 bundle 的 pristine 文本 → 重跑 patch 断言 refused + asar 字节不变 + 无新备份）。

### P6B-R2 · statusAsar patchSet.state 'partial' 死臂

- **位置**：`patcher/zctx-patch.mjs:2015-2021`
- **问题**：`report.patched = files.some(patched-exact || patched-drifted)`；凡含任一 patched-exact 即 `true` → 恒返 `'patched'`。`'partial'` 臂要求 `patched=false 且 some(patched-exact)`——自相矛盾，**永不可达**。后果：官方更新后混合面（如 3 patched-exact + 2 drifted）聚合标 `'patched'`，误导计划自身定义的「官方升级后重打」工作流；CHANGELOG [0.2.2] 明文宣传四态含 partial——文档宣传了不可达态。per-file face 与 driftedFiles 计数仍诚实（信息可得），故 [建议] 级。
- **修复**：聚合重排（全 patched-exact→patched；含 patched 且非全→partial；全 official-unchanged→unpatched；否则 drifted）+ 两条混合面 status 钉测 + CHANGELOG 措辞随实现核对。

## 卫生记事

- **P6B-H1**（随返工处理）：closure.json W5-A6-INSTALL = `disposition:fixed + status:closed`（verified=true 已设）——P3-4 词表规则 fixed→verified，一词之改。
- **P6B-H2**（登记 P6-E）：patcher/README.md 仍为 v0.1 单桩叙述——计划波次表已把补丁集/重打/回滚文档归 P6-E，非本波缺陷；列为 P6-E 检查项防漏。

## 评审人独立复验全录（评分证据）

1. **真机只读双证**：`node patcher/zctx-patch.mjs status --app-dir "H:\AiAgent\DeepSeekHarness"` EXIT 0 → 5/5 `state:pristine`（五哈希与钉值逐字一致）+ `patchSet.state=unpatched` + marker absent + appRunning=no；真机 asar 全文 SHA-256 前后两次 `sha256sum` 一致 = `14cfd81c9135bf0afb89417543c94f9ecfe09266574452a9b106890c698725ae`。
2. **锚独立探针**（temp 脚本，官方 @electron/asar extractFile，零写入）：21 个生产 op 锚在真机五 bundle 内 **count=1 全中**；5 个 presence marker **全 0**；身份附带核查：LlmError 官方 llm-pi-ai bundle import 在位（:2，42 处引用）、compaction-basic `info.context.contextWindow`/`info.defaultMaxTokens` 各 count=1、pruner `codePointLength`/`PRUNE_MARKER` 在位。
3. **运行时链追证（补丁链非纸面 inert）**：官方 bundle 只读实读——agent-loop `buildRequest` 返回整 request（:1103）→ `preparedCall?.stream(request) ?? this.loopCtx.llm.stream(request)`（:890）→ dsh-llm runtime `dispatch=(options)=>adapterCall.stream(options)`（:2367/:2431）且 `resolvedOptions` 展开保留额外键（:2459）→ llm-pi-ai `prepareCall` 返回 `stream:(options)=>streamWithSnapshot(options,...)`（:2075-2082）→ streamSimple 调用点 `options` 在作用域（:2142-2148）。⟹ agent-loop 注入的 `onGuardObserve` 键全链存活至补丁 guardSink 行。
4. **点火 hunk 标识符运行时核查**：`this.loopCtx/id/options` 为官方构造器实参赋值（:545-547）；`loopCtx = this.runtime.ctx = cordis ctx`（:1471 + :1349），`.logger` 在位由官方自身 `this.ctx.logger.warn`（:1408，同一对象）证得——评审初查「`loopCtx.logger` 字面 count=0」为假警报（成员存在而字面未出现），**hunk 正确**，记录在此防后人重踩。
5. **Session API 依赖**：`snapshotEvents(from,to)` 双参签名官方实存（dsh-session-lib.js:1529，U1 解真机证实）；`get seq()`（:1554）；`KNOWN_SESSION_EVENT_TYPES`（:79）+ 未知类型拒收面（:302）——session 词汇 op 为真依赖非装饰。
6. **splice/Z27 数学实读**：`shiftFor` 严格 `offset > target.start` = own-delta 排除正解；duplicate start 拒绝；payload 分段 `cursor=start+oldSize` 正确；header 变异仅 size/integrity/offset；witness 采集先于变异（P4-1 谓词延续）；单次 `writeFileSync(tmp)+renameSync` 原子 = 崩溃窗只余全 pristine/全 patched 两态；`verifySplicedArchive` 官方 API 读回 + witness 期望偏移 + 体积记账三重后校验。between-target witness 钉测行为学有效（旧逻辑下目标读回必红）。
7. **三态门/重构法**：`reconstructPristineText` 逆序逐 op（replacement count==1 强制）→ 哈希=钉值才算 patched-exact；apply 期锚唯一性使 op 互嵌不可能（op i 替换含 op j 锚会在 apply 期 count≥2 拒绝）⟹ 重构 sound。
8. **内联保真对照 Go e63ceff2d7**：wrapper 簇/分类器/GuardObserver 逐函数同义；`stableStringify`/`verifyMonotonic` 剪裁与 cache-guardian.ts:160/:451 逐字（编译形差异）；预算三公式与 model-slots budget.ts:87/96/106 逐字 + `DEFAULT_OUTPUT_CAP=32768` + `toolCapToByteLimit×3.5`=l3.ts:63-64；pruner 8 ops 与 Go diff 7 hunks 逐一对应（limitFor 含 minRepresentable 回退同义）；compaction-basic 预算 hunk 与 Go index.ts 同义。三处偏离全部文档化且理由成立：点火默认 true（计划裁定，Go=false 显式覆盖）、A6 不可探测 proceed（fail-loud 会砖死默认点火下的每请求）、pruningMeta 剪裁（官方无在树声明工具）。
9. **五文件 op 集 vs spec**：逐文件对照 RES-port-feasibility §2/§3，锚选与 P6-A 重推导一致（compiled 形态锚：`const iterator = toStreamChunks(snapshot.models.streamSimple(...)` 等，均真机 count=1 证实）。
10. **电池亲验**：npm test 541/541（26 files）EXIT 0；tsc --noEmit 0；五探针 EXIT 0（artifact 6/host-imports 16/real-mount 5/smoke-real-loader 3/activation-surface 11 PASS 含 A11 17 断言亲见）；探针报告 timestamp-only diff 亲读后按先例还原（树归零）；closure 机器数 120（fixed/verified 113 · fixed/closed 1 · dup 3 · uad 2 · na 1；**OPEN=0**）；npm test 重建后 porcelain=0（lib 新鲜度）。
11. **R1-R8 独立复跑全绿** + 新红线：补丁零 body 改写（grep 无赋值面；行为钉 releases[0].body 字节不动）；点火 hunk 只加构造器行、buildRequest 只在 sessionId/signal 之间加 onGuardObserve 键——请求 messages/toolHistory/config 零触碰。

## 评分（六维，证据见 scorecards/P6B.json）

| 维度 | 分 | 依据 |
|---|---:|---|
| 正确性 | 24 | 机制/数据/运行时链独立全验为真；两处非均匀面决策逻辑缺陷（R1/R2）扣 1 |
| 完整性 | 19 | 交付逐项在；混合面边界钉测缺失 + 类型-only 文件豁免理由未显式登记扣 1 |
| 一致性 | 19 | CHANGELOG 宣传不可达态 + closure 词表 1 处扣 1；其余全同步 |
| 可验证性 | 15 | 全部声称独立复现（锚/链/哈希/计数/零写入/电池） |
| 安全回滚 | 10 | 门链+备份+原子写+拒收式失败+真机零写入双证 |
| 可维护性 | 9 | 死臂+矛盾注释（R2/R1 载体）扣 1；其余结构清晰、兼容面整洁 |
| **总分** | **96** | <98 → 打回返工第 1 轮 |

## 放行建议

**暂不合并 main。** 返工第 1 轮（≤2 轮限额）：R1+R2 修复 + 各 ≥1 钉测 + H1 词表行，同波重跑 npm test/tsc/五探针回报证据 → 评审人重评（修复面小，预计 ≥98 放行）。真机 patch 执行仍归 W5-A6-INSTALL 用户命令（P6B-3 uad 在案），不受本打回影响。

---

# REVIEW-P6B 返工复审（第 1 轮 · 2026-11-16）

```
FROM: reviewer-P6B (independent subagent)
TO: 主线 (orchestrator)
MODE: verify → 通过放行
TASK_REF: ZCTX P6-B 返工第 1 轮 — b52ad26..9272f84（98ad145 R1+R2 修复+4 钉 / 970a6e3 H1 词表 / 9272f84 台账）
PAYLOAD: 本节 + scorecards/P6B.json rework_round1_review（全证据）
ATTACHMENTS: tasks/ZCTX/scorecards/P6B.json
```

## 复述理解（≤3 行）

第 1 轮 96 打回（0 阻断 + 2 建议 + 2 记事）后的返工：R1 混合面显式拒收 + R2 patchSet.state 聚合重排（98ad145，+4 钉测）+ H1 closure 词表（970a6e3）+ p6b-rework-r1 台账（9272f84）。复审=逐项亲验 + 修复面新鲜代码对抗性复读 + 电池独立重跑。

## 结论

**通过放行（返工第 1 轮后总分 100 ≥ 98）→ 建议合并 main 进 P6-D。[阻断] 0；第 1 轮全部条目 closed（R1/R2/H1 = fixed/verified；H2 = not_applicable 归 P6-E）。**

## 逐项亲验

### P6B-R1 · fixed/verified（98ad145）
- **实读**：patchAsar 新增专用 mixed-face gate（`patcher/zctx-patch.mjs:1657-1676`，drifted 拒收之后、幂等分支之前）：条件 `0 < pristine < total` 精确（drifted 已先行过滤）；返回 `ok:false + refused:true + per-file face（target/state/sha256）+ recovery 指引`（restore --app-dir 默认最新备份——与 restoreAsar 默认逻辑一致，指引可执行；或手工处置）。幂等分支注释改为「the only remaining case after the drifted and mixed-face refusals」——此后 `pristine < total ⟺ pristine == 0 ⟺ 全 patched-exact`，第 1 轮失实的 `(N/N files patched-exact)` 消息面自此恒真。文件头 gate 清单第 5 条同步补注。
- **钉测亲验**：全量 patch → 外来部分写入器（spliceAsarMulti 单目标把 session bundle 回写 pristine 文本——补丁器自身写不出的面）→ 重跑 patch：断言 ok:false + refused + `mixed-face gate:refused` + detail 含 `1 pristine + 4 patched-exact` 与 `dsh-session` + recovery 含 restore 指引 + per-file face 逐行（session=pristine / 4 行 patched-exact）+ **三零动**（拒收跑前后 asar 字节哈希不变 / 备份数不变 / marker 字节不变；基线取 splice 后状态——方法论正确）。

### P6B-R2 · fixed/verified（98ad145）
- **实读**：`patcher/zctx-patch.mjs:2040-2054` 聚合重排——全 patched-exact→`patched`；任一 patched 面（patched-exact/patched-drifted）→`partial`；全 official-unchanged→`unpatched`；无补丁面（有 drift 无 patched）→`drifted`。**四臂全可达**（第 1 轮死臂消除）：第 1 轮误报场景 3 patched-exact + 2 drifted 现正确报 `partial`。优先级注释显式化（drift 不掩盖补丁存在、补丁存在不掩盖 drift 行；per-file face + driftedFiles 承载细节）。
- **钉测亲验**：partial pristine-mix（counts 4/1/0 + anchorHit 逐行）· partial drifted-mix（patched 文本追加外来行 → patched-drifted，counts 4/0/1 + guidance 在场）· unpatched→drifted 优先级（全 pristine=unpatched → 外来 drift 一行=drifted 非 unpatched）。
- **CHANGELOG 措辞**：`:32` 四态列举现与实现全同（partial 复活后宣传态全真），无需改动——与 coder 自报「核对=无矛盾不展开」一致。
- **裁定记录**：全 5 行 patched-drifted（无一 patched-exact）聚合 `partial` 而非 `drifted`——与臂定义一致（drifted 臂=无补丁存在面），per-file guidance 仍指向 restore，语义自洽，非缺陷。

### P6B-H1 · fixed/verified（970a6e3）
- closure.json W5-A6-INSTALL `status: closed→verified`（diff 仅 status 词 + updatedAt 两行；verified=true 原已在位）——与 P3-4 统一裁定逐字对位。机器复核：120 items = fixed/verified **114** · duplicate/closed 3 · uad 2（1 closed + 1 verified）· not_applicable/verified 1 · fixed/closed **0** · **OPEN=0**。

### P6B-H2 · not_applicable（维持）
- patcher/README v0.1 叙述归 P6-E 发布波（计划波次表 P6-E 行在案）；登记为 P6-E 检查项。

## 修复面新鲜代码对抗性复读（6 项全过）

① 混合面 gate 不改变 happy path 步序列（gate 仅拒收路径 step——全链 8 步钉测仍逐字通过）；② gate 返回与 drift 拒收同形（files 三元组/refused/report 摊开）——消费面无新形状；③ recovery 指引的 restore 默认行为与 restoreAsar 一致=可执行；④ 聚合重排对 v0.1 单文件入口安全（patched-drifted→partial 比旧 'patched' 更诚实，legacy status 钉测全绿=无回归）；⑤ 新鲜代码无 $-pattern/eval/动态拼接；⑥ R1-R8 复扫：返工 diff 不触碰 body/请求内容/WS/attribution 面，红线保持。

## 评审人独立电池（返工后）

- **test**：npm test → **545/545**（26 files = 541 + 4 新钉；patcher 双 spec 定向 43/43 具名亲见）EXIT 0；重建后 porcelain=0（lib 新鲜度）。
- **lint**：tsc --noEmit → 0 错 EXIT 0。
- **probes**：五探针全 EXIT 0（artifact 6/0/0 · host-imports 16/0/0 · real-mount 5/0/0 · smoke-real-loader 3/0/0 · activation-surface 11 PASS/0 FAIL，A11 17 断言亲见）；探针报告 timestamp-only diff 按先例还原（树归零）。
- **closure**：机器数 120，OPEN=0（见 H1）。
- **真机**：asar 全文 SHA-256 复核 = `14cfd81c…`（与本评审第 1 轮两次读数一致——零写入三证）；patch/restore 未执行（P6B-3 uad 归用户命令不变）。
- **台账**：checkpoint p6b-rework-r1 done（steps 8→9，next=reviewer re-score）；progress 收据两行（含 RSI 草稿归并既有条目——不另开坑册行，裁定合理）；§5 备份 del/20261116-p6b-r1r2-prechange 在案。

## 评分（返工后，六维）

| 维度 | 第 1 轮 | 返工后 | 变化依据 |
|---|---:|---:|---|
| 正确性 | 24 | 25 | 两决策逻辑缺陷修复且算术可证明（幂等分支=全 patched-exact 可证；混合 gate 精确；聚合四臂互斥完备） |
| 完整性 | 19 | 20 | 混合面边界钉测补齐（4 钉）；P6-A 15 项→5 文件的收敛映射经 spec γ 裁定可追溯（对账表归 P6-E 发布文档） |
| 一致性 | 19 | 20 | CHANGELOG 四态宣传现全真；closure 词表全表统一；版本/台账/checkpoint 同步 |
| 可验证性 | 15 | 15 | 全部声称两轮独立复现 |
| 安全回滚 | 10 | 10 | 拒收路径零动面获钉测固化 |
| 可维护性 | 9 | 10 | 死臂与矛盾注释消除；决策树四分支互斥可读；gate 自文档化 |
| **总分** | **96** | **100** | ≥98 → 放行 |

## 放行建议

**建议合并 main**（--no-ff，merge-batch-protocol 检查；merge ledger + tag）→ P6-D 基准对照实验 → P6-E 发布波（patcher/README v0.2 化 + 补丁集/重打/回滚文档 = P6B-H2 检查项；真机 patch 执行仍归 W5-A6-INSTALL 用户命令）。第 1 轮遗留零 OPEN 残留；返工轮次 1/2。
