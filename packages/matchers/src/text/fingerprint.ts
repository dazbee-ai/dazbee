// A piece's font fingerprint: each line of its level ink sampled into a 64-px strip, the strips cut
// into windows, the windows run through the model in batches, their numbers averaged and projected
// to the fingerprint's 128, unit length, as the fingerprints of the faces were made.

import { type Box, type Ink, inkBox, lineStrip } from './ink.ts'
import { type ModelRuntime, WINDOW_HEIGHT, WINDOW_WIDTH } from './model-runtime.ts'
import { FINGERPRINT_NUMBERS, MODEL_NUMBERS, type TextFiles } from './text-files.ts'

/** How many windows the model is given at a time. */
export const WINDOW_BATCH = 8

/** The faces' samples were cut at this ink level, so each line's box is found again at it. */
const STRIP_INK = 0.3
/** The pixels round a line's box searched for its ink at `STRIP_INK`. */
const STRIP_MARGIN = 3

/** The font fingerprint of a piece's level ink and its lines. */
export async function pieceFingerprint(
  runtime: ModelRuntime,
  files: TextFiles,
  level: Ink,
  lines: readonly Box[],
): Promise<Float32Array> {
  const windows = lines.flatMap((line) => windowsOf(lineStrip(level, stripBox(level, line), WINDOW_HEIGHT)))
  const size = WINDOW_HEIGHT * WINDOW_WIDTH
  const numbers: Float32Array[] = []
  for (let first = 0; first < windows.length; first += WINDOW_BATCH) {
    const batch = windows.slice(first, first + WINDOW_BATCH)
    const input = new Float32Array(batch.length * size)
    batch.forEach((window, k) => {
      for (let i = 0; i < window.length; i++) input[k * size + i] = (window[i] ?? 0) / 255
    })
    const output = await runtime.run(input, batch.length)
    for (let k = 0; k < batch.length; k++) numbers.push(output.subarray(k * MODEL_NUMBERS, (k + 1) * MODEL_NUMBERS))
  }
  return project(files, meanUnit(numbers))
}

/** The box a line's strip is cut from: its ink at `STRIP_INK` within a few pixels round it, else the line's box. */
function stripBox(level: Ink, line: Box): Box {
  const x = Math.max(0, line.x - STRIP_MARGIN)
  const y = Math.max(0, line.y - STRIP_MARGIN)
  const around = {
    x,
    y,
    w: Math.min(level.width, line.x + line.w + STRIP_MARGIN) - x,
    h: Math.min(level.height, line.y + line.h + STRIP_MARGIN) - y,
  }
  return inkBox(level, STRIP_INK, around) ?? line
}

/** The windows a strip is read in: one, padded, when it is no wider than a window, else windows overlapping by half and one at its end. */
function windowsOf(strip: { width: number; data: Uint8Array }): Uint8Array[] {
  const cut = (start: number) => {
    const out = new Uint8Array(WINDOW_HEIGHT * WINDOW_WIDTH)
    for (let y = 0; y < WINDOW_HEIGHT; y++)
      for (let x = 0; x < WINDOW_WIDTH; x++) {
        const sx = start + x
        if (sx >= 0 && sx < strip.width) out[y * WINDOW_WIDTH + x] = strip.data[y * strip.width + sx] ?? 0
      }
    return out
  }
  if (strip.width <= WINDOW_WIDTH) return [cut(0)]
  const starts: number[] = []
  for (let s = 0; s + WINDOW_WIDTH <= strip.width; s += WINDOW_WIDTH / 2) starts.push(s)
  if (starts.at(-1) !== strip.width - WINDOW_WIDTH) starts.push(strip.width - WINDOW_WIDTH)
  return starts.map(cut)
}

/** The sum of the vectors made unit length, in 32-bit floats. */
function meanUnit(vectors: readonly Float32Array[]): Float32Array {
  const size = vectors[0]?.length ?? 0
  const out = new Float32Array(size)
  for (const v of vectors) for (let i = 0; i < size; i++) out[i] = (out[i] ?? 0) + (v[i] ?? 0)
  let n = 0
  for (let i = 0; i < size; i++) n += (out[i] ?? 0) * (out[i] ?? 0)
  n = Math.sqrt(n) || 1
  for (let i = 0; i < size; i++) out[i] = (out[i] ?? 0) / n
  return out
}

/** The model's numbers, less their mean, onto the projection's directions, unit length again. */
function project(files: TextFiles, numbers: Float32Array): Float32Array {
  const out = new Float32Array(FINGERPRINT_NUMBERS)
  for (let i = 0; i < MODEL_NUMBERS; i++) {
    const centred = (numbers[i] ?? 0) - (files.mean[i] ?? 0)
    for (let j = 0; j < FINGERPRINT_NUMBERS; j++)
      out[j] = (out[j] ?? 0) + centred * (files.directions[i * FINGERPRINT_NUMBERS + j] ?? 0)
  }
  return meanUnit([out])
}
