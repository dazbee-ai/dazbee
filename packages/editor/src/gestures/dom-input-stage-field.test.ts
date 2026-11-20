// The stage field (`stage-field.ts`) has the stage's keys, and is no field of the page's; a key
// pressed while an input method composes says so, and so does AltGr.
import { afterEach, describe, expect, it, vi } from 'vitest'

import { composingKey, editorDomInput, inField, isStageField, STAGE_FIELD_MARK, stageHasKeys } from './dom-input.ts'
import type { KeyInput } from './inputs.ts'

afterEach(() => {
  vi.unstubAllGlobals()
})

/** A text area of the page; the stage field when marked. */
class TextArea {
  readonly tagName = 'TEXTAREA'
  readonly isContentEditable = false
  readonly ownerDocument = { body: {} }
  private readonly marked: boolean
  constructor(marked: boolean) {
    this.marked = marked
  }
  hasAttribute(name: string) {
    return this.marked && name === STAGE_FIELD_MARK
  }
  getAttribute() {
    return null
  }
  closest() {
    return null
  }
}

describe('the stage field', () => {
  it('has the stage’s keys, and is no field of the page’s', () => {
    vi.stubGlobal('HTMLElement', TextArea)
    const field = new TextArea(true) as unknown as EventTarget
    const other = new TextArea(false) as unknown as EventTarget
    expect([isStageField(field), stageHasKeys(field), inField(field)]).toEqual([true, true, false])
    expect([isStageField(other), stageHasKeys(other), inField(other)]).toEqual([false, false, true])
  })
})

describe('a key while an input method composes', () => {
  /**
   * Key inputs the editor is given for key events, with the stage field composing as `composing`
   * says and the editor taking each key as `handled` says; how many keys it was told it took.
   */
  function keys(composing: () => boolean, handled = false) {
    const taken = { count: 0 }
    const heard: [string, (e: unknown) => void][] = []
    vi.stubGlobal('window', {
      addEventListener: (type: string, listener: (e: unknown) => void) => heard.push([type, listener]),
    })
    vi.stubGlobal('document', { addEventListener: () => {} })
    vi.stubGlobal('Element', TextArea)
    vi.stubGlobal('HTMLElement', TextArea)
    const given: KeyInput[] = []
    editorDomInput({
      canvas: { style: { cursor: '' }, addEventListener: () => {} } as unknown as HTMLCanvasElement,
      overlay: { querySelectorAll: () => [] } as unknown as ParentNode,
      surface: { onStage: (client) => client },
      input: {
        pointer: () => ({ handled: false, hold: false }),
        key: (e) => {
          given.push(e)
          return { handled }
        },
        text: () => false,
        deleteBackward: () => false,
        cancelOnEscape: () => false,
        blur: () => {},
        hidden: () => {},
        cursor: () => '',
        onCursor: () => () => {},
      },
      composing,
      keyTaken: () => taken.count++,
      signal: new AbortController().signal,
    })
    const press = (extra: Record<string, unknown>) => {
      const event = {
        code: 'KeyA',
        key: 'a',
        shiftKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        repeat: false,
        isComposing: false,
        keyCode: 65,
        target: null,
        defaultPrevented: false,
        getModifierState: (key: string) => key === 'AltGraph' && extra.altGraph === true,
        preventDefault() {
          this.defaultPrevented = true
        },
        ...extra,
      }
      for (const [type, listener] of heard) if (type === 'keydown') listener(event)
    }
    return { given, press, taken }
  }

  it('says it composes by the event, by Safari’s 229 after the composition ended, or by the stage field it was pressed in', () => {
    vi.stubGlobal('HTMLElement', TextArea)
    let fieldComposing = false
    const { given, press } = keys(() => fieldComposing)
    press({})
    press({ isComposing: true })
    press({ key: 'Enter', keyCode: 229 })
    fieldComposing = true
    press({ target: new TextArea(true) })
    // A key elsewhere, with the field left composing by a browser that sent no end.
    press({})
    expect(given.map((e) => e.composing)).toEqual([false, true, true, true, false])
    expect([
      composingKey({ isComposing: false, keyCode: 229 }),
      composingKey({ isComposing: false, keyCode: 27 }),
    ]).toEqual([true, false])
  })

  it('tells the stage field of a key the editor took that nothing on the page took first', () => {
    const { press, taken } = keys(() => false, true)
    press({})
    press({ key: 'ArrowRight', defaultPrevented: true })
    expect(taken.count).toBe(1)
    const ignored = keys(() => false, false)
    ignored.press({})
    expect(ignored.taken.count).toBe(0)
  })

  it('says AltGr is down, which Chrome on Windows sends with Ctrl and Alt', () => {
    const { given, press } = keys(() => false)
    press({ key: '@', ctrlKey: true, altKey: true, altGraph: true })
    press({ key: 'a', ctrlKey: true })
    expect(given.map((e) => e.altGraph)).toEqual([true, false])
  })
})
