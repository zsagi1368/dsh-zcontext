# P0 任务卡：inject 修复 + cordis 纪律测试升级（v0.2.1 波次 1）

> 根因（主线亲验）：plugin.ts:236-237 直接属性访问 ctx.tokenMeter/ctx.llm，static inject=[] → cordis proxy 抛 `cannot get property "tokenMeter" without inject`（vendor/cordis/src/reflect.ts:144）。真机（0.2.2-rc.1 桌面）已装载进 apply，死在第一毫秒服务访问。
> 计划：reports/plans/ZCTX-v021-plan.md §1。

## 产物

1. **inject 声明**：ZcontextPlugin `static inject = ['tools','systemPrompt','commands','llm','tokenMeter','sessions']`——**逐键核对提供方 service name**（宿主 registry 键=ctx 属性名约定，compaction-basic ['llm','tokenMeter','sessions'] 同款），核对法=读提供方 Service/插件 name 声明（packages/core/tools/src/index.ts、system-prompt/src/index.ts、interaction/commands、llm/llm、llm/token-meter、core/session 的注册名）——错误键=静默 PENDING，比抛错更糟，必须实读。
2. **mock 宿主纪律升级（防复发本体）**：mock ctx 的服务属性访问实现 cordis get-trap 同语义（未声明于 inject 的服务属性访问抛 `cannot get property "X" without inject`，对照 vendor/cordis/src/reflect.ts:136-165 语义）→ 既有全部测试在此真实纪律下重跑；插件侧补齐声明后全绿。
3. **probe-real-mount** `scripts/probe-real-mount.mjs`：真 vendored cordis（zDSH-main node_modules/@deepseek-ai/cordis 或 vendor/cordis lib——U2 探针模式）+真 fiber+六服务桩（实现最小 Service 形态）→装我们的插件→断言 apply 越过全部服务访问点（236/237/292/305/315/333/374/437/560 等全部触达）→exit 0。SKIPPED 机制同探针家族。
4. **排查其余宿主访问点**：grep 全 src 的 ctx.<prop> 直访（on/effect/reflect/id 等特殊属性除外）——凡非 inject 声明内的服务属性访问一律收编（补声明或改 ctx.inject(deps,cb) 延迟式——择一处注明）。
5. **测试**：cordis 纪律负例（mock 下未声明访问抛错断言）+修复后全绿+probe-real-mount。

## 验收

vitest 全绿（424 基线+新增）+tsc 零错+build 绿+probe-real-mount exit 0（或 SKIPPED 明示）+干净树；小步提交 fix(ZCTX): P0 <module>；台账落盘。

## 约束

红线 R1-R8；开工首动作=查册；长内容 Write/Edit；先 tsc 后 vitest；§5 备份；卡壳如实报告；遗留为零。**本波必须真验证**——不能再让"mock 全绿"覆盖真机纪律。
