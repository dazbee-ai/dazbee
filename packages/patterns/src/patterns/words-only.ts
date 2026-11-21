// Words only: the headline is the picture, its key words set apart, with the kicker, subline, button and logo, and
// the style's decoration round them: slanted bars of accent from the corners (bold), fine rules (minimal), soft discs
// at the corners (playful), or a fine frame line and a small diamond on a dark ground (premium).
import type { Rect } from '@dazbee/schema'

import { type Build, logo, logoRoom, usualWords } from '../build.ts'
import { bar, dots, insetFrame } from '../decorations.ts'
import { contrast, type Swatch } from '../palette.ts'
import { linear, rect, round, solid } from '../tree.ts'
import type { Pattern } from '../types.ts'
import { rowWords, stackWords, type Words } from '../words.ts'

export const WORDS_ONLY: Pattern = {
  id: 'words-only',
  name: 'Words only',
  kinds: ['words only', 'sale or offer', 'event', 'app download'],
  description:
    'No picture: the headline is the ad, its highlighted words set apart, with the kicker, subline, button and logo on brand colour.',
  needs: ['headline'],
  takes: ['kicker', 'subline', 'button', 'highlight', 'logo'],
}

/** Builds words only in the frame. */
export function wordsOnly(b: Build) {
  const { frame, styleName, palette, content } = b
  const { width, height, shape, margin, safe } = frame
  const short = Math.min(width, height)
  const ground = groundColour(b)
  if (ground !== palette.background)
    b.tree.add('ground', { ...rect('Ground', { x: 0, y: 0, width, height }, solid(ground)), role: 'background' })
  if (styleName === 'premium')
    b.tree.add('sheen', {
      ...rect('Sheen', { x: 0, y: 0, width, height }, linear([0, 0], [1, 1], ['#FFFFFF14', '#FFFFFF00', '#00000026'])),
      role: 'decoration',
    })
  decorateUnder(b)
  let room: Rect = safe
  if (shape === 'strip') {
    // The logo's tab fills the strip's height, the logo inside it.
    const tall = Math.floor(height / 2)
    const top = logoRoom(b, { x: safe.x, y: Math.round((height - tall) / 2) }, Math.round(width * 0.22))
    const placed = logo(b, { ...top, height: tall }, 'start', ground)
    if (placed)
      room = {
        ...safe,
        x: placed.x + placed.width + margin * 1.5,
        width: safe.x + safe.width - placed.x - placed.width - margin * 1.5,
      }
  } else {
    const top = logoRoom(b, { x: safe.x, y: safe.y }, safe.width)
    const centred = b.style.align === 'center'
    if (centred) top.x = Math.round(safe.x + (safe.width - top.width) / 2)
    if (logo(b, top, centred ? 'center' : 'start', ground)) {
      const below = top.height + margin
      room = { ...safe, y: safe.y + below, height: safe.height - below }
    }
  }
  const buttonFill = contrast(palette.accent.value, ground.value) >= 1.6 ? palette.accent : palette.primary
  const words: Words = {
    parts: usualWords(content),
    room,
    surface: ground.value,
    ...(content.button ? { button: content.button, buttonFill } : {}),
  }
  const set = shape === 'strip' ? rowWords(b.tree, b, words) : stackWords(b.tree, b, words)
  if (shape === 'strip') return
  if (styleName === 'premium') {
    insetFrame(b, palette.accent, Math.round(margin * 0.4), 0.8)
    const d = Math.max(6, Math.round(set.size * 0.28))
    const y = set.box.y - d - Math.round(set.size * 0.35)
    if (y > room.y - margin * 0.6) {
      const x = b.style.align === 'center' ? set.box.x + set.box.width / 2 - d / 2 : set.box.x
      bar(b, 'diamond', 'Diamond', { x: round(x), y: round(y), width: d, height: d }, palette.accent)
      const diamond = b.tree.tree().nodes.diamond
      if (diamond?.type === 'graphic') diamond.props.rotation = 45
    }
  }
  if (styleName === 'minimal') {
    const thick = Math.max(2, Math.round(short * 0.006))
    const y = set.box.y + set.box.height + Math.round(margin * 0.6)
    if (y + thick < safe.y + safe.height)
      bar(b, 'rule', 'Rule', { x: set.box.x, y, width: Math.round(short * 0.12), height: thick }, palette.accent)
  }
}

/** The ground: the primary (bold, playful), a dark (premium), else the kit's background. */
function groundColour({ styleName, palette }: Build): Swatch {
  if (styleName === 'premium') return palette.secondary
  if (styleName === 'minimal') return palette.background
  return palette.primary
}

/** The style's decoration under the words, at the frame's corners: slanted bars, or soft discs. */
function decorateUnder(b: Build) {
  const { frame, styleName, palette } = b
  if (frame.shape === 'strip') return
  const short = Math.min(frame.width, frame.height)
  if (styleName === 'bold') {
    const thick = Math.round(short * 0.06)
    for (const [i, colour] of [palette.accent, palette.secondary].entries()) {
      const key = `bar-${i + 1}`
      bar(
        b,
        key,
        `Bar ${i + 1}`,
        { x: frame.width - short * 0.5, y: frame.height - thick * (2.2 + i * 1.3), width: short * 0.75, height: thick },
        colour,
      )
      const layer = b.tree.tree().nodes[key]
      if (layer?.type === 'graphic') layer.props.rotation = -12
    }
  }
  if (styleName === 'playful')
    dots(b, 'disc', [
      { x: frame.width * 0.98, y: frame.height * 0.02, r: short * 0.24, colour: palette.accent },
      { x: frame.width * 0.04, y: frame.height * 0.98, r: short * 0.2, colour: palette.background, opacity: 0.22 },
      { x: frame.width * 0.86, y: frame.height * 0.9, r: short * 0.05, colour: palette.background },
    ])
}
