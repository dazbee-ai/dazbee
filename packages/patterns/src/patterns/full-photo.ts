// Full photo: the photo over the whole frame, and a shade of colour rising from the frame's foot (or reaching in from
// its start in a wide frame or banner) that the words sit on, so they read on any photo. The photo's subject is kept
// clear of the words; where it can't show whole so over the whole frame, the photo ends where the shade is opaque. The
// logo sits in the photo's top corner, or over the words across a wide frame. The style sets the shade and its finish:
// the deep colour with an accent bar by the words (bold), the background colour with an accent rule over the words
// (minimal), the primary with a group of dots on the photo (playful), or the deep colour inside a fine frame line
// (premium). A short frame, with no room for words over a photo, sets the photo at its end.
import type { Rect } from '@dazbee/schema'

import {
  type Build,
  ground,
  isShort,
  keepUnderLogo,
  logo,
  logoOnTop,
  logoRoom,
  photo,
  photoLogo,
  photoSurface,
  pinsButton,
  wordsOn,
} from '../build.ts'
import { coverCrop } from '../crop.ts'
import { dotGroup, insetFrame, ruleOver } from '../decorations.ts'
import { deepColour, type Swatch, withAlpha } from '../palette.ts'
import { linear, rect, solid, treeBuilder } from '../tree.ts'
import type { Pattern } from '../types.ts'
import { placeVisualAndWords } from '../visual-words.ts'
import { stackWords, type Words } from '../words.ts'

export const FULL_PHOTO: Pattern = {
  id: 'full-photo',
  name: 'Full photo',
  kinds: ['lifestyle photo', 'product launch', 'sale or offer'],
  description:
    'The photo over the whole frame, its subject kept clear of the words, with a shade of brand colour rising from its foot (or reaching in from its side in a wide frame) that the words and button sit on.',
  needs: ['headline', 'photo'],
  takes: ['kicker', 'subline', 'button', 'highlight', 'logo'],
}

/** The share of the safe room the words take: down a square or tall frame, and across a wide one or a banner. */
const WORDS = { down: 0.5, across: 0.5, banner: 0.6 }
/** How far the shade fades in over the words, as a share of the frame's shorter side, and how opaque it is under them. */
const FADE = 0.3
const UNDER = 0.92

/** Builds the full photo in the frame. */
export function fullPhoto(b: Build) {
  const { frame, content } = b
  const given = content.photo
  if (isShort(b) || !given) {
    const colour = ground(b)
    placeVisualAndWords(b, {
      ground: colour,
      words: wordsOn(b, colour),
      ...(given ? { visual: { ratio: 1.6, draw: (box: Rect) => photo(b, box) } } : {}),
      first: false,
    })
    return
  }
  const shade = shadeColour(b)
  const across = frame.shape === 'wide' || frame.shape === 'banner'
  const { safe, margin, width, height } = frame
  const short = Math.min(width, height)
  const fade = Math.round(short * FADE)
  if (across) {
    const wordsWidth = Math.round(safe.width * (frame.shape === 'banner' ? WORDS.banner : WORDS.across))
    const right = safe.x + wordsWidth
    const keep = { x: right + margin, y: 0, width: width - right - margin, height }
    // A photo whose subject can't show whole clear of the words over the whole frame starts under the shade's fade.
    const start = Math.max(0, right + margin - fade)
    photo(
      b,
      wholeClear(b, { x: 0, y: 0, width, height }, keep)
        ? { x: 0, y: 0, width, height }
        : { x: start, y: 0, width: width - start, height },
      0,
      keep,
    )
    const box = { x: 0, y: 0, width: Math.min(width, right + margin + fade), height }
    const stop = (right + margin * 0.5) / box.width
    if (b.styleName === 'premium') insetFrame(b, b.palette.accent, 0.7)
    shadeOver(
      b,
      box,
      linear(
        [0, 0.5],
        [1, 0.5],
        [withAlpha(shade.value, UNDER), withAlpha(shade.value, UNDER), withAlpha(shade.value, 0)],
      ),
      stop,
    )
    let room = { ...safe, width: wordsWidth }
    room = logoOnTop(b, room, shade)
    const set = stackWords(b.tree, b, { ...wordsOn(b, shade), room, surface: shade.value, justify: 'center' })
    finish(b, set.box)
    return
  }
  // The words at the foot of the safe room, their button with them; the shade rises from the frame's foot to over them.
  const roomHeight = Math.round(safe.height * WORDS.down)
  const room = { ...safe, y: safe.y + safe.height - roomHeight, height: roomHeight }
  const of = (at: Rect): Words => ({
    ...wordsOn(b, shade),
    room: at,
    surface: shade.value,
    justify: 'end',
    ...(pinsButton(b) ? { pin: true, together: true } : {}),
  })
  const tried = stackWords(treeBuilder(), b, of(room))
  const top = tried.box.y
  // The subject is kept above the words, and clear of a top corner for the logo.
  const clear = { x: 0, y: 0, width, height: Math.max(short * 0.3, top - margin) }
  const keep = keepUnderLogo(b, clear, Boolean(content.logo))
  // A photo whose subject can't show whole above the words over the whole frame ends where the shade is opaque.
  const whole = wholeClear(b, { x: 0, y: 0, width, height }, keep)
  const shot = photo(b, whole ? { x: 0, y: 0, width, height } : clear, 0, keep)
  const from = Math.max(0, top - margin - fade)
  const box = { x: 0, y: from, width, height: height - from }
  shadeOver(
    b,
    box,
    linear(
      [0.5, 0],
      [0.5, 1],
      [withAlpha(shade.value, 0), withAlpha(shade.value, UNDER), withAlpha(shade.value, UNDER)],
    ),
    fade / box.height,
  )
  if (b.styleName === 'premium') insetFrame(b, b.palette.accent, 0.7)
  // The logo in a corner of the photo clear of its subject, on a label where it doesn't read on the photo.
  if (content.logo && !photoLogo(b, shot)) {
    const surface = photoSurface(b)
    logo(b, logoRoom(b, { x: safe.x, y: safe.y }, safe.width, surface), 'start', surface)
  }
  const set = stackWords(b.tree, b, of(room))
  finish(b, set.box)
}

