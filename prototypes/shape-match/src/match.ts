// PROTOTYPE. Turns one flat block into Dazbee shape layers, or keeps it a picture.
//
// Light: colour-region split; each region fitted with a rectangle (corner radius, so pills too), an
// ellipse or a line, filled or as an outline stroke, in a flat colour; layers that change nothing
// dropped; brand colours snapped; drawn by Dazbee's renderer and kept as shapes only when it looks
// the same as the block.
//
// Medium: Light, plus polygons and stars; regions no primitive holds traced as Bézier paths with
// holes; bands of one gradient merged and filled with a fitted linear or radial gradient; a soft
// shadow under a shape fitted as its drop shadow; many small marks of one colour kept as one path;
// and a finer decision: no part of the block may be lost, and when the primitives fail the block is
// tried once more as traced paths before it stays a picture.
import type { CanvasKit } from '@dazbee/canvaskit'

import { deltaE00, hex, labToRgb, parseHex, rgbToLab } from './colour.ts'
import { coverage, drawLayers, type OutLayer } from './draw.ts'
import {
  type Fit,
  fitShape,
  iouOf,
  type Kind,
  layerOf,
  type Mask,
  type Params,
  refine,
  shifted,
  softIoU,
  windowOf,
} from './fit.ts'
import { fitGradient, innerPixels } from './gradient.ts'
import { colourName, shapeName } from './names.ts'
import { type Img, over, resize } from './pixels.ts'
import { type Region, splitRegions } from './regions.ts'
import { pairDeltaE, type Score, score } from './score.ts'
import { contours, tracePath } from './trace.ts'

export interface BrandColour {
  token: string
  /** #RRGGBBAA */
  value: string
}

export interface Config {
  level: 'light' | 'medium'
  /** The longest side the block is fitted at, in pixels; drawn at full size for the decision. */
  fitMax: number
  k: number
  mergeDeltaE: number
  /** Specks under this share of the covered pixels fold into their neighbours. */
  minAreaShare: number
  refineSteps: number
  kinds: Kind[]
  maxLayers: number
  maxRegions: number
  /** A fill within this ΔE00 of a brand colour takes it, bound. */
  snapDeltaE: number
  paths: boolean
  gradients: boolean
  shadows: boolean
  /** A primitive below this IoU gives way to a traced path (Medium). */
  primAccept: number
  /** Path tolerance in block pixels. */
  pathTol: number
}

export const LIGHT: Config = {
  level: 'light',
  fitMax: 256,
  k: 10,
  mergeDeltaE: 7,
  minAreaShare: 0.0004,
  refineSteps: 40,
  kinds: ['rect', 'ellipse', 'line'],
  maxLayers: 8,
  maxRegions: 40,
  snapDeltaE: 5,
  paths: false,
  gradients: false,
  shadows: false,
  primAccept: 1,
  pathTol: 0.6,
}

export const MEDIUM: Config = {
  ...LIGHT,
  level: 'medium',
  refineSteps: 80,
  kinds: ['rect', 'ellipse', 'line', 'polygon', 'star'],
  maxLayers: 16,
  paths: true,
  gradients: true,
  shadows: true,
  primAccept: 0.965,
}

export interface Result {
  decision: 'shapes' | 'picture'
  why: string
  /** The layers, back to front; for a picture, the best attempt, kept for looking at. */
  layers: OutLayer[]
  score: Score | null
  renders: number
  ms: number
  /** The fitted shape of each layer, for geometry checks. */
  params: (Params | null)[]
}

interface Built {
  layer: OutLayer
  params: Params | null
  region: Region
}

