// Fixtures for the AI flow's route tests, against Postgres and storage from Docker Compose: the API made with a real
// pg-boss that sends flow jobs to a queue of their own, a team of its own (a workspace with a brand, an Editor, a
// Reviewer, a design, pictures and a grant), and the worker's part played by hand: a call's try written to the call
// log, its output kept, and a job ended. Imported by tests only.
import { createHash } from 'node:crypto'

import { and, eq } from 'drizzle-orm'
import { PgBoss } from 'pg-boss'
import { afterAll } from 'vitest'

import { ensureQueue, giveGrant } from '@dazbee/ai'
import { aiCalls, aiJobs, assets, brands, newId } from '@dazbee/db'
import type { CallOutput, LayerSplitSize } from '@dazbee/schema'
import { originalKey } from '@dazbee/storage'

import { createApp } from '../app.ts'
import { addPerson, addWorkspace, appSettings, db, requestOf, storage } from '../test-api.ts'
import { DATABASE_URL } from '../test-database.ts'
import { createDesign } from '../workspace/designs.ts'

/** A team of its own: the workspace, its brand, an Editor and a Reviewer as callers, a design and a picture. */
export interface Team {
  workspace: string
  brand: string
  editor: string
  reviewer: string
  design: string
  picture: string
}

/** ₹100 of allowance, in millionths. */
export const ALLOWANCE = 100_000_000n

/**
 * The queue the tests' flow jobs are sent to: not `ai-flow`, which a worker running on this database (Docker Compose
 * starts one) takes jobs from and sweeps.
 */
export const QUEUE = `ai-flow-${newId()}`

const boss = new PgBoss({ connectionString: DATABASE_URL, max: 2, supervise: false, schedule: false })
await boss.start()
await ensureQueue(boss, QUEUE)
afterAll(() => boss.stop({ graceful: false }))

/** The API, able to start AI jobs, which it sends to `QUEUE`. */
export const aiApp = createApp({ ...appSettings, boss, flowQueue: QUEUE })

/** Asks the AI app as `as` at `path` under the team's brand. */
export const ask = (team: Team, as: string, method: string, path: string, body?: unknown) =>
  requestOf(aiApp, as, method, `/workspaces/${team.workspace}/brands/${team.brand}${path}`, body)

/** A team with a grant of `allowance` (none for 0n) at `layerSize`. */
export async function addTeam({
  allowance = ALLOWANCE,
  layerSize = 512,
}: { allowance?: bigint; layerSize?: LayerSplitSize } = {}): Promise<Team> {
  const { id: workspace } = await addWorkspace('AI team')
  const brand = `brand-${newId()}`
  await db.insert(brands).values({ id: brand, workspaceId: workspace, name: 'Harbour Coffee' })
  const editor = await addPerson([[workspace, 'editor']])
  const reviewer = await addPerson([[workspace, 'reviewer']])
  if (allowance > 0n)
    await giveGrant(db, { workspace, amount: allowance, expiresAt: new Date(Date.now() + 86_400_000), layerSize })
  const design = await createDesign(db, workspace, brand, 'Coffee')
  const team = { workspace, brand, editor: editor.as, reviewer: reviewer.as, design: design.id, picture: '' }
  return { ...team, picture: await addPicture(team) }
}

/** Records a picture of the team's brand, stored nowhere; its asset id. */
export async function addPicture(
  team: Pick<Team, 'workspace' | 'brand'>,
  contentType: 'image/png' | 'image/svg+xml' = 'image/png',
): Promise<string> {
  const id = newId()
  await db.insert(assets).values({
    id,
    workspaceId: team.workspace,
    brandId: team.brand,
    sha256: createHash('sha256').update(id).digest('hex'),
    contentType,
    byteSize: 10,
    width: 1080,
    height: 1080,
  })
  return id
}

/** The key of the workspace original of asset `id`. */
export async function keyOf(team: Team, id: string): Promise<string> {
  const [row] = await db.select({ sha256: assets.sha256 }).from(assets).where(eq(assets.id, id))
  return originalKey(team.workspace, row?.sha256 ?? '')
}

/** Four new frames, each with its picture layer. */
export const fourFrames = () =>
  Array.from({ length: 4 }, () => ({ frameId: `frame-${newId()}`, pictureLayerId: `layer-${newId()}` }))

/** A Fast square round of the team's design from a short brief with its picture. */
export function roundRequest(team: Team, change: Record<string, unknown> = {}) {
  return {
    kind: 'round',
    designId: team.design,
    sectionId: `section-${newId()}`,
    frames: fourFrames(),
    words: 'Harbour Coffee, fresh every morning\nShow the cup.',
    pictures: [team.picture],
    size: { width: 1080, height: 1080 },
    mode: 'fast',
    ...change,
  }
}

/** Starts `body` as the team's Editor; the job's id. */
export async function start(team: Team, body: unknown): Promise<string> {
  const started = await ask(team, team.editor, 'POST', '/ai/jobs', body)
  if (started.status !== 201) throw new Error(`not started: ${JSON.stringify(started.json)}`)
  return (started.json as { job: string }).job
}

/** The job's saved row. */
export async function jobRow(job: string) {
  const [row] = await db.select().from(aiJobs).where(eq(aiJobs.id, job))
  if (!row) throw new Error(`no job ${job}`)
  return row
}

/** Plays the worker making call `index` of `job`: its try in the call log and, once made, its output kept. */
export async function makeCall(
  job: string,
  index: number,
  { step = 'flow.draft-fast', output }: { step?: string; output: CallOutput | 'failed' | 'running' },
): Promise<void> {
  const row = await jobRow(job)
  const state = output === 'failed' ? 'failed' : output === 'running' ? 'running' : 'done'
  await db.insert(aiCalls).values({
    id: newId(),
    jobId: job,
    workspaceId: row.workspaceId,
    callIndex: index,
    try: 1,
    attempt: 1,
    step,
    model: 'test-model',
    seller: 'test-seller',
    state,
  })
  if (typeof output === 'object') {
    await db
      .update(aiJobs)
      .set({ state: 'running', callOutputs: { ...row.callOutputs, [String(index)]: output } })
      .where(eq(aiJobs.id, job))
  }
}

/** A picture call's output: one picture, asset `assetId`. */
export const madePicture = (team: Team, assetId: string): CallOutput => ({
  kind: 'pictures',
  pictures: [{ key: originalKey(team.workspace, assetId), width: 1024, height: 1024, assetId }],
})

/** Plays the worker ending `job` as `state`. */
export async function endJob(job: string, state: 'done' | 'failed'): Promise<void> {
  await db
    .update(aiJobs)
    .set({ state, endedAt: new Date(), ...(state === 'failed' ? { error: 'test' } : {}) })
    .where(eq(aiJobs.id, job))
}

/** Stores `bytes` as a workspace original of the team; its key. */
export async function storeOriginal(team: Team, bytes: Uint8Array): Promise<string> {
  const key = originalKey(team.workspace, createHash('sha256').update(bytes).digest('hex'))
  await storage.put(key, bytes, 'image/png')
  return key
}

/** How many AI jobs the workspace has. */
export async function jobCount(workspace: string): Promise<number> {
  return (
    await db
      .select({ id: aiJobs.id })
      .from(aiJobs)
      .where(and(eq(aiJobs.workspaceId, workspace)))
  ).length
}
