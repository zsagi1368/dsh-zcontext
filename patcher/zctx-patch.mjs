#!/usr/bin/env node
/**
 * zctx-patch — the external patcher for the official DSH desktop app.asar
 * (task card P4, v0.2.1; plan §3; RES-install-surface P2 mapping + VERIFY-P
 * 12/12 with the two corrections absorbed).
 *
 * WHAT IT DOES — one-line defensive forwarding stub inserted into the OFFICIAL
 * PiAiAdapter's profileOptions CONSTRUCTION site (the streamSimple options
 * object literal, right after the `...profileOptions(...)` spread and BEFORE
 * the official explicit `headers:`/`signal:` keys — so the stub can never
 * clobber the official header/timeout face):
 *
 *     ...(globalThis.__zctxPatch__?.wireOptions?.({ provider: options.provider, model: model.id, sessionId: options.sessionId }) ?? {}),
 *
 * Zero body rewriting (redline R1): the stub only ADDS options fields. The
 * plugin (when installed + enabled) arms `globalThis.__zctxPatch__.wireOptions`
 * at startup and returns {onPayload, fetch, headers} bound to its per-session
 * wire ledger; plugin absent/disabled → the stub evaluates to `{}` and the
 * official request is byte-identical to stock behavior.
 *
 * WHY THE CALL SITE (not the profileOptions return object): the identity the
 * plugin needs — provider/model/sessionId (card: "身份=provider/model+
 * options.sessionId 可达时") — is only fully in scope at the call site
 * (`options` / `model` locals; rc.3 adapter.ts:475-482, lib call site verified
 * live). The `...profileOptions(profile, reasoning, apiKey),` string is
 * file-unique in rc.3 lib/index.js (count=1, re-verified 2026-11-14 by
 * read-only extraction, SHA-256 e956da3d… matching P2 [F16]/VERIFY-P #8).
 *
 * GATES (every one refuses loudly, never "harden through"):
 *   1. app dir resolution (--app-dir | HKCU registry | documented default)
 *   2. app-not-running gate (process probe + the app's own wx lock file)
 *   3. version gate (asar root package.json version ∈ SUPPORTED)
 *   4. idempotence (stub marker already present → no-op success, no new
 *      backup; marker missing while the stub is live = crash window → the
 *      marker is backfilled from derivable facts, asar untouched)
 *   5. anchor hash gate (target lib/index.js SHA-256 must match the per-version
 *      anchor set — drift = official update = refuse + report, never patch blind)
 *   6. anchor string uniqueness (count must be exactly 1)
 *   7. BACKUP FIRST (sibling `zctx-backup/<ts>/` OUTSIDE the install dir so
 *      the official updater/uninstaller cannot wipe it — RESTORE.md carries
 *      SHA-256s + restore commands; copy hash verified before any modification;
 *      §5 discipline on the user machine)
 *   8. surgical splice: header JSON + payload rebuilt byte-identically EXCEPT
 *      the one target file (all other packed bytes untouched, unpacked-file
 *      flags untouched — no full repack, no unpack-pattern risk)
 *   9. post-verify (fresh re-read: target == expected patched bytes; untouched
 *      witness files match their pristine integrity hashes)
 *  10. marker `<appDir>/.zctx-patch.json` (plugin status reads it: dual source)
 *
 * SUBCOMMANDS: patch / restore / status (restore = copy the backup asar back +
 * remove the marker; status = strictly read-only).
 *
 * v0.2 (P6-B, plan ZCTX-v03-patch-plan + RES-port-feasibility P6-A spec): the
 * anchor set grows from ONE file/one stub to a MULTI-FILE base-context patch
 * set (γ all-inline selection — zero new asar entries, zero export-face
 * changes): the guard-observe wrapper cluster inlines into the llm-pi-ai
 * bundle, the GuardObserver + chain classifier into the agent-loop bundle,
 * the L3 pruning vocabulary into the pruner bundle, and the budget formula
 * into compaction-basic. Every patched bundle stays SELF-CONTAINED (the
 * classifier ships in both consumer bundles) so a hypothetical partial state
 * leaves each bundle individually consistent. The set applies in ONE asar
 * write (multi-target splice) — no partial multi-file state can persist.
 * guardObserve ignition (user ruling "完整功能生效"): the patched llm-pi-ai
 * Config defaults the observe switch to TRUE; the sole kill switch. Observe
 * only — the interception half does not exist in any tree and is not invented.
 *
 * REAL-MACHINE EXECUTION IS OUT OF THIS WAVE (W5-A6-INSTALL umbrella,
 * post-merge): this wave ships the tool + fixture-verified tests only.
 *
 * asar mechanics verified against @electron/asar 4.3.2 sources (lib/pickle.js,
 * lib/disk.js, lib/integrity.js): outer size pickle [u32 4][u32 headerSize],
 * header pickle [u32 payloadSize][u32 jsonLen][json][zero-pad→4],
 * payloadBase = 8 + headerSize, file integrity = SHA256 whole + 4 MiB blocks.
 *
 * @module zctx-patch
 */

import { spawnSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readSync,
  closeSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve, sep } from 'node:path'

/** Patcher version (plan P6 wave table: patcher v0.2.0). */
export const PATCHER_VERSION = '0.2.0'

/**
 * Identity of the base-context patch set data shipped in this file (the P6-A
 * convergence: surgical hunks + γ-inline drop-ins; return-cap and the inert
 * cache-metrics face are registered v0.3 二期 by plan ruling). Bump when the
 * patch-set data changes so markers/status can tell applied sets apart.
 */
export const PATCH_SET_VERSION = 'zctx-v0.3-base-1'

/** The asar-relative path of the shell manifest (version gate source). */
const SHELL_PACKAGE_PATH = 'package.json'

/** The desktop app process name (app-running probe). */
const APP_EXE = 'DeepSeek Harness.exe'

/** Registry uninstall key of the per-user install (P2 [F1], VERIFY-P #7). */
const REGISTRY_KEY =
  'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\1bf39983-50d0-5fe0-9ef4-cece76f67c5e'

/** Documented default install root when the registry is unreadable. */
const DEFAULT_APP_DIR = 'H:\\AiAgent\\DeepSeekHarness'

/** The app's own project lock file (P2 [F30]-[F31]; presence = refuse). */
export function desktopLockPath(dshHome = join(homedir(), '.dsh')) {
  return join(dshHome, 'profiles', 'desktop', 'lock')
}

// ---------------------------------------------------------------------------
// The per-version anchor set (support matrix).
// ---------------------------------------------------------------------------

/**
 * Anchor set per supported shell version. `targetSha256` pins the PRISTINE
 * (unpatched) target file; the anchor strings are file-unique in rc.3
 * lib/index.js (tsc output: tab indent, `void 0`, un-minified — P2 [F20],
 * re-verified live 2026-11-14). An official update changes the hash → the
 * anchor-hash gate refuses → this table gets the new entry first (card:
 * "官方升级后锚漂移=预期路径，patcher 更新锚集再支持").
 */
