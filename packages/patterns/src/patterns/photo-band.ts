// Photo with a band: the photo, cropped to its subject, and a band of colour holding the words, so they read on any
// photo. The band runs along the bottom of a square or tall frame, under the photo, and beside it in a wide frame, a
// banner or a strip. Its edge over the photo is the style's, and keeps off the photo's subject: slanted over an
// accent stripe (bold), straight with an accent bar (minimal), waved with dots beside it (playful), or fading into
// the photo's backdrop (premium). The logo sits in a corner of the photo clear of its subject, else over the words.
import type { Rect } from '@dazbee/schema'

import {
  type Build,
  groundColour,
  inRow,
  isTall,
  keepUnderLogo,
  logoAtStart,
  logoOnPhoto,
  logoOnTop,
  photo,
  photoLogo,
  roles,
  stripLeast,
  usualWords,
} from '../build.ts'
import { ctaFill } from '../button.ts'
import { coverCrop } from '../crop.ts'
import { bar, dots } from '../decorations.ts'
import { panel, type Side, STYLE_EDGES } from '../edges.ts'
import type { Pattern } from '../types.ts'
import { rowWords, stackWords, type Words } from '../words.ts'

export const PHOTO_BAND: Pattern = {
  id: 'photo-band',
  name: 'Photo with a band',
  kinds: ['lifestyle photo', 'sale or offer', 'product launch', 'single product'],
  description:
    'The photo, cropped to its subject, and a band of brand colour holding the words, so they read on any photo: the band runs under the photo, or beside it in a wide frame or a banner.',
  needs: ['headline', 'photo'],
  takes: ['kicker', 'subline', 'button', 'highlight', 'logo'],
}

/** Where the photo, the band and the words go in a frame. */
interface Arrangement {
  photo: Rect
  /** The part of the photo the band's edge doesn't cover, where its subject is kept. */
  keep: Rect
  band: Rect
  /** The band's side over the photo, drawn in the style's edge. */
  side: Side
  /** How deep the band's drawn edge is. */
  depth: number
  words: Rect
  /** Whether the logo goes on the photo, in a corner its subject leaves clear. */
  logoOnPhoto: boolean
}

/** Builds the photo with a band in the frame. */
export function photoBand(b: Build) {
  const { styleName, palette, frame } = b
  const at = arrange(b)
  const colour = groundColour(b)
  const onPhoto = at.logoOnPhoto
  const shot = at.photo.width > 0 ? photo(b, at.photo, 0, keepUnderLogo(b, at.keep, onPhoto)) : undefined
  if (styleName === 'bold') {
    const stripe = Math.max(3, Math.round(Math.min(frame.width, frame.height) * 0.02))
    const under =
      at.side === 'top'
        ? { ...at.band, y: at.band.y - stripe, height: at.band.height + stripe }
        : { ...at.band, width: at.band.width + stripe }
    panel(b, 'stripe', 'Stripe', under, at.side, 'slant', at.depth, palette.accent)
  }
  panel(b, 'band', 'Band', at.band, at.side, STYLE_EDGES[styleName], at.depth, colour)
  let room = at.words
  if (inRow(b)) room = logoAtStart(b, room, colour)
  // The logo goes in a corner of the photo clear of its subject where logoOnPhoto says, else over the words (on a
  // label where it doesn't read on the band).
  else if (!onPhoto || !photoLogo(b, at, shot)) room = logoOnTop(b, room, colour)
  const words: Words = {
    parts: usualWords(b.content),
    ...(b.content.button ? { button: b.content.button, buttonFill: ctaFill(palette, colour, roles(b).cta) } : {}),
    room,
    surface: colour.value,
    ...(isTall(b) ? { pin: true, justify: 'start' as const } : {}),
  }
  const set = inRow(b) ? rowWords(b.tree, b, words) : stackWords(b.tree, b, words)
  decorate(b, at, [set.box, ...(shot ? [shot.subject] : [])])
}

/** The photo's shares of the frame tried, the least first: across a wide frame, and down a square, tall or tower one. */
const ACROSS_SHARES = [0.5, 0.56]
const DOWN_SHARES = {
  wide: [0.5, 0.56, 0.62],
  square: [0.48, 0.52, 0.56],
  tall: [0.4, 0.45, 0.5, 0.55, 0.6, 0.65],
  tower: [0.38, 0.42],
}
/** The share of the largest its subject is shown at that a photo's share may show it at, to leave the words more room. */
const NEAR_LARGEST = 0.92
/** The least room the words take in the band, as a multiple of the readable size: down, and across. */
const WORDS_LEAST = { height: 7, low: 4, width: 9 }

/**
 * The photo, band and words arranged for the frame's shape: of the photo's shares tried that show the photo's whole
 * subject, clear of the logo where it goes on the photo, and leave the words their room, the least that shows the
 * subject near as large as the largest does.
 */
