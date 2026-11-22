// The batch that places a bundled sticker on a frame: a drawing as the layers the SVG reader makes of it, and a
// picture as an image, after the API adds the picture Dazbee keeps in its storage to the brand's asset library, once
// for the same bytes; this server never holds the picture's file.
import { placedImage } from '@dazbee/editor/placed-asset'
import { type FoundGraphic, STICKER_SETS, stickerFile } from '@dazbee/graphics'
import type { Rect } from '@dazbee/schema'

import type { OpenDesign } from '../open-design.ts'
import type { ToolContext } from './define-tool.ts'
import { bundledAsset, fitted, type FrameTo, type Placing, svgSteps } from './place-on-frame.ts'

/** A sticker as a search finds it. */
type FoundSticker = Extract<FoundGraphic, { kind: 'sticker' }>

/**
 * The batch that places the sticker in `style` fitted inside `where`, its shape kept, centred: a drawing's layers,
 * named `name`, or a picture's image, the picture first added to the brand's asset library named by `name` and its
 * set ("Rocket · Fluent Emoji") and tagged `sticker` and the set's name; a brand that has the picture already gets
 * back the asset it has.
 */
export async function stickerPlacing(
  context: ToolContext,
  open: OpenDesign,
  into: FrameTo,
  { sticker, style, name }: { sticker: FoundSticker; style: string; name: string },
  where: Rect,
): Promise<Placing> {
  const file = stickerFile(sticker.set, sticker.name, style)
  if (file.format === 'drawing') return svgSteps(into, name, file.svg, where)
  const { title, styles } = STICKER_SETS[sticker.set]
  const input = { sha256: file.sha256, name: `${name} · ${title}`, tags: ['sticker', title.toLowerCase()] }
  const drawn = styles.find(({ format }) => format === 'drawing')
  const notStored = `The ${style} picture of “${sticker.id}” isn’t in Dazbee’s storage yet, so nothing was placed${drawn ? `; place its ${drawn.name} style instead` : ''}`
  const asset = await bundledAsset(context, open, input, notStored)
  const layer = placedImage(asset, into.frame, fitted(where, asset))
  return {
    steps: [{ command: 'node.create', input: { parentId: into.id, layer } }],
    layerOf: String,
    told: { asset: { id: asset.id, name: asset.name } },
  }
}
