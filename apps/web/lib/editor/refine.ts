// What Refine with AI reads of a design's AI frames: whether a frame is being refined, the versions of its picture
// (the first one, then each refine's new version), which layer a refine changes, and the marks a person draws over
// the frame, drawn as the marks picture the refine plan reads: numbered boxes and strokes in Dazbee's blue on
// transparency, at the frame's proportions.
import { REFINE_EDIT } from '@dazbee/editor'
import { type DesignAi, pictureLayerOf } from '@dazbee/schema'

/** A point of the frame, in its design pixels. */
export interface MarkPoint {
  x: number
  y: number
}

/** A mark over a frame, in its design pixels: a box from one corner to the other, or a brush stroke. */
export type Mark = { kind: 'box'; from: MarkPoint; to: MarkPoint } | { kind: 'brush'; points: MarkPoint[] }

/** One version of a frame's picture: its asset, and the refine that made it, null for the first. */
export interface FrameVersion {
  assetId: string
  refineId: string | null
}

/** What draws the marks picture: the part of a 2D canvas it uses. */
export interface MarksPen {
  strokeStyle: string | CanvasGradient | CanvasPattern
  fillStyle: string | CanvasGradient | CanvasPattern
  lineWidth: number
  lineCap: CanvasLineCap
  lineJoin: CanvasLineJoin
  beginPath(): void
  moveTo(x: number, y: number): void
  lineTo(x: number, y: number): void
  arc(x: number, y: number, radius: number, start: number, end: number): void
  stroke(): void
  fill(): void
  strokeRect(x: number, y: number, width: number, height: number): void
}

/** Dazbee's blue, the marks' colour, as the stage's accent. */
export const MARKS_BLUE = '#3D6BFF'

/** The longest side of the marks picture: the refine plan stretches it over the picture. */
export const MARKS_SIDE = 1024

/** Each digit as strokes in a 0–1 box, from top left: what a mark's number is drawn with, needing no font. */
const DIGITS: Record<string, [number, number][][]> = {
  '0': [
    [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
      [0, 0],
    ],
  ],
  '1': [
    [
      [0.5, 0],
      [0.5, 1],
    ],
  ],
  '2': [
    [
      [0, 0],
      [1, 0],
      [1, 0.5],
      [0, 0.5],
      [0, 1],
      [1, 1],
    ],
  ],
  '3': [
    [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ],
    [
      [0, 0.5],
      [1, 0.5],
    ],
  ],
  '4': [
    [
      [0, 0],
      [0, 0.5],
      [1, 0.5],
    ],
    [
      [1, 0],
      [1, 1],
    ],
  ],
  '5': [
    [
      [1, 0],
      [0, 0],
      [0, 0.5],
      [1, 0.5],
      [1, 1],
      [0, 1],
    ],
  ],
  '6': [
    [
      [1, 0],
      [0, 0],
      [0, 1],
      [1, 1],
      [1, 0.5],
      [0, 0.5],
    ],
  ],
  '7': [
    [
      [0, 0],
      [1, 0],
      [1, 1],
    ],
  ],
  '8': [
    [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
      [0, 0],
    ],
    [
      [0, 0.5],
      [1, 0.5],
    ],
  ],
  '9': [
    [
      [1, 0.5],
      [0, 0.5],
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ],
  ],
}

/** Whether AI frame `frameId` is being refined now: a refine of it whose new version hasn't been written. */
export function refining(ai: DesignAi | null, frameId: string): boolean {
  return (ai?.refines ?? []).some(
    (r) => r.frameId === frameId && r.resultAssetId === null && !ai?.jobs.find((j) => j.id === r.jobId)?.endedAt,
  )
}

/**
 * The versions of AI frame `frameId`'s picture, oldest first: the picture its call made, then each refine's new
 * version once made; none for a frame that isn't an AI frame or has no picture yet.
 */
