# REVIEW-W1W2 — W1+W2 联审交接（CARD-R1）

```
FROM: reviewer-R1 (独立对抗评审 subagent)
TO: 主线 (ZCTX 调度)
MODE: normal (W1 通过 / W2 打回, 0 阻断 5 建议)
TASK_REF: CARD-R1 (tasks/ZCTX/cards/CARD-R1-review-W1W2.md)
PAYLOAD: ARTIFACTS + SCORE + CHECKPOINT 见下
ATTACHMENTS: tasks/ZCTX/scorecards/W1.json, tasks/ZCTX/scorecards/W2.json (本文件为评审正文)
```

## 一、结论

| 块 | 范围 | 总分 | 判定 | [阻断] | [建议] |
|---|---|---:|---|---:|---:|
| W1 | dedfe2f..dbc3ec9（含基线 dedfe2f 内容） | **99** | **通过**（≥98 放行） | 0 | 1（W1-F1，须 disposition） |
| W2 | 0701f1d..0c89d0a（8 提交） | **95** | **打回**（返工第 1 轮/上限 2；修完重审 ≥98 放行） | 0 | 5（W2-F1..F5，均须 disposition） |

- 无伪造证据/测试造假：全部声称结论由本评审亲自重放（三绿、锁表复算、哈希抽验、n-gram 净室核查）。
- 评审人 ≠ 作者；只读评审，除三个授权落盘文件外零写入（`git status` 干净，重建 lib 与入库 blob 字节一致）。

## 二、W2 打回清单（精确修法，全为建议级；按协议仍须全部 disposition 后才算闭）

1. **W2-F1（budget 退化窗口）** src/budget.ts:85,93-94,122 — JSDoc 声明 `contextWindow` "integer ≥ 0" 且放行 0，但 W=0 → rMin=-Infinity（除零）、W=1 → keepRecent=-4915（评审实测）。修法：收紧为 integer ≥ 1（JSDoc+入口守卫抛 TypeError）并加 W=1 抛错 / W≈32768 对拍两条边界测试；或保留 ≥0 但文档化退化输出并钉测试。**推荐前者。**
2. **W2-F2（validator 未测分支）** src/validator.ts:182 — `if (idx < 0) idx = 0`（整面在保护 floor 之下→全保护）无测试，卡验收"validator 全分支覆盖"差此一支。修法：protectionFloorTokens=20000 > surface 总 19200 的用例，期望拒收含 'protected recent tail'。
3. **W2-F3（fill 位置）** src/validator.ts:76-81 + nudge.ts:19 — 模板渲染器不住在声明的"模型可见文本单家园" texts.ts。修法：fill() 移入 texts.ts，两处导入点随之更新。
4. **W2-F4（死分支）** src/validator.ts:84-87 — fmtNum 三目两侧同表达式。修法：`return String(Math.round(value * 1000) / 1000)`，输出字节不变。
5. **W2-F5（两处注释/契约小疵）** types.ts SurfaceNode.isUser 恒等于 role==='user'（双真源漂移风险，W3 生产方）→ 注释固化不变式或降级可选；budget.ts:55-57 "never under-count on the wire" 超出 CCM L0 "ASCII 密集" 适用域 → 注释对齐权威口径。

返工后重审口径：F1 的守卫/文档+F2 的测试必须落地（这线性影响正确性/完整性两维各 1-2 分）；F3/F4/F5 为一处移动+三行注释级修改。全部修完预期 ≥98。

## 三、评审清单逐项核验（CARD-R1 八项）

