// Big number: one number, an offer or a fact, the largest thing in the frame, its unit set smaller, with the words
// under it and the button; beside the words in a wide frame, banner or strip. The style sets the number: with a hard
// shadow in the kit's deepest colour on brand colour (bold), in the primary on the background (minimal), among soft
// discs at the corners (playful), or in the accent on a deep ground (premium). In a tall frame the logo heads the
// safe room, the number and its words fill its middle and the button sits at its foot.
import type { Rect } from '@dazbee/schema'

import { type Build, ground, inRow, isTall, logoAtStart, logoOnTop, roles, rowLeast } from '../build.ts'
import { ctaFill } from '../button.ts'
import { dots } from '../decorations.ts'
import { deepColour, inkOn, LARGE_TEXT_CONTRAST, type Swatch } from '../palette.ts'
import type { Pattern } from '../types.ts'
import { rowWords, stackWords, type WordPart, type Words } from '../words.ts'

export const BIG_NUMBER: Pattern = {
  id: 'big-number',
  name: 'Big number',
  kinds: ['big number', 'sale or offer', 'event'],
  description:
    'One number, such as “50%” or “3×”, as large as the frame takes, with the headline under it saying what it means, and the button.',
  needs: ['headline', 'number'],
  takes: ['kicker', 'subline', 'button', 'logo'],
}

/** The least width a number takes, as a multiple of the readable size. */
const NUMBER_LEAST_WIDTH = 6

/** Builds the big number in the frame. */
export function bigNumber(b: Build) {
  const { frame, palette, content } = b
  const { shape, margin, safe } = frame
  const colour = ground(b)
  decorateUnder(b)
  const number: WordPart = { kind: 'number', text: content.number ?? '', ink: numberInk(b, colour), ...numberLook(b) }
  const rest: WordPart[] = [
    { kind: 'headline', text: content.headline },
    ...(content.subline ? [{ kind: 'subline' as const, text: content.subline }] : []),
  ]
  const kicker: WordPart[] = content.kicker ? [{ kind: 'kicker', text: content.kicker }] : []
  const button = content.button ? { button: content.button, buttonFill: ctaFill(palette, colour, roles(b).cta) } : {}
  const side = shape === 'strip' || shape === 'banner' || shape === 'wide'
  const banner = shape === 'strip' || shape === 'banner'
  // A banner's logo leaves room for the number at its least beside the words and button.
  const numberLeast = Math.round(frame.readable * NUMBER_LEAST_WIDTH)
  const room: Rect = banner ? logoAtStart(b, safe, colour, rowLeast(b) + numberLeast) : logoOnTop(b, safe, colour)
  if (side) {
    // The number on the left, the words on the right.
    const share = shape === 'strip' ? 0.3 : shape === 'banner' ? 0.36 : 0.46
    const left = { ...room, width: Math.round(room.width * share) }
    const gap = Math.round(margin * (shape === 'wide' ? 1.5 : 1))
    const right = { ...room, x: left.x + left.width + gap, width: room.width - left.width - gap }
    const set = stackWords(b.tree, b, {
      key: 'number-words',
      parts: [number],
      room: left,
      surface: colour.value,
      most: left.height,
      align: 'start',
    })
    // The words start a gap after the number as it is set.
    const start = left.x + set.leadWidth + gap
    const words: Words = {
      parts: [...kicker, ...rest],
      room: { ...right, x: start, width: right.x + right.width - start },
      surface: colour.value,
      align: 'start',
      ...button,
    }
    if (inRow(b)) rowWords(b.tree, b, words)
    else stackWords(b.tree, b, words)
    return
  }
  stackWords(b.tree, b, {
    parts: [...kicker, number, ...rest],
    room,
    surface: colour.value,
    ...button,
    ...(isTall(b) ? { pin: true } : {}),
  })
}

/**
 * The number's ink, the first that reads on the ground as large text does: the primary (minimal) or the accent, then
 * the background and the text colour.
 */
function numberInk({ palette, styleName }: Build, ground: Swatch): Swatch {
  const first = styleName === 'minimal' ? palette.primary : palette.accent
  return inkOn(ground.value, [first, palette.background, palette.text], LARGE_TEXT_CONTRAST)
}

/** The number's look beyond its type: a hard shadow in the kit's deepest colour in a bold style. */
function numberLook({ styleName, palette, frame }: Build): Pick<WordPart, 'effects'> {
  if (styleName !== 'bold') return {}
  const offset = Math.max(2, Math.round(Math.min(frame.width, frame.height) * 0.012))
  const shadow = deepColour(palette).value
  return { effects: [{ type: 'dropShadow', x: offset, y: offset, blur: 0, spread: 0, color: shadow }] }
}

/** The style's decoration under everything: soft discs at the corners in a playful style. */
function decorateUnder(b: Build) {
  const { frame, styleName, palette } = b
  if (styleName !== 'playful' || inRow(b)) return
  const short = Math.min(frame.width, frame.height)
  dots(b, 'disc', [
    { x: frame.width, y: 0, r: short * 0.32, colour: palette.accent, opacity: 0.9 },
    { x: 0, y: frame.height, r: short * 0.26, colour: palette.background, opacity: 0.2 },
  ])
}
