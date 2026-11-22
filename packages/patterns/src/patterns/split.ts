// Split: the photo on one side and a panel of colour holding the words on the other: side by side in a wide frame,
// where the photo's whole subject shows there, else the photo on top, as in a square or tall frame. The photo always
// shows its whole subject, or is left out. The style draws the seam and the photo: a slanted deep
// panel over an accent stripe (bold), the photo framed by the margin (minimal), the photo's inner corners rounded with
// dots on the seam (playful), or a deep panel with a fine rule over the words (premium).
import type { Rect } from '@dazbee/schema'

import {
  type Build,
  buttonLeastWidth,
  groundColour,
  inRow,
  isShort,
  keepUnderLogo,
  logoAtStart,
  logoOnPhoto,
  logoOnTop,
  logoRowHeight,
  photo,
  photoLogo,
  pinsButton,
  roles,
  stripHolds,
  tallChoice,
  usualWords,
} from '../build.ts'
import { ctaFill } from '../button.ts'
import { coverCrop, wholeSpan } from '../crop.ts'
import { dotGroup, ruleOver } from '../decorations.ts'
import { panel, type Side } from '../edges.ts'
import { inset } from '../frame-shape.ts'
import { ornamentColour } from '../palette.ts'
import type { Pattern } from '../types.ts'
import { keepsEvery, rowWords, stackWords, type Words } from '../words.ts'

export const SPLIT: Pattern = {
  id: 'split',
  name: 'Split',
  kinds: ['product launch', 'single product', 'lifestyle photo', 'event'],
  description:
    'The photo, cropped to its subject, on one side and a panel of brand colour with the words on the other: side by side, or the photo on top where that shows its subject whole.',
  needs: ['headline', 'photo'],
  takes: ['kicker', 'subline', 'button', 'highlight', 'logo'],
}

/** Where the photo, the panel and the words go. */
interface Halves {
  photo: Rect
  panel: Rect
  /** The panel's side facing the photo. */
  side: Side
  words: Rect
  /** Whether the logo goes on the photo, in a corner its subject leaves clear. */
  logoOnPhoto: boolean
  /** The photo's share of the frame (of a tall frame's safe room, on top). */
  share: number
}

/** The photo's shares of the frame tried side by side, and on top, the least first. */
const BESIDE_SHARES = [0.5, 0.56, 0.62, 0.66, 0.7]
const ON_TOP_SHARES = [0.4, 0.46, 0.5, 0.56, 0.62]
/** The photo's shares of a tall frame's safe room tried on top, the least first. */
const ON_TOP_TALL_SHARES = [0.4, 0.45, 0.5, 0.55, 0.6, 0.65]
/** The least room the words take in the panel, as a multiple of the readable size: down (in a wide, low room), and across. */
const WORDS_LEAST = { height: 6, low: 4.5, width: 7 }
/** How large a subject beside the words shows at least, by area, as a share of the largest it shows on top. */
const BESIDE_LEAST = 0.36
/** The least its subject is shown at, its longer side as a share of the frame's shorter side. */
const SUBJECT_LEAST = 0.35

/** Builds the split in the frame. */
export function split(b: Build) {
  const { styleName, palette, frame } = b
  const short = Math.min(frame.width, frame.height)
  const colour = groundColour(b)
  const halves = arrange(b)
  const row = inRow(b)
  const slant = slantOf(b)
  const round = styleName === 'playful' ? Math.round(short * 0.12) : 0
  // A rounded photo sits on the panel, which reaches under its corners; any other seam is the panel's own edge.
  const under = round > 0
  const panelBox = grow(halves.panel, halves.side, under ? round : slant)
  const addPanel = () =>
    panel(b, 'panel', 'Panel', panelBox, halves.side, slant > 0 ? 'slant' : 'straight', slant, colour)
  if (under) addPanel()
  const photoBox = photoBoxOf(b, halves)
  const shot = photoBox.width > 0 ? photo(b, photoBox, 0, keepOf(b, halves)) : undefined
  if (under) roundInnerCorners(b, halves.side, round)
  else {
    // A bold seam is slanted over a stripe of the accent.
    if (slant > 0) {
      const stripe = Math.max(3, Math.round(short * 0.02))
      panel(b, 'stripe', 'Stripe', grow(panelBox, halves.side, stripe), halves.side, 'slant', slant, palette.accent)
    }
    addPanel()
  }
  let room = halves.words
  if (isShort(b)) room = logoAtStart(b, room, colour)
  else if (!halves.logoOnPhoto || !photoLogo(b, shot)) room = logoOnTop(b, room, colour)
  const words: Words = {
    parts: usualWords(b.content),
    ...(b.content.button ? { button: b.content.button, buttonFill: ctaFill(palette, colour, roles(b).cta) } : {}),
    room,
    surface: colour.value,
    // Under a photo on top, the words sit a little over the middle of the panel.
    justify: halves.side === 'top' ? 'optical' : 'center',
    ...(pinsButton(b) ? { pin: true } : {}),
  }
  const set = row ? rowWords(b.tree, b, words) : stackWords(b.tree, b, words)
  if (row) return
  if (styleName === 'playful' && shot) {
    const r = short * 0.035
    const seam = seamPoint(halves)
    const toward = halves.side === 'top' ? { x: -1, y: 0.5 } : { x: 0.5, y: -1 }
    dotGroup(b, 'dot', seam, r, toward, [palette.accent, palette.background, palette.accent], [set.box, shot.subject])
  }
  if (styleName === 'premium') {
    const { colour: ruleColour, opacity } = ornamentColour(palette, colour.value)
    const gap = Math.round(set.size * b.style.gap)
    const above = halves.side === 'top' && room.y === halves.words.y ? halves.panel.y : room.y - frame.margin * 0.5
    const thick = Math.max(1, Math.round(short * 0.003))
    ruleOver(b, 'rule', set.box, gap, above, ruleColour, { thick, length: Math.round(short * 0.08), opacity })
  }
}

