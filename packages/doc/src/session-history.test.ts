// A press of undo and redo through a session: the latest step with something to take back, steps
// that changed nothing passed in one press, and a value a later step set and took back put back.
import { describe, expect, it } from 'vitest'

import { CommandFault, type Session } from './session.ts'
import { readDesign } from './store.ts'
import { registerBuggyCommands } from './test-commands.ts'
import { badge, kindsDesign, openTestSession } from './test-design.ts'
import { openTestStore } from './test-store.ts'

describe('undo and redo', () => {
  registerBuggyCommands()
  it('takes back one step though an observer reads the design as each try closes', () => {
    const store = openTestStore()
    const session = openTestSession(store)
    session.run('node.rename', { id: 'headline', name: 'Renamed' })
    session.run('node.update', { ids: ['box'], patch: { x: 500 } })
    const typing = session.beginGesture()
    session.run('text.edit', { id: 'headline', op: { kind: 'insert', at: 0, text: 'a' } })
    session.run('text.edit', { id: 'headline', op: { kind: 'delete', at: 0, length: 1 } })
    typing.end()
    store.onChange(() => void session.design().nodes.box)
    session.undo()
    expect(readDesign(store).nodes).toMatchObject({ box: { props: { x: 100 } }, headline: { name: 'Renamed' } })
    expect(session.canUndo()).toBe(true)
  })

  it.each([
    [
      'typing that left the text as it was',
      (session: Session) => {
        session.run('text.edit', { id: 'headline', op: { kind: 'insert', at: 0, text: 'a' } })
        session.run('text.edit', { id: 'headline', op: { kind: 'delete', at: 0, length: 1 } })
      },
    ],
    [
      'a layer added and deleted',
      (session: Session) => {
        const made = session.run('node.create', { parentId: 'sq', layer: badge })
        session.run('node.delete', { ids: [made] })
      },
    ],
  ] as const)('takes back the step before a gesture of %s in one press', (_, gesture) => {
    const store = openTestStore()
    const session = openTestSession(store)
    const before = readDesign(store)
    session.run('node.update', { ids: ['box'], patch: { x: 500 } })
    const step = session.beginGesture()
    gesture(session)
    step.end()
    session.undo()
    expect(readDesign(store)).toEqual(before)
    expect(session.canUndo()).toBe(false)
  })

  it('takes back, in one press, the one real step below two that changed nothing', () => {
    const store = openTestStore()
    const session = openTestSession(store)
    const typeAndErase = () => {
      const step = session.beginGesture()
      session.run('text.edit', { id: 'headline', op: { kind: 'insert', at: 0, text: 'a' } })
      session.run('text.edit', { id: 'headline', op: { kind: 'delete', at: 0, length: 1 } })
      step.end()
    }
    const before = readDesign(store)
    session.run('node.update', { ids: ['box'], patch: { x: 500 } })
    typeAndErase()
    typeAndErase()
    session.undo()
    expect(readDesign(store)).toEqual(before)
    expect(session.canUndo()).toBe(false)
  })

  it('empties a stack of steps that changed nothing in one press, which reverts nothing', () => {
    const store = openTestStore()
    const session = openTestSession(store)
    const typeAndErase = () => {
      const step = session.beginGesture()
      session.run('text.edit', { id: 'headline', op: { kind: 'insert', at: 0, text: 'a' } })
      session.run('text.edit', { id: 'headline', op: { kind: 'delete', at: 0, length: 1 } })
      step.end()
    }
    const before = readDesign(store)
    typeAndErase()
    typeAndErase()
    session.undo()
    expect(readDesign(store)).toEqual(before)
    expect(session.canUndo()).toBe(false)
  })

  /** A session on a design holding a mask group and a row box, with a rename done first. */
  const renamed = () => {
    const store = openTestStore(kindsDesign())
    const session = openTestSession(store)
    session.run('node.rename', { id: 'r2', name: 'Renamed' })
    return { store, session }
  }
  /** The row box made Free, as it is drawn. */
  const free = {
    id: 'row',
    layout: 'free',
    drawn: {
      row: { x: 400, y: 300, width: 220, height: 100 },
      r1: { x: 400, y: 100, width: 100, height: 100 },
      r2: { x: 520, y: 100, width: 100, height: 100 },
      'r-abs': { x: 40, y: 100, width: 100, height: 100 },
    },
  } as const

  it('takes back one step whose value a later step of this tab set and undid, and its redo takes the value away again', () => {
    const { store, session } = renamed()
    session.run('node.mask', { ids: ['mask'], mask: null })
    const unmasked = readDesign(store)
    session.run('node.mask', { ids: ['mask'], mask: 'luminance' })
    session.undo()
    // A new step drops the redo that knew this tab's undo took the luminance mask away.
    session.run('node.rename', { id: 'r1', name: 'Other' })
    session.undo()
    session.undo()
    expect(readDesign(store).nodes).toMatchObject({ mask: { props: { mask: 'alpha' } }, r2: { name: 'Renamed' } })
    expect(session.canUndo()).toBe(true)
    session.redo()
    expect(readDesign(store)).toEqual(unmasked)
  })

  it('redoes a step whose undo had to put a value back after a fault in a later step set and put back that value', () => {
    const { store, session } = renamed()
    session.run('node.autoLayout', free)
    const freed = readDesign(store)
    expect(() =>
      session.gesture(() => {
        session.run('node.autoLayout', { id: 'row', layout: 'auto' })
        session.run('test.throw' as never, { id: 'r1' } as never)
      }),
    ).toThrow(CommandFault)
    session.undo()
    expect(readDesign(store).nodes.row).toMatchObject({ props: { layout: { direction: 'row' } } })
    session.redo()
    expect(readDesign(store)).toEqual(freed)
  })

  it('takes away a value an undo put back when it undoes the step that wrote that value', () => {
    const { store, session } = renamed()
    const start = readDesign(store)
    session.run('node.bind', { ids: ['r1'], property: 'fill', ref: 'brand:primary', value: '#112233FF' })
    session.run('node.bind', { ids: ['r1'], property: 'fill', ref: null })
    session.run('node.bind', { ids: ['r1'], property: 'fill', ref: 'brand:accent', value: '#445566FF' })
    session.undo()
    session.run('node.rename', { id: 'r1', name: 'Other' })
    for (let steps = 0; steps < 3; steps++) session.undo()
    expect(readDesign(store)).toEqual(start)
  })
})
