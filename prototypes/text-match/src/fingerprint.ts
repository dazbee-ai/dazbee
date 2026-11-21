// PROTOTYPE. The font fingerprint: the trained model (ONNX, run by onnxruntime-node on the CPU) turns
// each line of a block into a fingerprint; each face is known by the mean fingerprint of a few of its
// samples. A face's fingerprint is made from its own samples, so a face added later (a brand's upload)
// needs no new training.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import * as ort from 'onnxruntime-node'

import { type Ink, inkBox, lineStrip, STRIP_HEIGHT, WINDOW } from './ink.ts'
import type { Line } from './measure.ts'

/** What a model reads and gives: strips `height` high read in windows `window` wide, `dim` numbers out. */
export interface Geometry {
  height: number
  window: number
  dim: number
}

/** The first models' geometry, when a model folder has no model.json. */
const FIRST_GEOMETRY: Geometry = { height: STRIP_HEIGHT, window: WINDOW, dim: 128 }

export interface Fingerprints {
  faces: string[]
  dim: number
  /** faces.length × dim, each row unit length. */
  vectors: Float32Array
}

/** A model folder's geometry: its model.json, else the first models'. */
export function geometryOf(dir: string): Geometry {
  const file = join(dir, 'model.json')
  return existsSync(file)
    ? { ...FIRST_GEOMETRY, ...(JSON.parse(readFileSync(file, 'utf8')) as Partial<Geometry>) }
    : FIRST_GEOMETRY
}

/** Opens `file` (model.onnx or another ONNX copy in the same folder) on `threads` CPU threads. */
export async function openModel(file: string, threads = 1) {
  const geometry = geometryOf(join(file, '..'))
  const { height, window, dim } = geometry
  const session = await ort.InferenceSession.create(file, {
    intraOpNumThreads: threads,
    interOpNumThreads: 1,
    executionMode: 'sequential',
    graphOptimizationLevel: 'all',
  })
  /** One fingerprint per window, run in one batch. */
  async function embedWindows(windows: Uint8Array[]): Promise<Float32Array[]> {
    const input = new Float32Array(windows.length * height * window)
    windows.forEach((w, k) => {
      for (let i = 0; i < w.length; i++) input[k * height * window + i] = w[i]! / 255
    })
    const out = await session.run({ ink: new ort.Tensor('float32', input, [windows.length, 1, height, window]) })
    const data = out.fingerprint!.data as Float32Array
    return windows.map((_, k) => data.subarray(k * dim, (k + 1) * dim))
  }
  // Fewer numbers (train/pca.py): with FP_PCA=<k> and pca-<k>.f32 in the folder, a block's fingerprint
  // is moved onto the gallery's first k principal directions; the gallery is fingerprints-pca<k>.f32.
  const pcaFile = process.env.FP_PCA ? join(file, '..', `pca-${process.env.FP_PCA}.f32`) : ''
  let projection: { mean: Float32Array; k: number; dirs: Float32Array } | null = null
  if (pcaFile && existsSync(pcaFile)) {
    const raw = readFileSync(pcaFile)
    const all = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4)
    projection = { mean: all.subarray(0, dim), k: Number(process.env.FP_PCA), dirs: all.subarray(dim) }
  }
  /** A unit fingerprint moved onto the principal directions, unit length again (unchanged without FP_PCA). */
  function project(v: Float32Array): Float32Array {
    if (!projection) return v
    const { mean, k, dirs } = projection
    const out = new Float32Array(k)
    for (let i = 0; i < dim; i++) {
      const c = v[i]! - mean[i]!
      for (let j = 0; j < k; j++) out[j]! += c * dirs[i * k + j]!
    }
    return meanUnit([out])
  }
  return { geometry, embedWindows, project, release: () => session.release() }
}

export type Model = Awaited<ReturnType<typeof openModel>>

