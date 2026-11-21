// Where layers are in a frame, read from the document: their boxes as layers see them and as
// drawn, the containers around them, the selection's box and handles, what a drag snaps to, a
// path's points, the image fill a crop works on, and the parent a new layer goes in.
import type { Image } from '@dazbee/canvaskit'
import {
  ancestorsOf,
  boxWithout,
  childrenOf,
  flippedRect,
  type Flips,
  flipsOf,
  placedByFlow,
  type Session,
} from '@dazbee/doc'
import { imageSizeOf, type SceneLayer } from '@dazbee/renderer'
import {
  bindableEntry,
  canHold,
  type Design,
  fitsProperty,
  type GraphicProps,
  type ImagePaint,
  isNonEmpty,
  type NonEmpty,
  type Paint,
  pathScale,
  type Point,
  type Rect,
} from '@dazbee/schema'

import { byFrame } from '../across-frames.ts'
import type { Frame } from '../canvas/frames.ts'
import { guidesShown } from '../canvas/guides.ts'
import type { HitOptions } from '../canvas/hit-test.ts'
import type { FrameScenes } from '../canvas/scenes.ts'
import { cropStart, type Size } from '../gestures/crop/crop.ts'
import { flipPath, offsetPath, parsePath, type PenPath, scalePath } from '../gestures/pen/path.ts'
import type { EditorResources } from '../resources.ts'
import { type EditorSelection, firstFrameOf, idsOf } from '../selection.ts'
import { laidOut, placedInside, propIn } from './auto-layout.ts'
import { boxOfLayer, editorDrawnPlaces, storedBox } from './drawn-places.ts'
import type { GuideLine, WithinBox } from './snap.ts'
import {
  boundsOf,
  type Box,
  drawnFrom,
  type Handle,
  HANDLES,
  holdsPoint,
  localStep,
  normalAngle,
  round,
  uprightOnPage,
} from './transform.ts'

/**
 * The image fill a crop works on (#48): the topmost of a layer's fills in a frame, with where the
 * whole image is drawn as the crop starts, mirrored as the layer is flipped, the image and its size,
 * the layer's box with its containers, the box last, and its flips.
 */
export interface CropTarget {
  fills: Paint[]
  index: number
  fill: ImagePaint
  image: Image
  size: Size
  box: Box
  rect: Rect
  around: Box[]
  flips: Flips
}

/**
 * The box the handles go on: a single layer's own, turned with it, or the unturned box around
 * several. `box` is as the layers inside their containers see it, which gestures work in;
 * `drawn` is where it is in the frame once the containers turn it; `around` are the containers.
 */
export interface SelectionBox {
  frame: Frame
  box: Box
  drawn: Box
  around: Box[]
}

/**
 * What a drag of layers can snap to, in the space of the `parent` they were gathered in, a layer's
 * id or the frame's: the boxes of the layers `beside` them, and of what they are `within`, whose
 * lines snap and which no equal gap is measured to: their parent, and with no container around
 * them turned, the frame.
 */
export interface SnapBoxes {
  parent: string
  beside: Rect[]
  within: WithinBox[]
  /** The frame's guides within its edges, while the drag works in the frame's own space. */
  guides: GuideLine[]
}

export interface BoxesDeps {
  session: Session
  scenes: Pick<FrameScenes, 'scene' | 'hit' | 'under' | 'laidOut' | 'laidOutLayer'>
  resources: Pick<EditorResources, 'resources' | 'bytes'>
  selection: Pick<EditorSelection, 'current' | 'entered'>
  /** The design as last drawn. */
  drawn: () => Design
  /** The shown page's frame with an id, as last drawn, if there is one. */
  frameOf: (id: string | undefined) => Frame | undefined
  /** The camera's zoom, as a hit test's reaches are in screen pixels. */
  zoom: () => number
}

