// A text's 3D sides (its extrusion): what its letters sweep carried back along one angle to a depth,
// as one path filled by nonzero winding. The letters' outlines are read where they are drawn
// (`GlyphOutlines`), one font at a time, and each font's contours turned so its letters wind the
// same way whichever way the font runs them. Each contour then becomes one closed curve: its parts
// the sides leave the letter from where they are, its other parts carried to the depth, joined by
// lines along the way (the contour's convolution with the sweep, whose winding is positive just
// where the sweep reaches). Overlapping curves add up, and no curve runs back over another, so the
// path draws with no seams.
import type { Canvas, CanvasKit, Path } from '@dazbee/canvaskit'
import type { Point, TextExtrusion, TextProps } from '@dazbee/schema'

import { EVERYWHERE } from '../draw/paths.ts'
import type { TextLayout } from './layout.ts'
import { shiftPlaced } from './placed.ts'

/** A piece of an outline: a line, or a quad, conic or cubic Bézier, as its points from its start to its end. */
interface Piece {
  verb: number
  points: number[]
  /** A conic's weight. */
  weight: number
}

/** The black laid over the letters' own paint for the sides' darker shade: black at 35 %. */
export const EXTRUSION_SHADE = '#00000059'

/** How many lines a conic is swept as; a glyph's outline has none, as fonts draw with quads and cubics. */
const CONIC_LINES = 16
/**
 * How far across the sides' way, in pixels, a part of a contour must go to turn the curve from where
 * it is to the depth or back: a part that goes less, as one cut at a turn often does, stays where the
 * part before it is, so the curve never runs out along the way and straight back.
 */
const ACROSS_SLACK = 1e-3

/**
 * How far an extrusion's sides reach behind the letters at the base font size `fontSize`: its depth,
 * a percentage of that size, along its angle, clockwise from the right, to thousandths of a pixel;
 * null without an extrusion or with no depth.
 */
export function extrusionReach(extrusion: TextExtrusion | undefined, fontSize: number): Point | null {
  if (!extrusion || extrusion.depth <= 0) return null
  const depth = (extrusion.depth / 100) * fontSize
  const angle = (extrusion.angle * Math.PI) / 180
  const x = thousandths(depth * Math.cos(angle))
  const y = thousandths(depth * Math.sin(angle))
  return x === 0 && y === 0 ? null : { x, y }
}

/**
 * A colour with `EXTRUSION_SHADE` laid over it, as `#RRGGBBAA`: the colour of the sides' darker
 * shade of letters painted in it.
 */
export function shadedColour(hex: string): string {
  const channel = (from: string, at: number) => Number.parseInt(from.slice(at, at + 2), 16) / 255
  const black = channel(EXTRUSION_SHADE, 7)
  const alpha = channel(hex, 7)
  const shown = black + alpha * (1 - black)
  // Each channel as black over it leaves it, its weight its own alpha, out of the alpha shown.
  const shaded = (at: number) => (shown > 0 ? (channel(hex, at) * alpha * (1 - black)) / shown : 0)
  const byte = (value: number) =>
    Math.round(value * 255)
      .toString(16)
      .padStart(2, '0')
      .toUpperCase()
  return `#${byte(shaded(1))}${byte(shaded(3))}${byte(shaded(5))}${byte(shown)}`
}

/**
 * Grows a laid-out text's box to hold its sides `reach` behind the letters: both ways for an auto
 * width box and a curved text's, which fit their letters, in height only for an auto height box,
 * whose sides reach past it sideways, and not at all for a fixed box. The box keeps its top-left,
 * so sides reaching left or up move the text inside it by their reach. A box that grows is whole
 * pixels, as a curved text's is.
 */
export function holdSides(layout: TextLayout, props: TextProps, reach: Point): void {
  if (props.boxMode === 'fixed' && !props.curve) return
  const across = props.boxMode === 'autoWidth' || props.curve !== undefined
  const left = across ? Math.max(0, -reach.x) : 0
  const top = Math.max(0, -reach.y)
  if (left > 0 || top > 0) shiftText(layout, left, top)
  if (across && reach.x !== 0) layout.width = Math.ceil(layout.width + Math.abs(reach.x))
  if (reach.y !== 0) layout.height = Math.ceil(layout.height + Math.abs(reach.y))
}

