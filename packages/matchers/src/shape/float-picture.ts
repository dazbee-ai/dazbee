// A picture's pixels as floats, which the shape matcher splits and fits: read from 8-bit pixels and
// shrunk by area to the size it is fitted at.

import type { Pixels } from '@dazbee/renderer'

/** A picture's pixels, row by row, straight alpha: red, green and blue 0 to 255, alpha 0 to 1. */
export interface FloatPicture {
  width: number
  height: number
  data: Float32Array
}

/** An alpha this high or higher is opaque: cut-out pictures store opaque as 253 or 254. */
const OPAQUE_FROM = 253

/** 8-bit pixels as floats, alphas from 253 up counting as opaque. */
export function toFloatPicture({ width, height, pixels }: Pixels): FloatPicture {
  const data = new Float32Array(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = pixels[i * 4] ?? 0
    data[i * 4 + 1] = pixels[i * 4 + 1] ?? 0
    data[i * 4 + 2] = pixels[i * 4 + 2] ?? 0
    const alpha = pixels[i * 4 + 3] ?? 0
    data[i * 4 + 3] = alpha >= OPAQUE_FROM ? 1 : alpha / 255
  }
  return { width, height, data }
}

/**
 * A picture shrunk to `width` × `height`, each pixel the area-weighted mean of what it covers, its
 * colour weighted by alpha; itself when it is that size already. Neither side may grow.
 */
export function shrinkFloats(picture: FloatPicture, width: number, height: number): FloatPicture {
  if (width === picture.width && height === picture.height) return picture
  const src = picture.data
  const data = new Float32Array(width * height * 4)
  const sx = picture.width / width
  const sy = picture.height / height
  for (let y = 0; y < height; y++) {
    const y0 = y * sy
    const y1 = y0 + sy
    for (let x = 0; x < width; x++) {
      const x0 = x * sx
      const x1 = x0 + sx
      let red = 0
      let green = 0
      let blue = 0
      let alpha = 0
      let weight = 0
      for (let yy = Math.floor(y0); yy < Math.ceil(y1) && yy < picture.height; yy++) {
        const wy = Math.min(y1, yy + 1) - Math.max(y0, yy)
        for (let xx = Math.floor(x0); xx < Math.ceil(x1) && xx < picture.width; xx++) {
          const w = wy * (Math.min(x1, xx + 1) - Math.max(x0, xx))
          const i = (yy * picture.width + xx) * 4
          const a = (src[i + 3] ?? 0) * w
          red += (src[i] ?? 0) * a
          green += (src[i + 1] ?? 0) * a
          blue += (src[i + 2] ?? 0) * a
          alpha += a
          weight += w
        }
      }
      const o = (y * width + x) * 4
      data[o] = alpha > 0 ? red / alpha : 0
      data[o + 1] = alpha > 0 ? green / alpha : 0
      data[o + 2] = alpha > 0 ? blue / alpha : 0
      data[o + 3] = weight > 0 ? alpha / weight : 0
    }
  }
  return { width, height, data }
}
