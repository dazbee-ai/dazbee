// Making drafts from the brand home: a new design holding only the brief's section and four waiting drafts, then the
// round started with their ids. A round refused deletes the design and says why; a round whose answer was lost keeps
// the design, since the round may have started and its drafts would arrive there.
import 'server-only'

import { type AiJobRefusal, briefDesignOf, planRound, type StartRound } from '@dazbee/schema'

import type { JobStart } from './ai-flow.ts'

/** The brief as the brand home's form sends it. */
export type HomeBrief = Pick<StartRound, 'words' | 'pictures' | 'size' | 'mode' | 'reference'>

/** What making drafts asks of the API. */
export interface BriefStartApi {
  createDesign(name: string, content: unknown): Promise<{ id: string }>
  startRound(round: StartRound): Promise<JobStart>
  deleteDesign(designId: string): Promise<unknown>
}

/** How making drafts came out: the design to open, or why the round was refused, its design deleted. */
export type BriefStart = { designId: string } | { refused: AiJobRefusal | null }

/** The id a new design's content names before the API gives the design its own. */
const NEW_DESIGN = 'new-design'

/**
 * Makes the design named `name` for `brief`, its drafts named by `draftName`, with ids from `newId`, and starts its
 * round.
 */
export async function startBriefDesign(
  api: BriefStartApi,
  {
    brief,
    name,
    draftName,
    newId,
  }: { brief: HomeBrief; name: string; draftName: (n: number) => string; newId: () => string },
): Promise<BriefStart> {
  // A brief of no words starts nothing, and makes no design.
  if (brief.words === '') return { refused: null }
  const plan = planRound(newId)
  const content = briefDesignOf(
    { designId: NEW_DESIGN, name },
    { ...plan, words: brief.words, size: brief.size, draftName },
  )
  const design = await api.createDesign(name, content)
  let started: JobStart
  try {
    started = await api.startRound({ kind: 'round', designId: design.id, ...plan, ...brief })
  } catch {
    // The answer was lost, so the round may have started: its design is kept for the drafts.
    return { designId: design.id }
  }
  if (started.ok) return { designId: design.id }
  await api.deleteDesign(design.id).catch(() => {})
  return { refused: started.refusal }
}
