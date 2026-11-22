// Pattern Monster's patterns: each one's tile as an SVG file, written as the site's own download writes it in its
// default light colours, and a tile repeated across a box as one SVG file to place, its colours given or its own.
import type { CanvasKit, Path } from '@dazbee/canvaskit'
import { pathData } from '@dazbee/svg'

/** A pattern as the site's index (`src/routes/_index.js`) lists it. */
export interface PatternEntry {
  title: string
  slug: string
  /** How its paths are painted: filled, stroked, or stroked with square ends. */
  mode: 'fill' | 'stroke' | 'stroke-join'
  width: number
  height: number
  tags: string[]
  /** Its paths, `<path d='…'/>` each, parted by `~`; the nth is painted in the nth colour after the backdrop's. */
  path: string
}

/** The colours a pattern repeats in: its backdrop's, and its paths' (the first for every path, or one each). */
export interface PatternColours {
  /** The backdrop's colour as #RRGGBB, or null for none, so what is under the pattern shows. */
  backdrop?: string | null
  /** The paths' colour as #RRGGBB. */
  paths?: string
}

/** A box's left, top, right and bottom. */
type Bounds = [left: number, top: number, right: number, bottom: number]

/** A tile read back: its size, its backdrop's colour and each path's data, colour and stroke. */
interface Tile {
  width: number
  height: number
  backdrop: string
  paths: { d: string; colour: string; stroke?: { width: number; square: boolean } }[]
}

