import { describe, expect, it } from 'vitest'

import { idsOf, pairsIn } from '../../selection.ts'
import { testEditor } from '../../test-editor.ts'
import { pointerInput } from '../test-inputs.ts'
import {
  DESIGN,
  FLOWS,
  harness,
  LINKED,
  LOCKED_COPY,
  MASKED,
  PIN_ON_DOT,
  ROUND_OVER_CARD,
  ROUND_OVER_PIN,
  SQUARE,
  TALL,
  THIN,
  TURNED,
} from './test-select-press.ts'
import type { MarqueeDrag } from './transform-drag.ts'

describe('editorSelectPress', () => {
  describe('press across frames', () => {
    it('adds a linked copy in another frame with Shift, and takes it out again', () => {
      const { selection, pressIn } = harness(null, LINKED)
      selection.select(['box'], SQUARE.id)
      pressIn(TALL, { x: 650, y: 150 }, true)
      expect(selection.current()).toEqual([...pairsIn('sq', ['box']), ...pairsIn('tall', ['tall-box'])])
      expect(pressIn(TALL, { x: 650, y: 150 }, true)).toBeNull()
      expect(selection.current()).toEqual(pairsIn('sq', ['box']))
    })

    it('selects alone with Shift a layer of another frame that is no copy of a selected one', () => {
      const { selection, pressIn } = harness(null, LINKED)
      selection.select(['box'], SQUARE.id)
      pressIn(TALL, { x: 150, y: 850 }, true)
      expect(selection.current()).toEqual(pairsIn('tall', ['own']))
    })

    it('moves the selected layers of every frame from a press on a copy, the frame pressed in dragged', () => {
      const { selection, pressIn, log } = harness(null, LINKED)
      selection.selectAcross([...pairsIn('sq', ['box']), ...pairsIn('tall', ['tall-box'])])
      pressIn(TALL, { x: 650, y: 150 })
      expect(log.at(-1)).toBe('press move tall: tall-box + sq: box')
      expect(selection.current()).toEqual([...pairsIn('sq', ['box']), ...pairsIn('tall', ['tall-box'])])
    })

    it('adds a copy locked in place with Shift and a click, and takes it out again, as a click selects it alone', () => {
      const { select, selection, pressIn } = harness(null, LOCKED_COPY)
      selection.select(['box'], SQUARE.id)
      select.release(pressIn(TALL, { x: 650, y: 150 }, true) as MarqueeDrag, true)
      expect(selection.current()).toEqual([...pairsIn('sq', ['box']), ...pairsIn('tall', ['tall-box'])])
      select.release(pressIn(TALL, { x: 650, y: 150 }, true) as MarqueeDrag, true)
      expect(selection.current()).toEqual(pairsIn('sq', ['box']))
    })

    it('moves the copies a lock leaves free from a press, when another frame holds one locked in place', () => {
      const { selection, pressIn, log } = harness(null, LOCKED_COPY)
      selection.selectAcross([...pairsIn('sq', ['box']), ...pairsIn('tall', ['tall-box'])])
      pressIn(SQUARE, { x: 650, y: 150 })
      expect(log.at(-1)).toBe('press move box + tall: tall-box')
    })

    it('selects alone the copy a click picked, in its own frame', () => {
      const { select, selection, pressIn } = harness(null, LINKED)
      selection.selectAcross([...pairsIn('sq', ['box']), ...pairsIn('tall', ['tall-box'])])
      pressIn(TALL, { x: 650, y: 150 })
      select.release(null, true)
      expect(selection.current()).toEqual(pairsIn('tall', ['tall-box']))
    })
  })

  describe('dragAt', () => {
    it('answers a move inside the selection’s box, as a press there drags it, and none outside it or with nothing selected', () => {
      const { select, selection } = harness()
      expect(select.dragAt({ x: 650, y: 150 }, null)).toBeNull()
      selection.select(['box'], SQUARE.id)
      expect(select.dragAt({ x: 650, y: 150 }, null)).toBe('move')
      expect(select.dragAt({ x: 699, y: 101 }, null)).toBe('move')
      expect(select.dragAt({ x: 300, y: 300 }, null)).toBeNull()
      expect(select.dragAt({ x: 650, y: -50 }, null)).toBeNull()
    })

    it('answers none on a handle, which resizes, and for a selection locked in place', () => {
      const { select, selection } = harness('se')
      selection.select(['box'], SQUARE.id)
      expect(select.dragAt({ x: 650, y: 150 }, { kind: 'resize', handle: 'se', drawn: true })).toBeNull()
      const locked = harness()
      locked.selection.select(['pin'], SQUARE.id)
      expect(locked.select.dragAt({ x: 605, y: 705 }, null)).toBeNull()
    })

    it('answers a reorder for layers a flow places, all in one flow', () => {
      const { select, selection } = harness()
      selection.select(['dot'], SQUARE.id)
      expect(select.dragAt({ x: 120, y: 140 }, null)).toBe('reorder')
    })

    it('answers none for layers of two flows, which a move leaves where they are, and a move with a free layer among them', () => {
      const { select, selection } = harness(null, FLOWS)
      selection.select(['dot', 'mark'], SQUARE.id)
      expect(select.dragAt({ x: 300, y: 200 }, null)).toBeNull()
      selection.select(['dot', 'mark', 'box'], SQUARE.id)
      expect(select.dragAt({ x: 300, y: 200 }, null)).toBe('move')
    })

    it('answers a move across frames, inside the box of the frame pointed at', () => {
      const { select, selection } = harness(null, LINKED)
      selection.selectAcross([...pairsIn('sq', ['box']), ...pairsIn('tall', ['tall-box'])])
      expect(select.dragAt({ x: TALL.x + 650, y: 150 }, null)).toBe('move')
      expect(select.dragAt({ x: TALL.x + 150, y: 850 }, null)).toBeNull()
    })
  })

  describe('press', () => {
    it('selects the top-level layer under the press, ending typing, and starts moving it', () => {
      const { selection, press, log } = harness()
      expect(press({ x: 115, y: 125 })).toEqual({ kind: 'move' })
      expect(selection.current()).toEqual(pairsIn('sq', ['card']))
      expect(log).toEqual(['stop typing', 'hold', 'press move card'])
    })

    it('adds a layer to the selection with Shift, or takes it out again', () => {
      const { selection, press } = harness()
      selection.select(['box'], SQUARE.id)
      expect(press({ x: 115, y: 125 }, true)).toEqual({ kind: 'move' })
      expect(idsOf(selection.current())).toEqual(['box', 'card'])
      expect(press({ x: 115, y: 125 }, true)).toBeNull()
      expect(idsOf(selection.current())).toEqual(['box'])
    })

    it("starts a marquee on a frame's empty area, letting the selection and the group gone into go", () => {
      const { selection, press, log } = harness()
      selection.enter('card')
      selection.select(['dot'], SQUARE.id)
      expect(press({ x: 900, y: 900 })).toEqual({
        kind: 'marquee',
        from: { x: 900, y: 900 },
        to: { x: 900, y: 900 },
        base: [],
      })
      expect(selection.current()).toBeNull()
      expect(selection.entered()).toBeNull()
      expect(log).toEqual(['stop typing', 'hold'])
    })

    it("starts a marquee on a picked frame's empty area, leaving the frame where it is", () => {
      const { selection, press } = harness()
      selection.pickFrame('sq')
      expect(press({ x: 900, y: 900 })).toMatchObject({ kind: 'marquee', base: [] })
    })

    it('starts a marquee off every frame, letting the selection and the picked frame go', () => {
      const { selection, pressOff, log } = harness()
      selection.select(['box'], SQUARE.id)
      expect(pressOff({ x: 1200, y: 900 })).toEqual({
        kind: 'marquee',
        from: { x: 1200, y: 900 },
        to: { x: 1200, y: 900 },
        base: [],
      })
      expect(selection.current()).toBeNull()
      expect(log).toEqual(['stop typing', 'hold'])
    })

    it("starts a marquee on a frame's empty area with Shift, from the selection it toggles", () => {
      const { selection, press } = harness()
      selection.select(['box'], SQUARE.id)
      expect(press({ x: 900, y: 900 }, true)).toMatchObject({ kind: 'marquee', base: pairsIn('sq', ['box']) })
      expect(selection.pickedFrame()).toBeNull()
    })

    it('starts a marquee beside a turned selected layer, inside its unturned box but outside its own', () => {
      const { selection, press } = harness(null, TURNED)
      selection.select(['box'], SQUARE.id)
      expect(press({ x: 605, y: 105 })).toMatchObject({ kind: 'marquee' })
      expect(press({ x: 650, y: 150 })).toEqual({ kind: 'move' })
    })

    it('moves a thin selected layer from a press a pixel off its box, whatever the pick finds there', () => {
      for (const [id, top, off] of [
        ['caption', 800, 1],
        ['caption', 800, 0.5],
        ['oval', 900, 1],
        ['rule', 1000, 1],
      ] as const) {
        const { selection, press } = harness(null, THIN)
        selection.select([id], SQUARE.id)
        expect(press({ x: 250, y: top - off }), `${id} ${off}`).toEqual({ kind: 'move' })
        expect(idsOf(selection.current()), `${id} ${off}`).toEqual([id])
      }
    })

    it('starts a marquee on a locked layer, which a click then selects', () => {
      const { selection, press } = harness()
      expect(press({ x: 605, y: 705 })).toMatchObject({ kind: 'marquee' })
      expect(selection.pickedFrame()).toBeNull()
    })

    it('grabs a handle of the selection under the press', () => {
      const { selection, press, log } = harness('se')
      selection.select(['box'], SQUARE.id)
      expect(press({ x: 700, y: 200 })).toEqual({ kind: 'resize' })
      expect(log).toEqual(['stop typing', 'press handle resize'])
    })
  })

  describe('pressLabel', () => {
    it('picks the frame, ending typing and letting the selection and the group gone into go, and starts moving it', () => {
      const { select, selection, log } = harness()
      selection.enter('card')
      selection.select(['dot'], SQUARE.id)
      expect(select.pressLabel(pointerInput(), { x: 40, y: -10 }, 'sq')).toMatchObject({
        kind: 'frameMove',
        frame: SQUARE,
        from: { x: 40, y: -10 },
      })
      expect(selection.current()).toBeNull()
      expect(selection.entered()).toBeNull()
      expect(selection.pickedFrame()).toBe('sq')
      expect(log).toEqual(['stop typing', 'hold'])
    })

    it('does nothing for a frame the shown page lacks', () => {
      const { select, selection, log } = harness()
      selection.select(['box'], SQUARE.id)
      expect(select.pressLabel(pointerInput(), { x: 40, y: -10 }, 'gone')).toBeNull()
      expect(idsOf(selection.current())).toEqual(['box'])
      expect(log).toEqual([])
    })

    it('stars the frame from a press on its star, as one undo step, picking nothing and starting no drag; a second press unstars it', () => {
      const { select, selection, session, log } = harness()
      selection.select(['box'], SQUARE.id)
      const onStar = pointerInput({ star: 'sq' })
      expect(select.pressLabel(onStar, { x: 60, y: -10 }, 'sq')).toBe(true)
      expect(session.design().frames.sq?.starred).toBe(true)
      expect(session.undoName()).toBe('star')
      expect(idsOf(selection.current())).toEqual(['box'])
      expect(selection.pickedFrame()).toBeNull()
      expect(log).toEqual(['stop typing'])
      expect(select.pressLabel(onStar, { x: 60, y: -10 }, 'sq')).toBe(true)
      expect(session.design().frames.sq).not.toHaveProperty('starred')
      expect(session.undoName()).toBe('unstar')
      session.undo()
      expect(session.design().frames.sq?.starred).toBe(true)
      session.undo()
      expect(session.design().frames.sq).not.toHaveProperty('starred')
    })

    it('picks the frame from a press on its star in a tab that may only view, as a press on its name does, and stars nothing', () => {
      const { select, selection, session } = harness(null, DESIGN, true)
      expect(select.pressLabel(pointerInput({ star: 'sq' }), { x: 60, y: -10 }, 'sq')).toMatchObject({
        kind: 'frameMove',
      })
      expect(selection.pickedFrame()).toBe('sq')
      expect(session.design().frames.sq).not.toHaveProperty('starred')
    })

    it("picks the frame from a press on its label while another frame's star is under the pointer", () => {
      const { select, selection, session } = harness()
      expect(select.pressLabel(pointerInput({ star: 'tall' }), { x: 40, y: -10 }, 'sq')).toMatchObject({
        kind: 'frameMove',
      })
      expect(selection.pickedFrame()).toBe('sq')
      expect(session.design().frames.sq).not.toHaveProperty('starred')
    })
  })

  describe('hoverStar', () => {
    const at = (x: number, y: number, pointerType = 'mouse') => pointerInput({ at: { x, y }, pointerType })

    it('has the label whose row a mouse or a pen hovers offer its star, saying when that changes, and none off the row', () => {
      const { select } = harness()
      expect(select.starOffered()).toBeNull()
      expect(select.hoverStar(at(500, -10))).toBe(true)
      expect(select.starOffered()).toBe('sq')
      expect(select.hoverStar(at(600, -20, 'pen'))).toBe(false)
      expect(select.hoverStar(at(500, 50))).toBe(true)
      expect(select.starOffered()).toBeNull()
      select.hoverStar(at(500, -10))
      expect(select.hoverStar(null)).toBe(true)
      expect(select.starOffered()).toBeNull()
    })

    it('offers no star to a finger, which has no hover', () => {
      const { select } = harness()
      expect(select.hoverStar(at(500, -10, 'touch'))).toBe(false)
      expect(select.starOffered()).toBeNull()
    })

    it('offers no star in a tab that may only view', () => {
      const { select } = harness(null, DESIGN, true)
      expect(select.hoverStar(at(500, -10))).toBe(false)
      expect(select.starOffered()).toBeNull()
    })
  })

  describe('a press in a zone', () => {
    for (const [name, grab] of [
      ['a corner', 'se'],
      ['an edge', 'e'],
      ['the turning ring', { kind: 'rotate', angle: 45 }],
    ] as const)
      it(`keeps the selection after a click on ${name}`, () => {
        const { select, selection, press } = harness(grab)
        selection.select(['box'], SQUARE.id)
        press({ x: 698, y: 150 })
        select.release(null, true)
        expect(idsOf(selection.current())).toEqual(['box'])
      })

    it('selects what lies under a click in it: another layer, or nothing on a frame’s empty area', () => {
      const { select, selection, press } = harness('e')
      selection.select(['dot'], SQUARE.id)
      // Just right of the dot, on the card that holds it.
      press({ x: 145, y: 140 })
      select.release(null, true)
      expect(idsOf(selection.current())).toEqual(['card'])
      selection.select(['box'], SQUARE.id)
      press({ x: 703, y: 150 })
      select.release(null, true)
      expect(idsOf(selection.current())).toEqual([])
      expect(selection.pickedFrame()).toBe('sq')
    })

    it('adds what lies under a click with Shift, as a click there adds it', () => {
      const { select, selection, press } = harness('w')
      selection.select(['box'], SQUARE.id)
      press({ x: 498, y: 150 }, true)
      select.release(null, true)
      expect(idsOf(selection.current())).toEqual(['box', 'card'])
    })

    it('keeps the selection after a click on a drawn handle, whatever lies under it', () => {
      const { select, selection, press } = harness({ kind: 'resize', handle: 'se', drawn: true })
      selection.select(['box'], SQUARE.id)
      // On the card, and on the frame's empty area.
      for (const at of [
        { x: 115, y: 125 },
        { x: 900, y: 900 },
      ]) {
        press(at)
        select.release(null, true)
        expect(idsOf(selection.current()), `${at.x}`).toEqual(['box'])
        expect(selection.pickedFrame()).toBeNull()
      }
    })

    it("picks the frame whose label a click in a zone that isn't drawn is on, with Shift too", () => {
      for (const shiftKey of [false, true]) {
        const { select, selection } = harness({ kind: 'rotate', angle: 45 })
        selection.select(['box'], SQUARE.id)
        select.press(pointerInput({ shiftKey }), { x: 20, y: -10 }, null, null, 'sq')
        select.release(null, true)
        expect(selection.current(), `${shiftKey}`).toBeNull()
        expect(selection.pickedFrame(), `${shiftKey}`).toBe('sq')
      }
    })

    it('selects nothing on the release of a press that became a drag', () => {
      const { select, selection, press } = harness('e')
      selection.select(['dot'], SQUARE.id)
      press({ x: 142, y: 140 })
      select.release(null, false)
      expect(idsOf(selection.current())).toEqual(['dot'])
    })
  })

  describe('release', () => {
    it('selects alone the one of several selected layers a click picked, unless it became a drag', () => {
      const { select, selection, press } = harness()
      selection.select(['card', 'box'], SQUARE.id)
      press({ x: 115, y: 125 })
      select.release(null, true)
      expect(idsOf(selection.current())).toEqual(['card'])
      selection.select(['card', 'box'], SQUARE.id)
      press({ x: 115, y: 125 })
      select.release(null, false)
      expect(idsOf(selection.current())).toEqual(['card', 'box'])
    })

    it('picks the frame a click on its empty area was pressed on, picked or not, and lets it go after a marquee dragged from there', () => {
      const { select, selection, press } = harness()
      select.release(press({ x: 900, y: 900 }) as MarqueeDrag, true)
      expect(selection.pickedFrame()).toBe('sq')
      select.release(press({ x: 900, y: 900 }) as MarqueeDrag, true)
      expect(selection.pickedFrame()).toBe('sq')
      const marquee = press({ x: 900, y: 900 }) as MarqueeDrag
      marquee.to = { x: 1000, y: 1000 }
      select.release(marquee, false)
      expect(selection.pickedFrame()).toBeNull()
    })

    it('selects the locked layer a marquee that stayed a click was pressed on', () => {
      const { select, selection, press } = harness()
      select.release(press({ x: 605, y: 705 }) as MarqueeDrag, true)
      expect(selection.current()).toEqual(pairsIn('sq', ['pin']))
    })

    it('lets the picked frame go after a marquee off every frame, a click or a drag', () => {
      const { select, selection, pressOff } = harness()
      selection.pickFrame('sq')
      select.release(pressOff({ x: 1200, y: 900 }) as MarqueeDrag, true)
      expect(selection.pickedFrame()).toBeNull()
      selection.pickFrame('sq')
      const marquee = pressOff({ x: 1200, y: 900 }) as MarqueeDrag
      marquee.to = { x: 900, y: 900 }
      select.release(marquee, false)
      expect(selection.pickedFrame()).toBeNull()
    })

    it('keeps the selection after a click on a selected layer’s see-through part over a locked layer', () => {
      const { select, selection, press } = harness(null, ROUND_OVER_PIN)
      selection.select(['round'], SQUARE.id)
      press({ x: 583, y: 683 })
      select.release(null, true)
      expect(selection.current()).toEqual(pairsIn('sq', ['round']))
    })

    it("moves a selected layer from a press on its box's empty corner over another layer, and selects that layer on a click there", () => {
      const { select, selection, press, log } = harness(null, ROUND_OVER_CARD)
      selection.select(['round'], SQUARE.id)
      expect(press({ x: 303, y: 203 })).toEqual({ kind: 'move' })
      expect(log.at(-1)).toBe('press move round')
      expect(selection.current()).toEqual(pairsIn('sq', ['round']))
      select.release(null, true)
      expect(selection.current()).toEqual(pairsIn('sq', ['card']))
    })

    it('picks the frame under a click in the selection box on no layer', () => {
      const { select, selection, press } = harness()
      selection.select(['card', 'box'], SQUARE.id)
      press({ x: 550, y: 150 })
      select.release(null, true)
      expect(selection.current()).toBeNull()
      expect(selection.pickedFrame()).toBe('sq')
    })
  })

  describe('cancel', () => {
    it('forgets the locked layer a press on it would select', () => {
      const { select, selection, press } = harness()
      const marquee = press({ x: 605, y: 705 }) as MarqueeDrag
      select.cancel()
      select.release(marquee, true)
      expect(selection.current()).toBeNull()
    })
  })

  describe('a layer locked in place over another, in the test editor', () => {
    it('is what a click selects, and a drag from it moves neither while a double click goes into neither', async () => {
      const editor = await testEditor(PIN_ON_DOT)
      const { core, mouse, modules } = editor
      const at = core.stagePoint(125, 140, 'sq')
      mouse.click(at.x, at.y)
      expect(core.selection()).toEqual(['pin'])
      const before = JSON.stringify(core.design())
      mouse.drag(at, core.stagePoint(195, 220, 'sq'))
      expect(JSON.stringify(core.design())).toBe(before)
      // A click keeps it selected, and a double click there leaves it so, going into neither it nor the card under it.
      mouse.click(at.x, at.y)
      expect(core.selection()).toEqual(['pin'])
      mouse.dblclick(at.x, at.y)
      expect(core.selection()).toEqual(['pin'])
      expect(modules.selection.entered()).toBeNull()
      editor.end()
    })
  })

  describe('a selected mask, in the test editor', () => {
    it('moves alone from a press in its box, what it masks staying, in one undo step, and a click there selects its group', async () => {
      const editor = await testEditor(MASKED)
      const { core, mouse } = editor
      const before = JSON.stringify(core.design())
      core.select(['mask'])
      core.redraw()
      // In its middle, where the rect it masks is drawn.
      const at = core.stagePoint(300, 750, 'sq')
      mouse.drag(at, core.stagePoint(400, 800, 'sq'))
      expect(core.design().nodes.mask?.props).toMatchObject({ x: 200, y: 650, width: 400, height: 300 })
      expect(core.design().nodes.photo?.props).toMatchObject({ x: 100, y: 600, width: 400, height: 300 })
      expect(core.selection()).toEqual(['mask'])
      editor.press('undo')
      expect(JSON.stringify(core.design())).toBe(before)
      core.select(['mask'])
      core.redraw()
      mouse.click(at.x, at.y)
      expect(core.selection()).toEqual(['masked'])
      expect(JSON.stringify(core.design())).toBe(before)
      editor.end()
    })
  })
})