export function matchBlock(ck: CanvasKit, img: Img, cfg: Config, brand: BrandColour[] = []): Result {
  const t0 = performance.now()
  let renders = 0
  const s = Math.min(1, cfg.fitMax / Math.max(img.w, img.h))
  const fw = Math.ceil(img.w * s - 1e-9)
  const fh = Math.ceil(img.h * s - 1e-9)
  const small = s < 1 ? resize(img, fw, fh) : img
  // Content is what is at least half as opaque as the block's most opaque pixels: faint thin
  // strokes in a resampled block never reach 0.5.
  const alphas = new Float32Array(fw * fh)
  for (let i = 0; i < fw * fh; i++) alphas[i] = small.d[i * 4 + 3]!
  alphas.sort()
  const cut = Math.max(0.08, Math.min(0.5, 0.5 * alphas[Math.floor(alphas.length * 0.995)]!))
  let covered = 0
  for (let i = 0; i < fw * fh; i++) if (small.d[i * 4 + 3]! >= cut) covered++
  const done = (
    decision: Result['decision'],
    why: string,
    layers: OutLayer[],
    sc: Score | null,
    params: (Params | null)[] = [],
  ): Result => ({
    decision,
    why,
    layers,
    score: sc,
    renders,
    ms: performance.now() - t0,
    params,
  })
  if (covered < 4) return done('picture', 'nothing to draw', [], null)
  const split = splitRegions(small, {
    mergeDeltaE: cfg.mergeDeltaE,
    k: cfg.k,
    minArea: Math.max(4, cfg.minAreaShare * covered),
    cut,
    maxRegions: cfg.maxRegions * 2,
  })
  if (split.tooMany) return done('picture', `too detailed: ${split.tooMany} parts`, [], null)
  let regions = split.regions
  if (cfg.paths) regions = groupMarks(regions, covered)
  regions = regions.filter((r) => sum(r.mask) >= Math.max(2, covered * 0.0005))
  if (regions.length > cfg.maxRegions) return done('picture', `too detailed: ${regions.length} parts`, [], null)
  // Merging bands is pairwise: only on blocks with few parts (a gradient makes few bands).
  if (cfg.gradients && regions.length <= 16) regions = mergeGradientBands(small, regions, split.labels, s)
  // More parts than layers allowed, with room for pruning, is a picture before any fitting.
  if (regions.length > cfg.maxLayers * 1.5) return done('picture', `too many parts: ${regions.length}`, [], null)
  regions.sort((a, b) => sum(b.filled) - sum(a.filled))
  // A soft dark fringe beside a shape is its shadow (Medium): left out of the layers while a drop shadow is fitted.
  const shadowy = cfg.shadows ? regions.filter((r) => isShadowy(r, regions)) : []
  regions = regions.filter((r) => !shadowy.includes(r))

  const built: Built[] = []
  for (const [i, r] of regions.entries()) {
    // What the regions drawn after this one cover: it may reach under them.
    const above = new Float32Array(fw * fh)
    for (const o of regions.slice(i + 1))
      for (let j = 0; j < above.length; j++) if (o.mask[j]! > above[j]!) above[j] = o.mask[j]!
    const b = buildRegion(ck, small, r, cfg, s, fw, fh, img, above, split.labels)
    renders += b.renders
    built.push(b.built)
  }
  let layers = built.map((b) => b.layer)
  let params = built.map((b) => b.params)
  // Drop layers that change nothing (an inner patch of the colour under it).
  ;({ layers, params, renders } = prune(ck, small, layers, params, img, s, renders))
  if (cfg.shadows) {
    const sh = fitShadow(ck, small, layers, img, s)
    renders += sh.renders
    if (sh.layers !== layers) layers = sh.layers
    else if (shadowy.length) {
      // No shadow fits: the fringe goes back as layers of its own, behind the rest.
      const back = shadowy.map((r) => buildRegion(ck, small, r, cfg, s, fw, fh, img))
      for (const b of back) renders += b.renders
      layers = [...back.map((b) => b.built.layer), ...layers]
      params = [...back.map((b) => b.built.params), ...params]
      regions = [...shadowy, ...regions]
    }
  }
  const snapped = snapToBrand(ck, img, layers, brand, cfg.snapDeltaE)
  renders += snapped.renders
  layers = snapped.layers
  if (layers.length > cfg.maxLayers) return done('picture', `too many layers: ${layers.length}`, layers, null, params)
  const made = drawLayers(ck, layers, img.w, img.h, 1, snapped.variables)
  renders++
  const sc = score(img, made, cfg.level === 'medium')
  if (!sc.same && cfg.paths) {
    // The ladder's last step: every region as a traced path.
    const traced = tracedOnly(ck, small, regions, img, s, fw, fh)
    renders += traced.renders
    if (traced.layers.length > 0 && traced.layers.length <= cfg.maxLayers) {
      const tm = drawLayers(ck, traced.layers, img.w, img.h)
      renders++
      const ts = score(img, tm, true)
      if (ts.same)
        return finer(
          ts,
          traced.layers,
          traced.layers.map(() => null),
        )
    }
  }
  return finer(sc, layers, params)

  function finer(sc2: Score, ls: OutLayer[], ps: (Params | null)[]): Result {
    if (!sc2.same)
      return done('picture', `looks different: SSIM ${sc2.ssim.toFixed(3)}, ΔE ${sc2.deltaE.toFixed(2)}`, ls, sc2, ps)
    if (cfg.level === 'medium' && sc2.deMap) {
      // Painted scenes and photos come back as many free shapes over much of the block,
      const paths = ls.filter((l) => (l.props.shape as { kind: string }).kind === 'path')
      if (paths.length >= 4) {
        const drawn = drawLayers(ck, paths, img.w, img.h, s)
        let cover = 0
        for (let i = 0; i < drawn.w * drawn.h; i++) cover += drawn.d[i * 4 + 3]!
        const share = cover / (drawn.w * drawn.h)
        // Or ten layers or more, six of them free shapes: more than a designer would pick.
        if (share >= 0.3 || (ls.length >= 10 && paths.length >= 6))
          return done(
            'picture',
            `a photo or painted scene: ${paths.length} free shapes over ${Math.round(100 * share)}%`,
            ls,
            sc2,
            ps,
          )
      }
      const lost = worstPart(
        blurredDeltaE(img, drawLayers(ck, ls, img.w, img.h, 1, snapped.variables)),
        regions,
        img,
        s,
      )
      if (process.env.DBG) console.log('worst part', lost.de.toFixed(2), (lost.share * 100).toFixed(1) + '%')
      if (lost.de > 12)
        return done(
          'picture',
          `a part would be lost: ΔE ${lost.de.toFixed(1)} over ${(lost.share * 100).toFixed(1)}%`,
          ls,
          sc2,
          ps,
        )
    }
    return done('shapes', '', ls, sc2, ps)
  }
}

