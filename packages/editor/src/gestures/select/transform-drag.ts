// Moving, resizing and turning the selection on the stage, and the marquee: the handles a press
// grabs, the boxes a drag writes, and what it snaps to: the snap lines and equal gaps it shows. It builds
// `move-drag`, the move, `resize-drag`, the resize and a line's end, and `radius-drag`, the radius
// dots and their drag.
import { descendants, frameIdOf, type GestureStep, intersects, type Session } from '@dazbee/doc'
import type { Design, Point, Rect } from '@dazbee/schema'

import { type Camera, toWorld } from '../../canvas/camera.ts'
import { type Frame, frameAt } from '../../canvas/frames.ts'
import { lineReach } from '../../canvas/hit-test.ts'
import type { FrameScenes } from '../../canvas/scenes.ts'
import type { NoticeDetail } from '../../core-interface.ts'
import type { EditorBoxes, SelectionBox } from '../../layers/boxes.ts'
import type { EditorDuplicate } from '../../layers/duplicate.ts'
import { type DragSnap, type ShownSnap, snapTargets, type Targets } from '../../layers/snap.ts'
import {
  angleOf,
  boundsOf,
  type Box,
  centreOf,
  type Handle,
  localTo,
  normalAngle,
  round,
  snapAngle,
  turn,
} from '../../layers/transform.ts'
import { runQuietly } from '../../run-quietly.ts'
import type { EditorSelection, Selection } from '../../selection.ts'
import type { EditorTyping } from '../../text/typing.ts'
import type { EditorTools } from '../../tools.ts'
import { type Grab, screenCorners, zoneAt } from '../hit-zones.ts'
import type { PointerInput } from '../inputs.ts'
import type { EditorAutoLayoutDrag } from './auto-layout-drag.ts'
import { type EditorMoveDrag, editorMoveDrag, type MoveDrag } from './move-drag.ts'
import { type EditorRadiusDrag, editorRadiusDrag, type RadiusDrag, type ShownDots } from './radius-drag.ts'
import { editorResizeDrag, type EndDrag, type ResizedBox, type ResizeDrag, type ResizePart } from './resize-drag.ts'

/** A drag turning the selection from outside one of its corners, from the press until it ends: one undo step. */
export interface RotateDrag {
  kind: 'rotate'
  frame: Frame
  around: Box[]
  outer: Box
  from: number
  roots: string[]
  boxes: Map<string, Box>
  step: GestureStep
}
/** A marquee being dragged on the stage, in world units, with what was selected before it. */
export interface MarqueeDrag {
  kind: 'marquee'
  from: Point
  to: Point
  base: Selection
}
/** A drag from the selection's handles: a resize, a turn, a line's end or a radius dot. */
export type HandleDrag = ResizeDrag | RotateDrag | EndDrag | RadiusDrag
/** A drag that moves, resizes or turns layers, or moves a line's end. */
export type TransformDrag = MoveDrag | HandleDrag

export interface TransformDragDeps {
  /** Asks for the pointer to be held from the press being handled. */
  hold: () => void
  session: Session
  scenes: Pick<FrameScenes, 'shownScene'>
  selection: Pick<EditorSelection, 'current' | 'cropping' | 'pathEditing' | 'selectKeepingModes' | 'held' | 'restore'>
  duplicate: Pick<EditorDuplicate, 'copyInPlace'>
  typing: Pick<EditorTyping, 'editing' | 'fitText'>
  tools: Pick<EditorTools, 'tool'>
  boxes: Pick<
    EditorBoxes,
    | 'boxIn'
    | 'containersOf'
    | 'storedBoxes'
    | 'startBoxes'
    | 'pickable'
    | 'roots'
    | 'rootsByFrame'
    | 'selectionBox'
    | 'selectionBoxes'
    | 'handlesFor'
    | 'selectedLine'
    | 'snapBoxes'
    | 'drawnInFlow'
    | 'drawnHolders'
  >
  camera: () => Camera
  /** The shown page's frames as last drawn. */
  frames: () => Frame[]
  /** Where in a laid-out box's flow moved layers would go, and their drop there. */
  autoLayoutDrag: Pick<EditorAutoLayoutDrag, 'dropAt' | 'dropInto'>
  /** Groups fit what they hold again after a change inside them, in the same undo step. */
  hug: (ids: string[]) => void
  /** Tells the app that auto layout places some of the layers a drag would move. */
  notify: (...told: NoticeDetail<'placedByLayout'>) => void
  /** A radius in the app's words, as the pill beside the pointer reads it while a radius dot is dragged. */
  radiusLabel: (radius: number) => string
  /** Tells that what is shown changed. */
  shownChanged: () => void
}

