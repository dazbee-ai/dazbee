// The stage's surface: the WebGL surface a redraw's pictures are put on, kept the size of the canvas
// on screen at the screen's pixels, the animation-frame schedule that redraws it, and where the
// canvas is on the page, so the points between the page and the stage.
import type { Canvas, CanvasKit, Color, GrDirectContext, Surface, Vertices } from '@dazbee/canvaskit'
import type { Point, Rect } from '@dazbee/schema'

import { type Camera, toScreen } from './camera.ts'
import { type ConnectorMesh, connectorMeshes } from './connector-mesh.ts'
import type { ConnectorCurve } from './connectors.ts'
import type { FramePicture } from './frames.ts'
import type { DrawnConnector, DrawnOutline } from './redraw.ts'
import { OUTLINE_RADIUS } from './sections.ts'
import type { EditorView } from './view.ts'

export interface SurfaceDeps {
  ck: CanvasKit
  canvas: HTMLCanvasElement
  view: Pick<
    EditorView,
    'camera' | 'dpr' | 'viewport' | 'stagePoint' | 'setViewport' | 'showArea' | 'redraw' | 'onRedraw'
  >
  /** The frame callback: draws the stage, called from the animation-frame schedule. */
  draw: () => void
}

export interface EditorSurface {
  /** A point in client coordinates as a point on the stage. */
  onStage(client: Point): Point
  /** Where a design pixel of a frame of the shown page is on screen now, in client coordinates; its first frame by default. */
  screenPoint(x: number, y: number, frameId?: string): Point
  /** Whether a redraw is waiting for the next animation frame. */
  scheduled(): boolean
  /**
   * Draws the sections' outlines, soft grey or in the accent while lit, then the connectors' curves
   * on the stage with their arrowheads, quiet grey, or picked in the accent with a filled dot at its start, then
   * the pictures of the frames in view at the camera, each over white on a soft shadow, so no outline
   * or connector covers a frame, and shows them; then `ghost`, a picture of what a drag carries in
   * its frame, faintly where it is past the frame's edge. False, drawing nothing, before the stage
   * has a surface.
   */
  paint(
    pictures: readonly FramePicture[],
    ghost: FramePicture | null,
    outlines: readonly DrawnOutline[],
    connectors: readonly DrawnConnector[],
  ): boolean
  /**
   * As the view's `showArea`, with `panel` floating over the stage at its place on the page: only a
   * part that lies under the panel pans, to show clear of it too.
   */
  showArea(area: Rect, panel?: Rect): void
  /** Fits the canvas's backing store to the stage's size on screen, at the screen's pixels. */
  resize(): void
  destroy(): void
}

/**
 * The connectors as last built for drawing, from the camera's corner, and what they were built from:
 * their triangles at rest and picked, the picked ones' start dots, the part of the page (from the
 * camera's corner) whose connectors they hold, the zoom, the screen's pixels, the colours, and a
 * number standing for every curve and pick.
 */
interface BuiltConnectors {
  resting: Vertices[]
  picked: Vertices[]
  dots: Point[]
  region: Rect
  zoom: number
  dpr: number
  colours: string
  key: number
}

/**
 * The soft lift under each frame, in stage pixels, so it looks the same at any zoom: a tight shadow
 * 1 down and blurred over 2, and a softer one from a box 6 in from each side, 6 down and blurred
 * over 18, in a near-black at 8% and 16%.
 */
const FRAME_SHADOWS = [
  { y: 1, blur: 2, inset: 0, alpha: 0.08 },
  { y: 6, blur: 18, inset: 6, alpha: 0.16 },
] as const
/** How strongly the part of a dragged layer past its frame's edge shows. */
const GHOST_OPACITY = 0.35
/** A section's outline: a 1.5 px line in a soft grey, in stage pixels. */
const OUTLINE_WIDTH = 1.5
const OUTLINE_COLOUR = '#c4b9cd'
/** The stage's accent, which a lit outline is drawn in, as CSS names it, and the colour while CSS gives none. */
const ACCENT = '--stage-accent'
const ACCENT_FALLBACK = '#2f5be0'
/**
 * A connector at rest: a quiet 1.25 px line in the theme's soft grey, as CSS names it (the colour
 * while CSS gives none), and its arrowhead, with no dot. Picked: a 2 px line in the accent with a
 * filled dot 5 px round at its start. In stage pixels.
 */