/** Whether most of what a region rings has its own colour. */
function ringsOwnColour(r: Region, labels?: Int32Array) {
  if (!labels) return false
  let own = 0
  let all = 0
  for (let i = 0; i < r.mask.length; i++) {
    if (r.outer[i]! < 0.5 || r.mask[i]! >= 0.5) continue
    all++
    if (labels[i] === r.label) own++
  }
  return all > 0 && own > all * 0.5
}

/** A see-through dark region beside a bigger, more opaque one: a shadow's look. */
function isShadowy(r: Region, all: Region[]) {
  const luma = 0.299 * r.rgb[0] + 0.587 * r.rgb[1] + 0.114 * r.rgb[2]
  if (r.alpha > 0.85 || luma > 120) return false
  return all.some((o) => o !== r && o.alpha > r.alpha + 0.1 && sum(o.filled) > sum(r.mask) * 0.8)
}

/** One region's layer: the best primitive, or (Medium) a traced path when it holds the region better; a gradient fill when it fits. */
function buildRegion(
  ck: CanvasKit,
  small: Img,
  r: Region,
  cfg: Config,
  s: number,
  fw: number,
  fh: number,
  img: Img,
  above?: Float32Array,
  labels?: Int32Array,
) {
  let renders = 0
  const pad = 3
  // A thin ring round other layers is an outline too: what it rings is drawn by the layers under and
  // over it. Not when what it rings is mostly its own colour: then it is a shape under the others.
  const ringOverCover = r.holeShare <= 0.3 && sum(r.mask) < 0.45 * sum(r.outer) && !ringsOwnColour(r, labels)
  const outline = r.holeShare > 0.3 || ringOverCover
  const win = windowOf(outline ? r.outer : r.filled, fw, fh, s, r.bbox, pad, outline ? undefined : above)
  const ring = outline ? windowOf(r.mask, fw, fh, s, r.bbox, pad) : null
  const target = ring ?? win
  const paint = solid(r.rgb, r.alpha)
  const background = r.touchesEdge && sum(r.filled) >= fw * fh * 0.9
  if (cfg.paths && r.marks && r.marks >= 6) {
    const dashed = dashedOutline(ck, r, fw, fh, s, cfg)
    if (dashed) {
      renders += dashed.renders
      const name = `${colourName(r.rgb)} dashed ${shapeName(dashed.fit.params, false).replace(' outline', '')} outline`
      return {
        built: { layer: layerOf(dashed.fit.params, paint, name), params: dashed.fit.params, region: r },
        renders,
      }
    }
  }
  let fit: Fit
  if (outline) {
    const t = ringThickness(r, fw, fh) / s
    fit = fitShape(
      ck,
      win,
      { refineSteps: cfg.refineSteps, kinds: cfg.kinds.filter((k) => k !== 'line') },
      { target: ring!, stroke: t },
    )
  } else fit = fitShape(ck, win, { refineSteps: cfg.refineSteps, kinds: cfg.kinds })
  renders += fit.renders
  const name = `${colourName(r.rgb)} ${shapeName(fit.params, background)}`
  let layer = layerOf(fit.params, paint, name)
  let params: Params | null = fit.params
  let iou = fit.iou
  if (cfg.paths && iou < cfg.primAccept) {
    const traced = tracePath(target, cfg.pathTol)
    if (traced) {
      const pathLayer = pathLayerOf(traced, target, paint, `${colourName(r.rgb)} shape`)
      const piou = softIoU(
        coverage(ck, shifted(pathLayer, target.ox, target.oy), target.bw, target.bh, s, target.w, target.h),
        target.m,
      )
      renders++
      // A designer's primitive wins unless the path is clearly closer: thin outlines by 0.05.
      if (piou > iou + (outline ? 0.05 : 0.02)) {
        layer = pathLayer
        params = null
        iou = piou
      }
    }
  }
  if (background) layer.role = 'background'
  if (cfg.gradients && r.spread > 2.5 && !outline) {
    const g = gradientLayer(ck, small, r, layer, s, img)
    renders += g.renders
    if (g.layer) layer = g.layer
  }
  return { built: { layer, params, region: r }, renders }
}

/**
 * Marks of one colour round a ring are a dashed outline: the marks closed into a ring give the
 * outline's shape; their count, area and edge length give the stroke, dash and gap; the pattern's
 * start is searched, then everything refined by render-and-compare. Kept at IoU 0.55 or more.
 */
