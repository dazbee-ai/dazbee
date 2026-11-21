// Figma's paints as Dazbee's: solids by their colour, gradients mapped from their handles, image
// fills by their imageRef, and strokes. What Dazbee can't draw is left out or drawn another way,
// reported.

import type { z } from 'zod'

import type { Point } from '@dazbee/doc'
import {
  type AngularPaint,
  AssetId,
  type FigmaReportLine,
  type LinearPaint,
  type Paint,
  type RadialPaint,
  type Stroke,
  TILE_SCALE,
} from '@dazbee/schema'
import { apply, type Matrix } from '@dazbee/svg'

import type { LayerInput, LayerPaints } from './build.ts'
import { bool, colourOf, field, type FigmaFields, type FigmaNode, list, num, record, str } from './read.ts'
import type { ReportedNode, Reporter } from './report.ts'

/** A paint as the import writes it, before the schema fills in its defaults. */
export type PaintInput = z.input<typeof Paint>
/** A stroke as the import writes it, before the schema fills in its defaults. */
export type StrokeInput = z.input<typeof Stroke>

/** A gradient's colour at an offset from 0 to 1. */
export type Stop = { offset: number; color: string }

/** A gradient's three handles in the layer's unit box: its start (value 0), its end (value 1) and its width. */
export interface Handles {
  start: Point
  end: Point
  width: Point
}

/** Counts one more under a report line, for the paint being mapped. */
export type Note = (line: FigmaReportLine) => void

/** Where a node's paints are drawn: the map from its unit box to the layer's, and the layer's size. */
export interface PaintPlace {
  handles: Matrix
  width: number
  height: number
}

/** Lengths under this, in the unit box or in pixels, are read as none. */
const TINY = 1e-6
/** An oval whose shortest half-axis is more than this share of its longest is drawn as the circle it nearly is. */
const ROUND_RATIO = 0.999
/** Figma's numbers are 32-bit floats: handles within this share of square and of one length are read as both. */
const SLACK = 1e-6
/** Lengths and handles past this, in pixels or unit boxes, are no drawing Figma makes; they are brought within it. */
const MAX_LENGTH = 1e6
/** The longest miter a join reaches, in half stroke widths, as FigCraft holds it. */
const MAX_MITER = 100
const STROKE_ALIGNS: ReadonlyMap<string, 'inside' | 'center' | 'outside'> = new Map([
  ['INSIDE', 'inside'],
  ['CENTER', 'center'],
  ['OUTSIDE', 'outside'],
])
/** Stroke caps as Dazbee's; a line's ends (arrows and the like) are its shape's, and its stroke is butt. */
const STROKE_CAPS: ReadonlyMap<string, 'butt' | 'round' | 'square'> = new Map([
  ['ROUND', 'round'],
  ['SQUARE', 'square'],
])
const STROKE_JOINS: ReadonlyMap<string, 'miter' | 'round' | 'bevel'> = new Map([
  ['MITER', 'miter'],
  ['ROUND', 'round'],
  ['BEVEL', 'bevel'],
])
/** Figma's paint types: null for those Dazbee draws, else the line reporting them left out. */
const PAINT_TYPES: ReadonlyMap<string, FigmaReportLine | null> = new Map([
  ...['SOLID', 'GRADIENT_LINEAR', 'GRADIENT_RADIAL', 'GRADIENT_ANGULAR', 'GRADIENT_DIAMOND', 'IMAGE'].map(
    (t) => [t, null] as const,
  ),
  ['EMOJI', 'emoji-paints'],
  ['VIDEO', 'video-paints'],
  ['PATTERN', 'pattern-paints'],
])
/** A paint's blend modes that draw it over what is under it as Dazbee does. */
const PLAIN_BLENDS: ReadonlySet<string> = new Set(['NORMAL', 'PASS_THROUGH'])
/** Image filters Dazbee adjusts by, in the order of its adjustments. */
const FILTERS = ['exposure', 'contrast', 'saturation', 'temperature', 'tint'] as const
/** Image filters Dazbee has no adjustment for. */
const HIDDEN_FILTERS = ['highlights', 'shadows'] as const

