// The text matcher: a job's text piece rebuilt as one text layer that looks the same, or kept a
// picture with why. Light's steps: the piece is read, its font fingerprint shortlists faces, the brand
// kit's first, each face is fitted and ranked, the best two corrected once (and the best kit font) and
// ranked again, and two finalists verified, a kit font first when it fits nearly as well. Hybrid, the
// default, then fits the face Light picked finer and finishes it again, and gives that answer when it
// looks the same, else Light's. A piece read shrunk is matched shrunk, then each answer is scaled back
// and judged at full size.

import type { CanvasKit } from '@dazbee/canvaskit'
import type { CatalogFace } from '@dazbee/fonts'
import type { MatchAnswer, MatchJob, Piece, Rgb } from '@dazbee/schema'

import { pictureAnswer } from '../shape/answer.ts'
import { piecePixels } from '../shape/parts/piece-pixels.ts'
import { textAnswer } from './answer.ts'
import { pickFit } from './brand-first.ts'
import { type Placed, textDrawer, type TextLook } from './draw-text.ts'
import { finerFit } from './finer-fit.ts'
import { pieceFingerprint } from './fingerprint.ts'
import { type FontKey } from './font-key.ts'
import { type FontSource, loadFaces } from './font-source.ts'
import { correct } from './light/correct.ts'
import { fitFace, type Fitted } from './light/fit.ts'
import { rankFits } from './light/rank.ts'
import { FINALISTS, finish, judgeText, type Verified, verify, type VerifyTarget } from './light/verify.ts'
import type { ModelRuntime } from './model-runtime.ts'
import { readPiece } from './read-piece.ts'
import { type Candidate, shortlist } from './shortlist.ts'
import type { TextFiles } from './text-files.ts'

/**
 * What the text matcher needs besides the job: CanvasKit, its files, the model's runtime, a source of
 * fonts, and the faces of the kit's families that have no fingerprint (a brand's uploads), as the
 * font catalog lists them.
 */
export interface TextMatcherDeps {
  ck: CanvasKit
  files: TextFiles
  model: ModelRuntime
  fonts: FontSource
  kitFaces?: readonly CatalogFace[]
}

/** A text piece of a job. */
export type TextPieceOfJob = Extract<Piece, { kind: 'text' }>

/** The text matcher's answer for a piece, and the face it picked, also when the piece stays a picture. */
export interface TextMatch {
  answer: MatchAnswer
  face?: FontKey
}

/** How many of the best-ranked fits are corrected. */
const CORRECTED = 2

/**
 * A job's text piece as one text layer in the piece's pixels when it looks the same; else a picture,
 * `noFont` when no face draws its words, `failed` when the font source gives none of the faces that
 * do, `looksDifferent` otherwise. Hybrid gives its finer fit when that looks the same, else Light's
 * answer, so it keeps every piece Light keeps.
 */
export async function matchText(job: MatchJob, piece: TextPieceOfJob, deps: TextMatcherDeps): Promise<MatchAnswer> {
  return (await matchTextWithFace(job, piece, deps)).answer
}

/** `matchText`'s answer, with the face it picked. */
export async function matchTextWithFace(
  job: MatchJob,
  piece: TextPieceOfJob,
  deps: TextMatcherDeps,
): Promise<TextMatch> {
  const { ck, files, fonts } = deps
  const { words } = piece
  const pixels = piecePixels(ck, job.picture, piece.rect)
  const { whole, work, scale } = readPiece({
    pixels,
    words,
    ...(piece.angle !== undefined ? { angle: piece.angle } : {}),
  })
  const fingerprint = await pieceFingerprint(deps.model, files, work.level, work.lines)
  const listed = await shortlist({
    ck,
    files,
    fingerprint,
    words,
    kitFonts: job.kit.fonts,
    kitFaces: deps.kitFaces ?? [],
    fonts,
  })
  if (listed.candidates.length === 0) return { answer: pictureAnswer('noFont') }
  const faces = await facesOf(fonts, listed.candidates, listed.loaded, words)
  const candidates = listed.candidates.filter((face) => faces.has(face.key))
  if (candidates.length === 0) return { answer: pictureAnswer('failed') }
  const backgrounds: readonly Rgb[] = job.backgrounds ?? [whole.background]
  const target: VerifyTarget = { reading: work, words, backgrounds, kit: job.kit, scale }
  const drawer = textDrawer(ck, drawnFaces(candidates, faces))
  let light: Verified | undefined
  let finer: Verified | undefined
  try {
    const fits = candidates.flatMap((face) => fitFace(drawer, work, words, face) ?? [])
    rankFits(fits, listed.similarities)
    for (let i = 0; i < Math.min(CORRECTED, fits.length); i++) fits[i] = correct(drawer, work, words, fits[i] as Fitted)
    const brandLead = fits.findIndex((fit) => fit.face.brandToken !== undefined)
    if (brandLead >= CORRECTED) fits[brandLead] = correct(drawer, work, words, fits[brandLead] as Fitted)
    rankFits(fits, listed.similarities)
    const first = pickFit(fits)
    if (first) {
      const finalists = [first, ...fits.filter((fit) => fit !== first).slice(0, FINALISTS - 1)]
      light = verify(drawer, target, finalists, listed.similarities)
    }
    if (light && job.setting === 'hybrid') {
      const finerFitted = finerFit(drawer, work, words, light.fit)
      if (finerFitted !== light.fit) finer = finish(drawer, target, finerFitted)
    }
  } finally {
    drawer.delete()
  }
  if (!light) return { answer: pictureAnswer('looksDifferent') }
  const atFullSize = (verified: Verified) =>
    scale === 1 ? verified : atWholeSize(ck, verified, scale, faces, { ...target, reading: whole })
  const finerAtFullSize = finer && atFullSize(finer)
  const answer = finerAtFullSize?.same ? finerAtFullSize : atFullSize(light)
  const face = { family: answer.face.family, weight: answer.face.weight, style: answer.face.style }
  return {
    answer: answer.same
      ? textAnswer(words, answer.look, answer.place, answer.scores, answer.bindings, answer.styleLook)
      : pictureAnswer('looksDifferent', answer.scores),
    face,
  }
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
 * judged at full size; in the piece's own colours, unbound, when its kit colours look different there
 * and those look the same.
 */
function atWholeSize(
  ck: CanvasKit,
  won: Verified,
  scale: number,
  faces: ReadonlyMap<string, Uint8Array>,
  target: VerifyTarget,
): Verified {
  const { place } = won
  const placed: Placed = {
    ...place,
    x: place.x / scale,
    y: place.y / scale,
    width: place.width / scale,
    height: place.height / scale,
  }
  const drawer = textDrawer(ck, drawnFaces([won.face], faces))
  try {
    const whole = wholeLook(won.look, scale)
    const judged: Verified = { ...won, look: whole, place: placed, ...judgeText(drawer, target, whole, placed) }
    if (judged.same || !won.ownLook) return judged
    const own = wholeLook(won.ownLook, scale)
    const plain = judgeText(drawer, target, own, placed)
    if (!plain.same) return judged
    const bindings = { ...won.bindings }
    delete bindings.textColor
    return { ...judged, look: own, bindings, ...plain }
  } finally {
    drawer.delete()
  }
}

/** A look found on the shrunk piece at the whole piece's size, its outline to the half pixel. */
function wholeLook(look: TextLook, scale: number): TextLook {
  return {
    ...look,
    size: look.size / scale,
    ...(look.outline ? { outline: { ...look.outline, width: Math.round((look.outline.width / scale) * 2) / 2 } } : {}),
  }
}
