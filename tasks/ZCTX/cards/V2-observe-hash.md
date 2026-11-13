# V2 任务卡：observe listener + 哈希件（v0.2.0 波次 2/6）

> 计划：reports/plans/ZCTX-v02-plan.md；规格：RES-observe-route.md a.2/a.3 + Q1/Q5/Q8。
> V1 交接裁决：① `reason:'series'` header **纳账为 reset**（RES §Q6 可观测+语义=前缀连续性自认打断）——本波补进 store；② U1=SKIP→S2 走 visibility-only+手写 profile 配置（V5 卡处理）；③ attributionHeaders 拼写已钉死。

## 产物

1. **宿主投影可选导入件** `src/host-llm.ts`：
   - lazy 动态 import `@deepseek-ai/dsh-llm`（fail-soft 模式同 schemastery 先例）：宿主在→用官方 projectFilesToText/projectImagesForTextModel/projectToolUpdates/isAgentLoopRequest（精确语义）；宿主缺（测试/mock）→本地最小 fallback + **台账诚实标注 `projector:'local-fallback'`**（domain 字段纪律）
   - 探针单测：两路径行为
2. **observe.ts**（llm/stream waterfall listener，插件侧注册）：
   - 主链四判据：isAgentLoopRequest（可选导入）+ purpose 缺席 + sessionId 匹配（listener 内当前关注 session 集合）+ 非豁免窗（V1 ResetEvent 台账：最近 reset 后第一个主链请求=豁免）
   - **只读纪律**：listener 不调 next() 以外的任何写、不短路（短路归 V4）、不原地改 frozen 对象——测试断言零变异（对 frozen options 深比较前后一致）
   - 每 attempt 快照 RequestSnapshot：逐消息 stableStringify+sha256（键序排序）+systemHash+toolsHash+attemptSeq+purpose/isLoop——经注入的快照 sink 交 store（进程内存态，不入 session log——CARD-F a.1"进程内不入账"）
   - 前缀单调机械件（自写 ~20 行）：与上一快照比对——长度收缩/逐位断裂点检测→产出 harness 域 prefix-break 记录（关联 ResetEvent 分类或 unknown-break）
   - **可选补采**（config `observe.attemptCapture` 默认 false）：包 next() 逐 chunk 采失败 attempt usage——进程内临时账标注 non-durable；abort 安全（signal 观察）
3. **store.ts 增量**：series→reset 纳账；RequestSnapshot 接收口+前缀断裂台账；zctx_status 数据面预留（V3 消费）
4. **plugin.ts 接线**：llm/stream listener 注册（能力探测：无 llm 服务→跳过+日志）；config 开关 `observe.enabled`(true)/`observe.attemptCapture`(false)
5. **测试**：listener mock（waterfall 形态最小 harness）+四判据逐条+零变异断言+哈希稳定性（同输入同哈希/键序无关）+单调/断裂检测+series reset

## 验收

- vitest 全绿（211 基线+新增）；tsc 零错；build 绿；git status 干净
- 只读纪律有测试钉（frozen 深比较）；fallback 路径有诚实标注断言
- 小步提交 feat(ZCTX): V2 <module>；checkpoint/progress/closures 落盘

## 约束

红线 R1-R8；Z15 先 tsc 后 vitest；净室；信号观察（listener 不吞 abort）；禁止在本波实现任何短路/enforce 行为（V4 边界）。
