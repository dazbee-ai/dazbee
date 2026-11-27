// A version of the design shown read-only on a canvas of its own, laid over the live editor's stage:
// a second core opened on a plain store holding the version, whose access only ever views, with the
// surface, the overlay and the page's input the editor builds, and no link. It loads the fonts we
// ship and the version's own fonts and images through the live editor's sources, and opens on the
// page it is given when the version has it. Its copy keeps the layers on this device, so they can be
// pasted into the live design; Copy as PNG copies nothing, and it never shows the hidden layers.
// `destroy` frees all it made.
import { plainStore } from '@dazbee/doc'
import { FALLBACK_FAMILIES } from '@dazbee/fonts'
import { resourceCache } from '@dazbee/renderer'
import { fontUses, framesOf, imageAssetIds, inOrder, type Point, type Rect } from '@dazbee/schema'

import { editorOverlay } from './canvas/overlay.ts'
import { type EditorSurface, editorSurface } from './canvas/surface.ts'
import { editorClipboardEvents } from './clipboard-events.ts'
import { buildCore } from './core.ts'
import type { TabAccess } from './core-interface.ts'
import { ON_DEVICE, SCREEN_MOTION } from './editor.ts'
import type { Viewer, ViewerOptions } from './editor-interface.ts'
import { openedFonts } from './font-loads.ts'
import { editorDomInput, onMac } from './gestures/dom-input.ts'
import { editorStageField } from './gestures/stage-field.ts'
import { imageClient } from './image-client.ts'
import { loadImages } from './resources.ts'
import { loadCanvasKit, shippedFonts } from './vendor.ts'

/** A viewer's access: it only ever views, and a refused edit goes untold, as the page says it views a version. */
const VIEWS_ONLY: TabAccess = { readOnly: () => true, quiet: () => true, onChange: () => () => {} }

export async function startViewer(options: ViewerOptions): Promise<Viewer> {
  const { design, canvas } = options
  const opening =
    options.page !== undefined && design.pages[options.page] ? options.page : inOrder(design.pages)[0]?.[0]
  const firstPage = framesOf(design, opening ?? '').map(([id]) => id)
  const [ck, shipped, images, fonts] = await Promise.all([
    loadCanvasKit(),
    shippedFonts(),
    loadImages(imageAssetIds(design, firstPage, options.variables), options),
    openedFonts(fontUses(design, options.variables), options),
  ])
  // A cache of the viewer's own, freed with it: the live editor's stays as it was.
  const cache = resourceCache(ck)
  const listening = new AbortController()
  const { signal } = listening
  const copying = imageClient()
  signal.addEventListener('abort', () => copying.destroy())
  const { core, shared, nextDraw, notify, modules } = buildCore({
    ck,
    cache,
    first: {
      fonts: [...shipped, ...fonts.files.map(({ family, bytes }) => ({ family, bytes }))],
      fallbackFamilies: [...FALLBACK_FAMILIES],
      images,
      ...(options.variables ? { variables: options.variables } : {}),
    },
    firstFonts: fonts,
    store: plainStore(design),
    connected: () => true,
    access: VIEWS_ONLY,
    remembered: ON_DEVICE,
    onMac,
    signal,
    options,
    after: (ms, run) => {
      const timer = setTimeout(run, ms)
      return () => clearTimeout(timer)
    },
    motion: SCREEN_MOTION,
    copyMaker: copying.make,
    hiddenShowable: false,
  })
  const { view, selection, boxes, scenes, typing, pen, cropping, drawing, connecting } = modules
  const { transformDrag, frameResize, frameMove, autoLayoutDrag, place, pointer, colourPick, guideDrag, presence } =
    modules
  const { redrawing, selectPress } = modules
  // What only a browser can run, as the editor builds it. A browser with no WebGL has no stage.
  let surface: EditorSurface
  try {
    surface = editorSurface({ ck, canvas, view, draw })
  } catch (error) {
    listening.abort()
    cache.delete()
    throw error
  }
  const overlay = editorOverlay({
    overlay: options.overlay,
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
    selectPress,
    colourPick,
    guideDrag,
    presence,
    // A viewed version has no AI frames.
    aiWaiting: () => [],
    aiEditable: () => new Set(),
  })
  const stageField = editorStageField({
    overlay: options.overlay,
    input: core.input,
    editing: typing.editing,
    onTextSelection: shared.onTextSelection,
    label: options.typingFieldLabel,
    signal,
  })
  editorDomInput({
    canvas,
    overlay: options.overlay,
    surface,
    input: core.input,
    composing: stageField.composing,
    keyTaken: stageField.keyTaken,
    picking: { picking: shared.picking, stop: shared.stopPicking },
    signal,
  })
  const clipboardEvents = editorClipboardEvents({
    clipboard: core.clipboard,
    canCopyPng: () => false,
    picture: () => null,
    notify,
    signal,
  })

  /** The frame callback: runs the redraw pass and puts its pictures on the viewer's surface. */
  function draw() {
    core.redraw(surface.paint)
  }
  /** Pans, at the same zoom, so a frame of the shown page shows clear of the chrome, and out from under `panel`. */
  function showFrame(frameId: string, panel?: Rect) {
    const frame = view.frameOf(frameId)
    if (frame) surface.showArea(frame, panel)
  }
  redrawing.onShown(overlay.draw)
  redrawing.onShown(stageField.place)

  surface.resize()
  if (opening !== undefined) shared.showPage(opening)
  view.fitAll()
  options.onZoom?.(view.camera().zoom)
  draw()

  return {
    ...shared,
    selectAt: (client: Point) => core.selectAt(surface.onStage(client)),
    layersAt: (client: Point) => core.layersAt(surface.onStage(client)),
    sectionAt: (client: Point) => core.sectionAt(surface.onStage(client)),
    spotAt: (client: Point) => core.spotAt(surface.onStage(client)),
    copyLayers: clipboardEvents.copyLayers,
    copyPng: clipboardEvents.copyPng,
    selectionRect: overlay.selectionRect,
    labelRect: overlay.labelRect,
    showFrame,
    screenPoint: surface.screenPoint,
    drawn: () => (surface.scheduled() ? nextDraw() : Promise.resolve()),
    destroy() {
      surface.destroy()
      listening.abort()
      cache.delete()
    },
  }
}
