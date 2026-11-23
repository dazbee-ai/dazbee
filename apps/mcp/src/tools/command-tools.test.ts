import { afterEach, describe, expect, it, vi } from 'vitest'

import { type CatalogEntry, commandCatalog, openSession, VIEW_ONLY } from '@dazbee/doc'
import { registerBuggyCommands } from '@dazbee/doc/test-commands'
import { testDesign } from '@dazbee/doc/test-design'
import { openTestStore } from '@dazbee/doc/test-store'
import { type AgentTab, openAgentTab } from '@dazbee/editor/agent-tab'
import type { MemorySync } from '@dazbee/editor/test-link'
import { type AgentWarning, runAgentBatchWithWarnings, whenWarned } from '@dazbee/export'
import { FALLBACK_FAMILIES } from '@dazbee/fonts'
import { loadFontFiles } from '@dazbee/fonts/node'
import { loadCanvasKit } from '@dazbee/renderer/node'
import { brandVariables, SYNC_CLOSE } from '@dazbee/schema'

import { REOPENED } from '../open-design.ts'
import { NOT_CONFIRMED } from '../store-wait.ts'
import { TEST_BRAND_KIT, TEST_SYNC_TOKEN_MS } from '../test-api.ts'
import { type TestClient, type TestServer, testServer, textOf } from '../test-client.ts'

let server: TestServer
/** The second tabs the tests opened on a design. */
const others: AgentTab[] = []

afterEach(async () => {
  for (const tab of others.splice(0)) await tab.close()
  await server.endpoint.close()
})

/** What is left of an access token when the agent last calls before it pauses. */
const TOKEN_LEFT_MS = 5 * 60 * 1000
/** The design the tests open. */
const LAUNCH = { brand: 'brand-summer', design: 'design-launch' }
/** A box on the square frame and a text inside it, the text reaching the box through a step reference. */
const CARD = [
  {
    command: 'node.create',
    as: 'card',
    input: {
      id: 'card',
      parentId: 'sq',
      layer: { type: 'box', name: 'Card', props: { x: 100, y: 200, width: 400, height: 300 } },
    },
  },
  {
    command: 'node.create',
    input: {
      id: 'card-title',
      parentId: { $ref: 'card' },
      layer: {
        type: 'text',
        name: 'Title',
        props: {
          x: 120,
          y: 220,
          width: 360,
          height: 60,
          text: 'New in',
          style: { fontFamily: 'Noto Sans', fontSize: 40, color: '#111111FF' },
        },
      },
    },
  },
]

/** An agent of an access with `options`, its design open, and a second tab on the design, as Bob's. */
async function withSecondTab(options?: Parameters<TestServer['api']['addAccess']>[0]) {
  server = testServer()
  const agent = await server.connect(server.api.addAccess(options).token())
  expect((await agent.call('open_design', LAUNCH)).isError).toBeFalsy()
  const sync = server.sync('design-launch')
  const other = await openAgentTab({
    ck: await loadCanvasKit(),
    designId: 'design-launch',
    url: 'ws://sync.test',
    token: () => Promise.resolve('bob'),
    socket: (url) => sync.socket(url),
    sources: {},
  })
  others.push(other)
  return { agent, sync, other }
}

/** The change sets the server stored. */
function accepted(sync: MemorySync) {
  return sync.journal.rows.journal.filter((entry) => entry.kind === 'accepted')
}

/** The change sets the agent's tab, the design's first socket, sent. */
function changeSetsSent(sync: MemorySync) {
  return (sync.sockets[0]?.sent ?? []).filter((message) => message.type === 'changes')
}

async function connect(): Promise<TestClient> {
  server = testServer()
  return server.connect(server.api.addAccess().token())
}

/** The catalog entry of the command named `name`. */
function entryOf(name: string): CatalogEntry {
  const entry = commandCatalog().find((command) => command.name === name)
  if (!entry) throw new Error(`no command ${name}`)
  return entry
}

