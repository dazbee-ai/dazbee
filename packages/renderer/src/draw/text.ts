import type { Canvas, CanvasKit, Paint, Paragraph, Path } from '@dazbee/canvaskit'
import {
  type GradientPaint,
  type Paint as SchemaPaint,
  type Rect,
  shownGradient,
  shownImage,
  type TextImagePaint,
  type TextProps,
} from '@dazbee/schema'

import { color } from '../color.ts'
import { imageSizeOf, type Resources } from '../resources.ts'
import type { SceneLayer } from '../scene.ts'
import { laidOut } from '../text/cache.ts'
import { EXTRUSION_SHADE, shadedColour } from '../text/extrusion.ts'
import type { TextBlock } from '../text/layout.ts'
import { placedBounds, placedPoint, type PlacedRun, type Placement } from '../text/placed.ts'
import { drawsLines, gradientKey, imageKey, linesColour, passPaint, type TextPass } from '../text/text-paint.ts'
import { flipMatrix } from './flip.ts'
import { fillPath, imagePlacement, paintFor } from './paint.ts'
import { EVERYWHERE } from './paths.ts'

type TextLayer = Extract<SceneLayer, { type: 'text' }>

/**
 * Draws a text's lines, mirrored about its box's centre as it is flipped, from its box's corner, where
 * its gradients and images are placed: its 3D sides first, outlines under the letters, then each block's fill, the
 * lines its gradients fill, the characters its images paint (from its letters), its outlines over the
 * letters and its marker. A placed text draws its letters where its placement puts them, in the same
 * passes and order.
 */
export function drawText(ck: CanvasKit, canvas: Canvas, layer: TextLayer, resources: Resources) {
  const { blocks, dy, placed, letters, sides, done } = laidOut(ck, layer.props, resources)
  const { props } = layer
  const flip = flipMatrix(ck, props)
  canvas.save()
  if (flip) canvas.concat(flip)
  canvas.translate(props.x, props.y)
  const box = { x: 0, y: 0, width: props.width, height: props.height }
  const drawnSides = sides()
  if (drawnSides) drawSides(ck, canvas, props, drawnSides, box, resources)
  if (placed) {
    drawPlaced(ck, canvas, blocks, dy, placed, box, resources)
  } else {
    for (const b of blocks) if (b.outlineUnder) drawPass(ck, canvas, b.outlineUnder, b.x, dy + b.y, resources)
    for (const [i, b] of blocks.entries()) {
      canvas.drawParagraph(b.paragraph, b.x, dy + b.y)
      for (const lines of b.gradientLines) drawFilledLines(ck, canvas, lines, b.x, dy + b.y, box, resources)
      const runs = b.images.length > 0 ? letters().runs.filter((r) => r.block === i) : []
      for (const image of b.images) drawImageFill(ck, canvas, image, runs, box, resources)
      if (b.outline) drawPass(ck, canvas, b.outline, b.x, dy + b.y, resources)
      if (b.marker) canvas.drawParagraph(b.marker, b.markerX, dy + b.y + b.markerY)
    }
  }
  canvas.restore()
  done()
}

/**
 * Draws a text's 3D sides once: in their chosen colour, or in a darker shade of the base style's
 * paint, black at 35 % laid over it (`EXTRUSION_SHADE`): its colour, or its gradient across the box,
 * with each colour shaded. Its image across the box is drawn, then the black over it.
 */
function drawSides(ck: CanvasKit, canvas: Canvas, props: TextProps, sides: Path, box: Rect, resources: Resources) {
  const chosen = props.extrusion?.color
  const { style } = props
  const image = shownImage(style)
  const gradient = shownGradient(style)
  let paint: SchemaPaint
  if (chosen) paint = { type: 'solid', color: chosen }
  else if (image) {
    fillPath(ck, canvas, sides, image, box, resources)
    paint = { type: 'solid', color: EXTRUSION_SHADE }
  } else if (gradient)
    paint = { ...gradient, stops: gradient.stops.map((stop) => ({ ...stop, color: shadedColour(stop.color) })) }
  else paint = { type: 'solid', color: shadedColour(style.color) }
  fillPath(ck, canvas, sides, paint, box, resources)
}

