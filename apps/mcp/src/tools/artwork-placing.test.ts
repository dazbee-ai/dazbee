// place_graphic and search_graphics for the artwork sets, driven through the MCP endpoint with the stand-in API: every
// artwork SVG file is `TEST_ART_SVG` and every pattern `TEST_TILE_SVG` there, whatever the graphic.
import { afterEach, describe, expect, it } from 'vitest'

import { artworks } from '@dazbee/graphics/artwork'

import { type TestServer, testServer, textOf } from '../test-client.ts'

/** A layer as a design holds it. */
interface StoredLayer {
  type?: string
  name?: string
  parentId?: unknown
  bindings?: Record<string, unknown>
  props?: Record<string, unknown>
}

/** A design's layers, as the sync server holds them. */
interface Layers {
  nodes: Readonly<Record<string, unknown>>
}

/** A graphic layer's paints, and what they are bound to. */
interface Painted {
  fills?: unknown
  strokes?: unknown
  bindings?: Record<string, unknown> | undefined
}

/** What place_graphic answers for an artwork graphic. */
interface Placed {
  layer: string
  box: { x: number; y: number; width: number; height: number }
  asset: { id: string; name: string }
  colour?: string
  backdrop?: string
  blend?: string
}

let server: TestServer

afterEach(async () => {
  await server.endpoint.close()
})

/** The design the tests open. */
const LAUNCH = { brand: 'brand-summer', design: 'design-launch' }
/** The test brand kit's Primary colour. */
const PRIMARY = '#FF5A36FF'

/** The id of the first graphic of `set` the manifest lists that `filter` is true of. */
function firstOf(
  set: string,
  filter: (tags: string[], files: Record<string, { blend?: string }>) => boolean = () => true,
): string {
  const found = artworks().find((each) => each.set === set && filter(each.tags, each.files))
  if (!found) throw new Error(`the manifest lists no such graphic of ${set}`)
  return `${found.set}/${found.name}`
}

/** An agent of the full access, the launch design open. */
async function opened() {
  server = testServer()
  const agent = await server.connect(server.api.addAccess().token())
  expect((await agent.call('open_design', LAUNCH)).isError).toBeFalsy()
  return { agent, sync: server.sync('design-launch') }
}

/** The graphics inside `id`, at any depth, by name: each one's fills and strokes, and what it is bound to. */
function painted(design: Layers, id: string): Record<string, Painted> {
  const nodes = design.nodes as Record<string, StoredLayer>
  const under = (parent: string): StoredLayer[] =>
    Object.entries(nodes)
      .filter(([, layer]) => layer.parentId === parent)
      .flatMap(([key, layer]) => [layer, ...under(key)])
  return Object.fromEntries(
    under(id)
      .filter(({ type }) => type === 'graphic')
      .map(({ name, props, bindings }) => [name ?? '', { fills: props?.fills, strokes: props?.strokes, bindings }]),
  )
}

/** The graphics' paints, without what they are bound to, as text to compare. */
function paints(layers: Record<string, Painted>): string {
  return JSON.stringify(Object.entries(layers).map(([name, { fills, strokes }]) => [name, fills, strokes]))
}

/** The names of the graphics bound to anything. */
function boundNames(layers: Record<string, Painted>): string[] {
  return Object.entries(layers)
    .filter(([, { bindings }]) => Object.keys(bindings ?? {}).length > 0)
    .map(([name]) => name)
}

describe('search_graphics', () => {
  it.each([
    ['gift', 'object'],
    ['rocket', '3d'],
    ['burst', 'shape'],
    ['underline', 'accent'],
    ['smoke', 'effect'],
    ['waves', 'background'],
  ])('finds “%s” among the %s graphics, each with an id place_graphic takes', async (query, kind) => {
    const { agent } = await opened()
    const { graphics } = (await agent.json('search_graphics', { query, kind })) as {
      graphics: { graphic: string; kind: string }[]
    }
    expect(graphics.length).toBeGreaterThan(0)
    expect(graphics.every((graphic) => graphic.kind === kind)).toBe(true)
    expect((await agent.call('place_graphic', { frame: 'sq', graphic: graphics[0]?.graphic })).isError).toBeFalsy()
  })
})

