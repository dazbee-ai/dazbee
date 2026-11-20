// An agent's sign-in through the API's OAuth routes, on the app built as main.ts builds it, against Postgres
// from Docker Compose: registration, the authorization request, the person's consent, the code swapped with
// its PKCE verifier, refresh and revoke.
import { createHash, randomBytes } from 'node:crypto'

import { and, eq } from 'drizzle-orm'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { agentAccesses, agentAuthorizations, agentClients, agentTokens, brands, memberships, newId } from '@dazbee/db'
import { AGENT_CLIENT_IP_HEADER, AGENT_RESOURCE_HEADER, type MemberRole } from '@dazbee/schema'

import { createApp } from '../app.ts'
import { sessionOfRequest } from '../sign-in/session.ts'
import { addPerson, addWorkspace, authorization, db, sessionSecret, storage, syncSecret } from '../test-api.ts'

const RESOURCE = 'https://app.test/mcp'
const REDIRECT = 'http://127.0.0.1:43123/callback'
const SECOND = 1000
const MINUTE = 60 * SECOND

const app = createApp({
  db,
  storage,
  sessionOf: sessionOfRequest({ db, secret: sessionSecret, dev: false }),
  syncSecret,
  build: 'test-build',
})

/** Each test's own client address, so the registrations one makes never count against another's. */
let addresses = 0
const address = () => `203.0.113.${(addresses += 1)}`

/** An answer: its status, headers and JSON body. */
interface Answer {
  status: number
  headers: Headers
  json: Record<string, unknown>
}

/** Asks the app as `apps/mcp` or the web app would: a JSON body, and the headers given. */
async function ask(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const response = await app.request(path, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const text = await response.text()
  return { status: response.status, headers: response.headers, json: text ? JSON.parse(text) : {} } as Answer
}

/** Registers a client from `from`, as RFC 7591 asks. */
const register = (metadata: Record<string, unknown>, from = address()) =>
  ask('POST', '/agent/clients', metadata, { [AGENT_CLIENT_IP_HEADER]: from })

/** A PKCE pair: a random verifier and its S256 challenge. */
function pkce() {
  const verifier = randomBytes(48).toString('base64url')
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') }
}

/** A registered client with `REDIRECT` and one more redirect URI. */
async function client() {
  const registered = await register({ client_name: 'Claude Code', redirect_uris: [REDIRECT, `${REDIRECT}/other`] })
  expect(registered.status).toBe(201)
  return registered.json.client_id as string
}

/** Starts an authorization for `clientId`, with the parameters given over the usual ones. */
function authorize(clientId: string, challenge: string, params: Record<string, string> = {}) {
  const usual = {
    response_type: 'code',
    client_id: clientId,
    redirect_uri: REDIRECT,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state: 'state-1',
    resource: RESOURCE,
  }
  return ask('POST', '/agent/authorizations', { ...usual, ...params }, { [AGENT_RESOURCE_HEADER]: RESOURCE })
}

/** Asks the token endpoint with `params`. */
const token = (params: Record<string, string>) =>
  ask('POST', '/agent/tokens', params, { [AGENT_RESOURCE_HEADER]: RESOURCE })

/** Asks as a person, with their session token. */
const asPerson = (as: string, method: string, path: string, body?: unknown) =>
  ask(method, path, body, authorization(as))

/** Asks as an agent, with its access token. */
const asAgent = (accessToken: string, method: string, path: string) =>
  ask(method, path, undefined, { authorization: `Bearer ${accessToken}` })

/** A workspace with two brands and a member of it in `role`. */
async function member(role: MemberRole = 'editor', limitedToFirst = false) {
  const workspace = await addWorkspace()
  const made = [
    { id: newId(), workspaceId: workspace.id, name: 'First' },
    { id: newId(), workspaceId: workspace.id, name: 'Second' },
  ]
  await db.insert(brands).values(made)
  const person = await addPerson([limitedToFirst ? [workspace.id, role, [made[0]?.id ?? '']] : [workspace.id, role]])
  return { workspace, brandIds: made.map((brand) => brand.id), person }
}

/** The parameters of a redirect URL. */
const paramsOf = (url: unknown) => Object.fromEntries(new URL(String(url)).searchParams)

/**
 * A whole sign-in: a client, a request, the member's consent to `choice`, and the code swapped; the tokens
 * with what was used to get them.
 */
async function signIn(
  { workspace, person }: Awaited<ReturnType<typeof member>>,
  choice: { brandIds: string[] | null; writes: boolean } = { brandIds: null, writes: true },
) {
  const clientId = await client()
  const { verifier, challenge } = pkce()
  const started = await authorize(clientId, challenge)
  const request = started.json.request as string
  const consent = await asPerson(person.as, 'POST', `/workspaces/${workspace.id}/agent-accesses`, {
    request,
    ...choice,
  })
  expect(consent.status).toBe(201)
  const { code } = paramsOf(consent.json.redirect)
  const swapped = await token({
    grant_type: 'authorization_code',
    code: code ?? '',
    redirect_uri: REDIRECT,
    code_verifier: verifier,
    client_id: clientId,
    resource: RESOURCE,
  })
  expect(swapped.status).toBe(200)
  return {
    clientId,
    request,
    code: code ?? '',
    accessToken: swapped.json.access_token as string,
    refreshToken: swapped.json.refresh_token as string,
  }
}

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
})
afterEach(() => {
  vi.setSystemTime(new Date())
})

