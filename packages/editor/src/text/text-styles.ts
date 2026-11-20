// Bold, italic, underline and strikethrough, by their keys and the Text tab's buttons alike: on the
// selected range of the text being edited, else on the text being edited or the selected text
// layers. Each turns its style on unless it is on throughout, by the rule in text-edit.ts; Bold
// picks from the weights the family each is drawn in has, and writes nothing where one has none.
import type { Session } from '@dazbee/doc'
import { bindProps, type Design, faceWeights } from '@dazbee/schema'

import type { EditorLayerEdits } from '../layer-edits.ts'
import type { EditorResources } from '../resources.ts'
import { type EditorSelection, idsOf } from '../selection.ts'
import {
  type RunStyle,
  STYLE_TOGGLES,
  styleOn,
  stylesIn,
  type StyleToggle,
  styleWrite,
  type TextRange,
} from './text-edit.ts'
import type { EditorTyping } from './typing.ts'

export interface TextStylesDeps {
  session: Session
  selection: Pick<EditorSelection, 'current'>
  resources: Pick<EditorResources, 'bytes' | 'facesOf'>
  typing: Pick<EditorTyping, 'editing' | 'selectedText' | 'styleRange'>
  layerEdits: Pick<EditorLayerEdits, 'setProps'>
}

/** Each style's state for what the styles act on now: on, off or mixed, and whether its toggle can write. */
export type TextStyleState = Record<StyleToggle, { on: boolean | 'mixed'; disabled: boolean }>

export interface EditorTextStyles {
  /** Each style's state for what the styles act on now; null with no text to act on. */
  state(): TextStyleState | null
  /**
   * Toggles a style as one undo step; Bold writes nothing while a family has no weight for it.
   * False with no text to act on.
   */
  perform(toggle: StyleToggle): boolean
}

type TextNode = Extract<Design['nodes'][string], { type: 'text' }>
type Style = TextNode['props']['style']

/** What the styles act on: a range of one text, or whole text layers, with the style of each character or layer and the family it is drawn in. */
type Targets = ({ range: { id: string; range: TextRange } } | { ids: string[] }) & {
  styles: { style: Style; family: string }[]
}

export function editorTextStyles({
  session,
  selection,
  resources,
  typing,
  layerEdits,
}: TextStylesDeps): EditorTextStyles {
  /** The selected range of the text being edited, else the text being edited or the selected text layers. */
  function targets(): Targets | null {
    const now = session.design()
    const selected = typing.selectedText()
    const edited = selected && now.nodes[selected.id]
    if (selected && edited?.type === 'text')
      return {
        range: selected,
        styles: stylesIn(edited.props, selected.range).map((style) => ({ style, family: drawnFamily(edited, style) })),
      }
    const editing = typing.editing()
    const texts = (editing ? [editing.id] : idsOf(selection.current())).flatMap((id) => {
      const node = now.nodes[id]
      return node?.type === 'text' ? [{ id, node }] : []
    })
    if (texts.length === 0) return null
    return {
      ids: texts.map(({ id }) => id),
      styles: texts.map(({ node }) => ({ style: node.props.style, family: drawnFamily(node, node.props.style) })),
    }
  }
  /** The family a character or layer in `style` is drawn in: the brand's where the text's font is bound to it and the style keeps the text's own. */
  function drawnFamily(node: TextNode, style: Style) {
    if (style.fontFamily !== node.props.style.fontFamily) return style.fontFamily
    return bindProps(node.type, node.props, node.bindings, resources.bytes().variables).style.fontFamily
  }
  /** The upright weights a family draws, or every weight where it has no upright face; a variable face draws its range's. */
  function weightsOf(family: string) {
    const faces = resources.facesOf(family)
    const upright = faces.filter((f) => f.style !== 'italic')
    return (upright.length > 0 ? upright : faces).flatMap(faceWeights)
  }
  /** Whether a toggle turns its style on over `at`, and what it writes for each style there; null for one it can't write. */
  function writes(at: Targets, toggle: StyleToggle) {
    const on = styleOn(
      at.styles.map(({ style }) => style),
      toggle,
    )
    return {
      on,
      writes: at.styles.map(({ family }) => styleWrite(toggle, on !== true, weightsOf(family))),
    }
  }

  function state(): TextStyleState | null {
    const at = targets()
    if (!at) return null
    return Object.fromEntries(
      STYLE_TOGGLES.map((toggle) => {
        const { on, writes: each } = writes(at, toggle)
        return [toggle, { on, disabled: each.some((w) => w === null) }]
      }),
    ) as TextStyleState
  }
  function perform(toggle: StyleToggle) {
    const at = targets()
    if (!at) return false
    const each = writes(at, toggle).writes
    if (!each.every((w): w is RunStyle => w !== null)) return true
    // A range takes one style throughout: its first character's.
    if ('range' in at) typing.styleRange(at.range, each[0] ?? {})
    else {
      const byId = new Map(at.ids.map((id, i) => [id, each[i]]))
      layerEdits.setProps(at.ids, (id, props) => ({ style: { ...(props.style as Style), ...byId.get(id) } }))
    }
    return true
  }

  return { state, perform }
}