/** The shade's colour: the background in a minimal style, the primary in a playful one, else the deep colour. */
function shadeColour({ palette, styleName }: Build): Swatch {
  if (styleName === 'minimal') return palette.background
  if (styleName === 'playful') return palette.primary
  return deepColour(palette)
}

/** Whether the photo covering `box` shows its whole subject inside `keep`, or its subject isn't known. */
function wholeClear(b: Build, box: Rect, keep: Rect): boolean {
  const given = b.content.photo
  return !given?.look || coverCrop(given, box, keep).whole
}

/** The shade over `box`: its gradient, opaque past `stop` of the way. */
function shadeOver(b: Build, box: Rect, fill: ReturnType<typeof linear>, stop: number) {
  const [paint] = fill.fills
  if (paint?.type === 'linear') {
    const [first, , last] = paint.stops
    const at = Math.min(0.95, Math.max(0.05, stop))
    paint.stops = [
      { offset: 0, color: first?.color ?? '#00000000' },
      { offset: at, color: paint.stops[1]?.color ?? '#00000000' },
      { offset: 1, color: last?.color ?? '#00000000' },
    ]
  }
  b.tree.add('shade', { ...rect('Shade', box, fill), role: 'background' })
}

/** The style's finish round the words set in `words`; a premium frame line is drawn before the logo. */
function finish(b: Build, words: Rect) {
  const { styleName, palette, frame } = b
  const short = Math.min(frame.width, frame.height)
  if (styleName === 'bold') {
    const thick = Math.max(3, Math.round(short * 0.012))
    const x = Math.round(words.x - Math.max(thick * 2, frame.margin * 0.45))
    if (x >= 2)
      b.tree.add('bar', rect('Bar', { x, y: words.y, width: thick, height: words.height }, solid(palette.accent)))
  }
  if (styleName === 'minimal') {
    const thick = Math.max(2, Math.round(short * 0.006))
    ruleOver(b, 'rule', words, Math.round(frame.margin * 0.5), 0, palette.accent, {
      thick,
      length: Math.round(short * 0.08),
    })
  }
  if (styleName === 'playful') {
    const r = short * 0.03
    dotGroup(b, 'dot', { x: frame.width - frame.margin - r, y: frame.margin + r }, r, { x: -1, y: 0.4 }, [
      palette.accent,
      palette.background,
      palette.accent,
    ])
  }
}
