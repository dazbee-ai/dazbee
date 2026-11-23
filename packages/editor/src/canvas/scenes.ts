// Scenes and pictures by frame. A frame is recorded again only when a layer it shows or the frame
// itself changed: dragging in one frame leaves the other frames' pictures as they are, and panning
// records nothing. A frame another tab's preview shows otherwise is pictured from the previewed
// design (D7), kept apart; its scene, which hit tests and outlines read, stays the drawn one. While
// hidden layers are shown, the stage draws, hits and outlines each frame's shown scene, which holds
// them faded, kept apart too; `scene`, which thumbnails and the rest read, never holds them.
import type { CanvasKit, Path, SkPicture } from '@dazbee/canvaskit'
import { childrenOf } from '@dazbee/doc'
import {
  drawFrame,
  drawLayers,
  layerPictures,
  lru,
  type MeasureText,
  outlineOf,
  type ParagraphCache,
  paragraphCache,
  render,
  type Resources,
  type Scene,
  type SceneLayer,
  sceneMemo,
  type TextLayout,
  textMeasure,
  type TurnedRect,
} from '@dazbee/renderer'
import { cornerRadiiOf, type Design, type Point, type Rect, type Variables } from '@dazbee/schema'

import type { EditorResources } from '../resources.ts'
import type { Frame, FramePicture } from './frames.ts'
import { type HitOptions, hitTest, layersAt, type LayerUnder, lineBoxes, type Looks, outlineBand } from './hit-test.ts'

export interface ScenesDeps {
  ck: CanvasKit
  resources: EditorResources
  /** The design as last drawn, which the scenes show. */
  drawn: () => Design
  /**
   * How many times the design has changed (`Session.changes`): while the count stays, it shows what
   * it showed. Null while a transaction is open, when the scenes look at the design's layers instead.
   */
  changes: () => number | null
  /** The design as last drawn with other tabs' previews put in, and the frames that differ in it (`EditorView`). */
  previewed?: () => { design: Design; frames: ReadonlySet<string> }
  /** The session's design, one object that changes as the design does (`Session.design`); `drawn` unless told. */
  live?: () => Design
  /** Whether the stage shows the hidden layers (`EditorView.hiddenShown`); never unless told. */
  hiddenShown?: () => boolean
}

export interface FrameScenes {
  /** A frame's scene, made again only when what it shows changed: its hidden layers left out, as every export leaves them. */
  scene(frame: Frame): Scene
  /**
   * The scene the stage draws a frame from, and hit tests and outlines read: `scene`, or while
   * hidden layers are shown, one holding them too, faded (HIDDEN_SHOWN_OPACITY).
   */
  shownScene(frame: Frame): Scene
  /** Measures text with the fonts the screen draws with, as auto layout does. */
  measure(): MeasureText
  /**
   * A frame's layers as a design lays them out, which may be newer than the one last drawn; layers
   * that stay as they were keep their layout. Kept by design and frame (`laidOutLayers`).
   */
  laidOut(frameId: string, design: Design): SceneLayer[]
  /** A layer of a frame as a design lays it out, by id, from what `laidOut` keeps; undefined when the frame shows none. */
  laidOutLayer(frameId: string, design: Design, id: string): SceneLayer | undefined
  /** Text laid out as drawn, from the screen's cache, which owns it. */
  layout(props: Parameters<ParagraphCache['layout']>[1]): TextLayout
  /**
   * The outline the overlay draws round a layer of a frame as last drawn (`outlinePathOf`), from
   * the outline a hit test reads; made again only when the layer changes. Null for a layer that
   * keeps a rectangle, or none in the frame.
   */
  outlinePath(frame: Frame, id: string): OutlinePath | null
  /** How many outline paths have been made since the editor opened, for the checks that count work. */
  outlinePaths(): number
  /** The layer that shows under a point of a frame, as a click or a hover picks it (`hitTest`). */
  hit(frame: Frame, p: Point, options?: HitOptions): SceneLayer | null
  /** Every layer that shows under a point of a frame, front-most first, with its depth (`layersAt`). */
  under(frame: Frame, p: Point, options?: HitOptions): LayerUnder[]
  /**
   * The pictures of the frames in view for a redraw, `all` being every frame of the shown page: each
   * one recorded again where it changed, and how many were. A frame off the shown page lets go of its
   * picture and keeps its scene until the design has no such frame.
   */
  pictures(all: Frame[], inView: Frame[], screen: Resources): { pictures: FramePicture[]; recorded: number }
  /**
   * A picture of some of a frame's layers, each with what it holds, in the frame's design pixels and
   * not cut to the frame: what a drag carries past the frame's edge. Kept until asked for another.
   */
  ghost(frame: Frame, ids: readonly string[], screen: Resources): SkPicture
  destroy(): void
}