function dashedOutline(ck: CanvasKit, r: Region, fw: number, fh: number, s: number, cfg: Config) {
  let renders = 0
  const bin = new Float32Array(r.mask.length)
  for (let i = 0; i < bin.length; i++) bin[i] = r.mask[i]! >= 0.5 ? 1 : 0
  let outer: Float32Array | null = null
  for (const rad of [2, 3, 4, 6, 8, 10, 12]) {
    const dil = morph(bin, fw, fh, rad, true)
    const filled = fillAll(dil, fw, fh)
    if (sum(filled) - sum(dil) > 0.25 * sum(filled)) {
      outer = morph(filled, fw, fh, rad, false)
      break
    }
  }
  if (process.env.DBG) console.log('dashed: closed', !!outer, 'marks', r.marks)
  if (!outer) return null
  const shapeMask = windowOf(outer, fw, fh, s, r.bbox, 4)
  const target = windowOf(r.mask, fw, fh, s, r.bbox, 4)
  const base = fitShape(ck, shapeMask, { refineSteps: 20, kinds: ['rect', 'ellipse'] })
  renders += base.renders
  // Each mark is about l × t: l + t is half its edge, l·t its area.
  const loops = contours(r.mask, fw, fh, 0.5)
  let edge = 0
  for (const l of loops)
    for (let i = 0; i < l.length; i++)
      edge += Math.hypot(l[i]![0] - l[(i + 1) % l.length]![0], l[i]![1] - l[(i + 1) % l.length]![1])
  const n = r.marks!
  const A = sum(r.mask) / n / (s * s)
  const half = edge / n / 2 / s
  const disc = Math.max(0, half * half - 4 * A)
  const t = Math.max(0.8, (half - Math.sqrt(disc)) / 2)
  const p0 = base.params
  const perim =
    p0.kind === 'ellipse'
      ? Math.PI * ((3 * (p0.w + p0.h)) / 2 - Math.sqrt(((3 * p0.w) / 2 + p0.h / 2) * (p0.w / 2 + (3 * p0.h) / 2)))
      : 2 * (p0.w + p0.h) - (8 - 2 * Math.PI) * p0.r
  const period = perim / n
  const dash = Math.min(period * 0.9, A / t)
  let best: Fit = {
    params: { ...p0, outline: true, stroke: t, dash, gap: Math.max(0.5, period - dash), dashOffset: 0 },
    iou: -1,
    renders: 0,
  }
  for (let k = 0; k < 12; k++) {
    const q = { ...best.params, dashOffset: (period * k) / 12 }
    renders++
    const v = iouOf(ck, q, target)
    if (v > best.iou) best = { params: q, iou: v, renders: 0 }
  }
  const refined = refine(ck, best.params, best.iou, target, cfg.refineSteps)
  renders += refined.renders
  if (process.env.DBG)
    console.log(
      'dashed: base iou',
      base.iou.toFixed(3),
      base.params.kind,
      't',
      t.toFixed(2),
      'dash',
      dash.toFixed(1),
      'period',
      period.toFixed(1),
      'iou',
      best.iou.toFixed(3),
      '→',
      refined.iou.toFixed(3),
    )
  if (refined.iou < 0.55) return null
  return { fit: refined, renders }
}

/** Dilation (grow) or erosion of a 0/1 mask by a square of radius rad. */
function morph(m: Float32Array, w: number, h: number, rad: number, grow: boolean): Float32Array {
  const tmp = new Float32Array(m.length)
  const out = new Float32Array(m.length)
  const pick = grow ? Math.max : Math.min
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let v = grow ? 0 : 1
      for (let d = -rad; d <= rad; d++) {
        const xx = x + d
        v = pick(v, xx < 0 || xx >= w ? (grow ? 0 : 1) : m[y * w + xx]!)
      }
      tmp[y * w + x] = v
    }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let v = grow ? 0 : 1
      for (let d = -rad; d <= rad; d++) {
        const yy = y + d
        v = pick(v, yy < 0 || yy >= h ? (grow ? 0 : 1) : tmp[yy * w + x]!)
      }
      out[y * w + x] = v
    }
  return out
}

/** A 0/1 mask with every hole filled: all that the outside can't reach. */
function fillAll(m: Float32Array, w: number, h: number): Float32Array {
  const out = new Float32Array(m.length).fill(1)
  const stack: number[] = []
  for (let x = 0; x < w; x++)
    for (const y of [0, h - 1])
      if (m[y * w + x]! < 0.5 && out[y * w + x] === 1) {
        out[y * w + x] = 0
        stack.push(y * w + x)
      }
  for (let y = 0; y < h; y++)
    for (const x of [0, w - 1])
      if (m[y * w + x]! < 0.5 && out[y * w + x] === 1) {
        out[y * w + x] = 0
        stack.push(y * w + x)
      }
  while (stack.length) {
    const i = stack.pop()!
    const x = i % w
    for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) {
      if (j < 0 || j >= w * h || out[j] === 0 || m[j]! >= 0.5) continue
      out[j] = 0
      stack.push(j)
    }
  }
  return out
}

const solid = (rgb: [number, number, number], alpha: number) =>
  alpha < 0.97
    ? { type: 'solid', color: hex(...rgb), opacity: Math.round(alpha * 1000) / 1000 }
    : { type: 'solid', color: hex(...rgb) }

function pathLayerOf(
  traced: NonNullable<ReturnType<typeof tracePath>>,
  win: Mask,
  paint: Record<string, unknown>,
  name: string,
): OutLayer {
  return {
    type: 'graphic',
    name,
    props: {
      x: traced.box.x + win.ox,
      y: traced.box.y + win.oy,
      width: traced.box.width,
      height: traced.box.height,
      shape: {
        kind: 'path',
        d: traced.d,
        fillRule: 'evenodd',
        drawnIn: { width: traced.box.width, height: traced.box.height },
      },
      fills: [paint],
      strokes: [],
    },
  }
}

