// The graphics a Figma node with no layers of its own becomes: rectangles, whole ellipses and
// lines as their own shapes; vectors, stars, polygons, arcs and rings as paths of the outlines the
// file gives, as is a skewed shape, which no box can show; and the types left out by what they are.

import type { Box } from '@dazbee/doc'
import type { FigmaReportLine, LineEnd } from '@dazbee/schema'
import { type Matrix, multiply } from '@dazbee/svg'

import { addLayer, adopt, layer, type LayerBuild, type LayerInput, paintsOf, type Piece, unreadable } from './build.ts'
import {
  boxMapOf,
  handlesOf,
  type Placement,
  placementOf,
  poseOf,
  shiftOf,
  type Space,
  unturned,
  withinReach,
} from './geometry.ts'
import { field, type FigmaFields, type FigmaNode, list, num, str } from './read.ts'
import { type Outline, type OutlineRule, outlinesOf } from './vectors.ts'

/** One radius for every corner, or each corner's from the top left clockwise. */
export type Corners = number | [number, number, number, number]

/** Where a node is made: the space its matrix is relative to, its parent's unturned pixels, and whether a boolean combines it. */
export interface Place {
  space: Space
  /** Takes the page's pixels to its parent's unturned pixels. */
  view: Matrix
  inBoolean: boolean
}

/** Node types a boolean combines. */
export const SHAPE_TYPES: ReadonlySet<string> = new Set([
  'RECTANGLE',
  'ELLIPSE',
  'LINE',
  'VECTOR',
  'STAR',
  'REGULAR_POLYGON',
  'BOOLEAN_OPERATION',
])
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
  ['TEXT', 'texts'],
])
/** How each shape's outlines become paths outside a boolean: a vector's by its own rules, the rest as one shape. */
const OUTLINE_RULES: ReadonlyMap<string, OutlineRule> = new Map([
  ['VECTOR', 'vector'],
  ['STAR', 'shape'],
  ['REGULAR_POLYGON', 'shape'],
  ['ELLIPSE', 'shape'],
  ['RECTANGLE', 'shape'],
  ['BOOLEAN_OPERATION', 'shape'],
])
const LINE_ENDS: ReadonlyMap<string, LineEnd> = new Map([
  ['LINE_ARROW', 'arrow'],
  ['TRIANGLE_FILLED', 'triangle'],
  ['CIRCLE_FILLED', 'circle'],
])
/** Stroke caps that are no line end: the ends of a plain line. */
const PLAIN_CAPS: ReadonlySet<string> = new Set(['NONE', 'ROUND', 'SQUARE'])

/** A frame's or box's corners: one radius, or each corner's from the top left clockwise. */
export function cornersOf(fields: FigmaFields): Corners {
  const radii = list(field(fields, 'rectangleCornerRadii')).map(num)
  if (radii.length === 4 && radii.every((r) => r !== undefined && r >= 0)) {
    const [tl, tr, br, bl] = radii as [number, number, number, number]
    return tl === tr && tr === br && br === bl ? tl : [tl, tr, br, bl]
  }
  return Math.max(0, num(field(fields, 'cornerRadius')) ?? 0)
}

/**
 * The layer a node with no layers of its own becomes at `place`, or null when it is left out. A
 * boolean arrives here only when it holds a layer that is no shape: it is drawn as its own outline.
 */
