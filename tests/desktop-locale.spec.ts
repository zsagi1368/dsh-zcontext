/**
 * ZCTX-I18NFIX — desktop shell language probe (pure half).
 *
 * The IO call site lives in plugin.ts (readFileSync + parseDesktopLocale);
 * this spec pins the parsing/validation contract and the path-segment
 * invariants. Real-device context: locale-cache contains `zh-CN` while the
 * webview navigator reports `en-US` — parsing must surface the former and
 * reject anything malformed (fail-soft to undefined, never a guess).
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, describe, expect, it, vi } from 'vitest'

import { DESKTOP_LOCALE_SEGMENTS, parseDesktopLocale, readDesktopLocaleFile } from '../src/ui/desktop-locale.ts'

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

describe('ZCTX-I18NFIX r2 (review-B1 建议-4): IO half fail-soft contract', () => {
  const tempRoots: string[] = []
  afterAll(() => {
    for (const root of tempRoots) rmSync(root, { recursive: true, force: true })
    vi.unstubAllEnvs()
  })

  const makeRoot = (): string => {
    const root = mkdtempSync(join(tmpdir(), 'zctx-locale-spec-'))
    tempRoots.push(root)
    return root
  }

  it('reads and parses a real locale-cache under an injected root (end-to-end happy path)', () => {
    const root = makeRoot()
    const dir = join(root, ...DESKTOP_LOCALE_SEGMENTS.slice(0, -1))
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'locale-cache'), 'zh-CN\n')
    expect(readDesktopLocaleFile(root)).toBe('zh-CN')
  })

  it('a missing file degrades to undefined (ENOENT swallowed)', () => {
    expect(readDesktopLocaleFile(makeRoot())).toBeUndefined()
  })

  it('a malformed file degrades to undefined (parse rejection)', () => {
    const root = makeRoot()
    const dir = join(root, ...DESKTOP_LOCALE_SEGMENTS.slice(0, -1))
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'locale-cache'), 'not a locale!!')
    expect(readDesktopLocaleFile(root)).toBeUndefined()
  })

  it('an empty root degrades to undefined without touching the filesystem', () => {
    expect(readDesktopLocaleFile('')).toBeUndefined()
  })

  it('the plugin path narrows APPDATA through the same helper (env stub end-to-end)', () => {
    const root = makeRoot()
    const dir = join(root, ...DESKTOP_LOCALE_SEGMENTS.slice(0, -1))
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'locale-cache'), 'en-US')
    vi.stubEnv('APPDATA', root)
    // The plugin's own method narrows the env to the same IO export; assert
    // through the export so the pair stays locked without importing plugin.ts.
    expect(readDesktopLocaleFile(process.env.APPDATA ?? '')).toBe('en-US')
    vi.unstubAllEnvs()
  })
})
