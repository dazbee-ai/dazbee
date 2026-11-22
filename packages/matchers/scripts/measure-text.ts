// Measures the text matcher on the test ads, which stay outside the repo: every text piece of the 48
// ads in `TEST_ADS_DIR`, each as a match job of its own picture, seen on the colour behind it in its
// ad, with its faces loaded as match copies from a checkout of google/fonts at `GOOGLE_FONTS`'s
// commit. Prints how many look the same on the 16 held-out ads (every third by name, from the third)
// and on all 48, and each piece's face and numbers under a neutral id, `ad<number>#<piece>`:
//   TEST_ADS_DIR=<test ads> node scripts/measure-text.ts <google/fonts checkout> [answers.json]
// The answers, by the same ids, go to `answers.json` when it is named.

import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { CanvasKit } from '@dazbee/canvaskit'
import { GOOGLE_FONTS, googleFaces } from '@dazbee/fonts/google'
import { matchCopy } from '@dazbee/fonts/match-copy'
import type { Pixels } from '@dazbee/renderer'
import { loadCanvasKit } from '@dazbee/renderer/node'
import { type MatchAnswer, MatchJob, type Rgb } from '@dazbee/schema'

import { faceOfKey, parseFontKey } from '../src/text/font-key.ts'
import type { FontSource } from '../src/text/font-source.ts'
import { borderColour, median } from '../src/text/ink.ts'
import { matchText, type TextPieceOfJob } from '../src/text/match-text.ts'
import { openNodeModel } from '../src/text/model-runtime-node.ts'
import { readTextFiles, TEXT_FILES, type TextFileBytes } from '../src/text/text-files.ts'
import { fetchFiles, FILES_DIR } from './fetch-files.ts'

/** A text piece of a test ad: the job that matches it and where it comes from. */
interface AdPiece {
  id: string
  heldOut: boolean
  job: MatchJob
  piece: TextPieceOfJob
}

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

/** A pixel with alpha under this is see-through when the colour behind a piece is read. */
const SEE_THROUGH_BELOW = 13
/** The colour behind a piece is read from its see-through pixels when they are at least this share of it. */
const SEE_THROUGH_SHARE = 0.05

const [checkout, answersFile] = process.argv.slice(2)
const adsDir = process.env.TEST_ADS_DIR
if (!checkout || !adsDir) {
  console.error('Usage: TEST_ADS_DIR=<test ads> node scripts/measure-text.ts <google/fonts checkout> [answers.json]')
  process.exit(1)
}
const ck = await loadCanvasKit()
await fetchFiles()
const bytes = Object.fromEntries(
  TEXT_FILES.map((name) => [name, new Uint8Array(readFileSync(join(FILES_DIR, name)))]),
) as TextFileBytes
const model = await openNodeModel(new Uint8Array(readFileSync(join(FILES_DIR, 'text-model.onnx'))))
const deps = { ck, files: readTextFiles(bytes), model, fonts: googleFontSource(checkout) }

const pieces = adPieces(ck, adsDir)
const answers: Record<string, MatchAnswer & { face?: string; ms: number }> = {}
const msByAd = new Map<string, number>()
for (const { id, job, piece } of pieces) {
  const started = performance.now()
  const answer = await matchText(job, piece, deps)
  const ms = performance.now() - started
  const layer = answer.kind === 'layers' ? answer.layers[0] : undefined
  const style = layer?.type === 'text' ? layer.props.style : undefined
  const face = style ? `${style.fontFamily}|${style.fontWeight}|${style.fontStyle}` : undefined
  answers[id] = { ...answer, ...(face ? { face } : {}), ms }
  const ad = id.split('#')[0] ?? id
  msByAd.set(ad, (msByAd.get(ad) ?? 0) + ms)
  const scores = answer.scores
  console.log(
    `${id}  ${answer.kind === 'layers' ? 'text   ' : `picture (${answer.why})`}  ${face ?? '-'}  ` +
      (scores ? `ssim ${scores.ssim.toFixed(4)} ink missed ${scores.inkMissed.toFixed(4)}` : ''),
  )
}
await model.release()
if (answersFile) writeFileSync(answersFile, JSON.stringify(answers, null, 1))

