// Ink: how much of each pixel of a text piece is letter, 0 to 1, read from a cut-out's alpha or a flat
// crop's distance from its border colour, and the steps that turn it into what the font fingerprint's
// model reads: boxes round it, hollow letters found and filled in, turning it level and sampling a
// line of it into a strip.

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

/** Hollow letters: ink drawn only as a thin line round each letter, the letters' insides left clear. */
export interface Hollow {
  /** The ink with the letters' insides filled, so it holds the letters' whole shapes. */
  filled: Ink
  /** How wide the line round the letters is, in pixels. */
  width: number
}

/** A pixel with alpha under this is see-through, for telling a cut-out from a flat crop. */
const OPAQUE_FROM = 250
/** A picture is a cut-out when more than this share of its pixels is see-through. */
const CUT_OUT_SHARE = 0.05
/** A pixel inked more than this is a wall when the insides the ink closes are found. */
const WALL_FROM = 0.3
/** Letters are hollow when their insides cover at least this many times the ink's area. */
const HOLLOW_INSIDE = 0.75
/** Letters are hollow when at least this share of each line parts a letter's inside from what is outside it. */
const HOLLOW_PARTING = 0.9

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
  const { data, width } = ink
  // Read from each side inwards to the first ink, so the pixels inside the box aren't all read.
  const rowInked = (y: number) => {
    for (let x = x0; x < x1; x++) if ((data[y * width + x] ?? 0) > threshold) return true
    return false
  }
  let minY = y0
  while (minY < y1 && !rowInked(minY)) minY++
  if (minY >= y1) return null
  let maxY = y1 - 1
  while (!rowInked(maxY)) maxY--
  const columnInked = (x: number) => {
    for (let y = minY; y <= maxY; y++) if ((data[y * width + x] ?? 0) > threshold) return true
    return false
  }
  let minX = x0
  while (!columnInked(minX)) minX++
  let maxX = x1 - 1
  while (!columnInked(maxX)) maxX--
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
export function isCutOut({ width, height, pixels }: Pixels): boolean {
  let clear = 0
  for (let i = 0; i < width * height; i++) if ((pixels[i * 4 + 3] ?? 0) < OPAQUE_FROM) clear++
  return clear > width * height * CUT_OUT_SHARE
}

/**
 * The ink's hollow letters with their insides filled, and the width of the line drawn round them;
 * null when the letters are filled. Each place the ink closes in is reached from outside the picture
 * across walls of ink: a place behind an odd number of walls is a letter's inside, one behind two is
 * a counter (the hole of a hollow o), and outside is behind none. The letters are hollow when their
 * insides cover at least three quarters of the ink, and 90% or more of the line round the letters,
 * and of the line round their counters, has a letter's inside on one side and what is outside it on
 * the other, within twice the line's width: so not thin letters, whose strokes have outside on both
 * sides, nor letters in a drawn frame, which sit inside it.
 */
export function hollowOf(ink: Ink): Hollow | null {
  const { width, height, data } = ink
  const n = width * height
  const wall = new Uint8Array(n)
  for (let i = 0; i < n; i++) wall[i] = (data[i] ?? 0) > WALL_FROM ? 1 : 0
  const crossed = wallsCrossed(width, height, wall)
  let inked = 0
  let insides = 0
  for (let i = 0; i < n; i++)
    if (wall[i]) inked++
    else if ((crossed[i] ?? 0) % 2 === 1) insides++
  if (inked === 0 || insides < HOLLOW_INSIDE * inked) return null
  const line = lineWidth(ink)
  const parting = partingShares(width, height, wall, crossed, 2 * line + 1)
  if (parting.letters < HOLLOW_PARTING || parting.counters < HOLLOW_PARTING) return null
  const filled = new Float32Array(n)
  for (let i = 0; i < n; i++) filled[i] = !wall[i] && (crossed[i] ?? 0) % 2 === 1 ? 1 : (data[i] ?? 0)
  return { filled: { width, height, data: filled }, width: line }
}

