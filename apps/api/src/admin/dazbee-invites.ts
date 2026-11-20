// Dazbee invites: an admin's invites of an email to Dazbee during early access, each a provider's invitation
// to no organization, whose person signs up with a workspace of their own (`completeSignIn`). Inviting an
// email resends its pending invite, or replaces an expired one; an email that already has an account gets
// none, unless its access was removed. Removing a person who joined keeps their account and designs, and
// refuses their sign-in and their session's requests. Removal holds for the email: every accepted invite of
// it is marked, and accepting a new invite of it clears them all, so an invite cancelled or left to expire
// gives nothing back.
// As with a workspace's invites, the provider is never called inside a transaction: a short transaction
// checks and reserves, the provider is called, then the row is written.
import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, lte, sql } from 'drizzle-orm'

import { dazbeeInvites, type Db, newId, type Tx, users } from '@dazbee/db'
import type { DazbeeInvite, DazbeeInvites, InvitedPerson } from '@dazbee/schema'

import { endPeopleAccesses } from '../agents/agent-accesses.ts'
import { logError } from '../log.ts'
import { InvalidInvite, InviteConflict, type Revoked, revokeWithProvider } from '../members/invites.ts'
import { inviteExpiry, type InvitesProvider, type ProviderInvite } from '../members/invites-provider.ts'
import type { Admins } from './admins.ts'

/** A pending Dazbee invite as sign-in reads it from its provider. */
export interface WaitingDazbeeInvite {
  id: string
  providerInviteId: string
}

// Read only from sent invites, which have their provider's id and link.
const sentLink = sql<string>`${dazbeeInvites.link}`
const sentProviderId = sql<string>`${dazbeeInvites.providerInviteId}`

const summary = { id: dazbeeInvites.id, email: dazbeeInvites.email, expiresAt: dazbeeInvites.expiresAt, link: sentLink }

const providerRef = { id: dazbeeInvites.id, providerInviteId: sentProviderId }

/** Neither accepted nor revoked: being sent, pending, or expired when its `expires_at` has passed. */
const open = () => and(isNull(dazbeeInvites.acceptedAt), isNull(dazbeeInvites.revokedAt))

/** Sent: it has its provider's id, so it is no longer being sent. */
const sent = () => isNotNull(dazbeeInvites.providerInviteId)

/** Pending at `now`. */
const pending = (now: Date) => and(open(), sent(), gt(dazbeeInvites.expiresAt, now))

/** Accepted, and removed or not. */
const accepted = (removed: boolean) =>
  and(
    isNotNull(dazbeeInvites.acceptedAt),
    removed ? isNotNull(dazbeeInvites.removedAt) : isNull(dazbeeInvites.removedAt),
  )

/** How long a row may be being sent before another invite of its email takes its place. */
const SENDING_MS = 60_000

/**
 * Invites `email` to Dazbee as the admin `invitedBy`: refused for an email with an account whose access
 * wasn't removed, a resend of its pending invite, or a new invite, any expired one revoked first. A new
 * invite is reserved first, under a lock on the email, as a row being sent; the provider is called after
 * that transaction, and the row is filled in, or deleted when sending fails.
 */
export async function inviteToDazbee(
  db: Db,
  provider: InvitesProvider,
  invitedBy: string,
  email: string,
  now = new Date(),
): Promise<DazbeeInvite> {
  await refuseAccount(db, email)
  const ofEmail = eq(dazbeeInvites.email, email)
  const [expired, [waiting]] = await Promise.all([
    db
      .select(providerRef)
      .from(dazbeeInvites)
      .where(and(ofEmail, open(), sent(), lte(dazbeeInvites.expiresAt, now))),
    db
      .select(providerRef)
      .from(dazbeeInvites)
      .where(and(ofEmail, pending(now))),
  ])
  // Revoked whatever the provider says, an accepted one included: our `expires_at` decides.
  for (const old of expired) await revokeWithProvider(provider, old.providerInviteId)
  const expiredIds = expired.map((old) => old.id)

  if (waiting) {
    const resent = await resendPending(db, provider, waiting, now, expiredIds)
    if (!resent) throw new InviteConflict('This invite changed; try again')
    return resent
  }

  const id = newId()
  await db.transaction(async (tx) => {
    await lockEmail(tx, email)
    await refuseAccount(tx, email)
    await markRevoked(tx, expiredIds, now)
    const [other] = await tx
      .select({
        id: dazbeeInvites.id,
        providerInviteId: dazbeeInvites.providerInviteId,
        createdAt: dazbeeInvites.createdAt,
      })
      .from(dazbeeInvites)
      .where(and(ofEmail, open(), gt(dazbeeInvites.expiresAt, now)))
    if (other?.providerInviteId) throw new InviteConflict('This invite changed; try again')
    if (other && other.createdAt.getTime() > now.getTime() - SENDING_MS)
      throw new InviteConflict(`An invite to ${email} is being sent; try again in a moment`)
    // One left being sent past its time never finished, so it holds no invitation we know of.
    if (other) await tx.delete(dazbeeInvites).where(eq(dazbeeInvites.id, other.id))
    await tx
      .insert(dazbeeInvites)
      .values({ id, email, invitedBy, expiresAt: inviteExpiry(now.getTime()), createdAt: now })
  })

  let invitation: ProviderInvite
  try {
    invitation = await provider.invite(email, null, null)
  } catch (e) {
    await deleteQuietly(db, id)
    throw e
  }
  try {
    const [row] = await db
      .update(dazbeeInvites)
      .set({ providerInviteId: invitation.id, link: invitation.link, expiresAt: invitation.expiresAt })
      .where(eq(dazbeeInvites.id, id))
      .returning(summary)
    if (!row) throw new Error('The invite was not recorded')
    return dazbeeInvite(row)
  } catch (e) {
    await revokeQuietly(provider, invitation.id)
    await deleteQuietly(db, id)
    throw e
  }
}

