// Waiting for a gesture's step to be saved: `whenConfirmed` settles once the sync server answers the
// step's change set, saved, rejected, lost with the queue, or too big to send, waits while the tab is
// offline, and fails as ended once the session ends first.
import { describe, expect, it } from 'vitest'

import type { DesignRecords } from '@dazbee/schema'

import { clientStore } from './client-store.ts'
import { openSession } from './session.ts'
import { NotSaved } from './store.ts'
import type { Client, ClientOptions, Outgoing } from './sync/client.ts'
import { firstSaved } from './sync/journal.ts'
import { openServer } from './sync/server.ts'
import {
  comeBack,
  edit,
  exchange,
  joinClient,
  testServer,
  testServerOptions,
  up,
  who,
  wire,
} from './sync/test-session.ts'
import { testDesign } from './test-design.ts'

/** A session on a tab of a test server, whose sends wait for `deliver`. */
function tabOn(options: ClientOptions = {}) {
  const server = testServer()
  const client = joinClient(server, who(), options)
  const sent: Outgoing[] = []
  const store = clientStore(client, (messages) => sent.push(...messages))
  const session = openSession(store)
  /** Sends what the tab sent since the last call, and delivers what follows from it. */
  const deliver = () => exchange(server, client, sent.splice(0), [client])
  return { server, client, store, session, sent, deliver }
}

/** Renames the box in a gesture of its own, ended; gives the gesture's step. */
function renameBox(session: ReturnType<typeof openSession>, name = 'Card') {
  const step = session.beginGesture('rename')
  session.run('node.rename', { id: 'box', name })
  step.end()
  return step
}

/** How `promise` has settled once the microtasks waiting have run: its value, why it failed, or 'waiting'. */
async function settled(promise: Promise<unknown>) {
  let state: unknown = 'waiting'
  promise.then(
    (value) => (state = value),
    (error: unknown) => (state = error instanceof NotSaved ? { why: error.why, reason: error.reason } : error),
  )
  for (let i = 0; i < 5; i++) await Promise.resolve()
  return state
}

/** A change set from `other` that deletes the box, accepted by the server and delivered to every tab of `tabs`. */
function otherDeletesBox(server: ReturnType<typeof testServer>, other: Client, tabs: Client[]) {
  exchange(server, other, edit(other, 'delete', { op: 'delete', part: 'layer', id: 'box' }), tabs)
}

describe('whenConfirmed', () => {
  it('resolves saved once the server accepts the gesture’s change set, not before', async () => {
    const { session, deliver } = tabOn()
    const confirmed = session.whenConfirmed(renameBox(session))
    expect(await settled(confirmed)).toBe('waiting')
    deliver()
    expect(await settled(confirmed)).toBe('saved')
  })

  it('resolves saved at once for a gesture that changed nothing', async () => {
    const { session } = tabOn()
    const step = session.beginGesture('rename')
    step.end()
    expect(await settled(session.whenConfirmed(step))).toBe('saved')
  })

  it('fails as rejected, with the reason, once the server rejects it: the step leaves both stacks and nothing stays', async () => {
    const { server, client, session, deliver, store } = tabOn()
    const other = joinClient(server)
    const confirmed = session.whenConfirmed(renameBox(session))
    // Another tab's delete of the box is ordered before the rename.
    otherDeletesBox(server, other, [other, client])
    deliver()
    expect(await settled(confirmed)).toEqual({ why: 'rejected', reason: 'cannotApply' })
    expect([session.canUndo(), session.canRedo(), store.layer('box')]).toEqual([false, false, undefined])
  })

  it('fails as too big for a step past a change set’s limits: put back on the tab, nothing sent', async () => {
    const { session, sent, store } = tabOn({ limits: { messageBytes: 120 } })
    const confirmed = session.whenConfirmed(renameBox(session, 'A name long enough to pass the message size'))
    expect(await settled(confirmed)).toEqual({ why: 'tooBig', reason: undefined })
    expect([sent, (store.layer('box') as { name: string }).name]).toEqual([[], 'Box'])
  })

  it('waits while the tab is offline, and resolves saved once it is back and the server accepts it', async () => {
    const { server, client, session, sent } = tabOn()
    client.disconnect()
    const confirmed = session.whenConfirmed(renameBox(session))
    expect([await settled(confirmed), sent]).toEqual(['waiting', []])
    exchange(server, client, comeBack(server, client), [client])
    expect(await settled(confirmed)).toBe('saved')
  })

  it('fails as rejected, with no reason, when the tab learns on coming back that the server refused it', async () => {
    const { server, client, session, sent } = tabOn()
    const other = joinClient(server)
    const confirmed = session.whenConfirmed(renameBox(session))
    otherDeletesBox(server, other, [other])
    // The rename reaches the server, which rejects it, but the answer is lost with the connection.
    up(server, client, sent.splice(0))
    exchange(server, client, comeBack(server, client), [client])
    expect(await settled(confirmed)).toEqual({ why: 'rejected', reason: undefined })
  })

  it('fails as lost when the server no longer knows the tab, its queue dropped', async () => {
    const { client, session } = tabOn()
    client.disconnect()
    const confirmed = session.whenConfirmed(renameBox(session))
    const saved = firstSaved(testDesign() as unknown as DesignRecords, 'other')
    const other = openServer({ saved, journal: [], lastEntry: 0 }, testServerOptions())
    const joined = other.join(wire(client.reconnect('t')), who())
    const welcome = 'out' in joined ? joined.out[0]?.message : undefined
    if (welcome) client.receive(wire(welcome))
    expect(await settled(confirmed)).toEqual({ why: 'lost', reason: undefined })
  })

  it('fails as ended once the session ends before the server answers, and keeps an answer that came first', async () => {
    const { session, deliver } = tabOn()
    const saved = session.whenConfirmed(renameBox(session, 'First'))
    deliver()
    const waiting = session.whenConfirmed(renameBox(session, 'Second'))
    session.destroy()
    expect([await settled(saved), await settled(waiting)]).toEqual(['saved', { why: 'ended', reason: undefined }])
  })

  it('refuses a gesture still open, one cancelled, and one that joined another’s step', () => {
    const { session } = tabOn()
    const open = session.beginGesture('rename')
    const joined = session.beginGesture('move')
    session.run('node.rename', { id: 'box', name: 'Card' })
    expect(() => session.whenConfirmed(open)).toThrow(/ended/)
    open.end()
    expect(() => session.whenConfirmed(joined)).toThrow(/ended/)
    const cancelled = session.beginGesture('rename')
    session.run('node.rename', { id: 'box', name: 'Gone' })
    cancelled.cancel()
    expect(() => session.whenConfirmed(cancelled)).toThrow(/ended/)
  })
})
