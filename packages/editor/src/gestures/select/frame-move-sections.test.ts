import { afterEach, describe, expect, it } from 'vitest'

import type { DesignInput, Point } from '@dazbee/schema'

import { toScreen } from '../../canvas/camera.ts'
import { type TestEditor, testEditor } from '../../test-editor.ts'
import { labelPoint, outlineOf, placeOf, SECTIONS } from '../../test-sections.ts'

let opened: TestEditor | null = null
afterEach(() => {
  opened?.end()
  opened = null
})

/** The sections' design opened on the stage, or a variant of it. */
async function open(design: DesignInput = SECTIONS) {
  opened = await testEditor(design)
  return opened
}

/** The stage point of a page point. */
const onStage = (editor: TestEditor, p: Point) => toScreen(editor.core.camera(), p)

describe('a frame dragged by its name', () => {
  it('joins the section whose outline holds the pointer on drop, and one undo puts it back where it was, in no section', async () => {
    const editor = await open()
    const { core } = editor
    const from = labelPoint(core, 'f3')
    // Into Sale, below its two frames.
    const to = onStage(editor, { x: 500, y: 300 })
    editor.mouse.drag(from, { x: to.x, y: to.y })
    expect(placeOf(core, 'f3')?.sectionId).toBe('sale')
    expect(core.undoName()).toBe('move')
    editor.press('undo')
    expect(placeOf(core, 'f3')).toEqual({ x: 1200, y: 0, sectionId: undefined })
    expect(core.canUndo()).toBe(false)
  })

  it('leaves its section for bare canvas, the section keeping its other frame', async () => {
    const editor = await open()
    const { core } = editor
    const from = labelPoint(core, 'f2')
    editor.mouse.drag(from, { x: from.x, y: from.y + 400 })
    expect(placeOf(core, 'f2')?.sectionId).toBeUndefined()
    expect(core.design().sections.sale).toBeDefined()
    editor.press('undo')
    expect(placeOf(core, 'f2')).toEqual({ x: 600, y: 0, sectionId: 'sale' })
  })

  it('goes straight from one section into another, and one undo puts it back in the first', async () => {
    const editor = await open()
    const { core } = editor
    const from = labelPoint(core, 'f2')
    const into = outlineOf(core, 'solo')
    editor.mouse.drag(from, { x: into.x + into.width / 2, y: into.y + into.height / 2 })
    expect(placeOf(core, 'f2')?.sectionId).toBe('solo')
    editor.press('undo')
    expect(placeOf(core, 'f2')).toEqual({ x: 600, y: 0, sectionId: 'sale' })
    expect(core.canUndo()).toBe(false)
  })

  it('stays in its section when nudged 10 px inside it', async () => {
    const editor = await open()
    const { core } = editor
    const from = labelPoint(core, 'f2')
    const zoom = core.camera().zoom
    editor.mouse.drag(from, { x: from.x + 10 * zoom, y: from.y })
    expect(placeOf(core, 'f2')).toEqual({ x: 610, y: 0, sectionId: 'sale' })
  })

  it("never takes a section's only frame out of it, onto bare canvas or into another section", async () => {
    const editor = await open()
    const { core } = editor
    const from = labelPoint(core, 'f4')
    editor.mouse.drag(from, { x: from.x, y: from.y + 400 })
    expect(placeOf(core, 'f4')?.sectionId).toBe('solo')
    const sale = outlineOf(core, 'sale')
    const now = labelPoint(core, 'f4')
    editor.mouse.drag(now, { x: sale.x + sale.width / 2, y: sale.y + sale.height / 2 })
    expect(placeOf(core, 'f4')?.sectionId).toBe('solo')
    expect(core.design().sections.solo).toBeDefined()
  })

  it('joins the newer section where two outlines overlap', async () => {
    // Solo's frame 50 px right of Sale's second frame, so their outlines overlap; Three below them.
    const near: DesignInput = {
      ...SECTIONS,
      frames: {
        ...SECTIONS.frames,
        f3: { ...SECTIONS.frames.f3, x: 0, y: 1000 } as (typeof SECTIONS.frames)[string],
        f4: { ...SECTIONS.frames.f4, x: 1050 } as (typeof SECTIONS.frames)[string],
      },
    }
    const editor = await open(near)
    const { core } = editor
    const sale = outlineOf(core, 'sale')
    const solo = outlineOf(core, 'solo')
    expect(solo.x).toBeLessThan(sale.x + sale.width)
    const overlap = { x: (solo.x + sale.x + sale.width) / 2, y: sale.y + sale.height / 2 }
    editor.mouse.drag(labelPoint(core, 'f5'), overlap)
    expect(placeOf(core, 'f5')?.sectionId).toBe('solo')
  })

  it('lights the outline that would take it while it is dragged, and none once dropped', async () => {
    const editor = await open()
    const { core, modules } = editor
    const from = labelPoint(core, 'f3')
    const to = onStage(editor, { x: 500, y: 300 })
    editor.mouse.move(from.x, from.y)
    editor.mouse.down()
    editor.mouse.move(to.x, to.y, { steps: 4 })
    expect(modules.frameMove.shownSections(modules.pointer.gesture()).lit).toBe('sale')
    editor.mouse.up()
    expect(modules.frameMove.shownSections(modules.pointer.gesture()).lit).toBeNull()
  })
})

describe('the outlines on the stage', () => {
  it('are drawn again when a section is picked or let go, and when a drop keeps a frame in its section', async () => {
    const editor = await open()
    const { core, modules } = editor
    let asked = 0
    modules.view.onRedraw(() => (asked += 1))
    core.pickSection('sale')
    expect(asked).toBeGreaterThan(0)
    // The redraw asked for, as the next animation frame runs it.
    core.redraw()
    asked = 0
    editor.press('deselect')
    expect(asked).toBeGreaterThan(0)
    // A nudge inside its own section: the last move drew the outline lit and as the drag began.
    const from = labelPoint(core, 'f2')
    const zoom = core.camera().zoom
    editor.mouse.move(from.x, from.y)
    editor.mouse.down()
    editor.mouse.move(from.x + 20 * zoom, from.y, { steps: 3 })
    asked = 0
    editor.mouse.up()
    expect(placeOf(core, 'f2')).toEqual({ x: 620, y: 0, sectionId: 'sale' })
    expect(asked).toBeGreaterThan(0)
  })
})