/**
 * The photo's and the panel's halves, and the words' room in the panel: the photo at the leading edge of a strip or
 * banner, as wide as shows its subject whole, or left out of a short frame that can't hold it. A wide frame sets the
 * photo beside the words where its subject shows whole there and near as large as on top; else, and in a square or
 * tall frame, the photo is on top: at the least share that shows its subject whole and keeps every part of the words,
 * in a tall frame as tallChoice picks. A corner is left on the photo for the logo where that keeps it whole. Where no
 * share shows the subject whole, the photo is left out.
 */
function arrange(b: Build): Halves {
  const { width, height, shape, safe } = b.frame
  const picture = b.content.photo
  if (shape === 'strip' || shape === 'banner') {
    let photoWidth = Math.round(shape === 'strip' ? height * 1.6 : Math.max(height * 1.6, width * 0.38))
    // A minimal photo is framed by the margin but at its seam, so its subject shows whole in the framed box.
    const framed = b.styleName === 'minimal' && !inRow(b) ? b.frame.margin : 0
    const span = picture ? wholeSpan(picture, 'height', height - 2 * framed) : undefined
    if (picture)
      photoWidth = span ? Math.round(Math.min(Math.max(photoWidth, span.least + framed), span.most + framed)) : 0
    // A banner's logo goes with its words, at their start.
    return { ...beside(b, isShort(b) && !stripHolds(b, photoWidth) ? 0 : photoWidth), logoOnPhoto: false }
  }
  const span = picture ? wholeSpan(picture, 'width', width) : undefined
  const of = (seam: number) => (shape === 'tall' ? (seam - safe.y) / safe.height : seam / height)
  const wholeShares = span ? [of(span.most * 0.97), of(span.most * 0.85)].filter((share) => share > 0.15) : []
  const topShares = [...new Set([...(shape === 'tall' ? ON_TOP_TALL_SHARES : ON_TOP_SHARES), ...wholeShares])]
    .filter((share) => share < 0.8)
    .sort((x, y) => x - y)
  const tops = topShares.map((share) =>
    onTop(b, Math.round(shape === 'tall' ? safe.y + safe.height * share : height * share), share),
  )
  const sides = shape === 'wide' ? BESIDE_SHARES.map((share) => beside(b, Math.round(width * share), share)) : []
  // A wide, low room sets its words in fewer lines, so it needs less height.
  const roomy = ({ words }: Halves) =>
    words.height >= b.frame.readable * (words.width > words.height * 2.5 ? WORDS_LEAST.low : WORDS_LEAST.height) &&
    words.width >= Math.max(b.frame.readable * WORDS_LEAST.width, buttonLeastWidth(b))
  const short = Math.min(width, height)
  // Each arrangement with the logo on the photo where it goes there, then over the words, as its photo shows.
  const ways = (list: Halves[]) =>
    (list.some(roomy) ? list.filter(roomy) : list).flatMap((halves) =>
      (halves.logoOnPhoto ? [true, false] : [false]).map((onPhoto) => {
        const at = { ...halves, logoOnPhoto: onPhoto }
        const free = shotBox(b, at)
        const keep = keepUnderLogo(b, free, onPhoto)
        const shot = picture ? coverCrop(picture, photoBoxOf(b, at), keep) : undefined
        // A photo whose pixels weren't read has no subject known to keep whole: its middle is shown as large as fits.
        const read = Boolean(picture?.look)
        const whole =
          !shot ||
          ((shot.whole || (!read && !onPhoto)) &&
            (!onPhoto || keep !== free) &&
            (!read || Math.max(shot.subject.width, shot.subject.height) >= short * SUBJECT_LEAST))
        return { at, shot, whole }
      }),
    )
  const onTops = ways(tops).filter(({ whole }) => whole)
  const largest = Math.max(0, ...onTops.map(({ shot }) => shot?.reads ?? 0))
  const besides = ways(sides).filter(({ whole, shot }) => whole && (shot?.reads ?? 0) >= largest * BESIDE_LEAST)
  // Of each, the least share that keeps every part of the words with the logo on the photo, then with it over the
  // words, then the least with the logo on the photo, then the least.
  const pick = <T extends { at: Halves }>(list: T[]): T | undefined => {
    const every = list.filter(({ at }) => keepsEvery(b, wordsIn(b, at)))
    const onPhoto = (each: T) => each.at.logoOnPhoto
    return every.find(onPhoto) ?? every[0] ?? list.find(onPhoto) ?? list[0]
  }
  const first = pick(besides) ?? pick(onTops)
  if (!first) return beside(b, 0)
  if (first.at.side === 'top' && (shape === 'tall' || shape === 'tower')) {
    const all = ways(tops).filter(({ whole }) => whole)
    return (
      tallChoice(b, all, ({ at }) => ({ photo: at.photo.height, words: at.words, logoOnPhoto: at.logoOnPhoto }))?.at ??
      first.at
    )
  }
  return first.at
}

