// The layers that show under a point, front-most first, and the one a click or a hover picks from
// them: the deepest of the topmost. A shape counts inside its outline, as the renderer draws it, and
// on its strokes; a text on its laid-out lines, or on its placed letters' turned boxes when they are
// moved and turned (ADR-0021), or anywhere in its box while it frosts what lies behind.
// A flipped layer is read where it draws: its paints and lines mirrored, never the layers inside it.
// Where a layer is drawn under 10% opaque, its own opacity, its groups', its mask's and its paint's
// there multiplied, it shows nothing, and the click passes to the layer beneath.
import type { CanvasKit, Path } from '@dazbee/canvaskit'
import { flippedPoint, type Flips } from '@dazbee/doc'
import {
  type ImageBeyond,
  imageBeyond,
  imagePlacement,
  inTurned,
  letterBoxes,
  LUMA,
  radialRadius,
  type SceneLayer,
  type TextLayout,
  type TurnedRect,
} from '@dazbee/renderer'
import type { Color, ImagePaint, Paint, Point, Rect, Stroke, TextProps } from '@dazbee/schema'

import { type AlphaMap, opacityAt } from './alpha-map.ts'

/** What a hit test reads to tell where a layer shows, each kept by the caller between tests. */
export interface Looks {
  /** A layer's outline, as the renderer's `outlineOf` makes it; the caller keeps it and frees it. */
  outline(layer: SceneLayer): Path
  /** The `outlineBand` of a layer's outline, `reach` wide; the caller keeps it and frees it. */
  band(layer: SceneLayer, reach: number): Path | null
  /** A decoded image's alpha map, by asset id; none while the image loads, when a photo shows all over its outline. */
  alpha(assetId: string): AlphaMap | undefined
  /** A text's `lineBoxes`, its lines' or its placed letters', from its layout as drawn. */
  lines(props: TextProps): readonly TurnedRect[]
}

export interface HitOptions {
  /** Whether a layer can be picked; one that can't (locked) is passed over with everything in it. */
  pickable?: ((layer: SceneLayer) => boolean) | undefined
  /** The id of a layer that counts everywhere in its box, as the text being typed in does. */
  wholeBox?: string | undefined
  /**
   * The selected layers' ids. One drawn under SEE_THROUGH opaque with its strongest paint still
   * counts all over its box, so a click or a hover there finds it where its handles are.
   */
  selected?: readonly string[] | undefined
  /** The camera's zoom: the reaches round a line, a path and a shape's outline are in screen pixels. 1 by default. */
  zoom?: number | undefined
}

/** A layer that shows under a point, how many groups, boxes and booleans deep in its frame, and what a pick there reaches in it. */
export interface LayerUnder {
  layer: SceneLayer
  depth: number
  /** The layer itself, or for a boolean the shape of it under the point, which a pick reaches. */
  reaches: SceneLayer
  /** Whether layers it holds show there too, listed right after it. */
  holds: boolean
}

/** A hit test's options, with the design pixels per screen pixel its reaches are in. */
type Hit = HitOptions & { unit: number }
/** Told of each layer under a point, front-most first; returning true stops the walk. */
type Visit = (under: LayerUnder) => boolean
type TextLayer = Extract<SceneLayer, { type: 'text' }>
/** A layer with an outline and paints of its own. */
type Painted = Extract<SceneLayer, { type: 'graphic' | 'boolean' | 'box' }>
/** Red, green, blue and alpha, each from 0 to 1. */
type Rgba = readonly [number, number, number, number]

/** How near a line or a path's stroke a click picks it, in screen pixels, beyond half the stroke. */
export const LINE_REACH = 4
/** How near a shape's outline, outside it, a click still picks it, in screen pixels: a thin one stays easy to pick zoomed out. */
export const NEAR_REACH = 1

/** How opaque a layer must be drawn under the point to be picked there; below it the click passes on. */
const SEE_THROUGH = 0.1

const everything = () => true

