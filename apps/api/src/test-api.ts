// The API as its seam tests call it: the test database and storage, the WorkOS stand-in for sign-in and
// invites, two workspaces with a WorkOS organization, a brand and an Owner each, an Admin, an Editor and a
// Reviewer in the first, an Editor of both, `call` to ask the app as one of them in a workspace, `request` to
// ask it at any path (or `requestOf` an app made with more of `appSettings`), `addWorkspace` and `addPerson` to make a team a test changes alone, and the upload
// flow. A test file that imports it adds the workspaces before its tests and closes the database after them.
import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, expect } from 'vitest'

import { brands, membershipBrands, memberships, openDatabase, users, workspaces } from '@dazbee/db'
import { AssetSummary, type MemberRole, UploadTicket } from '@dazbee/schema'
import { signSessionToken } from '@dazbee/session-token'
import { openStorage, storageSettings } from '@dazbee/storage'

import { createApp } from './app.ts'
import { tokenSession } from './sign-in/session.ts'
import { fakeWorkos } from './sign-in/test-workos.ts'
import { DATABASE_URL } from './test-database.ts'
import { sha256 } from './test-files.ts'

const database = openDatabase(DATABASE_URL)
export const db = database.db

// Two workspaces with a brand each, fresh for every run so runs never see each other's rows.
export const run = randomUUID().slice(0, 8)
/** The shape of every id the API gives a new record. */
export const SHORT_ID = /^[0-9a-z]{12}$/
export const workspace = { id: `workspace-a-${run}`, name: 'Agency A' }
export const other = { id: `workspace-b-${run}`, name: 'Studio B' }
export const brand = { id: `brand-a-${run}`, workspaceId: workspace.id, name: 'Brand A' }
export const sibling = { id: `brand-a2-${run}`, workspaceId: workspace.id, name: 'Brand A2' }
export const otherBrand = { id: `brand-b-${run}`, workspaceId: other.id, name: 'Brand B' }

// Real sessions: an Owner in each workspace, an Admin, an Editor and a Reviewer in A, and an Editor who
// joined B and then A, each signed in with a session token.
export const personA = {
  id: `user-a-${run}`,
  workosUserId: `workos-a-${run}`,
  email: `a-${run}@example.com`,
  name: 'Ann Archer',
}
const personB = { id: `user-b-${run}`, workosUserId: `workos-b-${run}`, email: `b-${run}@example.com` }
/** A Reviewer in workspace A. */
const personR = { id: `user-r-${run}`, workosUserId: `workos-r-${run}`, email: `r-${run}@example.com` }
/** An Editor in workspace A. */
const personE = { id: `user-e-${run}`, workosUserId: `workos-e-${run}`, email: `e-${run}@example.com` }
/** An Admin in workspace A. */
const personM = { id: `user-m-${run}`, workosUserId: `workos-m-${run}`, email: `m-${run}@example.com` }
/** An Editor in both workspaces, who joined B first. */
export const personBoth = {
  id: `user-both-${run}`,
  workosUserId: `workos-both-${run}`,
  email: `both-${run}@example.com`,
  name: 'Bea Both',
}
/** The WorkOS organization of a test workspace. */
export const organizationOf = (workspaceId: string) => `org_${workspaceId}`
/** Each caller: their person, and their own workspace, the one `call` asks in unless told another. */
const callers: Record<string, { userId: string; workspaceId: string }> = {
  a: { userId: personA.id, workspaceId: workspace.id },
  b: { userId: personB.id, workspaceId: other.id },
  r: { userId: personR.id, workspaceId: workspace.id },
  editor: { userId: personE.id, workspaceId: workspace.id },
  admin: { userId: personM.id, workspaceId: workspace.id },
  both: { userId: personBoth.id, workspaceId: workspace.id },
}
/** The secret the app's session tokens are signed with. */
export const sessionSecret = 'test-session-secret-'.padEnd(32, 'x')
const tokens = Object.fromEntries(
  Object.entries(callers).map(([as, { userId }]) => [
    as,
    signSessionToken(sessionSecret, { userId, workosSessionId: null }).token,
  ]),
)
export const authorization = (as: string) => ({ authorization: `Bearer ${tokens[as]}` })
/** The path of the caller's own workspace, whose routes `call` asks. */
export const workspacePath = (as: string) => `/workspaces/${callers[as]?.workspaceId}`

export const syncSecret = 'test-secret-'.padEnd(32, 'x')
export const storage = openStorage(
  storageSettings({
    STORAGE_ENDPOINT: 'http://127.0.0.1:59000',
    STORAGE_BUCKET: 'dazbee-test',
    STORAGE_ACCESS_KEY_ID: 'dazbee',
    STORAGE_SECRET_ACCESS_KEY: 'dazbee-local-secret',
    STORAGE_REGION: 'us-east-1',
    ...process.env,
  }),
)
/** WorkOS for every test: a test file adds the people its codes sign in. */
export const workos = fakeWorkos()
/** The settings the tests' app is made with, for a test that makes one with more. */
export const appSettings = {
  db,
  storage,
  sessionOf: tokenSession(sessionSecret),
  syncSecret,
  build: 'test-build',
  signIn: { provider: workos.provider, secret: sessionSecret },
  invites: { workos: workos.invites, dev: null },
} satisfies Parameters<typeof createApp>[0]
export const app = createApp(appSettings)

