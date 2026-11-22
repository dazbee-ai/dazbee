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

/** A fine line round the whole frame, 4% of its shorter side in from its edge, in a colour; the logo then sits inside it. */
export function insetFrame(b: Build, colour: Swatch, opacity = 1) {
  b.framed = true
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

/** The sizes of a group's dots, each a step down the scale from the first. */
const GROUP_STEPS = [1, 0.62, 0.38]

/**
 * A group of three dots, a step down the scale each, from `at` on along `toward` (a direction such as `{ x: -1, y: 1
 * }`), in `colours` in turn: drawn only where every one of them is inside the frame and clear of each box of
 * `clear`, so no dot is ever left on its own.
 */
export function dotGroup(
  b: Build,
  key: string,
  at: { x: number; y: number },
  r: number,
  toward: { x: number; y: number },
  colours: readonly Swatch[],
  clear: readonly Rect[] = [],
) {
  const length = Math.hypot(toward.x, toward.y) || 1
  const [dx, dy] = [toward.x / length, toward.y / length]
  let along = 0
  const list: Dot[] = GROUP_STEPS.map((step, i) => {
    const radius = r * step
    if (i > 0) along += r * (GROUP_STEPS[i - 1] ?? 1) + radius + r * 0.45
    return {
      x: at.x + dx * along,
      y: at.y + dy * along,
      r: radius,
      colour: colours[i % colours.length] ?? b.palette.accent,
    }
  })
  const { width, height } = b.frame
  const room = Math.min(width, height) * 0.02
  const fits = list.every(
    ({ x, y, r: radius }) =>
      x - radius >= 0 &&
      y - radius >= 0 &&
      x + radius <= width &&
      y + radius <= height &&
      clear.every((box) => !meets({ x: x - radius, y: y - radius, width: 2 * radius, height: 2 * radius }, box, room)),
  )
  if (fits) dots(b, key, list)
}

/**
 * A short rule over the words, a rhythm gap over their top, lined up as they are, in `colour`: drawn only where it
 * stays that gap clear of `above` (a seam or the logo), so it reads as part of the words, never as part of an edge.
 * Whether it was drawn.
 */
export function ruleOver(
  b: Build,
  key: string,
  words: Rect,
  gap: number,
  above: number,
  colour: Swatch,
  { thick, length, opacity = 1 }: { thick: number; length: number; opacity?: number },
): boolean {
  const y = Math.round(words.y - gap - thick)
  if (y < above + gap) return false
  const x = b.style.align === 'center' ? words.x + (words.width - length) / 2 : words.x
  b.tree.add(
    key,
    rect(
      'Rule',
      { x: Math.round(x), y, width: length, height: thick },
      solid(colour, opacity === 1 ? undefined : opacity),
    ),
  )
  return true
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
 * seal (playful) or a ring of fine points (premium); edged in `keyline` where it is given, so it keeps its outline
 * on what it is on.
 */
export function badgeShape(b: Build, box: Rect, colour: Swatch, keyline?: Swatch) {
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
  const edge = keyline ? { strokes: [stroke(keyline.value, Math.max(2, round(box.width * 0.02)))] } : {}
  b.tree.add('badge-shape', { ...part, props: { ...part.props, ...edge }, role: 'badge' })
}
