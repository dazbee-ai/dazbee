// Rounds, more like this and try again with the flow seller, against Postgres from Docker Compose.
import { createHash } from 'node:crypto'

import { asc, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { aiCalls, aiJobs, newId } from '@dazbee/db'
import { type MadePicture, readImageHeader } from '@dazbee/schema'

import { readJob } from '../jobs.ts'
import { DRAFT_PROMPT, PICTURES_SENTENCE } from '../prompts/ads/draft.ts'
import { REFERENCE_AD, REFERENCE_KIND, REFERENCE_READER } from '../prompts/ads/reference.ts'
import { LIKED_DRAFT, ROUND_DIRECTOR } from '../prompts/ads/round-director.ts'
import { ROUND_DIRECTOR_LIGHT } from '../prompts/ads/round-director-light.ts'
import type { SellerRequest } from '../sellers/seller.ts'
import { db, memoryFiles, newSeller } from '../test-ai.ts'
import {
  assetRow,
  chargedCalls,
  flowDeps,
  flowSeller,
  flowWorkspace,
  ledgerOf,
  PLAN,
  planOf,
  roundOf,
  runFlow,
  saveFlow,
} from './test-features.ts'

/** Whether `request` is a picture call. */
const isPicture = (request: SellerRequest) => request.input.kind === 'picture'

/** The prompt of a picture request. */
const promptOf = (request: SellerRequest) => (request.input.kind === 'picture' ? request.input.prompt : '')

/** The pictures a request sends. */
const picturesOf = (request: SellerRequest) => ('pictures' in request.input ? request.input.pictures : [])

/** The plan's ad `n`'s prompt as a draft is sent it, with the pictures sentence. */
const draftPrompt = (n: number) => `A finished, professional square ad, number ${n}.\n\n${PICTURES_SENTENCE}`

describe('a round', () => {
  it('plans, then makes four drafts from the plan with the brief’s pictures, holding and charging every call', async () => {
    const who = await flowWorkspace()
    const seller = await flowSeller(newSeller('round'))
    const round = await roundOf(who)
    const job = await saveFlow(who, { kind: 'round', input: round })
    const files = memoryFiles()
    const ended = await runFlow(job, flowDeps(seller, files))

    expect(ended).toMatchObject({ state: 'done', error: null })
    const [plan, ...drafts] = seller.requests
    expect(plan?.input).toMatchObject({ kind: 'text', instructions: ROUND_DIRECTOR_LIGHT, pictures: round.pictures })
    expect(plan?.input.kind === 'text' && plan.input.prompt).toContain('Harbour Coffee, fresh every morning')
    expect(drafts.map(promptOf).sort()).toEqual([1, 2, 3, 4].map(draftPrompt))
    for (const draft of drafts) {
      expect(draft.input).toMatchObject({ kind: 'picture', pictures: round.pictures, width: 1024, height: 1024 })
    }
    // The hold is the round plan's light preset and four drafts at their presets' first guesses, times 1.25:
    // no seller of ours has made a call of them here.
    const ledger = await ledgerOf(job)
    expect(ledger[0]).toEqual({ kind: 'hold', amount: -15_925_000n, call: null })
    const calls = await db.select().from(aiCalls).where(eq(aiCalls.jobId, job)).orderBy(asc(aiCalls.callIndex))
    expect(calls.map((call) => [call.feature, call.function, call.preset])).toEqual([
      ['round', 'round-plan', 'light-luna'],
      ...Array(4).fill(['round', 'draft', 'gpt-image-medium']),
    ])
    expect((await db.select().from(aiJobs).where(eq(aiJobs.id, job)))[0]).toMatchObject({
      mode: 'fast',
      presets: { 'round-plan': 'light-luna', draft: 'gpt-image-medium' },
    })
    expect(await chargedCalls(job)).toEqual([0, 1, 2, 3, 4])
    expect(await planOf(round.briefId)).toEqual(PLAN)
  })

  it('records each picture as an asset of the brand, tagged ai and named from the brief, in calls[]', async () => {
    const who = await flowWorkspace()
    const seller = await flowSeller(newSeller('assets'))
    const round = await roundOf(who)
    const job = await saveFlow(who, { kind: 'round', input: round })
    const files = memoryFiles()
    await runFlow(job, flowDeps(seller, files))

    const view = await readJob(db, who.workspace, job)
    const pictures = (view?.calls ?? []).flatMap((call): MadePicture[] =>
      call.state === 'done' && call.output.kind === 'pictures' ? call.output.pictures : [],
    )
    expect(view?.calls.map((call) => [call.index, call.state])).toEqual([0, 1, 2, 3, 4].map((i) => [i, 'done']))
    expect(pictures).toHaveLength(4)
    for (const picture of pictures) {
      const asset = await assetRow(picture.assetId ?? '')
      const bytes = files.saved.get(picture.key) ?? new Uint8Array()
      expect(asset).toMatchObject({
        workspaceId: who.workspace,
        brandId: who.brand,
        name: 'Harbour Coffee, fresh every morning',
        tags: ['ai'],
        sha256: createHash('sha256').update(bytes).digest('hex'),
        byteSize: bytes.length,
        ...readImageHeader(bytes),
      })
    }
  })

  it('ends done with three pictures when one draft fails, charging the plan and three drafts and giving back the rest', async () => {
    const who = await flowWorkspace()
    const seller = await flowSeller(newSeller('one-fails'), (r) =>
      isPicture(r) && promptOf(r).includes('number 3') ? 'fail' : undefined,
    )
    const job = await saveFlow(who, { kind: 'round', input: await roundOf(who) })
    const ended = await runFlow(job, flowDeps(seller))

    expect(ended.state).toBe('done')
    const calls = (await readJob(db, who.workspace, job))?.calls ?? []
    expect(calls.filter((call) => call.state === 'done')).toHaveLength(4)
    expect(calls.filter((call) => call.state === 'failed')).toEqual([
      { index: 3, function: 'draft', step: 'draft', state: 'failed', failure: 'not-made' },
    ])
    expect(await chargedCalls(job)).toEqual([0, 1, 2, 4])
    const ledger = await ledgerOf(job)
    const charged = ledger.filter((row) => row.kind === 'charge').reduce((sum, row) => sum + row.amount, 0n)
    expect(ledger.reduce((sum, row) => sum + row.amount, 0n)).toBe(charged)
  })

  it('fails with nothing charged and no draft made when its plan fails', async () => {
    const who = await flowWorkspace()
    const seller = await flowSeller(newSeller('plan-fails'), (r) => (r.input.kind === 'text' ? 'fail' : undefined))
    const round = await roundOf(who)
    const job = await saveFlow(who, { kind: 'round', input: round })
    const ended = await runFlow(job, flowDeps(seller))

    expect(ended.state).toBe('failed')
    expect(seller.requests.filter(isPicture)).toEqual([])
    expect(await chargedCalls(job)).toEqual([])
    expect((await ledgerOf(job)).reduce((sum, row) => sum + row.amount, 0n)).toBe(0n)
    expect(await planOf(round.briefId)).toBeNull()
  })

  it('runs the round plan’s full preset in Precise', async () => {
    const who = await flowWorkspace()
    const seller = await flowSeller(newSeller('precise'))
    const job = await saveFlow(who, { kind: 'round', input: await roundOf(who, { mode: 'precise' }) })
    await runFlow(job, flowDeps(seller))

    expect(seller.requests[0]?.input).toMatchObject({ instructions: ROUND_DIRECTOR })
    const made = (await readJob(db, who.workspace, job))?.calls.map((call) => call.function)
    expect(made).toEqual(['round-plan', ...Array(4).fill('draft')])
    const [plan] = await db.select().from(aiCalls).where(eq(aiCalls.jobId, job)).orderBy(asc(aiCalls.callIndex))
    expect(plan).toMatchObject({
      preset: 'full-terra',
      model: 'gpt-6.1-terra',
      kind: 'text',
      settings: { effort: 'low', tier: 'standard' },
      // The SHA-256 of the full round director.
      promptHash: 'b30db0c9d8e5c26a5791918d9f6fe2e8c15f3e72215880213bb42697c245b61f',
    })
    // The round plan's full preset and four drafts at their first guesses, times 1.25.
    expect((await ledgerOf(job))[0]?.amount).toBe(-17_175_000n)
  })

  it('runs a job saved with no presets on the presets in use when it starts, and keeps them', async () => {
    const who = await flowWorkspace()
    const seller = await flowSeller(newSeller('no-presets'))
    const job = await saveFlow(who, { kind: 'round', input: await roundOf(who, { mode: 'precise' }) })
    // As the last build's API saved it during a deploy.
    await db.update(aiJobs).set({ mode: null, presets: null }).where(eq(aiJobs.id, job))
    expect((await runFlow(job, flowDeps(seller))).state).toBe('done')

    const [row] = await db.select().from(aiJobs).where(eq(aiJobs.id, job))
    expect(row?.presets).toMatchObject({ 'round-plan': 'full-terra', draft: 'gpt-image-medium' })
    const [plan] = await db.select().from(aiCalls).where(eq(aiCalls.jobId, job)).orderBy(asc(aiCalls.callIndex))
    expect(plan?.preset).toBe('full-terra')
  })

  it('fails a job whose saved preset the code doesn’t have before any call, with its whole hold given back', async () => {
    const who = await flowWorkspace()
    const seller = await flowSeller(newSeller('gone-preset'))
    const job = await saveFlow(who, { kind: 'round', input: await roundOf(who) })
    await db
      .update(aiJobs)
      .set({ presets: { 'round-plan': 'gone-preset', draft: 'gpt-image-medium' } })
      .where(eq(aiJobs.id, job))
    const ended = await runFlow(job, flowDeps(seller))

    expect(ended).toMatchObject({ state: 'failed', error: 'the AI function round-plan has no preset gone-preset' })
    expect(seller.requests).toEqual([])
    const ledger = await ledgerOf(job)
    expect(ledger.map((row) => row.kind)).toEqual(['hold', 'give-back'])
    expect(ledger.reduce((sum, row) => sum + row.amount, 0n)).toBe(0n)
  })

  it('reads a reference first and gives it to the planner alone, with its kind', async () => {
    const who = await flowWorkspace()
    const seller = await flowSeller(newSeller('reference'))
    const referenceKey = `workspaces/${who.workspace}/originals/reference`
    const round = await roundOf(who, { referenceKey })
    const job = await saveFlow(who, { kind: 'round', input: round })
    await runFlow(job, flowDeps(seller))

    const [read, plan, ...drafts] = seller.requests
    expect(read?.input).toMatchObject({ kind: 'text', instructions: REFERENCE_READER, pictures: [referenceKey] })
    expect(picturesOf(plan as SellerRequest)).toEqual([referenceKey, ...round.pictures])
    const kindLine = REFERENCE_KIND.replace('{kind}', 'photographic')
    expect(plan?.input.kind === 'text' && plan.input.prompt).toContain(REFERENCE_AD.replace('{kind}', kindLine))
    expect(drafts.flatMap(picturesOf)).not.toContain(referenceKey)
  })

  it('falls back on the plain draft prompt for an ad the plan gave no prompt', async () => {
    const who = await flowWorkspace()
    const plan = { ...PLAN, ads: PLAN.ads.map((ad, i) => (i === 1 ? { ...ad, prompt: ' ' } : ad)) }
    const seller = await flowSeller(newSeller('no-prompt'), (r) =>
      r.input.kind === 'text' ? { kind: 'text', text: JSON.stringify(plan), json: plan } : undefined,
    )
    const job = await saveFlow(who, { kind: 'round', input: await roundOf(who) })
    await runFlow(job, flowDeps(seller))

    const fallback = DRAFT_PROMPT.replace('{shape}', 'square')
      .replace('{brief}', 'Harbour Coffee, fresh every morning\nShow the cup.')
      .replace('{pictures}', `- ${PICTURES_SENTENCE}\n`)
    expect(seller.requests.filter(isPicture).map(promptOf)).toContain(fallback)
  })

  it('runs again after a crash without remaking the calls that ended', async () => {
    const who = await flowWorkspace()
    const crash = new AbortController()
    let pictures = 0
    const seller = await flowSeller(newSeller('crash'), (r) => {
      // The worker dies as the third picture is asked for.
      if (isPicture(r) && ++pictures === 3) crash.abort('taken-back')
      return undefined
    })
    const job = await saveFlow(who, { kind: 'round', input: await roundOf(who) })
    const files = memoryFiles()
    await expect(runFlow(job, flowDeps(seller, files), crash.signal)).rejects.toBe('taken-back')
    const before = seller.requests.length
    const ended = await runFlow(job, flowDeps(seller, files))

    expect(ended.state).toBe('done')
    const again = seller.requests.slice(before)
    expect(again.every(isPicture)).toBe(true)
    expect(again.length).toBeLessThanOrEqual(2)
    expect(await chargedCalls(job)).toEqual([0, 1, 2, 3, 4])
  })
})

describe('more like this', () => {
  it('gives the liked draft to the planner alone, first, with the liked-draft words, and keeps its plan', async () => {
    const who = await flowWorkspace()
    const seller = await flowSeller(newSeller('more'))
    const likedKey = `workspaces/${who.workspace}/originals/liked`
    const round = { ...(await roundOf(who)), likedKey }
    const job = await saveFlow(who, { kind: 'more-like-this', input: round })
    expect((await runFlow(job, flowDeps(seller))).state).toBe('done')

    const [plan, ...drafts] = seller.requests
    expect(picturesOf(plan as SellerRequest)).toEqual([likedKey, ...round.pictures])
    expect(plan?.input.kind === 'text' && plan.input.prompt).toContain(LIKED_DRAFT)
    expect(drafts.flatMap(picturesOf)).not.toContain(likedKey)
    expect(await planOf(round.briefId)).toEqual(PLAN)
  })
})

describe('try again', () => {
  it('makes one draft from the brief’s stored plan, charging only it', async () => {
    const who = await flowWorkspace()
    const seller = await flowSeller(newSeller('again'))
    const round = await roundOf(who)
    await runFlow(await saveFlow(who, { kind: 'round', input: round }), flowDeps(seller))
    const before = seller.requests.length
    const frame = { frameId: newId(), pictureLayerId: newId() }
    const input = { brandId: who.brand, designId: round.designId, briefId: round.briefId, draft: 2, frame }
    const job = await saveFlow(who, { kind: 'try-again', input })
    expect((await runFlow(job, flowDeps(seller))).state).toBe('done')

    expect(seller.requests.slice(before).map(promptOf)).toEqual([draftPrompt(3)])
    expect(await chargedCalls(job)).toEqual([0])
  })

  it('is refused, with nothing held or made, for a brief of another workspace', async () => {
    const who = await flowWorkspace()
    const other = await flowWorkspace()
    const seller = await flowSeller(newSeller('not-ours'))
    const round = await roundOf(other)
    const frame = { frameId: newId(), pictureLayerId: newId() }
    const input = { brandId: who.brand, designId: round.designId, briefId: round.briefId, draft: 0, frame }
    await expect(saveFlow(who, { kind: 'try-again', input })).rejects.toThrow()
    expect(seller.requests).toEqual([])
  })
})
