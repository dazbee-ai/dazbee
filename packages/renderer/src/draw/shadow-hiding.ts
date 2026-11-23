// A layer's drop shadows and glows, hidden behind it, so a translucent layer doesn't
// show its own shadow through itself. A layer drawn as one outline hides them behind its cover, the
// area its paints cover at any opacity; so does a clipping box with a fill, which draws nothing
// outside its outline. Any other layer, and one a layer blur moves, hides them by its pixels, as far
// as they are opaque. Each run of hidden shadows in a row is hidden in one pass.
import type { Canvas, CanvasKit, Path } from '@dazbee/canvaskit'
import { shownGradient, shownImage, type Stroke, type TextProps } from '@dazbee/schema'

import type { Resources } from '../resources.ts'
import type { SceneLayer } from '../scene.ts'
import { boxPath } from './paths.ts'
import {
  type CastShadow,
  drawDropShadow,
  OPAQUE,
  opaqueHex,
  opaquePaint,
  type Outline,
  spreadOutline,
  visibleStrokes,
} from './shadows.ts'
import { strokePath } from './strokes.ts'

/** A drop shadow, or a glow as one at 0, 0, and whether it is hidden behind its layer. */
export interface Cast {
  effect: CastShadow
  hidden: boolean
}

/**
 * How shadows are hidden behind a layer: by its cover, its outline where it has visible fills and
 * its visible strokes' area, or by its pixels.
 */
type Hide = { by: 'pixels' } | ({ by: 'cover'; filled: boolean; strokes: Stroke[] } & Outline)

/** A colour matrix that keeps a pixel as far as it is clear: its alpha turned to 1 − alpha. */
const INVERT_ALPHA = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, -1, 1]

/**
 * Draws a layer's drop shadows and glows in their order, cast from what `content` draws, then the
 * layer as `drawn` draws it, its layer blur included: over them, and over each hidden one only
 * where the layer is clear. A layer that is opaque wherever it draws hides them as it is drawn
 * over, so its shadows are drawn as they were.
 */
export function drawShadowed(
  ck: CanvasKit,
  canvas: Canvas,
  layer: SceneLayer,
  casts: readonly Cast[],
  bounds: Float32Array,
  content: () => void,
  drawn: () => void,
  blurred: boolean,
  resources: Resources,
) {
  const cast = (run: readonly Cast[]) => {
    for (const { effect } of run) drawDropShadow(ck, canvas, layer, effect, bounds, content, resources)
  }
  const hide = casts.some((c) => c.hidden) ? hideBy(ck, layer, blurred, resources) : null
  if (!hide) {
    cast(casts)
    drawn()
  } else if (hide.by === 'pixels' && !resources.vector && casts.every((c) => c.hidden) && !blendsBehind(layer)) {
    // Drawn once, a layer blur run once, the layer's pixels hide its shadows from a copy of them.
    // Not where a layer inside it blends with what is behind it, the shadows drawn first among that.
    drawn()
    drawUnder(ck, canvas, bounds, () => cast(casts))
  } else {
    for (const run of runs(casts)) {
      if (run[0]?.hidden) drawHidden(ck, canvas, hide, bounds, () => cast(run), drawn, resources)
      else cast(run)
    }
    drawn()
  }
}

/**
 * How shadows are hidden behind a layer, or null where they needn't be. A layer blur that blurs
 * moves the pixels the shadows are under, so they hide them. A clipping box with a visible fill
 * hides them behind its cover unless an opaque fill and opaque strokes cover it whole; with none,
 * by its pixels, as a group. A layer drawn as one outline hides
 * them behind its cover unless every visible paint is opaque. A text whose colours are all opaque
 * needn't hide them. Any other layer hides them by its pixels.
 */
function hideBy(ck: CanvasKit, layer: SceneLayer, blurred: boolean, resources: Resources): Hide | null {
  if (blurred) return { by: 'pixels' }
  if (layer.type === 'box' && layer.props.clip && layer.props.fills.some((p) => p.visible !== false)) {
    const { props } = layer
    const strokes = visibleStrokes(props)
    const covered = props.fills.some((p) => opaquePaint(ck, p, resources))
    if (covered && strokes.every((s) => opaquePaint(ck, s.paint, resources))) return null
    return { by: 'cover', props, path: () => boxPath(ck, props), filled: true, strokes }
  }
  const outline = spreadOutline(ck, layer, resources)
  if (outline) {
    const strokes = visibleStrokes(outline.props)
    const fills = outline.props.fills.filter((p) => p.visible !== false)
    if ([...fills, ...strokes.map((s) => s.paint)].every((p) => opaquePaint(ck, p, resources))) return null
    return { by: 'cover', ...outline, filled: fills.length > 0, strokes }
  }
  if (layer.type === 'text' && opaqueText(layer.props)) return null
  return { by: 'pixels' }
}

