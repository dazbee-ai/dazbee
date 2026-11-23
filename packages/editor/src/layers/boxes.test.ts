import { describe, expect, it } from 'vitest'

import type { SceneLayer } from '@dazbee/renderer'

import { type Frame, pageFrames } from '../canvas/frames.ts'
import { editorSelection } from '../selection.ts'
import { visibleIn } from './boxes.ts'
import { DESIGN, measure, sessionOf, STYLE, testBoxes } from './test-boxes.ts'

/** The box queries over the design on a real session and selection, in its square and wide frames. */
function harness(zoom = 1) {
  const session = sessionOf(DESIGN)
  const frames = pageFrames(session.design(), 'p1').frames
  const selection = editorSelection({ drawn: () => session.design(), frames: () => frames, changed: () => {} })
  const boxes = testBoxes(session, selection, frames, { a1: { width: 400, height: 400 } }, undefined, () => zoom)
  const [square, wide] = frames as [Frame, Frame]
  return { session, selection, frames, boxes, square, wide }
}
const layer = (id: string) => ({ id }) as SceneLayer
/** Adds to the square a floor, locked in place if told, and over it a layer drawn at opacity 0. */
function withFaint({ session, square }: ReturnType<typeof harness>, locked = false) {
  const add = (id: string, box: { x: number; y: number; width: number; height: number }, extra = {}) =>
    session.run('node.create', {
      id,
      parentId: square.id,
      layer: { type: 'graphic', name: id, props: { ...box, shape: { kind: 'rect' }, ...extra } },
    })
  add('floor', { x: 100, y: 850, width: 400, height: 200 })
  add('zero', { x: 150, y: 880, width: 200, height: 100 }, { opacity: 0 })
  if (locked) session.run('node.lock', { ids: ['floor'], lock: { move: true } })
}

describe('visibleIn', () => {
  it('says whether a layer shows: its copy in another frame may be hidden while it shows', () => {
    const { session } = harness()
    expect(visibleIn(session.design(), 'dot')).toBe(true)
    expect(visibleIn(session.design(), 'wide-dot')).toBe(false)
  })
})

