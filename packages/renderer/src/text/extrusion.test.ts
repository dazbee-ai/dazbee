import { describe, expect, it } from 'vitest'

import type { Canvas, Path } from '@dazbee/canvaskit'
import { FALLBACK_FAMILIES } from '@dazbee/fonts'
import { loadFontFiles } from '@dazbee/fonts/node'
import { TextProps } from '@dazbee/schema'

import { color } from '../color.ts'
import { EVERYWHERE } from '../draw/paths.ts'
import { loadCanvasKit } from '../node.ts'
import { resourceCache } from '../resources.ts'
import { EXTRUSION_SHADE, extrusionReach, shadedColour, type SidesReach, sweptOutlines } from './extrusion.ts'
import { layoutText } from './layout.ts'

const ck = await loadCanvasKit()
const shipped = resourceCache(ck).resources({
  fonts: loadFontFiles(),
  fallbackFamilies: [...FALLBACK_FAMILIES],
  images: {},
})
/** How many copies of the letters, carried a share of the reach further each, stand in for what they sweep. */
const SAMPLES = 240

/** A text of one line in a family and weight, its box as given. */
const textOf = (text: string, props: Record<string, unknown> = {}, style: Record<string, unknown> = {}) =>
  TextProps.parse({
    x: 0,
    y: 0,
    width: 600,
    height: 100,
    boxMode: 'autoWidth',
    text,
    style: { fontFamily: 'Noto Sans', fontWeight: 800, fontSize: 120, color: '#000000FF', ...style },
    ...props,
  })

/** The outlines of the glyphs `draw` draws, as drawn. */
function outlinesOf(draw: (canvas: Canvas) => void): Path {
  const recorder = new ck.PictureRecorder()
  draw(recorder.beginRecording(EVERYWHERE))
  const picture = recorder.finishRecordingAsPicture()
  recorder.delete()
  const outlines = ck.GlyphOutlines(picture)
  picture.delete()
  return outlines
}

/** The outlines of a text's letters as its layout draws them, its paragraphs and markers, from its box's corner. */
function letterOutlines(props: TextProps): Path {
  const laid = layoutText(ck, { ...props, extrusion: undefined }, shipped)
  const outlines = outlinesOf((canvas) => {
    for (const b of laid.blocks) {
      canvas.drawParagraph(b.paragraph, b.x, laid.dy + b.y)
      if (b.marker) canvas.drawParagraph(b.marker, b.markerX, laid.dy + b.y + b.markerY)
    }
  })
  laid.delete()
  return outlines
}

/** `SAMPLES` + 1 copies of a path, each carried a share of `reach` further, from none to all of it, as one path. */
function sampledSweep(path: Path, reach: SidesReach): Path {
  const builder = new ck.PathBuilder()
  for (let i = 0; i <= SAMPLES; i++)
    builder.addPath(path, ck.Matrix.translated((reach.x * i) / SAMPLES, (reach.y * i) / SAMPLES))
  return builder.detachAndDelete()
}

/**
 * Whether a path holds each pixel's middle, 255 or 0, drawn moved by (dx, dy) in a `width` × `height`
 * surface without anti-aliasing: its shape alone, as nonzero winding fills it.
 */
function coverage(path: Path, width: number, height: number, dx = 0, dy = 0): Uint8Array {
  const surface = ck.MakeSurface(width, height)
  if (!surface) throw new Error('no surface')
  const canvas = surface.getCanvas()
  const paint = new ck.Paint()
  canvas.translate(dx, dy)
  canvas.drawPath(path, paint)
  const info = {
    width,
    height,
    colorType: ck.ColorType.RGBA_8888,
    alphaType: ck.AlphaType.Unpremul,
    colorSpace: ck.ColorSpace.SRGB,
  }
  const pixels = canvas.readPixels(0, 0, info) as Uint8Array
  paint.delete()
  surface.dispose()
  return pixels.filter((_, i) => i % 4 === 3)
}

/** Whether letters carried back by some share of `reach`, in `SAMPLES` × 8 steps, hold a point. */
function inSweep(letters: Path, reach: SidesReach, x: number, y: number): boolean {
  const steps = SAMPLES * 8
  for (let i = 0; i <= steps; i++)
    if (letters.contains(x - (reach.x * i) / steps, y - (reach.y * i) / steps)) return true
  return false
}

/**
 * Two paths drawn alike and compared at each pixel's middle: how many middles one holds and the
 * other doesn't, which only edges drawn a little apart may give, and each of those checked exactly
 * by `holds`, which must say what `a` holds there. Also how many middles `a` holds.
 */
