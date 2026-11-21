// What the people in a design see of an agent as it works through the tools: its cursor where its last call worked,
// those layers or that frame outlined, and the note it gave, as another member's tab on the sync server hears it.
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { TestSocket } from '@dazbee/editor/test-link'
import type { Presence, ServerMessage } from '@dazbee/schema'

import { type TestClient, type TestServer, testServer } from '../test-client.ts'

let server: TestServer

afterEach(async () => {
  await server.endpoint.close()
})

/** The design the tests open. */
const LAUNCH = { brand: 'brand-summer', design: 'design-launch' }

/** An agent with the design open, and Bob's socket on it, joined after the agent's. */
async function watched(): Promise<{ agent: TestClient; bob: TestSocket }> {
  server = testServer()
  const agent = await server.connect(server.api.addAccess().token(), { name: 'claude', title: 'Claude' })
  expect((await agent.call('open_design', LAUNCH)).isError).toBeFalsy()
  const bob = server.sync('design-launch').socket('ws://sync.test/?design=design-launch')
  await new Promise<void>((resolve) => {
    bob.onopen = () => resolve()
  })
  bob.send(JSON.stringify({ type: 'hello', protocol: 1, token: 'bob', waiting: 0 }))
  return { agent, bob }
}

/** The latest presence Bob heard, once the sync server has passed on all it was sent. */
async function heard(bob: TestSocket): Promise<Extract<ServerMessage, { type: 'presence' }> | undefined> {
  await server.sync('design-launch').settle()
  return bob.got.filter((message) => message.type === 'presence').at(-1)
}

/** What a presence shows: its pointer, selection, frame and note. */
function shown(message: { presence: Presence } | undefined) {
  if (!message) return undefined
  const { pointer, selection, frame, note } = message.presence
  return { pointer, selection, frame, note }
}

/** Waits until the latest presence Bob heard shows `expected`: a tab sends one at most every 34 ms. */
async function shows(bob: TestSocket, expected: Partial<ReturnType<typeof shown>>) {
  await vi.waitFor(async () => expect(shown(await heard(bob))).toMatchObject(expected ?? {}), {
    timeout: 2000,
    interval: 20,
  })
}

describe('the agent in presence', () => {
  it('shows nothing before the agent has worked', async () => {
    const { bob } = await watched()
    expect(await heard(bob)).toBeUndefined()
  })

  it("puts the agent's cursor at what run_command changed, outlined, with its note, marked as an agent", async () => {
    const { agent, bob } = await watched()
    const ran = await agent.call('run_command', {
      command: 'node.rename',
      input: { id: 'box', name: 'Sun' },
      note: 'Naming the\tbox',
    })
    expect(ran.isError).toBeFalsy()
    const message = await heard(bob)
    expect(message?.agent).toBe(true)
    // The box is 200×100 at (100, 100) in the square, which sits at the page's origin.
    expect(shown(message)).toEqual({ pointer: [300, 200], selection: ['box'], frame: null, note: 'Naming the box' })
  })

  it('moves to what a batch and an undo changed, the undo taking the batch’s note away', async () => {
    const { agent, bob } = await watched()
    await agent.call('batch', {
      steps: [{ command: 'node.update', input: { ids: ['box'], patch: { x: 80 } } }],
      note: 'Nudging the box',
    })
    await shows(bob, { pointer: [280, 200], selection: ['box'], note: 'Nudging the box' })
    await agent.call('run_command', { command: 'node.rename', input: { id: 'headline', name: 'Title' } })
    await agent.call('undo')
    await shows(bob, { selection: ['headline'], note: undefined })
  })

  it('moves to the frame read_frame and check_frame look at, and to the layer read_layer reads', async () => {
    const { agent, bob } = await watched()
    await agent.call('read_frame', { frame: 'banner' })
    // The banner is 320×50 at (1280, 0).
    await shows(bob, { pointer: [1600, 50], selection: [], frame: 'banner', note: undefined })
    await agent.call('check_frame', { frame: 'sq' })
    await shows(bob, { pointer: [1080, 1080], frame: 'sq' })
    await agent.call('read_layer', { id: 'box' })
    await shows(bob, { pointer: [300, 200], selection: ['box'], frame: null })
  })

  it('shows nothing of a step that was refused, its note neither', async () => {
    const { agent, bob } = await watched()
    await agent.call('read_layer', { id: 'box' })
    await shows(bob, { selection: ['box'] })
    const ran = await agent.call('run_command', {
      command: 'node.rename',
      input: { id: 'nothing-here', name: 'Sun' },
      note: 'Naming a layer',
    })
    expect(ran.isError).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(shown(await heard(bob))).toEqual({ pointer: [300, 200], selection: ['box'], frame: null, note: undefined })
  })

  it('moves to the frame render_frame draws', async () => {
    const { agent, bob } = await watched()
    expect((await agent.call('render_frame', { frame: 'banner', maxSize: 64 })).isError).toBeFalsy()
    await shows(bob, { pointer: [1600, 50], selection: [], frame: 'banner' })
  })

  it('refuses a note longer than 200 characters before anything runs', async () => {
    const { agent } = await watched()
    const ran = await agent.call('run_command', {
      command: 'node.rename',
      input: { id: 'box', name: 'Sun' },
      note: 'x'.repeat(201),
    })
    expect(ran.isError).toBe(true)
  })
})
