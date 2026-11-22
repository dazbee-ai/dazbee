// Photo with a card: the photo over the whole frame and a card of brand colour floating on it inside the margin,
// holding the words and the button: at the foot of a square or tall frame, with the logo in the photo's top corner,
// or at the start of a wide one or a banner, the logo heading the card. The photo's subject is kept clear of the card;
// where it can't show whole so over the whole frame, the photo ends half way under the card. The style draws the
// card: square on a hard offset block of the accent (bold), square and plain (minimal), rounded with a group of dots
// on the photo (playful), or with a fine accent line inside it (premium). A short frame, with no room for a card on a
// photo, sets the photo at its end.
import type { Rect } from '@dazbee/schema'

import {
  type Build,
  groundColour,
  isShort,
  keepUnderLogo,
  logo,
  logoOnTop,
  logoRoom,
  logoRowHeight,
  photo,
  photoLogo,
  photoSurface,
  wordsOn,
} from '../build.ts'
import { coverCrop } from '../crop.ts'
import { dotGroup } from '../decorations.ts'
import { ornamentColour, withAlpha } from '../palette.ts'
import { rect, round, solid, stroke, treeBuilder } from '../tree.ts'
import type { Pattern } from '../types.ts'
import { placeVisualAndWords } from '../visual-words.ts'
import { stackWords, type Words } from '../words.ts'

export const PHOTO_CARD: Pattern = {
  id: 'photo-card',
  name: 'Photo with a card',
  kinds: ['lifestyle photo', 'sale or offer', 'event'],
  description:
    'The photo over the whole frame, its subject kept clear of a card of brand colour floating on it, which holds the logo, the words and the button.',
  needs: ['headline', 'photo'],
  takes: ['kicker', 'subline', 'button', 'highlight', 'logo'],
}

/** The card's share of the safe room's width: in a start-aligned style down a frame, and across a wide one or banner. */
const CARD_WIDTH = { start: 0.88, across: 0.48, banner: 0.58 }
/** The most of the safe room's height a card takes down a frame. */
const CARD_DOWN_MOST = 0.66
/** The room inside the card round its words, as a share of the margin. */
const PAD = 0.75

/** Builds the photo with a card in the frame. */
export function photoCard(b: Build) {
  const { frame, content, palette, styleName } = b
  const given = content.photo
  const colour = groundColour(b)
  if (isShort(b) || !given) {
    b.tree.add('ground', {
      ...rect('Ground', { x: 0, y: 0, width: frame.width, height: frame.height }, solid(colour)),
      role: 'background',
    })
    placeVisualAndWords(b, {
      ground: colour,
      words: wordsOn(b, colour),
      ...(given ? { visual: { ratio: 1.6, draw: (box: Rect) => photo(b, box) } } : {}),
      first: false,
    })
    return
  }
  const { safe, margin, width, height } = frame
  const pad = Math.round(margin * PAD)
  const across = frame.shape === 'wide' || frame.shape === 'banner'
  const cardWidth = Math.round(
    across
      ? safe.width * (frame.shape === 'banner' ? CARD_WIDTH.banner : CARD_WIDTH.across)
      : b.style.align === 'center'
        ? safe.width
        : safe.width * CARD_WIDTH.start,
  )
  const inner = (box: Rect): Rect => ({
    x: box.x + pad,
    y: box.y + pad,
    width: box.width - 2 * pad,
    height: box.height - 2 * pad,
  })
  const of = (room: Rect): Words => ({ ...wordsOn(b, colour), room, surface: colour.value, justify: 'start' })
  // The card hugs its words: they are set once in the most room it may take, to learn their height.
  const most = across ? safe.height : Math.round(safe.height * CARD_DOWN_MOST)
  const trial = inner({ x: safe.x, y: safe.y, width: cardWidth, height: most })
  // Down a frame the logo goes on the photo's top corner, so the card's room goes to the words.
  const logoRow = across ? logoRowHeight(b, trial) : 0
  const tried = stackWords(treeBuilder(), b, of({ ...trial, y: trial.y + logoRow, height: trial.height - logoRow }))
  const cardHeight = Math.min(most, Math.round(tried.box.height + logoRow + 2 * pad))
  const card = across
    ? { x: safe.x, y: Math.round(safe.y + (safe.height - cardHeight) / 2), width: cardWidth, height: cardHeight }
    : { x: safe.x, y: safe.y + safe.height - cardHeight, width: cardWidth, height: cardHeight }
  const clear = across
    ? { x: card.x + card.width + margin, y: 0, width: width - card.x - card.width - margin, height }
    : { x: 0, y: 0, width, height: Math.max(Math.min(width, height) * 0.3, card.y - margin) }
  // Down a frame the subject keeps clear of a top corner for the logo too.
  const keep = across ? clear : keepUnderLogo(b, clear, Boolean(content.logo))
  // A photo whose subject can't show whole clear of the card over the whole frame stops half way under the card.
  const whole = !given.look || coverCrop(given, { x: 0, y: 0, width, height }, keep).whole
  const box = whole
    ? { x: 0, y: 0, width, height }
    : across
      ? { x: card.x + card.width / 2, y: 0, width: width - card.x - card.width / 2, height }
      : { x: 0, y: 0, width, height: card.y + card.height / 2 }
  const shot = photo(b, box, 0, keep)
  const short = Math.min(width, height)
  const radius = styleName === 'playful' ? Math.round(short * 0.04) : 0
  if (styleName === 'bold') {
    const by = Math.max(3, Math.round(short * 0.014))
    b.tree.add('card-shadow', rect('Card shadow', { ...card, x: card.x + by, y: card.y + by }, solid(palette.accent)))
  }
  b.tree.add('card', { ...rect('Card', card, solid(colour), { radius }), role: 'background' })
  if (styleName === 'premium') {
    const by = Math.round(pad * 0.4)
    const line = { x: card.x + by, y: card.y + by, width: card.width - 2 * by, height: card.height - 2 * by }
    const { colour: ornament, opacity } = ornamentColour(palette, colour.value)
    b.tree.add(
      'card-line',
      rect(
        'Card line',
        line,
        { fills: [] },
        { strokes: [stroke(withAlpha(ornament.value, opacity), Math.max(1, round(short * 0.003)))] },
      ),
    )
  }
  if (styleName === 'playful') {
    const r = short * 0.03
    dotGroup(b, 'dot', { x: width - margin - r, y: margin + r }, r, { x: -1, y: 0.4 }, [
      palette.accent,
      palette.background,
      palette.accent,
    ])
  }
  if (across) stackWords(b.tree, b, of(logoOnTop(b, inner(card), colour)))
  else {
    if (content.logo && !photoLogo(b, shot)) {
      const surface = photoSurface(b)
      logo(b, logoRoom(b, { x: safe.x, y: safe.y }, safe.width, surface), 'start', surface)
    }
    stackWords(b.tree, b, of(inner(card)))
  }
}