const CONNECTOR = '--stage-connector'
const CONNECTOR_FALLBACK = '#b8aec2'
const CONNECTOR_WIDTH = 1.25
const PICKED_CONNECTOR_WIDTH = 2
const PICKED_DOT = 5

export function editorSurface({ ck, canvas, view, draw }: SurfaceDeps): EditorSurface {
  const maybeGl = ck.MakeWebGLContext(ck.GetWebGLContext(canvas))
  if (!maybeGl) throw new Error('this browser has no WebGL')
  /** The WebGL context the stage draws with. */
  const gl: GrDirectContext = maybeGl
  /** The canvas's surface, made again when the stage's size changes. */
  let surface: Surface | null = null
  /** The animation frame the next redraw waits for, or 0 with none asked for. */
  let pending = 0

  const backing = new ck.Paint()
  backing.setColor(ck.WHITE)
  /** Each of FRAME_SHADOWS with its paint, blurred by half its blur each way, as CSS blurs. */
  const shadows = FRAME_SHADOWS.map((look) => {
    const blur = ck.ImageFilter.MakeBlur(look.blur / 2, look.blur / 2, ck.TileMode.Decal, null)
    const paint = new ck.Paint()
    paint.setColor(ck.Color(20, 12, 24, look.alpha))
    paint.setImageFilter(blur)
    return { look, blur, paint }
  })
  const faint = new ck.Paint()
  faint.setAlphaf(GHOST_OPACITY)
  /** The outline's line, grey, and lit in the accent. */
  const outline = new ck.Paint()
  outline.setStyle(ck.PaintStyle.Stroke)
  outline.setStrokeWidth(OUTLINE_WIDTH)
  outline.setAntiAlias(true)
  const grey = ck.parseColorString(OUTLINE_COLOUR)
  /** A picked connector's start dot, filled. */
  const filled = new ck.Paint()
  filled.setAntiAlias(true)
  /** The connectors' triangles take their colours from their corners alone. */
  const cornerColours = new ck.Paint()
  /** The theme's colours read from the page's CSS, by name, and the theme they were read in: read again once it changes. */
  const colours = new Map<string, Color>()
  let coloursTheme: string | undefined
  /** The connectors as last built, kept while the camera only pans over the part of the page they hold. */
  let built: BuiltConnectors | null = null
  const resized = new ResizeObserver(() => resize())
  resized.observe(canvas)

  // Pointer: screen points are CSS pixels from the canvas's corner.
  function onStage(client: Point): Point {
    const rect = canvas.getBoundingClientRect()
    return { x: client.x - rect.left, y: client.y - rect.top }
  }
  function screenPoint(x: number, y: number, frameId?: string): Point {
    const stage = view.stagePoint(x, y, frameId)
    const rect = canvas.getBoundingClientRect()
    return { x: rect.left + stage.x, y: rect.top + stage.y }
  }
  function scheduled() {
    return pending !== 0
  }
  function paint(
    pictures: readonly FramePicture[],
    carried: FramePicture | null,
    outlines: readonly DrawnOutline[],
    connectors: readonly DrawnConnector[],
  ) {
    if (!surface) return false
    const camera = view.camera()
    const c = surface.getCanvas()
    c.clear(ck.TRANSPARENT)
    c.save()
    c.scale(view.dpr(), view.dpr())
    // The outlines go on first, in stage pixels, so every frame drawn after covers them.
    const lit = outlines.some((o) => o.lit) ? themeColour(ACCENT, ACCENT_FALLBACK) : null
    for (const { box, lit: on } of outlines) {
      outline.setColor(on && lit ? lit : grey)
      c.drawRRect(ck.RRectXY(ck.XYWHRect(box.x, box.y, box.width, box.height), OUTLINE_RADIUS, OUTLINE_RADIUS), outline)
    }
    // The connectors go on next, so the frames drawn after cover them too.
    paintConnectors(c, connectors)
    // The shadows go on first, in stage pixels, so none falls over a neighbouring frame.
    for (const { frame } of pictures) {
      const { x, y } = toScreen(camera, frame)
      const [width, height] = [frame.width * camera.zoom, frame.height * camera.zoom]
      for (const { look, paint } of shadows) {
        const box = ck.XYWHRect(
          x + look.inset,
          y + look.inset + look.y,
          Math.max(width - 2 * look.inset, 0),
          Math.max(height - 2 * look.inset, 0),
        )
        c.drawRect(box, paint)
      }
    }
    c.translate(camera.x, camera.y)
    c.scale(camera.zoom, camera.zoom)
    for (const { frame, picture } of pictures) {
      const box = ck.XYWHRect(frame.x, frame.y, frame.width, frame.height)
      c.drawRect(box, backing)
      c.save()
      c.translate(frame.x, frame.y)
      c.drawPicture(picture)
      c.restore()
    }
    if (carried) {
      const { frame, picture } = carried
      c.save()
      c.clipRect(ck.XYWHRect(frame.x, frame.y, frame.width, frame.height), ck.ClipOp.Difference, true)
      c.saveLayer(faint)
      c.translate(frame.x, frame.y)
      c.drawPicture(picture)
      c.restore()
      c.restore()
    }
    c.restore()
    surface.flush()
    return true
  }
  /**
   * Draws the connectors, in stage pixels: their quiet curves and arrowheads, then a picked one's
   * curve and arrowhead in the accent with a filled dot at its start, its end left to the arrowhead. They
   * are drawn as triangles, all of one look in one call (`connector-mesh.ts`), built from the camera's
   * corner for the part of the page round the stage and kept, so a pan only moves them. They are
   * built again once the zoom, a curve, the pick or the theme changes, or the stage leaves that part.
   */
  function paintConnectors(c: Canvas, connectors: readonly DrawnConnector[]) {
    if (connectors.length === 0) return
    const camera = view.camera()
    const drawn = connectorsBuilt(connectors, camera)
    c.save()
    c.translate(camera.x, camera.y)
    for (const vertices of [...drawn.resting, ...drawn.picked])
      c.drawVertices(vertices, ck.BlendMode.Dst, cornerColours)
    if (drawn.dots.length > 0) {
      filled.setColor(themeColour(ACCENT, ACCENT_FALLBACK))
      for (const dot of drawn.dots) c.drawCircle(dot.x, dot.y, PICKED_DOT, filled)
    }
    c.restore()
  }
  /** The connectors built for drawing: those last built while nothing they show changed and the stage is in their part of the page, else built again. */
  function connectorsBuilt(connectors: readonly DrawnConnector[], camera: Camera): BuiltConnectors {
    const { width, height } = view.viewport()
    const stage = { x: -camera.x, y: -camera.y, width, height }
    const colours = `${themeColour(CONNECTOR, CONNECTOR_FALLBACK).join()} ${themeColour(ACCENT, ACCENT_FALLBACK).join()}`
    const key = keyOf(connectors, camera)
    const keep =
      built &&
      built.key === key &&
      built.zoom === camera.zoom &&
      built.dpr === view.dpr() &&
      built.colours === colours &&
      inside(stage, built.region)
    if (keep && built) return built
    freeBuilt()
    // The stage and as much again on every side, so a pan rarely leaves it.
    const region = { x: stage.x - width, y: stage.y - height, width: width * 3, height: height * 3 }
    const placed = (picked: boolean) =>
      connectors.flatMap((d) => {
        const curve = moved(d.curve, camera)
        return d.picked === picked && (picked || meets(curve, region)) ? [curve] : []
      })
    const fringe = 1 / view.dpr()
    const restingCurves = placed(false)
    const pickedCurves = placed(true)
    built = {
      resting: verticesOf(
        connectorMeshes(restingCurves, CONNECTOR_WIDTH, fringe),
        themeColour(CONNECTOR, CONNECTOR_FALLBACK),
      ),
      picked: verticesOf(
        connectorMeshes(pickedCurves, PICKED_CONNECTOR_WIDTH, fringe),
        themeColour(ACCENT, ACCENT_FALLBACK),
      ),
      dots: pickedCurves.map((curve) => curve.from),
      region,
      zoom: camera.zoom,
      dpr: view.dpr(),
      colours,
      key,
    }
    return built
  }
  /** Triangles as CanvasKit draws them, each corner in `colour` at its opacity. */
  function verticesOf(meshes: readonly ConnectorMesh[], colour: Color): Vertices[] {
    return meshes.map(({ positions, alphas, indices }) => {
      const colours = new Float32Array(alphas.length * 4)
      alphas.forEach((alpha, i) =>
        colours.set([colour[0] ?? 0, colour[1] ?? 0, colour[2] ?? 0, (colour[3] ?? 1) * alpha], i * 4),
      )
      return ck.MakeVertices(ck.VertexMode.Triangles, positions, null, colours, indices, false)
    })
  }
  /** Frees the connectors last built. */
  function freeBuilt() {
    for (const vertices of [...(built?.resting ?? []), ...(built?.picked ?? [])]) vertices.delete()
    built = null
  }
  /**
   * A colour the page's CSS names on the canvas, which follows the theme, else `fallback`. It is read
   * once per theme (`data-theme` on the page's root), not on every paint, which would make the browser
   * work out the page's styles again on every frame.
   */
  function themeColour(name: string, fallback: string): Color {
    const theme = canvas.ownerDocument?.documentElement.dataset.theme ?? ''
    if (theme !== coloursTheme) {
      colours.clear()
      coloursTheme = theme
    }
    const kept = colours.get(name)
    if (kept) return kept
    const css = getComputedStyle(canvas).getPropertyValue(name).trim()
    const colour = ck.parseColorString(css || fallback)
    // A name the CSS doesn't give yet, as before the styles load, is asked again next time.
    if (css) colours.set(name, colour)
    return colour
  }
  function showArea(area: Rect, panel?: Rect) {
    view.showArea(area, panel && { panel, stage: canvas.getBoundingClientRect() })
  }
  // The canvas fills the stage; its backing store matches the screen's pixels.
  function resize() {
    const width = Math.max(1, canvas.clientWidth)
    const height = Math.max(1, canvas.clientHeight)
    view.setViewport({ width, height, dpr: window.devicePixelRatio || 1 })
    const pixelWidth = Math.round(width * view.dpr())
    const pixelHeight = Math.round(height * view.dpr())
    if (surface && canvas.width === pixelWidth && canvas.height === pixelHeight) return
    canvas.width = pixelWidth
    canvas.height = pixelHeight
    surface?.delete()
    surface = ck.MakeOnScreenGLSurface(gl, pixelWidth, pixelHeight, ck.ColorSpace.SRGB)
    if (!surface) throw new Error('could not make the WebGL surface')
    view.redraw()
  }
  function schedule() {
    if (!pending)
      pending = requestAnimationFrame(() => {
        pending = 0
        draw()
      })
  }

  const stopRedraws = view.onRedraw(schedule)

  function destroy() {
    freeBuilt()
    stopRedraws()
    cancelAnimationFrame(pending)
    surface?.delete()
    resized.disconnect()
    cornerColours.delete()
    filled.delete()
    outline.delete()
    faint.delete()
    for (const { paint, blur } of shadows) {
      paint.delete()
      blur.delete()
    }
    backing.delete()
    gl.delete()
  }

  return {
    onStage,
    screenPoint,
    scheduled,
    paint,
    showArea,
    resize,
    destroy,
  }
}