/** A ring's width: its area over its outer outline's length. */
function ringThickness(r: Region, fw: number, fh: number) {
  const loops = contours(r.outer, fw, fh, 0.5)
  let len = 0
  for (const l of loops)
    for (let i = 0; i < l.length; i++) {
      const a = l[i]!
      const b = l[(i + 1) % l.length]!
      len += Math.hypot(a[0] - b[0], a[1] - b[1])
    }
  return len > 0 ? sum(r.mask) / len : 1
}

/** The region's fill as a gradient, when drawing it so brings the region's ΔE down by 0.75 or more. */
function gradientLayer(ck: CanvasKit, small: Img, r: Region, layer: OutLayer, s: number, img: Img) {
  let renders = 0
  const px = innerPixels(small, r.mask)
  const g = fitGradient(px, s)
  if (!g) return { layer: null, renders }
  const props = layer.props as { x: number; y: number; width: number; height: number; rotation?: number }
  if ((props.rotation ?? 0) !== 0) return { layer: null, renders }
  const stops = g.stops.map((st) => ({ offset: Math.round(st.offset * 1000) / 1000, color: hex(...st.rgb) }))
  let paint: Record<string, unknown>
  if (g.type === 'linear') {
    // Unit-box points whose gradient runs along the pixel direction, whatever the box's aspect.
    const W = props.width
    const H = props.height
    const dx = g.to[0] - g.from[0]
    const dy = g.to[1] - g.from[1]
    const L2 = dx * dx + dy * dy
    const gx = (W * dx) / L2
    const gy = (H * dy) / L2
    const g2 = gx * gx + gy * gy
    const from = { x: (g.from[0] - props.x) / W, y: (g.from[1] - props.y) / H }
    paint = { type: 'linear', from: r4(from), to: r4({ x: from.x + gx / g2, y: from.y + gy / g2 }), stops }
  } else {
    const radius = Math.hypot(g.to[0] - g.from[0], g.to[1] - g.from[1]) / Math.min(props.width, props.height)
    paint = {
      type: 'radial',
      center: r4({ x: (g.from[0] - props.x) / props.width, y: (g.from[1] - props.y) / props.height }),
      radius: Math.max(0.001, radius),
      stops,
    }
  }
  if (r.alpha < 0.97) paint.opacity = Math.round(r.alpha * 1000) / 1000
  const flat = layer
  const grad: OutLayer = { ...layer, props: { ...layer.props, fills: [paint] } }
  const err = (l: OutLayer) => {
    renders++
    const m = drawLayers(ck, [l], img.w, img.h, s)
    return regionDeltaE(small, m, r.mask)
  }
  const ef = err(flat)
  const eg = err(grad)
  return { layer: eg <= ef - 0.75 ? grad : null, renders }
}

const r4 = (p: { x: number; y: number }) => ({ x: Math.round(p.x * 10000) / 10000, y: Math.round(p.y * 10000) / 10000 })

/** Mean ΔE between two pictures over a region's inner pixels. */
function regionDeltaE(a: Img, b: Img, mask: Float32Array) {
  let e = 0
  let n = 0
  const step = Math.max(1, Math.floor(mask.length / 20000))
  for (let i = 0; i < mask.length; i += step) {
    if (mask[i]! < 0.95) continue
    const la = rgbToLab(a.d[i * 4]!, a.d[i * 4 + 1]!, a.d[i * 4 + 2]!)
    const lb = rgbToLab(b.d[i * 4]!, b.d[i * 4 + 1]!, b.d[i * 4 + 2]!)
    e += deltaE00(la, lb)
    n++
  }
  return n ? e / n : 0
}

/**
 * Neighbouring regions whose colours together run as one gradient become one region: the bands
 * the colour split cuts a gradient into. Merged greedily, closest colours first.
 */
function mergeGradientBands(small: Img, regions: Region[], labels: Int32Array, s: number): Region[] {
  void labels
  let list = regions.slice()
  for (let guard = 0; guard < 40; guard++) {
    const pairs: { a: Region; b: Region; d: number }[] = []
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i]!
        const b = list[j]!
        if (a.alpha < 0.9 || b.alpha < 0.9 || a.marks || b.marks) continue
        const d = deltaE00(a.lab, b.lab)
        if (d > 25 || !touching(a, b, small.w)) continue
        pairs.push({ a, b, d })
      }
    pairs.sort((x, y) => x.d - y.d)
    let merged = false
    for (const { a, b } of pairs) {
      const mask = new Float32Array(a.mask.length)
      for (let i = 0; i < mask.length; i++) mask[i] = Math.min(1, a.mask[i]! + b.mask[i]!)
      const px = innerPixels(small, mask)
      const g = fitGradient(px, s)
      if (!g || g.error > 2.2) continue
      const filled = new Float32Array(mask.length)
      const outer = new Float32Array(mask.length)
      for (let i = 0; i < mask.length; i++) {
        filled[i] = Math.max(a.filled[i]!, b.filled[i]!, mask[i]!)
        outer[i] = Math.max(a.outer[i]!, b.outer[i]!, mask[i]!)
      }
      const big = sum(a.mask) >= sum(b.mask) ? a : b
      const union: Region = {
        ...big,
        mask,
        filled,
        outer,
        area: a.area + b.area,
        holeShare: Math.min(a.holeShare, b.holeShare),
        bbox: {
          x0: Math.min(a.bbox.x0, b.bbox.x0),
          y0: Math.min(a.bbox.y0, b.bbox.y0),
          x1: Math.max(a.bbox.x1, b.bbox.x1),
          y1: Math.max(a.bbox.y1, b.bbox.y1),
        },
        spread: Math.max(3, a.spread, b.spread),
        touchesEdge: a.touchesEdge || b.touchesEdge,
      }
      list = list.filter((r) => r !== a && r !== b)
      list.push(union)
      merged = true
      break
    }
    if (!merged) break
  }
  return list
}