/**
 * A laid-out text's sides `reach` behind its letters, in the layer's box: from each run of its
 * letters, each in one font, where they are drawn, and each list marker. The caller deletes it.
 */
export function textSides(ck: CanvasKit, layout: TextLayout, reach: Point): Path {
  const outlines: Path[] = []
  const paint = new ck.Paint()
  try {
    for (const run of layout.letters().runs) {
      const blob = ck.TextBlob.MakeFromRSXformGlyphs(run.glyphs, run.xforms, run.font)
      try {
        outlines.push(glyphOutlines(ck, (canvas) => canvas.drawTextBlob(blob, 0, 0, paint)))
      } finally {
        blob.delete()
      }
    }
    for (const block of layout.blocks) {
      const { marker } = block
      if (marker)
        outlines.push(
          glyphOutlines(ck, (canvas) =>
            canvas.drawParagraph(marker, block.markerX, layout.dy + block.y + block.markerY),
          ),
        )
    }
    return sweptOutlines(ck, outlines, reach)
  } finally {
    paint.delete()
    for (const outline of outlines) outline.delete()
  }
}

/**
 * What shapes sweep carried back by `reach`, as one path filled by nonzero winding: each of
 * `outlines` the glyphs of one font, whose contours all run one way for the outside of a letter and
 * the other for a counter. Each font's contours are turned, where they run the other way, so its
 * letters wind positive; then each contour is swept (`addSwept`). The caller deletes it.
 */
export function sweptOutlines(ck: CanvasKit, outlines: readonly Path[], reach: Point): Path {
  const cmds: number[] = []
  for (const outline of outlines) {
    const read = contoursOf(ck, outline.toCmds())
    const contours = signedArea(read) < 0 ? read.map(reversed) : read
    for (const contour of contours) addSwept(ck, cmds, contour, reach)
  }
  const path = ck.Path.MakeFromCmds(cmds)
  if (!path) throw new Error('CanvasKit could not make the 3D sides')
  return path
}

/** A value rounded to thousandths, with no negative zero. */
function thousandths(value: number): number {
  return Math.round(value * 1000) / 1000 + 0
}

/** Moves a laid-out text's letters and list markers right and down, as a box keeping its top-left does. */
function shiftText(layout: TextLayout, dx: number, dy: number) {
  if (layout.placed) {
    shiftPlaced(layout, layout.placed, dx, dy)
    return
  }
  for (const block of layout.blocks) {
    block.x += dx
    block.y += dy
    block.markerX += dx
  }
}

/** The outlines of the glyphs `draw` draws, placed as drawn. The caller deletes it. */
function glyphOutlines(ck: CanvasKit, draw: (canvas: Canvas) => void): Path {
  const recorder = new ck.PictureRecorder()
  draw(recorder.beginRecording(EVERYWHERE))
  const picture = recorder.finishRecordingAsPicture()
  recorder.delete()
  const outlines = ck.GlyphOutlines(picture)
  picture.delete()
  return outlines
}

/** A path's contours, from its commands, each closed by a line back to its start where it ends elsewhere. */
function contoursOf(ck: CanvasKit, cmds: Float32Array): Piece[][] {
  const contours: Piece[][] = []
  let contour: Piece[] = []
  let [startX, startY, x, y] = [0, 0, 0, 0]
  const end = () => {
    if (contour.length > 0 && (x !== startX || y !== startY))
      contour.push({ verb: ck.LINE_VERB, points: [x, y, startX, startY], weight: 1 })
    if (contour.length > 0) contours.push(contour)
    contour = []
    ;[x, y] = [startX, startY]
  }
  /** Adds a piece to the point `count` points on, and moves there. */
  const piece = (verb: number, at: number, count: number, weight = 1) => {
    const points = [x, y, ...cmds.subarray(at, at + 2 * count)]
    contour.push({ verb, points, weight })
    ;[x, y] = [points.at(-2) ?? x, points.at(-1) ?? y]
  }
  for (let i = 0; i < cmds.length;) {
    const verb = cmds[i] ?? ck.CLOSE_VERB
    if (verb === ck.MOVE_VERB) {
      end()
      ;[startX, startY] = [cmds[i + 1] ?? 0, cmds[i + 2] ?? 0]
      ;[x, y] = [startX, startY]
      i += 3
    } else if (verb === ck.LINE_VERB) {
      piece(verb, i + 1, 1)
      i += 3
    } else if (verb === ck.QUAD_VERB) {
      piece(verb, i + 1, 2)
      i += 5
    } else if (verb === ck.CONIC_VERB) {
      piece(verb, i + 1, 2, cmds[i + 5] ?? 1)
      i += 6
    } else if (verb === ck.CUBIC_VERB) {
      piece(verb, i + 1, 3)
      i += 7
    } else {
      end()
      i += 1
    }
  }
  end()
  return contours
}