/**
 * Draws a placed text in its paragraphs' passes and order, each run as a text blob of its glyphs
 * moved and turned, in its piece's paint for the pass, and each list marker as it is laid out. Into
 * a PDF or SVG every pass is drawn as shapes, a glyph at a time, so letters that overlap in a
 * see-through paint cover each other there as they do on the CPU surface.
 */
function drawPlaced(
  ck: CanvasKit,
  canvas: Canvas,
  blocks: readonly TextBlock[],
  dy: number,
  placed: Placement,
  box: Rect,
  resources: Resources,
) {
  const runsOf = (block: number) => placed.runs.filter((r) => r.block === block)
  for (const [i, b] of blocks.entries())
    if (b.outlineUnder) drawPlacedPass(ck, canvas, runsOf(i), { kind: 'outline', under: true }, box, resources)
  for (const [i, b] of blocks.entries()) {
    const runs = runsOf(i)
    drawPlacedPass(ck, canvas, runs, { kind: 'fill' }, box, resources)
    for (const { gradient } of b.gradientLines) {
      const pass: TextPass = { kind: 'lines', gradient: gradientKey(gradient) }
      fillWith(ck, canvas, gradient, box, linesBounds(runs), resources, () =>
        drawPlacedPass(ck, canvas, runs, pass, box, resources),
      )
    }
    for (const image of b.images) drawImageFill(ck, canvas, image, runs, box, resources)
    if (b.outline) drawPlacedPass(ck, canvas, runs, { kind: 'outline', under: false }, box, resources)
    if (b.marker) canvas.drawParagraph(b.marker, b.markerX, dy + b.y + b.markerY)
  }
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
  const { paragraph } = lines
  // Lines can sit past a tight line's box, and a long word past the paragraph's width either way,
  // so the layer reaches a paragraph's height and its longest line past it on each side.
  const width = Math.max(paragraph.getMaxWidth(), paragraph.getLongestLine())
  const reach = paragraph.getHeight()
  const bounds = { x: x - reach - width, y: y - reach, width: 3 * width + 2 * reach, height: 3 * reach }
  fillWith(ck, canvas, lines.gradient, box, bounds, resources, () => drawPass(ck, canvas, paragraph, x, y, resources))
}

/**
 * Draws the letters an image paints, and their lines, filled with the image across the layer's box.
 * An opaque image paints them itself, as a colour does, in one pass over the glyphs. A see-through
 * one, under which letters that overlap would show through each other, fills them drawn opaque in an
 * offscreen layer (`fillWith`). Into a PDF the image is clipped to the letters, as a shape's image
 * fill is clipped to its path (`fillPath`). Letters past an image fitted inside the box keep their
 * colour (`drawPastPicture`).
 */
function drawImageFill(
  ck: CanvasKit,
  canvas: Canvas,
  image: TextImagePaint,
  runs: readonly PlacedRun[],
  box: Rect,
  resources: Resources,
) {
  const pass: TextPass = { kind: 'image', image: imageKey(image) }
  const painted = runs.filter((run) => drawsLines(run.style, pass))
  const bounds = placedInk(painted)
  if (!bounds) return
  if (image.fit === 'fit') drawPastPicture(ck, canvas, image, painted, box, resources)
  if (!paintsOpaque(ck, image, resources)) {
    fillWith(ck, canvas, image, box, bounds, resources, () => drawPlacedPass(ck, canvas, painted, pass, box, resources))
    return
  }
  const paint = paintFor(ck, image, box, resources)
  if (!paint) return
  const draw = (into: Canvas, glyphEach: boolean) => {
    for (const run of painted) {
      drawGlyphs(ck, into, run, paint, glyphEach)
      drawLetterLines(ck, into, run, paint)
    }
  }
  if (resources.vector) {
    canvas.save()
    canvas.clipRect(ck.XYWHRect(bounds.x, bounds.y, bounds.width, bounds.height), ck.ClipOp.Intersect, false)
    drawAsShapes(ck, canvas, (into) => draw(into, true), true)
    canvas.restore()
  } else draw(canvas, false)
  paint.delete()
}

/**
 * Draws the letters an image fitted inside the box paints, and their lines, in their colour past the
 * picture, where the image draws nothing: so the ends of a text wider than its picture still show.
 */