/** The command names `list_commands` gives, one per line. */
async function listed(agent: TestClient, filter?: string): Promise<string[]> {
  const result = await agent.call('list_commands', filter === undefined ? {} : { filter })
  expect(result.isError).toBeFalsy()
  return textOf(result)
    .split('\n')
    .map((line) => line.slice(0, line.indexOf(':')))
}

describe('list_commands', () => {
  it('lists every command but design.restore, one line each', async () => {
    const agent = await connect()
    const names = commandCatalog()
      .map(({ name }) => name)
      .filter((name) => name !== 'design.restore')
    expect(await listed(agent)).toEqual(names)
  })

  it('gives each command’s description and input fields, marking those that may be left out', async () => {
    const agent = await connect()
    const text = textOf(await agent.call('list_commands', { filter: 'node.rename' }))
    const entry = entryOf('node.rename')
    expect(text.startsWith(`node.rename: ${entry.description}`)).toBe(true)
    expect(text).toMatch(/Input: .*\bid\b/)
  })

  it('narrows the list to the commands whose name or description holds the filter, whatever its case', async () => {
    const agent = await connect()
    expect(await listed(agent, 'PAGE.')).toEqual([
      'page.add',
      'page.addMany',
      'page.update',
      'page.duplicate',
      'page.move',
      'page.delete',
    ])
    const brand = commandCatalog()
      .filter(({ name, description }) => `${name} ${description}`.toLowerCase().includes('brand'))
      .map(({ name }) => name)
    expect(brand).toContain('node.bind')
    expect(brand.length).toBeLessThan(commandCatalog().length)
    expect(await listed(agent, 'Brand')).toEqual(brand)
  })

  it('never lists design.restore, even when the filter names it', async () => {
    const agent = await connect()
    const text = textOf(await agent.call('list_commands', { filter: 'restore' }))
    expect(text).not.toContain('design.restore:')
  })

  it('says so when no command matches', async () => {
    const agent = await connect()
    const result = await agent.call('list_commands', { filter: 'no such thing' })
    expect(result.isError).toBeFalsy()
    expect(textOf(result)).toMatch(/^No command matches/)
  })
})

describe('describe_command', () => {
  it('gives the catalog entry: name, description and input as JSON Schema', async () => {
    const agent = await connect()
    const entry = entryOf('frame.add')
    const input: Record<string, unknown> = { ...entry.input }
    delete input.$schema
    expect(await agent.json('describe_command', { command: 'frame.add' })).toEqual({ ...entry, input })
  })

  it('names the props a text layer takes in node.create, so an agent need not guess them', async () => {
    const agent = await connect()
    const entry = (await agent.json('describe_command', { command: 'node.create' })) as {
      input: { properties: { layer: unknown } }
    }
    const schema = JSON.stringify(entry.input.properties.layer)
    for (const prop of ['fontSize', 'fontFamily', 'align', 'shape', 'fills']) expect(schema).toContain(`"${prop}"`)
    expect(schema).toContain('"justify"')
  })

  it('tells an unknown command, and design.restore, as tool errors', async () => {
    const agent = await connect()
    for (const command of ['node.explode', 'design.restore']) {
      const result = await agent.call('describe_command', { command })
      expect(result.isError).toBe(true)
      expect(textOf(result)).toBe(`There is no command “${command}”; list_commands lists them.`)
    }
  })

  it('refuses an unknown argument, naming the one it takes', async () => {
    const agent = await connect()
    const result = await agent.call('describe_command', { name: 'frame.add' })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toBe('Unknown argument `name` (describe_command takes command).')
  })
})

