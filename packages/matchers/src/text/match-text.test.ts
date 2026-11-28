import { describe, expect, it } from 'vitest'

import type { Pixels } from '@dazbee/renderer'
import { loadCanvasKit } from '@dazbee/renderer/node'
import type { MatchAnswer, MatchSetting, TextCurve } from '@dazbee/schema'

import { textDrawer } from './draw-text.ts'
import { fontKey, parseFontKey } from './font-key.ts'
import type { FontSource } from './font-source.ts'
import { spacedApart } from './light/letters-apart.ts'
import { closeness } from './light/verify.ts'
import { matchText, matchTextWithFace, TEXT_STEPS, type TextStep } from './match-text.ts'
import { readPiece } from './read-piece.ts'
import { textMatcherFiles } from './test-text-files.ts'
import {
  blankPiece,
  drawText,
  lightFonts,
  type LightPiece,
  lightPieces,
  NOISE_WORDS,
  noisePiece,
  shippedFaces,
  textJob,
  textLayerOf,
} from './test-text-pieces.ts'

const ck = await loadCanvasKit()
const { files, model } = await textMatcherFiles()
const fonts = lightFonts()
const pieces = lightPieces(ck, fonts)
const shipped = shippedFaces()

/** The faces of Light's test, cut to its characters, and the shipped faces; none for any other key. */
const FIXTURE_FONTS: FontSource = { face: async (key) => fonts.get(key) ?? shipped.get(key) ?? null }
/** A character no face of the catalog draws. */
const UNDRAWN = '𓂀'

/** A size found within this share of the size drawn comes back right. */
const SIZE_WITHIN = 0.03
/** Letter spacing found within this many points of the spacing drawn comes back right. */
const SPACING_WITHIN = 3
/** The tightest spacing at which letters stay apart is found within this many points either way. */
const TIGHTEST_WITHIN = 0.5

/** The pieces of Light's test that are round trips. */
const ROUND_TRIPS = [
  'latin-plain',
  'latin-outlined',
  'latin-tilted',
  'latin-tight',
  'latin-loose',
  'latin-hollow',
  'latin-hollow-italic',
  'arabic-plain',
  'arabic-outlined',
  'arabic-tilted',
  'devanagari-plain',
  'devanagari-tilted',
  'devanagari-loose',
]

/** The round trips drawn hollow: an outline alone, with no fill. */
const HOLLOW = ['latin-hollow', 'latin-hollow-italic']
/** An outline width found within this many pixels of the width drawn comes back right. */
const OUTLINE_WITHIN = 1

/** The round trip whose words and face are drawn along each curve. */
const CURVED_FROM = 'latin-tilted'
/** The curves it is drawn along. */
const CURVES: readonly TextCurve[] = [
  { shape: 'arcUp', amount: 50 },
  { shape: 'arcDown', amount: 40 },
  { shape: 'circle', amount: 40 },
  { shape: 'wave', amount: 60 },
]
/** A curve's amount found within this many points of the amount drawn comes back right. */
const AMOUNT_WITHIN = 10

/** Round trips drawn with a stretch of their words in another colour: a cut-out's last word, and a flat crop's last letter. */
const TWO_COLOURS = [
  { id: 'latin-tilted', what: 'its last word', start: 11, end: 15, colour: '#1565C0' },
  { id: 'latin-plain', what: 'its last letter', start: 20, end: 21, colour: '#E53935' },
] as const

/** The round trip whose finer fit looks different in Hybrid, so Hybrid gives Light's answer. */
const LIGHT_KEPT = 'arabic-outlined'
/** A round trip whose finer fit moves and still looks the same in Hybrid. */
const FINER_KEPT = 'latin-plain'

/** A piece matched twice in a setting, Light unless named, which must give the same answer. */
async function matchTwice(pixels: Pixels, words: string, setting: MatchSetting = 'light'): Promise<MatchAnswer> {
  const { job, piece } = textJob(ck, pixels, words, { setting })
  const deps = { ck, files, model, fonts: FIXTURE_FONTS }
  const first = await matchText(job, piece, deps)
  expect(await matchText(job, piece, deps)).toEqual(first)
  return first
}

/** The closeness the rule's scores give an answer's layers. */
function closenessOf(answer: MatchAnswer): number {
  if (answer.kind !== 'layers') throw new Error(`a picture: ${answer.why}`)
  return closeness(answer.scores)
}

