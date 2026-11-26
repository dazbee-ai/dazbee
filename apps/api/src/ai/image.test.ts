// Make an image through the AI routes, against Postgres and storage from Docker Compose, with a real pg-boss and
// the worker's part played by hand: a job on a brand and no design.
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { defaultPreset, left, presetNumbers, presetOf } from '@dazbee/ai'
import { aiFrames, aiLedger } from '@dazbee/db'
import { AiEstimate, MyAiJob } from '@dazbee/schema'

import { db, requestOf } from '../test-api.ts'
import {
  addPicture,
  addTeam,
  aiApp,
  ALLOWANCE,
  ask,
  endJob,
  jobCount,
  jobRow,
  madePicture,
  makeCall,
  QUEUE,
  start,
  type Team,
} from './test-ai-api.ts'

const SKY = { kind: 'image', words: '  A soft sunrise sky\nover hills  ', ratio: 'wide' }

/** The person's own jobs, as the team's Editor reads them. */
async function mine(team: Team): Promise<MyAiJob[]> {
  return MyAiJob.array().parse((await requestOf(aiApp, team.editor, 'GET', '/me/ai/jobs')).json)
}

describe('an image job', () => {
  it('is saved on the brand with its words and ratio, holding its preset’s cost with the margin, on no design', async () => {
    const team = await addTeam()
    const started = await ask(team, team.editor, 'POST', '/ai/jobs', SKY)
    expect(started).toMatchObject({ status: 201, json: { briefId: null } })
    const { job } = started.json as { job: string }

    const row = await jobRow(job)
    expect(row).toMatchObject({
      kind: 'image',
      queue: QUEUE,
      input: { brandId: team.brand, words: 'A soft sunrise sky\nover hills', ratio: 'wide' },
      presets: { image: defaultPreset('image') },
    })
    const preset = presetOf('image', defaultPreset('image'))
    if (!preset) throw new Error('the image function has no preset')
    const { cost } = await presetNumbers(db, 'image', defaultPreset('image'), preset)
    const held = await db.select().from(aiLedger).where(eq(aiLedger.jobId, job))
    expect(held.map((entry) => [entry.kind, entry.amount])).toEqual([['hold', -((cost * 5n + 3n) / 4n)]])
    expect(await left(db, team.workspace)).toBeLessThan(ALLOWANCE)
    // It fills no frame of any design.
    expect(await db.select().from(aiFrames).where(eq(aiFrames.jobId, job))).toEqual([])
    expect(await mine(team)).toEqual([
      expect.objectContaining({
        id: job,
        kind: 'image',
        brandId: team.brand,
        designId: null,
        designName: null,
        image: { words: 'A soft sunrise sky\nover hills', ratio: 'wide', assetId: null },
      }),
    ])
  })

  it('shows its image once made, and its words and ratio with no image when it didn’t come out', async () => {
    const team = await addTeam()
    const made = await start(team, SKY)
    const picture = await addPicture(team)
    await makeCall(made, 0, { fn: 'image', output: madePicture(team, picture) })
    await endJob(made, 'done')
    const failed = await start(team, { kind: 'image', words: 'A beach', ratio: 'tall' })
    await makeCall(failed, 0, { fn: 'image', output: 'failed' })
    await endJob(failed, 'failed')

    const jobs = await mine(team)
    expect(jobs.find((job) => job.id === made)).toMatchObject({
      state: 'done',
      made: 1,
      image: { words: 'A soft sunrise sky\nover hills', ratio: 'wide', assetId: picture },
    })
    expect(jobs.find((job) => job.id === failed)).toMatchObject({
      state: 'failed',
      failed: 1,
      designId: null,
      image: { words: 'A beach', ratio: 'tall', assetId: null },
    })
    // A job on a design carries no image.
    expect(JSON.stringify(jobs)).not.toMatch(/muse|meta|zenmux|openrouter/i)
  })

  it('is refused to a Reviewer, to a used-up workspace and for words or a ratio it can’t read, writing nothing', async () => {
    const team = await addTeam()
    expect((await ask(team, team.reviewer, 'POST', '/ai/jobs', SKY)).status).toBe(403)
    for (const bad of [
      { ...SKY, words: '   ' },
      { ...SKY, words: 'a'.repeat(2001) },
      { ...SKY, ratio: 'round' },
    ]) {
      expect((await ask(team, team.editor, 'POST', '/ai/jobs', bad)).status).toBe(400)
    }
    expect(await jobCount(team.workspace)).toBe(0)

    const usedUp = await addTeam({ allowance: 0n })
    expect(await ask(usedUp, usedUp.editor, 'POST', '/ai/jobs', SKY)).toMatchObject({
      status: 409,
      json: { refusal: 'used-up' },
    })
    expect(await jobCount(usedUp.workspace)).toBe(0)
  })

  it('has an estimate of its preset’s seconds that names no model, seller or preset', async () => {
    const team = await addTeam()
    const read = await ask(team, team.editor, 'GET', '/ai/estimate?action=image')
    expect(read.status).toBe(200)
    const preset = presetOf('image', defaultPreset('image'))
    if (!preset) throw new Error('the image function has no preset')
    expect(AiEstimate.parse(read.json).seconds).toBe(
      (await presetNumbers(db, 'image', defaultPreset('image'), preset)).seconds,
    )
    expect(Object.keys(read.json as object).sort()).toEqual(['seconds', 'share'])
    expect((await ask(team, team.reviewer, 'GET', '/ai/estimate?action=image')).status).toBe(403)
  })
})
