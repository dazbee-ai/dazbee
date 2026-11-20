// The stage field: a text area the page keeps beside the stage's overlay while a text is edited,
// with the focus in it, so that what the system types with no key reaches the text: the emoji
// keyboard's pick, dictation, an input method's committed text, and its Backspace, which deletes
// back as the key does. It holds no text of its own but while an input method composes, when it
// shows what is composed at the caret. The keys typed in it are the stage's (`isStageField`).
import type { EditorInput } from '../core-interface.ts'
import { inField, STAGE_FIELD_MARK } from './dom-input.ts'

export interface StageFieldDeps {
  /** The stage's overlay: the field goes after it in the page, and stands at the caret it draws. */
  overlay: HTMLElement
  input: Pick<EditorInput, 'text' | 'deleteBackward'>
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
  /** Moves the field to the caret as the overlay last drew it; called after each overlay draw. */
  place(): void
}

/** What holds the focus apart from the stage: a key typed there leaves it there. */
const POP_UPS = '[role="dialog"], [role="menu"], [role="listbox"], dialog'
/** The `beforeinput`s an input method makes while it composes, which the field lets it make. */
const COMPOSING_INPUTS = new Set(['insertCompositionText', 'deleteCompositionText'])

export function editorStageField({
  overlay,
  input,
  editing,
  onTextSelection,
  label,
  signal,
}: StageFieldDeps): StageField {
  const field = document.createElement('textarea')
  /** Whether an input method is composing in the field: from its `compositionstart` to its `compositionend`. */
  let composing = false
  /** Whether the last press on the page was a touch or a pen's, after which the field takes no focus: a tablet's keyboard would open. */
  let touched = false
  const on = { signal }

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
    field.value = ''
    composing = false
    shown(false)
    field.blur()
  }
  /** Ends a composition where it was composed, as a press is about to move the caret, and keeps the focus. */
  function commit() {
    if (!composing) return
    field.blur()
    field.focus({ preventScroll: true })
  }
  /** Shows the composition at the caret, or hides the field. */
  function shown(show: boolean) {
    field.style.opacity = show ? '1' : '0'
    field.style.width = '1px'
    if (show) field.style.width = `${field.scrollWidth + 2}px`
  }
  /** Moves the field to the overlay's caret, or the end of its range, as last drawn, inside the stage. */
  function place() {
    const parts = overlay.querySelectorAll<HTMLElement>('.caret, .text-selection')
    const at = parts[parts.length - 1]?.getBoundingClientRect()
    if (!at) return
    // Kept inside the stage, so focusing and composing never scroll anything to show it.
    const stage = overlay.getBoundingClientRect()
    field.style.left = `${Math.min(Math.max(at.right, stage.left), stage.right - 1)}px`
    field.style.top = `${Math.min(Math.max(at.top, stage.top), stage.bottom - at.height)}px`
    field.style.height = `${at.height}px`
    field.style.fontSize = `${at.height * 0.8}px`
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
    overflow: 'hidden',
    whiteSpace: 'pre',
    lineHeight: '1',
    font: 'inherit',
    color: '#15121a',
    background: '#ffffff',
    caretColor: 'transparent',
    opacity: '0',
    zIndex: '1',
  })
  overlay.after(field)
  signal.addEventListener('abort', () => field.remove())

  field.addEventListener(
    'beforeinput',
    (e) => {
      if (COMPOSING_INPUTS.has(e.inputType)) return
      // Nothing else goes into the field: text with no key is typed into the text being edited.
      e.preventDefault()
      if (composing) return
      if (e.inputType === 'insertText' && e.data) input.text(e.data)
      // Backspace with no key the editor took: an input method's, or a phone keyboard's.
      if (e.inputType === 'deleteContentBackward') input.deleteBackward()
    },
    on,
  )
  field.addEventListener(
    'compositionstart',
    () => {
      composing = true
      shown(true)
    },
    on,
  )
  field.addEventListener('input', () => shown(composing), on)
  field.addEventListener(
    'compositionend',
    (e) => {
      composing = false
      field.value = ''
      shown(false)
      if (e.data) input.text(e.data)
    },
    on,
  )
  // The window losing the focus, or a press that moved it, leaves it on the page's body: it comes back.
  field.addEventListener(
    'blur',
    (e) => {
      // A browser that ends a composition on blur without its `compositionend` leaves none open.
      composing = false
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
  const stopFollowing = onTextSelection(() => follow())
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
