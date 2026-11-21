/**
 * ui/i18n — bilingual dictionary for the zctx UI (ZCTX-POLISH wave 2).
 *
 * STRATEGY (user 2026-11-20: "语言跟随 DSH，默认中文，其他语言只显示英语";
 * semantics re-pinned by review-B3 B-4a — explicit preference > host probe >
 * default, and a DETECTED non-zh locale maps to `en`, never to zh):
 * - an explicit preference (`'zh'` | `'en'`) always wins;
 * - otherwise the host locale probe (the panel reads the webview's
 *   `navigator.language`, which inherits the DSH language setting):
 *   `zh*` → `zh`; ANY other detected language → `en`;
 * - probe missing/empty → default `zh` (the product's primary audience).
 * There is no settings-override surface: the old `uiLanguage` settings key
 * never shipped; the probe is best-effort and must never block boot.
 *
 * @module ui/i18n
 */

/** Supported UI languages. `zh` is the default; everything else shows `en`. */
export type UiLang = 'zh' | 'en'

/** All UI copy, keyed by stable ids. Both languages are complete. */
export const UI_DICT = {
  panelTitle: { zh: 'zcontext 面板 (BETA)', en: 'zcontext Panel (BETA)' },
  face: { zh: '状态', en: 'face' },
  view: { zh: '查看', en: 'View' },
  stats: { zh: '统计', en: 'Stats' },
  settings: { zh: '设置', en: 'Settings' },
  session: { zh: '会话', en: 'Session' },
  windowPressure: { zh: '窗口占用', en: 'Window pressure' },
  tokens: { zh: 'tokens', en: 'tokens' },
  foldCount: { zh: '折叠次数', en: 'Fold count' },
  foldableRanges: { zh: '可折叠区间', en: 'Foldable ranges' },
  cacheSamples: { zh: '缓存样本', en: 'Cache samples' },
  measured: { zh: '(measured)', en: '(measured)' },
  estimatedNone: { zh: '(estimated/none)', en: '(estimated/none)' },
  degradedRows: { zh: '降级提示', en: 'Degradation notes' },
  rowsSuffix: { zh: ' 条', en: ' rows' },
  configNotLoaded: { zh: '（配置未加载）', en: '(config not loaded)' },
  save: { zh: '保存设置', en: 'Save settings' },
  saved: { zh: '✓ 已保存（新会话生效）', en: '✓ Saved (applies to new sessions)' },
  saveFailed: { zh: '✗ 保存失败', en: '✗ Save failed' },
  fetchError: { zh: '数据读取失败', en: 'Snapshot read failed' },
  retryHint: { zh: '（保留上次快照，5s 后重试）', en: '(keeping last snapshot; retrying in 5s)' },
  // B-4b: the five former hardcoded zh literals below are dictionary keys now.
  cumulative: { zh: '(累计)', en: '(cumulative)' },
  totalsSaved: { zh: '累计节省 tokens: ', en: 'Cumulative tokens saved: ' },
  sessionsCovered: { zh: '覆盖会话: ', en: 'Sessions covered: ' },
  current: { zh: '(当前)', en: '(current)' },
  // S-4: a failed ledger read is shown honestly instead of mislabeling
  // current-session numbers as cumulative.
  statsUnavailable: { zh: '统计暂不可用', en: 'stats unavailable' },
  // B-2a: the face-switch form (four keys, rendered from GET faceSwitches).
  faceSwitches: { zh: 'face 开关', en: 'Face switches' },
  invalidNumber: { zh: '数值字段格式错误（未提交）: ', en: 'Invalid number field(s) — nothing was saved: ' },
  // S-9: the summary card + no-React fallback copy (five former hardcoded zh
  // literals) rides this dictionary too — en mode renders ZERO CJK there.
  // `{n}`/`{p}` are caller-interpolated placeholders (t() stays a pure lookup).
  summaryTitle: { zh: 'zcontext 摘要 (BETA)', en: 'zcontext summary (BETA)' },
  summaryFolds: { zh: '折叠 {n} 次', en: '{n} folds' },
  summaryWindow: { zh: '窗口 {p}%', en: 'Window {p}%' },
  summaryWindowNa: { zh: '窗口 n/a', en: 'Window n/a' },
  panelLinkHint: { zh: '请在左侧菜单 zcontext 打开面板', en: 'Open the panel from the zcontext entry in the left menu' },
} as const

export type UiDictKey = keyof typeof UI_DICT

/**
 * Resolve the UI language: explicit preference > host probe > default zh.
 * A DETECTED non-zh locale maps to `en` (user 2026-11-20 "其他语言只显示英语";
 * review-B3 B-4a — the previous fallthrough returned zh for e.g. ja-JP).
 */
export function resolveLang(pref: string | undefined, hostHint?: string): UiLang {
  if (pref === 'zh' || pref === 'en') return pref
  if (hostHint !== undefined && hostHint !== '') {
    if (hostHint.toLowerCase().startsWith('zh')) return 'zh'
    return 'en'
  }
  return 'zh'
}

/** Config key → zh labels (九字段+face 开关全量；en shows the raw key). */
export const FIELD_LABELS: Record<string, { zh: string; en: string }> = {
  enabled: { zh: '插件总开关', en: 'enabled' },
  nudgeThresholds: { zh: '提示阈值（%）', en: 'nudge thresholds (%)' },
  keepRecentTokens: { zh: '保留最近 tokens', en: 'keep recent tokens' },
  maxFoldFraction: { zh: '最大折叠占比', en: 'max fold fraction' },
  minFoldableTokens: { zh: '最小可折叠 tokens', en: 'min foldable tokens' },
  protectionFloorTokens: { zh: '保护下限 tokens', en: 'protection floor tokens' },
  summaryFloorChars: { zh: '摘要下限字符', en: 'summary floor chars' },
  summaryCeilingChars: { zh: '摘要上限字符', en: 'summary ceiling chars' },
  netShrinkTolerance: { zh: '净缩容容差', en: 'net shrink tolerance' },
  'observe.enabled': { zh: '观测面开关', en: 'observe face' },
  'patch.guardObserveEvents': { zh: '补丁 guard 观测桥', en: 'patch guard-observe bridge' },
  'autofold.enabled': { zh: '自动折叠开关', en: 'autofold face' },
  preflightMode: { zh: 'preflight 模式 (off|observe|enforce)', en: 'preflight mode (off|observe|enforce)' },
}

/** Face state → zh. */
export const FACE_STATE_ZH: Record<string, string> = {
  active: '正常',
  degraded: '降级',
  absent: '未激活',
}

/** Config-key label in the active language. */
export function fieldLabel(key: string, lang: UiLang): string {
  const row = FIELD_LABELS[key]
  return row === undefined ? key : row[lang]
}


/** Translate one key (unknown key → the key itself, loud enough to notice). */
export function t(key: UiDictKey, lang: UiLang): string {
  const row = UI_DICT[key]
  return row === undefined ? String(key) : row[lang]
}
