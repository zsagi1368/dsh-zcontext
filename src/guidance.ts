/**
 * Static guidance section registration data (options.md §2 方案甲 2, plan §3
 * S10). The text itself lives in texts.ts (single home of model-facing text;
 * original writing — clean-room, zero copied prompt text).
 *
 * Hard constraints (S10):
 * - byte-stable: no timestamps, counters, or any dynamic content;
 * - the section spec NEVER sets `complete: true` — an effective complete
 *   section replaces the whole assembled system prompt
 *   (official system-prompt/src/index.ts:59-78, 649-653);
 * - the section is static text, so it lands in the cached prompt prefix once
 *   and stays put (the cache-accounted fixed wire overhead, S1).
 *
 * Zero host imports; pure data.
 *
 * @module guidance
 */

import {
  GUIDANCE_SECTION_ID,
  GUIDANCE_SECTION_TEXT,
  GUIDANCE_SECTION_TITLE,
} from './texts.ts'

/**
 * Structural mirror of the official PromptSection registration input
 * (system-prompt/src/index.ts:474-481 area). `complete` is deliberately
 * ABSENT: the type forbids carrying it, and `buildGuidanceSection` never
 * emits the key — `guidance.spec.ts` asserts both (S10).
 */
export interface GuidanceSectionSpec {
  /** Unique section name (duplicate registration throws in the host). */
  readonly name: string
  /** Ascending concatenation order (official PromptSection.order). */
  readonly order: number
  /** Static byte-stable guidance text (S10). */
  readonly text: string
  /**
   * Literal text preservation: the guidance contains no `{{variable}}`
   * references, so interpolation stays off — a stray brace pair can never
   * corrupt the rendered prompt.
   */
  readonly interpolate: false
}

/**
 * Late assembly order: the guidance rides after the core prompt layers.
 * Exact value reviewed at W4 wiring against the host's layer orders; the
 * byte-stability contract does not depend on it.
 */
export const GUIDANCE_SECTION_ORDER = 900

/**
 * Build the frozen guidance section spec (same bytes on every call — S10).
 */
export function buildGuidanceSection(): GuidanceSectionSpec {
  return Object.freeze({
    name: GUIDANCE_SECTION_ID,
    order: GUIDANCE_SECTION_ORDER,
    text: GUIDANCE_SECTION_TEXT,
    interpolate: false as const,
  })
}

/**
 * Title exported for W4's `/zctx` command help and settings copy — not part
 * of the section registration itself.
 */
export const GUIDANCE_TITLE = GUIDANCE_SECTION_TITLE
