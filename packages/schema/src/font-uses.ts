// Which faces a design's text is drawn in: each family in each weight and style its texts and their
// runs set, with the script fonts their characters need, so only those faces' files are loaded.
import { type FontUse, scriptFamilies } from '@dazbee/fonts'

import type { Design } from './design.ts'
import type { Layer } from './layers.ts'
import { withRunStyle } from './typography.ts'
import { bindProps, type Variables } from './variables.ts'

/** Each text's font uses, kept by its layer object and the variables they were read with, as an unchanged layer is the same object. */
const textFontUsesKept = new WeakMap<object, { variables: Variables | undefined; uses: readonly FontUse[] }>()

/**
 * Every family in every weight and style the design's text is drawn in (`textFontUses`), each
 * once, sorted by family, style and weight: the faces the editor, exports and Node renders load
 * (`facesToLoad` picks their files). The shipped fallbacks are not among them.
 */
export function fontUses(design: Design, variables?: Variables): FontUse[] {
  const uses = new Map<string, FontUse>()
  for (const node of Object.values(design.nodes))
    if (node.type === 'text') for (const use of textFontUses(node, variables)) uses.set(useKey(use), use)
  return [...uses.values()].sort(byUse)
}

/**
 * The families a text is drawn in, each in every weight and style it is drawn in there, sorted by
 * family, style and weight: its style's, and each stretch's between its runs' ends, the runs over it
 * merged as the renderer merges them (`withRunStyle`), with a brand-bound family or look as the kit
 * gives it. The script fonts its characters need (`scriptFamilies`) come in each of those weights
 * and styles, as a character the text's own font lacks is drawn in its weight and style.
 */
export function textFontUses(layer: Extract<Layer, { type: 'text' }>, variables?: Variables): readonly FontUse[] {
  const kept = textFontUsesKept.get(layer)
  if (kept && kept.variables === variables) return kept.uses
  const { style, runs, text } = bindProps(layer.type, layer.props, layer.bindings, variables)
  const styles = [style]
  const edges = [...new Set([0, text.length, ...runs.flatMap((run) => [run.start, run.end])])].sort((a, b) => a - b)
  for (let i = 0; i + 1 < edges.length; i++) {
    const start = edges[i] ?? 0
    const end = edges[i + 1] ?? 0
    let piece = style
    for (const run of runs) if (run.start <= start && run.end >= end) piece = withRunStyle(piece, run.style)
    styles.push(piece)
  }
  const scripts = scriptFamilies(text)
  const uses = new Map<string, FontUse>()
  for (const { fontFamily, fontWeight, fontStyle } of styles)
    for (const family of [fontFamily, ...scripts])
      if (typeof family === 'string' && family !== '') {
        const use = { family, weight: fontWeight, style: fontStyle }
        uses.set(useKey(use), use)
      }
  const sorted = [...uses.values()].sort(byUse)
  textFontUsesKept.set(layer, { variables, uses: sorted })
  return sorted
}

/** One font use's family, weight and style as one string. */
function useKey(use: FontUse): string {
  return `${use.family}
${use.weight}
${use.style}`
}

/** Font uses by family, then style (upright first), then weight. */
function byUse(a: FontUse, b: FontUse): number {
  if (a.family !== b.family) return a.family < b.family ? -1 : 1
  if (a.style !== b.style) return a.style === 'normal' ? -1 : 1
  return a.weight - b.weight
}
