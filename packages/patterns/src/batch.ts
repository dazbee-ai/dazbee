// The agent batch that builds a pattern at several sizes: for each size a new frame on the page, or the empty frame
// given, and the pattern's layers placed in it, each part sharing one new link id across the sizes, so a part's
// copies are linked copies.
import type { AgentStep } from '@dazbee/doc'

import type { PatternLayers } from './types.ts'

/** A size a pattern is built at: in a new frame on the page, or in the empty frame named. */
export interface PatternFrame {
  width: number
  height: number
  frameId?: string
}

/** A size's frame as the batch built it: its id, and each layer's id by the part it is. */
export interface BuiltFrame {
  frameId: string
  layers: Record<string, string>
}

/** The steps that place each size's layers, its frame added first when none is named. */
export function patternSteps(
  pageId: string,
  sizes: readonly { frame: PatternFrame; layers: PatternLayers }[],
  newId: () => string,
): AgentStep[] {
  const links = new Map<string, string>()
  const linkOf = (part: string) => {
    let link = links.get(part)
    if (!link) links.set(part, (link = newId()))
    return link
  }
  return sizes.flatMap(({ frame, layers }, i): AgentStep[] => {
    const nodes = Object.fromEntries(
      Object.entries(layers.nodes).map(([part, layer]) => [part, { ...layer, link: linkOf(part) }]),
    )
    const add = frame.frameId
      ? []
      : [
          {
            command: 'frame.add',
            as: frameStep(i),
            input: { pageId, name: `${frame.width} × ${frame.height}`, width: frame.width, height: frame.height },
          },
        ]
    const parentId = frame.frameId ?? { $ref: frameStep(i) }
    const place = {
      command: 'design.place',
      as: layersStep(i),
      input: { parentId, tree: { nodes, roots: layers.roots }, keepLinksFrom: pageId, withIds: true },
    }
    return [...add, place]
  })
}

/** Each size's frame as the batch's steps' results tell it, in the order of the sizes. */
export function builtFrames(
  sizes: readonly PatternFrame[],
  outcomes: readonly { as?: string; ok: boolean; result?: unknown }[],
): BuiltFrame[] {
  const result = (as: string) => outcomes.find((step) => step.as === as && step.ok)?.result
  return sizes.map((frame, i) => {
    const placed = result(layersStep(i)) as { ids?: Record<string, string> } | undefined
    return { frameId: frame.frameId ?? String(result(frameStep(i))), layers: placed?.ids ?? {} }
  })
}

/** The name of the step that adds the frame of the size at `i`. */
function frameStep(i: number): string {
  return `frame-${i + 1}`
}

/** The name of the step that places the layers of the size at `i`. */
function layersStep(i: number): string {
  return `layers-${i + 1}`
}
