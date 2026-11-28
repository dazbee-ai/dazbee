// Outlines: a patch's closed sub-pixel outlines, read by marching squares at one half over its coverage, and
// whether a closed outline holds a point.

import type { Patch } from './patches.ts'

/** A closed outline as x, y pairs in the picture's pixels, and the area it encloses: above 0 for an outer outline, below for a hole. */
export interface Loop {
  points: Float32Array
  area: number
}

/** What `near` holds for a pixel mixed with no neighbour: an inner pixel, covered whole. */
export const INNER = -1
/** And for a pixel mixed with no neighbour but with what is behind the piece: it is covered by its mix. */
export const OVER_GROUND = -2

/** How far a pixel's coverage is pushed from its neighbourhood's mean before the outlines are read. */
const SHARPEN = 1

/**
 * A patch's outlines, by marching squares at one half over its coverage in its box: a pixel of its own counts
 * whole, or by its mix when its mixed neighbour is another patch's; another patch's pixel mixed with one of its
 * own counts by the rest of that mix.
 */
export function outlines(
  r: Patch,
  patchOf: Int32Array,
  near: Int32Array,
  mix: Float32Array,
  width: number,
  height: number,
) {
  // The window: the box and a pixel around it, and a ring of zero around that.
  const x0 = r.box.x0 - 2
  const y0 = r.box.y0 - 2
  const w = r.box.x1 - r.box.x0 + 5
  const h = r.box.y1 - r.box.y0 + 5
  const cover = new Float32Array(w * h)
  for (let y = 1; y < h - 1; y++) {
    const yy = y + y0
    if (yy < 0 || yy >= height) continue
    for (let x = 1; x < w - 1; x++) {
      const xx = x + x0
      if (xx < 0 || xx >= width) continue
      const i = yy * width + xx
      const mixed = near[i] ?? 0
      if (patchOf[i] === r.id)
        cover[y * w + x] = mixed === INNER || (mixed >= 0 && patchOf[mixed] === r.id) ? 1 : (mix[i] ?? 0)
      else if (mixed >= 0 && patchOf[mixed] === r.id) cover[y * w + x] = 1 - (mix[i] ?? 0)
    }
  }
  // A stroke thinner than a pixel never covers a pixel by half. Each pixel is pushed away from the mean of its
  // 3 × 3 neighbourhood, which lifts such a stroke over one half and leaves a straight edge where it is.
  const sharp = new Float32Array(w * h)
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      const mean =
        ((cover[i - w - 1] ?? 0) +
          (cover[i - w] ?? 0) +
          (cover[i - w + 1] ?? 0) +
          (cover[i - 1] ?? 0) +
          (cover[i] ?? 0) +
          (cover[i + 1] ?? 0) +
          (cover[i + w - 1] ?? 0) +
          (cover[i + w] ?? 0) +
          (cover[i + w + 1] ?? 0)) /
        9
      sharp[i] = (cover[i] ?? 0) + SHARPEN * ((cover[i] ?? 0) - mean)
    }
  r.loops = marchingSquares(sharp, w, h, x0 + 0.5, y0 + 0.5)
  r.outline = 0
  for (const loop of r.loops) if (loop.area > 0) r.outline += loop.area
}

/**
 * The closed outlines where a mask with a ring of zero crosses one half, through sub-pixel points on the lines
 * between pixel centres, moved by (`left`, `top`). An outer outline has an area above 0, a hole below.
 */
