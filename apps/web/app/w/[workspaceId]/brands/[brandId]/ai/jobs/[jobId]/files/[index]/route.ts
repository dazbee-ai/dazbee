// A layering job's split layer, at /w/[workspace]/brands/[brand]/ai/jobs/[job]/files/[index]: the PNG the tab that
// finishes Make editable crops into a layer.
import { layeringFile } from '@/lib/server/ai-flow.ts'
import { ApiFailure } from '@/lib/server/api.ts'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ workspaceId: string; brandId: string; jobId: string; index: string }> },
) {
  const { workspaceId, brandId, jobId, index } = await params
  const at = Number(index)
  if (!Number.isInteger(at) || at < 0) return Response.json({ error: 'No such file' }, { status: 404 })
  try {
    const bytes = await layeringFile(workspaceId, brandId, jobId, at)
    return new Response(bytes.slice(), {
      headers: { 'content-type': 'image/png', 'cache-control': 'private, max-age=31536000, immutable' },
    })
  } catch (e) {
    if (e instanceof ApiFailure && e.status >= 400 && e.status < 500)
      return Response.json({ error: e.message }, { status: e.status })
    throw e
  }
}
