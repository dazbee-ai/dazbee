// PROTOTYPE. Hand-written measurements of a text block: its ink, tilt, lines, fill colour, outline
// and background. The matcher starts every candidate from these and the fingerprint reads its lines.
import { ciede2000, lab } from './score.ts'
import { type Box, borderColor, type Ink, inkBox, inkOf, median, rotateInk } from './ink.ts'
import type { Rgba } from './png.ts'

/** A text block as the matcher gets it. */
export interface Block {
  /** The block's picture: a cut-out with transparency, or a flat crop. */
  rgba: Rgba
  /** What the text says; line breaks as the reading gives them. */
  text: string
  /** The tilt the cutting step found, degrees clockwise; undefined when it gave none. */
  angle?: number
  /** The pixels behind the block (the ad there), to estimate its background; same size as rgba. */
  behind?: Rgba
}

export interface Line {
  box: Box
}

export interface Measured {
  ink: Ink
  /** The ink turned level: the block's tilt undone. */
  level: Ink
  angle: number
  box: Box
  lines: Line[]
  fill: number[]
  outline: { width: number; color: number[] } | null
  background: number[]
  align: 'start' | 'center' | 'end'
}

export function measure(block: Block): Measured {
  const background = estimateBackground(block)
  const ink = inkOf(block.rgba, block.behind ? undefined : background)
  const angle = block.angle ?? estimateAngle(ink)
  const level = rotateInk(ink, -angle)
  const box = inkBox(level) ?? { x: 0, y: 0, w: level.width, h: level.height }
  const lines = findLines(level, box, block.text.split('\n').length)
  const { fill, outline } = colours(block.rgba, ink)
  return { ink, level, angle, box, lines, fill, outline, background, align: alignOf(lines) }
}

/** The median colour behind the block where the block has no ink; its border's when no picture behind is given. */
function estimateBackground(block: Block): number[] {
  if (!block.behind) return borderColor(block.rgba)
  const r: number[] = []
  const g: number[] = []
  const b: number[] = []
  const n = block.rgba.width * block.rgba.height
  for (let i = 0; i < n; i++)
    if (block.rgba.data[i * 4 + 3]! < 13) {
      r.push(block.behind.data[i * 4]!)
      g.push(block.behind.data[i * 4 + 1]!)
      b.push(block.behind.data[i * 4 + 2]!)
    }
  if (r.length < n * 0.05) return borderColor(block.behind)
  return [median(r), median(g), median(b)]
}

/**
 * The tilt that makes the lines sharpest: the angle whose row sums differ most from row to row
 * (Postl's method, as Leptonica measures skew), searched coarse then fine within ±15°.
 */
export function estimateAngle(ink: Ink): number {
  const sharpness = (deg: number) => {
    const a = (deg * Math.PI) / 180
    const rows = new Float64Array(ink.height * 2)
    const cy = ink.height / 2
    const cx = ink.width / 2
    for (let y = 0; y < ink.height; y += 1)
      for (let x = 0; x < ink.width; x += 2) {
        const v = ink.data[y * ink.width + x]!
        if (v < 0.2) continue
        const r = Math.round(-Math.sin(a) * (x - cx) + Math.cos(a) * (y - cy) + ink.height)
        if (r >= 0 && r < rows.length) rows[r]! += v
      }
    let s = 0
    for (let i = 1; i < rows.length; i++) s += (rows[i]! - rows[i - 1]!) ** 2
    return s
  }
  let best = 0
  let bestS = sharpness(0)
  for (let d = -15; d <= 15; d += 1) {
    const s = sharpness(d)
    if (s > bestS * 1.02) {
      bestS = s
      best = d
    }
  }
  for (let d = best - 1; d <= best + 1; d += 0.25) {
    const s = sharpness(d)
    if (s > bestS) {
      bestS = s
      best = d
    }
  }
  return best
}

/**
 * The block's `n` lines: bands of rows with ink, split at the emptiest rows. Bands too small to be a
 * line (dots, accents) join their nearest neighbour; with too few bands the tallest is split at its
 * thinnest row.
 */
