import { describe, expect, it } from 'vitest'

import { loadCanvasKit } from '@dazbee/renderer/node'
import { type GraphicProps, type MatchAnswer, MatchJob, type Paint, type Shape } from '@dazbee/schema'

import { drawGraphics, type ShapeLayer } from './draw-layers.ts'
import { fullPass, fullPassOf } from './full-pass.ts'
import { blob, graphic, pngBase64, prototypeAnswer, prototypeFullPieces } from './test-pieces.ts'

const ck = await loadCanvasKit()
const NAVY: Paint = { type: 'solid', color: '#1E3A8AFF' }
const CORAL: Paint = { type: 'solid', color: '#F2765AFF' }
const BOX = { x: 20, y: 20, width: 120, height: 120 }

/** A path drawn in a 100 × 100 box, scaled to the graphic's. */
const path = (d: string): Shape => ({ kind: 'path', d, fillRule: 'nonzero', drawnIn: { width: 100, height: 100 } })

/** A piece of graphics drawn by Dazbee, rebuilt twice: the two answers are one, and the first is returned. */
const rebuilt = (layers: readonly ShapeLayer[], width = 160, height = 160): MatchAnswer => {
  const piece = drawGraphics(ck, layers, width, height)
  const answer = fullPassOf(ck, piece, {})
  expect(fullPassOf(ck, piece, {})).toEqual(answer)
  return answer
}

/** The answer's one graphic; fails a picture's answer and an answer of more graphics. */
const onlyGraphic = (answer: MatchAnswer): GraphicProps => {
  if (answer.kind !== 'layers') throw new Error(`a picture: ${answer.why}, far ${answer.scores?.far}`)
  expect(answer.layers).toHaveLength(1)
  const layer = answer.layers[0]
  if (layer?.type !== 'graphic') throw new Error(`a ${layer?.type}`)
  return layer.props
}

const linear = (from: string, to: string, end = { x: 1, y: 0 }): Paint => ({
  type: 'linear',
  from: { x: 0, y: 0 },
  to: end,
  stops: [
    { offset: 0, color: from as `#${string}` },
    { offset: 1, color: to as `#${string}` },
  ],
})

const PROTOTYPE = prototypeFullPieces(ck)

describe('fullPass', () => {
  it('rebuilds the piece of a job’s picture under its rect', () => {
    const picture = drawGraphics(
      ck,
      [
        graphic(
          { kind: 'polygon', sides: 6, cornerRadius: 0 },
          { x: 260, y: 30, width: 120, height: 120 },
          { fill: NAVY },
        ),
      ],
      420,
      180,
    )
    const job = MatchJob.parse({
      picture: pngBase64(ck, picture),
      pieces: [{ kind: 'shape', rect: { x: 240, y: 10, width: 160, height: 160 } }],
      kit: { colors: {}, fonts: {}, textStyles: [] },
    })
    const piece = job.pieces[0]
    if (!piece) throw new Error('no piece')
    const answer = fullPass(ck, job, piece)
    expect(fullPass(ck, job, piece)).toEqual(answer)
    const hexagon = onlyGraphic(answer)
    expect(hexagon.shape).toMatchObject({ kind: 'polygon', sides: 6 })
    expect(hexagon.x).toBeCloseTo(20, 0)
  })
})

