// The stage's view of the canvas: the camera, the stage's size and the edges chrome covers, the page
// it shows and that page's frames as last drawn, the design with other tabs' previews and this tab's
// composition put in (D7),
// the frames in view, the rulers, the safe zones, whether the hidden layers are shown, the points between the stage
// and the design, and the listeners told when a redraw is asked for.
import { previewedDesign, type PreviewRead, type Session, type StorePreviews } from '@dazbee/doc'
import { type Design, inOrder, type Layer, type Point, type Rect, type SafeZoneChoice } from '@dazbee/schema'

import { listenerSet } from '../listener-set.ts'
import {
  type Camera,
  coverOf,
  fit,
  framesInView,
  type Insets,
  NO_INSETS,
  reveal,
  revealBeside,
  revealLabel,
  revealWhole,
  toScreen,
  toWorld,
  under,
  type Viewport,
  widen,
  zoomAt,
  zoomStep,
} from './camera.ts'
import { type Frame, frameAt, frameNearest, pageFrames } from './frames.ts'

/** A point on the design: a frame, by its id, and a point in it in design pixels. */
export interface Spot {
  frameId: string
  x: number
  y: number
}

/** What the page gives for the camera's glides: the screen's animation frames and the system's motion setting. */
export interface Motion {
  /** Calls back once, at the screen's next animation frame, with its time in milliseconds; gives what cancels it. */
  nextFrame: (run: (at: number) => void) => () => void
  /** Whether the system asks for reduced motion. */
  reduced: () => boolean
}

export interface ViewDeps {
  session: Pick<Session, 'design' | 'changes'>
  /** Other tabs' open steps, which the frames' pictures show (D7); none for a store no other tab shares. */
  previews?: Pick<StorePreviews, 'layers' | 'revision'> | undefined
  /**
   * The text layer an input method's composition draws, by its id, and a count raised each time it
   * changes (`text/typing`, late-bound): only the frames' pictures show it. None without it.
   */
  composition?: () => { count: number; composed: { id: string; layer: Layer } | null }
  /** Told with the zoom (1 is 100%) whenever it changes. */
  onZoom: (zoom: number) => void
  /** The animation frames glides step on; without them, a glide moves straight to its end. */
  motion?: Motion | undefined
}

