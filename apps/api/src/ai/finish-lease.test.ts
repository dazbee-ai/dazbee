// The layering finish's routes against Postgres and storage from Docker Compose, with the worker's part played by
// hand: its lease, its end and its split layers.
import { eq, sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { aiJobs } from '@dazbee/db'
import { AiFinishLease, DesignAi } from '@dazbee/schema'

import { authorization, db } from '../test-api.ts'
import {
  addPicture,
  addTeam,
  aiApp,
  ask,
  endJob,
  madePicture,
  makeCall,
  roundRequest,
  start,
  storeOriginal,
  type Team,
} from './test-ai-api.ts'

/** A team whose first draft arrived and is being made editable; the layering job and the frame. */
async function layering(): Promise<{ team: Team; job: string; frame: string }> {
  const team = await addTeam()
  const request = roundRequest(team)
  const round = await start(team, request)
  const picture = await addPicture(team)
  await makeCall(round, 1, { output: madePicture(team, picture) })
  const frame = request.frames[0]?.frameId ?? ''
  await ask(team, team.editor, 'POST', `/designs/${team.design}/ai/frames/${frame}/written`, {
    jobId: round,
    callIndex: 1,
  })
  const job = await start(team, {
    kind: 'layering',
    designId: team.design,
    frames: [{ frameId: frame, pictureAssetId: picture }],
  })
  return { team, job, frame }
}

const claim = (team: Team, job: string, holder: string) =>
  ask(team, team.editor, 'POST', `/ai/jobs/${job}/claim`, { holder })
const finished = (team: Team, job: string, holder: string) =>
  ask(team, team.editor, 'POST', `/ai/jobs/${job}/finished`, { holder })

const FIRST = 'tab-first-1234'
const SECOND = 'tab-second-1234'

describe('POST /brands/:b/ai/jobs/:id/claim', () => {
  it('leases the finish to one tab for 2 minutes, renewable by it, and to another once it lapses', async () => {
    const { team, job } = await layering()
    expect((await claim(team, job, FIRST)).status).toBe(409)
    await endJob(job, 'done')

    const first = await claim(team, job, FIRST)
    expect(first.status).toBe(200)
    const lease = AiFinishLease.parse(first.json)
    expect(lease.holder).toBe(FIRST)
    expect(Date.parse(lease.until) - Date.now()).toBeGreaterThan(110_000)
    expect(Date.parse(lease.until) - Date.now()).toBeLessThanOrEqual(121_000)
    expect((await claim(team, job, SECOND)).status).toBe(409)
    expect((await claim(team, job, FIRST)).status).toBe(200)

    // Two minutes pass without a renewal.
    await db
      .update(aiJobs)
      .set({ finishUntil: sql`now() - interval '1 second'` })
      .where(eq(aiJobs.id, job))
    expect(AiFinishLease.parse((await claim(team, job, SECOND)).json).holder).toBe(SECOND)
    expect((await claim(team, job, FIRST)).status).toBe(409)
  })

  it('answers a job of another brand, or not a layering job, 404', async () => {
    const { team, job } = await layering()
    const stranger = await addTeam()
    expect((await claim(stranger, job, FIRST)).status).toBe(404)
    const round = await start(team, roundRequest(team))
    expect((await claim(team, round, FIRST)).status).toBe(404)
  })
})

describe('POST /brands/:b/ai/jobs/:id/finished', () => {
  it('makes the job’s frames editable and lets the lease go, refused while another tab holds it', async () => {
    const { team, job, frame } = await layering()
    await makeCall(job, 1, { fn: 'layer-split', output: { kind: 'layers', layers: [], gpuSeconds: 17.5 } })
    await endJob(job, 'done')
    await claim(team, job, FIRST)
    expect((await finished(team, job, SECOND)).status).toBe(409)
    expect((await finished(team, job, FIRST)).status).toBe(204)
    expect((await finished(team, job, SECOND)).status).toBe(204)
    const read = DesignAi.parse((await ask(team, team.editor, 'GET', `/designs/${team.design}/ai`)).json)
    expect(read.frames.find((f) => f.frameId === frame)?.state).toBe('editable')
    expect((await claim(team, job, SECOND)).status).toBe(409)
  })
})

describe('a finish where one split failed', () => {
  it('makes editable only the frames whose split was made, the other holding its picture again', async () => {
    const team = await addTeam()
    const request = roundRequest(team)
    const round = await start(team, request)
    const [first, second] = request.frames.map((f) => f.frameId)
    const pictures = [await addPicture(team), await addPicture(team)]
    for (const [n, frame] of [first, second].entries()) {
      await makeCall(round, n + 1, { output: madePicture(team, pictures[n] ?? '') })
      await ask(team, team.editor, 'POST', `/designs/${team.design}/ai/frames/${frame}/written`, {
        jobId: round,
        callIndex: n + 1,
      })
    }
    const job = await start(team, {
      kind: 'layering',
      designId: team.design,
      frames: [
        { frameId: first, pictureAssetId: pictures[0] },
        { frameId: second, pictureAssetId: pictures[1] },
      ],
    })
    await makeCall(job, 1, { fn: 'layer-split', output: { kind: 'layers', layers: [], gpuSeconds: 17.5 } })
    await makeCall(job, 3, { fn: 'layer-split', output: 'failed' })
    await endJob(job, 'done')
    const states = async () =>
      DesignAi.parse((await ask(team, team.editor, 'GET', `/designs/${team.design}/ai`)).json).frames
    expect((await states()).find((f) => f.frameId === second)?.state).toBe('arrived')
    await claim(team, job, FIRST)
    expect((await finished(team, job, FIRST)).status).toBe(204)
    const after = await states()
    expect(after.find((f) => f.frameId === first)?.state).toBe('editable')
    expect(after.find((f) => f.frameId === second)?.state).toBe('arrived')
  })
})

describe('GET /brands/:b/ai/jobs/:id/files/:index', () => {
  it('serves a done layering job’s split layers in call order, and nothing else', async () => {
    const { team, job } = await layering()
    const layers = [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5, 6])]
    const keys = await Promise.all(layers.map((bytes) => storeOriginal(team, bytes)))
    const file = (index: number) => ask(team, team.editor, 'GET', `/ai/jobs/${job}/files/${index}`)
    await makeCall(job, 1, {
      fn: 'layer-split',
      output: {
        kind: 'layers',
        layers: keys.map((key) => ({ key, width: 512, height: 512 })),
        gpuSeconds: 17.5,
      },
    })
    expect((await file(0)).status).toBe(409)
    await endJob(job, 'done')
    const path = `/workspaces/${team.workspace}/brands/${team.brand}/ai/jobs/${job}/files/1`
    const served = await aiApp.request(path, { headers: authorization(team.editor) })
    expect(served.status).toBe(200)
    expect(served.headers.get('content-type')).toBe('image/png')
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(layers[1])
    expect((await file(2)).status).toBe(404)
  })
})
