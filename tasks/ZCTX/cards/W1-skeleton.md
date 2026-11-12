# W1 任务卡：仓库工程骨架

> 方案门状态：待 architect 对抗评审放行后才可派发执行。
> 依据：reports/plans/ZCTX-plan.md §3 契约冻结 + §5 波次表。

## 目标

建立 dsh-zcontext 可构建、可测试、可被官方 loader 识别的最小工程骨架（build/typecheck/test 全绿）。

## 产物清单（相对仓根）

1. `package.json`：
   - name=dsh-zcontext, version=0.1.0, type=module, main/types=lib/index.js(.d.ts)
   - `dsh`: `{ manifestVersion: 1, bundle: { patch: "./cordis.patch.yml" } }`
   - peerDependencies: `@deepseek-ai/cordis >=4`（optional meta true）
   - devDependencies: typescript ^5.9, tsdown ^0.22, vitest ^4, @types/node ^24
   - scripts: build=tsdown / lint=tsc --noEmit / test=vitest run
   - **禁 build/prepare 脚本**（Z3：产物入库免 allowBuilds）
   - engines.node >=22.13
2. `cordis.patch.yml`：`- insert: [{ id: dsh-zcontext, name: dsh-zcontext }]`（官方语法，禁 config 内嵌嵌套对象）
3. `tsdown.config.ts`：单 entry src/index.ts → lib/ ESM + dts + sourcemap；neverBundle /^@deepseek-ai\//
4. `tsconfig.json`：module ESNext、moduleResolution bundler、strict、noEmit（lint 用）
5. `vitest.config.ts`：node 环境、tests/**/*.spec.ts
6. `src/index.ts`：最小类骨架——`export class Zcontext { static inject=[]; static Config=…; constructor(ctx,config){} }` + default export + named exports（apply 兼容形态可后补，先类形态）+ `export const name='dsh-zcontext'`
7. `tests/smoke.spec.ts`：import lib 断言 name/inject/类存在（探针雏形）
8. `AGENTS.md`（仓规：净室纪律/Z3 产物入库/单写者/评分门）、`LICENSE`（MIT）、`CHANGELOG.md`（0.1.0 条目）
9. `.gitignore` 更新：忽略 node_modules，**不忽略 lib**

## 验收

- `pnpm install`（devDeps 装齐）→ `pnpm build` 产 lib/ → `pnpm lint` 零错 → `pnpm test` 绿
- package.json 断言：dsh.bundle 存在、无 scripts.build 依赖的 prepare、无 dsh.client 字段
- git 小提交 `feat(ZCTX): W1 skeleton`

## 约束

- 不实现任何折叠逻辑（W2-W4 的活）。
- 不引入 react/client 面。
- Config schema 字段按 plan §3（enabled/nudgeThresholds/keepRecentTokens/maxFoldFraction/minFoldableTokens/protectionFloorTokens/summaryFloorChars/netShrinkTolerance，全 primitive，默认值照 plan）。
