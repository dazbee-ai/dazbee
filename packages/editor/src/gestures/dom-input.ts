// The page's side of the stage's pointer and keys: it turns each of the canvas's pointer events and
// each key the window hears into a pointer or key input, with what the page says about where a key
// was pressed, sends it to the editor and does what the editor answers; and it shows the cursor the
// editor decides. While a colour is picked, a press on the canvas keeps its release and click to
// itself, so a pop-up open on the page stays open, a touch's ends with no click, and a press
// elsewhere ends picking.
// What it asks of the page's elements is here too.
import type { Point } from '@dazbee/schema'

import type { EditorSurface } from '../canvas/surface.ts'
import type { EditorInput } from '../core-interface.ts'
import type { KeyInput, PointerInput } from './inputs.ts'

export interface DomInputDeps {
  canvas: HTMLCanvasElement
  /** The overlay over the stage, whose frame labels a press may be on. */
  overlay: ParentNode
  /** Where the canvas is on the page: the stage point of a pointer event. */
  surface: Pick<EditorSurface, 'onStage'>
  input: EditorInput
  /** Whether the stage field's input method is composing now; none without it. */
  composing?: () => boolean
  /** Told when the editor took a key down that nothing on the page took first: the stage field follows typing's keys. */
  keyTaken?: () => void
  /** Picking a colour, which a press on the page but the canvas or an eyedropper (`KEEPS_PICKING`) ends. */
  picking?: { picking(): boolean; stop(): void }
  /** Whether the window's keys are paused: the editor hears none, as the live editor while a version is viewed over it. */
  paused?: () => boolean
  /** Removes the listeners once it aborts. */
  signal: AbortSignal
}

/** The canvas's events that become pointer inputs. */
const POINTER_TYPES = [
  'pointerdown',
  'pointermove',
  'pointerup',
  'pointercancel',
  'lostpointercapture',
  'pointerleave',
  'click',
  'dblclick',
  'wheel',
] as const
/** The elements and roles of controls that space presses or ticks; fields are `inField`'s. */
const CONTROL_TAGS = new Set(['A', 'BUTTON', 'SUMMARY'])
const CONTROL_ROLES = new Set([
  'button',
  'checkbox',
  'combobox',
  'link',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'option',
  'radio',
  'slider',
  'spinbutton',
  'switch',
  'tab',
  'treeitem',
])
/** The attribute that marks the stage field (`stage-field.ts`): the keys typed there are the stage's. */
export const STAGE_FIELD_MARK = 'data-stage-keys'
/** The attribute that marks an eyedropper, whose press leaves picking a colour to its own click, which toggles it. */
export const KEEPS_PICKING = 'data-keeps-picking'
/**
 * The canvas's events that end a press, which one made while picking keeps from bubbling past it: a
 * pop-up's outside press then counts as taken and leaves it open (Radix's dismissable layer).
 */
const PRESS_ENDS = new Set(['pointerup', 'mouseup', 'touchend', 'click'])

