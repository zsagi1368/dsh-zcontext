# REVIEW-W3W4.md — R2 联审（W3 引擎波 + W4 接线波）

FROM: reviewer-R2 (independent subagent, reviewer ≠ coder)
TO: 主线 (orchestrator)
MODE: fix (双卡打回, 返工第 1 轮)
TASK_REF: CARD-R2-review-W3W4 (tasks/ZCTX/cards/CARD-R2-review-W3W4.md)
DATE: 2026-11-12
ARTIFACTS: tasks/ZCTX/scorecards/W3.json / tasks/ZCTX/scorecards/W4.json / 本文件

## 结论

| 波 | 提交 | 总分 | 判定 | [阻断] | [建议] |
|---|---|---:|---|---:|---:|
| W3 | 9ee6619 | 77 | 打回（正确性 16 触发硬门槛 <23） | 1 | 1 |
| W4 | 1486df4 (+4bf02e9) | 86 | 打回（继承 W3-0 阻断 + 自有 4 建议） | 0 自有 / 1 继承 | 4 |

W2 基线 100/100 未受波及（本波未触碰 W2 文件，唯 validator 语义被 W3-2 引用）。

## 亲验三绿（reviewer 亲跑，非转录）

- `npm run build` → tsdown ✔ lib/index.js 116.63 kB
- `npm run lint` → tsc --noEmit 零错
- `npx vitest run` → 11 files, **189/189 passed, 0 skipped**（与 coder 自报一致；W2 基线 111 → +78）
- `npx vitest run tests/fold-engine.spec.ts --reporter=verbose` → S5 真实官方 session 4 例 **executed 非 skip**（绝对路径导入 `file:///G:/000Github/zDSH/zDSH-main/packages/core/session/lib/index.js` 属实，fold-engine.spec.ts:54）

## [阻断] 清单

### W3-1 · checkpoint 载荷形态偏离官方 user/message 契约（正确性硬门槛触发）

- **位置**：`src/fold-engine.ts:287-297`（fold）、`:432-442`（unfold）；夹具 `tests/helpers/mock-session.ts:166-193`、`tests/fold-engine.spec.ts:565-600`。
- **问题**：引擎以 `{ message: { role, content, source } }` **信封**提交 `user/message`。官方契约 data = 裸 UserMessage：
  - `core/session/src/types.ts:309` — `'user/message': UserMessage`（对比 :330 system/message 才是 `{turn, step, message}` 信封）；
  - `core/session/src/surface.ts:132-134` — `deriveEventMessage` 对 user/message **逐字返回 event.data**；
  - 官方生产者直接提交消息对象：`compaction-basic/src/region.ts:506-508`（恰为卡面引用行；checkpointMessage = `createUserMessage({content, source})`, region.ts:410-413）、`core/agent-loop/src/agent.ts:435`；
  - `options.md:88,90` 自引 region.ts:506-508 冻结官方同位最小形态 — 实现与自订契约相悖。
- **实证**（reviewer 探针，官方 lib 直跑，`C:\Users\ZS\AppData\Local\Temp\zctx-review-probe\probe-a-shape.mjs`）：插件形态节点 `deriveEventMessage` 输出 `{"message":{...}}` — **top-level role=false、content=false**；官方形态节点输出正常 UserMessage。真实宿主上折叠摘要投影为畸形消息 → 主产物（摘要上模型）不可用。
- **为何 189 绿 + 4 例真跑没拦住**：官方 `session.append` 对该宽松载荷不校验（`validateSessionEventData`, surface.ts:164-217 无 throw）；测试只断言表面机制（nodes/generations/foldSurface 重放对拍节点序列）并**回读自己写入的信封**（fold-engine.spec.ts:597-600 读 `event.data.message.source`），从未断言派生消息。S5 对拍验证的表面机制本身是真的、正确的——但对载荷形态全盲。
- **修法（测试断言为准绳文字）**：
  1. 先加测试：真实模式新增 `const m = session.deriveEventMessage(session.eventAt(checkpointSeq)); expect(m.role).toBe('user'); expect(Array.isArray(m.content)).toBe(true)`（fold+unfold 两例都加）；
  2. 改 `src/fold-engine.ts` 去信封，直接提交 `{ role: 'user', content: [...], source }`（镜像 createUserMessage 输出）；
  3. 同步 mock-session.ts `msg.user()`（官方 user/message 裸消息）与真实模式夹具（fold-engine.spec.ts:565-580）；`msg.system()` 补 `turn/step`（types.ts:330）；
  4. store 侧零改动：`extractMessage`（store.ts:131-139）与 materialize.ts 提取器均双形态兼容。

