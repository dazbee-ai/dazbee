import { describe, expect, it } from 'vitest'

import { figmaToImport } from './index.ts'
import { box, figmaFile, frame, group, node, onePage, rectangle, type TestNode } from './test-figma.ts'
import { checkInvariants, ck, layersOf, onlyFrame } from './test-import.ts'

describe('figmaToImport', () => {
  describe('hostile files', () => {
    it('never throws on junk in any field', () => {
      const junk = [
        null,
        -1,
        'x',
        [],
        {},
        { x: 'y' },
        Number.MAX_VALUE,
        true,
        [
          [1, 0, 1e300],
          [0, Number.MAX_VALUE, 0],
        ],
        [{ path: 'M0 0L5 5L0 5Z', windingRule: 'EVENODD', overrideID: 1 }, { path: 'M1e308 0L-1e308 9Z' }, 'x'],
        { 1: { fills: 5 }, __proto__: { fills: [] } },
        [
          { type: 'GRADIENT_RADIAL', gradientHandlePositions: 'x', gradientStops: [{ position: 'a' }] },
          {
            type: 'GRADIENT_ANGULAR',
            gradientHandlePositions: [{ x: 1e308, y: -1e308 }, { x: 0 }],
            gradientStops: [7],
          },
          { type: 'IMAGE', imageRef: 5, filters: 3, scaleMode: 'STRETCH', imageTransform: 'x', rotation: 'x' },
          { type: 'IMAGE', imageRef: 'abc', scaleMode: 'TILE', scalingFactor: -1e308, filters: { tint: 'x' } },
          { type: 'DROP_SHADOW', color: 'red', offset: 4, radius: -1e308, spread: 'x' },
          { type: 'SOLID', color: { r: null, g: 0, b: 0 }, opacity: 'x', visible: 'no' },
        ],
      ]
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
        'relativeTransform',
        'size',
        'rotation',
        'fillGeometry',
        'strokeGeometry',
        'fillOverrideTable',
        'fills',
        'constraints',
        'individualStrokeWeights',
        'strokeAlign',
        'strokeDashes',
        'strokeJoin',
        'strokeMiterAngle',
        'cornerSmoothing',
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
        'VECTOR',
        'STAR',
        'REGULAR_POLYGON',
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
          const result = figmaToImport(ck, text)
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
          strokeAlign: value,
          strokeJoin: value,
          constraints: { horizontal: value, vertical: value },
          fills: [{ type: value }, { type: 'IMAGE', imageRef: value, scaleMode: value, filters: { [value]: 1 } }],
          effects: [{ type: value }, { type: 'DROP_SHADOW', color: { r: 0, g: 0, b: 0 }, blendMode: value }],
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
        const result = figmaToImport(ck, text)
        if ('error' in result) throw new Error(result.error)
        checkInvariants(text, result.converted)
        const nodes = result.converted.pages[0]?.frames[0]?.layers?.nodes ?? {}
        expect(nodes['1-2']?.props).toMatchObject({ op: 'union' })
        expect(nodes['1-4']?.props).toMatchObject({ shape: { kind: 'line', start: 'none', end: 'none' } })
        expect(nodes['1-5']?.props).toMatchObject({ blendMode: 'normal', mask: 'alpha' })
        expect(nodes['1-5']?.props.constraints).toBeUndefined()
        const images = value === '__proto__' ? [] : [{ type: 'image', assetId: value, fit: 'fill' }]
        expect(nodes['1-5']?.props).toMatchObject({ fills: images })
        expect(result.imageRefs).toEqual(value === '__proto__' ? [] : [value])
      }
      expect(({} as Record<string, unknown>).tint).toBeUndefined()
    })

    it("refuses a file that isn't a Figma design file, or past its limits", () => {
      expect(figmaToImport(ck, '{')).toEqual({ error: 'not-json' })
      expect(figmaToImport(ck, figmaFile([], { editorType: 'slides' }))).toEqual({ error: 'not-design-file' })
    })

    it('builds a tree 250 levels deep without running out of stack', () => {
      let inner: TestNode = rectangle('9:0', box(0, 0, 1, 1))
      for (let i = 1; i < 250; i++) inner = group(`9:${i}`, [inner])
      const f = onlyFrame(onePage([frame('1:1', box(0, 0, 400, 300), [inner])]))
      expect(Object.keys(layersOf(f))).toHaveLength(250)
    })
  })
})
