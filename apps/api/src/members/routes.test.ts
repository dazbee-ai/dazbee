// A workspace's members and invites, against Postgres from Docker Compose
// (`docker compose up -d --wait postgres`), with the WorkOS stand-in sending the invites.
import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { invites } from '@dazbee/db'
import { ApiError, Invite, WorkspaceMember } from '@dazbee/schema'

import { call, db, organizationOf, other, personA, personBoth, run, workos, workspace } from '../test-api.ts'

const DAY_MS = 24 * 60 * 60 * 1000

let emails = 0
/** An email no test has invited yet. */
const fresh = () => `invitee-${(emails += 1)}-${run}@example.com`

/** Invites `email` to workspace A as `as`, expecting it sent. */
async function invite(email: string, role: string, as = 'a') {
  const sent = await call(as, 'POST', '/invites', { email, role })
  expect(sent.status).toBe(201)
  return Invite.parse(sent.json)
}

/** The states WorkOS holds the email's invitations in, sorted. */
async function workosStates(email: string) {
  const sent = workos.made.invitations.filter((i) => i.email === email)
  return (await Promise.all(sent.map(async (i) => (await workos.invites.read(i.id)).state))).sort()
}

/**
 * Revokes the invite, here and with WorkOS, as WorkOS is asked to resend it; WorkOS then refuses, or
 * resends it anyway when `refuses` is false.
 */
function revokeDuringResend(inviteId: string, invitationId: string, refuses: boolean) {
  const resend = workos.invites.resend.bind(workos.invites)
  vi.spyOn(workos.invites, 'resend').mockImplementationOnce(async (id) => {
    const resent = refuses ? null : await resend(id)
    await db.update(invites).set({ revokedAt: new Date() }).where(eq(invites.id, inviteId))
    await workos.invites.revoke(invitationId)
    return resent ?? resend(id)
  })
}

const pendingInvites = async (as = 'a') => Invite.array().parse((await call(as, 'GET', '/invites')).json)

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('the members', () => {
  it('lists every member of the workspace with their name, email, role and brands, Owner first, for any member', async () => {
    const members = WorkspaceMember.array().parse((await call('r', 'GET', '/members')).json)
    expect(members.map((m) => m.role)).toEqual(['owner', 'admin', 'editor', 'editor', 'reviewer'])
    expect(members[0]).toEqual({
      id: personA.id,
      name: 'Ann Archer',
      email: personA.email,
      role: 'owner',
      brandIds: null,
    })
    expect(members).toContainEqual({
      id: personBoth.id,
      name: 'Bea Both',
      email: personBoth.email,
      role: 'editor',
      brandIds: null,
    })
    const theirs = WorkspaceMember.array().parse((await call('b', 'GET', '/members')).json)
    expect(theirs.map((m) => m.role)).toEqual(['owner', 'editor'])
  })
})

