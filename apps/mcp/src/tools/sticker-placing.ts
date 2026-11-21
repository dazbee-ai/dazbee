// The batch that places a bundled sticker on a frame: a drawing as the layers the SVG reader makes of it, and a
// picture as an image, after it joins the brand's asset library through the upload path, once for the same bytes.
import { placedImage } from '@dazbee/editor/placed-asset'
import { type FoundGraphic, STICKER_SETS, stickerFile } from '@dazbee/graphics'
import type { AssetSummary, Rect } from '@dazbee/schema'

import type { OpenDesign } from '../open-design.ts'
import type { ToolContext } from './define-tool.ts'
import { type FrameTo, type Placing, svgSteps } from './place-on-frame.ts'

/** A sticker as a search finds it. */
type FoundSticker = Extract<FoundGraphic, { kind: 'sticker' }>

/**
 * The batch that places the sticker in `style` fitted inside `where`, its shape kept, centred: a drawing's layers,
 * named `name`, or a picture's image, the picture first added to the brand's asset library named by `name` and its
 * set ("Rocket · Fluent Emoji"), which gives back the asset it already has for the same bytes.
 */
export async function stickerPlacing(
  { api }: ToolContext,
  open: OpenDesign,
  into: FrameTo,
  { sticker, style, name }: { sticker: FoundSticker; style: string; name: string },
  where: Rect,
): Promise<Placing> {
  const file = stickerFile(sticker.set, sticker.name, style)
  if (file.format === 'drawing') return svgSteps(into, name, file.svg, where)
  const named = `${name} · ${STICKER_SETS[sticker.set].title}`
  const asset = await api.addAsset(open.brandId, { bytes: file.png, contentType: 'image/png', name: named })
  const layer = placedImage(asset, into.frame, fitted(where, asset))
  return {
    steps: [{ command: 'node.create', input: { parentId: into.id, layer } }],
    layerOf: String,
    told: { asset: { id: asset.id, name: asset.name } },
  }
}

/** The largest box of the asset's shape that fits inside `where`, centred in it. */
function fitted(where: Rect, { width, height }: Pick<AssetSummary, 'width' | 'height'>): Rect {
  const scale = Math.min(where.width / width, where.height / height)
  const size = { width: width * scale, height: height * scale }
  return { x: where.x + (where.width - size.width) / 2, y: where.y + (where.height - size.height) / 2, ...size }
}
