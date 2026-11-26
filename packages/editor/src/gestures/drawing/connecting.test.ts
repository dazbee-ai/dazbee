import { afterEach, describe, expect, it } from 'vitest'

import { connectorsOf, type DesignInput } from '@dazbee/schema'

import { toScreen } from '../../canvas/camera.ts'
import { connectorsShown, frameEndBox } from '../../canvas/connectors.ts'
import { outlinesOf, sectionsOn } from '../../canvas/sections.ts'
import { type TestEditor, testEditor, type TestEditorOptions } from '../../test-editor.ts'
import { CONNECTED, dotPoint, SECTIONS } from '../../test-sections.ts'
import { DOT_OFFSET, dotsOf, HOVER_REACH } from './connecting.ts'

let opened: TestEditor | null = null
afterEach(() => {
  opened?.end()
  opened = null
})

async function open(design: DesignInput = SECTIONS, options: TestEditorOptions = {}) {
  opened = await testEditor(design, options)
  opened.core.setTool('arrow')
  return opened
}

/** The ids of the connectors the shown page draws, by order. */
const drawnConnectors = (editor: TestEditor) => connectorsOf(editor.core.design(), 'p1').map(([id]) => id)
/** The middle of a frame on the stage. */
function middleOf(editor: TestEditor, frameId: string) {
  const frame = editor.core.design().frames[frameId]
  if (!frame) throw new Error(`no frame ${frameId}`)
  return toScreen(editor.core.camera(), { x: frame.x + frame.width / 2, y: frame.y + frame.height / 2 })
}
/** What the overlay shows of drawing connectors now. */
const shown = (editor: TestEditor) => editor.modules.connecting.shown(editor.modules.pointer.gesture())

describe('the dots', () => {
  it('show 12 px outside the middle of each side of the frame the pointer is over, the top one above its label', async () => {
    const editor = await open()
    const at = middleOf(editor, 'f3')
    editor.mouse.move(at.x, at.y)
    const frame = editor.core.frames().find((f) => f.id === 'f3')
    if (!frame) throw new Error('no f3')
    const box = frameEndBox(frame, editor.core.camera())
    expect(shown(editor).dots).toEqual(dotsOf(box))
    expect(shown(editor).dots[0]).toEqual({ x: box.x + box.width / 2, y: box.y - DOT_OFFSET })
  })

  it('stay while the pointer is within 24 px of the frame, so they can be reached, and go past that', async () => {
    const editor = await open()
    const right = dotPoint(editor.core, 'f3', 'right')
    editor.mouse.move(right.x, right.y)
    expect(shown(editor).dots).toHaveLength(4)
    const frame = editor.core.frames().find((f) => f.id === 'f3')
    const box = frame && frameEndBox(frame, editor.core.camera())
    if (!box) throw new Error('no f3')
    editor.mouse.move(box.x + box.width + HOVER_REACH + 2, right.y)
    expect(shown(editor).dots).toEqual([])
  })

  it('show round a section near its outline, past its frames’ reach', async () => {
    const editor = await open()
    const outlines = outlinesOf(sectionsOn(editor.core.design(), editor.core.frames()), editor.core.camera())
    const sale = outlines.find((o) => o.id === 'sale')?.box
    if (!sale) throw new Error('no sale')
    const top = dotPoint(editor.core, 'sale', 'top')
    editor.mouse.move(top.x, top.y)
    expect(shown(editor).dots).toEqual(dotsOf(sale))
  })

  it('show only with the Arrow shape', async () => {
    const editor = await open()
    editor.core.setTool('line')
    const at = middleOf(editor, 'f3')
    editor.mouse.move(at.x, at.y)
    expect(shown(editor).dots).toEqual([])
  })

  it('never show to a tab that may only view, and a press on one starts nothing', async () => {
    const editor = await open(CONNECTED, { access: { readOnly: () => true, onChange: () => () => {} } })
    const at = middleOf(editor, 'f1')
    editor.mouse.move(at.x, at.y)
    expect(shown(editor).dots).toEqual([])
    editor.mouse.drag(dotPoint(editor.core, 'f1', 'right'), middleOf(editor, 'f3'))
    expect(drawnConnectors(editor)).toEqual(['link'])
    // Connectors still show to it.
    expect(connectorsShown(editor.core.design(), editor.core.frames(), [], editor.core.camera())).toHaveLength(1)
  })
})

