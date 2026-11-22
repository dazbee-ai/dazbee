// A laid-out text placed letter by letter (ADR-0021): each glyph its paragraph draws, with the font
// it is drawn in and the styled piece it belongs to, moved and turned by a function the caller
// passes. Drawing a placement draws each run of it as one text blob of turned glyphs.
import type { CanvasKit, Font, GlyphRun, LineMetrics } from '@dazbee/canvaskit'
import type { TextProps } from '@dazbee/schema'

import type { TextLayout } from './layout.ts'
import { utf16Offsets } from './super-sub.ts'
import type { StyledPiece } from './types.ts'

/** A line of a laid-out text, in the text layer's box. */
export interface PlacedLine {
  /** Its block in the layout, and its number among the block's lines. */
  block: number
  index: number
  /** Its baseline as SkParagraph draws its glyphs, rounded to a whole pixel. */
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
  /** The font SkParagraph drew it in, its made-up bold and italic included. Freed with the placement. */
  font: Font
  /** The style of its piece, which paints it in each pass. */
  style: TextProps['style']
  glyphs: Uint16Array
  /** Four numbers for each glyph: its RSXform. */
  xforms: Float32Array
  /** Each glyph's advance. */
  advances: Float32Array
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

/** Leaves every glyph where the paragraph draws it. */
export const inPlace: PlaceGlyph = (line, along, _advance, offset) => [1, 0, along, line.baseline + offset]

/**
 * Places each glyph of a laid-out text's paragraphs with `place`. A glyph whose offset falls past
 * its block's text, as an ellipsis added after it does, takes the piece of the character before it.
 * The layout's `delete` frees the placement once it is set as its `placed`.
 */
export function placeLetters(ck: CanvasKit, layout: TextLayout, place: PlaceGlyph): Placement {
  const runs: PlacedRun[] = []
  for (const [blockIndex, block] of layout.blocks.entries()) {
    const metrics = block.paragraph.getLineMetrics()
    const lines = metrics.map((m) => lineOf(m, blockIndex, block.x, layout.dy + block.y))
    const unitAt = utf16Offsets(block.text)
    // A glyph drawn twice, clipped, where a piece starts inside its cluster, is placed once.
    const seen = new Set<string>()
    for (const shaped of block.paragraph.getShapedLines()) {
      for (const run of shaped.runs) {
        const font = fontOf(ck, run)
        const kept: { glyph: number; piece: StyledPiece; unit: number }[] = []
        for (let g = 0; g < run.glyphs.length; g++) {
          const key = `${run.glyphs[g]} ${run.positions[2 * g]} ${run.positions[2 * g + 1]}`
          if (seen.has(key)) continue
          seen.add(key)
          const unit = unitOf(unitAt, run.offsets[g] ?? 0, block.text.length)
          const piece = pieceAt(layout.pieces, block.start + unit)
          if (piece) kept.push({ glyph: g, piece, unit })
        }
        for (let from = 0; from < kept.length;) {
          const first = kept[from] as (typeof kept)[number]
          let to = from + 1
          while (to < kept.length && kept[to]?.piece === first.piece && kept[to]?.glyph === first.glyph + to - from)
            to++
          const line = lines[lineIndex(metrics, first.unit)] as PlacedLine
          const at = { x: block.x, y: layout.dy + block.y }
          runs.push(placedRun(run, first.glyph, first.glyph + to - from, line, font, first.piece.style, at, place))
          from = to
        }
        run.typeface.delete()
      }
    }
  }
  const fonts = new Set(runs.map((r) => r.font))
  return {
    runs,
    delete() {
      for (const font of fonts) font.delete()
    },
  }
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

/** Glyphs `from` to `to` of a shaped run, placed on their line. */
function placedRun(
  run: GlyphRun,
  from: number,
  to: number,
  line: PlacedLine,
  font: Font,
  style: TextProps['style'],
  { x, y }: { x: number; y: number },
  place: PlaceGlyph,
): PlacedRun {
  const count = to - from
  const xforms = new Float32Array(count * 4)
  const advances = new Float32Array(count)
  const boxes = new Float32Array(count * 8)
  for (let i = 0; i < count; i++) {
    const g = from + i
    const gx = run.positions[2 * g] ?? 0
    // The next glyph's position, or past the last the run's end.
    const advance = Math.max(0, (run.positions[2 * g + 2] ?? gx) - gx)
    const offset = y + (run.positions[2 * g + 1] ?? 0) - line.baseline
    const [scos, ssin, tx, ty] = place(line, x + gx, advance, offset)
    xforms.set([scos, ssin, tx, ty], 4 * i)
    advances[i] = advance
    const corner = (cx: number, cy: number) => [scos * cx - ssin * cy + tx, ssin * cx + scos * cy + ty]
    boxes.set(
      [
        ...corner(0, -line.ascent),
        ...corner(advance, -line.ascent),
        ...corner(advance, line.descent),
        ...corner(0, line.descent),
      ],
      8 * i,
    )
  }
  return {
    block: line.block,
    font,
    style,
    glyphs: run.glyphs.slice(from, to),
    xforms,
    advances,
    boxes,
  }
}
