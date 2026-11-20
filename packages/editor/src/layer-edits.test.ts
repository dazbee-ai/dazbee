import { describe, expect, it } from 'vitest'

import type { Design, DesignInput, Shape } from '@dazbee/schema'

import { pageFrames } from './canvas/frames.ts'
import { editorLayerEdits, type LayerEditsDeps } from './layer-edits.ts'
import { sessionOf, testBoxes } from './layers/test-boxes.ts'
import { editorSelection } from './selection.ts'
import { stepOf } from './shortcuts.ts'
import { COPIES, everyCopy, FLOW } from './test-actions.ts'
import { testEditor } from './test-editor.ts'

const STYLE = { fontFamily: 'Noto Sans', fontSize: 20, color: '#000000FF' }
const rect = (parentId: string, index: string, x: number, y: number, extra: Record<string, unknown> = {}) => ({
  type: 'graphic' as const,
  parentId,
  index,
  name: 'Rect',
  props: { x, y, width: 30, height: 40, shape: { kind: 'rect' as const }, fills: [], ...extra },
})
/** The square frame's layers: a group holding a dot and a tag, a box filled with the brand's colour, a text, and an empty box. */
const SQUARE_LAYERS: DesignInput['nodes'] = {
  pair: {
    type: 'group',
    parentId: 'sq',
    link: 'pair',
    index: 'a0',
    name: 'Pair',
    props: { x: 100, y: 100, width: 230, height: 140 },
  },
  dot: { ...rect('pair', 'a0', 100, 100), link: 'dot' },
  tag: { ...rect('pair', 'a1', 300, 200), link: 'tag' },
  box: {
    ...rect('sq', 'a1', 500, 500, { fills: [{ type: 'solid', color: '#FF0000FF' }] }),
    link: 'box',
    bindings: { fill: 'brand:primary' },
  },
  words: {
    type: 'text',
    parentId: 'sq',
    link: 'words',
    index: 'a2',
    name: 'Words',
    props: { x: 0, y: 700, width: 200, height: 40, text: 'Hello', boxMode: 'fixed', style: STYLE },
  },
  holder: {
    type: 'box',
    parentId: 'sq',
    link: 'holder',
    index: 'a3',
    name: 'Holder',
    props: { x: 700, y: 100, width: 300, height: 300 },
  },
}
/** One page with a square frame holding SQUARE_LAYERS and a wide one holding a copy of each, `wide-<id>`, linked to it. */
const DESIGN: DesignInput = {
  meta: { designId: 'd', name: 'D' },
  pages: { p1: { name: 'One', order: 'a0' } },
  frames: {
    sq: { pageId: 'p1', name: 'Square', width: 1080, height: 1080, x: 0, y: 0, order: 'a0' },
    wide: { pageId: 'p1', name: 'Wide', width: 1200, height: 628, x: 1280, y: 0, order: 'a1' },
  },
  nodes: {
    ...SQUARE_LAYERS,
    ...Object.fromEntries(
      Object.entries(SQUARE_LAYERS).map(([id, node]) => [
        `wide-${id}`,
        { ...node, parentId: node.parentId === 'sq' ? 'wide' : `wide-${node.parentId}` },
      ]),
    ),
  },
}

/** The layer edits on a real session and selection over a design, logging the text they fit and the families they load. */
function harness(design = DESIGN) {
  const session = sessionOf(design)
  const log: string[] = []
  const frames = pageFrames(session.design(), 'p1').frames
  const selection = editorSelection({ drawn: () => session.design(), frames: () => frames, changed: () => {} })
  const boxes = testBoxes(session, selection, frames)
  const done = new AbortController()
  const deps: LayerEditsDeps = {
    session,
    selection,
    boxes,
    resources: {
      loadFamilies: (families) => {
        log.push(`load ${families.join(',')}`)
        return families.map(() => Promise.resolve())
      },
    },
    typing: {
      fitText: (id) => log.push(`fit ${id}`),
      selectedText: () => null,
      styleRange: () => {},
    },
    signal: done.signal,
  }
  const edits = editorLayerEdits(deps)
  /** A layer's properties. */
  const props = (id: string) => session.design().nodes[id]?.props
  /** The wide frame's copies as they are now. */
  const copies = () => Object.entries(session.design().nodes).filter(([id]) => id.startsWith('wide-'))
  /** The design as it is now, kept apart from later changes. */
  const snapshot = () => JSON.parse(JSON.stringify(session.design())) as Design
  /** Where a layer of the square is drawn. */
  const drawnOf = (id: string) => boxes.drawnRect(frames[0] as (typeof frames)[number], id)
  /** Whether every layer of the square is drawn where it was in a design kept before. */
  const alike = (before: Design) => boxes.drawnAlike('sq', before, session.design())
  return { edits, session, selection, log, props, copies, snapshot, drawnOf, alike, destroy: () => done.abort() }
}

