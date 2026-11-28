// Graphics: stacked patches as the graphics a person edits, back to front, in the piece's pixels. A patch that is
// a rectangle or an ellipse is drawn as one, a long thin rectangle as a line, and a patch that repeats round its
// centre as the regular polygon or star it is fitted as; any other is a path traced along its outlines. Loose
// patches of one colour that are no shape of their own (an icon's strokes, a row of dots, a skyline) are one path
// together. A patch that shades as a gradient is filled with it.

import type { CanvasKit } from '@dazbee/canvaskit'
import type { Paint } from '@dazbee/schema'

import { ciede2000, srgbToLab } from '../looks-same/colour.ts'
import type { ShapeLayer } from './draw-layers.ts'
import { fitShape, type ShapeFit, shapeLayer } from './fit/fit-shapes.ts'
import { fitGradient, type GradientFit, gradientPaint, type InnerPixel } from './fit/gradient.ts'
import { type Point, tracedLoops } from './fit/trace.ts'
import { layerName, pathName } from './layer-names.ts'
import { hexColour } from './parts/colour.ts'
import type { FloatPicture } from './parts/float-picture.ts'
import type { Patch } from './patches.ts'
import { repeatsRound } from './primitives.ts'
import type { Stacked } from './stacking.ts'

/** The settings of the graphics. */
export const GRAPHICS = {
  /** Loose patches of one colour are one path when their alphas are within this of each other. */
  oneAlpha: 0.1,
  /** A primitive under this share of the piece is small; this many small ones of one colour, or more, are one path. */
  smallShare: 0.01,
  manySmall: 2,
  /** A rectangle this thin, in pixels, and at least `lineLong` times as long is a line. */
  lineThin: 10,
  lineLong: 6,
  /** How far a traced path may stray from its outline, in piece pixels. */
  pathTolerance: 0.5,
  /** A patch is tried as a gradient when its colour spreads by this much (root mean square, of 255) and it holds this many pixels; about `gradientSamples` of them are read, and the gradient must be closer than the one colour by this mean ΔE00. */
  gradientSpread: 3,
  gradientPixels: 200,
  gradientSamples: 4000,
  gradientGain: 0.75,
  /** And a plane and a bowl over its pixels must explain this share of its change of colour. */
  gradientExplains: 0.3,
  /** A patch of this many pixels that repeats round its centre is fitted as a regular polygon or star: at most `regularSide` px on its long side, with this many drawings, and it is one when the shape covers it by this soft IoU. */
  regularPixels: 150,
  regularSide: 192,
  regularDraws: 80,
  regularHolds: 0.95,
  /** A fill under this alpha is see-through. */
  opaque: 0.97,
} as const

/**
 * The graphics of stacked patches, back to front, in piece pixels (`grow` piece pixels to a worked one). With
 * `shapes` a patch that is a primitive is drawn as one; without, every patch is traced.
 */
