// An agent signs in through the MCP server's OAuth endpoints as the SDK's own client does it: it finds the
// metadata, registers, sends the person to authorize, swaps the code, works, refreshes and is revoked, against
// the fake API's sign-in routes.
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { OAuthClientInformationMixed, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js'
import { afterEach, describe, expect, it } from 'vitest'

import { type Endpoint, mcpEndpoint } from '../endpoint.ts'
import { TEST_BRANDS } from '../test-api.ts'
import { textOf } from '../test-client.ts'
import { type TestSignInApi, testSignInApi } from './test-sign-in-api.ts'

const BASE = 'https://app.test'
const REDIRECT = 'http://127.0.0.1:43123/callback'
const CLIENT_ADDRESS = '198.51.100.7'

/** Endpoints the tests opened, closed after each. */
const opened: Endpoint[] = []

afterEach(async () => {
  for (const endpoint of opened.splice(0)) await endpoint.close()
})

/** The MCP server over the fake API with sign-in, and a fetch reaching it as a client behind Cloudflare would. */
function server() {
  const signIn = testSignInApi()
  const endpoint = mcpEndpoint({ api: { url: 'http://api.test', fetch: signIn.fetch }, baseUrl: BASE, version: 'test' })
  opened.push(endpoint)
  const fetch = async (url: string | URL, init?: RequestInit) => {
    const request = new Request(url, init)
    request.headers.set('cf-connecting-ip', CLIENT_ADDRESS)
    return endpoint.app.fetch(request)
  }
  return { signIn, fetch }
}

/** An OAuth client as the SDK asks for one, keeping what it is given in memory. */
function provider() {
  const kept: {
    client?: OAuthClientInformationMixed
    tokens?: OAuthTokens
    verifier?: string
    authorizeAt?: URL
  } = {}
  const oauth: OAuthClientProvider = {
    redirectUrl: REDIRECT,
    clientMetadata: {
      client_name: 'Claude Code',
      redirect_uris: [REDIRECT],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    },
    state: () => 'state-1',
    clientInformation: () => kept.client,
    saveClientInformation: (client) => void (kept.client = client),
    tokens: () => kept.tokens,
    saveTokens: (tokens) => void (kept.tokens = tokens),
    redirectToAuthorization: (url) => void (kept.authorizeAt = url),
    saveCodeVerifier: (verifier) => void (kept.verifier = verifier),
    codeVerifier: () => kept.verifier ?? '',
  }
  return { oauth, kept }
}

/** Follows the authorization URL as the person's browser would, then consents in their place; the code. */
async function authorizeAsPerson(
  fetch: (url: string | URL, init?: RequestInit) => Promise<Response>,
  signIn: TestSignInApi,
  authorizeAt: URL,
) {
  const sent = await fetch(authorizeAt, { redirect: 'manual' })
  expect(sent.status).toBe(302)
  const connect = new URL(sent.headers.get('location') ?? '')
  expect(`${connect.origin}${connect.pathname}`).toBe(`${BASE}/agents/connect`)
  const back = new URL(signIn.consent(connect.searchParams.get('request') ?? ''))
  expect(back.searchParams.get('state')).toBe('state-1')
  return back.searchParams.get('code') ?? ''
}

/** A transport to the MCP endpoint signing in with `oauth`. */
const transportOf = (fetch: (url: string | URL, init?: RequestInit) => Promise<Response>, oauth: OAuthClientProvider) =>
  new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`), { authProvider: oauth, fetch })

describe('the metadata', () => {
  it('names the resource, its authorization server, and the endpoints and methods it takes', async () => {
    const { fetch } = server()
    for (const path of ['/.well-known/oauth-protected-resource/mcp', '/.well-known/oauth-protected-resource']) {
      const resource = await fetch(`${BASE}${path}`)
      expect(resource.status).toBe(200)
      expect(await resource.json()).toMatchObject({ resource: `${BASE}/mcp`, authorization_servers: [BASE] })
    }
    const server_ = await fetch(`${BASE}/.well-known/oauth-authorization-server`)
    expect(await server_.json()).toEqual({
      issuer: BASE,
      authorization_endpoint: `${BASE}/oauth/authorize`,
      token_endpoint: `${BASE}/oauth/token`,
      registration_endpoint: `${BASE}/oauth/register`,
      revocation_endpoint: `${BASE}/oauth/revoke`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      revocation_endpoint_auth_methods_supported: ['none'],
    })
  })
})

describe('signing in', () => {
  it('registers, authorizes, swaps the code, lists brands, and goes on in the same session after a refresh', async () => {
    const { signIn, fetch } = server()
    const { oauth, kept } = provider()

    const first = new Client({ name: 'claude-code', version: '1.0.0' })
    await expect(first.connect(transportOf(fetch, oauth))).rejects.toThrow(/unauthorized/i)
    expect(kept.client?.client_id).toBeDefined()
    expect(signIn.clientAddresses()).toEqual([CLIENT_ADDRESS])
    expect(kept.authorizeAt?.searchParams.get('resource')).toBe(`${BASE}/mcp`)
    expect(kept.authorizeAt?.searchParams.get('code_challenge_method')).toBe('S256')

    const code = await authorizeAsPerson(fetch, signIn, kept.authorizeAt ?? new URL(BASE))
    const transport = transportOf(fetch, oauth)
    await transport.finishAuth(code)
    expect(kept.tokens?.access_token).toBe(signIn.accessTokens()[0])

    const client = new Client({ name: 'claude-code', version: '1.0.0' })
    await client.connect(transport)
    const brands = await client.callTool({ name: 'list_brands', arguments: {} })
    expect(JSON.parse(textOf(brands as never))).toEqual(TEST_BRANDS)
    const session = transport.sessionId
    expect(session).toBeDefined()

    signIn.api.refuse(kept.tokens?.access_token ?? '')
    const again = await client.callTool({ name: 'list_brands', arguments: {} })
    expect(JSON.parse(textOf(again as never))).toEqual(TEST_BRANDS)
    expect(signIn.accessTokens()).toHaveLength(2)
    expect(kept.tokens?.access_token).toBe(signIn.accessTokens()[1])
    expect(transport.sessionId).toBe(session)
    await client.close()
  })
})
