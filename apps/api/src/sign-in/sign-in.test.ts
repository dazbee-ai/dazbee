// Sign-in (#58) against Postgres from Docker Compose, with a stand-in for WorkOS that never calls out.
import { randomUUID } from 'node:crypto'

import { and, eq } from 'drizzle-orm'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'

import { invites, memberships, users, workspaces } from '@dazbee/db'
import { ApiError, Invite, SignedIn, SignedOut, SignInLink, WorkspaceSummary } from '@dazbee/schema'
import { readSessionToken, SESSION_TTL_MS, signSessionToken } from '@dazbee/session-token'

import { app, call as callAs, db, sessionSecret as secret, SHORT_ID, workos, workspace } from '../test-api.ts'
import { bearerToken, sessionOfRequest } from './session.ts'
import { accessTokenSessionId, type SignedInPerson, workosProvider, workosSettings } from './sign-in.ts'

const run = randomUUID().slice(0, 8)

const ada: SignedInPerson = {
  user: { id: `user_ada_${run}`, email: `ada-${run}@example.com`, name: 'Ada Lovelace', emailVerified: true },
  sessionId: `session_ada_${run}`,
}
const bo: SignedInPerson = {
  user: { id: `user_bo_${run}`, email: `bo-${run}@example.com`, name: '', emailVerified: true },
  sessionId: null,
}
Object.assign(workos.people, { [`code-ada-${run}`]: ada, [`code-bo-${run}`]: bo })

