// The stage field sends what changes in it to the text being edited: each input method's written
// sequence, replayed through a stand-in field and window on a test core, types its commit once,
// the field is never given text while composing, and it stands at the overlay's caret.
import { afterEach, describe, expect, it, vi } from 'vitest'

import { replaceRangeOps } from '@dazbee/doc'

import { WORDS } from '../test-actions.ts'
import { type TestEditor, testEditor } from '../test-editor.ts'
import { textParts } from '../text/typing-parts.ts'
import { editorDomInput } from './dom-input.ts'
import { editorStageField } from './stage-field.ts'
import {
  type FieldEvent,
  GBOARD_REOPEN,
  GBOARD_SPACE_CURSOR,
  INPUT_METHOD_SEQUENCES,
  type InputMethodSequence,
  IOS_AUTOCORRECT,
  JAPANESE_ESCAPE_CHROME_WINDOWS,
  PINYIN_CHROME_WINDOWS,
  writtenField,
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
  selectionDirection: 'forward' | 'backward' | 'none' = 'none'
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
  /** Replays a written sequence, a frame drawn after each key comes up and at its end. */
  function replay(sequence: InputMethodSequence) {
    for (const event of sequence.events) {
      send(sequence.whole ? event : around(event))
      if (event.type === 'keyup') frame()
    }
    frame()
  }
  return { e, field, overlay, stageField, send, around, frame, replay, words, typed, fieldNow }
}

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
  const fireOn = (type: string, extra: Record<string, unknown> = {}) => {
    let prevented = false
    listeners.get(type)?.({ preventDefault: () => (prevented = true), ...extra })
    return prevented
  }
  return { sent, fire: fireOn }
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
    const { e, replay, words } = await typingWith(PINYIN_CHROME_WINDOWS.start)
    replay(PINYIN_CHROME_WINDOWS)
    e.core.stopEditing()
    e.core.session.undo()
    expect(words()).toBe('Hello there')
    e.core.session.redo()
    expect(words()).toBe('Hello there你好')
  })

  it('holds the text around the selected range as typing starts, and moves its selection with a key', async () => {
    const { e, fieldNow } = await typingWith('Hello [there]')
    expect(fieldNow()).toBe('Hello [there]')
    e.keys.press('ArrowLeft')
    expect(fieldNow()).toBe('Hello |there')
  })

  it('keeps what an input method committed, which the text holds at its place, for the next composition', async () => {
    const { replay, fieldNow } = await typingWith(PINYIN_CHROME_WINDOWS.start)
    replay(PINYIN_CHROME_WINDOWS)
    expect(fieldNow()).toBe('Hello there你好|')
  })

  it('is given the selected word back once the input method cancels over it', async () => {
    const { replay, fieldNow } = await typingWith(JAPANESE_ESCAPE_CHROME_WINDOWS.start)
    replay(JAPANESE_ESCAPE_CHROME_WINDOWS)
    expect(fieldNow()).toBe('Hello [there]')
  })

  it('stands at the caret the overlay draws inside the composition, at the caret’s height', async () => {
    const { e, field, send, around, frame } = await typingWith('Hello there|')
    // "ni hao" composed, the input method's cursor at its end, then moved back one letter inside it.
    for (const event of PINYIN_CHROME_WINDOWS.events.slice(0, 26)) send(around(event))
    frame()
    const atEnd = e.modules.typing.shown()?.caret
    const composed = 'Hello thereni hao|'
    send({ type: 'keydown', key: 'Process', code: 'ArrowLeft', keyCode: 229, isComposing: true, field: composed })
    send({
      type: 'beforeinput',
      inputType: 'insertCompositionText',
      data: 'ni hao',
      isComposing: true,
      field: composed,
    })
    send({ type: 'compositionupdate', data: 'ni hao', field: composed })
    send({
      type: 'input',
      inputType: 'insertCompositionText',
      data: 'ni hao',
      isComposing: true,
      field: 'Hello thereni ha|o',
    })
    frame()
    const caret = e.modules.typing.shown()?.caret
    if (!atEnd || !caret) throw new Error('no caret shown')
    expect(caret.x).toBeLessThan(atEnd.x)
    expect(field.style).toMatchObject({
      left: `${caret.x}px`,
      top: `${caret.y}px`,
      height: `${caret.height}px`,
      fontSize: `${caret.height * 0.8}px`,
    })
  })

  it('deletes back once in the text for a delete that came with no key, and nothing while composing', async () => {
    const { send, typed } = await typingWith('Hello there|')
    const deleted = { inputType: 'deleteContentBackward', data: null, cancelable: true, prevented: true } as const
    send({ type: 'beforeinput', ...deleted, field: 'Hello there|' })
    send({ type: 'compositionstart', data: '', field: 'Hello ther|' })
    send({ type: 'beforeinput', ...deleted, field: 'Hello ther|' })
    send({ type: 'compositionend', data: '', field: 'Hello ther|' })
    expect(typed()).toBe('Hello ther|')
  })

  it('reads a delete the browser makes anyway from the field, once', async () => {
    const { send, typed } = await typingWith('Hello [there]')
    const deleted = { inputType: 'deleteContentBackward', data: null } as const
    send({ type: 'beforeinput', ...deleted, cancelable: false, field: 'Hello [there]' })
    send({ type: 'input', ...deleted, field: 'Hello |' })
    expect(typed()).toBe('Hello |')
  })

  it('cancels the browser’s own undo and redo, and gives the field its text again after one made anyway', async () => {
    const { send, frame, typed, fieldNow } = await typingWith('Hello [there]')
    send({ type: 'beforeinput', inputType: 'insertText', data: '!', cancelable: true, field: 'Hello [there]' })
    send({ type: 'input', inputType: 'insertText', data: '!', field: 'Hello !|' })
    const undo = { inputType: 'historyUndo', data: null, cancelable: true, prevented: true } as const
    send({ type: 'beforeinput', ...undo, field: 'Hello !|' })
    send({ type: 'beforeinput', ...undo, inputType: 'historyRedo', field: 'Hello !|' })
    send({ type: 'input', inputType: 'historyUndo', data: null, field: 'Hello [there]' })
    frame()
    expect(fieldNow()).toBe('Hello !|')
    expect(typed()).toBe('Hello !|')
  })

  it('commits the composition where it was composed before a press on the stage moves the caret', async () => {
    const { field, overlay, send, around, typed } = await typingWith('Hello there|')
    for (const event of PINYIN_CHROME_WINDOWS.events.slice(0, 12)) send(around(event))
    fire(page.window, 'pointerdown', { pointerType: 'mouse', target: overlay })
    expect(field.forced).toEqual([])
    expect(page.document.activeElement).toBe(field)
    expect(typed()).toBe('Hello thereni|')
  })

  it('keeps a bold word bold when the iPhone’s keyboard corrects it', async () => {
    const { e, replay, words } = await typingWith(IOS_AUTOCORRECT.start)
    e.modules.typing.styleRange({ id: 'words', range: { start: 6, end: 9 } }, { fontWeight: 700 })
    replay(IOS_AUTOCORRECT)
    expect(words()).toBe('Hello the ')
    expect((e.core.design().nodes.words?.props as { runs: unknown[] }).runs).toEqual([
      { start: 6, end: 10, style: { fontWeight: 700 } },
    ])
  })

  it('composes over the word a keyboard re-opens once no input follows in its task, and not before', async () => {
    const { e, send } = await typingWith(GBOARD_REOPEN.start)
    const reopened = GBOARD_REOPEN.events.findIndex((event) => event.type === 'frame')
    for (const event of GBOARD_REOPEN.events.slice(0, reopened)) send(event)
    expect(e.modules.typing.composition().composed).toBeNull()
    send(GBOARD_REOPEN.events[reopened] as FieldEvent)
    expect(e.modules.typing.composition().composed?.layer.props).toMatchObject({ text: 'Hello there' })
    expect(e.modules.typing.shown()?.composition).toHaveLength(1)
  })

  it('moves the text’s caret with the keyboard’s space-bar cursor, and writes nothing', async () => {
    const { e, replay } = await typingWith(GBOARD_SPACE_CURSOR.start)
    const design = e.core.session.design()
    replay(GBOARD_SPACE_CURSOR)
    expect(e.core.session.design()).toBe(design)
  })

  it('moves the field’s selection with an arrow key typing takes, and sends nothing back', async () => {
    const { e, field, fieldNow } = await typingWith('Hello there|')
    const sent = vi.spyOn(e.core.input, 'fieldChanged')
    const given = field.value
    e.keys.press('ArrowLeft')
    expect(fieldNow()).toBe('Hello ther|e')
    fire(field, 'selectionchange')
    expect(field.value).toBe(given)
    expect(sent).not.toHaveBeenCalled()
  })

  it('keeps a selection made with Shift running backward, in the field and in the text', async () => {
    const { e, field, frame, typed } = await typingWith('Hello there|')
    e.keys.press('Shift+ArrowLeft')
    e.keys.press('Shift+ArrowLeft')
    expect(field.selectionDirection).toBe('backward')
    fire(field, 'selectionchange')
    frame()
    e.keys.press('Shift+ArrowLeft')
    expect([field.selectionStart, field.selectionEnd, field.selectionDirection]).toEqual([8, 11, 'backward'])
    expect(typed()).toBe('Hello th[ere]')
  })

  it('still takes a Hindi vowel sign alone for a delete that came with no key', async () => {
    const { send, typed } = await typingWith('Hello नमस्ते|')
    const deleted = { inputType: 'deleteContentBackward', data: null, cancelable: true, prevented: true } as const
    send({ type: 'beforeinput', ...deleted, field: 'Hello नमस्ते|' })
    expect(typed()).toBe('Hello नमस्त|')
  })

  it('deletes back in the text being edited for a delete that came with no key, and puts nothing in the field, on a bare page', () => {
    const { sent, fire } = bareField()
    expect(fire('beforeinput', { inputType: 'deleteContentBackward', cancelable: true })).toBe(true)
    expect(sent).toEqual(['delete back'])
  })

  it('deletes nothing while an input method composes, on a bare page', () => {
    const { sent, fire } = bareField()
    fire('compositionstart')
    expect(fire('beforeinput', { inputType: 'deleteContentBackward', cancelable: true })).toBe(true)
    expect(sent).toEqual([])
  })
})
