/**
 * ZCTX-PATCH-AUTO D1/D2 fuse-wire tests — the VERIFY-P #11 authoritative
 * read (three-source cross-attested: rc.3 exe bytes, Electron v44.7.0
 * fuses.json5 schema, @electron/fuses 2.1.3 constants) against SYNTHETIC
 * exe buffers (sentinel at RANDOM offsets with random prefix/suffix — the
 * offset drifts per official build, so the reader must scan, never assume).
 *
 * Asserted here:
 *   - the REAL rc.3 wire sequence `01 09 31 30 31 31 30 30 30 31 31`
 *     (9 states `101100011`) → integrity '0' (off) + exact rawHex;
 *   - integrity '1' / 'r' faces read correctly (index 4 = FuseV1Options
 *     EnableEmbeddedAsarIntegrityValidation);
 *   - every format anomaly refuses fail-closed: sentinel absent, exe
 *     missing, version ≠ 0x01, wire-length overflow, the REFUTED 7-byte
 *     encoding, an illegal state byte;
 *   - patchAsar refuses on integrity '1' / unreadable fuse face, warns
 *     through on 'r', skips honestly on an exe-less (fixture) layout — and
 *     nothing is modified on any refusal;
 *   - statusAsar carries the fuse face read-only (present AND missing exe).
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import * as asar from '@electron/asar'

import {
  FUSE_INTEGRITY_INDEX,
  FUSE_SENTINEL,
  FUSE_V1_STATE_COUNT,
  SUPPORTED,
  desktopExePath,
  patchAsar,
  readFuseWire,
  safeReadFuseWire,
  statusAsar,
} from '../patcher/zctx-patch.mjs'
import type { ZctxPatchFileEntry, ZctxPatchSetEntry } from '../patcher/zctx-patch.d.mts'

/** The REAL rc.3 wire bytes after the sentinel (VERIFY-P #11 [F34] corrected): `01 09 31 30 31 31 30 30 30 31 31` → 11 bytes, hex below. */
const RC3_WIRE_STATES = '101100011'
const RC3_RAW_HEX = '0109313031313030303131'

const asarNative = (path: string): string => path.split('/').join(sep)
const sha256 = (buf: Buffer | string): string => createHash('sha256').update(buf).digest('hex')
const appClosed = () => 'no' as const

// ---------------------------------------------------------------------------
// Synthetic exe builder: sentinel at a RANDOM offset (random prefix/suffix),
// wire = [version][length][state bytes] right after the sentinel.
// ---------------------------------------------------------------------------

function wireBytes(states: string, version = 1, lengthByte?: number): Buffer {
  return Buffer.concat([
    Buffer.from([version, lengthByte ?? states.length]),
    Buffer.from(states, 'latin1'),
  ])
}

/** A fused exe with the sentinel at a random offset and the given wire. */
function fusedExe(states: string, opts: { version?: number; lengthByte?: number } = {}): Buffer {
  const prefix = Buffer.alloc(64 + Math.floor(Math.random() * 4096), 0x41)
  const suffix = Buffer.alloc(Math.floor(Math.random() * 2048), 0x42)
  return Buffer.concat([prefix, Buffer.from(FUSE_SENTINEL, 'latin1'), wireBytes(states, opts.version, opts.lengthByte), suffix])
}

/** An exe WITHOUT the sentinel (sentinel absent → fail-closed). */
function unfusedExe(): Buffer {
  return Buffer.alloc(4096, 0x4d)
}

// ---------------------------------------------------------------------------
// Single-file patch fixture (the patcher.spec.ts shape) + an exe slot.
// ---------------------------------------------------------------------------

const CALL_SITE_LINE = '\t\t\t\t\t...profileOptions(profile, reasoning, apiKey),'

