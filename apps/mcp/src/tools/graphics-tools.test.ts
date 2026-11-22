import { afterEach, describe, expect, it } from 'vitest'

import { VIEW_ONLY } from '@dazbee/doc'
import { illustrationOf } from '@dazbee/graphics/illustrations'
import { stickerPicture } from '@dazbee/graphics/pictures'

import { type TestServer, testServer, textOf } from '../test-client.ts'

/** A design's layers, as the sync server holds them. */
interface Layers {
  nodes: Readonly<Record<string, unknown>>
}

/** A layer as a design holds it. */
interface StoredLayer {
  type?: string
  name?: string
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

/** A layer's paints, and what they are bound to. */
interface Painted {
  fills?: unknown
  strokes?: unknown
  bindings?: Record<string, unknown> | undefined
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
    expect(textOf(result)).toContain('No icon, sticker or illustration matches')
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

  it('finds every kind together when no kind is asked for', async () => {
    const agent = await connected()
    const { graphics } = (await agent.json('search_graphics', { query: 'heart', limit: 50 })) as Found
    expect([...new Set(graphics.map(({ kind }) => kind))]).toEqual(
      expect.arrayContaining(['icon', 'sticker', 'illustration', 'object']),
    )
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
      expect(server.api.bundled.asked).toEqual([])
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
    const rocket = stickerPicture('fluent-emoji', 'rocket', '3d')
    expect(server.api.bundled.asked).toEqual([
      {
        brandId: 'brand-summer',
        sha256: rocket?.sha256,
        name: 'Rocket · Fluent Emoji',
        tags: ['sticker', 'fluent emoji'],
      },
      {
        brandId: 'brand-summer',
        sha256: rocket?.sha256,
        name: 'Rocket · Fluent Emoji',
        tags: ['sticker', 'fluent emoji'],
      },
    ])
    expect(server.api.bundled.added).toEqual([
      expect.objectContaining({ id: first.asset.id, contentType: 'image/png', width: 256, height: 256 }),
    ])
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
    expect(server.api.bundled.asked).toEqual([])
  })

  it('refuses a picture sticker Dazbee’s storage doesn’t hold yet, pointing to its drawing, changing nothing', async () => {
    const { agent, sync } = await opened()
    server.api.bundled.stored = false
    const before = sync.state().nodes
    const result = await agent.call('place_graphic', { frame: 'sq', graphic: 'fluent-emoji/rocket', style: '3d' })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toBe(
      'The 3d picture of “fluent-emoji/rocket” isn’t in Dazbee’s storage yet, so nothing was placed; place its flat style instead.',
    )
    expect(sync.state().nodes).toEqual(before)
  })
})