function drawPastPicture(
  ck: CanvasKit,
  canvas: Canvas,
  image: TextImagePaint,
  runs: readonly PlacedRun[],
  box: Rect,
  resources: Resources,
) {
  const drawn = resources.images.get(image.assetId)
  if (!drawn) return
  const at = imagePlacement(imageSizeOf(resources, image.assetId, drawn), image, box)
  const draw = (into: Canvas, glyphEach: boolean) => {
    for (const run of runs) {
      const paint = new ck.Paint()
      paint.setAntiAlias(true)
      paint.setColor(color(ck, run.style.color))
      drawGlyphs(ck, into, run, paint, glyphEach)
      drawLetterLines(ck, into, run, paint)
      paint.delete()
    }
  }
  canvas.save()
  canvas.clipRect(ck.XYWHRect(at.x, at.y, at.width, at.height), ck.ClipOp.Difference, true)
  if (resources.vector) drawAsShapes(ck, canvas, (into) => draw(into, true))
  else draw(canvas, false)
  canvas.restore()
}

/** Whether an image paints every letter it fills opaque: shown whole, at full opacity, with no see-through pixel. */
function paintsOpaque(ck: CanvasKit, image: TextImagePaint, resources: Resources): boolean {
  const drawn = resources.images.get(image.assetId)
  return image.opacity === 1 && drawn?.getImageInfo().alphaType === ck.AlphaType.Opaque
}

/** Draws one pass of placed runs: their glyphs in the pass's paint, and the lines the pass draws for them. */
function drawPlacedPass(
  ck: CanvasKit,
  canvas: Canvas,
  runs: readonly PlacedRun[],
  pass: TextPass,
  box: Rect,
  resources: Resources,
) {
  const draw = (into: Canvas, glyphEach: boolean) => {
    for (const run of runs) {
      const paint = passPaint(ck, run.style, pass, box)
      if (paint) {
        drawGlyphs(ck, into, run, paint, glyphEach)
        paint.delete()
      }
      if (drawsLines(run.style, pass)) {
        const lines = new ck.Paint()
        lines.setAntiAlias(true)
        lines.setColor(color(ck, linesColour(run.style, pass)))
        drawLetterLines(ck, into, run, lines)
        lines.delete()
      }
    }
  }
  if (resources.vector)
    drawAsShapes(ck, canvas, (into) => draw(into, true), pass.kind === 'fill' || pass.kind === 'image')
  else draw(canvas, false)
}

/**
 * Draws what `draw` draws, opaque, in an offscreen layer of `bounds`, filled with the gradient or
 * image across the layer's box. Into a PDF an image is clipped to `bounds`, a see-through one drawn
 * whole inside a layer that holds its opacity, as a shape's image fill is (`fillPath`); and one that
 * fits inside the box is clipped to where it is drawn, as the letters past it keep their colour
 * (`drawPastPicture`).
 */
function fillWith(
  ck: CanvasKit,
  canvas: Canvas,
  fill: GradientPaint | TextImagePaint,
  box: Rect,
  bounds: Rect,
  resources: Resources,
  draw: () => void,
) {
  const image = resources.vector && fill.type === 'image'
  const faded = image && fill.opacity < 1
  const paint = paintFor(ck, faded ? { ...fill, opacity: 1 } : fill, box, resources)
  if (!paint) return
  const rect = ck.XYWHRect(bounds.x, bounds.y, bounds.width, bounds.height)
  if (image) {
    canvas.save()
    canvas.clipRect(rect, ck.ClipOp.Intersect, false)
    const drawn = resources.images.get(fill.assetId)
    if (fill.fit === 'fit' && drawn) {
      const at = imagePlacement(imageSizeOf(resources, fill.assetId, drawn), fill, box)
      canvas.clipRect(ck.XYWHRect(at.x, at.y, at.width, at.height), ck.ClipOp.Intersect, true)
    }
  }
  if (faded) {
    const layer = new ck.Paint()
    layer.setAlphaf(fill.opacity)
    canvas.saveLayer(layer, rect)
    layer.delete()
  }
  canvas.saveLayer(undefined, rect)
  draw()
  paint.setBlendMode(ck.BlendMode.SrcIn)
  canvas.drawRect(rect, paint)
  paint.delete()
  canvas.restore()
  if (faded) canvas.restore()
  if (image) canvas.restore()
}

