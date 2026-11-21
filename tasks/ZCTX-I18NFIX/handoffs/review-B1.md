# review-B1 — ZCTX-I18NFIX 对抗评审

- 评审人: reviewer-B1（独立 subagent，≠作者；作者=主线）
- 对象: worktree `worktrees/ZCTX-I18NFIX`, HEAD=f302f2f, base=merge-base(72d6ea1)
- diff 范围: src 8 文件 + tests 3 文件 + tasks 4 文件 + 构建产物（623 insertions）；无 patcher/ 文件
- 方法: 全 diff 通读 + 关键全文核验（resolveLang/writeOverlay/save 路径/normalize 链/S-2 测试）+ 独立复现门（vitest 781/781、tsc --noEmit exit 0、三触达 spec 55/55、dist/lib 同步 grep）
- 评审日: 2026-11-21

## 结论先行

无 [阻断] 项；5 条 [建议]（均须按 §0.1/§11 落 disposition，阻塞最终验收不阻塞中间合入）。总分 90 < 98。

**VERDICT: REWORK**（差距清单见文末；预计一轮小修可回 98+，不改架构）

---

## 逐项评审

### [阻断] — 无

重点核验过、确认无阻断的证据：

1. **语言链优先级**与设计一致（显式 zh/en 生效、auto/缺省走探测）：
   - `src/client/index.ts:387-389` — `prefRaw` 仅接受字符串；`pref` 收窄到 `'zh'|'en'`，`'auto'`/缺失/异型值统一折叠为 undefined；`resolveLang(pref, typeof value.locale === 'string' ? value.locale : navLang)`。
   - `src/ui/i18n.ts:88-96` — `resolveLang`: pref zh/en 立即返回；hostHint zh* → zh、其他已知 → en；探测全缺 → zh。链序 = 显式 > snapshot.locale > navigator > 默认 zh，与设计一致。
   - 测试臂锁定关键方向：locale=zh-CN 击败 navigator=en-US（真机错位方向，`tests/panel-i18n.spec.ts:537-556`）；显式 zh 击败 en-US locale（:580-600）。
2. **readDesktopLocale fail-soft 完备**：`src/plugin.ts:515-522` — APPDATA undefined/'' → undefined；readFileSync（ENOENT/EACCES/EISDIR/编码替换符）全部入 catch → undefined；`src/ui/desktop-locale.ts:26-29` 纯函数永不抛（trim 后空/超长/形状不符 → undefined）。BOM（\uFEFF）被 trim() 吞掉，实测语义成立；UTF-8 非法字节替换为 U+FFFD 后被形状正则拒绝。无未捕获路径。
3. **snapshot locale null vs undefined 语义**：`src/ui/routes.ts:145` 恒下发 `locale: desktopLocale() ?? null`（字段恒存在）；`src/client/index.ts:331` 仅拷贝 string；client 侧 `typeof value.locale === 'string'` 将 null/undefined 同归 navigator 兜底——三态（'zh-CN' | null | 旧宿主无字段）语义闭合。旧面板 bundle 读新宿主（多出的 locale 字段被忽略）、新面板读旧宿主（无字段→navigator）双向向后兼容。
4. **GET fields bag uiLanguage undefined 被 JSON.stringify 丢弃 → 面板兜底成立**：`src/ui/index.ts:64-66` 未配置时 `all.uiLanguage` 为 undefined → GET 响应无该键；client 两处兜底：语言链 `prefRaw` undefined → auto（client/index.ts:387），选择器 `defaultValue: typeof cfg.uiLanguage === 'string' ? cfg.uiLanguage : 'auto'`（:523）。测试臂 4（fields:{} → defaultValue 'auto' + 三 option）覆盖（panel-i18n.spec.ts:602-624）。
5. **值域校验无 bypass 面**：POST 两条 wire 形状（`{fields:{...},faceSwitches:{...}}` 与平铺）先 normalize 拍平（`src/ui/routes.ts:203-214`），统一走 `sanitizePatch`（:216）；uiLanguage 域校验在 sanitizePatch 内部（`src/ui/config-write.ts:91-93`），与白名单逐键同批，任何到达 writeOverlay 的 patch 必过域校验（writeOverlay 仅被 checked.patch 喂入，routes.ts:221）。嵌套二次包装 `{fields:{fields:{...}}}` 拍平一层后 'fields' 不在白名单 → 整体 400，fail-closed。写授权链未动（authorizeWrite 位置不变，routes.ts:189）。测试 3 合法值 + 6 非法值（'ZH'/'english'/''/1/null）全 400 且 editor 零调用（zctx-ui.spec.ts:535-565）。
6. **S-2 死键无冲突**：八死键名单测试仍在且通过（`tests/panel-i18n.spec.ts:165-168`）；新键 `uiLanguage/langOptFollow/langOptZh/langOptEn/langAutoNote` 与死键 `language/langAuto/langZh/langEn/...` 无一重合（i18n.ts:71-75）。
7. **R1 不变**：`git diff 72d6ea1...HEAD --name-only | grep -c patcher` = 0；UI/plugin-only 改动。
8. **构建产物同步**：`dist/client.cjs` 含 langOptFollow/uiLanguage 11 处、`lib/index.js` 含 locale-cache、`lib/index.d.ts:2433,2477` 含 desktopLocale——src 与产物一致，发布包即修。
9. **独立复现**：`npx vitest run` → 781/781（38 文件）；`npx tsc --noEmit` → exit 0；三触达 spec 单独复跑 55/55。checkpoint 申报门全部复现，无伪造迹象。

