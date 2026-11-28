// The matchers asked of a frame's split pieces, for Make editable's finish: each piece that is matched, read from
// the bytes the editor holds of its picture, is a match job of its own, with the colour the frame's picture shows
// behind it and, for shapes, what the pieces in front of it hide of it, and every job is handed to the match client
// at once. The pieces are read front to back, each one's picture decoded once. The answers come back by the piece's
// number among the frame's pieces. A piece whose picture isn't here, or is too big for a match job, is asked of no
// matcher and stays a picture. The match client is the matcher's own, ended with the editor.
import type { CanvasKit, Image } from '@dazbee/canvaskit'
import type { Pixels } from '@dazbee/renderer'
import {
  type LayerPlanAnswer,
  type MadePiece,
  type MadePieces,
  type MatchAnswer,
  type MatchJob,
  type MatchKit,
  MAX_MATCH_PICTURE_BYTES,
  type ReadingAnswer,
} from '@dazbee/schema'

import { type MatchClient, matchClient } from '../matching/match-client.ts'
import type { MatchFonts } from '../matching/match-pool.ts'
import {
  coverWith,
  hiddenUnder,
  type MatchedAs,
  matchedAs,
  noCover,
  pieceMatchJob,
  seenBehind,
} from './piece-matching.ts'

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
  /** Aborted when the editor ends: the match client's workers are ended. */
  signal: AbortSignal
  /** Makes the editor's way to the matchers; a stand-in in a test. */
  makeClient?: () => MatchClient
}

/**
 * The matchers' answers for a frame's split pieces, by the piece's number among them; none for a piece not asked.
 * Aborting `signal` cancels the jobs still matching, and it rejects.
 */
export type PieceMatcher = (frame: FramePieces, signal: AbortSignal) => Promise<Map<number, MatchAnswer>>

/** A split piece the matchers are asked of: its number among the frame's pieces, what it is matched as, and its picture's bytes. */
interface Asked {
  n: number
  piece: MadePiece
  as: MatchedAs
  bytes: Uint8Array
}

/** How many bytes are turned to base64 at once. */
const CHUNK = 0x8000

export function pieceMatcher({
  ck,
  imageBytes,
  sources,
  signal: ended,
  makeClient = matchClient,
}: PieceMatcherDeps): PieceMatcher {
  /** The match client, whose workers start with the first piece. */
  const client = makeClient()
  ended.addEventListener('abort', client.destroy)

  return async ({ cut, plan, reading, pictureAssetId }, signal) => {
    const answers = new Map<number, MatchAnswer>()
    const asked = cut.items.flatMap((piece, n): Asked[] => {
      const as = matchedAs(plan, reading, piece)
      const bytes = as ? bytesOf(piece) : undefined
      return as && bytes && bytes.byteLength <= MAX_MATCH_PICTURE_BYTES ? [{ n, piece, as, bytes }] : []
    })
    if (asked.length === 0) return answers
    const { kit, fonts } = await sources()
    signal.throwIfAborted()
    const pictureBytes = pictureAssetId === null ? undefined : imageBytes(pictureAssetId)
    const picture = pictureBytes ? ck.MakeImageFromEncoded(pictureBytes) : null
    let jobs
    try {
      jobs = jobsOf(cut, asked, picture && sameSize(picture, cut) ? picture : null, kit)
    } finally {
      picture?.delete()
    }
    await Promise.all(
      jobs.map(async ({ n, job }) => {
        const [answer] = await client.match(job, { fonts, signal })
        if (answer) answers.set(n, answer)
      }),
    )
    return answers
  }

  /**
   * The match job of each piece of `asked`, by its number among the pieces of `cut`: with the colour `picture`, the
   * frame's picture when it is here, shows behind the piece, and for shapes what the pieces in front of it cover of
   * it. The pieces are read front to back, each one's picture decoded once: an asked piece's, and that of every
   * piece in front of a shape asked, whose picture, when it isn't here, is taken to cover nothing.
   */
  function jobsOf(cut: MadePieces, asked: readonly Asked[], picture: Image | null, kit: MatchKit) {
    const asks = new Map(asked.map((ask) => [ask.n, ask]))
    const lastShape = asked.findLast((ask) => ask.as.kind === 'shape')?.n ?? -1
    const cover = lastShape < 0 ? null : noCover(cut)
    const jobs: { n: number; job: MatchJob }[] = []
    for (const [n, piece] of cut.items.entries()) {
      const ask = asks.get(n)
      const inFront = n < lastShape
      const bytes = ask ? ask.bytes : inFront ? bytesOf(piece) : undefined
      if (!bytes) continue
      const { width, height } = piece.picture
      const drawn = (ask && picture) || inFront ? decoded(bytes, width, height) : null
      if (ask) {
        const under = picture && drawn ? pixels(picture, piece.x, piece.y, width, height) : null
        const behind = under && drawn ? seenBehind(under, drawn) : null
        const hidden = cover && ask.as.kind === 'shape' ? hiddenUnder(cover, piece) : null
        const job = pieceMatchJob(
          base64(bytes),
          piece.picture,
          ask.as,
          kit,
          behind ? [behind] : undefined,
          hidden ? hiddenBits(hidden) : undefined,
        )
        jobs.push({ n, job })
      }
      if (cover && inFront && drawn) coverWith(cover, piece, drawn)
    }
    return jobs
  }

  /** The bytes the editor holds of split piece `piece`'s picture; none for a piece with no asset, or one not loaded. */
  function bytesOf(piece: MadePiece): Uint8Array | undefined {
    return piece.picture.assetId === undefined ? undefined : imageBytes(piece.picture.assetId)
  }

  /** The pixels of the picture `bytes` encode, `width` × `height` from its top left; null when they can't be read. */
  function decoded(bytes: Uint8Array, width: number, height: number): Pixels | null {
    const image = ck.MakeImageFromEncoded(bytes)
    if (!image) return null
    try {
      return pixels(image, 0, 0, width, height)
    } finally {
      image.delete()
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

/**
 * What is hidden of a match job's picture, as the job carries it: one bit a pixel of `hidden`, which holds a byte a
 * pixel of the picture, row by row from its top left, not 0 where the picture is covered; the first pixel of a byte
 * in its highest bit, as base64.
 */
export function hiddenBits(hidden: Uint8Array): string {
  const bits = new Uint8Array(Math.ceil(hidden.length / 8))
  for (const [at, covered] of hidden.entries()) if (covered) bits[at >> 3] = (bits[at >> 3] ?? 0) | (0x80 >> (at & 7))
  return base64(bits)
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
