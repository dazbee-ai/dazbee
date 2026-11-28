// The matchers on pictures drawn by Dazbee's renderer: a text in each script, matched by the text
// matcher in Hybrid, comes back as one text layer in the face it was drawn in; and one picture holding
// a piece of every shape kind, each matched as a shape piece of its job by the shape matcher, comes
// back as the graphics that draw it, with its paint, bound to the brand kit where its colour is the
// kit's: of its own kind, but a line with round caps as the turned rectangle it covers and a dashed
// outline as one path of its dashes. Five free shapes come back as five paths that look the same, and
// a picture of thousands of colours stays a picture.
import { afterAll, describe, expect, it } from 'vitest'

import { looksSame, matchShapes, matchText } from '@dazbee/matchers'
import { textMatcherFiles } from '@dazbee/matchers/test-text-files'
import { lightFonts, lightPieces, textJob } from '@dazbee/matchers/test-text-pieces'
import { type Pixels, renderPixels } from '@dazbee/renderer'
import { loadCanvasKit } from '@dazbee/renderer/node'
import { type MatchAnswer, MatchJob, type Paint, type PictureWhy, type UnplacedLayer } from '@dazbee/schema'

import { encodePng } from './pixels.ts'

const ck = await loadCanvasKit()
const text = await textMatcherFiles()
const textFonts = lightFonts()
/** A text in each script, drawn in a Google face cut to the characters of the text matcher's test. */
const TEXTS = [
  { id: 'latin-plain', face: 'Montserrat|800|normal' },
  { id: 'arabic-plain', face: 'Cairo|600|normal' },
  { id: 'devanagari-plain', face: 'Hind|500|normal' },
]
const NAVY: Paint = { type: 'solid', color: '#1E3A8AFF' }
const CORAL: Paint = { type: 'solid', color: '#F2765AFF' }
/** Each piece's cell in the picture, in rows of four. */
const CELL = 240
const COLUMNS = 4
const HEART =
  'M50 90 C20 65 0 45 0 25 C0 10 12 0 27 0 C38 0 46 7 50 15 C54 7 62 0 73 0 C88 0 100 10 100 25 C100 45 80 65 50 90 Z'

/** A graphic's props in its piece's cell, before the schema's defaults. */
type DrawnProps = { x: number; y: number } & Record<string, unknown>

/** A graphic of an answer. */
type Graphic = Extract<UnplacedLayer, { type: 'graphic' }>

/**
 * A piece: what it is, its graphics' props in its cell, and what it should come back as: graphics of these kinds,
 * which `check` reads with the piece's own pixels, or a picture and why.
 */
interface ShapePiece {
  name: string
  graphics: DrawnProps[]
  kinds: string[]
  why?: PictureWhy
  check?: (graphics: Graphic[], piece: Pixels) => void
}

