// Fixtures for the flow's job tests, against Postgres from Docker Compose and a real pg-boss: a workspace with a
// brand, a member and a grant; a test seller that answers each of the flow's calls as its prompt asks, priced
// for every model the flow's steps run; and a job saved, run once and ended, as the worker does. Imported by
// tests only.
import { eq } from 'drizzle-orm'
import { PgBoss } from 'pg-boss'
import { afterAll } from 'vitest'

import {
  aiBriefs,
  aiCalls,
  aiJobs,
  aiLedger,
  assets,
  brands,
  designs,
  memberships,
  newId,
  users,
  workspaces,
} from '@dazbee/db'
import {
  AI_FUNCTIONS,
  type CallInput,
  type FlowJobInput,
  type LayerPlanAnswer,
  type RoundInput,
  type RoundPlanAnswer,
  SCHEMA_VERSION,
  type UsageUnit,
} from '@dazbee/schema'

import { aiFunctionDef } from '../functions/ai-function.ts'
import { endJob, ensureQueue, saveJob, startAttempt } from '../jobs.ts'
import { giveGrant } from '../ledger.ts'
import { PLANNER_PROMPT } from '../prompts/ads/layer-planner.ts'
import { READING_PROMPT } from '../prompts/ads/reading.ts'
import { REFERENCE_READER } from '../prompts/ads/reference.ts'
import { REFINE_EDITOR } from '../prompts/ads/refine-editor.ts'
import { type SellerAdapter, SellerError, type SellerOutput, type SellerRequest, useSeller } from '../sellers/seller.ts'
import { addPrices, db, memoryFiles, pngOf, RUPEE } from '../test-ai.ts'
import { DATABASE_URL } from '../test-database.ts'
import { type FlowDeps, runFlowJob } from './run.ts'

/** A test workspace: its id, its brand and the member who starts its jobs. */
export interface FlowWorkspace {
  workspace: string
  brand: string
  member: string
}

/** What the flow seller does with a call: answers it, or fails it as a seller refusing it would. */
export type FlowAnswer = SellerOutput | 'fail'

/** The flow seller: an adapter, and every request it was sent. */
export interface FlowSeller extends SellerAdapter {
  requests: SellerRequest[]
}

/** The allowance each test workspace is given: ₹100. */
export const ALLOWANCE = 100n * RUPEE

/** A round plan of four ads, each prompt naming its ad's number. */
export const PLAN: RoundPlanAnswer = {
  brand: 'Calm and warm. Facts: "Harbour Coffee"',
  ads: (['photographic', 'graphical', 'composite', 'free'] as const).map((kind, i) => ({
    kind,
    idea: `Idea ${i + 1}.`,
    arrangement: 'The cup at the left.',
    picture: 'The cup.',
    prompt: `A finished, professional square ad, number ${i + 1}.`,
  })),
}

/** A layer plan with one text element and a backdrop. */
export const LAYER_PLAN: LayerPlanAnswer = {
  ad_type: 'graphical',
  elements: [
    {
      id: 't1',
      kind: 'text',
      name: 'Headline',
      content: 'Fresh coffee',
      text_lines: ['Fresh coffee'],
      box: { x_min: 100, y_min: 80, x_max: 900, y_max: 200 },
      shadow: 'none',
      group: null,
      ming_layer: 1,
    },
    {
      id: 'b1',
      kind: 'background',
      name: 'Backdrop',
      content: 'Cream',
      text_lines: [],
      box: { x_min: 0, y_min: 0, x_max: 999, y_max: 999 },
      shadow: 'none',
      group: null,
      ming_layer: 2,
    },
  ],
  prompt: 'Decompose this image into 2 layers.',
  notes: [],
  design_name: 'Harbour – Fresh coffee',
}

/** A price for every unit the flow seller reports, US$1 a million each. */
const PRICES = (['input-token', 'output-token', 'picture', 'gpu-second'] satisfies UsageUnit[]).map((unit) => ({
  unit,
  pricePerMillion: 1_000_000n,
}))

const boss = new PgBoss({ connectionString: DATABASE_URL, max: 2, supervise: false, schedule: false })
await boss.start()
afterAll(() => boss.stop({ graceful: false }))

