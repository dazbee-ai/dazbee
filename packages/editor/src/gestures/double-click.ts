// A double click on the stage: on a frame's label it asks to rename the frame, and on a section's
// title the section; on the star by a frame's name nothing, as its presses star the frame; in the text being
// typed in it selects the word there; on a layer it goes into its group, box or boolean, or starts
// cropping its image fill, editing a path's points or typing in a text.
import type { Session } from '@dazbee/doc'
import type { SceneLayer } from '@dazbee/renderer'
import { isContainer, type Point } from '@dazbee/schema'

import type { Frame } from '../canvas/frames.ts'
import type { EditorView } from '../canvas/view.ts'
import type { EditorBoxes } from '../layers/boxes.ts'
import { type EditorSelection, isPath } from '../selection.ts'
import { wordAt } from '../text/text-edit.ts'
import type { EditorTyping } from '../text/typing.ts'
import type { EditorTools } from '../tools.ts'
import type { EditorCropping } from './crop/cropping.ts'
import type { PointerInput } from './inputs.ts'
import type { EditorPan } from './pan.ts'
import type { EditorSelectPress } from './select/select-press.ts'

export interface DoubleClickDeps {
  session: Pick<Session, 'design' | 'readOnly'>
  view: Pick<EditorView, 'design'>
  tools: Pick<EditorTools, 'tool'>
  selection: Pick<EditorSelection, 'enter' | 'select' | 'selectKeepingModes' | 'editPath'>
  boxes: Pick<EditorBoxes, 'pickable' | 'target' | 'lockedAt'>
  typing: Pick<EditorTyping, 'editing' | 'caretFromPoint' | 'caretTo' | 'selectText' | 'start' | 'stop'>
  cropping: Pick<EditorCropping, 'start'>
  selectPress: Pick<EditorSelectPress, 'textBeforeClicks'>
  /** Asks the page to rename a frame in place, and a section. */
  renameFrame: (frameId: string) => void
  renameSection: (sectionId: string) => void
  /** Tells that what is shown changed. */
  shownChanged: () => void
  panning: EditorPan['ready']
  /** The frame whose label's name or size is under the pointer, as last drawn. */
  labelUnder: (e: PointerInput) => string | undefined
  /** The frame under the pointer and the point in its design pixels. */
  pointIn: (e: PointerInput) => { frame: Frame; p: Point } | null
  /** The deepest layer that shows at a point of a frame, as the pointer's press and hover pick it. */
  deepestAt: (at: { frame: Frame; p: Point }, pickable?: EditorBoxes['pickable'], text?: string) => SceneLayer | null
}

export interface EditorDoubleClick {
  /** Does what a double click at the pointer input's place asks; nothing while panning. */
  doubleClick(e: PointerInput): void
}

export function editorDoubleClick({
  session,
  view,
  tools,
  selection,
  boxes,
  typing,
  cropping,
  selectPress,
  renameFrame,
  renameSection,
  shownChanged,
  panning,
  labelUnder,
  pointIn,
  deepestAt,
}: DoubleClickDeps): EditorDoubleClick {
  const { target, lockedAt } = boxes

  function doubleClick(e: PointerInput) {
    if (panning() || e.star !== undefined) return
    const label = labelUnder(e)
    if (label && tools.tool() === 'select') {
      renameFrame(label)
      return
    }
    if (e.title !== undefined && tools.tool() === 'select') {
      renameSection(e.title)
      return
    }
    const at = pointIn(e)
    const editing = typing.editing()
    // A double click picks the text selected before it anywhere in its box, as a press there drags it.
    const hit = at && deepestAt(at, boxes.pickable, selectPress.textBeforeClicks(at.frame.id))
    if (!at || !hit || lockedAt(at.frame, at.p)) return
    if (editing && hit.id === editing.id && editing.frameId === at.frame.id) {
      // A double click in the text being edited selects the word there (#47).
      const node = session.design().nodes[editing.id]
      if (node?.type === 'text') typing.selectText(wordAt(node.props.text, typing.caretFromPoint(at.p)))
      shownChanged()
      return
    }
    const picked = target(hit.id, at.frame.id)
    const container = view.design().nodes[picked]
    if (picked !== hit.id && container && isContainer(container.type)) {
      // Into the group, box or boolean: what is directly inside it under the pointer gets picked.
      typing.stop()
      selection.enter(picked)
      selection.selectKeepingModes(null)
      selection.select([target(hit.id, at.frame.id)], at.frame.id)
      return
    }
    // Into cropping its image fill (#48), or a path's points (#45): neither for a tab that may only view (C35).
    const mayEdit = !session.readOnly()
    if (mayEdit && cropping.start(at.frame, hit.id)) return
    if (mayEdit && isPath(view.design(), hit.id) && !view.design().nodes[hit.id]?.lock?.style) {
      typing.stop()
      selection.select([hit.id], at.frame.id)
      selection.editPath({ id: hit.id, frameId: at.frame.id })
      shownChanged()
      return
    }
    if (hit.type !== 'text' || view.design().nodes[hit.id]?.lock?.content) return
    typing.stop()
    selection.selectKeepingModes([{ id: hit.id, frameId: at.frame.id }])
    typing.start(hit.id, at.frame.id, 0)
    typing.caretTo(typing.caretFromPoint(at.p))
    shownChanged()
  }

  return { doubleClick }
}
