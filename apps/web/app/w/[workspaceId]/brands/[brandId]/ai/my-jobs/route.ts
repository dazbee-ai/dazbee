// The person's own AI jobs on the brand, running or just ended, at /w/[workspace]/brands/[brand]/ai/my-jobs, which
// the Assets panel reads to show an image being made.
import { myAiJobs } from '@/lib/server/ai-flow.ts'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ workspaceId: string; brandId: string }> },
) {
  const { workspaceId, brandId } = await params
  const jobs = await myAiJobs()
  return Response.json(
    jobs.filter((job) => job.workspaceId === workspaceId.toLowerCase() && job.brandId === brandId),
    { headers: { 'cache-control': 'private, no-store' } },
  )
}
