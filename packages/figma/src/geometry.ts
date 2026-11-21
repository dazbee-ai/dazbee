// Where a Figma layer is drawn, as a Dazbee box. A node's matrix is composed down the tree by
// FigCraft's rule: a child of a group or boolean may be in its parent's space or the nearest frame's,
// and the one whose box matches the node's own box on the page wins. Each container's turn is then
// taken back about its centre, as the doc draws it; a mirror is a flip before the turn, and what no
// turned, flipped box can show (a skew) is left for a path to take into its data, or dropped.

import { boundsOf, type Box, type Point } from '@dazbee/doc'
import type { Rect } from '@dazbee/schema'
import { apply, type Matrix, multiply, nearestTurnAndFlipOf } from '@dazbee/svg'

import type { LayerInput } from './build.ts'
import { boxOf, field, type FigmaFields, type FigmaNode, list, num } from './read.ts'
import type { Reporter } from './report.ts'

/** Where a node's `relativeTransform` may be relative to: its parent's pixels, or its nearest frame's, each as the page's. */
export interface Space {
  world: Matrix
  frame: Matrix
}

/** A node of `width` × `height` whose own pixels `world` takes to the page's. */
export interface Placement {
  world: Matrix
  width: number
  height: number
  /** Whether the file's size was larger than Dazbee places, and was brought within it. */
  clamped: boolean
}

export interface Flips {
  flipX?: true
  flipY?: true
}

/**
 * How a node is drawn as a Dazbee box: its box in its parent's unturned pixels, before it is
 * brought within Dazbee's reach, turned by its rotation, and flipped.
 */
export interface Pose {
  box: Box
  flips: Flips
  /** Takes the node's own pixels to its box's: what a path's data goes through. */
  toBox: Matrix
  /** Whether the matrix skews, which a box can't show; `toBox` carries the skew only where it was asked to. */
  skewed: boolean
}

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0]
/** Node types whose children Figma may place in the nearest frame's space instead of their own. */
const FOLLOWS: ReadonlySet<string> = new Set(['GROUP', 'BOOLEAN_OPERATION'])
/** Layers placed past these are brought within them, so every number the import writes stays finite. */
const MAX_COORDINATE = 10_000_000
const MAX_SIZE = 1_000_000
/** A matrix that scales or moves further than these is no place Figma draws; the node's box places it instead. */
const MAX_SCALE = 1_000_000
const MAX_MOVE = 1_000_000_000
/**
 * Figma's matrices are 32-bit floats, so a turn's axes are a little off square and a little off
 * unit length; within this share they are read as square and unit.
 */
const FLOAT_SLACK = 1e-6
/** A matrix placing a node further than this from its own box on the page, in pixels, is moved to that box. */
const BOX_SLACK = 1

/** The space `holder`'s children are placed in, its ancestors' matrices composed from the page down. */
export function spaceOf(holder: FigmaNode | null): Space {
  const chain: FigmaNode[] = []
  for (let n = holder; n && n.type !== 'CANVAS' && n.type !== 'DOCUMENT'; n = n.parent) chain.push(n)
  let space: Space = { world: IDENTITY, frame: IDENTITY }
  for (let i = chain.length - 1; i >= 0; i--) {
    const n = chain[i] as FigmaNode
    space = innerSpace(n, placementOf(n, space), space)
  }
  return space
}

/** The space a node's children are placed in, from its own placement and the space it is in. */
export function innerSpace(n: FigmaNode, placement: Placement | undefined, space: Space): Space {
  const world = placement?.world ?? space.world
  return { world, frame: FOLLOWS.has(n.type) ? space.frame : world }
}

/**
 * Where a node is on the page: its `size` placed by its `relativeTransform` in whichever of its
 * parent's spaces puts it on its own box, and moved to that box when neither does; else its box
 * and its turn. Undefined when it has neither a size nor a box.
 */
