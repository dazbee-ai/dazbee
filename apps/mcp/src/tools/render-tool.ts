// render_frame: an agent looks at a frame of the open design, an agent render drawn on the render worker from what
// the session's agent tab holds, with the frame's images read for that render only.
import { z } from 'zod'

import { AGENT_RENDER_MAX_SIZE, AGENT_RENDER_SIZES } from '@dazbee/export'
import { loadFontFiles } from '@dazbee/fonts/node'
import { fontFamilies, imageAssetIds } from '@dazbee/schema'

import { inMiB, MAX_RENDER_IMAGE_BYTES, MAX_RENDER_IMAGE_PIXELS, RENDER_MS_PER_RENDER } from '../limits.ts'
import type { OpenDesign } from '../open-design.ts'
import { decodedPixels, type FrameRender } from '../render-queue.ts'
import { defineTool, type Tool, ToolRefusal, WithPicture } from './define-tool.ts'
import { FrameId, frameOf, onDesign } from './design-tools.ts'

const [LEAST_SIZE, MOST_SIZE] = AGENT_RENDER_SIZES

export const RENDER_TOOLS: Tool[] = [
  defineTool({
    name: 'render_frame',
    title: 'Render a frame',
    description: `Draws a frame of the open design as a PNG to look at, as it exports: its longer side fitted to \`maxSize\` pixels (${AGENT_RENDER_MAX_SIZE} unless given), never more than twice the frame’s size or about 16 million pixels, and drawn smaller where the file would be too big. Answers the picture, then { frame, width, height, scale }. Look at each frame you made or changed before saying it is done.`,
    readOnly: true,
    input: z.object({
      frame: FrameId,
      maxSize: z
        .number()
        .int()
        .min(LEAST_SIZE)
        .max(MOST_SIZE)
        .optional()
        .describe(
          `The most pixels the picture’s longer side may take, ${LEAST_SIZE} to ${MOST_SIZE} (${AGENT_RENDER_MAX_SIZE} unless given)`,
        ),
    }),
    run: ({ frame, maxSize = AGENT_RENDER_MAX_SIZE }, context) =>
      onDesign(context, async (open) => {
        frameOf(open.tab.design(), frame)
        open.tab.show({ layers: [], frame })
        const { renders } = context
        const busy = renders.busy()
        if (busy > 0) throw new ToolRefusal(`Dazbee is drawing other renders; try again in ${busy} seconds`)
        const wait = renders.take()
        if (wait > 0)
          throw new ToolRefusal(`This agent has asked for many renders at once; try again in ${wait} seconds`)
        const { png, width, height, scale, ms } = await renders.draw(() => renderOf(open, frame, maxSize))
        // A render that held the worker long costs the access more of its renders.
        renders.charge(Math.floor(ms / RENDER_MS_PER_RENDER))
        return new WithPicture(png, { frame, width, height, scale })
      }),
  }),
]

/**
 * The render of the frame as the tab holds it now: the design, the fonts the app doesn't ship of the families it
 * draws, and the images the frame draws, read from the API for this render alone. Refused when the images pass what
 * one render may send or decode, or one didn't load.
 */
async function renderOf({ tab, imageBytes }: OpenDesign, frameId: string, maxSize: number): Promise<FrameRender> {
  await tab.fontsLoaded()
  const design = tab.design()
  const { fonts, variables } = tab.bytes()
  const images: Record<string, Uint8Array> = {}
  let bytes = 0
  for (const id of imageAssetIds(design, [frameId], variables)) {
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
  const shipped = new Set(loadFontFiles().map((font) => font.bytes))
  const families = new Set(fontFamilies(design, variables))
  return {
    design,
    frameId,
    maxSize,
    fonts: fonts.filter((font) => families.has(font.family) && !shipped.has(font.bytes)),
    images,
    ...(variables ? { variables } : {}),
  }
}
