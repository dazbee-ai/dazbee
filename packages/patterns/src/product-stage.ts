// The colours a product is staged in: its main inks, read from its pixels, and the colour of a shape behind it plainly
// apart from them, so the product keeps its silhouette.
import type { Build } from './build.ts'
import { apart, inkOn, mixed, type Swatch } from './palette.ts'

/** How plainly a backing shape's colour is apart from the product's main inks: by contrast, or by CIEDE2000. */
const LIGHT_APART = { ratio: 1.6, difference: 25 }
/** The least share of a product's ink a colour of it takes to be one of its main inks. */
const MAIN_INK = 0.25
/** The share of the ground's ink a backing shape is tinted with where no colour of the kit is apart from the product. */
const LIGHT_TINT = 0.12

/** The product's main inks, where its pixels were read. */
export function mainInks(b: Build): string[] {
  return (b.content.photo?.look?.inks ?? []).filter((ink) => ink.share >= MAIN_INK).map((ink) => ink.colour)
}

/**
 * The colour of a backing shape behind the product drawn at `opacity` on `ground`: the first of `offered`, but the
 * ground's own, that as drawn is plainly apart from every main ink of the product, so its silhouette holds; else a
 * faint tint of the ground's ink.
 */
export function lightColour(b: Build, offered: readonly Swatch[], ground: Swatch, opacity = 1): Swatch {
  const inks = mainInks(b)
  const drawn = (swatch: Swatch) => (opacity < 1 ? mixed(ground.value, swatch.value, opacity) : swatch.value)
  const found = offered.find(
    (swatch) =>
      swatch.value !== ground.value &&
      inks.every((ink) => apart(drawn(swatch), ink, LIGHT_APART.ratio, LIGHT_APART.difference)),
  )
  if (found) return found
  const ink = inkOn(ground.value, [b.palette.text, b.palette.background]).value
  return { value: mixed(ground.value, ink, Math.min(1, LIGHT_TINT / opacity)) }
}
