/**
 * Type surface of patcher/zctx-patch.mjs (the .mjs ships its own runtime;
 * this declaration exists only so the tsc lint pass type-checks the test
 * imports — structural, deliberately loose where the tool is dynamic).
 */

/**
 * One file's patch spec in the v0.2 multi-file patch set: an ordered op list
 * over uniquely-anchored replacements plus the two pins (pristine hash for
 * the anchor-hash gate; the presence marker for post-asserts/status).
 */
export interface ZctxPatchFileEntry {
  /** asar-relative path of the target bundle file. */
  readonly targetPath: string
  /** SHA-256 of the PRISTINE (unpatched) file content. */
  readonly pristineSha256: string
  /** A string that exists only in the patched state (post-assert + status). */
  readonly presenceMarker: string
  /** Optional shape fingerprint asserted count=1 but never rewritten. */
  readonly fingerprint?: string
  /** Ordered anchored replacements (insert-before/after are embedded anchors). */
  readonly ops: readonly { readonly anchor: string; readonly replacement: string }[]
}

/** Legacy v0.1 single-target anchor-set entry (still accepted via normalizeEntry). */
export interface ZctxPatchAnchorEntry {
  readonly shellPackage: string
  readonly targetPath: string
  readonly targetSha256: string
  readonly anchors: {
    readonly callSite: string
    readonly definition: string
    readonly stubMarker: string
  }
  readonly stub: string
  readonly stubIndent: string
}

/** v0.2 per-version entry: the ordered multi-file patch set. */
export interface ZctxPatchSetEntry {
  readonly shellPackage: string
  readonly files: readonly ZctxPatchFileEntry[]
}

/** Either entry shape (the machinery normalizes legacy to multi). */
export type ZctxPatchEntry = ZctxPatchSetEntry | ZctxPatchAnchorEntry

/** The support matrix keyed by shell (desktop app) version. */
export const SUPPORTED: Record<string, ZctxPatchEntry>

export const PATCHER_VERSION: string
export const PATCH_SET_VERSION: string

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

/** Pure text patch (v0.1 single-op helper): anchor uniqueness + idempotence. */
export function patchText(text: string, entry: ZctxPatchAnchorEntry): PatchTextResult

export function normalizeEntry(entry: ZctxPatchEntry): readonly ZctxPatchFileEntry[]
export function patchFile(text: string, fileEntry: ZctxPatchFileEntry): PatchTextResult
export function reconstructPristineText(text: string, fileEntry: ZctxPatchFileEntry): string | undefined
export function fileStateOf(
  text: string,
  fileEntry: ZctxPatchFileEntry,
): { state: 'pristine' | 'patched-exact' | 'drifted'; sha256: string }

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
    /** Whether the file sits after any target region (its offset shifts). */
    readonly afterTarget: boolean
    /** The exact summed-delta shift applied to this file's offset. */
    readonly shift: number
    readonly size: number
    readonly integrityHash: string
  }[]
}

export interface SpliceMultiResult {
  readonly buffer: Buffer
  readonly targets: readonly {
    readonly targetPath: string
    readonly before: { readonly size: number; readonly sha256: string }
    readonly after: { readonly size: number; readonly sha256: string }
    readonly delta: number
  }[]
  readonly delta: number
  readonly headerSizeBefore: number
  readonly headerSizeAfter: number
  readonly payloadSizeBefore: number
  readonly witnesses: SpliceResult['witnesses']
}

/** Surgical single-file splice (v0.1 shape; wraps spliceAsarMulti). */
export function spliceAsar(args: {
  asarPath: string
  targetPath: string
  entry: ZctxPatchEntry
  patchedText: string
}): SpliceResult

/** Multi-target splice: the WHOLE patch set lands in one asar write. */
export function spliceAsarMulti(args: {
  asarPath: string
  targets: readonly { readonly targetPath: string; readonly patchedText: string }[]
}): SpliceMultiResult

export function resolveAppDir(
  explicit?: string,
): { appDir?: string; source: 'argument' | 'registry' | 'default' | 'none' }

export function probeAppRunningDefault(): 'yes' | 'no' | 'unknown'

export function appRunningGate(args: {
  dshHome?: string
  probeAppRunning?: () => 'yes' | 'no' | 'unknown'
}): { ok: boolean; reason?: string; detail?: string }

export function backupRootFor(appDir: string): string

// -- Electron fuse wire (VERIFY-P #11) ---------------------------------------

export const FUSE_SENTINEL: string
export const FUSE_V1_STATE_COUNT: number
export const FUSE_INTEGRITY_INDEX: number

/**
 * The fuse-wire face of one exe. `states` is the raw 9-char state string
 * (e.g. rc.3's `101100011`); `integrity` is its index-4 byte
 * (EnableEmbeddedAsarIntegrityValidation). Every anomaly (exe missing or
 * unreadable, sentinel absent, wrong version, wire-length overflow, length
 * ≠ 9, illegal state byte) reports `found:false` + `reason` — never a guess.
 */
