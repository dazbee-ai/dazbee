// Big number: one number, an offer or a fact, the largest thing in the frame, its unit set smaller, with the words
// under it and the button; beside the words in a wide frame, banner or strip. The style sets the number: with a hard
// shadow on brand colour (bold), in the primary on the background (minimal), among soft discs at the corners
// (playful), or in the accent on a deep ground (premium). The number fills its measure, as the hero of the frame. In a
// 9:16 frame the logo heads the safe room, the number and its words fill its middle and the button sits at its foot.
// A wide frame's logo heads its words' column. A short frame keeps its logo, number and button, its headline where it
// fits beside them, else a whole unit that says what the number is: the kicker, a clause of the headline, or the
// headline at the readable size.
import { type Rect, shownScale } from '@dazbee/schema'

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
import { contrast, deepColour, INK, inkOn, LARGE_TEXT_CONTRAST, type Swatch, TEXT_CONTRAST } from '../palette.ts'
import { LARGE_TEXT_PX, lookStyle } from '../text-look.ts'
import { treeBuilder } from '../tree.ts'
import type { Pattern } from '../types.ts'
import { fitsRoom, keepsEvery, rowFits, rowWords, stackWords, type WordPart, type Words } from '../words.ts'

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
/** The shares of its column a short frame's number is tried at, so its words say what it is beside it. */
const NUMBER_NARROWER = [1, 0.8, 0.64]
/** WCAG 2's large text in a bold face, 14 point, in CSS pixels. */
const LARGE_BOLD_PX = (14 * 4) / 3
/** The marks that end a clause of a headline. */
const CLAUSE_END = /[,;:.!?–—]/

/** Builds the big number in the frame. */
export function bigNumber(b: Build) {
  const { frame, palette, content } = b
  const { shape, margin, safe } = frame
  const colour = ground(b)
  decorateUnder(b)
  // The number in an ink that reads at `needed`: as large text does, else, where a short frame sets it smaller, as
  // text does.
  const numberPart = (needed: number): WordPart => {
    const ink = numberInk(b, colour, needed)
    return { kind: 'number', text: content.number ?? '', ink, ...numberLook(b, ink) }
  }
  let number = numberPart(LARGE_TEXT_CONTRAST)
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
    const numberIn = (width: number): Words => ({
      key: 'number-words',
      parts: [number],
      room: { ...room, width },
      surface: colour.value,
      most: room.height,
      align: 'start',
    })
    let left = { ...room, width: Math.round(room.width * share) }
    let right = { ...room, x: left.x + left.width + gap, width: room.width - left.width - gap }
    if (shape === 'wide') right = logoOnTop(b, right, colour, 'start')
    // The words start a gap after the number as it is set.
    const after = (leadWidth: number): Rect => {
      const start = left.x + leadWidth + gap
      return { ...right, x: start, width: right.x + right.width - start }
    }
    const of = (parts: WordPart[], wordsRoom: Rect): Words => ({
      parts,
      room: wordsRoom,
      surface: colour.value,
      align: 'start',
      ...button,
    })
    // A short frame too narrow for its headline beside the number and button keeps the number, the logo and the
    // button, and the first whole unit that says what the number is and fits: the kicker, a clause the headline's
    // punctuation ends, then the whole headline, which a short frame sets down to the readable size; where none fits,
    // the number is set in a narrower column, in an ink that reads at the size it is set there. Words are never cut
    // mid-phrase.
    const whole = stackWords(treeBuilder(), b, numberIn(left.width))
    const narrow = isShort(b) && after(whole.leadWidth).width < rowLeast(b)
    let tag: WordPart[] | undefined
    if (narrow) {
      const context: WordPart[][] = [content.kicker ?? '', ...clauses(content.headline), content.headline]
        .filter((text) => text !== '')
        .map((text) => [{ kind: 'headline', text }])
      const fits = (parts: WordPart[], wordsRoom: Rect) =>
        inRow(b) ? rowFits(b, of(parts, wordsRoom)) : fitsRoom(b, of(parts, wordsRoom))
      for (const narrower of NUMBER_NARROWER) {
        const width = Math.round(room.width * share * narrower)
        const tried = stackWords(treeBuilder(), b, numberIn(width))
        const wordsRoom = after(tried.leadWidth)
        tag = context.find((parts) => fits(parts, wordsRoom))
        if (tag) {
          left = { ...left, width }
          if (!isLarge(b, tried.size)) number = numberPart(TEXT_CONTRAST)
          break
        }
      }
      tag ??= []
    }
    const set = stackWords(b.tree, b, numberIn(left.width))
    const wordsRoom = after(set.leadWidth)
    const words = of(tag ?? [...kicker, ...rest], wordsRoom)
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
 * The headline's leading clauses, shortest first, each as far as a mark that ends a clause, without the mark: whole
 * phrases that read as complete. None for a headline of one clause.
 */
function clauses(headline: string): string[] {
  const found: string[] = []
  for (let at = 0; at < headline.length; at++) {
    const char = headline[at] ?? ''
    if (!CLAUSE_END.test(char)) continue
    // A mark inside a word, such as a decimal point, doesn't end a clause.
    const next = headline[at + 1]
    if (next !== undefined && next !== ' ') continue
    const clause = headline.slice(0, at).trim()
    if (clause !== '' && at < headline.trim().length - 1) found.push(clause)
  }
  return found
}

/**
 * The number's ink, the first that reads on the ground at `needed`: the primary (minimal) or the accent, then the
 * background and the text colour.
 */
function numberInk({ palette, styleName }: Build, ground: Swatch, needed: number): Swatch {
  const first = styleName === 'minimal' ? palette.primary : palette.accent
  return inkOn(ground.value, [first, palette.background, palette.text], needed)
}

/** Whether a number set at `size` is large text as shown: LARGE_TEXT_PX, or LARGE_BOLD_PX in a bold face. */
function isLarge(b: Build, size: number): boolean {
  const shown = size / shownScale(b.frame.width, b.frame.height)
  return shown >= LARGE_TEXT_PX || (shown >= LARGE_BOLD_PX && lookStyle(b, b.style.headline, size).fontWeight >= 700)
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
