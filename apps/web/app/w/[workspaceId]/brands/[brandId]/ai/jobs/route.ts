// Starts an AI flow job on a design of the brand, at /w/[workspace]/brands/[brand]/ai/jobs, for the editor's brief
// box. A refusal answers with its status and, when saving the job was refused, why, so the box can say so.
import { StartAiJob } from '@dazbee/schema'

import { startAiJob } from '@/lib/server/ai-flow.ts'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string; brandId: string }> },
) {
  const { workspaceId, brandId } = await params
  const input = StartAiJob.safeParse(await request.json().catch(() => null))
  if (!input.success)
    return Response.json({ error: input.error.issues.map((i) => i.message).join('; ') }, { status: 400 })
  const started = await startAiJob(workspaceId, brandId, input.data)
  if (started.ok) return Response.json(started.started, { status: 201 })
  const { error, refusal, status } = started
  return Response.json({ error, ...(refusal ? { refusal } : {}) }, { status })
}