/** A piece of Light's test matched once in Light and once in Hybrid. */
async function lightAndHybrid(id: string): Promise<{ light: MatchAnswer; hybrid: MatchAnswer }> {
  const piece = pieceOf(id)
  const deps = { ck, files, model, fonts: FIXTURE_FONTS }
  const answerIn = async (setting: MatchSetting) => {
    const { job, piece: jobPiece } = textJob(ck, piece.pixels, piece.words, { setting })
    return matchText(job, jobPiece, deps)
  }
  return { light: await answerIn('light'), hybrid: await answerIn('hybrid') }
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
    const answer = await matchTwice(piece.pixels, piece.words)
    expect(answer).toMatchObject({ kind: 'layers', approximate: false })
    const { style, text, rotation, runs } = textLayerOf(answer).props
    expect(`${style.fontFamily}|${style.fontWeight}|${style.fontStyle}`).toBe(piece.key)
    expect(Math.abs(style.fontSize / piece.size - 1)).toBeLessThan(SIZE_WITHIN)
    expect(text).toBe(piece.words)
    expect(runs).toEqual([])
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
    expect(hybrid.answer).toMatchObject({ kind: 'layers', approximate: false })
    const { style } = textLayerOf(hybrid.answer).props
    expect(Math.abs(style.fontSize / piece.size - 1)).toBeLessThan(SIZE_WITHIN)
  })

  it.each(HOLLOW.flatMap((id) => (['light', 'hybrid'] as const).map((setting) => [id, setting] as const)))(
    'gives %s back hollow in %s: no fill, and an outline in its colour and width',
    async (id, setting) => {
      const piece = pieceOf(id)
      const answer = await matchTwice(piece.pixels, piece.words, setting)
      expect(answer).toMatchObject({ kind: 'layers', approximate: false })
      const { style } = textLayerOf(answer).props
      expect(`${style.fontFamily}|${style.fontWeight}|${style.fontStyle}`).toBe(piece.key)
      expect(style.color.slice(7)).toBe('00')
      expect(style.outline?.color).toBe(`${piece.outline?.color}FF`)
      expect(Math.abs((style.outline?.width ?? 0) - (piece.outline?.width ?? 0))).toBeLessThanOrEqual(OUTLINE_WITHIN)
    },
  )

  it.each(CURVES)('gives text along $shape at $amount back curved in its face, its amount within 10', async (curve) => {
    const drawing = pieceOf(CURVED_FROM)
    const face = parseFontKey(drawing.key)
    const bytes = fonts.get(drawing.key)
    if (!face || !bytes) throw new Error(`no face ${drawing.key}`)
    const pixels = drawText(ck, { ...drawing, ...face, rotation: 0, curve }, [{ family: face.family, bytes }])
    const answer = await matchTwice(pixels, drawing.words)
    const { style, curve: found } = textLayerOf(answer).props
    expect(`${style.fontFamily}|${style.fontWeight}|${style.fontStyle}`).toBe(drawing.key)
    expect(found?.shape).toBe(curve.shape)
    expect(Math.abs((found?.amount ?? 0) - curve.amount)).toBeLessThanOrEqual(AMOUNT_WITHIN)
  })

  it.each(TWO_COLOURS)(
    'gives $id drawn with $what in another colour back with that stretch as a run in its colour',
    async ({ id, start, end, colour }) => {
      const drawing = pieceOf(id)
      const face = parseFontKey(drawing.key)
      const bytes = fonts.get(drawing.key)
      if (!face || !bytes) throw new Error(`no face ${drawing.key}`)
      const drawn = { ...drawing, ...face, runs: [{ start, end, colour }] }
      const answer = await matchTwice(drawText(ck, drawn, [{ family: face.family, bytes }]), drawing.words, 'hybrid')
      expect(answer).toMatchObject({ kind: 'layers', approximate: false })
      const { style, runs } = textLayerOf(answer).props
      expect(`${style.fontFamily}|${style.fontWeight}|${style.fontStyle}`).toBe(drawing.key)
      expect(style.color).toBe(`${drawing.colour}FF`)
      expect(runs).toEqual([{ start, end, style: { color: `${colour}FF` } }])
    },
  )

  it('gives thin letters that read as hollow back filled when, as drawn, they look the same', async () => {
    const words = 'BOB'
    const pixels = drawText(ck, {
      words,
      family: 'Noto Sans',
      weight: 400,
      size: 48,
      colour: '#222222',
      background: '#FFFFFF',
    })
    // Every stroke of a thin B or O edges a counter, so the letters read as hollow.
    expect(readPiece({ pixels, words }).whole.fill).toBeNull()
    const noto = shipped.get('Noto Sans|400|normal') ?? null
    const { job, piece } = textJob(ck, pixels, words)
    const answer = await matchText(job, piece, { ck, files, model, fonts: { face: async () => noto } })
    expect(answer).toMatchObject({ kind: 'layers', approximate: false })
    const { style } = textLayerOf(answer).props
    expect(style.color).toBe('#222222FF')
    expect(style.outline).toBeUndefined()
  })

  it("keeps letters apart when that looks the same, else spaces them as tight as the picture's own letters that run into each other", async () => {
    const words = 'MAXIMUM'
    const face = { family: 'Noto Sans', weight: 800, style: 'normal' as const }
    const spacing = -15
    const pixels = drawText(ck, { words, ...face, size: 60, spacing, colour: '#222222', background: '#FFFFFF' })
    const bytes = shipped.get(fontKey(face)) ?? null
    const drawer = textDrawer(ck, [{ family: face.family, bytes: bytes ?? new Uint8Array() }])
    const look = { ...face, size: 60, spacing, align: 'start' as const, color: '#222222FF' as const }
    const tightest = spacedApart(drawer, words, look).spacing
    drawer.delete()
    expect(tightest).toBeGreaterThan(spacing + SPACING_WITHIN)
    const deps = { ck, files, model, fonts: { face: async () => bytes } }
    const spacingIn = async (setting: MatchSetting) => {
      const { job, piece } = textJob(ck, pixels, words, { setting })
      const answer = await matchText(job, piece, deps)
      expect(answer).toMatchObject({ kind: 'layers', approximate: false })
      return textLayerOf(answer).props.style.letterSpacing.value
    }
    // Hybrid's finer fit makes the letters apart look the same; Light's fit spaced apart doesn't.
    expect(await spacingIn('hybrid')).toBeGreaterThanOrEqual(tightest - TIGHTEST_WITHIN)
    expect(Math.abs((await spacingIn('light')) - spacing)).toBeLessThan(SPACING_WITHIN)
  })

  it("gives Light's answer in Hybrid when the finer fit looks different and Light's looks the same", async () => {
    const { light, hybrid } = await lightAndHybrid(LIGHT_KEPT)
    expect(light.kind).toBe('layers')
    expect(hybrid).toEqual(light)
  })

  it('keeps the finer fit in Hybrid when it looks the same', async () => {
    const { light, hybrid } = await lightAndHybrid(FINER_KEPT)
    expect(hybrid.kind).toBe('layers')
    expect(hybrid).not.toEqual(light)
  })

  it('gives a piece of noise as approximate text in the closest shortlisted face', async () => {
    const answer = await matchTwice(noisePiece(), NOISE_WORDS)
    expect(answer).toMatchObject({ kind: 'layers', approximate: true })
    const { style, text } = textLayerOf(answer).props
    expect(text).toBe(NOISE_WORDS)
    expect(fonts.has(`${style.fontFamily}|${style.fontWeight}|${style.fontStyle}`)).toBe(true)
  })

  it('gives the closer of Light’s and the finer fit’s answers in Hybrid when neither looks the same', async () => {
    const { job, piece } = textJob(ck, noisePiece(), NOISE_WORDS, { setting: 'light' })
    const deps = { ck, files, model, fonts: FIXTURE_FONTS }
    const light = await matchText(job, piece, deps)
    const hybrid = await matchText({ ...job, setting: 'hybrid' }, piece, deps)
    expect(hybrid).toMatchObject({ kind: 'layers', approximate: true })
    expect(closenessOf(hybrid)).toBeGreaterThanOrEqual(closenessOf(light))
  })

  it.each([
    ['latin-plain', 'Noto Sans'],
    ['arabic-plain', 'Noto Naskh Arabic'],
  ])('sets %s in %s, approximate, when no face of the catalog draws one of its characters', async (id, family) => {
    const piece = pieceOf(id)
    const words = `${piece.words} ${UNDRAWN}`
    const answer = await matchTwice(piece.pixels, words, 'hybrid')
    expect(answer).toMatchObject({ kind: 'layers', approximate: true })
    const { style, text } = textLayerOf(answer).props
    expect(style.fontFamily).toBe(family)
    expect(text).toBe(words)
  })

  it.each([
    ['shortlisted faces', `${pieceOf('latin-plain').words}`],
    ['Noto faces', `${pieceOf('latin-plain').words} ${UNDRAWN}`],
  ])('keeps a piece a picture, as it failed, when the font source gives none of its %s', async (_, words) => {
    const { job, piece } = textJob(ck, pieceOf('latin-plain').pixels, words)
    const answer = await matchText(job, piece, { ck, files, model, fonts: { face: async () => null } })
    expect(answer).toEqual({ kind: 'picture', why: 'failed' })
  })

  it('keeps a piece with no ink a picture, as it failed', async () => {
    expect(await matchTwice(blankPiece(), NOISE_WORDS, 'hybrid')).toEqual({ kind: 'picture', why: 'failed' })
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
  it('gives the face it set the text in with its answer, also when the text is approximate', async () => {
    const { job, piece } = textJob(ck, noisePiece(), NOISE_WORDS)
    const { answer, face } = await matchTextWithFace(job, piece, { ck, files, model, fonts: FIXTURE_FONTS })
    const { style } = textLayerOf(answer).props
    expect(answer).toMatchObject({ kind: 'layers', approximate: true })
    expect(face).toEqual({ family: style.fontFamily, weight: style.fontWeight, style: style.fontStyle })
    expect(answer).toEqual(await matchText(job, piece, { ck, files, model, fonts: FIXTURE_FONTS }))
  })
})
