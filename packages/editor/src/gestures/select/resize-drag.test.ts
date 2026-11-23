import { describe, expect, it } from 'vitest'

import type { DesignInput, Point } from '@dazbee/schema'

import { type Frame, pageFrames } from '../../canvas/frames.ts'
import { HALF } from '../../canvas/test-images.ts'
import { boundsOf, type Box, centreOf, type Handle, localTo, turn } from '../../layers/transform.ts'
import { DESIGN } from '../../test-actions.ts'
import { type TestEditor, testEditor } from '../../test-editor.ts'
import { harness, lineProps, resizeFrom } from './test-transform-drag.ts'

/** A layer as a design to open takes it. */
type NodeInput = DesignInput['nodes'][string]

/** A layer of a type in a parent, with its props. */
const layer = (type: NodeInput['type'], parentId: string, index: string, props: Record<string, unknown>) =>
  ({ type, parentId, link: `${parentId}-${index}`, index, name: type, props }) as NodeInput
/** A rect graphic's props at a box, filled grey unless told another fill. */
const shape = (x: number, y: number, width: number, height: number, extra: Record<string, unknown> = {}) => ({
  x,
  y,
  width,
  height,
  shape: { kind: 'rect' },
  fills: [{ type: 'solid', color: '#C9CED6FF' }],
  ...extra,
})
/** A text's props at a box in a box mode. */
const text = (y: number, boxMode: string) => ({
  x: 40,
  y,
  width: 300,
  height: 150,
  text: 'Words in a box',
  boxMode,
  style: { fontFamily: 'Noto Sans', fontSize: 40, color: '#000000FF' },
})
/**
 * A square frame holding a layer of each kind a resize sizes, 200 × 150 or more, each upright but
 * one turned 30° and one in a group turned 30°: a shape, a photo, a group, a box, a boolean, a
 * path, a mask group, a text in each box mode, a layer in a row of an auto layout box and a line.
 */
const GRID: DesignInput = {
  meta: { designId: 'd', name: 'D' },
  pages: { p1: { name: 'One', order: 'a0' } },
  frames: { sq: { pageId: 'p1', name: 'Square', width: 1080, height: 1080, x: 0, y: 0, order: 'a0' } },
  nodes: {
    shape: layer('graphic', 'sq', 'a0', shape(40, 40, 200, 150)),
    photo: layer('graphic', 'sq', 'a1', shape(300, 40, 200, 150, { fills: [{ type: 'image', assetId: 'p' }] })),
    group: layer('group', 'sq', 'a2', { x: 560, y: 40, width: 460, height: 150 }),
    gA: layer('graphic', 'group', 'a0', shape(560, 40, 200, 150)),
    gB: layer('graphic', 'group', 'a1', shape(820, 40, 200, 150)),
    box: layer('box', 'sq', 'a3', { x: 40, y: 240, width: 200, height: 150 }),
    boxIn: layer('graphic', 'box', 'a0', shape(60, 260, 100, 80)),
    bool: layer('boolean', 'sq', 'a4', { x: 300, y: 240, width: 200, height: 150, op: 'union' }),
    bA: layer('graphic', 'bool', 'a0', shape(300, 240, 140, 100)),
    bB: layer('graphic', 'bool', 'a1', shape(360, 290, 140, 100)),
    path: layer('graphic', 'sq', 'a5', {
      ...shape(560, 240, 200, 150),
      shape: { kind: 'path', d: 'M0 0 L200 0 L200 150 L0 150 Z', drawnIn: { width: 200, height: 150 } },
    }),
    masks: layer('group', 'sq', 'a6', { x: 820, y: 240, width: 200, height: 150 }),
    mask: layer('graphic', 'masks', 'a0', shape(820, 240, 200, 150, { shape: { kind: 'ellipse' }, mask: 'alpha' })),
    masked: layer('graphic', 'masks', 'a1', shape(820, 240, 200, 150)),
    tFixed: layer('text', 'sq', 'a7', text(440, 'fixed')),
    tWide: layer('text', 'sq', 'a8', text(600, 'autoWidth')),
    tTall: layer('text', 'sq', 'a9', text(760, 'autoHeight')),
    row: layer('box', 'sq', 'b0', { x: 400, y: 440, width: 300, height: 160, layout: { direction: 'row' } }),
    inRow: layer('graphic', 'row', 'a0', shape(0, 0, 200, 150)),
    tilt: layer('group', 'sq', 'b1', { x: 780, y: 440, width: 300, height: 200, rotation: 30 }),
    tiltIn: layer('graphic', 'tilt', 'a0', shape(780, 440, 300, 200)),
    turned: layer('graphic', 'sq', 'b2', shape(420, 680, 300, 200, { rotation: 30 })),
    line: layer('graphic', 'sq', 'b3', { ...lineProps(400, 950, 300) }),
  },
}
/** What each test editor resize selects, and whether the side it drags lands on a whole pixel. */
const GRID_RESIZES: [string[], boolean][] = [
  ...['shape', 'photo', 'group', 'gB', 'box', 'bool', 'path', 'masks', 'masked'].map((id): [string[], boolean] => [
    [id],
    true,
  ]),
  ...['tFixed', 'tWide', 'tTall', 'inRow'].map((id): [string[], boolean] => [[id], true]),
  [['shape', 'photo'], true],
  ...['turned', 'tiltIn', 'line'].map((id): [string[], boolean] => [[id], false]),
]

