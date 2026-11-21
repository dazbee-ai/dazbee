import { boundsOf, type Point, turn } from '@dazbee/doc'
import type { Rect } from '@dazbee/schema'

/** A container's rotation, which turns the layers inside it about the container's centre. */
export interface Turn {
  about: Point
  degrees: number
}

/** The box around `corners` once each container's rotation in `turns`, innermost first, has turned them. */
export function placed(corners: readonly Point[], turns: readonly Turn[]): Rect {
  const points = corners.map((corner) => turns.reduceRight((p, { about, degrees }) => turn(p, about, degrees), corner))
  return boundsOf(points.map((p) => ({ ...p, width: 0, height: 0, rotation: 0 })))
}
