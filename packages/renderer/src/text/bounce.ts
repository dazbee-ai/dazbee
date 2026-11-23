// A text's letters moved one by one (ADR-0021): each letter of a placement raised along its line's
// normal and turned about the middle of its advance on its baseline, by the text's bounce and its
// own letter turn. A letter is a grapheme cluster that isn't white space, as the paragraph's own
// Unicode data breaks it, counted across the whole text from 0 in the text's order.
import { type TextBounce, type TextProps, withRunStyle } from '@dazbee/schema'

import type { TextLayout } from './layout.ts'
import { inPlace, placedBounds, type PlacedLine, type PlacedRun, type PlaceGlyph, type Placement } from './placed.ts'

/** How a letter moves off its place: raised along its line's normal, in pixels, and turned clockwise, in degrees. */
export interface LetterMove {
  raise: number
  turn: number
}

/** A letter of a placement: its line, how far it reaches along it in the straight layout, and where its characters start. */
interface PlacedLetter {
  line: PlacedLine
  from: number
  to: number
  start: number
}

/** A turn about a point by the angle whose cosine and sine these are, and the point moved to (`toX`, `toY`). */
interface PivotMove {
  cos: number
  sin: number
  x: number
  y: number
  toX: number
  toY: number
}

/** A grapheme cluster of white space only, which is no letter. */
const WHITE_SPACE = /^\s+$/u
/** What a random bounce's seed is multiplied by before a letter's own numbers are added. */
const SEED_STRIDE = 65537

/** Whether a text's letters are moved one by one: it has a bounce, or a letter turn other than 0. */
export function movesLetters(props: TextProps): boolean {
  return props.bounce !== undefined || !!props.style.turn || props.runs.some((run) => !!run.style.turn)
}

/**
 * How letter `index` of a text moves by its bounce, at its font size `fontSize`: raised by
 * `r × amount / 100 × fontSize / 2` and turned by `t` degrees, where wavy gives `r = sin(i·π / 3)`
 * and `t = 0`, and random gives `r = u(seed × 65537 + 2i)` and `t = amount / 100 × 20 × u(seed ×
 * 65537 + 2i + 1)`, `u` the first output of mulberry32 mapped to −1 to 1.
 */
export function bounceMove(bounce: TextBounce, index: number, fontSize: number): LetterMove {
  const share = bounce.amount / 100
  if (bounce.style === 'wavy') return { raise: (Math.sin((index * Math.PI) / 3) * share * fontSize) / 2, turn: 0 }
  const base = Math.imul(bounce.seed % 2 ** 32, SEED_STRIDE)
  return {
    raise: (seededUnit(base + 2 * index) * share * fontSize) / 2,
    turn: share * 20 * seededUnit(base + 2 * index + 1),
  }
}

/**
 * A straight text's letters placed where its paragraphs draw them, then moved by its bounce and
 * letter turns. An auto width box grows to hold the moved letters both ways and an auto height box
 * in height only, each by how far they reach past the straight letters on their lines, unraised, so
 * the box holds a raised or lowered letter as it is drawn; a fixed box stays as set.
 * The box keeps its top-left, so letters reaching left or up move the text inside it.
 */
export function moveStraightLetters(layout: TextLayout, placed: Placement, props: TextProps): void {
  // Its boxes before they move, read as the moved ones are, so letters that don't move grow nothing.
  const straight = placedBounds(unraised(placed.runs))
  moveLetters(layout, placed, inPlace, props)
  const moved = placedBounds(placed.runs)
  if (!straight || !moved || props.boxMode === 'fixed') return
  const across = props.boxMode === 'autoWidth'
  const left = across ? Math.max(0, straight.x - moved.x) : 0
  const right = across ? Math.max(0, moved.x + moved.width - straight.x - straight.width) : 0
  const top = Math.max(0, straight.y - moved.y)
  const bottom = Math.max(0, moved.y + moved.height - straight.y - straight.height)
  if (left > 0 || top > 0) shiftPlaced(layout, placed, left, top)
  // A box that grows is whole pixels, as a curved text's is.
  if (left + right > 0) layout.width = Math.ceil(layout.width + left + right)
  if (top + bottom > 0) layout.height = Math.ceil(layout.height + top + bottom)
}

/**
 * Moves each letter of a layout's placement by the text's bounce and its letter turn: its glyphs
 * turned about the middle of its advance on its baseline, where `place` puts that point, and raised
 * along the normal there, by its font size as the layout draws it (its set size by the layout's scale).
 */
