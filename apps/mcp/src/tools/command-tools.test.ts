import { afterEach, describe, expect, it } from 'vitest'

import { type CatalogEntry, commandCatalog } from '@dazbee/doc'

import { type TestClient, type TestServer, testServer, textOf } from '../test-client.ts'

let server: TestServer

afterEach(async () => {
  await server.endpoint.close()
})

async function connect(): Promise<TestClient> {
  server = testServer()
  return server.connect(server.api.grant().token())
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
      'page.update',
      'page.duplicate',
      'page.move',
      'page.delete',
    ])
    expect(await listed(agent, 'Brand')).toEqual(['node.bind'])
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
