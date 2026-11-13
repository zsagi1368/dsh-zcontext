# REVIEW-V6 — V6 终审交接（reviewer-R6 · v0.2.0 · 2026-11-13）

```
FROM: reviewer-R6 (independent subagent)
TO: 主线 (ZCTX v0.2.0 orchestrator)
MODE: normal (评审结论：V6 通过放行；最终验收剩 B7 发布门)
TASK_REF: tasks/ZCTX/cards/V6-docs-release.md（R5 四条+V1-A 顺手闭合 + 文档/发布/治理终态）
PAYLOAD: SCORE + 七攻击方向结论 + [阻断]0/[建议]1 + B4-B7 逐条判据 + 亲验证据（见下）
ATTACHMENTS:
  tasks/ZCTX/scorecards/V6.json  (总分 99)
```

## 1. 裁决

| 波 | 有效区间 | 总分 | 门(≥98) | [阻断] | [建议] | 结论 |
|---|---|---:|---|---:|---:|---|
| V6（终审） | dec0bcc^..abbb8b2（R5 顺手闭合 → governance increment → release face → probe extensions → README bilingual → governance terminal，6 提交 +1045/-165） | **99** | PASS | **0** | 1 | V6 块通过放行 |

[建议] V6-1 一条（README 开发节探针清单遗漏 probe-host-imports.mjs，一行×2 侧），不阻塞 V6 块合入，阻塞最终验收——建议随 B7 发布提交一并修（文档与发布同批更新）。**最终验收（计划 §4 全判据）剩余唯一未完成项 = B7 发布门**：Mimosa 深扫 + 推送 + tag v0.2.0 + merge-ledger 条目，owner=主线；推送属 §8.1 确认门，需用户显式确认后执行。

## 2. 亲验证据（reviewer 本机实跑，2026-11-13）

- `pnpm build` → tsdown **988.84 kB**（7 files），EXIT=0；`git status --porcelain lib/` 为空 = 入库 lib 与重建**字节一致**
- `pnpm test` → vitest 22 files **424/424 passed**，EXIT=0（+5 新例轨迹与 dec0bcc 声称吻合：store-attribution 2 + adapter-plugin 1 + adapter-providers 1 + store-observe 1）
- `pnpm lint` → tsc --noEmit 零错，EXIT=0（build→test→tsc 顺序，Z19）
- 四探针全 EXIT=0：probe-artifact **6/6**（P6 实跑输出 missingMaxTokensViolation=true）+ verify-activation-surface **10/10**（A9 schema validate({}) 实调 issues=none；A10 maxRetries sites=1）+ smoke-real-loader **3/3**（R3 **实跑无 SKIP**，7 composed rows）+ probe-host-imports **16/16**；U2 报告重生成仅时间戳差异，已 `git checkout` 还原入库态（沿 REVIEW-V3V4/V5 先例）
- closure 机器数：closure.json **65 items / 64 verified + 1 open**（W5-A6-INSTALL user_approved_deferred，v0.1.0 基线，phase=post-merge，by design）；disposition 词表零违规；V6-A..V6-I 九条全 fixed/verified
- 终态树干净（还原 U2 时间戳后 `git status --porcelain` 为空）

## 3. 七攻击方向结论

