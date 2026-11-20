// The API's routes of agents' OAuth sign-in (ADR-0019). `apps/mcp` asks the public ones for the client, with the
// OAuth parameters as they came and the client's address and the resource it serves in headers: registering a
// client (at most `REGISTRATIONS_PER_HOUR` from one address), starting an authorization, and the token endpoint's
// code swap, refresh and revoke, each answered in OAuth's words. The web app's Connect an agent page asks the
// others with the person's session: the request it shows, the person's consent, which makes the code, and
// their refusal. An agent's token is refused on every one of them before it reaches them.
import { Hono } from 'hono'

import type { Db } from '@dazbee/db'
import {
  AGENT_CLIENT_IP_HEADER,
  AGENT_RESOURCE_HEADER,
  type AgentAuthorizationRequest,
  AgentConsent,
  type AgentRedirect,
  OAuthParams,
  roleWrites,
} from '@dazbee/schema'

import { type RequestLimit, requestLimit } from '../admin/waiting-list.ts'
import { body, type Env, error } from '../http.ts'
import { findMe } from '../me/me.ts'
import { findBrand } from '../workspace/workspace.ts'
import { ACCESS_TOKEN_TTL_MS, type AgentTokens, refreshTokens, revokeToken } from './agent-accesses.ts'
import {
  consent,
  deny,
  findRequest,
  readClientMetadata,
  refusal,
  registerClient,
  startAuthorization,
  swapCode,
  type Swapped,
} from './oauth.ts'

/** How many clients one address may register within an hour. */
export const REGISTRATIONS_PER_HOUR = 20

/** The longest sign-in request id taken; a real one is 43 characters. */
const MAX_REQUEST_ID = 200

/** What a sign-in request that has expired, was answered or never was is told. */
const EXPIRED = 'This sign-in has expired or was answered already; connect the agent again'

/** What the token endpoint's answers never let a cache keep (RFC 6749 §5.1). */
const NO_STORE = { 'cache-control': 'no-store', pragma: 'no-cache' }

/** The public routes `apps/mcp` asks for a client: registration, authorization, tokens and revoke. */
export function agentOAuthRoutes({
  db,
  registrations = requestLimit({ perWindow: REGISTRATIONS_PER_HOUR }),
}: {
  db: Db
  registrations?: RequestLimit
}): Hono<Env> {
  const app = new Hono<Env>()

  app.post('/agent/clients', async (c) => {
    const metadata = readClientMetadata(await jsonOf(c.req.raw))
    if ('error' in metadata) return c.json(metadata, 400)
    if (!registrations.take(c.req.header(AGENT_CLIENT_IP_HEADER)?.trim() || 'unknown'))
      return c.json({ error: 'too_many_requests', error_description: 'Too many registrations; try again later' }, 429)
    return c.json(await registerClient(db, metadata), 201)
  })

  app.post('/agent/authorizations', async (c) => {
    const params = OAuthParams.safeParse(await jsonOf(c.req.raw))
    if (!params.success) return c.json({ error: 'invalid_request', error_description: 'Unreadable request' }, 400)
    const started = await startAuthorization(db, params.data, c.req.header(AGENT_RESOURCE_HEADER) ?? null)
    return c.json(started, 'request' in started ? 201 : 400)
  })

  app.post('/agent/tokens', async (c) => {
    const params = OAuthParams.safeParse(await jsonOf(c.req.raw))
    const resource = c.req.header(AGENT_RESOURCE_HEADER) ?? null
    const swapped: Swapped = !params.success
      ? refusal('invalid_request', 'Unreadable request')
      : params.data.grant_type === 'authorization_code'
        ? await swapCode(db, params.data, resource)
        : params.data.grant_type === 'refresh_token'
          ? await refresh(db, params.data, resource)
          : refusal('unsupported_grant_type', 'Use authorization_code or refresh_token')
    if (!swapped.ok) return c.json(swapped.error, swapped.status, NO_STORE)
    return c.json(tokenAnswer(swapped.tokens), 200, NO_STORE)
  })

  app.post('/agent/tokens/revoke', async (c) => {
    const params = OAuthParams.safeParse(await jsonOf(c.req.raw))
    if (!params.success || !params.data.token)
      return c.json({ error: 'invalid_request', error_description: 'Give the token to revoke' }, 400)
    await revokeToken(db, params.data.token)
    return c.json({}, 200, NO_STORE)
  })

  return app
}

