// A pointer event and a key event of the stage as plain data, with the names the browser's events
// give the same things, and what the editor answers to each.
import type { Point } from '@dazbee/schema'

/** One pointer event on the stage. */
export interface PointerInput {
  type:
    | 'pointerdown'
    | 'pointermove'
    | 'pointerup'
    | 'pointercancel'
    | 'lostpointercapture'
    | 'pointerleave'
    | 'click'
    | 'dblclick'
    | 'wheel'
  /** Where the pointer is, as a stage point. */
  at: Point
  button: number
  /** The click count, where the event carries one. */
  detail: number
  shiftKey: boolean
  altKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  /** `mouse`, `touch` or `pen`. */
  pointerType: string
  /** The frame whose label's text is under the pointer, if any, on a press and a double click. */
  label?: string
  /** The section whose title is under the pointer, if any, on a press and a double click. */
  title?: string
  /** The frame whose label's star is under the pointer, if any, on a press and a double click. */
  star?: string
  /** How far a wheel turned, and in which unit: pixels (0), lines (1) or pages (2). */
  deltaX?: number
  deltaY?: number
  deltaMode?: number
}

/** What the page says about where a key was pressed. */
export interface KeyTarget {
  /** In one of the page's own fields, which takes the keys typed. */
  field: boolean
  /** On a control that Space presses or ticks, which the focus reached after a key. */
  control: boolean
  /** In a popover, menu or dialog: one that says it is not modal is `modeless`. */
  dialog: 'none' | 'modal' | 'modeless'
  /** An arrow pressed in a toolbar, whose arrows move the focus along it. */
  toolbarArrow: boolean
  /** Enter on a button, which it presses. */
  buttonEnter: boolean
  /** Nothing on the page has the focus, so the stage has the keys. */
  stage: boolean
}

/** One key event the window hears. */
export interface KeyInput {
  type: 'keydown' | 'keyup'
  code: string
  key: string
  shiftKey: boolean
  altKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  repeat: boolean
  /**
   * An input method is composing (`isComposing`, keyCode 229, or the stage field composing): the
   * key is the input method's, for its own text. Absent: none is.
   */
  composing?: boolean
  /** AltGr is down, which Chrome on Windows also reports as Ctrl and Alt: the key types its character. */
  altGraph?: boolean
  target: KeyTarget
}

/** What the editor did with a pointer input: whether it was its own, so the browser does nothing more with it, and whether to hold the pointer. */
export interface PointerAnswer {
  handled: boolean
  hold: boolean
}

/**
 * What the editor did with a key input: whether it was its own, so the browser does nothing more
 * with it, and what its own key's action threw, to be thrown on once the browser is kept from it.
 */
export interface KeyAnswer {
  handled: boolean
  thrown?: unknown
}
