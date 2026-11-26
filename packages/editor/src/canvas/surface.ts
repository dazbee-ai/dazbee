// The stage's surface: the WebGL surface a redraw's pictures are put on, kept the size of the canvas
// on screen at the screen's pixels, the animation-frame schedule that redraws it, and where the
// canvas is on the page, so the points between the page and the stage.
import type { Canvas, CanvasKit, Color, GrDirectContext, Surface } from '@dazbee/canvaskit'
import type { Point, Rect } from '@dazbee/schema'

import { toScreen } from './camera.ts'
import { arrowAngle, type ConnectorCurve } from './connectors.ts'
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
   * on the stage, each with its start dot and arrowhead, grey or in the accent while picked, then
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
 * A connector: a 1.5 px line in a soft dark grey with a start dot 3.5 px round filled with the
 * canvas's colour, and an arrowhead; picked, a 2 px line in the accent with dots 5 px round at both
 * ends. In stage pixels.
 */
const CONNECTOR_COLOUR = '#574c61'
const CONNECTOR_WIDTH = 1.5
const PICKED_CONNECTOR_WIDTH = 2
const START_DOT = 3.5
const PICKED_DOT = 5
/** The arrowhead's length along the curve and its half-width across it, in stage pixels. */
const ARROW_LENGTH = 9
const ARROW_HALF_WIDTH = 4.5
/** The canvas's colour, which a connector's dots are filled with, as CSS names it, and the colour while CSS gives none. */
const CANVAS = '--canvas'
const CANVAS_FALLBACK = '#f1ece5'

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
  /** A connector's curve and the ring of its dots, and what is filled: its arrowhead and its dots. */
  const curveLine = new ck.Paint()
  curveLine.setStyle(ck.PaintStyle.Stroke)
  curveLine.setAntiAlias(true)
  const filled = new ck.Paint()
  filled.setAntiAlias(true)
  const connectorGrey = ck.parseColorString(CONNECTOR_COLOUR)
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
    const lit = outlines.some((o) => o.lit) ? ck.parseColorString(accentColour()) : null
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
   * Draws the connectors, in stage pixels: their curves, the dots they start from and their
   * arrowheads, or a picked one's curve and arrowhead in the accent with a dot at both ends. Those
   * of one look go on together, one path each for the curves, the arrowheads and the dots, and one
   * wholly off the stage is left out.
   */
  function paintConnectors(c: Canvas, connectors: readonly DrawnConnector[]) {
    const shown = connectors.filter(({ curve }) => curveShown(curve))
    if (shown.length === 0) return
    const ground = ck.parseColorString(cssColour(CANVAS, CANVAS_FALLBACK))
    const curves = (picked: boolean) => shown.filter((d) => d.picked === picked).map((d) => d.curve)
    paintCurves(c, curves(false), { colour: connectorGrey, width: CONNECTOR_WIDTH, dot: START_DOT, ground })
    const picked = curves(true)
    if (picked.length > 0) {
      const colour = ck.parseColorString(accentColour())
      paintCurves(c, picked, { colour, width: PICKED_CONNECTOR_WIDTH, dot: PICKED_DOT, ground, bothEnds: true })
    }
  }
  /**
   * Draws curves of one look: their lines `width` wide in `colour`, their arrowheads filled, and a
   * dot `dot` round at their start, or at both ends, filled with `ground` and ringed in `colour`.
   */
  function paintCurves(
    c: Canvas,
    curves: readonly ConnectorCurve[],
    look: { colour: Color; width: number; dot: number; ground: Color; bothEnds?: boolean },
  ) {
    if (curves.length === 0) return
    const [lines, heads, dots] = [new ck.PathBuilder(), new ck.PathBuilder(), new ck.PathBuilder()]
    for (const curve of curves) {
      const { from, c1, c2, to } = curve
      lines.moveTo(from.x, from.y).cubicTo(c1.x, c1.y, c2.x, c2.y, to.x, to.y)
      // Each arrowhead is a contour of its own, which filling closes.
      const angle = arrowAngle(curve)
      const [ax, ay] = [Math.cos(angle), Math.sin(angle)]
      const back = { x: to.x - ax * ARROW_LENGTH, y: to.y - ay * ARROW_LENGTH }
      heads
        .moveTo(to.x, to.y)
        .lineTo(back.x - ay * ARROW_HALF_WIDTH, back.y + ax * ARROW_HALF_WIDTH)
        .lineTo(back.x + ay * ARROW_HALF_WIDTH, back.y - ax * ARROW_HALF_WIDTH)
      dots.addCircle(from.x, from.y, look.dot)
      if (look.bothEnds) dots.addCircle(to.x, to.y, look.dot)
    }
    const [linePath, headPath, dotPath] = [lines.detachAndDelete(), heads.detachAndDelete(), dots.detachAndDelete()]
    curveLine.setColor(look.colour)
    curveLine.setStrokeWidth(look.width)
    c.drawPath(linePath, curveLine)
    filled.setColor(look.colour)
    c.drawPath(headPath, filled)
    filled.setColor(look.ground)
    c.drawPath(dotPath, filled)
    c.drawPath(dotPath, curveLine)
    for (const path of [linePath, headPath, dotPath]) path.delete()
  }
  /** Whether some of the box round a curve's points is on the stage. */
  function curveShown({ from, c1, c2, to }: ConnectorCurve) {
    const { width, height } = view.viewport()
    const xs = [from.x, c1.x, c2.x, to.x]
    const ys = [from.y, c1.y, c2.y, to.y]
    const reach = PICKED_DOT + PICKED_CONNECTOR_WIDTH
    return (
      Math.max(...xs) >= -reach &&
      Math.min(...xs) <= width + reach &&
      Math.max(...ys) >= -reach &&
      Math.min(...ys) <= height + reach
    )
  }
  /** The stage's accent as the page's CSS gives it now, which follows the theme. */
  function accentColour() {
    return cssColour(ACCENT, ACCENT_FALLBACK)
  }
  /** A colour the page's CSS names on the canvas now, which follows the theme, else `fallback`. */
  function cssColour(name: string, fallback: string) {
    return getComputedStyle(canvas).getPropertyValue(name).trim() || fallback
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
    stopRedraws()
    cancelAnimationFrame(pending)
    surface?.delete()
    resized.disconnect()
    filled.delete()
    curveLine.delete()
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
