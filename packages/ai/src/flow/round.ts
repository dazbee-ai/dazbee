// Rounds, more like this and try again: the round plan (after reading a reference, when one is given), then four
// drafts in parallel from the plan's prompts, each with the brief's pictures; or one draft again from the brief's
// stored plan. The plan is kept on the brief, for Try again.
import { and, eq } from 'drizzle-orm'

import { aiBriefs, type Db, type Tx } from '@dazbee/db'
import {
  type AiMode,
  type AiSize,
  type AiStep,
  answerSchema,
  type BrandFacts,
  briefTitle,
  type CallInput,
  type CallOutput,
  MAX_REFERENCES,
  type MoreLikeThisInput,
  ReferenceReadAnswer,
  type RoundInput,
  RoundPlanAnswer,
  type TryAgainInput,
} from '@dazbee/schema'

import { callSize, pictureLimits, shapeOf } from '../call-size.ts'
import type { JobEnd } from '../jobs.ts'
import { DRAFT_PROMPT, PICTURES_SENTENCE } from '../prompts/ads/draft.ts'
import { REFERENCE_AD, REFERENCE_KIND, REFERENCE_KIND_UNKNOWN, REFERENCE_READER } from '../prompts/ads/reference.ts'
import { LIKED_DRAFT, ROUND_DIRECTOR } from '../prompts/ads/round-director.ts'
import { ROUND_DIRECTOR_LIGHT } from '../prompts/ads/round-director-light.ts'
import { stepModel } from '../steps.ts'
import type { DeclaredCall } from './holds.ts'
import type { FlowRun } from './run.ts'

/** What a draft is made from: the brief's words, its pictures and kit logo, its size and its mode. */
interface DraftBrief {
  words: string
  pictures: string[]
  logoKey?: string | undefined
  size: AiSize
  mode: AiMode
}

/** What the planner sees first: a reference ad with the kind read from it, or the draft the person liked. */
type Lead = { kind: 'reference'; key: string; adKind: string | null } | { kind: 'liked'; key: string }

/** Each call's index in a round or more like this; a try-again's one draft is call 0. */
export const ROUND_CALL = { plan: 0, draft: (n: number) => 1 + n, referenceRead: 5 } as const

/** Each mode's round plan step, draft step and round director. */
export const MODE_STEPS: Record<AiMode, { plan: AiStep; draft: AiStep; director: string }> = {
  fast: { plan: 'flow.round-plan', draft: 'flow.draft-fast', director: ROUND_DIRECTOR_LIGHT },
  precise: { plan: 'flow.round-plan-full', draft: 'flow.draft-precise', director: ROUND_DIRECTOR },
}

/** How many drafts a round makes. */
const DRAFTS = 4