/** Opens the test editor on a design, snapping off, at a zoom with the frame's corner at the stage's. */
async function editorAt(design: DesignInput, zoom = 1) {
  const bytes = HALF.encodeToBytes()
  if (!bytes) throw new Error('no image')
  const editor = await testEditor(design, { sources: { assetBytes: () => Promise.resolve(bytes) } })
  editor.core.setSnapping(false)
  editor.core.setCamera({ x: 0, y: 0, zoom })
  editor.core.redraw()
  return editor
}
/**
 * Presses 1.3 right of and 0.4 above the selection's east handle and drags 23.77 screen pixels
 * east, letting go unless told not to.
 */
function dragEast(editor: TestEditor, release = true) {
  const at = editor.at('e')
  if (!at) throw new Error('no east handle')
  const from = { x: at.x + 1.3, y: at.y - 0.4 }
  editor.mouse.move(from.x, from.y)
  editor.mouse.down()
  for (let step = 1; step <= 4; step++) editor.mouse.move(from.x + (23.77 * step) / 4, from.y)
  if (release) editor.mouse.up()
}
/** The right side of the layers' boxes as drawn. */
const rightOf = (editor: TestEditor, ids: string[]) =>
  Math.max(...ids.map((id) => (editor.core.boxOf(id)?.x ?? 0) + (editor.core.boxOf(id)?.width ?? 0)))
/** Whether a number is on a whole design pixel, as the hundredths a box is stored in leave it. */
const whole = (n: number) => Math.abs(n - Math.round(n)) < 0.011