/**
 * The routes the Connect an agent page asks with the person's session: the sign-in request, its refusal, and
 * the consent in a workspace, mounted after the session's and the membership's checks.
 */
export function agentConsentRoutes({ db }: { db: Db }): Hono<Env> {
  const app = new Hono<Env>()

  app.get('/agent/authorizations/:request', async (c) => {
    if (c.var.session.agent) return c.json(error('Only the person can answer an agent'), 403)
    const pending = await findRequest(db, requestId(c.req.param('request')))
    const me = pending && (await findMe(db, c.var.session.userId))
    if (!pending || !me) return c.json(error(EXPIRED), 404)
    const { host } = new URL(pending.redirectUri)
    return c.json({
      clientName: pending.clientName,
      redirectHost: host,
      workspaces: me.workspaces,
    } satisfies AgentAuthorizationRequest)
  })

  app.post('/agent/authorizations/:request/deny', async (c) => {
    if (c.var.session.agent) return c.json(error('Only the person can answer an agent'), 403)
    const redirect = await deny(db, requestId(c.req.param('request')))
    return redirect ? c.json({ redirect } satisfies AgentRedirect) : c.json(error(EXPIRED), 404)
  })

  app.post('/workspaces/:workspaceId/agent-accesses', async (c) => {
    if (c.var.session.agent) return c.json(error('Only the person can answer an agent'), 403)
    const input = await body(c.req.raw, AgentConsent)
    if (input instanceof Response) return input
    const { workspaceId, role, brandIds: theirs } = c.var.membership
    if (input.writes && !roleWrites(role)) return c.json(error('A Reviewer’s agent can only view'), 403)
    for (const brandId of input.brandIds ?? []) {
      const seen = (theirs === null || theirs.includes(brandId)) && (await findBrand(db, workspaceId, brandId))
      if (!seen) return c.json(error('No such brand'), 404)
    }
    const choice = { userId: c.var.session.userId, workspaceId, brandIds: input.brandIds, writes: input.writes }
    const redirect = await consent(db, input.request, choice)
    return redirect ? c.json({ redirect } satisfies AgentRedirect, 201) : c.json(error(EXPIRED), 404)
  })

  return app
}

/** A refresh (RFC 6749 §6) for the client that asks. */
async function refresh(db: Db, params: OAuthParams, resource: string | null): Promise<Swapped> {
  const { refresh_token: token, client_id: clientId } = params
  if (!token || !clientId) return refusal('invalid_request', 'Give refresh_token and client_id')
  if (params.resource !== undefined && params.resource !== resource)
    return refusal('invalid_target', 'Dazbee signs agents in only for its MCP server')
  const refreshed = await refreshTokens(db, token, new Date(), clientId)
  return refreshed.ok ? refreshed : refusal('invalid_grant', 'The refresh token is not valid; sign in again')
}

/** The token endpoint's answer (RFC 6749 §5.1). */
function tokenAnswer(tokens: AgentTokens) {
  return {
    access_token: tokens.accessToken,
    token_type: 'Bearer',
    expires_in: ACCESS_TOKEN_TTL_MS / 1000,
    refresh_token: tokens.refreshToken,
  }
}

/** A request id from a path, cut so a long one is never hashed whole. */
function requestId(param: string): string {
  return param.slice(0, MAX_REQUEST_ID)
}

/** The request's body as JSON, or undefined when it is not JSON. */
async function jsonOf(request: Request): Promise<unknown> {
  try {
    return JSON.parse(await request.text())
  } catch {
    return undefined
  }
}