describe('run_command', () => {
  it('answers the result and the warnings once stored, which the second tab then holds', async () => {
    const { agent, sync, other } = await withSecondTab()
    const result = await agent.call('run_command', { command: 'node.rename', input: { id: 'box', name: 'Card' } })
    expect(result.isError).toBeFalsy()
    expect(JSON.parse(textOf(result))).toEqual({ warnings: [] })
    expect(sync.state().nodes['box']).toMatchObject({ name: 'Card' })
    await sync.settle()
    expect(other.design().nodes['box']?.name).toBe('Card')
  })

  it('does not warn a text set in a family the catalog has as having no font file when the step that sets it first runs', async () => {
    const agent = await connect()
    expect((await agent.call('open_design', LAUNCH)).isError).toBeFalsy()
    const answer = (await agent.json('run_command', {
      command: 'node.create',
      input: {
        parentId: 'sq',
        layer: {
          type: 'text',
          name: 'Headline',
          props: {
            x: 40,
            y: 40,
            width: 600,
            height: 100,
            text: 'Sale',
            style: { fontFamily: 'Brand Serif', fontWeight: 700, fontSize: 64, color: '#111111FF' },
          },
        },
      },
    })) as { warnings: AgentWarning[] }
    const checked = (await agent.json('check_frame', { frame: 'sq' })) as AgentWarning[]
    expect(checked.filter(({ kind }) => kind === 'missingFont')).toEqual([])
    expect(answer.warnings).toEqual([])
  })

  it('answers a refused command as a tool error, keeping nothing', async () => {
    const { agent, sync } = await withSecondTab()
    const result = await agent.call('run_command', { command: 'node.rename', input: { id: 'nowhere', name: 'Card' } })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toMatch(/^node\.rename: .+; nothing was changed\.$/)
    expect(accepted(sync)).toHaveLength(0)
  })

  it('answers a change set the server rejects as not kept, with why', async () => {
    const { agent, sync, other } = await withSecondTab()
    // The agent hears nothing while another tab deletes the box, then changes the box it still sees.
    const agentSocket = sync.sockets[0]
    agentSocket?.hold()
    other.session.run('node.delete', { ids: ['box'] })
    await sync.settle()
    const call = agent.call('run_command', { command: 'node.update', input: { ids: ['box'], patch: { x: 5 } } })
    await new Promise((resolve) => setTimeout(resolve, 100))
    agentSocket?.release()
    const result = await call
    expect(result.isError).toBe(true)
    expect(textOf(result)).toMatch(
      /^Not kept: someone changed the same layers at the same time, so the design is as it was/,
    )
    expect(sync.state().nodes['box']).toBeUndefined()
  })

  describe('with a command that faults', () => {
    registerBuggyCommands()

    it('tells a command’s fault as a tool error naming it, keeping nothing', async () => {
      const { agent, sync } = await withSecondTab()
      const result = await agent.call('run_command', { command: 'test.throw', input: { id: 'box' } })
      expect(result.isError).toBe(true)
      expect(textOf(result)).toMatch(/^test\.throw failed inside Dazbee, so nothing was kept/)
      expect(sync.state().nodes['box']).toMatchObject({ props: { x: 100 } })
      expect(accepted(sync)).toHaveLength(0)
    })
  })

  it('answers a step not confirmed when the design closes before the server stores it', async () => {
    const { agent, sync } = await withSecondTab()
    const store = sync.journal.holdNext()
    const call = agent.call('run_command', { command: 'node.rename', input: { id: 'box', name: 'Card' } })
    await vi.waitFor(() => expect(changeSetsSent(sync)).toHaveLength(1))
    sync.sockets[0]?.closeWith(SYNC_CLOSE.designDeleted)
    const result = await call
    expect(result.isError).toBeFalsy()
    expect(result.content[1]).toEqual({ type: 'text', text: NOT_CONFIRMED })
    expect(textOf(await agent.call('read_design'))).toMatch(/^The design was deleted/)
    store()
  })

  it('refuses design.restore before anything runs', async () => {
    const { agent, sync } = await withSecondTab()
    const result = await agent.call('run_command', { command: 'design.restore', input: {} })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toMatch(/^design\.restore is a command agents can’t run, so nothing ran/)
    expect(changeSetsSent(sync)).toHaveLength(0)
  })

  it('refuses each writing tool on a view access’s tab with the view-only reason, sending nothing', async () => {
    const { agent, sync } = await withSecondTab({ writes: false })
    const calls: [string, Record<string, unknown>][] = [
      ['run_command', { command: 'node.rename', input: { id: 'box', name: 'Card' } }],
      ['batch', { steps: CARD }],
      ['undo', {}],
      ['redo', {}],
    ]
    for (const [tool, args] of calls) {
      const result = await agent.call(tool, args)
      expect(result.isError).toBe(true)
      expect(textOf(result)).toBe(`${VIEW_ONLY.charAt(0).toUpperCase()}${VIEW_ONLY.slice(1)}.`)
    }
    await sync.settle()
    expect(changeSetsSent(sync)).toHaveLength(0)
    expect(accepted(sync)).toHaveLength(0)
  })
})