export function graphicsOf(
  stacked: readonly Stacked[],
  shapes: boolean,
  grow: number,
): { layers: ShapeLayer[]; pixels: number[] } {
  const layers: { at: number; layer: ShapeLayer; pixels: number }[] = []
  // Loose patches close no hole over others, so patches of one colour can be drawn together as one path wherever
  // the frontmost of them goes.
  const loose: { at: number; s: Stacked }[] = []
  let covered = 0
  stacked.forEach((s, at) => {
    if (s.seenThrough || s.absorbed) return
    covered += s.patch.area
    if (!s.closes && !(shapes && s.regular)) loose.push({ at, s })
    else if (shapes && s.primitive)
      layers.push({ at, layer: primitiveLayer(s, s.primitive, grow), pixels: s.patch.area })
    else if (shapes && s.regular) layers.push({ at, layer: regularLayer(s, s.regular, grow), pixels: s.patch.area })
    else {
      const layer = pathOf([s], grow)
      if (layer) layers.push({ at, layer, pixels: s.patch.area })
    }
  })
  const grouped = new Uint8Array(loose.length)
  for (const [i, first] of loose.entries()) {
    if (grouped[i]) continue
    const members = [first]
    for (let j = i + 1; j < loose.length; j++) {
      const other = loose[j]
      if (!other || grouped[j] || other.s.parent !== first.s.parent) continue
      if (Math.abs(other.s.patch.alpha - first.s.patch.alpha) > GRAPHICS.oneAlpha) continue
      if (other.s.patch.colour !== first.s.patch.colour) continue
      grouped[j] = 1
      members.push(other)
    }
    // Of one colour's patches, a primitive stands as a shape of its own when it is larger than every traced one;
    // with none traced, small primitives stand alone only while they are few (a row of dots is one path).
    const traced = members.filter((m) => !shapes || !m.s.primitive)
    const primitives = members.filter((m) => shapes && m.s.primitive)
    const largest = Math.max(0, ...traced.map((m) => m.s.patch.outline))
    const small = primitives.filter((m) => m.s.patch.outline < GRAPHICS.smallShare * covered)
    const alone = traced.length
      ? primitives.filter((m) => m.s.patch.outline >= largest)
      : small.length >= GRAPHICS.manySmall
        ? primitives.filter((m) => !small.includes(m))
        : primitives
    for (const m of alone) {
      if (!m.s.primitive) continue
      layers.push({ at: m.at, layer: primitiveLayer(m.s, m.s.primitive, grow), pixels: m.s.patch.area })
    }
    const together = members.filter((m) => !alone.includes(m))
    if (together.length === 0) continue
    const layer = pathOf(
      together.map((m) => m.s),
      grow,
    )
    if (layer)
      layers.push({
        at: Math.max(...together.map((m) => m.at)),
        layer,
        pixels: together.reduce((sum, m) => sum + m.s.patch.area, 0),
      })
  }
  layers.sort((a, b) => a.at - b.at)
  return { layers: layers.map(({ layer }) => layer), pixels: layers.map((entry) => entry.pixels) }
}

/**
 * The regular polygon or star a stacked patch is, or null: a patch that is no rectangle or ellipse, has no hole
 * and repeats round its centre is fitted by drawing, at a small size, and is one when the shape
 * drawn covers it well.
 */
export function regularOf(ck: CanvasKit, s: Stacked, patchOf: Int32Array, width: number): ShapeFit | null {
  const outline = s.outer[0]
  if (s.seenThrough || s.primitive || !outline || s.outer.length !== 1 || s.holes.length > 0) return null
  if (s.patch.area < GRAPHICS.regularPixels || !repeatsRound(outline.points)) return null
  const { x0, y0, x1, y1 } = s.patch.box
  const scale = Math.min(1, GRAPHICS.regularSide / Math.max(x1 - x0 + 1, y1 - y0 + 1))
  const pad = 3
  const w = Math.ceil((x1 - x0 + 1) * scale) + 2 * pad
  const h = Math.ceil((y1 - y0 + 1) * scale) + 2 * pad
  const mask = new Float32Array(w * h)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const xx = Math.floor(x0 + (x - pad + 0.5) / scale)
      const yy = Math.floor(y0 + (y - pad + 0.5) / scale)
      if (xx < x0 || yy < y0 || xx > x1 || yy > y1) continue
      if (patchOf[yy * width + xx] === s.patch.id) mask[y * w + x] = 1
    }
  const fitted = fitShape(
    ck,
    {
      width: w,
      height: h,
      mask,
      scale,
      pieceWidth: w / scale,
      pieceHeight: h / scale,
      offsetX: x0 - pad / scale,
      offsetY: y0 - pad / scale,
    },
    { draws: GRAPHICS.regularDraws, kinds: ['polygon', 'star'] },
  )
  return fitted.iou >= GRAPHICS.regularHolds ? fitted.fit : null
}

