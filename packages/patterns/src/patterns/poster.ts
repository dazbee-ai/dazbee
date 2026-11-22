// Poster: the words first, the headline as the poster's title, the photo framed under them (beside them in a wide
// frame or banner) with its whole subject shown, as a printed poster sets its picture, and the button at its foot.
// The style frames the photo: over a hard offset block of the accent (bold), on a pale mat with a fine edge
// (minimal), rounded with a group of dots (playful), or inside a fine accent line set out from it (premium).
import type { Rect } from '@dazbee/schema'

import { type Build, ground, photo, wordsOn } from '../build.ts'
import { subjectOf } from '../crop.ts'
import { dotGroup } from '../decorations.ts'
import { mixed, ornamentColour, type Swatch, withAlpha } from '../palette.ts'
import { rect, round, solid, stroke } from '../tree.ts'
import type { Pattern } from '../types.ts'
import { placeVisualAndWords } from '../visual-words.ts'

export const POSTER: Pattern = {
  id: 'poster',
  name: 'Poster',
  kinds: ['event', 'lifestyle photo', 'product launch'],
  description:
    'The headline first, as a poster’s title, and the photo framed under it with its whole subject shown, the button with the words.',
  needs: ['headline', 'photo'],
  takes: ['kicker', 'subline', 'button', 'highlight', 'logo'],
}

/** The photo's frame's width over its height: the subject's shape with room round it, kept between these. */
const RATIO = { least: 0.8, most: 1.6, room: 1.25 }

/** Builds the poster in the frame. */
export function poster(b: Build) {
  const colour = ground(b)
  const given = b.content.photo
  const subject = given ? subjectOf(given) : { width: 4, height: 3 }
  const ratio = Math.min(RATIO.most, Math.max(RATIO.least, (subject.width / subject.height) * RATIO.room))
  placeVisualAndWords(b, {
    ground: colour,
    words: wordsOn(b, colour),
    visual: { ratio, draw: (box) => framed(b, box, colour), short: false, fill: true },
    first: false,
    buttonApart: true,
  })
}

/** The photo framed in `box`, in the style's way. */
function framed(b: Build, box: Rect, colour: Swatch) {
  const { styleName, palette, frame } = b
  const short = Math.min(frame.width, frame.height)
  if (styleName === 'bold') {
    const by = Math.max(4, Math.round(short * 0.018))
    const inner = { ...box, width: box.width - by, height: box.height - by }
    b.tree.add('block', rect('Block', { ...inner, x: inner.x + by, y: inner.y + by }, solid(palette.accent)))
    photo(b, inner)
    return
  }
  if (styleName === 'minimal') {
    const mat = Math.round(Math.min(box.width, box.height) * 0.05)
    const edge = { strokes: [stroke(withAlpha(palette.text.value, 0.18), Math.max(1, round(short * 0.002)))] }
    b.tree.add('mat', rect('Mat', box, solid({ value: mixed(colour.value, palette.primary.value, 0.06) }), edge))
    photo(b, { x: box.x + mat, y: box.y + mat, width: box.width - 2 * mat, height: box.height - 2 * mat })
    return
  }
  if (styleName === 'playful') {
    photo(b, box, Math.round(Math.min(box.width, box.height) * 0.08))
    const r = short * 0.025
    dotGroup(b, 'dot', { x: box.x + box.width - r * 0.5, y: box.y + box.height + r * 1.6 }, r, { x: -1, y: 0 }, [
      palette.accent,
      palette.secondary,
      palette.accent,
    ])
    return
  }
  const out = Math.round(Math.min(box.width, box.height) * 0.04)
  const inner = { x: box.x + out, y: box.y + out, width: box.width - 2 * out, height: box.height - 2 * out }
  photo(b, inner)
  const { colour: line, opacity } = ornamentColour(palette, colour.value)
  const stroked = rect(
    'Photo line',
    box,
    { fills: [] },
    { strokes: [stroke(line.value, Math.max(1, round(short * 0.003)))] },
  )
  b.tree.add('photo-line', { ...stroked, props: { ...stroked.props, opacity } })
}
