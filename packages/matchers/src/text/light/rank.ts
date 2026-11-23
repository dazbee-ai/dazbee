// How well a placed draw of a candidate meets the piece's level ink, and the order candidates are
// tried in: the letters' shape, each tile free to move a little, plus half the fingerprint's vote.
// The plain overlap decides whether a correction is kept.

import { type Ink, inkBox } from '../ink.ts'
import type { Fitted } from './fit.ts'

/** A tile of drawn ink: its first column and row, and the column and row past its last. */
interface Span {
  x: number
  y: number
  xEnd: number
  yEnd: number
}

/** A tile's drawn pixels that hold ink, column and row in turn, their ink, how many, and all the tile's ink summed. */
interface TileInk {
  at: Int32Array
  values: Float64Array
  count: number
  mass: number
}

/** The piece's ink under a moved tile: summed, and summed taking the smaller of it and the drawn ink at each pixel. */
interface Under {
  piece: number
  inter: number
}

/** How much the fingerprint's similarity adds to a candidate's rank. */
export const FINGERPRINT_VOTE = 0.5

/** Letter-shape tiles are this share of the font size wide, and at least `MIN_TILE` pixels. */
const TILE_SHARE = 0.5
const MIN_TILE = 6
/** A tile may move this share of the font size each way, and at least `MIN_REACH` pixels. */
const REACH_SHARE = 0.08
const MIN_REACH = 2
/** Ink over this counts in a drawing's ink box for its tiles. */
const TILE_INK = 0.05

/** Each ink blurred once: the piece's level ink for every candidate compared with it, a drawing's wherever it is moved. */
const blurred = new WeakMap<Ink, Float32Array>()
/** The piece's level ink summed along each row once, for every tile compared with it (`rowSumsOf`). */
const rowSums = new WeakMap<Ink, Float64Array>()

/**
 * Orders fits best first, stably: each ranked by its letters' shape plus `FINGERPRINT_VOTE` times
 * its face's similarity to the piece's fingerprint, where the face has one.
 */
export function rankFits(fits: Fitted[], similarities: ReadonlyMap<string, number>): void {
  for (const fit of fits) {
    const similarity = similarities.get(fit.face.key)
    if (similarity !== undefined) fit.rank = fit.shape + FINGERPRINT_VOTE * similarity
  }
  fits.sort((a, b) => b.rank - a.rank)
}

/**
 * How well the letters' shapes match when each piece of the drawn ink `drawn`, moved by (dx, dy),
 * may move a little more: the drawn ink is cut into tiles half the font size wide, each moved up to
 * 8% of the size each way to where it overlaps the piece's ink `piece` best, and the overlaps summed
 * as an intersection over a union. Spacing that drifts along a line costs little; a wrong letter
 * shape costs a lot.
 */
export function letterShape(piece: Ink, drawn: Ink, dx: number, dy: number, size: number): number {
  const box = inkBox(drawn, TILE_INK)
  if (!box) return 0
  const tile = Math.max(MIN_TILE, Math.round(size * TILE_SHARE))
  const reach = Math.max(MIN_REACH, Math.round(size * REACH_SHARE))
  const shiftX = Math.round(dx)
  const shiftY = Math.round(dy)
  const sums = rowSumsOf(piece)
  const inked: TileInk = {
    at: new Int32Array(2 * tile * tile),
    values: new Float64Array(tile * tile),
    count: 0,
    mass: 0,
  }
  const under: Under = { piece: 0, inter: 0 }
  let inter = 0
  let union = 0
  let pieceCovered = 0
  for (let ty = box.y; ty < box.y + box.h; ty += tile)
    for (let tx = box.x; tx < box.x + box.w; tx += tile) {
      const span = { x: tx, y: ty, xEnd: Math.min(tx + tile, box.x + box.w), yEnd: Math.min(ty + tile, box.y + box.h) }
      tileInk(drawn, span, inked)
      let best = -1
      let bestInter = 0
      let bestUnion = 0
      let bestPiece = 0
      let bestX = 0
      let bestY = 0
      const tryShift = (sx: number, sy: number) => {
        inkUnder(piece, sums, span, inked, shiftX + sx, shiftY + sy, under)
        // The larger and the smaller ink of a pixel add up to both, so the union is both less the intersection.
        const tileUnion = under.piece + inked.mass - under.inter
        const score = tileUnion > 0 ? under.inter / tileUnion : 0
        if (score > best) {
          best = score
          bestInter = under.inter
          bestUnion = tileUnion
          bestPiece = under.piece
          bestX = sx
          bestY = sy
        }
      }
      // Every other pixel first, then the pixels round the best.
      for (let sy = -reach; sy <= reach; sy += 2) for (let sx = -reach; sx <= reach; sx += 2) tryShift(sx, sy)
      const cx = bestX
      const cy = bestY
      for (let sy = cy - 1; sy <= cy + 1; sy++)
        for (let sx = cx - 1; sx <= cx + 1; sx++) if (sx !== cx || sy !== cy) tryShift(sx, sy)
      inter += bestInter
      union += bestUnion
      pieceCovered += bestPiece
    }
  // Piece ink no tile reached is all missed.
  union += Math.max(0, (sums[sums.length - 1] as number) - pieceCovered)
  return union > 0 ? inter / union : 0
}

