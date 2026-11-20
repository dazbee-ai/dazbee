// An agent's batch: its commands run as one undo step, all or nothing, a later step reaching a
// layer an earlier one made through a step reference.
import { describe, expect, it } from 'vitest'

import { badge, openTestSession } from '../test-design.ts'
import { openTestStore } from '../test-store.ts'
import { runAgentBatch } from './batch.ts'

const open = () => {
  const store = openTestStore()
  const session = openTestSession(store, { newId: idsFrom('n') })
  return { store, session, before: store.snapshot() }
}

/** Ids `prefix1`, `prefix2` and on, so a test knows the ids its commands make. */
function idsFrom(prefix: string) {
  let next = 0
  return () => `${prefix}${++next}`
}

describe('runAgentBatch', () => {
  it('adds a layer and styles it through a step reference, as one undo step', () => {
    const { store, session, before } = open()
    const result = runAgentBatch(session, [
      { command: 'node.create', as: 'badge', input: { parentId: 'sq', layer: badge } },
      { command: 'node.update', input: { ids: [{ $ref: 'badge' }], patch: { opacity: 0.5 } } },
      { command: 'node.rename', input: { id: { $ref: 'badge' }, name: '$ref badge' } },
    ])
    expect(result).toEqual({
      kept: true,
      steps: [
        { step: 0, command: 'node.create', as: 'badge', ok: true, result: 'n1' },
        { step: 1, command: 'node.update', ok: true, result: undefined },
        { step: 2, command: 'node.rename', ok: true, result: undefined },
      ],
    })
    expect(session.design().nodes['n1']).toMatchObject({ name: '$ref badge', props: { opacity: 0.5 } })
    expect(session.undoName()).toBe('add')
    session.undo()
    expect(store.snapshot()).toEqual(before)
    expect(session.canUndo()).toBe(false)
  })

  it('takes a part of a step’s result with `field`, as a list’s first id', () => {
    const { session } = open()
    const result = runAgentBatch(session, [
      { command: 'node.duplicate', as: 'copy', input: { ids: ['box'] } },
      { command: 'node.rename', input: { id: { $ref: 'copy', field: '0' }, name: 'Copy' } },
    ])
    expect(result.kept).toBe(true)
    const copy = result.steps[0]?.ok && (result.steps[0].result as string[])[0]
    expect(session.design().nodes[copy as string]?.name).toBe('Copy')
  })

  it('keeps nothing when a step is refused halfway, and gives the refusal', () => {
    const { store, session, before } = open()
    const result = runAgentBatch(session, [
      { command: 'node.create', as: 'badge', input: { parentId: 'sq', layer: badge } },
      { command: 'node.update', input: { ids: ['nowhere'], patch: { opacity: 0.5 } } },
      { command: 'node.rename', input: { id: { $ref: 'badge' }, name: 'Never' } },
    ])
    expect(result.kept).toBe(false)
    expect(result.steps).toHaveLength(2)
    expect(result.steps[0]).toMatchObject({ step: 0, ok: true, result: 'n1' })
    expect(result.steps[1]).toMatchObject({ step: 1, command: 'node.update', ok: false, kind: 'refused' })
    expect(store.snapshot()).toEqual(before)
    expect(session.canUndo()).toBe(false)
  })

  it('gives a command’s bad input with where it is', () => {
    const { store, session, before } = open()
    const result = runAgentBatch(session, [{ command: 'node.rename', input: { id: 'box', name: '' } }])
    expect(result.kept).toBe(false)
    expect(result.steps[0]).toMatchObject({ ok: false, kind: 'input', issues: [{ path: ['name'] }] })
    expect(store.snapshot()).toEqual(before)
  })

  it('reads a step reference to a name no step has as bad input, keeping nothing', () => {
    const { store, session, before } = open()
    const result = runAgentBatch(session, [
      { command: 'node.create', as: 'badge', input: { parentId: 'sq', layer: badge } },
      { command: 'node.update', input: { ids: [{ $ref: 'card' }], patch: { opacity: 0.5 } } },
    ])
    expect(result.kept).toBe(false)
    expect(result.steps[1]).toMatchObject({
      step: 1,
      command: 'node.update',
      ok: false,
      kind: 'input',
      issues: [{ path: ['ids', 0], message: expect.stringMatching(/"card" names no step.*"badge" is step 0/) }],
    })
    expect(store.snapshot()).toEqual(before)
  })

  it('reads a reference to the same or a later step, or a missing field, as bad input', () => {
    const { session } = open()
    const later = runAgentBatch(session, [
      { command: 'node.rename', input: { id: { $ref: 'next' }, name: 'A' } },
      { command: 'node.create', as: 'next', input: { parentId: 'sq', layer: badge } },
    ])
    expect(later.steps[0]).toMatchObject({ kind: 'input', reason: expect.stringMatching(/step 1, not an earlier/) })
    const list = runAgentBatch(session, [
      { command: 'node.duplicate', as: 'copy', input: { ids: ['box'] } },
      { command: 'node.rename', input: { id: { $ref: 'copy' }, name: 'A' } },
    ])
    expect(list.steps[1]).toMatchObject({ kind: 'input', reason: expect.stringMatching(/a list.*field/) })
    const past = runAgentBatch(session, [
      { command: 'node.duplicate', as: 'copy', input: { ids: ['box'] } },
      { command: 'node.rename', input: { id: { $ref: 'copy', field: '3' }, name: 'A' } },
    ])
    expect(past.steps[1]).toMatchObject({ kind: 'input', reason: expect.stringMatching(/has 1 item/) })
    const extra = runAgentBatch(session, [
      { command: 'node.create', as: 'a', input: { parentId: 'sq', layer: badge } },
      { command: 'node.rename', input: { id: { $ref: 'a', at: 1 }, name: 'A' } },
    ])
    expect(extra.steps[1]).toMatchObject({ kind: 'input', reason: expect.stringMatching(/only `field`/) })
    expect(session.canUndo()).toBe(false)
  })

  it('refuses two steps of one name, an empty name and a command there is not, before any step runs', () => {
    const { store, session, before } = open()
    const twice = runAgentBatch(session, [
      { command: 'node.create', as: 'a', input: { parentId: 'sq', layer: badge } },
      { command: 'node.create', as: 'a', input: { parentId: 'sq', layer: badge } },
    ])
    expect(twice).toEqual({
      kept: false,
      steps: [
        {
          step: 1,
          command: 'node.create',
          as: 'a',
          ok: false,
          kind: 'input',
          reason: expect.stringMatching(/already step 0/),
          issues: [{ path: ['as'], message: expect.any(String) }],
        },
      ],
    })
    const empty = runAgentBatch(session, [{ command: 'node.create', as: '', input: { parentId: 'sq', layer: badge } }])
    expect(empty.steps[0]).toMatchObject({ kind: 'input', issues: [{ path: ['as'] }] })
    const unknown = runAgentBatch(session, [{ command: 'node.paint', input: {} }])
    expect(unknown.steps[0]).toMatchObject({ kind: 'input', issues: [{ path: ['command'] }] })
    expect(store.snapshot()).toEqual(before)
  })

  it('makes no undo step from an empty batch', () => {
    const { session } = open()
    expect(runAgentBatch(session, [])).toEqual({ kept: true, steps: [] })
    expect(session.canUndo()).toBe(false)
  })

  it('refuses to run while a gesture is open, as it could not keep nothing then', () => {
    const { session } = open()
    const gesture = session.beginGesture()
    expect(() => runAgentBatch(session, [])).toThrow(/gesture is open/)
    gesture.end()
  })
})
