// Rotational symmetry: how many points a star has, or sides a polygon. The part's edge, scaled to a
// circle, is read as its farthest reach at each of 360 angles; the strongest angular frequency from
// 3 to 48 is the count, its phase the turn that puts a point at the top, where Dazbee's polygons and
// stars start. The count is only a start: the neighbouring counts are tried too, each at six turns
// across one point's period, as the best turn differs with the count.

/** A part's rotational symmetry: its count, the turn that puts a point on top, and its inner to outer reach. */
export interface Symmetry {
  /** The polygon's sides or the star's points. */
  count: number
  /** Degrees to turn a polygon or star so a point sits where the part's does. */
  rotation: number
  /** The part's nearest reach over its farthest, for a star's inner radius. */
  innerRadius: number
}

/** A count, and the rotation to try it at. */
export interface CountTry {
  count: number
  rotation: number
}

/** The most sides a polygon is given; a part with more is a star or an ellipse. */
export const MOST_SIDES = 12

/** Angles the edge is read at. */
const BINS = 360
/** Below this share of angles reached, the part is not round enough about its centre to read. */
const ANGLES_REACHED = 0.8
/** The counts read. */
const FEWEST = 3
const MOST = 48
/** A frequency weaker than this share of the mean reach is no symmetry. */
const WEAKEST = 0.012
/** Counts this far either side of the read one are tried. */
const NEIGHBOURS = [-3, -2, -1, 1, 2, 3] as const
/** Turns tried across one point's period. */
const TURNS = 6

/**
 * The symmetry of a mask about (cx, cy), its reach rx across and ry down scaled to a circle; null
 * when too few angles are reached or no frequency stands out.
 */
export function symmetryOf(
  mask: Float32Array,
  width: number,
  height: number,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
): Symmetry | null {
  const reach = new Float32Array(BINS)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      if ((mask[y * width + x] ?? 0) < 0.5) continue
      const dx = (x + 0.5 - cx) / rx
      const dy = (y + 0.5 - cy) / ry
      const r = Math.hypot(dx, dy)
      const bin = Math.floor(((Math.atan2(dy, dx) + Math.PI) / (2 * Math.PI)) * BINS) % BINS
      if (r > (reach[bin] ?? 0)) reach[bin] = r
    }
  let reached = 0
  for (let i = 0; i < BINS; i++) if ((reach[i] ?? 0) > 0) reached++
  if (reached < BINS * ANGLES_REACHED) return null
  for (let i = 0; i < BINS; i++) if (reach[i] === 0) reach[i] = reach[(i + BINS - 1) % BINS] ?? 0
  let mean = 0
  for (let i = 0; i < BINS; i++) mean += reach[i] ?? 0
  mean /= BINS
  let count = 0
  let strongest = 0
  let phase = 0
  for (let k = FEWEST; k <= MOST; k++) {
    let re = 0
    let im = 0
    for (let i = 0; i < BINS; i++) {
      const a = (2 * Math.PI * k * i) / BINS
      re += ((reach[i] ?? 0) - mean) * Math.cos(a)
      im += ((reach[i] ?? 0) - mean) * Math.sin(a)
    }
    const amplitude = Math.hypot(re, im) / BINS
    if (amplitude > strongest) {
      strongest = amplitude
      count = k
      phase = Math.atan2(im, re)
    }
  }
  if (strongest / mean < WEAKEST) return null
  // A peak where count × angle = phase, the angle from −π at bin 0; the first point sits at −90° (the top).
  const peak = ((phase / count - Math.PI) * 180) / Math.PI
  const period = 360 / count
  let turn = (((peak + 90) % period) + period) % period
  if (turn > period / 2) turn -= period
  let nearest = Infinity
  let farthest = 0
  for (let i = 0; i < BINS; i++) {
    nearest = Math.min(nearest, reach[i] ?? 0)
    farthest = Math.max(farthest, reach[i] ?? 0)
  }
  return { count, rotation: turn, innerRadius: Math.max(0.05, Math.min(0.98, nearest / farthest)) }
}

/** The neighbouring counts of a polygon or star, each at six turns across one point's period from `rotation`. */
export function neighbourCounts(kind: 'polygon' | 'star', count: number, rotation: number): CountTry[] {
  const tries: CountTry[] = []
  for (const step of NEIGHBOURS) {
    const n = count + step
    if (n < FEWEST || (kind === 'polygon' && n > MOST_SIDES)) continue
    for (let k = 0; k < TURNS; k++) tries.push({ count: n, rotation: rotation + (k * 360) / n / TURNS })
  }
  return tries
}
