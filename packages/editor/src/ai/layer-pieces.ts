// What Make editable's finish reads of a done layering job, before any picture is drawn: which split call and which
// layer plan are a frame's, where its split layers are among the job's files, and its split pieces when the split cut
// any; each split layer's and each piece's name from the plan, where a layer's visible part is in it, where a piece
// goes in the frame, the link id a piece shares with the same part of the job's other frames, and the ids of the
// layers the finish places, which come from the job so a second finish writes the same ones.
import { imagePlacement } from '@dazbee/renderer'
import {
  type AiFrameView,
  type AiJobView,
  type ImageCrop,
  LAYERING_CALL,
  LayerPlanAnswer,
  type MadePiece,
  type MadePieces,
} from '@dazbee/schema'

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

type Calls = Pick<AiJobView, 'calls'>
type FrameCall = Pick<AiFrameView, 'callIndex'>
type Size = Pick<PieceBox, 'width' | 'height'>
type PlanElement = LayerPlanAnswer['elements'][number]

/** How opaque a pixel must be, 0 to 255, to count as part of what a layer shows. */
const SEEN = 8
/** The longest a layer id or a link id may be (the `Id` rule). */
const ID_LENGTH = 64
/** The longest name a layer is given. */
const NAME_LENGTH = 100
/** The kinds of planned part an ad usually has one of, whatever a plan names it. */
const ONE_OF_A_KIND: ReadonlySet<string> = new Set(['logo', 'cutout', 'photo', 'background'])
/** How far past a whole pixel a piece's edge may be and still be on it: the arithmetic's rounding, never part of a pixel. */
const ROUNDING = 1e-6

/**
 * The layer plan AI frame `frame` was split by, once its plan call is done: the first frame's in a job with one
 * layer plan for all its frames, else the frame's own; null before, or when it can't be read.
 */
export function layerPlanOf(job: Calls, frame: FrameCall): LayerPlanAnswer | null {
  const index = onePlan(job) ? LAYERING_CALL.plan(0) : LAYERING_CALL.plan((frame.callIndex - 1) / 2)
  const call = job.calls.find((c) => c.index === index) ?? null
  if (call?.state !== 'done' || call.output.kind !== 'text') return null
  const plan = LayerPlanAnswer.safeParse(call.output.json)
  return plan.success ? plan.data : null
}

/** Whether a layering job has one layer plan for all its frames: no plan call but the first frame's. */
export function onePlan(job: Calls): boolean {
  return !job.calls.some((c) => c.index >= LAYERING_CALL.plan(1))
}

/**
 * Where AI frame `frame`'s split layers are among its layering job's files (each split call's layers, in the order
 * of its call index, as `layeringFiles` numbers them), and each one's size; null while its split isn't done.
 */
