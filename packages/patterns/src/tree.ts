// The layers a pattern builds, as a tree design.place takes: each layer's id and link id the part it is, its props
// filled with the schema's defaults; and the shapes, pictures and paints the patterns build them from.
import {
  type Bindings,
  type ImageCrop,
  Layer,
  type LayerTree,
  type Paint,
  type Rect,
  type Stroke,
  type UnplacedLayer,
} from '@dazbee/schema'

import type { Swatch } from './palette.ts'
import type { Picture } from './types.ts'

/** A layer as a pattern makes it: its type, name, what it is in the ad (its role), props as the schema takes them, and bindings. */
export interface Part {
  type: UnplacedLayer['type']
  name: string
  role?: Layer['role']
  props: Record<string, unknown>
  bindings?: Bindings
}

/** A fill and the binding that makes it follow its brand role. */
export interface Fill {
  fills: Paint[]
  bindings?: Bindings
}

/** What a frame's layers are built with: parts added on top, each inside the part named, or the frame. */
export interface TreeBuilder {
  add(key: string, part: Part, parent?: string): string
  /** Adds a part at the frame's top level just over the top-level part `over`, under every part added after it. */
  addOver(key: string, part: Part, over: string): string
  /** Moves a part added before, and what it holds, down by `dy`. */
  moveDown(key: string, dy: number): void
  tree(): LayerTree
}

/** Where a root of the tree sits until design.place puts it in a frame. */
const PLACEHOLDER_PARENT = 'frame'

/** A tree of parts, added on top of the ones before, each part's id and link id its key. */
export function treeBuilder(): TreeBuilder {
  const nodes: Record<string, Layer> = {}
  const roots: string[] = []
  let count = 0
  function add(key: string, part: Part, parent?: string): string {
    if (Object.hasOwn(nodes, key)) throw new Error(`the pattern has two parts "${key}"`)
    if (parent !== undefined && !Object.hasOwn(nodes, parent)) throw new Error(`no part "${parent}" to put "${key}" in`)
    const index = `a${(count++).toString().padStart(4, '0')}`
    nodes[key] = Layer.parse({ ...part, parentId: parent ?? PLACEHOLDER_PARENT, link: key, index })
    if (parent === undefined) roots.push(key)
    return key
  }
  function addOver(key: string, part: Part, over: string): string {
    const below = nodes[over]
    const at = roots.indexOf(over)
    if (!below || at < 0) throw new Error(`no top-level part "${over}" to put "${key}" over`)
    if (Object.hasOwn(nodes, key)) throw new Error(`the pattern has two parts "${key}"`)
    // The top-level parts are drawn in the order they are listed; its index is past the part's own, before the next.
    const index = `${below.index}V${(count++).toString().padStart(4, '0')}`
    nodes[key] = Layer.parse({ ...part, parentId: PLACEHOLDER_PARENT, link: key, index })
    roots.splice(at + 1, 0, key)
    return key
  }
  function moveDown(key: string, dy: number) {
    for (const [id, node] of Object.entries(nodes))
      if (id === key || insideOf(id, key)) node.props.y = round(node.props.y + dy)
  }
  function insideOf(id: string, key: string): boolean {
    for (let up = nodes[id]?.parentId; up && Object.hasOwn(nodes, up); up = nodes[up]?.parentId)
      if (up === key) return true
    return false
  }
  return { add, addOver, moveDown, tree: () => ({ nodes, roots }) }
}

/** A solid fill of a colour, bound to its brand role when it has one. */
export function solid(swatch: Swatch, opacity?: number): Fill {
  const paint: Paint = { type: 'solid', color: swatch.value, ...(opacity === undefined ? {} : { opacity }) }
  return { fills: [paint], ...(swatch.ref ? { bindings: { fill: swatch.ref } } : {}) }
}

/** A linear gradient across a box, from `from` to `to` in its unit box, through colours at even steps. */
export function linear(from: [number, number], to: [number, number], colours: readonly string[]): Fill {
  const stops = colours.map((color, i) => ({ offset: i / (colours.length - 1), color }))
  return { fills: [{ type: 'linear', from: { x: from[0], y: from[1] }, to: { x: to[0], y: to[1] }, stops }] }
}

/** A radial gradient from the middle of a box out to its shorter side, through colours at even steps. */
export function radial(colours: readonly string[], radius = 0.5): Fill {
  const stops = colours.map((color, i) => ({ offset: i / (colours.length - 1), color }))
  return { fills: [{ type: 'radial', center: { x: 0.5, y: 0.5 }, radius, stops }] }
}

