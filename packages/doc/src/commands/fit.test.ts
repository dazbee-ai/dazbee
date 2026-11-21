import { describe, expect, it } from 'vitest'

import { GraphicProps, smallestLetters, TextProps } from '@dazbee/schema'

import { fitted, readableScale, scaledSizes } from './fit.ts'

const square = { width: 1080, height: 1080 }
const mpu = { width: 300, height: 250 }
const PAD = { top: 10, right: 10, bottom: 10, left: 10 }
const black = { type: 'solid', color: '#000000FF' }
const STYLE_OF_TEXT = { fontFamily: 'Noto Sans', fontSize: 40, color: '#111111FF' }
/** A layer of `props` in a 100 × 100 box at the top left, fitted from the square to one `factor` times its size. */
const at = <P extends Record<string, unknown>>(factor: number, props: P) => {
  const layer = { x: 0, y: 0, width: 100, height: 100, ...props }
  return fitted(layer, layer, { from: square, to: { width: 1080 * factor, height: 1080 * factor } })
}
/** An image fill, of the fit given and the tile scale where one is given. */
const image = (fit: string, tileScale?: number) => ({
  type: 'image',
  assetId: 'a',
  fit,
  ...(tileScale === undefined ? {} : { tileScale }),
})

describe('fitted', () => {
  it('moves a centred layer to the new centre and scales its size by the smaller ratio, so it stays centred', () => {
    const box = { x: 340, y: 440, width: 400, height: 200 }
    // 250 / 1080 is the smaller ratio; the centre 540, 540 goes to 150, 125.
    expect(fitted(box, box, { from: square, to: mpu })).toEqual({ x: 103.7, y: 101.85, width: 92.59, height: 46.3 })
  })

  it('keeps a layer inside a copied root where it sits relative to the root’s centre, scaled the same', () => {
    const group = { x: 100, y: 100, width: 400, height: 400 }
    const child = { x: 150, y: 150, width: 100, height: 50 }
    const story = { width: 1080, height: 1920 }
    // To a taller frame the ratios are 1 and 16/9: the root's centre moves down, and nothing scales.
    expect(fitted(group, group, { from: square, to: story })).toEqual({ ...group, y: 333.33 })
    expect(fitted(child, group, { from: square, to: story })).toEqual({ ...child, y: 383.33 })
    // To a smaller frame the child keeps its offset from the root's centre, scaled by 250 / 1080.
    expect(fitted(group, group, { from: square, to: mpu })).toEqual({ x: 37.04, y: 23.15, width: 92.59, height: 92.59 })
    expect(fitted(child, group, { from: square, to: mpu })).toEqual({ x: 48.61, y: 34.72, width: 23.15, height: 11.57 })
  })

  it('keeps every layer inside the frame, and every child inside its root', () => {
    const roots = [
      { x: 0, y: 0, width: 200, height: 200 },
      { x: 880, y: 0, width: 200, height: 300 },
      { x: 0, y: 980, width: 1080, height: 100 },
      { x: 0, y: 0, width: 1080, height: 1080 },
      { x: 500, y: 500, width: 10, height: 10 },
    ]
    for (const to of [mpu, { width: 728, height: 90 }, { width: 1080, height: 1920 }, { width: 8000, height: 1000 }]) {
      for (const root of roots) {
        const child = { x: root.x, y: root.y + root.height / 2, width: root.width / 2, height: root.height / 2 }
        const r = fitted(root, root, { from: square, to })
        const c = fitted(child, root, { from: square, to })
        for (const box of [r, c]) {
          expect(box.x).toBeGreaterThanOrEqual(-0.01)
          expect(box.y).toBeGreaterThanOrEqual(-0.01)
          expect(box.x + box.width).toBeLessThanOrEqual(to.width + 0.01)
          expect(box.y + box.height).toBeLessThanOrEqual(to.height + 0.01)
        }
        expect(c.x).toBeGreaterThanOrEqual(r.x - 0.01)
        expect(c.y + c.height).toBeLessThanOrEqual(r.y + r.height + 0.01)
      }
    }
  })

  it('gives a side 0 long in the frame it fits from the other side’s ratio, or 1 when both are 0 long', () => {
    const line = { x: 100, y: 0, width: 400, height: 0 }
    // 0 high: the height takes the width's ratio, 300 / 1080.
    expect(fitted(line, line, { from: { width: 1080, height: 0 }, to: mpu })).toEqual({
      x: 27.78,
      y: 0,
      width: 111.11,
      height: 0,
    })
    // 0 wide: the width takes the height's ratio, 250 / 1080.
    const upright = { x: 0, y: 100, width: 0, height: 400 }
    expect(fitted(upright, upright, { from: { width: 0, height: 1080 }, to: mpu })).toEqual({
      x: 0,
      y: 23.15,
      width: 0,
      height: 92.59,
    })
    // Both 0 long: nothing scales, and a child keeps its offset from the root's centre.
    const child = { x: 0, y: 0, width: 20, height: 10 }
    const dot = { x: 0, y: 0, width: 0, height: 0 }
    expect(fitted(child, dot, { from: { width: 0, height: 0 }, to: mpu })).toEqual(child)
  })

  it('gives a side 0 long in the frame it fits to the other side’s ratio, or 1 when both are 0 long', () => {
    const box = { x: 340, y: 440, width: 400, height: 200 }
    // 0 high: the height takes the width's ratio, 300 / 1080, so the layer keeps a size.
    expect(fitted(box, box, { from: square, to: { width: 300, height: 0 } })).toEqual({
      x: 94.44,
      y: 122.22,
      width: 111.11,
      height: 55.56,
    })
    // 0 wide: the width takes the height's ratio, 250 / 1080.
    expect(fitted(box, box, { from: square, to: { width: 0, height: 250 } })).toEqual({
      x: 78.7,
      y: 101.85,
      width: 92.59,
      height: 46.3,
    })
    // 0 in the frame it fits from on one side and in the frame it fits to on the other: nothing scales.
    const line = { x: 100, y: 0, width: 400, height: 0 }
    expect(fitted(line, line, { from: { width: 1080, height: 0 }, to: { width: 0, height: 250 } })).toEqual(line)
  })

  it('returns only finite numbers when either frame is 0 wide, 0 high or both', () => {
    const sizes = [square, { width: 1080, height: 0 }, { width: 0, height: 1080 }, { width: 0, height: 0 }]
    const headline = {
      x: 100,
      y: 100,
      width: 400,
      height: 0,
      style: { fontSize: 40 },
      runs: [{ style: { fontSize: 20 } }],
      shrinkToFit: { min: 10, max: 60 },
      layout: { gap: 10, padding: PAD },
    }
    const numbers = (value: unknown): number[] =>
      typeof value === 'number'
        ? [value]
        : value && typeof value === 'object'
          ? Object.values(value).flatMap(numbers)
          : []
    for (const from of sizes) {
      for (const to of sizes) {
        for (const n of numbers(fitted(headline, headline, { from, to }))) expect(Number.isFinite(n)).toBe(true)
      }
    }
  })

  it('scales strokes, corners and effects, and copies rotation and visibility as they are', () => {
    const kept = { rotation: 30, visible: false, opacity: 0.5 }
    const box = {
      x: 100,
      y: 100,
      width: 400,
      height: 300,
      ...kept,
      cornerRadius: [4, 8, 12, 16],
      strokes: [{ paint: black, width: 6, align: 'inside' }],
      effects: [{ type: 'dropShadow', color: '#00000080', x: 0, y: 4, blur: 12, spread: 0 }],
    }
    const { x, y, width, height, cornerRadius, strokes, effects, ...rest } = fitted(box, box, { from: square, to: mpu })
    expect({ x, y, width, height }).toEqual({ x: 37.04, y: 23.15, width: 92.59, height: 69.44 })
    expect({ cornerRadius, strokes, effects }).toEqual({
      cornerRadius: [0.93, 1.85, 2.78, 3.7],
      strokes: [{ paint: black, width: 1.39, align: 'inside' }],
      effects: [{ type: 'dropShadow', color: '#00000080', x: 0, y: 0.93, blur: 2.78, spread: 0 }],
    })
    expect(rest).toEqual(kept)
  })

  it('scales each stroke’s width, dashes and dash offset', () => {
    const strokes = [
      { paint: black, width: 6, align: 'inside', dashes: [10, 4], dashOffset: 3, cap: 'round', miterLimit: 4 },
      { paint: black, width: 1 },
    ]
    expect(at(0.5, { strokes }).strokes).toEqual([
      { ...strokes[0], width: 3, dashes: [5, 2], dashOffset: 1.5 },
      { paint: black, width: 0.5 },
    ])
    expect(at(2, { strokes }).strokes).toEqual([
      { ...strokes[0], width: 12, dashes: [20, 8], dashOffset: 6 },
      { paint: black, width: 2 },
    ])
  })

  it('scales every corner radius: a rect’s and its own corners, a polygon’s, a star’s and a box’s in either form', () => {
    const shapes = [
      { kind: 'rect', cornerRadius: 12 },
      { kind: 'rect', cornerRadius: 0, corners: [4, 8, 12, 16] },
      { kind: 'polygon', sides: 6, cornerRadius: 10 },
      { kind: 'star', points: 5, innerRadius: 0.4, cornerRadius: 10 },
      { kind: 'ellipse' },
    ]
    for (const factor of [0.5, 2]) {
      const s = (n: number) => n * factor
      expect(shapes.map((shape) => at(factor, { shape }).shape)).toEqual([
        { kind: 'rect', cornerRadius: s(12) },
        { kind: 'rect', cornerRadius: 0, corners: [4, 8, 12, 16].map(s) },
        { kind: 'polygon', sides: 6, cornerRadius: s(10) },
        { kind: 'star', points: 5, innerRadius: 0.4, cornerRadius: s(10) },
        { kind: 'ellipse' },
      ])
      expect(at(factor, { cornerRadius: 20 }).cornerRadius).toBe(s(20))
      expect(at(factor, { cornerRadius: [0, 10, 20, 30] }).cornerRadius).toEqual([0, 10, 20, 30].map(s))
    }
  })

  it('scales a drop and an inner shadow’s offset, blur and spread, a glow’s blur and spread, and a blur’s radius', () => {
    const effects = [
      { type: 'dropShadow', color: '#00000080', x: -4, y: 20, blur: 40, spread: -6, showBehind: true },
      { type: 'innerShadow', color: '#00000080', x: 2, y: 4, blur: 8, spread: 6 },
      { type: 'glow', color: '#FFCC00FF', blur: 30, spread: 10 },
      { type: 'layerBlur', radius: 8 },
      { type: 'backgroundBlur', radius: 20 },
    ]
    for (const factor of [0.5, 2]) {
      const s = (n: number) => n * factor
      expect(at(factor, { effects }).effects).toEqual([
        { ...effects[0], x: s(-4), y: s(20), blur: s(40), spread: s(-6) },
        { ...effects[1], x: s(2), y: s(4), blur: s(8), spread: s(6) },
        { ...effects[2], blur: s(30), spread: s(10) },
        { type: 'layerBlur', radius: s(8) },
        { type: 'backgroundBlur', radius: s(20) },
      ])
    }
  })

  it('scales a text’s letter spacing and outline in its style and the runs that set them, and its paragraph spacing', () => {
    const outline = (width: number) => ({ width, color: '#FFFFFFFF' })
    const px = (value: number) => ({ unit: 'px' as const, value })
    const style = { fontFamily: 'Noto Sans', fontSize: 40, color: '#111111FF', letterSpacing: px(2), lineHeight: 1.2 }
    const text = {
      style: { ...style, outline: outline(4) },
      runs: [
        { start: 0, end: 2, style: { letterSpacing: px(-1), outline: outline(2) } },
        { start: 2, end: 4, style: { fontWeight: 800 } },
      ],
      paragraphSpacing: 16,
    }
    for (const factor of [0.5, 2]) {
      const s = (n: number) => n * factor
      expect(at(factor, text)).toMatchObject({
        style: { ...style, fontSize: s(40), letterSpacing: px(s(2)), lineHeight: 1.2, outline: outline(s(4)) },
        runs: [
          { start: 0, end: 2, style: { letterSpacing: px(s(-1)), outline: outline(s(2)) } },
          { start: 2, end: 4, style: { fontWeight: 800 } },
        ],
        paragraphSpacing: s(16),
      })
      expect(at(factor, text).runs[1]).toEqual(text.runs[1])
      expect(at(factor, { style: text.style, runs: text.runs })).not.toHaveProperty('paragraphSpacing')
    }
  })

  it('scales a tiled image’s tile scale inside TILE_SCALE, in fills and strokes, and no fill that does not tile', () => {
    const fills = [image('tile', 0.5), image('tile'), image('fill', 2), black, image('tile', 8)]
    const strokes = [{ paint: image('tile', 0.5), width: 2 }]
    expect(at(0.5, { fills, strokes })).toMatchObject({
      fills: [image('tile', 0.25), image('tile'), image('fill', 2), black, image('tile', 4)],
      strokes: [{ paint: image('tile', 0.25), width: 1 }],
    })
    expect(at(2, { fills, strokes })).toMatchObject({
      fills: [image('tile', 1), image('tile'), image('fill', 2), black, image('tile', 10)],
      strokes: [{ paint: image('tile', 1), width: 4 }],
    })
  })

  it('keeps every size readable scaled down by 1/1000: strokes positive, radii, blurs and widths at least 0', () => {
    const tiny = { width: 1.08, height: 1.08 }
    const card = {
      x: 0,
      y: 0,
      width: 400,
      height: 300,
      shape: { kind: 'rect', cornerRadius: 0, corners: [4, 40, 0, 1] },
      fills: [image('tile', 1)],
      strokes: [{ paint: black, width: 6, dashes: [4, 1], dashOffset: 2 }],
      effects: [
        { type: 'dropShadow', color: '#00000080', x: 0, y: 4, blur: 3, spread: -6 },
        { type: 'innerShadow', color: '#00000080', x: 0, y: 4, blur: 3, spread: 2 },
        { type: 'glow', color: '#00000080', blur: 3, spread: 2 },
        { type: 'layerBlur', radius: 3 },
      ],
    }
    const out = fitted(card, card, { from: square, to: tiny })
    expect(GraphicProps.safeParse(out).success).toBe(true)
    expect(out.strokes).toEqual([{ paint: black, width: 0.01, dashes: [0.01, 0], dashOffset: 0 }])
    expect(out.fills).toEqual([image('tile', 0.01)])
    expect(out.shape).toEqual({ kind: 'rect', cornerRadius: 0, corners: [0, 0.04, 0, 0] })
    expect(out.effects).toEqual([
      { type: 'dropShadow', color: '#00000080', x: 0, y: 0, blur: 0, spread: -0.01 },
      { type: 'innerShadow', color: '#00000080', x: 0, y: 0, blur: 0, spread: 0 },
      { type: 'glow', color: '#00000080', blur: 0, spread: 0 },
      { type: 'layerBlur', radius: 0 },
    ])
    const outline = { width: 3, color: '#FFFFFFFF' }
    const style = {
      fontFamily: 'Noto Sans',
      fontSize: 10,
      color: '#111111FF',
      letterSpacing: { unit: 'px' as const, value: 2 },
      outline,
    }
    const text = { x: 0, y: 0, width: 400, height: 40, text: 'Sale', style, runs: [], paragraphSpacing: 3 }
    const small = fitted(text, text, { from: square, to: tiny })
    expect(TextProps.safeParse(small).success).toBe(true)
    expect(small).toMatchObject({
      style: { fontSize: 0.01, letterSpacing: { unit: 'px', value: 0 }, outline: { width: 0 } },
    })
  })

  it('keeps one dash above 0 when every scaled length would round to 0, the others their share of it', () => {
    const line = { x: 0, y: 0, width: 400, height: 0, strokes: [{ paint: black, width: 2, dashes: [0.5, 0.5] }] }
    const out = fitted(line, line, { from: square, to: { width: 1080 / 160, height: 1080 / 160 } })
    expect(out.strokes).toEqual([{ paint: black, width: 0.01, dashes: [0.01, 0.01] }])
    expect(GraphicProps.shape.strokes.safeParse(out.strokes).success).toBe(true)
  })

  it('scales an auto layout box’s gap and paddings with its size, so its children stay inside it', () => {
    const layout = {
      direction: 'grid',
      columns: 3,
      gap: 40,
      padding: { top: 50, right: 50, bottom: 50, left: 50 },
      justify: 'start',
    }
    // Three 140 × 100 children fill the row exactly: 50 + 140 + 40 + 140 + 40 + 140 + 50 = 600.
    const row = { x: 240, y: 440, width: 600, height: 200, layout }
    const child = (i: number) => ({ x: 290 + i * 180, y: 490, width: 140, height: 100 })
    const fit = { from: square, to: mpu }
    const s = 250 / 1080

    const box = fitted(row, row, fit)

    expect(box.layout).toEqual({
      ...layout,
      gap: 9.26,
      padding: { top: 11.57, right: 11.57, bottom: 11.57, left: 11.57 },
    })
    const children = [0, 1, 2].map((i) => fitted(child(i), row, fit))
    const across = children.reduce((sum, c) => sum + c.width, 0) + 2 * box.layout.gap
    expect(box.layout.padding.left + across + box.layout.padding.right).toBeLessThanOrEqual(box.width + 0.01)
    expect(box.layout.padding.top + (children[0]?.height ?? 0) + box.layout.padding.bottom).toBeLessThanOrEqual(
      box.height + 0.01,
    )
    expect(box.width).toBeCloseTo(600 * s, 1)
  })

  it('scales the room between a box’s lines where it sets one, and leaves it out where it sets none', () => {
    const layout = { direction: 'row', wrap: true, gap: 40, padding: { top: 0, right: 0, bottom: 0, left: 0 } }
    const row = { x: 0, y: 0, width: 1080, height: 200 }
    const half = { from: square, to: { width: 540, height: 540 } }
    expect(fitted({ ...row, layout: { ...layout, lineGap: 30 } }, row, half).layout).toEqual({
      ...layout,
      gap: 20,
      lineGap: 15,
    })
    expect(fitted({ ...row, layout }, row, half).layout).not.toHaveProperty('lineGap')
  })

  it('scales the least and most width and height a layer sets, and leaves out those it sets none of', () => {
    const tile = { x: 0, y: 0, width: 200, height: 100, minWidth: 100, maxWidth: 300, maxHeight: 50 }
    const out = fitted(tile, tile, { from: square, to: { width: 540, height: 540 } })
    expect(out).toMatchObject({ minWidth: 50, maxWidth: 150, maxHeight: 25 })
    expect(out).not.toHaveProperty('minHeight')
  })

  it('scales a text’s font size, its runs’ font sizes where they set one, and its shrink-to-fit sizes', () => {
    const headline = {
      x: 0,
      y: 0,
      width: 1080,
      height: 200,
      text: 'Summer sale',
      style: {
        fontFamily: 'Noto Sans',
        fontSize: 84,
        color: '#111111FF',
        letterSpacing: { unit: 'px' as const, value: 2 },
      },
      runs: [
        { start: 0, end: 6, style: { fontWeight: 800 } },
        { start: 7, end: 11, style: { fontSize: 100 } },
      ],
      shrinkToFit: { min: 20, max: 120 },
      paragraphSpacing: 10,
    }
    const half = { width: 540, height: 1080 }
    expect(fitted(headline, headline, { from: square, to: half })).toEqual({
      ...headline,
      x: 0,
      y: 50,
      width: 540,
      height: 100,
      style: { ...headline.style, fontSize: 42, letterSpacing: { unit: 'px', value: 1 } },
      runs: [
        { start: 0, end: 6, style: { fontWeight: 800 } },
        { start: 7, end: 11, style: { fontSize: 50 } },
      ],
      shrinkToFit: { min: 10, max: 60 },
      paragraphSpacing: 5,
    })
  })

  it('gives a path drawn at its own size its old box as the box it was drawn in, so its drawing scales with it', () => {
    const path = { x: 0, y: 0, width: 108, height: 54, shape: { kind: 'path', d: 'M0 0L108 54' } }
    const half = { width: 540, height: 540 }
    expect(fitted(path, path, { from: square, to: half }).shape).toEqual({
      kind: 'path',
      d: 'M0 0L108 54',
      drawnIn: { width: 108, height: 54 },
    })
    const drawn = { ...path, shape: { ...path.shape, drawnIn: { width: 10, height: 5 } } }
    expect(fitted(drawn, drawn, { from: square, to: half }).shape).toEqual(drawn.shape)
    const ellipse = { ...path, shape: { kind: 'ellipse' } }
    expect(fitted(ellipse, ellipse, { from: square, to: half }).shape).toEqual(ellipse.shape)
  })
})

