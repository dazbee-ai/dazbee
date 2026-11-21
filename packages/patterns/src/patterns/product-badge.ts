// Product with a badge: the product, best a cut-out, in a light of its own, a badge on its corner holding a few words
// (an offer, “New”), and the words beside or above it with the button. The style draws the badge and the light: a
// burst on brand colour (bold), a square on a pale disc (minimal), a seal on a big accent disc with dots (playful),
// or a ringed seal under a gold ring on a dark ground (premium).
import { type Rect, TextProps } from '@dazbee/schema'

import { type Build, logo, logoRoom, usualWords } from '../build.ts'
import { badgeShape, dots, glow, insetFrame } from '../decorations.ts'
import { contrast, type Swatch } from '../palette.ts'
import { inkFor } from '../text-look.ts'
import { ellipse, fitted, picture, rect, round, solid, stroke } from '../tree.ts'
import type { Pattern } from '../types.ts'
import { rowWords, stackWords, type Words } from '../words.ts'

export const PRODUCT_BADGE: Pattern = {
  id: 'product-badge',
  name: 'Product with a badge',
  kinds: ['single product', 'sale or offer', 'product launch'],
  description:
    'The product, best a cut-out on clear, in a light of its own with a badge on its corner (an offer or “New”), and the words and button beside or above it.',
  needs: ['headline', 'photo', 'badge'],
  takes: ['kicker', 'subline', 'button', 'highlight', 'logo'],
}

/** The share of a badge's width its words take. */
const INSIDE = 0.62

/** Where the product, the words, the button and the logo go. */
interface Places {
  product: Rect
  words: Rect
  /** The button's own room under the product; none where the button goes with the words. */
  button?: Rect
  logo?: Rect
  /** The badge's diameter. */
  badge: number
}

/** Builds the product with a badge in the frame. */
export function productBadge(b: Build) {
  const { frame, styleName, palette, content } = b
  const ground = groundColour(b)
  if (ground !== palette.background)
    b.tree.add('ground', {
      ...rect('Ground', { x: 0, y: 0, width: frame.width, height: frame.height }, solid(ground)),
      role: 'background',
    })
  const places = arrange(b)
  if (places.logo) logo(b, places.logo, b.style.align === 'center' ? 'center' : 'start', ground)
  const buttonFill =
    contrast(palette.accent.value, ground.value) >= 1.6 && styleName !== 'minimal' ? palette.accent : palette.primary
  const words: Words = { parts: usualWords(content), room: places.words, surface: ground.value }
  if (content.button && !places.button) Object.assign(words, { button: content.button, buttonFill })
  if (places.button) words.justify = 'start'
  const set = frame.shape === 'strip' ? rowWords(b.tree, b, words) : stackWords(b.tree, b, words)
  let room = places.product
  let product = content.photo ? fitted(content.photo, room) : room
  if (places.button) {
    // The product takes the room between the words and the button, and the three sit together in the middle of
    // the frame's room for them.
    const button = content.button
      ? stackWords(b.tree, b, {
          key: 'button-row',
          parts: [],
          button: content.button,
          buttonFill,
          room: places.button,
          surface: ground.value,
          justify: 'end',
        }).box
      : { ...places.button, y: places.button.y + places.button.height, height: 0 }
    const gap = Math.round(frame.margin * 0.8)
    const top = set.box.y + set.box.height + gap
    room = { ...room, y: top, height: button.y - gap - top }
    product = content.photo ? fitted(content.photo, room) : room
    const free = room.height - product.height
    const words = round(free / 2)
    b.tree.moveDown('words', words)
    if (content.button) b.tree.moveDown('button-row', -round(free / 2))
    room = { ...room, y: room.y + words, height: product.height }
    product = { ...product, y: room.y }
  }
  light(b, product)
  if (content.photo) b.tree.add('product', picture('Product', product, content.photo, { fit: 'fit' }))
  badge(b, product, { ...places, product: room }, ground)
  if (styleName === 'premium' && frame.shape !== 'strip')
    insetFrame(b, palette.accent, Math.round(frame.margin * 0.4), 0.7)
}

/** The ground: the primary (bold), a dark (premium), else the kit's background. */
function groundColour({ styleName, palette }: Build): Swatch {
  if (styleName === 'bold') return palette.primary
  if (styleName === 'premium') return palette.secondary
  return palette.background
}

