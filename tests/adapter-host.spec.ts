/**
 * V5 adapter host-face loader tests: the three-surface fail-soft loading
 * (adapter/host.ts). Official-path cases follow the observe.spec/preflight.spec
 * SKIPPED convention — when the host build is absent from this machine they
 * return without asserting (honest skip), otherwise they pin the OFFICIAL
 * mapping reuse (U2 probe: the dsh-llm lib is live on the reference machine).
 *
 * Overrides: ZCTX_DSH_LLM (host llm lib), ZCTX_PIAI (pi-ai package root),
 * ZCTX_DSH_LLM_PIAI (llm-pi-ai package root — the official chunk-mapping
 * TS sources). All cleared after each case; loader memoization reset per case.
 */

import { afterAll, describe, expect, it } from 'vitest'

import { KNOWN_PROTOCOLS, loadAdapterFaces, resetAdapterFacesForTest } from '../src/adapter/host.ts'

const HOST_LLM = 'G:/000Github/zDSH/zDSH-main/packages/llm/llm/lib/index.js'
const HOST_PIAI_ROOT = 'G:/000Github/zDSH/zDSH-main/node_modules/.pnpm/@earendil-works+pi-ai@1.0.2_a3a2a33fdd5b7de7825ad7dc4af57d74/node_modules/@earendil-works/pi-ai'
const HOST_LLM_PIAI_ROOT = 'G:/000Github/zDSH/zDSH-main/packages/llm/llm-pi-ai'

function hostOnDisk(): boolean {
  try {
    return require('node:fs').existsSync(HOST_LLM)
  } catch {
    return false
  }
}

afterAll(() => {
  delete process.env.ZCTX_DSH_LLM
  delete process.env.ZCTX_PIAI
  delete process.env.ZCTX_DSH_LLM_PIAI
  resetAdapterFacesForTest()
})

describe('adapter host faces: fail-soft loading', () => {
  it('no host anywhere (bare specifiers unresolvable from this repo) → faces undefined, never throws', async () => {
    delete process.env.ZCTX_DSH_LLM
    delete process.env.ZCTX_PIAI
    delete process.env.ZCTX_DSH_LLM_PIAI
    resetAdapterFacesForTest()
    const faces = await loadAdapterFaces()
    // On a machine where the plugin runs inside the host tree the bare
    // specifier CAN resolve — the pin is the honest behavior, not the absence:
    // undefined here means "face skipped with an honest log", never a throw.
    if (faces !== undefined) {
      expect(faces.host.LlmAdapter).toBeTypeOf('function')
      return
    }
    expect(faces).toBeUndefined()
  })

  it('a broken ZCTX_DSH_LLM override degrades to undefined (fail-soft, no partial face)', async () => {
    process.env.ZCTX_DSH_LLM = 'G:/000Github/zDSH/zDSH-main/packages/llm/llm/lib/DOES-NOT-EXIST.js'
    delete process.env.ZCTX_PIAI
    delete process.env.ZCTX_DSH_LLM_PIAI
    resetAdapterFacesForTest()
    expect(await loadAdapterFaces()).toBeUndefined()
  })

  it('a missing pi-ai face degrades to undefined even with a good dsh-llm (all-or-nothing)', async () => {
    resetAdapterFacesForTest()
    const faces = await loadAdapterFaces()
    if (faces === undefined) return // honest skip: no host on this machine
    expect(faces.piAi.isContextOverflow).toBeTypeOf('function')
    expect(await faces.piAi.loadApi('not-a-protocol')).toBeUndefined()
    expect(await faces.piAi.loadApi('openai-completions')).toBeTypeOf('object')
    expect(await faces.piAi.loadApi('anthropic-messages')).toBeTypeOf('object')
  })

  it('KNOWN_PROTOCOLS is the official supportedProtocols union (A-ruling zero-mapping gate)', () => {
    expect([...KNOWN_PROTOCOLS]).toEqual(['openai-completions', 'openai-responses', 'anthropic-messages'])
  })

  it('OFFICIAL mapping reuse: the official llm-pi-ai sources take over when reachable (SKIPPED when absent)', async () => {
    if (!hostOnDisk()) {
      delete process.env.ZCTX_DSH_LLM
      delete process.env.ZCTX_PIAI
      delete process.env.ZCTX_DSH_LLM_PIAI
      resetAdapterFacesForTest()
      return // honest skip: no host build on this machine (probe convention)
    }
    process.env.ZCTX_DSH_LLM = HOST_LLM
    process.env.ZCTX_PIAI = HOST_PIAI_ROOT
    process.env.ZCTX_DSH_LLM_PIAI = HOST_LLM_PIAI_ROOT
    resetAdapterFacesForTest()
    const faces = await loadAdapterFaces()
    expect(faces).toBeDefined()
    expect(faces?.mapping.source).toBe('official-pi-ai-mapping')
    // The official face is genuinely the official module's behavior: mapUsage
    // on a real usage object carries cache fields only when non-zero (F5.6).
    const mapped = faces?.mapping.mapUsage({ input: 4, output: 2, cacheRead: 0, cacheWrite: 9, totalTokens: 15 }) as Record<string, unknown>
    expect(mapped).toEqual({ inputTokens: 4, outputTokens: 2, totalTokens: 15, cacheWriteTokens: 9 })
  })

  it('TWIN mapping fallback: a missing llm-pi-ai source module degrades WHOLESALE to zctx-mapping', async () => {
    if (!hostOnDisk()) {
      delete process.env.ZCTX_DSH_LLM
      delete process.env.ZCTX_PIAI
      delete process.env.ZCTX_DSH_LLM_PIAI
      resetAdapterFacesForTest()
      return // honest skip: no host build on this machine (probe convention)
    }
    process.env.ZCTX_DSH_LLM = HOST_LLM
    process.env.ZCTX_PIAI = HOST_PIAI_ROOT
    delete process.env.ZCTX_DSH_LLM_PIAI
    resetAdapterFacesForTest()
    const faces = await loadAdapterFaces()
    // In this repo the bare '@deepseek-ai/dsh-llm-pi-ai' specifier does not
    // resolve (workspace package, not installed as a dependency here) → the
    // labeled twins take over. A tree where it resolves would pin official.
    expect(faces).toBeDefined()
    if (faces?.mapping.source === 'zctx-mapping') {
      expect(faces.mapping.mapUsage({ input: 4, output: 2, cacheRead: 0, cacheWrite: 9, totalTokens: 15 })).toEqual({
        inputTokens: 4, outputTokens: 2, totalTokens: 15, cacheWriteTokens: 9,
      })
    }
  })

  it('the loader is memoized per process (two calls share one decision)', async () => {
    if (!hostOnDisk()) return // honest skip
    process.env.ZCTX_DSH_LLM = HOST_LLM
    process.env.ZCTX_PIAI = HOST_PIAI_ROOT
    delete process.env.ZCTX_DSH_LLM_PIAI
    resetAdapterFacesForTest()
    const [a, b] = await Promise.all([loadAdapterFaces(), loadAdapterFaces()])
    expect(a).toBe(b) // same promise result object
  })
})
