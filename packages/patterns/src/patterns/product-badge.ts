// Product with a badge: the product, best a cut-out, the largest thing in the frame, fitted by its subject in a light
// of its own centred on it, a badge on its top corner holding a few words (an offer, “New”), never over its middle,
// and the words beside or above it with the button. The style draws the badge and the light: a burst on brand colour
// (bold), a square on a pale disc (minimal), a seal on a big accent disc with dots (playful), or a ringed seal under a
// gold ring on a deep ground (premium).
import { type Rect, TextProps } from '@dazbee/schema'

import { type Build, ground, inRow, logoAtStart, logoOnTop, logoRoom, roles, usualWords } from '../build.ts'
import { type ButtonFill, ctaFill } from '../button.ts'
import { type Cropped, fitCrop } from '../crop.ts'
import { badgeShape, dots, glow } from '../decorations.ts'
import type { Swatch } from '../palette.ts'
import { inkFor } from '../text-look.ts'
import { ellipse, picture, round, solid, stroke } from '../tree.ts'
import type { Pattern } from '../types.ts'
import { rowWords, stackWords, type Words } from '../words.ts'

export const PRODUCT_BADGE: Pattern = {
  id: 'product-badge',
  name: 'Product with a badge',
  kinds: ['single product', 'sale or offer', 'product launch'],
  description:
    'The product, best a cut-out on clear, the largest thing in the frame, in a light of its own with a badge on its corner (an offer or “New”), and the words and button beside or above it.',
  needs: ['headline', 'photo', 'badge'],
  takes: ['kicker', 'subline', 'button', 'highlight', 'logo'],
}

/** The share of a badge's width its words take. */
const INSIDE = 0.62
/** The most of the product's box a badge covers, and how far into the box its middle sits first, as a share of its width. */
const BADGE_COVERS = 0.15
const BADGE_IN = 0.2
/** The share of the room under the logo the words take in a square frame and a tall one. */
const WORDS_SHARE = { square: 0.3, tall: 0.26 }

/** Builds the product with a badge in the frame. */
export function productBadge(b: Build) {
  const { frame } = b
  const colour = ground(b)
  const fill = ctaFill(b.palette, colour, roles(b).cta)
  const besides =
    frame.shape === 'wide' ||
    frame.shape === 'banner' ||
    frame.shape === 'strip' ||
    (frame.shape === 'square' && Math.min(frame.width, frame.height) < 400)
  const placed = besides ? sideBySide(b, colour, fill) : stacked(b, colour, fill)
  if (!placed) return
  light(b, placed.product.box, placed.limit)
  if (b.content.photo)
    b.tree.add('product', picture('Product', placed.product.box, b.content.photo, { crop: placed.product.crop }))
  badge(b, placed.product.box, placed.limit, colour)
}

/** Where the product went, and the box its badge keeps inside. */
interface Placed {
  product: Cropped
  limit: Rect
}

/**
 * Tall and square: the logo and words on top, the product filling the room under them, the button at the foot of
 * the safe room, the three spread down it.
 */
function stacked(b: Build, colour: Swatch, fill: ButtonFill): Placed | undefined {
  const { frame, content } = b
  const room = logoOnTop(b, frame.safe, colour)
  const share = frame.shape === 'square' ? WORDS_SHARE.square : WORDS_SHARE.tall
  const wordsRoom = { ...room, height: Math.round(room.height * share) }
  const set = stackWords(b.tree, b, {
    parts: usualWords(content),
    room: wordsRoom,
    surface: colour.value,
    justify: 'start',
    // The button under the product is at least the readable size, so the headline stays over it.
    ...(content.button ? { labelBeside: frame.readable } : {}),
  })
  const gap = Math.round(frame.margin * 0.8)
  let foot = room.y + room.height
  if (content.button) {
    const button = stackWords(b.tree, b, {
      key: 'button-row',
      parts: [],
      button: content.button,
      buttonFill: fill,
      room: { ...room, y: room.y + room.height - Math.round(room.height * 0.2), height: Math.round(room.height * 0.2) },
      surface: colour.value,
      justify: 'end',
      leadElsewhere: set.size,
    })
    foot = button.box.y
  }
  if (!content.photo) return undefined
  const top = set.box.y + set.box.height + gap
  const productRoom = { x: frame.margin, y: top, width: frame.width - 2 * frame.margin, height: foot - gap - top }
  // The product fills the room between the words and the button, in its middle, below a strip the badge can step
  // up into.
  const step = Math.round(Math.min(productRoom.height * 0.25, frame.readable * 4.5))
  const fitted = fitCrop(content.photo, { ...productRoom, y: productRoom.y + step, height: productRoom.height - step })
  return { product: fitted, limit: productRoom }
}