export function frameVersions(ai: DesignAi | null, frameId: string): FrameVersion[] {
  const frame = ai?.frames.find((f) => f.frameId === frameId)
  if (!ai || !frame) return []
  const made = (jobId: string, index: number) => {
    const call = ai.jobs.find((j) => j.id === jobId)?.calls.find((c) => c.index === index)
    return call?.state === 'done' && call.output.kind === 'pictures' ? (call.output.pictures[0]?.assetId ?? null) : null
  }
  const first = made(frame.jobId, frame.callIndex)
  const versions: FrameVersion[] = first ? [{ assetId: first, refineId: null }] : []
  for (const refine of ai.refines) {
    if (refine.frameId !== frameId) continue
    const assetId = refine.resultAssetId ?? made(refine.jobId, REFINE_EDIT)
    if (assetId) versions.push({ assetId, refineId: refine.id })
  }
  return versions
}

/**
 * The layer a refine of AI frame `frameId` changes: on an editable frame, the selected layer of the frame that shows
 * a picture, null when none is selected; else the frame's picture layer.
 */
export function refineLayer(
  ai: DesignAi | null,
  frameId: string,
  selected: readonly { id: string; parentId: string; image: boolean }[],
): string | null {
  const frame = ai?.frames.find((f) => f.frameId === frameId)
  if (frame?.state !== 'editable') return pictureLayerOf(frameId)
  const [only] = selected
  return selected.length === 1 && only?.parentId === frameId && only.image ? only.id : null
}

/**
 * Draws `marks` over a frame of `size` onto `pen`, scaled to a picture of `width` × `height`: each a blue outline in
 * the order drawn, numbered from 1 in a blue disc at its start.
 */
export function drawMarks(
  pen: MarksPen,
  marks: readonly Mark[],
  size: { width: number; height: number },
  picture: { width: number; height: number },
): void {
  const k = picture.width / size.width
  const line = Math.max(3, Math.round(picture.width / 160))
  pen.lineCap = 'round'
  pen.lineJoin = 'round'
  marks.forEach((mark, n) => {
    pen.strokeStyle = MARKS_BLUE
    pen.lineWidth = line
    if (mark.kind === 'box') {
      const x = Math.min(mark.from.x, mark.to.x) * k
      const y = Math.min(mark.from.y, mark.to.y) * k
      pen.strokeRect(x, y, Math.abs(mark.to.x - mark.from.x) * k, Math.abs(mark.to.y - mark.from.y) * k)
    } else {
      pen.beginPath()
      mark.points.forEach((p, i) => (i === 0 ? pen.moveTo(p.x * k, p.y * k) : pen.lineTo(p.x * k, p.y * k)))
      pen.stroke()
    }
    const at =
      mark.kind === 'box'
        ? { x: Math.min(mark.from.x, mark.to.x), y: Math.min(mark.from.y, mark.to.y) }
        : mark.points[0]
    if (at) drawNumber(pen, n + 1, at.x * k, at.y * k, line * 5)
  })
}

/** The marks picture's size for a frame of `size`: its proportions, its longest side `MARKS_SIDE`. */
export function marksSize(size: { width: number; height: number }): { width: number; height: number } {
  const k = MARKS_SIDE / Math.max(size.width, size.height)
  return { width: Math.max(1, Math.round(size.width * k)), height: Math.max(1, Math.round(size.height * k)) }
}

/** Number `n` in white strokes on a blue disc of `radius` centred at `x`, `y`. */
function drawNumber(pen: MarksPen, n: number, x: number, y: number, radius: number) {
  pen.fillStyle = MARKS_BLUE
  pen.beginPath()
  pen.arc(x, y, radius, 0, Math.PI * 2)
  pen.fill()
  const digits = String(n).split('')
  const height = radius * 0.9
  const width = height * 0.5
  const gap = width * 0.5
  const total = digits.length * width + (digits.length - 1) * gap
  pen.strokeStyle = '#FFFFFF'
  pen.lineWidth = Math.max(2, radius / 5)
  digits.forEach((digit, i) => {
    const left = x - total / 2 + i * (width + gap)
    const top = y - height / 2
    for (const stroke of DIGITS[digit] ?? []) {
      pen.beginPath()
      stroke.forEach(([dx, dy], j) =>
        j === 0 ? pen.moveTo(left + dx * width, top + dy * height) : pen.lineTo(left + dx * width, top + dy * height),
      )
      pen.stroke()
    }
  })
}
