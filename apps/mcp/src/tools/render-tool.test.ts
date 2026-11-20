import { Worker } from 'node:worker_threads'

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { afterEach, describe, expect, it } from 'vitest'

import { testDesign } from '@dazbee/doc/test-design'
import { openAgentTab } from '@dazbee/editor/agent-tab'
import { agentRender } from '@dazbee/export'
import { FALLBACK_FAMILIES } from '@dazbee/fonts'
import { loadFontFiles } from '@dazbee/fonts/node'
import { loadCanvasKit } from '@dazbee/renderer/node'
import { brandVariables, type DesignInput, parseDesign } from '@dazbee/schema'

import { MAX_RENDER_PIXELS } from '../limits.ts'
import type { RenderThread } from '../render-queue.ts'
import { TEST_BOTTLE_PNG, TEST_BRAND_KIT } from '../test-api.ts'
import { type TestServer, testServer, textOf } from '../test-client.ts'

let server: TestServer

afterEach(async () => {
  await server.endpoint.close()
})

/** The design the tests open. */
const LAUNCH = { brand: 'brand-summer', design: 'design-launch' }

/** The test design, its square's box filled with the bottle's image. */
function withBottle(): DesignInput {
  const design = testDesign()
  const box = design.nodes.box as { props: Record<string, unknown> }
  box.props = { ...box.props, fills: [{ type: 'image', assetId: 'asset-bottle', fit: 'fill', opacity: 1 }] }
  return design
}

/** A design whose one frame is 6,000 pixels a side. */
function bigDesign(): DesignInput {
  const design = testDesign()
  const square = { pageId: 'p1', name: 'Square', x: 0, y: 0, order: 'a0', width: 6000, height: 6000 }
  return { ...design, frames: { ...design.frames, sq: square } }
}

/** A client of a new access, on a server whose design-launch is `design`, with the design open. */
async function agentOn(design: DesignInput, options: Parameters<typeof testServer>[0] = {}) {
  server = testServer({ ...options, designs: { 'design-launch': design } })
  const agent = await server.connect(server.api.addAccess().token())
  expect((await agent.call('open_design', LAUNCH)).isError).toBeFalsy()
  return agent
}

/** The PNG of a render's image block, and its text block parsed. */
function pictureOf(result: CallToolResult) {
  expect(result.isError).toBeFalsy()
  const [image, text] = result.content
  if (image?.type !== 'image' || text?.type !== 'text') throw new Error('not an image block and a text block')
  expect(image.mimeType).toBe('image/png')
  const png = Uint8Array.from(Buffer.from(image.data, 'base64'))
  return { png, details: JSON.parse(text.text) as { frame: string; width: number; height: number; scale: number } }
}

/** A PNG's width and height, read from its header. */
function pngSize(png: Uint8Array) {
  const view = new DataView(png.buffer, png.byteOffset)
  return { width: view.getUint32(16), height: view.getUint32(20) }
}

/** The frame of the design the sync server holds now, drawn by agentRender with the bottle and the brand kit. */
async function expectedRender(frameId: string, maxSize: number) {
  const parsed = parseDesign(server.sync('design-launch').state())
  if (!parsed.success) throw new Error(parsed.errors.join('\n'))
  const bytes = {
    fonts: loadFontFiles(),
    fallbackFamilies: [...FALLBACK_FAMILIES],
    images: { 'asset-bottle': TEST_BOTTLE_PNG },
    variables: brandVariables(TEST_BRAND_KIT),
  }
  return agentRender(await loadCanvasKit(), parsed.design, frameId, bytes, { maxSize }).png
}

describe('render_frame', () => {
  it('answers the frame as a PNG fitted to maxSize, with its sizes, drawn as agentRender draws it', async () => {
    const agent = await agentOn(withBottle())
    const { png, details } = pictureOf(await agent.call('render_frame', { frame: 'sq', maxSize: 300 }))
    expect(details).toEqual({ frame: 'sq', width: 300, height: 300, scale: expect.closeTo(300 / 1080, 6) })
    expect(pngSize(png)).toEqual({ width: 300, height: 300 })
    expect(png).toEqual(await expectedRender('sq', 300))
  })

  it('fits the longer side to 1,600 pixels unless asked, never past twice the frame', async () => {
    const agent = await agentOn(withBottle())
    const square = pictureOf(await agent.call('render_frame', { frame: 'sq' }))
    expect(pngSize(square.png)).toEqual({ width: 1600, height: 1600 })
    const banner = pictureOf(await agent.call('render_frame', { frame: 'banner' }))
    expect(banner.details).toEqual({ frame: 'banner', width: 640, height: 100, scale: 2 })
    expect(pngSize(banner.png)).toEqual({ width: 640, height: 100 })
  })

  it('shows another tab’s change', async () => {
    const agent = await agentOn(withBottle())
    const before = pictureOf(await agent.call('render_frame', { frame: 'sq', maxSize: 200 })).png
    const sync = server.sync('design-launch')
    const other = await openAgentTab({
      ck: await loadCanvasKit(),
      designId: 'design-launch',
      url: 'ws://sync.test',
      token: () => Promise.resolve('bob'),
      socket: (url) => sync.socket(url),
      sources: {},
    })
    try {
      other.session.run('frame.update', { frameId: 'sq', fills: [{ type: 'solid', color: '#0057B8FF' }] })
      await sync.settle()
      const after = pictureOf(await agent.call('render_frame', { frame: 'sq', maxSize: 200 })).png
      expect(after).not.toEqual(before)
      expect(after).toEqual(await expectedRender('sq', 200))
    } finally {
      await other.close()
    }
  })

  it('refuses a maxSize outside 16 to 8,192', async () => {
    const agent = await agentOn(testDesign())
    for (const maxSize of [15, 8193]) {
      const result = await agent.call('render_frame', { frame: 'sq', maxSize })
      expect(result.isError).toBe(true)
      expect(textOf(result)).toMatch(/^`maxSize`: /)
    }
  })

  it('answers a frame the design doesn’t have as a tool error', async () => {
    const agent = await agentOn(testDesign())
    const result = await agent.call('render_frame', { frame: 'nope' })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toBe('The open design has no frame “nope”; read_design lists its frames.')
  })

  it('draws on the worker, so another session’s read answers while a large frame is drawn', async () => {
    let posted = () => {}
    const onWorker = new Promise<void>((resolve) => (posted = resolve))
    const agent = await agentOn(bigDesign(), {
      startRenderWorker: () => {
        const worker = new Worker(new URL('../render-worker.ts', import.meta.url)) as RenderThread
        const post = worker.postMessage.bind(worker)
        worker.postMessage = (job) => {
          post(job)
          posted()
        }
        return worker
      },
    })
    const other = await server.connect(server.api.addAccess().token())
    await other.call('open_design', LAUNCH)
    let drawn = false
    const rendering = agent.call('render_frame', { frame: 'sq', maxSize: 8192 }).then((result) => {
      drawn = true
      return result
    })
    await onWorker
    expect((await other.call('read_design')).isError).toBeFalsy()
    expect(drawn).toBe(false)
    // Drawn at most MAX_RENDER_PIXELS, so smaller than the 8,192 asked.
    const { width, height } = pngSize(pictureOf(await rendering).png)
    expect(width).toBe(height)
    expect(width * height).toBeLessThanOrEqual(MAX_RENDER_PIXELS)
    expect(width).toBeGreaterThan(4000)
  })
})
