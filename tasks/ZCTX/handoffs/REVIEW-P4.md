# REVIEW-P4 — P4 patcher 波评审（reviewer-P4 handoff · 含返工第 1 轮复审）

```
FROM: reviewer-P4  TO: 主线（ZCTX v0.2.1 调度）
MODE: verify
TASK_REF: P4 patcher 波（第 1 轮 d9bd4fd..45b1152，96 打回）→ 返工第 1 轮（b8fc433..11a0a3c，6 提交）复审
PAYLOAD: 终评 100/100（≥98 放行）· 0 [阻断] · 0 OPEN · 六条全 fixed/verified · 两项裁定已给 · ARTIFACTS 见下 · CHECKPOINT p4r1-terminal
ATTACHMENTS: tasks/ZCTX/scorecards/P4.json, tasks/ZCTX/handoffs/REVIEW-P4.md（本文件，两件已随 ba3b448 入库）
```

## 复述理解（≤3 行）

返工第 1 轮按 REVIEW-P4 第 1 轮清单六条逐项修复（P4-B1 阻断 + P4-1..P4-5 建议），另请求两项评审裁定（P0-4 双提交归属措辞、P4-2 正常路径失败分支无强制红测）。本复审逐条核验 + 亲验电池 + 真机档重跑。

## 终审裁决

**通过（100 ≥ 98）→ 放行双版本发布门；[阻断] 0；OPEN 0。** 六条全部 disposition=fixed、status=verified（逐条证据见 scorecards/P4.json `rework_round1_review.per_item_closure`）。

## 返工轮亲验电池（全部本机复跑）

1. npm test → **507/507**（24 files = 502 基线 + 5 新钉）EXIT 0；npx tsc --noEmit → 0 错；返工零触碰 src/（diff 无 src 文件，lib 零漂移面）。
2. 五探针全 EXIT 0：artifact 6/0/0 · host-imports 16/0/0 · real-mount 5/0/0 · smoke-real-loader · verify-activation-surface **11 PASS/0 FAIL**（A11 新标签亲见）；探针报告行尾噪声按先例还原。
3. closure 机器数 **116**：verified 111 / closed 4 / open 1（W5-A6-INSTALL）；fixed-not-verified 零命中；P0-1/P0-2/P0-4 三条 fixed/verified/block 在册，source 逐字对齐 REVIEW-P0 #53/#54/#56。
4. **真机 209MB asar temp 副本全链重跑**（返工后代码、用户机器零写入、temp 已清理）：patch 8 步全 ok → status `patched-exact`+guidance undefined → **崩溃窗自愈实测**（删 marker 重跑：markerBackfilled=true、marker step=backfilled、asar 字节与备份数均不变、status 恢复双源一致）→ restore 字节级还原 → 终态 `official-unchanged`+guidance undefined，EXIT 0。
5. 树净（git status --porcelain=0）；checkpoint p4r1-terminal done；grep 全仓 'in册' 归零。

## 六条逐项判定

- **P4-B1[阻断] → fixed/verified**：closure +P0-1/P0-2/P0-4（machine 113→116），source 逐字引 REVIEW-P0 #53/#54/#56，提交归属 git 实证（c9ed41f@09:53 摘键 / 0395c33+c0779b5 发布面 / 391990f@08:15 plan+card / 33854a1@10:47 权威件 14）。
  **裁定（P0-4 措辞）：可接受且优于第 1 轮指令**——第 1 轮（沿 P3-r1 评分卡口径）点名 33854a1 为 P0-4 锚，git 取证证明 REVIEW-P0 #56 点名的 plan/card 两件实际入库于 391990f（show --stat 恰含此两件），33854a1 为权威件链补全；台账两者并列并把关系写明=精度提高、零隐瞒。偏差根源在评审侧粗口径，coder 以取证纠正并如实标注，属正确执行。
