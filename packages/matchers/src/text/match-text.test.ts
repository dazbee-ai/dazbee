import { describe, expect, it } from 'vitest'

import type { Pixels } from '@dazbee/renderer'
import { loadCanvasKit } from '@dazbee/renderer/node'
import type { MatchAnswer, MatchSetting, UnplacedLayer } from '@dazbee/schema'

import type { FontSource } from './font-source.ts'
import { matchText } from './match-text.ts'
import { textMatcherFiles } from './test-text-files.ts'
import { lightFonts, type LightPiece, lightPieces, NOISE_WORDS, noisePiece, textJob } from './test-text-pieces.ts'

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

/** The one text layer of an answer that looks the same. */
function textLayerOf(answer: MatchAnswer): Extract<UnplacedLayer, { type: 'text' }> {
  expect(answer.kind).toBe('layers')
  const layer = answer.kind === 'layers' ? answer.layers[0] : undefined
  if (layer?.type !== 'text') throw new Error('the answer is no text layer')
  return layer
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

  it.each(ROUND_TRIPS)('fits %s finer in Hybrid, the default, in the face Light picks', async (id) => {
    const piece = pieceOf(id)
    const { job, piece: jobPiece } = textJob(ck, piece.pixels, piece.words)
    expect(job.setting).toBe('hybrid')
    const deps = { ck, files, model, fonts: FIXTURE_FONTS }
    const hybrid = await matchText(job, jobPiece, deps)
    expect(await matchText(job, jobPiece, deps)).toEqual(hybrid)
    const light = textLayerOf(await matchText({ ...job, setting: 'light' }, jobPiece, deps)).props.style
    const { style } = textLayerOf(hybrid).props
    expect(`${style.fontFamily}|${style.fontWeight}|${style.fontStyle}`).toBe(
      `${light.fontFamily}|${light.fontWeight}|${light.fontStyle}`,
    )
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
})
