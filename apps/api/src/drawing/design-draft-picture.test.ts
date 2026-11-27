// A design's picture and cover while its cover frame waits for an AI draft no tab has written, through their routes,
// against Postgres and storage from Docker Compose (`docker compose up -d --wait postgres storage`).
import { describe, expect, it } from 'vitest'

import { briefDesignOf, DesignCover, DesignSummary, DesignThumbnail, planRound, readImageHeader } from '@dazbee/schema'

import {
  addPicture,
  addTeam,
  ask,
  keyOf,
  madePicture,
  makeCall,
  roundRequest,
  start,
  type Team,
} from '../ai/test-ai-api.ts'
import { storage } from '../test-api.ts'
import { png } from '../test-files.ts'

/** A design of the team holding one brief, as the brand home makes it, with its round started: the design, its frames and the job. */
async function briefed(team: Team) {
  let made = 0
  const plan = planRound(() => `f${++made}-${team.design}`)
  const content = briefDesignOf(
    { designId: 'ignored', name: 'Coffee' },
    { ...plan, words: 'Harbour Coffee', size: { width: 1080, height: 1080 }, draftName: (n) => `Draft ${n + 1}` },
  )
  const { json } = await ask(team, team.editor, 'POST', '/designs', { name: 'Coffee', content })
  const design = DesignSummary.parse(json).id
  const job = await start(
    team,
    roundRequest(team, { designId: design, sectionId: plan.sectionId, frames: plan.frames }),
  )
  return { design, frames: plan.frames.map((frame) => frame.frameId), job }
}

/** A picture of the team's brand whose bytes are in storage; its asset id. */
async function storedPicture(team: Team, seed: string): Promise<string> {
  const id = await addPicture(team)
  await storage.put(await keyOf(team, id), png(64, 64, seed), 'image/png')
  return id
}

describe('a design’s picture while a draft waits for a tab', { timeout: 30_000 }, () => {
  const coverOf = async (team: Team, design: string) =>
    DesignCover.parse((await ask(team, team.editor, 'GET', `/designs/${design}/cover`)).json)
  const pictureOf = async (team: Team, design: string) => {
    const link = DesignThumbnail.parse((await ask(team, team.editor, 'GET', `/designs/${design}/thumbnail`)).json)
    return { key: new URL(link.url).pathname, bytes: new Uint8Array(await (await fetch(link.url)).arrayBuffer()) }
  }

  it('shows the cover frame’s draft once it is made, at an address of its own, until a tab has written it', async () => {
    const team = await addTeam()
    const { design, frames, job } = await briefed(team)
    expect(await coverOf(team, design)).toEqual({ width: 1080, height: 1080 })
    const waiting = await pictureOf(team, design)

    const picture = await storedPicture(team, 'draft-1')
    await makeCall(job, 1, { output: madePicture(team, picture) })
    expect(await coverOf(team, design)).toEqual({ width: 1080, height: 1080, draftAssetId: picture })
    const shown = await pictureOf(team, design)
    expect(shown.key).not.toBe(waiting.key)
    expect(readImageHeader(shown.bytes)).toEqual({ contentType: 'image/png', width: 640, height: 640 })
    expect(shown.bytes).not.toEqual(waiting.bytes)
    // Asked again, the same stored picture.
    expect((await pictureOf(team, design)).key).toBe(shown.key)

    // The tab's write marks the call written: the design's own picture is shown from then on.
    const written = await ask(team, team.editor, 'POST', `/designs/${design}/ai/frames/${frames[0]}/written`, {
      jobId: job,
      callIndex: 1,
    })
    expect(written.status).toBe(204)
    expect(await coverOf(team, design)).toEqual({ width: 1080, height: 1080 })
    expect((await pictureOf(team, design)).key).toBe(waiting.key)
  })

  it('shows the first draft made while the cover frame’s own is still coming', async () => {
    const team = await addTeam()
    const { design, job } = await briefed(team)
    const third = await storedPicture(team, 'draft-3')
    const second = await storedPicture(team, 'draft-2')
    await makeCall(job, 3, { output: madePicture(team, third) })
    await makeCall(job, 2, { output: madePicture(team, second) })
    expect((await coverOf(team, design)).draftAssetId).toBe(second)
    const first = await storedPicture(team, 'draft-1')
    await makeCall(job, 1, { output: madePicture(team, first) })
    expect((await coverOf(team, design)).draftAssetId).toBe(first)
  })

  it('shows no draft in a design whose cover frame is no AI frame', async () => {
    const team = await addTeam()
    const job = await start(team, roundRequest(team))
    await makeCall(job, 1, { output: madePicture(team, await storedPicture(team, 'draft-1')) })
    // The team's design has a blank frame of its own, which is its cover.
    expect((await coverOf(team, team.design)).draftAssetId).toBeUndefined()
  })
})
