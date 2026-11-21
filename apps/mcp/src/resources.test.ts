import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js'
import { afterEach, describe, expect, it } from 'vitest'

import { commandCatalog } from '@dazbee/doc'
import { SYNC_CLOSE } from '@dazbee/schema'

import { type TestClient, type TestServer, testServer } from './test-client.ts'

let server: TestServer

afterEach(async () => {
  await server.endpoint.close()
})

/** The design the tests open. */
const LAUNCH = { brand: 'brand-summer', design: 'design-launch' }

/** A client of a new access, connected to a new server. */
async function agentOf(limits?: Parameters<typeof testServer>[0]) {
  server = testServer(limits)
  return server.connect(server.api.addAccess().token())
}

/** The resource at `uri`, which must be one JSON text, parsed. */
async function readJson(agent: TestClient, uri: string): Promise<unknown> {
  const { contents } = await agent.client.readResource({ uri })
  expect(contents[0]).toMatchObject({ uri, mimeType: 'application/json' })
  const [first] = contents
  return JSON.parse(first && 'text' in first ? first.text : '')
}

/** The error reading `uri` answers, which it must. */
async function readError(agent: TestClient, uri: string): Promise<McpError> {
  const error = await agent.client.readResource({ uri }).then(
    () => undefined,
    (thrown: unknown) => thrown,
  )
  expect(error).toBeInstanceOf(McpError)
  return error as McpError
}

describe('RESOURCES', () => {
  it('lists the catalog and the open design, each as JSON with a description', async () => {
    const agent = await agentOf()
    const { resources } = await agent.client.listResources()
    expect(resources.map(({ uri, mimeType }) => [uri, mimeType])).toEqual([
      ['dazbee://commands', 'application/json'],
      ['dazbee://design', 'application/json'],
    ])
    for (const listed of resources) expect(listed.description?.length).toBeGreaterThan(40)
  })
})

describe('RESOURCE_TEMPLATES', () => {
  it('lists the templates of one command and one frame, each as JSON with a description', async () => {
    const agent = await agentOf()
    const { resourceTemplates } = await agent.client.listResourceTemplates()
    expect(resourceTemplates.map(({ uriTemplate, mimeType }) => [uriTemplate, mimeType])).toEqual([
      ['dazbee://command/{name}', 'application/json'],
      ['dazbee://frame/{id}', 'application/json'],
    ])
    for (const listed of resourceTemplates) expect(listed.description?.length).toBeGreaterThan(40)
  })
})

describe('readResource', () => {
  it('reads the catalog as describe_command gives each command, without design.restore', async () => {
    const agent = await agentOf()
    const catalog = (await readJson(agent, 'dazbee://commands')) as { name: string }[]
    const names = commandCatalog()
      .map(({ name }) => name)
      .filter((name) => name !== 'design.restore')
    expect(catalog.map(({ name }) => name)).toEqual(names)
    const [first] = names
    expect(catalog[0]).toEqual(await agent.json('describe_command', { command: first }))
  })

  it('reads one command as describe_command gives it', async () => {
    const agent = await agentOf()
    expect(await readJson(agent, 'dazbee://command/node.create')).toEqual(
      await agent.json('describe_command', { command: 'node.create' }),
    )
  })

  it('reads the open design as read_design gives it, and a frame as read_frame gives it', async () => {
    const agent = await agentOf()
    await agent.call('open_design', LAUNCH)
    expect(await readJson(agent, 'dazbee://design')).toEqual(await agent.json('read_design'))
    expect(await readJson(agent, 'dazbee://frame/sq')).toEqual(await agent.json('read_frame', { frame: 'sq' }))
  })

  it('answers not found for an unknown resource, a command or frame there is none of, and the design with none open', async () => {
    const agent = await agentOf()
    for (const uri of ['dazbee://design', 'dazbee://frame/sq']) {
      const error = await readError(agent, uri)
      expect(error.code).toBe(ErrorCode.InvalidParams)
      expect(error.message.endsWith(`: Resource ${uri} not found: No design is open; call open_design first`)).toBe(
        true,
      )
    }
    for (const uri of ['dazbee://nothing', 'https://app.test/mcp']) {
      const error = await readError(agent, uri)
      expect(error.code).toBe(ErrorCode.InvalidParams)
      expect(error.message.endsWith(`: Resource ${uri} not found`)).toBe(true)
    }
    await agent.call('open_design', LAUNCH)
    for (const uri of ['dazbee://frame/nope', 'dazbee://command/design.restore', 'dazbee://command/%E0%A4%A']) {
      const error = await readError(agent, uri)
      expect(error.code).toBe(ErrorCode.InvalidParams)
      expect(error.message.endsWith(`: Resource ${uri} not found`)).toBe(true)
    }
  })

  it('answers not found for the design once it is closed for good, saying why', async () => {
    const agent = await agentOf()
    await agent.call('open_design', LAUNCH)
    const sync = server.sync('design-launch')
    sync.sockets.at(-1)?.closeWith(SYNC_CLOSE.designDeleted)
    await sync.settle()
    const error = await readError(agent, 'dazbee://design')
    expect(error.code).toBe(ErrorCode.InvalidParams)
    expect(
      error.message.endsWith(
        ': Resource dazbee://design not found: The design was deleted, so it is closed; open another with open_design',
      ),
    ).toBe(true)
  })

  it('counts each read against the access’s calls', async () => {
    const agent = await agentOf({ limits: { callsBurst: 1 } })
    await readJson(agent, 'dazbee://commands')
    const error = await readError(agent, 'dazbee://commands')
    expect(error.code).toBe(ErrorCode.InvalidRequest)
    expect(error.message).toContain('This agent is calling faster than Dazbee takes; try again in 1 second.')
  })
})
