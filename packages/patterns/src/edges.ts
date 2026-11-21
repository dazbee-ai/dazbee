// A panel of colour whose edge facing the rest of the frame is drawn in the style's way: slanted, straight, waved, or
// fading into what is behind it.
import type { Rect } from '@dazbee/schema'

import type { Build } from './build.ts'
import { type Swatch, withAlpha } from './palette.ts'
import { type Fill, path, rect, round, solid } from './tree.ts'

/** The way a panel's edge is drawn. */
export type Edge = 'slant' | 'straight' | 'wave' | 'fade'

/** The side of a panel its drawn edge is on. */
export type Side = 'top' | 'bottom' | 'left' | 'right'

/** Each style's edge. */
export const STYLE_EDGES = { bold: 'slant', minimal: 'straight', playful: 'wave', premium: 'fade' } as const

/**
 * A panel in `colour` over `box`, its `side` drawn as `edge` within `depth` of that side, so the part of the box past
 * `depth` is wholly the panel's.
 */
export function panel(
  b: Build,
  key: string,
  name: string,
  box: Rect,
  side: Side,
  edge: Edge,
  depth: number,
  colour: Swatch,
) {
  const part =
    edge === 'straight'
      ? rect(name, box, solid(colour))
      : edge === 'fade'
        ? rect(name, box, fade(side, colour.value, depth / extent(box, side)))
        : path(name, box, outline(box, side, edge, depth), solid(colour))
  b.tree.add(key, { ...part, role: 'background' })
}

/** The part of a panel's box clear of its drawn edge. */
export function clearOf(box: Rect, side: Side, depth: number): Rect {
  switch (side) {
    case 'top':
      return { ...box, y: box.y + depth, height: box.height - depth }
    case 'bottom':
      return { ...box, height: box.height - depth }
    case 'left':
      return { ...box, x: box.x + depth, width: box.width - depth }
    case 'right':
      return { ...box, width: box.width - depth }
  }
}

/** How far a box reaches from `side` to the side across from it. */
function extent(box: Rect, side: Side): number {
  return side === 'top' || side === 'bottom' ? box.height : box.width
}

/** A gradient from clear at `side` to the colour, all but opaque past `share` of the way. */
function fade(side: Side, colour: string, share: number): Fill {
  const ends: Record<Side, [[number, number], [number, number]]> = {
    top: [
      [0.5, 0],
      [0.5, 1],
    ],
    bottom: [
      [0.5, 1],
      [0.5, 0],
    ],
    left: [
      [0, 0.5],
      [1, 0.5],
    ],
    right: [
      [1, 0.5],
      [0, 0.5],
    ],
  }
  const [[fx, fy], [tx, ty]] = ends[side]
  const stops = [
    { offset: 0, color: withAlpha(colour, 0) },
    { offset: Math.min(0.9, share), color: withAlpha(colour, 0.9) },
    { offset: 1, color: withAlpha(colour, 0.96) },
  ]
  return { fills: [{ type: 'linear', from: { x: fx, y: fy }, to: { x: tx, y: ty }, stops }] }
}

/**
 * The panel's outline as SVG path data in its box's pixels: its `side` slanted across `depth`, or waved within it,
 * and its other sides straight.
 */
function outline(box: Rect, side: Side, edge: 'slant' | 'wave', depth: number): string {
  const along = side === 'top' || side === 'bottom' ? box.width : box.height
  const across = extent(box, side)
  // A point `u` along the drawn edge and `v` into the panel, in the box's pixels.
  const at = (u: number, v: number): string => {
    const [x, y] = {
      top: [u, v],
      bottom: [u, box.height - v],
      left: [v, u],
      right: [box.width - v, u],
    }[side]
    return `${round(x ?? 0)} ${round(y ?? 0)}`
  }
  const far = `L ${at(along, across)} L ${at(0, across)} Z`
  if (edge === 'slant') return `M ${at(0, depth)} L ${at(along, 0)} ${far}`
  const half = depth / 2
  const waves = Math.max(2, Math.round(along / (depth * 5)))
  const step = along / (waves * 2)
  let d = `M ${at(0, half)}`
  for (let i = 0; i < waves * 2; i++)
    d += ` Q ${at(step * (i + 0.5), i % 2 === 0 ? -half : 3 * half)} ${at(step * (i + 1), half)}`
  return `${d} ${far}`
}
