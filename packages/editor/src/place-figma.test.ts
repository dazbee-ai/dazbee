// Placing an import from Figma on the open core: its pages, frames and layers added as one undo
// step, its texts fitted in that step, nothing written past the design's limits, and a held drag waited for.
import { afterEach, describe, expect, it, vi } from 'vitest'

import { type DesignInput, FigmaImport, framesOf, newFramePosition, SYNC_LIMITS } from '@dazbee/schema'

import type { TabAccess } from './core-interface.ts'
import { type TestEditor, testEditor, type TestEditorOptions } from './test-editor.ts'
import { FILE, frame, LINK, NO_REPORT, PAGES, placedOf, rect, settled } from './test-place-figma.ts'

let opened: TestEditor[] = []
afterEach(() => {
  vi.useRealTimers()
  for (const t of opened) t.end()
  opened = []
})

/** Opens `design` (the two pages unless given) in the test editor, ended after the test. */
async function open(options: TestEditorOptions = {}, design: DesignInput = PAGES) {
  const t = await testEditor(design, options)
  opened.push(t)
  return t
}

/** The pages, by name, each with its frames' names, places and fills, in the design's order. */
function pagesOf(t: TestEditor) {
  const design = t.core.design()
  return Object.entries(design.pages)
    .sort(([, a], [, b]) => (a.order < b.order ? -1 : 1))
    .map(([pageId, page]) => [
      page.name,
      framesOf(design, pageId).map(([, f]) => [
        f.name,
        f.x,
        f.y,
        f.width,
        f.height,
        f.fills[0]?.type === 'solid' ? f.fills[0].color : null,
      ]),
    ])
}

