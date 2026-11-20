// The MCP server as tests drive it: the endpoint over the fake API, and the SDK's own client connected to it
// in-process, with a token the test can change between calls.
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

import { type Endpoint, mcpEndpoint } from './endpoint.ts'
import { type TestApi, testApi } from './test-api.ts'

/** A connected client, and the token it sends, which the test may change. */
export interface TestClient {
  client: Client
  /** The access token sent with every request from now on. */
  token: string
  /** Calls a tool, giving its result as the client got it. */
  call(name: string, args?: Record<string, unknown>): Promise<CallToolResult>
  /** The text of a tool's answer, parsed as JSON. */
  json(name: string, args?: Record<string, unknown>): Promise<unknown>
}

/** The endpoint, the fake API behind it, its clock, and a way to connect clients. */
export interface TestServer {
  api: TestApi
  endpoint: Endpoint
  /** Moves the endpoint's clock on. */
  wait(ms: number): void
  /** Sends one request to the endpoint, as a client would. */
  fetch(request: Request): Promise<Response>
  /** A client connected with `token`, named `name` in its `initialize`. */
  connect(token: string, clientInfo?: { name: string; title?: string }): Promise<TestClient>
}

export const BASE_URL = 'https://app.test'

/** The endpoint over a fake API, with a clock the test moves. */
export function testServer(): TestServer {
  const api = testApi()
  let time = Date.UTC(2026, 10, 21)
  const endpoint = mcpEndpoint({
    api: { url: 'http://api.test', fetch: api.fetch },
    baseUrl: BASE_URL,
    version: 'test',
    now: () => time,
  })
  const fetch = async (request: Request) => endpoint.app.fetch(request)

  return {
    api,
    endpoint,
    wait: (ms) => void (time += ms),
    fetch,
    connect: async (token, clientInfo = { name: 'test' }) => {
      const client = new Client({ version: '1.0.0', ...clientInfo })
      const connected: TestClient = {
        client,
        token,
        call: async (name, args = {}) => (await client.callTool({ name, arguments: args })) as CallToolResult,
        json: async (name, args = {}) => JSON.parse(textOf(await connected.call(name, args))),
      }
      const transport = new StreamableHTTPClientTransport(new URL(`${BASE_URL}/mcp`), {
        fetch: async (url, init) => {
          const headers = new Headers(init?.headers)
          headers.set('authorization', `Bearer ${connected.token}`)
          return fetch(new Request(url, { ...init, headers }))
        },
      })
      await client.connect(transport)
      return connected
    },
  }
}

/** The text of a tool result's first block. */
export function textOf(result: CallToolResult): string {
  const block = result.content[0]
  return block?.type === 'text' ? block.text : ''
}
