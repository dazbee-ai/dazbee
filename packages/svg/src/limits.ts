/** More layers than this, or a file larger than MAX_SVG_BYTES, is refused, so a hostile file can't run away with the page. */
export const MAX_LAYERS = 5_000
/**
 * Elements read, counting each time a <use> reads one again, and how deep elements and uses may
 * nest: past these the file is refused, so a fan of uses that draw nothing can't run away either.
 */
export const MAX_WORK = 100_000
export const MAX_NESTING = 400
