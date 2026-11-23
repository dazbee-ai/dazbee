// A curved text's letters on its lines' curves (ADR-0021): laid out straight, each paragraph on one
// line, then each glyph moved to its distance along its line's curve and turned to the curve's
// slope at the middle of its advance, as spec #224's "the curves' shapes" gives them. Every size is
// a share of the longest line or the base font size, so the curve scales with the text.
import type { CanvasKit } from '@dazbee/canvaskit'
import type { TextCurve } from '@dazbee/schema'

import type { TextLayout } from './layout.ts'
import { inPlace, placedBounds, type PlacedLine, type PlaceGlyph, placeLetters, type Placement } from './placed.ts'

/** A curved text's letters placed from its box's corner, and the size of the box that holds them. */
export interface CurvedText {
  placed: Placement
  width: number
  height: number
}

/** A line of the straight layout as its curve reads it. */
interface CurveLine {
  /** Its left edge and width in the layer's box. */
  left: number
  width: number
  /** How far its baseline is below the longest line's, by the lines' metrics. */
  below: number
}

/** A point on a line's curve, and the angle of the curve's slope there in radians, clockwise from the right. */
interface OnCurve {
  x: number
  y: number
  angle: number
}

/** Where a point of a line at `x` in the straight layout goes on the line's curve. */
type Along = (line: CurveLine, x: number) => OnCurve

/** A curve's `Along`, and what frees what it made. */
interface Curve {
  along: Along
  delete(): void
}

/** The wave's pieces per wavelength, each a cubic with the sine's slopes at its ends. */
const WAVE_PIECES = 16
/** How finely the wave's lengths are measured: Skia's tolerance of half a pixel over this. */
const WAVE_PRECISION = 16

/**
 * Places a straight layout's letters on `curve`, the base font size `fontSize`, moved so the
 * placement's bounds start at the box's corner; the box is the bounds rounded up to whole pixels.
 * At amount 0 the letters sit where the straight layout puts them.
 */
export function curveLetters(ck: CanvasKit, layout: TextLayout, curve: TextCurve, fontSize: number): CurvedText {
  const lines = curveLines(layout)
  const longest = [...lines.values()].reduce<CurveLine | null>((a, b) => (a && a.width >= b.width ? a : b), null)
  if (curve.amount === 0 || !longest || longest.width <= 0) return toCorner(placeLetters(ck, layout, inPlace), layout)
  const base = longest.below
  for (const line of lines.values()) line.below -= base
  const shape = curveOf(ck, curve, longest, fontSize, layout)
  const place: PlaceGlyph = (line, x, advance, offset) => {
    const on = shape.along(lines.get(keyOf(line)) ?? longest, x + advance / 2)
    const [cos, sin] = [Math.cos(on.angle), Math.sin(on.angle)]
    return [cos, sin, on.x - (cos * advance) / 2 - sin * offset, on.y - (sin * advance) / 2 + cos * offset]
  }
  try {
    return toCorner(placeLetters(ck, layout, place), layout)
  } finally {
    shape.delete()
  }
}

/** Each line of the layout by its block and number, its baseline below the first block's top. */
function curveLines(layout: TextLayout): Map<string, CurveLine> {
  const lines = new Map<string, CurveLine>()
  for (const [i, block] of layout.blocks.entries()) {
    for (const m of block.paragraph.getLineMetrics()) {
      lines.set(`${i} ${m.lineNumber}`, { left: block.x + m.left, width: m.width, below: block.y + m.baseline })
    }
  }
  return lines
}

function keyOf(line: PlacedLine): string {
  return `${line.block} ${line.index}`
}

/** The curve of a shape, its sizes from the longest line and the base font size. */
function curveOf(ck: CanvasKit, curve: TextCurve, longest: CurveLine, fontSize: number, layout: TextLayout): Curve {
  const along = (fn: Along): Curve => ({ along: fn, delete: () => {} })
  switch (curve.shape) {
    case 'arcUp':
    case 'arcDown':
      return along(arcAlong(longest, curve.amount, sideOf(layout), curve.shape === 'arcUp'))
    case 'circle':
      return along(circleAlong(longest, curve.amount))
    case 'wave':
      return waveAlong(ck, longest, curve.amount, fontSize)
  }
}

/** Where the lines line up: -1 at the left, 0 in the middle, 1 at the right. */
function sideOf(layout: TextLayout): number {
  if (layout.align === 'center') return 0
  return (layout.align === 'end') !== layout.rtl ? 1 : -1
}

/**
 * An arc of `amount × 1.8°` on the longest line, its middle highest (`up`) or lowest, every line's
 * arc about one centre, a line further down on a smaller arc up or a larger arc down. A line keeps
 * its letters' distances along it from where its side lines up: the longest line's start, middle or
 * end, at the same angle on every arc.
 */
