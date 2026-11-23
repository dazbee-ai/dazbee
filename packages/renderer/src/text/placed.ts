// A laid-out text placed letter by letter (ADR-0021): each glyph its paragraph draws, with the font
// it is drawn in and the styled piece it belongs to, moved and turned by a function the caller
// passes. Drawing a placement draws each run of it as one text blob of turned glyphs.
import type { CanvasKit, Font, GlyphRun, LineMetrics } from '@dazbee/canvaskit'
import type { Rect, TextProps } from '@dazbee/schema'

import type { TextLayout } from './layout.ts'
import { utf16Offsets } from './super-sub.ts'
import type { StyledPiece } from './types.ts'

/** A line of a laid-out text, in the text layer's box. */
export interface PlacedLine {
  /** Its block in the layout, and its number among the block's lines. */
  block: number
  index: number
  /**
   * Its baseline where SkParagraph draws its glyphs: where those of its pieces with no baseline shift
   * sit, whole pixels. Its line metrics' baseline is off by up to a pixel, as SkParagraph rounds the
   * line's height; a line whose every glyph is raised or lowered takes that, rounded.
   */
  baseline: number
  /** Its left edge and width. */
  left: number
  width: number
  /** How far it reaches above and below its baseline. */
  ascent: number
  descent: number
}

/**
 * Where a glyph is drawn: an RSXform (`scos`, `ssin`, `tx`, `ty`) that turns the glyph by the angle
 * whose cosine and sine those are and puts its origin at (`tx`, `ty`) in the layer's box.
 */
export type GlyphXform = readonly [number, number, number, number]

/**
 * Places a glyph from its line, its distance along it (its origin's x in the layer's box), its
 * advance, and its offset off the line's baseline, down for a positive value.
 */
export type PlaceGlyph = (line: PlacedLine, along: number, advance: number, offset: number) => GlyphXform

/** Glyphs side by side of one font and one styled piece, each with where it is drawn. */
export interface PlacedRun {
  /** The block of the layout it is in, whose passes draw it. */
  block: number
  /** The line it is on. */
  line: PlacedLine
  /** The font SkParagraph drew it in, its made-up bold and italic included. Freed with the placement. */
  font: Font
  /** The style of its piece, which paints it in each pass. */
  style: TextProps['style']
  glyphs: Uint16Array
  /** Four numbers for each glyph: its RSXform. */
  xforms: Float32Array
  /** Each glyph's advance. */
  advances: Float32Array
  /** Two numbers for each glyph: its origin where the straight layout draws it, in the layer's box. */
  origins: Float32Array
  /**
   * Eight numbers for each glyph: the corners of its turned box, its advance by its line's height,
   * placed as the glyph is drawn, clockwise from the top left.
   */
  boxes: Float32Array
}

/** Every glyph of a text, placed. */
export interface Placement {
  runs: PlacedRun[]
  delete(): void
}

/** A glyph as its paragraph draws it: in the layer's box, with its font, piece, line and advance. */
interface ShapedGlyph {
  id: number
  font: Font
  piece: StyledPiece
  line: PlacedLine
  x: number
  y: number
  advance: number
}

/** Leaves every glyph where the paragraph draws it. */
export const inPlace: PlaceGlyph = (line, along, _advance, offset) => [1, 0, along, line.baseline + offset]

/**
 * Places each glyph of a laid-out text's paragraphs with `place`. A glyph whose offset falls past
 * its block's text, as an ellipsis added after it does, takes the piece of the character before it.
 * A glyph SkParagraph draws more than once, clipped, where a piece starts inside its cluster, is
 * placed once, in the piece its cluster starts in. The layout's `delete` frees the placement once it
 * is set as its `placed`.
 */
export function placeLetters(ck: CanvasKit, layout: TextLayout, place: PlaceGlyph): Placement {
  const runs: PlacedRun[] = []
  const fonts: Font[] = []
  for (const [index, block] of layout.blocks.entries()) {
    const metrics = block.paragraph.getLineMetrics()
    const lines = metrics.map((m) => lineOf(m, index, block.x, layout.dy + block.y))
    const unitAt = utf16Offsets(block.text)
    const glyphs: ShapedGlyph[] = []
    // The lines whose baseline a glyph with no baseline shift has set.
    const settled = new Set<PlacedLine>()
    // The glyphs kept, by glyph id and cluster, to find a glyph drawn again.
    const kept = new Map<string, ShapedGlyph[]>()
    for (const shaped of block.paragraph.getShapedLines()) {
      for (const run of shaped.runs) {
        const font = fontOf(ck, run)
        fonts.push(font)
        for (let g = 0; g < run.glyphs.length; g++) {
          const x = block.x + (run.positions[2 * g] ?? 0)
          const y = layout.dy + block.y + (run.positions[2 * g + 1] ?? 0)
          // The next glyph's position, or past the last the run's end.
          const advance = Math.max(0, (run.positions[2 * g + 2] ?? 0) - (run.positions[2 * g] ?? 0))
          const key = `${run.glyphs[g]} ${run.offsets[g]}`
          const again = kept.get(key)?.find((k) => Math.abs(k.x - x) < 0.5 && Math.abs(k.y - y) < 0.5)
          if (again) {
            // Each clipped copy ends where its clip does; the last ends where the glyph's advance does.
            again.advance = Math.max(again.advance, advance)
            continue
          }
          const unit = unitOf(unitAt, run.offsets[g] ?? 0, block.text.length)
          const piece = pieceAt(layout.pieces, block.start + unit)
          const line = lines[lineIndex(metrics, unit)]
          if (!piece || !line) continue
          if (!piece.superSub && !settled.has(line)) {
            line.baseline = y
            settled.add(line)
          }
          const glyph = { id: run.glyphs[g] ?? 0, font, piece, line, x, y, advance }
          glyphs.push(glyph)
          kept.set(key, [...(kept.get(key) ?? []), glyph])
        }
        run.typeface.delete()
      }
    }
    for (let from = 0; from < glyphs.length;) {
      const first = glyphs[from] as ShapedGlyph
      let to = from + 1
      while (to < glyphs.length && alike(glyphs[to] as ShapedGlyph, first)) to++
      runs.push(placedRun(glyphs.slice(from, to), place))
      from = to
    }
  }
  // Fonts of runs whose glyphs were all placed already go now.
  const used = new Set(runs.map((r) => r.font))
  for (const font of fonts) if (!used.has(font)) font.delete()
  return {
    runs,
    delete() {
      for (const font of used) font.delete()
    },
  }
}