export function placementOf(n: FigmaNode, space: Space): Placement | undefined {
  const b = boxOf(n.fields)
  const turn = Math.min(1e3, Math.max(-1e3, num(field(n.fields, 'rotation')) ?? 0))
  const own = sizeOf(n.fields) ?? (b && unturnedSize(b, turn))
  if (!own) return undefined
  const width = Math.min(own.width, MAX_SIZE)
  const height = Math.min(own.height, MAX_SIZE)
  const clamped = width !== own.width || height !== own.height
  const rel = matrixOf(field(n.fields, 'relativeTransform'))
  const candidates = rel ? [multiply(space.frame, rel), multiply(space.world, rel)].filter(inReach) : []
  const [first, second] = candidates.map((m) => ({ m, miss: b ? missOf(m, width, height, b) : 0 }))
  const best = first && second && second.miss < first.miss ? second : first
  if (best) {
    if (!b || clamped || best.miss <= BOX_SLACK) return { world: best.m, width, height, clamped }
    const at = apply(best.m, width / 2, height / 2)
    const moved = multiply([1, 0, 0, 1, b.x + b.width / 2 - at.x, b.y + b.height / 2 - at.y], best.m)
    return { world: moved, width, height, clamped }
  }
  if (!b) return undefined
  // Figma's turn is counter-clockwise on screen, in radians, about the box's centre.
  const centre: Matrix = [1, 0, 0, 1, b.x + b.width / 2, b.y + b.height / 2]
  const world = multiply(multiply(centre, turned((-turn * 180) / Math.PI)), [1, 0, 0, 1, -width / 2, -height / 2])
  return { world, width, height, clamped }
}

/** Takes the page's pixels to those of a frame whose top left is at `origin`, where its layers are placed. */
export function frameView(origin: Point): Matrix {
  return [1, 0, 0, 1, -origin.x, -origin.y]
}

/** The view of a container's layers: its parent's view with the container's turn taken back. */
export function viewInside(view: Matrix, turn: number): Matrix {
  return multiply(turned(-turn), view)
}

/**
 * How a node that `x` takes from its own pixels to its parent's unturned pixels is drawn: turned
 * as its first axis is, flipped where it mirrors, and sized by its axes. A skew goes into `toBox`,
 * for a path's data, when `bakes`; else it is dropped, keeping the turn, the flip and the centre.
 */
export function poseOf(x: Matrix, width: number, height: number, bakes: boolean): Pose {
  const { rotation, flipX, flipY } = nearestTurnAndFlipOf(x)
  const flips: Flips = { ...(flipX ? { flipX } : {}), ...(flipY ? { flipY } : {}) }
  // What is left once the turn and flip are taken out: a scale along each axis, and a skew.
  const rest = multiply([flipX ? -1 : 1, 0, 0, flipY ? -1 : 1, 0, 0], multiply(turned(-rotation), x))
  const across = Math.hypot(x[0], x[1])
  const down = Math.hypot(x[2], x[3])
  const skewed = Math.abs(x[0] * x[2] + x[1] * x[3]) > FLOAT_SLACK * across * down
  const scaled: Matrix =
    skewed && bakes ? [rest[0], rest[1], rest[2], rest[3], 0, 0] : [unit(across), 0, 0, unit(down), 0, 0]
  const { xs, ys } = cornersOf(scaled, width, height)
  const size = { width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) }
  const centre = apply(x, width / 2, height / 2)
  const mid = apply(scaled, width / 2, height / 2)
  const toBox = multiply([1, 0, 0, 1, size.width / 2 - mid.x, size.height / 2 - mid.y], scaled)
  return {
    box: { x: centre.x - size.width / 2, y: centre.y - size.height / 2, ...size, rotation },
    flips,
    toBox,
    skewed,
  }
}

/** `box` brought within Dazbee's reach, reported for `n` when it had to be or when `clamped`. */
export function withinReach(report: Reporter, n: FigmaNode, box: Box, clamped = false): Box {
  const out = {
    x: clamp(box.x, -MAX_COORDINATE, MAX_COORDINATE),
    y: clamp(box.y, -MAX_COORDINATE, MAX_COORDINATE),
    width: Math.min(box.width, MAX_SIZE),
    height: Math.min(box.height, MAX_SIZE),
    rotation: box.rotation,
  }
  if (clamped || out.x !== box.x || out.y !== box.y || out.width !== box.width || out.height !== box.height)
    report.add('positions-clamped', n)
  return out
}

