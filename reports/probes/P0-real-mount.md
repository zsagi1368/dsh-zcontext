# P0 real-mount probe report (scripts/probe-real-mount.mjs)

- 运行时间：2026-11-16T17:57:15.448Z
- cordis：G:/000Github/zDSH/zDSH-main/vendor/cordis
- plugin lib：G:\000Github\zDSH\zDSH-plugins\dsh-zcontext\lib\index.js
- 结果汇总：5 PASS / 0 SKIP / 0 FAIL（exit 0）

| 组 | 状态 | 说明 |
| --- | --- | --- |
| G1 vendored cordis reachable | PASS | G:/000Github/zDSH/zDSH-main/vendor/cordis |
| G1 plugin lib reachable | PASS | G:\000Github\zDSH\zDSH-plugins\dsh-zcontext\lib\index.js |
| G2 device-failure negative control (inject-less read throws) | PASS | cannot get property "llm" without inject |
| G3 real mount (default config) crosses all service access points | PASS | tools=4 sections=1 contexts=1 commands=1 llm/stream=2 |
| G4 adapter face crosses llm runtime access points (providers declared) | PASS | registerAdapter routes=zctx-anthropic-messages directory entries=1 continuation=true |

- SKIPPED = 环境不可达（cordis 构建不在盘/宿主 face 不在盘），明示不静默。
- 负对照（G2）钉住挂载拓扑本身复现真机故障模式：官方拓扑（各服务由自己的
  插件 fiber 提供）下 inject=[] 直访必须抛 cannot get property "X" without inject；
  若拓扑漂移成宽容态（如根 fiber 直供），G2 即红。
- G3 的 dsh-zcontext 服务查找同时是 PENDING 守卫：inject 键错误 → 插件永不构造 → FAIL。
- G4 断言 adapter 面越过 registerAdapter/registerConfigurableProviders 两个 llm
  运行时访问点（providers 声明态；默认配置下 adapter 面提前 keep-alive 不触达）。
