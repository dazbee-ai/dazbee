// The tools for the graphics Dazbee bundles: search_graphics finds icons, stickers, illustrations and artwork by words,
// and place_graphic places one on a frame of the open design as one agent batch with its warnings: an icon as the
// layers the SVG reader makes of it, every shape filled with a colour or bound to a brand kit colour, which doesn't join
// the asset library; a sticker as it is drawn, a drawing as layers and a picture as an image, which joins the asset
// library; an illustration as layers in its own colours or with its accent swapped, which joins the asset library; and
// an artwork graphic (an object, 3D object, shape, accent, effect or background) as `artwork-placing.ts` places it.
import { z } from 'zod'

import { placedRoots } from '@dazbee/doc'
import { svgLayers, svgPlaceInput } from '@dazbee/editor/placed-asset'
import {
  ARTWORK_KINDS,
  ARTWORK_SETS,
  type ArtworkKind,
  findGraphic,
  type FoundGraphic,
  GRAPHIC_SET_IDS,
  iconSvg,
  searchGraphics,
} from '@dazbee/graphics'
import { loadCanvasKit } from '@dazbee/renderer/node'
import type { Frame, Rect } from '@dazbee/schema'

import type { OpenDesign } from '../open-design.ts'
import { type ArtworkColours, artworkPlacing, type FoundArtwork } from './artwork-placing.ts'
import { Note, writing } from './command-tools.ts'
import { defineTool, type Tool, type ToolContext, ToolRefusal, withNote } from './define-tool.ts'
import { FrameId } from './design-tools.ts'
import { illustrationPlacing } from './illustration-placing.ts'
import {
  centreOf,
  type ColourFill,
  frameIn,
  type FrameTo,
  placeAndAnswer,
  placeBox,
  type Placing,
  whole,
} from './place-on-frame.ts'
import { stickerPlacing } from './sticker-placing.ts'

/** How many graphics a search gives when no limit is asked for, and at most. */
const SEARCH_LIMIT = { default: 20, max: 50 } as const
/** How many of a graphic's tags a search tells. */
const TAGS_TOLD = 8
/** The share of the frame's shorter side taken by the square an icon, or a sticker, placed with no box fits in. */
const SHARE = { icon: 0.25, sticker: 0.4 } as const
/** The share of the frame's width and height an illustration placed with no box fits in, in the middle. */
const ILLUSTRATION_SHARE = 0.8
/**
 * The share of the frame's shorter side taken by the square an artwork graphic placed with no box fits in, in the
 * middle; an effect and a background are placed over the whole frame.
 */
const ARTWORK_SHARE: Readonly<Record<ArtworkKind, number | 'frame'>> = {
  object: 0.4,
  '3d': 0.4,
  shape: 0.4,
  accent: 0.4,
  effect: 'frame',
  background: 'frame',
}
/** What an agent is told when it gives an artwork graphic a colour it can't take. */
const ARTWORK_COLOUR_UNUSED = `This graphic keeps the colours it is drawn in (only a background and the graphics of ${Object.values(
  ARTWORK_SETS,
)
  .flatMap(({ title, paints }) => (paints ? [title] : []))
  .join(
    ', ',
  )} that paint with their set’s colours take a colour, and only a background takes a backdrop), so the colour given was left unused.`
/** What an agent is told when it gives a sticker or an illustration a colour. */
const COLOUR_UNUSED = {
  sticker: 'A sticker keeps the colours it is drawn in, so the colour given was left unused.',
  illustration: 'An illustration takes an accent rather than a colour, so the colour given was left unused.',
} as const
/** What an agent is told when it gives an accent to what has none to swap. */
const ACCENT_UNUSED = {
  icon: 'An icon takes a colour rather than an accent, so the accent given was left unused.',
  sticker: 'A sticker keeps the colours it is drawn in, so the accent given was left unused.',
  illustration: 'This illustration doesn’t paint with its set’s accent colour, so it keeps its own colours.',
  artwork: 'Only an illustration takes an accent; give colour instead, so the accent given was left unused.',
} as const