describe('readableScale', () => {
  const text = (more: object) =>
    TextProps.parse({ x: 0, y: 0, width: 400, height: 100, text: 'Sale ends', style: { ...STYLE_OF_TEXT }, ...more })

  it('leaves the scale of a text whose letters it sets at the readable size or over', () => {
    expect(readableScale(text({}), 0.5, 11)).toBe(0.5)
  })

  it('raises the scale of a text it would set under the readable size so its smallest letters read', () => {
    const props = text({ runs: [{ start: 0, end: 4, style: { fontSize: 30 } }] })
    const t = readableScale(props, 250 / 1080, 11)
    expect(smallestLetters(scaledSizes(props, t), 1)?.size).toBe(11)
  })

  it('sets the smallest letters a shrink to fit draws at its least at the readable size, though each size rounds on its own', () => {
    // At 11 / 31.5 the least, the font size and the run round to 12.57, 27.94 and 24.44, which draw the run at 10.9956.
    const props = text({
      style: { ...STYLE_OF_TEXT, fontSize: 80 },
      runs: [{ start: 0, end: 4, style: { fontSize: 70 } }],
      shrinkToFit: { min: 36, max: 80 },
    })
    const scaled = scaledSizes(props, readableScale(props, 250 / 1080, 11))
    const least = (scaled.shrinkToFit?.min ?? 0) / scaled.style.fontSize
    expect(smallestLetters(scaled, least)?.size).toBeGreaterThanOrEqual(11)
  })
})

