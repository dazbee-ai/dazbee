// The fringe of a picture: the covered pixels of a soft shadow or glow, which fade out and are no part of a shape.

import type { FloatPicture } from './parts/float-picture.ts'

/** The settings of the fringe. */
export const FRINGE = {
  /** A pixel of at least this share of the piece's full alpha is solid; under it, it fades. */
  solid: 0.9,
  /** Where a fringe meets pixels that are not covered, its alpha steps down by at most this, of the alpha that covers. */
  fade: 0.1,
  /**
   * A soft pixel is narrow when the alpha is less by `narrowBy`, of the alpha that covers, `narrowReach` pixels to
   * both sides of it; soft pixels of which more than `narrowShare` are narrow are strokes, no fringe.
   */
  narrowBy: 0.08,
  narrowReach: 3,
  narrowShare: 0.2,
} as const

/**
 * The fringe of a picture: the covered pixels of a soft shadow or glow, which are no part of a shape. Soft pixels
 * (under `solid` of the alpha that covers) with no solid pixel beside them, joined, are a fringe when they fade out:
 * where they meet pixels that are not covered, more often than not the alpha steps down by `fade` at most. A
 * see-through shape ends at an edge instead, and so does a soft edge. A thin faint stroke is no fringe either: its
 * pixels are narrow, with less alpha `narrowReach` pixels to both sides, across or down.
 */
export function fringeOf({ width, height, data }: FloatPicture, cut: number, norm: number): Uint8Array {
  const n = width * height
  const fringe = new Uint8Array(n)
  // 1 a soft covered pixel with no solid pixel beside it, 2 one already joined.
  const soft = new Uint8Array(n)
  let any = false
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      const raw = data[i * 4 + 3] ?? 0
      if (raw < cut || raw * norm >= FRINGE.solid) continue
      let firm = false
      for (let dy = -1; dy <= 1 && !firm; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx
          const yy = y + dy
          if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue
          if ((data[(yy * width + xx) * 4 + 3] ?? 0) * norm >= FRINGE.solid) {
            firm = true
            break
          }
        }
      if (firm) continue
      soft[i] = 1
      any = true
    }
  if (!any) return fringe
  const stack: number[] = []
  const members: number[] = []
  for (let start = 0; start < n; start++) {
    if (soft[start] !== 1) continue
    let fades = 0
    let ends = 0
    let narrow = 0
    members.length = 0
    soft[start] = 2
    stack.push(start)
    while (stack.length) {
      const i = stack.pop() ?? 0
      members.push(i)
      const x = i % width
      const y = (i - x) / width
      const alpha = data[i * 4 + 3] ?? 0
      const less = (dx: number, dy: number) => {
        const xx = x + dx
        const yy = y + dy
        const other = xx < 0 || yy < 0 || xx >= width || yy >= height ? 0 : (data[(yy * width + xx) * 4 + 3] ?? 0)
        return (alpha - other) * norm >= FRINGE.narrowBy
      }
      const reach = FRINGE.narrowReach
      if ((less(-reach, 0) && less(reach, 0)) || (less(0, -reach) && less(0, reach))) narrow++
      for (let k = 0; k < 4; k++) {
        const xx = x + (k === 0 ? -1 : k === 1 ? 1 : 0)
        const yy = y + (k === 2 ? -1 : k === 3 ? 1 : 0)
        if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue
        const j = yy * width + xx
        if (soft[j] === 1) {
          soft[j] = 2
          stack.push(j)
        } else if ((data[j * 4 + 3] ?? 0) < cut) {
          if ((alpha - (data[j * 4 + 3] ?? 0)) * norm <= FRINGE.fade) fades++
          else ends++
        }
      }
    }
    if (fades > ends && narrow <= FRINGE.narrowShare * members.length) for (const i of members) fringe[i] = 1
  }
  return fringe
}
