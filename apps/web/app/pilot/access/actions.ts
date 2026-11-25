'use server'

// What early access's admin page does: invite an email to Dazbee, resend or cancel a pending invite, remove a
// person who joined, and invite or dismiss a request on the waiting list. The API answers anyone but an admin
// as if none of it existed, so each action is an admin's only. Each says why the API refused, in the person's
// language, where they made the change, and the page draws again with what changed.
import { revalidatePath } from 'next/cache'

import { CreateDazbeeInvite } from '@dazbee/schema'

import { format } from '@/lib/i18n/index.ts'
import { getMessages } from '@/lib/i18n/server.ts'
import { PILOT_ACCESS_PATH } from '@/lib/pilot-host.ts'
import {
  cancelDazbeeInvite,
  dismissRequest,
  inviteRequest,
  inviteToDazbee,
  removeInvitedPerson,
  resendDazbeeInvite,
} from '@/lib/server/admin.ts'
import { type Refusal, refusalOf } from '@/lib/server/members.ts'

/** What an invite answered: whom it was sent to, why it wasn't, or nothing yet. */
export type PilotInviteAnswer = { sent: string } | { error: string } | null

/** The changes of the admin page, each refused for reasons of its own. */
type Change = 'invite' | 'resend' | 'cancel' | 'remove' | 'inviteRequest' | 'dismiss'

/** Invites the form's email to Dazbee, kept lower-cased; an email with a pending invite has it sent again. */
export async function invite(_before: PilotInviteAnswer, form: FormData): Promise<PilotInviteAnswer> {
  const input = CreateDazbeeInvite.safeParse({ email: form.get('email') ?? '' })
  if (!input.success) return { error: (await getMessages()).pilot.invite.badEmail }
  const refusal = await refusalOf(() => inviteToDazbee(input.data.email))
  // A refusal may come from a change the page doesn't show yet, such as the person having joined.
  changed()
  if (refusal) return { error: await wordsFor('invite', refusal, input.data.email) }
  return { sent: input.data.email }
}

/** Sends the invite again, with a new expiry; says why the API refused, or gives null. */
export async function resend(inviteId: string): Promise<string | null> {
  return act('resend', () => resendDazbeeInvite(inviteId))
}

/** Cancels the invite, so it lets nobody in; says why the API refused, or gives null. */
export async function cancel(inviteId: string): Promise<string | null> {
  return act('cancel', () => cancelDazbeeInvite(inviteId))
}

/** Removes the access of the person who joined through the invite; says why the API refused, or gives null. */
export async function remove(inviteId: string): Promise<string | null> {
  return act('remove', () => removeInvitedPerson(inviteId))
}

/** Sends the request's email a Dazbee invite; says why the API refused, or gives null. */
export async function inviteFromList(requestId: string, email: string): Promise<string | null> {
  return act('inviteRequest', () => inviteRequest(requestId), email)
}

/** Deletes the request from the waiting list; says why the API refused, or gives null. */
export async function dismiss(requestId: string): Promise<string | null> {
  return act('dismiss', () => dismissRequest(requestId))
}

/** Runs a change, then draws the page again; says why the API refused, or gives null. */
async function act(change: Change, run: () => Promise<unknown>, email = ''): Promise<string | null> {
  const refusal = await refusalOf(run)
  changed()
  return refusal && wordsFor(change, refusal, email)
}

/** The admin page draws again with the invites and the waiting list as they now are. */
function changed() {
  revalidatePath(PILOT_ACCESS_PATH)
}

/**
 * The person's words for the API's refusal of a change, read from its status and the change refused: an
 * email with an account is a 400 on an invite; an invite no longer pending, a person already removed or a
 * request already gone is a 404; an invite being sent or changed meanwhile is a 409, except on cancel, where
 * a 409 is an invite already accepted. Any other refusal keeps the API's message.
 */
async function wordsFor(change: Change, refusal: Refusal, email: string): Promise<string> {
  const r = (await getMessages()).pilot.refusals
  const inviting = change === 'invite' || change === 'inviteRequest'
  if (inviting && refusal.status === 400) return format(r.hasAccount, { email })
  if (refusal.status === 404) {
    if (change === 'remove') return r.personGone
    if (change === 'inviteRequest' || change === 'dismiss') return r.requestGone
    if (change !== 'invite') return r.gone
  }
  if (refusal.status === 409) return change === 'cancel' ? r.accepted : r.tryAgain
  return refusal.message
}
