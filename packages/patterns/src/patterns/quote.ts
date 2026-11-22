// Quote: what a customer said, large, under an opening quotation mark set in the quote's own face, with who said it
// and their photo in a circle. The style sets the mark and the stars: a big mark and five stars on brand colour
// (bold), a fine mark on the background (minimal), a mark with stars on the background (playful), or a mark in the
// accent inside a fine frame line on a deep ground (premium). In a tall frame the logo heads the safe room, the quote
// fills its middle and the button sits at its foot.
import { type Rect, TextProps } from '@dazbee/schema'

import { type Build, ground, inRow, isTall, logoAtStart, logoOnTop, roles, rowLeast } from '../build.ts'
import { ctaFill } from '../button.ts'
import { insetFrame } from '../decorations.ts'
import { contrast, inkOn, LARGE_TEXT_CONTRAST, ornamentColour, type Swatch } from '../palette.ts'
import { lookStyle } from '../text-look.ts'
import { ellipse, picture, round, solid, star } from '../tree.ts'
import type { Pattern } from '../types.ts'
import { rowWords, stackWords, type Words } from '../words.ts'

export const QUOTE: Pattern = {
  id: 'quote',
  name: 'Quote',
  kinds: ['quote or testimonial'],
  description:
    'What a customer said, as the headline under an opening quotation mark, with who said it (attribution) beside their photo in a circle.',
  needs: ['headline', 'attribution'],
  takes: ['photo', 'button', 'logo'],
}

/** The opening quotation mark. */
const OPENING_MARK = '“'
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
  if (styleName === 'premium' && !banner) insetFrame(b, ornamentColour(palette, colour.value).colour, 0.8)
  // A banner's logo leaves room for the person's photo beside the words and button.
  const photoLeast = content.photo ? safe.height + margin : 0
  let room: Rect = banner ? logoAtStart(b, safe, colour, rowLeast(b) + photoLeast) : logoOnTop(b, safe, colour)
  // The person's photo: on the left in a wide frame, banner or strip, else over the mark.
  const side = shape === 'wide' || banner
  const above: string[] = []
  if (content.photo) {
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
    if (styleName === 'bold' || styleName === 'playful') {
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
  const tall = isTall(b)
  const words: Words = {
    parts: [
      { kind: 'headline', text: content.headline },
      ...(content.attribution ? [{ kind: 'attribution' as const, text: content.attribution }] : []),
    ],
    room,
    surface: colour.value,
    justify: 'center',
    most: Math.round(short * b.style.headlineMax * (tall ? 1.1 : 0.85)),
    ...(content.button ? { button: content.button, buttonFill: ctaFill(palette, colour, roles(b).cta) } : {}),
    ...(tall ? { pin: true } : {}),
  }
  if (inRow(b)) rowWords(b.tree, b, words)
  else {
    const set = stackWords(b.tree, b, words)
    // Over the words, the photo, mark and stars come down with them, so the whole sits in the middle.
    const dy = set.box.y - room.y
    if (!side && dy > 0) for (const key of above) b.tree.moveDown(key, dy)
  }
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
