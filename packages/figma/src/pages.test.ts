import { describe, expect, it } from 'vitest'

import { figmaToImport } from './index.ts'
import { box, figmaFile, frame, node, onePage, page, rectangle, type TestNode } from './test-figma.ts'
import { childrenOf, countOf, imported, layersOf, linesOf, onlyFrame } from './test-import.ts'

describe('importPages', () => {
  describe('pages and links', () => {
    const file = figmaFile([
      page('0:1', 'Ads', [
        frame('1:1', box(0, 0, 400, 300), [rectangle('1:2', box(10, 20, 30, 40))]),
        frame('1:3', box(500, 0, 200, 200)),
      ]),
      page('0:2', 'Posts', [frame('2:1', box(-100, 50, 1080, 1080))]),
    ])

    it('imports every page of a file with its top-level frames where Figma has them', () => {
      const { converted } = imported(file)
      expect(converted.name).toBe('Spring launch')
      expect(converted.target).toBe('pages')
      expect(
        converted.pages.map((p) => [p.name, p.figmaId, p.frames.map((f) => [f.figmaId, f.x, f.y, f.width, f.height])]),
      ).toEqual([
        [
          'Ads',
          '0:1',
          [
            ['1:1', 0, 0, 400, 300],
            ['1:3', 500, 0, 200, 200],
          ],
        ],
        ['Posts', '0:2', [['2:1', -100, 50, 1080, 1080]]],
      ])
    })

    it("places a frame's layers in the frame's pixels", () => {
      const f = onlyFrame(file)
      expect(f.layers?.roots).toEqual(['1-2'])
      expect(layersOf(f)['1-2']?.props).toMatchObject({ x: 10, y: 20, width: 30, height: 40 })
      expect(f.figmaIds).toEqual({ '1-2': '1:2' })
    })

    it('imports one page from a page link', () => {
      const { converted } = imported(file, '0:2')
      expect(converted.target).toBe('pages')
      expect(converted.pages.map((p) => p.figmaId)).toEqual(['0:2'])
    })

    it('imports a top-level frame onto the shown page from a frame link', () => {
      const { converted } = imported(file, '1:3')
      expect(converted.target).toBe('shown-page')
      expect(converted.pages.flatMap((p) => p.frames.map((f) => f.figmaId))).toEqual(['1:3'])
    })

    it('imports a layer inside a frame on its own, in a frame of its size, from its link', () => {
      const { converted } = imported(file, '1:2')
      expect(converted.target).toBe('shown-page')
      const f = converted.pages[0]?.frames[0]
      expect(f && [f.figmaId, f.width, f.height]).toEqual(['1:2', 50, 50])
      expect(f && layersOf(f)['1-2']?.props).toMatchObject({ x: 0, y: 0, width: 30, height: 40 })
      expect(converted.report.items).toContainEqual({
        line: 'linked-layer-alone',
        kind: 'changed',
        count: 1,
        nodes: [{ id: '1:2', name: 'Rect 1:2' }],
      })
    })

    it("imports a section's frames as a page from its link", () => {
      const text = onePage([
        node('SECTION', '5:1', box(0, 0, 900, 900), {
          name: 'Launch',
          children: [frame('5:2', box(10, 10, 300, 300))],
        }),
      ])
      const { converted } = imported(text, '5:1')
      expect(converted.target).toBe('pages')
      expect(converted.pages.map((p) => [p.name, p.frames.map((f) => f.figmaId)])).toEqual([['Launch', ['5:2']]])
    })

    it('refuses a link to a node the file lacks', () => {
      expect(figmaToImport(file, { nodeId: '9:9' })).toEqual({ error: 'node-missing' })
    })

    it('skips an empty page, and refuses a file with nothing to import', () => {
      const text = figmaFile([page('0:1', 'Empty', []), page('0:2', 'Ads', [frame('1:1', box(0, 0, 100, 100))])])
      expect(imported(text).converted.pages.map((p) => p.name)).toEqual(['Ads'])
      expect(linesOf(text)).toContain('empty-pages')
      expect(figmaToImport(figmaFile([page('0:1', 'Empty', [])]))).toEqual({ error: 'nothing-to-import' })
    })

    it('tells the size the import adds to a design', () => {
      const { size, converted } = imported(file)
      expect(size).toEqual({
        layers: 1,
        frames: 3,
        pages: 2,
        bytes: new TextEncoder().encode(JSON.stringify(converted)).length,
      })
    })
  })

  describe('top-level frames', () => {
    const one = (f: TestNode) => onlyFrame(onePage([f]))

    it('rounds a frame to whole pixels and reports it', () => {
      const text = onePage([frame('1:1', box(0.4, 0, 400.4, 299.6))])
      expect(onlyFrame(text)).toMatchObject({ x: 0.4, width: 400, height: 300 })
      expect(linesOf(text)).toEqual(['frames-rounded'])
    })

    it('brings a frame within the sizes a frame can be, its content in a box of its own size', () => {
      for (const [w, h, fw, fh] of [
        [24, 24, 50, 50],
        [1440, 9000, 1440, 8000],
        [2000, 100, 2000, 167],
      ] as const) {
        const text = onePage([frame('1:1', box(0, 0, w, h), [rectangle('1:2', box(5, 5, 10, 10))])])
        const f = onlyFrame(text)
        expect([f.width, f.height]).toEqual([fw, fh])
        const [root] = f.layers?.roots ?? []
        const inner = layersOf(f)[root ?? '']
        expect(inner?.type).toBe('box')
        expect(inner?.props).toMatchObject({ x: 0, y: 0, width: w, height: h })
        expect(childrenOf(layersOf(f), root ?? '')).toEqual(['1-2'])
        expect(layersOf(f)['1-2']?.props).toMatchObject({ x: 5, y: 5 })
        expect(linesOf(text)).toContain('frames-resized')
      }
    })

    it('puts the content of a frame with strokes, corners, effects, opacity, a blend mode or auto layout in a box that follows the frame', () => {
      const paint = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0, a: 1 } }]
      for (const extra of [
        { strokes: paint, strokeWeight: 2 },
        { cornerRadius: 12 },
        { rectangleCornerRadii: [0, 4, 0, 0] },
        { effects: [{ type: 'DROP_SHADOW', visible: true }] },
        { opacity: 0.5 },
        { blendMode: 'MULTIPLY' },
        { layoutMode: 'HORIZONTAL' },
      ]) {
        const f = one(frame('1:1', box(0, 0, 400, 300), [rectangle('1:2', box(0, 0, 10, 10))], extra))
        const [root] = f.layers?.roots ?? []
        const inner = layersOf(f)[root ?? '']
        expect(inner?.type).toBe('box')
        expect(inner?.props).toMatchObject({
          x: 0,
          y: 0,
          width: 400,
          height: 300,
          constraints: { horizontal: 'leftRight', vertical: 'topBottom' },
        })
        expect(f.figmaIds[root ?? '']).toBeUndefined()
      }
      expect(one(frame('1:1', box(0, 0, 400, 300), [], { cornerRadius: 12 })).layers?.roots).toHaveLength(1)
    })

    it('keeps the content of a plain frame directly in it', () => {
      const f = one(
        frame('1:1', box(0, 0, 400, 300), [rectangle('1:2', box(0, 0, 10, 10))], {
          strokes: [],
          effects: [],
          opacity: 1,
          blendMode: 'PASS_THROUGH',
          layoutMode: 'NONE',
        }),
      )
      expect(f.layers?.roots).toEqual(['1-2'])
    })

    it('names a frame as a frame can be named', () => {
      expect(one(frame('1:1', box(0, 0, 100, 100), [], { name: '   ' })).name).toBe('Frame')
      expect(one(frame('1:1', box(0, 0, 100, 100), [], { name: 'x'.repeat(130) })).name).toHaveLength(120)
    })

    it('leaves out a hidden frame, and reports frames that are locked or show what passes their edge', () => {
      const text = onePage([
        frame('1:1', box(0, 0, 100, 100), [], { visible: false }),
        frame('1:2', box(0, 0, 100, 100), [], { locked: true }),
        frame('1:3', box(0, 0, 100, 100), [], { clipsContent: false }),
      ])
      expect(imported(text).converted.pages[0]?.frames.map((f) => f.figmaId)).toEqual(['1:2', '1:3'])
      expect(linesOf(text)).toEqual(['hidden-frames', 'locked-frames', 'frames-unclipped'])
    })

    it('makes a top-level component, component set or instance a frame, reported', () => {
      const text = onePage([
        node('COMPONENT', '1:1', box(0, 0, 100, 100)),
        node('COMPONENT_SET', '1:2', box(0, 0, 100, 100), { children: [node('COMPONENT', '1:3', box(0, 0, 50, 50))] }),
        node('INSTANCE', '1:4', box(0, 0, 100, 100)),
      ])
      expect(imported(text).converted.pages[0]?.frames.map((f) => f.figmaId)).toEqual(['1:1', '1:2', '1:4'])
      expect(countOf(text, 'components-and-instances')).toBe(4)
    })

    it("keeps a section's frames on the page where they are, reported", () => {
      const text = onePage([
        node('SECTION', '5:1', box(0, 0, 900, 900), {
          children: [
            frame('5:2', box(10, 10, 300, 300)),
            node('SECTION', '5:3', box(0, 0, 1, 1), { children: [frame('5:4', box(400, 10, 300, 300))] }),
          ],
        }),
      ])
      expect(imported(text).converted.pages[0]?.frames.map((f) => [f.figmaId, f.x])).toEqual([
        ['5:2', 10],
        ['5:4', 400],
      ])
      expect(countOf(text, 'sections')).toBe(2)
    })

    it('fits the frame of loose layers to the layers they made, not to what was left out', () => {
      const boxless = { id: '1:5', type: 'GROUP', name: 'Loose', children: [rectangle('1:6', box(300, 400, 60, 50))] }
      const text = onePage([
        node('TEXT', '1:2', box(-5000, 0, 10, 10)),
        boxless as TestNode,
        rectangle('1:3', box(200, 400, 50, 50)),
      ])
      const frames = imported(text).converted.pages[0]?.frames ?? []
      expect(frames.map((f) => [f.x, f.y, f.width, f.height])).toEqual([[200, 400, 160, 50]])
      expect(layersOf(frames[0] as never)['1-6']?.props).toMatchObject({ x: 100, y: 0 })
    })

    it('puts layers outside any frame in one frame that fits them, reported', () => {
      const text = onePage([
        frame('1:1', box(0, 0, 100, 100)),
        rectangle('1:2', box(200, 300, 80, 60)),
        rectangle('1:3', box(250, 320, 100, 100.5)),
      ])
      const frames = imported(text).converted.pages[0]?.frames ?? []
      expect(frames.map((f) => [f.name, f.x, f.y, f.width, f.height])).toEqual([
        ['Frame 1:1', 0, 0, 100, 100],
        ['Outside frames', 200, 300, 150, 121],
      ])
      expect(layersOf(frames[1] as never)['1-3']?.props).toMatchObject({ x: 50, y: 20 })
      expect(frames[1]?.fills).toEqual([])
      expect(countOf(text, 'outside-frames')).toBe(2)
    })
  })
})