export interface EditorBoxes {
  /** A layer's box in its frame, as layers inside its containers see it: auto layout's, or its own. */
  boxIn(id: string, from?: Design): Box | null
  /** The groups and boxes a layer is inside, outermost first, each as its position, size and turn in a frame. */
  containersOf(frame: Frame, parentId: string | undefined, from?: Design): Box[]
  /** A layer's box as it is drawn in its frame, turned by its containers. */
  drawnBoxOf(frame: Frame, id: string, from?: Design): Box | null
  /** Whether a point in a frame is inside a layer as it is drawn there. */
  drawnContains(frame: Frame, id: string, p: Point, from: Design): boolean
  /** The boxes a transform of layers changes, as they are now: the layers and those under them that no flow places. */
  startBoxes(frame: Frame, ids: string[]): Map<string, Box>
  /**
   * The boxes a move of layers in a frame changes (`startBoxes`), each moved by its layer's step
   * across the frame as drawn, `stepOf` the layer: turned into the space of the containers around
   * that layer, to whole pixels.
   */
  movedBoxes(frame: Frame, ids: string[], stepOf: (id: string) => Point): Map<string, Box>
  /**
   * The box the selection's handles go on, round the selected layers in the first one's frame, with
   * where it is drawn and its containers; null with nothing selected.
   */
  selectionBox(): SelectionBox | null
  /** The box round the selected layers in each frame of the shown page that holds some, the first one's frame first. */
  selectionBoxes(): SelectionBox[]
  /** The selected layers that aren't inside another selected one: the ones a transform moves. */
  roots(from?: Design): string[]
  /** The selected layers a transform moves, split by their frame on the shown page, the first one's frame first. */
  rootsByFrame(from?: Design): { frame: Frame; ids: NonEmpty<string> }[]
  /** Whether a layer can be gathered by select all or a marquee: it isn't locked in place. */
  pickable(layer: SceneLayer): boolean
  /** Whether the selection is locked in place: it shows no handles and a press can't move it. */
  lockedSelection(): boolean
  /** The handles the selection has. */
  handlesFor(): readonly Handle[]
  /**
   * Null unless the selection is one line in the first frame it spans; then its props and whether
   * its two ends are its handles: only when it is selected alone and no flow places it. With its linked copies, or
   * placed by a flow, whose place and turn are the flow's, it is resized along its length as any flat
   * selection is.
   */
  selectedLine(): { ends: boolean; props: GraphicProps } | null
  /**
   * What a drag of layers in a frame can snap to, in the space the containers `around` them give;
   * null when one around them is turned and they are not all in one parent whose containers those are.
   */
  snapBoxes(frame: Frame, ids: string[], around: Box[]): SnapBoxes | null
  /** A path layer's path in a frame as drawn, mirrored as it is flipped, with its box and what turns it: its containers, then the layer. */
  pathIn(frame: Frame, id: string, from?: Design): { path: PenPath; box: Box; around: Box[] } | null
  /** The image fill a crop of a layer in a frame works on, or null when it has none to crop. */
  cropTarget(frame: Frame, id: string, from?: Design): CropTarget | null
  /**
   * Where layers that auto layout places or sizes are drawn, with everything inside them, as boxes
   * to store them at (`storedBoxes`), under their parent or under `into`, for a command that keeps
   * them there as a flow lets them go; none when no flow places or sizes them or what they go into.
   * A command's `drawn`: the boxes it stores.
   */
  drawnInFlow(ids: string[], into?: string): Record<string, Omit<Box, 'rotation'>> | undefined
  /**
   * The containers around layers, and around `into` when they move there, as drawn, seen from
   * under `into`; none when no flow places or sizes them or what they go into. A command's
   * `holders`, which it only reads: the turns that keep the layers in place, and the size a laid-out
   * box they leave with nothing in its flow keeps.
   */
  drawnHolders(ids: string[], into?: string): Record<string, Omit<Box, 'rotation'>> | undefined
  /**
   * The boxes to store layers at for them to be drawn at `boxes`, in their frame before their
   * containers turn them: the inverse of the renderer's shift, which draws a layer inside a group
   * or plain box a flow placed moved by as far as the flow moved that container from its stored
   * box. Each box holds only the values to store, and a container given its x or y is taken to be
   * drawn where it is given, so what it holds is mapped under that place; one a flow places is put
   * back in its slot as it draws, what it holds with it. `into` maps the outermost of them as under
   * another parent.
   */
  storedBoxes<B extends Partial<Box>>(boxes: ReadonlyMap<string, B>, into?: string): Map<string, B>
  /** Where to store a new layer's box, or its point, drawn at `box` under `parentId`, so it is drawn there, as `storedBoxes` stores layers. */
  storedNewBox<B extends Partial<Box>>(box: B, parentId: string): B
  /**
   * A layer's properties as drawn: its x, y, width and height where auto layout places and sizes it,
   * and a text's look as the brand text style bound to it gives it, which its stored look can lag.
   */
  drawnProps(id: string, from?: Design): Readonly<Record<string, unknown>>
  /** Whether every layer of a frame that two designs both hold is drawn in the same place, at the same size and turn, in each. */
  drawnAlike(frameId: string, before: Design, after: Design): boolean
  /** Where a new layer of a type that a tool makes in a frame goes: the group or box gone into, or the frame. */
  parentFor(frame: Frame, type: string, now: Design): string
  /**
   * The deepest layer a press, a click, a hover or a tap picks at a point of a frame: the one that
   * shows there, as `hitTest` tells it, with the selected layers counted as it counts them.
   */
  pickAt(frame: Frame, p: Point, options?: HitOptions): SceneLayer | null
  /**
   * Every layer that shows at a point of a frame, front-most first, each before the layers it holds
   * there, with how deep it is, locked ones too: the layers the pick at that point is made from.
   */
  layersAt(frame: Frame, p: Point): { id: string; depth: number }[]
  /**
   * The layer a press or a hover with the deep key (`deepKeyHeld`) reaches at a point of a frame:
   * the deepest that shows there, locked in place or in a group or box that is, as `wholeBox` counts
   * the text being typed in; null on none.
   */
  deepAt(frame: Frame, p: Point, wholeBox?: string): string | null
  /** The layer locked in place that a press at a point lands on, the one a click there would select; null when it is not locked. */
  lockedAt(frame: Frame, p: Point): string | null
  /** What a press on a layer picks: a selected layer it is in, what is directly in the group gone into, or else the top-level layer that holds it. */
  target(hitId: string, frame: string): string
  /** Whether a layer is inside the group or box gone into, not the container itself. */
  insideEntered(id: string): boolean
  /** A layer's box as it is drawn in a frame, in design pixels, without its turn; null when it has none. */
  drawnRect(frame: Frame, id: string): Rect | null
}