export function frameLayers(job: Calls, frame: FrameCall): FrameLayers | null {
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

/** AI frame `frame`'s split pieces, from its split call's output; null when its split cut none, or isn't done. */
export function framePieces(job: Calls, frame: FrameCall): MadePieces | null {
  const call = job.calls.find((c) => c.index === frame.callIndex)
  const pieces = call?.state === 'done' && call.output.kind === 'layers' ? call.output.pieces : undefined
  return pieces && pieces.items.length > 0 ? pieces : null
}

/**
 * The name of split layer `index` (from 0, as the split gives them): the names of the plan's elements the planner put
 * in that layer, else `fallback` with its number.
 */
export function layerName(plan: LayerPlanAnswer | null, index: number, fallback: string): string {
  const names = (plan?.elements ?? []).filter((e) => e.ming_layer === index + 1).map((e) => e.name.trim())
  const named = names.filter(Boolean).join(', ')
  return named === '' ? `${fallback} ${index + 1}` : named.slice(0, NAME_LENGTH)
}

/**
 * The name of split piece `piece`, number `n` of its frame's pieces (from 0): its planned part's name in the frame's
 * plan `plan`; `fallback` with its number for a piece of no part, of a part the plan doesn't have or of one with no
 * name.
 */
export function pieceName(
  plan: LayerPlanAnswer | null,
  piece: Pick<MadePiece, 'part'>,
  n: number,
  fallback: string,
): string {
  const name = partOf(plan, piece)?.name.trim() ?? ''
  return name === '' ? `${fallback} ${n + 1}` : name.slice(0, NAME_LENGTH)
}

/**
 * The link id split piece `piece` shares with the pieces of the same part in the other frames of job `jobId`: the
 * job's id, a hyphen and the hash of the kind and words of its planned part in the frame's plan `plan`. Null for a
 * piece of no part, of a part the plan doesn't have, or of a part whose kind and words another part of the plan
 * shares. A logo, a cut-out, a photo or a background that is the plan's only one links by its kind alone, since
 * two plans of one ad name the same logo differently.
 */
export function pieceLink(jobId: string, plan: LayerPlanAnswer | null, piece: Pick<MadePiece, 'part'>): string | null {
  const part = partOf(plan, piece)
  if (!plan || !part) return null
  const said = kindAndWords(part, plan)
  if (plan.elements.filter((e) => kindAndWords(e, plan) === said).length > 1) return null
  const tail = `-${fnv1a(said)}`
  return jobId.slice(0, ID_LENGTH - tail.length) + tail
}

/** The link ids that split pieces of two or more of `frames`, AI frames of job `job`, have. */
export function sharedLinks(job: Pick<AiJobView, 'id' | 'calls'>, frames: readonly FrameCall[]): Set<string> {
  const held = new Set<string>()
  const shared = new Set<string>()
  for (const frame of frames) {
    const plan = layerPlanOf(job, frame)
    const links = new Set((framePieces(job, frame)?.items ?? []).map((piece) => pieceLink(job.id, plan, piece)))
    for (const link of links) {
      if (link === null) continue
      if (held.has(link)) shared.add(link)
      held.add(link)
    }
  }
  return shared
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
  return wholeBox(box.x * k, box.y * k, (box.x + box.width) * k, (box.y + box.height) * k)
}

/**
 * The box of split piece `piece` in a frame of size `frame`, grown to whole pixels around it: its place in the
 * picture, of size `picture`, carried over by where the picture's own image fill draws the picture in a layer
 * filling the frame, which covers it at one scale, centred.
 */
export function pieceBox(piece: Pick<MadePiece, 'x' | 'y' | 'picture'>, picture: Size, frame: Size): PieceBox {
  const drawn = imagePlacement(picture, { fit: 'fill' }, { x: 0, y: 0, width: frame.width, height: frame.height })
  const k = drawn.width / picture.width
  return wholeBox(
    drawn.x + piece.x * k,
    drawn.y + piece.y * k,
    drawn.x + (piece.x + piece.picture.width) * k,
    drawn.y + (piece.y + piece.picture.height) * k,
    ROUNDING,
  )
}

/**
 * The crop of split piece `piece`'s own picture that its box in a frame of size `frame` shows: the box carried back
 * into the piece's pixels. An image fill cut to it draws the piece at the scale the picture is drawn at, in its
 * place, and nothing where the box, grown to whole pixels, reaches past the piece.
 */
export function pieceCrop(piece: Pick<MadePiece, 'x' | 'y' | 'picture'>, picture: Size, frame: Size): ImageCrop {
  const drawn = imagePlacement(picture, { fit: 'fill' }, { x: 0, y: 0, width: frame.width, height: frame.height })
  const k = drawn.width / picture.width
  const box = pieceBox(piece, picture, frame)
  return {
    x: (box.x - drawn.x) / k - piece.x,
    y: (box.y - drawn.y) / k - piece.y,
    width: box.width / k,
    height: box.height / k,
  }
}

/** The id of the layer the finish places for split layer or split piece `index` of frame `frameId`, from the job's id. */
export function pieceId(jobId: string, frameId: string, index: number): string {
  const tail = `-${index}`
  return `${jobId}-${frameId}`.slice(0, ID_LENGTH - tail.length) + tail
}

/** The planned part split piece `piece` is, in layer plan `plan`, when the plan has it. */
function partOf(plan: LayerPlanAnswer | null, piece: Pick<MadePiece, 'part'>): PlanElement | undefined {
  return piece.part === null ? undefined : plan?.elements.find((e) => e.id === piece.part)
}

/**
 * A planned part's kind and words in its plan, the same for the same part in any letter case and spacing: a text
 * part's words are what it says, and its name when it says nothing; any other part's are its name. A part of a
 * kind an ad has one of, when it is the plan's only one, has no words.
 */
function kindAndWords(part: PlanElement, plan: LayerPlanAnswer): string {
  if (ONE_OF_A_KIND.has(part.kind) && plan.elements.filter((e) => e.kind === part.kind).length === 1) return part.kind
  const tidy = (words: string) => words.toLowerCase().replace(/\s+/g, ' ').trim()
  const said = part.kind === 'text' ? tidy(part.content) : ''
  return `${part.kind}:${said === '' ? tidy(part.name) : said}`
}

/** The 32-bit FNV-1a hash of `text`'s UTF-8 bytes, as 8 hex characters. */
function fnv1a(text: string): string {
  let hash = 0x811c9dc5
  for (const byte of new TextEncoder().encode(text)) hash = Math.imul(hash ^ byte, 0x01000193)
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/**
 * The whole pixels around the box from `left`, `top` to `right`, `bottom`, at least one pixel each way; an edge
 * within `rounding` of a whole pixel is on it.
 */
function wholeBox(left: number, top: number, right: number, bottom: number, rounding = 0): PieceBox {
  const x = Math.floor(left + rounding)
  const y = Math.floor(top + rounding)
  return {
    x,
    y,
    width: Math.max(1, Math.ceil(right - rounding) - x),
    height: Math.max(1, Math.ceil(bottom - rounding) - y),
  }
}
