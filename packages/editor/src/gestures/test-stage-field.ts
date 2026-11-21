// The stage field's tests' page: a stand-in text area, window and overlay, wired as `editor.ts`
// wires them to a test core typing in the words, which replays written sequences of the browser's
// events, and a bare page whose field sends what it would to an editor that records it.
import { expect, vi } from 'vitest'

import { replaceRangeOps } from '@dazbee/doc'
import type { Point } from '@dazbee/schema'

import { WORDS } from '../test-actions.ts'
import { type TestEditor, testEditor } from '../test-editor.ts'
import { textParts } from '../text/typing-parts.ts'
import { type DomInputDeps, editorDomInput } from './dom-input.ts'
import type { PointerInput } from './inputs.ts'
import { editorStageField } from './stage-field.ts'
import { type FieldEvent, type InputMethodSequence, writtenField } from './test-input-methods.ts'
import { pointerInput } from './test-inputs.ts'

type Listener = (e: never) => void

/** What listens for events on the stand-in page: the window, the field, the overlay. */
interface Listening {
  readonly listeners: Map<string, Listener[]>
}

/** The stand-in page the field is made on: its document's focus and body, and its window; set as a test makes it. */
export const page = {
  document: { activeElement: null as unknown, body: null as unknown },
  window: { listeners: new Map() } as Listening,
}

/** An element of the stand-in page: the overlay, its parts, the stage, the page's body, a field of the page's. */
class StandIn {
  tagName = 'DIV'
  isContentEditable = false
  className = ''
  style: Record<string, string> = {}
  ownerDocument: { body: unknown } = { body: null }
  rect = { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }
  readonly listeners = new Map<string, Listener[]>()
  private readonly attributes = new Map<string, string>()
  setAttribute(name: string, value: string) {
    this.attributes.set(name, value)
  }
  getAttribute(name: string) {
    return this.attributes.get(name) ?? null
  }
  hasAttribute(name: string) {
    return this.attributes.has(name)
  }
  removeAttribute(name: string) {
    this.attributes.delete(name)
  }
  toggleAttribute(name: string, on: boolean) {
    if (on) this.attributes.set(name, '')
    else this.attributes.delete(name)
  }
  closest() {
    return null
  }
  addEventListener(type: string, listener: Listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
  }
  getBoundingClientRect() {
    return this.rect
  }
}

/** The stage field's text area: what it holds, and each time it was given a value while it mustn't be. */
class TextArea extends StandIn {
  override tagName = 'TEXTAREA'
  tabIndex = 0
  selectionStart = 0
  selectionEnd = 0
  selectionDirection: 'forward' | 'backward' | 'none' = 'none'
  /** Set while the browser composes in it, or sends it a composition event: it takes no value then. */
  closed = false
  /** Each value or selection the page gave it while it was closed. */
  readonly forced: string[] = []
  private held = ''
  get value() {
    return this.held
  }
  /** Takes a value as a browser's text area does: each line break, \r\n and \r too, as \n. */
  set value(value: string) {
    if (this.closed) this.forced.push(value)
    this.held = value.replace(/\r\n?/gu, '\n')
    this.selectionStart = this.selectionEnd = this.held.length
    this.selectionDirection = 'none'
  }
  setSelectionRange(start: number, end: number, direction: 'forward' | 'backward' | 'none' = 'none') {
    if (this.closed) this.forced.push(`${start}-${end}`)
    this.selectionStart = start
    this.selectionEnd = end
    this.selectionDirection = direction
  }
  /** What the browser leaves in it, as an input method or a key does. */
  hold(written: string) {
    const { value, start, end } = writtenField(written)
    this.held = value
    this.selectionStart = start
    this.selectionEnd = end
    this.selectionDirection = 'none'
  }
  focus() {
    page.document.activeElement = this
  }
  blur() {
    if (page.document.activeElement !== this) return
    page.document.activeElement = page.document.body
    fire(this, 'blur', { relatedTarget: null })
  }
  remove() {}
}

const editors: TestEditor[] = []

/** Calls an element's listeners of a type with an event; whether one prevented its default. */
export function fire(target: Listening, type: string, extra: Record<string, unknown> = {}) {
  let prevented = false
  const event = {
    type,
    target: page.document.activeElement,
    defaultPrevented: false,
    preventDefault() {
      prevented = true
      event.defaultPrevented = true
    },
    getModifierState: () => false,
    ...extra,
  }
  for (const listener of target.listeners.get(type) ?? []) listener(event as never)
  return prevented
}

