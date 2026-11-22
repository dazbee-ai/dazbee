// How a face draws letters, measured from its own glyphs for the files `pack-text-files.ts` packs. Each letter is
// drawn alone by Dazbee's renderer, and its ink is cut to its own bounds and shrunk to a small square, so letters
// compare by shape whatever their size. A face draws a pattern rather than letters (bars, lines, blocks, stripes)
// when too few of its capitals, or its script's letters, are distinct shapes. A face draws only capitals when its
// lowercase letters have no ascenders or descenders and each looks most like its own capital.
import type { CanvasKit } from '@dazbee/canvaskit'

import { type TextDrawer, textDrawer, textLayerProps, type TextLook } from '../src/text/draw-text.ts'
import type { FontKey } from '../src/text/font-key.ts'
import type { Script } from '../src/text/scripts.ts'

/** What a face's letters are, as `drawsLetters` and `drawsOnlyCapitals` read them. */
export interface LetterShapes {
  /** How many of the measured letters the face draws with ink. */
  measured: number
  /** Of those, how many are distinct letters: not stripes, and no other letter's shape within `DISTINCT_DISTANCE`. */
  distinct: number
  /** How many Latin letters the face draws with ink in both cases. */
  cased: number
  /** Of those, how many lowercase letters look more like their own capital than like any other capital. */
  capitalShaped: number
  /** Of those lowercase letters, how many reach above or below the others by `REACH` of the capitals' height. */
  reaching: number
}

/** A letter drawn: its ink's top and bottom row in the frame, and its ink shrunk to `SQUARE` × `SQUARE`, 0 to 1. */
interface Letter {
  top: number
  bottom: number
  square: Float32Array
}

/** The letters a face's shapes are told apart on, by the script it draws: Latin capitals, or the script's letters. */
export const MEASURED_LETTERS: Readonly<Record<Script, string>> = {
  latin: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  arabic: 'ابتثجحخدذرزسشصضطظعغفقكلمنهوي',
  devanagari: 'अआइईउऊएऐओऔकखगघचछजझटठडढणतथदधनपफबभमयरलवशषसह',
}

/** Two letters whose shapes are less than this far apart (`distance`) are the same shape. */
export const DISTINCT_DISTANCE = 0.2
/** A face draws letters when at least this share of its measured letters are distinct letters. */
export const DISTINCT_SHARE = 0.35
/** A lowercase letter reaches past the others when its top or bottom is this share of the capitals' height past theirs. */
export const REACH = 0.08
/** A face draws only capitals when at most this share of its lowercase letters reach past the others… */
export const REACHING_SHARE = 0.2
/** …and at least this share look most like their own capital. */
export const CAPITAL_SHARE = 0.4

/** The size each letter is drawn at, in pixels. */
const SIZE = 64
/** The side of the square a letter's ink is shrunk to. */
const SQUARE = 16
/** An alpha this high or more counts as ink when a letter's bounds are found. */
const INK_ALPHA = 64
/** A letter is stripes when this share of its rows are the same row, and that row holds `STRIPES` runs of ink or more. */
const STRIPED_ROWS = 0.6
const STRIPES = 3
/** Two rows of a square are the same when their ink differs by less than this on average. */
const SAME_ROW = 0.1

/** How a face draws letters: its `script`'s letters, and, for Latin, its letters' two cases. */
export function letterShapes(
  ck: CanvasKit,
  bytes: Uint8Array,
  face: FontKey,
  script: Script,
  drawsCharacter: (character: string) => boolean,
): LetterShapes {
  const drawer = textDrawer(ck, [{ family: face.family, bytes }])
  try {
    const draw = (letter: string) => (drawsCharacter(letter) ? drawLetter(drawer, face, letter) : null)
    const letters = [...MEASURED_LETTERS[script]].map(draw)
    const squares = letters.flatMap((letter) => (letter ? [letter.square] : []))
    const distinct = squares.filter(
      (square, i) =>
        !isStriped(square) && squares.every((other, j) => i === j || distance(square, other) >= DISTINCT_DISTANCE),
    ).length
    const shapes = { measured: squares.length, distinct, cased: 0, capitalShaped: 0, reaching: 0 }
    if (script !== 'latin') return shapes
    return { ...shapes, ...cases(letters, [...MEASURED_LETTERS.latin.toLowerCase()].map(draw)) }
  } finally {
    drawer.delete()
  }
}

/** Whether a face's measured letters are distinct shapes, so it draws letters rather than a pattern. */
export function drawsLetters(shapes: LetterShapes): boolean {
  return shapes.measured === 0 || shapes.distinct >= DISTINCT_SHARE * shapes.measured
}

/** Whether a face draws its lowercase letters as capitals: as its capitals, or as smaller capitals. */
export function drawsOnlyCapitals(shapes: LetterShapes): boolean {
  return (
    shapes.cased > 0 &&
    shapes.reaching <= REACHING_SHARE * shapes.cased &&
    shapes.capitalShaped >= CAPITAL_SHARE * shapes.cased
  )
}