/**
 * The topmost layer that shows under a page point. Inside a group, box or boolean it is the child
 * there, so a click can move single layers; a clipping box hides what lies outside its outline. A
 * layer that isn't `pickable` (locked) is passed over with everything in it, so the click reaches
 * what lies beneath. A mask is never picked, and what it masks only where the mask shows.
 */
export function hitTest(layers: SceneLayer[], p: Point, looks: Looks, options: HitOptions = {}): SceneLayer | null {
  // The front-most layer's run, down through the layers it holds to one that holds none showing:
  // nothing behind it is read.
  let picked: SceneLayer | null = null
  underIn(layers, p, looks, hitOf(options), 1, 0, (under) => {
    if (under.holds) return false
    picked = under.reaches
    return true
  })
  return picked
}

/**
 * Every layer that shows under a page point, front-most first, each listed before the layers it
 * holds that show there, with how deep it is: what the hit test picks from, the first run of it
 * down to its deepest layer. A boolean is one layer, reaching the shape of it under the point. A
 * layer that isn't `pickable` is left out with everything in it, a mask is never listed, and what
 * it masks only where the mask shows.
 */
export function layersAt(layers: SceneLayer[], p: Point, looks: Looks, options: HitOptions = {}): LayerUnder[] {
  const all: LayerUnder[] = []
  underIn(layers, p, looks, hitOf(options), 1, 0, (under) => {
    all.push(under)
    return false
  })
  return all
}

/**
 * Where a text shows: the boxes of its laid-out lines and list markers, in its own coordinates from
 * its box's corner, its vertical alignment applied. A line with no words has no box. A text whose
 * letters are placed shows on each letter's turned box in place of its lines.
 */
export function lineBoxes(laid: TextLayout): TurnedRect[] {
  const boxes: TurnedRect[] = laid.placed ? letterBoxes(laid.placed) : []
  for (const b of laid.blocks) {
    const y = laid.dy + b.y
    const { marker } = b
    if (marker)
      boxes.push({
        x: b.markerX,
        y: y + b.markerY,
        width: marker.getMaxIntrinsicWidth(),
        height: marker.getHeight(),
      })
    for (const line of laid.placed ? [] : b.paragraph.getLineMetrics()) {
      if (line.width > 0)
        boxes.push({ x: b.x + line.left, y: y + line.baseline - line.ascent, width: line.width, height: line.height })
    }
  }
  return boxes
}

/**
 * What lies within `reach` of an outline, either side of it along its whole length, round at its
 * corners and ends; null when CanvasKit can't stroke it.
 */
export function outlineBand(ck: CanvasKit, outline: Path, reach: number): Path | null {
  return outline.makeStroked({ width: reach * 2, cap: ck.StrokeCap.Round, join: ck.StrokeJoin.Round })
}

/** How far on screen, at `zoom`, a hit test reaches for a reach of its own (`NEAR_REACH`, `LINE_REACH`). */
export function screenReach(reach: number, zoom: number) {
  return reach * unitOf(zoom) * zoom
}

/** How far either side of its axis, on screen at `zoom`, a hit test picks a line. */
export function lineReach(line: Pick<Rect, 'height'> & { strokes: readonly Stroke[] }, zoom: number) {
  return reachOfLine(line, unitOf(zoom)) * zoom
}

/**
 * Tells `visit` of the layers of one parent that show at a point, front-most first, each drawn at
 * `fade` of its own opacity, until it returns true; returns whether it did.
 */
function underIn(
  layers: SceneLayer[],
  p: Point,
  looks: Looks,
  options: Hit,
  fade: number,
  depth: number,
  visit: Visit,
): boolean {
  const pickable = options.pickable ?? everything
  // A mask isn't drawn, and what it masks shows only inside it, as opaque or bright as it is there.
  const maskOf: (SceneLayer | null)[] = []
  let mask: SceneLayer | null = null
  for (const layer of layers) {
    maskOf.push(layer.props.mask ? null : mask)
    if (layer.props.mask) mask = layer
  }
  const masksShowing = new Map<SceneLayer, number | null>()
  const maskShows = (m: SceneLayer) => {
    let shows = masksShowing.get(m)
    if (shows === undefined) masksShowing.set(m, (shows = maskAt(m, p, looks, options.unit)))
    return shows
  }
  for (let i = layers.length - 1; i >= 0; i--) {
    const layer = layers[i] as SceneLayer
    const masked = maskOf[i]
    if (layer.props.mask || !pickable(layer)) continue
    const through = masked ? maskShows(masked) : 1
    if (through === null) continue
    if (layerUnder(layer, p, looks, options, fade * through, depth, visit)) return true
  }
  return false
}

