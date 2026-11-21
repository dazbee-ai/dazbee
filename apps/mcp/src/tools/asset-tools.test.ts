import { afterEach, describe, expect, it } from 'vitest'

import { VIEW_ONLY } from '@dazbee/doc'
import { testDesign } from '@dazbee/doc/test-design'
import { type TestEditor, testEditor } from '@dazbee/editor/test-editor'

import { TEST_ASSETS, TEST_CARD_SVG, TEST_LOGO_SVG } from '../test-api.ts'
import { type TestServer, testServer, textOf } from '../test-client.ts'

/** A design's layers, as the sync server or the editor holds them. */
interface Layers {
  nodes: Readonly<Record<string, unknown>>
}

/** What place_asset answers of the layer it placed. */
interface Placed {
  layer: string
  box: { x: number; y: number; width: number; height: number }
}

/** A layer as a design holds it. */
interface StoredLayer {
  parentId?: unknown
  index?: unknown
  link?: unknown
  props?: Record<string, unknown>
  [key: string]: unknown
}

let server: TestServer
let editors: TestEditor[] = []

afterEach(async () => {
  for (const t of editors) t.end()
  editors = []
  await server.endpoint.close()
})

/** The design the tests open. */
const LAUNCH = { brand: 'brand-summer', design: 'design-launch' }
/** The middle of the test design's square frame, where the editor places an asset with no point. */
const MIDDLE = { frameId: 'sq', x: 540, y: 540 }

/** An agent of an access with `options`, the launch design open. */
async function opened(options?: Parameters<TestServer['api']['addAccess']>[0]) {
  server = testServer()
  const agent = await server.connect(server.api.addAccess(options).token())
  expect((await agent.call('open_design', LAUNCH)).isError).toBeFalsy()
  return { agent, sync: server.sync('design-launch') }
}

/** The editor's core opened on the design the sync server starts with, ended after the test. */
async function editorOnLaunch() {
  const t = await testEditor(testDesign())
  editors.push(t)
  return t
}

/** The fake API's asset with `id`, as the editor places it. */
function assetOf(id: string) {
  const asset = TEST_ASSETS.find((a) => a.id === id)
  if (!asset) throw new Error(`no test asset ${id}`)
  return asset
}

/**
 * The layer `id` and the layers inside it, back to front, without ids, places among siblings or link ids, which
 * differ between two placings of one asset.
 */
function shapeOf(design: Layers, id: string): unknown {
  const node = layerOf(design, id)
  if (!node) return undefined
  const rest: StoredLayer = { ...node }
  delete rest.parentId
  delete rest.index
  delete rest.link
  return { ...rest, children: childrenIn(design, id).map((child) => shapeOf(design, child)) }
}

/** The ids of `id` and every layer inside it. */
function idsUnder(design: Layers, id: string): string[] {
  return [id, ...childrenIn(design, id).flatMap((child) => idsUnder(design, child))]
}

/** The layer `id` of a design. */
function layerOf(design: Layers, id: string): StoredLayer | undefined {
  return design.nodes[id] as StoredLayer | undefined
}

/** The ids of the layers directly inside `id`, back to front. */
function childrenIn(design: Layers, id: string): string[] {
  return Object.keys(design.nodes)
    .filter((child) => layerOf(design, child)?.parentId === id)
    .sort((a, b) => (String(layerOf(design, a)?.index) < String(layerOf(design, b)?.index) ? -1 : 1))
}

