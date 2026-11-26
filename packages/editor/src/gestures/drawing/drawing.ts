// Drawing with a tool: a shape or box dragged out, a text box and an image box, a frame dragged
// out with the Frame tool, a section's box with the Section tool, and the box being dragged, which
// the overlay shows.
import { childrenOf, type GestureStep, type Session } from '@dazbee/doc'
import { canHold, type Point, type Rect, SIZE_LIMITS } from '@dazbee/schema'

import { type Camera, toScreen } from '../../canvas/camera.ts'
import type { Frame } from '../../canvas/frames.ts'
import { sectionAt } from '../../canvas/sections.ts'
import type { NoticeDetail } from '../../core-interface.ts'
import type { EditorFrameActions } from '../../frame-actions.ts'
import { laidOut } from '../../layers/auto-layout.ts'
import type { EditorBoxes } from '../../layers/boxes.ts'
import { boundsOf, type Box, localTo, round, wholeOnPage } from '../../layers/transform.ts'
import { runQuietly } from '../../run-quietly.ts'
import type { EditorSelection } from '../../selection.ts'
import type { EditorTyping } from '../../text/typing.ts'
import type { EditorTools, PlacedAsset } from '../../tools.ts'
import type { PointerInput } from '../inputs.ts'
import type { EditorFrameMove } from '../select/frame-move.ts'
import {
  clickedRect,
  draggedRect,
  type Drawn,
  drawsBox,
  type DrawTool,
  imageIn,
  keepRatio,
  newDrawn,
  newImage,
  newText,
} from './draw-tools.ts'

/** A shape or box being drawn, from the press until it ends: the new layer and every change the drag makes to it are one undo step. */
export interface ShapeDrag {
  kind: 'draw'
  tool: DrawTool
  frame: Frame
  around: Box[]
  from: Point
  /** The rect the shape is drawn at, as the drag last left it. */
  drawn: Drawn
  id: string
  roots: string[]
  step: GestureStep
}
/** The box the text tool is dragging out, from the press until it ends. */
export interface TextBoxDrag {
  kind: 'textBox'
  frame: Frame
  around: Box[]
  parentId: string
  from: Point
  to: Point
}
/** The box the image tool is dragging out for its image, from the press until it ends. */
export interface ImageBoxDrag {
  kind: 'imageBox'
  frame: Frame
  around: Box[]
  parentId: string
  from: Point
  to: Point
  asset: PlacedAsset
}

/** The frame the Frame tool is dragging out on the shown page, in world units, from the press until it ends. */
export interface FrameDrag {
  kind: 'frameDraw'
  from: Point
  to: Point
}
/** The box round frames the Section tool is dragging out on the shown page, in world units, from the press until it ends. */
export interface SectionDrag {
  kind: 'sectionDraw'
  from: Point
  to: Point
}

/** A drag that draws a new layer, frame or section. */
export type DrawingDrag = ShapeDrag | TextBoxDrag | ImageBoxDrag | FrameDrag | SectionDrag
/**
 * The box a text, image box, frame or section drag is drawing, by the drag's kind: in its frame's
 * design pixels, or for a frame or a section, which is in none, in world units.
 */
export interface ShownDrawing {
  kind: 'textBox' | 'imageBox' | 'frameDraw' | 'sectionDraw'
  frame: Frame | null
  rect: Rect
}

export interface DrawingDeps {
  /** Asks for the pointer to be held from the press being handled. */
  hold: () => void
  session: Session
  selection: Pick<EditorSelection, 'select'>
  tools: Pick<EditorTools, 'setTool'>
  typing: Pick<EditorTyping, 'stop' | 'start'>
  boxes: Pick<EditorBoxes, 'boxIn' | 'containersOf' | 'parentFor' | 'storedBoxes' | 'storedNewBox'>
  /** The page the canvas shows, which a frame drawn with the Frame tool goes on, and its frames. */
  page: () => string
  frames: () => readonly Frame[]
  camera: () => Camera
  /** The sections as the stage shows them, whose outline a frame drawn may be in. */
  frameMove: Pick<EditorFrameMove, 'shownSections'>
  /** The name a frame drawn with the Frame tool takes, from its size. */
  frameName: (width: number, height: number) => string
  /** Picks and shows a frame drawn with the Frame tool, as a frame added from a size is. */
  frameActions: Pick<EditorFrameActions, 'showAdded'>
  /** Groups fit what they hold again after a change inside them, in the same undo step. */
  hug: (ids: string[]) => void
  /** Tells the page that the Section tool's box held no frame. */
  notify: (...told: NoticeDetail<'drawAroundFrames'>) => void
  /** Picks a section made with the Section tool and asks the page to rename it in place. */
  renameSection: (sectionId: string) => void
  /** Tells that what is shown changed. */
  shownChanged: () => void
}

