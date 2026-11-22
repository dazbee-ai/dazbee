// The decoration the patterns share, each drawn clear of the words and of a photo's subject: a fine frame inside the
// frame's edge, dots, a bar of colour, a soft light behind a product and a badge.
import type { Rect } from '@dazbee/schema'

import type { Build } from './build.ts'
import { meets } from './crop.ts'
import { inkOn, type Swatch, withAlpha } from './palette.ts'
import { ellipse, radial, rect, round, solid, star, stroke } from './tree.ts'

/** A dot: its centre, its radius, and its colour. */
export interface Dot {
  x: number
  y: number
  r: number
  colour: Swatch
  opacity?: number
}

/** A fine line round the whole frame, 4% of its shorter side in from its edge, in a colour. */
export function insetFrame(b: Build, colour: Swatch, opacity = 1) {
  const { width, height } = b.frame
  const inset = Math.round(Math.min(width, height) * 0.04)
  const weight = Math.max(1, round(Math.min(width, height) * 0.0025))
  const box = { x: inset, y: inset, width: width - 2 * inset, height: height - 2 * inset }
  b.tree.add(
    'frame-line',
    rect('Frame line', box, { fills: [] }, { strokes: [stroke(withAlpha(colour.value, opacity), weight)] }),
  )
}

/** Dots, each a circle in its colour, bound to its brand role; one that would meet a box of `clear` is left out. */
export function dots(b: Build, key: string, list: readonly Dot[], clear: readonly Rect[] = []) {
  const room = Math.min(b.frame.width, b.frame.height) * 0.02
  const kept = list.filter(({ x, y, r }) =>
    clear.every((box) => !meets({ x: x - r, y: y - r, width: 2 * r, height: 2 * r }, box, room)),
  )
  for (const [i, { x, y, r, colour, opacity }] of kept.entries())
    b.tree.add(
      `${key}-${i + 1}`,
      ellipse(`Dot ${i + 1}`, { x: x - r, y: y - r, width: 2 * r, height: 2 * r }, solid(colour, opacity)),
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
      strokes: [
        stroke(
          withAlpha(inkOn(colour.value, [b.palette.background, b.palette.text]).value, 0.7),
          Math.max(1, round(box.width * 0.012)),
        ),
      ],
    }),
  }[b.styleName]
  b.tree.add('badge-shape', { ...part, role: 'badge' })
}