/**
 * How well the drawn ink `drawn`, moved by (dx, dy), overlaps the piece's ink `piece`: the soft
 * intersection over the soft union after a slight blur, so a part-pixel difference costs little.
 * Ink drawn past the piece's edges is all extra.
 */
export function overlap(piece: Ink, drawn: Ink, dx: number, dy: number): number {
  const drawnBlurred = blurredOf(drawn)
  const pieceBlurred = blurredOf(piece)
  const { width, height } = drawn
  // The drawn ink between pixels comes from its four nearest, 0 past its edges: each column's
  // nearest to the left, how far past it the column falls, and whether each of the two is drawn.
  const columns = new Int32Array(piece.width)
  const across = new Float64Array(piece.width)
  const drawnLeft = new Uint8Array(piece.width)
  const drawnRight = new Uint8Array(piece.width)
  for (let x = 0; x < piece.width; x++) {
    const fx = x - dx
    const x0 = Math.floor(fx)
    columns[x] = x0
    across[x] = fx - x0
    drawnLeft[x] = x0 >= 0 && x0 < width ? 1 : 0
    drawnRight[x] = x0 + 1 >= 0 && x0 + 1 < width ? 1 : 0
  }
  let inter = 0
  let union = 0
  let inside = 0
  for (let y = 0; y < piece.height; y++) {
    const fy = y - dy
    const y0 = Math.floor(fy)
    const ay = fy - y0
    const row0 = y0 >= 0 && y0 < height ? y0 * width : -1
    const row1 = y0 + 1 >= 0 && y0 + 1 < height ? (y0 + 1) * width : -1
    if (row0 < 0 && row1 < 0) {
      // Nothing is drawn on this row: every pixel's union is the piece's ink.
      for (let x = 0; x < piece.width; x++) union += pieceBlurred[y * piece.width + x] as number
      continue
    }
    for (let x = 0; x < piece.width; x++) {
      const p = pieceBlurred[y * piece.width + x] as number
      const x0 = columns[x] as number
      const ax = across[x] as number
      const left = drawnLeft[x] === 1
      const right = drawnRight[x] === 1
      const topLeft = row0 >= 0 && left ? (drawnBlurred[row0 + x0] as number) : 0
      const topRight = row0 >= 0 && right ? (drawnBlurred[row0 + x0 + 1] as number) : 0
      const bottomLeft = row1 >= 0 && left ? (drawnBlurred[row1 + x0] as number) : 0
      const bottomRight = row1 >= 0 && right ? (drawnBlurred[row1 + x0 + 1] as number) : 0
      if (topLeft === 0 && topRight === 0 && bottomLeft === 0 && bottomRight === 0) {
        // Nothing is drawn here: the union is the piece's ink.
        union += p
        continue
      }
      const d =
        topLeft * (1 - ax) * (1 - ay) + topRight * ax * (1 - ay) + bottomLeft * (1 - ax) * ay + bottomRight * ax * ay
      inside += d
      inter += Math.min(p, d)
      union += Math.max(p, d)
    }
  }
  let total = 0
  for (const d of drawnBlurred) total += d
  union += Math.max(0, total - inside)
  return union > 0 ? inter / union : 0
}

