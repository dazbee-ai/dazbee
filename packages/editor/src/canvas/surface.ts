// The stage's surface: the WebGL surface a redraw's pictures are put on, kept the size of the canvas
// on screen at the screen's pixels, the animation-frame schedule that redraws it, and where the
// canvas is on the page, so the points between the page and the stage.
import type { CanvasKit, GrDirectContext, Surface } from '@dazbee/canvaskit'
import type { Point, Rect } from '@dazbee/schema'

import type { FramePicture } from './frames.ts'
import type { DrawnOutline } from './redraw.ts'
import { OUTLINE_RADIUS } from './sections.ts'
import type { EditorView } from './view.ts'

export interface SurfaceDeps {
  ck: CanvasKit
  canvas: HTMLCanvasElement
  view: Pick<EditorView, 'camera' | 'dpr' | 'stagePoint' | 'setViewport' | 'showArea' | 'redraw' | 'onRedraw'>
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
   * Draws the sections' outlines, soft grey or in the accent while lit, then the pictures of the
   * frames in view at the camera, each over white, so no outline covers a frame, and shows them;
   * then `ghost`, a picture of what a drag carries in its frame, faintly where it is past the
   * frame's edge. False, drawing nothing, before the stage has a surface.
   */
  paint(pictures: readonly FramePicture[], ghost: FramePicture | null, outlines: readonly DrawnOutline[]): boolean
  /**
   * As the view's `showArea`, with `panel` floating over the stage at its place on the page: only a
   * part that lies under the panel pans, to show clear of it too.
   */
  showArea(area: Rect, panel?: Rect): void
  /** Fits the canvas's backing store to the stage's size on screen, at the screen's pixels. */
  resize(): void
  destroy(): void
}

/** How strongly the part of a dragged layer past its frame's edge shows. */
const GHOST_OPACITY = 0.35
/** A section's outline: a 1.5 px line in a soft grey, in stage pixels. */
const OUTLINE_WIDTH = 1.5
const OUTLINE_COLOUR = '#c4b9cd'
/** The stage's accent, which a lit outline is drawn in, as CSS names it, and the colour while CSS gives none. */
const ACCENT = '--stage-accent'
const ACCENT_FALLBACK = '#2f5be0'

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
  const faint = new ck.Paint()
  faint.setAlphaf(GHOST_OPACITY)
  /** The outline's line, grey, and lit in the accent. */
  const outline = new ck.Paint()
  outline.setStyle(ck.PaintStyle.Stroke)
  outline.setStrokeWidth(OUTLINE_WIDTH)
  outline.setAntiAlias(true)
  const grey = ck.parseColorString(OUTLINE_COLOUR)
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
  function paint(pictures: readonly FramePicture[], carried: FramePicture | null, outlines: readonly DrawnOutline[]) {
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
  /** The stage's accent as the page's CSS gives it now, which follows the theme. */
  function accentColour() {
    return getComputedStyle(canvas).getPropertyValue(ACCENT).trim() || ACCENT_FALLBACK
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
    outline.delete()
    faint.delete()
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