/** Runs a round: a reference read when the brief has a reference, the plan, then four drafts. */
export async function runRound(run: FlowRun, input: RoundInput): Promise<JobEnd | null> {
  let lead: Lead | null = null
  if (input.referenceKey) {
    const read = await run.call(
      ROUND_CALL.referenceRead,
      'flow.reference-read',
      referenceReadCall(input.referenceKey),
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
  const call = await draftCall(run.db, brief, brief.plan, input.draft)
  await run.call(0, MODE_STEPS[brief.mode].draft, call, briefTitle(brief.words))
  return null
}

/** The calls a round or more like this declares: its reference read, its plan and four drafts. */
export async function roundCalls(db: Db | Tx, input: RoundInput | MoreLikeThisInput): Promise<DeclaredCall[]> {
  const liked = 'likedKey' in input ? input.likedKey : undefined
  const lead: Lead | null = liked
    ? { kind: 'liked', key: liked }
    : input.referenceKey
      ? { kind: 'reference', key: input.referenceKey, adKind: null }
      : null
  const steps = MODE_STEPS[input.mode]
  // One at a time, as `db` may be a transaction, whose queries run one after another.
  const drafts: CallInput[] = []
  for (let n = 0; n < DRAFTS; n++) drafts.push(await draftCall(db, input, null, n))
  return [
    ...(lead?.kind === 'reference'
      ? [{ step: 'flow.reference-read' as const, input: referenceReadCall(lead.key) }]
      : []),
    { step: steps.plan, input: planCall(input, lead) },
    ...drafts.map((call) => ({ step: steps.draft, input: call })),
  ]
}

/** The call a try-again declares: its one draft. Throws when the workspace has no such brief. */
export async function tryAgainCalls(db: Db | Tx, workspace: string, input: TryAgainInput): Promise<DeclaredCall[]> {
  const brief = await storedBrief(db, workspace, input.briefId)
  if (!brief) throw new Error(`no brief ${input.briefId}`)
  return [{ step: MODE_STEPS[brief.mode].draft, input: await draftCall(db, brief, brief.plan, input.draft) }]
}

/** The plan, kept on the brief, then four drafts from it; a failed plan fails the job. */
async function planAndDraw(run: FlowRun, input: RoundInput, lead: Lead | null): Promise<JobEnd | null> {
  const name = briefTitle(input.words)
  const steps = MODE_STEPS[input.mode]
  const answer = await run.call(ROUND_CALL.plan, steps.plan, planCall(input, lead), name)
  if (!answer) return run.failed()
  const plan = answer.kind === 'text' ? RoundPlanAnswer.safeParse(answer.json) : null
  const kept = plan?.success ? plan.data : null
  await run.db
    .update(aiBriefs)
    .set({ plan: kept })
    .where(and(eq(aiBriefs.id, input.briefId), eq(aiBriefs.workspaceId, run.workspace)))
  await run.all(
    Array.from({ length: DRAFTS }, async (_, n) =>
      run.call(ROUND_CALL.draft(n), steps.draft, await draftCall(run.db, input, kept, n), name),
    ),
  )
  return null
}

/** The reference reader's call on the reference picture. */
function referenceReadCall(key: string): CallInput {
  return {
    kind: 'text',
    instructions: REFERENCE_READER,
    prompt: 'The attached picture is the reference.',
    pictures: [key],
    schema: answerSchema(ReferenceReadAnswer),
  }
}

/** The kind of ad the reference read found, or null when the read failed. */
function readKind(read: CallOutput | null): string | null {
  const answer = read?.kind === 'text' ? ReferenceReadAnswer.safeParse(read.json) : null
  return answer?.success ? answer.data.kind : null
}

/**
 * The round plan's call: the mode's director as instructions, and a message with the brief's words, the canvas,
 * the brand's facts and what each attached picture is, then the reference or liked-draft words. The lead picture
 * comes first, then the brief's pictures and the kit logo.
 */
function planCall(input: RoundInput, lead: Lead | null): CallInput {
  const own = briefPictures(input)
  const pictures = [...(lead ? [lead.key] : []), ...own].slice(0, MAX_REFERENCES)
  const parts = [
    `What the advertiser asks for:\n${input.words}`,
    `The canvas: ${shapeOf(input.size)}, ${input.size.width} × ${input.size.height} px.`,
    brandFacts(input.brand),
    picturesNote(lead, input.pictures.length, Boolean(input.logoKey)),
    lead ? leadWords(lead) : '',
  ]
  return {
    kind: 'text',
    instructions: MODE_STEPS[input.mode].director,
    prompt: parts.filter(Boolean).join('\n\n'),
    pictures,
    schema: answerSchema(RoundPlanAnswer),
  }
}

/** The brand kit's picks as the planner is told them; nothing when the kit has none. */
function brandFacts(brand: BrandFacts): string {
  const lines = [
    brand.name && `- Name: ${brand.name}`,
    brand.colors.length > 0 && `- Colours: ${brand.colors.join(', ')}`,
    brand.fonts.length > 0 && `- Fonts: ${brand.fonts.join(', ')}`,
    brand.voice && `- Voice: ${brand.voice}`,
  ].filter(Boolean)
  return lines.length > 0 ? `The brand's facts:\n${lines.join('\n')}` : ''
}

/** What each attached picture is, in order; nothing when there are none. */
function picturesNote(lead: Lead | null, own: number, logo: boolean): string {
  const which = [
    lead?.kind === 'reference' && 'the reference ad',
    lead?.kind === 'liked' && 'the draft the advertiser liked',
    own === 1 && "the advertiser's own picture",
    own > 1 && `${own} of the advertiser's own pictures`,
    logo && "the brand's logo",
  ].filter(Boolean)
  return which.length > 0 ? `The attached pictures, in order: ${which.join(', then ')}.` : ''
}

/** The words the planner is told for its lead picture. */
function leadWords(lead: Lead): string {
  if (lead.kind === 'liked') return LIKED_DRAFT
  const kind = lead.adKind ? REFERENCE_KIND.replace('{kind}', () => lead.adKind ?? '') : REFERENCE_KIND_UNKNOWN
  return REFERENCE_AD.replace('{kind}', () => kind)
}

/** The brief's own pictures and its kit logo, each once, as many as a call sends. */
function briefPictures(brief: DraftBrief): string[] {
  return [...new Set([...brief.pictures, ...(brief.logoKey ? [brief.logoKey] : [])])].slice(0, MAX_REFERENCES)
}

/**
 * Draft `n`'s picture call: the plan's prompt for it with the pictures sentence when the brief has pictures, or the
 * plain draft prompt when the plan gave none; with the brief's pictures, at the mode's model's call size.
 */
async function draftCall(db: Db | Tx, brief: DraftBrief, plan: RoundPlanAnswer | null, n: number): Promise<CallInput> {
  const pictures = briefPictures(brief)
  const planned = plan?.ads[n]?.prompt.trim()
  const prompt = planned
    ? [planned, ...(pictures.length > 0 ? [PICTURES_SENTENCE] : [])].join('\n\n')
    : DRAFT_PROMPT.replace('{shape}', () => shapeOf(brief.size))
        .replace('{brief}', () => brief.words)
        .replace('{pictures}', () => (pictures.length > 0 ? `- ${PICTURES_SENTENCE}\n` : ''))
  const { model } = await stepModel(db, MODE_STEPS[brief.mode].draft)
  return { kind: 'picture', prompt, pictures, ...callSize(brief.size, pictureLimits(model)) }
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