export const SUPPORTED = {
  '0.2.2-rc.3': {
    shellPackage: '@deepseek-ai/dsh-desktop',
    targetPath: 'dsh/node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/index.js',
    // Pristine lib/index.js SHA-256 (P2 [F16] asar-header double-attested;
    // re-computed live from the real asar 2026-11-14, VERIFY-P #8 anchor).
    targetSha256: 'e956da3d7300e1426e13e14f47e6f981dd1ca345633a406568ee5058ad93e9d8',
    anchors: {
      // The file-unique call-site spread (count=1 verified live).
      callSite: '...profileOptions(profile, reasoning, apiKey),',
      // The file-unique definition line (count=1 verified live) — a shape
      // fingerprint checked alongside the call site, never a rewrite anchor.
      definition: 'function profileOptions(profile, reasoning, apiKey) {',
      // Idempotence/presence marker (the stub itself).
      stubMarker: 'globalThis.__zctxPatch__',
    },
    // The one-line defensive forwarding stub (R1: adds options fields only).
    // Identity = provider/model + options.sessionId — all three locals are in
    // scope at the call site (rc.3 adapter.ts:475-482).
    stub:
      '...(globalThis.__zctxPatch__?.wireOptions?.({ provider: options.provider, model: model.id, sessionId: options.sessionId }) ?? {}),',
    // The call-site spread sits at five-tab depth in lib/index.js.
    stubIndent: '\t\t\t\t\t',
  },
}

// ---------------------------------------------------------------------------
// Small helpers.
// ---------------------------------------------------------------------------

/** sha256 hex of a Buffer. */
function sha256Hex(buf) {
  return createHash('sha256').update(buf).digest('hex')
}

/** Occurrence count of a literal needle. */
function countOccurrences(haystack, needle) {
  return needle === '' ? 0 : haystack.split(needle).length - 1
}

/**
 * @electron/asar 4.3.2's Filesystem.getNode splits lookup paths on
 * `path.sep` (filesystem-native) while asar paths are spelled with '/' —
 * convert before every official extractFile call (verified live: the
 * forward-slash spelling throws "was not found in this archive" on win32).
 */
function nativeAsarPath(asarPath_) {
  return asarPath_.split('/').join(sep)
}

/**
 * File integrity record per @electron/asar 4.3.2 lib/integrity.js
 * (getFileIntegrityFromBuffer): SHA256 whole-file + 4 MiB blocks; empty input
 * still yields one (empty) block.
 */
export function computeIntegrity(buf) {
  const BLOCK_SIZE = 4 * 1024 * 1024
  const hash = createHash('sha256').update(buf).digest('hex')
  const blocks = []
  for (let offset = 0; offset < buf.length; offset += BLOCK_SIZE) {
    const end = Math.min(offset + BLOCK_SIZE, buf.length)
    blocks.push(createHash('sha256').update(buf.subarray(offset, end)).digest('hex'))
  }
  if (buf.length === 0) blocks.push(createHash('sha256').update(buf).digest('hex'))
  return { algorithm: 'SHA256', hash, blockSize: BLOCK_SIZE, blocks }
}

/** @electron/asar loader with honest guidance when the devDep is absent. */
let asarModulePromise
async function loadAsar() {
  asarModulePromise ??= import('@electron/asar').catch((error) => {
    throw new Error(
      `@electron/asar is not resolvable from this location — run inside the dsh-zcontext repo `
        + `after \`pnpm install\` (devDependency), or \`npm i @electron/asar\` first (${error?.message ?? error})`,
    )
  })
  return asarModulePromise
}

/**
 * The header pickle buffer, mirroring @electron/asar lib/pickle.js exactly:
 * payload = [u32 jsonLen][json utf8 bytes][zero-pad to 4]; the buffer carries
 * a 4-byte size field in front of the payload. (Real rc.3 round-trip check:
 * jsonLen 5,669,961 → headerSize 5,669,972 = 4 + 4 + align4 — matches the
 * live asar read.)
 */
function buildHeaderPickle(jsonText) {
  const jsonBuf = Buffer.from(jsonText, 'utf8')
  const aligned = (jsonBuf.length + 3) & ~3
  const payloadSize = 4 + aligned
  const buf = Buffer.alloc(4 + payloadSize)
  buf.writeUInt32LE(payloadSize, 0)
  buf.writeUInt32LE(jsonBuf.length, 4)
  jsonBuf.copy(buf, 8)
  return buf
}

/** The 8-byte outer size pickle: [u32 4][u32 headerPickleLength]. */
function buildSizePickle(headerPickleLength) {
  const buf = Buffer.alloc(8)
  buf.writeUInt32LE(4, 0)
  buf.writeUInt32LE(headerPickleLength, 4)
  return buf
}

/** Walk the header tree to one node; undefined when absent/a directory. */
function headerNodeAt(header, asarPath_) {
  let node = header
  for (const part of asarPath_.split('/')) {
    if (node?.files === undefined) return undefined
    node = node.files[part]
    if (node === undefined) return undefined
  }
  return node.files !== undefined ? undefined : node
}

/** Recursively visit every packed file node with its asar-relative path. */
function visitPackedNodes(node, visit, prefix = '') {
  if (node.files !== undefined) {
    for (const [name, child] of Object.entries(node.files)) {
      visitPackedNodes(child, visit, prefix === '' ? name : `${prefix}/${name}`)
    }
    return
  }
  if (node.offset !== undefined) visit(node, prefix)
}

// ---------------------------------------------------------------------------
// The pure text patch (anchor uniqueness + idempotence + post-assert).
// ---------------------------------------------------------------------------

/**
 * Apply the one-line stub to the target text. Refuses unless the call-site
 * anchor occurs EXACTLY once and the stub marker is absent (already-patched
 * → { ok:false, alreadyPatched:true }); post-asserts exactly one marker.
 */
export function patchText(text, entry) {
  const callCount = countOccurrences(text, entry.anchors.callSite)
  if (callCount !== 1) {
    return { ok: false, reason: `call-site anchor occurs ${callCount} times (must be exactly 1) — refusing` }
  }
  if (countOccurrences(text, entry.anchors.stubMarker) !== 0) {
    return { ok: false, alreadyPatched: true, reason: 'patch stub already present (idempotent no-op)' }
  }
  if (countOccurrences(text, entry.anchors.definition) !== 1) {
    return { ok: false, reason: 'definition anchor (shape fingerprint) not unique — file shape unexpected, refusing' }
  }
  const patched = text.replace(
    entry.anchors.callSite,
    `${entry.anchors.callSite}\n${entry.stubIndent}${entry.stub}`,
  )
  const markerCount = countOccurrences(patched, entry.anchors.stubMarker)
  if (markerCount !== 1) {
    return { ok: false, reason: `post-patch marker count ${markerCount} (must be exactly 1) — refusing` }
  }
  return { ok: true, text: patched, byteLength: Buffer.byteLength(patched, 'utf8') }
}

// ---------------------------------------------------------------------------
// v0.2 multi-file patch-set layer (γ all-inline).
// ---------------------------------------------------------------------------

/**
 * Normalize an anchor-set entry into the v0.2 multi-file shape. A legacy
 * single-target entry (P4 v0.1 shape: targetPath/targetSha256/anchors/stub/
 * stubIndent) becomes a one-file entry whose single op is the stub insert —
 * so v0.1 entries (and the v0.1 fixture tests) keep flowing through the
 * v0.2 machinery unchanged.
 */
export function normalizeEntry(entry) {
  if (Array.isArray(entry?.files)) return entry.files
  return [
    {
      targetPath: entry.targetPath,
      pristineSha256: entry.targetSha256,
      presenceMarker: entry.anchors.stubMarker,
      ...(entry.anchors.definition !== undefined ? { fingerprint: entry.anchors.definition } : {}),
      ops: [
        {
          anchor: entry.anchors.callSite,
          replacement: `${entry.anchors.callSite}\n${entry.stubIndent}${entry.stub}`,
        },
      ],
    },
  ]
}

