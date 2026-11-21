// What an SVG file may hold before it is refused, so a small hostile file can't run away with the
// page or the API: how much there is to read, how many layers it makes and how deep they nest, how
// many blurs and shadows they have, how deep those nest and how much they draw offscreen, and what
// its outlines, dashes, gradients, clip paths and texts amount to. Every limit sits far above what
// design tools and icon sets write.

import type { LayerInput } from './types.ts'

/** What reading counts as it goes, each against a limit for one item and for the whole file. */
export type Counted = 'points' | 'dashes' | 'dash lengths' | 'stops' | 'clip shapes' | 'characters'

/** More layers than this, or a file larger than MAX_SVG_BYTES, is refused, so a hostile file can't run away with the page. */
export const MAX_LAYERS = 5_000
/**
 * Elements read, counting each time a <use> reads one again, and how deep elements and uses may
 * nest: past these the file is refused, so a fan of uses that draw nothing can't run away either.
 */
export const MAX_WORK = 100_000
export const MAX_NESTING = 400
/** How deep layers may nest, the root counted: each translucent group draws offscreen first, at the size of all it holds. */
export const MAX_DEPTH = 64
/**
 * How many layers with blurs or shadows may hold one another, the outermost and innermost
 * counted: each draws offscreen at the size of all it holds blurred, so each one around another
 * widens the offscreen drawing of everything inside it by its blur.
 */
export const MAX_EFFECT_DEPTH = 4
/** The blurs and shadows one layer may have, and a whole file: each is drawn over again. */
export const MAX_LAYER_EFFECTS = 16
export const MAX_EFFECTS = 100
/**
 * How many times the drawing's area, its longer side squared, the layers with blurs and shadows
 * may draw offscreen in all: each such layer's box grown on every side by how far its own blurs
 * and shadows reach and those of the layers holding it, as the renderer draws them.
 */
export const MAX_EFFECT_AREA = 32
/** The points one outline may have, control points counted, and all the file's outlines together. */
export const MAX_PATH_POINTS = 250_000
export const MAX_POINTS = 500_000
/** How many dashes the dashed strokes draw in all, and how many lengths one stroke's dash pattern may list. */
export const MAX_DASHES = 100_000
export const MAX_DASH_LENGTHS = 64
/** The stops one gradient may have, and all the gradients the layers are painted with, each time counted. */
export const MAX_STOPS = 256
export const MAX_ALL_STOPS = 20_000
/** The shapes one clip path joins into its outline, and all clip paths together, each time one clips. */
export const MAX_CLIP_SHAPES = 64
export const MAX_ALL_CLIP_SHAPES = 1_000
/** The characters of all the file's texts. */
export const MAX_CHARACTERS = 100_000

/** A whole number as a sentence writes it: 5,000. */
export const counted = (n: number) => n.toLocaleString('en-US')

/**
 * Each counted thing's limit for one item and for the whole file, with the end of the sentence
 * that says it was passed.
 */
const COUNTS: Record<Counted, { one?: [number, string]; all: [number, string] }> = {
  points: {
    one: [MAX_PATH_POINTS, `one of its paths has more than ${counted(MAX_PATH_POINTS)} points`],
    all: [MAX_POINTS, `its paths have more than ${counted(MAX_POINTS)} points in all`],
  },
  dashes: { all: [MAX_DASHES, `its dashed strokes draw more than ${counted(MAX_DASHES)} dashes`] },
  'dash lengths': {
    one: [MAX_DASH_LENGTHS, `one of its dash patterns lists more than ${MAX_DASH_LENGTHS} lengths`],
    all: [
      MAX_DASH_LENGTHS * MAX_LAYERS,
      `its dash patterns list more than ${counted(MAX_DASH_LENGTHS * MAX_LAYERS)} lengths`,
    ],
  },
  stops: {
    one: [MAX_STOPS, `one of its gradients has more than ${MAX_STOPS} stops`],
    all: [MAX_ALL_STOPS, `its gradients have more than ${counted(MAX_ALL_STOPS)} stops in all`],
  },
  'clip shapes': {
    one: [MAX_CLIP_SHAPES, `one of its clip paths joins more than ${MAX_CLIP_SHAPES} shapes`],
    all: [MAX_ALL_CLIP_SHAPES, `its clip paths join more than ${counted(MAX_ALL_CLIP_SHAPES)} shapes in all`],
  },
  characters: { all: [MAX_CHARACTERS, `its texts have more than ${counted(MAX_CHARACTERS)} characters`] },
}