/** A hit test's options with the design pixels per screen pixel at its zoom. */
function hitOf(options: HitOptions): Hit {
  return { ...options, unit: unitOf(options.zoom ?? 1) }
}

/**
 * How much a mask lets show at a point in its parent's coordinates, from 0 to 1: an alpha mask by
 * its opacity and its paint's alpha there, a luminance mask by its paint's brightness; a group or a
 * box by the layers in it too. Null where the mask draws nothing, so what it masks isn't there at all.
 */
function maskAt(
  mask: SceneLayer,
  p: Point,
  looks: Looks,
  unit: number,
  luminance = mask.props.mask === 'luminance',
): number | null {
  const q = unrotate(p, mask)
  let shown: number | null
  if (mask.type === 'text') shown = onLines(looks, mask, q) ? textShade(mask.props, luminance) : null
  else if (mask.type === 'group') shown = brightest(mask.children, q, looks, unit, luminance)
  else {
    shown = paintAt(looks, mask, q, 1, luminance, unit)
    const inside = mask.type === 'box' ? brightest(mask.children, q, looks, unit, luminance) : null
    if (inside !== null) shown = Math.max(shown ?? 0, inside)
  }
  return shown === null ? null : mask.props.opacity * shown
}

/** The most that the layers of a group or box used as a mask let show at a point; null where none of them draws. */
function brightest(layers: SceneLayer[], q: Point, looks: Looks, unit: number, luminance: boolean): number | null {
  let most: number | null = null
  for (const layer of layers) {
    const shown = layer.props.mask ? null : maskAt(layer, q, looks, unit, luminance)
    if (shown !== null) most = Math.max(most ?? 0, shown)
  }
  return most
}

/**
 * Tells `visit` of a layer that shows at a point in its parent's coordinates, drawn at `outer` of its
 * own opacity, then of the layers in it that show there, until it returns true; returns whether it did.
 * A hidden layer the stage shows faded is hit as it would be drawn shown.
 */
function layerUnder(
  layer: SceneLayer,
  p: Point,
  looks: Looks,
  options: Hit,
  outer: number,
  depth: number,
  visit: Visit,
): boolean {
  const fade = layer.faded ? outer / layer.faded : outer
  const q = unrotate(p, layer)
  if (layer.id === options.wholeBox) return inBox(q, layer.props) && visitAlone(visit, layer, depth)
  if (options.selected?.includes(layer.id) && inBox(q, layer.props) && fade * strongest(layer) < SEE_THROUGH)
    return visitAlone(visit, layer, depth)
  const shown = fade * layer.props.opacity
  switch (layer.type) {
    case 'group':
      return holding(layer, q, looks, options, shown, depth, visit) ?? false
    case 'box':
      // Past a clipping box's outline only its strokes show: the clip never cuts them.
      if (layer.props.clip && !inOutline(looks, layer, q))
        return shows(looks, layer, q, fade, options.unit) && visitAlone(visit, layer, depth)
      return (
        holding(layer, q, looks, options, shown, depth, visit) ??
        (shows(looks, layer, q, fade, options.unit) && visitAlone(visit, layer, depth))
      )
    case 'boolean':
      // Its shapes' own paints don't show, only the boolean's: the shape under the point is reached
      // where the boolean shows, so a click inside it can still reach one shape.
      if (!shows(looks, layer, q, fade, options.unit)) return false
      return visit({
        layer,
        depth,
        reaches: shapeUnder(looks, layer.children, q, options.pickable ?? everything) ?? layer,
        holds: false,
      })
    case 'text':
      // Frosted text frosts its whole box, so it shows anywhere there; else only on its lines.
      return (
        ((frosted(layer) && fade >= SEE_THROUGH && inBox(q, layer.props)) ||
          (shown * textShade(layer.props, false) >= SEE_THROUGH && onLines(looks, layer, q))) &&
        visitAlone(visit, layer, depth)
      )
    case 'graphic':
      return shows(looks, layer, q, fade, options.unit) && visitAlone(visit, layer, depth)
  }
}

