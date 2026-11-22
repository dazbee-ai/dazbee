// The batch that places an SVG file with a colour swapped for a brand kit colour: the colour is first written as one
// the file doesn't use, so the layers it fills are found among the layers read, then written as the kit's colour, and
// those layers' fills are bound to the kit's token.
import { type AgentStep, placedRoots } from '@dazbee/doc'
import { svgPlaceInput } from '@dazbee/editor/placed-asset'
import { paintsWith } from '@dazbee/graphics'
import type { Layer, LayerTree, Rect } from '@dazbee/schema'

import { ToolRefusal } from './define-tool.ts'
import { centreOf, type ColourFill, type FrameTo, type Placing, svgRead } from './place-on-frame.ts'

/** The colours swapped are first written as, to find the layers they paint: the first from this the file doesn't use. */
const MARKER = 0x010203

/**
 * The batch that places the file with colours swapped for brand kit colours: `write` writes the file with each colour
 * swapped as the colour it is given in its place, colours the file doesn't use, so the layers whose one fill is each
 * are found among the layers read; then each is written as its kit colour everywhere it paints, a fill's own
 * see-through kept as its opacity, and those layers' fills are bound to its kit token.
 */
export async function boundPlacing(
  { id: frameId, frame }: FrameTo,
  name: string,
  text: string,
  write: (markers: string[]) => string,
  colours: Required<ColourFill>[],
  where: Rect,
): Promise<Placing> {
  const markers = unusedColours(text, colours.length)
  const read = await svgRead(frame, name, write(markers), where)
  let tree = read.tree
  const binds: AgentStep[] = []
  for (const [i, colour] of colours.entries()) {
    const marker = markers[i] ?? ''
    const nodes = Object.fromEntries(
      Object.entries(tree.nodes).map(([key, node]) => [key, withOpaqueFill(node, marker)]),
    )
    const ids = Object.entries(nodes).flatMap(([key, node]) =>
      filledWith(node, marker) ? [{ $ref: 'placed', field: `ids/${key}` }] : [],
    )
    tree = recoloured({ ...tree, nodes }, marker, colour.value)
    if (ids.length > 0)
      binds.push({ command: 'node.bind', input: { ids, property: 'fill', ref: colour.ref, value: colour.value } })
  }
  const input = svgPlaceInput({ tree, root: read.root }, frameId, centreOf(where))
  if (!input) throw new ToolRefusal(`The SVG file “${name}” draws nothing, so nothing was placed`)
  return {
    steps: [{ command: 'design.place', as: 'placed', input: { ...input, withIds: true } }, ...binds],
    layerOf: (result) => placedRoots(result as Parameters<typeof placedRoots>[0])[0] ?? '',
    told: read.leftOut.length > 0 ? { leftOut: read.leftOut } : {},
  }
}

/** The first `count` colours from MARKER up that the file's text doesn't paint with, as #rrggbb. */
function unusedColours(text: string, count: number): string[] {
  const found: string[] = []
  for (let colour = MARKER; found.length < count; colour++) {
    const hex = `#${colour.toString(16).padStart(6, '0')}`
    if (!paintsWith(text, hex)) found.push(hex)
  }
  return found
}

/**
 * The layer with its one fill, when that is the colour (#rrggbb) at less than full alpha, made opaque and its alpha
 * moved into the fill's opacity, so it draws the same and a binding, which writes an opaque colour, keeps it.
 */
function withOpaqueFill(node: Layer, colour: string): Layer {
  if (node.type !== 'graphic' || node.props.fills.length !== 1) return node
  const [fill] = node.props.fills
  if (fill?.type !== 'solid' || !fill.color.toLowerCase().startsWith(colour)) return node
  const alpha = parseInt(fill.color.slice(7, 9), 16) / 255
  if (alpha === 1) return node
  const opaque = { ...fill, color: `${fill.color.slice(0, 7)}FF`, opacity: (fill.opacity ?? 1) * alpha }
  return { ...node, props: { ...node.props, fills: [opaque] } }
}

/** Whether a layer's one fill is the colour (#rrggbb), solid and opaque, whatever its opacity. */
function filledWith(node: Layer, colour: string): boolean {
  if (node.type !== 'graphic' || node.props.fills.length !== 1) return false
  const [fill] = node.props.fills
  return fill?.type === 'solid' && fill.color.toLowerCase() === `${colour}ff`
}

/** The layers with the colour (#rrggbb) written as `value` (#RRGGBBAA) wherever they paint with it, each paint's alpha kept. */
function recoloured(tree: LayerTree, colour: string, value: string): LayerTree {
  const rgb = value.slice(0, 7).toUpperCase()
  return JSON.parse(JSON.stringify(tree).replaceAll(new RegExp(colour, 'gi'), rgb)) as LayerTree
}
