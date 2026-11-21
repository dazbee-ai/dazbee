// A Figma frame's nodes as Dazbee layers: frames, components and instances inside it become boxes,
// groups become groups fitted to what they hold, booleans of shapes become booleans, rectangles,
// whole ellipses and lines become graphics, and a parent's masks become Mask groups. The nodes are
// read from a work list, never by recursion, so a deep file can't run out of stack. What has no
// layer to become is left out and reported.

import { generateKeyBetween } from 'fractional-indexing'
import type { z } from 'zod'

import { boundsOf, type Box, type Point } from '@dazbee/doc'
import {
  type BooleanOp,
  type FigmaReportLine,
  Layer,
  type LayerTree,
  type LineEnd,
  NodeId,
  type Rect,
} from '@dazbee/schema'

import { boxOf, field, type FigmaFields, type FigmaNode, list, num, str } from './read.ts'
import type { Reporter } from './report.ts'

/** A layer as the import writes it, before the schema fills in its defaults. */
export type LayerInput = z.input<typeof Layer>
type BoxProps = Extract<LayerInput, { type: 'box' }>['props']

/** A layer made from a node: its key and its unturned box in its frame's pixels. */
export interface Piece {
  id: string
  box: Box
}

/** One frame's layers as they are made, with the keys they are given and the report they add to. */
export interface LayerBuild {
  nodes: Record<string, LayerInput>
  /** Each key made from a Figma node, mapped to the node's Figma id. */
  figmaIds: Record<string, string>
  report: Reporter
  /** A key no layer of the frame has, and no Figma id under it will be given. */
  fresh(): string
  /** The key reserved for a node: its Figma id in the link's form, or a fresh one. */
  keyOf(node: FigmaNode): string
}

/** Figma node types that become a frame at the top of a page, and a box inside a frame. */
export const FRAME_TYPES: ReadonlySet<string> = new Set(['FRAME', 'COMPONENT', 'COMPONENT_SET', 'INSTANCE'])
/** Of those, the ones that stop being components when they come in. */
export const COMPONENT_TYPES: ReadonlySet<string> = new Set(['COMPONENT', 'COMPONENT_SET', 'INSTANCE'])
/** Layout modes that lay a frame's children out. */
export const LAID_OUT: ReadonlySet<string> = new Set(['HORIZONTAL', 'VERTICAL', 'GRID'])

/** Layers placed past these are brought within them, so every number the import writes stays finite. */
const MAX_COORDINATE = 10_000_000
const MAX_SIZE = 1_000_000
const MAX_NAME = 200

/** Node types left out by their type, each with its report line. */
const LEFT_OUT: ReadonlyMap<string, FigmaReportLine> = new Map([
  ['SLICE', 'slices'],
  ['TABLE', 'tables'],
  ['TABLE_CELL', 'tables'],
  ['TEXT_PATH', 'text-on-paths'],
  ['TRANSFORM_GROUP', 'transform-groups'],
  ['STICKY', 'figjam-items'],
  ['SHAPE_WITH_TEXT', 'figjam-items'],
  ['CONNECTOR', 'figjam-items'],
  ['WASHI_TAPE', 'figjam-items'],
  ['VECTOR', 'vector-shapes'],
  ['STAR', 'vector-shapes'],
  ['REGULAR_POLYGON', 'vector-shapes'],
  ['TEXT', 'texts'],
])
/** Node types a boolean combines. */
const SHAPE_TYPES: ReadonlySet<string> = new Set([
  'RECTANGLE',
  'ELLIPSE',
  'LINE',
  'VECTOR',
  'STAR',
  'REGULAR_POLYGON',
  'BOOLEAN_OPERATION',
])
const BOOLEAN_OPS: ReadonlyMap<string, BooleanOp> = new Map([
  ['UNION', 'union'],
  ['SUBTRACT', 'subtract'],
  ['INTERSECT', 'intersect'],
  ['EXCLUDE', 'exclude'],
])
const LINE_ENDS: ReadonlyMap<string, LineEnd> = new Map([
  ['LINE_ARROW', 'arrow'],
  ['TRIANGLE_FILLED', 'triangle'],
  ['CIRCLE_FILLED', 'circle'],
])
/** Stroke caps that are no line end: the ends of a plain line. */
const PLAIN_CAPS: ReadonlySet<string> = new Set(['NONE', 'ROUND', 'SQUARE'])

