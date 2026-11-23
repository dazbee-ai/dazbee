// Builds the browser measurement, never shipped: bundles the page and its matcher worker, which run the
// editor's own match client, pool and worker, and writes the pieces they match, the held-out test ads' text and
// shape pieces, each a match job of its own picture as the Node measurements make them. With --node it also writes
// Node's answers to the same jobs, for the page to compare the browser's with. Everything goes to the git-ignored
// `.browser-measure/`; the test ads stay outside the repo and are named only `adNN`.
//   TEST_ADS_DIR=<test ads> [GOOGLE_FONTS_DIR=<google/fonts checkout>] node scripts/browser-measure/build.ts [--node]
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { build, type Plugin } from 'esbuild'

import type { CanvasKit } from '@dazbee/canvaskit'
import { matchCopy } from '@dazbee/fonts/match-copy'
import { loadFontFiles } from '@dazbee/fonts/node'
import { loadCanvasKit } from '@dazbee/renderer/node'
import { type MatchAnswer, MatchJob } from '@dazbee/schema'

import { matchShapes } from '../../src/shape/match-shapes.ts'
import { fontKey } from '../../src/text/font-key.ts'
import type { FontSource } from '../../src/text/font-source.ts'
import { matchText } from '../../src/text/match-text.ts'
import { openNodeModel } from '../../src/text/model-runtime-node.ts'
import { readTextFiles, TEXT_FILES, type TextFileBytes } from '../../src/text/text-files.ts'
import { fetchFiles, FILES_DIR } from '../fetch-files.ts'
import { googleFaceFile } from '../google-face-file.ts'
import { adPieces } from '../text-measure-pieces.ts'

/** What a piece is: text, or the kind of block a shape piece is, a shape, graphic or background, or a photo or cutout that must stay a picture. */
export type Block = 'text' | 'shape' | 'graphic' | 'background' | 'photo' | 'cutout'

/** A piece the page matches: its neutral id, its ad's, what kind of block it is, and its job. */
export interface BrowserPiece {
  /** `adNN#i` for a text piece, as the text measurement names it; `adNN/BB` for a shape piece, as the shape one does. */
  id: string
  ad: string
  block: Block
  job: MatchJob
}

/** The pieces the page matches: the held-out ads' 69 text pieces, and their 47 shape and 25 photo and cutout pieces. */
export interface BrowserPieces {
  text: BrowserPiece[]
  shape: BrowserPiece[]
}

/** Node's answer to each piece, by id, the time it took, and when each of its steps began, in ms from its start. */
export type NodeAnswers = Record<string, { answer: MatchAnswer; ms: number; steps: Record<string, number> }>

/** Where the build, the pieces, Node's answers and every run's results go. */
export const OUT_DIR = join(import.meta.dirname, '..', '..', '.browser-measure')
/** The block kinds sent as shapes: shape pieces, and photos and cutouts that must stay pictures. */
const SHAPE_BLOCKS: readonly Block[] = ['shape', 'graphic', 'background', 'photo', 'cutout']

/** Node's built-ins CanvasKit's Emscripten glue asks for only when it runs in Node. */
const NODE_ONLY = /^(node:)?(fs|path|module|url|crypto|worker_threads|perf_hooks)$/

if (import.meta.main) {
  const testAds = process.env.TEST_ADS_DIR
  if (!testAds) {
    console.error('Usage: TEST_ADS_DIR=<test ads> [GOOGLE_FONTS_DIR=<checkout>] node build.ts [--node]')
    process.exit(1)
  }
  mkdirSync(OUT_DIR, { recursive: true })
  await bundle()
  const ck = await loadCanvasKit()
  const pieces = heldOutPieces(ck, testAds)
  writeFileSync(join(OUT_DIR, 'pieces.json'), JSON.stringify(pieces))
  console.log(`${pieces.text.length} text and ${pieces.shape.length} shape pieces written`)
  if (process.argv.includes('--node')) {
    const checkout = process.env.GOOGLE_FONTS_DIR
    if (!checkout) throw new Error('--node needs GOOGLE_FONTS_DIR, a checkout of google/fonts at GOOGLE_FONTS_COMMIT')
    const answers = await nodeAnswers(ck, pieces, checkout)
    writeFileSync(join(OUT_DIR, 'node-answers.json'), JSON.stringify(answers))
    console.log(`Node's answers to ${Object.keys(answers).length} pieces written`)
  }
}

