// Rings: a part that is a ring is drawn as its outer shape with a stroke inside, so the stroke's
// width is one number. A part is a ring when much of its outline is see-through hole, or when it
// rings other colours thinly (they are drawn by the layers under and over it), but not when what it
// rings is mostly its own colour: then it is a shape under the others.

import { contours } from './contours.ts'
import { type StackedPart, sum } from './stacking.ts'

/** A part is a ring when more than this share of its outline is see-through hole. */
const HOLE_SHARE = 0.3
/** A part rings other colours when it covers less than this share of its outer outline. */
const THIN_RING = 0.45

/**
 * Whether a part is a ring, drawn as its outer shape with a stroke inside. Without the colour
 * clusters' `labels`, what it rings is never taken for its own colour.
 */
export function isRing(part: StackedPart, labels?: Int32Array): boolean {
  if (part.holeShare > HOLE_SHARE) return true
  return sum(part.mask) < THIN_RING * sum(part.outer) && !ringsOwnColour(part, labels)
}

/** A ring's width in the mask's pixels: its area over the length of its outer outline. */
export function ringWidth(part: StackedPart, width: number, height: number): number {
  let length = 0
  for (const loop of contours(part.outer, width, height, 0.5))
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i] ?? [0, 0]
      const b = loop[(i + 1) % loop.length] ?? [0, 0]
      length += Math.hypot(a[0] - b[0], a[1] - b[1])
    }
  return length > 0 ? sum(part.mask) / length : 1
}

/** Whether most of what a part rings, inside its outer outline and outside itself, is its own colour. */
function ringsOwnColour(part: StackedPart, labels?: Int32Array): boolean {
  if (!labels) return false
  let own = 0
  let all = 0
  for (let i = 0; i < part.mask.length; i++) {
    if ((part.outer[i] ?? 0) < 0.5 || (part.mask[i] ?? 0) >= 0.5) continue
    all++
    if (labels[i] === part.label) own++
  }
  return all > 0 && own > all * 0.5
}
