// The batch that places a bundled illustration on a frame: the API adds the SVG file Dazbee keeps in its storage to the
// brand's asset library, once for the same bytes, reading it with the SVG reader's thread and limits as any SVG upload
// is; this server reads the asset's file back and places it as the layers the SVG reader makes of it, in its own
// colours, or with the set's accent swapped for a hex colour, or for a brand kit colour its fills are bound to.
import { type FoundGraphic, ILLUSTRATION_SETS, illustrationOf, paintsWith, swapAccent } from '@dazbee/graphics'
import { MAX_SVG_BYTES, type Rect } from '@dazbee/schema'

import type { OpenDesign } from '../open-design.ts'
import { boundPlacing } from './bound-colour.ts'
import { type ToolContext, ToolRefusal } from './define-tool.ts'
import { bundledAsset, type ColourFill, type FrameTo, type Placing, svgSteps, svgTextOf } from './place-on-frame.ts'

/** An illustration as a search finds it. */
type FoundIllustration = Extract<FoundGraphic, { kind: 'illustration' }>

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
