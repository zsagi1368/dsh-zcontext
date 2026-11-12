# CARD-R1：W1+W2 联审（reviewer 卡）

TASK_ID: ZCTX-R1 · 产出：tasks/ZCTX/scorecards/W1.json + W2.json + tasks/ZCTX/handoffs/REVIEW-W1W2.md

## 对象

- W1 = 提交 dedfe2f..dbc3ec9（骨架：package.json/cordis.patch.yml/tsdown/vitest/src 骨架/smoke 探针/AGENTS/LICENSE/CHANGELOG）
- W2 = W2 coder 落盘的提交区间（纯核心五件+message-source.d.ts+texts.ts；以 git log feat(ZCTX): W2 为准）

## 评审清单（对照 plan v2 §2 验收/§3 契约/§3.5 检查项）

1. **正确性**：budget 锁表 7 案例值逐个对拍 CONTEXT-CACHE-MANAGEMENT.md §1.3（±2 取整容差/rMin ±0.002）；取整方向（floor/ceil）与表一致；breakeven 公式与 VERIFY-C #15（w=1.0/r=0.1/q=4.0）一致。
2. **validator 全分支**：node-0 预检/保护区/配对闭合/净缩门/长度窗/最小区间/原子拒收——每分支有测试；第一条 user 消息 pin 测试存在。
3. **净室抽查**：guidance/nudge 文本与 billion-context 原文（C:\Users\ZS\AppData\Local\Temp\bctx-work kernel/src/compression-rules.ts、nudge-text.ts）做相似度抽查——不得出现逐字/近逐字句（机制语义对齐允许）。
4. **guidance 硬约束**：无时间戳/计数器形态；无 complete:true；PTC 提示一句存在。
5. **unfold 形态**：materialize 产出=单节点多 text-block（B1）；嵌套一层展开正确。
6. **契约一致**：source payload `{kind,foldId,tokensBefore?,tokensAfter?}`（message-source.d.ts）；无 isConcurrencySafe；无宿主 import（grep 检查 src/*.ts 的 import 语句）；schemastery/cordis 零运行时强依赖。
7. **可验证性**：每条评分维度附证据（文件:行号/命令输出）；跑 `pnpm build && pnpm lint && pnpm test` 亲验三绿。
8. **W1 专项**：package.json 12 项断言复核（dsh.bundle/无钩子/无 dsh.client/peerDeps/engines/devDeps 四件）；lib 产物在 git 树；patch yml 语法对照官方 base 形态。

## 评分

按 §12.1 六维（正确性25/完整性20/一致性20/可验证性15/安全回滚10/可维护性10），每维度附证据；<98 项给出 [阻断]/[建议] 分级与精确修法。两份 scorecard JSON（W1/W2 各一份，reviewer≠作者）。

## 约束

- 只读评审：禁改任何源码/测试；只写 scorecards/ 与 handoffs/ 下三个文件。
- 评审人≠作者（你是独立 reviewer）。
- 发现伪造证据/测试造假 → 直接 0 分并报告。
