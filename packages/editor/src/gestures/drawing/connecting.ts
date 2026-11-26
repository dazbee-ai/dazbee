// Drawing a connector with the Arrow shape (ADR-0024): the frame or section the pointer is near
// shows four dots just outside its sides; a press on one starts a drag, which lights the frame or
// section under the pointer that `connector.add` would join it to, and on release over it joins
// them, one undo step, the select tool back with the connector picked. Released anywhere else, it
// makes nothing. A tab that may only view gets no dots.
import { connectorRefusal, type Session } from '@dazbee/doc'
import type { Point, Rect } from '@dazbee/schema'

import { toScreen } from '../../canvas/camera.ts'
import { type ConnectorCurve, connectorCurve, frameEndBox } from '../../canvas/connectors.ts'
import { sectionAt } from '../../canvas/sections.ts'
import type { EditorView } from '../../canvas/view.ts'
import { runQuietly } from '../../run-quietly.ts'
import type { EditorSelection } from '../../selection.ts'
import type { EditorTyping } from '../../text/typing.ts'
import type { EditorTools } from '../../tools.ts'
import type { PointerInput } from '../inputs.ts'
import type { EditorFrameMove } from '../select/frame-move.ts'
import { drawsConnectors } from './draw-tools.ts'

/** A connector being drawn, from the press on a dot until it is let go. */
export interface ConnectDrag {
  kind: 'connect'
  /** The frame or section it starts from. */
  from: string
  /** Where the pointer is, in screen pixels. */
  to: Point
  /** The frame or section under the pointer that it would join, lit; null for none. */
  target: string | null
}
/** What the overlay shows of drawing connectors, in screen pixels. */
export interface ShownConnecting {
  /** The dots of the frame or section the pointer is near, which a press starts a connector from; none while dragging. */
  dots: Point[]
  /** The curve the drag draws, to the lit frame or section, else to the pointer; null while not dragging. */
  preview: ConnectorCurve | null
  /** The frame or section the drag would join, lit: its box, and whether it is a section's outline. */
  lit: { box: Rect; section: boolean } | null
}

export interface ConnectingDeps {
  /** Asks for the pointer to be held from the press being handled. */
  hold: () => void
  session: Pick<Session, 'run' | 'readOnly'>
  view: Pick<EditorView, 'camera' | 'design' | 'frames' | 'page'>
  tools: Pick<EditorTools, 'tool' | 'setTool'>
  selection: Pick<EditorSelection, 'pickConnector'>
  typing: Pick<EditorTyping, 'stop'>
  /** The sections as the stage draws them, whose outlines are connectors' ends. */
  frameMove: Pick<EditorFrameMove, 'shownSections'>
  /** Tells that what is shown changed. */
  shownChanged: () => void
}

export interface EditorConnecting {
  /**
   * Follows the pointer, at a stage point or off the stage with null: the frame or section it is
   * near, whose dots show while the Arrow shape is the tool. Returns whether that changed.
   */
  hover(stage: Point | null): boolean
  /** A press with the Arrow shape at a stage point: the drag a press on a dot starts; null anywhere else, and for a tab that may only view. */
  press(e: PointerInput, stage: Point): ConnectDrag | null
  /** Follows the pointer, at a world point, once the press is a drag: the frame or section under it is lit, unless `connector.add` would refuse it. */
  drag(g: ConnectDrag, world: Point): void
  /** Ends the drag: over a lit frame or section, joins them, one undo step, the select tool back with the connector picked; else makes nothing. */
  release(g: ConnectDrag): void
  /** What the overlay shows now, with `gesture` the drag on the stage. */
  shown(gesture: { kind: string } | null): ShownConnecting
}

/** A frame or a section as a connector's end: its id and its box on the stage. */
interface End {
  id: string
  box: Rect
  section: boolean
}

/** How far outside the middle of a side its dot sits, in screen pixels. */
export const DOT_OFFSET = 12
/** How far from a frame or section the pointer still keeps its dots, so they can be reached, in screen pixels. */
export const HOVER_REACH = 24

/** How far from a dot's middle a press still takes it, in screen pixels. */
const DOT_REACH = 8

