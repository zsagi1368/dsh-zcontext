# P3-T6 boot-timing probe — restored sessions vs the session/created feed (HF-09 探针验证项)

- 任务：ZCTX-P3 P3c-T6（任务卡 P3-audit-fixes.md；REPORT-FULL-AUDIT §5.3 P3-T6 / U-2 处置路径）
- 执行人：coder（P3 波）· 日期 2026-11-14 · 方式：官方源码时序探针（静态实读 + 调用图追踪）
- 结论先行：**惰性 watching 不需要**——boot 期恢复会话的"三面失明"窗口内不存在可观测活动；恢复会话的 announce 在其首次 run 的 publish 协议内、任何 llm 调用之前到达，插件三面（observe/preflight/wire）自该时刻起完整覆盖。

## 证据链（全部 file:line 实读 zDSH-main）

1. **announce-once 守卫**：core/session/src/index.ts:1262-1276 `announce()` 对 `entry.announced || entry.announcing` 抛错——每个 live entry 只有一次 `session/created`。
2. **live 会话的唯一 announce 位点**：core/session/src/index.ts:1100-1120（`publish` 内 `this.announce(session)`）。全仓非测试调用点 grep：仅 core/session:1118、agent-loop:667、subagent manager（自有 activation 域）——**restore 路径零 announce**。
3. **恢复会话是 detached 创建**：api/session-controller/src/client/sessions/service.ts:599-640（restore → `restored detached session`；`bindScope`/scope 记录，无 enter/announce）。grep `announce` 于 service.ts：仅文档注释与 restored 生命周期验证函数，无调用。
4. **首次 run 的 announce 时序**：core/agent-loop/src/index.ts:659-671 —— `publish(source)` 内：`sessions.enter(session)` → `agents.enter(...)` → `sessions.announce(session)` → `agents.announce(...)`；publish 完成后 run 才继续（`publication` resolver 在 finally 兑现）。即 **announce 严格先于该 run 的任何 llm/stream 活动**。
5. **插件侧事实（已有钉测）**：liveSessions 仅增于 session/created（plugin.ts wireSessionFeed，face-wiring 测试在位）；resolveWatchedSession 对未 watch 会话恒 miss（plugin.ts）。

## 推断（标注为推断）

- boot→首 run 窗口内，恢复会话无事件、无请求——observe/preflight/wire 三面在此窗口没有可观测对象；"失明"不损失任何数据。
- 首 run 时序（证据 4）保证 announce 先于首请求 → 三面从 run 的第一个请求起即在覆盖内。nudge 的 currentSession 回退同理：只有 run 开始才需要。
- 因此 lazy watching（收到未 watch 会话事件时按需纳入）无增量价值：它只能覆盖一个"零活动"窗口。

## 置信度与残留

- 静态源码时序：高（多锚点 file:line + 调用图 grep；announce-once 与 publish 协议互相印证）。
- **live 宿主 boot 实测未做**（如实标注）：完整 harness 安装挂载是遗留台账 W5-A6-INSTALL（user_approved_deferred，复核 2026-11-19）的范围；本探针结论以静态源码为准，若该安装项落地后实测与本报告冲突，以实测为准并重开 HF-09。
- 处置：HF-09 关闭为 **not_applicable（探针证伪必要性）**——插件代码零变更；U-2（宿主 boot 时序未证）升级为"源码级已证 + live 实测随 W5-A6-INSTALL"。
