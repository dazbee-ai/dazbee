// Deleting a person's account, against Postgres and storage from Docker Compose
// (`docker compose up -d --wait postgres storage`), with the WorkOS stand-in.
import { eq, inArray } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  accessRequests,
  aiCalls,
  aiGrants,
  aiJobs,
  aiLedger,
  assets,
  brands,
  dazbeeInvites,
  designs,
  designSaves,
  invites,
  memberships,
  pendingDeletions,
  users,
  workspaces,
} from '@dazbee/db'
import { AccountDeletion, BrandSummary, DesignSummary, Invite, SignedIn } from '@dazbee/schema'
import { signSessionToken } from '@dazbee/session-token'

import { createApp } from '../app.ts'
import { tokenSession } from '../sign-in/session.ts'
import {
  addPerson,
  addWorkspace,
  app,
  authorization,
  call,
  db,
  organizationOf,
  request,
  run,
  sessionSecret,
  storage,
  syncSecret,
  uploadImage,
  workos,
} from '../test-api.ts'
import { png } from '../test-files.ts'
import { finishDeletions, FOLDER_SETTLE_MS } from './pending-deletions.ts'

/**
 * How long a wait for the deletions that run after the answer may take: on a CI runner busy with every
 * package's tests at once, they take several times as long as on a dev machine.
 */
const DELETIONS_WAIT = { timeout: 20_000, interval: 50 }

/** A WorkOS failure that isn't a missing record. */
const outage = () => Object.assign(new Error('WorkOS is down'), { status: 500 })

/**
 * A person who owns a workspace alone, with a brand, a design and an uploaded image in it, and is an Editor in
 * a team's workspace, where they made a design too. The team's Owner also invites someone else there.
 */
async function soloAccount() {
  const own = await addWorkspace('Own studio')
  const team = await addWorkspace('Team')
  const owner = await addPerson([[team.id, 'owner']])
  const person = await addPerson([
    [own.id, 'owner'],
    [team.id, 'editor'],
  ])
  const teamBrand = BrandSummary.parse(
    (await call({ as: owner.as, workspace: team.id }, 'POST', '/brands', { name: 'Team brand' })).json,
  )
  const ownBrand = BrandSummary.parse((await call(person.as, 'POST', '/brands', { name: 'Own brand' })).json)
  const ownDesign = DesignSummary.parse(
    (await call(person.as, 'POST', `/brands/${ownBrand.id}/designs`, { name: 'Own design' })).json,
  )
  const teamDesign = DesignSummary.parse(
    (
      await call({ as: person.as, workspace: team.id }, 'POST', `/brands/${teamBrand.id}/designs`, {
        name: 'Made for the team',
      })
    ).json,
  )
  await uploadImage(person.as, ownBrand.id, png(4, 4, `own-${run}-${person.id}`))
  const otherInvite = Invite.parse(
    (
      await call({ as: owner.as, workspace: team.id }, 'POST', '/invites', {
        email: `kept-${person.id}@example.com`,
        role: 'reviewer',
      })
    ).json,
  )
  return { own, team, owner, person, ownBrand, ownDesign, teamBrand, teamDesign, otherInvite }
}

/** Deletes the account of `as`, confirmed with `email` and the workspaces it deletes, `deletes`. */
const deleteAs = (as: string, email: string, deletes: string[]) => request(as, 'DELETE', '/me', { email, deletes })

const pendingFor = (targets: string[]) =>
  db.select().from(pendingDeletions).where(inArray(pendingDeletions.target, targets))

/** Waits until nothing is left to delete outside the database of what the targets name. */
const finished = (targets: string[]) =>
  vi.waitFor(async () => {
    const left = await pendingFor(targets)
    if (left.some((row) => row.kind !== 'storage-folder')) throw new Error('still deleting')
    for (const row of left) if ((await storage.list(row.target)).length > 0) throw new Error('still deleting files')
  }, DELETIONS_WAIT)