/** Writes a layer's fills and strokes from the Figma paints it takes. */
export function paintLayer(report: Reporter, layer: LayerInput, paints: LayerPaints) {
  if (layer.type !== 'graphic' && layer.type !== 'box' && layer.type !== 'boolean') return
  const at = { handles: paints.handles, width: layer.props.width, height: layer.props.height }
  const fills = fillsOf(report, paints.node, paints.fills, at)
  const strokes = paints.strokes ? strokesOf(report, paints.strokes, at) : []
  Object.assign(layer.props, fills.length > 0 ? { fills } : {}, strokes.length > 0 ? { strokes } : {})
  // A box's or rectangle's corners are drawn round; a path's outline already holds its smoothing.
  const corners = layer.type === 'box' ? layer.props.cornerRadius : rectCorners(field(layer.props, 'shape'))
  const rounded = typeof corners === 'number' ? corners > 0 : corners?.some((r) => r > 0)
  if (rounded && (num(field(paints.node.fields, 'cornerSmoothing')) ?? 0) > 0)
    report.add('corner-smoothing', paints.node)
}

/** The Dazbee paints a node's Figma paints become, bottom to top, each left out or changed reported. */
export function fillsOf(
  report: Reporter,
  node: ReportedNode,
  paints: readonly unknown[],
  at: PaintPlace,
): PaintInput[] {
  const note = (line: FigmaReportLine) => report.add(line, node)
  return paints.flatMap((p) => paintOf(note, p, at) ?? [])
}

/**
 * Figma's linear gradient as Dazbee's. Figma's value is 0 on the line through the start along the
 * width handle and 1 on the parallel line through the end, so it is affine in the unit box; Dazbee's
 * is too, its lines of equal colour square to `to` − `from` there. With n the unit normal to the
 * width handle, `from` is the start and `to` the start plus n·(a·n), which give the same value
 * everywhere. Handles on one line give no such normal: it runs from start to end, noted.
 */
export function linearPaint(h: Handles, stops: Stop[], note: Note): LinearPaint {
  const a = minus(h.end, h.start)
  const u = minus(h.width, h.start)
  const length = Math.hypot(u.x, u.y)
  const n = length >= TINY ? { x: -u.y / length, y: u.x / length } : null
  const along = n ? a.x * n.x + a.y * n.y : 0
  if (!n || Math.abs(along) < TINY) {
    note('gradient-handles-in-line')
    return { type: 'linear', from: h.start, to: h.end, stops }
  }
  return { type: 'linear', from: h.start, to: { x: h.start.x + n.x * along, y: h.start.y + n.y * along }, stops }
}

/**
 * Figma's radial gradient as Dazbee's round one. Figma's value t lies on the oval whose conjugate
 * half-diameters are the end and width handles, scaled by t; Dazbee's radial is a circle, so an oval
 * is drawn round at the radius that keeps its area, √(σ1·σ2), noted. An oval flatter than TINY
 * pixels across draws nothing and is left out, noted.
 */
export function radialPaint(h: Handles, width: number, height: number, stops: Stop[], note: Note): RadialPaint | null {
  const { major, minor } = ovalOf(h, width, height)
  const side = Math.min(width, height)
  if (minor < TINY || side <= 0) {
    note('flat-gradients')
    return null
  }
  const round = minor / major > ROUND_RATIO
  if (!round) note('radial-ovals-round')
  return { type: 'radial', center: h.start, radius: (round ? major : Math.sqrt(major * minor)) / side, stops }
}

/**
 * Figma's angular gradient as Dazbee's, whose sweep is even in the unit box and turns clockwise
 * from `angle`. Figma's starts along the end handle and turns towards the width handle; when that
 * is counter-clockwise (det < 0), the stops are reversed, each offset o becoming 1 − o, which draws
 * that sweep exactly. Figma's sweep is even in the space the two handles span, so it is exact only
 * when they are square and of one length in the unit box; otherwise noted.
 */
