// Product in an arch: the product, best a cut-out, standing at the foot of a tall arch of colour, a window of its own,
// with a soft shadow under it, and the words and button under it or beside it. The style draws the arch: in the accent
// over a hard offset arch of the deep colour (bold), a pale tint (minimal), rounded at its foot too with a group of
// dots (playful), or a fine accent outline round a soft light (premium); always in a colour plainly apart from the
// product's own, so it keeps its silhouette.
import type { Rect } from '@dazbee/schema'

import { type Build, ground, roles, usualWords } from '../build.ts'
import { ctaFill } from '../button.ts'
import { coverCrop } from '../crop.ts'
import { dotGroup, glow } from '../decorations.ts'
import { layOut } from '../layout.ts'
import { deepColour, mixed, ornamentColour, type Swatch } from '../palette.ts'
import { isCutOut, lightColour, standProduct } from '../product-stage.ts'
import { picture, rect, round, solid, stroke } from '../tree.ts'
import type { Pattern } from '../types.ts'

export const ARCH: Pattern = {
  id: 'arch',
  name: 'Product in an arch',
  kinds: ['product launch', 'single product'],
  description:
    'The product, best a cut-out, standing at the foot of a tall arch of brand colour, like a shop window, with the words and button under or beside it.',
  needs: ['headline', 'photo'],
  takes: ['kicker', 'subline', 'button', 'highlight', 'logo'],
}

/** The arch's width over its height. */
const ARCH_RATIO = 0.78
/** How far the product reaches past the arch's sides, as a share of the arch's width, and its share of the arch's height. */
const PRODUCT_PAST = 0.06
const PRODUCT_DOWN = 0.62

/** Builds the product in an arch in the frame. */
export function arch(b: Build) {
  const { palette, content } = b
  const colour = ground(b)
  layOut(b, {
    ground: colour,
    words: {
      parts: usualWords(content),
      ...(content.button ? { button: content.button, buttonFill: ctaFill(palette, colour, roles(b).cta) } : {}),
    },
    visual: { ratio: ARCH_RATIO, draw: (box) => drawArch(b, box, colour), short: false },
  })
}

/**
 * The arch in `box` in the style's way: a cut-out stands at its foot; any other photo fills it, as a window, its
 * subject kept whole where it can be.
 */
function drawArch(b: Build, box: Rect, colour: Swatch) {
  const { styleName, palette, frame, content } = b
  const r = Math.round(box.width / 2)
  const foot = styleName === 'playful' ? Math.round(r * 0.3) : 0
  const corners: [number, number, number, number] = [r, r, foot, foot]
  const cut = isCutOut(content.photo)
  const fill = archColour(b, colour)
  let window = box
  if (styleName === 'bold') {
    const by = Math.max(3, Math.round(Math.min(frame.width, frame.height) * 0.014))
    const shadow = { ...box, x: box.x + by, y: box.y + by, width: box.width - by, height: box.height - by }
    b.tree.add('arch-shadow', rect('Arch shadow', shadow, solid(deepColour(palette)), { radius: corners }))
    window = { ...box, width: box.width - by, height: box.height - by }
  }
  if (!cut && content.photo) {
    const shot = coverCrop(content.photo, window)
    const part = picture('Photo', window, content.photo, { crop: shot.crop })
    b.tree.add('photo', { ...part, props: { ...part.props, shape: { kind: 'rect', cornerRadius: 0, corners } } })
  } else if (styleName === 'premium')
    glow(b, 'light', { ...box, y: box.y + box.height * 0.2, height: box.height * 0.8 }, fill.value, 0.35)
  else b.tree.add('arch', rect('Arch', window, solid(fill), { radius: corners }))
  if (styleName === 'premium') {
    // A fine line round the arch, a little out from it where a photo fills it.
    const { colour: line, opacity } = ornamentColour(palette, colour.value)
    const out = cut ? 0 : Math.round(box.width * 0.035)
    const ring = { x: box.x - out, y: box.y - out, width: box.width + 2 * out, height: box.height + out }
    const weight = Math.max(1, round(box.width * 0.008))
    const radius: [number, number, number, number] = [r + out, r + out, 0, 0]
    const stroked = rect('Arch line', ring, { fills: [] }, { radius, strokes: [stroke(line.value, weight)] })
    b.tree.add('arch-line', { ...stroked, props: { ...stroked.props, opacity } })
  }
  if (!cut) return
  const past = box.width * PRODUCT_PAST
  const room = {
    x: box.x - past,
    y: box.y + box.height * (1 - PRODUCT_DOWN),
    width: box.width + 2 * past,
    height: box.height * PRODUCT_DOWN * 0.94,
  }
  standProduct(b, room, colour)
  if (styleName === 'playful') {
    const dot = Math.min(frame.width, frame.height) * 0.025
    dotGroup(b, 'dot', { x: box.x + box.width - dot, y: box.y + dot * 2 }, dot, { x: 0.6, y: -1 }, [
      palette.accent,
      palette.secondary,
      palette.primary,
    ])
  }
}

/** The arch's colour: plainly apart from the ground and from the product's main inks, in the style's way. */
function archColour(b: Build, colour: Swatch): Swatch {
  const { palette, styleName } = b
  if (styleName === 'minimal') {
    const tint = { value: mixed(colour.value, palette.primary.value, 0.1) }
    return lightColour(b, [tint, { value: mixed(colour.value, palette.accent.value, 0.16) }], colour)
  }
  const order = [palette.accent, palette.secondary, palette.primary, palette.background]
  return lightColour(b, order, colour)
}