const PIECES: ShapePiece[] = [
  {
    name: 'a rectangle',
    graphics: [{ x: 20, y: 40, width: 140, height: 100, shape: { kind: 'rect', cornerRadius: 0 }, fills: [NAVY] }],
    kinds: ['rect'],
    check: ([rect]) => expect(rect?.bindings).toEqual({ fill: 'brand:primary' }),
  },
  {
    name: 'a rounded rectangle',
    graphics: [{ x: 20, y: 40, width: 140, height: 100, shape: { kind: 'rect', cornerRadius: 18 }, fills: [CORAL] }],
    kinds: ['rect'],
    check: ([rect]) => expect(rect?.props.shape).toMatchObject({ cornerRadius: expect.closeTo(18, 0) }),
  },
  {
    name: 'an ellipse',
    graphics: [{ x: 20, y: 40, width: 140, height: 90, shape: { kind: 'ellipse' }, fills: [NAVY] }],
    kinds: ['ellipse'],
  },
  {
    name: 'a turned line',
    graphics: [
      {
        x: 30,
        y: 78,
        width: 180,
        height: 8,
        rotation: 15,
        shape: { kind: 'line', start: 'none', end: 'none' },
        strokes: [{ paint: NAVY, width: 8, align: 'center', cap: 'butt' }],
      },
    ],
    kinds: ['line'],
    check: ([line]) => {
      expect(line?.props).toMatchObject({ rotation: expect.closeTo(15, 0) })
      expect(line?.props.strokes[0]).toMatchObject({ width: expect.closeTo(8, 0) })
    },
  },
  {
    name: 'a turned line with round caps',
    graphics: [
      {
        x: 30,
        y: 78,
        width: 180,
        height: 4,
        rotation: 15,
        shape: { kind: 'line', start: 'none', end: 'none' },
        strokes: [{ paint: NAVY, width: 4, align: 'center', cap: 'round' }],
      },
    ],
    kinds: ['rect'],
    // The caps reach half the stroke's width past each end of the line.
    check: ([pill]) =>
      expect(pill?.props).toMatchObject({
        width: expect.closeTo(184, -0.5),
        height: expect.closeTo(4, 0),
        rotation: expect.closeTo(15, 0),
      }),
  },
  {
    name: 'a ring',
    graphics: [
      {
        x: 30,
        y: 30,
        width: 120,
        height: 120,
        shape: { kind: 'ellipse' },
        strokes: [{ paint: CORAL, width: 12, align: 'inside' }],
      },
    ],
    kinds: ['ellipse'],
    check: ([ring]) => {
      expect(ring?.props.fills).toEqual([])
      expect(ring?.props.strokes[0]).toMatchObject({ align: 'inside', width: expect.closeTo(12, -0.5) })
    },
  },
  {
    name: 'a hexagon',
    graphics: [
      { x: 30, y: 30, width: 120, height: 120, shape: { kind: 'polygon', sides: 6, cornerRadius: 0 }, fills: [NAVY] },
    ],
    kinds: ['polygon'],
    check: ([hexagon]) => expect(hexagon?.props.shape).toMatchObject({ sides: 6 }),
  },
  {
    name: 'a starburst',
    graphics: [
      {
        x: 30,
        y: 30,
        width: 120,
        height: 120,
        shape: { kind: 'star', points: 16, innerRadius: 0.8, cornerRadius: 0 },
        fills: [CORAL],
      },
    ],
    kinds: ['star'],
    check: ([star]) => expect(star?.props.shape).toMatchObject({ points: 16 }),
  },
  {
    name: 'a heart',
    graphics: [
      {
        x: 30,
        y: 30,
        width: 120,
        height: 120,
        shape: { kind: 'path', d: HEART, fillRule: 'nonzero', drawnIn: { width: 100, height: 100 } },
        fills: [CORAL],
      },
    ],
    kinds: ['path'],
  },
  {
    name: 'a linear gradient',
    graphics: [
      {
        x: 20,
        y: 50,
        width: 140,
        height: 80,
        shape: { kind: 'rect', cornerRadius: 0 },
        fills: [
          {
            type: 'linear',
            from: { x: 0, y: 0 },
            to: { x: 1, y: 0 },
            stops: [
              { offset: 0, color: '#2563EBFF' },
              { offset: 1, color: '#93C5FDFF' },
            ],
          },
        ],
      },
    ],
    kinds: ['rect'],
    check: ([rect]) => expect(rect?.props.fills[0]).toMatchObject({ type: 'linear' }),
  },
  {
    name: 'a dashed outline',
    graphics: [
      {
        x: 20,
        y: 40,
        width: 140,
        height: 100,
        shape: { kind: 'rect', cornerRadius: 0 },
        strokes: [{ paint: CORAL, width: 4, align: 'inside', dashes: [12, 6] }],
      },
    ],
    kinds: ['path'],
    check: ([dashes]) => {
      expect(dashes?.props.fills).toEqual([CORAL])
      expect(dashes?.props.strokes).toEqual([])
    },
  },
  {
    name: 'a radial gradient',
    graphics: [
      {
        x: 30,
        y: 30,
        width: 120,
        height: 120,
        shape: { kind: 'ellipse' },
        fills: [
          {
            type: 'radial',
            center: { x: 0.5, y: 0.5 },
            radius: 0.5,
            stops: [
              { offset: 0, color: '#BFDBFEFF' },
              { offset: 1, color: '#2563EBFF' },
            ],
          },
        ],
      },
    ],
    kinds: ['ellipse'],
    check: ([disc]) => expect(disc?.props.fills[0]).toMatchObject({ type: 'radial' }),
  },
  {
    name: 'five free shapes',
    graphics: [
      freeShape(75, 75, 68, 1, '#2E9E4FFF'),
      freeShape(165, 75, 68, 2, '#F47B20FF'),
      freeShape(75, 165, 68, 3, '#2563EBFF'),
      freeShape(165, 165, 68, 4, '#D61F8CFF'),
      freeShape(120, 120, 45, 5, '#FBD72BFF'),
    ],
    kinds: ['path', 'path', 'path', 'path', 'path'],
    check: (paths, piece) => expect(looksSame('shape', piece, drawnAlone(paths)).same).toBe(true),
  },
  {
    name: 'a picture of thousands of colours',
    graphics: [
      {
        x: 20,
        y: 20,
        width: 200,
        height: 200,
        shape: { kind: 'rect', cornerRadius: 0 },
        fills: [
          {
            type: 'linear',
            from: { x: 0, y: 0 },
            to: { x: 1, y: 0 },
            stops: ['#FF0000FF', '#FFFF00FF', '#00FF00FF', '#00FFFFFF', '#0000FFFF', '#FF00FFFF', '#FF0000FF'].map(
              (color, i) => ({ offset: i / 6, color }),
            ),
          },
          {
            type: 'linear',
            from: { x: 0, y: 0 },
            to: { x: 0, y: 1 },
            stops: [
              { offset: 0, color: '#FFFFFFFF' },
              { offset: 0.5, color: '#FFFFFF00' },
              { offset: 0.5, color: '#00000000' },
              { offset: 1, color: '#000000FF' },
            ],
          },
        ],
      },
    ],
    kinds: [],
    why: 'tooManyParts',
  },
  {
    name: 'a circle over a rectangle',
    graphics: [
      { x: 20, y: 50, width: 120, height: 90, shape: { kind: 'rect', cornerRadius: 0 }, fills: [NAVY] },
      { x: 100, y: 30, width: 60, height: 60, shape: { kind: 'ellipse' }, fills: [CORAL] },
    ],
    kinds: ['rect', 'ellipse'],
  },
]