/**
 * Every Dazbee invite as the admin page lists them: the pending ones, oldest first, and the people who
 * joined and those removed, each email once, newest first.
 */
export async function listDazbeeInvites(db: Db, now = new Date()): Promise<DazbeeInvites> {
  const [pendingRows, joined, removed] = await Promise.all([
    db
      .select(summary)
      .from(dazbeeInvites)
      .where(pending(now))
      .orderBy(asc(dazbeeInvites.createdAt), asc(dazbeeInvites.id)),
    invitedPeople(db, false),
    invitedPeople(db, true),
  ])
  return { pending: pendingRows.map(dazbeeInvite), joined, removed }
}

/** Sends a pending Dazbee invite again; null when there is no such pending invite, or it stops being one. */
export async function resendDazbeeInvite(
  db: Db,
  provider: InvitesProvider,
  inviteId: string,
  now = new Date(),
): Promise<DazbeeInvite | null> {
  const waiting = await findPending(db, inviteId, now)
  return waiting && resendPending(db, provider, waiting, now, [])
}

/**
 * Cancels a pending Dazbee invite. Null when there is no such pending invite; `accepted` when the person
 * already accepted it with its provider, which can't be undone, so it stays for their sign-in.
 */
export async function cancelDazbeeInvite(
  db: Db,
  provider: InvitesProvider,
  inviteId: string,
  now = new Date(),
): Promise<Revoked | null> {
  const waiting = await findPending(db, inviteId, now)
  if (!waiting) return null
  if ((await revokeWithProvider(provider, waiting.providerInviteId)) === 'accepted') return 'accepted'
  const [row] = await db
    .update(dazbeeInvites)
    .set({ revokedAt: now })
    .where(and(eq(dazbeeInvites.id, waiting.id), pending(now)))
    .returning({ id: dazbeeInvites.id })
  return row ? 'revoked' : null
}

/**
 * Removes the access of the person who joined through the accepted invite `inviteId`, marking every accepted
 * invite of their email and ending every agent access they gave, so an invite that lets them back in brings
 * none back; false when it is no such invite, or its person is already removed.
 */
export async function removeInvitedPerson(db: Db, inviteId: string, now = new Date()): Promise<boolean> {
  return db.transaction(async (tx) => {
    const ofInvite = tx
      .select({ email: dazbeeInvites.email })
      .from(dazbeeInvites)
      .where(and(eq(dazbeeInvites.id, inviteId), accepted(false)))
    const rows = await tx
      .update(dazbeeInvites)
      .set({ removedAt: now })
      .where(and(inArray(dazbeeInvites.email, ofInvite), accepted(false)))
      .returning({ email: dazbeeInvites.email })
    if (rows.length === 0) return false
    const people = await tx
      .select({ id: users.id })
      .from(users)
      .where(inArray(sql`lower(${users.email})`, [...new Set(rows.map((row) => row.email))]))
    await endPeopleAccesses(
      tx,
      people.map((person) => person.id),
      now,
    )
    return true
  })
}

/** The pending Dazbee invites of an email, oldest first, for sign-in to read from their provider. */
export async function pendingDazbeeInvites(
  db: Db | Tx,
  email: string,
  now = new Date(),
): Promise<WaitingDazbeeInvite[]> {
  return db
    .select(providerRef)
    .from(dazbeeInvites)
    .where(and(eq(dazbeeInvites.email, email.toLowerCase()), pending(now)))
    .orderBy(asc(dazbeeInvites.createdAt), asc(dazbeeInvites.id))
}

/**
 * Marks a pending Dazbee invite accepted, and clears its email's removal, which gives a removed person their
 * access back; false when it is no longer pending.
 */
export async function acceptDazbeeInvite(db: Db | Tx, inviteId: string, now = new Date()): Promise<boolean> {
  const [row] = await db
    .update(dazbeeInvites)
    .set({ acceptedAt: now })
    .where(and(eq(dazbeeInvites.id, inviteId), pending(now)))
    .returning({ email: dazbeeInvites.email })
  if (!row) return false
  await db
    .update(dazbeeInvites)
    .set({ removedAt: null })
    .where(and(eq(dazbeeInvites.email, row.email), isNotNull(dazbeeInvites.removedAt)))
  return true
}