describe('place_asset', () => {
  it('places an image with no box as the editor places it: in the middle of the frame, at most half its sides', async () => {
    const { agent, sync } = await opened()
    const answer = (await agent.json('place_asset', { frame: 'sq', asset: 'asset-bottle' })) as { layer: string }
    expect(answer).toEqual({
      layer: answer.layer,
      box: { x: 360, y: 270, width: 360, height: 540 },
      warnings: [],
    })
    const t = await editorOnLaunch()
    const id = t.core.placeImage(assetOf('asset-bottle'), MIDDLE) ?? ''
    expect(shapeOf(sync.state(), answer.layer)).toEqual(shapeOf(t.core.design(), id))
    expect(sync.state().nodes[answer.layer]).toMatchObject({
      type: 'graphic',
      parentId: 'sq',
      props: { fills: [{ type: 'image', assetId: 'asset-bottle', fit: 'fill' }] },
    })
  })

  it('places an image covering the box given', async () => {
    const { agent, sync } = await opened()
    const box = { x: 40, y: 60, width: 500, height: 300 }
    const answer = (await agent.json('place_asset', { frame: 'sq', asset: 'asset-bottle', box })) as {
      layer: string
    }
    expect(answer).toMatchObject({ box })
    expect(layerOf(sync.state(), answer.layer)?.props).toMatchObject({
      ...box,
      fills: [{ type: 'image', assetId: 'asset-bottle', fit: 'fill' }],
    })
  })

  it('places the brand kit’s logo, an image, bound to brand:logo, as the editor places the kit’s logo', async () => {
    const { agent, sync } = await opened()
    const answer = (await agent.json('place_asset', { frame: 'sq', asset: 'asset-mark' })) as { layer: string }
    expect(answer).toMatchObject({ bound: 'brand:logo' })
    expect(sync.state().nodes[answer.layer]).toMatchObject({
      name: 'Logo',
      role: 'logo',
      bindings: { image: 'brand:logo' },
    })
    const t = await editorOnLaunch()
    const id = t.core.placeImage(assetOf('asset-mark'), MIDDLE, { logo: { name: 'Logo' } }) ?? ''
    expect(shapeOf(sync.state(), answer.layer)).toEqual(shapeOf(t.core.design(), id))
  })

  it('binds no other image to the logo', async () => {
    const { agent, sync } = await opened()
    const answer = (await agent.json('place_asset', { frame: 'sq', asset: 'asset-bottle' })) as { layer: string }
    expect(sync.state().nodes[answer.layer]).not.toHaveProperty('role')
    expect(layerOf(sync.state(), answer.layer)?.bindings ?? {}).toEqual({})
  })

  it('places an SVG file as the same layer tree the editor makes of it', async () => {
    const { agent, sync } = await opened()
    const answer = (await agent.json('place_asset', { frame: 'sq', asset: 'asset-logo' })) as { layer: string }
    const t = await editorOnLaunch()
    const read = await t.core.readSvg(TEST_LOGO_SVG, 'Logo', MIDDLE)
    const id = (read && t.core.placeSvg(read)) ?? ''
    const placed = shapeOf(sync.state(), answer.layer)
    expect(placed).toEqual(shapeOf(t.core.design(), id))
    expect(placed).toMatchObject({
      type: 'group',
      name: 'Logo',
      children: [{ name: 'Badge' }, { name: 'Peak' }, { type: 'text', name: 'Summer' }],
    })
  })

  it('fits an SVG file inside the box given, its shape kept, centred in it', async () => {
    const { agent, sync } = await opened()
    const box = { x: 100, y: 100, width: 200, height: 200 }
    const answer = (await agent.json('place_asset', { frame: 'sq', asset: 'asset-logo', box })) as Placed
    const [badge = ''] = childrenIn(sync.state(), answer.layer)
    // The 400 × 120 file at half its size, its badge 60 × 60, the group as tall as the badge, its middle the box's.
    expect(layerOf(sync.state(), badge)?.props).toMatchObject({ y: 170, width: 60, height: 60 })
    expect(answer.box).toMatchObject({ y: 170, height: 60 })
    expect(answer.box.x).toBeGreaterThanOrEqual(box.x)
    expect(answer.box.x + answer.box.width).toBeLessThanOrEqual(box.x + box.width)
  })

  it('scales a small SVG file up to fill the box', async () => {
    const { agent, sync } = await opened()
    const box = { x: 0, y: 0, width: 800, height: 800 }
    const answer = (await agent.json('place_asset', { frame: 'sq', asset: 'asset-logo', box })) as Placed
    const [badge = ''] = childrenIn(sync.state(), answer.layer)
    // Twice its size: the badge 240 × 240, from y 280.
    expect(layerOf(sync.state(), badge)?.props).toMatchObject({ y: 280, width: 240, height: 240 })
    expect(answer.box.x + answer.box.width).toBeLessThanOrEqual(box.width)
  })

  it('places an image, the kit’s logo or an SVG file as one undo step', async () => {
    const { agent, sync } = await opened()
    for (const asset of ['asset-bottle', 'asset-mark', 'asset-logo']) {
      const before = Object.keys(sync.state().nodes)
      const answer = (await agent.json('place_asset', { frame: 'sq', asset })) as { layer: string }
      const placed = idsUnder(sync.state(), answer.layer)
      expect(placed.length).toBeGreaterThan(0)
      expect(textOf(await agent.call('undo'))).toMatch(/^Undid /)
      expect(Object.keys(sync.state().nodes)).toEqual(before)
    }
    expect(textOf(await agent.call('undo'))).toBe('There is no step of this agent’s to undo')
  })

  it('leaves out the pictures an SVG file embeds, as the editor does with no uploader, and says so', async () => {
    const { agent, sync } = await opened()
    const result = await agent.call('place_asset', { frame: 'sq', asset: 'asset-card' })
    expect(result.isError).toBeFalsy()
    const answer = JSON.parse(textOf(result)) as { layer: string }
    expect(answer).toMatchObject({ leftOut: ['image'] })
    expect(JSON.stringify(shapeOf(sync.state(), answer.layer))).not.toContain('"image"')
    expect(result.content.slice(1).map((block) => (block.type === 'text' ? block.text : ''))).toEqual([
      expect.stringContaining('pictures'),
    ])
    const t = await editorOnLaunch()
    const read = await t.core.readSvg(TEST_CARD_SVG, 'Card', MIDDLE)
    const id = (read && t.core.placeSvg(read)) ?? ''
    expect(shapeOf(sync.state(), answer.layer)).toEqual(shapeOf(t.core.design(), id))
  })

  it('refuses an asset the brand doesn’t have and a frame the design doesn’t have, changing nothing', async () => {
    const { agent, sync } = await opened()
    const before = sync.state().nodes
    const asset = await agent.call('place_asset', { frame: 'sq', asset: 'asset-none' })
    expect(asset.isError).toBe(true)
    expect(textOf(asset)).toContain('list_assets')
    const frame = await agent.call('place_asset', { frame: 'nowhere', asset: 'asset-bottle' })
    expect(frame.isError).toBe(true)
    expect(textOf(frame)).toContain('read_design')
    expect(sync.state().nodes).toEqual(before)
  })

  it('answers the warnings for what it placed: an image wholly outside the frame', async () => {
    const { agent } = await opened()
    const box = { x: 2000, y: 2000, width: 100, height: 100 }
    const answer = (await agent.json('place_asset', { frame: 'sq', asset: 'asset-bottle', box })) as {
      layer: string
      warnings: unknown[]
    }
    expect(answer.warnings).toEqual([expect.objectContaining({ layerId: answer.layer, kind: 'outsideFrame' })])
  })

  it('refuses a box with no size', async () => {
    const { agent } = await opened()
    const result = await agent.call('place_asset', {
      frame: 'sq',
      asset: 'asset-bottle',
      box: { x: 0, y: 0, width: 0, height: 100 },
    })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('`box.width`')
  })

  it('refuses a view access’s tab with the view-only reason', async () => {
    const { agent } = await opened({ writes: false })
    const result = await agent.call('place_asset', { frame: 'sq', asset: 'asset-bottle' })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toBe(`${VIEW_ONLY.charAt(0).toUpperCase()}${VIEW_ONLY.slice(1)}.`)
  })
})
