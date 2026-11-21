import { describe, expect, it } from 'vitest'

import { type Member, PEOPLE_COLOURS, type Presence, type ServerMessage } from '@dazbee/schema'

import { openServer, type Who } from './server.ts'
import { BOB, editor, fresh, joined, testOptions, to, viewer } from './test-server.ts'

const CAT: Member = { userId: 'cat', workspaceId: 'w1' }
const HERE: Presence = { page: 'p1', pointer: [120.5, 40], selection: ['badge'], frame: null }

/** An agent's tab, working for Ann unless another member is given. */
const agentTab = (agent = 'Claude (agent)', member?: Member): Who => ({ ...editor(member), agent })

const presence = (p: Presence = HERE) => ({ type: 'presence', ...p })
const heard = (messages: ServerMessage[]) => messages.filter((m) => m.type === 'presence')

describe('openServer: presence', () => {
  it('says in each welcome that it takes presence', () => {
    const server = openServer(fresh(), testOptions())
    expect(joined(server).welcome.presence).toBe(true)
  })

  it("passes a tab's presence to the other members' tabs, a Reviewer's too, never to its own member's tabs", () => {
    const server = openServer(fresh(), testOptions())
    const a = joined(server)
    const a2 = joined(server)
    const b = joined(server, editor(BOB))
    const v = joined(server, viewer(CAT))
    const out = server.receive(a.tabId, presence(), 60)
    expect(to(a.tabId, out)).toEqual([])
    expect(to(a2.tabId, out)).toEqual([])
    const sent = { type: 'presence', tabId: a.tabId, person: 1, colour: 0, presence: HERE }
    expect(to(b.tabId, out)).toEqual([sent])
    expect(to(v.tabId, out)).toEqual([sent])
    // A Reviewer's presence goes to the others too.
    expect(heard(to(a.tabId, server.receive(v.tabId, presence(), 60)))).toMatchObject([{ tabId: v.tabId, person: 3 }])
  })

  it('gives each member the first colour no other connected member has, the same for each of their tabs', () => {
    const server = openServer(fresh(), testOptions())
    const a = joined(server)
    const b = joined(server, editor(BOB))
    const b2 = joined(server, editor(BOB))
    const colourOf = (tabId: number, to_: number) =>
      heard(to(to_, server.receive(tabId, presence(), 60)))[0] as { colour: number; person: number }
    expect(colourOf(b.tabId, a.tabId)).toEqual(expect.objectContaining({ colour: 1, person: 2 }))
    expect(colourOf(b2.tabId, a.tabId)).toEqual(expect.objectContaining({ colour: 1, person: 2 }))
    server.leave(a.tabId)
    // Ann's colour is free again: the next member takes it; Ann coming back takes the next free one.
    const c = joined(server, editor(CAT))
    expect(colourOf(c.tabId, b.tabId)).toEqual(expect.objectContaining({ colour: 0, person: 3 }))
    const a3 = joined(server)
    expect(colourOf(a3.tabId, b.tabId)).toEqual(expect.objectContaining({ colour: 2, person: 1 }))
  })

  it('wraps round the colours once every one is taken', () => {
    const server = openServer(fresh(), testOptions())
    const tabs = Array.from({ length: PEOPLE_COLOURS.length + 1 }, (_, i) =>
      joined(server, editor({ userId: `u${i}`, workspaceId: 'w1' })),
    )
    const last = tabs.at(-1)?.tabId ?? 0
    expect(heard(to(tabs[0]?.tabId ?? 0, server.receive(last, presence(), 60)))).toMatchObject([{ colour: 0 }])
  })

  it("gives a member's every tab one colour, though their colour was another's when they joined", () => {
    const server = openServer(fresh(), testOptions())
    const tabs = Array.from({ length: PEOPLE_COLOURS.length }, (_, i) =>
      joined(server, editor({ userId: `u${i}`, workspaceId: 'w1' })),
    )
    const ninth = joined(server, editor(CAT))
    // A colour comes free; the ninth member's next tab still takes the colour their first has.
    server.leave(tabs[3]?.tabId ?? 0)
    const ninthAgain = joined(server, editor(CAT))
    const hearer = tabs[0]?.tabId ?? 0
    const colourOf = (tabId: number) =>
      (heard(to(hearer, server.receive(tabId, presence(), 60)))[0] as { colour: number }).colour
    expect(colourOf(ninthAgain.tabId)).toBe(colourOf(ninth.tabId))
  })

  it("sends a tab that joins the other members' latest presence after its welcome, and none of a tab that left", () => {
    const server = openServer(fresh(), testOptions())
    const a = joined(server)
    const b = joined(server, editor(BOB))
    server.receive(a.tabId, presence({ ...HERE, pointer: [1, 1] }), 60)
    server.receive(a.tabId, presence(), 60)
    server.receive(b.tabId, presence({ ...HERE, selection: [] }), 60)
    const c = joined(server, editor(CAT))
    expect(c.out.filter((o) => o.to === c.tabId).map((o) => o.message.type)).toEqual([
      'welcome',
      'presence',
      'presence',
    ])
    expect(heard(to(c.tabId, c.out))).toEqual([
      { type: 'presence', tabId: a.tabId, person: 1, colour: 0, presence: HERE },
      { type: 'presence', tabId: b.tabId, person: 2, colour: 1, presence: { ...HERE, selection: [] } },
    ])
    server.leave(b.tabId)
    // Ann's own other tab hears none of hers.
    const a2 = joined(server)
    expect(heard(to(a2.tabId, a2.out))).toEqual([])
    const d = joined(server, editor({ userId: 'dan', workspaceId: 'w1' }))
    expect(heard(to(d.tabId, d.out)).map((m) => m.type === 'presence' && m.tabId)).toEqual([a.tabId])
  })

  it("keeps a tab's presence while it takes over from its own connection, and forgets it once the tab leaves", () => {
    const server = openServer(fresh(), testOptions())
    const a = joined(server)
    server.receive(a.tabId, presence(), 60)
    const resume = { syncId: a.welcome.syncId, tabId: a.tabId, seq: 0, secret: a.welcome.secret }
    joined(server, editor(), resume)
    const b = joined(server, editor(BOB))
    expect(heard(to(b.tabId, b.out))).toMatchObject([{ tabId: a.tabId, presence: HERE }])
    server.leave(a.tabId)
    joined(server, editor(), resume)
    const c = joined(server, editor(CAT))
    expect(heard(to(c.tabId, c.out))).toEqual([])
  })

  it('keeps a member their colour when they come back, unless another member took it meanwhile', () => {
    const server = openServer(fresh(), testOptions())
    const a = joined(server)
    const b = joined(server, editor(BOB))
    const colourOf = (tabId: number, hearer: number) =>
      (heard(to(hearer, server.receive(tabId, presence(), 60)))[0] as { colour: number }).colour
    server.leave(a.tabId)
    const resume = { syncId: b.welcome.syncId, tabId: b.tabId, seq: 0, secret: b.welcome.secret }
    server.leave(b.tabId)
    joined(server, editor(BOB), resume)
    const c = joined(server, editor(CAT))
    expect([colourOf(b.tabId, c.tabId), colourOf(c.tabId, b.tabId)]).toEqual([1, 0])
  })

  it('passes on every presence no larger than the limit, keeping the latest for a tab that joins', () => {
    const server = openServer(fresh(), { ...testOptions(), limits: { presenceBytes: 100 } })
    const a = joined(server)
    const b = joined(server, editor(BOB))
    const passed = (p: Presence, bytes = 60) => heard(to(b.tabId, server.receive(a.tabId, presence(p), bytes))).length
    const latest = { ...HERE, pointer: [9, 9] as [number, number] }
    expect([passed(HERE), passed(latest), passed(HERE, 101)]).toEqual([1, 1, 0])
    const c = joined(server, editor(CAT))
    expect(heard(to(c.tabId, c.out))).toMatchObject([{ presence: latest }])
  })

  it('closes a connection whose presence is not what the schema takes', () => {
    const server = openServer(fresh(), testOptions())
    const a = joined(server)
    expect(
      server.receive(a.tabId, { type: 'presence', page: 'p1', pointer: [0], selection: [], frame: null }, 60),
    ).toEqual(expect.objectContaining({ close: 4400 }))
  })

  it('says in each welcome that it takes a presence’s note', () => {
    const server = openServer(fresh(), testOptions())
    expect(joined(server).welcome.presenceNote).toBe(true)
  })

  it("passes an agent's presence to its own member's tabs too, marked as an agent's, with its note, in a colour of its own", () => {
    const server = openServer(fresh(), testOptions())
    const ann = joined(server)
    server.receive(ann.tabId, presence(), 60)
    const claude = joined(server, agentTab())
    const out = server.receive(claude.tabId, presence({ ...HERE, note: 'Writing the headline' }), 80)
    expect(to(claude.tabId, out)).toEqual([])
    expect(to(ann.tabId, out)).toEqual([
      {
        type: 'presence',
        tabId: claude.tabId,
        person: 2,
        colour: 1,
        agent: true,
        presence: { ...HERE, note: 'Writing the headline' },
      },
    ])
    // The agent's tab hears its member, another person to it.
    expect(heard(to(claude.tabId, claude.out))).toEqual([
      { type: 'presence', tabId: ann.tabId, person: 1, colour: 0, presence: HERE },
    ])
  })

  it("gives one agent's tabs one person and colour, and another agent of the same member another", () => {
    const server = openServer(fresh(), testOptions())
    const ann = joined(server)
    const claude = joined(server, agentTab())
    const claude2 = joined(server, agentTab())
    const codex = joined(server, agentTab('Codex (agent)'))
    const of = (tabId: number, hearer: number) =>
      heard(to(hearer, server.receive(tabId, presence(), 60)))[0] as { person: number; colour: number }
    expect(of(claude.tabId, ann.tabId)).toMatchObject({ person: 2, colour: 1 })
    // One agent's own other tab doesn't show it.
    expect(heard(to(claude2.tabId, server.receive(claude.tabId, presence(), 60)))).toEqual([])
    expect(of(claude2.tabId, ann.tabId)).toMatchObject({ person: 2, colour: 1 })
    expect(of(codex.tabId, ann.tabId)).toMatchObject({ person: 3, colour: 2 })
    // Bob's agent of the same name is his own, not Ann's.
    const bobs = joined(server, agentTab('Claude (agent)', BOB))
    expect(of(bobs.tabId, ann.tabId)).toMatchObject({ person: 4, colour: 3 })
  })

  it("drops a person's note: only an agent gives one", () => {
    const server = openServer(fresh(), testOptions())
    const a = joined(server)
    const b = joined(server, editor(BOB))
    const out = server.receive(a.tabId, presence({ ...HERE, note: 'Approve this, Bob' }), 60)
    expect(to(b.tabId, out)).toEqual([{ type: 'presence', tabId: a.tabId, person: 1, colour: 0, presence: HERE }])
    const c = joined(server, editor(CAT))
    expect(heard(to(c.tabId, c.out))).toEqual([
      { type: 'presence', tabId: a.tabId, person: 1, colour: 0, presence: HERE },
    ])
  })

  it("sends a tab that joins an agent's latest presence, its note and mark with it", () => {
    const server = openServer(fresh(), testOptions())
    const claude = joined(server, agentTab())
    server.receive(claude.tabId, presence({ ...HERE, note: 'Checking the sizes' }), 60)
    const ann = joined(server)
    expect(heard(to(ann.tabId, ann.out))).toEqual([
      {
        type: 'presence',
        tabId: claude.tabId,
        person: 1,
        colour: 0,
        agent: true,
        presence: { ...HERE, note: 'Checking the sizes' },
      },
    ])
  })

  it('closes a connection whose note is longer than a presence takes', () => {
    const server = openServer(fresh(), testOptions())
    const claude = joined(server, agentTab())
    expect(server.receive(claude.tabId, presence({ ...HERE, note: 'x'.repeat(101) }), 160)).toEqual(
      expect.objectContaining({ close: 4400 }),
    )
  })
})
