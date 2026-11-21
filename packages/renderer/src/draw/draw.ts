import type { Canvas, CanvasKit, Paragraph } from '@dazbee/canvaskit'
import type { BackgroundBlur, LayerBlur, Rect } from '@dazbee/schema'

import type { Resources } from '../resources.ts'
import type { Scene, SceneLayer } from '../scene.ts'
import { laidOut, type TextBlock } from '../text/layout.ts'
import { LUMA_TO_ALPHA } from './adjust.ts'
import { flipMatrix } from './flip.ts'
import { fillPath, paintFor } from './paint.ts'
import { booleanPath, boxPath, EVERYWHERE, outlineOf, rectPath, shapePath } from './paths.ts'
import { layerReach, sigma, unturnedReach } from './reach.ts'
import { type Cast, drawShadowed } from './shadow-hiding.ts'
import { drawInnerShadow, withFilter } from './shadows.ts'
import { drawShape, strokePath } from './strokes.ts'

type TextLayer = Extract<SceneLayer, { type: 'text' }>

/**
 * Draws a scene. The one drawing path for every surface: the same calls run on the CPU surface for
 * exports and on WebGL for the editor screen (ADR-0005), so only the surface differs.
 */
export function drawScene(ck: CanvasKit, canvas: Canvas, scene: Scene, resources: Resources) {
  canvas.clear(ck.TRANSPARENT)
  drawFrameContent(ck, canvas, scene, resources)
}

/**
 * Draws a scene onto part of a bigger canvas, such as one frame of the editor's infinite canvas:
 * nothing outside the frame shows and nothing else on the canvas is cleared. The caller places it.
 */
export function drawFrame(ck: CanvasKit, canvas: Canvas, scene: Scene, resources: Resources) {
  canvas.save()
  canvas.clipRect(ck.XYWHRect(0, 0, scene.width, scene.height), ck.ClipOp.Intersect, true)
  drawFrameContent(ck, canvas, scene, resources)
  canvas.restore()
}

/**
 * Draws one parent's layers in order. A mask isn't drawn (#48): the layers after it, up to the next
 * mask, are drawn together, then kept only where the mask is opaque or, for a luminance mask, bright.
 */
export function drawLayers(
  ck: CanvasKit,
  canvas: Canvas,
  layers: readonly SceneLayer[],
  resources: Resources,
  draw = (layer: SceneLayer) => drawLayer(ck, canvas, layer, resources),
) {
  for (let i = 0; i < layers.length; i++) {
    const mask = layers[i] as SceneLayer
    if (!mask.props.mask) {
      draw(mask)
      continue
    }
    let end = i + 1
    while (end < layers.length && !layers[end]?.props.mask) end++
    const masked = layers.slice(i + 1, end)
    i = end - 1
    if (masked.length === 0) continue
    // Nothing shows outside what the mask draws, so the offscreen layers need be no bigger.
    const reach = layerReach(ck, mask, resources)
    const bounds = ck.XYWHRect(reach.x - 1, reach.y - 1, reach.width + 2, reach.height + 2)
    canvas.saveLayer(undefined, bounds)
    for (const layer of masked) draw(layer)
    const keep = new ck.Paint()
    keep.setBlendMode(ck.BlendMode.DstIn)
    const luminance = mask.props.mask === 'luminance'
    if (luminance) {
      const filter = ck.ColorFilter.MakeMatrix(LUMA_TO_ALPHA)
      keep.setColorFilter(filter)
      filter.delete()
    }
    canvas.saveLayer(keep, bounds)
    keep.delete()
    // Over black, what the mask leaves transparent is dark, and so hides too.
    if (luminance) canvas.drawColor(ck.BLACK, ck.BlendMode.Src)
    draw(mask)
    canvas.restore()
    canvas.restore()
  }
}

function drawFrameContent(ck: CanvasKit, canvas: Canvas, scene: Scene, resources: Resources) {
  const frame = { x: 0, y: 0, width: scene.width, height: scene.height }
  const framePath = rectPath(ck, frame)
  for (const fill of scene.fills) fillPath(ck, canvas, framePath, fill, frame, resources)
  framePath.delete()
  const { layers } = resources
  drawLayers(
    ck,
    canvas,
    scene.layers,
    resources,
    layers
      ? (layer) =>
          canvas.drawPicture(layers.picture(ck, layer, resources, (into) => drawLayer(ck, into, layer, resources)))
      : (layer) => drawLayer(ck, canvas, layer, resources),
  )
}

