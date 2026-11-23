// Reading a text piece: its ink, tilt, lines, alignment, fill colour, outline and background, which
// the text matcher starts every candidate from and the font fingerprint reads, and whether its letters
// run along a curve (`curve-check.ts`). Hollow letters, drawn
// only as a line round each letter, are read as the filled letters that line outlines, with no fill
// and an outline in the line's colour and width. A piece whose lines are taller than the matcher
// works at is read again shrunk to that height, hollow when the piece read whole is.

import type { Pixels } from '@dazbee/renderer'
import type { Rgb } from '@dazbee/schema'

import { ciede2000, srgbToLab } from '../looks-same/colour.ts'
import { type CurveCheck, curveCheck } from './curve-check.ts'
import {
  borderColour,
  type Box,
  type Hollow,
  hollowOf,
  type Ink,
  inkBox,
  inkOf,
  median,
  rotateInk,
  shrinkInk,
} from './ink.ts'

/** A text piece as the text matcher reads it: its pixels, the words it says and its tilt when known. */
export interface TextPiece {
  pixels: Pixels
  /** Lines split by `\n`. */
  words: string
  /** The tilt in degrees clockwise; found from the ink when left out. */
  angle?: number
}

/** What a piece's pixels say about its text. */
export interface PieceReading {
  /** The pixels read. */
  pixels: Pixels
  ink: Ink
  /** The ink turned level, the tilt undone, with hollow letters filled. */
  level: Ink
  /** The tilt in degrees clockwise. */
  angle: number
  /** The box round the level ink. */
  box: Box
  /** Each line's box in the level ink, one a line of the words, top to bottom. */
  lines: Box[]
  /** The letters' colour: the median of the ink 2 px or more from its edges; null for hollow letters, which have none. */
  fill: Rgb | null
  /**
   * A ring at the letters' edges in another colour, or the line round hollow letters, its width in
   * pixels; null when there is none.
   */
  outline: { width: number; colour: Rgb } | null
  /** The colour behind the letters: the median of the picture's outermost pixels. */
  background: Rgb
  align: 'start' | 'center' | 'end'
  /** Whether the letters run along a curve, and the blobs that tell. */
  curve: CurveCheck
}

/** A piece read at its own size and at the size the matcher works at, and how much smaller that is. */
export interface ReadPiece {
  whole: PieceReading
  /** The piece read shrunk so its lines are `WORK_LINE_HEIGHT` tall; `whole` when they are no taller. */
  work: PieceReading
  /** The work size over the whole size: 1, or under 0.95. */
  scale: number
}

/** The tallest line, in pixels, the matcher works at: a piece with taller lines is worked shrunk to it. */
export const WORK_LINE_HEIGHT = 160

/** A piece is shrunk only when its lines are more than this much taller than the work height. */
const SHRINK_BELOW = 0.95
/** The tilt is searched within this many degrees either way. */
const MAX_TILT = 15
/** A band of rows is ink when its row's ink is more than this share of the fullest row's. */
const LINE_ROW_SHARE = 0.02
/** An edge ring is an outline when its colour is more than this ΔE00 from the fill's. */
const OUTLINE_DELTA_E = 12
/** A pixel inked more than this is solid ink. */
const SOLID_INK = 0.6

/** How many lines words have. */
const lineCount = (words: string) => words.split('\n').length
/** How many letters, characters but white space, the first line of words has. */
const firstLineLetters = (words: string) => [...(words.split('\n')[0] ?? '').replace(/\s/gu, '')].length

/**
 * A text piece read at its own size and, when its lines are taller than `WORK_LINE_HEIGHT`, shrunk to
 * it; with `hollow` false its letters are read as drawn, never as hollow.
 */
export function readPiece(piece: TextPiece, { hollow: findHollow = true }: { hollow?: boolean } = {}): ReadPiece {
  const background = borderColour(piece.pixels)
  const ink = inkOf(piece.pixels, background)
  const found = findHollow ? hollowOf(ink) : null
  // The line round hollow letters is set to the half pixel, as an outline is read.
  const hollow = found && { ...found, width: Math.max(0.5, Math.round(found.width * 2) / 2) }
  const whole = readAt(piece, ink, background, hollow)
  // The height of the ink as it is, tilt and all, is enough to decide.
  const box = inkBox(inkOf(piece.pixels))
  const scale = box ? WORK_LINE_HEIGHT / (box.h / lineCount(piece.words)) : 1
  if (!(scale < SHRINK_BELOW)) return { whole, work: whole, scale: 1 }
  const pixels = shrinkPixels(piece.pixels, scale)
  // Hollow letters keep their filled shape and line width shrunk, as the thinner line may not close them.
  const shrunk = hollow && {
    filled: shrinkInk(hollow.filled, pixels.width, pixels.height),
    width: hollow.width * scale,
  }
  const workBackground = borderColour(pixels)
  return { whole, work: readAt({ ...piece, pixels }, inkOf(pixels, workBackground), workBackground, shrunk), scale }
}

