// The text matcher: a job's text piece rebuilt as one text layer, approximate when it doesn't look
// the same. Light's steps: the piece is read, its font fingerprint shortlists faces, the brand kit's
// first, each face is fitted and ranked, the best two corrected once (and the best kit font) and
// ranked again, and two finalists verified, a kit font first when it fits nearly as well. Hybrid, the
// default, then fits the face Light picked finer and finishes it again, and gives that answer when it
// looks the same, else Light's when that does, else the closer of the two. A piece read shrunk is
// matched shrunk, then each answer is scaled back and judged at full size. A piece no shortlisted face
// draws, fits or loads is set in the shipped Noto of its script, approximate.

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
import { inkBox } from './ink.ts'
import { correct } from './light/correct.ts'
import { fitFace, type Fitted } from './light/fit.ts'
import { rankFits } from './light/rank.ts'
import { closeness, FINALISTS, finish, judgeText, type Verified, verify, type VerifyTarget } from './light/verify.ts'
import type { ModelRuntime } from './model-runtime.ts'
import { notoCandidates, plainFit } from './noto.ts'
import { type PieceReading, readPiece } from './read-piece.ts'
import { type Candidate, shortlist } from './shortlist.ts'
import type { TextFiles } from './text-files.ts'

/**
 * What the text matcher needs besides the job: CanvasKit, its files, the model's runtime, a source of
 * fonts (the shipped Noto faces among them), the faces of the kit's families that have no
 * fingerprint (a brand's uploads), as the font catalog lists them, and who is told as each step
 * starts.
 */
export interface TextMatcherDeps {
  ck: CanvasKit
  files: TextFiles
  model: ModelRuntime
  fonts: FontSource
  kitFaces?: readonly CatalogFace[]
  step?: (step: TextStep) => void
}

/**
 * The text matcher's steps, in order: reading the piece, shortlisting faces by its fingerprint,
 * fitting and judging them, and Hybrid's finer fit of the face picked. Each is told once.
 */
export const TEXT_STEPS = ['reading', 'shortlist', 'fitting', 'finerFit'] as const
export type TextStep = (typeof TEXT_STEPS)[number]

/** A text piece of a job. */
export type TextPieceOfJob = Extract<Piece, { kind: 'text' }>

/** The text matcher's answer for a piece, and the face it set it in; none when the piece stays a picture. */
export interface TextMatch {
  answer: MatchAnswer
  face?: FontKey
}

/** What fitting a piece's faces reads: the job, the piece read at both sizes, and what it is judged against. */
interface Fitting {
  ck: CanvasKit
  job: MatchJob
  words: string
  whole: PieceReading
  work: PieceReading
  scale: number
  target: VerifyTarget
  fonts: FontSource
  step: (step: TextStep) => void
}

/** How many of the best-ranked fits are corrected. */
const CORRECTED = 2

/**
 * A job's text piece as one text layer in the piece's pixels, approximate when it doesn't look the
 * same, or when no catalog face draws its characters and it is set in Noto. Hybrid gives its finer
 * fit when that looks the same, else Light's answer when that does, so it keeps every piece Light
 * makes look the same. The piece stays a picture, `failed`, only when it has no ink to read or none
 * of its faces loads, Noto's included.
 */
export async function matchText(job: MatchJob, piece: TextPieceOfJob, deps: TextMatcherDeps): Promise<MatchAnswer> {
  return (await matchTextWithFace(job, piece, deps)).answer
}

