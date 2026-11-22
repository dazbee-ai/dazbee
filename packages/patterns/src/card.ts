// A card torn in two, as a coupon or a ticket is: a stub holding one lead (an offer, a date) and the main part
// holding the words and button, a tear between them with a notch bitten from each edge. Across a wide room the stub
// is at the card's start; down a tall one, at its top. A short frame, with no room for a card, sets the stub as a
// chip before its words.
import { type Rect, TextProps } from '@dazbee/schema'

import {
  type Build,
  ground,
  inRow,
  isShort,
  isTall,
  logoAtStart,
  logoOnTop,
  roles,
  rowed,
  usualWords,
} from './build.ts'
import { ctaFill } from './button.ts'
import { apart, deepColour, mixed, ornamentColour, type Swatch, withAlpha } from './palette.ts'
import { lookStyle } from './text-look.ts'
import { ellipse, line, rect, round, solid, stroke, treeBuilder } from './tree.ts'
import { fitsRoom, rowFits, rowWords, stackWords, type WordPart, type Words } from './words.ts'

/** What a card holds in its stub, and how its tear is drawn. */
export interface CardSpec {
  /** The stub's words, its lead among them. */
  stub: WordPart[]
  /** A line of dashes, as a coupon's cut line; or a row of punched holes, as a ticket's. */
  tear: 'dashes' | 'holes'
  /**
   * What a short frame's words sit on beside the chip: the card's colour over the whole frame, as a coupon is one,
   * or the ground, as a pattern that sets its words on the ground at every other size does. The card's when left out.
   */
  shortOn?: 'card' | 'ground'
}

/** The least proportion of a card across a room, its height over its width. */
const CARD_DOWN_MOST = 0.62
/** The stub's share of the card: across it, at most across it, and down it. */
const STUB = { across: 0.3, most: 0.46, down: 0.4 }
/** The size a stub's lead is set at across a card, as a share of its height, which sizes the stub: on a social size and a display one. */
const STUB_LEAD = { social: 0.28, display: 0.34 }
/** How many times as wide as it is tall a room is at least for its card to lie across it. */
const ACROSS_LEAST = 0.9
/** A notch's size, as a share of the card's shorter side. */
const NOTCH = 0.09
/** The room inside the card round its words, as a share of the margin, and at most of the card's shorter side. */
const PAD = 0.8
const PAD_MOST = 0.06
/** The most a stub's lead takes of its room's height. */
const STUB_LEAD_DOWN = 0.8
/** The most a card's headline is of its stub's lead. */
const MAIN_UNDER_STUB = 0.5
/** The share of the primary a minimal card is tinted with. */
const MINIMAL_TINT = 0.07
/** How plainly the card stands apart from the ground. */
const CARD_APART = { ratio: 1.3, difference: 18 }