/** The page and the worker, bundled as ES modules sharing their chunks, as the web app bundles the editor's. */
async function bundle() {
  const nodeOnly: Plugin = {
    name: 'node-only',
    setup(b) {
      b.onResolve({ filter: NODE_ONLY }, (args) => ({ path: args.path, namespace: 'node-only' }))
      b.onLoad({ filter: /.*/, namespace: 'node-only' }, () => ({ contents: 'export default {}', loader: 'js' }))
    },
  }
  await build({
    entryPoints: [join(import.meta.dirname, 'page.ts'), join(import.meta.dirname, 'worker.ts')],
    outdir: join(OUT_DIR, 'build'),
    bundle: true,
    splitting: true,
    format: 'esm',
    platform: 'browser',
    target: 'chrome120',
    minify: true,
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [nodeOnly],
    logLevel: 'warning',
  })
  console.log(`bundled into ${join(OUT_DIR, 'build')}`)
}

/** The held-out ads' text pieces, as the text measurement reads them, and their shape, photo and cutout pieces. */
function heldOutPieces(ck: CanvasKit, dir: string): BrowserPieces {
  const text = adPieces(ck, dir)
    .filter((piece) => piece.heldOut)
    .map(({ id, job }) => ({
      id,
      ad: id.split('#')[0] ?? id,
      block: 'text' as const,
      job: { ...job, setting: 'hybrid' as const },
    }))
  const names = readdirSync(dir).sort()
  const shape = names.flatMap((name, n) => {
    if (n % 3 !== 2) return []
    const ad = `ad${String(n + 1).padStart(2, '0')}`
    const { blocks } = JSON.parse(readFileSync(join(dir, name, 'blocks.json'), 'utf8')) as {
      blocks: { file: string; kind: Block }[]
    }
    return blocks
      .filter((block) => SHAPE_BLOCKS.includes(block.kind))
      .map((block): BrowserPiece => {
        const png = readFileSync(join(dir, name, block.file))
        const image = ck.MakeImageFromEncoded(png)
        if (!image) throw new Error(`${ad}: a block CanvasKit can't read`)
        const rect = { x: 0, y: 0, width: image.width(), height: image.height() }
        image.delete()
        const job = MatchJob.parse({
          picture: png.toString('base64'),
          pieces: [{ kind: 'shape', rect }],
          kit: { colors: {}, fonts: {}, textStyles: [] },
        })
        return { id: `${ad}/${/(\d+)/.exec(block.file)?.[1] ?? block.file}`, ad, block: block.kind, job }
      })
  })
  return { text, shape }
}

/**
 * Node's answer to every piece: text with the release's model in onnxruntime-node and faces from the checkout,
 * a match copy cut as the server cuts it; shapes with `matchShapes`. The same calls the worker makes.
 */
async function nodeAnswers(ck: CanvasKit, pieces: BrowserPieces, checkout: string): Promise<NodeAnswers> {
  await fetchFiles()
  const bytes = Object.fromEntries(
    TEXT_FILES.map((name) => [name, new Uint8Array(readFileSync(join(FILES_DIR, name)))]),
  ) as TextFileBytes
  const model = await openNodeModel(new Uint8Array(readFileSync(join(FILES_DIR, 'text-model.onnx'))))
  const deps = { ck, files: readTextFiles(bytes), model, fonts: checkoutFonts(checkout) }
  const answers: NodeAnswers = {}
  try {
    for (const { id, job } of pieces.text) {
      const started = performance.now()
      const piece = job.pieces[0]
      if (piece?.kind !== 'text') throw new Error(`${id} is not a text piece`)
      const steps: Record<string, number> = {}
      const answer = await matchText(job, piece, {
        ...deps,
        step: (step) => (steps[step] = performance.now() - started),
      })
      answers[id] = { answer, ms: performance.now() - started, steps }
    }
  } finally {
    await model.release()
  }
  for (const { id, job } of pieces.shape) {
    const started = performance.now()
    const piece = job.pieces[0]
    if (!piece) throw new Error(`${id} has no piece`)
    const steps: Record<string, number> = {}
    const answer = matchShapes(ck, job, piece, (step) => (steps[step] = performance.now() - started))
    answers[id] = { answer, ms: performance.now() - started, steps }
  }
  return answers
}

/** A face's bytes as the server answers them: a shipped face's own, a Google face's match copy or whole file. */
function checkoutFonts(checkout: string): FontSource {
  const shipped = new Map(loadFontFiles().map((face) => [fontKey(face), face.bytes]))
  const copies = new Map<string, Uint8Array>()
  return {
    async face(key, copy) {
      const own = shipped.get(key)
      if (own) return own
      const path = googleFaceFile(checkout, key)?.path
      if (!path) return null
      const whole = new Uint8Array(readFileSync(path))
      if (!copy) return whole
      const cut = copies.get(path) ?? matchCopy(whole) ?? whole
      copies.set(path, cut)
      return cut
    },
  }
}
