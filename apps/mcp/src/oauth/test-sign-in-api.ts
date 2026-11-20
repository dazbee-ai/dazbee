// A stand-in for the API's sign-in routes, for tests, in front of the fake API (`test-api.ts`): clients register,
// a request waits for the test to consent in the person's place, a code is swapped once with its PKCE verifier
// for an access of the fake API, refresh tokens rotate, and revoking a refresh token refuses the access's tokens.
import { createHash, randomBytes } from 'node:crypto'

import { Hono } from 'hono'

import { AGENT_CLIENT_IP_HEADER, AGENT_RESOURCE_HEADER } from '@dazbee/schema'

import { type TestAccess, type TestApi, testApi } from '../test-api.ts'

/** The fake API with sign-in: its `fetch`, and what the tests do and read in the person's and the API's place. */
export interface TestSignInApi {
  api: TestApi
  fetch(request: Request): Promise<Response>
  /** Allows the waiting request as the person would; the client's redirect URI with the code and state. */
  consent(request: string): string
  /** The client addresses registrations came with, in order. */
  clientAddresses(): string[]
  /** The access tokens handed out, oldest first. */
  accessTokens(): string[]
}

/** A request or a code: the client, where it goes back, its state and challenge. */
interface Authorization {
  clientId: string
  redirectUri: string
  state: string | undefined
  challenge: string
}

/** The fake API with the sign-in routes in front of it. */
export function testSignInApi(api: TestApi = testApi()): TestSignInApi {
  // Registered clients' redirect URIs; waiting requests and codes, by id; refresh tokens, to their access.
  const clients = new Map<string, string[]>()
  const requests = new Map<string, Authorization>()
  const codes = new Map<string, Authorization>()
  const refreshTokens = new Map<string, { access: TestAccess; clientId: string; tokens: string[] }>()
  const addresses: string[] = []
  const issued: string[] = []

  const app = new Hono()

  app.post('/agent/clients', async (c) => {
    addresses.push(c.req.header(AGENT_CLIENT_IP_HEADER) ?? '')
    const metadata = (await c.req.json()) as { redirect_uris?: string[]; client_name?: string }
    if (!metadata.redirect_uris?.length) return c.json({ error: 'invalid_redirect_uri' }, 400)
    const clientId = `client-${clients.size + 1}`
    clients.set(clientId, metadata.redirect_uris)
    const answer = {
      client_id: clientId,
      client_name: metadata.client_name ?? 'AI agent',
      redirect_uris: metadata.redirect_uris,
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    }
    return c.json(answer, 201)
  })

  app.post('/agent/authorizations', async (c) => {
    const params = (await c.req.json()) as Record<string, string>
    const uris = clients.get(params.client_id ?? '')
    if (!uris) return c.json({ error: 'invalid_client', error_description: 'No such client' }, 400)
    const redirectUri = params.redirect_uri ?? ''
    if (!uris.includes(redirectUri))
      return c.json({ error: 'invalid_request', error_description: 'Unregistered redirect URI' }, 400)
    const back = (error: string) => ({ error, redirect: withParams(redirectUri, { error, state: params.state }) })
    if (params.code_challenge_method !== 'S256') return c.json(back('invalid_request'), 400)
    if (params.resource !== undefined && params.resource !== c.req.header(AGENT_RESOURCE_HEADER))
      return c.json(back('invalid_target'), 400)
    const request = randomBytes(16).toString('base64url')
    const challenge = params.code_challenge ?? ''
    requests.set(request, { clientId: params.client_id ?? '', redirectUri, state: params.state, challenge })
    return c.json({ request }, 201)
  })

  app.post('/agent/tokens', async (c) => {
    const params = (await c.req.json()) as Record<string, string>
    const invalid = c.json({ error: 'invalid_grant' }, 400, { 'cache-control': 'no-store' })
    if (params.grant_type === 'authorization_code') {
      const code = codes.get(params.code ?? '')
      codes.delete(params.code ?? '')
      if (!code || code.clientId !== params.client_id || code.redirectUri !== params.redirect_uri) return invalid
      if (
        createHash('sha256')
          .update(params.code_verifier ?? '')
          .digest('base64url') !== code.challenge
      )
        return invalid
      return c.json(pair(api.addAccess(), code.clientId), 200, { 'cache-control': 'no-store' })
    }
    const held = refreshTokens.get(params.refresh_token ?? '')
    refreshTokens.delete(params.refresh_token ?? '')
    if (params.grant_type !== 'refresh_token' || !held || held.clientId !== params.client_id) return invalid
    return c.json(pair(held.access, held.clientId, held.tokens), 200, { 'cache-control': 'no-store' })
  })

  app.post('/agent/tokens/revoke', async (c) => {
    const { token } = (await c.req.json()) as { token?: string }
    const held = refreshTokens.get(token ?? '')
    refreshTokens.delete(token ?? '')
    for (const accessToken of held?.tokens ?? []) api.refuse(accessToken)
    return c.json({})
  })

  app.all('*', (c) => api.fetch(c.req.raw))

  return {
    api,
    fetch: async (request) => app.fetch(request),
    consent,
    clientAddresses: () => [...addresses],
    accessTokens: () => [...issued],
  }

  function consent(request: string): string {
    const waiting = requests.get(request)
    if (!waiting) throw new Error('No such request')
    requests.delete(request)
    const code = randomBytes(16).toString('base64url')
    codes.set(code, waiting)
    return withParams(waiting.redirectUri, { code, state: waiting.state })
  }

  /** A new token pair of `access`, as the token endpoint answers it. */
  function pair(access: TestAccess, clientId: string, tokens: string[] = []) {
    const accessToken = access.token()
    const refreshToken = `dazbee_rt_${randomBytes(16).toString('base64url')}`
    issued.push(accessToken)
    refreshTokens.set(refreshToken, { access, clientId, tokens: [...tokens, accessToken] })
    return { access_token: accessToken, token_type: 'Bearer', expires_in: 3600, refresh_token: refreshToken }
  }
}

/** `uri` with the parameters given in its query; one left undefined is left out. */
function withParams(uri: string, params: Record<string, string | undefined>): string {
  const url = new URL(uri)
  for (const [name, value] of Object.entries(params)) if (value !== undefined) url.searchParams.set(name, value)
  return url.toString()
}
