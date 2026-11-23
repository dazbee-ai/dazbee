// The glyphs of a placement (ADR-0021) as editing reads them: each with where the straight layout
// draws it and where it is placed, so a point of the straight layout moves and turns with its glyph,
// and a point on the placed letters finds its glyph and its place in the straight layout.
import type { Rect } from '@dazbee/schema'

import type { Placement } from './placed.ts'

/**
 * A box turned `turn` degrees clockwise about its corner (x, y); straight without one. With `sweep`
 * it also covers all it passes over carried that far, as a text's 3D sides do.
 */
export interface TurnedRect extends Rect {
  turn?: number
  sweep?: { x: number; y: number }
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

/** A placement's glyphs, and them by their block and line, read once: a drag asks for the caret every frame. */
const glyphsOf = new WeakMap<Placement, { all: PlacedGlyph[]; byLine: Map<string, PlacedGlyph[]> }>()

/**
 * The glyph a point at `x` across a block's line of the straight layout moves with: the one whose
 * advance holds it, else the nearest; none on a line with no glyph.
 */
export function glyphAlong(placement: Placement, block: number, line: number, x: number) {
  return nearest(readGlyphs(placement).byLine.get(`${block} ${line}`) ?? [], x, () => 0)
}

/**
 * The glyph a point of the straight layout off every glyph's line moves with, as the caret in an
 * empty paragraph does: the one nearest it across and down from its baseline; none with no glyph.
 */
export function glyphNear(placement: Placement, x: number, y: number) {
  return nearest(readGlyphs(placement).all, x, (glyph) => Math.abs(y - glyph.y))
}

/** Where a point of the straight layout goes, moved and turned with a glyph. */
export function turnedPoint(glyph: PlacedGlyph, x: number, y: number): [number, number] {
  const [dx, dy] = [x - glyph.x, y - glyph.y]
  return [glyph.cos * dx - glyph.sin * dy + glyph.tx, glyph.sin * dx + glyph.cos * dy + glyph.ty]
}

/** A point in a frame turned `turn` degrees clockwise about (x, y): along its turned x axis, and down. */
export function inFrame(p: { x: number; y: number }, x: number, y: number, turn: number): [number, number] {
  const angle = (turn * Math.PI) / 180
  const [dx, dy] = [p.x - x, p.y - y]
  return [Math.cos(angle) * dx + Math.sin(angle) * dy, Math.cos(angle) * dy - Math.sin(angle) * dx]
}

/**
 * Whether a point is inside a box turned about its corner, its edges included, or inside what the
 * box passes over carried by its sweep: whether, for some share of the sweep, the point moved back
 * by it is inside the box.
 */
export function inTurned(p: { x: number; y: number }, box: TurnedRect): boolean {
  const turn = box.turn ?? 0
  const [along, down] = inFrame(p, box.x, box.y, turn)
  if (!box.sweep) return along >= 0 && along <= box.width && down >= 0 && down <= box.height
  const [byAlong, byDown] = inFrame({ x: box.x + box.sweep.x, y: box.y + box.sweep.y }, box.x, box.y, turn)
  // The shares of the sweep, 0 to 1, for which the point moved back lies inside the box on each axis.
  let [from, to] = [0, 1]
  for (const [at, by, size] of [
    [along, byAlong, box.width],
    [down, byDown, box.height],
  ] as const) {
    if (by === 0) {
      if (at < 0 || at > size) return false
      continue
    }
    const [a, b] = [(at - size) / by, at / by]
    from = Math.max(from, Math.min(a, b))
    to = Math.min(to, Math.max(a, b))
  }
  return from <= to
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
export function glyphUnder(placement: Placement, x: number, y: number) {
  let best: { glyph: PlacedGlyph; along: number; down: number; score: number } | undefined
  for (const glyph of readGlyphs(placement).all) {
    if (glyph.advance <= 0) continue
    // The point in the glyph's own frame: along its advance from its origin, and down.
    const [along, down] = inFrame({ x, y }, glyph.tx, glyph.ty, turnOf(glyph))
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
  return readGlyphs(placement)
    .all.filter((g) => g.advance > 0)
    .map((g) => {
      const [x, y] = turnedPoint(g, g.x, g.y - g.ascent)
      return { x, y, width: g.advance, height: g.ascent + g.descent, turn: turnOf(g) }
    })
}
/** A placement's glyphs, in the layer's box, all and by their block and line. */
function readGlyphs(placement: Placement) {
  let read = glyphsOf.get(placement)
  if (!read) {
    const all = placement.runs.flatMap(({ line, advances, origins, xforms }) =>
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
    const byLine = new Map<string, PlacedGlyph[]>()
    for (const glyph of all) {
      const key = `${glyph.block} ${glyph.line}`
      byLine.set(key, [...(byLine.get(key) ?? []), glyph])
    }
    read = { all, byLine }
    glyphsOf.set(placement, read)
  }
  return read
}

/**
 * Of `glyphs`, the one nearest a point `x` across, `off` farther from some: the one whose advance
 * holds it first, and of glyphs as near, the one with the widest advance, as a mark of no advance
 * holds nothing the glyph it sits on doesn't.
 */
function nearest(glyphs: readonly PlacedGlyph[], x: number, off: (glyph: PlacedGlyph) => number) {
  let best: { glyph: PlacedGlyph; gap: number } | undefined
  for (const glyph of glyphs) {
    const gap = Math.hypot(Math.max(glyph.x - x, 0, x - (glyph.x + glyph.advance)), off(glyph))
    if (!best || gap < best.gap || (gap === best.gap && glyph.advance > best.glyph.advance)) best = { glyph, gap }
  }
  return best?.glyph
}
