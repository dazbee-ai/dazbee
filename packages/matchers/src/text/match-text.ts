// The text matcher: a job's text piece rebuilt as one text layer that looks the same, or kept a
// picture with why. Light's steps: the piece is read, its font fingerprint shortlists faces, each face
// is fitted and ranked, the best two corrected once and ranked again, and the two finalists verified.
// A piece read shrunk is verified shrunk, then its answer is scaled back and judged once at full size.

import type { CanvasKit } from '@dazbee/canvaskit'
import type { MatchAnswer, MatchJob, Piece, Rgb } from '@dazbee/schema'

import { pictureAnswer } from '../shape/answer.ts'
import { piecePixels } from '../shape/parts/piece-pixels.ts'
import { textAnswer } from './answer.ts'
import { pieceFingerprint } from './fingerprint.ts'
import { type FontSource, loadFaces } from './font-source.ts'
import { correct } from './light/correct.ts'
import { type Placed, textDrawer, type TextLook } from './light/draw-text.ts'
import { fitFace, type Fitted } from './light/fit.ts'
import { rankFits } from './light/rank.ts'
import { FINALISTS, judgeText, type Verified, verify, type VerifyTarget } from './light/verify.ts'
import type { ModelRuntime } from './model-runtime.ts'
import { readPiece } from './read-piece.ts'
import { type Candidate, shortlist } from './shortlist.ts'
import type { TextFiles } from './text-files.ts'

/** What the text matcher needs besides the job: CanvasKit, its files, the model's runtime and a source of fonts. */
export interface TextMatcherDeps {
  ck: CanvasKit
  files: TextFiles
  model: ModelRuntime
  fonts: FontSource
}

/** A text piece of a job. */
export type TextPieceOfJob = Extract<Piece, { kind: 'text' }>

/** How many of the best-ranked fits are corrected. */
const CORRECTED = 2

/**
 * A job's text piece as one text layer in the piece's pixels when it looks the same; else a picture,
 * `noFont` when no face draws its words, `looksDifferent` otherwise.
 */
export async function matchText(job: MatchJob, piece: TextPieceOfJob, deps: TextMatcherDeps): Promise<MatchAnswer> {
  const { ck, files, fonts } = deps
  const { words } = piece
  const pixels = piecePixels(ck, job.picture, piece.rect)
  const { whole, work, scale } = readPiece({
    pixels,
    words,
    ...(piece.angle !== undefined ? { angle: piece.angle } : {}),
  })
  const fingerprint = await pieceFingerprint(deps.model, files, work.level, work.lines)
  const listed = await shortlist({ ck, files, fingerprint, words, kitFonts: {}, kitFaces: [], fonts })
  const faces = await facesOf(fonts, listed.candidates, listed.loaded, words)
  const candidates = listed.candidates.filter((face) => faces.has(face.key))
  if (candidates.length === 0) return pictureAnswer('noFont')
  const backgrounds: readonly Rgb[] = job.backgrounds ?? [whole.background]
  const drawer = textDrawer(ck, drawnFaces(candidates, faces))
  let won: Verified | undefined
  try {
    const fits = candidates.flatMap((face) => fitFace(drawer, work, words, face) ?? [])
    rankFits(fits, listed.similarities)
    for (let i = 0; i < Math.min(CORRECTED, fits.length); i++) fits[i] = correct(drawer, work, words, fits[i] as Fitted)
    rankFits(fits, listed.similarities)
    won = verify(drawer, { reading: work, words, backgrounds }, fits.slice(0, FINALISTS), listed.similarities)
  } finally {
    drawer.delete()
  }
  if (!won) return pictureAnswer('looksDifferent')
  const answer = scale === 1 ? won : atWholeSize(ck, won, scale, faces, { reading: whole, words, backgrounds })
  return answer.same
    ? textAnswer(words, answer.look, answer.place, answer.scores)
    : pictureAnswer('looksDifferent', answer.scores)
}

/** The bytes of each candidate's face, those the shortlist loaded and the rest asked for at once; none for a face no font draws. */
async function facesOf(
  fonts: FontSource,
  candidates: readonly Candidate[],
  loaded: ReadonlyMap<string, Uint8Array | null>,
  words: string,
): Promise<Map<string, Uint8Array>> {
  const missing = candidates.map((face) => face.key).filter((key) => !loaded.has(key))
  const fetched = await loadFaces(fonts, missing, words)
  const faces = new Map<string, Uint8Array>()
  for (const { key } of candidates) {
    const bytes = loaded.get(key) ?? fetched.get(key)
    if (bytes) faces.set(key, bytes)
  }
  return faces
}

/** The candidates' faces as the drawer registers them, under their families, in the candidates' order. */
function drawnFaces(candidates: readonly Candidate[], faces: ReadonlyMap<string, Uint8Array>) {
  return candidates.flatMap((face) => {
    const bytes = faces.get(face.key)
    return bytes ? [{ family: face.family, bytes }] : []
  })
}

/**
 * The answer found on the shrunk piece scaled back to the whole piece, drawn in its face alone and
 * judged at full size.
 */
function atWholeSize(
  ck: CanvasKit,
  won: Verified,
  scale: number,
  faces: ReadonlyMap<string, Uint8Array>,
  target: VerifyTarget,
): Verified {
  const { look, place } = won
  const whole: TextLook = {
    ...look,
    size: look.size / scale,
    ...(look.outline ? { outline: { ...look.outline, width: Math.round((look.outline.width / scale) * 2) / 2 } } : {}),
  }
  const placed: Placed = {
    ...place,
    x: place.x / scale,
    y: place.y / scale,
    width: place.width / scale,
    height: place.height / scale,
  }
  const drawer = textDrawer(ck, drawnFaces([won.face], faces))
  try {
    return { face: won.face, look: whole, place: placed, ...judgeText(drawer, target, whole, placed) }
  } finally {
    drawer.delete()
  }
}
