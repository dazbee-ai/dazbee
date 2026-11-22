// Product on a podium: the product, best a cut-out, standing on a round podium, its top face lit, so it reads as a
// thing on show, with the words and button beside or under it. The style draws the podium: two tiers in the accent
// and the deep colour (bold), one pale tier (minimal), two rounded tiers with a group of dots (playful), or a deep
// tier with a fine accent rim and a soft light behind the product (premium); always plainly apart from the product.
import type { Rect } from '@dazbee/schema'

import { type Build, ground, roles, usualWords } from '../build.ts'
import { ctaFill } from '../button.ts'
import { dotGroup, glow } from '../decorations.ts'
import { layOut } from '../layout.ts'
import { deepColour, mixed, ornamentColour, type Swatch, WHITE } from '../palette.ts'
import { lightColour, standProduct } from '../product-stage.ts'
import { ellipse, rect, round, solid, stroke } from '../tree.ts'
import type { Pattern } from '../types.ts'

export const PODIUM: Pattern = {
  id: 'podium',
  name: 'Product on a podium',
  kinds: ['single product', 'product launch', 'sale or offer'],
  description:
    'The product, best a cut-out, standing on a round podium of brand colour, its top face lit, with the words and button under or beside it.',
  needs: ['headline', 'photo'],
  takes: ['kicker', 'subline', 'button', 'highlight', 'logo'],
}

/** The podium and product's width over their height. */
const PODIUM_RATIO = 1.05
/** The podium's width, its top face's depth and its tier's height, as shares of the visual's width. */
const TIER = { width: 0.86, face: 0.16, height: 0.13 }

/** Builds the product on a podium in the frame. */
export function podium(b: Build) {
  const { palette, content } = b
  const colour = ground(b)
  layOut(b, {
    ground: colour,
    words: {
      parts: usualWords(content),
      ...(content.button ? { button: content.button, buttonFill: ctaFill(palette, colour, roles(b).cta) } : {}),
    },
    visual: { ratio: PODIUM_RATIO, draw: (box) => drawPodium(b, box, colour), short: false },
  })
}

/** The podium at the foot of `box` in the style's way, and the product standing on it. */
function drawPodium(b: Build, box: Rect, colour: Swatch) {
  const { styleName, palette, frame } = b
  const width = box.width * TIER.width
  const face = box.width * TIER.face
  const tall = box.width * TIER.height
  const x = box.x + (box.width - width) / 2
  const two = styleName === 'bold' || styleName === 'playful'
  const top = lightColour(b, [palette.accent, palette.secondary, palette.primary, palette.background], colour)
  const lower = two ? lightColour(b, [deepColour(palette), palette.secondary, palette.text], top) : top
  const minimal = styleName === 'minimal'
  const main = minimal ? { value: mixed(colour.value, palette.primary.value, 0.12) } : top
  const premium = styleName === 'premium'
  const body = premium ? { value: mixed(colour.value, '#000000FF', 0.35) } : main
  // The lower tier, wider, under the upper one.
  const foot = box.y + box.height - face / 2
  if (two) tier(b, 'tier-2', { x: box.x, y: foot - tall * 0.7, width: box.width, height: tall * 0.7 }, face, lower)
  const upperFoot = two ? foot - tall * 0.7 : foot
  const upper = { x, y: upperFoot - tall, width, height: tall }
  if (premium)
    glow(b, 'light', { x: box.x, y: box.y, width: box.width, height: upper.y - box.y + face }, top.value, 0.35)
  tier(b, 'tier-1', upper, face * (width / box.width), body)
  if (premium) {
    const { colour: rim, opacity } = ornamentColour(palette, body.value)
    const weight = Math.max(1, round(width * 0.008))
    const cap = { x, y: upper.y - (face * (width / box.width)) / 2, width, height: face * (width / box.width) }
    const ring = ellipse('Rim', cap, { fills: [] }, { strokes: [stroke(rim.value, weight)] })
    b.tree.add('rim', { ...ring, props: { ...ring.props, opacity } })
  }
  const capDepth = face * (width / box.width)
  const room = { x: x + width * 0.04, y: box.y, width: width * 0.92, height: upper.y - box.y + capDepth * 0.15 }
  standProduct(b, room, colour)
  if (styleName === 'playful') {
    const dot = Math.min(frame.width, frame.height) * 0.022
    dotGroup(b, 'dot', { x: box.x + dot, y: box.y + dot * 2 }, dot, { x: 0.5, y: 1 }, [
      palette.accent,
      palette.secondary,
      palette.primary,
    ])
  }
}

/** A round tier of the podium: its side from its top face down `box`, its top face `face` deep, lit. */
function tier(b: Build, key: string, box: Rect, face: number, colour: Swatch) {
  const side = { ...box, height: box.height }
  b.tree.add(`${key}-side`, rect('Podium side', side, solid(colour)))
  b.tree.add(
    `${key}-base`,
    ellipse(
      'Podium base',
      { x: box.x, y: box.y + box.height - face / 2, width: box.width, height: face },
      solid(colour),
    ),
  )
  const lit = { value: mixed(colour.value, WHITE.value, 0.28) }
  b.tree.add(
    `${key}-top`,
    ellipse('Podium top', { x: box.x, y: box.y - face / 2, width: box.width, height: face }, solid(lit)),
  )
}