/** `b`, a node's box on its page, in the pixels of a frame at `origin`, brought within Dazbee's reach (reported when it had to be). */
export function placed(report: Reporter, n: FigmaNode, b: Rect, origin: Point): Box {
  return withinReach(report, n, { x: b.x - origin.x, y: b.y - origin.y, width: b.width, height: b.height, rotation: 0 })
}

/**
 * A container's box in its parent's unturned pixels, from `own`, the box its layers fit in its own
 * unturned pixels, and its turn: its centre turned into the parent's pixels.
 */
export function turnedOut(own: Rect, turn: number): Box {
  const c = apply(turned(turn), own.x + own.width / 2, own.y + own.height / 2)
  return { x: c.x - own.width / 2, y: c.y - own.height / 2, width: own.width, height: own.height, rotation: turn }
}

/** A box in its own unturned pixels, from the box in its parent's: its centre turned back, and no turn. */
export function unturned(box: Box): Box {
  const c = apply(turned(-box.rotation), box.x + box.width / 2, box.y + box.height / 2)
  return { x: c.x - box.width / 2, y: c.y - box.height / 2, width: box.width, height: box.height, rotation: 0 }
}

/**
 * How far a container's layers, placed in its own unturned pixels, move so that the container's
 * turn about its centre draws them where they are: its centre in its parent's pixels less the same
 * centre in its own.
 */
export function shiftOf(box: Box): Point {
  const own = unturned(box)
  return { x: box.x - own.x, y: box.y - own.y }
}

/**
 * Moves each layer under `root` by the shifts of the containers it is in, so that their turns draw
 * it where it is, then fits each group and boolean to its layers again, as the doc fits them.
 */
export function settle(nodes: Record<string, LayerInput>, root: string, shifts: ReadonlyMap<string, Point>) {
  const kids = new Map<string, string[]>()
  for (const [id, layer] of Object.entries(nodes)) {
    const siblings = kids.get(layer.parentId)
    if (siblings) siblings.push(id)
    else kids.set(layer.parentId, [id])
  }
  const order: string[] = []
  const stack = (kids.get(root) ?? []).map((id): [string, Point] => [id, { x: 0, y: 0 }])
  for (let next = stack.pop(); next; next = stack.pop()) {
    const [id, by] = next
    const { props } = nodes[id] as LayerInput
    props.x += by.x
    props.y += by.y
    order.push(id)
    const shift = shifts.get(id)
    const inner = shift ? { x: by.x + shift.x, y: by.y + shift.y } : by
    for (const kid of kids.get(id) ?? []) stack.push([kid, inner])
  }
  // Children before their parents, so a group fits groups already fitted.
  for (const id of order.reverse()) {
    const layer = nodes[id] as LayerInput
    if (layer.type !== 'group' && layer.type !== 'boolean') continue
    const fit = boundsOf(
      (kids.get(id) ?? []).map((kid) => {
        const p = (nodes[kid] as LayerInput).props
        return { x: p.x, y: p.y, width: p.width, height: p.height, rotation: p.rotation ?? 0 }
      }),
    )
    Object.assign(layer.props, { x: fit.x, y: fit.y, width: fit.width, height: fit.height })
  }
}

/**
 * Takes the node's own pixels, which `x` takes to its parent's unturned pixels, to the pixels of
 * `box` drawn there with `flips`: where a point of the node is in the box's own drawing.
 */
export function boxMapOf(x: Matrix, box: Box, flips: Flips): Matrix {
  const half: Matrix = [1, 0, 0, 1, box.width / 2, box.height / 2]
  const flip: Matrix = [flips.flipX ? -1 : 1, 0, 0, flips.flipY ? -1 : 1, 0, 0]
  const centre: Matrix = [1, 0, 0, 1, -(box.x + box.width / 2), -(box.y + box.height / 2)]
  return multiply(half, multiply(flip, multiply(turned(-box.rotation), multiply(centre, x))))
}

