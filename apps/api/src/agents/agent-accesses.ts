// Agent accesses and their tokens (ADR-0019). A member lets an agent into one workspace: an access, with the
// brands it may open and whether it writes. The agent works with opaque random tokens, an access token for an
// hour and a refresh token for 30 days, kept only as SHA-256 hashes. A refresh token is swapped once for a new
// pair; used again within 30 seconds (two of the client's processes refreshing at once) it is refused and the
// access goes on, used again later it ends the access. An access token finds its access only while the token is
// unexpired, the access not ended and its person still a member of its workspace. A refresh deletes the access's
// expired tokens, so an access keeps at most its unexpired ones.
import { createHash, randomBytes } from 'node:crypto'

import { and, desc, eq, gt, inArray, isNull, lte, or } from 'drizzle-orm'

import { agentAccesses, agentTokens, type Db, memberships, newId, type Tx } from '@dazbee/db'
import { ACCESS_TOKEN_PREFIX, type AgentAccessSummary } from '@dazbee/schema'

/** An access as a request of its agent is held to. */
export interface AgentAccess {
  id: string
  userId: string
  workspaceId: string
  /** The brands it may open, or null for every brand the member sees. */
  brandIds: string[] | null
  writes: boolean
  clientName: string
}

/** What a member chose for an agent: the access to make, and the client the agent signed in with. */
export interface NewAgentAccess extends Omit<AgentAccess, 'id'> {
  clientId: string | null
}

/** A token pair, as the agent gets it once; only their hashes are kept. */
export interface AgentTokens {
  accessToken: string
  refreshToken: string
  accessExpiresAt: Date
  refreshExpiresAt: Date
}

/** A refresh's answer: a new pair, or OAuth's `invalid_grant`. */
export type Refreshed = { ok: true; tokens: AgentTokens } | { ok: false; error: 'invalid_grant' }

/** The member an access belongs to. */
export interface AccessMember {
  workspaceId: string
  userId: string
}

/** What every refresh token starts with. */
export const REFRESH_TOKEN_PREFIX = 'dazbee_rt_'
export const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000
/** How long after its swap a refresh token used again is refused without ending its access. */
export const REFRESH_GRACE_MS = 30 * 1000
/** How often, at most, an access's last use is written. */
export const LAST_USED_EVERY_MS = 60 * 1000

const refused: Refreshed = { ok: false, error: 'invalid_grant' }

/** Joins an access to its person's membership of its workspace, which it needs to be live. */
const membershipOfAccess = and(
  eq(memberships.workspaceId, agentAccesses.workspaceId),
  eq(memberships.userId, agentAccesses.userId),
)

/** Whether a token is an agent's by its prefix in any case, live or not. */
export function isAgentToken(token: string): boolean {
  const start = token.slice(0, ACCESS_TOKEN_PREFIX.length).toLowerCase()
  return start === ACCESS_TOKEN_PREFIX || start === REFRESH_TOKEN_PREFIX
}

/** Makes an access; its id. It has no tokens until `issueTokens` gives some. */
export async function makeAccess(db: Db | Tx, access: NewAgentAccess): Promise<string> {
  const id = newId()
  await db.insert(agentAccesses).values({ id, ...access })
  return id
}

/** Gives the access a new token pair, keeping only their hashes. */
export async function issueTokens(db: Db | Tx, accessId: string, now = new Date()): Promise<AgentTokens> {
  const tokens = {
    accessToken: `${ACCESS_TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`,
    refreshToken: `${REFRESH_TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`,
    accessExpiresAt: new Date(now.getTime() + ACCESS_TOKEN_TTL_MS),
    refreshExpiresAt: new Date(now.getTime() + REFRESH_TOKEN_TTL_MS),
  }
  await db.insert(agentTokens).values([
    { hash: hashOf(tokens.accessToken), accessId, kind: 'access', expiresAt: tokens.accessExpiresAt },
    { hash: hashOf(tokens.refreshToken), accessId, kind: 'refresh', expiresAt: tokens.refreshExpiresAt },
  ])
  return tokens
}

/**
 * The access of a live access token: unexpired at `now`, its access not ended, and its person still a member
 * of its workspace; otherwise null. Notes the access's use, at most once a minute.
 */
export async function findAccessOfToken(db: Db, token: string, now = new Date()): Promise<AgentAccess | null> {
  if (!token.startsWith(ACCESS_TOKEN_PREFIX)) return null
  const [row] = await db
    .select({
      id: agentAccesses.id,
      userId: agentAccesses.userId,
      workspaceId: agentAccesses.workspaceId,
      brandIds: agentAccesses.brandIds,
      writes: agentAccesses.writes,
      clientName: agentAccesses.clientName,
      lastUsedAt: agentAccesses.lastUsedAt,
    })
    .from(agentTokens)
    .innerJoin(agentAccesses, eq(agentAccesses.id, agentTokens.accessId))
    .innerJoin(memberships, membershipOfAccess)
    .where(
      and(
        eq(agentTokens.hash, hashOf(token)),
        eq(agentTokens.kind, 'access'),
        gt(agentTokens.expiresAt, now),
        isNull(agentAccesses.endedAt),
      ),
    )
  if (!row) return null
  const { lastUsedAt, ...access } = row
  if (!lastUsedAt || now.getTime() - lastUsedAt.getTime() >= LAST_USED_EVERY_MS) await noteUse(db, access.id, now)
  return access
}