/** The box round placed runs' turned boxes; null when they hold no glyph. */
export function placedBounds(runs: readonly PlacedRun[]): Rect | null {
  let [left, top, right, bottom] = [Infinity, Infinity, -Infinity, -Infinity]
  for (const { boxes } of runs) {
    for (let i = 0; i < boxes.length; i += 2) {
      left = Math.min(left, boxes[i] ?? 0)
      right = Math.max(right, boxes[i] ?? 0)
      top = Math.min(top, boxes[i + 1] ?? 0)
      bottom = Math.max(bottom, boxes[i + 1] ?? 0)
    }
  }
  return left > right ? null : { x: left, y: top, width: right - left, height: bottom - top }
}

/** A point of a glyph's own space, from its origin along its advance and down, where its RSXform puts it. */
export function placedPoint(xform: ArrayLike<number>, x: number, y: number): [number, number] {
  const [scos, ssin, tx, ty] = [xform[0] ?? 1, xform[1] ?? 0, xform[2] ?? 0, xform[3] ?? 0]
  return [scos * x - ssin * y + tx, ssin * x + scos * y + ty]
}

/** A line's metrics as a placed line, its block at (x, y) in the layer's box. */
function lineOf(m: LineMetrics, block: number, x: number, y: number): PlacedLine {
  return {
    block,
    index: m.lineNumber,
    baseline: y + Math.floor(m.baseline + 0.5),
    left: x + m.left,
    width: m.width,
    ascent: m.ascent,
    descent: m.descent,
  }
}

/** The font a shaped run is drawn in, set up as SkParagraph sets up its fonts. */
function fontOf(ck: CanvasKit, run: GlyphRun): Font {
  const font = new ck.Font(run.typeface, run.size, run.scaleX, run.fakeItalic ? -0.25 : 0)
  font.setEmbolden(run.fakeBold)
  font.setEdging(ck.FontEdging.AntiAlias)
  font.setHinting(ck.FontHinting.Slight)
  font.setSubpixel(true)
  return font
}

/** The UTF-16 offset in the block's text a glyph's UTF-8 offset is at; past its end, its last character. */
function unitOf(unitAt: readonly number[], utf8: number, length: number): number {
  const unit = unitAt[utf8] ?? length
  return unit >= length ? Math.max(0, length - 1) : unit
}

/** The piece a character of the layer's text is drawn in. */
function pieceAt(pieces: readonly StyledPiece[], offset: number): StyledPiece | undefined {
  return pieces.find((p) => offset >= p.start && offset < p.end) ?? pieces.at(-1)
}

/** The line a character of the block's text is on: the one whose range holds it, else the last. */
function lineIndex(metrics: readonly LineMetrics[], unit: number): number {
  const found = metrics.findIndex((m) => unit >= m.startIndex && unit < m.endIndex)
  return found === -1 ? Math.max(0, metrics.length - 1) : found
}

/** Whether two glyphs side by side go in one placed run: of one font, piece and line. */
function alike(a: ShapedGlyph, b: ShapedGlyph): boolean {
  return a.font === b.font && a.piece === b.piece && a.line === b.line
}

/** Glyphs side by side of one font, piece and line, placed. */
function placedRun(glyphs: readonly ShapedGlyph[], place: PlaceGlyph): PlacedRun {
  const [first] = glyphs as [ShapedGlyph]
  const { line } = first
  const xforms = new Float32Array(glyphs.length * 4)
  const advances = new Float32Array(glyphs.length)
  const origins = new Float32Array(glyphs.length * 2)
  const boxes = new Float32Array(glyphs.length * 8)
  glyphs.forEach(({ x, y, advance }, i) => {
    const xform = place(line, x, advance, y - line.baseline)
    xforms.set(xform, 4 * i)
    advances[i] = advance
    origins.set([x, y], 2 * i)
    const corners = [0, -line.ascent, advance, -line.ascent, advance, line.descent, 0, line.descent]
    for (let c = 0; c < 8; c += 2) boxes.set(placedPoint(xform, corners[c] ?? 0, corners[c + 1] ?? 0), 8 * i + c)
  })
  return {
    block: line.block,
    line,
    font: first.font,
    style: first.piece.style,
    glyphs: Uint16Array.from(glyphs, (g) => g.id),
    xforms,
    advances,
    origins,
    boxes,
  }
}