export interface EditorDrawing {
  /** The box a text, image box or frame drag is drawing; null for a shape, which draws itself. */
  shown(g: DrawingDrag): ShownDrawing | null
  /**
   * A press with a tool of the shape menu: the new layer, in the group or box gone into when it can
   * hold it, and a drag that sizes it, one undo step until it is released. Null when it can't be made.
   */
  pressShape(e: PointerInput, shape: DrawTool, at: { frame: Frame; p: Point }): ShapeDrag | null
  /** A press with the text tool: a drag of the box the text will have, or a click for text that grows with its words. */
  pressText(e: PointerInput, at: { frame: Frame; p: Point }): TextBoxDrag
  /** A press with the image tool and its image: a drag of the box the image will cover, or a click for its own size. */
  pressImage(e: PointerInput, at: { frame: Frame; p: Point }, asset: PlacedAsset): ImageBoxDrag
  /** A press with the Frame tool, anywhere on the stage, at a world point: a drag of the frame it adds to the shown page. */
  pressFrame(e: PointerInput, world: Point): FrameDrag
  /** A press with the Section tool, anywhere on the stage, at a world point: a drag of the box round the frames to group. */
  pressSection(e: PointerInput, world: Point): SectionDrag
  /**
   * Follows the pointer, once the press is a drag: a shape grows to it; a box's corner goes to it,
   * Shift keeping an image's shape. A frame's point is in world units, the others' in their frame's
   * design pixels. The press and the pointer land on whole pixels where what is drawn in is upright
   * on the page, but for a line or an arrow.
   */
  drag(g: DrawingDrag, p: Point, shift: boolean, alt: boolean): void
  /**
   * Ends a drawing gesture, its layer selected and the select tool back. It ends as a click with
   * its tool when the box drawn has no size, its width and height both rounding to 0 design pixels,
   * as a press that never went past the slop leaves it. A shape's undo step closes; a text box's
   * layer is made and typed into, one undo step until typing stops; an image box's layer is made,
   * one undo step. A frame dragged out is added, one undo step, in the section whose outline holds
   * its middle, and picked and shown; a click adds none and keeps the Frame tool. A section's box
   * makes a section of the shown page's frames whose middle it holds, one undo step, picked with its
   * title in rename and the select tool back; round no frame it makes none, says so and keeps the
   * Section tool, and a click makes none and keeps it too.
   */
  release(g: DrawingDrag): void
}

/** Whether a gesture is one that draws a new layer, frame or section. */
export const isDrawing = (g: { kind: string } | null): g is DrawingDrag =>
  g?.kind === 'draw' ||
  g?.kind === 'textBox' ||
  g?.kind === 'imageBox' ||
  g?.kind === 'frameDraw' ||
  g?.kind === 'sectionDraw'