/** Tells `visit` of a layer that shows under the point itself, reaching itself and holding none that show. */
function visitAlone(visit: Visit, layer: SceneLayer, depth: number) {
  return visit({ layer, depth, reaches: layer, holds: false })
}

/**
 * Tells `visit` of a group or box, then of the layers in it that show at a point in its own
 * coordinates; whether `visit` returned true, or null when none of them shows.
 */
function holding(
  layer: SceneLayer,
  q: Point,
  looks: Looks,
  options: Hit,
  shown: number,
  depth: number,
  visit: Visit,
): boolean | null {
  let any = false
  const stopped = underIn(layer.children, q, looks, options, shown, depth + 1, (under) => {
    if (!any) {
      any = true
      if (visit({ layer, depth, reaches: layer, holds: true })) return true
    }
    return visit(under)
  })
  return any ? stopped : null
}

/** The point as seen from inside a layer: un-rotated about the layer's centre. */
function unrotate(p: Point, layer: SceneLayer): Point {
  const { x, y, width, height, rotation } = layer.props
  if (rotation === 0) return p
  const cx = x + width / 2
  const cy = y + height / 2
  const a = (-rotation * Math.PI) / 180
  const dx = p.x - cx
  const dy = p.y - cy
  return { x: cx + dx * Math.cos(a) - dy * Math.sin(a), y: cy + dx * Math.sin(a) + dy * Math.cos(a) }
}

function inBox(q: Point, box: Rect, grow = 0) {
  return (
    q.x >= box.x - grow && q.x <= box.x + box.width + grow && q.y >= box.y - grow && q.y <= box.y + box.height + grow
  )
}

/**
 * How opaque a layer is drawn where it is strongest, its own opacity included, from 0 to 1: a group
 * or a box by its strongest layer too, frosted glass as opaque, and a shape with no paint as
 * showing inside its outline.
 */
function strongest(layer: SceneLayer): number {
  if (frosted(layer)) return 1
  const { opacity } = layer.props
  if (layer.type === 'text') return opacity * textShade(layer.props, false)
  const inside = layer.type === 'group' || layer.type === 'box' ? layer.children.filter((c) => !c.props.mask) : []
  const most = Math.max(0, ...inside.map(strongest))
  if (layer.type === 'group') return opacity * most
  const paints = [...layer.props.fills, ...strokePaints(layer.props.strokes)].filter((f) => f.visible !== false)
  const own = paints.length === 0 ? 1 : Math.max(...paints.map(paintStrongest))
  return opacity * Math.max(own, most)
}

/** Whether a layer frosts what lies behind it inside its outline, which its own opacity doesn't fade. */
function frosted(layer: SceneLayer) {
  return layer.props.effects.some((e) => e.type === 'backgroundBlur' && e.radius > 0)
}

/** How opaque, or for `luminance` how bright, a text's strongest colour is: its style's, a run's or its outline's. */
function textShade(props: TextProps, luminance: boolean) {
  const colours = [props.style.color, ...props.runs.flatMap((r) => (r.style.color ? [r.style.color] : []))]
  const { outline } = props.style
  if (outline && outline.width > 0) colours.push(outline.color)
  return Math.max(...colours.map((c) => shade(rgbaOf(c), luminance)))
}

/** How opaque a paint is where it is strongest: a gradient by its most opaque stop, a photo by its opacity. */
function paintStrongest(paint: Paint) {
  const opacity = paint.opacity ?? 1
  if (paint.type === 'solid') return rgbaOf(paint.color)[3] * opacity
  if (paint.type === 'image') return opacity
  return Math.max(...paint.stops.map((s) => rgbaOf(s.color)[3])) * opacity
}

