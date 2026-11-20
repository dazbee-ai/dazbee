// A hidden tab tells the editor, which ends the typing step open (C47).
import { afterEach, expect, it, vi } from 'vitest'

import { editorDomInput } from './dom-input.ts'

afterEach(() => {
  vi.unstubAllGlobals()
})

it('tells the editor when the page is hidden, and not when it shows again', () => {
  const told: string[] = []
  const page = {
    visibilityState: 'visible',
    listeners: new Map<string, () => void>(),
    addEventListener(type: string, listener: () => void) {
      this.listeners.set(type, listener)
    },
  }
  vi.stubGlobal('document', page)
  vi.stubGlobal('window', { addEventListener: () => {} })
  editorDomInput({
    canvas: { style: { cursor: '' }, addEventListener: () => {} } as unknown as HTMLCanvasElement,
    overlay: { querySelectorAll: () => [] } as unknown as ParentNode,
    surface: { onStage: (client) => client },
    input: {
      pointer: () => ({ handled: false, hold: false }),
      key: () => ({ handled: false }),
      text: () => false,

      deleteBackward: () => false,
      cancelOnEscape: () => false,
      blur: () => {},
      hidden: () => told.push('hidden'),
      cursor: () => '',
      onCursor: () => () => {},
    },
    signal: new AbortController().signal,
  })
  const show = (state: 'visible' | 'hidden') => {
    page.visibilityState = state
    page.listeners.get('visibilitychange')?.()
  }
  show('hidden')
  show('visible')
  expect(told).toEqual(['hidden'])
})