/** Whether two regions share an edge (one of a's pixels has one of b's beside it). */
function touching(a: Region, b: Region, w: number) {
  if (a.bbox.x1 + 1 < b.bbox.x0 || b.bbox.x1 + 1 < a.bbox.x0 || a.bbox.y1 + 1 < b.bbox.y0 || b.bbox.y1 + 1 < a.bbox.y0)
    return false
  const x0 = Math.max(a.bbox.x0, b.bbox.x0) - 1
  const x1 = Math.min(a.bbox.x1, b.bbox.x1) + 1
  const y0 = Math.max(a.bbox.y0, b.bbox.y0) - 1
  const y1 = Math.min(a.bbox.y1, b.bbox.y1) + 1
  for (let y = Math.max(0, y0); y <= y1; y++)
    for (let x = Math.max(0, x0); x <= Math.min(w - 1, x1); x++) {
      const i = y * w + x
      if (
        a.mask[i]! >= 0.5 &&
        ((x + 1 < w && b.mask[i + 1]! >= 0.5) ||
          b.mask[i + w]! >= 0.5 ||
          (x > 0 && b.mask[i - 1]! >= 0.5) ||
          (b.mask[i - w] ?? 0) >= 0.5)
      )
        return true
    }
  return false
}

/** Four or more small regions of one colour (dots, dashes, marks) become one region, drawn as one path. */
function groupMarks(regions: Region[], covered: number): Region[] {
  // Group by colour: regions within ΔE 12 of a group's first are one colour (edge blends split a colour in two).
  const groups: Region[][] = []
  for (const r of [...regions].sort((a, b) => b.area - a.area)) {
    const g = groups.find((gr) => deltaE00(gr[0]!.lab, r.lab) < 12)
    if (g) g.push(r)
    else groups.push([r])
  }
  const out: Region[] = []
  for (const group of groups) {
    const small = group.filter((r) => r.area < covered * 0.05)
    if (small.length < 4) {
      out.push(...group)
      continue
    }
    out.push(...group.filter((r) => !small.includes(r)))
    const n = small[0]!.mask.length
    const mask = new Float32Array(n)
    const filled = new Float32Array(n)
    const outer = new Float32Array(n)
    for (const r of small)
      for (let i = 0; i < n; i++) {
        mask[i] = Math.max(mask[i]!, r.mask[i]!)
        filled[i] = Math.max(filled[i]!, r.filled[i]!)
        outer[i] = Math.max(outer[i]!, r.outer[i]!)
      }
    out.push({
      ...small[0]!,
      mask,
      filled,
      outer,
      area: small.reduce((a, r) => a + r.area, 0),
      // Marks are many shapes: drawn as one traced path, never as one primitive.
      holeShare: 0,
      marks: small.length,
      bbox: {
        x0: Math.min(...small.map((r) => r.bbox.x0)),
        y0: Math.min(...small.map((r) => r.bbox.y0)),
        x1: Math.max(...small.map((r) => r.bbox.x1)),
        y1: Math.max(...small.map((r) => r.bbox.y1)),
      },
      spread: 0,
    })
  }
  return out
}

/** Layers, top first, that can go without the picture changing (mean error rises under 0.25 levels). */
function prune(
  ck: CanvasKit,
  small: Img,
  layers: OutLayer[],
  params: (Params | null)[],
  img: Img,
  s: number,
  renders: number,
) {
  const err = (ls: OutLayer[]) => {
    renders++
    return meanAbs(small, drawLayers(ck, ls, img.w, img.h, s))
  }
  let base = err(layers)
  for (let i = layers.length - 1; i >= 0 && layers.length > 1; i--) {
    const without = layers.filter((_, j) => j !== i)
    const e = err(without)
    if (e <= base + 0.25) {
      layers = without
      params = params.filter((_, j) => j !== i)
      base = Math.min(base, e)
    }
  }
  return { layers, params, renders }
}

