import { describe, expect, it } from 'vitest'

import type { DesignInput, Rect } from '@dazbee/schema'

import { type Camera, reveal, revealWhole } from './canvas/camera.ts'
import { type Frame, pageFrames } from './canvas/frames.ts'
import { testMotion } from './canvas/test-motion.ts'
import { editorView } from './canvas/view.ts'
import { actsOnFrame, type EditorFrameActions, editorFrameActions } from './frame-actions.ts'
import { sessionOf } from './layers/test-boxes.ts'
import { editorSelection } from './selection.ts'

const rect = (parentId: string, index: string, box: { x: number; y: number; width: number; height: number }) => ({
  type: 'graphic' as const,
  parentId,
  index,
  name: 'Rect',
  props: { ...box, shape: { kind: 'rect' as const } },
})
/** One page with a square frame holding a square and a row laid out by auto layout, and a wide frame holding a copy of the square. */
const DESIGN: DesignInput = {
  meta: { designId: 'd', name: 'D' },
  pages: { p1: { name: 'One', order: 'a0' } },
  frames: {
    sq: { pageId: 'p1', name: 'Square', width: 1080, height: 1080, x: 0, y: 0, order: 'a0' },
    wide: { pageId: 'p1', name: 'Wide', width: 1200, height: 628, x: 1280, y: 0, order: 'a1' },
  },
  nodes: {
    a: { ...rect('sq', 'a0', { x: 100, y: 100, width: 100, height: 100 }), link: 'a' },
    row: {
      type: 'box',
      parentId: 'sq',
      link: 'row',
      index: 'a1',
      name: 'Row',
      props: { x: 100, y: 500, width: 300, height: 100, layout: { direction: 'row' } },
    },
    inRow: { ...rect('row', 'a0', { x: 0, y: 0, width: 50, height: 50 }), link: 'inRow' },
    'wide-a': { ...rect('wide', 'a0', { x: 100, y: 100, width: 100, height: 100 }), link: 'a' },
  },
}

/** A 1000 × 800 stage under a 60 px row of chrome, with a 300 px panel over its right side. */
const STAGE = { width: 1000, height: 800 }
const INSETS = { top: 60, right: 300, bottom: 0, left: 0 }

/**
 * The frame actions on a real session, selection and view, on STAGE, logging what they ask of the
 * view and the tools, each time they tell that what is shown changed, and each text they fit, which
 * the fit makes 50 tall. `glided` runs the view's glide to its end, giving each step's camera.
 */
function harness(design: DesignInput = DESIGN) {
  const session = sessionOf(design)
  const frames = pageFrames(session.design(), 'p1').frames
  const [frame, wide] = frames as [Frame, Frame]
  const log: string[] = []
  const selection = editorSelection({ drawn: () => session.design(), frames: () => frames, changed: () => {} })
  const clock = testMotion()
  const view = editorView({ session, onZoom: () => {}, motion: clock.motion })
  view.setViewport({ ...STAGE, dpr: 1 })
  view.setInsets(INSETS)
  const glided = () => clock.runOut(view)
  const frameActions = editorFrameActions({
    session,
    view: {
      page: () => 'p1',
      showWhole: (area) => {
        log.push(`showWhole ${JSON.stringify(area)}`)
        view.showWhole(area)
      },
    },
    tools: { setTool: (tool) => log.push(`tool ${tool}`) },
    frameName: (width, height) => `Size ${width}×${height}`,
    selection,
    typing: {
      fitText: (id) => {
        log.push(`fit ${id}`)
        const width = session.design().nodes[id]?.props.width ?? 0
        session.run('text.fit', { id, width, height: 50 })
      },
    },
    shownChanged: () => log.push('overlay'),
  })
  /** The layers whose parent is a frame. */
  const layersOf = (frameId: string) => Object.values(session.design().nodes).filter((n) => n.parentId === frameId)
  return { frameActions, session, selection, frame, wide, log, layersOf, view, glided }
}