describe('an agent’s sign-in', () => {
  it('registers, is authorized by the member, swaps the code with its verifier, refreshes and is revoked', async () => {
    const { workspace, brandIds, person } = await member()
    const registered = await register({
      client_name: 'Claude Code',
      redirect_uris: [REDIRECT],
      token_endpoint_auth_method: 'none',
    })
    expect(registered).toMatchObject({
      status: 201,
      json: {
        client_name: 'Claude Code',
        redirect_uris: [REDIRECT],
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
      },
    })
    const clientId = registered.json.client_id as string
    const { verifier, challenge } = pkce()

    const started = await authorize(clientId, challenge)
    expect(started.status).toBe(201)
    const request = started.json.request as string

    const shown = await asPerson(person.as, 'GET', `/agent/authorizations/${request}`)
    expect(shown).toMatchObject({
      status: 200,
      json: {
        clientName: 'Claude Code',
        redirectHost: '127.0.0.1:43123',
        workspaces: [{ id: workspace.id, name: workspace.name, role: 'editor', limited: false }],
      },
    })

    const consent = await asPerson(person.as, 'POST', `/workspaces/${workspace.id}/agent-accesses`, {
      request,
      brandIds: [brandIds[0]],
      writes: true,
    })
    expect(consent.status).toBe(201)
    const redirect = new URL(String(consent.json.redirect))
    expect(`${redirect.origin}${redirect.pathname}`).toBe(REDIRECT)
    expect(paramsOf(redirect)).toEqual({ code: expect.any(String), state: 'state-1' })

    const swapped = await token({
      grant_type: 'authorization_code',
      code: paramsOf(redirect).code ?? '',
      redirect_uri: REDIRECT,
      code_verifier: verifier,
      client_id: clientId,
      resource: RESOURCE,
    })
    expect(swapped).toMatchObject({
      status: 200,
      json: {
        access_token: expect.stringMatching(/^dazbee_at_/),
        token_type: 'Bearer',
        expires_in: 3600,
        refresh_token: expect.stringMatching(/^dazbee_rt_/),
      },
    })
    expect(swapped.headers.get('cache-control')).toBe('no-store')
    const first = { access: swapped.json.access_token as string, refresh: swapped.json.refresh_token as string }

    expect(await asAgent(first.access, 'GET', '/agent/me')).toMatchObject({
      status: 200,
      json: { workspaceId: workspace.id, brandIds: [brandIds[0]], writes: true, clientName: 'Claude Code' },
    })

    const refresh = (refreshToken: string) =>
      token({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId, resource: RESOURCE })
    const refreshed = await refresh(first.refresh)
    expect(refreshed.status).toBe(200)
    expect(refreshed.headers.get('cache-control')).toBe('no-store')
    const second = { access: refreshed.json.access_token as string, refresh: refreshed.json.refresh_token as string }
    expect((await asAgent(second.access, 'GET', '/agent/me')).status).toBe(200)

    vi.setSystemTime(Date.now() + 10 * SECOND)
    expect(await refresh(first.refresh)).toMatchObject({ status: 400, json: { error: 'invalid_grant' } })
    expect((await asAgent(second.access, 'GET', '/agent/me')).status).toBe(200)

    vi.setSystemTime(Date.now() + 30 * SECOND)
    expect(await refresh(first.refresh)).toMatchObject({ status: 400, json: { error: 'invalid_grant' } })
    expect((await asAgent(second.access, 'GET', '/agent/me')).status).toBe(401)
    expect(await refresh(second.refresh)).toMatchObject({ status: 400, json: { error: 'invalid_grant' } })

    const again = await signIn({ workspace, brandIds, person })
    expect((await asAgent(again.accessToken, 'GET', '/agent/me')).status).toBe(200)
    const revoked = await ask('POST', '/agent/tokens/revoke', { token: again.refreshToken, client_id: again.clientId })
    expect(revoked.status).toBe(200)
    expect((await asAgent(again.accessToken, 'GET', '/agent/me')).status).toBe(401)
    const afterRevoke = await token({
      grant_type: 'refresh_token',
      refresh_token: again.refreshToken,
      client_id: again.clientId,
    })
    expect(afterRevoke).toMatchObject({ status: 400, json: { error: 'invalid_grant' } })
  })
})

