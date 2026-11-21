import { afterEach, describe, expect, it } from 'vitest'

import { VIEW_ONLY } from '@dazbee/doc'

import { TEST_ASSETS } from '../test-api.ts'
import { type TestServer, testServer, textOf } from '../test-client.ts'

/** A design's layers, as the sync server holds them. */
interface Layers {
  nodes: Readonly<Record<string, unknown>>
}

/** A layer as a design holds it. */
interface StoredLayer {
  type?: string
  parentId?: unknown
  bindings?: Record<string, unknown>
  props?: Record<string, unknown>
}

/** What place_graphic answers. */
interface Placed {
  layer: string
  box: { x: number; y: number; width: number; height: number }
  bound?: string
  warnings: unknown[]
}

/** What search_graphics answers. */
interface Found {
  graphics: { graphic: string; kind: string; set: string; name: string; styles: string[]; tags: string[] }[]
}

let server: TestServer

afterEach(async () => {
  await server.endpoint.close()
})

/** The design the tests open. */
const LAUNCH = { brand: 'brand-summer', design: 'design-launch' }
/** The test brand kit's Primary colour. */
const PRIMARY = '#FF5A36FF'

/** An agent of an access with `options`, no design open. */
async function connected(options?: Parameters<TestServer['api']['addAccess']>[0]) {
  server = testServer()
  return server.connect(server.api.addAccess(options).token())
}

/** An agent of an access with `options`, the launch design open. */
async function opened(options?: Parameters<TestServer['api']['addAccess']>[0]) {
  const agent = await connected(options)
  expect((await agent.call('open_design', LAUNCH)).isError).toBeFalsy()
  return { agent, sync: server.sync('design-launch') }
}

/** The layer `id` of a design. */
function layerOf(design: Layers, id: string): StoredLayer | undefined {
  return design.nodes[id] as StoredLayer | undefined
}

/** The layers inside `id`, at any depth. */
function under(design: Layers, id: string): StoredLayer[] {
  const children = Object.keys(design.nodes).filter((child) => layerOf(design, child)?.parentId === id)
  return children.flatMap((child) => [layerOf(design, child) as StoredLayer, ...under(design, child)])
}

describe('search_graphics', () => {
  it.each(['cart', 'star', 'arrow'])('finds icons from both icon sets for “%s”, kind icon', async (query) => {
    const agent = await connected()
    const { graphics: icons } = (await agent.json('search_graphics', { query, kind: 'icon' })) as Found
    expect(new Set(icons.map(({ set }) => set))).toEqual(new Set(['tabler', 'phosphor']))
    expect(icons.every(({ kind }) => kind === 'icon')).toBe(true)
    for (const icon of icons) expect(`${icon.name} ${icon.tags.join(' ')}`).toContain(query)
  })

  it('puts the icon named as the query first in each set', async () => {
    const agent = await connected()
    const { graphics: icons } = (await agent.json('search_graphics', { query: 'shopping cart' })) as Found
    expect(icons.slice(0, 2).map(({ graphic }) => graphic)).toEqual(['tabler/shopping-cart', 'phosphor/shopping-cart'])
    expect(icons[0]?.styles).toEqual(['outline', 'filled'])
    expect(icons[1]?.styles).toEqual(['regular', 'thin', 'light', 'bold', 'fill', 'duotone'])
  })

  it('narrows to one set and gives at most the limit', async () => {
    const agent = await connected()
    const { graphics: icons } = (await agent.json('search_graphics', {
      query: 'arrow',
      set: 'phosphor',
      limit: 5,
    })) as Found
    expect(icons).toHaveLength(5)
    expect(icons.every(({ set }) => set === 'phosphor')).toBe(true)
  })

  it('says so when nothing matches', async () => {
    const agent = await connected()
    const result = await agent.call('search_graphics', { query: 'zzqqxx' })
    expect(result.isError).toBeFalsy()
    expect(textOf(result)).toContain('No icon or sticker matches')
  })

  it.each([
    ['rocket', 'fluent-emoji', ['3d', 'flat']],
    ['standing peep', 'open-peeps', ['drawing']],
    ['humaaan', 'humaaans', ['drawing']],
    ['coffee doodle', 'open-doodles', ['drawing']],
  ])('finds “%s” in %s, kind sticker', async (query, set, styles) => {
    const agent = await connected()
    const { graphics } = (await agent.json('search_graphics', { query, kind: 'sticker' })) as Found
    expect(graphics[0]).toMatchObject({ kind: 'sticker', set, styles })
    expect(graphics.every(({ kind }) => kind === 'sticker')).toBe(true)
  })

  it('finds icons and stickers together when no kind is asked for', async () => {
    const agent = await connected()
    const { graphics } = (await agent.json('search_graphics', { query: 'heart' })) as Found
    expect(new Set(graphics.map(({ kind }) => kind))).toEqual(new Set(['icon', 'sticker']))
  })
})

