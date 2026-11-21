// PROTOTYPE. The font fingerprint: the trained model (ONNX, run by onnxruntime-node on the CPU) turns
// each line of a block into a 128-number fingerprint; each face is known by the mean fingerprint of
// a few of its samples. A face's fingerprint is made from its own samples, so a face added later (a
// brand's upload) needs no new training.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import * as ort from 'onnxruntime-node'

import { type Ink, inkBox, lineStrip, STRIP_HEIGHT, WINDOW } from './ink.ts'
import type { Line } from './measure.ts'

export const DIM = 128

export interface Fingerprints {
  faces: string[]
  /** faces.length × DIM, each row unit length. */
  vectors: Float32Array
}

export async function openModel(path: string, threads = 1) {
  const session = await ort.InferenceSession.create(path, {
    intraOpNumThreads: threads,
    interOpNumThreads: 1,
    executionMode: 'sequential',
    graphOptimizationLevel: 'all',
  })
  /** One fingerprint per window, run in one batch. */
  async function embedWindows(windows: Uint8Array[]): Promise<Float32Array[]> {
    const input = new Float32Array(windows.length * STRIP_HEIGHT * WINDOW)
    windows.forEach((w, k) => {
      for (let i = 0; i < w.length; i++) input[k * STRIP_HEIGHT * WINDOW + i] = w[i]! / 255
    })
    const out = await session.run({ ink: new ort.Tensor('float32', input, [windows.length, 1, STRIP_HEIGHT, WINDOW]) })
    const data = out.fingerprint!.data as Float32Array
    return windows.map((_, k) => data.subarray(k * DIM, (k + 1) * DIM))
  }
  return { embedWindows, release: () => session.release() }
}

export type Model = Awaited<ReturnType<typeof openModel>>

/** The windows a strip is read in: one padded window when short, else overlapping by half. */
export function windowsOf(strip: { width: number; data: Uint8Array }): Uint8Array[] {
  const cut = (start: number) => {
    const out = new Uint8Array(STRIP_HEIGHT * WINDOW)
    for (let y = 0; y < STRIP_HEIGHT; y++)
      for (let x = 0; x < WINDOW; x++) {
        const sx = start + x
        if (sx >= 0 && sx < strip.width) out[y * WINDOW + x] = strip.data[y * strip.width + sx]!
      }
    return out
  }
  if (strip.width <= WINDOW) return [cut(0)]
  const starts: number[] = []
  for (let s = 0; s + WINDOW <= strip.width; s += WINDOW / 2) starts.push(s)
  if (starts.at(-1) !== strip.width - WINDOW) starts.push(strip.width - WINDOW)
  return starts.map(cut)
}

/** A block's fingerprint: the mean over the windows of all its lines, unit length. */
export async function blockFingerprint(model: Model, level: Ink, lines: Line[]): Promise<Float32Array> {
  // The samples' strips were cut at the 0.3 ink level, so each line's box is found again at that level.
  const windows = lines.flatMap((l) => {
    const x = Math.max(0, l.box.x - 3)
    const y = Math.max(0, l.box.y - 3)
    const around = { x, y, w: Math.min(level.width, l.box.x + l.box.w + 3) - x, h: Math.min(level.height, l.box.y + l.box.h + 3) - y }
    return windowsOf(lineStrip(level, inkBox(level, 0.3, around) ?? l.box))
  })
  return meanUnit(await model.embedWindows(windows))
}

export function meanUnit(vectors: Float32Array[]): Float32Array {
  const out = new Float32Array(DIM)
  for (const v of vectors) for (let i = 0; i < DIM; i++) out[i]! += v[i]!
  const n = Math.hypot(...out) || 1
  for (let i = 0; i < DIM; i++) out[i]! /= n
  return out
}

export function loadFingerprints(dir: string): Fingerprints {
  const faces = JSON.parse(readFileSync(join(dir, 'fingerprint-faces.json'), 'utf8')) as string[]
  const raw = readFileSync(join(dir, 'fingerprints.f32'))
  return { faces, vectors: new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4) }
}

/** The faces among `allowed` (indices into fp.faces) nearest a fingerprint, best first, with their similarity. */
export function nearest(fp: Fingerprints, v: Float32Array, allowed: readonly number[], k: number) {
  const scored = allowed.map((f) => {
    let s = 0
    for (let i = 0; i < DIM; i++) s += fp.vectors[f * DIM + i]! * v[i]!
    return { face: f, similarity: s }
  })
  scored.sort((a, b) => b.similarity - a.similarity)
  return scored.slice(0, k)
}
