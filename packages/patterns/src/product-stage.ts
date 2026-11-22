// How a product is staged: standing at the foot of its room with a soft shadow under a cut-out, and the colours round
// it, its main inks read from its pixels and the colour of a shape behind it plainly apart from them, so the product
// keeps its silhouette.
import type { Rect } from '@dazbee/schema'

import type { Build } from './build.ts'
import { type Cropped, fitCrop } from './crop.ts'
import { apart, inkOn, mixed, type Swatch, withAlpha } from './palette.ts'
import { ellipse, picture, radial } from './tree.ts'
import type { Picture } from './types.ts'

/** How plainly a backing shape's colour is apart from the product's main inks: by contrast, or by CIEDE2000. */
const LIGHT_APART = { ratio: 1.6, difference: 25 }
/** The least share of a product's ink a colour of it takes to be one of its main inks. */
const MAIN_INK = 0.25
/** The share of the ground's ink a backing shape is tinted with where no colour of the kit is apart from the product. */
const LIGHT_TINT = 0.12
/** The strength of the soft shadow under a cut-out standing on the floor. */
const FLOOR_SHADOW = 0.22

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

/** Whether a picture is a cut-out, its pixels read as clear round what it shows. */
export function isCutOut(picture: Picture | undefined): boolean {
  return Boolean(picture?.look?.extent)
}

/**
 * The product standing at the foot of `room`, fitted whole by its subject and centred across it, with a soft shadow on
 * the floor under a cut-out, in the ground's ink; where it went, none without a photo.
 */
export function standProduct(b: Build, room: Rect, ground: Swatch): Cropped | undefined {
  const photo = b.content.photo
  if (!photo) return undefined
  const fitted = fitCrop(photo, room, { x: 'center', y: 'end' })
  if (isCutOut(photo)) {
    const { box } = fitted
    const ink = inkOn(ground.value, [b.palette.text, b.palette.background]).value
    const floor = {
      x: box.x + box.width * 0.12,
      y: box.y + box.height - box.height * 0.06,
      width: box.width * 0.76,
      height: Math.max(4, box.height * 0.1),
    }
    b.tree.add('floor', ellipse('Floor shadow', floor, radial([withAlpha(ink, FLOOR_SHADOW), withAlpha(ink, 0)])))
  }
  b.tree.add('product', picture('Product', fitted.box, photo, { crop: fitted.crop }))
  return fitted
}
