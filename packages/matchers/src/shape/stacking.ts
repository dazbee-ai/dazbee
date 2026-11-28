// Stacking: a piece's patches back to front, the largest outline first, each with its place among the others: the
// patch whose closed hole it lies in, whether it shows what lies under the patch around it, the holes it keeps, and
// the rectangle or ellipse it is (`primitives.ts`), found whole where smaller patches lie over part of it. A patch
// with one see-through hole of the same shape is that shape as an outline stroke; a ring whose hole one shape of
// its kind fills is that shape's border; and patches of one colour that smaller patches cut apart are one surface.

import { ciede2000, srgbToLab } from '../looks-same/colour.ts'
import type { ShapeFit } from './fit/fit-shapes.ts'
import type { GradientFit } from './fit/gradient.ts'
import { holds, type Loop } from './outlines.ts'
import type { Patch } from './patches.ts'
import { distanceTo, fitPrimitives, type Primitive } from './primitives.ts'

/** A patch as it is stacked: what lies under it, which holes stay, and the shape it is when it is one. */
export interface Stacked {
  patch: Patch
  /** The patch whose closed hole it lies in, when it lies in one. */
  parent: Patch | null
  /** It shows what is under the patch around it: no graphic of its own. */
  seenThrough: boolean
  /** Its outlines as a path keeps them: the outer ones and the holes that stay. */
  outer: Loop[]
  holes: Loop[]
  /** Whether a hole of it is closed over other patches, or it stands for other patches of its colour too. */
  closes: boolean
  /** Another patch of its colour stands for it: a surface cut in pieces by what lies on it, found whole. */
  absorbed: boolean
  primitive: { shape: Primitive; stroke: number } | null
  /** Its fill as a gradient, in worked pixels, when it shades as one. */
  gradient?: GradientFit | null
  /** The regular polygon or star it is, in worked pixels, when it is one. */
  regular?: ShapeFit | null
  /** It is the border of the shape that fills its hole: that shape, and the border's width in worked pixels. */
  border?: { filler: Stacked; width: number }
}

/** The most points in a row, between free points of an outline, that are free with them. */
const FREE_GAP = 2

/** The settings of the stacking. */
export const STACKING = {
  /** An outline is a primitive when its mean and 95th-percentile distance to it are within these: pixels, or a share of its shorter side when that is more. */
  meanPixels: 0.5,
  meanShare: 0.006,
  p95Pixels: 1.25,
  p95Share: 0.02,
  /**
   * And its farthest point must lie within these of it, so no one place of it strays (a corner cut off, a bump):
   * pixels, a share of its shorter side, or a share of its longer side, which lets a hairline's end be a little off.
   */
  farthestPixels: 2,
  farthestShare: 0.03,
  farthestOfLong: 0.01,
  /** An ellipse is picked over a rectangle that is this many pixels closer or less. */
  roundWins: 0.05,
  /** And over a rectangle rounded into a circle that is this many pixels closer or less. */
  circleWins: 0.3,
  /** A ring is a shape's border when it is at most this share of the shape's shorter side wide. */
  borderShare: 0.25,
  /** A primitive may leave at most this share of its patch outside it, and hold at most this share of what isn't the patch or over it. */
  misfit: 0.02,
  /** A patch with more of its outline under other patches than this is traced as it shows. */
  mostFree: 0.6,
  /** Patches inside a hole close it when they fill at least this share of it. */
  closed: 0.9,
  /** A hole shows what lies under its patch when its colour is within this ΔE00 of that. */
  window: 5,
  /** An outline holding at most this many pixels, or this share of its patch's largest, is a crumb. */
  crumbPixels: 6,
  crumbShare: 0.003,
} as const

