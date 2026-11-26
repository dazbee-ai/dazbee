// The person's own flow jobs, for the note that names a design once its job ends and the Assets panel's image tile:
// those running and those ended in the last few minutes, each with the design it fills or, for an image job, its
// words, ratio and image, in workspaces and brands the person may still see.
import { and, desc, eq, gt, inArray, isNull, ne, or } from 'drizzle-orm'

import { readJobs } from '@dazbee/ai'
import { aiJobs, type Db, designs } from '@dazbee/db'
import { AI_FEATURE_INPUTS, type AiFeature, type AiJobView, ImageInput, type MyAiJob } from '@dazbee/schema'

import { findAccess, type MemberAccess } from '../workspace/workspace.ts'

/** How long an ended job stays among the person's jobs: 10 minutes. */
const JUST_ENDED_MS = 10 * 60_000

/** The most jobs given. */
const MOST = 50

/**
 * The person's running and just-ended flow jobs, newest first: each with its design's name, or, for a job on no
 * design, none. A job whose design is gone is left out.
 */
export async function myAiJobs(db: Db, userId: string): Promise<MyAiJob[]> {
  const rows = await db
    .select()
    .from(aiJobs)
    .where(
      and(
        eq(aiJobs.memberId, userId),
        ne(aiJobs.kind, 'calls'),
        or(isNull(aiJobs.endedAt), gt(aiJobs.endedAt, new Date(Date.now() - JUST_ENDED_MS))),
      ),
    )
    .orderBy(desc(aiJobs.createdAt))
    .limit(MOST)
  const placed = rows.flatMap((row) => {
    if (row.kind === 'calls') return []
    const input = AI_FEATURE_INPUTS[row.kind as AiFeature].safeParse(row.input)
    if (!input.success) return []
    const designId = 'designId' in input.data ? input.data.designId : null
    return [{ row, brandId: input.data.brandId, designId }]
  })
  // The person's access in each workspace, null once they left it.
  const accessIn = new Map<string, MemberAccess | null>()
  for (const workspace of new Set(placed.map((p) => p.row.workspaceId))) {
    accessIn.set(workspace, await findAccess(db, workspace, userId))
  }
  const visible = placed.filter(({ row, brandId }) => {
    const access = accessIn.get(row.workspaceId)
    return access && (access.brandIds === null || access.brandIds.includes(brandId))
  })
  if (visible.length === 0) return []
  const named = await db
    .select({ id: designs.id, workspaceId: designs.workspaceId, name: designs.name })
    .from(designs)
    .where(
      inArray(
        designs.id,
        visible.flatMap((v) => (v.designId ? [v.designId] : [])),
      ),
    )
  const views = new Map<string, AiJobView>()
  for (const workspace of new Set(visible.map((v) => v.row.workspaceId))) {
    const ids = visible.filter((v) => v.row.workspaceId === workspace).map((v) => v.row.id)
    for (const view of await readJobs(db, workspace, ids)) views.set(view.id, view)
  }
  return visible.flatMap(({ row, brandId, designId }): MyAiJob[] => {
    const design = named.find((d) => d.id === designId && d.workspaceId === row.workspaceId)
    const calls = views.get(row.id)?.calls ?? []
    if (designId && !design) return []
    return [
      {
        id: row.id,
        kind: row.kind,
        state: row.state,
        workspaceId: row.workspaceId,
        brandId,
        designId,
        designName: design?.name ?? null,
        image: imageOf(row.input, calls),
        made: calls.filter((c) => c.state === 'done').length,
        failed: calls.filter((c) => c.state === 'failed').length,
        createdAt: row.createdAt.toISOString(),
        endedAt: row.endedAt?.toISOString() ?? null,
      },
    ]
  })
}

/** An image job's words and ratio from its `input`, with the image its call made; null for a job of another feature. */
function imageOf(input: unknown, calls: AiJobView['calls']): MyAiJob['image'] {
  const asked = ImageInput.safeParse(input)
  if (!asked.success) return null
  const [call] = calls
  const made = call?.state === 'done' && call.output.kind === 'pictures' ? call.output.pictures[0] : undefined
  return { words: asked.data.words, ratio: asked.data.ratio, assetId: made?.assetId ?? null }
}
