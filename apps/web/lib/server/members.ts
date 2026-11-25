// The API's calls for a workspace's members and invites, a member's changes and leaving, and the
// development invite's accept, from the web app's server only.
import 'server-only'

import { z } from 'zod'

import { type CreateInvite, Invite, SignedIn, type UpdateMember, WorkspaceMember } from '@dazbee/schema'

import { ApiFailure, call, workspaceRoot } from './api.ts'

/** The API's refusal of a change: its status, and the message it gave. */
export interface Refusal {
  status: number
  message: string
  /** The answer's body, for refusals that say more than their message. */
  body?: unknown
}

/**
 * The API's answers to a change of invites or members that the person reads in place: what they asked
 * can't be done, including by a person no longer an Owner or Admin.
 */
const REFUSALS = new Set([400, 403, 404, 409])

/** The workspace's members, from Owner down, then by when they joined. */
export const listMembers = (workspaceId: string) =>
  call(WorkspaceMember.array(), `${workspaceRoot(workspaceId)}/members`)

/** The workspace's pending invites, for an Owner or Admin. */
export const listInvites = (workspaceId: string) => call(Invite.array(), `${workspaceRoot(workspaceId)}/invites`)

/** Invites an email with a role; an email with a pending invite has it sent again, with this role. */
export const createInvite = (workspaceId: string, invite: CreateInvite) =>
  call(Invite, `${workspaceRoot(workspaceId)}/invites`, { method: 'POST', body: invite })

export const resendInvite = (workspaceId: string, inviteId: string) =>
  call(Invite, `${invitePath(workspaceId, inviteId)}/resend`, { method: 'POST' })

export const revokeInvite = (workspaceId: string, inviteId: string) =>
  call(z.null(), invitePath(workspaceId, inviteId), { method: 'DELETE' })

/**
 * Changes another member's role or the brands they may see (a list, or null for every brand), as an Owner
 * or Admin.
 */
export const changeMember = (workspaceId: string, userId: string, change: z.input<typeof UpdateMember>) =>
  call(WorkspaceMember, memberPath(workspaceId, userId), { method: 'PATCH', body: change })

/** Removes another member, as an Owner or Admin. */
export const removeMember = (workspaceId: string, userId: string) =>
  call(z.null(), memberPath(workspaceId, userId), { method: 'DELETE' })

/** Makes the Admin the Owner, and the Owner who asks an Admin. */
export const handOverOwner = (workspaceId: string, userId: string) =>
  call(z.null(), `${memberPath(workspaceId, userId)}/owner`, { method: 'POST' })

/** Takes the person out of the workspace; refused to its Owner. */
export const leaveWorkspace = (workspaceId: string) =>
  call(z.null(), `${workspaceRoot(workspaceId)}/leave`, { method: 'POST' })

/**
 * Accepts a development invite by the id its link names, as the person of its email, and gives their
 * session and the workspace to open.
 */
export const acceptDevInvite = (invite: string) =>
  call(SignedIn, '/auth/dev/accept', { method: 'POST', body: { invite } }, { signIn: false })

/**
 * Runs a change and gives null, or the API's refusal of it (400, 403, 404 or 409), for the person to read
 * where they made it. Any other failure is thrown.
 */
export async function refusalOf(change: () => Promise<unknown>): Promise<Refusal | null> {
  try {
    await change()
    return null
  } catch (e) {
    if (e instanceof ApiFailure && REFUSALS.has(e.status)) return { status: e.status, message: e.message, body: e.body }
    throw e
  }
}

/** The API's path of one of the workspace's invites. */
function invitePath(workspaceId: string, inviteId: string) {
  return `${workspaceRoot(workspaceId)}/invites/${encodeURIComponent(inviteId)}`
}

/** The API's path of one of the workspace's members. */
function memberPath(workspaceId: string, userId: string) {
  return `${workspaceRoot(workspaceId)}/members/${encodeURIComponent(userId)}`
}
