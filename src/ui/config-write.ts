/**
 * Overlay config write channel (ZCTX-UI DESIGN §3.4) — D2.
 *
 * HARD RULE (DESIGN §0/#3, §9/#4): configuration is written ONLY through the
 * host `ctx.configEditor.edit(entry, change)` API. The plugin never does fs
 * writes to `cordis.patch.yml` directly. Only the 13 allow-listed keys are
 * accepted; no credentials, no `providers`, no R1 segment.
 *
 * Capability probe: when no configEditor / no `dsh-zcontext` entry exists, the
 * caller returns 503 — never a fabricated success and never a throw.
 *
 * @module ui/config-write
 */

/** The nine core fold/budget fields + four face switches (DESIGN §3.4). */
export const UI_CONFIG_KEYS = [
  'enabled',
  'nudgeThresholds',
  'keepRecentTokens',
  'maxFoldFraction',
  'minFoldableTokens',
  'protectionFloorTokens',
  'summaryFloorChars',
  'summaryCeilingChars',
  'netShrinkTolerance',
  'observe.enabled',
  'patch.guardObserveEvents',
  'autofold.enabled',
  'preflightMode',
] as const

export type UiConfigKey = (typeof UI_CONFIG_KEYS)[number]

const KEY_SET: ReadonlySet<string> = new Set<string>(UI_CONFIG_KEYS)

/** Structural view of the host configEditor service. */
export interface ConfigEditorEntry {
  readonly options?: { readonly id?: string }
  readonly id?: string
}

export interface ConfigEditorLike {
  entries(): readonly ConfigEditorEntry[]
  edit(entry: ConfigEditorEntry, change: (current: Record<string, unknown>, inherited: Record<string, unknown>) => Record<string, unknown>): unknown
}

export interface ConfigWriteResult {
  readonly ok: boolean
  /** Reason when !ok: 'unavailable' (no service/entry) or 'invalid' (bad patch). */
  readonly error?: 'unavailable' | 'invalid'
}

/** Capability-probe the configEditor service off a host context. */
export function resolveConfigEditor(ctx: unknown): ConfigEditorLike | undefined {
  const c = ctx as { get?(k: string): unknown; configEditor?: unknown } | undefined
  let service: unknown
  try {
    service = c?.get?.('configEditor') ?? c?.configEditor
  } catch {
    service = undefined
  }
  if (service === undefined || service === null) return undefined
  const candidate = service as Partial<ConfigEditorLike>
  if (typeof candidate.entries !== 'function' || typeof candidate.edit !== 'function') return undefined
  return service as ConfigEditorLike
}

/** Find the `dsh-zcontext` config entry. */
export function findEntry(editor: ConfigEditorLike): ConfigEditorEntry | undefined {
  let entries: readonly ConfigEditorEntry[]
  try {
    entries = editor.entries() ?? []
  } catch {
    return undefined
  }
  return entries.find((entry) => entry?.options?.id === 'dsh-zcontext' || entry?.id === 'dsh-zcontext')
}

/** Validate + narrow an untrusted JSON patch to allow-listed keys only. */
export function sanitizePatch(patch: unknown): { ok: true; patch: Partial<Record<UiConfigKey, unknown>> } | { ok: false } {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) return { ok: false }
  const source = patch as Record<string, unknown>
  const keys = Object.keys(source)
  if (keys.length === 0) return { ok: false }
  const out: Record<string, unknown> = {}
  for (const key of keys) {
    if (!KEY_SET.has(key)) return { ok: false } // reject unknown keys wholesale (no partial silent drop)
    out[key] = source[key]
  }
  return { ok: true, patch: out as Partial<Record<UiConfigKey, unknown>> }
}

/**
 * Write the overlay patch through configEditor.edit. Returns a structured
 * result; never throws. Success means the host accepted the edit call.
 */
export function writeOverlay(ctx: unknown, patch: Partial<Record<UiConfigKey, unknown>>): ConfigWriteResult {
  const editor = resolveConfigEditor(ctx)
  if (editor === undefined) return { ok: false, error: 'unavailable' }
  const entry = findEntry(editor)
  if (entry === undefined) return { ok: false, error: 'unavailable' }
  try {
    editor.edit(entry, (current, inherited) => ({
      ...(inherited ?? {}),
      ...(current ?? {}),
      ...patch,
    }))
    return { ok: true }
  } catch {
    return { ok: false, error: 'unavailable' }
  }
}
