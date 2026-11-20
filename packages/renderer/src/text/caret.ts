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

/**
 * Where a caret stands: an offset, and whether it is drawn beside the grapheme after it rather
 * than the one before. The two differ where a run of one direction meets a run of the other.
 */
export interface CaretPlace {
  offset: number
  after: boolean
}

interface GraphemeBox extends SelectionBox {
  start: number
  end: number
  line: number
}

/** A place the caret can stand on a line, with where it is drawn. */
interface Slot extends CaretPlace {
  x: number
}

/** How far apart, in pixels, two places are for an arrow to move from one to the other. */
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
 * grapheme after it. At a bidi boundary this is the edge next to the text just typed. With `after`,
 * the leading edge of the grapheme after it, where there is one.
 */
export function caretPosition(
  ck: CanvasKit,
  laid: TextLayout,
  offset: number,
  after = false,
): { x: number; y: number; height: number } {
  const block = blockOf(laid, offset)
  if (!block) return { x: 0, y: 0, height: 0 }
  const local = Math.min(offset - block.start, block.text.length)
  const at = (x: number, y: number, height: number) => ({ x: block.x + x, y: block.y + y, height })
  const edge = drawnEdge(boxesOf(ck, block), local, after)
  if (edge) return at(edge.x, edge.box.y, edge.box.height)
  // An empty paragraph: where its first character would go.
  const width = block.paragraph.getMaxWidth()
  const lead = laid.rtl ? width : 0
  const x = { start: lead, justify: lead, center: width / 2, end: width - lead }[laid.align]
  return at(x, 0, block.height)
}

/**
 * Where the Left or Right arrow moves a caret to, on a line that holds right-to-left text: the next
 * place between graphemes the way the arrow points on screen. A place where two runs of different
 * directions meet belongs to the grapheme of the run set inside the other, so text of its direction
 * typed there lands at the caret. At the line's end the caret goes on in reading order to the next
 * line, or back to the line before, entering it at the end the arrow comes in from; with no line
 * there it stays. Null on a line all left to right, and in text the line limit cut off, where a step
 * is one grapheme in reading order.
 */
export function visualStep(
  ck: CanvasKit,
  laid: TextLayout,
  { offset, after }: CaretPlace,
  right: boolean,
): CaretPlace | null {
  const block = blockOf(laid, offset)
  if (!block || offset < block.start || offset > block.end) return null
  const boxes = boxesOf(ck, block)
  const caret = drawnEdge(boxes, offset - block.start, after)
  if (!caret && block.text !== '') return null
  if (caret && !laid.rtl && !boxes.some((b) => b.line === caret.box.line && b.rtl)) return null
  // An empty paragraph has no places: in a right-to-left layer it steps on as a line's end does.
  if (!caret && !laid.rtl) return null
  const placed = (slot: Slot, on: TextBlock) => ({ offset: on.start + slot.offset, after: slot.after })
  if (caret) {
    const [next] = slotsOn(boxes, caret.box.line, laid.rtl)
      .filter((s) => (right ? s.x > caret.x + NEAR : s.x < caret.x - NEAR))
      .sort((a, b) => Math.abs(a.x - caret.x) - Math.abs(b.x - caret.x))
    if (next) return placed(next, block)
  }
  const onward = lineAfter(ck, laid, block, caret?.box.line ?? 0, right !== laid.rtl)
  if (!onward) return { offset, after }
  if (onward.slots.length === 0) return { offset: onward.block.start, after: false }
  // Right enters a line at its left end, Left at its right end.
  const entered = onward.slots.reduce((best, s) => ((right ? s.x < best.x : s.x > best.x) ? s : best))
  return placed(entered, onward.block)
}

/**
 * Where the Left or Right arrow puts the caret from a selected range: at the range's left or right
 * edge on screen, beside the selected grapheme there. Null for a range over more than one line,
 * where it goes to an end in reading order.
 */