1. **锁表对拍**：✅ 评审独立重实现 7/7 复算全对（非复用 src 代码；容差 ±2/±0.002 内，200k rMin 87.7500% vs 表 87.8%）。取整方向与 CCM §1.2 逐式一致（budget.ts:105-122，floor/ceil 无一反向）。breakeven 与 VERIFY-C #15 逐式一致（budget.ts:193-197；默认价 1.0/0.1/4.0；除零显式消解+三态测试）。
2. **validator 全分支**：✅ a-g 每分支有测试映射（32 用例）；仅 :182 兜底分支缺测（W2-F2）。第一条 user 消息 pin 测试在位（validator.spec.ts:210-215）。
3. **净室抽查**：✅ 机械验证 texts.ts 全部文本 vs bctx-work compression-rules.ts + nudge-text.ts：6 词与 8 词 n-gram 重叠 = 0；人工对读机制语义对齐、措辞全原创。
4. **guidance 硬约束**：✅ 无时间戳/计数器正则断言；`complete` 键结构断言（Object.keys 精确 4 键）；PTC 一句在位（texts.ts:63-65）。
5. **unfold 形态**：✅ materializeRange 产出 = 有序 text-block 数组（B1 单节点多块）；活跃 checkpoint 一层展开 `[folded block <id>]`、stale checkpoint 按 user 渲染、缺 seq 显式占位，均有测试。
6. **契约一致**：✅ 无宿主运行时 import（仅相对导入+node:module）；无 isConcurrencySafe；无 complete:true；source payload `{kind,foldId,tokensBefore?,tokensAfter?}` 双位一致（types.ts + message-source.d.ts，且 MessageSourceMap 官方锚点 packages/llm/llm/src/message.ts:110 实证）；interpolate:false 为官方真实字段（system-prompt/src/index.ts:67-68）；cordis.patch.yml 与官方 base 形态同构。
7. **三绿亲验**：✅ build ✔（重建字节一致）/ lint exit 0 / test 107/107 exit 0。
8. **W1 专项**：✅ package.json 12 项逐条核实；lib 3 blob 在 git 树；patch yml 对照官方 base 形态同构；.gitignore node_modules 忽略/lib 不忽略。⚠ 1 项偏差见 W1-F1。

## 四、W2 coder 披露处置核验（补充输入）

- 卡面 W2-cores.md:11 写 "W=200704: 175616/24576/0.878" — 确为笔误。
- 评审独立探针：`W=200704` 下 maxTokens 被 floor(200704×0.1)=20070 封顶，**任何**输出帽 C 都复现不了权威行 maxTok=20480 / trigger=175616；W=204800 才几何吻合。
- coder 按 W=204800 处置并登记 checkpoint.json notes.200k-case — **处置正确**，且符合卡面"对拍 CCM v2.3 权威表"的本意。该项关闭（not_applicable：卡面笔误，权威表为准）。建议主线把 W2-cores.md:11 的 200704 修订为 204800 并加一行修订注记（防后续波次复读旧卡）。

## 五、评分依据摘要（六维，全部有证据）

- **W1 = 25/20/19/15/10/10 = 99**：一致性 -1（类名卡面 `Zcontext` vs 实现 `ZcontextPlugin`，src/index.ts:192，未登记；不承重——loader 消费 default export，smoke 已钉现名）。修法：卡面补修订注记（推荐）或改名回 `Zcontext`（不推荐）。
- **W2 = 23/19/19/15/10/9 = 95**：正确性 -2（F1 退化窗口）；完整性 -1（F2 未测分支）；一致性 -1（F3 fill 位置）；可维护性 -1（F4 死分支+F5 两小疵）。

## 六、RSI 收口

- 本评审踩坑复发一次：含反引号的 node 内联脚本走 bash 单行被截断（坑册 A14/A25 同族）——已按既定纪律改用无反引号写法完成，无新增固化需求（既有检查项有效）。
- 无新机制性教训；坑册无条目覆盖"评审用机械 n-gram 验净室"这一做法，供主线考虑是否登记为评审 SOP 检查项（不强制）。

## 七、CHECKPOINT

- reviewer 产物三件已落盘：scorecards/W1.json、scorecards/W2.json、handoffs/REVIEW-W1W2.md（本文件）。
- 仓状态：`git status` 干净（HEAD=0c89d0a），评审过程零残留（重建 lib 与 HEAD blob 字节一致）。
- 下一步：主线派 W2 返工（F1-F5，≤2 轮）→ 重审 → W3。
