import { afterEach, describe, expect, it } from 'vitest'

import { TOOLS } from './endpoint.ts'
import { SESSION_IDLE_MS } from './limits.ts'
import { BASE_URL, type TestServer, testServer } from './test-client.ts'

const POINTER = `Bearer resource_metadata="${BASE_URL}/.well-known/oauth-protected-resource/mcp"`

const INITIALIZE = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'raw', version: '1' } },
}

let server: TestServer

afterEach(async () => {
  await server.endpoint.close()
})

/** A POST to `/mcp` with `token`, and the session id when given. */
function post(body: unknown, token?: string, sessionId?: string): Request {
  return new Request(`${BASE_URL}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(sessionId ? { 'mcp-session-id': sessionId, 'mcp-protocol-version': '2025-06-18' } : {}),
    },
    body: JSON.stringify(body),
  })
}

describe('mcpEndpoint', () => {
  it('answers 401 with the resource metadata pointer to a request without a token', async () => {
    server = testServer()
    const response = await server.fetch(post(INITIALIZE))
    expect(response.status).toBe(401)
    expect(response.headers.get('www-authenticate')).toBe(POINTER)
  })

  it('answers 401 with the pointer to a token the API refuses', async () => {
    server = testServer()
    const token = server.api.grant().token()
    server.api.refuse(token)
    const response = await server.fetch(post(INITIALIZE, token))
    expect(response.status).toBe(401)
    expect(response.headers.get('www-authenticate')).toBe(POINTER)
    expect((await server.fetch(post(INITIALIZE, 'not-a-token'))).status).toBe(401)
  })

  it('gives the instructions and fixed capabilities on initialize', async () => {
    server = testServer()
    const { client } = await server.connect(server.api.grant().token())
    expect(client.getServerCapabilities()).toEqual({ tools: { listChanged: false } })
    expect(client.getServerVersion()).toMatchObject({ name: 'dazbee', version: 'test' })
    const instructions = client.getInstructions() ?? ''
    for (const words of ['y DOWN', 'top-left corner', 'list_commands', 'one undo step', 'render_frame', 'check_frame'])
      expect(instructions).toContain(words)
  })

  it('lists exactly this server’s tools, each with an object schema, a description and annotations', async () => {
    server = testServer()
    const { client } = await server.connect(server.api.grant().token())
    const { tools } = await client.listTools()
    expect(tools.map(({ name }) => name)).toEqual([
      'list_brands',
      'list_designs',
      'list_assets',
      'create_design',
      'list_commands',
      'describe_command',
    ])
    expect(tools.map(({ name }) => name)).toEqual(TOOLS.map(({ name }) => name))
    for (const tool of tools) {
      expect(tool.inputSchema.type, tool.name).toBe('object')
      expect(tool.description?.length, tool.name).toBeGreaterThan(40)
      expect(typeof tool.annotations?.readOnlyHint, tool.name).toBe('boolean')
      expect(tool.annotations, tool.name).toMatchObject({ destructiveHint: false, openWorldHint: false })
      expect(tool.title, tool.name).toBeTruthy()
    }
    const readOnly = Object.fromEntries(tools.map(({ name, annotations }) => [name, annotations?.readOnlyHint]))
    expect(readOnly).toMatchObject({ list_brands: true, create_design: false, describe_command: true })
  })

  it('answers its health with its build', async () => {
    server = testServer()
    const response = await server.fetch(new Request(`${BASE_URL}/health`))
    expect(await response.json()).toEqual({ build: 'test' })
  })

  it('answers 405 to a GET: it opens no stream', async () => {
    server = testServer()
    const token = server.api.grant().token()
    const response = await server.fetch(
      new Request(`${BASE_URL}/mcp`, { headers: { authorization: `Bearer ${token}`, accept: 'text/event-stream' } }),
    )
    expect(response.status).toBe(405)
  })

  it('answers each call with one JSON response', async () => {
    server = testServer()
    const token = server.api.grant().token()
    const response = await server.fetch(post(INITIALIZE, token))
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(response.headers.get('mcp-session-id')).toBeTruthy()
  })

  it('answers 404 once a session has been idle past its time', async () => {
    server = testServer()
    const agent = await server.connect(server.api.grant().token())
    server.wait(SESSION_IDLE_MS - 1000)
    await agent.call('list_brands')
    server.wait(SESSION_IDLE_MS - 1000)
    await agent.call('list_brands')
    server.wait(SESSION_IDLE_MS + 1)
    await expect(agent.call('list_brands')).rejects.toMatchObject({ code: 404 })
  })

  it('ends an access’s oldest session when it starts a fifth', async () => {
    server = testServer()
    const access = server.api.grant()
    const first = await server.connect(access.token())
    const others = []
    for (let i = 0; i < 4; i++) {
      server.wait(1000)
      others.push(await server.connect(access.token()))
    }
    await expect(first.call('list_brands')).rejects.toMatchObject({ code: 404 })
    for (const other of others) expect((await other.call('list_brands')).isError).toBeFalsy()
  })

  it('leaves another access’s sessions alone when an access starts a fifth', async () => {
    server = testServer()
    const other = await server.connect(server.api.grant().token())
    const access = server.api.grant()
    for (let i = 0; i < 5; i++) await server.connect(access.token())
    expect((await other.call('list_brands')).isError).toBeFalsy()
  })

  it('answers 404 to another access’s token on a session', async () => {
    server = testServer()
    const agent = await server.connect(server.api.grant().token())
    agent.token = server.api.grant().token()
    await expect(agent.call('list_brands')).rejects.toMatchObject({ code: 404 })
  })

  it('goes on in the same session with a refreshed token of the same access', async () => {
    server = testServer()
    const access = server.api.grant()
    const agent = await server.connect(access.token())
    const sessionId = (agent.client.transport as { sessionId?: string }).sessionId
    server.api.refuse(agent.token)
    agent.token = access.token()
    expect(await agent.json('list_brands')).toHaveLength(2)
    expect((agent.client.transport as { sessionId?: string }).sessionId).toBe(sessionId)
  })

  it('answers 401 with the pointer when the API refuses the token on a tool’s call, and keeps the session', async () => {
    server = testServer()
    const access = server.api.grant()
    const token = access.token()
    const init = await server.fetch(post(INITIALIZE, token))
    const sessionId = init.headers.get('mcp-session-id') ?? ''
    server.api.refuseAfterMe(token)
    const call = { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'list_brands', arguments: {} } }
    const refused = await server.fetch(post(call, token, sessionId))
    expect(refused.status).toBe(401)
    expect(refused.headers.get('www-authenticate')).toBe(POINTER)
    const answered = await server.fetch(post(call, access.token(), sessionId))
    expect(answered.status).toBe(200)
  })

  it('answers 404 to a session id it never gave', async () => {
    server = testServer()
    const token = server.api.grant().token()
    const call = { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }
    expect((await server.fetch(post(call, token, 'no-such-session'))).status).toBe(404)
  })

  it('ends a session the client deletes', async () => {
    server = testServer()
    const agent = await server.connect(server.api.grant().token())
    const transport = agent.client.transport as unknown as { sessionId: string; terminateSession(): Promise<void> }
    const { sessionId } = transport
    await transport.terminateSession()
    const call = { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }
    expect((await server.fetch(post(call, agent.token, sessionId))).status).toBe(404)
  })
})
