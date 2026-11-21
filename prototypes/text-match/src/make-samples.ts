// PROTOTYPE. Draws the fingerprint model's samples with Dazbee's renderer: for every catalogue face,
// `--per-face` lines of random words in a script the face draws, at random letter spacing, each kept
// as its ink strip (`--height` high, up to `--width` wide). Runs on `--threads` worker threads.
// `--realistic` makes each sample look like a block cut out of a generated ad (realistic.ts): drawn at
// sizes from small print to headlines, with spacing jittered as DeepFont does, outlines, drop shadows
// and gradients, set over an ad background and then cut out with spoilt edges or kept flat; its
// strip is then found by the same steps the matcher takes (ink, line, strip).
//   node src/make-samples.ts --per-face 24 --seed 1 --out train24 [--threads 8] [--height 64 --width 384 --realistic]
// Writes .data/samples/<out>/: strips.u8 (count × height × width), widths.u16, labels.u16, meta.json.
import { appendFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { cpus } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads'

import { loadCanvasKit } from '@dazbee/renderer/node'

import { type CatalogueFace, DATA_DIR, faceId, loadCatalogue } from './catalogue.ts'
import { type Drawer, makeDrawer, type TextLook, textProps } from './draw.ts'
import { lineStrips } from './fingerprint.ts'
import { inkBox, inkOf, lineStrip, STRIP_HEIGHT, STRIP_WIDTH } from './ink.ts'
import { findLines, hex } from './measure.ts'
import type { Rgba } from './png.ts'
import {
  backdropFiles,
  background,
  composite,
  contrasting,
  cutOut,
  flatNoise,
  loadBackdrops,
  meanColour,
  randomMatting,
} from './realistic.ts'
import { line, pick, rng } from './words.ts'

const SIZE = 56

if (isMainThread) {
  const { values } = parseArgs({
    options: {
      'per-face': { type: 'string', default: '24' },
      seed: { type: 'string', default: '1' },
      out: { type: 'string', default: 'train' },
      threads: { type: 'string', default: String(Math.max(1, cpus().length - 2)) },
      // Another list of faces to draw, such as every Google face for a bigger training run.
      faces: { type: 'string' },
      height: { type: 'string', default: String(STRIP_HEIGHT) },
      width: { type: 'string', default: String(STRIP_WIDTH) },
      realistic: { type: 'boolean', default: false },
    },
  })
  const perFace = Number(values['per-face'])
  const threads = Number(values.threads)
  const geometry = { height: Number(values.height), width: Number(values.width), realistic: values.realistic! }
  const faces = loadCatalogue(values.faces).filter((f) => (f.scripts ?? []).length > 0)
  const dir = join(DATA_DIR, 'samples', values.out!)
  mkdirSync(dir, { recursive: true })
  const started = performance.now()
  const parts = await Promise.all(
    Array.from({ length: threads }, (_, t) => {
      const mine = faces.map((_, i) => i).filter((i) => i % threads === t)
      return new Promise<string>((resolve, reject) => {
        const w = new Worker(new URL(import.meta.url), {
          workerData: {
            indices: mine,
            perFace,
            seed: Number(values.seed),
            dir,
            part: t,
            facesPath: values.faces,
            ...geometry,
          },
        })
        w.on('message', resolve)
        w.on('error', reject)
      })
    }),
  )
  const labels = joinParts(dir, parts)
  const seconds = (performance.now() - started) / 1000
  writeFileSync(
    join(dir, 'meta.json'),
    JSON.stringify(
      {
        faces: faces.map(faceId),
        subset: faces.flatMap((f, i) => (f.menu ? [i] : [])),
        count: labels,
        perFace,
        ...geometry,
        seconds,
        threads,
      },
      null,
      1,
    ),
  )
  console.log(`${labels} samples of ${faces.length} faces in ${seconds.toFixed(0)} s on ${threads} threads`)
} else {
  await work()
}

/**
 * Joins the threads' parts into strips.u8, widths.u16 and labels.u16, part after part (training reads
 * the samples in any order), appending so a set past 2 GB is written too; then deletes the parts.
 * Returns how many samples there are.
 */
export function joinParts(dir: string, parts: string[]): number {
  const labels: number[] = []
  const widths: number[] = []
  rmSync(join(dir, 'strips.u8'), { force: true })
  for (const part of parts) {
    const meta = JSON.parse(readFileSync(`${part}.json`, 'utf8')) as { labels: number[]; widths: number[] }
    labels.push(...meta.labels)
    widths.push(...meta.widths)
    appendFileSync(join(dir, 'strips.u8'), readFileSync(`${part}.u8`))
  }
  writeFileSync(join(dir, 'widths.u16'), new Uint16Array(widths))
  writeFileSync(join(dir, 'labels.u16'), new Uint16Array(labels))
  for (const part of parts) {
    rmSync(`${part}.json`)
    rmSync(`${part}.u8`)
  }
  return labels.length
}

async function work() {
  const {
    indices,
    perFace,
    seed,
    dir,
    part,
    facesPath,
    height,
    width: stripWidth,
    realistic,
  } = workerData as {
    facesPath?: string
    indices: number[]
    perFace: number
    seed: number
    dir: string
    part: number
    height: number
    width: number
    realistic: boolean
  }
  const ck = await loadCanvasKit()
  const catalogue = loadCatalogue()
  const faces = loadCatalogue(facesPath).filter((f) => (f.scripts ?? []).length > 0)
  const drawer = makeDrawer(
    ck,
    catalogue.filter((f) => f.source === 'shipped'),
  )
  const backdrops = realistic ? loadBackdrops(backdropFiles('train')) : []
  const labels: number[] = []
  const widths: number[] = []
  // Written in pieces, so a thread's part never needs one buffer past 2 GB.
  const out = join(dir, `part${part}`)
  rmSync(`${out}.u8`, { force: true })
  let chunks: Uint8Array[] = []
  const flush = () => {
    if (chunks.length === 0) return
    const all = new Uint8Array(chunks.length * height * stripWidth)
    chunks.forEach((c, i) => all.set(c, i * height * stripWidth))
    appendFileSync(`${out}.u8`, all)
    chunks = []
  }
  for (const index of indices) {
    const face = faces[index]!
    drawer.use([face])
    const r = rng(seed * 100003 + index)
    for (let k = 0; k < perFace; k++) {
      const script = pick(r, face.scripts!)
      const text = line(r, script)
      const strip = realistic
        ? realisticStrip(r, drawer, face, text, backdrops, height, stripWidth)
        : plainStrip(r, drawer, face, text, height, stripWidth)
      if (!strip) continue
      const padded = new Uint8Array(height * stripWidth)
      for (let y = 0; y < height; y++)
        padded.set(strip.data.subarray(y * strip.width, (y + 1) * strip.width), y * stripWidth)
      labels.push(index)
      widths.push(strip.width)
      chunks.push(padded)
    }
    if (chunks.length >= 2000) flush()
  }
  flush()
  if (labels.length === 0) writeFileSync(`${out}.u8`, new Uint8Array(0))
  writeFileSync(`${out}.json`, JSON.stringify({ labels, widths }))
  drawer.delete()
  parentPort!.postMessage(out)
}

/** A clean sample: black text at SIZE, letter spacing mostly none, its ink strip. */
function plainStrip(
  r: () => number,
  drawer: Drawer,
  face: CatalogueFace,
  text: string,
  height: number,
  stripWidth: number,
) {
  const u = r()
  const spacing = u < 0.5 ? 0 : u < 0.7 ? -2 - r() * 4 : 2 + r() * 18
  const look = {
    family: face.family,
    weight: face.weight,
    style: face.style,
    size: SIZE,
    spacing,
    align: 'start' as const,
    color: '#000000FF',
  }
  const width = Math.min(4000, Math.ceil(text.length * SIZE * (1 + Math.max(0, spacing) / 100) + 2 * SIZE))
  const frame = Math.round(SIZE * 2.5)
  const px = drawer.draw(
    width,
    frame,
    null,
    textProps(text, look, { x: SIZE / 2, y: SIZE / 2, width: width - SIZE, height: SIZE * 1.5, rotation: 0 }),
  )
  const alpha = new Float32Array(width * frame)
  for (let i = 0; i < alpha.length; i++) alpha[i] = px[i * 4 + 3]! / 255
  const ink = { width, height: frame, data: alpha }
  const box = inkBox(ink, 0.3)
  return box ? lineStrip(ink, box, stripWidth, height) : null
}

/**
 * A sample made to look like a block cut out of a generated ad (realistic.ts), read as the matcher
 * reads a block: its ink (a cut-out's alpha, a flat crop's distance from its border colour), its line
 * and the line's strip.
 */
function realisticStrip(
  r: () => number,
  drawer: Drawer,
  face: CatalogueFace,
  text: string,
  backdrops: Rgba[],
  height: number,
  stripWidth: number,
) {
  // Sizes from small print to headlines.
  const v = r()
  const size = Math.round(v < 0.2 ? 11 + r() * 9 : v < 0.5 ? 20 + r() * 20 : 40 + r() * 50)
  // Letter spacing as DeepFont jitters it (N(10, 40) px, clipped to 0–50, at 105 px text: about
  // N(10, 38)% clipped to 0–48%), plain nearly half the time and a little tight now and then.
  const s = r()
  const spacing = s < 0.45 ? 0 : s < 0.6 ? -1 - r() * 5 : Math.max(0, Math.min(48, 10 + 38 * gaussian(r)))
  const pad = Math.ceil(size * 0.8 + 8)
  const width = Math.min(6000, Math.ceil(text.length * size * (1 + Math.max(0, spacing) / 100) + 2 * pad))
  const frame = Math.ceil(size * 1.6 + 2 * pad)
  // A flat crop over a busy photo leaves no clean ink to read, so flat samples sit mostly on made backgrounds.
  const flat = r() < 0.25
  const behind = background(r, flat && r() < 0.7 ? [] : backdrops, width, frame)
  const fill = contrasting(r, meanColour(behind), r() < 0.1)
  const outlined = r() < 0.12
  const shadowed = r() < 0.1
  const gradient =
    !outlined && r() < 0.2 ? { fill, to: contrasting(r, meanColour(behind)), angle: r() * 360 } : undefined
  const look: TextLook = {
    family: face.family,
    weight: face.weight,
    style: face.style,
    size,
    spacing,
    align: 'start',
    color: hex(fill),
    ...(outlined
      ? {
          outline: {
            width: Math.max(1, Math.round(size * (0.02 + r() * 0.06) * 2) / 2),
            color: hex(contrasting(r, fill)),
          },
        }
      : {}),
  }
  const shadow = shadowed
    ? [
        {
          type: 'dropShadow',
          x: Math.round(size * (r() - 0.3) * 0.12),
          y: Math.round(size * (0.02 + r() * 0.08)),
          blur: Math.round(r() * size * 0.1),
          spread: 0,
          color: hex([0, 0, 0], Math.round(80 + r() * 150)),
        },
      ]
    : []
  const props = {
    ...textProps(text, look, { x: pad, y: pad, width: width - 2 * pad, height: size * 1.6, rotation: 0 }),
    effects: shadow,
  }
  const textRgba = { width, height: frame, data: drawer.draw(width, frame, null, props) }
  const comp = composite(textRgba, behind, gradient)
  const block = flat ? flatNoise(r, comp, r() * 12) : cutOut(r, textRgba, comp, randomMatting(r))
  const ink = inkOf(block)
  const box = inkBox(ink)
  if (!box) return null
  return lineStrips(ink, findLines(ink, box, 1), height, 1, stripWidth)[0] ?? null
}

/** A standard normal draw (Box–Muller). */
function gaussian(r: () => number) {
  return Math.sqrt(-2 * Math.log(Math.max(1e-9, r()))) * Math.cos(2 * Math.PI * r())
}
