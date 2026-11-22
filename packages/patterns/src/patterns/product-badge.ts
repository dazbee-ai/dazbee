// Product with a badge: the product, best a cut-out, the largest thing in the frame, fitted by its subject in a light
// of its own centred on it, a badge on its top corner holding a few words (an offer, “New”), never over its middle,
// and the words beside or above it with the button. The style draws the badge and the light: a burst on brand colour
// (bold), a square on a pale disc (minimal), a seal on a big accent disc with dots (playful), or a ringed seal under a
// gold ring on a deep ground (premium). The offer is set in the heaviest face the style has, at the headline's size at
// least; a short frame sets it in a chip before its words.
import { type Rect, TextProps } from '@dazbee/schema'

import {
  type Build,
  ground,
  inRow,
  isShort,
  logoAtStart,
  logoOnTop,
  logoRoom,
  roles,
  rowLabel,
  stripHolds,
  usualWords,
} from '../build.ts'
import { type ButtonFill, ctaFill } from '../button.ts'
import { type Cropped, fitCrop } from '../crop.ts'
import { badgeShape, dots, glow } from '../decorations.ts'
import type { Swatch } from '../palette.ts'
import { inkFor } from '../text-look.ts'
import { ellipse, picture, rect, round, solid, stroke } from '../tree.ts'
import type { Pattern } from '../types.ts'
import { leadBeside, rowFits, rowWords, stackWords, type Words } from '../words.ts'

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
/** A badge's least size: a share of a social frame's shorter side, and of a banner's height. */
const BADGE_LEAST = { social: 0.16, banner: 0.45 }
/** The weight a badge is set at in a brand's font, whose faces aren't known. */
const BRAND_BADGE_WEIGHT = 700
/** A chip's height, as a multiple of its words' size. */
const CHIP_DOWN = 1.45
/** The share of the room under the logo the words take in a square frame and a tall one. */
const WORDS_SHARE = { square: 0.3, tall: 0.32 }

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
  if (!placed.product) return
  light(b, placed.product.box, placed.limit)
  if (b.content.photo)
    b.tree.add('product', picture('Product', placed.product.box, b.content.photo, { crop: placed.product.crop }))
  badge(b, placed.product.box, placed.limit, colour, placed.size)
}

/** Where the product went, the box its badge keeps inside, and the headline's size, which its words are at least. */
interface Placed {
  product?: Cropped
  limit: Rect
  size: number
}

/**
 * Tall and square: the logo and words on top, the product filling the room under them, the button at the foot of
 * the safe room, the three spread down it.
 */
function stacked(b: Build, colour: Swatch, fill: ButtonFill): Placed {
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
  if (!content.photo) return { limit: room, size: set.size }
  const top = set.box.y + set.box.height + gap
  const productRoom = { x: frame.margin, y: top, width: frame.width - 2 * frame.margin, height: foot - gap - top }
  // The product fills the room between the words and the button, in its middle, below a strip the badge can step
  // up into.
  const step = Math.round(Math.min(productRoom.height * 0.25, frame.readable * 4.5))
  const fitted = fitCrop(content.photo, { ...productRoom, y: productRoom.y + step, height: productRoom.height - step })
  return { product: fitted, limit: productRoom, size: set.size }
}

/**
 * Wide, banner and strip: the product at the leading edge, fitted whole by its subject inside the frame's margin, the
 * logo and words beside it, the button after them. A short frame sets its offer as a chip before its words, and keeps
 * the product only where it holds it beside the logo, chip, words and button.
 */
