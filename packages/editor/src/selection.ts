// What is selected, the group gone into, the picked page item (a frame, a section or a connector), the picked guide, a crop or path edit,
// the layer under the pointer, the frame lit from outside the stage and whether the constraint lines
// are asked for, with the rules that keep them
// in step and the listeners that follow them; and the layers in, around and beside a selection, which
// the keys that walk the layer tree select.
import { childrenOf, rowsOf } from '@dazbee/doc'
import { type Design, frameIdOf } from '@dazbee/schema'

import type { Frame } from './canvas/frames.ts'
import type { PlacedGuide } from './canvas/guides.ts'
import type { EditorView } from './canvas/view.ts'
import type { AnchorRef } from './gestures/pen/path.ts'

/** A layer as one frame shows it: selection, dragging and typing all happen in one frame. */
export interface Picked {
  id: string
  frameId: string
}
/**
 * The selected layers, each with its frame, in the order they were picked; never empty. They sit in
 * one frame or in several frames of one page, such as linked copies Ctrl+Alt+A or Shift and a
 * click added. The first one's frame is the one the selection's box and handles go in.
 */
export type Selection = readonly Picked[]
/** A page item chosen as a whole, one at a time: a frame, a section or a connector, by its id. */
export interface PickedItem {
  kind: 'frame' | 'section' | 'connector'
  id: string
}
/** The selection, the group gone into and the picked page item at one moment, which `restore` puts back. */
export interface HeldSelection {
  picks: Selection | null
  entered: string | null
  item: PickedItem | null
}
/** The path layer whose points are being edited (#45), and which of its anchors are selected. */
export interface PathEditing extends Picked {
  selected: AnchorRef[]
}

export interface SelectionDeps {
  /** The design as last drawn. */
  drawn: () => Design
  /** The shown page's frames as last drawn. */
  frames: () => readonly Frame[]
  /** Tells that what is shown changed, the selection with it. */
  changed: () => void
}