export interface EditorView {
  camera(): Camera
  /** The stage's size, in CSS pixels, as last set. */
  viewport(): Viewport
  /** Screen pixels per CSS pixel, as last set. */
  dpr(): number
  /** The design as last drawn. */
  design(): Design
  /**
   * The design as last drawn with the layers other tabs' previews show otherwise put in (D7), and the
   * text being composed in as its composition draws it, in place of another tab's preview of it:
   * only the frames' pictures show it. Panels, selection, hit tests and commands read `design`.
   */
  previewed(): Design
  /** The frames the previewed layers are in, as last drawn or as previewed: the pictures that differ. */
  previewedFrames(): ReadonlySet<string>
  /** The shown page's frames as last drawn, by order. */
  frames(): Frame[]
  /** The shown page's frame with an id, as last drawn, if there is one. */
  frameOf(id: string | undefined): Frame | undefined
  /** The page the canvas shows. */
  page(): string
  /** The frames the last redraw drew: the ones in view then. */
  inView(): Frame[]
  /** The frame in the middle of the view, if one is there. */
  middleFrame(): Frame | undefined
  /** The frame in the middle of the view, else the one nearest the middle; none on a page with no frames. */
  nearestFrame(): Frame | undefined
  /** Whether the rulers along the stage's edges show. */
  rulers(): boolean
  /** The safe zones shown over the 9:16 frames: a platform's by its name, all together (`ALL_PLATFORMS`) or none (null). */
  safeZones(): SafeZoneChoice | null
  /** Whether the stage draws the design's hidden layers, faded, as only this tab sees them. */
  hiddenShown(): boolean
  /** The frame under a point on the stage, and the point in its design pixels. */
  pointOn(stage: Point): { frame: Frame; p: Point } | null
  /** The spot under a point on the stage: the frame there and the point in it. */
  spotOn(stage: Point): Spot | null
  /** The shown page's frame with an id, its first by default. Throws when the shown page has no such frame. */
  defaultFrame(frameId?: string): Frame
  /** Where a design pixel of a frame of the shown page is on the stage now; its first frame by default. */
  stagePoint(x: number, y: number, frameId?: string): Point
  /**
   * Reads the design for a redraw: a shown page that is gone shows the first page again, and the
   * shown page's frames are laid out again.
   */
  update(): void
  /**
   * Works out the frames in view at the camera, which `inView` answers from then on. A redraw asks
   * before it records their pictures.
   */
  findInView(): Frame[]
  /** Sets the stage's size, in CSS pixels, and the screen's pixels for each; it asks for no redraw. */
  setViewport(next: Viewport & { dpr: number }): void
  setCamera(next: Camera): void
  /** The stage's edges floating chrome covers, in screen pixels, as last set. */
  insets(): Insets
  /** The stage's edges floating chrome covers, in screen pixels; later fits keep clear of them. */
  setInsets(next: Insets): void
  zoomTo(zoom: number, at?: Point): void
  /** Zooms about the middle of the stage to the zoom step above the percent shown; nothing at the top step. */
  zoomIn(): void
  /** Zooms about the middle of the stage to the zoom step below the percent shown; nothing at the bottom step. */
  zoomOut(): void
  /** Shows a page, the first page for one the design lacks: reads the design, lays out its frames at once and fits them. */
  showPage(pageId: string): void
  /** Fits the shown page's frames in view; on a page with none, puts the page's origin in the middle at 100%. */
  fitAll(): void
  /** Fits a part of the canvas in view, in world units; nothing without one. */
  fitArea(area: Rect | undefined): void
  /**
   * Pans, keeping the zoom, so a part of the canvas shows beside the chrome with room for a frame's
   * label over it, centred; nothing when it already does. Given `beside`, a panel floating over the
   * stage and the stage, both at their places on the page, it pans only a part that lies under the
   * panel, to show it clear of the panel too.
   */
  showArea(area: Rect, beside?: { panel: Rect; stage: Rect }): void
  /**
   * Glides to show a part of the canvas whole beside the chrome with room for a frame's label over
   * it (`revealWhole`): nothing when it shows already, else along the least pan, zoomed out about the
   * middle of the stage only as far as it needs, eased out over GLIDE_MS, one camera step for each
   * animation frame once the redraw pass has drawn the last, each moving it on by at most
   * GLIDE_STEP_MS. Any other camera move stops the glide where it is. With reduced motion, or no
   * animation frames given, the camera moves straight to the end. Given `cover`, the stage's edges a
   * sheet over it covers, in screen pixels, it keeps clear of them too; with `zoomOut` false it keeps
   * the zoom, and a part too big for the clear part shows from its top start corner.
   */
  showWhole(area: Rect, options?: { cover?: Partial<Insets>; zoomOut?: boolean }): void
  /**
   * As `showWhole`, for a part of the stage given in its pixels, as the selection's box on the
   * overlay is, from where the camera shows it now.
   */
  showOnStage(rect: Rect, cover: Partial<Insets>, zoomOut: boolean): void
  /** Stops a glide under way where it is, as a press that pans does before the pointer moves. */
  stopGlide(): void
  /** Pans, keeping the zoom, so a frame's label shows beside the chrome; nothing when it already does. */
  showLabel(frame: Rect): void
  /** Turns the rulers on or off; the view listeners hear of it from `viewChanged`. */
  toggleRulers(): void
  /** Shows a platform's safe zones, all of them together or none; the view listeners hear of it from `viewChanged`. */
  setSafeZones(platform: SafeZoneChoice | null): void
  /** Shows the hidden layers on the stage or stops, and asks for a redraw; the view listeners hear of it from `viewChanged`. */
  setHiddenShown(on: boolean): void
  /** Tells the view listeners that the rulers, snapping or the hidden layers turned on or off, or other safe zones show. */
  viewChanged(): void
  /** Calls back whenever the rulers, snapping or the hidden layers turn on or off, or other safe zones show. */
  onView(listener: () => void): () => boolean
  /** Asks for a redraw: tells the `onRedraw` listeners. */
  redraw(): void
  /** Calls back whenever a redraw is asked for. */
  onRedraw(listener: () => void): () => boolean
  destroy(): void
}