describe('place_graphic', () => {
  it('places an object as layers in its own colours, its file joining the brand’s library, in 40% of the frame', async () => {
    const { agent, sync } = await opened()
    const graphic = firstOf('streamline-plump')
    const answer = (await agent.json('place_graphic', { frame: 'sq', graphic })) as Placed
    const [set, name] = graphic.split('/')
    const file = artworks().find((each) => each.set === set && each.name === name)?.files.colour
    expect(server.api.bundled.asked).toEqual([
      {
        brandId: 'brand-summer',
        sha256: file?.sha256,
        name: expect.stringMatching(/ · Streamline Plump$/),
        tags: ['object', 'streamline plump'],
      },
    ])
    expect(answer.asset.id).toBe(server.api.bundled.added[0]?.id)
    const layers = painted(sync.state(), answer.layer)
    expect(layers.Body).toMatchObject({ fills: [{ type: 'solid', color: '#2859C5FF' }] })
    expect(boundNames(layers)).toEqual([])
    // The 100 square drawing fits a square of 40% of the 1080 square frame in its middle: 432 wide at 324, what it
    // draws centred in it.
    expect([answer.box.x, answer.box.width]).toEqual([expect.closeTo(324, 1), expect.closeTo(432, 1)])
    expect(answer.box.y + answer.box.height / 2).toBeCloseTo(540, 0)
  })

  it('draws a recoloured accent in the colour given, its every black, and changes nothing else', async () => {
    const { agent, sync } = await opened()
    const graphic = firstOf('dddoodle', (tags) => tags.includes('underline'))
    const own = (await agent.json('place_graphic', { frame: 'sq', graphic })) as Placed
    const coloured = (await agent.json('place_graphic', { frame: 'sq', graphic, colour: '#1A2B3C' })) as Placed
    expect(coloured.colour).toBe('#1A2B3CFF')
    const after = painted(sync.state(), coloured.layer)
    expect(after.Doodle).toMatchObject({ fills: [{ color: '#1A2B3CFF' }] })
    expect(after.Tip).toMatchObject({ fills: [{ color: '#1A2B3CFF' }] })
    expect(after.Line).toMatchObject({ strokes: [{ paint: { color: '#1A2B3CFF' } }] })
    expect(paints(after).replaceAll('#1A2B3C', '#000000')).toBe(paints(painted(sync.state(), own.layer)))
  })

  it('binds a shape’s white to a brand kit colour, in the kit’s colour, and changes nothing else', async () => {
    const { agent, sync } = await opened()
    const graphic = firstOf('coolshapes')
    const own = (await agent.json('place_graphic', { frame: 'sq', graphic })) as Placed
    const bound = (await agent.json('place_graphic', { frame: 'sq', graphic, colour: 'brand:primary' })) as Placed
    expect(bound.colour).toBe('brand:primary')
    const after = painted(sync.state(), bound.layer)
    expect(after.Shape).toMatchObject({ fills: [{ color: PRIMARY }], bindings: { fill: 'brand:primary' } })
    expect(boundNames(after)).toEqual(['Shape'])
    expect(paints(after).replaceAll(PRIMARY, '#FFFFFFFF')).toBe(paints(painted(sync.state(), own.layer)))
  })

  it('draws a two-blue object’s dark blue in the colour given and its light blue as the same lighter mix of it', async () => {
    const { agent, sync } = await opened()
    const graphic = firstOf('streamline-plump')
    const answer = (await agent.json('place_graphic', { frame: 'sq', graphic, colour: '#E4572E' })) as Placed
    const after = painted(sync.state(), answer.layer)
    expect(after.Body).toMatchObject({ fills: [{ color: '#E4572EFF' }] })
    expect(after.Light).toMatchObject({ fills: [{ color: '#F3B3A0FF' }] })
    expect(after.Spot).toMatchObject({ fills: [{ color: '#E4572EFF' }] })
  })

  it('places a 3D object as an image of the picture it adds to the brand’s library, in the style asked for', async () => {
    const { agent, sync } = await opened()
    const graphic = firstOf('3dicons')
    const answer = (await agent.json('place_graphic', { frame: 'sq', graphic, style: 'clay-iso' })) as Placed
    expect(server.api.bundled.asked[0]).toMatchObject({ tags: ['3d', '3dicons'] })
    expect(server.api.bundled.added[0]).toMatchObject({ contentType: 'image/png' })
    expect(sync.state().nodes[answer.layer]).toMatchObject({
      type: 'graphic',
      parentId: 'sq',
      props: { fills: [{ type: 'image', assetId: answer.asset.id }] },
    })
  })

  it('places a light effect over the whole frame in the screen blend, so its dark drops out over a photo', async () => {
    const { agent, sync } = await opened()
    const graphic = firstOf('kenney-particles', (_, files) => files.light?.blend === 'screen')
    const answer = (await agent.json('place_graphic', { frame: 'sq', graphic })) as Placed
    expect(answer.blend).toBe('screen')
    expect(sync.state().nodes[answer.layer]).toMatchObject({ props: { blendMode: 'screen' } })
    expect(Math.max(answer.box.width, answer.box.height)).toBeCloseTo(1080, 0)
  })

  it('places a dark effect in the normal blend', async () => {
    const { agent, sync } = await opened()
    const graphic = firstOf('kenney-smoke', (_, files) => files.smoke?.blend === undefined)
    const answer = (await agent.json('place_graphic', { frame: 'sq', graphic })) as Placed
    expect(answer.blend).toBeUndefined()
    expect(sync.state().nodes[answer.layer]).not.toMatchObject({ props: { blendMode: 'screen' } })
  })

  it('repeats a background over the whole frame, its lines bound to a brand colour and no backdrop', async () => {
    const { agent, sync } = await opened()
    const graphic = firstOf('pattern-monster')
    const answer = (await agent.json('place_graphic', {
      frame: 'sq',
      graphic,
      colour: 'brand:primary',
      backdrop: 'none',
    })) as Placed
    expect(answer).toMatchObject({ colour: 'brand:primary', backdrop: 'none' })
    // Its lines run across the whole frame; with no backdrop its box is theirs.
    expect([answer.box.x, answer.box.width]).toEqual([expect.closeTo(0, 1), expect.closeTo(1080, 1)])
    expect(answer.box.y).toBeGreaterThanOrEqual(0)
    expect(answer.box.y + answer.box.height).toBeLessThanOrEqual(1080)
    expect(Object.values(painted(sync.state(), answer.layer))).toEqual([
      { fills: [expect.objectContaining({ color: PRIMARY })], strokes: [], bindings: { fill: 'brand:primary' } },
    ])
  })

  it('repeats a background over its own white backdrop, or one in the colour given', async () => {
    const { agent, sync } = await opened()
    const graphic = firstOf('pattern-monster')
    const own = (await agent.json('place_graphic', { frame: 'sq', graphic })) as Placed
    expect(Object.values(painted(sync.state(), own.layer))).toHaveLength(2)
    const backed = (await agent.json('place_graphic', { frame: 'sq', graphic, backdrop: '#102030' })) as Placed
    const fills = Object.values(painted(sync.state(), backed.layer)).map(({ fills }) => JSON.stringify(fills))
    expect(fills.some((fill) => fill.includes('#102030FF'))).toBe(true)
  })

  it('tells an agent that gives a many-colour object or an effect a colour that it keeps its own', async () => {
    const { agent } = await opened()
    for (const graphic of [firstOf('streamline-kameleon'), firstOf('kenney-particles')]) {
      const result = await agent.call('place_graphic', { frame: 'sq', graphic, colour: '#000000' })
      expect(result.isError).toBeFalsy()
      expect(result.content.slice(1).map((block) => (block.type === 'text' ? block.text : ''))).toEqual([
        expect.stringContaining('colour given was left unused'),
      ])
    }
  })

  it('refuses a graphic Dazbee’s storage doesn’t hold yet, changing nothing', async () => {
    const { agent, sync } = await opened()
    server.api.bundled.stored = false
    const before = sync.state().nodes
    const graphic = firstOf('coolshapes')
    const result = await agent.call('place_graphic', { frame: 'sq', graphic })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toBe(`The shape “${graphic}” isn’t in Dazbee’s storage yet, so nothing was placed.`)
    expect(sync.state().nodes).toEqual(before)
  })
})