/** Wide, banner and strip: the product at the leading edge, the logo and words beside it, the button after them. */
function sideBySide(b: Build, colour: Swatch, fill: ButtonFill): Placed | undefined {
  const { frame, content } = b
  const { width, height, shape, margin, safe } = frame
  const productWidth = Math.round(
    shape === 'strip' ? height * 1.9 : shape === 'banner' ? Math.max(height * 1.6, width * 0.34) : width * 0.48,
  )
  const productRoom = { x: margin * 0.5, y: margin * 0.5, width: productWidth - margin, height: height - margin }
  let words: Rect = {
    x: productWidth + margin * 0.5,
    y: safe.y,
    width: width - productWidth - margin * 1.5,
    height: safe.height,
  }
  const logoHeight = logoRoom(b, { x: words.x, y: words.y }, words.width, colour).height
  words =
    shape !== 'strip' && words.height >= logoHeight * 3.2 ? logoOnTop(b, words, colour) : logoAtStart(b, words, colour)
  const set: Words = {
    parts: usualWords(content),
    room: words,
    surface: colour.value,
    ...(content.button ? { button: content.button, buttonFill: fill } : {}),
  }
  if (inRow(b)) rowWords(b.tree, b, set)
  else stackWords(b.tree, b, set)
  if (!content.photo) return undefined
  return { product: fitCrop(content.photo, productRoom), limit: productRoom }
}

/**
 * The light behind the product, centred on it, no taller than the room the product has, in the style's way: a glow,
 * a pale disc, an accent disc with dots, a ring.
 */
function light(b: Build, product: Rect, limit: Rect) {
  const { styleName, palette } = b
  const side = Math.min(Math.max(product.width, product.height) * 0.92, limit.height * 1.05)
  const cx = product.x + product.width / 2
  const cy = product.y + product.height / 2
  const disc = { x: round(cx - side / 2), y: round(cy - side / 2), width: round(side), height: round(side) }
  if (styleName === 'bold')
    glow(
      b,
      'light',
      { x: cx - side * 0.6, y: cy - side * 0.35, width: side * 1.2, height: side * 0.7 },
      palette.background.value,
      0.5,
    )
  if (styleName === 'minimal') b.tree.add('light', ellipse('Disc', disc, solid(palette.primary, 0.08)))
  if (styleName === 'playful') {
    b.tree.add('light', ellipse('Disc', disc, solid(palette.accent)))
    const r = side * 0.05
    dots(b, 'dot', [
      { x: disc.x + side * 0.1, y: disc.y + side * 0.22, r, colour: palette.primary },
      { x: disc.x + side * 0.92, y: disc.y + side * 0.8, r: r * 0.6, colour: palette.secondary },
    ])
  }
  if (styleName === 'premium') {
    glow(b, 'light', disc, palette.accent.value, 0.3)
    const weight = Math.max(1, round(side * 0.005))
    b.tree.add('ring', ellipse('Ring', disc, { fills: [] }, { strokes: [stroke(palette.accent.value, weight)] }))
  }
}

/**
 * The badge on the product's top corner, inside `limit`, covering no more than a share of the product's box and none
 * of its middle third; its words as large as fit inside it, never under the readable size.
 */
function badge(b: Build, product: Rect, limit: Rect, ground: Swatch) {
  const { palette, frame, content } = b
  const words = content.badge
  if (!words) return
  const colour = ctaFill(palette, ground, 'accent').fill
  const ink = inkFor(b, colour.value, frame.readable, [palette.text, palette.background])
  const longest = words.split(/\s+/).reduce((x, y) => (y.length > x.length ? y : x), '')
  const wordWidth = (size: number) => Math.ceil(b.measure(badgeProps(b, longest, size, 1000, ink), null).width)
  const short = Math.min(frame.width, frame.height)
  // The badge's corner part over the box is about 0.4 of its square; it stays out of the box's middle third.
  const most = Math.min(Math.sqrt((BADGE_COVERS * product.width * product.height) / 0.4), product.width * 0.45)
  const d = Math.round(
    Math.max(Math.min(short * 0.22, most), frame.readable * 4, (wordWidth(frame.readable) + 2) / INSIDE),
  )
  const inner = Math.floor(d * INSIDE)
  const right = Math.min(frame.width - frame.margin * 0.5, limit.x + limit.width)
  const top = Math.max(frame.margin * 0.5, limit.y)
  // From the corner, the badge steps out of the product's box while it covers more than its share of it.
  const at = (into: number) => ({
    cx: Math.min(product.x + product.width - d * into, right - d / 2),
    cy: Math.max(product.y + d * into, top + d / 2),
  })
  const covers = ({ cx, cy }: { cx: number; cy: number }) =>
    Math.max(0, Math.min(cx + d / 2, product.x + product.width) - Math.max(cx - d / 2, product.x)) *
    Math.max(0, Math.min(cy + d / 2, product.y + product.height) - Math.max(cy - d / 2, product.y))
  // Nor may it reach the middle third of the product's width where it is over the product.
  const middle = product.x + (product.width * 2) / 3
  const inMiddle = (place: { cx: number; cy: number }) => place.cx - d / 2 < middle && covers(place) > 0
  const tooMuch = (place: { cx: number; cy: number }) =>
    covers(place) > BADGE_COVERS * product.width * product.height || inMiddle(place)
  let into = BADGE_IN
  while (into > -0.5 && tooMuch(at(into))) into -= 0.05
  const { cx, cy } = at(into)
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
