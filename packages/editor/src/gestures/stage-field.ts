// The stage field: an invisible text area the page keeps beside the stage's overlay while a text is
// edited, with the focus in it, so that what the system types with no key reaches the text: an
// input method's composition and its commit, the emoji keyboard's pick, dictation, a key that types
// more than one letter, and a Backspace with no key, which deletes back as the key does. It holds
// the surrounding text it was given (`EditorInput.fieldText`), the text around the caret a keyboard
// reads to predict and correct, with the text's selection, and sends what changes in it and where
// its selection moves (`EditorInput.fieldChanged`); what an input method composes is drawn in the
// text, not in the field. The keys typed in it are the stage's (`isStageField`).
import type { EditorInput } from '../core-interface.ts'
import { type FieldState, holdsAround, sameSelection } from '../text/field-change.ts'
import { inField, STAGE_FIELD_MARK } from './dom-input.ts'

export interface StageFieldDeps {
  /** The stage's overlay: the field goes after it in the page, and stands at the caret it draws. */
  overlay: HTMLElement
  input: Pick<EditorInput, 'deleteBackward' | 'fieldText' | 'fieldChanged'>
  /** Whether a text is being edited now. */
  editing: () => boolean
  /** Adds a listener told when the text being edited, or its caret or range, changes. */
  onTextSelection: (listener: () => void) => () => unknown
  /** The field's name, for a screen reader, in the page's words. */
  label: string
  /** Removes the field and its listeners once it aborts. */
  signal: AbortSignal
}

export interface StageField {
  /** Whether an input method is composing in the field. */
  composing(): boolean
  /** Told when typing took a key: the field takes the focus back from a pop-up's button that took it. */
  keyTaken(): void
  /**
   * Moves the field to the caret as the overlay last drew it, inside the composition while one is
   * composed; outside one, sets its selection to the text's and gives it new surrounding text when
   * what it holds can't be kept. Called after each overlay draw.
   */
  place(): void
}

/** What holds the focus apart from the stage: a key typed there leaves it there. */
const POP_UPS = '[role="dialog"], [role="menu"], [role="listbox"], dialog'
/** The `beforeinput`s that would undo or redo in the field: Undo is the editor's own. */
const HISTORY_INPUTS = new Set(['historyUndo', 'historyRedo'])
/** The `input`s a composition makes, which, after its end, say again what its end left in the field. */
const COMPOSITION_INPUTS = new Set([
  'insertCompositionText',
  'deleteCompositionText',
  'insertFromComposition',
  'deleteByComposition',
])

