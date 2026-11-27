// The matchers asked of a frame's split pieces, for Make editable's finish: each piece that is matched, read from
// the bytes the editor holds of its picture, is a match job of its own, a text's with the colour the frame's picture
// shows behind it, and every job is handed to the match client at once. The answers come back by the piece's number
// among the frame's pieces. A piece whose picture isn't here, or is too big for a match job, is asked of no matcher
// and stays a picture.
import type { CanvasKit, Image } from '@dazbee/canvaskit'
import type { Pixels } from '@dazbee/renderer'
import {
  type LayerPlanAnswer,
  type MadePiece,
  type MadePieces,
  type MatchAnswer,
  type MatchKit,
  MAX_MATCH_PICTURE_BYTES,
  type ReadingAnswer,
  type Rgb,
} from '@dazbee/schema'

import type { MatchClient } from '../matching/match-client.ts'
import type { MatchFonts } from '../matching/match-pool.ts'
import { type MatchedAs, matchedAs, pieceMatchJob, seenBehind } from './piece-matching.ts'

/** What the matchers work with: the brand kit a rebuilt layer may bind to, and the fonts a text is matched in. */
export interface MatchSources {
  kit: MatchKit
  fonts: MatchFonts
}

/** A frame's split pieces as the matchers are asked of them: with the frame's plan, its reading and its picture. */
export interface FramePieces {
  cut: MadePieces
  plan: LayerPlanAnswer | null
  reading: ReadingAnswer | null
  /** The asset of the picture the pieces were cut from; null when it isn't known. */
  pictureAssetId: string | null
}

export interface PieceMatcherDeps {
  ck: CanvasKit
  /** The encoded bytes the editor holds of an image, by its asset; none for one not loaded. */
  imageBytes: (assetId: string) => Uint8Array | undefined
  /** The brand kit and the font catalog, asked for with each frame that has pieces to match. */
  sources: () => Promise<MatchSources>
  match: MatchClient['match']
  /** Aborted when the editor ends: the jobs still matching are cancelled. */
  signal: AbortSignal
}

/** The matchers' answers for a frame's split pieces, by the piece's number among them; none for a piece not asked. */
export type PieceMatcher = (frame: FramePieces) => Promise<Map<number, MatchAnswer>>

/** How many bytes are turned to base64 at once. */
const CHUNK = 0x8000

export function pieceMatcher({ ck, imageBytes, sources, match, signal }: PieceMatcherDeps): PieceMatcher {
  return async ({ cut, plan, reading, pictureAssetId }) => {
    const answers = new Map<number, MatchAnswer>()
    const asked = cut.items.flatMap((piece, n) => {
      const as = matchedAs(plan, reading, piece)
      const bytes = as && piece.picture.assetId !== undefined ? imageBytes(piece.picture.assetId) : undefined
      return as && bytes && bytes.byteLength <= MAX_MATCH_PICTURE_BYTES ? [{ n, piece, as, bytes }] : []
    })
    if (asked.length === 0) return answers
    const { kit, fonts } = await sources()
    const pictureBytes = pictureAssetId === null ? undefined : imageBytes(pictureAssetId)
    const picture = pictureBytes ? ck.MakeImageFromEncoded(pictureBytes) : null
    let jobs
    try {
      jobs = asked.map(({ n, piece, as, bytes }) => {
        const behind = picture && sameSize(picture, cut) ? behindPiece(picture, piece, as, bytes) : null
        return { n, job: pieceMatchJob(base64(bytes), piece.picture, as, kit, behind ? [behind] : undefined) }
      })
    } finally {
      picture?.delete()
    }
    await Promise.all(
      jobs.map(async ({ n, job }) => {
        const [answer] = await match(job, { fonts, signal })
        if (answer) answers.set(n, answer)
      }),
    )
    return answers
  }

  /** The colour `picture` shows behind text piece `piece`, whose own picture is `bytes`; null for shapes, or when it can't be read. */
  function behindPiece(picture: Image, piece: MadePiece, as: MatchedAs, bytes: Uint8Array): Rgb | null {
    if (as.kind !== 'text') return null
    const own = ck.MakeImageFromEncoded(bytes)
    if (!own) return null
    try {
      const { width, height } = piece.picture
      const under = pixels(picture, piece.x, piece.y, width, height)
      const drawn = pixels(own, 0, 0, width, height)
      return under && drawn ? seenBehind(under, drawn) : null
    } finally {
      own.delete()
    }
  }

  /** The pixels of `image` in the box at `x`, `y`, unpremultiplied; null when it lies past the image or can't be read. */
  function pixels(image: Image, x: number, y: number, width: number, height: number): Pixels | null {
    if (x + width > image.width() || y + height > image.height()) return null
    const read = image.readPixels(x, y, {
      width,
      height,
      colorType: ck.ColorType.RGBA_8888,
      alphaType: ck.AlphaType.Unpremul,
      colorSpace: ck.ColorSpace.SRGB,
    })
    return read instanceof Uint8Array ? { width, height, pixels: read } : null
  }
}

/** Whether `image` is the size the split pieces' places are in. */
function sameSize(image: Image, cut: Pick<MadePieces, 'width' | 'height'>): boolean {
  return image.width() === cut.width && image.height() === cut.height
}

/** Bytes as base64. */
function base64(bytes: Uint8Array): string {
  let binary = ''
  for (let at = 0; at < bytes.length; at += CHUNK) binary += String.fromCharCode(...bytes.subarray(at, at + CHUNK))
  return btoa(binary)
}
