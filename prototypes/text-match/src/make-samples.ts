// PROTOTYPE. Draws the fingerprint model's samples with Dazbee's renderer: for every catalogue face,
// `--per-face` lines of random words in a script the face draws, at random letter spacing, each kept
// as its ink strip (STRIP_HEIGHT high, up to STRIP_WIDTH wide). Runs on `--threads` worker threads.
//   node src/make-samples.ts --per-face 24 --seed 1 --out train24 [--threads 8]
// Writes .data/samples/<out>/: strips.u8 (count × 32 × 320), widths.u16, labels.u16, meta.json.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { cpus } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads'

import { loadCanvasKit } from '@dazbee/renderer/node'

import { DATA_DIR, faceId, loadCatalogue } from './catalogue.ts'
import { makeDrawer, textProps } from './draw.ts'
import { inkBox, lineStrip, STRIP_HEIGHT, STRIP_WIDTH } from './ink.ts'
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
    },
  })
  const perFace = Number(values['per-face'])
  const threads = Number(values.threads)
  const faces = loadCatalogue(values.faces).filter((f) => (f.scripts ?? []).length > 0)
  const dir = join(DATA_DIR, 'samples', values.out!)
  mkdirSync(dir, { recursive: true })
  const started = performance.now()
  const parts = await Promise.all(
    Array.from({ length: threads }, (_, t) => {
      const mine = faces.map((_, i) => i).filter((i) => i % threads === t)
      return new Promise<string>((resolve, reject) => {
        const w = new Worker(new URL(import.meta.url), {
          workerData: { indices: mine, perFace, seed: Number(values.seed), dir, part: t, facesPath: values.faces },
        })
        w.on('message', resolve)
        w.on('error', reject)
      })
    }),
  )
  // Joins the parts in face order.
  const all: { label: number; width: number; strip: Uint8Array }[] = []
  for (const part of parts) {
    const meta = JSON.parse(readFileSync(`${part}.json`, 'utf8')) as { labels: number[]; widths: number[] }
    const strips = readFileSync(`${part}.u8`)
    meta.labels.forEach((label, i) =>
      all.push({ label, width: meta.widths[i]!, strip: strips.subarray(i * STRIP_HEIGHT * STRIP_WIDTH, (i + 1) * STRIP_HEIGHT * STRIP_WIDTH) }),
    )
  }
  all.sort((a, b) => a.label - b.label)
  const strips = new Uint8Array(all.length * STRIP_HEIGHT * STRIP_WIDTH)
  all.forEach((s, i) => strips.set(s.strip, i * STRIP_HEIGHT * STRIP_WIDTH))
  writeFileSync(join(dir, 'strips.u8'), strips)
  writeFileSync(join(dir, 'widths.u16'), new Uint16Array(all.map((s) => s.width)))
  writeFileSync(join(dir, 'labels.u16'), new Uint16Array(all.map((s) => s.label)))
  const seconds = (performance.now() - started) / 1000
  writeFileSync(
    join(dir, 'meta.json'),
    JSON.stringify({ faces: faces.map(faceId), count: all.length, perFace, height: STRIP_HEIGHT, width: STRIP_WIDTH, seconds, threads }, null, 1),
  )
  for (const part of parts) {
    rmSync(`${part}.json`)
    rmSync(`${part}.u8`)
  }
  console.log(`${all.length} samples of ${faces.length} faces in ${seconds.toFixed(0)} s on ${threads} threads`)
} else {
  const { indices, perFace, seed, dir, part, facesPath } = workerData as {
    facesPath?: string
    indices: number[]
    perFace: number
    seed: number
    dir: string
    part: number
  }
  const ck = await loadCanvasKit()
  const catalogue = loadCatalogue()
  const faces = loadCatalogue(facesPath).filter((f) => (f.scripts ?? []).length > 0)
  const drawer = makeDrawer(ck, catalogue.filter((f) => f.source === 'shipped'))
  const labels: number[] = []
  const widths: number[] = []
  const chunks: Uint8Array[] = []
  for (const index of indices) {
    const face = faces[index]!
    drawer.use([face])
    const r = rng(seed * 100003 + index)
    for (let k = 0; k < perFace; k++) {
      const script = pick(r, face.scripts!)
      const text = line(r, script)
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
      const height = Math.round(SIZE * 2.5)
      const px = drawer.draw(width, height, null, textProps(text, look, { x: SIZE / 2, y: SIZE / 2, width: width - SIZE, height: SIZE * 1.5, rotation: 0 }))
      const alpha = new Float32Array(width * height)
      for (let i = 0; i < alpha.length; i++) alpha[i] = px[i * 4 + 3]! / 255
      const ink = { width, height, data: alpha }
      const box = inkBox(ink, 0.3)
      if (!box) continue
      const strip = lineStrip(ink, box, STRIP_WIDTH)
      const padded = new Uint8Array(STRIP_HEIGHT * STRIP_WIDTH)
      for (let y = 0; y < STRIP_HEIGHT; y++) padded.set(strip.data.subarray(y * strip.width, (y + 1) * strip.width), y * STRIP_WIDTH)
      labels.push(index)
      widths.push(strip.width)
      chunks.push(padded)
    }
  }
  const out = join(dir, `part${part}`)
  const all = new Uint8Array(chunks.length * STRIP_HEIGHT * STRIP_WIDTH)
  chunks.forEach((c, i) => all.set(c, i * STRIP_HEIGHT * STRIP_WIDTH))
  writeFileSync(`${out}.u8`, all)
  writeFileSync(`${out}.json`, JSON.stringify({ labels, widths }))
  drawer.delete()
  parentPort!.postMessage(out)
}