describe('registration', () => {
  it('takes https:// and http:// on this machine, and refuses any other http://, a fragment and none or 11 URIs', async () => {
    const ok = ['https://example.com/cb?x=1', 'http://localhost/cb', 'http://127.0.0.1:9/cb', 'http://[::1]:5/cb']
    expect((await register({ redirect_uris: ok })).status).toBe(201)
    for (const redirect_uris of [
      ['http://example.com/cb'],
      ['http://127.0.0.2/cb'],
      ['https://example.com/cb#here'],
      ['https://user:pass@example.com/cb'],
      ['myapp://cb'],
      ['not an address'],
      [],
      Array.from({ length: 11 }, (_, i) => `https://example.com/${i}`),
    ])
      expect(await register({ redirect_uris })).toMatchObject({ status: 400, json: { error: 'invalid_redirect_uri' } })
    expect(await register({})).toMatchObject({ status: 400, json: { error: 'invalid_redirect_uri' } })
    expect(await register({ redirect_uris: ok, client_name: 7 })).toMatchObject({
      status: 400,
      json: { error: 'invalid_client_metadata' },
    })
  })

  it('takes control characters out of the name, cuts it to 100 characters, and names a client with none "AI agent"', async () => {
    const named = async (client_name?: string) =>
      (await register({ redirect_uris: [REDIRECT], ...(client_name === undefined ? {} : { client_name }) })).json
        .client_name
    expect(await named(' Claude\u0007 ‮Code ')).toBe('Claude Code')
    expect(await named('é'.repeat(150))).toBe('é'.repeat(100))
    expect(await named()).toBe('AI agent')
    expect(await named('\u0000\t ')).toBe('AI agent')
  })

  it('registers every client as public, whatever it asks for', async () => {
    const registered = await register({
      redirect_uris: [REDIRECT],
      token_endpoint_auth_method: 'client_secret_post',
      grant_types: ['client_credentials'],
    })
    expect(registered.status).toBe(201)
    expect(registered.json).toMatchObject({
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
    })
    expect(registered.json).not.toHaveProperty('client_secret')
  })

  it('refuses the 21st registration within an hour from one address, and not another address’s', async () => {
    const from = address()
    for (let i = 0; i < 20; i++) expect((await register({ redirect_uris: [REDIRECT] }, from)).status).toBe(201)
    expect(await register({ redirect_uris: [REDIRECT] }, from)).toMatchObject({ status: 429 })
    expect((await register({ redirect_uris: [REDIRECT] })).status).toBe(201)
    vi.setSystemTime(Date.now() + 61 * MINUTE)
    expect((await register({ redirect_uris: [REDIRECT] }, from)).status).toBe(201)
  })
})

describe('authorize', () => {
  /** The usual request's parameters without those named. */
  function without(clientId: string, challenge: string, ...names: string[]) {
    const usual = {
      response_type: 'code',
      client_id: clientId,
      redirect_uri: REDIRECT,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state: 'state-1',
    }
    const kept = Object.entries(usual).filter(([name]) => !names.includes(name))
    return ask('POST', '/agent/authorizations', Object.fromEntries(kept), { [AGENT_RESOURCE_HEADER]: RESOURCE })
  }

  it('refuses an unknown client and an unregistered redirect URI without a redirect', async () => {
    const clientId = await client()
    const { challenge } = pkce()
    for (const params of [
      { client_id: 'nobody' },
      { redirect_uri: 'http://127.0.0.1:43123/elsewhere' },
      { redirect_uri: `${REDIRECT}/` },
    ]) {
      const refused = await authorize(clientId, challenge, params)
      expect(refused.status).toBe(400)
      expect(refused.json).not.toHaveProperty('redirect')
    }
    const none = await without(clientId, challenge, 'redirect_uri')
    expect(none.status).toBe(400)
    expect(none.json).not.toHaveProperty('redirect')
  })

  it('sends a plain or missing challenge, a wrong resource and another response type back with the OAuth error', async () => {
    const clientId = await client()
    const { verifier, challenge } = pkce()
    const cases: [Record<string, string>, string][] = [
      [{ code_challenge_method: 'plain', code_challenge: verifier }, 'invalid_request'],
      [{ code_challenge: '' }, 'invalid_request'],
      [{ resource: 'https://elsewhere.test/mcp' }, 'invalid_target'],
      [{ response_type: 'token' }, 'unsupported_response_type'],
    ]
    for (const [params, error] of cases) {
      const refused = await authorize(clientId, challenge, params)
      expect(refused).toMatchObject({ status: 400, json: { error } })
      expect(paramsOf(refused.json.redirect)).toMatchObject({ error, state: 'state-1' })
      expect(String(refused.json.redirect).startsWith(`${REDIRECT}?`)).toBe(true)
    }
    expect(await without(clientId, challenge, 'code_challenge_method')).toMatchObject({
      status: 400,
      json: { error: 'invalid_request' },
    })
  })

  it('takes a request without a resource', async () => {
    const { challenge } = pkce()
    expect((await without(await client(), challenge)).status).toBe(201)
  })
})

