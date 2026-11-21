// The plain store (D4): a tab of a sync server in memory, whose server checks every step, whose
// steps are the client's, whose carets follow the text, and which another tab joins.
import { describe, expect, it } from 'vitest'

import { ScratchRejected } from './client-store.ts'
import { openLocalServer, plainStore } from './plain-store.ts'
import { openSession } from './session.ts'
import { readDesign } from './store.ts'
import { badge, openTestSession, testDesign } from './test-design.ts'
import { openPlainStore } from './test-store.ts'

/** A plain store on the test design whose server rejects without throwing: a tab of a shared design. */
function tabStore() {
  const design = readDesign(openPlainStore())
  return plainStore(design)
}

describe('a plain store', () => {
  it("refuses, on a scratch store, a write that breaks the design's rules: it throws and the design is as before", () => {
    const store = openPlainStore()
    const before = readDesign(store)
    // A layer inside a shape, which holds no layer.
    expect(() => store.transact(() => store.set('layer', 'headline', 'parentId', 'box'))).toThrow(ScratchRejected)
    expect(readDesign(store)).toEqual(before)
    expect(store.takeNotices()).toMatchObject([{ kind: 'rejected' }])
  })

  it('tells a tab that is no scratch store of a write its server rejected, and puts it back', () => {
    const store = tabStore()
    const before = readDesign(store)
    store.transact(() => store.unset('layer', 'box', 'index'))
    expect(readDesign(store)).toEqual(before)
    expect(store.takeNotices()).toMatchObject([{ kind: 'rejected' }])
  })

  it('ends and sends a write outside a step before its listeners hear of it, though one throws', () => {
    const store = openPlainStore()
    const other = store.server.join()
    const off = store.onChange(() => {
      throw new Error('a listener that throws')
    })
    expect(() => store.transact(() => store.setProp('box', 'x', 7))).toThrow('a listener that throws')
    expect(other.prop('box', 'x')).toBe(7)
    off()
    // The step is closed: the next write is a step of its own.
    store.transact(() => store.setProp('box', 'x', 8))
    expect(other.prop('box', 'x')).toBe(8)
  })

  it('holds a deleted layer no more, and undo brings it back under its id', () => {
    const store = openPlainStore()
    const session = openSession(store)
    session.run('node.delete', { ids: ['box'] })
    expect([store.has('layer', 'box'), store.isLive('box')]).toEqual([false, false])
    session.undo()
    expect([store.has('layer', 'box'), store.isLive('box')]).toEqual([true, true])
  })

  it('takes an id as live while a page, a frame or a layer holds it, and only then (C27)', () => {
    const store = openPlainStore()
    expect(['p1', 'sq', 'box', 'never'].map((id) => store.isLive(id))).toEqual([true, true, true, false])
  })

  it('has one session: another tab joins its server', () => {
    const store = openPlainStore()
    openSession(store)
    expect(() => openSession(store)).toThrow('a plain store is one tab, with one session')
    openSession(store.server.join())
  })

  it('throws a scratch rejection, not what a listener throws as the step is put back', () => {
    const store = openPlainStore()
    store.onChange(() => {
      throw new Error('a listener that throws')
    })
    expect(() => store.transact(() => store.set('layer', 'headline', 'parentId', 'box'))).toThrow(ScratchRejected)
  })

  it('sends an undo whose listener throws, and throws once it is sent', () => {
    const store = openPlainStore()
    const other = store.server.join()
    const session = openSession(store)
    session.run('node.update', { ids: ['box'], patch: { x: 5 } })
    const off = store.onChange(() => {
      throw new Error('a listener that throws')
    })
    expect(() => session.undo()).toThrow('a listener that throws')
    off()
    expect(other.prop('box', 'x')).toBe(100)
    session.run('node.update', { ids: ['box'], patch: { x: 6 } })
    expect(other.prop('box', 'x')).toBe(6)
  })
})

