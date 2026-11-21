// What the tools that place on a frame of the open design share: the box they place in, the frame they place on,
// the parts of a frame they place at, and running the placing batch and answering with the layer it placed.
import { z } from 'zod'

import type { AgentStep } from '@dazbee/doc'
import type { Frame, Rect } from '@dazbee/schema'

import type { OpenDesign } from '../open-design.ts'
import { agentBatchOn, answered, refusalOf } from './command-tools.ts'
import { type ToolContext, ToolRefusal } from './define-tool.ts'

/** The frame a tool places on: its id and its record. */
export interface FrameTo {
  id: string
  frame: Frame
}

/** The agent batch that places a layer, and what its answer tells beside the layer, its box and the warnings. */
export interface Placing {
  steps: AgentStep[]
  /** The layer placed, read from the first step's result. */
  layerOf: (result: unknown) => string
  /** What the answer tells between the layer's box and the warnings. */
  told: Record<string, unknown>
}

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

/**
 * Runs the batch on the open design as one agent step and answers once Dazbee has stored it: the layer placed, its
 * box, what `placing` tells and the warnings for what it placed; refused, nothing changed, when a step is refused.
 */
export async function placeAndAnswer(
  { answerBy }: ToolContext,
  open: OpenDesign,
  { steps, layerOf, told }: Placing,
  note: string | undefined,
): Promise<unknown> {
  const done = await agentBatchOn(open, steps, answerBy, note)
  const { kept, steps: outcomes, warnings, warningsError } = done.value
  const [first] = outcomes
  if (!kept || !first?.ok) throw new ToolRefusal(refusalOf(outcomes.find((step) => !step.ok)))
  const layer = layerOf(first.result)
  const props = open.tab.design().nodes[layer]?.props
  return answered(open, done, {
    layer,
    ...(props ? { box: { x: props.x, y: props.y, width: props.width, height: props.height } } : {}),
    ...told,
    warnings,
    ...(warningsError === undefined ? {} : { warningsError }),
  })
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