export function leaf(build: LayerBuild, n: FigmaNode, place: Place): Piece | null {
  if (!n.id || !n.type) return unreadable(build, n)
  const left = LEFT_OUT.get(n.type)
  if (left) {
    build.report.add(left, n)
    return null
  }
  if (!SHAPE_TYPES.has(n.type)) {
    build.report.add('unknown-layers', n)
    return null
  }
  const placement = placementOf(n, place.space)
  if (!placement) return unreadable(build, n)
  const toParent = multiply(place.view, placement.world)
  if (n.type === 'LINE') return line(build, n, toParent, placement)
  const rule = place.inBoolean ? 'in-boolean' : (OUTLINE_RULES.get(n.type) as OutlineRule)
  if (n.type === 'BOOLEAN_OPERATION') {
    const piece = outlined(build, n, toParent, placement, rule)
    if (piece) build.report.add('booleans-flattened', n)
    return piece
  }
  if (n.type !== 'RECTANGLE' && !(n.type === 'ELLIPSE' && isWhole(n.fields)))
    return outlined(build, n, toParent, placement, rule)
  const pose = poseOf(toParent, placement.width, placement.height, false)
  if (pose.skewed) {
    if (list(field(n.fields, 'fillGeometry')).length > 0) return outlined(build, n, toParent, placement, rule)
    build.report.add('skewed-layers', n)
  }
  const box = withinReach(build.report, n, pose.box, placement.clamped)
  const id = addLayer(build, n, 'graphic', { ...box, ...pose.flips, shape: shapeOf(build, n) })
  build.paints[id] = paintsOf(n, handlesOf(pose.toBox, placement.width, placement.height, box))
  return { id, box }
}

/** A line from its start to its end as its matrix places them, which no mirror or skew changes. */
function line(build: LayerBuild, n: FigmaNode, toParent: Matrix, placement: Placement): Piece {
  const { width, height } = placement
  const [a, b, c, d, e, f] = toParent
  const length = Math.hypot(a, b) * width
  const across = Math.hypot(c, d) * height
  const centre = { x: e + (a * width + c * height) / 2, y: f + (b * width + d * height) / 2 }
  const rotation = (Math.atan2(b, a) * 180) / Math.PI
  const drawn = { x: centre.x - length / 2, y: centre.y - across / 2, width: length, height: across, rotation }
  const box = withinReach(build.report, n, drawn, placement.clamped)
  const id = addLayer(build, n, 'graphic', { ...box, shape: shapeOf(build, n) })
  build.paints[id] = paintsOf(n, handlesOf(boxMapOf(toParent, drawn, {}), width, height, box))
  return { id, box }
}

/**
 * The path graphics a node's outlines become by `rule`, any skew taken into their data: one keyed
 * by the node, or several in a group keyed by it and turned as it is, each flipped as it is.
 */
function outlined(
  build: LayerBuild,
  n: FigmaNode,
  toParent: Matrix,
  placement: Placement,
  rule: OutlineRule,
): Piece | null {
  const pose = poseOf(toParent, placement.width, placement.height, true)
  const outlines = outlinesOf(build.ck, build.report, n, rule, pose.toBox)
  if (outlines.length === 0) return null
  const box = withinReach(build.report, n, pose.box, placement.clamped)
  const handles = handlesOf(pose.toBox, placement.width, placement.height, pose.box)
  // The data is drawn in the box as the matrix sizes it, before the box is brought within reach.
  const drawnIn = { width: pose.box.width, height: pose.box.height }
  const graphic = (id: string, at: Box, o: Outline) => {
    build.paints[id] = { fills: o.fills, ...(o.strokes ? { strokes: n } : {}), handles }
    return { ...at, ...pose.flips, shape: { kind: 'path', d: o.d, fillRule: o.fillRule, drawnIn } }
  }
  if (outlines.length === 1) {
    const id = build.keyOf(n)
    addLayer(build, n, 'graphic', graphic(id, box, outlines[0] as Outline), id)
    return { id, box }
  }
  const own = unturned(box)
  const pieces = outlines.map((o) => {
    const id = build.fresh()
    build.nodes[id] = layer(id, 'graphic', n.name, graphic(id, own, o))
    return { id, box: own }
  })
  const id = addLayer(build, n, 'group', box)
  build.shifts.set(id, shiftOf(box))
  adopt(build, id, pieces)
  return { id, box }
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
    if (!end && !PLAIN_CAPS.has(cap)) build.report.add('line-ends', n)
    return { kind: 'line', start: end ?? 'none', end: end ?? 'none' }
  }
  const corners = cornersOf(n.fields)
  return typeof corners === 'number' ? { kind: 'rect', cornerRadius: corners } : { kind: 'rect', corners }
}
