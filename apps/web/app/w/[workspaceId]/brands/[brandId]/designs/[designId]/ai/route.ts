// A design's AI frames with their jobs and briefs, at /w/[workspace]/brands/[brand]/designs/[design]/ai, which the
// editor reads to write each picture made into its frame.
import { designAi } from '@/lib/server/ai-flow.ts'
import { ApiFailure } from '@/lib/server/api.ts'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ workspaceId: string; brandId: string; designId: string }> },
) {
  const { workspaceId, brandId, designId } = await params
  try {
    return Response.json(await designAi(workspaceId, brandId, designId))
  } catch (e) {
    if (e instanceof ApiFailure && (e.status === 403 || e.status === 404))
      return Response.json({ error: e.message }, { status: e.status })
    throw e
  }
}