/** Builds a card in the frame. */
export function card(b: Build, spec: CardSpec) {
  const { frame, palette, content } = b
  const colour = ground(b)
  const fill = cardColour(b, colour)
  const button = content.button ? { button: content.button, buttonFill: ctaFill(palette, fill, roles(b).cta) } : {}
  if (isShort(b)) {
    shortCard(b, spec, colour)
    return
  }
  const room = logoOnTop(b, frame.safe, colour)
  // A tall frame's card stands upright, its stub on top; any other lies across, its stub at its start.
  const across = !isTall(b) && room.width >= room.height * ACROSS_LEAST
  const height = across ? Math.min(room.height, Math.round(room.width * CARD_DOWN_MOST)) : room.height
  const box = { ...room, y: Math.round(room.y + (room.height - height) / 2), height }
  const short = Math.min(box.width, box.height)
  const radius = Math.round(short * b.style.round * 0.8)
  if (b.styleName === 'bold') {
    const by = Math.max(3, Math.round(Math.min(frame.width, frame.height) * 0.014))
    const shadow = { ...box, x: box.x + by, y: box.y + by }
    b.tree.add('card-shadow', rect('Card shadow', shadow, solid(deepColour(palette)), { radius }))
  }
  // A minimal card is a pale tint, edged in a fine line of the primary.
  const edge =
    b.styleName === 'minimal'
      ? { strokes: [stroke(withAlpha(palette.primary.value, 0.45), Math.max(1, round(short * 0.004)))] }
      : {}
  b.tree.add('card', { ...rect('Card', box, solid(fill), { radius, ...edge }), role: 'background' })
  const pad = Math.round(Math.min(frame.margin * PAD, short * PAD_MOST))
  const notch = Math.round(short * NOTCH)
  // A stub across the card is as wide as its lead takes at STUB_LEAD of the card's height, within its shares.
  const lead = spec.stub.find((part) => part.kind === 'number')
  const perPixel = lead ? numberWidth(b, lead) : 0
  // A display size, seen in passing, sets its offer bolder.
  const display = frame.width < 1000 && frame.height < 1000
  const wanted = perPixel * box.height * (display ? STUB_LEAD.display : STUB_LEAD.social) + 2 * pad + notch / 2
  const stubSize = across
    ? Math.round(Math.min(box.width * STUB.most, Math.max(box.width * STUB.across, wanted)))
    : Math.round(box.height * STUB.down)
  const stubBox = across ? { ...box, width: stubSize } : { ...box, height: stubSize }
  const main = across
    ? { ...box, x: box.x + stubSize, width: box.width - stubSize }
    : { ...box, y: box.y + stubSize, height: box.height - stubSize }
  const stubFill = stubColour(b, fill, colour)
  if (stubFill.value !== fill.value) {
    const corners: [number, number, number, number] = across ? [radius, 0, 0, radius] : [radius, radius, 0, 0]
    b.tree.add('stub', { ...rect('Stub', stubBox, solid(stubFill), { radius: corners }), role: 'background' })
  }
  if (b.styleName === 'premium') {
    const { colour: ornament } = ornamentColour(palette, fill.value)
    const by = Math.round(short * 0.04)
    const inner = { x: box.x + by, y: box.y + by, width: box.width - 2 * by, height: box.height - 2 * by }
    const weight = Math.max(1, round(short * 0.004))
    b.tree.add(
      'card-line',
      rect('Card line', inner, { fills: [] }, { strokes: [stroke(withAlpha(ornament.value, 0.7), weight)] }),
    )
  }
  tear(b, spec.tear, box, across, stubSize, colour, fill)
  const inset = (at: Rect): Rect => ({
    x: at.x + pad,
    y: at.y + pad,
    width: at.width - 2 * pad,
    height: at.height - 2 * pad,
  })
  // The stub's words keep clear of the notches at the tear.
  const stubRoom = across
    ? { ...inset(stubBox), width: stubBox.width - 2 * pad - notch / 2 }
    : { ...inset(stubBox), height: stubBox.height - 2 * pad - notch / 2 }
  const stub = stackWords(b.tree, b, {
    key: 'stub-words',
    parts: spec.stub,
    room: stubRoom,
    surface: stubFill.value,
    align: 'center',
    justify: 'center',
    // The stub holds its lead alone, as large as its room's height takes.
    most: Math.floor(stubRoom.height * STUB_LEAD_DOWN),
  })
  const mainRoom = across
    ? { ...inset(main), x: main.x + pad + notch / 2, width: main.width - 2 * pad - notch / 2 }
    : { ...inset(main), y: main.y + pad + notch / 2, height: main.height - 2 * pad - notch / 2 }
  // The stub's lead leads the card: the main part's headline stays under half its size.
  const words: Words = {
    parts: usualWords(content),
    ...button,
    room: mainRoom,
    surface: fill.value,
    justify: 'center',
    most: Math.floor(stub.size * MAIN_UNDER_STUB),
  }
  if (rowed(b, words)) rowWords(b.tree, b, words)
  else stackWords(b.tree, b, words)
}

/** The tear between the stub and the main part, and a notch bitten from each of the card's edges at it. */
function tear(b: Build, way: CardSpec['tear'], box: Rect, across: boolean, at: number, colour: Swatch, fill: Swatch) {
  const short = Math.min(box.width, box.height)
  const notch = Math.round(short * NOTCH)
  const ink = ornamentColour(b.palette, fill.value)
  const length = across ? box.height : box.width
  const from = across ? { x: box.x + at, y: box.y } : { x: box.x, y: box.y + at }
  const weight = Math.max(1, Math.round(short * 0.008))
  if (way === 'dashes') {
    // A line along the tear between the notches, turned upright across a card.
    const span = length - 2 * notch
    const centre = across ? { x: from.x, y: from.y + length / 2 } : { x: from.x + length / 2, y: from.y }
    const lineBox = { x: centre.x - span / 2, y: centre.y - weight, width: span, height: 2 * weight }
    const dash = Math.max(3, Math.round(short * 0.03))
    const part = line('Tear', lineBox, ink.colour, weight)
    const colour = withAlpha(ink.colour.value, Math.min(1, ink.opacity + 0.3))
    const strokes = [{ ...stroke(colour, weight), dashes: [dash, Math.round(dash * 0.8)], align: 'center' as const }]
    b.tree.add('tear', { ...part, props: { ...part.props, strokes, ...(across ? { rotation: 90 } : {}) } })
  } else {
    const hole = Math.max(3, Math.round(short * 0.025))
    const count = Math.max(3, Math.floor((length - 2 * notch) / (hole * 2.4)))
    const step = (length - 2 * notch) / count
    for (let i = 0; i < count; i++) {
      const along = notch + step * (i + 0.5)
      const centre = across ? { x: from.x, y: from.y + along } : { x: from.x + along, y: from.y }
      b.tree.add(
        `hole-${i + 1}`,
        ellipse(
          `Hole ${i + 1}`,
          { x: round(centre.x - hole / 2), y: round(centre.y - hole / 2), width: hole, height: hole },
          solid(colour),
        ),
      )
    }
  }
  for (const [i, end] of [0, length].entries()) {
    const centre = across ? { x: from.x, y: from.y + end } : { x: from.x + end, y: from.y }
    b.tree.add(
      `notch-${i + 1}`,
      ellipse(
        `Notch ${i + 1}`,
        { x: round(centre.x - notch / 2), y: round(centre.y - notch / 2), width: notch, height: notch },
        solid(colour),
      ),
    )
  }
}

