// A workspace's members changed by its members: an Owner or Admin changes another member's role or the brands
// they may see, or removes them, never the Owner, and anyone but the Owner leaves. Each change reads the
// memberships it rests on again, locked, in the transaction that writes it, so two changes at once never
// leave a workspace with no Owner or two. Removing and leaving take the person out of the workspace's WorkOS
// organization while their membership is locked, then delete it, so a failure there leaves them a member and
// trying again works, and a second removal waits and then finds no such member. Leaving or being removed
// ends the agent accesses the member gave there, in the same transaction.
import { and, asc, eq, inArray } from 'drizzle-orm'

import { type Db, memberships, type Tx, users, workspaces } from '@dazbee/db'
import { type MemberRole, roleLimitable, roleManages, type UpdateMember } from '@dazbee/schema'

import { endMemberAccesses } from '../agents/agent-accesses.ts'
import { listMembers } from '../workspace/workspace.ts'
import { checkLimit, writeLimit } from './brand-limits.ts'
import { invitesProviderFor, type InvitesProviders } from './invites-provider.ts'

/** Who asks for a change: the person, in the workspace the route is for. */
export interface Actor {
  workspaceId: string
  userId: string
}

/** A refusal of a change of members, answered with its status and message. */
export class MemberRefusal extends Error {
  readonly status: 400 | 403 | 404
  constructor(status: 400 | 403 | 404, message: string) {
    super(message)
    this.status = status
  }
}

/**
 * Changes another member's role or the brands they may see, or both, as an Owner or Admin; never the
 * Owner's, and never their own. A member made an Admin sees every brand; one moved between Editor and
 * Reviewer keeps their brands unless given others.
 */
export async function changeMember(db: Db, actor: Actor, userId: string, { role, brandIds }: UpdateMember) {
  return db.transaction(async (tx) => {
    const roles = await lockRoles(tx, actor, userId)
    const target = managed(roles, actor, userId)
    if (userId === actor.userId) throw new MemberRefusal(403, 'You can’t change your own role')
    if (target === 'owner') throw new MemberRefusal(403, 'The Owner’s role is changed only by handing over Owner')
    const next = role ?? target
    if (brandIds !== undefined) await checkLimit(tx, actor.workspaceId, next, brandIds)
    const limit = brandIds !== undefined ? brandIds : roleLimitable(next) ? undefined : null
    if (limit !== undefined) await writeLimit(tx, actor.workspaceId, userId, limit, role)
    else if (role)
      await tx
        .update(memberships)
        .set({ role })
        .where(and(eq(memberships.workspaceId, actor.workspaceId), eq(memberships.userId, userId)))
    const [member] = await listMembers(tx, actor.workspaceId, userId)
    if (!member) throw new Error('the changed member is gone')
    return member
  })
}

/** Removes another member, as an Owner or Admin; never the Owner, and never themselves, who leave instead. */
export async function removeMember(db: Db, providers: InvitesProviders, actor: Actor, userId: string) {
  await takeOut(db, providers, actor, userId, (roles) => {
    const target = managed(roles, actor, userId)
    if (userId === actor.userId) throw new MemberRefusal(403, 'Leave the workspace to stop being its member')
    if (target === 'owner') throw new MemberRefusal(403, 'The Owner can’t be removed')
  })
}

/** Takes the actor out of the workspace, unless they are its Owner, who hands over Owner first. */
export async function leaveWorkspace(db: Db, providers: InvitesProviders, actor: Actor) {
  await takeOut(db, providers, actor, actor.userId, (roles) => {
    const mine = roles.get(actor.userId)
    if (!mine) throw new MemberRefusal(404, 'No such workspace')
    if (mine === 'owner') throw new MemberRefusal(400, 'Hand over Owner first')
  })
}

/**
 * Hands Owner to an Admin, as the Owner alone: in one transaction the Admin becomes the Owner and the
 * Owner an Admin, so the workspace always has exactly one Owner.
 */
export async function handOverOwner(db: Db, actor: Actor, userId: string) {
  await db.transaction(async (tx) => {
    const roles = await lockRoles(tx, actor, userId)
    if (roles.get(actor.userId) !== 'owner') throw new MemberRefusal(403, 'Only the Owner can hand over Owner')
    if (!roles.has(userId)) throw new MemberRefusal(404, 'No such member')
    if (roles.get(userId) !== 'admin') throw new MemberRefusal(400, 'Only an Admin can be made Owner')
    const of = (id: string) => and(eq(memberships.workspaceId, actor.workspaceId), eq(memberships.userId, id))
    await tx.update(memberships).set({ role: 'admin' }).where(of(actor.userId))
    await tx.update(memberships).set({ role: 'owner' }).where(of(userId))
  })
}

/**
 * The roles of the actor and the member they change, by person, each membership locked until the
 * transaction ends. They are locked in one order, so two changes of the same memberships wait their turn
 * instead of each holding one the other needs.
 */
async function lockRoles(tx: Tx, actor: Actor, userId: string): Promise<Map<string, MemberRole>> {
  const rows = await tx
    .select({ userId: memberships.userId, role: memberships.role })
    .from(memberships)
    .where(and(eq(memberships.workspaceId, actor.workspaceId), inArray(memberships.userId, [actor.userId, userId])))
    .orderBy(asc(memberships.userId))
    .for('update')
  return new Map(rows.map((row) => [row.userId, row.role]))
}

/** The role of the member an Owner or Admin changes; refused to anyone else, and for no such member. */
function managed(roles: Map<string, MemberRole>, actor: Actor, userId: string): MemberRole {
  const mine = roles.get(actor.userId)
  if (!mine || !roleManages(mine)) throw new MemberRefusal(403, 'Only an Owner or Admin can do this')
  const target = roles.get(userId)
  if (!target) throw new MemberRefusal(404, 'No such member')
  return target
}

/**
 * Takes the person `userId` out of the actor's workspace once `check` passes on the roles, in one
 * transaction that holds both memberships locked: first out of its WorkOS organization, then out of the
 * workspace, ending the agent accesses they gave there. A WorkOS failure rolls it back, and a second change of the same memberships waits for it.
 */
async function takeOut(
  db: Db,
  providers: InvitesProviders,
  actor: Actor,
  userId: string,
  check: (roles: Map<string, MemberRole>) => void,
) {
  await db.transaction(async (tx) => {
    check(await lockRoles(tx, actor, userId))
    const [person] = await tx
      .select({ organizationId: workspaces.workosOrganizationId, workosUserId: users.workosUserId })
      .from(workspaces)
      .innerJoin(users, eq(users.id, userId))
      .where(eq(workspaces.id, actor.workspaceId))
    const organizationId = person?.organizationId
    // A workspace with no organization (the development one) has no list there to keep in step.
    const provider = organizationId ? invitesProviderFor(providers, organizationId) : null
    if (person && organizationId && provider) await provider.removeMember(organizationId, person.workosUserId)
    await tx
      .delete(memberships)
      .where(and(eq(memberships.workspaceId, actor.workspaceId), eq(memberships.userId, userId)))
    await endMemberAccesses(tx, { workspaceId: actor.workspaceId, userId })
  })
}
