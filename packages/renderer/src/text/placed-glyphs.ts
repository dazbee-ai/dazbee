// The glyphs of a placement (ADR-0021) as editing reads them: each with where the straight layout
// draws it and where it is placed, so a point of the straight layout moves and turns with its glyph,
// and a point on the placed letters finds its glyph and its place in the straight layout.
import type { Rect } from '@dazbee/schema'

import type { Placement } from './placed.ts'

/** A box turned `turn` degrees clockwise about its corner (x, y); straight without one. */
export interface TurnedRect extends Rect {
  turn?: number
}

/** A placed glyph: its block and line, its origin and advance in the straight layout, its line's reach, and its RSXform. */
export interface PlacedGlyph {
  block: number
  line: number
  x: number
  y: number
  advance: number
  ascent: number
  descent: number
  cos: number
  sin: number
  tx: number
  ty: number
}

/** A placement's glyphs, read once: a drag asks for the caret every frame. */
const glyphsOf = new WeakMap<Placement, PlacedGlyph[]>()

/** Every glyph of a placement, in the layer's box. */
export function placedGlyphs(placement: Placement): PlacedGlyph[] {
  let glyphs = glyphsOf.get(placement)
  if (!glyphs) {
    glyphs = placement.runs.flatMap(({ line, advances, origins, xforms }) =>
      [...advances].map((advance, i) => ({
        block: line.block,
        line: line.index,
        x: origins[2 * i] ?? 0,
        y: origins[2 * i + 1] ?? 0,
        advance,
        ascent: line.ascent,
        descent: line.descent,
        cos: xforms[4 * i] ?? 1,
        sin: xforms[4 * i + 1] ?? 0,
        tx: xforms[4 * i + 2] ?? 0,
        ty: xforms[4 * i + 3] ?? 0,
      })),
    )
    glyphsOf.set(placement, glyphs)
  }
  return glyphs
}

/**
 * The glyph a point at `x` across a block's line of the straight layout moves with: the one whose
 * advance holds it, else the nearest; none on a line with no glyph.
 */
export function glyphAlong(glyphs: readonly PlacedGlyph[], block: number, line: number, x: number) {
  let best: { glyph: PlacedGlyph; gap: number } | undefined
  for (const glyph of glyphs) {
    if (glyph.block !== block || glyph.line !== line) continue
    const gap = Math.max(glyph.x - x, 0, x - (glyph.x + glyph.advance))
    // A glyph of no advance, a mark, holds nothing a glyph with one holds.
    if (!best || gap < best.gap || (gap === best.gap && glyph.advance > best.glyph.advance)) best = { glyph, gap }
  }
  return best?.glyph
}

/** Where a point of the straight layout goes, moved and turned with a glyph. */
export function turnedPoint(glyph: PlacedGlyph, x: number, y: number): [number, number] {
  const [dx, dy] = [x - glyph.x, y - glyph.y]
  return [glyph.cos * dx - glyph.sin * dy + glyph.tx, glyph.sin * dx + glyph.cos * dy + glyph.ty]
}

/** How far a glyph is turned, in degrees clockwise. */
export function turnOf(glyph: PlacedGlyph): number {
  return (Math.atan2(glyph.sin, glyph.cos) * 180) / Math.PI
}

/**
 * The glyph a point on the placed letters is on: the one whose turned box holds it, nearest the
 * middle of its advance where boxes overlap, else the one whose box is nearest. With it, the point
 * back in the straight layout, kept inside that glyph's box. None in a placement with no glyph.
 */
export function glyphUnder(glyphs: readonly PlacedGlyph[], x: number, y: number) {
  let best: { glyph: PlacedGlyph; along: number; down: number; score: number } | undefined
  for (const glyph of glyphs) {
    if (glyph.advance <= 0) continue
    // The point in the glyph's own frame: along its advance from its origin, and down.
    const [dx, dy] = [x - glyph.tx, y - glyph.ty]
    const along = glyph.cos * dx + glyph.sin * dy
    const down = glyph.cos * dy - glyph.sin * dx
    const outside = Math.hypot(
      Math.max(-along, 0, along - glyph.advance),
      Math.max(-glyph.ascent - down, 0, down - glyph.descent),
    )
    // Inside, scored below every outside one by how far off its middle the point is, as a share of its advance.
    const score = outside > 0 ? outside : Math.abs(along / glyph.advance - 0.5) - 1
    if (!best || score < best.score) best = { glyph, along, down, score }
  }
  if (!best) return undefined
  const { glyph, along, down } = best
  return {
    glyph,
    x: glyph.x + Math.min(Math.max(along, 0), glyph.advance),
    y: glyph.y + Math.min(Math.max(down, -glyph.ascent), glyph.descent),
  }
}

/** Each placed glyph's turned box with an advance: its advance by its line's height, as it is drawn. */
export function letterBoxes(placement: Placement): TurnedRect[] {
  return placedGlyphs(placement)
    .filter((g) => g.advance > 0)
    .map((g) => {
      const [x, y] = turnedPoint(g, g.x, g.y - g.ascent)
      return { x, y, width: g.advance, height: g.ascent + g.descent, turn: turnOf(g) }
    })
}