function drawLayer(ck: CanvasKit, canvas: Canvas, layer: SceneLayer, resources: Resources) {
  const { props } = layer
  canvas.save()
  if (props.rotation !== 0) canvas.rotate(props.rotation, props.x + props.width / 2, props.y + props.height / 2)

  // Frosted glass first: what is already drawn behind the layer, blurred inside its outline.
  const glass = props.effects.find((e): e is BackgroundBlur => e.type === 'backgroundBlur' && e.radius > 0)
  if (glass) blurBehind(ck, canvas, layer, glass.radius)

  const content = () => drawContent(ck, canvas, layer, resources)
  const own = props.effects.filter((e) => e.type !== 'backgroundBlur')
  // A group or box is drawn by itself first unless it passes through; other layers only for a mode that isn't normal.
  const container = layer.type === 'group' || layer.type === 'box'
  const together = props.blendMode !== 'pass-through' && (props.blendMode !== 'normal' || container)
  const needsLayer = props.opacity < 1 || together || own.length > 0
  if (!needsLayer) {
    content()
  } else {
    // An offscreen layer only as big as what the layer draws, effects included; a frame-sized one
    // for every translucent layer made the 300-layer stress fixture take 15 s (#18).
    // One pixel more for anti-aliased edges.
    const reach = unturnedReach(ck, layer, resources)
    const bounds = ck.XYWHRect(reach.x - 1, reach.y - 1, reach.width + 2, reach.height + 2)
    const layerPaint = new ck.Paint()
    layerPaint.setAlphaf(props.opacity)
    layerPaint.setBlendMode(blendMode(ck, props.blendMode))
    canvas.saveLayer(layerPaint, bounds)
    layerPaint.delete()
    // Changes no pixel, but keeps a recorded picture from folding the layer's opacity into its one
    // draw (Skia's SkRecordOptimize), which rounds differently: the editor draws through pictures
    // and must match exports exactly (#36).
    canvas.clipRect(EVERYWHERE, ck.ClipOp.Intersect, false)
    // The first blur that blurs; a zero-radius one before it no longer hides it.
    const blur = props.effects.find((e): e is LayerBlur => e.type === 'layerBlur' && e.radius > 0)
    const drawn = blur
      ? () =>
          withFilter(
            ck,
            canvas,
            ck.ImageFilter.MakeBlur(sigma(blur.radius), sigma(blur.radius), ck.TileMode.Decal, null),
            bounds,
            content,
          )
      : content
    // Shadows and glows behind the content, in their order, hidden behind the layer; a drop shadow
    // only unless it shows behind it.
    const casts = own.flatMap((effect): Cast[] => {
      if (effect.type === 'dropShadow') return [{ effect, hidden: !effect.showBehind }]
      return effect.type === 'glow' ? [{ effect: { ...effect, x: 0, y: 0 }, hidden: true }] : []
    })
    drawShadowed(ck, canvas, layer, casts, bounds, content, drawn, blur !== undefined, resources)
    // Inner shadows over the content, each kept inside it.
    for (const effect of own) {
      if (effect.type === 'innerShadow') drawInnerShadow(ck, canvas, layer, effect, bounds, content, resources)
    }
    canvas.restore()
  }
  canvas.restore()
}

/**
 * Blurs what the canvas already holds under a layer's outline: a layer of nothing, whose
 * backdrop is the blurred canvas, clipped to the outline. Edges clamp, so the blur doesn't
 * fade in from outside what it reads.
 */
function blurBehind(ck: CanvasKit, canvas: Canvas, layer: SceneLayer, radius: number) {
  const outline = outlineOf(ck, layer)
  const [left = 0, top = 0, right = 0, bottom = 0] = outline.computeTightBounds()
  canvas.save()
  canvas.clipPath(outline, ck.ClipOp.Intersect, true)
  outline.delete()
  const blur = ck.ImageFilter.MakeBlur(sigma(radius), sigma(radius), ck.TileMode.Clamp, null)
  canvas.saveLayer(undefined, ck.LTRBRect(left, top, right, bottom), blur, 0, ck.TileMode.Clamp)
  canvas.restore()
  canvas.restore()
  blur.delete()
}

function drawContent(ck: CanvasKit, canvas: Canvas, layer: SceneLayer, resources: Resources) {
  switch (layer.type) {
    case 'graphic': {
      const path = shapePath(ck, layer)
      drawShape(ck, canvas, path, layer.props, resources, layer.props.shape.kind === 'line' ? layer.props.shape : null)
      path.delete()
      return
    }
    case 'boolean': {
      const path = booleanPath(ck, layer)
      drawShape(ck, canvas, path, layer.props, resources, null)
      path.delete()
      return
    }
    case 'text':
      return drawText(ck, canvas, layer, resources)
    case 'box': {
      const { props } = layer
      const path = boxPath(ck, props)
      for (const fill of props.fills) fillPath(ck, canvas, path, fill, props, resources)
      canvas.save()
      if (props.clip) canvas.clipPath(path, ck.ClipOp.Intersect, true)
      drawLayers(ck, canvas, layer.children, resources)
      canvas.restore()
      // Over what is inside, and never cut by the clip, so an outside stroke shows whole.
      strokePath(ck, canvas, path, props, resources, null)
      path.delete()
      return
    }
    case 'group':
      drawLayers(ck, canvas, layer.children, resources)
      return
  }
}

