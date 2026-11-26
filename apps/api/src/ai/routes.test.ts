// The AI flow's routes against Postgres and storage from Docker Compose, with a real pg-boss and the worker's part
// played by hand.
import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { left } from '@dazbee/ai'
import { aiBriefs, aiRefines, assets, brandKits, brands, newId } from '@dazbee/db'
import {
  AiEstimate,
  type AiFrameView,
  AiRefineView,
  DesignAi,
  MyAiJob,
  type RoundInput,
  type RoundPlanAnswer,
} from '@dazbee/schema'

import { db, other, requestOf } from '../test-api.ts'
import {
  addPicture,
  addTeam,
  aiApp,
  ALLOWANCE,
  ask,
  endJob,
  fourFrames,
  jobCount,
  jobRow,
  keyOf,
  madePicture,
  makeCall,
  QUEUE,
  roundRequest,
  start,
  type Team,
} from './test-ai-api.ts'

/** The design's AI frames, jobs and briefs, as the team's Editor reads them. */
async function designAi(team: Team): Promise<DesignAi> {
  const read = await ask(team, team.editor, 'GET', `/designs/${team.design}/ai`)
  expect(read.status).toBe(200)
  return DesignAi.parse(read.json)
}

/** The design's AI frames in the order of `frames`. */
function inOrder(read: DesignAi, frames: { frameId: string }[]): (AiFrameView | undefined)[] {
  return frames.map(({ frameId }) => read.frames.find((f) => f.frameId === frameId))
}

/** The frame `frameId` as the design's AI read gives it. */
async function frameOf(team: Team, frameId: string): Promise<AiFrameView | undefined> {
  return (await designAi(team)).frames.find((f) => f.frameId === frameId)
}

const PLAN: RoundPlanAnswer = {
  brand: 'Warm.',
  ads: (['photographic', 'graphical', 'composite', 'free'] as const).map((kind) => ({
    kind,
    idea: '',
    arrangement: '',
    picture: '',
    prompt: `A ${kind} ad.`,
  })),
}