/** How long a glide takes, in milliseconds. */
const GLIDE_MS = 300
/**
 * The most of a glide one step moves it on, in milliseconds, a little over a frame at 60 Hz, so a
 * step that comes late, on a busy page, doesn't skip it most of the way.
 */
const GLIDE_STEP_MS = 20

/** No frame. */
const NO_FRAMES: ReadonlySet<string> = new Set()
/** No previewed layer. */
const NO_LAYERS: ReadonlyMap<string, unknown> = new Map()

export function editorView({ session, previews, composition, onZoom, motion }: ViewDeps): EditorView {
  /** Screen pixels per CSS pixel. */
  let dpr = 1
  /** The stage's size, in CSS pixels. */
  let viewport: Viewport = { width: 1, height: 1 }
  // The stage's edges that floating chrome covers; fitting centres in what is left (#83).
  let insets = NO_INSETS
  /** The design as last drawn. */
  let design: Design = session.design()
  /**
   * The design as last drawn with others' previews and the composition put in, the frames that makes
   * differ, and what it was read at.
   */
  let shownWithPreviews = { design, frames: NO_FRAMES, changes: null as number | null, revision: -1, composed: 0 }
  /** Each previewed layer as last read: one this tab's own edits leave as it was is the same layer, so its frame's picture is kept. */
  const previewReads = new Map<string, PreviewRead>()
  /** The page the canvas shows: the first page by order, until another is shown. */
  let shown = firstPageOf(design)
  /** The shown page's frames as last drawn, and the box round them. */
  let laid = pageFrames(design, shown)
  /** Where the canvas is on the stage, and its zoom. */
  let camera: Camera = { x: 0, y: 0, zoom: 1 }
  /** The rulers are off until asked for (Shift+R or the View card): the stage is for the ads. */
  let rulers = false
  /** The platform whose safe zones show, or all together; none until asked for in the View card, and nothing keeps it. */
  let safeZones: SafeZoneChoice | null = null
  /** Whether the stage draws the hidden layers: off in every new tab, and nothing keeps it. */
  let hidden = false
  /** Told when the rulers, snapping or the hidden layers turn on or off, or other safe zones show, so the menus follow a shortcut too. */
  const viewListeners = new Set<() => void>()
  /** Told when a redraw is asked for. */
  const redrawListeners = listenerSet<[]>()
  /** The frames the last redraw drew. */
  let drawnFrames: Frame[] = []
  /**
   * The glide under way: where it started and ends, how far along it is in milliseconds, the time of
   * the animation frame it last moved at, whether a redraw pass has drawn its last step, and what
   * cancels its next step.
   */
  let glide: {
    from: Camera
    to: Camera
    elapsed: number
    last: number | null
    drawn: boolean
    cancel: () => void
  } | null = null
  function currentCamera() {
    return camera
  }
  function currentViewport() {
    return viewport
  }
  function currentDpr() {
    return dpr
  }
  function drawn() {
    return design
  }
  function frames() {
    return laid.frames
  }
  function frameOf(id: string | undefined) {
    return laid.frames.find((f) => f.id === id)
  }
  function shownPage() {
    return shown
  }
  function inView() {
    return drawnFrames
  }
  function centre(): Point {
    return { x: viewport.width / 2, y: viewport.height / 2 }
  }
  function middleFrame() {
    return frameAt(laid.frames, toWorld(camera, centre()))
  }
  function nearestFrame() {
    return frameNearest(laid.frames, toWorld(camera, centre()))
  }
  function rulersShown() {
    return rulers
  }
  function pointOn(stage: Point) {
    const world = toWorld(camera, stage)
    const frame = frameAt(laid.frames, world)
    return frame ? { frame, p: { x: world.x - frame.x, y: world.y - frame.y } } : null
  }
  function spotOn(stage: Point): Spot | null {
    const at = pointOn(stage)
    return at ? { frameId: at.frame.id, x: at.p.x, y: at.p.y } : null
  }
  const defaultFrame = (frameId?: string) => {
    const found = frameId === undefined ? laid.frames[0] : frameOf(frameId)
    if (found) return found
    throw new Error(frameId === undefined ? 'the shown page has no frames' : `no frame "${frameId}" on the shown page`)
  }
  function stagePoint(x: number, y: number, frameId?: string): Point {
    const frame = defaultFrame(frameId)
    return toScreen(camera, { x: frame.x + x, y: frame.y + y })
  }

  function update() {
    design = session.design()
    if (!Object.hasOwn(design.pages, shown)) shown = firstPageOf(design)
    laid = pageFrames(design, shown)
    readPreviews()
  }
  /**
   * Puts the previewed layers and the composed text into the design as last drawn, when the design,
   * the previews or the composition changed.
   */
  function readPreviews() {
    const changes = session.changes()
    const revision = previews?.revision() ?? -1
    const read = composition?.()
    const composed = read?.count ?? 0
    const was = shownWithPreviews
    // With no count known, as inside a transaction, the previews are read again.
    if (changes !== null && was.changes === changes && was.revision === revision && was.composed === composed)
      return
    const previewed = previews?.layers() ?? NO_LAYERS
    // The composed text's offsets are this tab's: it stands in place of another tab's preview of it.
    const layers = read?.composed ? new Map(previewed).set(read.composed.id, read.composed.layer) : previewed
    const withPreviews = previewedDesign(design, layers, previewReads)
    shownWithPreviews = {
      design: withPreviews,
      frames: withPreviews === design ? NO_FRAMES : framesOf(layers.keys(), design, withPreviews),
      changes,
      revision,
      composed,
    }
  }
  function findInView() {
    if (glide) glide.drawn = true
    drawnFrames = framesInView(laid.frames, camera, viewport)
    return drawnFrames
  }
  function setViewport(next: Viewport & { dpr: number }) {
    viewport = { width: next.width, height: next.height }
    dpr = next.dpr
  }
  function setCamera(next: Camera) {
    stopGlide()
    place(next)
  }
  /** Puts the camera where a move or a glide's step takes it. */
  function place(next: Camera) {
    const zoomed = next.zoom !== camera.zoom
    camera = next
    if (zoomed) onZoom(camera.zoom)
    redraw()
  }
  function setInsets(next: Insets) {
    insets = next
  }
  function zoomTo(zoom: number, at: Point = centre()) {
    setCamera(zoomAt(camera, at, zoom))
  }
  function zoomIn() {
    zoomBy('in')
  }
  function zoomOut() {
    zoomBy('out')
  }
  function zoomBy(direction: 'in' | 'out') {
    const next = zoomStep(camera.zoom, direction)
    if (next !== null) zoomTo(next)
  }
  function showPage(pageId: string) {
    shown = pageId
    update()
    fitAll()
  }
  function fitAll() {
    if (laid.bounds) setCamera(fit(laid.bounds, viewport, undefined, insets))
    else setCamera({ ...centre(), zoom: 1 })
  }
  function fitArea(area: Rect | undefined) {
    if (area) setCamera(fit(area, viewport, undefined, insets))
  }
  function showArea(area: Rect, beside?: { panel: Rect; stage: Rect }) {
    // Beside a panel, only an area it lies over moves, and then clear of it too.
    if (beside && !under(camera, area, beside.panel, beside.stage)) return
    const next = beside
      ? revealBeside(camera, area, viewport, insets, coverOf(beside.panel, beside.stage))
      : reveal(camera, area, viewport, insets)
    if (next !== camera) setCamera(next)
  }
  function showWhole(area: Rect, { cover = {}, zoomOut = true }: { cover?: Partial<Insets>; zoomOut?: boolean } = {}) {
    stopGlide()
    const next = revealWhole(camera, area, viewport, widen(insets, cover), { zoomOut })
    if (next === camera) return
    if (!motion || motion.reduced()) place(next)
    else glide = { from: camera, to: next, elapsed: 0, last: null, drawn: true, cancel: motion.nextFrame(step) }
  }
  function showOnStage(rect: Rect, cover: Partial<Insets>, zoomOut: boolean) {
    const start = toWorld(camera, rect)
    showWhole({ ...start, width: rect.width / camera.zoom, height: rect.height / camera.zoom }, { cover, zoomOut })
  }
  /**
   * Moves a glide's camera on by the time since it last moved, at most GLIDE_STEP_MS, and waits for
   * the next animation frame until it ends. The first frame only marks the time, and a frame before
   * a redraw pass has drawn the last step only waits on it. The next frame is asked for after the
   * step asks for its redraw, so the redraw comes first in it.
   */
  function step(at: number) {
    if (!glide || !motion) return
    if (glide.last === null || !glide.drawn) {
      glide.last ??= at
      glide.cancel = motion.nextFrame(step)
      return
    }
    glide.elapsed += Math.min(GLIDE_STEP_MS, Math.max(0, at - glide.last))
    glide.last = at
    const t = Math.min(1, glide.elapsed / GLIDE_MS)
    const { from, to } = glide
    if (t === 1) {
      glide = null
      place(to)
      return
    }
    const eased = 1 - (1 - t) ** 3
    glide.drawn = false
    place({
      zoom: from.zoom + (to.zoom - from.zoom) * eased,
      x: from.x + (to.x - from.x) * eased,
      y: from.y + (to.y - from.y) * eased,
    })
    // A listener told of the step may have moved the camera, which stops the glide.
    if (glide) glide.cancel = motion.nextFrame(step)
  }
  function stopGlide() {
    glide?.cancel()
    glide = null
  }
  function showLabel(frame: Rect) {
    const next = revealLabel(camera, frame, viewport, insets)
    if (next !== camera) setCamera(next)
  }
  function toggleRulers() {
    rulers = !rulers
  }
  function setSafeZones(platform: SafeZoneChoice | null) {
    safeZones = platform
  }
  function setHiddenShown(on: boolean) {
    hidden = on
    redraw()
  }
  function viewChanged() {
    for (const listener of viewListeners) listener()
  }
  function redraw() {
    redrawListeners.emit()
  }
  function onView(listener: () => void) {
    viewListeners.add(listener)
    return () => viewListeners.delete(listener)
  }

  function destroy() {
    stopGlide()
    viewListeners.clear()
    redrawListeners.clear()
  }

  return {
    camera: currentCamera,
    viewport: currentViewport,
    dpr: currentDpr,
    design: drawn,
    previewed: () => shownWithPreviews.design,
    previewedFrames: () => shownWithPreviews.frames,
    frames,
    frameOf,
    page: shownPage,
    inView,
    middleFrame,
    nearestFrame,
    rulers: rulersShown,
    safeZones: () => safeZones,
    hiddenShown: () => hidden,
    pointOn,
    spotOn,
    defaultFrame,
    stagePoint,
    update,
    findInView,
    setViewport,
    setCamera,
    insets: () => insets,
    setInsets,
    zoomTo,
    zoomIn,
    zoomOut,
    showPage,
    fitAll,
    fitArea,
    showArea,
    showWhole,
    showOnStage,
    stopGlide,
    showLabel,
    toggleRulers,
    setSafeZones,
    setHiddenShown,
    viewChanged,
    onView,
    redraw,
    onRedraw: redrawListeners.on,
    destroy,
  }
}

/**
 * Whether turning the hidden layers shown on or off would change it: shown, they stop whatever the
 * design has; else they start while it has a hidden layer the stage would show, in any frame of
 * any page: any but a boolean's hidden shape, which stays out (`render`).
 */
export function hiddenToggles(design: Design, shown: boolean) {
  if (shown) return true
  for (const node of Object.values(design.nodes)) {
    if (node.props.visible === false && design.nodes[node.parentId]?.type !== 'boolean') return true
  }
  return false
}

/** The frames layers `ids` are in, in either design. */
function framesOf(ids: Iterable<string>, ...designs: Design[]): ReadonlySet<string> {
  const frames = new Set<string>()
  for (const id of ids) {
    for (const d of designs) {
      let up = d.nodes[id]?.parentId
      for (let steps = 0; up !== undefined && !Object.hasOwn(d.frames, up) && steps < 1_000; steps++)
        up = d.nodes[up]?.parentId
      if (up !== undefined && Object.hasOwn(d.frames, up)) frames.add(up)
    }
  }
  return frames
}

/** The design's first page by order, or '' with none. */
function firstPageOf(design: Design) {
  return inOrder(design.pages)[0]?.[0] ?? ''
}