/** Ink shrunk to `width` × `height`, each pixel the mean of those it covers, as a piece's pixels are shrunk. */
export function shrinkInk(ink: Ink, width: number, height: number): Ink {
  const sums = new Float64Array(width * height)
  const counts = new Float64Array(width * height)
  for (let y = 0; y < ink.height; y++) {
    const ty = Math.min(height - 1, Math.floor((y * height) / ink.height))
    for (let x = 0; x < ink.width; x++) {
      const o = ty * width + Math.min(width - 1, Math.floor((x * width) / ink.width))
      sums[o] = (sums[o] ?? 0) + (ink.data[y * ink.width + x] ?? 0)
      counts[o] = (counts[o] ?? 0) + 1
    }
  }
  const data = new Float32Array(width * height)
  for (let o = 0; o < data.length; o++) data[o] = (sums[o] ?? 0) / Math.max(1, counts[o] ?? 0)
  return { width, height, data }
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

/**
 * How many walls of ink each pixel is behind, seen from outside the picture: stepping onto a wall from
 * a pixel that isn't one crosses a wall, every other step crosses none. A breadth-first search a
 * count of walls at a time, stepping to the four neighbours.
 */
function wallsCrossed(width: number, height: number, wall: Uint8Array): Int32Array {
  const crossed = new Int32Array(width * height).fill(-1)
  let current: number[] = []
  let next: number[] = []
  const enter = (i: number) => (wall[i] ? next : current).push(i)
  for (let x = 0; x < width; x++) {
    enter(x)
    if (height > 1) enter((height - 1) * width + x)
  }
  for (let y = 1; y < height - 1; y++) {
    enter(y * width)
    if (width > 1) enter(y * width + width - 1)
  }
  for (let count = 0; current.length > 0 || next.length > 0; count++) {
    for (let q = 0; q < current.length; q++) {
      const i = current[q] ?? 0
      if ((crossed[i] ?? 0) >= 0) continue
      crossed[i] = count
      const x = i % width
      const step = (j: number) => {
        if ((crossed[j] ?? 0) < 0) (wall[j] && !wall[i] ? next : current).push(j)
      }
      if (x > 0) step(i - 1)
      if (x < width - 1) step(i + 1)
      if (i >= width) step(i - width)
      if (i < width * (height - 1)) step(i + width)
    }
    current = next
    next = []
  }
  return crossed
}

/**
 * How wide the ink's lines are: twice its area over the length of its edges, a line having an edge on
 * each side. The edges' length is the sum of the ink's steps from pixel to pixel, which counts an
 * edge's length alike at every slant.
 */
function lineWidth({ width, height, data }: Ink): number {
  let area = 0
  let edges = 0
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const v = data[y * width + x] ?? 0
      area += v
      const dx = x < width - 1 ? (data[y * width + x + 1] ?? 0) - v : 0
      const dy = y < height - 1 ? (data[(y + 1) * width + x] ?? 0) - v : 0
      edges += Math.sqrt(dx * dx + dy * dy)
    }
  return edges > 0 ? (2 * area) / edges : 0
}

/**
 * The shares of the line round the letters (wall pixels behind one wall) and of the lines round their
 * counters (behind two or more) with both a pixel behind an odd count of walls and one behind an even
 * count within `reach` steps, left, right, up or down; past the picture's edge is behind none. A
 * share of no pixels is 1.
 */
function partingShares(
  width: number,
  height: number,
  wall: Uint8Array,
  crossed: Int32Array,
  reach: number,
): { letters: number; counters: number } {
  const odd = stepsTo(width, height, (i) => !wall[i] && (crossed[i] ?? 0) % 2 === 1, false)
  const even = stepsTo(width, height, (i) => !wall[i] && (crossed[i] ?? 0) % 2 === 0, true)
  const total = [0, 0]
  const parting = [0, 0]
  for (let i = 0; i < wall.length; i++) {
    if (!wall[i]) continue
    const kind = (crossed[i] ?? 0) >= 2 ? 1 : 0
    total[kind] = (total[kind] ?? 0) + 1
    if ((odd[i] ?? Infinity) <= reach && (even[i] ?? Infinity) <= reach) parting[kind] = (parting[kind] ?? 0) + 1
  }
  const share = (kind: number) => ((total[kind] ?? 0) > 0 ? (parting[kind] ?? 0) / (total[kind] ?? 1) : 1)
  return { letters: share(0), counters: share(1) }
}

/**
 * Each pixel's steps, left, right, up or down, to the nearest pixel that is `target`, or past the
 * picture's edge when `edge`: a two-pass city-block distance.
 */
function stepsTo(width: number, height: number, target: (i: number) => boolean, edge: boolean): Float32Array {
  const steps = new Float32Array(width * height)
  const far = edge ? 1 : Infinity
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      if (target(i)) continue
      const up = y > 0 ? (steps[i - width] ?? 0) : far - 1
      const left = x > 0 ? (steps[i - 1] ?? 0) : far - 1
      steps[i] = Math.min(up, left) + 1
    }
  for (let y = height - 1; y >= 0; y--)
    for (let x = width - 1; x >= 0; x--) {
      const i = y * width + x
      const down = y < height - 1 ? (steps[i + width] ?? 0) : far - 1
      const right = x < width - 1 ? (steps[i + 1] ?? 0) : far - 1
      steps[i] = Math.min(steps[i] ?? 0, Math.min(down, right) + 1)
    }
  return steps
}
