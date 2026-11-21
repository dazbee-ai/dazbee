// Photo with a band: the photo and a band of colour holding the words, so they read on any photo. The band runs
// along the bottom of a square or tall frame, under the photo, and beside it in a wide frame, a banner or a strip.
// Its edge over the photo is the style's: slanted over an accent stripe (bold), straight with an accent bar
// (minimal), waved with dots above it (playful), or fading into the photo inside a fine frame line (premium).
import type { Rect } from '@dazbee/schema'

import { type Build, logo, logoRoom, photo, usualWords } from '../build.ts'
import { bar, dots, insetFrame } from '../decorations.ts'
import { panel, type Side, STYLE_EDGES } from '../edges.ts'
import { contrast, type Swatch } from '../palette.ts'
import type { Pattern } from '../types.ts'
import { rowWords, stackWords } from '../words.ts'

export const PHOTO_BAND: Pattern = {
  id: 'photo-band',
  name: 'Photo with a band',
  kinds: ['lifestyle photo', 'sale or offer', 'product launch', 'single product'],
  description:
    'The photo and a band of brand colour holding the words, so they read on any photo: the band runs under the photo, or beside it in a wide frame or a banner.',
  needs: ['headline', 'photo'],
  takes: ['kicker', 'subline', 'button', 'highlight', 'logo'],
}

/** Where the photo, the band and the words go in a frame. */
interface Arrangement {
  photo: Rect
  band: Rect
  /** The band's side over the photo, drawn in the style's edge. */
  side: Side
  /** How deep the band's drawn edge is. */
  depth: number
  words: Rect
  /** Where the logo goes, on the photo, and how it lines up there; none where it has no room. */
  logo?: { room: Rect; align: 'start' | 'center' | 'end' }
}

/** Builds the photo with a band in the frame. */
export function photoBand(b: Build) {
  const { styleName, palette, frame } = b
  const at = arrange(b)
  const colour = bandColour(b)
  photo(b, at.photo)
  if (styleName === 'bold') {
    const stripe = Math.max(3, Math.round(Math.min(frame.width, frame.height) * 0.02))
    const under =
      at.side === 'top'
        ? { ...at.band, y: at.band.y - stripe, height: at.band.height + stripe }
        : { ...at.band, width: at.band.width + stripe }
    panel(b, 'stripe', 'Stripe', under, at.side, 'slant', at.depth, palette.accent)
  }
  panel(b, 'band', 'Band', at.band, at.side, STYLE_EDGES[styleName], at.depth, colour)
  if (at.logo) logo(b, at.logo.room, at.logo.align)
  const words = {
    parts: usualWords(b.content),
    ...(b.content.button ? { button: b.content.button, buttonFill: buttonColour(b, colour) } : {}),
    room: at.words,
    surface: colour.value,
  }
  if (frame.shape === 'strip') rowWords(b.tree, b, words)
  else stackWords(b.tree, b, words)
  decorate(b, at)
}

/** The photo, band, words and logo arranged for the frame's shape. */
function arrange(b: Build): Arrangement {
  const { frame, styleName } = b
  const { width, height, shape, margin, safe } = frame
  const short = Math.min(width, height)
  const edge = STYLE_EDGES[styleName]
  const drawn = (room: number) =>
    edge === 'fade'
      ? Math.round(Math.min(room * 0.4, short * 0.24))
      : edge === 'straight'
        ? 0
        : Math.round(short * 0.07)
  const lead = Math.round(margin * (edge === 'straight' ? 0.9 : 0.5))
  if (shape === 'strip' || shape === 'banner' || shape === 'wide') {
    // The band down the left, the photo on the right.
    const photoWidth =
      shape === 'wide' ? width * 0.5 : shape === 'banner' ? Math.min(height * 1.6, width * 0.36) : height * 1.5
    const clear = Math.round(width - photoWidth)
    const depth = drawn(clear)
    const words = { x: safe.x, y: safe.y, width: clear - safe.x - lead, height: safe.height }
    const logoAt =
      shape === 'strip'
        ? undefined
        : { room: logoRoom(b, { x: width - margin, y: margin }, photoWidth - 2 * margin), align: 'end' as const }
    if (logoAt) logoAt.room.x -= logoAt.room.width
    return {
      photo: { x: clear - depth, y: 0, width: width - clear + depth, height },
      band: { x: 0, y: 0, width: clear + depth, height },
      side: 'right',
      depth,
      words,
      ...(logoAt ? { logo: logoAt } : {}),
    }
  }
  // The photo on top, the band under it.
  const clear = Math.round(
    shape === 'square'
      ? height * (height > width * 1.1 ? 0.58 : 0.56)
      : shape === 'tower'
        ? height * 0.45
        : safe.y + safe.height * 0.45,
  )
  const depth = drawn(clear)
  const bottom = safe.y + safe.height
  const logoAlign = b.style.align === 'center' ? 'center' : 'start'
  const room = logoRoom(b, { x: safe.x, y: safe.y }, safe.width)
  if (logoAlign === 'center') room.x = Math.round((width - room.width) / 2)
  return {
    photo: { x: 0, y: 0, width, height: clear },
    band: { x: 0, y: clear - depth, width, height: height - clear + depth },
    side: 'top',
    depth,
    words: { x: safe.x, y: clear + lead, width: safe.width, height: bottom - clear - lead },
    logo: { room, align: logoAlign },
  }
}

/** The band's colour: the kit's background for a straight edge, a dark for a fade, else the primary. */
function bandColour({ styleName, palette }: Build): Swatch {
  if (styleName === 'minimal') return palette.background
  if (styleName === 'premium') return palette.secondary
  return palette.primary
}

/** The button's colour on the band: the primary on a minimal band, else the accent where it stands out, else the background. */
function buttonColour({ styleName, palette }: Build, band: Swatch): Swatch {
  if (styleName === 'minimal') return palette.primary
  return contrast(palette.accent.value, band.value) >= 1.6 ? palette.accent : palette.background
}

/** The style's decoration beside the band: dots on a wave, a fine frame line, a bar on a straight edge under the photo. */
function decorate(b: Build, { band, side, depth }: Arrangement) {
  const { frame, styleName, palette } = b
  const short = Math.min(frame.width, frame.height)
  if (frame.shape === 'strip') return
  if (styleName === 'playful') {
    const r = short * 0.05
    const [x, y] =
      side === 'top'
        ? [frame.width - short * 0.18, band.y - r * 0.2]
        : [band.x + band.width - depth * 0.5, frame.height - Math.max(r * 2, short * 0.16)]
    dots(b, 'dot', [
      { x, y, r, colour: palette.accent },
      { x: x - r * 1.9, y: y - r * 1.5, r: r * 0.42, colour: palette.secondary },
    ])
  }
  if (styleName === 'premium') insetFrame(b, palette.accent, Math.round(frame.margin * 0.4), 0.8)
  if (styleName === 'minimal' && side === 'top') {
    const thick = Math.max(2, Math.round(short * 0.01))
    const length = Math.round(short * 0.16)
    bar(b, 'edge-bar', 'Bar', { x: frame.safe.x, y: band.y - thick / 2, width: length, height: thick }, palette.accent)
  }
}
