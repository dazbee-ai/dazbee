// A session's steps: a gesture's step cancelled, as Escape cancels a drag; a refused step, which
// puts back what it wrote; where the session refuses to write; and a batch. Faults are in
// session-faults.test.ts.
import { describe, expect, it } from 'vitest'

import { frameIdOf, parseDesign } from '@dazbee/schema'

import { CommandError } from './commands/define.ts'
import { CommandFault, openSession, type Session } from './session.ts'
import { readDesign } from './store.ts'
import { badge, openTestSession, testDesign, thrownBy } from './test-design.ts'
import { openTestStore } from './test-store.ts'

describe('beginGesture', () => {
  /** A session on the test design, with the id of one of its layers. */
  const opened = () => {
    const result = parseDesign(testDesign())
    if (!result.success) throw new Error(result.errors.join('\n'))
    const session = openTestSession(openTestStore(result.design))
    const [id] = Object.keys(session.design().nodes)
    if (!id) throw new Error('no layer')
    return { session, id }
  }

  it('puts back all its gesture wrote, leaving no step of it to undo or redo, and closes it', () => {
    const { session, id } = opened()
    const start = session.design()
    session.run('node.update', { ids: [id], patch: { x: 11 } })
    const before = session.design()
    const step = session.beginGesture()
    session.run('node.update', { ids: [id], patch: { x: 20 } })
    const made = session.run('node.create', { parentId: frameIdOf(start, id) as string, layer: badge })
    session.run('node.update', { ids: [id], patch: { y: 30 } })
    step.cancel()
    expect(session.design()).toEqual(before)
    expect(session.design().nodes[made]).toBeUndefined()
    expect([session.inGesture(), session.canRedo()]).toEqual([false, false])
    // Its end, after the cancel, changes nothing.
    step.end()
    session.undo()
    expect(session.design()).toEqual(start)
    expect(session.canUndo()).toBe(false)
  })

  it('leaves the history as it is for a gesture that wrote nothing', () => {
    const { session, id } = opened()
    session.run('node.update', { ids: [id], patch: { x: 11 } })
    session.run('node.update', { ids: [id], patch: { x: 12 } })
    session.undo()
    session.beginGesture().cancel()
    expect(session.design().nodes[id]?.props).toMatchObject({ x: 11 })
    expect([session.canUndo(), session.canRedo()]).toEqual([true, true])
  })

  it('ends and cancels only its own gesture: never the next one, nor the one a gesture inside it joined', () => {
    const { session, id } = opened()
    const step = session.beginGesture()
    session.run('node.update', { ids: [id], patch: { x: 20 } })
    step.end()
    const next = session.beginGesture()
    session.run('node.update', { ids: [id], patch: { x: 21 } })
    // The step before, ended already, neither cancels nor ends this one.
    step.cancel()
    step.end()
    expect(session.inGesture()).toBe(true)
    // A gesture begun inside it joins its step, and has none of its own to cancel.
    session.beginGesture().cancel()
    expect(session.inGesture()).toBe(true)
    session.run('node.update', { ids: [id], patch: { x: 22 } })
    next.end()
    expect(session.design().nodes[id]?.props).toMatchObject({ x: 22 })
    session.undo()
    expect(session.design().nodes[id]?.props).toMatchObject({ x: 20 })
  })
})