async function call(method: string, path: string, { body, token }: { body?: unknown; token?: string } = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (token) headers.authorization = `Bearer ${token}`
  const response = await app.request(path, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  return { status: response.status, json: (await response.json()) as unknown }
}
const signIn = async (code: string) => SignedIn.parse((await call('POST', '/auth/callback', { body: { code } })).json)

describe('signing in (#58)', () => {
  it('gives the WorkOS sign-in link for a good state only', async () => {
    const state = randomUUID()
    expect(SignInLink.parse((await call('GET', `/auth/sign-in-url?state=${state}`)).json).url).toBe(
      `https://auth.example.test/authorize?state=${state}`,
    )
    expect((await call('GET', '/auth/sign-in-url?state=short')).status).toBe(400)
    expect((await call('GET', '/auth/sign-in-url')).status).toBe(400)
  })

  it('carries the token of the invite the person came from on to the sign-in link', async () => {
    const state = randomUUID()
    const url = `/auth/sign-in-url?state=${state}`
    expect(SignInLink.parse((await call('GET', `${url}&invitationToken=token_1`)).json).url).toBe(
      `https://auth.example.test/authorize?state=${state}&invitation_token=token_1`,
    )
    expect((await call('GET', `${url}&invitationToken=not%20a%20token`)).status).toBe(400)
  })

  it("sends the person back to a site's own /callback when it names one, and refuses any other address", async () => {
    const state = randomUUID()
    const url = `/auth/sign-in-url?state=${state}`
    const pilot = encodeURIComponent('https://pilot.example.com/callback')
    expect(SignInLink.parse((await call('GET', `${url}&redirectUri=${pilot}`)).json).url).toBe(
      `https://auth.example.test/authorize?state=${state}&redirect_uri=${pilot}`,
    )
    for (const bad of ['https://pilot.example.com/elsewhere', 'javascript:alert(1)', 'not a url'])
      expect((await call('GET', `${url}&redirectUri=${encodeURIComponent(bad)}`)).status).toBe(400)
  })

  it('makes a workspace, its WorkOS organization and an Owner membership on a first sign-in', async () => {
    const first = await signIn(`code-ada-${run}`)
    const [user] = await db.select().from(users).where(eq(users.workosUserId, ada.user.id))
    expect(user).toMatchObject({ email: ada.user.email, name: 'Ada Lovelace' })
    expect(user?.id).toMatch(SHORT_ID)
    expect(first.open).toMatch(SHORT_ID)
    const [workspace] = await db.select().from(workspaces).where(eq(workspaces.id, first.open))
    const organization = workos.made.organizations.find((o) => o.workspaceId === first.open)
    expect(organization).toMatchObject({ name: 'Ada Lovelace' })
    expect(workspace).toMatchObject({ name: 'Ada Lovelace', workosOrganizationId: organization?.id })
    expect(workos.made.members).toContainEqual({ organizationId: organization?.id, userId: ada.user.id })
    expect(
      await db
        .select({ role: memberships.role })
        .from(memberships)
        .where(eq(memberships.userId, user?.id ?? '')),
    ).toEqual([{ role: 'owner' }])

    // The session is good for that workspace, and for as long as a session lasts.
    expect(
      WorkspaceSummary.parse((await call('GET', `/workspaces/${first.open}`, { token: first.token })).json),
    ).toEqual({
      id: first.open,
      name: 'Ada Lovelace',
    })
    expect(first.expiresAt - Date.now()).toBeGreaterThan(SESSION_TTL_MS - 60_000)
  })

  it('signs the same person in to the same workspace again, making nothing new', async () => {
    const before = workos.made.organizations.length
    const first = await signIn(`code-ada-${run}`)
    const again = await signIn(`code-ada-${run}`)
    expect(again.open).toBe(first.open)
    expect(workos.made.organizations).toHaveLength(before)
    expect(await db.select().from(users).where(eq(users.workosUserId, ada.user.id))).toHaveLength(1)
  })

  it('names a first workspace after the email when WorkOS has no name, and keeps workspaces apart', async () => {
    const bos = await signIn(`code-bo-${run}`)
    const adas = await signIn(`code-ada-${run}`)
    expect(bos.open).not.toBe(adas.open)
    expect(WorkspaceSummary.parse((await call('GET', `/workspaces/${bos.open}`, { token: bos.token })).json).name).toBe(
      `bo-${run}`,
    )
    const brand = await call('POST', `/workspaces/${bos.open}/brands`, {
      token: bos.token,
      body: { name: 'Bo’s brand' },
    })
    expect(brand.status).toBe(201)
    expect((await call('GET', `/workspaces/${adas.open}/brands`, { token: adas.token })).json).toEqual([])
    expect((await call('GET', `/workspaces/${bos.open}/brands`, { token: adas.token })).status).toBe(404)
  })

  it('opens the workspace used last, else the one joined first, with a token that names no workspace', async () => {
    const own = await signIn(`code-ada-${run}`)
    const [user] = await db.select({ id: users.id }).from(users).where(eq(users.workosUserId, ada.user.id))
    // Its id sorts before her own workspace's, so only the order she joined them in puts her own first.
    const joined = `0000-joined-${run}`
    await db.insert(workspaces).values({ id: joined, name: 'Joined later' })
    await db.insert(memberships).values({ workspaceId: joined, userId: user?.id ?? '', role: 'editor' })
    await db
      .update(memberships)
      .set({ lastUsedAt: null })
      .where(eq(memberships.userId, user?.id ?? ''))
    expect((await signIn(`code-ada-${run}`)).open).toBe(own.open)

    expect((await call('GET', `/workspaces/${joined}`, { token: own.token })).status).toBe(200)
    const again = await signIn(`code-ada-${run}`)
    expect(again.open).toBe(joined)
    expect(readSessionToken(secret, again.token)).toStrictEqual({
      userId: user?.id,
      workosSessionId: ada.sessionId,
      expiresAt: again.expiresAt,
    })
  })

  it('refuses a code WorkOS does not know, and a body without one, logging each with its reason and not the code', async () => {
    const logged: string[] = []
    const log = vi.spyOn(console, 'log').mockImplementation((line: string) => void logged.push(line))
    onTestFinished(() => log.mockRestore())
    const bad = await call('POST', '/auth/callback', { body: { code: 'not-a-code' } })
    expect(bad.status).toBe(400)
    expect(ApiError.parse(bad.json).error).toMatch(/did not work/)
    expect((await call('POST', '/auth/callback', { body: {} })).status).toBe(400)
    expect(logged.map((line) => JSON.parse(line) as unknown)).toEqual([
      { event: 'sign-in-refused', reason: 'code-not-accepted', error: 'Error' },
      { event: 'sign-in-refused', reason: 'body-not-valid' },
    ])
    expect(logged.join(' ')).not.toContain('not-a-code')
  })

  it('ends a session’s WorkOS session on sign-out, when it has one', async () => {
    const adas = await signIn(`code-ada-${run}`)
    expect(SignedOut.parse((await call('POST', '/auth/sign-out', { token: adas.token })).json).logoutUrl).toBe(
      `https://auth.example.test/logout?session_id=${ada.sessionId}`,
    )
    const bos = await signIn(`code-bo-${run}`)
    expect(SignedOut.parse((await call('POST', '/auth/sign-out', { token: bos.token })).json).logoutUrl).toBeNull()
    expect(SignedOut.parse((await call('POST', '/auth/sign-out')).json).logoutUrl).toBeNull()
  })

  it('refuses a session in a workspace once its person leaves it', async () => {
    const adas = await signIn(`code-ada-${run}`)
    const [user] = await db.select({ id: users.id }).from(users).where(eq(users.workosUserId, ada.user.id))
    await db
      .delete(memberships)
      .where(and(eq(memberships.workspaceId, adas.open), eq(memberships.userId, user?.id ?? '')))
    expect(await call('GET', `/workspaces/${adas.open}`, { token: adas.token })).toEqual({
      status: 404,
      json: { error: 'No such workspace' },
    })
  })
})

describe('accepting an invite at sign-in', () => {
  let people = 0
  /** A person WorkOS knows, with a code that signs them in. */
  function newPerson() {
    people += 1
    const person: SignedInPerson = {
      user: {
        id: `user_invited_${people}_${run}`,
        email: `invited-${people}-${run}@example.com`,
        name: 'Ivy',
        emailVerified: true,
      },
      sessionId: null,
    }
    const code = `code-invited-${people}-${run}`
    workos.people[code] = person
    return { person, code, signIn: () => signIn(code) }
  }
  /** Invites the email to workspace A as its Owner, and the WorkOS invitation it sent. */
  async function invite(email: string, role: string) {
    const sent = await callAs('a', 'POST', '/invites', { email, role })
    expect(sent.status).toBe(201)
    const invitation = workos.made.invitations.at(-1)
    if (!invitation) throw new Error('no invitation sent')
    return { invite: Invite.parse(sent.json), invitationId: invitation.id }
  }
  /** The person's memberships, read back from the database. */
  const membershipsOf = (person: SignedInPerson) =>
    db
      .select({ workspaceId: memberships.workspaceId, role: memberships.role })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(users.workosUserId, person.user.id))

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('makes a new person a member with the invite’s role, opens its workspace and makes none of their own', async () => {
    const { person, signIn: signInAs } = newPerson()
    const { invitationId } = await invite(person.user.email.toUpperCase(), 'editor')
    workos.accept(invitationId, person.user.id)
    const organizations = workos.made.organizations.length
    const signedIn = await signInAs()
    expect(signedIn.open).toBe(workspace.id)
    expect(await membershipsOf(person)).toEqual([{ workspaceId: workspace.id, role: 'editor' }])
    expect(workos.made.organizations).toHaveLength(organizations)
    expect((await call('GET', `/workspaces/${workspace.id}`, { token: signedIn.token })).status).toBe(200)
    expect(
      Invite.array()
        .parse((await callAs('a', 'GET', '/invites')).json)
        .map((i) => i.email),
    ).not.toContain(person.user.email)
  })

  it('adds the invited workspace beside a person’s own, and opens it', async () => {
    const { person, signIn: signInAs } = newPerson()
    const own = (await signInAs()).open
    const { invitationId } = await invite(person.user.email, 'reviewer')
    // Not accepted with WorkOS yet: nothing changes.
    expect((await signInAs()).open).toBe(own)
    workos.accept(invitationId, person.user.id)
    expect((await signInAs()).open).toBe(workspace.id)
    expect(await membershipsOf(person)).toEqual(
      expect.arrayContaining([
        { workspaceId: own, role: 'owner' },
        { workspaceId: workspace.id, role: 'reviewer' },
      ]),
    )
    expect(await membershipsOf(person)).toHaveLength(2)
    // The next sign-in opens the one used last again.
    expect((await signInAs()).open).toBe(own)
  })

  it('makes no membership from an invite past its expiry, whatever WorkOS says', async () => {
    const { person, signIn: signInAs } = newPerson()
    const { invitationId } = await invite(person.user.email, 'editor')
    workos.accept(invitationId, person.user.id)
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 8 * 24 * 60 * 60 * 1000 })
    const signedIn = await signInAs()
    expect(signedIn.open).not.toBe(workspace.id)
    expect(await membershipsOf(person)).toEqual([{ workspaceId: signedIn.open, role: 'owner' }])
  })

  it('makes no membership from a revoked invite', async () => {
    const { person, signIn: signInAs } = newPerson()
    const { invite: sent, invitationId } = await invite(person.user.email, 'editor')
    expect((await callAs('a', 'DELETE', `/invites/${sent.id}`)).status).toBe(204)
    workos.accept(invitationId, person.user.id)
    const signedIn = await signInAs()
    expect(await membershipsOf(person)).toEqual([{ workspaceId: signedIn.open, role: 'owner' }])
  })

  /** An invite of the email whose provider can't read it; its id. */
  async function unreadable(email: string) {
    const id = `lost-${randomUUID().slice(0, 8)}`
    await db.insert(invites).values({
      id,
      workspaceId: workspace.id,
      email,
      role: 'editor',
      providerInviteId: `invitation_unknown_${run}`,
      link: 'https://auth.example.test/invite',
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    })
    vi.spyOn(console, 'log').mockImplementation(() => {})
    return id
  }
  const pendingIds = async () =>
    Invite.array()
      .parse((await callAs('a', 'GET', '/invites')).json)
      .map((i) => i.id)

  it('asks a person in no workspace to try again when an invite’s provider can’t read it, making them none', async () => {
    const { person, code } = newPerson()
    const id = await unreadable(person.user.email)
    const organizations = workos.made.organizations.length
    expect(await call('POST', '/auth/callback', { body: { code } })).toEqual({
      status: 503,
      json: { error: "Sign-in couldn't finish; try again" },
    })
    expect(vi.mocked(console.log)).toHaveBeenCalledWith(
      JSON.stringify({ event: 'sign-in-unfinished', reason: 'invite-unread' }),
    )
    expect(workos.made.organizations).toHaveLength(organizations)
    expect(await membershipsOf(person)).toEqual([])
    expect(await pendingIds()).toContain(id)
  })

  it('signs in a person with a workspace when an invite’s provider can’t read it, leaving the invite for later', async () => {
    const { person, signIn: signInAs } = newPerson()
    const own = (await signInAs()).open
    const id = await unreadable(person.user.email)
    expect((await signInAs()).open).toBe(own)
    expect(await membershipsOf(person)).toEqual([{ workspaceId: own, role: 'owner' }])
    expect(await pendingIds()).toContain(id)
  })

  it('makes no membership from an invite still being sent', async () => {
    const { person, signIn: signInAs } = newPerson()
    await db.insert(invites).values({
      id: `sending-${randomUUID().slice(0, 8)}`,
      workspaceId: workspace.id,
      email: person.user.email,
      role: 'editor',
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    })
    const signedIn = await signInAs()
    expect(await membershipsOf(person)).toEqual([{ workspaceId: signedIn.open, role: 'owner' }])
  })

  it('makes no membership from an invite another WorkOS user accepted', async () => {
    const { person, signIn: signInAs } = newPerson()
    const { invitationId } = await invite(person.user.email, 'admin')
    workos.accept(invitationId, `user_someone_else_${run}`)
    const signedIn = await signInAs()
    expect(signedIn.open).not.toBe(workspace.id)
    expect(await membershipsOf(person)).toEqual([{ workspaceId: signedIn.open, role: 'owner' }])
  })

  it('makes no membership again from an invite already accepted', async () => {
    const { person, signIn: signInAs } = newPerson()
    const { invitationId } = await invite(person.user.email, 'editor')
    workos.accept(invitationId, person.user.id)
    expect((await signInAs()).open).toBe(workspace.id)
    await db
      .delete(memberships)
      .where(
        eq(memberships.userId, db.select({ id: users.id }).from(users).where(eq(users.workosUserId, person.user.id))),
      )
    const signedIn = await signInAs()
    expect(signedIn.open).not.toBe(workspace.id)
    expect(await membershipsOf(person)).toEqual([{ workspaceId: signedIn.open, role: 'owner' }])
  })
})

