// The routes an agent's token may ask (ADR-0019): who it is, and under its access's workspace, listing brands,
// a brand's designs, assets, fonts and kit, an asset's or a font face's signed link, making a design, and a
// design's sync token. A request with an agent's token anywhere else is answered 403, before any route runs.
import { Hono, type MiddlewareHandler } from 'hono'

import type { AgentMe } from '@dazbee/schema'

import { type Env, error } from '../http.ts'
import { agentToken, type SessionOf } from '../sign-in/session.ts'

/** Each route an agent may ask: its method and its path, with `:name` for one segment of any value. */
const AGENT_ROUTES: [method: string, path: string][] = [
  ['GET', '/agent/me'],
  ['GET', '/workspaces/:workspaceId/brands'],
  ['GET', '/workspaces/:workspaceId/brands/:brandId/designs'],
  ['POST', '/workspaces/:workspaceId/brands/:brandId/designs'],
  ['GET', '/workspaces/:workspaceId/brands/:brandId/assets'],
  ['GET', '/workspaces/:workspaceId/brands/:brandId/assets/:assetId'],
  ['GET', '/workspaces/:workspaceId/brands/:brandId/fonts'],
  ['GET', '/workspaces/:workspaceId/brands/:brandId/fonts/faces/:faceId'],
  ['GET', '/workspaces/:workspaceId/brands/:brandId/kit'],
  ['POST', '/workspaces/:workspaceId/brands/:brandId/designs/:designId/sync-token'],
]

/** `AGENT_ROUTES` as patterns of whole paths. */
const AGENT_PATHS = AGENT_ROUTES.map(([method, path]) => ({
  method,
  pattern: new RegExp(`^${path.replace(/:\w+/g, '[^/]+')}$`),
}))

/**
 * Lets a request with an agent's token through only to the agents' routes: elsewhere it answers 403 to a live
 * token and 401 to any other. A request without one passes.
 */
export function agentGate(sessionOf: SessionOf): MiddlewareHandler<Env> {
  return async (c, next) => {
    if (agentToken(c.req.raw) === null || agentMayAsk(c.req.method, c.req.path)) return next()
    const session = await sessionOf(c.req.raw)
    return session?.agent ? c.json(error('Agents may not do this'), 403) : c.json(error('Sign in first'), 401)
  }
}

/** `GET /agent/me`: the access an agent's token is held to; refused to a person's session. */
export function agentRoutes(): Hono<Env> {
  const app = new Hono<Env>()

  app.get('/agent/me', (c) => {
    const { agent } = c.var.session
    if (!agent) return c.json(error('Only an agent’s token can ask this'), 403)
    const { accessId: id, workspaceId, brandIds, writes, clientName } = agent
    return c.json({ id, workspaceId, brandIds, writes, clientName } satisfies AgentMe)
  })

  return app
}

/** Whether an agent may ask `method` at `path`. */
function agentMayAsk(method: string, path: string): boolean {
  return AGENT_PATHS.some((route) => route.method === method && route.pattern.test(path))
}