/** An icon's colour: a hex colour, or a brand kit colour it is bound to. */
const IconColour = z
  .string()
  .regex(
    /^(#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?|brand:[a-z0-9]+(-[a-z0-9]+)*)$/,
    'a colour is #RRGGBB, #RRGGBBAA or a brand kit colour as brand:<token>, such as brand:primary',
  )
  .describe(
    'For an icon, the colour every shape of it is filled with: a hex colour such as #1A2B3C, or a brand kit colour as brand:<token> (the roles brand:primary, brand:secondary, brand:accent, brand:background and brand:text, or the kit’s own colours), which the shapes are bound to, so they follow the kit. For a shape (Coolshapes), an accent (dddoodle), a background (Pattern Monster, its pattern’s lines) or a Streamline Plump or Freehand object, the colour it is drawn in instead of its own, its lighter or darker tones following; left out, it keeps its own. Stickers and other artwork keep their own colours: leave it out',
  )

/** A background's backdrop: a colour, or none. */
const Backdrop = z
  .union([IconColour, z.literal('none')])
  .describe(
    'For a background, the colour behind its pattern, as colour takes it, or none so what is under the pattern shows; left out, the pattern’s own (white)',
  )

/** An illustration's accent: a hex colour, or a brand kit colour it is bound to. */
const Accent = z
  .string()
  .regex(
    /^(#[0-9a-fA-F]{6}|brand:[a-z0-9]+(-[a-z0-9]+)*)$/,
    'an accent is #RRGGBB or a brand kit colour as brand:<token>, such as brand:primary',
  )
  .describe(
    'For an illustration, the colour its set’s accent colour is swapped for wherever it paints with it, nothing else changing: a hex colour such as #E4572E, or a brand kit colour as brand:<token> (brand:primary, or the kit’s own colours), which the accent’s fills are bound to, so they follow the kit. Left out, the illustration keeps its own colours',
  )

/** Where a graphic goes. */
const GraphicBox = placeBox(
  'Where it goes, in design pixels from the frame’s top-left corner: the graphic fits inside the box with its shape kept, centred. Left out, an icon fits a square of a quarter of the frame’s shorter side and a sticker one of 40%, in the middle of the frame, an illustration fits 80% of the frame’s width and height, an object, 3D object, shape or accent a square of 40%, in the middle, and an effect or background the whole frame.',
)

export const GRAPHICS_TOOLS: Tool[] = [
  defineTool({
    name: 'search_graphics',
    title: 'Search graphics',
    description:
      'Searches the icons, stickers, illustrations and artwork Dazbee bundles, free to use in ads, each set’s licence listed on Dazbee’s notices page. Icons, drawn in one colour you choose: Tabler (outline and filled) and Phosphor (regular, thin, light, bold, fill and duotone). Stickers, placed in their own colours: Fluent Emoji (3d, a picture, and flat), Open Peeps and Open Doodles (hand-drawn people) and Humaaans (flat people). Illustrations, whole scenes of people and things (shopping, delivery, payments, food, travel, fitness, health, learning, work and teams, apps, celebrations), placed in their own colours or with their accent colour swapped: unDraw (flat, the largest), ManyPixels Chromablue (flat) and ManyPixels Birdview (isometric). Objects, colour drawings of things: Streamline Kameleon (flat, on a circle), Plump (rounded, two blues), Freehand (hand-drawn) and Stickies (playful, outlined). 3D objects, rendered pictures: 3dicons, each in four colour styles (color, gradient, clay, premium) from three angles (dynamic, front, iso). Shapes: Coolshapes (flowers, wheels, moons, polygons, blobs; white until given a colour). Hand-drawn accents: dddoodle (arrows, underlines, circles, boxes, scribbles). Effects, light and smoke pictures to lay over a photo: Kenney Particle Pack and Kenney Smoke Particles. Backgrounds, seamless patterns repeated over the frame: Pattern Monster. Give English words for the thing, such as “cart”, “rocket”, “person reading”, “arrow” or “waves”, and a kind to keep to one kind; it answers the best matches of each set in turn, each with its id for place_graphic, its kind, set, name, styles (the first is placed when none is asked for) and tags. Keep to one set and style in a design so its graphics look alike, and to one illustration set above all: set keeps a search to one set.',
    readOnly: true,
    input: z.object({
      query: z.string().trim().min(1).max(100).describe('Words for what the graphic shows, in English'),
      kind: z
        .enum(['icon', 'sticker', 'illustration', ...ARTWORK_KINDS])
        .optional()
        .describe('Only graphics of this kind; every kind when left out'),
      set: z.enum(GRAPHIC_SET_IDS).optional().describe('Only graphics of this set'),
      limit: z
        .number()
        .int()
        .min(1)
        .max(SEARCH_LIMIT.max)
        .optional()
        .describe(`How many graphics to answer at most; ${SEARCH_LIMIT.default} when left out`),
    }),
    run: async ({ query, kind, set, limit = SEARCH_LIMIT.default }) => {
      const found = searchGraphics(query, { limit, ...(kind ? { kind } : {}), ...(set ? { set } : {}) })
      if (found.length === 0)
        return `No ${kind ?? 'icon, sticker or illustration'} matches “${query}”; try another word for the thing, or a more general one (“cup” for “espresso”)`
      return {
        graphics: found.map(({ id, ...graphic }) => ({
          graphic: id,
          ...graphic,
          tags: graphic.tags.slice(0, TAGS_TOLD),
        })),
      }
    },
  }),
  defineTool({
    name: 'place_graphic',
    title: 'Place a graphic',
    description:
      'Places a graphic search_graphics found on a frame of the open design as one undo step, and answers once Dazbee has stored it: the new layer’s id and box, and the warnings for what it placed. An icon becomes a group of editable shapes, each filled with the colour given; a brand kit colour (brand:primary) binds them, so they follow the kit; lines of an outline style become filled shapes; it doesn’t join the brand’s asset library. A sticker keeps its own colours: a drawing becomes a group of editable layers, and a picture (Fluent Emoji’s 3d style) joins the brand’s asset library, once however often it is placed, and becomes an image, the answer naming its asset. An illustration becomes a group of editable layers in its own colours, or with its set’s accent colour swapped for the accent given, and joins the brand’s asset library as an SVG file, the answer naming its asset. Keep to one illustration set in a design. An object, a shape or an accent becomes editable layers in its own colours, or, for Coolshapes, dddoodle and Streamline Plump and Freehand, in the colour given; a 3D object or an effect becomes an image, an effect drawn light in the screen blend so its dark drops out over a photo, and by default over the whole frame; a background is its pattern repeated over the whole frame (or the box), its lines in the colour given and its backdrop in the backdrop given. Each joins the brand’s asset library, the answer naming its asset.',
    readOnly: false,
    input: z.object({
      frame: FrameId,
      graphic: z
        .string()
        .min(1)
        .max(200)
        .describe(
          'The graphic’s id, as search_graphics gives it, such as tabler/star, fluent-emoji/rocket or undraw/delivery',
        ),
      style: z
        .string()
        .min(1)
        .max(40)
        .optional()
        .describe('One of its styles, as search_graphics lists them; its first when left out'),
      colour: IconColour.optional(),
      accent: Accent.optional(),
      backdrop: Backdrop.optional(),
      box: GraphicBox.optional(),
      note: Note,
    }),
    run: ({ frame, graphic, style, colour, accent, backdrop, box, note }, context) =>
      writing(context, [], async (open) => {
        const into = { id: frame, frame: frameIn(open, frame) }
        const found = findGraphic(graphic)
        if (!found)
          throw new ToolRefusal(
            `Dazbee has no icon, sticker or illustration “${graphic}”; search_graphics finds them and their ids`,
          )
        const what = { name: nameOf(found.name), style: styleOf(found, style) }
        const noted = (value: unknown, notes: (string | false)[]) =>
          notes.reduce((answer, note) => (note ? withNote(answer, note) : answer), value)
        if (isArtwork(found)) {
          const share = ARTWORK_SHARE[found.kind]
          const where = box ?? (share === 'frame' ? whole(into.frame) : middleOf(into.frame, share))
          const colours: ArtworkColours = {
            ...(colour === undefined ? {} : { colour: await fillOf(context, open, colour) }),
            ...(backdrop === undefined
              ? {}
              : { backdrop: backdrop === 'none' ? null : await fillOf(context, open, backdrop) }),
          }
          const placing = await artworkPlacing(context, open, into, { artwork: found, ...what }, where, colours)
          const value = await placeAndAnswer(context, open, placing, note)
          return noted(value, [
            placing.colourUnused && ARTWORK_COLOUR_UNUSED,
            accent !== undefined && ACCENT_UNUSED.artwork,
          ])
        }
        if (found.kind === 'illustration') {
          const where = box ?? insideOf(into.frame, ILLUSTRATION_SHARE)
          const fill = accent === undefined ? undefined : await fillOf(context, open, accent)
          const placing = await illustrationPlacing(context, open, into, { illustration: found, ...what }, where, fill)
          const value = await placeAndAnswer(context, open, placing, note)
          return noted(value, [
            colour !== undefined && COLOUR_UNUSED.illustration,
            placing.accentUnused && ACCENT_UNUSED.illustration,
          ])
        }
        const where = box ?? middleOf(into.frame, SHARE[found.kind])
        if (found.kind === 'sticker') {
          const placing = await stickerPlacing(context, open, into, { sticker: found, ...what }, where)
          const value = await placeAndAnswer(context, open, placing, note)
          return noted(value, [
            colour !== undefined && COLOUR_UNUSED.sticker,
            accent !== undefined && ACCENT_UNUSED.sticker,
          ])
        }
        if (colour === undefined)
          throw new ToolRefusal('An icon is placed in a colour: give colour, such as brand:primary or #1A2B3C')
        const fill = await fillOf(context, open, colour)
        const value = await placeAndAnswer(
          context,
          open,
          await iconPlacing(into, { icon: found, ...what }, fill, where),
          note,
        )
        return noted(value, [accent !== undefined && ACCENT_UNUSED.icon])
      }),
  }),
]

/** Whether a graphic is an artwork set's. */
function isArtwork(graphic: FoundGraphic): graphic is FoundArtwork {
  return (ARTWORK_KINDS as readonly string[]).includes(graphic.kind)
}

/** An icon's or sticker's name as its layer is named: `shopping-cart` as “Shopping cart”. */
function nameOf(name: string): string {
  const words = name.replaceAll('-', ' ')
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`
}

/** The style asked for, or the graphic's first; refused when the graphic isn't drawn in it. */
function styleOf(graphic: FoundGraphic, style: string | undefined): string {
  const drawn = style ?? graphic.styles[0] ?? ''
  if (!graphic.styles.includes(drawn))
    throw new ToolRefusal(`“${graphic.id}” is drawn in ${graphic.styles.join(', ')}, not “${drawn}”`)
  return drawn
}

/** A box of `share` of the frame's width and height, in the middle of the frame. */
function insideOf({ width, height }: Frame, share: number): Rect {
  return { x: (width * (1 - share)) / 2, y: (height * (1 - share)) / 2, width: width * share, height: height * share }
}

/** A square of `share` of the frame's shorter side, in the middle of the frame. */
function middleOf({ width, height }: Frame, share: number): Rect {
  const side = Math.min(width, height) * share
  return { x: (width - side) / 2, y: (height - side) / 2, width: side, height: side }
}

/** The colour given as #RRGGBBAA, or the brand kit colour it names, bound; refused when the kit has no such colour. */
async function fillOf({ api }: ToolContext, open: OpenDesign, colour: string): Promise<ColourFill> {
  if (colour.startsWith('#')) return { value: (colour.length === 7 ? `${colour}FF` : colour).toUpperCase() }
  const token = colour.slice('brand:'.length)
  const { colors } = await api.brandKit(open.brandId)
  const entry = colors.find((each) => each.token === token)
  if (!entry) {
    const has = colors.map((each) => `brand:${each.token}`).join(', ')
    throw new ToolRefusal(
      `The brand kit has no colour ${colour}; ${has ? `it has ${has}` : 'it has no colours'}, or give a hex colour such as #1A2B3C`,
    )
  }
  return { value: entry.value, ref: `brand:${token}` }
}

