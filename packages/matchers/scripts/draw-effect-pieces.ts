// Draws the effect set, the text pieces with text effects the text matcher is measured on, with
// Dazbee's renderer, into a folder outside the repo: a PNG a piece and `truth.json`, each piece's
// words, face, size and effect, the first half for development and the second held out. Each piece
// has a plain twin (`p` for `e`), the same words in the same look drawn straight, which an effect
// piece's time is set against.
//   node scripts/draw-effect-pieces.ts <google/fonts checkout> <folder>
// Curved pieces: 15 of each shape, amounts spread from 10 to 100, one or two lines, each in a catalog
// face that draws its words (not a face the shortlist passes over or one that draws only capitals),
// its words from the list below, its size and colours picked, all from one fixed seed.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { renderPixels } from '@dazbee/renderer'
import { loadCanvasKit } from '@dazbee/renderer/node'
import { type TextCurve, TextProps } from '@dazbee/schema'

import { textDrawer, textLayerProps, type TextLook } from '../src/text/draw-text.ts'
import { parseFontKey } from '../src/text/font-key.ts'
import { coversByIndex, readTextFiles, TEXT_FILES, type TextFileBytes } from '../src/text/text-files.ts'
import { fetchFiles, FILES_DIR } from './fetch-files.ts'
import { googleFaceFile } from './google-face-file.ts'
import type { EffectSetTruth } from './text-measure-pieces.ts'

/** The curve's shapes, a piece of each in turn. */
const SHAPES: readonly TextCurve['shape'][] = ['arcUp', 'arcDown', 'circle', 'wave']
/** Pieces of each shape. */
const PER_SHAPE = 15
/** The least and most amount drawn. */
const AMOUNTS = { min: 10, max: 100 }
/** The words a one-line piece says. */
const ONE_LINE = [
  'Fresh Bakery',
  'Summer Sale',
  'Open Every Day',
  'Handmade with Love',
  'Best Coffee in Town',
  'Free Delivery',
  'Grand Opening',
  'Limited Edition',
  'Join the Club',
  'Organic Farm',
  'Kids Party Time',
  'Weekend Market',
  'Since 1987',
  'Hot Pizza',
  'Stay Wild',
]
/** The words a two-line piece says, a line each. */
const TWO_LINES = [
  'Fresh Bakery\nSince 1987',
  'Summer\nSale',
  'Coffee Club\nMembers Only',
  'Happy\nBirthday',
  'Organic\nFarm Shop',
  'Game Night\nEvery Friday',
  'Best Burgers\nIn Town',
  'Pet Care\nand Grooming',
]
/** Every third piece has two lines. */
const TWO_LINE_EVERY = 3
/** The sizes drawn, in pixels. */
const SIZES = { min: 36, max: 84 }
/** The colours a piece is drawn in and on. */
const COLOURS: readonly { text: string; background: string }[] = [
  { text: '#1B1B1F', background: '#FFFFFF' },
  { text: '#FFFFFF', background: '#1D3557' },
  { text: '#E63946', background: '#F1FAEE' },
  { text: '#2A2A2A', background: '#FFD166' },
  { text: '#FDF0D5', background: '#780000' },
  { text: '#003049', background: '#EAE2B7' },
]
/** The seed every pick is drawn from. */
const SEED = 230
/** The pixels round a piece's box. */
const MARGIN = 24

