// Dazbee invites from invite to sign-in, against Postgres from Docker Compose, with the WorkOS stand-in: an
// admin invites, the person signs up through the invite with a workspace of their own, and an admin cancels
// an invite, removes a person who joined, and invites them again.
import { eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'

import { memberships, users, workspaces } from '@dazbee/db'
import { DazbeeInvites, SignInRefused } from '@dazbee/schema'

import { findAccessOfToken, issueTokens, makeAccess, refreshTokens } from '../agents/agent-accesses.ts'
import { addPerson, db, workos, workspace } from '../test-api.ts'
import { addAdmin, ask, inviteAs, newPerson, signIn } from './test-early-access.ts'

let admin: Awaited<ReturnType<typeof addAdmin>>

beforeAll(async () => {
  admin = await addAdmin()
})

/** The Dazbee invites as the admin page lists them. */
async function listed() {
  return DazbeeInvites.parse((await ask(admin.token, 'GET', '/admin/invites')).json)
}

/** The workspaces the WorkOS user is a member of, with their role. */
async function membershipsOf(workosUserId: string) {
  return db
    .select({ workspaceId: memberships.workspaceId, role: memberships.role, name: workspaces.name })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .innerJoin(workspaces, eq(workspaces.id, memberships.workspaceId))
    .where(eq(users.workosUserId, workosUserId))
}

/** Invites a new person and signs them up through the invite: who they are, and their session. */
async function joined() {
  const { person, code } = newPerson()
  const { invite, invitationId } = await inviteAs(admin.token, person.user.email)
  workos.accept(invitationId, person.user.id)
  const answer = await signIn(code)
  expect(answer.status).toBe(200)
  return { person, code, invite, session: answer.session }
}

describe('a Dazbee invite', () => {
  it('lets the invited person sign up through it, with a workspace of their own', async () => {
    const { person, invite, session } = await joined()
    expect(await membershipsOf(person.user.id)).toEqual([
      { workspaceId: session?.open, role: 'owner', name: person.user.name },
    ])
    expect(workos.made.invitations.find((sent) => sent.email === person.user.email)).toMatchObject({
      organizationId: null,
    })
    const list = await listed()
    expect(list.joined).toContainEqual(
      expect.objectContaining({ id: invite.id, email: person.user.email, name: person.user.name }),
    )
    expect(list.pending.map((each) => each.email)).not.toContain(person.user.email)
  })

  it('lets them in on a later sign-in too', async () => {
    const { code, session } = await joined()
    const again = await signIn(code)
    expect(again.status).toBe(200)
    expect(again.session?.open).toBe(session?.open)
  })

  it('tells a person with a pending invite they did not sign in through to open it, recording nothing', async () => {
    const { person, code } = newPerson()
    await inviteAs(admin.token, person.user.email)
    const answer = await signIn(code)
    expect(answer.status).toBe(403)
    expect(SignInRefused.parse(answer.json).reason).toBe('open-invite')
    expect(await db.select().from(users).where(eq(users.workosUserId, person.user.id))).toEqual([])
  })

  it('lets nobody in through a cancelled invite', async () => {
    const { person, code } = newPerson()
    const { invite, invitationId } = await inviteAs(admin.token, person.user.email)
    expect((await ask(admin.token, 'DELETE', `/admin/invites/${invite.id}`)).status).toBe(204)
    // Even were WorkOS to say they accepted it, it is cancelled here.
    workos.accept(invitationId, person.user.id)
    const answer = await signIn(code)
    expect(answer.status).toBe(403)
    expect(SignInRefused.parse(answer.json).reason).toBe('early-access')
    expect((await listed()).pending.map((each) => each.id)).not.toContain(invite.id)
  })

  it('resends a pending invite, and invites an email with one pending by resending it', async () => {
    const { person } = newPerson()
    const { invite } = await inviteAs(admin.token, person.user.email)
    const sent = workos.made.invitations.length
    const resent = await ask(admin.token, 'POST', `/admin/invites/${invite.id}/resend`)
    expect(resent.status).toBe(200)
    expect((await inviteAs(admin.token, person.user.email)).invite.id).toBe(invite.id)
    expect(workos.made.invitations).toHaveLength(sent)
  })

  it('sends nothing to an email that already has an account, and says so', async () => {
    const member = await addPerson([[workspace.id, 'editor']])
    const sent = workos.made.invitations.length
    const answer = await ask(admin.token, 'POST', '/admin/invites', { email: member.email.toUpperCase() })
    expect(answer).toEqual({ status: 400, json: { error: `${member.email} already has an account` } })
    expect(workos.made.invitations).toHaveLength(sent)
  })
})

describe('removing a person', () => {
  it('refuses their sign-in and answers their open session 401, keeping their workspace', async () => {
    const { person, code, invite, session } = await joined()
    const token = session?.token ?? ''
    expect((await ask(token, 'GET', '/me')).status).toBe(200)

    expect((await ask(admin.token, 'POST', `/admin/invites/${invite.id}/remove`)).status).toBe(204)
    const refused = await ask(token, 'GET', '/me')
    expect(refused.status).toBe(401)
    expect(SignInRefused.parse(refused.json).reason).toBe('early-access')
    expect((await ask(token, 'GET', `/workspaces/${session?.open}`)).status).toBe(401)

    const again = await signIn(code)
    expect(again.status).toBe(403)
    expect(SignInRefused.parse(again.json).reason).toBe('early-access')
    expect(workos.made.endedSessions).toContain(person.sessionId)
    expect(await membershipsOf(person.user.id)).toHaveLength(1)

    const list = await listed()
    expect(list.removed).toContainEqual(expect.objectContaining({ id: invite.id, email: person.user.email }))
    expect(list.joined.map((each) => each.email)).not.toContain(person.user.email)
    // Removing them twice finds no one to remove.
    expect((await ask(admin.token, 'POST', `/admin/invites/${invite.id}/remove`)).status).toBe(404)
  })

  it('lets them back in once they are invited again, to the workspace they had', async () => {
    const { person, code, invite, session } = await joined()
    await ask(admin.token, 'POST', `/admin/invites/${invite.id}/remove`)
    expect((await signIn(code)).status).toBe(403)

    const { invitationId } = await inviteAs(admin.token, person.user.email)
    workos.accept(invitationId, person.user.id)
    const back = await signIn(code)
    expect(back.status).toBe(200)
    expect(back.session?.open).toBe(session?.open)
    expect((await ask(session?.token ?? '', 'GET', '/me')).status).toBe(200)
    expect((await listed()).removed.map((each) => each.email)).not.toContain(person.user.email)
  })

  it('ends the agent accesses they gave, so being invited again brings none back', async () => {
    const { person, code, invite, session } = await joined()
    const [user] = await db.select({ id: users.id }).from(users).where(eq(users.workosUserId, person.user.id))
    const access = { userId: user?.id ?? '', workspaceId: session?.open ?? '', brandIds: null, writes: true }
    const accessId = await makeAccess(db, { ...access, clientId: null, clientName: 'Claude Code' })
    const tokens = await issueTokens(db, accessId)
    await ask(admin.token, 'POST', `/admin/invites/${invite.id}/remove`)
    expect(await refreshTokens(db, tokens.refreshToken)).toEqual({ ok: false, error: 'invalid_grant' })

    const { invitationId } = await inviteAs(admin.token, person.user.email)
    workos.accept(invitationId, person.user.id)
    expect((await signIn(code)).status).toBe(200)
    expect(await findAccessOfToken(db, tokens.accessToken)).toBeNull()
    expect(await refreshTokens(db, tokens.refreshToken)).toEqual({ ok: false, error: 'invalid_grant' })
  })

  it('keeps them out when the new invite is cancelled before they open it', async () => {
    const { person, code, invite } = await joined()
    await ask(admin.token, 'POST', `/admin/invites/${invite.id}/remove`)
    const { invite: again } = await inviteAs(admin.token, person.user.email)
    const waiting = await signIn(code)
    expect(waiting.status).toBe(403)
    expect(SignInRefused.parse(waiting.json).reason).toBe('open-invite')

    expect((await ask(admin.token, 'DELETE', `/admin/invites/${again.id}`)).status).toBe(204)
    const refused = await signIn(code)
    expect(refused.status).toBe(403)
    expect(SignInRefused.parse(refused.json).reason).toBe('early-access')
    expect((await listed()).removed.map((each) => each.email)).toContain(person.user.email)
  })

  it('never refuses an admin', async () => {
    const other = await addAdmin()
    expect((await ask(other.token, 'GET', '/me')).status).toBe(200)
    expect((await ask(other.token, 'GET', '/admin/invites')).status).toBe(200)
  })
})