describe('editorFrameActions', () => {
  describe('addFrame', () => {
    it('adds an empty white frame of a size to the shown page, named from its size, past its rightmost frame, picks it and shows it, the select tool back, as one undo step', () => {
      const { frameActions, session, selection, log } = harness()
      selection.select(['a'], 'sq')
      const layers = Object.keys(session.design().nodes).length
      const id = frameActions.addFrame({ width: 300, height: 250 }) ?? ''
      // 200 px past the wide frame, which ends at 2480, its top lined up with the wide frame's.
      expect(session.design().frames[id]).toMatchObject({
        pageId: 'p1',
        name: 'Size 300×250',
        width: 300,
        height: 250,
        x: 2680,
        y: 0,
        fills: [{ type: 'solid', color: '#FFFFFFFF' }],
      })
      expect(Object.keys(session.design().nodes)).toHaveLength(layers)
      expect(selection.pickedFrame()).toBe(id)
      expect(selection.current()).toBeNull()
      expect(log).toEqual([
        'tool select',
        `showWhole ${JSON.stringify({ x: 2680, y: 0, width: 300, height: 250 })}`,
        'overlay',
      ])
      session.undo()
      expect(session.design().frames[id]).toBeUndefined()
      expect(session.canUndo()).toBe(false)
      session.redo()
      expect(session.design().frames[id]).toMatchObject({ width: 300, height: 250, x: 2680, y: 0 })
    })

    it("names the frame by the name it is given, a tile's, in place of its size's, as one undo step", () => {
      const { frameActions, session, selection } = harness()
      const id = frameActions.addFrame({ width: 1080, height: 1920 }, 'TikTok video') ?? ''
      expect(session.design().frames[id]).toMatchObject({ name: 'TikTok video', width: 1080, height: 1920, x: 2680 })
      expect(selection.pickedFrame()).toBe(id)
      session.undo()
      expect(session.design().frames[id]).toBeUndefined()
      expect(session.canUndo()).toBe(false)
      // Without one, the size's name.
      const typed = frameActions.addFrame({ width: 1080, height: 1920 }) ?? ''
      expect(session.design().frames[typed]?.name).toBe('Size 1080×1920')
    })

    it('adds nothing for a size past the limits, leaving the tool and the picked frame be', () => {
      const { frameActions, session, selection, wide, log } = harness()
      selection.pickFrame(wide.id)
      for (const size of [
        { width: 49, height: 600 },
        { width: 8001, height: 1000 },
        { width: 50, height: 601 },
        { width: 300.5, height: 250 },
      ])
        expect(frameActions.addFrame(size)).toBeNull()
      expect(Object.keys(session.design().frames).sort()).toEqual(['sq', 'wide'])
      expect(selection.pickedFrame()).toBe(wide.id)
      expect(log).toEqual([])
      expect(session.canUndo()).toBe(false)
    })

    it('adds a frame at the limits: 50 px on its short side, 8000 on its long one, and 12 times as long as wide', () => {
      const { frameActions, session } = harness()
      for (const size of [
        { width: 50, height: 600 },
        { width: 8000, height: 667 },
      ]) {
        const id = frameActions.addFrame(size) ?? ''
        expect(session.design().frames[id]).toMatchObject(size)
      }
    })
  })

  describe('addSize', () => {
    it('adds a size of a frame, named by its size, holding linked copies of its layers laid out to fit, and picks it and shows it, as one undo step', () => {
      const { frameActions, session, selection, frame, log, layersOf } = harness()
      selection.pickFrame(frame.id)
      const id = frameActions.addSize(frame.id, { width: 540, height: 1080 }) ?? ''
      expect(session.design().frames[id]).toMatchObject({
        pageId: 'p1',
        name: '540×1080',
        width: 540,
        height: 1080,
        x: 2680,
      })
      const copies = layersOf(id)
      expect(copies.map((node) => node.link).sort()).toEqual(['a', 'row'])
      // Half as wide: A scales by the smaller ratio about the frame's top left, and keeps to the top left it is near.
      expect(copies.find((node) => node.link === 'a')?.props).toMatchObject({ x: 50, y: 50, width: 50, height: 50 })
      expect(selection.pickedFrame()).toBe(id)
      expect(log).toEqual([
        'tool select',
        `showWhole ${JSON.stringify({ x: 2680, y: 0, width: 540, height: 1080 })}`,
        'overlay',
      ])
      session.undo()
      expect(session.design().frames[id]).toBeUndefined()
      expect(layersOf(id)).toEqual([])
      expect(session.canUndo()).toBe(false)
      session.redo()
      expect(
        layersOf(id)
          .map((node) => node.link)
          .sort(),
      ).toEqual(['a', 'row'])
    })

    /** A text in the square frame, at 72 px unless told another, its link its index. */
    const text = (index: string, box: { x: number; y: number; width: number; height: number }, fontSize = 72) => ({
      type: 'text' as const,
      parentId: 'sq',
      link: index,
      index,
      name: 'Text',
      props: { ...box, text: 'Summer sale', style: { fontFamily: 'Noto Sans', fontSize, color: '#111111FF' } },
    })

    it('fits a text the placing made wider to its words, and only it, in the same undo step', () => {
      const { frameActions, session, frame, log, layersOf } = harness({
        ...DESIGN,
        // The headline is guessed left and right; the tag, small at the top left, left and top.
        nodes: {
          headline: text('a0', { x: 90, y: 260, width: 900, height: 160 }),
          tag: text('a1', { x: 60, y: 60, width: 200, height: 40 }),
        },
      })
      const id = frameActions.addSize(frame.id, { width: 1200, height: 628 }) ?? ''
      const headline = layersOf(id).find((node) => node.link === 'a0')
      const fitted = Object.keys(session.design().nodes).find((key) => session.design().nodes[key] === headline)
      expect(log.filter((line) => line.startsWith('fit'))).toEqual([`fit ${fitted}`])
      expect(headline?.props).toMatchObject({ x: 52.33, width: 1095.33, height: 50 })
      expect(session.undoName()).toBe('addSize')
      session.undo()
      expect(session.design().frames[id]).toBeUndefined()
      expect(session.canUndo()).toBe(false)
    })

    it('fits a text raised to the readable size to its words, though the placing left its width, in the same undo step', () => {
      const { frameActions, session, frame, log, layersOf } = harness({
        ...DESIGN,
        // At 540 × 540 the scale halves 24 px to 12, under the readable 16.5: the band, as wide as the
        // frame, keeps the width the scale gives it, but its words take more lines.
        nodes: { band: text('a1', { x: 0, y: 60, width: 1080, height: 40 }, 24) },
      })
      const id = frameActions.addSize(frame.id, { width: 540, height: 540 }) ?? ''
      const band = layersOf(id)[0]
      const bandId = Object.keys(session.design().nodes).find((key) => session.design().nodes[key] === band)
      expect(band?.props).toMatchObject({ width: 540, height: 50, style: { fontSize: 16.5 } })
      expect(log.filter((line) => line.startsWith('fit'))).toEqual([`fit ${bandId}`])
      expect(session.undoName()).toBe('addSize')
      session.undo()
      expect(session.design().frames[id]).toBeUndefined()
      expect(session.canUndo()).toBe(false)
    })

    it('fits a group to a text in a fixed box it holds, raised to the readable size, in the same undo step', () => {
      const legal = text('a0', { x: 100, y: 900, width: 600, height: 40 }, 24)
      const { frameActions, session, frame, layersOf } = harness({
        ...DESIGN,
        nodes: {
          foot: {
            type: 'group',
            parentId: 'sq',
            link: 'foot',
            index: 'a0',
            name: 'Foot',
            props: { x: 100, y: 900, width: 600, height: 40 },
          },
          legal: { ...legal, parentId: 'foot', props: { ...legal.props, boxMode: 'fixed' as const } },
        },
      })
      const id = frameActions.addSize(frame.id, { width: 540, height: 540 }) ?? ''
      const nodes = session.design().nodes
      const foot = layersOf(id)[0]
      const inFoot = Object.values(nodes).find((node) => node.link === 'a0' && node !== nodes.legal)
      // 24 px halved is under the readable 16.5: the text grows past the box the group was scaled to, and the group holds it.
      expect(inFoot?.props).toMatchObject({ width: 412.5, style: { fontSize: 16.5 } })
      expect(foot?.props).toMatchObject({
        x: inFoot?.props.x,
        y: inFoot?.props.y,
        width: inFoot?.props.width,
        height: inFoot?.props.height,
      })
      session.undo()
      expect(session.design().frames[id]).toBeUndefined()
      expect(session.canUndo()).toBe(false)
    })

    it('adds nothing for a frame gone or a size past the limits, leaving the tool and the picked frame be', () => {
      const { frameActions, session, selection, frame, log } = harness()
      selection.pickFrame(frame.id)
      expect(frameActions.addSize('gone', { width: 300, height: 250 })).toBeNull()
      expect(frameActions.addSize(frame.id, { width: 49, height: 600 })).toBeNull()
      expect(Object.keys(session.design().frames).sort()).toEqual(['sq', 'wide'])
      expect(selection.pickedFrame()).toBe(frame.id)
      expect(log).toEqual([])
      expect(session.canUndo()).toBe(false)
    })
  })

  describe('resizeFrame', () => {
    /** The square frame with a layer set to its right edge beside one left at the top left. */
    const RIGHT_SET: DesignInput = {
      ...DESIGN,
      nodes: {
        a: { ...rect('sq', 'a0', { x: 100, y: 100, width: 100, height: 100 }), link: 'a' },
        right: {
          ...rect('sq', 'a1', { x: 880, y: 100, width: 100, height: 100 }),
          link: 'right',
          props: {
            x: 880,
            y: 100,
            width: 100,
            height: 100,
            shape: { kind: 'rect' },
            constraints: { horizontal: 'right', vertical: 'top' },
          },
        },
      },
    }

    it('resizes a frame from its top left, a layer set to its right moving by the growth and one at the left staying, as one undo step called resize', () => {
      const { frameActions, session } = harness(RIGHT_SET)
      expect(frameActions.resizeFrame('sq', { width: 1200, height: 1080 })).toBe(true)
      expect(session.design().frames.sq).toMatchObject({ x: 0, y: 0, width: 1200, height: 1080 })
      expect(session.design().nodes.right?.props).toMatchObject({ x: 1000, y: 100, width: 100 })
      expect(session.design().nodes.a?.props).toMatchObject({ x: 100, y: 100, width: 100 })
      expect(session.undoName()).toBe('resize')
      session.undo()
      expect(session.design().frames.sq).toMatchObject({ width: 1080, height: 1080 })
      expect(session.design().nodes.right?.props).toMatchObject({ x: 880 })
      expect(session.canUndo()).toBe(false)
    })

    it('fits a text set left and right, which the resize made wider, to its words, and only it, in the same undo step', () => {
      const style = { fontFamily: 'Noto Sans', fontSize: 60, color: '#111111FF' }
      const text = (index: string, props: { x: number; y: number; width: number; height: number }) => ({
        type: 'text' as const,
        parentId: 'sq',
        link: index,
        index,
        name: 'Text',
        props: { ...props, text: 'Summer sale', style },
      })
      const headline = text('a0', { x: 90, y: 260, width: 900, height: 160 })
      const { frameActions, session, log } = harness({
        ...DESIGN,
        // The headline is set left and right; the tag keeps to the left and top.
        nodes: {
          headline: {
            ...headline,
            props: { ...headline.props, constraints: { horizontal: 'leftRight', vertical: 'top' } },
          },
          tag: text('a1', { x: 60, y: 60, width: 200, height: 40 }),
        },
      })
      expect(frameActions.resizeFrame('sq', { width: 1200, height: 1080 })).toBe(true)
      expect(log).toEqual(['fit headline'])
      expect(session.design().nodes.headline?.props).toMatchObject({ x: 90, width: 1020, height: 50 })
      expect(session.design().nodes.tag?.props).toMatchObject({ width: 200, height: 40 })
      expect(session.undoName()).toBe('resize')
      session.undo()
      expect(session.design().nodes.headline?.props).toMatchObject({ width: 900, height: 160 })
      expect(session.design().frames.sq).toMatchObject({ width: 1080 })
      expect(session.canUndo()).toBe(false)
    })

    it('writes nothing and returns false for a frame gone, a size past the limits or one not whole', () => {
      const { frameActions, session, log } = harness(RIGHT_SET)
      const before = session.design()
      expect(frameActions.resizeFrame('gone', { width: 1200, height: 1080 })).toBe(false)
      for (const size of [
        { width: 49, height: 1080 },
        { width: 8001, height: 1080 },
        { width: 50, height: 601 },
        { width: 1200.5, height: 1080 },
      ])
        expect(frameActions.resizeFrame('sq', size), JSON.stringify(size)).toBe(false)
      expect(session.design()).toBe(before)
      expect(session.canUndo()).toBe(false)
      expect(log).toEqual([])
    })
  })

  describe('showAdded', () => {
    it('picks a frame just added and shows it whole beside the chrome, the select tool back', () => {
      const { frameActions, selection, wide, log } = harness()
      selection.select(['a'], 'sq')
      frameActions.showAdded(wide.id)
      expect(selection.pickedFrame()).toBe(wide.id)
      expect(selection.current()).toBeNull()
      expect(log).toEqual([
        'tool select',
        `showWhole ${JSON.stringify({ x: 1280, y: 0, width: 1200, height: 628 })}`,
        'overlay',
      ])
    })

    /** Each way to add a frame, giving its id. */
    const ADDS = {
      'Add a frame': (frameActions: EditorFrameActions) => frameActions.addFrame({ width: 300, height: 250 }) ?? '',
      'Add size': (frameActions: EditorFrameActions) => frameActions.addSize('sq', { width: 300, height: 250 }) ?? '',
      Duplicate: (frameActions: EditorFrameActions, selection: { pickedFrame(): string | null }) => {
        frameActions.frameAction('duplicate', 'wide')
        return selection.pickedFrame() ?? ''
      },
    }

    it.each(Object.entries(ADDS))('leaves the camera as it is for a frame added in view, as %s does', (_, add) => {
      const { frameActions, selection, view, glided } = harness()
      // At 15% a frame added past the others, at 2680, ends 582 across or less, before the panel.
      const before = { x: 0, y: 100, zoom: 0.15 }
      view.setCamera(before)
      add(frameActions, selection)
      expect(glided()).toEqual([])
      expect(view.camera()).toBe(before)
    })

    it.each(Object.entries(ADDS))(
      'glides along the least pan to a frame added out of view, never centring it, as %s does',
      (_, add) => {
        const { frameActions, selection, session, view, glided } = harness()
        const before = { x: 0, y: 100, zoom: 1 }
        view.setCamera(before)
        const id = add(frameActions, selection)
        const made = session.design().frames[id] as Rect
        const steps = glided()
        const end = revealWhole(before, made, STAGE, INSETS)
        expect(steps.length).toBeGreaterThan(10)
        expect(view.camera()).toEqual(end)
        expect(end).not.toEqual(reveal(before, made, STAGE, INSETS))
        // Its end 16 px in from the panel's edge, zoomed out only for the copy of the wide frame, too
        // wide for the 668 px between the stage's edge and the panel's, less 16 on each side.
        expect(end.zoom).toBeCloseTo(made.width > 668 ? 668 / made.width : 1)
        expect(end.x + (made.x + made.width) * end.zoom).toBeCloseTo(1000 - 300 - 16)
        // Each step nearer, none past the end.
        for (const [i, step] of steps.entries()) {
          const was = i === 0 ? before : (steps[i - 1] as Camera)
          expect(step.x).toBeLessThanOrEqual(was.x)
          expect(step.x).toBeGreaterThanOrEqual(end.x)
        }
      },
    )

    it('does nothing for a frame gone', () => {
      const { frameActions, selection, log } = harness()
      frameActions.showAdded('gone')
      expect(selection.pickedFrame()).toBeNull()
      expect(log).toEqual([])
    })
  })
})

describe('frameAction', () => {
  it('does nothing for an arrow on a picked frame another tab deleted, nor tells that what is shown changed', () => {
    const { frameActions, session, log } = harness()
    session.run('frame.delete', { frameId: 'wide' })
    expect(frameActions.frameAction('nudgeLeft', 'wide')).toBe(false)
    expect(frameActions.frameAction('nudgeDownFar', 'wide')).toBe(false)
    expect(Object.keys(session.design().frames)).toEqual(['sq'])
    expect(log).toEqual([])
  })
})

describe('actsOnFrame', () => {
  it('takes Esc, Delete, Duplicate and the arrows for the picked frame, and no other key', () => {
    for (const action of ['deselect', 'delete', 'duplicate', 'nudgeLeft', 'nudgeDownFar'] as const)
      expect(actsOnFrame(action), action).toBe(true)
    for (const action of ['group', 'selectAll', 'goIn', 'alignLeft', 'copy'] as const)
      expect(actsOnFrame(action), action).toBe(false)
  })
})