describe('fullPassOf', () => {
  it('rebuilds a star as a star with its points', () => {
    const star = onlyGraphic(
      rebuilt(
        [
          graphic(
            { kind: 'star', points: 5, innerRadius: 0.4, cornerRadius: 0 },
            { x: 10, y: 10, width: 150, height: 150 },
            { fill: CORAL },
          ),
        ],
        170,
        170,
      ),
    )
    expect(star.shape).toMatchObject({ kind: 'star', points: 5, innerRadius: expect.closeTo(0.4, 1) })
    expect(star.fills).toEqual([CORAL])
  })

  it('rebuilds a starburst as a star with its points', () => {
    const burst = onlyGraphic(
      rebuilt([graphic({ kind: 'star', points: 16, innerRadius: 0.8, cornerRadius: 0 }, BOX, { fill: CORAL })]),
    )
    expect(burst.shape).toMatchObject({ kind: 'star', points: 16, innerRadius: expect.closeTo(0.8, 1) })
  })

  it('rebuilds a 17-point star with 17 points, not 20', () => {
    const star = onlyGraphic(
      rebuilt([graphic({ kind: 'star', points: 17, innerRadius: 0.75, cornerRadius: 0 }, BOX, { fill: NAVY })]),
    )
    expect(star.shape).toMatchObject({ kind: 'star', points: 17 })
  })

  it('rebuilds polygons as polygons with their sides', () => {
    const hexagon = onlyGraphic(rebuilt([graphic({ kind: 'polygon', sides: 6, cornerRadius: 0 }, BOX, { fill: NAVY })]))
    expect(hexagon.shape).toMatchObject({ kind: 'polygon', sides: 6 })
    const triangle = onlyGraphic(
      rebuilt([graphic({ kind: 'polygon', sides: 3, cornerRadius: 0 }, BOX, { fill: NAVY })]),
    )
    expect(triangle.shape).toMatchObject({ kind: 'polygon', sides: 3 })
  })

  it.each([
    [
      'a heart',
      'M50 90 C20 65 0 45 0 25 C0 10 12 0 27 0 C38 0 46 7 50 15 C54 7 62 0 73 0 C88 0 100 10 100 25 C100 45 80 65 50 90 Z',
    ],
    ['an arrow', 'M0 35 H60 V10 L100 50 L60 90 V65 H0 Z'],
    ['a check', 'M5 55 L20 40 L40 60 L80 15 L95 30 L40 90 Z'],
    [
      'a speech bubble',
      'M10 0 H90 C96 0 100 4 100 10 V60 C100 66 96 70 90 70 H40 L20 95 L25 70 H10 C4 70 0 66 0 60 V10 C0 4 4 0 10 0 Z',
    ],
  ])('rebuilds %s as one traced path in its colour', (_, d) => {
    const traced = onlyGraphic(rebuilt([graphic(path(d), BOX, { fill: CORAL })]))
    expect(traced.shape).toMatchObject({ kind: 'path', fillRule: 'evenodd' })
    expect(traced.fills).toEqual([CORAL])
  })

  it('keeps an irregular burst a traced path, as no star holds it', () => {
    const radii = [50, 30, 46, 36, 50, 28, 42, 34, 48, 26, 44, 38, 50, 32]
    const corners = radii.map((r, i) => {
      const a = (i / radii.length) * 2 * Math.PI - Math.PI / 2
      return `${(50 + r * Math.cos(a)).toFixed(2)} ${(50 + r * Math.sin(a)).toFixed(2)}`
    })
    const burst = onlyGraphic(rebuilt([graphic(path(`M${corners.join(' L')} Z`), BOX, { fill: CORAL })]))
    expect(burst.shape.kind).toBe('path')
  })

  it('draws many small marks of one colour as one traced path', () => {
    const marks = [0, 1, 2, 3].flatMap((i) =>
      [0, 1].map((j) =>
        graphic(
          { kind: 'rect', cornerRadius: 0 },
          { x: 10 + i * 30, y: 10 + j * 30, width: 12, height: 12 },
          { fill: CORAL },
        ),
      ),
    )
    const answer = rebuilt(
      [graphic({ kind: 'rect', cornerRadius: 0 }, { x: 0, y: 0, width: 140, height: 70 }, { fill: NAVY }), ...marks],
      140,
      70,
    )
    if (answer.kind !== 'layers') throw new Error(`a picture: ${answer.why}`)
    expect(
      answer.layers.map((layer) => layer.type === 'graphic' && [layer.props.shape.kind, layer.props.fills]),
    ).toEqual([
      ['rect', [NAVY]],
      ['path', [CORAL]],
    ])
  })

  it('rebuilds a ribbon as one traced path', () => {
    const ribbon = onlyGraphic(
      rebuilt(
        [
          graphic(
            path('M0 0 H100 L85 25 L100 50 H0 L15 25 Z'),
            { x: 10, y: 10, width: 160, height: 80 },
            { fill: NAVY },
          ),
        ],
        180,
        60,
      ),
    )
    expect(ribbon.shape.kind).toBe('path')
  })

  it('rebuilds a button’s drop shadow as its drop shadow', () => {
    const button = graphic({ kind: 'rect', cornerRadius: 9 }, { x: 10, y: 10, width: 110, height: 36 }, { fill: NAVY })
    const shadow = { type: 'dropShadow', x: 3, y: 4, blur: 6, spread: 0, color: '#00000066' } as const
    const rect = onlyGraphic(rebuilt([{ ...button, props: { ...button.props, effects: [shadow] } }], 140, 66))
    expect(rect.shape).toMatchObject({ kind: 'rect', cornerRadius: expect.closeTo(9, 0) })
    expect(rect.fills).toEqual([NAVY])
    expect(rect.effects).toEqual([
      expect.objectContaining({ type: 'dropShadow', x: expect.closeTo(3, 0), y: expect.closeTo(4, 0) }),
    ])
  })

  it('rebuilds a linear gradient across a rectangle as one running across it', () => {
    const across = onlyGraphic(
      rebuilt(
        [
          graphic(
            { kind: 'rect', cornerRadius: 0 },
            { x: 10, y: 10, width: 120, height: 70 },
            { fill: linear('#2563EBFF', '#93C5FDFF') },
          ),
        ],
        140,
        90,
      ),
    )
    expect(across.fills[0]).toMatchObject({ type: 'linear', from: { y: 0.5 }, to: { y: 0.5 } })
  })

  it('rebuilds a linear gradient down a rounded rectangle as one running down it', () => {
    const down = onlyGraphic(
      rebuilt(
        [
          graphic(
            { kind: 'rect', cornerRadius: 8 },
            { x: 10, y: 10, width: 120, height: 70 },
            { fill: linear('#7C3AEDFF', '#C4B5FDFF', { x: 0, y: 1 }) },
          ),
        ],
        140,
        90,
      ),
    )
    expect(down.fills[0]).toMatchObject({ type: 'linear', from: { x: 0.5 }, to: { x: 0.5 } })
  })

  it('rebuilds a radial gradient as a radial gradient', () => {
    const disc = onlyGraphic(
      rebuilt(
        [
          graphic(
            { kind: 'ellipse' },
            { x: 10, y: 10, width: 100, height: 100 },
            {
              fill: {
                type: 'radial',
                center: { x: 0.5, y: 0.5 },
                radius: 0.5,
                stops: [
                  { offset: 0, color: '#BFDBFEFF' },
                  { offset: 1, color: '#2563EBFF' },
                ],
              },
            },
          ),
        ],
        120,
        120,
      ),
    )
    expect(disc.shape.kind).toBe('ellipse')
    expect(disc.fills[0]).toMatchObject({
      type: 'radial',
      center: { x: expect.closeTo(0.5, 1), y: expect.closeTo(0.5, 1) },
    })
  })

  it.each(PROTOTYPE)('gives the prototype’s full-pass answer for $id, a $degradation $family', (piece) => {
    const answer = fullPassOf(ck, piece.pixels, piece.kit)
    expect(fullPassOf(ck, piece.pixels, piece.kit)).toEqual(answer)
    expect(answer).toEqual(prototypeAnswer(piece.fullPass))
  })

  it('keeps a painted scene of five free shapes a picture, as a photo', () => {
    const answer = rebuilt([
      blob(50, 50, 45, 1, '#2E9E4FFF'),
      blob(110, 50, 45, 2, '#F47B20FF'),
      blob(50, 110, 45, 3, '#2563EBFF'),
      blob(110, 110, 45, 4, '#D61F8CFF'),
      blob(80, 80, 30, 5, '#FBD72BFF'),
    ])
    expect(answer).toMatchObject({ kind: 'picture', why: 'photo' })
  })

  it('is checked against the prototype on every kind the full pass adds and every reason but a scene a piece stays a picture', () => {
    const kinds = new Set(
      PROTOTYPE.flatMap((piece) => JSON.stringify(piece.fullPass.layers).match(/"kind":"\w+"/g) ?? []),
    )
    expect([...kinds].sort()).toEqual(expect.arrayContaining(['"kind":"path"', '"kind":"polygon"', '"kind":"star"']))
    const all = JSON.stringify(PROTOTYPE.map((piece) => piece.fullPass))
    for (const word of ['"linear"', '"radial"', '"dropShadow"', '"brand:', '"dashes"']) expect(all).toContain(word)
    const whys = new Set(
      PROTOTYPE.map((piece) => prototypeAnswer(piece.fullPass)).map((a) => (a.kind === 'picture' ? a.why : 'layers')),
    )
    expect(whys).toEqual(new Set(['layers', 'looksDifferent', 'tooManyParts']))
  })
})
