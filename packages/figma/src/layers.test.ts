import { describe, expect, it } from 'vitest'

import type { FigmaReportLine } from '@dazbee/schema'

import { box, frame, group, node, onePage, rectangle, type TestNode } from './test-figma.ts'
import { childrenOf, countOf, imported, layersOf, linesOf, onlyFrame } from './test-import.ts'

describe('convertLayers', () => {
  describe('layers', () => {
    it('makes a nested frame, component or instance a box that clips as Figma says', () => {
      const f = onlyFrame(
        onePage([
          frame('1:1', box(0, 0, 400, 300), [
            frame('1:2', box(10, 10, 100, 100), [rectangle('1:3', box(20, 20, 10, 10))], {
              clipsContent: false,
              cornerRadius: 8,
            }),
            node('INSTANCE', '1:4', box(0, 0, 50, 50)),
          ]),
        ]),
      )
      const nodes = layersOf(f)
      expect(nodes['1-2']).toMatchObject({
        type: 'box',
        props: { x: 10, y: 10, width: 100, height: 100, clip: false, cornerRadius: 8 },
      })
      expect(childrenOf(nodes, '1-2')).toEqual(['1-3'])
      expect(nodes['1-4']).toMatchObject({ type: 'box', props: { clip: true } })
    })

    it("fits a group to its layers by the doc's own fit", () => {
      const f = onlyFrame(
        onePage([
          frame('1:1', box(0, 0, 400, 300), [
            group('1:2', [rectangle('1:3', box(10, 20, 30, 30)), rectangle('1:4', box(100, 5, 10, 10))]),
          ]),
        ]),
      )
      expect(layersOf(f)['1-2']).toMatchObject({
        type: 'group',
        name: 'Group 1:2',
        props: { x: 10, y: 5, width: 100, height: 45 },
      })
      expect(childrenOf(layersOf(f), '1-2')).toEqual(['1-3', '1-4'])
    })

    it('keeps the order of layers, bottom to top', () => {
      const f = onlyFrame(
        onePage([
          frame(
            '1:1',
            box(0, 0, 400, 300),
            ['1:2', '1:3', '1:4'].map((id) => rectangle(id, box(0, 0, 5, 5))),
          ),
        ]),
      )
      expect(f.layers?.roots).toEqual(['1-2', '1-3', '1-4'])
      expect(childrenOf(layersOf(f), 'root')).toEqual(['1-2', '1-3', '1-4'])
    })

    it("makes a rectangle a rect with Figma's corners", () => {
      const nodes = layersOf(
        onlyFrame(
          onePage([
            frame('1:1', box(0, 0, 400, 300), [
              rectangle('1:2', box(0, 0, 10, 10), { cornerRadius: 3 }),
              rectangle('1:3', box(0, 0, 10, 10), { rectangleCornerRadii: [1, 2, 3, 4] }),
              rectangle('1:4', box(0, 0, 10, 10), { rectangleCornerRadii: [2, 2, 2, 2] }),
            ]),
          ]),
        ),
      )
      expect(nodes['1-2']?.props).toMatchObject({ shape: { kind: 'rect', cornerRadius: 3 } })
      expect(nodes['1-3']?.props).toMatchObject({ shape: { kind: 'rect', corners: [1, 2, 3, 4] } })
      expect(nodes['1-4']?.props).toMatchObject({ shape: { kind: 'rect', cornerRadius: 2 } })
    })

    it('makes a whole ellipse an ellipse, and leaves an arc for the vector shapes', () => {
      const text = onePage([
        frame('1:1', box(0, 0, 400, 300), [
          node('ELLIPSE', '1:2', box(0, 0, 10, 10)),
          node('ELLIPSE', '1:3', box(0, 0, 10, 10), {
            arcData: { startingAngle: 0, endingAngle: 2 * Math.PI, innerRadius: 0 },
          }),
          node('ELLIPSE', '1:4', box(0, 0, 10, 10), {
            arcData: { startingAngle: 0, endingAngle: Math.PI, innerRadius: 0 },
          }),
          node('ELLIPSE', '1:5', box(0, 0, 10, 10), {
            arcData: { startingAngle: 0, endingAngle: 2 * Math.PI, innerRadius: 0.5 },
          }),
        ]),
      ])
      const nodes = layersOf(onlyFrame(text))
      expect(Object.keys(nodes)).toEqual(['1-2', '1-3'])
      expect(nodes['1-2']?.props).toMatchObject({ shape: { kind: 'ellipse' } })
      expect(countOf(text, 'vector-shapes')).toBe(2)
    })

    it('makes a line a line with its ends', () => {
      const text = onePage([
        frame('1:1', box(0, 0, 400, 300), [
          node('LINE', '1:2', box(10, 50, 100, 0), { strokeCap: 'LINE_ARROW' }),
          node('LINE', '1:3', box(0, 0, 100, 0), { strokeCap: 'ROUND' }),
          node('LINE', '1:4', box(0, 0, 100, 0), { strokeCap: 'DIAMOND_FILLED' }),
        ]),
      ])
      const nodes = layersOf(onlyFrame(text))
      expect(nodes['1-2']?.props).toMatchObject({
        x: 10,
        y: 50,
        width: 100,
        height: 0,
        shape: { kind: 'line', start: 'arrow', end: 'arrow' },
      })
      expect(nodes['1-3']?.props).toMatchObject({ shape: { kind: 'line', start: 'none', end: 'none' } })
      expect(nodes['1-4']?.props).toMatchObject({ shape: { kind: 'line', start: 'none', end: 'none' } })
      expect(linesOf(text)).toEqual(['line-ends'])
    })

    it('makes a boolean of shapes a boolean with its op', () => {
      const f = onlyFrame(
        onePage([
          frame('1:1', box(0, 0, 400, 300), [
            node('BOOLEAN_OPERATION', '1:2', box(0, 0, 0, 0), {
              booleanOperation: 'SUBTRACT',
              children: [rectangle('1:3', box(0, 0, 20, 20)), node('ELLIPSE', '1:4', box(5, 5, 10, 10))],
            }),
          ]),
        ]),
      )
      expect(layersOf(f)['1-2']).toMatchObject({
        type: 'boolean',
        props: { op: 'subtract', x: 0, y: 0, width: 20, height: 20 },
      })
      expect(childrenOf(layersOf(f), '1-2')).toEqual(['1-3', '1-4'])
    })

    it('leaves a boolean holding a layer that is no shape for the vector shapes', () => {
      const text = onePage([
        frame('1:1', box(0, 0, 400, 300), [
          node('BOOLEAN_OPERATION', '1:2', box(0, 0, 20, 20), {
            children: [rectangle('1:3', box(0, 0, 20, 20)), node('TEXT', '1:4', box(0, 0, 5, 5))],
          }),
        ]),
      ])
      expect(onlyFrame(text).layers).toBeNull()
      expect(imported(text).converted.report.items).toEqual([
        { line: 'vector-shapes', kind: 'left-out', count: 1, nodes: [{ id: '1:2', name: 'boolean_operation' }] },
      ])
    })

    it('leaves out each type Dazbee has no layer for, by its type', () => {
      const types: [string, FigmaReportLine][] = [
        ['SLICE', 'slices'],
        ['TABLE', 'tables'],
        ['TABLE_CELL', 'tables'],
        ['TEXT_PATH', 'text-on-paths'],
        ['TRANSFORM_GROUP', 'transform-groups'],
        ['STICKY', 'figjam-items'],
        ['SHAPE_WITH_TEXT', 'figjam-items'],
        ['CONNECTOR', 'figjam-items'],
        ['WASHI_TAPE', 'figjam-items'],
        ['HOLOGRAM', 'unknown-layers'],
        ['VECTOR', 'vector-shapes'],
        ['STAR', 'vector-shapes'],
        ['REGULAR_POLYGON', 'vector-shapes'],
        ['TEXT', 'texts'],
      ]
      const text = onePage([
        frame(
          '1:1',
          box(0, 0, 400, 300),
          types.map(([type], i) =>
            node(type, `1:${i + 2}`, box(0, 0, 5, 5), { children: [rectangle(`2:${i}`, box(0, 0, 1, 1))] }),
          ),
        ),
      ])
      expect(onlyFrame(text).layers).toBeNull()
      expect(linesOf(text)).toEqual([...new Set(types.map(([, line]) => line))])
      expect(countOf(text, 'figjam-items')).toBe(4)
    })

    it('leaves out a layer with no id, type or box to place it by', () => {
      const boxless = { id: '1:4', type: 'FRAME', children: [rectangle('1:5', box(0, 0, 1, 1))] } as TestNode
      const text = onePage([
        frame('1:1', box(0, 0, 400, 300), [
          { id: '1:2', type: 'RECTANGLE' } as TestNode,
          { type: 'RECTANGLE', absoluteBoundingBox: box(0, 0, 1, 1) } as never,
          boxless,
          rectangle('1:3', box(0, 0, 1, 1)),
        ]),
      ])
      expect(Object.keys(layersOf(onlyFrame(text)))).toEqual(['1-3'])
      expect(countOf(text, 'unreadable-layers')).toBe(3)
    })

    it('cuts a long layer name', () => {
      const f = onlyFrame(
        onePage([frame('1:1', box(0, 0, 400, 300), [rectangle('1:2', box(0, 0, 1, 1), { name: 'n'.repeat(250) })])]),
      )
      expect(layersOf(f)['1-2']?.name).toHaveLength(200)
    })
  })

  describe('keys', () => {
    it("keys layers by their Figma ids in the link's form, and maps each back", () => {
      const f = onlyFrame(onePage([frame('1:1', box(0, 0, 400, 300), [rectangle('I12:34;56:78', box(0, 0, 1, 1))])]))
      expect(f.layers?.roots).toEqual(['I12-34_56-78'])
      expect(f.figmaIds).toEqual({ 'I12-34_56-78': 'I12:34;56:78' })
    })

    it("gives a fresh key to the id `root`, which the tree's top layers name as their parent", () => {
      const f = onlyFrame(
        onePage([frame('1:1', box(0, 0, 400, 300), [group('root', [rectangle('1:2', box(0, 0, 1, 1))])])]),
      )
      expect(f.layers?.roots).toEqual(['n1'])
      expect(childrenOf(layersOf(f), 'n1')).toEqual(['1-2'])
    })

    it('gives a fresh key to an id that is no valid key, or repeats', () => {
      const ids = ['1:2', '1:2', 'a b', '__proto__', 'x'.repeat(70), 'n1']
      const f = onlyFrame(
        onePage([
          frame(
            '1:1',
            box(0, 0, 400, 300),
            ids.map((id) => rectangle(id, box(0, 0, 1, 1))),
          ),
        ]),
      )
      expect(f.layers?.roots).toEqual(['1-2', 'n2', 'n3', 'n4', 'n5', 'n1'])
      expect(Object.values(f.figmaIds)).toEqual(ids)
    })
  })

  describe('masks', () => {
    const mask = (id: string, extra = {}) => rectangle(id, box(0, 0, 50, 50), { isMask: true, ...extra })
    const r = (id: string) => rectangle(id, box(0, 0, 10, 10))

    it("makes a group's one mask a Mask group", () => {
      const nodes = layersOf(
        onlyFrame(onePage([frame('1:1', box(0, 0, 400, 300), [group('1:2', [r('1:3'), mask('1:4'), r('1:5')])])])),
      )
      expect(childrenOf(nodes, '1-2')).toEqual(['1-3', '1-4', '1-5'])
      expect(nodes['1-4']?.props.mask).toBe('alpha')
    })

    it('reads a luminance mask', () => {
      const nodes = layersOf(
        onlyFrame(onePage([frame('1:1', box(0, 0, 400, 300), [mask('1:2', { maskType: 'LUMINANCE' }), r('1:3')])])),
      )
      expect(nodes['1-2']?.props.mask).toBe('luminance')
    })

    it('nests each later mask with the layers above it, in a group and in a box', () => {
      for (const holder of ['group', 'box']) {
        const kids = [r('1:3'), mask('1:4'), r('1:5'), mask('1:6'), r('1:7'), mask('1:8'), r('1:9')]
        const container = holder === 'group' ? group('1:2', kids) : frame('1:2', box(0, 0, 100, 100), kids)
        const nodes = layersOf(onlyFrame(onePage([frame('1:1', box(0, 0, 400, 300), [container])])))
        const top = childrenOf(nodes, '1-2')
        expect(top.slice(0, 3)).toEqual(['1-3', '1-4', '1-5'])
        const second = top[3] ?? ''
        expect(nodes[second]?.type).toBe('group')
        const inSecond = childrenOf(nodes, second)
        expect(inSecond.slice(0, 2)).toEqual(['1-6', '1-7'])
        const third = inSecond[2] ?? ''
        expect(childrenOf(nodes, third)).toEqual(['1-8', '1-9'])
      }
    })

    it('keeps masks side by side in a box with auto layout, reported', () => {
      const text = onePage([
        frame('1:1', box(0, 0, 400, 300), [
          frame('1:2', box(0, 0, 100, 100), [mask('1:3'), r('1:4'), mask('1:5'), r('1:6')], { layoutMode: 'VERTICAL' }),
        ]),
      ])
      expect(childrenOf(layersOf(onlyFrame(text)), '1-2')).toEqual(['1-3', '1-4', '1-5', '1-6'])
      expect(linesOf(text)).toEqual(['masks-separate'])
    })

    it("nests the masks of a frame's own layers", () => {
      const nodes = layersOf(
        onlyFrame(onePage([frame('1:1', box(0, 0, 400, 300), [mask('1:2'), r('1:3'), mask('1:4'), r('1:5')])])),
      )
      const roots = childrenOf(nodes, 'root')
      expect(roots.slice(0, 2)).toEqual(['1-2', '1-3'])
      expect(childrenOf(nodes, roots[2] ?? '')).toEqual(['1-4', '1-5'])
    })
  })
})
