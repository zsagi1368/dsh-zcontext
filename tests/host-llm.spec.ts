/**
 * V2 probe tests for the optional host projection face (task card V2 product
 * 1: "探针单测：两路径行为").
 *
 * Path A (always runs): the LOCAL FALLBACK twins — deterministic structural
 * reductions, every snapshot they feed must be labeled
 * `projector: 'local-fallback'`.
 *
 * Path B (runs when the host build is on disk): the OFFICIAL exports loaded
 * through ZCTX_DSH_LLM — exact WeakSet identity for isAgentLoopRequest and
 * the official handle-text forms for the projections. When the host build is
 * absent the group skips HONESTLY (explicit skip, never a silent pass —
 * scripts/probe-host-imports.mjs discipline).
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { afterAll, describe, expect, it } from 'vitest'

import { loadHostProjector, resetHostProjectorCacheForTest } from '../src/host-llm.ts'
import type { RequestMessageLike } from '../src/host-llm.ts'

/** Default host build target (same convention as scripts/probe-host-imports.mjs). */
const HOST_LIB =
  process.env.ZCTX_DSH_LLM ?? 'G:/000Github/zDSH/zDSH-main/packages/llm/llm/lib/index.js'
const HOST_LIB_URL = HOST_LIB.startsWith('file:') ? HOST_LIB : pathToFileURL(path.resolve(HOST_LIB)).href
const HOST_AVAILABLE = existsSync(new URL(HOST_LIB_URL).pathname.replace(/^\/([A-Za-z]:)/, '$1'))

afterAll(() => {
  delete process.env.ZCTX_DSH_LLM
  resetHostProjectorCacheForTest()
})

const noopResolve = () => undefined

describe('host projection face: local-fallback path (host absent)', () => {
  it('labels the fallback projector and never throws when the host specifier is unresolvable', async () => {
    delete process.env.ZCTX_DSH_LLM
    resetHostProjectorCacheForTest()
    const projector = await loadHostProjector()
    expect(projector.projector).toBe('local-fallback')
  })

  it('isAgentLoopRequest fallback: structural heuristic over sessionId+messages', async () => {
    delete process.env.ZCTX_DSH_LLM
    resetHostProjectorCacheForTest()
    const projector = await loadHostProjector()
    expect(projector.isAgentLoopRequest({ sessionId: 's1', messages: [{ role: 'user' }] })).toBe(true)
    expect(projector.isAgentLoopRequest({ messages: [{ role: 'user' }] })).toBe(false) // no sessionId
    expect(projector.isAgentLoopRequest({ sessionId: 's1' })).toBe(false) // no messages
    expect(projector.isAgentLoopRequest({ sessionId: 5, messages: [] })).toBe(false) // non-string id
    expect(projector.isAgentLoopRequest(null)).toBe(false)
    expect(projector.isAgentLoopRequest('request')).toBe(false)
  })

  it('projectFilesToText fallback: deterministic handle text, original reference when file-less', async () => {
    delete process.env.ZCTX_DSH_LLM
    resetHostProjectorCacheForTest()
    const projector = await loadHostProjector()
    const ref = { attachmentId: 'sha256:abcdef1234567890', name: 'report.sql', bytes: 4200 }
    const messages: RequestMessageLike[] = [
      { role: 'user', content: [{ type: 'text', text: 'plain' }] },
      { role: 'user', content: [{ type: 'file', attachment: ref }] },
    ]
    const projected = projector.projectFilesToText(messages, noopResolve)
    expect(projected).not.toBe(messages) // copies when a file block exists
    const block = (projected[1]?.content as RequestMessageLike[])[0] as RequestMessageLike
    expect(block.type).toBe('text')
    const text = block.text as string
    expect(text).toContain('zctx-fallback file')
    expect(text).toContain('report.sql')
    expect(text).toContain('4200 bytes')
    // Determinism: identical input → identical output text.
    const again = projector.projectFilesToText(messages, noopResolve)
    expect((again[1]?.content as RequestMessageLike[])[0]).toEqual(block)
    // No files → the ORIGINAL array reference (official contract).
    const fileless: RequestMessageLike[] = [{ role: 'user', content: [{ type: 'text', text: 'plain' }] }]
    expect(projector.projectFilesToText(fileless, noopResolve)).toBe(fileless)
    // String content passes through untouched.
    const stringy: RequestMessageLike[] = [{ role: 'user', content: 'raw' }]
    expect(projector.projectFilesToText(stringy, noopResolve)).toBe(stringy)
  })

  it('projectImagesForTextModel fallback: deterministic placeholder, original reference when image-less', async () => {
    delete process.env.ZCTX_DSH_LLM
    resetHostProjectorCacheForTest()
    const projector = await loadHostProjector()
    const messages: RequestMessageLike[] = [
      { role: 'user', content: [{ type: 'image', attachment: { attachmentId: 'sha256:1111222233334444', bytes: 99 } }] },
    ]
    const projected = projector.projectImagesForTextModel(messages)
    const block = (projected[0]?.content as RequestMessageLike[])[0] as RequestMessageLike
    expect(block.type).toBe('text')
    expect(block.text).toContain('zctx-fallback image')
    expect(block.text).toContain('1111222233334444')
    const again = projector.projectImagesForTextModel(messages)
    expect((again[0]?.content as RequestMessageLike[])[0]).toEqual(block)
    const imageless: RequestMessageLike[] = [{ role: 'user', content: [{ type: 'text', text: 'x' }] }]
    expect(projector.projectImagesForTextModel(imageless)).toBe(imageless)
  })

  it('projectToolUpdates fallback: developer messages and deferLoading strip on unsupported routes', async () => {
    delete process.env.ZCTX_DSH_LLM
    resetHostProjectorCacheForTest()
    const projector = await loadHostProjector()
    const messages: RequestMessageLike[] = [
      { role: 'developer', content: [{ type: 'tool-addition', toolName: 't' }] },
      { role: 'user', content: [{ type: 'text', text: 'u' }] },
    ]
    const tools = [{ name: 'a', description: 'a', parameters: {}, deferLoading: true }]
    const projected = projector.projectToolUpdates(messages, tools, undefined)
    expect(projected.messages.map((m) => m.role)).toEqual(['user'])
    expect(projected.tools?.[0]).toEqual({ name: 'a', description: 'a', parameters: {} })
    // With a known capability the fallback passes messages through.
    const keep = projector.projectToolUpdates(messages, tools, 'in-history')
    expect(keep.messages).toBe(messages)
    expect(keep.tools).toBe(tools)
  })
})