describe('inviting', () => {
  it('sends an invite through the workspace’s WorkOS organization, naming who invited, lower-casing the email', async () => {
    const email = fresh()
    const sent = await invite(`  ${email.toUpperCase()} `, 'editor')
    expect(sent).toMatchObject({ email, role: 'editor' })
    expect(sent.link).toMatch(/^https:\/\/auth\.example\.test\/invite\?invitation_token=/)
    expect(Date.parse(sent.expiresAt) - Date.now()).toBeGreaterThan(7 * DAY_MS - 60_000)
    expect(workos.made.invitations.at(-1)).toMatchObject({
      email,
      organizationId: organizationOf(workspace.id),
      inviterUserId: personA.workosUserId,
    })
    expect(await pendingInvites()).toContainEqual(sent)
    // Another workspace never sees it.
    expect((await pendingInvites('b')).map((i) => i.email)).not.toContain(email)
  })

  it('lets an Admin invite and read the pending invites too', async () => {
    const sent = await invite(fresh(), 'reviewer', 'admin')
    expect(await pendingInvites('admin')).toContainEqual(sent)
  })

  it('refuses Editors and Reviewers all four invite routes', async () => {
    const sent = await invite(fresh(), 'editor')
    for (const as of ['editor', 'r']) {
      const answers = [
        await call(as, 'GET', '/invites'),
        await call(as, 'POST', '/invites', { email: fresh(), role: 'reviewer' }),
        await call(as, 'POST', `/invites/${sent.id}/resend`),
        await call(as, 'DELETE', `/invites/${sent.id}`),
      ]
      expect(answers.map((a) => [a.status, ApiError.parse(a.json).error])).toEqual(
        Array(4).fill([403, 'Only an Owner or Admin can do this']),
      )
    }
    expect(await pendingInvites()).toContainEqual(sent)
  })

  it('refuses the role Owner, and an email that is already a member', async () => {
    const owner = await call('a', 'POST', '/invites', { email: fresh(), role: 'owner' })
    expect(owner.status).toBe(400)
    expect(ApiError.parse(owner.json).error).toMatch(/Admin, Editor or Reviewer/)
    expect(await call('a', 'POST', '/invites', { email: personBoth.email.toUpperCase(), role: 'admin' })).toEqual({
      status: 400,
      json: { error: `${personBoth.email} is already a member` },
    })
    expect((await call('a', 'POST', '/invites', { email: 'not an email', role: 'editor' })).status).toBe(400)
  })

  it('resends a pending invite with the new role instead of sending a second', async () => {
    const email = fresh()
    const sentAt = Date.now()
    vi.useFakeTimers({ toFake: ['Date'], now: sentAt - DAY_MS })
    const first = await invite(email, 'editor')
    vi.useRealTimers()
    const again = await invite(email, 'admin')
    expect(again).toMatchObject({ id: first.id, email, role: 'admin', link: first.link })
    expect(Date.parse(again.expiresAt)).toBeGreaterThan(Date.parse(first.expiresAt))
    expect((await pendingInvites()).filter((i) => i.email === email)).toEqual([again])
    expect(workos.made.invitations.filter((i) => i.email === email)).toHaveLength(1)
  })

  it('leaves one pending invite when the same email is invited twice at once', async () => {
    const email = fresh()
    // WorkOS holds the invite it is asked to send until the other request is answered, or until it is asked
    // twice, so the other request always finds the first being sent.
    const send = workos.invites.invite.bind(workos.invites)
    let release = () => {}
    const answered = new Promise<void>((resolve) => (release = resolve))
    let asked = 0
    vi.spyOn(workos.invites, 'invite').mockImplementation(async (...args) => {
      if ((asked += 1) === 2) release()
      await answered
      return send(...args)
    })
    const requests = [
      call('a', 'POST', '/invites', { email, role: 'editor' }),
      call('admin', 'POST', '/invites', { email, role: 'reviewer' }),
    ]
    void Promise.race(requests).then(release, release)
    const both = await Promise.all(requests)
    expect(both.map((answer) => answer.status).sort()).toEqual([201, 409])
    const sentOne = both.find((answer) => answer.status === 201)
    const refused = both.find((answer) => answer.status === 409)
    expect(refused?.json).toEqual({ error: `An invite to ${email} is being sent; try again in a moment` })
    const kept = Invite.parse(sentOne?.json)
    expect((await pendingInvites()).filter((i) => i.email === email)).toEqual([kept])
    expect(kept.role).toBe(both[0] === sentOne ? 'editor' : 'reviewer')
    expect(await workosStates(email)).toEqual(['pending'])
  })

  it('lists no invite being sent, answers 409 to inviting its email, and replaces one left being sent too long', async () => {
    const email = fresh()
    const sending = { id: `sending-${emails}-${run}`, workspaceId: workspace.id, email, role: 'editor' as const }
    await db.insert(invites).values({ ...sending, expiresAt: new Date(Date.now() + 7 * DAY_MS) })
    expect((await pendingInvites()).map((i) => i.email)).not.toContain(email)
    expect(await call('a', 'POST', '/invites', { email, role: 'admin' })).toEqual({
      status: 409,
      json: { error: `An invite to ${email} is being sent; try again in a moment` },
    })
    await db
      .update(invites)
      .set({ createdAt: new Date(Date.now() - 2 * 60_000) })
      .where(eq(invites.id, sending.id))
    const sent = await invite(email, 'admin')
    expect(await pendingInvites()).toContainEqual(sent)
    expect(await db.select().from(invites).where(eq(invites.id, sending.id))).toEqual([])
  })

  it('leaves no invite behind when WorkOS can’t send it, so inviting again works', async () => {
    const email = fresh()
    vi.spyOn(workos.invites, 'invite').mockRejectedValueOnce(new Error('WorkOS is down'))
    vi.spyOn(console, 'log').mockImplementation(() => {})
    expect((await call('a', 'POST', '/invites', { email, role: 'editor' })).status).toBe(500)
    expect(await db.select().from(invites).where(eq(invites.email, email))).toEqual([])
    expect((await invite(email, 'editor')).email).toBe(email)
  })

  it('revokes the WorkOS invitation it sent when the invite can’t be written', async () => {
    const email = fresh()
    // Filling in the sent invite is the one write outside a transaction.
    vi.spyOn(db, 'update').mockImplementationOnce(() => {
      throw new Error('connection lost')
    })
    vi.spyOn(console, 'log').mockImplementation(() => {})
    expect((await call('a', 'POST', '/invites', { email, role: 'editor' })).status).toBe(500)
    expect(await workosStates(email)).toEqual(['revoked'])
    expect(await db.select().from(invites).where(eq(invites.email, email))).toEqual([])
  })

  it('revokes an expired invite that WorkOS says was accepted, and sends a new one', async () => {
    const email = fresh()
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() - 8 * DAY_MS })
    const old = await invite(email, 'editor')
    const accepted = workos.made.invitations.at(-1)?.id ?? ''
    workos.accept(accepted, `user_late_${run}`)
    vi.useRealTimers()
    const renewed = await invite(email, 'editor')
    expect(renewed.id).not.toBe(old.id)
    const [stored] = await db.select({ revokedAt: invites.revokedAt }).from(invites).where(eq(invites.id, old.id))
    expect(stored?.revokedAt).toBeInstanceOf(Date)
  })

  it('revokes an expired invite and sends a new one', async () => {
    const email = fresh()
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() - 8 * DAY_MS })
    const old = await invite(email, 'editor')
    vi.useRealTimers()
    expect((await pendingInvites()).map((i) => i.email)).not.toContain(email)

    const renewed = await invite(email, 'reviewer')
    expect(renewed.id).not.toBe(old.id)
    expect((await pendingInvites()).filter((i) => i.email === email)).toEqual([renewed])
    const [stored] = await db.select({ revokedAt: invites.revokedAt }).from(invites).where(eq(invites.id, old.id))
    expect(stored?.revokedAt).toBeInstanceOf(Date)
  })
})

