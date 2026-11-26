// The editor: a design's pages, each an infinite canvas with its frames where they were placed,
// shown one page at a time (#36); click to select, drag to move, typing into text, pan and zoom.
// It has no framework in it; the page only hands it a canvas and an overlay the size of the stage.
import type { CanvasKit } from '@dazbee/canvaskit'
import { readDesign } from '@dazbee/doc'
import { FALLBACK_FAMILIES } from '@dazbee/fonts'
import { type ResourceBytes, type ResourceCache, resourceCache } from '@dazbee/renderer'
import { fontUses, framesOf, imageAssetIds, inOrder, type Point, type Rect } from '@dazbee/schema'

import { type EditorArrivals,editorArrivals } from './ai/arrivals.ts'
import { editorOverlay } from './canvas/overlay.ts'
import { type EditorSurface, editorSurface } from './canvas/surface.ts'
import type { Motion, Spot } from './canvas/view.ts'
import type { Remembered } from './clipboard.ts'
import { editorClipboardEvents } from './clipboard-events.ts'
import { buildCore } from './core.ts'
import type { Editor, EditorOptions } from './editor-interface.ts'
import { exportClient } from './export/export-client.ts'
import { editorExportFiles } from './export/export-files.ts'
import { NO_FONTS, type OpenedFonts, openedFonts } from './font-loads.ts'
import { editorDomInput, onMac } from './gestures/dom-input.ts'
import { editorStageField } from './gestures/stage-field.ts'
import { imageClient } from './image-client.ts'
import { type OpenTab, openTab } from './open-tab.ts'
import { loadImages } from './resources.ts'
import { type SaveStateWatch, watchSaveState } from './save-state.ts'
import { tokenSource } from './token-source.ts'
import type { PlacedAsset, PlaceImageOptions } from './tools.ts'
import { loadCanvasKit, shippedFonts } from './vendor.ts'

/** The screen's animation frames and the system's reduced motion, which the camera's glides step on. */
export const SCREEN_MOTION: Motion = {
  nextFrame: (run) => {
    const frame = requestAnimationFrame(run)
    return () => cancelAnimationFrame(frame)
  },
  reduced: () => matchMedia('(prefers-reduced-motion: reduce)').matches,
}

/** What the editor keeps on this device between designs and visits, in the browser's storage, which throws where storage is off. */
export const ON_DEVICE: Remembered = {
  get: (key) => localStorage.getItem(key),
  set: (key, value) => localStorage.setItem(key, value),
}
export async function startEditor(options: EditorOptions) {
  const { designId } = options
  const status = options.onStatus ?? (() => {})
  status('Loading renderer')
  const ck: CanvasKit = await loadCanvasKit()
  // The fonts we ship, the fallbacks among them, load first; the design's own families once it is here.
  const fontBytes = await shippedFonts()
  const resourceBytes = {
    fonts: fontBytes,
    fallbackFamilies: [...FALLBACK_FAMILIES],
    images: {},
    ...(options.variables ? { variables: options.variables } : {}),
  }
  // One cache for the screen and exports: fonts and images are decoded once for the editor's life.
  const cache = resourceCache(ck)
  status('Connecting')
  // The tab copy kept in this browser opens at once, even offline; a first visit waits for the sync
  // server (D9), and one the server stops first throws `TabStopped`, whose state the page shows.
  let saving: SaveStateWatch | undefined
  let tab: OpenTab
  try {
    tab = await openTab({
      designId,
      member: options.member,
      url: options.syncUrl,
      token: tokenSource({ fetch: options.syncToken, member: options.member }),
      ...(options.signal ? { signal: options.signal } : {}),
    })
  } catch (error) {
    cache.delete()
    throw error
  }
  const { store, kept } = tab
  try {
    saving = watchSaveState({ link: tab.link, onSaveState: (state) => status(state) })
    // The first frame needs the images of the page it opens on, so they load first; another page's
    // load when it is shown or its thumbnail drawn, and an export's before it runs. Offline, a kept
    // design opens without them and they load when they can.
    const opened = readDesign(store)
    const firstPage = framesOf(opened, inOrder(opened.pages)[0]?.[0] ?? '').map(([id]) => id)
    const [images, fonts] = await Promise.all([
      loadImages(imageAssetIds(opened, firstPage, options.variables), options).catch((error: unknown) => {
        if (kept) return {}
        throw error
      }),
      openedFonts(fontUses(opened, options.variables), options).catch((error: unknown): OpenedFonts => {
        if (kept) return NO_FONTS
        throw error
      }),
    ])
    return live(
      ck,
      cache,
      {
        ...resourceBytes,
        fonts: [...resourceBytes.fonts, ...fonts.files.map(({ family, bytes }) => ({ family, bytes }))],
        images,
      },
      fonts,
      tab,
      saving,
      options,
    )
  } catch (error) {
    saving?.destroy()
    await tab.close()
    cache.delete()
    throw error
  }
}