export interface FuseWireFace {
  readonly found: boolean
  readonly exePath: string
  readonly exeSize?: number
  readonly version?: number
  readonly stateCount?: number
  readonly states?: string
  readonly integrity?: '0' | '1' | 'r'
  readonly rawHex?: string
  readonly sentinelOffset?: number
  readonly sentinelHits?: number
  readonly reason?: string
}

/** The desktop exe carrying the fuse wire (`<appDir>\DeepSeek Harness.exe`). */
export function desktopExePath(appDir: string): string

export function readFuseWire(exePath: string): FuseWireFace

/** Never-throw variant for the read-only surfaces (status/auto). */
export function safeReadFuseWire(exePath: string): FuseWireFace

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
  /** First target's before/after (v0.1 face; the per-file list is `files`). */
  readonly before?: { readonly size: number; readonly sha256: string }
  readonly after?: { readonly size: number; readonly sha256: string }
  readonly files?: readonly { readonly targetPath: string; readonly delta: number }[]
  /** The fuse face when the gate engaged (absent on the exe-less skip arm). */
  readonly fuse?: FuseWireFace
  readonly recovery?: string
}

export async function patchAsar(args: {
  appDir: string
  dshHome?: string
  probeAppRunning?: () => 'yes' | 'no' | 'unknown'
  entry?: ZctxPatchEntry
  versions?: Record<string, ZctxPatchEntry>
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

/** The read-only status face (the JSON `status` prints; runAuto consumes it). */
export interface StatusAsarResult {
  readonly appDir: string
  readonly asarPath: string
  readonly asarExists: boolean
  readonly shellVersion?: string
  readonly anchorHit?: 'official-unchanged' | 'official-drifted' | 'patched-exact' | 'patched-drifted' | 'unknown'
  /**
   * Action guidance for the non-healthy anchor states (P4-r1 P4-3: the state
   * label and the action guidance are separate strings, never merged).
   */
  readonly guidance?: string
  readonly targetSha256?: string
  readonly patched?: boolean | 'unknown'
  /** Per-file face (P6-B): one row per patch-set target. */
  readonly files?: readonly {
    readonly target: string
    readonly sha256: string
    readonly state: 'pristine' | 'patched-exact' | 'drifted'
    readonly anchorHit: 'official-unchanged' | 'official-drifted' | 'patched-exact' | 'patched-drifted'
    readonly guidance?: string
  }[]
  /** The patch-set aggregate (which files patched / pending re-patch). */
  readonly patchSet?: {
    readonly version: string
    readonly totalFiles: number
    readonly patchedFiles: number
    readonly pristineFiles: number
    readonly driftedFiles: number
    readonly state: 'patched' | 'unpatched' | 'partial' | 'drifted'
  }
  readonly marker?: {
    readonly state: 'present' | 'absent' | 'unknown'
    readonly path: string
    readonly version?: string
    readonly patchSet?: string
    readonly patcherVersion?: string
    readonly files?: readonly { readonly target?: string; readonly sha256After?: string }[]
    readonly timestamp?: string
    readonly reason?: string
  }
  readonly backups?: readonly { readonly dir: string }[]
  readonly lock?: { readonly path: string; readonly exists: boolean }
  readonly appRunning?: 'yes' | 'no' | 'unknown'
  /** The Electron fuse face of `<appDir>\DeepSeek Harness.exe` (VERIFY-P #11). */
  readonly fuse?: FuseWireFace
  readonly note?: string
}

export async function statusAsar(args: {
  appDir: string
  dshHome?: string
  probeAppRunning?: () => 'yes' | 'no' | 'unknown'
  versions?: Record<string, ZctxPatchEntry>
  entry?: ZctxPatchEntry
}): Promise<StatusAsarResult>

// -- auto — the hourly self-heal state machine -------------------------------

/** The default auto log file: `%LOCALAPPDATA%\zctx-patch\auto.log` (Z28). */
export function defaultAutoLogPath(): string

/** One contract line: `[ISO8601] [auto] state=<X> detail=<...>`. */
export function autoLogLine(state: string, detail: string): string

export function makeAutoSink(logFile: string): {
  readonly lines: readonly string[]
  write(line: string): void
  error(): string | undefined
}

export interface AutoRunResult {
  readonly ok: boolean
  /** The judgment-table state label (app-running / fuse-on / would-patch / …). */
  readonly state: string
  readonly exitCode: 0 | 1
  readonly detail: string
  readonly lines: readonly string[]
  readonly logFile: string
  readonly sinkError?: string
}

/** Args runAuto forwards to its injected status/patch hooks. */
export interface AutoHookArgs {
  appDir: string
  dshHome?: string
  probeAppRunning?: () => 'yes' | 'no' | 'unknown'
  entry?: ZctxPatchEntry
}

export function runAuto(args: {
  appDir: string
  dshHome?: string
  yes?: boolean
  probeAppRunning?: () => 'yes' | 'no' | 'unknown'
  statusFn?: (args: AutoHookArgs) => Promise<StatusAsarResult>
  patchFn?: (args: AutoHookArgs) => Promise<PatchAsarResult>
  logFile?: string
}): Promise<AutoRunResult>
