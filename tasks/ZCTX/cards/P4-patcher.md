# P4 任务卡：patcher 实现（v0.2.1 波次 4——补丁版本体）

> 依据：v021 计划 §3（单点补丁=llm-pi-ai 钩子透传）+ RES-install-surface.md（P2 测绘 165 行）+ VERIFY-P.md（12/12 复核，含 P3 必须吸收的 2 条修正：fuse 9 字节明文 schema '0'=off+asar 完整性 off 双证；消费面零漂移措辞）+ P1 漂移报告（pi-ai 官方 1.3.0）。
> 用户授权：外部覆盖官方文件打补丁（2026-11-14 明示）。

## 形态裁定

- 独立补丁工具：仓内 `patcher/zctx-patch.mjs`（零依赖优先；asar 手术用 @electron/asar 官方包——运行时按需引导安装或 devDep）+ `patcher/README.md`（使用/回滚/限制）。
- **补丁连接设计（关键）**：配置（YAML）带不了回调 → 补丁只插一行防御性转发桩进官方 PiAiAdapter 的 profileOptions 构造点：`...(globalThis.__zctxPatch__?.wireOptions?.(profileInfo) ?? {})`——插件启动时挂 `globalThis.__zctxPatch__`（wireOptions 返回 {onPayload, fetch, headers} 绑定插件账本，身份=provider/model+options.sessionId 可达时）；插件缺席/未启用→桩返回 {} 零操作。补丁与插件解耦：补丁可独立重打/回滚，插件独立升级。
- **门控**：目标 asar 内 dsh-llm-pi-ai lib/index.js SHA-256 必须命中已知锚集（rc.3=e956da3d…）；不命中→refuse+报告（官方升级后锚漂移=预期路径，patcher 更新锚集再支持）。

## 产物

1. `patcher/zctx-patch.mjs`：子命令 `patch` / `restore` / `status`：
   - patch：定位 app 目录（--app-dir 或注册表默认 H:\AiAgent\DeepSeekHarness）→ 版本门（asar 内 package.json @deepseek-ai/dsh-desktop 版本∈支持集）→ 锚哈希门 → **原件备份**（app 目录 sibling `zctx-backup/<timestamp>/`+RESTORE.md 含 SHA-256 与还原命令——§5 纪律在用户机器上的落地）→ @electron/asar extract 目标文件→字符串替换（锚唯一性断言）→ repack → 后校验（patched 内容断言+marker 写入 `<app>/.zctx-patch.json`{version,anchors,timestamp}）→ 汇报
   - restore：从备份还原+marker 清除
   - status：只读报告（版本/锚命中/patch 在场/备份清单/锁面=app 是否运行）
2. **插件侧接收**（src 内小改）：启动挂 globalThis.__zctxPatch__.wireOptions（绑定 buildWireFaces+store 路由）；zctx_status 补"补丁在场/缺席"行（读 marker+globalThis 双源）；补丁缺席=现有面不变（自动降级）
3. **测试**：合成 mini-asar fixture 上的 patch/restore/幂等重跑/锚不命中拒收/版本门拒收；插件侧 globalThis 挂载与 wire 账本贯通；status 双源
4. **文档**：patcher/README.md（风险如实：asar 补丁存活期=官方更新覆盖，更新后需重跑；fuse off 已实证但为运行时事实非承诺；app 关闭时执行）
5. **验证脚本扩展**：verify-activation-surface 补 patcher 面断言（文件在盘+锚集在册）

## 验收

- 单测全绿（既有 472+新增）+tsc 零错+build 绿+五探针全绿+patcher 自测（fixture）绿；干净树
- 真机执行属 W5-A6-INSTALL 伞下 post-merge（不在本波）——patcher 对真机的实际执行如实 SKIPPED 登记
- 小步提交 feat(ZCTX): P4 <module>；台账落盘

## 约束

- 红线 R1-R8（补丁桩零 body 改写——只加 options 字段转发）；**用户机器操作纪律**：本波只在合成 fixture 上测试，真机 patch/restore 命令实现但不执行（W5-A6-INSTALL 伞）；备份先行；幂等；锚漂移 refuse 不硬来
- 开工首动作=查册；长内容 Write/Edit；先 tsc 后 vitest；卡壳如实报告；遗留为零
