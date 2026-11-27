// A frame's split pieces rebuilt by the matchers, for Make editable's finish, and the pieces lifting while they
// work. The pieces' pictures and the frame's own are loaded first, then the matchers are asked once for the frame
// and given two minutes: past that, or when the editor ends, their work is cancelled and the rebuild fails, which
// the finish tries again. What comes back is, by the piece's number, the layers each rebuilt piece is placed as. A
// frame lifts from when its matching starts until the finish settles it; each lifting piece's picture is an object
// URL of the bytes the editor holds, let go when the frame settles. With no matcher nothing is rebuilt and nothing
// lifts.
import type { UnplacedLayer } from '@dazbee/schema'

import type { PieceBox } from './layer-pieces.ts'
import type { FramePieces, PieceMatcher } from './piece-matcher.ts'
import { rebuiltLayers } from './piece-matching.ts'

/** A frame whose split pieces are being matched: its pieces but those filling it, bottom first, each a picture at its box. */
export interface LiftedFrame {
  frameId: string
  pieces: readonly { url: string; box: PieceBox }[]
}

/** A split piece's picture layer as the finish would place it: its picture and its box in the frame. */
export interface PieceLayer {
  assetId: string
  box: PieceBox
}

export interface PieceRebuildDeps {
  /** The matchers' answers for a frame's split pieces; without it no piece is rebuilt. */
  matcher?: PieceMatcher | undefined
  /** Gets pictures ready to draw; settles once they are, or can't be. */
  readyPictures: (assetIds: readonly string[]) => Promise<void>
  /** The encoded bytes the editor holds of an image, by its asset; none for one not loaded. */
  imageBytes: (assetId: string) => Uint8Array | undefined
  /** Runs `run` after `ms`, giving what cancels it. */
  after: (ms: number, run: () => void) => () => void
  /** Aborted when the editor ends: the matching under way is cancelled. */
  signal: AbortSignal
}

export interface PieceRebuild {
  /**
   * The layers the matchers rebuild the pieces of frame `frameId`, of size `own`, as: by the piece's number among
   * `pieces.cut`, each piece's layers placed in the frame, bottom first; no entry for a piece that stays a picture.
   * `layers` are the pieces' picture layers, in the pieces' order, which lift meanwhile. It rejects when the
   * matchers fail, take longer than `MATCH_MS`, or the editor ends.
   */
  layers(
    frameId: string,
    pieces: FramePieces,
    own: Size,
    layers: readonly PieceLayer[],
  ): Promise<Map<number, UnplacedLayer[]>>
  /** The frames whose pieces lift now. */
  lifting(): readonly LiftedFrame[]
  /** Calls back when `lifting()` changes; gives what stops it. */
  onLifting(listener: () => void): () => void
  /** Ends frame `frameId`'s lifting, if it lifts. */
  settle(frameId: string): void
}

type Size = Pick<PieceBox, 'width' | 'height'>

/** How long the matchers may take for one frame's pieces before their work is cancelled, in ms. */
export const MATCH_MS = 120_000
/** A split piece covering more than this share of its frame doesn't lift: it is what the others lift from. */
const FILLS_FRAME = 0.9

export function pieceRebuild({ matcher, readyPictures, imageBytes, after, signal }: PieceRebuildDeps): PieceRebuild {
  /** The frames whose pieces lift, each with its pieces' pictures. */
  const lifted = new Map<string, LiftedFrame>()
  /** Who hears when the lifting frames change. */
  const listeners = new Set<() => void>()

  async function layers(frameId: string, pieces: FramePieces, own: Size, placed: readonly PieceLayer[]) {
    const rebuilt = new Map<number, UnplacedLayer[]>()
    if (!matcher) return rebuilt
    const { cut, plan, pictureAssetId } = pieces
    await readyPictures([...placed.map((layer) => layer.assetId), ...(pictureAssetId === null ? [] : [pictureAssetId])])
    signal.throwIfAborted()
    lift(frameId, placed, own)
    const stop = new AbortController()
    const ended = () => stop.abort(signal.reason)
    signal.addEventListener('abort', ended)
    const tooLong = after(MATCH_MS, () => stop.abort(new Error('the matchers took too long')))
    try {
      const stopped = new Promise<never>((_, reject) => {
        stop.signal.addEventListener('abort', () => reject(stop.signal.reason as Error), { once: true })
      })
      const asked = matcher(pieces, stop.signal)
      // Stopped first, the matchers' own end is heard by no one.
      asked.catch(() => {})
      const answers = await Promise.race([asked, stopped])
      for (const [n, piece] of cut.items.entries()) {
        const made = rebuiltLayers(answers.get(n), piece, plan, cut, own)
        if (made) rebuilt.set(n, made)
      }
      return rebuilt
    } finally {
      tooLong()
      signal.removeEventListener('abort', ended)
    }
  }

  /** Shows frame `frameId`'s pieces lifting: each of `placed` not filling the frame, of size `own`, whose picture is here. */
  function lift(frameId: string, placed: readonly PieceLayer[], own: Size) {
    settle(frameId)
    const pieces = [...placed].reverse().flatMap((layer) => {
      const bytes = imageBytes(layer.assetId)
      if (!bytes || layer.box.width * layer.box.height > FILLS_FRAME * own.width * own.height) return []
      return [{ url: URL.createObjectURL(new Blob([bytes.slice()], { type: 'image/png' })), box: layer.box }]
    })
    if (pieces.length === 0) return
    lifted.set(frameId, { frameId, pieces })
    for (const listener of listeners) listener()
  }

  function settle(frameId: string) {
    const was = lifted.get(frameId)
    if (!was) return
    lifted.delete(frameId)
    for (const piece of was.pieces) URL.revokeObjectURL(piece.url)
    for (const listener of listeners) listener()
  }

  function onLifting(listener: () => void) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }

  return { layers, lifting: () => [...lifted.values()], onLifting, settle }
}