describe('POST /brands/:b/ai/jobs', () => {
  it('writes a round’s job, its hold, one brief and four AI frames waiting', async () => {
    const team = await addTeam()
    const request = roundRequest(team)
    const started = await ask(team, team.editor, 'POST', '/ai/jobs', request)
    expect(started.status).toBe(201)
    const { job, briefId } = started.json as { job: string; briefId: string }
    expect(await left(db, team.workspace)).toBeLessThan(ALLOWANCE)

    const read = await designAi(team)
    expect(
      inOrder(read, request.frames).map((f) => [f?.frameId, f?.jobId, f?.callIndex, f?.kind, f?.state, f?.briefId]),
    ).toEqual(request.frames.map((f, n) => [f.frameId, job, n + 1, 'draft', 'waiting', briefId]))
    expect(read.jobs.map((j) => [j.id, j.kind, j.state])).toEqual([[job, 'round', 'waiting']])
    expect(read.briefs).toEqual([
      expect.objectContaining({
        id: briefId,
        sectionId: request.sectionId,
        title: 'Harbour Coffee, fresh every morning',
        pictureAssetIds: [team.picture],
        size: { width: 1080, height: 1080 },
        mode: 'fast',
        planned: false,
      }),
    ])
    const row = await jobRow(job)
    expect(row.queue).toBe(QUEUE)
    expect(row.input as RoundInput).toMatchObject({
      brandId: team.brand,
      briefId,
      pictures: [await keyOf(team, team.picture)],
    })
  })

  it('refuses a used-up workspace with used-up, writing nothing', async () => {
    const team = await addTeam({ allowance: 0n })
    const refused = await ask(team, team.editor, 'POST', '/ai/jobs', roundRequest(team))
    expect(refused).toMatchObject({ status: 409, json: { refusal: 'used-up' } })
    expect(await jobCount(team.workspace)).toBe(0)
    expect(await designAi(team)).toEqual({ frames: [], jobs: [], briefs: [] })
  })

  it('tells the planner the brand kit’s picks as brand facts, with the kit logo as a picture', async () => {
    const team = await addTeam()
    const logo = await addPicture(team)
    await db.insert(brandKits).values({
      brandId: team.brand,
      workspaceId: team.workspace,
      colors: [{ token: 'primary', name: 'Navy', value: '#14213D' }],
      fonts: [{ token: 'heading', name: 'Heading', family: 'Lora' }],
      logoAssetId: logo,
      voice: 'Warm and plain.',
    })
    const job = await start(team, roundRequest(team))
    expect((await jobRow(job)).input).toMatchObject({
      brand: { name: 'Harbour Coffee', colors: ['Navy #14213D'], fonts: ['Heading: Lora'], voice: 'Warm and plain.' },
      logoKey: await keyOf(team, logo),
    })
  })

  it('refuses a picture the brand hasn’t, one a model can’t read, and frames that are AI frames already', async () => {
    const team = await addTeam()
    const sibling = `brand-${newId()}`
    await db.insert(brands).values({ id: sibling, workspaceId: team.workspace, name: 'Harbour Tea' })
    const elsewhere = await addPicture({ workspace: team.workspace, brand: sibling })
    const svg = await addPicture(team, 'image/svg+xml')
    for (const picture of [elsewhere, svg]) {
      expect(
        (await ask(team, team.editor, 'POST', '/ai/jobs', roundRequest(team, { pictures: [picture] }))).status,
      ).toBe(400)
    }
    const request = roundRequest(team)
    await start(team, request)
    const again = await ask(team, team.editor, 'POST', '/ai/jobs', { ...request, sectionId: 'section-2' })
    expect(again.status).toBe(409)
    expect(await jobCount(team.workspace)).toBe(1)
  })

  it('draws a design given as the reference to a picture of its cover, kept as a hidden part', async () => {
    const team = await addTeam()
    const job = await start(team, roundRequest(team, { reference: { designId: team.design } }))
    const input = (await jobRow(job)).input as RoundInput
    expect(input.referenceKey).toMatch(new RegExp(`^workspaces/${team.workspace}/originals/[0-9a-f]{64}$`))
    const [part] = await db
      .select()
      .from(assets)
      .where(and(eq(assets.brandId, team.brand), eq(assets.sha256, input.referenceKey?.split('/').at(-1) ?? '')))
    expect(part).toMatchObject({ brandId: team.brand, tags: ['ai-part'], contentType: 'image/png' })
  }, 60_000)

  it('starts more like this with the liked picture, keeping it on the brief', async () => {
    const team = await addTeam()
    const liked = await addPicture(team)
    const request = { ...roundRequest(team), kind: 'more-like-this', likedAssetId: liked }
    const started = await ask(team, team.editor, 'POST', '/ai/jobs', request)
    expect(started.status).toBe(201)
    const { job, briefId } = started.json as { job: string; briefId: string }
    expect((await jobRow(job)).input).toMatchObject({ likedKey: await keyOf(team, liked) })
    const [brief] = await db.select().from(aiBriefs).where(eq(aiBriefs.id, briefId))
    expect(brief?.likedKey).toBe(await keyOf(team, liked))
  })
})

describe('GET /brands/:b/designs/:d/ai', () => {
  it('shows each call’s state and picture as soon as it ends, and a failed draft as failed', async () => {
    const team = await addTeam()
    const request = roundRequest(team)
    const job = await start(team, request)
    await makeCall(job, 0, { fn: 'round-plan', output: { kind: 'text', text: '{}', json: PLAN } })
    const picture = await addPicture(team)
    await makeCall(job, 1, { output: madePicture(team, picture) })
    await makeCall(job, 2, { output: 'failed' })
    await makeCall(job, 3, { output: 'running' })

    const read = await designAi(team)
    const calls = read.jobs[0]?.calls ?? []
    expect(calls.find((c) => c.index === 1)).toMatchObject({ state: 'done', output: madePicture(team, picture) })
    expect(inOrder(read, request.frames).map((f) => f?.state)).toEqual(['waiting', 'failed', 'waiting', 'waiting'])

    await endJob(job, 'done')
    expect(inOrder(await designAi(team), request.frames).map((f) => f?.state)).toEqual([
      'waiting',
      'failed',
      'failed',
      'failed',
    ])
  })
})

describe('POST /brands/:b/designs/:d/ai/frames/:f/written', () => {
  it('marks a made call written, the frame arrived with its picture, once', async () => {
    const team = await addTeam()
    const request = roundRequest(team)
    const job = await start(team, request)
    const frame = request.frames[0]?.frameId ?? ''
    const written = (body: unknown) =>
      ask(team, team.editor, 'POST', `/designs/${team.design}/ai/frames/${frame}/written`, body)
    expect((await written({ jobId: job, callIndex: 1 })).status).toBe(409)
    const picture = await addPicture(team)
    await makeCall(job, 1, { output: madePicture(team, picture) })
    expect((await written({ jobId: job, callIndex: 1 })).status).toBe(204)
    expect((await written({ jobId: job, callIndex: 1 })).status).toBe(204)
    expect(await frameOf(team, frame)).toMatchObject({ state: 'arrived', assetId: picture })
    expect((await written({ jobId: job, callIndex: 2 })).status).toBe(409)
    expect(
      (
        await ask(team, team.editor, 'POST', `/designs/${team.design}/ai/frames/nope/written`, {
          jobId: job,
          callIndex: 1,
        })
      ).status,
    ).toBe(404)
  })
})