/** The queue the tests' flow jobs are saved to, never worked. */
const QUEUE = `ai-flow-${newId()}`
await ensureQueue(boss, QUEUE)

/** A workspace with a brand, an Editor and ₹100 of allowance. */
export async function flowWorkspace(): Promise<FlowWorkspace> {
  const workspace = `ws-${newId()}`
  const brand = `brand-${newId()}`
  const member = `user-${newId()}`
  await db.insert(workspaces).values({ id: workspace, name: 'Harbour' })
  await db.insert(brands).values({ id: brand, workspaceId: workspace, name: 'Harbour Coffee' })
  await db.insert(users).values({ id: member, workosUserId: `workos-${member}`, email: `${member}@example.com` })
  await db.insert(memberships).values({ workspaceId: workspace, userId: member, role: 'editor' })
  await giveGrant(db, { workspace, amount: ALLOWANCE, expiresAt: new Date(Date.now() + 86_400_000) })
  return { workspace, brand, member }
}

/** A round of `who`'s brand, Fast and square, from a short brief with one product picture, its brief written as the API will. */
export async function roundOf(who: FlowWorkspace, change: Partial<RoundInput> = {}): Promise<RoundInput> {
  const designId = `design-${newId()}`
  await db.insert(designs).values({
    id: designId,
    workspaceId: who.workspace,
    brandId: who.brand,
    name: 'Coffee',
    schemaVersion: SCHEMA_VERSION,
  })
  const frame = () => ({ frameId: newId(), pictureLayerId: newId() })
  const round: RoundInput = {
    brandId: who.brand,
    designId,
    briefId: `brief-${newId()}`,
    sectionId: newId(),
    frames: [frame(), frame(), frame(), frame()],
    words: 'Harbour Coffee, fresh every morning\nShow the cup.',
    pictures: [`workspaces/${who.workspace}/originals/product`],
    size: { width: 1080, height: 1080 },
    mode: 'fast',
    brand: { name: 'Harbour Coffee', colors: ['#14213D', '#FCA311'], fonts: ['Lora'], voice: 'Warm and plain.' },
    ...change,
  }
  await db.insert(aiBriefs).values({
    id: round.briefId,
    workspaceId: who.workspace,
    brandId: who.brand,
    designId,
    sectionId: round.sectionId,
    words: round.words,
    pictureKeys: round.pictures,
    referenceKey: round.referenceKey ?? null,
    logoKey: round.logoKey ?? null,
    width: round.size.width,
    height: round.size.height,
    mode: round.mode,
    createdBy: who.member,
  })
  return round
}

/** The brief's stored plan. */
export async function planOf(brief: string) {
  const [row] = await db.select({ plan: aiBriefs.plan }).from(aiBriefs).where(eq(aiBriefs.id, brief))
  return row?.plan ?? null
}

/**
 * A seller named `seller` that answers each call as `answer` says, and otherwise as its prompt asks: a round plan,
 * a reference read, a refine plan, a layer plan or a reading, a 16 px picture, or two layers. It is put in use and
 * priced, in tokens, pictures and GPU seconds, for every model the flow's steps run.
 */
export async function flowSeller(
  seller: string,
  answer: (request: SellerRequest) => FlowAnswer | undefined = () => undefined,
): Promise<FlowSeller> {
  const picture = { bytes: await pngOf(16, 16, [200, 120, 40, 255]), type: 'image/png', width: 16, height: 16 }
  const requests: SellerRequest[] = []
  const adapter: FlowSeller = {
    seller,
    requests,
    async call(request) {
      requests.push(request)
      const output = answer(request) ?? plainAnswer(request.input, picture)
      if (output === 'fail') throw new SellerError('refused', { status: 400 })
      return { output, usage: usageOf(request.input), requestId: `${seller}-${requests.length}` }
    },
  }
  useSeller(adapter)
  // Every model a preset of an AI function runs.
  const models = new Set(
    AI_FUNCTIONS.flatMap((fn) => Object.values(aiFunctionDef(fn).presets).map((preset) => preset.model)),
  )
  for (const model of models) await addPrices(seller, model, PRICES)
  return adapter
}