/**
 * Apply an ordered op list to one file's text. Every op is {anchor,
 * replacement}: the anchor must occur EXACTLY once and is replaced wholesale
 * (insert-after/insert-before are expressed as replacements that embed the
 * anchor). Any anchor count ≠ 1 refuses — never patch blind. This runs only
 * on files the gate chain proved PRISTINE, so per-op idempotence is not
 * needed here (the file-level reconstruction gate owns that).
 */
export function patchFile(text, fileEntry) {
  let patched = text
  for (let index = 0; index < fileEntry.ops.length; index++) {
    const op = fileEntry.ops[index]
    const count = countOccurrences(patched, op.anchor)
    if (count !== 1) {
      return {
        ok: false,
        reason: `op ${index} anchor occurs ${count} times (must be exactly 1) — refusing`,
      }
    }
    // Function-form replacement: no `$`-pattern substitution semantics.
    patched = patched.replace(op.anchor, () => op.replacement)
  }
  if (countOccurrences(patched, fileEntry.presenceMarker) === 0) {
    return { ok: false, reason: 'post-patch presence marker absent — patch text incomplete, refusing' }
  }
  return { ok: true, text: patched, byteLength: Buffer.byteLength(patched, 'utf8') }
}

/**
 * Reconstruct the pristine text from a patched text by reversing every op in
 * REVERSE order (replace op.replacement → op.anchor, each exactly once).
 * Returns undefined when any reversal is unprovable — the caller then reports
 * drifted (P4-r1 P4-3 reconstruction proof, generalized to op lists).
 */
export function reconstructPristineText(text, fileEntry) {
  let current = text
  for (let index = fileEntry.ops.length - 1; index >= 0; index--) {
    const op = fileEntry.ops[index]
    if (countOccurrences(current, op.replacement) !== 1) return undefined
    current = current.replace(op.replacement, () => op.anchor)
  }
  return current
}

/**
 * Three-state discrimination of ONE target file (the gate's unit):
 *   'pristine'     — bytes match the pinned pristine hash
 *   'patched-exact' — reversing every op reconstructs the pinned pristine
 *                     hash (marker-independent exactness proof)
 *   'drifted'      — anything else (official update or foreign modification)
 */
export function fileStateOf(text, fileEntry) {
  const sha = sha256Hex(Buffer.from(text, 'utf8'))
  if (sha === fileEntry.pristineSha256) return { state: 'pristine', sha256: sha }
  const reconstructed = reconstructPristineText(text, fileEntry)
  if (reconstructed !== undefined && sha256Hex(Buffer.from(reconstructed, 'utf8')) === fileEntry.pristineSha256) {
    return { state: 'patched-exact', sha256: sha }
  }
  return { state: 'drifted', sha256: sha }
}

// ---------------------------------------------------------------------------
// Positional asar reads (cache-free; the splice must never see stale caches).
// ---------------------------------------------------------------------------

/** Read the header (JSON + size) via positioned reads. @internal */
function readHeaderPositioned(asarPath) {
  const fd = openSync(asarPath, 'r')
  try {
    const sizeBuf = Buffer.alloc(8)
    if (readSync(fd, sizeBuf, 0, 8, 0) !== 8) throw new Error(`unable to read the asar header size: ${asarPath}`)
    const headerSize = sizeBuf.readUInt32LE(4)
    if (8 + headerSize > statSync(asarPath).size) {
      throw new Error(`asar header size ${headerSize} exceeds archive size — corrupted archive`)
    }
    const headerPickle = Buffer.alloc(headerSize)
    readSync(fd, headerPickle, 0, headerSize, 8)
    const jsonLen = headerPickle.readUInt32LE(4)
    const jsonText = headerPickle.toString('utf8', 8, 8 + jsonLen)
    return { header: JSON.parse(jsonText), headerSize }
  } finally {
    closeSync(fd)
  }
}

/** Positional single-file extraction through the local header reader. @internal */
function extractPositioned(asarPath, asarPath_) {
  const { header, headerSize } = readHeaderPositioned(asarPath)
  const node = headerNodeAt(header, asarPath_)
  if (node === undefined) throw new Error(`not found in asar: ${asarPath_}`)
  if (node.files !== undefined) throw new Error(`is a directory in asar: ${asarPath_}`)
  if (node.unpacked === true || node.offset === undefined) {
    throw new Error(`file is unpacked outside this asar: ${asarPath_}`)
  }
  const fd = openSync(asarPath, 'r')
  try {
    const buf = Buffer.alloc(node.size)
    const start = 8 + headerSize + Number(node.offset)
    if (readSync(fd, buf, 0, node.size, start) !== node.size) {
      throw new Error(`short read for ${asarPath_} (${node.size} B at ${start})`)
    }
    return buf
  } finally {
    closeSync(fd)
  }
}

// ---------------------------------------------------------------------------
// The surgical asar splice.
// ---------------------------------------------------------------------------

/**
 * Splice ONE patched target file into the archive (v0.1 shape kept for the
 * v0.1 fixture tests): a thin single-target wrapper over
 * {@link spliceAsarMulti}.
 */
export function spliceAsar({ asarPath, targetPath, entry, patchedText }) {
  const result = spliceAsarMulti({ asarPath, targets: [{ targetPath, patchedText }] })
  return {
    buffer: result.buffer,
    before: result.targets[0].before,
    after: result.targets[0].after,
    delta: result.targets[0].delta,
    headerSizeBefore: result.headerSizeBefore,
    headerSizeAfter: result.headerSizeAfter,
    payloadSizeBefore: result.payloadSizeBefore,
    witnesses: result.witnesses,
  }
}

/**
 * Splice SEVERAL patched target files into the archive in ONE operation (the
 * v0.2 multi-file patch set applies as a single asar write — no partial
 * multi-file state can persist past a crash): header JSON mutated in place
 * (each target gets new size + integrity; every non-target offset shifts by
 * the SUM of the deltas of the target regions positioned before it), payload
 * rebuilt around the sorted target regions — every other packed byte
 * IDENTICAL, unpacked-file flags untouched. Returns the complete new archive
 * buffer plus per-target accounting + pristine witnesses for the post-verify.
 */