export function angularPaint(h: Handles, stops: Stop[], note: Note): AngularPaint {
  const a = minus(h.end, h.start)
  const u = minus(h.width, h.start)
  const det = a.x * u.y - a.y * u.x
  const [la, lu] = [Math.hypot(a.x, a.y), Math.hypot(u.x, u.y)]
  const square = Math.abs(a.x * u.x + a.y * u.y) <= SLACK * la * lu
  if (la < TINY || Math.abs(la - lu) > SLACK * la || !square) note('angular-gradients-changed')
  return {
    type: 'angular',
    center: h.start,
    angle: (Math.atan2(a.y, a.x) * 180) / Math.PI,
    stops: det < 0 ? stops.map((s) => ({ offset: 1 - s.offset, color: s.color })).reverse() : stops,
  }
}

/**
 * The oval a radial's handles draw in a layer of `width` × `height`: its longest half-axis σ1, its
 * shortest σ2, both in pixels, and the angle of the longest in degrees clockwise from pointing
 * right. With A and B the end and width handles less the start in pixels, these are the SVD of [A B].
 */
export function ovalOf(h: Handles, width: number, height: number): { major: number; minor: number; angle: number } {
  const A = { x: (h.end.x - h.start.x) * width, y: (h.end.y - h.start.y) * height }
  const B = { x: (h.width.x - h.start.x) * width, y: (h.width.y - h.start.y) * height }
  const sxx = A.x * A.x + B.x * B.x
  const syy = A.y * A.y + B.y * B.y
  const sxy = A.x * A.y + B.x * B.y
  const d = Math.hypot(sxx - syy, 2 * sxy)
  const major = Math.sqrt((sxx + syy + d) / 2)
  // σ1·σ2 is |det [A B]|, which keeps σ2 exact where σ1 is far longer.
  const minor = major > 0 ? Math.abs(A.x * B.y - A.y * B.x) / major : 0
  return { major, minor, angle: (Math.atan2(2 * sxy, sxx - syy) * 90) / Math.PI }
}

/** A rectangle shape's corners: its one radius, or each corner's; undefined for any other shape. */
function rectCorners(shape: unknown): number | readonly number[] | undefined {
  if (field(shape, 'kind') !== 'rect') return undefined
  const corners = field(shape, 'corners')
  return Array.isArray(corners) ? (corners as number[]) : (num(field(shape, 'cornerRadius')) ?? 0)
}

/** The paint a Figma paint becomes, or null, noted, when it is left out. */
function paintOf(note: Note, value: unknown, at: PaintPlace): PaintInput | null {
  const p = record(value)
  const type = str(field(p, 'type'))
  const leftOut =
    type === undefined ? null : (PAINT_TYPES.get(type) ?? (PAINT_TYPES.has(type) ? null : 'unknown-paints'))
  if (leftOut) {
    note(leftOut)
    return null
  }
  const paint = type === 'IMAGE' ? imagePaint(note, p, at) : drawnPaint(note, p, type, at)
  if (paint === undefined) note('unreadable-paints')
  if (!paint) return null
  if (!PLAIN_BLENDS.has(str(field(p, 'blendMode')) ?? 'NORMAL')) note('paint-blend-modes')
  const opacity = Math.min(1, Math.max(0, num(field(p, 'opacity')) ?? 1))
  return {
    ...paint,
    ...(opacity < 1 ? { opacity } : {}),
    ...(bool(field(p, 'visible')) === false ? { visible: false } : {}),
  }
}

/**
 * A node's strokes as Dazbee's: one for each of its stroke paints, all of one weight, align, dashes,
 * cap, join and miter limit. Differing weights on each side are drawn at the widest, reported; a
 * weight of 0 is no stroke.
 */
