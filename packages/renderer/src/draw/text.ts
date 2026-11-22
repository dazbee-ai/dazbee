import type { Canvas, CanvasKit, Paragraph } from '@dazbee/canvaskit'
import type { Rect } from '@dazbee/schema'

import type { Resources } from '../resources.ts'
import type { SceneLayer } from '../scene.ts'
import { laidOut } from '../text/cache.ts'
import type { TextBlock } from '../text/layout.ts'
import { flipMatrix } from './flip.ts'
import { paintFor } from './paint.ts'
import { EVERYWHERE } from './paths.ts'

type TextLayer = Extract<SceneLayer, { type: 'text' }>

/**
 * Draws a text's lines, mirrored about its box's centre as it is flipped, from its box's corner, where
 * its gradients are placed: outlines under the letters first, then each block's fill, the lines its
 * gradients fill, its outlines over the letters and its marker.
 */
export function drawText(ck: CanvasKit, canvas: Canvas, layer: TextLayer, resources: Resources) {
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
  ck.DrawTextAsPaths(canvas, picture, false)
  picture.delete()
}
