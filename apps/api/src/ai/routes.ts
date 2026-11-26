// The AI flow's routes under a brand, for members who may use AI (never a Reviewer): starting a job of any flow job
// kind on a design, the design's AI frames with their jobs and briefs, a frame's refines, a call marked written
// into its frame, the layering finish's lease, its end and its split layers, and the estimate an AI action shows.
// Outside a workspace, the person's own running and just-ended jobs.
import { type Context, Hono } from 'hono'
import type { PgBoss } from 'pg-boss'

import { estimateAction } from '@dazbee/ai'
import type { Db } from '@dazbee/db'
import {
  AiEstimateQuery,
  AiFinishHolder,
  AiFrameWritten,
  type AiJobRefusal,
  type AiJobRefused,
  type AiJobStarted,
  readSizes,
  StartAiJob,
} from '@dazbee/schema'
import type { Storage } from '@dazbee/storage'

import { body, type Env, error, issuesOf, requireWriter } from '../http.ts'
import { findDesign } from '../workspace/designs.ts'
import { designAi, frameRefines, markWritten, type Written } from './ai-frames.ts'
import { claimFinish, endFinish, type FinishRefusal, layeringFile } from './finish-lease.ts'
import { startFlowJob } from './flow.ts'
import { myAiJobs } from './my-jobs.ts'
import { StartRefused } from './start-job.ts'

const BRAND = '/brands/:brandId'
const DESIGN = `${BRAND}/designs/:designId/ai`
const JOB = `${BRAND}/ai/jobs/:jobId`

/** What each refusal of the layering finish answers. */
const FINISH_REFUSED: Record<FinishRefusal, [string, 404 | 409]> = {
  'no-job': ['No such layering job', 404],
  'not-done': ['Its layers aren’t made yet', 409],
  finished: ['It is finished already', 409],
  held: ['Another tab is finishing it', 409],
}

/** What each refusal to save a job answers. */
const SAVE_REFUSED: Record<AiJobRefusal, [string, 403 | 409 | 503]> = {
  'not-allowed': ['Only an Owner, Admin or Editor can use AI', 403],
  'used-up': ['This month’s AI is used up', 409],
  stopped: ['AI is paused for today. Try again tomorrow', 503],
}

/** What each refusal to mark a call written answers. */
const WRITTEN_REFUSED: Record<Exclude<Written, 'written'>, [string, 404 | 409]> = {
  'no-frame': ['That frame isn’t an AI frame of this design', 404],
  'not-made': ['That picture isn’t made yet', 409],
  'not-its-call': ['That call doesn’t fill this frame', 409],
}

