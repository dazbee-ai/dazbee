import type { Box, Point } from '@dazbee/doc'
import type { Rect } from '@dazbee/schema'

import type { LayerBuild } from './build.ts'
import { boxOf, type FigmaNode } from './read.ts'

/** Layers placed past these are brought within them, so every number the import writes stays finite. */
const MAX_COORDINATE = 10_000_000
const MAX_SIZE = 1_000_000

/**
 * The box a node is placed by, in its frame's pixels, brought within Dazbee's reach (reported when
 * it had to be); undefined when the node has none.
 */
export function placedBox(build: LayerBuild, n: FigmaNode, origin: Point): Box | undefined {
  const b = boxOf(n.fields)
  return b && placed(build, n, b, origin)
}

/** `b`, a node's box on its page, in the pixels of a frame at `origin`, brought within Dazbee's reach (reported when it had to be). */
export function placed(build: LayerBuild, n: FigmaNode, b: Rect, origin: Point): Box {
  const x = clamp(b.x - origin.x, -MAX_COORDINATE, MAX_COORDINATE)
  const y = clamp(b.y - origin.y, -MAX_COORDINATE, MAX_COORDINATE)
  const width = Math.min(b.width, MAX_SIZE)
  const height = Math.min(b.height, MAX_SIZE)
  if (x !== b.x - origin.x || y !== b.y - origin.y || width !== b.width || height !== b.height)
    build.report.add('positions-clamped', n)
  return { x, y, width, height, rotation: 0 }
}

function clamp(n: number, low: number, high: number) {
  return Math.min(high, Math.max(low, n))
}
