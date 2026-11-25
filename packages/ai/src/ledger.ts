// The allowance ledger (ADR-0023): grants given to a workspace, and the add-only rows that hold, charge and
// give back its allowance. Costs come in millionths of a rupee of real cost; every amount on a grant is
// allowance, the cost times the grant's own usage rate. What is left on a grant is its amount plus its rows.
import { and, asc, eq, inArray, sql } from 'drizzle-orm'

import { aiGrants, aiLedger, aiSettings, type Db, newId, type Tx } from '@dazbee/db'
import type { GrantSource } from '@dazbee/schema'

/** A grant to give: how much allowance, until when, from whom and why. */
export interface NewGrant {
  workspace: string
  amount: bigint
  expiresAt: Date
  source?: GrantSource
  givenBy?: string | null
  note?: string
}

/** A grant with what is left on it. */
export interface GrantLeft {
  id: string
  amount: bigint
  usageRate: bigint
  expiresAt: Date
  live: boolean
  left: bigint
}

/** A rate of 1, as usage rates are kept (millionths). */
const RATE_ONE = 1_000_000n

/** The sum of a grant's ledger rows, in a select from `ai_grants`. */
const ROWS_SUM = sql<string>`coalesce((select sum(l.amount) from ai_ledger l where l.grant_id = "ai_grants"."id"), 0)`

/** Gives a workspace a grant at the usage rate of the day; its id. */
export async function giveGrant(db: Db | Tx, grant: NewGrant): Promise<string> {
  const [settings] = await db.select({ usageRate: aiSettings.usageRate }).from(aiSettings)
  if (!settings) throw new Error('the AI settings row is missing')
  const id = newId()
  await db.insert(aiGrants).values({
    id,
    workspaceId: grant.workspace,
    source: grant.source ?? 'gift',
    amount: grant.amount,
    usageRate: settings.usageRate,
    expiresAt: grant.expiresAt,
    givenBy: grant.givenBy ?? null,
    note: grant.note ?? '',
  })
  return id
}

/**
 * Holds `cost` of real cost for `job` on the workspace's live grants, the one that expires first first, then
 * the one given first. Gives false and writes nothing when the grants can't hold it all.
 */
export async function hold(tx: Tx, { workspace, job, cost }: { workspace: string; job: string; cost: bigint }) {
  const grants = await lockGrants(tx, workspace)
  let rest = cost
  const parts: { grant: string; amount: bigint }[] = []
  for (const grant of grants) {
    if (rest <= 0n) break
    if (!grant.live || grant.left <= 0n) continue
    const taken = take(rest, grant.usageRate, grant.left)
    parts.push({ grant: grant.id, amount: taken.amount })
    rest = taken.rest
  }
  if (rest > 0n) return false
  if (parts.length > 0) {
    await tx
      .insert(aiLedger)
      .values(parts.map((p) => ({ grantId: p.grant, jobId: job, kind: 'hold' as const, amount: -p.amount })))
  }
  return true
}

/**
 * Charges `call` its real `cost` for `job`: first from the job's hold, grant by grant in the hold's order,
 * then from the next live grants with allowance left, and the rest from the last grant held, which may go
 * below zero. Gives false, writing nothing, when the call was charged already.
 */
export async function charge(
  tx: Tx,
  { workspace, job, call, cost }: { workspace: string; job: string; call: string; cost: bigint },
): Promise<boolean> {
  const grants = await lockGrants(tx, workspace)
  const [charged] = await tx
    .select({ id: aiLedger.id })
    .from(aiLedger)
    .where(and(eq(aiLedger.callId, call), eq(aiLedger.kind, 'charge')))
    .limit(1)
  if (charged) return false
  if (cost <= 0n) return true
  const held = await heldParts(tx, job, grants)
  const charges = new Map<string, bigint>()
  const giveBacks = new Map<string, bigint>()
  const add = (map: Map<string, bigint>, grant: string, amount: bigint) =>
    map.set(grant, (map.get(grant) ?? 0n) + amount)
  let rest = cost
  for (const part of held) {
    if (rest <= 0n) break
    if (part.held <= 0n) continue
    const taken = take(rest, part.grant.usageRate, part.held)
    add(charges, part.grant.id, taken.amount)
    add(giveBacks, part.grant.id, taken.amount)
    rest = taken.rest
  }
  for (const grant of grants) {
    if (rest <= 0n) break
    // A part of the hold used above leaves what is left on its grant as it was: its charge and give-back cancel.
    const left = grant.left - (charges.get(grant.id) ?? 0n) + (giveBacks.get(grant.id) ?? 0n)
    if (!grant.live || left <= 0n) continue
    const taken = take(rest, grant.usageRate, left)
    add(charges, grant.id, taken.amount)
    rest = taken.rest
  }
  if (rest > 0n) {
    const last = held.at(-1)?.grant ?? grants.findLast((g) => charges.has(g.id)) ?? newestGrant(grants)
    if (!last) return false
    add(charges, last.id, allowanceOf(rest, last.usageRate))
  }
  const rows = [
    ...[...charges].map(([grant, amount]) => ({
      grantId: grant,
      jobId: job,
      callId: call,
      kind: 'charge' as const,
      amount: -amount,
    })),
    ...[...giveBacks].map(([grant, amount]) => ({
      grantId: grant,
      jobId: job,
      callId: call,
      kind: 'give-back' as const,
      amount,
    })),
  ]
  await tx.insert(aiLedger).values(rows)
  return true
}

