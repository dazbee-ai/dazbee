// Pieces the shape matcher's tests rebuild: graphics drawn by Dazbee's renderer, and pieces of the
// shape prototype's synthetic set 2 with the prototype's first-pass, ladder or full-pass answers for them.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { CanvasKit } from '@dazbee/canvaskit'
import type { Pixels } from '@dazbee/renderer'
import { type MatchAnswer, type Paint, type Shape, UnplacedLayer } from '@dazbee/schema'

import type { ShapeLayer, ShapeStroke } from './draw-layers.ts'

/** The prototype's answer for a piece: its decision, why, the fitted rule's numbers and its graphics. */
export interface PrototypeAnswer {
  decision: 'shapes' | 'picture'
  why: string
  fitted: { ssim: number; far: number; inkMissed: number } | null
  layers: unknown[]
  /** The photo guard's score of the graphics, for shapes. */
  photoScore?: number
}

/** A piece of synthetic set 2, the brand kit it was matched with, and the prototype's first-pass and ladder answers. */
export interface PrototypePiece {
  id: string
  family: string
  degradation: string
  kit: Record<string, `#${string}`>
  firstPass: PrototypeAnswer
  /** The shape baseline's answer: the prototype's ladder with the photo guard. */
  ladder: PrototypeAnswer
  pixels: Pixels
}

/** A piece of synthetic set 2, the brand kit it was matched with, and the prototype's full-pass answer. */
export interface PrototypeFullPiece extends Omit<PrototypePiece, 'firstPass' | 'ladder'> {
  fullPass: PrototypeAnswer
}

const FIXTURES = join(import.meta.dirname, '..', '..', 'fixtures', 'shape-prototype')
const FULL_FIXTURES = join(import.meta.dirname, '..', '..', 'fixtures', 'shape-prototype-full')

/** The prototype's pieces, read with CanvasKit as the matchers read pictures. */
export function prototypePieces(ck: CanvasKit): PrototypePiece[] {
  const { pieces } = JSON.parse(readFileSync(join(FIXTURES, 'answers.json'), 'utf8')) as {
    pieces: Omit<PrototypePiece, 'pixels'>[]
  }
  return pieces.map((piece) => ({ ...piece, pixels: decodePng(ck, readFileSync(join(FIXTURES, `${piece.id}.png`))) }))
}

/** The prototype's pieces with its full-pass answers, read with CanvasKit as the matchers read pictures. */
export function prototypeFullPieces(ck: CanvasKit): PrototypeFullPiece[] {
  const { pieces } = JSON.parse(readFileSync(join(FULL_FIXTURES, 'answers.json'), 'utf8')) as {
    pieces: Omit<PrototypeFullPiece, 'pixels'>[]
  }
  return pieces.map((piece) => ({
    ...piece,
    pixels: decodePng(ck, readFileSync(join(FULL_FIXTURES, `${piece.id}.png`))),
  }))
}

/** The prototype's answer in the matcher's words. */
export const prototypeAnswer = ({ decision, why, fitted, layers }: PrototypeAnswer): MatchAnswer => {
  const scores = fitted ? { ssim: fitted.ssim, inkMissed: fitted.inkMissed, far: fitted.far } : undefined
  if (decision === 'shapes') {
    if (!scores) throw new Error('shapes without the rule’s numbers')
    return { kind: 'layers', layers: layers.map((layer) => UnplacedLayer.parse(layer)), scores }
  }
  return {
    kind: 'picture',
    why: why.startsWith('looks different') ? 'looksDifferent' : why.startsWith('a photo') ? 'photo' : 'tooManyParts',
    ...(scores ? { scores } : {}),
  }
}

/** A PNG's pixels, 8-bit RGBA with straight alpha. */
export function decodePng(ck: CanvasKit, bytes: Uint8Array): Pixels {
  const image = ck.MakeImageFromEncoded(bytes)
  if (!image) throw new Error('not a PNG CanvasKit reads')
  const width = image.width()
  const height = image.height()
  const pixels = image.readPixels(0, 0, {
    width,
    height,
    colorType: ck.ColorType.RGBA_8888,
    alphaType: ck.AlphaType.Unpremul,
    colorSpace: ck.ColorSpace.SRGB,
  })
  image.delete()
  if (!(pixels instanceof Uint8Array)) throw new Error('could not read the PNG’s pixels')
  return { width, height, pixels }
}

/** A graphic for a test piece: a shape in a box, filled with a colour or stroked with one. */
export function graphic(
  shape: Shape,
  box: { x: number; y: number; width: number; height: number; rotation?: number },
  paint: { fill?: Paint; stroke?: ShapeStroke },
): ShapeLayer {
  return {
    type: 'graphic',
    name: shape.kind,
    props: {
      rotation: 0,
      ...box,
      shape,
      fills: paint.fill ? [paint.fill] : [],
      strokes: paint.stroke ? [paint.stroke] : [],
    },
  }
}

/** Pixels as a PNG in base64, as a job's picture. */
export function pngBase64(ck: CanvasKit, pixels: Pixels): string {
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
  const bytes = image?.encodeToBytes()
  image?.delete()
  if (!bytes) throw new Error('could not encode the picture')
  return Buffer.from(bytes).toString('base64')
}
