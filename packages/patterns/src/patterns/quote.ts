// Quote: what a customer said, large, under an opening quotation mark set in the quote's own face, with who said it
// and their photo in a circle. The style sets the mark and the stars: a big mark and five stars on brand colour
// (bold), a fine mark on the background (minimal), a mark with stars on the background (playful), or a mark in the
// accent inside a fine frame line on a deep ground (premium). A banner, with no room for the large mark, hangs a
// small one before the quote's first line, so a quote always reads as one. In a 9:16 frame the logo heads the safe
// room, the quote fills its middle and the button sits at its foot.
import { type Rect, TextProps } from '@dazbee/schema'

import { type Build, ground, inRow, isShort, logoAtStart, logoOnTop, pinsButton, roles, rowLeast } from '../build.ts'
import { ctaFill } from '../button.ts'
import { insetFrame } from '../decorations.ts'
import { contrast, inkOn, LARGE_TEXT_CONTRAST, ornamentColour, type Swatch } from '../palette.ts'
import { inkFor, lookStyle } from '../text-look.ts'
import { ellipse, picture, round, solid, star } from '../tree.ts'
import type { Pattern } from '../types.ts'
import { rowWords, type SetWords, stackWords, type Words } from '../words.ts'

export const QUOTE: Pattern = {
  id: 'quote',
  name: 'Quote',
  kinds: ['quote or testimonial'],
  description:
    'What a customer said, as the headline under an opening quotation mark, with who said it (attribution) beside their photo in a circle.',
  needs: ['headline', 'attribution'],
  takes: ['photo', 'button', 'logo'],
}

/** How large a quote may be, as a share of the style's largest headline: it fills its room as the hero of the frame. */
const QUOTE_MOST = 1.1
/** The opening quotation mark. */
const OPENING_MARK = '“'
/** The shorter side under which a display square leaves out the person's photo and the stars. */
const SMALL_SQUARE = 400
/** The largest a banner's quote is set, as a share of the frame's height, and the gap after its hung mark, of its size. */
const HUNG_MARK_MOST = 0.38
const HUNG_GAP = 0.12
/** The share of its size a quotation mark's ink takes down from the top of its line, and where that ink starts. */
const MARK_INK_FOOT = 0.42
const MARK_INK_TOP = 0.08