describe('a drag from a dot', () => {
  it('to another frame makes one connector, one undo step, picked, with the select tool back', async () => {
    const editor = await open()
    const { core } = editor
    editor.mouse.drag(dotPoint(core, 'f3', 'right'), middleOf(editor, 'f5'))
    const [id] = drawnConnectors(editor)
    expect(core.design().connectors[id ?? '']).toMatchObject({ pageId: 'p1', from: 'f3', to: 'f5' })
    expect([core.pickedConnector(), core.tool()]).toEqual([id, 'select'])
    expect(core.undoName()).toBe('addConnector')
    editor.press('undo')
    expect(core.design().connectors).toEqual({})
  })

  it('to a section joins the section', async () => {
    const editor = await open()
    const outlines = outlinesOf(sectionsOn(editor.core.design(), editor.core.frames()), editor.core.camera())
    const sale = outlines.find((o) => o.id === 'sale')?.box
    if (!sale) throw new Error('no sale')
    // Its title's row, above its frames.
    editor.mouse.drag(dotPoint(editor.core, 'f5', 'top'), { x: sale.x + sale.width / 2, y: sale.y + 8 })
    expect(Object.values(editor.core.design().connectors)).toMatchObject([{ from: 'f5', to: 'sale' }])
  })

  it('lights the frame under the pointer while dragging, with the curve to it', async () => {
    const editor = await open()
    const { mouse, core } = editor
    const from = dotPoint(core, 'f3', 'right')
    mouse.move(from.x, from.y)
    mouse.down()
    const to = middleOf(editor, 'f5')
    mouse.move(to.x, to.y, { steps: 4 })
    const frame = core.frames().find((f) => f.id === 'f5')
    if (!frame) throw new Error('no f5')
    expect(shown(editor).lit).toEqual({ box: frameEndBox(frame, core.camera()), section: false })
    expect(shown(editor).preview?.to.x).toBeLessThan(frameEndBox(frame, core.camera()).x)
    expect(shown(editor).dots).toEqual([])
    mouse.up()
  })

  it('to bare canvas makes none, and keeps the Arrow shape', async () => {
    const editor = await open()
    const below = middleOf(editor, 'f3')
    editor.mouse.drag(dotPoint(editor.core, 'f3', 'bottom'), { x: below.x, y: below.y + 600 })
    expect(editor.core.design().connectors).toEqual({})
    expect([editor.core.tool(), editor.core.canUndo()]).toEqual(['arrow', false])
  })

  it('to its own section, to itself or to a thing already joined lights nothing and makes nothing', async () => {
    const editor = await open(CONNECTED)
    const { mouse, core } = editor
    const tryDrag = (fromId: string, side: 'top' | 'right' | 'bottom' | 'left', to: { x: number; y: number }) => {
      const from = dotPoint(core, fromId, side)
      mouse.move(from.x, from.y)
      mouse.down()
      mouse.move(to.x, to.y, { steps: 4 })
      const lit = shown(editor).lit
      mouse.up()
      return lit
    }
    const outlines = outlinesOf(sectionsOn(core.design(), core.frames()), core.camera())
    const sale = outlines.find((o) => o.id === 'sale')?.box
    if (!sale) throw new Error('no sale')
    expect(tryDrag('f1', 'bottom', { x: sale.x + sale.width / 2, y: sale.y + 8 })).toBeNull()
    expect(tryDrag('f3', 'bottom', middleOf(editor, 'f3'))).toBeNull()
    expect(tryDrag('f5', 'left', middleOf(editor, 'f3'))).toBeNull()
    expect(drawnConnectors(editor)).toEqual(['link'])
    expect(core.canUndo()).toBe(false)
  })
})

describe('a drag from a dot that does not end', () => {
  /** Presses on f3's right dot and drags over f5, which lights. */
  function dragOverFive(editor: TestEditor) {
    const from = dotPoint(editor.core, 'f3', 'right')
    editor.mouse.move(from.x, from.y)
    editor.mouse.down()
    const to = middleOf(editor, 'f5')
    editor.mouse.move(to.x, to.y, { steps: 4 })
    expect(shown(editor).lit).not.toBeNull()
    return to
  }

  it('makes nothing when Esc drops it', async () => {
    const editor = await open()
    dragOverFive(editor)
    editor.press('deselect')
    editor.mouse.up()
    expect([editor.core.design().connectors, editor.core.tool()]).toEqual([{}, 'arrow'])
  })

  it('makes nothing when the browser takes the pointer away', async () => {
    const editor = await open()
    const at = dragOverFive(editor)
    editor.core.input.pointer({
      type: 'pointercancel',
      at,
      button: 0,
      detail: 0,
      shiftKey: false,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      pointerType: 'mouse',
    })
    expect([editor.core.design().connectors, editor.core.tool()]).toEqual([{}, 'arrow'])
  })
})

describe('the dots of frames close together', () => {
  it('stay on the frame first hovered while the pointer goes to its dot, though another frame is nearer there', async () => {
    const editor = await open()
    const { core, mouse } = editor
    // Zoomed out until the 200 px between frames is 20 px on screen: f3's left dot is nearer f2.
    core.zoomTo(0.1)
    const at = middleOf(editor, 'f3')
    mouse.move(at.x, at.y)
    const left = dotPoint(core, 'f3', 'left')
    mouse.move(left.x, left.y)
    const frame = core.frames().find((f) => f.id === 'f3')
    if (!frame) throw new Error('no f3')
    expect(shown(editor).dots).toEqual(dotsOf(frameEndBox(frame, core.camera())))
    editor.mouse.drag(left, middleOf(editor, 'f5'))
    expect(Object.values(core.design().connectors)).toMatchObject([{ from: 'f3', to: 'f5' }])
  })
})

describe('a press with the Arrow shape away from the dots', () => {
  it('inside a frame still draws an arrow layer', async () => {
    const editor = await open()
    const at = middleOf(editor, 'f3')
    editor.mouse.drag(at, { x: at.x + 40, y: at.y + 10 })
    const arrows = Object.values(editor.core.design().nodes).filter((n) => n.name === 'Arrow')
    expect(arrows).toHaveLength(1)
    expect(editor.core.design().connectors).toEqual({})
  })

  it('on bare canvas does nothing', async () => {
    const editor = await open()
    const at = middleOf(editor, 'f3')
    editor.mouse.drag({ x: at.x, y: at.y + 600 }, { x: at.x + 40, y: at.y + 610 })
    expect(editor.core.canUndo()).toBe(false)
  })
})