### [建议] — 5 条（每条须落唯一 disposition；不阻塞中间合入，阻塞最终验收）

- **[建议-1] src/client/index.ts:199-204（cardLang 注释失实）+ tasks/ZCTX-I18NFIX/task.json:5（契约叙述偏差）** — cardLang 注释仍写 "navigator.language inherits the DSH host setting"，被本任务自己的根因结论直接证伪（真机 navigator=en-US 而 DSH=zh-CN）。后果：摘要卡在真机上仍渲染英文（原投诉症状在卡片面残留）。task.json goal 叙述写 "面板/卡片语言真正跟随"，但实现只覆盖面板，closure.json 无卡片延期条目；验收数组（可执行契约）确实未含卡片——故定建议级而非阻断。修复二选一：(a) 锚定卡片语言（card 拿 snapshot.locale 或宿主一次性下发）；(b) 修正注释如实陈述已知分歧 + 卡片轻量取舍，并在 closure.json 记 `user_approved_deferred`（须用户真实批准）。
- **[建议-2] CHANGELOG.md 未更新** — 仓库根存在 CHANGELOG.md 且本 diff 未触碰。面板语言行为变更 + 新增选择器属用户可见变更，按 §15"文档同批更新"应补条目。
- **[建议-3] src/ui/i18n.ts:71-74,116（4 个 UI_DICT 条目零使用，双源标签）** — `uiLanguage/langOptFollow/langOptZh/langOptEn` 在 UI_DICT 中定义，但全 src/tests grep 零调用点：选择器标签唯一来源是 `UI_LANG_OPTIONS`（i18n.ts:81-85，client/index.ts:383-385 渲染 o.zh/o.en）。同一标签两处维护（UI_DICT.langOpt* vs UI_LANG_OPTIONS；UI_DICT.uiLanguage vs FIELD_LABELS.uiLanguage），改词必漏一处。修复：UI_LANG_OPTIONS 标签引用 UI_DICT.langOpt*（或删冗余条目）。
- **[建议-4] IO 半 fail-soft 无测试臂** — desktop-locale.spec 钉死纯函数半（合法/trim/多标签/空/脏/超长/段不变量，spec:14-49），但 plugin.ts:515-522 的 IO 半（无 APPDATA / 文件缺失 / 异常吞并）零覆盖。仅 8 行 + 全捕获，风险低，但按测试覆盖纪律应补一条臂（如临时目录注入 APPDATA + 不存在路径 → undefined）。
- **[建议-5] tests/panel-i18n.spec.ts:557-578（en-方向探测源区分度不足）** — 臂 2（locale=en-US + navigator=en-US）两源同值，无法证明 locale 参与了 en 方向判定（若实现完全忽略 locale 该臂仍绿）。臂 1 已锁定关键 zh 方向；补一条 locale=en-US + navigator=zh-CN → en 的臂即可双向钉死 locale>navigator。

### 性能评估（非开放项，判定可接受）

`desktopLocale()` 每次 snapshot GET 调一次（面板 5s 轮询；routes.ts:145）。实际成本 = 本地固定路径小文件 readFileSync（内容 ≤35 字符，desktop-locale.ts:27 上限封顶），µs 级同步 IO，事件循环阻塞可忽略。无需 mtime 缓存；若未来轮询频率提高再议。证据：plugin.ts:515-522、desktop-locale.ts:26-29。

### 附带核验（通过，无行动项)