describe.skipIf(!HOST_AVAILABLE)(
  'host projection face: official path (host build on disk)',
  () => {
    it('labels the official projector and uses exact host semantics', async () => {
      process.env.ZCTX_DSH_LLM = HOST_LIB_URL
      resetHostProjectorCacheForTest()
      const projector = await loadHostProjector()
      expect(projector.projector).toBe('official')

      // Exact WeakSet identity: unmarked objects are rejected even when they
      // look like loop requests (the fallback heuristic would accept them).
      expect(projector.isAgentLoopRequest({ sessionId: 's1', messages: [] })).toBe(false)
      const host = (await import(HOST_LIB_URL)) as {
        markAgentLoopRequest: <T>(request: T) => T
      }
      const marked = host.markAgentLoopRequest({ sessionId: 's1', messages: [] } as never)
      expect(projector.isAgentLoopRequest(marked)).toBe(true)
    }, 20000)

    it('projections produce the official handle-text forms', async () => {
      process.env.ZCTX_DSH_LLM = HOST_LIB_URL
      resetHostProjectorCacheForTest()
      const projector = await loadHostProjector()

      // Official file handle text: identity + verbatim-copy address (or the
      // no-access variant when the resolver yields undefined).
      const ref = { attachmentId: 'sha256:abcdef1234567890', name: 'report.sql', bytes: 4200 }
      const messages: RequestMessageLike[] = [
        { role: 'user', content: [{ type: 'file', attachment: ref }] },
      ]
      const withAccess = projector.projectFilesToText(messages, () => '/tmp/ro/report.sql')
      const text = ((withAccess[0]?.content as RequestMessageLike[])[0] as RequestMessageLike).text as string
      expect(text).toContain('File "report.sql" (4200 bytes, sha256:abcdef12)')
      expect(text).toContain('/tmp/ro/report.sql')
      const withoutAccess = projector.projectFilesToText(messages, noopResolve)
      const noAccessText = ((withoutAccess[0]?.content as RequestMessageLike[])[0] as RequestMessageLike)
        .text as string
      expect(noAccessText).toContain('cannot access a readable path')

      // Official image placeholder for text-only serialization.
      const imageMessages: RequestMessageLike[] = [
        { role: 'user', content: [{ type: 'image', attachment: { attachmentId: 'sha256:1111222233334444' } }] },
      ]
      const projectedImages = projector.projectImagesForTextModel(imageMessages)
      const imageText = ((projectedImages[0]?.content as RequestMessageLike[])[0] as RequestMessageLike)
        .text as string
      expect(imageText).toContain('image omitted because this model accepts text only')
      expect(imageText).toContain('11112222')

      // Official unsupported-route projection: developer messages stripped.
      const devMessages: RequestMessageLike[] = [
        { role: 'developer', content: [{ type: 'tool-addition', toolName: 't' }] },
        { role: 'user', content: [{ type: 'text', text: 'u' }] },
      ]
      const projectedTools = projector.projectToolUpdates(
        devMessages,
        [{ name: 'a', description: 'a', parameters: {}, deferLoading: true }],
        undefined,
      )
      expect(projectedTools.messages.map((m) => m.role)).toEqual(['user'])
      expect(projectedTools.tools?.[0]).toEqual({ name: 'a', description: 'a', parameters: {} })
    }, 20000)
  },
)
