// The overlay over the stage: the sections' titles, the frame labels, the safe zones, the picked frame with its handles,
// the frame lit from outside the stage, the guides, the dashed outlines of the hidden layers while
// they are shown, the outlines of the group gone into, the hovered layer and the drop target, the
// other people's selections, the dashed outlines of the selected layers' linked copies, what Alt
// measures, the selection with its handles and size, the selected layers' constraint lines while
// the page asks for them, what each gesture shows, the dots a connector starts from with the Arrow
// shape and the connector being drawn, the rulers, the caret, the other people's
// cursors and the loupe picking a colour shows, drawn in that order. A selected or hovered layer
// is outlined along its real shape, from the outline path data the scenes keep.
import { constraintsApply, constraintsOf, copiesOf, frameIdOf, scaleText } from '@dazbee/doc'
import type { Rect } from '@dazbee/schema'

import { byFrame } from '../across-frames.ts'
import type { EditorColourPick } from '../gestures/colour-pick.ts'
import { loupeParts } from '../gestures/colour-pick-parts.ts'
import type { EditorCropping } from '../gestures/crop/cropping.ts'
import { cropParts } from '../gestures/crop/cropping-parts.ts'
import type { EditorConnecting } from '../gestures/drawing/connecting.ts'
import { type EditorDrawing, isDrawing } from '../gestures/drawing/drawing.ts'
import { drawingParts } from '../gestures/drawing/drawing-parts.ts'
import type { EditorGuideDrag } from '../gestures/guides/guide-drag.ts'
import { guideParts } from '../gestures/guides/guide-parts.ts'
import { drawnHandles, grabbedHandles, screenCorners } from '../gestures/hit-zones.ts'
import type { EditorPen } from '../gestures/pen/pen.ts'
import { pathParts } from '../gestures/pen/pen-parts.ts'
import type { EditorPointer } from '../gestures/pointer.ts'
import type { EditorAutoLayoutDrag } from '../gestures/select/auto-layout-drag.ts'
import { flowParts } from '../gestures/select/auto-layout-drag-parts.ts'
import { dragParts } from '../gestures/select/drag-parts.ts'
import type { EditorFrameMove } from '../gestures/select/frame-move.ts'
import type { EditorFrameResize } from '../gestures/select/frame-resize.ts'
import { radiusDotParts, type RadiusPillParts, radiusPillParts } from '../gestures/select/radius-drag-parts.ts'
import type { EditorTransformDrag } from '../gestures/select/transform-drag.ts'
import type { EditorBoxes } from '../layers/boxes.ts'
import { boundsOf, type Box, type Handle, handleAt, HANDLES, round } from '../layers/transform.ts'
import type { EditorPlace } from '../place.ts'
import type { EditorPresence } from '../presence.ts'
import { type EditorSelection, firstFrameOf, idsOf } from '../selection.ts'
import type { EditorTyping } from '../text/typing.ts'
import { textParts } from '../text/typing-parts.ts'
import { toScreen } from './camera.ts'
import { connectorParts } from './connector-parts.ts'
import { type Constrained, constraintParts } from './constraint-parts.ts'
import { frameLabel } from './frame-labels.ts'
import { type Frame, labelBox } from './frames.ts'
import { measureParts } from './measure-parts.ts'
import { presenceParts } from './presence-parts.ts'
import { px, rulerParts } from './rulers.ts'
import { safeZoneParts } from './safe-zone-parts.ts'
import { type FrameScenes, hiddenLayersIn } from './scenes.ts'
import { sectionTitleParts } from './section-parts.ts'
import type { EditorView } from './view.ts'

