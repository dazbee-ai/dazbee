// Ink: how much of each pixel of a text piece is letter, 0 to 1, read from a cut-out's alpha or a flat
// crop's distance from its border colour, and the steps that turn it into what the font fingerprint's
// model reads: boxes round it, turning it level and sampling a line of it into a strip.

import type { Pixels } from '@dazbee/renderer'
import type { Rgb } from '@dazbee/schema'

/** Ink, 0 to 1 a pixel, row by row. */
export interface Ink {
  width: number
  height: number
  data: Float32Array
}

/** A box in pixels: its top left corner and its size. */
export interface Box {
  x: number
  y: number
  w: number
  h: number
}

/** A line's ink sampled for the model, rounded to 0 to 255, row by row. */
export interface Strip {
  width: number
  data: Uint8Array
}

/** A pixel with alpha under this is see-through, for telling a cut-out from a flat crop. */
const OPAQUE_FROM = 250
/** A picture is a cut-out when more than this share of its pixels is see-through. */
const CUT_OUT_SHARE = 0.05

/**
 * The ink of a picture. A cut-out is its alpha. A flat crop is how far each pixel's colour is from
 * `background` (the median of its outermost pixels when left out), up to the letters' own distance.
 */
export function inkOf(picture: Pixels, background?: Rgb): Ink {
  const { width, height, pixels } = picture
  const n = width * height
  const data = new Float32Array(n)
  if (isCutOut(picture)) {
    for (let i = 0; i < n; i++) data[i] = (pixels[i * 4 + 3] ?? 0) / 255
    return { width, height, data }
  }
  const [r, g, b] = background ?? borderColour(picture)
  const distance = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const dr = (pixels[i * 4] ?? 0) - r
    const dg = (pixels[i * 4 + 1] ?? 0) - g
    const db = (pixels[i * 4 + 2] ?? 0) - b
    distance[i] = Math.sqrt(dr * dr + dg * dg + db * db)
  }
  // The letters' distance: the 90th percentile of the pixels clearly off the background.
  const off = [...distance].filter((d) => d > 12).sort((p, q) => p - q)
  const full = off.length > 0 ? Math.max(off[Math.floor(off.length * 0.9)] ?? 0, 24) : 255
  for (let i = 0; i < n; i++) data[i] = Math.min(1, Math.max(0, ((distance[i] ?? 0) - 6) / (full - 6)))
  return { width, height, data }
}

/** The median colour of a picture's outermost pixels, each edge pixel counted once per edge it lies on. */
export function borderColour({ width, height, pixels }: Pixels): Rgb {
  const r: number[] = []
  const g: number[] = []
  const b: number[] = []
  const add = (x: number, y: number) => {
    const i = (y * width + x) * 4
    r.push(pixels[i] ?? 0)
    g.push(pixels[i + 1] ?? 0)
    b.push(pixels[i + 2] ?? 0)
  }
  for (let x = 0; x < width; x++) {
    add(x, 0)
    add(x, height - 1)
  }
  for (let y = 0; y < height; y++) {
    add(0, y)
    add(width - 1, y)
  }
  return [median(r), median(g), median(b)]
}

/** The middle value, the upper one of an even count; 0 for none. */
export function median(values: readonly number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((p, q) => p - q)
  return sorted[Math.floor(sorted.length / 2)] ?? 0
}

/** The box round the ink above `threshold`, within `within` or the whole ink; null when there is none. */
export function inkBox(ink: Ink, threshold = 0.5, within?: Box): Box | null {
  const x0 = within?.x ?? 0
  const y0 = within?.y ?? 0
  const x1 = within ? within.x + within.w : ink.width
  const y1 = within ? within.y + within.h : ink.height
  let minX = Infinity
  let minY = Infinity
  let maxX = -1
  let maxY = -1
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++)
      if ((ink.data[y * ink.width + x] ?? 0) > threshold) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
  if (maxX < 0) return null
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }
}

/** Ink turned about its centre by `degrees` clockwise, keeping its size: undoes a tilt of −`degrees`. */
export function rotateInk(ink: Ink, degrees: number): Ink {
  if (Math.abs(degrees) < 0.01) return ink
  const a = (degrees * Math.PI) / 180
  const cos = Math.cos(a)
  const sin = Math.sin(a)
  const cx = ink.width / 2
  const cy = ink.height / 2
  const data = new Float32Array(ink.width * ink.height)
  for (let y = 0; y < ink.height; y++)
    for (let x = 0; x < ink.width; x++) {
      // Where the output pixel comes from: turned back by −degrees.
      const dx = x + 0.5 - cx
      const dy = y + 0.5 - cy
      data[y * ink.width + x] = bilinear(ink, cos * dx + sin * dy + cx - 0.5, -sin * dx + cos * dy + cy - 0.5)
    }
  return { width: ink.width, height: ink.height, data }
}

/**
 * One line's ink as the model reads it: its box scaled to `height` high, keeping its shape, with a
 * 32nd of the height of room above and below, as wide as that makes it, rounded to 0 to 255.
 */
export function lineStrip(ink: Ink, box: Box, height: number): Strip {
  const room = height / 32
  const scale = (height - 2 * room) / box.h
  const width = Math.max(1, Math.round(box.w * scale))
  const region = { x: box.x, y: box.y - room / scale, w: width / scale, h: height / scale }
  // Enough taps to average every pixel a strip pixel covers when a big line is shrunk.
  const taps = Math.max(3, Math.ceil(2 / scale))
  const sampled = resample(ink, region, width, height, taps)
  const data = new Uint8Array(width * height)
  for (let i = 0; i < sampled.length; i++) data[i] = Math.round(Math.min(1, sampled[i] ?? 0) * 255)
  return { width, data }
}

/** Whether a picture is a cut-out: more than 5% of its pixels less than opaque. */
function isCutOut({ width, height, pixels }: Pixels): boolean {
  let clear = 0
  for (let i = 0; i < width * height; i++) if ((pixels[i * 4 + 3] ?? 0) < OPAQUE_FROM) clear++
  return clear > width * height * CUT_OUT_SHARE
}

/** Ink at a point between pixels, from its four nearest; 0 past the edges. */
function bilinear(ink: Ink, fx: number, fy: number): number {
  const x0 = Math.floor(fx)
  const y0 = Math.floor(fy)
  const ax = fx - x0
  const ay = fy - y0
  const at = (x: number, y: number) =>
    x < 0 || y < 0 || x >= ink.width || y >= ink.height ? 0 : (ink.data[y * ink.width + x] ?? 0)
  return (
    at(x0, y0) * (1 - ax) * (1 - ay) +
    at(x0 + 1, y0) * ax * (1 - ay) +
    at(x0, y0 + 1) * (1 - ax) * ay +
    at(x0 + 1, y0 + 1) * ax * ay
  )
}

/** A region of the ink sampled to `width` × `height`, each pixel the mean of `taps` × `taps` bilinear taps. */
function resample(ink: Ink, box: Box, width: number, height: number, taps: number): Float32Array {
  const out = new Float32Array(width * height)
  const sx = box.w / width
  const sy = box.h / height
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      let sum = 0
      for (let j = 0; j < taps; j++)
        for (let i = 0; i < taps; i++)
          sum += bilinear(ink, box.x + (x + (i + 0.5) / taps) * sx - 0.5, box.y + (y + (j + 0.5) / taps) * sy - 0.5)
      out[y * width + x] = sum / (taps * taps)
    }
  return out
}
