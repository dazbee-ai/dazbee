// Moving a frame on its page by a drag on its label: the frame goes where the pointer takes it, in
// whole design pixels, and on drop it joins the section whose outline holds the pointer, or none on
// bare canvas (ADR-0024). The whole drag is one undo step. While it is dragged, the sections are
// measured as the drop sees them, and the one that would take it is lit; this module says how the
// stage shows the sections at any moment.
import type { GestureStep, Session } from '@dazbee/doc'
import type { Point } from '@dazbee/schema'

import { toScreen } from '../../canvas/camera.ts'
import type { Frame } from '../../canvas/frames.ts'
import {
  outlinesOf,
  sectionAt,
  type SectionFrames,
  type SectionOutline,
  sectionsOn,
  type ShownSections,
} from '../../canvas/sections.ts'
import type { EditorView } from '../../canvas/view.ts'
import { runQuietly } from '../../run-quietly.ts'

/** A frame being moved, from the press on its label until it is let go. */
export interface FrameMoveDrag {
  kind: 'frameMove'
  /** The frame as it was when pressed. */
  frame: Frame
  /** Where the press went down, in world units. */
  from: Point
  /** Ends the drag's undo step; null until the drag first moves the frame. */
  step: GestureStep | null
  /** The section the frame was in as the drag began, with its frames then; null for none. */
  own: SectionFrames | null
  /** Whether the frame stays in its section wherever it is dropped: it was the section's only frame. */
  stays: boolean
  /** The section the drop puts the frame in: the one whose outline holds the pointer, else none. */
  target: string | null
}

export interface FrameMoveDeps {
  session: Pick<Session, 'run' | 'beginGesture'>
  view: Pick<EditorView, 'camera' | 'design' | 'frames'>
}

export interface EditorFrameMove {
  /** The drag a press on a frame's label starts, at `world` on the page. */
  start(frame: Frame, world: Point): FrameMoveDrag
  /**
   * Follows the pointer, once the press is a drag: the frame moves by as much as the pointer did;
   * Shift keeps it to the axis it went furthest along. The section whose outline holds the pointer
   * becomes the drop's.
   */
  drag(g: FrameMoveDrag, world: Point, shift: boolean): void
  /**
   * Ends the drag: a frame that moved joins its drop's section, or none, in the drag's undo step,
   * which then closes. A section's only frame stays in it.
   */
  release(g: FrameMoveDrag): void
  /**
   * The sections of the shown page as the stage shows them, with `gesture` the drag on the stage:
   * while a frame is dragged by its label, the other sections measured without it and its own with
   * the frames it had as the drag began, the drop's section lit; else each round its frames.
   */
  shownSections(gesture: { kind: string } | null): ShownSections
}

export function editorFrameMove({ session, view }: FrameMoveDeps): EditorFrameMove {
  function start(frame: Frame, world: Point): FrameMoveDrag {
    const own = sectionsOn(view.design(), view.frames()).find((s) => s.frames.some((f) => f.id === frame.id)) ?? null
    return {
      kind: 'frameMove',
      frame,
      from: world,
      step: null,
      own,
      stays: own?.frames.length === 1,
      target: own?.id ?? null,
    }
  }
  function drag(g: FrameMoveDrag, world: Point, shift: boolean) {
    g.step ??= session.beginGesture('move')
    let dx = world.x - g.from.x
    let dy = world.y - g.from.y
    if (shift && Math.abs(dx) >= Math.abs(dy)) dy = 0
    else if (shift) dx = 0
    const to = { x: Math.round(g.frame.x + dx), y: Math.round(g.frame.y + dy) }
    // Another tab may delete the frame mid-drag; the drag then just leaves it be.
    runQuietly(() => session.run('frame.update', { frameId: g.frame.id, ...to }))
    if (g.stays) return
    g.target = sectionAt(measured(g), toScreen(view.camera(), world))?.id ?? null
  }
  function release(g: FrameMoveDrag) {
    if (g.step && !g.stays && g.target !== (g.own?.id ?? null)) {
      const sectionId = g.target
      runQuietly(() => session.run('frame.setSection', { frameIds: [g.frame.id], sectionId }))
    }
    g.step?.end()
  }
  function shownSections(gesture: { kind: string } | null): ShownSections {
    const g = gesture?.kind === 'frameMove' ? (gesture as FrameMoveDrag) : null
    if (!g?.step || g.stays)
      return { outlines: outlinesOf(sectionsOn(view.design(), view.frames()), view.camera()), lit: null }
    return { outlines: measured(g), lit: g.target }
  }
  /** The outlines as a frame's drop measures them: others without the frame, its own as the drag began. */
  function measured(g: FrameMoveDrag): SectionOutline[] {
    const sections = sectionsOn(view.design(), view.frames()).map((s) =>
      s.id === g.own?.id ? g.own : { ...s, frames: s.frames.filter((f) => f.id !== g.frame.id) },
    )
    return outlinesOf(sections, view.camera())
  }

  return {
    start,
    drag,
    release,
    shownSections,
  }
}