/** The ink's rows each summed from the left, `width + 1` sums a row, then all its ink summed; worked out once an ink. */
function rowSumsOf(ink: Ink): Float64Array {
  const kept = rowSums.get(ink)
  if (kept) return kept
  const { width, height, data } = ink
  const sums = new Float64Array((width + 1) * height + 1)
  let all = 0
  for (let y = 0; y < height; y++) {
    let run = 0
    for (let x = 0; x < width; x++) {
      const value = data[y * width + x] as number
      run += value
      all += value
      sums[y * (width + 1) + x + 1] = run
    }
  }
  sums[sums.length - 1] = all
  rowSums.set(ink, sums)
  return sums
}

/** Fills `into` with the drawn pixels of the tile that hold ink, and the tile's ink summed. */
function tileInk(drawn: Ink, span: Span, into: TileInk): void {
  let count = 0
  let mass = 0
  for (let y = span.y; y < span.yEnd; y++)
    for (let x = span.x; x < span.xEnd; x++) {
      const d = drawn.data[y * drawn.width + x] as number
      mass += d
      if (d > 0) {
        into.at[2 * count] = x
        into.at[2 * count + 1] = y
        into.values[count] = d
        count++
      }
    }
  into.count = count
  into.mass = mass
}

/** Fills `into` with the piece's ink under the tile moved by (ox, oy), 0 past the piece's edges. */
function inkUnder(piece: Ink, sums: Float64Array, span: Span, inked: TileInk, ox: number, oy: number, into: Under) {
  const { width, height, data } = piece
  const x0 = Math.min(width, Math.max(0, span.x + ox))
  const x1 = Math.min(width, Math.max(0, span.xEnd + ox))
  let under = 0
  for (let y = Math.max(0, span.y + oy); y < Math.min(height, span.yEnd + oy); y++)
    under += (sums[y * (width + 1) + x1] as number) - (sums[y * (width + 1) + x0] as number)
  const within = span.x + ox >= 0 && span.y + oy >= 0 && span.xEnd + ox <= width && span.yEnd + oy <= height
  const { at, values, count } = inked
  let inter = 0
  for (let i = 0; i < count; i++) {
    const px = (at[2 * i] as number) + ox
    const py = (at[2 * i + 1] as number) + oy
    if (within || (px >= 0 && py >= 0 && px < width && py < height)) {
      const p = data[py * width + px] as number
      const d = values[i] as number
      inter += p < d ? p : d
    }
  }
  into.piece = under
  into.inter = inter
}

/** The ink blurred, worked out once an ink. */
function blurredOf(ink: Ink): Float32Array {
  const kept = blurred.get(ink)
  if (kept) return kept
  const made = blur(ink)
  blurred.set(ink, made)
  return made
}

/** Ink blurred by a 1-2-1 kernel across, then down; only round the inked pixels, the rest staying 0. */
function blur(ink: Ink): Float32Array {
  const { width, height, data } = ink
  const across = new Float32Array(width * height)
  const out = new Float32Array(width * height)
  const box = inkBox(ink, 0)
  if (!box) return out
  const left = Math.max(0, box.x - 1)
  const right = Math.min(width, box.x + box.w + 1)
  for (let y = box.y; y < box.y + box.h; y++)
    for (let x = left; x < right; x++) {
      const i = y * width + x
      across[i] =
        ((data[i] as number) * 2 +
          (x > 0 ? (data[i - 1] as number) : 0) +
          (x < width - 1 ? (data[i + 1] as number) : 0)) /
        4
    }
  for (let y = Math.max(0, box.y - 1); y < Math.min(height, box.y + box.h + 1); y++)
    for (let x = left; x < right; x++) {
      const i = y * width + x
      out[i] =
        ((across[i] as number) * 2 +
          (y > 0 ? (across[i - width] as number) : 0) +
          (y < height - 1 ? (across[i + width] as number) : 0)) /
        4
    }
  return out
}
