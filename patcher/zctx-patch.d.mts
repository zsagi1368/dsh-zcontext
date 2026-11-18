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
  /** Data anchor-set dir (default patcher/anchors/ next to the script). */
  anchorsDir?: string
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
  /** Where this version's anchor entry resolved from (D5). */
  readonly anchorSetSource?: 'data' | 'in-code' | 'none' | 'error' | 'argument'
  /** Inventory of available anchor sets: the in-code map + the data dir. */
  readonly availableAnchorSets?: {
    readonly dir: string
    readonly inCode: readonly string[]
    readonly dataDir: readonly string[]
  }
  readonly note?: string
}

export async function statusAsar(args: {
  appDir: string
  dshHome?: string
  probeAppRunning?: () => 'yes' | 'no' | 'unknown'
  versions?: Record<string, ZctxPatchEntry>
  entry?: ZctxPatchEntry
  /** Data anchor-set dir (default patcher/anchors/ next to the script). */
  anchorsDir?: string
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
  /** D8c: enable the official feed face (proactive preadapt). Module default OFF; the CLI turns it ON. */
  feedFace?: boolean
  checkOfficialFn?: (args: { appDir: string; logFile?: string; quiet?: boolean }) => Promise<CheckOfficialResult>
  preadaptFn?: (args: { appDir: string; yes: boolean; accept: boolean; logFile?: string; anchorsDir?: string }) => Promise<PreadaptResult>
  anchorsDir?: string
}): Promise<AutoRunResult>

// -- install-task / uninstall-task — the Windows scheduled task --------------

export const TASK_NAME: string

/** The absolute path of THIS script (fileURLToPath of import.meta.url). */
export function thisScriptPath(): string

/**
 * `cmd /c ""<node>" "<script>" auto --yes >> "<log>" 2>&1"` — every path
 * quoted, plus the outer pair cmd.exe's /C rule 2 consumes (spaced paths).
 */
export function buildTaskAction(args: {
  nodePath?: string
  scriptPath: string
  logPath: string
}): string

export interface TaskStep {
  readonly name: string
  readonly status: string
  readonly detail?: string
}

export interface TaskResult {
  readonly ok: boolean
  readonly refused?: boolean
  readonly taskName: string
  readonly action?: string
  readonly steps: readonly TaskStep[]
  readonly recovery?: string
}

export function installScheduledTask(args?: {
  nodePath?: string
  scriptPath?: string
  logFile?: string
  taskName?: string
  platform?: NodeJS.Platform
  run?: (args: readonly string[]) => { status: number | null; stdout?: string; stderr?: string }
}): TaskResult

export function uninstallScheduledTask(args?: {
  taskName?: string
  platform?: NodeJS.Platform
  run?: (args: readonly string[]) => { status: number | null; stdout?: string; stderr?: string }
}): TaskResult

// -- External anchor sets (patcher/anchors/<version>.json, D5) ---------------

export function defaultAnchorsDir(): string

/** The five probe target paths of the patch set of record. */
export function knownTargetPaths(versions?: Record<string, ZctxPatchEntry>): string[]

/** `<version>.json` basenames (version keys) available in the data dir, sorted. */
export function listAnchorSetVersions(anchorsDir?: string): string[]

export interface AnchorSetValidation {
  readonly ok: boolean
  readonly reason?: string
  readonly entry?: { readonly shellPackage: string; readonly files: readonly ZctxPatchFileEntry[] }
}

/**
 * Per-field schema check (metadata fields, shellPackage, exactly the five
 * known targets each once, 64-hex hashes, non-empty presence markers, op
 * lists with unique non-empty anchors). Every violation is a loud refusal.
 */
export function validateAnchorSetData(data: unknown, knownPaths?: string[]): AnchorSetValidation

export interface AnchorSetLoad {
  /** True when no data file exists for the version (clean fallthrough). */
  readonly absent?: boolean
  readonly ok: boolean
  readonly entry?: ZctxPatchSetEntry
  readonly path?: string
  readonly meta?: {
    readonly anchorSetVersion: string
    readonly generatedAt: string
    readonly sourceReport: string
  }
  readonly reason?: string
}

/**
 * Load `<anchorsDir>/<version>.json`: absent → fallthrough; exists but
 * corrupt/invalid → ok:false + reason (the caller refuses, NO fallback to
 * the in-code map); valid → ok:true with the validated entry.
 */
export function loadAnchorSetData(version: string, anchorsDir?: string, knownPaths?: string[]): AnchorSetLoad

export interface AnchorSetResolution {
  readonly entry?: ZctxPatchEntry
  readonly source: 'data' | 'in-code' | 'none' | 'error'
  readonly reason?: string
  readonly path?: string
  readonly meta?: AnchorSetLoad['meta']
}

/** Data file first, in-code map second; 'error' = refuse (fail-closed). */
export function resolveAnchorEntry(
  shellVersion: string | undefined,
  args?: { versions?: Record<string, ZctxPatchEntry>; anchorsDir?: string; knownPaths?: string[] },
): AnchorSetResolution

// -- reanchor (D6) -----------------------------------------------------------

export interface ReanchorStep {
  readonly name: string
  readonly status: string
  readonly detail?: string
}

export interface ReanchorOpFace {
  readonly anchor: string
  readonly expected: number
  readonly actual: number
  readonly locatedBy?: 'anchor' | 'first-line' | 'prefix-60' | 'none'
  readonly line?: number
  readonly context?: string
  readonly note?: string
}

