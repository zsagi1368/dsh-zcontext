# CARD-AUD-E：全量验证重放+四真缺陷复现确认（tester · 全量审计令 E）

TASK_ID: ZCTX-AUD-E · 产出：reports/audits/AUD-verification-replay.md（≥80 行，边写边落盘，报 SHA-256）

## 任务

1. **全量电池重放**（当前树 391990f 基线）：build → vitest（429）→ tsc --noEmit → 五探针（probe-artifact/verify-activation-surface/smoke-real-loader/probe-host-imports/probe-real-mount）——记录全部数字与 exit code，与各波自报数字对账。
2. **四真缺陷复现确认**（D1/D2 报告的真缺陷必须复现证实后才进 P3 修复清单——防误诊）：
   - SM-01（applyEvent 无幂等守卫）：构造重复投递序列（同事件两次 feed）→ 断言当前实现确实腐败（fold 复活/计数膨胀）——写最小复现脚本（仓外 tmp 或 tests 外独立 .mjs，不入库）；
   - SM-02（畸形 checkpoint source）：构造 tokensBefore=Infinity 事件 → 断言 zctx_status 渲染路径确实 throw；
   - HF-01（图片静默降级）：构造带图消息 → 断言官方投影占位后 UNSUPPORTED_CONTENT 门不触发；
   - HF-02（sessions 零消费）：grep 复核+构造 sessions 服务缺席场景 → 断言 PENDING 行为。
   - 每条：复现成功=真缺陷确认 / 复现失败=误诊上报主线（D1/D2 报告作者对质）。
3. **新鲜度守卫**：build 时间戳 vs src 最近提交（Z19 口径）确认产物新鲜。

## 约束

只读+仓外复现脚本（禁改仓内文件）；纪律同家族；完成后报告行数+SHA-256+四缺陷复现结论逐条。
