// Agents' OAuth sign-in (ADR-0019): registering a client, keeping its authorization request while the person
// decides, their consent or refusal, and swapping the code their consent gives, with its PKCE verifier, for an
// agent access and its first tokens. Public clients only, PKCE S256 only. A request and a code are kept only as
// the SHA-256 of their random ids; a request lasts 10 minutes and is used once, a code 60 seconds and once.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

import { and, eq, gt, lt } from 'drizzle-orm'

import { agentAccesses, agentAuthorizations, agentClients, type Db, memberships, newId } from '@dazbee/db'
import type { AgentAuthorizationStarted, MemberBrands, OAuthError, OAuthParams } from '@dazbee/schema'

import { type AgentTokens, hashOf, issueTokens, makeAccess } from './agent-accesses.ts'

/** What a client registered as, as RFC 7591 answers it. */
export interface RegisteredClient {
  client_id: string
  client_id_issued_at: number
  client_name: string
  redirect_uris: string[]
  grant_types: string[]
  response_types: string[]
  token_endpoint_auth_method: 'none'
}

/** A client's metadata as Dazbee keeps it: its name and the addresses it may be sent back to. */
export interface ClientMetadata {
  name: string
  redirectUris: string[]
}

/** A sign-in request as the person sees it: the client's name and where it sends them back to. */
export interface PendingRequest {
  clientName: string
  redirectUri: string
}

/** What the person chose for the agent: who they are, the workspace, its brands and whether it writes. */
export interface Consent {
  userId: string
  workspaceId: string
  brandIds: MemberBrands
  writes: boolean
}

/** A swap's answer: the tokens, or the OAuth error and the status to answer it with. */
export type Swapped = { ok: true; tokens: AgentTokens } | { ok: false; status: 400 | 401; error: OAuthError }

/** The name of a client that gives none. */
export const NO_CLIENT_NAME = 'AI agent'
export const MAX_CLIENT_NAME = 100
export const MAX_REDIRECT_URIS = 10
export const REQUEST_TTL_MS = 10 * 60 * 1000
export const CODE_TTL_MS = 60 * 1000
/** What a client asking for another resource than the MCP server is told. */
export const WRONG_RESOURCE = 'Dazbee signs agents in only for its MCP server'

/** The hosts a client may be sent back to over plain `http://`: this machine's (RFC 8252). */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])
const MAX_REDIRECT_URI = 2048
const MAX_STATE = 1024
/** How long a request or code is kept after it expires, before a later sign-in deletes it, so a server whose clock runs ahead of another's never deletes the other's. */
const KEPT_AFTER_EXPIRY_MS = 60 * 60 * 1000
/** An S256 challenge: the base64url of a SHA-256, 43 characters. */
const S256_CHALLENGE = /^[\w-]{43}$/
/** A PKCE verifier (RFC 7636 §4.1): 43 to 128 unreserved characters. */
const VERIFIER = /^[\w.~-]{43,128}$/

/** The client's metadata from its registration (RFC 7591), or the error to answer it with. */
export function readClientMetadata(input: unknown): ClientMetadata | OAuthError {
  if (typeof input !== 'object' || input === null || Array.isArray(input))
    return { error: 'invalid_client_metadata', error_description: 'The registration is not a JSON object' }
  const { redirect_uris: uris, client_name: name } = input as Record<string, unknown>
  if (!Array.isArray(uris) || uris.length < 1 || uris.length > MAX_REDIRECT_URIS)
    return {
      error: 'invalid_redirect_uri',
      error_description: `Give 1 to ${MAX_REDIRECT_URIS} redirect URIs`,
    }
  for (const uri of uris) {
    const problem = redirectUriProblem(uri)
    if (problem) return { error: 'invalid_redirect_uri', error_description: `A redirect URI ${problem}` }
  }
  if (name !== undefined && name !== null && typeof name !== 'string')
    return { error: 'invalid_client_metadata', error_description: 'client_name is not text' }
  return { name: clientName(name), redirectUris: uris as string[] }
}

/** Registers a public client; what it registered as. */
export async function registerClient(db: Db, metadata: ClientMetadata, now = new Date()): Promise<RegisteredClient> {
  const id = newId()
  await db.insert(agentClients).values({ id, ...metadata, createdAt: now })
  return {
    client_id: id,
    client_id_issued_at: Math.floor(now.getTime() / 1000),
    client_name: metadata.name,
    redirect_uris: metadata.redirectUris,
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
  }
}

/**
 * Checks an authorization request (RFC 6749 §4.1.1, PKCE S256, RFC 8707's `resource`, which must be `resource`
 * when given) and keeps it for the person's consent, under a random id. The redirect URI is one the client
 * registered, or on this machine (`http://` on a loopback host) one of them at another port (RFC 8252 §7.3). An
 * unknown client or redirect URI answers an error with no redirect. Any other problem answers an error with the
 * redirect back to a client on this machine, and with none to one elsewhere, so no one can make Dazbee send a
 * person on to an address of theirs without the person's consent.
 */
