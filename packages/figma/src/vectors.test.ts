import { describe, expect, it } from 'vitest'

import type { Matrix } from '@dazbee/svg'

import { box, frame, node, onePage, outline, placedAt, solid, type TestNode, vector } from './test-figma.ts'
import { built, childrenOf, ck, countOf, imported, layersOf, linesOf, onlyFrame } from './test-import.ts'

const FRAME_AT: Matrix = [1, 0, 0, 1, 0, 0]
const AT: Matrix = [1, 0, 0, 1, 10, 20]
const closed = 'M0 0L20 10L40 0Z'
const ring = 'M0 0L40 0L40 10L0 10ZM10 2L30 2L30 8L10 8Z'
const strokeOutline = 'M0 -1L20 9L40 -1L40 1L20 11L0 1Z'
const red = solid('#ff0000')
const blue = solid('#0000ff')

const inFrame = (children: TestNode[]) =>
  onePage([frame('1:1', box(0, 0, 400, 300), children, placedAt(FRAME_AT, 400, 300))])
const v = (extra: Record<string, unknown>) => vector('1:2', AT, 40, 10, extra, FRAME_AT)

describe('outlinesOf', () => {
  it('makes a stroke-only vector its stroke’s outline, filled with the stroke paints', () => {
    const text = inFrame([
      v({ fillGeometry: [outline(closed)], strokeGeometry: [outline(strokeOutline)], strokes: [red], strokeWeight: 2 }),
    ])
    const nodes = layersOf(onlyFrame(text))
    expect(Object.keys(nodes)).toEqual(['1-2'])
    expect(nodes['1-2']).toMatchObject({
      type: 'graphic',
      name: 'Vector 1:2',
      props: { x: 10, y: 20, width: 40, height: 10, shape: { kind: 'path', d: strokeOutline, fillRule: 'nonzero' } },
    })
    expect(built(text).paints['1-2']).toEqual({ fills: [red], handles: expect.anything(), node: expect.anything() })
    expect(linesOf(text)).toEqual(['vector-strokes-outlined'])
  })

  it('makes a filled open vector with a stroke a fill and an outline, with no stroke along its closing edge', () => {
    const text = inFrame([
      v({
        fillGeometry: [outline(closed)],
        strokeGeometry: [outline(strokeOutline)],
        fills: [blue],
        strokes: [red],
        strokeWeight: 2,
      }),
    ])
    const nodes = layersOf(onlyFrame(text))
    expect(nodes['1-2']).toMatchObject({
      type: 'group',
      name: 'Vector 1:2',
      props: { x: 10, y: 20, width: 40, height: 10 },
    })
    const [fill, stroke] = childrenOf(nodes, '1-2')
    expect(nodes[fill ?? '']?.props).toMatchObject({ x: 10, y: 20, shape: { kind: 'path', d: closed } })
    expect(nodes[stroke ?? '']?.props).toMatchObject({ x: 10, y: 20, shape: { kind: 'path', d: strokeOutline } })
    const { paints } = built(text)
    expect(paints[fill ?? '']).toEqual({ fills: [blue], handles: expect.anything(), node: expect.anything() })
    expect(paints[stroke ?? '']).toEqual({ fills: [red], handles: expect.anything(), node: expect.anything() })
    expect(imported(text).converted.report.items).toEqual([
      { line: 'vector-strokes-outlined', kind: 'changed', count: 1, nodes: [{ id: '1:2', name: 'Vector 1:2' }] },
    ])
    expect(onlyFrame(text).figmaIds).toEqual({ '1-2': '1:2' })
  })

  it('keeps a vector with hidden strokes, or strokes of no width, as its fill alone', () => {
    const stroked = { fillGeometry: [outline(closed)], strokeGeometry: [outline(strokeOutline)], fills: [blue] }
    for (const strokes of [
      { strokes: [{ ...red, visible: false }], strokeWeight: 2 },
      { strokes: [red], strokeWeight: 0 },
    ]) {
      const text = inFrame([v({ ...stroked, ...strokes })])
      expect(layersOf(onlyFrame(text))['1-2']).toMatchObject({ type: 'graphic', props: { shape: { d: closed } } })
      expect(linesOf(text)).toEqual([])
    }
  })

  it('joins outlines that share a winding rule into one graphic', () => {
    const text = inFrame([
      v({ fillGeometry: [outline('M0 0L10 0L10 10Z'), outline('M20 0L30 0L30 10Z')], fills: [red] }),
    ])
    expect(layersOf(onlyFrame(text))['1-2']?.props).toMatchObject({
      shape: { kind: 'path', d: 'M0 0L10 0L10 10ZM20 0L30 0L30 10Z', fillRule: 'nonzero' },
    })
  })

  it('makes each outline of mixed winding rules a graphic of its own, in file order', () => {
    const text = inFrame([v({ fillGeometry: [outline(ring, 'EVENODD'), outline('M0 0L5 0L5 5Z')], fills: [red] })])
    const nodes = layersOf(onlyFrame(text))
    expect(nodes['1-2']?.type).toBe('group')
    const kids = childrenOf(nodes, '1-2').map((k) => nodes[k]?.props)
    expect(kids).toMatchObject([
      { shape: { d: ring, fillRule: 'evenodd' } },
      { shape: { d: 'M0 0L5 0L5 5Z', fillRule: 'nonzero' } },
    ])
  })

  it('gives a region with its own fills a graphic of its own, filled with them', () => {
    const text = inFrame([
      v({
        fillGeometry: [
          outline('M0 0L10 0L10 10Z'),
          outline('M20 0L30 0L30 10Z', 'NONZERO', { overrideID: 1 }),
          outline('M0 5L5 5L5 9Z', 'NONZERO', { overrideID: 3 }),
        ],
        fills: [red],
        fillOverrideTable: { 1: { fills: [blue] }, 2: null, 3: { fills: [] } },
      }),
    ])
    const nodes = layersOf(onlyFrame(text))
    const [plain, region, unfilled] = childrenOf(nodes, '1-2')
    expect(nodes[plain ?? '']?.props).toMatchObject({ shape: { d: 'M0 0L10 0L10 10Z' } })
    expect(nodes[region ?? '']?.props).toMatchObject({ shape: { d: 'M20 0L30 0L30 10Z' } })
    const { paints } = built(text)
    expect(paints[plain ?? '']?.fills).toEqual([red])
    expect(paints[region ?? '']?.fills).toEqual([blue])
    // A region whose own fills are none keeps its outline, drawing nothing, as in Figma.
    expect(paints[unfilled ?? '']?.fills).toEqual([])
  })

  it('reads a region whose entry has no fills, or is named `__proto__`, as one of the rest', () => {
    for (const [id, table] of [
      [1, { 1: { inheritFillStyleId: 'x' } }],
      ['__proto__', JSON.parse('{"__proto__": {"fills": []}}')],
    ]) {
      const text = inFrame([
        v({
          fillGeometry: [outline('M0 0L10 0L10 10Z'), outline('M20 0L30 0L30 10Z', 'NONZERO', { overrideID: id })],
          fills: [red],
          fillOverrideTable: table,
        }),
      ])
      expect(layersOf(onlyFrame(text))['1-2']?.props).toMatchObject({
        shape: { d: 'M0 0L10 0L10 10ZM20 0L30 0L30 10Z' },
      })
    }
    expect(Object.prototype).not.toHaveProperty('fills')
  })

  it('leaves out a vector with no outline to draw, and outlines that are no path data', () => {
    const text = inFrame([
      v({ fills: [red] }),
      vector('1:3', AT, 40, 10, { fillGeometry: [outline('junk'), { path: 7 }, outline('')] }, FRAME_AT),
      vector('1:4', AT, 40, 10, { fillGeometry: [outline('M0 0L1e400 0L0 5Z')] }, FRAME_AT),
    ])
    expect(onlyFrame(text).layers).toBeNull()
    expect(countOf(text, 'shapes-without-outlines')).toBe(3)
  })

  it('makes a star, a polygon, an arc and a ring a path, keeping their live strokes', () => {
    const shape = (type: string, id: string, extra = {}) =>
      node(type, id, box(0, 0, 0, 0), {
        ...placedAt(AT, 40, 10, FRAME_AT),
        fillGeometry: [outline(closed)],
        strokes: [red],
        strokeWeight: 2,
        ...extra,
      })
    const text = inFrame([
      shape('STAR', '1:2'),
      shape('REGULAR_POLYGON', '1:3'),
      shape('ELLIPSE', '1:4', { arcData: { startingAngle: 0, endingAngle: Math.PI, innerRadius: 0 } }),
      shape('ELLIPSE', '1:5', { arcData: { startingAngle: 0, endingAngle: 2 * Math.PI, innerRadius: 0.5 } }),
    ])
    const nodes = layersOf(onlyFrame(text))
    const { paints } = built(text)
    for (const id of ['1-2', '1-3', '1-4', '1-5']) {
      expect(nodes[id]).toMatchObject({ type: 'graphic', props: { shape: { kind: 'path', d: closed } } })
      expect(paints[id]?.strokes?.id).toBe(id.replace('-', ':'))
    }
    expect(linesOf(text)).toEqual([])
  })

  it('keeps a boolean holding a stroked vector of mixed winding rules a boolean of one path', () => {
    const square = (x: number) => `M${x} 0L${x + 10} 0L${x + 10} 10L${x} 10Z`
    const text = inFrame([
      node('BOOLEAN_OPERATION', '1:2', box(0, 0, 0, 0), {
        ...placedAt(AT, 40, 10, FRAME_AT),
        booleanOperation: 'UNION',
        children: [
          vector(
            '1:3',
            AT,
            40,
            10,
            {
              fillGeometry: [outline(square(0), 'EVENODD'), outline(square(5))],
              strokeGeometry: [outline(strokeOutline)],
              fills: [red],
              strokes: [red],
              strokeWeight: 2,
              fillOverrideTable: { 1: { fills: [blue] } },
            },
            FRAME_AT,
          ),
        ],
      }),
    ])
    const nodes = layersOf(onlyFrame(text))
    expect(nodes['1-2']?.type).toBe('boolean')
    expect(childrenOf(nodes, '1-2')).toEqual(['1-3'])
    expect(nodes['1-3']).toMatchObject({ type: 'graphic', props: { x: 10, y: 20, width: 40, height: 10 } })
    const path = ck.Path.MakeFromSVGString((nodes['1-3']?.props as { shape: { d: string } }).shape.d)
    // The union of both squares: each point of either is inside, with no hole where they overlap.
    expect([...(path?.computeTightBounds() ?? [])]).toEqual([0, 0, 15, 10])
    for (const x of [2, 7, 12]) expect(path?.contains(x, 5)).toBe(true)
    path?.delete()
    expect(built(text).paints['1-3']).toEqual({ fills: [red], handles: expect.anything(), node: expect.anything() })
    expect(linesOf(text)).toEqual([])
  })

  it('makes a boolean holding a text one path from its own outline, reported', () => {
    const text = inFrame([
      node('BOOLEAN_OPERATION', '1:2', box(0, 0, 0, 0), {
        ...placedAt(AT, 40, 10, FRAME_AT),
        fillGeometry: [outline(closed)],
        fills: [red],
        children: [
          vector('1:3', AT, 40, 10, { fillGeometry: [outline(closed)] }, FRAME_AT),
          node('TEXT', '1:4', box(0, 0, 5, 5)),
        ],
      }),
    ])
    const nodes = layersOf(onlyFrame(text))
    expect(Object.keys(nodes)).toEqual(['1-2'])
    expect(nodes['1-2']).toMatchObject({ type: 'graphic', props: { x: 10, y: 20, shape: { kind: 'path', d: closed } } })
    expect(built(text).paints['1-2']).toMatchObject({ fills: [red] })
    expect(imported(text).converted.report.items).toEqual([
      { line: 'booleans-flattened', kind: 'changed', count: 1, nodes: [{ id: '1:2', name: 'boolean_operation' }] },
    ])
  })
})
