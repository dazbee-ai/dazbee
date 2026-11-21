// The tools for the graphics Dazbee bundles: search_graphics finds icons by words, and place_graphic places one on
// a frame of the open design as the layers the SVG reader makes of it, every shape filled with a colour or bound to a
// brand kit colour, as one agent batch with its warnings. An icon placed doesn't join the asset library.
import { z } from 'zod'

import { type AgentStep, placedRoots } from '@dazbee/doc'
import { svgLayers, svgPlaceInput } from '@dazbee/editor/placed-asset'
import { findIcon, type FoundIcon, ICON_SET_IDS, iconSvg, searchIcons } from '@dazbee/graphics'
import { loadCanvasKit } from '@dazbee/renderer/node'
import type { Frame, Rect } from '@dazbee/schema'

import type { OpenDesign } from '../open-design.ts'
import { agentBatchOn, answered, Note, refusalOf, writing } from './command-tools.ts'
import { defineTool, type Tool, type ToolContext, ToolRefusal } from './define-tool.ts'
import { FrameId } from './design-tools.ts'
import { centreOf, frameIn, placeBox } from './place-on-frame.ts'

/** The colour an icon's shapes are filled with, and the brand kit token they are bound to, if any. */
interface IconFill {
  value: string
  ref?: `brand:${string}`
}

/** How many icons a search gives when no limit is asked for, and at most. */
const SEARCH_LIMIT = { default: 20, max: 50 } as const
/** How many of an icon's tags a search tells. */
const TAGS_TOLD = 8
/** The share of the frame's shorter side an icon placed with no box takes. */
const ICON_SHARE = 0.25

