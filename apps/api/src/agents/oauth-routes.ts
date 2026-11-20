// The API's public routes of agents' OAuth sign-in (ADR-0019), which `apps/mcp` asks for the client, with the
// OAuth parameters as they came and the client's address and the resource it serves in headers: registering a
// client and starting an authorization, each limited per address, and the token endpoint's code swap, refresh
// and revoke, each answered in OAuth's words. The person answers a sign-in through `consent-routes.ts`.
import { Hono } from 'hono'

import type { Db } from '@dazbee/db'
import { AGENT_CLIENT_IP_HEADER, AGENT_RESOURCE_HEADER, OAuthParams } from '@dazbee/schema'

import { type RequestLimit, requestLimit } from '../admin/waiting-list.ts'
import type { Env } from '../http.ts'
import { ACCESS_TOKEN_TTL_MS, type AgentTokens, refreshTokens, revokeToken } from './agent-accesses.ts'
import {
  readClientMetadata,
  refusal,
  registerClient,
  startAuthorization,
  swapCode,
  type Swapped,
  WRONG_RESOURCE,
  wrongResource,
} from './oauth.ts'

/** The limits on the public routes, each kept in this server's memory, within an hour. */
export interface OAuthLimits {
  /** Registrations from one address. */
  registrations: RequestLimit
  /** Registrations from every address together, so a flood of addresses can't fill the table. */
  allRegistrations: RequestLimit
  /** Authorization requests from one address. */
  authorizations: RequestLimit
}

/** How many clients one address may register within an hour. */
export const REGISTRATIONS_PER_HOUR = 20
/** How many clients may register within an hour in all. */
export const ALL_REGISTRATIONS_PER_HOUR = 500
/** How many sign-ins one address may start within an hour. */
export const AUTHORIZATIONS_PER_HOUR = 60

/** What the token endpoint's answers never let a cache keep (RFC 6749 §5.1). */
const NO_STORE = { 'cache-control': 'no-store', pragma: 'no-cache' }

/** The public routes `apps/mcp` asks for a client: registration, authorization, tokens and revoke. */
export function agentOAuthRoutes({
  db,
  limits = {
    registrations: requestLimit({ perWindow: REGISTRATIONS_PER_HOUR }),
    allRegistrations: requestLimit({ perWindow: ALL_REGISTRATIONS_PER_HOUR }),
    authorizations: requestLimit({ perWindow: AUTHORIZATIONS_PER_HOUR }),
  },
}: {
  db: Db
  limits?: OAuthLimits
}): Hono<Env> {
  const app = new Hono<Env>()

  app.post('/agent/clients', async (c) => {
    const metadata = readClientMetadata(await jsonOf(c.req.raw))
    if ('error' in metadata) return c.json(metadata, 400)
    if (!limits.registrations.take(clientOf(c.req.header(AGENT_CLIENT_IP_HEADER))) || !limits.allRegistrations.take(''))
      return c.json({ error: 'too_many_requests', error_description: 'Too many registrations; try again later' }, 429)
    return c.json(await registerClient(db, metadata), 201)
  })

  app.post('/agent/authorizations', async (c) => {
    const params = OAuthParams.safeParse(await jsonOf(c.req.raw))
    if (!params.success) return c.json({ error: 'invalid_request', error_description: 'Unreadable request' }, 400)
    if (!limits.authorizations.take(clientOf(c.req.header(AGENT_CLIENT_IP_HEADER))))
      return c.json({ error: 'too_many_requests', error_description: 'Too many sign-ins; try again later' }, 429)
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
    await revokeToken(db, params.data.token, new Date(), params.data.client_id)
    return c.json({}, 200, NO_STORE)
  })

  return app
}

/** The request's body as JSON, or undefined when it is not JSON. */
async function jsonOf(request: Request): Promise<unknown> {
  try {
    return JSON.parse(await request.text())
  } catch {
    return undefined
  }
}

/**
 * Who a limit counts a request by: the client's address, an IPv6 one by its /64, which one client holds whole;
 * `unknown` without one.
 */
function clientOf(address: string | undefined): string {
  const given = address?.trim().toLowerCase() ?? ''
  if (!given) return 'unknown'
  if (!given.includes(':') || given.includes('.')) return given
  const [head = '', tail = ''] = given.split('::')
  const [start, end] = [head.split(':').filter(Boolean), tail.split(':').filter(Boolean)]
  const groups = given.includes('::') ? [...start, ...Array(8 - start.length - end.length).fill('0'), ...end] : start
  return `${groups.slice(0, 4).join(':')}::/64`
}

/** A refresh (RFC 6749 §6) for the client that asks. */
async function refresh(db: Db, params: OAuthParams, resource: string | null): Promise<Swapped> {
  const { refresh_token: token, client_id: clientId } = params
  if (!token || !clientId) return refusal('invalid_request', 'Give refresh_token and client_id')
  if (wrongResource(params, resource)) return refusal('invalid_target', WRONG_RESOURCE)
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