describe('try again', () => {
  it('draws a failed draft again from the stored plan, into the same frame, once', async () => {
    const team = await addTeam()
    const request = roundRequest(team)
    const job = await start(team, request)
    await db.update(aiBriefs).set({ plan: PLAN }).where(eq(aiBriefs.designId, team.design))
    const frame = request.frames[2]?.frameId ?? ''
    const tryAgain = () =>
      ask(team, team.editor, 'POST', '/ai/jobs', { kind: 'try-again', designId: team.design, frameId: frame })
    expect((await tryAgain()).status).toBe(409)
    await makeCall(job, 3, { output: 'failed' })
    // Two asks at once start one job.
    const both = await Promise.all([tryAgain(), tryAgain()])
    expect(both.map((answer) => answer.status).sort()).toEqual([201, 409])
    const again = both.find((answer) => answer.status === 201)
    const next = (again?.json as { job: string }).job
    expect((await jobRow(next)).input).toMatchObject({ draft: 2, frame: request.frames[2] })
    expect(await frameOf(team, frame)).toMatchObject({ jobId: next, callIndex: 0, state: 'waiting' })
    expect((await tryAgain()).status).toBe(409)
  })

  it('runs the whole round again into the same frames when its plan failed', async () => {
    const team = await addTeam()
    const request = roundRequest(team)
    const job = await start(team, request)
    await makeCall(job, 0, { fn: 'round-plan', output: 'failed' })
    await endJob(job, 'failed')
    const frame = request.frames[1]?.frameId ?? ''
    const again = await ask(team, team.editor, 'POST', '/ai/jobs', {
      kind: 'try-again',
      designId: team.design,
      frameId: frame,
    })
    expect(again.status).toBe(201)
    const next = (again.json as { job: string }).job
    expect((await jobRow(next)).kind).toBe('round')
    expect(inOrder(await designAi(team), request.frames).map((f) => [f?.jobId, f?.callIndex, f?.state])).toEqual(
      [1, 2, 3, 4].map((n) => [next, n, 'waiting']),
    )
  })
})

describe('refine, resize and layering', () => {
  /** A team with a round whose first frame's picture arrived; the frame and its picture. */
  async function arrived() {
    const team = await addTeam({ layerSize: 1024 })
    const request = roundRequest(team)
    const job = await start(team, request)
    const picture = await addPicture(team)
    await makeCall(job, 1, { output: madePicture(team, picture) })
    const frame = request.frames[0] ?? { frameId: '', pictureLayerId: '' }
    await ask(team, team.editor, 'POST', `/designs/${team.design}/ai/frames/${frame.frameId}/written`, {
      jobId: job,
      callIndex: 1,
    })
    return { team, frame, picture }
  }

  it('refines a frame with a refine row, and refuses another while it runs', async () => {
    const { team, frame, picture } = await arrived()
    const refine = {
      kind: 'refine',
      designId: team.design,
      ...frame,
      pictureAssetId: picture,
      message: 'Make the price bigger',
      size: { width: 1080, height: 1080 },
    }
    const job = await start(team, refine)
    expect((await ask(team, team.editor, 'POST', '/ai/jobs', refine)).status).toBe(409)
    const read = await ask(team, team.editor, 'GET', `/designs/${team.design}/ai/frames/${frame.frameId}/refines`)
    const [only] = AiRefineView.array().parse(read.json)
    expect(only).toMatchObject({ message: 'Make the price bigger', resultAssetId: null, job: { id: job } })

    const version = await addPicture(team)
    await makeCall(job, 0, {
      fn: 'refine-plan',
      output: { kind: 'text', text: '', json: { instruction: 'x', summary: 'Bigger price', pinned_only: false } },
    })
    await makeCall(job, 1, { fn: 'refine-edit', output: madePicture(team, version) })
    const written = await ask(team, team.editor, 'POST', `/designs/${team.design}/ai/frames/${frame.frameId}/written`, {
      jobId: job,
      callIndex: 1,
    })
    expect(written.status).toBe(204)
    const [row] = await db.select().from(aiRefines).where(eq(aiRefines.jobId, job))
    expect(row).toMatchObject({ resultAssetId: version, summary: 'Bigger price' })
    expect(await frameOf(team, frame.frameId)).toMatchObject({ state: 'arrived', assetId: version })
  })

  it('redraws a frame at each size into new AI frames of the size kind', async () => {
    const { team, frame, picture } = await arrived()
    const sizes = [
      { frameId: 'story', pictureLayerId: 'story-picture', width: 1080, height: 1920 },
      { frameId: 'wide', pictureLayerId: 'wide-picture', width: 1200, height: 628 },
    ]
    const job = await start(team, {
      kind: 'resize',
      designId: team.design,
      frameId: frame.frameId,
      pictureAssetId: picture,
      sectionId: 'sizes',
      sizes,
    })
    const frames = (await designAi(team)).frames
      .filter((f) => f.jobId === job)
      .sort((a, b) => a.callIndex - b.callIndex)
    expect(frames.map((f) => [f.frameId, f.kind, f.callIndex])).toEqual([
      ['story', 'size', 0],
      ['wide', 'size', 1],
    ])
  })

  it('makes a frame editable at the layer size of a 1024 gift', async () => {
    const { team, frame, picture } = await arrived()
    const job = await start(team, {
      kind: 'layering',
      designId: team.design,
      frames: [{ frameId: frame.frameId, pictureAssetId: picture }],
    })
    expect((await jobRow(job)).input).toMatchObject({ size: 1024 })
    expect(await frameOf(team, frame.frameId)).toMatchObject({ jobId: job, callIndex: 1, state: 'layering' })
    await endJob(job, 'failed')
    expect(await frameOf(team, frame.frameId)).toMatchObject({ state: 'arrived' })
  })
})

