/* eslint-disable max-lines -- one deep module: buildCore builds every module of the core in the code layout's order and returns the EditorCore */
// The editor's core: every module that decides what the design, the selection, the camera or the
// tool becomes, built in the code layout's order on what it is handed, with no browser. The page's
// side, `editor.ts`, builds the shell on its modules; a test opens it in Node.
import { derivedValues, frameIdOf, openSession, type Session } from '@dazbee/doc'
import type { Design, Point, SafeZoneChoice, ValueKind, VariableRef, Variables } from '@dazbee/schema'

import { toggled } from './across-frames.ts'
import { editorActionReady } from './action-ready.ts'
import { editorActions } from './actions.ts'
import { editorBrandKit } from './brand-kit.ts'
import { frameIn } from './canvas/frames.ts'
import { editorRedraw } from './canvas/redraw.ts'
import { frameScenes } from './canvas/scenes.ts'
import { thumbnailCache } from './canvas/thumbnails.ts'
import { editorView, hiddenToggles, type Spot } from './canvas/view.ts'
import type { CoreStart, DrawInfo, EditorBase, EditorCore, NoticeDetail, TabAccess } from './core-interface.ts'
import { editorExports } from './export/exports.ts'
import { editorFontCheck } from './export/font-check.ts'
import { editorPngCopy } from './export/png-copy.ts'
import { watchFaults } from './faults.ts'
import { editorFrameActions } from './frame-actions.ts'
import { editorColourPick, type FrameSampler } from './gestures/colour-pick.ts'
import { editorCropping } from './gestures/crop/cropping.ts'
import { editorDragStart } from './gestures/drag-start.ts'
import { editorDrawing } from './gestures/drawing/drawing.ts'
import { editorGuideDrag } from './gestures/guides/guide-drag.ts'
import { editorHold } from './gestures/hold.ts'
import type { PointerInput } from './gestures/inputs.ts'
import { editorPen } from './gestures/pen/pen.ts'
import { editorPointer } from './gestures/pointer.ts'
import { editorAutoLayoutDrag } from './gestures/select/auto-layout-drag.ts'
import { editorFrameMove } from './gestures/select/frame-move.ts'
import { editorFrameResize } from './gestures/select/frame-resize.ts'
import { editorSelectPress } from './gestures/select/select-press.ts'
import { editorTransformDrag } from './gestures/select/transform-drag.ts'
import { editorKeys } from './keys.ts'
import { editorLayerEdits } from './layer-edits.ts'
import { editorBoxLayout } from './layers/box-layout.ts'
import { editorBoxes } from './layers/boxes.ts'
import { editorDuplicate } from './layers/duplicate.ts'
import { hug as hugIn } from './layers/hug.ts'
import { type SameBy, sameByOf, selectedSame } from './layers/select-same.ts'
import { editorLeftOut } from './layers-left-out.ts'
import { editorLinkNotices } from './link-notices.ts'
import { editorLinkedCopies, isLinkedAction } from './linked-copies.ts'
import { listenerSet } from './listener-set.ts'
import { editorPlace } from './place.ts'
import { editorPlaceFigma } from './place-figma.ts'
import { editorPlaceImages } from './place-images.ts'
import { editorPlaceSvg } from './place-svg.ts'
import { editorPresence } from './presence.ts'
import { editorReach } from './reach.ts'
import { editorResources } from './resources.ts'
import { editorRestore } from './restore.ts'
import { editorSelection, firstFrameOf, idsOf, type Picked, selectInto } from './selection.ts'
import { type StageAction, stepOf } from './shortcuts.ts'
import { editorFindReplace } from './text/find-replace.ts'
import { editorFitText } from './text/fit-text.ts'
import { owedFits } from './text/owed-fits.ts'
import { isStyleToggle, type RunStyle } from './text/text-edit.ts'
import { editorTextStyles } from './text/text-styles.ts'
import { editorTyping } from './text/typing.ts'
import { editorTools, type PlacedAsset, type PlaceImageOptions, type Tool, VIEW_TOOLS } from './tools.ts'
import { editorUploads } from './uploads.ts'
import { editorViewOnly } from './view-only.ts'

/** The access of a tab whose caller gives none: it may always edit. */
const MAY_EDIT: TabAccess = { readOnly: () => false, onChange: () => () => {} }
/** The brand kit's values while the editor has none: one object, so a reader can tell when they change. */
const NO_VARIABLES: Variables = {}

