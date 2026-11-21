// Placing an import from Figma on the open core: its pages, frames and layers added as one undo
// step, its texts fitted in that step, nothing written past the design's limits, a held drag waited
// for, and `confirmed` settling on what the sync server did with the step.
import { afterEach, describe, expect, it, vi } from 'vitest'

import { NotSaved, openLocalServer, openSession, plainStore } from '@dazbee/doc'
import { type DesignInput, FigmaImport, framesOf, newFramePosition, parseDesign, SYNC_LIMITS } from '@dazbee/schema'

import type { TabAccess } from './core-interface.ts'
import type { PlacedFigma } from './place-figma.ts'
import { DESIGN } from './test-actions.ts'
import { type TestEditor, testEditor, type TestEditorOptions } from './test-editor.ts'

/** The actions' design with a second page, `p2`, holding a square frame of its own. */
const PAGES: DesignInput = {
  ...DESIGN,
  pages: { ...DESIGN.pages, p2: { name: 'Two', order: 'a1' } },
  frames: {
    ...DESIGN.frames,
    'p2-sq': { pageId: 'p2', name: 'Square', width: 1080, height: 1080, x: 0, y: 0, order: 'a0' },
  },
}

/** A rectangle layer of an import's frame, by its key, holder and order. */
const rect = (parentId: string, index: string, x = 10, y = 10) => ({
  type: 'graphic',
  parentId,
  link: `l-${index}`,
  index,
  name: 'Rect',
  props: { x, y, width: 40, height: 30, shape: { kind: 'rect' } },
})

/** A text layer of an import's frame whose box is `width` × `height` as Figma gave it. */
const text = (parentId: string, index: string, boxMode: string, width = 10, height = 10) => ({
  type: 'text',
  parentId,
  link: `t-${index}`,
  index,
  name: 'Text',
  props: {
    x: 20,
    y: 20,
    width,
    height,
    text: 'Hello from Figma',
    boxMode,
    style: { fontFamily: 'Noto Sans', fontSize: 40, color: '#000000FF' },
  },
})

/** A frame of an import: its layers under keys made from Figma ids, each key's Figma id beside it. */
const frame = (
  figmaId: string,
  x: number,
  y: number,
  layers: Record<string, unknown> | null,
  roots: string[] = [],
) => ({
  name: `Frame ${figmaId}`,
  figmaId,
  x,
  y,
  width: 400,
  height: 300,
  fills: [{ type: 'solid', color: '#FFCC00FF' }],
  layers: layers && { nodes: layers, roots },
  figmaIds: Object.fromEntries(Object.keys(layers ?? {}).map((key) => [key, key.replace('-', ':')])),
})

const NO_REPORT = { fonts: [], items: [] }

/**
 * A file import of two pages: the first with two frames, one holding a group of a rectangle and an
 * autoWidth text; the second with a frame holding an autoHeight text and a fixed one.
 */
const FILE = FigmaImport.parse({
  name: 'Brand file',
  target: 'pages',
  report: NO_REPORT,
  pages: [
    {
      name: 'Covers',
      figmaId: '0:1',
      frames: [
        frame(
          '1:1',
          -200,
          40,
          {
            '1-2': {
              ...rect('', 'a0'),
              type: 'group',
              parentId: 'root',
              name: 'Card',
              props: { x: 10, y: 10, width: 60, height: 50 },
            },
            '1-3': rect('1-2', 'a0'),
            '1-4': text('1-2', 'a1', 'autoWidth'),
          },
          ['1-2'],
        ),
        frame('1:5', 600, 40, null),
      ],
    },
    {
      name: 'Posts',
      figmaId: '0:2',
      frames: [
        frame(
          '2:1',
          0,
          0,
          { '2-2': text('root', 'a0', 'autoHeight', 300, 5), '2-3': text('root', 'a1', 'fixed', 77, 33) },
          ['2-2', '2-3'],
        ),
      ],
    },
  ],
})

/** A frame link's import: one frame onto the shown page, holding one rectangle. */
const LINK = FigmaImport.parse({
  name: 'Brand file',
  target: 'shown-page',
  report: NO_REPORT,
  pages: [
    { name: 'Covers', figmaId: '0:1', frames: [frame('3:1', 5000, 5000, { '3-2': rect('root', 'a0') }, ['3-2'])] },
  ],
})

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

/** What placing gave, when it placed. */
function placedOf(result: PlacedFigma) {
  if (!result.placed) throw new Error(`not placed: ${JSON.stringify(result)}`)
  return result
}

/** How `promise` has settled once the microtasks and timers waiting have run: 'saved', why it failed, or 'waiting'. */
async function settled(promise: Promise<unknown>) {
  let state: unknown = 'waiting'
  promise.then(
    (value) => (state = value),
    (error: unknown) => (state = error instanceof NotSaved ? error.why : error),
  )
  await new Promise((resolve) => setTimeout(resolve, 0))
  return state
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

/** A held tab of a local server on the two pages, another tab on it, and the test editor on the held one. */
async function heldEditor() {
  const parsed = parseDesign(PAGES)
  if (!parsed.success) throw new Error(parsed.errors.join('\n'))
  const server = openLocalServer(parsed.design)
  const store = server.join({ held: true })
  const other = openSession(server.join())
  const t = await open({ store })
  return { t, store, other }
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

  it('resolves confirmed saved only once the sync server has stored the step', async () => {
    const { t, store } = await heldEditor()
    const { confirmed } = placedOf(await t.core.placeFigma(LINK))
    expect(await settled(confirmed)).toBe('waiting')
    store.deliver()
    expect(await settled(confirmed)).toBe('saved')
  })

  it('fails confirmed as rejected when the server refuses the step: nothing of it stays, on neither stack', async () => {
    const { t, store, other } = await heldEditor()
    const { ids, confirmed } = placedOf(await t.core.placeFigma(LINK))
    // Another tab deletes the shown page, and the server takes that first.
    other.run('page.delete', { id: 'p1' })
    store.deliver()
    expect(await settled(confirmed)).toBe('rejected')
    expect([t.core.design().frames[ids.get('3:1') ?? ''], t.core.canUndo(), t.core.canRedo()]).toEqual([
      undefined,
      false,
      false,
    ])
  })

  it('fails confirmed as too big for an import past what one step may send, writing nothing', async () => {
    const parsed = parseDesign(PAGES)
    if (!parsed.success) throw new Error(parsed.errors.join('\n'))
    const t = await open({ store: plainStore(parsed.design, { client: { limits: { messageBytes: 20_000 } } }) })
    const before = t.core.design()
    const many = Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`k${i}`, rect('root', 'a0')]))
    const figma = FigmaImport.parse({
      ...LINK,
      pages: [{ ...LINK.pages[0], frames: [frame('3:1', 0, 0, many, Object.keys(many))] }],
    })
    const { confirmed } = placedOf(await t.core.placeFigma(figma))
    expect(await settled(confirmed)).toBe('tooBig')
    expect([t.core.design(), t.core.canUndo()]).toEqual([before, false])
  })

  it('fails confirmed as ended when the editor ends before the server answers', async () => {
    const { t } = await heldEditor()
    const { confirmed } = placedOf(await t.core.placeFigma(LINK))
    t.end()
    opened = opened.filter((e) => e !== t)
    expect(await settled(confirmed)).toBe('ended')
  })
})