export function editorStageField({
  overlay,
  input,
  editing,
  onTextSelection,
  label,
  signal,
}: StageFieldDeps): StageField {
  const field = document.createElement('textarea')
  /** Whether an input method is composing in the field: from its `compositionstart` to its `compositionend`, or a blur. */
  let composing = false
  /** Whether a change is being sent to the editor: the text's selection it moves is the field's own. */
  let sending = false
  /** What the editor takes the field to hold: what it was last given, or last sent; null while it holds nothing given. */
  let known: FieldState | null = null
  /** The word an input method re-opened in the field with no input, sent as a composition once its task ends. */
  let reopened: string | null = null
  /** Whether the last press on the page was a touch or a pen's, after which the field takes no focus: a tablet's keyboard would open. */
  let touched = false
  const on = { signal }

  /** What the field holds now: its value and its selection. */
  function held(): FieldState {
    const state = { value: field.value, start: field.selectionStart, end: field.selectionEnd }
    return field.selectionDirection === 'backward' ? { ...state, backward: true } : state
  }
  /** Whether the field's selection moved, with nothing else changed, from where the editor takes it to be. */
  function moved() {
    const now = held()
    return known !== null && now.value === known.value && !sameSelection(now, known)
  }
  /**
   * Takes the focus when the stage has it, while a text is edited, or after a key typing took
   * (`byKey`) from wherever it is but a field or a pop-up; gives it back to the page when none is.
   */
  function follow(byKey = false) {
    // Out of the accessibility tree while nothing is edited: a reader would find an empty field.
    if (editing()) field.removeAttribute('aria-hidden')
    else field.setAttribute('aria-hidden', 'true')
    if (!editing()) {
      if (document.activeElement === field) drop()
      return
    }
    const at = document.activeElement
    if (touched || at === field) return
    const free = at === null || at === document.body || (byKey && !inField(at) && !at.closest(POP_UPS))
    if (free) field.focus({ preventScroll: true })
  }
  /** Drops what an input method composes and gives the focus back to the page: typing stopped. */
  function drop() {
    composing = false
    reopened = null
    field.value = ''
    known = null
    field.blur()
  }
  /** Ends a composition where it was composed, as a press is about to move the caret, and keeps the focus. */
  function commit() {
    if (!composing) return
    field.blur()
    field.focus({ preventScroll: true })
  }
  /**
   * Gives the field the text and selection the editor has it hold, direction kept, outside a
   * composition and a change being sent: only what differs, so the input method hears only the
   * editor's own changes. A selection the field moved and has not sent yet goes to the text first.
   */
  function give() {
    if (composing || sending || !editing()) return
    catchUp()
    const given = input.fieldText()
    if (!given) return
    if (field.value !== given.value) field.value = given.value
    if (!sameSelection(held(), given))
      field.setSelectionRange(given.start, given.end, given.backward ? 'backward' : 'forward')
    known = held()
  }
  /** Sends what the field holds to the editor: with `composed`, the input event's data while composing. */
  function send(composed: string | null) {
    sending = true
    try {
      input.fieldChanged(held(), composed)
    } finally {
      sending = false
      known = held()
    }
  }
  /**
   * Sends a selection the field moved whose `selectionchange`, a task of its own, hasn't come yet,
   * so the event about to be read (a key, an input, a composition's start) reads from where it is.
   * It changes the editor only, never the field, so it may run inside a composition event.
   */
  function catchUp() {
    if (!composing && !sending && editing() && moved()) send(null)
  }
  /**
   * Sends what the field holds outside a composition, then gives it new surrounding text at once
   * when what it holds can't be kept: its caret near an edge of it.
   */
  function sendAndGive() {
    send(null)
    give()
  }
  /**
   * Sends the word an input method re-opened as the composition, once no input followed it in its
   * task: a keyboard re-opening the word before the caret changes nothing in the field.
   */
  function sendReopened() {
    const word = reopened
    reopened = null
    if (word !== null && composing && holdsAround(held(), word)) send(word)
  }
  /**
   * Ends the composition with what the field holds as its commit. When the input method cancelled
   * it, the editor gives back the text and its range as they were, and the next overlay draw gives
   * the field them again.
   */
  function endComposition() {
    composing = false
    reopened = null
    send(null)
  }
  /** Moves the field to the overlay's caret, or the end of its range, as last drawn, inside the stage. */
  function place() {
    const caret = overlay.querySelector<HTMLElement>('.caret')?.getBoundingClientRect()
    const range = [...overlay.querySelectorAll<HTMLElement>('.text-selection')].at(-1)?.getBoundingClientRect()
    const at = caret ?? range
    if (at) {
      // The caret is drawn centred on its place; a range ends at its last box's end.
      const x = caret ? (caret.left + caret.right) / 2 : at.right
      // Kept inside the stage, so focusing and composing never scroll anything to show it.
      const stage = overlay.getBoundingClientRect()
      field.style.left = `${Math.min(Math.max(x, stage.left), stage.right - 1)}px`
      field.style.top = `${Math.min(Math.max(at.top, stage.top), stage.bottom - at.height)}px`
      field.style.height = `${at.height}px`
      field.style.fontSize = `${at.height * 0.8}px`
    }
    sendReopened()
    give()
  }

  field.setAttribute(STAGE_FIELD_MARK, '')
  field.setAttribute('aria-label', label)
  field.setAttribute('aria-hidden', 'true')
  field.tabIndex = -1
  for (const [name, value] of [
    ['autocomplete', 'off'],
    ['autocorrect', 'off'],
    ['autocapitalize', 'off'],
    ['spellcheck', 'false'],
    ['data-gramm', 'false'],
  ] as const)
    field.setAttribute(name, value)
  Object.assign(field.style, {
    position: 'fixed',
    left: '0px',
    top: '0px',
    width: '1px',
    height: '1px',
    margin: '0',
    padding: '0',
    border: '0',
    outline: 'none',
    resize: 'none',
    // Presses, wheels and the hover cursor over it stay the canvas's.
    pointerEvents: 'none',
    // Its text stays on one line, scrolled to its own caret, which the input method's window opens by.
    overflow: 'hidden',
    whiteSpace: 'pre',
    lineHeight: '1',
    font: 'inherit',
    color: 'transparent',
    background: 'transparent',
    caretColor: 'transparent',
    opacity: '0',
    zIndex: '1',
  })
  overlay.after(field)
  signal.addEventListener('abort', () => field.remove())

  field.addEventListener(
    'beforeinput',
    (e) => {
      catchUp()
      if (HISTORY_INPUTS.has(e.inputType)) e.preventDefault()
      // A delete the browser would make anyway is read from the field as it makes it.
      if (e.inputType !== 'deleteContentBackward' || !e.cancelable) return
      // Backspace with no key the editor took, an input method's or a phone keyboard's: Backspace's own step.
      e.preventDefault()
      if (!composing) input.deleteBackward()
    },
    on,
  )
  field.addEventListener(
    'compositionstart',
    () => {
      catchUp()
      composing = true
    },
    on,
  )
  field.addEventListener(
    'compositionupdate',
    (e) => {
      const { data } = e as CompositionEvent
      // Text the field holds already, around its caret: re-opened, unless an input follows in this task.
      reopened = composing && holdsAround(held(), data) ? data : null
      if (reopened !== null) requestAnimationFrame(sendReopened)
    },
    on,
  )
  field.addEventListener(
    'input',
    (e) => {
      const { inputType, data, isComposing } = e as InputEvent
      reopened = null
      // A composition a blur ended goes on where the browser kept it (Safari, the window back in front).
      if (!composing && isComposing) composing = true
      if (composing) send(data ?? '')
      // The browser's own undo or redo, made though it was cancelled: the field is given its text again.
      else if (HISTORY_INPUTS.has(inputType)) give()
      // What a composition's end left, said again after it (Firefox), was read at its end.
      else if (!COMPOSITION_INPUTS.has(inputType)) sendAndGive()
    },
    on,
  )
  field.addEventListener(
    'compositionend',
    () => {
      // A late one, after a blur ended its composition, ends nothing.
      if (composing) endComposition()
    },
    on,
  )
  // The field's selection moved with no change to its text (a keyboard's space-bar cursor): the
  // text's moves with it. One the editor set, or a change already sent, is not sent back.
  field.addEventListener(
    'selectionchange',
    () => {
      if (!composing && !sending && editing() && moved()) sendAndGive()
    },
    on,
  )
  // The window losing the focus, or a press that moved it, leaves it on the page's body: it comes back.
  field.addEventListener(
    'blur',
    (e) => {
      // A browser that ends a composition on blur without its `compositionend` commits what it left.
      if (composing) endComposition()
      if (e.relatedTarget === null && editing()) requestAnimationFrame(() => follow())
    },
    on,
  )
  // A dialog giving the focus back to the field after typing stopped: it goes on to the page.
  field.addEventListener(
    'focus',
    () => {
      if (!editing()) field.blur()
    },
    on,
  )
  // A key the editor may take reads the text's caret from where the field last moved it.
  window.addEventListener('keydown', catchUp, { ...on, capture: true })
  window.addEventListener(
    'pointerdown',
    (e) => {
      touched = e.pointerType === 'touch' || e.pointerType === 'pen'
      // A press on the stage while composing: the composition lands before the caret moves.
      if (e.target instanceof Node && overlay.parentElement?.contains(e.target) && !inField(e.target)) commit()
    },
    { ...on, capture: true },
  )
  // Typing starting, or the text's caret or range moved by anything but the field: it takes the text it holds.
  const stopFollowing = onTextSelection(() => {
    follow()
    if (!sending) give()
  })
  signal.addEventListener('abort', () => stopFollowing())

  // A press on the stage keeps the focus in the field, so what the system types next lands at once:
  // the canvas takes no focus, and the browser would put it on the page's body.
  window.addEventListener(
    'mousedown',
    (e) => {
      if (document.activeElement === field && e.target instanceof Node && overlay.parentElement?.contains(e.target))
        e.preventDefault()
    },
    { ...on, capture: true },
  )
  // After a pick in a pop-up whose button took the focus back, the next key typing takes brings it back.
  return { composing: () => composing, keyTaken: () => follow(true), place }
}