/**
 * The part of the layer's box a block's placed lines can reach: its glyphs' turned boxes, and their
 * height more on each side, as lines can sit past a tight line's box.
 */
function linesBounds(runs: readonly PlacedRun[]): Rect {
  const bounds = placedBounds(runs)
  if (!bounds) return { x: 0, y: 0, width: 0, height: 0 }
  const reach = bounds.height
  return { x: bounds.x - reach, y: bounds.y - reach, width: bounds.width + 2 * reach, height: 3 * reach }
}

/**
 * The part of the layer's box placed letters and their lines can reach: their turned boxes, and half
 * their largest font size more on each side, for a glyph past its advance; null without a glyph.
 */
function placedInk(runs: readonly PlacedRun[]): Rect | null {
  const bounds = placedBounds(runs)
  if (!bounds) return null
  const reach = Math.max(...runs.map((run) => run.font.getSize())) / 2
  return {
    x: bounds.x - reach,
    y: bounds.y - reach,
    width: bounds.width + 2 * reach,
    height: bounds.height + 2 * reach,
  }
}

/**
 * Draws text as the glyphs' outlines, so a PDF holds the text once, as the fill pass's text; a glyph
 * with no outline (a colour emoji) is kept as text with `keepColourGlyphs`, else left out: kept in
 * the passes that paint characters, the fill and an image's.
 */
function drawAsShapes(ck: CanvasKit, canvas: Canvas, draw: (into: Canvas) => void, keepColourGlyphs = false) {
  const recorder = new ck.PictureRecorder()
  draw(recorder.beginRecording(EVERYWHERE))
  const picture = recorder.finishRecordingAsPicture()
  recorder.delete()
  ck.DrawTextAsPaths(canvas, picture, keepColourGlyphs)
  picture.delete()
}

/** Draws a run's glyphs where they are placed, as one text blob, or a blob for each glyph. */
function drawGlyphs(ck: CanvasKit, canvas: Canvas, run: PlacedRun, paint: Paint, glyphEach: boolean) {
  const size = glyphEach ? 1 : run.glyphs.length
  for (let from = 0; from < run.glyphs.length; from += size) {
    const glyphs = run.glyphs.subarray(from, from + size)
    const blob = ck.TextBlob.MakeFromRSXformGlyphs(glyphs, run.xforms.subarray(4 * from, 4 * (from + size)), run.font)
    canvas.drawTextBlob(blob, 0, 0, paint)
    blob.delete()
  }
}

/**
 * Draws a run's underline and strikethrough a letter at a time: for each glyph a stretch of its
 * advance at the font's underline or strikethrough place and thickness, read as SkParagraph reads
 * them, moved and turned with the glyph.
 */
function drawLetterLines(ck: CanvasKit, canvas: Canvas, run: PlacedRun, paint: Paint) {
  const { style } = run
  if (!style.underline && !style.strikethrough) return
  const metrics = run.font.getMetrics()
  const size = run.font.getSize()
  const positive = (value: number | undefined) => (value !== undefined && value > 0 ? value : null)
  const underThickness = positive(metrics.underlineThickness) ?? size / 14
  const lines: { at: number; thickness: number }[] = []
  if (style.underline)
    lines.push({ at: positive(metrics.underlinePosition) ?? underThickness, thickness: underThickness })
  if (style.strikethrough) {
    const thickness = positive(metrics.strikeoutThickness) ?? underThickness
    // Without the font's place, about half an x-height up, as SkParagraph puts it.
    lines.push({ at: metrics.strikeoutPosition ?? -size / 4, thickness })
  }
  const builder = new ck.PathBuilder()
  for (let i = 0; i < run.glyphs.length; i++) {
    const advance = run.advances[i] ?? 0
    if (advance <= 0) continue
    const xform = run.xforms.subarray(4 * i, 4 * i + 4)
    for (const { at, thickness } of lines) {
      const [top, bottom] = [at - thickness / 2, at + thickness / 2]
      const corners = [0, top, advance, top, advance, bottom, 0, bottom]
      const points: number[] = []
      for (let c = 0; c < 8; c += 2) points.push(...placedPoint(xform, corners[c] ?? 0, corners[c + 1] ?? 0))
      builder.addPolygon(points, true)
    }
  }
  const path = builder.detachAndDelete()
  canvas.drawPath(path, paint)
  path.delete()
}