function arrange(b: Build): Arrangement {
  const { frame } = b
  const tried = sharesOf(b).map(({ share, down }) => arrangedAt(b, share, down))
  const fits = (least: number) =>
    tried.filter(
      ({ words }) => words.height >= frame.readable * least && words.width >= frame.readable * WORDS_LEAST.width,
    )
  // Words with their room first; else words in fewer lines, before a photo that cuts its subject.
  const roomy = fits(WORDS_LEAST.height)
  const picture = b.content.photo
  // Where the logo goes on the photo, its subject must leave the logo a corner.
  const shots = roomy.map((at) => {
    const onPhoto = at.logoOnPhoto
    const keep = keepUnderLogo(b, at.keep, onPhoto)
    const shot = picture && at.photo.width > 0 ? coverCrop(picture, at.photo, keep) : undefined
    return { at, shot, cornered: !onPhoto || keep !== at.keep }
  })
  const whole = shots.filter(({ shot, cornered }) => !shot || (shot.whole && cornered))
  const largest = Math.max(0, ...whole.map(({ shot }) => shot?.reads ?? 0))
  const chosen = whole.find(({ shot }) => (shot?.reads ?? 0) >= largest * NEAR_LARGEST)
  if (chosen) return chosen.at
  const tight = fits(WORDS_LEAST.low).find(
    (at) => !picture || at.photo.width === 0 || coverCrop(picture, at.photo, at.keep).whole,
  )
  if (tight) return { ...tight, logoOnPhoto: false }
  return roomy[0] ?? tried.at(-1) ?? arrangedAt(b, 0.5, true)
}

/**
 * The photo's shares tried for the frame's shape, and whether each runs down the frame: a wide frame tries the photo
 * beside the band, then on top of it, where beside can't show the subject whole.
 */
function sharesOf({ frame }: Build): { share: number; down: boolean }[] {
  if (frame.shape === 'strip' || frame.shape === 'banner') return [{ share: 0, down: false }]
  const down = DOWN_SHARES[frame.shape].map((share) => ({ share, down: true }))
  return frame.shape === 'wide' ? [...ACROSS_SHARES.map((share) => ({ share, down: false })), ...down] : down
}

/**
 * The photo, band and words with the photo taking `share` of the frame: across it, or `down` it (of a tall frame's
 * safe room).
 */
function arrangedAt(b: Build, share: number, down: boolean): Arrangement {
  const { frame, styleName } = b
  const { width, height, shape, margin, safe } = frame
  const short = Math.min(width, height)
  const edge = STYLE_EDGES[styleName]
  // A fade is a few hundredths of the frame wide, so it dims none of the subject.
  const depth = edge === 'straight' ? 0 : Math.round(short * (edge === 'fade' ? 0.06 : 0.07))
  const lead = Math.round(margin * (edge === 'straight' ? 0.9 : 0.5))
  if (!down) {
    // The band down the left, the photo on the right, at least 1.6 times as wide as the frame is tall; a strip too
    // narrow for the photo beside its logo, words and button leaves the photo out.
    let photoWidth = Math.round(
      shape === 'wide' ? width * share : shape === 'banner' ? Math.max(height * 1.6, width * 0.36) : height * 1.6,
    )
    if (inRow(b) && width - photoWidth < stripLeast(b)) photoWidth = 0
    const clear = width - photoWidth
    return {
      photo: { x: clear, y: 0, width: photoWidth, height },
      keep: { x: clear + depth, y: 0, width: photoWidth - depth, height },
      band: { x: 0, y: 0, width: clear + depth, height },
      side: 'right',
      depth,
      ...placesWords(b, { x: safe.x, y: safe.y, width: clear - safe.x - lead, height: safe.height }),
    }
  }
  // The photo on top, the band under it.
  const clear = Math.round(shape === 'tall' ? safe.y + safe.height * share : height * share)
  const bottom = safe.y + safe.height
  return {
    photo: { x: 0, y: 0, width, height: clear },
    keep: { x: 0, y: 0, width, height: clear - depth },
    band: { x: 0, y: clear - depth, width, height: height - clear + depth },
    side: 'top',
    depth,
    ...placesWords(b, { x: safe.x, y: clear + lead, width: safe.width, height: bottom - clear - lead }),
  }
}

/** The words' room, and whether the logo goes on the photo for it, as logoOnPhoto says. */
function placesWords(b: Build, words: Rect): { words: Rect; logoOnPhoto: boolean } {
  return { words, logoOnPhoto: logoOnPhoto(b, words) }
}

/** The style's decoration beside the band: dots on a wave, a bar on a straight edge under the photo. */
function decorate(b: Build, { band, side, depth }: Arrangement, clear: Rect[]) {
  const { frame, styleName, palette } = b
  const short = Math.min(frame.width, frame.height)
  if (inRow(b)) return
  if (styleName === 'playful') {
    const r = short * 0.05
    const [x, y] =
      side === 'top'
        ? [frame.width - short * 0.12, band.y + depth * 0.5]
        : [band.x + band.width - depth * 0.5, frame.height - Math.max(r * 2, short * 0.16)]
    dots(
      b,
      'dot',
      [
        { x, y, r, colour: palette.accent },
        { x: x - r * 1.9, y: y + r * 1.5, r: r * 0.42, colour: palette.secondary },
      ],
      clear,
    )
  }
  if (styleName === 'minimal' && side === 'top') {
    const thick = Math.max(2, Math.round(short * 0.01))
    const length = Math.round(short * 0.16)
    bar(b, 'edge-bar', 'Bar', { x: frame.safe.x, y: band.y - thick / 2, width: length, height: thick }, palette.accent)
  }
}
