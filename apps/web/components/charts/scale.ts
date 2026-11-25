// The numbers along a chart's axes: round ticks up to past the largest value, and how many of the points
// along the x axis can be named without their names running into each other.

/** The steps a tick may take, each times a power of ten. */
const STEPS = [1, 2, 2.5, 5, 10]

/**
 * Round ticks from 0 to at or past `max`, about `count` steps apart, each step 1, 2, 2.5 or 5 times a power of
 * ten. Nothing to show gives 0 and 1.
 */
export function niceTicks(max: number, count = 4): number[] {
  if (!(max > 0) || !Number.isFinite(max)) return [0, 1]
  const rough = max / count
  const power = 10 ** Math.floor(Math.log10(rough))
  const step = (STEPS.find((each) => each * power >= rough * (1 - 1e-9)) ?? 10) * power
  const steps = Math.ceil(max / step - 1e-9)
  return Array.from({ length: steps + 1 }, (_, i) => Number((i * step).toPrecision(12)))
}

/**
 * Which points along an x axis `width` px wide are named: every `n`th, so names sit at least `gap` px apart,
 * counted back from the last so the newest is always named.
 */
export function namedPoints(count: number, width: number, gap = 64): Set<number> {
  const every = Math.max(1, Math.ceil((count * gap) / Math.max(width, 1)))
  const named = new Set<number>()
  for (let i = count - 1; i >= 0; i -= every) named.add(i)
  return named
}