/**
 * The `count` lines of level ink within `box`: bands of rows with ink, split at the emptiest rows.
 * With too many bands the smallest (a dot, an accent) joins its nearer neighbour; with too few the
 * tallest is cut at its thinnest row near an even split.
 */
export function findLines(level: Ink, box: Box, count: number): Box[] {
  const rows = new Float64Array(box.h)
  for (let y = 0; y < box.h; y++)
    for (let x = box.x; x < box.x + box.w; x++)
      rows[y] = (rows[y] ?? 0) + (level.data[(box.y + y) * level.width + x] ?? 0)
  const peak = Math.max(...rows)
  let bands: [number, number][] = []
  let start = -1
  for (let y = 0; y <= box.h; y++) {
    const on = y < box.h && (rows[y] ?? 0) > peak * LINE_ROW_SHARE
    if (on && start < 0) start = y
    if (!on && start >= 0) {
      bands.push([start, y])
      start = -1
    }
  }
  // No row with ink, as in faint text: one band over the whole box.
  if (bands.length === 0) bands.push([0, box.h])
  while (bands.length > count) bands = joinSmallest(bands)
  while (bands.length < count) bands = cutTallest(bands, rows, count)
  return bands.map(([a, b]) => {
    const band = { x: box.x, y: box.y + a, w: box.w, h: b - a }
    return inkBox(level, 0.5, band) ?? band
  })
}

/**
 * The piece's reading at the size its pixels are, from its ink, the colour behind it and, for hollow
 * letters, their filled ink.
 */
function readAt(piece: TextPiece, ink: Ink, background: Rgb, hollow: Hollow | null): PieceReading {
  const letters = hollow?.filled ?? ink
  const angle = piece.angle ?? estimateAngle(letters)
  const level = rotateInk(letters, -angle)
  const box = inkBox(level) ?? { x: 0, y: 0, w: level.width, h: level.height }
  const lines = findLines(level, box, lineCount(piece.words))
  const { fill, outline } = hollow ? hollowColours(piece.pixels, ink, hollow.width) : colours(piece.pixels, ink)
  return {
    pixels: piece.pixels,
    ink,
    level,
    angle,
    box,
    lines,
    fill,
    outline,
    background,
    align: alignOf(lines),
    curve: curveCheck(level, lines[0] ?? box, firstLineLetters(piece.words)),
  }
}

/** Pixels shrunk by `scale`, each the mean of those it covers, colour weighted by alpha. */
function shrinkPixels({ width, height, pixels }: Pixels, scale: number): Pixels {
  const w = Math.max(1, Math.round(width * scale))
  const h = Math.max(1, Math.round(height * scale))
  const sums = new Float64Array(w * h * 4)
  const counts = new Float64Array(w * h)
  for (let y = 0; y < height; y++) {
    const ty = Math.min(h - 1, Math.floor((y * h) / height))
    for (let x = 0; x < width; x++) {
      const tx = Math.min(w - 1, Math.floor((x * w) / width))
      const i = (y * width + x) * 4
      const o = ty * w + tx
      const alpha = (pixels[i + 3] ?? 0) / 255
      for (let c = 0; c < 3; c++) sums[o * 4 + c] = (sums[o * 4 + c] ?? 0) + (pixels[i + c] ?? 0) * alpha
      sums[o * 4 + 3] = (sums[o * 4 + 3] ?? 0) + alpha
      counts[o] = (counts[o] ?? 0) + 1
    }
  }
  const out = new Uint8Array(w * h * 4)
  for (let o = 0; o < w * h; o++) {
    const alpha = sums[o * 4 + 3] ?? 0
    for (let c = 0; c < 3; c++) out[o * 4 + c] = alpha > 0 ? Math.round((sums[o * 4 + c] ?? 0) / alpha) : 0
    out[o * 4 + 3] = Math.round((255 * alpha) / Math.max(1, counts[o] ?? 0))
  }
  return { width: w, height: h, pixels: out }
}