function sideBySide(b: Build, colour: Swatch, fill: ButtonFill): Placed {
  const { frame, content } = b
  const { width, height, shape, margin, safe } = frame
  const short = isShort(b)
  const chip = short && content.badge ? chipSize(b, content.badge) : undefined
  let productWidth = Math.round(
    shape === 'strip' ? height * 1.9 : shape === 'banner' ? Math.max(height * 1.6, width * 0.34) : width * 0.48,
  )
  if (!content.photo || (short && !stripHolds(b, productWidth + (chip ? chip.width + margin : 0)))) productWidth = 0
  const productRoom = { x: margin, y: margin * 0.5, width: productWidth - margin * 1.5, height: height - margin }
  const x = productWidth > 0 ? productWidth + margin * 0.5 : safe.x
  let words: Rect = { x, y: safe.y, width: width - x - margin, height: safe.height }
  const logoHeight = logoRoom(b, { x: words.x, y: words.y }, words.width, colour).height
  words = !short && words.height >= logoHeight * 3.2 ? logoOnTop(b, words, colour) : logoAtStart(b, words, colour)
  if (chip && content.badge) {
    offerChip(b, { x: words.x, y: Math.round(safe.y + (safe.height - chip.height) / 2) }, chip, content.badge, colour)
    words = { ...words, x: words.x + chip.width + margin, width: words.width - chip.width - margin }
  }
  const wordsOf = (parts: Words['parts']): Words => ({
    parts,
    room: words,
    surface: colour.value,
    ...(content.button ? { button: content.button, buttonFill: fill } : {}),
  })
  // A short frame whose offer leads in its chip leaves its headline out where it can't fit beside the chip.
  const fitted = inRow(b) ? rowFits(b, wordsOf(usualWords(content))) : true
  const set: Words = {
    parts: chip && !fitted ? [] : usualWords(content),
    room: words,
    surface: colour.value,
    ...(content.button ? { button: content.button, buttonFill: fill } : {}),
  }
  const placed = inRow(b) ? rowWords(b.tree, b, set) : stackWords(b.tree, b, set)
  if (!content.photo || productWidth === 0 || chip) {
    if (!content.photo || productWidth === 0) return { limit: productRoom, size: placed.size }
    // In a short frame the offer is the chip: the product shows whole, with no badge over it.
    const product = fitCrop(content.photo, productRoom)
    b.tree.add('product', picture('Product', product.box, content.photo, { crop: product.crop }))
    return { limit: productRoom, size: placed.size }
  }
  return { product: fitCrop(content.photo, productRoom), limit: productRoom, size: placed.size }
}

/** The chip a short frame sets its offer in: its words at the size a strip's lead takes at most, and room round them. */
function chipSize(b: Build, words: string) {
  const { frame } = b
  const size = Math.max(
    frame.readable,
    Math.round(Math.min(frame.safe.height / CHIP_DOWN, leadBeside(b, rowLabel(b)) * 1.15)),
  )
  const { font, weight } = badgeFace(b)
  const props = badgeProps(b, words, size, 1000, b.palette.text, font, weight)
  const across = Math.ceil(b.measure({ ...props, boxMode: 'autoWidth' }, null).width)
  return {
    size,
    width: across + Math.round(size * 0.9),
    height: Math.round(Math.min(frame.safe.height, size * CHIP_DOWN)),
  }
}

