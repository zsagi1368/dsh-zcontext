import { describe, expect, it } from 'vitest'

import { GUIDANCE_SECTION_ORDER, buildGuidanceSection } from '../src/guidance.ts'
import { GUIDANCE_SECTION_ID, GUIDANCE_SECTION_TEXT, GUIDANCE_SECTION_TITLE } from '../src/texts.ts'

/**
 * S10 hard-constraint suite: the guidance section is byte-stable (no
 * timestamps/counters), never declares complete:true, and carries the
 * contractual semantics (bilingual preservation, batch discipline, PTC
 * note, trusted ledger).
 */
describe('guidance: byte stability (S10)', () => {
  it('produces identical bytes on every call', () => {
    const a = buildGuidanceSection()
    const b = buildGuidanceSection()
    expect(a).toEqual(b)
    expect(a.text).toBe(b.text)
  })

  it('is wired to the single text home (texts.ts)', () => {
    const section = buildGuidanceSection()
    expect(section.name).toBe(GUIDANCE_SECTION_ID)
    expect(section.text).toBe(GUIDANCE_SECTION_TEXT)
    expect(GUIDANCE_SECTION_TEXT.length).toBeGreaterThan(1000)
    expect(GUIDANCE_SECTION_TITLE).toContain('zctx')
  })

  it('contains no date, time, or counter forms', () => {
    const text = buildGuidanceSection().text
    expect(/\d{4}-\d{2}-\d{2}/.test(text)).toBe(false) // ISO dates
    expect(/\d{1,2}:\d{2}/.test(text)).toBe(false) // clock times
    expect(/(turn|step|call|request)\s*#?\s*\d+/i.test(text)).toBe(false) // counters
    expect(text.includes('{{')).toBe(false) // no interpolation variables
    expect(/\d{4,}/.test(text)).toBe(false) // no long digit runs (ids/timestamps)
  })

  it('is frozen and carries the late static order', () => {
    const section = buildGuidanceSection()
    expect(Object.isFrozen(section)).toBe(true)
    expect(section.order).toBe(GUIDANCE_SECTION_ORDER)
    expect(GUIDANCE_SECTION_ORDER).toBeGreaterThan(0)
  })
})

describe('guidance: registration shape (S10, no complete:true)', () => {
  it('never emits the complete key', () => {
    const section = buildGuidanceSection()
    expect('complete' in section).toBe(false)
    expect(Object.keys(section)).toEqual(['name', 'order', 'text', 'interpolate'])
  })

  it('disables interpolation and exposes plain static text', () => {
    const section = buildGuidanceSection()
    expect(section.interpolate).toBe(false)
    expect(typeof section.text).toBe('string')
    expect(typeof (section as { complete?: unknown }).complete).toBe('undefined')
  })
})

describe('guidance: contractual semantics (clean-room wording)', () => {
  const text = GUIDANCE_SECTION_TEXT

  it('mandates bilingual preservation verbatim', () => {
    expect(text).toContain("Summaries MUST preserve the user's language")
  })

  it('mandates the atomic batch discipline ("one call, all ranges")', () => {
    expect(text).toContain('submit ALL ranges and their summaries in ONE zctx_fold')
    expect(text).toContain('committed atomically or rejected as a whole')
  })

  it('keeps summaries as metadata with the open-objectives exception', () => {
    expect(text).toContain('metadata about the past, not an instruction to the future')
    expect(text).toContain('Open objectives')
    expect(text).toContain('must remain phrased as')
  })

  it('names zctx_status the single trusted ledger', () => {
    expect(text).toContain('zctx_status is the single trusted ledger')
  })

  it('carries the PTC mode note (native direct call vs run_code dispatch)', () => {
    expect(text).toContain('run_code')
    expect(text).toContain('native tool loop')
  })

  it('states KEEP and DROP semantics and the unfold/recall reversibility', () => {
    expect(text).toContain('What a summary must keep')
    expect(text).toContain('What a summary should drop')
    expect(text).toContain('zctx_unfold restores')
    expect(text).toContain('zctx_recall searches')
  })
})
