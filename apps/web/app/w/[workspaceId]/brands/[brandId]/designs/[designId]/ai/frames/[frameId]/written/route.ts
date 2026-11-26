// Marks a call written into a design's AI frame, at /w/[workspace]/brands/[brand]/designs/[design]/ai/frames/[frame]/
// written, once the editor's arrival of its picture is stored, so the picture is written into the design once.
import { AiFrameWritten } from '@dazbee/schema'

import { markAiWritten } from '@/lib/server/ai-flow.ts'
import { ApiFailure } from '@/lib/server/api.ts'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string; brandId: string; designId: string; frameId: string }> },
) {
  const { workspaceId, brandId, designId, frameId } = await params
  const input = AiFrameWritten.safeParse(await request.json().catch(() => null))
  if (!input.success)
    return Response.json({ error: input.error.issues.map((i) => i.message).join('; ') }, { status: 400 })
  try {
    await markAiWritten(workspaceId, brandId, designId, frameId, input.data)
    return new Response(null, { status: 204 })
  } catch (e) {
    if (e instanceof ApiFailure && e.status >= 400 && e.status < 500)
      return Response.json({ error: e.message }, { status: e.status })
    throw e
  }
}