/** What `laidOutLayers` builds a frame's layers from, and how it tells the design the editor shows from one kept apart. */
export interface LaidOutDeps {
  /** A frame's layers as a design lays them out. */
  build(frameId: string, design: Design): SceneLayer[]
  /** The design the session shows, one object that changes as the design does; any other design given is kept as it is. */
  live: () => Design
  /** How many times the design has changed (`Session.changes`); null while a transaction is open, when nothing is kept for `live`. */
  changes: () => number | null
  /** What else the layout reads, such as the text measure and the brand kit's variables: other objects lay it out again. */
  inputs?: () => readonly unknown[]
}

/**
 * A layer's outline as SVG path data, in the coordinates its `box` has: where the layer is before
 * it is turned, in its parent.
 */
export interface OutlinePath {
  d: string
  box: Rect
}

/** A frame's laid-out layers, what they were laid out with, and those layers by id once asked for. */
interface LaidOutEntry {
  changes: number | null
  inputs: readonly unknown[]
  layers: SceneLayer[]
  byId: Map<string, SceneLayer> | null
}

/** A frame's scene and its recorded drawing, kept until the layers it shows change. */
interface FrameCache {
  deps: unknown[]
  /** The design's change count and the variables the deps were last checked at: while both stay, nothing changed. */
  checked: { changes: number | null; variables: unknown }
  scene: Scene
  picture: SkPicture | null
}

/** The share of its opacity the stage draws a hidden layer at while hidden layers are shown. */
export const HIDDEN_SHOWN_OPACITY = 0.25

const sameDeps = (a: readonly unknown[], b: readonly unknown[]) =>
  a.length === b.length && a.every((x, i) => x === b[i])