export interface OverlayDeps {
  /** The element laid over the canvas that holds what the overlay draws. */
  overlay: HTMLElement
  view: Pick<
    EditorView,
    'camera' | 'viewport' | 'insets' | 'design' | 'inView' | 'frameOf' | 'rulers' | 'safeZones' | 'hiddenShown'
  >
  selection: Pick<
    EditorSelection,
    | 'current'
    | 'entered'
    | 'hovered'
    | 'pickedFrame'
    | 'litFrame'
    | 'litLayer'
    | 'renamingFrame'
    | 'pickedSection'
    | 'renamingSection'
    | 'cropping'
    | 'pathEditing'
    | 'constraintsShown'
  >
  boxes: Pick<
    EditorBoxes,
    'selectionBox' | 'selectionBoxes' | 'drawnBoxOf' | 'boxIn' | 'containersOf' | 'handlesFor' | 'selectedLine'
  >
  scenes: Pick<FrameScenes, 'outlinePath' | 'shownScene'>
  typing: Pick<EditorTyping, 'editing' | 'shown'>
  pen: Pick<EditorPen, 'shown'>
  cropping: Pick<EditorCropping, 'shown'>
  drawing: Pick<EditorDrawing, 'shown'>
  /** The dots a connector starts from, and the connector being drawn. */
  connecting: Pick<EditorConnecting, 'shown'>
  transformDrag: Pick<EditorTransformDrag, 'shown' | 'shownDots'>
  autoLayoutDrag: Pick<EditorAutoLayoutDrag, 'shown' | 'shownDrop'>
  /** The frame that shows handles: the picked frame, when a press on them would resize it. */
  frameResize: Pick<EditorFrameResize, 'handled'>
  place: Pick<EditorPlace, 'dropTarget'>
  /** The sections as the stage shows them, whose titles it draws. */
  frameMove: Pick<EditorFrameMove, 'shownSections'>
  pointer: Pick<EditorPointer, 'gesture' | 'measured' | 'pointerAt'>
  colourPick: Pick<EditorColourPick, 'shown'>
  guideDrag: Pick<EditorGuideDrag, 'shown' | 'rulerFrame'>
  presence: Pick<EditorPresence, 'shown'>
}

export interface EditorOverlay {
  /** Draws the overlay from what each module shows now. It listens for what is shown changing, and draws then. */
  draw(): void
  /**
   * Where the selection is drawn on the stage, in pixels from the stage's top start corner: the
   * upright box round it, turned or not, and its size label under or over it. Null with nothing
   * selected.
   */
  selectionRect(): Rect | null
  /** Where a frame of the shown page has its label on the stage, as last drawn; null for one off the stage at its start. */
  labelRect(frameId: string): Rect | null
}

/** Where something spans across the stage, in pixels from its left. */
type Span = { left: number; right: number }

/** Room the tool dock takes along the bottom of the stage, which the size label stays out of. */
const SIZE_CLEARANCE = 72
/** The room the selection's size label takes, in screen pixels. */
const SIZE_LABEL_HEIGHT = 20
const SVG = 'http://www.w3.org/2000/svg'
/** Pixels the size label keeps from a frame's label it moves off. */
const LABEL_GAP = 4
/** Screen pixels the selection's size label keeps inside the stage's sides. */
const SIZE_LABEL_INSET = 8