describe('editorBoxes', () => {
  describe('boxIn', () => {
    it("reads a layer's own box, and its linked copy's", () => {
      const { boxes } = harness()
      expect(boxes.boxIn('dot')).toEqual({ x: 110, y: 120, width: 30, height: 40, rotation: 0 })
      expect(boxes.boxIn('wide-dot')).toEqual({ x: 150, y: 120, width: 30, height: 40, rotation: 0 })
      expect(boxes.boxIn('gone')).toBeNull()
    })

    it('takes the box auto layout gives a layer in a flow, from the scene', () => {
      const { boxes } = harness()
      expect(boxes.boxIn('a')).toMatchObject({ x: 100, y: 500, width: 50, height: 50 })
      expect(boxes.boxIn('b')).toMatchObject({ x: 160, y: 500, width: 60, height: 50 })
    })
  })

  describe('containersOf', () => {
    it('gives the groups and boxes a layer is inside, outermost first, as boxes', () => {
      const { boxes, square } = harness()
      expect(boxes.containersOf(square, 'turned')).toEqual([{ x: 600, y: 100, width: 200, height: 200, rotation: 90 }])
      expect(boxes.containersOf(square, 'sq')).toEqual([])
    })
  })

  describe('drawnBoxOf', () => {
    it('turns a layer with the containers it is in', () => {
      const { boxes, square } = harness()
      const drawn = boxes.drawnBoxOf(square, 'inside')
      expect(drawn?.rotation).toBe(90)
      expect(drawn?.x).toBeCloseTo(780)
      expect(drawn?.y).toBeCloseTo(100)
      expect(boxes.drawnBoxOf(square, 'dot')).toEqual({ x: 110, y: 120, width: 30, height: 40, rotation: 0 })
    })
  })

  describe('drawnContains', () => {
    it('says whether a point in the frame is inside a layer as drawn', () => {
      const { session, boxes, square } = harness()
      expect(boxes.drawnContains(square, 'inside', { x: 790, y: 110 }, session.design())).toBe(true)
      expect(boxes.drawnContains(square, 'inside', { x: 610, y: 110 }, session.design())).toBe(false)
      expect(boxes.drawnContains(square, 'gone', { x: 610, y: 110 }, session.design())).toBe(false)
    })
  })

  describe('startBoxes', () => {
    it('gives the boxes of layers and of those under them, leaving out layers a flow inside them places', () => {
      const { boxes, square } = harness()
      expect([...boxes.startBoxes(square, ['card']).keys()]).toEqual(['card', 'dot', 'tag'])
      expect([...boxes.startBoxes(square, ['row']).keys()]).toEqual(['row'])
      expect([...boxes.startBoxes(square, ['a']).keys()]).toEqual(['a'])
    })
  })

  describe('selectionBox', () => {
    it("is one layer's own box, or the box around several, with where it is drawn and its containers", () => {
      const { selection, boxes, square } = harness()
      expect(boxes.selectionBox()).toBeNull()
      selection.select(['inside'], square.id)
      expect(boxes.selectionBox()).toMatchObject({
        frame: square,
        box: { x: 600, y: 100, width: 20, height: 20, rotation: 0 },
        drawn: { rotation: 90 },
        around: [{ x: 600, y: 100, rotation: 90 }],
      })
      selection.select(['dot', 'zig'], square.id)
      expect(boxes.selectionBox()?.box).toEqual({ x: 100, y: 120, width: 100, height: 680, rotation: 0 })
    })
  })

  describe('roots', () => {
    it('leaves out selected layers inside another selected layer, and layers that are gone', () => {
      const { session, selection, boxes, square } = harness()
      selection.select(['dot', 'card', 'zig'], square.id)
      expect(boxes.roots()).toEqual(['card', 'zig'])
      session.run('node.delete', { ids: ['zig'] })
      expect(boxes.roots()).toEqual(['card'])
    })
  })

  describe('pickable', () => {
    it('leaves out layers locked in place', () => {
      const { boxes } = harness()
      expect(boxes.pickable(layer('pin'))).toBe(false)
      expect(boxes.pickable(layer('dot'))).toBe(true)
    })
  })

  describe('lockedSelection', () => {
    it('says whether a selected layer is locked in place', () => {
      const { selection, boxes, square } = harness()
      expect(boxes.lockedSelection()).toBe(false)
      selection.select(['dot', 'pin'], square.id)
      expect(boxes.lockedSelection()).toBe(true)
    })
  })

  describe('handlesFor', () => {
    it('gives every handle, none while locked, and no top or bottom one to text that grows with its words', () => {
      const { selection, boxes, square } = harness()
      expect(boxes.handlesFor()).toEqual([])
      selection.select(['dot'], square.id)
      expect(boxes.handlesFor()).toHaveLength(8)
      selection.select(['label'], square.id)
      expect(boxes.handlesFor()).toEqual(['nw', 'ne', 'e', 'se', 'sw', 'w'])
      selection.select(['pin'], square.id)
      expect(boxes.handlesFor()).toEqual([])
    })

    it('gives a curved text only its corners, whatever its box mode', () => {
      const { session, selection, boxes, square } = harness()
      for (const boxMode of ['autoWidth', 'fixed']) {
        session.run('node.update', { ids: ['label'], patch: { boxMode, curve: { shape: 'arcUp', amount: 50 } } })
        selection.select(['label'], square.id)
        expect(boxes.handlesFor()).toEqual(['nw', 'ne', 'se', 'sw'])
      }
    })

    it('gives a text that grows with its words, selected with its copies in other frames, no top or bottom one either', () => {
      const { selection, boxes, square, wide } = harness()
      selection.selectAcross([
        { id: 'label', frameId: square.id },
        { id: 'wide-label', frameId: wide.id },
      ])
      expect(boxes.handlesFor()).toEqual(['nw', 'ne', 'e', 'se', 'sw', 'w'])
    })

    it('gives every handle to two texts that grow with their words, selected together', () => {
      const { session, selection, boxes, square } = harness()
      session.run('node.create', {
        id: 'tall',
        parentId: square.id,
        layer: {
          type: 'text',
          name: 'Tall',
          props: { x: 700, y: 800, width: 200, height: 24, text: 'Hi', boxMode: 'autoHeight', style: STYLE },
        },
      })
      selection.select(['label', 'tall'], square.id)
      expect(boxes.handlesFor()).toHaveLength(8)
    })
  })

  describe('selectedLine', () => {
    it('is one line selected alone, its ends its handles unless a flow places it, and nothing else', () => {
      const { session, selection, boxes, square, wide } = harness()
      const line = (id: string, parentId: string) =>
        session.run('node.create', {
          id,
          parentId,
          layer: {
            type: 'graphic',
            name: 'Line',
            props: { x: 0, y: 900, width: 200, height: 0, shape: { kind: 'line' } },
          },
        })
      line('line', square.id)
      session.run('node.create', {
        id: 'column',
        parentId: square.id,
        layer: {
          type: 'box',
          name: 'Column',
          props: { x: 0, y: 0, width: 300, height: 300, layout: { direction: 'column' } },
        },
      })
      line('rule', 'column')
      expect(boxes.selectedLine()).toBeNull()
      selection.select(['line'], square.id)
      expect(boxes.selectedLine()).toMatchObject({ ends: true })
      selection.select(['rule'], square.id)
      expect(boxes.selectedLine()).toMatchObject({ ends: false })
      selection.select(['line', 'dot'], square.id)
      expect(boxes.selectedLine()).toBeNull()
      line('wide-line', wide.id)
      selection.selectAcross([
        { id: 'line', frameId: square.id },
        { id: 'wide-line', frameId: wide.id },
      ])
      expect(boxes.selectedLine()).toMatchObject({ ends: false })
      selection.select(['dot'], square.id)
      expect(boxes.selectedLine()).toBeNull()
    })
  })

  describe('pickAt', () => {
    it("reaches past a layer's outline as far in screen pixels at the camera's zoom", () => {
      // 4 design pixels above the dot's top edge, at (120, 116).
      expect(harness(1).boxes.pickAt(harness(1).square, { x: 120, y: 116 })?.id).toBe('card')
      const zoomedOut = harness(0.25)
      expect(zoomedOut.boxes.pickAt(zoomedOut.square, { x: 120, y: 116 })?.id).toBe('dot')
    })

    it('passes over a layer at opacity 0, and gives it anywhere in its box once it is selected', () => {
      const h = harness()
      const { selection, boxes, square } = h
      withFaint(h)
      expect(boxes.pickAt(square, { x: 200, y: 900 })?.id).toBe('floor')
      selection.select(['zero'], square.id)
      expect(boxes.pickAt(square, { x: 200, y: 900 })?.id).toBe('zero')
      expect(boxes.pickAt(square, { x: 340, y: 970 })?.id).toBe('zero')
      selection.select([], square.id)
      expect(boxes.pickAt(square, { x: 340, y: 970 })?.id).toBe('floor')
    })
  })

  describe('snapBoxes', () => {
    const CARD = { x: 100, y: 100, width: 400, height: 300, rotation: 0 }
    const TURNED = { x: 600, y: 100, width: 200, height: 200, rotation: 90 }
    const NONE = { width: false, height: false }

    it('in the frame, gives the frame as the parent, its other top-level layers as drawn beside, leaving out those holding the dragged ones, within the frame', () => {
      const { boxes, square } = harness()
      const found = boxes.snapBoxes(square, ['zig'], [])
      expect(found?.parent).toBe('sq')
      expect(found?.within).toEqual([{ x: 0, y: 0, width: square.width, height: square.height }])
      expect(found?.beside).toHaveLength(6)
      expect(found?.beside).toContainEqual(CARD)
      expect(found?.beside).not.toContainEqual({ x: 100, y: 700, width: 100, height: 100, rotation: 0 })
    })

    it('in an upright box, adds the layers beside that show in the frame, within the box as it is and the frame', () => {
      const { boxes, square, wide } = harness()
      const dot = { x: 110, y: 120, width: 30, height: 40, rotation: 0 }
      const inCard = boxes.snapBoxes(square, ['tag'], [CARD])
      expect(inCard?.parent).toBe('card')
      expect(inCard?.beside).toHaveLength(7)
      expect(inCard?.beside).not.toContainEqual(CARD)
      expect(inCard?.beside.at(-1)).toEqual(dot)
      expect(inCard?.within).toEqual([
        { x: 100, y: 100, width: 400, height: 300, follows: NONE },
        { x: 0, y: 0, width: square.width, height: square.height },
      ])
      // The wide frame's dot is hidden: nothing to snap to.
      const inWide = boxes.snapBoxes(wide, ['wide-tag'], [CARD])
      expect(inWide?.beside).toHaveLength(6)
      expect(inWide?.beside).not.toContainEqual({ ...dot, x: 150 })
    })

    it('in a turned group, gives the layers beside in its space and the group as it fits them, and nothing of the frame', () => {
      const { boxes, square, session } = harness()
      // The group's only layer sets each of its sides: nothing of the group is left.
      expect(boxes.snapBoxes(square, ['inside'], [TURNED])).toEqual({
        parent: 'turned',
        beside: [],
        within: [],
        guides: [],
      })
      session.run('node.create', {
        id: 'beside',
        parentId: 'turned',
        layer: {
          type: 'graphic',
          name: 'Beside',
          props: { x: 700, y: 200, width: 40, height: 40, rotation: 45, shape: { kind: 'rect' } },
        },
      })
      // The layer beside by the box around it as it is turned in the group, which the group fits alone.
      const found = boxes.snapBoxes(square, ['inside'], [TURNED])
      const around = {
        x: expect.closeTo(691.72, 2) as number,
        y: expect.closeTo(191.72, 2) as number,
        width: expect.closeTo(56.57, 2) as number,
        height: expect.closeTo(56.57, 2) as number,
      }
      expect(found?.beside).toEqual([{ ...around, rotation: 0 }])
      expect(found?.within).toEqual([{ ...around, follows: NONE }])
    })

    it('gives none when the containers given are not those of every layer and one around them is turned', () => {
      const { boxes, square } = harness()
      expect(boxes.snapBoxes(square, ['inside', 'zig'], [TURNED])).toBeNull()
      expect(boxes.snapBoxes(square, ['zig', 'inside'], [])).toBeNull()
      expect(boxes.snapBoxes(square, ['inside'], [])).toBeNull()
      expect(boxes.snapBoxes(square, ['inside'], [CARD])).toBeNull()
      // The same box turned another way is another space.
      expect(boxes.snapBoxes(square, ['inside'], [{ ...TURNED, rotation: 45 }])).toBeNull()
    })

    it('across parents with nothing around them turned, gives the first one’s parent and the layers beside it', () => {
      const { boxes, square } = harness()
      expect(boxes.snapBoxes(square, ['tag', 'zig'], [CARD])?.within).toEqual([
        { x: 100, y: 100, width: 400, height: 300, follows: NONE },
        { x: 0, y: 0, width: square.width, height: square.height },
      ])
    })
  })

  describe('pathIn', () => {
    it("gives a path layer's path in its frame, with its box and what turns it", () => {
      const { boxes, square } = harness()
      const zig = boxes.pathIn(square, 'zig')
      expect(zig?.path[0]?.anchors.map((a) => [a.x, a.y])).toEqual([
        [100, 700],
        [200, 700],
        [200, 800],
      ])
      expect(zig?.around).toEqual([{ x: 100, y: 700, width: 100, height: 100, rotation: 0 }])
      expect(boxes.pathIn(square, 'dot')).toBeNull()
    })
  })

  describe('cropTarget', () => {
    it('gives the topmost image fill, with the whole image covering the box', () => {
      const { boxes, square } = harness()
      expect(boxes.cropTarget(square, 'photo')).toMatchObject({
        index: 1,
        fill: { type: 'image', assetId: 'a1' },
        size: { width: 400, height: 400 },
        box: { x: 300, y: 700, width: 200, height: 100 },
        rect: { x: 300, y: 650, width: 200, height: 200 },
        around: [{ x: 300, y: 700, width: 200, height: 100 }],
      })
    })

    it('places the image by its own size when a smaller copy of it is drawn', () => {
      const { session, selection, frames, square } = harness()
      const copy = testBoxes(session, selection, frames, { a1: { width: 100, height: 100 } }, undefined, undefined, {
        a1: { width: 400, height: 400 },
      })
      expect(copy.cropTarget(square, 'photo')).toMatchObject({
        size: { width: 400, height: 400 },
        rect: { x: 300, y: 650, width: 200, height: 200 },
      })
    })

    it('gives none for a layer with no image fill, or whose image is not here', () => {
      const { session, boxes, square } = harness()
      expect(boxes.cropTarget(square, 'dot')).toBeNull()
      expect(boxes.cropTarget(square, 'card')).toBeNull()
      session.run('node.update', { ids: ['photo'], patch: { fills: [{ type: 'image', assetId: 'other' }] } })
      expect(boxes.cropTarget(square, 'photo')).toBeNull()
    })
  })

  describe('drawnInFlow', () => {
    it('gives where layers in a flow are drawn in their frame, and none for layers in no flow', () => {
      const { boxes } = harness()
      expect(boxes.drawnInFlow(['b'])).toEqual({ b: { x: 160, y: 500, width: 60, height: 50 } })
      expect(boxes.drawnInFlow(['wide-a', 'wide-b'])).toEqual({
        'wide-a': { x: 100, y: 500, width: 50, height: 50 },
        'wide-b': { x: 160, y: 500, width: 60, height: 50 },
      })
      expect(boxes.drawnInFlow(['dot'])).toBeUndefined()
    })
  })

  describe('storedBoxes', () => {
    it('stores a place inside a group the flow moved less how far it moved it, what a container given its place holds under that place', () => {
      const { session, boxes } = harness()
      session.run('node.move', { id: 'card', parentId: 'row' })
      // The row draws the card at 230,500, 130 right and 400 down of where it is stored.
      expect(boxes.storedBoxes(new Map([['dot', { x: 300 }]]))).toEqual(new Map([['dot', { x: 170 }]]))
      expect(
        boxes.storedBoxes(
          new Map([
            ['card', { x: 230, y: 500 }],
            ['dot', { x: 240, y: 520 }],
          ]),
        ),
      ).toEqual(
        new Map([
          ['card', { x: 230, y: 500 }],
          ['dot', { x: 240, y: 520 }],
        ]),
      )
      expect(boxes.storedBoxes(new Map([['pin', { x: 600, y: 700, width: 10 }]]), 'card')).toEqual(
        new Map([['pin', { x: 470, y: 300, width: 10 }]]),
      )
      expect(boxes.storedBoxes(new Map([['pin', { x: 600 }]]))).toEqual(new Map([['pin', { x: 600 }]]))
    })

    it("stores a nested laid-out box's absolute layer less how far the outer flow moved the box", () => {
      const { session, boxes } = harness()
      const box = { x: 800, y: 800, width: 100, height: 50, layout: { direction: 'row' as const } }
      session.run('node.create', { id: 'inner', parentId: 'row', layer: { type: 'box', name: 'Inner', props: box } })
      const badge = { x: 850, y: 820, width: 10, height: 10, shape: { kind: 'rect' as const }, absolute: true }
      session.run('node.create', {
        id: 'badge',
        parentId: 'inner',
        layer: { type: 'graphic', name: 'Badge', props: badge },
      })
      // The row draws the inner box at 230,500, 570 left and 300 up of where it is stored, its badge with it.
      expect(boxes.drawnProps('badge')).toMatchObject({ x: 280, y: 520 })
      expect(boxes.storedBoxes(new Map([['badge', { x: 280, y: 520 }]]))).toEqual(
        new Map([['badge', { x: 850, y: 820 }]]),
      )
    })

    it('gives a hidden layer in a group the flow moved where it would be drawn, which stores it where it is', () => {
      const { session, boxes } = harness()
      session.run('node.move', { id: 'card', parentId: 'row' })
      session.run('node.update', { ids: ['dot'], patch: { visible: false } })
      expect(boxes.drawnProps('dot')).toMatchObject({ x: 240, y: 520 })
      const { x, y } = boxes.drawnProps('dot') as { x: number; y: number }
      expect(boxes.storedBoxes(new Map([['dot', { x, y }]]))).toEqual(new Map([['dot', { x: 110, y: 120 }]]))
    })

    it('lays a frame out once while its layers stay as they are', () => {
      const session = sessionOf(DESIGN)
      const frames = pageFrames(session.design(), 'p1').frames
      const selection = editorSelection({ drawn: () => session.design(), frames: () => frames, changed: () => {} })
      let measured = 0
      const boxes = testBoxes(session, selection, frames, {}, (props, width) => {
        measured++
        return measure(props, width)
      })
      session.run('node.move', { id: 'label', parentId: 'row' })
      boxes.drawnInFlow(['label'])
      const once = measured
      expect(once).toBeGreaterThan(0)
      boxes.drawnInFlow(['label'])
      boxes.storedBoxes(new Map([['label', { x: 0 }]]))
      expect(boxes.drawnProps('label')).toMatchObject({ x: 230, y: 500 })
      expect(measured).toBe(once)
    })
  })

  describe('parentFor', () => {
    it("puts a new layer in the group or box gone into when it can hold it, else at the frame's top level", () => {
      const { session, selection, boxes, square } = harness()
      expect(boxes.parentFor(square, 'graphic', session.design())).toBe('sq')
      selection.enter('card')
      expect(boxes.parentFor(square, 'graphic', session.design())).toBe('card')
      selection.enter('zig')
      expect(boxes.parentFor(square, 'graphic', session.design())).toBe('sq')
    })
  })

  describe('lockedAt', () => {
    it('gives the layer locked in place that a press lands on, and none on a layer that moves', () => {
      const { boxes, square } = harness()
      expect(boxes.lockedAt(square, { x: 605, y: 705 })).toBe('pin')
      expect(boxes.lockedAt(square, { x: 115, y: 125 })).toBeNull()
      expect(boxes.lockedAt(square, { x: 1000, y: 1000 })).toBeNull()
    })

    it('gives none over a locked layer under a selected layer at opacity 0, which a press there keeps, and the locked one once it is let go', () => {
      const h = harness()
      const { selection, boxes, square } = h
      withFaint(h, true)
      selection.select(['zero'], square.id)
      expect(boxes.lockedAt(square, { x: 200, y: 900 })).toBeNull()
      expect(boxes.target(boxes.pickAt(square, { x: 200, y: 900 })?.id ?? '', square.id)).toBe('zero')
      selection.select([], square.id)
      expect(boxes.lockedAt(square, { x: 200, y: 900 })).toBe('floor')
    })
  })

  describe('target', () => {
    it('picks the top-level layer, a selected layer the press is in, or what is directly in the group gone into', () => {
      const { selection, boxes, square, wide } = harness()
      expect(boxes.target('dot', square.id)).toBe('card')
      selection.select(['dot'], square.id)
      expect(boxes.target('dot', square.id)).toBe('dot')
      expect(boxes.target('wide-dot', wide.id)).toBe('wide-card')
      selection.select([], square.id)
      selection.enter('card')
      expect(boxes.target('dot', square.id)).toBe('dot')
      expect(boxes.target('inside', square.id)).toBe('turned')
    })
  })

  describe('insideEntered', () => {
    it('says whether a layer is inside the group or box gone into, not the container itself', () => {
      const { selection, boxes } = harness()
      expect(boxes.insideEntered('dot')).toBe(false)
      selection.enter('card')
      expect(boxes.insideEntered('dot')).toBe(true)
      expect(boxes.insideEntered('card')).toBe(false)
      expect(boxes.insideEntered('zig')).toBe(false)
    })
  })

  describe('drawnRect', () => {
    it("gives a layer's box as drawn in a frame without its turn, and none for a layer that is gone", () => {
      const { boxes, square, wide } = harness()
      expect(boxes.drawnRect(square, 'dot')).toEqual({ x: 110, y: 120, width: 30, height: 40 })
      expect(boxes.drawnRect(wide, 'wide-dot')).toEqual({ x: 150, y: 120, width: 30, height: 40 })
      expect(boxes.drawnRect(square, 'gone')).toBeNull()
    })
  })
})
