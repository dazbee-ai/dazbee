// Pieces the shape matcher's tests rebuild: graphics drawn by Dazbee's renderer, and pieces of the
// shape prototype's synthetic set 2 with the prototype's first-pass answers for them.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { CanvasKit } from '@dazbee/canvaskit'
import type { Pixels } from '@dazbee/renderer'
import type { Paint, Shape } from '@dazbee/schema'

import type { ShapeLayer, ShapeStroke } from './draw-layers.ts'

/** The prototype's first-pass answer for a piece: its decision, why, the fitted rule's numbers and its graphics. */
export interface PrototypeAnswer {
  decision: 'shapes' | 'picture'
  why: string
  fitted: { ssim: number; far: number; inkMissed: number } | null
  layers: unknown[]
}

/** A piece of synthetic set 2, the brand kit it was matched with, and the prototype's answer. */
export interface PrototypePiece {
  id: string
  family: string
  degradation: string
  kit: Record<string, `#${string}`>
  firstPass: PrototypeAnswer
  pixels: Pixels
}

const FIXTURES = join(import.meta.dirname, '..', '..', 'fixtures', 'shape-prototype')

/** The prototype's pieces, read with CanvasKit as the matchers read pictures. */
export function prototypePieces(ck: CanvasKit): PrototypePiece[] {
  const { pieces } = JSON.parse(readFileSync(join(FIXTURES, 'answers.json'), 'utf8')) as {
    pieces: Omit<PrototypePiece, 'pixels'>[]
  }
  return pieces.map((piece) => ({ ...piece, pixels: decodePng(ck, readFileSync(join(FIXTURES, `${piece.id}.png`))) }))
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