export function editorOverlay({
  overlay,
  view,
  selection,
  boxes,
  scenes,
  typing,
  pen,
  cropping,
  drawing,
  connecting,
  transformDrag,
  autoLayoutDrag,
  frameResize,
  place,
  frameMove,
  pointer,
  colourPick,
  guideDrag,
  presence,
}: OverlayDeps): EditorOverlay {
  const { frameOf } = view

  /** A design-pixel box in a frame, as CSS on the overlay. */
  function placeBox(el: HTMLElement, frame: Frame, box: Rect) {
    const camera = view.camera()
    const at = toScreen(camera, { x: frame.x + box.x, y: frame.y + box.y })
    Object.assign(el.style, {
      left: px(at.x),
      top: px(at.y),
      width: px(box.width * camera.zoom),
      height: px(box.height * camera.zoom),
    })
  }
  /** A box on the overlay, turned as the layer is. */
  function outline(className: string, frame: Frame, box: Box) {
    const el = document.createElement('div')
    el.className = className
    placeBox(el, frame, box)
    if (box.rotation) el.style.transform = `rotate(${box.rotation}deg)`
    return el
  }

  function selectionRect(): Rect | null {
    const outer = boxes.selectionBox()
    if (!outer) return null
    const { frame, drawn } = outer
    const corners = screenCorners(drawn, frame, view.camera())
    const xs = corners.map((c) => c.x)
    const ys = corners.map((c) => c.y)
    if (!typing.editing()) {
      const label = sizeLabelTop(ys)
      ys.push(label, label + SIZE_LABEL_HEIGHT)
    }
    return {
      x: Math.min(...xs),
      y: Math.min(...ys),
      width: Math.max(...xs) - Math.min(...xs),
      height: Math.max(...ys) - Math.min(...ys),
    }
  }

  function labelRect(frameId: string) {
    const frame = frameOf(frameId)
    return frame ? labelBox(frame, view.camera()) : null
  }

  /**
   * Where the size label's top goes for a box spanning `ys` on screen: under it, else over it when
   * the chrome along the stage's bottom (the dock, at least SIZE_CLEARANCE) would cover it, else
   * at the bottom of the room between the chrome, over the box, when the box is taller than the
   * stage; always clear of the chrome along the top and bottom while some of the box is on the
   * stage. A box wholly above or below the stage takes the label off the stage with it.
   */
  function sizeLabelTop(ys: number[]) {
    const top = Math.min(...ys)
    const bottom = Math.max(...ys)
    const { height } = view.viewport()
    const below = bottom + 8
    const above = top - 26
    if (bottom <= 0) return Math.min(below, -SIZE_LABEL_HEIGHT)
    if (top >= height) return Math.max(above, height)
    const { floor, ceiling } = sizeLabelRoom()
    if (below <= floor) return Math.max(below, ceiling)
    if (above >= ceiling) return Math.max(ceiling, Math.min(above, floor))
    return Math.max(ceiling, floor)
  }

  /** A dashed outline round each linked copy of the selected layers in the frames in view, unless it is selected too. */
  function linkedParts() {
    const current = selection.current()
    if (!current) return []
    const design = view.design()
    const shown = view.inView()
    const parts: HTMLElement[] = []
    const ids = idsOf(current)
    const outlined = new Set(ids)
    for (const id of ids) {
      for (const copy of copiesOf(design, id)) {
        // Each copy once, though several selected layers share its link id.
        if (outlined.has(copy)) continue
        outlined.add(copy)
        const frameId = frameIdOf(design, copy)
        const frame = shown.find((f) => f.id === frameId)
        const box = frame && boxes.drawnBoxOf(frame, copy, design)
        if (!frame || !box) continue
        const el = outline('linked-copy', frame, box)
        el.dataset.layer = copy
        el.dataset.frame = frame.id
        parts.push(el)
      }
    }
    return parts
  }

  /** A dashed outline round each hidden layer the frames in view draw, along its real shape, while hidden layers are shown. */
  function hiddenParts() {
    if (!view.hiddenShown()) return []
    const design = view.design()
    return view.inView().flatMap((frame) =>
      hiddenLayersIn(scenes.shownScene(frame).layers).flatMap((id) => {
        const box = boxes.drawnBoxOf(frame, id, design)
        if (!box) return []
        const el = shapeOutline('hidden-layer', frame, id, box)
        el.dataset.layer = id
        el.dataset.frame = frame.id
        return [el]
      }),
    )
  }

  /**
   * Each selected layer's outline, then the box with its handles and the size under it in the first
   * selected layer's frame, with the selection's span across the stage, which the size is placed by.
   * The selected layers of other frames get a box of their own, with no handles or size. While the
   * selection is moved, its handles and size are left off. Its radius dots go in its box too, and
   * while one is dragged, the pill with the radius beside the pointer.
   */
  function selectionParts(): {
    parts: HTMLElement[]
    size: { el: HTMLElement; span: Span } | null
    radius: RadiusPillParts
  } {
    const gesture = pointer.gesture()
    const [outer, ...across] = boxes.selectionBoxes()
    const current = selection.current()
    let radius = radiusPillParts(null)
    if (!outer || !current) return { parts: [], size: null, radius }
    const { frame } = outer
    const inFrame = (frameId: string) => byFrame(current).find((part) => part.frameId === frameId)?.ids ?? []
    const ids = inFrame(frame.id)
    // While an input method composes, the text typed into is outlined round the box its composition draws.
    const editing = typing.editing()
    const composing = editing?.frameId === frame.id && ids.length === 1 && ids[0] === editing.id
    const box = (composing && typing.shown()?.box) || outer.drawn
    const parts: HTMLElement[] = []
    const several = current.length > 1
    if (several) {
      for (const layer of current) {
        const shown = layer.frameId === frame.id ? frame : across.find((b) => b.frame.id === layer.frameId)?.frame
        const b = shown && boxes.drawnBoxOf(shown, layer.id, view.design())
        if (!shown || !b) continue
        const member = shapeOutline('selection-member', shown, layer.id, b)
        member.dataset.layer = layer.id
        member.dataset.frame = shown.id
        parts.push(member)
      }
    }
    for (const other of across) {
      const copy = outline('selection-copy', other.frame, other.drawn)
      copy.dataset.frame = other.frame.id
      copy.dataset.count = String(inFrame(other.frame.id).length)
      parts.push(copy)
    }
    const el =
      ids.length === 1 && ids[0] ? shapeOutline('selection', frame, ids[0], box) : outline('selection', frame, box)
    el.dataset.frame = frame.id
    el.dataset.count = String(ids.length)
    if (ids.length === 1) el.dataset.layer = ids[0]
    const corners = screenCorners(box, frame, view.camera())
    const line = boxes.selectedLine()
    const moving = (gesture?.kind === 'move' || gesture?.kind === 'reorder') && gesture.moved
    if (!typing.editing()) {
      // The corners and edges a press resizes from, or a line's ends, drawn or not.
      const handles = boxes.handlesFor()
      el.dataset.handles = grabbedHandles(corners, handles, line?.ends).join(' ')
      if (!moving) el.append(...handleParts(drawnHandles(corners, handles, line?.ends), line?.ends ?? false))
      // The radius dots the transform drag shows, inside its box so they turn with it; the pill
      // beside the pointer, upright on the stage.
      const dots = transformDrag.shownDots(gesture)
      el.append(...radiusDotParts(dots.dots))
      if (pointer.pointerAt()) radius = radiusPillParts(dots.label)
    }
    parts.push(el)
    if (typing.editing() || moving) return { parts, size: null, radius }
    const size = document.createElement('div')
    size.className = 'selection-size'
    size.textContent = line ? round(box.width, 0).toString() : `${round(box.width, 0)} × ${round(box.height, 0)}`
    // A corner scaling one text says its size too, from where it was.
    const g = gesture?.kind === 'resize' ? gesture : null
    const text = g && !several ? g.texts.get(ids[0] ?? '') : undefined
    if (g && text) size.textContent += ` · ${text.style.fontSize} → ${scaleText(text, g.factor).style.fontSize}`
    size.style.top = px(sizeLabelTop(corners.map((c) => c.y)))
    parts.push(size)
    const xs = corners.map((c) => c.x)
    return { parts, size: { el: size, span: { left: Math.min(...xs), right: Math.max(...xs) } }, radius }
  }

  /**
   * The constraint lines of each selected layer while the page asks for them, only when the rule
   * reads constraints for every one of them, as Arrange shows them only then.
   */
  function constraintLines() {
    const current = selection.current()
    const design = view.design()
    if (!selection.constraintsShown() || !current?.every((layer) => constraintsApply(design, layer.id))) return []
    const layers = current.flatMap((layer): Constrained[] => {
      const frame = frameOf(layer.frameId)
      const node = design.nodes[layer.id]
      const box = frame && boxes.boxIn(layer.id, design)
      if (!frame || !node || !box) return []
      const parent =
        node.parentId === frame.id
          ? { x: 0, y: 0, width: frame.width, height: frame.height }
          : boxes.boxIn(node.parentId, design)
      if (!parent) return []
      const around = boxes.containersOf(frame, node.parentId, design)
      return [{ id: layer.id, frame, box, parent, around, constraints: constraintsOf(node) }]
    })
    return constraintParts(layers, view.camera().zoom, outline)
  }

  /** The selection's handles drawn, at their places on its box: a line's ends round. */
  function handleParts(drawn: readonly Handle[], ends: boolean): HTMLElement[] {
    return drawn.map((h) => {
      const handle = document.createElement('div')
      handle.className = 'handle'
      handle.dataset.handle = h
      if (ends) handle.dataset.end = ''
      const at = handleAt(h)
      Object.assign(handle.style, { left: `${at.x * 100}%`, top: `${at.y * 100}%` })
      return handle
    })
  }

  /**
   * A layer's outline on the overlay: its box, turned as the layer is, holding one SVG path along
   * its real shape when the layer's outline is other than its box.
   */
  function shapeOutline(className: string, frame: Frame, id: string, box: Box) {
    const el = outline(className, frame, box)
    const path = scenes.outlinePath(frame, id)
    if (!path) return el
    const { x, y, width, height } = path.box
    const svg = document.createElementNS(SVG, 'svg')
    svg.setAttribute('class', 'outline-path')
    svg.setAttribute('viewBox', `${x} ${y} ${width} ${height}`)
    svg.setAttribute('preserveAspectRatio', 'none')
    const shape = document.createElementNS(SVG, 'path')
    shape.setAttribute('d', path.d)
    shape.setAttribute('vector-effect', 'non-scaling-stroke')
    svg.append(shape)
    el.append(svg)
    el.dataset.shape = ''
    return el
  }

  /**
   * The part of the stage the chrome along its sides leaves clear, SIZE_LABEL_INSET in from each
   * side and at least SIZE_CLEARANCE up from the bottom, where the dock sits: where the size label
   * and the radius pill go.
   */
  function clearOfChrome(): Rect {
    const { width, height } = view.viewport()
    const chrome = view.insets()
    const x = Math.max(SIZE_LABEL_INSET, chrome.left)
    const y = Math.max(SIZE_LABEL_INSET, chrome.top)
    return {
      x,
      y,
      width: width - Math.max(SIZE_LABEL_INSET, chrome.right) - x,
      height: height - Math.max(SIZE_CLEARANCE, chrome.bottom) - y,
    }
  }
  /** The highest and lowest top the size label takes on the stage, clear of the chrome along its top and bottom. */
  function sizeLabelRoom() {
    const clear = clearOfChrome()
    return { floor: clear.y + clear.height - 24, ceiling: clear.y }
  }

  /**
   * Puts the size label centred under the selection's span across the stage, kept SIZE_LABEL_INSET
   * inside the stage's sides and clear of the chrome along them, at the left when there is no room
   * for both, then off every frame's label: above the one it would cover while there is room, else
   * below it. A selection wholly off the stage takes it wholly off the stage with it. Measured once
   * it is drawn.
   */
  function placeSizeLabel(size: HTMLElement, span: Span) {
    const width = size.offsetWidth
    const room = view.viewport().width
    const clear = clearOfChrome()
    const centred = (span.left + span.right) / 2 - width / 2
    const low = clear.x
    const high = clear.x + clear.width - width
    if (span.right <= 0) size.style.left = px(Math.min(centred, -width))
    else if (span.left >= room) size.style.left = px(Math.max(centred, room))
    else size.style.left = px(Math.max(low, Math.min(centred, high)))
    const labels = view.inView().flatMap((frame) => labelBox(frame, view.camera()) ?? [])
    const { floor, ceiling } = sizeLabelRoom()
    const left = Number.parseFloat(size.style.left)
    for (let tries = 0; tries < labels.length; tries++) {
      const top = Number.parseFloat(size.style.top)
      const under = labels.find(
        (box) =>
          left < box.x + box.width &&
          box.x < left + width &&
          top < box.y + box.height &&
          box.y < top + SIZE_LABEL_HEIGHT,
      )
      if (!under) return
      const above = under.y - SIZE_LABEL_HEIGHT - LABEL_GAP
      size.style.top = px(above >= ceiling ? above : Math.min(floor, under.y + under.height + LABEL_GAP))
    }
  }

  /** Where an element placed on the overlay is, as its style and laid-out size give it. */
  function placedBox(el: HTMLElement): Rect {
    const { left, top } = el.style
    return { x: Number.parseFloat(left), y: Number.parseFloat(top), width: el.offsetWidth, height: el.offsetHeight }
  }

  function drawOverlay() {
    const gesture = pointer.gesture()
    const parts: Element[] = sectionTitleParts(frameMove.shownSections(gesture), {
      picked: selection.pickedSection(),
      renaming: selection.renamingSection(),
      stage: view.viewport(),
    })
    for (const frame of view.inView()) {
      const label = frameLabel(frame, { selection, typing, camera: view.camera() })
      if (label) parts.push(label)
    }
    const safeZones = view.safeZones()
    if (safeZones) parts.push(...safeZoneParts(view.inView(), placeBox, safeZones))
    const picked = view.inView().find((frame) => frame.id === selection.pickedFrame())
    if (picked) {
      const box = { x: 0, y: 0, width: picked.width, height: picked.height, rotation: 0 }
      const el = outline('frame-picked', picked, box)
      el.dataset.frame = picked.id
      if (frameResize.handled()?.id === picked.id) {
        // Its corners and edges a press resizes from, its corners drawn as a selection's are.
        const corners = screenCorners(box, picked, view.camera())
        el.dataset.handles = grabbedHandles(corners, HANDLES).join(' ')
        el.append(...handleParts(drawnHandles(corners, HANDLES), false))
      }
      parts.push(el)
    }
    // Lit as a layer under the pointer is, round the whole frame; so is the frame a move would drop its layers into.
    const target = gesture?.kind === 'move' || gesture?.kind === 'reorder' ? gesture.target?.id : undefined
    const lit = view.inView().find((frame) => frame.id === (target ?? selection.litFrame()))
    if (lit) {
      const el = outline('frame-lit', lit, { x: 0, y: 0, width: lit.width, height: lit.height, rotation: 0 })
      el.dataset.frame = lit.id
      parts.push(el)
    }
    const guideGesture = gesture?.kind === 'guide' ? gesture : null
    parts.push(...guideParts(guideDrag.shown(guideGesture), view.camera()))
    parts.push(...hiddenParts())
    const entered = selection.entered()
    const enteredFrame = entered && frameOf(firstFrameOf(selection.current()))
    const enteredBox = enteredFrame && entered && boxes.drawnBoxOf(enteredFrame, entered, view.design())
    if (enteredFrame && enteredBox) parts.push(outline('entered', enteredFrame, enteredBox))
    // The layer under the pointer, else the one lit from outside the stage.
    const hovered = selection.hovered() ?? selection.litLayer()
    // While Alt measures, the measured box is outlined in its place.
    const measured = measureParts(pointer.measured(), view.camera(), outline)
    const hover =
      !gesture && measured.lines.length === 0 && hovered && !idsOf(selection.current()).includes(hovered.id)
        ? hovered
        : null
    const hoverFrame = hover && frameOf(hover.frameId)
    const hoverBox = hoverFrame && hover && boxes.drawnBoxOf(hoverFrame, hover.id, view.design())
    if (hoverFrame && hover && hoverBox) parts.push(shapeOutline('hover', hoverFrame, hover.id, hoverBox))
    // The layer an image dragged over the stage would go into.
    const dropTarget = place.dropTarget()
    const dropFrame = dropTarget && frameOf(dropTarget.frameId)
    const dropBox = dropFrame && dropTarget && boxes.drawnBoxOf(dropFrame, dropTarget.id, view.design())
    if (dropFrame && dropBox) parts.push(outline('drop-target', dropFrame, dropBox))
    const others = presenceParts(
      presence.shown(),
      (frame, id) => {
        const box = boxes.drawnBoxOf(frame, id, view.design())
        return box ? shapeOutline('presence-layer', frame, id, box) : null
      },
      (frame) =>
        outline('presence-frame', frame, { x: 0, y: 0, width: frame.width, height: frame.height, rotation: 0 }),
      view.viewport().width,
    )
    parts.push(...others.outlines)
    const selected = selection.pathEditing() || selection.cropping() ? null : selectionParts()
    parts.push(
      ...linkedParts(),
      ...measured.lines,
      ...(selected?.parts ?? []),
      ...(selected ? constraintLines() : []),
      ...measured.pills,
      ...(selected?.radius.pills ?? []),
      ...pathParts(pen.shown(), view.camera()),
      ...cropParts(cropping.shown(), outline),
      ...flowParts(autoLayoutDrag.shown(gesture?.kind === 'reorder' ? gesture : null), outline),
      ...flowParts(
        gesture?.kind === 'move' ? autoLayoutDrag.shownDrop(gesture.target ?? gesture.frame, gesture.drop) : [],
        outline,
      ),
    )
    if (isDrawing(gesture)) parts.push(...drawingParts(drawing.shown(gesture), view.camera(), placeBox))
    parts.push(
      ...dragParts(gesture?.kind === 'marquee' ? gesture : null, transformDrag.shown(), view.camera(), outline),
      ...connectorParts(connecting.shown(gesture)),
    )
    if (view.rulers()) {
      const origin = guideDrag.rulerFrame(guideGesture)
      const outer = boxes.selectionBox()
      if (origin)
        parts.push(
          ...rulerParts(
            view.camera(),
            view.viewport(),
            origin,
            outer && outer.frame.id === origin.id ? boundsOf([outer.drawn]) : null,
          ),
        )
    }
    parts.push(...textParts(typing.shown(), placeBox))
    parts.push(...others.cursors)
    parts.push(...loupeParts(colourPick.shown(), view.camera().zoom, clearOfChrome()))
    overlay.replaceChildren(...parts)
    if (selected?.size) placeSizeLabel(selected.size.el, selected.size.span)
    const sizeBox = selected?.size ? [placedBox(selected.size.el)] : []
    measured.place(sizeBox)
    const at = pointer.pointerAt()
    if (at) selected?.radius.place(at, sizeBox, clearOfChrome())
  }

  return {
    draw: drawOverlay,
    selectionRect,
    labelRect,
  }
}