export function marchingSquares(mask: Float32Array, w: number, h: number, left: number, top: number): Loop[] {
  // Each crossed edge has two ends of outline. Edge ids: across from (x, y) is 2 (y w + x), down is that plus 1.
  const ends = new Int32Array(2 * w * h * 2).fill(-1)
  const link = (a: number, b: number) => {
    ends[a * 2 + ((ends[a * 2] ?? 0) < 0 ? 0 : 1)] = b
    ends[b * 2 + ((ends[b * 2] ?? 0) < 0 ? 0 : 1)] = a
  }
  const crossed: number[] = []
  for (let y = 0; y < h - 1; y++)
    for (let x = 0; x < w - 1; x++) {
      const i = y * w + x
      const a = mask[i] ?? 0
      const b = mask[i + 1] ?? 0
      const c = mask[i + w + 1] ?? 0
      const d = mask[i + w] ?? 0
      const corners = (a >= 0.5 ? 1 : 0) | (b >= 0.5 ? 2 : 0) | (c >= 0.5 ? 4 : 0) | (d >= 0.5 ? 8 : 0)
      if (corners === 0 || corners === 15) continue
      const topEdge = 2 * i
      const bottom = 2 * (i + w)
      const leftEdge = 2 * i + 1
      const right = 2 * (i + 1) + 1
      crossed.push(i)
      switch (corners) {
        case 1:
        case 14:
          link(leftEdge, topEdge)
          break
        case 2:
        case 13:
          link(topEdge, right)
          break
        case 3:
        case 12:
          link(leftEdge, right)
          break
        case 4:
        case 11:
          link(right, bottom)
          break
        case 6:
        case 9:
          link(topEdge, bottom)
          break
        case 7:
        case 8:
          link(leftEdge, bottom)
          break
        default: {
          // A saddle joins as its centre says. Its four edges would each get two ends from this cell alone, so
          // the links are kept apart from the neighbours' by joining through the cell: handled as two links.
          const centreIn = (a + b + c + d) / 4 >= 0.5
          if ((corners === 5) === centreIn) {
            link(topEdge, right)
            link(leftEdge, bottom)
          } else {
            link(leftEdge, topEdge)
            link(right, bottom)
          }
        }
      }
    }
  const point = (edge: number): [number, number] => {
    const i = edge >> 1
    const x = i % w
    const y = (i - x) / w
    const a = mask[i] ?? 0
    const b = edge & 1 ? (mask[i + w] ?? 0) : (mask[i + 1] ?? 0)
    const t = Math.abs(b - a) < 1e-9 ? 0.5 : (0.5 - a) / (b - a)
    return edge & 1 ? [x + left, y + t + top] : [x + t + left, y + top]
  }
  const done = new Uint8Array(2 * w * h)
  const loops: Loop[] = []
  for (const cell of crossed)
    for (const start of [2 * cell, 2 * cell + 1, 2 * (cell + w), 2 * (cell + 1) + 1]) {
      if (done[start] || (ends[start * 2] ?? 0) < 0) continue
      const xy: number[] = []
      let previous = -1
      let current = start
      while (!done[current]) {
        done[current] = 1
        const p = point(current)
        xy.push(p[0], p[1])
        const a = ends[current * 2] ?? 0
        const b = ends[current * 2 + 1] ?? 0
        const next = a !== previous && a >= 0 && !done[a] ? a : b
        if (next < 0 || done[next]) break
        previous = current
        current = next
      }
      if (xy.length < 6) continue
      let area = 0
      for (let k = 0; k < xy.length; k += 2) {
        const m = (k + 2) % xy.length
        area += (xy[k] ?? 0) * (xy[m + 1] ?? 0) - (xy[m] ?? 0) * (xy[k + 1] ?? 0)
      }
      // An outer outline holds the covered pixel of the edge it starts on; a hole doesn't.
      const i = start >> 1
      const other = start & 1 ? i + w : i + 1
      const inside = (mask[i] ?? 0) >= 0.5 ? i : other
      const outer = holds(xy, (inside % w) + left, Math.floor(inside / w) + top)
      loops.push({ points: Float32Array.from(xy), area: (outer ? 1 : -1) * Math.abs(area / 2) })
    }
  return loops
}

/** Whether the closed outline `xy` (x, y pairs) holds the point. */
export function holds(xy: ArrayLike<number>, px: number, py: number): boolean {
  let inside = false
  for (let k = 0, j = xy.length - 2; k < xy.length; j = k, k += 2) {
    const xi = xy[k] ?? 0
    const yi = xy[k + 1] ?? 0
    const xj = xy[j] ?? 0
    const yj = xy[j + 1] ?? 0
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}