describe('batch', () => {
  it('answers once the server has stored the batch: the journal and the second tab hold it', async () => {
    const { agent, sync, other } = await withSecondTab()
    const store = sync.journal.holdNext()
    let answered = false
    const call = agent.call('batch', { steps: CARD }).finally(() => (answered = true))
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(answered).toBe(false)
    store()
    const result = await call
    expect(result.isError).toBeFalsy()
    expect(JSON.parse(textOf(result))).toMatchObject({
      kept: true,
      steps: [
        { ok: true, result: 'card' },
        { ok: true, result: 'card-title' },
      ],
    })
    // Stored by the time it answers, before anything else is let settle: one change set makes both.
    expect(accepted(sync)).toHaveLength(1)
    expect(JSON.stringify(accepted(sync)[0])).toContain('card-title')
    await sync.settle()
    expect(other.design().nodes['card-title']?.parentId).toBe('card')
  })

  it('answers what runAgentBatchWithWarnings gives for the same steps on a copy of the design', async () => {
    const { agent } = await withSecondTab()
    const copy = openSession(openTestStore(testDesign()))
    const bytes = {
      fonts: loadFontFiles().map(({ family, bytes }) => ({ family, bytes })),
      fallbackFamilies: [...FALLBACK_FAMILIES],
      images: {},
      variables: brandVariables(TEST_BRAND_KIT),
    }
    const expected = await whenWarned(
      runAgentBatchWithWarnings(await loadCanvasKit(), copy, CARD, {
        fontsLoaded: () => Promise.resolve(),
        bytes: () => bytes,
      }),
    )
    expect(expected.kept).toBe(true)
    expect(await agent.json('batch', { steps: CARD })).toEqual(JSON.parse(JSON.stringify(expected)))
  })

  it('warns of what a batch drew over an image, reading the image for the warnings', async () => {
    const agent = await connect()
    await agent.json('open_design', LAUNCH)
    const photo = {
      command: 'node.create',
      input: {
        parentId: 'sq',
        layer: {
          type: 'graphic',
          name: 'Photo',
          props: {
            x: 0,
            y: 0,
            width: 400,
            height: 400,
            shape: { kind: 'rect' },
            fills: [{ type: 'image', assetId: 'asset-bottle', fit: 'fill', opacity: 1 }],
          },
        },
      },
    }
    const answer = (await agent.json('batch', { steps: [photo, ...CARD] })) as { kept: boolean; warningsError?: string }
    expect(answer.kept).toBe(true)
    expect(answer.warningsError).toBeUndefined()
  })

  it('warns of a family the catalog lacks, not of one it has, as check_frame does', async () => {
    const agent = await connect()
    expect((await agent.call('open_design', LAUNCH)).isError).toBeFalsy()
    const text = (id: string, y: number, fontFamily: string) => ({
      command: 'node.create',
      input: {
        id,
        parentId: 'sq',
        layer: {
          type: 'text',
          name: id,
          props: {
            x: 40,
            y,
            width: 600,
            height: 100,
            text: 'Sale',
            style: { fontFamily, fontSize: 48, color: '#111111FF' },
          },
        },
      },
    })
    const answer = (await agent.json('batch', {
      steps: [text('in-catalog', 40, 'Brand Serif'), text('not-in-catalog', 200, 'Nowhere Sans')],
    })) as { warnings: AgentWarning[] }
    expect(answer.warnings.map(({ layerId, kind }) => [layerId, kind])).toEqual([['not-in-catalog', 'missingFont']])
    const checked = (await agent.json('check_frame', { frame: 'sq' })) as AgentWarning[]
    expect(checked.filter(({ layerId }) => layerId.endsWith('catalog'))).toEqual(answer.warnings)
  })

  it('keeps nothing of a batch with a refused step, and answers the refusal', async () => {
    const { agent, sync, other } = await withSecondTab()
    const steps = [...CARD, { command: 'node.rename', input: { id: 'nowhere', name: 'Never' } }]
    const answer = (await agent.json('batch', { steps })) as { kept: boolean; steps: { ok: boolean }[] }
    expect(answer.kept).toBe(false)
    expect(answer.steps.map(({ ok }) => ok)).toEqual([true, true, false])
    await sync.settle()
    expect(accepted(sync)).toHaveLength(0)
    expect(other.design().nodes['card']).toBeUndefined()
  })

  it('refuses a batch holding design.restore before any step runs', async () => {
    const { agent, sync } = await withSecondTab()
    const result = await agent.call('batch', { steps: [...CARD, { command: 'design.restore', input: {} }] })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toMatch(/^design\.restore is a command agents can’t run/)
    await sync.settle()
    expect(changeSetsSent(sync)).toHaveLength(0)
  })
})