/** The windows a strip is read in: one padded window when short, else overlapping by half. */
export function windowsOf(
  strip: { width: number; data: Uint8Array },
  height = STRIP_HEIGHT,
  window = WINDOW,
): Uint8Array[] {
  const cut = (start: number) => {
    const out = new Uint8Array(height * window)
    for (let y = 0; y < height; y++)
      for (let x = 0; x < window; x++) {
        const sx = start + x
        if (sx >= 0 && sx < strip.width) out[y * window + x] = strip.data[y * strip.width + sx]!
      }
    return out
  }
  if (strip.width <= window) return [cut(0)]
  const starts: number[] = []
  for (let s = 0; s + window <= strip.width; s += window / 2) starts.push(s)
  if (starts.at(-1) !== strip.width - window) starts.push(strip.width - window)
  return starts.map(cut)
}

/**
 * Each line's strip as the model reads it. The samples' strips were cut at the 0.3 ink level, so each
 * line's box is found again at that level. `squeeze` scales the strip across (1: as it is).
 */
export function lineStrips(level: Ink, lines: Line[], height: number, squeeze = 1, maxWidth = Infinity) {
  return lines.map((l) => {
    const x = Math.max(0, l.box.x - 3)
    const y = Math.max(0, l.box.y - 3)
    const around = {
      x,
      y,
      w: Math.min(level.width, l.box.x + l.box.w + 3) - x,
      h: Math.min(level.height, l.box.y + l.box.h + 3) - y,
    }
    return lineStrip(level, inkBox(level, 0.3, around) ?? l.box, maxWidth, height, squeeze)
  })
}

/**
 * The squeezes a block is read at: as it is, then (when VIEWS asks for more) narrower and wider, so
 * letters a little condensed or stretched still meet their face. Chosen on the development parts.
 */
const VIEWS = (process.env.VIEWS ?? '1')
  .split(',')
  .map(Number)
  .filter((v) => v > 0)

/** A block's fingerprint: the mean over the windows of all its lines (and views), unit length. */
export async function blockFingerprint(model: Model, level: Ink, lines: Line[]): Promise<Float32Array> {
  const { height, window } = model.geometry
  const windows = VIEWS.flatMap((squeeze) =>
    lineStrips(level, lines, height, squeeze).flatMap((s) => windowsOf(s, height, window)),
  )
  return model.project(meanUnit(await model.embedWindows(windows)))
}

export function meanUnit(vectors: Float32Array[]): Float32Array {
  const dim = vectors[0]?.length ?? 0
  const out = new Float32Array(dim)
  for (const v of vectors) for (let i = 0; i < dim; i++) out[i]! += v[i]!
  let n = 0
  for (let i = 0; i < dim; i++) n += out[i]! * out[i]!
  n = Math.sqrt(n) || 1
  for (let i = 0; i < dim; i++) out[i]! /= n
  return out
}

/** A model folder's face fingerprints; `name` picks another set in the folder (fingerprints-<name>.f32). */
export function loadFingerprints(dir: string, name = ''): Fingerprints {
  const suffix = name ? `-${name}` : ''
  const faces = JSON.parse(readFileSync(join(dir, `fingerprint-faces${suffix}.json`), 'utf8')) as string[]
  const raw = readFileSync(join(dir, `fingerprints${suffix}.f32`))
  const vectors = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4)
  return { faces, dim: vectors.length / faces.length, vectors }
}

/** The similarity of a fingerprint to face `f`'s. */
export function similarity(fp: Fingerprints, f: number, v: Float32Array): number {
  let s = 0
  for (let i = 0; i < fp.dim; i++) s += fp.vectors[f * fp.dim + i]! * v[i]!
  return s
}

/** The faces among `allowed` (indices into fp.faces) nearest a fingerprint, best first, with their similarity. */
export function nearest(fp: Fingerprints, v: Float32Array, allowed: readonly number[], k: number) {
  const scored = allowed.map((f) => ({ face: f, similarity: similarity(fp, f, v) }))
  scored.sort((a, b) => b.similarity - a.similarity)
  return scored.slice(0, k)
}