describe('consent', () => {
  /** A request waiting for consent, with its verifier. */
  async function waiting() {
    const clientId = await client()
    const { verifier, challenge } = pkce()
    const started = await authorize(clientId, challenge)
    return { clientId, verifier, request: started.json.request as string }
  }

  const allow = (as: string, workspaceId: string, body: unknown) =>
    asPerson(as, 'POST', `/workspaces/${workspaceId}/agent-accesses`, body)

  it('refuses an expired, tampered or answered request', async () => {
    const { workspace, person } = await member()
    const choice = { brandIds: null, writes: true }
    const { request } = await waiting()
    expect((await allow(person.as, workspace.id, { request: `${request}x`, ...choice })).status).toBe(404)
    expect((await asPerson(person.as, 'GET', `/agent/authorizations/${request.slice(1)}`)).status).toBe(404)
    vi.setSystemTime(Date.now() + 10 * MINUTE + SECOND)
    expect((await asPerson(person.as, 'GET', `/agent/authorizations/${request}`)).status).toBe(404)
    expect((await allow(person.as, workspace.id, { request, ...choice })).status).toBe(404)

    vi.setSystemTime(new Date())
    const answered = await waiting()
    expect((await allow(person.as, workspace.id, { request: answered.request, ...choice })).status).toBe(201)
    expect((await allow(person.as, workspace.id, { request: answered.request, ...choice })).status).toBe(404)
  })

  it('refuses a brand the member can’t see, and writes for a Reviewer, leaving the request waiting', async () => {
    const limited = await member('editor', true)
    const { request } = await waiting()
    const other = await member()
    for (const brandIds of [[limited.brandIds[1] ?? ''], [other.brandIds[0] ?? ''], ['no-such-brand']])
      expect((await allow(limited.person.as, limited.workspace.id, { request, brandIds, writes: true })).status).toBe(
        404,
      )
    const first = [limited.brandIds[0]]
    expect(
      (await allow(limited.person.as, limited.workspace.id, { request, brandIds: first, writes: true })).status,
    ).toBe(201)

    const reviewer = await member('reviewer')
    const next = await waiting()
    const asked = { request: next.request, brandIds: null }
    expect((await allow(reviewer.person.as, reviewer.workspace.id, { ...asked, writes: true })).status).toBe(403)
    expect((await allow(reviewer.person.as, reviewer.workspace.id, { ...asked, writes: false })).status).toBe(201)
  })

  it('needs the person’s session, in a workspace of theirs', async () => {
    const { workspace } = await member()
    const { request } = await waiting()
    const choice = { request, brandIds: null, writes: true }
    expect((await ask('GET', `/agent/authorizations/${request}`)).status).toBe(401)
    expect((await ask('POST', `/workspaces/${workspace.id}/agent-accesses`, choice)).status).toBe(401)
    const stranger = await member()
    expect((await allow(stranger.person.as, workspace.id, choice)).status).toBe(404)
  })

  it('denies with access_denied and the state, and the request is gone', async () => {
    const { workspace, person } = await member()
    const { request } = await waiting()
    const denied = await asPerson(person.as, 'POST', `/agent/authorizations/${request}/deny`)
    expect(denied.status).toBe(200)
    expect(paramsOf(denied.json.redirect)).toMatchObject({ error: 'access_denied', state: 'state-1' })
    expect((await allow(person.as, workspace.id, { request, brandIds: null, writes: true })).status).toBe(404)
  })

  it('leaves no access in Settings until the code is swapped', async () => {
    const { workspace, person } = await member()
    const { request } = await waiting()
    expect((await allow(person.as, workspace.id, { request, brandIds: null, writes: true })).status).toBe(201)
    expect(await asPerson(person.as, 'GET', `/workspaces/${workspace.id}/agent-accesses`)).toMatchObject({
      status: 200,
      json: [],
    })
  })
})