/**
 * A build for one frame's layers. Every node under `within` that has a Figma id, which in the
 * link's form (`:` as `-`, `;` as `_`) is a key no node before it took, keeps that key; the rest
 * are given fresh ones, `n1`, `n2` and so on, skipping the reserved.
 */
export function newLayerBuild(within: readonly FigmaNode[], report: Reporter): LayerBuild {
  const reserved = new Map<FigmaNode, string>()
  const taken = new Set<string>()
  // In the file's order, so the first of two nodes with one key keeps it.
  const stack = [...within].reverse()
  for (let n = stack.pop(); n; n = stack.pop()) {
    const key = n.id.replaceAll(':', '-').replaceAll(';', '_')
    if (n.id && !taken.has(key) && NodeId.safeParse(key).success) {
      reserved.set(n, key)
      taken.add(key)
    }
    for (let i = n.children.length - 1; i >= 0; i--) stack.push(n.children[i] as FigmaNode)
  }
  let next = 0
  const fresh = () => {
    let key = `n${++next}`
    while (taken.has(key)) key = `n${++next}`
    taken.add(key)
    return key
  }
  return { nodes: {}, figmaIds: {}, report, fresh, keyOf: (n) => reserved.get(n) ?? fresh() }
}

/**
 * The layers `children` become, bottom to top, in a frame whose top left is at `origin` on its
 * page, inside a parent that lays its children out when `laidOut`. Also the children that made a
 * layer. The pieces have no parent yet; `adopt` gives them one.
 */
export function convertLayers(
  build: LayerBuild,
  children: readonly FigmaNode[],
  origin: Point,
  laidOut: boolean,
): { pieces: Piece[]; made: FigmaNode[] } {
  const made = new Map<FigmaNode, Piece | null>()
  // In the file's order, so layers are made, and their keys mapped, in it.
  const stack: [FigmaNode, boolean][] = children.map((c): [FigmaNode, boolean] => [c, false]).reverse()
  for (let task = stack.pop(); task; task = stack.pop()) {
    const [n, entered] = task
    if (entered) {
      made.set(n, container(build, n, piecesOf(n.children, made), origin))
    } else if (descends(build, n)) {
      stack.push([n, true], ...n.children.map((c): [FigmaNode, boolean] => [c, false]).reverse())
    } else {
      made.set(n, leaf(build, n, origin))
    }
  }
  const pieces = piecesOf(children, made)
  return { pieces: masked(build, pieces, laidOut), made: children.filter((c) => made.get(c)) }
}

/** Puts `pieces` inside `parentId`, bottom to top. */
export function adopt(build: LayerBuild, parentId: string, pieces: readonly Piece[]) {
  let index: string | null = null
  for (const piece of pieces) {
    index = generateKeyBetween(index, null)
    Object.assign(build.nodes[piece.id] as object, { parentId, index })
  }
}

/** A box of `box`'s size and place holding `pieces`, with `props` of its own. */
export function boxAround(
  build: LayerBuild,
  name: string,
  box: Box,
  pieces: readonly Piece[],
  props: Partial<BoxProps> = {},
): Piece {
  const id = build.fresh()
  build.nodes[id] = layer(id, 'box', name, { ...box, ...props })
  adopt(build, id, pieces)
  return { id, box }
}

/** The frame's layers as a tree whose roots are `roots`, or null when it has none. */
export function treeOf(build: LayerBuild, roots: readonly Piece[]): LayerTree | null {
  if (roots.length === 0) return null
  adopt(build, 'root', roots)
  return { nodes: build.nodes, roots: roots.map((r) => r.id) } as LayerTree
}

/** A node as the report names it. */
export const reported = (n: FigmaNode) => ({ id: n.id, name: n.name })

/**
 * The box a node is placed by, in its frame's pixels, brought within Dazbee's reach (reported when
 * it had to be); undefined when the node has none.
 */
export function placedBox(build: LayerBuild, n: FigmaNode, origin: Point): Box | undefined {
  const b = boxOf(n.fields)
  return b && placed(build, n, b, origin)
}