describe('a refused step', () => {
  it.each([
    ['gesture', (session: Session) => session.gesture],
    ['batch', (session: Session) => session.batch],
  ] as const)('%s puts back what it wrote when its steps throw, then throws the same', (_, within) => {
    const store = openTestStore()
    const session = openTestSession(store)
    const before = readDesign(store)
    const refusal = thrownBy(() =>
      within(session)(() => {
        session.run('node.update', { ids: ['box'], patch: { x: 20 } })
        session.run('node.update', { ids: ['gone'], patch: { x: 1 } })
      }),
    )
    expect(refusal).toBeInstanceOf(CommandError)
    expect(readDesign(store)).toEqual(before)
    expect([session.inGesture(), session.canUndo(), session.canRedo()]).toEqual([false, false, false])
    const own = new Error('not a command')
    expect(
      thrownBy(() =>
        within(session)(() => {
          session.run('node.update', { ids: ['box'], patch: { x: 20 } })
          throw own
        }),
      ),
    ).toBe(own)
    expect(readDesign(store)).toEqual(before)
  })

  it.each([
    ['gesture', (session: Session) => session.gesture],
    ['batch', (session: Session) => session.batch],
  ] as const)(
    "%s run inside a drag's gesture has no step of its own: what it wrote stays in the drag's",
    (_, within) => {
      const store = openTestStore()
      const session = openTestSession(store)
      const before = readDesign(store)
      const step = session.beginGesture()
      session.run('node.update', { ids: ['box'], patch: { x: 20 } })
      const refusal = thrownBy(() =>
        within(session)(() => {
          session.run('node.update', { ids: ['box'], patch: { y: 30 } })
          session.run('node.update', { ids: ['gone'], patch: { x: 1 } })
        }),
      )
      expect(refusal).toBeInstanceOf(CommandError)
      expect(session.inGesture()).toBe(true)
      expect(session.design().nodes.box?.props).toMatchObject({ x: 20, y: 30 })
      step.end()
      session.undo()
      expect(readDesign(store)).toEqual(before)
    },
  )
})

describe('run', () => {
  it('refuses an input the schema does not take with its issues, as data, and writes nothing', () => {
    const store = openTestStore()
    const session = openTestSession(store)
    const before = readDesign(store)
    const refusal = thrownBy(() => session.run('node.update', { ids: ['box', 7], patch: { x: 1 }, extra: 1 } as never))
    expect(refusal).toBeInstanceOf(CommandError)
    expect(refusal).toMatchObject({
      command: 'node.update',
      kind: 'input',
      issues: [
        {
          path: [],
          message: 'the input takes ids and patch (and may take drawn and holders); got ids, patch and extra',
        },
        { path: ['ids', 1], message: expect.any(String) },
      ],
    })
    const { reason, issues, message } = refusal as CommandError
    expect(reason).toBe(`${issues[0]?.message}; ids.1: ${issues[1]?.message}`)
    expect(message).toBe(`node.update: ${reason}`)
    expect(readDesign(store)).toEqual(before)
  })

  it("refuses by the command's check with its reason as a sentence, no issues, and writes nothing", () => {
    const store = openTestStore()
    const session = openTestSession(store)
    const before = readDesign(store)
    const refusal = thrownBy(() => session.run('node.update', { ids: ['gone'], patch: { x: 1 } }))
    expect(refusal).toBeInstanceOf(CommandError)
    expect(refusal).toMatchObject({ command: 'node.update', kind: 'refused', reason: 'no layer "gone"', issues: [] })
    expect((refusal as Error).message).toBe('node.update: no layer "gone"')
    expect(readDesign(store)).toEqual(before)
  })

  it('throws, before writing, in a transaction the session did not open, alone or in a batch', () => {
    const store = openTestStore()
    const session = openTestSession(store)
    const before = readDesign(store)
    const move = () => session.run('node.update', { ids: ['box'], patch: { x: 20 } })
    for (const run of [move, () => session.batch(move)]) {
      const thrown = thrownBy(() => store.transact(run))
      expect(String(thrown)).toMatch('a command does not run in a transaction the session did not open')
      expect(thrown).not.toBeInstanceOf(CommandError)
      expect(thrown).not.toBeInstanceOf(CommandFault)
      expect(readDesign(store)).toEqual(before)
      expect(session.canUndo()).toBe(false)
    }
    // The session's own steps are not foreign to it.
    session.untracked(() => session.gesture(() => session.batch(move)))
    expect(readDesign(store).nodes.box?.props.x).toBe(20)
  })
})

