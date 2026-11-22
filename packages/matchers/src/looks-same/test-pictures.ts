// Pictures the looks-the-same tests judge: pieces of the text prototype's synthetic test part with
// the prototype's Light rebuilds and the prototype rule's numbers for them, and shapes drawn here.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'

import type { Pixels } from '@dazbee/renderer'
import { loadCanvasKit } from '@dazbee/renderer/node'
import type { Rgb } from '@dazbee/schema'

/** The prototype rule's numbers and decisions for a pair, seen over some backgrounds (null for none). */
export interface PrototypeSeen {
  backgrounds: Rgb[] | null
  ssim: number
  inkMissed: number
  far: number
  textLooksSame: boolean
  shapeLooksSame: boolean
}

/** A piece, the prototype's rebuild of it, its ink when it is a flat crop, and the prototype's numbers. */
export interface PrototypePair {
  id: string
  piece: Pixels
  rebuild: Pixels
  pieceInk: Float32Array | undefined
  /** The background the prototype estimated the piece is seen on. */
  background: Rgb
  /** The prototype's colour guard ΔE00. */
  inkColour: number
  seen: PrototypeSeen[]
}

/** A shape drawn into a picture: whether a pixel centre (x + 0.5, y + 0.5) lies inside it. */
export type Inside = (x: number, y: number) => boolean

interface StoredPair {
  id: string
  ink: boolean
  background: Rgb
  inkColour: number
  seen: PrototypeSeen[]
}

const PAIRS_DIR = join(import.meta.dirname, '..', '..', 'fixtures', 'prototype-pairs')
/** Samples a pixel is split into, each way, to draw a shape's edge soft. */
const EDGE_SAMPLES = 4

/** The pairs, read with CanvasKit as the matchers read pictures. */
export async function prototypePairs(): Promise<PrototypePair[]> {
  const { pairs } = JSON.parse(readFileSync(join(PAIRS_DIR, 'scores.json'), 'utf8')) as { pairs: StoredPair[] }
  const ck = await loadCanvasKit()
  const decode = (file: string): Pixels => {
    const image = ck.MakeImageFromEncoded(readFileSync(join(PAIRS_DIR, file)))
    if (!image) throw new Error(`${file} is not a PNG CanvasKit reads`)
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
    if (!(pixels instanceof Uint8Array)) throw new Error(`could not read ${file}`)
    return { width, height, pixels }
  }
  return pairs.map((pair) => ({
    ...pair,
    piece: decode(`${pair.id}-piece.png`),
    rebuild: decode(`${pair.id}-rebuild.png`),
    pieceInk: pair.ink ? inkOf(`${pair.id}-ink.f32.gz`) : undefined,
  }))
}

/**
 * A picture of shapes, later ones over earlier ones, each in its colour with soft edges, see-through
 * where none is.
 */
export function drawShapes(width: number, height: number, shapes: readonly (readonly [Inside, Rgb])[]): Pixels {
  const pixels = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      for (const [inside, colour] of shapes) {
        const cover = coverage(inside, x, y)
        if (cover === 0) continue
        const i = (y * width + x) * 4
        const below = (pixels[i + 3] ?? 0) / 255
        const alpha = cover + below * (1 - cover)
        for (let c = 0; c < 3; c++) {
          pixels[i + c] = Math.round(((colour[c] ?? 0) * cover + (pixels[i + c] ?? 0) * below * (1 - cover)) / alpha)
        }
        pixels[i + 3] = Math.round(alpha * 255)
      }
    }
  return { width, height, pixels }
}

/** A rectangle's inside. */
export const rect =
  (left: number, top: number, width: number, height: number): Inside =>
  (x, y) =>
    x >= left && x < left + width && y >= top && y < top + height

/** An ellipse's inside. */
export const ellipse =
  (cx: number, cy: number, rx: number, ry: number): Inside =>
  (x, y) =>
    ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1

/** A ring's inside: an ellipse's less a smaller one's at the same centre. */
export const ring =
  (cx: number, cy: number, outer: number, inner: number): Inside =>
  (x, y) =>
    ellipse(cx, cy, outer, outer)(x, y) && !ellipse(cx, cy, inner, inner)(x, y)

/** A picture with each pixel's colour changed where it has any alpha; the alpha kept. */
export function recoloured(picture: Pixels, colour: Rgb): Pixels {
  const pixels = new Uint8Array(picture.pixels)
  for (let i = 0; i < pixels.length; i += 4) if (pixels[i + 3]) pixels.set(colour, i)
  return { ...picture, pixels }
}

/** The 32-bit floats of a gzipped ink file. */
function inkOf(file: string): Float32Array {
  const bytes = gunzipSync(readFileSync(join(PAIRS_DIR, file)))
  return new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
}

/** The share of a pixel a shape covers, from a grid of samples. */
function coverage(inside: Inside, x: number, y: number): number {
  let hits = 0
  for (let sy = 0; sy < EDGE_SAMPLES; sy++)
    for (let sx = 0; sx < EDGE_SAMPLES; sx++)
      if (inside(x + (sx + 0.5) / EDGE_SAMPLES, y + (sy + 0.5) / EDGE_SAMPLES)) hits++
  return hits / EDGE_SAMPLES ** 2
}