/** Whether a layer shows: it isn't hidden. */
export const visibleIn = (now: Design, id: string) => now.nodes[id]?.props.visible !== false
/** Whether a layer is locked in place, or sits in a group, box or boolean that is: a press selects it and a drag moves it not. */
export const lockedInPlace = (now: Design, id: string) => andHolders(now, id).some((one) => now.nodes[one]?.lock?.move)
/** Whether a layer is drawn: neither it nor what holds it is hidden. */
export const shownIn = (now: Design, id: string) => andHolders(now, id).every((one) => visibleIn(now, one))

export function editorBoxes({ session, scenes, resources, selection, drawn, frameOf, zoom }: BoxesDeps): EditorBoxes {
  const places = editorDrawnPlaces({ session, scenes })

  /**
   * A layer's box in its frame, read from the document. Hidden layers have one too, so they move
   * with a group and stay selected.
   */
  function boxIn(id: string, from: Design = session.design()): Box | null {
    const node = from.nodes[id]
    if (!node) return null
    // Auto layout places and sizes a layer as the scene is built: its box is the laid-out one.
    return (laidOut(id, from) ? places.laidOutBoxIn(id, from) : null) ?? storedBox(from, id)
  }

  /**
   * Where a new layer of `type` that a tool makes in a frame goes: into the group, box or boolean
   * double-clicked into if it can hold it, otherwise onto the frame itself.
   */
  function parentFor(frame: Frame, type: string, now: Design) {
    const entered = selection.entered()
    const inside = entered ? now.nodes[entered] : undefined
    return entered && inside && canHold(inside.type, type) ? entered : frame.id
  }
  /** The groups and boxes a layer is inside, outermost first, each as its position, size and turn in a frame. */
  function containersOf(frame: Frame, parentId: string | undefined, from: Design = session.design()): Box[] {
    const boxes: Box[] = []
    for (const up of ancestorsOf(from, parentId ?? '')) {
      const box = boxIn(up, from)
      if (box) boxes.unshift(box)
    }
    return boxes
  }
  /** A layer's box as it is drawn in a frame. */
  function drawnBoxOf(frame: Frame, id: string, from: Design = session.design()) {
    const box = boxIn(id, from)
    return box && drawnFrom(box, containersOf(frame, from.nodes[id]?.parentId, from))
  }
  /** Locked in place layers are left out where layers are gathered: select all and a marquee. */
  const pickable = (layer: SceneLayer) => !drawn().nodes[layer.id]?.lock?.move
  /** Whether the selection is locked in place: it shows no handles and a press can't move it. */
  const lockedSelection = () => idsOf(selection.current()).some((id) => drawn().nodes[id]?.lock?.move)
  /**
   * The handles the selection has, on the first one's frame where it spans several, a resize there
   * changing every copy alike: none while it is locked in place; one text that grows with its words
   * has no top or bottom ones, since only a fixed box has a height of its own.
   */
  function handlesFor(): readonly Handle[] {
    const current = selection.current()
    const frame = frameOf(firstFrameOf(current))
    if (!current || !frame || lockedSelection()) return []
    // The first frame's layers: its box shows the handles, and each copy is resized as they are.
    const ids = current.filter((layer) => layer.frameId === frame.id).map((layer) => layer.id)
    const [only] = ids
    if (
      ids.length === 1 &&
      only &&
      drawn().nodes[only]?.type === 'text' &&
      propIn(only, 'boxMode', drawn()) !== 'fixed'
    )
      return HANDLES.filter((h) => h !== 'n' && h !== 's')
    return HANDLES
  }

  function selectedLine() {
    const current = selection.current()
    const frameId = firstFrameOf(current)
    const ids = (current ?? []).filter((layer) => layer.frameId === frameId).map((layer) => layer.id)
    const [id] = ids
    const node = id === undefined ? undefined : drawn().nodes[id]
    if (ids.length !== 1 || !id || node?.type !== 'graphic' || node.props.shape.kind !== 'line') return null
    return { ends: current?.length === 1 && !placedByFlow(drawn(), id), props: node.props }
  }

  /** Selected layers that aren't inside another selected layer: the ones a transform moves. */
  function roots(from: Design = session.design()) {
    const ids = idsOf(selection.current())
    const inside = (id: string) => ancestorsOf(from, from.nodes[id]?.parentId ?? '').some((up) => ids.includes(up))
    return ids.filter((id) => from.nodes[id] && !inside(id))
  }
  function rootsByFrame(from: Design = session.design()) {
    const all = roots(from)
    return byFrame(selection.current()).flatMap(({ frameId, ids }) => {
      const frame = frameOf(frameId)
      const inFrame = ids.filter((id) => all.includes(id))
      return frame && isNonEmpty(inFrame) ? [{ frame, ids: inFrame }] : []
    })
  }
  /**
   * The boxes a transform changes: each root and every layer under it, as they are now. A layer
   * auto layout places inside a root is left out: its box puts it where it goes.
   */
  function startBoxes(frame: Frame, ids: string[]) {
    const now = session.design()
    const boxes = new Map<string, Box>()
    const add = (id: string, root: string) => {
      if (id !== root && placedInside(id, root, now)) return
      const box = boxIn(id, now)
      if (box) boxes.set(id, box)
      for (const [child] of childrenOf(now, id)) add(child, root)
    }
    for (const id of ids) add(id, id)
    return boxes
  }
  /** The boxes a move of layers changes, each layer and what it holds moved by its step as its containers turn it. */
  function movedBoxes(frame: Frame, ids: string[], stepOf: (id: string) => Point) {
    const now = session.design()
    const moved = new Map<string, Box>()
    for (const id of ids) {
      const step = localStep(stepOf(id), containersOf(frame, now.nodes[id]?.parentId, now))
      for (const [inner, b] of startBoxes(frame, [id]))
        moved.set(inner, { ...b, x: round(b.x + step.x), y: round(b.y + step.y) })
    }
    return moved
  }
  /** The box the handles go on, with where it is drawn and its containers. */
  function selectionBox(): SelectionBox | null {
    return selectionBoxes()[0] ?? null
  }
  function selectionBoxes(): SelectionBox[] {
    const now = session.design()
    return byFrame(selection.current()).flatMap(({ frameId, ids }) => {
      const frame = frameOf(frameId)
      const boxes = frame ? ids.map((id) => boxIn(id, now)).filter((b): b is Box => b !== null) : []
      if (!frame || boxes.length === 0) return []
      const box = boxes.length === 1 ? (boxes[0] as Box) : boundsOf(boxes)
      const around = containersOf(frame, now.nodes[ids[0] ?? '']?.parentId, now)
      return [{ frame, box, drawn: drawnFrom(box, around), around }]
    })
  }

  /**
   * What a drag of layers in a frame can snap to, in the space the containers `around` them give,
   * that of the first one's parent: the layers beside them that show in it, and its box as they
   * leave it (`boxWithout`): a group's or a boolean's as it fits the layers left in it, a laid-out
   * box's with no lines along an axis it fits the ones it places on. With no
   * container around them turned, the frame and its other top-level layers as drawn as well;
   * inside a turned one, those run along no side of its space. Layers not all in one parent, or in
   * one whose containers are not `around`, snap to nothing, unless no container around any of them
   * is turned.
   */
  function snapBoxes(frame: Frame, ids: string[], around: Box[]): SnapBoxes | null {
    const now = session.design()
    const parents = [...new Set(ids.map((id) => now.nodes[id]?.parentId))]
    const spaces = parents.map((parent) => containersOf(frame, parent, now))
    const upright = [around, ...spaces].every(uprightOnPage)
    if (!upright && (parents.length !== 1 || !sameBoxes(spaces[0] ?? [], around))) return null
    const holds = (id: string) => ids.some((selected) => ancestorsOf(now, selected).includes(id))
    const beside: Rect[] = upright
      ? scenes
          .scene(frame)
          .layers.filter((layer) => !holds(layer.id))
          .map((layer) => boundsOf([layer.props]))
      : []
    const within: WithinBox[] = []
    const parent = parents[0] ?? frame.id
    if (now.nodes[parent]) {
      for (const [id] of childrenOf(now, parent)) {
        const sibling = !ids.includes(id) && visibleIn(now, id) && boxIn(id, now)
        if (sibling) beside.push(boundsOf([sibling]))
      }
      const left = boxWithout(now, parent, (id) => boxIn(id, now), ids)
      if (left) {
        const { box, follows } = left
        within.push({ x: box.x, y: box.y, width: box.width, height: box.height, follows })
      }
    }
    if (upright) within.push({ x: 0, y: 0, width: frame.width, height: frame.height })
    const guides = upright
      ? guidesShown(now, frame).map(({ axis, at }) => ({
          axis,
          at,
          from: 0,
          to: axis === 'x' ? frame.height : frame.width,
        }))
      : []
    return { parent, beside, within, guides }
  }

  /**
   * A path layer's path in one frame, in the coordinates of its parent before the layer turns it
   * (#45), with its box and what turns it: its containers, then the layer itself.
   */
  function pathIn(frame: Frame, id: string, from: Design = session.design()) {
    const node = from.nodes[id]
    const box = boxIn(id, from)
    if (node?.type !== 'graphic' || !box) return null
    const { shape } = node.props
    if (shape.kind !== 'path') return null
    try {
      // As it is drawn: scaled from the box it was drawn in to this one, and mirrored as the layer
      // is flipped. A box squashed flat on an axis keeps the data's length there, so editing it
      // never loses the points.
      const scale = pathScale(shape, box.width, box.height)
      const sx = scale.sx || 1
      const sy = scale.sy || 1
      return {
        path: flipPath(offsetPath(scalePath(parsePath(shape.d), sx, sy), box.x, box.y), {
          ...box,
          ...flipsOf(node.props),
        }),
        box,
        around: [...containersOf(frame, node.parentId, from), box],
      }
    } catch {
      return null
    }
  }
  /**
   * The image fill a crop works on (#48): the topmost of a layer's fills in a frame, with where the
   * whole image sits as the crop starts (`cropStart`: where the layer draws it, a tile where fill
   * draws it), the image and its size, and the layer's box with its containers, the box last.
   */
  function cropTarget(frame: Frame, id: string, from: Design = session.design()): CropTarget | null {
    const node = from.nodes[id]
    const box = boxIn(id, from)
    if (!node || !box || !('fills' in node.props)) return null
    const { fills } = node.props as { fills: Paint[] }
    const index = fills.findLastIndex((f) => f.type === 'image')
    const fill = fills[index]
    const image = fill?.type === 'image' ? resources.resources().images.get(fill.assetId) : undefined
    if (fill?.type !== 'image' || !image) return null
    // A display copy is placed by its image's own size, which crops are in.
    const size = imageSizeOf(resources.resources(), fill.assetId, image)
    const flips = flipsOf(node.props)
    return {
      fills,
      index,
      fill,
      image,
      size,
      box,
      rect: flippedRect(cropStart(size, fill, box), { ...box, ...flips }),
      around: [...containersOf(frame, node.parentId, from), box],
      flips,
    }
  }
  /**
   * Whether every layer of a frame that two designs both hold is drawn in the same place, at the
   * same size and turn, in each, within what rounding to hundredths leaves.
   */
  function drawnAlike(frameId: string, before: Design, after: Design) {
    const now = drawnLayers(frameId, after)
    return [...drawnLayers(frameId, before)].every(([id, was]) => {
      const is = now.get(id)
      return (
        !is ||
        ((['x', 'y', 'width', 'height'] as const).every((k) => Math.abs(is[k] - was[k]) < 0.05) &&
          Math.abs(normalAngle(is.rotation - was.rotation)) < 0.05)
      )
    })
  }
  /** Where each layer of a frame is drawn in a design, turned with the containers around it. */
  function drawnLayers(frameId: string, from: Design) {
    const boxes = new Map<string, Box>()
    const walk = (layers: SceneLayer[], around: Box[]) => {
      for (const l of layers) {
        const box = boxOfLayer(l)
        boxes.set(l.id, drawnFrom(box, around))
        walk(l.children, [...around, box])
      }
    }
    walk(scenes.laidOut(frameId, from), [])
    return boxes
  }
  /** Whether a point in a frame is inside a layer as it is drawn there. */
  function drawnContains(frame: Frame, id: string, p: Point, from: Design) {
    const box = drawnBoxOf(frame, id, from)
    return box !== null && holdsPoint(box, p)
  }

  /**
   * The locked in place layer a press at `p` lands on, the one a click would select: the topmost
   * layer there, as a click picks it, when that one is locked. A click selects it, so its lock can
   * be undone; a drag from it draws a marquee and moves nothing, it or what lies beneath.
   */
  function pickAt(frame: Frame, p: Point, options: HitOptions = {}) {
    return scenes.hit(frame, p, { ...options, selected: idsOf(selection.current()), zoom: zoom() })
  }
  function layersAt(frame: Frame, p: Point) {
    return scenes.under(frame, p, { zoom: zoom() }).map(({ layer, depth }) => ({ id: layer.id, depth }))
  }
  function deepAt(frame: Frame, p: Point, wholeBox?: string) {
    return pickAt(frame, p, { wholeBox })?.id ?? null
  }
  function lockedAt(frame: Frame, p: Point): string | null {
    const top = pickAt(frame, p)
    const id = top ? target(top.id, frame.id) : null
    return id && drawn().nodes[id]?.lock?.move ? id : null
  }
  /**
   * What a press on a layer picks: a selected layer it is in, so the selection moves whole; inside
   * the group or box double-clicked into, what is directly in it; or else the top-level layer that
   * holds it, so a click on a group's child picks the group.
   */
  function target(hitId: string, frame: string) {
    const chain = ancestorsOf(drawn(), hitId)
    const inFrame = (selection.current() ?? []).filter((layer) => layer.frameId === frame).map((layer) => layer.id)
    const selected = chain.find((id) => inFrame.includes(id))
    const entered = selection.entered()
    const at = entered ? chain.indexOf(entered) : -1
    return selected ?? (at > 0 ? chain[at - 1] : chain.at(-1)) ?? hitId
  }
  /** Whether a layer is inside the entered group or box, not the container itself. */
  function insideEntered(id: string) {
    return ancestorsOf(drawn(), drawn().nodes[id]?.parentId ?? '').some((up) => up === selection.entered())
  }

  function drawnRect(frame: Frame, id: string): Rect | null {
    const box = drawnBoxOf(frame, id)
    return box && { x: box.x, y: box.y, width: box.width, height: box.height }
  }

  /** A layer's props as drawn: placed by auto layout, and in the look of the text style bound to it. */
  function drawnProps(id: string, from: Design = session.design()) {
    const props = places.drawnProps(id, from)
    const ref = from.nodes[id]?.bindings?.textStyle
    const look = ref === undefined ? undefined : resources.bytes().variables?.[ref]
    return look !== undefined && fitsProperty('textStyle', look) ? bindableEntry('textStyle').write(props, look) : props
  }

  return {
    boxIn,
    containersOf,
    drawnBoxOf,
    drawnContains,
    startBoxes,
    movedBoxes,
    selectionBox,
    selectionBoxes,
    roots,
    rootsByFrame,
    pickable,
    lockedSelection,
    handlesFor,
    selectedLine,
    snapBoxes,
    pathIn,
    cropTarget,
    drawnInFlow: places.drawnInFlow,
    drawnHolders: places.drawnHolders,
    storedBoxes: places.storedBoxes,
    storedNewBox: places.storedNewBox,
    drawnProps,
    drawnAlike,
    parentFor,
    pickAt,
    layersAt,
    deepAt,
    lockedAt,
    target,
    insideEntered,
    drawnRect,
  }
}

/** A layer and the groups, boxes and booleans that hold it, innermost first. */
function andHolders(now: Design, id: string) {
  return [id, ...ancestorsOf(now, now.nodes[id]?.parentId ?? '')]
}

/** Whether two lists of boxes are the same boxes in the same order. */
function sameBoxes(a: readonly Box[], b: readonly Box[]) {
  const keys = ['x', 'y', 'width', 'height', 'rotation'] as const
  return a.length === b.length && a.every((box, i) => keys.every((k) => box[k] === b[i]?.[k]))
}