function inOutline(looks: Looks, layer: SceneLayer, q: Point) {
  return inBox(q, layer.props) && looks.outline(layer).contains(q.x, q.y)
}

/**
 * Whether a shape, boolean or box drawn at `fade` of its own opacity shows at a point in its own
 * coordinates: where its paints show, or inside its outline where it frosts what lies behind it.
 */
function shows(looks: Looks, layer: Painted, q: Point, fade: number, unit: number): boolean {
  if (fade < SEE_THROUGH) return false
  const shown = fade * layer.props.opacity
  const need = SEE_THROUGH / shown
  if (shown >= SEE_THROUGH && (paintAt(looks, layer, q, need, false, unit) ?? 0) >= need) return true
  return frosted(layer) && inOutline(looks, layer, q)
}

/**
 * How opaque, or for `luminance` how bright, a shape, boolean or box's paints are at a point in its
 * own coordinates, from 0 to 1: inside its outline its fills, and on its strokes, past the outline
 * or within it, its strokes. Null where it has no paint at all. A line is painted near it, however
 * thin its box; a path also near its stroke, so a thin one is as easy to pick; any other shape
 * also just outside its outline, as its fills are there. The reaches the hit test adds are
 * `unit` design pixels per screen pixel. Once the paint is at least `need`, the rest isn't looked at.
 */
function paintAt(
  looks: Looks,
  layer: Painted,
  q: Point,
  need: number,
  luminance: boolean,
  unit: number,
): number | null {
  const { props } = layer
  const kind = layer.type === 'graphic' ? layer.props.shape.kind : null
  if (kind === 'line')
    return nearLine(q, layer, unit) ? (over(looks, strokePaints(props.strokes), props, q, luminance) ?? 1) : null
  const reach =
    kind === 'path'
      ? Math.max(0, ...props.strokes.map((s) => s.width / 2)) + LINE_REACH * unit
      : strokeReach(props.strokes, 'outside')
  const near = kind === 'path' ? 0 : NEAR_REACH * unit
  if (!inBox(q, props, Math.max(reach, near))) return null
  const strokes = () => over(looks, strokePaints(props.strokes), props, q, luminance)
  // With no fill, a closed outline shows all over inside it, so an empty box is easy to grab; an
  // open path shows only along its line, so with no fill showing only its kept band is read.
  const open = kind === 'path' && opens(layer)
  if (open && props.fills.every((f) => f.visible === false))
    return nearOutline(looks, layer, q, reach) ? strokes() : null
  if (!looks.outline(layer).contains(q.x, q.y)) {
    const stroked = nearOutline(looks, layer, q, reach) ? strokes() : null
    if (stroked !== null || !nearOutline(looks, layer, q, near)) return stroked
  }
  const fill = over(looks, props.fills, props, q, luminance) ?? (open ? null : 1)
  if (fill !== null && fill >= need) return fill
  // Where the fill is clear or an open path has none, the strokes still show along the outline.
  const within = kind === 'path' ? reach : strokeReach(props.strokes, 'inside')
  if (!nearOutline(looks, layer, q, within)) return fill
  const stroke = strokes() ?? 0
  // Laid over the fill, a stroke adds to how opaque it is there; brightness is taken at the brighter.
  return luminance ? Math.max(fill ?? 0, stroke) : 1 - (1 - (fill ?? 0)) * (1 - stroke)
}

/** A line is picked along it, as far either side of its axis as `reachOfLine`. */
function nearLine(q: Point, layer: Painted, unit: number) {
  const { x, y, width, height } = layer.props
  return q.x >= x && q.x <= x + width && Math.abs(q.y - (y + height / 2)) <= reachOfLine(layer.props, unit)
}

/**
 * How far either side of its axis a line is picked, in design pixels with `unit` design pixels per
 * screen pixel: half its stroke, or half its box's height, and LINE_REACH screen pixels more.
 */
function reachOfLine({ height, strokes }: Pick<Rect, 'height'> & { strokes: readonly Stroke[] }, unit: number) {
  return Math.max(height / 2, ...strokes.map((s) => s.width / 2)) + LINE_REACH * unit
}

