// The allowance ledger against Postgres from Docker Compose: each case on a workspace of its own.
import { eq, sql } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'

import { aiGrants, aiLedger, aiSettings } from '@dazbee/db'

import { charge, endHold, giveGrant, grantsOf, hold, layerSize, left, usageShare } from './ledger.ts'
import { addGrant, addJob, db, ledgerOf, newWorkspace, RUPEE } from './test-ai.ts'

/** The workspaces the case touched, checked after it. */
const touched: string[] = []

function workspace(): string {
  const id = newWorkspace()
  touched.push(id)
  return id
}

const rupees = (n: number) => BigInt(Math.round(n * 1e6))

const holdOn = (ws: string, job: string, cost: bigint) => db.transaction((tx) => hold(tx, { workspace: ws, job, cost }))
const chargeOn = (ws: string, job: string, call: string, cost: bigint) =>
  db.transaction((tx) => charge(tx, { workspace: ws, job, call, cost }))
const endOn = (ws: string, job: string) => db.transaction((tx) => endHold(tx, { workspace: ws, job }))

/** What is left on each grant, by id. */
async function leftOn(ws: string): Promise<Record<string, bigint>> {
  return Object.fromEntries((await grantsOf(db, ws)).map((g) => [g.id, g.left]))
}

// After every case, what is left on each grant is its amount plus the sum of its rows, read straight from the tables.
afterEach(async () => {
  for (const ws of touched.splice(0)) {
    const rows = await db
      .select({
        id: aiGrants.id,
        sum: sql<string>`"ai_grants"."amount" + coalesce((select sum(l.amount) from ai_ledger l where l.grant_id = "ai_grants"."id"), 0)`,
      })
      .from(aiGrants)
      .where(eq(aiGrants.workspaceId, ws))
    const read = await leftOn(ws)
    for (const row of rows) expect(read[row.id]).toBe(BigInt(row.sum))
  }
})

describe('giveGrant', () => {
  it('keeps the usage rate of the day', async () => {
    const ws = workspace()
    const [settings] = await db.select().from(aiSettings)
    const id = await giveGrant(db, { workspace: ws, amount: rupees(50), expiresAt: new Date(Date.now() + 86_400_000) })
    const [grant] = await grantsOf(db, ws)
    expect(grant).toMatchObject({
      id,
      amount: rupees(50),
      usageRate: settings?.usageRate,
      left: rupees(50),
      live: true,
    })
  })
})

describe('hold', () => {
  it('draws the grant that expires first, though it was given later', async () => {
    const ws = workspace()
    const later = await addGrant(ws, rupees(100), { days: 60 })
    const sooner = await addGrant(ws, rupees(100), { days: 10 })
    const job = await addJob(ws)
    expect(await holdOn(ws, job, rupees(30))).toBe(true)
    expect(await leftOn(ws)).toEqual({ [sooner]: rupees(70), [later]: rupees(100) })
  })

  it('splits a hold across grants', async () => {
    const ws = workspace()
    const a = await addGrant(ws, rupees(10), { days: 10 })
    const b = await addGrant(ws, rupees(100), { days: 20 })
    const job = await addJob(ws)
    expect(await holdOn(ws, job, rupees(15))).toBe(true)
    expect(await ledgerOf(job)).toMatchObject([
      { grant: a, kind: 'hold', amount: -rupees(10) },
      { grant: b, kind: 'hold', amount: -rupees(5) },
    ])
  })

  it('never draws an expired grant', async () => {
    const ws = workspace()
    const expired = await addGrant(ws, rupees(100), { days: -1 })
    const live = await addGrant(ws, rupees(100), { days: 5 })
    const job = await addJob(ws)
    expect(await holdOn(ws, job, rupees(20))).toBe(true)
    expect(await leftOn(ws)).toEqual({ [expired]: rupees(100), [live]: rupees(80) })
    expect(await left(db, ws)).toBe(rupees(80))
  })

  it('refuses a hold bigger than what is left, and writes nothing', async () => {
    const ws = workspace()
    await addGrant(ws, rupees(10))
    await addGrant(ws, rupees(5), { days: -1 })
    const job = await addJob(ws)
    expect(await holdOn(ws, job, rupees(10.000001))).toBe(false)
    expect(await ledgerOf(job)).toEqual([])
    expect(await left(db, ws)).toBe(rupees(10))
  })

  it('lets only one of two holds at once take the same allowance', async () => {
    const ws = workspace()
    await addGrant(ws, rupees(100))
    const [first, second] = [await addJob(ws), await addJob(ws)]
    const held = await Promise.all([holdOn(ws, first, rupees(60)), holdOn(ws, second, rupees(60))])
    expect(held.filter(Boolean)).toHaveLength(1)
    expect(await left(db, ws)).toBe(rupees(40))
  })
})

