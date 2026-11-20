// An agent's sign-in through the API's OAuth routes, on the app built as main.ts builds it, against Postgres
// from Docker Compose: registration, the authorization request, the person's consent, the code swapped with
// its PKCE verifier, refresh and revoke.
import { createHash, randomBytes } from 'node:crypto'

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { brands, newId } from '@dazbee/db'
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
  const person = await addPerson([
    limitedToFirst ? [workspace.id, role, [made[0]?.id ?? '']] : [workspace.id, role],
  ])
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