export async function startAuthorization(
  db: Db,
  params: OAuthParams,
  resource: string | null,
  now = new Date(),
): Promise<AgentAuthorizationStarted> {
  const [client] = await db
    .select({ id: agentClients.id, redirectUris: agentClients.redirectUris })
    .from(agentClients)
    .where(eq(agentClients.id, params.client_id ?? ''))
  if (!client)
    return { error: 'invalid_client', error_description: 'This agent isn’t registered with Dazbee; connect it again' }
  const redirectUri = params.redirect_uri
  if (redirectUri === undefined || !client.redirectUris.some((uri) => sameRedirect(uri, redirectUri)))
    return {
      error: 'invalid_request',
      error_description: 'The address to send you back to is not one this agent registered',
    }
  const state = params.state !== undefined && params.state.length <= MAX_STATE ? params.state : undefined
  const back = (error: string, description: string) => ({
    error,
    error_description: description,
    ...(isLoopback(redirectUri)
      ? { redirect: withParams(redirectUri, { error, error_description: description, state }) }
      : {}),
  })
  if (params.response_type !== 'code') return back('unsupported_response_type', 'Only response_type=code is taken')
  if (params.state !== undefined && state === undefined)
    return back('invalid_request', `state is at most ${MAX_STATE} characters`)
  if (params.code_challenge_method !== 'S256') return back('invalid_request', 'Give a PKCE challenge with S256')
  if (!S256_CHALLENGE.test(params.code_challenge ?? ''))
    return back('invalid_request', 'code_challenge is not an S256 challenge')
  if (wrongResource(params, resource)) return back('invalid_target', WRONG_RESOURCE)

  const request = randomBytes(32).toString('base64url')
  const kept = new Date(now.getTime() - KEPT_AFTER_EXPIRY_MS)
  await db.delete(agentAuthorizations).where(lt(agentAuthorizations.expiresAt, kept))
  await db.insert(agentAuthorizations).values({
    hash: hashOf(request),
    kind: 'request',
    clientId: client.id,
    redirectUri,
    state: state ?? null,
    codeChallenge: params.code_challenge ?? '',
    expiresAt: new Date(now.getTime() + REQUEST_TTL_MS),
  })
  return { request }
}

/** A sign-in request that is still waiting for the person, or null. */
export async function findRequest(db: Db, request: string, now = new Date()): Promise<PendingRequest | null> {
  const [row] = await db
    .select({ clientName: agentClients.name, redirectUri: agentAuthorizations.redirectUri })
    .from(agentAuthorizations)
    .innerJoin(agentClients, eq(agentClients.id, agentAuthorizations.clientId))
    .where(pendingRequest(request, now))
  return row ?? null
}

/**
 * Swaps a waiting request for a code holding the person's choice; the client's redirect URI with the code and
 * its state, or null when the request has expired, was used or never was. The access is made only when the
 * code is swapped.
 */
export async function consent(db: Db, request: string, choice: Consent, now = new Date()): Promise<string | null> {
  return db.transaction(async (tx) => {
    const [row] = await tx.delete(agentAuthorizations).where(pendingRequest(request, now)).returning()
    if (!row) return null
    const code = randomBytes(32).toString('base64url')
    await tx.insert(agentAuthorizations).values({
      ...row,
      hash: hashOf(code),
      kind: 'code',
      ...choice,
      expiresAt: new Date(now.getTime() + CODE_TTL_MS),
      createdAt: now,
    })
    return withParams(row.redirectUri, { code, state: row.state ?? undefined })
  })
}

/** Drops a waiting request the person refused; the client's redirect URI with `access_denied`, or null. */
export async function deny(db: Db, request: string, now = new Date()): Promise<string | null> {
  const [row] = await db.delete(agentAuthorizations).where(pendingRequest(request, now)).returning()
  if (!row) return null
  const error = { error: 'access_denied', error_description: 'The person did not allow this agent' }
  return withParams(row.redirectUri, { ...error, state: row.state ?? undefined })
}

/**
 * Swaps a code (RFC 6749 §4.1.3 with PKCE) for a new agent access, from the person's choice, and its first
 * tokens. The code works once, for its client, with its redirect URI and the verifier of its challenge, within
 * 60 seconds, while its person is still a member of its workspace. Used again within them, with its redirect URI
 * and verifier, it ends the access it gave, as a code someone else swapped first would.
 */