/** The colours the site paints a pattern in by default, in its light theme: the backdrop's first. */
export const PATTERN_COLOURS = [
  'hsla(0,0%,100%,1)',
  'hsla(258.5,59.4%,59.4%,1)',
  'hsla(339.6,82.2%,51.6%,1)',
  'hsla(198.7,97.6%,48.4%,1)',
  'hsla(47,80.9%,61%,1)',
] as const
/** What a tile's colour may be written as: a colour word, #hex, or a function of numbers such as hsla(…). */
const COLOUR = /^(#[0-9a-fA-F]{3,8}|[a-zA-Z]+|(rgba?|hsla?)\([\d.,%\s]+\))$/
/** How big a tile is drawn on a 1080 px side, times its own size: the site's default scale. */
const SCALE_AT_1080 = 2
/** The most points the outlines of all a box's repeats may have, so the layers stay light to draw and store. */
const MAX_POINTS = 30_000
/** How much larger each try draws the tile when its repeats pass MAX_POINTS, and how many tries there are. */
const SCALE_STEP = 1.25
const MAX_SCALE_STEPS = 80
/** What a colour given is written as. */
const HEX = /^#[0-9a-fA-F]{6}$/

/** The patterns the site's index file lists. */
export function patternsOf(index: string): PatternEntry[] {
  const list = JSON.parse(index.slice(index.indexOf('['), index.lastIndexOf(']') + 1)) as PatternEntry[]
  if (!Array.isArray(list)) throw new Error('the pattern index lists no patterns')
  return list
}

/**
 * The pattern's tile as an SVG file, as the site's download writes it at its defaults (all its colours, a stroke of
 * 1, no spacing), at its own size: the backdrop, then each path in its colour.
 */
export function patternTile({ mode, width, height, path }: PatternEntry): string {
  const join = mode === 'stroke-join' ? "stroke-linecap='square' " : ''
  const paths = path.split('~').map((each, i) => {
    const colour = PATTERN_COLOURS[i + 1] ?? PATTERN_COLOURS[1]
    const paint = mode === 'fill' ? ` stroke='none' fill='${colour}'` : ` stroke='${colour}' fill='none'`
    return each.replace('/>', `  ${join}stroke-width='1'${paint}/>`)
  })
  return (
    `<svg xmlns='http://www.w3.org/2000/svg' width='${width}' height='${height}'>` +
    `<rect x='0' y='0' width='100%' height='100%' fill='${PATTERN_COLOURS[0]}'/>${paths.join('')}</svg>`
  )
}

/**
 * The tile repeated across a box `width` × `height` as an SVG file of that size: the backdrop, then one filled shape
 * per path of the tile, cut to the tile's cell as a pattern is, its every repeat joined and cut to the box, strokes
 * outlined, each in its colour or the one
 * given. A tile is drawn at the site's default scale for the box's shorter side, larger when that would make too
 * many repeats. Throws when the file isn't a tile `patternTile` wrote.
 */
export function tiledPattern(
  ck: CanvasKit,
  tileSvg: string,
  { width, height }: { width: number; height: number },
  colours: PatternColours = {},
): string {
  const tile = readTile(tileSvg)
  const shapes = tile.paths.map(({ d, stroke }) => inCell(ck, outline(ck, d, stroke), tile))
  try {
    for (const colour of [colours.paths, colours.backdrop])
      if (colour && !HEX.test(colour)) throw new Error(`a colour is #rrggbb, not ${colour}`)
    const points = shapes.reduce((sum, shape) => sum + (shape?.countPoints() ?? 0), 0)
    const scale = scaleOf(tile, { width, height }, boundsOf(shapes), points)
    const body = shapes.flatMap((shape, i) => {
      if (!shape) return []
      const repeated = repeat(ck, shape, tile, scale, { width, height })
      const d = pathData(repeated)
      repeated.delete()
      const colour = colours.paths ?? tile.paths[i]?.colour ?? 'black'
      return d ? [`<path d="${d}" fill="${colour}"/>`] : []
    })
    const backdrop = colours.backdrop === undefined ? tile.backdrop : colours.backdrop
    const under = backdrop === null ? '' : `<rect width="${width}" height="${height}" fill="${backdrop}"/>`
    return (
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
      `${under}${body.join('')}</svg>`
    )
  } finally {
    for (const shape of shapes) shape?.delete()
  }
}

/** The tile `patternTile` wrote, read back; throws when it isn't one, or paints with what isn't a colour. */
function readTile(svg: string): Tile {
  const root = /^<svg xmlns='http:\/\/www\.w3\.org\/2000\/svg' width='([\d.]+)' height='([\d.]+)'>/.exec(svg)
  const backdrop = /<rect x='0' y='0' width='100%' height='100%' fill='([^']+)'\/>/.exec(svg)?.[1]
  if (!root || !backdrop) throw new Error('the file is not a pattern’s tile')
  const paths = [...svg.matchAll(/<path ([^>]*)\/>/g)].map(([, attributes = '']) => {
    const value = (name: string) => new RegExp(`(?:^|\\s)${name}='([^']*)'`).exec(attributes)?.[1]
    const d = value('d')
    const stroke = value('stroke')
    const fill = value('fill')
    if (!d) throw new Error('a path of the tile has no data')
    if (stroke && stroke !== 'none')
      return {
        d,
        colour: colourOf(stroke),
        stroke: { width: Number(value('stroke-width') ?? 1), square: value('stroke-linecap') === 'square' },
      }
    return { d, colour: colourOf(fill ?? 'black') }
  })
  return { width: Number(root[1]), height: Number(root[2]), backdrop: colourOf(backdrop), paths }
}

/** The colour as the tile writes it; throws when it isn't one. */
function colourOf(colour: string): string {
  if (!COLOUR.test(colour)) throw new Error(`the tile paints with ${colour}, which isn’t a colour`)
  return colour
}

/** A tile's path as the area it covers, its stroke outlined; null when it draws nothing. */
function outline(ck: CanvasKit, d: string, stroke: Tile['paths'][number]['stroke']): Path | null {
  const path = ck.Path.MakeFromSVGString(d)
  if (!path || !stroke) return path
  const cap = stroke.square ? ck.StrokeCap.Square : ck.StrokeCap.Butt
  const outlined = path.makeStroked({ width: stroke.width, cap, join: ck.StrokeJoin.Miter })
  path.delete()
  return outlined
}

