# REVIEW-P4 — P4 patcher 波评审（reviewer-P4 handoff）

```
FROM: reviewer-P4  TO: 主线（ZCTX v0.2.1 调度）
MODE: fix
TASK_REF: P4 patcher 波（d9bd4fd..45b1152，5 提交）对抗评审 + §12 评分
PAYLOAD: 见下；SCORE 总分 96/100（<98 打回）；CHECKPOINT = scorecards/P4.json（本文件为其评审叙事件）
ATTACHMENTS: tasks/ZCTX/scorecards/P4.json, tasks/ZCTX/handoffs/REVIEW-P4.md
```

## 复述理解（≤3 行）

P4 交付外部补丁器（patch/restore/status 三子命令+门族+备份回滚+外科拼接+marker）与插件接收侧（globalThis.__zctxPatch__ 第六面+zctx_status 双源段），真机执行按卡面留 W5-A6-INSTALL。评审按七个攻击方向逐条验证，含真机档级亲验。

## 裁决

**打回（96 < 98）**：[阻断] 1 + [建议] 5。返工量小（3 条台账条目 + 1 行谓词修正 + marker 回填 + 3 处措辞/标签），预计单轮达标（返工 ≤2 轮）。补丁本体正确性成立——评审人以真机 209MB asar temp 副本走完整 patch→status→restore 循环全绿，这是超出 coder 自报电池的加验证据。

## [阻断] 清单（不修不能过 P4 最终验收）

- **P4-B1** tasks/ZCTX/closures/closure.json × scorecards/P3.json:74-80 —— P3 评审 residual_note 明文裁决：P0-1/P0-2/P0-4 三条建议补追溯条目（或 1 条捆绑）随 P4 terminal governance 提交，**阻塞 P4 最终验收**。P4 terminal 只兑现 P4 卡入库（1d6956f），closure.json 机器检索 P0-1/P0-2/P0-4 零命中（现有 P0-A..D 是 P0 波 inject 修复产物条目，不是这三条评审建议的追溯），而 45b1152 自称零遗留。修复：补 3 条 fixed/verified 追溯条目，evidence 指向 P3-M4/c9ed41f、0395c33、33854a1。

## [建议] 清单（不阻塞中间合入，阻塞最终验收；每条需 disposition）

- **P4-1** patcher/zctx-patch.mjs:718 —— witness 期望偏移谓词 `oldOffset > 0` 应为 `oldOffset > targetStart`（splice 移位规则 :363-371）。可达性：@electron/asar 产物首打包文件 offset=0（真档亲证 dsh/desktop-runtime.json@0），工具可接受域内不可达；后果=假阴性 post-verify（档正确却报 FAILED+提示 restore），绝不产生坏档。修：witness 采集记 afterTarget 布尔 + 注释显式化布局前提 + 回归钉。
- **P4-2** patcher/zctx-patch.mjs:630-633 × :669-699 —— marker 与 patch 状态不变量破口：rename 与 writeMarker 之间崩溃 → 重跑 patch 走幂等分支不回填 marker → 插件 zctx_status 永远渲染 "absent (official adapter unpatched)" 而桩实际活；patcher 自身 status 呈 patched=true，跨工具口径不一致（writeMarker 抛错路径同源）。修：幂等分支回填/如实报告 marker 状态。
- **P4-3** patcher/zctx-patch.mjs:868 —— 已打补丁档 status 报 anchorHit='mismatch (drift)'（评审真档 temp 循环亲见）：把"补丁后期望态"与"官方升级锚漂移"（行动完全不同）并入同一告警色标签。修：三态措辞区分 + .d.mts 同步。
- **P4-4** closure.json updatedAt —— 45b1152 把时间戳从 12:40 改到 11:50（-08:00），台账时间倒退；条目证据零篡改，纯该行卫生。修：终态提交修正并保持单调。
- **P4-5** scripts/verify-activation-surface.mjs A11 —— 断言标签 'anchor set in册' 中英混排，A1-A10 全英文口径下的孤例。修：'anchor set registered'。

非条目记事（返工时顺手，不单独记账）：patchAsar splice/post-verify 失败返回缺 refused:true（:667/:685，CLI 不受影响）；extractPositioned 哈希基于 UTF-8 重编码文本（目标为纯 ASCII JS，等价；锚集扩展时检查项）；restore 于 RESTORE.md 缺失时跳过记录哈希门（容错路径，temp 副本哈希门仍在）。

## 评审人亲验电池（全部本机复跑，非转抄）

