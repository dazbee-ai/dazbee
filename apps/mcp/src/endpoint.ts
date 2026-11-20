// The MCP endpoint, `/mcp`, over Streamable HTTP: each request's bearer token is checked with the API, a session
// belongs to the agent access that started it, and each call is answered with one JSON response; no stream is
// opened. Sessions are held in memory, end after a while without a call, and an access holds a few at most.
import { randomUUID } from 'node:crypto'

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError } from '@modelcontextprotocol/sdk/types.js'
import { Hono } from 'hono'

import type { AgentMe } from '@dazbee/schema'

import { agentName } from './agent-name.ts'
import { agentApi, agentOf, type ApiSettings } from './api.ts'
import { INSTRUCTIONS } from './instructions.ts'
import { MAX_BODY_BYTES, MAX_SESSIONS_PER_ACCESS, SESSION_IDLE_MS } from './limits.ts'
import { COMMAND_TOOLS } from './tools/command-tools.ts'
import type { Tool, ToolContext } from './tools/define-tool.ts'
import { WORKSPACE_TOOLS } from './tools/workspace-tools.ts'

/** What the endpoint needs: the API, the public base URL the server is reached at, and the app's version. */
export interface EndpointSettings {
  api: ApiSettings
  /** The public base URL, without a trailing slash: `https://app.dazbee.com` in production. */
  baseUrl: string
  version: string
  /** The clock sessions are timed by, in milliseconds; `Date.now` unless a test gives another. */
  now?: () => number
}

/** The endpoint: a Hono app answering `/mcp` and the health check, and `close`, which ends every session. */
export interface Endpoint {
  app: Hono
  close(): Promise<void>
}

/** One MCP session: the access that started it, its server and transport, and when it was used. */
interface Session {
  id: string
  accessId: string
  server: Server
  transport: WebStandardStreamableHTTPServerTransport
  startedAt: number
  lastCallAt: number
  /** The newest access token the session has been called with. */
  token: string
  /** The agent's name, from its client's `initialize`. */
  agentName: string
}

/** What one request passes to the tools it calls, through the transport's `authInfo`. */
interface Call {
  context: ToolContext
  /** Whether the API refused the token on a call the request made. */
  refused: boolean
}

/** The tools every session offers, in `tools/list` order. */
export const TOOLS: Tool[] = [...WORKSPACE_TOOLS, ...COMMAND_TOOLS]

/** How often sessions past their idle time are looked for, besides at each request. */
const IDLE_SWEEP_MS = 60_000

/** The endpoint at `/mcp`, with its sessions. */
export function mcpEndpoint(settings: EndpointSettings): Endpoint {
  const { api, baseUrl, version, now = Date.now } = settings
  // The open sessions, by session id, in the order they started.
  const sessions = new Map<string, Session>()
  const sweep = setInterval(() => void endIdle(), IDLE_SWEEP_MS)
  sweep.unref()

  const app = new Hono()
  // The container's health check. Only /mcp, /oauth/* and /.well-known/oauth-* reach this server from outside.
  app.get('/health', (c) => c.json({ build: version }))
  app.on(['POST', 'DELETE'], '/mcp', (c) => handle(c.req.raw))
  app.all('/mcp', () => methodNotAllowed())

  return { app, close }

  async function handle(request: Request): Promise<Response> {
    await endIdle()
    const token = bearerToken(request)
    const agent = token ? await agentOf(api, token) : null
    if (!token || !agent) return unauthorized(baseUrl)
    const sessionId = request.headers.get('mcp-session-id')
    const session = sessionId === null ? undefined : sessions.get(sessionId)
    if (sessionId !== null && session?.accessId !== agent.id) return sessionNotFound()
    if (session) {
      session.lastCallAt = now()
      session.token = token
    }
    const call: Call = { context: { agent, api: agentApi(api, token, agent.workspaceId, refuse) }, refused: false }
    const authInfo = { token, clientId: agent.id, scopes: [], extra: { call } }
    const opened = session ?? (await open(agent, token))
    const response = await opened.transport.handleRequest(request, { authInfo })
    if (!session) await keep(opened)
    return call.refused ? unauthorized(baseUrl) : response

    function refuse() {
      call.refused = true
    }
  }

  /** A new session's server and transport, kept once its `initialize` has been answered. */
  async function open(agent: AgentMe, token: string): Promise<Session> {
    const server = new Server(
      { name: 'dazbee', title: 'Dazbee', version },
      { capabilities: { tools: { listChanged: false } }, instructions: INSTRUCTIONS },
    )
    server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: TOOLS.map((tool) => tool.listing) }))
    server.setRequestHandler(CallToolRequestSchema, async ({ params }, extra) => {
      const tool = TOOLS.find(({ name }) => name === params.name)
      if (!tool) throw new McpError(ErrorCode.InvalidParams, `Unknown tool: ${params.name}`)
      const call = extra.authInfo?.extra?.call as Call
      return tool.call(params.arguments, call.context)
    })
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      enableJsonResponse: true,
      maxRequestBodySize: MAX_BODY_BYTES,
      onsessionclosed: (id) => void end(id),
    })
    await server.connect(transport)
    const at = now()
    return { id: '', accessId: agent.id, server, transport, startedAt: at, lastCallAt: at, token, agentName: '' }
  }

  /** Keeps a session its transport started, ending the access's oldest past its limit; drops one that didn't start. */
  async function keep(session: Session): Promise<void> {
    const id = session.transport.sessionId
    if (id === undefined) return session.server.close()
    session.id = id
    session.agentName = agentName(session.server.getClientVersion())
    sessions.set(id, session)
    const ofAccess = [...sessions.values()].filter(({ accessId }) => accessId === session.accessId)
    for (const old of ofAccess.slice(0, Math.max(0, ofAccess.length - MAX_SESSIONS_PER_ACCESS))) await end(old.id)
  }

  /** Ends every session that has had no call for its idle time. */
  async function endIdle(): Promise<void> {
    const before = now() - SESSION_IDLE_MS
    for (const session of [...sessions.values()]) if (session.lastCallAt <= before) await end(session.id)
  }

  /** Ends a session: later requests with its id answer 404. */
  async function end(id: string): Promise<void> {
    const session = sessions.get(id)
    if (!session) return
    sessions.delete(id)
    await session.server.close()
  }

  async function close(): Promise<void> {
    clearInterval(sweep)
    for (const id of [...sessions.keys()]) await end(id)
  }
}

/** The request's bearer token, or null without one. */
function bearerToken(request: Request): string | null {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(request.headers.get('authorization') ?? '')
  return match?.[1] ?? null
}

/** 401, pointing the client at the protected resource metadata, where it learns how to sign in. */
function unauthorized(baseUrl: string): Response {
  return jsonRpcError(401, -32001, 'Sign in to Dazbee first', {
    'www-authenticate': `Bearer resource_metadata="${baseUrl}/.well-known/oauth-protected-resource/mcp"`,
  })
}

/** 404 for a session that ended, belongs to another access or never was: the client starts a new one. */
function sessionNotFound(): Response {
  return jsonRpcError(404, -32001, 'Session not found')
}

/** 405: the endpoint takes POST and DELETE, and opens no stream on GET. */
function methodNotAllowed(): Response {
  return jsonRpcError(405, -32000, 'Method not allowed', { allow: 'POST, DELETE' })
}

/** A JSON-RPC error with no request id, as an HTTP answer. */
function jsonRpcError(status: number, code: number, message: string, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ jsonrpc: '2.0', error: { code, message }, id: null }), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}
