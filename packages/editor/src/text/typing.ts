// Typing into a text layer on the stage: the text being edited with its caret and selected
// range, the keys that type, delete and move the caret, the text copied, cut and pasted, and where
// the caret or the range is shown.
import type { CanvasKit } from '@dazbee/canvaskit'
import {
  type DesignStore,
  fittedText,
  type FitText,
  flippedPoint,
  flippedRect,
  type Session,
  type TextAnchor,
} from '@dazbee/doc'
import { caretAt, caretPosition, selectionBoxes, visualStep } from '@dazbee/renderer'
import type { Point, Rect, TextStyle } from '@dazbee/schema'

import type { Frame } from '../canvas/frames.ts'
import { findLayer, type FrameScenes } from '../canvas/scenes.ts'
import type { ClipboardPayload } from '../clipboard.ts'
import type { KeyInput } from '../gestures/inputs.ts'
import type { EditorBoxes } from '../layers/boxes.ts'
import { deleteLayers } from '../layers/delete-hide.ts'
import { paragraphsOf } from '../pasted-text.ts'
import type { EditorResources } from '../resources.ts'
import { runQuietly } from '../run-quietly.ts'
import type { Picked } from '../selection.ts'
import { backspaceStep, oneGrapheme, type RunStyle, step, stylesIn, type TextRange, wordStep } from './text-edit.ts'

/**
 * The text being edited, as it is shown, in its frame's design pixels: the selected range, one box
 * per run of one direction on one line, or with none the caret.
 */
export interface ShownText {
  frame: Frame
  range: Rect[]
  caret: { x: number; y: number; height: number } | null
}

export interface TypingDeps {
  ck: CanvasKit
  store: DesignStore
  session: Session
  resources: Pick<EditorResources, 'bytes'>
  scenes: Pick<FrameScenes, 'shownScene' | 'measure' | 'layout'>
  boxes: Pick<EditorBoxes, 'drawnHolders'>
  /** The shown page's frame with an id, as last drawn, if there is one. */
  frameOf: (id: string | undefined) => Frame | undefined
  /** Groups fit what they hold again after a change inside them, in the same undo step. */
  hug: (ids: string[]) => void
  /** Tells the text selection listeners that the text being edited, or its selected range, changed. */
  textSelectionChanged: () => void
  /** Tells that what is shown changed. */
  shownChanged: () => void
  /**
   * Runs `run` after `ms`, and gives what cancels it: the pause that ends a typing step (C47).
   * Without it, a typing step ends only when typing stops or `pause` is called.
   */
  after?: (ms: number, run: () => void) => () => void
  /** The names of the other tabs typing in a text now (D7); none without it. */
  typingIn?: (id: string) => string[]
  /** Tells the page that another tab is typing in the text this one starts editing (C47). */
  editingElsewhere?: (name: string) => void
  /**
   * The editor's fit (`text/fit-text.ts`): it asks for the families a text is drawn in, and answers
   * `'wait'` while one is coming. Without it, a text is fitted with what is here and waits for nothing.
   */
  fit?: FitText
  /** Owes a text fitted while a font it is drawn in was coming a fit once that load settles. */
  owe?: (id: string) => void
}

