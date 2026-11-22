import type { Canvas, CanvasKit, Paint, Paragraph } from '@dazbee/canvaskit'
import type { GradientPaint, Rect } from '@dazbee/schema'

import { color } from '../color.ts'
import type { Resources } from '../resources.ts'
import type { SceneLayer } from '../scene.ts'
import { laidOut } from '../text/cache.ts'
import type { TextBlock } from '../text/layout.ts'
import type { PlacedRun, Placement } from '../text/placed.ts'
import { drawsLines, gradientKey, linesColour, passPaint, type TextPass } from '../text/text-paint.ts'
import { flipMatrix } from './flip.ts'
import { paintFor } from './paint.ts'
import { EVERYWHERE } from './paths.ts'

type TextLayer = Extract<SceneLayer, { type: 'text' }>

/**
 * Draws a text's lines, mirrored about its box's centre as it is flipped, from its box's corner, where
 * its gradients are placed: outlines under the letters first, then each block's fill, the lines its
 * gradients fill, its outlines over the letters and its marker. A placed text draws its letters where
 * its placement puts them, in the same passes and order.
 */
export function drawText(ck: CanvasKit, canvas: Canvas, layer: TextLayer, resources: Resources) {
  const { blocks, dy, placed, done } = laidOut(ck, layer.props, resources)
  const { props } = layer
  const flip = flipMatrix(ck, props)
  canvas.save()
  if (flip) canvas.concat(flip)
  canvas.translate(props.x, props.y)
  const box = { x: 0, y: 0, width: props.width, height: props.height }
  if (placed) {
    drawPlaced(ck, canvas, blocks, dy, placed, box, resources)
  } else {
    for (const b of blocks) if (b.outlineUnder) drawPass(ck, canvas, b.outlineUnder, b.x, dy + b.y, resources)
    for (const b of blocks) {
      canvas.drawParagraph(b.paragraph, b.x, dy + b.y)
      for (const lines of b.gradientLines) drawFilledLines(ck, canvas, lines, b.x, dy + b.y, box, resources)
      if (b.outline) drawPass(ck, canvas, b.outline, b.x, dy + b.y, resources)
      if (b.marker) canvas.drawParagraph(b.marker, b.markerX, dy + b.y + b.markerY)
    }
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
  const { paragraph } = lines
  // Lines can sit past a tight line's box, and a long word past the paragraph's width either way,
  // so the layer reaches a paragraph's height and its longest line past it on each side.
  const width = Math.max(paragraph.getMaxWidth(), paragraph.getLongestLine())
  const reach = paragraph.getHeight()
  const bounds = { x: x - reach - width, y: y - reach, width: 3 * width + 2 * reach, height: 3 * reach }
  fillWithGradient(ck, canvas, lines.gradient, box, bounds, resources, () =>
    drawPass(ck, canvas, paragraph, x, y, resources),
  )
}

/** Draws what `draw` draws, opaque, in an offscreen layer of `bounds`, filled with the gradient across the layer's box. */
function fillWithGradient(
  ck: CanvasKit,
  canvas: Canvas,
  gradient: GradientPaint,
  box: Rect,
  bounds: Rect,
  resources: Resources,
  draw: () => void,
) {
  const paint = paintFor(ck, gradient, box, resources)
  if (!paint) return
  const rect = ck.XYWHRect(bounds.x, bounds.y, bounds.width, bounds.height)
  canvas.saveLayer(undefined, rect)
  draw()
  paint.setBlendMode(ck.BlendMode.SrcIn)
  canvas.drawRect(rect, paint)
  paint.delete()
  canvas.restore()
}

/**
 * Draws text as the glyphs' outlines, so a PDF holds the text once, as the fill pass's text; a glyph
 * with no outline (a colour emoji) is kept as text with `keepColourGlyphs`, else left out.
 */
function drawAsShapes(ck: CanvasKit, canvas: Canvas, draw: (into: Canvas) => void, keepColourGlyphs = false) {
  const recorder = new ck.PictureRecorder()
  draw(recorder.beginRecording(EVERYWHERE))
  const picture = recorder.finishRecordingAsPicture()
  recorder.delete()
  ck.DrawTextAsPaths(canvas, picture, keepColourGlyphs)
  picture.delete()
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
      fillWithGradient(ck, canvas, gradient, box, linesBounds(runs), resources, () =>
        drawPlacedPass(ck, canvas, runs, pass, box, resources),
      )
    }
    if (b.outline) drawPlacedPass(ck, canvas, runs, { kind: 'outline', under: false }, box, resources)
    if (b.marker) canvas.drawParagraph(b.marker, b.markerX, dy + b.y + b.markerY)
  }
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
      if (drawsLines(run.style, pass)) drawLetterLines(ck, into, run, linesColour(run.style, pass))
    }
  }
  if (resources.vector) drawAsShapes(ck, canvas, (into) => draw(into, true), pass.kind === 'fill')
  else draw(canvas, false)
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
function drawLetterLines(ck: CanvasKit, canvas: Canvas, run: PlacedRun, colour: string) {
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
    lines.push({ at: metrics.strikeoutPosition ?? -size / 4, thickness })
  }
  const builder = new ck.PathBuilder()
  for (let i = 0; i < run.glyphs.length; i++) {
    const advance = run.advances[i] ?? 0
    if (advance <= 0) continue
    const [scos = 1, ssin = 0, tx = 0, ty = 0] = run.xforms.subarray(4 * i, 4 * i + 4)
    const placed = (x: number, y: number) => [scos * x - ssin * y + tx, ssin * x + scos * y + ty]
    for (const { at, thickness } of lines) {
      const top = at - thickness / 2
      const bottom = at + thickness / 2
      builder.addPolygon(
        [...placed(0, top), ...placed(advance, top), ...placed(advance, bottom), ...placed(0, bottom)],
        true,
      )
    }
  }
  const path = builder.detachAndDelete()
  const paint = new ck.Paint()
  paint.setAntiAlias(true)
  paint.setColor(color(ck, colour))
  canvas.drawPath(path, paint)
  paint.delete()
  path.delete()
}

/**
 * The part of the layer's box a block's placed lines can reach: its glyphs' turned boxes, and their
 * height more on each side, as lines can sit past a tight line's box.
 */
function linesBounds(runs: readonly PlacedRun[]): Rect {
  let [left, top, right, bottom] = [Infinity, Infinity, -Infinity, -Infinity]
  for (const { boxes } of runs) {
    for (let i = 0; i < boxes.length; i += 2) {
      left = Math.min(left, boxes[i] ?? 0)
      right = Math.max(right, boxes[i] ?? 0)
      top = Math.min(top, boxes[i + 1] ?? 0)
      bottom = Math.max(bottom, boxes[i + 1] ?? 0)
    }
  }
  if (left > right) return { x: 0, y: 0, width: 0, height: 0 }
  const reach = bottom - top
  return { x: left - reach, y: top - reach, width: right - left + 2 * reach, height: 3 * reach }
}
