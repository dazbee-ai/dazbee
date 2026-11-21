// The waiting list: requests to join Dazbee, sent from /login during early access, one per email, which a
// new request from the same email updates. An admin invites a request's email with a Dazbee invite, which
// marks it invited and takes it off the list, or dismisses it, which deletes it. Requests from one address
// are limited by `RequestLimit`.
import { and, desc, eq, isNull } from 'drizzle-orm'

import { accessRequests, type Db, newId } from '@dazbee/db'
import type { AccessRequest, DazbeeInvite, RequestAccess } from '@dazbee/schema'

import type { InvitesProvider } from '../members/invites-provider.ts'
import { inviteToDazbee } from './dazbee-invites.ts'

/**
 * Counts the requests each address (or other key, such as a member's id) sends, and refuses one past the limit within
 * the window.
 */
export interface RequestLimit {
  /** Whether a request from `address` is within the limit, counting it when it is. */
  take(address: string, now?: number): boolean
}

/** How many requests to join one address may send within `REQUEST_WINDOW_MS`. */
export const REQUESTS_PER_WINDOW = 5
export const REQUEST_WINDOW_MS = 60 * 60 * 1000

/** The addresses kept at most, so a flood of addresses can't fill the memory; the oldest goes first. */
const MAX_ADDRESSES = 10_000

/**
 * Records a request to join, or updates the request of the same email with its new name, company, note and
 * time, back on the list if it was invited, since its invite may have lapsed. Answers nothing, so a request
 * never tells whether the email has an account.
 */
export async function requestAccess(db: Db, request: RequestAccess, now = new Date()): Promise<void> {
  const fields = { name: request.name, company: request.company, note: request.note, requestedAt: now }
  await db
    .insert(accessRequests)
    .values({ id: newId(), email: request.email, ...fields })
    .onConflictDoUpdate({ target: accessRequests.email, set: { ...fields, invitedAt: null } })
}

/** The requests not yet invited, newest first. */
export async function listAccessRequests(db: Db): Promise<AccessRequest[]> {
  const rows = await db
    .select({
      id: accessRequests.id,
      email: accessRequests.email,
      name: accessRequests.name,
      company: accessRequests.company,
      note: accessRequests.note,
      requestedAt: accessRequests.requestedAt,
    })
    .from(accessRequests)
    .where(isNull(accessRequests.invitedAt))
    .orderBy(desc(accessRequests.requestedAt), desc(accessRequests.id))
  return rows.map((row) => ({ ...row, requestedAt: row.requestedAt.toISOString() }))
}

/**
 * Sends a request's email a Dazbee invite as the admin `invitedBy`, as inviting it from the page does, and
 * marks the request invited. Null when the waiting list has no such request.
 */
export async function inviteRequest(
  db: Db,
  provider: InvitesProvider,
  invitedBy: string,
  requestId: string,
  now = new Date(),
): Promise<DazbeeInvite | null> {
  const [request] = await db
    .select({ email: accessRequests.email })
    .from(accessRequests)
    .where(and(eq(accessRequests.id, requestId), isNull(accessRequests.invitedAt)))
  if (!request) return null
  const invite = await inviteToDazbee(db, provider, invitedBy, request.email, now)
  await db.update(accessRequests).set({ invitedAt: now }).where(eq(accessRequests.id, requestId))
  return invite
}

/** Deletes a request from the waiting list; false when there is no such request. */
export async function dismissRequest(db: Db, requestId: string): Promise<boolean> {
  const rows = await db
    .delete(accessRequests)
    .where(eq(accessRequests.id, requestId))
    .returning({ id: accessRequests.id })
  return rows.length > 0
}

/**
 * A limit on requests, kept in this server's memory: `perWindow` from one address or key within `windowMs`; unless given,
 * `REQUESTS_PER_WINDOW` within `REQUEST_WINDOW_MS`, the limit on requests to join.
 */
export function requestLimit({ perWindow = REQUESTS_PER_WINDOW, windowMs = REQUEST_WINDOW_MS } = {}): RequestLimit {
  // When each address's requests within the window were taken, oldest first, by address.
  const taken = new Map<string, number[]>()

  function take(address: string, now = Date.now()): boolean {
    const recent = (taken.get(address) ?? []).filter((at) => at > now - windowMs)
    if (recent.length >= perWindow) {
      taken.set(address, recent)
      return false
    }
    taken.delete(address)
    taken.set(address, [...recent, now])
    if (taken.size > MAX_ADDRESSES) taken.delete(taken.keys().next().value ?? '')
    return true
  }

  return { take }
}
