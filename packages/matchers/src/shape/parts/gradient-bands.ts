// Gradient bands: the colour split cuts a gradient into bands of one colour each. Touching parts whose
// colours together run as one gradient are joined into one part, closest colours first, so the full
// pass fits one gradient across them.

import { ciede2000 } from '../../looks-same/colour.ts'
import { fitGradient, GRADIENT_SPREAD, innerPixels } from '../fit/gradient.ts'
import type { FloatPicture } from './float-picture.ts'
import type { MarkedPart } from './marks.ts'
import { sum } from './stacking.ts'

/** Bands are joined only on pieces with at most this many parts: a gradient makes few bands. */
export const MOST_PARTS_FOR_BANDS = 16

/** Parts under this alpha are see-through, never bands. */
const OPAQUE_BAND = 0.9
/** Parts further apart than this ΔE00 are not bands of one gradient. */
const FARTHEST_BANDS = 25
/** Two bands are one gradient when it fits them within this mean ΔE00. */
const BAND_ERROR = 2.2
/** The most joins made. */
const MOST_JOINS = 40

/** The parts with touching bands of one gradient joined, one join at a time, the closest pair first. */
export function joinGradientBands(fitted: FloatPicture, parts: readonly MarkedPart[], scale: number): MarkedPart[] {
  let list = parts.slice()
  for (let join = 0; join < MOST_JOINS; join++) {
    const pairs: { a: MarkedPart; b: MarkedPart; d: number }[] = []
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i]
        const b = list[j]
        if (!a || !b || a.alpha < OPAQUE_BAND || b.alpha < OPAQUE_BAND || a.marks || b.marks) continue
        const d = ciede2000(a.lab, b.lab)
        if (d > FARTHEST_BANDS || !touching(a, b, fitted.width)) continue
        pairs.push({ a, b, d })
      }
    pairs.sort((x, y) => x.d - y.d)
    let joined = false
    for (const { a, b } of pairs) {
      const mask = new Float32Array(a.mask.length)
      for (let i = 0; i < mask.length; i++) mask[i] = Math.min(1, (a.mask[i] ?? 0) + (b.mask[i] ?? 0))
      const gradient = fitGradient(innerPixels(fitted, mask), scale)
      if (!gradient || gradient.error > BAND_ERROR) continue
      const filled = new Float32Array(mask.length)
      const outer = new Float32Array(mask.length)
      for (let i = 0; i < mask.length; i++) {
        filled[i] = Math.max(a.filled[i] ?? 0, b.filled[i] ?? 0, mask[i] ?? 0)
        outer[i] = Math.max(a.outer[i] ?? 0, b.outer[i] ?? 0, mask[i] ?? 0)
      }
      const larger = sum(a.mask) >= sum(b.mask) ? a : b
      list = list.filter((part) => part !== a && part !== b)
      list.push({
        ...larger,
        mask,
        filled,
        outer,
        area: a.area + b.area,
        holeShare: Math.min(a.holeShare, b.holeShare),
        box: {
          x0: Math.min(a.box.x0, b.box.x0),
          y0: Math.min(a.box.y0, b.box.y0),
          x1: Math.max(a.box.x1, b.box.x1),
          y1: Math.max(a.box.y1, b.box.y1),
        },
        // A joined part is a gradient: its fill is always tried as one.
        spread: Math.max(GRADIENT_SPREAD + 0.5, a.spread, b.spread),
        touchesEdge: a.touchesEdge || b.touchesEdge,
      })
      joined = true
      break
    }
    if (!joined) break
  }
  return list
}

/** Whether two parts share an edge: one of a's pixels has one of b's beside it. */
function touching(a: MarkedPart, b: MarkedPart, width: number): boolean {
  if (a.box.x1 + 1 < b.box.x0 || b.box.x1 + 1 < a.box.x0 || a.box.y1 + 1 < b.box.y0 || b.box.y1 + 1 < a.box.y0) {
    return false
  }
  const x0 = Math.max(a.box.x0, b.box.x0) - 1
  const x1 = Math.min(a.box.x1, b.box.x1) + 1
  const y0 = Math.max(a.box.y0, b.box.y0) - 1
  const y1 = Math.min(a.box.y1, b.box.y1) + 1
  for (let y = Math.max(0, y0); y <= y1; y++)
    for (let x = Math.max(0, x0); x <= Math.min(width - 1, x1); x++) {
      const i = y * width + x
      if (
        (a.mask[i] ?? 0) >= 0.5 &&
        ((x + 1 < width && (b.mask[i + 1] ?? 0) >= 0.5) ||
          (b.mask[i + width] ?? 0) >= 0.5 ||
          (x > 0 && (b.mask[i - 1] ?? 0) >= 0.5) ||
          (b.mask[i - width] ?? 0) >= 0.5)
      )
        return true
    }
  return false
}
