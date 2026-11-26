// How much of the workspace's AI an action takes and about how long, at /w/[workspace]/brands/[brand]/ai/estimate,
// for the tooltip of the button that starts it. The query is the API's: the action, with its mode, sizes and
// reference where it has them.
import { aiEstimate } from '@/lib/server/ai-flow.ts'
import { ApiFailure } from '@/lib/server/api.ts'

export async function GET(request: Request, { params }: { params: Promise<{ workspaceId: string; brandId: string }> }) {
  const { workspaceId, brandId } = await params
  try {
    return Response.json(await aiEstimate(workspaceId, brandId, new URL(request.url).searchParams), {
      headers: { 'cache-control': 'private, no-store' },
    })
  } catch (e) {
    if (e instanceof ApiFailure && (e.status === 400 || e.status === 403 || e.status === 404))
      return Response.json({ error: e.message }, { status: e.status })
    throw e
  }
}
