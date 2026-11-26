import { describe, expect, it } from 'vitest'

import type { DesignInput } from '@dazbee/schema'

import { type Frame, pageFrames } from '../../canvas/frames.ts'
import { watchFaults } from '../../faults.ts'
import { editorFrameActions } from '../../frame-actions.ts'
import { hug } from '../../layers/hug.ts'
import { groupMovedByRow, sessionOf, testBoxes } from '../../layers/test-boxes.ts'
import { localTo } from '../../layers/transform.ts'
import { editorSelection, pairsIn } from '../../selection.ts'
import { faultOn, registerFaultyCommand } from '../../test-faults.ts'
import { layersIn, linkedFrames } from '../../test-matrix/design-builders.ts'
import { pointerInput } from '../test-inputs.ts'
import { draggedRect } from './draw-tools.ts'
import { type DrawingDeps, editorDrawing, isDrawing } from './drawing.ts'

const WHITE = [{ type: 'solid' as const, color: '#FFFFFFFF' }]
/** One page with one frame, holding a rect and a dot beside each other. */
const DESIGN: DesignInput = {
  meta: { designId: 'd', name: 'D' },
  pages: { p1: { name: 'One', order: 'a0' } },
  frames: { sq: { pageId: 'p1', name: 'Square', width: 1080, height: 1080, x: 0, y: 0, fills: WHITE, order: 'a0' } },
  nodes: {
    rect: {
      type: 'graphic',
      parentId: 'sq',
      link: 'rect',
      index: 'a0',
      name: 'Rect',
      props: { x: 100, y: 100, width: 50, height: 50, shape: { kind: 'rect' } },
    },
    dot: {
      type: 'graphic',
      parentId: 'sq',
      link: 'dot',
      index: 'a1',
      name: 'Dot',
      props: { x: 400, y: 400, width: 10, height: 10, shape: { kind: 'ellipse' } },
    },
  },
}
/** The design with a story beside the square, linked to it, holding a copy of the rect and of the dot. */
const LINKED = linkedFrames(DESIGN, [{ id: 'story', name: 'Story', width: 1080, height: 1920 }])
const pointer = pointerInput()
const PHOTO = { id: 'a1', name: 'Photo', width: 400, height: 200 }

/** Drawing over a design, the one above unless given, on a real session and selection, at zoom 1 with world 0, 0 at the stage's corner, in its first frame, logging what it asks for. */
function harness(design: DesignInput = DESIGN) {
  /** How many times the pointer was held. */
  let holds = 0
  const session = sessionOf(design)
  const frames = pageFrames(session.design(), 'p1').frames
  const frame = frames[0] as Frame
  const log: string[] = []
  const selection = editorSelection({ drawn: () => session.design(), frames: () => frames, changed: () => {} })
  const boxes = testBoxes(session, selection, frames)
  const frameName = (width: number, height: number) =>
    width === 300 && height === 300 ? 'Frame' : `${width} by ${height}`
  const frameActions = editorFrameActions({
    session,
    view: {
      page: () => 'p1',
      showWhole: (area) => log.push(`showWhole ${JSON.stringify(area)}`),
      camera: () => ({ x: 0, y: 0, zoom: 1 }),
    },
    tools: { setTool: (tool) => log.push(`tool ${tool}`) },
    frameName,
    selection,
    typing: { fitText: () => {} },
    rename: () => {},
    shownChanged: () => log.push('draw'),
  })
  const deps: DrawingDeps = {
    hold: () => (holds += 1),
    session,
    selection,
    tools: { setTool: (tool) => log.push(`tool ${tool}`) },
    typing: {
      stop: () => log.push('stop typing'),
      start: (id, at, offset, endGesture, created) => {
        log.push(`type into ${at} at ${offset}${created ? ', made for it' : ''}`)
        endGesture?.()
      },
    },
    boxes,
    page: () => 'p1',
    frames: () => frames,
    camera: () => ({ x: 0, y: 0, zoom: 1 }),
    frameMove: { shownSections: () => ({ outlines: [], lit: null }) },
    frameName,
    frameActions,
    hug: (ids) => {
      log.push(`hug ${ids.join(',')}`)
      hug(session, ids)
    },
    notify: (notice) => log.push(`notice ${notice}`),
    renameSection: (id) => log.push(`rename section ${id}`),
    shownChanged: () => log.push('draw'),
  }
  const drawing = editorDrawing(deps)
  const at = (x: number, y: number) => ({ frame, p: { x, y } })
  const made = () => Object.keys(session.design().nodes).filter((id) => id !== 'rect' && id !== 'dot')
  const props = (id: string) => session.design().nodes[id]?.props as Record<string, unknown> | undefined
  /** The frames the design has besides the square one. */
  const madeFrames = () => Object.entries(session.design().frames).filter(([id]) => id !== 'sq')
  /** Draws a frame with the Frame tool from one world point to another, as the pointer does. */
  const drawFrame = (from: { x: number; y: number }, to: { x: number; y: number }) => {
    const drag = drawing.pressFrame(pointer, from)
    drawing.drag(drag, to, false, false)
    drawing.release(drag)
    return drag
  }
  return { drawing, session, selection, boxes, frame, log, at, made, props, madeFrames, drawFrame, holds: () => holds }
}

