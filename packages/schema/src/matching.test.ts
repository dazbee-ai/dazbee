import { describe, expect, it } from 'vitest'
import type { z } from 'zod'

import { MatchAnswer, MatchJob, MatchKit, MAX_MATCH_PICTURE_BYTES, Piece } from './matching.ts'

/** A PNG's signature and header for a picture of this size, padded with zeros to `bytes`. */
const pngOf = (width: number, height: number, bytes = 64) => {
  const png = new Uint8Array(bytes)
  const view = new DataView(png.buffer)
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52])
  view.setUint32(16, width)
  view.setUint32(20, height)
  return Buffer.from(png).toString('base64')
}

const KIT = {
  colors: { primary: '#E03024FF' },
  fonts: { heading: 'Work Sans', body: 'Inter' },
  textStyles: [],
}

const TEXT_PIECE = { kind: 'text', rect: { x: 10, y: 10, width: 380, height: 60 }, words: 'Summer sale\n50% off' }
const SHAPE_PIECE = { kind: 'shape', rect: { x: 0, y: 100, width: 400, height: 100 } }

/** A job for shapes, which gives no backgrounds. */
const SHAPES_JOB = { picture: pngOf(400, 200), pieces: [SHAPE_PIECE], kit: KIT }
const JOB = { ...SHAPES_JOB, backgrounds: [[255, 255, 255]], pieces: [TEXT_PIECE, SHAPE_PIECE] }

const issues = (schema: z.ZodType, value: unknown) =>
  schema.safeParse(value).error?.issues.map((issue) => issue.path.join('.')) ?? []

const SCORES = { ssim: 0.93, inkMissed: 0.02, far: 0.4, inkColour: 3.1 }

const TEXT_LAYER = {
  type: 'text',
  name: 'Summer sale',
  props: {
    x: 10,
    y: 10,
    width: 380,
    height: 60,
    text: 'Summer sale',
    style: { fontFamily: 'Work Sans', fontWeight: 700, fontSize: 48, color: '#E03024FF' },
  },
}

describe('Piece', () => {
  it('keeps a text piece’s words as given, and refuses a text piece without words', () => {
    const words = '  Two\nlines  '
    expect(Piece.parse({ ...TEXT_PIECE, words })).toMatchObject({ words })
    const noWords = { kind: 'text', rect: TEXT_PIECE.rect }
    expect(issues(Piece, noWords)).toEqual(['words'])
    expect(issues(Piece, { ...noWords, words: ' \n ' })).toEqual(['words'])
    expect(issues(Piece, SHAPE_PIECE)).toEqual([])
  })
})

describe('MatchKit', () => {
  it('refuses more colours than a kit holds', () => {
    const colors = Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`colour-${i}`, '#000000FF']))
    expect(issues(MatchKit, KIT)).toEqual([])
    expect(issues(MatchKit, { ...KIT, colors })).toEqual(['colors'])
  })
})

