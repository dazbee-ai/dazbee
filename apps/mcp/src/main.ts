// Starts the MCP server agents connect to (ADR-0019). Settings come from the environment only: the API's and the
// sync server's private addresses, the public base URL agents reach it at, the port, and the capacity limits
// (`limitSettings`). Run locally, each address is the one the other apps have on a developer's machine; in production
// each must be set. A limit set out of its range stops the server from starting.
import { serve } from '@hono/node-server'

import { mcpEndpoint } from './endpoint.ts'
import { limitSettings } from './limits.ts'

const production = process.env.NODE_ENV === 'production'
const apiUrl = address('API_URL', 'http://localhost:8787', ['http:', 'https:'])
const syncUrl = address('SYNC_URL', 'ws://localhost:1234', ['ws:', 'wss:'])
const baseUrl = address('PUBLIC_URL', 'http://localhost:3000', ['http:', 'https:'])
const port = Number(process.env.PORT ?? 3100)
// The image sets BUILD_ID to the commit it was built from; a server run from a checkout is `dev`.
const version = process.env.BUILD_ID || 'dev'
const limits = limitSettings(process.env)

const endpoint = mcpEndpoint({ api: { url: apiUrl }, sync: { url: syncUrl }, baseUrl, version, limits })
const server = serve({ fetch: endpoint.app.fetch, port }, () =>
  console.log(`mcp on http://localhost:${port}/mcp, as ${baseUrl}/mcp; the API at ${apiUrl}, sync at ${syncUrl}`),
)

for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () => {
    server.close()
    void endpoint.close().then(() => process.exit(0))
  })

/** The address the environment gives `name`, without a trailing slash; `local` when unset outside production. */
function address(name: string, local: string, protocols: string[]): string {
  const value = process.env[name] || (production ? undefined : local)
  if (!value) throw new Error(`${name} is not set`)
  const url = new URL(value)
  if (!protocols.includes(url.protocol)) throw new Error(`${name} is not a ${protocols.join(' or ')} address`)
  return value.replace(/\/+$/, '')
}