describe('editorResizeDrag', () => {
  describe('pressHandle and a line end', () => {
    it('moves the end from where it was grabbed, so a press beside it does not jump', () => {
      const { drag, selection, frame, boxOf, pressSelection } = harness()
      selection.select(['line'], frame.id)
      const end = pressSelection({ x: 304, y: 903 })
      drag.drag(end, { x: 304, y: 1003 }, false, false, false)
      expect(boxOf('line')).toMatchObject({ x: 88.2, y: 950, width: 223.61, rotation: 26.57 })
    })

    it("moves the end grabbed freely, the other staying put, the line's direction kept, as one undo step", () => {
      const { drag, session, selection, frame, boxOf, pressSelection } = harness()
      selection.select(['line'], frame.id)
      const end = pressSelection({ x: 300, y: 900 })
      expect(end).toMatchObject({ kind: 'end', end: 'e', roots: ['line'] })
      drag.drag(end, { x: 300, y: 1000 }, false, false, false)
      // From (100, 900) to (300, 1000): its middle at (200, 950), about 223.6 long, turned 26.57°.
      expect(boxOf('line')).toMatchObject({ x: 88.2, y: 950, width: 223.61, height: 0, rotation: 26.57 })
      drag.release(end)
      session.undo()
      expect(boxOf('line')).toMatchObject({ x: 100, y: 900, width: 200, rotation: 0 })
    })

    it('keeps the line to 45° steps with Shift, about the end that stays, and its start a start', () => {
      const { drag, selection, frame, boxOf, pressSelection } = harness()
      selection.select(['line'], frame.id)
      const start = pressSelection({ x: 100, y: 900 })
      expect(start).toMatchObject({ kind: 'end', end: 'w' })
      // Dragged to below the end at (300, 900), a little off straight down: Shift holds it at 90°.
      drag.drag(start, { x: 290, y: 1100 }, true, false, false)
      const line = boxOf('line')
      // Still drawn from the start to the end: from (300, 1100) up to (300, 900), so turned -90°.
      expect(line.rotation).toBe(-90)
      expect(line.width).toBeCloseTo(200.25, 1)
      expect(line.x + line.width / 2).toBeCloseTo(300)
    })
  })

  describe('pressHandle and resize', () => {
    it('holds the pointer from the press on a handle', () => {
      const { selection, frame, pressSelection, holds } = harness()
      selection.select(['a'], frame.id)
      expect(holds()).toBe(0)
      pressSelection({ x: 200, y: 150 })
      expect(holds()).toBe(1)
    })

    it('resizes from the handle grabbed, as one undo step called resize', () => {
      const { drag, session, selection, frame, boxOf, pressSelection } = harness()
      selection.select(['a'], frame.id)
      const resize = pressSelection({ x: 200, y: 150 })
      expect(resize).toMatchObject({ kind: 'resize', handle: 'e', roots: ['a'] })
      expect(drag.snapWork().gathered).toBe(1)
      if (resize.kind !== 'resize') throw new Error('not a resize')
      drag.drag(resize, { x: 250, y: 150 }, false, false, false)
      expect(boxOf('a')).toMatchObject({ x: 100, y: 100, width: 150, height: 100 })
      drag.drag(resize, { x: 250, y: 150 }, false, true, false)
      expect(boxOf('a')).toMatchObject({ x: 50, width: 200 })
      drag.release(resize)
      expect(session.undoName()).toBe('resize')
      session.undo()
      expect(boxOf('a')).toMatchObject({ x: 100, width: 100 })
    })

    it('resizes the selected copies of other frames by the same amount, in the same undo step', () => {
      const { drag, session, selection, frame, log, boxOf, pressSelection } = harness()
      const wide = pageFrames(session.design(), 'p1').frames[1] as Frame
      selection.selectAcross([
        { id: 'a', frameId: frame.id },
        { id: 'wide-a', frameId: wide.id },
      ])
      const resize = pressSelection({ x: 200, y: 150 })
      expect(resize).toMatchObject({ kind: 'resize', handle: 'e', roots: ['a'] })
      drag.drag(resize, { x: 250, y: 150 }, false, false, false)
      expect(boxOf('a')).toMatchObject({ x: 100, y: 100, width: 150, height: 100 })
      expect(boxOf('wide-a')).toMatchObject({ x: 100, y: 100, width: 150, height: 100 })
      // From the centre both sides of each copy move by the same amount.
      drag.drag(resize, { x: 250, y: 150 }, false, true, false)
      expect(boxOf('a')).toMatchObject({ x: 50, width: 200 })
      expect(boxOf('wide-a')).toMatchObject({ x: 50, width: 200 })
      drag.release(resize)
      expect(log).toEqual(['hug a,wide-a'])
      session.undo()
      expect([boxOf('a'), boxOf('wide-a')]).toMatchObject([
        { x: 100, width: 100 },
        { x: 100, width: 100 },
      ])
    })

    it('keeps the shape with Shift on a corner', () => {
      const { drag, selection, frame, boxOf, pressSelection } = harness()
      selection.select(['a'], frame.id)
      const resize = pressSelection({ x: 200, y: 200 })
      drag.drag(resize, { x: 300, y: 220 }, true, false, false)
      expect(boxOf('a')).toMatchObject({ width: 200, height: 200 })
    })

    it("scales a text's sizes from a corner, its own runs' too, leaving its copy in the other frame be", () => {
      const { drag, session, selection, frame, copies, pressSelection } = harness()
      const before = copies()
      selection.select(['words'], frame.id)
      const resize = pressSelection({ x: 900, y: 148 })
      expect(resize).toMatchObject({ kind: 'resize', handle: 'se' })
      drag.drag(resize, { x: 1100, y: 196 }, false, false, false)
      expect(session.design().nodes.words?.props).toMatchObject({
        width: 400,
        height: 96,
        style: { fontSize: 40 },
        runs: [{ start: 0, end: 2, style: { fontSize: 80 } }],
      })
      expect(copies()).toEqual(before)
      drag.release(resize)
      session.undo()
      expect(session.design().nodes.words?.props).toMatchObject({
        style: { fontSize: 20 },
        runs: [{ start: 0, end: 2, style: { fontSize: 40 } }],
      })
    })

    it("scales the tiles of a text's tiled images from a corner, its own runs' too", () => {
      const { drag, session, selection, frame, pressSelection } = harness()
      const tile = (tileScale: number) =>
        ({ type: 'image', assetId: 'dots', fit: 'tile', opacity: 1, tileScale }) as const
      const words = session.design().nodes.words
      const style = words?.type === 'text' ? words.props.style : {}
      session.run('node.update', { ids: ['words'], patch: { style: { ...style, image: tile(0.5) } } })
      session.run('text.edit', { id: 'words', op: { kind: 'style', at: 0, length: 2, style: { image: tile(0.25) } } })
      selection.select(['words'], frame.id)
      const resize = pressSelection({ x: 900, y: 148 })
      drag.drag(resize, { x: 1100, y: 196 }, false, false, false)
      expect(session.design().nodes.words?.props).toMatchObject({
        style: { fontSize: 40, image: tile(1) },
        runs: [{ start: 0, end: 2, style: { fontSize: 80, image: tile(0.5) } }],
      })
    })

    it('scales a curved text from a corner, then fits its box to its curve', () => {
      const { drag, session, selection, frame, log, pressSelection } = harness()
      session.run('node.update', { ids: ['words'], patch: { curve: { shape: 'circle', amount: 50 } } })
      selection.select(['words'], frame.id)
      const resize = pressSelection({ x: 900, y: 148 })
      drag.drag(resize, { x: 1100, y: 196 }, false, false, false)
      expect(session.design().nodes.words?.props).toMatchObject({
        style: { fontSize: 40 },
        curve: { shape: 'circle', amount: 50 },
      })
      expect(log).toContain('fit words')
    })

    it('keeps the runs of a text a corner scaled on their characters as words go in before them, its copy keeping its own', () => {
      const { drag, session, selection, frame, pressSelection } = harness()
      session.run('text.edit', { id: 'words', op: { kind: 'insert', at: 0, text: 'Hi ' } })
      selection.select(['words'], frame.id)
      const resize = pressSelection({ x: 900, y: 148 })
      drag.drag(resize, { x: 1100, y: 196 }, false, false, false)
      drag.release(resize)
      session.run('text.edit', { id: 'words', op: { kind: 'insert', at: 0, text: 'Oh ' } })
      expect(session.design().nodes.words?.props).toMatchObject({
        text: 'Oh Hi Hello',
        runs: [{ start: 6, end: 8, style: { fontSize: 80 } }],
      })
      expect(session.design().nodes['wide-words']?.props).toMatchObject({
        text: 'Hello',
        style: { fontSize: 20 },
        runs: [{ start: 0, end: 2, style: { fontSize: 40 } }],
      })
    })

    it("stops a text a corner scales down at 1 px, its smallest size's, dragged past the far corner", () => {
      const { drag, session, selection, frame, pressSelection } = harness()
      selection.select(['words'], frame.id)
      const resize = pressSelection({ x: 900, y: 148 })
      drag.drag(resize, { x: 300, y: 0 }, false, false, false)
      // Its style's 20 is its smallest size, so it scales by 1 / 20 at the least.
      expect(session.design().nodes.words?.props).toMatchObject({
        x: 700,
        y: 100,
        width: 10,
        height: 2.4,
        style: { fontSize: 1 },
        runs: [{ start: 0, end: 2, style: { fontSize: 2 } }],
      })
    })

    it("changes a fixed text's height from its bottom and its top, its sizes kept", () => {
      const { drag, session, selection, frame, boxOf, pressSelection } = harness()
      selection.select(['words'], frame.id)
      const bottom = pressSelection({ x: 800, y: 148 })
      drag.drag(bottom, { x: 800, y: 228 }, false, false, false)
      drag.release(bottom)
      const top = pressSelection({ x: 800, y: 100 })
      drag.drag(top, { x: 800, y: 60 }, false, false, false)
      expect(boxOf('words')).toMatchObject({ x: 700, y: 60, width: 200, height: 168 })
      expect(session.design().nodes.words?.props).toMatchObject({
        style: { fontSize: 20 },
        runs: [{ start: 0, end: 2, style: { fontSize: 40 } }],
      })
    })

    it('scales a text turned 20° from a corner along its own sides, its far corner and its turn kept', () => {
      const { drag, session, selection, frame, boxOf, pressSelection } = harness()
      session.run('node.update', { ids: ['words'], patch: { rotation: 20 } })
      selection.select(['words'], frame.id)
      const centre = { x: 800, y: 124 }
      const nw = turn({ x: 700, y: 100 }, centre, 20)
      const resize = pressSelection(turn({ x: 900, y: 148 }, centre, 20))
      // Half as big again along its own sides, from the corner across.
      drag.drag(resize, turn({ x: 1000, y: 172 }, centre, 20), false, false, false)
      const now = boxOf('words')
      expect(now).toMatchObject({ rotation: 20, width: 300, height: 72 })
      expect(session.design().nodes.words?.props).toMatchObject({ style: { fontSize: 30 } })
      const kept = turn({ x: now.x, y: now.y }, centreOf(now), 20)
      expect(kept.x).toBeCloseTo(nw.x, 1)
      expect(kept.y).toBeCloseTo(nw.y, 1)
    })

    it('scales a text from a corner about its centre with Alt', () => {
      const { drag, session, selection, frame, boxOf, pressSelection } = harness()
      selection.select(['words'], frame.id)
      const resize = pressSelection({ x: 900, y: 148 })
      drag.drag(resize, { x: 950, y: 160 }, false, true, false)
      expect(boxOf('words')).toMatchObject({ x: 650, y: 88, width: 300, height: 72 })
      expect(session.design().nodes.words?.props).toMatchObject({ style: { fontSize: 30 } })
    })
  })

  describe('a resize on whole design pixels', () => {
    const free: [Handle, Point, Point, Partial<Box>][] = [
      ['se', { x: 200, y: 200 }, { x: 50.4, y: 30.3 }, { x: 100, y: 100, width: 150, height: 130 }],
      ['e', { x: 200, y: 150 }, { x: 50.4, y: 30.3 }, { x: 100, y: 100, width: 150, height: 100 }],
      ['w', { x: 100, y: 150 }, { x: -20.6, y: 30.3 }, { x: 79, y: 100, width: 121, height: 100 }],
      ['n', { x: 150, y: 100 }, { x: 5, y: -20.6 }, { x: 100, y: 79, width: 100, height: 121 }],
      ['s', { x: 150, y: 200 }, { x: 5, y: 20.6 }, { x: 100, y: 100, width: 100, height: 121 }],
    ]
    for (const [handle, at, by, want] of free)
      it(`lands each side a free resize from ${handle} drags on a whole pixel, a press off the handle left out`, () => {
        const h = harness()
        h.selection.select(['a'], h.frame.id)
        expect(resizeFrom(h, at, by)).toMatchObject({ kind: 'resize', handle })
        expect(h.boxOf('a')).toMatchObject(want)
      })

    it('lands the leading side on a whole pixel with Shift, from a corner and from an edge, the other following the ratio', () => {
      for (const [handle, at, want] of [
        ['se', { x: 220, y: 180 }, { x: 100, y: 100, width: 169, height: 112.67 }],
        ['e', { x: 220, y: 140 }, { x: 100, y: 83.67, width: 169, height: 112.67 }],
      ] as const) {
        const h = harness()
        h.session.run('node.update', { ids: ['a'], patch: { width: 120, height: 80 } })
        h.selection.select(['a'], h.frame.id)
        expect(resizeFrom(h, at, { x: 49.4, y: 10.3 }, { shift: true })).toMatchObject({ handle })
        expect(h.boxOf('a')).toMatchObject(want)
      }
    })

    it('lands the side dragged with Alt on a whole pixel, and the side mirrored when the two summed to a whole number', () => {
      const h = harness()
      h.selection.select(['a'], h.frame.id)
      resizeFrom(h, { x: 200, y: 150 }, { x: 50.4, y: 0 }, { alt: true })
      expect(h.boxOf('a')).toMatchObject({ x: 50, width: 200 })
      const quarter = harness()
      quarter.session.run('node.update', { ids: ['a'], patch: { x: 100.25 } })
      quarter.selection.select(['a'], quarter.frame.id)
      resizeFrom(quarter, { x: 200.25, y: 150 }, { x: 50.4, y: 0 }, { alt: true })
      // The sides summed to 300.5: the one dragged lands on 251, the mirrored one on 49.5.
      expect(quarter.boxOf('a')).toMatchObject({ x: 49.5, width: 201.5 })
    })

    it('lands the leading side on a whole pixel with Shift and Alt from a corner, about the centre', () => {
      const h = harness()
      h.session.run('node.update', { ids: ['a'], patch: { width: 120, height: 80 } })
      h.selection.select(['a'], h.frame.id)
      resizeFrom(h, { x: 220, y: 180 }, { x: 49.4, y: 10.3 }, { shift: true, alt: true })
      expect(h.boxOf('a')).toMatchObject({ x: 51, y: 67.33, width: 218, height: 145.33 })
    })

    it('lands the side dragged on a whole pixel from a start on half pixels, east and west, the other side staying', () => {
      for (const [at, by, want] of [
        [
          { x: 589.5, y: 150 },
          { x: 20.4, y: 0 },
          { x: 489.5, width: 120.5 },
        ],
        [
          { x: 489.5, y: 150 },
          { x: -20.4, y: 0 },
          { x: 469, width: 120.5 },
        ],
      ] as const) {
        const h = harness()
        h.session.run('node.update', { ids: ['b'], patch: { x: 489.5 } })
        h.selection.select(['b'], h.frame.id)
        resizeFrom(h, at, by)
        expect(h.boxOf('b')).toMatchObject(want)
      }
    })

    it('keeps a side that snaps to a line on a half pixel on the line its snap line shows', () => {
      const h = harness()
      h.session.run('node.update', { ids: ['b'], patch: { x: 320.5 } })
      h.selection.select(['a'], h.frame.id)
      resizeFrom(h, { x: 200, y: 150 }, { x: 119.4, y: 0 }, { snap: true })
      expect(h.boxOf('a')).toMatchObject({ x: 100, width: 220.5 })
      expect(h.drag.shown()?.snapLines).toContainEqual(expect.objectContaining({ axis: 'x', at: 320.5 }))
    })

    it("lands the east edge of a text a corner scales on a layer's edge as it snaps, the text's shape kept", () => {
      const h = harness()
      h.session.run('node.update', { ids: ['b'], patch: { x: 1000, y: 300 } })
      h.selection.select(['words'], h.frame.id)
      // Dragged to 3 short of the square's left edge at 1000.
      resizeFrom(h, { x: 900, y: 148 }, { x: 97, y: 0 }, { snap: true })
      expect(h.session.design().nodes.words?.props).toMatchObject({ width: 300, height: 72, style: { fontSize: 30 } })
      expect(h.drag.shown()?.snapLines).toContainEqual(expect.objectContaining({ axis: 'x', at: 1000 }))
    })

    it('lands the side dragged of a text on a whole pixel in each box mode, and the leading side of a corner that scales it', () => {
      for (const boxMode of ['fixed', 'autoWidth', 'autoHeight'] as const) {
        const h = harness()
        h.session.run('node.update', { ids: ['words'], patch: { boxMode } })
        h.selection.select(['words'], h.frame.id)
        resizeFrom(h, { x: 900, y: 124 }, { x: 50.4, y: 0 })
        expect(h.boxOf('words')).toMatchObject({ x: 700, width: 250 })
      }
      const h = harness()
      h.selection.select(['words'], h.frame.id)
      resizeFrom(h, { x: 900, y: 148 }, { x: 100.4, y: 20.3 })
      expect(h.session.design().nodes.words?.props).toMatchObject({ width: 300, height: 72, style: { fontSize: 30 } })
    })

    it('rounds nothing for a layer turned 30° or one in a group turned 30°', () => {
      const turned = harness()
      turned.session.run('node.update', { ids: ['a'], patch: { rotation: 30 } })
      turned.selection.select(['a'], turned.frame.id)
      // Its east handle, turned about its centre (150, 150).
      const east = { x: 150 + 50 * Math.cos(Math.PI / 6), y: 175 }
      resizeFrom(turned, east, { x: 20.4, y: 0 })
      // Along its own side the pointer went 20.4 × cos 30°.
      expect(turned.boxOf('a').width).toBe(117.67)
      const inGroup = harness()
      inGroup.session.run('node.group', { ids: ['a'], id: 'tilt', name: 'Tilt' })
      inGroup.session.run('node.update', { ids: ['tilt'], patch: { rotation: 30 } })
      inGroup.selection.select(['a'], inGroup.frame.id)
      const around = inGroup.boxes.selectionBox()?.around ?? []
      resizeFrom(inGroup, east, { x: 20.4, y: 0 }, {}, (p) => localTo(p, around))
      expect(inGroup.boxOf('a').width).toBe(117.67)
    })

    it("works a line's end out from the place the pointer gives, unrounded", () => {
      const h = harness()
      h.selection.select(['line'], h.frame.id)
      resizeFrom(h, { x: 300, y: 900 }, { x: 0.4, y: 100.3 })
      // From (100, 900) to (300.4, 1000.3).
      expect(h.boxOf('line').width).toBe(224.1)
    })

    it('gives a copy in another frame the same change, on a whole pixel too', () => {
      const h = harness()
      const wide = pageFrames(h.session.design(), 'p1').frames[1] as Frame
      h.selection.selectAcross([
        { id: 'a', frameId: h.frame.id },
        { id: 'wide-a', frameId: wide.id },
      ])
      resizeFrom(h, { x: 200, y: 150 }, { x: 50.4, y: 0 })
      expect([h.boxOf('a'), h.boxOf('wide-a')]).toMatchObject([
        { x: 100, width: 150 },
        { x: 100, width: 150 },
      ])
    })
  })

  describe('a resize on whole design pixels, in the test editor', () => {
    for (const zoom of [0.1, 1, 8])
      it(`lands the side dragged of each kind of upright layer on a whole pixel at ${zoom * 100}%, and undo and redo each resize`, async () => {
        const editor = await editorAt(GRID, zoom)
        for (const [ids, lands] of GRID_RESIZES) {
          editor.core.select(ids)
          editor.core.redraw()
          const before = JSON.stringify(editor.core.design())
          dragEast(editor)
          const after = JSON.stringify(editor.core.design())
          expect(after, ids.join()).not.toBe(before)
          if (lands) expect(rightOf(editor, ids), ids.join()).toSatisfy(whole)
          editor.press('undo')
          expect(JSON.stringify(editor.core.design()), ids.join()).toBe(before)
          editor.press('redo')
          expect(JSON.stringify(editor.core.design()), ids.join()).toBe(after)
          editor.press('undo')
        }
        editor.end()
      })

    it('lands the box of two selected layers on a whole pixel, each layer scaled within it as before', async () => {
      const editor = await editorAt(DESIGN)
      editor.core.select(['a', 'b'])
      editor.core.redraw()
      dragEast(editor)
      // The selection ran from 100 to 350; a holds its first 100, b its last.
      const right = rightOf(editor, ['a', 'b'])
      expect(right).toSatisfy(whole)
      expect(editor.core.boxOf('a')?.width).toBeCloseTo((100 * (right - 100)) / 250, 1)
      editor.end()
    })

    it('lands a group on a whole pixel as it is dragged, and fits it to its turned layer at release', async () => {
      const editor = await editorAt({
        ...DESIGN,
        nodes: {
          ...DESIGN.nodes,
          g: layer('group', 'sq', 'b0', { x: 281.7, y: 581.7, width: 136.6, height: 136.6 }),
          tilted: layer('graphic', 'g', 'a0', shape(300, 600, 100, 100, { rotation: 30 })),
        },
      })
      editor.core.select(['g'])
      editor.core.redraw()
      dragEast(editor, false)
      expect(rightOf(editor, ['g'])).toSatisfy(whole)
      editor.mouse.up()
      const tilted = editor.core.design().nodes.tilted?.props as Box
      const fits = boundsOf([tilted])
      expect(editor.core.boxOf('g')?.x).toBeCloseTo(fits.x, 1)
      expect(rightOf(editor, ['g'])).toBeCloseTo(fits.x + fits.width, 1)
      expect(rightOf(editor, ['g'])).not.toSatisfy(whole)
      editor.end()
    })
  })

  describe('text a side resizes, in the test editor', () => {
    it('makes auto width text dragged narrower auto height at the width given, taller as its words wrap', async () => {
      // On one line, 54 high, as its words fit it.
      const oneLine = layer('text', 'sq', 'a8', { ...text(600, 'autoWidth'), height: 54 })
      const editor = await editorAt({ ...GRID, nodes: { ...GRID.nodes, tWide: oneLine } })
      editor.core.select(['tWide'])
      editor.core.redraw()
      const was = editor.core.boxOf('tWide')
      const at = editor.at('e')
      if (!was || !at) throw new Error('no east handle')
      editor.mouse.drag(at, { x: at.x - 120, y: at.y })
      expect(editor.core.design().nodes.tWide?.props).toMatchObject({ boxMode: 'autoHeight' })
      const now = editor.core.boxOf('tWide')
      expect(now?.width).toBeCloseTo(was.width - 120, 0)
      expect(now?.height).toBeGreaterThan(was.height)
      editor.end()
    })
  })
})