/** A letter drawn at `SIZE` in the face, with no fallback; null when it draws no ink. */
function drawLetter(drawer: TextDrawer, face: FontKey, letter: string): Letter | null {
  const look: TextLook = {
    family: face.family,
    weight: face.weight,
    style: face.style,
    size: SIZE,
    spacing: 0,
    align: 'start',
    color: '#000000FF',
  }
  const natural = drawer.measure(letter, look)
  const drawn = drawer.draw(
    Math.ceil(natural.width) + SIZE,
    Math.ceil(natural.height) + SIZE,
    textLayerProps(letter, look, { x: SIZE / 2, y: SIZE / 2, ...natural, rotation: 0 }),
  )
  return inkLetter(drawn.pixels, drawn.width, drawn.height)
}

/** Whether most of a square's rows are one row of at least `STRIPES` runs of ink: bars side by side. */
function isStriped(square: Float32Array): boolean {
  for (let row = 0; row < SQUARE; row++) {
    let same = 0
    for (let other = 0; other < SQUARE; other++) if (rowDifference(square, row, other) < SAME_ROW) same++
    if (same >= STRIPED_ROWS * SQUARE && inkRuns(square, row) >= STRIPES) return true
  }
  return false
}

/**
 * How far apart two letters' shapes are, 0 to 1: the ink they don't share, over the ink either holds or over the
 * space either leaves, whichever share is larger, so that both thin and heavy letters compare by what sets them apart.
 */
function distance(a: Float32Array, b: Float32Array): number {
  let apart = 0
  let ink = 0
  let space = 0
  for (let i = 0; i < a.length; i++) {
    const x = a[i] ?? 0
    const y = b[i] ?? 0
    apart += Math.abs(x - y)
    ink += Math.max(x, y)
    space += Math.max(1 - x, 1 - y)
  }
  return Math.max(ink > 0 ? apart / ink : 0, space > 0 ? apart / space : 0)
}

/** The two-case measures of the capitals `upper` and the lowercase letters `lower`, A to Z, null where not drawn. */
function cases(
  upper: readonly (Letter | null)[],
  lower: readonly (Letter | null)[],
): Pick<LetterShapes, 'cased' | 'capitalShaped' | 'reaching'> {
  const pairs = upper.flatMap((capital, i) => {
    const small = lower[i]
    return capital && small ? [{ i, capital, small }] : []
  })
  if (pairs.length === 0) return { cased: 0, capitalShaped: 0, reaching: 0 }
  const capitalHeight = middle(pairs.map((p) => p.capital.bottom)) - middle(pairs.map((p) => p.capital.top))
  const top = middle(pairs.map((p) => p.small.top))
  const bottom = middle(pairs.map((p) => p.small.bottom))
  const margin = REACH * capitalHeight
  const reaching = pairs.filter((p) => p.small.top < top - margin || p.small.bottom > bottom + margin).length
  const capitalShaped = pairs.filter(({ i, capital, small }) => {
    const own = meanDifference(capital.square, small.square)
    return upper.every((other, j) => j === i || !other || meanDifference(other.square, small.square) >= own)
  }).length
  return { cased: pairs.length, capitalShaped, reaching }
}

/** RGBA `pixels`' ink: its top and bottom row, and its alpha within its bounds averaged into a square; null for none. */
function inkLetter(pixels: Uint8Array, width: number, height: number): Letter | null {
  let left = width
  let right = -1
  let top = height
  let bottom = -1
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if ((pixels[(y * width + x) * 4 + 3] ?? 0) >= INK_ALPHA) {
        left = Math.min(left, x)
        right = Math.max(right, x)
        top = Math.min(top, y)
        bottom = Math.max(bottom, y)
      }
  if (right < 0) return null
  const square = new Float32Array(SQUARE * SQUARE)
  for (let row = 0; row < SQUARE; row++)
    for (let column = 0; column < SQUARE; column++) {
      const [y0, y1] = span(top, bottom - top + 1, row)
      const [x0, x1] = span(left, right - left + 1, column)
      let sum = 0
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) sum += (pixels[(y * width + x) * 4 + 3] ?? 0) / 255
      square[row * SQUARE + column] = sum / ((y1 - y0) * (x1 - x0))
    }
  return { top, bottom, square }
}

/** The mean difference of two rows of a square. */
function rowDifference(square: Float32Array, a: number, b: number): number {
  let sum = 0
  for (let x = 0; x < SQUARE; x++) sum += Math.abs((square[a * SQUARE + x] ?? 0) - (square[b * SQUARE + x] ?? 0))
  return sum / SQUARE
}

/** How many runs of ink, each cell at least half covered, a row of a square holds. */
function inkRuns(square: Float32Array, row: number): number {
  let runs = 0
  let inside = false
  for (let x = 0; x < SQUARE; x++) {
    const ink = (square[row * SQUARE + x] ?? 0) >= 0.5
    if (ink && !inside) runs++
    inside = ink
  }
  return runs
}

/** The middle value of `values`, the upper one of two. */
function middle(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)] ?? 0
}

/** The mean difference of two squares' ink. */
function meanDifference(a: Float32Array, b: Float32Array): number {
  let sum = 0
  for (let i = 0; i < a.length; i++) sum += Math.abs((a[i] ?? 0) - (b[i] ?? 0))
  return sum / a.length
}

/** The pixels from `start` that cell `cell` of `SQUARE` covers along a side of `length`: at least one. */
function span(start: number, length: number, cell: number): [number, number] {
  const from = start + Math.min(length - 1, Math.floor((cell * length) / SQUARE))
  return [from, Math.max(from + 1, start + Math.floor(((cell + 1) * length) / SQUARE))]
}
