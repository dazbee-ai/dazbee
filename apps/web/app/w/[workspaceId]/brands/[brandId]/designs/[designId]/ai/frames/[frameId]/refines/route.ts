// An AI frame's refines, oldest first, at /w/[workspace]/brands/[brand]/designs/[design]/ai/frames/[frame]/refines:
// each message, its summary once made, its version and its job, which the refine box shows as its conversation.
import { frameRefines } from '@/lib/server/ai-flow.ts'
import { ApiFailure } from '@/lib/server/api.ts'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ workspaceId: string; brandId: string; designId: string; frameId: string }> },
) {
  const { workspaceId, brandId, designId, frameId } = await params
  try {
    return Response.json(await frameRefines(workspaceId, brandId, designId, frameId), {
      headers: { 'cache-control': 'private, no-store' },
    })
  } catch (e) {
    if (e instanceof ApiFailure && (e.status === 403 || e.status === 404))
      return Response.json({ error: e.message }, { status: e.status })
    throw e
  }
}