export function editorDrawing({
  hold,
  session,
  selection,
  tools,
  typing,
  boxes: { boxIn, containersOf, parentFor, storedBoxes, storedNewBox },
  page,
  frames,
  camera,
  frameMove,
  frameName,
  frameActions,
  hug,
  notify,
  renameSection,
  shownChanged,
}: DrawingDeps): EditorDrawing {
  /**
   * Where a box a tool drags out starts: in the group or box double-clicked into if it can hold
   * a layer of `type`, otherwise in the frame, at the press as layers there see it, on whole design
   * pixels where they are upright on the page.
   */
  function boxStart(at: { frame: Frame; p: Point }, type: 'text' | 'graphic') {
    const now = session.design()
    const parentId = parentFor(at.frame, type, now)
    const around = containersOf(at.frame, parentId, now)
    const from = wholeOnPage(localTo(at.p, around), around)
    return { frame: at.frame, around, parentId, from, to: from }
  }
  /** The box the text tool (#47), the image tool or the Frame tool is drawing; null for a shape, which draws itself. */
  function shown(gesture: DrawingDrag): ShownDrawing | null {
    if (gesture.kind === 'draw') return null
    const rect = boxBetween(gesture.from, gesture.to)
    return { kind: gesture.kind, frame: 'frame' in gesture ? gesture.frame : null, rect }
  }

  /**
   * Starts drawing a shape (#44) or a box where the pointer went down: inside the group, box or
   * boolean double-clicked into if the press is in it and it can hold it, otherwise in the frame.
   * The new layer and every change the drag makes to it are one undo step.
   */
  function startDrawing(e: PointerInput, shape: DrawTool, at: { frame: Frame; p: Point }): ShapeDrag | null {
    typing.stop()
    const now = session.design()
    const parentId = parentFor(at.frame, drawsBox(shape) ? 'box' : 'graphic', now)
    const around = containersOf(at.frame, parentId, now)
    const from = drawnPoint(shape, localTo(at.p, around), around)
    const step = session.beginGesture()
    let id = ''
    if (
      !runQuietly(() => {
        id = session.run('node.create', { parentId, layer: newDrawn(shape) })
      })
    ) {
      step.end()
      return null
    }
    hold()
    const gesture: ShapeDrag = {
      kind: 'draw',
      tool: shape,
      frame: at.frame,
      around,
      from,
      drawn: draggedRect(shape, from, from, false, false),
      id,
      roots: [id],
      step,
    }
    writeDrawn(id, gesture.drawn)
    return gesture
  }
  /** A press with the text tool (#47): a click makes text that grows as it is typed, a drag a box of that size. */
  function startTextBox(e: PointerInput, at: { frame: Frame; p: Point }): TextBoxDrag {
    typing.stop()
    hold()
    return { kind: 'textBox', ...boxStart(at, 'text') }
  }
  /**
   * A press with the image tool once its image is picked: a click places the image at its own size
   * (at most half the frame's), centred there; a drag places it covering the box dragged, which
   * Shift keeps to the image's shape. In the group or box double-clicked into if it can hold it.
   */
  function startImageBox(e: PointerInput, at: { frame: Frame; p: Point }, asset: PlacedAsset): ImageBoxDrag {
    typing.stop()
    hold()
    return { kind: 'imageBox', ...boxStart(at, 'graphic'), asset }
  }
  /** A press with the Frame tool: a drag of the frame it adds, from the press on whole world units, as a frame has nothing around it. */
  function startFrame<K extends 'frameDraw' | 'sectionDraw' = 'frameDraw'>(
    e: PointerInput,
    world: Point,
    kind: K = 'frameDraw' as K,
  ): { kind: K; from: Point; to: Point } {
    typing.stop()
    hold()
    const from = wholeOnPage(world, [])
    return { kind, from, to: from }
  }
  /** A press with the Section tool: a drag of the box round the frames to group, from the press on whole world units. */
  function startSection(e: PointerInput, world: Point): SectionDrag {
    return startFrame(e, world, 'sectionDraw')
  }
  /**
   * Follows the pointer, on whole pixels where the drag's place is upright on the page: a shape
   * grows to it, Shift and Alt as `draggedRect` takes them; a box's corner goes to it, Shift keeping
   * an image's shape.
   */
  function drag(g: DrawingDrag, p: Point, shift: boolean, alt: boolean) {
    if (g.kind === 'draw') {
      drawTo(g, drawnPoint(g.tool, p, g.around), shift, alt)
      return
    }
    const to = wholeOnPage(p, 'around' in g ? g.around : [])
    g.to = g.kind === 'imageBox' && shift ? keepRatio(g.from, to, g.asset) : to
    shownChanged()
  }
  /** Grows the shape being drawn to the pointer. */
  function drawTo(g: ShapeDrag, p: Point, shift: boolean, alt: boolean) {
    g.drawn = draggedRect(g.tool, g.from, p, shift, alt)
    writeDrawn(g.id, g.drawn)
  }
  /** Stores the shape being drawn where it is drawn at `drawn` in its parent. */
  function writeDrawn(id: string, drawn: Drawn) {
    const patch = storedBoxes(new Map([[id, drawn]])).get(id) ?? drawn
    runQuietly(() => session.run('node.update', { ids: [id], patch }))
  }
  /**
   * Ends a drawing gesture: makes or finishes its layer, which is selected, and the select tool
   * comes back. A box drawn with no size ends as a click.
   */
  function release(g: DrawingDrag) {
    const click = sizeless(g.kind === 'draw' ? g.drawn : boxBetween(g.from, g.to))
    if (g.kind === 'draw') finishDrawing(g, click)
    else if (g.kind === 'textBox') finishTextBox(g, click)
    else if (g.kind === 'imageBox') finishImageBox(g, click)
    else if (g.kind === 'sectionDraw') finishSection(g, click)
    else finishFrame(g, click)
  }
  /**
   * A click draws the shape at its usual size; either way the new shape is selected and the select
   * tool comes back. A box dragged around layers beside it takes them in, in the same undo step.
   */
  function finishDrawing(g: ShapeDrag, clicked: boolean) {
    if (clicked) writeDrawn(g.id, clickedRect(g.tool, g.from))
    if (drawsBox(g.tool) && !clicked) enclose(g.frame, g.id)
    hug([g.id])
    g.step.end()
    selection.select([g.id], g.frame.id)
    tools.setTool('select')
  }
  /**
   * Moves the layers beside a new box that lie wholly inside it, as drawn in this frame, into it.
   * Layers locked in place stay where they are, and so does everything in an auto layout box,
   * where the layout, not the drag, places the new box.
   */
  function enclose(frame: Frame, id: string) {
    const now = session.design()
    const parent = now.nodes[id]?.parentId ?? ''
    const box = boxIn(id, now)
    if (!box || laidOut(id, now)) return
    const inside = childrenOf(now, parent).flatMap(([child, node]) => {
      const b = child !== id && !node.lock?.move && boxIn(child, now)
      if (!b) return []
      const shown = boundsOf([b])
      const fits =
        shown.x >= box.x &&
        shown.y >= box.y &&
        shown.x + shown.width <= box.x + box.width &&
        shown.y + shown.height <= box.y + box.height
      return fits && canHold('box', now.nodes[child]?.type ?? '') ? [child] : []
    })
    if (inside.length > 0) runQuietly(() => session.run('node.enclose', { id, ids: inside }))
  }
  /** Makes the text layer the text tool drew and starts typing into it, one undo step with the typing. */
  function finishTextBox(g: TextBoxDrag, clicked: boolean) {
    const box = clicked ? null : boxBetween(g.from, g.to)
    const at = storedNewBox(box ?? g.from, g.parentId)
    const step = session.beginGesture()
    let id = ''
    if (
      !runQuietly(() => {
        id = session.run('node.create', {
          parentId: g.parentId,
          layer: newText(
            round(at.x),
            round(at.y),
            box && { width: round(box.width), height: round(box.height), x: round(at.x), y: round(at.y) },
          ),
        })
      })
    ) {
      step.end()
      return
    }
    tools.setTool('select')
    selection.select([id], g.frame.id)
    typing.start(id, g.frame.id, 0, step.end, true)
  }
  /** Places the image the image tool drew, one undo step; it is selected and the select tool comes back. */
  function finishImageBox(g: ImageBoxDrag, clicked: boolean) {
    const box = clicked ? null : boxBetween(g.from, g.to)
    const at = storedNewBox(box ?? g.from, g.parentId)
    const layer = box
      ? imageIn(g.asset, {
          x: round(at.x),
          y: round(at.y),
          width: Math.max(1, round(box.width)),
          height: Math.max(1, round(box.height)),
        })
      : newImage(g.asset, at, g.frame)
    let id = ''
    if (
      !runQuietly(() =>
        session.gesture(() => {
          id = session.run('node.create', { parentId: g.parentId, layer })
          hug([id])
        }),
      )
    )
      return
    tools.setTool('select')
    selection.select([id], g.frame.id)
  }
  /**
   * Adds the frame the Frame tool dragged out to the shown page, empty and named Frame, at the box
   * dragged, which is on whole pixels, held within the size limits, one undo step, then picks and
   * shows it, the select tool back. A click adds none and keeps the Frame tool, so what the Add a frame card holds stays.
   */
  function finishFrame(g: FrameDrag, clicked: boolean) {
    if (clicked) return
    const { x, y, width, height } = boxBetween(g.from, g.to)
    const size = withinSizeLimits(width, height)
    // A frame drawn with its middle in a section's outline joins that section.
    const middle = toScreen(camera(), { x: x + size.width / 2, y: y + size.height / 2 })
    const sectionId = sectionAt(frameMove.shownSections(null).outlines, middle)?.id
    const name = frameName(size.width, size.height)
    let id = ''
    const add = () =>
      (id = session.run('frame.add', { pageId: page(), name, x, y, ...size, ...(sectionId ? { sectionId } : {}) }))
    if (runQuietly(add)) frameActions.showAdded(id)
    else tools.setTool('select')
  }
  /**
   * Makes a section of the shown page's frames whose middle the box holds, one undo step, picked
   * with its title in rename and the select tool back; round no frame, says so and keeps the tool,
   * and a click makes none and keeps the tool too.
   */
  function finishSection(g: SectionDrag, clicked: boolean) {
    if (clicked) return
    const box = boxBetween(g.from, g.to)
    const inside = frames().filter((f) => {
      const [mx, my] = [f.x + f.width / 2, f.y + f.height / 2]
      return mx >= box.x && mx <= box.x + box.width && my >= box.y && my <= box.y + box.height
    })
    if (inside.length === 0) return notify('drawAroundFrames')
    let id = ''
    const add = () => (id = session.run('section.add', { pageId: page(), frameIds: inside.map((f) => f.id) }))
    if (!runQuietly(add)) return
    tools.setTool('select')
    renameSection(id)
  }

  return {
    shown,
    pressShape: startDrawing,
    pressText: startTextBox,
    pressImage: startImageBox,
    pressFrame: startFrame,
    pressSection: startSection,
    drag,
    release,
  }
}