export function rangeEdge(
  ck: CanvasKit,
  laid: TextLayout,
  start: number,
  end: number,
  right: boolean,
): CaretPlace | null {
  const block = blockOf(laid, start)
  if (!block || start < block.start || end > block.end) return null
  const inside = boxesOf(ck, block).filter((b) => b.start >= start - block.start && b.end <= end - block.start)
  const [first] = inside
  if (!first || inside.some((b) => b.line !== first.line)) return null
  const edge = inside.reduce((best, b) => ((right ? b.x + b.width > best.x + best.width : b.x < best.x) ? b : best))
  // Its edge on that side: the start of a grapheme read left to right is its left edge.
  const atStart = edge.rtl === right
  return { offset: block.start + (atStart ? edge.start : edge.end), after: atStart }
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
 * Where the caret is drawn for an offset in a block, and beside which box: the trailing edge of the
 * grapheme before it, else the leading edge of the grapheme after it, that one first with `after`;
 * nowhere in an empty paragraph. A line separator that ends a line early is drawn with no width and
 * on no line, so the caret after it stands at the start of the next line.
 */
function drawnEdge(boxes: GraphemeBox[], offset: number, after = false): { x: number; box: GraphemeBox } | undefined {
  const before = boxes.find((b) => b.end === offset)
  const next = boxes.find((b) => b.start === offset)
  const lineEnd = before && next && before.line < 0 && before.width === 0 && next.line >= 0
  const trailing = before && !lineEnd ? { x: before.rtl ? before.x : before.x + before.width, box: before } : undefined
  const leading = next && { x: next.rtl ? next.x + next.width : next.x, box: next }
  return after ? (leading ?? trailing) : (trailing ?? leading)
}

/**
 * The places the caret can stand on a line, left to right: one between each two graphemes next to
 * each other on screen, and one at each end. A place where two runs of different directions meet
 * goes to the grapheme whose direction is not the paragraph's, the run set inside the other.
 */
function slotsOn(boxes: GraphemeBox[], line: number, rtl: boolean): Slot[] {
  const row = boxes.filter((b) => b.line === line).sort((a, b) => a.x - b.x)
  return [...row, undefined].map((right, i) => {
    const left = row[i - 1]
    // The place beside each neighbour: after the left one's end on screen, before the right one's start.
    const ofLeft = left && (left.rtl ? { offset: left.start, after: true } : { offset: left.end, after: false })
    const ofRight = right && (right.rtl ? { offset: right.end, after: false } : { offset: right.start, after: true })
    const x = left ? left.x + left.width : (right?.x ?? 0)
    if (!ofLeft || !ofRight || !left || !right) return { ...(ofLeft ?? ofRight ?? { offset: 0, after: false }), x }
    // One direction: the one offset, drawn beside the grapheme before it.
    if (left.rtl === right.rtl) return { ...(ofLeft.after ? ofRight : ofLeft), x }
    return { ...(left.rtl !== rtl ? ofLeft : ofRight), x }
  })
}

/**
 * The line after a block's line in reading order, or before it, with its places: in the same
 * block, else the next paragraph's first line or the one before's last; none past the text.
 */
function lineAfter(
  ck: CanvasKit,
  laid: TextLayout,
  block: TextBlock,
  line: number,
  forward: boolean,
): { block: TextBlock; slots: Slot[] } | null {
  // A line separator that ends a line early is on no line.
  const linesOf = (boxes: GraphemeBox[]) =>
    [...new Set(boxes.map((b) => b.line).filter((l) => l >= 0))].sort((a, b) => a - b)
  const boxes = boxesOf(ck, block)
  const lines = linesOf(boxes)
  const inBlock = forward ? lines.find((l) => l > line) : lines.findLast((l) => l < line)
  if (inBlock !== undefined) return { block, slots: slotsOn(boxes, inBlock, laid.rtl) }
  const other = laid.blocks[laid.blocks.indexOf(block) + (forward ? 1 : -1)]
  if (!other) return null
  const otherBoxes = boxesOf(ck, other)
  const otherLines = linesOf(otherBoxes)
  const first = forward ? otherLines[0] : otherLines.at(-1)
  // An empty paragraph has no places: its one place is its start.
  return { block: other, slots: first === undefined ? [] : slotsOn(otherBoxes, first, laid.rtl) }
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