/** A curve placed from the camera's corner: where it is on the stage, less where the camera is. */
function moved({ from, c1, c2, to }: ConnectorCurve, camera: Camera): ConnectorCurve {
  const move = (p: Point) => ({ x: p.x - camera.x, y: p.y - camera.y })
  return { from: move(from), c1: move(c1), c2: move(c2), to: move(to) }
}

/**
 * A number standing for the connectors drawn: each one's pick and its curve from the camera's corner,
 * to a hundredth of a pixel, so it stays the same while the camera only pans.
 */
function keyOf(connectors: readonly DrawnConnector[], camera: Camera) {
  let key = connectors.length
  const mix = (n: number) => {
    key = Math.imul(key ^ Math.round(n * 100), 16_777_619) >>> 0
  }
  for (const { curve, picked } of connectors) {
    mix(picked ? 1 : 0)
    for (const p of [curve.from, curve.c1, curve.c2, curve.to]) {
      mix(p.x - camera.x)
      mix(p.y - camera.y)
    }
  }
  return key
}

/** Whether box `inner` lies wholly in box `outer`. */
function inside(inner: Rect, outer: Rect) {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  )
}

/** Whether some of the box round a curve's points lies in a box. */
function meets({ from, c1, c2, to }: ConnectorCurve, box: Rect) {
  const [left, right] = [Math.min(from.x, c1.x, c2.x, to.x), Math.max(from.x, c1.x, c2.x, to.x)]
  const [top, bottom] = [Math.min(from.y, c1.y, c2.y, to.y), Math.max(from.y, c1.y, c2.y, to.y)]
  return right >= box.x && left <= box.x + box.width && bottom >= box.y && top <= box.y + box.height
}