/**
 * Swaps a refresh token for a new pair, marking it swapped. A token swapped already is refused; when it was
 * swapped more than `REFRESH_GRACE_MS` before `now`, its access is ended too. An unknown or expired token, and
 * one of an ended access or of a person no longer a member, is refused.
 */
export async function refreshTokens(db: Db, token: string, now = new Date()): Promise<Refreshed> {
  if (!token.startsWith(REFRESH_TOKEN_PREFIX)) return refused
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ accessId: agentTokens.accessId, expiresAt: agentTokens.expiresAt, swappedAt: agentTokens.swappedAt })
      .from(agentTokens)
      .innerJoin(agentAccesses, eq(agentAccesses.id, agentTokens.accessId))
      .innerJoin(memberships, membershipOfAccess)
      .where(and(eq(agentTokens.hash, hashOf(token)), eq(agentTokens.kind, 'refresh'), isNull(agentAccesses.endedAt)))
      .for('update', { of: agentTokens })
    if (!row) return refused
    if (row.swappedAt) {
      if (now.getTime() - row.swappedAt.getTime() > REFRESH_GRACE_MS)
        await tx.update(agentAccesses).set({ endedAt: now }).where(eq(agentAccesses.id, row.accessId))
      return refused
    }
    if (row.expiresAt.getTime() <= now.getTime()) return refused
    await tx
      .update(agentTokens)
      .set({ swappedAt: now })
      .where(eq(agentTokens.hash, hashOf(token)))
    // The access's expired tokens go: none finds the access, and a refresh token swapped and then used
    // again past its 30 days is refused instead of ending the access. A swapped unexpired one stays.
    await tx.delete(agentTokens).where(and(eq(agentTokens.accessId, row.accessId), lte(agentTokens.expiresAt, now)))
    return { ok: true, tokens: await issueTokens(tx, row.accessId, now) }
  })
}

/** Ends the member's own access, unless it has ended already; whether it ended one. */
export async function endAccess(db: Db, member: AccessMember, accessId: string, now = new Date()): Promise<boolean> {
  const ended = await db
    .update(agentAccesses)
    .set({ endedAt: now })
    .where(and(eq(agentAccesses.id, accessId), ofMember(member), isNull(agentAccesses.endedAt)))
    .returning({ id: agentAccesses.id })
  return ended.length > 0
}

/** Ends every access the member gave in the workspace, as they leave it or are removed from it. */
export async function endMemberAccesses(tx: Tx, member: AccessMember, now = new Date()): Promise<void> {
  await tx
    .update(agentAccesses)
    .set({ endedAt: now })
    .where(and(ofMember(member), isNull(agentAccesses.endedAt)))
}

/** Ends every access the people gave, in every workspace, as an admin removes them. */
export async function endPeopleAccesses(tx: Tx, userIds: string[], now = new Date()): Promise<void> {
  if (userIds.length === 0) return
  await tx
    .update(agentAccesses)
    .set({ endedAt: now })
    .where(and(inArray(agentAccesses.userId, userIds), isNull(agentAccesses.endedAt)))
}

/** The member's own accesses in the workspace that haven't ended, newest first. */
export async function listAccesses(db: Db, workspaceId: string, userId: string): Promise<AgentAccessSummary[]> {
  const rows = await db
    .select({
      id: agentAccesses.id,
      clientName: agentAccesses.clientName,
      brandIds: agentAccesses.brandIds,
      writes: agentAccesses.writes,
      createdAt: agentAccesses.createdAt,
      lastUsedAt: agentAccesses.lastUsedAt,
    })
    .from(agentAccesses)
    .where(and(ofMember({ workspaceId, userId }), isNull(agentAccesses.endedAt)))
    .orderBy(desc(agentAccesses.createdAt), desc(agentAccesses.id))
  return rows.map((row) => ({
    ...row,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
  }))
}

/** The SHA-256 a token is kept as. */
function hashOf(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/** Writes the access's last use, unless another request wrote it within the minute. */
async function noteUse(db: Db, accessId: string, now: Date) {
  const minuteBefore = new Date(now.getTime() - LAST_USED_EVERY_MS)
  await db
    .update(agentAccesses)
    .set({ lastUsedAt: now })
    .where(
      and(
        eq(agentAccesses.id, accessId),
        or(isNull(agentAccesses.lastUsedAt), lte(agentAccesses.lastUsedAt, minuteBefore)),
      ),
    )
}

/** The rows of the member's accesses. */
function ofMember({ workspaceId, userId }: AccessMember) {
  return and(eq(agentAccesses.workspaceId, workspaceId), eq(agentAccesses.userId, userId))
}
