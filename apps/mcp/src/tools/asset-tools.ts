// The tool that places a brand's asset on a frame of the open design, as the editor places it: an image as a graphic
// filled with it, the kit's logo bound to brand:logo, and an SVG file as the layers the editor's SVG reader makes of
// it, as one agent batch with its warnings.
import { z } from 'zod'

import { logoBinding, placedImage } from '@dazbee/editor/placed-asset'
import { type AssetSummary, isVectorAsset, RecordId, type Rect } from '@dazbee/schema'

import { ApiRefusal } from '../api.ts'
import type { OpenDesign } from '../open-design.ts'
import { Note, writing } from './command-tools.ts'
import { defineTool, type Tool, type ToolContext, ToolRefusal, withNote } from './define-tool.ts'
import { FrameId } from './design-tools.ts'
import {
  type AssetPlacing,
  centreOf,
  frameIn,
  type FrameTo,
  placeAndAnswer,
  placeBox,
  svgSteps,
  textOf,
  whole,
} from './place-on-frame.ts'

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
          ? await svgSteps(into, stored.summary.name, textOf(await stored.bytes()), box)
          : await imageSteps(context, open, into, stored.summary, box)
        const value = await placeAndAnswer(context, open, placing, note)
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
 * The image's steps: a graphic filled with it, covering `box` or in the middle of the frame; the kit's logo named
 * so, given the logo's role and bound to brand:logo, as the editor places the kit's logo.
 */
async function imageSteps(
  { api }: ToolContext,
  open: OpenDesign,
  { id: frameId, frame }: FrameTo,
  asset: AssetSummary,
  box: Rect | undefined,
): Promise<AssetPlacing> {
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
    told: binding ? { bound: binding.ref } : {},
    leftOut: [],
  }
}