## [建议] 清单（不阻塞中间合入，阻塞最终验收；每条须 fixed/verified 或 §11 记账）

### W3-2 · 跨 checkpoint 吸收事实不可达 + 引擎 shadowed 集合的跨模块不变式依赖

- **位置**：`src/validator.ts:144-150`（consecutive+monotonic）、`:255-281`（规则 d）；`src/fold-engine.ts:271-273`（数字区间 shadowed 过滤）。
- **问题**：首折后表面必为非单调（checkpoint seq > 其后节点 seq，如 [0,8,4,5,6,7]）。探针 B2（probe-b2-engine.mjs，官方 lib + 插件自身 fold()）实证：任何"含活动 checkpoint 且其后有后补节点"的窗口被判 `not contiguous` 拒收 → 规则 d 承诺的覆盖式吸收事实上只剩 `[checkpoint,checkpoint]` 单窗可达。同时引擎数字过滤与官方位置切片（surface.ts:421-428 indexOf slice）的等价**完全依赖** W2 validator 的 consecutive+monotonic 不变式；探针亦实证官方接受 sourceEventSeqs 超集（assertSourceEventReferences 仅查 ⊇）——不变式一旦被破坏即静默账本腐败（absorbed 误标/复物化越界）。fail-closed，无静默腐败。
- **修法**：(a) 文档化规则 d 可达域（吸收仅限单 checkpoint 窗）+ 测试钉；或 (b) 引擎/validator 改位置切片、放宽 monotonic，补跨 checkpoint 吸收端到端测试。

### W4-1 · zctx_unfold 死参数 `latest`

- `src/tools.ts:623-624` 声明、`:627-644` 不读。删除（描述文案已含缺省语义），同步 spec 参数断言。

### W4-2 · B2 "官方过滤"测试自证循环

- `tests/plugin.spec.ts:156-160`：`officialFilterKeeps` 为本地重述断言的参考实现，未执行真实 system-prompt 抑制过滤（`core/system-prompt/src/index.ts:667/:682` — 仅保留 `required === true`，已亲核）。注册值本身正确（plugin.ts:250-256, required:true）。改为直接断言 + 官方行号注记，真实过滤行为留真机集成波。

### W4-3 · 产物探针证据不可从仓复现

- closure W4-S3 / progress.md [12:16] 自报 "node probe on lib/index.js: 14 exports + face wiring + 端到端 fold+status"，但 `scripts/` 为空、smoke.spec.ts 仅 6 例身份/Config 断言、无入库测试走 BUILT lib 工具注册面（plugin.spec.ts 走 src）。固化探针（scripts/probe-artifact.mjs 或并入 smoke.spec.ts）并回写 closure 证据路径。

### W4-4 · nudge provider 忽略官方 AssembleContext + 全局最近会话假设

- `src/plugin.ts:324-329, :255`：官方 `PromptContext.text` 接收 AssembleContext（system-prompt/src/index.ts:84）；现实现全局取"最近创建会话"，多会话宿主会跨装配串压。最小修法：签名接收 AssembleContext 按 scope 键会话，或 guidance 文案显式声明单会话假设。

## 复核通过项（对抗后存活）