/** Mean absolute difference of premultiplied RGBA, 0..255. */
function meanAbs(a: Img, b: Img) {
  let e = 0
  const n = Math.min(a.w * a.h, b.w * b.h)
  for (let i = 0; i < n; i++) {
    const aa = a.d[i * 4 + 3]!
    const ba = b.d[i * 4 + 3]!
    for (let c = 0; c < 3; c++) e += Math.abs(a.d[i * 4 + c]! * aa - b.d[i * 4 + c]! * ba)
    e += Math.abs(aa - ba) * 255
  }
  return e / (n * 4)
}

/**
 * A soft dark fringe the layers leave uncovered, outside them, is a drop shadow: fitted on the
 * lowest layer that isn't the background by searching its offset, blur and opacity with the renderer.
 */
function fitShadow(ck: CanvasKit, small: Img, layers: OutLayer[], img: Img, s: number) {
  let renders = 0
  const made = drawLayers(ck, layers, img.w, img.h, s)
  renders++
  const n = small.w * small.h
  let left = 0
  let total = 0
  let r = 0,
    g = 0,
    b = 0,
    wsum = 0,
    mx = 0,
    my = 0
  for (let i = 0; i < n; i++) {
    const ta = small.d[i * 4 + 3]!
    total += ta
    const res = ta - made.d[i * 4 + 3]!
    if (res <= 0.03) continue
    left += res
    r += small.d[i * 4]! * res
    g += small.d[i * 4 + 1]! * res
    b += small.d[i * 4 + 2]! * res
    wsum += res
    mx += (i % small.w) * res
    my += Math.floor(i / small.w) * res
  }
  if (wsum === 0 || left < total * 0.015) return { layers, renders }
  const rgb: [number, number, number] = [r / wsum, g / wsum, b / wsum]
  const luma = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]
  if (luma > 120) return { layers, renders }
  const at = layers.findIndex((l) => l.role !== 'background')
  if (at < 0) return { layers, renders }
  const host = layers[at]!
  const hp = host.props as { x: number; y: number; width: number; height: number }
  const ox = (mx / wsum / s - (hp.x + hp.width / 2)) * 0.5
  const oy = (my / wsum / s - (hp.y + hp.height / 2)) * 0.5
  let p = { x: ox, y: oy, blur: Math.max(2, Math.min(hp.width, hp.height) * 0.08), a: 0.35 }
  const withShadow = (q: typeof p): OutLayer[] => {
    const effects = [
      {
        type: 'dropShadow',
        x: round2(q.x),
        y: round2(q.y),
        blur: round2(q.blur),
        spread: 0,
        color: hex(...rgb, Math.max(0, Math.min(1, q.a))),
      },
    ]
    return layers.map((l, i) => (i === at ? { ...l, props: { ...l.props, effects } } : l))
  }
  const err = (q: typeof p) => {
    renders++
    return meanAbs(small, drawLayers(ck, withShadow(q), img.w, img.h, s))
  }
  const before = meanAbs(small, made)
  let best = err(p)
  const steps = { x: 2, y: 2, blur: 3, a: 0.08 }
  let scale = 1
  while (scale > 0.1 && renders < 70) {
    let improved = false
    for (const k of ['x', 'y', 'blur', 'a'] as const) {
      for (const dir of [1, -1]) {
        const q = { ...p, [k]: p[k] + dir * steps[k] * scale }
        if (q.blur < 0 || q.a <= 0 || q.a > 1) continue
        const e = err(q)
        if (e < best - 1e-4) {
          best = e
          p = q
          improved = true
        }
      }
    }
    if (!improved) scale /= 2
  }
  if (best > before - 0.05) return { layers, renders }
  return { layers: withShadow(p), renders }
}

const round2 = (v: number) => Math.round(v * 100) / 100

/**
 * Each solid fill within the snap ΔE of a brand colour takes that colour and is bound to it
 * (`fill: brand:<token>`). The snap is drawn and checked: when snapping makes the block look
 * different and it looked the same before, the farthest snaps are undone until it looks the same.
 */
