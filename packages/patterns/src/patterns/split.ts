// Split: the photo on one side and a panel of colour holding the words on the other, side by side in a square,
// wide frame, banner or strip, the photo on top in a tall frame. The style draws the seam and the photo: a slanted
// panel over an accent stripe (bold), the photo framed by the margin (minimal), the photo's inner corner rounded with
// dots on the seam (playful), or a fine line inside the photo and a rule over the words (premium).
import type { Rect } from '@dazbee/schema'

import { type Build, logo, logoRoom, photo, usualWords } from '../build.ts'
import { bar, dots } from '../decorations.ts'
import { panel, type Side } from '../edges.ts'
import { inset } from '../frame-shape.ts'
import { contrast, type Swatch } from '../palette.ts'
import { rect, stroke } from '../tree.ts'
import type { Pattern } from '../types.ts'
import { rowWords, stackWords, type Words } from '../words.ts'

export const SPLIT: Pattern = {
  id: 'split',
  name: 'Split',
  kinds: ['product launch', 'single product', 'lifestyle photo', 'event'],
  description:
    'The photo on one side and a panel of brand colour with the words on the other, side by side, or the photo on top in a tall frame.',
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
}

/** Builds the split in the frame. */
export function split(b: Build) {
  const { styleName, palette, frame } = b
  const short = Math.min(frame.width, frame.height)
  const colour = panelColour(b)
  const halves = arrange(b)
  const slant = styleName === 'bold' && frame.shape !== 'strip' ? Math.round(short * 0.08) : 0
  const round = styleName === 'playful' ? Math.round(short * 0.12) : 0
  // A rounded photo sits on the panel, which reaches under its corners; any other seam is the panel's own edge.
  const under = round > 0
  const panelBox = grow(halves.panel, halves.side, under ? round : slant)
  const addPanel = () =>
    panel(b, 'panel', 'Panel', panelBox, halves.side, slant > 0 ? 'slant' : 'straight', slant, colour)
  if (under) addPanel()
  photo(b, styleName === 'minimal' && frame.shape !== 'strip' ? inset(halves.photo, frame.margin) : halves.photo, 0)
  if (under) roundInnerCorners(b, halves.side, round)
  else {
    // A bold seam is slanted over a stripe of the accent.
    if (slant > 0) {
      const stripe = Math.max(3, Math.round(short * 0.02))
      panel(b, 'stripe', 'Stripe', grow(panelBox, halves.side, stripe), halves.side, 'slant', slant, palette.accent)
    }
    addPanel()
  }
  if (styleName === 'premium' && frame.shape !== 'strip') {
    const line = Math.max(1, Math.round(short * 0.003))
    const box = inset(halves.photo, Math.round(frame.margin * 0.5))
    b.tree.add('photo-line', rect('Photo line', box, { fills: [] }, { strokes: [stroke('#FFFFFFCC', line)] }))
  }
  const room = halves.words
  if (frame.shape !== 'strip') {
    // The logo sits in the photo's top corner, clear of the seam.
    const inner = styleName === 'minimal' ? frame.margin * 2 : frame.margin
    const at = { x: halves.photo.x + inner, y: Math.max(frame.safe.y, halves.photo.y + inner) }
    logo(b, logoRoom(b, at, halves.photo.width - 2 * inner), 'start')
  }
  const words: Words = {
    parts: usualWords(b.content),
    ...(b.content.button ? { button: b.content.button, buttonFill: buttonColour(b, colour) } : {}),
    room,
    surface: colour.value,
    // Under a photo on top, the words start at the seam.
    justify: halves.side === 'top' ? 'start' : 'center',
  }
  const set = frame.shape === 'strip' ? rowWords(b.tree, b, words) : stackWords(b.tree, b, words)
  if (frame.shape === 'strip') return
  if (styleName === 'playful') {
    const r = short * 0.04
    const seam = seamPoint(halves)
    dots(b, 'dot', [
      { x: seam.x, y: seam.y, r, colour: palette.accent },
      { x: seam.x + r * 1.6, y: seam.y + r * 1.8, r: r * 0.45, colour: palette.secondary },
    ])
  }
  if (styleName === 'premium') {
    const thick = Math.max(1, Math.round(short * 0.003))
    const length = Math.round(short * 0.08)
    const y = set.box.y - Math.round(set.size * 0.5)
    if (y > room.y - frame.margin * 0.5)
      bar(
        b,
        'rule',
        'Rule',
        { x: Math.round(set.box.x + (set.box.width - length) / 2), y, width: length, height: thick },
        palette.accent,
      )
  }
}

/** The photo's and the panel's halves, and the words' room in the panel, for the frame's shape. */
function arrange(b: Build): Halves {
  const { width, height, shape, margin, safe } = b.frame
  if (shape === 'tall' || shape === 'tower') {
    const seam = Math.round(shape === 'tower' ? height * 0.42 : safe.y + safe.height * 0.42)
    return {
      photo: { x: 0, y: 0, width, height: seam },
      panel: { x: 0, y: seam, width, height: height - seam },
      side: 'top',
      words: { x: safe.x, y: seam + margin, width: safe.width, height: safe.y + safe.height - seam - margin },
    }
  }
  const photoWidth = Math.round(
    shape === 'strip' ? height * 1.5 : shape === 'banner' ? Math.min(height * 1.6, width * 0.38) : width * 0.5,
  )
  return {
    photo: { x: 0, y: 0, width: photoWidth, height },
    panel: { x: photoWidth, y: 0, width: width - photoWidth, height },
    side: 'left',
    words: { x: photoWidth + margin, y: safe.y, width: width - photoWidth - 2 * margin, height: safe.height },
  }
}

/** The panel's colour: the kit's secondary (bold), primary (playful) or background (minimal, premium). */
function panelColour({ styleName, palette }: Build): Swatch {
  return {
    bold: palette.secondary,
    minimal: palette.background,
    playful: palette.primary,
    premium: palette.background,
  }[styleName]
}

/** The button's colour on the panel: the accent where it stands out from it, else the primary. */
function buttonColour({ styleName, palette }: Build, panelSwatch: Swatch): Swatch {
  if (styleName === 'minimal' || styleName === 'premium') return palette.primary
  return contrast(palette.accent.value, panelSwatch.value) >= 1.6 ? palette.accent : palette.background
}

/** The panel's box grown over the photo by `by` on its side facing it, for a slanted seam. */
function grow(box: Rect, side: Side, by: number): Rect {
  return side === 'top'
    ? { ...box, y: box.y - by, height: box.height + by }
    : { ...box, x: box.x - by, width: box.width + by }
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
