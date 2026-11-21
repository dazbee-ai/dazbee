// The tab's presence, sent from an editor on `openTab`'s tab to another member's tab on one sync
// server in memory: the pointer in page coordinates, none off the stage or while the tab is hidden,
// the selection and the picked frame; and the other people as the overlay draws them.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { type Design, type Member, PEOPLE_COLOURS, type Presence } from '@dazbee/schema'

import type { Frame } from './canvas/frames.ts'
import type { OtherPresence } from './core-interface.ts'
import { openTab } from './open-tab.ts'
import { editorPresence, PEOPLE_SHOWN } from './presence.ts'
import { DESIGN, WORDS } from './test-actions.ts'
import { type TestEditor, testEditor } from './test-editor.ts'
import { type MemorySync, memorySync } from './test-link.ts'

const ANN: Member = { userId: 'ann', workspaceId: 'w1' }
const BOB: Member = { userId: 'bob', workspaceId: 'w1' }

let mem: MemorySync
const editors: TestEditor[] = []
const closing: (() => Promise<void>)[] = []

beforeEach(() => {
  mem = memorySync(WORDS)
})
afterEach(async () => {
  for (const e of editors.splice(0)) e.end()
  for (const close of closing.splice(0)) await close()
})

type Opened = Awaited<ReturnType<typeof editorOn>>

/** An editor on a tab of the server in memory, as `token`'s member. */
async function editorOn(token: string, member: Member) {
  const tab = await openTab({
    designId: 'd',
    member,
    url: 'ws://s',
    token: () => Promise.resolve(token),
    socket: mem.socket,
  })
  closing.push(() => tab.close())
  const editor = await testEditor(WORDS, { tab })
  editors.push(editor)
  return Object.assign(editor, { tab })
}

/** Waits until tab `to` holds `expected` as the presence tab `from` last sent: a tab sends at most every 34 ms. */
async function lands(to: Opened, from: Opened, expected: Partial<Presence>) {
  await vi.waitFor(
    async () => {
      await mem.settle()
      expect(seen(to, from)).toMatchObject(expected)
    },
    { timeout: 2000, interval: 20 },
  )
}

/** The presence tab `from` last sent, as tab `to` holds it. */
function seen(to: Opened, from: Opened): Presence | undefined {
  const tabId = from.tab.link.client()?.tabId() ?? 0
  return to.tab.link.client()?.presence().get(tabId)?.presence
}

describe('editorPresence', () => {
  it('sends the pointer in page coordinates, the selection and the page, and the pointer as none once it leaves the stage', async () => {
    const ann = await editorOn('ann', ANN)
    const bob = await editorOn('bob', BOB)
    ann.core.select(['a', 'b'])
    const at = ann.core.stagePoint(300, 200, 'wide')
    ann.mouse.move(at.x, at.y)
    await lands(bob, ann, { page: 'p1', pointer: [1580, 200], selection: ['a', 'b'], frame: null })
    ann.core.input.pointer({ ...pointerAt(at), type: 'pointerleave' })
    await lands(bob, ann, { page: 'p1', pointer: null, selection: ['a', 'b'], frame: null })
  })

  it('sends a picked frame, and the pointer as none while the tab is hidden, until the pointer moves again', async () => {
    const ann = await editorOn('ann', ANN)
    const bob = await editorOn('bob', BOB)
    ann.core.pickFrame('sq')
    const at = ann.core.stagePoint(10, 20, 'sq')
    ann.mouse.move(at.x, at.y)
    await lands(bob, ann, { pointer: [10, 20], selection: [], frame: 'sq' })
    ann.core.input.hidden()
    // The capture a hidden tab loses says nothing of it being shown again.
    ann.core.input.pointer({ ...pointerAt(at), type: 'lostpointercapture' })
    await lands(bob, ann, { pointer: null })
    expect(ann.modules.presence.mine().pointer).toBeNull()
    ann.mouse.move(at.x, at.y)
    await lands(bob, ann, { pointer: [10, 20] })
  })

  it('works the presence out in a core opened with no tab, which sends it nowhere', async () => {
    const lone = await testEditor(DESIGN)
    editors.push(lone)
    lone.mouse.move(100, 100)
    expect(lone.modules.presence.mine()).toMatchObject({ page: 'p1', selection: [], frame: null })
  })
})

const SQ: Frame = { id: 'sq', pageId: 'p1', name: 'Square', x: 0, y: 0, width: 1080, height: 1080 }
const WIDE: Frame = { id: 'wide', pageId: 'p1', name: 'Wide', x: 1280, y: 0, width: 1200, height: 628 }

const CAMERA = { x: 10, y: 20, zoom: 2 }
const DESIGN_OF = {
  frames: { sq: SQ, wide: WIDE },
  nodes: { a: { parentId: 'sq' }, w: { parentId: 'wide' } },
} as unknown as Design
const IN_VIEW = [SQ]