export function frameScenes({
  ck,
  resources,
  drawn,
  changes,
  previewed,
  live = drawn,
  hiddenShown = () => false,
}: ScenesDeps): FrameScenes {
  /** Each frame's scene and picture, by frame id. */
  const frames = new Map<string, FrameCache>()
  /** Each frame's shown scene and picture, with its hidden layers, while they are shown. */
  const withHidden = new Map<string, FrameCache>()
  /** The scene and picture of each frame a preview shows otherwise, from the previewed design. */
  const previewedFrames = new Map<string, FrameCache>()
  /** The resources the pictures were recorded with; others record them all again. */
  let picturesFor: Resources | null = null
  /** The resources pictures are recorded with, the text and layer caches added, for `picturesFor`. */
  let recordingWith: { for: Resources; resources: Resources } | null = null
  // Auto layout measures text with the fonts the screen draws with (#46); a new font set measures anew.
  let measuring: { for: Resources; measure: MeasureText } | null = null
  /** The last ghost asked for, by the scene and layers it shows. */
  let ghosted: { scene: Scene; ids: string; picture: SkPicture } | null = null
  // Text laid out and layers recorded once and kept: recording a frame again records only the
  // layers that changed, and lays out only the text that did.
  const paragraphs = paragraphCache()
  const scenes = sceneMemo()
  /** The shown scenes' layers, kept apart: a layer holding a hidden one differs there. */
  const hiddenScenes = sceneMemo()
  const layers = layerPictures()
  /** Frames laid out by design, kept while the design, the measure and the variables stay. */
  const laid = laidOutLayers({
    build: (frameId, design) => render(design, frameId, scenes, measure(), resources.bytes().variables).layers,
    live,
    changes,
    inputs: () => [measure(), resources.bytes().variables],
  })
  // Outlines and their bands by reach that a hit test reads, kept by layer: an unchanged layer is
  // the same object between scenes.
  const outlines = lru<SceneLayer, Path>(4000, (path) => path.delete())
  const bands = lru<SceneLayer, Map<number, Path | null>>(4000, (made) => {
    for (const band of made.values()) band?.delete()
  })
  /** Each layer's outline path data, kept while the layer object is, and how many were made. */
  const paths = new WeakMap<SceneLayer, OutlinePath | null>()
  /** Each scene's layers by id, at any depth, gathered once for the first outline asked of it. */
  const byId = new WeakMap<Scene, Map<string, SceneLayer>>()
  let pathsMade = 0
  /** The line boxes of each text layout a hit test has read. */
  const lines = new WeakMap<TextLayout, TurnedRect[]>()
  const outline = (layer: SceneLayer) => outlines.get(layer, () => outlineOf(ck, layer))
  /** What a hit test reads: outlines, the images' alpha maps and the text as the screen lays it out. */
  const looks: Looks = {
    outline,
    band: (layer, reach) => {
      const made = bands.get(layer, () => new Map())
      let band = made.get(reach)
      if (band === undefined) made.set(reach, (band = outlineBand(ck, outline(layer), reach)))
      return band
    },
    alpha: resources.alpha,
    lines: (props) => {
      const laid = layout(props)
      let boxes = lines.get(laid)
      if (!boxes) lines.set(laid, (boxes = lineBoxes(laid)))
      return boxes
    },
  }

  function scene(frame: Frame) {
    return cached(frame).scene
  }
  function shownScene(frame: Frame) {
    return stageEntry(frame).scene
  }
  /** A frame's entry the stage draws: its own, or while hidden layers are shown, the one with them. */
  function stageEntry(frame: Frame) {
    return hiddenShown() ? cached(frame, true) : cached(frame)
  }
  function laidOut(frameId: string, design: Design) {
    return laid.laidOut(frameId, design)
  }
  function laidOutLayer(frameId: string, design: Design, id: string) {
    return laid.laidOutLayer(frameId, design, id)
  }
  function measure() {
    const now = resources.resources()
    if (measuring?.for !== now) measuring = { for: now, measure: textMeasure(ck, now) }
    return measuring.measure
  }
  function layout(props: Parameters<ParagraphCache['layout']>[1]) {
    return paragraphs.layout(ck, props, resources.resources())
  }
  function outlinePath(frame: Frame, id: string) {
    const drawnScene = shownScene(frame)
    let layers = byId.get(drawnScene)
    if (!layers) byId.set(drawnScene, (layers = layersById(drawnScene.layers)))
    const layer = layers.get(id)
    if (!layer) return null
    let path = paths.get(layer)
    if (path === undefined) {
      path = outlinePathOf(layer, outline)
      paths.set(layer, path)
      pathsMade++
    }
    return path
  }
  function outlinePaths() {
    return pathsMade
  }
  function hit(frame: Frame, p: Point, options?: HitOptions) {
    return hitTest(shownScene(frame).layers, p, looks, options)
  }
  function under(frame: Frame, p: Point, options?: HitOptions) {
    return layersAt(shownScene(frame).layers, p, looks, options)
  }

  function pictures(all: Frame[], inView: Frame[], screen: Resources) {
    if (screen !== picturesFor) {
      for (const entry of frames.values()) {
        entry.picture?.delete()
        entry.picture = null
      }
      forgetPreviewed()
      forgetHidden()
      picturesFor = screen
    }
    // Hidden layers no longer shown let go of the shown scenes.
    if (!hiddenShown()) forgetHidden()
    const withPreviews = previewed?.()
    // A frame no preview touches now lets go of its previewed picture.
    for (const [key, entry] of previewedFrames) {
      if (withPreviews?.frames.has(key)) continue
      entry.picture?.delete()
      previewedFrames.delete(key)
    }
    const kept = new Set(all.map((f) => f.id))
    const design = drawn()
    for (const [cache, memo] of [
      [frames, scenes],
      [withHidden, hiddenScenes],
    ] as const) {
      for (const [key, entry] of cache) {
        if (kept.has(key)) continue
        entry.picture?.delete()
        entry.picture = null
        if (Object.hasOwn(design.frames, key)) continue
        cache.delete(key)
        memo.delete(key)
      }
    }

    let recorded = 0
    const shown: { frame: Frame; picture: SkPicture }[] = []
    for (const frame of inView) {
      const entry = withPreviews?.frames.has(frame.id) ? previewedEntry(frame, withPreviews.design) : stageEntry(frame)
      if (!entry.picture) {
        entry.picture = record(entry.scene, withParagraphs(screen))
        recorded++
      }
      shown.push({ frame, picture: entry.picture })
    }
    return { pictures: shown, recorded }
  }
  function ghost(frame: Frame, ids: readonly string[], screen: Resources) {
    const { scene } = stageEntry(frame)
    const key = ids.join(' ')
    if (ghosted?.scene === scene && ghosted.ids === key) return ghosted.picture
    const layers = ids.flatMap((id) => findLayer(scene.layers, id) ?? [])
    const recorder = new ck.PictureRecorder()
    try {
      drawLayers(ck, recorder.beginRecording(ck.LTRBRect(-1e6, -1e6, 1e6, 1e6)), layers, withParagraphs(screen))
      ghosted?.picture.delete()
      ghosted = { scene, ids: key, picture: recorder.finishRecordingAsPicture() }
      return ghosted.picture
    } finally {
      recorder.delete()
    }
  }
  /** Lets go of every frame's scene and picture. */
  function forget() {
    for (const entry of frames.values()) entry.picture?.delete()
    frames.clear()
    forgetPreviewed()
    forgetHidden()
    laid.clear()
  }
  function forgetPreviewed() {
    for (const entry of previewedFrames.values()) entry.picture?.delete()
    previewedFrames.clear()
  }
  /** Lets go of the shown scenes, their pictures and the layers they were built from. */
  function forgetHidden() {
    for (const entry of withHidden.values()) entry.picture?.delete()
    withHidden.clear()
    hiddenScenes.clear()
  }

  /**
   * A frame's scene and picture from the previewed design. Its layers are checked at each redraw, as
   * a preview moves on with no change to the design's count; unchanged layers keep their scene parts.
   */
  function previewedEntry(frame: Frame, design: Design): FrameCache {
    const variables = resources.bytes().variables
    const hidden = hiddenShown()
    const deps = [...depsOf(frame, design, variables), hidden]
    const entry = previewedFrames.get(frame.id)
    if (entry && sameDeps(entry.deps, deps)) return entry
    entry?.picture?.delete()
    const fresh = {
      deps,
      checked: { changes: null, variables },
      scene: sceneOf(design, frame, variables, hidden),
      picture: null,
    }
    previewedFrames.set(frame.id, fresh)
    return fresh
  }

  /** A frame's scene and picture, made again only when what it shows changed; `hidden`, the shown one with its hidden layers. */
  function cached(frame: Frame, hidden = false): FrameCache {
    const kept = hidden ? withHidden : frames
    const checked = { changes: changes(), variables: resources.bytes().variables }
    const entry = kept.get(frame.id)
    // With no count known, as inside a transaction, the layers tell whether anything changed.
    const same = checked.changes !== null && entry?.checked.changes === checked.changes
    if (entry && same && entry.checked.variables === checked.variables) return entry
    const design = drawn()
    const { variables } = checked
    const deps = depsOf(frame, design, variables)
    if (entry && sameDeps(entry.deps, deps)) {
      entry.checked = checked
      return entry
    }
    entry?.picture?.delete()
    const fresh = {
      deps,
      checked,
      scene: sceneOf(design, frame, variables, hidden),
      picture: null,
    }
    kept.set(frame.id, fresh)
    return fresh
  }
  /** A frame's scene from a design; `hidden`, the shown one, its hidden layers faded, from a memo of its own. */
  function sceneOf(design: Design, frame: Frame, variables: Variables | undefined, hidden: boolean) {
    if (!hidden) return render(design, frame.id, scenes, measure(), variables)
    return render(design, frame.id, hiddenScenes, measure(), variables, { hiddenOpacity: HIDDEN_SHOWN_OPACITY })
  }
  function depsOf(frame: Frame, design: Design, variables: unknown) {
    // The brand kit's values too (#53): a change rebuilds the scene, reusing every unbound layer.
    const deps: unknown[] = [design.frames[frame.id], variables]
    const walk = (parentId: string) => {
      for (const [id, node] of childrenOf(design, parentId)) {
        deps.push(id, node)
        walk(id)
      }
    }
    walk(frame.id)
    return deps
  }
  function record(scene: Scene, with_: Resources) {
    const recorder = new ck.PictureRecorder()
    try {
      drawFrame(ck, recorder.beginRecording(ck.XYWHRect(0, 0, scene.width, scene.height)), scene, with_)
      return recorder.finishRecordingAsPicture()
    } finally {
      recorder.delete()
    }
  }
  function withParagraphs(screen: Resources) {
    if (recordingWith?.for !== screen) recordingWith = { for: screen, resources: { ...screen, paragraphs, layers } }
    return recordingWith.resources
  }

  // Auto layout measures text in its font, so arriving fonts make every frame's scene again, not only its picture.
  const stopArriving = resources.onArrive((fonts) => {
    if (fonts) forget()
  })

  function destroy() {
    stopArriving()
    ghosted?.picture.delete()
    forget()
    bands.clear()
    outlines.clear()
    layers.delete()
    paragraphs.delete()
  }

  return {
    scene,
    shownScene,
    measure,
    laidOut,
    laidOutLayer,
    layout,
    outlinePath,
    outlinePaths,
    hit,
    under,
    pictures,
    ghost,
    destroy,
  }
}

