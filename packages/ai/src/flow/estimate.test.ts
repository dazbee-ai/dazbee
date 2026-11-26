// The estimate an AI action shows on hover, against Postgres from Docker Compose.
import { describe, expect, it } from 'vitest'

import { AiEstimateQuery } from '@dazbee/schema'

import { giveGrant } from '../ledger.ts'
import { db, newWorkspace } from '../test-ai.ts'
import { actionHold, estimateAction } from './estimate.ts'

/** A workspace with a fresh gift grant of `amount`, at the usage rate of the day. */
async function workspaceWith(amount: bigint | null): Promise<string> {
  const workspace = newWorkspace()
  if (amount !== null) {
    await giveGrant(db, { workspace, amount, expiresAt: new Date(Date.now() + 86_400_000) })
  }
  return workspace
}

const fastRound = AiEstimateQuery.parse({ action: 'round' })

describe('estimateAction', () => {
  it('gives a Fast round on a fresh gift its hold over the grant, as a whole percent', async () => {
    const hold = await actionHold(db, await workspaceWith(null), fastRound)
    const workspace = await workspaceWith(hold * 25n)
    expect(await estimateAction(db, workspace, fastRound)).toEqual({ share: 4, seconds: 69 + 26 })
  })

  it('says under 1% for a hold below a hundredth of the allowance, and gives no share with none', async () => {
    const hold = await actionHold(db, await workspaceWith(null), fastRound)
    expect((await estimateAction(db, await workspaceWith(hold * 1000n), fastRound)).share).toBe('under-1')
    expect((await estimateAction(db, await workspaceWith(null), fastRound)).share).toBeNull()
  })

  it('sums each job kind’s longest path: a Precise round, a refine, a resize and a layering job', async () => {
    const workspace = await workspaceWith(null)
    const seconds = async (query: unknown) =>
      (await estimateAction(db, workspace, AiEstimateQuery.parse(query))).seconds
    expect(await seconds({ action: 'round', mode: 'precise' })).toBe(49 + 45)
    expect(await seconds({ action: 'try-again', mode: 'fast' })).toBe(26)
    expect(await seconds({ action: 'refine' })).toBe(7 + 117)
    expect(
      await seconds({
        action: 'resize',
        sizes: [
          { width: 1080, height: 1920 },
          { width: 1200, height: 628 },
        ],
      }),
    ).toBe(117)
    expect(await seconds({ action: 'layering' })).toBe(82 + 18 + 14)
  })

  it('holds more for more sizes, and for a brief with pictures', async () => {
    const workspace = await workspaceWith(null)
    const hold = (query: unknown) => actionHold(db, workspace, AiEstimateQuery.parse(query))
    const one = await hold({ action: 'resize', sizes: [{ width: 1080, height: 1920 }] })
    const two = await hold({
      action: 'resize',
      sizes: [
        { width: 1080, height: 1920 },
        { width: 1080, height: 1920 },
      ],
    })
    expect(two).toBeGreaterThan(one)
    expect(await hold({ action: 'round', pictures: 2 })).toBeGreaterThan(await hold({ action: 'round' }))
  })
})