/**
 * The presence module over a stage at zoom 2, its page's origin at (10, 20), the square alone in
 * view, and `others` heard; `hear` replaces what is heard, as a presence landing does.
 */
function heard(others: [number, OtherPresence][]) {
  let held: ReadonlyMap<number, OtherPresence> = new Map(others)
  const presence = editorPresence({
    view: { camera: () => CAMERA, page: () => 'p1', design: () => DESIGN_OF, inView: () => IN_VIEW },
    selection: { current: () => null, pickedFrame: () => null },
    pointer: { pointerAt: () => null },
    link: { send: () => {}, others: () => held, onChange: () => () => {} },
  })
  return Object.assign(presence, {
    hear(next: [number, OtherPresence][]) {
      held = new Map(next)
    },
  })
}

/** Another person's tab, on page `page`. */
const other = (person: number, name: string, presence: Partial<Presence> = {}): OtherPresence => ({
  name,
  person,
  colour: person - 1,
  presence: { page: 'p1', pointer: [100, 50], selection: [], frame: null, ...presence },
})

describe('editorPresence: shown', () => {
  it('gives each person on the shown page once, as their tab heard from last, with their pointer on the stage, their layers and frame in view, and their colour', () => {
    const shown = heard([
      [1, other(1, 'Bob', { pointer: [1, 1] })],
      [2, other(2, 'Cat', { selection: ['a', 'w', 'gone'], frame: 'sq' })],
      [3, other(3, 'Dan', { page: 'p2' })],
      [4, other(1, 'Bob', { pointer: null })],
      // Bob's tab on another page, heard last, leaves his tab here shown.
      [5, other(1, 'Bob', { page: 'p2' })],
    ]).shown()
    expect(shown).toEqual([
      {
        tabId: 2,
        name: 'Cat',
        colour: PEOPLE_COLOURS[1],
        cursor: { x: 210, y: 120 },
        layers: [{ frame: SQ, id: 'a' }],
        frame: SQ,
      },
      { tabId: 4, name: 'Bob', colour: PEOPLE_COLOURS[0], cursor: null, layers: [], frame: null },
    ])
  })

  it('gives an agent marked as one, with its note; a note heard from a person is not shown', () => {
    const shown = heard([
      [1, { ...other(1, 'Claude (agent)', { note: 'Writing the headline' }), agent: true }],
      [2, other(2, 'Bob (agent)', { note: 'Pretending' })],
    ]).shown()
    expect(shown.map(({ name, agent, note }) => ({ name, agent, note }))).toEqual([
      { name: 'Claude (agent)', agent: true, note: 'Writing the headline' },
      { name: 'Bob (agent)', agent: undefined, note: undefined },
    ])
  })

  it('gives what it gave until the presence heard changes', () => {
    const presence = heard([[1, other(1, 'Bob')]])
    const first = presence.shown()
    expect(presence.shown()).toBe(first)
    presence.hear([[1, other(1, 'Bob', { pointer: [5, 5] })]])
    expect(presence.shown()).not.toBe(first)
    expect(presence.shown()[0]?.cursor).toEqual({ x: 20, y: 30 })
  })

  it(`draws at most ${PEOPLE_SHOWN} people, those heard from last`, () => {
    const many = Array.from({ length: 25 }, (_, i): [number, OtherPresence] => [i + 1, other(i + 1, `P${i + 1}`)])
    const shown = heard(many).shown()
    expect(shown.map((p) => p.name)).toEqual(Array.from({ length: PEOPLE_SHOWN }, (_, i) => `P${i + 6}`))
    // Past the eighth colour, they come round again.
    expect(shown.at(-1)?.colour).toBe(PEOPLE_COLOURS[24 % PEOPLE_COLOURS.length])
  })

  it("draws Bob's cursor and selection in Ann's editor where Bob has them, in his colour and with his name", async () => {
    const ann = await editorOn('ann', ANN)
    const bob = await editorOn('bob', BOB)
    bob.core.select(['a'])
    const at = bob.core.stagePoint(300, 200, 'sq')
    bob.mouse.move(at.x, at.y)
    let told = 0
    ann.modules.presence.onChange(() => told++)
    await lands(ann, bob, { pointer: [300, 200], selection: ['a'] })
    expect(told).toBeGreaterThan(0)
    ann.core.redraw()
    const [person] = ann.modules.presence.shown()
    expect(person).toMatchObject({ name: 'Bob', colour: PEOPLE_COLOURS[1], layers: [{ id: 'a' }], frame: null })
    expect(person?.layers[0]?.frame.id).toBe('sq')
    // Both stages are the same size and fit the same page, so Bob's pointer is at the same stage point.
    expect(person?.cursor?.x).toBeCloseTo(at.x, 1)
    expect(person?.cursor?.y).toBeCloseTo(at.y, 1)
  })
})

/** A pointer input at a stage point, with no keys held. */
function pointerAt(at: { x: number; y: number }) {
  return {
    at,
    button: 0,
    detail: 0,
    shiftKey: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    pointerType: 'mouse' as const,
  }
}