/** The photo at the left, `photoWidth` wide, and the panel beside it. */
function beside(b: Build, photoWidth: number, share = 0): Halves {
  const { width, height, margin, safe } = b.frame
  return {
    photo: { x: 0, y: 0, width: photoWidth, height },
    panel: { x: photoWidth, y: 0, width: width - photoWidth, height },
    side: 'left',
    share,
    ...placesWords(b, {
      x: photoWidth + margin,
      y: safe.y,
      width: width - photoWidth - 2 * margin,
      height: safe.height,
    }),
  }
}

/** The photo on top down to `seam`, its `share` of the frame, and the panel under it. */
function onTop(b: Build, seam: number, share: number): Halves {
  const { width, height, margin, safe } = b.frame
  return {
    photo: { x: 0, y: 0, width, height: seam },
    panel: { x: 0, y: seam, width, height: height - seam },
    side: 'top',
    share,
    ...placesWords(b, { x: safe.x, y: seam + margin, width: safe.width, height: safe.y + safe.height - seam - margin }),
  }
}

/** The photo's box: its half, framed by the margin in a minimal style, but at its seam. */
function photoBoxOf(b: Build, { photo: box, side }: Halves): Rect {
  if (b.styleName !== 'minimal' || inRow(b) || box.width === 0) return box
  const framed = inset(box, b.frame.margin)
  return side === 'top'
    ? { ...framed, height: box.height - b.frame.margin }
    : { ...framed, width: box.width - b.frame.margin }
}

/** The part of the photo its subject is kept in: off a slanted seam, and clear of the logo where it goes on the photo. */
function keepOf(b: Build, halves: Halves): Rect {
  return keepUnderLogo(b, shotBox(b, halves), halves.logoOnPhoto)
}

/** The part of the photo nothing is drawn over: its box, off a slanted seam. */
function shotBox(b: Build, halves: Halves): Rect {
  const box = photoBoxOf(b, halves)
  const slant = slantOf(b)
  return slant > 0 ? shrink(box, halves.side, slant) : box
}

/** The words as they are set in `halves`: in its words' room, under the logo where it goes over them. */
function wordsIn(b: Build, halves: Halves): Words {
  const colour = groundColour(b)
  const row = halves.logoOnPhoto ? 0 : logoRowHeight(b, halves.words)
  return {
    parts: usualWords(b.content),
    ...(b.content.button ? { button: b.content.button, buttonFill: ctaFill(b.palette, colour, roles(b).cta) } : {}),
    room: { ...halves.words, y: halves.words.y + row, height: halves.words.height - row },
    surface: colour.value,
  }
}

/** The words' room, and whether the logo goes on the photo for it, as logoOnPhoto says. */
function placesWords(b: Build, words: Rect): { words: Rect; logoOnPhoto: boolean } {
  return { words, logoOnPhoto: logoOnPhoto(b, words) }
}

/** How deep a bold seam's slant is; none in another style or a strip. */
function slantOf(b: Build): number {
  return b.styleName === 'bold' && !inRow(b) ? Math.round(Math.min(b.frame.width, b.frame.height) * 0.08) : 0
}

/** The panel's box grown over the photo by `by` on its side facing it, for a slanted seam. */
function grow(box: Rect, side: Side, by: number): Rect {
  return side === 'top'
    ? { ...box, y: box.y - by, height: box.height + by }
    : { ...box, x: box.x - by, width: box.width + by }
}

/** The photo's box less `by` on the side a panel's slanted edge covers. */
function shrink(box: Rect, side: Side, by: number): Rect {
  return side === 'top' ? { ...box, height: box.height - by } : { ...box, width: box.width - by }
}

/** Rounds the photo's corners on the panel's side, as a playful seam does. */
function roundInnerCorners(b: Build, side: Side, radius: number) {
  const layer = b.tree.tree().nodes.photo
  if (layer?.type !== 'graphic') return
  const corners: [number, number, number, number] = side === 'top' ? [0, 0, radius, radius] : [0, radius, radius, 0]
  layer.props.shape = { kind: 'rect', cornerRadius: 0, corners }
}

/** A point on the seam between the photo and the panel, near the frame's lower edge or right side. */
function seamPoint({ photo: box, side }: Halves) {
  return side === 'top'
    ? { x: box.x + box.width * 0.84, y: box.y + box.height }
    : { x: box.x + box.width, y: box.y + box.height * 0.82 }
}