function compared(a: Path, b: Path, width: number, height: number, holds: (x: number, y: number) => boolean) {
  const [first, second] = [coverage(a, width, height, 20, 20), coverage(b, width, height, 20, 20)]
  let differing = 0
  const wrong: string[] = []
  for (let i = 0; i < first.length; i++) {
    if (first[i] === second[i]) continue
    differing++
    const [x, y] = [(i % width) - 20 + 0.5, Math.floor(i / width) - 20 + 0.5]
    if (a.contains(x, y) !== holds(x, y)) wrong.push(`(${x}, ${y})`)
  }
  return { differing, wrong, covered: first.filter((value) => value > 0).length }
}

/** A path with every contour run the other way, as a font that draws its letters' outsides counter-clockwise has them. */
function reversedContours(path: Path): Path {
  const cmds = path.toCmds()
  const contours: number[][][] = []
  for (let i = 0; i < cmds.length;) {
    const verb = cmds[i] ?? 0
    const count = { [ck.MOVE_VERB]: 1, [ck.LINE_VERB]: 1, [ck.QUAD_VERB]: 2, [ck.CUBIC_VERB]: 3 }[verb] ?? 0
    if (verb === ck.MOVE_VERB) contours.push([[...cmds.subarray(i + 1, i + 3)]])
    else if (count > 0) contours.at(-1)?.push([...cmds.subarray(i + 1, i + 1 + 2 * count)])
    else if (verb !== ck.CLOSE_VERB) throw new Error(`no conics in a glyph: verb ${verb}`)
    i += 1 + 2 * count
  }
  const out: number[] = []
  for (const contour of contours) {
    const [start = [0, 0], ...pieces] = contour
    // Each piece's points from its end back to the end of the piece before it.
    let at = pieces.at(-1)?.slice(-2) ?? start
    out.push(ck.MOVE_VERB, ...at)
    for (let p = pieces.length - 1; p >= 0; p--) {
      const piece = pieces[p] ?? []
      const before = (p > 0 ? pieces[p - 1]?.slice(-2) : start) ?? start
      const controls: number[] = []
      for (let k = piece.length - 4; k >= 0; k -= 2) controls.push(piece[k] ?? 0, piece[k + 1] ?? 0)
      const verb = [ck.LINE_VERB, ck.QUAD_VERB, ck.CUBIC_VERB][piece.length / 2 - 1] ?? ck.LINE_VERB
      out.push(verb, ...controls, ...before)
      at = before
    }
    out.push(ck.CLOSE_VERB)
  }
  const reversed = ck.Path.MakeFromCmds(out)
  if (!reversed) throw new Error('could not reverse the path')
  return reversed
}

describe('extrusionReach', () => {
  it('reaches its depth, a percentage of the font size, along its angle clockwise from the right', () => {
    expect(extrusionReach({ depth: 25, angle: 0 }, 80)).toEqual({ x: 20, y: 0 })
    expect(extrusionReach({ depth: 25, angle: 90 }, 80)).toEqual({ x: 0, y: 20 })
    expect(extrusionReach({ depth: 25, angle: 180 }, 80)).toEqual({ x: -20, y: 0 })
    expect(extrusionReach({ depth: 10, angle: 45 }, 100)).toEqual({ x: 7.071, y: 7.071 })
    expect(extrusionReach({ depth: 10, angle: 300 }, 100)).toEqual({ x: 5, y: -8.66 })
  })

  it('is none without an extrusion or a depth', () => {
    expect(extrusionReach(undefined, 80)).toBeNull()
    expect(extrusionReach({ depth: 0, angle: 45 }, 80)).toBeNull()
  })
})

describe('shadedColour', () => {
  it('is the colour with black at 35 % laid over it, as drawing the black over it gives', () => {
    for (const hex of ['#E53935FF', '#FFC107FF', '#1E88E580', '#FFFFFF33']) {
      const surface = ck.MakeSurface(1, 1)
      if (!surface) throw new Error('no surface')
      const canvas = surface.getCanvas()
      canvas.drawColor(color(ck, hex), ck.BlendMode.Src)
      canvas.drawColor(color(ck, EXTRUSION_SHADE))
      const info = {
        width: 1,
        height: 1,
        colorType: ck.ColorType.RGBA_8888,
        alphaType: ck.AlphaType.Unpremul,
        colorSpace: ck.ColorSpace.SRGB,
      }
      const drawn = [...(canvas.readPixels(0, 0, info) as Uint8Array)]
      surface.dispose()
      const shaded = shadedColour(hex)
      const expected = [1, 3, 5, 7].map((at) => Number.parseInt(shaded.slice(at, at + 2), 16))
      drawn.forEach((value, i) =>
        expect(Math.abs(value - (expected[i] ?? 0)), `${hex} channel ${i}`).toBeLessThanOrEqual(1),
      )
    }
    expect(shadedColour('#FF0000FF')).toBe('#A60000FF')
  })
})