describe('the code', () => {
  /** A code the member allowed, with what swapping it takes. */
  async function allowed() {
    const { workspace, person } = await member()
    const clientId = await client()
    const { verifier, challenge } = pkce()
    const request = (await authorize(clientId, challenge)).json.request as string
    const consent = await asPerson(person.as, 'POST', `/workspaces/${workspace.id}/agent-accesses`, {
      request,
      brandIds: null,
      writes: true,
    })
    const params = {
      grant_type: 'authorization_code',
      code: paramsOf(consent.json.redirect).code ?? '',
      redirect_uri: REDIRECT,
      code_verifier: verifier,
      client_id: clientId,
    }
    return { workspace, person, params }
  }

  it('works once, and used again ends the access it gave', async () => {
    const { params } = await allowed()
    const first = await token(params)
    expect(first.status).toBe(200)
    expect(await token(params)).toMatchObject({ status: 400, json: { error: 'invalid_grant' } })
    expect((await asAgent(first.json.access_token as string, 'GET', '/agent/me')).status).toBe(401)
  })

  it('works only with its redirect URI, its client and the right verifier', async () => {
    const { params } = await allowed()
    const other = await client()
    for (const wrong of [
      { redirect_uri: `${REDIRECT}/other` },
      { client_id: other },
      { code_verifier: pkce().verifier },
      { code_verifier: 'short' },
      { code: `${params.code}x` },
      { resource: 'https://elsewhere.test/mcp' },
    ])
      expect((await token({ ...params, ...wrong })).status).toBe(400)
    expect(await token({ ...params, client_id: 'nobody' })).toMatchObject({
      status: 401,
      json: { error: 'invalid_client' },
    })
    expect((await token(params)).status).toBe(200)
  })

  it('does not work after 60 seconds', async () => {
    const { params } = await allowed()
    vi.setSystemTime(Date.now() + 61 * SECOND)
    expect(await token(params)).toMatchObject({ status: 400, json: { error: 'invalid_grant' } })
  })

  it('does not work once its person has left the workspace', async () => {
    const { workspace, person, params } = await allowed()
    await db
      .delete(memberships)
      .where(and(eq(memberships.workspaceId, workspace.id), eq(memberships.userId, person.id)))
    expect(await token(params)).toMatchObject({ status: 400, json: { error: 'invalid_grant' } })
  })

  it('answers an unknown grant type and a refresh for another client with the OAuth error', async () => {
    const { params } = await allowed()
    const tokens = await token(params)
    expect(await token({ grant_type: 'password' })).toMatchObject({
      status: 400,
      json: { error: 'unsupported_grant_type' },
    })
    const refresh = { grant_type: 'refresh_token', refresh_token: tokens.json.refresh_token as string }
    expect(await token({ ...refresh, client_id: await client() })).toMatchObject({
      status: 400,
      json: { error: 'invalid_grant' },
    })
    expect((await token({ ...refresh, client_id: params.client_id })).status).toBe(200)
  })
})

describe('what is kept and logged', () => {
  it('keeps no token, code or request id, and logs none', async () => {
    const logged = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => {}),
    )
    const { workspace, brandIds, person } = await member()
    const signed = await signIn({ workspace, brandIds, person })
    const refreshed = await token({
      grant_type: 'refresh_token',
      refresh_token: signed.refreshToken,
      client_id: signed.clientId,
    })
    const secrets = [
      signed.request,
      signed.code,
      signed.accessToken,
      signed.refreshToken,
      refreshed.json.access_token as string,
      refreshed.json.refresh_token as string,
    ]
    const kept = JSON.stringify(
      await Promise.all([
        db.select().from(agentAuthorizations),
        db.select().from(agentTokens),
        db.select().from(agentAccesses),
        db.select().from(agentClients),
      ]),
    )
    const lines = JSON.stringify(logged.map((spy) => spy.mock.calls))
    for (const spy of logged) spy.mockRestore()
    for (const secret of secrets) {
      expect(secret.length).toBeGreaterThan(20)
      expect(kept).not.toContain(secret)
      expect(lines).not.toContain(secret)
    }
  })
})