/** Piece i's cell's top left in the picture. */
const cellOf = (i: number) => ({ x: (i % COLUMNS) * CELL, y: Math.floor(i / COLUMNS) * CELL })

/** The picture: every piece's graphics in its own cell. */
const PICTURE = renderPixels(
  ck,
  {
    meta: { designId: 'shape-pieces', name: 'Shape pieces' },
    pages: { p: { name: 'Page 1', order: 'a0' } },
    frames: {
      f: {
        pageId: 'p',
        name: 'Pieces',
        width: CELL * COLUMNS,
        height: CELL * Math.ceil(PIECES.length / COLUMNS),
        x: 0,
        y: 0,
        fills: [],
        order: 'a0',
      },
    },
    nodes: Object.fromEntries(
      PIECES.flatMap((piece, i) =>
        piece.graphics.map((props, j) => {
          const id = `n${i}_${j}`
          const node = {
            type: 'graphic',
            parentId: 'f',
            link: id,
            index: `a${String(i).padStart(2, '0')}${j}`,
            name: piece.name,
            props: {
              rotation: 0,
              fills: [],
              strokes: [],
              ...props,
              x: props.x + cellOf(i).x,
              y: props.y + cellOf(i).y,
            },
          }
          return [id, node]
        }),
      ),
    ),
  },
  'f',
  { fonts: [], fallbackFamilies: [], images: {} },
)
const JOB = MatchJob.parse({
  picture: Buffer.from(encodePng(ck, PICTURE)).toString('base64'),
  pieces: PIECES.map((_, i) => ({ kind: 'shape', rect: { ...cellOf(i), width: CELL, height: CELL } })),
  kit: { colors: { primary: '#1E3A8AFF' }, fonts: {}, textStyles: [] },
})

afterAll(() => text.model.release())