export interface EditorTyping {
  /** The text layer being typed into, and the frame it is typed in; null when none is. */
  editing(): Readonly<Picked> | null
  /** The selected range of the text being edited, when it holds a character or more. */
  selectedText(): { id: string; range: TextRange } | null
  /** Each character's style in the selected range of the text being edited, or null with no range. */
  selectionStyles(): TextStyle[] | null
  /** The offset in the text being edited nearest a point in its frame, in design pixels; 0 with none. */
  caretFromPoint(p: Point): number
  /**
   * Starts typing into a text layer in a frame, with the caret at an offset, in one undo step until
   * typing stops: `endGesture` ends a step already begun, such as the one the text tool made the
   * layer in, and `created` says that tool made it.
   */
  start(id: string, frame: string, offset: number, endGesture?: () => void, created?: boolean): void
  /** Ends typing, closing its undo step; a text box the text tool made and left empty goes in it. */
  stop(): void
  /**
   * Ends the typing step open now and keeps typing (C47), as a pause of `TYPING_PAUSE_MS` does: the
   * tab was hidden. The next key opens a new step, so undo takes back a burst at a time.
   */
  pause(): void
  /** Ends typing when the text being edited is no longer drawn: deleted, or its frame gone. */
  stopWhenGone(): void
  /** Puts the caret at an offset; with `extend`, the other end of the range stays where it is. */
  caretTo(offset: number, extend?: boolean): void
  /** Selects a range, the caret at its end. */
  selectText(range: TextRange): void
  /**
   * Styles a range of a text layer, as one undo step of its own: while the layer is being edited,
   * between the typing before and after it. A key left undefined changes nothing.
   */
  styleRange(selected: { id: string; range: TextRange }, style: RunStyle): void
  /** Styles the selected range of the text being edited; false when no range is selected. */
  styleSelectedText(style: RunStyle): boolean
  /** Keeps the box of text that grows the size of its words, and the groups around it, fitted, in the step the edit is in. */
  fitText(id: string): void
  /**
   * A key pressed while typing: types, deletes or moves the caret; other keys are the page's, the
   * style keys too. Returns whether the key was typing's, so the browser does nothing more with it.
   */
  key(e: KeyInput): boolean
  /** The selected range as a payload of plain text; null with a caret alone, or while no text is edited. */
  copy(): ClipboardPayload | null
  /** Cuts the selected range, and gives it as a payload of plain text; null, cutting nothing, with a caret alone. */
  cut(): ClipboardPayload | null
  /**
   * Pastes a payload's plain text over the selected range; its line breaks become paragraphs.
   * Returns whether it took the payload: false while no text is edited, or for one with no plain text.
   */
  paste(payload: ClipboardPayload): boolean
  /**
   * Types text that came with no key, from the system's emoji keyboard or an input method, over
   * the selected range, as a paste of it; false while no text is edited.
   */
  insert(text: string): boolean
  /**
   * Deletes back from the caret as Backspace does, or the selected range, for a delete that came
   * with no key (an input method's, a phone keyboard's); false while no text is edited, or with
   * nothing before the caret.
   */
  deleteBackward(): boolean
  /** The selected range of the text being edited, or else its caret; null when none is edited or it is not drawn. */
  shown(): ShownText | null
}

/**
 * The caret and the other end of the selected range (#47), anchored in the text so edits arriving
 * from other tabs carry them along; the same place when nothing is selected.
 */
interface Editing extends Picked {
  caret: TextAnchor
  anchor: TextAnchor
  /**
   * Whether the caret is drawn beside the grapheme after it: where an arrow left it at a place in
   * text of two directions that belongs to that grapheme.
   */
  drawnAfter: boolean
  /** Ends the typing step open now; null after a pause, until the next write opens one. */
  endGesture: (() => void) | null
  created: boolean
}

/** How long typing waits with no key before it ends its step (C47), in milliseconds. */
export const TYPING_PAUSE_MS = 2_000