describe('untracked', () => {
  it('closes a gesture begun inside it that is still open when it returns', () => {
    const store = openTestStore()
    const session = openTestSession(store)
    let step = session.beginGesture()
    step.end()
    session.untracked(() => {
      step = session.beginGesture()
      session.run('node.update', { ids: ['headline'], patch: { y: 22 } })
    })
    expect(session.inGesture()).toBe(false)
    // The commands after it are steps of their own, and its step has nothing left to cancel.
    session.run('node.update', { ids: ['box'], patch: { y: 30 } })
    session.run('node.update', { ids: ['box'], patch: { y: 40 } })
    step.cancel()
    session.undo()
    expect(session.design().nodes).toMatchObject({ box: { props: { y: 30 } }, headline: { props: { y: 22 } } })
  })
})

describe('untracked while a gesture is open (C40)', () => {
  it('waits, and runs as the gesture ends: the gesture is one step, and undo leaves what it wrote', () => {
    const session = openTestSession(openTestStore())
    const step = session.beginGesture('move')
    session.run('node.update', { ids: ['box'], patch: { x: 5 } })
    const result = session.untracked(() => {
      session.run('node.update', { ids: ['headline'], patch: { y: 22 } })
      return 'ran'
    })
    expect([result, session.design().nodes.headline?.props.y]).toEqual([undefined, 600])
    session.run('node.update', { ids: ['box'], patch: { x: 6 } })
    step.end()
    expect(session.design().nodes).toMatchObject({ box: { props: { x: 6 } }, headline: { props: { y: 22 } } })
    expect([session.undoName(), session.redoName()]).toEqual(['move', null])
    session.undo()
    expect(session.design().nodes).toMatchObject({ box: { props: { x: 100 } }, headline: { props: { y: 22 } } })
    expect(session.canUndo()).toBe(false)
  })

  it('runs its calls in order once a cancel has put the gesture back', () => {
    const session = openTestSession(openTestStore())
    const step = session.beginGesture()
    session.run('node.update', { ids: ['box'], patch: { x: 5 } })
    session.untracked(() => session.run('node.update', { ids: ['headline'], patch: { y: 22 } }))
    session.untracked(() => session.run('node.update', { ids: ['headline'], patch: { y: 33 } }))
    step.cancel()
    expect(session.design().nodes).toMatchObject({ box: { props: { x: 100 } }, headline: { props: { y: 33 } } })
    expect([session.canUndo(), session.canRedo()]).toEqual([false, false])
  })

  it('waits behind a gesture run by `gesture`, which returns once it has run', () => {
    const session = openTestSession(openTestStore())
    session.gesture(() => {
      session.run('node.update', { ids: ['box'], patch: { x: 5 } })
      session.untracked(() => session.run('node.update', { ids: ['headline'], patch: { y: 22 } }))
      expect(session.design().nodes.headline?.props.y).toBe(600)
    })
    expect(session.design().nodes.headline?.props.y).toBe(22)
    session.undo()
    expect(session.design().nodes).toMatchObject({ box: { props: { x: 100 } }, headline: { props: { y: 22 } } })
  })

  it('never runs once the session is destroyed', () => {
    const store = openTestStore()
    const session = openTestSession(store)
    const step = session.beginGesture()
    session.untracked(() => session.run('node.update', { ids: ['headline'], patch: { y: 22 } }))
    session.destroy()
    step.end()
    expect(readDesign(store).nodes.headline?.props.y).toBe(600)
  })

  it('is closed by the time history listeners hear of a cancel: a command one runs is a step of its own', () => {
    const session = openTestSession(openTestStore())
    session.run('node.update', { ids: ['box'], patch: { x: 1 } })
    const step = session.beginGesture()
    session.run('node.update', { ids: ['box'], patch: { y: 5 } })
    const heard: boolean[] = []
    const stop = session.onHistory(() => heard.push(session.inGesture()))
    step.cancel()
    stop()
    expect(heard.length > 0 && heard.every((open) => !open)).toBe(true)
  })

  it('runs at once inside a gesture begun in untracked, as part of it', () => {
    const session = openTestSession(openTestStore())
    session.untracked(() => {
      const step = session.beginGesture()
      session.run('node.update', { ids: ['box'], patch: { x: 5 } })
      session.untracked(() => session.run('node.update', { ids: ['headline'], patch: { y: 22 } }))
      expect(session.design().nodes.headline?.props.y).toBe(22)
      step.end()
    })
    expect(session.canUndo()).toBe(false)
  })
})

