// Ends a layering job's finish held by a tab, at /w/[workspace]/brands/[brand]/ai/jobs/[job]/finished: its frames
// become editable.
import { AiFinishHolder } from '@dazbee/schema'

import { endFinish } from '@/lib/server/ai-flow.ts'
import { ApiFailure } from '@/lib/server/api.ts'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string; brandId: string; jobId: string }> },
) {
  const { workspaceId, brandId, jobId } = await params
  const asked = AiFinishHolder.safeParse(await request.json().catch(() => null))
  if (!asked.success) return Response.json({ error: 'Send the holder' }, { status: 400 })
  try {
    await endFinish(workspaceId, brandId, jobId, asked.data.holder)
    return new Response(null, { status: 204 })
  } catch (e) {
    if (e instanceof ApiFailure && e.status >= 400 && e.status < 500)
      return Response.json({ error: e.message }, { status: e.status })
    throw e
  }
}