export function spliceAsarMulti({ asarPath, targets }) {
  const { header, headerSize } = readHeaderPositioned(asarPath)
  const resolved = targets.map(({ targetPath, patchedText }) => {
    const node = headerNodeAt(header, targetPath)
    if (node === undefined) {
      throw new Error(`target file not present in the asar header: ${targetPath}`)
    }
    if (node.unpacked === true || node.offset === undefined) {
      throw new Error(`target file is unpacked (not stored inside this asar) — unsupported: ${targetPath}`)
    }
    return {
      targetPath,
      node,
      start: Number(node.offset),
      oldSize: node.size,
      newBuf: Buffer.from(patchedText, 'utf8'),
    }
  })
  // Overlapping targets are a spec error, not a splice case.
  const starts = resolved.map((target) => target.start).sort((a, b) => a - b)
  for (let index = 1; index < starts.length; index++) {
    if (starts[index] === starts[index - 1]) throw new Error('duplicate target offset in the patch set — refusing')
  }

  // Pristine witnesses BEFORE the header mutation: the first packed file in
  // header order and the first packed file positioned after ALL targets —
  // their bytes must be untouched (pristine integrity hash) after the splice.
  // No target is ever its own witness.
  //
  // Layout premise made explicit (P4-r1 P4-1): a file's header offset shifts
  // by the summed deltas of the target regions BEFORE it; `afterTarget` is
  // recorded from the collection-time offset, so the post-verify expectation
  // never depends on the archive layout.
  const targetStarts = new Set(resolved.map((target) => target.start))
  const lastTargetEnd = Math.max(...resolved.map((target) => target.start + target.oldSize))
  const shiftFor = (offset) =>
    resolved.reduce((sum, target) => (offset > target.start ? sum + (target.newBuf.length - target.oldSize) : sum), 0)
  const witnesses = []
  visitPackedNodes(header, (node, path) => {
    if (witnesses.length >= 2 || node.integrity === undefined) return
    const offset = Number(node.offset)
    if (targetStarts.has(offset)) return
    if (witnesses.length === 0 || offset >= lastTargetEnd) {
      witnesses.push({
        path,
        oldOffset: offset,
        afterTarget: shiftFor(offset) !== 0,
        shift: shiftFor(offset),
        size: node.size,
        integrityHash: node.integrity.hash,
      })
    }
  })

  // Header mutation: reset each target's size + integrity; shift every other
  // packed file's offset by the summed deltas of the targets before it.
  visitPackedNodes(header, (node) => {
    const offset = Number(node.offset)
    const target = resolved.find((candidate) => candidate.start === offset)
    if (target !== undefined) {
      target.before = { size: target.oldSize, sha256: sha256Hex(wholeFor(asarPath, payloadBaseOf(headerSize), target.start, target.oldSize)) }
      target.after = { size: target.newBuf.length, sha256: sha256Hex(target.newBuf) }
      node.size = target.newBuf.length
      node.integrity = computeIntegrity(target.newBuf)
    } else if (shiftFor(offset) !== 0) {
      node.offset = String(offset + shiftFor(offset))
    }
  })

  // Payload splice around the sorted target regions (one whole-file read).
  const whole = readFileSync(asarPath)
  const payloadBase = 8 + headerSize
  const sorted = [...resolved].sort((a, b) => a.start - b.start)
  const pieces = []
  let cursor = 0
  for (const target of sorted) {
    pieces.push(whole.subarray(payloadBase + cursor, payloadBase + target.start))
    pieces.push(target.newBuf)
    cursor = target.start + target.oldSize
  }
  pieces.push(whole.subarray(payloadBase + cursor))

  const headerPickle = buildHeaderPickle(JSON.stringify(header))
  const buffer = Buffer.concat([buildSizePickle(headerPickle.length), headerPickle, Buffer.concat(pieces)])
  return {
    buffer,
    targets: resolved.map(({ targetPath, before, after, newBuf, oldSize }) => ({
      targetPath,
      before,
      after,
      delta: newBuf.length - oldSize,
    })),
    delta: resolved.reduce((sum, target) => sum + (target.newBuf.length - target.oldSize), 0),
    headerSizeBefore: headerSize,
    headerSizeAfter: headerPickle.length,
    payloadSizeBefore: whole.length - payloadBase,
    witnesses,
  }
}

/** @internal payload base offset of an archive with the given header size. */
function payloadBaseOf(headerSize) {
  return 8 + headerSize
}

/** @internal positional read of one file region (used for target before-hashes). */
function wholeFor(asarPath, payloadBase, start, size) {
  const fd = openSync(asarPath, 'r')
  try {
    const buf = Buffer.alloc(size)
    if (readSync(fd, buf, 0, size, payloadBase + start) !== size) {
      throw new Error(`short read for the target region (${size} B at ${payloadBase + start})`)
    }
    return buf
  } finally {
    closeSync(fd)
  }
}

// ---------------------------------------------------------------------------
// App-dir resolution + running-app gate.
// ---------------------------------------------------------------------------

/** Resolve the app dir: --app-dir wins, then the registry, then the default. */
export function resolveAppDir(explicit) {
  if (explicit !== undefined && explicit !== '') {
    return { appDir: resolve(explicit), source: 'argument' }
  }
  if (process.platform === 'win32') {
    const probed = spawnSync('reg', ['query', REGISTRY_KEY, '/v', 'InstallLocation'], { encoding: 'utf8' })
    if (probed.status === 0 && typeof probed.stdout === 'string') {
      const match = /InstallLocation\s+REG_SZ\s+(.+)/.exec(probed.stdout)
      const dir = match?.[1]?.trim()
      if (dir !== undefined && dir !== '' && existsSync(join(dir, 'resources', 'app.asar'))) {
        return { appDir: dir, source: 'registry' }
      }
    }
  }
  if (existsSync(join(DEFAULT_APP_DIR, 'resources', 'app.asar'))) {
    return { appDir: DEFAULT_APP_DIR, source: 'default' }
  }
  return { appDir: undefined, source: 'none' }
}

/**
 * Is the desktop app running? Default probe = tasklist on win32 (best-effort
 * — an unavailable probe reports 'unknown'; the lock file stays the honest
 * hard signal). Injectable for tests.
 */