/**
 * A patch's fill as a gradient, when its colour changes across it as a gradient's does and one is clearly closer
 * to its inner pixels than its one colour is; null when not. A patch too even or too small is not read, and
 * neither is one whose colour's change is grain: where a plane and a bowl over its pixels (the least-squares fit
 * of each channel on x, y and x² + y²) explain too little of the change.
 */
export function gradientOf(
  patch: Patch,
  picture: FloatPicture,
  patchOf: Int32Array,
  hidden?: Uint8Array,
): GradientFit | null {
  if (patch.spread < GRAPHICS.gradientSpread || patch.area < GRAPHICS.gradientPixels) return null
  const { width, data } = picture
  const step = Math.max(1, Math.floor(Math.sqrt(patch.area / GRAPHICS.gradientSamples)))
  const pixels: InnerPixel[] = []
  for (let y = patch.box.y0 + (step >> 1); y <= patch.box.y1; y += step)
    for (let x = patch.box.x0 + (step >> 1); x <= patch.box.x1; x += step) {
      const i = y * width + x
      if (patchOf[i] !== patch.id || hidden?.[i]) continue
      // An inner pixel: its neighbours are the patch's too, so it is no mix with another colour.
      if (patchOf[i - 1] !== patch.id || patchOf[i + 1] !== patch.id) continue
      if (patchOf[i - width] !== patch.id || patchOf[i + width] !== patch.id) continue
      pixels.push({ x: x + 0.5, y: y + 0.5, rgb: [data[i * 4] ?? 0, data[i * 4 + 1] ?? 0, data[i * 4 + 2] ?? 0] })
    }
  if (pixels.length < 30 || explainedBySurface(pixels, patch) < GRAPHICS.gradientExplains) return null
  const flat = srgbToLab(...patch.rgb)
  let error = 0
  for (const p of pixels) error += ciede2000(flat, srgbToLab(...p.rgb))
  const gradient = fitGradient(pixels, 1)
  return gradient && gradient.error <= error / pixels.length - GRAPHICS.gradientGain ? gradient : null
}

/** A patch's primitive as a graphic: a line when it is long and thin, an outline stroke when it has one, else filled. */
function primitiveLayer(s: Stacked, { shape, stroke }: NonNullable<Stacked['primitive']>, grow: number): ShapeLayer {
  const flat = paintOf(s.patch.rgb, s.patch.alpha)
  const width = shape.width * grow
  const height = shape.height * grow
  const corners = shape.corners.map((r) => Math.round(r * grow * 100) / 100) as [number, number, number, number]
  const oneRadius = corners.every((r) => r === corners[0])
  const named: ShapeFit = {
    kind: shape.kind,
    cx: shape.cx * grow,
    cy: shape.cy * grow,
    width,
    height,
    rotation: shape.rotation,
    radius: Math.max(...corners),
    count: 0,
    innerRadius: 0.5,
    stroke: stroke * grow,
    strokeOnly: stroke > 0,
  }
  const box = { x: named.cx - width / 2, y: named.cy - height / 2, width, height, rotation: shape.rotation }
  const paint = shape.rotation === 0 && !stroke ? (gradientFill(s, box, grow) ?? flat) : flat
  const thin = Math.min(width, height)
  const long = Math.max(width, height)
  if (
    shape.kind === 'rect' &&
    !stroke &&
    thin <= GRAPHICS.lineThin &&
    long >= GRAPHICS.lineLong * thin &&
    named.radius === 0
  ) {
    const along = width >= height
    return {
      type: 'graphic',
      name: layerName(s.patch.rgb, { ...named, kind: 'line' }, false),
      props: {
        x: named.cx - long / 2,
        y: named.cy - thin / 2,
        width: long,
        height: thin,
        rotation: along ? shape.rotation : shape.rotation + 90,
        shape: { kind: 'line', start: 'none', end: 'none' },
        fills: [],
        strokes: [{ paint, width: thin, align: 'center', cap: 'butt' }],
      },
    }
  }
  return {
    type: 'graphic',
    name: layerName(s.patch.rgb, named, false),
    props: {
      ...box,
      shape:
        shape.kind === 'ellipse'
          ? { kind: 'ellipse' }
          : oneRadius
            ? { kind: 'rect', cornerRadius: corners[0] }
            : { kind: 'rect', cornerRadius: 0, corners },
      fills: s.border ? [paintOf(s.border.filler.patch.rgb, s.border.filler.patch.alpha)] : stroke ? [] : [paint],
      strokes: s.border
        ? [{ paint: flat, width: s.border.width * grow, align: 'inside' }]
        : stroke
          ? [{ paint, width: stroke * grow, align: 'inside' }]
          : [],
    },
  }
}

