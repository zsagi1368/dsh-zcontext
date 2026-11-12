# W5 任务卡：文档+验证+发布准备

> 前置：W4 合入。

## 产物

1. `scripts/verify-activation-surface.mjs`（node 直读，禁 grep——ugrep 假阴性坑）：
   - Z3 产物在盘断言：lib/index.js + lib/index.d.ts 存在且 git ls-tree 含 lib/
   - package.json 断言：dsh.bundle.patch 声明、无 scripts.prepare/build 发布依赖、无 dsh.client 字段、peerDeps 有 cordis
   - Z7 探针：node import lib/index.js → 断言 default 类、name==='dsh-zcontext'、静态 Config 存在
   - cordis.patch.yml 断言：- insert 行含 id/name=dsh-zcontext（yml 逐行解析）
   - checkpoint 形态断言：lib/index.js 内含 'zctx-fold' 与 'zctx-unfold' 特征串
   - 全绿 exit 0，任一失败 exit 1+明细
2. `README.md` + `README.zh.md`（双语非机翻镜像；en/zh 锚点统一；内容：是什么/为什么/安装（dsh plugin add github:zsagi1368/dsh-zcontext）/四工具用法/与官方 compaction 关系（共存，不关停）/设置项表/限制（模型采用率依赖、无 wire 级兜底——官方 compaction 是硬底）/致谢段：机制灵感致谢 billion-context（MIT）+ 我方 CCM 研究，净室声明）
3. `CHANGELOG.md` 0.1.0 完整条目（features/limitations/security）
4. `SECURITY.md`（威胁模型：会话数据=本地、零网络、零遥测、模型伪造防御=服务端验证+原生回执）
5. 真机冒烟（有条件执行）：
   - 若 zDSH-main node_modules 存在已构建 loader：隔离 node 进程用真 loader 挂载探针（DSH_HOME=<tmp>）
   - 无运行时→脚本如实输出 SKIPPED + 登记为发布后步骤
6. governance 台账：tasks/ZCTX/checkpoint.json+progress.md 追加、closures/closure.json 初始化

## 验收

- verify-activation-surface.mjs exit 0（或 SKIPPED 项明示）
- pnpm build/lint/test 三绿
- 双语 README 逐节对齐（三门约束）
- 提交 `docs(ZCTX): W5 docs+verification`