export function findLines(level: Ink, box: Box, n: number): Line[] {
  const rows = new Float64Array(box.h)
  for (let y = 0; y < box.h; y++)
    for (let x = box.x; x < box.x + box.w; x++) rows[y]! += level.data[(box.y + y) * level.width + x]!
  const peak = Math.max(...rows)
  let bands: [number, number][] = []
  let start = -1
  for (let y = 0; y <= box.h; y++) {
    const on = y < box.h && rows[y]! > peak * 0.02
    if (on && start < 0) start = y
    if (!on && start >= 0) {
      bands.push([start, y])
      start = -1
    }
  }
  while (bands.length > n) {
    // Joins the smallest band to the neighbour it is closest to.
    let k = 0
    for (let i = 1; i < bands.length; i++) if (bands[i]![1] - bands[i]![0] < bands[k]![1] - bands[k]![0]) k = i
    const prevGap = k > 0 ? bands[k]![0] - bands[k - 1]![1] : Infinity
    const nextGap = k < bands.length - 1 ? bands[k + 1]![0] - bands[k]![1] : Infinity
    const j = prevGap <= nextGap ? k - 1 : k + 1
    const merged: [number, number] = [Math.min(bands[j]![0], bands[k]![0]), Math.max(bands[j]![1], bands[k]![1])]
    bands = bands.filter((_, i) => i !== j && i !== k)
    bands.push(merged)
    bands.sort((a, b) => a[0] - b[0])
  }
  while (bands.length < n) {
    let k = 0
    for (let i = 1; i < bands.length; i++) if (bands[i]![1] - bands[i]![0] > bands[k]![1] - bands[k]![0]) k = i
    const [a, b] = bands[k]!
    const remaining = n - bands.length + 1
    // Cut near where an even split would put it, at the thinnest row.
    const target = a + (b - a) / remaining
    let cut = Math.round(target)
    let low = Infinity
    for (let y = Math.round(a + (b - a) * 0.15); y < b - (b - a) * 0.15; y++) {
      const cost = rows[y]! * (1 + Math.abs(y - target) / (b - a))
      if (cost < low) {
        low = cost
        cut = y
      }
    }
    bands.splice(k, 1, [a, cut], [cut, b])
  }
  return bands.map(([a, b]) => {
    const inBand = inkBox(level, 0.5, { x: box.x, y: box.y + a, w: box.w, h: b - a })
    return { box: inBand ?? { x: box.x, y: box.y + a, w: box.w, h: b - a } }
  })
}

/** How the lines sit: their left edges, centres or right edges lined up. One line: start. */
function alignOf(lines: Line[]): 'start' | 'center' | 'end' {
  if (lines.length < 2) return 'start'
  const spread = (f: (b: Box) => number) => {
    const v = lines.map((l) => f(l.box))
    return Math.max(...v) - Math.min(...v)
  }
  const left = spread((b) => b.x)
  const centre = spread((b) => b.x + b.w / 2)
  const right = spread((b) => b.x + b.w)
  if (centre <= left && centre <= right) return 'center'
  return left <= right ? 'start' : 'end'
}

/**
 * The fill colour and any outline. The fill is the median of the inner ink, two pixels or more from
 * any edge; an outline is a ring at the edge whose colour differs from it (ΔE over 12), as wide as
 * the ring's area over the edge's length.
 */
function colours(rgba: Rgba, ink: Ink): { fill: number[]; outline: { width: number; color: number[] } | null } {
  const { width, height } = ink
  const solid = new Uint8Array(width * height)
  for (let i = 0; i < solid.length; i++) solid[i] = ink.data[i]! > 0.6 ? 1 : 0
  // Depth: how many steps each solid pixel is from the nearest non-solid one (city block, two passes).
  const depth = new Float32Array(width * height)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      if (!solid[i]) continue
      const up = y > 0 ? depth[i - width]! : 0
      const left = x > 0 ? depth[i - 1]! : 0
      depth[i] = Math.min(up, left) + 1
    }
  for (let y = height - 1; y >= 0; y--)
    for (let x = width - 1; x >= 0; x--) {
      const i = y * width + x
      if (!solid[i]) continue
      const down = y < height - 1 ? depth[i + width]! : 0
      const right = x < width - 1 ? depth[i + 1]! : 0
      depth[i] = Math.min(depth[i]!, Math.min(down, right) + 1)
    }
  const maxDepth = Math.max(...depth)
  const pick = (test: (d: number) => boolean) => {
    const r: number[] = []
    const g: number[] = []
    const b: number[] = []
    for (let i = 0; i < depth.length; i++)
      if (solid[i] && test(depth[i]!)) {
        r.push(rgba.data[i * 4]!)
        g.push(rgba.data[i * 4 + 1]!)
        b.push(rgba.data[i * 4 + 2]!)
      }
    return r.length > 0 ? { color: [median(r), median(g), median(b)], count: r.length } : null
  }
  const coreFrom = Math.max(2, Math.min(4, Math.floor(maxDepth / 2)))
  const core = pick((d) => d >= coreFrom) ?? pick(() => true)!
  const edge = pick((d) => d <= 1.5)
  if (!edge || maxDepth < 4 || core.count < 30) return { fill: core.color, outline: null }
  const coreLab = lab(core.color[0]!, core.color[1]!, core.color[2]!)
  const edgeLab = lab(edge.color[0]!, edge.color[1]!, edge.color[2]!)
  if (ciede2000(coreLab, edgeLab) < 12) return { fill: core.color, outline: null }
  // The ring: solid pixels nearer the outline's colour than the fill's.
  let ring = 0
  let perimeter = 0
  for (let i = 0; i < depth.length; i++) {
    if (!solid[i]) continue
    if (depth[i] === 1) perimeter++
    const c = lab(rgba.data[i * 4]!, rgba.data[i * 4 + 1]!, rgba.data[i * 4 + 2]!)
    if (ciede2000(c, edgeLab) < ciede2000(c, coreLab)) ring++
  }
  const thickness = perimeter > 0 ? ring / perimeter : 0
  if (thickness < 0.8) return { fill: core.color, outline: null }
  return { fill: core.color, outline: { width: Math.round(thickness * 2) / 2, color: edge.color } }
}

export const hex = (c: readonly number[], alpha = 255) =>
  `#${[...c.slice(0, 3), alpha].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('').toUpperCase()}`