function strokesOf(report: Reporter, n: FigmaNode, at: PaintPlace): StrokeInput[] {
  const width = weightOf(report, n)
  if (!(width > 0)) return []
  const { fields } = n
  const dashes = list(field(fields, 'strokeDashes')).flatMap((d) => {
    const length = num(d)
    return length === undefined || length < 0 ? [] : [Math.min(length, MAX_LENGTH)]
  })
  const angle = num(field(fields, 'strokeMiterAngle'))
  const look = {
    width,
    align: STROKE_ALIGNS.get(str(field(fields, 'strokeAlign')) ?? '') ?? 'center',
    ...(dashes.some((d) => d > 0) ? { dashes } : {}),
    cap: STROKE_CAPS.get(str(field(fields, 'strokeCap')) ?? '') ?? 'butt',
    join: STROKE_JOINS.get(str(field(fields, 'strokeJoin')) ?? '') ?? 'miter',
    // The angle below which Figma bevels a join, as a miter limit (props.rs:376-378).
    ...(angle !== undefined && angle > 0 && angle < 180
      ? { miterLimit: Math.min(MAX_MITER, Math.max(1, 1 / Math.sin((angle * Math.PI) / 360))) }
      : {}),
  }
  return fillsOf(report, n, list(field(fields, 'strokes')), at).map((paint) => ({ paint, ...look }))
}

/**
 * A node's stroke weight: its own on each side when it has them, the widest when they differ,
 * reported; else `strokeWeight`, 1 when it has none, as Figma's default.
 */
function weightOf(report: Reporter, n: FigmaNode): number {
  const sides = field(n.fields, 'individualStrokeWeights')
  const each = (['top', 'right', 'bottom', 'left'] as const).map((k) => num(field(sides, k)))
  if (!each.every((w) => w !== undefined && w >= 0))
    return Math.min(MAX_LENGTH, num(field(n.fields, 'strokeWeight')) ?? 1)
  const widest = Math.max(...(each as number[]))
  if ((each as number[]).some((w) => w !== widest)) report.add('stroke-weights-widest', n)
  return Math.min(MAX_LENGTH, widest)
}

function minus(p: Point, q: Point): Point {
  return { x: p.x - q.x, y: p.y - q.y }
}

/**
 * An image fill, keyed by its Figma `imageRef` until `withImages` gives it its asset: covering,
 * fitting or tiling as Figma's scale mode says. A stretched image keeps its transform as a crop in
 * shares of the image, which `withImages` sizes once the image is known. Null, noted, when it
 * names no image.
 */
function imagePaint(note: Note, p: unknown, at: PaintPlace): PaintInput | null {
  const assetId = str(field(p, 'imageRef'))
  if (assetId === undefined || !AssetId.safeParse(assetId).success) {
    note('missing-images')
    return null
  }
  if (str(field(p, 'gifRef'))) note('gif-images')
  if ((num(field(p, 'rotation')) ?? 0) % 360 !== 0) note('image-rotations')
  if (isSkewed(at)) note('skewed-images')
  const adjust = adjustOf(note, record(field(p, 'filters')))
  const paint = { type: 'image' as const, assetId, ...(adjust ? { adjust } : {}) }
  switch (str(field(p, 'scaleMode'))) {
    case 'FIT':
      return { ...paint, fit: 'fit' }
    case 'TILE': {
      const scale = num(field(p, 'scalingFactor')) ?? 1
      const tileScale = Math.min(TILE_SCALE.max, Math.max(TILE_SCALE.min, scale))
      if (tileScale !== scale) note('tile-scales-clamped')
      return { ...paint, fit: 'tile', ...(tileScale !== 1 ? { tileScale } : {}) }
    }
    case 'STRETCH': {
      const crop = cropOf(field(p, 'imageTransform'))
      if (crop) return { ...paint, fit: 'crop', crop }
      note('stretched-images-turned')
      return { ...paint, fit: 'fill' }
    }
  }
  return { ...paint, fit: 'fill' }
}

/**
 * A solid or gradient as Dazbee's, without its opacity and visibility: null, noted, when it draws
 * nothing, and undefined when it lacks the colour, stops or handles to draw it by.
 */
function drawnPaint(note: Note, p: unknown, type: string | undefined, at: PaintPlace): PaintInput | null | undefined {
  if (type === 'SOLID') {
    const color = colourOf(field(p, 'color'))
    return color ? { type: 'solid', color } : undefined
  }
  const h = handlesOf(p, at.handles)
  const stops = stopsOf(p)
  if (!h || !stops) return undefined
  switch (type) {
    case 'GRADIENT_LINEAR':
      return linearPaint(h, stops, note)
    case 'GRADIENT_ANGULAR':
      return angularPaint(h, stops, note)
    case 'GRADIENT_DIAMOND':
      // A diamond's lines of equal colour are rhombi through ±a and ±u: drawn as the radial oval through them.
      note('diamond-gradients')
      return radialPaint(h, at.width, at.height, stops, note)
    case 'GRADIENT_RADIAL':
      return radialPaint(h, at.width, at.height, stops, note)
  }
  return undefined
}

