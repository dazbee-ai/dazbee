// The brand kit in the editor: the values bound properties take, binding the selection to a
// brand colour, font, logo or text style or unbinding it, and text that follows a brand font or text
// style taking its new family and look.
import type { Session } from '@dazbee/doc'
import {
  BINDABLE_PROPERTIES,
  bindablePropertyOf,
  boundValueOf,
  fitsProperty,
  fontFamilies,
  VALUE_KINDS,
  type ValueKind,
  type VariableRef,
  type Variables,
  type VariableValue,
} from '@dazbee/schema'

import type { EditorView } from './canvas/view.ts'
import { type EditorResources, SHIPPED_FAMILIES } from './resources.ts'
import { runQuietly } from './run-quietly.ts'
import { type EditorSelection, idsOf } from './selection.ts'
import type { EditorTyping } from './text/typing.ts'

export interface BrandKitDeps {
  session: Session
  resources: Pick<EditorResources, 'bytes' | 'loadFamilies' | 'setVariables'>
  view: Pick<EditorView, 'redraw'>
  selection: Pick<EditorSelection, 'current'>
  typing: Pick<EditorTyping, 'fitText'>
  /** Aborted when the editor is destroyed: families that arrive after that change nothing. */
  signal: AbortSignal
}

export interface EditorBrandKit {
  /**
   * Gives bound properties new values, as when the brand kit changes: bound layers redraw with them,
   * pictures bound to the logo take the kit's, the families of brand fonts and text styles load, and
   * text bound to a brand font or text style that changed refits; the promise settles then.
   */
  setVariables(variables: Variables): Promise<void>
  /**
   * Binds the selected layers to a brand colour, font, logo or text style, or unbinds them with null,
   * each storing the kit's value it showed, in one undo step; returns how many changed. Text bound to
   * a font or text style fits its new look.
   */
  bindSelection(kind: ValueKind, ref: VariableRef | null): number
  /**
   * Text bound to a brand font or text style the kit has changed since takes its family and look
   * once the family's files are here, its box fitting it: a change no one undoes. While a drag or a
   * typing session is open the refit waits for it to end (C40), so the promise can settle before the
   * refit lands.
   */
  refitBrandText(): Promise<void>
  /**
   * Pictures bound to the brand's logo store the kit's logo when it has changed since, so the
   * picture a crop or the Colour panel acts on is the one drawn: a change no one undoes.
   */
  followBrandLogo(): void
}

export function editorBrandKit({ session, resources, view, selection, typing, signal }: BrandKitDeps): EditorBrandKit {
  function setVariables(variables: Variables) {
    resources.setVariables(variables)
    resources.loadFamilies(fontFamilies(session.design(), variables))
    followBrandLogo()
    view.redraw()
    return refitBrandText()
  }
  function bindSelection(kind: ValueKind, ref: VariableRef | null): number {
    const current = session.design()
    const kit = resources.bytes().variables ?? {}
    if (ref && kit[ref] === undefined) return 0
    const bound = idsOf(selection.current()).flatMap((id) => {
      const node = current.nodes[id]
      const property = bindablePropertyOf(node?.type ?? '', kind)
      if (!property) return []
      // The logo goes only into a layer that shows a picture, never over a shape's colour.
      if (ref && kind === 'image' && boundValueOf(node?.type ?? '', node?.props ?? {}, kind) === undefined) return []
      // Unbinding stores the token's value the layer shows, which the value it stored can lag.
      const token = ref ?? node?.bindings?.[property]
      const value = token === undefined ? undefined : kit[token]
      return [{ id, property, value: value !== undefined && fitsProperty(property, value) ? value : undefined }]
    })
    if (bound.length === 0) return 0
    let changed = 0
    session.gesture(() => {
      for (const { id, property, value } of bound) {
        if (
          !runQuietly(() =>
            session.run('node.bind', { ids: [id], property, ref, ...(value === undefined ? {} : { value }) }),
          )
        )
          continue
        changed++
        if (kind === 'font' || kind === 'textLook') typing.fitText(id)
      }
    })
    return changed
  }
  /**
   * Text bound to a brand font or text style the kit has changed since: once the family it gives has
   * its files here, the text takes its family and look and its box fits them. A look that names no
   * family keeps the text's own. The kit lives outside the design, so this is a change no one undoes,
   * as another tab's: undo could not put the kit back with it. Run when the kit changes and when the
   * design opens.
   */
  async function refitBrandText() {
    const stale = [...staleBindings('font'), ...staleBindings('textLook')]
    if (stale.length === 0) return
    const families = [...new Set(stale.flatMap((s) => familyOf(s.value) ?? []))]
    await Promise.all(resources.loadFamilies(families))
    if (signal.aborted) return
    // Fitted in the fallback fonts, a box would be wrong: only a family whose files came is written.
    const here = new Set([...SHIPPED_FAMILIES, ...resources.bytes().fonts.map((f) => f.family)])
    session.untracked(() => {
      for (const { id, property, ref, value } of stale) {
        const node = session.design().nodes[id]
        // Still bound, the kit still gives this value (not a newer one), and the text has not taken it already.
        if (!node || node.bindings?.[property] !== ref || resources.bytes().variables?.[ref] !== value) continue
        const { read, kind } = BINDABLE_PROPERTIES[property]
        const family = familyOf(value)
        if (VALUE_KINDS[kind].same(read(node.props), value) || (family !== undefined && !here.has(family))) continue
        if (!runQuietly(() => session.run('node.bind', { ids: [id], property, ref, value }))) continue
        typing.fitText(id)
      }
    })
  }

  function followBrandLogo() {
    const stale = staleBindings('image')
    if (stale.length === 0) return
    session.untracked(() => {
      for (const { id, property, ref, value } of stale) {
        const node = session.design().nodes[id]
        // Still bound, and the kit still gives this picture: not one another tab or a newer kit changed.
        if (!node || node.bindings?.[property] !== ref || resources.bytes().variables?.[ref] !== value) continue
        if (VALUE_KINDS.image.same(BINDABLE_PROPERTIES[property].read(node.props), value)) continue
        runQuietly(() => session.run('node.bind', { ids: [id], property, ref, value }))
      }
    })
  }
  /** The layers bound to a token of this kind whose stored value the kit's now differs from, with that value. */
  function staleBindings(kind: ValueKind) {
    const kit = resources.bytes().variables ?? {}
    return Object.entries(session.design().nodes).flatMap(([id, node]) => {
      const property = bindablePropertyOf(node.type, kind)
      const ref = property ? node.bindings?.[property] : undefined
      const value = ref ? kit[ref] : undefined
      return property &&
        ref &&
        value &&
        fitsProperty(property, value) &&
        !VALUE_KINDS[kind].same(value, BINDABLE_PROPERTIES[property].read(node.props))
        ? [{ id, property, ref, value }]
        : []
    })
  }

  return {
    setVariables,
    bindSelection,
    refitBrandText,
    followBrandLogo,
  }
}

/** The family a brand font or text style's value gives; none for a look that names none. */
function familyOf(value: VariableValue): string | undefined {
  return typeof value === 'string' ? value : value.fontFamily
}