/** The open core. */
export function openEditorCore(start: CoreStart): EditorCore {
  return buildCore(start).core
}

/**
 * Builds the core's modules in the code layout's order and gives the open core with the modules
 * themselves, by name, for what is built on them: the page's side of the editor, and a test's.
 * `shared` holds the core's members that mean the same in the editor, and `nextDraw` resolves once
 * the next redraw has told the draw listeners. Aborting the signal ends it.
 */
export function buildCore({
  ck,
  cache,
  first: firstBytes,
  firstFonts,
  store,
  connected,
  remembered,
  onMac,
  signal,
  options,
  access = MAY_EDIT,
  linkNotices,
  presence: tabPresence,
  after,
  motion,
  copyMaker,
  sampler,
  hiddenShowable = true,
}: CoreStart) {
  const status = options.onStatus ?? (() => {})
  /** Told when the text being edited, or its selected range, changes. */
  const textSelection = listenerSet<[]>()
  /**
   * Told when a gesture has nothing to do because a box's layout decides it, so the page can say
   * why, naming that layout; when an SVG can't be read or had parts no layer shows, which come as
   * `parts`; when the design leaves out layers it could not read; and when a command faulted, so
   * its change was not applied.
   */
  const notices = listenerSet<NoticeDetail>()
  /** Called after every redraw with the design it drew; the two-tab test times edits with it. */
  const draws = listenerSet<[design: Design, at: number, info: DrawInfo]>()
  /** Told of a frame to rename in place: its label was double-clicked, or the page asked. */
  const frameRenames = listenerSet<[frameId: string]>()

  // Layer 2: the state owners.
  const session: Session = openSession(store, { readOnly: access.readOnly })
  watchFaults({ session, endOpen: endOpenOnStage, notify: notices.emit })
  const viewOnly = editorViewOnly({ session, access, endOpen: endOpenOnStage, notify: notices.emit, signal })
  const linkNoticed = linkNotices && editorLinkNotices({ link: linkNotices, notify: notices.emit, signal })
  const view = editorView({
    session,
    previews: store.previews,
    composition,
    onZoom: (zoom) => options.onZoom?.(zoom),
    motion,
  })
  const { frameOf, camera, design: drawn, frames } = view
  const resources = editorResources({
    ck,
    cache,
    first: firstBytes,
    firstFonts,
    sources: {
      ...(options.assetBytes ? { assetBytes: options.assetBytes } : {}),
      ...(options.fontFaces ? { fontFaces: options.fontFaces } : {}),
      ...(options.fontFile ? { fontFile: options.fontFile } : {}),
    },
    connected,
    status,
    signal,
    ...(copyMaker ? { copyMaker } : {}),
    // A bigger display copy waits for the zoom to settle; once the core has ended it is never made.
    ...(after
      ? {
          after: (ms: number, run: () => void) =>
            after(ms, () => {
              if (!signal.aborted) run()
            }),
        }
      : {}),
  })
  const scenes = frameScenes({
    ck,
    resources,
    drawn,
    changes: session.changes,
    live: session.design,
    previewed: () => ({ design: view.previewed(), frames: view.previewedFrames() }),
    hiddenShown: view.hiddenShown,
  })
  const tools = editorTools({
    finish: finishPath,
    changed: showCursor,
    onSnapping: view.viewChanged,
    viewOnly: () => access.readOnly(),
  })
  const selection = editorSelection({ drawn, frames, changed: shownChanged })

  // Layer 3: the queries.
  const boxes = editorBoxes({ session, scenes, resources, selection, drawn, frameOf, zoom: () => view.camera().zoom })
  const hug = (ids: string[]) => hugIn(session, ids)
  const thumbnails = thumbnailCache({ ck, scenes, resources, current: () => session.design(), drawn })
  const exporting = editorExports({ ck, cache, session, resources, view })
  const fontCheck = editorFontCheck({ session, scenes, resources })

  // Layer 4: the behaviours.
  const duplicate = editorDuplicate({ session, selection, boxes, hug })
  const hold = editorHold()
  const dragStart = editorDragStart()
  // The editor's fit, typing's and the recompute's: it waits while a font a text is drawn in comes.
  const fit = editorFitText({ scenes, resources })
  const owed = owedFits({ session, fit })
  const typing = editorTyping({
    ck,
    store,
    session,
    resources,
    scenes,
    boxes,
    frameOf,
    hug,
    textSelectionChanged: textSelection.emit,
    shownChanged,
    redraw: view.redraw,
    // A pause that comes once the core has ended does nothing.
    ...(after
      ? {
          after: (ms: number, run: () => void) =>
            after(ms, () => {
              if (!signal.aborted) run()
            }),
        }
      : {}),
    ...(store.previews ? { typingIn: store.previews.typingIn } : {}),
    editingElsewhere: (name) => notices.emit('editingElsewhere', { name }),
    fit,
    owe: owed.owe,
  })
  /** The text layer the composition draws, and its count, which the view reads, built before typing. */
  function composition() {
    return typing.composition()
  }
  const pen = editorPen({
    hold: hold.hold,
    dragStart,
    session,
    selection,
    tools,
    typing,
    camera,
    drawn,
    frameOf,
    boxes,
    hug,
    shownChanged,
  })
  const frameActions = editorFrameActions({
    session,
    view,
    tools,
    frameName: options.frameName,
    selection,
    typing,
    shownChanged,
  })
  const drawing = editorDrawing({
    hold: hold.hold,
    session,
    selection,
    tools,
    typing,
    boxes,
    page: view.page,
    frameName: options.frameName,
    frameActions,
    hug,
    shownChanged,
  })
  const autoLayoutDrag = editorAutoLayoutDrag({
    session,
    scenes,
    boxes,
    duplicate,
    selection,
    camera,
    hug,
    notify: notices.emit,
    frames,
  })
  const transformDrag = editorTransformDrag({
    hold: hold.hold,
    session,
    scenes,
    selection,
    duplicate,
    typing,
    tools,
    boxes,
    camera,
    frames,
    autoLayoutDrag,
    hug,
    notify: notices.emit,
    radiusLabel: options.radiusLabel,
    shownChanged,
  })
  const frameMove = editorFrameMove({ session })
  const frameResize = editorFrameResize({
    hold: hold.hold,
    session,
    view,
    tools,
    selection,
    typing,
    transformDrag,
    frameMove,
    onMac,
  })
  const selectPress = editorSelectPress({
    hold: hold.hold,
    view,
    selection,
    boxes,
    typing,
    transformDrag,
    autoLayoutDrag,
    frameMove,
    frameResize,
    onMac,
  })
  const cropping = editorCropping({
    hold: hold.hold,
    session,
    selection,
    typing,
    thumbnails,
    camera,
    frameOf,
    boxes,
    transformDrag,
    hug,
    shownChanged,
  })
  const boxLayout = editorBoxLayout({ session, boxes, layerName: options.layerName })
  const reach = editorReach({ session, selection, typing })
  const actions = editorActions({
    session,
    view,
    tools,
    selection,
    scenes,
    boxes,
    pen,
    cropping,
    transformDrag,
    autoLayoutDrag,
    boxLayout,
    frameActions,
    reach,
    duplicate,
    notify: notices.emit,
    shownChanged,
    layerName: options.layerName,
  })
  const restoring = editorRestore({ session, store, view, selection, showPage, endOpen: endOpenAsUndo })
  const uploads = editorUploads({
    ...(options.uploadImage ? { upload: options.uploadImage } : {}),
    readOnly: () => access.readOnly(),
    notify: notices.emit,
    signal,
  })
  const placeSvg = editorPlaceSvg({
    ck,
    session,
    view,
    tools,
    selection,
    typing,
    notify: notices.emit,
    uploads,
    open: { gesturing, dragging, stopEditing, settle },
    ...(after ? { after } : {}),
    signal,
  })
  const placeFigma = editorPlaceFigma({
    session,
    store,
    view,
    typing,
    whenSettled: placeSvg.whenSettled,
    gesturing,
    signal,
  })
  const placeImages = editorPlaceImages({
    session,
    view,
    tools,
    selection,
    svg: placeSvg,
    uploads,
    canUpload: options.uploadImage !== undefined,
    readOnly: () => access.readOnly(),
    tellViewOnly: viewOnly.tell,
    notify: notices.emit,
    signal,
  })
  const place = editorPlace({
    session,
    designId: options.designId,
    remembered,
    view,
    tools,
    selection,
    boxes,
    typing,
    actions,
    svg: placeSvg,
    images: placeImages,
    notify: notices.emit,
    signal,
    shownChanged,
  })
  const pngCopy = editorPngCopy({ ck, session, view, selection, boxes, scenes, resources, place })
  const brandKit = editorBrandKit({ session, resources, view, selection, typing, signal })
  const layerEdits = editorLayerEdits({ session, selection, boxes, resources, typing, signal })
  const textStyles = editorTextStyles({ session, selection, resources, typing, layerEdits })
  const linked = editorLinkedCopies({
    session,
    remembered,
    selection,
    typing,
    boxes,
    resources,
    signal,
    shownChanged,
  })
  const findReplace = editorFindReplace({ session, view, selection, typing })
  const ready = editorActionReady({
    session,
    remembered,
    view,
    tools,
    selection,
    boxes,
    pen,
    typing,
    actions,
    linked,
    textStyles,
    place,
    pngCopy,
    hiddenToggles: hiddenShownToggles,
  })
  const guideDrag = editorGuideDrag({
    hold: hold.hold,
    session,
    view,
    tools,
    selection,
    boxes,
    typing,
    transformDrag,
    frameResize,
    onMac,
    shownChanged,
  })
  const leftOut = editorLeftOut({ session, listening: notices.heard, notify: notices.emit })
  // With no sampler the frames picking reads are drawn here, a turn after they are asked for.
  const drawHere: FrameSampler = {
    sample: (design, frameId, bytes) =>
      Promise.resolve().then(() => (signal.aborted ? null : exporting.frame(design, frameId, bytes))),
    cancel: () => {},
  }
  const colourPick = editorColourPick({
    session,
    onDesignChange: (listener) => store.onChange(listener),
    view,
    resources,
    frameInUse: () => firstFrameOf(selection.current()) ?? selection.pickedFrame(),
    sampler: sampler ?? drawHere,
    readOnly: () => access.readOnly(),
    tellViewOnly: viewOnly.tell,
    notify: notices.emit,
    after,
    signal,
    shownChanged,
  })
  // The stage hides its cursor while a colour is picked, the loupe standing in its place.
  colourPick.onPicking(showCursor)

  // Layer 5: the routers.
  const pointer = editorPointer({
    dragStart,
    hold,
    session,
    view,
    tools,
    selection,
    boxes,
    typing,
    pen,
    cropping,
    drawing,
    transformDrag,
    autoLayoutDrag,
    frameResize,
    guideDrag,
    selectPress,
    colourPick,
    renameFrame: (frameId: string) => pickFrame(frameId, true),
    onMac,
    shownChanged,
  })
  const keys = editorKeys({ place, typing, pointer, guideDrag, perform })
  const redrawing = editorRedraw({
    view,
    resources,
    scenes,
    selection,
    typing,
    pointer,
    leftOut,
    report: draws.emit,
  })
  const presence = editorPresence({ view, selection, pointer, link: tabPresence })
  signal.addEventListener('abort', redrawing.onShown(presence.update))

  // Called late-bound by modules built before what they call.
  function finishPath() {
    pen.finish()
  }
  function showCursor() {
    pointer.showCursor()
  }
  function gesturing() {
    return dragging() || session.inGesture()
  }
  /** Whether a drag is held on the stage, whose undo step a placing would join. */
  function dragging() {
    return pointer.gesture() !== null
  }
  function shownChanged() {
    redrawing.shownChanged()
  }
  /** Shows a platform's safe zones, all together or none, and tells the view listeners, as the rulers do. */
  function setSafeZones(platform: SafeZoneChoice | null) {
    if (platform === view.safeZones()) return
    view.setSafeZones(platform)
    shownChanged()
    view.viewChanged()
  }
  /** Shows the hidden layers on the stage or stops, as Quick actions' row does. */
  /** Whether the hidden layers shown would turn on or off: never where they may not show. */
  function hiddenShownToggles() {
    return hiddenShowable && hiddenToggles(session.design(), view.hiddenShown())
  }
  function setHiddenShown(on: boolean) {
    if (on !== view.hiddenShown()) toggleHiddenShown()
  }
  /**
   * Turns the hidden layers shown on or off, writing nothing, and tells the view listeners; nothing
   * to turn on while the design has none hidden. Returns whether it did.
   */
  function toggleHiddenShown() {
    if (!hiddenShownToggles()) return false
    view.setHiddenShown(!view.hiddenShown())
    shownChanged()
    view.viewChanged()
    return true
  }

  /**
   * Ends all that is open on the stage, as a fault does. The drag held is dropped, whatever it was
   * doing: moving, cropping, drawing a shape or dragging a path's points; it drops nothing, and its
   * later moves reach no drag. Typing and the pen's path end as `settle` ends them.
   */
  function endOpenOnStage() {
    pointer.dropDrag()
    settle()
  }

  /**
   * Adds a listener to the notices; the first one is told at once of layers the design leaves out,
   * and of a design opened near its limits.
   */
  function onNotice(listener: (...told: NoticeDetail) => void) {
    const off = notices.on(listener)
    leftOut.tell()
    linkNoticed?.tellOpened()
    return off
  }

  /**
   * Does what a shortcut names, as the actions, the linked-copy actions, the text styles, Select
   * all with same and the hidden layers shown do, as one undo step with the name the shortcut table
   * gives it; undo and redo first end what is open on the stage: the pen's path, a drag and typing.
   */
  function perform(action: StageAction) {
    const step = stepOf(action)
    return step ? session.gesture(step, () => performAction(action)) : performAction(action)
  }
  function performAction(action: StageAction) {
    if (isLinkedAction(action)) return linked.perform(action)
    if (isStyleToggle(action)) return textStyles.perform(action)
    const same = sameByOf(action)
    if (same) return selectSame(same)
    if (action === 'toggleHiddenShown') return toggleHiddenShown()
    if (action !== 'undo' && action !== 'redo') return actions.perform(action)
    endOpenAsUndo()
    if (action === 'undo') session.undo()
    else session.redo()
    return true
  }
  /**
   * Select all with same: selects the layers of the page sharing the first selected one's fill or
   * font, as `select` selects, ending typing first; nothing changes while that changes nothing.
   * Returns whether there was a selection to act on.
   */
  function selectSame(by: SameBy) {
    const current = selection.current()
    const next = current && selectedSame(session.design(), current, by)
    if (next) select(idsOf(next))
    return current !== null
  }
  /** Ends what is open on the stage before Undo, a restore too: the pen's path, a drag and typing. */
  function endOpenAsUndo() {
    pen.finish()
    pointer.endDrag()
    typing.stop()
  }
  /**
   * Selects layers in the frames of the first one's page, as the app asks, ending typing first: any
   * on other pages or no longer in the design are left out, and that page is shown first when
   * another is. None clears it. With `into`, it goes into the group the first one is in.
   */
  function select(ids: string[], into = false) {
    typing.stop()
    const now = session.design()
    const layers = ids.flatMap((id) => {
      const frameId = now.nodes[id] ? frameIdOf(now, id) : undefined
      return frameId === undefined ? [] : [{ id, frameId }]
    })
    const pageId = now.frames[layers[0]?.frameId ?? '']?.pageId
    if (pageId === undefined) {
      selection.select([], null)
      return
    }
    if (pageId !== view.page()) showPage(pageId)
    if (into) selectInto(selection, now, layers)
    else selection.selectAcross(layers)
  }
  /** A layer picked from the list under the pointer: selected as `select` selects, going into its group. */
  function pickLayer(layer: Picked) {
    select([layer.id], true)
  }
  /** Shift and a click on a layer of the shown page, from a list: as on the stage, it is added, taken out or selected alone. */
  function toggleSelected(id: string) {
    const now = session.design()
    const frameId = now.nodes[id] ? frameIdOf(now, id) : undefined
    if (frameId === undefined || !frameOf(frameId)) return
    typing.stop()
    selection.selectAcross(toggled(selection.current(), { id, frameId }, now))
  }
  /**
   * Shows a page, its frames fitted: a selection, crop, path edit, pen path or typing on another
   * page lets go, and so does the picked frame.
   */
  function showPage(pageId: string) {
    pen.finish()
    view.showPage(pageId)
    selection.dropOffPage()
    const editing = typing.editing()
    if (editing && !frameOf(editing.frameId)) typing.stop()
    selection.pickFrame(null)
    shownChanged()
  }
  /**
   * Picks a frame of the shown page, ending typing, and with `rename` asks the page to rename it in
   * place of its label, which the overlay leaves out meanwhile; any other frame lets the picked one go.
   * A tab that may only view picks it and renames nothing (C35).
   */
  function pickFrame(frameId: string | null, rename = false) {
    const shown = frameOf(frameId ?? undefined)
    if (shown) typing.stop()
    if (!shown || !rename || access.readOnly()) return selection.pickFrame(shown?.id ?? null)
    selection.renameFrame(shown.id)
    frameRenames.emit(shown.id)
  }
  /** Lights a frame from outside the stage, or none, and shows it. */
  function lightFrame(frameId: string | null) {
    if (selection.lightFrame(frameId)) shownChanged()
  }
  /** Lights a layer from outside the stage, or none, and shows it. */
  function lightLayer(layer: { id: string; frameId: string } | null) {
    if (selection.lightLayer(layer)) shownChanged()
  }
  /** Asks for the selected layers' constraint lines, or for none, and shows them. */
  function showConstraints(shown: boolean) {
    if (selection.showConstraints(shown)) shownChanged()
  }
  /** Renames a frame of the shown page in place of its label, panning first, at the same zoom, so the label shows. */
  function renameFrame(frameId: string) {
    const frame = frameOf(frameId)
    if (frame) view.showLabel(frame)
    pickFrame(frameId, true)
  }
  /** Fits a frame in view, showing its page first when another is shown. */
  function fitFrame(frameId: string) {
    const now = session.design()
    const pageId = Object.hasOwn(now.frames, frameId) ? now.frames[frameId]?.pageId : undefined
    if (pageId !== undefined && pageId !== view.page()) showPage(pageId)
    view.fitArea(view.defaultFrame(frameId))
  }
  /** A layer's box as drawn in its frame, shown or not. */
  function boxOf(id: string) {
    const now = session.design()
    const frameId = frameIdOf(now, id)
    const frame = frameId === undefined ? undefined : frameIn(now, frameId)
    return frame ? boxes.drawnRect(frame, id) : null
  }
  /** Starts picking a colour: a drag held is dropped first, as Escape drops it, so its release and moves are picking's. */
  function pickColour() {
    pointer.dropDrag()
    return colourPick.start(pointer.pointerAt())
  }
  function stopEditing() {
    if (!typing.editing()) return
    typing.stop()
    shownChanged()
  }
  function settle() {
    if (!typing.editing() && !pen.drawing()) return
    typing.stop()
    pen.finish()
    shownChanged()
  }

  // A tab that comes to only view the design (C35) ends what it had open to edit: a drag, typing, the
  // pen's path, a crop and a path's points, and a drawing tool; a Reviewer's tab opens with none.
  // The access is told of often (each status of the link): only the turn to view only counts. A drag
  // that wrote is put back unsent, so the page is told that what wasn't saved wasn't kept; typing and
  // the pen's path end as steps, which the server refuses and the link tells of as rejected.
  let viewing = access.readOnly()
  signal.addEventListener(
    'abort',
    access.onChange(() => {
      const was = viewing
      viewing = access.readOnly()
      if (!viewing || was) return
      // A drag whose step wrote changes the design as it is put back; a press held still does not.
      const before = session.changes()
      // Once the link has ended, the page already says why the tab only views, so nothing more is told.
      if (pointer.dropDrag() && session.changes() !== before && !access.quiet?.()) notices.emit('nowViewOnly')
      settle()
      if (selection.cropping()) selection.crop(null)
      if (selection.pathEditing()) selection.editPath(null)
      if (!VIEW_TOOLS.has(tools.tool())) tools.setTool('select')
      shownChanged()
    }),
  )

  /** Frees all the core made, once the signal aborts: the listeners are let go first, the session and the view last. */
  function end() {
    draws.clear()
    selection.destroy()
    notices.clear()
    thumbnails.destroy()
    tools.destroy()
    scenes.destroy()
    resources.destroy()
    session.destroy()
    view.destroy()
  }
  // A change to the design asks for a redraw until the signal aborts, which lets it go first.
  signal.addEventListener(
    'abort',
    store.onChange(() => view.redraw()),
  )
  // Another tab's preview moved on: the surface redraws on the next animation frame, once (D7).
  const stopPreviews = store.previews?.onChange(() => view.redraw())
  if (stopPreviews) signal.addEventListener('abort', stopPreviews)
  resources.onArrive(() => view.redraw())
  // After the families leave the loading ones: onArrive's listeners run before.
  resources.onSettle(() => owed.settle(typing.fitText))
  signal.addEventListener('abort', end)

  /**
   * The members that mean the same in the editor, which spreads them among its own. Each is guarded:
   * a write a Reviewer's tab refuses does nothing there (C35).
   */
  const shared: EditorBase = viewOnly.guardAll({
    session: viewOnly.pageSession(),
    readOnly: () => access.readOnly(),
    onAccess: (listener: () => void) => access.onChange(listener),
    tellViewOnly: viewOnly.tell,
    store,
    design: () => session.design(),
    selected: () => selection.current()?.[0]?.id ?? null,
    selection: () => idsOf(selection.current()),
    selectedFrame: () => firstFrameOf(selection.current()) ?? null,
    toggleSelected,
    select,
    perform,
    actionReady: ready.actionReady,
    ungroupState: actions.ungroupState,
    wrapState: actions.wrapState,
    setLayout: boxLayout.setLayout,
    maskState: actions.maskState,
    canUndo: () => session.canUndo(),
    canRedo: () => session.canRedo(),
    undoName: () => session.undoName(),
    redoName: () => session.redoName(),
    onHistory: (listener: () => void) => session.onHistory(listener),
    canPasteLayers: () => place.canPasteLayers(),
    pasteLayers: () => place.pasteLayers(pointer.pointerAt),
    linkedMenu: linked.menu,
    moveLayer: layerEdits.moveLayer,
    // A panel's gesture is a step of its own: the typing before it ends, so its pause can't split it.
    beginGesture: () => {
      typing.pause()
      return session.beginGesture().end
    },
    gesturing,
    setProps: layerEdits.setProps,
    setSizing: layerEdits.setSizing,
    setRadius: layerEdits.setRadius,
    renameLayer: layerEdits.renameLayer,
    findText: findReplace.found,
    selectFound: findReplace.selectFound,
    replaceText: findReplace.replaceAll,
    setLocked: layerEdits.setLocked,
    setHidden: layerEdits.setHidden,
    onNotice,
    pickLayer,
    busy: pointer.busy,
    textSelection: () => typing.selectedText(),
    textSelectionStyles: () => typing.selectionStyles(),
    styleTextSelection: (style: RunStyle) => typing.styleSelectedText(style),
    onTextSelection: textSelection.on,
    textStyles: textStyles.state,
    fontFeatures: (family: string) => resources.resources().familyFeatures?.get(family) ?? null,
    onFontsArrive: (listener: () => void) =>
      resources.onArrive((fonts) => {
        if (fonts) listener()
      }),
    onSelection: (listener: (ids: string[]) => void) => selection.onSelection(listener),
    pickedFrame: () => selection.pickedFrame(),
    pickFrame: (frameId: string | null) => pickFrame(frameId),
    onFramePick: (listener: (frameId: string | null) => void) => selection.onFramePick(listener),
    lightFrame,
    lightLayer,
    showConstraints,
    renameFrame,
    onFrameRename: frameRenames.on,
    renamed: () => selection.renameFrame(null),
    onFrameDelete: frameActions.onFrameDelete,
    addFrame: frameActions.addFrame,
    addSize: frameActions.addSize,
    resizeFrame: frameActions.resizeFrame,
    rulers: () => view.rulers(),
    safeZones: () => view.safeZones(),
    setSafeZones,
    hiddenShown: () => view.hiddenShown(),
    setHiddenShown,
    snapping: () => tools.snapping(),
    snapWork: () => transformDrag.snapWork(),
    setSnapping: (on: boolean) => tools.setSnapping(on),
    onView: view.onView,
    frames: view.frames,
    middleFrame: () => view.middleFrame()?.id ?? null,
    shownPage: view.page,
    showPage,
    restoreVersion: restoring.restore,
    camera: view.camera,
    viewport: view.viewport,
    setCamera: view.setCamera,
    showOnStage: view.showOnStage,
    setInsets: view.setInsets,
    zoomTo: view.zoomTo,
    zoomIn: view.zoomIn,
    zoomOut: view.zoomOut,
    fitAll: view.fitAll,
    fitSelection: actions.fitSelection,
    fitFrame,
    setTool: (next: Tool) => tools.setTool(next),
    tool: () => tools.tool(),
    armImage: (asset: PlacedAsset | null) => {
      if (asset) tools.setTool('image', asset)
      else if (tools.tool() === 'image') tools.setTool('select')
    },
    imageArmed: () => tools.imageToPlace() !== null,
    onTool: (listener: (tool: Tool) => void) => tools.onTool(listener),
    boxOf,
    drawnPropsOf: (id: string) => boxes.drawnProps(id),
    loaded: () => resources.loaded(),
    onDraw: draws.on,
    onShown: redrawing.onShown,
    exportPixels: exporting.pixels,
    loadedFamilies: () => resources.families(),
    fontCheck: fontCheck.check,
    setFont: layerEdits.setFont,
    fontsUploaded: (families: readonly string[]) => resources.askAgain(families),
    variables: () => resources.bytes().variables ?? NO_VARIABLES,
    setVariables: (variables: Variables) => brandKit.setVariables(variables),
    bindSelection: (kind: ValueKind, ref: VariableRef | null) => brandKit.bindSelection(kind, ref),
    pickColour,
    stopPicking: () => void colourPick.stop(),
    picking: colourPick.picking,
    onPicking: colourPick.onPicking,
    stopEditing,
    settle,
    destroyed: () => signal.aborted,
    whenSettled: placeSvg.whenSettled,
    placeSvg: placeSvg.placeSvg,
    placeWhenSettled: placeSvg.placeWhenSettled,
    placeFigma: placeFigma.placeFigma,
    designSize: placeFigma.designSize,
    fillWithImage: (id: string, asset: PlacedAsset) => place.fillWithImage(id, asset),
    pageThumbnail: thumbnails.page,
    layerThumbnail: thumbnails.layer,
  })
  const routePointer = viewOnly.guard(pointer.route, { handled: true, hold: false })
  const core: EditorCore = {
    ...shared,
    ...viewOnly.guardAll({
      selectAt: pointer.selectAt,
      layersAt: pointer.layersAt,
      placeImage: (asset: PlacedAsset, where?: Point | Spot, options?: PlaceImageOptions) =>
        place.placeImage(asset, where, options),
      readSvg: (text: string, name: string, where?: Point | Spot) => placeSvg.readSvg(text, name, where),
      spotAt: view.spotOn,
      imageTarget: (stage: Point | null) => place.imageTarget(stage),
      stagePoint: view.stagePoint,
    }),
    input: {
      ...viewOnly.guardAll({
        cancelOnEscape: pointer.cancelOnEscape,
        blur: pointer.blur,
        hidden: () => {
          typing.pause()
          presence.hidden()
        },
        cursor: pointer.cursor,
        onCursor: pointer.onCursor,
      }),
      pointer: (input: PointerInput) => {
        const answer = routePointer(input)
        presence.pointed(input.type)
        return answer
      },
      key: viewOnly.guardKeys(keys.key),
      text: viewOnly.guard(typing.insert, false),
      deleteBackward: viewOnly.guard(typing.deleteBackward, false),
      fieldText: viewOnly.guard(typing.fieldText, null),
      fieldChanged: viewOnly.guard(typing.fieldChanged, false),
    },
    clipboard: viewOnly.guardAll({
      copy: place.copy,
      cut: place.cut,
      paste: (payload: Parameters<typeof place.paste>[0]) => place.paste(payload, pointer.pointerAt),
      copyLayers: place.copyLayers,
    }),
    setViewport: view.setViewport,
    redraw: redrawing.redraw,
  }
  return {
    core,
    shared,
    /**
     * The session itself, whose writes a read-only tab refuses by throwing, for a caller that runs
     * commands without a page: the agent tab. The page's is `core.session`.
     */
    session,
    nextDraw: draws.next,
    /** Tells the page a notice, for what the page's side does: Copy as PNG's outcome. */
    notify: notices.emit,
    /**
     * The editor's half of the recompute (D6), for the connection's client, and when to retry the
     * follow-ups it waited on: a load of fonts settled.
     */
    sync: { recompute: derivedValues(fit), onFontsSettled: resources.onSettle },
    modules: {
      view,
      resources,
      scenes,
      selection,
      boxes,
      typing,
      pen,
      drawing,
      autoLayoutDrag,
      transformDrag,
      frameResize,
      cropping,
      place,
      pngCopy,
      brandKit,
      colourPick,
      guideDrag,
      pointer,
      redrawing,
      presence,
    },
  }
}
