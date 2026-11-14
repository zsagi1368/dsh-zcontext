/**
 * The canonical pi-ai thinking-level vocabulary (P3-r1 P3-6 same-source pin).
 *
 * providers.ts keeps the LOCAL construction-gate set (LEGAL_PI_AI_LEVELS) and
 * zctx-adapter.ts keeps the escalation-order twin (THINKING_LEVEL_ORDER); the
 * two source lists must stay in sync ("changing one without the other is a
 * spec-level drift" — providers.ts header note). This helper is the ONE test
 * source both pins assert against: drift in either private list breaks its
 * own face pin, and the cross-face assertion fails if the two ever diverge.
 *
 * Order = the official escalation order (catalog.ts:69-86):
 * off < minimal < low < medium < high < xhigh < max.
 */
export const PI_AI_THINKING_LEVELS = [
  'off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max',
] as const