describe('undo', () => {
  it('takes back the whole batch, for both tabs, and redo does it again', async () => {
    const { agent, sync, other } = await withSecondTab()
    await agent.json('batch', { steps: CARD })
    expect(textOf(await agent.call('undo'))).toBe('Undid “add”')
    expect(sync.state().nodes['card']).toBeUndefined()
    expect(sync.state().nodes['card-title']).toBeUndefined()
    await sync.settle()
    expect(other.design().nodes['card']).toBeUndefined()
    expect(other.design().nodes['card-title']).toBeUndefined()
    expect(textOf(await agent.call('undo'))).toBe('There is no step of this agent’s to undo')
    expect(textOf(await agent.call('redo'))).toBe('Redid “add”')
    expect(sync.state().nodes['card-title']).toMatchObject({ parentId: 'card' })
    expect(textOf(await agent.call('redo'))).toBe('There is no step of this agent’s to redo')
  })

  it('tells that the design was opened again, even with nothing to undo', async () => {
    server = testServer()
    const access = server.api.addAccess({ tokenMs: TOKEN_LEFT_MS })
    const agent = await server.connect(access.token())
    await agent.json('open_design', LAUNCH)
    const sync = server.sync('design-launch')
    server.wait(Math.max(TOKEN_LEFT_MS, TEST_SYNC_TOKEN_MS) + 1)
    const asked = server.api.requests()
    sync.sockets.at(-1)?.closeWith(SYNC_CLOSE.tokenExpired)
    await vi.waitFor(() => expect(server.api.requests()).toBeGreaterThan(asked), { timeout: 5000 })
    await sync.settle()
    agent.token = access.token()
    const result = await agent.call('undo')
    expect(result.content).toEqual([
      { type: 'text', text: 'There is no step of this agent’s to undo' },
      { type: 'text', text: REOPENED },
    ])
  })

  it('never takes back another tab’s step', async () => {
    const { agent, sync, other } = await withSecondTab()
    other.session.run('node.rename', { id: 'box', name: 'Bob’s' })
    await sync.settle()
    expect(textOf(await agent.call('undo'))).toBe('There is no step of this agent’s to undo')
    expect(sync.state().nodes['box']).toMatchObject({ name: 'Bob’s' })
  })
})