/** A patch's regular polygon or star as a graphic, in piece pixels. */
function regularLayer(s: Stacked, fit: ShapeFit, grow: number): ShapeLayer {
  const grown: ShapeFit = {
    ...fit,
    cx: fit.cx * grow,
    cy: fit.cy * grow,
    width: fit.width * grow,
    height: fit.height * grow,
    radius: fit.radius * grow,
  }
  return shapeLayer(grown, paintOf(s.patch.rgb, s.patch.alpha), layerName(s.patch.rgb, grown, false))
}

/** Patches of one colour as one path: their outer outlines and kept holes, traced. */
function pathOf(members: readonly Stacked[], grow: number): ShapeLayer | null {
  const loops: Point[][] = []
  let area = 0
  const rgb: [number, number, number] = [0, 0, 0]
  let alpha = 0
  for (const { patch, outer, holes } of members) {
    for (const loop of [...outer, ...holes]) {
      if (Math.abs(loop.area) < 1) continue
      const points: Point[] = []
      for (let k = 0; k < loop.points.length; k += 2)
        points.push([(loop.points[k] ?? 0) * grow, (loop.points[k + 1] ?? 0) * grow])
      loops.push(points)
    }
    area += patch.area
    for (let c = 0; c < 3; c++) rgb[c] = (rgb[c] ?? 0) + (patch.rgb[c] ?? 0) * patch.area
    alpha += patch.alpha * patch.area
  }
  const traced = tracedLoops(loops, GRAPHICS.pathTolerance)
  if (!traced || area === 0) return null
  const colour: [number, number, number] = [rgb[0] / area, rgb[1] / area, rgb[2] / area]
  const { box } = traced
  const only = members[0]
  return {
    type: 'graphic',
    name: pathName(colour),
    props: {
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      rotation: 0,
      shape: { kind: 'path', d: traced.d, fillRule: 'evenodd', drawnIn: { width: box.width, height: box.height } },
      fills: [(only && members.length === 1 ? gradientFill(only, box, grow) : null) ?? paintOf(colour, alpha / area)],
      strokes: [],
    },
  }
}

/**
 * The share of the pixels' change of colour that a plane and a bowl explain: each channel fitted by least squares
 * on 1, x, y and x² + y², with x and y from the patch's box's centre in units of its longer side.
 */