/** The patches back to front, each with its place among the others worked out. */
export function stack(patches: readonly Patch[], patchOf: Int32Array, width: number, height: number): Stacked[] {
  const order = [...patches].sort((a, b) => b.outline - a.outline || b.area - a.area)
  // Every patch of the cut has a rank, -1 for one that is no graphic.
  let last = -1
  for (let i = 0; i < patchOf.length; i++) last = Math.max(last, patchOf[i] ?? -1)
  const rank = new Int32Array(last + 1).fill(-1)
  order.forEach((r, i) => (rank[r.id] = i))
  const stacked: Stacked[] = order.map((patch) => ({
    patch,
    parent: null,
    seenThrough: false,
    outer: patch.loops.filter((loop) => loop.area > 0),
    holes: patch.loops.filter((loop) => loop.area < 0),
    closes: false,
    absorbed: false,
    primitive: null,
  }))
  // Each patch's parent: the smallest patch with a hole that holds it.
  const boxes = stacked.map((s) => s.holes.map(boxOf))
  for (const [i, s] of stacked.entries()) {
    const px = s.patch.seed[0] + 0.5
    const py = s.patch.seed[1] + 0.5
    for (let j = i - 1; j >= 0; j--) {
      const candidate = stacked[j]
      const holeBoxes = boxes[j]
      if (!candidate || !holeBoxes) continue
      const b = candidate.patch.box
      if (px < b.x0 || px > b.x1 + 1 || py < b.y0 || py > b.y1 + 1) continue
      const holding = candidate.holes.some((hole, k) => {
        const hb = holeBoxes[k]
        if (!hb) return false
        return px >= hb.x0 && px <= hb.x1 && py >= hb.y0 && py <= hb.y1 && holds(hole.points, px, py)
      })
      if (holding) {
        s.parent = candidate.patch
        break
      }
    }
  }
  const of = new Map(stacked.map((s) => [s.patch.id, s]))
  const lab = new Map(stacked.map((s) => [s.patch.id, srgbToLab(...s.patch.rgb)]))
  // From the back: a patch the colour of what lies under the patch around it is that patch's hole.
  for (const s of stacked) {
    const around = s.parent ? of.get(s.parent.id) : null
    if (!around || around.seenThrough) continue
    const under = around.parent
    if (!under) continue
    const own = lab.get(s.patch.id)
    const below = lab.get(under.id)
    if (own && below && ciede2000(own, below) <= STACKING.window) s.seenThrough = true
  }
  const closed = new Map<Stacked, { hole: Loop; inside: Stacked[] }[]>()
  for (const [j, s] of stacked.entries()) {
    // A hole stays when smaller patches don't fill it, or it holds a patch seen through; else they close it.
    const kept: Loop[] = []
    for (const [k, hole] of s.holes.entries()) {
      const hb = boxes[j]?.[k]
      if (!hb) continue
      const inside = stacked.filter(
        (other) =>
          other.parent === s.patch &&
          other.patch.seed[0] + 0.5 >= hb.x0 &&
          other.patch.seed[0] + 0.5 <= hb.x1 &&
          holds(hole.points, other.patch.seed[0] + 0.5, other.patch.seed[1] + 0.5),
      )
      const covered = inside.reduce((sum, other) => sum + other.patch.outline, 0)
      if (covered < STACKING.closed * -hole.area || inside.some((other) => other.seenThrough)) kept.push(hole)
      else {
        s.closes = true
        closed.set(s, [...(closed.get(s) ?? []), { hole, inside }])
      }
    }
    s.holes = kept
  }
  for (const s of stacked) if (!s.seenThrough) s.primitive = primitiveOf(s, rank, patchOf, width, height)
  // A ring whose one hole one shape of its own kind fills, evenly inside it, is that shape's border: the two are
  // one graphic, filled with the inner shape's colour and stroked with the ring's.
  for (const s of stacked) {
    const holes = closed.get(s)
    const only = holes?.[0]
    if (!s.primitive || s.primitive.stroke || s.holes.length || holes?.length !== 1 || !only) continue
    const { hole, inside } = only
    const filler = inside.length === 1 ? inside[0] : null
    if (!filler?.primitive || filler.primitive.stroke || filler.primitive.shape.kind !== s.primitive.shape.kind)
      continue
    const outer = s.primitive.shape
    const inner = fitPrimitives(hole.points)
      .filter((p) => p.kind === outer.kind && close(p))
      .sort(closest)[0]
    if (!inner) continue
    const across = (outer.width - inner.width) / 2
    const down = (outer.height - inner.height) / 2
    const stroke = (across + down) / 2
    const even = Math.max(1, 0.2 * stroke)
    if (Math.abs(across - down) > even || Math.hypot(outer.cx - inner.cx, outer.cy - inner.cy) > even) continue
    if (stroke > STACKING.borderShare * Math.min(outer.width, outer.height)) continue
    s.border = { filler, width: stroke }
    filler.absorbed = true
  }
  // Patches of one colour that smaller patches cut apart are one surface when one primitive holds them all: the
  // largest of them stands for it, under what lies on it.
  const surfaces = new Map<string, Stacked[]>()
  for (const s of stacked) {
    if (s.seenThrough) continue
    const key = `${s.parent?.id ?? -1} ${s.patch.colour} ${Math.round(s.patch.alpha * 10)}`
    const list = surfaces.get(key)
    if (list) list.push(s)
    else surfaces.set(key, [s])
  }
  for (const members of surfaces.values()) {
    const first = members[0]
    if (!first || members.length < 2 || members.some((m) => m.holes.length > 0)) continue
    const shape = shapeOf(
      members.flatMap((m) => m.outer),
      new Set(members.map((m) => m.patch.id)),
      members.reduce((sum, m) => sum + m.patch.area, 0),
      rank[first.patch.id] ?? 0,
      rank,
      patchOf,
      width,
      height,
    )
    if (!shape) continue
    first.primitive = { shape, stroke: 0 }
    first.closes = true
    for (const m of members.slice(1)) m.absorbed = true
  }
  return stacked
}

