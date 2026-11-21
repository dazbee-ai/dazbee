// Where an agent shows as it works: what a step changed, the presence that shows it, and its note.
import { describe, expect, it } from 'vitest'

import { testDesign } from '@dazbee/doc/test-design'
import { type Design, PRESENCE_NOTE, type Rect } from '@dazbee/schema'

import { agentPresence, held, noteOf, workedOn } from './agent-presence.ts'
import { sessionOf } from './layers/test-boxes.ts'

/** A layer's box in its frame, as its props place it. */
function storedRect(design: Design) {
  return (id: string): Rect | null => {
    const props = design.nodes[id]?.props as Partial<Rect> | undefined
    return props ? { x: props.x ?? 0, y: props.y ?? 0, width: props.width ?? 0, height: props.height ?? 0 } : null
  }
}

describe('workedOn', () => {
  it('gives the innermost layers a step changed or added, not the groups around them', () => {
    const session = sessionOf(testDesign())
    const before = held(session.design())
    session.run('node.group', { ids: ['box', 'headline'], id: 'g' })
    session.run('node.rename', { id: 'box', name: 'Sun' })
    expect(workedOn(before, session.design())).toEqual({ layers: ['box', 'headline'], frame: null })
  })

  it('gives the frame a step changed when it changed no layer, and the frame a layer was taken out of', () => {
    const session = sessionOf(testDesign())
    let before = held(session.design())
    session.run('frame.update', { frameId: 'banner', name: 'Leaderboard' })
    expect(workedOn(before, session.design())).toEqual({ layers: [], frame: 'banner' })
    before = held(session.design())
    session.run('node.delete', { ids: ['box'] })
    expect(workedOn(before, session.design())).toEqual({ layers: [], frame: 'sq' })
  })

  it('gives nothing for a step that changed no layer or frame', () => {
    const session = sessionOf(testDesign())
    const before = held(session.design())
    session.run('page.update', { id: 'p1', name: 'Spring' })
    expect(workedOn(before, session.design())).toEqual({ layers: [], frame: null })
  })
})

describe('agentPresence', () => {
  const design = sessionOf(testDesign()).design()

  it("puts the pointer at the bottom-end corner of the layers' boxes on the first one's page, in page coordinates", () => {
    // The square's box (100,100 200×100) and the banner's headline (1280+4, 600, 960×100).
    const presence = agentPresence(design, { layers: ['box', 'banner-headline'], frame: null }, storedRect(design))
    expect(presence).toEqual({
      page: 'p1',
      pointer: [1280 + 4 + 960, 700],
      selection: ['box', 'banner-headline'],
      frame: null,
    })
  })

  it('leaves out the layers on another page than the first', () => {
    const input = testDesign()
    const banner = input.frames['banner']
    if (!banner) throw new Error('the test design has a banner')
    const moved = sessionOf({
      ...input,
      pages: { ...input.pages, p2: { name: 'Two', order: 'a1' } },
      frames: { ...input.frames, banner: { ...banner, pageId: 'p2' } },
    }).design()
    expect(agentPresence(moved, { layers: ['banner-box', 'box'], frame: null }, storedRect(moved))).toEqual({
      page: 'p2',
      pointer: [1280 + 300, 200],
      selection: ['banner-box'],
      frame: null,
    })
  })

  it("picks a frame, its pointer at the frame's bottom-end corner", () => {
    expect(agentPresence(design, { layers: [], frame: 'banner' }, storedRect(design))).toEqual({
      page: 'p1',
      pointer: [1280 + 320, 50],
      selection: [],
      frame: 'banner',
    })
  })

  it('gives none for nothing, or for layers and frames the design no longer holds', () => {
    expect(agentPresence(design, { layers: [], frame: null }, storedRect(design))).toBeNull()
    expect(agentPresence(design, { layers: ['gone'], frame: 'gone' }, storedRect(design))).toBeNull()
  })
})

describe('noteOf', () => {
  it('turns control characters into spaces and trims', () => {
    expect(noteOf('  Writing\tthe\nheadline \u0007 ')).toBe('Writing the headline')
  })

  it(`cuts a note to ${PRESENCE_NOTE} units with an ellipsis, never splitting a character`, () => {
    const long = noteOf('a'.repeat(98) + '😀😀')
    expect([long.length <= PRESENCE_NOTE, long]).toEqual([true, `${'a'.repeat(98)}…`])
    expect(noteOf('b'.repeat(PRESENCE_NOTE))).toBe('b'.repeat(PRESENCE_NOTE))
  })
})