function arcAlong(longest: CurveLine, amount: number, side: number, up: boolean): Along {
  const sweep = (amount / 100) * Math.PI
  const radius = longest.width / sweep
  const middle = longest.left + longest.width / 2
  const anchor = middle + (side * longest.width) / 2
  const anchorAngle = (side * sweep) / 2
  return (line, x) => {
    const r = Math.max(up ? radius - line.below : radius + line.below, line.width / (2 * Math.PI))
    return onCircle(middle, up ? radius : -radius, r, anchorAngle + (x - anchor) / r, up)
  }
}

/**
 * The longest line round a whole circle of circumference `longest × (2 − amount / 100)`, centred at
 * the top and its letters spread evenly to close it; each other line at its own spacing on a circle
 * about the same centre, a line further down on a smaller one, centred at the top.
 */
function circleAlong(longest: CurveLine, amount: number): Along {
  const radius = (longest.width * (2 - amount / 100)) / (2 * Math.PI)
  const centre = longest.left + longest.width / 2
  return (line, x) => {
    if (line === longest) return onCircle(centre, radius, radius, ((x - centre) * 2 * Math.PI) / line.width, true)
    const r = Math.max(radius - line.below, line.width / (2 * Math.PI))
    return onCircle(centre, radius, r, (x - line.left - line.width / 2) / r, true)
  }
}

/**
 * The point at `angle` from the top (`up`) or the bottom of a circle of radius `r` whose centre is at
 * (`x`, `y`) in a space where the longest line's arc of radius `|y|` passes through 0 at its middle;
 * reading clockwise round the top, or anticlockwise round the bottom.
 */
function onCircle(x: number, y: number, r: number, angle: number, up: boolean): OnCurve {
  // The height off the circle's top or bottom, kept exact for a large radius and a small angle.
  const drop = 2 * r * Math.sin(angle / 2) ** 2
  const at = { x: x + r * Math.sin(angle) }
  return up ? { ...at, y: y - r + drop, angle } : { ...at, y: y + r - drop, angle: -angle }
}

/**
 * A sine `y = −A·sin(2π·(x − start) / λ)` from the longest line's start, `A` the amount's share of the
 * base font size and `λ` six of it, each line on it moved down by its baseline. A point at distance
 * `s` along a line goes `s` along the wave, measured with Skia's contour measure.
 */
function waveAlong(ck: CanvasKit, longest: CurveLine, amount: number, fontSize: number): Curve {
  const height = (amount / 100) * fontSize
  const length = 6 * fontSize
  const k = (2 * Math.PI) / length
  const start = longest.left
  const y = (x: number) => -height * Math.sin(k * (x - start))
  const slope = (x: number) => -height * k * Math.cos(k * (x - start))
  // A wavelength past the longest line, as its length along the wave is never less than across.
  const pieces = Math.ceil(((longest.width + length) / length) * WAVE_PIECES)
  const step = (longest.width + length) / pieces
  const builder = new ck.PathBuilder().moveTo(start, 0)
  for (let i = 0; i < pieces; i++) {
    const [a, b] = [start + i * step, start + (i + 1) * step]
    builder.cubicTo(a + step / 3, y(a) + (step / 3) * slope(a), b - step / 3, y(b) - (step / 3) * slope(b), b, y(b))
  }
  const path = builder.detachAndDelete()
  const contours = new ck.ContourMeasureIter(path, false, WAVE_PRECISION)
  const wave = contours.next()
  return {
    along: (line, x) => {
      const [px = x, py = 0, tx = 1, ty = 0] = wave?.getPosTan(x - start) ?? []
      return { x: px, y: py + line.below, angle: Math.atan2(ty, tx) }
    },
    delete() {
      wave?.delete()
      contours.delete()
      path.delete()
    },
  }
}

/**
 * A placement moved so its glyphs' turned boxes start at the box's corner, and the box's size: their
 * bounds rounded up; the straight layout's size for a text with no glyph.
 */
function toCorner(placed: Placement, layout: TextLayout): CurvedText {
  const bounds = placedBounds(placed.runs)
  if (!bounds) return { placed, width: layout.width, height: layout.height }
  for (const { xforms, boxes } of placed.runs) {
    for (let i = 0; i < xforms.length; i += 4) {
      xforms[i + 2] = (xforms[i + 2] ?? 0) - bounds.x
      xforms[i + 3] = (xforms[i + 3] ?? 0) - bounds.y
    }
    for (let i = 0; i < boxes.length; i += 2) {
      boxes[i] = (boxes[i] ?? 0) - bounds.x
      boxes[i + 1] = (boxes[i + 1] ?? 0) - bounds.y
    }
  }
  return { placed, width: Math.ceil(bounds.width), height: Math.ceil(bounds.height) }
}
