// The text matcher: a job's text piece rebuilt as one text layer, approximate when it doesn't look
// the same. Light's steps: the piece is read, its font fingerprint shortlists faces, the brand kit's
// first, each face is fitted and ranked, the best two corrected once (and the best kit font) and
// ranked again, and two finalists verified, a kit font first when it fits nearly as well. Hybrid, the
// default, then fits the face Light picked finer and finishes it again, and gives that answer when it
// looks the same, else Light's when that does, else the closer of the two. A piece read shrunk is
// matched shrunk, then each answer is scaled back and judged at full size. A piece no catalog face
// draws, or none of those shortlisted fits, is set in the shipped Noto of its script, approximate.
// A piece read as hollow letters is matched again read as drawn, and of the two answers the one that
// looks the same is given, else the closer. Letters are never spaced so tight they run into each
// other, unless only that looks the same, as where the picture's own letters do.

import type { CanvasKit } from '@dazbee/canvaskit'
import type { CatalogFace } from '@dazbee/fonts'
import type { MatchAnswer, MatchJob, MatchSetting, Piece, Rgb } from '@dazbee/schema'

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
import { spacedAny } from './light/letters-apart.ts'
import { rankFits } from './light/rank.ts'
import { closeness, FINALISTS, finish, judgeText, type Verified, verify, type VerifyTarget } from './light/verify.ts'
import type { ModelRuntime } from './model-runtime.ts'
import { notoCandidates, plainFit } from './noto.ts'
import { type PieceReading, type ReadPiece, readPiece } from './read-piece.ts'
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

/** What fitting a piece's faces reads: the setting, the piece read whole, and what it is judged against at the work size. */
interface Fitting {
  ck: CanvasKit
  setting: MatchSetting
  words: string
  whole: PieceReading
  target: VerifyTarget
  fonts: FontSource
  step: (step: TextStep) => void
}

/** Which faces `matchFaces` tries, what it knows of them, and whether a face no fit can size is set plainly. */
interface FacesTried {
  candidates: readonly Candidate[]
  /** The faces' bytes the shortlist already loaded, by key. */
  loaded: ReadonlyMap<string, Uint8Array | null>
  /** Each face's similarity to the piece's fingerprint, by key. */
  similarities: ReadonlyMap<string, number>
  /** Sets the first face at the piece's line height when no face can be fitted. */
  plainWhenUnfitted: boolean
}

/** What `matchFaces` found: the answer, or that none of the faces loaded or none could be fitted. */
type FacesMatched = Verified | 'unloaded' | 'unfitted'

/** The answer found for one reading of a piece, and whether it is set in Noto. */
interface ReadingMatched {
  matched: Verified
  inNoto: boolean
}

/** How many of the best-ranked fits are corrected. */
const CORRECTED = 2

/**
 * A job's text piece as one text layer in the piece's pixels, approximate when it doesn't look the
 * same, or when it is set in Noto as no catalog face draws its characters or none shortlisted fits.
 * Hybrid gives its finer fit when that looks the same, else Light's answer when that does, so it
 * keeps every piece Light makes look the same. The piece stays a picture, `failed`, only when it has
 * no ink to read or the font source gives none of the faces it tries.
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
  const { ck } = deps
  const { words } = piece
  const told = new Set<TextStep>()
  const step = (next: TextStep) => {
    if (told.has(next)) return
    told.add(next)
    deps.step?.(next)
  }
  step('reading')
  const textPiece = {
    pixels: piecePixels(ck, job.picture, piece.rect),
    words,
    ...(piece.angle !== undefined ? { angle: piece.angle } : {}),
  }
  const read = readPiece(textPiece)
  // No pixel of the piece holds any ink: there is nothing to read.
  if (!inkBox(read.whole.ink, 0)) return { answer: pictureAnswer('failed') }
  const asRead = await matchReading(job, words, read, deps, step)
  // Letters read as hollow are matched as drawn too, since thin letters whose every stroke edges a
  // counter, or letters in a drawn frame, can read as hollow.
  const asDrawn =
    read.whole.fill === null
      ? await matchReading(job, words, readPiece(textPiece, { hollow: false }), deps, step)
      : 'failed'
  const best = closerMatch(asDrawn, asRead)
  if (best === 'failed') return { answer: pictureAnswer('failed') }
  const { matched, inNoto } = best
  const { look, place, scores, bindings, styleLook } = matched
  return {
    answer: textAnswer(words, look, place, scores, {
      approximate: inNoto || !matched.same,
      bindings,
      ...(styleLook ? { styleLook } : {}),
    }),
    face: { family: matched.face.family, weight: matched.face.weight, style: matched.face.style },
  }
}

/**
 * The answer for one reading of a piece: in a face its fingerprint shortlists, or in the Noto of its
 * script when none of those draws it or can be fitted; `failed` when the font source gives none of
 * the faces tried.
 */
