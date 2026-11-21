// Big number: one number, an offer or a fact, set as large as the frame takes, with the words under it and the
// button; beside the words in a wide frame, banner or strip. The style sets the number: with a hard shadow on brand
// colour (bold), in the primary on the background (minimal), among soft discs at the corners (playful), or in the
// accent inside a fine frame line on a dark ground (premium).
import type { Rect } from '@dazbee/schema'

import { type Build, logo, logoRoom } from '../build.ts'
import { dots, insetFrame } from '../decorations.ts'
import { contrast, inkOn, LARGE_TEXT_CONTRAST, type Swatch } from '../palette.ts'
import { rect, solid } from '../tree.ts'
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

/** Builds the big number in the frame. */
export function bigNumber(b: Build) {
  const { frame, styleName, palette, content } = b
  const { width, height, shape, margin, safe } = frame
  const ground = groundColour(b)
  if (ground !== palette.background)
    b.tree.add('ground', { ...rect('Ground', { x: 0, y: 0, width, height }, solid(ground)), role: 'background' })
  decorateUnder(b)
  const number: WordPart = { kind: 'number', text: content.number ?? '', ink: numberInk(b, ground), ...numberLook(b) }
  const rest: WordPart[] = [
    { kind: 'headline', text: content.headline },
    ...(content.subline ? [{ kind: 'subline' as const, text: content.subline }] : []),
  ]
  const kicker: WordPart[] = content.kicker ? [{ kind: 'kicker', text: content.kicker }] : []
  const buttonFill = contrast(palette.accent.value, ground.value) >= 1.6 ? palette.accent : palette.background
  const button = content.button ? { button: content.button, buttonFill } : {}
  let room: Rect = safe
  if (shape !== 'strip' && shape !== 'banner') {
    const top = logoRoom(b, { x: safe.x, y: safe.y }, safe.width)
    if (b.style.align === 'center') top.x = Math.round(safe.x + (safe.width - top.width) / 2)
    if (logo(b, top, b.style.align === 'center' ? 'center' : 'start', ground)) {
      const below = top.height + margin
      room = { ...safe, y: safe.y + below, height: safe.height - below }
    }
  }
  if (shape === 'strip' || shape === 'banner' || shape === 'wide') {
    // The number on the left, the words on the right.
    const share = shape === 'strip' ? 0.26 : shape === 'banner' ? 0.34 : 0.46
    const left = { ...room, width: Math.round(room.width * share) }
    const gap = Math.round(margin * (shape === 'wide' ? 1.5 : 1))
    const right = { ...room, x: left.x + left.width + gap, width: room.width - left.width - gap }
    stackWords(b.tree, b, {
      key: 'number-words',
      parts: [number],
      room: left,
      surface: ground.value,
      most: left.height,
      align: 'start',
    })
    const words: Words = {
      parts: [...kicker, ...rest],
      room: right,
      surface: ground.value,
      align: 'start',
      ...button,
    }
    if (shape === 'strip') rowWords(b.tree, b, words)
    else stackWords(b.tree, b, words)
  } else {
    stackWords(b.tree, b, { parts: [...kicker, number, ...rest], room, surface: ground.value, ...button })
  }
  if (styleName === 'premium' && shape !== 'strip') insetFrame(b, palette.accent, Math.round(margin * 0.4), 0.8)
}

/** The ground: the primary (bold, playful), a dark (premium), else the kit's background. */
function groundColour({ styleName, palette }: Build): Swatch {
  if (styleName === 'premium') return palette.secondary
  if (styleName === 'minimal') return palette.background
  return palette.primary
}

/**
 * The number's ink, the first that reads on the ground as large text does: the primary (minimal) or the accent, then
 * the background and the text colour.
 */
function numberInk({ palette, styleName }: Build, ground: Swatch): Swatch {
  const first = styleName === 'minimal' ? palette.primary : palette.accent
  return inkOn(ground.value, [first, palette.background, palette.text], LARGE_TEXT_CONTRAST)
}

/** The number's look beyond its type: a hard shadow in a bold style. */
function numberLook({ styleName, palette, frame }: Build): Pick<WordPart, 'effects'> {
  if (styleName !== 'bold') return {}
  const offset = Math.max(2, Math.round(Math.min(frame.width, frame.height) * 0.012))
  return { effects: [{ type: 'dropShadow', x: offset, y: offset, blur: 0, spread: 0, color: palette.secondary.value }] }
}

/** The style's decoration under everything: soft discs at the corners in a playful style. */
function decorateUnder(b: Build) {
  const { frame, styleName, palette } = b
  if (styleName !== 'playful' || frame.shape === 'strip') return
  const short = Math.min(frame.width, frame.height)
  dots(b, 'disc', [
    { x: frame.width, y: 0, r: short * 0.32, colour: palette.accent, opacity: 0.9 },
    { x: 0, y: frame.height, r: short * 0.26, colour: palette.background, opacity: 0.2 },
  ])
}
