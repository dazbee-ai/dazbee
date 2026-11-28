// Judging: whether graphics may take their piece's place. They are drawn at the size the looks-the-same rule reads
// (`looks-same/rule.ts`) and must keep under its share of far pixels; then the detail check (`detail-check.ts`) must
// see no blob of difference. What other layers of the frame hide of the piece is not judged.

import type { CanvasKit } from '@dazbee/canvaskit'
import type { Pixels } from '@dazbee/renderer'
import type { LooksSameScores, Rgb } from '@dazbee/schema'

import { farShare, LOOKS_SAME, shrunk } from '../looks-same/rule.ts'
import { type Detail, detailOf, judgedScale } from './detail-check.ts'
import { drawGraphics, type ShapeLayer } from './draw-layers.ts'

/** What a judged set of graphics scored. */
export interface Judged {
  same: boolean
  scores: LooksSameScores
  detail: Detail
}

/** A piece as its rebuilds are judged: at its own size and at the rule's, with what other layers hide of it at that size. */
export interface Seen {
  ck: CanvasKit
  piece: Pixels
  /** The piece at most 512 px on its long side; itself when it is no larger. */
  small: Pixels
  /** Per pixel of `small`, 1 where other layers cover the piece. */
  hidden: Uint8Array | undefined
  /** The colour the frame shows behind the piece, which a see-through piece is judged over. */
  behind: Rgb | undefined
}

/** The settings of the judging. */
export const JUDGING = {
  /** A graphic drawing under this share of the piece's pixels is small enough to go when nobody would miss it. */
  unseenShare: 0.005,
  /**
   * The rebuild may differ from the piece in a blob of at most this many pixels of the piece, and in a blob of
   * halo of at most `mostHalo`. In a piece judged enlarged the blob is counted in the enlarged pixels and may
   * hold this many times the enlargement to the power `enlargedBlob`: fewer of the piece's own pixels.
   */
  mostBlob: 12,
  mostHalo: 20,
  enlargedBlob: 1.5,
  /** A piece with a side under this many pixels at the rule's size is drawn at its own size and shrunk. */
  thinSide: 8,
} as const

/** The detail check of a rebuild that wasn't looked at closely. */
const NO_DETAIL: Detail = { seen: 0, blob: 0, blobs: 0, width: 1, height: 1, different: new Uint8Array(1), halo: 0 }

/**
 * Judges graphics against their piece: the looks-the-same rule's far share, then no blob of difference in the
 * detail check. The graphics are drawn at the size they are judged at, never larger.
 */
export function judge(
  seen: Seen,
  layers: readonly ShapeLayer[],
  variables?: Parameters<typeof drawGraphics>[5],
): Judged {
  const { ck, piece, small, hidden, behind } = seen
  const draw = (scale: number) => drawGraphics(ck, layers, piece.width, piece.height, scale, variables)
  // A side of a few pixels at the rule's size is rounded far from the piece's own scaled, so graphics drawn at the
  // width's scale come out too faint or too thin there: such a piece is drawn at its own size and shrunk, and so is
  // a drawing that comes out another size than the rule's.
  const thin = Math.min(small.width, small.height) < JUDGING.thinSide
  let drawn = thin ? null : draw(small.width / piece.width)
  if (!drawn || drawn.width !== small.width || drawn.height !== small.height) {
    drawn = shrunk(draw(1), small.width, small.height)
  }
  // What other layers hide is not seen: there the graphics are taken to draw what the piece shows.
  const asDrawn = drawn
  if (hidden) {
    const pixels = new Uint8Array(drawn.pixels)
    for (let i = 0; i < hidden.length; i++) if (hidden[i]) pixels.set(small.pixels.subarray(i * 4, i * 4 + 4), i * 4)
    drawn = { width: small.width, height: small.height, pixels }
  }
  const far = farShare(small, drawn)
  const scores = { far }
  // A rebuild the rule turns down needs no closer look.
  if (far > LOOKS_SAME.shape.far) return { same: false, scores, detail: NO_DETAIL }
  let detail: Detail
  if (judgedScale(piece) <= 1) detail = detailOf(small, drawn, behind)
  else {
    // A small piece is enlarged, and its graphics drawn again at that size, sharp; where it is hidden the piece
    // takes what they draw.
    let shown = piece
    if (hidden) {
      const pixels = new Uint8Array(piece.pixels)
      for (let i = 0; i < hidden.length; i++)
        if (hidden[i]) pixels.set(asDrawn.pixels.subarray(i * 4, i * 4 + 4), i * 4)
      shown = { width: piece.width, height: piece.height, pixels }
    }
    detail = detailOf(shown, draw, behind)
  }
  // An enlarged piece is allowed a smaller blob of its own pixels: enlarging shows what was too small to see.
  const size = detail.width / piece.width
  const blob = JUDGING.mostBlob * size ** (size > 1 ? JUDGING.enlargedBlob : 2)
  return { same: detail.blob <= blob && detail.halo <= JUDGING.mostHalo * size ** 2, scores, detail }
}

/**
 * The graphics without the small ones nobody would miss, judged again, or null when every small one is seen.
 * Graphics drawing under a share of the piece's pixels are small; they go all at once when the piece then still
 * looks the same, and else by halves, each half that can go.
 */
export function withoutUnseen(
  seen: Seen,
  layers: readonly ShapeLayer[],
  pixels: readonly number[],
  variables: Parameters<typeof drawGraphics>[5],
): { layers: ShapeLayer[]; judged: Judged } | null {
  const all = pixels.reduce((sum, count) => sum + count, 0)
  const small = layers.map((_, i) => i).filter((i) => (pixels[i] ?? 0) < JUDGING.unseenShare * all)
  if (small.length === 0 || small.length === layers.length) return null
  const without = (gone: readonly number[]) => {
    const kept = layers.filter((_, i) => !gone.includes(i))
    const judged = judge(seen, kept, variables)
    return judged.same ? { layers: kept, judged } : null
  }
  const whole = without(small)
  if (whole || small.length === 1) return whole
  const half = small.length >> 1
  const first = without(small.slice(0, half))
  const second = without(small.slice(half))
  return first && second ? (without(small) ?? first) : (first ?? second)
}
