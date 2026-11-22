// Big number: one number, an offer or a fact, the largest thing in the frame, its unit set smaller, with the words
// under it and the button; beside the words in a wide frame, banner or strip. The style sets the number: with a hard
// shadow on brand colour (bold), in the primary on the background (minimal), among soft discs at the corners
// (playful), or in the accent on a deep ground (premium). The number fills its measure, as the hero of the frame. In a
// 9:16 frame the logo heads the safe room, the number and its words fill its middle and the button sits at its foot.
// A wide frame's logo heads its words' column. A short frame keeps its logo, number and button, its headline where it
// fits beside them, else the fewest words that say what the number is.
import type { Rect } from '@dazbee/schema'

import {
  type Build,
  ground,
  inRow,
  isShort,
  logoAtStart,
  logoOnTop,
  logoRowHeight,
  pinsButton,
  roles,
  rowLeast,
} from '../build.ts'
import { ctaFill } from '../button.ts'
import { dots } from '../decorations.ts'
import { contrast, deepColour, INK, inkOn, LARGE_TEXT_CONTRAST, type Swatch } from '../palette.ts'
import type { Pattern } from '../types.ts'
import { keepsEvery, rowFits, rowWords, stackWords, type WordPart, type Words } from '../words.ts'

export const BIG_NUMBER: Pattern = {
  id: 'big-number',
  name: 'Big number',
  kinds: ['big number', 'sale or offer', 'event'],
  description:
    'One number, such as “50%” or “3×”, as large as the frame takes, with the headline under it saying what it means, and the button.',
  needs: ['headline', 'number'],
  takes: ['kicker', 'subline', 'button', 'logo'],
}

/** The contrast a number's hard shadow keeps with the number's ink. */
const SHADOW_CONTRAST = 7
/** The least width a number takes, as a multiple of the readable size. */
const NUMBER_LEAST_WIDTH = 6

/** Builds the big number in the frame. */
export function bigNumber(b: Build) {
  const { frame, palette, content } = b
  const { shape, margin, safe } = frame
  const colour = ground(b)
  decorateUnder(b)
  const ink = numberInk(b, colour)
  const number: WordPart = { kind: 'number', text: content.number ?? '', ink, ...numberLook(b, ink) }
  const rest: WordPart[] = [
    { kind: 'headline', text: content.headline },
    ...(content.subline ? [{ kind: 'subline' as const, text: content.subline }] : []),
  ]
  const kicker: WordPart[] = content.kicker ? [{ kind: 'kicker', text: content.kicker }] : []
  const button = content.button ? { button: content.button, buttonFill: ctaFill(palette, colour, roles(b).cta) } : {}
  const side = shape === 'strip' || shape === 'banner' || shape === 'wide'
  const banner = shape === 'strip' || shape === 'banner'
  // A banner's logo leaves room for the number at its least beside the words and button; a short frame keeps it. A
  // wide frame's logo goes over its words' column, on their start edge.
  const numberLeast = Math.round(frame.readable * NUMBER_LEAST_WIDTH)
  const room: Rect = banner
    ? logoAtStart(b, safe, colour, rowLeast(b) + numberLeast)
    : shape === 'wide'
      ? safe
      : logoOnTop(b, safe, colour)
  if (side) {
    // The number on the left, the words on the right.
    const gap = Math.round(margin * (shape === 'wide' ? 1.5 : 1))
    // The number's share of the room: the largest that leaves the words beside it every part, so the number grows
    // to its height's cap before the words take what is left.
    const shares = shape === 'strip' ? [0.3] : shape === 'banner' ? [0.36, 0.3] : [0.56, 0.51, 0.46, 0.4, 0.34]
    const column = (each: number): Rect => {
      const width = Math.round(room.width * each) + gap
      const words = { ...room, x: room.x + width, width: room.width - width }
      if (shape !== 'wide') return words
      const row = logoRowHeight(b, words)
      return { ...words, y: words.y + row, height: words.height - row }
    }
    const keeps = (each: number) =>
      keepsEvery(b, {
        parts: [...kicker, ...rest],
        room: column(each),
        surface: colour.value,
        align: 'start',
        ...button,
      })
    const share = shares.find(keeps) ?? shares.at(-1) ?? 0.34
    const left = { ...room, width: Math.round(room.width * share) }
    let right = { ...room, x: left.x + left.width + gap, width: room.width - left.width - gap }
    if (shape === 'wide') right = logoOnTop(b, right, colour, 'start')
    const set = stackWords(b.tree, b, {
      key: 'number-words',
      parts: [number],
      room: left,
      surface: colour.value,
      most: left.height,
      align: 'start',
    })
    // The words start a gap after the number as it is set; a short frame too narrow for its headline beside the
    // number and button keeps the number, the logo and the button, and the shortest words that say what the number
    // is where they fit: the kicker, else the headline's first words.
    const start = left.x + set.leadWidth + gap
    const wordsRoom = { ...right, x: start, width: right.x + right.width - start }
    const narrow = isShort(b) && right.x + right.width - start < rowLeast(b)
    const of = (parts: WordPart[]): Words => ({
      parts,
      room: wordsRoom,
      surface: colour.value,
      align: 'start',
      ...button,
    })
    const context: WordPart[][] = [
      ...(content.kicker ? [[{ kind: 'headline' as const, text: content.kicker }]] : []),
      [{ kind: 'headline', text: content.headline.split(' ').slice(0, 2).join(' ') }],
    ]
    const tag = narrow ? (context.find((parts) => inRow(b) && rowFits(b, of(parts))) ?? []) : undefined
    const words = of(tag ?? [...kicker, ...rest])
    if (inRow(b)) rowWords(b.tree, b, words)
    else stackWords(b.tree, b, words)
    return
  }
  stackWords(b.tree, b, {
    parts: [...kicker, number, ...rest],
    room,
    surface: colour.value,
    ...button,
    ...(pinsButton(b) ? { pin: true, together: true } : {}),
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

/**
 * The number's look beyond its type: a hard shadow in a bold style, in the kit's deepest colour, else its text colour
 * or near black, the first that holds the number's ink at SHADOW_CONTRAST, so the shadow reads as the number's
 * edge, never as a blur of it; none where none does.
 */
function numberLook({ styleName, palette, frame }: Build, ink: Swatch): Pick<WordPart, 'effects'> {
  if (styleName !== 'bold') return {}
  const offset = Math.max(2, Math.round(Math.min(frame.width, frame.height) * 0.012))
  const shadow = [deepColour(palette), palette.text, INK].find(
    (colour) => contrast(colour.value, ink.value) >= SHADOW_CONTRAST,
  )
  if (!shadow) return {}
  return { effects: [{ type: 'dropShadow', x: offset, y: offset, blur: 0, spread: 0, color: shadow.value }] }
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