1. **mock 官方四条硬校验**（读代码验证非看注释）：mock-session.ts:105-117 精确 shadowed 集合 / :94-103 端点存在 / :118-126 node-0 system head / :128-136 tool-result 单节点护栏。注：check 1 精确等值严于官方 ⊇（mock 头注释已声明为卡面冻结），对 zctx 精确提交无漂移。
2. **B1 unfold 单节点形态断言在测**：fold-engine.spec.ts:333-334（surface nodes 逐 seq 相等）。
3. **B2 required:true 真实注册**：plugin.ts:250-256；官方语义与过滤行亲核一致。
4. **两层窗口拒绝各就位互不替代**：CCM 引擎门（fold-engine.ts:72,89-99；nudge :343 静默；status :455-458 注记；手动工具可用 tools.spec.ts:264-281）vs budget F1 结构守卫（W2 ecb5857；fold-engine.spec.ts:541-548 分层成证）。
5. **工具回执=原生 tool result**：output.render → `[{type:'text'}]`（tools.ts:583-586，spec :159-163）；无跨宿主注入。
6. **parseFoldContent 宽容解析拒收路径**：5 种拒收形态诚实零区间诊断（tools.spec.ts:110-119）。
7. **能力探测降级 5 面齐全**：plugin.spec.ts:134-144（5 warn 全 skipped、零注册）+ tools.spec.ts:229-239（meter/llm 降级行）。
8. **absorbed/dead/unfolded 判定语义**：外来源 replace→dead（store.spec.ts:62）、zctx 遮蔽→absorbed（fold-engine.spec.ts:296-316）、unfold→unfolded（:352-355）；compaction 括弧 + end-seed 生命周期（store.spec.ts:244-273）。
9. **S5 双模式**：真实 4 例真跑（verbose 证实非 skip）+ foldSurface 重放对拍真实执行（表面机制层面）。
10. **官方事件名**：session/created / disposed / event 与 core/session/src/index.ts:54,63 一致；回调参数形态匹配。

## RSI 侧写复核（只读，属实合理）

- **Z15**（ZDSH-LESSONS.md:93-97）：嵌套 helper 相对导入层级 — 代码事实核对 `tests/helpers/mock-session.ts:25` 现为 `../../src/types.ts` ✓；教训内容（vitest 绿 ≠ 类型闭合、先 tsc 后 vitest）与本波 lint 零错状态一致。
- **Z16**（ZDSH-LESSONS.md:99-103）：super() TDZ/加载期探测 — 代码事实核对 `src/plugin.ts:134` `loadCordisService() ?? StructuralServiceShim` 在 extends 前选基类 ✓；smoke.spec.ts:17-22 最小 ctx 带 reflect.provide 锁构造契约 ✓。
- **捕获日志**：`~/.agents/rsi/INDEX.md:139` 一行完整记录本波（W3/W4 摘要、Z15/Z16、del 备份 3 处、开工查册命中 Z13/Z14）✓。
- del 备份在位：del/20261112-w3-texts-index-prechange/、del/20261112-w4-index-smoke-prechange/、del/20261112-w4-rsi-lessons-prechange/（ls 验证）。

## 处置要求