/** A rectangle, its corners rounded by `radius`, or each its own. */
export function rect(
  name: string,
  box: Rect,
  fill: Fill,
  more: { radius?: number | [number, number, number, number]; strokes?: Stroke[]; [key: string]: unknown } = {},
): Part {
  const { radius = 0, ...props } = more
  const shape = typeof radius === 'number' ? { kind: 'rect', cornerRadius: radius } : { kind: 'rect', corners: radius }
  return graphic(name, box, shape, fill, props)
}

/** An ellipse filling the box. */
export function ellipse(name: string, box: Rect, fill: Fill, more: Record<string, unknown> = {}): Part {
  return graphic(name, box, { kind: 'ellipse' }, fill, more)
}

/** A star of `points` points filling the box, its inner corners `inner` of the way out, its corners rounded by `radius`. */
export function star(
  name: string,
  box: Rect,
  { points, inner, radius = 0 }: { points: number; inner: number; radius?: number },
  fill: Fill,
  more: Record<string, unknown> = {},
): Part {
  return graphic(name, box, { kind: 'star', points, innerRadius: inner, cornerRadius: radius }, fill, more)
}

/**
 * A shape drawn by SVG path data written in a box of `drawnIn`'s size, the box's own when left out, scaled to fill
 * the box.
 */
export function path(
  name: string,
  box: Rect,
  d: string,
  fill: Fill,
  drawnIn: { width: number; height: number } = { width: box.width, height: box.height },
): Part {
  return graphic(name, box, { kind: 'path', d, drawnIn }, fill, {})
}

/** A line of `width` across the box's middle, in a colour. */
export function line(name: string, box: Rect, colour: Swatch, width: number): Part {
  return graphic(name, box, { kind: 'line' }, { fills: [] }, { strokes: [stroke(colour.value, width)] })
}

/** A stroke of a colour along a shape's edge, inside it. */
export function stroke(color: string, width: number): Stroke {
  return {
    paint: { type: 'solid', color },
    width,
    align: 'inside',
    dashes: [],
    dashOffset: 0,
    cap: 'butt',
    join: 'miter',
    miterLimit: 4,
  }
}

/**
 * A picture covering the box (`fill`), whole inside it (`fit`), or the part of it `crop` names stretched over the box,
 * cut to the box's shape by its corners; the kit's logo is bound to the Logo brand role.
 */
export function picture(
  name: string,
  box: Rect,
  { assetId }: Picture,
  {
    fit = 'fill',
    logo = false,
    radius = 0,
    crop,
  }: { fit?: 'fill' | 'fit'; logo?: boolean; radius?: number; crop?: ImageCrop } = {},
): Part {
  const paint = crop
    ? { type: 'image' as const, assetId, fit: 'crop' as const, crop: roundedCrop(crop), opacity: 1 }
    : { type: 'image' as const, assetId, fit, opacity: 1 }
  const fill: Fill = {
    fills: [paint],
    ...(logo ? { bindings: { image: 'brand:logo' } } : {}),
  }
  return { ...rect(name, box, fill, { radius }), role: logo ? 'logo' : 'product' }
}

/** The box of a picture of `size` fitted inside `room`, its shape kept, placed by `align` across and down. */
export function fitted(
  size: Pick<Picture, 'width' | 'height'>,
  room: Rect,
  align: { x: 'start' | 'center' | 'end'; y: 'start' | 'center' | 'end' } = { x: 'center', y: 'center' },
): Rect {
  const scale = Math.min(room.width / size.width, room.height / size.height)
  const width = size.width * scale
  const height = size.height * scale
  const at = (start: number, free: number, where: 'start' | 'center' | 'end') =>
    start + { start: 0, center: free / 2, end: free }[where]
  return {
    x: round(at(room.x, room.width - width, align.x)),
    y: round(at(room.y, room.height - height, align.y)),
    width: round(width),
    height: round(height),
  }
}

/** A number to a hundredth of a pixel, as boxes are stored. */
export function round(value: number): number {
  return Math.round(value * 100) / 100
}

/** A graphic of a shape in the box. */
function graphic(name: string, box: Rect, shape: object, { fills, bindings }: Fill, more: object): Part {
  const props = { ...rounded(box), shape, fills, ...more }
  return { type: 'graphic', name, role: 'decoration', props, ...(bindings ? { bindings } : {}) }
}

/** A crop with its place and size rounded. */
function roundedCrop(crop: ImageCrop): ImageCrop {
  return { x: round(crop.x), y: round(crop.y), width: round(crop.width), height: round(crop.height) }
}

/** A box with its place and size rounded. */
function rounded({ x, y, width, height }: Rect): Rect {
  return { x: round(x), y: round(y), width: round(width), height: round(height) }
}