describe('charge', () => {
  it('charges each part at its own grant’s usage rate', async () => {
    const ws = workspace()
    const a = await addGrant(ws, rupees(10), { rate: 2n * RUPEE, days: 10 })
    const b = await addGrant(ws, rupees(100), { rate: RUPEE, days: 20 })
    const job = await addJob(ws)
    await holdOn(ws, job, rupees(8))
    expect(await chargeOn(ws, job, `${job}-1`, rupees(6))).toBe(true)
    const rows = (await ledgerOf(job)).filter((r) => r.kind === 'charge')
    expect(rows).toEqual([
      { grant: a, kind: 'charge', amount: -rupees(10), call: `${job}-1` },
      { grant: b, kind: 'charge', amount: -rupees(1), call: `${job}-1` },
    ])
  })

  it('gives the worked example’s numbers to the millionth', async () => {
    // Grant A has ₹10 at rate 2 and expires first; grant B ₹100 at rate 1. A hold of ₹8 takes ₹10 from A
    // (₹5 of it) and ₹3 from B. A charge of ₹6 uses A's ₹10 (₹5) and ₹1 of B's hold. Ending the hold gives
    // back B's other ₹2. A ends at ₹0 and B at ₹99.
    const ws = workspace()
    const a = await addGrant(ws, rupees(10), { rate: 2n * RUPEE, days: 10 })
    const b = await addGrant(ws, rupees(100), { rate: RUPEE, days: 20 })
    const job = await addJob(ws)
    await holdOn(ws, job, rupees(8))
    expect(await leftOn(ws)).toEqual({ [a]: 0n, [b]: rupees(97) })
    await chargeOn(ws, job, `${job}-1`, rupees(6))
    await endOn(ws, job)
    expect(await ledgerOf(job)).toEqual([
      { grant: a, kind: 'hold', amount: -rupees(10), call: null },
      { grant: b, kind: 'hold', amount: -rupees(3), call: null },
      { grant: a, kind: 'charge', amount: -rupees(10), call: `${job}-1` },
      { grant: b, kind: 'charge', amount: -rupees(1), call: `${job}-1` },
      { grant: a, kind: 'give-back', amount: rupees(10), call: `${job}-1` },
      { grant: b, kind: 'give-back', amount: rupees(1), call: `${job}-1` },
      { grant: b, kind: 'give-back', amount: rupees(2), call: null },
    ])
    expect(await leftOn(ws)).toEqual({ [a]: 0n, [b]: rupees(99) })
  })

  it('takes an overrun from the next grants, then the last grant held below zero', async () => {
    const ws = workspace()
    const a = await addGrant(ws, rupees(10), { days: 10 })
    const b = await addGrant(ws, rupees(5), { days: 20 })
    const job = await addJob(ws)
    await holdOn(ws, job, rupees(4))
    await chargeOn(ws, job, `${job}-1`, rupees(20))
    await endOn(ws, job)
    // The ₹4 held on A, then A's other ₹6 and all of B's ₹5, then ₹5 more from A, the last grant held.
    expect(await leftOn(ws)).toEqual({ [a]: -rupees(5), [b]: 0n })
    expect(await left(db, ws)).toBe(0n)
  })

  it('lets two charges at once each see what the other took', async () => {
    const ws = workspace()
    const a = await addGrant(ws, rupees(10), { days: 10 })
    const b = await addGrant(ws, rupees(100), { days: 20 })
    const job = await addJob(ws)
    await Promise.all([chargeOn(ws, job, `${job}-1`, rupees(8)), chargeOn(ws, job, `${job}-2`, rupees(8))])
    expect(await leftOn(ws)).toEqual({ [a]: 0n, [b]: rupees(94) })
  })

  it('charges a call only once', async () => {
    const ws = workspace()
    const grant = await addGrant(ws, rupees(100))
    const job = await addJob(ws)
    await holdOn(ws, job, rupees(10))
    expect(await chargeOn(ws, job, `${job}-1`, rupees(3))).toBe(true)
    expect(await chargeOn(ws, job, `${job}-1`, rupees(3))).toBe(false)
    await endOn(ws, job)
    expect(await leftOn(ws)).toEqual({ [grant]: rupees(97) })
  })

  it('refuses any change to a ledger row', async () => {
    const ws = workspace()
    await addGrant(ws, rupees(100))
    const job = await addJob(ws)
    await holdOn(ws, job, rupees(10))
    await expect(db.update(aiLedger).set({ amount: 0n }).where(eq(aiLedger.jobId, job))).rejects.toThrow()
    await expect(db.delete(aiLedger).where(eq(aiLedger.jobId, job))).rejects.toThrow()
  })
})

