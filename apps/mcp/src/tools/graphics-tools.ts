// The tools for the graphics Dazbee bundles: search_graphics finds icons and stickers by words, and place_graphic
// places one on a frame of the open design as one agent batch with its warnings: an icon as the layers the SVG reader
// makes of it, every shape filled with a colour or bound to a brand kit colour, which doesn't join the asset library;
// a sticker as it is drawn, a drawing as layers and a picture as an image, which joins the asset library.
import { z } from 'zod'

import { placedRoots } from '@dazbee/doc'
import { svgLayers, svgPlaceInput } from '@dazbee/editor/placed-asset'
import { findGraphic, type FoundGraphic, GRAPHIC_SET_IDS, iconSvg, searchGraphics } from '@dazbee/graphics'
import { loadCanvasKit } from '@dazbee/renderer/node'
import type { Frame, Rect } from '@dazbee/schema'

import type { OpenDesign } from '../open-design.ts'
import { Note, writing } from './command-tools.ts'
import { defineTool, type Tool, type ToolContext, ToolRefusal, withNote } from './define-tool.ts'
import { FrameId } from './design-tools.ts'
import { centreOf, frameIn, type FrameTo, placeAndAnswer, placeBox, type Placing } from './place-on-frame.ts'
import { stickerPlacing } from './sticker-placing.ts'

/** The colour an icon's shapes are filled with, and the brand kit token they are bound to, if any. */
interface IconFill {
  value: string
  ref?: `brand:${string}`
}

/** How many graphics a search gives when no limit is asked for, and at most. */
const SEARCH_LIMIT = { default: 20, max: 50 } as const
/** How many of a graphic's tags a search tells. */
const TAGS_TOLD = 8
/** The share of the frame's shorter side taken by the square an icon, or a sticker, placed with no box fits in. */
const SHARE = { icon: 0.25, sticker: 0.4 } as const
/** What an agent is told when it gives a sticker a colour. */
const COLOUR_UNUSED = 'A sticker keeps the colours it is drawn in, so the colour given was left unused.'

/** An icon's colour: a hex colour, or a brand kit colour it is bound to. */
const IconColour = z
  .string()
  .regex(
    /^(#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?|brand:[a-z0-9]+(-[a-z0-9]+)*)$/,
    'a colour is #RRGGBB, #RRGGBBAA or a brand kit colour as brand:<token>, such as brand:primary',
  )
  .describe(
    'For an icon, the colour every shape of it is filled with: a hex colour such as #1A2B3C, or a brand kit colour as brand:<token> (the roles brand:primary, brand:secondary, brand:accent, brand:background and brand:text, or the kit’s own colours), which the shapes are bound to, so they follow the kit. A sticker keeps its own colours: leave it out',
  )

/** Where a graphic goes. */
const GraphicBox = placeBox(
  'Where it goes, in design pixels from the frame’s top-left corner: the graphic fits inside the box with its shape kept, centred. Left out, it fits a square in the middle of the frame, a quarter of the frame’s shorter side for an icon and 40% for a sticker.',
)

export const GRAPHICS_TOOLS: Tool[] = [
  defineTool({
    name: 'search_graphics',
    title: 'Search icons and stickers',
    description:
      'Searches the icons and stickers Dazbee bundles, free to use in any ad with no credit. Icons, drawn in one colour you choose: Tabler (outline and filled) and Phosphor (regular, thin, light, bold, fill and duotone). Stickers, placed in their own colours: Fluent Emoji (3d, a picture, and flat), Open Peeps and Open Doodles (hand-drawn people) and Humaaans (flat people). Give English words for the thing, such as “cart”, “rocket” or “person reading”, and a kind to keep to icons or stickers; it answers the best matches of each set in turn, each with its id for place_graphic, its kind, set, name, styles (the first is placed when none is asked for) and tags. Keep to one set and style in a design so its graphics look alike.',
    readOnly: true,
    input: z.object({
      query: z.string().trim().min(1).max(100).describe('Words for what the graphic shows, in English'),
      kind: z.enum(['icon', 'sticker']).optional().describe('Only icons, or only stickers; both when left out'),
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
        return `No ${kind ?? 'icon or sticker'} matches “${query}”; try another word for the thing, or a more general one (“cup” for “espresso”)`
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
    title: 'Place an icon or a sticker',
    description:
      'Places an icon or a sticker search_graphics found on a frame of the open design as one undo step, and answers once Dazbee has stored it: the new layer’s id and box, and the warnings for what it placed. An icon becomes a group of editable shapes, each filled with the colour given; a brand kit colour (brand:primary) binds them, so they follow the kit; lines of an outline style become filled shapes; it doesn’t join the brand’s asset library. A sticker keeps its own colours: a drawing becomes a group of editable layers, and a picture (Fluent Emoji’s 3d style) joins the brand’s asset library, once however often it is placed, and becomes an image, the answer naming its asset.',
    readOnly: false,
    input: z.object({
      frame: FrameId,
      graphic: z
        .string()
        .min(1)
        .max(200)
        .describe(
          'The icon’s or sticker’s id, as search_graphics gives it, such as tabler/star or fluent-emoji/rocket',
        ),
      style: z
        .string()
        .min(1)
        .max(40)
        .optional()
        .describe('One of its styles, as search_graphics lists them; its first when left out'),
      colour: IconColour.optional(),
      box: GraphicBox.optional(),
      note: Note,
    }),
    run: ({ frame, graphic, style, colour, box, note }, context) =>
      writing(context, [], async (open) => {
        const into = { id: frame, frame: frameIn(open, frame) }
        const found = findGraphic(graphic)
        if (!found)
          throw new ToolRefusal(
            `Dazbee has no icon or sticker “${graphic}”; search_graphics finds icons and stickers and their ids`,
          )
        const what = { name: nameOf(found.name), style: styleOf(found, style) }
        const where = box ?? middleOf(into.frame, SHARE[found.kind])
        if (found.kind === 'sticker') {
          const placing = await stickerPlacing(context, open, into, { sticker: found, ...what }, where)
          const value = await placeAndAnswer(context, open, placing, note)
          return colour === undefined ? value : withNote(value, COLOUR_UNUSED)
        }
        if (colour === undefined)
          throw new ToolRefusal('An icon is placed in a colour: give colour, such as brand:primary or #1A2B3C')
        const fill = await fillOf(context, open, colour)
        return placeAndAnswer(context, open, await iconPlacing(into, { icon: found, ...what }, fill, where), note)
      }),
  }),
]

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

/** A square of `share` of the frame's shorter side, in the middle of the frame. */
function middleOf({ width, height }: Frame, share: number): Rect {
  const side = Math.min(width, height) * share
  return { x: (width - side) / 2, y: (height - side) / 2, width: side, height: side }
}

/** The colour given as #RRGGBBAA, or the brand kit colour it names, bound; refused when the kit has no such colour. */
async function fillOf({ api }: ToolContext, open: OpenDesign, colour: string): Promise<IconFill> {
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
  fill: IconFill,
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
