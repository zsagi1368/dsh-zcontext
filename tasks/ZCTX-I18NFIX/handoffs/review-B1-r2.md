# review-B1-r2 — ZCTX-I18NFIX 复评（对 review-B1 差距清单）

- 评审人: reviewer-B1（独立 subagent，≠作者；作者=主线）
- 对象: worktree HEAD=a6f8900（r2），对照 r1 评审基线 HEAD=f302f2f / base=72d6ea1
- 方法: r2 增量 diff 全读 + 关键全文复核（cardLang/createSummaryCard 全体、parseSummary、UI_LANG_OPTIONS 消费点、readDesktopLocaleFile 调用面、bundle 纯度）+ 门独立复现（tsc exit 0、vitest 788/788、client-slot 28/28 含 handshake、dist/lib 同步 grep）
- 评审日: 2026-11-21
- r1 报告: tasks/ZCTX-I18NFIX/handoffs/review-B1.md（VERDICT REWORK 90，5 建议）

## 五条建议逐项核对（disposition）

### 建议-1（卡片锚定 / 注释失实）→ **fixed / verified**（主线选 (a) 实现）
- SummaryData 增 `locale?: string|null`（src/client/index.ts:128-130）；parseSummary 提取 string locale、否则 null（:173-174；测试臂 client-slot.spec.ts:185-186）。
- `cardLang(localeHint?)` 非空 string 即锚定（client/index.ts:210-211）；SummaryCard 传 `cardLang(data?.locale)`（:244）；fallback 卡显式 `cardLang(null)` 并如实注明"无数据通道、仅 React 缺席面渲染、navigator 兜底"（:258-266）。
- **端到端真实性确认**：卡片 fetch 的正是 `/zctx-ui/api/snapshot`（client/index.ts:183），该端点 r1 起恒下发 locale（src/ui/routes.ts:145）——锚定链不是摆设。
- 新增两臂均为真断言（settled slice(before)）：en-方向 locale>navigator（tests/panel-i18n.spec.ts:581-598，注释明示"若忽略 locale 此臂必红"）；卡片 zh 锚定 vs en-US navigator（:600-613）。
- 旧失实注释已整体替换，根因分歧如实陈述。
- **残余 nano（见 [建议-R2-1]）**：注释尾子句 "the next poll picks up a locale change"（client/index.ts:209）失实——卡片仅在创建时 fetch 一次（:235-237），无轮询；结局正确（DSH 改语言会重载 webview → 卡片重建取新 locale），机制表述错误。

### 建议-2（CHANGELOG）→ **fixed / verified**
- CHANGELOG.md:24-33 重写，逐句与实现核对为真：locale-cache 真锚、navigator=Electron 层仅兜底、链序 显式>snapshot>navigator>默认中文、选择器三态经 config overlay 持久化、卡片同源锚定。无虚标。

### 建议-3（标签单源）→ **fixed（主体）/ verified**，残 1 条
- UI_LANG_OPTIONS 改 `{value, key: UiDictKey}`（src/ui/i18n.ts:80-88），client 渲染 `t(o.key, lang)`（client/index.ts:537-538）；langOptFollow/Zh/En 三键转为活跃消费，选项标签唯一来源=UI_DICT。r1 测试臂（option labels ['跟随 DSH','中文','English']）788 套件内仍绿——值不变。
- **残余（[建议-R2-2]）**：`UI_DICT.uiLanguage`（i18n.ts:71）仍零调用点（grep `t('uiLanguage')` 全仓无命中），活跃标签来自 FIELD_LABELS.uiLanguage（:116）——死重复条目残留 1 行。

### 建议-4（IO 半测试）→ **fixed / verified**
- IO 半导出 `readDesktopLocaleFile(appData)`（src/ui/desktop-locale.ts:47-55），生产调用面唯一（plugin.ts:519，env 收窄后委托）；plugin 旧 try/catch 删除，职责单向（plugin.ts:514-519）。
- 5 臂齐（tests/desktop-locale.spec.ts:56-103）：临时根端到端 happy path / ENOENT / 脏数据 / 空根零 IO / env-stub 端到端；临时目录 mkdtemp 自有前缀 `zctx-locale-spec-` + afterAll rmSync + vi.unstubAllEnvs 清理规整（§5.1 自建自收族）。env-stub 臂诚实注明"经 export 断言锁对、不 import plugin.ts"。

### 建议-5（en-方向臂）→ **fixed / verified**
- locale=en-US + navigator=zh-CN → en，双断言正反（panel-i18n.spec.ts:581-598），补齐 locale>navigator 双向钉死。

## 门复现（评审人独立执行）

- `npx tsc --noEmit` → exit 0。
- `npx vitest run` → 38 文件 788/788（781+5 IO 臂+2 panel 臂=788，数目吻合）；client-slot.spec 单跑 28/28（含 handshake 臂）。
- **bundle 纯度**：dist/client.cjs 无 node:fs/readFileSync（唯一 `locale-cache` 命中经上下文核实=压缩保留的注释文本，非导入）——desktop-locale.ts 引入 node:fs 未泄入 webview 面。
- lib/index.js 含 readDesktopLocaleFile；lib/index.d.ts 无 UI_LANG_OPTIONS/readDesktopLocaleFile 公开声明（二者非 index.ts 公共 API 导出）→ d.ts 无陈旧问题。

## 复评 [建议]（2 条 OPEN nano + 2 条流程条件）