/** How far the visible strokes show past the outline, or within it: all of one on that side, half a centred one. */
function strokeReach(strokes: readonly Stroke[], side: 'inside' | 'outside') {
  return Math.max(
    0,
    ...strokes.map((s) =>
      s.paint.visible === false ? 0 : s.align === side ? s.width : s.align === 'center' ? s.width / 2 : 0,
    ),
  )
}

/** Whether a point is within `reach` of a layer's outline, along it; never with no reach. */
function nearOutline(looks: Looks, layer: SceneLayer, q: Point, reach: number) {
  return reach > 0 && (looks.band(layer, reach)?.contains(q.x, q.y) ?? false)
}

/** Whether a path layer leaves a contour open, its outline holding no area of its own. */
function opens(layer: Painted) {
  const d = layer.type === 'graphic' && layer.props.shape.kind === 'path' ? layer.props.shape.d : ''
  return !d.split(/(?=[Mm])/).every((contour) => contour.trim() === '' || /[Zz]\s*$/.test(contour))
}

/**
 * How opaque, or for `luminance` how bright over black, paints laid one over another are at a
 * point of a box, from 0 to 1, mirrored as the box is flipped; null when none of them shows.
 */
function over(looks: Looks, paints: readonly Paint[], box: Rect & Flips, q: Point, luminance: boolean): number | null {
  let shown: number | null = null
  const at = flippedPoint(q, box)
  for (const paint of paints) {
    if (paint.visible === false) continue
    const rgba = paintRgba(looks, paint, box, at)
    const alpha = rgba[3]
    shown = shade(rgba, luminance) + (shown ?? 0) * (1 - alpha)
  }
  return shown
}

function strokePaints(strokes: readonly Stroke[]) {
  return strokes.map((s) => s.paint)
}

/** A paint's colour at a point of a box, its own opacity in its alpha: a gradient by its stops there, a photo by its alpha map. */
function paintRgba(looks: Looks, paint: Paint, box: Rect, q: Point): Rgba {
  const opacity = paint.opacity ?? 1
  let rgba: Rgba
  switch (paint.type) {
    case 'solid':
      rgba = rgbaOf(paint.color)
      break
    case 'image':
      rgba = [1, 1, 1, photoOpacity(looks, paint, box, q)]
      break
    default:
      rgba = stopsAt(paint.stops, gradientAt(paint, box, q))
  }
  return [rgba[0], rgba[1], rgba[2], rgba[3] * opacity]
}

/** How opaque, or for `luminance` how bright over black, a colour is. */
function shade([r, g, b, a]: Rgba, luminance: boolean) {
  return luminance ? (LUMA[0] * r + LUMA[1] * g + LUMA[2] * b) * a : a
}

function rgbaOf(hex: Color): Rgba {
  const n = (i: number) => Number.parseInt(hex.slice(i, i + 2), 16) / 255
  return [n(1), n(3), n(5), n(7)]
}

/** Where a point of a box falls along a gradient, from 0 at its first stop to 1 at its last, as the renderer places it in the box. */
function gradientAt(paint: Exclude<Paint, { type: 'solid' | 'image' }>, box: Rect, q: Point) {
  const u = { x: box.width > 0 ? (q.x - box.x) / box.width : 0, y: box.height > 0 ? (q.y - box.y) / box.height : 0 }
  let t: number
  if (paint.type === 'linear') {
    const dx = paint.to.x - paint.from.x
    const dy = paint.to.y - paint.from.y
    const length = dx * dx + dy * dy
    t = length > 0 ? ((u.x - paint.from.x) * dx + (u.y - paint.from.y) * dy) / length : 0
  } else if (paint.type === 'radial') {
    // A circle in any box, its radius a share of the shorter side.
    const dx = (u.x - paint.center.x) * box.width
    const dy = (u.y - paint.center.y) * box.height
    const radius = radialRadius(paint, box)
    t = radius > 0 ? Math.hypot(dx, dy) / radius : 1
  } else {
    // Clockwise from the angle, as y grows downwards.
    const degrees = (Math.atan2(u.y - paint.center.y, u.x - paint.center.x) * 180) / Math.PI - paint.angle
    t = (((degrees / 360) % 1) + 1) % 1
  }
  return Math.min(1, Math.max(0, t))
}