function blendMode(ck: CanvasKit, mode: SceneLayer['props']['blendMode']) {
  const b = ck.BlendMode
  return {
    normal: b.SrcOver,
    multiply: b.Multiply,
    screen: b.Screen,
    overlay: b.Overlay,
    darken: b.Darken,
    lighten: b.Lighten,
    'color-dodge': b.ColorDodge,
    'color-burn': b.ColorBurn,
    'hard-light': b.HardLight,
    'soft-light': b.SoftLight,
    difference: b.Difference,
    exclusion: b.Exclusion,
    hue: b.Hue,
    saturation: b.Saturation,
    color: b.Color,
    luminosity: b.Luminosity,
    // Only reached when a pass-through group needs its own layer for opacity or effects.
    'pass-through': b.SrcOver,
  }[mode]
}

/**
 * Draws a text's lines, mirrored about its box's centre as it is flipped, from its box's corner, where
 * its gradients are placed: outlines under the letters first, then each block's fill, the lines its
 * gradients fill, its outlines over the letters and its marker.
 */
function drawText(ck: CanvasKit, canvas: Canvas, layer: TextLayer, resources: Resources) {
  const { blocks, dy, done } = laidOut(ck, layer.props, resources)
  const { props } = layer
  const flip = flipMatrix(ck, props)
  canvas.save()
  if (flip) canvas.concat(flip)
  canvas.translate(props.x, props.y)
  const box = { x: 0, y: 0, width: props.width, height: props.height }
  for (const b of blocks) if (b.outlineUnder) drawPass(ck, canvas, b.outlineUnder, b.x, dy + b.y, resources)
  for (const b of blocks) {
    canvas.drawParagraph(b.paragraph, b.x, dy + b.y)
    for (const lines of b.gradientLines) drawFilledLines(ck, canvas, lines, b.x, dy + b.y, box, resources)
    if (b.outline) drawPass(ck, canvas, b.outline, b.x, dy + b.y, resources)
    if (b.marker) canvas.drawParagraph(b.marker, b.markerX, dy + b.y + b.markerY)
  }
  canvas.restore()
  done()
}

/** Draws a pass that paints no characters of its own: as shapes into a PDF or SVG, so the file holds the text once. */
function drawPass(ck: CanvasKit, canvas: Canvas, pass: Paragraph, x: number, y: number, resources: Resources) {
  if (resources.vector) drawAsShapes(ck, canvas, (into) => into.drawParagraph(pass, x, y))
  else canvas.drawParagraph(pass, x, y)
}

/** Draws the underline and strikethrough of a gradient's runs, filled with the gradient across the layer's box. */
function drawFilledLines(
  ck: CanvasKit,
  canvas: Canvas,
  lines: TextBlock['gradientLines'][number],
  x: number,
  y: number,
  box: Rect,
  resources: Resources,
) {
  const paint = paintFor(ck, lines.gradient, box, resources)
  if (!paint) return
  const { paragraph } = lines
  // Lines can sit past a tight line's box, and a long word past the paragraph's width either way,
  // so the layer reaches a paragraph's height and its longest line past it on each side.
  const width = Math.max(paragraph.getMaxWidth(), paragraph.getLongestLine())
  const reach = paragraph.getHeight()
  const bounds = ck.XYWHRect(x - reach - width, y - reach, 3 * width + 2 * reach, 3 * reach)
  canvas.saveLayer(undefined, bounds)
  drawPass(ck, canvas, paragraph, x, y, resources)
  paint.setBlendMode(ck.BlendMode.SrcIn)
  canvas.drawRect(bounds, paint)
  paint.delete()
  canvas.restore()
}

/** Draws text as the glyphs' outlines, so a PDF holds the text once, as the fill pass's text. */
function drawAsShapes(ck: CanvasKit, canvas: Canvas, draw: (into: Canvas) => void) {
  const recorder = new ck.PictureRecorder()
  draw(recorder.beginRecording(EVERYWHERE))
  const picture = recorder.finishRecordingAsPicture()
  recorder.delete()
  ck.DrawTextAsPaths(canvas, picture)
  picture.delete()
}