/** Whether a node's unit box goes into the layer's skewed, in pixels, which an image fill can't follow. */
function isSkewed({ handles: [a, b, c, d], width, height }: PaintPlace): boolean {
  const across = Math.hypot(width * a, height * b)
  const down = Math.hypot(width * c, height * d)
  return Math.abs(width * width * a * c + height * height * b * d) > SLACK * across * down
}

/**
 * Exposure, contrast, saturation, temperature and tint, each from -1 to 1, as Dazbee's adjustments
 * from -100 to 100 in the same direction (a positive tint is magenta in both); undefined when all
 * are 0. Highlights and shadows Dazbee has no adjustment for, noted.
 */
function adjustOf(note: Note, filters: FigmaFields | undefined) {
  if (HIDDEN_FILTERS.some((k) => (num(field(filters, k)) ?? 0) !== 0)) note('image-highlights-shadows')
  const amounts = FILTERS.map(
    (k) => Math.round(Math.min(1, Math.max(-1, num(field(filters, k)) ?? 0)) * 100 * 1e6) / 1e6,
  )
  if (amounts.every((a) => a === 0)) return undefined
  const [exposure, contrast, saturation, temperature, tint] = amounts as [number, number, number, number, number]
  return { exposure, contrast, saturation, temperature, tint }
}

/**
 * A stretched image's crop, in shares of the image, from `imageTransform`, which takes the layer's
 * unit box into the image's: the whole image when there is none, undefined when it turns, mirrors
 * or skews the image, which a crop can't show.
 */
function cropOf(value: unknown) {
  if (value === undefined) return { x: 0, y: 0, width: 1, height: 1 }
  const [top, bottom] = [0, 1].map((i) => list(list(value)[i]).map(num))
  const [a, c, x] = top ?? []
  const [b, d, y] = bottom ?? []
  if (a === undefined || b === undefined || c === undefined || d === undefined || x === undefined || y === undefined)
    return { x: 0, y: 0, width: 1, height: 1 }
  const upright = a > 0 && d > 0 && Math.abs(b) <= SLACK * a && Math.abs(c) <= SLACK * d
  return upright ? { x, y, width: a, height: d } : undefined
}

/**
 * A gradient's handles taken by `handles` into the layer's unit box; a width handle left out is
 * square to the start and end, as long. Undefined when the start or end isn't a point.
 */
function handlesOf(p: unknown, handles: Matrix): Handles | undefined {
  const points = list(field(p, 'gradientHandlePositions')).map((v) => {
    const [x, y] = [num(field(v, 'x')), num(field(v, 'y'))]
    return x === undefined || y === undefined ? undefined : { x: within(x), y: within(y) }
  })
  const [start, end, width] = points
  if (!start || !end) return undefined
  const side = width ?? { x: start.x - (end.y - start.y), y: start.y + (end.x - start.x) }
  const to = (q: Point) => apply(handles, q.x, q.y)
  return { start: to(start), end: to(end), width: to(side) }
}

/** A gradient's stops in order, a lone stop taken twice; undefined when it has none. */
function stopsOf(p: unknown): Stop[] | undefined {
  const stops = list(field(p, 'gradientStops')).flatMap((s) => {
    const offset = num(field(s, 'position'))
    const color = colourOf(field(s, 'color'))
    return offset === undefined || !color ? [] : [{ offset: Math.min(1, Math.max(0, offset)), color }]
  })
  stops.sort((x, y) => x.offset - y.offset)
  const [first] = stops
  if (!first) return undefined
  return stops.length === 1 ? [first, { ...first }] : stops
}

function within(v: number): number {
  return Math.min(MAX_LENGTH, Math.max(-MAX_LENGTH, v))
}
