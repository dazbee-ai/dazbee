// The agent tab on the sync link's server in memory: the editor's core opened in Node, joined to
// the server as a member's tab.
import { afterEach, describe, expect, it, vi } from 'vitest'

import { readDesign, VIEW_ONLY } from '@dazbee/doc'
import { loadCanvasKit } from '@dazbee/renderer/node'

import { type AgentTab, openAgentTab } from './agent-tab.ts'
import { openTab } from './open-tab.ts'
import { memorySync } from './test-link.ts'

const opened: AgentTab[] = []

afterEach(async () => {
  for (const tab of opened.splice(0)) await tab.close()
})

/** An agent tab on `server`, as Ann's. */
async function agentTab(server = memorySync()) {
  const tab = await openAgentTab({
    ck: await loadCanvasKit(),
    designId: 'd1',
    url: 'ws://s',
    token: () => Promise.resolve('ann'),
    socket: (url) => server.socket(url),
    sources: {},
  })
  opened.push(tab)
  return { tab, server }
}

describe('openAgentTab', () => {
  it('fits a text set through its session to its words, as the screen does: its box grows', async () => {
    const { tab, server } = await agentTab()
    const before = tab.design().nodes['headline']?.props.height ?? 0
    tab.session.run('text.edit', {
      id: 'headline',
      op: { kind: 'insert', at: 11, text: ', every day this week, on everything in the shop and online too' },
    })
    await server.settle()
    const after = tab.design().nodes['headline']?.props.height ?? 0
    expect(after).toBeGreaterThan(before * 2)
    expect(server.state().nodes['headline']).toMatchObject({ props: { height: after } })
  })

  it('fits the group a layer left to what it still holds, as the screen does', async () => {
    const { tab } = await agentTab()
    tab.session.run('node.group', { ids: ['box', 'headline'], id: 'g' })
    expect(tab.design().nodes['g']?.props).toMatchObject({ y: 100, height: 600 })
    tab.session.run('node.move', { id: 'box', parentId: 'sq' })
    const headline = tab.design().nodes['headline']?.props
    expect(tab.design().nodes['g']?.props).toMatchObject({ y: 600, height: headline?.height })
  })

  it('sends its step as a change set that reaches a second tab on the design', async () => {
    const { tab, server } = await agentTab()
    const other = await openTab({
      designId: 'd1',
      member: { userId: 'bob', workspaceId: 'w1' },
      url: 'ws://s',
      token: () => Promise.resolve('bob'),
      socket: (url) => server.socket(url),
    })
    try {
      tab.session.run('node.rename', { id: 'box', name: 'Sun' })
      await server.settle()
      expect(readDesign(other.store).nodes['box']?.name).toBe('Sun')
      expect(server.nameOf('box')).toBe('Sun')
    } finally {
      await other.close()
    }
  })

  it('close() waits for the server to store the steps the tab has not had confirmed', async () => {
    const { tab, server } = await agentTab()
    tab.session.run('node.rename', { id: 'box', name: 'Sun' })
    await tab.close()
    await server.settle()
    expect(server.nameOf('box')).toBe('Sun')
  })

  it('shows where it worked to its member’s own tab, with its note, and takes the note away after its time', async () => {
    const server = memorySync(undefined, {
      who: (token) =>
        token === 'claude'
          ? { member: { userId: 'ann', workspaceId: 'w1' }, name: 'Ann', access: 'edit', agent: 'Claude (agent)' }
          : undefined,
    })
    const ann = await openTab({
      designId: 'd1',
      member: { userId: 'ann', workspaceId: 'w1' },
      url: 'ws://s',
      token: () => Promise.resolve('ann'),
      socket: (url) => server.socket(url),
    })
    const tab = await openAgentTab({
      ck: await loadCanvasKit(),
      designId: 'd1',
      url: 'ws://s',
      token: () => Promise.resolve('claude'),
      socket: (url) => server.socket(url),
      sources: {},
      noteMs: 200,
    })
    opened.push(tab)
    try {
      const heard = () => [...ann.presence.others().values()][0]
      tab.show({ layers: ['box'], frame: null }, 'Colouring the box')
      await vi.waitFor(async () => {
        await server.settle()
        expect(heard()).toMatchObject({
          name: 'Claude (agent)',
          agent: true,
          presence: { page: 'p1', pointer: [300, 200], selection: ['box'], frame: null, note: 'Colouring the box' },
        })
      })
      // A call that worked on nothing keeps the pointer where it was, and the note until its time is up.
      tab.show({ layers: [], frame: null })
      await vi.waitFor(
        async () => {
          await server.settle()
          expect(heard()?.presence).toEqual({ page: 'p1', pointer: [300, 200], selection: ['box'], frame: null })
        },
        { timeout: 2000, interval: 20 },
      )
    } finally {
      await ann.close()
    }
  })

  it('a view-only tab refuses a write, and close() closes its socket', async () => {
    const server = memorySync()
    const tab = await openAgentTab({
      ck: await loadCanvasKit(),
      designId: 'd1',
      url: 'ws://s',
      token: () => Promise.resolve('viewer'),
      socket: (url) => server.socket(url),
      sources: {},
    })
    expect(tab.readOnly()).toBe(true)
    expect(() => tab.session.run('node.rename', { id: 'box', name: 'Sun' })).toThrow(VIEW_ONLY)
    await tab.close()
    await server.settle()
    expect(server.sockets.every((socket) => socket.closed)).toBe(true)
  })
})
