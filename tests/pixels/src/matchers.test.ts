// The matchers on pictures drawn by Dazbee's renderer: one picture holding a piece of every shape kind,
// each matched as a shape piece of its job by the shape matcher's ladder, comes back as graphics of
// that kind with its paint.
import { describe, expect, it } from 'vitest'

import { matchShapes } from '@dazbee/matchers'
import { renderPixels } from '@dazbee/renderer'
import { loadCanvasKit } from '@dazbee/renderer/node'
import { type GraphicProps, type MatchAnswer, MatchJob, type Paint } from '@dazbee/schema'

import { encodePng } from './pixels.ts'

const ck = await loadCanvasKit()
const NAVY: Paint = { type: 'solid', color: '#1E3A8AFF' }
const CORAL: Paint = { type: 'solid', color: '#F2765AFF' }
/** Each piece's cell in the picture, in rows of four. */
const CELL = 240
const COLUMNS = 4
const HEART =
  'M50 90 C20 65 0 45 0 25 C0 10 12 0 27 0 C38 0 46 7 50 15 C54 7 62 0 73 0 C88 0 100 10 100 25 C100 45 80 65 50 90 Z'

/** A graphic's props in its piece's cell, before the schema's defaults. */
type DrawnProps = { x: number; y: number } & Record<string, unknown>

/** A piece: what it is, its graphics' props in its cell, and what it should come back as. */
interface ShapePiece {
  name: string
  graphics: DrawnProps[]
  kinds: string[]
  check?: (graphics: GraphicProps[]) => void
}

const PIECES: ShapePiece[] = [
  {
    name: 'a rectangle',
    graphics: [{ x: 20, y: 40, width: 140, height: 100, shape: { kind: 'rect', cornerRadius: 0 }, fills: [NAVY] }],
    kinds: ['rect'],
  },
  {
    name: 'a rounded rectangle',
    graphics: [{ x: 20, y: 40, width: 140, height: 100, shape: { kind: 'rect', cornerRadius: 18 }, fills: [CORAL] }],
    kinds: ['rect'],
    check: ([rect]) => expect(rect?.shape).toMatchObject({ cornerRadius: expect.closeTo(18, 0) }),
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
        height: 4,
        rotation: 15,
        shape: { kind: 'line', start: 'none', end: 'none' },
        strokes: [{ paint: NAVY, width: 4, align: 'center', cap: 'round' }],
      },
    ],
    kinds: ['line'],
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
      expect(ring?.fills).toEqual([])
      expect(ring?.strokes[0]).toMatchObject({ align: 'inside', width: expect.closeTo(12, -0.5) })
    },
  },
  {
    name: 'a hexagon',
    graphics: [
      { x: 30, y: 30, width: 120, height: 120, shape: { kind: 'polygon', sides: 6, cornerRadius: 0 }, fills: [NAVY] },
    ],
    kinds: ['polygon'],
    check: ([hexagon]) => expect(hexagon?.shape).toMatchObject({ sides: 6 }),
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
    check: ([star]) => expect(star?.shape).toMatchObject({ points: 16 }),
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
    check: ([rect]) => expect(rect?.fills[0]).toMatchObject({ type: 'linear' }),
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
    kinds: ['rect'],
    check: ([rect]) => {
      expect(rect?.fills).toEqual([])
      expect(rect?.strokes[0]?.dashes).toHaveLength(2)
    },
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
  kit: { colors: {}, fonts: {}, textStyles: [] },
})

describe('matchShapes', () => {
  it.each(PIECES.map((piece, i) => ({ ...piece, i })))(
    'rebuilds $name as graphics of its kind',
    ({ i, kinds, check }) => {
      const piece = JOB.pieces[i]
      if (!piece) throw new Error('no piece')
      const answer = matchShapes(ck, JOB, piece)
      expect(matchShapes(ck, JOB, piece)).toEqual(answer)
      const graphics = graphicsOf(answer)
      expect(graphics.map((graphic) => graphic.shape.kind)).toEqual(kinds)
      check?.(graphics)
    },
  )
})

/** An answer's graphics' props, back to front; fails a picture's answer. */
function graphicsOf(answer: MatchAnswer): GraphicProps[] {
  if (answer.kind !== 'layers') throw new Error(`a picture: ${answer.why}, far ${answer.scores?.far}`)
  return answer.layers.flatMap((layer) => (layer.type === 'graphic' ? [layer.props] : []))
}
