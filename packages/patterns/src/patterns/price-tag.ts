// Product with a price tag: the product, best a cut-out, with its price on a hang tag at its top corner, a hole
// punched at the tag's point, and the words and button beside or under it. A short frame, with no room for the
// product, sets the price as a chip before its words. The style draws the tag: square in the accent (bold), a fine outline
// (minimal), rounded in the accent (playful), or in the accent with a fine inner line (premium).
import { type Rect, TextProps } from '@dazbee/schema'

import { type Build, ground, isShort, roles, usualWords } from '../build.ts'
import { ctaFill } from '../button.ts'
import { card } from '../card.ts'
import { layOut, type Visual } from '../layout.ts'
import { type Swatch, withAlpha } from '../palette.ts'
import { standProduct } from '../product-stage.ts'
import { inkFor, lookStyle } from '../text-look.ts'
import { ellipse, path, rect, round, solid, stroke } from '../tree.ts'
import type { Pattern } from '../types.ts'

export const PRICE_TAG: Pattern = {
  id: 'price-tag',
  name: 'Product with a price tag',
  kinds: ['single product', 'sale or offer'],
  description:
    'The product, best a cut-out, with its price (`number`, such as “₹2,499”) on a hang tag at its top corner, and the words and button beside or under it.',
  needs: ['headline', 'photo', 'number'],
  takes: ['kicker', 'subline', 'button', 'highlight', 'logo'],
}

/** The product and its tag's width over their height. */
const RATIO = 1.15
/** The tag's height as a share of the visual's height, its words' share of its height, and its room at the ends. */
const TAG = { down: 0.2, words: 0.5, ends: 0.42 }
/** How far the tag's point reaches, as a share of its height. */
const POINT = 0.42

/** Builds the product with a price tag in the frame. */
export function priceTag(b: Build) {
  const { palette, content } = b
  // A short frame, with no room for the product, sets the price as a chip before the words that fit beside it.
  if (isShort(b)) {
    card(b, { stub: [{ kind: 'number', text: content.number ?? '' }], tear: 'dashes', shortOn: 'ground' })
    return
  }
  const colour = ground(b)
  const visual: Visual = { ratio: RATIO, draw: (box) => productAndTag(b, box, colour), short: false }
  layOut(b, {
    ground: colour,
    words: {
      parts: usualWords(content),
      ...(content.button ? { button: content.button, buttonFill: ctaFill(palette, colour, roles(b).cta) } : {}),
    },
    visual,
  })
}

/** The product in `box`, under the tag at its top right. */
function productAndTag(b: Build, box: Rect, colour: Swatch) {
  const height = Math.max(b.frame.readable * 2, box.height * TAG.down)
  const width = Math.min(box.width * 0.6, height * tagRatio(b, height))
  const tagBox = { x: box.x + box.width - width, y: box.y, width, height: width / tagRatio(b, height) }
  const room = {
    x: box.x,
    y: box.y + tagBox.height * 0.55,
    width: box.width - width * 0.35,
    height: box.height - tagBox.height * 0.55,
  }
  standProduct(b, room, colour)
  tag(b, tagBox, colour)
}

/** The tag's width over its height, for its price set at the size it takes `height` tall. */
function tagRatio(b: Build, height: number): number {
  const size = Math.max(b.frame.readable, Math.round(height * TAG.words))
  const props = priceProps(b, size, 1000, '#000000FF')
  const words = b.measure(props, null).width
  return (words + size * TAG.ends * 2 + height * POINT) / height
}

/** The tag over `box`, its point at the left with the hole, and the price in it. */
function tag(b: Build, box: Rect, colour: Swatch) {
  const { palette, styleName, frame } = b
  const fill = ctaFill(palette, colour, 'accent').fill
  const point = box.height * POINT
  const r = styleName === 'playful' ? box.height * 0.18 : 0
  const { width: w, height: h } = box
  const d = `M ${round(point)} 0 L ${round(w - r)} 0 Q ${round(w)} 0 ${round(w)} ${round(r)} L ${round(w)} ${round(h - r)} Q ${round(w)} ${round(h)} ${round(w - r)} ${round(h)} L ${round(point)} ${round(h)} L 0 ${round(h / 2)} Z`
  const outline = styleName === 'minimal'
  const ink = outline
    ? inkFor(b, colour.value, frame.readable)
    : inkFor(b, fill.value, frame.readable, [palette.text, palette.background])
  const shape = outline
    ? {
        ...path('Tag', box, d, { fills: [] }),
        props: {
          ...path('Tag', box, d, { fills: [] }).props,
          strokes: [stroke(ink.value, Math.max(1, round(h * 0.04)))],
        },
      }
    : path('Tag', box, d, solid(fill))
  b.tree.add('tag', { ...shape, role: 'badge' })
  const hole = Math.max(3, h * 0.14)
  b.tree.add(
    'tag-hole',
    ellipse(
      'Tag hole',
      { x: box.x + point * 0.55 - hole / 2, y: box.y + h / 2 - hole / 2, width: hole, height: hole },
      solid(colour),
    ),
  )
  if (styleName === 'premium') {
    const by = Math.max(2, round(h * 0.08))
    const inner = { x: box.x + point, y: box.y + by, width: w - point - by, height: h - 2 * by }
    b.tree.add(
      'tag-line',
      rect(
        'Tag line',
        inner,
        { fills: [] },
        { strokes: [stroke(withAlpha(ink.value, 0.5), Math.max(1, round(h * 0.02)))] },
      ),
    )
  }
  const size = Math.max(frame.readable, Math.round(h * TAG.words))
  const words = { x: box.x + point, width: w - point, height: h }
  const props = { ...priceProps(b, size, words.width, ink.value), x: round(words.x), y: round(box.y), height: round(h) }
  const font = palette.heading
  b.tree.add('price', {
    type: 'text',
    name: 'Price',
    role: 'price',
    props,
    bindings: { ...(font.ref ? { fontFamily: font.ref } : {}), ...(ink.ref ? { textColor: ink.ref } : {}) },
  })
}

/** The price in the headline's face at `size`, centred in a box `width` wide. */
function priceProps(b: Build, size: number, width: number, colour: string) {
  return TextProps.parse({
    x: 0,
    y: 0,
    width,
    height: size,
    text: b.content.number ?? '',
    style: { ...lookStyle(b, b.style.headline, size), color: colour, lineHeight: 1 },
    align: 'center',
    verticalAlign: 'middle',
    boxMode: 'fixed',
  })
}
