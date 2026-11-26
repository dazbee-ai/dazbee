// A workspace's allowance as an admin sees it: finding the workspace by its name or a member's email, giving
// it a gift, and reading its grants, what is left on each and its ledger. Grants are only ever added here,
// and the ledger is only read.
import { asc, desc, eq, ilike, inArray, or } from 'drizzle-orm'

import { giveGrant, grantsOf, left } from '@dazbee/ai'
import { aiGrants, aiLedger, type Db, memberships, users, workspaces } from '@dazbee/db'
import {
  type AiAllowanceView,
  type AiGrantView,
  type AiWorkspace,
  fromMillionths,
  type GiftInput,
  toMillionths,
} from '@dazbee/schema'

/** Why a gift was refused. */
export class GiftRefused extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GiftRefused'
  }
}

/** How many workspaces a search gives at most. */
const FOUND = 20

/** How many members' emails a workspace is shown with at most. */
const EMAILS = 5

/** How many of a workspace's newest ledger rows an admin reads. */
const LEDGER_ROWS = 200

/** IST, the day a gift's expiry and the spending stop count in. */
const IST = '+05:30'

/** The workspaces whose name or a member's email holds `text`, in any case, up to `FOUND`. */
export async function findWorkspaces(db: Db, text: string): Promise<AiWorkspace[]> {
  const pattern = `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
  const byEmail = db
    .select({ id: memberships.workspaceId })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(ilike(users.email, pattern))
  const found = await db
    .select({ id: workspaces.id, name: workspaces.name })
    .from(workspaces)
    .where(or(ilike(workspaces.name, pattern), inArray(workspaces.id, byEmail)))
    .orderBy(asc(workspaces.name), asc(workspaces.id))
    .limit(FOUND)
  return withEmails(db, found)
}

/**
 * Gives the workspace a gift of `amount` rupees of allowance, at the usage rate of the day, expiring when the
 * IST day `expiresOn` ends; the grant, or null when there is no such workspace. Refuses an expiry past.
 */
export async function giveGift(db: Db, workspace: string, gift: GiftInput, admin: string): Promise<AiGrantView | null> {
  const [found] = await db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.id, workspace))
  if (!found) return null
  const expiresAt = new Date(Date.parse(`${gift.expiresOn}T00:00:00${IST}`) + 86_400_000)
  if (expiresAt.getTime() <= Date.now()) throw new GiftRefused('The gift would have expired already')
  const id = await giveGrant(db, {
    workspace,
    amount: toMillionths(gift.amount),
    expiresAt,
    givenBy: admin,
    note: gift.note,
    layerSize: gift.layerSize,
  })
  const grant = (await grantViews(db, workspace)).find((g) => g.id === id)
  if (!grant) throw new Error(`the grant ${id} just given is missing`)
  return grant
}

/** The workspace's allowance: what is left on its live grants, every grant and its newest ledger rows. */
export async function allowanceOf(db: Db, workspace: string): Promise<AiAllowanceView | null> {
  const [found] = await db
    .select({ id: workspaces.id, name: workspaces.name })
    .from(workspaces)
    .where(eq(workspaces.id, workspace))
  if (!found) return null
  const [named] = await withEmails(db, [found])
  const grants = await grantViews(db, workspace)
  const ledger = await db
    .select({
      id: aiLedger.id,
      grantId: aiLedger.grantId,
      jobId: aiLedger.jobId,
      callId: aiLedger.callId,
      kind: aiLedger.kind,
      amount: aiLedger.amount,
      createdAt: aiLedger.createdAt,
    })
    .from(aiLedger)
    .innerJoin(aiGrants, eq(aiGrants.id, aiLedger.grantId))
    .where(eq(aiGrants.workspaceId, workspace))
    .orderBy(desc(aiLedger.id))
    .limit(LEDGER_ROWS)
  return {
    workspace: named ?? { ...found, emails: [] },
    left: fromMillionths(await left(db, workspace)),
    grants,
    ledger: ledger.map((row) => ({
      ...row,
      amount: fromMillionths(row.amount),
      createdAt: row.createdAt.toISOString(),
    })),
  }
}

/** Each workspace with up to `EMAILS` of its members' emails, its Owners first. */
async function withEmails(db: Db, found: { id: string; name: string }[]): Promise<AiWorkspace[]> {
  if (found.length === 0) return []
  const members = await db
    .select({ workspace: memberships.workspaceId, email: users.email, role: memberships.role })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(
      inArray(
        memberships.workspaceId,
        found.map((w) => w.id),
      ),
    )
    .orderBy(asc(memberships.createdAt))
  return found.map((workspace) => ({
    ...workspace,
    emails: members
      .filter((m) => m.workspace === workspace.id)
      .sort((a, b) => Number(b.role === 'owner') - Number(a.role === 'owner'))
      .slice(0, EMAILS)
      .map((m) => m.email),
  }))
}

/** The workspace's grants, the one that expires first first, with what is left on each and who gave it. */
async function grantViews(db: Db, workspace: string): Promise<AiGrantView[]> {
  const leftOn = new Map((await grantsOf(db, workspace)).map((g) => [g.id, g]))
  const rows = await db
    .select({ grant: aiGrants, givenBy: users.email })
    .from(aiGrants)
    .leftJoin(users, eq(users.id, aiGrants.givenBy))
    .where(eq(aiGrants.workspaceId, workspace))
    .orderBy(asc(aiGrants.expiresAt), asc(aiGrants.createdAt), asc(aiGrants.id))
  return rows.map(({ grant, givenBy }) => ({
    id: grant.id,
    source: grant.source,
    amount: fromMillionths(grant.amount),
    usageRate: fromMillionths(grant.usageRate),
    left: fromMillionths(leftOn.get(grant.id)?.left ?? grant.amount),
    expiresAt: grant.expiresAt.toISOString(),
    live: leftOn.get(grant.id)?.live ?? false,
    note: grant.note,
    layerSize: grant.layerSize === 1024 ? 1024 : 512,
    givenBy,
    createdAt: grant.createdAt.toISOString(),
  }))
}