/**
 * The stage field and the page's keys on a test core typing in the words, as `editor.ts` wires them
 * on a stand-in page: the overlay draws the text's parts as typing shows them, a design pixel to a
 * pixel; and a way to replay a written sequence.
 */
export async function typingWith(startAt: string) {
  const e = await testEditor(WORDS)
  editors.push(e)
  const body = new StandIn()
  page.document = { activeElement: body, body }
  page.window = new StandIn()
  const field = new TextArea()
  field.ownerDocument = { body }
  /** A field of the page's, as a panel's number field. */
  const pageField = Object.assign(new StandIn(), { tagName: 'INPUT' })
  const stage = new StandIn()
  stage.rect = { left: 0, top: 0, right: 4000, bottom: 4000, width: 4000, height: 4000 }
  const parts = () =>
    textParts(e.modules.typing.shown(), (el, _frame, box) => {
      ;(el as unknown as StandIn).rect = {
        left: box.x,
        top: box.y,
        right: box.x + box.width,
        bottom: box.y + box.height,
        width: box.width,
        height: box.height,
      }
    }) as unknown as StandIn[]
  const overlay = Object.assign(stage, {
    after: () => {},
    parentElement: { contains: (node: unknown) => node === stage },
    querySelector: (selector: string) => parts().find((part) => `.${part.className}` === selector) ?? null,
    querySelectorAll: (selector: string) => parts().filter((part) => `.${part.className}` === selector),
  })
  vi.stubGlobal('document', {
    ...page.document,
    get activeElement() {
      return page.document.activeElement
    },
    createElement: (tag: string) => (tag === 'textarea' ? field : new StandIn()),
    addEventListener: () => {},
  })
  vi.stubGlobal('window', page.window)
  vi.stubGlobal('Node', StandIn)
  vi.stubGlobal('Element', StandIn)
  vi.stubGlobal('HTMLElement', StandIn)
  vi.stubGlobal('requestAnimationFrame', () => 0)
  const signal = new AbortController().signal
  const stageField = editorStageField({
    overlay: overlay as unknown as HTMLElement,
    input: e.core.input,
    editing: e.modules.typing.editing,
    onTextSelection: e.core.onTextSelection,
    label: 'Text',
    signal,
  })
  editorDomInput({
    canvas: { style: { cursor: '' }, addEventListener: () => {} } as unknown as DomInputDeps['canvas'],
    overlay: overlay as unknown as ParentNode,
    surface: { onStage: (client) => client },
    input: e.core.input,
    composing: stageField.composing,
    keyTaken: stageField.keyTaken,
    signal,
  })
  const { value, start, end } = writtenField(startAt)
  for (const op of replaceRangeOps(words(), 0, words().length, value))
    e.core.session.run('text.edit', { id: 'words', op })
  e.core.select(['words'])
  e.press('goIn')
  e.modules.typing.selectText({ start, end })

  /** A written event whose field holds what stands in place of the selected range, with the text around it the field holds. */
  function around(event: FieldEvent): FieldEvent {
    return { ...event, field: `${value.slice(0, start)}${event.field}${value.slice(end)}` }
  }
  /** Sends one written event as the browser does: what it changes is in the field as it fires. */
  function send(event: FieldEvent) {
    const { type, field: written, prevented, ...rest } = event
    if (type === 'frame') {
      frame()
      expect(fieldNow(), 'the field after a frame').toBe(written)
      return
    }
    if (type === 'input' || type === 'compositionend' || type === 'blur' || type === 'selectionchange')
      field.hold(written)
    else expect(fieldNow(), `the field before ${type} ${event.data ?? event.key ?? ''}`).toBe(written)
    // The browser composes from its compositionstart to its compositionend, a blur between or not.
    if (type === 'compositionstart') field.closed = true
    let taken = false
    if (type === 'keydown' || type === 'keyup') taken = fire(page.window, type, { ...rest, target: field })
    else if (type === 'blur') field.blur()
    else taken = fire(field, type, rest)
    if (type === 'compositionend') field.closed = false
    if (type === 'keydown' || type === 'beforeinput')
      expect(taken, `${type} ${rest.key ?? rest.inputType}`).toBe(!!prevented)
  }
  /** What the field holds, as a written event writes it. */
  function fieldNow() {
    const { value: now, selectionStart: from, selectionEnd: to } = field
    if (from === to) return `${now.slice(0, from)}|${now.slice(from)}`
    return `${now.slice(0, from)}[${now.slice(from, to)}]${now.slice(to)}`
  }
  /** The words as the design holds them. */
  function words() {
    return (e.core.design().nodes.words?.props as { text: string }).text
  }
  /** The words and their caret, `|`, or selected range, in `[` `]`; a caret is found by typing `|` at it. */
  function typed() {
    const selected = e.modules.typing.selectedText()
    if (selected) {
      const text = words()
      const { start: from, end: to } = selected.range
      return `${text.slice(0, from)}[${text.slice(from, to)}]${text.slice(to)}`
    }
    e.keys.press('|')
    return words()
  }
  /** Draws, as the next frame does, and places the field after the overlay. */
  function frame() {
    e.core.redraw()
    stageField.place()
  }
  /**
   * Sends the core a touch's pointer input at a stage point, the frame drawn before it as the page
   * draws between events, so what the input does is all that happens after it.
   */
  function touchInput(type: PointerInput['type'], at: Point, detail = 0) {
    e.core.redraw()
    e.core.input.pointer(pointerInput({ type, at, detail, pointerType: 'touch' }))
  }
  /**
   * Touches the stage as a phone's browser sends it: `count` taps at a stage point, each press heard
   * by the window first, then its release and its click, which the window hears after the canvas,
   * and after the second the double click; a tap given `to` drags there before its release.
   */
  function touch(at: Point, { count = 1, to = at }: { count?: number; to?: Point } = {}) {
    for (let n = 1; n <= count; n++) {
      fire(page.window, 'pointerdown', { pointerType: 'touch', target: stage })
      touchInput('pointerdown', at)
      if (to !== at) touchInput('pointermove', to)
      touchInput('pointerup', to)
      touchInput('click', to, n)
      fire(page.window, 'click', { target: stage })
      if (n === 2) touchInput('dblclick', to, 2)
    }
  }
  /** Presses a key with nothing held, on the page with nothing focused on it, as the window hears it. */
  function pressKey(code: string) {
    const key = { key: code, code, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, target: null }
    fire(page.window, 'keydown', key)
    fire(page.window, 'keyup', key)
  }
  /** Where the focus is: in the stage field, on the page's body, in the page's field, or elsewhere. */
  function focused() {
    const at = page.document.activeElement
    return at === field ? 'stage field' : at === body ? 'body' : at === pageField ? 'page field' : 'elsewhere'
  }
  /** Replays a written sequence, a frame drawn after each key comes up and at its end. */
  function replay(sequence: InputMethodSequence) {
    for (const event of sequence.events) {
      send(sequence.whole ? event : around(event))
      if (event.type === 'keyup') frame()
    }
    frame()
  }
  return {
    e,
    field,
    pageField,
    overlay,
    stageField,
    send,
    around,
    frame,
    replay,
    touch,
    pressKey,
    focused,
    words,
    typed,
    fieldNow,
  }
}