const count = (list: readonly AdPiece[]) => {
  const same = list.filter((p) => answers[p.id]?.kind === 'layers').length
  return `${same} of ${list.length} (${((100 * same) / list.length).toFixed(1)}%)`
}
const perAd = [...msByAd.values()].sort((a, b) => a - b)
console.log(`\nLooks the same, held-out: ${count(pieces.filter((p) => p.heldOut))}`)
console.log(`Looks the same, all 48: ${count(pieces)}`)
console.log(`Per ad, median: ${((perAd[Math.floor(perAd.length / 2)] ?? 0) / 1000).toFixed(1)} s`)

/** Every text piece of the test ads with a reading, in the ads' order by name. */
function adPieces(ck: CanvasKit, dir: string): AdPiece[] {
  const names = readdirSync(dir).sort()
  return names.flatMap((name, n) => {
    const folder = join(dir, name)
    const meta = JSON.parse(readFileSync(join(folder, 'blocks.json'), 'utf8')) as AdBlocks
    const readings = JSON.parse(readFileSync(join(folder, 'readings.json'), 'utf8')) as Record<string, { text: string }>
    const ad = decode(ck, new Uint8Array(readFileSync(join(folder, 'ad.png'))))
    const scale = meta.source_size[0] / meta.bucket[0]
    return meta.blocks.flatMap((block, index) => {
      const words = readings[block.element]?.text
      if (block.kind !== 'text' || !words) return []
      const id = `ad${String(n + 1).padStart(2, '0')}#${index}`
      const png = new Uint8Array(readFileSync(join(folder, block.file)))
      const pixels = decode(ck, png)
      const piece: TextPieceOfJob = {
        kind: 'text',
        rect: { x: 0, y: 0, width: pixels.width, height: pixels.height },
        words,
        angle: block.rotated_box?.angle ?? 0,
      }
      const job = MatchJob.parse({
        picture: Buffer.from(png).toString('base64'),
        backgrounds: [colourBehind(pixels, behind(ad, block.rect, scale, pixels))],
        pieces: [piece],
        kit: { colors: {}, fonts: {}, textStyles: [] },
        setting: 'light',
      })
      return [{ id, heldOut: n % 3 === 2, job, piece }]
    })
  })
}

/** A face's bytes from the checkout: its match copy when asked and HarfBuzz cuts it, else the whole face. */
function googleFontSource(dir: string): FontSource {
  const copies = new Map<string, Uint8Array>()
  return {
    face: async (key, copy) => {
      const parsed = parseFontKey(key)
      const family = parsed && GOOGLE_FONTS.find((f) => f.family === parsed.family)
      const found = parsed && family ? faceOfKey(parsed, googleFaces(family)) : null
      if (!family || !found) return null
      const path = join(dir, family.path, found.face.file)
      if (!copy) return new Uint8Array(readFileSync(path))
      let bytes = copies.get(path)
      if (!bytes) {
        const whole = new Uint8Array(readFileSync(path))
        bytes = matchCopy(whole) ?? whole
        copies.set(path, bytes)
      }
      return bytes
    },
  }
}

/** A PNG's pixels, 8-bit RGBA with straight alpha, decoded by CanvasKit. */
function decode(ck: CanvasKit, png: Uint8Array): Pixels {
  const image = ck.MakeImageFromEncoded(png)
  if (!image) throw new Error('not a PNG CanvasKit reads')
  try {
    const width = image.width()
    const height = image.height()
    const pixels = image.readPixels(0, 0, {
      width,
      height,
      colorType: ck.ColorType.RGBA_8888,
      alphaType: ck.AlphaType.Unpremul,
      colorSpace: ck.ColorSpace.SRGB,
    })
    if (!(pixels instanceof Uint8Array)) throw new Error('could not read the PNG’s pixels')
    return { width, height, pixels }
  } finally {
    image.delete()
  }
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