describe('placeFigma', () => {
  it('adds a file import’s pages at the end, named as in Figma, with their frames where Figma has them, as one undo step undo takes back whole', async () => {
    const t = await open()
    const before = pagesOf(t)
    const { confirmed } = placedOf(await t.core.placeFigma(FILE))
    expect(pagesOf(t)).toEqual([
      ...before,
      [
        'Covers',
        [
          ['Frame 1:1', -200, 40, 400, 300, '#FFCC00FF'],
          ['Frame 1:5', 600, 40, 400, 300, '#FFCC00FF'],
        ],
      ],
      ['Posts', [['Frame 2:1', 0, 0, 400, 300, '#FFCC00FF']]],
    ])
    expect(await settled(confirmed)).toBe('saved')
    expect(t.core.undoName()).toBe('importFigma')
    const placed = t.core.design()
    t.core.perform('undo')
    expect([pagesOf(t), t.core.canUndo()]).toEqual([before, false])
    t.core.perform('redo')
    expect(t.core.design()).toEqual(placed)
  })

  it('maps every Figma node id to the page, frame or layer it became', async () => {
    const t = await open()
    const { ids } = placedOf(await t.core.placeFigma(FILE))
    const design = t.core.design()
    const named = [...ids].map(([figmaId, id]) => [
      figmaId,
      design.pages[id]?.name ?? design.frames[id]?.name ?? design.nodes[id]?.name,
    ])
    expect(named).toEqual(
      expect.arrayContaining([
        ['0:1', 'Covers'],
        ['0:2', 'Posts'],
        ['1:1', 'Frame 1:1'],
        ['1:5', 'Frame 1:5'],
        ['2:1', 'Frame 2:1'],
        ['1:2', 'Card'],
        ['1:3', 'Rect'],
        ['1:4', 'Text'],
        ['2:2', 'Text'],
        ['2:3', 'Text'],
      ]),
    )
    expect(named).toHaveLength(10)
    expect(design.nodes[ids.get('1:3') ?? '']?.parentId).toBe(ids.get('1:2'))
    expect(design.nodes[ids.get('1:2') ?? '']?.parentId).toBe(ids.get('1:1'))
  })

  it('fits autoWidth and autoHeight texts, and the group holding one, inside the step; a fixed text keeps Figma’s size', async () => {
    const t = await open()
    const { ids } = placedOf(await t.core.placeFigma(FILE))
    const props = (figmaId: string) => t.core.design().nodes[ids.get(figmaId) ?? '']?.props
    const wide = props('1:4')
    expect(wide?.width).toBeGreaterThan(200)
    // The group around the text fits it again.
    expect(props('1:2')?.width).toBeGreaterThanOrEqual((wide?.x ?? 0) + (wide?.width ?? 0) - (props('1:2')?.x ?? 0))
    expect([props('2:2')?.width, (props('2:2')?.height ?? 0) > 5]).toEqual([300, true])
    expect([props('2:3')?.width, props('2:3')?.height]).toEqual([77, 33])
    t.core.perform('undo')
    expect(t.core.canUndo()).toBe(false)
  })

  it('puts a frame link’s frame on the shown page by the frame rule', async () => {
    const t = await open()
    const rule = newFramePosition(framesOf(t.core.design(), 'p1').map(([, f]) => f))
    const { ids } = placedOf(await t.core.placeFigma(LINK))
    const placed = t.core.design().frames[ids.get('3:1') ?? '']
    expect([placed?.pageId, placed?.x, placed?.y, ids.get('0:1')]).toEqual(['p1', rule.x, rule.y, 'p1'])
    expect(t.core.design().nodes[ids.get('3:2') ?? '']?.parentId).toBe(ids.get('3:1'))
  })

  it('places nothing past each of the design’s limits, and says which', async () => {
    const t = await open()
    const before = t.core.design()
    const page = (i: number) => ({ name: `P${i}`, figmaId: `p:${i}`, frames: [frame(`f:${i}`, 0, 0, null)] })
    const imports = {
      designPages: { pages: Array.from({ length: SYNC_LIMITS.designPages }, (_, i) => page(i)) },
      designFrames: {
        pages: [
          {
            ...page(0),
            frames: Array.from({ length: SYNC_LIMITS.designFrames }, (_, i) => frame(`f:${i}`, i, 0, null)),
          },
        ],
      },
      designLayers: {
        pages: [
          {
            ...page(0),
            frames: [
              frame(
                'f:0',
                0,
                0,
                Object.fromEntries(
                  Array.from({ length: SYNC_LIMITS.designLayers }, (_, i) => [`k${i}`, rect('root', 'a0')]),
                ),
                Array.from({ length: SYNC_LIMITS.designLayers }, (_, i) => `k${i}`),
              ),
            ],
          },
        ],
      },
      designBytes: {
        pages: [
          {
            ...page(0),
            frames: [
              frame(
                'f:0',
                0,
                0,
                {
                  long: {
                    ...rect('root', 'a0'),
                    props: {
                      x: 0,
                      y: 0,
                      width: 40,
                      height: 30,
                      shape: { kind: 'path', d: 'M0 0'.repeat(SYNC_LIMITS.designBytes / 4) },
                    },
                  },
                },
                ['long'],
              ),
            ],
          },
        ],
      },
    }
    for (const [limit, pages] of Object.entries(imports)) {
      const figma = FigmaImport.parse({ name: 'Big', target: 'pages', report: NO_REPORT, ...pages })
      expect([limit, await t.core.placeFigma(figma)]).toEqual([limit, { placed: false, why: 'limit', limit }])
      expect([t.core.design(), t.core.canUndo()]).toEqual([before, false])
    }
  })

  it('places nothing in an editor that has ended, or in a tab that may only view the design', async () => {
    const viewOnly: TabAccess = { readOnly: () => true, onChange: () => () => {} }
    const viewing = await open({ access: viewOnly })
    expect(await viewing.core.placeFigma(FILE)).toEqual({ placed: false, why: 'viewOnly' })
    const ended = await open()
    const before = ended.core.design()
    ended.end()
    opened = opened.filter((t) => t !== ended)
    expect(await ended.core.placeFigma(FILE)).toEqual({ placed: false, why: 'ended' })
    expect(ended.core.design()).toEqual(before)
  })

  it('waits for a held drag to be let go, then places the import as an undo step of its own', async () => {
    const t = await open()
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    const from = t.core.stagePoint(150, 150)
    t.mouse.move(from.x, from.y)
    t.mouse.down()
    t.mouse.move(from.x + 60, from.y + 30, { steps: 5 })
    const placing = t.core.placeFigma(FILE)
    await vi.advanceTimersByTimeAsync(4_500)
    expect(Object.keys(t.core.design().pages)).toEqual(['p1', 'p2'])
    t.mouse.up()
    await vi.advanceTimersByTimeAsync(100)
    placedOf(await placing)
    expect(Object.keys(t.core.design().pages)).toHaveLength(4)
    t.core.perform('undo')
    expect([Object.keys(t.core.design().pages), t.core.undoName()]).toEqual([['p1', 'p2'], 'move'])
  })
})