describe('editorLayerEdits', () => {
  describe('moveLayer', () => {
    it('moves a layer into a box as one undo step, the group it left fitting what it holds again', () => {
      const { edits, session } = harness()
      expect(edits.moveLayer('tag', 'holder')).toBe(true)
      const { nodes } = session.design()
      expect(nodes.tag?.parentId).toBe('holder')
      expect(nodes.pair?.props).toMatchObject({ x: 100, y: 100, width: 30, height: 40 })
      session.undo()
      expect(session.design().nodes.tag?.parentId).toBe('pair')
    })

    it('keeps a layer moved into a group the flow moved where it is drawn', () => {
      const { edits, session, drawnOf } = harness(FLOW)
      session.run('node.group', { ids: ['a', 'b'], id: 'pair', name: 'Pair' })
      session.run('node.move', { id: 'pair', parentId: 'flow', before: 'fixed' })
      expect(drawnOf('a')).not.toMatchObject({ x: 100, y: 100 })
      // Inside the group as it is drawn, so it fits it as it is.
      session.run('node.update', { ids: ['c'], patch: { x: 150, y: 900 } })
      const was = drawnOf('c')
      expect(edits.moveLayer('c', 'pair')).toBe(true)
      expect(drawnOf('c')).toEqual(was)
      session.undo()
      session.redo()
      expect(drawnOf('c')).toEqual(was)
    })

    it('keeps a layer moved out of a turned group the flow moved where it is drawn, turned about where the group is drawn', () => {
      const { edits, session, props, drawnOf } = harness(FLOW)
      session.run('node.group', { ids: ['a', 'b'], id: 'pair', name: 'Pair' })
      session.run('node.move', { id: 'pair', parentId: 'flow', before: 'fixed' })
      session.run('node.update', { ids: ['pair'], patch: { rotation: 90 } })
      const was = drawnOf('b')
      expect(edits.moveLayer('b', 'sq')).toBe(true)
      expect(drawnOf('b')).toEqual(was)
      expect(props('b')?.rotation).toBe(90)
      session.undo()
      session.redo()
      expect(drawnOf('b')).toEqual(was)
    })

    it('keeps a layer moved out of a flow, and what it holds, where they are drawn', () => {
      const { edits, session, drawnOf } = harness(FLOW)
      for (const ids of [['filling'], ['hugging', 'inHug']]) {
        const was = ids.map(drawnOf)
        expect(edits.moveLayer(ids[0] ?? '', 'sq')).toBe(true)
        expect(ids.map(drawnOf)).toEqual(was)
        session.undo()
        session.redo()
        expect(ids.map(drawnOf)).toEqual(was)
      }
    })

    it('keeps a box that fits its content at the size it is drawn when the move empties its flow', () => {
      const { edits, session, drawnOf } = harness(FLOW)
      const was = drawnOf('hugging')
      expect(was).toMatchObject({ width: 120, height: 120 })
      expect(edits.moveLayer('inHug', 'sq')).toBe(true)
      expect(drawnOf('hugging')).toEqual(was)
      session.undo()
      session.redo()
      expect(drawnOf('hugging')).toEqual(was)
    })

    it('keeps a layer moved out of a group the flow moved where it is drawn', () => {
      const { edits, session, drawnOf } = harness(FLOW)
      session.run('node.group', { ids: ['a', 'b'], id: 'pair', name: 'Pair' })
      session.run('node.move', { id: 'pair', parentId: 'flow' })
      const was = drawnOf('b')
      expect(was).not.toMatchObject({ x: 250, y: 300 })
      expect(edits.moveLayer('b', 'sq')).toBe(true)
      expect(drawnOf('b')).toEqual(was)
    })

    it('refuses a move into the layer itself', () => {
      const { edits } = harness()
      expect(edits.moveLayer('pair', 'dot')).toBe(false)
    })

    it('refuses a move into another frame, onto it or into a box there, writing nothing', () => {
      const { edits, session, snapshot } = harness()
      const before = snapshot()
      expect(edits.moveLayer('box', 'wide')).toBe(false)
      expect(edits.moveLayer('dot', 'wide-holder')).toBe(false)
      expect(session.design()).toEqual(before)
      expect(session.canUndo()).toBe(false)
    })
  })

  describe('setProps', () => {
    it('writes on the layers given, carrying what a group holds along; their copies in the other frame stay', () => {
      const { edits, props, copies } = harness()
      const before = copies()
      expect(edits.setProps(['pair'], () => ({ x: 120 }))).toBe(true)
      expect(props('pair')).toMatchObject({ x: 120 })
      expect(props('dot')).toMatchObject({ x: 120 })
      expect(props('tag')).toMatchObject({ x: 320 })
      expect(copies()).toEqual(before)
    })

    it('gives a layer in a group the flow moved as drawn, and draws a place set or stepped there', () => {
      const { edits, session, drawnOf } = harness(FLOW)
      session.run('node.group', { ids: ['a', 'b'], id: 'pair', name: 'Pair' })
      session.run('node.move', { id: 'pair', parentId: 'flow', before: 'fixed' })
      const was = drawnOf('b')
      if (!was) throw new Error('no layer')
      let seen: Readonly<Record<string, unknown>> = {}
      // Moved in from the group's right and bottom edges, so the group shrinks and the flow keeps its corner.
      expect(
        edits.setProps(['b'], (_, now) => {
          seen = now
          return { x: was.x - 30 }
        }),
      ).toBe(true)
      expect(seen).toMatchObject({ x: was.x, y: was.y })
      expect(edits.setProps(['b'], (_, now) => ({ y: Number(now.y) - 20 }))).toBe(true)
      expect(drawnOf('b')).toMatchObject({ x: was.x - 30, y: was.y - 20 })
      session.undo()
      session.undo()
      expect(drawnOf('b')).toEqual(was)
    })

    it('keeps a layer kept where it is put where the flow drew it, and its size, the layers after it closing up', () => {
      const { edits, session, drawnOf } = harness(FLOW)
      const drawn = () => ({ fixed: drawnOf('fixed'), filling: drawnOf('filling'), hugging: drawnOf('hugging') })
      const was = drawn()
      expect(edits.setProps(['filling'], () => ({ absolute: true }))).toBe(true)
      const closed = { ...was, hugging: { ...was.hugging, x: was.filling?.x } }
      expect(drawn()).toEqual(closed)
      expect(edits.setProps(['hugging'], () => ({ absolute: true }))).toBe(true)
      expect(drawn()).toEqual(closed)
      expect(drawnOf('inHug')).toMatchObject({ width: 60, height: 60 })
      session.undo()
      session.undo()
      expect(session.design().nodes.filling?.props.absolute).toBeUndefined()
      expect(drawn()).toEqual(was)
    })

    it('fixes a side that fitted or filled at the size it is drawn, nothing moving', () => {
      const { edits, session, snapshot, alike } = harness(FLOW)
      const sides = [
        ['hugging', { width: 'fixed', height: 'hug' }],
        ['flow', { width: 'fixed', height: 'fixed' }],
        ['filling', { width: 'fixed', height: 'fixed' }],
      ] as const
      for (const [id, sizing] of sides) {
        const before = snapshot()
        expect(edits.setProps([id], () => ({ sizing }))).toBe(true)
        expect(alike(before)).toBe(true)
        session.undo()
        session.redo()
        expect(alike(before)).toBe(true)
      }
    })

    it('skips a layer locked against the change, still writing the rest, as one undo step', () => {
      const { edits, session, props } = harness()
      session.run('node.lock', { ids: ['dot'], lock: { move: true } })
      expect(edits.setProps(['dot', 'wide-dot'], () => ({ y: 150, opacity: 0.5 }))).toBe(false)
      expect(props('dot')).toMatchObject({ y: 100, opacity: 0.5 })
      expect(props('wide-dot')).toMatchObject({ y: 150, opacity: 0.5 })
      session.undo()
      expect(props('wide-dot')).toMatchObject({ y: 100 })
      expect(props('dot')?.opacity).toBe(1)
    })

    it('writes a font size and a Y on copies selected across frames, each change one undo step that gives each copy its own back', async () => {
      const { core, press, end } = await testEditor(COPIES)
      const sizes = () =>
        everyCopy('headline').map(
          (id) => (core.design().nodes[id]?.props as { style: { fontSize: number } }).style.fontSize,
        )
      const ys = () => everyCopy('badge').map((id) => core.design().nodes[id]?.props.y)
      core.select(['headline'])
      press('selectLinkedCopies')
      expect(core.setProps(core.selection(), (_, now) => ({ style: { ...(now.style as object), fontSize: 90 } }))).toBe(
        true,
      )
      expect(sizes()).toEqual([90, 90, 90])
      press('undo')
      expect(sizes()).toEqual([110, 110, 72])
      press('redo')
      expect(sizes()).toEqual([90, 90, 90])
      core.select(['badge'])
      press('selectLinkedCopies')
      expect(core.setProps(core.selection(), () => ({ y: 300 }))).toBe(true)
      expect(ys()).toEqual([300, 300, 300])
      press('undo')
      expect(ys()).toEqual([330, 1080, 100])
      end()
    })

    it('writes on a hidden copy selected with its layer, the copy staying hidden', () => {
      const { edits, props } = harness()
      edits.setHidden(['wide-box'], true)
      expect(edits.setProps(['box', 'wide-box'], () => ({ y: 200 }))).toBe(true)
      expect([props('box')?.y, props('wide-box')?.y]).toEqual([200, 200])
      expect(props('wide-box')?.visible).toBe(false)
    })

    it("gives the change each layer's own props", () => {
      const { edits, props } = harness()
      edits.setProps(['wide-dot'], () => ({ y: 150 }))
      edits.setProps(['dot', 'wide-dot'], (_id, now) => ({ y: Number(now.y) + 10 }))
      expect(props('dot')).toMatchObject({ y: 110 })
      expect(props('wide-dot')).toMatchObject({ y: 160 })
    })

    it("unbinds a fill set by hand from the brand's colour in one undo step, and fits text whose words change size", () => {
      const { edits, session, log } = harness()
      edits.setProps(['box'], () => ({ fills: [{ type: 'solid', color: '#00FF00FF' }] }))
      expect(session.design().nodes.box?.bindings?.fill).toBeUndefined()
      expect(session.design().nodes['wide-box']?.bindings?.fill).toBe('brand:primary')
      session.undo()
      expect(session.design().nodes.box).toMatchObject({
        props: { fills: [{ color: '#FF0000FF' }] },
        bindings: { fill: 'brand:primary' },
      })
      edits.setProps(['words'], () => ({ style: { ...STYLE, fontSize: 30 } }))
      expect(log).toEqual(['fit words'])
    })

    it('writes nothing, and makes no undo step, for values a change leaves as they are', () => {
      const { edits, session } = harness()
      edits.setProps(['dot'], (_id, now) => ({ x: now.x }))
      expect(session.canUndo()).toBe(false)
    })
    it('fixes the sides a patch sizes, as a resize does: a box that fits, and a text that fits its words', () => {
      const flow = harness(FLOW)
      expect(flow.edits.setProps(['hugging'], () => ({ width: 200 }))).toBe(true)
      expect(flow.props('hugging')).toMatchObject({ width: 200, sizing: { width: 'fixed', height: 'hug' } })
      const { edits, session, props } = harness()
      session.run('node.update', { ids: ['words'], patch: { boxMode: 'autoWidth' } })
      expect(edits.setProps(['words'], () => ({ width: 300 }))).toBe(true)
      expect(props('words')).toMatchObject({ width: 300, boxMode: 'autoHeight' })
      session.undo()
      expect(props('words')).toMatchObject({ boxMode: 'autoWidth' })
    })

    it('keeps a box that fits its content at the size it is drawn when a patch lets the last layer of its flow go', () => {
      const { edits, session, drawnOf } = harness(FLOW)
      const was = drawnOf('hugging')
      expect(edits.setProps(['inHug'], () => ({ absolute: true }))).toBe(true)
      expect(drawnOf('hugging')).toEqual(was)
      session.undo()
      expect(edits.setHidden(['inHug'], true)).toBe(true)
      expect(drawnOf('hugging')).toEqual(was)
    })
  })

  describe('setSizing', () => {
    it('sets a side of each layer, a text keeping its box mode in step', () => {
      const flow = harness(FLOW)
      expect(flow.edits.setSizing(['fixed'], { height: 'fill' })).toBe(true)
      expect(flow.props('fixed')?.sizing).toEqual({ width: 'fixed', height: 'fill' })
      const { edits, props } = harness()
      expect(edits.setSizing(['words'], { width: 'hug' })).toBe(true)
      expect(props('words')).toMatchObject({ boxMode: 'autoWidth' })
    })

    it('fixes a box that fits its content at its drawn size when a layer fills along its flow, as one undo step', () => {
      const { edits, session, props, drawnOf } = harness(FLOW)
      const box = drawnOf('hugging')
      expect(edits.setSizing(['inHug'], { width: 'fill' })).toBe(true)
      expect(props('hugging')?.sizing).toEqual({ width: 'fixed', height: 'hug' })
      expect(props('inHug')?.sizing).toEqual({ width: 'fill', height: 'fixed' })
      expect(drawnOf('hugging')).toEqual(box)
      expect(drawnOf('inHug')).toMatchObject({ width: (box?.width ?? 0) - 60 })
      session.undo()
      expect(props('hugging')?.sizing).toEqual({ width: 'hug', height: 'hug' })
      expect(props('inHug')?.sizing).toBeUndefined()
    })
  })

  describe('renameLayer, setLocked and setHidden', () => {
    it('renames, locks against every change, deleting too, hides, shows and unlocks layers, their copies in the other frame left as they are', () => {
      const { edits, session, props, copies } = harness()
      const before = copies()
      expect(edits.renameLayer('dot', 'Spot')).toBe(true)
      expect(edits.setLocked(['dot'], true)).toBe(true)
      // Named as the shortcut that locks names it.
      expect(session.undoName()).toBe(stepOf('lock'))
      expect(edits.setHidden(['tag'], true)).toBe(true)
      // Named as the shortcut that hides names it.
      expect(session.undoName()).toBe('hide')
      const { nodes } = session.design()
      expect(nodes.dot?.name).toBe('Spot')
      expect(nodes.dot?.lock).toEqual({ move: true, resize: true, content: true, style: true, delete: true })
      expect(props('tag')).toMatchObject({ visible: false })
      expect(copies()).toEqual(before)
      expect(edits.setHidden(['tag'], false)).toBe(true)
      expect(props('tag')).toMatchObject({ visible: true })
      expect(edits.setLocked(['dot'], false)).toBe(true)
      expect(session.design().nodes.dot?.lock).toBeUndefined()
    })
  })

  describe('setRadius', () => {
    /** One of each type with a radius, and an ellipse, in a square frame, each linked to a copy in a wide frame, `wide-<id>`. */
    const shape = (link: string, index: string, x: number, kind: Shape) => ({
      type: 'graphic' as const,
      parentId: 'sq',
      link,
      index,
      name: kind.kind,
      props: { x, y: 100, width: 120, height: 80, shape: kind, fills: [] },
    })
    const ROUNDED: DesignInput['nodes'] = {
      box: {
        type: 'box',
        parentId: 'sq',
        link: 'box',
        index: 'a0',
        name: 'Box',
        props: { x: 0, y: 300, width: 200, height: 120, cornerRadius: [8, 8, 8, 8] },
      },
      rect: shape('rect', 'a1', 0, { kind: 'rect', cornerRadius: 4 }),
      poly: shape('poly', 'a2', 200, { kind: 'polygon', sides: 6, cornerRadius: 0 }),
      star: shape('star', 'a3', 400, { kind: 'star', points: 5, innerRadius: 0.4, cornerRadius: 0 }),
      dot: shape('dot', 'a4', 600, { kind: 'ellipse' }),
    }
    const LINKED: DesignInput = {
      ...DESIGN,
      nodes: {
        ...ROUNDED,
        ...Object.fromEntries(
          Object.entries(ROUNDED).map(([id, node]) => [`wide-${id}`, { ...node, parentId: 'wide' }]),
        ),
      },
    }
    const radii = (design: Design, id: string) => {
      const props = design.nodes[id]?.props as Record<string, unknown>
      return id.endsWith('box') ? props.cornerRadius : props.shape
    }

    it('sets every type with a radius as one undo step named edit, an ellipse and the linked copies left as they are', async () => {
      const { core, press, end } = await testEditor(LINKED)
      const before = core.design()
      expect(core.setRadius(['box', 'rect', 'poly', 'star', 'dot'], () => 12.5)).toBe(true)
      const after = core.design()
      expect(radii(after, 'box')).toBe(12.5)
      expect(radii(after, 'rect')).toEqual({ kind: 'rect', cornerRadius: 12.5 })
      expect(radii(after, 'poly')).toEqual({ kind: 'polygon', sides: 6, cornerRadius: 12.5 })
      expect(radii(after, 'star')).toEqual({ kind: 'star', points: 5, innerRadius: 0.4, cornerRadius: 12.5 })
      expect(after.nodes.dot).toEqual(before.nodes.dot)
      for (const id of Object.keys(ROUNDED)) expect(after.nodes[`wide-${id}`]).toEqual(before.nodes[`wide-${id}`])
      expect(core.undoName()).toBe('edit')
      press('undo')
      expect(core.design()).toEqual(before)
      expect(core.canUndo()).toBe(false)
      end()
    })

    it('sets one corner of a box and a rectangle, and a polygon’s one radius, from each layer’s own', async () => {
      const { core, end } = await testEditor(LINKED)
      expect(core.setRadius(['box', 'rect', 'poly'], (r) => r + 250, 1)).toBe(true)
      const after = core.design()
      expect(radii(after, 'box')).toEqual([8, 258, 8, 8])
      expect(radii(after, 'rect')).toEqual({ kind: 'rect', cornerRadius: 4, corners: [4, 254, 4, 4] })
      expect(radii(after, 'poly')).toMatchObject({ cornerRadius: 250 })
      end()
    })

    it('makes four corners of one radius that one radius in an undo step', async () => {
      const { core, end } = await testEditor(LINKED)
      expect(core.setRadius(['box'], () => 8)).toBe(true)
      expect(radii(core.design(), 'box')).toBe(8)
      expect(core.undoName()).toBe('edit')
      end()
    })

    it('answers false for a style-locked layer alone, and among several sets the rest', async () => {
      const locked = structuredClone(LINKED)
      const star = locked.nodes.star
      if (star) star.lock = { move: false, resize: false, content: false, style: true, delete: false }
      const { core, press, end } = await testEditor(locked)
      const before = core.design()
      expect(core.setRadius(['star'], () => 20)).toBe(false)
      expect(core.design()).toEqual(before)
      expect(core.setRadius(['star', 'poly'], () => 20)).toBe(false)
      expect(radii(core.design(), 'star')).toMatchObject({ cornerRadius: 0 })
      expect(radii(core.design(), 'poly')).toMatchObject({ cornerRadius: 20 })
      press('undo')
      expect(core.design()).toEqual(before)
      end()
    })
  })

  describe('setFont', () => {
    it('loads the family, then sets it on the selected text layers and fits them', async () => {
      const { edits, selection, props, log } = harness()
      selection.select(['words', 'dot'], 'sq')
      await edits.setFont('Inter', 700)
      expect(props('words')).toMatchObject({ style: { fontFamily: 'Inter', fontWeight: 700 } })
      expect(log).toEqual(['load Inter', 'fit words'])
    })

    it('sets nothing once the editor is gone before the family arrives, or with no text selected', async () => {
      const { edits, selection, props, log, destroy } = harness()
      await edits.setFont('Inter')
      selection.select(['words'], 'sq')
      const setting = edits.setFont('Inter')
      destroy()
      await setting
      expect(props('words')).toMatchObject({ style: { fontFamily: 'Noto Sans' } })
      expect(log).toEqual(['load Inter'])
    })

    it('ends a font binding, in one undo step that brings the font and the binding back', async () => {
      const { edits, selection, session, props } = harness()
      session.run('node.bind', { ids: ['words'], property: 'fontFamily', ref: 'brand:heading', value: 'Noto Sans' })
      selection.select(['words'], 'sq')
      await edits.setFont('Inter')
      expect(props('words')).toMatchObject({ style: { fontFamily: 'Inter' } })
      expect(session.design().nodes.words?.bindings).toBeUndefined()
      session.undo()
      expect(props('words')).toMatchObject({ style: { fontFamily: 'Noto Sans' } })
      expect(session.design().nodes.words?.bindings).toEqual({ fontFamily: 'brand:heading' })
    })
  })
})
