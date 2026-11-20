// render_frame: an agent looks at a frame of the open design, an agent render drawn on the render worker from what
// the session's agent tab holds.
import { z } from 'zod'

import type { AgentTab } from '@dazbee/editor/agent-tab'
import { AGENT_RENDER_MAX_SIZE, AGENT_RENDER_SIZES } from '@dazbee/export'
import { loadFontFiles } from '@dazbee/fonts/node'
import { fontFamilies, imageAssetIds } from '@dazbee/schema'

import type { FrameRender } from '../render-queue.ts'
import { defineTool, type Tool, ToolRefusal, WithPicture } from './define-tool.ts'
import { FrameId, frameOf, onDesign } from './design-tools.ts'

const [LEAST_SIZE, MOST_SIZE] = AGENT_RENDER_SIZES

export const RENDER_TOOLS: Tool[] = [
  defineTool({
    name: 'render_frame',
    title: 'Render a frame',
    description: `Draws a frame of the open design as a PNG to look at, as it exports: its longer side fitted to \`maxSize\` pixels (${AGENT_RENDER_MAX_SIZE} unless given), never more than twice the frame’s size, and drawn smaller where the file would be too big. Answers the picture, then { frame, width, height, scale }. Look at each frame you made or changed before saying it is done.`,
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
      onDesign(context, async ({ tab }) => {
        frameOf(tab.design(), frame)
        const wait = context.renders.take()
        if (wait > 0)
          throw new ToolRefusal(`This agent has asked for many renders at once; try again in ${wait} seconds`)
        await tab.frameLoaded(frame)
        const { png, width, height, scale } = await context.renders.draw(renderOf(tab, frame, maxSize))
        return new WithPicture(png, { frame, width, height, scale })
      }),
  }),
]

/**
 * The render of the frame as the tab holds it now: the design, and of its bytes only the fonts the app doesn't ship
 * of the families it draws and the images the frame draws. An image that didn't load is refused.
 */
function renderOf(tab: AgentTab, frameId: string, maxSize: number): FrameRender {
  const design = tab.design()
  const { fonts, images, variables } = tab.bytes()
  const shipped = new Set(loadFontFiles().map(({ bytes }) => bytes))
  const families = new Set(fontFamilies(design, variables))
  const ids = imageAssetIds(design, [frameId], variables)
  const missing = ids.filter((id) => !Object.hasOwn(images, id))
  if (missing.length > 0)
    throw new ToolRefusal(
      `The frame’s image${missing.length === 1 ? '' : 's'} ${missing.join(', ')} could not be loaded; try again in a moment`,
    )
  return {
    design,
    frameId,
    maxSize,
    fonts: fonts.filter(({ family, bytes }) => families.has(family) && !shipped.has(bytes)),
    images: Object.fromEntries(ids.map((id) => [id, images[id] as Uint8Array])),
    ...(variables ? { variables } : {}),
  }
}
