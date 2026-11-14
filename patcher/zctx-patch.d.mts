/**
 * Type surface of patcher/zctx-patch.mjs (the .mjs ships its own runtime;
 * this declaration exists only so the tsc lint pass type-checks the test
 * imports — structural, deliberately loose where the tool is dynamic).
 */

/** One per-version anchor-set entry (SUPPORTED values). */
export interface ZctxPatchAnchorEntry {
  readonly shellPackage: string
  /** asar-relative path of the execution target (lib/index.js). */
  readonly targetPath: string
  /** SHA-256 of the PRISTINE (unpatched) target content. */
  readonly targetSha256: string
  readonly anchors: {
    readonly callSite: string
    readonly definition: string
    readonly stubMarker: string
  }
  /** The one-line forwarding stub (complete expression incl. trailing comma). */
  readonly stub: string
  /** Indentation prefix for the inserted stub line. */
  readonly stubIndent: string
}

/** The support matrix keyed by shell (desktop app) version. */
export const SUPPORTED: Record<string, ZctxPatchAnchorEntry>

export const PATCHER_VERSION: string

export function desktopLockPath(dshHome?: string): string

/** File integrity record (SHA256 whole + 4 MiB blocks, asar spec). */
export function computeIntegrity(
  buf: Buffer,
): { algorithm: string; hash: string; blockSize: number; blocks: readonly string[] }

export interface PatchTextResult {
  readonly ok: boolean
  readonly alreadyPatched?: boolean
  readonly reason?: string
  readonly text?: string
  readonly byteLength?: number
}

/** Pure text patch: anchor uniqueness + idempotence + post-asserts. */
export function patchText(text: string, entry: ZctxPatchAnchorEntry): PatchTextResult

export interface SpliceResult {
  readonly buffer: Buffer
  readonly before: { readonly size: number; readonly sha256: string }
  readonly after: { readonly size: number; readonly sha256: string }
  readonly delta: number
  readonly headerSizeBefore: number
  readonly headerSizeAfter: number
  readonly payloadSizeBefore: number
  readonly witnesses: readonly {
    readonly path: string
    readonly oldOffset: number
    /** Whether the file sits after the target region (its offset shifts by the splice delta). */
    readonly afterTarget: boolean
    readonly size: number
    readonly integrityHash: string
  }[]
}

/** Surgical single-file splice (header JSON + payload rebuilt around it). */
export function spliceAsar(args: {
  asarPath: string
  targetPath: string
  entry: ZctxPatchAnchorEntry
  patchedText: string
}): SpliceResult

export function resolveAppDir(
  explicit?: string,
): { appDir?: string; source: 'argument' | 'registry' | 'default' | 'none' }

export function probeAppRunningDefault(): 'yes' | 'no' | 'unknown'

export function appRunningGate(args: {
  dshHome?: string
  probeAppRunning?: () => 'yes' | 'no' | 'unknown'
}): { ok: boolean; reason?: string; detail?: string }

export function backupRootFor(appDir: string): string

export interface PatchStep {
  readonly name: string
  readonly status: string
  readonly detail?: string
}

export interface PatchAsarResult {
  readonly ok: boolean
  readonly refused?: boolean
  readonly alreadyPatched?: boolean
  /** True when the idempotence run backfilled a missing marker (crash-window self-heal). */
  readonly markerBackfilled?: boolean
  readonly appDir: string
  readonly asarPath: string
  readonly steps: readonly PatchStep[]
  readonly shellVersion?: string
  readonly backup?: { readonly dir: string; readonly asarSha256: string; readonly markerBackedUp: boolean }
  readonly before?: { readonly size: number; readonly sha256: string }
  readonly after?: { readonly size: number; readonly sha256: string }
  readonly recovery?: string
}

export async function patchAsar(args: {
  appDir: string
  dshHome?: string
  probeAppRunning?: () => 'yes' | 'no' | 'unknown'
  entry?: ZctxPatchAnchorEntry
  versions?: Record<string, ZctxPatchAnchorEntry>
}): Promise<PatchAsarResult>

export async function restoreAsar(args: {
  appDir: string
  dshHome?: string
  probeAppRunning?: () => 'yes' | 'no' | 'unknown'
  backup?: string
}): Promise<{
  ok: boolean
  refused?: boolean
  appDir: string
  asarPath: string
  steps: readonly PatchStep[]
  backupDir?: string
  recovery?: string
}>

export async function statusAsar(args: {
  appDir: string
  dshHome?: string
  probeAppRunning?: () => 'yes' | 'no' | 'unknown'
  versions?: Record<string, ZctxPatchAnchorEntry>
  entry?: ZctxPatchAnchorEntry
}): Promise<{
  appDir: string
  asarPath: string
  asarExists: boolean
  shellVersion?: string
  anchorHit?: 'match (pristine)' | 'mismatch (drift)' | 'unknown'
  targetSha256?: string
  patched?: boolean | 'unknown'
  marker?: { readonly state: 'present' | 'absent' | 'unknown'; readonly path: string; readonly version?: string; readonly timestamp?: string; readonly reason?: string }
  backups?: readonly { readonly dir: string }[]
  lock?: { readonly path: string; readonly exists: boolean }
  appRunning?: 'yes' | 'no' | 'unknown'
  note?: string
}>
