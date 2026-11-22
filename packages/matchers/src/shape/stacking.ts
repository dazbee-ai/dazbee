// Stacking: the parts of a piece back to front, each drawn as a shape that may run under the parts
// over it. A hole in a part that another colour covers is filled, so the shape runs under that
// colour (a rectangle half under a circle comes back whole); a hole you can see through stays a hole.

import type { Part, PixelBox } from './colour-split.ts'
import type { FloatPicture } from './float-picture.ts'

/** A part with its holes worked out, ready to be stacked. */
export interface StackedPart extends Part {
  /** Its coverage with the holes other colours cover filled: what its shape under the others draws. */
  filled: Float32Array
  /** Its coverage with every hole filled: its outer outline. */
  outer: Float32Array
  /** How much of its outline is see-through hole (outline icons, rings): 0 for a solid shape. */
  holeShare: number
}

/** The parts back to front, the largest filled outline first, each with its holes worked out. */
export function stackParts(parts: readonly Part[], picture: FloatPicture): StackedPart[] {
  const stacked = parts.map((part) => withHoles(part, picture))
  return stacked.sort((a, b) => sum(b.filled) - sum(a.filled))
}

/** What the parts after the one at `index` cover, the most of any of them a pixel: its shape may reach under it. */
export function coveredAbove(parts: readonly StackedPart[], index: number, pixels: number): Float32Array {
  const above = new Float32Array(pixels)
  for (const part of parts.slice(index + 1))
    for (let j = 0; j < pixels; j++) if ((part.mask[j] ?? 0) > (above[j] ?? 0)) above[j] = part.mask[j] ?? 0
  return above
}

/** The sum of a mask's values. */
export function sum(mask: Float32Array): number {
  let total = 0
  for (let i = 0; i < mask.length; i++) total += mask[i] ?? 0
  return total
}

/** A part with its covered holes filled, every hole filled, and its share of see-through hole. */
function withHoles(part: Part, picture: FloatPicture): StackedPart {
  const { filled, outer, seeThrough } = fillHoles(part.mask, picture, part.box)
  let maskSum = 0
  let holeSum = 0
  for (let i = 0; i < part.mask.length; i++) {
    maskSum += part.mask[i] ?? 0
    holeSum += seeThrough[i] ?? 0
  }
  return { ...part, filled, outer, holeShare: holeSum / Math.max(1, maskSum + holeSum) }
}

/**
 * A mask with its enclosed holes filled where the picture is covered there, as other colours lie on
 * top; holes that are see-through stay holes in `filled`, each pixel's uncovered share counted in
 * `seeThrough`. `outer` has every hole filled.
 */
function fillHoles(mask: Float32Array, picture: FloatPicture, box: PixelBox) {
  const { width, height, data } = picture
  const n = width * height
  const filled = mask.slice()
  const outer = mask.slice()
  const seeThrough = new Float32Array(n)
  // The outside, under half coverage, is flooded from the border of the box grown by one pixel.
  const bx0 = Math.max(0, box.x0 - 1)
  const by0 = Math.max(0, box.y0 - 1)
  const bx1 = Math.min(width - 1, box.x1 + 1)
  const by1 = Math.min(height - 1, box.y1 + 1)
  const inBox = (x: number, y: number) => x >= bx0 && x <= bx1 && y >= by0 && y <= by1
  const neighbours = (i: number) => {
    const x = i % width
    const y = (i - x) / width
    return [
      [x - 1, y],
      [x + 1, y],
      [x, y - 1],
      [x, y + 1],
    ] as const
  }
  const outside = new Uint8Array(n)
  const stack: number[] = []
  for (let y = by0; y <= by1; y++)
    for (let x = bx0; x <= bx1; x++) {
      if (x !== bx0 && x !== bx1 && y !== by0 && y !== by1) continue
      const i = y * width + x
      if ((mask[i] ?? 0) < 0.5 && !outside[i]) {
        outside[i] = 1
        stack.push(i)
      }
    }
  while (stack.length) {
    const i = stack.pop() ?? 0
    for (const [xx, yy] of neighbours(i)) {
      if (!inBox(xx, yy)) continue
      const j = yy * width + xx
      if (!outside[j] && (mask[j] ?? 0) < 0.5) {
        outside[j] = 1
        stack.push(j)
      }
    }
  }
  // Each hole is a 4-connected run of pixels under half coverage not outside.
  const seen = new Uint8Array(n)
  for (let y = by0; y <= by1; y++)
    for (let x = bx0; x <= bx1; x++) {
      const s = y * width + x
      if (outside[s] || seen[s] || (mask[s] ?? 0) >= 0.5) continue
      const hole: number[] = []
      seen[s] = 1
      stack.push(s)
      let alpha = 0
      while (stack.length) {
        const i = stack.pop() ?? 0
        hole.push(i)
        alpha += data[i * 4 + 3] ?? 0
        for (const [xx, yy] of neighbours(i)) {
          if (!inBox(xx, yy)) continue
          const j = yy * width + xx
          if (!outside[j] && !seen[j] && (mask[j] ?? 0) < 0.5) {
            seen[j] = 1
            stack.push(j)
          }
        }
      }
      const covered = alpha / hole.length >= 0.5
      for (const i of hole) {
        outer[i] = 1
        if (covered) filled[i] = 1
        else seeThrough[i] = 1 - (mask[i] ?? 0)
      }
    }
  return { filled, outer, seeThrough }
}
