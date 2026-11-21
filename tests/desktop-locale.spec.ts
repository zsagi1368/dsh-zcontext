/**
 * ZCTX-I18NFIX — desktop shell language probe (pure half).
 *
 * The IO call site lives in plugin.ts (readFileSync + parseDesktopLocale);
 * this spec pins the parsing/validation contract and the path-segment
 * invariants. Real-device context: locale-cache contains `zh-CN` while the
 * webview navigator reports `en-US` — parsing must surface the former and
 * reject anything malformed (fail-soft to undefined, never a guess).
 */

import { describe, expect, it } from 'vitest'

import { DESKTOP_LOCALE_SEGMENTS, parseDesktopLocale } from '../src/ui/desktop-locale.ts'

describe('ZCTX-I18NFIX: parseDesktopLocale (locale-cache content contract)', () => {
  it('accepts the real-device value zh-CN (trim included)', () => {
    expect(parseDesktopLocale('zh-CN')).toBe('zh-CN')
    expect(parseDesktopLocale('  zh-CN\n')).toBe('zh-CN')
  })

  it('accepts other well-formed BCP-47-ish tags (en, zh, pt-BR, zh-Hans-CN)', () => {
    expect(parseDesktopLocale('en')).toBe('en')
    expect(parseDesktopLocale('zh')).toBe('zh')
    expect(parseDesktopLocale('pt-BR')).toBe('pt-BR')
    expect(parseDesktopLocale('zh-Hans-CN')).toBe('zh-Hans-CN')
  })

  it('rejects empty content', () => {
    expect(parseDesktopLocale('')).toBeUndefined()
    expect(parseDesktopLocale('   \n')).toBeUndefined()
  })

  it('rejects malformed or overlong content (never guesses)', () => {
    expect(parseDesktopLocale('not a locale')).toBeUndefined()
    expect(parseDesktopLocale('zh_CN_extra!!')).toBeUndefined()
    expect(parseDesktopLocale('1-22')).toBeUndefined()
    expect(parseDesktopLocale('zh-CN'.padEnd(36, 'a'))).toBeUndefined()
  })
})

describe('ZCTX-I18NFIX: DESKTOP_LOCALE_SEGMENTS path invariants', () => {
  it('every segment is a separator-free literal (no traversal possible from the fixed path)', () => {
    expect(DESKTOP_LOCALE_SEGMENTS.length).toBeGreaterThanOrEqual(2)
    for (const segment of DESKTOP_LOCALE_SEGMENTS) {
      expect(segment).toMatch(/^[^\\/:]+$/)
      expect(segment).not.toContain('..')
    }
    expect(DESKTOP_LOCALE_SEGMENTS[DESKTOP_LOCALE_SEGMENTS.length - 1]).toBe('locale-cache')
  })
})
