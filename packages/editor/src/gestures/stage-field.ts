// The stage field: an invisible text area the page keeps beside the stage's overlay while a text is
// edited, with the focus in it, so that what the system types with no key reaches the text: an
// input method's composition and its commit, the emoji keyboard's pick, dictation, a key that types
// more than one letter, and a Backspace with no key, which deletes back as the key does. It holds
// the text it was given (`EditorInput.fieldText`) and sends what changes in it
// (`EditorInput.fieldChanged`); what an input method composes is drawn in the text, not in the
// field. The keys typed in it are the stage's (`isStageField`).
import type { EditorInput } from '../core-interface.ts'
import { fieldChange, type FieldState } from '../text/field-change.ts'
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
   * composed, and gives it the text it holds when it is owed it; called after each overlay draw.
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
  /** What the field held as the composition started, to tell a commit from a cancel at its end. */
  let atStart: FieldState | null = null
  /** What the field held as the last composition ended, sent as its commit. */
  let atEnd: FieldState | null = null
  /** Whether a change is being sent to the editor: the text's selection it moves is the field's own. */
  let sending = false
  /** Whether the field is owed the text it holds, once it may be given it: never while composing or sending. */
  let owed = false
  /** Whether the last press on the page was a touch or a pen's, after which the field takes no focus: a tablet's keyboard would open. */
  let touched = false
  const on = { signal }

  /** What the field holds now: its value and its selection. */
  function held(): FieldState {
    return { value: field.value, start: field.selectionStart, end: field.selectionEnd }
  }
  /**
   * Takes the focus when the stage has it, while a text is edited, or after a key typing took
   * (`byKey`) from wherever it is but a field or a pop-up; gives it back to the page when none is.
   */
  function follow(byKey = false) {
    // Out of the accessibility tree while nothing is edited: a reader would find an empty field.
    field.toggleAttribute('aria-hidden', !editing())
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
    field.value = ''
    field.blur()
  }
  /** Ends a composition where it was composed, as a press is about to move the caret, and keeps the focus. */
  function commit() {
    if (!composing) return
    field.blur()
    field.focus({ preventScroll: true })
  }
  /**
   * Gives the field the text and selection the editor has it hold, outside a composition and a
   * change being sent; else it is owed them until it may take them.
   */
  function give() {
    if (composing || sending) {
      owed = true
      return
    }
    owed = false
    const given = editing() ? input.fieldText() : null
    if (!given) return
    if (field.value !== given.value) field.value = given.value
    if (field.selectionStart !== given.start || field.selectionEnd !== given.end)
      field.setSelectionRange(given.start, given.end)
  }
  /** Sends what the field holds to the editor: with `composed`, the input event's data while composing. */
  function send(composed: string | null) {
    sending = true
    try {
      input.fieldChanged(held(), composed)
    } finally {
      sending = false
    }
  }
  /**
   * Ends the composition with what the field holds as its commit. One that put nothing in place of
   * what the field held at its start was cancelled: the editor gives back the text and its range as
   * they were, and the field is owed them again.
   */
  function endComposition() {
    composing = false
    const now = held()
    const change = atStart && fieldChange(atStart, now)
    atStart = null
    atEnd = now
    send(null)
    if (!change || change.text === '') owed = true
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
    if (owed) give()
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
      composing = true
      atStart = held()
    },
    on,
  )
  field.addEventListener(
    'input',
    (e) => {
      const { inputType, data, isComposing } = e as InputEvent
      // A composition a blur ended goes on where the browser kept it (Safari, the window back in front).
      if (!composing && isComposing) {
        composing = true
        atStart = atEnd ?? held()
      }
      if (composing) send(data ?? '')
      // The browser's own undo or redo, made though it was cancelled: the field is given its text again.
      else if (HISTORY_INPUTS.has(inputType)) give()
      // What a composition's end left, said again after it (Firefox), was read at its end.
      else if (!COMPOSITION_INPUTS.has(inputType)) send(null)
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
