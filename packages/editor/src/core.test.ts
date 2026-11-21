import { describe, expect, it, vi } from 'vitest'

import { brokenDocument, expectInvariants } from '@dazbee/doc/test-invariants'
import { openTestStore } from '@dazbee/doc/test-store'
import { loadFontFiles } from '@dazbee/fonts/node'
import { resourceCache } from '@dazbee/renderer'
import { loadCanvasKit } from '@dazbee/renderer/node'
import { ALL_PLATFORMS, LAYER_CLIPBOARD_TYPE, parseDesign, type Point, type SafeZoneChoice } from '@dazbee/schema'

import { labelBox } from './canvas/frames.ts'
import { openEditorCore } from './core.ts'
import { NO_FONTS } from './font-loads.ts'
import { type ShortcutAction, SHORTCUTS, stepOf } from './shortcuts.ts'
import { DESIGN, WORDS } from './test-actions.ts'
import { around, DESIGNS, ON_A_BOX, openPhotoPages, run, stored, textOf } from './test-core.ts'
import { testEditor } from './test-editor.ts'
import { withFaulty } from './test-faults.ts'

describe('buildCore, opened in Node with nothing stubbed', () => {
  /** The actions that changed the design, and those that changed anything, in some design. */
  const wrote = new Set<ShortcutAction>()
  const acted = new Set<ShortcutAction>()

  describe.each(Object.entries(DESIGNS))('on %s', (_name, { design, usual }) => {
    it.each(SHORTCUTS.map((s) => s.action))(
      '%s leaves a design that keeps its invariants, names its undo step as the shortcut table does, and undo gives the design back',
      async (action) => {
        const editor = await testEditor(design)
        const { core } = editor
        core.select(ON_A_BOX.includes(action) ? ['row'] : usual)
        core.redraw()
        // Undo and redo have a step to act on: a nudge, undone for redo.
        if (action === 'undo' || action === 'redo') editor.press('nudgeRight')
        if (action === 'redo') editor.press('undo')
        // The select tool's key and the fit's have something to change: another tool, another zoom.
        if (action === 'toolSelect') core.setTool('rect')
        if (action === 'zoomToFit') core.zoomIn()
        const before = stored(editor)
        const beforeAround = around(editor)

        run(editor, action)

        expectInvariants(core.design())
        expect(brokenDocument(core.store)).toEqual([])
        const changed = stored(editor) !== before
        if (changed) wrote.add(action)
        if (changed || around(editor) !== beforeAround) acted.add(action)
        if (changed) {
          core.settle()
          // The step undo takes back is named as the shortcut table names the action's.
          if (action !== 'undo' && action !== 'redo') expect(core.undoName()).toBe(stepOf(action))
          editor.press(action === 'undo' ? 'redo' : 'undo')
          expect(JSON.parse(stored(editor))).toEqual(JSON.parse(before))
        }
        editor.end()
      },
    )
  })

  it('every action of the shortcut table did something in one of the designs, but those with nothing to act on there', () => {
    // The page's menu lists the layers under the pointer, the page starts picking a colour from a
    // panel's eyedropper and opens Find and replace, the Versions card, Assets, Quick actions and the shortcuts list; no path is selected, no
    // style was copied, the linked copies there are alike, no layer there shares a fill or a
    // font with another (actions-across-frames.test.ts selects them), and none is hidden, so the
    // hidden layers have none to show (the hiddenShown tests below show some). Copy as PNG writes only the
    // system clipboard, which the page's side writes (clipboard-events.test.ts).
    expect(SHORTCUTS.map((s) => s.action).filter((action) => !acted.has(action))).toEqual([
      'copyPng',
      'selectSameFill',
      'selectSameFont',
      'findReplace',
      'selectLayer',
      'editPoints',
      'pasteStyle',
      'saveVersion',
      'pickColour',
      'styleToLinked',
      'textToLinked',
      'toggleHiddenShown',
      'showVersions',
      'assets',
      'quickActions',
      'shortcuts',
    ])
    expect(wrote.size).toBe(48)
  })

  it("a press on a frame's label picks the frame, a drag from it moves the frame, and a double click there asks for its rename", async () => {
    const editor = await testEditor(DESIGN)
    const { core } = editor
    const wide = core.frames().find((frame) => frame.id === 'wide')
    const row = wide && labelBox(wide, core.camera())
    if (!wide || !row) throw new Error('the wide frame has no label on the stage')
    const on = { x: row.x + 4, y: row.y + row.height / 2 }
    editor.mouse.click(on.x, on.y)
    expect([core.pickedFrame(), core.selection()]).toEqual(['wide', []])

    const zoom = core.camera().zoom
    editor.mouse.drag(on, { x: on.x + 100 * zoom, y: on.y + 50 * zoom })
    expect(core.design().frames.wide).toMatchObject({ x: wide.x + 100, y: wide.y + 50 })
    editor.press('undo')
    expect(core.design().frames.wide).toMatchObject({ x: wide.x, y: wide.y })

    const renames: string[] = []
    core.onFrameRename((frameId) => renames.push(frameId))
    editor.mouse.dblclick(on.x, on.y)
    expect(renames).toEqual(['wide'])
    editor.end()
  })

  it('typing two characters into a text writes them at the caret as one undo step', async () => {
    const editor = await testEditor(WORDS)
    const { core } = editor
    core.select(['words'])
    editor.press('goIn')
    editor.keys.press('End')
    editor.keys.press('a')
    editor.keys.press('Shift+KeyB')
    expect(textOf(editor)).toBe('Hello thereaB')
    expect([core.gesturing(), core.undoName()]).toEqual([true, 'editText'])
    editor.keys.press('Escape')
    expect([core.gesturing(), core.selection()]).toEqual([false, ['words']])
    editor.press('undo')
    expect([textOf(editor), core.canUndo()]).toEqual(['Hello there', false])
    editor.end()
  })

  it('a copy gives the selected layers as a payload and keeps them on the device, and a paste of it places copies as one undo step', async () => {
    const editor = await testEditor(DESIGN)
    const { core } = editor
    core.select(['a'])
    const copied = editor.clipboard.copy()
    expect(copied).toMatchObject({ text: 'Rect', data: { [LAYER_CLIPBOARD_TYPE]: expect.any(String) as string } })
    expect([...editor.remembered.keys()]).toEqual(['dazbee.copiedLayers'])
    const before = Object.keys(core.design().nodes)

    expect(editor.clipboard.paste(copied ?? {})).toBe(true)
    const pasted = Object.keys(core.design().nodes).filter((id) => !before.includes(id))
    expect(pasted).toHaveLength(1)
    expect([core.selection(), core.undoName()]).toEqual([pasted, 'paste'])
    expectInvariants(core.design())
    editor.press('undo')
    expect(Object.keys(core.design().nodes)).toEqual(before)
    // Words from elsewhere are text from outside.
    expect(editor.clipboard.paste({ text: 'some words from elsewhere' })).toBe(true)
    expect(core.design().nodes[core.selection()[0] ?? '']).toMatchObject({
      type: 'text',
      name: 'some words from elsewhere',
    })
    editor.end()
  })

  it('a command that throws in the middle of a drag ends the drag where the press found the layer, with one notice, and later moves reach no drag', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const editor = await testEditor(DESIGN)
    const { core } = editor
    const [from, on, to] = [150, 200, 260].map((x) => core.stagePoint(x, 150, 'sq')) as [Point, Point, Point]
    editor.mouse.move(from.x, from.y)
    editor.mouse.down()
    editor.mouse.move(on.x, on.y)
    expect([core.boxOf('a')?.x, core.busy(), core.gesturing()]).toEqual([150, true, true])

    let thrown: unknown
    try {
      withFaulty('node.update', () => editor.mouse.move(to.x, to.y))
    } catch (error) {
      thrown = error
    }
    expect(thrown).toMatchObject({ name: 'CommandFault', command: 'node.update' })
    expect([core.boxOf('a')?.x, core.busy(), core.gesturing(), core.canUndo()]).toEqual([100, false, false, false])
    expect(editor.told).toEqual([['notApplied']])
    expect(logged).toHaveBeenCalledTimes(1)
    expectInvariants(core.design())
    expect(brokenDocument(core.store)).toEqual([])

    editor.mouse.move(to.x + 20, to.y)
    editor.mouse.up()
    expect([core.boxOf('a')?.x, core.canUndo()]).toEqual([100, false])
    logged.mockRestore()
    editor.end()
  })

  it('spotAt gives the frame under a stage point and the design pixel there, and null off every frame', async () => {
    const editor = await testEditor(DESIGN)
    const { core } = editor
    expect(core.spotAt(core.stagePoint(10, 20, 'wide'))).toEqual({
      frameId: 'wide',
      x: expect.closeTo(10) as number,
      y: expect.closeTo(20) as number,
    })
    expect(core.spotAt({ x: -5, y: -5 })).toBeNull()
    editor.end()
  })

  it('aborting its signal frees what it made: a thumbnail is let go, a listener hears no more, and a later change to the document reaches neither the session nor a redraw', async () => {
    const revoked = vi.spyOn(URL, 'revokeObjectURL')
    const editor = await testEditor(DESIGN)
    const { core, modules } = editor
    const thumbnail = core.layerThumbnail('a')
    const heard: string[] = []
    modules.view.onRedraw(() => heard.push('redraw'))
    core.onTool((tool) => heard.push(tool))
    /** Renames the design in the document itself, as another tab's change arrives. */
    const rename = (name: string) => core.store.transact(() => core.store.setMeta('name', name))
    rename('Renamed')
    core.setTool('rect')
    expect([heard, core.design().meta.name]).toEqual([['redraw', 'rect'], 'Renamed'])
    const changes = core.session.changes()

    editor.end()
    rename('Renamed again')
    core.setTool('ellipse')
    expect([heard, core.session.changes()]).toEqual([['redraw', 'rect'], changes])
    expect([thumbnail === null, revoked.mock.calls]).toEqual([false, [[thumbnail]]])
    revoked.mockRestore()
  })

  it('Escape during a drag past the slop puts the layer back where the press found it, the selection as the press found it, with no undo step, and the moves and release after it change nothing', async () => {
    const editor = await testEditor(DESIGN)
    const { core, mouse } = editor
    core.setSnapping(false)
    core.select(['b'])
    const [from, to] = [150, 210].map((x) => core.stagePoint(x, 150, 'sq')) as [Point, Point]
    mouse.move(from.x, from.y)
    mouse.down()
    mouse.move(to.x, to.y + 30, { steps: 4 })
    expect([core.boxOf('a')?.x, core.busy()]).toEqual([160, true])

    editor.keys.press('Escape')
    expect([core.boxOf('a'), core.busy(), core.selection(), core.canUndo()]).toEqual([
      { x: 100, y: 100, width: 100, height: 100 },
      false,
      ['b'],
      false,
    ])
    mouse.move(to.x + 30, to.y + 60, { steps: 2 })
    mouse.up()
    expect([core.boxOf('a')?.x, core.selection(), core.canUndo()]).toEqual([100, ['b'], false])
    editor.end()
  })

  it('a click and a right-click over a locked layer under a selected layer at opacity 0 keep the selection, and pick the locked one once it is let go', async () => {
    const graphic = (index: string, box: { x: number; y: number; width: number; height: number }, extra = {}) => ({
      type: 'graphic' as const,
      parentId: 'sq',
      index,
      name: index,
      link: index,
      props: { ...box, shape: { kind: 'rect' as const }, ...extra },
    })
    const editor = await testEditor({
      ...DESIGN,
      nodes: {
        ...DESIGN.nodes,
        floor: { ...graphic('a5', { x: 100, y: 850, width: 400, height: 200 }), lock: { move: true } },
        zero: graphic('a6', { x: 150, y: 880, width: 200, height: 100 }, { opacity: 0 }),
      },
    })
    const { core, mouse } = editor
    const at = core.stagePoint(200, 900, 'sq')
    core.select(['zero'])
    expect(core.selectAt(at)).toEqual(['zero'])
    mouse.click(at.x, at.y)
    expect(core.selection()).toEqual(['zero'])
    core.select([])
    expect(core.selectAt(at)).toEqual(['floor'])
    editor.end()
  })

  it("a click on a frame's empty area or on its label picks the frame, the camera and the design left as they were", async () => {
    const editor = await testEditor(DESIGN)
    const { core } = editor
    const still = core.camera()
    const empty = core.stagePoint(1000, 1000, 'sq')
    editor.mouse.click(empty.x, empty.y)
    expect([core.pickedFrame(), core.selection()]).toEqual(['sq', []])
    const wide = core.frames().find((frame) => frame.id === 'wide')
    const row = wide && labelBox(wide, core.camera())
    if (!row) throw new Error('the wide frame has no label on the stage')
    editor.mouse.click(row.x + 4, row.y + row.height / 2)
    expect([core.pickedFrame(), core.selection()]).toEqual(['wide', []])
    expect([core.camera(), core.canUndo()]).toEqual([still, false])
    editor.end()
  })

  it('selecting layers in a design fitted clear of the edit panel, by click, Shift+click, select all and Escape, changes no camera value', async () => {
    const editor = await testEditor(DESIGN, { insets: { top: 88, right: 324, bottom: 92, left: 96 } })
    const { core } = editor
    const fitted = core.camera()
    const seen: unknown[] = []
    const onWide = core.stagePoint(150, 150, 'wide')
    editor.mouse.click(onWide.x, onWide.y)
    seen.push([core.selection(), core.camera()])
    const onSquare = core.stagePoint(150, 150, 'sq')
    editor.mouse.click(onSquare.x, onSquare.y)
    const onC = core.stagePoint(750, 170, 'sq')
    editor.keys.down('Shift')
    editor.mouse.click(onC.x, onC.y)
    editor.keys.up('Shift')
    seen.push([core.selection(), core.camera()])
    editor.press('selectAll')
    seen.push([core.selection().length > 2, core.camera()])
    editor.press('deselect')
    seen.push([core.selection(), core.camera()])
    expect(seen).toEqual([
      [['wide-a'], fitted],
      [['a', 'c'], fitted],
      [true, fitted],
      [[], fitted],
    ])
    editor.end()
  })

  it("renameFrame with the frame's label above the stage, zoomed in to 375%, pans at the same zoom to show the label, then picks the frame and asks for its rename", async () => {
    const editor = await testEditor(DESIGN)
    const { core, modules } = editor
    const square = () => core.frames().find((frame) => frame.id === 'sq')
    const labelRow = () => {
      const frame = square()
      return frame && labelBox(frame, core.camera())
    }
    core.setCamera({ x: 640 - 540 * 3.75, y: 380 - 540 * 3.75, zoom: 3.75 })
    expect(labelRow()?.y).toBeLessThan(0)
    const renames: string[] = []
    core.onFrameRename((frameId) => renames.push(frameId))

    core.renameFrame('sq')
    const row = labelRow()
    expect([core.camera().zoom, row && row.y >= 0 && row.y + row.height <= 760]).toEqual([3.75, true])
    expect([core.pickedFrame(), modules.selection.renamingFrame(), renames]).toEqual(['sq', 'sq', ['sq']])
    editor.end()
  })

  it('showOnStage glides a part of the stage, in stage pixels, the least to clear the edge a sheet covers, at the same zoom', async () => {
    const editor = await testEditor(DESIGN)
    const { core } = editor
    core.setCamera({ x: -100, y: 40, zoom: 0.5 })
    // On the 760 px stage at 400 to 500 down, under a sheet that covers its bottom 460 px.
    core.showOnStage({ x: 50, y: 400, width: 100, height: 100 }, { bottom: 460 }, false)
    // With no animation frames given it moves straight to the end: its bottom 16 px over the sheet, at 284.
    expect(core.camera()).toEqual({ x: -100, y: 40 + 284 - 500, zoom: 0.5 })
    editor.end()
  })

  it('with Alt held over another layer, an arrow nudges the selection as the arrow alone does and the gap measured follows it', async () => {
    const editor = await testEditor(DESIGN)
    const { core, keys, modules } = editor
    core.select(['a'])
    const over = core.stagePoint(750, 170, 'sq')
    editor.mouse.move(over.x, over.y)
    keys.down('Alt')
    /** Where the selection is, and the gap measured from it to the layer under the pointer. */
    const now = () => {
      const measured = modules.pointer.measured()
      return [core.boxOf('a')?.x, measured && measured.to.x - (measured.from.x + measured.from.width)]
    }
    expect(now()).toEqual([100, 500])
    keys.press('ArrowRight')
    expect(now()).toEqual([101, 499])
    keys.press('ArrowLeft')
    expect(now()).toEqual([100, 500])
    keys.press('Shift+ArrowLeft')
    expect(now()).toEqual([90, 510])
    keys.up('Alt')
    editor.end()
  })

  it('Escape while a rectangle is half drawn takes the new shape away, leaving no undo step and the Rectangle tool kept', async () => {
    const editor = await testEditor(DESIGN)
    const { core, mouse } = editor
    core.select(['a'])
    const before = stored(editor)
    editor.press('toolRect')
    const [from, to] = [core.stagePoint(450, 250, 'sq'), core.stagePoint(570, 330, 'sq')]
    mouse.move(from.x, from.y)
    mouse.down()
    mouse.move(to.x, to.y, { steps: 4 })
    expect(Object.keys(core.design().nodes)).toHaveLength(Object.keys(DESIGN.nodes).length + 1)

    editor.keys.press('Escape')
    mouse.up()
    expect([stored(editor) === before, core.canUndo(), core.tool()]).toEqual([true, false, 'rect'])
    editor.end()
  })

  it('two drawn shapes combine into a union that follows a shape dragged inside it, and a text does not combine', async () => {
    const editor = await testEditor(WORDS)
    const { core, mouse } = editor
    core.setSnapping(false)
    const at = (x: number, y: number) => core.stagePoint(x, y, 'sq')
    /** Draws with a tool from one point of the square to another, and gives the layer it made. */
    const draw = (tool: 'toolRect' | 'toolEllipse', from: Point, to: Point) => {
      const before = Object.keys(core.design().nodes)
      editor.press(tool)
      mouse.drag(at(from.x, from.y), at(to.x, to.y))
      return Object.keys(core.design().nodes).find((id) => !before.includes(id)) ?? ''
    }
    const back = draw('toolRect', { x: 450, y: 250 }, { x: 610, y: 410 })
    const front = draw('toolEllipse', { x: 550, y: 290 }, { x: 670, y: 410 })
    const [onBack, onFront, onWords] = [at(470, 270), at(650, 390), at(150, 850)]
    /** Clicks one point, then another with Shift held. */
    const pickBoth = (first: Point, second: Point) => {
      mouse.click(first.x, first.y)
      editor.keys.down('Shift')
      mouse.click(second.x, second.y)
      editor.keys.up('Shift')
    }
    pickBoth(onBack, onFront)
    expect(core.selection()).toEqual([back, front])
    editor.press('booleanUnion')
    const [union = ''] = core.selection()
    const kids = () =>
      Object.entries(core.design().nodes)
        .filter(([, node]) => node.parentId === union)
        .map(([id]) => id)
    expect([core.design().nodes[union], kids()]).toMatchObject([
      { type: 'boolean', parentId: 'sq', props: { op: 'union' } },
      [back, front],
    ])
    expect(core.boxOf(union)).toEqual({ x: 450, y: 250, width: 220, height: 160 })
    editor.press('undo')
    expect([core.design().nodes[union], core.design().nodes[front]?.parentId]).toEqual([undefined, 'sq'])
    editor.press('redo')

    // A double click on the ellipse goes into the union; dragged 100 right, the union refits round it.
    const inside = at(640, 380)
    mouse.dblclick(inside.x, inside.y)
    expect(core.selection()).toEqual([front])
    mouse.drag(inside, at(740, 380))
    expect([core.boxOf(front)?.x, core.design().nodes[front]?.parentId]).toEqual([650, union])
    expect(core.boxOf(union)).toEqual({ x: 450, y: 250, width: 320, height: 160 })

    // With the union and the text selected, the Union key changes nothing.
    editor.keys.press('Escape')
    editor.keys.press('Escape')
    pickBoth(onBack, onWords)
    expect(core.selection()).toEqual([union, 'words'])
    const before = stored(editor)
    editor.press('booleanUnion')
    expect(stored(editor)).toBe(before)
    editor.end()
  })

  it('showing another page lets the crop go with the selection, showing its page again brings back neither, and the drag is the one undo step', async () => {
    const editor = await openPhotoPages()
    const { core, mouse, modules } = editor
    const fill = () => {
      const node = core.design().nodes.photo
      return node?.type === 'graphic' ? node.props.fills?.[0] : undefined
    }
    const onPhoto = core.stagePoint(250, 440, 'sq')
    mouse.click(onPhoto.x, onPhoto.y)
    editor.press('goIn')
    mouse.drag(onPhoto, core.stagePoint(350, 440, 'sq'))
    expect([modules.selection.cropping()?.id, fill()]).toMatchObject(['photo', { fit: 'crop' }])

    core.showPage('p2')
    expect([core.shownPage(), modules.selection.cropping(), core.selection()]).toEqual(['p2', null, []])
    core.showPage('p1')
    expect([core.frames().map((frame) => frame.id), modules.selection.cropping(), core.selection()]).toEqual([
      ['sq'],
      null,
      [],
    ])
    editor.press('undo')
    expect([fill(), core.canUndo()]).toEqual([{ type: 'image', assetId: 'a1', fit: 'fill', opacity: 1 }, false])
    editor.end()
  })
})

