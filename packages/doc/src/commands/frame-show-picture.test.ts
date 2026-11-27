// frame.showPicture: an AI frame's picture or the layers made from it, shown in turn as one undo step each.
import { describe, expect, it } from 'vitest'

import { readDesign } from '../store.ts'
import { openTestSession, shapesDesign } from '../test-design.ts'
import { openTestStore } from '../test-store.ts'

const visibleOf = (store: ReturnType<typeof openTestStore>, id: string) =>
  readDesign(store).nodes[id]?.props.visible !== false

describe('frame.showPicture', () => {
  it('shows the picture and hides its layers, then the other way, each one undo step named for it', () => {
    const store = openTestStore(shapesDesign())
    const tab = openTestSession(store)
    // `a` stands in for the frame's picture layer, `b` and `c` for the layers made from it.
    tab.run('frame.showPicture', { frameId: 'sq', pictureLayerId: 'a', layerIds: ['b', 'c'], show: true })
    expect([visibleOf(store, 'a'), visibleOf(store, 'b'), visibleOf(store, 'c')]).toEqual([true, false, false])
    expect(tab.undoName()).toBe('backToPicture')

    tab.run('frame.showPicture', { frameId: 'sq', pictureLayerId: 'a', layerIds: ['b', 'c'], show: false })
    expect([visibleOf(store, 'a'), visibleOf(store, 'b'), visibleOf(store, 'c')]).toEqual([false, true, true])
    expect(tab.undoName()).toBe('makeEditable')

    tab.undo()
    expect([visibleOf(store, 'a'), visibleOf(store, 'b')]).toEqual([true, false])
  })

  it('refuses a missing frame and a layer of another frame', () => {
    const tab = openTestSession(openTestStore(shapesDesign()))
    const show = { pictureLayerId: 'a', layerIds: ['b'], show: true }
    expect(() => tab.run('frame.showPicture', { ...show, frameId: 'gone' })).toThrow(/no frame "gone"/)
    expect(() => tab.run('frame.showPicture', { ...show, frameId: 'sq', layerIds: ['wide-b'] })).toThrow(
      /not in frame "sq"/,
    )
  })
})
