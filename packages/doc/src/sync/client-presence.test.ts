// A tab's side of presence: the other members' latest it keeps, what clears it, and what it sends.
import { describe, expect, it } from 'vitest'

import type { Member, ServerMessage } from '@dazbee/schema'

import { openClient } from './client.ts'
import { down, joinClient, testServer, up, who, wire } from './test-session.ts'

const BOB: Member = { userId: 'bob', workspaceId: 'w1' }
const fail = (): never => {
  throw new Error('the tab sends no presence')
}

describe('openClient: presence', () => {
  it("keeps the other members' latest presence, heard last at the end, and drops a tab's when it leaves", () => {
    const server = testServer()
    const a = joinClient(server)
    const b = joinClient(server, who(BOB))
    const c = joinClient(server, who({ userId: 'cat', workspaceId: 'w1' }))
    let told = 0
    a.onPresence(() => told++)
    const here = { page: 'p1', pointer: [1, 2] as [number, number], selection: ['box'], frame: null }
    down(a, up(server, b, [b.presenceMessage(here) ?? fail()]))
    down(a, up(server, c, [c.presenceMessage({ ...here, pointer: null }) ?? fail()]))
    down(a, up(server, b, [b.presenceMessage({ ...here, selection: [] }) ?? fail()]))
    expect([...a.presence()]).toEqual([
      [c.tabId(), { person: 3, colour: 2, presence: { ...here, pointer: null } }],
      [b.tabId(), { person: 2, colour: 1, presence: { ...here, selection: [] } }],
    ])
    expect(told).toBe(3)
    a.receive({ type: 'left', tabId: b.tabId() })
    expect([...a.presence().keys(), told]).toEqual([c.tabId(), 4])
  })

  it('drops every presence when its connection drops and when a welcome comes, and sends none offline', () => {
    const server = testServer()
    const a = joinClient(server)
    const b = joinClient(server, who(BOB))
    const here = { page: 'p1', pointer: null, selection: [], frame: null }
    down(a, up(server, b, [b.presenceMessage(here) ?? fail()]))
    a.disconnect()
    expect([a.presence().size, a.presenceMessage(here)]).toEqual([0, undefined])
    a.receive({ type: 'presence', tabId: b.tabId(), person: 2, colour: 1, presence: here })
    // The welcome brings everyone's latest again behind it.
    server.leave(a.tabId())
    const joined = server.join(wire(a.reconnect('t')), who())
    if ('close' in joined) throw new Error(joined.reason)
    const mine = joined.out.filter((o) => o.to === joined.tabId).map((o) => o.message)
    expect(mine.map((m) => m.type)).toEqual(['welcome', 'presence'])
    a.receive(wire(mine[0] as ServerMessage))
    expect(a.presence().size).toBe(0)
    a.receive(wire(mine[1] as ServerMessage))
    expect([...a.presence().keys()]).toEqual([b.tabId()])
    expect(a.presenceMessage(here)).toEqual({ type: 'presence', ...here })
  })

  it('sends no presence to a server whose welcome does not say it takes it', () => {
    const server = testServer()
    const joined = server.join(wire({ type: 'hello', protocol: 1, token: 't', waiting: 0 }), who())
    if ('close' in joined) throw new Error(joined.reason)
    const old: Partial<Extract<ServerMessage, { type: 'welcome' }>> = wire(
      joined.out[0]?.message as Extract<ServerMessage, { type: 'welcome' }>,
    )
    delete old.presence
    const a = openClient(old as ServerMessage)
    expect(a.presenceMessage({ page: 'p1', pointer: null, selection: [], frame: null })).toBeUndefined()
  })

  it('sends a note only to a server whose welcome says it takes one, and keeps an agent’s mark', () => {
    const server = testServer()
    const a = joinClient(server)
    const claude = joinClient(server, { ...who(), agent: 'Claude (agent)' })
    const here = { page: 'p1', pointer: [4, 5] as [number, number], selection: ['box'], frame: null, note: 'Sizing' }
    down(a, up(server, claude, [claude.presenceMessage(here) ?? fail()]))
    expect([...a.presence()]).toEqual([[claude.tabId(), { person: 2, colour: 1, agent: true, presence: here }]])
    // A server built before notes would close the connection on one.
    const joined = server.join(wire({ type: 'hello', protocol: 1, token: 't', waiting: 0 }), who())
    if ('close' in joined) throw new Error(joined.reason)
    const old: Partial<Extract<ServerMessage, { type: 'welcome' }>> = wire(
      joined.out[0]?.message as Extract<ServerMessage, { type: 'welcome' }>,
    )
    delete old.presenceNote
    expect(openClient(old as ServerMessage).presenceMessage(here)).toEqual({
      type: 'presence',
      page: 'p1',
      pointer: [4, 5],
      selection: ['box'],
      frame: null,
    })
  })

  it('sends only the fields the server takes, and gives a new map each time what it keeps changes', () => {
    const server = testServer()
    const a = joinClient(server)
    const b = joinClient(server, who(BOB))
    const here = { page: 'p1', pointer: null, selection: [], frame: null }
    const wider = { ...here, zoom: 2 }
    expect(b.presenceMessage(wider)).toEqual({ type: 'presence', ...here })
    const before = a.presence()
    down(a, up(server, b, [b.presenceMessage(wider) ?? fail()]))
    const after = a.presence()
    expect([after === before, after.size, before.size]).toEqual([false, 1, 0])
    a.receive({ type: 'left', tabId: b.tabId() })
    expect([a.presence() === after, a.presence().size, after.size]).toEqual([false, 0, 1])
  })
})
