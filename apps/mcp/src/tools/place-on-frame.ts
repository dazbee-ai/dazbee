// What the tools that place on a frame of the open design share: the box they place in, the frame they place on
// and the parts of a frame they place at.
import { z } from 'zod'

import type { Frame, Rect } from '@dazbee/schema'

import type { OpenDesign } from '../open-design.ts'
import { ToolRefusal } from './define-tool.ts'

/** The farthest a box's edges may sit from its frame's corner, and the longest side it may have, in design pixels. */
const BOX_LIMIT = 100_000

/** A box on the frame, in design pixels from its top-left corner, described as the tool taking it places in it. */
export function placeBox(description: string) {
  return z
    .object({
      x: z.number().min(-BOX_LIMIT).max(BOX_LIMIT).describe('The box’s left edge, from the frame’s left edge'),
      y: z.number().min(-BOX_LIMIT).max(BOX_LIMIT).describe('The box’s top edge, from the frame’s top edge'),
      width: z.number().positive().max(BOX_LIMIT).describe('The box’s width'),
      height: z.number().positive().max(BOX_LIMIT).describe('The box’s height'),
    })
    .strict()
    .describe(description)
}

/** The open design's frame, refused when it has none of that id. */
export function frameIn(open: OpenDesign, frameId: string): Frame {
  const { frames } = open.tab.design()
  const frame = Object.hasOwn(frames, frameId) ? frames[frameId] : undefined
  if (!frame) throw new ToolRefusal(`The open design has no frame “${frameId}”; read_design lists its frames`)
  return frame
}

/** The frame's whole area, in its own pixels. */
export function whole({ width, height }: Frame): Rect {
  return { x: 0, y: 0, width, height }
}

/** The middle of a box. */
export function centreOf({ x, y, width, height }: Rect) {
  return { x: x + width / 2, y: y + height / 2 }
}