/** Gives back what `job` still holds on each grant; the job has ended. */
export async function endHold(tx: Tx, { workspace, job }: { workspace: string; job: string }): Promise<void> {
  const grants = await lockGrants(tx, workspace)
  const rows = (await heldParts(tx, job, grants))
    .filter((part) => part.held > 0n)
    .map((part) => ({ grantId: part.grant.id, jobId: job, kind: 'give-back' as const, amount: part.held }))
  if (rows.length > 0) await tx.insert(aiLedger).values(rows)
}

/** The workspace's grants, the one that expires first first, each with what is left on it. */
export async function grantsOf(db: Db | Tx, workspace: string): Promise<GrantLeft[]> {
  return readGrants(db, workspace, false)
}

/** The allowance left on the workspace's live grants, never below zero. */
export async function left(db: Db | Tx, workspace: string): Promise<bigint> {
  const total = (await grantsOf(db, workspace)).filter((g) => g.live).reduce((sum, g) => sum + g.left, 0n)
  return total > 0n ? total : 0n
}

/** The share of the live grants' allowance used, from 0 to 1, for the usage bar; 1 with no live grant. */
export async function usageShare(db: Db | Tx, workspace: string): Promise<number> {
  const live = (await grantsOf(db, workspace)).filter((g) => g.live)
  const given = live.reduce((sum, g) => sum + g.amount, 0n)
  if (given <= 0n) return 1
  const remaining = live.reduce((sum, g) => sum + g.left, 0n)
  const share = 1 - Number(remaining > 0n ? remaining : 0n) / Number(given)
  return Math.min(1, Math.max(0, share))
}

/** The workspace's grants as `grantsOf` gives them, locked until the transaction ends. */
function lockGrants(tx: Tx, workspace: string): Promise<GrantLeft[]> {
  return readGrants(tx, workspace, true)
}

async function readGrants(db: Db | Tx, workspace: string, lock: boolean): Promise<GrantLeft[]> {
  const query = db
    .select({
      id: aiGrants.id,
      amount: aiGrants.amount,
      usageRate: aiGrants.usageRate,
      expiresAt: aiGrants.expiresAt,
      live: sql<boolean>`${aiGrants.expiresAt} > now()`,
      rows: ROWS_SUM,
    })
    .from(aiGrants)
    .where(eq(aiGrants.workspaceId, workspace))
    .orderBy(asc(aiGrants.expiresAt), asc(aiGrants.createdAt), asc(aiGrants.id))
  const rows = lock ? await query.for('update') : await query
  return rows.map(({ rows: sum, ...grant }) => ({ ...grant, left: grant.amount + BigInt(sum) }))
}

/** Each grant `job` holds on, in the grants' order, with the allowance it still holds there. */
async function heldParts(tx: Tx, job: string, grants: GrantLeft[]) {
  const sums = await tx
    .select({ grant: aiLedger.grantId, sum: sql<string>`sum(${aiLedger.amount})` })
    .from(aiLedger)
    .where(and(eq(aiLedger.jobId, job), inArray(aiLedger.kind, ['hold', 'give-back'])))
    .groupBy(aiLedger.grantId)
  const byGrant = new Map(sums.map((s) => [s.grant, -BigInt(s.sum)]))
  return grants.filter((g) => byGrant.has(g.id)).map((grant) => ({ grant, held: byGrant.get(grant.id) ?? 0n }))
}

/**
 * Takes real cost `rest` from `available` allowance at `rate`: the allowance taken, and the cost still to
 * take. Allowance is rounded up and the cost it covers down, so the ledger never takes too little.
 */
function take(rest: bigint, rate: bigint, available: bigint): { amount: bigint; rest: bigint } {
  const needed = allowanceOf(rest, rate)
  if (needed <= available) return { amount: needed, rest: 0n }
  return { amount: available, rest: rest - (available * RATE_ONE) / rate }
}

/** Real cost `cost` in allowance at `rate`, rounded up. */
function allowanceOf(cost: bigint, rate: bigint): bigint {
  return (cost * rate + RATE_ONE - 1n) / RATE_ONE
}

/** The grant that expires last, for a charge on a job that held nothing. */
function newestGrant(grants: GrantLeft[]): GrantLeft | undefined {
  return grants.at(-1)
}
