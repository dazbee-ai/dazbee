// Claims, or renews, a layering job's finish for a tab, at /w/[workspace]/brands/[brand]/ai/jobs/[job]/claim: its
// lease, with held true; or held false while another tab holds it, a normal answer for a tab that waits.
import { AiFinishHolder } from '@dazbee/schema'

import { claimFinish } from '@/lib/server/ai-flow.ts'
import { ApiFailure } from '@/lib/server/api.ts'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string; brandId: string; jobId: string }> },
) {
  const { workspaceId, brandId, jobId } = await params
  const asked = AiFinishHolder.safeParse(await request.json().catch(() => null))
  if (!asked.success) return Response.json({ error: 'Send the holder' }, { status: 400 })
  try {
    return Response.json({ held: true, ...(await claimFinish(workspaceId, brandId, jobId, asked.data.holder)) })
  } catch (e) {
    if (e instanceof ApiFailure && e.status === 409) return Response.json({ held: false })
    if (e instanceof ApiFailure && e.status >= 400 && e.status < 500)
      return Response.json({ error: e.message }, { status: e.status })
    throw e
  }
}