export interface EditorTransformDrag {
  /**
   * Snapping's work since the editor opened, for the checks that count it: `gathered` drags
   * worked out what they can snap to, `moves` pointer moves of a drag snapped, and the last
   * drag gathered `targets` boxes.
   */
  snapWork(): { gathered: number; moves: number; targets: number }
  /**
   * What a press at a point on the stage grabs on the selection (`zoneAt`): a corner or edge, the
   * band outside a corner that turns it, or one line's end; `touch` for a finger's press. With
   * `dots`, a radius dot too, where the selection shows them (`shownDots`); never by a finger.
   */
  handleUnder(screen: Point, touch?: boolean, dots?: boolean): Grab | null
  /** Notes the type of the pointer last seen on the stage; returns whether that changed whether the radius dots show. */
  sawPointer: EditorRadiusDrag['saw']
  /** Notes the radius dot under a stage point, null for none to look for; returns whether the dot under the pointer changed. */
  hoverDot(screen: Point | null): boolean
  /**
   * The selection's radius dots, the dragged one big while `g` drags one, with the words of the
   * radius it asks for; none during any other drag or by a finger.
   */
  shownDots(g: { kind: string } | null): ShownDots
  /**
   * What the drag in progress snapped to: its snap lines and equal gaps, with the containers that turn
   * them in its frame as they are now; null when it snapped to nothing, or when its first layer is
   * no longer in the parent it gathered what to snap to in.
   */
  shown(): ShownSnap | null
  /**
   * A press on a handle the selection's box `outer` has: a drag that resizes or turns it, moves a
   * line's end or rounds its corners from a radius dot, one undo step until it is released.
   */
  pressHandle(e: PointerInput, screen: Point, grabbed: Grab, outer: SelectionBox): HandleDrag
  /**
   * A press that moves layers in a frame and, by the same amount, the selected layers of other
   * frames: a drag of those no flow places, one undo step until it is released; the app hears when
   * some are.
   */
  pressMove(
    frame: Frame,
    around: Box[],
    p: Point,
    ids: string[],
    others?: { frame: Frame; around: Box[]; ids: string[] }[],
  ): MoveDrag
  /**
   * Follows the pointer: Shift keeps a move to one axis, a resize to its shape, a turn to 15° steps
   * and a line to 45° steps; Alt resizes about the centre, and has a radius dot round its own corner;
   * `deep` (the deep key held) keeps what a resized box holds where it is on the page.
   */
  drag(g: TransformDrag, p: Point, shift: boolean, alt: boolean, snap: boolean, deep?: boolean): void
  /**
   * The layers of a frame a resize from `handle` changes, as it begins: `outer` is their box with
   * the containers around it. A drag other than the selection's handles, such as a crop's window,
   * resizes them through `resizePartTo`.
   */
  resizePart(outer: ResizedBox, ids: string[], handle: Handle): ResizePart
  /**
   * Resizes a part's layers from their box as the resize began to `to`, as every resize does: the
   * first time, the sides `handle` drags become Fixed; a layer a flow places keeps its place; what
   * a box holds follows its constraints, or with `keep` stays where it is on the page; the text a
   * corner scales scales with it, no less than it may. Gives the box they take.
   */
  resizePartTo(part: ResizePart, to: Box, handle: Handle, fromCentre: boolean, keep?: boolean): Box
  /** Writes new boxes: what changed from `start`, and what a gesture changed and put back. */
  writeBoxes(frame: Frame, start: Map<string, Box>, next: Map<string, Box>): void
  /**
   * Writes new stored boxes, as the constraints rule gives them, in one batch with what else the
   * move writes (`also`): each layer's values that differ from its box in `start`, the design as the
   * gesture began, and those the gesture wrote before and has now put back, each only where it
   * differs from the layer's own. Returns how many layers it wrote.
   */
  writeStoredBoxes(start: Design, next: ReadonlyMap<string, Rect>, also?: () => void): number
  /** Alt pressed or let go with the pointer still, told to a move (see `EditorMoveDrag`). */
  setAlt: EditorMoveDrag['setAlt']
  /** Whether a move carries layers for Alt to copy (see `EditorMoveDrag`). */
  carries: EditorMoveDrag['carries']
  /** With a move's copies each where its original is, the selection to put back (see `EditorMoveDrag`). */
  copiesUnmoved: EditorMoveDrag['copiesUnmoved']
  /**
   * Selects the layers a marquee touches in the frame it covers, toggled in what was selected before
   * it there: a layer selected before that it touches comes out, any other it touches goes in.
   */
  marquee(g: MarqueeDrag): void
  /** Ends a move, resize or turn, the groups around the layers fitting them again, or a radius drag, closing its undo step. */
  release(g: TransformDrag): void
  /** Lets the snap lines go; every press calls it as it ends. */
  clearSnapLines(): void
}

