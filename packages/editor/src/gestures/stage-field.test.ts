// The stage field sends a delete that came with no key, as an input method or a phone's keyboard
// sends Backspace, to the text being edited, and none while an input method composes.
import { afterEach, describe, expect, it, vi } from 'vitest'

import { editorStageField } from './stage-field.ts'

afterEach(() => {
  vi.unstubAllGlobals()
})

/** A stage field on a page of stand-ins; what it sends the editor, and a way to fire its events. */
function field() {
  const listeners = new Map<string, (e: unknown) => void>()
  const element = {
    style: {},
    value: '',
    scrollWidth: 0,
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
      text: (text) => sent.push(`text ${text}`) > 0,
      deleteBackward: () => sent.push('delete back') > 0,
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

describe('editorStageField', () => {
  it('deletes back in the text being edited for a delete that came with no key, and puts nothing in the field', () => {
    const { sent, fire } = field()
    expect(fire('beforeinput', { inputType: 'deleteContentBackward' })).toBe(true)
    expect(sent).toEqual(['delete back'])
  })

  it('deletes nothing while an input method composes', () => {
    const { sent, fire } = field()
    fire('compositionstart')
    expect(fire('beforeinput', { inputType: 'deleteContentBackward' })).toBe(true)
    expect(sent).toEqual([])
  })
})
