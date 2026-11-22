// Words only: the headline is the picture, its key words set apart, with the kicker, subline, button and logo, and
// the style's decoration round them: slanted bars of accent from the corners (bold), nothing but air (minimal), soft
// discs at the corners (playful), or a fine frame line and a small diamond on a deep ground (premium). In a tall
// frame the logo heads the safe room, the headline grows into its middle and the button sits at its foot.
import type { Rect } from '@dazbee/schema'

import { type Build, ground, inRow, isTall, logoAtStart, logoOnTop, roles, usualWords } from '../build.ts'
import { ctaFill } from '../button.ts'
import { bar, dots, insetFrame } from '../decorations.ts'
import { INK, inkOn, mixed, ornamentColour, withAlpha } from '../palette.ts'
import { linear, rect, round } from '../tree.ts'
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

/** How much larger the headline may grow in a tall frame than in a square one. */
const TALL_GROWS = 1.4

/** Builds words only in the frame. */
export function wordsOnly(b: Build) {
  const { frame, styleName, palette, content } = b
  const { width, height, safe } = frame
  const short = Math.min(width, height)
  const colour = ground(b)
  if (styleName === 'premium') {
    // A sheen across the deep ground, from its ink faint at the top to a darker shade of it.
    const light = withAlpha(inkOn(colour.value, [palette.background, palette.text]).value, 0.08)
    const dark = withAlpha(mixed(colour.value, INK.value, 0.6), 0.3)
    b.tree.add('sheen', {
      ...rect('Sheen', { x: 0, y: 0, width, height }, linear([0, 0], [1, 1], [light, withAlpha(light, 0), dark])),
      role: 'decoration',
    })
  }
  if (styleName === 'premium' && !inRow(b)) insetFrame(b, ornamentColour(palette, colour.value).colour, 0.8)
  decorateUnder(b)
  const row = inRow(b)
  const room: Rect = row ? logoAtStart(b, safe, colour) : logoOnTop(b, safe, colour)
  const tall = isTall(b)
  const words: Words = {
    parts: usualWords(content),
    room,
    surface: colour.value,
    ...(content.button ? { button: content.button, buttonFill: ctaFill(palette, colour, roles(b).cta) } : {}),
    // Minimal sets its headline at the top and its button at the foot, on one edge; a tall frame spreads its words.
    ...(tall || styleName === 'minimal' ? { pin: true } : {}),
    justify: styleName === 'minimal' && !tall ? 'start' : 'center',
    ...(tall ? { most: Math.round(b.style.headlineMax * short * TALL_GROWS) } : {}),
  }
  const set = row ? rowWords(b.tree, b, words) : stackWords(b.tree, b, words)
  if (row || styleName !== 'premium') return
  const mark = ornamentColour(palette, colour.value)
  const d = Math.max(6, Math.round(set.size * 0.22))
  const y = set.box.y - d - Math.round(set.size * 0.35)
  if (y > room.y - frame.margin * 0.6) {
    const x = b.style.align === 'center' ? set.box.x + set.box.width / 2 - d / 2 : set.box.x
    bar(b, 'diamond', 'Diamond', { x: round(x), y: round(y), width: d, height: d }, mark.colour)
    const diamond = b.tree.tree().nodes.diamond
    if (diamond?.type === 'graphic') {
      diamond.props.rotation = 45
      diamond.props.opacity = mark.opacity
    }
  }
}

/** The style's decoration under the words, at the frame's corners: slanted bars, or soft discs. */
function decorateUnder(b: Build) {
  const { frame, styleName, palette } = b
  if (inRow(b)) return
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