describe('matchText', () => {
  const pieces = lightPieces(ck, textFonts)
  it.each(TEXTS)('gives the $id text back as one text layer in $face', async ({ id, face }) => {
    const drawn = pieces.find((piece) => piece.id === id)
    if (!drawn) throw new Error(`no text ${id}`)
    expect(drawn.key).toBe(face)
    const { job, piece } = textJob(ck, drawn.pixels, drawn.words)
    const deps = { ck, ...text, fonts: { face: async (key: string) => textFonts.get(key) ?? null } }
    const answer = await matchText(job, piece, deps)
    expect(await matchText(job, piece, deps)).toEqual(answer)
    if (answer.kind !== 'layers') throw new Error(`a picture: ${answer.why}`)
    const [layer] = answer.layers
    if (layer?.type !== 'text') throw new Error('no text layer')
    const { style } = layer.props
    expect(`${style.fontFamily}|${style.fontWeight}|${style.fontStyle}`).toBe(face)
    expect(layer.props.text).toBe(drawn.words)
  })
})

describe('matchShapes', () => {
  it.each(PIECES.map((piece, i) => ({ ...piece, i })))('answers $name as expected', ({ i, kinds, why, check }) => {
    const piece = JOB.pieces[i]
    if (!piece) throw new Error('no piece')
    const answer = matchShapes(ck, JOB, piece)
    expect(matchShapes(ck, JOB, piece)).toEqual(answer)
    if (why) {
      expect(answer).toMatchObject({ kind: 'picture', why })
      return
    }
    const graphics = graphicsOf(answer)
    expect(graphics.map((graphic) => graphic.props.shape.kind)).toEqual(kinds)
    check?.(graphics, cellPixels(i))
  })
})

/** An answer's graphics, back to front; fails a picture's answer. */
function graphicsOf(answer: MatchAnswer): Graphic[] {
  if (answer.kind !== 'layers') throw new Error(`a picture: ${answer.why}, far ${answer.scores?.far}`)
  return answer.layers.flatMap((layer) => (layer.type === 'graphic' ? [layer] : []))
}

/** Piece i's own pixels: its cell of the picture. */
function cellPixels(i: number): Pixels {
  const { x, y } = cellOf(i)
  const pixels = new Uint8Array(CELL * CELL * 4)
  for (let row = 0; row < CELL; row++) {
    const from = ((y + row) * PICTURE.width + x) * 4
    pixels.set(PICTURE.pixels.subarray(from, from + CELL * 4), row * CELL * 4)
  }
  return { width: CELL, height: CELL, pixels }
}

/** An answer's graphics drawn alone in a cell, back to front. */
function drawnAlone(graphics: readonly Graphic[]): Pixels {
  return renderPixels(
    ck,
    {
      meta: { designId: 'rebuilt-piece', name: 'Rebuilt piece' },
      pages: { p: { name: 'Page 1', order: 'a0' } },
      frames: { f: { pageId: 'p', name: 'Piece', width: CELL, height: CELL, x: 0, y: 0, fills: [], order: 'a0' } },
      nodes: Object.fromEntries(
        graphics.map((graphic, j) => [`n${j}`, { ...graphic, parentId: 'f', link: `n${j}`, index: `a${j}` }]),
      ),
    },
    'f',
    { fonts: [], fallbackFamilies: [], images: {} },
  )
}

/** A free shape of 14 corners at varied reach, in a box round its centre. */
function freeShape(cx: number, cy: number, r: number, seed: number, color: `#${string}`): DrawnProps {
  const corners = Array.from({ length: 14 }, (_, i) => {
    const a = (i / 14) * 2 * Math.PI
    const reach = 0.7 + 0.3 * Math.abs(Math.sin(seed * (i + 1) * 1.7))
    return `${(50 + 50 * reach * Math.cos(a)).toFixed(2)} ${(50 + 50 * reach * Math.sin(a)).toFixed(2)}`
  })
  return {
    x: cx - r,
    y: cy - r,
    width: 2 * r,
    height: 2 * r,
    shape: { kind: 'path', d: `M${corners.join(' L')} Z`, fillRule: 'nonzero', drawnIn: { width: 100, height: 100 } },
    fills: [{ type: 'solid', color }],
  }
}
