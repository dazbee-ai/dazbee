// Text pieces for the text matcher's tests: text drawn by Dazbee's renderer in a shipped face and cut
// round its ink; the shortlist's pieces, drawn the same way in Google faces and kept as PNGs; Light's
// pieces, drawn when the test runs in Google faces cut to the test's characters; a blank piece and a
// piece of noise; the shipped faces by key; and a job of a piece.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { CanvasKit } from '@dazbee/canvaskit'
import { loadFontFiles } from '@dazbee/fonts/node'
import { type Pixels, renderPixels } from '@dazbee/renderer'
import {
  type MatchAnswer,
  MatchJob,
  type MatchKit,
  type MatchSetting,
  type TextCurve,
  type UnplacedLayer,
} from '@dazbee/schema'

import { decodePng } from '../shape/test-pieces.ts'
import { fontKey, parseFontKey } from './font-key.ts'
import type { TextPieceOfJob } from './match-text.ts'

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
  /** Drawn with no fill: its outline alone, hollow. */
  hollow?: boolean
  /** Degrees clockwise. */
  rotation?: number
  align?: 'start' | 'center' | 'end'
  /** Letter spacing in % of the size. */
  spacing?: number
  /** Its lines bent along a curve. */
  curve?: TextCurve
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

/** A piece of Light's test, as `pieces.json` holds it: the key of the face it is drawn in and how. */
export interface LightDrawing extends Omit<DrawnText, 'family' | 'weight' | 'style'> {
  id: string
  key: string
}

/** A piece of Light's test drawn: its drawing and its pixels. */
export interface LightPiece extends LightDrawing {
  pixels: Pixels
}

/** The shortlist test's pieces: `pieces.json` and a PNG a piece. */
export const SHORTLIST_FIXTURES = join(import.meta.dirname, '..', '..', 'fixtures', 'text-shortlist')
/**
 * Light's test: `pieces.json`, and in `fonts/` every face its pieces are drawn in or shortlist, cut to
 * the test's characters, which `fonts.json` names by key.
 */
export const LIGHT_FIXTURES = join(import.meta.dirname, '..', '..', 'fixtures', 'text-light')
/** The words of the noise piece of Light's test. */
export const NOISE_WORDS = 'Sale'
/** A brand kit with nothing in it. */
export const NO_KIT: MatchKit = { colors: {}, fonts: {}, textStyles: [] }

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
            color: `${text.colour}${text.hollow ? '00' : 'FF'}`,
            ...(text.spacing ? { letterSpacing: { unit: 'percent', value: text.spacing } } : {}),
            ...(text.outline ? { outline: { ...text.outline, color: `${text.outline.color}FF` } } : {}),
          },
          ...(text.curve ? { curve: text.curve } : {}),
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

/** Light's pieces as `pieces.json` describes them. */
export function lightDrawings(): LightDrawing[] {
  return (JSON.parse(readFileSync(join(LIGHT_FIXTURES, 'pieces.json'), 'utf8')) as { pieces: LightDrawing[] }).pieces
}

/** The faces of Light's test cut to its characters, by key. */
export function lightFonts(): Map<string, Uint8Array> {
  const files = JSON.parse(readFileSync(join(LIGHT_FIXTURES, 'fonts.json'), 'utf8')) as Record<string, string>
  return new Map(
    Object.entries(files).map(([key, file]) => [
      key,
      new Uint8Array(readFileSync(join(LIGHT_FIXTURES, 'fonts', file))),
    ]),
  )
}

/** The shipped faces by key, as a font source gives them. */
export function shippedFaces(): Map<string, Uint8Array> {
  return new Map(loadFontFiles().map((face) => [fontKey(face), face.bytes]))
}

/** Light's pieces, each drawn by Dazbee's renderer in its face from `fonts`, faces by key. */
export function lightPieces(ck: CanvasKit, fonts: ReadonlyMap<string, Uint8Array>): LightPiece[] {
  return lightDrawings().map((drawing) => {
    const face = parseFontKey(drawing.key)
    const bytes = fonts.get(drawing.key)
    if (!face || !bytes) throw new Error(`Light's test has no face ${drawing.key}`)
    return { ...drawing, pixels: drawText(ck, { ...drawing, ...face }, [{ family: face.family, bytes }]) }
  })
}

/** A job of one text piece, the whole picture, saying `words`, with a kit (none by default) and a setting. */
export function textJob(
  ck: CanvasKit,
  pixels: Pixels,
  words: string,
  { kit = NO_KIT, setting }: { kit?: MatchKit; setting?: MatchSetting } = {},
): { job: MatchJob; piece: TextPieceOfJob } {
  const image = ck.MakeImage(
    {
      width: pixels.width,
      height: pixels.height,
      colorType: ck.ColorType.RGBA_8888,
      alphaType: ck.AlphaType.Unpremul,
      colorSpace: ck.ColorSpace.SRGB,
    },
    pixels.pixels,
    pixels.width * 4,
  )
  const png = image?.encodeToBytes()
  image?.delete()
  if (!png) throw new Error('CanvasKit could not encode the piece')
  const piece: TextPieceOfJob = {
    kind: 'text',
    rect: { x: 0, y: 0, width: pixels.width, height: pixels.height },
    words,
  }
  const job = MatchJob.parse({
    picture: Buffer.from(png).toString('base64'),
    pieces: [piece],
    kit,
    ...(setting ? { setting } : {}),
  })
  return { job, piece }
}

/** The one text layer of an answer; throws for a picture's answer or another layer. */
export function textLayerOf(answer: MatchAnswer): Extract<UnplacedLayer, { type: 'text' }> {
  if (answer.kind !== 'layers') throw new Error(`a picture: ${answer.why}`)
  const [layer] = answer.layers
  if (layer?.type !== 'text') throw new Error('the answer is no text layer')
  return layer
}

/** A piece of grey noise the same every time, 240 × 80. */
export function noisePiece(): Pixels {
  const width = 240
  const height = 80
  const pixels = new Uint8Array(width * height * 4)
  // A linear congruential generator, so the noise is the same in every runtime.
  let seed = 7
  for (let i = 0; i < width * height; i++) {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0
    pixels.fill(seed >>> 24, i * 4, i * 4 + 3)
    pixels[i * 4 + 3] = 255
  }
  return { width, height, pixels }
}

/** A piece of one flat white, 240 × 80, with no ink. */
export function blankPiece(): Pixels {
  const width = 240
  const height = 80
  return { width, height, pixels: new Uint8Array(width * height * 4).fill(255) }
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