describe('sweptOutlines', () => {
  const reach = { x: 21.2, y: 14.6 }

  it.each([
    { x: 21.2, y: 14.6 },
    { x: -10, y: 25 },
    { x: 0, y: -18 },
    { x: 30, y: 0 },
    { x: -14, y: -14 },
  ])('covers the letters carried by every share of the depth to ($x, $y), and nothing past them', (by) => {
    const letters = letterOutlines(textOf('SALE 50% Og&', {}, { fontWeight: 400 }))
    const sides = sweptOutlines(ck, [letters], by)
    const sampled = sampledSweep(letters, by)
    const { differing, wrong, covered } = compared(sides, sampled, 900, 220, (x, y) => inSweep(letters, by, x, y))
    for (const path of [letters, sides, sampled]) path.delete()

    expect(covered).toBeGreaterThan(20_000)
    expect(wrong).toEqual([])
    expect(differing).toBeLessThan(covered / 500)
  })

  it('leaves a counter open but for the band its inner wall sweeps', () => {
    const letters = letterOutlines(textOf('O', {}, { fontSize: 240 }))
    const sides = sweptOutlines(ck, [letters], reach)
    const [left = 0, top = 0, right = 0, bottom = 0] = letters.computeTightBounds()
    const [width, height] = [Math.ceil(right) + 60, Math.ceil(bottom) + 60]
    const [shown, swept] = [coverage(letters, width, height), coverage(sides, width, height)]
    const at = (pixels: Uint8Array, x: number, y: number) => pixels[Math.round(y) * width + Math.round(x)] ?? 0
    const middle = { x: (left + right) / 2, y: (top + bottom) / 2 }
    // The counter's left edge, across its middle.
    let edge = Math.round(middle.x)
    while (edge > left && at(shown, edge - 1, middle.y) === 0) edge--
    letters.delete()
    sides.delete()

    expect(at(shown, middle.x, middle.y), 'the counter').toBe(0)
    expect(at(swept, middle.x, middle.y), 'the counter, past the inner wall’s band').toBe(0)
    const inBand = { x: edge + reach.x / 2, y: middle.y + reach.y / 2 }
    expect(at(shown, inBand.x, inBand.y), 'inside the counter').toBe(0)
    expect(at(swept, inBand.x, inBand.y), 'the inner wall’s sides').toBe(255)
  })

  it('gives the same sides for a font whose outer contours run the other way', () => {
    const letters = letterOutlines(textOf('Og8 ब', {}, { fontWeight: 700 }))
    const reversed = reversedContours(letters)
    const sides = sweptOutlines(ck, [letters], reach)
    const fromReversed = sweptOutlines(ck, [reversed], reach)
    const { differing, wrong, covered } = compared(sides, fromReversed, 800, 220, (x, y) => fromReversed.contains(x, y))
    for (const path of [letters, reversed, sides, fromReversed]) path.delete()

    expect(covered).toBeGreaterThan(10_000)
    expect(wrong).toEqual([])
    expect(differing).toBe(0)
  })

  it('adds up the sides of fonts that run their contours opposite ways where they overlap', () => {
    // The same letters again, 40 px on, from a font that runs its contours the other way.
    const letters = letterOutlines(textOf('OO'))
    const moved = new ck.PathBuilder()
    moved.addPath(letters, ck.Matrix.translated(40, 0))
    const straight = moved.detachAndDelete()
    const other = reversedContours(straight)
    const both = sweptOutlines(ck, [letters, other], reach)
    const all = new ck.PathBuilder()
    all.addPath(letters)
    all.addPath(straight)
    const union = all.detachAndDelete()
    const sampled = sampledSweep(union, reach)
    const { differing, wrong, covered } = compared(both, sampled, 900, 220, (x, y) => inSweep(union, reach, x, y))
    for (const path of [letters, straight, other, both, union, sampled]) path.delete()

    expect(covered).toBeGreaterThan(10_000)
    expect(wrong).toEqual([])
    expect(differing).toBeLessThan(covered / 500)
  })
})