/** The next start, once storage folders have settled, for what the targets name. */
const nextStart = async (targets: string[]) =>
  finishDeletions(
    db,
    { storage, signIn: workos.provider, invites: workos.invites },
    (await pendingFor(targets)).map((row) => row.id),
    Date.now() + FOLDER_SETTLE_MS,
  )

afterEach(() => {
  workos.failing.deleteOrganization = null
  workos.failing.deleteUser = null
  workos.failing.revoke = null
  vi.restoreAllMocks()
})

describe('GET /me/deletion', () => {
  it('names the workspaces deleting deletes and those to hand over first', async () => {
    const alone = await addWorkspace('Alone')
    const shared = await addWorkspace('Shared')
    const person = await addPerson([
      [alone.id, 'owner'],
      [shared.id, 'owner'],
    ])
    await addPerson([[shared.id, 'reviewer']])
    expect(AccountDeletion.parse((await request(person.as, 'GET', '/me/deletion')).json)).toEqual({
      deletes: [alone],
      handOver: [shared],
    })
  })
})

describe('DELETE /me', () => {
  it('deletes the person and the workspace they own alone with everything in it, and keeps the team’s', async () => {
    const { own, team, owner, person, ownDesign, teamBrand, teamDesign, otherInvite } = await soloAccount()
    const invitedElsewhere = await addWorkspace('Invited them')
    const inviter = await addPerson([[invitedElsewhere.id, 'owner']])
    const invitation = Invite.parse(
      (
        await call({ as: inviter.as, workspace: invitedElsewhere.id }, 'POST', '/invites', {
          email: person.email,
          role: 'editor',
        })
      ).json,
    )
    const [providerInvite] = await db
      .select({ id: invites.providerInviteId })
      .from(invites)
      .where(eq(invites.id, invitation.id))
    await db.insert(dazbeeInvites).values([
      { id: `dazbee-${person.id}`, email: person.email, expiresAt: new Date(Date.now() + 86_400_000) },
      { id: `dazbee-kept-${person.id}`, email: `kept-${person.id}@example.com`, expiresAt: new Date() },
    ])
    await db.insert(accessRequests).values([
      { id: `request-${person.id}`, email: person.email, name: 'Them', company: 'Own studio' },
      { id: `request-kept-${person.id}`, email: `kept-${person.id}@example.com`, name: 'Kept', company: 'Team' },
    ])
    expect(await storage.list(`workspaces/${own.id}/`)).not.toEqual([])

    expect(await deleteAs(person.as, ` ${person.email.toUpperCase()} `, [own.id])).toEqual({ status: 204, json: null })
    await finished([`workspaces/${own.id}/`, organizationOf(own.id), person.workosUserId, providerInvite?.id ?? ''])

    expect(await db.select().from(users).where(eq(users.id, person.id))).toEqual([])
    expect(await db.select().from(workspaces).where(eq(workspaces.id, own.id))).toEqual([])
    expect(await db.select().from(brands).where(eq(brands.workspaceId, own.id))).toEqual([])
    expect(await db.select().from(designs).where(eq(designs.workspaceId, own.id))).toEqual([])
    expect(await db.select().from(designSaves).where(eq(designSaves.designId, ownDesign.id))).toEqual([])
    expect(await db.select().from(assets).where(eq(assets.workspaceId, own.id))).toEqual([])
    expect(await storage.list(`workspaces/${own.id}/`)).toEqual([])
    expect(await db.select().from(memberships).where(eq(memberships.userId, person.id))).toEqual([])
    expect(await db.select().from(invites).where(eq(invites.email, person.email))).toEqual([])
    expect(await db.select().from(dazbeeInvites).where(eq(dazbeeInvites.email, person.email))).toEqual([])
    expect(await db.select().from(accessRequests).where(eq(accessRequests.email, person.email))).toEqual([])
    expect(workos.made.deletedOrganizations).toContain(organizationOf(own.id))
    expect(workos.made.deletedUsers).toContain(person.workosUserId)
    expect((await workos.invites.read(providerInvite?.id ?? '')).state).toBe('revoked')
    // The folder is deleted once more when it has settled, as the next start does too.
    expect(await nextStart([`workspaces/${own.id}/`])).toBe(0)
    expect(await pendingFor([`workspaces/${own.id}/`, person.workosUserId])).toEqual([])

    // The team keeps its workspace, its brand, the design the person made there, its Owner and its invites.
    expect(await db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.id, team.id))).toEqual([
      { id: team.id },
    ])
    expect((await call({ as: owner.as, workspace: team.id }, 'GET', `/brands/${teamBrand.id}/designs`)).json).toEqual([
      expect.objectContaining({ id: teamDesign.id, name: 'Made for the team' }),
    ])
    expect(
      (await db.select({ userId: memberships.userId }).from(memberships).where(eq(memberships.workspaceId, team.id)))
        .map((row) => row.userId)
        .sort(),
    ).toEqual([owner.id])
    expect(await db.select({ id: invites.id }).from(invites).where(eq(invites.id, otherInvite.id))).toEqual([
      { id: otherInvite.id },
    ])
    expect(
      await db
        .select({ id: dazbeeInvites.id })
        .from(dazbeeInvites)
        .where(eq(dazbeeInvites.id, `dazbee-kept-${person.id}`)),
    ).toHaveLength(1)
    expect(
      await db
        .select({ id: accessRequests.id })
        .from(accessRequests)
        .where(eq(accessRequests.id, `request-kept-${person.id}`)),
    ).toHaveLength(1)
    expect(workos.made.deletedOrganizations).not.toContain(organizationOf(team.id))
  })

  it('ends the person’s session: every later request gets 401, and their WorkOS session ends', async () => {
    const { own, person, ownBrand } = await soloAccount()
    const { token } = signSessionToken(sessionSecret, { userId: person.id, workosSessionId: `session-${person.id}` })
    const deleted = await app.request('/me', {
      method: 'DELETE',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ email: person.email, deletes: [own.id] }),
    })
    expect(deleted.status).toBe(204)
    expect(workos.made.endedSessions).toContain(`session-${person.id}`)
    expect(await request(person.as, 'GET', '/me')).toEqual({ status: 401, json: { error: 'Sign in first' } })
    expect((await request(person.as, 'GET', '/me/deletion')).status).toBe(401)
    expect((await call({ as: person.as, workspace: own.id }, 'GET', `/brands/${ownBrand.id}/designs`)).status).toBe(401)
    expect((await deleteAs(person.as, person.email, [own.id])).status).toBe(401)
  })

  it('refuses an Owner of a workspace with other members until they hand over Owner', async () => {
    const { own, team, person } = await soloAccount()
    const admin = await addPerson([[own.id, 'admin']])
    const refused = await deleteAs(person.as, person.email, [own.id])
    expect(refused).toEqual({
      status: 409,
      json: { error: 'Hand over Owner first', handOver: [{ id: own.id, name: 'Own studio' }] },
    })
    expect(await db.select({ id: users.id }).from(users).where(eq(users.id, person.id))).toHaveLength(1)
    expect(await db.select({ id: brands.id }).from(brands).where(eq(brands.workspaceId, own.id))).toHaveLength(1)

    expect((await call(person.as, 'POST', `/members/${admin.id}/owner`)).status).toBe(204)
    expect((await deleteAs(person.as, person.email, [])).status).toBe(204)

    // Handed over, the workspace is the new Owner's, with everything in it.
    expect(
      await db
        .select({ userId: memberships.userId, role: memberships.role })
        .from(memberships)
        .where(eq(memberships.workspaceId, own.id)),
    ).toEqual([{ userId: admin.id, role: 'owner' }])
    expect(await db.select({ id: brands.id }).from(brands).where(eq(brands.workspaceId, own.id))).toHaveLength(1)
    expect(await storage.list(`workspaces/${own.id}/`)).not.toEqual([])
    expect(workos.made.deletedOrganizations).not.toContain(organizationOf(own.id))
    expect(await db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.id, team.id))).toHaveLength(1)
  })

  it('refuses another email, deleting nothing', async () => {
    const { own, person } = await soloAccount()
    for (const email of ['', 'someone@example.com'])
      expect(await deleteAs(person.as, email, [own.id])).toEqual({
        status: 400,
        json: { error: 'Type your account’s email to delete it', handOver: [] },
      })
    expect((await request(person.as, 'DELETE', '/me', { email: person.email })).status).toBe(400)
    expect(await db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.id, own.id))).toHaveLength(1)
    expect((await request(person.as, 'GET', '/me')).status).toBe(200)
  })

  it('refuses when the workspaces it deletes are no longer those the person was shown, deleting nothing', async () => {
    const { own, person } = await soloAccount()
    const extra = await addWorkspace('Handed to them')
    await db.insert(memberships).values({ workspaceId: extra.id, userId: person.id, role: 'owner' })
    expect(await deleteAs(person.as, person.email, [own.id])).toEqual({
      status: 409,
      json: { error: 'The workspaces deleting deletes have changed; look again', handOver: [] },
    })
    expect(await deleteAs(person.as, person.email, [own.id, extra.id, 'another'])).toMatchObject({ status: 409 })
    expect(
      await db
        .select({ id: workspaces.id })
        .from(workspaces)
        .where(inArray(workspaces.id, [own.id, extra.id])),
    ).toHaveLength(2)
    expect((await request(person.as, 'GET', '/me')).status).toBe(200)
  })

  it('keeps what storage and WorkOS failed to delete, and deletes it on the next start', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const { own, person } = await soloAccount()
    const failingStorage = { ...storage, deleteFolder: () => Promise.reject(new Error('storage is down')) }
    const failing = createApp({
      db,
      storage: failingStorage,
      sessionOf: tokenSession(sessionSecret),
      syncSecret,
      build: 'test-build',
      signIn: { provider: workos.provider, secret: sessionSecret },
      invites: { workos: workos.invites, dev: null },
    })
    workos.failing.deleteOrganization = outage()
    workos.failing.deleteUser = outage()
    const response = await failing.request('/me', {
      method: 'DELETE',
      headers: { ...authorization(person.as), 'content-type': 'application/json' },
      body: JSON.stringify({ email: person.email, deletes: [own.id] }),
    })
    expect(response.status).toBe(204)
    expect(await db.select().from(users).where(eq(users.id, person.id))).toEqual([])
    const targets = [`workspaces/${own.id}/`, organizationOf(own.id), person.workosUserId]
    // The deletions after the answer have run and failed.
    await vi.waitFor(() => expect(console.log).toHaveBeenCalledTimes(3), DELETIONS_WAIT)
    expect((await pendingFor(targets)).map((row) => row.kind).sort()).toEqual([
      'storage-folder',
      'workos-organization',
      'workos-user',
    ])
    expect(await storage.list(`workspaces/${own.id}/`)).not.toEqual([])

    // The next start, with storage and WorkOS answering again.
    workos.failing.deleteOrganization = null
    workos.failing.deleteUser = null
    expect(await nextStart(targets)).toBe(0)
    expect(await pendingFor(targets)).toEqual([])
    expect(await storage.list(`workspaces/${own.id}/`)).toEqual([])
    expect(workos.made.deletedOrganizations).toContain(organizationOf(own.id))
    expect(workos.made.deletedUsers).toContain(person.workosUserId)
  })

  it('keeps the call log, the allowance ledger, the grants and the AI jobs of the workspace it deletes', async () => {
    const { own, person } = await soloAccount()
    const ai = { grant: `grant-${person.id}`, job: `job-${person.id}`, call: `call-${person.id}` }
    await db.insert(aiGrants).values({
      id: ai.grant,
      workspaceId: own.id,
      source: 'gift',
      amount: 10_000_000n,
      usageRate: 1_000_000n,
      expiresAt: new Date(Date.now() + 86_400_000),
      givenBy: person.id,
    })
    await db
      .insert(aiJobs)
      .values({ id: ai.job, workspaceId: own.id, memberId: person.id, kind: 'calls', state: 'done', input: {} })
    await db.insert(aiCalls).values({
      id: ai.call,
      jobId: ai.job,
      workspaceId: own.id,
      callIndex: 0,
      try: 1,
      attempt: 1,
      feature: 'calls',
      function: 'test-function',
      preset: 'test',
      kind: 'text',
      model: 'gpt-6-luna',
      seller: 'openai',
      state: 'done',
    })
    await db.insert(aiLedger).values({ grantId: ai.grant, jobId: ai.job, callId: ai.call, kind: 'charge', amount: -1n })
    expect((await deleteAs(person.as, person.email, [own.id])).status).toBe(204)
    await finished([`workspaces/${own.id}/`, organizationOf(own.id), person.workosUserId])
    expect(await db.select({ id: aiGrants.id }).from(aiGrants).where(eq(aiGrants.workspaceId, own.id))).toEqual([
      { id: ai.grant },
    ])
    expect(await db.select({ id: aiJobs.id }).from(aiJobs).where(eq(aiJobs.workspaceId, own.id))).toEqual([
      { id: ai.job },
    ])
    expect(await db.select({ id: aiCalls.id }).from(aiCalls).where(eq(aiCalls.workspaceId, own.id))).toEqual([
      { id: ai.call },
    ])
    expect(await db.select({ call: aiLedger.callId }).from(aiLedger).where(eq(aiLedger.jobId, ai.job))).toEqual([
      { call: ai.call },
    ])
  })

  it('lets the person sign up again with the same email into a new, empty workspace', async () => {
    const { own, person } = await soloAccount()
    expect((await deleteAs(person.as, person.email, [own.id])).status).toBe(204)
    const code = `code-again-${person.id}`
    workos.people[code] = {
      user: { id: `workos-again-${person.id}`, email: person.email, name: 'Again', emailVerified: true },
      sessionId: null,
    }
    const signedIn = await app.request('/auth/callback', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code }),
    })
    expect(signedIn.status).toBe(200)
    const { token, open } = SignedIn.parse(await signedIn.json())
    expect(open).not.toBe(own.id)
    const brandsThere = await app.request(`/workspaces/${open}/brands`, {
      headers: { authorization: `Bearer ${token}` },
    })
    expect(await brandsThere.json()).toEqual([])
    const [again] = await db.select({ id: users.id }).from(users).where(eq(users.email, person.email))
    expect(again?.id).not.toBe(person.id)
  })
})