/**
 * A new count of what one file's reading counts, against the limits for each item and the file:
 * given what one item has, it gives why that passes them, as the end of a sentence, or null.
 */
export function tally(): (what: Counted, count: number) => string | null {
  const totals = new Map<Counted, number>()
  return (what, count) => {
    const { one, all } = COUNTS[what]
    if (one && count > one[0]) return one[1]
    const total = (totals.get(what) ?? 0) + count
    totals.set(what, total)
    return total > all[0] ? all[1] : null
  }
}

/**
 * Why the layers can't be drawn within the limits on how deep they nest and on their blurs and
 * shadows, as the end of a sentence ("it has more than 100 blurs and shadows"); null when they
 * can. `side` is the drawing's longer side, in the layers' units.
 */
export function layersPast(nodes: Readonly<Record<string, LayerInput>>, side: number): string | null {
  let effects = 0
  let area = 0
  /** Each layer's depth, how many layers with effects hold it and how far their effects reach in all, itself counted, found once. */
  const depths = new Map<string, { layers: number; effects: number; reach: number }>()
  const depthOf = (id: string): { layers: number; effects: number; reach: number } => {
    const known = depths.get(id)
    if (known) return known
    const node = nodes[id]
    const own = node?.props.effects ?? []
    const parent = node && node.parentId in nodes ? depthOf(node.parentId) : { layers: 0, effects: 0, reach: 0 }
    const depth = {
      layers: parent.layers + 1,
      effects: parent.effects + (own.length ? 1 : 0),
      reach: parent.reach + Math.max(0, ...own.map(reachOf)),
    }
    depths.set(id, depth)
    return depth
  }
  for (const [id, node] of Object.entries(nodes)) {
    const own = node.props.effects ?? []
    if (own.length > MAX_LAYER_EFFECTS) return `one of its layers has more than ${MAX_LAYER_EFFECTS} blurs and shadows`
    effects += own.length
    if (effects > MAX_EFFECTS) return `it has more than ${MAX_EFFECTS} blurs and shadows`
    const depth = depthOf(id)
    if (depth.effects > MAX_EFFECT_DEPTH) return `its blurs and shadows nest more than ${MAX_EFFECT_DEPTH} deep`
    if (depth.layers > MAX_DEPTH) return `its layers nest more than ${MAX_DEPTH} deep`
    if (own.length) {
      const { width = 0, height = 0 } = node.props
      area += (width + 2 * depth.reach) * (height + 2 * depth.reach)
      if (area > MAX_EFFECT_AREA * side * side)
        return `its blurs and shadows draw more than ${MAX_EFFECT_AREA} times its own area`
    }
  }
  return null
}

/** How far past a layer's box one of its effects draws: a blur three deviations, half its radius each, as the renderer blurs. */
function reachOf(effect: NonNullable<LayerInput['props']['effects']>[number]): number {
  switch (effect.type) {
    case 'layerBlur':
    case 'backgroundBlur':
      return 1.5 * effect.radius
    case 'glow':
      return 1.5 * effect.blur + (effect.spread ?? 0)
    default:
      return (
        1.5 * effect.blur + Math.abs(effect.spread ?? 0) + Math.max(Math.abs(effect.x ?? 0), Math.abs(effect.y ?? 0))
      )
  }
}