/** An icon's colour: a hex colour, or a brand kit colour it is bound to. */
const IconColour = z
  .string()
  .regex(
    /^(#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?|brand:[a-z0-9]+(-[a-z0-9]+)*)$/,
    'a colour is #RRGGBB, #RRGGBBAA or a brand kit colour as brand:<token>, such as brand:primary',
  )
  .describe(
    'The colour every shape of the icon is filled with: a hex colour such as #1A2B3C, or a brand kit colour as brand:<token> (the roles brand:primary, brand:secondary, brand:accent, brand:background and brand:text, or the kit’s own colours), which the shapes are bound to, so they follow the kit',
  )

/** Where an icon goes. */
const IconBox = placeBox(
  'Where it goes, in design pixels from the frame’s top-left corner: the icon fits inside the box with its shape kept, centred. Left out, it is a quarter of the frame’s shorter side, in the middle of the frame.',
)

export const GRAPHICS_TOOLS: Tool[] = [
  defineTool({
    name: 'search_graphics',
    title: 'Search icons',
    description:
      'Searches the icons Dazbee bundles, free to use in any ad with no credit: Tabler (outline and filled) and Phosphor (regular, thin, light, bold, fill and duotone). Give English words for the thing, such as “cart”, “star” or “arrow right”; it answers the best matches of both sets in turn, each with its id for place_graphic, its set, name, styles (the first is placed when none is asked for) and tags. Keep to one set and style in a design so its icons look alike.',
    readOnly: true,
    input: z.object({
      query: z.string().trim().min(1).max(100).describe('Words for what the icon shows, in English'),
      kind: z.enum(['icon']).optional().describe('The kind of graphic: icon, the only kind for now'),
      set: z.enum(ICON_SET_IDS).optional().describe('Only icons of this set'),
      limit: z
        .number()
        .int()
        .min(1)
        .max(SEARCH_LIMIT.max)
        .optional()
        .describe(`How many icons to answer at most; ${SEARCH_LIMIT.default} when left out`),
    }),
    run: async ({ query, set, limit = SEARCH_LIMIT.default }) => {
      const icons = searchIcons(query, { limit, ...(set ? { set } : {}) })
      if (icons.length === 0)
        return `No icon matches “${query}”; try another word for the thing, or a more general one (“cup” for “espresso”)`
      return { icons: icons.map((icon) => ({ ...icon, kind: 'icon', tags: icon.tags.slice(0, TAGS_TOLD) })) }
    },
  }),
  defineTool({
    name: 'place_graphic',
    title: 'Place an icon',
    description:
      'Places an icon search_graphics found on a frame of the open design as one undo step, and answers once Dazbee has stored it: the new group’s id and box, and the warnings for what it placed. The icon becomes a group of editable shapes, each filled with the colour given; a brand kit colour (brand:primary) binds them, so they follow the kit. Lines of an outline style become filled shapes. The icon doesn’t join the brand’s asset library.',
    readOnly: false,
    input: z.object({
      frame: FrameId,
      graphic: z.string().min(1).max(200).describe('The icon’s id, as search_graphics gives it, such as tabler/star'),
      style: z
        .string()
        .min(1)
        .max(40)
        .optional()
        .describe('One of the icon’s styles, as search_graphics lists them; its first when left out'),
      colour: IconColour,
      box: IconBox.optional(),
      note: Note,
    }),
    run: ({ frame, graphic, style, colour, box, note }, context) =>
      writing(context, [], async (open) => {
        const into = frameIn(open, frame)
        const icon = findIcon(graphic)
        if (!icon) throw new ToolRefusal(`Dazbee has no icon “${graphic}”; search_graphics finds icons and their ids`)
        const drawn = styleOf(icon, style)
        const fill = await fillOf(context, open, colour)
        const where = box ?? middleOf(into)
        const steps = await iconSteps(open, { id: frame, frame: into }, icon, drawn, fill, where)
        const done = await agentBatchOn(open, steps, context.answerBy, note)
        const { kept, steps: outcomes, warnings, warningsError } = done.value
        const [first] = outcomes
        if (!kept || !first?.ok) throw new ToolRefusal(refusalOf(outcomes.find((step) => !step.ok)))
        const layer = placedRoots(first.result as Parameters<typeof placedRoots>[0])[0] ?? ''
        const props = open.tab.design().nodes[layer]?.props
        return answered(open, done, {
          layer,
          ...(props ? { box: { x: props.x, y: props.y, width: props.width, height: props.height } } : {}),
          ...(fill.ref ? { bound: fill.ref } : {}),
          warnings,
          ...(warningsError === undefined ? {} : { warningsError }),
        })
      }),
  }),
]

/** The style asked for, or the icon's first; refused when the icon isn't drawn in it. */
function styleOf(icon: FoundIcon, style: string | undefined): string {
  const drawn = style ?? icon.styles[0] ?? ''
  if (!icon.styles.includes(drawn))
    throw new ToolRefusal(`“${icon.graphic}” is drawn in ${icon.styles.join(', ')}, not “${drawn}”`)
  return drawn
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

/** A square a quarter of the frame's shorter side, in the middle of the frame. */
function middleOf({ width, height }: Frame): Rect {
  const side = Math.min(width, height) * ICON_SHARE
  return { x: (width - side) / 2, y: (height - side) / 2, width: side, height: side }
}

/**
 * The icon's steps: its layers placed fitted inside `where` and centred in it, every graphic filled with the colour,
 * then bound to the kit's token when it is one.
 */
async function iconSteps(
  open: OpenDesign,
  { id: frameId, frame }: { id: string; frame: Frame },
  icon: FoundIcon,
  style: string,
  fill: IconFill,
  where: Rect,
): Promise<AgentStep[]> {
  const ck = await loadCanvasKit()
  const size = Math.min(where.width, where.height)
  const svg = iconSvg(ck, icon.set, icon.name, style, { colour: fill.value, size })
  const read = await svgLayers(ck, svg, { name: nameOf(icon.name), frame, box: where })
  const input = svgPlaceInput(read, frameId, centreOf(where))
  if (!input) throw new ToolRefusal(`The icon “${icon.graphic}” draws nothing in ${style}, so nothing was placed`)
  const graphics = Object.entries(read.tree.nodes).flatMap(([key, node]) => (node.type === 'graphic' ? [key] : []))
  const ids = graphics.map((key) => ({ $ref: 'placed', field: `ids/${key}` }))
  return [
    { command: 'design.place', as: 'placed', input: { ...input, withIds: true } },
    ...(fill.ref && ids.length > 0
      ? [{ command: 'node.bind', input: { ids, property: 'fill', ref: fill.ref, value: fill.value } }]
      : []),
  ]
}

/** An icon's name as its group is named: `shopping-cart` as “Shopping cart”. */
function nameOf(name: string): string {
  const words = name.replaceAll('-', ' ')
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`
}
