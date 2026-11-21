import { describe, expect, it } from 'vitest'

import { figmaToImport } from './index.ts'
import { box, figmaFile, frame, group, node, onePage, rectangle, type TestNode } from './test-figma.ts'
import { checkInvariants, layersOf, onlyFrame } from './test-import.ts'

describe('figmaToImport', () => {
  describe('hostile files', () => {
    it('never throws on junk in any field', () => {
      const junk = [null, -1, 'x', [], {}, { x: 'y' }, Number.MAX_VALUE, true]
      const fields = [
        'absoluteBoundingBox',
        'children',
        'name',
        'visible',
        'locked',
        'clipsContent',
        'cornerRadius',
        'rectangleCornerRadii',
        'arcData',
        'strokeCap',
        'isMask',
        'maskType',
        'booleanOperation',
        'layoutMode',
        'strokes',
        'effects',
        'opacity',
        'blendMode',
        'strokeWeight',
      ]
      const types = [
        'FRAME',
        'GROUP',
        'RECTANGLE',
        'ELLIPSE',
        'LINE',
        'BOOLEAN_OPERATION',
        'SECTION',
        'INSTANCE',
        'TEXT',
        '',
        'CANVAS',
      ]
      for (const value of junk) {
        for (const f of fields) {
          const children = types.map((type, i) => ({
            ...node(type, `1:${i + 2}`, box(0, 0, 10, 10)),
            [f]: value,
            children: [rectangle(`2:${i}`, box(0, 0, 1, 1))],
          }))
          const text = onePage([frame('1:1', box(0, 0, 400, 300), children as TestNode[]), ...(children as TestNode[])])
          const result = figmaToImport(text)
          if (!('error' in result)) checkInvariants(text, result.converted)
        }
      }
    })

    it('reads layers named like Object.prototype as layers of their own, leaving Object.prototype alone', () => {
      const text = onePage([
        frame('1:1', box(0, 0, 400, 300), [
          rectangle('constructor', box(0, 0, 1, 1)),
          rectangle('toString', box(0, 0, 1, 1)),
          rectangle('__proto__', box(0, 0, 1, 1)),
        ]),
      ])
      const f = onlyFrame(text)
      expect(Object.values(f.figmaIds)).toEqual(['constructor', 'toString', '__proto__'])
      expect(({} as Record<string, unknown>).name).toBeUndefined()
    })

    it('reads values named like Object.prototype as values Figma has not documented', () => {
      for (const value of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
        const fields = {
          booleanOperation: value,
          strokeCap: value,
          maskType: value,
          layoutMode: value,
          blendMode: value,
        }
        const kids = [
          node('BOOLEAN_OPERATION', '1:2', box(0, 0, 9, 9), {
            ...fields,
            children: [rectangle('1:3', box(0, 0, 9, 9))],
          }),
          node('LINE', '1:4', box(0, 0, 9, 0), fields),
          rectangle('1:5', box(0, 0, 9, 9), { ...fields, isMask: true }),
        ]
        const text = onePage([frame('1:1', box(0, 0, 400, 300), kids, fields), node(value, '1:6', box(0, 0, 1, 1))])
        const result = figmaToImport(text)
        if ('error' in result) throw new Error(result.error)
        checkInvariants(text, result.converted)
        const nodes = result.converted.pages[0]?.frames[0]?.layers?.nodes ?? {}
        expect(nodes['1-2']?.props).toMatchObject({ op: 'union' })
        expect(nodes['1-4']?.props).toMatchObject({ shape: { kind: 'line', start: 'none', end: 'none' } })
      }
    })

    it("refuses a file that isn't a Figma design file, or past its limits", () => {
      expect(figmaToImport('{')).toEqual({ error: 'not-json' })
      expect(figmaToImport(figmaFile([], { editorType: 'slides' }))).toEqual({ error: 'not-design-file' })
    })

    it('builds a tree 250 levels deep without running out of stack', () => {
      let inner: TestNode = rectangle('9:0', box(0, 0, 1, 1))
      for (let i = 1; i < 250; i++) inner = group(`9:${i}`, [inner])
      const f = onlyFrame(onePage([frame('1:1', box(0, 0, 400, 300), [inner])]))
      expect(Object.keys(layersOf(f))).toHaveLength(250)
    })
  })
})