export interface ReanchorClassificationRow {
  readonly target: string
  readonly oldPristineSha256: string
  readonly newSha256: string
  readonly class: 'ALIVE' | 'DRIFTED'
  readonly ops: readonly ReanchorOpFace[]
}

export interface ReanchorResult {
  readonly ok: boolean
  readonly refused?: boolean
  readonly accepted?: boolean
  readonly appDir: string
  readonly newVersion?: string
  readonly candidateJson?: string
  readonly writtenTo?: string
  readonly writtenSha256?: string
  readonly classification?: readonly ReanchorClassificationRow[]
  readonly driftedMaterials?: readonly ReanchorClassificationRow[]
  readonly recovery?: string
  readonly steps: readonly ReanchorStep[]
}

/**
 * Build a candidate anchor set for a NEW official build: read-only
 * extraction + per-op classification (ALIVE/DRIFTED/patched-refuse);
 * candidate only when 5/5 ALIVE; --accept is the only path into
 * patcher/anchors/.
 */
export function reanchorAnchorSet(args: {
  appDir: string
  anchorsDir?: string
  out?: string
  accept?: boolean
  versions?: Record<string, ZctxPatchEntry>
}): ReanchorResult

// -- check-official (D8a) ----------------------------------------------------

/** One pipeline contract line: `[ISO8601] [<tag>] state=<X> detail=<...>`. */
export function pipelineLogLine(tag: string, state: string, detail: string): string

/** Minimal YAML-subset parser for the two electron-updater manifests (loud on any foreign shape). */
export function parseUpdateYaml(text: string): {
  ok: boolean
  reason?: string
  doc?: Record<string, unknown> & { files?: readonly (Record<string, unknown> & { url?: string; size?: number; sha512?: string })[] }
}

/** electron-updater isStagingMatch replica (DR1-5; confidence medium-high, [U1] reserved). */
export function machineStagingPercentage(updaterId: string): { ok: boolean; percentage?: number; reason?: string }

/** `deepseek-harness-<version>-win-x64.exe` → version; undefined otherwise. */
export function installerVersionFromFileName(fileName: string | undefined): string | undefined

/** Prerelease-aware compare for the 0.2.2[-rc.N] shape (incomparable = raw-string fallback). */
export function compareVersions(a: string, b: string): { order: -1 | 0 | 1; comparable: boolean }

export interface CheckOfficialResult {
  readonly ok: boolean
  readonly state: string
  readonly exitCode: 0 | 1
  readonly detail: string
  readonly logFile: string
  readonly lines?: readonly string[]
  readonly sinkError?: string
  readonly updateState?: 'up-to-date' | 'pending'
  readonly comparable?: boolean
  readonly feedVersion?: string
  readonly installedVersion?: string
  readonly feedSha512?: string
  readonly feedSize?: number
  readonly feedUrl?: string
  readonly installerUrl?: string
  readonly channel?: string
  readonly releaseDate?: string
  readonly stagingPercentage?: number | null
  readonly machinePercentage?: number
  readonly stagedIn?: boolean
  readonly updaterIdPath?: string
  readonly pendingInstaller?: {
    readonly path: string
    readonly fileName?: string
    readonly version?: string
    readonly sha512?: string
  }
  readonly appDir?: string
}

/**
 * Read the official update feed and compare against the local install. ONE
 * outbound GET (the channel yml); NEVER downloads the installer; every
 * anomaly refuses loudly.
 */
export function checkOfficial(args?: {
  appDir?: string
  logFile?: string
  quiet?: boolean
  fetchImpl?: typeof fetch
  updaterIdPath?: string
  localAppData?: string
}): Promise<CheckOfficialResult>

// -- preadapt (D8b) ----------------------------------------------------------

/** Default work root: %LOCALAPPDATA%\zctx-patch\preadapt\. */
export function defaultPreadaptWorkRoot(): string

export function locateSevenZip(args?: {
  explicitPath?: string
  platform?: NodeJS.Platform
  standardPaths?: readonly string[]
  whereImpl?: (name: string) => string | undefined
}): {
  ok: boolean
  path?: string
  source?: 'explicit' | 'standard-install' | 'path-lookup'
  volatile?: boolean
  reason?: string
  guidance?: string
}

export interface PreadaptResult {
  readonly ok: boolean
  readonly state: string
  readonly exitCode: 0 | 1
  readonly detail: string
  readonly logFile: string
  readonly lines?: readonly string[]
  readonly sinkError?: string
  readonly check?: CheckOfficialResult
  readonly candidate?: ZctxPatchSetEntry
  readonly writtenTo?: string
  readonly writtenSha256?: string
}

/**
 * Pre-adaptation pipeline for the PENDING official build: sha512-verified
 * download → 7z double extraction → fuse pre-check (integrity must be '0')
 * → reanchor on the extracted tree → simulated FULL patch + status 5/5 →
 * --accept lands the candidate. The real install is never touched.
 */
export function preadaptAnchorSet(args?: {
  appDir?: string
  yes?: boolean
  accept?: boolean
  keepWorkdir?: boolean
  anchorsDir?: string
  workRoot?: string
  logFile?: string
  quiet?: boolean
  probeAppRunning?: () => 'yes' | 'no' | 'unknown'
  sevenZipPath?: string
  locate7zImpl?: typeof locateSevenZip
  run7zImpl?: (args: { installerPath: string; workDir: string; sevenZip: { path: string } }) => Promise<{ appTree: string }>
  downloadImpl?: (url: string, destPath: string, expectedSize?: number | null) => Promise<void>
  checkOfficialImpl?: () => Promise<CheckOfficialResult>
}): Promise<PreadaptResult>