/**
 * Whether a layer inside `layer`, at any depth, blends with what is behind it: by a blend mode, or
 * by a background blur.
 */
function blendsBehind(layer: SceneLayer): boolean {
  return layer.children.some(
    (child) =>
      (child.props.blendMode !== 'normal' && child.props.blendMode !== 'pass-through') ||
      child.props.effects.some((e) => e.type === 'backgroundBlur' && e.radius > 0) ||
      blendsBehind(child),
  )
}

/**
 * Draws what `draw` draws under what the canvas's current layer holds, kept as far as it is clear:
 * cleared where a copy of it is opaque, then laid under it.
 */
function drawUnder(ck: CanvasKit, canvas: Canvas, bounds: Float32Array, draw: () => void) {
  const under = new ck.Paint()
  under.setBlendMode(ck.BlendMode.DstOver)
  const copy = ck.ImageFilter.MakeOffset(0, 0, null)
  canvas.saveLayer(under, bounds, copy)
  under.delete()
  copy.delete()
  const clear = new ck.Paint()
  clear.setBlendMode(ck.BlendMode.SrcOut)
  canvas.saveLayer(clear, bounds)
  clear.delete()
  draw()
  canvas.restore()
  canvas.restore()
}

/** The casts cut into runs in a row that are all hidden or all not. */
function runs(casts: readonly Cast[]): Cast[][] {
  const all: Cast[][] = []
  for (const cast of casts) {
    const last = all.at(-1)
    if (last?.[0]?.hidden === cast.hidden) last.push(cast)
    else all.push([cast])
  }
  return all
}

/**
 * Draws what `cast` draws hidden behind the layer: outside its cover's outline by a clip a PDF
 * keeps as a vector, where it has no visible strokes; else kept where the cover, or what `drawn`
 * draws, is clear, by a DstIn layer of it with its alpha inverted, as a PDF draws it too.
 */
function drawHidden(
  ck: CanvasKit,
  canvas: Canvas,
  hide: Hide,
  bounds: Float32Array,
  cast: () => void,
  drawn: () => void,
  resources: Resources,
) {
  const path = hide.by === 'cover' ? hide.path() : null
  if (hide.by === 'cover' && path && hide.strokes.length === 0) {
    canvas.save()
    canvas.clipPath(path, ck.ClipOp.Difference, true)
    cast()
    canvas.restore()
  } else {
    canvas.saveLayer(undefined, bounds)
    cast()
    // A DstOut layer would be simpler, but a PDF breaks it.
    const keep = new ck.Paint()
    keep.setBlendMode(ck.BlendMode.DstIn)
    const invert = ck.ColorFilter.MakeMatrix(INVERT_ALPHA)
    keep.setColorFilter(invert)
    invert.delete()
    canvas.saveLayer(keep, bounds)
    keep.delete()
    if (hide.by === 'cover' && path) drawCover(ck, canvas, hide, path, resources)
    else drawn()
    canvas.restore()
    canvas.restore()
  }
  path?.delete()
}

/**
 * Whether a text draws only opaque colours: its colour or its gradient's, its outline's, each run's,
 * and its 3D sides' chosen colour (their darker shade is opaque over an opaque paint). An image may
 * be see-through anywhere, so a text painted with one doesn't.
 */
function opaqueText(props: TextProps) {
  const colors = [props.style, ...props.runs.map((r) => r.style)].flatMap((style) => {
    if (shownImage(style)) return ['#00000000']
    const gradient = shownGradient(style)
    if (gradient && (gradient.opacity ?? 1) < 1) return ['#00000000']
    return [
      ...(gradient ? gradient.stops.map((s) => s.color) : [style.color]),
      style.outline && style.outline.width > 0 ? style.outline.color : undefined,
    ]
  })
  return [...colors, props.extrusion?.color].every((c) => c === undefined || opaqueHex(c))
}

/** Draws a cover opaque: its outline where it is filled, and its visible strokes' area, as they are drawn. */
function drawCover(
  ck: CanvasKit,
  canvas: Canvas,
  cover: Extract<Hide, { by: 'cover' }>,
  path: Path,
  resources: Resources,
) {
  if (cover.filled) {
    const paint = new ck.Paint()
    paint.setAntiAlias(true)
    paint.setColor(ck.WHITE)
    canvas.drawPath(path, paint)
    paint.delete()
  }
  const strokes = cover.strokes.map((s) => ({ ...s, paint: { type: 'solid' as const, color: OPAQUE } }))
  strokePath(ck, canvas, path, { ...cover.props, strokes }, resources, null)
}
