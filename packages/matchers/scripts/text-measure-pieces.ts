// The pieces the text measurement runs, read from folders outside the repo, each as a match job of
// its own picture: the 48 test ads in `TEST_ADS_DIR`, each piece seen on the colour behind it in its
// ad; and the test parts of the sets with known fonts, LICA in `LICA_DIR`, our own realistic set in
// `OWN_SET_DIR` and the synthetic set in `SYNTH_TEXT_DIR`, each a `truth.json` and a PNG a piece (with
// `-behind.png`, what is behind it, for those that have one), synthetic pieces with their brand kits;
// and the effect set in `EFFECT_SET_DIR` (`draw-effect-pieces.ts`), each piece with its effect.

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { CanvasKit } from '@dazbee/canvaskit'
import type { Pixels } from '@dazbee/renderer'
import { MatchJob, MatchKit, type Rgb, type TextCurve } from '@dazbee/schema'

import { decodePng } from '../src/shape/test-pieces.ts'
import { borderColour, median } from '../src/text/ink.ts'
import type { TextPieceOfJob } from '../src/text/match-text.ts'

/** A piece the measurement runs: the job that matches it, where it comes from and, in a set, its font. */
export interface MeasuredPiece {
  /** `ad<number>#<piece>` for a test ad's piece; the set's own id for a set's. */
  id: string
  /** Whether it is of the 16 held-out test ads (every third by name, from the third). */
  heldOut: boolean
  job: MatchJob
  piece: TextPieceOfJob
  /**
   * The family and face it is drawn in, in a set, `face` null when only the family is known; and in
   * the effect set, the curve it is drawn with.
   */
  truth?: { family: string; face: string | null; curve?: TextCurve }
}

/** A piece of the effect set as its `truth.json` holds it. */
export interface EffectTruth {
  id: string
  /** `dev`: the first half, which settings may be chosen on; `test`: the second, held out. */
  part: 'dev' | 'test'
  effect: 'curve'
  text: string
  family: string
  /** The face's key, `family|weight|style`. */
  face: string
  size: number
  curve: TextCurve
}

/** A set with known fonts. */
export type TestSet = 'lica' | 'own' | 'synthetic'

/** A test ad's pieces as its folder describes them. */
interface AdBlocks {
  source_size: [number, number]
  bucket: [number, number]
  blocks: {
    file: string
    rect: [number, number, number, number]
    rotated_box: { angle: number } | null
    element: string
    kind: string
  }[]
}

/** A piece of a set as its `truth.json` describes it. */
interface SetTruth {
  id: string
  part: string
  text: string
  family: string
  face: string | null
  angle?: number
  kit?: {
    colors: { token: string; value: string }[]
    fonts: { token: string; family: string }[]
    textStyles: Record<string, unknown>[]
  }
}

/** Each set's folder, by the variable that names it. */
export const SET_DIRS: Readonly<Record<TestSet, string>> = {
  lica: 'LICA_DIR',
  own: 'OWN_SET_DIR',
  synthetic: 'SYNTH_TEXT_DIR',
}

/** A pixel with alpha under this is see-through when the colour behind a piece is read. */
const SEE_THROUGH_BELOW = 13
/** The colour behind a piece is read from its see-through pixels when they are at least this share of it. */
const SEE_THROUGH_SHARE = 0.05
/** A job with no brand kit. */
const NO_KIT = { colors: {}, fonts: {}, textStyles: [] }

/** Every text piece of the test ads with a reading, in the ads' order by name. */
export function adPieces(ck: CanvasKit, dir: string): MeasuredPiece[] {
  const names = readdirSync(dir).sort()
  return names.flatMap((name, n) => {
    const folder = join(dir, name)
    const meta = JSON.parse(readFileSync(join(folder, 'blocks.json'), 'utf8')) as AdBlocks
    const readings = JSON.parse(readFileSync(join(folder, 'readings.json'), 'utf8')) as Record<string, { text: string }>
    const ad = decodePng(ck, new Uint8Array(readFileSync(join(folder, 'ad.png'))))
    const scale = meta.source_size[0] / meta.bucket[0]
    return meta.blocks.flatMap((block, index) => {
      const words = readings[block.element]?.text
      if (block.kind !== 'text' || !words) return []
      const png = new Uint8Array(readFileSync(join(folder, block.file)))
      const pixels = decodePng(ck, png)
      const background = colourBehind(pixels, behind(ad, block.rect, scale, pixels))
      return [
        {
          id: `ad${String(n + 1).padStart(2, '0')}#${index}`,
          heldOut: n % 3 === 2,
          ...jobOf(png, pixels, words, block.rotated_box?.angle ?? 0, [background], NO_KIT),
        },
      ]
    })
  })
}