/** The values of a drawn box a drag writes. */
const BOX_KEYS = ['x', 'y', 'width', 'height', 'rotation'] as const
/** The values of a stored box the constraints rule gives. */
const RECT_KEYS = ['x', 'y', 'width', 'height'] as const

export function editorTransformDrag({
  hold,
  session,
  scenes,
  selection,
  typing,
  tools,
  boxes: {
    boxIn,
    containersOf,
    storedBoxes,
    startBoxes,
    pickable,
    roots,
    rootsByFrame,
    selectionBox,
    selectionBoxes,
    handlesFor,
    selectedLine,
    snapBoxes,
    drawnInFlow,
    drawnHolders,
  },
  duplicate,
  camera,
  frames,
  autoLayoutDrag,
  hug,
  notify,
  radiusLabel,
  shownChanged,
}: TransformDragDeps): EditorTransformDrag {
  /** What the drag in progress snapped to, shown as snap lines and equal gaps. */
  let snapped: DragSnap | null = null
  /** Snapping's work since the editor opened: drags that gathered targets, moves that snapped, the last drag's targets. */
  const snapWork = { gathered: 0, moves: 0, targets: 0 }
  /** What each gesture has written so far, by its start boxes or its start design: each layer's properties. */
  const written = new WeakMap<object, Map<string, Set<string>>>()
  const { pressMove, moveTo, setAlt, carries, copiesUnmoved } = editorMoveDrag({
    session,
    selection,
    boxes: { startBoxes },
    duplicate,
    camera,
    autoLayoutDrag,
    notify,
    targetsFor,
    showSnap,
    snapMoved,
    writeBoxes,
    frames,
  })
  const { resizePart, resizeTo, resizePartTo, endTo } = editorResizeDrag({
    session,
    typing,
    boxes: { startBoxes, boxIn },
    camera,
    showSnap,
    writeBoxes,
  })
  const radius = editorRadiusDrag({
    hold,
    session,
    selection,
    typing,
    tools,
    boxes: { selectionBox },
    camera,
    radiusLabel,
    shownChanged,
  })
  /** Snapping's work so far, as a copy. */
  function snapWorkSoFar() {
    return { ...snapWork }
  }
  /** What a drag of layers in a frame can snap to, in the space the containers `around` them give. Counted in `snapWork`. */
  function targetsFor(frame: Frame, ids: string[], around: Box[]): Targets | null {
    const found = snapBoxes(frame, ids, around)
    if (!found) return null
    const targets = snapTargets(found.beside, found.within, found.parent, found.guides)
    snapWork.gathered++
    snapWork.targets = targets.boxes.length
    return targets
  }
  /** What a press at a screen point grabs on the selection: a corner or edge, the band outside a corner, a line's end or a radius dot. */
  function handleUnder(screen: Point, touch = false, dots = false): Grab | null {
    const outer = selectionBox()
    if (!outer || typing.editing() || selection.pathEditing()) return null
    const { frame, drawn: box } = outer
    const corners = screenCorners(box, frame, camera())
    const line = selectedLine()
    // A selection locked in place has no handles, and so no turning band; across frames it has
    // only its resize handles, so a turn never leaves the other copies as they were.
    return zoneAt(corners, screen, {
      handles: handlesFor(),
      rotate: selectionBoxes().length === 1,
      line: line?.ends ?? false,
      zoom: camera().zoom,
      lineReach: line ? lineReach(line.props, camera().zoom) : undefined,
      touch,
      dots: dots && !touch ? radius.dotsOn(outer) : undefined,
    })
  }
  function shown(): ShownSnap | null {
    if (!snapped) return null
    const { frame, parent, layers, snapLines, gaps } = snapped
    const now = session.design()
    // Nothing shows once another tab deletes the first layer or takes it out of the parent.
    if (now.nodes[layers[0] ?? '']?.parentId !== parent) return null
    return { frame, around: containersOf(frame, parent, now), snapLines, gaps }
  }
  function hoverDot(screen: Point | null) {
    return radius.hover(screen, (at) => handleUnder(at, false, true))
  }
  function shownDots(g: { kind: string } | null) {
    if (g && g.kind !== 'radius') return { dots: [], label: null }
    return radius.shown(g as RadiusDrag | null)
  }

  /** Lets the snap lines of the drag that snapped go, as every press ends. */
  function clearSnapLines() {
    snapped = null
  }
  /** Shows what the drag in progress snapped to; null when it snapped to nothing. */
  function showSnap(shown: DragSnap | null) {
    snapped = shown
  }
  /** Counts a pointer move of a drag that snapped. */
  function snapMoved() {
    snapWork.moves++
  }
  /** A press on one of the selection's handles: a drag that resizes or turns it, moves a line's end or rounds its corners, one undo step. */
  function pressHandle(e: PointerInput, screen: Point, grabbed: Grab, outer: SelectionBox): HandleDrag {
    const world = toWorld(camera(), screen)
    const { around } = outer
    const grab = localTo({ x: world.x - outer.frame.x, y: world.y - outer.frame.y }, around)
    if (grabbed.kind === 'radius') return radius.press(grabbed.corner, outer, grab, e.altKey)
    hold()
    const parts = rootsByFrame()
    const ids = parts.find((part) => part.frame.id === outer.frame.id)?.ids ?? roots()
    const step = session.beginGesture(grabbed.kind === 'rotate' ? 'rotate' : 'resize')
    if (grabbed.kind === 'resize') {
      const others = selectionBoxes().filter((other) => other.frame.id !== outer.frame.id)
      return {
        kind: 'resize',
        ...resizePart(outer, ids, grabbed.handle),
        handle: grabbed.handle,
        grab,
        targets: targetsFor(outer.frame, ids, around),
        others: others.map((other) =>
          resizePart(other, parts.find((part) => part.frame.id === other.frame.id)?.ids ?? [], grabbed.handle),
        ),
        step,
      }
    }
    if (grabbed.kind === 'end')
      return { ...resizePart(outer, ids, grabbed.end), kind: 'end', end: grabbed.end, grab, step }
    const { frame, box } = outer
    const boxes = startBoxes(frame, ids)
    return { kind: 'rotate', frame, around, outer: box, roots: ids, boxes, from: angleOf(grab, centreOf(box)), step }
  }
  /**
   * Follows the pointer in a move, resize, turn or radius drag. Shift keeps a move to one axis, a
   * resize to the box's shape and a turn to 15° steps; Alt resizes about the centre, has a move
   * carry copies and a radius dot round its own corner; `snap` snaps a move or resize to what is
   * around it, and `deep` keeps what a resized box holds where it is on the page.
   */
  function drag(g: TransformDrag, p: Point, shift: boolean, alt: boolean, snap: boolean, deep = false) {
    if (g.kind === 'move') moveTo(g, p, shift, snap, alt)
    else if (g.kind === 'resize') resizeTo(g, p, shift, alt, snap, deep)
    else if (g.kind === 'end') endTo(g, p, shift)
    else if (g.kind === 'radius') radius.dragTo(g, p, alt)
    else rotateTo(g, p, shift)
  }
  /** Turns the layers about the selection's centre by the angle the pointer has turned through. */
  function rotateTo(g: RotateDrag, p: Point, snap: boolean) {
    const centre = centreOf(g.outer)
    const turned = angleOf(p, centre) - g.from
    const next = new Map<string, Box>()
    const now = session.design()
    if (g.roots.length === 1) {
      // One layer: its own angle snaps with shift. What is inside it turns with it as it is drawn.
      const root = g.roots[0] as string
      const angle = g.outer.rotation + turned
      next.set(root, { ...g.outer, rotation: round(normalAngle(snap ? snapAngle(angle) : angle)) })
    } else {
      // Several: each turns about the selection's centre, by an angle that snaps with shift.
      const delta = snap ? snapAngle(turned) : turned
      for (const root of g.roots) {
        const was = g.boxes.get(root)
        if (!was) continue
        const c = centreOf(was)
        const moved = turn(c, centre, delta)
        const dx = moved.x - c.x
        const dy = moved.y - c.y
        next.set(root, {
          ...was,
          x: round(was.x + dx),
          y: round(was.y + dy),
          rotation: round(normalAngle(was.rotation + delta)),
        })
        for (const id of descendants(now, root)) {
          const inner = g.boxes.get(id)
          if (inner) next.set(id, { ...inner, x: round(inner.x + dx), y: round(inner.y + dy) })
        }
      }
    }
    writeBoxes(g.frame, g.boxes, next)
  }
  /**
   * Writes new boxes, given where the layers are to be drawn: the properties the gesture changes
   * from where it started, including one it changed and has now put back, each stored where it
   * draws there. The rest is left to other tabs.
   */
  function writeBoxes(frame: Frame, start: Map<string, Box>, next: Map<string, Box>) {
    const now = session.design()
    const wrote = writtenBy(start)
    const patches = new Map<string, Partial<Box>>()
    for (const [id, box] of next) {
      const patch = patchFor(id, box, start.get(id), boxIn(id, now) ?? undefined, wrote, BOX_KEYS)
      if (patch) patches.set(id, patch)
    }
    // One update for the whole step, not one per layer: a drag of many layers sends and stores once a move.
    session.batch(() => {
      // Another tab may delete or lock a layer mid-drag; the drag then just leaves it be.
      for (const [id, patch] of storedBoxes(patches)) runQuietly(() => session.run('node.update', { ids: [id], patch }))
    })
  }
  function writeStoredBoxes(start: Design, next: ReadonlyMap<string, Rect>, also?: () => void) {
    const now = session.design()
    const wrote = writtenBy(start)
    const patches = new Map<string, Partial<Rect>>()
    // A layer the gesture wrote that the rule no longer moves goes back to its box as the gesture began.
    for (const id of new Set([...next.keys(), ...wrote.keys()])) {
      const was = start.nodes[id]?.props
      const patch = patchFor(id, next.get(id) ?? was, was, now.nodes[id]?.props, wrote, RECT_KEYS)
      if (patch) patches.set(id, patch)
    }
    session.batch(() => {
      also?.()
      // Another tab may delete or lock a layer mid-drag; the drag then just leaves it be.
      for (const [id, patch] of patches) runQuietly(() => session.run('node.update', { ids: [id], patch }))
    })
    return patches.size
  }
  /** What a gesture has written so far, by each layer's id, kept by its start boxes or start design. */
  function writtenBy(start: object) {
    const wrote = written.get(start) ?? new Map<string, Set<string>>()
    written.set(start, wrote)
    return wrote
  }
  /** Selects the top-level layers the marquee touches in the frame it covers; with Shift, each one it touches goes in if it was out and comes out if it was in. */
  function marqueeSelect(g: MarqueeDrag) {
    const rect = {
      x: Math.min(g.from.x, g.to.x),
      y: Math.min(g.from.y, g.to.y),
      width: Math.abs(g.to.x - g.from.x),
      height: Math.abs(g.to.y - g.from.y),
    }
    const frame = frameAt(frames(), g.from) ?? frames().find((f) => intersects(f, rect))
    if (!frame) return
    const local = { x: rect.x - frame.x, y: rect.y - frame.y, width: rect.width, height: rect.height }
    const hits = scenes
      .shownScene(frame)
      .layers.filter((layer) => pickable(layer) && intersects(boundsOf([{ ...layer.props }]), local))
      .map((layer) => layer.id)
    // What was selected stays when some of it is in the marquee's frame, as Shift and a click there keep it,
    // and the marquee toggles what it touches: a layer selected before comes out, any other goes in.
    const base = g.base.some((layer) => layer.frameId === frame.id) ? g.base : []
    const kept = base.filter((layer) => !hits.includes(layer.id))
    const added = hits.filter((id) => !base.some((layer) => layer.id === id)).map((id) => ({ id, frameId: frame.id }))
    selection.selectKeepingModes(added.length + kept.length > 0 ? [...kept, ...added] : null)
  }
  /**
   * Ends a move, resize, turn or radius drag: a move over a laid-out box drops the layers into its
   * flow, and one over another frame moves them onto it; the groups around the layers a box changed
   * fit them again, closing its undo step.
   */
  function release(g: TransformDrag) {
    // Copies dropped onto another frame keep their originals' link ids where it holds none.
    const links = g.kind === 'move' && g.target ? g.sources?.links : undefined
    if (g.kind === 'move' && g.drop) autoLayoutDrag.dropInto(g.drop, g.roots, links)
    else if (g.kind === 'move' && g.target) moveOnto(g.target, g.roots, links)
    if (g.kind !== 'radius')
      hug(g.kind === 'rotate' || g.kind === 'end' ? g.roots : [g.roots, ...g.others.map((other) => other.roots)].flat())
    g.step.end()
  }

  /**
   * Moves dropped layers onto the top of another frame of the page, in the order they are drawn,
   * each kept where it is drawn on the page, taking the link ids `links` names where it holds none.
   */
  function moveOnto(to: Frame, ids: string[], links?: Record<string, string>) {
    const now = session.design()
    const order = new Map(descendants(now, frameIdOf(now, ids[0] ?? '') ?? '').map((id, i) => [id, i]))
    const sorted = [...ids].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0))
    // As drawn before any moves; each move reads its own layers' entries.
    const [drawn, holders] = [drawnInFlow(sorted, to.id), drawnHolders(sorted, to.id)]
    for (const id of sorted)
      runQuietly(() =>
        session.run('node.move', {
          id,
          parentId: to.id,
          ...(drawn ? { drawn } : {}),
          ...(holders ? { holders } : {}),
          ...(links ? { links } : {}),
        }),
      )
  }

  return {
    snapWork: snapWorkSoFar,
    handleUnder,
    sawPointer: radius.saw,
    hoverDot,
    shownDots,
    shown,
    pressHandle,
    pressMove,
    drag,
    resizePart,
    resizePartTo,
    writeBoxes,
    writeStoredBoxes,
    setAlt,
    carries,
    copiesUnmoved,
    marquee: marqueeSelect,
    release,
    clearSnapLines,
  }
}

