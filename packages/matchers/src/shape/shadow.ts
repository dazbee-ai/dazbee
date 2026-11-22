// Drop shadows: a soft dark fringe beside a shape is its shadow. Parts that look like one are left
// out while the other parts are fitted; then, where the graphics leave a dark fringe uncovered, a
// drop shadow is searched on the lowest graphic that isn't the background, its offset, blur and
// opacity found by drawing.

import type { CanvasKit } from '@dazbee/canvaskit'
import type { DropShadow } from '@dazbee/schema'

import { meanDifference } from './answer.ts'
import { hexColour, type SrgbFloat } from './colour.ts'
import { drawGraphics, type ShapeLayer } from './draw-layers.ts'
import { type FloatPicture, toFloatPicture } from './float-picture.ts'
import { type StackedPart, sum } from './stacking.ts'

/** A shadow's settings while it is searched: offset and blur in piece pixels, alpha 0 to 1. */
interface ShadowTry {
  x: number
  y: number
  blur: number
  alpha: number
}

/** A part more opaque than this, or lighter than this luma, is no shadow. */
const SHADOW_ALPHA = 0.85
const SHADOW_LUMA = 120
/** A shadow's caster is more opaque than it by this much, and fills at least this share of its coverage. */
const CASTER_ALPHA_BY = 0.1
const CASTER_SIZE = 0.8
/** A pixel the graphics leave uncovered by more than this alpha is part of the fringe. */
const UNCOVERED_BY = 0.03
/** A fringe under this share of the piece's coverage is no shadow. */
const SMALLEST_FRINGE = 0.015
/** The most drawings the search makes, about. */
const MOST_DRAWS = 70
/** How far each setting moves at the search's first scale. */
const STEPS: ShadowTry = { x: 2, y: 2, blur: 3, alpha: 0.08 }
/** A shadow is kept when it lowers the mean difference to the piece by this much, of 255. */
const KEPT_BY = 0.05

/** Whether a part looks like a shadow: see-through and dark, beside a larger, more opaque part. */
export function isShadowLike(part: StackedPart, parts: readonly StackedPart[]): boolean {
  if (part.alpha > SHADOW_ALPHA || luma(part.rgb) > SHADOW_LUMA) return false
  return parts.some(
    (other) =>
      other !== part && other.alpha > part.alpha + CASTER_ALPHA_BY && sum(other.filled) > sum(part.mask) * CASTER_SIZE,
  )
}

/**
 * The graphics with a drop shadow on the lowest that isn't the background, where the graphics leave
 * a dark fringe uncovered and a shadow drawn there brings them closer to the piece; the same graphics
 * when not.
 */
export function withShadow(
  ck: CanvasKit,
  fitted: FloatPicture,
  layers: readonly ShapeLayer[],
  pieceWidth: number,
  pieceHeight: number,
  scale: number,
): readonly ShapeLayer[] {
  const drawn = (graphics: readonly ShapeLayer[]) =>
    toFloatPicture(drawGraphics(ck, graphics, pieceWidth, pieceHeight, scale))
  const made = drawn(layers)
  let draws = 1
  const n = fitted.width * fitted.height
  let left = 0
  let total = 0
  let red = 0
  let green = 0
  let blue = 0
  let weight = 0
  let mx = 0
  let my = 0
  for (let i = 0; i < n; i++) {
    const alpha = fitted.data[i * 4 + 3] ?? 0
    total += alpha
    const uncovered = alpha - (made.data[i * 4 + 3] ?? 0)
    if (uncovered <= UNCOVERED_BY) continue
    left += uncovered
    red += (fitted.data[i * 4] ?? 0) * uncovered
    green += (fitted.data[i * 4 + 1] ?? 0) * uncovered
    blue += (fitted.data[i * 4 + 2] ?? 0) * uncovered
    weight += uncovered
    mx += (i % fitted.width) * uncovered
    my += Math.floor(i / fitted.width) * uncovered
  }
  if (weight === 0 || left < total * SMALLEST_FRINGE) return layers
  const rgb: SrgbFloat = [red / weight, green / weight, blue / weight]
  if (luma(rgb) > SHADOW_LUMA) return layers
  const at = layers.findIndex((layer) => layer.role !== 'background')
  const host = layers[at]
  if (!host) return layers
  const box = host.props
  const shadowed = (t: ShadowTry): ShapeLayer[] => {
    const effects: DropShadow[] = [
      {
        type: 'dropShadow',
        x: hundredths(t.x),
        y: hundredths(t.y),
        blur: hundredths(t.blur),
        spread: 0,
        color: hexColour(...rgb, Math.max(0, Math.min(1, t.alpha))),
      },
    ]
    return layers.map((layer, i) => (i === at ? { ...layer, props: { ...layer.props, effects } } : layer))
  }
  const difference = (t: ShadowTry) => {
    draws++
    return meanDifference(fitted, drawn(shadowed(t)))
  }
  // It starts half way from the caster's centre to the fringe's, at a blur of 8 % of the caster's shorter side.
  let best: ShadowTry = {
    x: (mx / weight / scale - (box.x + box.width / 2)) * 0.5,
    y: (my / weight / scale - (box.y + box.height / 2)) * 0.5,
    blur: Math.max(2, Math.min(box.width, box.height) * 0.08),
    alpha: 0.35,
  }
  const before = meanDifference(fitted, made)
  let bestDifference = difference(best)
  let stepScale = 1
  while (stepScale > 0.1 && draws < MOST_DRAWS) {
    let improved = false
    for (const key of ['x', 'y', 'blur', 'alpha'] as const) {
      for (const direction of [1, -1]) {
        const next = { ...best, [key]: best[key] + direction * STEPS[key] * stepScale }
        if (next.blur < 0 || next.alpha <= 0 || next.alpha > 1) continue
        const d = difference(next)
        if (d < bestDifference - 1e-4) {
          bestDifference = d
          best = next
          improved = true
        }
      }
    }
    if (!improved) stepScale /= 2
  }
  return bestDifference > before - KEPT_BY ? layers : shadowed(best)
}

/** A colour's luma, 0 to 255. */
function luma([red, green, blue]: readonly [number, number, number]): number {
  return 0.299 * red + 0.587 * green + 0.114 * blue
}

/** A number rounded to hundredths. */
function hundredths(v: number): number {
  return Math.round(v * 100) / 100
}