/** The deps a flow job runs on in a test: the database, pictures in memory, and only `seller`. */
export function flowDeps(seller: FlowSeller, files = memoryFiles()): FlowDeps & { files: typeof files } {
  return { db, files, sellers: [seller.seller] }
}

/** Saves `flow` for `who` with its hold, as the API will; its id. */
export async function saveFlow(who: FlowWorkspace, flow: FlowJobInput): Promise<string> {
  const saved = await db.transaction((tx) =>
    saveJob(tx, boss, { workspace: who.workspace, member: who.member, ...flow, queue: QUEUE }),
  )
  if (!saved.ok) throw new Error(`refused: ${saved.refusal}`)
  return saved.job
}

/**
 * Runs the saved job's next attempt to its end as the worker does, aborted by `signal`; its row once ended. An
 * aborted attempt is left as a crashed worker leaves it.
 */
export async function runFlow(job: string, deps: FlowDeps, signal = new AbortController().signal) {
  const [row] = await db.select().from(aiJobs).where(eq(aiJobs.id, job))
  const start = await startAttempt(db, boss, { job, queue: QUEUE, queueJobId: row?.queueJobId ?? '' })
  if (!start.make || start.job.kind === 'calls') throw new Error('the job did not start')
  const attempt = {
    job,
    workspace: start.workspace,
    attempt: start.attempt,
    flow: start.job,
    presets: start.presets,
    signal,
  }
  const end = await runFlowJob(deps, attempt)
  await endJob(db, job, start.attempt, end)
  const [ended] = await db.select().from(aiJobs).where(eq(aiJobs.id, job))
  if (!ended) throw new Error(`no job ${job}`)
  return ended
}

/** The job's ledger rows, oldest first, as kind, amount and the call log row a charge is for. */
export async function ledgerOf(job: string) {
  return db
    .select({ kind: aiLedger.kind, amount: aiLedger.amount, call: aiLedger.callId })
    .from(aiLedger)
    .where(eq(aiLedger.jobId, job))
    .orderBy(aiLedger.id)
}

/** The call indexes of the job's charged calls, in order. */
export async function chargedCalls(job: string): Promise<number[]> {
  const rows = await db
    .select({ index: aiCalls.callIndex, charged: aiCalls.chargedAt })
    .from(aiCalls)
    .where(eq(aiCalls.jobId, job))
  return rows
    .filter((row) => row.charged)
    .map((row) => row.index)
    .sort((a, b) => a - b)
}

/** The asset's row. */
export async function assetRow(id: string) {
  const [row] = await db.select().from(assets).where(eq(assets.id, id))
  if (!row) throw new Error(`no asset ${id}`)
  return row
}

/** The answer a call's prompt asks for. */
function plainAnswer(input: CallInput, picture: { bytes: Uint8Array; type: string; width: number; height: number }) {
  if (input.kind === 'picture') return { kind: 'pictures' as const, pictures: [picture] }
  if (input.kind === 'layer-split') return { kind: 'layers' as const, layers: [picture, picture], gpuSeconds: 17.5 }
  const json = textAnswer(input.instructions)
  return { kind: 'text' as const, text: JSON.stringify(json), json }
}

/** The JSON a text call of `instructions` answers with. */
function textAnswer(instructions: string): unknown {
  if (instructions === REFERENCE_READER) return { why: 'A cup on a table.', is_ad: true, kind: 'photographic' }
  if (instructions === REFINE_EDITOR)
    return { instruction: 'Make the price bigger.', summary: 'Bigger price', pinned_only: false }
  if (instructions.startsWith(PLANNER_PROMPT)) return LAYER_PLAN
  if (instructions === READING_PROMPT) return { blocks: [] }
  return PLAN
}

/** The usage a call of `input` reports. */
function usageOf(input: CallInput): Partial<Record<UsageUnit, number>> {
  if (input.kind === 'picture') return { picture: 1 }
  if (input.kind === 'layer-split') return { 'gpu-second': 17.5 }
  return { 'input-token': 1000, 'output-token': 500 }
}