describe('GET /brands/:b/ai/estimate', () => {
  it('gives an action’s share and seconds, and refuses a query it can’t read', async () => {
    const team = await addTeam()
    const read = await ask(team, team.editor, 'GET', '/ai/estimate?action=round&mode=fast&sizes=1080x1080')
    expect(read.status).toBe(200)
    expect(AiEstimate.parse(read.json).seconds).toBe(10 + 28)
    expect((await ask(team, team.editor, 'GET', '/ai/estimate?action=dance')).status).toBe(400)
    expect((await ask(team, team.editor, 'GET', '/ai/estimate?action=resize&sizes=wide')).status).toBe(400)
  })
})

describe('GET /me/ai/jobs', () => {
  it('gives the person’s running jobs with their design’s name, and no one else’s', async () => {
    const team = await addTeam()
    const job = await start(team, roundRequest(team))
    const mine = MyAiJob.array().parse((await requestOf(aiApp, team.editor, 'GET', '/me/ai/jobs?running')).json)
    expect(mine).toEqual([
      expect.objectContaining({ id: job, kind: 'round', designId: team.design, designName: 'Coffee', made: 0 }),
    ])
    expect((await requestOf(aiApp, team.reviewer, 'GET', '/me/ai/jobs?running')).json).toEqual([])
  })
})

describe('who may use the AI routes', () => {
  it('refuses a Reviewer every AI route, and answers an Editor of another workspace 404', async () => {
    const team = await addTeam()
    const job = await start(team, roundRequest(team))
    const routes: [string, string, unknown?][] = [
      ['POST', '/ai/jobs', roundRequest(team, { frames: fourFrames() })],
      ['GET', '/ai/estimate?action=round'],
      ['GET', `/designs/${team.design}/ai`],
      ['GET', `/designs/${team.design}/ai/frames/f/refines`],
      ['POST', `/designs/${team.design}/ai/frames/f/written`, { jobId: job, callIndex: 1 }],
      ['POST', `/ai/jobs/${job}/claim`, { holder: 'tab-12345678' }],
      ['POST', `/ai/jobs/${job}/finished`, { holder: 'tab-12345678' }],
      ['GET', `/ai/jobs/${job}/files/0`],
    ]
    for (const [method, path, body] of routes) {
      expect((await ask(team, team.reviewer, method, path, body)).status, `${method} ${path}`).toBe(403)
      const outsider = await requestOf(
        aiApp,
        'b',
        method,
        `/workspaces/${team.workspace}/brands/${team.brand}${path}`,
        body,
      )
      expect(outsider.status, `${method} ${path}`).toBe(404)
      const ownBrand = await requestOf(aiApp, 'b', method, `/workspaces/${other.id}/brands/${team.brand}${path}`, body)
      expect(ownBrand.status, `${method} ${path}`).toBe(404)
    }
    expect(await jobCount(team.workspace)).toBe(1)
  })
})