/** `matchText`'s answer, with the face it set the text in. */
export async function matchTextWithFace(
  job: MatchJob,
  piece: TextPieceOfJob,
  deps: TextMatcherDeps,
): Promise<TextMatch> {
  const { ck, files, fonts } = deps
  const { words } = piece
  const told = new Set<TextStep>()
  const step = (next: TextStep) => {
    if (told.has(next)) return
    told.add(next)
    deps.step?.(next)
  }
  step('reading')
  const pixels = piecePixels(ck, job.picture, piece.rect)
  const { whole, work, scale } = readPiece({
    pixels,
    words,
    ...(piece.angle !== undefined ? { angle: piece.angle } : {}),
  })
  // No pixel of the piece holds any ink: there is nothing to read.
  if (!inkBox(whole.ink, 0)) return { answer: pictureAnswer('failed') }
  step('shortlist')
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
  const backgrounds: readonly Rgb[] = job.backgrounds ?? [whole.background]
  const target: VerifyTarget = { reading: work, words, backgrounds, kit: job.kit, scale }
  const fitting: Fitting = { ck, job, words, whole, work, scale, target, fonts, step }
  const listedAnswer = await matchFaces(fitting, listed.candidates, listed.loaded, listed.similarities)
  const notoAnswer = listedAnswer
    ? undefined
    : await matchFaces(fitting, notoCandidates(words), new Map(), new Map(), true)
  const answer = listedAnswer ?? notoAnswer
  if (!answer) return { answer: pictureAnswer('failed') }
  return {
    answer: textAnswer(
      words,
      answer.look,
      answer.place,
      answer.scores,
      notoAnswer !== undefined || !answer.same,
      answer.bindings,
      answer.styleLook,
    ),
    face: { family: answer.face.family, weight: answer.face.weight, style: answer.face.style },
  }
}

/**
 * The answer in one of `candidates`, judged at full size: Light's verified pick, and in Hybrid its
 * finer fit when that looks the same, else Light's when that does, else the closer of the two;
 * undefined when none of their faces loads or fits. With `plain`, the first face is set at the
 * piece's line height when no face can be fitted.
 */
async function matchFaces(
  fitting: Fitting,
  candidates: readonly Candidate[],
  loaded: ReadonlyMap<string, Uint8Array | null>,
  similarities: ReadonlyMap<string, number>,
  plain = false,
): Promise<Verified | undefined> {
  const { ck, job, words, work, target, scale } = fitting
  if (candidates.length === 0) return undefined
  const faces = await facesOf(fitting.fonts, candidates, loaded, words)
  const drawn = candidates.filter((face) => faces.has(face.key))
  if (drawn.length === 0) return undefined
  fitting.step('fitting')
  const drawer = textDrawer(ck, drawnFaces(drawn, faces))
  let light: Verified | undefined
  let finer: Verified | undefined
  try {
    const fits = drawn.flatMap((face) => fitFace(drawer, work, words, face) ?? [])
    const plainFirst = plain && fits.length === 0 && drawn[0] ? plainFit(drawer, work, words, drawn[0]) : null
    if (plainFirst) fits.push(plainFirst)
    rankFits(fits, similarities)
    for (let i = 0; i < Math.min(CORRECTED, fits.length); i++) fits[i] = correct(drawer, work, words, fits[i] as Fitted)
    const brandLead = fits.findIndex((fit) => fit.face.brandToken !== undefined)
    if (brandLead >= CORRECTED) fits[brandLead] = correct(drawer, work, words, fits[brandLead] as Fitted)
    rankFits(fits, similarities)
    const first = pickFit(fits)
    if (first) {
      const finalists = [first, ...fits.filter((fit) => fit !== first).slice(0, FINALISTS - 1)]
      light = verify(drawer, target, finalists, similarities)
    }
    if (light && job.setting === 'hybrid') {
      fitting.step('finerFit')
      const finerFitted = finerFit(drawer, work, words, light.fit)
      if (finerFitted !== light.fit) finer = finish(drawer, target, finerFitted)
    }
  } finally {
    drawer.delete()
  }
  if (!light) return undefined
  const atFullSize = (verified: Verified) =>
    scale === 1 ? verified : atWholeSize(ck, verified, scale, faces, { ...target, reading: fitting.whole })
  const lightAnswer = atFullSize(light)
  const finerAnswer = finer && atFullSize(finer)
  if (!finerAnswer) return lightAnswer
  if (finerAnswer.same || lightAnswer.same) return finerAnswer.same ? finerAnswer : lightAnswer
  return closeness(finerAnswer.scores) > closeness(lightAnswer.scores) ? finerAnswer : lightAnswer
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