/** Whether an admin removed the access of the person with this email. */
export async function isRemoved(db: Db | Tx, email: string): Promise<boolean> {
  const [row] = await db
    .select({ id: dazbeeInvites.id })
    .from(dazbeeInvites)
    .where(and(eq(dazbeeInvites.email, email.toLowerCase()), accepted(true)))
    .limit(1)
  return Boolean(row)
}

/** Whether the person's access was removed, by the email they last signed in with; never an admin's. */
export async function isRemovedUser(db: Db, userId: string, admins: Admins): Promise<boolean> {
  const [row] = await db
    .select({ email: users.email })
    .from(users)
    .innerJoin(dazbeeInvites, eq(dazbeeInvites.email, sql`lower(${users.email})`))
    .where(and(eq(users.id, userId), accepted(true)))
    .limit(1)
  return row ? !admins.has(row.email.toLowerCase()) : false
}

/** Refuses an email that has an account whose access wasn't removed: it gets no invite. */
async function refuseAccount(db: Db | Tx, email: string): Promise<void> {
  const [account] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(sql`lower(${users.email})`, email))
    .limit(1)
  if (account && !(await isRemoved(db, email))) throw new InvalidInvite(`${email} already has an account`)
}

/**
 * The people who joined through a Dazbee invite, removed or not, each email once with the name its account
 * gave, newest first: by when they joined, or were removed.
 */
async function invitedPeople(db: Db, removed: boolean): Promise<InvitedPerson[]> {
  const at = removed ? dazbeeInvites.removedAt : dazbeeInvites.acceptedAt
  // Spelled out with its tables named: Drizzle leaves the columns of a one-table query unqualified, and inside
  // this subquery `email` would be the person's own.
  const name = sql<string | null>`${sql.raw(
    '(select "u"."name" from "users" "u" where lower("u"."email") = "dazbee_invites"."email" order by "u"."created_at" limit 1)',
  )}`
  const rows = await db
    .selectDistinctOn([dazbeeInvites.email], { id: dazbeeInvites.id, email: dazbeeInvites.email, name, at })
    .from(dazbeeInvites)
    .where(accepted(removed))
    .orderBy(dazbeeInvites.email, desc(at))
  return rows
    .map((row) => ({ id: row.id, email: row.email, name: row.name ?? '', at: (row.at ?? new Date(0)).toISOString() }))
    .sort((a, b) => b.at.localeCompare(a.at))
}

/**
 * Sends a pending invite again, then writes its new link and expiry, in a transaction that also marks the
 * given invites revoked. Null when it stopped being pending meanwhile, whether the provider then refused to
 * resend it or not.
 */
async function resendPending(
  db: Db,
  provider: InvitesProvider,
  waiting: WaitingDazbeeInvite,
  now: Date,
  revoke: string[],
): Promise<DazbeeInvite | null> {
  let invitation: ProviderInvite
  try {
    invitation = await provider.resend(waiting.providerInviteId)
  } catch (e) {
    if (await findPending(db, waiting.id, now)) throw e
    return null
  }
  return db.transaction(async (tx) => {
    await markRevoked(tx, revoke, now)
    const [row] = await tx
      .update(dazbeeInvites)
      .set({ link: invitation.link, expiresAt: invitation.expiresAt })
      .where(and(eq(dazbeeInvites.id, waiting.id), pending(now)))
      .returning(summary)
    return row ? dazbeeInvite(row) : null
  })
}

/** Holds a lock on the email's Dazbee invites until the transaction ends. */
async function lockEmail(tx: Tx, email: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`dazbee invite ${email}`}, 0))`)
}

/** Marks the invites revoked, those still neither accepted nor revoked. */
async function markRevoked(tx: Tx, inviteIds: string[], now: Date): Promise<void> {
  if (inviteIds.length === 0) return
  await tx
    .update(dazbeeInvites)
    .set({ revokedAt: now })
    .where(and(inArray(dazbeeInvites.id, inviteIds), open()))
}

function dazbeeInvite(row: { id: string; email: string; expiresAt: Date; link: string }): DazbeeInvite {
  return { ...row, expiresAt: row.expiresAt.toISOString() }
}

/** Revokes an invitation the provider sent that we don't keep, logging a failure rather than answering it. */
async function revokeQuietly(provider: InvitesProvider, id: string): Promise<void> {
  try {
    await provider.revoke(id)
  } catch (e) {
    logError('invite-not-revoked', e)
  }
}

/** Deletes an invite whose sending failed, logging a failure rather than answering it. */
async function deleteQuietly(db: Db, inviteId: string): Promise<void> {
  try {
    await db.delete(dazbeeInvites).where(eq(dazbeeInvites.id, inviteId))
  } catch (e) {
    logError('invite-not-deleted', e)
  }
}

/** The pending Dazbee invite, or null when there is none. */
async function findPending(db: Db, inviteId: string, now: Date): Promise<WaitingDazbeeInvite | null> {
  const [row] = await db
    .select(providerRef)
    .from(dazbeeInvites)
    .where(and(eq(dazbeeInvites.id, inviteId), pending(now)))
  return row ?? null
}