1. **R5 四条+V1-A 闭合 — 全部真闭合**。
   - **V5-1（真钉实证）**：守卫行 store.ts:1315 `if (resetLog.length >= RESET_LEDGER_CAP) return true`，调用点 :1242（true→break 不升格）。at-cap 用例构造 64 resets（seq 0..63）+候选 seq 64/锚点 seq 65——两者之间无 retained reset，删守卫行必走插值→semi/interpolated→断言 estimated 变红；at-cap-1（63）用例证明插值路径本身是活的、守卫恰在 cap 分辨。两例同时绿 = 守卫行承重，『删行变红』成立。V3-1 双证据闭环（V5-F 代码修复 + V6-A 测试钉）。
   - **V5-2（官方对齐实证）**：官方 catalog.ts:933-936 本波亲读——`entry.maxTokens ?? base?.maxTokens ?? request.defaultMaxTokens`，解析后非正整数→invalid() 进违规清单。zctx 手写配置无 base/defaultMaxTokens 兜底链，REQUIRED 正是同一 fail-loud 语义的诚实形态；`?? 32768` 从 zctx-adapter.ts wire 面移除（verbatim 直载）；违规模型不入路由（providers[0].models 长度 0 + assertZctxProvidersResolvable throws 双钉，P6/A10 对构建产物复钉）。
   - **V5-3（三方统一）**：config.ts 注释改写为单一口径声明（schema default=configDefaults=smoke 契约钉三方同述 EMPTY list，optional 归属 user input）；三方实点核对（config.ts:147-150/:171-180、smoke.spec:57-60）。
   - **V5-4（前移实证）**：plugin.ts:453-471 现门序 = 协议加载（builtin 兜底 info）→ 违规 warn 全清单+return → 可达性 info → 注册；新钉测试宿主不可达（ZCTX_DSH_LLM→MISSING.js）+坏配置 ⇒ warn 含完整违规清单且 'not reachable' info **不出现**——门序行为被钉死，校验宿主无关性成立。
   - **V1-A（处置合法）**：卡面允许『测试钉死+JSDoc 声明边界』最简处置；store.ts callConfigEquals JSDoc 声明官方 raw === 的 NaN 分歧+官方 wire 不可达论证，store-observe.spec 专钉（两个 NaN 载体相等→零 reset）；closure V6-E evidence 如实写 'pinned-not-fixed path chosen'——分歧被文档化+钉死而非隐匿，实质闭合。
2. **双语 README 镜像 — 机械核对通过**。15 个 `<a id>` 锚点两侧逐行一致（行号 8..216 全同）；数字 token 多重集 diff 为空（比 anchor-by-anchor 更强的一把尺）；九字段+七 v0.2.0 字段表逐行镜像；zh 为自然中文技术文风。诚实天花板三处如实：限制节两条（阈值未标定 90s/0.6/0.9；wire 仅 zctx 路由+对象哈希 harness 边界下盲区）+ CHANGELOG 专节 + 探针输出范围标签。
3. **探针扩展质量 — 断言真钉**。A9 实调 schema validate({})（非读常量）钉 observe 默认+providers [] 双面（configDefaults AND schema 输出，R2+V5-3）；A10 node 直读钉导出面 10 项+KNOWN_PROTOCOLS 官方 union+R4 单站点（注释剥离后 sites=1）+R7；P6 钉构建产物 S2 导出功能性+V5-2 缺 maxTokens 构造违规+fail-loud 完整清单（错误消息含 '1 violation(s)'）。
4. **smoke R3 实跑 — 能力及格真跑非 SKIP**。真 CLI `--profile web --patch overlay --dump-config` 组合出 providers 七行（family/baseURL/id/contextWindow/maxTokens），诚实范围标签在探针输出内（config-layer only；runtime registerConfigurableProviders 需活 llm runtime→post-merge full-install smoke）——与卡面『能力不及→SKIPPED 明示』相反：能力及格，做了实跑并诚实声明边界。临时 overlay 目录 mkdtemp+zctx-v6-smoke- 前缀+tmpdir 根双守卫清理（§5.1 同型）。
5. **CHANGELOG 0.2.0 — 六要素齐**：观测账本+S1 preflight（三态+默认 observe+短路形态）+新设置七字段+S2 全量段（family=协议/寄生传输 R1/R4/R7/wire 账本双域/缓存旋钮/最小目录 visibility-only/text-only/config shape REQUIRED contextWindow+maxTokens per catalog.ts:934-936）+observe→enforce 迁移三条件+『Honest ceilings and calibration debt』专节。
6. **closure 65 条 — 机器数吻合**：64 verified + 1 open（W5-A6-INSTALL by design）；V5-1→V6-A、V5-2→V6-B、V5-3→V6-C、V5-4→V6-D、V1-A→V6-E 映射经 source 字段逐条核对；V6-F..I 覆盖 README/CHANGELOG/探针/smoke/版本终态。
7. **亲验 — 全绿**（详见 §2）；版本面三处一致（package.json=CHANGELOG=README 均 0.2.0）；RSI Z20 经查在 ~/.agents/rsi/INDEX.md 登记（含 heredoc 违规自纠），本波 no-new-lesson 声明与 ~2.6KB heredoc 边界披露一并如实落盘 progress [12:55]。

