// Colour runs: each pixel's colour cluster cleaned and cut into connected runs. One 3×3 majority
// vote joins noise and edge blends to their neighbours, and specks are folded into the colour they
// share the most border with.

/** The connected runs of a labelling: each pixel's run (-1 where uncovered), and each run's label and size. */
export interface Runs {
  of: Int32Array
  list: { label: number; area: number }[]
}

/** Cleans a labelling in place and cuts it into 4-connected runs; runs under `minArea` pixels are folded first. */
export function colourRuns(labels: Int32Array, width: number, height: number, minArea: number): Runs {
  majority(labels, width, height)
  absorbSpecks(labels, components(labels, width, height), width, height, minArea)
  return components(labels, width, height)
}

/** One 3×3 majority vote over the covered pixels: noise and edge blends join their neighbours. */
function majority(labels: Int32Array, width: number, height: number) {
  const src = labels.slice()
  const count = new Map<number, number>()
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      const own = src[i] ?? -1
      if (own < 0) continue
      count.clear()
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx
          const yy = y + dy
          if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue
          const label = src[yy * width + xx] ?? -1
          if (label >= 0) count.set(label, (count.get(label) ?? 0) + 1)
        }
      let best = own
      let bestCount = count.get(best) ?? 0
      // Another label wins only by two votes or more.
      for (const [label, c] of count)
        if (c > bestCount + 1) {
          best = label
          bestCount = c
        }
      labels[i] = best
    }
}

/** The 4-connected runs of equal labels: each pixel's run (-1 where uncovered), and each run's label and size. */
function components(labels: Int32Array, width: number, height: number): Runs {
  const of = new Int32Array(width * height).fill(-1)
  const list: { label: number; area: number }[] = []
  const stack: number[] = []
  for (let s = 0; s < width * height; s++) {
    if ((labels[s] ?? -1) < 0 || (of[s] ?? 0) >= 0) continue
    const id = list.length
    const label = labels[s] ?? -1
    let area = 0
    of[s] = id
    stack.push(s)
    while (stack.length) {
      const i = stack.pop() ?? 0
      area++
      const x = i % width
      const y = (i - x) / width
      for (const j of [
        x > 0 ? i - 1 : -1,
        x < width - 1 ? i + 1 : -1,
        y > 0 ? i - width : -1,
        y < height - 1 ? i + width : -1,
      ])
        if (j >= 0 && (of[j] ?? 0) < 0 && labels[j] === label) {
          of[j] = id
          stack.push(j)
        }
    }
    list.push({ label, area })
  }
  return { of, list }
}

/** Runs smaller than minArea take the label they share the most border with. */
function absorbSpecks(labels: Int32Array, runs: Runs, width: number, height: number, minArea: number) {
  const small = new Set(runs.list.flatMap((run, id) => (run.area < minArea ? [id] : [])))
  if (small.size === 0) return
  const n = width * height
  const border = new Map<number, Map<number, number>>()
  for (let i = 0; i < n; i++) {
    const run = runs.of[i] ?? -1
    if (run < 0 || !small.has(run)) continue
    const x = i % width
    for (const j of [x > 0 ? i - 1 : -1, x < width - 1 ? i + 1 : -1, i - width, i + width]) {
      if (j < 0 || j >= n) continue
      const other = runs.of[j] ?? -1
      if (other < 0 || other === run || small.has(other)) continue
      const label = runs.list[other]?.label ?? -1
      const counts = border.get(run) ?? new Map<number, number>()
      counts.set(label, (counts.get(label) ?? 0) + 1)
      border.set(run, counts)
    }
  }
  for (let i = 0; i < n; i++) {
    const run = runs.of[i] ?? -1
    if (run < 0 || !small.has(run)) continue
    const counts = border.get(run)
    if (!counts) continue
    let best = -1
    let bestCount = -1
    for (const [label, c] of counts)
      if (c > bestCount) {
        bestCount = c
        best = label
      }
    labels[i] = best
  }
}