describe('illustrations', () => {
  /** The scene's layers by name, each with what it is filled and outlined with and what it is bound to. */
  function painted(design: Layers, root: string): Record<string, Painted> {
    return Object.fromEntries(
      under(design, root)
        .filter(({ type }) => type === 'graphic')
        .map(({ name, props, bindings }) => [name ?? '', { fills: props?.fills, strokes: props?.strokes, bindings }]),
    )
  }

  /** The scene's paints by layer, without what they are bound to. */
  function paints(layers: Record<string, Painted>): string {
    return JSON.stringify(
      Object.fromEntries(Object.entries(layers).map(([name, { fills, strokes }]) => [name, { fills, strokes }])),
    )
  }

  it('finds unDraw’s scenes first for “delivery”, kind illustration, each with an id place_graphic takes', async () => {
    const { agent } = await opened()
    const { graphics } = (await agent.json('search_graphics', { query: 'delivery', kind: 'illustration' })) as Found
    expect(graphics[0]).toMatchObject({ graphic: 'undraw/delivery', kind: 'illustration', set: 'undraw' })
    expect(graphics.every(({ kind }) => kind === 'illustration')).toBe(true)
    expect(new Set(graphics.map(({ set }) => set))).toEqual(
      new Set(['undraw', 'manypixels-chromablue', 'manypixels-birdview']),
    )
    const placed = await agent.call('place_graphic', { frame: 'sq', graphic: graphics[1]?.graphic })
    expect(placed.isError).toBeFalsy()
  })

  it('keeps a search to the illustration set given', async () => {
    const agent = await connected()
    const { graphics } = (await agent.json('search_graphics', { query: 'team', set: 'manypixels-birdview' })) as Found
    expect(graphics.length).toBeGreaterThan(0)
    expect(graphics.every(({ set, styles }) => set === 'manypixels-birdview' && styles[0] === 'isometric')).toBe(true)
  })

  it('places an illustration as layers in its own colours, its file joining the brand’s library, in 80% of the frame', async () => {
    const { agent, sync } = await opened()
    const answer = (await agent.json('place_graphic', { frame: 'sq', graphic: 'undraw/delivery' })) as Placed & {
      asset: { id: string; name: string }
    }
    expect(server.api.bundled.asked).toEqual([
      {
        brandId: 'brand-summer',
        sha256: illustrationOf('undraw', 'delivery')?.sha256,
        name: 'Delivery · unDraw',
        tags: ['illustration', 'undraw'],
      },
    ])
    expect(answer.asset).toEqual({ id: server.api.bundled.added[0]?.id, name: 'Delivery · unDraw' })
    expect(server.api.bundled.added[0]).toMatchObject({ contentType: 'image/svg+xml' })
    expect(layerOf(sync.state(), answer.layer)).toMatchObject({ type: 'group', parentId: 'sq' })
    const layers = painted(sync.state(), answer.layer)
    expect(layers.Parcel).toMatchObject({ fills: [{ type: 'solid', color: '#6C63FFFF' }] })
    expect(layers.Badge).toMatchObject({ fills: [{ type: 'solid', color: '#68E1FDFF' }] })
    expect(Object.values(layers).every(({ bindings }) => Object.keys(bindings ?? {}).length === 0)).toBe(true)
    // The scene fits 80% of the 1080 square frame, 864 × 864 in its middle: as wide as that, centred, what it draws
    // (260 of its 300 high) scaled with it.
    const { x, y, width, height } = answer.box
    expect([x, width]).toEqual([108, expect.closeTo(864, 2)])
    expect(y + height / 2).toBeCloseTo(540, 2)
    expect(height).toBeCloseTo((260 * 864) / 400, 2)
  })

  it('swaps the set’s accent for a hex accent wherever the scene paints with it, and changes nothing else', async () => {
    const { agent, sync } = await opened()
    const own = (await agent.json('place_graphic', { frame: 'sq', graphic: 'undraw/delivery' })) as Placed
    const accented = (await agent.json('place_graphic', {
      frame: 'sq',
      graphic: 'undraw/delivery',
      accent: '#E4572E',
    })) as Placed & { accent: string }
    expect(accented).toMatchObject({ accent: '#E4572EFF', box: own.box })
    const after = painted(sync.state(), accented.layer)
    expect(after.Parcel).toMatchObject({ fills: [{ type: 'solid', color: '#E4572EFF' }] })
    expect(after.Glow).toMatchObject({ fills: [{ type: 'solid', color: '#E4572EFF', opacity: 0.3 }] })
    expect(after.Body).toMatchObject({ strokes: [{ paint: { color: '#E4572EFF' } }], fills: [{ color: '#2F2E41FF' }] })
    expect(Object.values(after).every(({ bindings }) => Object.keys(bindings ?? {}).length === 0)).toBe(true)
    expect(paints(after).replaceAll('#E4572E', '#6C63FF')).toBe(paints(painted(sync.state(), own.layer)))
    expect(server.api.bundled.added).toHaveLength(1)
  })

  it('binds the fills that are the accent alone to a brand kit colour, faded ones too, its strokes and gradients written in it', async () => {
    const { agent, sync } = await opened()
    const own = (await agent.json('place_graphic', { frame: 'sq', graphic: 'undraw/delivery' })) as Placed
    const answer = (await agent.json('place_graphic', {
      frame: 'sq',
      graphic: 'undraw/delivery',
      accent: 'brand:primary',
    })) as Placed
    expect(answer.bound).toBe('brand:primary')
    const layers = painted(sync.state(), answer.layer)
    expect(layers.Parcel).toMatchObject({
      fills: [{ type: 'solid', color: PRIMARY }],
      bindings: { fill: 'brand:primary' },
    })
    expect(layers.Glow).toMatchObject({ fills: [{ color: PRIMARY, opacity: 0.3 }] })
    expect(layers.Body).toMatchObject({ strokes: [{ paint: { color: PRIMARY } }] })
    const bound = Object.entries(layers).filter(([, { bindings }]) => Object.keys(bindings ?? {}).length > 0)
    expect(bound.map(([name]) => name).sort()).toEqual(['Glow', 'Parcel'])
    expect(paints(layers).replaceAll(PRIMARY.slice(0, 7), '#6C63FF')).toBe(paints(painted(sync.state(), own.layer)))
  })

  it('refuses an illustration Dazbee’s storage doesn’t hold yet, changing nothing', async () => {
    const { agent, sync } = await opened()
    server.api.bundled.stored = false
    const before = sync.state().nodes
    const result = await agent.call('place_graphic', { frame: 'sq', graphic: 'undraw/delivery' })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toBe(
      'The illustration “undraw/delivery” isn’t in Dazbee’s storage yet, so nothing was placed.',
    )
    expect(sync.state().nodes).toEqual(before)
  })

  it('tells an agent that gives a sticker an accent that the sticker keeps its own colours', async () => {
    const { agent } = await opened()
    const result = await agent.call('place_graphic', { frame: 'sq', graphic: 'open-doodles/coffee', accent: '#000000' })
    expect(result.isError).toBeFalsy()
    expect(result.content.slice(1).map((block) => (block.type === 'text' ? block.text : ''))).toEqual([
      expect.stringContaining('accent given was left unused'),
    ])
  })
})