describe('place_graphic', () => {
  it('places an outline icon as filled layers bound to the brand role given, in the kit’s colour', async () => {
    const { agent, sync } = await opened()
    const answer = (await agent.json('place_graphic', {
      frame: 'sq',
      graphic: 'tabler/shopping-cart',
      colour: 'brand:primary',
    })) as Placed
    expect(answer).toMatchObject({ bound: 'brand:primary', warnings: [] })
    const root = layerOf(sync.state(), answer.layer)
    expect(root).toMatchObject({ type: 'group', parentId: 'sq' })
    const graphics = under(sync.state(), answer.layer).filter(({ type }) => type === 'graphic')
    expect(graphics.length).toBeGreaterThan(0)
    for (const graphic of graphics) {
      expect(graphic.bindings).toEqual({ fill: 'brand:primary' })
      expect(graphic.props).toMatchObject({ fills: [{ type: 'solid', color: PRIMARY }] })
      expect(graphic.props?.strokes ?? []).toEqual([])
    }
  })

  it('places an icon in a plain colour, bound to nothing', async () => {
    const { agent, sync } = await opened()
    const answer = (await agent.json('place_graphic', {
      frame: 'sq',
      graphic: 'phosphor/star',
      style: 'fill',
      colour: '#1a2b3c',
    })) as Placed
    expect(answer).not.toHaveProperty('bound')
    const graphics = under(sync.state(), answer.layer).filter(({ type }) => type === 'graphic')
    expect(graphics.length).toBeGreaterThan(0)
    for (const graphic of graphics) {
      expect(graphic.bindings ?? {}).toEqual({})
      expect(graphic.props).toMatchObject({ fills: [{ type: 'solid', color: '#1A2B3CFF' }] })
    }
  })

  it('binds every layer of a duotone icon, its light part kept see-through', async () => {
    const { agent, sync } = await opened()
    const answer = (await agent.json('place_graphic', {
      frame: 'sq',
      graphic: 'phosphor/star',
      style: 'duotone',
      colour: 'brand:primary',
    })) as Placed
    const graphics = under(sync.state(), answer.layer).filter(({ type }) => type === 'graphic')
    expect(graphics).toHaveLength(2)
    expect(graphics.every(({ bindings }) => bindings?.fill === 'brand:primary')).toBe(true)
    expect(graphics.map(({ props }) => props?.opacity ?? 1).sort()).toEqual([0.2, 1])
  })

  it('fills the box given, or a quarter of the frame’s shorter side in its middle', async () => {
    const { agent } = await opened()
    const box = { x: 100, y: 200, width: 300, height: 300 }
    const inBox = (await agent.json('place_graphic', {
      frame: 'sq',
      graphic: 'phosphor/square',
      style: 'fill',
      colour: '#000000',
      box,
    })) as Placed
    // Phosphor's filled square leaves 32 of 256 on each side: 37.5 of 300.
    expect(inBox.box).toEqual({ x: 137.5, y: 237.5, width: 225, height: 225 })
    const middle = (await agent.json('place_graphic', {
      frame: 'sq',
      graphic: 'phosphor/square',
      style: 'fill',
      colour: '#000000',
    })) as Placed
    // A 270 square in the middle of the 1080 frame, from 405: the square drawn from 438.75.
    expect(middle.box).toEqual({ x: 438.75, y: 438.75, width: 202.5, height: 202.5 })
  })

  it('places an icon as one undo step', async () => {
    const { agent, sync } = await opened()
    const before = Object.keys(sync.state().nodes)
    await agent.json('place_graphic', { frame: 'sq', graphic: 'tabler/star', colour: 'brand:primary' })
    expect(textOf(await agent.call('undo'))).toMatch(/^Undid /)
    expect(Object.keys(sync.state().nodes)).toEqual(before)
  })

  it('refuses an icon, a style or a kit colour there isn’t, changing nothing', async () => {
    const { agent, sync } = await opened()
    const before = sync.state().nodes
    const icon = await agent.call('place_graphic', { frame: 'sq', graphic: 'tabler/no-such', colour: '#000000' })
    expect(icon.isError).toBe(true)
    expect(textOf(icon)).toContain('search_graphics')
    const style = await agent.call('place_graphic', {
      frame: 'sq',
      graphic: 'tabler/star',
      style: 'bold',
      colour: '#000000',
    })
    expect(style.isError).toBe(true)
    expect(textOf(style)).toContain('outline, filled')
    const colour = await agent.call('place_graphic', { frame: 'sq', graphic: 'tabler/star', colour: 'brand:accent' })
    expect(colour.isError).toBe(true)
    expect(textOf(colour)).toContain('brand:primary')
    const frame = await agent.call('place_graphic', { frame: 'nowhere', graphic: 'tabler/star', colour: '#000000' })
    expect(frame.isError).toBe(true)
    expect(textOf(frame)).toContain('read_design')
    expect(sync.state().nodes).toEqual(before)
  })

  it('refuses a colour that is neither a hex colour nor a brand token', async () => {
    const { agent } = await opened()
    const result = await agent.call('place_graphic', { frame: 'sq', graphic: 'tabler/star', colour: 'red' })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('`colour`')
  })

  it('refuses a view access’s tab with the view-only reason', async () => {
    const { agent } = await opened({ writes: false })
    const result = await agent.call('place_graphic', { frame: 'sq', graphic: 'tabler/star', colour: '#000000' })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toBe(`${VIEW_ONLY.charAt(0).toUpperCase()}${VIEW_ONLY.slice(1)}.`)
  })

  it('refuses an icon with no colour, changing nothing', async () => {
    const { agent, sync } = await opened()
    const before = sync.state().nodes
    const result = await agent.call('place_graphic', { frame: 'sq', graphic: 'tabler/star' })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('give colour')
    expect(sync.state().nodes).toEqual(before)
  })

  it.each(['fluent-emoji/rocket:flat', 'open-peeps/peep-standing-1', 'humaaans/hero-1', 'open-doodles/coffee'])(
    'places the drawing sticker %s as a group of layers in its own colours, adding nothing to the asset library',
    async (id) => {
      const { agent, sync } = await opened()
      const [graphic, style] = id.split(':')
      const box = { x: 100, y: 100, width: 400, height: 400 }
      const answer = (await agent.json('place_graphic', {
        frame: 'sq',
        graphic,
        ...(style ? { style } : {}),
        box,
      })) as Placed
      expect(layerOf(sync.state(), answer.layer)).toMatchObject({ type: 'group', parentId: 'sq' })
      const graphics = under(sync.state(), answer.layer).filter(({ type }) => type === 'graphic')
      expect(graphics.length).toBeGreaterThan(0)
      expect(graphics.every(({ bindings }) => Object.keys(bindings ?? {}).length === 0)).toBe(true)
      // The file fitted inside the box, its shape kept: what it draws lies inside the box, and fills most of it.
      const { x, y, width, height } = answer.box
      expect(Math.min(x, y)).toBeGreaterThanOrEqual(99.5)
      expect(Math.max(x + width, y + height)).toBeLessThanOrEqual(500.5)
      expect(Math.max(width, height)).toBeGreaterThan(300)
      expect(server.api.uploads()).toBe(0)
      expect(server.api.assetsOf('brand-summer').map(({ id }) => id)).toEqual(TEST_ASSETS.map(({ id }) => id))
    },
  )

  it('places a picture sticker as an image of the asset it adds to the brand’s library, once however often it is placed', async () => {
    const { agent, sync } = await opened()
    const box = { x: 100, y: 200, width: 300, height: 150 }
    const first = (await agent.json('place_graphic', {
      frame: 'sq',
      graphic: 'fluent-emoji/rocket',
      box,
    })) as Placed & {
      asset: { id: string; name: string }
    }
    const again = (await agent.json('place_graphic', { frame: 'sq', graphic: 'fluent-emoji/rocket' })) as typeof first
    expect(first.asset).toEqual(again.asset)
    expect(first.asset.name).toBe('Rocket · Fluent Emoji')
    const added = server.api.assetsOf('brand-summer').filter(({ id }) => id === first.asset.id)
    expect(added).toEqual([
      expect.objectContaining({ name: 'Rocket · Fluent Emoji', contentType: 'image/png', width: 256, height: 256 }),
    ])
    expect(server.api.uploads()).toBe(1)
    for (const placed of [first, again])
      expect(layerOf(sync.state(), placed.layer)).toMatchObject({
        type: 'graphic',
        parentId: 'sq',
        props: { fills: [{ type: 'image', assetId: first.asset.id }] },
      })
    // The 256 square fits the 300 × 150 box as 150 square, centred; with no box, a 432 square in the frame's middle.
    expect(first.box).toEqual({ x: 175, y: 200, width: 150, height: 150 })
    expect(again.box).toEqual({ x: 324, y: 324, width: 432, height: 432 })
  })

  it('tells an agent that gives a sticker a colour that the sticker keeps its own', async () => {
    const { agent } = await opened()
    const result = await agent.call('place_graphic', { frame: 'sq', graphic: 'open-doodles/coffee', colour: '#000000' })
    expect(result.isError).toBeFalsy()
    expect(result.content.slice(1).map((block) => (block.type === 'text' ? block.text : ''))).toEqual([
      expect.stringContaining('keeps the colours'),
    ])
  })

  it('refuses a view access a picture sticker before it joins the asset library', async () => {
    const { agent } = await opened({ writes: false })
    const result = await agent.call('place_graphic', { frame: 'sq', graphic: 'fluent-emoji/rocket' })
    expect(result.isError).toBe(true)
    expect(server.api.uploads()).toBe(0)
  })
})
