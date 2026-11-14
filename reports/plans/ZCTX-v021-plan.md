# ZCTX v0.2.1 + 补丁版计划（reports/plans/ZCTX-v021-plan.md · v1）

> 触发：真机异常 `cannot get property "tokenMeter" without inject`（W5-A6-INSTALL 推迟的真机风险兑现）+ 用户双版本需求（纯插件版+外部补丁版）+ 官方升级适配侦察。
> 纪律：先想清楚搞明白规划好再动手（用户令）；本计划即规划产物。

## 0. 异常根因（主线亲验定位）

`src/plugin.ts:236-237` 在 apply 时直接属性访问 `ctx.tokenMeter`/`ctx.llm`，而 ZcontextPlugin `static inject` 未声明任何服务 → cordis proxy get 陷阱抛错（vendor/cordis/src/reflect.ts:144 `cannot get property "${prop}" without inject`）。`?.` 可选链无效（getter 本身抛）。**为什么五波评审没抓住**：mock 宿主未实现 cordis 的 inject 纪律（未声明服务访问应抛错）——又一例"mock 全绿≠真机对"。真机信息：插件在用户 0.2.2-rc.1 桌面上已成功装载进 apply（安装/装载/补丁行全部工作），死在第一毫秒的服务访问——安装面 OK，只差服务解析纪律。

## 1. P0：inject 修复 + 纪律性测试升级（立即）

- **修复**：ZcontextPlugin `static inject = ['tools','systemPrompt','commands','llm','tokenMeter','sessions']`（官方惯例：compaction-basic=['llm','tokenMeter','sessions']、plugin-manager=['loader','profileContext']——键=ctx 属性名）。六个服务全是 base bundle 保证提供。逐键核对提供方 service name（错误键=静默 PENDING，比抛错更糟——必须实读提供方声明核对）。
- **纪律升级（防复发本体）**：mock 宿主升级为 **cordis get-trap 语义强制**（未声明服务的属性访问必须抛错，与 vendor/cordis/src/reflect.ts:144 同语义）→ 全部既有测试在真实纪律下重跑；新增 probe-real-mount（真 vendored cordis fiber+真服务解析装我们的插件，断言 apply 越过全部服务访问点）。
- **边界**：静态 inject 后，缺服务宿主=插件 PENDING（不加载，宿主不受影响）——换取真机确定性；typeof 探针保留为 belt（真实宿主不再触达）。

## 2. P1：官方升级漂移侦察（researcher）

- 桌面 runtime.json payloadDigest 未变（0.2.2-rc.1，本机未更新）；"官方刚升级"=upstream 新 release。侦察内容：新 tag vs 锚树（zDSH-main@zdsh-latest）在**消费面**的漂移——session（SurfaceOp/append/deriveMessages）、tools（register/defineTool/run_code）、systemPrompt（section/context/required）、llm（registerAdapter/LlmAdapter/stream waterfall 事件名）、tokenMeter.measure、compaction 契约、vendored cordis（inject 语义）、pi-ai 版本。
- 前置：网络（ls-remote upstream 已在途挂起；重试）。
- 产出：RES-official-drift.md（消费面逐项 漂移/未漂移+锚点+适配项清单）。

## 3. P2：补丁版测绘与设计（researcher+主线）

**架构裁定（草案，P2 细化）**：
- **形态**：独立 patcher 工具（非插件），外部覆盖官方安装文件；**补丁点最小化=单点**：官方 llm-pi-ai PiAiAdapter 的 profileOptions 补 onPayload/fetch 透传（官方 adapter 不透传是 wire 域唯一缺口，F7.4）——一个补丁解锁全部路由的 wire 真账本+精确 preflight，智能仍在插件（可独立升级，补丁不随版本腐烂）。
- **机制**：安装面测绘（桌面 app 代码落点——dsh-primary-runtime payload 结构待查）→ digest 门控（payloadDigest 键控补丁版本）→ 原文件备份（del/ 纪律）→ 幂等字符串替换+前后哈希校验→ marker 文件（插件探测"补丁在场"点亮扩展面）→ 回滚命令。
- **更新韧性**：官方升级覆盖补丁→插件自动降级回纯插件面（已有）+patcher 重跑提示。
- **不做**：改底座行为类补丁（L5 事件/compaction 拦截）——首版只做"透传钩子"这一最小面，价值/风险比最高。

## 4. 波次

| 波 | 内容 | 状态 |
|---|---|---|
| P0 | inject 修复+cordis 纪律测试升级+真装载探针 | 立即派发 |
| P1 | 官方升级漂移侦察 | 网络+researcher |
| P2 | 补丁版测绘（安装面定位/补丁点实锚）+ patcher 设计文档 | P1 后 |
| P3 | patcher 实现+双版本发布（v0.2.1 插件修复版 + patcher v0.1.0） | P2 过设计门 |

每波评审 ≥98；红线继承 R1-R8。
