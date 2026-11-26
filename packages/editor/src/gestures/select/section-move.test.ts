import { afterEach, describe, expect, it } from 'vitest'

import { type TestEditor, testEditor, type TestEditorOptions } from '../../test-editor.ts'
import { insidePoint, linePoint, outlineOf, placeOf, SECTIONS, titlePoint } from '../../test-sections.ts'

let opened: TestEditor | null = null
afterEach(() => {
  opened?.end()
  opened = null
})

async function open(options: TestEditorOptions = {}) {
  opened = await testEditor(SECTIONS, options)
  return opened
}

/** Where Sale's two frames are on the page. */
const saleAt = (editor: TestEditor) => [placeOf(editor.core, 'f1'), placeOf(editor.core, 'f2')]

describe('a press on a section', () => {
  it('picks it on its title or its outline line, letting the selection go', async () => {
    const editor = await open()
    const { core } = editor
    core.select(['dot'])
    const title = titlePoint(core, 'sale')
    editor.mouse.click(title.x, title.y)
    expect([core.pickedSection(), core.pickedFrame(), core.selection()]).toEqual(['sale', null, []])
    core.pickSection(null)
    const line = linePoint(core, 'solo')
    editor.mouse.click(line.x, line.y)
    expect(core.pickedSection()).toBe('solo')
  })

  it('starts a marquee on bare space inside it, as on empty canvas, letting a picked section go', async () => {
    const editor = await open()
    const { core, modules } = editor
    core.pickSection('sale')
    const inside = insidePoint(core, 'sale')
    editor.mouse.move(inside.x, inside.y)
    editor.mouse.down()
    expect(modules.pointer.gesture()?.kind).toBe('marquee')
    editor.mouse.up()
    expect(core.pickedSection()).toBeNull()
  })

  it('asks to rename it after a double click on its title', async () => {
    const editor = await open()
    const { core } = editor
    const renames: string[] = []
    core.onSectionRename((sectionId) => renames.push(sectionId))
    const title = titlePoint(core, 'sale')
    editor.mouse.dblclick(title.x, title.y)
    expect(renames).toEqual(['sale'])
    expect(core.pickedSection()).toBe('sale')
  })
})

describe('a drag of a section by its title', () => {
  it('moves all its frames as one undo step, Shift keeping it to one axis', async () => {
    const editor = await open()
    const { core } = editor
    const zoom = core.camera().zoom
    const title = titlePoint(core, 'sale')
    editor.mouse.drag(title, { x: title.x + 100 * zoom, y: title.y + 50 * zoom })
    expect(saleAt(editor)).toEqual([
      { x: 100, y: 50, sectionId: 'sale' },
      { x: 700, y: 50, sectionId: 'sale' },
    ])
    expect(placeOf(core, 'f3')).toMatchObject({ x: 1200, y: 0 })
    expect(core.undoName()).toBe('move')
    editor.press('undo')
    expect(saleAt(editor)).toEqual([
      { x: 0, y: 0, sectionId: 'sale' },
      { x: 600, y: 0, sectionId: 'sale' },
    ])
    expect(core.canUndo()).toBe(false)
    const again = titlePoint(core, 'sale')
    editor.mouse.drag(again, { x: again.x + 100 * zoom, y: again.y + 20 * zoom }, { shift: true })
    expect(saleAt(editor).map((p) => p?.y)).toEqual([0, 0])
  })
})

describe('the keys on a picked section', () => {
  it('nudge it with the arrows, each one undo step', async () => {
    const editor = await open()
    const { core } = editor
    core.pickSection('sale')
    editor.press('nudgeRight')
    editor.press('nudgeDownFar')
    expect(saleAt(editor).map((p) => [p?.x, p?.y])).toEqual([
      [1, 10],
      [601, 10],
    ])
    editor.press('undo')
    expect(placeOf(core, 'f1')).toMatchObject({ x: 1, y: 0 })
  })

  it('ungroup it with Delete, keeping its frames where they are', async () => {
    const editor = await open()
    const { core } = editor
    core.pickSection('sale')
    editor.press('delete')
    expect(core.design().sections.sale).toBeUndefined()
    // The undo and redo say what the key did to the section.
    expect(core.undoName()).toBe('ungroupSection')
    expect(saleAt(editor)).toEqual([
      { x: 0, y: 0, sectionId: undefined },
      { x: 600, y: 0, sectionId: undefined },
    ])
    expect(core.pickedSection()).toBeNull()
    editor.press('undo')
    expect(placeOf(core, 'f1')?.sectionId).toBe('sale')
  })

  it('copy it to its right with Ctrl+D and pick the copy', async () => {
    const editor = await open()
    const { core } = editor
    // Zoomed out, where FRAME_GAP alone is less than the outlines' padding on screen.
    core.zoomTo(0.15)
    core.pickSection('solo')
    editor.press('duplicate')
    const copy = core.pickedSection()
    expect(core.undoName()).toBe('duplicateSection')
    expect(copy).not.toBeNull()
    expect(copy).not.toBe('solo')
    expect(core.design().sections[copy ?? '']?.title).toBe('Solo copy')
    const [copied] = Object.entries(core.design().frames).filter(([, f]) => f.sectionId === copy)
    expect(copied?.[1].x).toBeGreaterThan(1800 + 400)
    // The copy's outline sits clear of the original's at the zoom it was made at, the title row included.
    core.redraw()
    const [solo, made] = [outlineOf(core, 'solo'), outlineOf(core, copy ?? '')]
    expect(made.x).toBeGreaterThan(solo.x + solo.width)
    editor.press('undo')
    expect(core.design().sections[copy ?? '']).toBeUndefined()
  })

  it('let it go with Esc, and ask to rename it with F2, as for a picked frame', async () => {
    const editor = await open()
    const { core } = editor
    const sections: string[] = []
    const frames: string[] = []
    core.onSectionRename((id) => sections.push(id))
    core.onFrameRename((id) => frames.push(id))
    core.pickSection('sale')
    editor.press('rename')
    core.renamed()
    editor.press('deselect')
    expect(core.pickedSection()).toBeNull()
    core.pickFrame('f3')
    editor.press('rename')
    expect([sections, frames]).toEqual([['sale'], ['f3']])
  })
})

describe('Delete section and frames', () => {
  it('removes the section, its frames and their layers, and one undo brings everything back', async () => {
    const editor = await open()
    const { core } = editor
    const before = JSON.stringify(core.design())
    core.session.run('section.delete', { sectionId: 'sale' })
    expect([core.design().sections.sale, core.design().frames.f1, core.design().nodes.dot]).toEqual([
      undefined,
      undefined,
      undefined,
    ])
    editor.press('undo')
    expect(JSON.parse(JSON.stringify(core.design()))).toEqual(JSON.parse(before))
  })
})

describe('a Reviewer', () => {
  it('picks a section but moves none, by its title or the keys', async () => {
    const editor = await open({ access: { readOnly: () => true, onChange: () => () => {} } })
    const { core } = editor
    const zoom = core.camera().zoom
    const title = titlePoint(core, 'sale')
    editor.mouse.drag(title, { x: title.x + 100 * zoom, y: title.y })
    expect(core.pickedSection()).toBe('sale')
    editor.press('nudgeRight')
    editor.press('delete')
    expect(saleAt(editor)).toEqual([
      { x: 0, y: 0, sectionId: 'sale' },
      { x: 600, y: 0, sectionId: 'sale' },
    ])
    expect(core.tool()).toBe('select')
    editor.press('toolSection')
    expect(core.tool()).toBe('select')
  })
})