/** The editor once the design has arrived: the core, and the page's side built on its modules. Everything it makes is freed by `destroy`. */
function live(
  ck: CanvasKit,
  cache: ResourceCache,
  firstBytes: ResourceBytes,
  firstFonts: OpenedFonts,
  tab: OpenTab,
  saving: SaveStateWatch,
  options: EditorOptions,
): Editor {
  const { canvas } = options
  // Ends the core and removes every listener the editor adds, on destroy.
  const listening = new AbortController()
  const { signal } = listening
  // The pauses of the window's keys and clipboard not yet resumed: a version viewed over the stage.
  let pauses = 0
  const copying = imageClient()
  signal.addEventListener('abort', () => copying.destroy())
  // The export worker draws the exports, and the frames picking a colour reads.
  const exporter = exportClient()
  const after = (ms: number, run: () => void) => {
    const timer = setTimeout(run, ms)
    return () => clearTimeout(timer)
  }
  const { core, shared, nextDraw, notify, modules, sync, session } = buildCore({
    ck,
    cache,
    first: firstBytes,
    firstFonts,
    store: tab.store,
    connected: saving.connected,
    // A Reviewer's tab, or one whose link ended, may only view the design (C35).
    access: tab.access,
    linkNotices: tab.linkNotices,
    presence: tab.presence,
    remembered: ON_DEVICE,
    onMac,
    signal,
    options,
    after,
    motion: SCREEN_MOTION,
    copyMaker: copying.make,
    sampler: { sample: exporter.sample, cancel: exporter.cancelSample },
  })
  tab.bind(sync, signal)
  const { view, resources, selection, boxes, scenes, typing, pen, cropping, drawing } = modules
  const {
    transformDrag,
    frameResize,
    frameMove,
    autoLayoutDrag,
    place,
    pngCopy,
    pointer,
    brandKit,
    redrawing,
    colourPick,
    guideDrag,
    presence,
  } = modules
  // What only a browser can run, in the code layout's order. A browser with no WebGL has no stage:
  // the core is ended, which frees what it made.
  let surface: EditorSurface
  try {
    surface = editorSurface({ ck, canvas, view, draw })
  } catch (error) {
    listening.abort()
    exporter.destroy()
    throw error
  }
  const exportingFiles = editorExportFiles({ session: core.session, resources, exporter, pngCopy })
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
    transformDrag,
    autoLayoutDrag,
    frameResize,
    place,
    frameMove,
    pointer,
    colourPick,
    guideDrag,
    presence,
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
    paused: () => pauses > 0,
    signal,
  })
  const arrivals: EditorArrivals | null = options.ai
    ? editorArrivals({
        session,
        ai: options.ai,
        designId: options.designId,
        newId: () => crypto.randomUUID(),
        after,
        shown: pageShown(signal),
        signal,
      })
    : null
  const clipboardEvents = editorClipboardEvents({
    clipboard: core.clipboard,
    canCopyPng: () => core.actionReady('copyPng'),
    picture: exportingFiles.png,
    notify,
    paused: () => pauses > 0,
    signal,
  })

  /** The frame callback: runs the redraw pass and puts its pictures on the stage's surface. */
  function draw() {
    core.redraw(surface.paint)
  }
  /** Pans, at the same zoom, so a frame of the shown page shows clear of the chrome, and out from under `panel` when it lies under it. */
  function showFrame(frameId: string, panel?: Rect) {
    const frame = view.frameOf(frameId)
    if (frame) surface.showArea(frame, panel)
  }
  /**
   * Pauses the window's keys and clipboard until the function it gives is called, once. Typing ends,
   * so the stage field takes no text, and the keys held are let go, as when the window loses the
   * focus, so none stays held through the pause.
   */
  function pauseInput() {
    if (pauses === 0) {
      shared.stopEditing()
      core.input.blur()
    }
    pauses++
    let resumed = false
    return () => {
      if (resumed) return
      resumed = true
      pauses--
    }
  }
  /** Where the app asks for something to be placed, a spot as it is and a point in client coordinates as a stage point. */
  function placeOnStage(where: Point | Spot | undefined) {
    return where && ('frameId' in where ? where : surface.onStage(where))
  }
  redrawing.onShown(overlay.draw)
  redrawing.onShown(stageField.place)
  // Another person's presence changed: only the overlay draws again, once at the next animation frame.
  let presenceFrame = 0
  const offPresence = presence.onChange(() => {
    presenceFrame ||= requestAnimationFrame(() => {
      presenceFrame = 0
      overlay.draw()
    })
  })
  signal.addEventListener('abort', () => {
    offPresence()
    cancelAnimationFrame(presenceFrame)
  })

  surface.resize()
  view.fitAll()
  options.onZoom?.(view.camera().zoom)
  draw()
  saving.start()

  brandKit.followBrandLogo()
  void brandKit.refitBrandText()

  return {
    ...shared,
    selectAt: (client: Point) => core.selectAt(surface.onStage(client)),
    layersAt: (client: Point) => core.layersAt(surface.onStage(client)),
    sectionAt: (client: Point) => core.sectionAt(surface.onStage(client)),
    placeImage: (asset: PlacedAsset, where?: Point | Spot, options?: PlaceImageOptions) =>
      core.placeImage(asset, placeOnStage(where), options),
    readSvg: (text: string, name: string, where?: Point | Spot) => core.readSvg(text, name, placeOnStage(where)),
    spotAt: (client: Point) => core.spotAt(surface.onStage(client)),
    imageTarget: (client: Point | null) => core.imageTarget(client && surface.onStage(client)),
    copyLayers: clipboardEvents.copyLayers,
    copyPng: clipboardEvents.copyPng,
    selectionRect: overlay.selectionRect,
    labelRect: overlay.labelRect,
    showFrame,
    screenPoint: surface.screenPoint,
    drawn: () => (surface.scheduled() ? nextDraw() : Promise.resolve()),
    exportFiles: exportingFiles.files,
    synced: tab.synced,
    keptOnDevice: tab.flushed,
    fetchVersion: tab.fetchVersion,
    pauseInput,
    startBrief: (request) =>
      arrivals
        ? arrivals.startBrief(request)
        : Promise.resolve({ ok: false, refusal: null, message: 'AI isn’t set up for this editor' }),
    destroy() {
      listening.abort()
      exporter.destroy()
      saving.destroy()
      void tab.close()
      cache.delete()
      surface.destroy()
    },
  }
}

/** Whether the page is shown, and when that changes, until `signal` aborts: a hidden tab reads no AI results. */
function pageShown(signal: AbortSignal) {
  return {
    now: () => document.visibilityState === 'visible',
    onChange: (listener: () => void) => {
      document.addEventListener('visibilitychange', listener, { signal })
      return () => document.removeEventListener('visibilitychange', listener)
    },
  }
}