describe('isDrawing', () => {
  it('says whether a gesture draws a new layer', () => {
    expect(isDrawing({ kind: 'draw' })).toBe(true)
    expect(isDrawing({ kind: 'textBox' })).toBe(true)
    expect(isDrawing({ kind: 'imageBox' })).toBe(true)
    expect(isDrawing({ kind: 'frameDraw' })).toBe(true)
    expect(isDrawing({ kind: 'move' })).toBe(false)
    expect(isDrawing(null)).toBe(false)
  })
})

describe('editorDrawing', () => {
  describe('holding the pointer', () => {
    it('holds it from the press that makes a shape', () => {
      const { drawing, at, holds } = harness()
      expect(drawing.pressShape(pointer, 'rect', at(100, 100))).not.toBeNull()
      expect(holds()).toBe(1)
    })

    it('holds it from the press of the text tool, of the image tool and of the Frame tool', () => {
      const { drawing, at, holds } = harness()
      drawing.pressText(pointer, at(300, 400))
      expect(holds()).toBe(1)
      drawing.pressImage(pointer, at(100, 100), PHOTO)
      expect(holds()).toBe(2)
      drawing.pressFrame(pointer, { x: 1200, y: 100 })
      expect(holds()).toBe(3)
    })
  })

  describe('shown', () => {
    it('gives the box a text drag is drawing, in its frame, whichever way it was dragged', () => {
      const { drawing, at } = harness()
      const drag = drawing.pressText(pointer, at(300, 400))
      drawing.drag(drag, { x: 100, y: 450 }, false, false)
      expect(drawing.shown(drag)).toEqual({
        kind: 'textBox',
        frame: drag.frame,
        rect: { x: 100, y: 400, width: 200, height: 50 },
      })
    })

    it("gives the box an image drag is drawing, kept to the image's shape with Shift", () => {
      const { drawing, at } = harness()
      const drag = drawing.pressImage(pointer, at(100, 100), PHOTO)
      drawing.drag(drag, { x: 300, y: 150 }, true, false)
      expect(drawing.shown(drag)).toEqual({
        kind: 'imageBox',
        frame: drag.frame,
        rect: { x: 100, y: 100, width: 200, height: 100 },
      })
    })

    it('gives the frame the Frame tool is drawing in world units, in no frame', () => {
      const { drawing } = harness()
      const drag = drawing.pressFrame(pointer, { x: 1200, y: 100 })
      drawing.drag(drag, { x: 1500, y: 400 }, false, false)
      expect(drawing.shown(drag)).toEqual({
        kind: 'frameDraw',
        frame: null,
        rect: { x: 1200, y: 100, width: 300, height: 300 },
      })
    })

    it('gives nothing for a shape, which draws itself', () => {
      const { drawing, at } = harness()
      const drag = drawing.pressShape(pointer, 'rect', at(100, 100))
      expect(drag && drawing.shown(drag)).toBeNull()
    })
  })

  describe('a shape', () => {
    it('is made at the press, stops typing, and grows with the drag', () => {
      const { drawing, session, log, at, made, props } = harness()
      const drag = drawing.pressShape(pointer, 'rect', at(200, 200))
      if (!drag) throw new Error('no drag')
      const [id] = made()
      expect(drag).toMatchObject({ kind: 'draw', tool: 'rect', id, roots: [id] })
      expect(session.inGesture()).toBe(true)
      expect(log).toEqual(['stop typing'])
      drawing.drag(drag, { x: 260, y: 240 }, false, false)
      expect(props(id as string)).toMatchObject({ x: 200, y: 200, width: 60, height: 40 })
    })

    it('ends as one undo step, selected, with the select tool back', () => {
      const { drawing, session, selection, log, at, made } = harness()
      const drag = drawing.pressShape(pointer, 'rect', at(200, 200))
      if (!drag) throw new Error('no drag')
      drawing.drag(drag, { x: 260, y: 240 }, false, false)
      drawing.release(drag)
      const [id] = made()
      expect(session.inGesture()).toBe(false)
      expect(selection.current()).toEqual(pairsIn('sq', [id ?? '']))
      expect(log.slice(1)).toEqual([`hug ${id}`, 'tool select'])
      session.undo()
      expect(made()).toEqual([])
    })

    it('draws a click at its usual size, centred where it landed', () => {
      const { drawing, at, made, props } = harness()
      const drag = drawing.pressShape(pointer, 'ellipse', at(500, 500))
      if (!drag) throw new Error('no drag')
      drawing.release(drag)
      expect(props(made()[0] as string)).toMatchObject({ x: 450, y: 450, width: 100, height: 100 })
    })

    it('goes into the group or box gone into, when it can hold it', () => {
      const { drawing, session, selection, at, made } = harness()
      session.run('node.group', { ids: ['rect'] })
      const group = session.design().nodes.rect?.parentId as string
      selection.enter(group)
      const drag = drawing.pressShape(pointer, 'rect', at(110, 110))
      expect(session.design().nodes[drag?.id ?? '']?.parentId).toBe(group)
      expect(made()).toHaveLength(2)
    })

    it('goes into the frame drawn in alone, the linked frame and its copies stored as they were, and undo takes it away', () => {
      const { drawing, session, at } = harness(LINKED)
      const json = JSON.stringify(session.design())
      const had = Object.keys(session.design().nodes)
      const story = () => JSON.stringify([session.design().frames.story, layersIn(session.design(), 'story')])
      const storyWas = story()
      const drag = drawing.pressShape(pointer, 'rect', at(700, 560))
      if (!drag) throw new Error('no drag')
      drawing.drag(drag, { x: 900, y: 700 }, false, false)
      drawing.release(drag)
      const { nodes } = session.design()
      expect(Object.keys(nodes).filter((id) => !had.includes(id))).toEqual([drag.id])
      expect(nodes[drag.id]).toMatchObject({ parentId: 'sq', props: { x: 700, y: 560, width: 200, height: 140 } })
      expect(story()).toBe(storyWas)
      session.undo()
      expect(JSON.stringify(session.design())).toBe(json)
    })
  })

  describe('in a group a row moved', () => {
    it('draws a shape, a text and an image where they were drawn, through undo and redo', () => {
      const { drawing, session, selection, boxes, frame, at, made } = harness()
      selection.enter(groupMovedByRow(session, 'rect', 'sq'))
      const shape = drawing.pressShape(pointer, 'rect', at(620, 630))
      if (!shape) throw new Error('no drag')
      drawing.drag(shape, { x: 680, y: 670 }, false, false)
      drawing.release(shape)
      selection.enter('moved')
      drawing.release(drawing.pressText(pointer, at(700, 600)))
      selection.enter('moved')
      const image = drawing.pressImage(pointer, at(610, 700), PHOTO)
      drawing.drag(image, { x: 650, y: 720 }, false, false)
      drawing.release(image)
      const [drawn, text, photo] = made().filter((id) => !['row', 'moved'].includes(id))
      const drawnAt = () => [drawn, text, photo].map((id) => boxes.drawnBoxOf(frame, id ?? ''))
      const want = [
        { x: 620, y: 630, width: 60, height: 40 },
        { x: 700, y: 600 },
        { x: 610, y: 700, width: 40, height: 20 },
      ]
      expect(drawnAt()).toMatchObject(want)
      for (let step = 0; step < 3; step++) session.undo()
      for (let step = 0; step < 3; step++) session.redo()
      expect(drawnAt()).toMatchObject(want)
    })
  })

  describe('a box drawn with the Box tool', () => {
    it('is a white box named Box that takes in the layers wholly inside it where they were, in the same undo step', () => {
      const { drawing, session, boxes, frame, at, made } = harness()
      const rectAt = () => boxes.drawnBoxOf(frame, 'rect')
      const rectWas = rectAt()
      const drag = drawing.pressShape(pointer, 'box', at(50, 50))
      if (!drag) throw new Error('no drag')
      drawing.drag(drag, { x: 300, y: 300 }, false, false)
      drawing.release(drag)
      expect(session.design().nodes[drag.id]).toMatchObject({
        type: 'box',
        name: 'Box',
        props: { fills: [{ type: 'solid', color: '#FFFFFFFF' }] },
      })
      expect(session.design().nodes.rect?.parentId).toBe(drag.id)
      expect(rectAt()).toEqual(rectWas)
      expect(session.design().nodes.dot?.parentId).toBe('sq')
      session.undo()
      expect(made()).toEqual([])
      expect(session.design().nodes.rect?.parentId).toBe('sq')
      session.redo()
      expect(session.design().nodes[drag.id]).toMatchObject({ type: 'box', name: 'Box' })
      expect(session.design().nodes.rect?.parentId).toBe(drag.id)
      expect(rectAt()).toEqual(rectWas)
    })

    it('draws a click 200 across, centred where it landed', () => {
      const { drawing, at, made, props } = harness()
      const drag = drawing.pressShape(pointer, 'box', at(500, 500))
      if (!drag) throw new Error('no drag')
      drawing.release(drag)
      expect(props(made()[0] as string)).toMatchObject({ x: 400, y: 400, width: 200, height: 200 })
    })
  })

  describe('a text box', () => {
    it('follows the drag, then makes the text and starts typing into it in the same undo step', () => {
      const { drawing, session, selection, log, at, made, props } = harness()
      const drag = drawing.pressText(pointer, at(200, 200))
      expect(drag).toMatchObject({ kind: 'textBox', parentId: 'sq', from: { x: 200, y: 200 } })
      drawing.drag(drag, { x: 400, y: 260 }, false, false)
      expect(drag.to).toEqual({ x: 400, y: 260 })
      drawing.release(drag)
      const [id] = made()
      expect(props(id as string)).toMatchObject({ x: 200, y: 200, width: 200, height: 60, boxMode: 'fixed' })
      expect(selection.current()).toEqual(pairsIn('sq', [id ?? '']))
      expect(log).toEqual(['stop typing', 'draw', 'tool select', 'type into sq at 0, made for it'])
      expect(session.inGesture()).toBe(false)
      session.undo()
      expect(made()).toEqual([])
    })

    it('makes text that grows with its words from a click', () => {
      const { drawing, at, made, props } = harness()
      drawing.release(drawing.pressText(pointer, at(200, 200)))
      expect(props(made()[0] as string)).toMatchObject({ x: 200, y: 200, boxMode: 'autoWidth' })
    })
  })

  describe('an image box', () => {
    it('places the image at its own size, centred on a click, as one undo step', () => {
      const { drawing, session, selection, log, at, made, props } = harness()
      drawing.release(drawing.pressImage(pointer, at(500, 500), PHOTO))
      const [id] = made()
      expect(props(id as string)).toMatchObject({ x: 300, y: 400, width: 400, height: 200 })
      expect(selection.current()).toEqual(pairsIn('sq', [id ?? '']))
      expect(log).toEqual(['stop typing', `hug ${id}`, 'tool select'])
      session.undo()
      expect(made()).toEqual([])
    })

    it("covers the box dragged, which Shift keeps to the image's shape", () => {
      const { drawing, at, made, props } = harness()
      const drag = drawing.pressImage(pointer, at(100, 100), PHOTO)
      drawing.drag(drag, { x: 300, y: 150 }, true, false)
      expect(drag.to).toEqual({ x: 300, y: 200 })
      drawing.release(drag)
      expect(props(made()[0] as string)).toMatchObject({ x: 100, y: 100, width: 200, height: 100 })
    })
  })

  describe('a frame drawn with the Frame tool', () => {
    it('follows the drag in world units, anywhere on the stage', () => {
      const { drawing, log } = harness()
      const drag = drawing.pressFrame(pointer, { x: 1200, y: 100 })
      expect(drag).toEqual({ kind: 'frameDraw', from: { x: 1200, y: 100 }, to: { x: 1200, y: 100 } })
      drawing.drag(drag, { x: 1500, y: 400 }, false, false)
      expect(drag.to).toEqual({ x: 1500, y: 400 })
      expect(log).toEqual(['stop typing', 'draw'])
    })

    it('adds an empty white frame named Frame where it was dragged, on whole pixels, as one undo step, picked and shown, the select tool back', () => {
      const { session, selection, log, madeFrames, drawFrame } = harness()
      selection.select(['rect'], 'sq')
      drawFrame({ x: 1500.4, y: 400.6 }, { x: 1200.4, y: 100.6 })
      const [made] = madeFrames()
      expect(made?.[1]).toMatchObject({
        pageId: 'p1',
        name: 'Frame',
        x: 1200,
        y: 101,
        width: 300,
        height: 300,
        fills: WHITE,
      })
      expect(made?.[1].order).toBe('a1')
      expect(Object.values(session.design().nodes).filter((n) => n.parentId === made?.[0])).toEqual([])
      expect(selection.current()).toBeNull()
      expect(selection.pickedFrame()).toBe(made?.[0])
      expect(log.slice(-3)).toEqual([
        'tool select',
        `showWhole ${JSON.stringify({ x: 1200, y: 101, width: 300, height: 300 })}`,
        'draw',
      ])
      session.undo()
      expect(madeFrames()).toEqual([])
      session.redo()
      expect(madeFrames().map(([, f]) => [f.x, f.y, f.width, f.height])).toEqual([[1200, 101, 300, 300]])
    })

    it('keeps the shape dragged, scaled to fit the size limits; past 12 times as long as wide, the short side grows', () => {
      const { madeFrames, drawFrame } = harness()
      drawFrame({ x: 0, y: 0 }, { x: 20, y: 10 })
      drawFrame({ x: 0, y: 0 }, { x: 35000, y: 10000 })
      drawFrame({ x: 0, y: 0 }, { x: 1300, y: 60 })
      drawFrame({ x: 0, y: 0 }, { x: 70, y: 9000 })
      drawFrame({ x: 0, y: 0 }, { x: 900, y: 40 })
      expect(madeFrames().map(([, f]) => `${f.width}×${f.height}`)).toEqual([
        '100×50',
        '8000×2286',
        '1300×109',
        '667×8000',
        '900×75',
      ])
    })

    it('names the frame it adds as the app names a frame of its size', () => {
      const { madeFrames, drawFrame } = harness()
      drawFrame({ x: 0, y: 0 }, { x: 400, y: 200 })
      expect(madeFrames().map(([, f]) => f.name)).toEqual(['400 by 200'])
    })

    it('adds nothing for a box that rounds to no size, as a click, and keeps the Frame tool, so the Add a frame card stays open', () => {
      const { session, selection, log, madeFrames, drawFrame } = harness()
      drawFrame({ x: 300, y: 300 }, { x: 300.4, y: 299.6 })
      expect(madeFrames()).toEqual([])
      expect(log).not.toContain('tool select')
      expect(selection.pickedFrame()).toBeNull()
      expect(session.canUndo()).toBe(false)
    })
  })

  describe('on whole design pixels', () => {
    it('draws a shape from a press and a pointer on fractions on whole pixels, and a click’s at its usual size there', () => {
      const { drawing, at, made, props } = harness()
      const drag = drawing.pressShape(pointer, 'rect', at(200.4, 200.6))
      if (!drag) throw new Error('no drag')
      drawing.drag(drag, { x: 260.3, y: 240.7 }, false, false)
      expect(props(drag.id)).toMatchObject({ x: 200, y: 201, width: 60, height: 40 })
      drawing.release(drag)
      const click = drawing.pressShape(pointer, 'ellipse', at(500.4, 500.6))
      if (!click) throw new Error('no drag')
      drawing.release(click)
      expect(props(made()[1] as string)).toMatchObject({ x: 450, y: 451, width: 100, height: 100 })
    })

    it('draws a text box, and the text a click makes, on whole pixels', () => {
      const { drawing, at, made, props } = harness()
      const drag = drawing.pressText(pointer, at(200.4, 200.6))
      drawing.drag(drag, { x: 400.3, y: 260.7 }, false, false)
      drawing.release(drag)
      expect(props(made()[0] as string)).toMatchObject({ x: 200, y: 201, width: 200, height: 60 })
      drawing.release(drawing.pressText(pointer, at(600.4, 600.6)))
      expect(props(made()[1] as string)).toMatchObject({ x: 600, y: 601, boxMode: 'autoWidth' })
    })

    it('draws an image box on whole pixels, its following side as the ratio gives it with Shift', () => {
      const { drawing, at, made, props } = harness()
      const free = drawing.pressImage(pointer, at(100.4, 100.6), PHOTO)
      drawing.drag(free, { x: 300.3, y: 150.2 }, false, false)
      drawing.release(free)
      expect(props(made()[0] as string)).toMatchObject({ x: 100, y: 101, width: 200, height: 49 })
      const kept = drawing.pressImage(pointer, at(100.4, 100.6), PHOTO)
      drawing.drag(kept, { x: 301.3, y: 150.2 }, true, false)
      drawing.release(kept)
      expect(props(made()[1] as string)).toMatchObject({ x: 100, y: 101, width: 201, height: 100.5 })
    })

    it('shows the frame the Frame tool is drawing on whole pixels', () => {
      const { drawing } = harness()
      const drag = drawing.pressFrame(pointer, { x: 1200.4, y: 100.6 })
      drawing.drag(drag, { x: 1500.3, y: 400.2 }, false, false)
      expect(drawing.shown(drag)?.rect).toEqual({ x: 1200, y: 101, width: 300, height: 299 })
    })

    it('draws a line and an arrow, and their click, where the pointer gives, unrounded', () => {
      const { drawing, at, props } = harness()
      const line = drawing.pressShape(pointer, 'line', at(200.4, 200.6))
      if (!line) throw new Error('no drag')
      drawing.drag(line, { x: 300.3, y: 200.6 }, false, false)
      expect(props(line.id)).toMatchObject({ x: 200.4, y: 200.6, width: 99.9 })
      drawing.release(line)
      const arrow = drawing.pressShape(pointer, 'arrow', at(500.4, 500.6))
      if (!arrow) throw new Error('no drag')
      drawing.release(arrow)
      expect(props(arrow.id)).toMatchObject({ x: 450.4, y: 500.6, width: 100 })
    })

    it('draws a shape in a group turned 30° where the pointer gives, unrounded', () => {
      const { drawing, session, selection, at, props } = harness()
      session.run('node.group', { ids: ['rect'], id: 'tilt', name: 'Tilt' })
      session.run('node.update', { ids: ['tilt'], patch: { rotation: 30 } })
      selection.enter('tilt')
      const drag = drawing.pressShape(pointer, 'rect', at(110, 110))
      if (!drag) throw new Error('no drag')
      const to = localTo({ x: 140, y: 130 }, drag.around)
      drawing.drag(drag, to, false, false)
      const { rotation, ...want } = draggedRect('rect', localTo({ x: 110, y: 110 }, drag.around), to, false, false)
      expect(rotation).toBe(0)
      expect(props(drag.id)).toMatchObject(want)
      expect(Number.isInteger(want.x)).toBe(false)
    })

    it('draws a text box and an image box in a group turned 30° where the pointer gives, unrounded', () => {
      const { drawing, session, selection, at } = harness()
      session.run('node.group', { ids: ['rect'], id: 'tilt', name: 'Tilt' })
      session.run('node.update', { ids: ['tilt'], patch: { rotation: 30 } })
      for (const press of [
        () => drawing.pressText(pointer, at(110, 110)),
        () => drawing.pressImage(pointer, at(110, 110), PHOTO),
      ]) {
        selection.enter('tilt')
        const drag = press()
        const to = localTo({ x: 140, y: 130 }, drag.around)
        drawing.drag(drag, to, false, false)
        expect([drag.kind, drag.from, drag.to]).toEqual([drag.kind, localTo({ x: 110, y: 110 }, drag.around), to])
        expect(Number.isInteger(drag.from.x)).toBe(false)
      }
    })
  })

  describe('a fault in the middle of drawing a shape', () => {
    registerFaultyCommand()

    it('leaves no gesture open and no shape, and the next press draws a shape of its own', () => {
      const { drawing, session, at, made } = harness()
      const drag = drawing.pressShape(pointer, 'rect', at(200, 200))
      if (!drag) throw new Error('no drag')
      // The editor has the pointer drop the drag when a fault is told, which cancels its step.
      watchFaults({ session, endOpen: () => drag.step.cancel(), notify: () => {} })
      drawing.drag(drag, { x: 260, y: 240 }, false, false)
      expect(made()).toHaveLength(1)
      faultOn(session, made())
      expect([made(), session.inGesture(), session.canUndo()]).toEqual([[], false, false])
      const next = drawing.pressShape(pointer, 'rect', at(300, 300))
      if (!next) throw new Error('no drag')
      expect(session.inGesture()).toBe(true)
      drawing.drag(next, { x: 360, y: 340 }, false, false)
      drawing.release(next)
      expect([made().length, session.inGesture()]).toEqual([1, false])
      session.undo()
      expect([made(), session.canUndo()]).toEqual([[], false])
    })
  })
})
