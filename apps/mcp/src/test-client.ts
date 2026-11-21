// The MCP server as tests drive it: the endpoint over the fake API and a sync server in memory for each design,
// and the SDK's own client connected to it in-process, with a token the test can change between calls.
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

import { testDesign } from '@dazbee/doc/test-design'
import { type MemorySync, memorySync } from '@dazbee/editor/test-link'
import { DESIGN_PARAM, type DesignInput } from '@dazbee/schema'

import { type Endpoint, type EndpointSettings, mcpEndpoint } from './endpoint.ts'
import { type LimitSettings, limitSettings } from './limits.ts'
import { TEST_WORKSPACE, type TestApi, testApi } from './test-api.ts'

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
  /** Moves the endpoint's clock on, running the timers due by then. */
  wait(ms: number): void
  /** How many of the endpoint's timers on its clock wait to run. */
  timers(): number
  /** Sends one request to the endpoint, as a client would. */
  fetch(request: Request): Promise<Response>
  /** A client connected with `token`, named `name` in its `initialize`. */
  connect(token: string, clientInfo?: { name: string; title?: string }): Promise<TestClient>
  /** The sync server in memory holding the design: made when a tab first opens it, or when asked. */
  sync(designId: string): MemorySync
  /** The lines the endpoint has logged, each parsed from its JSON. */
  logged: unknown[]
}

/** What a test's server is given. */
export interface TestServerOptions {
  /** How long a request may take, `CALL_TIMEOUT_MS` unless given. */
  callTimeoutMs?: number
  /** The designs the sync server holds, by id; any other is the test design. */
  designs?: Record<string, DesignInput>
  /** Starts the render worker; a worker thread unless given. */
  startRenderWorker?: EndpointSettings['startRenderWorker']
  /** The capacity limits, their defaults unless given. */
  limits?: Partial<LimitSettings>
}

export const BASE_URL = 'https://app.test'

/** The endpoint over a fake API and the sync servers in memory, with a clock the test moves. */
export function testServer({
  callTimeoutMs,
  designs = {},
  startRenderWorker,
  limits = {},
}: TestServerOptions = {}): TestServer {
  let time = Date.UTC(2026, 10, 21)
  // The timers set on the clock, each with when it is due.
  const timers = new Set<{ due: number; run: () => void }>()
  const api = testApi({ now: () => time })
  // The sync server in memory of each design opened, by its id.
  const syncs = new Map<string, MemorySync>()
  const logged: unknown[] = []
  const endpoint = mcpEndpoint({
    api: { url: 'http://api.test', fetch: api.fetch },
    sync: {
      url: 'ws://sync.test',
      socket: (url) => syncOf(new URL(url).searchParams.get(DESIGN_PARAM) ?? '').socket(url),
    },
    baseUrl: BASE_URL,
    version: 'test',
    now: () => time,
    after: (ms, run) => {
      const timer = { due: time + ms, run }
      timers.add(timer)
      return () => void timers.delete(timer)
    },
    limits: { ...limitSettings({}), ...limits },
    log: (line) => logged.push(JSON.parse(line)),
    ...(callTimeoutMs === undefined ? {} : { callTimeoutMs }),
    ...(startRenderWorker ? { startRenderWorker } : {}),
  })
  const fetch = async (request: Request) => endpoint.app.fetch(request)

  /** The design's sync server, which takes a sync token the fake API signed for that design. */
  function syncOf(designId: string): MemorySync {
    let sync = syncs.get(designId)
    if (!sync) {
      sync = memorySync(designs[designId] ?? testDesign(), {
        who(token) {
          const signed = api.syncTokenOf(token)
          if (signed?.designId !== designId) return undefined
          const member = { userId: 'user-test', workspaceId: TEST_WORKSPACE }
          return { member, name: 'Test person', agent: signed.agent, access: signed.writes ? 'edit' : 'view' }
        },
      })
      syncs.set(designId, sync)
    }
    return sync
  }

  return {
    api,
    endpoint,
    sync: syncOf,
    logged,
    wait(ms) {
      time += ms
      for (const timer of [...timers].filter(({ due }) => due <= time)) {
        timers.delete(timer)
        timer.run()
      }
    },
    timers: () => timers.size,
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