const FIXTURE_LIB = [
  '// fixture lib/index.js — the rc.3 anchor lines embedded verbatim (trimmed)',
  'import { createHash } from "node:crypto";',
  'class PiAdapter {',
  '\tstream(request, options) {',
  '\t\tconst snapshot = this.prepare(request)',
  '\t\t\t\tconst iterator = toStreamChunks(snapshot.models.streamSimple(model, context, {',
  CALL_SITE_LINE,
  '\t\t\t\t\tsignal: watchdog.signal,',
  '\t\t\t\t\theaders: requestHeaders(profile.headers, options, model.baseUrl, this.config.prepareHeaders)',
  '\t\t\t})',
  '\t\t\treturn toStreamChunks(iterator, model.contextWindow, options.signal, model.id, digest)',
  '\t}',
  '}',
  'const Config = z.object({ providers: z.dict(profile).default({}).volatile() });',
  'function apply(ctx, config) {',
  '\tconst adapter = new PiAiAdapter({',
  '\t\tauth,',
  '\t\tprepareHeaders: (request, headers) => ctx.waterfall("llm-pi-ai/request-headers", request, headers, () => headers),',
  '\t});',
  '\treturn adapter;',
  '}',
  'export { Config, PiAiAdapter, apply, inject, name, recordKeyFor, supportedProtocols };',
].join('\n')

const TARGET_PATH = 'dsh/node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/index.js'

interface FuseFixture {
  readonly work: string
  readonly appDir: string
  readonly asarPath: string
  readonly exePath: string
  originalSha: string
  readonly entry: ZctxPatchSetEntry
}

let cleanupDirs: string[] = []

afterEach(() => {
  for (const dir of cleanupDirs) rmSync(dir, { recursive: true, force: true })
  cleanupDirs = []
})

