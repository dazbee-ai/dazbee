// PROTOTYPE. Builds each face's fingerprint with a trained model: the mean fingerprint of the face's
// samples in a sample set (made by make-samples.ts). This is the step that runs when fonts are added.
//   node src/build-fingerprints.ts --model .data/models/w32-p48 --samples .data/samples/proto8
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'

import { DIM, meanUnit, openModel, windowsOf } from './fingerprint.ts'
import { STRIP_HEIGHT, STRIP_WIDTH } from './ink.ts'

const { values } = parseArgs({ options: { model: { type: 'string' }, samples: { type: 'string' } } })
const started = performance.now()
const meta = JSON.parse(readFileSync(join(values.samples!, 'meta.json'), 'utf8')) as { faces: string[] }
const strips = readFileSync(join(values.samples!, 'strips.u8'))
const widthsRaw = readFileSync(join(values.samples!, 'widths.u16'))
const labelsRaw = readFileSync(join(values.samples!, 'labels.u16'))
const widths = new Uint16Array(widthsRaw.buffer, widthsRaw.byteOffset, widthsRaw.byteLength / 2)
const labels = new Uint16Array(labelsRaw.buffer, labelsRaw.byteOffset, labelsRaw.byteLength / 2)
const model = await openModel(join(values.model!, 'model.onnx'), 4)
const byFace: Float32Array[][] = meta.faces.map(() => [])
const BATCH = 64
let pending: { windows: Uint8Array[]; label: number }[] = []
async function flush() {
  const all = pending.flatMap((p) => p.windows)
  const out = await model.embedWindows(all)
  let k = 0
  for (const p of pending) {
    byFace[p.label]!.push(meanUnit(out.slice(k, k + p.windows.length).map((v) => new Float32Array(v))))
    k += p.windows.length
  }
  pending = []
}
for (let i = 0; i < labels.length; i++) {
  const width = widths[i]!
  const data = new Uint8Array(STRIP_HEIGHT * width)
  for (let y = 0; y < STRIP_HEIGHT; y++)
    data.set(strips.subarray((i * STRIP_HEIGHT + y) * STRIP_WIDTH, (i * STRIP_HEIGHT + y) * STRIP_WIDTH + width), y * width)
  pending.push({ windows: windowsOf({ width, data }), label: labels[i]! })
  if (pending.length >= BATCH) await flush()
}
await flush()
const vectors = new Float32Array(meta.faces.length * DIM)
byFace.forEach((list, f) => vectors.set(list.length > 0 ? meanUnit(list) : new Float32Array(DIM), f * DIM))
writeFileSync(join(values.model!, 'fingerprints.f32'), vectors)
writeFileSync(join(values.model!, 'fingerprint-faces.json'), JSON.stringify(meta.faces))
console.log(`${meta.faces.length} fingerprints in ${((performance.now() - started) / 1000).toFixed(1)} s`)