describe('the sides of a laid-out text', () => {
  const sides = (props: TextProps) => {
    const laid = layoutText(ck, props, shipped)
    const reach = laid.extrusion
    const path = laid.sides()?.copy() ?? null
    laid.delete()
    return { path, reach }
  }

  it('sweeps its letters and list markers where they are drawn, by its depth along its angle', () => {
    const props = textOf('Big\nsale', { list: 'number', extrusion: { depth: 12, angle: 60 } }, { fontWeight: 400 })
    const { path, reach } = sides(props)
    if (!path || !reach) throw new Error('no sides')
    expect(reach).toEqual({ x: 7.2, y: 12.471 })
    const letters = letterOutlines(props)
    const sampled = sampledSweep(letters, reach)
    const { differing, wrong, covered } = compared(path, sampled, 500, 400, (x, y) => inSweep(letters, reach, x, y))
    for (const drawn of [path, letters, sampled]) drawn.delete()

    expect(covered).toBeGreaterThan(5_000)
    expect(wrong).toEqual([])
    expect(differing).toBeLessThan(covered / 500)
  })

  it('has none without an extrusion, and keeps the ones it made until the layout is freed', () => {
    const plain = layoutText(ck, textOf('Plain'), shipped)
    expect(plain.extrusion).toBeNull()
    expect(plain.sides()).toBeNull()
    plain.delete()
    const laid = layoutText(ck, textOf('Deep', { extrusion: { depth: 20, angle: 45 } }), shipped)
    const made = laid.sides()
    expect(made).not.toBeNull()
    expect(laid.sides()).toBe(made)
    laid.delete()
    expect(made?.isDeleted()).toBe(true)
  })
})

describe('the box of a text with 3D sides', () => {
  const box = (props: TextProps) => {
    const laid = layoutText(ck, props, shipped)
    const out = { width: laid.width, height: laid.height, x: laid.blocks[0]?.x ?? 0, y: laid.blocks[0]?.y ?? 0 }
    laid.delete()
    return out
  }

  it('holds the sides both ways in an auto width box, to whole pixels, the letters moved by sides that go left or up', () => {
    const plain = box(textOf('SALE'))
    expect(box(textOf('SALE', { extrusion: { depth: 10, angle: 0 } }))).toEqual({
      ...plain,
      width: Math.ceil(plain.width + 12),
    })
    expect(box(textOf('SALE', { extrusion: { depth: 20, angle: 225 } }))).toEqual({
      width: Math.ceil(plain.width + 24 * Math.SQRT1_2),
      height: Math.ceil(plain.height + 24 * Math.SQRT1_2),
      x: 16.971,
      y: 16.971,
    })
  })

  it('grows an auto height box in height only, its width and wrapping kept, and leaves a fixed box as set', () => {
    const autoHeight = { boxMode: 'autoHeight', width: 300 }
    const plain = box(textOf('Big summer sale', autoHeight))
    expect(box(textOf('Big summer sale', { ...autoHeight, extrusion: { depth: 15, angle: 135 } }))).toEqual({
      ...plain,
      height: Math.ceil(plain.height + 18 * Math.SQRT1_2),
    })
    const fixed = { boxMode: 'fixed', width: 300, height: 200 }
    expect(box(textOf('Sale', { ...fixed, extrusion: { depth: 50, angle: 200 } }))).toEqual(box(textOf('Sale', fixed)))
  })

  it('holds the sides of a curved text both ways, its placed letters moved by sides that go up', () => {
    const curve = { shape: 'arcUp', amount: 60 }
    const plain = layoutText(ck, textOf('SUMMER', { curve }), shipped)
    const laid = layoutText(ck, textOf('SUMMER', { curve, extrusion: { depth: 10, angle: 270 } }), shipped)
    expect(laid.width).toBe(plain.width)
    expect(laid.height).toBe(Math.ceil(plain.height + 12))
    expect(laid.placed?.runs[0]?.xforms[3]).toBeCloseTo((plain.placed?.runs[0]?.xforms[3] ?? 0) + 12, 3)
    plain.delete()
    laid.delete()
  })

  it('doubles the depth as drawn when a corner drag doubles the font size', () => {
    const extrusion = { depth: 15, angle: 45 }
    const once = layoutText(ck, textOf('Sale', { extrusion }, { fontSize: 50 }), shipped)
    const twice = layoutText(ck, textOf('Sale', { extrusion }, { fontSize: 100 }), shipped)
    expect(twice.extrusion?.x).toBeCloseTo(2 * (once.extrusion?.x ?? 0), 2)
    expect(twice.extrusion?.y).toBeCloseTo(2 * (once.extrusion?.y ?? 0), 2)
    once.delete()
    twice.delete()
  })
})