/** The colour of gradient stops at an offset, mixed between the stops either side of it. */
function stopsAt(stops: readonly { offset: number; color: Color }[], t: number): Rgba {
  const first = stops[0]
  const last = stops.at(-1)
  if (!first || !last) return [0, 0, 0, 0]
  if (t <= first.offset) return rgbaOf(first.color)
  if (t >= last.offset) return rgbaOf(last.color)
  const after = stops.findIndex((s) => s.offset >= t)
  const a = stops[after - 1] ?? first
  const b = stops[after] ?? last
  const k = b.offset > a.offset ? (t - a.offset) / (b.offset - a.offset) : 0
  const from = rgbaOf(a.color)
  const to = rgbaOf(b.color)
  const mix = (i: 0 | 1 | 2 | 3) => from[i] + (to[i] - from[i]) * k
  return [mix(0), mix(1), mix(2), mix(3)]
}

/**
 * How opaque a photo fill's image is at a point, its crop and fit placing the pixel; opaque
 * while its alpha map isn't there yet.
 */
function photoOpacity(looks: Looks, fill: ImagePaint, box: Rect, q: Point) {
  const map = looks.alpha(fill.assetId)
  if (!map) return 1
  const { imageWidth: iw, imageHeight: ih } = map
  const size = { width: iw, height: ih }
  const rect = imagePlacement(size, fill, box)
  const beyond = imageBeyond(size, fill)
  // Past the image's edges, as the renderer draws there: the image again, nothing, or its edge.
  const at = (v: number, length: number, mode: ImageBeyond) => {
    if (mode === 'repeat') return ((v % length) + length) % length
    if (mode === 'clear' && (v < 0 || v > length)) return null
    return Math.min(Math.max(v, 0), length - 0.5)
  }
  const x = at(((q.x - rect.x) * iw) / rect.width, iw, beyond.x)
  const y = at(((q.y - rect.y) * ih) / rect.height, ih, beyond.y)
  return x === null || y === null ? 0 : opacityAt(map, x, y)
}

/** The topmost pickable shape of a boolean whose own outline holds a point, inside a boolean within it too. */
function shapeUnder(
  looks: Looks,
  shapes: SceneLayer[],
  p: Point,
  pickable: (layer: SceneLayer) => boolean,
): SceneLayer | null {
  for (let i = shapes.length - 1; i >= 0; i--) {
    const shape = shapes[i] as SceneLayer
    if (!pickable(shape) || (shape.type !== 'graphic' && shape.type !== 'boolean')) continue
    if (shape.type === 'graphic' && shape.props.shape.kind === 'line') continue
    const q = unrotate(p, shape)
    if (!inOutline(looks, shape, q)) continue
    return shape.type === 'boolean' ? (shapeUnder(looks, shape.children, q, pickable) ?? shape) : shape
  }
  return null
}

/**
 * Whether a point in a text's own coordinates is on one of its laid-out lines or list markers, as
 * they are drawn, mirrored when it is flipped: not in the empty box below them or after a short
 * line. A text with no words is picked by its box, so it can still be grabbed.
 */
function onLines(looks: Looks, layer: TextLayer, q: Point) {
  const { props } = layer
  if (!inBox(q, props)) return false
  const lines = looks.lines(props)
  const own = flippedPoint(q, props)
  const at = { x: own.x - props.x, y: own.y - props.y }
  return lines.length === 0 || lines.some((line) => inTurned(at, line))
}

/**
 * Design pixels per screen pixel at a zoom, in steps of a power of two, so the outline bands a hit
 * test reads at a zoom are few and kept.
 */
function unitOf(zoom: number) {
  return 1 / 2 ** Math.round(Math.log2(zoom > 0 ? zoom : 1))
}