/**
 * The shape cut to its tile's cell, as a pattern shows what a tile draws only inside the cell; the shape is freed.
 */
function inCell(ck: CanvasKit, shape: Path | null, { width, height }: Tile): Path | null {
  const cell = ck.Path.MakeFromSVGString(`M0 0H${width}V${height}H0Z`)
  const cut = shape && cell && ck.Path.MakeFromOp(shape, cell, ck.PathOp.Intersect)
  shape?.delete()
  cell?.delete()
  return cut ?? null
}

/** The box round all the shapes; a point at the origin when there are none. */
function boundsOf(shapes: (Path | null)[]): Bounds {
  const all = shapes.flatMap((shape) => (shape ? [shape.getBounds()] : []))
  if (all.length === 0) return [0, 0, 0, 0]
  return [
    Math.min(...all.map(([left = 0]) => left)),
    Math.min(...all.map(([, top = 0]) => top)),
    Math.max(...all.map(([, , right = 0]) => right)),
    Math.max(...all.map(([, , , bottom = 0]) => bottom)),
  ]
}

/**
 * How much the tile is scaled: the site's default for the box's shorter side, or more, until its repeats (the shapes
 * reaching `bounds` from a tile's corner) times their `points` keep within MAX_POINTS, or the tile spans the box.
 */
function scaleOf(tile: Tile, box: { width: number; height: number }, bounds: Bounds, points: number): number {
  let scale = (SCALE_AT_1080 * Math.min(box.width, box.height)) / 1080
  for (let step = 0; step < MAX_SCALE_STEPS; step++, scale *= SCALE_STEP)
    if (repeatsOf(tile, box, bounds, scale) * Math.max(points, 1) <= MAX_POINTS) return scale
  return scale
}

/** How many copies `repeat` places over the box at `scale`: as many rows as columns it loops through. */
function repeatsOf(
  tile: Tile,
  box: { width: number; height: number },
  [left, top, right, bottom]: Bounds,
  scale: number,
) {
  const span = (side: number, step: number, from: number, to: number) =>
    Math.max(0, Math.ceil((side - from * scale) / step) - Math.floor((-to * scale) / step))
  return span(box.width, tile.width * scale, left, right) * span(box.height, tile.height * scale, top, bottom)
}

/**
 * The shape repeated, scaled, over the whole box: each copy that lies inside it as it is, and each that crosses its
 * edge cut to it, so the repeats fill the box exactly.
 */
function repeat(ck: CanvasKit, shape: Path, tile: Tile, scale: number, box: { width: number; height: number }): Path {
  const [left = 0, top = 0, right = 0, bottom = 0] = shape.getBounds()
  const step = { x: tile.width * scale, y: tile.height * scale }
  const area = ck.Path.MakeFromSVGString(`M0 0H${box.width}V${box.height}H0Z`)
  if (!area) throw new Error('the box can’t be drawn')
  const builder = new ck.PathBuilder()
  for (let row = Math.floor((-bottom * scale) / step.y); row * step.y + top * scale < box.height; row++)
    for (let column = Math.floor((-right * scale) / step.x); column * step.x + left * scale < box.width; column++) {
      const [x, y] = [column * step.x, row * step.y]
      const inside =
        x + left * scale >= 0 &&
        y + top * scale >= 0 &&
        x + right * scale <= box.width &&
        y + bottom * scale <= box.height
      if (inside) {
        builder.addPath(shape, scale, 0, x, 0, scale, y)
        continue
      }
      const placed = new ck.PathBuilder().addPath(shape, scale, 0, x, 0, scale, y)?.detachAndDelete()
      const cut = placed && ck.Path.MakeFromOp(placed, area, ck.PathOp.Intersect)
      placed?.delete()
      if (cut) builder.addPath(cut)
      cut?.delete()
    }
  area.delete()
  return builder.detachAndDelete()
}
