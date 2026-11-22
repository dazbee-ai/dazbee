// Marks: four or more small parts of one colour (dots, dashes, specks of a pattern) become one part,
// which the full pass draws as one traced path rather than a graphic each.

import { ciede2000 } from '../../looks-same/colour.ts'
import { type ColourSplit, splitColours, type SplitOptions } from './colour-split.ts'
import type { FloatPicture } from './float-picture.ts'
import { type StackedPart, sum, withHoles } from './stacking.ts'

/** A stacked part, with how many marks it was made of when it is a group of them. */
export interface MarkedPart extends StackedPart {
  marks?: number
}

/** Parts within this ΔE00 of a group's first are its colour: edge blends split a colour in two. */
const SAME_COLOUR = 12
/** A part under this share of the covered pixels is small enough to be a mark. */
const MARK_SHARE = 0.05
/** The fewest small parts of one colour that are marks. */
const FEWEST_MARKS = 4

/** A part covering under this share of the covered pixels, or 2 pixels, is a speck and left out. */
const SPECK_SHARE = 0.0005

/**
 * A picture split by colour into parts with their holes worked out, each colour's marks joined,
 * and specks left out; with the split, whose labels and whether it found too many parts the caller reads.
 */
export function markedParts(
  picture: FloatPicture,
  options: SplitOptions,
  covered: number,
): { split: ColourSplit; parts: MarkedPart[] } {
  const split = splitColours(picture, options)
  if (split.tooMany) return { split, parts: [] }
  const parts = groupMarks(
    split.parts.map((part) => withHoles(part, picture)),
    covered,
  ).filter((part) => sum(part.mask) >= Math.max(2, covered * SPECK_SHARE))
  return { split, parts }
}

/** The parts with each colour's four or more small parts joined into one; the largest parts come first. */
export function groupMarks(parts: readonly StackedPart[], covered: number): MarkedPart[] {
  const groups: StackedPart[][] = []
  for (const part of [...parts].sort((a, b) => b.area - a.area)) {
    const group = groups.find((g) => g[0] && ciede2000(g[0].lab, part.lab) < SAME_COLOUR)
    if (group) group.push(part)
    else groups.push([part])
  }
  const grouped: MarkedPart[] = []
  for (const group of groups) {
    const small = group.filter((part) => part.area < covered * MARK_SHARE)
    const first = small[0]
    if (!first || small.length < FEWEST_MARKS) {
      grouped.push(...group)
      continue
    }
    grouped.push(...group.filter((part) => !small.includes(part)))
    const n = first.mask.length
    const mask = new Float32Array(n)
    const filled = new Float32Array(n)
    const outer = new Float32Array(n)
    for (const part of small)
      for (let i = 0; i < n; i++) {
        mask[i] = Math.max(mask[i] ?? 0, part.mask[i] ?? 0)
        filled[i] = Math.max(filled[i] ?? 0, part.filled[i] ?? 0)
        outer[i] = Math.max(outer[i] ?? 0, part.outer[i] ?? 0)
      }
    grouped.push({
      ...first,
      mask,
      filled,
      outer,
      area: small.reduce((total, part) => total + part.area, 0),
      // Marks are many shapes: drawn as one traced path, never as one shape.
      holeShare: 0,
      marks: small.length,
      box: {
        x0: Math.min(...small.map((part) => part.box.x0)),
        y0: Math.min(...small.map((part) => part.box.y0)),
        x1: Math.max(...small.map((part) => part.box.x1)),
        y1: Math.max(...small.map((part) => part.box.y1)),
      },
      spread: 0,
    })
  }
  return grouped
}
