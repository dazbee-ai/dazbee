// The furthest the panels' number fields go: past these a design only breaks (text that leaves the
// canvas, a box millions of pixels wide), so a value typed, stepped or dragged stops at them. Every
// field stops at `any` either way unless it has its own, closer, limits.
import { RAISE_MOST, TILE_SCALE } from '@dazbee/schema'

export const LIMITS = {
  any: 100_000,
  fontSize: 2_000,
  lineHeight: 10,
  /** Either way, in pixels or in percent of the font size. */
  letterSpacing: 1_000,
  paragraphSpacing: 1_000,
  effectOffset: 10_000,
  effectBlur: 1_000,
  effectSpread: 1_000,
  /** A tiled image's scale, as stored: 1000 % of its own size, as the schema holds it. */
  tileScale: TILE_SCALE.max,
  /** Either way, in percent of the font size, as the schema holds it. */
  raise: RAISE_MOST,
} as const

/**
 * Where a number field stops, below and above: its own limits, `least` and `most`, else LIMITS.any
 * either way. An infinite limit, as a turn's, which wraps round, is no stop.
 */
export const fieldStops = (least: number | undefined, most: number | undefined) => ({
  min: least ?? -LIMITS.any,
  max: most ?? LIMITS.any,
})