/** The product's, words', button's and logo's places for the frame's shape. */
function arrange(b: Build): Places {
  const { width, height, shape, margin, safe } = b.frame
  const short = Math.min(width, height)
  const besides = shape === 'wide' || shape === 'banner' || shape === 'strip' || (shape === 'square' && short < 400)
  if (besides) {
    const productWidth = Math.round(
      shape === 'strip' ? height * 1.7 : shape === 'banner' ? Math.min(height * 1.6, width * 0.36) : width * 0.46,
    )
    const product = { x: margin * 0.5, y: margin * 0.5, width: productWidth - margin, height: height - margin }
    let words = {
      x: productWidth + margin * 0.5,
      y: safe.y,
      width: width - productWidth - margin * 1.5,
      height: safe.height,
    }
    let logoBox: Rect | undefined
    const room = logoRoom(b, { x: words.x, y: words.y }, words.width)
    if (shape !== 'strip' && words.height >= room.height * 5) {
      if (b.style.align === 'center') room.x = Math.round(words.x + (words.width - room.width) / 2)
      logoBox = room
      const below = room.height + margin * 0.6
      words = { ...words, y: words.y + below, height: words.height - below }
    }
    const badge = Math.round(shape === 'strip' ? height * 0.78 : Math.min(product.height * 0.42, product.width * 0.4))
    return { product, words, ...(logoBox ? { logo: logoBox } : {}), badge }
  }
  // Tall and square: the logo and words on top, the product, the button under it.
  const logoBox = logoRoom(b, { x: safe.x, y: safe.y }, safe.width)
  if (b.style.align === 'center') logoBox.x = Math.round(safe.x + (safe.width - logoBox.width) / 2)
  const top = b.content.logo ? logoBox.y + logoBox.height + margin * 0.6 : safe.y
  const bottom = safe.y + safe.height
  const buttonHeight = Math.round(Math.max(b.frame.readable * 3.2, short * 0.11))
  const wordsHeight = Math.round((bottom - top) * (shape === 'square' ? 0.36 : 0.34))
  const words = { x: safe.x, y: top, width: safe.width, height: wordsHeight }
  const button = { x: safe.x, y: bottom - buttonHeight, width: safe.width, height: buttonHeight }
  const product = { x: margin, y: top + wordsHeight, width: width - 2 * margin, height: button.y - top - wordsHeight }
  return { product, words, button, ...(b.content.logo ? { logo: logoBox } : {}), badge: Math.round(short * 0.21) }
}

/** The light behind the product in the style's way: a glow, a pale disc, an accent disc with dots, a gold ring. */
function light(b: Build, product: Rect) {
  const { styleName, palette } = b
  const side = Math.min(product.width, product.height * 1.05)
  const disc = {
    x: round(product.x + (product.width - side) / 2),
    y: round(product.y + (product.height - side) / 2),
    width: round(side),
    height: round(side),
  }
  if (styleName === 'bold')
    glow(
      b,
      'light',
      { x: product.x - product.width * 0.1, y: disc.y, width: product.width * 1.2, height: side },
      '#FFFFFF',
      0.5,
    )
  if (styleName === 'minimal') b.tree.add('light', ellipse('Disc', disc, solid(palette.primary, 0.08)))
  if (styleName === 'playful') {
    b.tree.add('light', ellipse('Disc', disc, solid(palette.accent)))
    const r = side * 0.06
    dots(b, 'dot', [
      { x: disc.x + side * 0.08, y: disc.y + side * 0.2, r, colour: palette.primary },
      { x: disc.x + side * 0.95, y: disc.y + side * 0.78, r: r * 0.6, colour: palette.secondary },
    ])
  }
  if (styleName === 'premium') {
    glow(b, 'light', disc, palette.accent.value, 0.35)
    const weight = Math.max(1, round(side * 0.006))
    b.tree.add('ring', ellipse('Ring', disc, { fills: [] }, { strokes: [stroke(palette.accent.value, weight)] }))
  }
}

/** The badge on the product's top corner, its words as large as fit inside it, never under the readable size. */
function badge(b: Build, product: Rect, places: Places, ground: Swatch) {
  const { palette, frame, content } = b
  const words = content.badge
  if (!words) return
  const colour = contrast(palette.accent.value, ground.value) >= 1.6 ? palette.accent : palette.primary
  const ink = inkFor(b, colour.value, frame.readable, [palette.text, palette.background])
  const longest = words.split(/s+/).reduce((x, y) => (y.length > x.length ? y : x), '')
  const wordWidth = (size: number) => Math.ceil(b.measure(badgeProps(b, longest, size, 1000, ink), null).width)
  // The badge grows to hold its longest word at the readable size inside it.
  const d = Math.round(Math.max(places.badge, frame.readable * 4, (wordWidth(frame.readable) + 2) / INSIDE))
  const inner = Math.floor(d * INSIDE)
  const room = places.product
  const cx = Math.min(product.x + product.width * 0.86, room.x + room.width - d / 2)
  const cy = Math.max(product.y + product.height * 0.14, room.y + d / 2)
  badgeShape(b, { x: round(cx - d / 2), y: round(cy - d / 2), width: d, height: d }, colour)
  let size = Math.floor(d * 0.34)
  const fits = (at: number) =>
    wordWidth(at) <= inner && b.measure(badgeProps(b, words, at, inner, ink), inner).height <= inner
  while (size > frame.readable && !fits(size)) size--
  const font = palette.heading
  b.tree.add('badge', {
    type: 'text',
    name: 'Badge words',
    role: 'badge',
    props: { ...badgeProps(b, words, size, inner, ink), x: round(cx - inner / 2), y: round(cy - inner / 2) },
    bindings: { ...(font.ref ? { fontFamily: font.ref } : {}), ...(ink.ref ? { textColor: ink.ref } : {}) },
  })
}

/** The badge's words in the headline's type at `size`, centred in a square box `inner` wide. */
function badgeProps({ palette, style }: Build, text: string, size: number, inner: number, ink: Swatch) {
  const look = style.headline
  return TextProps.parse({
    x: 0,
    y: 0,
    width: inner,
    height: inner,
    text,
    style: {
      fontFamily: palette.heading.value,
      fontWeight: palette.brandFont.heading ? look.brandWeight : look.weight,
      fontSize: size,
      color: ink.value,
      lineHeight: 1,
      ...(look.textCase === 'upper' ? { textCase: 'upper' } : {}),
    },
    align: 'center',
    verticalAlign: 'middle',
    boxMode: 'fixed',
    wrapStyle: 'balance',
  })
}
