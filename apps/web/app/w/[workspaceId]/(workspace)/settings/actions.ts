'use server'

// What Settings' invites, members and agent accesses do: invite an email with a role and brands, resend an invite
// and revoke one; change a member's role or brands, remove them and hand them Owner; leave a workspace; delete the
// person's account; and end one of the person's agent accesses. Each takes the workspace first, so a part binds it, and says why the API refused, in the
// person's language, where they made the change; Settings draws again with it, or, once the person has left,
// the workspace to open opens, and once their account is deleted, sign-in.
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import {
  CreateInvite,
  type DeleteAccount,
  InviteRole,
  type MemberBrands,
  roleLimitable,
  type UpdateMember,
} from '@dazbee/schema'

import { workspacePath } from '@/lib/brand-routes.ts'
import { format } from '@/lib/i18n/index.ts'
import { getMessages } from '@/lib/i18n/server.ts'
import { deleteAccount } from '@/lib/server/account.ts'
import { endAgentAccess as endAccess } from '@/lib/server/agents.ts'
import { findMe } from '@/lib/server/api.ts'
import {
  changeMember,
  createInvite,
  handOverOwner,
  leaveWorkspace,
  type Refusal,
  refusalOf,
  removeMember,
  resendInvite,
  revokeInvite,
} from '@/lib/server/members.ts'
import { forgetDeletedSession, forgetSession } from '@/lib/server/sign-in.ts'

/**
 * What an invite answered: whom it was sent to, why it wasn't (`field` naming the brands choice when it
 * was theirs), or nothing yet.
 */
export type InviteAnswer = { sent: string } | { error: string; field?: 'brands' } | null

/** The changes of invites, members and agent accesses, each refused for reasons of its own. */
type Change =
  | 'invite'
  | 'resend'
  | 'revoke'
  | 'role'
  | 'brands'
  | 'remove'
  | 'handOver'
  | 'leave'
  | 'delete'
  | 'endAgent'

/**
 * Invites the form's email with its role, kept lower-cased, and for an Editor or Reviewer the brands it
 * chose: every brand (`brands` is `all`), or those of its `brand` fields. An email with a pending invite
 * has it sent again with this role and brands. A form an invite can't be made from, such as one with no
 * email or with chosen brands but none ticked, is refused here.
 */
export async function invite(workspaceId: string, _before: InviteAnswer, form: FormData): Promise<InviteAnswer> {
  const role = form.get('role')
  const picked = InviteRole.safeParse(role)
  const limits = picked.success && roleLimitable(picked.data)
  const input = CreateInvite.safeParse({
    email: form.get('email') ?? '',
    role,
    brandIds: limits && form.get('brands') === 'chosen' ? form.getAll('brand') : null,
  })
  if (!input.success) {
    const words = (await getMessages()).settings
    const field = (name: string) => input.error.issues.some((issue) => issue.path[0] === name)
    if (field('email')) return { error: words.invite.badEmail }
    if (field('brandIds')) return { error: words.brands.noneChosen, field: 'brands' }
    return { error: input.error.issues.map((issue) => issue.message).join('; ') }
  }
  const refusal = await refusalOf(() => createInvite(workspaceId, input.data))
  if (refusal) return { error: await wordsFor('invite', refusal, input.data.email) }
  changed(workspaceId)
  return { sent: input.data.email }
}

/** Sends the invite again, with a new expiry; says why the API refused, or gives null. */
export async function resend(workspaceId: string, inviteId: string): Promise<string | null> {
  const refusal = await refusalOf(() => resendInvite(workspaceId, inviteId))
  changed(workspaceId)
  return refusal && wordsFor('resend', refusal)
}

/** Revokes the invite, so its link makes no member; says why the API refused, or gives null. */
export async function revoke(workspaceId: string, inviteId: string): Promise<string | null> {
  const refusal = await refusalOf(() => revokeInvite(workspaceId, inviteId))
  changed(workspaceId)
  return refusal && wordsFor('revoke', refusal)
}

/** Changes another member's role; says why the API refused, or gives null. */
export async function changeRole(
  workspaceId: string,
  userId: string,
  role: NonNullable<UpdateMember['role']>,
): Promise<string | null> {
  const refusal = await refusalOf(() => changeMember(workspaceId, userId, { role }))
  changed(workspaceId)
  return refusal && wordsFor('role', refusal)
}

/**
 * Changes the brands another member may see, a list or null for every brand; says why the API refused, or
 * gives null.
 */
export async function changeBrands(
  workspaceId: string,
  userId: string,
  brandIds: MemberBrands,
): Promise<string | null> {
  const refusal = await refusalOf(() => changeMember(workspaceId, userId, { brandIds }))
  changed(workspaceId)
  return refusal && wordsFor('brands', refusal)
}

