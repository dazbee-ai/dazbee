import { afterEach, describe, expect, it } from 'vitest'

import type { DrawnConnector } from '../../canvas/redraw.ts'
import { type TestEditor, testEditor, type TestEditorOptions } from '../../test-editor.ts'
import { CONNECTED, curvePoint } from '../../test-sections.ts'

let opened: TestEditor | null = null
afterEach(() => {
  opened?.end()
  opened = null
})

async function open(options: TestEditorOptions = {}) {
  opened = await testEditor(CONNECTED, options)
  return opened
}

/** The connectors the stage would draw now, as the redraw hands them to the surface. */
function drawn(editor: TestEditor): DrawnConnector[] {
  let connectors: readonly DrawnConnector[] = []
  editor.core.redraw((_pictures, _ghost, _outlines, handed) => {
    connectors = handed
    return true
  })
  return [...connectors]
}
/** A point on link's curve in the gap between f3 and the outline round f4, off every frame. */
const offFrames = (editor: TestEditor) => curvePoint(editor.core, 'link', 0.05)

describe('a click on a connector', () => {
  it('picks it, letting the selection go, and it is drawn blue', async () => {
    const editor = await open()
    const { core } = editor
    core.select(['dot'])
    const at = offFrames(editor)
    editor.mouse.click(at.x, at.y)
    expect([core.pickedConnector(), core.selection(), core.pickedSection()]).toEqual(['link', [], null])
    expect(drawn(editor).map((d) => d.picked)).toEqual([true])
  })

  it('where a frame is drawn over the curve picks no connector: the frame covers it', async () => {
    const editor = await open()
    const under = curvePoint(editor.core, 'link', 0.5)
    editor.mouse.click(under.x, under.y)
    expect(editor.core.pickedConnector()).toBeNull()
    expect(editor.core.pickedFrame()).toBe('f4')
  })

  it('picks nothing in a tab that may only view, which still sees the connector', async () => {
    const editor = await open({ access: { readOnly: () => true, onChange: () => () => {} } })
    const at = offFrames(editor)
    editor.mouse.click(at.x, at.y)
    expect(editor.core.pickedConnector()).toBeNull()
    expect(drawn(editor)).toHaveLength(1)
  })
})

describe('the picked connector’s keys', () => {
  it('Delete removes it as one undo step, which brings it back', async () => {
    const editor = await open()
    const { core } = editor
    core.pickConnector('link')
    expect(core.actionReady('delete')).toBe(true)
    editor.press('delete')
    expect([core.design().connectors, core.pickedConnector()]).toEqual([{}, null])
    expect(core.undoName()).toBe('delete')
    editor.press('undo')
    expect(Object.keys(core.design().connectors)).toEqual(['link'])
  })

  it('Esc lets it go, and Duplicate does nothing to it', async () => {
    const editor = await open()
    const { core } = editor
    core.pickConnector('link')
    expect(core.actionReady('duplicate')).toBe(false)
    editor.press('deselect')
    expect(core.pickedConnector()).toBeNull()
    expect(core.canUndo()).toBe(false)
  })
})

describe('a connector’s ends', () => {
  it('moving one redraws the curve between the sides now nearest each other', async () => {
    const editor = await open()
    const { core } = editor
    const [side] = drawn(editor)
    expect(side?.curve.from.y).toBe(side?.curve.to.y)
    // f5 goes below f3: the curve now runs down from f3's bottom to f5's top.
    core.session.run('frame.update', { frameId: 'f5', x: 1200, y: 1000 })
    const [stacked] = drawn(editor)
    expect(stacked?.curve.from.x).toBe(stacked?.curve.to.x)
    expect(stacked?.curve.from.y).toBeLessThan(stacked?.curve.to.y ?? 0)
  })

  it('deleting one takes the connector off the canvas, and one undo brings both back', async () => {
    const editor = await open()
    const { core } = editor
    core.pickFrame('f5')
    editor.press('delete')
    expect([core.design().frames.f5, drawn(editor)]).toEqual([undefined, []])
    editor.press('undo')
    expect(core.design().frames.f5).toBeDefined()
    expect(drawn(editor)).toHaveLength(1)
  })
})