/** The box between two corners. */
function boxBetween(from: Point, to: Point): Rect {
  return {
    x: Math.min(from.x, to.x),
    y: Math.min(from.y, to.y),
    width: Math.abs(to.x - from.x),
    height: Math.abs(to.y - from.y),
  }
}

/** A point a tool draws from or to inside `around`: on whole design pixels where they are upright on the page, but a line's or an arrow's as it is. */
function drawnPoint(tool: DrawTool, p: Point, around: Box[]): Point {
  return tool === 'line' || tool === 'arrow' ? p : wholeOnPage(p, around)
}

/** Whether a box drawn has no size: its width and height both round to 0 design pixels. */
function sizeless({ width, height }: { width: number; height: number }) {
  return Math.round(width) === 0 && Math.round(height) === 0
}

/**
 * A dragged frame's size brought within SIZE_LIMITS keeping its shape: the short side grown until
 * the ratio is within the limit, then the whole size scaled down to the longest side, or up to the
 * shortest, and rounded to whole pixels.
 */
function withinSizeLimits(width: number, height: number) {
  const { minSide, maxSide, maxRatio } = SIZE_LIMITS
  let w = Math.max(width, 1)
  let h = Math.max(height, 1)
  if (w > h * maxRatio) h = w / maxRatio
  else if (h > w * maxRatio) w = h / maxRatio
  const scale = Math.min(1, maxSide / Math.max(w, h)) * Math.max(1, minSide / Math.min(w, h))
  const side = (n: number) => Math.min(maxSide, Math.max(minSide, Math.round(n * scale)))
  const [sw, sh] = [side(w), side(h)]
  // Rounding may leave the short side a pixel past the ratio.
  if (sw > sh * maxRatio) return { width: sw, height: Math.ceil(sw / maxRatio) }
  if (sh > sw * maxRatio) return { width: Math.ceil(sh / maxRatio), height: sh }
  return { width: sw, height: sh }
}
