// A mask's outlines by marching squares: closed loops where its coverage crosses a level, through
// sub-pixel points on the edges between pixel centres.

/** A point in a mask's pixels: x, y. */
export type Point = [number, number]

/** The closed outlines where the mask crosses `level`, through pixel centres; the mask is padded with zero. */
export function contours(mask: Float32Array, width: number, height: number, level: number): Point[][] {
  const paddedWidth = width + 2
  const paddedHeight = height + 2
  const value = (x: number, y: number) =>
    x <= 0 || y <= 0 || x > width || y > height ? 0 : (mask[(y - 1) * width + (x - 1)] ?? 0)
  // Edge ids: the across edge from (x, y) to (x + 1, y) is 2 (y W + x); the down one to (x, y + 1) is that plus 1.
  const points = new Map<number, Point>()
  const links = new Map<number, number[]>()
  const edgePoint = (id: number): Point => {
    const known = points.get(id)
    if (known) return known
    const cell = id >> 1
    const x = cell % paddedWidth
    const y = (cell - x) / paddedWidth
    const a = value(x, y)
    const b = id & 1 ? value(x, y + 1) : value(x + 1, y)
    const t = Math.abs(b - a) < 1e-9 ? 0.5 : (level - a) / (b - a)
    // Padded pixel x's centre is at x - 0.5 in the mask.
    const point: Point = id & 1 ? [x - 0.5, y - 0.5 + t] : [x - 0.5 + t, y - 0.5]
    points.set(id, point)
    return point
  }
  const link = (a: number, b: number) => {
    edgePoint(a)
    edgePoint(b)
    linksOf(links, a).push(b)
    linksOf(links, b).push(a)
  }
  for (let y = 0; y < paddedHeight - 1; y++)
    for (let x = 0; x < paddedWidth - 1; x++) {
      const corners =
        (value(x, y) >= level ? 1 : 0) |
        (value(x + 1, y) >= level ? 2 : 0) |
        (value(x + 1, y + 1) >= level ? 4 : 0) |
        (value(x, y + 1) >= level ? 8 : 0)
      if (corners === 0 || corners === 15) continue
      const top = 2 * (y * paddedWidth + x)
      const bottom = 2 * ((y + 1) * paddedWidth + x)
      const left = 2 * (y * paddedWidth + x) + 1
      const right = 2 * (y * paddedWidth + x + 1) + 1
      const centreIn = (value(x, y) + value(x + 1, y) + value(x + 1, y + 1) + value(x, y + 1)) / 4 >= level
      switch (corners) {
        case 1:
        case 14:
          link(left, top)
          break
        case 2:
        case 13:
          link(top, right)
          break
        case 3:
        case 12:
          link(left, right)
          break
        case 4:
        case 11:
          link(right, bottom)
          break
        case 6:
        case 9:
          link(top, bottom)
          break
        case 7:
        case 8:
          link(left, bottom)
          break
        // The two saddles join as the cell's centre says.
        case 5:
          if (centreIn) {
            link(top, right)
            link(left, bottom)
          } else {
            link(left, top)
            link(right, bottom)
          }
          break
        case 10:
          if (centreIn) {
            link(left, top)
            link(right, bottom)
          } else {
            link(top, right)
            link(left, bottom)
          }
          break
      }
    }
  const used = new Set<string>()
  const key = (a: number, b: number) => (a < b ? `${a},${b}` : `${b},${a}`)
  const loops: Point[][] = []
  for (const [start, nexts] of links) {
    for (const first of nexts) {
      if (used.has(key(start, first))) continue
      const loop: Point[] = [edgePoint(start)]
      let previous = start
      let current = first
      used.add(key(start, first))
      while (current !== start) {
        loop.push(edgePoint(current))
        const from = current
        const options = links.get(from) ?? []
        const next =
          options.find((n) => n !== previous && !used.has(key(from, n))) ?? options.find((n) => !used.has(key(from, n)))
        if (next === undefined) break
        used.add(key(from, next))
        previous = from
        current = next
      }
      loops.push(loop)
    }
  }
  return loops
}

/** An edge's list of linked edges, made empty when it has none yet. */
function linksOf(links: Map<number, number[]>, id: number): number[] {
  let list = links.get(id)
  if (!list) {
    list = []
    links.set(id, list)
  }
  return list
}
