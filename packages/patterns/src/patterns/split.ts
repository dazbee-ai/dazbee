// Split: the photo on one side and a panel of colour holding the words on the other: side by side, or the photo on
// top where the frame's shape can't hold the photo's whole subject beside the words, and always in a tall frame. The
// split's share is the least that shows the whole subject. The style draws the seam and the photo: a slanted deep
// panel over an accent stripe (bold), the photo framed by the margin (minimal), the photo's inner corners rounded with
// dots on the seam (playful), or a deep panel with a fine rule over the words (premium).
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
import { coverCrop, type Cropped } from '../crop.ts'
import { bar, dots } from '../decorations.ts'
import { panel, type Side } from '../edges.ts'
import { inset } from '../frame-shape.ts'
import { ornamentColour } from '../palette.ts'
import type { Pattern } from '../types.ts'
import { rowWords, stackWords, type Words } from '../words.ts'

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
}

/** The photo's shares of the frame tried side by side, and on top, the least first. */
const BESIDE_SHARES = [0.5, 0.58]
const ON_TOP_SHARES = [0.46, 0.5, 0.56, 0.62]
/** The photo's shares of a tall frame's safe room tried on top, the least first. */
const ON_TOP_TALL_SHARES = [0.4, 0.45, 0.5, 0.55, 0.6, 0.65]
/** The least room the words take in the panel, as a multiple of the readable size: down (in a wide, low room), and across. */
const WORDS_LEAST = { height: 6, low: 4.5, width: 9 }

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
  if (row) room = logoAtStart(b, room, colour)
  else if (!halves.logoOnPhoto || !photoLogo(b, halves, shot)) room = logoOnTop(b, room, colour)
  const words: Words = {
    parts: usualWords(b.content),
    ...(b.content.button ? { button: b.content.button, buttonFill: ctaFill(palette, colour, roles(b).cta) } : {}),
    room,
    surface: colour.value,
    // Under a photo on top, the words start at the seam.
    justify: halves.side === 'top' ? 'start' : 'center',
    ...(isTall(b) ? { pin: true } : {}),
  }
  const set = row ? rowWords(b.tree, b, words) : stackWords(b.tree, b, words)
  if (row) return
  if (styleName === 'playful') {
    const r = short * 0.04
    const seam = seamPoint(halves)
    dots(
      b,
      'dot',
      [
        { x: seam.x, y: seam.y, r, colour: palette.accent },
        { x: seam.x + r * 1.6, y: seam.y + r * 1.8, r: r * 0.45, colour: palette.secondary },
      ],
      [set.box, ...(shot ? [shot.subject] : [])],
    )
  }
  if (styleName === 'premium') {
    const thick = Math.max(1, Math.round(short * 0.003))
    const length = Math.round(short * 0.08)
    const y = set.box.y - Math.round(set.size * 0.5)
    const { colour: ruleColour, opacity } = ornamentColour(palette, colour.value)
    if (y > room.y - frame.margin * 0.5) {
      const x = b.style.align === 'center' ? set.box.x + (set.box.width - length) / 2 : set.box.x
      bar(b, 'rule', 'Rule', { x: Math.round(x), y, width: length, height: thick }, ruleColour)
      const rule = b.tree.tree().nodes.rule
      if (rule?.type === 'graphic') rule.props.opacity = opacity
    }
  }
}

/**
 * The photo's and the panel's halves, and the words' room in the panel: the photo at the leading edge of a strip or
 * banner, on top in a tall frame, and else beside the words or on top, at the least share that shows its whole
 * subject, beside first.
 */
function arrange(b: Build): Halves {
  const { width, height, shape, safe } = b.frame
  if (shape === 'strip' || shape === 'banner') {
    // A strip too narrow for the photo beside its logo, words and button leaves the photo out.
    const photoWidth = Math.round(shape === 'strip' ? height * 1.6 : Math.max(height * 1.6, width * 0.38))
    return beside(b, inRow(b) && width - photoWidth < stripLeast(b) ? 0 : photoWidth)
  }
  const tops = (shape === 'tall' ? ON_TOP_TALL_SHARES : ON_TOP_SHARES).map((share) =>
    onTop(b, Math.round(shape === 'tall' ? safe.y + safe.height * share : height * share)),
  )
  const sides = isTall(b) ? [] : BESIDE_SHARES.map((share) => beside(b, Math.round(width * share)))
  // A wide, low room sets its words in fewer lines, so it needs less height.
  const roomy = ({ words }: Halves) =>
    words.height >= b.frame.readable * (words.width > words.height * 2.5 ? WORDS_LEAST.low : WORDS_LEAST.height) &&
    words.width >= b.frame.readable * WORDS_LEAST.width
  const all = [...sides, ...tops]
  const kept = all.some(roomy) ? all.filter(roomy) : all
  // The subject whole with a corner left for the logo, else whole with the logo over the words, else the largest.
  const cornered = kept
    .filter((halves) => halves.logoOnPhoto)
    .find((halves) => {
      const free = shotBox(b, halves)
      const keep = keepUnderLogo(b, free, true)
      const shot = b.content.photo ? coverCrop(b.content.photo, photoBoxOf(b, halves), keep) : undefined
      return !shot || (shot.whole && keep !== free)
    })
  if (cornered) return cornered
  const plain = kept.map((halves) => ({ ...halves, logoOnPhoto: false }))
  const whole = plain.find((halves) => shotOf(b, halves)?.whole ?? true)
  if (whole) return whole
  return plain.reduce((a, c) => ((shotOf(b, c)?.reads ?? 0) > (shotOf(b, a)?.reads ?? 0) ? c : a))
}

/** The photo at the left, `photoWidth` wide, and the panel beside it. */
function beside(b: Build, photoWidth: number): Halves {
  const { width, height, margin, safe } = b.frame
  return {
    photo: { x: 0, y: 0, width: photoWidth, height },
    panel: { x: photoWidth, y: 0, width: width - photoWidth, height },
    side: 'left',
    ...placesWords(b, {
      x: photoWidth + margin,
      y: safe.y,
      width: width - photoWidth - 2 * margin,
      height: safe.height,
    }),
  }
}

/** The photo on top down to `seam`, and the panel under it. */
function onTop(b: Build, seam: number): Halves {
  const { width, height, margin, safe } = b.frame
  return {
    photo: { x: 0, y: 0, width, height: seam },
    panel: { x: 0, y: seam, width, height: height - seam },
    side: 'top',
    ...placesWords(b, { x: safe.x, y: seam + margin, width: safe.width, height: safe.y + safe.height - seam - margin }),
  }
}

/** How the photo would be cropped in `halves`; none without a photo. */
function shotOf(b: Build, halves: Halves): Cropped | undefined {
  return b.content.photo ? coverCrop(b.content.photo, photoBoxOf(b, halves), keepOf(b, halves)) : undefined
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
