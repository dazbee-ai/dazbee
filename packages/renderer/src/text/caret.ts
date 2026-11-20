// Where the caret goes and what a selection covers in laid-out text, from the graphemes' boxes.
import type { CanvasKit, Paragraph } from '@dazbee/canvaskit'

import type { TextBlock, TextLayout } from './layout.ts'

export interface SelectionBox {
  x: number
  y: number
  width: number
  height: number
  rtl: boolean
}

interface GraphemeBox extends SelectionBox {
  start: number
  end: number
  line: number
}

/** A grapheme edge in a block, and where the caret is drawn for it, beside the box it is drawn on. */
interface DrawnEdge {
  offset: number
  x: number
  box: GraphemeBox
}

/** How far apart, in pixels, two carets are drawn for an arrow to move from one to the other. */
const NEAR = 0.01

const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

/** Every grapheme's box, in its block, measured once per paragraph: a drag asks for the caret every frame. */
const graphemeBoxes = new WeakMap<Paragraph, GraphemeBox[]>()

/**
 * The text offset a click lands on, in the layout's own coordinates (before `dy`): the paragraph
 * under the click (or the nearest one), the line in it, then the grapheme on it nearest the click,
 * then that grapheme's near edge by its own direction. Graphemes are Unicode's (Intl.Segmenter),
 * and the hit-test uses their boxes rather than SkParagraph's glyph lookup, which sends a click on
 * a Devanagari reph to the wrong grapheme.
 */
export function caretAt(ck: CanvasKit, laid: TextLayout, x: number, y: number): number {
  const gap = (top: number, height: number) => Math.max(top - y, 0, y - (top + height))
  const block = laid.blocks.reduce<TextBlock | undefined>(
    (best, b) => (!best || gap(b.y, b.height) < gap(best.y, best.height) ? b : best),
    undefined,
  )
  if (!block) return 0
  const lines = block.paragraph.getLineMetrics()
  if (lines.length === 0) return block.start
  const bx = x - block.x
  const by = y - block.y
  const lineGap = (l: (typeof lines)[number]) => {
    const top = l.baseline - l.ascent
    return Math.max(top - by, 0, by - (top + l.height))
  }
  const line = lines.reduce((best, l) => (lineGap(l) < lineGap(best) ? l : best))
  let best = { offset: line.startIndex, distance: Number.POSITIVE_INFINITY }
  for (const box of boxesOf(ck, block)) {
    if (box.line !== line.lineNumber) continue
    const distance = Math.max(box.x - bx, 0, bx - (box.x + box.width))
    if (distance < best.distance) {
      const beforeMiddle = bx < box.x + box.width / 2
      best = { offset: beforeMiddle !== box.rtl ? box.start : box.end, distance }
    }
  }
  return block.start + Math.min(best.offset, block.text.length)
}

/**
 * Where to draw the caret for an offset, in the layout's own coordinates (before `dy`): the
 * trailing edge of the grapheme before it, or at the start of a paragraph the leading edge of the
 * grapheme after it. At a bidi boundary this is the edge next to the text just typed.
 */
export function caretPosition(
  ck: CanvasKit,
  laid: TextLayout,
  offset: number,
): { x: number; y: number; height: number } {
  const block = blockOf(laid, offset)
  if (!block) return { x: 0, y: 0, height: 0 }
  const local = Math.min(offset - block.start, block.text.length)
  const at = (x: number, y: number, height: number) => ({ x: block.x + x, y: block.y + y, height })
  const edge = drawnEdge(boxesOf(ck, block), local)
  if (edge) return at(edge.x, edge.box.y, edge.box.height)
  // An empty paragraph: where its first character would go.
  const width = block.paragraph.getMaxWidth()
  const lead = laid.rtl ? width : 0
  const x = { start: lead, justify: lead, center: width / 2, end: width - lead }[laid.align]
  return at(x, 0, block.height)
}

/**
 * The offset the Left or Right arrow moves the caret to, on a line that holds right-to-left text:
 * the nearest grapheme edge the way the arrow points on screen, by where `caretPosition` draws
 * each. At the line's end it goes on in reading order, to where the next line starts as it reads,
 * or back to where the line before ends; with no line there it stays. Null on a line all left to
 * right, where a step is one grapheme in reading order.
 */
export function visualStep(ck: CanvasKit, laid: TextLayout, offset: number, right: boolean): number | null {
  const block = blockOf(laid, offset)
  if (!block) return null
  const boxes = boxesOf(ck, block)
  const caret = drawnEdge(boxes, Math.min(offset - block.start, block.text.length))
  if (!caret) return null
  const { line } = caret.box
  if (!laid.rtl && !boxes.some((b) => b.line === line && b.rtl)) return null
  // Nearest first; where two offsets are drawn at one place, as at a change of direction, the lower.
  const [next] = edgesOn(boxes, line)
    .filter((e) => (right ? e.x > caret.x + NEAR : e.x < caret.x - NEAR))
    .sort((a, b) => {
      const nearer = Math.abs(a.x - caret.x) - Math.abs(b.x - caret.x)
      return Math.abs(nearer) > NEAR ? nearer : a.offset - b.offset
    })
  if (next) return block.start + next.offset
  const onward = lineAfter(ck, laid, block, line, right !== laid.rtl)
  if (!onward) return offset
  if (onward.edges.length === 0) return onward.block.start
  // Entered at the end the arrow comes in from: Right enters a line at its left end.
  const entered = onward.edges.reduce((best, e) => ((right ? e.x < best.x : e.x > best.x) ? e : best))
  return onward.block.start + entered.offset
}

