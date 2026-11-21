// The tool that places a brand's asset on a frame of the open design, as the editor places it: an image as a graphic
// filled with it, the kit's logo bound to brand:logo, and an SVG file as the layers the editor's SVG reader makes of
// it, as one agent batch with its warnings.
import { z } from 'zod'

import { type AgentStep, placedRoots } from '@dazbee/doc'
import { logoBinding, placedImage, SvgError, svgLayers, svgPlaceInput } from '@dazbee/editor/placed-asset'
import { loadCanvasKit } from '@dazbee/renderer/node'
import { type AssetSummary, type Frame, isVectorAsset, RecordId, type Rect } from '@dazbee/schema'

import { ApiRefusal } from '../api.ts'
import type { OpenDesign } from '../open-design.ts'
import { agentBatchOn, answered, Note, refusalOf, writing } from './command-tools.ts'
import { defineTool, type Tool, type ToolContext, ToolRefusal, WithNotes } from './define-tool.ts'
import { FrameId } from './design-tools.ts'
import { centreOf, frameIn, placeBox, whole } from './place-on-frame.ts'

/** The agent batch that places an asset, and how its answer reads the layer placed from the first step's result. */
interface PlaceBatch {
  steps: AgentStep[]
  layerOf: (result: unknown) => string
  /** The token the layer's picture is bound to, if any. */
  bound?: string
  /** What an SVG file had that no layer shows. */
  leftOut: readonly string[]
}

/** The frame an asset goes in: its id and its record. */
interface FrameTo {
  id: string
  frame: Frame
}

/** The name a logo placed takes, as the editor names it in English. */
const LOGO_NAME = 'Logo'
/** What an agent is told when an SVG file's embedded pictures are left out. */
const PICTURES_LEFT_OUT =
  'The SVG file’s embedded pictures are left out, since an agent can’t add them to the asset library; a person who places the file in the editor keeps them.'
/** Where an asset goes. */
const PlaceBox = placeBox(
  'Where it goes, in design pixels from the frame’s top-left corner: an image covers the box, an SVG file fits inside it with its shape kept, centred. Left out, it goes in the middle of the frame: an image at its own size or at most half the frame’s width and height, an SVG file at its own size or at most 60% of the frame’s shorter side.',
)

export const ASSET_TOOLS: Tool[] = [
  defineTool({
    name: 'place_asset',
    title: 'Place an image or SVG',
    description:
      'Places one of the brand’s images or SVG files (list_assets gives their ids) on a frame of the open design as one undo step, and answers once Dazbee has stored it: the new layer’s id and box, and the warnings for what it placed. An image becomes a graphic filled with it; an SVG file becomes a group of editable layers, as the editor makes of it. The brand kit’s logo, when an image, is placed bound to brand:logo, so it follows the kit.',
    readOnly: false,
    input: z.object({
      frame: FrameId,
      asset: RecordId.describe('The image’s or SVG file’s id, as list_assets gives it'),
      box: PlaceBox.optional(),
      note: Note,
    }),
    run: ({ frame, asset, box, note }, context) =>
      writing(context, [], async (open) => {
        const into = { id: frame, frame: frameIn(open, frame) }
        const stored = await assetOf(context, open, asset)
        const placing = isVectorAsset(stored.summary)
          ? await svgSteps(into, stored.summary.name, await stored.bytes(), box)
          : await imageSteps(context, open, into, stored.summary, box)
        const done = await agentBatchOn(open, placing.steps, context.answerBy, note)
        const { kept, steps, warnings, warningsError } = done.value
        const [first] = steps
        if (!kept || !first?.ok) throw new ToolRefusal(refusalOf(steps.find((step) => !step.ok)))
        const layer = placing.layerOf(first.result)
        const props = open.tab.design().nodes[layer]?.props
        const value = answered(open, done, {
          layer,
          ...(props ? { box: { x: props.x, y: props.y, width: props.width, height: props.height } } : {}),
          ...(placing.bound ? { bound: placing.bound } : {}),
          ...(placing.leftOut.length > 0 ? { leftOut: placing.leftOut } : {}),
          warnings,
          ...(warningsError === undefined ? {} : { warningsError }),
        })
        return placing.leftOut.includes('image') ? withNote(value, PICTURES_LEFT_OUT) : value
      }),
  }),
]

/** The brand's asset, refused when the brand has none of that id. */
async function assetOf({ api }: ToolContext, open: OpenDesign, assetId: string) {
  try {
    return await api.asset(open.brandId, assetId)
  } catch (error) {
    if (error instanceof ApiRefusal && error.status === 404)
      throw new ToolRefusal(`The brand has no image or SVG file “${assetId}”; list_assets lists them`)
    throw error
  }
}

/**
 * The SVG file's step: the layers the editor makes of it, its pictures left out, fitted inside `box` and centred in
 * it, or in the middle of the frame, scaled down as the editor scales it.
 */
async function svgSteps(
  { id: frameId, frame }: FrameTo,
  name: string,
  bytes: Uint8Array,
  box: Rect | undefined,
): Promise<PlaceBatch> {
  // Read as the editor reads the file the web app fetched: UTF-8, its bad bytes replaced.
  const text = new TextDecoder().decode(bytes)
  let read
  try {
    read = await svgLayers(await loadCanvasKit(), text, { name: name || 'SVG', frame, ...(box ? { box } : {}) })
  } catch (error) {
    if (!(error instanceof SvgError)) throw error
    throw new ToolRefusal(`The SVG file “${name}” can’t be read as layers (${error.problem}), so nothing was placed`)
  }
  const input = svgPlaceInput(read, frameId, centreOf(box ?? whole(frame)))
  if (!input) throw new ToolRefusal(`The SVG file “${name}” draws nothing, so nothing was placed`)
  return {
    steps: [{ command: 'design.place', input }],
    layerOf: (result) => placedRoots(result as Parameters<typeof placedRoots>[0])[0] ?? '',
    leftOut: read.leftOut,
  }
}

/**
 * The image's steps: a graphic filled with it, covering `box` or in the middle of the frame; the kit's logo named
 * so, given the logo's role and bound to brand:logo, as the editor places the kit's logo.
 */
async function imageSteps(
  { api }: ToolContext,
  open: OpenDesign,
  { id: frameId, frame }: FrameTo,
  asset: AssetSummary,
  box: Rect | undefined,
): Promise<PlaceBatch> {
  // The kit as it is now: its logo may have changed since the design was opened.
  const logo = (await api.brandKit(open.brandId)).logoAssetId === asset.id
  const where = box ?? centreOf(whole(frame))
  const layer = placedImage(asset, frame, where, logo ? { logo: { name: LOGO_NAME } } : {})
  const binding = logo ? logoBinding(asset.id) : null
  return {
    steps: [
      { command: 'node.create', as: 'image', input: { parentId: frameId, layer } },
      ...(binding ? [{ command: 'node.bind', input: { ids: [{ $ref: 'image' }], ...binding } }] : []),
    ],
    layerOf: String,
    ...(binding ? { bound: binding.ref } : {}),
    leftOut: [],
  }
}

/** `value`, told with `note` after the notes it has. */
function withNote(value: unknown, note: string): WithNotes {
  return value instanceof WithNotes ? new WithNotes(value.value, [...value.notes, note]) : new WithNotes(value, [note])
}
