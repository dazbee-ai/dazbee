// How well a placed draw of a candidate meets the piece's level ink, and the order candidates are
// tried in: the letters' shape, each tile free to move a little, plus half the fingerprint's vote.
// The plain overlap decides whether a correction is kept.

import { type Ink, inkBox } from '../ink.ts'
import type { Fitted } from './fit.ts'

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

/** The piece's level ink blurred once, for every candidate compared with it. */
const blurred = new WeakMap<Ink, Float32Array>()

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
  let inter = 0
  let union = 0
  let pieceMass = 0
  for (let i = 0; i < piece.data.length; i++) pieceMass += piece.data[i] ?? 0
  let pieceCovered = 0
  for (let ty = box.y; ty < box.y + box.h; ty += tile)
    for (let tx = box.x; tx < box.x + box.w; tx += tile) {
      let best = -1
      let bestInter = 0
      let bestUnion = 0
      let bestPiece = 0
      let bestX = 0
      let bestY = 0
      const tryShift = (sx: number, sy: number) => {
        let tileInter = 0
        let tileUnion = 0
        let tilePiece = 0
        for (let y = ty; y < Math.min(ty + tile, box.y + box.h); y++)
          for (let x = tx; x < Math.min(tx + tile, box.x + box.w); x++) {
            const d = drawn.data[y * drawn.width + x] ?? 0
            const px = x + shiftX + sx
            const py = y + shiftY + sy
            const p =
              px < 0 || py < 0 || px >= piece.width || py >= piece.height ? 0 : (piece.data[py * piece.width + px] ?? 0)
            tileInter += Math.min(p, d)
            tileUnion += Math.max(p, d)
            tilePiece += p
          }
        const score = tileUnion > 0 ? tileInter / tileUnion : 0
        if (score > best) {
          best = score
          bestInter = tileInter
          bestUnion = tileUnion
          bestPiece = tilePiece
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
  union += Math.max(0, pieceMass - pieceCovered)
  return union > 0 ? inter / union : 0
}

/**
 * How well the drawn ink `drawn`, moved by (dx, dy), overlaps the piece's ink `piece`: the soft
 * intersection over the soft union after a slight blur, so a part-pixel difference costs little.
 * Ink drawn past the piece's edges is all extra.
 */
export function overlap(piece: Ink, drawn: Ink, dx: number, dy: number): number {
  const drawnBlurred = blur(drawn)
  let pieceBlurred = blurred.get(piece)
  if (!pieceBlurred) {
    pieceBlurred = blur(piece)
    blurred.set(piece, pieceBlurred)
  }
  let inter = 0
  let union = 0
  let inside = 0
  for (let y = 0; y < piece.height; y++)
    for (let x = 0; x < piece.width; x++) {
      const p = pieceBlurred[y * piece.width + x] ?? 0
      const d = sampleAt(drawnBlurred, drawn.width, drawn.height, x - dx, y - dy)
      inside += d
      inter += Math.min(p, d)
      union += Math.max(p, d)
    }
  let total = 0
  for (const d of drawnBlurred) total += d
  union += Math.max(0, total - inside)
  return union > 0 ? inter / union : 0
}

/** Ink blurred by a 1-2-1 kernel across, then down. */
function blur({ width, height, data }: Ink): Float32Array {
  const across = new Float32Array(width * height)
  const out = new Float32Array(width * height)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      across[i] = ((data[i] ?? 0) * 2 + (x > 0 ? (data[i - 1] ?? 0) : 0) + (x < width - 1 ? (data[i + 1] ?? 0) : 0)) / 4
    }
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      out[i] =
        ((across[i] ?? 0) * 2 +
          (y > 0 ? (across[i - width] ?? 0) : 0) +
          (y < height - 1 ? (across[i + width] ?? 0) : 0)) /
        4
    }
  return out
}

/** Values at a point between pixels, from their four nearest; 0 past the edges. */
function sampleAt(values: Float32Array, width: number, height: number, fx: number, fy: number): number {
  const x0 = Math.floor(fx)
  const y0 = Math.floor(fy)
  const ax = fx - x0
  const ay = fy - y0
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= width || y >= height ? 0 : (values[y * width + x] ?? 0))
  return (
    at(x0, y0) * (1 - ax) * (1 - ay) +
    at(x0 + 1, y0) * ax * (1 - ay) +
    at(x0, y0 + 1) * (1 - ax) * ay +
    at(x0 + 1, y0 + 1) * ax * ay
  )
}