export function editorTyping({
  ck,
  store,
  session,
  resources,
  scenes,
  boxes,
  frameOf,
  hug,
  textSelectionChanged,
  shownChanged,
  after,
  typingIn = () => [],
  editingElsewhere = () => {},
  fit,
  owe = () => {},
}: TypingDeps): EditorTyping {
  /** The text layer being typed into, with the caret and the other end of its range. */
  let editing: Editing | null = null
  /** Cancels the pause that would end the typing step open now. */
  let cancelPause: (() => void) | null = null

  /** The text layer being typed into, in its frame. */
  function editingNow() {
    return editing
  }
  /** The layer as a frame shows it now, with the frame. */
  function pickedLayer(picked: Picked | null) {
    const frame = picked && frameOf(picked.frameId)
    const layer = frame && findLayer(scenes.shownScene(frame).layers, picked.id)
    return frame && layer ? { frame, layer } : null
  }
  /** The editing layer's text, laid out as drawn, from the screen's cache, which owns it. */
  function editingText() {
    const found = pickedLayer(editing)
    if (found?.layer.type !== 'text') return null
    return { ...found, layer: found.layer, laid: scenes.layout(found.layer.props) }
  }
  /** The selected range of the text being edited; empty at the caret when nothing is selected. */
  function textRange(): TextRange | null {
    if (!editing) return null
    const caret = store.anchorOffset(editing.caret)
    const anchor = store.anchorOffset(editing.anchor)
    if (caret === null || caret === undefined) return null
    const other = anchor ?? caret
    return { start: Math.min(caret, other), end: Math.max(caret, other) }
  }
  /** The selected range of the text being edited, when it holds a character or more. */
  function selectedText(): { id: string; range: TextRange } | null {
    const range = textRange()
    return editing && range && range.end > range.start ? { id: editing.id, range } : null
  }
  /** Each character's style in the selected range. */
  function textSelectionStyles() {
    const selected = selectedText()
    const node = selected && session.design().nodes[selected.id]
    if (!selected || node?.type !== 'text') return null
    return stylesIn(node.props, selected.range)
  }
  /** The offset nearest a point in the frame the text is typed in, its words mirrored as it is flipped. */
  function caretFromPoint(p: Point) {
    const text = editingText()
    if (!text) return 0
    const { props } = text.layer
    const at = flippedPoint(p, props)
    return caretAt(ck, text.laid, at.x - props.x, at.y - props.y - text.laid.dy)
  }
  /** The text being edited and its selected range, for the clipboard. */
  function clipboardText() {
    const node = editing && session.design().nodes[editing.id]
    const range = textRange()
    return node?.type === 'text' && range ? { text: node.props.text, range } : null
  }
  /**
   * The selected range, one box per run of one direction on one line (#47), or else the caret,
   * mirrored as the text is flipped.
   */
  function shown(): ShownText | null {
    const text = editingText()
    const offset = editing && store.anchorOffset(editing.caret)
    const range = textRange()
    if (!text) return null
    const { props } = text.layer
    const placed = (box: Rect) => flippedRect({ ...box, x: props.x + box.x, y: props.y + text.laid.dy + box.y }, props)
    if (range && range.end > range.start) {
      return {
        frame: text.frame,
        range: selectionBoxes(ck, text.laid, range.start, range.end).map(placed),
        caret: null,
      }
    }
    if (offset === null || offset === undefined) return null
    const at = caretPosition(ck, text.laid, offset, editing?.drawnAfter)
    const { x, y, height } = placed({ x: at.x, y: at.y, width: 0, height: at.height })
    return { frame: text.frame, range: [], caret: { x, y, height } }
  }

  /** Starts typing into a text layer in a frame, in one undo step until typing stops. */
  function startEditing(
    id: string,
    frame: string,
    offset: number,
    endGesture = session.beginGesture().end,
    created = false,
  ) {
    const at = store.textAnchor(id, offset)
    editing = { id, frameId: frame, caret: at, anchor: at, drawnAfter: false, endGesture, created }
    textSelectionChanged()
    // Another tab typing in the same text: the version finished last is kept (C47).
    const [other] = typingIn(id)
    if (other !== undefined) editingElsewhere(other)
  }
  /** Ends the typing step open now, and the pause that would end it. */
  function endStep() {
    cancelPause?.()
    cancelPause = null
    editing?.endGesture?.()
    if (editing) editing.endGesture = null
  }
  /** Runs a write to the text being edited in the typing step, opening one after a pause; whether it ran. */
  function write(steps: () => void) {
    // A write inside another's gesture (a panel's scrub) joins it; the next write opens typing's own.
    if (editing && !editing.endGesture && !session.inGesture()) editing.endGesture = session.beginGesture().end
    const ok = runQuietly(steps)
    // The pause starts again with each write, never at start: a new empty box is not saved alone.
    cancelPause?.()
    cancelPause = after?.(TYPING_PAUSE_MS, pause) ?? null
    return ok
  }
  /** Ends the typing step open now and keeps typing; an empty box the text tool made waits for a word. */
  function pause() {
    if (!editing?.endGesture) return
    const node = session.design().nodes[editing.id]
    if (editing.created && node?.type === 'text' && node.props.text === '') return
    endStep()
  }
  /** Ends typing, closing its undo step. */
  function stopEditing() {
    if (!editing) return
    // A text box made with the text tool and left empty goes again, in the same undo step.
    const { id } = editing
    const node = session.design().nodes[id]
    if (node?.type === 'text' && node.props.text === '' && editing.created)
      runQuietly(() => deleteLayers(session, boxes, [id]))
    endStep()
    editing = null
    textSelectionChanged()
  }
  /** Ends typing when the text being edited is no longer in the scene of its frame. */
  function stopWhenGone() {
    if (editing && !pickedLayer(editing)) stopEditing()
  }
  /**
   * Puts the caret at an offset; with `extend`, the other end of the range stays where it is. With
   * `drawnAfter`, it is drawn beside the grapheme after it.
   */
  function caretTo(offset: number, extend = false, drawnAfter = false) {
    if (!editing) return
    editing.caret = store.textAnchor(editing.id, offset)
    editing.drawnAfter = drawnAfter
    if (!extend) editing.anchor = editing.caret
    textSelectionChanged()
  }
  /** Selects a range, the caret at its end. */
  function selectText(range: TextRange) {
    if (!editing) return
    editing.anchor = store.textAnchor(editing.id, range.start)
    editing.caret = store.textAnchor(editing.id, range.end)
    editing.drawnAfter = false
    textSelectionChanged()
  }
  /**
   * Keeps the box of text that grows the size of its words (#47), and the groups around it, fitted,
   * in the step the edit is in: it measures the layer once and sets its size.
   */
  function fitText(id: string) {
    const layer = session.design().nodes[id]
    // Text bound to a brand font is drawn, so measured, in the family the kit gives it.
    const measured = () => fittedText(layer, scenes.measure(), resources.bytes().variables)
    let size = fit && layer ? fit(layer) : measured()
    // A font it is drawn in is coming: fitted with what is here, and again once it settles.
    if (size === 'wait') {
      owe(id)
      size = measured()
    }
    if (!size) return
    runQuietly(() => session.run('text.fit', { id, ...size }))
    hug([id])
  }
  /**
   * Styles a range of a text layer with `style`, as one undo step of its own named `style`, as a
   * layer's is: while the layer is being edited, between the typing before and after it. A key left
   * undefined changes nothing, since a run can't say "as the layer".
   */
  function styleRange({ id, range }: { id: string; range: TextRange }, style: RunStyle) {
    const keys = Object.fromEntries(Object.entries(style).filter(([, value]) => value !== undefined)) as RunStyle
    if (Object.keys(keys).length === 0) return
    // The typing before it is a step of its own; the next key opens another.
    if (editing?.id === id) endStep()
    session.gesture('style', () => {
      runQuietly(() =>
        session.run('text.edit', {
          id,
          op: { kind: 'style', at: range.start, length: range.end - range.start, style: keys },
        }),
      )
      fitText(id)
    })
    shownChanged()
  }
  /** Styles the selected range of the text being edited; false when no range is selected. */
  function styleSelectedText(style: RunStyle): boolean {
    const selected = selectedText()
    if (!selected) return false
    styleRange(selected, style)
    return true
  }

  /**
   * Deletes the selected range, or else back from the caret: a letter's trailing vowel sign or mark
   * alone, as Indic keyboards take it back (`backspaceStep`), or a word with `byWord`. Writes only;
   * whether it deleted anything.
   */
  function deleteBack(byWord: boolean) {
    const node = editing && session.design().nodes[editing.id]
    const range = textRange()
    if (!editing || node?.type !== 'text' || !range) return false
    const { id } = editing
    const text = node.props.text
    const end = Math.min(range.end, text.length)
    const caret = Math.min(range.start, text.length)
    const start = end > caret ? caret : byWord ? wordStep(text, caret, false) : backspaceStep(text, caret)
    if (start === end) return false
    const ok = write(() => session.run('text.edit', { id, op: { kind: 'delete', at: start, length: end - start } }))
    if (ok) caretTo(start)
    return ok
  }
  /** Deletes back as Backspace does, for a delete that came with no key, and fits and shows the text. */
  function deleteBackward() {
    const id = editing?.id
    if (id === undefined || !deleteBack(false)) return false
    fitText(id)
    shownChanged()
    return true
  }

  /** A key while typing: everything but copy, cut and paste, which come as their own events. */
  function onKey(e: KeyInput) {
    if (!editing) return false
    // AltGr comes with Ctrl in Chrome on Windows; its key types. ⌘ is never AltGr's (Firefox on a
    // Mac says AltGraph whenever Option is held).
    const mod = e.metaKey || (e.ctrlKey && !e.altGraph)
    // The document, not the last drawn scene: keys can come faster than redraws.
    const node = session.design().nodes[editing.id]
    if (node?.type !== 'text') return false
    const text = node.props.text
    const range = textRange() ?? { start: 0, end: 0 }
    const caret = Math.min(store.anchorOffset(editing.caret) ?? 0, text.length)
    const selected = range.end > range.start
    const { id, drawnAfter } = editing
    const key = e.key.toLowerCase()
    // Ctrl, or Alt as on a Mac, moves and deletes a word at a time.
    const byWord = e.ctrlKey || e.altKey
    /** Replaces the selected range with text, or with nothing; the caret ends after what went in. */
    const replace = (inserted: string) => {
      const ok = write(() => {
        if (selected)
          session.run('text.edit', { id, op: { kind: 'delete', at: range.start, length: range.end - range.start } })
        if (inserted) session.run('text.edit', { id, op: { kind: 'insert', at: range.start, text: inserted } })
      })
      // The anchor sits after the character before the caret, so inserting at the caret leaves it
      // before the new text; it is moved past it.
      if (ok) caretTo(range.start + inserted.length)
      return ok
    }
    /**
     * Where an arrow moves the caret to, a grapheme left or right on screen through right-to-left
     * text; in reading order on a line all left to right, or while the text drawn is not yet the
     * text typed.
     */
    const arrowStep = (right: boolean) => {
      const drawn = editingText()
      const onScreen =
        drawn?.layer.props.text === text
          ? visualStep(ck, drawn.laid, { offset: caret, after: drawnAfter }, right)
          : null
      return onScreen ?? { offset: step(text, caret, right), after: false }
    }
    /** The caret's offset on the line above or below, or at the start or end of its line. */
    const lineMove = (to: 'up' | 'down' | 'home' | 'end') => {
      const laid = editingText()
      if (!laid) return caret
      const at = caretPosition(ck, laid.laid, caret, drawnAfter)
      if (to === 'home' || to === 'end') return caretAt(ck, laid.laid, to === 'home' ? -1e6 : 1e6, at.y + at.height / 2)
      const y = to === 'up' ? at.y - at.height / 2 : at.y + at.height * 1.5
      if (y < 0) return 0
      if (y > laid.laid.height) return text.length
      return caretAt(ck, laid.laid, at.x, y)
    }
    if (e.key === 'Escape') {
      stopEditing()
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      // A character step goes the way the arrow points on screen, a word step in reading order. With
      // a range and no Shift, a character step goes to its near end, and a word step from the caret.
      const right = e.key === 'ArrowRight'
      if (selected && !e.shiftKey && !byWord) caretTo(right ? range.end : range.start)
      else if (byWord) caretTo(wordStep(text, caret, right), e.shiftKey)
      else {
        const to = arrowStep(right)
        caretTo(to.offset, e.shiftKey, to.after)
      }
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'Home' || e.key === 'End') {
      caretTo(lineMove(({ ArrowUp: 'up', ArrowDown: 'down', Home: 'home', End: 'end' } as const)[e.key]), e.shiftKey)
    } else if (mod && key === 'a') {
      selectText({ start: 0, end: text.length })
    } else if (e.key === 'Backspace' && (selected || caret > 0)) {
      deleteBack(byWord)
    } else if (e.key === 'Delete' && (selected || caret < text.length)) {
      if (selected) replace('')
      else
        write(() =>
          session.run('text.edit', {
            id,
            op: { kind: 'delete', at: caret, length: (byWord ? wordStep : step)(text, caret, true) - caret },
          }),
        )
    } else if (e.key === 'Enter') {
      replace('\n')
    } else if (oneGrapheme(e.key) && !mod) {
      replace(e.key)
    } else {
      // Copy, cut and paste come as their own events; anything else is the page's.
      return false
    }
    if (session.design().nodes[id] !== node) fitText(id)
    shownChanged()
    return true
  }
  /** The selected range as a payload of plain text; null with a caret alone, or while no text is edited. */
  function copy(): ClipboardPayload | null {
    const at = clipboardText()
    if (!at || at.range.end === at.range.start) return null
    return { text: at.text.slice(at.range.start, at.range.end) }
  }
  /** Cuts the selected range, the caret where it began, and gives it as a payload of plain text. */
  function cut(): ClipboardPayload | null {
    const at = clipboardText()
    if (!at || !editing || at.range.end === at.range.start) return null
    const { id } = editing
    if (
      write(() =>
        session.run('text.edit', {
          id,
          op: { kind: 'delete', at: at.range.start, length: at.range.end - at.range.start },
        }),
      )
    )
      caretTo(at.range.start)
    fitText(id)
    shownChanged()
    return { text: at.text.slice(at.range.start, at.range.end) }
  }
  /**
   * Pastes a payload's plain text over the selected range, the caret after it; line breaks become
   * paragraphs. A payload with no plain text (an image alone) changes nothing and isn't taken.
   */
  function paste(payload: ClipboardPayload) {
    const at = clipboardText()
    if (!at || !editing || !payload.text) return false
    const pasted = paragraphsOf(payload.text)
    const { id } = editing
    const { start, end } = at.range
    const ok = write(() => {
      if (end > start) session.run('text.edit', { id, op: { kind: 'delete', at: start, length: end - start } })
      session.run('text.edit', { id, op: { kind: 'insert', at: start, text: pasted } })
    })
    if (ok) caretTo(start + pasted.length)
    fitText(id)
    shownChanged()
    return true
  }

  return {
    editing: editingNow,
    selectedText,
    selectionStyles: textSelectionStyles,
    caretFromPoint,
    start: startEditing,
    stop: stopEditing,
    pause,
    stopWhenGone,
    caretTo,
    selectText,
    styleRange,
    styleSelectedText,
    fitText,
    key: onKey,
    copy,
    cut,
    paste,
    insert: (text: string) => paste({ text }),
    deleteBackward,
    shown,
  }
}