describe('endHold', () => {
  it('gives back everything a job held when nothing was charged', async () => {
    const ws = workspace()
    await addGrant(ws, rupees(10), { days: 10 })
    await addGrant(ws, rupees(10), { days: 20 })
    const job = await addJob(ws)
    await holdOn(ws, job, rupees(15))
    await endOn(ws, job)
    await endOn(ws, job)
    expect(await left(db, ws)).toBe(rupees(20))
  })
})

describe('grantsOf', () => {
  it('gives every grant, the one that expires first first, live or not, with what is left on it', async () => {
    const ws = workspace()
    const later = await addGrant(ws, rupees(20), { days: 20 })
    const expired = await addGrant(ws, rupees(5), { days: -1 })
    const job = await addJob(ws)
    await holdOn(ws, job, rupees(4))
    expect((await grantsOf(db, ws)).map((g) => [g.id, g.live, g.left])).toEqual([
      [expired, false, rupees(5)],
      [later, true, rupees(16)],
    ])
  })
})

describe('left', () => {
  it('adds up what is left on the live grants, never below zero', async () => {
    const ws = workspace()
    expect(await left(db, ws)).toBe(0n)
    await addGrant(ws, rupees(3), { days: 10 })
    await addGrant(ws, rupees(4), { days: 20 })
    expect(await left(db, ws)).toBe(rupees(7))
  })
})

describe('layerSize', () => {
  it('gives the layer size of the first live grant with allowance left, 512 px with none', async () => {
    const ws = workspace()
    expect(await layerSize(db, ws)).toBe(512)
    const soon = new Date(Date.now() + 10 * 86_400_000)
    const later = new Date(Date.now() + 20 * 86_400_000)
    await giveGrant(db, { workspace: ws, amount: rupees(5), expiresAt: new Date(Date.now() - 1000), layerSize: 1024 })
    const spent = await giveGrant(db, { workspace: ws, amount: rupees(5), expiresAt: soon, layerSize: 512 })
    await giveGrant(db, { workspace: ws, amount: rupees(5), expiresAt: later, layerSize: 1024 })
    expect(await layerSize(db, ws)).toBe(512)
    const job = await addJob(ws)
    await holdOn(ws, job, rupees(5))
    expect((await grantsOf(db, ws)).find((g) => g.id === spent)?.left).toBe(0n)
    expect(await layerSize(db, ws)).toBe(1024)
  })
})

describe('usageShare', () => {
  it('gives the share of the live grants used', async () => {
    const ws = workspace()
    expect(await usageShare(db, ws)).toBe(1)
    await addGrant(ws, rupees(100))
    const job = await addJob(ws)
    await holdOn(ws, job, rupees(25))
    expect(await usageShare(db, ws)).toBe(0.25)
  })
})