/** Removes another member, who loses the workspace at once; says why the API refused, or gives null. */
export async function remove(workspaceId: string, userId: string): Promise<string | null> {
  const refusal = await refusalOf(() => removeMember(workspaceId, userId))
  changed(workspaceId)
  return refusal && wordsFor('remove', refusal)
}

/** Makes the Admin the Owner, and the Owner who asks an Admin; says why the API refused, or gives null. */
export async function handOver(workspaceId: string, userId: string): Promise<string | null> {
  const refusal = await refusalOf(() => handOverOwner(workspaceId, userId))
  changed(workspaceId)
  return refusal && wordsFor('handOver', refusal)
}

/**
 * Takes the person out of the workspace, then opens the workspace to open, as `/` would, or signs them
 * out of the app and WorkOS with none left. It decides here, since a redirect from an action draws its
 * page in the action's answer, where `/`'s sign-out would not reach the browser. A person who is no
 * longer a member there has left it all the same; the Owner is told to hand over Owner first.
 */
export async function leave(workspaceId: string): Promise<string | null> {
  const refusal = await refusalOf(() => leaveWorkspace(workspaceId))
  if (refusal && refusal.status !== 404) return wordsFor('leave', refusal)
  // Every page names the person's workspaces: each draws again without this one.
  revalidatePath('/', 'layout')
  const open = (await findMe())?.open
  redirect(open ? workspacePath(open) : await forgetSession())
}

/**
 * Deletes the person's account, confirmed with the email they typed and the workspaces they were shown it
 * deletes, then forgets their session and opens sign-in, which says the account is deleted; an account
 * already deleted, as by a second press, opens it too. Refused, Settings draws again with what deleting
 * deletes now, naming any workspace to hand over Owner of first.
 */
export async function deleteMyAccount(workspaceId: string, confirmed: DeleteAccount): Promise<string | null> {
  const refusal = await refusalOf(() => deleteAccount(confirmed))
  if (refusal && refusal.status !== 404) {
    changed(workspaceId)
    return wordsFor('delete', refusal)
  }
  await forgetDeletedSession()
  redirect('/login?deleted=1')
}

/**
 * Ends one of the person's agent accesses in the workspace, so the API refuses its agent's tokens; says why the
 * API refused, or gives null. Settings draws again either way, without an access another tab ended.
 */
export async function endAgentAccess(workspaceId: string, accessId: string): Promise<string | null> {
  const refusal = await refusalOf(() => endAccess(workspaceId, accessId))
  changed(workspaceId)
  return refusal && wordsFor('endAgent', refusal)
}

/** Settings draws again with the workspace's members, invites and agent accesses as they now are. */
function changed(workspaceId: string) {
  revalidatePath(workspacePath(workspaceId, 'settings'))
}

/**
 * The person's words for the API's refusal of a change, read from its status and the change refused.
 * Of a member's: a person no longer allowed to change them is a 403, one no longer a member a 404, brands
 * that can't be given (the member no longer an Editor or Reviewer, or a brand not the workspace's) a 400,
 * the Owner's handing over refused to anyone else a 403 and to a member no longer an Admin a 400, and the
 * Owner's leaving a 400. Deleting the account with another email is a 400, and while the person owns a
 * workspace with other members, or when it would delete other workspaces than they were shown, a 409. An agent access that has ended, or was never the person's, is a 404. Of an invite's: inviting a member is a 400 (the form is checked here
 * first), a person no longer an Owner or Admin a 403, an invite no longer pending a 404 on resend or revoke,
 * and an invite being sent or changed meanwhile a 409, except on revoke, where a 409 is an invite already
 * accepted. Any other refusal, such as a workspace with no invites set up, keeps the API's message.
 */
async function wordsFor(change: Change, refusal: Refusal, email = ''): Promise<string> {
  const r = (await getMessages()).settings.refusals
  if (change === 'role' || change === 'brands' || change === 'remove' || change === 'handOver') {
    if (refusal.status === 404) return r.memberGone
    if (change === 'brands' && refusal.status === 400) return r.brandsRefused
    if (change !== 'handOver') return refusal.status === 403 ? r.notAllowed : refusal.message
    if (refusal.status === 403) return r.notOwner
    return refusal.status === 400 ? r.notAdmin : refusal.message
  }
  if (change === 'leave') return refusal.status === 400 ? r.handOverFirst : refusal.message
  if (change === 'endAgent') return refusal.status === 404 ? r.agentGone : refusal.message
  if (change === 'delete') {
    if (refusal.status === 400) return r.wrongEmail
    return refusal.status === 409 ? r.deletionChanged : refusal.message
  }
  if (refusal.status === 403) return r.notManager
  if (change === 'invite' && refusal.status === 400) return format(r.alreadyMember, { email })
  if (change !== 'invite' && refusal.status === 404) return r.gone
  if (refusal.status === 409) return change === 'revoke' ? r.accepted : r.tryAgain
  return refusal.message
}