describe('safeZones', () => {
  it('shows over the stage alone: turning them on writes nothing to the design and leaves the export pixels as they were', async () => {
    const editor = await testEditor({
      meta: { designId: 'd', name: 'D' },
      pages: { p1: { name: 'One', order: 'a0' } },
      frames: { story: { pageId: 'p1', name: 'Story', width: 270, height: 480, x: 0, y: 0, order: 'a0' } },
      nodes: {},
    })
    const { core } = editor
    const before = { design: core.design(), pixels: core.exportPixels('story') }
    const heard: (SafeZoneChoice | null)[] = []
    core.onView(() => heard.push(core.safeZones()))
    expect(core.safeZones()).toBeNull()
    core.setSafeZones(ALL_PLATFORMS)
    core.setSafeZones(ALL_PLATFORMS)
    core.setSafeZones('TikTok')
    core.redraw()
    expect(heard).toEqual([ALL_PLATFORMS, 'TikTok'])
    expect(core.design()).toBe(before.design)
    expect(core.canUndo()).toBe(false)
    expect(Buffer.from(core.exportPixels('story')).equals(Buffer.from(before.pixels))).toBe(true)
    editor.end()
  })
})

describe('showConstraints', () => {
  it('tells what is shown changed only when asking for the constraint lines changes, writing nothing to the design', async () => {
    const editor = await testEditor(DESIGN)
    const { core } = editor
    const before = core.design()
    let shown = 0
    core.onShown(() => shown++)
    core.showConstraints(true)
    core.showConstraints(true)
    expect(shown).toBe(1)
    core.showConstraints(false)
    core.showConstraints(false)
    expect(shown).toBe(2)
    expect(core.design()).toBe(before)
    expect(core.canUndo()).toBe(false)
    editor.end()
  })
})
describe('openEditorCore', () => {
  it('opens the core alone: its members answer, and aborting the signal it was given ends it', async () => {
    const ck = await loadCanvasKit()
    const parsed = parseDesign(DESIGN)
    if (!parsed.success) throw new Error(parsed.errors.join('\n'))
    const cache = resourceCache(ck)
    const ending = new AbortController()
    const core = openEditorCore({
      ck,
      cache,
      first: {
        fonts: loadFontFiles().map(({ family, bytes }) => ({ family, bytes })),
        fallbackFamilies: [],
        images: {},
      },
      firstFonts: NO_FONTS,
      store: openTestStore(parsed.design),
      connected: () => true,
      remembered: { get: () => null, set: () => {} },
      onMac: () => false,
      signal: ending.signal,
      options: { designId: 'd', frameName: () => 'Frame', layerName: (kind) => kind, radiusLabel: String },
    })
    core.setViewport({ width: 800, height: 600, dpr: 1 })
    expect(core.redraw()).toMatchObject({ frames: 2 })
    core.select(['a'])
    expect([core.selection(), core.boxOf('a'), core.destroyed()]).toEqual([
      ['a'],
      { x: 100, y: 100, width: 100, height: 100 },
      false,
    ])
    ending.abort()
    cache.delete()
    expect(core.destroyed()).toBe(true)
  })
})