function explainedBySurface(pixels: readonly InnerPixel[], patch: Patch): number {
  const cx = (patch.box.x0 + patch.box.x1 + 1) / 2
  const cy = (patch.box.y0 + patch.box.y1 + 1) / 2
  const unit = Math.max(patch.box.x1 - patch.box.x0 + 1, patch.box.y1 - patch.box.y0 + 1)
  // The normal equations: A (4 × 4, symmetric) and one right side a channel, of four numbers each.
  const a = new Float64Array(16)
  const b = new Float64Array(12)
  const mean = [0, 0, 0]
  const basis = new Float64Array(4)
  for (const p of pixels) {
    const x = (p.x - cx) / unit
    const y = (p.y - cy) / unit
    basis[0] = 1
    basis[1] = x
    basis[2] = y
    basis[3] = x * x + y * y
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) a[r * 4 + c] = (a[r * 4 + c] ?? 0) + (basis[r] ?? 0) * (basis[c] ?? 0)
      for (let k = 0; k < 3; k++) b[k * 4 + r] = (b[k * 4 + r] ?? 0) + (basis[r] ?? 0) * (p.rgb[k] ?? 0)
    }
    for (let k = 0; k < 3; k++) mean[k] = (mean[k] ?? 0) + (p.rgb[k] ?? 0)
  }
  let total = 0
  let explained = 0
  for (let k = 0; k < 3; k++) {
    const m = (mean[k] ?? 0) / pixels.length
    const right = b.subarray(k * 4, k * 4 + 4)
    const weights = solved(a, right)
    if (!weights) return 0
    // The squares the fit explains are its weights times the right side, less the mean's.
    let fitted = 0
    for (let r = 0; r < 4; r++) fitted += (weights[r] ?? 0) * (right[r] ?? 0)
    let squares = 0
    for (const p of pixels) squares += (p.rgb[k] ?? 0) ** 2
    total += squares - pixels.length * m * m
    explained += fitted - pixels.length * m * m
  }
  return total > 1e-9 ? Math.max(0, explained / total) : 0
}

/** A patch's flat paint: its colour, see-through by its alpha when that is under 0.97. */
function paintOf(rgb: readonly [number, number, number], alpha: number): Paint {
  const color = hexColour(rgb[0], rgb[1], rgb[2])
  return alpha < GRAPHICS.opaque
    ? { type: 'solid', color, opacity: Math.round(alpha * 1000) / 1000 }
    : { type: 'solid', color }
}

/** A stacked patch's gradient as the paint of a graphic with this box, in piece pixels, or null when it has none. */
function gradientFill(
  s: Stacked,
  box: { x: number; y: number; width: number; height: number },
  grow: number,
): Paint | null {
  if (!s.gradient) return null
  const { from, to } = s.gradient
  const paint = gradientPaint(
    { ...s.gradient, from: [from[0] * grow, from[1] * grow], to: [to[0] * grow, to[1] * grow] },
    box,
  )
  return s.patch.alpha < GRAPHICS.opaque ? { ...paint, opacity: Math.round(s.patch.alpha * 1000) / 1000 } : paint
}

/** The solution of a 4 × 4 system by elimination with pivoting, or null when it has none. */
function solved(matrix: Float64Array, right: Float64Array): Float64Array | null {
  const m = Float64Array.from(matrix)
  const x = Float64Array.from(right)
  for (let col = 0; col < 4; col++) {
    let pivot = col
    for (let row = col + 1; row < 4; row++)
      if (Math.abs(m[row * 4 + col] ?? 0) > Math.abs(m[pivot * 4 + col] ?? 0)) pivot = row
    if (Math.abs(m[pivot * 4 + col] ?? 0) < 1e-12) return null
    if (pivot !== col) {
      for (let c = 0; c < 4; c++) [m[col * 4 + c], m[pivot * 4 + c]] = [m[pivot * 4 + c] ?? 0, m[col * 4 + c] ?? 0]
      ;[x[col], x[pivot]] = [x[pivot] ?? 0, x[col] ?? 0]
    }
    for (let row = col + 1; row < 4; row++) {
      const factor = (m[row * 4 + col] ?? 0) / (m[col * 4 + col] ?? 0)
      for (let c = col; c < 4; c++) m[row * 4 + c] = (m[row * 4 + c] ?? 0) - factor * (m[col * 4 + c] ?? 0)
      x[row] = (x[row] ?? 0) - factor * (x[col] ?? 0)
    }
  }
  for (let row = 3; row >= 0; row--) {
    for (let c = row + 1; c < 4; c++) x[row] = (x[row] ?? 0) - (m[row * 4 + c] ?? 0) * (x[c] ?? 0)
    x[row] = (x[row] ?? 0) / (m[row * 4 + row] ?? 0)
  }
  return x
}