/** Builds the quote in the frame. */
export function quote(b: Build) {
  const { frame, styleName, palette, content } = b
  const { width, height, shape, margin, safe } = frame
  const short = Math.min(width, height)
  const colour = ground(b)
  const markColour = markInk(b, colour)
  const centred = b.style.align === 'center'
  const banner = shape === 'strip' || shape === 'banner'
  const display = width < 1000 && height < 1000
  if (styleName === 'premium' && !banner) insetFrame(b, ornamentColour(palette, colour.value).colour, 0.8)
  // A banner's logo leaves room for the person's photo beside the words and button; a short frame keeps its logo,
  // and leaves the photo out where it can't hold it beside the mark, words and button.
  const photoLeast = content.photo ? safe.height + margin : 0
  const markRoom = banner ? hungMarkWidth(b) : 0
  let room: Rect = banner ? logoAtStart(b, safe, colour, rowLeast(b) + photoLeast) : logoOnTop(b, safe, colour)
  // A small display square has no height for the photo over the quote; it keeps the quote large and who said it.
  const smallSquare = display && shape === 'square' && short < SMALL_SQUARE
  const keepsPhoto = !smallSquare && (!isShort(b) || room.width - photoLeast - markRoom >= rowLeast(b))
  // The person's photo: on the left in a wide frame, banner or strip, else over the mark.
  const side = shape === 'wide' || banner
  const above: string[] = []
  if (content.photo && keepsPhoto) {
    const d = Math.round(
      side
        ? Math.min(room.height * (shape === 'wide' ? 0.6 : 1), room.width * 0.3)
        : Math.min(short * 0.17, room.height * 0.2),
    )
    const at = side
      ? { x: room.x, y: room.y + (room.height - d) / 2 }
      : { x: centred ? room.x + (room.width - d) / 2 : room.x, y: room.y }
    const box = { x: round(at.x), y: round(at.y), width: d, height: d }
    if (styleName === 'playful' || styleName === 'bold') {
      const ring = Math.max(2, Math.round(d * 0.05))
      b.tree.add(
        'photo-ring',
        ellipse(
          'Ring',
          { x: box.x - ring, y: box.y - ring, width: d + 2 * ring, height: d + 2 * ring },
          solid(markColour),
        ),
      )
      above.push('photo-ring')
    }
    b.tree.add('photo', { ...picture('Photo', box, content.photo, { radius: d / 2 }), role: 'person' })
    above.push('photo')
    const gap = Math.round(margin * 0.6)
    room = side
      ? { ...room, x: room.x + d + gap * 1.5, width: room.width - d - gap * 1.5 }
      : { ...room, y: room.y + d + gap, height: room.height - d - gap }
  }
  // The mark over the words, and five stars in a bold or playful style; a banner or strip has no room for them.
  if (!banner) {
    const reserve = Math.round(Math.max(frame.readable * 2, Math.min(short * 0.13, room.height * 0.17)))
    const size = Math.round(reserve / MARK_INK_FOOT)
    const mark = markText(b, size, markColour)
    const markWidth = b.measure(TextProps.parse(mark.props), null).width
    const x = centred ? room.x + (room.width - markWidth) / 2 : room.x
    b.tree.add('quote-mark', {
      ...mark,
      props: { ...mark.props, x: round(x), y: round(room.y - size * MARK_INK_TOP), width: Math.ceil(markWidth) },
    })
    above.push('quote-mark')
    let below = reserve + Math.round(margin * 0.4)
    if ((styleName === 'bold' || styleName === 'playful') && !smallSquare) {
      const starSize = Math.round(reserve * 0.5)
      const row = starSize * 5 + Math.round(starSize * 0.2) * 4
      const x0 = centred ? room.x + (room.width - row) / 2 : room.x + markWidth + starSize * 0.8
      const y0 = centred ? room.y + reserve + Math.round(margin * 0.3) : room.y + (reserve - starSize) / 2
      for (let i = 0; i < 5; i++) {
        b.tree.add(
          `star-${i + 1}`,
          star(
            `Star ${i + 1}`,
            { x: round(x0 + i * starSize * 1.2), y: round(y0), width: starSize, height: starSize },
            { points: 5, inner: 0.45 },
            solid(markColour),
          ),
        )
        above.push(`star-${i + 1}`)
      }
      if (centred) below += starSize + Math.round(margin * 0.3)
    }
    room = { ...room, y: room.y + below, height: room.height - below }
  }
  // A banner has no room for the large mark: a small one hangs before the quote's first line, so it always reads as
  // a quote.
  if (banner) room = { ...room, x: room.x + markRoom, width: room.width - markRoom }
  const words: Words = {
    parts: [
      { kind: 'headline', text: content.headline },
      ...(content.attribution ? [{ kind: 'attribution' as const, text: content.attribution }] : []),
    ],
    room,
    surface: colour.value,
    justify: 'center',
    // A banner's quote starts at its mark.
    ...(banner ? { align: 'start' as const } : {}),
    most: Math.round(short * b.style.headlineMax * QUOTE_MOST),
    ...(content.button ? { button: content.button, buttonFill: ctaFill(palette, colour, roles(b).cta) } : {}),
    ...(pinsButton(b) ? { pin: true, together: true } : {}),
  }
  if (banner) {
    const set = inRow(b) ? rowWords(b.tree, b, words) : stackWords(b.tree, b, words)
    hungMark(b, set, markColour, colour)
  } else {
    const set = stackWords(b.tree, b, words)
    // Over the words, the photo, mark and stars come down with them, so the whole sits in the middle.
    const dy = set.box.y - room.y
    if (!side && dy > 0) for (const key of above) b.tree.moveDown(key, dy)
  }
}

/** The room a small mark hung before a banner's quote takes: its width at the largest the quote is set, and a gap. */
function hungMarkWidth(b: Build): number {
  const size = Math.round(b.frame.height * HUNG_MARK_MOST)
  const mark = markText(b, size, b.palette.text)
  return Math.ceil(b.measure(TextProps.parse(mark.props), null).width + size * HUNG_GAP)
}

/** The small mark, at the quote's size, its right edge a gap before the quote's first line. */
function hungMark(b: Build, set: SetWords, colour: Swatch, ground: Swatch) {
  const ink = inkFor(b, ground.value, set.size, [colour, b.palette.text, b.palette.background])
  const mark = markText(b, set.size, ink)
  const width = Math.ceil(b.measure(TextProps.parse(mark.props), null).width)
  const x = set.texts.x - width - Math.round(set.size * HUNG_GAP)
  b.tree.add('quote-mark', { ...mark, props: { ...mark.props, x: round(x), y: round(set.texts.y), width } })
}

/** The mark's colour: the first of the kit's colours, but the ground's, that reads on the ground as large text does. */
function markInk({ palette }: Build, ground: Swatch): Swatch {
  const offered = [palette.accent, palette.primary, palette.secondary, palette.text, palette.background]
  return (
    offered.find(
      (swatch) => swatch.value !== ground.value && contrast(swatch.value, ground.value) >= LARGE_TEXT_CONTRAST,
    ) ?? inkOn(ground.value, [palette.text, palette.background], LARGE_TEXT_CONTRAST)
  )
}

/** The opening mark as a text in the headline's face at `size`, bound to the heading font and the mark's colour. */
function markText(b: Build, size: number, colour: Swatch) {
  const font = b.palette.heading
  return {
    type: 'text' as const,
    name: 'Quotation mark',
    role: 'decoration' as const,
    props: {
      x: 0,
      y: 0,
      width: size,
      height: size,
      text: OPENING_MARK,
      style: { ...lookStyle(b, b.style.headline, size), color: colour.value, lineHeight: 1 },
      boxMode: 'autoWidth',
    },
    bindings: { ...(font.ref ? { fontFamily: font.ref } : {}), ...(colour.ref ? { textColor: colour.ref } : {}) },
  }
}
