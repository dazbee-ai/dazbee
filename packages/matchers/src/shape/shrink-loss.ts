// What a shrink loses: a pattern finer than the shrunk picture's pixels (halftone dots, pinstripes, grain) comes out
// of the shrink as one flat tone, and the cut and the judge, which both read the shrunk picture, would take it for
// a flat fill. So the shrink a piece is cut at also reads, for each shrunk pixel, how far the piece's own pixels
// under it lie from their mean. A shrunk pixel is busy underneath when that is far although the shrunk picture is
// flat around it; an edge is busy underneath too, but there the shrunk picture shows the edge.

import type { Pixels } from '@dazbee/renderer'

/** The settings of the reading. */
export const SHRINK_LOSS = {
  /**
   * A shrunk pixel is busy underneath when the piece's pixels under it lie more than this from their mean (root
   * mean square over colour times alpha and alpha, of 255) and more than twice as far as the shrunk picture steps
   * to a pixel beside it.
   */
  busy: 16,
  /** A piece with more than this share of its covered shrunk pixels busy underneath holds a pattern the shrink loses. */
  mostBusy: 0.05,
} as const

/**
 * A picture shrunk as `shrunk` of the looks-the-same rule shrinks it (a box filter in premultiplied colour, the
 * same pixels), with how far the picture's own pixels under each shrunk pixel lie from their mean. Neither side
 * may grow.
 */
export function shrunkWithLoss(
  picture: Pixels,
  width: number,
  height: number,
): { shrunk: Pixels; spread: Float32Array } {
  const src = picture.pixels
  const out = new Uint8Array(width * height * 4)
  const spread = new Float32Array(width * height)
  const sx = picture.width / width
  const sy = picture.height / height
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const x0 = x * sx
      const x1 = (x + 1) * sx
      const y0 = y * sy
      const y1 = (y + 1) * sy
      let red = 0
      let green = 0
      let blue = 0
      let alpha = 0
      let weight = 0
      let squares = 0
      for (let yy = Math.floor(y0); yy < Math.ceil(y1); yy++)
        for (let xx = Math.floor(x0); xx < Math.ceil(x1); xx++) {
          const f = (Math.min(x1, xx + 1) - Math.max(x0, xx)) * (Math.min(y1, yy + 1) - Math.max(y0, yy))
          const i = (yy * picture.width + xx) * 4
          const a = (src[i + 3] ?? 0) / 255
          const r = (src[i] ?? 0) * a
          const g = (src[i + 1] ?? 0) * a
          const b = (src[i + 2] ?? 0) * a
          red += r * f
          green += g * f
          blue += b * f
          alpha += a * f
          weight += f
          squares += (r * r + g * g + b * b + a * a * 65025) * f
        }
      const p = y * width + x
      const o = p * 4
      out[o] = alpha > 0 ? Math.round(red / alpha) : 0
      out[o + 1] = alpha > 0 ? Math.round(green / alpha) : 0
      out[o + 2] = alpha > 0 ? Math.round(blue / alpha) : 0
      out[o + 3] = Math.round((alpha / weight) * 255)
      const variance =
        squares / weight -
        (red / weight) ** 2 -
        (green / weight) ** 2 -
        (blue / weight) ** 2 -
        ((alpha / weight) * 255) ** 2
      spread[p] = Math.sqrt(Math.max(0, variance))
    }
  return { shrunk: { width, height, pixels: out }, spread }
}

/**
 * The share of a shrunk picture's covered pixels that are busy underneath, by the `spread` its shrink read. A
 * pixel marked in `hidden` is not counted.
 */
export function busyShare(shrunk: Pixels, spread: Float32Array, hidden?: Uint8Array): number {
  const { width, height, pixels } = shrunk
  let covered = 0
  let busy = 0
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const p = y * width + x
      if ((pixels[p * 4 + 3] ?? 0) < 128 || hidden?.[p]) continue
      covered++
      const lost = spread[p] ?? 0
      if (lost <= SHRINK_LOSS.busy) continue
      // The shrunk picture's largest step from this pixel to one beside it.
      let step = 0
      if (x > 0) step = Math.max(step, apart(pixels, p, p - 1))
      if (x + 1 < width) step = Math.max(step, apart(pixels, p, p + 1))
      if (y > 0) step = Math.max(step, apart(pixels, p, p - width))
      if (y + 1 < height) step = Math.max(step, apart(pixels, p, p + width))
      if (4 * step < lost * lost) busy++
    }
  return covered ? busy / covered : 0
}

/** The squared distance between two pixels' colour times alpha and alpha, of 255. */
function apart(pixels: Uint8Array | Uint8ClampedArray, p: number, q: number): number {
  const a = (pixels[p * 4 + 3] ?? 0) / 255
  const b = (pixels[q * 4 + 3] ?? 0) / 255
  return (
    ((pixels[p * 4] ?? 0) * a - (pixels[q * 4] ?? 0) * b) ** 2 +
    ((pixels[p * 4 + 1] ?? 0) * a - (pixels[q * 4 + 1] ?? 0) * b) ** 2 +
    ((pixels[p * 4 + 2] ?? 0) * a - (pixels[q * 4 + 2] ?? 0) * b) ** 2 +
    ((a - b) * 255) ** 2
  )
}