export function editorConnecting({
  hold,
  session,
  view,
  tools,
  selection,
  typing,
  frameMove,
  shownChanged,
}: ConnectingDeps): EditorConnecting {
  /** The frame or section the pointer is near, by its id; null for none. */
  let hovered: string | null = null

  function shown(gesture: { kind: string } | null): ShownConnecting {
    if (gesture?.kind === 'connect') {
      const g = gesture as ConnectDrag
      const ends = endsNow()
      const from = ends.find((end) => end.id === g.from)
      const lit = ends.find((end) => end.id === g.target)
      const preview = from ? connectorCurve(from.box, lit?.box ?? { ...g.to, width: 0, height: 0 }) : null
      return { dots: [], preview, lit: lit ? { box: lit.box, section: lit.section } : null }
    }
    const end = offered() && hovered !== null ? endsNow().find((e) => e.id === hovered) : undefined
    return { dots: end ? dotsOf(end.box) : [], preview: null, lit: null }
  }
  function hover(stage: Point | null) {
    const near = stage && offered() ? (endNear(stage)?.id ?? null) : null
    const changed = near !== hovered
    hovered = near
    return changed
  }
  function press(e: PointerInput, stage: Point): ConnectDrag | null {
    if (!offered()) return null
    const end = endNear(stage)
    if (!end || !dotsOf(end.box).some((dot) => Math.hypot(dot.x - stage.x, dot.y - stage.y) <= DOT_REACH)) return null
    typing.stop()
    hold()
    return { kind: 'connect', from: end.id, to: stage, target: null }
  }
  function drag(g: ConnectDrag, world: Point) {
    g.to = toScreen(view.camera(), world)
    g.target = targetAt(g.from, g.to)
    shownChanged()
  }
  function release(g: ConnectDrag) {
    const to = g.target
    if (to === null) return
    let id = ''
    if (!runQuietly(() => (id = session.run('connector.add', { pageId: view.page(), from: g.from, to })))) return
    tools.setTool('select')
    selection.pickConnector(id)
  }

  /** Whether the dots are offered: the Arrow shape is the tool, in a tab that may write. */
  function offered() {
    return drawsConnectors(tools.tool()) && !session.readOnly()
  }
  /** The shown page's frames, then its drawn sections, each as a connector's end with its box on the stage. */
  function endsNow(): End[] {
    const camera = view.camera()
    const frames = view.frames().map((f): End => ({ id: f.id, box: frameEndBox(f, camera), section: false }))
    const sections = outlines().map(({ id, box }): End => ({ id, box, section: true }))
    return [...frames, ...sections]
  }
  function outlines() {
    return frameMove.shownSections(null).outlines
  }
  /**
   * The frame or section a stage point is near: the frame on top that holds it, else the nearest
   * frame within HOVER_REACH, else the same of the sections, the newer on top.
   */
  function endNear(p: Point): End | null {
    const ends = endsNow()
    const frames = ends.filter((e) => !e.section)
    return (
      nearestTo(frames, p) ??
      nearestTo(
        ends.filter((e) => e.section),
        p,
      )
    )
  }
  /** The frame or section under a stage point that a connector from `from` may join: the frame on top, else the newer section; null when `connector.add` would refuse it. */
  function targetAt(from: string, p: Point): string | null {
    const camera = view.camera()
    const frame = view.frames().findLast((f) => distanceTo(frameEndBox(f, camera), p) === 0)
    const id = frame?.id ?? sectionAt(outlines(), p)?.id
    if (id === undefined) return null
    return connectorRefusal(view.design(), view.page(), from, id) === undefined ? id : null
  }

  return {
    shown,
    hover,
    press,
    drag,
    release,
  }
}

/** The four dots of a box, DOT_OFFSET outside the middle of its top, right, bottom and left sides. */
export function dotsOf(box: Rect): Point[] {
  const [midX, midY] = [box.x + box.width / 2, box.y + box.height / 2]
  return [
    { x: midX, y: box.y - DOT_OFFSET },
    { x: box.x + box.width + DOT_OFFSET, y: midY },
    { x: midX, y: box.y + box.height + DOT_OFFSET },
    { x: box.x - DOT_OFFSET, y: midY },
  ]
}

/** Of `ends`, the one on top that holds a point, else the nearest within HOVER_REACH; null for none. */
function nearestTo(ends: readonly End[], p: Point): End | null {
  let best: End | null = null
  let bestAway = HOVER_REACH
  for (const end of ends) {
    const away = distanceTo(end.box, p)
    // Later ends are drawn on top: one that holds the point as well wins.
    if (away < bestAway || (away === 0 && bestAway === 0)) [best, bestAway] = [end, away]
  }
  return best
}

/** How far a point is from a box: 0 inside it. */
function distanceTo(box: Rect, p: Point) {
  return Math.hypot(
    Math.max(box.x - p.x, 0, p.x - box.x - box.width),
    Math.max(box.y - p.y, 0, p.y - box.y - box.height),
  )
}