/** The offer's chip at `at`: a box in the badge's colour, rounded as the style's button, its words in the badge's face. */
function offerChip(
  b: Build,
  at: { x: number; y: number },
  chip: { size: number; width: number; height: number },
  words: string,
  ground: Swatch,
) {
  const { palette } = b
  const colour = ctaFill(palette, ground, 'accent').fill
  const ink = inkFor(b, colour.value, chip.size, [palette.text, palette.background])
  const box = { ...at, width: chip.width, height: chip.height }
  b.tree.add('badge-shape', {
    ...rect('Badge', box, solid(colour), { radius: Math.round(chip.height * b.style.buttonRound) }),
    role: 'badge',
  })
  const { font, weight } = badgeFace(b)
  b.tree.add('badge', {
    type: 'text',
    name: 'Badge words',
    role: 'badge',
    props: { ...badgeProps(b, words, chip.size, chip.width, ink, font, weight), ...box, height: chip.height },
    bindings: { ...(font.ref ? { fontFamily: font.ref } : {}), ...(ink.ref ? { textColor: ink.ref } : {}) },
  })
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
 * of its middle third, stepping off the product where it must; as large as a sixth of the frame's shorter side at
 * least, and its words at the headline's `size` at least, in the heaviest face the style's fonts have.
 */
function badge(b: Build, product: Rect, limit: Rect, ground: Swatch, size: number) {
  const { palette, frame, content } = b
  const words = content.badge
  if (!words) return
  const colour = ctaFill(palette, ground, 'accent').fill
  const ink = inkFor(b, colour.value, frame.readable, [palette.text, palette.background])
  const { font, weight } = badgeFace(b)
  const longest = words.split(/\s+/).reduce((x, y) => (y.length > x.length ? y : x), '')
  const wordWidth = (at: number) =>
    Math.ceil(b.measure(badgeProps(b, longest, at, 1000, ink, font, weight), null).width)
  const short = Math.min(frame.width, frame.height)
  const banner = frame.shape === 'banner' || frame.shape === 'strip'
  const least = Math.max(banner ? frame.height * BADGE_LEAST.banner : short * BADGE_LEAST.social, frame.readable * 4)
  const headline = Math.max(frame.readable, size)
  const right = Math.min(frame.width - frame.margin * 0.5, limit.x + limit.width)
  const top = Math.max(frame.margin * 0.5, limit.y)
  // From the corner, a badge `d` wide steps out of the product's box while it covers more than its share of it, or
  // any of the middle third of its width; where none of its steps keeps off them, a smaller badge is tried, down to
  // the least its words take at the readable size.
  const place = (d: number) => {
    const at = (into: number) => ({
      cx: Math.min(product.x + product.width - d * into, right - d / 2),
      cy: Math.max(product.y + d * into, top + d / 2),
    })
    const covers = ({ cx, cy }: { cx: number; cy: number }) =>
      Math.max(0, Math.min(cx + d / 2, product.x + product.width) - Math.max(cx - d / 2, product.x)) *
      Math.max(0, Math.min(cy + d / 2, product.y + product.height) - Math.max(cy - d / 2, product.y))
    const middle = product.x + (product.width * 2) / 3
    const tooMuch = (spot: { cx: number; cy: number }) =>
      covers(spot) > BADGE_COVERS * product.width * product.height || (spot.cx - d / 2 < middle && covers(spot) > 0)
    let into = BADGE_IN
    while (into > -0.5 && tooMuch(at(into))) into -= 0.05
    return { ...at(into), clear: !tooMuch(at(into)) }
  }
  const floor = Math.round(Math.max(frame.readable * 4, (wordWidth(frame.readable) + 2) / INSIDE))
  let d = Math.round(Math.max(least, (wordWidth(headline) + 2) / INSIDE, Math.min(short * 0.22, least * 1.3)))
  let spot = place(d)
  while (!spot.clear && d > floor) {
    d = Math.max(floor, Math.round(d * 0.92))
    spot = place(d)
  }
  const { cx, cy } = spot
  const inner = Math.floor(d * INSIDE)
  badgeShape(b, { x: round(cx - d / 2), y: round(cy - d / 2), width: d, height: d }, colour)
  let set = Math.max(headline, Math.floor(d * 0.36))
  const fits = (px: number) =>
    wordWidth(px) <= inner && b.measure(badgeProps(b, words, px, inner, ink, font, weight), inner).height <= inner
  while (set > frame.readable && !fits(set)) set--
  b.tree.add('badge', {
    type: 'text',
    name: 'Badge words',
    role: 'badge',
    props: {
      ...badgeProps(b, words, set, inner, ink, font, weight),
      x: round(cx - inner / 2),
      y: round(cy - inner / 2),
    },
    bindings: { ...(font.ref ? { fontFamily: font.ref } : {}), ...(ink.ref ? { textColor: ink.ref } : {}) },
  })
}

/**
 * The face a badge's words are set in: the style's heading font where it is heavy, else its body font at a bold
 * weight, so an offer is never set thin.
 */
function badgeFace({ palette, style }: Build): { font: Swatch; weight: number } {
  const face = style.badge
  const font = palette[face.font]
  return { font, weight: palette.brandFont[face.font] ? BRAND_BADGE_WEIGHT : face.weight }
}

/** The badge's words in its face at `size`, in the headline's case, centred in a square box `inner` wide. */
function badgeProps(
  { style }: Build,
  text: string,
  size: number,
  inner: number,
  ink: Swatch,
  font: Swatch,
  weight: number,
) {
  return TextProps.parse({
    x: 0,
    y: 0,
    width: inner,
    height: inner,
    text,
    style: {
      fontFamily: font.value,
      fontWeight: weight,
      fontSize: size,
      color: ink.value,
      lineHeight: 1,
      ...(style.headline.textCase === 'upper' ? { textCase: 'upper' } : {}),
    },
    align: 'center',
    verticalAlign: 'middle',
    boxMode: 'fixed',
    wrapStyle: 'balance',
  })
}
