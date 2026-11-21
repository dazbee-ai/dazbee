// What an SVG file may hold before it is refused, so a small hostile file can't run away with the
// page or the API: how much there is to read, how many layers it makes and how deep they nest, how
// many blurs and shadows they have and how deep those nest, each multiplying the offscreen
// pixels a drawing needs, and how many points their outlines have. Every limit sits far above what
// design tools and icon sets write.

import type { LayerInput } from './types.ts'

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
/** The points one outline may have, control points counted, and all the file's outlines together. */
export const MAX_PATH_POINTS = 250_000
export const MAX_POINTS = 500_000

/** A whole number as a sentence writes it: 5,000. */
export const counted = (n: number) => n.toLocaleString('en-US')

/**
 * Why the layers can't be drawn within the limits on how deep they nest and on their blurs and
 * shadows, as the end of a sentence ("it has more than 100 blurs and shadows"); null when they can.
 */
export function layersPast(nodes: Readonly<Record<string, LayerInput>>): string | null {
  let effects = 0
  /** Each layer's depth and how many layers with effects hold it, itself counted, found once. */
  const depths = new Map<string, { layers: number; effects: number }>()
  const depthOf = (id: string): { layers: number; effects: number } => {
    const known = depths.get(id)
    if (known) return known
    const node = nodes[id]
    const own = node?.props.effects?.length ? 1 : 0
    const parent = node && node.parentId in nodes ? depthOf(node.parentId) : { layers: 0, effects: 0 }
    const depth = { layers: parent.layers + 1, effects: parent.effects + own }
    depths.set(id, depth)
    return depth
  }
  for (const [id, node] of Object.entries(nodes)) {
    const count = node.props.effects?.length ?? 0
    if (count > MAX_LAYER_EFFECTS) return `one of its layers has more than ${MAX_LAYER_EFFECTS} blurs and shadows`
    effects += count
    if (effects > MAX_EFFECTS) return `it has more than ${MAX_EFFECTS} blurs and shadows`
    const depth = depthOf(id)
    if (depth.effects > MAX_EFFECT_DEPTH) return `its blurs and shadows nest more than ${MAX_EFFECT_DEPTH} deep`
    if (depth.layers > MAX_DEPTH) return `its layers nest more than ${MAX_DEPTH} deep`
  }
  return null
}

/**
 * Why an outline of `count` points, read after outlines of `before` points in all, passes the
 * limits on points, as the end of a sentence; null when it doesn't.
 */
export function pointsPast(count: number, before: number): string | null {
  if (count > MAX_PATH_POINTS) return `one of its paths has more than ${counted(MAX_PATH_POINTS)} points`
  if (before + count > MAX_POINTS) return `its paths have more than ${counted(MAX_POINTS)} points in all`
  return null
}