- **[建议-R2-1] src/client/index.ts:209 — cardLang 注释尾子句失实**："(the next poll picks up a locale change)" —— 卡片无轮询，refreshSummary 仅创建时一次（:235-237）。修法：删该括号子句或改为"卡片随宿主重建取新 locale（DSH 改语言会重载 webview）"。r1 同类先例（注释失实）计 -1，本条按比例仍计 -1。
- **[建议-R2-2] src/ui/i18n.ts:71 — UI_DICT.uiLanguage 死条目**：唯一残余的双源标签行（活跃源=FIELD_LABELS.uiLanguage:116）。修法：删除该条（UI_DICT 管界面 chrome 文案、FIELD_LABELS 管 config 键标签——放错位置的条目）。r1 原 4 条已修 3，按"部分修复=仍开放"计残余 -1。
- **[流程-1] 附带核验项（不计分）**：desktop-locale.ts:19-21——LOCALE_SHAPE 的 doc 注释（:19）与声明（:22）被两行 import 隔断，注释成了孤儿。随本轮清理顺带挪正，不单独计分。
- **[流程-2] 收口条件（不计分）**：(a) r2 返工轮尚未写 step-2 checkpoint/progress（a6f8900 仅 git 承载）；按 §1.4 返工并入同块，块闭合时补 checkpoint+progress+closure dispositions（本报告两条 nano 处置后记 fixed/verified）。(b) 验收项 1"真机 snapshot locale=zh-CN"属部署相位证据，最终验收（closure-check -Phase all）前须补真机捕获。

## 六维评分（r2）

```json
{
  "task": "ZCTX-I18NFIX",
  "reviewer": "reviewer-B1",
  "head": "a6f8900",
  "base_of_r2_diff": "f302f2f",
  "dimensions": {
    "correctness": {
      "score": 25, "max": 25,
      "evidence": "两轮对抗扫描零正确性缺陷；r2 新增面逐一核验（parseSummary null 语义、cardLang(null) 兜底、env 收窄、UI_LANG_OPTIONS 改型后 tsc 0）；788/788 + tsc exit 0 独立复现；bundle 无 node 内建",
      "note": "r1 的 -1 复核后改判：首帧 en 闪现为渐进渲染设计内行为（测试显式断言 settled）、save 物化 uiLanguage:'auto' 语义等价——均为已声明的设计取舍而非缺陷，r2 报告如实改判并留痕，非抬分"
    },
    "completeness": {
      "score": 20, "max": 20,
      "evidence": "r1 卡片缺口闭合（实现+解析臂+渲染臂+fallback 注释）；验收数组 4/4 均有代码+测试覆盖；goal 叙述'面板/卡片'现已兑现。真机捕获=部署相位门，非本块交付物"
    },
    "consistency": {
      "score": 19, "max": 20,
      "evidence": "CHANGELOG 逐句核真；i18n 头注释与实现一致；S-2 名单不冲突；task.json 无需改（卡片已覆盖，叙述不再超诺）",
      "deduction": "cardLang 注释尾子句 'next poll' 失实（client/index.ts:209，建议-R2-1）"
    },
    "verifiability": {
      "score": 15, "max": 15,
      "evidence": "探测双向钉死（zh 方向 581 臂前已有、en 方向 581-598）；IO 半 5 臂含 env-stub 端到端；788/788+tsc+handshake 全部评审人独立复现；卡片臂断言 settled 渲染"
    },
    "safety_rollback": {
      "score": 10, "max": 10,
      "evidence": "readDesktopLocaleFile 调用面唯一且根注入+固定字面量子路径（desktop-locale.ts:47-55 + 调用面 grep）；bundle 纯度核验；测试临时目录自有前缀+afterAll 清理；env stub 即时还原；写授权链与 r1 相同未动"
    },
    "maintainability": {
      "score": 9, "max": 10,
      "evidence": "标签单源达成（langOpt* 转活跃）；CHANGELOG 同批；IO/纯函数分离更干净（plugin 只剩 env 收窄）",
      "deduction": "UI_DICT.uiLanguage 死条目残留（i18n.ts:71，建议-R2-2）"
    }
  },
  "total": 97,
  "hard_block": "none（无伪造/正确性 25≥23/安全回滚 10≥9/测试全绿/R1 完好）"
}
```

## 结论

两条 OPEN nano（注释子句 + 死字典行）使总分停在 97 < 98。按 §12.4 记返工第 2 轮（最后一轮）。

**VERDICT: REWORK**（差距极小，一轮 3 行级修改可清零）

差距清单（清零即 98+）：
1. [建议-R2-1] 删/改 client/index.ts:209 "next poll" 子句（1 行）→ 一致性 +1
2. [建议-R2-2] 删 i18n.ts:71 UI_DICT.uiLanguage 死条目（1 行；连同确认无 t() 引用）→ 可维护性 +1
3. [流程-1] 顺带挪正 desktop-locale.ts:19-22 注释/声明次序（0 分项，随批清理）

收口条件（不阻塞本 verdict，阻塞最终验收）：closure.json 补 5+2 条 disposition（fixed/verified + 证据行号）；块闭合写 step-2 checkpoint+progress；部署相位补真机 locale=zh-CN 捕获（验收项 1）。

## HANDOFF

```
FROM: reviewer-B1  TO: main
MODE: fix
TASK_REF: ZCTX-I18NFIX review-B1-r2
PAYLOAD: VERDICT REWORK / 总分 97（r1 90→r2 97）/ 阻断 0 / OPEN nano 2 + 流程条件 2（见清单）；5 条 r1 建议中 4.5 条 fixed/verified
ARTIFACTS: tasks/ZCTX-I18NFIX/handoffs/review-B1-r2.md
SCORE: 见上方六维 JSON（评审人 reviewer-B1，≠作者；门独立复现 tsc0/788/28 含 handshake/bundle 纯度）
CHECKPOINT: step-1（r2 返工轮 checkpoint 待块闭合补）
```