/**
 * The area contours enclose, positive where they run clockwise on the screen (y down), each piece
 * read by its control points: only its sign is used, which a font's letters set.
 */
function signedArea(contours: readonly Piece[][]): number {
  let area = 0
  for (const contour of contours)
    for (const { points } of contour)
      for (let i = 0; i + 3 < points.length; i += 2)
        area += (points[i] ?? 0) * (points[i + 3] ?? 0) - (points[i + 2] ?? 0) * (points[i + 1] ?? 0)
  return area
}

/** A contour run the other way. */
function reversed(contour: readonly Piece[]): Piece[] {
  return contour.toReversed().map((piece) => ({ ...piece, points: reversedPoints(piece.points) }))
}

/** A piece's points from its end to its start. */
function reversedPoints(points: readonly number[]): number[] {
  const out: number[] = []
  for (let i = points.length - 2; i >= 0; i -= 2) out.push(points[i] ?? 0, points[i + 1] ?? 0)
  return out
}

/**
 * Adds what a contour, wound as the letters are, sweeps carried by `reach` to path commands, as one
 * closed curve: each part the sides leave the letter from, where a point carried along `reach` goes
 * into it (where its place across the sides' way goes down), where it is; every other part carried
 * by `reach`; and a line along `reach` where one turns into the other. A part that goes no way
 * across, within `ACROSS_SLACK`, stays with the part before it, the contour's first parts with its
 * last part that goes across.
 */
function addSwept(ck: CanvasKit, cmds: number[], contour: readonly Piece[], reach: Point) {
  const across = (x: number, y: number) => -reach.y * x + reach.x * y
  const slack = ACROSS_SLACK * Math.hypot(reach.x, reach.y)
  const still = { x: 0, y: 0 }
  const parts = contour.flatMap((piece) => monotone(ck, piece, across))
  // Where each part is drawn: where it is, at the depth, or with the part before it (null).
  const ways = parts.map(({ points }): Point | null => {
    const from = across(points[0] ?? 0, points[1] ?? 0)
    const to = across(points.at(-2) ?? 0, points.at(-1) ?? 0)
    return to < from - slack ? still : to > from + slack ? reach : null
  })
  let at: Point = ways.findLast((way) => way !== null) ?? reach
  const first = at
  for (const [i, part] of parts.entries()) {
    const { points } = part
    const [x, y] = [points[0] ?? 0, points[1] ?? 0]
    const by = ways[i] ?? at
    if (i === 0) cmds.push(ck.MOVE_VERB, x + by.x, y + by.y)
    else if (by !== at) cmds.push(ck.LINE_VERB, x + by.x, y + by.y)
    addPiece(ck, cmds, part, points, by)
    at = by
  }
  if (parts.length === 0) return
  const [x0 = 0, y0 = 0] = parts[0]?.points ?? []
  const start = ways[0] ?? first
  if (at !== start) cmds.push(ck.LINE_VERB, x0 + start.x, y0 + start.y)
  cmds.push(ck.CLOSE_VERB)
}

/**
 * A piece cut where its place across the sides' way turns back, so each part only goes one way
 * across it; a conic, which no glyph has, as lines along it.
 */