export function editorDomInput({
  canvas,
  overlay,
  surface,
  input,
  composing = () => false,
  keyTaken = () => undefined,
  picking = { picking: () => false, stop: () => {} },
  paused = () => false,
  signal,
}: DomInputDeps) {
  /** Whether the page's last key or pointer press was a key. */
  let keyed = false
  /** Whether the focus last moved after a key, as Tab moves it, and not after a pointer press. */
  let focusByKey = false
  /** Whether the canvas's last press was made while a colour was picked. */
  let pickPress = false
  const on = { signal }

  /**
   * A pointer event of the canvas as a pointer input: where it is on the stage, and on a press and a
   * double click the label or the section's title under it.
   */
  function pointerInput(type: PointerInput['type'], e: MouseEvent): PointerInput {
    const client = { x: e.clientX, y: e.clientY }
    const pressed = type === 'pointerdown' || type === 'dblclick'
    const label = pressed ? labelTextAt(overlay, client) : undefined
    const title = pressed && label === undefined ? sectionTitleAt(overlay, client) : undefined
    return {
      type,
      at: surface.onStage(client),
      button: e.button,
      detail: e.detail,
      shiftKey: e.shiftKey,
      altKey: e.altKey,
      ctrlKey: e.ctrlKey,
      metaKey: e.metaKey,
      pointerType: 'pointerType' in e ? (e as PointerEvent).pointerType : 'mouse',
      ...(label === undefined ? {} : { label }),
      ...(title === undefined ? {} : { title }),
      ...(type === 'pointermove' ? { buttons: e.buttons } : {}),
      ...('deltaMode' in e
        ? { deltaX: (e as WheelEvent).deltaX, deltaY: (e as WheelEvent).deltaY, deltaMode: (e as WheelEvent).deltaMode }
        : {}),
    }
  }
  /** Sends a pointer event of the canvas to the pointer, and does what it answers: the event is the editor's alone, the pointer is held. */
  function onPointer(type: PointerInput['type'], e: MouseEvent) {
    if (type === 'pointerdown') pickPress = picking.picking()
    const answer = input.pointer(pointerInput(type, e))
    if (answer.handled) e.preventDefault()
    if (answer.hold && 'pointerId' in e) canvas.setPointerCapture((e as PointerEvent).pointerId)
    keepPress(e)
  }
  /**
   * Keeps an event that ends a press made while picking from bubbling past the canvas, even once the
   * press has picked; a touch's touchend is cancelled, which leaves it no click: what the page shows
   * as picking ends, a phone's panel shown again, never takes one under the finger.
   */
  function keepPress(e: Event) {
    if (!pickPress || !PRESS_ENDS.has(e.type)) return
    e.stopPropagation()
    if (e.type === 'touchend') e.preventDefault()
  }
  /** Ends picking at a press anywhere on the page but the canvas or an eyedropper. */
  function pressElsewhere(e: Event) {
    if (!picking.picking() || e.target === canvas) return
    if (e.target instanceof Element && e.target.closest(`[${KEEPS_PICKING}]`)) return
    picking.stop()
  }

  /**
   * While a drag is held, Escape is the drag's: it cancels it before anything else hears the key, as
   * this listener comes first, added as the editor starts, before the page's chrome that needs it.
   */
  function cancelDragOnEscape(e: KeyboardEvent) {
    if (paused()) return
    const key = keyInput('keydown', e)
    // An input method's Escape is its own: it cancels what it composes.
    if (key.composing || !input.cancelOnEscape(key)) return
    e.preventDefault()
    e.stopImmediatePropagation()
  }
  /** A key event the window hears as a key input, with what the page says about where it was pressed. */
  function keyInput(type: KeyInput['type'], e: KeyboardEvent): KeyInput {
    const dialog = dialogOf(e.target)
    return {
      type,
      code: e.code,
      key: e.key,
      shiftKey: e.shiftKey,
      altKey: e.altKey,
      ctrlKey: e.ctrlKey,
      metaKey: e.metaKey,
      repeat: e.repeat,
      composing: composingKey(e) || (isStageField(e.target) && composing()),
      // A key event the page makes itself may lack it.
      altGraph: e.getModifierState?.('AltGraph') ?? false,
      target: {
        field: inField(e.target),
        control: focusByKey && isControl(e.target),
        dialog: !dialog ? 'none' : dialog.getAttribute('aria-modal') === 'false' ? 'modeless' : 'modal',
        toolbarArrow: arrowInToolbar(e),
        buttonEnter: enterOnButton(e),
        stage: stageHasKeys(e.target),
      },
    }
  }
  /**
   * Follows how the focus moves, from the window's key presses, pointer presses and focus moves
   * anywhere on the page: a control the focus moved to after a key takes space; one it moved to
   * after a press, such as a menu's button given the focus back after a pick, leaves space to pan.
   */
  function followFocus(e: Event) {
    if (e.type === 'keydown') keyed = true
    else if (e.type === 'pointerdown') keyed = false
    else if (e.type === 'focusin') focusByKey = keyed
  }
  /**
   * Sends a key event of the window to the keys, and keeps the browser from acting on one that was
   * the editor's; what the editor's own key threw is thrown on after.
   */
  function onKeyEvent(type: KeyInput['type'], e: KeyboardEvent) {
    if (paused()) return
    const takenFirst = e.defaultPrevented
    const answer = input.key(keyInput(type, e))
    if (answer.handled) e.preventDefault()
    if (answer.handled && type === 'keydown' && !takenFirst) keyTaken()
    if ('thrown' in answer) throw answer.thrown
  }

  for (const type of POINTER_TYPES)
    canvas.addEventListener(type, (e) => onPointer(type, e as MouseEvent), { ...on, passive: false })
  for (const type of ['mouseup', 'touchend']) canvas.addEventListener(type, keepPress, on)
  window.addEventListener('pointerdown', pressElsewhere, { ...on, capture: true })
  canvas.style.cursor = input.cursor()
  input.onCursor((cursor) => {
    canvas.style.cursor = cursor
  })
  window.addEventListener('keydown', cancelDragOnEscape, { ...on, capture: true })
  window.addEventListener('keydown', (e) => onKeyEvent('keydown', e), on)
  window.addEventListener('keyup', (e) => onKeyEvent('keyup', e), on)
  for (const type of ['keydown', 'pointerdown', 'focusin'])
    window.addEventListener(type, followFocus, { ...on, capture: true })
  window.addEventListener('blur', input.blur, on)
  // A hidden tab ends the typing step open (C47): what was typed lands, and the next key opens another.
  document.addEventListener(
    'visibilitychange',
    () => {
      if (document.visibilityState === 'hidden') input.hidden()
    },
    on,
  )
}