/** A short frame's card: the stub as a chip after the logo, then the words in a row. */
function shortCard(b: Build, spec: CardSpec, colour: Swatch) {
  const { frame, palette, content } = b
  // The whole frame is the card, so its words are set on the card's colour at every size; or they stay on the ground.
  const onCard = spec.shortOn !== 'ground'
  const surface = onCard ? cardColour(b, colour) : colour
  const whole = { x: 0, y: 0, width: frame.width, height: frame.height }
  if (onCard) b.tree.add('card', { ...rect('Card', whole, solid(surface)), role: 'background' })
  let room = logoAtStart(b, frame.safe, surface)
  const fill = stubColour(b, surface, colour)
  const pad = Math.round(frame.margin * 0.6)
  const chipWords = (width: number): Words => ({
    key: 'stub-words',
    parts: spec.stub.filter((part) => part.kind === 'number'),
    room: { ...room, x: room.x + pad, width },
    surface: fill.value,
    align: 'start',
    floor: true,
  })
  // Set once to learn how wide the lead is, then in a room as wide as it, so the chip holds the words' box.
  const tried = stackWords(treeBuilder(), b, chipWords(Math.round(room.width * 0.3)))
  const chip = stackWords(b.tree, b, chipWords(tried.leadWidth + 1))
  const box = { x: room.x, y: frame.safe.y, width: chip.leadWidth + 2 * pad, height: frame.safe.height }
  const radius = Math.round(box.height * b.style.buttonRound)
  // The chip goes over the card, under the words set before it.
  const under = onCard ? 'card' : b.tree.tree().nodes.ground ? 'ground' : 'background'
  b.tree.addOver('stub', { ...rect('Stub', box, solid(fill), { radius }), role: 'background' }, under)
  const right = box.x + box.width + frame.margin
  room = { ...room, x: right, width: room.x + room.width - right }
  const of = (parts: WordPart[]): Words => ({
    parts,
    ...(content.button ? { button: content.button, buttonFill: ctaFill(palette, surface, roles(b).cta) } : {}),
    room,
    surface: surface.value,
  })
  // Beside the chip, the words that fit, in a row in a strip and stacked over the button in a mobile banner: all of
  // them, the headline alone, else only the button.
  const row = inRow(b)
  const fits = (parts: WordPart[]) => (row ? rowFits(b, of(parts)) : fitsRoom(b, of(parts)))
  const tries = [usualWords(content), [{ kind: 'headline' as const, text: content.headline }], []]
  const words = of(tries.find(fits) ?? [])
  if (row) rowWords(b.tree, b, words)
  else stackWords(b.tree, b, words)
}

/** How wide a stub's lead is set, per pixel of its size: its width at 100 px over 100. */
function numberWidth(b: Build, part: WordPart): number {
  const props = TextProps.parse({
    x: 0,
    y: 0,
    width: 1,
    height: 1,
    text: part.text,
    style: { ...lookStyle(b, b.style.headline, 100), color: '#000000FF' },
    boxMode: 'autoWidth',
  })
  return b.measure(props, null).width / 100
}

/**
 * The card's colour on the ground: a pale tint of the primary in a minimal style, edged; else the first of the kit's
 * background, secondary and primary plainly apart from it.
 */
function cardColour(b: Build, colour: Swatch): Swatch {
  const { palette } = b
  if (b.styleName === 'minimal') return { value: mixed(colour.value, palette.primary.value, MINIMAL_TINT) }
  const offered = [palette.background, palette.secondary, palette.primary, deepColour(palette)]
  const shows = (swatch: Swatch) =>
    swatch.value !== colour.value && apart(swatch.value, colour.value, CARD_APART.ratio, CARD_APART.difference)
  return offered.find(shows) ?? { value: mixed(colour.value, palette.text.value, MINIMAL_TINT) }
}

/**
 * The stub's colour in a loud style: the first of the accent, secondary and deep colour plainly apart from the card
 * and from what the card is on, so the stub shows as a part of the card; else, and in a quiet style, the card's own.
 */
function stubColour(b: Build, fill: Swatch, colour: Swatch): Swatch {
  const { palette } = b
  if (b.styleName !== 'bold' && b.styleName !== 'playful') return fill
  const shows = (swatch: Swatch) =>
    [fill, colour].every(
      (other) =>
        swatch.value !== other.value && apart(swatch.value, other.value, CARD_APART.ratio, CARD_APART.difference),
    )
  return [palette.accent, palette.secondary, deepColour(palette)].find(shows) ?? fill
}
