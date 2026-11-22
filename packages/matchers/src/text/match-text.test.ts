import { describe, expect, it } from 'vitest'

import type { Pixels } from '@dazbee/renderer'
import { loadCanvasKit } from '@dazbee/renderer/node'
import { type MatchAnswer, MatchJob } from '@dazbee/schema'

import type { FontSource } from './font-source.ts'
import { matchText, type TextPieceOfJob } from './match-text.ts'
import { textMatcherFiles } from './test-text-files.ts'
import { lightFonts, type LightPiece, lightPieces, NOISE_WORDS, noisePiece } from './test-text-pieces.ts'

const ck = await loadCanvasKit()
const { files, model } = await textMatcherFiles()
const fonts = lightFonts()
const pieces = lightPieces(ck, fonts)

/** The faces of Light's test, cut to its characters; none for any other key. */
const FIXTURE_FONTS: FontSource = { face: async (key) => fonts.get(key) ?? null }

/** A size found within this share of the size drawn comes back right. */
const SIZE_WITHIN = 0.03

/** A Light job of one text piece, the whole picture, saying `words`. */
function jobOf(pixels: Pixels, words: string): { job: MatchJob; piece: TextPieceOfJob } {
  const image = ck.MakeImage(
    {
      width: pixels.width,
      height: pixels.height,
      colorType: ck.ColorType.RGBA_8888,
      alphaType: ck.AlphaType.Unpremul,
      colorSpace: ck.ColorSpace.SRGB,
    },
    pixels.pixels,
    pixels.width * 4,
  )
  const png = image?.encodeToBytes()
  image?.delete()
  if (!png) throw new Error('CanvasKit could not encode the piece')
  const piece: TextPieceOfJob = {
    kind: 'text',
    rect: { x: 0, y: 0, width: pixels.width, height: pixels.height },
    words,
  }
  const job = MatchJob.parse({
    picture: Buffer.from(png).toString('base64'),
    pieces: [piece],
    kit: { colors: {}, fonts: {}, textStyles: [] },
    setting: 'light',
  })
  return { job, piece }
}

/** A piece matched twice, which must give the same answer. */
async function matchTwice(pixels: Pixels, words: string): Promise<MatchAnswer> {
  const { job, piece } = jobOf(pixels, words)
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
  it.each([
    'latin-plain',
    'latin-outlined',
    'latin-tilted',
    'latin-tight',
    'latin-loose',
    'arabic-plain',
    'arabic-outlined',
    'devanagari-plain',
    'devanagari-tilted',
  ])('gives %s back in its face and size as one text layer that looks the same', async (id) => {
    const piece = pieceOf(id)
    const answer = await matchTwice(piece.pixels, piece.words)
    expect(answer.kind).toBe('layers')
    const layer = answer.kind === 'layers' ? answer.layers[0] : undefined
    if (layer?.type !== 'text') throw new Error('the answer is no text layer')
    const { style, text, rotation } = layer.props
    expect(`${style.fontFamily}|${style.fontWeight}|${style.fontStyle}`).toBe(piece.key)
    expect(Math.abs(style.fontSize / piece.size - 1)).toBeLessThan(SIZE_WITHIN)
    expect(text).toBe(piece.words)
    expect(Math.abs(rotation - (piece.rotation ?? 0))).toBeLessThan(1)
    expect(Boolean(style.outline)).toBe(Boolean(piece.outline))
  })

  it('keeps a piece of noise a picture, as it looks different', async () => {
    const answer = await matchTwice(noisePiece(), NOISE_WORDS)
    expect(answer).toMatchObject({ kind: 'picture', why: 'looksDifferent' })
  })

  it('keeps a piece a picture when no font draws one of its characters', async () => {
    const piece = pieceOf('latin-plain')
    const answer = await matchTwice(piece.pixels, `${piece.words} 𓂀`)
    expect(answer).toEqual({ kind: 'picture', why: 'noFont' })
  })
})