/**
 * The batch that places the icon: its layers fitted inside `where` and centred in it, every graphic filled with the
 * colour, then bound to the kit's token when it is one.
 */
async function iconPlacing(
  { id: frameId, frame }: FrameTo,
  { icon, style, name }: { icon: Extract<FoundGraphic, { kind: 'icon' }>; style: string; name: string },
  fill: ColourFill,
  where: Rect,
): Promise<Placing> {
  const ck = await loadCanvasKit()
  const size = Math.min(where.width, where.height)
  const svg = iconSvg(ck, icon.set, icon.name, style, { colour: fill.value, size })
  const read = await svgLayers(ck, svg, { name, frame, box: where })
  const input = svgPlaceInput(read, frameId, centreOf(where))
  if (!input) throw new ToolRefusal(`The icon “${icon.id}” draws nothing in ${style}, so nothing was placed`)
  const graphics = Object.entries(read.tree.nodes).flatMap(([key, node]) => (node.type === 'graphic' ? [key] : []))
  const ids = graphics.map((key) => ({ $ref: 'placed', field: `ids/${key}` }))
  return {
    steps: [
      { command: 'design.place', as: 'placed', input: { ...input, withIds: true } },
      ...(fill.ref && ids.length > 0
        ? [{ command: 'node.bind', input: { ids, property: 'fill', ref: fill.ref, value: fill.value } }]
        : []),
    ],
    layerOf: (result) => placedRoots(result as Parameters<typeof placedRoots>[0])[0] ?? '',
    told: fill.ref ? { bound: fill.ref } : {},
  }
}
