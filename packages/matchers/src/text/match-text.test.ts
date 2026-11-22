import { describe, expect, it } from 'vitest'

import type { Pixels } from '@dazbee/renderer'
import { loadCanvasKit } from '@dazbee/renderer/node'
import type { MatchAnswer, MatchSetting } from '@dazbee/schema'

import { LOOKS_SAME } from '../looks-same/rule.ts'
import { fontKey } from './font-key.ts'
import type { FontSource } from './font-source.ts'
import { matchText, matchTextWithFace, TEXT_STEPS, type TextStep } from './match-text.ts'
import { textMatcherFiles } from './test-text-files.ts'
import {
  lightFonts,
  type LightPiece,
  lightPieces,
  NOISE_WORDS,
  noisePiece,
  textJob,
  textLayerOf,
} from './test-text-pieces.ts'

const ck = await loadCanvasKit()
const { files, model } = await textMatcherFiles()
const fonts = lightFonts()
const pieces = lightPieces(ck, fonts)

/** The faces of Light's test, cut to its characters; none for any other key. */
const FIXTURE_FONTS: FontSource = { face: async (key) => fonts.get(key) ?? null }

/** A size found within this share of the size drawn comes back right. */
const SIZE_WITHIN = 0.03
/** Letter spacing found within this many points of the spacing drawn comes back right. */
const SPACING_WITHIN = 3

/** The pieces of Light's test that are round trips. */
const ROUND_TRIPS = [
  'latin-plain',
  'latin-outlined',
  'latin-tilted',
  'latin-tight',
  'latin-loose',
  'arabic-plain',
  'arabic-outlined',
  'arabic-tilted',
  'devanagari-plain',
  'devanagari-tilted',
  'devanagari-loose',
]

/** The round trip Hybrid keeps a picture, though Light makes it text. */
const HYBRID_PICTURE = 'arabic-outlined'

/** A piece matched twice in a setting, Light unless named, which must give the same answer. */
async function matchTwice(pixels: Pixels, words: string, setting: MatchSetting = 'light'): Promise<MatchAnswer> {
  const { job, piece } = textJob(ck, pixels, words, { setting })
  const deps = { ck, files, model, fonts: FIXTURE_FONTS }
  const first = await matchText(job, piece, deps)
  expect(await matchText(job, piece, deps)).toEqual(first)
  return first
}

/** The piece of Light's test with this id. */
function pieceOf(id: string): LightPiece {
  const piece = pieces.find((p) => p.id === id)
  if (!piece) throw new Error(`Light's test has no piece ${id}`)
  return piece
}

describe('matchText', () => {
  it.each(ROUND_TRIPS)('gives %s back in its face and size as one text layer that looks the same', async (id) => {
    const piece = pieceOf(id)
    const { style, text, rotation } = textLayerOf(await matchTwice(piece.pixels, piece.words)).props
    expect(`${style.fontFamily}|${style.fontWeight}|${style.fontStyle}`).toBe(piece.key)
    expect(Math.abs(style.fontSize / piece.size - 1)).toBeLessThan(SIZE_WITHIN)
    expect(text).toBe(piece.words)
    expect(Math.abs(rotation - (piece.rotation ?? 0))).toBeLessThan(1)
    expect(Boolean(style.outline)).toBe(Boolean(piece.outline))
    expect(Math.abs(style.letterSpacing.value - (piece.spacing ?? 0))).toBeLessThan(SPACING_WITHIN)
  })

  it.each(ROUND_TRIPS)('fits %s finer in Hybrid, the default, in the face Light picks, its drawn face', async (id) => {
    const piece = pieceOf(id)
    const { job, piece: jobPiece } = textJob(ck, piece.pixels, piece.words)
    expect(job.setting).toBe('hybrid')
    const deps = { ck, files, model, fonts: FIXTURE_FONTS }
    const hybrid = await matchTextWithFace(job, jobPiece, deps)
    expect(await matchTextWithFace(job, jobPiece, deps)).toEqual(hybrid)
    // Light gives each round trip back in its drawn face (above).
    expect(hybrid.face && fontKey(hybrid.face)).toBe(piece.key)
    if (id === HYBRID_PICTURE) {
      // The finer fit finds the 3 px outline drawn, and the colour guard then fails.
      expect(hybrid.answer).toMatchObject({ kind: 'picture', why: 'looksDifferent' })
      expect(hybrid.answer.scores?.inkColour).toBeGreaterThan(LOOKS_SAME.text.inkColour)
      return
    }
    const { style } = textLayerOf(hybrid.answer).props
    expect(Math.abs(style.fontSize / piece.size - 1)).toBeLessThan(SIZE_WITHIN)
  })

  it('keeps a piece of noise a picture, as it looks different', async () => {
    const answer = await matchTwice(noisePiece(), NOISE_WORDS)
    expect(answer).toMatchObject({ kind: 'picture', why: 'looksDifferent' })
  })

  it('keeps a piece a picture, as it failed, when the font source gives none of its faces', async () => {
    const piece = pieceOf('latin-plain')
    const { job, piece: jobPiece } = textJob(ck, piece.pixels, piece.words)
    const answer = await matchText(job, jobPiece, { ck, files, model, fonts: { face: async () => null } })
    expect(answer).toEqual({ kind: 'picture', why: 'failed' })
  })

  it('keeps a piece a picture when no font draws one of its characters', async () => {
    const piece = pieceOf('latin-plain')
    const answer = await matchTwice(piece.pixels, `${piece.words} 𓂀`)
    expect(answer).toEqual({ kind: 'picture', why: 'noFont' })
  })

  it.each([
    ['hybrid', TEXT_STEPS],
    ['light', ['reading', 'shortlist', 'fitting']],
  ] as const)('tells each step of %s as it starts, and answers as untold', async (setting, steps) => {
    const piece = pieceOf('latin-plain')
    const { job, piece: jobPiece } = textJob(ck, piece.pixels, piece.words, { setting })
    const told: TextStep[] = []
    const deps = { ck, files, model, fonts: FIXTURE_FONTS }
    const answer = await matchText(job, jobPiece, { ...deps, step: (step) => told.push(step) })
    expect(told).toEqual(steps)
    expect(await matchText(job, jobPiece, deps)).toEqual(answer)
  })
})

describe('matchTextWithFace', () => {
  it('gives the face it picked with its answer, also when the piece stays a picture', async () => {
    const { job, piece } = textJob(ck, noisePiece(), NOISE_WORDS)
    const { answer, face } = await matchTextWithFace(job, piece, { ck, files, model, fonts: FIXTURE_FONTS })
    expect(answer).toMatchObject({ kind: 'picture', why: 'looksDifferent' })
    expect(face).toEqual({ family: expect.any(String), weight: expect.any(Number), style: expect.any(String) })
    expect(answer).toEqual(await matchText(job, piece, { ck, files, model, fonts: FIXTURE_FONTS }))
  })
})