export function probeAppRunningDefault() {
  if (process.platform !== 'win32') return 'unknown'
  try {
    const probed = spawnSync('tasklist', ['/FI', `IMAGENAME eq ${APP_EXE}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8' })
    return `${probed.stdout ?? ''}`.includes(APP_EXE) ? 'yes' : 'no'
  } catch {
    return 'unknown'
  }
}

/**
 * The app-running gate for patch/restore: refuses when the process probe says
 * yes OR the app's own lock file exists (its wx-lock discipline, P2 [F30]).
 * A stale lock is the app's business — the patcher never deletes it; the user
 * closes the app (or removes the stale lock) themselves.
 */
export function appRunningGate({ dshHome, probeAppRunning = probeAppRunningDefault }) {
  const running = probeAppRunning()
  if (running === 'yes') {
    return {
      ok: false,
      reason: `${APP_EXE} is running — close the app, then re-run (the patch applies only to a closed install)`,
    }
  }
  const lockPath = desktopLockPath(dshHome)
  if (existsSync(lockPath)) {
    return {
      ok: false,
      reason: `the app's project lock exists (${lockPath}) — close the app (or remove a stale lock yourself), then re-run`,
    }
  }
  return { ok: true, detail: `app running: ${running}; lock file: absent` }
}

// ---------------------------------------------------------------------------
// Backup (§5 discipline on the user machine).
// ---------------------------------------------------------------------------

/**
 * Backup root = SIBLING of the app dir (OUTSIDE the install dir: the official
 * updater/uninstaller replaces the install dir wholesale, so a backup inside
 * it would be destroyed by exactly the event that kills the patch — P2
 * [F23]/[F29]).
 */
export function backupRootFor(appDir) {
  return join(dirname(appDir), 'zctx-backup')
}

function timestampId() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

function nextBackupDir(root) {
  const base = timestampId()
  let dir = join(root, base)
  let n = 2
  while (existsSync(dir)) {
    dir = join(root, `${base}-${n}`)
    n += 1
  }
  return dir
}

/**
 * Backup the current asar (+ marker when present) into a fresh sibling backup
 * dir; the copy is hash-verified against the source BEFORE the caller touches
 * anything. RESTORE.md carries the hashes + the restore commands.
 */
function createBackup({ appDir, asarPath, markerPath }) {
  const dir = nextBackupDir(backupRootFor(appDir))
  mkdirSync(dir, { recursive: true })
  const backupAsar = join(dir, 'app.asar')
  copyFileSync(asarPath, backupAsar)
  const sourceSha = sha256Hex(readFileSync(asarPath))
  const copiedSha = sha256Hex(readFileSync(backupAsar))
  if (sourceSha !== copiedSha) {
    throw new Error(`backup verification FAILED (${copiedSha} != ${sourceSha}) — refusing to modify the original`)
  }
  let markerBackupPath
  if (existsSync(markerPath)) {
    markerBackupPath = join(dir, 'marker.zctx-patch.json')
    copyFileSync(markerPath, markerBackupPath)
  }
  const entries = [
    `${sourceSha} *${asarPath}`,
    ...(markerBackupPath !== undefined ? [`${sha256Hex(readFileSync(markerPath))} *${markerPath}`] : []),
  ]
  writeFileSync(
    join(dir, 'RESTORE.md'),
    [
      '# RESTORE — zctx-backup (pre-patch snapshot)',
      '',
      `- Created: ${new Date().toISOString()} by zctx-patch ${PATCHER_VERSION}`,
      `- App dir: ${appDir}`,
      `- Backed up: ${asarPath} (SHA-256 below)${markerBackupPath !== undefined ? ' + the existing patch marker' : ''}`,
      '- Restore with the patcher (preferred):',
      `    node patcher/zctx-patch.mjs restore --app-dir "${appDir}" --backup "${dir}"`,
      '- Restore manually (from this directory):',
      `    copy /Y "${backupAsar}" "${asarPath}"`,
      `    (remove the marker when present: del "${markerPath}")`,
      '- Verify after restore: the installed asar SHA-256 must equal the first hash below.',
      '',
      '```',
      ...entries,
      '```',
      '',
    ].join('\n'),
  )
  return { dir, asarSha256: sourceSha, markerBackedUp: markerBackupPath !== undefined }
}

// ---------------------------------------------------------------------------
// patch / restore / status.
// ---------------------------------------------------------------------------

/** Paths of one install. @internal */
function installPaths(appDir) {
  return {
    asarPath: join(appDir, 'resources', 'app.asar'),
    markerPath: join(appDir, '.zctx-patch.json'),
  }
}

/**
 * Marker write (temp + rename, atomic on the same volume). Returns the
 * outcome instead of throwing: a failed marker write must surface as a
 * FAILED step + ok:false — never an uncaught throw past the splice, and
 * never ok:true without the marker in place (the plugin's zctx_status reads
 * this file as the filesystem truth; P4-r1 P4-2).
 * @internal
 */
function writeMarker(markerPath, payload) {
  const tmp = `${markerPath}.tmp-${process.pid}`
  try {
    writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`)
    renameSync(tmp, markerPath)
    return { ok: true }
  } catch (error) {
    rmSync(tmp, { force: true })
    return { ok: false, reason: `marker write failed: ${error instanceof Error ? error.message : String(error)}` }
  }
}

/**
 * PATCH — full gate chain + backup + splice + post-verify + marker.
 * Nothing is touched before every gate passes and the backup verifies.
 *
 * @param options.appDir          resolved app dir (required)
 * @param options.dshHome         the app's dsh home for the lock gate
 *                                (default ~/.dsh)
 * @param options.probeAppRunning injectable process probe (tests)
 * @param options.entry           injectable anchor-set entry (fixture tests);
 *                                default = versions[shellVersion]
 * @param options.versions        injectable anchor-set map (default SUPPORTED)
 */
export async function patchAsar(options) {
  const {
    appDir,
    dshHome = undefined,
    probeAppRunning = probeAppRunningDefault,
    entry = undefined,
    versions = SUPPORTED,
  } = options
  const { asarPath, markerPath } = installPaths(appDir)
  const report = { appDir, asarPath, steps: [] }
  const step = (name, status, detail) => {
    report.steps.push({ name, status, ...(detail !== undefined ? { detail } : {}) })
    return status
  }

  if (!existsSync(asarPath)) {
    throw new Error(`app.asar not found at ${asarPath} — wrong app dir?`)
  }

  // Gate: app not running.
  const gate = appRunningGate({ dshHome, probeAppRunning })
  step('app-running gate', gate.ok ? 'ok' : 'refused', gate.reason ?? gate.detail)
  if (!gate.ok) return { ok: false, refused: true, ...report }

  const asar = await loadAsar()
  // Their module caches Filesystems per archive path — after any in-place
  // mutation of the SAME path the cache would serve a stale header. All
  // pre-state reads below go through the cache-free positional readers; the
  // official extract API is used for the post-verify (after uncacheAll) to
  // prove the patched archive is readable by the official toolchain.
  asar.uncacheAll()

  // Gate: version (asar root package.json).
  let shellVersion
  let supportedEntry
  try {
    const shell = JSON.parse(extractPositioned(asarPath, SHELL_PACKAGE_PATH).toString('utf8'))
    shellVersion = typeof shell?.version === 'string' ? shell.version : undefined
    supportedEntry = entry ?? (shellVersion !== undefined ? versions[shellVersion] : undefined)
  } catch (error) {
    step('version gate', 'refused', `root package.json unreadable: ${error instanceof Error ? error.message : String(error)}`)
    return { ok: false, refused: true, ...report }
  }
  if (shellVersion === undefined || supportedEntry === undefined) {
    step('version gate', 'refused', `shell version ${shellVersion ?? 'unreadable'} is not in the supported set {${Object.keys(versions).join(', ')}}`)
    return { ok: false, refused: true, ...report, shellVersion }
  }
  step('version gate', 'ok', `${shellVersion}`)

  // Pre-state per file (cache-free positional reads): pristine, patched-exact,
  // or drifted. The whole set must be uniformly pristine (→ patch) or
  // uniformly patched-exact (→ idempotent no-op); anything else refuses — a
  // mixed face cannot arise from this patcher (the set applies in ONE asar
  // write) and reports honestly instead of guessing.
  const files = normalizeEntry(supportedEntry)
  const fileTexts = []
  for (const file of files) {
    let text
    try {
      text = extractPositioned(asarPath, file.targetPath).toString('utf8')
    } catch (error) {
      step('target read', 'refused', `${file.targetPath}: ${error instanceof Error ? error.message : String(error)}`)
      return { ok: false, refused: true, ...report, shellVersion }
    }
    const state = fileStateOf(text, file)
    fileTexts.push({ file, text, ...state })
  }
  const drifted = fileTexts.filter((entry) => entry.state === 'drifted')
  if (drifted.length > 0) {
    const detail = drifted
      .map((entry) => `${entry.file.targetPath}: SHA-256 ${entry.sha256} is neither the pinned pristine hash nor a reconstructable patched state (anchor drift)`)
      .join(' | ')
    step('anchor hash gate', 'refused', `${detail} — official update or foreign modification; update the patcher anchor set first`)
    return {
      ok: false,
      refused: true,
      ...report,
      shellVersion,
      targetSha256: drifted[0].sha256,
      files: fileTexts.map(({ file, state, sha256 }) => ({ target: file.targetPath, state, sha256 })),
    }
  }
  const pristineFiles = fileTexts.filter((entry) => entry.state === 'pristine')
  if (pristineFiles.length < fileTexts.length) {
    // All patched-exact (the only remaining case): idempotence branch.
    step('idempotence', 'skip', `patch set ${PATCH_SET_VERSION} already applied (${fileTexts.length}/${fileTexts.length} files patched-exact) — the asar stays untouched`)
    if (existsSync(markerPath)) {
      return { ok: true, alreadyPatched: true, ...report, shellVersion }
    }
    // Crash-window self-heal (P4-r1 P4-2, v0.2 set shape): the patched files
    // are live but the marker is missing. The re-run is the only write path
    // that can reconcile, so backfill the marker from derivable facts; the
    // asar stays untouched. Derivation: each file's pristine content was its
    // pinned hash (the patcher writes only past the anchor-hash gate) and the
    // after-hash is the patched file as it stands now.
    const backfill = writeMarker(markerPath, {
      patcher: 'zctx-patch',
      patcherVersion: PATCHER_VERSION,
      patchSet: PATCH_SET_VERSION,
      shellVersion,
      target: fileTexts[0].file.targetPath,
      sha256Before: fileTexts[0].file.pristineSha256,
      sha256After: fileTexts[0].sha256,
      files: fileTexts.map((entry) => ({
        target: entry.file.targetPath,
        sha256Before: entry.file.pristineSha256,
        sha256After: entry.sha256,
      })),
      // The crashed run's own backup dir is not recoverable from the archive;
      // the latest sibling backup is the best-known pointer (restore defaults
      // to the latest dir when --backup is omitted anyway).
      backup: latestBackupDir(backupRootFor(appDir)) ?? null,
      timestamp: new Date().toISOString(),
    })
    step(
      'marker',
      backfill.ok ? 'backfilled' : 'FAILED',
      backfill.ok
        ? `${markerPath} was missing (crash window between the splice rename and the marker write) — backfilled; the asar stays untouched`
        : backfill.reason,
    )
    if (!backfill.ok) {
      report.recovery = `the patch IS live but the marker could not be written (${markerPath}) — fix the marker path and re-run patch (idempotent, backfills the marker), or restore with: node patcher/zctx-patch.mjs restore --app-dir "${appDir}"`
      return { ok: false, ...report, shellVersion }
    }
    return { ok: true, alreadyPatched: true, markerBackfilled: true, ...report, shellVersion }
  }

  // Gate: anchor hash — every file matched its pinned pristine hash.
  step('anchor hash gate', 'ok', `${fileTexts.length}/${fileTexts.length} files match the pinned pristine hashes`)

  // Pure text patches (op-list application; anchor uniqueness asserts inside).
  const patchedFiles = []
  let addedBytes = 0
  for (const entry of fileTexts) {
    const patched = patchFile(entry.text, entry.file)
    if (!patched.ok) {
      step('anchor patch', 'refused', `${entry.file.targetPath}: ${patched.reason}`)
      return { ok: false, refused: true, ...report, shellVersion }
    }
    addedBytes += patched.byteLength - Buffer.byteLength(entry.text, 'utf8')
    patchedFiles.push({ targetPath: entry.file.targetPath, patchedText: patched.text, before: entry.sha256, after: sha256Hex(Buffer.from(patched.text, 'utf8')) })
  }
  step('anchor patch', 'ok', `${patchedFiles.length} files patched, +${addedBytes} B total`)

  // Backup FIRST (§5): copy + hash-verify before any modification.
  let backup
  try {
    backup = createBackup({ appDir, asarPath, markerPath })
  } catch (error) {
    step('backup', 'refused', error instanceof Error ? error.message : String(error))
    return { ok: false, refused: true, ...report, shellVersion }
  }
  step('backup', 'ok', `${backup.dir} (sha ${backup.asarSha256}${backup.markerBackedUp ? ', marker included' : ''})`)
  report.backup = backup

  // Multi-target surgical splice + atomic write (temp in the same dir →
  // rename): ONE operation for the whole set.
  let spliced
  try {
    spliced = spliceAsarMulti({ asarPath, targets: patchedFiles })
  } catch (error) {
    step('splice', 'refused', error instanceof Error ? error.message : String(error))
    return { ok: false, ...report, shellVersion }
  }
  const tmpAsar = `${asarPath}.zctx-tmp-${process.pid}`
  writeFileSync(tmpAsar, spliced.buffer)
  renameSync(tmpAsar, asarPath)
  step('splice', 'ok', `${spliced.targets.length} targets, payload delta ${spliced.delta} B total, header ${spliced.headerSizeBefore} → ${spliced.headerSizeAfter} B`)

  // Post-verify on the WRITTEN archive: the official extract API (cache
  // dropped first) proves the patched archive is readable by the official
  // toolchain; cache-free positional reads check the untouched witnesses and
  // the size accounting.
  asar.uncacheAll()
  const verify = verifySplicedArchive(asar, asarPath, patchedFiles, spliced)
  step('post-verify', verify.ok ? 'ok' : 'FAILED', verify.detail)
  if (!verify.ok) {
    // The backup exists; surface the restore command honestly. The tool does
    // NOT auto-restore (auto-repairs on the user machine need explicit eyes).
    report.recovery = `restore with: node patcher/zctx-patch.mjs restore --app-dir "${appDir}" --backup "${backup.dir}"`
    return { ok: false, ...report, shellVersion, verify }
  }

  // Marker (the plugin's status dual-source filesystem truth), v0.2 set
  // shape: per-file before/after hashes under `files`, the first file also
  // mirrored to the v0.1 top-level fields for reader compatibility. A failure
  // here leaves the patch live with no marker — the crash window the
  // idempotence branch self-heals on the next patch run — so it surfaces as
  // ok:false + recovery, never ok:true without the marker (P4-r1 P4-2).
  const markerWrite = writeMarker(markerPath, {
    patcher: 'zctx-patch',
    patcherVersion: PATCHER_VERSION,
    patchSet: PATCH_SET_VERSION,
    shellVersion,
    target: spliced.targets[0].targetPath,
    sha256Before: spliced.targets[0].before.sha256,
    sha256After: spliced.targets[0].after.sha256,
    files: spliced.targets.map((target) => ({
      target: target.targetPath,
      sha256Before: target.before.sha256,
      sha256After: target.after.sha256,
    })),
    backup: backup.dir,
    timestamp: new Date().toISOString(),
  })
  step('marker', markerWrite.ok ? 'ok' : 'FAILED', markerWrite.ok ? markerPath : markerWrite.reason)
  if (!markerWrite.ok) {
    report.recovery = `the patch IS applied but the marker write failed (${markerPath}) — re-run patch (idempotent, backfills the marker), or restore with: node patcher/zctx-patch.mjs restore --app-dir "${appDir}" --backup "${backup.dir}"`
    return { ok: false, ...report, shellVersion, before: spliced.targets[0].before, after: spliced.targets[0].after, files: spliced.targets }
  }

  return { ok: true, ...report, shellVersion, before: spliced.targets[0].before, after: spliced.targets[0].after, files: spliced.targets }
}

/**
 * Post-verify the spliced archive on disk (multi-target). @internal
 */
function verifySplicedArchive(asar, asarPath, patchedFiles, spliced) {
  // 1. Every target's content == its expected patched text, read through the
  // OFFICIAL extract API (a header the official toolchain cannot parse would
  // fail right here); each file's presence marker occurs at least once.
  for (const target of patchedFiles) {
    const actualTarget = asar.extractFile(asarPath, nativeAsarPath(target.targetPath)).toString('utf8')
    if (actualTarget !== target.patchedText) {
      return { ok: false, detail: `patched target content mismatch after write: ${target.targetPath}` }
    }
  }
  // 2. Witnesses: bytes at the shifted positions match the pristine hashes.
  // The expected offset uses the collection-time `shift` (the same summed
  // delta rule as the header mutation; `afterTarget` remains the readable
  // boolean for the v0.1 single-target shape where shift == delta or 0 —
  // P4-r1 P4-1: never a layout assumption).
  for (const witness of spliced.witnesses) {
    const newOffset = witness.oldOffset + witness.shift
    const { header, headerSize } = readHeaderPositioned(asarPath)
    const node = headerNodeAt(header, witness.path)
    if (node === undefined || Number(node.offset) !== newOffset) {
      return { ok: false, detail: `witness ${witness.path}: header offset ${String(node?.offset)} != expected ${String(newOffset)}` }
    }
    const fd = openSync(asarPath, 'r')
    try {
      const buf = Buffer.alloc(witness.size)
      readSync(fd, buf, 0, witness.size, 8 + headerSize + newOffset)
      if (sha256Hex(buf) !== witness.integrityHash) {
        return { ok: false, detail: `untouched file ${witness.path} no longer matches its pristine integrity hash` }
      }
    } finally {
      closeSync(fd)
    }
  }
  // 3. Size accounting: archive = 8 + headerSizeAfter + (payloadBefore + delta).
  const archiveSize = statSync(asarPath).size
  const expected = 8 + spliced.headerSizeAfter + spliced.payloadSizeBefore + spliced.delta
  if (archiveSize !== expected) {
    return { ok: false, detail: `archive size ${archiveSize} != accounted ${expected}` }
  }
  return {
    ok: true,
    detail: `${spliced.targets.length} targets patched (+${spliced.delta} B total), witnesses ${spliced.witnesses.length}/${spliced.witnesses.length} byte-identical, archive ${archiveSize} B`,
  }
}

/**
 * RESTORE — copy a backup asar back (hash-verified against the backup's
 * recorded hash), remove the marker. --backup picks a specific backup dir;
 * otherwise the LATEST backup under the sibling root wins.
 */
export async function restoreAsar(options) {
  const { appDir, dshHome = undefined, probeAppRunning = probeAppRunningDefault, backup = undefined } = options
  const { asarPath, markerPath } = installPaths(appDir)
  const report = { appDir, asarPath, steps: [] }
  const step = (name, status, detail) => {
    report.steps.push({ name, status, ...(detail !== undefined ? { detail } : {}) })
    return status
  }

  if (!existsSync(asarPath)) {
    throw new Error(`app.asar not found at ${asarPath} — wrong app dir?`)
  }

  const gate = appRunningGate({ dshHome, probeAppRunning })
  step('app-running gate', gate.ok ? 'ok' : 'refused', gate.reason ?? gate.detail)
  if (!gate.ok) return { ok: false, refused: true, ...report }

  // Backup selection.
  const root = backupRootFor(appDir)
  const dir = backup !== undefined ? resolve(backup) : latestBackupDir(root)
  if (dir === undefined || !existsSync(join(dir, 'app.asar'))) {
    step('backup selection', 'refused', `no backup asar found${backup !== undefined ? ` at ${dir}` : ` under ${root}`}`)
    return { ok: false, refused: true, ...report }
  }
  step('backup selection', 'ok', dir)

  // Backup integrity: the recorded RESTORE.md hash (first hash line) must
  // match the backup bytes — a corrupted backup must not silently restore.
  const backupAsar = join(dir, 'app.asar')
  const recorded = readRestoreHash(dir)
  const actualSha = sha256Hex(readFileSync(backupAsar))
  if (recorded !== undefined && recorded !== actualSha) {
    step('backup integrity', 'refused', `backup asar SHA-256 ${actualSha} != recorded ${recorded} — backup corrupted, not restoring from it`)
    return { ok: false, refused: true, ...report }
  }
  step('backup integrity', 'ok', actualSha)

  // Atomic restore + verification (Z24: restore replaces the current state,
  // then diff-verifies by hash).
  const tmpAsar = `${asarPath}.zctx-tmp-${process.pid}`
  copyFileSync(backupAsar, tmpAsar)
  const tmpSha = sha256Hex(readFileSync(tmpAsar))
  if (tmpSha !== actualSha) {
    rmSync(tmpAsar, { force: true })
    step('restore write', 'FAILED', 'temp copy hash mismatch — aborted before touching the installed asar')
    return { ok: false, ...report }
  }
  renameSync(tmpAsar, asarPath)
  const installedSha = sha256Hex(readFileSync(asarPath))
  if (installedSha !== actualSha) {
    step('restore verify', 'FAILED', `installed asar ${installedSha} != backup ${actualSha}`)
    report.recovery = `re-run restore from ${dir}`
    return { ok: false, ...report }
  }
  step('restore verify', 'ok', `installed asar == backup (${installedSha})`)

  // Marker removal (the patch is gone; the marker must not claim presence).
  if (existsSync(markerPath)) {
    rmSync(markerPath, { force: true })
    step('marker removal', 'ok', markerPath)
  } else {
    step('marker removal', 'skip', 'marker already absent')
  }
  return { ok: true, ...report, backupDir: dir }
}

/** The newest backup dir (lexicographic ts order) under the backup root. @internal */
function latestBackupDir(root) {
  if (!existsSync(root)) return undefined
  const dirs = readdirSync(root).filter((name) => existsSync(join(root, name, 'app.asar'))).sort()
  return dirs.length === 0 ? undefined : join(root, dirs[dirs.length - 1])
}

/** First recorded hash in a backup's RESTORE.md. @internal */
function readRestoreHash(dir) {
  try {
    const text = readFileSync(join(dir, 'RESTORE.md'), 'utf8')
    return /^[0-9a-f]{64} \*/m.exec(text)?.[0]?.slice(0, 64)
  } catch {
    return undefined
  }
}

/**
 * STATUS — strictly read-only. No gates, no writes; reports version, the
 * three-state anchor discrimination (state wording + separate action
 * guidance), patch presence (stub count), marker, backups, and the lock face.
 *
 * anchorHit states (P4-r1 P4-3; mapping from the old two labels):
 *   'official-unchanged' — stub absent, hash == pinned pristine
 *                          (was 'match (pristine)')
 *   'official-drifted'   — stub absent, hash != pinned pristine: official
 *                          update moved the file (was 'mismatch (drift)' —
 *                          correct semantics there, renamed for coherence)
 *   'patched-exact'      — stub present, file byte-identical to
 *                          patchText(pristine).text (the old label here was
 *                          'mismatch (drift)' — the P4-3 bug: the EXPECTED
 *                          post-patch state read as an error)
 *   'patched-drifted'    — stub present but the file no longer matches the
 *                          expected patched content (patched, then modified)
 */
export async function statusAsar(options) {
  const {
    appDir,
    dshHome = undefined,
    probeAppRunning = probeAppRunningDefault,
    versions = SUPPORTED,
    entry = undefined,
  } = options
  const { asarPath, markerPath } = installPaths(appDir)
  const report = { appDir, asarPath, asarExists: existsSync(asarPath) }
  if (!report.asarExists) {
    return { ...report, note: 'app.asar not found — nothing to report' }
  }
  try {
    report.shellVersion = JSON.parse(extractPositioned(asarPath, SHELL_PACKAGE_PATH).toString('utf8'))?.version
  } catch (error) {
    report.shellVersion = `unreadable (${error instanceof Error ? error.message : String(error)})`
  }
  const supportedEntry = entry ?? (typeof report.shellVersion === 'string' ? versions[report.shellVersion] : undefined)
  if (supportedEntry === undefined) {
    report.anchorHit = 'unknown'
    report.patched = 'unknown'
    report.note = `shell version ${String(report.shellVersion)} has no anchor entry — presence checks need the matching anchor set`
  } else {
    const files = normalizeEntry(supportedEntry)
    report.files = []
    try {
      for (const file of files) {
        const target = extractPositioned(asarPath, file.targetPath)
        const text = target.toString('utf8')
        const sha = sha256Hex(target)
        const state = fileStateOf(text, file)
        // State wording (P4-r1 P4-3 carried to the multi-file face): the
        // label names the STATE only; action guidance lives in `guidance`.
        const anchorHit = state.state === 'pristine'
          ? 'official-unchanged'
          : state.state === 'patched-exact'
            ? 'patched-exact'
            : countOccurrences(text, file.presenceMarker) > 0
              ? 'patched-drifted'
              : 'official-drifted'
        report.files.push({
          target: file.targetPath,
          sha256: sha,
          state: state.state,
          anchorHit,
          ...(anchorHit === 'patched-drifted'
            ? { guidance: 'the patched target no longer matches the expected patched content — restore from a backup, then re-patch' }
            : {}),
          ...(anchorHit === 'official-drifted'
            ? { guidance: 'official update changed the target beyond the pinned anchor set — refresh the patcher anchor set first, then patch' }
            : {}),
        })
      }
      // Top-level fields mirror the FIRST file (the v0.1 single-target face;
      // the v0.2 aggregate lives in `patchSet`/`files`).
      report.targetSha256 = report.files[0].sha256
      report.anchorHit = report.files[0].anchorHit
      if (report.anchorHit === 'patched-drifted' || report.anchorHit === 'official-drifted') {
        report.guidance = report.files[0].guidance
      }
      // Presence semantics (carried from v0.1): `patched` says the patch face
      // is present in the bytes — exact OR drifted-with-marker — not that
      // every file is pristine-exact; the aggregate precision lives in
      // `patchSet.state`.
      report.patched = report.files.some((file) => file.anchorHit === 'patched-exact' || file.anchorHit === 'patched-drifted')
      // The patch-set aggregate (P6-B status segment): which files are in and
      // which are pending the official update re-patch.
      report.patchSet = {
        version: PATCH_SET_VERSION,
        totalFiles: report.files.length,
        patchedFiles: report.files.filter((file) => file.anchorHit === 'patched-exact').length,
        pristineFiles: report.files.filter((file) => file.anchorHit === 'official-unchanged').length,
        driftedFiles: report.files.filter((file) => file.anchorHit === 'patched-drifted' || file.anchorHit === 'official-drifted').length,
        state: report.patched
          ? 'patched'
          : report.files.every((file) => file.anchorHit === 'official-unchanged')
            ? 'unpatched'
            : report.files.some((file) => file.anchorHit === 'patched-exact')
              ? 'partial'
              : 'drifted',
      }
    } catch (error) {
      report.anchorHit = 'unknown'
      report.patched = 'unknown'
      report.note = `target read failed: ${error instanceof Error ? error.message : String(error)}`
    }
  }
  report.marker = readMarkerFile(markerPath)
  const root = backupRootFor(appDir)
  report.backups = existsSync(root)
    ? readdirSync(root)
      .filter((name) => existsSync(join(root, name, 'app.asar')))
      .sort()
      .map((name) => ({ dir: join(root, name) }))
    : []
  const lockPath = desktopLockPath(dshHome)
  report.lock = { path: lockPath, exists: existsSync(lockPath) }
  report.appRunning = probeAppRunning()
  return report
}

/** Read the patch marker (the plugin reads the same file the same way). @internal */
function readMarkerFile(markerPath) {
  if (!existsSync(markerPath)) return { state: 'absent', path: markerPath }
  try {
    const parsed = JSON.parse(readFileSync(markerPath, 'utf8'))
    return {
      state: 'present',
      path: markerPath,
      version: typeof parsed.shellVersion === 'string' ? parsed.shellVersion : undefined,
      target: typeof parsed.target === 'string' ? parsed.target : undefined,
      patchSet: typeof parsed.patchSet === 'string' ? parsed.patchSet : undefined,
      patcherVersion: typeof parsed.patcherVersion === 'string' ? parsed.patcherVersion : undefined,
      files: Array.isArray(parsed.files)
        ? parsed.files.map((file) => ({
          target: typeof file?.target === 'string' ? file.target : undefined,
          sha256After: typeof file?.sha256After === 'string' ? file.sha256After : undefined,
        }))
        : undefined,
      timestamp: typeof parsed.timestamp === 'string' ? parsed.timestamp : undefined,
    }
  } catch (error) {
    return { state: 'unknown', path: markerPath, reason: error instanceof Error ? error.message : String(error) }
  }
}

// ---------------------------------------------------------------------------
// CLI.
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { _: [] }
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (token === '--app-dir' || token === '--dsh-home' || token === '--backup') {
      const value = argv[i + 1]
      if (value === undefined) throw new Error(`${token} requires a value`)
      args[token.slice(2).replaceAll('-', '_')] = value
      i += 1
    } else if (token.startsWith('--')) {
      throw new Error(`unknown option ${token}`)
    } else {
      args._.push(token)
    }
  }
  return args
}

function printSteps(prefix, steps) {
  for (const { name, status, detail } of steps) {
    console.log(`${prefix} ${name}: ${status}${detail !== undefined ? ` — ${detail}` : ''}`)
  }
}

async function main(argv) {
  const args = parseArgs(argv)
  const command = args._[0]
  if (command !== 'patch' && command !== 'restore' && command !== 'status') {
    console.error('usage: node patcher/zctx-patch.mjs <patch|restore|status> [--app-dir <dir>] [--dsh-home <dir>] [--backup <dir>]')
    return 2
  }
  const resolved = resolveAppDir(args.app_dir)
  if (resolved.appDir === undefined) {
    console.error(`[refuse] could not resolve the app dir (no --app-dir, registry unreadable, default ${DEFAULT_APP_DIR} absent)`)
    return 1
  }
  console.log(`[app] ${resolved.appDir} (source: ${resolved.source})`)
  const dshHome = args.dsh_home ?? join(homedir(), '.dsh')
  try {
    if (command === 'patch') {
      const result = await patchAsar({ appDir: resolved.appDir, dshHome })
      printSteps('[gate]', result.steps)
      if (result.ok && result.alreadyPatched) {
        console.log('[skip] already patched — nothing to do (idempotent)')
        return 0
      }
      if (result.ok) {
        console.log(`[done] patched: target ${result.after?.size} B (sha ${result.after?.sha256}); marker written; backup at ${result.backup?.dir}`)
        console.log('[note] restart the desktop app to load the patched adapter; the patch survives until the next official update (re-run the patch after updates)')
        return 0
      }
      console.error(`[refuse] patch not applied${result.recovery !== undefined ? ` — recovery: ${result.recovery}` : ''}`)
      return 1
    }
    if (command === 'restore') {
      const result = await restoreAsar({ appDir: resolved.appDir, dshHome, backup: args.backup })
      printSteps('[gate]', result.steps)
      if (result.ok) {
        console.log(`[done] restored from ${result.backupDir}; marker cleared`)
        return 0
      }
      console.error(`[refuse] restore not applied${result.recovery !== undefined ? ` — recovery: ${result.recovery}` : ''}`)
      return 1
    }
    console.log(JSON.stringify(await statusAsar({ appDir: resolved.appDir, dshHome }), null, 2))
    return 0
  } catch (error) {
    console.error(`[error] ${error instanceof Error ? error.message : String(error)}`)
    return 1
  }
}

/** CLI entry guard (imported by tests → no side effects). */
if (process.argv[1] !== undefined && basename(process.argv[1]) === 'zctx-patch.mjs') {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code
  })
}