function monotone(ck: CanvasKit, piece: Piece, across: (x: number, y: number) => number): Piece[] {
  const { verb, points } = piece
  if (verb === ck.CONIC_VERB) return conicLines(ck, piece)
  if (verb !== ck.QUAD_VERB && verb !== ck.CUBIC_VERB) return [piece]
  const s: number[] = []
  for (let i = 0; i < points.length; i += 2) s.push(across(points[i] ?? 0, points[i + 1] ?? 0))
  const turns = verb === ck.QUAD_VERB ? quadTurns(s) : cubicTurns(s)
  const parts: Piece[] = []
  let rest = points
  let done = 0
  for (const t of turns) {
    const [head, tail] = splitAt(rest, (t - done) / (1 - done))
    parts.push({ ...piece, points: head })
    rest = tail
    done = t
  }
  parts.push({ ...piece, points: rest })
  return parts
}

/** Adds a piece drawn through `points` (its start, already reached, left out), moved by `by`, to path commands. */
function addPiece(ck: CanvasKit, cmds: number[], piece: Piece, points: readonly number[], by: Point) {
  cmds.push(piece.verb)
  for (let i = 2; i < points.length; i += 2) cmds.push((points[i] ?? 0) + by.x, (points[i + 1] ?? 0) + by.y)
  if (piece.verb === ck.CONIC_VERB) cmds.push(piece.weight)
}

/** A conic as `CONIC_LINES` lines through points along it. */
function conicLines(ck: CanvasKit, { points, weight }: Piece): Piece[] {
  const [x0 = 0, y0 = 0, x1 = 0, y1 = 0, x2 = 0, y2 = 0] = points
  const at = (t: number) => {
    const [a, b, c] = [(1 - t) * (1 - t), 2 * weight * t * (1 - t), t * t]
    const sum = a + b + c
    return [(a * x0 + b * x1 + c * x2) / sum, (a * y0 + b * y1 + c * y2) / sum]
  }
  const lines: Piece[] = []
  for (let i = 0; i < CONIC_LINES; i++)
    lines.push({ verb: ck.LINE_VERB, points: [...at(i / CONIC_LINES), ...at((i + 1) / CONIC_LINES)], weight: 1 })
  return lines
}

/** Where, strictly inside it, a quad's place across turns back: where its derivative is 0. */
function quadTurns([s0 = 0, s1 = 0, s2 = 0]: readonly number[]): number[] {
  const bend = s0 - 2 * s1 + s2
  return bend === 0 ? [] : inside([(s0 - s1) / bend])
}

/** Where, strictly inside it, a cubic's place across turns back: the roots of its derivative, in order. */
function cubicTurns([s0 = 0, s1 = 0, s2 = 0, s3 = 0]: readonly number[]): number[] {
  const [d0, d1, d2] = [s1 - s0, s2 - s1, s3 - s2]
  const a = d0 - 2 * d1 + d2
  const b = 2 * (d1 - d0)
  if (Math.abs(a) <= 1e-12 * (Math.abs(b) + Math.abs(d0))) return b === 0 ? [] : inside([-d0 / b])
  const disc = b * b - 4 * a * d0
  if (disc < 0) return []
  const root = Math.sqrt(disc)
  return inside([(-b - root) / (2 * a), (-b + root) / (2 * a)])
}

/** The values strictly between 0 and 1, in order, once each. */
function inside(ts: readonly number[]): number[] {
  return [...new Set(ts.filter((t) => t > 1e-9 && t < 1 - 1e-9))].sort((a, b) => a - b)
}

/** A Bézier's points cut at `t` into its two parts, by de Casteljau's steps. */
function splitAt(points: readonly number[], t: number): [number[], number[]] {
  let row = [...points]
  const head = [row[0] ?? 0, row[1] ?? 0]
  const tail = [row.at(-2) ?? 0, row.at(-1) ?? 0]
  while (row.length > 2) {
    const next: number[] = []
    for (let i = 0; i + 3 < row.length; i += 2)
      next.push(lerp(row[i] ?? 0, row[i + 2] ?? 0, t), lerp(row[i + 1] ?? 0, row[i + 3] ?? 0, t))
    head.push(next[0] ?? 0, next[1] ?? 0)
    tail.unshift(next.at(-2) ?? 0, next.at(-1) ?? 0)
    row = next
  }
  return [head, tail]
}

/** The number `t` of the way from `a` to `b`. */
function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t
}