async function createFuseFixture(): Promise<FuseFixture> {
  const work = mkdtempSync(join(tmpdir(), 'zctx-fuse-spec-'))
  cleanupDirs.push(work)
  const src = join(work, 'src')
  mkdirSync(join(src, 'dsh', 'node_modules', '@deepseek-ai', 'dsh-llm-pi-ai', 'lib'), { recursive: true })
  mkdirSync(join(src, 'extra'), { recursive: true })
  writeFileSync(join(src, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-desktop', version: '0.2.2-rc.3' }))
  writeFileSync(join(src, TARGET_PATH), FIXTURE_LIB)
  writeFileSync(join(src, 'extra', 'neighbor.js'), '// neighbor file')
  const appDir = join(work, 'DeepSeek Harness')
  mkdirSync(join(appDir, 'resources'), { recursive: true })
  const asarPath = join(appDir, 'resources', 'app.asar')
  await asar.createPackage(src, asarPath)
  const rc3 = SUPPORTED['0.2.2-rc.3'] as ZctxPatchSetEntry
  return {
    work,
    appDir,
    asarPath,
    exePath: desktopExePath(appDir),
    originalSha: sha256(readFileSync(asarPath)),
    entry: {
      shellPackage: rc3.shellPackage,
      files: [{ ...(rc3.files[0] as ZctxPatchFileEntry), pristineSha256: sha256(FIXTURE_LIB) }],
    },
  }
}

/** Write the exe into the fixture app dir and re-read the asar hash (exe writes never touch the asar). */
function writeExe(fixture: FuseFixture, exe: Buffer): void {
  writeFileSync(fixture.exePath, exe)
}

const findStep = (steps: readonly { name: string; status: string }[], name: string) => {
  const step = steps.find((candidate) => candidate.name === name)
  expect(step, `step "${name}" must exist`).toBeDefined()
  return step as { name: string; status: string; detail?: string }
}

// ---------------------------------------------------------------------------
// readFuseWire — the VERIFY-P #11 authoritative parse.
// ---------------------------------------------------------------------------

describe('readFuseWire: the VERIFY-P #11 authoritative parse', () => {
  it('reads the REAL rc.3 wire (9 states 101100011 → integrity 0) at a RANDOM sentinel offset', () => {
    for (let round = 0; round < 8; round++) {
      const work = mkdtempSync(join(tmpdir(), 'zctx-fuse-exe-'))
      cleanupDirs.push(work)
      const exePath = join(work, 'DeepSeek Harness.exe')
      writeFileSync(exePath, fusedExe(RC3_WIRE_STATES))
      const face = readFuseWire(exePath)
      expect(face.found).toBe(true)
      expect(face.version).toBe(1)
      expect(face.stateCount).toBe(9)
      expect(face.states).toBe('101100011')
      expect(face.integrity).toBe('0')
      expect(face.rawHex).toBe(RC3_RAW_HEX)
      // The sentinel offset is wherever the random prefix put it — and the
      // wire starts exactly after the 34-char sentinel.
      expect(typeof face.sentinelOffset).toBe('number')
      expect(face.sentinelOffset).toBeGreaterThanOrEqual(0)
    }
  })

  it('maps index 4 (EnableEmbeddedAsarIntegrityValidation): ON and REMOVED faces', () => {
    const work = mkdtempSync(join(tmpdir(), 'zctx-fuse-exe-'))
    cleanupDirs.push(work)
    const onPath = join(work, 'on.exe')
    writeFileSync(onPath, fusedExe('101110011'))
    const on = readFuseWire(onPath)
    expect(on.found).toBe(true)
    expect(on.integrity).toBe('1')
    const removedPath = join(work, 'removed.exe')
    writeFileSync(removedPath, fusedExe('1011r0011'))
    const removed = readFuseWire(removedPath)
    expect(removed.found).toBe(true)
    expect(removed.integrity).toBe('r')
    expect(FUSE_INTEGRITY_INDEX).toBe(4)
  })

  it('refuses fail-closed when the sentinel is absent (official re-layout / non-fused exe)', () => {
    const work = mkdtempSync(join(tmpdir(), 'zctx-fuse-exe-'))
    cleanupDirs.push(work)
    const exePath = join(work, 'plain.exe')
    writeFileSync(exePath, unfusedExe())
    const face = readFuseWire(exePath)
    expect(face.found).toBe(false)
    expect(face.reason).toContain('not found')
    expect(safeReadFuseWire(exePath).found).toBe(false)
  })

  it('refuses fail-closed when the exe is missing or unreadable', () => {
    const work = mkdtempSync(join(tmpdir(), 'zctx-fuse-exe-'))
    cleanupDirs.push(work)
    const missing = readFuseWire(join(work, 'absent.exe'))
    expect(missing.found).toBe(false)
    expect(missing.reason).toContain('exe not found')
    // A DIRECTORY at the exe path → readFileSync throws → loud reason, no throw.
    mkdirSync(join(work, 'dir.exe'))
    const unreadable = readFuseWire(join(work, 'dir.exe'))
    expect(unreadable.found).toBe(false)
    expect(unreadable.reason).toContain('exe unreadable')
  })

  it('refuses fail-closed on every bad wire format (version / overflow / 7-byte refuted encoding / illegal byte)', () => {
    const work = mkdtempSync(join(tmpdir(), 'zctx-fuse-exe-'))
    cleanupDirs.push(work)
    const cases: Array<[string, Buffer, string]> = [
      ['version 2', fusedExe('101100011', { version: 2 }), 'version'],
      ['the REFUTED 7-byte encoding', fusedExe('1011000', { lengthByte: 7 }), '!= 9'],
      ['illegal state byte', fusedExe('101120011'), 'illegal state byte'],
    ]
    for (const [label, exe, needle] of cases) {
      const exePath = join(work, `bad-${label.replace(/\W+/g, '-')}.exe`)
      writeFileSync(exePath, exe)
      const face = readFuseWire(exePath)
      expect(face.found, label).toBe(false)
      expect(face.reason ?? '', label).toContain(needle)
    }
    // Length overflow: the length byte claims more bytes than the exe holds
    // (a TINY exe whose wire header sits at the very end).
    const tinyPath = join(work, 'bad-overflow.exe')
    writeFileSync(tinyPath, Buffer.concat([Buffer.alloc(16, 0x41), Buffer.from(FUSE_SENTINEL, 'latin1'), Buffer.from([1, 0xff])]))
    const overflow = readFuseWire(tinyPath)
    expect(overflow.found).toBe(false)
    expect(overflow.reason ?? '').toContain('overruns')
    expect(FUSE_V1_STATE_COUNT).toBe(9)
  })
})

// ---------------------------------------------------------------------------
// The patch gate: fail-closed on ON / unreadable, warn-through on 'r',
// honest skip on exe-less layouts.
// ---------------------------------------------------------------------------

describe('patchAsar fuse integrity gate', () => {
  it('refuses when integrity=ON and modifies NOTHING (no backup, asar byte-identical)', async () => {
    const fixture = await createFuseFixture()
    writeExe(fixture, fusedExe('101110011'))
    const result = await patchAsar({ appDir: fixture.appDir, probeAppRunning: appClosed, entry: fixture.entry })
    expect(result.ok).toBe(false)
    expect(result.refused).toBe(true)
    const gate = findStep(result.steps, 'fuse integrity gate')
    expect(gate.status).toBe('refused')
    expect(gate.detail).toContain('EnableEmbeddedAsarIntegrityValidation=ON')
    expect(result.fuse?.integrity).toBe('1')
    expect(sha256(readFileSync(fixture.asarPath))).toBe(fixture.originalSha)
    expect(existsSync(join(fixture.appDir, '..', 'zctx-backup'))).toBe(false)
  })

  it('refuses when the fuse face is unreadable (sentinel absent) and modifies NOTHING', async () => {
    const fixture = await createFuseFixture()
    writeExe(fixture, unfusedExe())
    const result = await patchAsar({ appDir: fixture.appDir, probeAppRunning: appClosed, entry: fixture.entry })
    expect(result.ok).toBe(false)
    expect(result.refused).toBe(true)
    const gate = findStep(result.steps, 'fuse integrity gate')
    expect(gate.status).toBe('refused')
    expect(gate.detail).toContain('fuse wire unreadable')
    expect(sha256(readFileSync(fixture.asarPath))).toBe(fixture.originalSha)
  })

  it('refuses on a bad wire format (version 2) and modifies NOTHING', async () => {
    const fixture = await createFuseFixture()
    writeExe(fixture, fusedExe(RC3_WIRE_STATES, { version: 2 }))
    const result = await patchAsar({ appDir: fixture.appDir, probeAppRunning: appClosed, entry: fixture.entry })
    expect(result.ok).toBe(false)
    expect(result.refused).toBe(true)
    expect(findStep(result.steps, 'fuse integrity gate').status).toBe('refused')
    expect(sha256(readFileSync(fixture.asarPath))).toBe(fixture.originalSha)
  })

  it('warns through on integrity=r (removed = not enforced) and patches successfully', async () => {
    const fixture = await createFuseFixture()
    writeExe(fixture, fusedExe('1011r0011'))
    const result = await patchAsar({ appDir: fixture.appDir, probeAppRunning: appClosed, entry: fixture.entry })
    expect(result.ok).toBe(true)
    expect(findStep(result.steps, 'fuse integrity gate').status).toBe('warn')
    expect(findStep(result.steps, 'marker').status).toBe('ok')
  })

  it('skips honestly on an exe-less layout (fixture face — no runtime to enforce integrity)', async () => {
    const fixture = await createFuseFixture()
    const result = await patchAsar({ appDir: fixture.appDir, probeAppRunning: appClosed, entry: fixture.entry })
    expect(result.ok).toBe(true)
    const gate = findStep(result.steps, 'fuse integrity gate')
    expect(gate.status).toBe('skip')
    expect(gate.detail).toContain('desktop exe not found')
  })
})

// ---------------------------------------------------------------------------
// statusAsar: the read-only fuse face (present AND missing-exe).
// ---------------------------------------------------------------------------

describe('statusAsar fuse face', () => {
  it('reports the fuse face of the installed exe (read-only, exact wire)', async () => {
    const fixture = await createFuseFixture()
    writeExe(fixture, fusedExe(RC3_WIRE_STATES))
    const report = await statusAsar({ appDir: fixture.appDir, probeAppRunning: appClosed, entry: fixture.entry })
    expect(report.fuse?.found).toBe(true)
    expect(report.fuse?.integrity).toBe('0')
    expect(report.fuse?.states).toBe('101100011')
    expect(report.fuse?.stateCount).toBe(9)
    expect(report.fuse?.rawHex).toBe(RC3_RAW_HEX)
    expect(report.patchSet?.state).toBe('unpatched')
    expect(sha256(readFileSync(fixture.asarPath))).toBe(fixture.originalSha)
  })

  it('reports found:false + reason when the exe is absent (status never throws)', async () => {
    const fixture = await createFuseFixture()
    const report = await statusAsar({ appDir: fixture.appDir, probeAppRunning: appClosed, entry: fixture.entry })
    expect(report.fuse?.found).toBe(false)
    expect(report.fuse?.reason).toContain('exe not found')
    expect(report.patchSet?.state).toBe('unpatched')
  })
})
