import { describe, expect, it } from 'vitest'

import { FIGMA_REPORT_LINES, FigmaImport, FigmaReport } from './figma-import.ts'

const rect = (x: number) => ({
  type: 'graphic' as const,
  parentId: 'frame',
  link: `r${x}`,
  index: 'a0',
  name: 'Rect',
  props: { x, y: 0, width: 10, height: 10, shape: { kind: 'rect' as const } },
})

const frame = (overrides: object = {}) => ({
  name: 'Card',
  figmaId: '1:2',
  x: 0,
  y: 0,
  width: 400,
  height: 300,
  fills: [],
  layers: { nodes: { '1-3': rect(0) }, roots: ['1-3'] },
  figmaIds: { '1-3': '1:3' },
  ...overrides,
})

const imported = (overrides: object = {}) => ({
  name: 'File',
  target: 'pages',
  pages: [{ name: 'Page 1', figmaId: '0:1', frames: [frame()] }],
  report: { fonts: [], items: [] },
  ...overrides,
})

describe('FigmaImport', () => {
  it('reads an import of a page with a frame of layers', () => {
    const parsed = FigmaImport.parse(imported())
    expect(parsed.pages[0]?.frames[0]?.layers?.roots).toEqual(['1-3'])
    expect(parsed.pages[0]?.frames[0]?.layers?.nodes['1-3']?.props.rotation).toBe(0)
  })

  it('takes a frame with no layers', () => {
    expect(
      FigmaImport.safeParse(
        imported({ pages: [{ name: 'P', figmaId: '0:1', frames: [frame({ layers: null, figmaIds: {} })] }] }),
      ).success,
    ).toBe(true)
  })

  it('refuses a frame of a size a frame cannot be', () => {
    for (const size of [{ width: 20 }, { width: 8001 }, { width: 400.5 }, { width: 4000, height: 300 }]) {
      const pages = [{ name: 'P', figmaId: '0:1', frames: [frame(size)] }]
      expect(FigmaImport.safeParse(imported({ pages })).success).toBe(false)
    }
  })

  it('refuses a frame name a frame cannot have', () => {
    for (const name of ['', '  ', 'x'.repeat(121)]) {
      const pages = [{ name: 'P', figmaId: '0:1', frames: [frame({ name })] }]
      expect(FigmaImport.safeParse(imported({ pages })).success).toBe(false)
    }
  })

  it('refuses a page with no frames and an import with no pages', () => {
    expect(FigmaImport.safeParse(imported({ pages: [{ name: 'P', figmaId: '0:1', frames: [] }] })).success).toBe(false)
    expect(FigmaImport.safeParse(imported({ pages: [] })).success).toBe(false)
  })

  it('refuses an import onto the shown page that holds more than one page', () => {
    const page = { name: 'P', figmaId: '0:1', frames: [frame()] }
    expect(FigmaImport.safeParse(imported({ target: 'shown-page', pages: [page] })).success).toBe(true)
    expect(FigmaImport.safeParse(imported({ target: 'shown-page', pages: [page, page] })).success).toBe(false)
  })

  it('refuses a key of figmaIds that is no layer of the frame', () => {
    const pages = [{ name: 'P', figmaId: '0:1', frames: [frame({ figmaIds: { '1-3': '1:3', '9-9': '9:9' } })] }]
    expect(FigmaImport.safeParse(imported({ pages })).success).toBe(false)
  })
})

describe('FigmaReport', () => {
  it('reads items in their order, each with at most three layers', () => {
    const item = { line: 'slices', kind: 'left-out', count: 4, nodes: [{ id: '1:9', name: 'Slice' }] }
    expect(FigmaReport.parse({ fonts: ['Inter'], items: [item] }).items).toEqual([item])
    const four = { ...item, nodes: [1, 2, 3, 4].map((n) => ({ id: `1:${n}`, name: 'S' })) }
    expect(FigmaReport.safeParse({ fonts: [], items: [four] }).success).toBe(false)
  })

  it("refuses an item whose kind isn't its line's", () => {
    const item = { line: 'slices', kind: 'changed', count: 1, nodes: [] }
    expect(FigmaReport.safeParse({ fonts: [], items: [item] }).success).toBe(false)
  })

  it('gives every line a kind', () => {
    for (const kind of Object.values(FIGMA_REPORT_LINES)) expect(['left-out', 'changed']).toContain(kind)
  })
})