export function moveLetters(layout: TextLayout, placed: Placement, place: PlaceGlyph, props: TextProps): void {
  const { index, starts } = lettersOf(layout, props.text.length)
  const letters = new Map<number, PlacedLetter>()
  for (const { line, offsets, origins, advances } of placed.runs) {
    for (let g = 0; g < offsets.length; g++) {
      const at = offsets[g] ?? 0
      const i = index[at] ?? -1
      if (i < 0) continue
      const from = origins[2 * g] ?? 0
      const to = from + (advances[g] ?? 0)
      const letter = letters.get(i)
      if (letter) [letter.from, letter.to] = [Math.min(letter.from, from), Math.max(letter.to, to)]
      else letters.set(i, { line, from, to, start: starts[at] ?? at })
    }
  }
  const moves = new Map<number, PivotMove>()
  for (const [i, letter] of letters) {
    const style = styleAt(props, letter.start)
    const move = props.bounce ? bounceMove(props.bounce, i, style.fontSize * layout.scale) : { raise: 0, turn: 0 }
    const turn = move.turn + (style.turn ?? 0)
    if (move.raise === 0 && turn === 0) continue
    const [cos, sin, x, y] = place(letter.line, (letter.from + letter.to) / 2, 0, 0)
    const angle = (turn * Math.PI) / 180
    moves.set(i, {
      cos: Math.cos(angle),
      sin: Math.sin(angle),
      x,
      y,
      toX: x + move.raise * sin,
      toY: y - move.raise * cos,
    })
  }
  if (moves.size === 0) return
  for (const { offsets, xforms, boxes } of placed.runs) {
    for (let g = 0; g < offsets.length; g++) {
      const move = moves.get(index[offsets[g] ?? 0] ?? -1)
      if (!move) continue
      const [scos, ssin] = [xforms[4 * g] ?? 1, xforms[4 * g + 1] ?? 0]
      xforms[4 * g] = scos * move.cos - ssin * move.sin
      xforms[4 * g + 1] = ssin * move.cos + scos * move.sin
      moveAt(xforms, 4 * g + 2, move)
      for (let c = 0; c < 8; c += 2) moveAt(boxes, 8 * g + c, move)
    }
  }
}

/** Moves a placement's glyphs and the layout's list markers right and down, as a box keeping its top-left does. */
export function shiftPlaced(layout: TextLayout, placed: Placement, dx: number, dy: number) {
  for (const { xforms, boxes } of placed.runs) {
    for (let i = 0; i < xforms.length; i += 4) {
      xforms[i + 2] = (xforms[i + 2] ?? 0) + dx
      xforms[i + 3] = (xforms[i + 3] ?? 0) + dy
    }
    for (let i = 0; i < boxes.length; i += 2) {
      boxes[i] = (boxes[i] ?? 0) + dx
      boxes[i + 1] = (boxes[i + 1] ?? 0) + dy
    }
  }
  for (const block of layout.blocks) {
    block.markerX += dx
    block.markerY += dy
  }
}

/** The first 32-bit output of mulberry32 seeded with `n` (taken modulo 2³²), mapped to −1 to 1. */
function seededUnit(n: number): number {
  let t = ((n >>> 0) + 0x6d2b79f5) >>> 0
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 2 ** 31 - 1
}

/** Runs with their glyphs' boxes where they sit without their raise, on their lines. */
function unraised(runs: readonly PlacedRun[]): PlacedRun[] {
  return runs.map((run) =>
    run.raiseShift === 0 ? run : { ...run, boxes: run.boxes.map((v, i) => (i % 2 === 1 ? v - run.raiseShift : v)) },
  )
}

/**
 * Each UTF-16 unit of a laid-out text of `length` units: its letter's number, -1 in white space or
 * where no paragraph draws it; and where the grapheme it is in starts. Graphemes are the paragraphs'
 * own (CanvasKit's Unicode data), so every runtime counts letters alike; a unit a paragraph gives no
 * grapheme for, past where it is cut, is one of its own.
 */
function lettersOf(layout: TextLayout, length: number) {
  const index = new Int32Array(length).fill(-1)
  const starts = new Uint32Array(length)
  let count = 0
  for (const block of layout.blocks) {
    for (let at = 0; at < block.text.length;) {
      const range = block.paragraph.getGlyphInfoAt(at)?.graphemeClusterTextRange
      const end = range && range.start <= at && range.end > at ? range.end : at + 1
      const [from, to] = [block.start + at, Math.min(block.start + end, length)]
      starts.fill(from, from, to)
      if (!WHITE_SPACE.test(block.text.slice(at, end))) index.fill(count++, from, to)
      at = end
    }
  }
  return { index, starts }
}

/** The style a character of a text is set in: its base style with the runs over it. */
function styleAt(props: TextProps, offset: number): TextProps['style'] {
  let style = props.style
  for (const run of props.runs) if (run.start <= offset && run.end > offset) style = withRunStyle(style, run.style)
  return style
}

/** Moves the point at `at` in `values` by a move about a point. */
function moveAt(values: Float32Array, at: number, move: PivotMove) {
  const [dx, dy] = [(values[at] ?? 0) - move.x, (values[at + 1] ?? 0) - move.y]
  values[at] = move.cos * dx - move.sin * dy + move.toX
  values[at + 1] = move.sin * dx + move.cos * dy + move.toY
}