/** Keys typed into the page's own fields belong to them; the stage field's are the stage's. */
export function inField(target: EventTarget | null): target is HTMLElement {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) &&
    !isStageField(target)
  )
}

/**
 * Whether a key is an input method's: one it sends while it composes, or (Safari ends a composition
 * before the key that commits or cancels it) one that still says 229. The page's own key listeners
 * leave it to the input method as the editor does.
 */
export function composingKey(e: Pick<KeyboardEvent, 'isComposing' | 'keyCode'>) {
  return e.isComposing || e.keyCode === 229
}

/** Whether an element is the stage field, which takes the system's text for the text being edited. */
export function isStageField(target: EventTarget | null) {
  const el = target as { hasAttribute?: (name: string) => boolean } | null
  return el?.hasAttribute?.(STAGE_FIELD_MARK) === true
}

/** Whether this computer is Apple's, a Mac, an iPhone or an iPad, whose Mod is ⌘ and where Ctrl with a click is the right-click. */
export function onMac() {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
}

/** Whether an element is a control that space presses or ticks, by its tag or its role. */
export function isControl(target: EventTarget | null) {
  const el = target as { tagName?: unknown; getAttribute?: (name: string) => string | null } | null
  if (typeof el?.tagName !== 'string') return false
  return CONTROL_TAGS.has(el.tagName) || CONTROL_ROLES.has(el.getAttribute?.('role') ?? '')
}

/**
 * Whether the stage has the keys: nothing on the page has the focus, so a key reaches the page's
 * body, or the stage field has it while a text is edited. Tab walks the layers only then; anywhere
 * else it moves the focus as the browser does.
 */
export function stageHasKeys(target: EventTarget | null) {
  const el = target as { ownerDocument?: { body?: unknown } } | null
  return el === null || el.ownerDocument?.body === el || isStageField(target)
}

/**
 * The frame whose label's text, its name or its size where that shows, is under a client point, as
 * the overlay last drew the labels: the last drawn of those there. The rest of a label's row leaves
 * a press to what is under it.
 */
export function labelTextAt(overlay: ParentNode, client: Point): string | undefined {
  let found: string | undefined
  for (const label of overlay.querySelectorAll<HTMLElement>('.frame-label')) {
    const row = label.getBoundingClientRect()
    if (client.y < row.top || client.y > row.bottom) continue
    for (const text of label.children) {
      const box = text.getBoundingClientRect()
      // A size with no room beside the name wraps onto the label's hidden second line.
      if (box.top < row.bottom && client.x >= box.left && client.x <= box.right) found = label.dataset.frame
    }
  }
  return found
}

/** The section whose title is under a client point, as the overlay last drew the titles: the last drawn of those there. */
export function sectionTitleAt(overlay: ParentNode, client: Point): string | undefined {
  let found: string | undefined
  for (const title of overlay.querySelectorAll<HTMLElement>('.section-title')) {
    const box = title.getBoundingClientRect()
    if (client.x >= box.left && client.x <= box.right && client.y >= box.top && client.y <= box.bottom)
      found = title.dataset.section
  }
  return found
}

/** The popover, menu or dialog a key was pressed in, if any. */
function dialogOf(target: EventTarget | null) {
  return target instanceof Element ? target.closest('[role="dialog"], [role="menu"], dialog') : null
}

/** Whether a key is an arrow pressed in a toolbar, such as the small menu, whose arrows move the focus along it; a key event that names no key is none. */
function arrowInToolbar(e: KeyboardEvent) {
  return (
    typeof e.key === 'string' &&
    e.key.startsWith('Arrow') &&
    e.target instanceof Element &&
    e.target.closest('[role="toolbar"]') !== null
  )
}

/** Whether a key is Enter on a button, such as a small menu item reached by Tab, which Enter presses. */
function enterOnButton(e: KeyboardEvent) {
  return e.key === 'Enter' && e.target instanceof Element && e.target.closest('button') !== null
}
