// A Figma frame's nodes as Dazbee layers: frames, components and instances inside it become boxes,
// groups become groups fitted to what they hold, booleans of shapes become booleans, what holds no
// layers becomes a graphic (graphics.ts), and a parent's masks become Mask groups. Each is placed
// where Figma draws it (geometry.ts), its container's turn taken back. The nodes are read from a
// work list, never by recursion, so a deep file can't run out of stack. What has no layer to
// become is left out and reported.

import { boundsOf, type Box, type Point } from '@dazbee/doc'
import type { BooleanOp, LayerTree } from '@dazbee/schema'
import { type Matrix, multiply } from '@dazbee/svg'

import {
  addLayer,
  adopt,
  COMPONENT_TYPES,
  FRAME_TYPES,
  layer,
  type LayerBuild,
  type LayerInput,
  paintsOf,
  type Piece,
  ROOT,
  unreadable,
} from './build.ts'
import {
  boxMapOf,
  type Flips,
  frameView,
  handlesOf,
  innerSpace,
  type Placement,
  placementOf,
  type Pose,
  poseOf,
  settle,
  shiftOf,
  type Space,
  spaceOf,
  turnedOut,
  viewInside,
  withinReach,
} from './geometry.ts'
import { type Corners, cornersOf, leaf, type Place, SHAPE_TYPES } from './graphics.ts'
import { field, type FigmaFields, type FigmaNode, str } from './read.ts'

type BoxProps = Extract<LayerInput, { type: 'box' }>['props']

/** A container node as it is entered: where it is, and where its children are made. */
interface Entered {
  placement: Placement | undefined
  /** Takes its own pixels to its parent's unturned pixels. */
  toParent: Matrix | undefined
  pose: Pose | undefined
  inside: Place
}

/** A node to make: where it is made, and, once entered as a container, what it was entered as. */
type Task = [FigmaNode, Place, Entered | null]

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
  const spaces = new Map<FigmaNode | null, Space>()
  const placeOf = (n: FigmaNode): Place => {
    let space = spaces.get(n.parent)
    if (!space) spaces.set(n.parent, (space = spaceOf(n.parent)))
    return { space, view: frameView(origin), inBoolean: false }
  }
  // In the file's order, so layers are made, and their keys mapped, in it.
  const tasksOf = (nodes: readonly FigmaNode[], at: (n: FigmaNode) => Place) =>
    nodes.map((c): Task => [c, at(c), null]).reverse()
  const stack = tasksOf(children, placeOf)
  for (let task = stack.pop(); task; task = stack.pop()) {
    const [n, place, entered] = task
    if (entered) {
      made.set(n, container(build, n, piecesOf(n.children, made), entered))
    } else if (descends(n)) {
      const opened = enter(n, place)
      // A frame with no place is left out whole, before its children make layers.
      if (FRAME_TYPES.has(n.type) && !opened.pose) made.set(n, unreadable(build, n))
      else stack.push([n, place, opened], ...tasksOf(n.children, () => opened.inside))
    } else {
      made.set(n, leaf(build, n, place))
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

/**
 * The frame's layers as a tree whose roots are `roots`, each moved to where its containers' turns
 * draw it, or null when it has none.
 */
export function treeOf(build: LayerBuild, roots: readonly Piece[]): LayerTree | null {
  if (roots.length === 0) return null
  adopt(build, ROOT, roots)
  settle(build.nodes, ROOT, build.shifts)
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

/**
 * The layer a container node becomes from the pieces its children made, or null for none. A box
 * takes its box from its matrix; a group or boolean fits what it holds, turned as its matrix is.
 */
function container(build: LayerBuild, n: FigmaNode, inside: Piece[], entered: Entered): Piece | null {
  const { placement, toParent, pose } = entered
  if (FRAME_TYPES.has(n.type) && placement && pose) {
    if (COMPONENT_TYPES.has(n.type)) build.report.add('components-and-instances', n)
    if (pose.skewed) build.report.add('skewed-layers', n)
    const box = withinReach(build.report, n, pose.box, placement.clamped)
    const id = addLayer(build, n, 'box', { ...box, ...pose.flips, ...boxLook(n.fields) })
    build.paints[id] = paintsOf(n, handlesOf(pose.toBox, placement.width, placement.height, box))
    build.shifts.set(id, shiftOf(box))
    adopt(build, id, masked(build, inside, laysOut(n.fields)))
    return { id, box }
  }
  if (n.type === 'SECTION') build.report.add('sections', n)
  if (inside.length === 0) {
    if (n.type === 'BOOLEAN_OPERATION') build.report.add('shapes-without-outlines', n)
    return null
  }
  const isBoolean = n.type === 'BOOLEAN_OPERATION'
  const pieces = isBoolean ? inside : masked(build, inside, false)
  const box = turnedOut(boundsOf(pieces.map((p) => p.box)), pose?.box.rotation ?? 0)
  const flips: Flips = isBoolean ? (pose?.flips ?? {}) : {}
  const op = BOOLEAN_OPS.get(str(field(n.fields, 'booleanOperation')) ?? '') ?? 'union'
  const id = isBoolean ? addLayer(build, n, 'boolean', { ...box, ...flips, op }) : addLayer(build, n, 'group', box)
  if (isBoolean && placement && toParent)
    build.paints[id] = paintsOf(n, handlesOf(boxMapOf(toParent, box, flips), placement.width, placement.height, box))
  build.shifts.set(id, shiftOf(box))
  adopt(build, id, pieces)
  return { id, box }
}

function piecesOf(nodes: readonly FigmaNode[], made: ReadonlyMap<FigmaNode, Piece | null>): Piece[] {
  return nodes.flatMap((n) => made.get(n) ?? [])
}

/** Whether a node's children are read as layers of its own: a frame's, a group's, a section's, and a boolean's of shapes. */
function descends(n: FigmaNode): boolean {
  if (!n.id || !n.type) return false
  if (n.type === 'GROUP' || n.type === 'SECTION' || FRAME_TYPES.has(n.type)) return true
  return n.type === 'BOOLEAN_OPERATION' && n.children.every((c) => SHAPE_TYPES.has(c.type))
}

/** A container node as it is entered: where its matrix puts it, and where its children are made. */
function enter(n: FigmaNode, place: Place): Entered {
  const placement = placementOf(n, place.space)
  const toParent = placement && multiply(place.view, placement.world)
  const pose = placement && toParent && poseOf(toParent, placement.width, placement.height, false)
  const inside = {
    space: innerSpace(n, placement, place.space),
    view: viewInside(place.view, pose?.box.rotation ?? 0),
    inBoolean: n.type === 'BOOLEAN_OPERATION',
  }
  return { placement, toParent, pose, inside }
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