describe('finishDeletions', () => {
  it('keeps a WorkOS user who signed up again before their deletion was finished', async () => {
    const person = await addPerson([[(await addWorkspace()).id, 'owner']])
    const id = `pending-${person.id}`
    await db.insert(pendingDeletions).values({ id, kind: 'workos-user', target: person.workosUserId })
    expect(await finishDeletions(db, { storage, signIn: workos.provider, invites: workos.invites }, [id])).toBe(0)
    expect(workos.made.deletedUsers).not.toContain(person.workosUserId)
    expect(await db.select().from(pendingDeletions).where(eq(pendingDeletions.id, id))).toEqual([])
  })

  it('counts a WorkOS record already gone as deleted, and leaves a kind it has no deleter for', async () => {
    const gone = `pending-gone-${run}`
    const waiting = `pending-waiting-${run}`
    workos.failing.deleteOrganization = Object.assign(new Error('not found'), { status: 404 })
    await db.insert(pendingDeletions).values([
      { id: gone, kind: 'workos-organization', target: `org_gone_${run}` },
      { id: waiting, kind: 'workos-invitation', target: `invitation_waiting_${run}` },
    ])
    expect(await finishDeletions(db, { storage, signIn: workos.provider, invites: null }, [gone, waiting])).toBe(1)
    expect(
      (
        await db
          .select()
          .from(pendingDeletions)
          .where(inArray(pendingDeletions.id, [gone, waiting]))
      ).map((row) => row.id),
    ).toEqual([waiting])
    await db.delete(pendingDeletions).where(eq(pendingDeletions.id, waiting))
  })
})