- save 路径收集 select：data-type 'uiLanguage' 非 boolean/number → 落入 `into[key] = el.value` 字符串分支（client/index.ts:596-600），POST 过白名单域校验。未触碰选择器时每次 save 会把 `uiLanguage:'auto'` 物化进 config——语义与缺省等价（GET 回读 'auto' → auto 行为、defaultValue 'auto'），无漂移，仅提示知悉。
- load 半成品配置（手改 config 文件 uiLanguage:123）：client `typeof === 'string'` 双处收窄，非字符串一律按 auto，无崩溃面。
- sanitizePatch 白名单键序无下游索引依赖（UI_CONFIG_KEYS 全仓唯一消费点是 KEY_SET，grep 证据）。
- 摘要卡 fetch 端点不含 locale，与建议-1 的取舍陈述一致。

---

## 六维评分

```json
{
  "task": "ZCTX-I18NFIX",
  "reviewer": "reviewer-B1",
  "head": "f302f2f",
  "base": "72d6ea1",
  "dimensions": {
    "correctness": {
      "score": 24, "max": 25,
      "evidence": "语言链/域校验/fail-soft/null 语义逐项核验通过（client/index.ts:387-389, i18n.ts:88-96, config-write.ts:91-93, plugin.ts:515-522, routes.ts:145）；781/781 + tsc 0 独立复现；dist/lib 同步",
      "deduction": "首帧快照未落地时按 navigator 渲染 en 后翻 zh（异步固有、测试注释已声明）；未触碰选择器的 save 会物化 uiLanguage:'auto' 键（语义等价，非缺陷）"
    },
    "completeness": {
      "score": 18, "max": 20,
      "evidence": "验收数组 4/4 有证据；5 个测试臂 + 2 个 route 臂齐",
      "deduction": "task.json goal 叙述含'卡片'，卡片面未覆盖且 closure 无延期记账（建议-1）"
    },
    "consistency": {
      "score": 17, "max": 20,
      "evidence": "i18n 头注释已与新链一致（i18n.ts:3-21）；S-2 无冲突（panel-i18n.spec.ts:165-168）；白名单/授权链/R1 一致",
      "deduction": "cardLang 注释被本任务根因证伪（client/index.ts:200，建议-1）；标签双源（建议-3）"
    },
    "verifiability": {
      "score": 13, "max": 15,
      "evidence": "checkpoint 全部申报门由评审人独立复现（vitest/tsc/grep patcher=0/dist 同步）；panel 臂断言 settled 渲染 slice(before) 为真断言",
      "deduction": "IO 半 fail-soft 零测试（建议-4）；en-方向臂无区分度（建议-5）"
    },
    "safety_rollback": {
      "score": 10, "max": 10,
      "evidence": "固定字面量路径 + 段不变量测试（desktop-locale.spec.ts:41-49）；值域封闭 + 6 非法值 400；写授权链未动（routes.ts:189）；patcher/ 零 diff；错误路径全 fail-soft；无凭证面"
    },
    "maintainability": {
      "score": 8, "max": 10,
      "evidence": "纯函数/IO 单行分离清晰（desktop-locale.ts 模块注释如实交代 Mimosa 约束）；desktopLocale 可选 accessor 向后兼容",
      "deduction": "4 个零使用 dict 条目（建议-3）；CHANGELOG 未更新（建议-2）"
    }
  },
  "total": 90,
  "hard_block": "none（无伪造/正确性≥23/安全回滚≥9/测试全绿/R1 完好）"
}
```

## 打回差距清单（回 98+ 所需动作，一轮可完成）

1. 建议-1：修 cardLang 注释 + 卡片延期按 §11 记账（或实现卡片锚定）→ 完整性+2、一致性+2
2. 建议-2：补 CHANGELOG 条目 → 可维护性+2
3. 建议-3：消除 UI_DICT/UI_LANG_OPTIONS 双源 → 可维护性+1、一致性+1
4. 建议-4：补 IO 半 fail-soft 测试臂 → 可验证性+1
5. 建议-5：补 locale=en-US + navigator=zh-CN 臂（可随建议-4 同波）

## HANDOFF

```
FROM: reviewer-B1  TO: main
MODE: fix
TASK_REF: ZCTX-I18NFIX review-B1
PAYLOAD: VERDICT REWORK / 总分 90 / 阻断 0 / 建议 5（见本文件清单）；证据均含 文件:行号 与命令输出（vitest 781/781、tsc exit 0、grep patcher=0、dist 同步）
ARTIFACTS: tasks/ZCTX-I18NFIX/handoffs/review-B1.md
SCORE: 见上方六维 JSON（评审人 reviewer-B1，≠作者）
CHECKPOINT: step-1 (763570a6…，主线 checkpoint 未动)
```
