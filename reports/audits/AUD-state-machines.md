# AUD-state-machines — 持久状态机域行为正确性深审（全量审计令 D1）

- 任务：ZCTX-AUD-D1（card: tasks/ZCTX/cards/CARD-AUD-D1-state-machines.md）
- 评审人：reviewer（未参与实现；评审人≠作者）
- 日期：2026-11-14 · 方式：只读静态深审 + 官方语义对照 + 既有 spec 覆盖面盘点
- 对象：src/store.ts / attribution.ts / fold-engine.ts / validator.ts / materialize.ts（佐证：budget.ts / config.ts / plugin.ts / tools.ts / tests/*）
- 对照物：zDSH-main 官方语义（packages/core/session/src/surface.ts、packages/compaction/compaction-basic/src/region.ts）
- 查册：~/.agents/rsi/INDEX.md 开工首查；命中检查项：报告一律 Write 工具（V3 波 heredoc 截断坑）、Z20 路径解析、Z21/Z22 本波 P0 相关。本审计未触发新坑。
- 与 C 域审计的关系：C 域（AUD-architecture.md，健康度 8.5/10）已从结构角度指出「feed 有序唯一假设无防御」（TOP3 seq 单调守卫）。本报告按卡面要求从**攻击序列**角度扩展，不重复结构论证；每条发现标注与 C 域的覆盖关系。

---

## 分级统计（先给结论）

- **[真缺陷] 2 条**（SM-01、SM-02）——建议入 P3 清单修复；不修不能最终验收。
- **[边界强化] 5 条**（SM-03、SM-04、SM-05、SM-06、SM-12）。
- **[覆盖盲区] 5 条**（SM-08、SM-09、SM-10、SM-11、SM-13），各附钉测建议（不实现）。

**守卫成立面（对抗后确认有效，供验收引用）**：
- W3-2 数值过滤≡官方位置切片不变式：官方 apply 路径确实执行 sourceEventSeqs ⊇ 位置切片超集校验（zDSH-main surface.ts:537 `assertSourceEventReferences(event, range.shadowedSeqs)`）+ seq 连续强制（surface.ts:514）+ 位置切片语义（surface.ts:419-428 indexOf→splice）；本插件 validator check a 的连续+单调守卫（validator.ts:158-168）与引擎数值过滤（fold-engine.ts:286-288）在多 entry 提交下逐一推演等价（summary 数值区间互斥由 REASON_SUMMARY_OVERLAP 保证，validator.ts:349-364）；fold-engine.spec.ts:382 已有钉测。守卫成立。
- compaction 互斥孪生：`compactionActive`（store.ts:863-869）与官方 `assertCompactionInactive`（region.ts:308-320）在 8 种括号异常形态下逐一推演全部吻合（详见 §4 表）。
- 嵌套吸收降级：外层 fold 的 sourceEventSeqs 必含内层 checkpoint 节点 → absorbed（fold-engine.spec.ts:304-329 已钉）。
- resetBetween cap 守卫（store.ts:1314-1317 + store-attribution.spec.ts:316-334 已钉）；interpolated 停走条件（turn 变更/reset/未知 turn）已钉。
- 外部会话隔离（store.ts:631）、feed 先于 store 存在时静默跳过 + 懒 attach 全量扫描兜底（plugin.ts:300-308, 624-641）——无残缺视图采纳路径。

---

## §1 applyEvent 异常事件注入（卡面重点 1）

### [真缺陷] SM-01 applyEvent 无幂等/单调守卫：重复与乱序投递造成状态机回退

- 位置：store.ts:905-908（applyEvent 开头无条件执行）、store.ts:630-642（onEvent 仅对 `seq > syncedToSeq` 修 gap，对 `seq <= lastSeq` 的重复/乱序事件直接 applyEvent）。
- 攻击序列（宿主 feed 违约 / mock 环境 / resync 交互可达）：
  1. **fold 状态复活**：seq10 fold F1 → seq20 unfold F1（status=unfolded）→ 宿主重投 seq10 → applyEvent 重执行 zctx-fold 分支（store.ts:961-972）→ `ledger.set(F1, {status:'active'})` → 已 unfold 的 fold 复活为 active，进入 foldMap。后续 zctx_status 显示错误状态；attribution 候选集重新纳入 F1。
  2. **compaction 括号重开**：seq10 compaction/start → seq12 compaction/end → 重投 seq10 → `compactionStartSeq=10` 重设 → compactionActive=true → **fold/unfold 从此永久拒收**（fold-engine.ts:266, 434），直到下一个 end——功能级 DoS。
  3. **计数膨胀**：重投 assistant/message → usageLedger 双记录、measuredSamples/threeState 双计（store.ts:1125-1140）→ 三态占比失真。
  4. **lastSeq 回退引发级联重放**：重投 seq0 使 lastSeq 1→0（store.ts:908 无条件赋值）→ syncedToSeq 回退 → 下一次 onEvent(seq1) 触发 scanUpTo（store.ts:636-640）→ **seq1 被 eventAt 重读并二次 applyEvent** → 腐败自我放大。
  5. **乱序投递**（seq < lastSeq 且从未见过）：直接 applyEvent，所有转移按错误事件序计算；attributeMessage 的 `lastAssistantMessageSeq` 无条件回退（store.ts:1159）→ 后续消息归因窗口失真。
- 测试误标实锤：store.spec.ts:289-297「treats duplicate delivery of one seq as a no-op」**实际只投递一次**——MockSession 的 onAppend 监听无人注册（mock-session.ts:99-103，emit 在 :180 但测试未接线），事件并未重复；若真投两次，按当前实现 samples=2 测试会红。即：守卫不存在 + 覆盖为零，测试名制造了已覆盖的假象。
- 与 C 域关系：C-TOP3（seq 单调守卫缺失）的结构性结论成立；本条提供其行为后果的完整腐败序列 + 测试误标证据，**非重复计条**。
- 修复建议（供 P3）：applyEvent 入口加幂等守卫——`seq <= lastSeq` 且 `eventsBySeq.has(seq)` → 直接 return（可记 anomaly）；`seq < lastSeq` 且未见 → anomaly + 丢弃或触发全量 attach 重扫。同步改写 store.spec.ts:289 为真重复投递断言。
- 钉测建议：真重复投递 fold/unfold/compaction/start/assistant/message 各一，断言 ledger 状态、compactionActive、计数均不回退；乱序投递断言 lastSeq 单调不减。

### [真缺陷] SM-02 extractCheckpointSource 不验数值有限性：一条畸形事件永久打断 zctx_status

- 位置链：
  1. store.ts:289-290 仅验 `typeof === 'number'`——±Infinity/NaN/负值全部放行（对照 extractUsageRecord store.ts:322-326 有 Number.isFinite，证明是遗漏非设计）。
  2. store.ts:969-970 `tokensBefore: checkpoint.tokensBefore ?? 0`——Infinity/NaN/负值原样入账（`??` 不拦非 null 值）。
  3. buildObservabilitySnapshot（store.ts:847-861）把 entry.tokensBefore 原文传给 computeBreakevenReport（attribution.ts:368-372）。
  4. budget.ts:170-178 assertBreakevenAmount → budget.ts:90-94 assertAmount 对 `!Number.isFinite || 非整数 || < 0` **throw TypeError**。
  5. tools.ts:731 `store.observabilitySnapshot()` 在 renderStatus 内无 try/catch；zctx_status 工具 execute（tools.ts:998-1003）直接返回 renderStatus——**工具执行抛错**。
- 可达性：官方会话对 user/message 的 source 载荷不校验（source 为不透明元数据；官方 session src grep `tokensBefore` 零命中）——surfaceOp 与 sourceEventSeqs 的校验（surface.ts:330-378）不覆盖载荷数值。任何同进程生产者/坏日志导入提交 `source:{kind:'zctx-fold', foldId:'fX', tokensBefore:-1}` 即完成投毒；该 fold 获得 strong/retry 归因后（首次 post-fold M + 干净窗口），每次 zctx_status 调用都抛错且**状态不可自愈**（会话日志永久含投毒事件）。tokensAfter 路径同理（attribution.ts:366 `repayTokens = billed ?? fold.tokensAfter` 在 sample 逐出后落到投毒值）。
- 违背的自身声明：store.ts:146-147「honest ledger, no throwing」。
- 修复建议（供 P3）：extractCheckpointSource 改用 Number.isFinite + 非负判定（与 extractUsageRecord 孪生对齐）；非有限值 → 丢弃字段（落 0 或记 anomaly），并给 renderStatus/execute 包一层 fail-soft 兜底。
- 钉测建议：投毒事件（-1/NaN/Infinity 各一）→ 断言摄入被拒（anomaly ledger 有痕）且 observabilitySnapshot 不抛。

---

## §2 foldMap 状态机非法转移可达性（卡面重点 2）

### 结论：可达域内未发现非法转移路径；防御距腐败仅一步（SM-06）。

- 状态机：active → absorbed（新 fold 影子化，store.ts:961）/ dead（外来 replace 影子化，store.ts:947-950）/ unfolded（unfold，store.ts:952-957）。
- absorbed/unfolded 后再 unfold：foldMap 只暴露 active（store.ts:644-651），unfold 走 REASON_FOLD_NOT_ACTIVE（fold-engine.ts:402-412）——正确。
- checkpoint 节点消失后的 unfold：REASON_CHECKPOINT_GONE（fold-engine.ts:421-430）——正确。
- 跨 compaction 窗口折叠：bracket 内 fold/unfold 全拒（fold-engine.ts:266, 434）——正确。
- 嵌套吸收覆盖式窗口被 check a 单调守卫拦截（validator.ts:18-25 注释自述 + fold-engine.spec.ts:367 注释）；reachable 吸收域=边界对齐 [checkpoint, checkpoint]。推演确认：任何数值覆盖 active checkpoint 的可达窗口，其 inRange 必含该 checkpoint 节点（位置在前+后继节点 seq 更小 → 非单调被拒）或边界恰为其自身 → sourceEventSeqs 必含之 → 必被降级。**幻影 active 在官方会话 + check a 双重防御下不可达**。
- 未知 foldId 的 unfold 事件：静默忽略（store.ts:953-956 entry undefined 直接 return，无 anomaly）——fail-soft 可接受，但诚实台账角度建议记 anomaly（并入 SM-06 建议）。

### [边界强化] SM-06 unfold 分支对嵌套 active checkpoint 无防御（当前不可达，单守卫弱化即成永久幻影）

- 位置：store.ts:952-957（unfold 只翻自身 foldId）+ fold-engine.ts:464-467（sourceEventSeqs 只带外层 checkpoint seq）+ materialize.ts:111-114（仅 ACTIVE checkpoint 展开 marker）。
- 假想序列：若外层 fold 的 span 内存在仍 active 的内层 checkpoint 事件，unfold 后其 checkpoint 节点被单节点替换消灭（materialize.ts 注释自证 B1 单节点形态），而 sourceEventSeqs 不含内层 checkpointSeq → 内层 fold 永久 active（幻影）→ 无任何转移可清除（其 seq 永不再出现在任何 replace 的位置切片里）→ foldMap 污染 + REASON_ABSORBED_UNCOVERED 误拒（validator.ts:287-307 对数值覆盖其 checkpointSeq 的窗口强求 summary 覆盖）。
- 可达性论证（为什么今天不是真缺陷）：内层 checkpoint 节点若在面上，必落入外层 fold 的数值过滤集 → 提交时即 absorbed（官方超集校验 surface.ts:537 保证）；若不在面上，它早已非 active。check a 的单调守卫（validator.ts:158-168）关闭了「checkpoint+后继节点」窗口。两道防御任一弱化（官方校验回归、check a 被改、mock 直注 store）即触发幻影且**不可自愈**。
- 建议：store 端 zctx-unfold 分支防御性展开——把 `[entry.startSeq..entry.endSeq]`（从 ledger 记录取）内仍 active 的 checkpoint 一并降级（absorbed 或新 status）；未知 foldId unfold 记 anomaly。钉测建议：mock 直注「active checkpoint 事件位于 unfold span 内」的畸形序列，断言不产生幻影 active。

### [覆盖盲区] SM-13 unfold 重展开 absorbed 内层 checkpoint 的渲染语义无钉测

- materialize.ts:111-114 注释自认：stale（非 active）checkpoint 渲染为普通 user 块（即 absorbed 内层 fold 展开为其 summary 原文）。该语义（嵌套摘要随外层 unfold 回到面上）正确但无测试锁定；若未来改为「递归展开到原始内容」会静默改变面额外语义。
- 钉测建议：外层 fold 吸收内层 → unfold 外层 → 断言内层 checkpoint 事件渲染为 `[user]\n<summary>` 而非 marker 或原始内容。

---

## §3 归因引擎边界（卡面重点 3）

### 多折叠同窗竞争：结论——按 §Q4.2 设计正确执行，无缺陷

- 每个 window 内 fold 各自获得归因（foldAttributionLog.set per fold，store.ts:1173-1197）；record 绑定 `nearest` = 最后一次迭代成功项 = Map 插入序最后一项 = checkpoint 序最大项（Map.set 不重排已存在键；foldId 由 `f${nextSeq}` 保证单调唯一，fold-engine.ts:300）→ 与注释「batch folds: the last commit before M is the clean window」一致。敌意 foldId 复用（f10 二次提交）会保留旧插入位 → nearest 绑旧归因——仅影响 record 展示字段，per-fold 台账仍正确；低危，记录在案（防御：attributeMessage 迭代前按 checkpointSeq 排序）。
- 死亡/吸收 fold 的归属：影子化 replace 落在 F..M 窗口内 → otherReplace → weak（attribution.ts:225-227, 273）；落在 M 之后 → 归因已在 M 时定格 strong（历史账正确性成立）。
- interrupted 样本：flag 透传（attribution.ts:283, 266）；weak 判定不受 interrupted 影响（§Q4.3 noise 7 语义正确——input 侧真实）。
- semi 插值与 reset-between：upgradeInterpolatedBefore 停走条件完备（store.ts:1236-1242：measured 阻断、turn 变更阻断、resetBetween 阻断）；cap 时保守停走（store.ts:1314-1317，已钉 store-attribution.spec.ts:316-334）。side note：cap 后三态占比向 estimated 偏移——诚实保守方向，非缺陷。
- timeWindow 兜底与 seq 主键冲突：链完整性校验（attribution.ts:232-240）要求窗口严格覆盖 (foldSeq, messageSeq)——重复事件使 windowEvents 超长 → chainComplete=false → 落兜底 → weak（保守方向正确）。兜底失败（无时钟/跨 turn）→ 不归属（attribution.ts:242-255）→ 诚实缺席。

### [边界强化] SM-04 归因窗口噪声扫描对 request/header reason:'resume'/'series' 盲

- 位置：attribution.ts:218-219（仅 `reason === 'change'` 置 headerChange）、attribution.ts:273（weak 判定四因子不含 resume/series）。
- 现状评估：实现符合 V3 冻结规格（rule 3 只列 'change'；attribution.ts:23-27）。语义推演：resume=restart 边界——折叠摘要仍在重建后的上下文中，「谁消费」归因成立，strong 可辩护；series=生产者自认消息系列不连续（store.ts:994-1005）——可能伴随 surface 替换（那会经 otherReplace 捕获），但**不伴随替换的纯 series 穿越**下 strong 归因是否成立属规格未决。
- 建议：不改代码的情况下，用钉测固化决策（series 穿越窗口 → 断言 strong，并注明理由）；或补入 weak 因子（规格变更，需走 §10 规则变更控制）。

### [覆盖盲区] SM-10 resume/series 头在归因窗口内的质量分级零覆盖

- attribution.spec.ts 中 resume/series 仅出现在 resetSummary digest 断言（:404, :412），归因质量分级路径零覆盖。
- 钉测建议：F → (resume header) → M 完整链 → 断言 strong（若采纳 SM-04 现状）；F → (series header 无 replace) → M → 同断言，注释写明决策依据。

---

## §4 与官方 compaction 的交互状态机（卡面重点 4）

### 互斥孪生推演表（store.ts:863-869 vs zDSH-main region.ts:308-320，全部吻合）

| # | 形态（seq 单调） | 官方判定 | 本插件判定 | 一致 |
|---|---|---|---|---|
| 1 | start10 无 end | busy | active=true | ✓ |
| 2 | start10, start20 无 end（双 start） | busy（反向扫描最近标记=start20） | compactionStartSeq=20 → active | ✓ |
| 3 | start10, end12, start20 无 end | busy | active | ✓ |
| 4 | start10, end-seed20 无 end | inactive（seed > start） | endSeed 20 ≥ 10 → inactive | ✓ |
| 5 | start10, end-seed15, start20 无 end | busy（seed 15 ≤ start20） | 15 < 20 → active | ✓ |
| 6 | start10, end12, end-seed18 | inactive（最近标记=end） | compactionStartSeq 清除 → inactive | ✓ |
| 7 | 孤儿 end（无 start） | inactive | 无操作 → inactive | ✓ |
| 8 | start10, end-seed20, start25, end-seed30 无 end | inactive（最近 seed 30 > start25） | 30 ≥ 25 → inactive | ✓ |

- 官方语义关键点：反向扫描取**最近**括号标记决定 unmatched（region.ts:574-582）；end-seed 仅在「晚于 unmatched start」时释放锁（region.ts:313-315）。本插件用 `endSeedSeq < compactionStartSeq` 判活——因 seq 单调且 compactionStartSeq 只被更晚 start 覆盖、endSeedSeq 只增，两者在全部可达形态下等价。
- 括号内 classifyReplaceReset 跳过（store.ts:1039）——start 已记 reset，符合卡面「非 compaction 括号内」限定；自有 checkpoint 的 merge-rewrite 先于括号检查（store.ts:1029-1037）——bracket 内不可能有自有 checkpoint（fold 被拒），仅 mock 直注可达，无害。

### [覆盖盲区] SM-09 括号异常形态钉测缺失

- store.spec.ts:243-267 仅覆盖基础开合与「end-seed 先于 start」两态。上表 8 形态中 2/3/5/7/8 无钉测；孪生与官方的一致性目前仅靠推演与注释声明维持。
- 钉测建议：按上表逐形态断言 compactionActive()（这是最便宜、防回归价值最高的一组钉测）。

---

## §5 数值边界（卡面重点 5）

### [边界强化] SM-03 scanUpTo 无上界、无连续不可读熔断

- 位置：store.ts:887-897。`sessionSeq`（store.ts:1372-1375）只验有限非负——mock/损坏宿主给 session.seq=1e12 → attach 循环 1e12 次（每次 anomaly 记账被 256 cap 限制但**循环不因 cap 停止**）→ 挂死。官方会话 seq=真实日志长度，可达性限于 mock/异常宿主。
- 建议：连续 K（如 16）条 unreadable-event 即停止扫描 + 记 anomaly（fail-soft 但有界）；或对单次扫描跨度设上限。

### [边界强化] SM-05 validator 配置极值无守卫（config schema 只验类型/有限性）

- config.ts:256-266 fail-soft shim 仅 `typeof number && Number.isFinite`；schemastery z.number()（config.ts:282）同样无范围。后果：
  - keepRecentMessages=-5 → protectedFromIdx=length（validator.ts:182-184）→ **消息数尾保护静默关闭**（不安全方向；last-user/node-0 兜底仍在，但最近工具往返可被折叠）。
  - maxFoldFraction=-1 → check f 恒拒（validator.ts:378-391）→ 全折叠拒绝（保守 DoS，方向安全）。
  - summaryCeilingChars < summaryFloorChars → 所有 summary 双双违规 → 全拒绝（保守）。
  - netShrinkTolerance ≤ 0 → net-shrink 门恒拒（保守）。
- 次序备注（并入本条）：fold() 的 mutex 检查在 validator 之后（fold-engine.ts:243-268），bracket 内无谓重验证——纯效率，无正确性影响。
- 建议：config 层 clamp（keepRecentMessages ≥ 0、0 < maxFoldFraction ≤ 1、summaryFloor ≤ summaryCeiling、netShrinkTolerance ≥ 1）或 validator 入口断言非法配置为 TypeError（programmer-error 契约与 assertSurfaceNode 一致）。
- attributionTimeWindowMs 单项已有正确守卫（store.ts:831-835 拒负/NaN 保默认；0 合法——兜底仅同毫秒可过，诚实）；64-cap 逐出族（store.ts:157-189）实现一致、resetBetween cap 守卫已钉。tokensBefore/After 溢出（±Infinity/NaN/负）见 SM-02（真缺陷）。

### [边界强化] SM-12 NaN contextWindow 使 maxFoldFraction 门静默失效

- validator.ts:378-391：`config.contextWindow !== undefined` 不验有限性——NaN 通过 `!== undefined`，`foldedTokens > NaN` 恒 false → 窗口上限门失效；ccmWindowGate（fold-engine.ts:95-97）NaN → legal:true（无法判定不声明，符合其契约）。来源：plugin.ts:699 `info?.context?.contextWindow` 未验有限性。
- 建议：ValidatorConfig 入口（或 plugin 组装处）`Number.isFinite(contextWindow)` 否则置 undefined（门跳过 + ccmGate 不声明是既有诚实路径）。
- 钉测建议：contextWindow=NaN 的 validator 调用——当前行为是 check f 静默跳过，钉测固化或转守卫后钉测拒绝路径。

### [覆盖盲区] SM-11 非有限 tokensBefore/After 摄入零覆盖

- grep 全 tests 零命中（tokensBefore 无 Infinity/NaN/负值用例；attribution/budget 的 NaN 用例只覆盖各自模块入参）。
- 钉测建议：SM-02 的投毒序列三态（-1/NaN/Infinity）各一钉。

---

## §6 既有 spec 覆盖盲区汇总（卡面重点 6；钉测建议不实现）

| ID | 盲区 | 既有覆盖 | 钉测建议 |
|---|---|---|---|
| SM-08 | 真重复/乱序投递（SM-01 序列） | store.spec.ts:289 误标（实为单投递） | 见 §1 SM-01 钉测建议 |
| SM-09 | compaction 括号异常形态 8 形态 | store.spec.ts:243-267 仅 2 态 | 见 §4 表逐形态 |
| SM-10 | resume/series 头穿越归因窗口 | 仅 digest 断言（attribution.spec.ts:404） | 见 §3 SM-10 |
| SM-11 | 非有限 tokens 摄入 | 零命中 | 见 §5 SM-11 |
| SM-13 | unfold 重展开 absorbed 内层 checkpoint 的渲染语义 | materialize.spec.ts:122-139 只测 active 展开 | 见 §2 SM-13 |

已确认覆盖充分（无需补）：W3-2 切片等价（fold-engine.spec.ts:382）、嵌套吸收降级（:304-329）、resetBetween cap（store-attribution.spec.ts:316-334）、interpolated 停走三条件（:237-262）、缺口修复与保留缺口归因（store.spec.ts:232-253）、64-cap anomaly（store.spec.ts:301-309）。

---

## 附：证据索引

- 本插件：src/store.ts（905-908, 630-642, 863-869, 887-897, 952-957, 969-970, 1085-1098, 1125-1140, 1153-1199, 1226-1257, 1314-1317, 1372-1375, 289-290, 322-326）；src/attribution.ts（187-285, 232-240, 218-219, 273, 350-389）；src/fold-engine.ts（220-374, 266, 286-299, 381-496, 402-430, 434, 464-467, 632-716）；src/validator.ts（110-450, 158-168, 179-209, 287-307, 349-364, 367-391）；src/materialize.ts（76-127, 111-114）；src/budget.ts（90-94, 170-178, 196-233）；src/config.ts（131-151, 243-272, 275-317）；src/plugin.ts（300-308, 624-641, 699）；src/tools.ts（731, 998-1003, 742-748）。
- 官方对照：zDSH-main/packages/core/session/src/surface.ts（330-378 超集校验、410-428 位置切片、510-548 apply 路径、514 seq 连续）；packages/compaction/compaction-basic/src/region.ts（566-590 inspectCompactionEntryState、308-320 assertCompactionInactive）。
- 测试：tests/store.spec.ts（273-297 误标证据、243-267）；tests/helpers/mock-session.ts（99-103, 180）；tests/fold-engine.spec.ts（304-329, 367, 382）；tests/store-attribution.spec.ts（237-262, 316-334）；tests/attribution.spec.ts（404, 412）。

## 处置

- 真缺陷 2 条（SM-01/SM-02）+ 边界强化 5 条 + 覆盖盲区 5 条 → 全部移交 P3 清单处置（本审计不实现修复，符合卡面约束）。
- 按纪律要求：每条需唯一 disposition（fixed / user_approved_deferred / duplicate / not_applicable）；SM-01 与 C-TOP3 的关系在 P3 登记时须显式标注「行为扩展非重复」以免 duplicate 误关。
