// Pieces the shape matcher's tests rebuild: graphics drawn by Dazbee's renderer, and PNGs read as the matchers read
// pictures.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { CanvasKit } from '@dazbee/canvaskit'
import type { Pixels } from '@dazbee/renderer'
import { type MatchAnswer, type Paint, type Shape, UnplacedLayer } from '@dazbee/schema'

import type { ShapeLayer, ShapeStroke } from './draw-layers.ts'

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

/** A free shape of 14 corners at varied reach, in a box round its centre: one shape of a painted scene. */
export const blob = (cx: number, cy: number, r: number, seed: number, color: `#${string}`): ShapeLayer => {
  const corners = Array.from({ length: 14 }, (_, i) => {
    const a = (i / 14) * 2 * Math.PI
    const reach = 0.7 + 0.3 * Math.abs(Math.sin(seed * (i + 1) * 1.7))
    return `${(50 + 50 * reach * Math.cos(a)).toFixed(2)} ${(50 + 50 * reach * Math.sin(a)).toFixed(2)}`
  })
  return graphic(
    { kind: 'path', d: `M${corners.join(' L')} Z`, fillRule: 'nonzero', drawnIn: { width: 100, height: 100 } },
    { x: cx - r, y: cy - r, width: 2 * r, height: 2 * r },
    { fill: { type: 'solid', color } },
  )
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
