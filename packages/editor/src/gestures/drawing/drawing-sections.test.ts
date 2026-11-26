import { afterEach, describe, expect, it } from 'vitest'

import type { DesignInput } from '@dazbee/schema'

import { toScreen } from '../../canvas/camera.ts'
import { type TestEditor, testEditor } from '../../test-editor.ts'
import { outlineOf, placeOf, SECTIONS } from '../../test-sections.ts'

let opened: TestEditor | null = null
afterEach(() => {
  opened?.end()
  opened = null
})

/** The sections' design with every frame in no section: five loose frames in a row. */
const LOOSE: DesignInput = {
  ...SECTIONS,
  sections: {},
  frames: Object.fromEntries(
    Object.entries(SECTIONS.frames).map(([id, frame]) => [id, { ...frame, sectionId: undefined }]),
  ) as DesignInput['frames'],
}

async function open(design: DesignInput) {
  opened = await testEditor(design)
  return opened
}

/** Drags with the tool in use between two page points. */
function dragOnPage(editor: TestEditor, from: { x: number; y: number }, to: { x: number; y: number }) {
  const camera = editor.core.camera()
  editor.mouse.drag(toScreen(camera, from), toScreen(camera, to))
}

describe('the Section tool', () => {
  it('makes one section of the frames whose middle its box holds, named "Section 1", picked, with its title ready to type, and the select tool back', async () => {
    const editor = await open(LOOSE)
    const { core } = editor
    const renames: string[] = []
    core.onSectionRename((id) => renames.push(id))
    editor.press('toolSection')
    expect(core.tool()).toBe('section')
    // Round the middles of f2, f3 and f4, short of f1's and f5's.
    dragOnPage(editor, { x: 500, y: -100 }, { x: 2100, y: 500 })
    const sections = Object.entries(core.design().sections)
    expect(sections.map(([, s]) => s.title)).toEqual(['Section 1'])
    const [id] = sections[0] ?? []
    expect(['f1', 'f2', 'f3', 'f4', 'f5'].map((f) => placeOf(core, f)?.sectionId)).toEqual([
      undefined,
      id,
      id,
      id,
      undefined,
    ])
    expect([core.pickedSection(), renames, core.tool()]).toEqual([id, [id], 'select'])
    expect(core.undoName()).toBe('addSection')
    editor.press('undo')
    expect(core.design().sections).toEqual({})
  })

  it('makes nothing round no frame, says "Draw around frames" and keeps the tool', async () => {
    const editor = await open(LOOSE)
    const { core } = editor
    editor.press('toolSection')
    dragOnPage(editor, { x: 0, y: 600 }, { x: 900, y: 900 })
    expect(core.design().sections).toEqual({})
    expect(editor.told).toEqual([['drawAroundFrames']])
    expect(core.tool()).toBe('section')
    expect(core.canUndo()).toBe(false)
  })

  it('makes nothing and says nothing for a click, keeping the tool', async () => {
    const editor = await open(LOOSE)
    const { core } = editor
    editor.press('toolSection')
    const at = toScreen(core.camera(), { x: 200, y: 200 })
    editor.mouse.click(at.x, at.y)
    expect([core.design().sections, editor.told, core.tool()]).toEqual([{}, [], 'section'])
  })
})

describe('a frame drawn with the Frame tool', () => {
  it('joins the section whose outline holds its middle, and one drawn outside joins none', async () => {
    const editor = await open(SECTIONS)
    const { core } = editor
    const before = new Set(Object.keys(core.design().frames))
    const made = () => Object.keys(core.design().frames).filter((id) => !before.has(id))
    // Below Sale's frames, inside its outline: the outline reaches 24 screen px below them.
    const sale = outlineOf(core, 'sale')
    const camera = core.camera()
    const bottom = (sale.y + sale.height - 4 - camera.y) / camera.zoom
    editor.press('toolFrame')
    dragOnPage(editor, { x: 100, y: bottom - 20 }, { x: 300, y: bottom + 20 })
    const [inside] = made()
    expect(placeOf(core, inside ?? '')?.sectionId).toBe('sale')
    before.add(inside ?? '')
    editor.press('toolFrame')
    dragOnPage(editor, { x: 100, y: 1500 }, { x: 300, y: 1700 })
    const [outside] = made()
    expect(outside).toBeDefined()
    expect(placeOf(core, outside ?? '')?.sectionId).toBeUndefined()
  })
})

describe('Add a frame', () => {
  it("adds to the picked frame's section, beside it, and as before with a frame in none picked", async () => {
    const editor = await open(SECTIONS)
    const { core } = editor
    core.pickFrame('f2')
    const id = core.addFrame({ width: 300, height: 250 }) ?? ''
    expect(placeOf(core, id)?.sectionId).toBe('sale')
    core.pickFrame('f3')
    const loose = core.addFrame({ width: 300, height: 250 }) ?? ''
    expect(placeOf(core, loose)?.sectionId).toBeUndefined()
  })
})

describe('fitSection', () => {
  it("fits a section's frames in view", async () => {
    const editor = await open(SECTIONS)
    const { core } = editor
    core.fitSection('solo')
    const box = outlineOf(core, 'solo')
    expect(box.x).toBeGreaterThanOrEqual(0)
    // Its title is in view too, above the frames.
    expect(box.y).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(core.viewport().width)
    // One 400 px frame fills far more of the stage than the five did.
    expect(box.width).toBeGreaterThan(core.viewport().width / 3)
  })
})
