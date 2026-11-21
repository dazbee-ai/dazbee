import type { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { compactTree } from '@dazbee/doc'
import { testDesign } from '@dazbee/doc/test-design'
import { openAgentTab } from '@dazbee/editor/agent-tab'
import { frameWarnings } from '@dazbee/export'
import { FALLBACK_FAMILIES } from '@dazbee/fonts'
import { loadFontFiles } from '@dazbee/fonts/node'
import { loadCanvasKit } from '@dazbee/renderer/node'
import { type Design, type DesignInput, parseDesign, SYNC_CLOSE } from '@dazbee/schema'

import { MAX_DESIGN_CALLS_WAITING, MAX_TREE_BYTES } from '../limits.ts'
import { REOPENED } from '../open-design.ts'
import { TEST_SYNC_TOKEN_MS } from '../test-api.ts'
import { type TestClient, type TestServer, testServer, textOf } from '../test-client.ts'

let server: TestServer

afterEach(async () => {
  await server.endpoint.close()
})

/** The square and banner frames of the test design, as read_design gives them. */
const FRAMES = [
  { id: 'sq', name: 'Square', width: 1080, height: 1080, x: 0, y: 0 },
  { id: 'banner', name: 'Banner', width: 320, height: 50, x: 1280, y: 0 },
]
/** What is left of an access token when the agent last calls before it pauses. */
const TOKEN_LEFT_MS = 5 * 60 * 1000
/** The design the tests open. */
const LAUNCH = { brand: 'brand-summer', design: 'design-launch' }
/** Another brand's design. */
const SNOW = { brand: 'brand-winter', design: 'design-snow' }

/** A client of an access with `options`, connected to a new server holding `designs`. */
async function agentOf(options?: Parameters<TestServer['api']['addAccess']>[0], designs?: Record<string, DesignInput>) {
  server = testServer(designs ? { designs } : {})
  return server.connect(server.api.addAccess(options).token())
}

/** The design the sync server in memory holds now. */
function storedDesign(designId: string): Design {
  const parsed = parseDesign(server.sync(designId).state())
  if (!parsed.success) throw new Error(parsed.errors.join('\n'))
  return parsed.design
}

/** The text of a tool error, which it must be. */
async function refusal(agent: TestClient, tool: string, args?: Record<string, unknown>) {
  const result = await agent.call(tool, args)
  expect(result.isError).toBe(true)
  return textOf(result)
}

describe('open_design', () => {
  it('opens the design and gives its pages and frames, the brand kit’s tokens, and that it may edit', async () => {
    const agent = await agentOf()
    expect(await agent.json('open_design', LAUNCH)).toEqual({
      name: 'Launch',
      mayEdit: true,
      pages: [{ id: 'p1', name: 'Page 1', frames: FRAMES }],
      tokens: [
        { token: 'brand:primary', name: 'Primary', value: '#FF5A36FF' },
        { token: 'brand:heading', name: 'Heading', value: 'Brand Serif' },
        {
          token: 'brand:headline',
          name: 'Headline',
          value: {
            fontFamily: 'Brand Serif',
            fontWeight: 700,
            fontStyle: 'normal',
            lineHeight: 1.1,
            letterSpacing: { unit: 'percent', value: -1 },
          },
        },
      ],
      waiting: 0,
      notices: [],
    })
    expect(server.api.syncTokenOf('sync-1')).toEqual({ designId: 'design-launch', writes: true, agent: 'test (agent)' })
  })

  it('says a view access’s tab may not edit', async () => {
    const agent = await agentOf({ writes: false })
    expect(await agent.json('open_design', LAUNCH)).toMatchObject({ name: 'Launch', mayEdit: false })
  })

  it('answers a design the access can’t see as not found', async () => {
    const agent = await agentOf({ brandIds: ['brand-winter'] })
    expect(await refusal(agent, 'open_design', LAUNCH)).toBe('No such brand.')
    expect(await refusal(agent, 'open_design', { brand: 'brand-winter', design: 'design-launch' })).toBe(
      'There is no design “design-launch” in this brand; list_designs names them.',
    )
    expect(server.api.syncTokenOf('sync-1')).toBeUndefined()
  })

  it('opens a design while an earlier session that was never ended holds the access’s tab, closing that tab', async () => {
    server = testServer()
    const access = server.api.addAccess()
    const first = await server.connect(access.token())
    expect((await first.call('open_design', LAUNCH)).isError).toBeFalsy()
    // The first client goes away without ending its session, as a finished chat does.
    const second = await server.connect(access.token())
    const opened = await second.call('open_design', LAUNCH)
    expect(opened.isError ? textOf(opened) : 'opened').toBe('opened')
    expect(await refusal(first, 'read_design')).toBe(
      'The design was opened again in another session of this agent, so it is closed here.',
    )
    expect(await refusal(first, 'read_design')).toBe('No design is open; call open_design first.')
    expect((await second.call('read_design')).isError).toBeFalsy()
  })

  it('leaves the earlier session’s tab as it was when the newer session’s design fails to open', async () => {
    server = testServer()
    const access = server.api.addAccess()
    const first = await server.connect(access.token())
    expect((await first.call('open_design', LAUNCH)).isError).toBeFalsy()
    const snow = server.sync('design-snow')
    const opening = snow.socket
    snow.socket = (url) => {
      const socket = opening(url)
      queueMicrotask(() => socket.closeWith(SYNC_CLOSE.designDeleted))
      return socket
    }
    const second = await server.connect(access.token())
    expect((await second.call('open_design', SNOW)).isError).toBe(true)
    expect((await first.call('read_design')).isError).toBeFalsy()
  })

  it('refuses a newer session while the earlier session’s tab holds steps Dazbee hasn’t stored, and keeps them', async () => {
    server = testServer()
    const access = server.api.addAccess()
    const first = await server.connect(access.token())
    expect((await first.call('open_design', LAUNCH)).isError).toBeFalsy()
    const sync = server.sync('design-launch')
    sync.down()
    const renaming = first.call('run_command', { command: 'node.rename', input: { id: 'box', name: 'Kept' } })
    await new Promise((resolve) => setTimeout(resolve, 100))
    const second = await server.connect(access.token())
    expect(await refusal(second, 'open_design', SNOW)).toBe(
      'This agent’s design in another session holds steps Dazbee hasn’t stored yet; try again once they are stored.',
    )
    sync.up()
    await renaming
    await vi.waitFor(() => expect(sync.nameOf('box')).toBe('Kept'), { timeout: 15_000 })
  })

  it('tells an earlier session back from a pause that a newer one took the access’s tab, leaving the newer one open', async () => {
    server = testServer()
    const access = server.api.addAccess({ tokenMs: TOKEN_LEFT_MS })
    const first = await server.connect(access.token())
    await first.json('open_design', LAUNCH)
    const sync = server.sync('design-launch')
    server.wait(Math.max(TOKEN_LEFT_MS, TEST_SYNC_TOKEN_MS) + 1)
    const asked = server.api.requests()
    sync.sockets.at(-1)?.closeWith(SYNC_CLOSE.tokenExpired)
    await vi.waitFor(() => expect(server.api.requests()).toBeGreaterThan(asked), { timeout: 5000 })
    await sync.settle()
    const second = await server.connect(access.token())
    expect((await second.call('open_design', LAUNCH)).isError).toBeFalsy()
    first.token = access.token()
    expect(await refusal(first, 'read_design')).toBe(
      'The design was opened again in another session of this agent, so it is closed here.',
    )
    expect(await refusal(first, 'read_design')).toBe('No design is open; call open_design first.')
    expect((await second.call('read_design')).isError).toBeFalsy()
  })

  it('answers busy past MCP_AGENT_TABS in the server, and takes over the oldest past MCP_AGENT_TABS_PER_ACCESS', async () => {
    const limits = { agentTabs: 6, agentTabsPerAccess: 2 }
    server = testServer({ limits })
    const accesses = Array.from({ length: limits.agentTabs / limits.agentTabsPerAccess + 1 }, () =>
      server.api.addAccess(),
    )
    const [first, ...rest] = accesses
    if (!first) throw new Error('no access')
    for (const access of rest.slice(0, -1)) {
      for (let tab = 0; tab < limits.agentTabsPerAccess; tab++) {
        const agent = await server.connect(access.token())
        expect((await agent.call('open_design', LAUNCH)).isError).toBeFalsy()
      }
    }
    const firsts = [await server.connect(first.token()), await server.connect(first.token())]
    for (const agent of firsts) expect((await agent.call('open_design', LAUNCH)).isError).toBeFalsy()
    const third = await server.connect(first.token())
    expect((await third.call('open_design', LAUNCH)).isError).toBeFalsy()
    expect(await refusal(firsts[0] as TestClient, 'read_design')).toMatch(/opened again in another session/)
    expect((await firsts[1]?.call('read_design'))?.isError).toBeFalsy()
    const last = await server.connect(rest.at(-1)?.token() ?? '')
    expect(await refusal(last, 'open_design', LAUNCH)).toMatch(/as many designs open for agents as it can hold/)
    // A session ending lets its tab go.
    await (firsts[1]?.client.transport as StreamableHTTPClientTransport).terminateSession()
    expect((await last.call('open_design', LAUNCH)).isError).toBeFalsy()
  })

  it('holds one design open for each access unless set otherwise, and as many tabs as 30 accesses take', async () => {
    server = testServer()
    const accesses = Array.from({ length: 31 }, () => server.api.addAccess())
    const agents = []
    for (const access of accesses.slice(0, 30)) {
      const agent = await server.connect(access.token())
      expect((await agent.call('open_design', LAUNCH)).isError).toBeFalsy()
      agents.push(agent)
    }
    const second = await server.connect(accesses[0]?.token() ?? '')
    expect((await second.call('open_design', LAUNCH)).isError).toBeFalsy()
    expect(await refusal(agents[0] as TestClient, 'read_design')).toMatch(/opened again in another session/)
    const last = await server.connect(accesses[30]?.token() ?? '')
    expect(await refusal(last, 'open_design', LAUNCH)).toMatch(/as many designs open for agents as it can hold/)
  })

  it('closes the tab when the design is deleted, and says so once', async () => {
    const agent = await agentOf()
    await agent.json('open_design', LAUNCH)
    const sync = server.sync('design-launch')
    sync.sockets.at(-1)?.closeWith(SYNC_CLOSE.designDeleted)
    await sync.settle()
    expect(await refusal(agent, 'read_design')).toBe(
      'The design was deleted, so it is closed; open another with open_design.',
    )
    expect(await refusal(agent, 'read_design')).toBe('No design is open; call open_design first.')
  })

  it('opens the design again once the agent comes back with a new token past both expiries, saying undo was lost', async () => {
    server = testServer()
    const access = server.api.addAccess({ tokenMs: TOKEN_LEFT_MS })
    const agent = await server.connect(access.token())
    await agent.json('open_design', LAUNCH)
    const sync = server.sync('design-launch')
    const sockets = sync.sockets.length
    server.wait(Math.max(TOKEN_LEFT_MS, TEST_SYNC_TOKEN_MS) + 1)
    const asked = server.api.requests()
    sync.sockets.at(-1)?.closeWith(SYNC_CLOSE.tokenExpired)
    // The link asks for a new sync token with the expired access token, and is refused.
    await vi.waitFor(() => expect(server.api.requests()).toBeGreaterThan(asked), { timeout: 5000 })
    await sync.settle()
    agent.token = access.token()
    const result = await agent.call('read_design')
    expect(result.isError).toBeFalsy()
    expect(JSON.parse(textOf(result))).toMatchObject({ name: 'Launch', pages: [{ frames: FRAMES }] })
    expect(result.content[1]).toEqual({ type: 'text', text: REOPENED })
    expect(sync.sockets.length).toBeGreaterThan(sockets)
    expect((await agent.call('read_design')).content).toHaveLength(1)
  })

  it('answers the six calls Claude sends at once: opening the design, and reading and checking two frames', async () => {
    const agent = await agentOf()
    const release = server.api.hold()
    const calls = [
      agent.call('open_design', LAUNCH),
      agent.call('read_frame', { frame: 'sq' }),
      agent.call('read_frame', { frame: 'banner' }),
      agent.call('check_frame', { frame: 'sq' }),
      agent.call('check_frame', { frame: 'banner' }),
      agent.call('read_design'),
    ]
    release()
    const refused = (await Promise.all(calls)).filter((result) => result.isError).map(textOf)
    expect(refused).toEqual([])
  })

  it('takes a few calls on the design at once, and refuses those past them', async () => {
    const agent = await agentOf()
    const release = server.api.hold()
    const held = Array.from({ length: MAX_DESIGN_CALLS_WAITING }, () => agent.call('open_design', LAUNCH))
    expect(await refusal(agent, 'read_design')).toBe(
      'Other calls on the open design are still being answered; wait for their answers first.',
    )
    release()
    for (const result of await Promise.all(held)) expect(result.isError).toBeFalsy()
  })
})

describe('close_design', () => {
  it('closes the open design and lets its tab’s slot go at once', async () => {
    server = testServer({ limits: { agentTabs: 1 } })
    const agent = await server.connect(server.api.addAccess().token())
    await agent.json('open_design', LAUNCH)
    expect(await agent.json('close_design')).toEqual({ closed: true })
    expect(await refusal(agent, 'read_design')).toBe('No design is open; call open_design first.')
    const other = await server.connect(server.api.addAccess().token())
    expect((await other.call('open_design', LAUNCH)).isError).toBeFalsy()
  })

  it('says none was closed while no design is open, and leaves the session open for another', async () => {
    const agent = await agentOf()
    expect(await agent.json('close_design')).toEqual({ closed: false })
    expect((await agent.call('open_design', LAUNCH)).isError).toBeFalsy()
  })
})

describe('read_design', () => {
  it('says to call open_design first while no design is open', async () => {
    const agent = await agentOf()
    expect(await refusal(agent, 'read_design')).toBe('No design is open; call open_design first.')
  })

  it('closes the design once the access no longer sees its brand', async () => {
    server = testServer()
    const access = server.api.addAccess()
    const agent = await server.connect(access.token())
    await agent.json('open_design', LAUNCH)
    access.limitTo(['brand-winter'])
    expect(await refusal(agent, 'read_frame', { frame: 'sq' })).toBe(
      'This agent may no longer open the design, so it is closed.',
    )
    expect(await refusal(agent, 'read_design')).toBe('No design is open; call open_design first.')
  })

  it('shows another tab’s change', async () => {
    const agent = await agentOf()
    await agent.json('open_design', LAUNCH)
    const sync = server.sync('design-launch')
    const other = await openAgentTab({
      ck: await loadCanvasKit(),
      designId: 'design-launch',
      url: 'ws://sync.test',
      token: () => Promise.resolve('bob'),
      socket: (url) => sync.socket(url),
      sources: {},
    })
    try {
      other.session.run('frame.update', { frameId: 'sq', name: 'Post' })
      await sync.settle()
      expect(await agent.json('read_design')).toMatchObject({ pages: [{ frames: [{ id: 'sq', name: 'Post' }, {}] }] })
    } finally {
      await other.close()
    }
  })
})

describe('read_frame', () => {
  it('gives the compact tree of the frame, with the fields asked for, cut to maxBytes', async () => {
    const agent = await agentOf()
    await agent.json('open_design', LAUNCH)
    const design = storedDesign('design-launch')
    expect(await agent.json('read_frame', { frame: 'sq' })).toEqual(compactTree(design, 'sq'))
    const cut = { fields: ['x', 'fills'], maxBytes: 1024 }
    const tree = await agent.json('read_frame', { frame: 'sq', ...cut })
    expect(tree).toEqual(compactTree(design, 'sq', cut))
    expect(new TextEncoder().encode(JSON.stringify(tree)).length).toBeLessThanOrEqual(1024)
  })

  it('reads the fields it knows, a text’s fontSize among them, and skips the others with a note naming them', async () => {
    const agent = await agentOf()
    await agent.json('open_design', LAUNCH)
    const result = await agent.call('read_frame', { frame: 'sq', fields: ['fontSize', 'nope'] })
    expect(result.isError).toBeFalsy()
    const tree = JSON.parse(textOf(result))
    expect(tree.children).toContainEqual(expect.objectContaining({ id: 'headline', fontSize: 84 }))
    const notes = result.content.slice(1).map((block) => (block.type === 'text' ? block.text : ''))
    expect(notes).toHaveLength(1)
    expect(notes[0]).toMatch(/“nope”/)
    expect(notes[0]).toMatch(/fills.*fontSize/)
  })

  it('refuses a maxBytes over what an answer holds and a frame the design lacks', async () => {
    const agent = await agentOf()
    await agent.json('open_design', LAUNCH)
    expect(await refusal(agent, 'read_frame', { frame: 'sq', maxBytes: MAX_TREE_BYTES + 1 })).toMatch(/^`maxBytes`/)
    expect(await refusal(agent, 'read_frame', { frame: 'nope' })).toBe(
      'The open design has no frame “nope”; read_design lists its frames.',
    )
  })
})

describe('read_layer', () => {
  it('gives the layer’s record as the design holds it, with its children’s ids', async () => {
    const agent = await agentOf()
    await agent.json('open_design', LAUNCH)
    const design = storedDesign('design-launch')
    expect(await agent.json('read_layer', { id: 'headline' })).toEqual({
      id: 'headline',
      ...design.nodes['headline'],
      children: [],
    })
    expect(await agent.json('read_layer', { id: 'sq' })).toMatchObject({
      id: 'sq',
      type: 'frame',
      name: 'Square',
      children: ['box', 'headline'],
    })
  })
})

describe('check_frame', () => {
  it('gives what frameWarnings gives on the same design, and a missing font for a family no file has', async () => {
    const design = testDesign() as { nodes: Record<string, { props: { style?: object } }> }
    const headline = design.nodes['headline']
    if (headline) headline.props.style = { fontFamily: 'Nowhere Sans', fontSize: 84, color: '#111111FF' }
    const agent = await agentOf(undefined, { 'design-launch': design as DesignInput })
    await agent.json('open_design', LAUNCH)
    const warnings = await agent.json('check_frame', { frame: 'sq' })
    const bytes = {
      fonts: loadFontFiles().map(({ family, bytes }) => ({ family, bytes })),
      fallbackFamilies: [...FALLBACK_FAMILIES],
      images: {},
    }
    expect(warnings).toEqual(frameWarnings(await loadCanvasKit(), storedDesign('design-launch'), 'sq', bytes))
    expect(warnings).toContainEqual(expect.objectContaining({ layerId: 'headline', kind: 'missingFont' }))
  })
})