- **P4-1 → fixed/verified**：witness 采集期记 afterTarget（与头变异循环同一谓词 `offset > targetStart`，单源）；期望偏移不再依赖布局前提（注释显式化）；crafted 回归钉（header 键序≠payload 序、官方 reader 可解析性钉内预断言防假绿、双 witness 标志断言、全链 ok）。红证=算术必然（witness[0] 非零偏移且在 target 前 → 旧期望偏移必 ≠ 实际不移位 → post-verify 必 FAILED），评审人以算术证明替代临时副本法。
- **P4-2 → fixed/verified**：崩溃窗自愈（桩在场+marker 缺席 → 回填，sha256Before=钉定 pristine 推导链注释在位、sha256After=实算、backup=最新兄弟目录 ?? null）+ writeMarker 返回结果契约（失败=FAILED+ok:false+recovery，**永不 ok:true 而 marker 缺席**——不变式由结构达成）；真档自愈实测全对；摘除即红。
  **裁定（正常路径失败分支无强制红测）：可接受**——①不变式由返回值契约+双调用点同构门检结构性保证；②失败分支留下的状态恰是已红测自愈分支的入口（故障态端到端恢复有真覆盖，真档亲证）；③强制失败需破坏性 sabotage（marker 置目录/只读卷），测试的是 Node I/O 而非本逻辑，残余风险仅 catch 内 rmSync(tmp) 卫生面。W5 真机执行时该分支获首次真实路径覆盖。
- **P4-3 → fixed/verified**：anchorHit 四态（official-unchanged/official-drifted/patched-exact/patched-drifted）+ guidance 独立字段（状态/行动分离）；patched-exact 重构证明（移除唯一插入段→整文件 sha==钉定 pristine ⟹ 字节等价 patchText(pristine).text；marker 无关，崩溃窗下诚实；段计数≠1→保守 drifted）；函数形 replace 免 $ 模式语义；.d.mts 同步；真档实测两态正确。
- **P4-4 → fixed/verified**：updatedAt=12:21:28-08:00 与 ba3b448 提交时刻（12:22:04）吻合。
  **裁定（时间戳）：实现优于第 1 轮字面标准**——git 取证证明第 1 轮建议的锚值 12:40 本身系虚构：d9bd4fd 提交于 10:50:25-0800 却携带 updatedAt=12:40:00-0800（提前约 1h50m）；45b1152 的 11:50 反与提交时刻吻合。coder 取实际处置时间满足『诚实单调真实时间台账』本意；为凑字面单调而写未来时刻才是造假。12:40 仅存于 git 历史 blob，无在档虚构时刻。
- **P4-5 → fixed/verified**：A11 两处标签改 'registered'；全仓 'in册' 归零亲验。

## 评分轨迹（§12.1）

第 1 轮 96（正确性 24/完整性 19/一致性 19/可验证性 15/安全回滚 10/可维护性 9，六扣分项对应六条）→ 返工后 **100**（25/20/20/15/10/10）——六项全 fixed/verified 且真档重跑复证，非条目记事维持第 1 轮不单独计条裁定（splice 失败缺 refused:true、CLI [skip] 主行措辞、UTF-8 重编码口径——均留 W5 真机波顺手面，已在 scorecards/P4.json non_item_notes_carryover 登记）。

## 交接

- 产物：tasks/ZCTX/scorecards/P4.json（终版）+ tasks/ZCTX/handoffs/REVIEW-P4.md（本文件；两件已 tracked）。
- 评审人 ≠ P4 coder；两轮同一评审角色连续执行（轨迹 96→100）；无自评；全部数字本机复跑；评审全程对用户机器零写入（真机只读抽取 + temp 副本已清理）。
- 下一步（主线）：按 ≥98 放行双版本发布；W5-A6-INSTALL（真机 patch/restore/完整启动冒烟）仍 open，post-merge 执行——执行时按本卡【裁定】附录的验收点走（自愈不变式 ok:true⟹marker 在位、四态 status、字节级 restore）。