/** `b`, a node's box on its page, in the pixels of a frame at `origin`, brought within Dazbee's reach (reported when it had to be). */
export function placed(build: LayerBuild, n: FigmaNode, b: Rect, origin: Point): Box {
  const x = clamp(b.x - origin.x, -MAX_COORDINATE, MAX_COORDINATE)
  const y = clamp(b.y - origin.y, -MAX_COORDINATE, MAX_COORDINATE)
  const width = Math.min(b.width, MAX_SIZE)
  const height = Math.min(b.height, MAX_SIZE)
  if (x !== b.x - origin.x || y !== b.y - origin.y || width !== b.width || height !== b.height)
    build.report.add('positions-clamped', reported(n))
  return { x, y, width, height, rotation: 0 }
}

/** A frame's or box's corners: one radius, or each corner's from the top left clockwise. */
export function cornersOf(fields: FigmaFields): number | [number, number, number, number] {
  const radii = list(field(fields, 'rectangleCornerRadii')).map(num)
  if (radii.length === 4 && radii.every((r) => r !== undefined && r >= 0)) {
    const [tl, tr, br, bl] = radii as [number, number, number, number]
    return tl === tr && tr === br && br === bl ? tl : [tl, tr, br, bl]
  }
  return Math.max(0, num(field(fields, 'cornerRadius')) ?? 0)
}

function clamp(n: number, low: number, high: number) {
  return Math.min(high, Math.max(low, n))
}

function piecesOf(nodes: readonly FigmaNode[], made: ReadonlyMap<FigmaNode, Piece | null>): Piece[] {
  return nodes.flatMap((n) => made.get(n) ?? [])
}

/** Whether a node's children are read as layers of its own. */
function descends(build: LayerBuild, n: FigmaNode): boolean {
  if (!n.id || !n.type) return false
  if (n.type === 'GROUP' || n.type === 'SECTION') return true
  // A frame with no box to place it by is left out whole, before its children make layers.
  if (FRAME_TYPES.has(n.type)) return boxOf(n.fields) !== undefined
  if (n.type !== 'BOOLEAN_OPERATION') return false
  if (n.children.every((c) => SHAPE_TYPES.has(c.type))) return true
  build.report.add('vector-shapes', reported(n))
  return false
}

/** The layer a container node becomes from the pieces its children made, or null for none. */
function container(build: LayerBuild, n: FigmaNode, inside: Piece[], origin: Point): Piece | null {
  if (FRAME_TYPES.has(n.type)) {
    const box = placedBox(build, n, origin)
    if (!box) return unreadable(build, n)
    if (COMPONENT_TYPES.has(n.type)) build.report.add('components-and-instances', reported(n))
    const pieces = masked(build, inside, LAID_OUT.has(str(field(n.fields, 'layoutMode')) ?? ''))
    const id = build.keyOf(n)
    build.nodes[id] = layer(
      id,
      'box',
      n.name,
      { ...box, clip: field(n.fields, 'clipsContent') !== false, cornerRadius: cornersOf(n.fields) },
      n,
    )
    build.figmaIds[id] = n.id
    adopt(build, id, pieces)
    return { id, box }
  }
  if (n.type === 'SECTION') build.report.add('sections', reported(n))
  if (inside.length === 0) {
    if (n.type === 'BOOLEAN_OPERATION') build.report.add('vector-shapes', reported(n))
    return null
  }
  const pieces = n.type === 'BOOLEAN_OPERATION' ? inside : masked(build, inside, false)
  const fit = boundsOf(pieces.map((p) => p.box))
  const id = build.keyOf(n)
  build.nodes[id] =
    n.type === 'BOOLEAN_OPERATION'
      ? layer(
          id,
          'boolean',
          n.name,
          { ...fit, op: BOOLEAN_OPS.get(str(field(n.fields, 'booleanOperation')) ?? '') ?? 'union' },
          n,
        )
      : layer(id, 'group', n.name, fit, n)
  build.figmaIds[id] = n.id
  adopt(build, id, pieces)
  return { id, box: fit }
}