describe('resending and revoking', () => {
  it('resends a pending invite, moving its expiry', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() - DAY_MS })
    const sent = await invite(fresh(), 'editor')
    vi.useRealTimers()
    const resent = await call('admin', 'POST', `/invites/${sent.id}/resend`)
    expect(resent.status).toBe(200)
    const moved = Invite.parse(resent.json)
    expect(moved).toMatchObject({ id: sent.id, role: 'editor' })
    expect(Date.parse(moved.expiresAt)).toBeGreaterThan(Date.parse(sent.expiresAt))
  })

  it('revokes a pending invite, which then leaves the list and can be neither resent nor revoked', async () => {
    const sent = await invite(fresh(), 'editor')
    expect(await call('a', 'DELETE', `/invites/${sent.id}`)).toEqual({ status: 204, json: null })
    expect((await pendingInvites()).map((i) => i.id)).not.toContain(sent.id)
    const gone = { status: 404, json: { error: 'No such invite' } }
    expect(await call('a', 'DELETE', `/invites/${sent.id}`)).toEqual(gone)
    expect(await call('a', 'POST', `/invites/${sent.id}/resend`)).toEqual(gone)
  })

  it('refuses to revoke an invite the person already accepted with WorkOS, leaving it for their sign-in', async () => {
    const sent = await invite(fresh(), 'editor')
    workos.accept(workos.made.invitations.at(-1)?.id ?? '', `user_accepted_${run}`)
    expect(await call('a', 'DELETE', `/invites/${sent.id}`)).toEqual({
      status: 409,
      json: { error: 'This invite was already accepted' },
    })
    expect(await pendingInvites()).toContainEqual(sent)
  })

  it('answers 409 to inviting an email whose invite is revoked while it is resent', async () => {
    for (const refuses of [true, false]) {
      const email = fresh()
      const sent = await invite(email, 'editor')
      const invitationId = workos.made.invitations.at(-1)?.id ?? ''
      revokeDuringResend(sent.id, invitationId, refuses)
      expect(await call('a', 'POST', '/invites', { email, role: 'admin' })).toEqual({
        status: 409,
        json: { error: 'This invite changed; try again' },
      })
      vi.restoreAllMocks()
    }
  })

  it('finds no invite to resend once it is revoked while it is resent', async () => {
    for (const refuses of [true, false]) {
      const sent = await invite(fresh(), 'editor')
      revokeDuringResend(sent.id, workos.made.invitations.at(-1)?.id ?? '', refuses)
      expect(await call('a', 'POST', `/invites/${sent.id}/resend`)).toEqual({
        status: 404,
        json: { error: 'No such invite' },
      })
      vi.restoreAllMocks()
    }
  })

  it('finds no invite of another workspace', async () => {
    const sent = await invite(fresh(), 'editor')
    const there = { as: 'b', workspace: other.id }
    expect((await call(there, 'DELETE', `/invites/${sent.id}`)).status).toBe(404)
    expect((await call(there, 'POST', `/invites/${sent.id}/resend`)).status).toBe(404)
    expect(await pendingInvites()).toContainEqual(sent)
  })
})
