// The decoration the patterns share, each drawn clear of the words: a fine frame inside the frame's edge, dots, a
// bar of colour, a soft light behind a product, a badge and quotation marks.
import type { Rect } from '@dazbee/schema'

import type { Build } from './build.ts'
import { type Swatch, withAlpha } from './palette.ts'
import { ellipse, path, radial, rect, round, solid, star, stroke } from './tree.ts'

/** A dot: its centre, its radius, and its colour. */
export interface Dot {
  x: number
  y: number
  r: number
  colour: Swatch
  opacity?: number
}

/** A fine line round the frame, `inset` in from its edge, in a colour. */
export function insetFrame(b: Build, colour: Swatch, inset: number, opacity = 1) {
  const { width, height } = b.frame
  const weight = Math.max(1, round(Math.min(width, height) * 0.0025))
  const box = { x: inset, y: inset, width: width - 2 * inset, height: height - 2 * inset }
  b.tree.add(
    'frame-line',
    rect('Frame line', box, { fills: [] }, { strokes: [stroke(withAlpha(colour.value, opacity), weight)] }),
  )
}

/** Dots, each a circle in its colour, bound to its brand role. */
export function dots(b: Build, key: string, list: readonly Dot[], parent?: string) {
  for (const [i, { x, y, r, colour, opacity }] of list.entries())
    b.tree.add(
      `${key}-${i + 1}`,
      ellipse(`Dot ${i + 1}`, { x: x - r, y: y - r, width: 2 * r, height: 2 * r }, solid(colour, opacity)),
      parent,
    )
}

/** A bar of colour over `box`, bound to its brand role. */
export function bar(b: Build, key: string, name: string, box: Rect, colour: Swatch, radius = 0, parent?: string) {
  b.tree.add(key, rect(name, box, solid(colour), { radius }), parent)
}

/** A soft light in a colour, fading out to clear, filling `box`. */
export function glow(b: Build, key: string, box: Rect, colour: string, strength = 0.9) {
  b.tree.add(key, ellipse('Light', box, radial([withAlpha(colour, strength), withAlpha(colour, 0)])))
}

/**
 * A badge's shape filling the box, in the style's way: a burst of points (bold), a square (minimal), a scalloped
 * seal (playful) or a ring of fine points (premium).
 */
export function badgeShape(b: Build, box: Rect, colour: Swatch) {
  const fill = solid(colour)
  const part = {
    bold: star('Badge', box, { points: 16, inner: 0.82 }, fill, { rotation: 8 }),
    minimal: rect('Badge', box, fill),
    playful: star('Badge', box, { points: 12, inner: 0.86, radius: round(box.width * 0.05) }, fill, { rotation: -10 }),
    premium: ellipse('Badge', box, fill, {
      strokes: [stroke(withAlpha('#FFFFFF', 0.7), Math.max(1, round(box.width * 0.012)))],
    }),
  }[b.styleName]
  b.tree.add('badge-shape', { ...part, role: 'badge' })
}

/**
 * Quotation marks, two drawn commas, filling `box` in a colour: the opening marks a quote starts with, drawn as
 * shapes so they never count as text.
 */
export function quoteMarks(b: Build, box: Rect, colour: Swatch, opacity = 1) {
  // Two marks, each a disc with a tail, drawn on a 98 × 80 grid.
  const mark = (dx: number) =>
    `M ${dx + 20} 80 C ${dx + 8} 80 ${dx} 71 ${dx} 58 C ${dx} 44 ${dx + 10} 36 ${dx + 22} 36 C ${dx + 24} 36 ${dx + 25} 36 ${dx + 26} 37 C ${dx + 24} 24 ${dx + 15} 14 ${dx + 2} 9 L ${dx + 6} 0 C ${dx + 29} 7 ${dx + 44} 26 ${dx + 44} 52 C ${dx + 44} 69 ${dx + 34} 80 ${dx + 20} 80 Z`
  const marks = path('Quotation marks', box, `${mark(0)} ${mark(54)}`, solid(colour, opacity), {
    width: 98,
    height: 80,
  })
  b.tree.add('quote-marks', marks)
}
