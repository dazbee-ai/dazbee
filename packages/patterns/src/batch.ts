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
            as: `frame-${i + 1}`,
            input: { pageId, name: `${frame.width} × ${frame.height}`, width: frame.width, height: frame.height },
          },
        ]
    const parentId = frame.frameId ?? { $ref: `frame-${i + 1}` }
    const place = {
      command: 'design.place',
      as: `layers-${i + 1}`,
      input: { parentId, tree: { nodes, roots: layers.roots }, keepLinksFrom: pageId, withIds: true },
    }
    return [...add, place]
  })
}
