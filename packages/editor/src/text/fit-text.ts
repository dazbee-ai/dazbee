// The editor's half of the recompute (D6): the box a text that grows with its words takes, measured
// as typing measures it, in the fonts the screen draws with. A text waits while a face it is drawn
// in (`textFontUses`: its own, its runs' and the script fonts its characters need, in each weight and
// style it sets) is still coming; once that load settles, with files or without, it is measured with
// what is here, the fallbacks for a font that never came, as typing would measure it then.
import { fittedText, type FitText } from '@dazbee/doc'
import { type Layer, textFontUses } from '@dazbee/schema'

import type { FrameScenes } from '../canvas/scenes.ts'
import type { EditorResources } from '../resources.ts'

interface FitTextDeps {
  scenes: Pick<FrameScenes, 'measure'>
  resources: Pick<EditorResources, 'bytes' | 'loadUses' | 'pending'>
}

/**
 * The doc's `FitText` on the editor's measure: `'wait'` while a face a text that grows with its
 * words is drawn in is loading. A fixed box, or another layer, has nothing to fit and waits for nothing.
 */
export function editorFitText({ scenes, resources }: FitTextDeps): FitText {
  return (layer: Layer) => {
    if (layer.type !== 'text' || layer.props.boxMode === 'fixed') return undefined
    const { variables } = resources.bytes()
    const uses = textFontUses(layer, variables)
    void resources.loadUses(uses)
    if (uses.some((use) => resources.pending(use.family))) return 'wait'
    return fittedText(layer, scenes.measure(), variables)
  }
}
