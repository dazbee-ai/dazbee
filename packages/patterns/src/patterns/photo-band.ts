// Photo with a band: the photo, cropped to its subject, and a band of colour holding the words, so they read on any
// photo. The band runs along the bottom of a square or tall frame, under the photo, and beside it in a wide frame, a
// banner or a strip. Its edge over the photo is the style's, and keeps off the photo's subject: slanted over an
// accent stripe (bold), straight with an accent rule over the words (minimal), waved with a group of dots beside it
// (playful), or fading into the photo's edge where the two are near in hue, else straight under a fine accent line
// (premium). The photo always shows its whole subject, kept off the frame's edges where it can be, or is left out.
// The logo sits in a corner of the photo clear of its subject, else over the words. A wide, low band sets its button
// beside its words.
import type { Rect } from '@dazbee/schema'

import {
  type Build,
  groundColour,
  inRow,
  isShort,
  keepUnderLogo,
  logoAtStart,
  logoOnPhoto,
  logoOnTop,
  logoRowHeight,
  offFrameEdges,
  photo,
  photoLogo,
  pinsButton,
  roles,
  rowed,
  stripHolds,
  tallChoice,
  tallSeams,
  usualWords,
} from '../build.ts'
import { ctaFill } from '../button.ts'
import { coverCrop, type Cropped, wholeSpan } from '../crop.ts'
import { dotGroup, ruleOver } from '../decorations.ts'
import { type Edge, panel, type Side, STYLE_EDGES } from '../edges.ts'
import { lchOf, ornamentColour, type Swatch } from '../palette.ts'
import { rect, solid } from '../tree.ts'
import type { Pattern } from '../types.ts'
import { keepsEvery, leadSizeIn, rowWords, type SetWords, stackWords, type Words } from '../words.ts'

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
  /** The photo's share of the frame (of a tall frame's safe room, down it). */
  share: number
}

/** Builds the photo with a band in the frame. */
export function photoBand(b: Build) {
  const { styleName, palette, frame } = b
  const at = arrange(b)
  const colour = groundColour(b)
  const onPhoto = at.logoOnPhoto
  const shot = at.photo.width > 0 ? photo(b, at.photo, 0, keepUnderLogo(b, at.keep, onPhoto)) : undefined
  if (styleName === 'bold' && shot) {
    const stripe = Math.max(3, Math.round(Math.min(frame.width, frame.height) * 0.02))
    const under =
      at.side === 'top'
        ? { ...at.band, y: at.band.y - stripe, height: at.band.height + stripe }
        : { ...at.band, width: at.band.width + stripe }
    panel(b, 'stripe', 'Stripe', under, at.side, 'slant', at.depth, palette.accent)
  }
  panel(b, 'band', 'Band', at.band, at.side, at.depth > 0 ? bandEdge(b) : 'straight', at.depth, colour)
  if (styleName === 'premium' && shot && bandEdge(b) === 'straight') seamLine(b, at, colour)
  let room = at.words
  if (isShort(b)) room = logoAtStart(b, room, colour)
  // The logo goes in a corner of the photo clear of its subject where logoOnPhoto says, else over the words (on a
  // label where it doesn't read on the band).
  else if (!onPhoto || !photoLogo(b, shot)) room = logoOnTop(b, room, colour)
  const words: Words = {
    ...wordsIn(b, at),
    room,
    // Under the photo, the words sit a little over the middle of their room: in a 9:16 frame over the button at the
    // safe room's foot.
    ...(at.side === 'top' ? { justify: 'optical' as const } : {}),
    ...(pinsButton(b) ? { pin: true, together: true } : {}),
  }
  const set = rowed(b, room) ? rowWords(b.tree, b, words) : stackWords(b.tree, b, words)
  decorate(b, at, set, [set.box, ...(shot ? [shot.subject] : [])])
}