export function aiRoutes({ db, storage, boss }: { db: Db; storage: Storage; boss: PgBoss | null }): Hono<Env> {
  const app = new Hono<Env>()

  /** The route's design, in the membership's workspace and the route's brand; null for none. */
  const designOf = (c: Context<Env>) =>
    findDesign(db, c.var.membership.workspaceId, c.var.brand.id, c.req.param('designId') ?? '')
  /** The route's layering job. */
  const jobOf = (c: Context<Env>) => ({
    workspace: c.var.membership.workspaceId,
    brand: c.var.brand.id,
    job: c.req.param('jobId') ?? '',
  })

  // 201 with the job; 403, 409 or 503 with why saving it was refused, nothing written.
  app.post(`${BRAND}/ai/jobs`, requireWriter, async (c) => {
    if (!boss) return c.json(error('AI jobs can’t be started here'), 503)
    const input = await body(c.req.raw, StartAiJob)
    if (input instanceof Response) return input
    const starter = { workspace: c.var.membership.workspaceId, brand: c.var.brand, member: c.var.session.userId }
    try {
      const started = await startFlowJob({ db, storage, boss }, starter, input)
      if (started.ok) return c.json({ job: started.job, briefId: started.briefId } satisfies AiJobStarted, 201)
      const [message, status] = SAVE_REFUSED[started.refusal]
      return c.json({ ...error(message), refusal: started.refusal } satisfies AiJobRefused, status)
    } catch (refused) {
      if (refused instanceof StartRefused) return c.json(error(refused.message), refused.status)
      throw refused
    }
  })

  app.get(`${BRAND}/ai/estimate`, requireWriter, async (c) => {
    const sizes = c.req.query('sizes')
    const read = sizes === undefined ? undefined : readSizes(sizes)
    if (read === null) return c.json(error('Give sizes as 1080x1080,1080x1920'), 400)
    const query = AiEstimateQuery.safeParse({
      action: c.req.query('action'),
      mode: c.req.query('mode'),
      sizes: read,
      pictures: c.req.query('pictures'),
    })
    if (!query.success) return c.json(error(issuesOf(query.error, 'query')), 400)
    return c.json(await estimateAction(db, c.var.membership.workspaceId, query.data))
  })

  app.post(`${JOB}/claim`, requireWriter, async (c) => {
    const input = await body(c.req.raw, AiFinishHolder)
    if (input instanceof Response) return input
    const lease = await claimFinish(db, jobOf(c), input.holder)
    if (typeof lease === 'string') return finishRefused(c, lease)
    return c.json(lease)
  })

  app.post(`${JOB}/finished`, requireWriter, async (c) => {
    const input = await body(c.req.raw, AiFinishHolder)
    if (input instanceof Response) return input
    const ended = await endFinish(db, jobOf(c), input.holder)
    return ended === 'ended' ? c.body(null, 204) : finishRefused(c, ended)
  })

  app.get(`${JOB}/files/:index`, requireWriter, async (c) => {
    const index = Number(c.req.param('index'))
    if (!Number.isInteger(index) || index < 0) return c.json(error('No such file'), 404)
    const file = await layeringFile(db, storage, jobOf(c), index)
    if (typeof file === 'string') return finishRefused(c, file)
    if (!file) return c.json(error('No such file'), 404)
    return c.body(file.slice(), 200, {
      'content-type': 'image/png',
      'cache-control': 'private, max-age=31536000, immutable',
    })
  })

  app.get(DESIGN, requireWriter, async (c) => {
    const design = await designOf(c)
    if (!design) return c.json(error('No such design'), 404)
    return c.json(await designAi(db, c.var.membership.workspaceId, c.var.brand.id, design.id))
  })

  app.get(`${DESIGN}/frames/:frameId/refines`, requireWriter, async (c) => {
    const design = await designOf(c)
    if (!design) return c.json(error('No such design'), 404)
    const { workspaceId } = c.var.membership
    return c.json(await frameRefines(db, workspaceId, c.var.brand.id, design.id, c.req.param('frameId')))
  })

  // 204 once the call is marked written; 409 for a call not made yet or not the frame's.
  app.post(`${DESIGN}/frames/:frameId/written`, requireWriter, async (c) => {
    const design = await designOf(c)
    if (!design) return c.json(error('No such design'), 404)
    const input = await body(c.req.raw, AiFrameWritten)
    if (input instanceof Response) return input
    const written = await markWritten(db, c.var.membership.workspaceId, design.id, c.req.param('frameId'), input)
    if (written === 'written') return c.body(null, 204)
    const [message, status] = WRITTEN_REFUSED[written]
    return c.json(error(message), status)
  })

  return app
}

/** The person's own running and just-ended flow jobs, under /me. */
export function myAiJobRoutes({ db }: { db: Db }): Hono<Env> {
  const app = new Hono<Env>()
  app.get('/me/ai/jobs', async (c) => c.json(await myAiJobs(db, c.var.session.userId)))
  return app
}

/** The answer to a refused layering finish. */
function finishRefused(c: Context<Env>, refusal: FinishRefusal) {
  const [message, status] = FINISH_REFUSED[refusal]
  return c.json(error(message), status)
}