/**
 * Frames' laid-out layers kept by design and frame, with their layers by id: a design kept apart is
 * laid out once per frame, and the live one once per frame while the session's change count and
 * the inputs stay. So reading many layers' boxes of one frame lays it out once, not once a layer.
 */
export function laidOutLayers({ build, live, changes, inputs = () => [] }: LaidOutDeps) {
  /** Each design's frames as laid out, by frame id. */
  let kept = new WeakMap<Design, Map<string, LaidOutEntry>>()

  function entryOf(frameId: string, design: Design): LaidOutEntry {
    const now = { changes: design === live() ? changes() : null, inputs: inputs() }
    let byFrame = kept.get(design)
    if (!byFrame) kept.set(design, (byFrame = new Map()))
    const entry = byFrame.get(frameId)
    const liveSame = design !== live() || (now.changes !== null && entry?.changes === now.changes)
    if (entry && liveSame && sameDeps(entry.inputs, now.inputs)) return entry
    const fresh = { ...now, layers: build(frameId, design), byId: null }
    byFrame.set(frameId, fresh)
    return fresh
  }
  function laidOut(frameId: string, design: Design) {
    return entryOf(frameId, design).layers
  }
  function laidOutLayer(frameId: string, design: Design, id: string) {
    const entry = entryOf(frameId, design)
    entry.byId ??= layersById(entry.layers)
    return entry.byId.get(id)
  }

  /** Lets go of every frame laid out, as new fonts lay text out anew. */
  function clear() {
    kept = new WeakMap()
  }

  return { laidOut, laidOutLayer, clear }
}