/**
 * The test part of a set: LICA's pieces are flat crops with no tilt; our own's are seen on what is
 * behind them, at their tilt; synthetic ones on what is behind a cut-out, their tilt read, with their
 * brand kits.
 */
export function setPieces(ck: CanvasKit, set: TestSet, dir: string): MeasuredPiece[] {
  const truths = JSON.parse(readFileSync(join(dir, 'truth.json'), 'utf8')) as SetTruth[]
  return truths
    .filter((truth) => truth.part === 'test')
    .map((truth) => {
      const png = new Uint8Array(readFileSync(join(dir, `${truth.id}.png`)))
      const pixels = decodePng(ck, png)
      const behindFile = join(dir, `${truth.id}-behind.png`)
      const backgrounds =
        set !== 'lica' && existsSync(behindFile)
          ? [colourBehind(pixels, decodePng(ck, new Uint8Array(readFileSync(behindFile))))]
          : undefined
      const angle = set === 'lica' ? 0 : set === 'own' ? (truth.angle ?? 0) : undefined
      return {
        id: truth.id,
        heldOut: false,
        ...jobOf(png, pixels, truth.text, angle, backgrounds, truth.kit ? kitOf(truth.kit) : NO_KIT),
        truth: { family: truth.family, face: truth.face },
      }
    })
}

/**
 * The effect set's pieces, each on its flat colour with its tilt read and no brand kit: held out when
 * of its second half.
 */
export function effectPieces(ck: CanvasKit, dir: string): MeasuredPiece[] {
  const truths = JSON.parse(readFileSync(join(dir, 'truth.json'), 'utf8')) as EffectTruth[]
  return truths.map((truth) => {
    const png = new Uint8Array(readFileSync(join(dir, `${truth.id}.png`)))
    return {
      id: truth.id,
      heldOut: truth.part === 'test',
      ...jobOf(png, decodePng(ck, png), truth.text, undefined, undefined, NO_KIT),
      truth: { family: truth.family, face: truth.face, curve: truth.curve },
    }
  })
}

/** A job of one text piece, the whole picture. */
function jobOf(
  png: Uint8Array,
  pixels: Pixels,
  words: string,
  angle: number | undefined,
  backgrounds: Rgb[] | undefined,
  kit: unknown,
): { job: MatchJob; piece: TextPieceOfJob } {
  const piece: TextPieceOfJob = {
    kind: 'text',
    rect: { x: 0, y: 0, width: pixels.width, height: pixels.height },
    words,
    ...(angle === undefined ? {} : { angle }),
  }
  const job = MatchJob.parse({
    picture: Buffer.from(png).toString('base64'),
    ...(backgrounds ? { backgrounds } : {}),
    pieces: [piece],
    kit,
  })
  return { job, piece }
}

/** A set's brand kit as a match job holds it, each text style named by its token. */
function kitOf(kit: NonNullable<SetTruth['kit']>): MatchKit {
  return MatchKit.parse({
    colors: Object.fromEntries(kit.colors.map(({ token, value }) => [token, value])),
    fonts: Object.fromEntries(kit.fonts.map(({ token, family }) => [token, family])),
    textStyles: kit.textStyles.map((style) => ({ ...style, name: style.token })),
  })
}

/** The ad's pixels under a piece, one for each of the piece's pixels. */
function behind(ad: Pixels, rect: [number, number, number, number], scale: number, piece: Pixels): Pixels {
  const { width, height } = piece
  const pixels = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const sx = Math.min(ad.width - 1, Math.max(0, Math.floor((rect[0] + x + 0.5) * scale)))
      const sy = Math.min(ad.height - 1, Math.max(0, Math.floor((rect[1] + y + 0.5) * scale)))
      for (let c = 0; c < 4; c++) pixels[(y * width + x) * 4 + c] = ad.pixels[(sy * ad.width + sx) * 4 + c] ?? 0
    }
  return { width, height, pixels }
}

/** The median colour behind a piece where it is see-through; the border colour of what is behind it when too little is. */
function colourBehind(piece: Pixels, under: Pixels): Rgb {
  const r: number[] = []
  const g: number[] = []
  const b: number[] = []
  const n = piece.width * piece.height
  for (let i = 0; i < n; i++)
    if ((piece.pixels[i * 4 + 3] ?? 0) < SEE_THROUGH_BELOW) {
      r.push(under.pixels[i * 4] ?? 0)
      g.push(under.pixels[i * 4 + 1] ?? 0)
      b.push(under.pixels[i * 4 + 2] ?? 0)
    }
  if (r.length < n * SEE_THROUGH_SHARE) return borderColour(under)
  return [median(r), median(g), median(b)]
}