export interface EditorSelection {
  current(): Selection | null
  /**
   * The group or box double-clicked into: a click then picks what is directly inside it (#41).
   * It is always in the selection's frame, on the shown page.
   */
  entered(): string | null
  /** The frame layers were last selected in on a page, kept after the selection is let go; null with none. */
  lastFrameOn(pageId: string): string | null
  /**
   * The page item chosen as a whole: a frame, by a click on its label or its empty area, a section,
   * by a click on its title or outline, or a connector. No layer is selected meanwhile; the item's
   * own keys act on it.
   */
  pickedItem(): PickedItem | null
  /** The picked page item while it is a frame: outlined, its label lit; null otherwise. */
  pickedFrame(): string | null
  /** The picked page item while it is a section: its outline blue; null otherwise. */
  pickedSection(): string | null
  /** The picked frame the page renames in place of its label, which the overlay then leaves out; null with none. */
  renamingFrame(): string | null
  /** The picked section the page renames in place of its title, which the overlay then leaves out; null with none. */
  renamingSection(): string | null
  /**
   * The guide picked by a click on it, as it was then; null with none. No layer is selected and no
   * frame picked meanwhile; Delete and the arrows act on it.
   */
  guide(): PlacedGuide | null
  /** The layer whose image fill is being cropped on the stage (#48). */
  cropping(): Picked | null
  /** The path layer whose points are being edited (#45), and which of its anchors are selected. */
  pathEditing(): Readonly<PathEditing> | null
  /** The layer under the pointer, outlined while nothing is being dragged. */
  hovered(): Picked | null
  /** The frame lit from outside the stage, as a list's row does while it is hovered or focused; null with none. */
  litFrame(): string | null
  /** The layer lit from outside the stage, as a layers panel row does while it is hovered; null with none. */
  litLayer(): Picked | null
  /** Whether the page asks for the selected layers' constraint lines, as Arrange does while it shows their constraints. */
  constraintsShown(): boolean
  /**
   * Selects layers in one frame, or none, with no ids or no frame; a crop or path edit stays only on
   * that one layer there. Shows it.
   */
  select(ids: string[], frameId: string | null): void
  /**
   * Selects layers in frames of one page, in order, or none: any on another page than the first
   * one's are left out. A crop or path edit stays only on that one layer, and the group gone into
   * only while the first layer is in its frame. Shows it.
   */
  selectAcross(layers: Selection): void
  /** Sets the selection and shows nothing: a crop or path edit stays while a layer is selected, and ends with none. */
  selectKeepingModes(next: Selection | null): void
  /** The selection, the group gone into and the picked frame as they are now. */
  held(): HeldSelection
  /** Puts back what `held` gave, showing it, as Escape does once it cancels a press. */
  restore(held: HeldSelection): void
  /**
   * Drops selected layers that are gone, and the selection once none are left or its frame is not
   * on the shown page; with nothing selected, a crop or path edit ends. The picked frame goes once
   * it is not shown, and the picked section once no frame shown is in it.
   */
  keep(): void
  /**
   * Lets the selection go when its frame is not on the shown page, with a crop, path edit and the
   * group gone into, and the picked frame when it is not shown.
   */
  dropOffPage(): void
  /**
   * Picks a frame, or with null no page item, letting the selection go, and shows it. The frame
   * already picked is picked again: nothing changes, but the frame listeners hear of it.
   */
  pickFrame(frameId: string | null): void
  /** Picks a section, or with null no page item, as `pickFrame` picks a frame. */
  pickSection(sectionId: string | null): void
  /**
   * Picks a frame for the page to rename in place of its label, and shows it; null once the rename
   * ends. It ends too once the frame is let go or another is picked.
   */
  renameFrame(frameId: string | null): void
  /** As `renameFrame`, for a section and its title. */
  renameSection(sectionId: string | null): void
  /**
   * Picks a guide, or none with null, letting the selection, the picked frame and the group gone
   * into go, and shows it. Selecting a layer or picking a frame lets the guide go.
   */
  selectGuide(next: PlacedGuide | null): void
  /** Goes into a group or box, or out of every one with null. */
  enter(id: string | null): void
  /** Starts cropping a layer's image fill, or ends the crop with null. */
  crop(target: Picked | null): void
  /** Goes into a path's points with no anchor selected, or leaves them with null. */
  editPath(target: Picked | null): void
  /** Selects anchors of the path being edited. */
  pickAnchors(refs: AnchorRef[]): void
  /** Sets the layer under the pointer; returns whether it changed. */
  hover(next: Picked | null): boolean
  /** Lights a frame from outside the stage, or none with null; returns whether it changed. */
  lightFrame(frameId: string | null): boolean
  /** Lights a layer from outside the stage, or none with null; returns whether it changed. */
  lightLayer(next: Picked | null): boolean
  /** Asks for the selected layers' constraint lines, or for none with false; returns whether it changed. */
  showConstraints(shown: boolean): boolean
  /**
   * Tells the selection listeners when the selection differs from the one they last heard of,
   * then the frame listeners when the picked frame does or was picked again. Called whenever what
   * is shown changed, once the overlay has drawn it.
   */
  tellListeners(): void
  /** Told when the selection changes, so panels can follow it. */
  onSelection(listener: (ids: string[]) => void): () => boolean
  /** Told when the picked frame changes, with null once it goes, and when it is picked again. */
  onFramePick(listener: (frameId: string | null) => void): () => boolean
  /** Told when the picked section changes, with null once it goes. */
  onSectionPick(listener: (sectionId: string | null) => void): () => boolean
  destroy(): void
}

/** The selected layers' ids, in the order they were picked; none with nothing selected. */
export const idsOf = (selection: Selection | null) => selection?.map((layer) => layer.id) ?? []

/** Whether two pairs name the same layer in the same frame. */
export const samePick = (a: Picked, b: Picked) => a.id === b.id && a.frameId === b.frameId

/** Layers of one frame as selection pairs, in order. */
export const pairsIn = (frameId: string, ids: readonly string[]): Picked[] => ids.map((id) => ({ id, frameId }))

/** The first selected layer's frame, where the selection's box and handles go; undefined with nothing selected. */
export const firstFrameOf = (selection: Selection | null) => selection?.[0]?.frameId
/**
 * Where something placed with no point goes: the picked frame, else the selected layers' frame,
 * else the frame at the middle of the view, else the one nearest it, else the shown page's first.
 */
export const frameToPlaceIn = (
  view: Pick<EditorView, 'frames' | 'frameOf' | 'middleFrame' | 'nearestFrame'>,
  selection: Pick<EditorSelection, 'current' | 'pickedFrame'>,
): Frame | undefined =>
  view.frameOf(selection.pickedFrame() ?? undefined) ??
  view.frameOf(firstFrameOf(selection.current())) ??
  view.middleFrame() ??
  view.nearestFrame() ??
  view.frames()[0]

