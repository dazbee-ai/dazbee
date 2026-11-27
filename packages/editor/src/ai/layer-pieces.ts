// What Make editable's finish reads of a done layering job, before any picture is drawn: which split call is a
// frame's, where its layers are among the job's files, each split layer's name from the layer plan, where a layer's
// visible part is in it, and the ids of the layers the finish places, which come from the job so a second finish
// writes the same ones.
import { type AiFrameView, type AiJobView, LAYERING_CALL, LayerPlanAnswer } from '@dazbee/schema'

/** A box in pixels. */
export interface PieceBox {
  x: number
  y: number
  width: number
  height: number
}

/** A frame's split layers as the job's files number them: where they start, and each layer's working size. */
export interface FrameLayers {
  first: number
  layers: { width: number; height: number }[]
}

/** How opaque a pixel must be, 0 to 255, to count as part of what a layer shows. */
const SEEN = 8
/** The longest a layer id may be (the `Id` rule). */
const ID_LENGTH = 64

/** The layer plan of a layering job, once its plan call is done; null before, or when it can't be read. */
export function layerPlanOf(job: Pick<AiJobView, 'calls'>): LayerPlanAnswer | null {
  const call = job.calls.find((c) => c.index === LAYERING_CALL.plan)
  if (call?.state !== 'done' || call.output.kind !== 'text') return null
  const plan = LayerPlanAnswer.safeParse(call.output.json)
  return plan.success ? plan.data : null
}

/**
 * Where AI frame `frame`'s split layers are among its layering job's files (each split call's layers, in the order
 * of its call index, as `layeringFiles` numbers them), and each one's size; null while its split isn't done.
 */
export function frameLayers(job: Pick<AiJobView, 'calls'>, frame: Pick<AiFrameView, 'callIndex'>): FrameLayers | null {
  let first = 0
  for (const call of [...job.calls].sort((a, b) => a.index - b.index)) {
    if (call.state !== 'done' || call.output.kind !== 'layers') {
      if (call.index === frame.callIndex) return null
      continue
    }
    const layers = call.output.layers.map(({ width, height }) => ({ width, height }))
    if (call.index === frame.callIndex) return { first, layers }
    first += layers.length
  }
  return null
}

/**
 * The name of split layer `index` (from 0, as the split gives them): the names of the plan's elements the planner put
 * in that layer, else `fallback` with its number.
 */
export function layerName(plan: LayerPlanAnswer | null, index: number, fallback: string): string {
  const names = (plan?.elements ?? []).filter((e) => e.ming_layer === index + 1).map((e) => e.name.trim())
  const named = names.filter(Boolean).join(', ')
  return named === '' ? `${fallback} ${index + 1}` : named.slice(0, 100)
}

/**
 * The box of what an alpha map shows, in its own pixels: every pixel at least a little opaque; null when it shows
 * nothing.
 */
export function visibleBox(alpha: Uint8Array, width: number, height: number): PieceBox | null {
  let [left, top, right, bottom] = [width, height, -1, -1]
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if ((alpha[y * width + x] ?? 0) < SEEN) continue
      if (x < left) left = x
      if (x > right) right = x
      if (y < top) top = y
      if (y > bottom) bottom = y
    }
  }
  return right < 0 ? null : { x: left, y: top, width: right - left + 1, height: bottom - top + 1 }
}

/** `box`, measured in pixels of a picture `from` wide, scaled to one `to` wide and grown to whole pixels around it. */
export function scaleBox(box: PieceBox, from: number, to: number): PieceBox {
  const k = to / from
  const x = Math.floor(box.x * k)
  const y = Math.floor(box.y * k)
  return {
    x,
    y,
    width: Math.max(1, Math.ceil((box.x + box.width) * k) - x),
    height: Math.max(1, Math.ceil((box.y + box.height) * k) - y),
  }
}

/** The id of the layer the finish places for split layer `index` of frame `frameId`, from the job's id. */
export function pieceId(jobId: string, frameId: string, index: number): string {
  const tail = `-${index}`
  return `${jobId}-${frameId}`.slice(0, ID_LENGTH - tail.length) + tail
}