- W3-1 修复 + W3-2/W4-1..W4-4 当波 closed（fixed/verified 或 §11 记账 user_approved_deferred 须用户真实批准）。
- 返工后由 reviewer 复审（W3.json/W4.json 刷新，两卡 ≥98 放行；≤2 轮）。
- 探针脚本（probe-a/probe-b2）保存在 `C:\Users\ZS\AppData\Local\Temp\zctx-review-probe\`，可供 coder 复现阻断证据；建议随 W4-3 一并固化为正式探针。

CHECKPOINT: 本评审落盘于 tasks/ZCTX/scorecards/W3.json、W4.json 与本文件；无业务代码改动（全程只读 + 仓外探针）。

---

# 复审节（rework round 1 · 2026-11-12）

FROM: reviewer-R2 (同人对照复审)
MODE: verify (复审通过, 放行 W5)
RANGE: 4293a58..a3058eb（6 提交：4293a58 W3-1 / b6f359c W3-2 / ec8eb12 W4-1 / c1b6c2f W4-2 / 338e3ae W4-3 / 3c15e7c W4-4 / 8992208 ledger / 8408453 评审产物入库 / a3058eb lib regen）

## 复审结论

| 波 | 返工后总分 | 判定 | 剩余项 |
|---|---:|---|---|
| W3 | **99** | 通过（≥98） | 无 OPEN（一致性 -1 = mock assistant/tool 夹具 turn/step 注记，零功能面，已记录） |
| W4 | **100** | 通过（≥98） | 无 OPEN |

初评 [阻断] 1 + [建议] 5（含继承）全部 closed（fixed/verified/block，closure.json W3-R1/R2 + W4-R1..R4，8992208 入库）；第 2 轮无需启用。

## 逐条闭合核验（reviewer 亲验）

- **W3-1[阻断] → closed**（4293a58）：去信封裸 UserMessage `{id:randomUUID(), role, content, source}`；真实模式 fold+unfold 两例 `deriveEventMessage` 投影钉**测试先行**（与修复同提交）；mock `msg.user` 改裸形态、system/tool 夹具补 `{turn,step,message}`。reviewer 探针复跑：bare shape（role=user / content array / id 在位 / 无 message 键）、投影 fold 1 块 unfold 3 块均 role=user；`node scripts/probe-artifact.mjs` P4 checkpointBareUserMessage=true、P5 foldProjection/unfoldProjection=true。
- **W3-2 → closed**（b6f359c）：按选项 (a) 文档化路线——validator 模块头/规则 d/守卫注释三处写明可达域（[checkpoint,checkpoint] 边界对齐），REASON_RANGE_DISCONTIGUOUS 扩展文案实测渲染生效（措辞探针：window [4,8] 端点俱在 → 新文案含 "must boundary-align with the checkpoint"）；双域扫描测试（pristine+post-fold 全窗口）钉死 numeric≡positional 不变式；[checkpoint,checkpoint] 吸收端到端 ok（absorbed:['f8']）。
- **W4-1 → closed**（ec8eb12）：latest 参数删除 + 参数集精确钉 `{foldId}`。
- **W4-2 → closed**（c1b6c2f）：自证循环删除，直接断言 required===true + 官方行号注记（667/:682 引用准确）。
- **W4-3 → closed**（338e3ae）：scripts/probe-artifact.mjs 入库（5 组探针），reviewer 亲跑 **5/5 PASS, 0 SKIP, 0 FAIL**，可复现。
- **W4-4 → closed**（3c15e7c）：provider 签名接收 AssembleContext，归属 agent.session → scope.session，回退文档化；官方引用逐条亲核**精确属实**（agent/src/dispatch.ts:174-176 `assembleContextFor(agent, signal)` 返回 `{agent, scope: agent, signal}`；Agent 公开 readonly session；system-prompt/src/index.ts:85 契约）；双会话归属判别测试在测（A 渲染 A 跨度、B 走跨越计次抑制）。

## 两点 coder 披露判定

**(a) `id: randomUUID()` 补充 — 成立，保留。** 官方 UserMessage 完整成员集恰为 `{id, content, source, role: 'user'}`：`llm/src/message.ts:139-141` MessageBase.id readonly 必填、`:162-165` UserMessage extends MessageBase、`:226` createMessage 盖 `randomUUID()`、`:246-249` createUserMessage 返回 `T & Pick<UserMessage,'id'|'role'>`。评审原修法"可选 id"表述不完整，coder 的完整镜像比评审字面更正确；探针实证 id 在位且投影不受影响（deriveEventMessage 逐字返回 data）。

**(b) 评审产物入库 8408453 — 合规。** adds-only 提交（312 insertions / 0 deletions / 0 修改，`git show --stat` 亲核），三个文件与评审落盘版逐字一致；先例 b601804（R1 产物）与 8b943c2 同模式；符合 §0.6/§2.2 全员增量落盘与卡面指定产物路径（scorecards/handoffs）。范围外无文件触碰。

## 复审亲验证据

- `npm run build` → ✔；`npm run lint` → 零错；`npx vitest run` → **193/193, 0 skipped**（189 基线 + W3-2 扫描 2 + W4-1 钉 1 + W4-4 钉 1 = 193 ✓）。
- `node scripts/probe-artifact.mjs` → 5/5 PASS（P1 30 导出 / P2 接线 / P3 S8 / P4 端到端裸 UserMessage / P5 真实 session 投影+W3-2 拒收钉）。
- reviewer 探针（仓外 `C:\Users\ZS\AppData\Local\Temp\zctx-review-probe\probe-c-rereview.mjs` + 措辞探针）：W3-1 裸形态与投影全过；W3-2 跨 checkpoint 窗诚实拒收、[checkpoint,checkpoint] 吸收可达。
- 入库 lib 与重建字节一致（重建后 `git status` 干净）；返工备份 `del/20261112-w3w4-rework-prechange/` 在位。

## 备注（零功能面观察，已记录不静默）

mock `msg.assistant`/`msg.tool` 信封仍无 `turn/step`（官方 types.ts:341/375 含）——插件从不写 assistant/tool/system 事件、store 不读 turn/step，纯夹具保真度注记（W3.json 一致性 19 的 -1 依据），不构成任何卡面缺口，无处置要求。

CHECKPOINT: 复审产物 = 本节 + 刷新后 scorecards/W3.json（99）/W4.json（100）；两卡 ≥98 → **放行 W5**。
