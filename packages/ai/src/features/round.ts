// Rounds, more like this and try again: the round plan (after reading a reference, when one is given), then four
// drafts in parallel from the plan's prompts, each with the brief's pictures; or one draft again from the brief's
// stored plan. The plan is kept on the brief, for Try again.
import { and, eq } from 'drizzle-orm'

import { aiBriefs, type Db, type Tx } from '@dazbee/db'
import {
  briefTitle,
  type MoreLikeThisInput,
  type RoundInput,
  RoundPlanAnswer,
  type TryAgainInput,
} from '@dazbee/schema'

import { type DraftBrief, draftCall } from '../functions/draft.ts'
import { readKind, referenceReadCall } from '../functions/reference-read.ts'
import { type Lead, planCall } from '../functions/round-plan.ts'
import type { JobEnd } from '../jobs.ts'
import type { DeclaredCall } from './holds.ts'
import type { FlowRun } from './runner.ts'

/** Each call's index in a round or more like this; a try-again's one draft is call 0. */
export const ROUND_CALL = { plan: 0, draft: (n: number) => 1 + n, referenceRead: 5 } as const

/** How many drafts a round makes. */
const DRAFTS = 4

/** Runs a round: a reference read when the brief has a reference, the plan, then four drafts. */
export async function runRound(run: FlowRun, input: RoundInput): Promise<JobEnd | null> {
  let lead: Lead | null = null
  if (input.referenceKey) {
    const read = await run.call(
      ROUND_CALL.referenceRead,
      'reference-read',
      referenceReadCall(input.referenceKey, run.prompt('reference-read')),
      briefTitle(input.words),
    )
    lead = { kind: 'reference', key: input.referenceKey, adKind: readKind(read) }
  }
  return planAndDraw(run, input, lead)
}

/** Runs more like this: a round whose planner sees the liked draft first, in place of any reference. */
export async function runMoreLikeThis(run: FlowRun, input: MoreLikeThisInput): Promise<JobEnd | null> {
  return planAndDraw(run, input, { kind: 'liked', key: input.likedKey })
}

/** Runs try again: draft `draft` of the brief again from its stored plan, or the plain prompt when it has none. */
export async function runTryAgain(run: FlowRun, input: TryAgainInput): Promise<JobEnd | null> {
  const brief = await storedBrief(run.db, run.workspace, input.briefId)
  if (!brief) return { state: 'failed', error: 'the brief is gone' }
  const call = draftCall(brief, brief.plan, input.draft, run.preset('draft').model, run.prompt('draft'))
  await run.call(0, 'draft', call, briefTitle(brief.words))
  return null
}

/** The calls a round or more like this declares: its reference read when it has a reference ad, its plan and four drafts. */
export function roundCalls(input: RoundInput | MoreLikeThisInput): DeclaredCall[] {
  const reference = !('likedKey' in input) && Boolean(input.referenceKey)
  return [
    ...(reference ? [{ fn: 'reference-read' as const }] : []),
    { fn: 'round-plan' },
    ...Array.from({ length: DRAFTS }, () => ({ fn: 'draft' as const })),
  ]
}

/** The call a try-again declares: its one draft. Throws when the workspace has no such brief. */
export async function tryAgainCalls(db: Db | Tx, workspace: string, input: TryAgainInput): Promise<DeclaredCall[]> {
  const brief = await storedBrief(db, workspace, input.briefId)
  if (!brief) throw new Error(`no brief ${input.briefId}`)
  return [{ fn: 'draft' }]
}

/** The plan, kept on the brief, then four drafts from it; a failed plan fails the job. */
async function planAndDraw(run: FlowRun, input: RoundInput, lead: Lead | null): Promise<JobEnd | null> {
  const name = briefTitle(input.words)
  const answer = await run.call(ROUND_CALL.plan, 'round-plan', planCall(input, lead, run.prompt('round-plan')), name)
  if (!answer) return run.failed()
  const plan = answer.kind === 'text' ? RoundPlanAnswer.safeParse(answer.json) : null
  const kept = plan?.success ? plan.data : null
  await run.db
    .update(aiBriefs)
    .set({ plan: kept })
    .where(and(eq(aiBriefs.id, input.briefId), eq(aiBriefs.workspaceId, run.workspace)))
  const model = run.preset('draft').model
  const plain = run.prompt('draft')
  await run.all(
    Array.from({ length: DRAFTS }, (_, n) =>
      run.call(ROUND_CALL.draft(n), 'draft', draftCall(input, kept, n, model, plain), name),
    ),
  )
  return null
}

/** The workspace's brief `id` as a draft is made from it, with its stored plan; null when it has none. */
async function storedBrief(db: Db | Tx, workspace: string, id: string) {
  const [row] = await db
    .select()
    .from(aiBriefs)
    .where(and(eq(aiBriefs.id, id), eq(aiBriefs.workspaceId, workspace)))
  if (!row) return null
  const plan = RoundPlanAnswer.safeParse(row.plan)
  return {
    words: row.words,
    pictures: row.pictureKeys,
    logoKey: row.logoKey ?? undefined,
    size: { width: row.width, height: row.height },
    mode: row.mode,
    plan: plan.success ? plan.data : null,
  } satisfies DraftBrief & { plan: RoundPlanAnswer | null }
}