describe('bearer tokens', () => {
  it('takes only a bearer token from the authorization header', () => {
    expect(bearerToken(new Request('http://x', { headers: { authorization: 'Bearer abc.def' } }))).toBe('abc.def')
    expect(bearerToken(new Request('http://x', { headers: { authorization: 'Basic abc' } }))).toBeNull()
    expect(bearerToken(new Request('http://x'))).toBeNull()
  })
})

describe('who is asking', () => {
  const request = (token?: string) =>
    new Request('http://x', token ? { headers: { authorization: `Bearer ${token}` } } : {})

  it('reads a token before the development session, so a check in the browser can sign in as another member', async () => {
    const userId = `user_reviewer_${run}`
    const { token } = signSessionToken(secret, { userId, workosSessionId: null })
    const sessionOf = sessionOfRequest({ db, secret, dev: true })
    expect(await sessionOf(request(token))).toEqual({ userId })
    expect(await sessionOf(request())).toEqual({ userId: 'dev-user' })
    expect(await sessionOfRequest({ db, secret: null, dev: true })(request(token))).toMatchObject({
      userId: 'dev-user',
    })
    expect(await sessionOfRequest({ db, secret, dev: false })(request())).toBeNull()
  })
})

describe('WorkOS settings', () => {
  it('are all given or none, and never default', () => {
    expect(workosSettings({})).toBeNull()
    expect(() => workosSettings({ WORKOS_API_KEY: 'k' })).toThrow(/together/)
    expect(
      workosSettings({
        WORKOS_API_KEY: 'k',
        WORKOS_CLIENT_ID: 'c',
        WORKOS_REDIRECT_URI: 'http://localhost:3000/callback',
      }),
    ).toEqual({ apiKey: 'k', clientId: 'c', redirectUri: 'http://localhost:3000/callback' })
  })

  it('reads the session id from a WorkOS access token', () => {
    const claims = Buffer.from(JSON.stringify({ sid: 'session_1', sub: 'user_1' })).toString('base64url')
    expect(accessTokenSessionId(`header.${claims}.signature`)).toBe('session_1')
    expect(accessTokenSessionId('not a token')).toBeNull()
  })
})

describe('the WorkOS provider', () => {
  it('sends a signed-out person back to the /login beside the callback', () => {
    const provider = workosProvider({
      apiKey: 'sk_test_k',
      clientId: 'client_c',
      redirectUri: 'http://localhost:3100/callback',
    })
    const url = new URL(provider.signOutUrl('session_1'))
    expect(url.searchParams.get('session_id')).toBe('session_1')
    expect(url.searchParams.get('return_to')).toBe('http://localhost:3100/login')
  })
})
