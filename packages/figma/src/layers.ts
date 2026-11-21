// A Figma frame's nodes as Dazbee layers: frames, components and instances inside it become boxes,
// groups become groups fitted to what they hold, booleans of shapes become booleans, rectangles,
// whole ellipses and lines become graphics, and a parent's masks become Mask groups. The nodes are
// read from a work list, never by recursion, so a deep file can't run out of stack. What has no
// layer to become is left out and reported.

import { boundsOf, type Box, type Point } from '@dazbee/doc'
import type { BooleanOp, LayerTree } from '@dazbee/schema'

import {
  adopt,
  COMPONENT_TYPES,
  FRAME_TYPES,
  layer,
  type LayerBuild,
  type LayerInput,
  type Piece,
  ROOT,
  unreadable,
} from './build.ts'
import { placedBox } from './geometry.ts'
import { type Corners, cornersOf, leaf, SHAPE_TYPES } from './graphics.ts'
import { boxOf, field, type FigmaFields, type FigmaNode, str } from './read.ts'

type BoxProps = Extract<LayerInput, { type: 'box' }>['props']

/** Layout modes that lay a frame's children out. */
const LAID_OUT: ReadonlySet<string> = new Set(['HORIZONTAL', 'VERTICAL', 'GRID'])

const BOOLEAN_OPS: ReadonlyMap<string, BooleanOp> = new Map([
  ['UNION', 'union'],
  ['SUBTRACT', 'subtract'],
  ['INTERSECT', 'intersect'],
  ['EXCLUDE', 'exclude'],
])

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
  adopt(build, ROOT, roots)
  return { nodes: build.nodes, roots: roots.map((r) => r.id) } as LayerTree
}

/** Whether a frame lays its children out. */
export function laysOut(fields: FigmaFields): boolean {
  return LAID_OUT.has(str(field(fields, 'layoutMode')) ?? '')
}

/** What a frame's box draws of its own: whether it clips, and its corners. */
export function boxLook(fields: FigmaFields): { clip: boolean; cornerRadius: Corners } {
  return { clip: field(fields, 'clipsContent') !== false, cornerRadius: cornersOf(fields) }
}

/** The layer a container node becomes from the pieces its children made, or null for none. */
function container(build: LayerBuild, n: FigmaNode, inside: Piece[], origin: Point): Piece | null {
  if (FRAME_TYPES.has(n.type)) {
    const box = placedBox(build, n, origin)
    if (!box) return unreadable(build, n)
    if (COMPONENT_TYPES.has(n.type)) build.report.add('components-and-instances', n)
    const pieces = masked(build, inside, laysOut(n.fields))
    const id = build.keyOf(n)
    build.nodes[id] = layer(id, 'box', n.name, { ...box, ...boxLook(n.fields) }, n)
    build.figmaIds[id] = n.id
    adopt(build, id, pieces)
    return { id, box }
  }
  if (n.type === 'SECTION') build.report.add('sections', n)
  if (inside.length === 0) {
    if (n.type === 'BOOLEAN_OPERATION') build.report.add('vector-shapes', n)
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
  build.report.add('vector-shapes', n)
  return false
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