export const isPath = (from: Design, id: string) => {
  const node = from.nodes[id]
  return node?.type === 'graphic' && node.props.shape.kind === 'path'
}

export function editorSelection({ drawn, frames, changed }: SelectionDeps): EditorSelection {
  /** The selected layers, or null. */
  let selection: Selection | null = null
  /** The page item picked as a whole; a layer selected, Esc, or a click on empty canvas lets it go. */
  let picked: PickedItem | null = null
  /** The page item the page renames in place of its label or title, while it stays picked. */
  let renaming: PickedItem | null = null
  /** The guide picked by a click on it; a layer selected or a frame picked lets it go. */
  let guide: PlacedGuide | null = null
  /** The picked frame the frame listeners last heard of, and the picked section the section listeners did. */
  let lastPicked: string | null = null
  let lastSection: string | null = null
  /** Whether the picked frame was picked again since the frame listeners last heard. */
  let pickedAgain = false
  /** The group or box double-clicked into. */
  let entered: string | null = null
  /** The frame layers were last selected in, by page. */
  const lastFrames = new Map<string, string>()
  /** The selection the selection listeners last heard of, as `<frame>|<id>` pairs. */
  let lastSelection = ''
  /** The layer under the pointer. */
  let hovered: Picked | null = null
  /** The frame lit from outside the stage. */
  let lit: string | null = null
  /** The layer lit from outside the stage. */
  let litLayer: Picked | null = null
  /** Whether the page asks for the selected layers' constraint lines. */
  let constraintLines = false
  /** The path layer whose points are being edited, and its selected anchors. */
  let pathEditing: PathEditing | null = null
  /** The layer whose image fill is being cropped. */
  let cropping: Picked | null = null
  /** Told when the selection changes. */
  const selectionListeners = new Set<(ids: string[]) => void>()
  /** Told when the picked frame changes. */
  const frameListeners = new Set<(frameId: string | null) => void>()
  /** Told when the picked section changes. */
  const sectionListeners = new Set<(sectionId: string | null) => void>()

  const frameOf = (id: string | undefined) => frames().find((f) => f.id === id)

  function current() {
    return selection
  }
  function enteredGroup() {
    return entered
  }
  function lastFrameOn(pageId: string) {
    return lastFrames.get(pageId) ?? null
  }
  /** The picked page item's id while it is of `kind`, else null. */
  function pickedOf(kind: PickedItem['kind']) {
    return picked?.kind === kind ? picked.id : null
  }
  /** The page item renamed while it is of `kind` and still picked, else null. */
  function renamingOf(kind: PickedItem['kind']) {
    return renaming?.kind === kind && renaming.id === pickedOf(kind) ? renaming.id : null
  }
  function croppingLayer() {
    return cropping
  }
  function editingPath() {
    return pathEditing
  }
  function hoveredLayer() {
    return hovered
  }

  function select(ids: string[], frameId: string | null) {
    selectAcross(frameId === null ? [] : pairsIn(frameId, ids))
  }
  function selectAcross(layers: Selection) {
    const pageId = drawn().frames[layers[0]?.frameId ?? '']?.pageId
    const kept = layers.filter((layer) => drawn().frames[layer.frameId]?.pageId === pageId)
    selection = kept.length > 0 ? kept : null
    if (selection) {
      picked = null
      guide = null
    }
    rememberFrame()
    const [first] = kept
    // Layers selected in another frame leave the group gone into: Esc never goes back to it.
    if (entered && first && frameIdOf(drawn(), entered) !== first.frameId) entered = null
    if (pathEditing && !onlyLayer(pathEditing)) pathEditing = null
    if (cropping && !onlyLayer(cropping)) cropping = null
    changed()
  }
  /** Whether a layer is all the selection holds. */
  function onlyLayer(layer: Picked) {
    const [only] = selection ?? []
    return selection?.length === 1 && only !== undefined && samePick(only, layer)
  }
  /** With nothing selected there is no crop and no path edit. */
  function endModesWhenNone() {
    if (selection) return
    cropping = null
    pathEditing = null
  }
  function held(): HeldSelection {
    return { picks: selection, entered, item: picked }
  }
  function restore({ picks, entered: into, item }: HeldSelection) {
    selectAcross(picks ?? [])
    pickItem(item)
    entered = into
  }
  function selectKeepingModes(next: Selection | null) {
    selection = next
    if (selection) {
      picked = null
      guide = null
    }
    rememberFrame()
    endModesWhenNone()
  }
  /** Keeps the first selected layer's frame as the one last selected in on its page. */
  function rememberFrame() {
    const frame = frameOf(firstFrameOf(selection))
    if (frame) lastFrames.set(frame.pageId, frame.id)
  }
  function keep() {
    if (picked && !shown(picked)) picked = null
    if (guide && !frameOf(guide.frameId)) guide = null
    if (!selection) return endModesWhenNone()
    const design = drawn()
    // A layer that went into another frame, by a drop, its undo or another tab, is picked in that frame.
    let moved = false
    const kept = selection.flatMap((layer) => {
      const frameId = design.nodes[layer.id] ? frameIdOf(design, layer.id) : undefined
      if (frameId === undefined || !frameOf(frameId)) return []
      if (frameId === layer.frameId) return [layer]
      moved = true
      return [{ ...layer, frameId }]
    })
    selection = kept.length > 0 ? kept : null
    if (moved) rememberFrame()
    // A group gone into is left once the layer it held went into another frame, as `select` leaves it.
    const [first] = kept
    if (entered && (!design.nodes[entered] || (moved && first && frameIdOf(design, entered) !== first.frameId)))
      entered = null
    const holds = (layer: Picked) => kept.some((p) => samePick(p, layer))
    if (pathEditing && (!holds(pathEditing) || !isPath(design, pathEditing.id))) pathEditing = null
    if (cropping && !holds(cropping)) cropping = null
  }
  function dropOffPage() {
    const kept = selection?.filter((layer) => frameOf(layer.frameId)) ?? []
    selection = kept.length > 0 ? kept : null
    if (picked && !shown(picked)) picked = null
    if (guide && !frameOf(guide.frameId)) guide = null
    if (entered && !frameOf(frameIdOf(drawn(), entered))) entered = null
    endModesWhenNone()
  }
  /** Whether a picked page item is still shown: a frame of the shown page, or a section a frame shown is in. */
  function shown(item: PickedItem) {
    if (item.kind === 'frame') return frameOf(item.id) !== undefined
    const design = drawn()
    const section = Object.hasOwn(design.sections, item.id) ? design.sections[item.id] : undefined
    return frames().some((f) => f.pageId === section?.pageId && design.frames[f.id]?.sectionId === item.id)
  }
  function pickFrame(frameId: string | null) {
    pickItem(frameId === null ? null : { kind: 'frame', id: frameId })
  }
  function pickSection(sectionId: string | null) {
    pickItem(sectionId === null ? null : { kind: 'section', id: sectionId })
  }
  function pickItem(item: PickedItem | null) {
    if (item?.kind === picked?.kind && item?.id === picked?.id) {
      if (item === null) return
      pickedAgain = true
      changed()
      return
    }
    picked = item
    renaming = null
    if (item !== null) guide = null
    // Picking an item lets the selection go, with a crop or path edit on it and any group gone into.
    if (item !== null && selection) {
      entered = null
      selectAcross([])
      return
    }
    changed()
  }
  function renameFrame(frameId: string | null) {
    renameItem(frameId === null ? null : { kind: 'frame', id: frameId })
  }
  function renameSection(sectionId: string | null) {
    renameItem(sectionId === null ? null : { kind: 'section', id: sectionId })
  }
  function renameItem(item: PickedItem | null) {
    const was = picked
    if (item !== null) pickItem(item)
    renaming = item
    // Picking another item showed it already.
    if (picked === was) changed()
  }
  function selectGuide(next: PlacedGuide | null) {
    guide = next
    if (!next) return changed()
    entered = null
    picked = null
    renaming = null
    selectAcross([])
  }
  function enter(id: string | null) {
    entered = id
  }
  function crop(target: Picked | null) {
    cropping = target
  }
  function editPath(target: Picked | null) {
    pathEditing = target && { ...target, selected: [] }
  }
  function pickAnchors(refs: AnchorRef[]) {
    if (pathEditing) pathEditing.selected = refs
  }
  function hover(next: Picked | null) {
    const moved = next?.id !== hovered?.id || next?.frameId !== hovered?.frameId
    hovered = next
    return moved
  }
  function lightFrame(frameId: string | null) {
    const changed = frameId !== lit
    lit = frameId
    return changed
  }

  function lightLayer(next: Picked | null) {
    const changed = next?.id !== litLayer?.id || next?.frameId !== litLayer?.frameId
    litLayer = next
    return changed
  }

  function showConstraints(shown: boolean) {
    const changed = shown !== constraintLines
    constraintLines = shown
    return changed
  }

  function tellListeners() {
    const now = (selection ?? []).map((layer) => `${layer.frameId}|${layer.id}`).join(',')
    if (now !== lastSelection) {
      lastSelection = now
      for (const listener of selectionListeners) listener(idsOf(selection))
    }
    const frame = pickedOf('frame')
    if (frame !== lastPicked || (pickedAgain && frame !== null)) {
      lastPicked = frame
      for (const listener of frameListeners) listener(frame)
    }
    pickedAgain = false
    const section = pickedOf('section')
    if (section !== lastSection) {
      lastSection = section
      for (const listener of sectionListeners) listener(section)
    }
  }
  function onSelection(listener: (ids: string[]) => void) {
    selectionListeners.add(listener)
    return () => selectionListeners.delete(listener)
  }
  function onFramePick(listener: (frameId: string | null) => void) {
    frameListeners.add(listener)
    return () => frameListeners.delete(listener)
  }
  function onSectionPick(listener: (sectionId: string | null) => void) {
    sectionListeners.add(listener)
    return () => sectionListeners.delete(listener)
  }

  function destroy() {
    sectionListeners.clear()
    frameListeners.clear()
    selectionListeners.clear()
  }

  return {
    current,
    entered: enteredGroup,
    lastFrameOn,
    pickedItem: () => picked,
    pickedFrame: () => pickedOf('frame'),
    pickedSection: () => pickedOf('section'),
    renamingFrame: () => renamingOf('frame'),
    renamingSection: () => renamingOf('section'),
    guide: () => guide,
    cropping: croppingLayer,
    pathEditing: editingPath,
    hovered: hoveredLayer,
    litFrame: () => lit,
    litLayer: () => litLayer,
    constraintsShown: () => constraintLines,
    select,
    selectAcross,
    selectKeepingModes,
    held,
    restore,
    keep,
    dropOffPage,
    pickFrame,
    pickSection,
    renameFrame,
    renameSection,
    selectGuide,
    enter,
    crop,
    editPath,
    pickAnchors,
    hover,
    lightFrame,
    lightLayer,
    showConstraints,
    tellListeners,
    onSelection,
    onFramePick,
    onSectionPick,
    destroy,
  }
}

