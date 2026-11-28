// What the shape matcher's tests share: pieces painted by hand, graphics drawn as a piece and matched or stacked,
// and what the tests expect of the graphics that come back.

import { expect } from 'vitest'

import type { Pixels } from '@dazbee/renderer'
import { loadCanvasKit } from '@dazbee/renderer/node'
import type { MatchAnswer, MatchKit, Paint, UnplacedLayer } from '@dazbee/schema'

import { looksSame } from '../looks-same/rule.ts'
import { drawGraphics, type ShapeLayer } from './draw-layers.ts'
import { type Around, matchShapesOf, SHAPES, type ShapeStep } from './match-shapes.ts'
import { hexRgb } from './parts/colour.ts'
import { toFloatPicture } from './parts/float-picture.ts'
import { type Split, splitPatches } from './patches.ts'
import { stack, type Stacked } from './stacking.ts'
import { hiding } from './test-pieces.ts'

/** A graphic of an answer. */
export type Graphic = Extract<UnplacedLayer, { type: 'graphic' }>

/** A box in a piece's pixels. */
export interface Box {
  x: number
  y: number
  width: number
  height: number
}

/** How graphics are drawn as a piece and matched: the piece's size, 200 × 140 when not given, the kit's colours and the frame around it. */
export interface Matching {
  width?: number
  height?: number
  colors?: MatchKit['colors']
  around?: Around
}

/** The size of a piece drawn with no size given. */
export const WIDTH = 200
export const HEIGHT = 140

const ck = await loadCanvasKit()

/** A piece painted by hand: each pixel has the red, green, blue and alpha `colourAt` gives it. */
export function painted(
  width: number,
  height: number,
  colourAt: (x: number, y: number) => readonly [number, number, number, number],
): Pixels {
  const pixels = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) pixels.set(colourAt(x, y), (y * width + x) * 4)
  return { width, height, pixels }
}

/** Halftone dots, 1080 px a side: a dark dot of 2 px every 4 px on white, which a shrink to half turns into one grey. */
export function halftone(): Pixels {
  return painted(1080, 1080, (x, y) => (x % 4 < 2 && y % 4 < 2 ? [20, 20, 20, 255] : [255, 255, 255, 255]))
}

/**
 * A white piece of 300 × 200 with a red band down its left 100 px and a red disc of radius 30 round (220, 100),
 * and what a layer in front hides of it: a box of 120 px round the disc.
 */
export function bandAndDisc(): { piece: Pixels; hidden: Uint8Array } {
  const piece = painted(300, 200, (x, y) =>
    x < 100 || Math.hypot(x + 0.5 - 220, y + 0.5 - 100) < 30 ? [220, 38, 38, 255] : [255, 255, 255, 255],
  )
  return { piece, hidden: hiding({ x: 160, y: 40, width: 120, height: 120 }, 300, 200) }
}

/**
 * A navy block of 200 × 60 at (10, 10) on a clear piece of 220 × 80, with a row above it and a row below it that
 * are the navy mixed with the white a frame shows behind the piece: the block's edges, drawn between pixels.
 */
export function rimmed(): Pixels {
  return painted(220, 80, (x, y) => {
    if (x < 10 || x > 209 || y < 9 || y > 70) return [0, 0, 0, 0]
    return y === 9 ? [143, 153, 166, 255] : y === 70 ? [221, 223, 230, 238] : [16, 40, 72, 255]
  })
}

/**
 * The answer for graphics drawn as a piece, with the steps told. The piece is drawn and matched twice: the two
 * answers are one, and the first is returned.
 */
export function matched(
  layers: ShapeLayer[],
  { width = WIDTH, height = HEIGHT, colors = {}, around = {} }: Matching = {},
): { piece: Pixels; answer: MatchAnswer; steps: ShapeStep[] } {
  const piece = drawGraphics(ck, layers, width, height)
  const steps: ShapeStep[] = []
  const answer = matchShapesOf(ck, piece, colors, around, (step) => steps.push(step))
  expect(matchShapesOf(ck, drawGraphics(ck, layers, width, height), colors, around)).toEqual(answer)
  return { piece, answer, steps }
}

/** An answer's graphics, back to front; it throws for a piece that stayed a picture. */
export function graphicsIn(answer: MatchAnswer): Graphic[] {
  if (answer.kind !== 'layers') throw new Error(`a picture: ${answer.why}`)
  expect(answer.approximate).toBe(false)
  return answer.layers.map((layer) => {
    if (layer.type !== 'graphic') throw new Error(`a ${layer.type} layer`)
    return layer
  })
}

/** The one graphic of a list of them; it throws for none, and expects no other. */
export function onlyOne<Layer>(layers: readonly Layer[]): Layer {
  const [only, ...others] = layers
  expect(others).toEqual([])
  if (!only) throw new Error('no graphic')
  return only
}

/** The graphics that rebuild graphics drawn as a piece, which look the same as the piece by the rule. */
export function rebuilt(layers: ShapeLayer[], options: Matching = {}): Graphic[] {
  const { piece, answer } = matched(layers, options)
  const graphics = graphicsIn(answer)
  expect(looksSame('shape', piece, drawGraphics(ck, graphics, piece.width, piece.height)).same).toBe(true)
  return graphics
}

/** The one graphic that rebuilds graphics drawn as a piece. */
export function rebuiltAsOne(layers: ShapeLayer[], options: Matching = {}): Graphic {
  return onlyOne(rebuilt(layers, options))
}

/** The one graphic a piece painted by hand is rebuilt as, in the frame around it. */
export function matchedAsOne(piece: Pixels, around: Around = {}): Graphic {
  return onlyOne(graphicsIn(matchShapesOf(ck, piece, {}, around)))
}

/** A piece cut into patches and the patches stacked, as the matcher does both. */
export function stackedOf(piece: Pixels, hidden?: Uint8Array): { split: Split; stacked: Stacked[] } {
  const split = splitPatches(toFloatPicture(piece), hidden)
  if (!split) throw new Error('the piece was cut no further')
  const patches = split.patches.filter((patch) => patch.outline >= SHAPES.leastOutline)
  return { split, stacked: stack(patches, split.patchOf, split.width, split.height) }
}

/** Expects a graphic's box to be the one drawn, each number within `within` pixels. */
export function expectBox(layer: { props: Box }, box: Box, within = 1): void {
  expect(Math.abs(layer.props.x - box.x)).toBeLessThanOrEqual(within)
  expect(Math.abs(layer.props.y - box.y)).toBeLessThanOrEqual(within)
  expect(Math.abs(layer.props.width - box.width)).toBeLessThanOrEqual(within)
  expect(Math.abs(layer.props.height - box.height)).toBeLessThanOrEqual(within)
}

/** Expects a colour to be another, each channel within 6 of 255. */
export function expectColour(color: string | undefined, want: string): void {
  const got = hexRgb(color ?? '')
  hexRgb(want).forEach((channel, i) => expect(Math.abs((got[i] ?? NaN) - channel)).toBeLessThanOrEqual(6))
}

/** A graphic's one fill, when it is a flat colour. */
export function flatFill(layer: { props: { fills: readonly Paint[] } }): Extract<Paint, { type: 'solid' }> {
  const [fill, ...others] = layer.props.fills
  expect(others).toEqual([])
  if (fill?.type !== 'solid') throw new Error(`a ${fill?.type} fill`)
  return fill
}