/** The bands with the smallest joined to the neighbour with the smaller gap, the earlier on a tie. */
function joinSmallest(bands: [number, number][]): [number, number][] {
  const size = (i: number) => (bands[i]?.[1] ?? 0) - (bands[i]?.[0] ?? 0)
  let k = 0
  for (let i = 1; i < bands.length; i++) if (size(i) < size(k)) k = i
  const at = (i: number): [number, number] => bands[i] ?? [0, 0]
  const prevGap = k > 0 ? at(k)[0] - at(k - 1)[1] : Infinity
  const nextGap = k < bands.length - 1 ? at(k + 1)[0] - at(k)[1] : Infinity
  const j = prevGap <= nextGap ? k - 1 : k + 1
  const merged: [number, number] = [Math.min(at(j)[0], at(k)[0]), Math.max(at(j)[1], at(k)[1])]
  return [...bands.filter((_, i) => i !== j && i !== k), merged].sort((p, q) => p[0] - q[0])
}

/** The bands with the tallest cut at its thinnest row, weighted towards an even split of what is left. */
function cutTallest(bands: [number, number][], rows: Float64Array, count: number): [number, number][] {
  const size = (i: number) => (bands[i]?.[1] ?? 0) - (bands[i]?.[0] ?? 0)
  let k = 0
  for (let i = 1; i < bands.length; i++) if (size(i) > size(k)) k = i
  const [a, b] = bands[k] ?? [0, 0]
  const target = a + (b - a) / (count - bands.length + 1)
  let cut = Math.round(target)
  let low = Infinity
  for (let y = Math.round(a + (b - a) * 0.15); y < b - (b - a) * 0.15; y++) {
    const cost = (rows[y] ?? 0) * (1 + Math.abs(y - target) / (b - a))
    if (cost < low) {
      low = cost
      cut = y
    }
  }
  return [...bands.slice(0, k), [a, cut], [cut, b], ...bands.slice(k + 1)]
}

/**
 * The tilt that makes the lines sharpest: the angle whose row sums differ most from row to row
 * (Postl's method, as Leptonica measures skew), searched by degrees within ±15°, then by quarters.
 */
function estimateAngle(ink: Ink): number {
  let best = 0
  let bestSharpness = sharpness(ink, 0)
  for (let d = -MAX_TILT; d <= MAX_TILT; d += 1) {
    const s = sharpness(ink, d)
    if (s > bestSharpness * 1.02) {
      bestSharpness = s
      best = d
    }
  }
  for (let d = best - 1; d <= best + 1; d += 0.25) {
    const s = sharpness(ink, d)
    if (s > bestSharpness) {
      bestSharpness = s
      best = d
    }
  }
  return best
}

/**
 * Hollow letters' colours: no fill, and an outline `width` wide in the median colour of their solid
 * line, or of their faintest ink when none of it is solid.
 */
function hollowColours(picture: Pixels, ink: Ink, width: number): Pick<PieceReading, 'fill' | 'outline'> {
  const line = medianColour(picture.pixels, (i) => (ink.data[i] ?? 0) > SOLID_INK) ?? faintest(picture, ink)
  return { fill: null, outline: { width, colour: line.colour } }
}

/**
 * The fill colour and any outline. The fill is the median of the inner ink, 2 px or more from its
 * edges; an outline is a ring at the edges whose colour is more than ΔE00 12 from the fill's, as
 * wide as the ring's area over the edges' length.
 */
function colours(picture: Pixels, ink: Ink): Pick<PieceReading, 'fill' | 'outline'> {
  const { pixels } = picture
  const { solid, depth } = depths(ink)
  let maxDepth = 0
  for (const d of depth) if (d > maxDepth) maxDepth = d
  const pick = (keep: (d: number) => boolean) => medianColour(pixels, (i) => Boolean(solid[i]) && keep(depth[i] ?? 0))
  const coreFrom = Math.max(2, Math.min(4, Math.floor(maxDepth / 2)))
  const core = pick((d) => d >= coreFrom) ?? pick(() => true) ?? faintest(picture, ink)
  const edge = pick((d) => d <= 1.5)
  if (!edge || maxDepth < 4 || core.count < 30) return { fill: core.colour, outline: null }
  const coreLab = srgbToLab(...core.colour)
  const edgeLab = srgbToLab(...edge.colour)
  if (ciede2000(coreLab, edgeLab) < OUTLINE_DELTA_E) return { fill: core.colour, outline: null }
  // The ring: solid pixels nearer the outline's colour than the fill's.
  let ring = 0
  let perimeter = 0
  for (let i = 0; i < depth.length; i++) {
    if (!solid[i]) continue
    if (depth[i] === 1) perimeter++
    const here = srgbToLab(pixels[i * 4] ?? 0, pixels[i * 4 + 1] ?? 0, pixels[i * 4 + 2] ?? 0)
    if (ciede2000(here, edgeLab) < ciede2000(here, coreLab)) ring++
  }
  const thickness = perimeter > 0 ? ring / perimeter : 0
  if (thickness < 0.8) return { fill: core.colour, outline: null }
  return { fill: core.colour, outline: { width: Math.round(thickness * 2) / 2, colour: edge.colour } }
}

