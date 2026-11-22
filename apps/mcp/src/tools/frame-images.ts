// The images frames of the open design draw, read from the API for one render or one design check alone: the agent
// tab keeps none.
import { type Design, imageAssetIds } from '@dazbee/schema'

import { inMiB, MAX_RENDER_IMAGE_BYTES, MAX_RENDER_IMAGE_PIXELS } from '../limits.ts'
import type { OpenDesign } from '../open-design.ts'
import { decodedPixels } from '../render-queue.ts'
import { ToolRefusal } from './define-tool.ts'

/**
 * The encoded images `frameIds` of `design` draw, by asset id, the brand kit's bound ones included. Refused when one
 * can't be read, or when they pass what one render may send or decode.
 */
export async function frameImages(
  { tab, imageBytes }: OpenDesign,
  design: Design,
  frameIds: readonly string[],
): Promise<Record<string, Uint8Array>> {
  const images: Record<string, Uint8Array> = {}
  let bytes = 0
  for (const id of imageAssetIds(design, frameIds, tab.bytes().variables)) {
    const image = await imageBytes(id).catch(() => {
      throw new ToolRefusal(`The frame’s image ${id} could not be read; try again in a moment`)
    })
    bytes += image.length
    if (bytes > MAX_RENDER_IMAGE_BYTES)
      throw new ToolRefusal(`The frame’s images are more than the ${inMiB(MAX_RENDER_IMAGE_BYTES)} a render may draw`)
    images[id] = image
  }
  if (decodedPixels(images) > MAX_RENDER_IMAGE_PIXELS)
    throw new ToolRefusal(
      `The frame’s images are more than the ${MAX_RENDER_IMAGE_PIXELS / 1_000_000} million pixels a render may draw`,
    )
  return images
}