const [checkout, out] = process.argv.slice(2)
if (!checkout || !out) {
  console.error('Usage: node scripts/draw-effect-pieces.ts <google/fonts checkout> <folder>')
  process.exit(1)
}
const ck = await loadCanvasKit()
await fetchFiles()
const files = readTextFiles(
  Object.fromEntries(
    TEXT_FILES.map((name) => [name, new Uint8Array(readFileSync(join(FILES_DIR, name)))]),
  ) as TextFileBytes,
)
const capitals = new Set(
  (JSON.parse(readFileSync(join(FILES_DIR, 'text-face-kinds.json'), 'utf8')) as { capitals: string[] }).capitals,
)
const random = mulberry32(SEED)
const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)] as T
const total = SHAPES.length * PER_SHAPE
// Each shape's amounts spread evenly from the least to the most, in a seeded order.
const amounts = SHAPES.map(() =>
  shuffled(
    Array.from({ length: PER_SHAPE }, (_, i) => AMOUNTS.min + ((AMOUNTS.max - AMOUNTS.min) * i) / (PER_SHAPE - 1)),
    random,
  ),
)
mkdirSync(out, { recursive: true })
const truths: EffectSetTruth[] = []
for (let i = 0; i < total; i++) {
  const shapeIndex = i % SHAPES.length
  const shape = SHAPES[shapeIndex] as TextCurve['shape']
  const amount = Math.round(amounts[shapeIndex]?.[Math.floor(i / SHAPES.length)] ?? AMOUNTS.min)
  const words = i % TWO_LINE_EVERY === TWO_LINE_EVERY - 1 ? pick(TWO_LINES) : pick(ONE_LINE)
  const { key, bytes } = faceFor(words)
  const face = parseFontKey(key)
  if (!face) throw new Error(`${key} is not a font key`)
  const size = Math.round(SIZES.min + random() * (SIZES.max - SIZES.min))
  const colours = pick(COLOURS)
  const look: TextLook = {
    ...face,
    size,
    spacing: 0,
    align: 'center',
    color: `${colours.text}FF`,
    curve: { shape, amount },
  }
  const number = String(i + 1).padStart(2, '0')
  const part = i < total / 2 ? 'dev' : 'test'
  writeFileSync(join(out, `e${number}.png`), drawn(look, words, { family: face.family, bytes }, colours.background))
  truths.push({
    id: `e${number}`,
    part,
    effect: 'curve',
    text: words,
    family: face.family,
    face: key,
    size,
    curve: { shape, amount },
  })
  // Its plain twin: the same words in the same look, straight, to time the matcher against.
  const plain: TextLook = { ...look }
  delete plain.curve
  writeFileSync(join(out, `p${number}.png`), drawn(plain, words, { family: face.family, bytes }, colours.background))
  truths.push({ id: `p${number}`, part, effect: 'none', text: words, family: face.family, face: key, size })
  console.log(`e${number}  ${shape} ${amount}  ${key}  ${size} px  ${JSON.stringify(words)}`)
}
writeFileSync(join(out, 'truth.json'), JSON.stringify(truths, null, 1))

/** Numbers from 0 to 1, the same for a seed in every runtime: mulberry32. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32
  }
}

/** The list in a random order drawn from `random`. */
function shuffled<T>(list: T[], random: () => number): T[] {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[list[i], list[j]] = [list[j] as T, list[i] as T]
  }
  return list
}

/** A face picked at random from the catalog's faces that draw the words, and its bytes. */
function faceFor(words: string): { key: string; bytes: Uint8Array } {
  for (;;) {
    const row = Math.floor(random() * files.keys.length)
    const key = files.keys[row] as string
    if (files.neverListed.has(row) || capitals.has(key) || !files.scripts[row]?.has('latin')) continue
    if (coversByIndex(files, row, words) === false) continue
    const path = googleFaceFile(checkout as string, key)?.path
    if (path) return { key, bytes: new Uint8Array(readFileSync(path)) }
  }
}

/** The words in the look, drawn on a flat colour with a margin round their box, as a PNG. */
function drawn(look: TextLook, words: string, face: { family: string; bytes: Uint8Array }, background: string) {
  const drawer = textDrawer(ck, [face])
  const box = drawer.measure(words, look)
  drawer.delete()
  const width = Math.ceil(box.width) + 2 * MARGIN
  const height = Math.ceil(box.height) + 2 * MARGIN
  const props = TextProps.parse(textLayerProps(words, look, { x: MARGIN, y: MARGIN, ...box, rotation: 0 }))
  const design = {
    meta: { designId: 'effect-piece', name: 'Effect piece' },
    pages: { p: { name: 'Page', order: 'a0' } },
    frames: {
      f: {
        pageId: 'p',
        name: 'Piece',
        width,
        height,
        x: 0,
        y: 0,
        fills: [{ type: 'solid', color: `${background}FF` }],
        order: 'a0',
      },
    },
    nodes: { t: { type: 'text', parentId: 'f', link: 't', index: 'a0', name: 'Words', props } },
  }
  const pixels = renderPixels(ck, design, 'f', { fonts: [face], fallbackFamilies: [], images: {} })
  const image = ck.MakeImage(
    {
      width,
      height,
      colorType: ck.ColorType.RGBA_8888,
      alphaType: ck.AlphaType.Unpremul,
      colorSpace: ck.ColorSpace.SRGB,
    },
    pixels.pixels,
    width * 4,
  )
  const png = image?.encodeToBytes()
  image?.delete()
  if (!png) throw new Error('CanvasKit could not encode a piece')
  return png
}
