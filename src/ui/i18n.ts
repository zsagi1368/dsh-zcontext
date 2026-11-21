/**
 * ui/i18n — bilingual dictionary for the zctx UI (ZCTX-POLISH wave 2).
 *
 * STRATEGY (user 2026-11-20: "语言跟随 DSH，默认中文，其他语言只显示英语"):
 * - default = zh (the product's primary audience);
 * - `en` for everyone else;
 * - resolution order: the settings override (`uiLanguage`) → a host locale
 *   capability probe (when present) → zh. The host locale surface is an
 *   UNRESOLVED research item (RES-UI-FEASIBILITY A2-4 family) — the probe is
 *   best-effort and must never block boot.
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
  configNotLoaded: { zh: '（配置未加载）', en: '(config not loaded)' },
  readonlyNote: { zh: '设置修改请到完整面板（此处只读，避免越权写入）：', en: 'Read-only here — edit on the full page: ' },
  openFullPanel: { zh: '打开完整面板 →', en: 'Open full panel →' },
  copyAddress: { zh: '复制完整面板地址', en: 'Copy panel address' },
  copied: { zh: '✓ 地址已复制', en: '✓ Address copied' },
  save: { zh: '保存设置', en: 'Save settings' },
  saved: { zh: '✓ 已保存（新会话生效）', en: '✓ Saved (applies to new sessions)' },
  saveFailed: { zh: '✗ 保存失败', en: '✗ Save failed' },
  fetchError: { zh: '数据读取失败', en: 'Snapshot read failed' },
  retryHint: { zh: '（保留上次快照，5s 后重试）', en: '(keeping last snapshot; retrying in 5s)' },
  language: { zh: '语言', en: 'Language' },
  langAuto: { zh: '跟随 DSH（默认中文）', en: 'Follow DSH (default Chinese)' },
  langZh: { zh: '中文', en: 'Chinese' },
  langEn: { zh: '英语', en: 'English' },
} as const

export type UiDictKey = keyof typeof UI_DICT

/** Resolve the UI language from the settings value (auto/zh/en) + optional host hint. */
export function resolveLang(pref: string | undefined, hostHint?: string): UiLang {
  if (pref === 'zh' || pref === 'en') return pref
  if (hostHint !== undefined && hostHint !== '') {
    const h = hostHint.toLowerCase()
    if (h.startsWith('en')) return 'en'
    if (h.startsWith('zh')) return 'zh'
  }
  return 'zh'
}

/
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
