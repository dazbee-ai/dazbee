import { describe, expect, it } from 'vitest'

import { pairsIn } from '../selection.ts'
import { event, harness, sceneLayer } from './test-pointer.ts'

describe('editorDoubleClick', () => {
  describe('dblclick', () => {
    it('asks to rename the frame on a double click, unless panning', () => {
      const { send, log } = harness()
      send('dblclick', event(20, -10))
      expect(log).toEqual(['rename one-sq'])
      const panning = harness('hand')
      panning.send('dblclick', event(20, -10))
      expect(panning.log).toEqual([])
    })

    it("does nothing on the star by a frame's name, whose presses star the frame", () => {
      const { selection, send, log } = harness('select', sceneLayer('words', 'text'))
      send('dblclick', event(10, 10, { star: 'one-sq' }))
      expect(selection.current()).toBeNull()
      expect(log).toEqual([])
    })

    it('starts typing into the text under the pointer, selecting it', () => {
      const { selection, send, log } = harness('select', sceneLayer('words', 'text'))
      send('dblclick', event(10, 10))
      expect(selection.current()).toEqual(pairsIn('one-sq', ['words']))
      expect(log).toEqual(['type into words in one-sq', 'shown changed'])
    })

    it('does nothing while panning', () => {
      const { pointer, selection, send, log } = harness('hand', sceneLayer('words', 'text'))
      send('dblclick', event(10, 10))
      expect(selection.current()).toBeNull()
      expect(pointer.gesture()).toBeNull()
      expect(log).toEqual([])
    })
  })
})
