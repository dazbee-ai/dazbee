// The agents' sign-in routes as their seam tests call them, against Postgres from Docker Compose: the app built as
// main.ts builds it, with agents' sessions; a fresh client address for each call; a client, a PKCE pair, a member
// with two brands, the authorization request, the token endpoint, and a whole sign-in. A test file that imports it
// has Date faked, so a test can move the clock, and set back to now after each test.
import { createHash, randomBytes } from 'node:crypto'

import { afterEach, beforeAll, expect, vi } from 'vitest'

import { brands, newId } from '@dazbee/db'
import { AGENT_CLIENT_IP_HEADER, AGENT_RESOURCE_HEADER, type MemberRole } from '@dazbee/schema'

import { createApp } from '../app.ts'
import { sessionOfRequest } from '../sign-in/session.ts'
import { addPerson, addWorkspace, authorization, db, sessionSecret, storage, syncSecret } from '../test-api.ts'

/** An answer: its status, headers and JSON body. */
export interface Answer {
  status: number
  headers: Headers
  json: Record<string, unknown>
}

export const RESOURCE = 'https://app.test/mcp'
export const REDIRECT = 'http://127.0.0.1:43123/callback'
export const SECOND = 1000
export const MINUTE = 60 * SECOND

const app = createApp({
  db,
  storage,
  sessionOf: sessionOfRequest({ db, secret: sessionSecret, dev: false }),
  syncSecret,
  build: 'test-build',
})

/** How many client addresses `address` has given, which numbers the next. */
let addresses = 0

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
})
afterEach(() => {
  vi.setSystemTime(new Date())
})

/** A client address of its own, so the requests one test makes never count against another's. */
export function address(): string {
  return `203.0.113.${(addresses += 1)}`
}

/** Asks the app as `apps/mcp` or the web app would: a JSON body, and the headers given. */
export async function ask(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<Answer> {
  const response = await app.request(path, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const text = await response.text()
  return { status: response.status, headers: response.headers, json: text ? JSON.parse(text) : {} }
}

/** Registers a client from `from`, as RFC 7591 asks. */
export function register(metadata: Record<string, unknown>, from = address()): Promise<Answer> {
  return ask('POST', '/agent/clients', metadata, { [AGENT_CLIENT_IP_HEADER]: from })
}

/** A PKCE pair: a random verifier and its S256 challenge. */
export function pkce() {
  const verifier = randomBytes(48).toString('base64url')
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') }
}

/** A registered client with `REDIRECT` and one more redirect URI; its id. */
export async function client(): Promise<string> {
  const registered = await register({ client_name: 'Claude Code', redirect_uris: [REDIRECT, `${REDIRECT}/other`] })
  expect(registered.status).toBe(201)
  return registered.json.client_id as string
}

/** Starts an authorization for `clientId`, with the parameters given over the usual ones. */
export function authorize(clientId: string, challenge: string, params: Record<string, string> = {}): Promise<Answer> {
  const usual = {
    response_type: 'code',
    client_id: clientId,
    redirect_uri: REDIRECT,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state: 'state-1',
    resource: RESOURCE,
  }
  return start({ ...usual, ...params })
}

/** Starts an authorization with exactly `params`, from `from`. */
export function start(params: Record<string, string>, from = address()): Promise<Answer> {
  const headers = { [AGENT_RESOURCE_HEADER]: RESOURCE, [AGENT_CLIENT_IP_HEADER]: from }
  return ask('POST', '/agent/authorizations', params, headers)
}

/** Asks the token endpoint with `params`. */
export function token(params: Record<string, string>): Promise<Answer> {
  return ask('POST', '/agent/tokens', params, { [AGENT_RESOURCE_HEADER]: RESOURCE })
}

/** Asks as a person, with their session token. */
export function asPerson(as: string, method: string, path: string, body?: unknown): Promise<Answer> {
  return ask(method, path, body, authorization(as))
}

/** Asks as an agent, with its access token. */
export function asAgent(accessToken: string, method: string, path: string): Promise<Answer> {
  return ask(method, path, undefined, { authorization: `Bearer ${accessToken}` })
}

/** A workspace with two brands and a member of it in `role`, limited to the first when `limitedToFirst`. */
export async function member(role: MemberRole = 'editor', limitedToFirst = false) {
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
export function paramsOf(url: unknown): Record<string, string> {
  return Object.fromEntries(new URL(String(url)).searchParams)
}

/**
 * A whole sign-in: a client, a request, the member's consent to `choice`, and the code swapped; the tokens
 * with what was used to get them.
 */
export async function signIn(
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
  const { code = '' } = paramsOf(consent.json.redirect)
  const swapped = await token({
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT,
    code_verifier: verifier,
    client_id: clientId,
    resource: RESOURCE,
  })
  expect(swapped.status).toBe(200)
  return {
    clientId,
    request,
    code,
    accessToken: swapped.json.access_token as string,
    refreshToken: swapped.json.refresh_token as string,
  }
}