/** A stage field on a page of stand-ins; what it sends the editor, and a way to fire its events. */
export function bareField() {
  const listeners = new Map<string, (e: unknown) => void>()
  const element = {
    style: {},
    value: '',
    setAttribute: () => {},
    toggleAttribute: () => {},
    removeAttribute: () => {},
    focus: () => {},
    blur: () => {},
    remove: () => {},
    addEventListener: (type: string, listener: (e: unknown) => void) => listeners.set(type, listener),
  }
  vi.stubGlobal('document', { createElement: () => element, activeElement: element })
  vi.stubGlobal('window', { addEventListener: () => {} })
  const sent: string[] = []
  editorStageField({
    overlay: { after: () => {} } as unknown as HTMLElement,
    input: {
      deleteBackward: () => sent.push('delete back') > 0,
      fieldText: () => null,
      fieldChanged: (state, composing) => sent.push(`changed ${state.value} ${composing}`) > 0,
    },
    editing: () => ({ id: 'words', frameId: 'sq' }),
    onTextSelection: () => () => {},
    label: 'Text',
    signal: new AbortController().signal,
  })
  /** Fires an event of the field's; whether its default was prevented. */
  const fireOn = (type: string, extra: Record<string, unknown> = {}) => {
    let prevented = false
    listeners.get(type)?.({ preventDefault: () => (prevented = true), ...extra })
    return prevented
  }
  return { sent, fire: fireOn }
}

/** Ends each test core the stand-in pages were made on, and puts the page's globals back. */
export function endStandIns() {
  vi.unstubAllGlobals()
  for (const e of editors.splice(0)) e.end()
}
