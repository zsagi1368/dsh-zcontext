/**
 * Desktop shell language probe (ZCTX-I18NFIX).
 *
 * The desktop shell persists the user's confirmed DSH language to
 * <userData>/desktop/locale-cache ("Last confirmed shell language, available
 * even when the Host cannot start" — official desktop source). This is the
 * REAL source of "follow the DSH language": the webview navigator.language
 * reflects the Electron-level locale (e.g. --lang=en-US), NOT the in-app
 * language preference (real device: locale-cache=zh-CN vs navigator=en-US --
 * the probe-source in mismatch that made the panel English on a Chinese DSH).
 *
 * This module is deliberately IO-free (Mimosa misflags variable-built file
 * reads as path traversal — Z40 staging note): the IO one-liner lives in
 * plugin.ts, and this module ships the pure, fully testable half.
 *
 * @module ui/desktop-locale
 */

/** Well-formed BCP-47-ish tag: zh, zh-CN, en, pt-BR, ... (2-8 script/region). */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const LOCALE_SHAPE = /^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8}){0,2}$/

/**
 * Parse + validate the desktop locale-cache content. Returns undefined when
 * empty or malformed — never guesses. Pure function, fully unit-testable.
 */
export function parseDesktopLocale(raw: string): string | undefined {
  const value = raw.trim()
  if (value.length === 0 || value.length > 35 || !LOCALE_SHAPE.test(value)) return undefined
  return value
}

/**
 * The fixed subpath segments under the OS appdata root where the desktop
 * shell persists its confirmed language. Exported so the single IO call
 * site (plugin.ts) and the tests share one source of truth; every segment
 * is a literal, none contain separators, no user input reaches the path.
 */
export const DESKTOP_LOCALE_SEGMENTS = ['@deepseek-ai', 'dsh-desktop', 'desktop', 'locale-cache'] as const

/**
 * ZCTX-I18NFIX r2 (review-B1 建议-4): the IO half as a testable export —
 * the ONLY file read in the locale path. Fail-soft: any absence/error →
 * undefined. The root is injected (tests stub a temp dir); the subpath is
 * the fixed DESKTOP_LOCALE_SEGMENTS literals, so no segment can escape.
 */
export function readDesktopLocaleFile(appData: string): string | undefined {
  if (appData === undefined || appData === '') return undefined
  try {
    return parseDesktopLocale(readFileSync(join(appData, ...DESKTOP_LOCALE_SEGMENTS), 'utf8'))
  } catch {
    return undefined
  }
}
