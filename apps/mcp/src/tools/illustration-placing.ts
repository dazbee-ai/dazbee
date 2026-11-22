// The batch that places a bundled illustration on a frame: the API adds the SVG file Dazbee keeps in its storage to the
// brand's asset library, once for the same bytes, reading it with the SVG reader's thread and limits as any SVG upload
// is; this server reads the asset's file back and places it as the layers the SVG reader makes of it, in its own
// colours, or with the set's accent swapped for a hex colour, or for a brand kit colour its fills are bound to.
import { placedRoots } from '@dazbee/doc'
import { svgPlaceInput } from '@dazbee/editor/placed-asset'
import { type FoundGraphic, ILLUSTRATION_SETS, illustrationOf, paintsWith, swapAccent } from '@dazbee/graphics'
import { type Layer, type LayerTree, MAX_SVG_BYTES, type Rect } from '@dazbee/schema'

import type { OpenDesign } from '../open-design.ts'
import { type ToolContext, ToolRefusal } from './define-tool.ts'
import {
  bundledAsset,
  centreOf,
  type ColourFill,
  type FrameTo,
  type Placing,
  svgRead,
  svgSteps,
  svgTextOf,
} from './place-on-frame.ts'

/** An illustration as a search finds it. */
type FoundIllustration = Extract<FoundGraphic, { kind: 'illustration' }>

/** The colour the accent is first written as, to find the layers it paints: the first of these the file doesn't use. */
const MARKER = 0x010203

/**
 * The batch that places the illustration fitted inside `where`, its shape kept, centred, as layers named `name`: its
 * file first added to the brand's asset library named by `name` and its set ("Delivery · unDraw") and tagged
 * `illustration` and the set's name. With `accent`, the set's accent is swapped for it wherever the file paints with
 * it; when it is a brand kit colour, the layers whose one fill is the accent are bound to it, so they follow the kit,
 * and its strokes and gradient stops are written in the kit's colour as it is now. Its answer tells the asset, and
 * `accentUnused` tells that an accent was given to a file that doesn't paint with its set's.
 */
export async function illustrationPlacing(
  context: ToolContext,
  open: OpenDesign,
  into: FrameTo,
  { illustration, name }: { illustration: FoundIllustration; name: string },
  where: Rect,
  accent: ColourFill | undefined,
): Promise<Placing & { accentUnused: boolean }> {
  const file = illustrationOf(illustration.set, illustration.name)
  if (!file) throw new ToolRefusal(`Dazbee has no illustration “${illustration.id}”`)
  const { title, accent: from } = ILLUSTRATION_SETS[illustration.set]
  const input = { sha256: file.sha256, name: `${name} · ${title}`, tags: ['illustration', title.toLowerCase()] }
  const notStored = `The illustration “${illustration.id}” isn’t in Dazbee’s storage yet, so nothing was placed`
  const asset = await bundledAsset(context, open, input, notStored)
  if (asset.sha256 !== file.sha256 || asset.contentType !== 'image/svg+xml' || asset.byteSize > MAX_SVG_BYTES)
    throw new Error(`the asset of ${illustration.id} is not its SVG file`)
  const text = svgTextOf(await (await context.api.asset(open.brandId, asset.id)).bytes())
  const swapping = accent !== undefined && paintsWith(text, from)
  const placing = !swapping
    ? await svgSteps(into, name, text, where)
    : accent.ref
      ? await boundPlacing(into, name, text, from, { value: accent.value, ref: accent.ref }, where)
      : await svgSteps(into, name, swapAccent(text, from, accent.value.slice(0, 7)), where)
  const told = {
    asset: { id: asset.id, name: asset.name },
    ...(swapping ? (accent.ref ? { bound: accent.ref } : { accent: accent.value }) : {}),
  }
  return { ...placing, told: { ...placing.told, ...told }, accentUnused: accent !== undefined && !swapping }
}

/**
 * The batch that places the file with its accent swapped for the brand kit colour: the accent is first written as a
 * colour the file doesn't use, so the layers whose one fill is the accent are found among the layers read; then it is
 * written as the kit's colour everywhere it paints, an accent fill's own see-through kept as its opacity, and those
 * layers' fills are bound to the kit's token.
 */
async function boundPlacing(
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