/** How many people and workspaces `addPerson` and `addWorkspace` have made, which numbers the next. */
let made = 0

/**
 * Asks the app as `as` (null for no session) at `path` under a workspace: the caller's own, or the one
 * given as `{ as, workspace }`. The workspace itself is the path `''`.
 */
export async function call(
  as: string | null | { as: string; workspace: string },
  method: string,
  path: string,
  body?: unknown,
) {
  if (typeof as === 'object' && as !== null) return request(as.as, method, `/workspaces/${as.workspace}${path}`, body)
  return request(as, method, `${workspacePath(as ?? 'a')}${path}`, body)
}

/** Makes a workspace of its own, with a WorkOS organization and no members, for a test to add people to. */
export async function addWorkspace(name = 'Team') {
  const added = { id: `workspace-${(made += 1)}-${run}`, name }
  await db.insert(workspaces).values({ ...added, workosOrganizationId: organizationOf(added.id) })
  return added
}

/**
 * Makes a person who is a member of each workspace given, with the role given there, signed in as the
 * caller `as` that `call` and `request` take, asking in the first workspace unless told another. Each is
 * new, so a test may change or remove them without touching another test's people. A third entry limits
 * them there to those brands.
 */
export async function addPerson(roles: [workspaceId: string, role: MemberRole, brandIds?: string[]][]) {
  const n = (made += 1)
  const person = {
    id: `user-${n}-${run}`,
    workosUserId: `workos-${n}-${run}`,
    email: `person-${n}-${run}@example.com`,
    name: `Person ${n}`,
  }
  await db.insert(users).values(person)
  await db
    .insert(memberships)
    .values(
      roles.map(([workspaceId, role, limit]) => ({ workspaceId, userId: person.id, role, limited: Boolean(limit) })),
    )
  const limits = roles.flatMap(([workspaceId, , limit = []]) =>
    limit.map((brandId) => ({ workspaceId, userId: person.id, brandId })),
  )
  if (limits.length > 0) await db.insert(membershipBrands).values(limits)
  const as = `person-${n}`
  callers[as] = { userId: person.id, workspaceId: roles[0]?.[0] ?? workspace.id }
  tokens[as] = signSessionToken(sessionSecret, { userId: person.id, workosSessionId: null }).token
  return { ...person, as }
}

/** Asks the app as `as` (null for no session) at `path`. */
export async function request(as: string | null, method: string, path: string, body?: unknown) {
  return requestOf(app, as, method, path, body)
}

/** Asks `to`, an app made with `appSettings`, as `as` (null for no session) at `path`. */
export async function requestOf(
  to: ReturnType<typeof createApp>,
  as: string | null,
  method: string,
  path: string,
  body?: unknown,
) {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (as) Object.assign(headers, authorization(as))
  const response = await to.request(path, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  return { status: response.status, json: response.status === 204 ? null : ((await response.json()) as unknown) }
}

/** Starts an image upload as `as`, PUTs the bytes when asked to, and records the asset. */
export async function uploadImage(
  as: string,
  brandId: string,
  bytes: Uint8Array,
  name?: string,
  contentType = 'image/png',
) {
  const ticket = UploadTicket.parse(
    (
      await call(as, 'POST', `/brands/${brandId}/assets/uploads`, {
        sha256: sha256(bytes),
        byteSize: bytes.length,
        contentType,
      })
    ).json,
  )
  if (ticket.asset) return { asset: ticket.asset, uploaded: false }
  const put = await fetch(ticket.upload.url, { method: 'PUT', body: bytes, headers: ticket.upload.headers })
  expect(put.status).toBe(200)
  const recorded = await call(as, 'POST', `/brands/${brandId}/assets`, {
    sha256: sha256(bytes),
    ...(name ? { name } : {}),
  })
  expect(recorded.status).toBe(201)
  return { asset: AssetSummary.parse(recorded.json), uploaded: true }
}

beforeAll(async () => {
  await storage.ensureBucket()
  await db.insert(workspaces).values([
    { ...workspace, workosOrganizationId: organizationOf(workspace.id) },
    { ...other, workosOrganizationId: organizationOf(other.id) },
  ])
  await db.insert(brands).values([brand, sibling, otherBrand])
  await db.insert(users).values([personA, personB, personR, personE, personM, personBoth])
  await db.insert(memberships).values([
    { workspaceId: workspace.id, userId: personA.id, role: 'owner' },
    { workspaceId: other.id, userId: personB.id, role: 'owner' },
    { workspaceId: workspace.id, userId: personR.id, role: 'reviewer' },
    { workspaceId: workspace.id, userId: personE.id, role: 'editor' },
    { workspaceId: workspace.id, userId: personM.id, role: 'admin' },
    { workspaceId: other.id, userId: personBoth.id, role: 'editor', createdAt: new Date('2026-01-01T00:00:00Z') },
    { workspaceId: workspace.id, userId: personBoth.id, role: 'editor', createdAt: new Date('2026-01-02T00:00:00Z') },
  ])
})
afterAll(async () => {
  await database.close()
})