export async function swapCode(
  db: Db,
  params: OAuthParams,
  resource: string | null,
  now = new Date(),
): Promise<Swapped> {
  const { code, redirect_uri: redirectUri, code_verifier: verifier, client_id: clientId } = params
  if (!code || !redirectUri || !verifier || !clientId)
    return refusal('invalid_request', 'Give code, redirect_uri, code_verifier and client_id')
  if (wrongResource(params, resource)) return refusal('invalid_target', WRONG_RESOURCE)
  const [client] = await db.select({ name: agentClients.name }).from(agentClients).where(eq(agentClients.id, clientId))
  if (!client)
    return { ok: false, status: 401, error: { error: 'invalid_client', error_description: 'No such client' } }

  return db.transaction(async (tx): Promise<Swapped> => {
    const [row] = await tx
      .select()
      .from(agentAuthorizations)
      .where(and(eq(agentAuthorizations.hash, hashOf(code)), eq(agentAuthorizations.kind, 'code')))
      .for('update')
    const invalid = refusal('invalid_grant', 'The code is not valid; sign in again')
    if (!row || row.clientId !== clientId) return invalid
    if (row.expiresAt.getTime() <= now.getTime()) return invalid
    if (row.redirectUri !== redirectUri || !verifies(verifier, row.codeChallenge)) return invalid
    if (row.accessId) {
      await tx.update(agentAccesses).set({ endedAt: now }).where(eq(agentAccesses.id, row.accessId))
      return invalid
    }
    const { userId, workspaceId } = row
    if (!userId || !workspaceId) return invalid
    const [member] = await tx
      .select({ userId: memberships.userId })
      .from(memberships)
      .where(and(eq(memberships.workspaceId, workspaceId), eq(memberships.userId, userId)))
    if (!member) return invalid
    const access = { userId, workspaceId, brandIds: row.brandIds, writes: row.writes ?? false }
    const accessId = await makeAccess(tx, { ...access, clientId, clientName: client.name })
    await tx.update(agentAuthorizations).set({ accessId }).where(eq(agentAuthorizations.hash, row.hash))
    return { ok: true, tokens: await issueTokens(tx, accessId, now) }
  })
}

/** An OAuth error answered 400. */
export function refusal(error: string, description: string): Swapped & { ok: false } {
  return { ok: false, status: 400, error: { error, error_description: description } }
}

/** Whether a client's `resource` is given and not the resource the server serves. */
export function wrongResource(params: OAuthParams, resource: string | null): boolean {
  return params.resource !== undefined && params.resource !== resource
}

/** Why a redirect URI can't be registered, or null when it can: `https://`, or `http://` on this machine. */
function redirectUriProblem(uri: unknown): string | null {
  if (typeof uri !== 'string' || uri.length > MAX_REDIRECT_URI)
    return `is not an address of at most ${MAX_REDIRECT_URI} characters`
  let url: URL
  try {
    url = new URL(uri)
  } catch {
    return 'is not an address'
  }
  if (uri.includes('#')) return 'has a fragment'
  if (url.username || url.password) return 'holds a user name or password'
  if (url.protocol === 'https:' || isLoopback(uri)) return null
  return 'must be https://, or http:// on localhost, 127.0.0.1 or [::1]'
}

/** A client's name without control and format characters, trimmed and cut to `MAX_CLIENT_NAME`; "AI agent" when that leaves none. */
function clientName(name: string | null | undefined): string {
  const clean = (name ?? '').replace(/[\p{Cc}\p{Cf}]/gu, '').trim()
  return Array.from(clean).slice(0, MAX_CLIENT_NAME).join('').trimEnd() || NO_CLIENT_NAME
}

/** Whether `uri` is an `http://` address on this machine. */
function isLoopback(uri: string): boolean {
  const url = URL.parse(uri)
  return url?.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname)
}

/**
 * Whether `given` is the registered redirect URI: the same text, or on this machine the same address at another
 * port, which a native client picks as it starts (RFC 8252 §7.3).
 */
function sameRedirect(registered: string, given: string): boolean {
  if (registered === given) return true
  if (!isLoopback(registered) || !isLoopback(given)) return false
  const [a, b] = [new URL(registered), new URL(given)]
  a.port = ''
  b.port = ''
  return a.href === b.href
}

/** `uri` with the parameters given added to its query; one left undefined is left out. */
function withParams(uri: string, params: Record<string, string | undefined>): string {
  const url = new URL(uri)
  for (const [name, value] of Object.entries(params)) if (value !== undefined) url.searchParams.set(name, value)
  return url.toString()
}

/** The rows of a sign-in request by its id, while it lasts. */
function pendingRequest(request: string, now: Date) {
  return and(
    eq(agentAuthorizations.hash, hashOf(request)),
    eq(agentAuthorizations.kind, 'request'),
    gt(agentAuthorizations.expiresAt, now),
  )
}

/** Whether `verifier` is a PKCE verifier whose S256 is `challenge`, compared in constant time. */
function verifies(verifier: string, challenge: string): boolean {
  if (!VERIFIER.test(verifier)) return false
  const made = Buffer.from(createHash('sha256').update(verifier).digest('base64url'))
  const kept = Buffer.from(challenge)
  return made.length === kept.length && timingSafeEqual(made, kept)
}
