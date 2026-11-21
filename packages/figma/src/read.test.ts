import { describe, expect, it } from 'vitest'

import { boxOf, field, MAX_FIGMA_DEPTH, MAX_FIGMA_NODES, num, ownMap, readFigmaFile, record } from './read.ts'
import { box, figmaFile, frame, page, rectangle } from './test-figma.ts'

const nested = (depth: number) => {
  let inner: Record<string, unknown> = { id: `n${depth}`, type: 'GROUP', children: [] }
  for (let i = depth - 1; i > 0; i--) inner = { id: `n${i}`, type: 'GROUP', children: [inner] }
  return figmaFile([page('0:1', 'P', [inner as never])])
}

describe('readFigmaFile', () => {
  it('reads the document into nodes with their parents', () => {
    const file = readFigmaFile(
      figmaFile([page('0:1', 'P', [frame('1:2', box(0, 0, 100, 100), [rectangle('1:3', box(0, 0, 10, 10))])])]),
    )
    if ('error' in file) throw new Error(file.error)
    const [p] = file.document.children
    expect(file.name).toBe('Spring launch')
    expect(p?.type).toBe('CANVAS')
    expect(p?.children[0]?.children[0]?.id).toBe('1:3')
    expect(p?.children[0]?.children[0]?.parent?.id).toBe('1:2')
  })

  it('refuses text that is not JSON, or truncated', () => {
    expect(readFigmaFile('not json')).toEqual({ error: 'not-json' })
    expect(readFigmaFile(figmaFile([page('0:1', 'P', [])]).slice(0, 40))).toEqual({ error: 'not-json' })
    expect(readFigmaFile('[]')).toEqual({ error: 'not-design-file' })
    expect(readFigmaFile('null')).toEqual({ error: 'not-design-file' })
  })

  it('refuses a file that is no Figma design file', () => {
    expect(readFigmaFile(figmaFile([], { editorType: 'figjam' }))).toEqual({ error: 'not-design-file' })
    expect(readFigmaFile(figmaFile([], { editorType: undefined }))).toEqual({ error: 'not-design-file' })
    expect(readFigmaFile(JSON.stringify({ editorType: 'figma', document: 'x' }))).toEqual({ error: 'not-design-file' })
  })

  it('refuses a file nested deeper than its limit, and reads one at it', () => {
    // The document is level 0 and its page level 1, so a chain of n groups reaches level n + 1.
    expect('error' in readFigmaFile(nested(MAX_FIGMA_DEPTH - 1))).toBe(false)
    expect(readFigmaFile(nested(MAX_FIGMA_DEPTH))).toEqual({ error: 'too-deep' })
    expect(readFigmaFile(nested(400))).toEqual({ error: 'too-deep' })
  })

  it('refuses a file of more nodes than its limit', () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => rectangle(`1:${i}`, box(0, 0, 1, 1)))
    // The document and its page count among the nodes.
    expect('error' in readFigmaFile(figmaFile([page('0:1', 'P', many(MAX_FIGMA_NODES - 2))]))).toBe(false)
    expect(readFigmaFile(figmaFile([page('0:1', 'P', many(MAX_FIGMA_NODES - 1))]))).toEqual({ error: 'too-many-nodes' })
  })

  it('reads junk nodes as nodes with no id or type, and never throws', () => {
    const junk = [null, 4, 'x', [], { id: 7, type: ['FRAME'] }, { id: '1:9', type: 'FRAME', children: 'none' }]
    const file = readFigmaFile(
      JSON.stringify({
        editorType: 'figma',
        name: 3,
        document: { children: [{ id: '0:1', type: 'CANVAS', children: junk }] },
      }),
    )
    if ('error' in file) throw new Error(file.error)
    expect(file.name).toBe('')
    const kids = file.document.children[0]?.children ?? []
    expect(kids.map((k) => [k.id, k.type])).toEqual([
      ['', ''],
      ['', ''],
      ['', ''],
      ['', ''],
      ['', ''],
      ['1:9', 'FRAME'],
    ])
    expect(kids[5]?.children).toEqual([])
  })

  it('reads a node whose fields are named like Object.prototype as fields of its own', () => {
    const text = `{"editorType":"figma","document":{"id":"0:0","type":"DOCUMENT","children":[{"id":"0:1","type":"CANVAS","__proto__":{"polluted":true},"constructor":5,"children":[]}]}}`
    const file = readFigmaFile(text)
    if ('error' in file) throw new Error(file.error)
    const p = file.document.children[0]
    expect(p && field(p.fields, 'constructor')).toBe(5)
    expect(p && field(p.fields, 'toString')).toBeUndefined()
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })
})

describe('field', () => {
  it('reads only own fields of plain objects', () => {
    expect(field({ a: 1 }, 'a')).toBe(1)
    expect(field({}, 'constructor')).toBeUndefined()
    expect(field({}, 'toString')).toBeUndefined()
    expect(field({}, '__proto__')).toBeUndefined()
    expect(field([1], '0')).toBeUndefined()
    expect(field(null, 'a')).toBeUndefined()
  })
})

describe('num', () => {
  it('reads finite numbers only', () => {
    expect(num(2.5)).toBe(2.5)
    expect(num('2')).toBeUndefined()
    expect(num(Number.NaN)).toBeUndefined()
    expect(num(Infinity)).toBeUndefined()
  })
})

describe('record', () => {
  it('reads plain objects only', () => {
    expect(record({ a: 1 })).toEqual({ a: 1 })
    expect(record([])).toBeUndefined()
    expect(record('x')).toBeUndefined()
    expect(record(null)).toBeUndefined()
  })
})

describe('ownMap', () => {
  it("holds a map's own keys, those named like Object.prototype's among them", () => {
    const map = ownMap(JSON.parse('{"__proto__":1,"constructor":2,"toString":3,"a":4}'))
    expect([...map.keys()]).toEqual(['__proto__', 'constructor', 'toString', 'a'])
    expect(map.get('hasOwnProperty')).toBeUndefined()
    expect(ownMap('x').size).toBe(0)
  })
})

describe('boxOf', () => {
  it('reads a node box of finite numbers with no negative side', () => {
    expect(boxOf({ absoluteBoundingBox: { x: 1, y: 2, width: 3, height: 0 } })).toEqual({
      x: 1,
      y: 2,
      width: 3,
      height: 0,
    })
    expect(boxOf({ absoluteBoundingBox: { x: 1, y: 2, width: -3, height: 4 } })).toBeUndefined()
    expect(boxOf({ absoluteBoundingBox: { x: '1', y: 2, width: 3, height: 4 } })).toBeUndefined()
    expect(boxOf({})).toBeUndefined()
  })
})
