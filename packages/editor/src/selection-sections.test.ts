import { describe, expect, it } from 'vitest'

import { harness } from './test-selection.ts'

describe('editorSelection', () => {
  describe('pickSection', () => {
    it('picks a section as the one picked page item, letting the selection and the picked frame go, and shows it', () => {
      const { selection, log } = harness()
      selection.select(['rect'], 'p1-f1')
      selection.pickSection('s1')
      expect([selection.pickedSection(), selection.pickedFrame(), selection.current()]).toEqual(['s1', null, null])
      expect(selection.pickedItem()).toEqual({ kind: 'section', id: 's1' })
      selection.pickFrame('p1-f1')
      expect([selection.pickedSection(), selection.pickedFrame()]).toEqual([null, 'p1-f1'])
      selection.pickSection('s1')
      expect([selection.pickedSection(), selection.pickedFrame()]).toEqual(['s1', null])
      expect(log.filter((line) => line === 'changed').length).toBeGreaterThan(0)
    })

    it('is let go by a layer selected, a frame let go and null', () => {
      const { selection } = harness()
      selection.pickSection('s1')
      selection.select(['rect'], 'p1-f1')
      expect(selection.pickedSection()).toBeNull()
      selection.pickSection('s1')
      selection.pickFrame(null)
      expect(selection.pickedSection()).toBeNull()
      selection.pickSection('s1')
      selection.pickSection(null)
      expect(selection.pickedItem()).toBeNull()
    })

    it('goes once no frame shown is in it any more', () => {
      const { selection, world } = harness()
      selection.pickSection('s1')
      selection.keep()
      expect(selection.pickedSection()).toBe('s1')
      world.design = { ...world.design, frames: { ...world.design.frames, 'p1-f2': { pageId: 'p1' } } } as never
      selection.keep()
      expect(selection.pickedSection()).toBeNull()
    })

    it('tells the section listeners when the picked section differs from the last they heard, and the frame listeners of a frame let go', () => {
      const { selection, log } = harness()
      selection.pickFrame('p1-f1')
      selection.tellListeners()
      log.length = 0
      selection.pickSection('s1')
      selection.tellListeners()
      selection.tellListeners()
      selection.pickSection(null)
      selection.tellListeners()
      expect(log.filter((line) => line !== 'changed')).toEqual(['frame null', 'section s1', 'section null'])
    })
  })

  describe('renameSection', () => {
    it('picks the section and keeps it as the one renamed until null, or until another item is picked', () => {
      const { selection } = harness()
      selection.renameSection('s1')
      expect([selection.pickedSection(), selection.renamingSection()]).toEqual(['s1', 's1'])
      selection.renameSection(null)
      expect([selection.pickedSection(), selection.renamingSection()]).toEqual(['s1', null])
      selection.renameSection('s1')
      selection.pickFrame('p1-f1')
      expect(selection.renamingSection()).toBeNull()
      expect(selection.renamingFrame()).toBeNull()
    })
  })

  describe('held and restore', () => {
    it('put back a picked section as held', () => {
      const { selection } = harness()
      selection.pickSection('s1')
      const held = selection.held()
      selection.select(['rect'], 'p1-f1')
      selection.restore(held)
      expect([selection.current(), selection.pickedItem()]).toEqual([null, { kind: 'section', id: 's1' }])
    })
  })
})