## 4. B4-B7 判据逐条结论（计划 §4）

| 判据 | 结论 | 证据 |
|---|---|---|
| B4 U1/U2 探针+目录注册 | **PASS** | reports/probes/U1-models-ui.md（V1 波，GO→visibility-only 按 U1 发现实现）+ U2-host-imports.md（本波亲跑 16/16）；V6 smoke R3 能力及格→真跑非降级 |
| B5 全量绿+探针扩展全绿 | **PASS** | 424/424 + tsc 零 + build 988.84 kB + surface 10/10 + artifact 6/6 + smoke 3/3 + host-imports 16/16（全部 reviewer 亲跑） |
| B6 README 双语+CHANGELOG 0.2.0 | **PASS** | 锚点 15/15 行号全同+数字 token 多重集 diff 空；CHANGELOG 六要素齐（§3.5） |
| B7 发布 v0.2.0 | **NOT DONE（发布门待走）** | 无 tag v0.2.0（仅 v0.1.0）；origin/main..main 46 提交未推（整个 v0.2.0 战役 V1-V6）；reports/ 无 0.2.0 Mimosa 深扫记录（v0.1.0 有 scanId 先例）；governance/merge-ledger.md 无 0.2.0 条目。owner=主线；推送需用户 §8.1 显式确认 |

B7 不是 V6 六提交的缺陷，而是评审通过后的既定发布步骤；但按 §11/§3，**最终验收在 B7 完成前不得宣告**。

## 5. [建议] 清单（0 条 [阻断]）

| id | 位置 | 问题 | 修法 |
|---|---|---|---|
| V6-1 | README.md:226-228 + README.zh.md 同位段 | 开发节 verification probes 清单列 3 个探针，遗漏 scripts/probe-host-imports.mjs（16 组，四探针电池成员）——V5 既有缺口，本波重写该节并更新其余三个计数时未补 | en/zh 各加一行 `node scripts/probe-host-imports.mjs  # dsh-llm host-import reachability (16 groups)` 同款；随 B7 发布提交一并入库 |

## 6. 造假检查

未发现造假：build/test/tsc/四探针全部亲验复跑且与提交信息、README、CHANGELOG 声称数字逐项一致；closure 65 条 node 机器数复核；锚点/数字镜像两把机器尺复跑；官方 catalog.ts:934-936 本波亲读非转引；R3 真跑输出含诚实范围标签；closure V6-A..I evidence 与实盘提交机制逐条对得上；U2 报告重生成仅时间戳已还原（沿上两轮先例），评审过程未修改任何业务代码/测试/配置/del。评分无自评（reviewer-R6 ≠ V6 coder）。

## 7. 移交事项

1. **主线**：V6 块放行后走 **B7 发布门**——(a) 补 Mimosa deep 扫描并记录 scanId/seal/coverage（coverage.selectedFiles=0 时按 §15 security 人工覆盖替代并明示）；(b) V6-1 一行文档修补随发布提交入库；(c) 用户 §8.1 确认后推送 + tag v0.2.0 + merge-ledger 条目；(d) 最终验收 closure-check -Phase all（B7 完成前不得宣告完成）。
2. W5-A6-INSTALL（post-merge full-install smoke，user_approved_deferred）复核日期 2026-11-19——B7 推送后即可执行，与 V5 移交事项同一条。
3. RSI：本波 no-new-lesson 成立（Z20 已在册，无新机制性坑）；评审过程零返工零踩坑。