/** The boxes that highlight a text range, in the layout's own coordinates: one per run of one direction on one line. */
export function selectionBoxes(ck: CanvasKit, laid: TextLayout, start: number, end: number): SelectionBox[] {
  return laid.blocks.flatMap((b) => {
    const from = Math.max(start, b.start) - b.start
    const to = Math.min(end, b.end) - b.start
    if (to <= from) return []
    return rectsOf(ck, b.paragraph, from, to).map((r) => ({ ...r, x: r.x + b.x, y: r.y + b.y }))
  })
}

function boxesOf(ck: CanvasKit, block: TextBlock): GraphemeBox[] {
  const { paragraph, text } = block
  let boxes = graphemeBoxes.get(paragraph)
  if (!boxes) {
    // getLineNumberAt answers 0 for every offset in CanvasKit 0.42, so lines come from their metrics.
    const lines = paragraph.getLineMetrics()
    boxes = [...graphemeSegmenter.segment(text)].flatMap((g) => {
      const end = g.index + g.segment.length
      const line = lines.find((l) => g.index >= l.startIndex && g.index < l.endIndex)?.lineNumber ?? -1
      return rectsOf(ck, paragraph, g.index, end).map((box) => ({ ...box, start: g.index, end, line }))
    })
    graphemeBoxes.set(paragraph, boxes)
  }
  return boxes
}

/** The block an offset is in: the one whose text or end holds it, else (cut off by maxLines) the last. */
function blockOf(laid: TextLayout, offset: number): TextBlock | undefined {
  return laid.blocks.find((b) => offset >= b.start && offset <= b.end) ?? laid.blocks.at(-1)
}

/**
 * Where the caret is drawn for an offset in a block: the trailing edge of the grapheme before it,
 * or at the start of a paragraph the leading edge of the grapheme after it; nowhere in an empty one.
 */
function drawnEdge(boxes: GraphemeBox[], offset: number): DrawnEdge | undefined {
  const before = boxes.find((b) => b.end === offset)
  if (before) return { offset, x: before.rtl ? before.x : before.x + before.width, box: before }
  const after = boxes.find((b) => b.start === offset)
  if (after) return { offset, x: after.rtl ? after.x + after.width : after.x, box: after }
  return undefined
}

/** Every grapheme edge of a block whose caret is drawn on a line, with where. */
function edgesOn(boxes: GraphemeBox[], line: number): DrawnEdge[] {
  return [...new Set(boxes.flatMap((b) => [b.start, b.end]))].flatMap((offset) => {
    const edge = drawnEdge(boxes, offset)
    return edge?.box.line === line ? [edge] : []
  })
}

/**
 * The line after a block's line in reading order, or before it, with the edges drawn on it: in
 * the same block, else the next paragraph's first line or the one before's last; none past the text.
 */
function lineAfter(
  ck: CanvasKit,
  laid: TextLayout,
  block: TextBlock,
  line: number,
  forward: boolean,
): { block: TextBlock; edges: DrawnEdge[] } | null {
  const linesOf = (boxes: GraphemeBox[]) => [...new Set(boxes.map((b) => b.line))].sort((a, b) => a - b)
  const boxes = boxesOf(ck, block)
  const lines = linesOf(boxes)
  const inBlock = forward ? lines.find((l) => l > line) : lines.findLast((l) => l < line)
  if (inBlock !== undefined) return { block, edges: edgesOn(boxes, inBlock) }
  const other = laid.blocks[laid.blocks.indexOf(block) + (forward ? 1 : -1)]
  if (!other) return null
  const otherBoxes = boxesOf(ck, other)
  const otherLines = linesOf(otherBoxes)
  const first = forward ? otherLines[0] : otherLines.at(-1)
  // An empty paragraph has no edges: its one place is its start.
  return { block: other, edges: first === undefined ? [] : edgesOn(otherBoxes, first) }
}

function rectsOf(ck: CanvasKit, paragraph: Paragraph, start: number, end: number): SelectionBox[] {
  return paragraph
    .getRectsForRange(start, end, ck.RectHeightStyle.Max, ck.RectWidthStyle.Tight)
    .map(({ rect, dir }) => ({
      x: rect[0] ?? 0,
      y: rect[1] ?? 0,
      width: (rect[2] ?? 0) - (rect[0] ?? 0),
      height: (rect[3] ?? 0) - (rect[1] ?? 0),
      rtl: dir.value === ck.TextDirection.RTL.value,
    }))
}
