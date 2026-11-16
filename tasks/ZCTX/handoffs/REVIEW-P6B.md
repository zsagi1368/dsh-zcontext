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