/** The photo's shares of the frame tried, the least first: across a wide frame, and down a square, tall or tower one. */
const ACROSS_SHARES = [0.5, 0.56]
const DOWN_SHARES = {
  wide: [0.44, 0.5, 0.56, 0.62],
  square: [0.4, 0.44, 0.48, 0.52, 0.56],
  tall: [0.4, 0.45, 0.5, 0.55, 0.6, 0.65],
  tower: [0.38, 0.42],
}
/** The least its subject is shown at, its longer side as a share of the frame's shorter side. */
const SUBJECT_LEAST = 0.35
/** The share of the largest its subject is shown at, by area, that a photo's share may show it at, to set the words larger. */
const SUBJECT_FAIR = 0.6
/** The least room the words take in the band, as a multiple of the readable size: down, and across. */
const WORDS_LEAST = { height: 7, low: 4, width: 9 }

/**
 * The photo, band and words arranged for the frame's shape: of the photo's shares tried that show the photo's whole
 * subject, as large as a third of the frame's shorter side at least, clear of the logo where it goes on the photo,
 * and leave the words their room, of those that keep every part of the words where any does and show the subject a
 * fair share as large as the largest does, the one that sets the lead largest; in a tall
 * frame, as tallChoice picks. Where none shows the subject whole, the photo is left out.
 */
function arrange(b: Build): Arrangement {
  // The subject kept in from the frame's edges where some share shows it whole so, else up to them.
  const kept = arrangeKept(b, true)
  return kept.photo.width > 0 || !b.content.photo ? kept : arrangeKept(b, false)
}

/** The arrangement, its photo's subject kept in from the frame's edges where `edges`. */
function arrangeKept(b: Build, edges: boolean): Arrangement {
  const { frame } = b
  const tried = sharesOf(b).map(({ share, down }) => arrangedAt(b, share, down, edges))
  const fits = (least: number) =>
    tried.filter(
      ({ words }) => words.height >= frame.readable * least && words.width >= frame.readable * WORDS_LEAST.width,
    )
  const picture = b.content.photo
  // A photo whose pixels weren't read has no subject known to keep whole: its middle is shown as large as fits.
  const read = Boolean(picture?.look)
  const large = (shot: Cropped | undefined) =>
    !shot ||
    !read ||
    Math.max(shot.subject.width, shot.subject.height) >= Math.min(frame.width, frame.height) * SUBJECT_LEAST
  // Words with their room first; else words in fewer lines.
  for (const least of [WORDS_LEAST.height, WORDS_LEAST.low]) {
    // Where the logo goes on the photo, its subject must leave the logo a corner; else the logo goes over the words.
    const shots = fits(least).flatMap((at) =>
      (at.logoOnPhoto ? [true, false] : [false]).map((onPhoto) => {
        const keep = keepUnderLogo(b, at.keep, onPhoto)
        const shot = picture && at.photo.width > 0 ? coverCrop(picture, at.photo, keep) : undefined
        return { at: { ...at, logoOnPhoto: onPhoto }, shot, cornered: !onPhoto || keep !== at.keep }
      }),
    )
    const kept = shots.filter(
      ({ at, shot, cornered }) => (!shot || ((shot.whole || (!read && !at.logoOnPhoto)) && cornered)) && large(shot),
    )
    if (kept.length === 0) continue
    if ((frame.shape === 'tall' || frame.shape === 'tower') && kept[0]?.at.side === 'top')
      return tallChoice(b, kept, ({ at }) => ({ photo: at.photo.height, words: wordsIn(b, at) }))?.at ?? withoutPhoto(b)
    // Those that keep every part of the words where any does; of them, of those that show the subject a fair share as
    // large as the largest does, the one that sets the lead largest, the subject larger where two set it alike.
    const every = kept.filter(({ at }) => keepsEvery(b, wordsIn(b, at)))
    const pool = every.length > 0 ? every : kept
    const largest = Math.max(0, ...pool.map(({ shot }) => shot?.reads ?? 0))
    const fair = pool.filter(({ shot }) => (shot?.reads ?? 0) >= largest * SUBJECT_FAIR)
    const sized = fair.map((each) => ({ ...each, size: leadSizeIn(b, wordsIn(b, each.at)) }))
    const chosen = sized.reduce<(typeof sized)[number] | undefined>(
      (a, c) => (!a || c.size > a.size || (c.size === a.size && (c.shot?.reads ?? 0) > (a.shot?.reads ?? 0)) ? c : a),
      undefined,
    )
    if (chosen) return chosen.at
  }
  return withoutPhoto(b)
}

/** How far apart in hue a photo's edge and the band may be for one to fade into the other, and the chroma of a near grey. */
const FADE_HUE = 40
const NEAR_GREY = 10

