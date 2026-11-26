// What a right-click on the stage picks and opens the stage menu for, held against the editor's core
// opened in Node: a layer's actions on a layer, a frame's actions on its empty area or its label,
// and Show hidden layers outside every frame, each offering Show hidden layers while the design has
// hidden layers or they show.
import { afterEach, describe, expect, it } from 'vitest'

import type { Editor } from '@dazbee/editor'
import { type TestEditor, testEditor } from '@dazbee/editor/test-editor'
import { frameDesign, type Seeded } from '@dazbee/editor/test-matrix'
import { labelPoint, linePoint, SECTIONS } from '@dazbee/editor/test-sections'
import type { DesignInput } from '@dazbee/schema'

import { rightClickAt } from './stage-menu-at.ts'

const BLUE = { type: 'solid' as const, color: '#2F6BFFFF' }
/** A shape 100 square at 100, 100 in its frame, shown unless told. */
const shape = (parentId: string, visible = true): Seeded => ({
  type: 'graphic',
  parentId,
  index: 'a0',
  name: 'Shape',
  props: { x: 100, y: 100, width: 100, height: 100, shape: { kind: 'rect' }, fills: [BLUE], visible },
})
const SQUARE = frameDesign({ name: 'Right-click', nodes: { box: shape('sq') } })
/** Square holding a shown shape, and Apart below it holding a hidden one. */
const DESIGN = {
  ...SQUARE,
  frames: {
    ...SQUARE.frames,
    apart: { pageId: 'p1', name: 'Apart', width: 500, height: 500, x: 0, y: 1300, order: 'a1' },
  },
  nodes: { ...SQUARE.nodes, gone: { ...shape('apart', false), link: 'gone' } },
} as DesignInput
const NO_LABEL = { labelFrameId: undefined }

/**
 * The test editor as the page's `Editor`, its stage at the page's top left corner so a client point
 * is a stage point. Only the members a right-click reads are real.
 */
function asEditor({ core }: TestEditor): Editor {
  const screenPoint: Editor['screenPoint'] = (x, y, frameId) => core.stagePoint(x, y, frameId)
  return { ...core, screenPoint } as unknown as Editor
}

let opened: TestEditor[] = []
async function open(design: DesignInput = DESIGN, options: Parameters<typeof testEditor>[1] = {}) {
  const t = await testEditor(design, options)
  opened.push(t)
  return { t, editor: asEditor(t) }
}

afterEach(() => {
  for (const t of opened) t.end()
  opened = []
})

describe('rightClickAt', () => {
  it('picks the section whose title or outline line is right-clicked and opens its actions', async () => {
    const { t, editor } = await open(SECTIONS)
    t.core.select(['dot'])
    const title = labelPoint(t.core, 'f1')
    expect(rightClickAt(editor, title, { labelFrameId: undefined, titled: 'sale' })).toMatchObject({
      on: 'section',
      sectionId: 'sale',
      frameId: null,
    })
    expect([t.core.pickedSection(), t.core.selection()]).toEqual(['sale', []])
    const line = linePoint(t.core, 'solo')
    expect(rightClickAt(editor, line, NO_LABEL)).toMatchObject({ on: 'section', sectionId: 'solo' })
    expect(t.core.pickedSection()).toBe('solo')
  })

  it("leaves a frame's label to the frame, though a section's title is under it", async () => {
    const { t, editor } = await open(SECTIONS)
    const at = labelPoint(t.core, 'f1')
    expect(rightClickAt(editor, at, { labelFrameId: 'f1', titled: 'sale' })).toMatchObject({
      on: 'frame',
      frameId: 'f1',
    })
  })

  it('picks the frame whose empty area is right-clicked and opens its actions, with Show hidden layers while the design has some', async () => {
    const { t, editor } = await open()
    const at = t.core.stagePoint(800, 800, 'sq')
    expect(rightClickAt(editor, at, NO_LABEL)).toEqual({ at, on: 'frame', frameId: 'sq', layers: [], hidden: true })
    expect(t.core.pickedFrame()).toBe('sq')
    expect(t.core.selection()).toEqual([])
    const plain = await open(SQUARE)
    expect(rightClickAt(plain.editor, at, NO_LABEL)).toEqual({
      at,
      on: 'frame',
      frameId: 'sq',
      layers: [],
      hidden: false,
    })
  })

  it('picks the frame whose label is right-clicked, over a layer or a frame under the label', async () => {
    const { t, editor } = await open()
    t.core.pickFrame('sq')
    // Apart's label drawn over Square's shape, as labels are drawn over the canvas.
    const at = t.core.stagePoint(150, 150, 'sq')
    expect(rightClickAt(editor, at, { labelFrameId: 'apart' })).toEqual({
      at,
      on: 'frame',
      frameId: 'apart',
      layers: [],
      hidden: true,
    })
    expect(t.core.pickedFrame()).toBe('apart')
    expect(t.core.selection()).toEqual([])
  })

  it('lets the selection go as it picks the frame', async () => {
    const { t, editor } = await open()
    t.core.select(['box'])
    rightClickAt(editor, t.core.stagePoint(800, 800, 'sq'), NO_LABEL)
    expect(t.core.selection()).toEqual([])
    expect(t.core.pickedFrame()).toBe('sq')
  })

  it('gives a layer’s actions on a layer, selecting it and picking no frame, with Show hidden layers too', async () => {
    const { t, editor } = await open()
    const at = t.core.stagePoint(150, 150, 'sq')
    expect(rightClickAt(editor, at, NO_LABEL)).toEqual({
      at,
      on: 'layer',
      frameId: null,
      layers: [{ id: 'box', depth: 0, frameId: 'sq' }],
      hidden: true,
    })
    expect(t.core.selection()).toEqual(['box'])
    expect(t.core.pickedFrame()).toBeNull()
  })

  it('offers Show hidden layers alone outside every frame, picking nothing, to a tab that may only view too', async () => {
    const { t, editor } = await open()
    const below = t.core.stagePoint(250, 600, 'apart')
    const beside = t.core.stagePoint(1200, 100, 'sq')
    for (const at of [below, beside]) {
      expect(rightClickAt(editor, at, NO_LABEL)).toEqual({ at, on: 'canvas', frameId: null, layers: [], hidden: true })
    }
    expect(t.core.pickedFrame()).toBeNull()
    const access = { readOnly: () => true, onChange: () => () => {} }
    const viewing = await open(DESIGN, { access })
    expect(rightClickAt(viewing.editor, below, NO_LABEL)).toEqual({
      at: below,
      on: 'canvas',
      frameId: null,
      layers: [],
      hidden: true,
    })
  })

  it('opens nothing outside every frame while the design has no hidden layers, and offers it while they show, to turn it off', async () => {
    const plain = await open(SQUARE)
    expect(rightClickAt(plain.editor, plain.t.core.stagePoint(1200, 100, 'sq'), NO_LABEL)).toBeNull()
    const { t, editor } = await open()
    t.core.setHiddenShown(true)
    t.core.setHidden(['gone'], false)
    const beside = t.core.stagePoint(1200, 100, 'sq')
    expect(rightClickAt(editor, beside, NO_LABEL)).toEqual({
      at: beside,
      on: 'canvas',
      frameId: null,
      layers: [],
      hidden: true,
    })
  })
})
