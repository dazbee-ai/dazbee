// Text pieces for the text matcher's tests: text drawn by Dazbee's renderer in a shipped face and cut
// round its ink, and the shortlist's pieces, drawn the same way in Google faces and kept as PNGs.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { CanvasKit } from '@dazbee/canvaskit'
import { loadFontFiles } from '@dazbee/fonts/node'
import { type Pixels, renderPixels } from '@dazbee/renderer'

import { decodePng } from '../shape/test-pieces.ts'

/** A text to draw and how. */
export interface DrawnText {
  words: string
  family: string
  weight: number
  style?: 'normal' | 'italic'
  size: number
  colour: `#${string}`
  /** The colour it is drawn on; null draws it as a cut-out. */
  background: `#${string}` | null
  outline?: { width: number; color: `#${string}` }
  /** Degrees clockwise. */
  rotation?: number
  align?: 'start' | 'center' | 'end'
}

/** A piece of the shortlist's test: the face it is drawn in, its words and its pixels. */
export interface ShortlistPiece {
  id: string
  key: string
  words: string
  pixels: Pixels
}

/**
 * How a piece of the shortlist's test is drawn, as `pieces.json` holds it: its face's key and file
 * in google/fonts, and the rest of the text but the family, weight and style, which the key gives.
 */
export interface ShortlistDrawing extends Omit<DrawnText, 'family' | 'weight' | 'style'> {
  id: string
  key: string
  /** The face's file, in a checkout of google/fonts at `GOOGLE_FONTS`'s commit. */
  file: string
}

/** The shortlist test's pieces: `pieces.json` and a PNG a piece. */
export const SHORTLIST_FIXTURES = join(import.meta.dirname, '..', '..', 'fixtures', 'text-shortlist')

/** The frame the text is drawn in before it is cut round its ink. */
const FRAME = { width: 1400, height: 900 }
/** The pixels left round the ink when a drawn text is cut out. */
const MARGIN = 10

/**
 * The text drawn in the middle of a big frame, in a shipped face or one of `fonts`, and cut round
 * its ink with a margin.
 */
export function drawText(
  ck: CanvasKit,
  text: DrawnText,
  fonts: { family: string; bytes: Uint8Array }[] = loadFontFiles().map(({ family, bytes }) => ({ family, bytes })),
): Pixels {
  const design = {
    meta: { designId: 'text-piece', name: 'Text piece' },
    pages: { p: { name: 'Page', order: 'a0' } },
    frames: {
      f: {
        pageId: 'p',
        name: 'Piece',
        ...FRAME,
        x: 0,
        y: 0,
        fills: text.background ? [{ type: 'solid', color: `${text.background}FF` }] : [],
        order: 'a0',
      },
    },
    nodes: {
      t: {
        type: 'text',
        parentId: 'f',
        link: 't',
        index: 'a0',
        name: 'Words',
        props: {
          x: 100,
          y: 100,
          width: FRAME.width - 200,
          height: FRAME.height - 200,
          rotation: text.rotation ?? 0,
          boxMode: 'fixed',
          align: text.align ?? 'start',
          verticalAlign: 'middle',
          text: text.words,
          style: {
            fontFamily: text.family,
            fontWeight: text.weight,
            fontStyle: text.style ?? 'normal',
            fontSize: text.size,
            color: `${text.colour}FF`,
            ...(text.outline ? { outline: { ...text.outline, color: `${text.outline.color}FF` } } : {}),
          },
        },
      },
    },
  }
  return cutRoundInk(renderPixels(ck, design, 'f', { fonts, fallbackFamilies: [], images: {} }))
}

/** The shortlist's 12 pieces, each drawn by Dazbee's renderer in the Google face its key names. */
export function shortlistPieces(ck: CanvasKit): ShortlistPiece[] {
  const { pieces } = JSON.parse(readFileSync(join(SHORTLIST_FIXTURES, 'pieces.json'), 'utf8')) as {
    pieces: ShortlistDrawing[]
  }
  return pieces.map((piece) => ({
    id: piece.id,
    key: piece.key,
    words: piece.words,
    pixels: decodePng(ck, readFileSync(join(SHORTLIST_FIXTURES, `${piece.id}.png`))),
  }))
}

/** The pixels within `MARGIN` of every pixel unlike the top left one. */
function cutRoundInk({ width, height, pixels }: Pixels): Pixels {
  let x0 = width
  let y0 = height
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      for (let c = 0; c < 4; c++)
        if (pixels[(y * width + x) * 4 + c] !== pixels[c]) {
          x0 = Math.min(x0, x)
          x1 = Math.max(x1, x)
          y0 = Math.min(y0, y)
          y1 = Math.max(y1, y)
        }
  if (x1 < 0) throw new Error('nothing was drawn')
  x0 = Math.max(0, x0 - MARGIN)
  y0 = Math.max(0, y0 - MARGIN)
  const w = Math.min(width - 1, x1 + MARGIN) - x0 + 1
  const h = Math.min(height - 1, y1 + MARGIN) - y0 + 1
  const out = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y++)
    out.set(pixels.subarray(((y + y0) * width + x0) * 4, ((y + y0) * width + x0 + w) * 4), y * w * 4)
  return { width: w, height: h, pixels: out }
}