1. npm test → **502/502**（24 files = 472 基线 + patcher.spec 14 + patch-bridge.spec 16）EXIT 0；npx tsc --noEmit → 0 错；npm test 重建后 git status lib/ 零漂移。
2. 五探针全 EXIT 0：probe-artifact 6/0/0 · host-imports 16/0/0 · real-mount **5/5**（G4 修复后）· smoke-real-loader · verify-activation-surface **11 PASS/0 FAIL**（含 A11 12 断言）；探针报告行尾噪声已按先例还原。
3. 真机 asar 只读亲验（H:/AiAgent/…/app.asar，零写入）：209,021,953 B；headerSize 5,669,972/jsonLen 5,669,961 复现；shell 0.2.2-rc.3；目标 lib/index.js SHA-256=e956da3d…=asar 头双证复现；锚计数 callSite=1/definition=1/maxRetries:0=1/stubMarker pristine=0；调用点上下文逐字节（5-tab、键序 profileOptions→temperature/maxTokens/sessionId→signal→headers）；options.provider×7/options.sessionId×4/model.id×9 全部真实在用；首打包节点 offset=0。
4. 真机 asar temp 副本全链循环（用户机器零写入、temp 已清理）：REAL SUPPORTED 锚集零注入 → patch 8 步全 ok（+136 B；209MB 备份哈希双验；splice header 5,669,972→5,669,972；post-verify 官方 API 可读+见证 2/2 byte-identical+体积 209,022,089 精确）→ marker → status（P4-3 亲见）→ restore 字节级还原 → marker 清除，EXIT 0。
5. 对侧证据：真机 pi-ai dist 198 js 中 15 个引用 options.fetch（anthropic-messages.js:425 createClient(…, options?.headers, options?.fetch, …)；classifier-shared.js:44 options.fetch ?? globalThis.fetch）——fetch 包装层为活通道，R7 attribution 送达路径成立。
6. patcher computeIntegrity 空输入分支与 @electron/asar 4.3.2 lib/integrity.js:48-56 逐行一致（存疑已排除）。
7. 台账/治理：closure 机器数 113（verified 108/closed 4/open 1=W5-A6-INSTALL，fixed-not-verified 0）；干净树；version 0.2.1=CHANGELOG P4 段；del/20261114-p4-patcher-prechange 在盘；progress/checkpoint 全时间线含 G4 回归根因与 Z22 事件如实记录。

## 承重主张核验结论（七攻击方向）

1. **补丁桩安全**：桩形态与卡面逐字一致、零 body 改写、?. 链+?? {} 零操作降级；插入点在官方显式 headers:/signal: 之前 → 官方键恒后置覆盖（让位次序正确）；onPayload/fetch 无官方同名键原生存活；三个引用变量在真机 lib 作用域齐全（官方代码自身使用面）→ 桥缺席时桩求值 {} 而非抛错。**通过**。
2. **asar 手术正确性**：surgical 拼接选型正确（repack 会重排全部字节）；pickle 数学逐字节复现；头 JSON 原位变异保键序；官方 API 后校验=extractFile 重读目标+见证 integrity+体积记账三件套；Z26 win32 path.sep 修复在位（:160-162+测试同步）；真档 temp 循环全绿。**通过**（P4-1 谓词为防御路径暗点）。
3. **备份/回滚纪律**：sibling 备份防更新器清除（P2 [F29] 对策）+ 双哈希 + RESTORE.md 双通道还原命令；restore 四重门+字节级还原钉（fixture lib===FIXTURE_LIB + 真档 sha 复原）。**通过**。
4. **门族**：版本门/锚哈希门/锚唯一性/幂等/进程+锁面五门齐备，四拒收测试真实（合成 asar 由 @electron/asar createPackage 构造=官方工具链产物，锚区逐字节取自真档）；锚漂移拒收零改动断言在位。**通过**。
5. **插件桥**：wirePatchFace 零 ctx 服务访问（无 inject 需求，R3 纪律不破）；身份三字段校验→watched session→同源 buildWireFaces；{}-降级梯全覆盖（8 身份形态/unwatched/host 缺席 warn-once/内部抛错 warn-once）；last-wins 挂载+禁用不挂载钉；loadAdapterFaces 仅成功 memoize（身份守卫）——G4 当波自纠闭环且 5/5 亲验；zctx_status 双源三态渲染钉。**通过**（P4-2 为双源口径的崩溃窗口暗点）。
6. **安全回滚**：故障路径=门拒收零改动（测试断言 sha/无备份/无 marker）；splice 失败在 rename 前零接触；post-verify 失败不自动回滚（注释交代取舍）+recovery 命令；marker 不变量破口已列 P4-2。**通过（附 P4-2）**。
7. **亲验**：见上节电池。**全绿**。

## 评分（§12.1，逐维证据见 scorecards/P4.json）

正确性 24 / 完整性 19 / 一致性 19 / 可验证性 15 / 安全回滚 10 / 可维护性 9 = **96**（<98 打回）。

## 交接

- 产物：tasks/ZCTX/scorecards/P4.json + tasks/ZCTX/handoffs/REVIEW-P4.md（本文件）。
- 评审人 ≠ P4 coder；无自评；全部数字可复现；评审全程对用户机器零写入（真机只读抽取 + temp 副本已清理）。
- 下一步：主线派返工轮（P4-B1 + P4-1..P4-5，建议与 P4-1 合并对齐 refused 标志语义）；返工后复审按本文件清单逐条 disposition。
