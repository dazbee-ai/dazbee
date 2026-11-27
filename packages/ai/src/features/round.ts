// Rounds, more like this and try again: the round plan (after reading a reference, when one is given), then four
// drafts side by side from the plan's prompts, each with the brief's pictures; or one draft again from the brief's
// stored plan. The plan is kept on the brief, for Try again.
import { and, eq } from 'drizzle-orm'

import { aiBriefs, type Db, type Tx } from '@dazbee/db'
import {
  briefTitle,
  type CallOutput,
  type MoreLikeThisInput,
  ROUND_DRAFTS,
  type RoundInput,
  RoundPlanAnswer,
  type TryAgainInput,
} from '@dazbee/schema'

import { type DraftBrief, draftCall } from '../functions/draft.ts'
import { readKind, referenceReadCall } from '../functions/reference-read.ts'
import { type Lead, planCall } from '../functions/round-plan.ts'
import type { AiFeatureDef, FeatureCall, FeatureRun } from './types.ts'

/** A brief as a try-again draws from it: what a draft is made from, and its stored plan. */
type StoredBrief = DraftBrief & { plan: RoundPlanAnswer | null }

/** Each call's index in a round or more like this; a try-again's one draft is call 0. */
export const ROUND_CALL = { plan: 0, draft: (n: number) => 1 + n, referenceRead: 5 } as const

/** The reference read on the brief's reference ad. */
const REFERENCE_READ: FeatureCall<RoundInput | MoreLikeThisInput, undefined> = {
  index: ROUND_CALL.referenceRead,
  fn: 'reference-read',
  build: ({ input, prompt }) => (input.referenceKey ? referenceReadCall(input.referenceKey, prompt) : null),
}

/** The round plan, with what the planner sees first. */
const PLAN: FeatureCall<RoundInput | MoreLikeThisInput, undefined> = {
  index: ROUND_CALL.plan,
  fn: 'round-plan',
  standsOn: true,
  build: ({ input, answers, prompt }) => planCall(input, leadOf(input, answers), prompt),
}

/**
 * A round: a reference read when the brief has a reference ad, the plan, which the job stands on and which is kept
 * on the brief, then four drafts.
 */
export const round: AiFeatureDef<RoundInput | MoreLikeThisInput> = {
  shape: (input) => ({ count: ROUND_DRAFTS, reference: Boolean(input.referenceKey) }),
  stages: (shape) => [
    shape.reference ? [REFERENCE_READ] : [],
    [PLAN],
    Array.from({ length: ROUND_DRAFTS }, (_, n): FeatureCall<RoundInput | MoreLikeThisInput, undefined> => ({
      index: ROUND_CALL.draft(n),
      fn: 'draft',
      build: ({ input, answers, model, prompt }) => draftCall(input, planOf(answers), n, model, prompt),
    })),
  ],
  mode: (_db, _workspace, input) => input.mode,
  name: (_on, input) => briefTitle(input.words),
  async kept(on, input, index, output) {
    if (index !== ROUND_CALL.plan) return
    await on.db
      .update(aiBriefs)
      .set({ plan: planIn(output) })
      .where(and(eq(aiBriefs.id, input.briefId), eq(aiBriefs.workspaceId, on.workspace)))
  },
}

/**
 * More like this: a round whose planner sees the liked draft first, in place of any reference ad, so no reference
 * read is held, waited for or made.
 */
export const moreLikeThis: AiFeatureDef<MoreLikeThisInput> = {
  ...round,
  stages: (shape) => round.stages({ ...shape, reference: false }),
}

/** Try again: draft `draft` of the brief again from its stored plan, or the plain prompt when it has none. */
export const tryAgain: AiFeatureDef<TryAgainInput, StoredBrief> = {
  shape: () => ({ count: 1, reference: false }),
  stages: () => [
    [
      {
        index: 0,
        fn: 'draft',
        build: ({ input, loaded, model, prompt }) => draftCall(loaded, loaded.plan, input.draft, model, prompt),
      },
    ],
  ],
  mode: async (db, workspace, input) => (await storedBrief(db, workspace, input.briefId))?.mode ?? null,
  async check(db, workspace, input) {
    if (!(await storedBrief(db, workspace, input.briefId))) throw new Error(`no brief ${input.briefId}`)
  },
  async load(on: FeatureRun, input) {
    const brief = await storedBrief(on.db, on.workspace, input.briefId)
    return brief ? { loaded: brief } : { end: { state: 'failed', error: 'the brief is gone' } }
  },
  name: (_on, _input, brief) => briefTitle(brief.words),
}

/** What the planner sees first: the liked draft, or the reference ad with the kind read from it, or nothing. */
function leadOf(input: RoundInput | MoreLikeThisInput, answers: ReadonlyMap<number, CallOutput>): Lead | null {
  if ('likedKey' in input) return { kind: 'liked', key: input.likedKey }
  if (!input.referenceKey) return null
  return {
    kind: 'reference',
    key: input.referenceKey,
    adKind: readKind(answers.get(ROUND_CALL.referenceRead) ?? null),
  }
}

/** The round plan among `answers`, or null when the plan gave none that can be read. */
function planOf(answers: ReadonlyMap<number, CallOutput>): RoundPlanAnswer | null {
  const output = answers.get(ROUND_CALL.plan)
  return output ? planIn(output) : null
}

/** The round plan a plan call's output holds, or null when it can't be read. */
function planIn(output: CallOutput): RoundPlanAnswer | null {
  const plan = output.kind === 'text' ? RoundPlanAnswer.safeParse(output.json) : null
  return plan?.success ? plan.data : null
}

/** The workspace's brief `id` as a draft is made from it, with its stored plan; null when it has none. */
async function storedBrief(db: Db | Tx, workspace: string, id: string): Promise<StoredBrief | null> {
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
  }
}
