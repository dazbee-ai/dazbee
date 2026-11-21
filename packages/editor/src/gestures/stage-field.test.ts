// The stage field sends what changes in it to the text being edited: each input method's written
// sequence, replayed through a stand-in field and window on a test core, types its commit once,
// the field is never given text while composing, and it stands at the overlay's caret.
import { afterEach, describe, expect, it, vi } from 'vitest'

import { WORDS } from '../test-actions.ts'
import { type TestEditor, testEditor } from '../test-editor.ts'
import { textParts } from '../text/typing-parts.ts'
import { editorDomInput } from './dom-input.ts'
import { editorStageField } from './stage-field.ts'
import {
  type FieldEvent,
  INPUT_METHOD_SEQUENCES,
  type InputMethodSequence,
  JAPANESE_ESCAPE_CHROME_WINDOWS,
  markedField,
  PINYIN_CHROME_WINDOWS,
} from './test-input-methods.ts'

type Listener = (e: never) => void

/** What listens for events on the stand-in page: the window, the field, the overlay. */
interface Listening {
  readonly listeners: Map<string, Listener[]>
}

/** The stand-in page the field is made on: its document's focus and body, and its window; set as a test makes it. */
const page = {
  document: { activeElement: null as unknown, body: null as unknown },
  window: { listeners: new Map() } as Listening,
}

/** An element of the stand-in page: the overlay, its parts, the stage, the page's body. */
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
  /** Set while the browser composes in it, or sends it a composition event: it takes no value then. */
  closed = false
  /** Each value or selection the page gave it while it was closed. */
  readonly forced: string[] = []
  private held = ''
  get value() {
    return this.held
  }
  set value(value: string) {
    if (this.closed) this.forced.push(value)
    this.held = value
    this.selectionStart = this.selectionEnd = value.length
  }
  setSelectionRange(start: number, end: number) {
    if (this.closed) this.forced.push(`${start}-${end}`)
    this.selectionStart = start
    this.selectionEnd = end
  }
  /** What the browser leaves in it, as an input method or a key does. */
  hold(marked: string) {
    const { value, start, end } = markedField(marked)
    this.held = value
    this.selectionStart = start
    this.selectionEnd = end
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

afterEach(() => {
  vi.unstubAllGlobals()
  for (const e of editors.splice(0)) e.end()
})

/** Calls an element's listeners of a type with an event; whether one prevented its default. */
function fire(target: Listening, type: string, extra: Record<string, unknown> = {}) {
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
async function typingWith(startAt: string) {
  const e = await testEditor(WORDS)
  editors.push(e)
  const body = new StandIn()
  page.document = { activeElement: body, body }
  page.window = new StandIn()
  const field = new TextArea()
  field.ownerDocument = { body }
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
    editing: () => e.modules.typing.editing() !== null,
    onTextSelection: e.core.onTextSelection,
    label: 'Text',
    signal,
  })
  editorDomInput({
    canvas: { style: { cursor: '' }, addEventListener: () => {} } as unknown as HTMLCanvasElement,
    overlay: overlay as unknown as ParentNode,
    surface: { onStage: (client) => client },
    input: e.core.input,
    composing: stageField.composing,
    keyTaken: stageField.keyTaken,
    signal,
  })
  const { value, start, end } = markedField(startAt)
  if (value !== 'Hello there') throw new Error(`the words are not ${value}`)
  e.core.select(['words'])
  e.press('goIn')
  e.modules.typing.selectText({ start, end })

  /** Sends one written event as the browser does: what it changes is in the field as it fires. */
  function send(event: FieldEvent) {
    const { type, field: marked, prevented, ...rest } = event
    const composition = type.startsWith('composition')
    if (type === 'input' || type === 'compositionend' || type === 'blur') field.hold(marked)
    else expect(fieldNow(), `the field before ${type} ${event.data ?? event.key ?? ''}`).toBe(marked)
    if (composition) field.closed = true
    let taken = false
    if (type === 'keydown' || type === 'keyup') taken = fire(page.window, type, { ...rest, target: field })
    else if (type === 'blur') field.blur()
    else taken = fire(field, type, rest)
    if (type === 'compositionend' || type === 'blur') field.closed = false
    else if (composition) field.closed = stageField.composing()
    if (type === 'keydown' || type === 'beforeinput')
      expect(taken, `${type} ${rest.key ?? rest.inputType}`).toBe(!!prevented)
  }
  /** What the field holds, marked as a written event marks it. */
  function fieldNow() {
    const { value: now, selectionStart: from, selectionEnd: to } = field
    if (from === to) return `${now.slice(0, from)}|${now.slice(from)}`
    return `${now.slice(0, from)}[${now.slice(from, to)}]${now.slice(to)}`
  }
  /** The words and their caret, `|`, or selected range, in `[` `]`; a caret is found by typing `|` at it. */
  function typed() {
    const selected = e.modules.typing.selectedText()
    const text = () => (e.core.design().nodes.words?.props as { text: string }).text
    if (selected) {
      const words = text()
      const { start: from, end: to } = selected.range
      return `${words.slice(0, from)}[${words.slice(from, to)}]${words.slice(to)}`
    }
    e.keys.press('|')
    return text()
  }
  /** Draws, as the next frame does, and places the field after the overlay. */
  function frame() {
    e.core.redraw()
    stageField.place()
  }
  /** Replays a written sequence, a frame drawn after each key comes up and at its end. */
  function replay(sequence: InputMethodSequence) {
    for (const event of sequence.events) {
      send(event)
      if (event.type === 'keyup') frame()
    }
    frame()
  }
  return { e, field, overlay, stageField, send, replay, typed, fieldNow }
}