/**
 * The band's edge over the photo: the style's, but a premium fade only where the photo's edge and the band are near
 * in hue or one of them is near grey, so the two never mix into a muddy band; else a straight seam.
 */
function bandEdge(b: Build): Edge {
  const edge = STYLE_EDGES[b.styleName]
  if (edge !== 'fade') return edge
  const photoEdge = b.content.photo?.look?.edge ?? b.content.photo?.look?.backdrop
  if (!photoEdge) return 'straight'
  const one = lchOf(photoEdge)
  const other = lchOf(groundColour(b).value)
  const apart = Math.abs(one.hue - other.hue)
  const hue = Math.min(apart, 360 - apart)
  return hue <= FADE_HUE || one.chroma < NEAR_GREY || other.chroma < NEAR_GREY ? 'fade' : 'straight'
}

/** A fine line of the accent along a straight premium seam, where it reads on the band, else of the band's ink, faint. */
function seamLine(b: Build, { band, side }: Arrangement, ground: Swatch) {
  const { frame, palette } = b
  const { colour, opacity } = ornamentColour(palette, ground.value)
  const thick = Math.max(1, Math.round(Math.min(frame.width, frame.height) * 0.004))
  const line =
    side === 'top'
      ? { x: 0, y: band.y, width: frame.width, height: thick }
      : { x: band.x + band.width - thick, y: 0, width: thick, height: frame.height }
  b.tree.add('seam', { ...rect('Seam', line, solid(colour, opacity === 1 ? undefined : opacity)), role: 'decoration' })
}

/** The words as they are set in an arrangement: in its words' room, under the logo where it goes over them. */
function wordsIn(b: Build, at: Arrangement): Words {
  const colour = groundColour(b)
  const room = at.logoOnPhoto
    ? at.words
    : { ...at.words, y: at.words.y + logoRowHeight(b, at.words), height: at.words.height - logoRowHeight(b, at.words) }
  return {
    parts: usualWords(b.content),
    ...(b.content.button ? { button: b.content.button, buttonFill: ctaFill(b.palette, colour, roles(b).cta) } : {}),
    room,
    surface: colour.value,
  }
}

/** The band over the whole frame and the words in its safe room, the photo left out. */
function withoutPhoto(b: Build): Arrangement {
  const { width, height, safe } = b.frame
  const none = { x: 0, y: 0, width: 0, height: 0 }
  const band = { x: 0, y: 0, width, height }
  return { photo: none, keep: none, band, side: 'top', depth: 0, words: safe, logoOnPhoto: false, share: 0 }
}

/**
 * The photo's shares tried for the frame's shape, and whether each runs down the frame: a wide frame tries the photo
 * beside the band, then on top of it, where beside can't show the subject whole; a square one on top, then beside. Down a frame, the shares at which
 * the photo is near as tall as it can be with its subject whole across it are tried too.
 */
function sharesOf(b: Build): { share: number; down: boolean }[] {
  const { frame, content } = b
  if (frame.shape === 'strip' || frame.shape === 'banner') return [{ share: 0, down: false }]
  const span = content.photo ? wholeSpan(content.photo, 'width', frame.width) : undefined
  const of = (height: number) =>
    frame.shape === 'tall' ? (height - frame.safe.y) / frame.safe.height : height / frame.height
  const wholeShares = span ? [of(span.most * 0.97), of(span.most * 0.85)].filter((share) => share > 0.15) : []
  const down = [...new Set([...DOWN_SHARES[frame.shape], ...wholeShares, ...tallSeams(b).map(of)])]
    .filter((share) => share < 0.8)
    .sort((x, y) => x - y)
    .map((share) => ({ share, down: true }))
  const across = ACROSS_SHARES.map((share) => ({ share, down: false }))
  // A square frame sets a photo beside the band only where its subject, such as a tall one, shows whole there and
  // not on top.
  if (frame.shape === 'square') return [...down, ...across]
  return frame.shape === 'wide' ? [...across, ...down] : down
}

/**
 * The photo, band and words with the photo taking `share` of the frame: across it, or `down` it (of a tall frame's
 * safe room), its subject kept in from the frame's edges where `edges`.
 */
