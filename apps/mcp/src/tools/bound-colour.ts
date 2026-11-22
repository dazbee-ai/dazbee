import { placedRoots } from '@dazbee/doc'
import { svgPlaceInput } from '@dazbee/editor/placed-asset'
import { paintsWith, swapAccent } from '@dazbee/graphics'
import type { Layer, LayerTree, Rect } from '@dazbee/schema'

import { ToolRefusal } from './define-tool.ts'
import { centreOf, type ColourFill, type FrameTo, type Placing, svgRead } from './place-on-frame.ts'

/** The colour the accent is first written as, to find the layers it paints: the first of these the file doesn't use. */
const MARKER = 0x010203

/**
 * The batch that places the file with its accent swapped for the brand kit colour: the accent is first written as a
 * colour the file doesn't use, so the layers whose one fill is the accent are found among the layers read; then it is
 * written as the kit's colour everywhere it paints, an accent fill's own see-through kept as its opacity, and those
 * layers' fills are bound to the kit's token.
 */
export async function boundPlacing(
  { id: frameId, frame }: FrameTo,
  name: string,
  text: string,
  from: string,
  accent: Required<ColourFill>,
  where: Rect,
): Promise<Placing> {
  const marker = unusedColour(text)
  const read = await svgRead(frame, name, swapAccent(text, from, marker), where)
  const nodes = Object.fromEntries(
    Object.entries(read.tree.nodes).map(([key, node]) => [key, withOpaqueAccent(node, marker)]),
  )
  const filled = Object.entries(nodes).flatMap(([key, node]) => (filledWith(node, marker) ? [key] : []))
  const tree = recoloured({ ...read.tree, nodes }, marker, accent.value)
  const input = svgPlaceInput({ tree, root: read.root }, frameId, centreOf(where))
  if (!input) throw new ToolRefusal(`The SVG file “${name}” draws nothing, so nothing was placed`)
  const ids = filled.map((key) => ({ $ref: 'placed', field: `ids/${key}` }))
  return {
    steps: [
      { command: 'design.place', as: 'placed', input: { ...input, withIds: true } },
      ...(ids.length > 0
        ? [{ command: 'node.bind', input: { ids, property: 'fill', ref: accent.ref, value: accent.value } }]
        : []),
    ],
    layerOf: (result) => placedRoots(result as Parameters<typeof placedRoots>[0])[0] ?? '',
    told: read.leftOut.length > 0 ? { leftOut: read.leftOut } : {},
  }
}

/** The first colour from MARKER up that the file's text doesn't paint with, as #rrggbb. */
function unusedColour(text: string): string {
  for (let colour = MARKER; ; colour++) {
    const hex = `#${colour.toString(16).padStart(6, '0')}`
    if (!paintsWith(text, hex)) return hex
  }
}

/**
 * The layer with its one fill, when that is the colour (#rrggbb) at less than full alpha, made opaque and its alpha
 * moved into the fill's opacity, so it draws the same and a binding, which writes an opaque colour, keeps it.
 */
function withOpaqueAccent(node: Layer, colour: string): Layer {
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