describe("a plain store's carets", () => {
  /** A store whose headline reads `text`, with a caret at each offset in `at`. */
  function anchored(text: string, ...at: number[]) {
    const store = openPlainStore()
    store.transact(() => store.setProp('headline', 'text', { text, runs: [] }))
    return { store, anchors: at.map((offset) => store.textAnchor('headline', offset)) }
  }

  it("follow the tab's own edit by the edit itself, at a letter the text repeats", () => {
    const { store, anchors } = anchored('hello', 2, 3, 4)
    // Typing an "l" at 3 makes "helllo": by the text alone it could have gone in at 2, 3 or 4.
    store.transact(() => store.editText('headline', { kind: 'insert', at: 3, text: 'l' }))
    expect(anchors.map((anchor) => store.anchorOffset(anchor))).toEqual([2, 4, 5])
    store.transact(() => store.editText('headline', { kind: 'delete', at: 2, length: 2 }))
    expect(anchors.map((anchor) => store.anchorOffset(anchor))).toEqual([2, 2, 3])
  })

  it("follow another tab's edit by what the texts share: before stays, after moves, inside goes to its start", () => {
    const { store, anchors } = anchored('one two three', 1, 5, 9)
    const other = store.server.join()
    other.transact(() => other.setProp('headline', 'text', { text: 'one 2 three', runs: [] }))
    expect(store.prop('headline', 'text')).toBe('one 2 three')
    expect(anchors.map((anchor) => store.anchorOffset(anchor))).toEqual([1, 4, 7])
  })

  it('stay before text inserted at their place when anchored to stay, by this tab or another', () => {
    const { store } = anchored('hello there')
    const staying = store.textAnchor('headline', 5, true)
    const following = store.textAnchor('headline', 5)
    store.transact(() => store.editText('headline', { kind: 'insert', at: 5, text: '!' }))
    expect([store.anchorOffset(staying), store.anchorOffset(following)]).toEqual([5, 6])
    const other = store.server.join()
    other.transact(() => other.setProp('headline', 'text', { text: 'hello? there', runs: [] }))
    expect([store.anchorOffset(staying), store.anchorOffset(following)]).toEqual([5, 6])
    other.transact(() => other.setProp('headline', 'text', { text: 'oh hello? there', runs: [] }))
    expect([store.anchorOffset(staying), store.anchorOffset(following)]).toEqual([8, 9])
  })

  it('follow an edit past the end of the text as the text takes it, at its end', () => {
    const { store, anchors } = anchored('hello', 5)
    store.transact(() => store.editText('headline', { kind: 'insert', at: 9, text: '!' }))
    expect(store.prop('headline', 'text')).toBe('hello!')
    expect(store.anchorOffset(anchors[0] as (typeof anchors)[number])).toBe(6)
  })

  it('are gone with their layer', () => {
    const { store, anchors } = anchored('hello', 2)
    openSession(store).run('node.delete', { ids: ['headline'] })
    expect(store.anchorOffset(anchors[0] as (typeof anchors)[number])).toBeNull()
  })
})

describe("a plain store's history", () => {
  it('counts an open gesture on the stacks once it has written, and names it', () => {
    const session = openTestSession(openPlainStore())
    session.run('node.update', { ids: ['box'], patch: { x: 1 } })
    session.undo()
    const drag = session.beginGesture()
    expect([session.canUndo(), session.canRedo()]).toEqual([false, true])
    session.run('node.update', { ids: ['box'], patch: { x: 5 } })
    expect([session.canUndo(), session.undoName(), session.canRedo()]).toEqual([true, 'edit', false])
    drag.end()
    expect([session.canUndo(), session.undoName(), session.canRedo()]).toEqual([true, 'edit', false])
  })

  it('counts an open gesture on the stacks only once a write changed the design', () => {
    const session = openTestSession(openPlainStore())
    session.run('node.update', { ids: ['box'], patch: { x: 1 } })
    session.undo()
    const drag = session.beginGesture()
    // Box has no fill bound: unbinding it changes nothing.
    session.run('node.bind', { ids: ['box'], property: 'fill', ref: null })
    expect([session.canUndo(), session.canRedo()]).toEqual([false, true])
    drag.end()
  })

  it('runs the calls that waited for a gesture whose step a scratch store refused, and tells it as a fault', () => {
    const server = openLocalServer(readDesign(openPlainStore()), {
      scratch: true,
      client: { limits: { messageBytes: 300 } },
    })
    const session = openSession(server.join())
    const faults: unknown[] = []
    session.onFault((fault) => faults.push(fault))
    const drag = session.beginGesture()
    session.run('node.update', { ids: ['box'], patch: { x: 5 } })
    session.run('page.update', { id: 'p1', name: 'x'.repeat(400) })
    let ran = false
    session.untracked(() => {
      ran = true
    })
    drag.end()
    expect(ran).toBe(true)
    expect(faults).toMatchObject([{ name: 'CommandFault' }])
    expect(session.design().nodes.box?.props.x).toBe(100)
  })

  it('counts a batch on the stacks only once it ends', () => {
    const session = openTestSession(openPlainStore())
    session.batch(() => {
      session.run('node.update', { ids: ['box'], patch: { x: 5 } })
      expect(session.canUndo()).toBe(false)
    })
    expect(session.canUndo()).toBe(true)
  })

  it('ends an open gesture as its own step on an undo, and a cancel then puts back only what came after (C32)', () => {
    const session = openTestSession(openPlainStore())
    const drag = session.beginGesture()
    session.run('node.update', { ids: ['box'], patch: { x: 5 } })
    session.undo()
    expect(session.design().nodes.box?.props.x).toBe(100)
    session.run('node.update', { ids: ['box'], patch: { y: 9 } })
    drag.cancel()
    expect(session.design().nodes.box?.props).toMatchObject({ x: 100, y: 100 })
    // The step the undo took back is still there to redo.
    session.redo()
    expect(session.design().nodes.box?.props.x).toBe(5)
  })

  it('leaves an open gesture whole on a press with nothing to take back', () => {
    const session = openTestSession(openPlainStore())
    const drag = session.beginGesture()
    session.run('node.update', { ids: ['box'], patch: { x: 5 } })
    session.redo()
    session.run('node.update', { ids: ['box'], patch: { y: 9 } })
    drag.end()
    session.undo()
    expect(session.design().nodes.box?.props).toMatchObject({ x: 100, y: 100 })
    expect(session.canUndo()).toBe(false)
  })

  it('keeps redo after a step that changed nothing, which makes no undo step (C32)', () => {
    const session = openTestSession(openPlainStore())
    session.run('node.update', { ids: ['box'], patch: { x: 5 } })
    session.undo()
    session.run('node.update', { ids: ['box'], patch: { x: 100 } })
    expect([session.canUndo(), session.canRedo()]).toEqual([false, true])
  })

  it("tells the history listeners when another tab's change set changes what undo takes back", () => {
    const store = openPlainStore()
    const session = openTestSession(store)
    session.run('node.update', { ids: ['box'], patch: { x: 5 } })
    let told = 0
    session.onHistory(() => told++)
    const other = openSession(store.server.join())
    other.run('node.delete', { ids: ['box'] })
    expect(told).toBeGreaterThan(0)
  })
})