describe('scaledSizes', () => {
  it('scales every size a layer holds by a factor and leaves its box for the caller to place', () => {
    const card = {
      x: 100,
      y: 100,
      width: 400,
      height: 300,
      cornerRadius: 40,
      strokes: [{ paint: black, width: 6 }],
      layout: { direction: 'row', gap: 20, padding: PAD },
      minWidth: 200,
    }
    const sizes = scaledSizes(card, 0.5)
    expect(sizes).toEqual({
      ...card,
      cornerRadius: 20,
      strokes: [{ paint: black, width: 3 }],
      layout: { direction: 'row', gap: 10, padding: { top: 5, right: 5, bottom: 5, left: 5 } },
      minWidth: 100,
    })
    const half = fitted(card, card, { from: square, to: { width: 540, height: 540 } })
    expect(half).toEqual({ ...sizes, x: 50, y: 50, width: 200, height: 150 })
  })

  it('changes nothing at a factor of 1 but a path’s box it was drawn in, leaving every size as it is', () => {
    const fine = {
      x: 0,
      y: 0,
      width: 40,
      height: 20,
      shape: { kind: 'rect', cornerRadius: 12.345 },
      strokes: [{ paint: black, width: 0.004, dashes: [0.004, 0.002] }],
      style: { fontSize: 13.333 },
    }
    expect(scaledSizes(fine, 1)).toEqual(fine)
    const path = { x: 0, y: 0, width: 40, height: 20, shape: { kind: 'path', d: 'M0 0L40 20' } }
    expect(scaledSizes(path, 1).shape).toEqual({ ...path.shape, drawnIn: { width: 40, height: 20 } })
  })

  it('gives a negative size scaled to under half a hundredth 0, never -0', () => {
    const shadow = { type: 'dropShadow', color: '#00000080', x: -4, y: -1, blur: 0, spread: -0.4 }
    const sizes = scaledSizes(
      { effects: [shadow], style: { fontSize: 10, letterSpacing: { unit: 'px' as const, value: -1 } } },
      0.001,
    )
    for (const n of [
      sizes.effects[0]?.x,
      sizes.effects[0]?.y,
      sizes.effects[0]?.spread,
      sizes.style.letterSpacing?.value,
    ])
      expect(Object.is(n, 0)).toBe(true)
  })
})