async function matchReading(
  job: MatchJob,
  words: string,
  { whole, work, scale }: ReadPiece,
  deps: TextMatcherDeps,
  step: (step: TextStep) => void,
): Promise<ReadingMatched | 'failed'> {
  const { ck, files, fonts } = deps
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
  const fitting: Fitting = { ck, setting: job.setting, words, whole, target, fonts, step }
  const listedMatch: FacesMatched =
    listed.candidates.length > 0 ? await matchFaces(fitting, { ...listed, plainWhenUnfitted: false }) : 'unfitted'
  const inNoto = listedMatch === 'unfitted'
  const matched = inNoto
    ? await matchFaces(fitting, {
        candidates: notoCandidates(words),
        loaded: new Map(),
        similarities: new Map(),
        plainWhenUnfitted: true,
      })
    : listedMatch
  return typeof matched === 'string' ? 'failed' : { matched, inNoto }
}

/**
 * Of two readings' answers, the one that looks the same and isn't set in Noto when only one does,
 * else the closer by the rule's SSIM less the ink missed, the first on a tie.
 */
function closerMatch(first: ReadingMatched | 'failed', second: ReadingMatched | 'failed'): ReadingMatched | 'failed' {
  if (first === 'failed' || second === 'failed') return first === 'failed' ? second : first
  const looksSame = ({ matched, inNoto }: ReadingMatched) => matched.same && !inNoto
  if (looksSame(first) !== looksSame(second)) return looksSame(first) ? first : second
  return closeness(second.matched.scores) > closeness(first.matched.scores) ? second : first
}

/**
 * The answer in one of the faces tried, its letters kept from running into each other; when that
 * doesn't look the same, the answer fitted as tight as the piece asks instead if that looks the same,
 * so a picture whose own letters run into each other keeps looking the same. When no fit was spaced
 * wider to keep its letters apart, fitting as tight as the piece asks would fit the same again.
 */
async function matchFaces(fitting: Fitting, tried: FacesTried): Promise<FacesMatched> {
  const faces = await facesOf(fitting.fonts, tried.candidates, tried.loaded, fitting.words)
  const drawn = tried.candidates.filter((face) => faces.has(face.key))
  if (drawn.length === 0) return 'unloaded'
  fitting.step('fitting')
  const apart = fitFaces(fitting, tried, drawn, faces, true)
  if (apart.answer === 'unfitted' || apart.answer.same || !apart.spacedWider) return apart.answer
  const touching = fitFaces(fitting, tried, drawn, faces, false).answer
  return touching !== 'unfitted' && touching.same ? touching : apart.answer
}

/**
 * The answer in one of the faces drawn, judged at full size: Light's verified pick, and in Hybrid its
 * finer fit when that looks the same, else Light's when that does, else the closer of the two by the
 * rule's SSIM less the ink missed, as Light's finalists are compared. `lettersApart` keeps every fit's
 * letters from running into each other; `spacedWider` says whether that spaced any fit wider.
 */
function fitFaces(
  fitting: Fitting,
  tried: FacesTried,
  drawn: readonly Candidate[],
  faces: ReadonlyMap<string, Uint8Array>,
  lettersApart: boolean,
): { answer: Verified | 'unfitted'; spacedWider: boolean } {
  const { ck, words, target } = fitting
  const { similarities } = tried
  const { reading: work, scale } = target
  const drawer = textDrawer(ck, drawnFaces(drawn, faces), { lettersApart })
  let light: Verified | undefined
  let finer: Verified | undefined
  let spacedWider = false
  try {
    const fits = drawn.flatMap((face) => fitFace(drawer, work, words, face) ?? [])
    const unfitted = tried.plainWhenUnfitted && fits.length === 0 && drawn[0]
    const plain = unfitted ? plainFit(drawer, work, words, unfitted) : null
    if (plain) fits.push(plain)
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
    if (light && fitting.setting === 'hybrid') {
      fitting.step('finerFit')
      const finerFitted = finerFit(drawer, work, words, light.fit)
      if (finerFitted !== light.fit) finer = finish(drawer, target, finerFitted)
    }
    spacedWider = spacedAny(drawer)
  } finally {
    drawer.delete()
  }
  if (!light) return { answer: 'unfitted', spacedWider }
  const atFullSize = (verified: Verified) =>
    scale === 1 ? verified : atWholeSize(ck, verified, scale, faces, { ...target, reading: fitting.whole })
  return { answer: hybridAnswer(atFullSize(light), finer && atFullSize(finer)), spacedWider }
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

/** The finer fit's answer when it looks the same, else Light's when that does, else the closer by the rule's SSIM less the ink missed. */
function hybridAnswer(light: Verified, finer: Verified | undefined): Verified {
  if (!finer) return light
  if (finer.same || light.same) return finer.same ? finer : light
  return closeness(finer.scores) > closeness(light.scores) ? finer : light
}

/** A look found on the shrunk piece at the whole piece's size, its outline to the half pixel. */
function wholeLook(look: TextLook, scale: number): TextLook {
  return {
    ...look,
    size: look.size / scale,
    ...(look.outline ? { outline: { ...look.outline, width: Math.round((look.outline.width / scale) * 2) / 2 } } : {}),
  }
}
