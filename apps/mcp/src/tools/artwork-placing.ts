// The batch that places a graphic of an artwork set on a frame: the API adds the file Dazbee keeps in its storage to the
// brand's asset library, once for the same bytes, recording it with an upload's checks (for an SVG file the SVG
// reader's thread and limits); a picture (3D objects, effects) is placed as an image, an effect drawn light in the
// screen blend so its dark drops out; an SVG file is read back and placed as the layers the SVG reader makes of it, in
// its own colours or, for a few-colour set, in a colour given, and a pattern repeated across the box.
import { placedImage } from '@dazbee/editor/placed-asset'
import { ARTWORK_SETS, artworkOf, type FoundGraphic, paintsWithAny, recolour, tiledPattern } from '@dazbee/graphics'
import { loadCanvasKit } from '@dazbee/renderer/node'
import { type AssetSummary, MAX_SVG_BYTES, type Rect } from '@dazbee/schema'

import type { OpenDesign } from '../open-design.ts'
import { boundPlacing } from './bound-colour.ts'
import { type ToolContext, ToolRefusal } from './define-tool.ts'
import {
  bundledAsset,
  type ColourFill,
  fitted,
  type FrameTo,
  type Placing,
  svgSteps,
  svgTextOf,
} from './place-on-frame.ts'

/** An artwork graphic as a search finds it. */
export type FoundArtwork = Exclude<FoundGraphic, { kind: 'icon' | 'sticker' | 'illustration' }>

/** The colours an artwork graphic is placed in: its paint colour, and a background's backdrop (null for none). */
export interface ArtworkColours {
  colour?: ColourFill
  backdrop?: ColourFill | null
}

/**
 * The batch that places the graphic in `style` fitted inside `where`, its shape kept, centred, named `name`: its file
 * first added to the brand's asset library named by `name` and its set ("Gift · Streamline Plump") and tagged with its
 * kind and its set's name. A picture becomes an image, in the screen blend when the manifest says so; an SVG file
 * becomes layers, its set's paint colours swapped for `colour` when it has them, a brand kit colour bound; a pattern is
 * repeated over the whole box, its paths in `colour` and its backdrop in `backdrop` when given. Its answer tells the
 * asset, and `colourUnused` that a colour was given to what can't take it.
 */
export async function artworkPlacing(
  context: ToolContext,
  open: OpenDesign,
  into: FrameTo,
  { artwork, style, name }: { artwork: FoundArtwork; style: string; name: string },
  where: Rect,
  colours: ArtworkColours,
): Promise<Placing & { colourUnused: boolean }> {
  const set = ARTWORK_SETS[artwork.set]
  const file = artworkOf(artwork.set, artwork.name)?.files[style]
  if (!file) throw new ToolRefusal(`Dazbee has no ${style} file of “${artwork.id}”`)
  const input = { sha256: file.sha256, name: `${name} · ${set.title}`, tags: [artwork.kind, set.title.toLowerCase()] }
  const notStored = `The ${artwork.kind} “${artwork.id}” isn’t in Dazbee’s storage yet, so nothing was placed`
  const asset = await bundledAsset(context, open, input, notStored)
  const told = { asset: { id: asset.id, name: asset.name } }
  if (set.format === 'png') {
    if (asset.sha256 !== file.sha256 || asset.contentType !== 'image/png')
      throw new Error(`the asset of ${artwork.id} is not its picture`)
    const coloured = colours.colour !== undefined || colours.backdrop !== undefined
    const placing = pictureSteps(into, asset, where, file.blend)
    return { ...placing, told: { ...told, ...placing.told }, colourUnused: coloured }
  }
  if (asset.sha256 !== file.sha256 || asset.contentType !== 'image/svg+xml' || asset.byteSize > MAX_SVG_BYTES)
    throw new Error(`the asset of ${artwork.id} is not its SVG file`)
  const text = svgTextOf(await (await context.api.asset(open.brandId, asset.id)).bytes())
  if (set.kind === 'background') {
    const placing = await patternPlacing(into, name, text, where, colours)
    return { ...placing, told: { ...placing.told, ...told, ...toldColours(colours) }, colourUnused: false }
  }
  const { colour } = colours
  const swapping = colour !== undefined && set.paints !== undefined && paintsWithAny(text, set.paints)
  const placing = !swapping
    ? await svgSteps(into, name, text, where)
    : await swappedPlacing(into, name, text, set.paints ?? [], colour, where)
  const unused = (colour !== undefined && !swapping) || colours.backdrop !== undefined
  return {
    ...placing,
    told: { ...placing.told, ...told, ...(swapping ? toldColours({ colour }) : {}) },
    colourUnused: unused,
  }
}

/** The picture's image fitted inside `where`, in the screen blend when `blend` says so. */
function pictureSteps(into: FrameTo, asset: AssetSummary, where: Rect, blend: 'screen' | undefined): Placing {
  const layer = placedImage(asset, into.frame, fitted(where, asset))
  const placed = blend ? { ...layer, props: { ...layer.props, blendMode: blend } } : layer
  return {
    steps: [{ command: 'node.create', input: { parentId: into.id, layer: placed } }],
    layerOf: String,
    told: blend ? { blend } : {},
  }
}

/** The file with its set's paint colours swapped for the colour: written in it, or bound to the brand kit colour. */
async function swappedPlacing(
  into: FrameTo,
  name: string,
  text: string,
  paints: readonly string[],
  colour: ColourFill,
  where: Rect,
): Promise<Placing> {
  const hex = colour.value.slice(0, 7).toLowerCase()
  if (!colour.ref) return svgSteps(into, name, recolour(text, paints, hex), where)
  const write = ([marker = '']: string[]) => recolour(text, paints, hex, marker)
  return boundPlacing(into, name, text, write, [{ value: colour.value, ref: colour.ref }], where)
}

/**
 * The pattern's tile repeated across the whole box, its paths in `colour` and its backdrop in `backdrop` (none when
 * null) when given, else in its own; a brand kit colour bound.
 */
async function patternPlacing(
  into: FrameTo,
  name: string,
  tile: string,
  where: Rect,
  { colour, backdrop }: ArtworkColours,
): Promise<Placing> {
  const ck = await loadCanvasKit()
  const size = { width: where.width, height: where.height }
  const bound = [colour, backdrop].filter((fill): fill is Required<ColourFill> => !!fill?.ref)
  const write = (markers: string[]) => {
    const left = [...markers]
    const pick = (fill: ColourFill | null | undefined) =>
      fill === null || fill === undefined ? fill : fill.ref ? left.shift() : fill.value.slice(0, 7)
    const paths = pick(colour)
    const under = pick(backdrop)
    return tiledPattern(ck, tile, size, {
      ...(paths ? { paths } : {}),
      ...(under === undefined ? {} : { backdrop: under }),
    })
  }
  if (bound.length === 0) return svgSteps(into, name, write([]), where)
  return boundPlacing(into, name, tile, write, bound, where)
}

/** What the answer tells of the colours placed: each colour, or the brand kit colour it is bound to. */
function toldColours({ colour, backdrop }: ArtworkColours): Record<string, unknown> {
  const of = (fill: ColourFill | null) => (fill === null ? 'none' : (fill.ref ?? fill.value))
  return {
    ...(colour ? { colour: of(colour) } : {}),
    ...(backdrop === undefined ? {} : { backdrop: of(backdrop) }),
  }
}