/** How the lines sit: left edges, centres or right edges lined up, whichever spread least. One line: start. */
function alignOf(lines: readonly Box[]): PieceReading['align'] {
  if (lines.length < 2) return 'start'
  const spread = (edge: (b: Box) => number) => {
    const values = lines.map(edge)
    return Math.max(...values) - Math.min(...values)
  }
  const left = spread((b) => b.x)
  const centre = spread((b) => b.x + b.w / 2)
  const right = spread((b) => b.x + b.w)
  if (centre <= left && centre <= right) return 'center'
  return left <= right ? 'start' : 'end'
}

/** How sharp the lines are when the ink is read at `degrees`: the squared steps between its row sums. */
function sharpness(ink: Ink, degrees: number): number {
  const a = (degrees * Math.PI) / 180
  const rows = new Float64Array(ink.height * 2)
  const cy = ink.height / 2
  const cx = ink.width / 2
  for (let y = 0; y < ink.height; y += 1)
    for (let x = 0; x < ink.width; x += 2) {
      const v = ink.data[y * ink.width + x] ?? 0
      if (v < 0.2) continue
      const r = Math.round(-Math.sin(a) * (x - cx) + Math.cos(a) * (y - cy) + ink.height)
      if (r >= 0 && r < rows.length) rows[r] = (rows[r] ?? 0) + v
    }
  let s = 0
  for (let i = 1; i < rows.length; i++) s += ((rows[i] ?? 0) - (rows[i - 1] ?? 0)) ** 2
  return s
}

/** Which pixels are solid ink, and each solid pixel's city-block steps to the nearest pixel that isn't. */
function depths({ width, height, data }: Ink): { solid: Uint8Array; depth: Float32Array } {
  const solid = new Uint8Array(width * height)
  for (let i = 0; i < solid.length; i++) solid[i] = (data[i] ?? 0) > SOLID_INK ? 1 : 0
  const depth = new Float32Array(width * height)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      if (!solid[i]) continue
      const up = y > 0 ? (depth[i - width] ?? 0) : 0
      const left = x > 0 ? (depth[i - 1] ?? 0) : 0
      depth[i] = Math.min(up, left) + 1
    }
  for (let y = height - 1; y >= 0; y--)
    for (let x = width - 1; x >= 0; x--) {
      const i = y * width + x
      if (!solid[i]) continue
      const down = y < height - 1 ? (depth[i + width] ?? 0) : 0
      const right = x < width - 1 ? (depth[i + 1] ?? 0) : 0
      depth[i] = Math.min(depth[i] ?? 0, Math.min(down, right) + 1)
    }
  return { solid, depth }
}

/** The colour of faint ink, where no pixel is solid: the median of the pixels inked a quarter or more. */
function faintest({ pixels }: Pixels, ink: Ink): { colour: Rgb; count: number } {
  let best = 0
  for (let i = 0; i < ink.data.length; i++) best = Math.max(best, ink.data[i] ?? 0)
  const faint = (i: number) => (ink.data[i] ?? 0) >= Math.min(0.25, best * 0.8)
  return medianColour(pixels, faint) ?? { colour: [0, 0, 0], count: 0 }
}

/** The median red, green and blue of the pixels `keep` picks, and how many it picks; null for none. */
function medianColour(pixels: Uint8Array, keep: (i: number) => boolean): { colour: Rgb; count: number } | null {
  const r: number[] = []
  const g: number[] = []
  const b: number[] = []
  for (let i = 0; i < pixels.length / 4; i++)
    if (keep(i)) {
      r.push(pixels[i * 4] ?? 0)
      g.push(pixels[i * 4 + 1] ?? 0)
      b.push(pixels[i * 4 + 2] ?? 0)
    }
  return r.length > 0 ? { colour: [median(r), median(g), median(b)], count: r.length } : null
}