function boxOf(loop: Loop) {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (let k = 0; k < loop.points.length; k += 2) {
    const x = loop.points[k] ?? 0
    const y = loop.points[k + 1] ?? 0
    if (x < x0) x0 = x
    if (x > x1) x1 = x
    if (y < y0) y0 = y
    if (y > y1) y1 = y
  }
  return { x0, y0, x1, y1 }
}

/** The primitive a stacked patch is, with its stroke's width when it is an outline, or null when it is none. */
function primitiveOf(
  s: Stacked,
  rank: Int32Array,
  patchOf: Int32Array,
  width: number,
  height: number,
): Stacked['primitive'] {
  // Crumbs, the specks of outline a noisy edge leaves beside a shape or in it, make it no less of a shape.
  const largest = Math.max(0, ...s.outer.map((loop) => loop.area))
  const crumb = Math.max(STACKING.crumbPixels, STACKING.crumbShare * largest)
  const outer = s.outer.filter((loop) => loop.area > crumb)
  const holes = s.holes.filter((loop) => -loop.area > crumb)
  if (outer.length !== 1 || holes.length > 1) return null
  const hole = holes[0]
  const shape = shapeOf(
    outer,
    new Set([s.patch.id]),
    s.patch.area,
    rank[s.patch.id] ?? 0,
    rank,
    patchOf,
    width,
    height,
    hole,
  )
  if (!shape) return null
  if (!hole) return { shape, stroke: 0 }
  // One hole of the same shape, evenly inside the outline, makes it an outline stroke.
  const inner = fitPrimitives(hole.points)
    .filter((p) => p.kind === shape.kind && close(p))
    .sort(closest)[0]
  if (!inner) return null
  const across = (shape.width - inner.width) / 2
  const down = (shape.height - inner.height) / 2
  const stroke = (across + down) / 2
  const even = Math.max(1, 0.2 * stroke)
  if (Math.abs(across - down) > even || Math.hypot(shape.cx - inner.cx, shape.cy - inner.cy) > even) return null
  return { shape, stroke }
}

/** Whether an outline keeps close enough to a primitive to be one. */
function close(p: Primitive): boolean {
  const least = Math.min(p.width, p.height)
  const most = Math.max(p.width, p.height)
  return (
    p.mean <= Math.max(STACKING.meanPixels, STACKING.meanShare * least) &&
    p.p95 <= Math.max(STACKING.p95Pixels, STACKING.p95Share * least) &&
    p.max <= Math.max(STACKING.farthestPixels, STACKING.farthestShare * least, STACKING.farthestOfLong * most)
  )
}