describe('MatchJob', () => {
  it('takes a picture, its pieces and the kit, Hybrid when no setting is given', () => {
    const job = MatchJob.parse(JOB)
    expect(job.setting).toBe('hybrid')
    expect(job.pieces[0]).toEqual(TEXT_PIECE)
    expect(MatchJob.parse({ ...JOB, setting: 'light' }).setting).toBe('light')
  })

  it('refuses a rect that leaves the picture', () => {
    const rect = (x: number, y: number, width: number, height: number) => ({
      ...JOB,
      pieces: [SHAPE_PIECE, { kind: 'shape', rect: { x, y, width, height } }],
    })
    expect(issues(MatchJob, rect(0, 0, 400, 200))).toEqual([])
    expect(issues(MatchJob, rect(1, 0, 400, 200))).toEqual(['pieces.1.rect'])
    expect(issues(MatchJob, rect(0, 150, 10, 51))).toEqual(['pieces.1.rect'])
    expect(issues(MatchJob, rect(-1, 0, 10, 10))).toEqual(['pieces.1.rect.x'])
    expect(issues(MatchJob, rect(0, 0, 0, 10))).toEqual(['pieces.1.rect.width'])
  })

  it('refuses a picture over 8 MB once decoded, over 2048 px on its long side, or not a PNG', () => {
    expect(issues(MatchJob, { ...JOB, picture: pngOf(400, 200, MAX_MATCH_PICTURE_BYTES) })).toEqual([])
    expect(issues(MatchJob, { ...JOB, picture: pngOf(400, 200, MAX_MATCH_PICTURE_BYTES + 1) })).toEqual(['picture'])
    expect(issues(MatchJob, { ...JOB, picture: pngOf(2048, 200) })).toEqual([])
    expect(issues(MatchJob, { ...JOB, picture: pngOf(400, 2049) })).toEqual(['picture'])
    expect(issues(MatchJob, { ...JOB, picture: Buffer.from('GIF89a and more bytes here').toString('base64') })).toEqual(
      ['picture'],
    )
    expect(issues(MatchJob, { ...JOB, picture: 'not base64!' })).toEqual(['picture'])
  })

  it('takes what other layers hide as one bit a pixel of the picture, and refuses a mask of another size', () => {
    // 400 × 200 pixels are 80 000 bits, 10 000 bytes.
    const bits = (bytes: number) => Buffer.from(new Uint8Array(bytes).fill(0xf0)).toString('base64')
    expect(MatchJob.parse({ ...SHAPES_JOB, hidden: bits(10_000) }).hidden).toBe(bits(10_000))
    expect(MatchJob.parse(SHAPES_JOB).hidden).toBeUndefined()
    expect(issues(MatchJob, { ...SHAPES_JOB, hidden: bits(9_999) })).toEqual(['hidden'])
    expect(issues(MatchJob, { ...SHAPES_JOB, hidden: bits(10_001) })).toEqual(['hidden'])
    expect(issues(MatchJob, { ...SHAPES_JOB, hidden: '' })).toEqual(['hidden'])
    expect(issues(MatchJob, { ...SHAPES_JOB, hidden: 'not base64!' })).toEqual(['hidden'])
    // A picture whose pixels are no whole number of bytes takes the bits rounded up to one.
    const odd = {
      ...SHAPES_JOB,
      picture: pngOf(5, 3),
      pieces: [{ kind: 'shape', rect: { x: 0, y: 0, width: 5, height: 3 } }],
    }
    expect(issues(MatchJob, { ...odd, hidden: bits(2) })).toEqual([])
    expect(issues(MatchJob, { ...odd, hidden: bits(1) })).toEqual(['hidden'])
  })

  it('takes up to 4 background colours, and none for shapes', () => {
    expect(issues(MatchJob, SHAPES_JOB)).toEqual([])
    const white = [255, 255, 255]
    expect(issues(MatchJob, { ...JOB, backgrounds: [white, white, white, white] })).toEqual([])
    expect(issues(MatchJob, { ...JOB, backgrounds: [white, white, white, white, white] })).toEqual(['backgrounds'])
    expect(issues(MatchJob, { ...JOB, backgrounds: [[256, 0, 0]] })).toEqual(['backgrounds.0.0'])
  })
})

describe('MatchAnswer', () => {
  it('gives layers that parse as unplaced layers, with the rule’s scores', () => {
    const answer = MatchAnswer.parse({ kind: 'layers', layers: [TEXT_LAYER], scores: SCORES, approximate: false })
    expect(answer.kind === 'layers' && answer.layers[0]?.props).toMatchObject({ rotation: 0, visible: true })
    expect(
      issues(MatchAnswer, {
        kind: 'layers',
        layers: [{ ...TEXT_LAYER, type: 'picture' }],
        scores: SCORES,
        approximate: false,
      }),
    ).toEqual(['layers.0.type'])
    expect(issues(MatchAnswer, { kind: 'layers', layers: [], scores: SCORES, approximate: false })).toEqual(['layers'])
  })

  it('takes a shape’s scores as the far share alone, and refuses scores without it', () => {
    const layers = { kind: 'layers', layers: [TEXT_LAYER], approximate: false }
    expect(MatchAnswer.parse({ ...layers, scores: { far: 0.004 } })).toMatchObject({ scores: { far: 0.004 } })
    expect(MatchAnswer.parse({ kind: 'picture', why: 'looksDifferent', scores: { far: 0.3 } })).toMatchObject({
      scores: { far: 0.3 },
    })
    expect(issues(MatchAnswer, { ...layers, scores: { ssim: 0.9, inkMissed: 0 } })).toEqual(['scores.far'])
  })

  it('says whether the layers are approximate, as they don’t look the same', () => {
    expect(
      MatchAnswer.parse({ kind: 'layers', layers: [TEXT_LAYER], scores: SCORES, approximate: true }),
    ).toMatchObject({ approximate: true })
    expect(issues(MatchAnswer, { kind: 'layers', layers: [TEXT_LAYER], scores: SCORES })).toEqual(['approximate'])
  })

  it('says why a piece stays a picture, and refuses an unknown why', () => {
    expect(MatchAnswer.parse({ kind: 'picture', why: 'looksDifferent', scores: SCORES })).toMatchObject({
      why: 'looksDifferent',
    })
    expect(issues(MatchAnswer, { kind: 'picture', why: 'failed' })).toEqual([])
    expect(issues(MatchAnswer, { kind: 'picture', why: 'tooUgly' })).toEqual(['why'])
    expect(issues(MatchAnswer, { kind: 'picture', why: 'noFont' })).toEqual(['why'])
  })

  it('says a piece stays a picture because this browser can’t run the matchers', () => {
    expect(MatchAnswer.parse({ kind: 'picture', why: 'unsupported' })).toEqual({ kind: 'picture', why: 'unsupported' })
  })
})