/** The layer a node with no layers of its own becomes, or null when it is left out. */
function leaf(build: LayerBuild, n: FigmaNode, origin: Point): Piece | null {
  if (!n.id || !n.type || FRAME_TYPES.has(n.type)) return unreadable(build, n)
  const left = LEFT_OUT.get(n.type)
  if (left) {
    build.report.add(left, reported(n))
    return null
  }
  if (n.type !== 'RECTANGLE' && n.type !== 'ELLIPSE' && n.type !== 'LINE') {
    // A boolean arrives here only when it holds a layer that is no shape, already reported.
    if (n.type !== 'BOOLEAN_OPERATION') build.report.add('unknown-layers', reported(n))
    return null
  }
  if (n.type === 'ELLIPSE' && !isWhole(n.fields)) {
    build.report.add('vector-shapes', reported(n))
    return null
  }
  const box = placedBox(build, n, origin)
  if (!box) return unreadable(build, n)
  const id = build.keyOf(n)
  build.nodes[id] = layer(id, 'graphic', n.name, { ...box, shape: shapeOf(build, n) }, n)
  build.figmaIds[id] = n.id
  return { id, box }
}

function unreadable(build: LayerBuild, n: FigmaNode): null {
  build.report.add('unreadable-layers', reported(n))
  return null
}

/** Whether an ellipse is whole: no arc cut from it and no hole in it. */
function isWhole(fields: FigmaFields): boolean {
  const arc = field(fields, 'arcData')
  if (arc === undefined) return true
  const start = num(field(arc, 'startingAngle')) ?? 0
  const end = num(field(arc, 'endingAngle')) ?? 2 * Math.PI
  const inner = num(field(arc, 'innerRadius')) ?? 0
  return inner <= 0 && Math.abs(end - start) >= 2 * Math.PI - 1e-6
}

function shapeOf(build: LayerBuild, n: FigmaNode): Extract<LayerInput, { type: 'graphic' }>['props']['shape'] {
  if (n.type === 'ELLIPSE') return { kind: 'ellipse' }
  if (n.type === 'LINE') {
    const cap = str(field(n.fields, 'strokeCap')) ?? 'NONE'
    const end = LINE_ENDS.get(cap)
    if (!end && !PLAIN_CAPS.has(cap)) build.report.add('line-ends', reported(n))
    return { kind: 'line', start: end ?? 'none', end: end ?? 'none' }
  }
  const corners = cornersOf(n.fields)
  return typeof corners === 'number' ? { kind: 'rect', cornerRadius: corners } : { kind: 'rect', corners }
}

/**
 * A layer of `type` named `name` with `props`, a mask when `from` masks the layers in front of it,
 * placed nowhere until it is adopted.
 */
function layer<T extends LayerInput['type']>(
  id: string,
  type: T,
  name: string,
  props: object,
  from?: FigmaNode,
): LayerInput {
  const mask =
    from && field(from.fields, 'isMask') === true
      ? field(from.fields, 'maskType') === 'LUMINANCE'
        ? 'luminance'
        : 'alpha'
      : undefined
  return {
    type,
    parentId: 'root',
    link: id,
    index: 'a0',
    name: name.slice(0, MAX_NAME),
    props: { ...props, ...(mask ? { mask } : {}) },
  } as LayerInput
}

/**
 * A parent's pieces with its masks as Dazbee draws them. A Figma mask masks every layer in front
 * of it, a later mask and its layers too, where a Dazbee mask stops at the next one; so each mask
 * after the first goes, with every piece above it, into a group of its own, nested in order, which
 * the mask before it masks. In a parent that lays its children out, that group would take one
 * place in the flow, so there the masks stay side by side, reported.
 */
function masked(build: LayerBuild, pieces: Piece[], laidOut: boolean): Piece[] {
  const at = pieces.flatMap((p, i) => (build.nodes[p.id]?.props.mask ? [i] : []))
  if (at.length < 2) return pieces
  if (laidOut) {
    build.report.add('masks-separate')
    return pieces
  }
  let inner: Piece | null = null
  for (let k = at.length - 1; k >= 1; k--) {
    const from = at[k] as number
    const segment = [...pieces.slice(from, at[k + 1] ?? pieces.length), ...(inner ? [inner] : [])]
    const fit = boundsOf(segment.map((p) => p.box))
    const id = build.fresh()
    build.nodes[id] = layer(id, 'group', build.nodes[(pieces[from] as Piece).id]?.name ?? 'Mask', fit)
    adopt(build, id, segment)
    inner = { id, box: fit }
  }
  return [...pieces.slice(0, at[1]), inner as Piece]
}