/** What is directly in each selected layer, back to front, in its frame; none when nothing is. */
export function childrenOfSelected(selection: Selection, design: Design): Picked[] {
  return selection.flatMap(({ id, frameId }) =>
    pairsIn(
      frameId,
      childrenOf(design, id).map(([child]) => child),
    ),
  )
}

/** The group, box or boolean each selected layer is directly in, once each, in its frame; a top-level layer's frame is none. */
export function parentsOfSelected(selection: Selection, design: Design): Picked[] {
  const parents: Picked[] = []
  for (const { id, frameId } of selection) {
    const parentId = design.nodes[id]?.parentId
    const parent = parentId && design.nodes[parentId] ? { id: parentId, frameId } : null
    if (parent && !parents.some((p) => samePick(p, parent))) parents.push(parent)
  }
  return parents
}

/**
 * The layer `by` rows on from the last selected one in the layers panel, among the layers in the
 * same group, box, boolean or frame, wrapping round from the end; the panel lists them topmost first.
 * Null with nothing selected.
 */
export function siblingOfSelected(selection: Selection | null, design: Design, by: 1 | -1): Picked | null {
  const last = selection?.at(-1)
  const parentId = last && design.nodes[last.id]?.parentId
  if (!last || parentId === undefined) return null
  const rows = rowsOf(design, parentId).map(([id]) => id)
  const next = rows[(rows.indexOf(last.id) + by + rows.length) % rows.length] ?? last.id
  return { id: next, frameId: last.frameId }
}

/**
 * Selects layers as the layers panel would, going into the group, box or boolean the first of them
 * is directly in, so a click then picks beside it as after a double click; at a frame's top level,
 * or with none, it leaves every group.
 */
export function selectInto(
  selection: Pick<EditorSelection, 'enter' | 'selectAcross'>,
  design: Design,
  layers: Selection,
) {
  const [first] = layers
  const parentId = first && design.nodes[first.id]?.parentId
  selection.enter(parentId && design.nodes[parentId] ? parentId : null)
  selection.selectAcross(layers)
}
