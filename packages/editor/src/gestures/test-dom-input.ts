// dom-input's tests' page: its elements, the browser's pointer and key events as plain objects, and
// the page's side of the stage over a canvas and a window that keep their listeners.
import { vi } from 'vitest'

import { type DomInputDeps, editorDomInput } from './dom-input.ts'
import type { KeyInput, PointerInput } from './inputs.ts'

/** The page, whose body has the focus while nothing else does. */
export const PAGE: { body?: object } = {}
/** An element of the page with its tag, attributes and parent, which `closest` walks up from. */
export class Element {
  readonly tagName: string
  readonly isContentEditable = false
  readonly ownerDocument = PAGE
  private readonly attributes: Record<string, string>
  private readonly parent: Element | null
  constructor(tagName: string, attributes: Record<string, string> = {}, parent: Element | null = null) {
    this.tagName = tagName
    this.attributes = attributes
    this.parent = parent
  }
  getAttribute(name: string) {
    return this.attributes[name] ?? null
  }
  /** The nearest of this element and those it is in that a selector of tags and roles names. */
  closest(selector: string): Element | null {
    const named = selector.split(',').some((part) => {
      const role = /\[role="(.+)"\]/.exec(part)?.[1]
      return role ? this.attributes.role === role : part.trim().toUpperCase() === this.tagName
    })
    return named ? this : (this.parent?.closest(selector) ?? null)
  }
}
export const BODY = new Element('BODY')
PAGE.body = BODY

/** An element of the page by its tag and role, which may be one edited in place. */
export class Part {
  readonly tagName: string
  readonly role: string | null
  readonly isContentEditable: boolean
  constructor(tagName: string, role: string | null = null, isContentEditable = false) {
    this.tagName = tagName
    this.role = role
    this.isContentEditable = isContentEditable
  }
  getAttribute(name: string) {
    return name === 'role' ? this.role : null
  }
}
export const part = (...args: ConstructorParameters<typeof Part>) => new Part(...args) as unknown as EventTarget

/** A box in client pixels, as getBoundingClientRect gives it. */
export const box = (left: number, top: number, width: number, height = 20) => ({
  left,
  top,
  right: left + width,
  bottom: top + height,
  width,
  height,
})
/** The label of the frame `sq` as the overlay draws it: its row at 76 down, its name and its star (STAR) at 0–56 across. */
export const LABEL = {
  dataset: { frame: 'sq' },
  getBoundingClientRect: () => box(0, 76, 300),
  children: [{ getBoundingClientRect: () => box(0, 76, 56) }],
}

/** The star after the name in LABEL, as the overlay draws it: 12 px square, at 44 across and 80 down. */
export const STAR = {
  getAttribute: (name: string) => (name === 'data-frame' ? 'sq' : null),
  getBoundingClientRect: () => box(44, 80, 12, 12),
}

/** A mouse event of the browser at a client point, a double click's or a wheel's, which logs what is asked of it. */
export const mouseEvent = (log: string[], extra: Record<string, unknown> = {}) => ({
  clientX: 110,
  clientY: 220,
  button: 0,
  detail: 0,
  shiftKey: false,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  preventDefault: () => log.push('prevent'),
  ...extra,
})
/** A pointer event of the browser at a client point, a mouse's unless told otherwise. */
export const pointerEvent = (log: string[], extra: Record<string, unknown> = {}) => ({
  ...mouseEvent(log),
  pointerId: 7,
  pointerType: 'mouse',
  ...extra,
})
/** A key event of the browser pressed on an element, which logs what is asked of it. */
export const keyEvent = (
  log: string[],
  code: string,
  target: Element | null = BODY,
  extra: Record<string, unknown> = {},
) => ({
  type: 'keydown',
  code,
  key: code,
  shiftKey: false,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  repeat: false,
  target,
  stopped: false,
  preventDefault: () => log.push('prevent'),
  stopImmediatePropagation(this: { stopped: boolean }) {
    log.push('stop')
    this.stopped = true
  },
  ...extra,
})

