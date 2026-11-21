import type { Point } from '@dazbee/doc'
import type { FigmaReportLine, LineEnd } from '@dazbee/schema'

import { FRAME_TYPES, layer, type LayerBuild, type LayerInput, type Piece, unreadable } from './build.ts'
import { placedBox } from './geometry.ts'
import { field, type FigmaFields, type FigmaNode, list, num, str } from './read.ts'

/** One radius for every corner, or each corner's from the top left clockwise. */
export type Corners = number | [number, number, number, number]

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
export const SHAPE_TYPES: ReadonlySet<string> = new Set([
  'RECTANGLE',
  'ELLIPSE',
  'LINE',
  'VECTOR',
  'STAR',
  'REGULAR_POLYGON',
  'BOOLEAN_OPERATION',
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

/** The layer a node with no layers of its own becomes, or null when it is left out. */
export function leaf(build: LayerBuild, n: FigmaNode, origin: Point): Piece | null {
  if (!n.id || !n.type || FRAME_TYPES.has(n.type)) return unreadable(build, n)
  const left = LEFT_OUT.get(n.type)
  if (left) {
    build.report.add(left, n)
    return null
  }
  if (n.type !== 'RECTANGLE' && n.type !== 'ELLIPSE' && n.type !== 'LINE') {
    // A boolean arrives here only when it holds a layer that is no shape, already reported.
    if (n.type !== 'BOOLEAN_OPERATION') build.report.add('unknown-layers', n)
    return null
  }
  if (n.type === 'ELLIPSE' && !isWhole(n.fields)) {
    build.report.add('vector-shapes', n)
    return null
  }
  const box = placedBox(build, n, origin)
  if (!box) return unreadable(build, n)
  const id = build.keyOf(n)
  build.nodes[id] = layer(id, 'graphic', n.name, { ...box, shape: shapeOf(build, n) }, n)
  build.figmaIds[id] = n.id
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
