// PROTOTYPE. The ink map of a block (how much of each pixel is letter, 0 to 1) and the steps that
// turn ink into the fingerprint model's input. The model's samples go through the same steps, so
// what it was trained on and what it is given match.
import type { Rgba } from './png.ts'

export interface Ink {
  width: number
  height: number
  /** 0 to 1, row by row. */
  data: Float32Array
}

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

/** The model's input: a strip this many pixels high. */
export const STRIP_HEIGHT = 32
/** The widest strip a sample keeps. */
export const STRIP_WIDTH = 320
/** The model sees windows of this width; a block's strip is cut into overlapping windows. */
export const WINDOW = 128

/**
 * The ink of a picture. A cut-out (a layer with transparency) is its alpha. A flat picture (an
 * uploaded crop) is how far each pixel's colour is from the background's, towards the letters'.
 */
export function inkOf(img: Rgba, background?: readonly number[]): Ink {
  const n = img.width * img.height
  const data = new Float32Array(n)
  let clear = 0
  for (let i = 0; i < n; i++) if (img.data[i * 4 + 3]! < 250) clear++
  if (clear > n * 0.05) {
    for (let i = 0; i < n; i++) data[i] = img.data[i * 4 + 3]! / 255
    return { width: img.width, height: img.height, data }
  }
  const bg = background ?? borderColor(img)
  const dist = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const dr = img.data[i * 4]! - bg[0]!
    const dg = img.data[i * 4 + 1]! - bg[1]!
    const db = img.data[i * 4 + 2]! - bg[2]!
    dist[i] = Math.sqrt(dr * dr + dg * dg + db * db)
  }
  // The letters' distance: the 90th percentile of the pixels clearly off the background.
  const off = [...dist].filter((d) => d > 12).sort((a, b) => a - b)
  const full = off.length > 0 ? Math.max(off[Math.floor(off.length * 0.9)]!, 24) : 255
  for (let i = 0; i < n; i++) data[i] = Math.min(1, Math.max(0, (dist[i]! - 6) / (full - 6)))
  return { width: img.width, height: img.height, data }
}

/** The median colour of a picture's outermost pixels. */
export function borderColor(img: Rgba): number[] {
  const r: number[] = []
  const g: number[] = []
  const b: number[] = []
  const add = (x: number, y: number) => {
    const i = (y * img.width + x) * 4
    r.push(img.data[i]!)
    g.push(img.data[i + 1]!)
    b.push(img.data[i + 2]!)
  }
  for (let x = 0; x < img.width; x++) {
    add(x, 0)
    add(x, img.height - 1)
  }
  for (let y = 0; y < img.height; y++) {
    add(0, y)
    add(img.width - 1, y)
  }
  return [median(r), median(g), median(b)]
}

export function median(v: number[]): number {
  if (v.length === 0) return 0
  const s = [...v].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]!
}

/** The box around the ink above `threshold`; null when there is none. */
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
      if (ink.data[y * ink.width + x]! > threshold) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
  if (maxX < 0) return null
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }
}

/** Samples a region of the ink into a new size, averaging 3×3 bilinear taps per pixel. */
export function resample(ink: Ink, box: Box, width: number, height: number): Float32Array {
  const out = new Float32Array(width * height)
  const sx = box.w / width
  const sy = box.h / height
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      let sum = 0
      for (let j = 0; j < 3; j++)
        for (let i = 0; i < 3; i++) sum += bilinear(ink, box.x + (x + (i + 0.5) / 3) * sx - 0.5, box.y + (y + (j + 0.5) / 3) * sy - 0.5)
      out[y * width + x] = sum / 9
    }
  return out
}

export function bilinear(ink: Ink, fx: number, fy: number): number {
  const x0 = Math.floor(fx)
  const y0 = Math.floor(fy)
  const ax = fx - x0
  const ay = fy - y0
  const at = (x: number, y: number) =>
    x < 0 || y < 0 || x >= ink.width || y >= ink.height ? 0 : ink.data[y * ink.width + x]!
  return (
    at(x0, y0) * (1 - ax) * (1 - ay) + at(x0 + 1, y0) * ax * (1 - ay) + at(x0, y0 + 1) * (1 - ax) * ay + at(x0 + 1, y0 + 1) * ax * ay
  )
}

/**
 * One line's ink as the model reads it: its ink box scaled to STRIP_HEIGHT high, keeping its shape,
 * with a pixel of room above and below. Width up to `maxWidth`.
 */
export function lineStrip(ink: Ink, box: Box, maxWidth = Infinity): { width: number; data: Uint8Array } {
  const inner = STRIP_HEIGHT - 2
  const scale = inner / box.h
  const width = Math.max(1, Math.min(maxWidth, Math.round(box.w * scale)))
  const region = { x: box.x, y: box.y - 1 / scale, w: width / scale, h: STRIP_HEIGHT / scale }
  const f = resample(ink, region, width, STRIP_HEIGHT)
  const data = new Uint8Array(width * STRIP_HEIGHT)
  for (let i = 0; i < f.length; i++) data[i] = Math.round(Math.min(1, f[i]!) * 255)
  return { width, data }
}

/** Rotates ink about its centre by `degrees` (clockwise), keeping its size: undoes a tilt of −degrees. */
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
      // The source of an output pixel: rotate back by −degrees.
      const dx = x + 0.5 - cx
      const dy = y + 0.5 - cy
      const sx = cos * dx + sin * dy + cx - 0.5
      const sy = -sin * dx + cos * dy + cy - 0.5
      data[y * ink.width + x] = bilinear(ink, sx, sy)
    }
  return { width: ink.width, height: ink.height, data }
}