/** Orders primitives by how close their outline keeps to them; an ellipse wins a tie, as a circle is one. */
function closest(a: Primitive, b: Primitive): number {
  // A rectangle rounded all the way and as wide as it is tall is a circle drawn the long way round.
  const round = (p: Primitive) =>
    p.kind === 'rect' &&
    Math.abs(p.width - p.height) <= 0.03 * Math.max(p.width, p.height) &&
    Math.min(...p.corners) >= 0.9 * (Math.min(p.width, p.height) / 2)
  const tie = (p: Primitive, other: Primitive) =>
    p.kind === 'ellipse' ? (round(other) ? STACKING.circleWins : STACKING.roundWins) : 0
  return a.mean - tie(a, b) - (b.mean - tie(b, a))
}

/**
 * The primitive that outlines of patches `ids`, of `area` pixels in all, keep to, which holds those patches and
 * little else, or null. A point of an outline is free, and not counted, where a patch smaller than the one ranked
 * `own` lies on the other side of it: the shape may run under that patch.
 */
function shapeOf(
  outlines: readonly Loop[],
  ids: ReadonlySet<number>,
  area: number,
  own: number,
  rank: Int32Array,
  patchOf: Int32Array,
  width: number,
  height: number,
  hollow?: Loop,
): Primitive | null {
  let count = 0
  for (const outline of outlines) count += outline.points.length / 2
  const points = new Float32Array(count * 2)
  const free = new Uint8Array(count)
  let at = 0
  let freed = 0
  for (const outline of outlines) {
    points.set(outline.points, at * 2)
    for (let k = 0; k < outline.points.length / 2; k++, at++) {
      const x = outline.points[k * 2] ?? 0
      const y = outline.points[k * 2 + 1] ?? 0
      for (const [dx, dy] of [
        [-0.5, -0.5],
        [0.5, -0.5],
        [-0.5, 0.5],
        [0.5, 0.5],
      ] as const) {
        const xx = Math.floor(x + dx)
        const yy = Math.floor(y + dy)
        if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue
        const other = patchOf[yy * width + xx] ?? 0
        if (other >= 0 && !ids.has(other) && (rank[other] ?? -1) > own) free[at] = 1
      }
    }
    // Where the smaller patch only brushes the outline, a point or two in a run of free points has none of its
    // pixels beside it: they are free with the run.
    const first = at - outline.points.length / 2
    const n = at - first
    for (let k = 0; k < n; k++) {
      if (free[first + k] || !free[first + ((k + n - 1) % n)]) continue
      let run = 1
      while (run <= FREE_GAP && !free[first + ((k + run) % n)]) run++
      if (run <= FREE_GAP) for (let g = 0; g < run; g++) free[first + ((k + g) % n)] = 1
    }
  }
  for (let k = 0; k < count; k++) freed += free[k] ?? 0
  if (freed > STACKING.mostFree * count) return null
  const shape = fitPrimitives(points, freed ? free : undefined)
    .filter(close)
    .sort(closest)[0]
  if (!shape) return null
  // It must hold the patches, and what else it covers must lie under smaller patches.
  const reach = Math.hypot(shape.width, shape.height) / 2
  const x0 = Math.max(0, Math.floor(shape.cx - reach))
  const y0 = Math.max(0, Math.floor(shape.cy - reach))
  const x1 = Math.min(width - 1, Math.ceil(shape.cx + reach))
  const y1 = Math.min(height - 1, Math.ceil(shape.cy + reach))
  const step = Math.max(1, Math.floor(Math.sqrt(((x1 - x0 + 1) * (y1 - y0 + 1)) / 10_000)))
  let inside = 0
  let wrong = 0
  let held = 0
  for (let y = y0; y <= y1; y += step)
    for (let x = x0; x <= x1; x += step) {
      const other = patchOf[y * width + x] ?? 0
      const d = distanceTo(shape, x + 0.5, y + 0.5)
      if (d < 1 && ids.has(other)) held++
      if (d < -1) {
        // What a kept hole shows is no part of the shape.
        if (hollow && !ids.has(other) && holds(hollow.points, x + 0.5, y + 0.5)) continue
        inside++
        // A patch that is no graphic is too small to matter: it is neither under the shape nor wrong in it.
        const ranked = rank[other] ?? -1
        if (!ids.has(other) && (other < 0 || (ranked >= 0 && ranked < own))) wrong++
      }
    }
  return held * step * step >= (1 - STACKING.misfit) * area && wrong <= STACKING.misfit * inside ? shape : null
}