function snapToBrand(ck: CanvasKit, img: Img, layers: OutLayer[], brand: BrandColour[], snapDeltaE: number) {
  const variables: Record<string, string> = {}
  for (const b of brand) variables[`brand:${b.token}`] = b.value.toUpperCase()
  let renders = 0
  if (brand.length === 0) return { layers, variables, renders }
  const kit = brand.map((b) => ({ ...b, lab: rgbToLab(...parseHex(b.value).rgb) }))
  const snaps: { i: number; d: number; layer: OutLayer }[] = []
  const nearest = (color: string) => {
    const lab = rgbToLab(...parseHex(color).rgb)
    let best = kit[0]!
    let bd = Infinity
    for (const k of kit) {
      const d = deltaE00(lab, k.lab)
      if (d < bd) {
        bd = d
        best = k
      }
    }
    return { best, bd }
  }
  // Stroke colours snap too, unbound: a stroke's colour is not a bindable property.
  layers = layers.map((l) => {
    const strokes = (l.props.strokes as { paint: { type: string; color?: string } }[] | undefined) ?? []
    if (!strokes.some((st) => st.paint.type === 'solid')) return l
    return {
      ...l,
      props: {
        ...l.props,
        strokes: strokes.map((st) => {
          if (st.paint.type !== 'solid') return st
          const { best, bd } = nearest(st.paint.color!)
          return bd <= snapDeltaE
            ? { ...st, paint: { ...st.paint, color: best.value.slice(0, 7).toUpperCase() + 'FF' } }
            : st
        }),
      },
    }
  })
  const out = layers.map((l, i) => {
    const fills = (l.props.fills as { type: string; color?: string }[] | undefined) ?? []
    const at = fills.findLastIndex((f) => f.type === 'solid')
    if (at < 0 || at !== fills.length - 1) return l
    const c = parseHex(fills[at]!.color!)
    const lab = rgbToLab(...c.rgb)
    let best = kit[0]!
    let bd = Infinity
    for (const k of kit) {
      const d = deltaE00(lab, k.lab)
      if (d < bd) {
        bd = d
        best = k
      }
    }
    if (bd > snapDeltaE) return l
    const color = best.value.slice(0, 7).toUpperCase() + 'FF'
    const snapped: OutLayer = {
      ...l,
      bindings: { fill: `brand:${best.token}` },
      props: { ...l.props, fills: fills.map((f, j) => (j === at ? { ...f, color } : f)) },
    }
    snaps.push({ i, d: bd, layer: l })
    return snapped
  })
  if (snaps.length === 0) return { layers, variables, renders }
  const looks = (ls: OutLayer[]) => {
    renders++
    return score(img, drawLayers(ck, ls, img.w, img.h, 1, variables)).same
  }
  if (looks(out) || !looks(layers)) return { layers: out, variables, renders }
  snaps.sort((a, b) => b.d - a.d)
  const cur = out.slice()
  for (const sn of snaps) {
    cur[sn.i] = sn.layer
    if (looks(cur)) break
  }
  return { layers: cur, variables, renders }
}

/** Every region as a traced path in its flat colour. */
function tracedOnly(ck: CanvasKit, small: Img, regions: Region[], img: Img, s: number, fw: number, fh: number) {
  void ck
  void small
  void img
  const layers: OutLayer[] = []
  for (const r of regions) {
    const win = windowOf(r.filled, fw, fh, s, r.bbox, 3)
    const traced = tracePath(win, 0.5)
    if (traced) layers.push(pathLayerOf(traced, win, solid(r.rgb, r.alpha), `${colourName(r.rgb)} shape`))
  }
  return { layers, renders: 0 }
}

/**
 * ΔE00 per pixel between two pictures each blurred by a 1-pixel Gaussian, over white and over black,
 * the worse: edges a fraction of a pixel apart agree, a part missing or misshapen does not.
 */
function blurredDeltaE(a: Img, b: Img): Float32Array {
  const n = a.w * a.h
  const out = new Float32Array(n)
  for (const bg of [
    [255, 255, 255],
    [0, 0, 0],
  ] as [number, number, number][]) {
    const pa = blur1(over(a, bg), a.w, a.h)
    const pb = blur1(over(b, bg), a.w, a.h)
    for (let i = 0; i < n; i++) {
      const d = pairDeltaE(pa[i * 3]!, pa[i * 3 + 1]!, pa[i * 3 + 2]!, pb[i * 3]!, pb[i * 3 + 1]!, pb[i * 3 + 2]!)
      if (d > out[i]!) out[i] = d
    }
  }
  return out
}

/** Gaussian blur σ 1 of an RGB array, edges clamped. */
function blur1(src: Float32Array, w: number, h: number): Float32Array {
  const k = [0.0044, 0.054, 0.242, 0.399, 0.242, 0.054, 0.0044]
  const tmp = new Float32Array(src.length)
  const out = new Float32Array(src.length)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      for (let c = 0; c < 3; c++) {
        let v = 0
        for (let d = -3; d <= 3; d++) v += k[d + 3]! * src[(y * w + Math.max(0, Math.min(w - 1, x + d))) * 3 + c]!
        tmp[(y * w + x) * 3 + c] = v
      }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      for (let c = 0; c < 3; c++) {
        let v = 0
        for (let d = -3; d <= 3; d++) v += k[d + 3]! * tmp[(Math.max(0, Math.min(h - 1, y + d)) * w + x) * 3 + c]!
        out[(y * w + x) * 3 + c] = v
      }
  return out
}

/** The worst region's mean ΔE at full size, over regions of 0.5 % of the block or more. */
function worstPart(deMap: Float32Array, regions: Region[], img: Img, s: number) {
  let worst = { de: 0, share: 0 }
  const fw = Math.ceil(img.w * s - 1e-9)
  let total = 0
  for (const r of regions) total += r.area
  for (const r of regions) {
    if (r.area < total * 0.005) continue
    let e = 0
    let n = 0
    for (let y = 0; y < img.h; y++)
      for (let x = 0; x < img.w; x++) {
        if (r.mask[Math.floor(y * s) * fw + Math.min(fw - 1, Math.floor(x * s))]! < 0.5) continue
        e += deMap[y * img.w + x]!
        n++
      }
    if (n > 0 && e / n > worst.de) worst = { de: e / n, share: r.area / total }
  }
  return worst
}

const sum = (a: Float32Array) => {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i]!
  return s
}

export { labToRgb }