/**
 * Takes a point of the node's unit box, where its gradients' handles are, to the same point of the
 * layer's unit box, through `toBox`, the map from the node's pixels to those of a box of `box`'s size.
 */
export function handlesOf(toBox: Matrix, width: number, height: number, box: Rect): Matrix {
  const into: Matrix = [box.width > 0 ? 1 / box.width : 1, 0, 0, box.height > 0 ? 1 / box.height : 1, 0, 0]
  return multiply(into, multiply(toBox, [width, 0, 0, height, 0, 0]))
}

/** Whether a matrix, when there is one, neither turns, mirrors nor skews, within Figma's float precision. */
export function isUpright(m: Matrix | undefined): boolean {
  return !m || (m[0] > 0 && m[3] > 0 && Math.abs(m[1]) <= FLOAT_SLACK * m[0] && Math.abs(m[2]) <= FLOAT_SLACK * m[3])
}

/** A node's `size`, when its sides are finite and not negative. */
function sizeOf(fields: FigmaFields): { width: number; height: number } | undefined {
  const s = field(fields, 'size')
  const width = num(field(s, 'x'))
  const height = num(field(s, 'y'))
  return width !== undefined && height !== undefined && width >= 0 && height >= 0 ? { width, height } : undefined
}

/** The size of a box that, turned by `turn` radians, has `b` around it (FigCraft's reading of a box with no size). */
function unturnedSize(b: Rect, turn: number): { width: number; height: number } {
  const c = Math.abs(Math.cos(turn))
  const s = Math.abs(Math.sin(turn))
  if (s < 1e-9) return { width: b.width, height: b.height }
  const det = c * c - s * s
  if (Math.abs(det) > 0.05) {
    const width = (b.width * c - b.height * s) / det
    const height = (b.height * c - b.width * s) / det
    if (width >= 0 && height >= 0) return { width, height }
  }
  // Near an eighth of a turn the size can't be told: a box of the same proportions.
  return { width: b.width / (c + s), height: b.height / (c + s) }
}

/** A `relativeTransform`, two rows of three finite numbers, within reach; else undefined. */
function matrixOf(value: unknown): Matrix | undefined {
  const [top, bottom] = [0, 1].map((i) => list(list(value)[i]).map(num))
  const [a, c, e] = top ?? []
  const [b, d, f] = bottom ?? []
  if (a === undefined || b === undefined || c === undefined || d === undefined || e === undefined || f === undefined)
    return undefined
  const m: Matrix = [a, b, c, d, e, f]
  return inReach(m) ? m : undefined
}

function inReach(m: Matrix): boolean {
  return (
    m.every(Number.isFinite) &&
    m.slice(0, 4).every((v) => Math.abs(v) <= MAX_SCALE) &&
    Math.abs(m[4]) <= MAX_MOVE &&
    Math.abs(m[5]) <= MAX_MOVE
  )
}

/** How far the box `m` places a node of `width` × `height` in is from `b`: its four edges' distances added. */
function missOf(m: Matrix, width: number, height: number, b: Rect): number {
  const { xs, ys } = cornersOf(m, width, height)
  const [left, right, top, bottom] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
  return (
    Math.abs(left - b.x) + Math.abs(right - b.x - b.width) + Math.abs(top - b.y) + Math.abs(bottom - b.y - b.height)
  )
}

function cornersOf(m: Matrix, width: number, height: number): { xs: number[]; ys: number[] } {
  const points = [apply(m, 0, 0), apply(m, width, 0), apply(m, width, height), apply(m, 0, height)]
  return { xs: points.map((p) => p.x), ys: points.map((p) => p.y) }
}

/** A turn by `degrees` about the origin. */
function turned(degrees: number): Matrix {
  const t = (degrees * Math.PI) / 180
  return [Math.cos(t), Math.sin(t), -Math.sin(t), Math.cos(t), 0, 0]
}

/** A length that is 1 within Figma's float precision, as 1. */
function unit(length: number): number {
  return Math.abs(length - 1) <= FLOAT_SLACK ? 1 : length
}

function clamp(n: number, low: number, high: number) {
  return Math.min(high, Math.max(low, n))
}