describe('a command, a cancel, an undo or a redo from an observer of the document', () => {
  it('is refused before it writes: the session does not write while a transaction is being closed', () => {
    const store = openTestStore()
    const session = openSession(store)
    const step = session.beginGesture()
    const thrown: string[] = []
    const calls = [
      () => session.run('node.update', { ids: ['headline'], patch: { y: 5 } }),
      () => session.batch(() => session.run('node.update', { ids: ['headline'], patch: { y: 5 } })),
      () => step.cancel(),
      () => session.undo(),
      () => session.redo(),
    ]
    const observe = () => {
      for (const call of calls.splice(0)) thrown.push(String(thrownBy(call)))
    }
    session.run('node.update', { ids: ['headline'], patch: { x: 7 } })
    session.undo()
    const stopObserving = store.onChange(observe)
    session.run('node.update', { ids: ['box'], patch: { x: 20 } })
    stopObserving()
    expect(thrown).toHaveLength(5)
    for (const error of thrown) expect(error).toMatch('the session does not write from an observer of the document')
    expect(readDesign(store).nodes).toMatchObject({ box: { props: { x: 20 } }, headline: { props: { y: 600 } } })
    expect(session.inGesture()).toBe(true)
    step.cancel()
    expect(readDesign(store).nodes.box?.props.x).toBe(100)
  })
})

describe('batch', () => {
  it('refuses an undo or a redo inside it, before anything is written', () => {
    const store = openTestStore()
    const session = openTestSession(store)
    session.run('node.update', { ids: ['box'], patch: { x: 5 } })
    session.run('node.update', { ids: ['box'], patch: { x: 6 } })
    session.undo()
    const before = readDesign(store)
    for (const press of [() => session.undo(), () => session.redo()]) {
      const refusal = thrownBy(() =>
        session.batch(() => {
          session.run('node.update', { ids: ['headline'], patch: { y: 5 } })
          press()
        }),
      )
      expect(String(refusal)).toMatch('undo and redo are not run inside a batch')
      expect(readDesign(store)).toEqual(before)
    }
    expect(session.canUndo()).toBe(true)
  })

  it('refuses, before writing, a command that adds, removes, moves, reorders or re-parents, naming gesture for such steps', () => {
    const store = openTestStore()
    const session = openTestSession(store)
    const before = readDesign(store)
    const refusal = thrownBy(() =>
      session.batch(() => {
        session.run('node.create', { parentId: 'sq', layer: badge })
        session.run('node.duplicate', { ids: ['box'] })
      }),
    )
    expect(refusal).toBeInstanceOf(CommandError)
    expect(String(refusal)).toMatch(/^CommandError: node\.create: .*gesture/)
    expect(readDesign(store)).toEqual(before)
    expect([session.canUndo(), session.canRedo()]).toEqual([false, false])
  })

  it('runs commands that change properties as one transaction and one undo step', () => {
    const store = openTestStore()
    const session = openTestSession(store)
    const before = readDesign(store)
    let transactions = 0
    store.onChange(() => transactions++)
    session.batch(() => {
      session.run('node.update', { ids: ['box'], patch: { x: 5 } })
      session.run('node.update', { ids: ['headline'], patch: { y: 6 } })
    })
    expect(transactions).toBe(1)
    expect(readDesign(store).nodes).toMatchObject({ box: { props: { x: 5 } }, headline: { props: { y: 6 } } })
    session.undo()
    expect(readDesign(store)).toEqual(before)
    expect(session.canUndo()).toBe(false)
  })
})