/**
 * The page's side of the stage over a canvas 10 across and 20 down the page and a window that keep
 * their listeners, with an editor that keeps the inputs it is sent and answers as told.
 */
export function harness(
  answers: {
    handled?: boolean
    hold?: boolean
    escape?: boolean
    cursor?: string
    thrown?: Error
    /** Whether the window's keys are paused, as the live editor's are while a version is viewed. */
    paused?: () => boolean
  } = {},
) {
  const log: string[] = []
  const pointers: PointerInput[] = []
  const keys: KeyInput[] = []
  const escapes: KeyInput[] = []
  const onCanvas = new Map<string, (e: unknown) => void>()
  const canvasOptions = new Map<string, AddEventListenerOptions | undefined>()
  const onWindow: { type: string; listener: (e: unknown) => void; capture: boolean }[] = []
  let showCursor: (cursor: string) => void = () => {}
  const canvas = {
    style: { cursor: '' },
    addEventListener: (type: string, listener: (e: unknown) => void, options?: AddEventListenerOptions) => {
      onCanvas.set(type, listener)
      canvasOptions.set(type, options)
    },
    setPointerCapture: (id: number) => log.push(`capture ${id}`),
  }
  vi.stubGlobal('Element', Element)
  vi.stubGlobal('HTMLElement', Element)
  vi.stubGlobal('window', {
    addEventListener: (type: string, listener: (e: unknown) => void, options?: { capture?: boolean }) =>
      onWindow.push({ type, listener, capture: options?.capture ?? false }),
  })
  // The tab's visibility is dom-input-hidden.test.ts's.
  vi.stubGlobal('document', { addEventListener: () => {} })
  const deps: DomInputDeps = {
    canvas: canvas as unknown as HTMLCanvasElement,
    overlay: {
      querySelectorAll: (selector: string) => (selector === '.frame-star' ? [STAR] : [LABEL]),
    } as unknown as ParentNode,
    surface: { onStage: (client) => ({ x: client.x - 10, y: client.y - 20 }) },
    input: {
      pointer: (e) => {
        pointers.push(e)
        return { handled: answers.handled ?? false, hold: answers.hold ?? false }
      },
      key: (e) => {
        keys.push(e)
        return { handled: answers.handled ?? false, ...(answers.thrown ? { thrown: answers.thrown } : {}) }
      },
      cancelOnEscape: (e) => {
        escapes.push(e)
        return (answers.escape ?? false) && e.code === 'Escape'
      },
      text: () => false,
      deleteBackward: () => false,
      fieldText: () => null,
      fieldChanged: () => false,
      blur: () => log.push('blur'),
      hidden: () => log.push('hidden'),
      cursor: () => answers.cursor ?? '',
      onCursor: (listener) => {
        showCursor = listener
        return () => {}
      },
    },
    signal: new AbortController().signal,
    ...(answers.paused ? { paused: answers.paused } : {}),
  }
  editorDomInput(deps)
  /** Sends the canvas an event of a type, as the browser does. */
  const send = (type: string, e: unknown) => onCanvas.get(type)?.(e)
  /**
   * Sends the window an event of a type, to its listeners of that phase in the order they were
   * added, until one stops it from reaching the rest.
   */
  const hear = (type: string, e: unknown, capture = false) => {
    for (const on of onWindow) {
      if ((e as { stopped?: boolean }).stopped) return
      if (on.type === type && on.capture === capture) on.listener(e)
    }
  }
  /** Presses a key on an element as the browser does: the window hears it going down the page, then coming up. */
  const press = (code: string, target: Element | null = BODY, extra: Record<string, unknown> = {}) => {
    const e = keyEvent(log, code, target, extra)
    hear('keydown', e, true)
    hear('keydown', e)
    return keys.at(-1)
  }
  return {
    log,
    pointers,
    keys,
    escapes,
    send,
    hear,
    press,
    cursor: () => canvas.style.cursor,
    showCursor: () => showCursor,
    canvasOptions,
  }
}