describe('a local server', () => {
  it("delivers each tab's step to the others before the call that ended it returns", () => {
    const server = openLocalServer(readDesign(openPlainStore()))
    const [a, b, c] = [server.join(), server.join(), server.join()]
    openSession(a).run('node.create', { id: 'made', parentId: 'sq', layer: badge })
    expect([b.has('layer', 'made'), c.has('layer', 'made')]).toEqual([true, true])
    expect([b.isLive('made'), c.isLive('made')]).toEqual([true, true])
  })

  it("holds a held tab's steps until it delivers them, while what others write reaches it at once", () => {
    const store = openPlainStore(testDesign())
    const held = store.server.join({ held: true })
    openSession(held).run('node.update', { ids: ['box'], patch: { x: 7 } })
    openSession(store).run('node.update', { ids: ['banner-box'], patch: { x: 3 } })
    expect([store.prop('box', 'x'), held.prop('banner-box', 'x')]).toEqual([100, 3])
    held.deliver()
    expect(store.prop('box', 'x')).toBe(7)
  })

  it("keeps delivering to every tab when another tab's listener throws, and throws once they are caught up", () => {
    const server = openLocalServer(readDesign(openPlainStore()))
    const [a, b, c] = [server.join(), server.join(), server.join()]
    const off = b.onChange(() => {
      throw new Error('a listener that throws')
    })
    expect(() => a.transact(() => a.setProp('box', 'x', 7))).toThrow('a listener that throws')
    off()
    expect([b.prop('box', 'x'), c.prop('box', 'x')]).toEqual([7, 7])
    a.transact(() => a.setProp('box', 'x', 8))
    expect([b.prop('box', 'x'), c.prop('box', 'x')]).toEqual([8, 8])
  })

  it("throws a held scratch tab's rejected step from its deliver", () => {
    const held = openPlainStore().server.join({ held: true })
    held.transact(() => held.set('layer', 'headline', 'parentId', 'box'))
    expect(() => held.deliver()).toThrow(ScratchRejected)
  })

  it("confirms a gesture's step as saved once the call that ended it returns, and a held tab's once it delivers", async () => {
    const store = openPlainStore(testDesign())
    const held = store.server.join({ held: true })
    const [mine, theirs] = [openSession(store), openSession(held)]
    const moved = (session: typeof mine, x: number) => {
      const step = session.beginGesture('move')
      session.run('node.update', { ids: ['box'], patch: { x } })
      step.end()
      return session.whenConfirmed(step)
    }
    const told: string[] = []
    void moved(mine, 7).then((saved) => told.push(`mine ${saved}`))
    void moved(theirs, 8).then((saved) => told.push(`theirs ${saved}`))
    await Promise.resolve()
    expect(told).toEqual(['mine saved'])
    held.deliver()
    await Promise.resolve()
    expect(told).toEqual(['mine saved', 'theirs saved'])
  })

  it('throws a rejection of a step written while the server delivers from the call it was written in, and never later', () => {
    const server = openLocalServer(readDesign(openPlainStore()), { scratch: true })
    const [a, b] = [server.join(), server.join()]
    let once = true
    b.onChange(() => {
      if (!once) return
      once = false
      b.transact(() => b.set('layer', 'headline', 'parentId', 'box'))
    })
    expect(() => a.transact(() => a.setProp('box', 'x', 7))).toThrow(ScratchRejected)
    b.transact(() => b.setProp('box', 'x', 9))
    expect(a.prop('box', 'x')).toBe(9)
  })
})