/**
 * The outline a selection, a hover or a selected layer follows, as SVG path data from the layer's
 * `outline`: rounded corners, an ellipse, a polygon, a star, a path, a boolean's result. Null for a
 * layer that keeps a rectangle (a plain rectangle or photo, a line, a group, a text, a box without
 * rounded corners) or has no width or height.
 */
export function outlinePathOf(layer: SceneLayer, outline: (layer: SceneLayer) => Path): OutlinePath | null {
  const { x, y, width, height } = layer.props
  if (!(width > 0 && height > 0) || !followsShape(layer)) return null
  return { d: outline(layer).toSVGString(), box: { x, y, width, height } }
}

/** The layer with an id in a scene's layers, at any depth. */
export function findLayer(layers: SceneLayer[], id: string): SceneLayer | undefined {
  for (const l of layers) {
    if (l.id === id) return l
    const inner = findLayer(l.children, id)
    if (inner) return inner
  }
  return undefined
}

/** The ids of the hidden layers among a scene's layers, at any depth, in drawing order: those a shown scene holds. */
export function hiddenLayersIn(layers: readonly SceneLayer[], into: string[] = []): string[] {
  for (const layer of layers) {
    if (!layer.props.visible) into.push(layer.id)
    hiddenLayersIn(layer.children, into)
  }
  return into
}

/** A scene's layers by id, at any depth, the first found of an id kept. */
function layersById(layers: SceneLayer[], into = new Map<string, SceneLayer>()) {
  for (const layer of layers) {
    if (!into.has(layer.id)) into.set(layer.id, layer)
    layersById(layer.children, into)
  }
  return into
}

/** Whether a layer's outline is other than its box: a shape other than a plain rectangle or a line, a boolean, or rounded corners. */
function followsShape(layer: SceneLayer) {
  if (layer.type === 'boolean') return true
  if (layer.type === 'graphic' && layer.props.shape.kind !== 'rect') return layer.props.shape.kind !== 'line'
  const radii = cornerRadiiOf(layer)
  return radii !== undefined && (typeof radii === 'number' ? radii > 0 : radii.some((r) => r > 0))
}