describe('editorStageField', () => {
  for (const sequence of INPUT_METHOD_SEQUENCES) {
    it(`types ${sequence.name} once, and gives the field no text while composing`, async () => {
      const { field, replay, typed } = await typingWith(sequence.start)
      replay(sequence)
      expect(field.forced).toEqual([])
      expect(typed()).toBe(sequence.typed)
    })
  }

  it('makes one undo step of what an input method typed, and redoes it', async () => {
    const { e, replay } = await typingWith(PINYIN_CHROME_WINDOWS.start)
    replay(PINYIN_CHROME_WINDOWS)
    e.core.stopEditing()
    e.core.session.undo()
    expect((e.core.design().nodes.words?.props as { text: string }).text).toBe('Hello there')
    e.core.session.redo()
    expect((e.core.design().nodes.words?.props as { text: string }).text).toBe('Hello there你好')
  })

  it('holds the selected text as typing starts, and the caret alone once a key moves it', async () => {
    const { e, fieldNow } = await typingWith('Hello [there]')
    expect(fieldNow()).toBe('[there]')
    e.keys.press('ArrowLeft')
    expect(fieldNow()).toBe('|')
  })

  it('keeps what an input method committed, which the text holds at its place, for the next composition', async () => {
    const { replay, fieldNow } = await typingWith(PINYIN_CHROME_WINDOWS.start)
    replay(PINYIN_CHROME_WINDOWS)
    expect(fieldNow()).toBe('你好|')
  })

  it('is given the selected word back once the input method cancels over it', async () => {
    const { replay, fieldNow } = await typingWith(JAPANESE_ESCAPE_CHROME_WINDOWS.start)
    replay(JAPANESE_ESCAPE_CHROME_WINDOWS)
    expect(fieldNow()).toBe('[there]')
  })

  it('stands at the caret the overlay draws inside the composition, at the caret’s height', async () => {
    const { e, field, send, stageField } = await typingWith('Hello there|')
    const before = e.modules.typing.shown()?.caret
    for (const event of PINYIN_CHROME_WINDOWS.events.slice(0, 18)) send(event)
    e.core.redraw()
    stageField.place()
    const caret = e.modules.typing.shown()?.caret
    if (!before || !caret) throw new Error('no caret shown')
    expect(caret.x).toBeGreaterThan(before.x)
    expect(field.style).toMatchObject({
      left: `${caret.x}px`,
      top: `${caret.y}px`,
      height: `${caret.height}px`,
      fontSize: `${caret.height * 0.8}px`,
    })
  })

  it('deletes back once in the text for a delete that came with no key, and nothing while composing', async () => {
    const { send, typed } = await typingWith('Hello there|')
    send({ type: 'beforeinput', inputType: 'deleteContentBackward', data: null, field: '|', prevented: true })
    send({ type: 'compositionstart', data: '', field: '|' })
    send({ type: 'beforeinput', inputType: 'deleteContentBackward', data: null, field: '|', prevented: true })
    send({ type: 'compositionend', data: '', field: '|' })
    expect(typed()).toBe('Hello ther|')
  })

  it('cancels the browser’s own undo and redo, which change nothing', async () => {
    const { send, typed } = await typingWith('Hello there|')
    send({ type: 'beforeinput', inputType: 'insertText', data: '!', field: '|' })
    send({ type: 'input', inputType: 'insertText', data: '!', field: '!|' })
    send({ type: 'beforeinput', inputType: 'historyUndo', data: null, field: '!|', prevented: true })
    send({ type: 'beforeinput', inputType: 'historyRedo', data: null, field: '!|', prevented: true })
    expect(typed()).toBe('Hello there!|')
  })

  it('commits the composition where it was composed before a press on the stage moves the caret', async () => {
    const { field, overlay, send, typed } = await typingWith('Hello there|')
    for (const event of PINYIN_CHROME_WINDOWS.events.slice(0, 12)) send(event)
    fire(page.window, 'pointerdown', { pointerType: 'mouse', target: overlay })
    expect(field.forced).toEqual([])
    expect(page.document.activeElement).toBe(field)
    expect(typed()).toBe('Hello thereni|')
  })
})

describe('editorStageField on a bare page', () => {
  /** A stage field on a page of stand-ins; what it sends the editor, and a way to fire its events. */
  function bareField() {
    const listeners = new Map<string, (e: unknown) => void>()
    const element = {
      style: {},
      value: '',
      setAttribute: () => {},
      toggleAttribute: () => {},
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
      editing: () => true,
      onTextSelection: () => () => {},
      label: 'Text',
      signal: new AbortController().signal,
    })
    /** Fires an event of the field's; whether its default was prevented. */
    const fire = (type: string, extra: Record<string, unknown> = {}) => {
      let prevented = false
      listeners.get(type)?.({ preventDefault: () => (prevented = true), ...extra })
      return prevented
    }
    return { sent, fire }
  }

  it('deletes back in the text being edited for a delete that came with no key, and puts nothing in the field', () => {
    const { sent, fire } = bareField()
    expect(fire('beforeinput', { inputType: 'deleteContentBackward' })).toBe(true)
    expect(sent).toEqual(['delete back'])
  })

  it('deletes nothing while an input method composes', () => {
    const { sent, fire } = bareField()
    fire('compositionstart')
    expect(fire('beforeinput', { inputType: 'deleteContentBackward' })).toBe(true)
    expect(sent).toEqual([])
  })
})