function arrangedAt(b: Build, share: number, down: boolean, edges: boolean): Arrangement {
  const { frame } = b
  const { width, height, shape, margin, safe } = frame
  const short = Math.min(width, height)
  const edge = bandEdge(b)
  // A fade is a few hundredths of the frame wide, so it dims none of the subject.
  const depth = edge === 'straight' ? 0 : Math.round(short * (edge === 'fade' ? 0.06 : 0.07))
  const lead = Math.round(margin * (edge === 'straight' ? 0.9 : 0.5))
  const offEdges = (box: Rect) => (edges ? offFrameEdges(b, box) : box)
  if (!down) {
    // The band down the left, the photo on the right, at least 1.6 times as wide as the frame is tall; a strip too
    // narrow for the photo beside its logo, words and button leaves the photo out.
    let photoWidth = Math.round(
      shape === 'wide' || shape === 'square'
        ? width * share
        : shape === 'banner'
          ? Math.max(height * 1.6, width * 0.36)
          : height * 1.6,
    )
    // A banner's photo is as wide as its subject shows whole in, or left out; a short frame leaves it out where it
    // can't hold it beside its logo, words and button.
    if (shape !== 'wide' && shape !== 'square') photoWidth = wholeWidth(b, photoWidth)
    if (isShort(b) && !stripHolds(b, photoWidth)) photoWidth = 0
    const clear = width - photoWidth
    return {
      photo: { x: clear, y: 0, width: photoWidth, height },
      keep: offEdges({ x: clear + depth, y: 0, width: photoWidth - depth, height }),
      band: { x: 0, y: 0, width: clear + depth, height },
      side: 'right',
      depth,
      share,
      ...placesWords(b, { x: safe.x, y: safe.y, width: clear - safe.x - lead, height: safe.height }),
    }
  }
  // The photo on top, the band under it.
  const clear = Math.round(shape === 'tall' ? safe.y + safe.height * share : height * share)
  const bottom = safe.y + safe.height
  return {
    photo: { x: 0, y: 0, width, height: clear },
    keep: offEdges({ x: 0, y: 0, width, height: clear - depth }),
    band: { x: 0, y: clear - depth, width, height: height - clear + depth },
    side: 'top',
    depth,
    share,
    ...placesWords(b, { x: safe.x, y: clear + lead, width: safe.width, height: bottom - clear - lead }),
  }
}

/** The words' room, and whether the logo goes on the photo for it, as logoOnPhoto says. */
function placesWords(b: Build, words: Rect): { words: Rect; logoOnPhoto: boolean } {
  return { words, logoOnPhoto: logoOnPhoto(b, words) }
}

/**
 * A banner's photo width, nearest `width`, at which its subject shows whole down the frame's height; none where no
 * width does.
 */
function wholeWidth(b: Build, width: number): number {
  const picture = b.content.photo
  if (!picture) return width
  const span = wholeSpan(picture, 'height', b.frame.height)
  if (!span) return 0
  return Math.round(Math.min(Math.max(width, Math.ceil(span.least)), Math.floor(span.most)))
}

/**
 * The style's decoration: a group of dots over a wave at the frame's edge (playful), an accent rule over the words
 * under a straight edge (minimal).
 */
function decorate(b: Build, { band, side, depth, photo: box }: Arrangement, set: SetWords, clear: Rect[]) {
  const { frame, styleName, palette } = b
  const short = Math.min(frame.width, frame.height)
  if (inRow(b) || box.width === 0) return
  if (styleName === 'playful') {
    const r = short * 0.035
    const at =
      side === 'top'
        ? { x: frame.width - frame.margin - r, y: band.y - depth - r * 2 }
        : { x: band.x + band.width + r * 1.5, y: frame.height - frame.margin - r }
    const toward = side === 'top' ? { x: -1, y: -0.6 } : { x: 0.6, y: -1 }
    dotGroup(b, 'dot', at, r, toward, [palette.accent, palette.background, palette.accent], clear)
  }
  if (styleName === 'minimal' && side === 'top') {
    const thick = Math.max(2, Math.round(short * 0.008))
    const gap = Math.round(set.size * b.style.gap)
    ruleOver(b, 'edge-bar', set.box, gap, band.y, palette.accent, { thick, length: Math.round(short * 0.08) })
  }
}