/** The frame and the layers a move, resize, turn or line's end carries, which may reach past the frame's edge; null for any other gesture. */
export function carried(g: { kind: string } | null): { frame: Frame; roots: string[] } | null {
  if (g?.kind !== 'move' && g?.kind !== 'resize' && g?.kind !== 'rotate' && g?.kind !== 'end') return null
  const { frame, roots } = g as Exclude<TransformDrag, RadiusDrag>
  return { frame, roots }
}

/**
 * The values of `box` a gesture writes over a layer's own, `current`: each of `keys` that differs
 * from `was`, the layer's as the gesture began, or that the gesture wrote before, where it differs
 * from the layer's own; noted in `wrote` by the layer's id. Null when there is none.
 */
function patchFor<K extends string>(
  id: string,
  box: Readonly<Record<K, number>> | undefined,
  was: Readonly<Record<K, number>> | undefined,
  current: Readonly<Record<K, number>> | undefined,
  wrote: Map<string, Set<string>>,
  keys: readonly K[],
): Partial<Record<K, number>> | null {
  if (!box) return null
  const before = wrote.get(id)
  const patch: Partial<Record<K, number>> = {}
  for (const key of keys)
    if ((box[key] !== was?.[key] || before?.has(key)) && box[key] !== current?.[key]) patch[key] = box[key]
  const changed = Object.keys(patch)
  if (changed.length === 0) return null
  const noted = before ?? new Set<string>()
  for (const key of changed) noted.add(key)
  wrote.set(id, noted)
  return patch
}
